import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";

/** Ephemeral synthetic keys only; no fixture material reaches Worker assets. */
export async function accessJwtFixture() {
  const current = await generateKeyPair("RS256", { extractable: true });
  const previous = await generateKeyPair("RS256", { extractable: true });
  const outsider = await generateKeyPair("RS256", { extractable: true });
  const issuer = "https://synthetic-ops.cloudflareaccess.com";
  const audience = "a".repeat(64);
  const config = { OPS_ACCESS_ISSUER: issuer, OPS_ACCESS_AUDIENCE: audience };
  const keys = await Promise.all([current, previous].map(async (pair, i) => ({ ...await exportJWK(pair.publicKey), kid: i ? "previous-key" : "current-key", alg: "RS256", use: "sig" })));
  let calls = 0;
  const fetcher: typeof fetch = async (input, init) => {
    calls++;
    if (String(input) !== `${issuer}/cdn-cgi/access/certs`) throw new Error("unexpected-test-network");
    if (init?.method !== "GET" || init.redirect !== "manual" || init.credentials !== "omit") throw new Error("unsafe-test-fetch");
    return Response.json({ keys });
  };
  const sign = async (claims: JWTPayload = {}, header: Record<string, unknown> = {}, key: "current" | "previous" | "outsider" = "current") => {
    const now = Math.floor(Date.now() / 1_000);
    return new SignJWT({ iss: issuer, aud: [audience], exp: now + 600, iat: now - 1, nbf: now - 1,
      sub: "synthetic-human", email: "clyons@ajhcs.org", type: "app", ...claims })
      .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: key === "previous" ? "previous-key" : "current-key", ...header })
      .sign(({ current, previous, outsider })[key].privateKey);
  };
  return { config, issuer, audience, keys, fetcher, sign, calls: () => calls };
}
