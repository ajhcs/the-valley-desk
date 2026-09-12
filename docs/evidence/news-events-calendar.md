# News and Events Tightening

## Scope and Evidence

This slice preserves existing News filters, Events listings, Google calendar links,
and deterministic editorial gates. It adds a durable subscription-feed implementation,
targeted event-copy cleanup, and content-free verifier instrumentation. It does not
activate a production endpoint, perform ingestion, or invoke a model.

The cleanup regression uses a literal excerpt from the retained public readback
`/mnt/d/tmp/plumbob/tvd-spark-release-HchTeo/publication-verifier-readback.json`,
event `evt-dvhimss-22958`, inspected on 2026-09-12. Its official permalink is
https://dvhimss.org/events-calendar/njdvhimss-fall-converence.
The actual residue consists of WPBakery wrappers and generated `#default-btn-...`
margin rules. The helper removes only these recognized wrappers/rules and embedded
style/script elements, preserving enclosed prose and unknown bracketed text.
Raw source observations are unchanged. Ingestion and legacy event presentation both
use the helper; shared News evidence normalization is untouched.

## Calendar Integration Contract

Apply `0036_event_calendar.sql` before enabling runtime maintenance or delivery.
Add `test/event-calendar.test.ts` and `test/verifier-diagnostics.test.ts` to the
integration branch's explicit test list.

```ts
await maintainEventCalendar(db, trustedPublishedCatalog, explicitWithdrawalIds,
  new Date(), "https://thevalleydesk.org");
return handleEventCalendar(request, {
  VALLEY_DESK_DB: db,
  EVENT_CALENDAR_PUBLIC_ENABLED: "true",
});
```

The maintenance signature is `(db, items, withdrawnIds, now?, origin?, restoredIds?, guards?)`, returning
`{changed, considered, withdrawals}`. Run inside the existing ingestion lock after
publication persistence, with the complete trusted published overlay and durable
explicit withdrawal IDs. Never derive withdrawals from a missing source page/item.
The handler is read-only; root integration owns `/events.ics`, deployment flags,
scheduled maintenance, and availability-gated subscription controls. The helper
`calendarSubscriptionUrls(origin?)` supplies HTTPS download and `webcal:` links.
Existing per-event Google calendar links remain intact.

Each event has a SHA-256-derived stable UID independent of start time or slug.
Material calendar payload changes atomically increment SEQUENCE and append immutable
history. Refresh-only `updatedAt`/`fetchedAt` changes do not alter the feed or ETag.
DTSTART comes from the published source schedule; DTSTAMP and LAST-MODIFIED record
the durable calendar object's material revision, not each fetch or HTTP request.
Explicit withdrawal retains UID, title, location and dates, blanks description,
and marks the object CANCELLED. Independent durable withdrawal timestamps also
cover events not yet present in the calendar. Transactional CHECK guards stop a
first stale capture or restoration when a withdrawal arrives during its write.
Restoration requires an explicitly current approved republication ID and a clock
strictly newer than the latest confirmed withdrawal; stale catalog discovery is
insufficient. Withdrawal markers and event audit history are never deleted.
Source cancellation can later be corrected with another material revision.

Calendar text is serialized with pinned `ical.js` 2.2.1, not handwritten escaping.
It is a dependency-free MPL-2.0 implementation supporting Workers/browser JavaScript:
https://github.com/kewisch/ical.js. Format requirements follow RFC 5545:
https://www.rfc-editor.org/rfc/rfc5545.
Tests parse output using ICAL.js's separate parser and assert CRLF/UTF-8 physical-line
bounds; this is not a claim of cross-vendor calendar-client certification.
Timed events use UTC instants. Date-only events preserve civil dates with exclusive
end dates through DST. Unknown clocks are explicit Time TBD, TENTATIVE and TRANSPARENT,
not fabricated midnight appointments. Unknown timed end dates are omitted.

GET/HEAD support strong ETag conditional requests and expose material-event
Last-Modified. IMS-only requests return 200: rolling feed membership can change
without a new event revision, so that clock cannot safely prove a 304. Flag absence,
missing storage, invalid persisted payload or exceeded bounds returns uncached 503.
Bounds: 5,000 published inputs/restoration IDs, 1,000 withdrawal IDs, 500 delivered records and 2 MB
serialized output. Maintenance is atomic per event, not across the entire catalog.
Delivery selects event intervals overlapping the past 90 days through the next
365 days; recent cancellations remain for 90 days after their calendar revision
even when their event date is older. Timed bounds use UTC instants; civil dates
remain civil dates. Selection precedes the 500-record cap; retained historical
entries do not consume current-feed capacity. More than 500 selected records still
fails closed. History/tombstones remain retained independently of this feed window.
Serializer and HTTP handler accept an optional injected Date for deterministic
boundary testing. Failed or malformed D1 result envelopes return uncached 503,
never a successful empty calendar.

Additional local qualification: all 15 calendar tests pass, including a withdrawal
before first capture, a concurrent stale first write, a later withdrawal during
restoration, 501 historical entries plus active boundary events, inclusive temporal
boundaries, rolling ETag changes, and more than 500 active events failing closed.

## Verifier Instrumentation

Retained production readback records `verifier-malformed` but does not retain the
provider response shape. That evidence cannot establish truncation, fenced formatting,
or a provider schema defect. No reliability fix is claimed.

Second-model verification now reuses the bounded 262,144-byte body reader and safe
diagnostic-shape helper. Failure logs use `verifier-response-diagnostic` with bounded
phase/failure codes, SHA-256, byte count, parser category/offset, allowlisted finish
reason, and numeric usage. No raw response, provider headers, prompts, credentials,
or native parser error strings are logged or returned. Optional diagnostic callbacks
cannot alter decisions. Existing extraction, schema, objection and approval rules
remain unchanged. Synthetic tests distinguish malformed outer JSON, inner syntax,
schema rejection and response-size failures; none is labeled a production reproduction.

## Remaining Original-Plan Work

Root integration supersedes the earlier isolated-branch test blockers: the runtime
stamp now names 0036, the PDF runtime is bootstrapped, and full `npm test` passes,
including 93 additional launch tests. TypeScript/Vite build also passes.
The publication snapshot clock in 0036 advances on candidate, publication and
reconciliation changes. Every calendar write checks that captured clock in its
transaction; a withdrawal after snapshot reading cannot be undone by stale approval
data. Failed publication reads now throw instead of becoming an empty snapshot.
Three SQLite runtime tests cover overlays, withdrawal/republication, snapshot races
and failed reads, in addition to the 15 calendar tests.

Local Playwright checks pass for News/Events at 320, 390, 768 and 1440 pixels,
including availability-gated calendar links, wrong content type, keyboard focus
and 200% zoom. Eleven checks and eight screenshots are retained in
`/mnt/d/tmp/plumbob/tvd-launch-calendar-browser-20260912/`. Calendar availability
responses are intercepted test inputs, not proof of a live endpoint. Both calendar
flags remain disabled by absence. No production activation is claimed.

- Activate collection before calendar delivery only after migration, initial sync,
  production backup/rollback qualification and exact-candidate release checks.
- Calendar client interoperability checks and monitoring of the selected 500-event window.
- Optional source-backed registration/price states and a versioned explicit event-time
  contract remain separate enhancements; current legacy date interpretation is preserved.
- Assess verifier reliability from the next natural diagnostic-bearing cycle before
  changing token budget or parsing contract. No extra paid qualification call is required.
