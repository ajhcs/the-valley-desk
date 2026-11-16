# Metadata-and-link pilot — active delivery plan

Decision EX28, 16 November 2026. The user authorized a metadata-and-link pilot,
optional full-text reuse, and benchmark review as a separate workstream. This
amends the active delivery sequence; it does not revise the frozen handoff,
model, reference manifest, historical receipts or empirical thresholds.

The active EX31 amendment below adds three county/institution connections and
separately sourced regional search/display context. Its qualification is recorded
separately from EX28–EX30.

## Outcome and limits

Help a reader find health-technology work and the people or organizations named
by its sources, inspect the dated regional evidence, and open the original
repository, publication or organization record. Deliver a small, finite directory
first. Do not claim a complete regional roster, measured relevance accuracy,
clinical effectiveness, current employment or individual code authorship.

The pilot uses selected factual fields from the retained public GitHub, Crossref
and ROR records. Initial scope is six repositories, six publications and two
separately identified organization background records. A repository is not a
prerequisite for a publication or organization listing. Repository owners and
publication authors remain distinct source-reported roles. A cross-source
relationship needs its own recorded observation; omit unsupported joins.

Publication-reported author affiliations are historical metadata. Show an
explicit city/county only when the selected source states the necessary place;
otherwise show that the regional basis is not established. Do not infer location
from institutional headquarters, organization ownership or a present-day record.
Do not present the historical affiliation as the location where software was
created. Describe repository push dates, publication dates and capture dates
separately; preserve date precision and unknown values.

## Three independent workstreams

1. **Pilot delivery:** inspect selected factual metadata, retain its source/time/
   digest/field trace and applicable published terms, build an allowlisted read
   projection, and implement find/filter/sort/display/original-source actions.
   Existing API terms or licenses can provide the basis; bespoke permission
   letters and WP03 human labels are not universal prerequisites. Source-specific
   restrictions still apply to the actual fields and intended use.
2. **Optional richer reuse:** abstracts, article bodies, README/code text, forum
   posts, photographs, logos and attachments need their own applicable reuse
   assessment. Exclude them from this pilot. A hold on copying such material
   holds that feature, not an independently permitted factual listing/link.
3. **Benchmark validation:** WP03's two independent human annotations,
   adjudication, family/exposure review, 360 held-out cases, independent recall
   frame and accountable freeze remain unchanged. E01–E06 stay unexecuted until
   their actual prerequisites exist. Their absence prevents validated-accuracy
   and complete-system acceptance claims; it does not prevent this explicitly
   scoped pilot. Never count pilot material as fresh held-out evidence.

## Work packages and dependencies

These pilot IDs are separate from the original WP00–WP30 acceptance ledger.
They do not rename partial work as accepted WP14/WP16/WP30. The original automated
admission/publication path retains its reviewed contracts and gates.

| ID | Owner / independent review | Dependencies | Deliverable and acceptance |
| --- | --- | --- | --- |
| MP00 | Orchestrator / Astra | User's EX28 authorization; accepted WP00–WP02 | Active scope, requirement mapping, ownership, dependencies and separate benchmark/full-text/release gates are explicit and consistent. |
| MP01 | Terra factual selection; Sol projection / Astra | MP00; existing retained material and source assessments | Offline deterministic builder verifies exact source hashes and field pointers. Strict projection contains only selected factual fields and safe links, with original provider IDs, dates, provenance and scoped use basis. No silent joins, contacts, full text or reference-corpus promotion. |
| MP02 | Sol query/API; orchestrator UI/integration / Terra and Astra | MP01 contract and reviewed output | `/discover` and bounded GET/HEAD `/api/discovery-pilot` support search, type/provider filters, stable sorting, useful empty/error states and source actions. Disabled by default behind exact `DISCOVERY_PILOT_ENABLED=true`; local activation only in this task. No D1 writes, live acquisition, scheduler or existing editorial/feed publication. |
| MP03 | Orchestrator / Terra and Astra | MP01–MP02 | Verify real retained-byte projection, adverse input/safe output, deterministic queries, disabled routing, HEAD/method behavior, browser interactions at desktop/mobile, accessibility basics, full existing checks and exact delivered-head CI. Record limits; benchmark validation stays separate. |
| MP04 | Future release owner / independent reviewer | MP03; explicit release authorization | Before any public pilot activation: check actual deployed configuration, intended field/use basis, age/freshness labeling, correction/removal procedure, operational ownership, rollback and final release tree. Deployment is not authorized here. No benchmark-accuracy claim without benchmark evidence. |

Engineering order: MP00 → MP01 → MP02 → MP03. API/UI development may overlap once
the DTO is shared; acceptance uses the actual integrated output. MP04 is held.
WP12/WP13 and full-text work continue only where useful to a selected source;
neither whole package is a prerequisite for this finite retained-metadata pilot.

## Implementation contract

Use a new isolated strict pilot DTO, selection file, generated catalog and
read-only handler, not the accepted-record DTO or an evidence-to-catalog bypass.
The offline builder reads only explicitly selected repository-local evidence
paths, validates hashes and field types, and emits a deterministic projection.
Browser code imports the DTO/query types only; retained captures and the catalog
are server-only. API serialization is an allowlist, never a spread of native
records or private review data. Projection disagreement must fail the check.

Every displayed factual value must be traceable to a selected field of a retained
response or a separately identified derived observation. Derived connector or
publisher observations are not native captures or human labels. Link observations
preserve direction and historical aliases. Unknown software reuse terms are not
reported as either a permissive license or a prohibition on factual indexing.

Safe HTTPS original-source links, escaped text and no remote images/iframes keep
source content passive. Bound search length and allow only supported query keys,
types and sorts. Use a stable native-identity tie-breaker and unknown dates last. Partial dates sort by the start of the reported interval
without changing the displayed precision.
Counts describe the selected collection, not all regional work. No opaque
relevance score or unsupported current-county filter is introduced.

Fourteen listings are not fourteen independent projects or reference cases.
Reject duplicate/unknown query keys consistently. Disabled page/API routes,
including HEAD and trailing-slash forms, must not read the catalog; encoded aliases
must not expose it through fallback routing. Enabled unsupported methods return
405 with `Allow: GET, HEAD`. Inspect the built browser output as well as source
imports for accidental catalog, native-body or private-path inclusion. Public
provenance contains safe source URLs/times/hashes/field locators, not workspace
paths or private review references.

The Worker and API enforce the feature flag independently of UI state; leave
production configuration, public navigation, feeds, sitemap and existing
publication gates unchanged. Preview through a loopback-only isolated local
Worker with the flag supplied for that process. No source collection is needed.

## Requirement and evidence correspondence

R01 (regional/temporal meaning), R02 (health-technology purpose), R03 (distinct
creators/accounts and independent people/work), R04 (provenance), R05 (typed
relationships, partial dates and rights), R10 (queries/order), R12 (reader actions),
R13 (accessible responsive delivery), R14 (freshness), R15 (legacy compatibility)
and R16 (safe retained data) guide this narrowed intermediate product. R17 applies
to independent software verification and the separation of empirical claims.
R06/R07's full six-route acquisition, R08's authenticated admission, R09's atomic
public projections, R11's snapshot pagination, full recovery and empirical
obligations remain future system work; a small static projection does not fulfill
them. This amendment supplies no new formal proof of them.

Inspection answers whether retained values and source-use records support the
projection. Tests answer schema, query, routing and output behavior. Browser
demonstration answers whether the selected user journey works in the exercised
viewports. None proves regional completeness, actual current employment,
clinical validity or benchmark accuracy. Preserve unavailable observations and
failed attempts. Acceptance is local software qualification only.

## Change and reconsideration rules

Expand a source or field only after checking its actual metadata/use basis and
adding its provenance and meaningful regression. Add current-person claims only
with dated person-specific evidence and a reviewed correction/expiry design.
Move from this finite projection to automated admission only through a separately
reviewed contract; a feature flag is not authority to bypass that work. Revisit
storage/query design when the selected collection outgrows the small bounded
snapshot. Full-text permission holds and benchmark results stay separately
visible in the active register.

Implementation/verification results are recorded in `execution.json` and a new
pilot receipt after independent review. Planned checks here are not results.

The [local preview procedure](metadata-link-pilot-preview.md) gives the isolated
Worker configuration and exercised reader tasks. Local acceptance and final
delivered-head CI are separate records; PR30 tracks the latter before handoff
completion. Neither authorizes public activation.

## EX29 — Product-review improvements

The user's request for Astra to review the pilot authorizes this bounded repair
pass. Fresh desktop/mobile flows found incomplete people search, missed retained
citation context, omitted repository purpose, excessive mobile height and unclear
source actions. The orchestrator implements repairs; Astra independently reviews
their actual behavior. Public activation remains held.

The v2 projection includes every author entry in each retained Crossref record,
in source order, with a 128-entry bound. The present six rosters contain 109
authorship entries, including repeated people across papers; this is not a count
of distinct local people or proof that Crossref reports every author of a work.
An omitted, duplicated, reordered or oversized roster fails rather than silently
shrinking the searchable set. Four short descriptions are selected from the
existing GitHub `/description` metadata fields; two null values stay null. These
plain source-reported descriptions do not include README/code/article content
or establish clinical validity or software reuse rights.

Search uses own metadata and at most one of the two retained citation edges.
Related context can find a cited paper from a repository name, or a repository
from its cited paper's authors. It does not create additional edges, person
entities, reciprocal citation assertions, repository authorship, current presence
or regional creation. The result identifies the matching context. Citation
endpoint summaries, evidence, counts and selected records must agree; missing,
duplicate, dangling or contradictory context is rejected. Metadata navigation
uses the existing `/discover` route and preserves the source citation direction.

The UI gives priority to search/results/original-source actions, displays
query-matched author previews with their own affiliation text, and exposes the
complete roster in one disclosure. Provider filters and technical traces remain
available as secondary controls. The layout supplies one main landmark and skip
target. Verification includes the failed search examples, all source rosters,
literal description values, unchanged role/geography boundaries, paired fresh
desktop/mobile captures, citation navigation, error handling and existing checks.
Version 1 receipts remain historical; new inputs and results receive an EX29
receipt. Neither benchmark thresholds nor the original package ledger changes.


## EX30 — Four additional evidenced project pairs

The user authorized expanding the pilot with real GitHub repositories and linked
publications in the DVRPC region, Sol/Terra implementation and Astra review,
commits and PR updates, with no deployment. This batch selects ASLPrep, GaNDLF,
HistoReg and ModelArray. Each has a project-specific request to cite its paper at
a verified immutable GitHub file. The catalog grows to ten repository records,
ten publications and two organization backgrounds; six directed repository
citations are represented. These listing counts are not independent-project or
benchmark counts.

Dependencies remain MP00 → MP01 → MP02 → MP03. MP01–MP03 reopen only for this
amendment's evidence, projection, display and requalification; prior acceptances
remain in history. MP04 remains held. Terra owns source selection and independent
field comparison, Sol owns regression adaptation and adverse binding tests, the
orchestrator owns bounded native capture, integration and delivery, and Astra
independently reviews whole bodies, actual pinned citation sources and behavior.
No new runtime relation type or API version is needed.

Acceptance requires eight successful, bounded native metadata receipts; exact
identity/hash/value/pointer agreement; full source author arrays; independently
checked pinned repository-to-paper citations; dated author-specific regional
selection evidence; safe text rendering; deterministic queries and both metadata
browsing directions. Repeat the normal suite/build/PDF/smoke/audit/secret checks,
inspect desktop/mobile source journeys and record delivered-head CI separately.
The source assessment and new receipt must distinguish native bytes, derived
connector facts and publisher observations.

Only HistoReg's new Crossref response supplies affiliation strings. The other
three remain empty in the projected API; separate publisher author/Philadelphia
evidence supports selection without filling those native fields. Repository
owners retain their actual account identities: GaNDLF's is mlcommons. No current
employment, code contribution, local work site or clinical validity follows.
The 180 new authorship entries include a consortium and possible name variants;
289 entries in the whole catalog are not a distinct-person count. HistoReg's
literal XML ampersands remain in retained metadata and are formatted as escaped
plain text only for display.

The eight new bodies have a pilot-only material index. All material is
development-exposed; the original source-material index and strict reference
manifest are unchanged, with zero new reference cases or human reviewers. The
existing fourteen record objects remain unchanged. Optional richer reuse,
independent benchmark gates, the original 31-package ledger and release authority
are unaffected. See [source qualification](qualification/pilot-expansion-20261116.md),
[integration record](metadata-link-pilot-expansion.md) and
[independent review](reviews/metadata-link-pilot-expansion-astra.md).


## EX31 — Broader institutions and counties with separate regional context

The user authorized real repository/publication expansion beyond Penn and
Philadelphia, Sol/Terra work, Astra review, commits and PR updates without
deployment. Select GASTON with Princeton/Mercer evidence, SleepBoost with
Rutgers–Camden/Camden evidence and OpenPBTA-analysis with a Rowan–Glassboro/
Gloucester coauthor connection. The latter is a historical multi-institution
collaboration involving Penn/CHOP; it is not Rowan-origin, Rowan-owned or evidence
of an independent new laboratory. No claim of complete county coverage follows.
Bounded Pennsylvania searches remain recorded as leads/exclusions, not absence.

Eight anonymous native metadata requests succeeded. Six bodies supply the three
new pairs. The other two concern THREAD and its cited preprint; exact-version
local affiliation was not established, so they remain research-only and do not
enter the catalog. The pilot now selects thirteen repositories, thirteen papers
and two organization backgrounds with nine directed citations. The three new
native author arrays contain 7, 5 and 66 entries, all without affiliations.

Merely adding these records leaves Princeton/Mercer/Rutgers/Rowan keyword queries
unanswered. V3 therefore adds separate top-level regional contexts with exact
native publication/hash/year/author bindings and independently reviewed
institutional/campus/county source facts. Neither native affiliation arrays nor
native record county fields change. All twenty-eight native record objects are
preserved from the first EX31 projection; the prior twenty-two are unchanged.
The new source context is displayed with named publication authors, publication
year, associated campus/county, sources, observation date/method and caveats.
It does not establish current roles, individual code contributions, repository
ownership, code origin or physical work location.

Selection/catalog/API versions become v3. Regional observation values bind to an
exact retained JSON hash and semantic `/contexts/N` pointer. Identity, year,
native snapshot hash, source-indexed author names, source URLs/dates/methods,
duplicate context/source/provenance checks and safe output are explicit. Direct
publication matches distinguish regional context from native metadata. Related
repository matches retain one-hop citation meaning. When a context-bearing
publication is absent from result items, separate supporting publication records
bind its native claims and citation summary; those records do not increase item
counts or create extra result cards. Unrelated, missing, duplicate or contradictory
support is rejected. Full county phrases and hyphenated campus terms are usable
without rewriting source values or merging people.

The dependency order remains MP00 → MP01 → MP02 → MP03. Reopen MP01–MP03 only for
this amended evidence/data/API/UI scope and requalification, preserving earlier
acceptance history. Terra owns source facts and independent comparisons; Sol
owns builder/schema/query and adverse regressions; the orchestrator owns native
capture, integration and delivery; Astra independently challenges facts, whole
bodies, software, browser behavior and final records. Repeat existing full-suite,
PDF/build/smoke/audit/secret gates and inspect actual county/institution journeys.
Record final delivered-head CI separately before handoff completion. MP04,
benchmark gates, original package/model evidence and deployment authority remain
unchanged. See the [county qualification](qualification/pilot-counties-20261116.md),
[integration record](metadata-link-pilot-counties.md) and
[independent review](reviews/metadata-link-pilot-counties-astra.md).
