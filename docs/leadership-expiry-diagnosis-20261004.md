# Oct4 leadership coverage alert investigation

This is a leadership evidence/coverage gap, not evidence of a whole-site outage. Production99 and its rollout are unchanged. Alert: Gmail message1a1093863d23e2af, last_seen2026-10-04T23:20:25.635Z. Scope is16configured institutions/23monitored public leadership sources, not every regional person or the wider27-institution inventory.

## Actionable findings

The existing26-hour daily freshness allowance is correct and unchanged. Eleven lost institutions reproduce from the23current schedule records; five became lost after their previous successful records expired. Six older acquisition gaps remain. The new expiry times all precede PR24's14:50:48 deployment; the RSS/Ops recovery release did not cause their first expiration.

| Newly lost institution | Recorded last success UTC | Evidence expiry UTC | Latest outcome | Existing next retry UTC | Required action/owner |
|---|---|---|---|---|---|
| Jefferson | Oct3 04:45:32.195 | Oct4 06:45:32.195 | Partial article claim, current affiliation unverified | Oct5 23:15:54.223 | Regional source owner: qualify an actual current scoped profile/roster; preserve historical article separately |
| CHOP | Oct3 08:01:11.035 | Oct4 10:01:11.035 | Four readable pages unrecognized, zero accepted rows | Oct5 02:30:26.038 | Regional parser owner: qualify bounded roster/profile contracts from permitted retained markup at ordinary due time |
| Temple | Oct3 08:01:11.035 | Oct4 10:01:11.035 | Readable page unrecognized | Oct5 02:30:26.038 | Regional parser owner: bind actual Abhinav Rastogi identity and role; reject institution heading as person |
| Inspira | Oct3 08:01:11.035 | Oct4 10:01:11.035 | Readable page unrecognized | Oct5 02:30:26.038 | Regional parser owner: separate name/title/bio fields; never create people named Chief Executive Officer |
| Nemours | Oct3 09:01:09.474 | Oct4 11:01:09.474 |31rows, partial because one carries article provenance | Oct5 03:16:06.345 | Regional parser owner: verify narrowly scoped roster contract and board/regional-role boundaries; retain article claims separately |

Eight bounded D1 SELECTs reported zero rows written. All queried source timestamps precede the alert, so the schedule replay is valid at23:20. One initial read failed because a nonexistent metadata column was selected; it was removed, no write occurred. No source was fetched or retried.

Jefferson's retained2025/05 URL is a historical announcement. The retained116-character readable text is only its title, without a source publication date; one scoped CEO claim is now correctly marked currentAffiliationVerified=false. Its old complete label was inadequate evidence of a current roster. Do not reset freshness, clear the incident or enroll this claim as current affiliation.

CHOP has a real extraction compatibility gap: its prior roster rows include three recognizable people, but current extraction returns zero. Other old profile rows include labels Titles/Certifications/Graduate Degree/Residency as people. Temple's old single person was Temple Health Leadership, with a real person's role in the title field. Inspira's old rows mixed role headings as names with a valid-looking John Saffioti row. Preserve rejection of those false identities; do not roll back strict parsing to restore a green count. New narrow, exact-source contracts require retained raw markup and tests.

Nemours' current31rows contain30rows without article evidence plus one R. Lawrence Moss article-grammar claim. extractionStatus marks any snapshot containing articleEvidence partial; the resulting scheduler failure does not renew last_success_at. This confirms the mechanism of the gap. Whether the generic article heuristic or page markup/embedded content created that row cannot be resolved from clipped normalized text alone. Several retained titles contain escaped markup and one Chair, Board of Directors label remains person-shaped. No complete roster recovery can be claimed from this output. Proposal: exact scoped card/heading extraction; separate executive/board/Delaware Valley roles, strip titles/credentials without merging distinct people, ignore sibling related-news items only under a qualified contract, and preserve explicit document-level article guards.

All eight newly implicated sources have old/new retained normalized-text hashes that match within the storage bound. Most byte counts also match; Inspira's count changes while its clipped text matches. This supports a parser/representation explanation rather than a newly observed network failure, but does not prove byte-identical HTML. Current retained snapshots record nonempty readable pages and parser outcomes, rather than403/timeout. Full raw HTML is unavailable; no early live fetch is justified.

## Counts and scope

16source issues =6older failing sources +8sources across the five newly lost institutions +failed Main Line roster +partial ChristianaCare Anahi profile. Main Line and ChristianaCare remain covered through successful scoped alternatives; St. Luke's, Tower and Virtua also remain current. At this alert evaluation,15sources were deferred by backoff and Jefferson was the1fetched/1failed source. This is not16new network failures.273occurrences count condition evaluations, not requests or people. The six older gaps remain Penn, Cooper, LVHN, Penn Princeton, Penn Doylestown and RWJBarnabas; all their holds remain intact.

## Bounded local implementation

An isolated diagnostic-only candidate adds freshUntilAt and coverageLossReason to runtime institution coverage. Reasons distinguish expired records, never-observed sources and invalid/future success timestamps. Existing coverageLost/state rules, cadence windows, retry deadlines, parser behavior, role gates and source registries remain unchanged. The protected read API and automation runtime projection receive those fields through the existing join. Captured Oct4 replay, Oct3 comparison, exact boundary, invalid/future/cross-institution, input-preservation, protected API serialization and mixed-cadence tests verify the explanation. No source activation, parser qualification, publication or production deployment is included.

Acceptance for later parser work: checksum-bound permitted raw markup from the normal due collection; exact scoped name-role linkage; no label identities, article-to-roster promotion, departure inference from partial content, historical date substitution or cross-region role inference; repeated/independent official evidence before affiliation changes; independent review of the exact patch before rollout. Parent coordinates review; source owner preserves existing due times. A future complete parsed snapshot still does not by itself prove every person is currently affiliated.

No cleanup of existing worktrees, production mutation, retry bypass, security/credential change, model call, external message, collector activation or live source fetch occurred. The PA branch/PR18 and PA403 hold are outside this task. Local tests/implementation run only on BuilderBob; Lenovo is an artifact bridge.

Validation:943full-suite tests passed (797main+146Watch) for the unchanged diagnostic source code; the subsequent final55focused tests include the additional mixed-cadence case and protected API-field assertion. Typecheck/build passed; final secret scan562files passed; diff check passed. Source requests and model calls were blocked by the retained offline guard. All23live source state/attempt/success/retry/failure/error rows compare unchanged before/after diagnosis. Parent coordinates independent review; no PR, merge or deployment is included.
