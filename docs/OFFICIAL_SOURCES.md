# Official source discovery

The registry in `fixtures/official-source-registry-v1.json` is the verified source inventory for health-system news, regional policy, finance/filings, product/vendor updates, procurement signals, and events. It contains only URLs confirmed as first-party, regulatory, or association sources. The registry currently covers the 16 approved systems plus Pennsylvania, New Jersey, Delaware, CMS, ONC, OCR, HAP, NJHA, and DHA sources.

## Runtime contract

`src/ingest/official-source-discovery.ts` provides a provider-neutral adapter contract:

- `officialSourceRegistry` is parsed with Zod at startup. URLs must be credential-free HTTPS, IDs are unique, and LinkedIn is rejected as a discovery source.
- `discoverOfficialSources()` schedules enabled sources by their declared cadence: hourly for news, policy, finance, filings, and product/vendor updates; daily for procurement and events. A source-level cap, byte cap, timeout, redirect cap, and concurrency cap are always applied.
- HTML discovery strips executable/document-embedded content before reading anchors. It accepts same-host links plus explicitly listed event link hosts only. RSS discovery is limited to `<item>` title/link pairs.
- Every snapshot records content hash, byte count, final URL, candidate count, explicit completeness, trust posture, and a bounded error. `partial`, `unknown`, empty, hostile, and failed snapshots never authorize deletion or disappearance reconciliation.
- Every discovered link is a `status: "review"` candidate. The adapter does not construct a published `ContentItem` and has no direct publication path.
- `officialSourceRelevanceInput()` and `applyOfficialSourceRelevanceGate()` are the Muse integration hook. The hook names `meta/muse-spark-1.2-contributor`, carries a versioned prompt, treats source fields as untrusted quoted data, and can only attach a relevance result; it cannot change the candidate's review-only status.

## Product and procurement lanes

The `product` category is reserved for official vendor/product channels that are
explicitly tied to a verified row in `fixtures/product-watch.json`. The current
registry watches Epic's newsroom and Microsoft's Healthcare and Life Sciences
and Cloud healthcare channels for the mapped Epic/MyChart and Dragon/DAX
relationships. A vendor hostname alone is never evidence that a Delaware Valley
health system uses a product.

The `procurement` category is institution-scoped and currently includes only
exact, verified first-party pages for Penn Procurement Services, CHOP supplier
information, and Cooper's Supplier Gateway. These are discovery inputs, not
contract or award feeds. A discovered procurement link stays in `review` until
its listing names a mapped product for that covered institution and Muse accepts
the candidate as regionally material.

`canProceedOfficialCandidate()` is the explicit handoff gate for specialized
sources. It requires a non-hostile review candidate, an accepted Muse result of
at least 90 relevance and 0.90 confidence, and a verified product relationship.
Product/vendor sources carry trusted `productIds` from the registry; procurement
sources additionally require an institution-specific product alias in the
listing. The normal evidence editor and second-pass high-risk verifier still
run afterward, and no specialized candidate can publish directly.

## Adding a source safely

Add a row only after verifying the exact URL and its ownership. Do not substitute
a search-engine result, vendor page, or guessed feed. Product rows must refer to
existing `product-watch.json` IDs. Procurement rows must name a covered
institution and should only be enabled when the page is an official source for
that institution. Keep `completeness: "partial"` unless the publisher provides a
complete, authoritative listing; partial pages never authorize disappearance.

Hourly and daily automation both run this adapter. Due sources keep their declared hourly/daily cadence, exponential backoff, and source-cap fairness. `0019_official_source_discovery.sql` stores schedule state, snapshots, and candidate provenance in D1 without raw HTML. The production relevance gate calls exact `meta/muse-spark-1.2-contributor` through the existing bounded OpenRouter editor client (`completeEditorJson`); it does not add a second HTTP client.

Only `canProceedOfficialCandidate()` rows become review-only `ContentItem`s: news/finance/filing/procurement map to `news`, policy to `policy`, AI product channels to `ai`, and dated events to `event` with `autoPublish: false`. Institution, product-watch, and seed org mapping set `orgs`; category-specific topics stay attached. Converted items enter the ordinary raw-persist → Muse evidence editor → two-pass verifier pipeline with executive and signal lanes. Instruction-like, rejected, low-confidence, undated-event, and generic procurement rows remain provenance-only. No discovery can publish directly.
