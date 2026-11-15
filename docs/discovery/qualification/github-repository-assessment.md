# GitHub repository qualification — 15 November 2026

Exactly two public repositories were selected for bounded qualification:
[PennLINC/qsiprep](https://github.com/PennLINC/qsiprep) and
[CBICA/CaPTk](https://github.com/CBICA/CaPTk). Each directly links its named
software to a research publication. These are development-exposed candidate
observations, with no human reference labels, source enrollment, publication
authority or WP03 freeze. Publication affiliations and article rights require
their separate [publication assessment](linked-publication-assessment.md).

## Repository identity and version

| Observation | QSIPrep | CaPTk |
| --- | --- | --- |
| Stable repository ID | `156589095` | `128938343` |
| Repository owner account | PennLINC, organization ID `61955309` | CBICA, organization ID `35823615` |
| Default branch observed | `main` | `master` |
| Default-branch commit observed | `ae8ab16930309d77a44f7970028b3c6642c1aae7` | `cce88180d3159546a057b32ca9b4172d3ee2624d` |
| Visibility / fork / archived / disabled | public / false / false / false | public / false / false / false |
| Repository creation date | 2018-11-07T18:14:12Z | 2018-04-10T13:36:31Z |
| Last pushed date reported | 2026-11-12T18:26:45Z | 2023-12-09T00:42:42Z |
| API license hint | BSD-3-Clause | NOASSERTION / Other |

The fixed public [QSIPrep metadata endpoint](https://api.github.com/repos/PennLINC/qsiprep)
and [CaPTk metadata endpoint](https://api.github.com/repos/CBICA/CaPTk) were read
through the GitHub connector at **2026-11-15 21:04:53–21:04:54 UTC**.
Separate [QSIPrep branch-ref](https://api.github.com/repos/PennLINC/qsiprep/git/ref/heads/main)
and [CaPTk branch-ref](https://api.github.com/repos/CBICA/CaPTk/git/ref/heads/master)
reads at **21:05:37 UTC** established the commit snapshots above. A mutable branch
or `pushed_at` is not substituted for a commit pin. Dates are GitHub-reported
repository dates; recent stars or updates do not demonstrate active development.

## Explicit software-to-publication edges

The six exact-commit file reads below succeeded through the GitHub connector in
the **21:05:10 UTC** observation batch. No linked image, badge, download,
contributor page, person profile or email endpoint was followed.

* QSIPrep's [README.rst](https://github.com/PennLINC/qsiprep/blob/ae8ab16930309d77a44f7970028b3c6642c1aae7/README.rst)
  describes a diffusion MRI preprocessing platform and directly targets
  [DOI 10.1038/s41592-021-01185-5](https://doi.org/10.1038/s41592-021-01185-5).
  [CITATION.cff](https://github.com/PennLINC/qsiprep/blob/ae8ab16930309d77a44f7970028b3c6642c1aae7/CITATION.cff)
  names that same DOI as its preferred article citation. Its current software
  author/affiliation list is a distinct assertion from the 2021 paper authorship
  and work-time affiliations.
* CaPTk's [Readme.md](https://github.com/CBICA/CaPTk/blob/cce88180d3159546a057b32ca9b4172d3ee2624d/Readme.md)
  describes cancer image analysis software, attributes development and maintenance
  to CBICA at Penn, and directly targets
  [DOI 10.1117/1.JMI.5.1.011018](https://doi.org/10.1117/1.JMI.5.1.011018).
  [README.txt](https://github.com/CBICA/CaPTk/blob/cce88180d3159546a057b32ca9b4172d3ee2624d/README.txt)
  explicitly requests citation of this paper and a separate technical overview.
  No root CITATION file appeared in the bounded root-directory listing; this is
  not a recursive absence claim.

The observed MRI and cancer-imaging purposes supply a concrete health-technology
basis for candidate review. They do not establish diagnostic accuracy, clinical
effectiveness, FDA clearance or adoption. CaPTk's README explicitly identifies
research-only use and absence of FDA or other agency review/approval. Owner
accounts are organizations, not identified human creators. Neither repository
ownership nor a GitHub contribution count establishes a person's creative role,
employment, actual working unit or county eligibility. Publication-time
affiliations and contribution evidence must be evaluated separately.

The separate publication investigation identifies QSIPrep's DOI with
[PMID 34155395](https://pubmed.ncbi.nlm.nih.gov/34155395/) and CaPTk's 2018 DOI
with [PMID 29340286](https://pubmed.ncbi.nlm.nih.gov/29340286/). It records Penn,
Philadelphia affiliations at publication for named authors in each family;
QSIPrep also has a collective software-development contribution statement.
These are project-relevant regional signals, with individual attribution and
multi-affiliation location limits retained in the linked assessment. They do not
turn an organizational GitHub owner into a verified local person or label all
coauthors as local creators. This agent's separate direct publisher/PubMed web
reads did not yield usable text; the publication findings rely on that separately
documented primary-source investigation, not those failed reads.

## Rights and retention decision

[GitHub's current terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service)
retain content ownership with its authors; the public-repository grant operates
through GitHub functionality. API terms apply through third-party tools and
prohibit rate-limit evasion and personal-data spam.
[Acceptable-use policy](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies)
also addresses public nonpersonal research information, open-access resulting
research publications and purpose-limited personal-information use.
[API documentation](https://docs.github.com/en/rest/repos/repos#get-a-repository)
permits anonymous public-repository metadata reads.
[Rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
and access restrictions still apply. These provisions support this bounded
assessment; they do not supply blanket commercial redisplay rights.

QSIPrep's pinned [LICENSE](https://github.com/PennLINC/qsiprep/blob/ae8ab16930309d77a44f7970028b3c6642c1aae7/LICENSE)
contains the BSD three-clause terms: preserve notices, conditions and disclaimer
when redistributing source; reproduce them for binaries; avoid implied
endorsement. The API's SPDX value is a hint, checked against the actual file.
No right to article text, linked sites, logos or third-party components follows
from this repository license.

CaPTk's pinned [LICENSE](https://github.com/CBICA/CaPTk/blob/cce88180d3159546a057b32ca9b4172d3ee2624d/LICENSE)
lists multiple constituent licenses, including the
[CBICA general agreement](https://www.med.upenn.edu/cbica/software-agreement.html),
a [noncommercial exception for PHI Estimator](https://www.med.upenn.edu/cbica/software-agreement-non-commercial.html),
and third-party terms. The general agreement permits software/data copying and
distribution subject to its full Part B terms, required preface, notices and
modification marking; it reserves third-party rights and disclaims clinical
approval and endorsement. The exception remains noncommercial. This is not a
blanket BSD, CC0 or unrestricted component-redistribution finding. None of those
software grants licenses Penn website bodies or linked publications.

The connector-file investigation saved only derived factual metadata, exact paths,
DOI links, safe observation times and tool boundaries to private scratch. Separately
reviewed native repository metadata was retained after reset as described below.
Raw README, CITATION and LICENSE
bodies were not copied into this repository. Tool-delivered CITATION/README text
included contact addresses; no address was copied into the assessment or candidate
JSON, and no contact/profile endpoint was queried. Reproducing those bodies later
requires the corresponding rights and privacy review.

## Native shape and adapter boundary

GitHub connector `fetch` returned a tool envelope with
`structuredContent.content` containing a JSON string for metadata/ref/list
endpoints, or Unicode text for raw file URLs. Repository metadata was one JSON
object; root listings were JSON arrays; refs were JSON objects containing
`object.sha`. The envelope itself is not a repository JSON body. The connector
did not provide original HTTP bytes, headers, response status or a WP06 receipt.
No native-byte compatibility result is claimed from those connector observations.

Four fixed anonymous metadata GETs in total used standalone public-IP-pinned
HTTPS, no authentication/proxy/redirects, identity encoding, a 48,000-byte cap and
an outer 25-second subprocess deadline. API version `2022-11-28` matched the
existing adapter version; GitHub's currently displayed documentation examples
use `2026-03-10`. These were investigation requests, not the WP06 transport.

| Native attempt | Started UTC | HTTP / bytes | Retention |
| --- | --- | --- | --- |
| Initial QSIPrep | 2026-11-15T21:07:11.287735+00:00 | 200 / 6,303 | Body discarded after conservative contact-pattern preflight rejected canonical repository SSH URL |
| Initial CaPTk | 2026-11-15T21:08:15.210296+00:00 | 403 / 279 | Error body discarded; rate-limit remaining 0 |
| Final QSIPrep after reset | 2026-11-15T21:17:46.393559+00:00 | 200 / 6,303 | Exact metadata bytes retained privately after strict decoded-payload and identity/privacy review |
| Final CaPTk after reset | 2026-11-15T21:17:46.851888+00:00 | 200 / 6,227 | Exact metadata bytes retained privately after strict decoded-payload and identity/privacy review |

All four responses declared `application/json; charset=utf-8`. The three 200
responses confirmed selected API version `2022-11-28`. QSIPrep's final body hash is
`89e4ccc7d089c3b5d5d117ad722869ab5ad186f07cfead7a6da53e8d550663aa`,
matching the hash of its first discarded response. CaPTk's retained body hash is
`28e58fd68f32470d292fb471056e05dc647923771710e2a595b74c614f1cc6cb`.
Its earlier discarded error body hash remains
`6af9166512604a5b10341db36188e146e54a9d6b45813b8625bdf14820671aec`.
The first receipt preserves a discarded body observation; matching a later hash
does not retroactively turn that first request into a retained acquisition.

The initial recursive decoded-JSON email detector also matched `git@github.com`
inside the canonical `ssh_url`. The first rejected receipt and original method
were preserved. Root reviewed an exact canonical repository SSH exception;
all other contact checks remain. An initially authorized single retry was not
issued after CaPTk's rate-limit response. Its reset header was
2026-11-15T21:16:57Z. After observing that reset, root authorized the two final
fixed GETs, bringing the total to four. There was no token, proxy or deliberate IP
manipulation to evade the limit. Final DNS resolution selected public destination
140.82.114.6; the earlier CaPTk 403 attempt had independently resolved
140.82.112.5. The successful final responses reported remaining anonymous budgets
58 and 57. No further GitHub source requests were made.

The final captures used the shared strict JSON and whole-payload preflight in
memory before saving, followed by exact public-repository and organization-owner
identity checks. The capture receipts bind preflight source hash
`b2fdcb2fdcd91546693969cb660be958d2cf6a37e066ea5b9c021ae353a4e462`.
Astra independently reviewed every field and URI in both native responses and
approved them for this bounded metadata scope. Both have `temp_clone_token:null`:
there is no clone credential value. A subsequent exact-key guard rejects nonnull
`temp_clone_token` values; null remains an absent credential slot. This is bounded
screening, not universal detection of sensitive text or source enrollment.

There are now two retained native GitHub metadata bodies. Private final bodies
and receipts are under
`.discovery-work/source-qualification/github-publications/root/github-after-reset/`
in `qsiprep-native/` and `captk-native/` as `body.json` and `observation.json`.
The first two metadata-only failure/discard receipts remain under
`.discovery-work/source-qualification/github-publications/sol/`
in the corresponding directories. Native-byte offline D1 replay is a separately
reported check; these standalone requests do not demonstrate live WP06 collection,
registry authority or recurring provider permission.

The checked-out [GitHub adapter](../../../src/ingest/discovery/github.ts)
supports repository-baseline JSON at `/repos/{owner}/{repo}` and produces an
artifact lead with a related owner account and license hint. The two observed
metadata objects supply the fields that path expects. Inspection alone does not
establish successful execution. `/contents/*` and `/git/ref/*` are outside its
route grammar; README/CITATION bodies have no publication-link parser here.
A software-paper DOI or affiliation is not extracted by the baseline mapping.
No format conversion, wrapper replay, new collector, production permission or
unattended schedule was added by this assessment.

The private candidate record is
`.discovery-work/source-qualification/github-publications/sol/candidates.json`;
it is a storage record, not an authenticated case/evidence/permission receipt.
Both repositories share Penn-related evidence and may be related sampling units.
Their family/origin and partition decisions remain unreviewed. They add no
independent human annotation, frozen reference case or held-out evaluation credit.
