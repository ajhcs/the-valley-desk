# WP12 owner handoff — Sol

This is a reviewed-software candidate, **not full WP12 acceptance**. No actual
forum installation, installed version, public-category boundary, access,
metadata/excerpt retention rights or maintenance policy has qualified. WP12 must
remain in progress while those entry conditions and AC06's current-claim consumer
integration are unmet. No actual forum content was fetched or enrolled. No
installation, shared runtime/schema, migrations, commits or deployments were
changed by this owner.

The selected family is the deliberately narrow `discourse-public-json-v1`
profile. It does not claim general/native compatibility with arbitrary Discourse
versions, plugins or installations. Whole responses must match strict supported
JSON schemas; unknown fields fail rather than silently expand retention scope.
A reviewed installed version and exact real public response shapes remain
qualification inputs. The scope's installed-version label is a frozen requested
contract, not independently verified installation evidence.

`qualifyDiscoveryForumScope` freezes installation identity/origin/version,
category ID/slug, local creation-date window, page/topic/post/excerpt caps,
candidate denominator and policy reference into a content-derived scope ID.
The source must be anonymous, with no credential reference, and its exact origin,
installation and scope must match. The requested retentionPolicy must equal the
actual enrolled source accessDecision policy control. Live actual issued plans
and retained representation ancestry provide the existing policy-integrity
checks. This is not a new retention grant: scoped rights and fetch/transform
permissions remain separate and must qualify through WP06.

Two phases use separately enrolled, separately budgeted sources and explicit
WP07 rounds. Category listing is exact
`/c/{categorySlug}/{categoryId}/l/latest.json?page=N`; only page is dynamic.
Each topic source uses exact `/t/{topicId}.json`, with no dynamic query or post
batch/profile endpoints. Its stable source ID hashes the genuine retained
listing receipt, request/body hashes, installation, scope and selected topic ID.
The parent lookup cannot silently substitute another listing after restart.
A topic must actually appear within the permitted retained listing batch and
local window before a topic source is accepted. There is no automatic missing
post retrieval, profile crawl or source following from links/instructions.

Category latest listings do not expose a true date-window query or full total.
The window is a local candidate filter, and outside-window entries remain
explicit rejected/gap counts. Exact next URLs must match the same enrolled
category endpoint and following numeric page; off-scope URLs fail. A full page
without a next marker remains partial. Page/topic/item caps count received data,
not just projected valid candidates. Topic post-stream IDs missing from the
received public subset and unresolved reply targets remain explicit gaps.
Completion describes only the bounded response/traversal, never complete forum,
window, clinical evidence or regional recall. No alternate endpoint is fetched
to work around missing data.

Live parse/inspect checks the real current issued plan, source/request digest,
configuration/enrollment/permission/parser and continuation query/token/expiry.
Prior pages use only retained receipts, body hashes and historical claims plus
the accepted read-only chain-page lookup. Historical plans are not reopened.
Claim source/chain/ordinal/issued-plan/round/slot bindings and future committed
receipt checks remain enforced. `replay(receiptId)` recomputes private metadata
from usable retained bytes after leases settle and checks the result against the
committed receipt. Read-only planning/replay helpers confer no send authority.

The **entire raw response** is checked before any per-item projection or WP07
retention. A local bounded equivalent of the strict intake JSON parser rejects
decoded duplicate keys, invalid Unicode, unsafe/lossy integers, decimal/exponent
numbers, negative zero, excess depth/nodes/keys and invalid UTF-8. Source bodies
are bounded to 48,000 bytes. This prevents a private earlier duplicate value from
being discarded by ordinary JSON.parse before privacy checks. Restricted/unknown
fields, private archetypes, non-public categories, hidden/deleted records and
unsupported shapes fail closed, even if another candidate would be valid.

Public cooked HTML is a bounded passive subset, not a universal sanitizer. It
rejects comments/declarations, parser errors/duplicate attributes, foreign or
unsupported tags/nodes/attributes, hidden/forms/events and decoded contact
content. Both combined decoded text joins and individual text/attribute values
are checked for email and the specified phone/tel forms. URL attributes reject
credentials, queries, fragments, unsupported schemes and percent-decoded contact
content before capture. Nonempty unqualified HTTP Link metadata also fails.
The parser does not strip forbidden source data and pretend the original raw
response was safe: it rejects the whole body. These checks do not establish a
general medical-data de-identification guarantee; actual source rights and
qualified shapes remain required.

Native topic/post/account IDs occupy separate kinds under the installation.
`discoveryForumNativeKey` returns the installation/kind/numeric-ID tuple; equal
numbers across installations or kinds do not collide. Private leads retain their
source installation in provenance. Forum accounts stay accounts, with username
aliases, unresolved display-name candidates and no person merge/current-local
claim. Topic-to-post, post-to-author-account and supported reply relations carry
exact payload pointers and admitted=false. Missing reply endpoints are not
invented. Posts can stand alone within a discussion with no paper or code.

Source revision hashes include supported topic/post/account semantics, reported
post version, timestamps and public excerpt. Edits produce another private
version while earlier bytes remain governed by the actual rights policy; no
admitted catalog fact is overwritten. Post numeric versions remain in retained
raw fields and hash input. Dates describe reported forum activity, not scientific
verification. Text and medical anecdotes remain untrusted; instruction-like
content is flagged and cannot change transport credentials, scope or publication
authority. All leads and relations remain unauthorized for publication.

Deleted/private bodies fail before retention, so the adapter does not preserve
restricted historical content as an automatic audit exception. Read-only
`removalProposal` resolves a genuine prior retained page and returns its actual
rights/material-scope/policy references. requestedReason is explicitly unverified;
sourceChangeVerified=false and revokeAuthorized=false. It is not an authenticated
new deletion observation or an automatic invalidation. An appropriately authorized
caller must separately invoke the existing evidence-store revokeRetention path;
its scoped content purge/invalidation and minimal audit semantics are unchanged.
Broader affected-source enumeration and admitted current-claim consumer handling
are not implemented here. AC06 therefore remains an explicit package gate for
WP14/authorized policy consumers, not a fictional end-to-end claim.

Owner checks use `.discovery-work/wp12/run.sh`, qualified Node 22.23.2 and
workspace-local caches. The explicit app-project typecheck passed after the
final privacy/policy changes (`.discovery-work/wp12-sol/types-final.log`).
Terra owns actual-D1 tests and Astra owns privacy/binding challenges. Owner
checks do not accept this software or qualify real installation access.

Primary Discourse references consulted on 2026-11-15 (documentation/source only):

- [Discourse API reference](https://docs.discourse.org/): official entry point; dynamic reference page did not provide readable content through this tool.
- [Official API client category methods](https://github.com/discourse/discourse_api/blob/main/lib/discourse_api/api/categories.rb): category latest JSON pagination family.
- [Official API client topic methods](https://github.com/discourse/discourse_api/blob/main/lib/discourse_api/api/topics.rb): topic JSON versus separate post/profile/mutation routes.

Root/Astra independently verified the canonical category-ID route against
upstream controller tests. No actual category/topic API URL or forum content was
requested. The synthetic strict profile, rights boundaries and unimplemented
consumer must be qualified before any future real activation.
