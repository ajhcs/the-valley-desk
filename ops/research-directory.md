# The Valley Desk research directory

The site opens with healthcare research across the nine-county Delaware Valley. Search, entity pages and subscriptions work with the project collection alone. A reviewed publication import makes the same surfaces show both kinds. The production flag defaults to false.

## Language

| Choice | Tagline | Home headline |
| --- | --- | --- |
| 1 · implemented | Find and follow research connected to nine counties in Pennsylvania and New Jersey. | Healthcare research in the Delaware Valley |
| 2 | Search regional research and follow new listings by institution or topic. | Find research connected to the Delaware Valley |
| 3 | Follow additions to a source-linked directory of regional healthcare research. | Research across the nine-county Delaware Valley |

## What readers can do

| URL | Contents |
| --- | --- |
| `/` | Search, coverage counts, new additions, and the research software atlas. Publication counts group a preprint and its journal version. Project-specific maps and charts identify their denominator. |
| `/discover/works` | Search across available kinds. The mixed view supports kind, institution, topic and county, title order, directory addition date, and publication or repository activity date. Project-specific language, license, repository activity, account and other filters remain available through the project tools link. |
| `/discover/new` | Browse by date added. The seed collection entered on November 18, 2026. A paper can enter today with a much older publication date. A new code push does not move a project into today’s additions. |
| `/discover/updates.xml` | RSS 2.0. Use the feed link on an institution or topic page, or apply filters in What’s new and copy its feed URL. Examples are `?institution=drexel-university` and `?topic=medical-imaging`. A stable permalink identifies each item. The item date is the directory addition date at UTC midnight. Paged feeds expose an Atom next link for batches larger than 24. The old editorial feed URLs return 410. |
| `/discover/work/{id}` | Project, regional evidence, repository facts and papers. Historical project aliases still redirect. An indexed publication can connect through its project IDs or an exact paper identifier or URL. |
| `/discover/publication/{encoded-id}` | Publication type, title, venue, original date precision, byline, evidence label, connection sentence and affiliation source, directory dates, retraction status, connected projects and publication versions when present. A truncated byline gives the displayed and original counts. |
| `/discover/institution/{slug}`, `/discover/topic/{slug}`, `/discover/county/{slug}` | Connected listings and counts by kind. Search uses the same eight topic values as the project collection. Institution pages recognize reference IDs, names and aliases. Regional site links identify the source for an address. County filters use the record’s supported county. A reference site alone does not place a paper at that site. |
| `/discover/lab/{slug}` | Existing project collection for a GitHub lab or account. Author names remain on individual bylines and are omitted from the publication search index. |
| `/discover/methodology` | Inclusion and evidence definitions, date semantics, coverage, corrections, removals and machine access. |
| `/api/directory/listings`, `/api/directory/publications` | Paginated JSON, 24 per page. The combined endpoint returns kind-tagged records. The publication endpoint returns publication records. Both accept the common search and entity filters. The `total` field counts distinct works. `record_total` and `total_pages` include separately retrievable versions. |
| `/api/directory/publications/{encoded-id}` | One publication. The existing project collection and single-project JSON endpoints retain their envelopes. |
| `/sitemap.xml`, `/llms.txt` | Sitemap index with a directory part and parts of up to 5,000 publication URLs. Machine guidance advertises the publication API when visible publications exist. |

The entire identifier is a **single URI path segment**. Encode it once with `encodeURIComponent(id)`. Decode once after matching the prefix. In `doi:10.9999/fixture/a(b);%2f?x#y`, the slash becomes `%2F`, the literal percent becomes `%25`, and the question mark and hash become `%3F` and `%23`. The encoded DOI, PMID and arXiv routes were exercised locally. A removed publication still returns 410 when the last visible publication disappears and exposure remains enabled.

The shared SQL index stores a kind, persistent ID, title, searchable terms, topic, addition date, activity date, grouping key and source record. Facets associate one listing with several institutions or counties. Adding a trial or grant means mapping its reviewed record into those fields, registering its kind label, permalink and card, and supplying its detail template and safe API projection. Extend publication-specific discovery, removal and sitemap routing for the new source. Search, monitoring, entity navigation and pagination already share the same query and layout. No trial or grant collection runs in this change.

## Storage decision and cost

I checked Cloudflare’s D1 documentation for this design. Free allows 500 MB per database, 5 GB per account, five million daily rows read and 100,000 daily rows written. Paid allows 10 GB per database. Its included monthly usage is 25 billion rows read, 50 million written and 5 GB storage. Overages are $0.001 per million reads, $1 per million writes and $0.75 per GB-month. A SQL statement is limited to 100 KB and 100 bindings. Free permits 50 queries per Worker invocation and Paid 1,000. All cost estimates below assume the existing database and exclude Worker request charges. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) · [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)

Projects remain bundled for project-only launch, the historic catalog API, detail pages and the lab atlas. A complete project projection also seeds D1 when publications are enabled. This gives mixed searches one SQL order and one page boundary. I measured the project source at 2,480,916 bytes. For a warm localhost JSON query for imaging, 15 requests had median latency of 30.4 ms in project-only mode and 53.3 ms using the mixed index restricted to projects. The latter database had the project catalog and five publication fixtures. These paths use different search implementations. Publication JSON Lines are never imported into the Worker bundle.

**Observed scale test.** I generated 200,000 invented publications and loaded them with all 3,466 projects into SQLite using the migration, loader output and FTS5 triggers. The SQLite file was 460,398,592 bytes, about 439.1 MiB. I mounted that database as local D1 in Wrangler and fetched the actual Worker routes. The table gives the median and slowest of ten serial HTTP requests after a warm-up. It excludes internet, edge and production queuing time.

| Local Worker request | Median | Slowest |
| --- | ---: | ---: |
| Publication JSON, FTS query `tomography` | 113.0 ms | 140.3 ms |
| HTML results, institution and county together | 410.6 ms | 2,210.3 ms |
| Publication JSON, page 8,000 | 400.4 ms | 412.8 ms |
| All additions, HTML | 192.1 ms | 228.2 ms |
| Site-wide RSS, bounded next-page lookup | 43.2 ms | 46.2 ms |

The fixture concentrates records in one institution and uses short repeated titles, mostly two authors, and short example source URLs. A real backfill can exceed the Free database cap, especially in a database already serving other workloads. Exact filtered counts and deep offset pages have measurable costs. The feed reads one extra result to detect its next page without counting the corpus. I read 41 sitemap parts from the index and 5,000 URLs each from the first and last publication parts.

**Observed weekly import model.** I sent the generated statements through a loopback-only local D1 binding in batches of 40 and summed its reported row metrics. The revision changed the title and check date on each record. A production weekly cost depends on the reviewed batch and remaining account allowances.

| 1,000-record batch | Rows read | Rows written | Paid overage if all usage is above allowance |
| --- | ---: | ---: | ---: |
| Additions | 11,502 | 16,004 | about $0.0160 |
| Identical replay | 1,000 | 0 | about $0.000001 |
| Revisions | 18,003 | 18,506 | about $0.0185 |

Within the included allowance these incremental D1 row charges are $0. Backfill volume and available production storage require an operator check before release. The [rollout instructions](research-rollout.md) give the order, commands, checks and rollback.

## Verification

I ran the local checks described here. Production performance, account quotas and end-user assistive technology behavior are unmeasured.

- I replayed the [174 historical route cases](research-evidence/routes.tsv) against the local launch configuration. Status and redirect target matched for 147. The other 27 were Voices and Lab preview URLs changing from 200 to the requested 410. The old editorial feed routes retained 410. The existing project detail and JSON routes, lab collections, redirects, and sitemap aliases remained reachable. I also requested every case from live production on November 19. Of 174 cases, 143 matched the local candidate directly. In addition to the 27 retirements, production rejected the malformed percent escape with 400 before the Worker and redirected three ops URLs through Cloudflare Access. Local responses for those four matched the historical local baseline. Edge handling at deployment remains an inference.
- I loaded fixtures with a 400-author byline, a selectively retained 400-author byline, no DOI, linked preprint and journal versions, a retraction, a multi-site institution, and a deliberately malformed markup title. In the last case the renderer strips known inline formatting and escapes text. I ran the data agent’s draft JSON schema against all five base fixtures. It accepted four. Its title pattern rejected the deliberate markup case as expected. I ran its record-level cross-field validator against the invented institution and project reference, and all five returned successfully. I also imported a long byline exceeding one SQL statement into local D1. Thirteen statements, the largest 16,125 bytes, persisted 400 authors and left zero staging rows.
- In a running local Worker I inserted a publication tombstone and fetched the same eight surfaces before and after. The HTML and API detail returned 410. Search, additions, institution RSS, publication JSON, sitemap and the connected project stopped exposing the directory record. Dropping the local removal table produced 503 on all eight. Tests also exercise project removals, missing tables, empty publication tables, flag off, ID decoding, preserved first-added date, replay, full-text revisions and pagination. [Removal observations](research-evidence/removal.tsv)
- Chromium captured [42 screenshots](research-evidence/screenshots.md). I used the existing IBM Plex font CSS and font files for the captures. The final matrix had zero horizontal overflows, masthead collisions or automated axe findings against the tested WCAG 2 A/AA, 2.1 AA and 2.2 AA rules. I inspected the phone masthead, corrected a visible overlap, and recaptured the matrix. With JavaScript disabled, keyboard activation of Skip to content and the search and filter controls submitted the selected publication kind and institution at all three widths. These checks cover the exercised interactions. A full assistive-technology conformance audit remains open. [Browser observations](research-evidence/browser.json) · [Keyboard observations](research-evidence/keyboard.txt)

## Publication handoff

The in-progress reference file I inspected contained 69 institutions and 138 sites (SHA-256 `53a9fabac2dcd45884a9223a4e94cfd447e982dce8e0c6a8242d84035b3006c7`). Its normalized names and aliases matched 34 of the 36 distinct project institution strings. I loaded that file locally. The canonical Drexel ID and historic Drexel URL both showed 209 projects and four reference sites with either flag value before loading papers. The two unmatched values were “Childhood Cancer Data Lab, Alex’s Lemonade Stand Foundation” and “Code for Philly.” The site retains their existing project URLs and names. Please review an explicit alias or override for the first, and confirm the intended treatment of the second. Importing a reference alias never assigns a county to a paper.

Please consider a source-backed site ID per institution association on a work. Today the separate institution and county arrays can express two institutions and two counties without specifying which site belongs to which affiliation. The finder matches at the work level and the detail page links to the original source.

The draft schema permits a null open-access URL and a sorted array of publication IDs for removals. The implementation handles both. Please document directionality for `preprint_of` and `published_as`. The site can group a link supplied from either side, but a shared canonical work ID would make grouping several preprints or journal editions unambiguous. Keep version dates at source precision and reserve `added` for original directory entry. A reviewed correction carries the same ID.

## Separate legacy retirement proposal

Inventory the React newsroom, Voices, calendar, Lab previews and Watch screens under `src/ui/` and `src/router.tsx`, the retired feed/catalog assets, editorial collectors and schedulers, and their tests. Keep the 410 handler, removal and access controls, security headers, and active discovery dependencies. Inventory the authenticated ops, retention and inbound mail consumers independently before removing any shared code or database table.

**Measured bundle comparison.** I bundled the actual Worker and a measurement-only entry exporting just the public directory, canonical helpers, retirement handler and ops header helpers with identical esbuild minification, browser ESM target ES2022 and external Node builtins. The full bundle was 4,375,583 bytes (941,651 gzip). The reduced entry was 2,254,650 bytes (422,509 gzip). The 519,142-byte gzip difference is an **upper bound** for a broader carve-out that also omits operational entry points. The Vite asset directory contained another 859,101 raw bytes (255,260 individually gzipped). The directory HTML already loads its own static CSS and small scripts.

**Measured time comparison.** The local Watch launch test process took 24.02 s. Running just the Watch routing and scheduler sentinels took 1.09 s. On main’s hosted [CI run](https://github.com/ajhcs/the-valley-desk/actions/runs/44625251806), the overall Tests step ran 25 min 13 s. The Watch launch subcommand occupied about 63 s before discovery started. A future PR could recover much of that minute plus some earlier editorial test time. That saving is inferred. Discovery occupied roughly 22 min 36 s on that runner and the publication pipeline shares discovery code. A deletion PR needs its own complete CI measurement.

## Deferred work

The publications branch had no committed reviewed pilot at the time of this report. The checked-in site and measurements use invented publication fixtures. Real publication fit, indexing lag and the production backfill size remain unverified.

Production migrations, the production import, flag activation and deployment require a separate release decision. Email alerts need a consent and unsubscribe flow, a delivery provider and credentials, rate limits, and durable checkpoints for deduplicated delivery and removal suppression. Saved searches can begin as bookmarked filter URLs. Cross-device named searches would need a user identity or private token, storage for query state, and a way to edit and delete it.
