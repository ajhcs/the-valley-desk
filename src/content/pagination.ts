/** Bounded list pages for /news and /voices. Home rails stay separately sliced. */

export const LIST_PAGE_SIZE = 12;

export type PageRequest = {
  raw: string | null;
  page: number;
  invalid: boolean;
};

export type PageWindow<T> = {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  invalid: boolean;
  outOfRange: boolean;
  indexable: boolean;
  prevPage: number | null;
  nextPage: number | null;
};

/** Newest first, then id ascending so equal timestamps never overlap or reshuffle. */
export function compareNewestThenId(
  a: { id: string; publishedAt?: string },
  b: { id: string; publishedAt?: string },
) {
  const byTime = (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "");
  if (byTime !== 0) return byTime;
  return a.id.localeCompare(b.id);
}

/** Missing page is 1. Only canonical positive integers are valid. */
export function parsePageQuery(raw: string | null | undefined): PageRequest {
  if (raw == null || raw === "") return { raw: raw ?? null, page: 1, invalid: false };
  if (!/^[1-9]\d{0,8}$/.test(raw)) return { raw, page: 1, invalid: true };
  return { raw, page: Number(raw), invalid: false };
}

export function pageFromSearch(search: string | null | undefined): PageRequest {
  const trimmed = String(search ?? "");
  const query = new URLSearchParams(trimmed.startsWith("?") ? trimmed.slice(1) : trimmed);
  return parsePageQuery(query.get("page"));
}

export function paginate<T>(
  items: readonly T[],
  request: PageRequest,
  pageSize = LIST_PAGE_SIZE,
): PageWindow<T> {
  const size = Math.max(1, Math.floor(pageSize) || LIST_PAGE_SIZE);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const invalid = request.invalid;
  const outOfRange = !invalid && request.page > totalPages;
  const indexable = !invalid && !outOfRange;
  const page = request.page;
  const slice = indexable ? items.slice((page - 1) * size, page * size) : [];

  let prevPage: number | null = null;
  let nextPage: number | null = null;
  if (indexable) {
    if (page > 1) prevPage = page - 1;
    if (page < totalPages) nextPage = page + 1;
  } else if (outOfRange && total > 0) {
    prevPage = totalPages;
  } else if (invalid) {
    prevPage = 1;
  }

  return {
    items: slice,
    page,
    pageSize: size,
    total,
    totalPages,
    invalid,
    outOfRange,
    indexable,
    prevPage,
    nextPage,
  };
}

export function listPagePath(pathname: string, page: number) {
  const path = pathname || "/";
  if (page <= 1) return path;
  return `${path}?page=${page}`;
}

export function listCanonicalPath(pathname: string, window: PageWindow<unknown>) {
  if (window.invalid) return pathname;
  if (window.outOfRange) return listPagePath(pathname, window.totalPages);
  return listPagePath(pathname, window.page);
}
