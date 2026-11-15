# WP09 owner handoff — Sol

Implementation candidate; independent review and orchestrator acceptance remain
separate. No provider API acquisition, enrollment, credentials, deployment,
migration, editorial admission or publication occurred. All fixtures are authored
synthetic data. Accepted shared contracts and legacy regional acquisition remain
unchanged by this adapter.

The adapter exposes a trusted WP07 provisional parser and explicit search/fetch
planning helpers. ESearch and EFetch use separate enrolled WP06 sources, templates,
budgets, attempts, raw representations, WP07 chains and committed receipts. There
is no second request inside a parser. The caller runs an explicit search round,
derives `fetchSourceId(searchReceiptId)` from the genuine retained search page,
separately enrolls/qualifies that exact fetch source, then runs its fetch round.
The durable fetch source ID hashes the exact search receipt, request/body hashes,
qualified scope ID/revision/hash, ordered PMIDs, query, date window and offset.
The callback selecting a search receipt cannot substitute another receipt after
restart: every fetch source resolution and plan checks that deterministic ID.
No whole-publication inventory is marked complete by completion of one fetch
batch. Nonempty searches remain incomplete with metadata pending. A valid
partial/capped search can still supply its returned PMIDs to an explicit fetch;
its search-cap gap remains in fetch plan/inspection output, separate from batch
completion.

`qualifyDiscoveryPubmedScope` verifies retained first-party evidence bytes and
literal institution/locality/address evidence before producing an immutable
branded scope. Its county keys come from the accepted discovery county contract,
including Mercer, NJ and excluding New Castle, DE. Institution/search literals
must equal the named institution. County/state must form an address relation in
the same bounded statement as institution/locality; unrelated mentions of
Pennsylvania cannot qualify Montgomery County, Maryland. County presence is not
an automatic admission, and these local checks do not independently establish
real source truth. The returned scope ID hashes its complete validated evidence, original declared
ID, revision, query, window, page cap and explicit candidate denominator. Sources
use that derived scope ID; declaredScopeId preserves the original input label.
A replacement qualification cannot reuse the enrolled scope identity. Limits remain five PMIDs per
page, offsets through 100, and windows through 90 days. The legacy Wistar-only
Plan is untouched and does not accept generalized institutions.

Only exact `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi` and
`efetch.fcgi` templates are supported. ESearch binds `db=pubmed`, `retmode=json`,
`term=scope.term`, `retmax=scope.pageSize`, `sort=pub date` and `retstart` through
its enrolled integer rule. EFetch binds `db=pubmed`, `retmode=xml` and the exact
ordered comma-separated ID batch. Arbitrary query/history/API-key parameters
are rejected. Source enrollment/configuration/permission/parser/install/scope,
current source revision, retained body/request hashes and endpoint templates are
revalidated when resolving search receipts. Short nonterminal search pages are
rejected so the next offset cannot skip unseen records.

PMID remains the publication native identity. Metadata versions include the
reported PMID version and a hash of the individual article XML projection,
independent of ingestion time. DOI values are proposals only. Publication types
and correction/retraction relations are preserved in private metadata rather
than interpreted as publication authority. Reported year/month/day precision is
preserved without fabricated days; unsupported date forms remain unknown with
reported text. Authors retain article-local indices, unresolved names and
per-author reported affiliations. Historical regional matches are proposals;
current employment is false/unknown and no unique person identity is invented.
Repeated names are retained unresolved. Contact email masking covers title,
author names, affiliations, publication types and relation labels. Raw retention
remains governed by WP06 permissions; display masking does not rewrite raw hashes.

Safe XML validation rejects entities/declarations outside the narrowly stripped
NLM external DTD, foreign/unbound namespaces, malformed structure and conflicting
IDs. The shared XML helper cannot retain mixed text/element order; such title or
affiliation fields fail safely rather than reorder source wording. Missing
requested IDs produce partial batch gaps. Unrequested or duplicate PMIDs fail
parsing and cannot become leads. Missing author affiliations remain explicit
private coverage gaps. Source text cannot authorize publication or execute code.

Owner validation uses qualified Node 22.23.2 with task-local TMP/XDG/npm caches.
Initial typecheck found two inferred empty-object parameter union errors; both
were corrected, and explicit app-project typechecking then passed. The authored
scope fixture passed actual hash/evidence qualification in
`.discovery-work/wp09-sol/qualify-probe.log`. Independent tests are owned by
Terra and review by Astra; owner checks do not accept this package.

Official technical reference lookup on 2026-11-15:

- [NCBI E-utilities parameter specification](https://www.ncbi.nlm.nih.gov/sites/books/NBK25499/): ESearch IDs/offsets, PubMed's 10,000-result restriction, EFetch exact ID batches and XML retrieval.
- [NCBI E-utilities introduction](https://www.ncbi.nlm.nih.gov/books/NBK25497/): search and retrieval are separate utilities, with history-server use requiring an explicit different contract.

The first direct Bookshelf lookup returned a reCAPTCHA page. Official indexed
technical documentation supplied the parameter descriptions; no API collection
or workaround to retrieve provider records was attempted.

Final warning correction: ESearch WarningList can report ignored or unfound
phrases, so even a zero-count result must not complete after such a diagnostic.
The parser now rejects nonempty warnings and unknown diagnostic shapes before
count/continuation handling. A present WarningList must be an object; `{}` and
only the documented empty `phrasesignored`, `quotedphrasesnotfound` and
`outputmessages` arrays are accepted. Null, array/scalar top-level values,
unknown fields or nonempty arrays fail closed. The app-project typecheck passed
again after this minimal change; Terra owns the permanent warning regressions.
The earlier pre-warning integrated result remains historical evidence, not
qualification of this final source.

The final diagnostic guard covers both the JSON root and `esearchresult`, with
case-insensitive `error`/`errorlist` and `warning`/`warninglist` recognition.
Present errors always fail; singular warning diagnostics also fail. Only the
specified empty WarningList object shapes may pass. This prevents an upstream
root-level error alongside a syntactically empty result from becoming a healthy
empty inventory. Unrelated extension fields remain permitted. The explicit
app-project typecheck passed again after this correction; independent probes
and permanent regression tests verify the final guard separately.
