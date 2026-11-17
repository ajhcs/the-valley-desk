# Metadata-and-link pilot source basis

This finite pilot projects selected factual metadata and links from retained
GitHub, Crossref and ROR responses, with separately identified regional source
observations introduced in EX31. The selection file binds each native value to
an exact local body, SHA-256, capture time and JSON pointer. Source observations
are historical snapshots, not claims of current employment, current software
status, location of creation or clinical effectiveness. The pilot is not a
complete regional directory or an independently labeled benchmark.

## Purpose-specific basis

- **Crossref:** Its [metadata guidance](https://www.crossref.org/documentation/retrieve-metadata/)
  distinguishes reusable bibliographic facts and CC0 Crossref-generated metadata
  from separately copyrighted abstracts. The selected requests asked Crossref
  for factual fields without abstracts; use those returned titles, identifiers,
  dates, author names and reported affiliation metadata with provider attribution
  and links. The license and publisher fields in a response do not license every
  linked article, abstract, illustration or third-party asset. Capture and
  request details, full-field review and exact bytes are recorded in
  [fixed DOI qualification](crossref-fixed-doi-qualification.md).
- **GitHub:** Public repository metadata is used for factual identity, canonical
  link, source-reported account owner (User or Organization) and reported timestamps, subject to GitHub's
  [terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)
  and [API terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#h-api-terms).
  An API observation is not a blanket license for README, code, images, logos or
  other material. Software license hints and repository use restrictions remain
  separate; ImmunoTar has a documented noncommercial restriction and must not be
  represented as generally permissive. The
  [repository](qualification/github-repository-assessment.md) and
  [expansion](qualification/crossref-expansion-repository-assessment.md)
  assessments record native and separately observed connector sources.
- **ROR:** The [ROR terms](https://ror.org/about/terms/) dedicate ROR IDs and API
  metadata to CC0. The two retained fixed-ID responses support separate
  organization background records only. Their labels or reported locations do
  not establish a GitHub account's institutional identity, an author's current
  employment, a work's local creation or a person's actual work site. ROR
  website assets and linked third-party content are outside that metadata basis.
  See [capture and scope](qualification/wp03-real-material.md).

These provider terms are the stated basis for this narrow factual listing and
outbound links; a bespoke permission document is not treated as a universal
prerequisite. They do not grant unspecified future access, bulk collection,
article/README reuse or a waiver of third-party restrictions. New material or
field uses require their own applicable source and terms review. The pilot does
not copy abstracts, article text, code, README text, photos, logos, contacts or
license text.

## Dated affiliations and relationships

For AutoGVP, ImmunoTar and DeepCNV, selected Crossref author-affiliation fields
explicitly include Philadelphia. These report affiliation in the publication
metadata at the publication date; they do not prove that the author personally
wrote a specific code contribution or performed it there. The other publication
records must not inherit a city from an owner or ROR organization: QSIPrep's
retained Crossref record has no author affiliations, CaPTk's retained record
names institutions without city/unit detail, and the Phenomantics record does not
supply the required city-specific author affiliation.

Repository-to-publication relationships require a separately identified source
observation. AutoGVP, QSIPrep and CaPTk repository citation observations and
publication-to-repository observations for ImmunoTar, Phenomantics and DeepCNV
are described in the [two-project dossier](qualification/github-publication-qualification.md)
and [expansion assessment](qualification/crossref-expansion-repository-assessment.md).
These connector or publisher observations are distinct from the retained API
metadata bodies; neither a matching name nor a GitHub organization owner proves
the relationship. The Phenomantics publication names a historical alias; a later
observed canonical response does not establish historical numeric identity
continuity. Omit a relation if its actual supporting observation cannot be
represented and independently checked.

All selected material was exposed during development. Two repeat acquisitions
of QSIPrep/CaPTk Crossref metadata have identical body hashes and do not add
works or independent observations for a benchmark. The strict WP03 reference
manifest, human-review requirements and held-out/recall quotas remain separate;
this selection creates no reference case or human label. Local projection and
source-use checks do not activate recurring ingestion or deploy the pilot.

## EX29 field expansion after product review

The same fourteen retained bodies now supply the full six Crossref author arrays
(42, 25, 14, 9, 9 and 10 entries). Names and affiliation strings remain attributed
to the particular publication metadata, with original source indices and pointers.
No author-account merge, distinct-person count, current role or work-location
claim follows. No ORCID authentication flag or private author metadata is emitted.

Four retained GitHub `/description` values provide short repository context:
QSIPrep (30 characters), CaPTk (165), Phenomantics (87) and DeepCNV (73).
AutoGVP and ImmunoTar supply null descriptions. Astra independently inspected the
exact values and existing source hashes: no contact address, markup, patient
data or copied README/article passage was identified. CaPTk's documentation URL
is rendered as plain text; it is not automatically fetched. The API terms above
remain the scoped listing basis, not a CC0 dedication or blanket software/full-text
license. No additional request or body capture was needed.

Only the two previously retained repository citation edges supply related search
and metadata navigation. Reverse browsing means that a repository cites the paper;
it does not assert that the paper cites that repository. Search context stays
separate from the source record's own author, owner and geographic fields.


## EX30 — Source expansion

The [new qualification record](qualification/pilot-expansion-20261116.md) identifies
four additional repository/paper pairs, actual numeric repository/owner IDs,
publication DOIs, immutable citation files and author-specific Philadelphia
selection evidence. The [pilot-only material index](qualification/evidence/pilot-expansion-20261116/material-index.json)
records eight anonymous native API acquisitions and their exact bytes, hashes,
request URLs and capture times. No article, abstract, README, citation-file text,
software, image or contact body is added to the served catalog or retained as new
source content. Connector reads keep only separately identified citation facts.
GitHub API terms and Crossref metadata guidance were rechecked for this batch;
the documented narrow factual listing basis remains separate from richer reuse.

Crossref author arrays contain 114, 42, 6 and 18 entries. HistoReg supplies eleven
reported affiliation entries across six authors, including Philadelphia. The
other three new publication metadata bodies supply no affiliations; publisher
observations stay separate and do not fill native arrays. Repository location
remains unestablished. HistoReg's software agreement/research-only wording and
native publisher-license links do not become blanket software or full-text
permissions. The new GitHub descriptions are passive metadata; their linked
homepages are not fetched automatically.

Each new edge uses an explicit project-citation request observed in an immutable
GitHub file. Those derived observations are not native HTTP file captures. The
two original edges and fourteen original record objects remain unchanged.
QSIRecon's reverse publication-to-repository lead and XCP-D's duplicate paper lead
were not converted into new repository citations. The batch adds no benchmark
case, human label, present-day creator claim or regional completeness evidence.


## EX31 — Other institutions/counties and separately sourced context

The [county assessment](qualification/pilot-counties-20261116.md) separates
Princeton Computer Science/Mercer, Rutgers–Camden/Camden and the historical
Rowan–Glassboro/Gloucester coauthor connection from repository ownership or
creation. Eight new exact native bodies passed preflight and independent
whole-payload review; the [material index](qualification/evidence/pilot-counties-20261116/material-index.json)
marks six selected and two THREAD research-only bodies. The new acquisition method
binds the requested User/Organization owner type as well as numeric account and
repository identity; the production metadata preflight already supported both.
No personal profile or contact body was requested. SleepBoost remains owned by a
GitHub User account; that does not identify it as an institutional repository.

All three selected Crossref bodies omit affiliations. Separate publisher,
institutional and county observations support three derived regional context
records. Their [exact fact packet](qualification/evidence/pilot-counties-20261116/regional-contexts.json)
contains four named source-author references, publication years, actual native
snapshot bindings, precise campus/municipality context, source URLs, date-level
observation precision and successful direct/indexed methods. These facts do not
fill the original arrays, set native county fields or infer current employment.
The first-name correction for SleepBoost is separately sourced; the retained
Crossref response already reports Iman and is not rewritten. OpenPBTA's repository
is archived and the Rowan connection is a collaborator's publication affiliation,
not Rowan origin/ownership or independent coverage beyond the Penn/CHOP network.

Postal town names alone are not county proof. Princeton postal zones span counties; the selected evidence concerns the
named CS building and institutional association. Rutgers campus address is tied
to Camden through a county municipality list, not an unsupported literal claim
about a 2010 report. Rowan's old procurement link returned 404; the reviewed county
campus document is separately identified. Some direct publisher pages were blocked;
indexed primary views remain recorded as indexed observations, not new native
HTTP body receipts. No article/README/code/contact text or raw county document
was persisted or served. Source-specific richer reuse remains optional.

V3 search and display keep this derived context separate from native metadata.
It is a factual selection explanation, not a person-profile, current-county,
clinical-validity, source-authority or regional-completeness assertion. All material
is development-exposed; the unchanged WP03 manifest/source index receive zero
reference cases, human labels or held-out credit.
