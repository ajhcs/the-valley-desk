/** Closed, production-safe bounds for News article extraction. RSS discovery stays uncapped. */
export const NEWS_ARTICLE_MAX_BYTES = 512_000;
export const NEWS_ARTICLE_TIMEOUT_MS = 8_000;
export const NEWS_ARTICLE_CONCURRENCY = 2;
export const NEWS_ARTICLE_CANDIDATE_CAP = 8;
export const NEWS_ARTICLE_MIN_CHARS = 280;
export const NEWS_ARTICLE_BODY_MAX_CHARS = 6_000;
export const NEWS_ARTICLE_MAX_REDIRECTS = 3;
export const NEWS_ARTICLE_SUCCESS_REFRESH_MS = 7 * 24 * 60 * 60 * 1000;
export const NEWS_ARTICLE_FAILURE_BASE_MS = 6 * 60 * 60 * 1000;
export const NEWS_ARTICLE_FAILURE_MAX_MS = 7 * 24 * 60 * 60 * 1000;
export const NEWS_ARTICLE_ERROR_MAX_CHARS = 1_000;
