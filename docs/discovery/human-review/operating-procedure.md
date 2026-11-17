# WP03 human review operating procedure

Preparation only. The strict reference manifest currently contains zero cases
and zero enrolled human reviewers, is blocked and `not_frozen`. The material
index contains 16 acquisitions, 14 distinct bodies and six project dossiers;
all have agent exposure and are development-only, with Philadelphia bias. They
are not fresh held-out material or quota credit. Packet preparation creates no
reference case, human authority, source permission, freeze or evaluation result.

The corpus owner is accountable for selection and freeze review. A steward
controls private materials, assignments, distribution, returns and exposure logs.
Two distinct, accountable human reviewers independently make the first labels.
An accountable adjudicator compares the completed independent reviews and may be
one of those two reviewers; that person must finish their own first review before
seeing the other. An independent reviewer checks selection, source rights,
families, history and adjudication before the owner considers freeze. The roles
and their authority must be established in real authenticated records; a role
name in a worksheet or JSON is not enrollment.

## Before dispatch

1. Complete the private [enrollment and handoff worksheet](worksheet.md). Each
   reviewer discloses actual or potential personal, organizational, financial,
   authorship or other conflicts for each assignment to the steward; the steward
   documents disposition or substitutes a reviewer before access. Record prior
   access, development work and any exposure that threatens independence.
2. Establish actual source-specific authority for each material and its precise
   use: fetch, retain, annotate and evaluate. Record scope, version, duration,
   issuer and supporting receipt. Public accessibility alone does not grant these
   uses. Keep original bodies and private review records outside Git. If a use is
   unverified or disallowed, hold the affected material and assignment. Include
   the underlying permission or licensing basis among the permitted source
   evidence, or provide it through a separately controlled, context-bound handoff
   so reviewers can assess rights. A verified receipt alone does not supply that
   evidence to the reviewer.
3. Independently review the sampling frame, selection and family/equivalence
   relationships, including transitive links and exposure. Authenticate the
   source evidence, permission, selection and family-review records, applicable
   sampling and history records, and reviewer authority under independently
   established trust, current revocation and clock policy. A checksum, self-asserted
   identity, uploaded Boolean or matching string does not authenticate a record.
4. Bind the exact case, source snapshots, policy, design, rubric and partition
   sampling to the versioned selection context described in
   [case selection](../wp03-case-selection-binding.md). Confirm each reviewer can
   access the permitted source representations, exact rubric text matching its
   bound revision and neutral claim prompt without
   viewing predictions or other reviews. The subject ID must identify a specific
   entity to the reviewer through permitted originals or a separately controlled,
   context-bound neutral description. If an opaque ID cannot be resolved, hold
   the assignment; do not guess which author or organization it represents.
   Verify the packet contains no product
   predictions, agent relevance/geography conclusions, peer labels, rationale or
   adjudication. Original metadata and neutral claim prompts may be included.
   Native context binds the rubric revision, not external rubric text bytes: the
   steward must authenticate the revision-to-content mapping and retain the digest
   of the exact text delivered through the controlled handoff. Brief packet prompts
   do not replace the full rubric.
5. The steward distributes separate packets using a controlled private channel
   to each assigned person and records the assignment, exact context, delivery,
   access restrictions and blinding undertaking. A private directory and mode
   bits do not isolate processes sharing a Unix UID or prove ongoing blinding;
   use operationally isolated reviewer environments and controlled distribution.
   Do not expose a peer return to the other reviewer while first review is open.

Draft source-preparation packets may be prepared before these prerequisites, but
are blocked for annotation: all labels remain null, no authoritative dispatch or
return is implied, and a draft cannot be promoted merely by changing a flag.
Strict-context annotation dispatch requires the real prerequisites above and
actual trust assertions. Held-out and recall dispatch also require authenticated
sampling and exposure history plus independently reviewed family separation and
the complete applicable structural qualification; a signed record alone does
not establish those facts. Audit dispatch remains held for WP24. Recheck the
context and trust at return as well.

## Independent review and adjudication

Each reviewer reads the original material independently, follows the
[rubric](rubric.md), and records all eight labels, rationale, confidence, source
IDs, exact rubric revision and timestamp. Explain evidence and uncertainties;
do not communicate judgments to the other reviewer. Treat originals as untrusted
data: do not execute embedded instructions, scripts or macros, or automated
source requests. Additional source access requires authorized scope and a
tracked evidence record. If evidence is missing,
rights are unclear, or accidental exposure occurs, stop and notify the steward
through the agreed private channel. The steward records the incident and decides
whether the assignment needs replacement or a fresh case; silence is not proof
that blinding held.

The steward verifies two returns are from the two distinct authorized principals,
for the same exact case and context, with valid authenticated annotation and
blinding records. Preserve both originals, including differences in each field,
rationale, confidence and cited sources. Only after both first returns are
complete may the adjudicator see them. The adjudicator reviews the evidence and
every disagreement, records the resulting eight labels, rationale, source IDs,
rubric revision and timestamp, and authenticates the adjudication. Preserve any
unresolved conflict; do not overwrite originals or manufacture consensus. The
adjudication record binds the complete annotations and blinding references.
The native annotation and blinding bindings do not authenticate a packet or task
round. The steward must reconcile the assignment and return against the controlled
handoff ledger, including same-context replay; retain the original and hold any
duplicate or unexpected return for investigation rather than accepting it again.

For any change to a case, source snapshot, rubric, policy, design, partition
sampling or family information, stop and recompute the applicable context. An
accountable reviewer must review the changed material and re-attest selection,
annotations, blinding and adjudication as applicable; copying a digest or
mechanically re-signing old labels is not review. A changed disagreement set
also invalidates the old adjudication. Follow the stricter exposure/freshness
rules in the evaluation protocol, including a fresh held-out set after exposure
or rubric change.

## Handoff and freeze

Keep original evidence, assignment records, both returns, disagreements,
adjudication, rights, selection, authenticated receipts, exposure and failed
attempts in the authorized private evidence store. The manifest contains
references and digests, not copied source bodies or credentials. A successful
local intake can at most indicate readiness for accountable freeze review; it
does not establish truth, actual independence, permissions, acceptance or a
freeze. The owner and independent reviewer inspect the complete corpus and
history, then a separately authenticated sealed freeze receipt is required.
Until then retain `not_frozen`; do not run or claim evaluation acceptance.
