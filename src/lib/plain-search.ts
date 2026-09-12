type SearchValue = string | string[];
const RESERVED_KEYS = new Set(["__proto__", "prototype", "constructor"]);

/** Public list queries are literal HTTP fields, not JSON-encoded application state. */
export function parsePlainSearch(search: string): Record<string, SearchValue> {
  const values: Record<string, SearchValue> = Object.create(null);
  let reserved = false;
  for (const [key, value] of new URLSearchParams(search)) {
    if (RESERVED_KEYS.has(key)) { reserved = true; continue; }
    const current = values[key];
    if (current === undefined) values[key] = value;
    else if (Array.isArray(current)) current.push(value);
    else values[key] = [current, value];
  }
  // Keep invalid URLs invalid after router normalization without retaining reserved values.
  if (reserved) values.invalid_search_field = "reserved-field";
  return values;
}

function scalar(value: unknown): string {
  if (typeof value === "string" || typeof value === "boolean") return String(value);
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new TypeError("Search fields must be finite scalar values or arrays of scalar values.");
}

/** Preserve repeated keys so each surface can reject duplicates rather than losing them. */
export function stringifyPlainSearch(values: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (RESERVED_KEYS.has(key)) throw new TypeError("Reserved search field.");
    if (value === undefined) continue;
    for (const entry of Array.isArray(value) ? value : [value]) params.append(key, scalar(entry));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}
