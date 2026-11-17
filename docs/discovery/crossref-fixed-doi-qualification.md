# Crossref fixed DOI request qualification

EX23 closes the request-grammar gap identified in EX22 for a bounded factual
metadata lookup. The adapter now has an explicit `fixed-doi` scope alongside its
existing work/institution search scopes. Native captures, exact issued endpoints,
retained requests and body hashes are checked together. This qualifies the local
request/parser/retention contract; external trust enrollment, production source
activation and independent reference labels remain separate.

## Scope and request

```ts
const scope = await qualifyDiscoveryCrossrefScope({
  declaredId: 'scope:crossref-fixed-autogvp',
  revision: 1,
  queryKind: 'fixed-doi',
  doiLiteral: '10.1093/bioinformatics/btae114',
});
```

The strict fixed scope accepts only its declared ID/revision, discriminator and
bare supported DOI literal. It preserves that literal for the filter and derives
a separately normalized DOI identity. It has no search text, date window,
pagination token or configurable field list. Its content digest binds the literal,
canonical identity, filter and fixed field selection.

The registered template must be exactly:

```ts
{
  origin: 'https://api.crossref.org',
  path: '/v1/works',
  fixed: {
    filter: 'doi:' + scope.doiLiteral,
    rows: '1',
    select: CROSSREF_FIXED_DOI_SELECT,
  },
  parameters: {},
  required: [],
  // Supply the reviewed template ID; omit pageParameter.
}
```

`CROSSREF_FIXED_DOI_SELECT` is
`DOI,title,type,author,published,URL,publisher,relation,license`. The material scope
must be metadata. `adapter.plan(sourceId)` constructs the canonical endpoint;
explicit cursor or parent arguments fail. The shared endpoint constructor sorts
query names, so the issued order is `filter,rows,select`. Nothing changes the
shared canonicalization or permits an alternate serialized endpoint.

EX22's captures used `filter,select,rows`. Their observations remain unchanged.
New captures use the constructor's exact URL. The two original works returned
byte-identical bodies again, but their new acquisition observations are distinct.
Parameter equivalence alone is not treated as exact original-request equality.

## Claim, retention and replay

Fixed-mode parsing requires the additional trusted resolver
`resolveClaimForPlan(planId)`. The composition resolves the actual local collection
claim whose `issued_plan_id` equals the issued plan, then calls the existing
`collectionStore.resolveClaim(id)`. Missing or mismatched resolution fails closed.
Do not synthesize an initial claim from an empty parameter object or source ID.
Legacy search scopes retain their existing resolver requirements.

Before projection, the adapter checks plan/request/configuration/source/lease
bindings and an active initial chain with zero pages and null checkpoint/parent.
The existing strict whole-payload JSON/material guard remains in force. A fixed
response must have total-results one, exactly one item with the requested canonical
DOI, no `next-cursor` property and no unselected item fields. Continuation Link
metadata, malformed selected fields and unresolved relation formats fail before
capture. Year/month/day precision remains literal. A relation target is an
unverified proposal and never an automatic request or independent origin.

A successful fixed result has one lead, one terminal page and no next checkpoint.
Receipt/replay checks enforce that shape. Historical replay reads the retained
request/body/claim evidence; it does not reacquire a settled live transport lease.
`nextPage` returns null for the complete singleton. Existing search/cursor chains
retain their tested ancestry, freshness and budget rules.

These control-path invariants are conditional on the existing trusted resolver,
hash, D1 transaction and qualification boundaries:

- A successful fixed parse can emit only the one requested canonical DOI: the
  singleton/member check precedes projection, and the item/page bounds are one.
- A successful fixed chain cannot authorize a second page: no token or parent is
  accepted, no continuation is emitted, and replay requires ordinal one.
- A malformed item cannot become a healthy empty success: fixed-mode projection
  errors propagate before any new raw representation, page or lead commit.
- Source facts, authorship, geography and relevance do not follow from these
  invariants. They remain evidence/rubric decisions, with publication unauthorized.

## Real evidence and remaining WP03 work

The [new source assessment](qualification/crossref-expansion-source-assessment.md)
and [repository assessment](qualification/crossref-expansion-repository-assessment.md)
cover AutoGVP, ImmunoTar, Phenomantics and DeepCNV. Six canonical Crossref lookups
(those four plus QSIPrep/CaPTk) and four new repository-baseline reads succeeded.
All exact native bodies and original observations are retained under
[the acquisition directory](qualification/evidence/crossref-expansion-20261115/).
[Astra's review](qualification/crossref-request-astra-review.md) distinguishes
source access, material rights, request compatibility and corpus acceptance.

The ten new acquisitions add eight distinct bodies because the two recaptured
works repeat earlier bytes. The inventory therefore has 16 acquisition records
and 14 distinct body hashes, not 16 independent measurement units. All six project
dossiers are development-exposed. Shared authors, preprint relationships,
historical aliases, missing affiliations and outside-region contributors remain
visible; family and partition assignments are unreviewed. Current employment and
clinical effectiveness are not inferred.

The strict reference manifest still contains zero cases and zero human reviewers.
Authenticated evidence/permission statements, independent blinded annotation and
adjudication, family/partition and independent sampling review, the complete corpus
and accountable freeze remain outstanding. WP14 stays gated and E01–E06 not_run.
No source enrollment, recurring collector, remote migration or deployment is granted.
