# WP13 institutional and creator discovery — Astra independent review

Disposition: recommend accepting the reviewed software increment after root's integration checks. No remaining implementation blocker found at the hash below. Full WP13 acceptance remains ungranted: actual source qualification, access, rights and real directory/origin evidence are absent. Root owns acceptance.

## Initial contract challenge

Creator-first candidates must preserve professional basis, dated actual-unit location and role independently of institution headquarters, residence or service area. A regional publisher or adopter does not establish regional authorship. County evidence needs the county/state relationship and the accepted nine-county vocabulary. Historic or undated biographies remain evidence with unknown current employment; an as-of date alone is not a current-employment admission.

Declared feed and navigation links remain proposals unless the endpoint is separately qualified. No guessed feed paths, host expansion or whole-site crawling follow from a biography. Explicit directory denominators and pagination gaps are necessary to distinguish incomplete observation from complete membership.

Mirrored biographies share a provenance origin only under reviewed origin/equivalence authority. Matching names, text, IDs supplied by the page, or linked professional identifiers alone cannot establish person or work equivalence. Publisher, creator and adoption relationships stay distinct and review-only.

WP07 commits original acquisition bytes after successful parsing. The adapter must reject a complete response containing excluded private contact fields before commit; a redacted projection or per-record rejection does not prevent retention of those bytes. Unknown structures and excluded records require the same privacy boundary as projected records.

## Findings closed and independent evidence

The initial source skipped hidden subtrees and checked only selected field excerpts, which could retain excluded bytes. It now rejects unsupported whole-document markup before record-level handling, checks raw and decoded text/attributes and concatenated split text, and rejects credential/query-bearing links outside exact registered pagination. Unsupported stylesheet/meta semantics and response Link headers fail closed. This deliberately narrow passive HTML contract is not a general detector of sensitive facts expressed in prose; real source and retention qualification remains necessary.

Source versioning initially included HTML offsets and runtime temporal assessments. The final semantic hash excludes offsets, raw formatting and clock-derived status while preserving exact spans separately. Native identities now include the actual page endpoint and document-local card ID, so reused HTML IDs on different pages do not merge. Configured origin proposals cannot change that identity; the optional origin-count seam delegates to reviewed WP05 evidence without a caller-count/text-match fallback.

Forty-eight independent cases passed on the final recovery fix: 28 synthetic resolver projection tests, 14 tests over Terra's authentic local-D1 two-page snapshot, and six over its final three-page snapshot. They cover unmapped/encoded/split contacts, private attributes/hidden markup/scripts/comments, phone and credential links, external stylesheet rejection, stable source versions under movement and aging, actual-unit versus headquarters/residence/service-area roles, out-of-region county and unknown expiry, unresolved mirror proposals, unknown roster/off-scope navigation, fixed-query rejection, two-page distinct IDs, partial-roster replay without a live plan, query/window/parent/clock binding, missing/corrupt ancestry, future commits, response Link rejection and async input mutation. The supplemental six confirm third-page projection/replay preserves partial coverage, rejected continuation query hash, live and replay rejection after earliest-ancestor removal, and rejection of corrupted earliest bytes.

Earlier attempts remain in `.discovery-work/wp12-astra/`: an entity-contact check ran after the owner had already fixed it and correctly rejected; the first projection probe expected an off-scope query link to produce a gap, but the final query-retention rule correctly rejects the response; the first chain probe assumed complete coverage, while the authentic snapshot intentionally contains fewer rows than its roster denominator. Corrected probes assert those narrower guarantees. No source failure was suppressed.

Reviewed SHA-256:

- `src/ingest/discovery/institutional.ts`: `71036db7a7886e01afa750b15fa19b3267450763bec6e23d2d6388a620c41287`
- `.discovery-work/wp12-astra/institutional-probe.ts`: `77130628a161f3ed56d403872b4ff828fb1f0e1b1640c5122100e4125900434f`
- `.discovery-work/wp12-astra/institutional-chain-probe.ts`: `a0df8f8b0b377c85bde648e5619874a6c34861e0e9b05aa7f231fb51ee64d7fb`

Final recovery-fix outputs are `institutional-recovery-final.log` and `institutional-chain-recovery.log`; authentic snapshot input is `.discovery-work/wp12-terra/wp13-truth-snapshot-4189918.json`. The snapshot probes do not replace Terra's actual database/runtime tests. All material was synthetic; no live collection, enrollment, installation or deployment occurred.

Supplemental recovery-fix output is `.discovery-work/wp12-astra/three-page-recovery.log`, using `.discovery-work/wp12-terra/wp13-truth-snapshot-4193249.json`. Shared probe `three-page-probe.ts` has SHA-256 `2774f16380139844a09a12fb47dd7842c29388cd100c72ec4a992b875683a144`.

## Late HTML recovery blocker and narrow fix

Root identified an HTML recovery path missed by the earlier inspection: appending `</p title="private&#64;example.org">` outside mapped records caused parse5 to discard the end-tag attribute before the DOM privacy walk. Independent reproduction at prior source hash `920880957ad9a67e7475281cd3b18ef4b9327012386f0196f4cfc91e63cac778` returned a successful terminal draft with those excluded raw bytes still present. This supersedes the earlier no-blocker recommendation for that hash. The successful reproduction is retained in `.discovery-work/wp12-astra/institutional-dropped-attribute-before.ts` and its log.

Under root's explicit narrow authorization, Astra changed only this adapter to reject every parse5 diagnostic except `missingDoctype` before projection. Doctypes with a non-HTML name or nonempty public/system identifier also reject. The former duplicate-attribute-only check is subsumed by this rule. Five added probes confirm dropped end-tag attributes, null numeric entities, unsupported legacy system doctypes and unknown named entities reject, while an omitted doctype remains accepted. All prior 43 checks reran successfully, and the app TypeScript check passed (`institutional-recovery-tsc.log`).

The final software recommendation applies only to `71036db7a7886e01afa750b15fa19b3267450763bec6e23d2d6388a620c41287`, subject to Terra's permanent actual-D1 canary and root's affected integration qualification. Earlier qualification logs remain preserved rather than being relabeled as evidence for this fix. No other module, migration, dependency or feature was changed by this correction.
