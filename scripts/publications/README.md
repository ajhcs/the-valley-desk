# Publications collection

The institution reference is a JSON array with one institution per line. Each regional site has a first-party citation. Parent entries and ROR IDs help discover candidates. A named institution and any claimed site still need support in the affiliation recorded for the work.

Run these commands from the project checkout. Set `PUBLICATIONS_RUN` to a private directory on the workspace drive. Keep provider responses, review packets, review decisions, and unpublished records there.

```sh
mkdir -m 0700 "$PUBLICATIONS_RUN"
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/publications -v
python3 scripts/publications/sizing.py "$PUBLICATIONS_RUN" openalex
python3 scripts/publications/sizing.py "$PUBLICATIONS_RUN" europepmc
python3 scripts/publications/sizing_report.py "$PUBLICATIONS_RUN"
python3 scripts/publications/collect.py "$PUBLICATIONS_RUN" 2026-10-01 2026-10-31
python3 scripts/publications/review_packets.py "$PUBLICATIONS_RUN" 2026-10-01 2026-10-31
```

The two dates are inclusive. Collection records every response under its service and request digest. Use `--replay` with a retained run to reconstruct the input without re-fetching successful responses. Start a second run in another private directory to compare a fresh pull before preparing review packets. Keep the status and body for failed attempts. Europe PMC cursor paging deduplicates records by source and native ID. A cursor that stops before the reported number of unique records triggers narrower date windows. An incomplete single-day window fails.

Europe PMC searches indexed author-affiliation phrases using `FIRST_PDATE`. Company searches also include a local place term as a candidate filter. It can still find a place attached to a different author or institution. OpenAlex groups works by assigned ROR, or by an affiliation phrase where the institution has no ROR. It uses the primary Life Sciences or Health Sciences domain. The cohort definitions differ, and both services can reuse PubMed source metadata. Counts measure discovery leads. For multi-site organizations, a count can include other campuses. A source-side union removes multiple hits on the same index record. It does not match versions across indexes.

The collection command combines Europe PMC date-and-affiliation results with the corresponding OpenAlex ROR union. It merges on exact DOI, PMID, or arXiv identifiers. It preserves conflicting identities for review. Separate preprint and journal DOIs stay separate. Reviewer packets retain literal author affiliations for source checks and OpenAlex leads for follow-up.

Track two independent decisions per candidate. Only use the projection command after adjudication and source checks. The approved private JSON Lines file supplies the selected source, topic, type, author positions, literal affiliations, and supported counties. Projection checks the cited author evidence, obtains the publication date from the retained observations, preserves the first added date for an established public ID, and validates the entire output before replacing it.

```sh
python3 scripts/publications/project.py "$PUBLICATIONS_RUN" 2026-10-01 2026-10-31 "$PUBLICATIONS_RUN/approved.jsonl"
python3 scripts/publications/validate.py
```

The validator uses Python `jsonschema`. Suppression uses the sorted array of publication IDs in `src/content/public-directory-publications-removals.json`. The corresponding public-site removal store needs publication ID as a unique key and must apply it to list, detail, feed, and update views.

Provider documentation and access terms

- OpenAlex public query budget, paging, and data terms. [Authentication](https://help.openalex.org/api/authentication/) · [Paging](https://help.openalex.org/api/paging/) · [Terms of Service](https://openalex.org/OpenAlex_termsofservice.pdf)
- Europe PMC REST search and EMBL-EBI terms. [Articles API](https://dev.europepmc.org/RestfulWebService) · [EMBL-EBI terms](https://www.ebi.ac.uk/about/terms-of-use/)
- ROR organization lookup and CC0 data terms. [REST API](https://ror.readme.io/docs/rest-api) · [Terms of Use](https://ror.org/about/terms/)


## Pilot inclusion and record holds

A listing needs a persistent scholarly identifier, relevance to health, medicine, biomedicine, or life science, and a published author affiliation that supports one of the nine counties. Europe PMC provides primary affiliation evidence. OpenAlex is a discovery source with anonymous access. A company requires an explicit local site. For Penn State, only Abington is in scope. Penn Medicine Princeton Medical Center in Plainsboro is outside the region.

Decline corrections, errata, retraction notices, tables of contents, meeting announcements, obituaries, memorials and tributes, and records without authors. Keep an otherwise eligible retracted research article marked as retracted. Verified requires a named regional institution and site, or an unambiguous single-site regional institution. Listed requires a literal institutional affiliation with an unresolved site and no unsupported county claim.

Escalate by record ID only when the record would expose private information about an identifiable person who did not publish it, or when the record itself is a retraction or expression of concern naming misconduct. Hold the affected record and continue reviewing the remaining candidates.

## Evidence reconciliation

The October query selects candidates. Publication dates can precede or follow that discovery window. The projection uses the earliest supported date with the source precision. A month or year is kept at that precision when the provider padded it to the first day.

Two independent reviewers must agree to list a work. Measure list-versus-not-list disagreement for the institutional gate and apply the 5% threshold to cohorts of 50 or more candidates. Independently adjudicate disagreements on disposition or substantive institution and county evidence. For units that share a registered parent, keep the most specific unit named in the affiliation and link its parent separately through the reference. The handoff includes both Verified and Listed records. Exposure remains a delivery decision.

To enrich unconfirmed OpenAlex leads once, query Europe PMC and the public Crossref endpoint by DOI.

```sh
python3 scripts/publications/enrich.py "$ENRICHMENT_RUN" "$PUBLICATIONS_RUN/candidates-2026-10-01-2026-10-31.jsonl"
```

Use a mode-0700 directory for `ENRICHMENT_RUN`. Crossref publisher-deposited metadata qualifies as primary evidence when it links the exact author to the literal affiliation. Leads without primary author evidence remain private. [Crossref public pool](https://www.crossref.org/documentation/retrieve-metadata/rest-api/access-and-authentication/)

After verifying supplemental observations against their receipts, attach them to the candidate's `observations` by exact DOI in a separate candidate JSON Lines file inside the private run. Keep its original `provider_key` and check any added persistent identifiers for conflicts. Pass that file to the projection command with `--candidates`.
