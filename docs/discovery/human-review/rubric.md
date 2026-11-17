# WP03 independent review rubric

This is an operating interpretation of [policy v1](../../discovery-policy.md)
and the [evaluation protocol](../evaluation-protocol.md), not a new label
taxonomy or a policy change. Use the exact rubric revision bound to the case.
Each reviewer examines the permitted original evidence and the prespecified claim
and temporal mode, recording the source IDs and evidence basis. Do not use product
predictions, another reviewer's work, or prior adjudication. Missing information
is not negative evidence; confidence does not supply missing evidence.

The schema requires exactly these eight fields. For each dimension `supported`
means the evidence supports the stated proposition, `refuted` means it supports
the contrary for that proposition and time, and `ambiguous` means unresolved,
conflicting, insufficient, or not applicable to the claim. Explain the latter in
the rationale; the schema has no not-applicable value. Assess each separately.

| Field | Question to assess |
| --- | --- |
| `identity` | Is the subject or necessary relationship established by source-specific evidence? A matching name or affiliation alone does not merge a person and account. |
| `professionalBasis` | Is the required substantive health-technology professional basis evidenced for the subject and claim? Residence alone does not establish it. |
| `relevance` | Does the material show both a healthcare purpose and substantive technology, informatics or health-AI development, application, evaluation, or explanation? Routine computer use or generic AI alone is insufficient. |
| `currentPresence` | Is current professional presence in a qualifying county evidenced? A historical affiliation, unknown end date, headquarters or home address does not establish current presence. |
| `regionalCreation` | Was the relevant substantive contribution made in a qualifying county at its creation or contribution time? Present location and local adoption alone do not establish this. |
| `creatorRole` | Is the substantive role required by this claim supported? Membership, stars, distribution or an inferred person join alone are insufficient. |
| `rights` | Are the permissions required for the actual material and intended evaluation use supported? Public access alone is insufficient. Record the separate permission basis for fetch, retain, annotate and evaluate. |
| `overall` | `eligible`, `ineligible`, or `ambiguous` for the **prespecified claim and temporal mode**, considering applicable policy requirements and actual evidence. Explain how unresolved dimensions affect that particular claim. |

Use the exact state-qualified keys in the policy: PA:Bucks, PA:Chester,
PA:Delaware, PA:Montgomery, PA:Philadelphia, NJ:Burlington, NJ:Camden,
NJ:Gloucester and NJ:Mercer. Explicit outside evidence is different from an
unknown or conflicting location. Preserve date precision; an uncertain interval
crossing a relocation or county boundary does not prove location at creation.

An independent creator need not have an indexed work or repository; a paper need
not have a repository; organization-authored work need not identify an optional
individual. Current presence, historic presence and work created locally are
separate questions. Rights can hold affected material without changing its
technical relevance. A lack of proof of a local contribution is not proof that
none occurred. Explain a refutation with actual contrary evidence, not a search
failure. Escalate policy exceptions or incompatible evidence rather than forcing
agreement.

Record `low`, `medium`, or `high` confidence, a substantive rationale, the source
IDs actually inspected, the exact rubric revision and the review timestamp.
Identify the evidence and temporal basis for each decision, including unresolved
or inapplicable dimensions, in the rationale. Do not invent source contents,
reviewer identities, permissions, or extra labels.
