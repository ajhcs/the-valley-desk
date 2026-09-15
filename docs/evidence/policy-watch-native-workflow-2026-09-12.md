# Native Policy Workflow: Review-Only Vertical Slice

Base for this slice: representatives commit 84cd12e293edcff17d1c2083583e019ec100dce4.
No existing source, cron, production data or paid model setting was changed.

## Delivered

- Native parsers for Congress JSON bill/actions, Federal Register rule/proposed-
  rule JSON, NJ native text-export rows, DE introduced-legislation JSON, the
  existing qualified PA bill-page extractor, and Philadelphia Legistar JSON.
- Strict instrument/session identities; native action codes and source order
  remain visible. Date-only and timezone-free source clocks are not upgraded to
  precise instants. Unmapped status/legal-effect data stays unknown.
- Migration 0035: immutable native captures, action revisions/development IDs,
  additive links to existing policy_versions, transaction acceptance guards.
- Rechecks with unchanged bytes do not become new developments. NJ corrections
  preserve the native sequence-based event ID. Historical raw revisions remain
  available even after the current capture changes.
- Draft assembly proposes title/identity and a bounded 20-action timeline.
  It does not manufacture a summary, legal effect, reviewed applicability,
  verified facts, reviewer identity, source permission, or public revision.
- Current-head acceptance and post-publication invalidation are both implemented.
  Old observation IDs cannot resolve against a newer capture. A CHECK(valid=1)
  SQL guard rechecks the exact capture/revision in the caller's acceptance batch.
  Changed native captures retract existing older evidence heads in the same
  capture transaction, retaining immutable null-digest retraction records.
  No new dependency heads or source permissions are created.

## Integration Contract

1. Parse retained official bytes through the named native adapter.
2. persistPolicyWatchCapture(db, nativeCapture) returns id/revision/outcome.
3. buildPolicyEditorialProposal(db, id, slug, now) returns proposal, observations,
   gaps, captureId, acceptance:unreviewed and acceptanceGuards(decisionId).
4. Pass only proposal to the root stageEditorialProposal. Its proposed facts
   have no verification receipts. Authenticated semantic review remains mandatory.
5. In root resolveContext, call resolvePolicyWatchEvidence(db, subjectId,
   observationIds). It returns a Map of retained current observations plus
   acceptanceGuards, captureId and revision. Combine these guards with root
   source-permission guards in the SAME editorial acceptance transaction.
6. Qualified source enrollment still comes from the collection registry.
   Do not treat source host recognition, native parser success, or this document
   as publication/source-coverage authorization.

Existing PA rows are connected by linkPaPolicyVersion only when the captured
official instrument, session, printer number and text URL exactly agree with
policy_versions. An old SQLite metadata row is not itself official evidence.

Retractions scan older subject draft evidence that matches retained native
observation IDs. Keys use deliveryDependencyKey("evidence",[id,evidenceDigest]).
The write-time SQL selects heads that exist then, catching an approval after
the scan. A separate draft-count CHECK detects newly staged drafts during the
scan and rolls back for retry. More than 400 distinct evidence references fails
closed with policy-watch-retraction-bound-exceeded; it never partially invalidates.
This bounded implementation needs archive/consolidation planning before high
volume, long-term operation. Current exact evidence keys are not retracted.

## Actual Captures

NJ: official text export archive at
https://pub.njleg.state.nj.us/leg-databases/2026data/DB2026_TEXT.zip.
The archive is 1,339,432 bytes. Retained at
/mnt/d/tmp/plumbob/tvd-nj-2026-text.zip.
SHA256: 1b2bcd4951593db0e89594a315d9dfc4bacb021a6abca9f9d954b423e8a7f548.
Fixture retrieval timestamp 16:37:10.791Z is the completed archive file's
filesystem modification time, not a fabricated source publication timestamp.
Python's standard zipfile/csv parsers read only MAINBILL.TXT and BILLHIST.TXT,
with archive/member/row bounds; no archive paths are extracted.
Actual A101 proposes defibrillators on NJT trains. Native action:
INT 1RA REF ATR, sequence 1, January 13, 2026. ModDate remains metadata, not an action.
The archive also includes ROSTER/LEGBIO/COMEMBER/COMMITTEE exports. This supersedes
the earlier claim that the timed-out NJ application left no accessible source;
those representative tables have NOT yet been parsed or accepted by this slice.

DE: https://legis.delaware.gov/json/JsonFeed/IntroducedLegislation
captured 2026-09-12T16:44:33.220Z. Selected actual SB 360, Assembly 153.
Raw feed retained at /mnt/d/tmp/plumbob/tvd-policy-de-native-20260912/source.json.
SHA256: 3c1c61d8466e2ae58d6f4976fb7a585bd9e4e6bbe16ce1ccee534bdb3adbf821.
The native introduced clock lacks a timezone; only its calendar day is proposed.
Amendments/substitutes are held rather than merged into their parent bill.

Federal Register: https://www.federalregister.gov/api/v1/documents/2025-15492.json
captured 2026-09-12T16:45:16.403Z. This is a historical proposed-rule correction,
not a new 2026 development. Raw document retained at
/mnt/d/tmp/plumbob/tvd-policy-fr-native-20260912/source.json.
SHA256: 457d4750f101a513da057724739329b2ef0c161662de7496af2aa4f803c2fb54.
The public API worked even though the website documentation returned an access
page. No CAPTCHA bypass or credential was used.

PA: reused the repository's captured-sb1113-20260906.html actual source fixture
and existing native bill-history parser. Test fixture clock values are simulation,
not claims of newly collected PA evidence. Exact HTML remains in the normalized
observation representation alongside parser output.

Three new real native JSON fixtures are under test/fixtures/policy-watch-native.
They are test/review evidence, never production seed or editorial approval.

## Gaps And Qualification Limits

- Congress live fetching requires separately arranged API access; none requested.
  Schema comes from the official LibraryOfCongress/api.congress.gov repository,
  Documentation/BillEndpoint.md. Tests use explicitly synthetic native records.
  Pagination is unqualified, so latestAction stays unavailable. Content-derived
  event keys without an authoritative native ID need review for correction
  identity; the ledger alone cannot label these as fresh published developments.
- Philadelphia phila tenant returned 403; incorrect philadelphia tenant returned
  500. Native shape has synthetic tests only. Official phila.legistar.com bill
  details are readable, but HTML action collection is not implemented here.
  Session enrollment and completed-history qualification remain outstanding.
- DE introduces only: no claim of complete action history, sponsor roster,
  signed legislation, hearing schedule, deadlines or current lifecycle.
- PA printer capture is metadata, not extracted/reviewed statutory interpretation.
- NJ archive parsing is offline, not scheduled source enrollment. Native status
  acronyms are preserved but not mapped to legal-effect claims.
- Federal notices are intentionally unsupported rather than mislabeled as rules
  or guidance. Future timestamps stay out of the proposed action timeline.
- Root owns review routing, collection schedules, source qualification, real
  applicability/deadline drafting, UI integration and launch observation.

## Verification

Four focused policy tests pass, including actual source evidence matching and
the full available migration chain on real local D1; the combined new policy
and representative run passes six tests. Assertions cover immutable capture
replay, native-date precision, corrections, stale acceptance, exact PA linking,
transaction rollback and zero public rows. Retraction tests include a head
created after the scan and unchanged source permissions.

Build/typecheck pass with the existing unchanged large-bundle warning.
Three actual NJ/DE/FR proposals were parsed successfully against the root's
actual EditorialProposal schema on 2026-09-12, not a locally invented surrogate.
No full release gate, new public acceptance, deployment or model evaluation is
claimed by these tests.
