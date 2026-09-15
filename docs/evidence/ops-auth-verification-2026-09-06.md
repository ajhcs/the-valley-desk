# Authenticated operations verification — 2026-09-06

## Contract and current evidence

There are two separate contracts:

1. `/api/automation/status*` is the machine route. It accepts only `Authorization: Bearer $REVIEW_API_TOKEN`, performs constant-time comparison, and returns 404 for missing/invalid credentials.
2. `/ops` and `/ops/api/*` are the browser route. They do not accept the bearer. They require a platform-supplied `ctx.access.getIdentity()` value equal to `clyons@ajhcs.org`, ignore request email headers, and deny `*.workers.dev` even if a context is supplied.

Cloudflare secret metadata confirms `REVIEW_API_TOKEN` is installed in the deployed Worker. Cloudflare does not expose a stored secret value after creation. The investigation did not attempt to retrieve it. `REVIEW_API_TOKEN` was absent from the operator process and the repository `.dev.vars` file was absent. No repository consumer embeds or reads the bearer; the browser UI calls `/ops/api/*` and relies on Access context.

At 2026-09-06T20:35Z, read-only production requests returned:

| Request | Result | State |
| --- | --- | --- |
| machine status, no bearer | HTTP 404, 0 redirects, 0.337674s | **Verified in production** |
| machine status, deliberately invalid bearer | HTTP 404, 0 redirects, 0.286715s | **Verified in production** |
| `/ops`, no Access identity | HTTP 404, 0 redirects, 0.215191s | **Verified in production** |
| machine status, valid bearer | Not run: no operator-held value available | **Still blocked** |
| `/ops`, valid Access identity | No Access application was found in the Stage 0–1 check | **Still blocked** |

No token value, token hash, Authorization header, cookie, or Access assertion is recorded here.

## Local validation

The schema-migrated local test proves:

- missing and invalid bearer credentials return 404;
- a valid bearer returns schema/build identity, policy metrics, per-source timing, and email authentication states;
- the returned policy source/candidate metrics equal direct SQL counts from the same database;
- a spoofed `cf-access-authenticated-user-email` header returns 404;
- only trusted runtime Access context admits the apex `/ops` and `/ops/api/*` routes;
- the same trusted context remains denied on `workers.dev`.

This is **implemented locally** evidence, not production authentication acceptance.

## Credential-management decision

First ask the authorized operator whether the original bearer is in the approved password manager. If it is, use it only from a non-logging shell for the read-only status request; do not copy it into Git, task output, command history, or `.dev.vars` on a shared host.

If the operator copy is lost, rotation requires explicit operational authorization. Cloudflare documents that `wrangler secret put` deploys immediately; use the decoupled version workflow instead:

```text
# Enter the new high-entropy value only at Wrangler's hidden prompt.
npm exec -- wrangler versions secret put REVIEW_API_TOKEN \
  --message "stage REVIEW_API_TOKEN rotation for authorized ops verification" \
  --tag ops-token-rotation-YYYYMMDD

# After the new version ID and affected consumers are reviewed and authorized:
npm exec -- wrangler versions deploy <new-version-id>@100% \
  --message "authorize REVIEW_API_TOKEN rotation"
```

Affected consumers are every out-of-repository machine client of `/api/automation/status*`, `/api/review-queue*`, `/api/executive-observations*`, and `/api/email-pdf-attachments*`. The `/ops` browser UI, the scheduled collector, model access, social collector, public routes, and newsletter routing do not consume this bearer. No machine consumer is configured in this repository, so the operator must inventory external consumers before activation.

Rollback is `npm exec -- wrangler rollback 9a40e955-3323-42c7-b66c-0de8d02f5f0b --message "restore prior REVIEW_API_TOKEN binding" --yes`, followed by restoring the previous credential in every affected client. The Worker rollback changes no D1 data. This command is prepared only; it was not run.

References: [Cloudflare Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/) and [Worker rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

## Production acceptance check awaiting authorization

Use either the existing operator-held bearer or an authorized rotation. Save only status code, request time, response checksum, schema/build identity, and redacted aggregate values. In the same narrow time window, run read-only D1 SELECTs for:

- policy source registered/attempted/healthy counts and per-source timestamps;
- policy discovered/actionable/filtered/dated/detail-complete/accepted/converted/published/milestone counts;
- `email_discoveries` grouped by `auth_state`, including oldest pending and latest attempt.

Acceptance requires an authorized 200 response whose values reconcile with those SELECTs, while the already-proven missing/invalid cases remain 404. This remains **still blocked**; no credential or routing change was made.
