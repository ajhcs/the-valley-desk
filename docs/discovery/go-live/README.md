# Go-live engineering plan

TVD-GO-LIVE-1 · EX32 plan / EX33 execution · 16 November 2026 · Implementation in progress

Build The Valley Desk for our own recurring discovery work and make the same useful service publicly accessible. Launch as The Valley Desk, without a public pilot phase or pilot branding. The main product is a broad, source-backed index of regional health-technology work. A few useful facts and good links should let a reader decide what to inspect next.

The user selected this direction after reviewing seven launch priorities. They emphasized broad coverage, including useful repositories outside prominent journals and news coverage. Complete biographies, exhaustive research descriptions and linked publications are not admission prerequisites.

## Start here

1. Read this scope and [work packages](work-packages.md).
2. Read the [architecture](architecture.md), [coverage strategy](coverage.md) and [operating workflow](operations.md) for implementation contracts.
3. Use [adaptation rules](adaptation.md) at dispatch, integration and acceptance.
4. Use [validation and release](validation.md) to distinguish a planned check, observed result and accepted release.
5. Update [plan.json](plan.json) as execution proceeds. Its GL00–GL11 entries are the active launch work register.

The [independent planning review](review.md) records resolved findings and the limits of the document checks. It accepts the handoff for planning use, not implementation or release.

The source baseline is `60d6bd3aaba90a4970821f41fb2ca0329cbf8d20`. It has 28 selected native records: 13 repositories, 13 publications and two organization backgrounds. Nine repository-to-publication citations and three separate historical regional contexts are represented. The 367 authorship entries are not 367 distinct or local people. Qualification includes 1,451 tests, seven PDF regressions and successful delivered-head CI #186/#187. These are historical results for that revision, not evidence that this plan has been implemented.

## Current implementation checkpoint

EX33 has accepted GL00's source/runtime and launch baseline, GL01's locally
qualified lean public/private contracts, and GL02's pre-collection exploration
design. See the [GL00 acceptance](execution/GL00-acceptance.json),
[GL01 acceptance](execution/GL01-acceptance.json) and
[GL02 acceptance](execution/GL02-acceptance.json). Terra authored the packages;
Sol independently reviewed and challenged them before orchestrator acceptance.

GL01's source commit is `2ba42446f6b7c8f943a39a5d6c2d109d0d12dd50`.
Full local qualification passed 1,472 tests, seven PDF regressions, build/typecheck,
local smoke, dependency audit with zero reported vulnerabilities and secret scan,
on 633 unchanged runtime inputs. The GL01 descendant head `3ad7cb3` and original GL03 source `4518343` passed
both push and pull-request CI. These results remain specific to those heads.

GL03 is accepted for bounded operator-run acquisition, a durable private SQLite frontier,
whole-body ephemeral inspection, one-use request permits, and separately reviewed
source scopes. Seven requests retained eight private leads: seven repositories
and one publication. Three original inspection failures remain explicit; no
account, regional or publication inventory is complete. The same-name repository
and biological-networks paper have no established health-tech/regional
eligibility. See [GL03 results](execution/GL03-source-results.md),
[Sol review](execution/GL03-sol-review.md),
[acceptance](execution/GL03-acceptance.json) and
[internal evidence](evidence/GL03/README.md).

Full regression passed 939 application, 146 Watch and 410 Discovery tests. The
final acquisition-method refinements passed 26 focused tests; these counts
overlap. Seven PDF regressions, build/typecheck, local smoke, zero-vulnerability
audit and secret scan passed. The full regression preceded the final narrowly
scoped refinements; their latest code was tested separately. Updated-head CI is
tracked on PR30, and no exact release-head pass is inferred.

GL04 is accepted for the PR-reviewed snapshot workflow. Its first generation
contains two reviewed works: a paperless-route CrCEST MRI repository and a
standalone GASTON publication. Seven GL03 leads and three failed scopes remain
held and traceable. The builder binds the entire selection to independently
reviewed source approval, checks native/observational source roles, and preserves
immutable prior generations for corrections and removals. Native-identity
suppression prevents re-admission under another internal ID.

The versioned API and script-free HTML use only generated public artifacts. Their
new flag is off by default; old `/discover` and `/api/discovery-pilot` behavior
remains separate. The existing 28-record snapshot, nine citations and three
historical regional contexts are unchanged. See [GL04 acceptance](execution/GL04-acceptance.json),
[Sol review](execution/GL04-sol-review.md) and
[operator workflow](execution/GL04-operator-workflow.md).

Source commit `30737e` passed 1,519 application/Watch/Discovery tests (including
21 focused GL04 tests), seven PDF regressions, build/typecheck, local smoke,
audit with zero reported vulnerabilities, and secret scan. All 665 retained
runtime inputs stayed unchanged. Ten actual loopback workerd HTTP checks passed;
this is local integration evidence, not a deployed or human-reader result.
Updated-head CI remains separately tracked on PR30.

GL05 is accepted for bounded search, private source intake and federation; all
acceptance limits and verification timing are recorded in [GL05 acceptance](execution/GL05-acceptance.json). The current
directory contains six reviewed works. Ordinary topic/institution/county search,
facets, match explanations and stable pagination use one generated snapshot;
the historical 28-object read surface remains separate.

Parallel Terra intake and independent Sol review now connect fifteen source collections
in the [current regional map](evidence/GL05/regional-additions-20261117/research-network.md):
1,028 account URL keys, 4,890 catalog candidate repository keys and 7,249 distinct
repository-shaped URL leads (6,129 excluding Drexel broad-check-only observations).
The 23,356 observations retain the previous 17,665 exactly and add 1,788 source
records plus 3,903 projected metadata URL occurrences. These include unreviewed
profile leads, historical affiliations, external collaborators and general work;
the counts do not establish distinct people, local labs or eligible health projects.

The latest collections cover PABC/BioLabs and broader regional discovery, Wistar,
and Philadelphia public health. The first collection copies earlier Valley Desk
exports: their complete memberships and observation IDs were verified and retained
as three compact lineage records, without reimporting thousands of old leads.
Repeated projections or exports are not independent corroboration. Wistar's 43
directory entries are not 43 labs; the public-health source's 492 filtered profiles
are self-reported hints, and its 5,287 raw hits and profile biographies are excluded.

DVRPC's nine counties remain primary. Broader source Greater Philadelphia wording
does not expand that boundary; Delaware, Scranton and Lehigh contexts retain their
labels. PABC membership does not establish lab residency; BioLabs for Advanced
Therapeutics and B+labs remain distinct. PHL-2's claimed public-health-lab identity
has no independently established city linkage. Citywide, department, community and
global-company contexts stay separate from ownership and project worksite.

Prior snapshots, all reported native IDs and the Cooper graph remain unchanged.
Pinned references retain the earlier detailed source records and their ancestors.
[Discovery follow-through](execution/GL05-discovery-follow-through.md) connects this
private queue to bounded qualification and lean admissions.

Historical full-suite and CI results retain their original revisions. Both push and
PR CI passed the previous sources/qualification heads through `6ba5dee`. The latest
three-intake additions passed 27 focused research-map/import/federation tests,
12 source QA tests, three byte-exact source replays, eight portable freshness
checks, production build/typecheck and secret scan. Full application/Watch/Discovery,
PDF, smoke and dependency-audit checks were not repeated locally for this metadata-only
change. New-head CI remains separate on PR30. See [additions acceptance](execution/GL05-additions-acceptance.json) and [validation receipts](evidence/GL05/regional-additions-20261117/qualification/validation-summary.json). The [additions review](execution/GL05-additions-sol-review.md)
records source lineage, citation, validation and geography checks and their limits.
GL06–GL11 still own the front door, creator journeys, upkeep, broader coverage,
reader validation and release. Their order now follows the recorded sequence below.
No production configuration, scheduler, remote migration, source enrollment or
release changed. Deployment remains authorized when GL11 readiness is met.

## Recorded next sequence

On 17 November 2026 the user accepted a reordered sequence, recorded as GL06-D01
and `execution_sequence` in [plan.json](plan.json). It supersedes the concurrent
GL06/GL08 start in GL05-D01. Package dependencies and acceptance criteria are
unchanged. Sol has not yet reviewed this decision.

Before the first enrichment pass, 1,609 of about 7,277 repository keys
carried a description, 2,747 a last-push date and 231 a native ID. About 2,145 appear
only in the Drexel collection and 899 only in Lehigh, Scranton or Christiana. The
six catalog records average about 4.5 KB against the 128,000-byte response bound.
These are counts read from the queue and catalog, not a qualified yield or a tested
page size.

1. **Enrich the primary-region queue (GL08).** Qualify one provider metadata route.
   Record native ID, description, fork/archived state and dates, and deduplicate by
   native ID. Neighboring-context leads stay searchable internally. The account
   roster, request scope and budget need approval before any network request.
2. **Measure yield (GL08).** Review about 100 enriched leads against the minimum
   useful listing. Record the eligible fraction and minutes per admission.
3. **Make admission data-driven (GL06, GL08).** Use one reusable adapter and one
   queue builder instead of per-work captures and per-collection build scripts. Add
   a compact list projection with separate detail retrieval before the catalog
   passes about 20 works.
4. **Build a private review interface (GL08 scope addition).** Show enriched
   candidates with filters, evidence links and review states. The snapshot builder
   consumes its decisions. It stays out of the public Worker and is separate from
   GL08's correction and upkeep work.
5. **Build cards and search, and expand the catalog (GL06, GL08).** One renderer
   owns the directory. Admit reviewed works in batches. Switch the homepage to
   discovery once the catalog is large enough to browse; step 2 sets that size.
6. **Complete GL07 and GL08.** Add institution and creator journeys that retain
   uncertainty, then the report path, corrections, removals and upkeep rehearsal.
7. **Audit, validate and release (GL09–GL11).** Resume discovery only where the
   admitted set shows gaps, starting with Burlington and the outer Pennsylvania
   counties. New collection intake is otherwise paused.

Two housekeeping items are open: move retained evidence out of the product PR so
its code can be reviewed, and ignore or relocate the six untracked Penn intake JSON
files at the checkout root.

Step 1 now has an [initial enrichment checkpoint](execution/GL08-enrichment-checkpoint.json)
from the merged `8f0ac66` baseline. A frozen 41-account primary-collection seed
cohort and separate continuation qualification used 57 anonymous requests,
retaining 549 distinct native repositories privately. Twenty-eight account
chains reached a validated terminal page; thirteen remain incomplete or
identity-unverified. GitHub's native-user pagination path was verified for an
Organization owner after the first parser rejected it. All failed receipts
remain preserved. Other primary accounts are queued. The reviewer accepted the
adapter for this bounded private workflow after six fixes. The
[independent review receipt](execution/GL08-independent-review.json) also records
the dependency audit failure shared with the merged baseline.

Step 2 reviewed all 100 frozen leads. Seven were eligible (7%), 26 were
rejected and 67 were held. It took 27.92 timed agent minutes across the sample,
or 3.99 minutes per admission-ready listing. This is a result for the sampled
cohort. No works were admitted publicly. See the [yield review](execution/GL08-yield-review.md)
and [results receipt](execution/GL08-yield-results.json).

Steps 3–5 now have a private review UI and draft builder, responsive catalog
cards, a compact API and separate detail. GL07 institution and source account
links are included. The homepage cutover and public admission batch are still
pending. The [local workflow](execution/GL06-GL08-directory-review.md) gives the
review and preview commands. The [Terra method](execution/GL08-terra-screening.md)
prioritizes exact-work evidence while keeping every lead in the review. Its
speed target awaits a matched pilot.

## Product decisions

| ID | Decision and consequence |
| --- | --- |
| D01 | Internal-first use with public access. Design a fast research tool; keep candidate/review information private. No account is required to read public records. |
| D02 | Breadth is a primary product requirement. Investigate labs, departments, institutional accounts and supported independent accounts, including quiet and unpublished work. Stars, journal prominence and press coverage do not determine eligibility. |
| D03 | A useful lean listing can stand alone. A repository does not need a paper, a paper does not need code, and a creator does not need a complete profile. |
| D04 | Evidence applies to individual claims. An evidenced institutional/project connection can support a work listing without resolving every author. It does not locate every contributor or establish current employment. |
| D05 | Metadata and original links are the launch material. Optional article, README, code, forum-body and image reuse remains source-specific; such reuse is not required to index permitted facts. |
| D06 | Release after focused product, breadth, integrity and operating checks. Do not require the original 360-case benchmark, universal six-route completion or a four-week public pilot for this scoped launch. Preserve those separate full-system obligations. |
| D07 | Keep source truth and unknowns visible. Fewer supported facts are preferable to invented summaries, affiliations, contribution claims or regional completeness. |
| D08 | Use the existing stack and accepted components where their contracts fit. Add storage, search services or paid dependencies only after a measured need and a reviewed decision. |

EX33 records the subsequent user instruction to implement from GL00, follow dependencies, use Terra with Sol review, make commits and update the PR. The user also authorized deployment as appropriate. That authority is available for the existing-site GL11 candidate after its readiness checks; no repeated deployment permission is needed within that scope. No release has occurred. Unrelated infrastructure changes, new paid services and outreach retain their separate boundaries. Current assignments and acceptance are in plan.json; earlier planning-only statements describe EX32 history.

## Seven priorities and accountable outputs

| Priority | Required result | Packages | Launch evidence |
| --- | --- | --- | --- |
| G01: Discovery front door | Home and navigation explain regional health-tech discovery, provide search and subject/institution/county entry points, and preserve legacy URLs. | GL06, GL11 | A reader reaches useful work from the homepage; route and feed compatibility checks pass. |
| G02: Ordinary search | Explainable topic and literal search handles ordinary health-tech terms, including the known `sleep AI` miss, without hidden factual inference. | GL01, GL05 | Frozen query tasks, negative cases and result explanations pass on real selected records. |
| G03: Useful results | Compact listings show what the work does, supported healthcare purpose, regional connection, useful original links and check dates. | GL01, GL04, GL06 | Record inspection and rendered tasks verify each displayed claim and next action. |
| G04: Who and next steps | Work connects to source-reported people/accounts/institutions where supported. Public project or professional links provide a next step. | GL01, GL07 | Paperless and partially resolved records remain useful; no false identity or current-role claim appears. |
| G05: Regional breadth | Repeatable, diverse discovery uncovers work beyond the initial Penn/Philadelphia and journal-linked examples. | GL02, GL03, GL09 | Bounded source exploration, account inventories, independent miss checks and explicit gap dispositions. |
| G06: Maintenance and corrections | A small operator workflow handles additions, rechecks, errors, removals and failures within a measured workload. | GL08, GL09 | A real permitted update batch and isolated correction/removal rehearsal complete without stale public claims. |
| G07: Reader and operational readiness | Representative tasks, accessibility, browser, performance, privacy, monitoring and recovery checks support the exact release. | GL10, GL11 | Scoped results, no unresolved blocking findings, operating assignment and a rehearsed rollback. |

## Minimum useful listing

The public listing needs a stable identity, record kind, title, safe original link, concise supported purpose, supported health-tech relevance, a dated regional basis and a last-checked observation. Its permitted sources and review decision must be inspectable. A source-scoped owner or author label is useful when available, but an unresolved individual does not block an organization-authored work.

Source-backed institutional/project association can be sufficient regional evidence. Paper affiliation is one route among several. For example, an official laboratory page that identifies its software and institution can support a paperless repository. A city's occurrence in a README, a collaborator's name, a hospital dataset, a star or an institution's headquarters alone cannot locate its creators or code production.

Optional fields include author lists, professional links, publication relations, source-reported archive state, license hints and additional dates. Missing optional fields stay absent or explicitly unknown. Do not inflate a listing into a dossier. A useful card should generally fit its purpose, regional reason and main actions into one compact view, with deeper evidence behind a disclosure.

Repositories, papers, preprints, projects and qualifying discussions have independent identities. Grouping related artifacts is permitted only through supported relations. Counts distinguish artifacts, accounts, people and any verified project groups. The public can see reviewed findings; unsupported candidate leads remain in a private discovery queue.

## Reader journeys

| ID | Starting question | Useful outcome and boundary |
| --- | --- | --- |
| J01 | What health-tech work is happening nearby? | Browse subjects/counties/institutions and open original work. Coverage labels describe our explored sources, not all regional activity. |
| J02 | Who around Camden works on sleep AI? | Find supported sleep/ML work and the named people or institutions in its sources. Historical roles stay dated; the system does not invent current availability. |
| J03 | Show useful code from a lab I have never heard of. | Find a low-visibility, paperless repository through a qualified account or institutional route. Popularity is not an admission or default ranking condition. |
| J04 | Is this relevant to my problem? | Read a short supported purpose and health-topic explanation, inspect the regional reason, then open code, documentation or a publication. |
| J05 | What does this institution or named author connect to? | Follow only supported source-specific links. A shared name cannot merge people; a repository owner is not automatically a paper author. |
| J06 | What changed since I last looked? | Use first-seen and source-event dates distinctly. An old repository discovered today is newly found, not newly created. |
| J07 | This attribution or link is wrong. | Submit a minimal correction; an operator reviews it and updates or withdraws affected public fields and search results. |
| J08 | A source failed or a release needs reversal. | Readers see truthful check/gap information. Operators can stop intake and restore a permitted known-good projection without reviving withdrawn claims. |

## System boundary and delivery choice

A private discovery frontier feeds bounded acquisition. Candidate facts then pass source, identity, health-tech and regional checks. A reviewed lean release manifest produces the public catalog, search view and coverage summary. Readers use the same public content internally and externally. Public suggestions enter an untrusted intake; they cannot publish a record.

The initial implementation should reuse the finite reviewed projection as a deployable snapshot. Repeated acquisition must not publish directly. Preserve a clear authority boundary between private candidates and the versioned public release manifest. Extend the snapshot path only through reviewed contracts; it must not falsely mark the unfinished full admission/publication system accepted. [Architecture](architecture.md) defines the storage growth decision.

Original WP00–WP30 status, model proofs, full-system E01–E06 and historical MP receipts remain unchanged. EX32 changes the selected launch scope and public product language. It does not grant acceptance to WP03, WP12–WP27 or WP30. Full automation, current-person verification, comprehensive coverage, independent accuracy claims and richer reuse remain separate increments when useful.

## Completion and release boundary

Launch requires the seven useful outcomes at their declared scope, sufficient demonstrated breadth, correct public attribution, usable reader tasks, manageable maintenance and a tested release/recovery path. It does not require knowing everything about every creator or covering every county equally. A missing paper, biography, license hint or forum integration is not by itself a launch blocker.

A reproducible known miss in a declared explored source is different from an unexplored source. Repair systematic blind spots such as paper-gating, organization-only collection or star thresholds before launch. Record remaining geographic/source gaps and the next bounded search rather than manufacture records to meet a quota. The coverage and validation documents define when a gap can be accepted and when it blocks the stated launch scope.

The orchestrator may refine implementation choices within these decisions. Changes to the nine-county boundary, healthcare relevance, factual authority, privacy, costs beyond approved caps or release authority require an explicit recorded scope decision. Adaptation must improve delivery without silently weakening acceptance.
