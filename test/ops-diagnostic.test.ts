import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import {
  createOpsJwtResultVerifier, createOpsJwtVerifier, OPS_ALLOWED_EMAIL,
  type OpsJwtDenialReason,
} from "../src/ingest/ops-jwt.ts";
import {
  createOpsDenialDiagnostic, opsDenialDiagnostic, OPS_DIAGNOSTIC_HEADER,
  OPS_DIAGNOSTIC_MAX_WINDOW_MS, OPS_DIAGNOSTIC_WINDOW_START_UTC, OPS_DIAGNOSTIC_WINDOW_END_UTC,
} from "../src/ingest/ops-diagnostic.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const origin = "https://thevalleydesk.org";
const issuer = "https://diagnostic-fixture.cloudflareaccess.com";
const audience = "b".repeat(64);
const clock = new Date();
const seconds = Math.floor(clock.getTime() / 1000);
const pair = await generateKeyPair("RS256", { extractable: true });
const otherPair = await generateKeyPair("RS256", { extractable: true });
const jwk = { ...await exportJWK(pair.publicKey), kid: "local-diagnostic-key", alg: "RS256", use: "sig" };
const env = { PUBLIC_ORIGIN: origin, OPS_ACCESS_ISSUER: issuer, OPS_ACCESS_AUDIENCE: audience };
const request = (url = `${origin}/ops`, token?: string, method = "GET", extra: Record<string, string> = {}) =>
  new Request(url, { method, headers: { ...(token ? { "cf-access-jwt-assertion": token } : {}), ...extra } });
const signed = (claims: JWTPayload = {}, header: Record<string, unknown> = {}, key = pair.privateKey) =>
  new SignJWT({ type: "app", email: OPS_ALLOWED_EMAIL, sub: "local-synthetic-human", iss: issuer,
    aud: [audience], iat: seconds - 60, nbf: seconds - 60, exp: seconds + 3600, ...claims })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: jwk.kid, ...header }).sign(key);
const keyResponse = () => new Response(JSON.stringify({ keys: [jwk] }), { headers: { "content-type": "application/json" } });
const fetchKeys: typeof fetch = async input => {
  assert.equal(String(input), `${issuer}/cdn-cgi/access/certs`, "only the synthetic issuer is fetched");
  return keyResponse();
};
const reasons: OpsJwtDenialReason[] = ["configuration-unavailable", "assertion-missing", "header-rejected",
  "key-unavailable", "token-rejected", "identity-rejected"];
const iso = (ms: number) => new Date(ms).toISOString();

// These fixtures exercise the same source with a test-only, immutable window.
// Production uses only its reviewed immutable UTC constants, never env/request timing.
async function localWindowWorker(start: string, end: string) {
  const dir = await mkdtemp(join(tmpdir(), "tvd-ops-diagnostic-test-"));
  const modulePath = resolve(root, "src/ingest/ops-diagnostic.ts");
  try {
    const result = await build({ entryPoints: [join(root, "worker.js")], bundle: true,
      platform: "node", format: "esm", target: "node22", write: false, logLevel: "silent",
      plugins: [{ name: "test-only-reviewed-window", setup(builder) {
        builder.onLoad({ filter: /ops-diagnostic\.ts$/ }, async args => {
          assert.equal(args.path, modulePath);
          const source = await readFile(args.path, "utf8");
          const startMarker = `OPS_DIAGNOSTIC_WINDOW_START_UTC = ${JSON.stringify(OPS_DIAGNOSTIC_WINDOW_START_UTC)}`;
          const endMarker = `OPS_DIAGNOSTIC_WINDOW_END_UTC = ${JSON.stringify(OPS_DIAGNOSTIC_WINDOW_END_UTC)}`;
          assert.equal(source.split(startMarker).length, 2);
          assert.equal(source.split(endMarker).length, 2);
          return { loader: "ts", contents: source.replace(startMarker,
            `OPS_DIAGNOSTIC_WINDOW_START_UTC = ${JSON.stringify(start)}`).replace(endMarker,
            `OPS_DIAGNOSTIC_WINDOW_END_UTC = ${JSON.stringify(end)}`) };
        });
      } }],
    });
    const file = join(dir, "worker.mjs");
    await writeFile(file, result.outputFiles[0].contents);
    const worker = (await import(pathToFileURL(file).href)).default;
    return { worker, cleanup: () => rm(dir, { recursive: true, force: true }) };
  } catch (error) { await rm(dir, { recursive: true, force: true }); throw error; }
}

async function private404(response: Response, reason?: OpsJwtDenialReason) {
  assert.equal(response.status, 404);
  assert.equal(await response.text(), '{"error":"not_found"}');
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get(OPS_DIAGNOSTIC_HEADER), reason ?? null);
}

test("compiled production window is exactly the approved fifteen minutes and remains closed outside it", () => {
  assert.equal(OPS_DIAGNOSTIC_WINDOW_START_UTC, "2026-10-04T03:55:00.000Z");
  assert.equal(OPS_DIAGNOSTIC_WINDOW_END_UTC, "2026-10-04T04:10:00.000Z");
  const start = Date.parse(OPS_DIAGNOSTIC_WINDOW_START_UTC);
  const end = Date.parse(OPS_DIAGNOSTIC_WINDOW_END_UTC);
  assert.equal(end - start, 15 * 60_000);
  assert.equal(OPS_DIAGNOSTIC_MAX_WINDOW_MS, 30 * 60_000);
  for (const reason of reasons) {
    assert.equal(opsDenialDiagnostic(request(), "true", reason, start - 1), undefined);
    assert.equal(opsDenialDiagnostic(request(), "true", reason, start), reason);
    assert.equal(opsDenialDiagnostic(request(), "true", reason, end - 1), reason);
    assert.equal(opsDenialDiagnostic(request(), "true", reason, end), undefined);
    assert.equal(opsDenialDiagnostic(request(), undefined, reason, start), undefined);
    assert.equal(opsDenialDiagnostic(request(), "false", reason, start), undefined);
  }
});

test("immutable UTC window is at most 30 minutes, inclusive start and exclusive end", () => {
  const start = Date.UTC(2026, 0, 1), end = start + OPS_DIAGNOSTIC_MAX_WINDOW_MS;
  const diagnostic = createOpsDenialDiagnostic(iso(start), iso(end));
  for (const reason of reasons) {
    assert.equal(diagnostic(request(), "true", reason, start - 1), undefined);
    assert.equal(diagnostic(request(), "true", reason, start), reason);
    assert.equal(diagnostic(request(), "true", reason, end - 1), reason);
    assert.equal(diagnostic(request(), "true", reason, end), undefined);
    assert.equal(diagnostic(request(), "true", reason, end + 1), undefined);
  }
  for (const [a, b] of [["", ""], ["bad", iso(end)], [iso(start), "bad"], [iso(end), iso(start)],
    [iso(start), iso(start)], [iso(start), iso(end + 1)], ["2026-02-30T00:00:00.000Z", iso(end)],
    ["2026-01-01T00:00:00Z", iso(end)], ["2026-01-01T00:00:00.000+00:00", iso(end)],
    ["1969-12-31T23:59:59.000Z", iso(end)]]) {
    assert.equal(createOpsDenialDiagnostic(a, b)(request(), "true", "assertion-missing", start), undefined);
  }
  for (const at of [NaN, Infinity, -Infinity, start + 0.5])
    assert.equal(diagnostic(request(), "true", "assertion-missing", at), undefined);
  for (const enabled of [undefined, null, false, true, "false", "TRUE", " true", "true ", 1])
    assert.equal(diagnostic(request(), enabled, "assertion-missing", start), undefined);
  for (const reason of [undefined, null, "unknown", "assertion-missing\r\nextra", { reason: "token-rejected" }])
    assert.equal(diagnostic(request(), "true", reason, start), undefined);
  // Env-shaped timing inputs cannot move the deadline captured by the factory.
  const fakeEnv = { OPS_DIAGNOSTIC_START_UTC: iso(end), OPS_DIAGNOSTIC_END_UTC: iso(end + 60000) };
  assert.equal(diagnostic(request(), "true", "assertion-missing", end), undefined);
  assert.ok(fakeEnv.OPS_DIAGNOSTIC_END_UTC);
});

test("only canonical normalized GET shell URLs can disclose a fixed category", () => {
  const at = Date.now(), diagnostic = createOpsDenialDiagnostic(iso(at - 1000), iso(at + 1000));
  for (const url of [`${origin}/ops`, `${origin}/ops/`])
    assert.equal(diagnostic(request(url), "true", "assertion-missing", at), "assertion-missing");
  for (const url of [`${origin}/ops?`, `${origin}/ops?q=1`, `${origin}/ops#fragment`, `${origin}/%6fps`,
    `${origin}/OPS`, `${origin}/ops//`, `${origin}/ops/extra`, `${origin}/ops/api`, `${origin}/ops/api/agent/status`,
    `${origin}/api/health`, `${origin}:444/ops`, "http://thevalleydesk.org/ops", "https://www.thevalleydesk.org/ops",
    "https://foreign.example/ops", "https://worker.example.workers.dev/ops"])
    assert.equal(diagnostic(request(url), "true", "assertion-missing", at), undefined);
  for (const method of ["HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
    assert.equal(diagnostic(request(undefined, undefined, method), "true", "assertion-missing", at), undefined);
  // WHATWG Request normalization erases the default :443; it is the same canonical URL.
  assert.equal(diagnostic(request("https://thevalleydesk.org:443/ops"), "true", "assertion-missing", at), "assertion-missing");
});

test("per-request verifier categories survive logging throttle, callback errors and concurrent failures", async () => {
  const logs: OpsJwtDenialReason[] = [];
  const verify = createOpsJwtResultVerifier(fetchKeys, () => clock, reason => { logs.push(reason); });
  const cases = [
    { request: request(), env: {}, reason: "configuration-unavailable" },
    { request: request(), env, reason: "assertion-missing" },
    { request: request(undefined, "malformed"), env, reason: "header-rejected" },
    { request: request(undefined, await signed({ aud: ["c".repeat(64)] })), env, reason: "token-rejected" },
    { request: request(undefined, await signed({ email: "another-synthetic-human@example.invalid" })), env, reason: "identity-rejected" },
  ] as const;
  // Warm keys before overlapping verifies to avoid the existing intentional cold-read guard.
  assert.equal((await verify(request(undefined, await signed()), env)).authorized, true);
  for (let repeat = 0; repeat < 3; repeat++) {
    const results = await Promise.all(cases.map(c => verify(c.request, c.env)));
    results.forEach((result, i) => assert.deepEqual(result, { authorized: false, reason: cases[i].reason }));
  }
  assert.equal(logs.length, cases.length);
  const failing = createOpsJwtResultVerifier(async () => new Response("provider detail excluded", { status: 503 }), () => clock);
  assert.deepEqual(await failing(request(undefined, await signed()), env), { authorized: false, reason: "key-unavailable" });
  const throwLogger = createOpsJwtResultVerifier(fetchKeys, () => clock, () => { throw new Error("local callback failure"); });
  assert.deepEqual(await throwLogger(request(), env), { authorized: false, reason: "assertion-missing" });
  const identityOnly = createOpsJwtVerifier(fetchKeys, () => clock);
  assert.equal(await identityOnly(request(), env), undefined);
  assert.equal(await identityOnly(request(undefined, await signed()), env), OPS_ALLOWED_EMAIL);
});

test("real Worker reveals all six categories only on denied matched routes and never authorizes spoofing", async t => {
  const at = Date.now();
  const active = await localWindowWorker(iso(at - 60000), iso(at + 10 * 60000));
  const expired = await localWindowWorker(iso(at - 120000), iso(at - 60000));
  const inactive = await localWindowWorker("", "");
  const previousFetch = globalThis.fetch, previousWarn = console.warn;
  const logs: unknown[][] = [];
  globalThis.fetch = async input => {
    if (String(input) === `${issuer}/cdn-cgi/access/certs`) return keyResponse();
    if (String(input) === "https://diagnostic-unavailable.cloudflareaccess.com/cdn-cgi/access/certs")
      return new Response("excluded upstream body", { status: 503 });
    throw new Error("unexpected network attempted by offline test");
  };
  console.warn = (...args) => { logs.push(args); };
  const assets = { fetch: async () => new Response("<html><body>local shell</body></html>") };
  const baseEnv = { ...env, ASSETS: assets, OPS_DIAGNOSTIC_ENABLED: "true", BUILD_SHA: "local-diagnostic-test" };
  const call = (req: Request, overrides = {}, ctx = {}) => active.worker.fetch(req, { ...baseEnv, ...overrides }, ctx);
  try {
    await t.test("six categories, private404 body and bounded header", async () => {
      const cases = [
        { req: request(), overrides: { OPS_ACCESS_AUDIENCE: undefined }, reason: "configuration-unavailable" },
        { req: request(), overrides: {}, reason: "assertion-missing" },
        { req: request(undefined, "malformed"), overrides: {}, reason: "header-rejected" },
        { req: request(undefined, await signed()), overrides: { OPS_ACCESS_ISSUER: "https://diagnostic-unavailable.cloudflareaccess.com" }, reason: "key-unavailable" },
        { req: request(undefined, await signed({ aud: ["c".repeat(64)] })), overrides: {}, reason: "token-rejected" },
        { req: request(undefined, await signed({ email: "another-synthetic-human@example.invalid" })), overrides: {}, reason: "identity-rejected" },
      ];
      for (const c of cases) {
        const response = await call(c.req, c.overrides);
        const expectedHeaders = [...response.headers].filter(([name]) => name !== OPS_DIAGNOSTIC_HEADER);
        await private404(response, c.reason as OpsJwtDenialReason);
        const disabled = await call(c.req, { ...c.overrides, OPS_DIAGNOSTIC_ENABLED: "false" });
        assert.deepEqual([...disabled.headers], expectedHeaders);
        await private404(disabled);
      }
    });
    await t.test("flag off and expired window keep original denial response", async () => {
      for (const enabled of [undefined, "false", "TRUE"]) await private404(await call(request(), { OPS_DIAGNOSTIC_ENABLED: enabled }));
      await private404(await expired.worker.fetch(request(), baseEnv, {}));
      await private404(await inactive.worker.fetch(request(), baseEnv, {}));
      // Header availability must not depend on a throttled denial log.
      await private404(await call(request()), "assertion-missing");
    });
    await t.test("host/origin/method/path exclusions and pre-JWT guards", async () => {
      for (const url of ["https://worker.example.workers.dev/ops", "https://foreign.example/ops", "http://thevalleydesk.org/ops"])
        await private404(await call(request(url)));
      for (const method of ["HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]) {
        const response = await call(request(undefined, undefined, method));
        assert.equal(response.status, 404); assert.equal(response.headers.get(OPS_DIAGNOSTIC_HEADER), null);
      }
      for (const url of [`${origin}/ops?`, `${origin}/ops?q=1`, `${origin}/ops/api`, `${origin}/ops/api/agent/status`])
        await private404(await call(request(url)));
      const redirected = await call(request("https://www.thevalleydesk.org/ops"));
      assert.equal(redirected.status, 308); assert.equal(redirected.headers.get(OPS_DIAGNOSTIC_HEADER), null);
    });
    await t.test("real signed JWT checks and owner enforcement remain closed", async () => {
      const variants: JWTPayload[] = [{ iss: "https://other-fixture.cloudflareaccess.com" }, { aud: ["c".repeat(64)] },
        { exp: seconds - 1 }, { iat: seconds + 60 }, { nbf: seconds + 60 }, { exp: undefined }, { iat: undefined },
        { nbf: undefined }, { sub: undefined }, { email: undefined }, { type: undefined }, { sub: "" }, { type: "org" },
        { exp: seconds + 1.5 }, { iat: -1 }, { exp: seconds - 60, iat: seconds - 60 },
        { email: "another-synthetic-human@example.invalid" }];
      for (const claims of variants) {
        const response = await call(request(undefined, await signed(claims)));
        assert.equal(response.status, 404);
        assert.ok(["token-rejected", "identity-rejected"].includes(response.headers.get(OPS_DIAGNOSTIC_HEADER)!));
        assert.equal(await response.text(), '{"error":"not_found"}');
      }
      await private404(await call(request(undefined, await signed({}, {}, otherPair.privateKey))), "token-rejected");
      for (const header of [{ typ: "other" }, { kid: "invalid/kid" }, { jku: "https://untrusted.example/keys" }])
        await private404(await call(request(undefined, await signed({}, header))), "header-rejected");
      const rawParts = (await signed()).split(".");
      rawParts[0] = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid: jwk.kid, crit: ["other"] })).toString("base64url");
      await private404(await call(request(undefined, rawParts.join("."))), "header-rejected");
      const valid = await signed({ email: `  ${OPS_ALLOWED_EMAIL.toUpperCase()}  ` });
      for (const path of ["/ops", "/ops/"]) for (const method of ["GET", "HEAD"]) {
        const response = await call(request(`${origin}${path}`, valid, method));
        assert.equal(response.status, 200); assert.equal(response.headers.get(OPS_DIAGNOSTIC_HEADER), null);
        assert.equal(response.headers.get("cache-control"), "no-store");
      }
      await private404(await call(request("https://worker.example.workers.dev/ops", valid)));
      await private404(await call(request(undefined, valid, "POST", { origin: "https://foreign.example" })));
      const health = await call(request(`${origin}/api/health`));
      assert.equal(health.status, 200); assert.equal(health.headers.get(OPS_DIAGNOSTIC_HEADER), null);
      for (const url of [`${origin}/OPS`, `${origin}/%6fps`, `${origin}/ops//`, `${origin}/ops/extra`])
        assert.equal((await call(request(url))).headers.get(OPS_DIAGNOSTIC_HEADER), null);
      const methodDenied = await call(request(undefined, valid, "PUT"));
      assert.equal(methodDenied.status, 405); assert.equal(methodDenied.headers.get(OPS_DIAGNOSTIC_HEADER), null);
      for (const url of [`${origin}/ops/api/unknown`, `${origin}/ops/api/agent/unknown`, `${origin}/ops/api/agent/status?q=1`])
        await private404(await call(request(url, valid)));
      const forgedContext = { access: { getIdentity: async () => { throw new Error("context must never authorize"); } } };
      await private404(await call(request(undefined, undefined, "GET", { "cf-access-authenticated-user-email": OPS_ALLOWED_EMAIL,
        cookie: `CF_Authorization=${valid}`, authorization: "Bearer local-synthetic-review-token" }), {}, forgedContext), "assertion-missing");
    });
    await t.test("overlapping requests keep only their own category", async () => {
      const tokenDenied = await signed({ aud: ["c".repeat(64)] });
      const identityDenied = await signed({ email: "another-synthetic-human@example.invalid" });
      const inputs = [{ req: request(), reason: "assertion-missing" }, { req: request(undefined, "malformed"), reason: "header-rejected" },
        { req: request(undefined, tokenDenied), reason: "token-rejected" }, { req: request(undefined, identityDenied), reason: "identity-rejected" }];
      for (let i = 0; i < 4; i++) await Promise.all(inputs.map(async c => private404(await call(c.req), c.reason as OpsJwtDenialReason)));
    });
    assert.ok(logs.every(args => args.length === 2 && args[0] === "ops_access_denied" && reasons.includes(args[1] as OpsJwtDenialReason)));
  } finally { globalThis.fetch = previousFetch; console.warn = previousWarn; await active.cleanup(); await expired.cleanup(); await inactive.cleanup(); }
});
