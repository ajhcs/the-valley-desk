import { extractPaBillEvidence, paBillSynopsis, paSourceDate } from "./pa-bill-evidence";

const plain = (value: string) => value.replace(/<[^>]*>/g, " ")
  .replace(/&#(?:160|x0*a0);|&nbsp;/gi, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/** Read-only presentation model. It never creates ContentItems or developments. */
export function policyBackground(html: string, officialUrl: string, observedAt: string) {
  const record = extractPaBillEvidence(html, officialUrl);
  // Only the designated history table; the page also repeats history in a print
  // view and embeds future milestones in tooltips, neither of which is an action.
  const section = html.split(/id=["']HistorySection["']/i)[1] ?? "";
  const table = /<table\b[^>]*>([\s\S]*?)<\/table>/i.exec(section)?.[1] ?? "";
  const actions = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].flatMap((row) => {
    const cells = [...row[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
    if (cells.length < 2) return [];
    const wording = plain(cells[cells.length - 1]![1]!);
    if (!wording) return [];
    return [{ wording, actionAt: paSourceDate(wording), sourceUrl: officialUrl + "#HistorySection" }];
  });
  return {
    kind: "policy-background" as const, publicationAuthorized: false,
    observedAt, officialUrl, record, synopsis: paBillSynopsis(html), actions,
    historyOutcome: !actions.length ? "unavailable" : actions.some(a => !a.actionAt) ? "incomplete" : "complete",
    statusLabel: "Latest official action at observation time—not a fresh-news publication or a finding of enactment",
    blockers: [record.blocker, !actions.length ? "official-action-history-unavailable" : null,
      actions.some(a => !a.actionAt) ? "historical-action-date-unavailable" : null].filter(Boolean),
  };
}

export type PolicyTimingObservation = {
  developmentId: string; discoveredAt: string; candidateId: string | null;
  fingerprint: string | null; stage: string;
  milestone: { fingerprint: string; outcome: "brief" | "blocker"; rule: string; citations: Array<{ name?: string; url: string }>; recordedAt: string } | null;
  /** Requires evidence of a new official development, not a new scrape or slug. */
  newDevelopmentEvidence: string[];
};

/** No timestamp rewriting, age clamping, or defaulting a missing decision. */
export function prospectivePolicyTiming(rows: PolicyTimingObservation[], start: string, asOf: string) {
  const begin = Date.parse(start), end = Date.parse(asOf);
  if (!Number.isFinite(begin) || !Number.isFinite(end) || end < begin) throw Error("Invalid timing window");
  const seen = new Set<string>();
  const observations = rows.map(row => {
    if (seen.has(row.developmentId)) throw Error("Duplicate development observation");
    seen.add(row.developmentId);
    const discovered = Date.parse(row.discoveredAt);
    if (!Number.isFinite(discovered) || discovered > end) throw Error("Invalid discovery timestamp");
    const m = row.milestone;
    const milestoneAt = m ? Date.parse(m.recordedAt) : NaN;
    const httpsCitation = (value: unknown) => {
      if (typeof value !== "string") return false;
      try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
    };
    const supported = Boolean(row.candidateId && row.fingerprint && m &&
      (m.outcome === "brief" || m.outcome === "blocker") &&
      m.fingerprint === row.fingerprint && typeof m.rule === "string" && m.rule.trim() &&
      Array.isArray(m.citations) && m.citations.some(c => c && typeof c === "object" && httpsCitation(c.url)) &&
      Number.isFinite(milestoneAt) && milestoneAt >= discovered && milestoneAt <= end);
    const eligible = discovered >= begin && Array.isArray(row.newDevelopmentEvidence) && row.newDevelopmentEvidence.some(httpsCitation);
    return { ...row, eligible, supportedMilestone: supported,
      completedSeconds: eligible && supported ? (milestoneAt - discovered) / 1000 : null,
      excludedCurrentFingerprintSeconds: !eligible && supported ? (milestoneAt - discovered) / 1000 : null,
      unresolvedAgeSeconds: supported ? null : (end - discovered) / 1000,
      meetsTwoHours: eligible && supported ? milestoneAt - discovered <= 7_200_000 : null,
      exclusion: eligible ? null : discovered < begin ? "historical-discovery" : "new-development-not-established" };
  });
  return { start, asOf, observations, eligibleSamples: observations.filter(r => r.eligible).length,
    historicalMissSeconds: 8239.929,
    sustainedAcceptance: "not-established-by-a-single-sample-or-empty-cohort",
    definition: "Discovery to current-fingerprint cited brief or supported blocker; unresolved age is not completed duration.",
    productionMutation: false };
}
