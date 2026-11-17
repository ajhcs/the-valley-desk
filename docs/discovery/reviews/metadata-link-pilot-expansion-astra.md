# Independent pilot expansion review

16 November 2026. Astra reviewed the four-project expansion from baseline
`29d55f325625bca1316e53c5c2a7e4200dd7431c`. Native acquisition belonged to the
orchestrator, source discovery to Terra, and regression changes to Sol. This
review independently inspected retained bytes, source relationships and the
resulting projection. It does not authorize deployment or benchmark acceptance.

## Source and relationship review

All eight staged bodies were reviewed before portable copying. Each exact hash
and byte length agrees with its complete HTTP 200 receipt. The receipts record
anonymous HTTPS, no authentication or proxy, no followed redirect and bounded
requests. The existing whole-payload preflight was independently rerun offline
and passed all eight bodies; its implementation remains unchanged. These
standalone receipts do not claim qualification of the WP06 runtime transport.

The four GitHub bodies contain public organization-owned repository metadata,
short functional descriptions, ordinary API/avatar/clone URI templates and null
`temp_clone_token` slots. The three nonempty homepage fields are metadata only;
no linked homepage was fetched or promoted into the reader projection. The four
Crossref bodies contain the selected bibliographic fields, author arrays, ORCID
references and deposited license links. No contact values, credentials, patient
records, abstracts, article bodies, README text or code were identified in the
native bodies. HistoReg's institutional postal affiliation text is retained as
publication metadata. ModelArray's HTTP CC BY-NC-ND license URI remains an
unprojected native reference, not a reader link or permission for article reuse.

The official [GitHub API terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#h-api-terms)
and [Crossref metadata licensing guidance](https://www.crossref.org/documentation/retrieve-metadata/#licensing)
were checked during review. The existing limited factual listing/link basis
remains appropriate to these selected fields. It is not a blanket software,
README, article, image or third-party license. HistoReg's research-use restriction
and the other software/license uncertainties are not recast as general permission.

I independently read four bounded snippets through the GitHub connector at the
specified immutable commits. All four explicitly ask users of the named software
to cite the selected work; DOI, blob SHA and returned permalink agree with
Terra's separately retained derived facts:

| Repository | Commit | Citation file | DOI |
| --- | --- | --- | --- |
| PennLINC/aslprep | `48a418cf92b57c5c66502286d2847fd742cbbd48` | `CITATION.cff`, lines 7–10 | `10.1038/s41592-022-01458-7` |
| mlcommons/GaNDLF | `3f9b7726925be0f97a8a0eb108c8f35b19ff50dd` | `README.md`, lines 42–65 | `10.1038/s44172-023-00066-3` |
| CBICA/HistoReg | `5f7290781ae519b5ae930e85be594576576df853` | `README.md`, lines 12–27 | `10.3390/app11041892` |
| PennLINC/ModelArray | `b38bb2582d38e82040e25aa5b08c98161287411a` | `README.Rmd`, lines 106–110 | `10.1016/j.neuroimage.2023.120037` |

These are repository-to-publication citations. The QSIRecon publisher-to-repository
observation was not inverted or used in this batch. The bounded GaNDLF citation
snippet also returned its BibTeX abstract through the connector; no source text
was saved to a file or projected. Only factual citation verification was retained.
Connector observations remain distinct from native HTTP response bodies.

## Meaning and projection

The result contains 22 listings: ten repositories, ten publications and two
organization background records. The original fourteen record objects remain
unchanged. Four new directed citations bring the total to six. Publication and
repository records of a project are not independent projects or benchmark cases.
The new roster lengths are 114, 42, 6 and 18, totaling 180 additional source
authorship entries and 289 overall. ASLPrep includes a name-only consortium entry
and variant names; the count does not represent distinct people or local staff.

Only HistoReg's new native Crossref record supplies Philadelphia affiliations.
Its six named authors retain eleven individual affiliation entries. ASLPrep,
GaNDLF and ModelArray retain their empty native affiliation arrays. Terra's dated
publisher observations provide separate selection rationale; their content is
not silently inserted into Crossref fields. The GitHub `mlcommons` account remains
the repository owner, not a Penn or CBICA institutional identity. None of the
records establishes current employment, individual code authorship, physical work
location, local creation or clinical effectiveness. GaNDLF's title mentions
clinical workflows as source-reported bibliographic text.

Every selected native field and all author entries were checked against their
actual source pointers and hashes. Every new citation's edge, file and timestamp
was compared with its separate observation. The API output excludes unselected
homepages, ORCIDs, avatar/clone URLs, license-reference URLs, native internals and
private workspace paths. Its complete JSON serialization was 87,030 UTF-8 bytes
at this review point. The UI replaces only literal XML `&amp;` with an ampersand
in affiliation display; stored values remain exact, and no HTML parser or HTML
insertion is introduced.

Eight independent probe groups pass: deterministic projection, unchanged baseline
records, exact field/role/geography boundaries, absent affiliations and searchable
consortium, all four directed citation contexts, six adverse identity/pointer/
roster/relationship/extra-field substitutions, output exclusions and bounded
plain-text affiliation formatting. An initial probe used system Node 18 and
failed because its global Web Crypto was unavailable. That harness failure was
retained; the established project Node 22.23.2 wrapper passes. Sol's expanded test
diff was independently reviewed, including all-six-edge rehashed observation
substitutions and React escaping of markup-shaped affiliation text.

## Evidence and remaining qualification

Private evidence is under
`/workspace/build/builderbob/tvd-pilot-expansion-20261116/astra/`:
`native-inspection.json`, `offline-preflight.json`, `citation-verification.json`,
`projection-probes.mjs`, its JSON/log results, the retained initial harness-failure
log, explicit Node 22 log/report and `baseline-document-hashes.json`. The probe JSON binds the eight reviewed
implementation/selection/test inputs. No runtime files were edited by this reviewer.

Source retention and projection review pass. At this initial review point, final
source-commit binding, full-suite results, protected historical-artifact comparison
and final metadata reconciliation remain pending. Browser results follow below. Public activation,
release and independent held-out benchmark work remain separate gates.


## Independent browser result

The frozen build passed 50 assertions in an isolated loopback Worker at
`http://127.0.0.1:4178`. The flow was directory entry, search each new repository
within publications, follow repository metadata, then return to publication
metadata and inspect source actions and author details. The Browser plugin was
unavailable, so the frontend-testing-debugging skill's Playwright fallback used
the existing Playwright 1.64.1 and Chromium headless shell 1248 with the sanitized
Node 22.23.2 wrapper. No dependency was installed.

Page identity, meaningful content, one main landmark, absence of an error overlay
and console/page-error checks passed. All four new pairs navigate in both
directions while keeping the citation meaning directed. Every evidence link
matches the reviewed immutable source permalink. The ModelArray evidence action
was clicked and its target intercepted; no repository file or article was fetched
by the browser. Existing Google Fonts were permitted to load.

ASLPrep expands to exactly 114 source author entries, including the consortium;
searching ALLFTD shows that entry in the matching preview. GaNDLF keeps the
`mlcommons` organization-account owner and reports its missing native affiliations.
HistoReg's eleven affiliations remain attached to six authors and carry the 2021
publication qualifier. Their ampersands are readable text while the API preserves
the native `&amp;` values.

All seven screenshots were inspected at 1440×1000 or 390×844. The directory, long
ASLPrep roster, GaNDLF repository, consortium search, mobile entry, HistoReg
affiliations and ModelArray citation context are readable without horizontal
overflow in the exercised views. Search and Apply remain in the initial mobile
viewport. Long titles and complete author rosters require ordinary scrolling;
this is unchanged from the accepted expandable layout.

The first browser run timed out waiting for navigation completion after the test
itself fulfilled the outbound citation request with HTTP 204. Its log and seven
screenshots are retained in `browser-initial-navigation-harness/`. The completed
rerun uses `noWaitAfter` for that deliberately intercepted action; no application
change was needed. `browser.json` records the 50 assertions, zero application
errors, intercepted URL, seven screenshot paths and hashes of the six frozen
selection/runtime/test inputs. `browser.mjs` and `browser.log` reproduce the run.

No remaining finding blocks this local expansion. Other browsers, assistive
technology, full accessibility conformance, production behavior and benchmark
accuracy are outside this check. Final metadata reconciliation is still pending.


## Independent regional-source corroboration

A bounded additional check corroborated the three publication-specific regional
associations whose native Crossref fields are empty. The [ASLPrep PubMed record](https://pubmed.ncbi.nlm.nih.gov/35689029/)
explicitly maps Azeez Adebimpe and Matthew Cieslak to affiliations 1 and 2, both
Penn units in Philadelphia, in its June 2022 record. The cached primary
[GaNDLF publisher rendering](https://www.nature.com/articles/s44172-023-00066-3)
lists Sarthak Pati and Siddhesh P. Thakur under its Penn AI2D/CBICA Philadelphia
affiliation, with additional Philadelphia units, for the 2023 paper.

For ModelArray, the cached primary [PMC article rendering](https://pmc.ncbi.nlm.nih.gov/articles/PMC10119782/)
explicitly gives Chenying Zhao affiliation references a, b, c and d. Its a-entry
identifies PennLINC/Penn Psychiatry in Philadelphia; b through d also identify
Philadelphia units. The cached [publisher rendering](https://www.sciencedirect.com/science/article/pii/S1053811923001830)
agrees on Zhao's four letters and identifies the exact 2023 DOI. This is an
explicit author-affiliation mapping, not an inference from a university name,
repository owner, nearby affiliation list or regional participant dataset.

Access limits remain visible. My ModelArray PubMed open returned only an HHS
disclosure link; its cached search result listed affiliations without preserving
the author-to-affiliation mapping and was not sufficient alone. The orchestrator's
Nature redirect failures, ScienceDirect refusal and PMC browser check were not
retried or bypassed. Cached primary search renderings are evidence of the named
publication facts, not new native HTTP captures or evidence of fresh direct
access. No source body, abstract or contact text was saved. Only factual checks,
URLs, mapping keys and limitations were recorded privately in
`regional-source-verification.json`.

These checks strengthen historical Philadelphia selection rationale. They do not
fill the three empty native affiliation arrays, locate software creation or
establish current roles. The runtime remained frozen throughout.

## Final EX30 metadata reconciliation — 16 November 2026

The pending statements above describe earlier review points. Final reconciliation
passes against source commit `84bb755e48b9985707e8ccfa5b9241d11b93d8bc`. Its 29
changed files are exactly the six runtime/selection/test outputs and 23 new
source-evidence files recorded in the receipt. All match the commit and current
files. My six-file browser freeze matches, and all 630 validation inputs remain
unchanged. Before this append, all nine document-output hashes and 81 private
artifact hashes matched their files. This append requires refreshing the new
receipt's review-document hash; earlier receipts remain untouched.

The eight portable native bodies are exact copies of the reviewed staged bodies,
with matching identity, SHA-256, byte length, request URL, capture time and HTTP
receipt. Native metadata, pinned connector citation facts and publication-source
regional observations remain separate. The final catalog retains all fourteen
original record objects and reports 22 records, 289 source authorship entries,
eight non-null descriptions, six directed citations, 449 native field pointers
and eighteen derived observation references. The three absent Crossref
affiliation arrays remain empty. The final documents preserve the access limits:
my corroboration did not retry the blocked opens; the source qualification note
also records the orchestrator's later Nature lookup encountering the same barrier.
Neither observation is described as a successful new native capture.

I read the finalized logs: 939 application, 146 Watch and 357 Discovery tests
passed, totaling 1,442 with zero failures, skips or cancellations. All six normal
validation commands exited zero; seven PDF regressions passed and the dependency
audit reports zero vulnerabilities. The root's post-build record confirms 48
browser assertions and three assembled Worker/bundle groups. I also inspected
its final desktop, HistoReg and mobile captures. Those are reconciled root
results, not additional independent executions or additive coverage claims.

Byte comparisons confirm all 91 frozen manifest entries, native model/contracts/
receipt, the historical WP03 material index, strict reference manifest and
production configuration are unchanged. All 149 earlier source-evidence,
receipt and review files match the baseline. The original 31 package objects
are identical. MP01–MP03 now carry bounded EX30 local acceptance; every prior
acceptance is preserved in history. MP00 and MP04 remain unchanged. The actual
benchmark still has zero cases and reviewers and remains `not_frozen`.

The active plan, selection, source assessment, preview instructions, integration
record, execution state and new receipt agree on scope and results. No metadata
discrepancy remains. Public activation, merge and deployment are not accepted.
Exact delivered-head CI remains a separate handoff requirement on PR30. The new
private `final-metadata-reconciliation-20261116.json` and its accompanying
`final-metadata-check.py` record the comparison without rewriting previously
bound artifacts.
