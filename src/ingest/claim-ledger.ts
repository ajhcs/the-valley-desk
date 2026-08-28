import { z } from "zod";
import { looksInstructionLike } from "./untrusted-text";

export const ClaimType = z.enum(["name", "number", "date", "role", "fact", "other"]);

export const ClaimLedgerEntry = z.object({
  claimId: z.string().min(1).max(64),
  claimText: z.string().min(1).max(500),
  claimType: ClaimType,
  evidenceSpans: z.array(z.string().min(1).max(500)).min(1).max(4),
  sourceIds: z.array(z.string().min(1).max(64)).max(4).default([]),
  contextIds: z.array(z.string().min(1).max(64)).max(4).default([]),
});

export const ClaimLedger = z.object({
  claims: z.array(ClaimLedgerEntry).max(12).default([]),
});

export type ClaimLedgerEntry = z.infer<typeof ClaimLedgerEntry>;
export type ClaimLedger = z.infer<typeof ClaimLedger>;
export type ClaimType = z.infer<typeof ClaimType>;

function normalizedHaystack(value: string) {
  return value.toLocaleLowerCase("en-US").replace(/\s+/g, " ").trim();
}

export function containsExact(haystack: string, needle: string) {
  const h = normalizedHaystack(haystack);
  const n = normalizedHaystack(needle);
  return n.length > 0 && h.includes(n);
}

/**
 * Validate that each atomic claim maps to literal evidence spans and IDs.
 * - evidence spans must be verbatim substrings of the trusted haystack (source or context)
 * - claimText must be verbatim within its evidence spans for exact types (name/number/date/role)
 * - source text is untrusted: instruction-like spans are rejected
 * Returns { ok, errors }
 */
export function validateClaimLedger(
  ledger: ClaimLedger | undefined | null,
  sourceHaystack: string,
  contextHaystack: string,
): { ok: boolean; errors: string[] } {
  if (!ledger || !ledger.claims.length) return { ok: true, errors: [] };
  const errors: string[] = [];
  const sourceNorm = normalizedHaystack(sourceHaystack);
  const contextNorm = normalizedHaystack(contextHaystack);
  const combinedNorm = `${sourceNorm}\n${contextNorm}`;
  for (const entry of ledger.claims) {
    if (looksInstructionLike(entry.claimText, ...entry.evidenceSpans)) {
      errors.push(`claim ${entry.claimId} contains instruction-like content`);
      continue;
    }
    for (const span of entry.evidenceSpans) {
      const spanNorm = normalizedHaystack(span);
      const inSource = spanNorm.length > 0 && sourceNorm.includes(spanNorm);
      const inContext = spanNorm.length > 0 && contextNorm.includes(spanNorm);
      if (!inSource && !inContext) {
        errors.push(`claim ${entry.claimId} span not verbatim in source or context: ${span.slice(0,80)}`);
      }
      if (looksInstructionLike(span)) {
        errors.push(`claim ${entry.claimId} evidence span looks instructional`);
      }
    }
    // For exact types, claimText must be exact within at least one evidence span
    if (["name", "number", "date", "role"].includes(entry.claimType)) {
      const textNorm = normalizedHaystack(entry.claimText);
      const grounded = entry.evidenceSpans.some((span) => normalizedHaystack(span).includes(textNorm));
      const inCombined = combinedNorm.includes(textNorm);
      if (!grounded || !inCombined) {
        errors.push(`claim ${entry.claimId} exact ${entry.claimType} "${entry.claimText}" not verbatim in evidence`);
      }
    } else {
      // for fact/other, also require grounding
      const textNorm = normalizedHaystack(entry.claimText);
      const grounded = entry.evidenceSpans.some((span) => normalizedHaystack(span).includes(textNorm) || sourceNorm.includes(textNorm) || contextNorm.includes(textNorm));
      if (!grounded) {
        errors.push(`claim ${entry.claimId} text not grounded: ${entry.claimText.slice(0,80)}`);
      }
    }
    if (entry.evidenceSpans.length === 0) {
      errors.push(`claim ${entry.claimId} has no evidence`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function ledgerSourceContextHaystacks(
  item: { title: string; dek: string; body: string; hostOrg?: string },
  priorCoverage: Array<{ title: string; summary: string }>,
) {
  const source = [item.title, item.dek, item.body, item.hostOrg ?? ""].filter(Boolean).join("\n");
  const context = priorCoverage.map((row) => `${row.title}\n${row.summary}`).join("\n");
  return { source, context };
}
