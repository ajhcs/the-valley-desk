# Policy intelligence migration, verification, and rollback

## Model-response/evidence follow-up (local candidate; schema 0027)

See `docs/evidence/model-response-evidence-review.md`. This code-only candidate
adds bounded diagnostics, strict relevance response validation, and extraction
of the captured official bill synopsis. It does not fix an established cause
of HB1925's malformed JSON: the original bytes are unavailable. Model identity,
1024-token relevance limit, capacity allocation, committee parsing, credentials,
routing, and newsletter intake remain unchanged.

Before qualification, run captured-page/model/persistence regressions, commit,
replay fresh official bytes, then run the declared exact-tree release gate once.
Deployment is a separate authorization. Refresh preflight and verify rollback
against the then-current Worker (last verified baseline `1ea34af9-3b4d-4f56-ae93-5a8c151c576c`,
commit `f802b24`). Do not apply a migration or restore the database.

After an authorized release, capture a natural relevance cycle's
`official_relevance_persisted` structured logs in restricted evidence. Join
`discoveryId` to `official_source_candidates.id`, verify `detailHash`, and hash
the stored `relevance_reasons_json` to match `reasonsSha256`. `inputSha256` is
the relevance-input hash, NOT a downstream editorial fingerprint. `startedAt`
and `endedAt` are actual processing times; deferred rows have NULL start.
Pair logs with read-only D1 results promptly: schema 0027 retains latest reasons
but has no pre-admission attempt-history table. Logs are retention-limited,
not permanent D1 history; preserve the restricted receipt before expiration.
If persistence fails, absence of the persisted event is not proof of no attempt.

For HB1925 require diagnostic classification and a reproduction before changing
parser behavior or output limits. Missing/unsafe request identifiers stay absent.
For SB1113 require a complete response or explicit response-contract failure.
For HB1993 compare delivered synopsis to official bytes; PDF links are provenance,
not extracted PDF contents. Empty evidence spans force a PA relevance hold,
retaining the original model decision in the processing receipt. Neither a
relevance hold nor rejection is an editorial disposition. Use the existing
current-fingerprint milestone audit only after admission. Preserve the already
accepted legislative-material idempotency item and check committees separately.

If authorized release checks fail, use the documented code-only rollback to
the refreshed preflight version. No schedule reset, forced ingestion, baseline
import, credential/routing change, or historical repair belongs to this scope.

## Deferred-relevance follow-up (schema 0027, code-only candidate)

Collection/detail retain their 25-second allocation. Relevance receives a
separate bounded 60-second allocation after collection, with the existing
20-candidate cap, concurrency 4, and maximum 30-second individual call. Default
source-stage IO budget is therefore 85 seconds, plus bounded parsing/persistence
overhead; it does not borrow the downstream editor's separate window. Worst-case
slow providers can still defer later waves. Such deferrals remain blockers,
not successful editorial dispositions.

The 24-row database retry admission prioritizes successfully hydrated critical
sources and rotates within source/state buckets. Relevance likewise rotates
across sources within priority tiers, oldest discovery first. This fixes the
observed 269–271 queue positions of the three bills without resetting source
backoff or altering collection schedules. Existing review/provider-error retry
semantics are otherwise unchanged; this is not a new global queue-SLO guarantee.
Retry-only persistence must not move last-seen observation timestamps backwards.

After an explicitly authorized code-only release, observe natural runs and use
`docs/evidence/pa-editorial-disposition-audit.sql`. Require an individual current-
fingerprint editorial milestone (brief or specific evidence blocker), citations,
and measured discovery-to-disposition seconds for all three bills. A discovery
row with `review` or a stage-deadline reason alone does not pass. Compare repeated
official snapshot hashes and version identities to prove unchanged ingestion
did not create another development. Keep model-stub fixture evidence separate.
Schema remains 0027; do not apply a migration. Refresh the active Worker rollback
target at preflight; current baseline is `be398528-fc7a-4877-b15a-62b5b481936a`
(`002e2dd`). Rollback is code-only; no database restore, routing change, forced
ingestion, credential change, or publication action is part of this follow-up.

This is a release plan only. The implementation task did not deploy, apply migration 0027, alter production candidates, or run the policy baseline import.

## Stage 0: immutable-candidate preconditions

### Mandatory Pennsylvania byte checks BEFORE the release gate/deployment

Run `npm test`, including the checksum-bound captured HB1925/SB1113/HB1993
regressions and their migrated-database persistence/idempotency/rejection tests.
Preserve the committee malformed/empty/joint-meeting regressions. Commit the
implementation to a clean immutable candidate, then run:

```bash
npm run verify:pa-official -- --receipt=/mnt/d/tmp/plumbob/RESTRICTED-RELEASE-DIR/pa-official-replay.json
```

This command performs bounded official HTTP GETs and locally replays the exact
downloaded bytes, retaining originals, checksums, current-printer/text-date
history and latest-action dates. It does not collect into production. A missing
date, inconsistent bill/session/printer/PDF, source error, or failed replay
blocks the gate and deployment. Historical fixture expectations apply only to
those captures; live values must come from the designated official fields.
Run the exact-tree release gate only after this replay passes; its HEAD/tree
must match the replay receipt. Any implementation change invalidates both.

Schema remains 0027: the bounded official bill record is retained in candidate
detail evidence and policy-version evidence JSON. Its text-version dates are
not development dates. `published_at` with `legislative-action` provenance is
the designated latest action date; `detail_fetched_at` remains fetch time.
Malformed refreshes retain a review blocker and cannot keep an old action date
as current verified evidence. Older printer records are history, never selected
by page-wide first-match logic.

Deployment still requires explicit operational authorization. Public health
alone does not accept the release: observe a naturally due cycle and verify
individual persisted bill/version/action evidence, empty-vs-failed committee
snapshots, and released lock. Never reset backoff or force ingestion for proof.

1. Review an immutable candidate commit and the 19-item acceptance matrix. Run
   the repository release gate from a clean checkout of that exact commit and
   retain its JSON receipt; the receipt's candidate HEAD/tree must match what is
   deployed. A dirty working tree or validation from another SHA is not
   acceptable.
2. Keep the existing `the-valley-desk` Worker and `the-valley-desk` D1 database. Do not create a parallel production Worker.
3. Keep ordinary newsletter intake disabled at the Cloudflare Email Routing
   rule while migration 0027 and the Worker candidate are deployed. The Worker
   fails closed if its Analytics correlation settings are absent, but that is
   not a substitute for disabling the route during this stage.
4. Record the deployed Worker version/SHA, current D1 schema, Email Routing rule
   enabled/disabled state, open-alert rows, source-health rows, and current
   policy candidate aggregates in a restricted off-repository release artifact.
5. Capture both a D1 Time Travel bookmark and a full SQL export. Cloudflare documents that migrations are transactional and capture a backup, but the independent bookmark/export makes the rollback target explicit.

Suggested preflight commands, to be run only in an explicitly authorized production release task:

```bash
npm exec -- wrangler deployments list
npm exec -- wrangler d1 time-travel info the-valley-desk
npm exec -- wrangler d1 export the-valley-desk --remote --output=/mnt/d/tmp/plumbob/the-valley-desk-pre-0027.sql
npm exec -- wrangler d1 migrations list the-valley-desk --remote
npm test
npm run build
npm run secret-scan
npm run backfill:policy:dry-run
```

Email authentication provisioning is release-only and was not run here. It may
be completed before or immediately after Stage 1, but ordinary newsletter
intake must remain disabled until Stage 2 passes:

```bash
npm exec -- wrangler secret put CF_EMAIL_ANALYTICS_TOKEN
npm exec -- wrangler secret put CF_EMAIL_ZONE_ID
npm exec -- wrangler secret put CF_EMAIL_ROUTING_RULE_ID
```

The API token must be limited to Analytics Read for the selected zone. The zone and rule values are correlation constraints, not editorial credentials. Cloudflare documents the routing event fields in [Email Service metrics and analytics](https://developers.cloudflare.com/email-service/observability/metrics-analytics/) and the Email Worker runtime fields in the [route-email handler reference](https://developers.cloudflare.com/email-service/api/route-emails/email-handler/).

## Stage 1: migration and candidate deployment

Migration 0027 is additive: it adds candidate provenance/disposition columns, policy/version/review-milestone tables, exact email wire-size/provenance columns, PDF tables/extraction audit fields, and recovery detail. It does not rebuild or drop `email_discoveries`, so existing `signal_pointer_verifications` children are preserved. Existing email rows are retained but fail closed as `legacy`/`untrusted-pointer` because pre-0027 MIME-header trust cannot substitute for a Cloudflare Analytics receipt. Other bounded updates mark known out-of-scope policy navigation links `filtered` and pull healthy/pending policy-critical schedules forward so preexisting daily timestamps cannot delay the first 30-minute check. Failed/blocked/hostile backoffs are preserved.

1. Apply 0027 before code because the new Worker reads the added columns:

   ```bash
   npm exec -- wrangler d1 migrations apply the-valley-desk --remote
   ```

2. Run the read-only migration checks below.
3. Confirm the ordinary newsletter Email Routing rule is still disabled, then
   deploy the reviewed commit through the normal release path. Do not run
   `applyPolicyBaseline` as part of deployment.
4. Verify `/api/health` reports schema `0027` and the intended build SHA. Run
   authenticated read-only status and the controlled synthetic legislative
   fixture in the non-production/local harness. Production verification should
   observe natural scheduled activity; no live backfill is required.
5. The deployment may advance to Stage 2 without a production email receipt.
   Newsletter intake remains disabled, so this is not acceptance of that input
   channel.

## Post-migration read-only checks

```sql
SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 3;
PRAGMA foreign_key_check;
SELECT COUNT(*) FROM email_discoveries;
SELECT COUNT(*) FROM signal_pointer_verifications;
SELECT auth_state, COUNT(*), MIN(first_seen_at), MAX(auth_attempted_at)
FROM email_discoveries GROUP BY auth_state;
SELECT detail_disposition, detail_disposition_reason, COUNT(*)
FROM official_source_candidates
WHERE category = 'policy'
GROUP BY detail_disposition, detail_disposition_reason;
SELECT source_id, state, last_success_at, next_attempt_at, last_error
FROM official_source_schedule
WHERE source_id LIKE 'ofs-pa-%' OR source_id IN ('ofs-hap-health-it-advocacy', 'ofs-ncsl-ai-legislation')
ORDER BY source_id;
SELECT COUNT(*) FROM policy_instruments;
SELECT COUNT(*) FROM policy_versions;
SELECT COUNT(*) FROM policy_review_milestones;
SELECT id, discovery_id, sha256, extraction_state, extraction_method,
       extraction_receipt_sha256, extracted_by, extracted_at
FROM email_pdf_attachments
ORDER BY created_at DESC LIMIT 20;
SELECT state, COUNT(*) FROM operational_alerts GROUP BY state;
```

Acceptance requires no foreign-key errors, unchanged pre-existing email/verification counts, the former off-path navigation failures classified as filtered, and the existing open Cooper/leadership incidents still open unless production itself has supplied the required consecutive recovery observations. A healthy cron status alone is not a recovery signal. Cooper/LVHN HTTP blocks and unreadable Penn pages are tracked operational incidents, not Stage 1 deployment blockers and not recoveries this candidate can guarantee.

Run `docs/evidence/policy-detail-failure-audit.sql` after migration. Treat its first result as the current actionable failure population and its second as the reconciliation population. Known off-path CMS/Delaware/New Jersey navigation rows should be `filtered` with no next attempt; in-path rows and any newly discovered failures stay `active` until real source evidence recovers or a separately reviewed disposition rule applies. Counts are intentionally not hard-coded because source runs can add or recover rows. Any unexpected active failure requires investigation before the relevant source is called healthy.

Leadership history is a separate review-and-repair track, not a Stage 1
deployment gate. The candidate's tests must establish that the preventive fix
stops new unsupported closures before Stage 1; historical correctness remains
unclaimed. In a separately authorized task, export the read-only query in
`docs/evidence/leadership-role-audit.sql`, compare every closed dynamic role
with two complete independent leadership rosters, and prepare the signed
manifest defined in `docs/evidence/leadership-history-review-plan.md`. Do not
reopen the 204-row audit population wholesale, and do not couple a historical
repair to migration 0027, newsletter enablement, or the policy baseline. A
completed review may leave rows `indeterminate`; it must not claim correctness
without evidence.

After deployment, verify the authenticated ops payload exposes policy
metrics/per-source timing and email authentication states and verify unknown
redirect hosts still fail. The real forged-header check belongs to Stage 2;
local candidate tests remain required before deployment but are not production
route evidence.

## Stage 2: controlled Email Routing qualification

This check changes production configuration and sends controlled mail, so it
was not executed in the read-only implementation task. It is a hard gate for
ordinary newsletter intake, not a prerequisite for deploying the fail-closed
Worker candidate. A mocked adapter test is not a substitute.

1. Provision the least-privilege Analytics Read token and exact zone/rule IDs.
   In a bounded maintenance window, enable only the exact ordinary newsletter
   rule long enough to send one uniquely identified controlled message to
   `signals+newsletter@thevalleydesk.org`. Include a benign small PDF if
   validating the attachment path. If any unrelated message arrives during the
   window, keep it in review/quarantine and include it in the evidence record.
2. Query the actual `emailRoutingAdaptive` dataset read-only and retain the
   canonical event showing the exact envelope from/to, Message-ID, session ID,
   rule UUID, `action=worker`, final-event flag, event timestamp, spam result,
   DMARC, SPF, and DKIM values. Redact token material, not correlation fields.
3. Query the corresponding D1 row read-only. Require `auth_state=authenticated`,
   `trust_state=authenticated-pointer`, the same correlation values in
   `auth_provenance_json`, and a SHA-256 that recomputes from that canonical
   receipt. If Analytics indexing lags, require `ignored`/`pending` followed by
   scheduled promotion with the same receipt; it may never enter verification
   before promotion.
4. Send a separate spoof fixture whose MIME `Authentication-Results` claims a
   pass but whose platform event fails or does not correlate. Require rejection
   and no review admission.
5. Disable the ordinary newsletter rule again after the controlled messages,
   while the evidence is reviewed. Attach the redacted Analytics/D1 evidence
   and reviewer/time to a Stage 2
   acceptance artifact bound to the deployed SHA and Worker version. Missing
   fields, mismatches, route ambiguity, or absent credentials block Stage 3;
   they do not invalidate an otherwise healthy Stage 1 deployment.

## Stage 3: ordinary newsletter enablement

Enable the ordinary newsletter route only after Stage 2 passes. Record the
exact rule UUID, enabled timestamp, deployed SHA/Worker version, approver, and
Stage 2 artifact checksum. Observe the first natural messages through
authentication, quarantine/promotion where applicable, and review admission.
If provenance correlation regresses, disable this route without rolling back
unrelated policy collection; retain the failed receipt and D1 rows for review.

## Manual PDF review acceptance

Knox (Engineering) owns extraction. For the controlled authenticated message,
download the retained bytes through protected
`GET /api/email-pdf-attachments/:id/content`, verify its ETag/local SHA-256
equals the pending attachment row, run
`scripts/extract-policy-pdf.py` with `--attachment-id` and
`--persistence-payload`, and POST the emitted `persistenceRequest` to
`/api/email-pdf-attachments/:id/extraction`. Read back page evidence and the
stored extraction method, request SHA-256, operator, and timestamp. The parent
must remain `review`; no content may publish. If the step is not staffed, the
attachment stays visibly `pending` and newsletter attachment processing is not
accepted.

## Separately controlled baseline import

`npm run backfill:policy:dry-run` is the only CLI command in this change. It reports record sources/dates, within-manifest duplicates, unresolved attribution limits, and `productionMutation: false`. Applying the exported `applyPolicyBaseline` function is a separate operational action requiring a reviewed caller, a fresh production duplicate query, and explicit authorization. Older advocacy/deck material remains background.

## Rollback

Worker rollback and database rollback are separate decisions:

1. If application behavior fails but schema/data are healthy, roll back only the Worker with `npm exec -- wrangler rollback`. Additive 0027 is compatible with the old Worker.
2. If 0027 data classification or schema is wrong, stop scheduled/email routes first, record the failure evidence and current Time Travel bookmark, roll back the Worker, then restore D1 to the pre-0027 bookmark:

   ```bash
   npm exec -- wrangler d1 time-travel restore the-valley-desk --bookmark=<recorded-pre-0027-bookmark>
   ```

3. A Time Travel restore overwrites D1 in place and discards writes after the selected bookmark. Compare/export intervening review decisions before authorizing it. Do not substitute an improvised `DROP TABLE` rollback.
4. Re-run `/api/health`, `PRAGMA foreign_key_check`, pre-existing email/verification counts, open-alert inventory, and source-health inventory. Resume schedules only after those checks match the recorded preflight state.

Cloudflare reference: [D1 migrations and automatic backup](https://developers.cloudflare.com/d1/wrangler-commands/), [Time Travel restore semantics](https://developers.cloudflare.com/d1/reference/time-travel/), and [D1 export/import](https://developers.cloudflare.com/d1/best-practices/import-export-data/).

## Slug backlog and fetch-diagnostic acceptance

The slug follow-up requires no migration, manual row repair, routing change,
or credential change. Ordinary automation considers at most 24 malformed
review paths per run, preserves candidate/source identity and discovery dates,
holds published paths and existing/proposed collisions, and reevaluates changed
fingerprints through the normal editorial gates. Verify new fingerprint-specific
milestones for both House items (freshness hold) and CMS (evidence requirement),
while retaining all historical milestones. A failed or unchanged listing must
not prevent this backlog processing. Slug repair does not make old actions fresh.

Before the natural cycle, start a bounded unfiltered tail in a restricted
directory; an optional filtered tail is supplementary. After deployment verify
actual invocation payload delivery, not merely socket connection/ping/pong.
If payloads remain absent, report the log-evidence gap explicitly. Do not change
credentials or observability permissions to work around it without authorization.
Stop task-owned captures after the bounded observation. Preserve D1 readback
alongside logs and distinguish deployment-interval attribution from exact-version
invocation proof. Never force ingestion or reset schedules to produce evidence.

`official-fetch` events expose listing/detail source ID, phase, elapsed time,
attempt/hop, configured/effective timeout, remaining shared budget, status and
typed failure, consumed body-byte count, and a local fetch correlation ID. The
fetch ID is not a provider request ID or proof of Worker location/version. They
exclude URLs, headers, raw bodies and exception messages.
A header wait, body-read abort and exhausted shared budget are distinct evidence;
none alone proves the origin's deeper cause. Timeout allocations are unchanged.
Zero new discoveries still means sustained timeliness is unproven; retain the
historical 2h17m20s miss. Full-PDF evidence and baseline presentation remain separate.
