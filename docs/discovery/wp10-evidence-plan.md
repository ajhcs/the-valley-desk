# WP10 Crossref verification

The target is independent private Crossref discovery over the accepted registry,
transport and collection store. A qualified query produces candidate papers without
a repository or PubMed prerequisite. Local fixtures test the implementation;
actual provider permission, pacing, source qualification and E04 remain pending.

| Criterion | Discriminating evidence |
| --- | --- |
| AC-WP10-01 | Actual isolated D1 migrations 0001–0044, separately qualified work/institution scope, injected synthetic Crossref response, durable raw body and private page/lead receipt. No GitHub/PubMed request or catalog admission. |
| AC-WP10-02 | Explicit ASCII DOI truth table: accepted case/prefix/URL variants share a canonical native identity; trailing slash remains distinct; ambiguous encoding, Unicode and URL authority/query/fragment changes are rejected. |
| AC-WP10-03 | Same contributor name on separate works, including absent affiliations, stays unresolved with personId=null and currentEmploymentConfirmed=false. Query text cannot establish regional attribution. |
| AC-WP10-04 | Year/month/day fixtures retain precision; deposited/indexed dates remain metadata dates. Source stages and correction metadata affect versions, while response position does not. |
| AC-WP10-05 | Actual evidence ledger requires explicit reviewed origin equivalence for syndicated PubMed/Crossref metadata; the same DOI alone cannot manufacture independent provenance. Provisional response evidence cannot count before origin review. |
| AC-WP10-06 | Malformed/missing/repeated cursor, mixed invalid items, absent correction endpoint, caps, oversized/invalid response, expired cursor and damaged/removed parent remain failures or explicit incomplete gaps. No healthy inventory follows. |

Sol owns the adapter and synthetic source fixtures. Terra independently owns the
actual-D1 test suite, including durable replay and page-chain failure checks.
Astra reviews code and probes identity, stage/version stability, unsafe license
URLs, cursor binding and the shared read-only lookup. Root owns shared contract
changes, command wiring, regression qualification and acceptance.

EX14 records the missing DOI decision and the small collection-store composition
change. The new lookup uses existing rows and the same integrity/removal checks;
there is no migration. Continuation checks use the actual current issued plan and
retained predecessor receipts. Historical replay uses retained bodies and claims,
without reviving settled leases or issuing new requests. The original claim expiry
provides a conservative cursor deadline earlier than commit-time plus five minutes.

Checks run with the pinned workspace Node 22 runtime, no environment files or
remote bindings, synthetic controls and closed injected egress. Root uses bounded
test segments to avoid the prior long-command SIGTERM; command exits and counts
are retained separately. Capture and check exact implementation/fixture hashes,
preserve failed attempts, verify frozen handoff/model inputs, then record local
acceptance. The change does not authorize provider enrollment, source publication,
human trust enrollment, merge or deployment.
