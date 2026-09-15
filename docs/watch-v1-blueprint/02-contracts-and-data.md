# Contracts and Data Design

Proposed names in this document are implementation targets, not existing APIs.
Do not assign migration numbers until W00 reconciles the staged `0028` work.

## 1. Domain Vocabulary

| Term | Definition | Must not be confused with |
| --- | --- | --- |
| Source | An enrolled endpoint/family with authority, access, parser, and owner | An arbitrary URL from a model |
| Observation | A bounded representation fetched at a recorded time | A verified fact or publication |
| Subject | Lasting policy instrument or technology resource | A news article about it |
| Artifact | A specific text, PDF, repository revision, paper version, or dataset | Its mutable download URL |
| Fact | A typed value with immutable supporting evidence | A free-form summary |
| Interpretation | Reviewed meaning based on a dependency set of facts/documents | Literal source text or advocacy |
| Development | A material, dated change relating to a subject | Re-fetch, indexing, or baseline seeding |
| Public revision | Accepted field-level projection for readers | The complete internal subject row |
| Office membership | A person occupying an office over a time interval | The office itself or a bill sponsor role |

## 2. Identity Rules

Use opaque application IDs for internal joins and retain explicit external keys.
The executable `tupleKey` reference hashes a versioned JSON tuple. This prevents
delimiter ambiguity; it does not resolve ambiguous source identity.

| Record | Canonical natural key | Special case |
| --- | --- | --- |
| Policy instrument | `(jurisdictionId, bodyId, sessionKey, instrumentType, sourceInstrumentId)` | Missing legislative session is a hold, not `NULL` or guessed current year |
| Standing guidance | `(jurisdictionId, issuingAgencyId, 'standing', 'guidance', officialDocumentId)` | Use `standing` only where a session genuinely does not apply |
| Policy action | `(instrumentId, authoritativeSourceId, sourceActionId)` | If no action ID, adapter supplies a documented tuple of source sequence, action code, date precision/value, chamber, text version |
| Text artifact | `(policyVersionId, artifactSha256)` | Same URL with new bytes is a new artifact |
| GitHub repository | `(host, numericRepositoryId)` | Owner/name is an alias that can change after rename/transfer |
| Release | `(repositoryId, numericReleaseId)` | Tag-only publications use a separate tag identity, never an invented release ID |
| Paper | Verified DOI, PMID, or repository-specific versioned ID | DOI normalization follows source metadata; do not merge by title similarity |
| Dataset | `(publisherId, datasetId, publisherVersionId)` | Dataset landing page and database engine are different resource types |
| Subject development | `(subjectId, developmentType, authoritativeEventKey)` | Multiple sources may support one development; source corroboration is not a new development |
| Office | `(jurisdictionId, bodyId, officeType, districtId/atLargeKey)` | Multi-seat offices permit multiple memberships; do not invent numbered seats |

Keep explicit aliases and `supersedes`/`related-to` edges. A replacement bill in a
new session is a different instrument, not a changed title on the old one. An
introduced proposal memo can link to a bill only with verified relationship
evidence. A fork is not automatically a new locally eligible technology.

For source-native identifiers, document case/whitespace normalization per adapter.
Do not lowercase opaque IDs globally. URL normalization reuses `identity.ts` and
its approved tracking cleanup; do not strip query parameters that identify bills,
documents, or versions.

## 3. Time Is a Typed Fact

Reference implementation: `examples/contracts.ts`, `SourceDate`.

```ts
type SourceDate =
  | { precision: "instant"; value: string; evidenceIds: string[] }
  | { precision: "day"; value: string; timezone: "America/New_York";
      evidenceIds: string[] }
  | { precision: "unknown"; reason: string };
```

The executable schema checks real calendar days, not only a regular expression.
Instants are normalized UTC ISO timestamps. Day values use `YYYY-MM-DD`. Capture
the source's exact label separately. Do not convert a date-only action to midnight
UTC and report sub-hour detection. Unknown time zones remain unknown until the
source context establishes them; not every future technology source is Eastern.
The v1 reference day schema deliberately covers the regional policy case only.

Required timestamp distinctions:

| Field | Meaning | May order Latest? |
| --- | --- | --- |
| `sourceOccurredAt` | Dated official action/release/publication fact | Yes, with explicit precision |
| `sourceAvailableAt` | Demonstrable upstream availability, if independently known | No; used for collection latency |
| `firstSeenAt` | Earliest successfully persisted observation, never reset | No |
| `fetchedAt` / `checkedAt` | Collection/check time | No |
| `acceptedAt` | Internal acceptance audit time | No, unless the development is an explicitly labeled desk publication |
| `publishedAt` | Actual desk publication time on a ContentItem | Preserve existing editorial meaning |
| `materialUpdatedAt` | Time of a new supported substantive revision | Only for the corresponding substantive update |
| `verifiedAt` | Last actual verification of the supported facts | No |

Latest developments sort by a documented `sortDay` (Eastern calendar day), then
known source time, then immutable development ID. Unknown-time entries have a
stable tie position explicitly described as unordered within the day. They must
not appear to have an inferred exact chronology. Unknown-date baseline subjects
belong in Directory, not Latest Releases.

## 4. Evidence and Trust

An evidence reference contains `observationId`, immutable representation hash,
source ID and URL, extraction/parser version, a literal quote or structured
field pointer, and the relevant artifact/page identity. Evidence is resolved
server-side from persisted rows; never trust client-supplied `verified: true`.

For normalized text, bind a quote to the hash of the exact normalized text and
normalizer version. For a PDF, retain both original byte hash and extraction/page
hashes. They are different digests and must not be substituted for each other.
Whitespace changes may leave a development fingerprint unchanged while still
creating a new observation/extraction identity.

An accepted fact has a value, unit/type, evidence IDs, verification rule/version,
and verifier identity/time. Consequential facts require evidence at their own
granularity: a general hospital mention cannot support a claim that all hospitals
must comply, nor can a repository's existence support a permissive license.

Interpretation bindings include:

```text
instrument + text version + artifact byte hash + extraction hash
  + provision evidence hash + referenced definition/exception hashes
  + amendment relationship + reviewer decision + rule version
```

W06 must compare the complete dependency set, not only the latest PDF URL. If one
dependency changes, the interpretation becomes historical and the current view
shows a review hold. Unaffected accepted metadata may still be visible. Do not
publish the old interpretation with a misleading new `verifiedAt`.

`evidenceMatches` in the reference code demonstrates literal binding only.
`interpretationApplies` demonstrates exact dependency equality only. Neither
function performs source enrollment, semantic verification, human authentication,
or the existing publication gate. Its comments and tests make that boundary
explicit so snippets cannot be mistaken for complete production authorization.

## 5. Proposed Relational Model

All JSON columns need schema validation at writes and at public projection.
Use non-null identity keys, foreign keys, bounded strings/arrays, and explicit
`ON CONFLICT` behavior. Reference laboratory tables use an `example_` prefix;
they are not production migrations.

| Table / extension | Important fields and constraints | Index / ownership |
| --- | --- | --- |
| `watch_jurisdictions` | ID, type federal/state/county/municipality, parent ID, name, coverage disposition, official URL | Parent/type; source owner |
| `watch_sources` or registry companion | Stable registry ID, family, transport, authority, exact endpoints/hosts, parser version, qualification receipt | Reuse existing schedule/health tables; do not duplicate them |
| `watch_observations` where existing source tables cannot represent the input | ID, source ID, external key, normalized/byte hashes, parser version, fetched time, bounded payload, completeness | Unique source/external/hash/parser; source/time; existing raw storage preferred |
| `policy_instruments` extension | Canonical identity key, jurisdiction/body IDs, instrument type, source-native ID; retain existing IDs and stage fields | Unique normalized identity after reviewed collision repair |
| `policy_actions` | Instrument FK, source action key, native code/text, chamber/body, date fact, evidence refs | Unique action key; instrument/date/order |
| `policy_versions` extension | Native text identity, authoritative action relationship, precision-aware development fact | Retain current IDs referenced by `0028`; no destructive recreation |
| Staged PDF/provision/review tables | Artifacts, chunks, pages, provisions, review decisions | Reuse `0028`; add dependency binding only where missing |
| `watch_people` | Stable ID, source identities, current display name, aliases | External identity unique per source |
| `watch_offices` | Jurisdiction/body/district IDs, office type, seat capacity, official lookup URL | Jurisdiction/body/district |
| `watch_memberships` | Person FK, office/body FK, role, valid-from/to, date precision, provenance | Person/time; office/time; half-open intervals |
| `policy_people_roles` | Instrument/action FK, membership/person FK, sponsor/co-sponsor/committee role, source date | Instrument/role; do not rewrite on term change |
| `technology_resources` | Stable ID/slug, resource type, purpose, creator IDs, supporting platforms, publication disposition | Slug unique; resource type; search projection |
| `technology_artifacts` | Resource FK, artifact type, host/native ID, version/commit, public URL, access state | Unique host/native/version identity |
| `technology_relationships` | Resource/artifact FK, regional entity ID, relation type, validity, evidence and verification | Resource/entity/type; pending edges cannot qualify public records |
| `technology_licenses` | Artifact FK, license version hash, SPDX/custom/unknown, classification, access conditions, evidence, reviewed time | Artifact/version; code/data/weights remain separate |
| `watch_developments` | Subject FK/type, development key/type, source date fact, materiality decision, ContentItem link | Unique subject/development key; date/ID; baseline flag |
| `watch_links` | Typed source/target IDs, relation, evidence | Unique endpoint pair/relation; no arbitrary generic graph traversal API |
| `watch_public_revisions` | Subject/development key, kind, accepted JSON, immutable sort fields, `valid_from`, nullable `valid_to`, audit decision ID | Unique key/valid-from; one open revision; list/filter indexes |
| `watch_read_state` | Singleton generation and minimum retained generation | Single-row transactional update |

Membership periods use `[from, to)`. An unknown end is not proof that a person
still serves. The current directory also requires a fresh accepted official
roster observation, with its as-of date. Do not enforce one person per district:
NJ Assembly and Philadelphia at-large representation are multi-member cases.
Committee memberships and elected offices are separate roles. Missing officeholder
data is an unverified office, not a fabricated vacancy; a vacancy needs evidence.

### Technology shape

```ts
type TechnologyProfile = {
  id: string;
  slug: string;
  resourceType: "software" | "paper" | "dataset" | "database-engine"
    | "data-platform" | "standard" | "commercial-product";
  purpose: AcceptedFact<string>;
  intendedUsers: AcceptedFact<string[]>;
  workflow: AcceptedFact<{ inputs: string[]; steps: string[]; outputs: string[] }>;
  localRelationships: AcceptedRelationship[];
  artifacts: PublicArtifact[];
  setup: {
    verification: "maintainer-documented" | "desk-tested" | "not-verified";
    version: string | null;
    prerequisites: AcceptedFact<string[]> | null;
    guideUrl: string | null;
  };
  limitations: AcceptedFact<string[]> | null;
};
```

This is a design sketch: `AcceptedFact`, `AcceptedRelationship`, and
`PublicArtifact` must be implemented from the evidence rules, not imported from
nonexistent current modules. Public unknowns are nullable with a reason; empty
arrays are reserved for verified absence. A paper can have no code. A custom
license can be described without calling it open source.

## 6. Public HTTP Contracts

All public reads are GET/HEAD only. Lists default to 20 items, maximum 50; query
length maximum 120 characters; cursor maximum 2,048 encoded bytes. Bound evidence
lists and paginated timelines independently. Reject unknown filter values with a
structured 400, not a broad unfiltered query. Bind SQL values and escape literal
LIKE wildcards; do not interpolate filter or sort identifiers.

| Endpoint | Purpose / supported query |
| --- | --- |
| `/api/v2/watch/policy` | `view=changes|active|agenda`, `jurisdiction`, `county`, `topic`, `stage`, `q`, `from`, `to`, `cursor`, `limit` |
| `/api/v2/watch/policy/:id` | Accepted dossier; bounded initial timeline and sources; detail unavailable does not leak internal record |
| `/api/v2/watch/policy/:id/timeline` | Revision-bound action pagination |
| `/api/v2/watch/representatives` | `jurisdiction`, `body`, `district`, `asOf`, `cursor`; supported date bounds documented |
| `/api/v2/watch/technology` | `view=releases|directory|papers`, `organization`, `type`, `license`, `useCase`, `q`, `cursor`, `limit` |
| `/api/v2/watch/technology/:id` | Accepted profile, current verified artifact labels, related developments |
| `/api/v2/content` and `/feed.v2.json` | Shared v2 ContentItem contract; no separate agent-specific content schema |
| `/policy-watch/feed.xml`, `/technology-watch/feed.xml` | Published developments only, stable GUIDs, canonical links |
| `/events/calendar.ics`, `/events/:slug.ics` | Published calendar projection; details in UI spec |

Example response, synthetic IDs and abbreviated item fields:

```json
{
  "version": "2",
  "dataAsOf": "2026-09-12T13:00:00.000Z",
  "delivery": { "mode": "live", "stale": false, "reason": null },
  "items": [{ "id": "demo-policy-01", "slug": "sample-data-rule", "kind": "policy-dossier" }],
  "page": { "limit": 20, "nextCursor": null, "snapshotGeneration": 17 },
  "coverage": { "registryVersion": "watch-v1", "scopeUrl": "/coverage" }
}
```

`dataAsOf` describes the accepted dataset, not response-generation time. HTTP 200
with `mode: bundled, stale: true` is appropriate only when a valid accepted
fallback exists. Without one, return 503 with a retryable structured error. A
single not-found public record is 404; a never-public review record also returns
404. Cursor expiration is 410 with `cursor-expired`; filter/cursor mismatch is
400. Preserve the list controls while displaying an error.

Build public DTOs by selecting allowed fields; never serialize internal objects
with object spread. Exclude operator notes, review token material, raw HTML,
private contact data, model prompts, and unaccepted interpretations. Public
source/contact links are HTTPS, checked against the relevant source policy.

## 7. Stable Cursor Pagination

First request reads generation G and applies filters to accepted revisions valid
at G. It returns G, a fingerprint of normalized filters, and the final immutable
sort tuple. Subsequent requests use the same generation and strict keyset
comparison. Newly published rows appear on refresh, not midway through a page.

Illustrative query shape, with placeholders bound through D1:

```sql
SELECT subject_id, payload_json, sort_key
FROM watch_public_revisions
WHERE valid_from <= ?1
  AND (valid_to IS NULL OR valid_to > ?1)
  AND kind = ?2
  AND (?3 IS NULL OR sort_key < ?3
       OR (sort_key = ?3 AND subject_id < ?4))
ORDER BY sort_key DESC, subject_id DESC
LIMIT ?5;
```

Add filter-specific normalized columns/indexes; this simplified query does not
implement all filters or safety tombstones. Fetch `limit + 1` to determine whether
a next page exists. Apply current delivery tombstones, filling from additional
bounded rows if necessary; never resurrect a retracted fact from an older cursor.

Cursor fields are version, generation, normalized filter hash, sort tuple, and
issued time. Base64url is encoding, not authentication. Treat all fields as
untrusted, validate size/types/ranges, and require a retained generation no newer
than the database's current generation. A cursor must never influence authority,
visibility, SQL syntax, or review status. Enforce expiry and retention server-side.

A generation is a publication revision counter, not a D1 replication bookmark.
Do not conflate them. Keep default D1 behavior initially; any later read-replica
adoption needs separate consistency tests for generation and revision reads.

## 8. Compatibility and Canonical URLs

| Surface | V1 behavior | New behavior |
| --- | --- | --- |
| `/news/:slug` | Existing published policy/AI/news remains canonical | May link to a Watch dossier; no forced redirect |
| `/voices`, `/voices/:slug` | Archive remains readable | Remove from primary nav/home, not from routing |
| `/policy` | Staged baseline, deployment not yet verified | 301 to `/policy-watch` only if the old route exists in the reconciled release |
| `/policy-watch/:slug` | New lasting dossier | Current accepted facts and dated source history |
| `/technology-watch/:slug` | New lasting dossier | Never doubles as a release permalink |
| `/technology-watch/updates/:slug` | New development permalink | Reserve `updates` so it cannot collide with dossier slugs |
| `/feed.json` | Closed `version: "1"` contract | Freeze parser/serializer; exclude unsupported new kinds |
| `/api/content` | Current legacy contract | Preserve; advertise explicit `/api/v2/content` |
| `/feed.xml` | Existing general published feed | Preserve existing items; new technology may be added only with canonical development links and feed tests |

A v2 technology item extends the existing Base fields with `kind: technology`,
`resourceId`, `developmentId`, `developmentType`, and a precision-aware
`sourceOccurredAt`. Public prose is still subjected to impact, source, and
delivery gates. A dossier is not itself a ContentItem and does not get emitted
as fresh news simply because it was backfilled.

Freeze the actual v1 Zod schema before adding new variants. Filtering on kind
alone is insufficient: a policy stage added to an existing nested enum can also
break v1. Preserve all existing supported items, and include new items in v1 only
when the complete legacy schema and delivery rules accept them. Do not coerce
withdrawn into introduced, or fabricate `developmentAt` for a day-only source.
Incompatible new records stay v2-only with an internal compatibility metric.

Audit these files together: `router.tsx`, `lib/nav.ts`, `lib/kind.ts`,
`lib/canonical.ts`, `lib/crawler-html.ts`, `content/sitemap.ts`,
`ingest/public-feed.ts`, `DocumentHead.tsx`, and `worker.js`. Preserve source
attribution, JSON-LD accuracy, slug aliases, tombstones, and signed catalog
fallback. New dossier JSON-LD must not claim to be a freshly published
NewsArticle; use an appropriate page/entity representation with verified fields.

## 9. Search, Retention, and Size Controls

Start with indexed filters and bounded literal title/purpose search over the
public projection. Do not scan PDF text per reader request. Profile row reads and
latency on a realistic seeded dataset before adding SQLite FTS or a search service.
No semantic-search dependency is needed for v1.

D1's documented limits include 100 bound parameters per query and a 2 MB
string/BLOB/row limit. Keep application packets and public JSON much smaller,
split large inserts into bounded statements, and test rendered PDF page sizes.
Do not assume a five-megabyte artifact fits in a single row; reuse chunks.
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/)

Proposed application targets: list response <= 100 KB uncompressed, initial
dossier response <= 150 KB, no embedded PDFs/screenshots, 20 initial timeline
items, and 20 initial citations. These are engineering targets to validate, not
Cloudflare limits. Evidence needed for published claims is not deleted by generic
cache cleanup. Assign explicit retention by evidence class and track growth;
public revision pruning must respect issued cursor lifetime and audit needs.
