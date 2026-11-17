# County and institution expansion — EX31

The user requested real repositories and linked publications beyond Penn and
Philadelphia, with Sol/Terra work, Astra review, commits and an updated PR, without
deployment. This increment adds three pairs and makes their separately sourced
institution/county connections findable and visible.

| Pair | Dated connection used for selection | Limit |
| --- | --- | --- |
| [GASTON](https://github.com/raphael-group/GASTON) / [2025 paper](https://doi.org/10.1038/s41592-024-02503-3) | Named Princeton Computer Science authors; main-building/institutional evidence associates this with Mercer County. | This is campus association, not an author's physical worksite or repository ownership by Princeton. |
| [SleepBoost](https://github.com/akibzaman/SleepBoost) / [2024 paper](https://doi.org/10.1007/s11517-024-03096-x) | Iman Dehzangi's Rutgers–Camden connection; campus address and county municipality evidence establish the Camden context. | The GitHub User owner is separate. Native metadata already reports the corrected first name and is not rewritten. |
| [OpenPBTA-analysis](https://github.com/AlexsLemonade/OpenPBTA-analysis) / [2023 paper](https://doi.org/10.1016/j.xgen.2023.100340) | Stephanie J. Spielman's Rowan–Glassboro affiliation and county-campus evidence support Gloucester context. | This is an archived multi-institution collaboration, including Penn/CHOP, not Rowan-owned/origin work or an independent new laboratory. |

GASTON concerns cancer spatial transcriptomics, SleepBoost automated sleep-stage
classification, and OpenPBTA pediatric brain tumor genomics. These subjects fit
health informatics/AI research; no clinical validity or deployment claim follows.
The sample adds NJ institutional/county connections. It is not a census of these
counties and does not establish new coverage in the outer Pennsylvania counties.

## Acquisition and meaning

Eight bounded anonymous API requests returned HTTP 200. Six exact metadata bodies
supply the three selected pairs; two THREAD repository/preprint bodies remain
research-only because exact cited-version local affiliation was not established.
Whole-body material/identity preflight preceded retention, and Astra reviewed
all eight bodies and URIs before portable copying. The existing metadata gate
already supports User and Organization owners. The new acquisition method binds
the explicit requested owner type and numeric owner/repository identities rather
than assuming every owner is an organization. No person profile was fetched.

The [pilot-only material index](qualification/evidence/pilot-counties-20261116/material-index.json)
marks selection/research status and exact bytes, hashes, request URLs and times.
Original receipts and methods are retained unchanged. This standalone acquisition
does not qualify WP06's runtime transport, enroll a source or activate collection.
The [source assessment](qualification/pilot-counties-20261116.md) records the
primary campus/municipality evidence, source access limits, the correction and
excluded leads. A 2010 Rutgers PDF did not substantiate the claimed literal county
statement, an old Rowan procurement URL returned 404, and Princeton postal names
span county boundaries. More precise official sources replaced those shortcuts.
Blocked/indexed primary views remain distinguished from native HTTP captures.

Each selected repository explicitly links its paper at a verified immutable
file. Terra researched the source facts; root recorded fresh timestamped bounded
connector reads, and Astra independently reread the pinned DOI/blob contexts.
Only factual observations were saved, without README/article/code/contact text.
THREAD, a weak RT-Cloud example citation, a generic BrainIAK paper and unsupported
Pennsylvania leads were not substituted to meet a quota. All material remains
development-exposed and adds zero benchmark cases or human labels.

The three selected Crossref bodies contain 7, 5 and 66 author entries, all without
affiliations. Across the whole catalog, 367 authorship entries include the previous
consortium and possible name variants; this is not a distinct-people/local-people
count. The catalog selects 28 native records: thirteen repositories, thirteen
publications and two organization backgrounds, with nine directed citations and
eleven non-null repository descriptions. Earlier twenty-two record objects are
unchanged, and the first twenty-eight-object v2 projection remains exact in v3.

## V3 discoverability and source boundaries

Without separate context, queries such as Princeton/Mercer/Rutgers would miss
these additions. V3 adds top-level regional contexts bound to the exact fact
packet, semantic observation pointer, native publication snapshot hash, native
year and source-indexed author names. The [regional fact packet](qualification/evidence/pilot-counties-20261116/regional-contexts.json)
contains four selected named-author references, institution/campus/municipality/
county context, source URLs, date-level observation precision, direct/indexed
methods and scope notes. It never fills native affiliation arrays, changes native
county fields, merges identities or assigns software contributions/current roles.

Direct regional matches have a distinct `regional-context` basis. Related
repository results retain an explained, single citation hop. Result-only
supporting publication records bind context for a publication absent from the
visible items. Missing, mismatched, duplicate or unrelated support is rejected;
support does not increase counts, matches or result cards. Duplicate source URLs,
provenance collisions, wrong native author/hash/year and extra fields fail closed.
These are consistency checks, not mathematical proof of an external source's truth.

The UI labels dated connections for named publication authors and an associated
campus/municipality, with evidence and scope disclosures. A repository displays
this beneath the cited-paper relationship, separate from its owner. Source links,
method/read date and optional technical trace stay inspectable. Native missing
affiliations remain explicitly missing. Full county phrases and hyphenated campus
names work without changing source values; mixed unrelated county/institution
terms cannot be combined across citation neighbors to manufacture a match.

## Review and verification

Sol preserved original fourteen-record regressions and exact twenty-two- and
twenty-eight-record digests, then added actual-pair/User-owner and v3 binding,
support, source, query and adverse-input tests. Thirty-nine focused tests and
TypeScript checks pass. The root's routing expectation was updated to twenty-eight.
Terra's original 439-check static comparison is historical v2 evidence; the
separate v3 comparison passes 479 checks and its local query checks are recorded
with their actual runtime. Astra independently reconstructed the v2 records,
reviewed eight v3 probe groups and independently tested the source/binding/query
boundaries. Counts overlap normal coverage and are not summed as unique tests.

The root passed 65 browser assertions and inspected four captures at 1440×1000
and 390×844. Astra passed 93 main and twelve supplemental browser assertions,
inspected twelve screenshots, then checked eight final full-phrase cases after
the search fix and inspected two further mobile captures. Browser checks include
source roles, county/institution results, citation navigation, source/method
links, no overflow, all 7/5/66 native rosters, JavaScript-disabled lookup and
rejection of a malformed neighbor-proof response without rendering cards.

The Browser plugin was unavailable. Existing Playwright 1.64.1/Chromium headless
shell 1248 and the sanitized Node 22.23.2 wrapper were reused against the isolated
loopback Worker on `127.0.0.1:4178`; no dependency was installed. Root fulfilled
external requests locally; source navigation in independent checks was intercepted.
No article/provider body was fetched by those browser flows.

Review found and resolved the neighbor-only proof gap, imprecise county sources,
misleading 'in cited publication' wording and missed full county/hyphenated search
phrases. Intermediate v2/pre-fix probes remain historical. Initial independent
harness issues involving a canonical SSH alias, a private module-import path,
Node 18's missing global crypto and a legacy unknown-date test touching a
context-bound publication are recorded separately from actual application errors.
The production gate was not weakened to make a harness pass.

## Qualification and handoff

Fresh full qualification passed 939 application + 146 Watch + 366 Discovery =
1,451 tests, with zero failures/skips/cancellations; seven mandatory PDF
regressions, build/typecheck, isolated local smoke, dependency audit with zero
reported vulnerabilities and secret scan also passed. All 630 runtime input
hashes stayed fixed. After the final build, the root repeated all 65 browser
assertions and three assembled Worker/bundle groups, including default-closed
routes, no D1/network access, and source/catalog/context exclusion from browser
assets. MP01–MP03 are locally accepted for EX31; earlier acceptance remains in
history. The [new receipt](receipts/metadata-link-pilot-counties.json) binds source
commit `8e17885f02a3a7ba9fcc86eac16aa82df4726935`, checks, reviewed artifacts and preservation.
Delivered-head CI remains separately tracked on PR30 before handoff completion.
See the
[independent review](reviews/metadata-link-pilot-counties-astra.md).

Original 31-package/model/benchmark acceptance, all 91 frozen handoff entries,
native model/contracts/receipt, strict reference manifest, WP03 material index,
historical source/receipt/review files and production configuration remain
unchanged. MP04 public activation remains held. Broader county/institution/source
coverage, current creator profiles, measured relevance accuracy, full accessibility,
other browsers and production operation remain unqualified. The inherited large
main-bundle warning remains. No merge, remote migration, source enrollment,
recurring collection, actual human enrollment, public activation or deployment
occurs in this increment.
