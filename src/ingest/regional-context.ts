import { z } from "zod";
import { looksInstructionLike } from "./untrusted-text";
import { verifyRegionalEvidence } from "./regional-contracts";
import type { RegionalEvidence, RetainedRepresentation } from "./regional-contracts";

const ContextRequest = z.object({
  facts: z.array(z.object({ evidenceId: z.string().min(1), literalText: z.string().min(3).max(2000) }).strict()).max(20),
  synthesis: z.array(z.object({ text: z.string().min(3).max(1000), author: z.string().min(1).max(200),
    evidenceIds: z.array(z.string().min(1)).min(1), isInference: z.literal(true) }).strict()).max(10),
}).strict();
export type RegionalContextRequest = z.infer<typeof ContextRequest>;

/** Prepare attributed source facts and separately labeled editorial inference.
 * This packet is context for review; it never authorizes publication or model spend. */
export async function prepareRegionalEditorialContext(request: RegionalContextRequest,
  evidence: readonly RegionalEvidence[], retained: ReadonlyMap<string, RetainedRepresentation>) {
  const parsed = ContextRequest.parse(request), citations = new Map(evidence.map(row => [row.id, row]));
  if (citations.size !== evidence.length) throw new Error("duplicate-context-evidence");
  const verified = new Set<string>();
  for (const id of new Set([...parsed.facts.map(fact => fact.evidenceId), ...parsed.synthesis.flatMap(row => row.evidenceIds)])) {
    const citation = citations.get(id), representation = retained.get(id);
    if (!citation || !representation || !await verifyRegionalEvidence(citation, representation))
      throw new Error("unverified-regional-context: " + id);
    verified.add(id);
  }
  const facts = parsed.facts.map(fact => {
    const citation = citations.get(fact.evidenceId)!;
    if (looksInstructionLike(fact.literalText)) throw new Error("instruction-like-regional-context");
    if (!citation.quote.includes(fact.literalText)) throw new Error("unsupported-regional-context-fact");
    return { text: fact.literalText, untrustedSource: true, kind: "reported-source-fact" as const,
      attribution: { sourceUrl: citation.url, evidenceId: citation.id, observedAt: citation.observedAt,
        sourcePublishedAt: citation.sourcePublishedAt, representationSha256: citation.representationSha256 } };
  });
  return { facts, synthesis: parsed.synthesis.map(row => ({ ...row, kind: "editorial-inference" as const,
    reviewRequired: true, sourcePublishedAt: null })), verifiedEvidenceIds: [...verified],
    publicationAuthorized: false, modelCallAuthorized: false };
}
