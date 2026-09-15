# Research Register and Tool Decisions

Research date: 2026-09-12. The initial research plan contains additional source
context. References are primary documentation or upstream repositories. Reading a
page establishes a documented capability, not production access, current source
health, license approval for a particular deployment, or a tested integration.

## Product Patterns

| Reference | Adaptation | Do not copy blindly |
| --- | --- | --- |
| [Councilmatic](https://github.com/datamade/django-councilmatic) | Bill/person/body/event identities; list/detail/history relationships | Its Django/Solr stack is not a reason to replace the existing application |
| [Open States scrapers](https://github.com/openstates/openstates-scrapers) | Jurisdiction-specific mappings and fixture-driven adapter organization | GPL-3.0 code adoption requires license review; primary status remains official |
| [Open States API](https://docs.openstates.org/api-v3/) | Supplemental normalized member/legislation discovery | API access, freshness, and attribution still need qualification |
| [Thoughtworks Radar](https://www.thoughtworks.com/radar/faq) | Explain context and changing evaluation over time | Do not label technology "adopt" without actual editorial evaluation |
| [Database of Databases](https://dbdb.io/browse) and [code](https://github.com/cmu-db/dbdb.io) | Typed database attributes and comparison-friendly directory | Dataset, database engine, and commercial data platform are different objects |
| [Hugging Face Papers](https://huggingface.co/papers) | Dated papers linked to authors/organizations/artifacts | Popularity is not local eligibility or study quality |
| [ecosyste.ms](https://repos.ecosyste.ms/) | Optional supplemental repository metadata | Recheck authority, freshness, access, and service terms before depending on it |

## Policy Integration References

| Source | Documented integration lead | Qualification still required |
| --- | --- | --- |
| [Congress.gov API](https://github.com/LibraryOfCongress/api.congress.gov) | Structured legislation/action/member API | Key, fields, pagination, text linkage, each chamber's vote coverage |
| [Federal Register](https://www.federalregister.gov/developers/documentation/api/v1) | Regulatory discovery API; link official rendition | Exact field/date/correction semantics and authoritative text linkage |
| [Regulations.gov](https://open.gsa.gov/api/regulationsgov/) | Docket/document/comment context | Read-only key access, limits, and endpoint semantics; no comment submission |
| [PA downloads](https://www.palegis.us/data) | ZIP/XML history, printer/amendment links, member/RSS leads | Current sample parsing, archive sizing, session reconciliation |
| [NJ downloads](https://www.njleg.state.nj.us/downloads) and [FAQ](https://njleg.state.nj.us/faq) | Access databases, votes, document/member data | Actual schema/readme, current members, fresh detail path, runtime |
| [DE JSON](https://legis.delaware.gov/JsonFeed) and [RSS](https://legis.delaware.gov/RSSFeed) | Categorized legislative changes | Exact General Assembly endpoints and full-session completeness |
| [NJ OAL](https://www.nj.gov/oal/rules/portal/) | Active rulemaking portal | Individual agency/text/status adapters |
| [DE Regulations](https://regulations.delaware.gov/) | Register/agency regulatory entry point | Issue discovery, extraction, source date and action mapping |
| [Philadelphia Legistar](https://phila.legistar.com/Legislation.aspx) and [API help](https://webapi.legistar.com/Help) | Matters, people, bodies, meetings, attachments | Actual Philadelphia client access and completeness; not assumed verified |

PA Bulletin/IRRC and all county-body endpoints remain specific enrollment work.
The planning registry includes a target URL only when used as a documented entry
point; it does not claim that a homepage is a production feed.

## Technology Integration References

| Source | Use | Limit |
| --- | --- | --- |
| [GitHub releases](https://docs.github.com/en/rest/releases/releases) | Stable release records and repository linkage | Ordinary tags are separate; no release date inferred from a commit |
| [GitHub API practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api) | Conditional requests, pagination, rate handling | Webhooks require controlled/opt-in repositories |
| [PubMed E-utilities](https://www.ncbi.nlm.nih.gov/books/NBK25501/) | Bibliographic/affiliation discovery | Search metadata is not a full-paper review or verified artifact relationship |
| [OpenAlex API](https://help.openalex.org/api/) | Works/institution/author discovery using identifiers | Disambiguate campus/affiliation and verify consequential facts upstream |
| [ORCA repository](https://github.com/Stephonomon/orca-cds) | Worked local technology profile | No source execution or new release qualification in this task |
| [ORCA license](https://github.com/Stephonomon/orca-cds/blob/main/LICENSE.md) | Restricted-source label and access conditions | Recheck exact revision; deployment permission is not inferred |
| [ORCA paper record](https://pubmed.ncbi.nlm.nih.gov/40419254/) | Bibliography and regional affiliations | Full study was not reviewed |
| [CaPTk](https://github.com/CBICA/CaPTk) | Candidate local imaging software | Candidate only until artifact/license/evidence review |
| [OpenPedCan](https://github.com/d3b-center/OpenPedCan-analysis) and [D3b](https://d3b.center/) | Candidate research/data workflow with institutional context | Not automatically a current release or production-ready system |
| [Open Source Definition](https://opensource.org/osd) | Distinguish genuine OSS from restricted public source | A GitHub badge or model classification is insufficient |

## Engineering Tool Selection

| Tool / pattern | Decision | Gate |
| --- | --- | --- |
| Existing TypeScript, Zod, React, TanStack, D1 | Reuse | Follow installed versions and local helper APIs |
| [Muse 1.3 Contributor](https://openrouter.ai/meta/muse-spark-1.3-contributor) | Evaluate then configure exact model | Account/data policy, holdout, latency, cost, deterministic gates |
| Existing XML/HTML/feed and bounded fetch helpers | Extend first | Per-adapter samples, completeness and failure fixtures |
| [Scrapy](https://github.com/scrapy/scrapy) | Optional batch-only crawler candidate | Demonstrable need beyond current adapters; packaging, maintenance, license |
| [Trafilatura](https://github.com/adbar/trafilatura) | Benchmark extraction candidate | Better measured extraction without losing evidence binding |
| [RSSHub](https://github.com/DIYgod/RSSHub) | Pattern/route research, not default upstream dependency | Access, maintenance, license, completeness per route |
| Existing pypdf/PyMuPDF staged workflow | Reuse after staged review | Version-bound rendering/extraction; PyMuPDF AGPL/commercial license assessment |
| Access database tooling | Qualify during W05 | Correct NJ sample/readme, native dependency pinning, bounded offline execution |
| [ical-generator](https://github.com/sebbo2002/ical-generator) | Proposed serializer | Workers bundle/runtime and required fields proven |
| [ical.js](https://github.com/kewisch/ical.js) | Proposed independent test parser | Round-trip fixtures; not a second handwritten serializer |
| [Lucide](https://lucide.dev/guide/packages/lucide-react) | Proposed icon library where existing app lacks one | Scoped dependency/license review; accessible names |
| Playwright | Rendered mockup/application validation | Use existing host installation; do not infer UI correctness from typecheck |

Dependencies are proposals until qualified and pinned in a reviewed lockfile. Do
not use an unpinned CDN in production, add runtime Python to the Worker, or install
every researched library. Source-specific structured parsers are generally smaller
and more reliable than a generic model-driven scraper.

## Engineering References

- [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/):
  prepared statements and transactional batches. Do not assume separate calls are
  one transaction.
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/): qualify actual
  bindings/row sizes and batch shape against current limits.
- [SQLite table constraints](https://www.sqlite.org/lang_createtable.html): nullable
  unique keys do not provide the intended identity guarantee.
- [iCalendar RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html): event identity,
  precision, serialization, and revision behavior require explicit tests.

## Research Limits

This package did not inspect production D1, change provider configuration, run paid
model evaluation, qualify every proposed endpoint, or deploy anything. The prior
research browser could not open the publication's live pages; local source and
mockup checks are not a live screenshot audit. Historical operations notes remain
dated evidence. Follow exact qualification tasks rather than interpreting a link
in this register as a completed integration.
