/** Section for chrome current-state. Voices only on /voices and /voices/*. */
export function navSection(pathname: string): "news" | "events" | "voices" | null {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p === "/voices" || p.startsWith("/voices/")) return "voices";
  if (p === "/events" || p.startsWith("/events/")) return "events";
  if (p === "/news" || p.startsWith("/news/")) return "news";
  return null;
}
