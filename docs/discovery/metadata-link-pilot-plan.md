# Metadata-and-link pilot — active delivery plan

Decision EX28, 16 November 2026. The user authorized a metadata-and-link pilot,
optional full-text reuse, and benchmark review as a separate workstream. This
amends the active delivery sequence; it does not revise the frozen handoff,
model, reference manifest, historical receipts or empirical thresholds.

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
