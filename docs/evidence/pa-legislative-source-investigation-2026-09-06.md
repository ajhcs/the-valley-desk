# Pennsylvania legislative source investigation — 2026-09-06

Status labels in this record are deliberate:

- **Verified in production:** read-only observations from deployed commit `f6dea9148e482ee5af31bfb3f691d71e69604942`, Worker `9a40e955-3323-42c7-b66c-0de8d02f5f0b`, schema `0027`.
- **Implemented locally:** the un-deployed candidate switches only the two committee listings to supported official RSS and adds a Health-committee parser. Bill and topic pages keep their existing bounded collector and typed degradation.
- **Still blocked:** no deployed candidate check or production persistence has been authorized. Production recovery is not claimed.

## Production symptom

The first natural post-0027 run (`47bf441e-66e2-4746-9ef6-3324b9f37ebd`) stored the same failure for all six sources: `The operation was aborted due to timeout`. A read-only query at 2026-09-06T20:37Z confirmed their latest attempt remained 2026-09-06T20:00:04.576Z, with `state=failed`, `consecutive_failures=1`, and no prior success. The query reported `changes=0`, `changed_db=false`, and `rows_written=0`.

The deployed collector allows 8 seconds per source within a shared 25-second official-source stage. The stored rows do not retain HTTP status, redirect hops, or per-hop timing, so those values cannot be reconstructed for the failed production request.

## Direct and edge comparisons

All probes were read-only GETs. `www.palegis.us` produced no redirects in either mode. An apex control (`palegis.us`) produced `301 Location: https://www.palegis.us/...` followed by 200 with the application identity.

| Source | Plain curl at 20:05Z | Direct with deployed app headers | Isolated Cloudflare edge with deployed app headers at 20:26:51Z | Redirect chain |
| --- | ---: | ---: | ---: | --- |
| HB 1925 | 403, 0.201139s, 2,914 B | 200, 0.560s, 105,360 B | 200, 1,495ms | `www`: none |
| SB 1113 | 403, 0.111577s, 2,914 B | 200, 0.452s, 67,906 B | 200, 271ms | `www`: none |
| HB 1993 | 403, 0.110942s, 2,914 B | 200, 0.254s, 54,362 B | 200, 151ms | `www`: none |
| AI topic index | 403, 0.102635s, 2,914 B | 200, 0.224s, 54,739 B | 200, 500ms | `www`: none |
| House Health page | 403, 0.109095s, 2,914 B | 200, 0.791s, 188,958 B | 200, 615ms | `www`: none |
| Senate Health page | 403, 0.113591s, 2,914 B | 200, 0.697s, 164,068 B | 200, 486ms | `www`: none |

The application identity was exactly `User-Agent: TheValleyDesk/0.1 (+https://github.com/ajhcs/the-valley-desk)` with the collector's HTML/XML `Accept` header and manual redirects. The isolated edge probe used a temporary remote-preview Worker with no bindings and no production resources; it was stopped after the probe. All six responses were 200 from Cloudflare's runtime.

### Finding

The direct 403 is an origin/access-policy response to the generic curl client profile, not evidence that the official site blocks the deployed application identity. The isolated Worker results also rule out the current fetch headers, manual redirect policy, and Cloudflare egress as a reproducible cause. The historical deployed aborts are therefore best classified as transient upstream/shared-deadline failures; the production evidence is insufficient to choose between those two timing causes. Typed failure/backoff must remain until a deployed run returns and persists actual evidence.

## Supported official sources

The [General Assembly data page](https://www.palegis.us/data) identifies its current-session Bill History archive as an official export updated hourly on business days. Its documented content includes bill/session identity, last update, sponsors, printer-number history and bill-text PDF URLs, action chamber/verb/committee/date, co-sponsorship memos, and amendments.

| Official endpoint | Probe | Use/constraint |
| --- | --- | --- |
| `https://www.palegis.us/data/file?documentType=BillHistoryData&session=2025_0` | 200, 0.448s, 1,560,309 B | Authoritative bulk bill/action history; delivered as a ZIP attachment despite an XML content type. It exceeds the current 524,288-byte bound and is not the smallest safe Worker change. |
| `https://www.palegis.us/house/rss/committee/schedule` | 200, 0.187s, 25,065 B; edge 200, 71ms | Supported House committee schedule RSS with meeting date/time, committee, bills, description, and location. |
| `https://www.palegis.us/senate/rss/committee/schedule` | 200, 0.158s, 9,401 B; edge 200, 78ms | Supported Senate committee schedule RSS with the same provenance fields. |
| `https://www.palegis.us/house/rss/session/amendments` | 200, 0.294s, 319,823 B | Supported chamber amendment feed; retained as a documented future fallback, not added to registry without a source-coverage decision. |
| `https://www.palegis.us/senate/rss/session/amendments` | 200, 0.225s, 101,775 B | Supported chamber amendment feed; same constraint. |

## Local candidate

The candidate changes `ofs-pa-house-health-committee` and `ofs-pa-senate-health-committee` from large committee HTML pages to their respective official RSS endpoints. It also makes monitored bill pages emit only their self-contained bill candidate and scopes the AI topic index to current-session `/legislation/bills/2025/` links, preventing global navigation and related-topic links from entering detail hydration. The source-specific parser:

- matches only exact `HOUSE HEALTH` or `SENATE HEALTH & HUMAN SERVICES` identities, including a Health meeting embedded in a joint meeting;
- preserves official source-page URL, stable meeting date/time identity, meeting date, committee name, bill identifiers, description, location, response hash, fetch time, and regulatory trust;
- marks the normalized candidate `review` with `detail_state=success`, so no secondary page fetch is needed;
- keeps instruction-like source text hostile and keeps all source/size/timeout/redirect bounds;
- leaves HB 1925, SB 1113, HB 1993, and the AI topic monitor on their official pages because those pages succeed from the current Worker fetch contract and preserve printer-number/action detail; bill-page navigation and printer PDFs remain provenance, not secondary candidates.

Fixtures are in `test/fixtures/pa-legislation/`. The focused test covers an introduced/committee bill, a changed printer number and amendment date, unrelated committee filtering, House and Senate Health events, provenance, request headers, manual redirects, and review-only conversion. The existing end-to-end legislative ledger test now reads the bill and amendment fixtures and still proves PN 100 → PN 101 → hearing persistence.

A final read-only run of this exact local collector against all six real official endpoints returned six `success` snapshots: House RSS 25,065 bytes/zero current Health meetings; AI topic 54,739 bytes/five current-session bill candidates (HB 96, 315, 2172, 2730, 2735); HB 1925 105,360 bytes/one self-contained candidate; HB 1993 54,362 bytes/one; SB 1113 67,906 bytes/one; Senate RSS 9,401 bytes/zero current Health meetings. The three monitored bill candidates had `detail_state=success` and official printer PDFs (HB 1925 PN 3349, HB 1993 PN 2515, SB 1113 PN 1376). This was local and non-persistent, so it is not production recovery evidence.

## Deployed acceptance check awaiting authorization

Deployment is required before recovery can be claimed. After explicit authorization:

1. Deploy the exact reviewed candidate without changing schema, credentials, routes, or newsletter intake.
2. Allow or explicitly authorize one due production collection pass; do not reset schedules or backfill.
3. Read back the six schedule rows plus the new snapshots and `official_source_candidates` rows. Acceptance requires at least one real bill-page candidate with `detail_state=success`, a non-empty `detail_hash`, bill/session identity, a source-authored action date, and the official history/text provenance persisted with `status=review`. A successful schedule row by itself is insufficient.
4. Confirm the RSS sources either persist a real Health meeting when one exists or persist a successful/unchanged snapshot with zero Health candidates when the official feed contains none. That zero is not bill recovery evidence.

Until those steps are authorized and pass, Pennsylvania collection is **implemented locally** and externally reachable, but **still blocked from production verification**.
