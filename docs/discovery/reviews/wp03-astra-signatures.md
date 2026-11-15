# WP03 signed receipt increment — Astra independent review

Disposition: no blocking defect found in the reviewed signed-store implementation. Root owns integration acceptance; WP03 remains incomplete and `not_frozen`.

Reviewed implementation SHA-256: `fdf45e6995a0e2d4e1675600d34254d36caeb9c0c52e3c683153ce5668e7b9d0` (`src/ingest/discovery-reference-signatures.ts`). This is the reviewed candidate, not a promise that later bytes are unchanged.

The implementation parses and detaches policy and record inputs before its first asynchronous operation. Strict record/envelope schemas, separately supplied operator pins, pinned Ed25519 SPKI keys, domain/key/algorithm-bound signing preimages, role/authority restrictions, signed authority statements, expiry checks and post-verification clock checks preserve the intended trust boundary. Returned records are cloned. Authority purpose/principal/time restrictions are checked before a receipt can become an authenticated store result.

Independent probe `.discovery-work/wp09-astra/signature-probe.ts` passed 10 checks under qualified Node 22.23.2, empty inherited environment, unchanged HOME, workspace TMP/XDG/npm cache, and no networking: valid record; six signed-field substitutions; mutation of original policy/bundle after asynchronous construction starts; mutation of a returned record; rejection at exact expiry. Output is retained in `signature-probe.log`. Terra owns the complementary permanent acceptance suite.

The policy is an operator-supplied, bounded-lived revocation snapshot. Re-instantiating the store is required when pins or revocations change; this is not a live revocation service, independently enrolled operator, authenticated human reviewer or proof of source truth. Valid signatures cannot freeze the corpus. The zero-case reference manifest, missing independent adjudication and real source permissions still block WP03/WP14.

Final re-review independently exercised the root bounded-input preflight and Terra signed-authority interval correction. `signature-final-probe.ts` passed 16 checks, including all earlier checks plus a receipt outside the narrower signed grant, getter nonexecution, cyclic input, sparse arrays, oversized input and inherited object prototypes. Output is retained in `signature-final-probe.log`. The earlier ten-check candidate result remains retained. No blocker remains in these final reviewed bytes.
