# Watch Source Readiness: Offline Foundation

Prepared: 2026-09-12. Status: **implementation foundation only; no new source is
qualified, active, or production-enrolled by this work**.

This receipt covers pure source-enrollment contracts, RSS/Atom parsing, GitHub
repository/release/tag/commit parsing, and durable-acknowledgment preconditions.
It does not assert end-to-end collection, publication, regional coverage, or
operational readiness. All parser fixtures are synthetic and test-only.

## Implemented Boundary

| Component | Contract | What it does not authorize |
| --- | --- | --- |
| `SourceEnrollment` | Explicit pending/qualified/disabled state; stable ID; exact HTTPS endpoints; exact link hosts/path boundaries; source/parser identity; item/byte bounds | No registry write, scheduler activation, network request, or publication |
| `QualificationReceipt` | Configuration digest; named engineering/editorial owner IDs; review evidence; accepted rights/access review; two distinct samples; replay/negative-fixture hashes; expiry | A client/model flag or this document cannot create an operational receipt |
| `collectionReadiness` | Requires a separately resolved active-source set and current persisted, config-bound receipt | Does not replace lease, due-time, host budget, permission, or fetch controls |
| `WatchObservation` | Source/native key/parser/representation identity plus payload hash; fetch time separate from source publication | No inferred local affiliation, facts, release date, or OSS classification |
| Persistence boundary | Server-resolved write acknowledgments match exact representation and payload hashes before proposed model inputs | The helper neither writes data nor invokes a model |
| Checkpoint boundary | Every required page, including an empty terminal page, needs its own digest-bound durable receipt; all observation writes must also be acknowledged | A truncated, failed, rejected, missing, reordered, or unpersisted page cannot advance the checkpoint |

Source names, authority labels, endpoints, parser versions, limits, and date-zone
changes invalidate an existing qualification digest. State changes alone cannot
activate a source. Engineering/editorial identities and `reviewEvidenceId` must
resolve to real persisted review records in the eventual operational layer;
caller-provided JSON is not authority.

### Pure Adapter Inputs and Outputs

```ts
const parsed = await parseWatchFeedSnapshot({
  source: serverResolvedEnrollment,
  body: strictlyDecodedUtf8,
  representationBytes: retainedResponseBytes,
  finalUrl: registeredFinalUrl,
  fetchedAt: actualFetchTime,
  status: 200,
});

// The future persistence implementation supplies these receipts only after
// successful durable writes of the retained representation and observations.
const acknowledgments = await storage.resolveObservationWriteReceipts(parsed);
const proposedInputs = await proposedModelInputsAfterPersistence(
  parsed, acknowledgments,
);
```

The `storage` call above is integration pseudocode, not an implemented service.
The collector must retain bounded response bytes and relevant response/decoder
metadata, then persist immutable observations before enrichment. `fetchedAt`
is an actual collection time; replay resolves the original `firstSeenAt` instead
of replacing it. With supplied bytes, the parser verifies strict UTF-8 decoding
matches `body` and hashes the original supplied representation. The string-only
fallback hashes its UTF-8 representation for offline/in-memory inputs; it is not
proof that HTTP response bytes were retained. Other encodings need an explicitly
qualified decoder and provenance contract before enrollment.

`GitHubRepositoryBinding` is a numeric repository ID plus its current owner/name
alias. Resolve it from a successfully persisted repository observation, not a
search result, model output, or public client. A collector must refresh that
binding across renames/transfers or alias reuse before attaching new releases.
The returned alias is not the repository's stable identity.

### Supported Format Semantics

- RSS 2.0 requires a channel and its required metadata. Native GUIDs are opaque;
  URL fallback identity retains identifying query/fragment values. `pubDate`
  alone supplies publication time; missing/ambiguous dates remain unknown.
- Atom requires its namespace and core feed metadata. Entry `published` is not
  replaced with `updated`. Only an unambiguous alternate link is accepted;
  continuation links must match separately registered exact endpoints.
- Day-only dates stay calendar days with an explicit known/unknown source zone.
  Supported explicit timestamps normalize to UTC; invalid calendar days,
  inconsistent weekdays, and ambiguous zone syntax remain unknown. No inferred
  midnight or collection-time publication date is emitted.
- RSS/Atom are rolling partial discovery windows. A syntactically valid empty
  feed is `healthy-empty`/`empty-unverified`, never a complete active set. HTML
  error pages, malformed XML, DTD/entity declarations, oversized bodies, and
  invalid required structure do not become healthy-empty.
- GitHub repositories use numeric IDs; releases use repository ID plus numeric
  release ID. Tags have a separate tag identity and commit-bound revision;
  commit records are not release records. Unsafe JSON numeric IDs are rejected
  instead of rounded. Tag-only responses do not acquire invented release IDs
  or publication dates.
- GitHub release chronology uses `published_at`, not `created_at`, `pushed_at`,
  collection time, or the `/latest` endpoint's ordering. Drafts and prereleases
  remain explicit. Public visibility, owner profile/location, stars, and license
  hints never become reviewed local or code-license facts.
- Adapter results contain candidates/observations only. `publicationAuthorized`
  is always false, regional eligibility always unverified, and license authority
  always unreviewed. Instruction-like source text and draft releases cannot enter
  the proposed model-input list, even after persistence.

The format choices follow [RSS 2.0](https://www.rssboard.org/rss-specification),
[Atom RFC 4287](https://datatracker.ietf.org/doc/html/rfc4287), and the official
[GitHub release](https://docs.github.com/en/rest/releases/releases) and
[repository](https://docs.github.com/en/rest/repos/repos) API documentation.
Parsing reuses the repository's installed `fast-xml-parser`, identity helpers,
plain-text normalization, instruction-like-text detector, and source-health
taxonomy. No package dependencies were added.

## Required Launch Coverage Still Pending

The blueprint `source-plan.json` remains a **proposal, not a runtime registry**.
This implementation adds no replacement source inventory and no active entries.
Each row below needs exact endpoint/sample/rights/owner receipts and independent
editorial acceptance. Federal plus PA, NJ, and DE remain first-release gates;
this work does not reduce the launch scope to one state.

| Required policy family | Remaining qualification work |
| --- | --- |
| Federal legislation | Congress API access, current session/native identity, actions/text, bounded replay and catch-up samples |
| Federal regulation | Federal Register renditions, proposed/final/correction relationships, date precision |
| Federal dockets | Regulations.gov access, docket relationships, comment-window evidence |
| Federal members | Official current roster, terms, vacancies, member identity and lookup links |
| PA legislation | Existing detail/RSS path plus separate ZIP/XML reconciliation; package manifest, decoder, extraction host and resource limits |
| PA regulation | PA Bulletin/IRRC and relevant official notices; authoritative text and deadline mapping |
| PA members | Current official rosters, districts, terms, and historical role preservation |
| NJ legislation | Official detail/calendar path; separately qualified Access/vote-CSV schema and external batch host |
| NJ regulation | OAL/agency notice sources, current issue and proposal/adoption/deadline mapping |
| NJ members | Current official roster/lookup sources; old GIS downloads are not current-member proof |
| DE legislation | Current General Assembly's JSON/RSS endpoints, categorized actions and session rollover |
| DE regulation | Register/agency issue and notice identity, public text and source dates |
| DE members | Current official rosters, vacancies, terms, committees, and source as-of dates |

All eleven county obligations are also pending: **Philadelphia, Bucks,
Montgomery, Chester, and Delaware (PA); Camden, Burlington, Gloucester, Salem,
and Atlantic (NJ); New Castle (DE)**. Each needs named official bodies/sources
or an explicit, time-bounded editorial monitoring assignment. Municipal coverage
must be enumerated separately. The Philadelphia Legistar client/API still needs
exact-endpoint qualification; this receipt claims no county-wide completeness.

Technology leads such as CHOP ORCA, CBICA/CaPTk, and D3b/OpenPedCan remain
**unreviewed discovery candidates**, not qualified publication examples. The
release must accept artifact-specific evidence for a Delaware Valley creator,
maintainer, deployment, or other allowed relationship. A university-wide name,
profile city, event appearance, sales office, or repository popularity is not
enough. Reviewed code-license bytes are separate from dataset/weights licenses.

News and Events retain their existing registries and behavior. This slice has
not repaired the existing Technical.ly entry, enrolled more newsroom/calendar
sources, changed any feeds, or altered any existing editorial/public route.

## Operational Holds and Follow-Through

1. No fetcher, lease/scheduler, redirect executor, retry/backoff runner, per-host
   pacing, cache writer, secret lookup, or registry mutation is included here.
   The future collector must use registered exact destinations and the existing
   bounded fetch/health primitives. See GitHub's official
   [REST operational guidance](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api).
2. A bare HTTP 304 is held without a retained-good representation. A qualified
   conditional-request/cache orchestration path must reuse that representation
   without creating a new artifact or claiming a full inventory. It is not
   implemented by this parser-only slice.
3. GitHub pagination markers are supplied by a trusted collector after checking
   response pagination against registered endpoints. The pure parser never
   follows them. Atom marks registered continuation as nonterminal. Item caps
   stay partial/nonterminal and cannot checkpoint as complete.
4. All adapters conservatively report partial or empty-unverified snapshots.
   Only a separately qualified full-inventory reconciler may supply complete
   page receipts. Persisting a collector's unverified completeness boolean is
   not a substitute for that qualification.
5. RSS 1.0/RDF, JSON Feed, Atom XHTML content, relative URLs/xml:base, multiple
   alternate links, nonqualified date syntax/encodings, and nonstandard GitHub
   draft URLs require specific fixtures/adapters before enrollment. They are
   not silently treated as normal supported records.
6. PA ZIP and NJ Access tooling, extraction host placement, archive defenses,
   retention, and resource limits remain separate reviewed work. No archive
   extraction, binary-tool installation, or downloaded repository code execution
   is included.
7. Qualification receipts need real rights/access/editorial decisions, manual
   comparison, named owners, sample hashes, source cadence and freshness targets,
   alert ownership, and operational scheduling receipts. This document and the
   synthetic test receipts satisfy none of those live qualification obligations.
8. Accepted fact/evidence/local/license contracts still gate every public Watch
   projection. No route, model/provider call, ingestion run, source activation,
   deployment, or production data mutation occurred in this slice.

## Verification

Offline regression command:

```sh
node --import tsx/esm --test test/watch-adapters.test.ts test/watch-contracts.test.ts
node node_modules/typescript/bin/tsc --noEmit --project tsconfig.app.json
```

Tests cover exact scopes, qualification drift/expiry, real-calendar dates,
source-vs-collection clocks, replay identity, retained bytes, XML/error/size
handling, native-ID conflicts, raw/page write acknowledgment, partial pagination,
numeric GitHub identities, renames, release/tag/commit distinctions, and absent
publication/local/license authority. They cannot establish real-source rights,
current source availability, extraction-host readiness, public-launch coverage,
or production persistence integration.
