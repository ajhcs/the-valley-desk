# WP03 label context binding — independent review

2026-11-15. This review covers the versioned annotation, blinding and adjudication context correction; it does not accept WP03 or freeze a corpus.

Before the change, a genuine signed-store synthetic fixture remained ready for accountable freeze review after its case subject, claim mode, source version and representation changed, even though both original annotations, blinding records and adjudication were retained. The original synthetic reproduction is `.discovery-work/wp12-wp03-terra/audit.ts` (SHA-256 `c4038d36e8141d7cce3410b091b14528c0b34919779c86cd1b6cf025c7b314c8`). No actual reviewers or cases were used.

The implementation binds all three versioned receipt purposes to the digest of the same case, source and manifest review context used for selection. Adjudication additionally binds the original annotation payloads and receipt/blinding references. The context excludes those review receipts, avoiding a circular hash dependency. Legacy payloads have no fallback and require accountable re-review and new attestation.

The independent test builds a 561-case fictional corpus and authenticates every receipt with an ephemeral Ed25519 store. It checks unchanged baseline, subject/claim/policy/source changes with original annotation, blinding and adjudication envelopes retained byte-for-byte, signed legacy payloads for all three purposes, changed independent disagreement with stale adjudication, and fully re-attested readiness. The final outcome remains `not_frozen`. Both this test and the earlier case-binding regression passed under sanitized workspace Node 22: 2 tests, 0 failures.

The new context extends the synthetic receipt dependency chain. The prior four-round fixture builder yielded a blocked baseline; its test-only builder was changed to eight rounds, with the failure summarized in `.discovery-work/wp12-wp03-terra/original-fixture-failure.txt` (SHA-256 `aa223ae7041c92a82ab947ccde36ced140324cda6c7c296d5aecefb7b4ac40ab`). This is fixture construction, not a legacy receipt compatibility path.

Reviewed SHA-256: implementation `678353d5066f5d8326b65ad5bea3bb249ab4143cc70214cd41e4330dd1194f02`; new label-binding test `971d165f5f1c4f62cc5f18af1413ac26d16778d3e8c16b1ea97fcace7d575623`; updated case-binding fixture test `bdf2234aab0ac71cab1890706a04a16982a93d47dab18ffbafbc593c7ccda547`.

No blocking defect found in this bounded review. Source truth, real independent reviewers, rights, trust enrollment and accountable freeze remain unestablished. The real corpus remains empty, WP03 incomplete, and E01–E05 not run. The orchestrator decides acceptance.
