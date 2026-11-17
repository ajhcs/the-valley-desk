# WP11 independent review — Terra

The independent review uses synthetic Atom responses and fresh local D1 migrations 0001–0044 with `envFiles: []`, `persist: false`, `remoteBindings: false`, and closed injected egress. No live arXiv access, production enrollment, publication, person resolution, regional admission or empirical recall is established. The [arXiv API manual](https://info.arxiv.org/help/api/user-manual.html) defines `published` as the v1 submission date and `updated` as the retrieved version's submission date; neither is fetch time.

The six acceptance criteria were challenged as follows:

- AC01: an arXiv-only bounded query commits original response bytes, private preprint leads and receipts through the real WP06/WP07 pipeline, without a repository or journal prerequisite.
- AC02: separate actual-D1 acquisitions of v1, v2 and repeated v2 retain one base ID, distinct versions and identical repeated-v2 source version. The predecessor is a proposal, not an admitted relationship. The EX16 truth table checks versionless IDs, version numbers, date/sequence widths and the bounded legacy class aliases against the [identifier guidance](https://info.arxiv.org/help/arxiv_identifier_for_services.html).
- AC03–04: a DOI and journal reference remain proposals with explicit holds; repeated same-name authors remain unresolved, no catalog person is created, and absent affiliations do not establish regional admission.
- AC05: source date fields survive replay after time advances, while unknown rights remain unadmitted. An unversioned ID with an explicit v2 alternate retains its original identifier and resolves its candidate URL to v2; conflicting alternates are rejected or quarantined.
- AC06: actual-D1 tests cover 429/backoff, request-budget exhaustion, foreign namespaces, entities, mixed text, malformed self links, missing or mismatched counts, wrong offsets, truncated pages, changed totals and page/item caps. None falsely completes coverage.

A genuine three-page chain exercises retained receipts, continuation query binding, claim and ancestry readers, historical replay, index and payload corruption, and scoped retention withdrawal. An altered continuation query hash and an expired active descriptor are rejected. A numeric-offset plan after the original claim expires is only a read-only proposal; a subsequent request still requires a live guarded plan and configured continuation authority. Equal-total changes in provider membership cannot be detected by these fixtures; chain completion means bounded traversal, not stable or exhaustive source coverage.

Earlier failures remain under `.discovery-work/wp11-terra/`: `chain-first.tap` reproduces the missing continuation query-hash check before correction, and `versions-alternate-first.tap` reproduces an unversioned public URL after an explicit v2 alternate before correction. Earlier fixture and test runs are historical rather than evidence for the final hash. PID-named synthetic boundary snapshots omit request-binding tokens.

## Final independent result

Six bounded Node 22.23.2 invocations selected the six top-level test groups: **21 reported tests passed, zero failed, cancelled or skipped** across those invocations, including 15 nested subtests. Logs are `final-rate.tap`, `final-identifier.tap`, `final-chain.tap`, `final-versions.tap`, `final-xml.tap` and `final-caps.tap`. Strict standalone test typechecking passed (`final-typecheck.tap`). `final-before.sha256` and `final-after.sha256` match across source, tests, provider fixtures, lockfile, D1 config and migrations. The independent test SHA-256 is `ab5c19d7fd1e06fa5920ef8e908b62b7027e82dcb0cfd563793fa5f571cf01ca`; the adapter SHA-256 is `ab65fd6911543c551c401b8a4bc63a3d305149f65315e62c8ac962ec24cb92ce`.
