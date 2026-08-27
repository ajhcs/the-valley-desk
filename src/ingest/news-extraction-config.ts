/** Closed, production-safe bounds for News article extraction. RSS discovery stays uncapped. */
export const NEWS_ARTICLE_MAX_BYTES = 512_000;
export const NEWS_ARTICLE_TIMEOUT_MS = 8_000;
export const NEWS_ARTICLE_CONCURRENCY = 2;
export const NEWS_ARTICLE_CANDIDATE_CAP = 8;
export const NEWS_ARTICLE_MIN_CHARS = 280;
export const NEWS_ARTICLE_BODY_MAX_CHARS = 6_000;
export const NEWS_ARTICLE_MAX_REDIRECTS = 3;
