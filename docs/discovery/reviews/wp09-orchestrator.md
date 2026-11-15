# WP09 orchestrator review

Status: independent review passed; final integrated checks pending. Root owns
acceptance, commits and the draft PR. Deployment remains prohibited.

WP06/WP07 dependencies were accepted before work. Their exact runtime bytes,
shared catalog/evidence schemas and all 44 migrations remain unchanged. The
Wistar manual implementation remains a compatibility reference. Sol implements
PubMed; Terra independently tests actual D1; Astra reviews and probes the code.
Root owns test enumeration, integration and status. A separate Sol/Terra pair and
Astra review the parallel WP03 signature increment.

| Finding | Required repair and observed evidence |
| --- | --- |
| County names and legacy core geography could qualify Maryland or Delaware | Accepted DISCOVERY_COUNTY_KEYS only; county/state relation in the same address statement; Mercer/NJ positive and namesake/outside/substring negatives. |
| Mixed XML text was reordered by the shared projection | Explicit rejection; no source wording synthesized. Supported plain/partial-date metadata remains available. |
| Short search pages advanced by a full page and skipped unseen IDs | Reject inconsistent retmax/count/offset/ID sets before retention. |
| Mutable parent lookup could rebind fetch after restart | Content-derived qualified scope ID and deterministic fetch source ID commit to genuine search receipt/request/body/scope/query/window/offset/IDs; every source/plan/parse resolution checks the commitment. |
| Search cap prevented fetching valid returned records or could hide a gap | Permit exact valid batch, preserve inherited search-cap and inventoryComplete=false; batch completion never means whole inventory completion. |
| Unknown date literal could expose contact email | Redact source date reported strings as well as names/title/affiliations; independent email probe passes. |
| Budget recovery could evade a cap by using another source ID | Same deterministic source ID, explicit requalification at revision2/new budget window/new cohort; original charges remain. |
| New signature input cap followed deep cloning and counted characters | UTF-8 aggregate preflight first; reject cycles/accessors/nonplain/sparse shapes before cloning. |
| Signed authority validity did not narrow the effective grant | Effective grant is signed statement window; valid signatures outside it are refused. |

Terra's final PubMed plus regional-contracts run passes 14 tests (three comprehensive
PubMed scenarios and eleven existing contracts), with unchanged before/after input
manifests. Astra's 23 independent PubMed checks and 16 signature checks pass; root
reran the probes and retained outputs. WP03 has nineteen new signature tests plus
the prior thirty-eight preparation tests. All real authority/source responses in
these engineering tests are synthetic. Permanent tests and probes retain distinct
scope and counts; their totals overlap and are not added to npm's result.

Initial bad geography, mixed-content reorder, stale fixture and test lease/type
failures remain retained. The county, immutable scope/batch bindings, privacy and
budget corrections were required before acceptance; no threshold was weakened.

The new explicit discovery command also runs the ten existing Wistar publication
tests. Ten of the previously omitted legacy test files remain disclosed. The
frozen handoff/model and native model inputs are unchanged; this is not a new
native proof or whole-system empirical result.

Operational limitations remain: provider-wide E-utilities pacing/access/rights
need qualification; restrictive XML/size handling may reject valid material;
metadata batch completeness is narrower than inventory completeness; per-author
relations remain historical candidates with no unique-person/current-employment
or public admission. Raw/inspect metadata requires WP14 materialization.

WP03 signatures establish integrity only under separately supplied operator pins.
Pin enrollment, trusted clock, policy freshness and anti-rollback are external;
revocation is an expiring snapshot, not a live feed. No maximum TTL is claimed.
The actual zero-case manifest remains blocked/not_frozen; accountable corpus,
permissions, human review, sampling and sealed freeze are still absent.

Two deliberate prerequisite commits preserve the frozen handoff and previously
reviewed WP00–WP08 foundation. Astra reviewed the baseline packaging boundary and
CI configuration. Fresh audit still has four high advisories/seven total; no small
all-clear patch path exists because the Zod fix is a major migration. The PR stays
draft and discloses that failing gate. No audit suppression, merge, source
activation or deployment is authorized by this increment.
