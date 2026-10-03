/** Conservative contact-email masking, including quoted local parts, Unicode and address literals.
 * This is a display projection only; evidence hashes remain bound to original retained bytes. */
export function redactRegionalContactEmails(value: string) {
  const masked = value.replace(/(?:"(?:\\[\s\S]|[^"\\\r\n])*"|[^\s<>()\[\]{},;:"\\@]+)\s*@\s*(?:\[[^\]\r\n]+\]|[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*)/gu, "[email omitted]");
  // Unknown/comment-separated mailbox syntax is withheld as a whole display field.
  return masked.includes("@") ? "[contact-bearing text omitted]" : masked;
}
