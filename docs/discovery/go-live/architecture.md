# GL architecture: a maintained regional health-tech directory

EX33 authorizes implementation with Terra and independent Sol review, and deployment of the readiness-qualified existing-site candidate. The methods and thresholds below remain proposed until their package is executed; earlier planning-only language describes EX32 and does not revoke that later authorization. No deployment has occurred.

Planning baseline: `60d6bd3aaba90a4970821f41fb2ca0329cbf8d20`. This document proposes implementation; no source acquisition, enrollment, migration, application change or deployment occurred. GL00–GL11 identify shared plan packages, not accepted operating authority.

## Delivery shape and existing seams — GL00, GL01

Build an internally operated service that anyone can read. The public product is **Health-tech research**, with ordinary navigation, useful search and stable details. Remove public “pilot” naming from copy, metadata, accessible labels and URLs when the replacement is ready. Internal module names can survive an initial compatibility period; a naming cleanup must not expand the patch unnecessarily.

The current finite projection is a useful foundation: `scripts/build-discovery-pilot.mjs` verifies retained metadata and derived observations; `src/content/discovery-pilot.ts` validates v3 catalog/results; `src/ingest/discovery-pilot.ts` supplies deterministic one-hop search; `src/ingest/discovery-pilot-page.ts` provides a Worker-rendered fallback. `src/ui/discovery/DiscoveryPilotPage.tsx` already renders source roles, native affiliations and separate regional contexts. Its 28 records are historical regression material, not the future admission quota or coverage benchmark.

Keep this directory separate from the legacy editorial catalog in `src/content/published-catalog.json`, Watch and their publishing rules. Root routing changes belong in `worker.js`, `src/router.tsx`, `src/ui/Layout.tsx` and `src/ui/HomePage.tsx`. Inventory every affected public/private route at GL00; preserve existing news, events, voices, Watch and policy behavior.

Introduce focused directory modules beside the existing ones, with explicit adapters from v3, rather than silently redefining `discovery-v1`. Suggested boundaries are `src/content/discovery-directory.ts`, `scripts/build-discovery-directory.mjs`, `src/ingest/discovery-directory.ts` and `src/ui/discovery/DirectoryPage.tsx`. Freeze the first contract after representative examples, including an unpublished personal repository; adjust names during GL01 before implementation spreads.

## Small records and explicit claims — GL01, GL04

A repository needs no paper, complete biography, ORCID, verified employer or popularity threshold. It needs an identifiable source artifact, a substantive health-tech basis, a supported regional connection and a reviewed public field set. A lab account, personal account, small project and mature consortium are all eligible. Preprints and substantive technical discussions can also enter independently. A missing optional relationship stays missing.

Use source-native IDs as anchors: GitHub numeric repository/account IDs; DOI/PMID/arXiv or installation-scoped discussion identities when those sources are actually present. Names and GitHub paths are mutable labels. Provider and work kind have no universal one-to-one mapping: a preprint need not have a DOI, and a discussion need not be hosted by GitHub. Preserve version and publication-stage distinctions. Keep repository owner, paper author, identified person, institution and project separate. An account can have a public detail without being resolved to a real person. A standalone project with a permitted primary project page and supported health/region claims is admissible without a repository or paper. Assign its own stable internal ID; a missing provider-native ID stays null. Additional artifact-to-project grouping needs reviewed relationship evidence.

Implement strict Zod contracts using existing dependencies. A minimal sketch is:

```typescript
type DirectoryWork = {
  id: string; revision: number;
  kind: 'repository' | 'publication' | 'preprint' | 'discussion' | 'project';
  nativeId: string | null; title: string; url: string;
  description: Sourced<string> | null; sourceDate: SourceDate | null;
  purpose: { text: string; evidenceIds: string[]; reviewId: string };
  checkedAt: string; claimIds: string[]; relationIds: string[];
};
type Sourced<T> = { value: T; evidenceId: string; pointer: string };
type LeanClaim = {
  id: string; revision: number; subjectId: string;
  kind: 'health-purpose' | 'topic' | 'regional-connection' |
        'professional-affiliation' | 'project-role';
  value: unknown; // strict discriminated schemas, never arbitrary public JSON
  evidenceIds: string[]; asOf: SourceDate | null;
  currentness: 'historical' | 'checked-current' | 'unknown';
  reviewId: string;
};
```

Define each claim’s value schema at GL01. Regional values identify the supported subject/role, institution, campus or municipality, county, date precision and scope qualification. Keep separate evidence for the affiliation and county mapping. A postal name, headquarters, adoption site or historical paper affiliation cannot locate a person’s current work. The v3 publication-bound regional context remains valid historical data; add repository/project/account claim forms rather than fabricating a publication endpoint.

Relations are directed and independently supported: repository→paper citation, paper→repository code availability, account→repository ownership, person→project contribution and account→person identity resolution are different assertions. Do not infer one from another or merge people by matching names. A creator page aggregates only reviewed links; unresolved labels remain source-scoped. Public source descriptions stay source descriptions. A short curated purpose statement may summarize supported project facts, with evidence and review references; it need not copy a source sentence. Missing native description does not block this minimal purpose field when a permitted project observation supports it. Unsupported model-generated claims, particularly clinical-benefit claims, remain outside the public field policy.

Freeze schemas, ID rules, date semantics, relation predicates, public allowlists and examples together. Include changed names, transfers, forks, consortium authors, uncertain dates, no-description repositories and cross-county campuses. Preserve current 22/28-record digests during the compatibility adapter work.

## Independent discovery and a bounded review queue — GL02, GL03, GL04, GL09

Make GitHub discovery independent of publications. Maintain a versioned query/source inventory combining health domains, technical terms, county/campus/institution anchors and known public lab or personal accounts. Include wearable sensing, sleep, clinical NLP, imaging, assistive technology, public health, biomedical data tools and infrastructure with a substantive health application. Generic AI plus a local institution does not suffice.

Use several discovery paths: bounded repository search; inventories of qualified lab/account repositories; institution project/software pages; explicit repository links in publications; and human suggestions. Publications enrich a repository when available, but never gate its discovery. Record query, source, observation date, continuation/truncation, exclusions and candidate IDs. Inspect low-star, recent, archived, sparse-description and personal projects intentionally. Treat forks as candidates with explicit fork relationships; neither count every fork as independent work nor discard a substantive derivative automatically.

Reuse actual code selectively. `src/ingest/discovery/github.ts`, `crossref.ts`, `pubmed.ts`, `arxiv.ts` and `institutional.ts` contain native parsing and bounded source contracts. `source-registry.ts`, `runtime-contract.ts`, `endpoint.ts`, `transport.ts`, `collector.ts` and `collection-store.ts` provide controlled collection seams. The synthetic adapter in `adapter.ts` is not a production provider. Qualify each source installation, endpoint family, metadata field/material use, parser version, request budget, continuation and failure outcome before invoking a real collector. Public availability alone is not reuse qualification.

Initially support explicit, operator-run batches and offline review using immutable factual observations and a small revisioned candidate ledger. Proposed CLI boundaries:

```typescript
discover(scope: QualifiedScope, budget: BatchBudget): Promise<CandidateBatch>;
review(candidate: CandidateRef, expectedRevision: number,
       decision: LeanReviewDecision): Promise<ReviewReceipt>;
buildDirectory(input: ReviewedSelection,
               loadBytes: LocalEvidenceLoader): Promise<DirectorySnapshot>;
```

Discovery stages a candidate; it cannot publish. Reconstruct evidence, confirm health purpose and the regional assertion actually being made, select permitted lean fields, then accept, hold or reject with a reason. A reviewed record enters a releaseable projection only through the new reviewed lean-publication contract. An accountable operator can direct agent reviewers under the orchestrator; lean index curation requires no new two-person human panel. Human release authority remains separate. Topic and purpose suggestions may assist reviewers; model confidence cannot authorize an assertion. Missing papers or biographies are not hold reasons; unresolved essential health/region evidence is.

Original WP14 automated admission and WP16 public projection are not accepted by this design. `docs/discovery/wp14-entry-plan.md` documents unresolved authority/bridge dependencies; `discovery-store.ts` and existing migrations contain deliberate safeguards. GL01 must define and review this narrower, internally operated directory publication contract explicitly. Do not bypass old triggers, claim original package acceptance or make a universal 360-case benchmark a prerequisite for every lean record. Future automated admission requires its own evidence and operating decision.

## Search that answers ordinary questions — GL05

Extend the current literal/NFKC/casefold/dash-aware search with reviewed topic assignments and a small versioned alias table. Parse a query into literal terms, recognized topics, institution/county names and optional source identities. Search the work’s own fields and supported claims, with the existing single evidenced relation hop for linked records. Return match reasons and claim/source references. Never combine terms from unrelated neighbors.

For “sleep AI,” require both sleep relevance and a supported AI/machine-learning topic. SleepBoost’s ensemble classifier can receive that topic after evidence review; its title need not contain “AI.” Explain the topic match on the result. “Camden sleep” must retain the known useful repository/publication journey. A topic alias may broaden “AI” to reviewed machine-learning subtopics; it must not classify every program as AI. Exact names, URLs, repository paths and DOI searches remain useful fallbacks.

Provide topic, institution and county browse links using the same query contract. Show which dated connection caused a county match. Empty results mean no match in this indexed selection; offer literal/name alternatives and a suggestion route without inventing regional absence. Freeze query normalization, alias version, ordering/tie-breaks and explanation structure. Add known positives, plausible negatives, phrase variants, unpublished works and ambiguous names; measure useful results on real reader tasks before adding embeddings or generated expansion.

## Front door, cards and lean details — GL06, GL07

Put an obvious search and directory entry on the homepage/navigation while retaining editorial sections. Make each card answer quickly: what the artifact is; its evidenced health-tech topic; its supported regional connection/date; available code/paper links; last checked; and the next action. Show the reviewed short purpose statement and, where useful, its native description; do not invent an abstract or imply unsupported clinical value. Keep technical provenance in an accessible disclosure rather than competing with the main action.

Add stable ID-backed work and creator/account routes beneath `/discover`, using readable labels as optional decoration. Detail pages collect the evidence, dated roles, source discrepancies and related artifacts. A lean creator journey shows the source-backed display label, account/professional/project links, verified affiliations where available and linked work. It does not require a full biography or treat a paper author as a code contributor.

Use `pilot-presentation.ts` as a compatibility reference, not the permanent search-as-permalink design. Renamed/transferred repositories retain stable internal URLs; redirects preserve aliases without overwriting history. Worker HTML and React must use the same validated projection/query functions. Provide server-rendered search/detail content, labels, keyboard navigation, focus behavior and meaningful loading/error states. Do not make JavaScript or a provenance expansion necessary to find the original artifact.

## API and storage proportional to measured growth — GL01, GL04, GL05

Expose a versioned directory API, with legacy `/api/discovery-pilot` compatibility handled deliberately in GL11. Validate GET/HEAD, query keys, byte limits, HTTPS links, duplicate parameters, dates and strict response envelopes. No public request triggers provider collection. Return bounded pages, suggested initially 25 records with a maximum of 50; choose final byte/latency budgets against GL00 measurements.

Freeze these proposed interfaces at GL01 before independently implementing clients:

| Read surface | Proposed contract |
| --- | --- |
| `GET /api/discovery/v1/works` | `q`, `kind`, `topic`, `county`, `institution`, `sort`, `after`, `limit`; strict scalar values; response has snapshot, items, explanations, bounded supporting records and next cursor. |
| `GET /api/discovery/v1/works/:id` | One visible work plus its permitted claims, sources and direct relations; fixed missing/tombstone semantics. |
| `GET /api/discovery/v1/creators/:id` | One reviewed person/account identity and lean supported roles/links; no implicit person resolution. |
| `/discover/work/:id`, `/discover/creator/:id` | Server-rendered HTML and matching React detail; encode IDs canonically and retain stable links through source renames. |

Bind opaque cursors to snapshot revision, canonical query, sort and page position. Changed/removed snapshots must produce a fixed restart response, not repeat or silently skip records. Freeze support-record behavior: explanations can include a directly related publication absent from visible items, but it must bind native identity and claims and cannot inflate result counts or leak unrelated records. Reuse the current v3 supporting-publication regression approach.

Start with deterministic server-only JSON snapshots and precomputed searchable fields; cache only validated data by snapshot digest. Separate list summaries from large author/evidence details to control response size. Pagination must precede expansion beyond the current 100-record envelope; increase limits only after measuring build size, Worker memory/CPU, p95 query time and response bytes. If those budgets fail after indexing/field reduction, benchmark the existing D1 path with ordinary indexes. Adopt database-backed search or another index only after reproducing a measured bottleneck and qualifying snapshot/removal behavior. Do not add a distributed search service or broad schema migration by default.

## Maintenance, invalidation and controlled release — GL08–GL11

Track checked-at separately from publication date and repository push date. Begin with bounded operator refresh batches, prioritized by active use, age and source-change risk; measure queue age and time spent before choosing an automated schedule. Record unavailable, rate-limited, deleted, transferred and stale outcomes honestly. A failed refresh cannot renew an affiliation or imply deletion.

Corrections append a revision and invalidate dependent claims, search fields, cards, details, support records and cursors. Tombstones suppress removed records and aliases where required; permitted non-content audit metadata may remain. Rebuild the projection and test absence across every endpoint. Rollback must apply the latest tombstones/revocations to the previous good code/data, rather than restoring removed content. Maintain an emergency directory-disable path independent of legacy editorial availability.

Launch with visible **Report a correction** and **Suggest a project** links on directory/detail views, targeting an existing contact channel verified during GL08. Suggestions enter a bounded internal queue; accept links and correction reasons without automatically fetching arbitrary URLs. A custom form is optional and needs separate input, abuse, privacy and authentication decisions. Reuse `ops-access.ts`/`ops-jwt.ts` for reviewed private routes; existing Ops access does not itself grant a discovery publication action. Do not expose private ledgers, raw source bodies, credentials or full query logs. Log operation/source/snapshot IDs, durations and typed outcomes; review any query analytics separately.

GL09 reports discovery effort, reviewed eligibility, stale/held candidates and known gaps by county, institution, source path and project type. It must expose personal/unpublished/low-visibility coverage without quotas or claims of census completeness. GL10 runs actual find/open/identify/correct tasks with readers, keyboard/screen-reader checks, mobile/desktop browsers, performance measurements and negative source-boundary cases. Failures reopen the relevant contract, query inventory or card design. GL11 then binds the exact reviewed release, mandatory existing checks, route compatibility, monitoring and rollback rehearsal. Root’s policy/release plan owns activation; this architecture grants none.

Extend `test/discovery-pilot.test.ts` through a compatibility suite and add focused directory suites to the actual enumerated package command. Concrete cases include a reviewed personal repository without a DOI becoming findable; a same-name account remaining separate; a corrected campus claim disappearing from old county searches; two unrelated neighbors failing a combined query; a removed supporting paper invalidating its explanation; and a cursor restarting after that removal. Each implementation package supplies these examples and its changed dependency map to GL10; tests do not substitute for reader observations or external source truth.
