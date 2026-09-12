import { LicenseClassification, PolicyLifecycle, TechnologyResourceType, WatchId, WatchJurisdiction } from "./watch-schema";

export type WatchKind = "policy" | "technology";
export type WatchQueryKey = "q" | "jurisdiction" | "stage" | "type" | "organization" | "license" | "limit" | "cursor";
export type WatchQueryValues = Partial<Record<WatchQueryKey, string>>;
export type WatchQuery = { values: WatchQueryValues; errors: string[]; active: boolean };
export const WATCH_QUERY_TEXT_LIMIT = 120;
export const WATCH_CURSOR_LIMIT = 2048;
export const WATCH_PAGE_LIMIT = 50;

const KEYS: Record<WatchKind, readonly WatchQueryKey[]> = {
  policy: ["q", "jurisdiction", "stage", "limit", "cursor"],
  technology: ["q", "type", "organization", "license", "limit", "cursor"],
};
const LABELS: Record<WatchQueryKey, string> = {
  q: "Search", jurisdiction: "Jurisdiction", stage: "Lifecycle", type: "Resource type",
  organization: "Organization", license: "License", limit: "Page size", cursor: "Page cursor",
};

/** The HTTP and browser grammars are literal scalars, never JSON-decoded query values. */
export function parseWatchQuery(search: string | URLSearchParams, kind: WatchKind): WatchQuery {
  const params = new URLSearchParams(search);
  const values: WatchQueryValues = {};
  const errors: string[] = [];
  if (params.toString().length > 16_384) return { values, errors: ["The filter URL is too long."], active: true };
  for (const key of new Set(params.keys())) {
    if (!KEYS[kind].includes(key as WatchQueryKey)) errors.push("The URL contains an unsupported filter.");
  }
  for (const key of KEYS[kind]) {
    const entries = params.getAll(key);
    if (entries.length > 1) errors.push(`${LABELS[key]} must appear only once.`);
    const raw = entries[0];
    if (raw === undefined || raw === "") continue;
    const hasControls = /[\u0000-\u001f\u007f]/.test(raw);
    if (hasControls) errors.push(`${LABELS[key]} contains unsupported characters.`);
    const value = key === "cursor" || key === "limit" ? raw : raw.trim();
    if (!value) continue;
    const maximum = key === "cursor" ? WATCH_CURSOR_LIMIT : key === "organization" ? 240 : WATCH_QUERY_TEXT_LIMIT;
    values[key] = value.slice(0, maximum);
    if (value.length > maximum) {
      errors.push(`${LABELS[key]} must be ${maximum} characters or fewer.`);
    } else if (key === "jurisdiction" && !WatchJurisdiction.safeParse(value).success) {
      errors.push("Choose a supported jurisdiction.");
    } else if (key === "stage" && !PolicyLifecycle.safeParse(value).success) {
      errors.push("Choose a supported policy lifecycle.");
    } else if (key === "type" && !TechnologyResourceType.safeParse(value).success) {
      errors.push("Choose a supported resource type.");
    } else if (key === "license" && !LicenseClassification.safeParse(value).success) {
      errors.push("Choose a supported license classification.");
    } else if (key === "organization" && !WatchId.safeParse(value).success) {
      errors.push("Organization must be a valid organization ID.");
    } else if (key === "limit" && (!/^[1-9]\d?$/.test(value) || Number(value) > WATCH_PAGE_LIMIT)) {
      errors.push(`Page size must be an integer from 1 to ${WATCH_PAGE_LIMIT}.`);
    }
  }
  return { values, errors: [...new Set(errors)], active: errors.length > 0 ||
    Object.keys(values).some(key => key !== "cursor" && key !== "limit") };
}

/** Filter changes drop the cursor. Pagination must explicitly opt into the next cursor. */
export function watchQuerySearch(values: WatchQueryValues, kind: WatchKind, cursor?: string): Record<string, string> {
  const search: Record<string, string> = {};
  for (const key of KEYS[kind]) {
    if (key === "cursor") continue;
    const value = values[key]?.trim();
    if (value) search[key] = value;
  }
  if (cursor) search.cursor = cursor;
  const parsed = parseWatchQuery(new URLSearchParams(search), kind);
  if (parsed.errors.length) throw new TypeError("Invalid Watch filter values");
  return search;
}

export function watchDirectoryPath(kind: WatchKind, values: WatchQueryValues = {}, cursor?: string) {
  const query = new URLSearchParams(watchQuerySearch(values, kind, cursor));
  const path = kind === "policy" ? "/policy-watch" : "/technology-watch";
  return query.size ? `${path}?${query.toString()}` : path;
}

export function isWatchSlug(value: string): boolean {
  return value !== "updates" && value.length <= 100 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}
