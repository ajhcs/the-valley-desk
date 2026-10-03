# Regional sources: local implementation and review handoff

This candidate is on BuilderBob branch `codex/regional-source-coverage-20261002`, based on observed local `origin/main` snapshot `428213e52f72753863e8d5fecbabcff4466e5f2f`.
Worktree: `/workspace/worktrees/builderbob/thevalleydesk/tvd-regional-source-coverage-20261002`.
A read-only remote-main verification attempt was blocked by missing existing GitHub authentication. No credentials were changed. The parent must verify current main and preserve deployed dark-mode work before integrating this additive patch; this checkout is not a production replacement.

No PA components, shared registries, package manifests, migrations, cron configuration, Worker, frontend routes/styles, credentials, or other worktrees were changed. The parent has relayed the PA owner's inventory and file boundaries; direct thread messaging is not available in this delegated environment. PR18 and PA403 remain outside this workstream.

## Implemented locally

| Component | Behavior / evidence | Limits |
| --- | --- | --- |
| `fixtures/regional-source-inventory-v1.json` | Six additional institution records; nine inactive source proposals; twelve exact source citations with capture dates, unknown publication dates and representation hashes | Five regional scopes supported by retained location/mission evidence; Jefferson university scope remains unverified pending location evidence. Universities are distinct from their associated health systems. |
| `regional-contracts.ts` | Strict inventory identities; exact-host public URL policy; byte/hash/quote verification; bounded public affiliations; stable institutional-profile author disambiguation; numeric public GitHub identity with exact institutional links | No name search enrolls a person. A name and role must be adjacent in a retained normalized literal span, and matching an observed author identity does not confirm current employment. Roster names do not establish unique personal profiles. Observation dates never become appointment dates. Verified author observations expire in at most seven days. ORCID/PubMed/Crossref/OpenAlex collectors are not implemented. |
| `regional-discovery.ts` | Only declared official head RSS/Atom links; bounded XML and candidate counts; no DTD or custom entity declarations; exact host checks; separate published/updated dates; explicit unknown/future-date holds | Discovery and parsing are offline, review-only functions. All feed snapshots are partial. RSS listing dates are not automatically original research-work publication dates. |
| `regional-coverage.ts` + coverage CLI | Reads existing institution/news/leadership configuration and new inventory; reports missing, inactive, unobserved, fresh, stale and warned sources | No production D1 or credentials read. News/leadership receipts can be supplied locally. Existing event adapters, Watch source qualifications and RSS entries without institution attribution require additional integration before this becomes a full operational report. |
| `regional-context.ts` | Retained literal source facts with URLs/dates/hashes; separately labeled, attributed editorial inference requiring review | No paraphrase becomes a sourced fact; instruction-like facts are rejected with the existing untrusted-text rules. No publication or model call is authorized. No frontend changes. |
| source replay CLI | Revalidates citations, declared feeds, candidate dates, repository identity and contextual packets against retained source representations | Zero network calls during replay. Retained public source bytes remain outside Git. |

## Bounded observed source checks

Checks used BuilderBob's existing account and public sources, with byte/time limits. No paid API, model, platform credential, or private-data source was used. Robots restrictions were honored for institutional page checks.

- [Wistar news](https://www.wistar.org/news/): retained official Philadelphia address and exact navigation to [institutional events](https://www.wistar.org/articles/events/). Event/conference dates and relevance remain to be qualified. No feed was declared in the retained head.
- [Esperanza mission](https://esperanzahealth.com/about/our-mission/) and [public leadership](https://esperanzahealth.com/about/our-leadership/): Philadelphia community-provider identity and public role observations retained. No unique personal profile or appointment/departure history was inferred.
- [Mazzoni Center](https://www.mazzonicenter.org/): official Philadelphia provider description retained. News adapter/freshness qualification remains open.
- [Drexel Libraries](https://library.drexel.edu/research-support): Philadelphia location and official description of Drexel Research Discovery retained. The repository's collection/author transport remains unqualified.
- [Jefferson Digital Commons](https://jdc.jefferson.edu/about.html): exact institutional-repository identity and a declared [recent RSS feed](https://jdc.jefferson.edu/recent.rss) retained. The actual feed replays 22 candidates, with no rejected rows and 22 source listing dates. Their explicit PDT timestamps are normalized to UTC while raw strings remain available. These are discovery candidates, not accepted research stories or original-paper date determinations.
- [Penn's CaPTk page](https://www.med.upenn.edu/cbica/captk/): exact repository link and research-use/FDA disclaimer retained. A single unauthenticated [GitHub repository API](https://api.github.com/repos/CBICA/CaPTk) check returned public `CBICA/CaPTk`, numeric ID `128938343`. The replay binds the link to that repository; it does not infer ownership of all CBICA projects, clinical eligibility, code/data/weights licensing, or creator/maintainer roles.
- Temple's `https://library.temple.edu/categories/tuscholarshare` was blocked by robots for automated page checks. It was not bypassed, added as qualified, or tried through alternate automated endpoints. Public web discovery is recorded in the backlog, with permitted transport still open.

All twelve citation spans verify against retained representations. For all undated institutional pages, `sourcePublishedAt` is null, distinct from the actual capture date.

## Verification and retained artifacts

Use the existing Node 22 binary at `/workspace/cache/builderbob/backstage/node-v22.23.2-linux-x64/node-v22.23.2-linux-x64/bin/node`.
Dependencies were copied into this isolated worktree from the existing Watch launch dependency tree after verifying the exact same package-lock SHA-256 (`02d67d41c0c42db21303dcbc25a93e323902fc5bd52188ed597778d8e716f349`). An attempted offline locked install could not find a cached Zod package. No dependency or lock changes were made.

```sh
node --import tsx/esm --test test/regional-contracts.test.ts test/regional-discovery.test.ts test/regional-coverage.test.ts test/regional-context.test.ts
node --import tsx/esm scripts/regional-coverage-report.mjs
node --import tsx/esm scripts/regional-coverage-report.mjs --now 2026-10-02T03:30:00Z --health /absolute/path/to/local-health-receipts.json
node --import tsx/esm scripts/regional-source-replay.mjs --captures /workspace/tmp/builderbob/tvd-regional-source-coverage-20261002/source-captures.json
```

The new regional suite passes 29 tests. New tests run explicitly; package.json's enumerated `npm test` has not been modified. Integrate their command into shared CI only after coordination/review.
Existing ingestion regression command covers `official-source-discovery`, `technology-dossiers`, `news-extraction` and `executive-intelligence`: 96 tests pass.
TypeScript/Vite build and secret scan pass; Vite retains the existing >500 kB main-chunk warning. No scheduled smoke was run because these changes do not touch Worker/D1/schedules and should not start copied production integrations.

Retained source representations, replay/coverage reports and validation logs:
`/workspace/tmp/builderbob/tvd-regional-source-coverage-20261002/`.
The coverage report has 33 inventory entries, 39 configured news/leadership source entries, 127 missing institution/channel registrations and zero fresh receipts when no health input is supplied. The denominator is this explicit inventory. Missing registrations do not prove no institutional activity; zero receipts do not claim a production outage.

## Remaining review / integration work

1. Parent arranges an independent exact-diff review. Validate every institution/source relationship, exact quote, parser regression, and licensing/access disposition. Keep source qualification, activation and publication authority separate.
2. Qualify sustained permitted fetches and durable health state using existing source-health/official-source automation contracts; do not create a separate persistent service. No collector is wired or activated by this candidate.
3. Extend coverage reporting with existing RSS institution attribution, chapter/conference source families, technology qualification receipts and accepted output counts. Expose diagnostics through the existing protected ops surface after review, preserving reader flows/dark mode.
4. Research publication metadata transports and author identifier mappings. Match stable profiles/ORCID and dated affiliation evidence; hold ambiguous identities, retrospective affiliations and all guessed GitHub owners. Include community institutions only with actual source evidence.
5. Prepare artifact-specific technology context: purpose, documented workflow, publication/release dates, contributors, local relationship, license scope, research/clinical limits, unresolved questions. Keep synthesis labeled and attributed.
6. Parent's separate agent-interface workstream owns browser WebMCP, remote MCP and supported ChatGPT app/plugin distribution. This source workstream does not claim interface implementation, agent journey acceptance or any marketplace listing. It provides review-only source/context contracts for later integration.
7. Cole/authorized operational owner reviews exact activation/deployment changes separately. No production publication, deploy, activation, outreach, marketplace submission, new account/credential, or paid service is inferred.

The parent's additional St. Luke's timeout follow-up is recorded in [the source-specific audit](st-lukes-source-audit-20261002.md). Current post-due recovery remains unverified; exact bounded SELECTs are available for the existing authorized diagnostic reader. No St. Luke's page fetch or retry-state mutation occurred.
