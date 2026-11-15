# WP12 forum — Astra independent review

Disposition: recommend accepting the reviewed software increment after root's final integration checks. No remaining implementation blocker found at the hash below. Full WP12 acceptance remains ungranted: an actual installation/version/response profile and rights must qualify, and the automatic edit/deletion-to-current-claim consumer is not implemented. Root owns acceptance.

## Initial contract challenge

WP07 invokes the trusted parser before preparing a commit but persists the original acquisition bytes when committing a successful draft. Rejecting individual records or redacting a display field therefore does not exclude private content from retained storage. The forum adapter must reject the entire response before commit when private categories, messages, hidden contacts, or unsupported privacy-bearing structure occur, including inside otherwise rejected records. A specifically versioned, strictly bounded safe export can be supported without claiming support for arbitrary public forum responses. A public page is not bulk-access permission.

Installation, account, topic, post and revision identities must remain distinct. Equal numeric IDs on separate installations are unrelated. An account's name, biography or linked profile can propose identity evidence but does not merge it with a natural person or establish current regional employment. Replies, edits and deletion markers require stable source identity and explicit source evidence. Instruction-like posts never change fetch scope or admission authority.

Declared page navigation must bind to the enrolled installation, scope and committed parent; an observed link alone is not fetch authorization. Partial pages and unavailable discussions must not become healthy-empty coverage. Rights revocation or deletion must make affected current claims unusable while retaining only the approved minimal audit, never unrestricted copies of removed content.

The [official Discourse API documentation](https://docs.discourse.org/) identifies category-topic routes by slug and numeric category ID and shows richer native response objects than this adapter's strict subset. The chosen installation/version and restricted response profile therefore need explicit compatibility boundaries. Reading documentation did not acquire forum records or establish public/bulk access permission.

## Findings closed and independent evidence

The final category path contains both reviewed slug and category ID. The entire JSON response is strictly parsed before projection: duplicate decoded keys, lossy numbers, unsupported/private fields and malformed Unicode fail. Cooked HTML uses a restricted passive subset; comments, private attributes and hidden/active markup fail before retention, and raw/decoded/concatenated text and attributes receive contact checks. Credential/query/fragment-bearing links and nonempty HTTP response Link metadata are rejected. These bounded checks do not certify arbitrary prose as non-sensitive or replace real retention qualification.

Forty independent probes passed: 34 over Terra's authentic synthetic D1 category/topic/edit snapshot plus six over its final three-page category snapshot. They cover five captured positive responses, installation-namespaced stable keys, account/person separation, retained replay without live plans, missing/corrupt parents and representations, callback swapping to another installation's listing, changed scope/policy and future commits, comments/hidden/private fields, encoded and split contacts, phone/credential links, private-message forms, duplicate JSON keys, inert instruction-like content, incomplete post streams, response Link rejection, explicitly unauthorized removal proposals, and `.`/`..` username rejection to prevent normalized public-link identity confusion. The final six checks confirm third-page continuation/replay, rejected continuation query hash, and rejection of both live parsing and replay after earliest-ancestor removal, plus corrupted earliest bytes.

Topic fetch authority remains tied to the deterministic source ID derived from the retained listing receipt and exact context; callback substitution cannot rebind it. Each topic fetch still requires independently enrolled source authority and request/byte budget. Forum revisions remain private candidates and unresolved account relations. `removalProposal` explicitly reports unverified source change and no revocation authority; it is not an automatic native-event invalidation consumer. Rights removal and future admission/publication behavior remain separate gates.

Reviewed SHA-256:

- `src/ingest/discovery/forum.ts`: `b679f2f24b8eebc163d0aac06af121d533e5c9415cd89d77eec277dab0cac5cc`
- `.discovery-work/wp12-astra/forum-probe.ts`: `4944d6b40d315c794fc89b4ac5f345c760a3bdf5d59de6b43b5c4aaaabaa2dcd`

Final outputs: `.discovery-work/wp12-astra/forum-final.log` and `three-page-probe.log`; inputs: `.discovery-work/wp12-terra/fixture-snapshot-4189126.json` and `pages-snapshot-4193322.json`. The shared supplemental probe `three-page-probe.ts` has SHA-256 `2774f16380139844a09a12fb47dd7842c29388cd100c72ec4a992b875683a144`. These adapter probes use snapshot resolvers and do not replace Terra's actual runtime/store tests. All source material was fictional; no real collection, enrollment, installation, commit or deployment occurred.
