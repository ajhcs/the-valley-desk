# GL08 GitHub metadata batch

The 17 November 2026 instruction to proceed starts sequence step 1. The trusted
`builderbob` operator freezes this bounded batch within the existing authority
for ordinary discovery described in `operations.md`. This is not source
enrollment, recurring collection or public admission. Independent acceptance
remains separate; no Sol review is claimed by this implementation.

The accompanying `GL08-github-enrichment-scope.json` fixes 41 account handles
from the earlier source-linked PA/NJ and professional seed collections, already
federated into the fifteen-collection private queue. Every handle retains its
original source pointer, input hash, evidence link, temporal qualification and
primary-collection observation IDs. This is an initial cohort, not the complete
primary-region account roster, a verified local-account inventory or the yield
sample. Other primary accounts remain queued. Lehigh, Scranton and Christiana
observations are excluded from this batch and remain in their original snapshot.

The route is anonymous `GET /users/{login}/repos`, `type=owner`, sorted by full
name, 20 rows per page, with the pinned `2022-11-28` API version. Both User and
Organization owners must be established by the returned native owner fields;
the route's actual support for this roster is an observation to be recorded,
not assumed from the account's name. A first empty page has no established
native owner and stays `empty-unverified`. There is no automatic alternative
endpoint on failure.

The total cap is 55 requests, 20 pages per account, 256,000 response bytes per
request, 25 seconds per attempt and 30 minutes elapsed for the batch. Requests
are serial with at least one second between attempts. Round-robin pages give
each account a first page before any account receives a second. There are no
retries, redirects, credentials, charges, profile/body retrievals or account
expansions. Provider refusal, rate limiting or redirect holds the whole batch;
malformed/unavailable/uncertain responses hold the account. An issued attempt
survives a crash and cannot be silently resent. The byte envelope belongs to
this private route; the public 128,000-byte API bound is unchanged.

The operator approval separately pins the exact scope bytes, sender, parser,
privacy preflight and Node binary. It is saved in a new owner-only directory
under `/workspace/build/builderbob`, with a durable SQLite attempt journal and
immutable projected page receipts. Native responses exist only in memory and
pass the existing whole-body contact/credential preflight before projection.
Only the listed metadata fields survive. A native-body hash binds transient
bytes but cannot replay a discarded body or establish source truth.

Continuation links must preserve the origin and frozen query. A numeric owner
path is accepted only when it matches the native owner ID and type observed
in this chain. The sender reconstructs the next named-account URL rather than
requesting the header URL. A full page without a next link remains incomplete.
All observed native repository IDs become distinct private review units;
aliases and repeated observations stay attached without URL-based identity
merges. Dates and fork/archive state remain source reports. No account-wide
health or regional label is propagated to repositories.

G01's `link`, G02's `field-census` and C01's `publication-identity` failures are
unchanged. Their source bodies and exact causes were discarded and cannot be
reproduced. The new tests challenge analogous pagination/schema risks; they
are not retrospective reconstructions or repaired historical receipts.

Official references checked on 17 November 2026:

- [Repository enumeration and fields](https://docs.github.com/en/rest/repos/repos)
- [Serial requests and rate-limit handling](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)

The new route uses a bounded direct sender because the connected repository
tools do not expose the raw response/header and transient-inspection contract
needed here. Existing provider routes and public catalog artifacts are unchanged.

## Observed qualification and handoff

The original 55-request batch retained 509 native repositories from 43 accepted
pages. Eleven pages failed inspection and one returned 404; none was retried
inside that scope. Among the inspection failures, nine had unsupported Link
paths and two failed the whole-body contact preflight. The 28 validated terminal
account chains are observed endpoint traversals, not atomic inventories or a
claim of health-tech/regional eligibility.

The separate `GL08-github-continuation-scope.json` fixes two requests to
`brody-lab`, raising the aggregate cap to 57. It preserves the original scope
and failures. The corrected parser accepts `/user/{nativeId}/repos` for an
Organization owner only when the native ID matches every observed owner and
the query remains fixed. Two real pages passed with that path kind, retaining
40 additional repositories; page three remains uncollected. The other eight
original Link failures remain held for a future bounded batch. Later empty
responses remain identity-unverified even if earlier pages supplied an owner.

The combined private queue contains 549 native repositories, including 344
non-null descriptions. All have native fork/archive state and dates. The
checkpoint retains all 57 page outcomes, old method sources with byte hashes
matching the pre-request pins, artifact locations and digests, and unchanged
public/source snapshot hashes. No large source evidence is added to the product
change. Original source bodies remain unavailable for replay.

The 100-record yield sample selects the first 100 SHA-256 values of a fixed
seed plus native repository ID from this 549-record cohort. It does not filter
for descriptive completeness, known projects or account kind. The sample is
not representative of all primary-region sources; eligible fraction and active
minutes per admission remain unmeasured. Review each work against purpose,
health relevance, a dated work-level regional basis and original link. An
account's institutional context alone cannot fill the regional criterion.

Offline commands, using the qualified Node 22 runtime:

```sh
node --import tsx/esm scripts/discovery-github-enrichment.mjs queue PRIVATE_BATCH/pages QUALIFICATION_BATCH/pages
node --import tsx/esm scripts/discovery-github-enrichment.mjs sample PRIVATE_COMBINED_QUEUE.json
npm run test:discovery:github-enrichment
```

The archived batch approvals pin their original method bytes. New code or
scope requires a new reviewed freeze; rerunning either existing capture is
not a way to send more requests. Independent acceptance is still pending.
