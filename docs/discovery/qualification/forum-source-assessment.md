# Forum source qualification assessment

Policy research recorded: 2026-11-15T20:28:22Z. Latest measured access attempt:
2026-11-15T20:40:43.222274Z. Owner: Sol. **No source is qualified,
enrolled or activated.** This assessment supports the provider-approved access gate; it is not an access/rights control, legal determination, reference-case
label or publication approval. No topic body has been deliberately requested or
retained for qualification. Parser compatibility is untested against real data.

| Candidate | Content-rights finding | Current disposition |
| --- | --- | --- |
| [OpenMRS Talk](https://talk.openmrs.org/tos) | Web-readable site policy states CC BY 4.0 for original public website contributions, with exceptions for identified third-party material; direct current-policy capture was refused. | Commercial-license candidate only; measured anonymous access is on hold after three HTTP 403 responses. Robots rules, installed version and retention qualification remain unverified. |
| [OHDSI Forums](https://forums.ohdsi.org/tos) | User contributions use CC BY-NC-SA 3.0. | Blocked for the requested commercial-compatible redisplay path without a separate applicable permission. |
| [Slicer forum](https://discourse.slicer.org/tos) | User contributions use CC BY-NC-SA 3.0. | Blocked for that commercial-compatible redisplay path without a separate applicable permission. |

These findings concern forum-post terms, not the projects' software licenses.
Public visibility and a project's code license do not authorize bulk acquisition
or unrestricted reuse of forum content.

## OpenMRS: rights basis and limits

The [Talk terms](https://talk.openmrs.org/tos), especially Website Content
Copyrights, extend the stated attribution license to original material posted
on OpenMRS-operated websites unless separately noted. They require downstream
recipients to be told the material's origin. Third-party material and trademarks
have separate limits. This is stronger evidence for forum-content reuse than
an inference from the OpenMRS code license, but it does not establish API/bulk
access permission or resolve rights in a particular post.

[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) permits commercial
copying/adaptation subject to its conditions. A proposed attribution record
should retain author attribution when supplied, exact source URL, license URL,
applicable notices and a description of modifications/redactions. No endorsement
may be implied. Privacy/publicity or other rights can remain relevant; a blanket
site license cannot establish that every attachment, quote or personal detail
is eligible for redisplay. No text or attachment has been selected for that use.

The [privacy policy](https://talk.openmrs.org/privacy) treats intentionally public
contributions, including online discussion, as public while distinguishing
information explicitly supplied privately. Its footer separately identifies the
text license. This does not justify retaining emails or private-profile fields
under the discovery project's stricter rules.

The [community guidelines](https://talk.openmrs.org/guidelines) allow moderators
to remove content/accounts and prohibit exposing others' private information.
Any future qualified sample therefore needs a checked current source pointer,
removal/private-transition handling and scoped retention. No perpetual archive,
retention duration or deletion exception has been established. Existing local
revoke/invalidation tooling is not evidence that an actual operating process or
WP14 current-claim consumer is in place.

## Anonymous access and policy evidence

| Observation ID | Primary URL | Mechanism and result |
| --- | --- | --- |
| FQ-OMRS-TOS-01 | [OpenMRS terms](https://talk.openmrs.org/tos) | Readable through web.open; later direct GET returned HTTP 403, with no body retained (see openmrs-tos below). |
| FQ-OMRS-PRIVACY-01 | [OpenMRS privacy](https://talk.openmrs.org/privacy) | Primary policy readable; current permission/control not inferred. |
| FQ-OMRS-GUIDELINES-01 | [OpenMRS guidelines](https://talk.openmrs.org/guidelines) | Public policy readable; FAQ redirected here. |
| FQ-OHDSI-TOS-01 | [OHDSI terms](https://forums.ohdsi.org/tos) | Primary page readable; noncommercial clause observed. |
| FQ-SLICER-TOS-01 | [Slicer terms](https://discourse.slicer.org/tos) | Primary page readable; noncommercial clause observed. |
| FQ-OMRS-ROBOTS-01 | [OpenMRS robots](https://talk.openmrs.org/robots.txt) | Web-tool failure; later direct GET returned HTTP 403. Robots rules remain unread, not interpreted as permission. |
| FQ-OHDSI-ROBOTS-01 | [OHDSI robots](https://forums.ohdsi.org/robots.txt) | Same tool failure; no allow/deny inference. |
| FQ-SLICER-ROBOTS-01 | [Slicer robots](https://discourse.slicer.org/robots.txt) | Same tool failure; no allow/deny inference. |
| FQ-OMRS-ABOUT-01 | [OpenMRS about metadata](https://talk.openmrs.org/about.json) | Web tool could not access JSON; anonymous HTTP status and version unverified. |
| FQ-OMRS-BASIC-01 | [OpenMRS basic metadata](https://talk.openmrs.org/site/basic-info.json) | Web tool could not access JSON; later direct anonymous GET returned HTTP 403 (openmrs-basic below). |
| FQ-CCBY-01 | [CC BY 4.0 terms summary](https://creativecommons.org/licenses/by/4.0/) | Primary license reference read; not site access permission. |

### Actual bounded anonymous HTTP attempts

These are real root-owned access observations, not synthetic fixtures. Each
used GET with the same identified user agent,
`TheValleyDesk-SourceQualification/0.1 (+https://thevalleydesk.org)`, pinned native
HTTPS, no authentication, proxy or followed redirects. Each completed in under
one second within the root's 25-second outer bound. No response body was retained;
only status/headers, byte counts and hashes remain.

| Observation ID | Exact URL | Started at UTC | HTTP / received bytes | Elapsed / read cap |
| --- | --- | --- | --- | --- |
| openmrs-robots | [robots.txt](https://talk.openmrs.org/robots.txt) | 2026-11-15T20:32:43.784568Z | 403 / 5,597 | 0.402 s / 65,536 B |
| openmrs-tos | [terms](https://talk.openmrs.org/tos) | 2026-11-15T20:34:19.932757Z | 403 / 5,533 | 0.144 s / 262,144 B |
| openmrs-basic | [basic-info.json](https://talk.openmrs.org/site/basic-info.json) | 2026-11-15T20:40:42.998675Z | 403 / 5,605 | 0.224 s / 65,536 B |

Private receipts are respectively
`.discovery-work/source-qualification/root/openmrs-robots/receipt.json`,
`openmrs-tos/receipt.json` and `openmrs-basic/receipt.json`. Root's portable
[access observation summary](evidence/access-observations.json) records the
broader qualification pass; its ROR observations are outside this forum decision.
The robots receipt's older `native_transport:true` field means the standalone
Python native-HTTPS capture, **not the WP06 transport**. The later receipts
explicitly record `transport:standalone-pinned-native-HTTPS` and
`wp06_transport:false`. No WP06 request budget, source enrollment or activation
was exercised by these captures. TLS version is not recorded; no TLS-version
claim follows from that null field.

The 403 observations establish an access hold for these anonymous requests.
Without retained bodies they do not identify the refusal's cause, expose robots
rules, prove an installed version or establish native API format. Web-readable
policy text remains a conditional rights lead, not a successful direct policy
capture or an authorization to bypass refusal. No cookies, alternate identity,
proxy, redirects or endpoint switching were used to bypass it.

Earlier web observation timestamps describe research, not HTTP Last-Modified or
fresh origin bytes. A policy search returned incidental post snippets; those
were not opened, retained or used as reference cases/post-body samples. Further
searching of topic content was stopped.

All three policy pages identify Discourse as the forum family. No installed
version has been independently observed, and no anonymous category/topic JSON
route has been exercised. Generic Discourse documentation cannot establish a
particular installation's scope or permissions. No forum-specific automated API
or bulk-use permission was located in the policy pages examined; absence of a
located rule is not an affirmative permission.

## Proposed next gate

Do not retry through changed user agents, cookies, alternate hosts/endpoints or
proxies. The remaining next action is a provider-approved anonymous access basis
and channel for the identified qualification client, including applicable
robots/API rules and allowed retention. Any request for provider clarification
or outreach needs its own user-authorized messaging scope; none was sent here.
Existing public license wording alone does not supply that access channel.
After the provider permits an appropriate route, root can review a fresh bounded
policy/installation metadata read and only then decide whether a category/topic
sample is justified. No additional HTTP attempt was made for this update.

If root establishes an adequate access/rights basis, a later separate bounded
sample can test one reviewed public category/topic response, third-party notices,
privacy exclusion and exact adapter compatibility. The current strict synthetic
Discourse profile is not assumed to accept native OpenMRS responses. Retained
samples would remain private, attributed, scoped and removable; they would not
be production enrollment, a real reference-corpus label or public editorial
admission. WP03 human adjudication/rights receipts and WP12 operational consumer
requirements remain separate gates.
