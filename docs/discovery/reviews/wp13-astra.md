# WP13 institutional and creator discovery — Astra independent review

Disposition: recommend accepting the reviewed software increment after root's integration checks. No remaining implementation blocker found at the hash below. Full WP13 acceptance remains ungranted: qualification of an actual supported directory, its access/retention rights and real directory/origin evidence remain outstanding. The separate ROR CC0 observation below does not satisfy that HTML-adapter qualification. Root owns acceptance.

## Initial contract challenge

Creator-first candidates must preserve professional basis, dated actual-unit location and role independently of institution headquarters, residence or service area. A regional publisher or adopter does not establish regional authorship. County evidence needs the county/state relationship and the accepted nine-county vocabulary. Historic or undated biographies remain evidence with unknown current employment; an as-of date alone is not a current-employment admission.

Declared feed and navigation links remain proposals unless the endpoint is separately qualified. No guessed feed paths, host expansion or whole-site crawling follow from a biography. Explicit directory denominators and pagination gaps are necessary to distinguish incomplete observation from complete membership.

Mirrored biographies share a provenance origin only under reviewed origin/equivalence authority. Matching names, text, IDs supplied by the page, or linked professional identifiers alone cannot establish person or work equivalence. Publisher, creator and adoption relationships stay distinct and review-only.

WP07 commits original acquisition bytes after successful parsing. The adapter must reject a complete response containing excluded private contact fields before commit; a redacted projection or per-record rejection does not prevent retention of those bytes. Unknown structures and excluded records require the same privacy boundary as projected records.

## Findings closed and independent evidence

The initial source skipped hidden subtrees and checked only selected field excerpts, which could retain excluded bytes. It now rejects unsupported whole-document markup before record-level handling, checks raw and decoded text/attributes and concatenated split text, and rejects credential/query-bearing links outside exact registered pagination. Unsupported stylesheet/meta semantics and response Link headers fail closed. This deliberately narrow passive HTML contract is not a general detector of sensitive facts expressed in prose; real source and retention qualification remains necessary.

Source versioning initially included HTML offsets and runtime temporal assessments. The final semantic hash excludes offsets, raw formatting and clock-derived status while preserving exact spans separately. Native identities now include the actual page endpoint and document-local card ID, so reused HTML IDs on different pages do not merge. Configured origin proposals cannot change that identity; the optional origin-count seam delegates to reviewed WP05 evidence without a caller-count/text-match fallback.

Fifty-five independent cases passed on the final format fix: 35 synthetic resolver projection tests, 14 tests over Terra's authentic local-D1 two-page snapshot, and six over its final three-page snapshot. They cover unmapped/encoded/split contacts, private attributes/hidden markup/scripts/comments, phone and credential links, external stylesheet rejection, stable source versions under movement and aging, actual-unit versus headquarters/residence/service-area roles, out-of-region county and unknown expiry, unresolved mirror proposals, unknown roster/off-scope navigation, fixed-query rejection, two-page distinct IDs, partial-roster replay without a live plan, query/window/parent/clock binding, missing/corrupt ancestry, future commits, response Link rejection and async input mutation. The supplemental six confirm third-page projection/replay preserves partial coverage, rejected continuation query hash, live and replay rejection after earliest-ancestor removal, and rejection of corrupted earliest bytes.

Earlier attempts remain in `.discovery-work/wp12-astra/`: an entity-contact check ran after the owner had already fixed it and correctly rejected; the first projection probe expected an off-scope query link to produce a gap, but the final query-retention rule correctly rejects the response; the first chain probe assumed complete coverage, while the authentic snapshot intentionally contains fewer rows than its roster denominator. Corrected probes assert those narrower guarantees. No source failure was suppressed.

Reviewed SHA-256:

- `src/ingest/discovery/institutional.ts`: `b975fb44afaac237a647ed8f39afd9d8f52e5c0576fdb79878c75d2f479a8a83`
- `.discovery-work/wp12-astra/institutional-probe.ts`: `a644ba26364129b3bb6d9d99c39d24cde53903f1483f22a35669f058aa2d700c`
- `.discovery-work/wp12-astra/institutional-chain-probe.ts`: `a0df8f8b0b377c85bde648e5619874a6c34861e0e9b05aa7f231fb51ee64d7fb`

Final format-fix outputs are `institutional-format-final.log` and `institutional-chain-format.log`; authentic snapshot input is `.discovery-work/wp12-terra/wp13-truth-snapshot-4189918.json`. The snapshot probes do not replace Terra's actual database/runtime tests. The original 48-check review used synthetic material only. The seven format checks added below include an explicitly approved real CC0 ROR capture in synthetic resolver fixtures; no registry enrollment, installation or deployment occurred.

Supplemental format-fix output is `.discovery-work/wp12-astra/three-page-format.log`, using `.discovery-work/wp12-terra/wp13-truth-snapshot-4193249.json`. Shared probe `three-page-probe.ts` has SHA-256 `2774f16380139844a09a12fb47dd7842c29388cd100c72ec4a992b875683a144`.

## Late HTML recovery blocker and narrow fix

Root identified an HTML recovery path missed by the earlier inspection: appending `</p title="private&#64;example.org">` outside mapped records caused parse5 to discard the end-tag attribute before the DOM privacy walk. Independent reproduction at prior source hash `920880957ad9a67e7475281cd3b18ef4b9327012386f0196f4cfc91e63cac778` returned a successful terminal draft with those excluded raw bytes still present. This supersedes the earlier no-blocker recommendation for that hash. The successful reproduction is retained in `.discovery-work/wp12-astra/institutional-dropped-attribute-before.ts` and its log.

Under root's explicit narrow authorization, Astra changed only this adapter to reject every parse5 diagnostic except `missingDoctype` before projection. Doctypes with a non-HTML name or nonempty public/system identifier also reject. The former duplicate-attribute-only check is subsumed by this rule. Five added probes confirm dropped end-tag attributes, null numeric entities, unsupported legacy system doctypes and unknown named entities reject, while an omitted doctype remains accepted. All prior 43 checks reran successfully, and the app TypeScript check passed (`institutional-recovery-tsc.log`).

The recovery-fix recommendation applied to `71036db7a7886e01afa750b15fa19b3267450763bec6e23d2d6388a620c41287`; the subsequent format correction below supersedes that source hash. Earlier qualification logs remain preserved rather than being relabeled as evidence for this fix. No other module, migration, dependency or feature was changed by this correction.

## Real-source qualification format check

Under root's authorized CC0 evidence review, the unchanged 2,123-byte ROR Penn JSON capture (`3f61195d95153df4cd882655b5397e0e50823c2daa2332b107b7bb61dc4823c6`) was tested only as input to synthetic HTML resolver fixtures. At the preceding hash it already rejected because a decoded URL failed canonical URL validation. It did **not** demonstrate real-source false healthy-empty behavior; `institutional-native-json-before.log` preserves that result.

A separate synthetic reproduction did confirm the generic format gap: plain JSON and ordinary text produced zero leads and `terminal: true` under a zero roster, or an incomplete draft under an unknown roster. `institutional-plain-format-before.log` retains both outcomes. Under root's explicit targeted authorization, the only further source change requires the first non-BOM/whitespace character to be `<` after fatal UTF-8 decoding, otherwise returning the fixed `discovery-institutional-unsupported-format` code. Existing structural/privacy checks still apply after that guard.

Seven added checks cover synthetic JSON, plain text and the exact unchanged ROR bytes at both zero/unknown roster totals, plus valid empty HTML after BOM/whitespace. All reject non-HTML with the fixed code; valid empty HTML remains complete under a zero roster. All prior 48 checks and app TypeScript compilation reran successfully. Final reviewed source is `b975fb44afaac237a647ed8f39afd9d8f52e5c0576fdb79878c75d2f479a8a83`, pending root's affected integration checks and Terra's permanent actual-D1 regression. This is a lexical format guard, not HTTP MIME verification, a native ROR adapter, real registry enrollment or a reference-truth assertion.
