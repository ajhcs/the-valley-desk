# Metadata-and-link pilot source basis

This finite pilot projects selected factual metadata and links from retained
GitHub, Crossref and ROR responses. The selection file binds each native value to
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
  link, organization-account owner and reported timestamps, subject to GitHub's
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
