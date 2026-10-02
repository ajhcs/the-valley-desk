# Offline PA original import and freshness candidate

The `prepare-watch-source.mjs` CLI supports `--import candidate-pa-export`
with `--body`, `--acquisition`, `--download-receipt` and an existing private
`--out` directory under `/workspace/build/builderbob`. Optional `--task-root` narrows
output to an existing private task directory within that root. Legacy text capture
may still target `test/fixtures/watch-launch`; browser originals cannot. `--replay` takes
the retained import packet, original body and unchanged download receipt.
Reads use a single no-follow, nonblocking descriptor, reject nonregular files,
allocate within the exact byte bound and detect growth or pathname replacement.
Descriptors always close. Body limits use the exact candidate's `maxBytes`; originals are never text
encoded or written into repository fixtures by this operation.

The `pa-browser-original-1` envelope binds the exact observed requested PA
export endpoint/session, publisher, tool/download observation, nullable tool
session, original byte size/hash, acquisition start/completion, and unchanged
tool receipt size/hash. HTTP status, headers, final response URL and redirects
remain nullable. The requested URL is source identity, not an observed final
response URL. Receipt/tool authenticity is a named reviewer trust boundary;
checksums establish integrity only. Preserve originals and private provenance.
Unsupported receipt shapes require explicit provenance review and an adapter;
never manufacture observations to fit this interface.

Import derives export/bill clocks, PN associations and literal actions from the
archive. It returns review-only native captures, with no source-health renewal,
qualification, publication, activation or access change. Existing automatic ZIP
capture remains offline-only. A browser-original successful download is distinct
from an observed HTTP200 capture. Qualification accepts either type, but browser
originals additionally require checksum-bound named provenance review tied to
the actual access receipt. Four distinct engineering/editorial/rights/access
receipt IDs remain mandatory. IDs and caller declarations alone are not proof
of actual review. Two coherent time-separated original acquisitions are required;
an earlier retained genuine acquisition may count, while Library storage alone
cannot establish acquisition origin. No requirement for two new downloads exists.

PA source configuration may explicitly bind `freshnessPolicy` with
`weekdayMaxAgeMs`, `weekendMaxAgeMs`, `reviewMaxAgeMs`, and `evidenceReceiptId`.
Each positive bound is limited to seven days. These are reviewed local tolerance
bounds, not a publisher weekend-service guarantee. There are no automatic default
bounds. Qualification binds the latest derived export clock and policy receipt,
and requires a fresh export at review within the review bound. Readiness rejects
missing/conflicting policy review. Normal permission expiry/revocation still applies.

The separate optional `/api/v2/watch/source-health?subject=<accepted-id>` read
returns `pa-source-health-1` entries for at most 50 accepted subjects and four
sources per subject. Primary `watch-directory-1`/`watch-detail-1` responses retain
the exact prior strict envelope keys; the frozen PR18 decoder regression proves
compatibility. Auxiliary health queries and client fetches cannot hide accepted
records. Unsupported older servers or failures leave health unknown.
Health reads existing collection state and healthy retained archive derivations. It does not change accepted
facts or publication dates. UI displays export timestamp/age, bill last update,
attempted check, successful upstream check, current failure and evidence origin.
Each clock block visibly links the accepted bill and names its accepted source.
Configuration/derivation reads have SQL and typed byte bounds. Complete normalizer,
selected-bill and clock validation precedes atomic clock assignment; corrupt or
unavailable health data returns unknown without private diagnostics.
Weekend selection uses America/New_York. Invalid/future clocks and export
regression fail closed; absent clocks/policy remain unknown. Collector 200/304 results must satisfy the reviewed export-age bound before
healthy status or success renewal. Stale/unknown bounds fail closed and preserve
prior success. A failed check keeps prior success. Research/browser imports cannot renew an upstream check.
Publication snapshot and page refresh times do not become source-check clocks.
Export freshness never establishes latest bill status or legal effect.

PA native persistence rejects regressed action days and PN versions even when
retrieval time advances. Separate PA source evidence is not automatically revoked
by a new native capture. ZIP metadata can advance without freezing at a previously accepted status.
Its source-rule publication preserves live independently supported optional
latest-action/lifecycle/legal-effect facts with their original citation and
delivery groups, verification dates and dependency proofs. A ZIP carries no
competing latest-status/legal authority; those separately supported fields take
precedence over its unavailable fields. Expired/revoked optional groups are
omitted by existing delivery validity rules, so they cannot permanently block
refresh. Inherited heads/expirations and the expected public revision are fenced
by the existing editorial and application transactions. Same-source retractions
and PN/action regressions retain their deterministic holds. Identity or corrupt
prior-proof conflicts remain specifically held with a reason. No new general
arbitration or vote/PDF ingestion framework is introduced. RSS remains discovery and does not grant native status authority.
Unretained research votes remain unknown. PN versions remain distinct; neither
House passage, companion identity nor a memo establishes enacted law.

Full historical original ZIP Node/workerd regression remains required, unchanged.
New focused tests are part of the existing Watch postgate. Current acquisition
artifacts, intake contract, reviewer decisions and local validation logs remain
private. No access hold, live source, production state or deployment is changed.
