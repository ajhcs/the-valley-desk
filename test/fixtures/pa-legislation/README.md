# Pennsylvania regression evidence

`captured-*-20260906.html` are byte-for-byte official HTTP responses, not
synthetic pages. Captured by the application-header probes in
`/mnt/d/tmp/plumbob/tvd-pa-release-20260906-X6P8Ic/official-probes.json`:

| File | Official URL | Capture UTC |
| --- | --- | --- |
| captured-hb1925-20260906.html | https://www.palegis.us/legislation/bills/2025/hb1925 | 2026-09-06T21:06:57.409Z |
| captured-sb1113-20260906.html | https://www.palegis.us/legislation/bills/2025/sb1113 | 2026-09-06T21:06:58.083Z |
| captured-hb1993-20260906.html | https://www.palegis.us/legislation/bills/2025/hb1993 | 2026-09-06T21:06:58.649Z |

The mandatory `cloudflare-ops.test.ts` regression verifies their original
SHA-256 values, printer/action expectations, migrated-schema persistence,
older printer history, date separation, malformed-version rejection, missing
date blockers and unchanged-ingestion idempotency. Expected values belong to
these snapshots only, never production parser constants. Preserve line endings.

The PN100/PN101 bill pages and House/Senate committee XML are **synthetic**
fixtures for legislative changes and positive committee meetings. They are
separate from the captured official pages and are not production evidence.
