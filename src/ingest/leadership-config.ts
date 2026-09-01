/** Closed bounds for public leadership-page monitoring. LinkedIn is never fetched. */
export const LEADERSHIP_MAX_BYTES = 512_000;
export const LEADERSHIP_MAX_SCAN_BYTES = 2_000_000;
export const LEADERSHIP_TIMEOUT_MS = 8_000;
export const LEADERSHIP_CONCURRENCY = 2;
export const LEADERSHIP_CANDIDATE_CAP = 16;
export const LEADERSHIP_MAX_REDIRECTS = 3;
export const LEADERSHIP_TEXT_MAX_CHARS = 8_000;
export const LEADERSHIP_ERROR_MAX_CHARS = 1_000;
export const LEADERSHIP_SUCCESS_REFRESH_MS = 24 * 60 * 60 * 1000;
export const LEADERSHIP_FAILURE_BASE_MS = 6 * 60 * 60 * 1000;
export const LEADERSHIP_FAILURE_MAX_MS = 7 * 24 * 60 * 60 * 1000;

export const LEADERSHIP_CADENCE_MS = {
  hourly: 60 * 60 * 1000,
  daily: LEADERSHIP_SUCCESS_REFRESH_MS,
  weekly: 7 * 24 * 60 * 60 * 1000,
  inventory: LEADERSHIP_SUCCESS_REFRESH_MS,
} as const;

export const LINKEDIN_BLOCKED_HOSTS = [
  "linkedin.com",
  "www.linkedin.com",
  "lnkd.in",
] as const;

export const SOURCE_KIND_PRECEDENCE = {
  "leadership-page": 100,
  "about-page": 70,
  "person-bio": 60,
  "newsroom-bio": 50,
  "linkedin-organization": 20,
  "linkedin-person": 10,
} as const;
