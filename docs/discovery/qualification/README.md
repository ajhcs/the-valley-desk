# Real source qualification — 15 November 2026

Bounded live checks produced usable, licensed organization evidence and concrete
access/format holds. No source is approved for unattended production collection,
and no full WP12/WP13 acceptance or WP03 freeze is granted.

| Source and intended use | Actual evidence | Disposition |
| --- | --- | --- |
| ROR Penn and CHOP organization metadata for manual evidence review | Two anonymous, pinned-public-IP HTTPS requests returned 200 application/json: Penn 2,123 bytes and CHOP 1,426 bytes. Exact original bodies and safe observation receipts are retained. Official ROR documentation states IDs and metadata are CC0; independent offline record/URI/contact checks passed. | Pass for this bounded manual organization-metadata evidence scope. Not WP06 registry authority qualification or WP13 native parser qualification. |
| OpenMRS Talk forum text | Public policy documentation describes CC BY 4.0 original contributions, with attribution and third-party exceptions. Direct robots, terms and basic-info probes all returned 403; no discussion body was requested. | Access hold. Robots rules, installation version, anonymous API shape and automation compatibility remain unqualified. No bypass attempted. |
| OHDSI and Slicer forum contributions | Primary user-content terms specify CC BY-NC-SA 3.0. | Excluded from the general commercial redisplay path without separately established compatible permission. Terms-document/footer licenses do not replace the contribution license. |
| Penn Medicine / CBICA profile pages | Observed Penn Medicine robots rules disallow query URLs, conflicting with WP13's required `?page=N`. Software licenses do not grant website/profile-body rights. No profile body was acquired. | Rights/access/format hold. ROR licensing does not license linked Penn or CHOP pages. |

The two ROR data responses were observed at approximately **3:34–3:40 p.m. ET**.
Their original receipts retain UTC timestamps. ROR's robots document returned 403,
while its explicitly documented organization API returned 200. These are different
resources; neither observation is generalized into a blanket API outage or
unrestricted crawling permission. The two fixed organization IDs were selected
explicitly; related organizations and website links were not automatically crawled.

See the [institution assessment](institution-source-assessment.md),
[forum assessment](forum-source-assessment.md),
[independent review](independent-source-review.md) and
[Astra review](astra-source-review.md). Publisher bases include
[ROR terms](https://ror.org/about/terms/),
[official data documentation](https://ror.readme.io/docs/data-dump) and
[OpenMRS terms](https://talk.openmrs.org/tos). ROR terms were available through
primary search evidence but direct retrieval returned 403; the official data/API
documentation was independently retrieved successfully. The native response and
field inspection establish what the registry reported, not the truth of a person's
employment, actual unit, county eligibility, health-tech contribution or authorship.

## Exact evidence and transport boundary

[Penn body](evidence/ror-penn-20261115/body.json) and
[CHOP body](evidence/ror-chop-20261115/body.json) are unchanged native CC0 JSON,
not HTML wrappers or derived synthetic fixtures. Their companion observation
receipts preserve the original workspace body path as historical metadata; the
portable material paths are in the [staging index](wp03-material-index.json).
[Access observations](evidence/access-observations.json) contain safe headers,
status, byte count, hash and public-IP decisions; no cookies or credentials.
The aggregate explicitly explains the first receipt's legacy `native_transport`
field; all six observations used standalone Python HTTPS, not WP06.

The standalone [capture method](evidence/capture-method.py) uses a fixed URL
allowlist, no authentication/proxy/redirects, default certificate verification,
hostname-preserving TLS to a resolved public IP, identity encoding and byte caps.
Each actual root invocation had an outer 25-second subprocess deadline; socket
timeouts alone do not implement a total deadline. Policy and data reads are
separate from the WP06 transport. This script is a retained investigation method,
not an installed source collector, permission grant or unattended schedule.

Native ROR record identity checks preceded private capture; independent full
field/URI/contact review preceded the portable copy. This is a source-specific
CC0 organization-metadata decision, not evidence that arbitrary provider bodies
can be retained before privacy review. Neither direct receipts nor replay test
capabilities authenticate a real WP06 qualification or WP03 permission statement.

## Native format finding and repair

ROR's exact fixed, query-free JSON URL cannot satisfy WP13's registered paged
HTML grammar. The unchanged Penn body already failed the old HTML parser's URL
checks; no actual ROR success is claimed. A separate hash-bound synthetic probe
did establish that harmless JSON/plain text could become a healthy empty HTML
inventory when the declared roster was zero.

The minimal fix requires leading HTML markup after UTF-8/BOM/whitespace handling.
All JSON/plain text now fail with a fixed unsupported-format code before raw
capture; valid BOM/whitespace HTML remains supported. Actual-byte offline D1
replay and synthetic format regressions are explicitly distinguished from live
requests. No JSON-to-HTML conversion, new ROR adapter or MIME-validation claim
is introduced. WP06 still lacks a general MIME binding for these parsers.

## WP03 handoff

The [material index](wp03-material-index.json) now contains **two real unannotated
development-exposed organization records**. [The staging note](wp03-real-material.md)
and [entry review](wp03-evidence-entry-review.md) explain the limits. Family and
partition assignment remain unreviewed; this material is not fresh held-out truth.
There are still zero actual reference cases/reviewers and no authenticated
evidence/permission receipts, independent labels or accountable freeze. The
strict reference manifest remains unchanged and not_frozen; WP14 remains gated.

Next work is an explicitly reviewed native organization-JSON mapping if needed,
provider-approved forum access and retention scope, and accountable source/trust/
human-review/corpus assembly. None is supplied by an HTTP 200 or a license string.
