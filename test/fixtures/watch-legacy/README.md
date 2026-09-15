# Frozen V1 Compatibility Fixtures

Baseline: `23972f4c04bd2cd891d11488c1580a14b9e14875` (staged policy release,
including the existing `floor-action` policy stage). This is a local contract
baseline, not a claim about the currently deployed schema.

`v1-schema.ts` is an independent test-only snapshot of the complete v1 content
and feed schema. It deliberately imports no production schema helpers. Do not
regenerate it after adding Watch contracts or copy v2 fields into it to make a
failure disappear. Keep Watch v2 separate. A future intentional v1 change needs
an explicit compatibility decision and review of every affected consumer.

`items.ts` contains only synthetic material created for offline testing. Names,
policies, events, organizations, and resource references describe no real item.
Reserved `.invalid` URLs are never fetched. There are no private prompts, source
captures, credentials, or provider calls in these fixtures.

The tests compare schema structure (including all nested enums, object fields,
optional/default rules, string/array constraints, and refinement boundaries),
then exercise behavioral mutations and existing public query/merge functions.
The structure walker is intentionally specific to the repository's Zod 3 types
and fails on an unrecognized type; a Zod major upgrade requires an explicit test
adapter review, not automatic snapshot replacement.

The freeze preserves actual v1 behavior, including its limitations. For example,
policy sessions are optional and `effectiveDate` remains an unconstrained string
in v1; stricter Watch identities and precision-aware dates belong in v2. Schema
validation is not publication authorization. The feed parser permits structurally
valid review records, whereas `toFeed` performs the published/delivery filtering.
The serializer accepts typed `ContentItem[]` and does not independently parse
unknown input; untrusted data must still cross its existing schema boundary.

These tests do not prove live HTTP redirects, D1 availability, concurrent database
withdrawals, model quality, tri-state source coverage, or Watch release readiness.
They protect the existing pure route/query, serialization, and merge boundaries;
the integrated Worker and browser release matrix remains separate.

Run from the task worktree with its own locked dependencies:

```bash
node --import tsx/esm --test test/watch-legacy-contracts.test.ts
```
