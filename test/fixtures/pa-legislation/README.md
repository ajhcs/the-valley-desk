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

## Official PDF bytes — 2026-09-07

The three `captured-*-pn*-20260907.pdf` files are unmodified official HTTP
response bodies captured at approximately 20:49 UTC. They are **not** PDFs
generated from injected text. Capture receipt and redirect/status/timing records:
`/mnt/d/tmp/plumbob/tvd-policy-background-k5GqE8/official-replay/receipt.json`.

| Bill / selected printer | Pages | SHA-256 |
| --- | ---: | --- |
| HB1925 PN3349 | 43 | `120fbf987f734d1ca437a30d582455853d7f68221c701b9eb99a68de2d329971` |
| SB1113 PN1376 | 29 | `caaceef30b7adda3c38b83411bc412b5bb0403869ae3048890c4b81748808779` |
| HB1993 PN2515 | 7 | `058e1a7f3e8f436af3f205be22e86cddd3e88cb946541fa53a0e0b996bca9f69` |

Official URL pattern (substitute the table's bill and printer):
`https://palegis.us/legislation/bills/text/PDF/2025/0/HB1925/PN3349`.
The captured HTML above independently selects these same versions. SB1113's
PDF header says Session of 2026, the second year of the URL's 2025–2026 session;
this is expected and must not be confused with a different biennium.

`npm run test:policy-pdf` verifies exact hashes and extracts every page through
hash-locked pypdf. Its synthetic byte fixtures are explicitly labeled separately.
Text extraction does not resolve amendment strikeout/underline semantics and
never authorizes publication or an assertion that proposed language is law.
