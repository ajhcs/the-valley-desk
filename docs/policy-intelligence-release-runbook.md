# Policy intelligence migration, verification, and rollback

This is a release plan only. The implementation task did not deploy, apply migration 0027, alter production candidates, or run the policy baseline import.

## Stage 0: immutable-candidate preconditions

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

Run `docs/evidence/policy-detail-failure-audit.sql` after migration. The 20 CMS rows should remain active and recover only through the registered apex/`www` redirect; the six off-path Delaware/NJ navigation rows should be `filtered` with no next attempt. Any remaining policy detail failure outside those expected classifications requires investigation before Stage 1 is accepted.

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
