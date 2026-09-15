# Technology Field Evidence Correction

This correction does not authorize publication or declare source qualification.
It rebuilds draft proposals from the retained September 12 source bytes.

## Corrected Bindings

- Title uses the README heading. Resource type and purpose use the actual project
  description, not the short institutional-affiliation excerpt.
- Repository identity uses separately retained numeric ID, full name, public
  visibility and exact commit SHA fields.
- Workflow uses the documented adoption/application/data-documentation paragraph.
  Unsupported detailed inputs and outputs are omitted.
- Limitations use the relevant disclaimer or citation requirement. License
  conditions use the actual license clauses/manifest. Unassessed data and weights
  licenses are omitted rather than manufactured as accepted facts.
- Release identity, tag, URL, draft/prerelease state and publication date have
  explicit literal references. Repository timestamps are not release dates.
- Intended users and setup remain unavailable because their field-specific
  evidence has not yet been prepared. No claim of tested installation is made.

`TechnologyDossierInput.metadataEvidence` is optional only for reading old stored
drafts without changing their immutable hashes. The editorial adapter requires
it. Rebuild and stage a new revision before reviewing an old draft; do not patch
old stored payloads or copy old acceptance receipts.

## Retained Inputs

The following files remain available outside Git under
`/mnt/d/tmp/plumbob/tvd-technology-dossiers-20260912/`:

- `chop-orca.captures.json`
- `penn-captk.captures.json`
- `chop-openpedcan.captures.json`

Each has `repository`, `commit`, `readme`, `license`, and `releases` objects with
`url`, `checkedAt`, and full `body`. Offline replay calls
`prepareTechnologySourceDraft(plan, JSON.parse(retainedCaptureFile))` for the
matching `technologySourcePlans` entry. The builder validates repository identity,
URLs and pinned README/license hashes before extracting field references.

Observed replay: ORCA 15 citations/1 artifact; CaPTk 74 citations/11 artifacts;
OpenPedCan 75 citations/11 artifacts. All return `publicationAuthorized:false`.
These are historical captures, not newly fetched content or current releases.

## Integration Order And Remaining Holds

1. Resolve qualified source IDs, retain full representations through
   `persistTechnologySourceRepresentation`, and stage the rebuilt `draft.input`
   using `persistTechnologyDossierDraft` with the actual current revision.
2. Call `prepareTechnologyEditorialProposal` and review every proposed field
   against its retained full representation and literal references.
3. Add genuine artifact-specific dated regional evidence. Current draft local
   relationships are historical with `validFrom:null` and have no
   `regional-eligibility` fact. They cannot satisfy public delivery.
4. Historical regional eligibility requires an evidence-backed `validFrom` day,
   matching `asOfDay`, institution membership interval covering that day, and
   region evidence included in the local-relationship fact's references. Paper
   affiliation dates cannot become software creation dates. Current provenance
   instead needs current relationship evidence and its expiry contract.
5. Source qualification needs two actual parsed captures, replay/negative fixture
   hashes, accepted access/rights disposition, real owner identities, expiry and
   separately recorded activation. Parser success alone supplies none of this.
6. Only the authenticated named-review route can create the human-review decision
   for the exact staged hash. No identity, approval or regional date was invented.

## Verification

`node --import tsx/esm --test test/technology-dossiers.test.ts` passes 17 tests.
The added tests cover field-specific bindings, unavailable optional fields,
changed-source rejection, legacy review holds and zero public rows.
TypeScript/Vite build passed with the inherited large main-bundle warning.
The combined dossier/editorial/runtime suite passes 34 tests; secret scan and
diff check pass. A further offline SQLite replay retained all three full captures,
validated each result against the actual `EditorialProposal` schema and checked
every literal reference with `evidenceMatches`: 8/18/18 proposed facts,
15/74/75 citations, and zero public rows. No network or provider call occurred.
