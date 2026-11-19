const sections = [
  ["/news", "News"],
  ["/events", "Events"],
  ["/policy-watch", "Policy Watch"],
  ["/technology-watch", "Technology Watch"],
] as const;

export type RetiredEditorialSection = typeof sections[number][1];

const retiredDocuments = new Set(["/feed.json", "/feed.xml", "/api/content", "/events.ics"]);

export function decodedPublicPath(pathname: string): string {
  try { return decodeURIComponent(pathname); }
  catch { return pathname; }
}

export function retiredEditorialRoute(pathname: string):
  { kind: "page"; section: RetiredEditorialSection } | { kind: "data" } | undefined {
  const path = decodedPublicPath(pathname);
  const section = sections.find(([prefix]) => path === prefix || path.startsWith(prefix + "/"));
  if (section) return { kind: "page", section: section[1] };
  if (retiredDocuments.has(path.replace(/\/+$/, "")) || path === "/api/v2/watch" || path.startsWith("/api/v2/watch/")) {
    return { kind: "data" };
  }
}
