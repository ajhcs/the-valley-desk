# Representatives: Persistent Review Slice

Base: 290d41c5ca08a23df3637fd32ca9b366a4850aaf. This is implementation evidence,
not full W07 source qualification or production activation.

## Delivered

- Migration0032: immutable raw roster captures, immutable drafts, reviewer
  decisions and scope heads. SQLite trigger enforces expected head revision;
  decision/head update is one transactional D1 batch.
- Public queries reload the accepted snapshot, resolve every accepted fact and
  evidence binding against the server-owned source policy, then check the head
  again. Source unenrollment fails closed. Re-review does not freshen roster age.
- Separate authenticated draft read and decision API. Caller supplies the
  existing server authenticator, not a request-derived reviewer identity.
  Decision bodies contain only an immutable draft hash and accept/reject choice.
- RepresentativeLookup component: chamber, selected district, historical date,
  pagination, multiple members, roles, sources, official lookup links,
  stale/unavailable/error states. No address or ZIP collection/inference.
- Bounded official Senate XML collector and durable evidence writer. No model
  invocation, source enrollment, accepted membership synthesis or publication.

## Integration

Wire handleRepresentativeRead(request, env, policy) before the generic
/api/v2/watch/ matcher, for /api/v2/watch/representatives. WATCH_PUBLIC_ENABLED
remains the gate. Wire handleRepresentativeReview(request, env, policy, authorize)
for /api/representative-drafts/:id and /:id/decision through existing rate limits
and bearer/Access authentication. authorize returns a server-owned reviewer ID
or null. The policy is RepresentativeSourcePolicy; never deserialize it from
request JSON. Empty enrollment is unavailable, not source acceptance.

Internal preparation uses stageRepresentativeDraft; protected review reads the
stored draft; a reviewer accepts its exact SHA. No HTTP endpoint accepts a
client-supplied accepted snapshot. Semantic human review is still required:
syntactically valid facts and matching digests alone do not prove truth.

Mount RepresentativeLookup in the policy representatives view. Add
test/representative-persistence.test.ts to the explicit npm test list.
The component has optional initialBodyId, default pa-house. Root owns route
wiring and final integrated browser qualification. This slice does not edit
worker.js, package.json, wrangler.jsonc, or shared routing.

## Actual Source Capture

2026-09-12T16:30:27.198Z capture of the official Senate contact XML:
https://www.senate.gov/general/contact_information/senators_cfm.xml

Retained source: /mnt/d/tmp/plumbob/tvd-representatives-capture-20260912/senate.xml
SHA256: 984865a4a6e00af68c9617ea45f52b8939f49143780c832cb68c747fa4bfef5e
Derived observation: same directory, observation.json. Source last_updated:
2026-08-03T09:54-05:00. This is distinct from the retrieval timestamp.

Six observed entries: Lisa Blunt Rochester (B001303), Cory A. Booker (B001288),
Christopher A. Coons (C001088), John Fetterman (F000479), Andy Kim (K000394),
David McCormick (M001243). The capture includes source-provided state, party,
Senate class and official profile/contact URLs. All entries are UNREVIEWED,
with unknown service start/end. No rows have been accepted or seeded in Prod.

Reproduce a new capture without overwriting existing evidence:

```bash
node --import tsx/esm scripts/capture-representative-roster.mjs NEW_OUTPUT_DIRECTORY
```

## Source Gaps

- Senate: source does not provide membership start/end or committee roles.
  Its old source timestamp cannot establish current roster freshness. Obtain
  dated official service/term evidence and a refreshed roster before acceptance.
- U.S. House: official lookup confirmed at
  https://www.house.gov/representatives/find-your-representative; roster ingestion
  and term/committee evidence remain unimplemented.
- PA: https://www.palegis.us/house/members is a readable official member directory.
  Its official data page https://www.palegis.us/data advertises House/Senate
  member RSS. Host fetch of /house/rss/session/members returned HTTP403.
  No workaround or untested PA member adapter was represented as qualified.
  Official lookup: https://www.palegis.us/find-my-legislator.
- NJ: official legislative-roster and districts pages timed out in browsing.
  Their links remain official directory navigation, not a qualified automated
  collection source or accepted people/terms.
- DE: official House/Senate AssemblyMembers pages returned a client-rendered
  roster shell without member rows. Official FindMyLegislator page was readable;
  its federal names are not a substitute for state membership/term evidence.
- Philadelphia and other local bodies: no live roster collector or accepted
  directory added. County/municipal coverage and staffing remain unqualified.
- No local preference persistence, full chamber district preloading, or final
  integrated browser/accessibility acceptance is claimed here.

## Verification

37 focused tests pass, including real local D1 transaction rollback, stale
expected revision, immutable capture replay, hash tampering, forged reviewer
field rejection, missing current source authority, stale roster, historical
turnover, genuine vacancy and unauthenticated route denial.
Typecheck/build pass. Existing bundle size warning remains unchanged.
The two new tests contain many assertions but count as two tests, not dozens.
No production mutation, paid model, or remote migration was performed.
