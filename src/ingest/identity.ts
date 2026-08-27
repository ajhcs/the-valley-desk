import type { ContentItem } from "../content/schema";

const TRACKING_PARAMS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
  "utm_id", "utm_name", "utm_reader", "fbclid", "gclid", "gclsrc", "dclid",
  "msclkid", "mc_cid", "mc_eid", "igshid", "_hsenc", "_hsmi", "ncid",
  "ref", "referrer", "source", "spm",
]);

export type SourceDiscovery = {
  origin: string;
  url?: string;
};

export type IdentityGroup = {
  item: ContentItem;
  identity: string;
  discoveries: SourceDiscovery[];
};

/** Canonical source URL: https, no www, no tracker params, no hash, no trailing slash. */
export function normalizeSourceUrl(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    url.protocol = "https:";
    url.username = "";
    url.password = "";
    url.hostname = url.hostname.replace(/^www\./i, "").toLowerCase();
    if (url.port === "443" || url.port === "80") url.port = "";
    url.hash = "";
    const kept = [...url.searchParams.entries()]
      .filter(([key]) => !TRACKING_PARAMS.has(key.toLowerCase()))
      .sort(([left], [right]) => left.localeCompare(right) || 0);
    url.search = "";
    for (const [key, value] of kept) url.searchParams.append(key, value);
    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

export function sourceIdentityKey(item: {
  id: string;
  kind?: string;
  source: { origin: string; url?: string; externalId?: string };
}): string {
  if (item.kind === "event" && item.source.externalId) {
    return `ext:${item.source.origin}:${item.source.externalId}`;
  }
  const normalized = normalizeSourceUrl(item.source.url);
  if (normalized) return `url:${normalized}`;
  if (item.source.externalId) return `ext:${item.source.origin}:${item.source.externalId}`;
  return `id:${item.id}`;
}

export function withCanonicalSource<T extends ContentItem>(item: T): T {
  const url = normalizeSourceUrl(item.source.url);
  const citations = item.citations?.map((citation) => {
    const citationUrl = normalizeSourceUrl(citation.url);
    return citationUrl && citationUrl !== citation.url ? { ...citation, url: citationUrl } : citation;
  });
  if ((!url || url === item.source.url) && citations === item.citations) return item;
  return {
    ...item,
    source: url ? { ...item.source, url } : item.source,
    ...(citations ? { citations } : {}),
  };
}

export function mergeDiscoveryProvenance<T extends ContentItem>(canonical: T, extra: ContentItem): T {
  const citations = [...(canonical.citations ?? [])];
  const seen = new Set(citations.map((citation) => `${citation.name}\0${citation.url}`));
  const add = (name: string, url: string | undefined) => {
    if (!url || !url.startsWith("https://")) return;
    const key = `${name}\0${url}`;
    if (seen.has(key)) return;
    seen.add(key);
    citations.push({ name, url });
  };
  for (const citation of extra.citations ?? []) add(citation.name, citation.url);
  if (extra.source.origin !== canonical.source.origin) add(extra.source.origin, extra.source.url);
  return citations.length ? { ...canonical, citations } : canonical;
}

export function discoveryOrigins(item: ContentItem): SourceDiscovery[] {
  const identityUrl = normalizeSourceUrl(item.source.url);
  const out: SourceDiscovery[] = [{ origin: item.source.origin, url: item.source.url }];
  const seen = new Set([item.source.origin]);
  for (const citation of item.citations ?? []) {
    if (seen.has(citation.name)) continue;
    if (identityUrl && normalizeSourceUrl(citation.url) !== identityUrl) continue;
    seen.add(citation.name);
    out.push({ origin: citation.name, url: citation.url });
  }
  return out;
}

/**
 * Same canonical source collapses to one candidate. The first item keeps its
 * id unless a later copy already carries a published identity we must retain.
 */
export function collapseBySourceIdentity(items: ContentItem[]): IdentityGroup[] {
  const groups = new Map<string, IdentityGroup>();
  const order: string[] = [];
  for (const raw of items) {
    const item = withCanonicalSource(raw);
    const identity = sourceIdentityKey(item);
    const existing = groups.get(identity);
    if (!existing) {
      groups.set(identity, {
        item,
        identity,
        discoveries: discoveryOrigins(item),
      });
      order.push(identity);
      continue;
    }
    existing.item = mergeDiscoveryProvenance(existing.item, item);
    for (const discovery of discoveryOrigins(item)) {
      if (existing.discoveries.some((row) => row.origin === discovery.origin)) continue;
      existing.discoveries.push(discovery);
    }
  }
  return order.map((identity) => groups.get(identity)!);
}
