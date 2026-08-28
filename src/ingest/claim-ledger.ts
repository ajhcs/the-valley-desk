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

export function containsExact(haystack: string, needle: string) {
  const n = needle.trim();
  return n.length > 0 && haystack.includes(n);
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
  allowedSourceIds?: ReadonlySet<string>,
  allowedContextIds?: ReadonlySet<string>,
): { ok: boolean; errors: string[] } {
  if (!ledger || !ledger.claims.length) return { ok: true, errors: [] };
  const errors: string[] = [];
  for (const entry of ledger.claims) {
    if ((allowedSourceIds || allowedContextIds) && entry.sourceIds.length === 0 && entry.contextIds.length === 0) {
      errors.push(`claim ${entry.claimId} has no source or context ID`);
    }
    if (allowedSourceIds && entry.sourceIds.some((id) => !allowedSourceIds.has(id))) {
      errors.push(`claim ${entry.claimId} references an unsupported source ID`);
    }
    if (allowedContextIds && entry.contextIds.some((id) => !allowedContextIds.has(id))) {
      errors.push(`claim ${entry.claimId} references an unsupported context ID`);
    }
    if (looksInstructionLike(entry.claimText, ...entry.evidenceSpans)) {
      errors.push(`claim ${entry.claimId} contains instruction-like content`);
      continue;
    }
    for (const span of entry.evidenceSpans) {
      const inSource = containsExact(sourceHaystack, span);
      const inContext = containsExact(contextHaystack, span);
      if (!inSource && !inContext) {
        errors.push(`claim ${entry.claimId} span not verbatim in source or context: ${span.slice(0,80)}`);
      }
      if (looksInstructionLike(span)) {
        errors.push(`claim ${entry.claimId} evidence span looks instructional`);
      }
    }
    // Every atomic claim, including general facts, must be literal in one of
    // its evidence spans. Exact types additionally need to occur in the
    // supplied source/context haystacks.
    const grounded = entry.evidenceSpans.some((span) => containsExact(span, entry.claimText));
    const inCombined = containsExact(sourceHaystack, entry.claimText)
      || containsExact(contextHaystack, entry.claimText);
    if (!grounded || !inCombined) {
      errors.push(`claim ${entry.claimId} ${entry.claimType} "${entry.claimText}" not verbatim in evidence`);
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
