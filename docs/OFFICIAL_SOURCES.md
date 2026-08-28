# Official source discovery

The registry in `fixtures/official-source-registry-v1.json` is the verified source inventory for health-system news, regional policy, finance/filings, and events. It contains only URLs confirmed as first-party, regulatory, or association sources. The registry currently covers the 16 approved systems plus Pennsylvania, New Jersey, Delaware, CMS, ONC, OCR, HAP, NJHA, and DHA sources.

## Runtime contract

`src/ingest/official-source-discovery.ts` provides a provider-neutral adapter contract:

- `officialSourceRegistry` is parsed with Zod at startup. URLs must be credential-free HTTPS, IDs are unique, and LinkedIn is rejected as a discovery source.
- `discoverOfficialSources()` schedules enabled sources by their declared cadence: hourly for news, policy, finance, and filings; daily for events. A source-level cap, byte cap, timeout, redirect cap, and concurrency cap are always applied.
- HTML discovery strips executable/document-embedded content before reading anchors. It accepts same-host links plus explicitly listed event link hosts only. RSS discovery is limited to `<item>` title/link pairs.
- Every snapshot records content hash, byte count, final URL, candidate count, explicit completeness, trust posture, and a bounded error. `partial`, `unknown`, empty, hostile, and failed snapshots never authorize deletion or disappearance reconciliation.
- Every discovered link is a `status: "review"` candidate. The adapter does not construct a published `ContentItem` and has no direct publication path.
- `officialSourceRelevanceInput()` and `applyOfficialSourceRelevanceGate()` are the Muse integration hook. The hook names `meta/muse-spark-1.2-contributor`, carries a versioned prompt, treats source fields as untrusted quoted data, and can only attach a relevance result; it cannot change the candidate's review-only status.

## Intentionally unconfigured

Procurement sources are represented by the schema but not populated yet. The source research did not produce exact official procurement URLs that were safe to register without guessing. Add a row only after verifying the URL and its ownership; do not substitute a search-engine result, vendor page, or guessed feed.

The current registry is deliberately a discovery layer. A later automation integration should persist snapshots and candidates using the same source IDs, run the relevance hook, then pass accepted candidates into the existing evidence editor and two-pass verifier. No raw HTML, raw anchor labels, or model recommendation should bypass those gates.
