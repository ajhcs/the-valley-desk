/** Instruction-like text in untrusted source or mail. Never treated as a command. */
export const INSTRUCTION_LIKE_RE = /(ignore (all )?(previous|above) instructions|you are (an? )?(chatgpt|language model|helpful assistant)|system prompt|REVIEW_API_TOKEN|authorization:\s*bearer|auto-?publish|publish (this|now|immediately)|do not follow (your|the) (system|previous)|new instructions:|(?:for|to) (?:an? )?(?:automated|ai|llm|language[- ]model) (?:reviewer|system|model|agent)s?|mark (?:this|it) (?:as )?priority_review|return (?:only )?(?:json|priority_review)|reveal no caveats|treat (?:this|the (?:source|text|content)) as (?:an? )?instructions?)/i;

export function looksInstructionLike(...parts: Array<string | null | undefined>) {
  return INSTRUCTION_LIKE_RE.test(parts.filter(Boolean).join("\n"));
}
