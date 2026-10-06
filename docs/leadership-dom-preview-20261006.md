# Offline regional leadership DOM repair, October 6

Owner: regional-source engineering; independent reviewer: successor independent retest. Base: approved capture commit 24a6dc40ef7156f7dca256405ac887747ef209a1. Isolated BuilderBob clone `tvd-leadership-parser-retained-20261006`; canonical checkout, PA/PR18, prior dirty work and worktrees preserved.

## Implemented locally

The offline parser repairs CHOP roster/custom cards, three exact CHOP profiles, Temple same-paragraph name/role pairs, Inspira same-block heading pairs, and two named Nemours executive/medical tabs. It rejects sibling/nested field borrowing, duplicate identities, wrong profile/page identity, article metadata, board tabs, Florida roles, hostile text, oversized/deep/wide documents and ambiguous structures. Names retain credentials separately and preserve suffixes/explicit nicknames. Literal Delaware Valley scope is distinct from institution-wide or unspecified scope. Academic roles are not silently attributed to a health-system employer.

Seven already-retained HTTP 200 HTML responses were read in memory with SHA256 and byte/URL/decoding checks. The non-raw evidence manifest records retrieval dates, expiry, source attribution, hashes and counts. Review candidates: CHOP roster 13, Desai 1, Pennington 1, Salmasian 1, Temple 20, Inspira 13, Nemours 22: **71 source-bound candidates**, not unique people, verified current affiliations, complete rosters or live recovery. Source publication dates remain unknown. Every result is partial/review-only; no freshness renewal or departure authority.

Synthetic tests preserve minimal invented DOM structures rather than publisher responses. No production collector imports the preview. Production registry, collector scheduling, capture migration/expiry and affiliation storage are unchanged. CLI evaluator refuses inspection at/after Oct 7 04:00 UTC and validates the exact seven-source set, capture window, HTML200, decoding, size, hashes and configured/attempted/final URL equality. Public HTTP access policy/backoff remains unchanged.

The separate Worker alert patch prevents missing configuration from resolving an existing source outage or satisfying a recovery streak. It leaves detection visible and requires two subsequent successful observations. It does not reopen historical resolved alerts or change disabled-source policy.

## Review and release gates

Independent review precedes any release. Integrating the preview into a live parser still requires exact source contracts, source-specific qualification/empty semantics, stale-evidence/departure tests, cross-source disambiguation and reviewed fresh source observations under existing permitted-fetch policy. All ordinary last-success dates and cooldowns remain unchanged. No deployment, publisher fetch, production mutation, outreach or retention extension is authorized by this patch.

Full release test/build/secret scan gates remain required before deployment; AJHCS owns the heavy-test slot. Focused offline checks are recorded in the BuilderBob artifact directory. Test typechecking cannot use missing Node typings; parser-only strict typecheck uses existing dependencies without installs.

## Retention incident record

The first legacy metadata probe unexpectedly emitted malformed title fields containing escaped HTML/biography fragments into tool output. Those fields were removed from the stored metadata artifact. No complete response was sent externally. Wrangler also automatically created one local debug log containing the raw query result, despite stdout being handled in memory. After verifying the exact filename and all seven capture identities/hashes, that generated log was deleted. Subsequent reads used a process-local `WRANGLER_LOG_PATH` symlink ending `.log` and resolving to `/dev/null`; no global settings changed. This incidental copy is not described as compliant raw-free handling. Original captures and their existing expiry were preserved. The local deletion receipt records the incident; provider historical retention remains outside this local cleanup.

## Independent review correction

Independent review requested changes on frozen 50561de: unchecked display names and rejected section labels could emit synthetic escaped markup despite 92 focused and 6 selected owner checks and 51 reviewer checks passing. The successor validates the full bounded display name before credential removal using an explicit credential/suffix allowlist, discards all unproven dynamic section labels, validates every candidate/rejection string, rejects encoded markup/control/backslash fragments in names and roles, and canonicalizes response timestamps. Added regressions reproduce both reviewer probes, encoded/serialized fragments, known public credential variants and date comments. A new integrity-checked in-memory evaluation reproduces the same 71 review candidates. The first frozen patch remains unaccepted; successor acceptance requires a separate immutable independent retest. No production state changed.

The next independent review fixed the original probes but identified semicolonless entity fragments. The final successor conservatively rejects every remaining entity-like ampersand prefix, including recursive named/numeric escapes and encoded controls; ordinary factual ampersand prose stays supported. Synthetic DOM and complete seven-row evaluator regressions cover that boundary. Existing 71-candidate non-raw metadata passes the stronger guard. This final guard check reads no response body and does not represent a new DOM replay, source fetch, freshness observation or affiliation verification.
