# WP09 — Astra independent review

Disposition: recommend local implementation acceptance of the final reviewed candidate after root integration checks. Initial blocking findings were corrected and independently challenged. Root owns acceptance.

Final implementation SHA-256: `c21d7c9bfd4b4c458ac70fdf248f3a870b08180d92e8f9f79eef04f962a4a478` (`src/ingest/discovery/pubmed.ts`).

## Findings sent to owner

1. Scope qualification accepted a synthetic institution in Rockville, Montgomery County, Maryland as county `Montgomery`, because county-name substring and a caller-supplied `regionalScope: core` replaced state-qualified geography. Retained reproduction: `.discovery-work/wp09-astra/geography-probe.ts`, output `geography-before.log`. Require county/state binding in reviewed location evidence; retain rejection of out-of-region namesakes.
2. The initial `text()` recursively appended child text after all direct text. `Effect of <i>X</i> on Y` became `Effect of  on YX`. Retained structural reproduction: `.discovery-work/wp09-astra/xml-order-probe.ts`, output `xml-order-before.log`. Preserve ordered mixed content or explicitly reject unsupported mixed text. Do not reorder source wording into a candidate.

## Final corrections and independent probes

The final qualifier uses the accepted canonical nine-county keys, including Mercer/NJ and excluding New Castle/DE. It requires a county/state address pair with the institution and locality in the same statement, exact declared institution/search binding, token-aware literal matching, and a content-derived scope ID. Mixed XML content is explicitly unsupported rather than reordered. Unknown date text is redacted before projection.

Metadata source IDs now derive from the genuine retained search receipt, request/body digests, qualified scope, query/window/offset and ordered PMID list. Every source/plan/parse resolution checks this binding; changing a callback cannot rebind the same source to another search. Short nonterminal search results fail instead of skipping unseen IDs. Valid capped pages remain fetchable with an inherited `search-cap` gap and `inventoryComplete: false`. Metadata-batch completion remains separate from whole inventory completion. Provider-native identity remains PMID; authors remain unresolved and no current employment or public admission is asserted.

Astra independently ran 40 checks on the final bytes under Node 22.23.2 with an empty inherited environment, unchanged HOME and workspace TMP/XDG/npm caches:

- Six geography checks reject Maryland Montgomery, Maryland plus unrelated Pennsylvania text, Delaware New Castle and an institution substring collision; accept New Jersey Mercer and Pennsylvania Philadelphia. `geography-final-probe.ts` and `geography-final-warning.log` retain the final run.
- Seventeen adapter checks use Terra's synthetic D1-produced fixture snapshot as input but independent in-memory resolvers and assertions. They cover valid/reconstructed parsing; another parent receipt with identical IDs; changed offset/window; corrupt, removed or unavailable parent; mixed-content rejection; unknown-date contact redaction; stable source version; inherited cap gap; exact source resolver identity; mutation after inspect starts; foreign nested namespace, unbound prefix and hostile DTD rejection; and acceptance of the narrowly permitted NLM DTD after removal. `adapter-probe.ts` and `adapter-probe-final-warning.log` retain the final run.

The first adapter probe failed its valid control because the snapshot predated the new content-derived scope IDs. `adapter-probe-1.log` remains retained; after Terra regenerated the fixture, the control and all adversarial cases passed. This is a documented stale-fixture failure, not a suppressed product failure. Terra owns the separate actual-D1 budget, restart, retention, quarantine and health acceptance suite; root owns integrated tests and final hashes.

These checks establish bounded synthetic implementation behavior only. Real source enrollment/access/rights, source-class qualification and empirical evaluation remain absent. Restrictive mixed-content/XML/size handling may reject valid provider material and requires real provider qualification before activation. No real provider calls or deployment occurred.

## Final ESearch diagnostic correction

Root identified that NCBI warnings can invalidate the institution query. Astra independently reproduced the old complete-empty result with `quotedphrasesnotfound`: terminal true, providerLimited false, no leads and no gaps. Sol patched the live file before the first reproduction command executed; that rejected run remains in `warning-before.log`. For an actual before-case, Astra reconstructed the prior source and verified its exact recorded SHA-256 `31b0565ba76e5b7e92b59b44adb61b3fe7685b79a50c7ac59f1863178c44ad4f` before changing only scratch import paths. The false-empty result is retained in `warning-old-reproduced.log` with both original and runnable scratch copies.

The first correction rejected nested WarningList diagnostics but still accepted an otherwise valid empty result with a top-level error. Astra's failing assertion remains in `warning-final-1.log`; root and Sol corrected both result and root diagnostics. The final parser checks recognized error/errorlist/warning/WarningList keys case-insensitively. Error and warning presence fails closed; WarningList permits only an empty object or documented keys with empty arrays. Unknown fields inside WarningList, null/scalar/array shapes and nonempty messages fail. No general ban on unrelated response fields was introduced.

Seventeen independent diagnostic cases now pass, including root/nested and case variants, malformed shapes, nonempty messages, and clean/documented-empty controls. `warning-probe.ts` and `warning-final-2.log` retain this evidence. All prior 17 adapter and six geography cases were rerun on the final `c21d7c9b` source and pass (40 total). The prior 31b0565b recommendation is superseded. Recommend local acceptance only after root's fresh integration run on the final frozen inputs; no acceptance was issued by this reviewer.

## Prior foundation packaging review

The initial tracked diff contains six expected foundation files: `.gitignore`, root README, package test scripts, isolated ops smoke configuration use, schema stamp 0044, and the social test clock repair. The latter has a retained targeted diagnosis and exact freshness-boundary tests, and does not relax production gates. No obvious unrelated production change appeared in this bounded diff review. This is not a fresh full audit of every WP00–WP08 line.

The frozen `docs/discovery-engineering` handoff is currently untracked and is a necessary prerequisite of linked implementation receipts. Package it deliberately with the reviewed foundation; do not omit it or include arbitrary ignored scratch state. Explicit discovery test enumeration must include new packages before claiming CI coverage.

CI runs on both push and pull request, with locked install, PDF bootstrap, `npm test`, mandatory PDF tests, build, local D1 smoke, npm audit and secret scan. `.github/workflows/ci.yml` SHA-256 is `16a27f5ea9941522f8a1ed1f8983c367bb477893a3b37429ec48b120ecd271cd`. The accepted baseline records four high dependency advisories under an unchanged lockfile; consequently a prerequisite PR cannot be described as CI-ready without rerunning and resolving or explicitly carrying that failure. Root was notified. No deployment or provider activation is implied by local package or commit readiness.


The refreshed read-only npm audit still reports four high advisories and seven total. Registry metadata shows no Zod 3 fix (latest 3.25.76); npm recommends 4.6.7, a major change. Seroval 1.6.11 and Undici 7.30.1 patch candidates exist, but fixing those alone cannot clear the audit gate. Queried fast-xml-parser 5.11.3, Vite 8.2.3 and Wrangler 4.152.1 do not exist; current registry releases are 5.12.1, 8.3.8 and 4.162.0 respectively. No package/lockfile edit was made. Recommend separate dependency qualification and an honest draft PR audit blocker, not an unreviewed broad upgrade or suppressed audit. Evidence: `.discovery-work/wp09-astra/audit-current.json`, `patch-candidates.json`, `latest-candidates.json`, `zod3-versions.json` and retained npm error logs.
