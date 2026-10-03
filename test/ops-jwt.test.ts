import assert from "node:assert/strict";
import { test } from "node:test";
import { SignJWT } from "jose";
import {
  createOpsJwtVerifier, opsJwtConfiguration, OPS_JWKS_MAX_BYTES, OPS_JWKS_TIMEOUT_MS,
} from "../src/ingest/ops-jwt.ts";
import { handleOpsRequest } from "../src/ingest/ops-access.ts";
import worker from "../worker.js";
import { accessJwtFixture } from "./helpers/ops-jwt-fixture.ts";
const fixture = await accessJwtFixture();
const origin = "https://thevalleydesk.org";
const request = (token?: string) => new Request(`${origin}/ops`, { headers: token ? { "cf-access-jwt-assertion": token } : {} });

test("missing/unverified configuration and raw header/cookie/context cannot authorize or fetch keys", async () => {
  let calls = 0;
  const verify = createOpsJwtVerifier(async () => { calls++; throw new Error("no-network"); });
  for (const config of [{}, { OPS_ACCESS_ISSUER: fixture.issuer }, { ...fixture.config, OPS_ACCESS_ISSUER: "https://attacker.invalid" },
    { ...fixture.config, OPS_ACCESS_ISSUER: `${fixture.issuer}/` }, { ...fixture.config, OPS_ACCESS_ISSUER: "https://x.cloudflareaccess.com@localhost" },
    { ...fixture.config, OPS_ACCESS_ISSUER: "http://x.cloudflareaccess.com" }, { ...fixture.config, OPS_ACCESS_AUDIENCE: "guessed-name" }]) {
    assert.equal(opsJwtConfiguration(config), undefined);
    assert.equal(await verify(request(await fixture.sign()), config), undefined);
  }
  const headers = { "cf-access-authenticated-user-email": "clyons@ajhcs.org", cookie: `CF_Authorization=${await fixture.sign()}` };
  assert.equal(await verify(new Request(`${origin}/ops`, { headers }), fixture.config), undefined);
  const ctx = { access: { getIdentity: async () => ({ email: "clyons@ajhcs.org" }) } };
  assert.equal((await handleOpsRequest(new Request(`${origin}/ops`, { headers }), {} as never, ctx, origin, async () => "private")).status, 404);
  assert.equal(calls, 0);
});

test("RS256 signature and exact issuer/audience/expiry/nbf/iat/human identity are required", async () => {
  const verify = createOpsJwtVerifier(fixture.fetcher);
  assert.equal(await verify(request(await fixture.sign()), fixture.config), "clyons@ajhcs.org");
  assert.equal(await verify(request(await fixture.sign({}, {}, "previous")), fixture.config), "clyons@ajhcs.org");
  const time = Math.floor(Date.now() / 1_000);
  const cases = [
    { iss: "https://other.cloudflareaccess.com" }, { aud: ["b".repeat(64)] }, { exp: time }, { exp: time - 1 },
    { nbf: time + 120 }, { iat: time + 120 }, { exp: undefined }, { iat: undefined }, { nbf: undefined },
    { exp: 1e300 }, { exp: "tomorrow" }, { iat: -1 }, { nbf: time + 0.5 },
    { sub: "" }, { sub: undefined }, { type: "org" }, { type: undefined },
    { email: "someone@example.com" }, { email: undefined }, { email: ["clyons@ajhcs.org"] },
    { sub: "", email: undefined, common_name: "synthetic-service.access" },
  ];
  for (const claims of cases) assert.equal(await verify(request(await fixture.sign(claims as never)), fixture.config), undefined, JSON.stringify(claims));
  assert.equal(await verify(request(await fixture.sign({}, {}, "outsider")), fixture.config), undefined);
  const token = await fixture.sign();
  const parts = token.split(".");
  const body = JSON.parse(Buffer.from(parts[1], "base64url").toString()); body.email = "someone@example.com";
  parts[1] = Buffer.from(JSON.stringify(body)).toString("base64url");
  assert.equal(await verify(request(parts.join(".")), fixture.config), undefined);
  assert.equal(await verify(request(await fixture.sign({ email: "Clyons@AJHCS.org" })), fixture.config), "clyons@ajhcs.org");
});

test("token expiration is rechecked after delayed key retrieval", async () => {
  const start = Math.floor(Date.now() / 1_000); let clock = start;
  const verify = createOpsJwtVerifier(async () => { clock += 5; return Response.json({ keys: fixture.keys }); }, () => new Date(clock * 1_000));
  assert.equal(await verify(request(await fixture.sign({ exp: start + 2 })), fixture.config), undefined);
});

test("unsafe JOSE headers, algorithms, duplicate/malformed and oversized assertions fail before key fetch", async () => {
  let calls = 0;
  const verify = createOpsJwtVerifier(async () => { calls++; throw new Error("unexpected-network"); });
  const badHeaders = [{ typ: "not-jwt" }, { kid: "" }, { kid: "x".repeat(129) },
    { jku: "https://attacker.invalid/keys" }, { jwk: fixture.keys[0] }, { x5u: "https://attacker.invalid" }, { x5c: [] }];
  for (const header of badHeaders) assert.equal(await verify(request(await fixture.sign({}, header)), fixture.config), undefined);
  const hmac = await new SignJWT({ email: "clyons@ajhcs.org" }).setProtectedHeader({ alg: "HS256", typ: "JWT", kid: "current-key" }).sign(new Uint8Array(32));
  for (const token of [hmac, "e30.e30.", "not.jwt", "x".repeat(8193), `${await fixture.sign()},${await fixture.sign()}`]) {
    assert.equal(await verify(request(token), fixture.config), undefined);
  }
  assert.equal(calls, 0);
});

test("JWKS success cache and unknown-kid cooldown are bounded; key URLs are never token-controlled", async () => {
  const local = await accessJwtFixture();
  const verify = createOpsJwtVerifier(local.fetcher);
  assert.equal(await verify(request(await local.sign()), local.config), "clyons@ajhcs.org");
  assert.equal(await verify(request(await local.sign({}, { kid: "absent-key" })), local.config), undefined);
  assert.equal(await verify(request(await local.sign()), local.config), "clyons@ajhcs.org");
  assert.equal(local.calls(), 1);
});

test("failed JWKS reads and concurrent cold requests deny without repeated fetches", async () => {
  const token = await fixture.sign(); let calls = 0;
  const verify = createOpsJwtVerifier(async () => { calls++; return new Response("failure", { status: 503 }); });
  for (let i = 0; i < 3; i++) assert.equal(await verify(request(token), fixture.config), undefined);
  assert.equal(calls, 1);
  let release!: (response: Response) => void; let coldCalls = 0;
  const cold = createOpsJwtVerifier(async () => { coldCalls++; return await new Promise<Response>(resolve => { release = resolve; }); });
  const workerRealm = Object.getOwnPropertyDescriptor(globalThis, "WebSocketPair");
  Object.defineProperty(globalThis, "WebSocketPair", { configurable: true, value: function SyntheticWorkerPair() {} });
  try {
    const first = cold(request(token), fixture.config);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(await cold(request(token), fixture.config), undefined);
    release(Response.json({ keys: fixture.keys }));
    assert.equal(await first, "clyons@ajhcs.org"); assert.equal(coldCalls, 1);
  } finally {
    if (workerRealm) Object.defineProperty(globalThis, "WebSocketPair", workerRealm);
    else Reflect.deleteProperty(globalThis, "WebSocketPair");
  }
});

test("key rotation after cooldown and stale-key refresh failure are bounded and never use stale success", async () => {
  const rotated = await accessJwtFixture();
  const token = await rotated.sign({}, { kid: "rotated-key" });
  let calls = 0;
  const verify = createOpsJwtVerifier(async () => {
    calls++;
    if (calls === 3) return new Response("unavailable", { status: 503 });
    return Response.json({ keys: calls === 1 ? fixture.keys : [...fixture.keys, { ...rotated.keys[0], kid: "rotated-key" }] });
  });
  const originalNow = Date.now; const start = originalNow();
  try {
    assert.equal(await verify(request(await fixture.sign()), fixture.config), "clyons@ajhcs.org");
    assert.equal(await verify(request(token), fixture.config), undefined); assert.equal(calls, 1);
    Date.now = () => start + 31_000;
    assert.equal(await verify(request(token), fixture.config), "clyons@ajhcs.org"); assert.equal(calls, 2);
    Date.now = () => start + 5 * 60_000 + 32_000;
    assert.equal(await verify(request(token), fixture.config), undefined); assert.equal(calls, 3);
    assert.equal(await verify(request(token), fixture.config), undefined); assert.equal(calls, 3);
  } finally { Date.now = originalNow; }
});

test("configured audience and issuer changes isolate trust; token claims never select key destinations", async () => {
  const urls: string[] = [];
  const verify = createOpsJwtVerifier(async input => { urls.push(String(input)); return Response.json({ keys: fixture.keys }); });
  const token = await fixture.sign();
  assert.equal(await verify(request(token), fixture.config), "clyons@ajhcs.org");
  const changedAudience = { ...fixture.config, OPS_ACCESS_AUDIENCE: "b".repeat(64) };
  assert.equal(await verify(request(token), changedAudience), undefined);
  assert.equal(await verify(request(await fixture.sign({ aud: [changedAudience.OPS_ACCESS_AUDIENCE] })), changedAudience), "clyons@ajhcs.org");
  const changedIssuer = { ...fixture.config, OPS_ACCESS_ISSUER: "https://synthetic-other.cloudflareaccess.com" };
  assert.equal(await verify(request(token), changedIssuer), undefined);
  assert.equal(await verify(request(await fixture.sign({ iss: changedIssuer.OPS_ACCESS_ISSUER })), changedIssuer), "clyons@ajhcs.org");
  assert.deepEqual(urls, [`${fixture.issuer}/cdn-cgi/access/certs`, `${changedIssuer.OPS_ACCESS_ISSUER}/cdn-cgi/access/certs`]);
});

test("JWKS redirects, malformed/oversized bodies, too many/ambiguous/unknown keys fail closed", async () => {
  const token = await fixture.sign();
  const responses = [
    () => new Response(null, { status: 302, headers: { location: "https://attacker.invalid" } }),
    () => new Response("not json"), () => new Response(new Uint8Array([255])),
    () => new Response("x", { headers: { "content-length": String(OPS_JWKS_MAX_BYTES + 1) } }),
    () => new Response("x".repeat(OPS_JWKS_MAX_BYTES + 1)),
    () => Response.json({ keys: [] }), () => Response.json({ keys: Array(17).fill(fixture.keys[0]) }),
    () => Response.json({ keys: [fixture.keys[0], fixture.keys[0]] }),
    () => Response.json({ keys: [{ ...fixture.keys[0], kid: "wrong-key" }] }),
  ];
  for (const response of responses) {
    const verify = createOpsJwtVerifier(async () => response());
    assert.equal(await verify(request(token), fixture.config), undefined);
  }
});

test("JWKS deadline includes response body; a hanging stream cannot hold Ops authorization open", async () => {
  let cancelled = false;
  const verify = createOpsJwtVerifier(async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  const start = Date.now();
  assert.equal(await verify(request(await fixture.sign()), fixture.config), undefined);
  assert.ok(Date.now() - start < OPS_JWKS_TIMEOUT_MS + 1500);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(cancelled, true);
});

test("actual asset-backed Worker route authorizes signed same-origin Ops without ctx.access, and stays private", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = fixture.fetcher;
  let assetReads = 0;
  const env = { ...fixture.config, PUBLIC_ORIGIN: origin, BUILD_SHA: "synthetic-auth-fix", ASSETS: { fetch: async () => {
    assetReads++; return new Response("<html><head></head><body>private-shell</body></html>", { headers: { "content-type": "text/html" } });
  } } };
  const ctx = { waitUntil() {} };
  try {
    const token = await fixture.sign();
    const permitted = await worker.fetch(new Request(`${origin}/ops`, { headers: { "cf-access-jwt-assertion": token } }), env, ctx);
    assert.equal(permitted.status, 200); assert.ok((await permitted.text()).includes("private-shell"));
    assert.equal(permitted.headers.get("cache-control"), "no-store"); assert.equal(permitted.headers.get("x-robots-tag"), "noindex, nofollow");
    const tools = await worker.fetch(new Request(`${origin}/ops/api/agent/tools`, { headers: { "cf-access-jwt-assertion": token } }), env, ctx);
    assert.equal(tools.status, 200); assert.equal((await tools.json()).tools.length, 3);
    const before = assetReads;
    for (const url of [`${origin}/ops`, "https://the-valley-desk.synthetic.workers.dev/ops", "https://foreign.invalid/ops", "http://thevalleydesk.org/ops"]) {
      const headers = url === `${origin}/ops` ? { "cf-access-authenticated-user-email": "clyons@ajhcs.org" } : { "cf-access-jwt-assertion": token };
      assert.equal((await worker.fetch(new Request(url, { headers }), env, ctx)).status, 404);
    }
    for (const source of [undefined, "https://foreign.invalid"]) {
      const headers: Record<string,string> = { "cf-access-jwt-assertion": token, "content-type": "application/json" };
      if (source) headers.origin = source;
      assert.equal((await worker.fetch(new Request(`${origin}/ops/api/agent/regional-source-inventory`, { method: "POST", headers, body: "{}" }), env, ctx)).status, 404);
    }
    assert.equal(assetReads, before);
    const health = await worker.fetch(new Request(`${origin}/api/health`), env, ctx);
    assert.equal(health.status, 200); assert.equal((await health.json()).buildSha, "synthetic-auth-fix");
  } finally { globalThis.fetch = original; }
});
