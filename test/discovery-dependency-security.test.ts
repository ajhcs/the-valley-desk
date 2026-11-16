import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { DiscoveryReferenceManifest, assessDiscoveryReferenceReadiness, discoveryEvaluationDigest } from "../src/ingest/discovery-evaluation";
import { createDiscoverySignedReceiptStore } from "../src/ingest/discovery-reference-signatures";
import { createDiscoveryReferenceReceiptVerifier } from "../src/ingest/discovery-reference-receipts";

// Collection regressions for GHSA-mrhx-c7xc-m3w5 and upstream Zod PR #6652.
// Package metadata alone cannot prove these parser semantics.
// Public synthetic artifacts captured using d7081f8 sources and isolated Zod 3.25.76.
// Keys were ephemeral; only public pins and original signatures are retained. Tests
// never regenerate expectations or signatures with the migrated implementation.
// The capture includes UTC minute timestamps in EX17/EX20 and whitespace-normalized rationale.
const frozenNative = {
  "capturedFrom": "d7081f8 + isolated zod 3.25.76",
  "manifest": {
    "schemaVersion": "discovery-reference-v1",
    "status": "not_frozen",
    "revision": {
      "id": "discovery-reference",
      "revision": 1
    },
    "policy": {
      "id": "discovery-policy",
      "revision": 1
    },
    "rubric": {
      "id": "discovery-reference-rubric",
      "revision": 1
    },
    "design": "wp03-evaluation-design-v1",
    "createdAt": "2026-11-14T00:00:00Z",
    "reviewers": [
      {
        "id": "astra-reviewer-a",
        "authority": {
          "id": "authority-astra-reviewer-a",
          "sha256": "e4ece60f8d00a55a7abae710defa84698a78f705d1d0b650d06f76729c8b1ec3"
        }
      },
      {
        "id": "astra-reviewer-b",
        "authority": {
          "id": "authority-astra-reviewer-b",
          "sha256": "cbc31b2c177469c96c5a5f8678fb1af0b0eb585a1a9d8dbf45e464390d15c514"
        }
      }
    ],
    "sources": [
      {
        "id": "astra-fictional-source",
        "revision": {
          "id": "astra-fictional-source-revision",
          "revision": 1
        },
        "identity": {
          "provider": "github",
          "installation": "github.com",
          "nativeId": "astra-fictional-source",
          "kind": "artifact"
        },
        "originFamilyId": "astra-fictional-origin",
        "observedAt": "2026-11-15T00:00Z",
        "representationSha256": "a92b0a4a2579544e711210a99378cfb1fa5cc486f06793f1a53d9e3fd8d08c92",
        "evidence": {
          "id": "astra-evidence",
          "sha256": "a3a11b89dd58a19dfb427c9f7a4d87115dbc82f0a8bd4fcb0150ddeda6a7e66c"
        },
        "permission": {
          "id": "astra-permission",
          "sha256": "052911c324e9f25bd9570c7b9f73bd791c2d2bd8552beab462a87c80651cfb87"
        }
      }
    ],
    "sampling": {
      "heldout": null,
      "recall": null,
      "audit": null
    },
    "history": null,
    "cases": [
      {
        "id": "astra-fictional-case",
        "partition": "development",
        "claimMode": "work-regional-at-creation",
        "subject": {
          "kind": "artifact",
          "id": "astra-fictional-artifact"
        },
        "primaryRoute": "github",
        "appearances": [
          "github"
        ],
        "counties": [
          "PA:Philadelphia"
        ],
        "countyUnknown": false,
        "families": {
          "people": [
            "astra-person-family"
          ],
          "projects": [
            "astra-project-family"
          ],
          "origins": [
            "astra-fictional-origin"
          ],
          "equivalences": []
        },
        "sourceIds": [
          "astra-fictional-source"
        ],
        "familyReview": {
          "id": "astra-family",
          "sha256": "ae73b6c5f5f8fbe6245a4d2668a78cd8f3cc176985faf5c35efc399d15b58525"
        },
        "annotations": [
          {
            "reviewerId": "astra-reviewer-a",
            "labels": {
              "overall": "eligible",
              "identity": "supported",
              "professionalBasis": "supported",
              "relevance": "supported",
              "currentPresence": "ambiguous",
              "regionalCreation": "supported",
              "creatorRole": "supported",
              "rights": "supported"
            },
            "rationale": "  preserved normalized fictional rationale  ",
            "confidence": "medium",
            "sourceIds": [
              "astra-fictional-source"
            ],
            "rubric": {
              "id": "discovery-reference-rubric",
              "revision": 1
            },
            "recordedAt": "2026-11-15T00:00Z",
            "blindedBatch": {
              "id": "blind-astra-reviewer-a",
              "sha256": "7a5d46fbd3bee36130135c726e7f61a36c652c276da6dc4a6145ec763a8d7363"
            },
            "receipt": {
              "id": "annotation-astra-reviewer-a",
              "sha256": "0acaa720ba4f37fce8ea68b23bc60ec3a689e1d0947f17cc5562fb0a47edefaa"
            }
          },
          {
            "reviewerId": "astra-reviewer-b",
            "labels": {
              "overall": "eligible",
              "identity": "supported",
              "professionalBasis": "supported",
              "relevance": "supported",
              "currentPresence": "ambiguous",
              "regionalCreation": "supported",
              "creatorRole": "supported",
              "rights": "supported"
            },
            "rationale": "PRIVATE-PEER-RATIONALE-astra-reviewer-b",
            "confidence": "medium",
            "sourceIds": [
              "astra-fictional-source"
            ],
            "rubric": {
              "id": "discovery-reference-rubric",
              "revision": 1
            },
            "recordedAt": "2026-11-15T00:00Z",
            "blindedBatch": {
              "id": "blind-astra-reviewer-b",
              "sha256": "1e25a758fc1a2f6a8f266b7c3dabd440873d599576d0723ad9e22e5393911c6b"
            },
            "receipt": {
              "id": "annotation-astra-reviewer-b",
              "sha256": "01ed6340b38f62ee87be467b7fa7d6ce7fdbd7dd827dd749a237aa2b40521437"
            }
          }
        ],
        "adjudication": {
          "reviewerId": "astra-reviewer-a",
          "labels": {
            "overall": "eligible",
            "identity": "supported",
            "professionalBasis": "supported",
            "relevance": "supported",
            "currentPresence": "ambiguous",
            "regionalCreation": "supported",
            "creatorRole": "supported",
            "rights": "supported"
          },
          "rationale": "PRIVATE-ADJUDICATION-RATIONALE",
          "sourceIds": [
            "astra-fictional-source"
          ],
          "rubric": {
            "id": "discovery-reference-rubric",
            "revision": 1
          },
          "recordedAt": "2026-11-15T00:00Z",
          "receipt": {
            "id": "astra-adjudication",
            "sha256": "84e390013fcf632c72f05c14e921b2654a3cf5e96ddcdaf31ab89a88f42cf288"
          }
        },
        "selectionReceipt": {
          "id": "astra-selection",
          "sha256": "6b9dc72dfdc8c8c3b9f86e4d4ef3b6e52650cc447b5f5d829c17c026e45570f9"
        },
        "challenges": []
      }
    ]
  },
  "parsedManifestSha256": "5c01404665deb337f9b74f4714324b9dc0fdc9e75283473d84bcb2d066185c07",
  "policy": {
    "revision": "astra-fictional",
    "validFrom": "2026-01-01T00:00:00Z",
    "validUntil": "2030-01-01T00:00:00Z",
    "keys": [
      {
        "id": "astra-key",
        "algorithm": "Ed25519",
        "spkiHex": "302a300506032b65700321008ade7e632021646c35b39f6d2067121bad9a51508705f7f3459d6e3731984ed8",
        "roles": [
          "receipt",
          "authority"
        ],
        "authorityIds": [
          "astra-authority"
        ],
        "validFrom": "2026-01-01T00:00:00Z",
        "validUntil": "2030-01-01T00:00:00Z",
        "revoked": false
      }
    ],
    "revokedReceiptIds": [],
    "revokedAuthorityIds": []
  },
  "bundle": {
    "receipts": [
      {
        "domain": "discovery-reference-receipt-signature-v1",
        "algorithm": "Ed25519",
        "keyId": "astra-key",
        "payload": {
          "schemaVersion": "discovery-authenticated-receipt-v1",
          "id": "authority-astra-reviewer-a",
          "authorityId": "astra-authority",
          "purpose": "reviewer-authority",
          "subjectId": "astra-reviewer-a",
          "contentSha256": "84f1fd7c0acbef1cbcf1878b4a1aaa9fa182d312af981c35de33444b79497a7f",
          "principalId": "astra-reviewer-a",
          "issuedAt": "2026-01-01T00:00:00Z",
          "expiresAt": "2030-01-01T00:00:00Z"
        },
        "signatureHex": "66130ba85c81221c45e7c9797c30bdc5ef83a38d6e0448615b8c8f75aec940e634782c71c57e4a0d7e561befb95635bb0be0427ff292267aa9f1f5e4bc97180b"
      },
      {
        "domain": "discovery-reference-receipt-signature-v1",
        "algorithm": "Ed25519",
        "keyId": "astra-key",
        "payload": {
          "schemaVersion": "discovery-authenticated-receipt-v1",
          "id": "authority-astra-reviewer-b",
          "authorityId": "astra-authority",
          "purpose": "reviewer-authority",
          "subjectId": "astra-reviewer-b",
          "contentSha256": "517af0f9c67981136dbde3b3be7c75b95388f36dc5017e9b2e532f90c498e211",
          "principalId": "astra-reviewer-b",
          "issuedAt": "2026-01-01T00:00:00Z",
          "expiresAt": "2030-01-01T00:00:00Z"
        },
        "signatureHex": "57af80ff493f9c15668946f482f2927eccacb2c24321ec056e38dff7203a5b93a5422ad2371e4f43cde0c66f519089a1d65e13bc0c65c0d1bc386a9d543f780d"
      },
      {
        "domain": "discovery-reference-receipt-signature-v1",
        "algorithm": "Ed25519",
        "keyId": "astra-key",
        "payload": {
          "schemaVersion": "discovery-authenticated-receipt-v1",
          "id": "astra-evidence",
          "authorityId": "astra-authority",
          "purpose": "evidence",
          "subjectId": "astra-fictional-source",
          "contentSha256": "538a0b4754878b25fe45d674c1c8a934da4f5204c3a1400454a5fe6acbb041ca",
          "principalId": null,
          "issuedAt": "2026-01-01T00:00:00Z",
          "expiresAt": "2030-01-01T00:00:00Z"
        },
        "signatureHex": "5410eeb6cd3bf2d86ae922f14e86f34162e14bcf9c425090794d693b8d674ceedb49f9b5c5ee59e4a0566b81f0c82df60e4c39bad4bd1518acb679f817da7c0a"
      },
      {
        "domain": "discovery-reference-receipt-signature-v1",
        "algorithm": "Ed25519",
        "keyId": "astra-key",
        "payload": {
          "schemaVersion": "discovery-authenticated-receipt-v1",
          "id": "astra-permission",
          "authorityId": "astra-authority",
          "purpose": "permission",
          "subjectId": "astra-fictional-source",
          "contentSha256": "fd40daff5f607fd2a0ea157ac391fea1f7c960a7d9990e8a747e3ed0ebed0229",
          "principalId": null,
          "issuedAt": "2026-01-01T00:00:00Z",
          "expiresAt": "2030-01-01T00:00:00Z"
        },
        "signatureHex": "469df783bf764530654e0924928a07ad0aacd0294c8d15375951cef17676801416d2ed61f198d133293853f74290396570dfa11d2bf1b683d8edb9018b45cb0b"
      },
      {
        "domain": "discovery-reference-receipt-signature-v1",
        "algorithm": "Ed25519",
        "keyId": "astra-key",
        "payload": {
          "schemaVersion": "discovery-authenticated-receipt-v1",
          "id": "astra-family",
          "authorityId": "astra-authority",
          "purpose": "family-review",
          "subjectId": "astra-fictional-case",
          "contentSha256": "6ec64a663d06f64ccb8bb947202ed08f6bcb439d00d3c7baf13239573bbdff54",
          "principalId": null,
          "issuedAt": "2026-01-01T00:00:00Z",
          "expiresAt": "2030-01-01T00:00:00Z"
        },
        "signatureHex": "769f5ce448df7b3f817be239426b6458a2a208ef6b059881e7771802947d2a84ac0e50c8681b8f74138a86c637d0a701205950f5ef450222b80ab97d5b32c00d"
      },
      {
        "domain": "discovery-reference-receipt-signature-v1",
        "algorithm": "Ed25519",
        "keyId": "astra-key",
        "payload": {
          "schemaVersion": "discovery-authenticated-receipt-v1",
          "id": "astra-selection",
          "authorityId": "astra-authority",
          "purpose": "selection",
          "subjectId": "astra-fictional-case",
          "contentSha256": "a254a8fd30b91e6784f40aeb7cd65d5e5fd2a7a880a98901b5cce4db2e8d66f2",
          "principalId": null,
          "issuedAt": "2026-01-01T00:00:00Z",
          "expiresAt": "2030-01-01T00:00:00Z"
        },
        "signatureHex": "160bc7c8e6f17cea538cf5bef6b33e135960588f25feccb4cb49e74783d9ed8079431f0f449605f2e825600ffb84cab1dd9fdd2b62282314a4c792961678bd0c"
      },
      {
        "domain": "discovery-reference-receipt-signature-v1",
        "algorithm": "Ed25519",
        "keyId": "astra-key",
        "payload": {
          "schemaVersion": "discovery-authenticated-receipt-v1",
          "id": "annotation-astra-reviewer-a",
          "authorityId": "astra-authority",
          "purpose": "independent-annotation",
          "subjectId": "astra-fictional-case",
          "contentSha256": "56bc44c6713b7c343f1f517919b771e23d2cf1010cfc0672c8948cca7c5a29bf",
          "principalId": "astra-reviewer-a",
          "issuedAt": "2026-01-01T00:00:00Z",
          "expiresAt": "2030-01-01T00:00:00Z"
        },
        "signatureHex": "fc9c9998e02a2b41cd6326e2f89c57e0dc52befc50915ad87bf8b320483a67344d99a6d0c123ded7dc3f1f7442330b0d8d94dd4b47afdcc0436a12e513499109"
      },
      {
        "domain": "discovery-reference-receipt-signature-v1",
        "algorithm": "Ed25519",
        "keyId": "astra-key",
        "payload": {
          "schemaVersion": "discovery-authenticated-receipt-v1",
          "id": "blind-astra-reviewer-a",
          "authorityId": "astra-authority",
          "purpose": "blinding",
          "subjectId": "astra-fictional-case",
          "contentSha256": "ea9fc8727071db7846852a6f327091af634d113b08a4288dbb8e141240f4cc74",
          "principalId": "astra-reviewer-a",
          "issuedAt": "2026-01-01T00:00:00Z",
          "expiresAt": "2030-01-01T00:00:00Z"
        },
        "signatureHex": "8e56f2bb0b1ca20194ceb3247cd4d4645ab4f53c6f75f45d9560b6bb09126b940ef63daf072073b3cb5986117b6b11a3165252007b83159d0a26df00811e7f09"
      },
      {
        "domain": "discovery-reference-receipt-signature-v1",
        "algorithm": "Ed25519",
        "keyId": "astra-key",
        "payload": {
          "schemaVersion": "discovery-authenticated-receipt-v1",
          "id": "annotation-astra-reviewer-b",
          "authorityId": "astra-authority",
          "purpose": "independent-annotation",
          "subjectId": "astra-fictional-case",
          "contentSha256": "92fa23c3e887f8c2b39369b9908701a40f5f4119703cf5aabc15e4f2ae7030e1",
          "principalId": "astra-reviewer-b",
          "issuedAt": "2026-01-01T00:00:00Z",
          "expiresAt": "2030-01-01T00:00:00Z"
        },
        "signatureHex": "b83458b5d32e2db88442ba9bf524e680b1867452e8c5681e3f1411d1a7361bfbd65b585dc3db269452a1b50280a560406f1ed53ac3c45fc36d9ae09be1f41701"
      },
      {
        "domain": "discovery-reference-receipt-signature-v1",
        "algorithm": "Ed25519",
        "keyId": "astra-key",
        "payload": {
          "schemaVersion": "discovery-authenticated-receipt-v1",
          "id": "blind-astra-reviewer-b",
          "authorityId": "astra-authority",
          "purpose": "blinding",
          "subjectId": "astra-fictional-case",
          "contentSha256": "c3509efb5f8c2c60c41a82dec51dc40d76779d9c29c5079f02b19558934265a0",
          "principalId": "astra-reviewer-b",
          "issuedAt": "2026-01-01T00:00:00Z",
          "expiresAt": "2030-01-01T00:00:00Z"
        },
        "signatureHex": "224bed1ed034a4af6d3f8bae68fbeac093ed66c44b5280dafc330af7e4b3515d9eea232f537367dc508d659c0e5a8f93733c83265f1a812ad6a04e4703c44507"
      },
      {
        "domain": "discovery-reference-receipt-signature-v1",
        "algorithm": "Ed25519",
        "keyId": "astra-key",
        "payload": {
          "schemaVersion": "discovery-authenticated-receipt-v1",
          "id": "astra-adjudication",
          "authorityId": "astra-authority",
          "purpose": "adjudication",
          "subjectId": "astra-fictional-case",
          "contentSha256": "ca699f089975903561a6bc1cb2fbb89cfde2461410474c320d2b583d7c7247a9",
          "principalId": "astra-reviewer-a",
          "issuedAt": "2026-01-01T00:00:00Z",
          "expiresAt": "2030-01-01T00:00:00Z"
        },
        "signatureHex": "ac46ea4a89eec48d2c52247118eff506c5c8ec137aaef5b3f2351e4257833422990061ad0f8d75e81aa0da76f436f279bcfd21f430834146dd5f6dfb8f3eb905"
      }
    ],
    "authorities": [
      {
        "domain": "discovery-reference-authority-signature-v1",
        "algorithm": "Ed25519",
        "keyId": "astra-key",
        "payload": {
          "schemaVersion": "discovery-authority-statement-v1",
          "issuedAt": "2026-01-01T00:00:00Z",
          "expiresAt": "2030-01-01T00:00:00Z",
          "authority": {
            "id": "astra-authority",
            "purposes": [
              "reviewer-authority",
              "evidence",
              "permission",
              "sampling",
              "family-review",
              "independent-annotation",
              "blinding",
              "adjudication",
              "selection",
              "history",
              "exposure"
            ],
            "principals": [
              null,
              "astra-reviewer-a",
              "astra-reviewer-b"
            ],
            "validFrom": "2026-01-01T00:00:00Z",
            "validUntil": "2030-01-01T00:00:00Z",
            "revoked": false
          }
        },
        "signatureHex": "96bee06763a8a347286664e6dc66e0e78fe5ee217c0f4278d65d6aa163866f03f8d1601601e159ba8fff0c92b9f1a74e56b981f159e63825f6644d2a686edf0d"
      }
    ]
  }
};
const now = () => Date.parse("2026-11-15T00:00:00Z");
const verifier = async () => createDiscoveryReferenceReceiptVerifier(
  await createDiscoverySignedReceiptStore(frozenNative.policy, frozenNative.bundle, now), now);

test("patched arrays bound invalid issues before walking oversized max/length inputs", async () => {
  for (const bound of ["max", "length"] as const) {
    const schema = z.array(z.string())[bound](2);
    for (const result of [schema.safeParse(Array(1000).fill(0)), await schema.safeParseAsync(Array(1000).fill(0))]) {
      assert.equal(result.success, false);
      if (result.success) throw new Error("oversized array accepted");
      assert.equal(result.error.issues.length, 1);
      assert.equal(result.error.issues[0]!.code, "too_big");
    }
    assert.deepEqual(schema.parse(["first", "second"]), ["first", "second"]);
  }
});

test("oversized arrays skip child transforms and parent refinements in both parse modes", async () => {
  for (const asyncMode of [false, true]) {
    let children = 0, parents = 0;
    const child = asyncMode
      ? z.number().transform(async value => { children++; return value + 1; })
      : z.number().transform(value => { children++; return value + 1; });
    const schema = z.object({ rows: z.array(child).max(2) }).superRefine(() => { parents++; });
    const result = asyncMode ? await schema.safeParseAsync({ rows: [1, 2, 3] }) : schema.safeParse({ rows: [1, 2, 3] });
    assert.equal(result.success, false); assert.equal(children, 0); assert.equal(parents, 0);
    const good = asyncMode ? await schema.parseAsync({ rows: [1, 2] }) : schema.parse({ rows: [1, 2] });
    assert.deepEqual(good, { rows: [2, 3] }); assert.equal(children, 2); assert.equal(parents, 1);
  }
});

test("patched set and map bounds reject before validating entries", async () => {
  for (const schema of [z.set(z.string()).max(2), z.set(z.string()).size(2)]) {
    const result = await schema.safeParseAsync(new Set([1, 2, 3]));
    assert.equal(result.success, false);
    if (result.success) throw new Error("oversized set accepted");
    assert.equal(result.error.issues.length, 1); assert.equal(result.error.issues[0]!.code, "too_big");
    assert.deepEqual(schema.parse(new Set(["first", "second"])), new Set(["first", "second"]));
  }
  let visited = 0;
  const schema = z.map(z.string(), z.number().transform(value => { visited++; return value; })).max(2);
  const result = schema.safeParse(new Map([["a", 1], ["b", 2], ["c", 3]]));
  assert.equal(result.success, false); assert.equal(visited, 0);
  if (result.success) throw new Error("oversized map accepted");
  assert.equal(result.error.issues.length, 1); assert.equal(result.error.issues[0]!.code, "too_big");
  assert.deepEqual(schema.parse(new Map([["a", 1]])), new Map([["a", 1]])); assert.equal(visited, 1);
});

test("native manifest bounds reject before nested case parsing", () => {
  const oversized = { ...frozenNative.manifest, cases: Array(10001).fill(null) };
  const result = DiscoveryReferenceManifest.safeParse(oversized);
  assert.equal(result.success, false);
  if (result.success) throw new Error("oversized manifest accepted");
  assert.deepEqual(result.error.issues.map(issue => ({ code: issue.code, path: issue.path })), [{ code: "too_big", path: ["cases"] }]);
});

test("pre-migration native normalization, receipt references and all EX17/EX20 signatures remain valid", async () => {
  const parsed = DiscoveryReferenceManifest.parse(frozenNative.manifest);
  assert.equal(parsed.cases[0]!.annotations[0]!.rationale, "preserved normalized fictional rationale");
  assert.equal(await discoveryEvaluationDigest(parsed), frozenNative.parsedManifestSha256);
  const result = await assessDiscoveryReferenceReadiness(frozenNative.manifest, await verifier());
  assert.ok(!result.findings.some(finding => finding.startsWith("unverified:")), result.findings.join("\n"));
  assert.equal(result.status, "not_frozen"); assert.equal(result.readiness, "blocked");
});

test("native strict schemas do not default missing required trust or review data", () => {
  for (const mutate of [
    (m: Record<string, any>) => { m.injected = "unknown"; },
    (m: Record<string, any>) => { delete m.reviewers; },
    (m: Record<string, any>) => { m.status = "frozen"; },
    (m: Record<string, any>) => { delete m.cases[0].annotations[0].labels.rights; },
    (m: Record<string, any>) => { m.cases[0].annotations[0].recordedAt = "not-an-instant"; },
    (m: Record<string, any>) => { m.revision.revision = Number.MAX_SAFE_INTEGER + 1; },
    (m: Record<string, any>) => { m.cases[0].annotations[0].extra = "unknown"; },
  ]) {
    const changed = structuredClone(frozenNative.manifest); mutate(changed);
    assert.equal(DiscoveryReferenceManifest.safeParse(changed).success, false);
  }
});

test("frozen pre-migration label signatures reject context drift and changed disagreement", async () => {
  const verify = await verifier();
  for (const mutate of [
    (m: typeof frozenNative.manifest) => { m.policy.revision++; },
    (m: typeof frozenNative.manifest) => { m.rubric.revision++; },
    (m: typeof frozenNative.manifest) => { m.cases[0]!.subject.id = "other-subject"; },
    (m: typeof frozenNative.manifest) => { m.sources[0]!.revision.revision++; },
  ]) {
    const changed = structuredClone(frozenNative.manifest); mutate(changed);
    const result = await assessDiscoveryReferenceReadiness(changed, verify);
    for (const purpose of ["selection", "independent-annotation", "blinding", "adjudication"])
      assert.ok(result.findings.includes(`unverified:${purpose}:astra-fictional-case`), purpose);
  }
  const changed = structuredClone(frozenNative.manifest);
  changed.cases[0]!.annotations[1]!.labels.overall = "ineligible";
  const result = await assessDiscoveryReferenceReadiness(changed, verify);
  assert.ok(result.findings.includes("unverified:independent-annotation:astra-fictional-case"));
  assert.ok(result.findings.includes("unverified:adjudication:astra-fictional-case"));
});

test("production source and scripts cannot escape to the unpatched v3 compatibility parser", async () => {
  const files: string[] = [];
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) files.push(path);
    }
  };
  await walk("src"); await walk("scripts");
  for (const path of files) assert.ok(!/['"]zod\/v3(?:\/[^'"]*)?['"]/.test(await readFile(path, "utf8")), path);
});
