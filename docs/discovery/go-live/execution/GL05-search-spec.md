# GL05 search and parallel lead-map work

The accepted GL04 dependency is the immutable two-work generation at `cfb33800e554f75836f2fcc2c659b3edd37eb97ac66d7b1efd61f5f71bdb3891`. GL05 adds four individually reviewed works and topic corrections to those two works. This is a six-work directory, distinct from the unchanged historical 28-object catalog and nine citation pairs. Neither catalog represents a complete regional census.

## Search contract

The frozen task set is `../evidence/GL05/query-tasks.json`. Its required records were fixed from actual retained identities before tuning. The task suite checks all named queries and kind filters, exact IDs/URLs, three full county phrases, unrelated combinations, counts, reset and deterministic ordering. Legacy exact lookup and all nine citation pairs have their own compatibility tests; passing them does not promote their endpoints into the newer directory.

`GET /api/discovery/v1/works` and `/discover/works` accept `q`, `kind`, `topic`, `county`, `institution`, `sort`, `limit` and `after`. Duplicate and unknown keys fail. Empty facet controls mean all values; whitespace-only facet values fail. Limit is an integer 1–50. Search text is at most 200 characters. GET forms preserve selected values and discard pagination cursors on a new search. Pagination links preserve the filters. Reset links return to the unfiltered route; URL navigation works without scripts.

Words use Unicode normalization and whole-token matching. AI, ML and machine learning require an explicitly reviewed machine-learning topic. Brain cannot satisfy AI, and HTML cannot satisfy ML. Rutgers-Camden punctuation variants share a controlled institution alias. A full county phrase requires an explicit county claim; a city string does not silently become a county claim. Supported source-name, institution-name, account-name, repository-slug, DOI and native-ID searches use retained fields.

All terms and filters must match the work itself, or that work plus one directly related work. Two unrelated neighbors cannot satisfy different parts of a conjunction. The explanation retains the actual directional citation and source claim/evidence IDs. A repository supported by a historical publication author's county does not acquire that author's residence, employment or repository ownership. Public work results and supporting works remain separately counted.

Each facet counts distinct matching works after excluding only that facet's explicit filter, retaining the query and other filters. Any related value must be available along the same single eligible relation. Results, supports and facets come from one validated snapshot. The cursor binds the complete snapshot digest, alias revision and all query controls; changed inputs return a restart response. Withdrawn works cannot enter the snapshot, and removals invalidate the old generation's cursors.

For a nonempty query, exact own identity ranks first, then own-field/claim matches, then matches needing a related work. Within a rank, known source dates descend, unknown dates follow, and stable IDs break ties. Blank search uses stable IDs. Explicit title or source-date ordering is available. Stars, institution prestige and source prominence have no role. Unknown date precision is preserved rather than filled with a fabricated date.

## Parallel work ownership

Terra search engineering owns the search module and frozen-task execution. Terra source work owns the selection and observations; Terra adapter engineering owns evidence semantics; Terra compatibility work froze tasks and preserved all legacy pairs. Root integrates HTTP, HTML, builder paths and trusted authority. Sol independently reviews sources and code. The historical date issue Sol found in OpenPBTA was repaired before source acceptance: October 2022 is the project association date, while November 2026 remains the page-check date.

The user's additional request for many more leads introduced parallel Pennsylvania and New Jersey discovery. Their output is a private source-linked account map, not automatic public admission. Five factual source files produce a deterministic case-insensitive account/repository map, preserve separate person occurrences and evidence roles, reconcile literal URLs with retained baselines, and produce an account-by-account next-collection queue. Clinical software, personal accounts, course projects and non-headline work remain eligible. General neuroscience and basic methods require a clear health application before admission. Missing geography or account identity is a qualification task, not grounds to erase a promising lead.

`npm run discovery:research-map:build` regenerates the private map and linked report; `npm run discovery:research-map:check` detects drift. It does not contact sources, enroll collection or publish anything. Source-scope failures from GL03 remain recorded for bounded qualification before native account enumeration; HTTP validation failures are distinct from source permission refusals. GL08/GL09 will use this queue for maintenance and breadth work. Their acceptance is not advanced by a lead count.

## Remaining package boundaries

GL06 owns the public front door, navigation, final card design and archived/status presentation. GL07 owns creator/institution journeys. GL08 owns operating corrections and additions. GL09 owns actual county exploration and miss audits. GL10 owns intended-reader, browser, accessibility and performance qualification. GL11 owns exact release-head, configuration, operational acceptance and deployment under the user's existing authorization. GL05 does not deploy.
