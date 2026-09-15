/** Legacy archive URLs remain separate from the current Watch sections. */
export function navSection(pathname: string): "news" | "events" | "voices" | "policy-watch" | "technology-watch" | null {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/policy-watch" || p.startsWith("/policy-watch/")) return "policy-watch";
  if (p === "/technology-watch" || p.startsWith("/technology-watch/")) return "technology-watch";
  if (p === "/voices" || p.startsWith("/voices/")) return "voices";
  if (p === "/events" || p.startsWith("/events/")) return "events";
  if (p === "/news" || p.startsWith("/news/")) return "news";
  return null;
}
