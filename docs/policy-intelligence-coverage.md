# Policy intelligence coverage

## Scope and editorial posture

Policy discovery is review-only. Official bill text and history establish legislative facts; HAP material establishes HAP's position; NCSL/HIMSS material supplies background and comparison. None of those layers may be rewritten as another layer's claims, and model output cannot authorize publication.

| Instrument or source | Primary record | Version / latest development in baseline | Applicability evidence | Supporting or advocacy evidence | Timeliness class |
|---|---|---|---|---|---|
| Pennsylvania HB 1925 | [General Assembly bill history](https://www.palegis.us/legislation/bills/2025/hb1925) | PN 3349; reported amended May 5 and removed from table June 25, 2026 | Official summary covers AI use in facilities, insurers, and MA/CHIP plans | [HAP testimony, resource 1459](https://www.haponline.org/Resource-Center?resourceid=1459); [HAP opposition, resource 1531](https://www.haponline.org/Resource-Center?resourceid=1531) | Current development when a new action/version appears; older testimony is background unless the bill changes its relevance. |
| Pennsylvania SB 1113 | [General Assembly bill history](https://www.palegis.us/legislation/bills/2025/sb1113) | PN 1376; referred January 9, 2026 | Official summary covers AI use in facilities, insurance, Medicaid, and CHIP | NCSL/HIMSS April 2026 deck, page 15, identifies the pending Medicaid/CHIP requirements | Current only on a new official action/version; deck is background. |
| Pennsylvania HB 1993 | [General Assembly bill history](https://www.palegis.us/legislation/bills/2025/hb1993) | PN 2515; referred October 24, 2025 | Official record concerns AI in mental-health therapy | [Official co-sponsorship memo](https://www.palegis.us/house/co-sponsorship/memo?document=HB1993&memoID=47289) | Current only on a new official action/version; memo is background after introduction. |
| Additional Pennsylvania AI bills | [Artificial-intelligence topic index](https://www.palegis.us/legislation/bills/topics?MajorId=719&SessInd=0&SessYr=2025) | Checked every 30 minutes; each bill must resolve to its own durable instrument/version record | Must contain literal health-care regulated-entity evidence before statewide relevance can replace a named system | [NCSL AI legislation database](https://www.ncsl.org/financial-services/artificial-intelligence-legislation-database) for comparison | New bill/action/version is timely; unchanged indexes are not developments. |
| HAP health IT advocacy | [HAP Health IT resource center](https://www.haponline.org/Resource-Center?topic=10) | Resource ID and revision date preserved | Association applicability is not statutory applicability | Position, substantive concern, and literal spans stored separately | Timely on new/revised advocacy; otherwise background. |
| NCSL/HIMSS supporting evidence | [NCSL AI legislation database](https://www.ncsl.org/financial-services/artificial-intelligence-legislation-database) and retained April 2026 attachment | Attachment SHA-256 and page-number evidence retained | Comparative evidence cannot independently establish Pennsylvania legal requirements | Page 15 supports the SB 1113 comparison | Background unless the source publishes a new dated update. |

## Collector matrix

| Source | Cadence / route | Collector status | Manual or authenticated dependency |
|---|---|---|---|
| PA HB 1925, SB 1113, HB 1993 histories and printer links | Every 30 minutes, policy-critical | Implemented; version/action/history/text URLs persist | None for public HTML. |
| PA artificial-intelligence topic index | Every 30 minutes, policy-critical | Implemented for additional-bill discovery | Relevance and healthcare-applicability evidence are still required. |
| PA House Health and Senate Health & Human Services committees | Every 30 minutes, policy-critical | Implemented for meeting/hearing discovery | None for public committee pages. |
| HAP Health IT resource center | Every 30 minutes, policy-critical, `/Resource-Center` path only | Implemented; `resourceid` remains part of identity | No event-page admission; individual documents remain subject to public fetch behavior. |
| NCSL AI legislation database | Every 30 minutes, policy-critical | Implemented as association/background discovery | NCSL analysis never replaces official bill facts. |
| HIMSS/NCSL newsletter attachment | `signals+newsletter@thevalleydesk.org` | Authenticated retention is automatic; PDF extraction and persistence are an explicit manual review step | Requires production Analytics credentials/rule validation and an authorized operator. |

The 15-minute Worker cron evaluates 30-minute due times. The discovery run can
select 40 sources and hydrate/evaluate 20 details per stage with concurrency 4.
Policy-critical work is ordered ahead of ordinary source, detail, and relevance
backlogs. The congestion regression test creates 64 competing due sources and
30 pending detail candidates, makes a source due two seconds after a cron tick,
and proves the next 15-minute tick detects the legislative change in under 60
minutes. Half-hourly cadence leaves 15 minutes of scheduler-jitter margin; an
hourly source could miss the exact tick and take roughly 75 minutes.

## Email authentication provenance

Raw MIME `Authentication-Results`, `ARC-Authentication-Results`, and sender-added lookalike headers are never trusted. `src/ingest/email-auth.ts` obtains the receipt directly from Cloudflare's read-only `emailRoutingAdaptive` GraphQL dataset using a fixed API endpoint and a zone-scoped Analytics Read token. An accepted pointer requires the exact zone/routing rule, envelope sender, routed recipient, Message-ID, session ID, final Worker action, receipt-time proximity, non-spam result, DMARC pass, and SPF or DKIM pass. The canonical receipt and SHA-256 are persisted; linked claims still require public-source verification and remain review-only. Delayed Analytics rows are quarantined as `ignored` and cannot be fetched or reviewed until scheduled correlation succeeds.

Cloudflare's current [Email Worker handler contract](https://developers.cloudflare.com/email-service/api/route-emails/email-handler/) exposes the envelope, headers, raw stream, and size but not an in-process authentication verdict; its [Email Service analytics contract](https://developers.cloudflare.com/email-service/observability/metrics-analytics/) exposes the individual route event, session, rule, SPF, DKIM, DMARC, and spam fields. The adapter joins those two trusted platform surfaces rather than interpreting sender-controlled header text.

This contract is proven locally by the spoof, mismatch, DMARC-failure, route/session correlation, missing-configuration, accepted-receipt, quarantine/promotion, persistence-hash, duplicate, and untrusted-verifier-exclusion tests. The adapter is wired into the production Email Worker entrypoint and scheduled handler. Production still lacks its least-privilege token and exact route identifiers because provisioning is an external release action; without them the handler fails closed. A controlled message correlated to an actual production `emailRoutingAdaptive` row is therefore a mandatory, still-unexecuted release check; adapter mocks do not satisfy it.

## Actual PDF extraction evidence

`scripts/extract-policy-pdf.py` reads a PDF file and search terms; it has no page-text injection input. Against the downloaded 1,620,562-byte `himss-ai-april-2026.pdf`, pypdf 6.9.0 produced a 21-page receipt and review-only candidate with SHA-256 `8dd1fda127c2cb4e0f216585a18ac41fc6d7007ee046c6623b364f73bad57320`. Page 15 contains `Pennsylvania SB 1113` and the Medicaid/CHIP requirements sentence. Because PDF text extraction linearizes the three-column slide, the receipt keeps the page address and a raster cross-check confirmed both belong to the Pennsylvania card rather than the adjacent Indiana or New York cards. The compact receipt is in `docs/evidence/himss-ai-april-2026-extraction.json`.

Malformed PDFs return `malformed-or-unsupported-pdf`; PDFs with zero extracted-text pages return `image-only`; unmatched requested evidence returns `evidence-not-found`. Attachment state and bounded errors remain visible in D1.

PDF extraction is deliberately manual, not an in-Worker automatic processor.
Knox (Engineering) owns the step: download the retained attachment bytes from
the protected `GET /api/email-pdf-attachments/:id/content` route, verify its
SHA-256/ETag against review status, run `scripts/extract-policy-pdf.py` with `--attachment-id` and
`--persistence-payload`, and submit only the emitted `persistenceRequest` to
`POST /api/email-pdf-attachments/:id/extraction` using the review API or trusted
Access context. The endpoint accepts only a still-pending attachment whose
parent email has an authenticated Cloudflare Analytics receipt and matching
artifact hash. It validates contiguous bounded page text and literal evidence,
then persists the page rows and method, request hash, operator, and timestamp;
the parent remains review-only. The authenticated inbound-to-persistence test
exercises this complete path. Production execution remains a release action.

## Source-specific fallback posture

| Source family | Primary failure mode observed | Safe strategy | Authority boundary |
|---|---|---|---|
| Cooper | First-party newsroom blocks automated collection; PhillyVoice fallback remains active | Keep the first-party schedule and backoff visible; use fallback only to discover a candidate that must be corroborated | A fallback article cannot establish Cooper's official position or silently resolve primary health. |
| Penn / Penn Princeton / Penn Doylestown | Empty or unreadable leadership HTML and some 403 pages | Prefer registered alternate first-party pages and require complete snapshots; keep blocked coverage explicit | Never infer a departure from an unreadable or partial roster. |
| LVHN | Leadership and newsroom paths returned 403 or no readable content | Retry with bounded backoff and register a replacement only after manual validation of stable first-party content | No vendor/search snippet substitution for executive facts. |
| HAP | Resource identity is carried in `resourceid`; dropping the query collapses distinct testimony | Preserve only numeric `resourceid` on the exact Resource Center path | HAP's position remains advocacy, not bill language. |
| Pennsylvania House archives | Public memo/archive identity is query-based | Preserve only validated `memoID`, `document`, or safe PDF `file` values on exact paths | All other query parameters are stripped. |

## Metrics

The authenticated operations payload reports a rolling 30-day policy funnel with explicit numerators and denominators: source coverage, publication-date coverage, detail coverage, relevance-to-conversion, conversion-to-publication, and average hours from source development to publication. Filtered navigation rows are visible but excluded from actionable denominators. Per-source rows include last success, last discovery, last substantive discovery, actionable failure/hold counts, average detection time, oldest unresolved review, and average time to the first persisted cited brief or explicit blocker. Initial targets are 60 minutes to detection and two hours to a brief or blocker. Zero output is classified as no discoveries, all discoveries filtered, missing source dates, missing detail evidence, no relevance acceptances, no conversions, or no publications.

The baseline command is `npm run backfill:policy:dry-run`. It performs no D1 write. The exported application function is idempotent and intentionally requires a separately authorized operational caller; this task does not apply it to production.
