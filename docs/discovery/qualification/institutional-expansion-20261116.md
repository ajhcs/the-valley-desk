# Institutional source leads: 16 November 2026

These are research leads and holds, not qualified sources, reference cases,
current-employment findings or geographic admissions. No target page body was
captured for native acquisition, no source was enrolled, and no staged-material
count changed. Web-tool search and rendering are distinct from a native WP06/13
request or an original-byte receipt. Counties below identify candidate areas;
institutional location alone does not establish a person's actual work location,
contribution location or current affiliation.
The agents inspected these leads during development. Any later case/family
selection must account for that exposure; this note supplies no fresh held-out
material or sampling credit.

| Lead | Observed evidence and limits | Current WP13 disposition |
| --- | --- | --- |
| Princeton Precision Health, Princeton, NJ (Mercer candidate) | The web-rendered [scientist listing](https://pph.princeton.edu/people/data-research-and-clinical-scientists) describes data and biomedical research professionals; the [program description](https://pph.princeton.edu/about) describes health-focused computational work. These are leads, not a person-level location or currentness determination. | A direct anonymous GET of [robots.txt](https://pph.princeton.edu/robots.txt), with `TheValleyDesk-Research/1.0`, returned HTTP 200 `text/plain` on 16 November. Its `User-agent: *` section disallows `/*?page=` and `/*&page=`. The present adapter requires `?page=N`; do not request that target query. |
| Rutgers–Camden CCIB, Camden, NJ (Camden candidate) | Web-rendered [faculty listing](https://ccib.camden.rutgers.edu/people/faculty-members/) includes computational biology and related research and visibly includes email addresses. The [affiliated-labs page](https://ccib.camden.rutgers.edu/affiliated-labs/) says its list is incomplete. | A direct anonymous GET of [robots.txt](https://ccib.camden.rutgers.edu/robots.txt), same agent and date, returned HTTP 200 `text/plain; charset=utf-8`; the `User-agent: *` rules do not state a page-query disallow for that path. This is not a use or retention grant. The visible contacts make the existing whole-document contact gate a likely rejection; raw HTML, exact query behavior and source-specific class/date mapping have not been qualified. |
| Rowan College of Science & Mathematics, Glassboro, NJ (Gloucester candidate) | The web tool rendered the [research directory](https://csm.rowan.edu/research/research-directory.html) as `text/html` with digital-health and computational cardiac research leads. The rendering does not establish native response bytes, page query semantics, current professional location or creator roles. | A direct anonymous GET of [robots.txt](https://csm.rowan.edu/robots.txt), same agent and date, returned HTTP 404; its error body was not read. This records absence of a readable policy at that request, not affirmative access or reuse permission. Rendered iframe/video and search navigation suggest unsupported passive markup, but the exact `?page=1` response, size, date, classes, contacts and raw HTML remain unknown. |
| Villanova University, PA (Delaware/Montgomery area candidate; unit unverified) | The web-rendered [nursing research overview](https://www.villanova.edu/university/nursing/faculty-and-research/faculty-areas-expertise.html) lists health and technology-related research themes. Individual eligibility and actual unit county require separate evidence. | A direct anonymous GET of [robots.txt](https://www.villanova.edu/robots.txt), same agent and date, returned HTTP 200 `text/plain; charset=iso-8859-1`; `User-agent: *` disallows `/*?page*` and `/*&page*`. Do not request the adapter's page query. |

The robots requests followed the standard HTTP client redirect behavior; the
observed final URL remained the same in each successful response. The 404 body
was not read. A robots rule concerns access by crawlers and is not a copyright
license. It does not by itself authorize retention, annotation, evaluation,
transformation, excerpts, redistribution or ongoing refresh. The Princeton
[computing guidelines](https://itpolicy.princeton.edu/guidelines),
[Rutgers copyright guidance](https://www.libraries.rutgers.edu/research-support/copyright-guidance/frequently-asked-questions-copyright)
and [Rowan library guidance](https://libguides.rowan.edu/copyright/permissions)
are general institutional guidance, not identified page-specific permission
or categorical prohibitions for these external uses. Applicable source-specific
terms, owners, scope, retention period, attribution and deletion conditions remain
unresolved. No permission or outreach is inferred from an accessible page.

The current WP13 adapter requires a reviewed numeric `?page=` template, a
source-profile-date basis and source-specific class mapping. A record without a
source date remains provisional with a `profile-date-unknown` hold. It rejects raw
responses over 48,000 bytes, contact-bearing content and markup outside its
passive HTML subset anywhere in the document. Rendered text or a `text/html`
label cannot establish those raw-byte conditions or that a query is a real
pagination endpoint. Do not remove contacts or transform a page into a fixture
to make it pass.

After independent access and source-use review, a proposed first assessment of
Rowan or Rutgers–Camden is one anonymous GET of the exact reviewed path with
`?page=1`, with redirects disabled and a 48,001-byte read limit to detect
overflow. First establish that this is a supported endpoint rather than a
meaningless ignored query and that transient inspection and intended retention
are authorized. Inspect the actual content type and strict UTF-8/passive HTML,
source date, page bounds, classes and privacy surface; make no linked requests.
Stop on refusal, redirect, authentication, contact, unsupported content or size
failure; do not retain a rejected body or provider error body. A successful
inspection would still require WP06 authority, evidence, purpose-specific rights
and independent review before native collection, durable retention or any claim.
