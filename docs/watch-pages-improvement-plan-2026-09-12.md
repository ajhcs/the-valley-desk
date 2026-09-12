# The Valley Desk: News, Events, Policy Watch, and Technology Watch

Research and improvement plan, 2026-09-12. This document proposes implementation;
it does not change the application, model configuration, collection, or production.

Implementation handoff: the [detailed engineering blueprint](watch-v1-blueprint/README.md)
expands this research into contracts, work packages, clickable mockups, tested
reference examples, source qualification templates, and explicit release gates.
Follow that package where it gives a more specific implementation decision.

## 1. Product decisions

Make the primary navigation **News / Events / Policy Watch / Technology Watch**.
News remains the daily front page. The Watch pages give readers lasting records
they can revisit as a policy, project, or product changes.

Confirmed by Cole in this task:

- Policy Watch includes federal policy and PA, NJ, and DE regional coverage in
  the first release. NJ and DE are launch requirements.
- Technology Watch includes only technology with a **verified Delaware Valley
  connection**. General healthcare relevance alone is insufficient.
- Preserve the strengths of News and Events and make focused improvements.
- Plan the move to `meta/muse-spark-1.3-contributor` and substantially broader
  collection from public feeds, structured data, and appropriate scrapers.

Recommended treatment of Voices: retire it from primary navigation and the home
page. Keep existing published permalinks and attribution intact. Treat supported
public statements as possible evidence for relevant stories. The Watch launch
has no dependency on social-platform access. Record the retirement in source
configuration when implemented so deliberately inactive collection is not
reported as an outage. The currently paused external collector stays paused.

Use the existing coverage geography from `fixtures/coverage-pack-v1.json`:

| State | Regional counties |
| --- | --- |
| PA | Philadelphia, Bucks, Montgomery, Chester, Delaware |
| NJ | Camden, Burlington, Gloucester, Salem, Atlantic |
| DE | New Castle |

This is the publication's existing coverage definition, not a claim that it is
the only definition of the Delaware Valley. Preserve existing edge-system rules.
Statewide measures qualify when their documented scope affects regional
healthcare organizations; a bill does not need to name an individual hospital.
Municipal and county coverage uses explicit jurisdictions within these counties.

## 2. Starting point and work to reuse

Repository inspection found meaningful existing infrastructure:

| Existing capability | Evidence in this checkout | Implication |
| --- | --- | --- |
| Durable collection and publication | `src/ingest/automation.ts`, `persistence.ts`, `editor.ts`, `verification.ts` | Extend raw persistence, evidence gates, retry state, and the published overlay. |
| Official-source registry | `fixtures/official-source-registry-v1.json` | 68 configured entries: 16 news, 19 events, 18 policy, 3 product, 3 procurement, 3 finance, 6 filing. Configured does not mean currently healthy. |
| RSS and chapter collection | `fixtures/origins-first-wave.json` | Six news feed entries, including one marked misconfigured, and two dedicated event adapters. These counts are not counts of unique sites. |
| Policy identities and history | `src/content/schema.ts`, migration `0027` | Bill/session/version records, applicability, advocacy, and review milestones already exist. |
| Local product relationships | `fixtures/product-watch.json` | Five relationships, including ORCA. Extend identity and relationship types beyond vendor adoption. |
| Public presentation | `src/router.tsx`, `src/lib/kind.ts`, `src/content/queries.ts` | Policy and AI currently appear under News. There is no dedicated technology kind or Watch navigation in this checkout. |
| Model integration | `src/ingest/editor-model.ts`, `wrangler.jsonc` | Muse 1.2 Contributor is already integrated with split classification/copy contracts, schema checks, and evidence validation. |

### Reconcile branches before implementation

The working checkout is `29e6a4e` on `codex/valley-desk-hardening`. The production
note last records build `e0d03be` and schema `0027` on September 7; this task did
not freshly verify that production state. That build contains subsequent source,
model-response, and slug fixes that are absent from the working checkout.

The worktree `/mnt/d/worktrees/plumbob/tvd-pa-release-acceptance` is at
`23972f4`, containing migration `0028`, version-bound PDF capture and review,
`PolicyBaselinePage`, `/policy`, and `/api/policy-watchlist`. Its
`docs/policy-pdf-review-workflow.md` was inspected through Git. It is explicitly
a local candidate, with operator-initiated PDF processing and incomplete
interpretation work. Automatic PDF collection, feeding page evidence into the
news editor, production reader delivery, and sustained timeliness are not proven.

The first implementation task must reconcile these exact candidates and review
the staged work. Extend the existing PDF/provision models and baseline page.
Choose new migration numbers after reconciliation. Preserve the historical
2h17m20s policy disposition miss and original observation times.

ORCA also exposes a concrete identity correction: the existing product registry
labels it with `vendor: "Epic"`. Its creator/rights holder, supporting EHR, local
institution, and distributor should become separate fields. An Epic integration
does not make a tool an Epic product.

## 3. Research findings and reusable examples

The following references were inspected as public documentation or repository
content on September 12. The adaptations are design recommendations; none of
these services has been installed or qualified as a production dependency here.

| Reference | Useful pattern | Application to The Valley Desk |
| --- | --- | --- |
| [Councilmatic](https://github.com/datamade/django-councilmatic) | Separate bill, person, organization, and event records with listing/detail views; Open Civic Data foundation. | Link policy timelines, responsible committees, representatives, and hearings. Keep the current React/Workers application. |
| [Open States scrapers](https://github.com/openstates/openstates-scrapers) and [API](https://docs.openstates.org/api-v3/) | Jurisdiction-specific legislative collection and normalized identities. | Study PA/NJ/DE mappings and use a qualified API as supplemental coverage. Preserve primary-source citations. Scraper code is GPL-3.0; copying it is a separate dependency/license decision. |
| [Congress.gov API](https://github.com/LibraryOfCongress/api.congress.gov) | Structured, paginated legislative data with documented endpoints and changes. | Collect federal instruments, actions, sponsors, and members using stable identifiers. Requires an API key. Verify each chamber's vote coverage separately. |
| [Philadelphia Legistar](https://phila.legistar.com/Legislation.aspx) and [Web API documentation](https://webapi.legistar.com/Help) | Legislative files connect to council bodies, meetings, and people. | Build Philadelphia policy records with agenda and member context. Client-specific API access still needs qualification. |
| [Thoughtworks Technology Radar](https://www.thoughtworks.com/radar/faq) | Explain a technology's purpose, context, and changing assessment. | Write useful evaluation briefs and retain change history. Our evidence labels describe documented maturity; editorial adoption recommendations need actual evaluation. |
| [Database of Databases](https://dbdb.io/browse) and [source](https://github.com/cmu-db/dbdb.io) | Structured comparison by data model, license, implementation, and documentation. | Give database entries domain-specific fields, not an undifferentiated technology tag. |
| [Hugging Face Papers](https://huggingface.co/papers) | Time-based research discovery with visible authors and organizations. | Provide a dated paper view with connected artifacts. Popularity is a discovery signal, not evidence of local relevance or clinical value. |
| [ecosyste.ms Repos](https://repos.ecosyste.ms/) | Repository and ecosystem metadata across hosts. | Consider supplemental maintenance/package metadata after checking freshness and access costs; verify release and license facts upstream. |
| [Scrapy](https://github.com/scrapy/scrapy) | Established structured crawling framework. | Use for a separate bounded batch collector only where an existing adapter cannot handle the source. |
| [Trafilatura](https://github.com/adbar/trafilatura) | Text/metadata extraction with feed and sitemap discovery. | Benchmark it against current extraction on difficult public pages before adding it to a batch collector. |
| [RSSHub](https://github.com/DIYgod/RSSHub) | Large collection of source-specific feed adapters. | Consult route implementations and discovery patterns. Qualify upstream access, maintenance, and license terms before adopting any route. |

The distinctive feature should be an evidence-backed connection between local
organizations, relevant policy, usable technology, and related events. Readers
can follow a development through time and reach its original documents without
having to reconstruct the context themselves.

## 4. Policy Watch

### Scope

Cover proposals, bills, amendments, committee actions, hearings, rules, guidance,
and resulting effective/compliance dates when material to regional healthcare
technology or operations. Initial topic taxonomy: AI and clinical decision
support; privacy and health data; interoperability; cybersecurity and resilience;
telehealth and digital access; Medicaid/payment and reporting; licensing and
workforce; public procurement and health infrastructure.

Include early co-sponsorship proposals as proposals, with their own identity and
source. Link to the eventual bill only when the relationship is verified. Track
negative and terminal outcomes too: withdrawn, failed, vetoed, expired, superseded,
and rescinded. Never infer enactment from an article, sponsorship, or one vote.

### Reader experience

`/policy-watch` opens on current developments in a compact, scannable layout:

- Jurisdiction control: Federal / PA / NJ / DE / Local, with county/municipality
  filters under Local; topic, stage, and affected-organization filters.
- Tabs: Latest Changes, Active Measures, Hearings & Deadlines, Representatives.
- Each result shows instrument ID/session, precise status, latest substantive
  change date, affected entities, and one sourced impact sentence.
- A nearby deadline list separates hearings, public-comment closing dates,
  effective dates, and compliance deadlines. Unknown dates are explicit.
- Save/follow controls use local browser storage initially, with shareable URL
  filters and section RSS. Email notifications can follow after the core works.

The detail page `/policy-watch/:slug` is a lasting dossier. Its reading order is:
plain-language purpose; current stage and what changed; applicability; responsible
people; next known dates; official history; source documents and reviewed analysis.
Use an activity timeline, not a progress bar that assumes legislation moves only
forward. Show document version and last verification beside consequential facts.

Retain separate labels for official legislative text, an agency's explanation,
an association's position, and reviewed editorial interpretation. Existing
evidence-specific approvals do not transfer to changed PDFs or amended text.
Where only a synopsis is available, omit unsupported provision-level conclusions.

### Representatives and responsible officials

Provide an integrated directory and compact person panels: name, office,
chamber, district, party from the official record, committee role, official
website/contact page, and last verification. On a bill, distinguish sponsors,
co-sponsors, committee members, and a reader's own representatives.

Use stable person/office/district identifiers and date-bounded office memberships.
Keep historical sponsors attached to the office they held at the time; refresh
current officeholders independently. Support multiple seats, vacancies, federal
senators, and Philadelphia district and at-large members.

For v1, allow district/municipality selection and link the jurisdiction's official
address-based lookup from the directory. A county or ZIP alone must not claim
to identify an exact legislative district. Store only the chosen jurisdiction
or district locally. In-app address geocoding is a later enhancement after
boundary accuracy and provider handling are verified.

### Policy source priorities

Every row below is in first-release scope. Source-specific endpoints and
credentials must pass qualification before being described as active coverage.

| Coverage | Preferred sources and transport | Qualification detail |
| --- | --- | --- |
| Federal legislation | Congress.gov API; linked Congress.gov/govinfo text; official chamber/member records | Incremental action windows with overlap; source IDs, session, sponsors, committees, text versions. API limits and source publication lag are recorded. |
| Federal regulation | [Federal Register API](https://www.federalregister.gov/developers/documentation/api/v1), [Regulations.gov API](https://open.gsa.gov/api/regulationsgov/), existing CMS/HHS/health-IT sources | Federal Register API needs no key; Regulations.gov does. Retain the linked govinfo official PDF, docket IDs, comment windows, corrections, and final-rule relationship. The FederalRegister.gov rendition is informational, not the official legal edition. |
| PA legislation and members | [Official data downloads](https://www.palegis.us/data), current committee/amendment RSS, bill details | Current-session bill XML comes in a ZIP and is updated hourly on weekdays. Add bulk reconciliation, member data, and broader healthcare-topic discovery. Preserve printer-number identity. |
| PA regulation | PA Bulletin, IRRC, DOH, DHS, Insurance Department official notices | Qualify exact publication/notice indexes and document links. Agency homepages alone do not establish regulatory completeness. |
| NJ legislation and members | [Official downloads](https://www.njleg.state.nj.us/downloads), [bill/calendar/member records](https://njleg.state.nj.us/), [documented data formats](https://njleg.state.nj.us/faq) | Batch bill tracking uses Microsoft Access databases; vote files and public details provide additional routes. Normalize in a batch process. Do not reuse the old GIS/member table on the downloads page as today's districts. |
| NJ regulation | [OAL active rulemaking portal](https://www.nj.gov/oal/rules/portal/), agency notices, DOH, Human Services, Banking and Insurance | Watch proposals plus subsequent adoption/expiration; verify current access to linked full text. |
| DE legislation and members | [Official JSON feeds](https://legis.delaware.gov/JsonFeed), [RSS directory](https://legis.delaware.gov/RSSFeed), bill details, member/committee directories | Prefer JSON where it contains sufficient fields. Feed URLs change by General Assembly; test session rollover and reconcile the full current session. |
| DE regulation | [Delaware Regulations](https://regulations.delaware.gov/), DHSS and Insurance notices | Qualify Register issue discovery, full text, and comment/adoption dates; no feed or parser was verified here. |
| Philadelphia | Legistar legislation/calendar, City Council members, official city regulations and health notices | Match matters, sponsors, hearings, amendments, attachments, and votes. Confirm exact client/API access before choosing API over HTML. |
| Other regional counties and municipalities | Official councils/commissioners, agenda centers, health boards, and procurement notices in the 11-county registry | Inventory every county and explicitly name monitored municipal bodies. Reuse Legistar or other documented agenda transports where available; qualify custom HTML/PDF adapters individually. |
| Context and leads | Existing HAP/NCSL sources; NJHA, Delaware Healthcare Association, local public-interest reporting | Association positions and reporting remain attributed. Corroborate legislative status against official records. |

First-release minimum: federal and all three state legislative/regulatory/member
families, Philadelphia, and a qualified local-government source or explicit
editorial monitoring assignment for every listed county. Publish a precise
coverage page naming monitored bodies and gaps; do not imply every municipality
or every policy area is comprehensively covered.

## 5. Technology Watch

### Eligibility and taxonomy

Require both healthcare relevance and a cited, verified regional relationship:
created/maintained by a regional institution or team; an attributed paper with a
regional institutional affiliation; documented regional deployment/pilot; or a
specific regional research partnership tied to the artifact. Employment alone
does not make all of a person's repositories institutional work. A conference
appearance, vendor sales office, GitHub location string, star, or general claim
of usefulness does not establish eligibility.

Store the relationship type, entity, evidence URL/span, verification date, and
validity period where known. `Built here`, `Research from here`, `Piloted here`,
and `Used here` carry different meanings. A pilot does not become deployment
when a page is re-fetched. Resolve institution aliases and lab affiliations,
including Penn versus Penn State, before allowing a match.

Cover software, papers, datasets, databases/data platforms, standards, developer
tools, and commercial products. OSS receives prominent filtering and editorial
priority, while clearly labeled source-available and proprietary tools can also
qualify. A paper can be included without code; state whether code was released.

Separate licenses for code, model weights, and datasets. Show SPDX identifiers
when verified and `custom`, `unknown`, or `not applicable` otherwise. Public
GitHub access does not establish an open-source license; the
[Open Source Definition](https://opensource.org/osd) includes redistribution
and field-of-use requirements.

### Reader experience

`/technology-watch` has three views: Latest Releases, Technology Directory, and
Papers. Search/filter by local organization, use case, resource type, license,
and documented evidence level. List rows pair a short explanation with the
verified local relationship, release/publication date, and material change.

`/technology-watch/:slug` gives the project a stable home with:

| Block | Required reader value |
| --- | --- |
| Purpose | What problem it addresses, intended users, and scope. |
| Local connection | Named institution/team and the exact relationship supported by evidence. |
| Workflow | Inputs, main processing/integration steps, outputs, and where it fits into existing work. |
| Getting started | Documented prerequisites, example-data/demo path, setup guide, required access, and realistic integration work. |
| Evidence | Paper/study links, evaluation setting, stated limitations, and documented deployment or pilot. Preprints are visibly labeled. |
| Availability | Code, documentation, paper, dataset/product links; licenses and access conditions for each artifact. |
| Maintenance | Latest release, repository status, version checked, material changes, and last verification. No inference that a quiet repository is abandoned. |
| Related coverage | Regional news, other versions/papers, relevant policies and genuine events. |

Use version-pinned documentation for instructions. Distinguish a maintainer's
documented setup from a setup the desk has actually tested. Any runnable example
we author is reviewed with synthetic/public data in an isolated environment.
The collector does not execute repository code or install discovered packages.

For database engines, add data model, query interface, deployment model, relevant
connectors, and documented workload. For datasets/data repositories, add schema,
provenance, update version, permitted use, and access requirements. These are
different resource types. Keep evidence status separate from clinical approval,
security certification, or a recommendation to use the product.

### ORCA as the first worked example

[ORCA-CDS](https://github.com/Stephonomon/orca-cds) is a CHOP-developed tool for
accessing a periodically extracted copy of Epic order sets during downtime.
Its documented workflow runs from a Clarity/warehouse extract through CSV and
Python conversion to a React viewer with offline caching. The repository's demo
uses fabricated content. A useful entry would explain that data flow, point to
the setup guide, and identify institution-specific extraction and deployment work.
It would state that this is reference access, not live order entry or patient data.

The [paper record](https://pubmed.ncbi.nlm.nih.gov/40419254/) verifies the CHOP/Penn
affiliations and the 2025 publication. This research checked the bibliographic
record, not the complete paper. Publication date, repository availability, and
software release date remain separate; no new release date was verified here.

The [actual license](https://github.com/Stephonomon/orca-cds/blob/main/LICENSE.md)
permits limited internal research/educational use, restricts commercial use, and
requires separate authorization for clinical/patient-care use. Label it
**source-available, restricted license**, with a link to the terms. Do not label
it permissive OSS or imply that a nonprofit hospital automatically has permission
to deploy it for patient care. Recheck the license at the pinned version.

Two additional seed candidates illustrate coverage breadth:
[Penn CBICA's CaPTk](https://github.com/CBICA/CaPTk) for imaging software and
[CHOP D3b's OpenPedCan analysis](https://github.com/d3b-center/OpenPedCan-analysis)
for research/data workflows. Each still needs a complete evidence and license
review. They are candidates for a baseline directory, not asserted new releases.
The [D3b institutional site](https://d3b.center/) supplies organizational context.

### Technology discovery

Start from regional institutions and work outward to their verified artifacts:

1. Map official institutional/lab pages to GitHub organizations and personal
   repositories explicitly linked by project documentation or papers. Include
   CHOP/D3b, Penn/CBICA, Jefferson, Temple, Drexel, regional Rutgers/Rowan teams,
   University of Delaware, ChristianaCare, and other in-scope institutions.
2. Monitor repository creation, releases/tags, README/CITATION/license changes,
   project docs, and package versions for qualified projects. Preserve GitHub's
   stable repository ID through renames/transfers. Forks need independent material
   value and verified local ownership to become separate directory entries.
3. Use [PubMed E-utilities](https://www.ncbi.nlm.nih.gov/books/NBK25501/) and
   [OpenAlex](https://help.openalex.org/api/) for affiliation-based discovery.
   Normalize institution identifiers; validate paper affiliations and artifact
   relationships against primary records. Join DOI, PMID, arXiv/version identifiers,
   repositories, and datasets without merging unrelated papers with similar titles.
4. Qualify publisher/preprint feeds and institutional repositories for research
   outside PubMed: JAMIA, Applied Clinical Informatics, JMIR, npj Digital Medicine,
   arXiv, bioRxiv/medRxiv, and relevant conference proceedings. These are source
   targets, not feed endpoints proven working in this task.
5. Add technology-transfer offices, engineering blogs, research news, product
   documentation/changelogs, and locally evidenced vendor channels. Global
   indexes can supply leads, but every public item must pass local eligibility.

GitHub [release endpoints](https://docs.github.com/en/rest/releases/releases)
exclude ordinary tags without an associated release. Poll both where appropriate;
never equate a new commit with a release. Use conditional requests, pagination,
and rate-limit handling following [GitHub's API guidance](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api).
Webhooks are useful only for repositories we control or whose owners opt in.

Known old projects belong in the Directory. Only a verified new paper, release,
dataset version, deployment, or other material development goes into Latest.
Indexing dates and our own first-seen times do not make an artifact newly released.

## 6. Broader collection that stays reliable

### Source enrollment

Prefer documented API/bulk data, then publisher RSS/Atom/JSON Feed/ICS, then
structured HTML/JSON-LD, then a narrowly scoped scraper. Use browser rendering
only when necessary for accessible public content. Respect source terms and
access controls; blocked/paywalled content remains an explicit coverage gap or
metadata-only lead. No anti-bot bypass, login scraping, or repeated hostile retries.

Create a source expansion worksheet with exact endpoint, owner, desk,
jurisdiction/institution, authority, format, access/license conditions, cadence,
pagination/completeness, last good sample, parser version, cost, and fallback.
Extend the existing registries with common metadata/helpers; avoid replacing
working source-specific contracts in one broad rewrite.

Use a two-lane enrollment process: automatically discover suggested feeds/links
within known official sites; qualify a representative sample and authority
before enabling collection. A model cannot add a trusted source to the registry.

Initial enrollment targets are planning ranges, not current coverage claims:

| Family | Expansion target |
| --- | --- |
| News | Qualify public newsroom feeds/indexes across the 16 covered systems and additional in-scope institutions. Extend local reporting leads from WHYY/Inquirer to outlets such as Spotlight PA, WITF, NJ Spotlight News, Delaware Public Media, and Technical.ly only after source checks. |
| Events | Preserve two chapter adapters; qualify 8-12 additional association, academic, health-system, innovation, and health-informatics calendars across PA/NJ/DE. |
| Policy | Federal and three-state legislative/regulatory/member sources plus the regional government-body matrix above. |
| Technology | First inventory 25-40 institution/lab/project channels and 50-100 locally verified repository or artifact targets. Do not fill quotas with weak matches. |

Count unique publishers, active endpoints, covered entities, and distinct useful
discoveries separately. Audit missed leads weekly with a small independent
editorial sample. Track which new sources actually add unique, eligible items.
Maintain a queue for further source enrollment after launch.

### Scheduling and storage

Keep the existing fast Worker path for feeds and small APIs. The current
40-source/20-detail stages and shared deadlines must be load-tested against the
expanded registry before increasing throughput. Reserve News and Events capacity
and give each Watch desk its own quota, retry budget, and backlog-age metric.
Within Policy, reserve coverage for each jurisdiction so a large federal or PA
backlog cannot starve NJ, DE, or local work.

Use a separate durable batch path for PA ZIP/XML, NJ Access exports, and PDF
processing. Prefer an existing qualified batch environment; if none exists,
select and provision one as an explicit implementation dependency. Reuse the
pending operator PDF workflow for first-release interpretation while qualifying
automatic extraction separately. A manual PDF hold is not an automated success.

The batch path emits bounded, schema-validated evidence packets tied to an
enrolled source and immutable artifact hash. Design a dedicated ingestion-only
credential/endpoint if needed; it cannot invoke publication or review decisions.
Preserve the existing API protection and raw-before-model persistence contract.
Compressed and expanded archive size, entry count, document count, and parse
time all have independent bounds.

Use conditional HTTP requests and content fingerprints; durable cursors with
overlap windows; idempotent upserts keyed to substantive changes; per-host pacing;
bounded retries; and periodic full reconciliation of the enrolled source set.
Reuse D1 for records/provenance and existing bounded PDF storage. Assess actual
volume before adding object storage; avoid building a second document store for
capabilities already in migration 0028.

Retain the current typed health outcomes. Healthy-empty, not-due, rate-limited,
parser-failed, and access failure must stay distinct. A secondary discovery
fallback does not restore primary authority or prove completeness. Repeatedly
unchanged sources do not require repeat model calls.

## 7. Muse Spark 1.3 Contributor

[OpenRouter's current model page](https://openrouter.ai/meta/muse-spark-1.3-contributor)
confirms the exact identifier, JSON-schema structured outputs, a 1,048,576-token
context window, and listed rates of $0.10/M input and $0.20/M output tokens as
of this research. It also states that prompts/outputs may be used to improve
Meta's products. Use public-source evidence for this tier; keep private operator
notes, credentials, subscriber data, and patient information out of its prompts.
No model calls or privacy-setting changes were made in this task.

Use its capabilities for better evidence selection, local entity resolution,
cross-document context, version comparison, and concise structured explanations.
Keep inputs bounded to relevant documents and definitions even with a large
context window. Never treat model confidence as publication authority.

Implementation sequence:

1. Verify endpoint access and supported request parameters with a small public
   fixture under the production account's intended policy. Use the exact
   Contributor identifier; no silent fallback to another tier/model.
2. Run an offline comparison of 1.2 and 1.3 on a frozen, editor-labeled corpus of
   approximately 100 cases spanning News, Events, PA/NJ/DE/federal/local policy,
   and local technology. Include no-change snapshots, stale dates, incorrect
   local matches, missing licenses, incomplete PDFs, and unsupported claims.
3. Keep the existing split classification/copy approach for the first model
   change. Add typed Policy and Technology enrichment contracts as those desks
   land. Align configuration, model defaults, examples, documentation, and
   verifier behavior without bundling unrelated model/prompt/gate changes.
4. Start with current reasoning/output budgets. Measure valid output, evidence
   errors, material-change recall, copy quality, latency, calls per candidate,
   retries, and actual token cost. Adjust reasoning per task only if the
   evaluation supports it.
5. Preserve Zod checks, literal evidence spans, claim ledger, freshness,
   publisher/region rules, second verification for high-risk stories, and
   human-attested policy interpretation. Schema-valid output can still be wrong.
6. After offline acceptance, run 1.3 in review-only shadow processing on a
   bounded sample, then switch the configured editor through the release gate.
   Record model ID, prompt version, source hash, and disposition on each attempt.
   Keep a rollback to the previously accepted configuration.

Acceptance: no additional unsupported publishable claims on the labeled set;
all critical date/locality/license/status failure cases held correctly; editorial
relevance and explanation quality at least match 1.2; processing stays within
the measured deadline/cost budget. Zero errors in a test set is not proof of
zero future errors. Better model intelligence remains a hypothesis until this
publication's own evaluation supports it.

For cost planning, 1,000 calls/day averaging 6,000 input and 1,500 output tokens
would cost about $0.90/day at those listed rates. This is an illustrative token
calculation, not a workload forecast; two or three calls per candidate, retries,
reasoning/output usage, and source infrastructure must be included in budgeting.
Track actual spend and enforce daily limits independently of per-run item caps.

## 8. Focused News and Events improvements

### News

Keep the lead, chronological reading experience, compact copy, strong local
relevance, and source links. Add URL-backed organization/topic/date filtering and
search. Connect follow-up stories through explicit story/subject IDs so readers
see the previous development and what changed without duplicate wire coverage.

Distinguish source publication date, substantive update date, and verification
date. Add correction notes when an already published fact changes. A hydration
refresh must not move a story to the top. Watch records can appear as relevant
News developments with one canonical article, plus a link to the lasting dossier.
Routine registry refreshes and minor repository commits stay off the News front.

Keep sourced impact/context concise. Use typed facts and short templates where
they give clearer prose under existing evidence gates. Unsupported explanatory
paraphrases still require review; do not loosen validation to make the new model
appear more productive.

### Events

Preserve Chapter Radar, why-attend information, verified registration links, and
existing calendar actions. Add filters for date range, county, topic, host, and
format. Show source-confirmed price, registration deadline, attendance mode, and
availability when present; unknown facts remain unknown.

Add an interoperable ICS download/subscription alongside the existing Google
Calendar action. Stable UID, timezone, update sequence, rescheduling, cancellation,
and duplicate-event handling are part of that feature. Use an established ICS
library/validator. Test America/New_York daylight-saving boundaries and date-only
events. Preserve completed/cancelled permalinks and the existing cautious
withdrawal rules. A registration closing date does not itself prove cancellation.

Policy hearings belong in Policy Watch's agenda. Cross-list a relevant public
session in Events only when attendance information is documented and it meets
the normal event standards. A bill's comment deadline is not a networking event.

## 9. UI and content architecture

Keep IBM Plex, the current wordmark/fold behavior, existing spacing conventions,
and editorial character. The home page retains the news lead and News/Events
emphasis, with compact Policy Watch and Technology Watch previews taking the
space currently allocated to Voices. Both Watch sections are first-class links.
Avoid a large dashboard hero or a total redesign of the successful sections.

Desktop: unframed result lists with a restrained contextual column for deadlines
or local relationships. Mobile: controls wrap in a stable layout, results become
stacked rows, and secondary context follows the primary facts. Use tabs for views,
menus for filters, labeled state badges, and accessible icons for save/calendar/
external-link actions. Status must be understandable without color.

Wireframe hierarchy, with no fabricated live policy details:

```text
THE VALLEY DESK   News | Events | Policy Watch | Technology Watch

POLICY WATCH
Latest Changes | Active Measures | Hearings & Deadlines | Representatives
Jurisdiction     Local area     Topic     Status     Search
Instrument + title              Latest action       Next confirmed date
Scope + sourced impact          Responsible body    Official source

TECHNOLOGY WATCH
Latest Releases | Technology Directory | Papers
Organization     Use case     Type     License     Search
Project + purpose               Local relationship  Release/publication
Documented workflow             Evidence level      Code / Docs / Paper
```

### Data and routing decisions

Use existing content and evidence systems with explicit extensions:

| Record | Design |
| --- | --- |
| Policy instrument | Extend existing `policy_instruments`; add stable jurisdiction/body IDs, measure type, lifecycle, and related instrument links. |
| Policy development/version | Reuse `policy_versions`, keeping source action and observed times distinct. Attach source-specific status and text identity. |
| Policy provisions/review | Reuse pending 0028 artifact/page/provision/review tables. Only reviewed interpretations can appear as interpretations. |
| Representative/office | Separate person, office, district, committee, and term memberships with primary provenance. |
| Technology resource | New lasting resource identity with artifact type, creator, supporting platforms, local relationships, evidence, and artifact-specific licenses. |
| Technology development | New `technology` content kind for dated releases/papers/deployments, tied to resource/version IDs. Keep the same shared ContentItem base. |
| Cross-links | Small typed relation table or existing helpers for policy/resource/article/event connections. No graph-database dependency for this release. |

Keep `Region` for high-level state/regional filtering; add explicit
`jurisdictionId`/geographic scope for federal, state, county, and municipal bodies.
Do not force Philadelphia into a new inconsistent state code. Keep raw source
statuses alongside normalized lifecycle values, including non-linear transitions.

Existing `/news/:slug` URLs remain canonical for already published policy/AI
stories. New Watch dossiers have their own stable identity and reference those
stories. Extend the staged `/policy` baseline into `/policy-watch`; provide a
redirect if `/policy` has been released by implementation time. Archived Voices
links retain their destinations. Audit router, Worker routing, crawler HTML,
canonical helpers, document metadata, sitemap, and feeds together.

The current machine feed is explicitly `version: "1"` with a closed kind enum.
Introduce a versioned v2 feed for `technology` and new contracts, using the same
ContentItem model as the site. Keep `/feed.json` v1 compatible during migration;
it must not unexpectedly send new enum values to old clients. Advertise the
versioned feed and section RSS. Existing news/policy/event items remain available
to v1 consumers. Apply the same versioning review to `/api/content`.

Serve Watch data through bounded, paginated public reads with indexes for
jurisdiction/stage/development date and resource/local entity/release date. Load
detail evidence on demand; avoid embedding all bill pages and repo metadata in
the homepage catalog. Retain a valid bundled published fallback and a clear
last-known-data state if dynamic storage is unavailable.

## 10. Delivery sequence and acceptance

Each milestone produces a reviewable change and evidence. Their sequencing
reflects dependencies, not permission to deploy or run live editorial actions.

| Milestone | Work | Completion evidence |
| --- | --- | --- |
| 0. Establish the base | Reconcile current checkout, recorded deployed fixes, and staged 0028 work; enumerate source gaps; capture labeled evaluation cases. | Agreed implementation base, source worksheet for all jurisdictions, fixtures, and existing publication/feed/URL invariants. |
| 1. Upgrade the editor | Qualify Muse 1.3; run paired evaluation; add observability/configuration changes; prepare rollback. | Evidence-quality comparison, measured cost/latency, all deterministic gates passing. |
| 2. Build shared Watch foundations | Extend source metadata, normalization, regional relationships, change identities, per-desk quotas, batch contract, and versioned feeds. | Duplicate/replay, stale/revision, pagination, provider failure, and cross-desk starvation tests. |
| 3. Deliver Policy Watch | Complete tri-state/federal/local adapters and representative views; extend staged baseline and PDF evidence; add list/detail/filter/deadline flows. | A real cited example from federal, PA, NJ, DE, and local sources; every county's coverage disposition; correct lifecycle and reviewed evidence. |
| 4. Deliver Technology Watch | Add artifact discovery, typed resources/releases, locally verified relationships, license handling, and useful detail pages. | ORCA end-to-end; additional software, paper, and data/database examples; correct rejects for unverified local connections and license ambiguity. |
| 5. Integrate the front page | Replace Voices navigation/home slot; add focused News filters/story continuity and Events filters/ICS. | Existing URLs and editorial lead behavior preserved; all four sections usable on mobile and desktop; calendar round trip tested. |
| 6. Qualify and launch | Run required repo checks, review real candidate content, qualify operational dependencies, then staged release and observation. | Exact-candidate receipt, accessible public pages, normal-cycle processing, truthful source health, and proven rollback. |

The full Watch launch includes both NJ and DE. Earlier internal previews and a
separately qualified Muse upgrade can be delivered before all Watch UI work is
complete. Directory seeding is editorial background and must not create false
breaking-news dates or bulk auto-publication.

### Proposed launch measurements

| Measure | Initial target and denominator |
| --- | --- |
| Eligibility correctness | Every published technology item has verified local provenance; every consequential policy field has source/version support. All specified negative fixtures must hold. |
| Coverage | All required federal/state families qualified; all 11 counties have named coverage or an explicit editorial assignment; monitored municipal scope is listed. Report actual sources, not just configured counts. |
| Policy timeliness | For continuously updated critical sources, target p95 detection within 60 minutes of demonstrable public availability, then a cited brief or explicit blocker within two hours of first discovery. Report those two intervals separately. |
| Batch source timeliness | Target one scheduled collection cycle after the source publishes a new batch. Report upstream hourly/weekday lag separately; a date-only action cannot prove sub-hour detection. |
| Technology freshness | Target release discovery within six hours for enrolled repositories and paper discovery within 24 hours of index availability. Track publication-to-index delay separately. |
| News/Events continuity | Existing scheduled capacity is reserved; backlog age and latency do not materially worsen under expanded-load tests or observation. |
| Deduplication | Replaying the same source/version has zero extra developments; multi-source reports link to one subject/version without losing citations. |
| Reader utility | Representative users can locate applicability/next date or purpose/prerequisites/local connection within 30 seconds in a short task-based usability check. |
| Operations | Each required source has owner, cadence, explicit outcome, last success, and bounded recovery. Track model calls/tokens/spend by desk and candidate. |

Observe seven normal-operation days and enough actual developments across source
families to assess timing. Report sample sizes and unresolved ages. Quiet periods
or zero eligible changes do not demonstrate a latency pass. A missing source
denominator or incomplete sample remains a disclosed limit, not a healthy badge.

Run the repository's required tests, build, secret scan, dependency check, and
local migration/scheduled smoke for the final candidate, plus the staged PDF
checks when that work is included. Add targeted tests for changed contracts,
real source fixtures, redirects/versioned feeds, amendment review invalidation,
representative term changes, and calendar behavior. Use Playwright to verify
desktop/mobile flows, keyboard access, loading/empty/stale/error states, long
names, and direct URL loading. A documentation lookup does not substitute for
rendered UI verification.

### Concrete remaining decisions and research limits

The product scope is settled by Cole's replies. Implementation still needs exact
endpoint qualification, credential/cost confirmation, county-body inventory,
batch-runtime selection, and a fresh production readback. These are engineering
discovery tasks, not reasons to reopen the scope questions.

This plan checked public examples and code, not every proposed feed or live API.
The research browser could not open the publication's live pages, and this task
did not perform a screenshot audit or inspect production D1. The source list
therefore distinguishes verified documentation from enrollment targets. Existing
operational notes are dated evidence, not a fresh assertion of production health.

Start with milestone 0 and the Muse evaluation, using ORCA and a complete
federal/PA/NJ/DE/local policy fixture set as the examples that drive the data and
UI contracts. Keep source expansion moving against the worksheet as each adapter
earns its qualification.
