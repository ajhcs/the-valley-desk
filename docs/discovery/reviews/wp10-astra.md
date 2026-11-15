# WP10 Crossref — Astra independent review

Disposition: recommend local implementation acceptance after root's final actual-D1 and integration qualification. Initial findings were corrected and independently challenged; root owns acceptance.

Final reviewed Crossref source SHA-256: `4e34e224ea21b1ae718851d6ca774134e4426b114378b97aa3f2fb286a4a0b2f`.

Astra read WP10's six acceptance criteria, the accepted provider-native identity/date contracts, the actual provenance-origin counter and the WP06/WP07 receipt/continuation seams. The earlier catalog does not implement DOI canonicalization: WP10's explicit restricted DOI rule is new and needs its own recorded decision/truth table. A DOI match alone cannot establish reviewed cross-provider equivalence or independent corroboration.

## Initial blocking findings

The initial projection hashes relation proposals including their `/message/items/N` pointers. Moving unchanged metadata to another page position therefore changes its sourceVersion. Conversely `subtype` changes preprint/publication stage without changing the hashed semantic revision. Keep location-specific evidence pointers outside semantic hashing and include the actual stage/subtype.

License links were accepted through the generic HTTPS schema, which does not exclude loopback/private hosts or credential-bearing query parameters. The initial projection returned `https://127.0.0.1/private?token=synthetic-sensitive` as a license hint. Use a stricter provider-local public-link policy without rewriting accepted shared schemas.

All three behaviors were reproduced from a scratch copy of the initial source with only imports relocated and the private projection exported. Candidate hash, runnable source and result are retained in `.discovery-work/wp10-astra/crossref-initial.sha256`, `crossref-initial-projection.ts` and `projection-before.log`.

A resolver-boundary concern was also sent: unchecked continuation timestamps can become NaN and evade numeric expiry comparisons. Actual registry values are schema-valid; this is not a demonstrated upload bypass. Validate continuation/time fields at the adapter boundary and fail closed on invalid clocks or future parent timestamps.

## Initial independent checks

Thirteen DOI normalization checks passed under qualified Node 22.23.2, empty inherited environment and workspace cache/temp paths. Raw/case/doi-prefix/HTTPS-wrapper variants preserve original strings and one canonical identity; credential-host confusion, encoded delimiters, query/fragment suffixes, traversal, Unicode, foreign resolver hosts, backslashes and control characters reject. Evidence: `doi-probe.ts`, `doi-probe-1.log` under the Astra scratch directory. This verifies only the explicitly supported DOI subset, not all DOI syntax.


## Final corrections and qualification

Semantic metadata versions now exclude item-position JSON pointers while retaining exact pointers in relation proposals. Publication subtype and actual preprint/publication stage are included in the digest. The public license-link policy rejects noncanonical URLs, query strings, credentials, the tested loopback/local host spellings and ports using the established public-URL guard plus Crossref-local restrictions. The initial projection failures remain retained.

Live cursors require a genuine retained parent, source/query/configuration binding and historical claim linkage. Their usability is conservatively capped by the parent's original claim expiry as well as the continuation expiry and five-minute maximum. Invalid timestamps, clocks, future commits, missing parents and corrupt retained bytes fail closed. This can require a fresh cohort earlier than a provider's nominal cursor lifetime; it does not claim uninterrupted coverage.

A final independent probe found `continuation.querySha256` could be replaced with zeros while the adapter still accepted the plan. Other bindings already constrained the actual source/query, so this was an exact-field verification omission, not an independent external authority bypass. Root explicitly assigned Astra the one-line fix comparing it to the source material scope request digest, matching the registry contract. `query-binding-before.log` preserves the failing assertion. The regression is included in the final adapter probe.

Private durable replay reconstructs metadata from retained receipt/body/request/claim ancestry after settlement without requiring an old live plan. Replay remains read-only and does not issue another request, claim, origin equivalence or publication decision. Missing/removed/corrupt dependencies prevent replay. Same-name authors remain unresolved; indexed/deposited dates remain metadata dates rather than publication dates. DOI equality alone grants no origin authority: the adapter's optional origin-count capability delegates to the existing reviewed evidence ledger and fails when absent. Terra independently exercises explicit Crossref/PubMed reviewed provenance in actual D1.

Astra's final independent validation uses sanitized Node 22.23.2 and workspace-only temporary/cache paths:

- Thirteen DOI cases pass again on final bytes (`doi-probe-final.log`).
- Twenty-three adapter cases pass (`adapter-probe-final.log`): initial and continued parse; durable replay with all live plan resolution disabled; invalid expiry, parent ID, corrupt bytes, future commit, exact expiry, bad clock, changed scope and parent claim; removed/unretained replay; source-version invariance under item movement; stage changes producing new versions; four unsafe license forms; heterogeneous valid/malformed items; unresolved retraction target; mutation after parsing starts; and the exact query digest regression.
- Application TypeScript check exits zero (`app-types-final.log`).

The adapter fixture is a detached copy of Terra's two-page actual-D1 synthetic snapshot, retained at `.discovery-work/wp10-astra/fixture-snapshot-used.json` (SHA-256 `7885c21a19ea47c75fd1048554c81f2011b43e1acb2980a6a43472d7ccc19db2`). Independent assertions and memory resolvers live in `adapter-probe.ts`; this is not described as another independent D1 execution. Terra/root separately own the later three-page, removal, budget and full integration runs. There are 36 independent Astra WP10 cases; those counts are not added to the integrated suite.

The new shared `resolveChainPage` seam was independently read: it validates identifiers/ordinal, performs a parameterized lookup, delegates integrity/removal checks to `resolvePage`, and rechecks returned chain/ordinal. Reviewed shared source hashes are `3032623e521689913af54cf5fb78d151ab974ca3f75dd51065433f5fed8c66ce` for collection-contract.ts and `9b64742715a50203d694f1f98c55ce5a41927caddf12595020e34571e4e46f96` for collection-store.ts. Root must qualify the composition and retain prior receipts separately.

No remaining blocker was found in these reviewed bytes. These are bounded synthetic/local results, not provider access/rights qualification, real regional recall, source truth, public admission or release readiness. The restricted DOI/URL/response subset may reject valid provider metadata and requires real qualification before activation. The existing four-high/seven-total dependency audit blocker remains unchanged; no dependency upgrade, installation, remote acquisition or deployment was performed by this reviewer.
