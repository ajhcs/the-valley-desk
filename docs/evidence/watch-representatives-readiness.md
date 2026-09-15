# W07 Representatives And Coverage Foundation

## Scope And Status

This is an offline contract implementation, not W07 source acceptance, public
exposure, representative API delivery, or launch approval. No real person,
membership, policy, source qualification, or staffing assignment was added to
application content. All executable examples are isolated synthetic test data.

Implementation base: `fb924c51d065ade51b3705ff15b74ddb604b6bcc`.
Watch schema/projection prerequisites are separate cherry-picks of
`e3bd742f3fe0582bbe9e13dc978fde572e7a0ab3` and
`d66f0f79418c64c7317b58a2d485903420dcf9fe`.

Owned implementation:

- `src/content/watch-representatives.ts`: dated entities, accepted snapshot
  resolution, bounded selected-district queries, public projections.
- `src/content/watch-coverage.ts`: exact county/family obligations and evidence-
  bound, staffed monitoring accounting.
- `test/watch-representatives.test.ts` and its synthetic fixture directory.

No migration, database writer, route, frontend, runtime configuration, model,
source fetch, ingestion, deployment, or package-script change belongs to this
slice. The integration owner must add the new test to the explicit `npm test`
list when incorporating this commit.

## Trust Boundary

`RepresentativeResolutionContext` and `WatchCoverageContext` are server-owned
dependency injection interfaces, not request-body schemas and not authorization
mechanisms. Source enrollment, official-source classification, reviewer rights,
staff identity, semantic review, and persistence acceptance must happen first.
Parsing a valid record or reproducing its digest does not establish that authority.

Representative resolution requires a stored acceptance for the requested snapshot
ID and current revision. Every fact is bound to its accepted digest, record ID,
subject ID, exact field purpose, verification date and literal/structured evidence.
Evidence reuses the existing `evidenceMatches` implementation, including original
representation bytes, parser identity, source URL, pointer/quote and extraction
bindings. Official source scope must match both jurisdiction and body and permit
the particular fact purpose. Public profile/lookup URLs have their own official
allowlist check. A URL being HTTPS alone does not qualify it.

The resolver returns an opaque in-memory handle held in a private `WeakMap`.
Neither JSON round-tripping the handle nor constructing an object with
`verified: true` yields a queryable directory. Public projections enumerate fields
explicitly. Internal notes, staff identities, reviewer identities, source native
identity records and raw representations are not included.

The handle is a per-request snapshot, not a long-lived cache. Construct the context
from a coherent server storage read and resolve again after revocation, revision,
source-enrollment changes or a new request clock. The foundation does not provide
a transaction, persistent identity registry, revocation subscription or cache
invalidation service. The storage/API integration must implement those controls.

## Identity And Temporal Rules

`representativePersonSourceKey(sourceId, nativeId)` does not use a person's name.
`representativeOfficeKey` uses jurisdiction ID, body ID, office type, district
versus at-large type, and district/at-large ID. Its input can be those identity
fields alone, without an already assigned ID. Display labels, capacity, membership
and party changes do not change the natural key. Persist assigned IDs immutably;
identity merges and corrected source IDs require an explicit audited process.

All supported membership, office and committee periods are calendar-day
`[validFrom, validTo)` intervals. Start dates must be known real days; an unknown
end is `null`, not an invented date. Intraday/ambiguous term transitions are not
represented in this slice and must remain held until a precision-aware extension
is implemented. Directory day selection uses `America/New_York` explicitly;
source observation and acceptance clocks remain canonical UTC instants.

Current membership, committee role and vacancy each require their own inclusion
in the accepted official roster, a matching term, and roster freshness. The
freshness interval expires exactly at `asOf + maxRosterAgeHours`, using the roster
as-of rather than acceptance/request time. The server must choose a qualified
bounded interval (1 through 744 hours); tests use 48 hours, which is not a
production qualification result.

Expired roster entries may be shown as `last-known`, but do not increment
`verifiedFilled` or `verifiedVacant`. An absent name leaves unverified capacity;
it never invents a vacancy. Every vacancy needs a separately accepted official
fact and roster inclusion for a current claim. Vacancy and filled-seat totals
cannot exceed the office's accepted capacity.

Past closed terms can be returned as `verified-historical` when their exclusive
end precedes the roster observation day. Open terms are historical only through
the roster day when listed. A future scheduled term end does not establish
continued service after the last roster observation. Historical policy roles
bind to the action's original membership/person IDs, action day, and name at that
action; resolving the current officeholder is deliberately not part of this path.

Multi-seat offices contain multiple memberships. They do not have fabricated
numbered-seat identities. The test corpus proves a two-member NJ-shaped district
and a seven-member Philadelphia-shaped at-large example while keeping district
representation separate. Those fabricated rosters are not facts about real people.
Committee roles do not consume elected-office seat capacity.

## Integration Pattern

After a server-only storage adapter resolves approved registry and snapshot rows:

```ts
const directory = await resolveRepresentativeDirectory(snapshotId, serverContext);
const result = queryRepresentatives(directory, {
  jurisdiction: "NJ",
  jurisdictionId: selectedJurisdictionId,
  bodyId: selectedBodyId,
  districtId: selectedDistrictId,
  asOf: selectedCalendarDay,
  limit: 20,
});
```

Only the second argument is a public query contract. It rejects unknown fields,
ZIP/county/address inference, missing explicit scope, future dates, invalid dates,
limits outside 1-50, and oversized cursors. A cursor binds to the accepted snapshot
digest and selected scope/date, never an arbitrary database offset. The response
is limited to 50 offices and 250,000 UTF-8 bytes. A changed scope/date requires a
new cursor; a changed accepted snapshot requires restarting pagination.

The initial registry/district selector API and representative storage reader are
not implemented here. Neither are representative lookup from an address,
residency verification, geocoding or constituent data retention.

```ts
const role = projectHistoricalPolicyRole(directory, acceptedPolicyRoleId);
// `role` preserves the accepted action date, original membership and action name.

const unavailable = representativeDirectoryUnavailable(query, serverNow);
// For an actual absent accepted snapshot, not a fabricated fresh empty result.
```

The HTTP integration must distinguish invalid query (400), changed cursor (409),
accepted-data absence (503 unless a real labeled fallback exists), and a valid
in-scope empty selection (200). `representativeDirectoryUnavailable` is a pure
DTO helper, not an exception handler that hides all errors. `dataState` describes
the accepted dataset; each office and membership separately describes what is
verified. `dataState: current` alone never means every seat is verified.

## Coverage Accounting

The exact geography is Philadelphia, Bucks, Montgomery, Chester, Delaware;
Camden, Burlington, Gloucester, Salem, Atlantic; and New Castle. Tests compare the
county names/order against the tracked `fixtures/coverage-pack-v1.json` and freeze
the 11 IDs from the blueprint. The planning source-plan file is not required at
runtime. All 13 required federal/PA/NJ/DE source families remain independent first-
release requirements; staffing counties does not waive any family.

For each obligation, absent entries are `unassigned`. Valid records without a
server-held accepted digest/authorized reviewer, enrolled scoped sources, matching
retained evidence receipt or staffing are `unavailable`. Stale review/check records
retain their honest older scope/as-of but do not satisfy the obligation. A ready
source is preferred to a ready manual backup; an obligation is counted once.

Manual readiness requires two distinct enrolled people with names and availability,
named bodies and official sources, check cadence (1-168 hours), coverage hours,
public scope, internal evidence-log location, retained check evidence, assignment
review and next review dates, plus explicitly disclosed municipal gaps. An owner
role label, proposed URL, `manual-ready` flag, or an unassigned backup is insufficient.
No private contact data or staffing identity is exposed in the public DTO.

The retained receipt's record ID, bytes digest and actual check timestamp must
match the accepted monitoring record. Reusing an older check receipt with a new
timestamp cannot establish freshness. The source must be enrolled for the exact
county or family obligation, not merely known somewhere in the regional registry.

`requiredCoverageSatisfied` means only that this supplied, server-accepted ledger
satisfies the 11 county and 13 family contract obligations. It does not assess
publication readiness, semantic correctness of a review, or the authenticity of
someone else's storage adapter. `publicationAuthorized` is always `false`.

## Verification And Remaining Work

All fixtures and approvals are synthetic. No official roster was fetched, no
collector/parser was qualified, and no editor or backup was actually assigned.
The true launch/source/editor qualification state remains outstanding.

Local verification commands:

```sh
node --import tsx/esm --test --test-concurrency=1 \
  test/watch-representatives.test.ts test/watch-contracts.test.ts \
  test/watch-legacy-contracts.test.ts test/watch-model-evaluation.test.ts
node node_modules/typescript/bin/tsc -b
node node_modules/typescript/bin/tsc --ignoreConfig --noEmit --target ES2023 \
  --module ESNext --moduleResolution bundler --allowImportingTsExtensions \
  --lib ES2023,DOM --strict --skipLibCheck \
  test/fixtures/watch-representatives/synthetic.ts
npm run secret-scan
git diff --check
```

On 2026-09-12 under Node `v24.14.0`, the combined suites passed 116/116 tests,
including 35 new representative/coverage tests. The project compile and standalone
strict fixture compile passed. Secret scan passed for 280 tracked/untracked files.
The dependency bootstrap reported three existing high-severity advisories; no
dependency or lockfile was changed. CI Node 22, the full build, public API/browser
tests and live source qualification were not run by this bounded slice.

Tests cover
terms, turnover, multi-membership, stale/missing/expired vacancy data, official
scope/purpose provenance, identity conflicts, digest/byte tampering, forged flags,
privacy allowlists, bounded queries/cursors, calendar boundaries, exact geography,
manual staffing/evidence, duplicate county accounting and tri-state family gates.

Outstanding integration/qualification includes immutable persistence with FK and
acceptance-revision protection; real official member/committee/lookup sources for
federal and all states; actual local-body inventory; editor/backup enrollment;
API/cache/revocation behavior; UI selected-district flows; performance and response
size measurement on real scoped datasets; and exact-candidate deployment gates.
None of those gaps is made complete by the synthetic test suite.
