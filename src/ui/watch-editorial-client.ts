import { z } from "zod";
import { canonicalJson, sha256, EvidenceReference, PolicyDossierDraft, TechnologyProfileDraft, WatchId, Sha256 } from "../content/watch-schema";
import type { readEditorialProposal } from "../ingest/watch-editorial";

const Detail = z.object({ id: WatchId, sha256: Sha256, createdAt: z.string(), proposal: z.object({
  draft: z.union([PolicyDossierDraft, TechnologyProfileDraft]),
  facts: z.array(z.object({ id: WatchId, field: z.string(), value: z.unknown(), evidenceIds: z.array(WatchId),
    interpretationDependencies: z.unknown() }).passthrough()), evidence: z.array(EvidenceReference),
}).passthrough(), decision: z.object({ id: WatchId, action: z.enum(["accepted", "rejected"]),
  input_sha256: Sha256, reviewer_principal: z.string() }).nullable() });

export async function validateEditorialDetail(value: unknown, expectedId: string) {
  const parsed = Detail.safeParse(value);
  if (!parsed.success || parsed.data.id !== expectedId ||
    await sha256(canonicalJson(parsed.data.proposal)) !== parsed.data.sha256)
    throw new Error("watch-review-integrity-error");
  return parsed.data as NonNullable<Awaited<ReturnType<typeof readEditorialProposal>>>;
}
