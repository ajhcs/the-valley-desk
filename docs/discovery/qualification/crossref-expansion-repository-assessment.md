# Crossref expansion: public repository observations

15 November 2026. Four exact repository leads from the separate
[primary-publication assessment](crossref-expansion-source-assessment.md) were
read through the GitHub connector. These observations are development-exposed
candidate material. They establish no human labels, independent sampling units,
source enrollment, publication authority or WP03 freeze.

## Identity, alias and immutable snapshots

| Canonical repository | Repository ID | Organization owner ID | Branch and observed HEAD |
| --- | --- | --- | --- |
| [diskin-lab-chop/AutoGVP](https://github.com/diskin-lab-chop/AutoGVP) | `525946788` | `53345105` | `main`; `8645aa708046a3d86417ce0d8b542071857e875f` |
| [sacanlab/immunotar](https://github.com/sacanlab/immunotar) | `734388793` | `18205643` | `master`; `e99cb6aa1d3ab53730fcfb47003e2fdcc5ab5bbc` |
| [chop-dbhi/phenomantics](https://github.com/chop-dbhi/phenomantics) | `15715626` | `709892` | `master`; `0c222f717c4382cd61dc8f054b3e191184cd31cc` |
| [CAG-CNV/DeepCNV](https://github.com/CAG-CNV/DeepCNV) | `285885136` | `31705609` | `master`; `47bc7dbea9dc4d835feef7607b0477ad7a9210ba` |

All four metadata objects report public visibility, `private:false`, `fork:false`,
`archived:false` and `disabled:false`. All owners are organization accounts.
The metadata/ref batch began at **2026-11-15T21:43:23Z**; the subsequent complete
tree and pinned file reads preceded the **21:45:06Z** completion checkpoint.
These clock observations bracket the investigation; the connector supplies no
per-request HTTP timestamp. A mutable branch or repository update date is not a
commit pin or evidence of continuing development.

The Phenomantics article names the historical
[`cbmi/phenomantics`](https://github.com/cbmi/phenomantics) alias. A connector
`get_repo` request using that alias returned canonical `chop-dbhi/phenomantics`
and current ID `15715626`; a separate canonical metadata read agreed. The
publication investigator also observed the web redirect. Preserve both names.
The connector did not expose an HTTP redirect chain or a historical numeric ID,
so this does not prove numeric identity continuity back to 2014.

## Software and publication links

| Repository snapshot evidence | Explicit publication relationship |
| --- | --- |
| AutoGVP [README.md](https://github.com/diskin-lab-chop/AutoGVP/blob/8645aa708046a3d86417ce0d8b542071857e875f/README.md), blob `1c9262fd1d1e730ea4d6aae44b853c4efc4dac87` | Lines 4 and 6 explicitly identify [DOI 10.1093/bioinformatics/btae114](https://doi.org/10.1093/bioinformatics/btae114), PMID `38426335` and PMCID `PMC10955249`. The repository and paper name each other. |
| ImmunoTar [README.md](https://github.com/sacanlab/immunotar/blob/e99cb6aa1d3ab53730fcfb47003e2fdcc5ab5bbc/README.md), blob `949a24fd14c11b719e94c0ff69ca7dc45e3106a6` | Describes cancer immunotherapy target prioritization. No explicit target-paper DOI or citation was identified in this README. The article explicitly names this repository for [DOI 10.1093/bioinformatics/btaf060](https://doi.org/10.1093/bioinformatics/btaf060). |
| Phenomantics [README.md](https://github.com/chop-dbhi/phenomantics/blob/0c222f717c4382cd61dc8f054b3e191184cd31cc/README.md), blob `fef29a59ffa5e632ab641a4a0020bd94fc18047f` | Describes automated genetic-variant prioritization and a port of an internal CHOP Center for Biomedical Informatics code base. No explicit target-paper DOI or citation was identified in the root or nested README. The [2014 article](https://doi.org/10.1186/1471-2105-15-248) explicitly names the historical alias. |
| DeepCNV [README.md](https://github.com/CAG-CNV/DeepCNV/blob/47bc7dbea9dc4d835feef7607b0477ad7a9210ba/README.md), blob `9b481599153681a3540b08724a15273e2cad1db1` | Describes array/sequencing model workflows and mentions a BIB paper, without the target DOI or a precise article link. Neither nested readme supplies that link. The article explicitly names this repository for [DOI 10.1093/bib/bbaa381](https://doi.org/10.1093/bib/bbaa381). |

The absence claims cover the consulted README files and standard citation
filenames, not every code comment or data file. Complete, untruncated recursive
Git-tree listings at the four pinned commits contained 53, 121, 98 and 70 nodes,
respectively. No `CITATION`, `LICENSE`, `LICENCE`, `COPYING` or `NOTICE` basename
with an optional suffix appeared. The additional consulted files were
Phenomantics `apps/genesis_aws/README.md`, and DeepCNV
`DeepCNV_Seqv2/readme.txt` and `DeepCNVv2/readme.txt`. Their exact blob IDs and
commit URLs are retained in the private derived record.

Health-technology purposes are research context, not clinical effectiveness,
regulatory approval or deployment acceptance. Primary articles separately report
Philadelphia CHOP/Drexel/Penn affiliations, with Rockville, Vancouver, Cincinnati,
Berlin and Newark qualifications preserved in the publication assessment.
Organizational ownership does not establish a person's code authorship,
employment, actual work site or county eligibility. The article assessment
identifies a shared Sharon Diskin author name between AutoGVP and ImmunoTar;
family and person resolution remain unreviewed across all dossiers, including
the earlier QSIPrep and CaPTk work.

## Licensing, retention and provider boundary

All four repository metadata responses have `license:null`. This is an API hint,
not a grant or a finding that no terms exist. ImmunoTar's pinned
[DESCRIPTION](https://github.com/sacanlab/immunotar/blob/e99cb6aa1d3ab53730fcfb47003e2fdcc5ab5bbc/DESCRIPTION),
blob `3b6dcd2fdb2d08bdcc93c4d0f64c27bac1ce4279`, declares free noncommercial use
and directs users to obtain author permission for redistribution or commercial
use. That restriction rules out a blanket permissive-license claim. For the other
three projects, no standard license file or license statement was identified in
the consulted README files; code and README redistribution rights remain
unestablished. This bounded inspection does not adjudicate every component.
Article licenses do not license software, logos, linked datasets or third-party
content, and repository access does not license article text.

[GitHub's current terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)
retain author ownership and grant public-repository use through GitHub's
functionality; API terms also govern third-party tools and prohibit abuse and
rate-limit evasion. Its
[acceptable-use policy](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies)
allows public nonpersonal research information subject to open-access resulting
research publications, purpose limits and privacy requirements. The
[repository API documentation](https://docs.github.com/en/rest/repos/repos#get-a-repository)
supports anonymous public metadata reads. These sources support this bounded
factual assessment; commercial redisplay and recurring collection remain
separate permission decisions. No contributor list, commit-author record,
person profile, contact endpoint, clone, installation, source execution or
outreach was used.

Only derived factual observations, safe paths, DOI relationships, identifiers,
commit pins, timestamps and method limits were saved privately at
`.discovery-work/source-qualification/crossref-expansion/repos/candidates.json`.
Raw README, DESCRIPTION and article text and contact addresses were not saved.
No raw connector envelope was treated as a native response body. The connector's
`fetch` returns JSON text in `structuredContent.content` for metadata/ref/tree
routes; `fetch_file` supplies decoded file text and blob metadata. Neither proves
original HTTP bytes, status, headers, MIME, transport controls or a WP06 receipt.
This agent made no native HTTP requests and retained no native bodies. Any
root-coordinated exact metadata capture needs its separate whole-payload review
and native observation record.

The existing GitHub adapter's repository-baseline route can consume repository
metadata; refs, trees, README and DESCRIPTION routes are outside that mapping.
This manual file investigation does not add publication parsing to the adapter,
qualify a live collector or establish source activation. All four candidates and
their connected works remain development-exposed, with family and partition
decisions, authentic evidence/permission authority, independent human labels,
adjudication and an accountable freeze outstanding.
