# Representative Roster Completion

## Delivered Contract

Offices and memberships can now use `datePrecision: "observation"` with an
explicit `observedAt` instant and `validFrom: null`, `validTo: null`. This is not
a term interval. Term mode still requires a real start date, and old records
without optional fields retain their canonical hashes.

Only the current Eastern-calendar query can show observation-only members.
Their observation instant must equal the accepted roster instant. The default
runtime freshness window is 168 hours, measured from the source observation,
not acceptance. Expired entries become `last-known`, do not count as verified
filled seats, and retain the observation date. Earlier date queries cannot
infer terms; all-observation directories return `historical-coverage-unavailable`.
Historical policy roles and committee terms still require actual dated coverage.
Roster-only preparation uses neutral `member`, not inferred elected/appointed status.

## Approval Boundary

`RepresentativeDraft` accepts proposed facts without verifier fields. Legacy
staged fact shapes remain readable, but their verifier labels cannot authorize a
new decision. Acceptance derives human-review provenance from the authenticated
reviewer and decision timestamp. New snapshots carry optional
`reviewBindingVersion: "authenticated-review-1"`; reads reconstruct the exact
reviewed fact digests from the immutable decision. Legacy snapshots are unchanged.

Runtime source permission is now chamber-specific through
`REPRESENTATIVE_ROSTER_ENDPOINTS`, not jurisdiction alone. A Senate source cannot
qualify House membership. Qualification resolution is bound to the original
permission digests and supplies SQL CHECK guards to the same atomic batch as the
decision and head. A changed/revoked source rolls back the whole batch. Missing
guards prevent acceptance. Existing revision CAS still prevents stale reviews.
No migration was required; migration 0037 remains unallocated by this task.

## Real Source Evidence

The bounded public-GET capture and offline preparation pass staged seven drafts
in disposable local SQLite: 379 names, 1,101 proposed facts, zero decisions and
zero public heads. No real-source approvals, source activation, model calls or
production writes were performed. The largest fact is 20,964 bytes, below 24KB.
The largest complete canonical draft is PA House at 790,009 bytes with 610 facts
and 610 evidence entries, within representative staging's existing 2MB/4,000
limits. The largest observation is 120,615 bytes, within 500KB. These drafts use
internal representative staging, not the separate Watch editorial 500KB POST.
The representative review POST carries only a hash and decision (4KB bound).

| Official Source | Observed UTC | Names | Raw SHA-256 |
| --- | --- | ---: | --- |
| [NJ 2026 text archive](https://pub.njleg.state.nj.us/leg-databases/2026data/DB2026_TEXT.zip) | 2026-09-12T17:33:30.533Z | 40 Senate + 80 Assembly | c812135d67c1307a0256458ba9ab3d54196ab6c0d07c90ceccd85fc02c2ad10c |
| [PA Senate](https://www.palegis.us/senate/members) | 2026-09-12T17:26:19.985Z | 50 | b5654ce262332f95afc64e165a88b3c767d3993a07e2dff91d8f1b8246c60c72 |
| [PA House](https://www.palegis.us/house/members) | 2026-09-12T17:41:41.038Z | 203 | 05ef9f6547ae6ef949c9fdb5ef5f8b2e6089db7d7c2120a41f3a10b80aa90131 |
| [U.S. Senate](https://www.senate.gov/general/contact_information/senators_cfm.xml) | 2026-09-12T17:26:20.574Z | 2 each PA/NJ/DE | 984865a4a6e00af68c9617ea45f52b8939f49143780c832cb68c747fa4bfef5e |

Raw captures, receipts, extracted-data-bound drafts and the exact draft hashes:
`/mnt/d/tmp/plumbob/tvd-roster-captures-20260912/draft-preparation-report.json`.
These are retained review inputs, not production seeds. Replay preserved original
observation times. NJ biography rows are joined by exact roster identity; their
year-only service strings are not converted into day-level term dates.

PA House was larger than the initial 500KB probe, not unavailable. Its 595,035
bytes fit the 2MB offline bound. Standard-library HTML parsing preserved the
official apostrophe-containing biography paths. Original source bytes remain
available alongside normalized observations and their raw hashes for review.

## Implementation

`scripts/read-representative-source.py` uses Python's standard ZIP/CSV/HTML
parsers, explicit archive entry names, CP1252 for NJ exports, and byte/row bounds.
It reads retained source data only and never executes downloaded scripts.

```sh
python3 scripts/read-representative-source.py nj /path/to/retained.zip
python3 scripts/read-representative-source.py pa /path/to/retained-members.html
```

Pass that JSON to `prepareNjRosterCaptures` or `preparePaRosterCapture`, with a
server-owned source ID and the real capture timestamp. Senate XML goes through
`prepareSenateRosterCaptures`. `buildRepresentativeRosterDraft` creates proposed
facts, immutable structured evidence and an observation; then
`stageRepresentativeRosterCapture` persists the draft using expected revision.
Draft IDs bind source, parser, observation, representation and expected revision.
Review uses the existing protected draft/hash decision API after qualification.
Do not substitute statutory term dates, preparation time, or placeholder reviewers.

## Verification And Gaps

Focused representative, SQLite/D1 persistence and Watch UI suites passed 68 tests.
TypeScript/Vite build and secret scan passed. Add `test/representative-roster-drafts.test.ts` to
the root's explicit test command at integration; no package or worker edits here.

Regular Playwright was used because the Browser plugin was unavailable. Six
checks passed at 320, 390, 768 and 1440 pixels: two real NJ names in one district,
explicit unknown terms, no invented profile links, historical evidence gap, no
page errors or framework overlay. This was a renderer-only preview assembled
from proposed facts, not accepted backend data. No approval function was called.
Four screenshots and report: `/mnt/d/tmp/plumbob/tvd-roster-browser-20260912`.
Mobile and desktop screenshots were visually reviewed; preview stopped afterward.

Remaining: DE state member JSON endpoints still fail despite being referenced in
current official chamber pages; U.S. House was not collected in this slice.
NJ individual profile links are not established, so official chamber lookup is
offered instead. Global district facets, current source qualification/activation,
authorized real editorial review, operational retention and a live readback gate
remain required. This is not a production activation receipt.
