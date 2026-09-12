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

The maintenance signature is `(db, items, withdrawnIds, now?, origin?)`, returning
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
and permanently marks the object CANCELLED. It cannot resurrect from a stale catalog.
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

GET/HEAD support strong ETag and Last-Modified conditional requests. Flag absence,
missing storage, invalid persisted payload or exceeded bounds returns uncached 503.
Bounds: 500 published inputs, 1,000 withdrawal IDs, 500 delivered records and 2 MB
serialized output. Maintenance is atomic per event, not across the entire catalog.
There is deliberately no automatic history/tombstone pruning. An explicit retention
horizon and capacity monitoring are required before the retained feed approaches 500
objects; overflow fails closed rather than silently dropping cancellations.

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

Local verification: 221 relevant calendar/events/news/editor tests passed, plus three
verifier instrumentation tests; TypeScript/Vite build passed. The full `npm test`
attempt is not green in this isolated branch: the root-owned runtime minimum migration
still names 0030 instead of the new maximum 0036, and the separate PDF Python runtime
is not bootstrapped (`node_modules/.policy-pdf/bin/python` missing). Root integration
must reconcile the runtime manifest and run the complete release gate with its PDF
runtime. No rendered browser verification is claimed for this isolated slice.

- Root runtime/flag integration and desktop/mobile QA of the activated subscription UI.
- Calendar client interoperability checks and a deliberate cancellation-retention policy.
- Optional source-backed registration/price states and a versioned explicit event-time
  contract remain separate enhancements; current legacy date interpretation is preserved.
- Assess verifier reliability from the next natural diagnostic-bearing cycle before
  changing token budget or parsing contract. No extra paid qualification call is required.
