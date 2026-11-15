# WP11 arXiv — Astra independent review

Disposition: recommend accepting the bounded adapter implementation after root completes the actual-D1 and full qualification gates. No remaining blocker found in the reviewed source. Root owns acceptance; these synthetic checks do not establish provider enrollment, corpus readiness, editorial truth, or deployment readiness.

## Primary contract review

The [arXiv identifier specification](https://info.arxiv.org/help/arxiv_identifier.html) distinguishes modern four-digit sequence IDs from April 2007 through December 2014, five-digit sequences from January 2015, and earlier archive-prefixed IDs. A version suffix denotes a specific version; an unsuffixed identifier means the latest version, not v1. EX16 must explicitly specify the supported subset and unknown-version treatment. Provider base identity, source version and retained metadata revision are distinct.

The [API manual](https://info.arxiv.org/help/api/user-manual.html) distinguishes feed freshness from entry publication/update dates, documents OpenSearch offset/result fields, and represents API errors as entries. Query feed IDs include query-specific identity, so different offset pages need not share one feed ID. Its examples include unversioned entry IDs and descriptive HTTP self-links; any narrower implementation subset or descriptive URL normalization needs an explicit boundary. The generated request remains the only egress authority. Changing totals, missing entries and duplicate IDs must stay visible; offset pagination does not establish immutable snapshot membership.

[RFC 4287](https://www.rfc-editor.org/rfc/rfc4287) makes absent text-construct type equivalent to text, which cannot contain child elements. HTML and XHTML have different rules. A bounded parser may reject those unsupported forms rather than reorder mixed text through the shared XML projection. Namespace-expanded names determine authority, not prefix spelling. XML base, entities and foreign lookalike fields require explicit handling or rejection.

These primary documentation reads did not call arXiv query endpoints or acquire provider records. They inform local synthetic implementation review only.

The [identifier contract for interacting services](https://info.arxiv.org/help/arxiv_identifier_for_services.html) explicitly maps internal `math.CA/0611800v2` to preferred external `arXiv:math/0611800v2` and identifies math, cs, nlin and q-bio as archives with optional subject-class information. Canonicalizing that optional suffix is supported for those four archives while retaining original spelling/class metadata. It is not a general instruction to strip dotted suffixes from every archive, nor authority for cross-provider work equivalence. Root received this independent adjudication for EX16.

Root adjudicated numeric-offset continuation separately from Crossref's expiring opaque cursor. A retained parent anchors continuity, while current issued-plan authority, fresh live lease, and configured continuation expiry govern sending. Read-only `plan()` and `nextPage()` results do not issue requests or confer collection authority. Historical replay remains constrained by retained rights rather than an expired live lease. Equal-total membership churn cannot be reliably detected by this API: a completed bounded traversal is neither an immutable snapshot nor global coverage.

## Independent implementation checks

The initial source overgeneralized optional legacy subject-class aliases. The final normalizer limits stripping to the four documented archives. The initial projection could resolve an unversioned entry to an explicit alternate version while retaining a latest-version public URL; the final projection recomputes the URL from the resolved version. Both corrections were coordinated with the owner and independently checked.

Forty-one independent cases passed against Terra's pre-removal synthetic actual-D1 fixture snapshot. The checks cover three-page projection and historical replay without a live plan; query/window/continuation/clock binding; missing or corrupted retained pages, representations, and ancestry; future commits; DTD, foreign and misqualified namespaces, provider error entries and unsupported mixed/text forms; entry-position and feed-freshness stability versus same-version metadata changes; unknown and alternate versions; unresolved same-name authors; unsafe license URLs; changed totals, short pages, duplicate base IDs across pages, mismatched offsets, continuation expiry, and mutation of caller-owned input during asynchronous inspection.

The final run is `.discovery-work/wp11-astra/adapter-final2.log`. Earlier attempts are retained: `adapter-first.log` rejected live continuation because the exported snapshot clock was already past expiry; the probe now fixes its live-check clock to the final page's original commit time, while a separate case tests expiry. `adapter-final.log` rejected a short response whose declared items-per-page still claimed two; the final short-page case consistently declares one and receives an explicit incomplete result. These were test setup corrections, not suppressed failures.

These independent probes exercise adapter behavior through snapshot resolvers; they do not replace Terra's real store and runtime qualification. No actual collection, trust enrollment, installation, or deployment occurred.

Reviewed SHA-256:

- `src/ingest/discovery/arxiv.ts`: `ab65fd6911543c551c401b8a4bc63a3d305149f65315e62c8ac962ec24cb92ce`
- Independent `.discovery-work/wp11-astra/adapter-probe.ts`: `218767656a073b8c3da78372f003eb7f0b6113d6d1e28ab82900ecefc77d6389`
- Input `.discovery-work/wp11-terra/fixture-snapshot-4145885.json`: `a8d3f74647866f9085aad4009b20a720e4359878a4a81ddf878703a0171f23ea`

## Late pre-send offset challenge

Root challenged whether a template maximum larger than the adapter's scoped traversal cap permits an arbitrary initial offset to reach transport. The actual registry prevents this: `source-registry.ts` rejects a noninitial page without continuation unless it equals the template's minimum. The collector finalizes that issue failure before acquiring transport. Later offsets require a committed, retained parent and exact checkpoint/token/query binding; the arXiv parser emits no continuation at its item/page cap. A broader endpoint grammar therefore does not itself bypass qualified traversal through this collection path.

The existing generic tests exercised forged continuations but did not directly test this exact initial-offset case. A minimal scratch test reused their actual-D1 setup and submitted page 2 within a template range of 1–3 with a null checkpoint. It received `discovery-source-initial-page`, preserved budget and attempt counts, and made zero sends, including an attempted acquisition of the nonexistent plan. Evidence is `.discovery-work/wp11-astra/initial-offset.test.ts` and `initial-offset.log`. No implementation edit was needed, and the reviewed source hash remains unchanged.
