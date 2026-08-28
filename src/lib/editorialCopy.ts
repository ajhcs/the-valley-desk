const DEFENSIVE_EDITORIAL_ASIDES = [
  /\bnot (?:a|an|the) (?:audited )?(?:[A-Za-z][A-Za-z’'-]* )?(?:filing|operating metric|kpi|user count|dollar|source|citation)\b/i,
  /\bno (?:invented|verified|reported) dollars?\b/i,
  /\bdo not read\b/i,
  /\bnot the same (?:product|count|metric|study|source)\b/i,
  /\bnot this count\b/i,
  /\bnot a substitute for\b/i,
  /\bnot (?:intended|to be|meant) as\b/i,
  /\bcannot be (?:used|interpreted|read)\b/i,
];

const INTERNAL_PROCESS_LANGUAGE = [
  /\bbest[- ]effort (?:scrape|crawl|extract(?:ion)?)\b/i,
  /\bscraped? from\b/i,
  /\bingested? from\b/i,
  /\b(?:rss|rest|api) (?:feed|adapter|ingest(?:ion)?)\b/i,
  /\b(?:crawler|scraper|adapter) (?:found|output|provenance|note)\b/i,
  /\b(?:source[- ]audit|data[- ]collection|automated collection)\b/i,
  /\b(?:scraping|crawling) (?:note|method|process)\b/i,
];

/** Reader-facing copy should state supported facts, not expose the model's source-audit monologue. */
export function hasDefensiveEditorialAside(value: string | null | undefined) {
  if (!value) return false;
  return DEFENSIVE_EDITORIAL_ASIDES.some((pattern) => pattern.test(value));
}

/** Collection mechanics belong in source metadata and logs, never reader-facing copy. */
export function hasInternalProcessLanguage(value: string | null | undefined) {
  if (!value) return false;
  return INTERNAL_PROCESS_LANGUAGE.some((pattern) => pattern.test(value));
}

/**
 * Deterministic cleanup for a common source-title failure: noun piles that name
 * a repository but omit the publishing action. The editor still reviews every
 * other headline; this narrow rewrite never invents a subject or product.
 */
export function professionalizeHeadline(value: string) {
  const title = value.replace(/\s+/g, " ").trim();
  const repo = /^(.+?)\s+([A-Z][A-Za-z0-9.+-]*)\s+repo(?:sitory)?\s+for\b.+$/i.exec(title);
  if (!repo) {
    // Normalize common passive event titles into active publication style without inventing facts
    const passive = /^(.+?)\s+(?:will be|to be|is being)\s+(?:held|hosted)\b(.+)?$/i.exec(title);
    if (passive) {
      const subj = passive[1].trim();
      const rest = (passive[2] ?? "").trim();
      if (subj && rest) return `${subj} ${rest}`.replace(/\s{2,}/g, " ").trim();
    }
    return title;
  }
  const [, subject, product] = repo;
  return `${subject.trim()} publishes ${product.trim()} repo`;
}
