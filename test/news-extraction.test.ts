import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_EDITOR_MODEL } from "../src/ingest/editor-model.ts";
import { sourceIdentityKey } from "../src/ingest/identity.ts";
import {
  NEWS_ARTICLE_CANDIDATE_CAP,
  NEWS_ARTICLE_CONCURRENCY,
  NEWS_ARTICLE_MAX_BYTES,
  NEWS_ARTICLE_MAX_REDIRECTS,
  NEWS_ARTICLE_MIN_CHARS,
  NEWS_ARTICLE_TIMEOUT_MS,
} from "../src/ingest/news-extraction-config.ts";
import {
  extractArticleText,
  isEligibleNewsArticleUrl,
  newsArticleBackoffMs,
  overlayNewsArticles,
  rssArticleHostAllowlist,
  selectFairNewsArticleCandidates,
  type NewsArticleExtractionState,
} from "../src/ingest/news-extraction.ts";
import { RSS_SOURCES, ingestRssWithHealth, rssItemToContent } from "../src/ingest/rss.ts";

const EMPTY_RSS = `<?xml version="1.0"?><rss><channel></channel></rss>`;
const ARTICLE_URL = "https://news.christianacare.org/epic-workflow-update";
const ALLOWED_HOSTS = rssArticleHostAllowlist();

function rssFeed(items: Array<{ title: string; link: string; description?: string; guid?: string; pubDate?: string }>) {
  const rows = items.map((item) => (
    `<item><title>${item.title}</title><link>${item.link}</link><guid>${item.guid ?? item.link}</guid><description>${item.description ?? "Short dek."}</description><pubDate>${item.pubDate ?? "Wed, 26 Aug 2026 12:00:00 GMT"}</pubDate></item>`
  )).join("");
  return `<?xml version="1.0"?><rss><channel>${rows}</channel></rss>`;
}

function longText(label: string, min = NEWS_ARTICLE_MIN_CHARS) {
  const unit = `${label} continues across the regional health-system operating change. `;
  return unit.repeat(Math.ceil(min / unit.length) + 1).trim();
}

function articlePage(body: string, extra = "") {
  return `<!doctype html><html><head>${extra}</head><body>${body}</body></html>`;
}

function jsonLdScript(payload: unknown) {
  return `<script type="application/ld+json">${JSON.stringify(payload)}</script>`;
}

function articleItem(link = ARTICLE_URL) {
  return rssItemToContent({
    title: "Redirected article",
    link,
    description: "RSS dek.",
    pubDate: "Wed, 26 Aug 2026 12:00:00 GMT",
    guid: link,
  }, "ChristianaCare News · Information Technology", "2026-08-26T12:00:00.000Z");
}

function isRegistryFeedUrl(url: string) {
  return RSS_SOURCES.some((source) => source.url === url || source.fallbacks?.includes(url));
}

function feedAwareFetch(handlers: (url: string) => Response | undefined): typeof fetch {
  return async (input) => {
    const url = String(input);
    const handled = handlers(url);
    if (handled) return handled;
    if (isRegistryFeedUrl(url)) return new Response(EMPTY_RSS, { status: 200 });
    return new Response("", { status: 503 });
  };
}

test("runtime editor model remains Muse Spark 1.2 Contributor", () => {
  assert.equal(DEFAULT_EDITOR_MODEL, "meta/muse-spark-1.2-contributor");
});

test("news extraction caps stay bounded and closed", () => {
  assert.equal(NEWS_ARTICLE_CANDIDATE_CAP, 8);
  assert.equal(NEWS_ARTICLE_CONCURRENCY, 2);
  assert.ok(NEWS_ARTICLE_MAX_BYTES <= 512_000);
  assert.ok(NEWS_ARTICLE_TIMEOUT_MS <= 8_000);
  assert.ok(NEWS_ARTICLE_MAX_REDIRECTS <= 3);
  assert.ok(ALLOWED_HOSTS.has("news.christianacare.org"));
  assert.ok(ALLOWED_HOSTS.has("inquirer.com"));
  assert.ok(!ALLOWED_HOSTS.has("example.com"));
});

test("JSON-LD articleBody wins over article and main fallbacks", () => {
  const jsonLdBody = longText("JSON-LD Jefferson Health articleBody");
  const html = articlePage(
    `<main>${longText("Main landmark text")}</main><article>${longText("Article landmark text")}</article>`,
    jsonLdScript({
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      articleBody: jsonLdBody,
    }),
  );
  const extracted = extractArticleText(html);
  assert.equal(extracted?.method, "json-ld");
  assert.ok(extracted?.text.includes("JSON-LD Jefferson Health articleBody"));
  assert.ok(!extracted?.text.includes("Article landmark text"));
});

test("JSON-LD @graph articleBody is discovered", () => {
  const html = articlePage("<main>too short</main>", jsonLdScript({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", name: "Newsroom" },
      { "@type": ["NewsArticle"], articleBody: longText("Graph-hosted articleBody names Penn Medicine") },
    ],
  }));
  const extracted = extractArticleText(html);
  assert.equal(extracted?.method, "json-ld");
  assert.ok(extracted?.text.includes("Penn Medicine"));
});

test("article landmark is used when JSON-LD articleBody is absent", () => {
  const html = articlePage(`<main>${longText("Main fallback")}</main><article><p>${longText("Visible article copy")}</p><script>ignored()</script></article>`);
  const extracted = extractArticleText(html);
  assert.equal(extracted?.method, "article");
  assert.ok(extracted?.text.includes("Visible article copy"));
  assert.ok(!extracted?.text.includes("ignored()"));
});

test("main landmark is used when article is missing", () => {
  const html = articlePage(`<main><p>${longText("Main landmark copy")}</p></main>`);
  const extracted = extractArticleText(html);
  assert.equal(extracted?.method, "main");
  assert.ok(extracted?.text.includes("Main landmark copy"));
});

test("HTTPS host allowlist rejects feed URLs, http, and off-host pages", () => {
  assert.equal(isEligibleNewsArticleUrl(ARTICLE_URL, ALLOWED_HOSTS), ARTICLE_URL);
  assert.equal(
    isEligibleNewsArticleUrl("http://news.christianacare.org/epic-workflow-update", ALLOWED_HOSTS),
    ARTICLE_URL,
  );
  assert.equal(isEligibleNewsArticleUrl("https://example.com/not-allowlisted", ALLOWED_HOSTS), undefined);
  assert.equal(
    isEligibleNewsArticleUrl("https://news.christianacare.org/category/information-technology/feed/", ALLOWED_HOSTS),
    undefined,
  );
  assert.equal(
    isEligibleNewsArticleUrl("https://inquirer.com/arc/outboundfeeds/rss/category/health/?outputType=xml", ALLOWED_HOSTS),
    undefined,
  );
  assert.equal(
    isEligibleNewsArticleUrl(ARTICLE_URL, ALLOWED_HOSTS, new Set([ARTICLE_URL])),
    undefined,
  );
});

test("RSS ingest extracts JSON-LD for a new allowlisted article and remaps orgs", async () => {
  const requested: string[] = [];
  const articleBody = longText("ChristianaCare and Jefferson Health jointly deployed the workflow");
  const result = await ingestRssWithHealth(new Date("2026-08-26T12:00:00.000Z"), feedAwareFetch((url) => {
    requested.push(url);
    if (url.includes("news.christianacare.org") && url.includes("/feed/")) {
      return new Response(rssFeed([{
        title: "Workflow update",
        link: ARTICLE_URL,
        description: "Epic workflow deployment.",
      }]), { status: 200 });
    }
    if (url === ARTICLE_URL) {
      return new Response(articlePage("<article>too short</article>", jsonLdScript({
        "@type": "NewsArticle",
        articleBody,
      })), { status: 200, headers: { "content-type": "text/html" } });
    }
    return undefined;
  }));

  assert.equal(result.items.length, 1);
  const item = result.items[0]!;
  assert.equal(item.source.url, ARTICLE_URL);
  assert.equal(item.id, rssItemToContent({
    title: "Workflow update",
    link: ARTICLE_URL,
    description: "Epic workflow deployment.",
    pubDate: "Wed, 26 Aug 2026 12:00:00 GMT",
    guid: ARTICLE_URL,
  }, "ChristianaCare News · Information Technology", "2026-08-26T12:00:00.000Z").id);
  assert.ok(item.body.includes("Jefferson Health jointly deployed"));
  assert.ok(item.orgs.includes("org-christianacare"));
  assert.ok(item.orgs.includes("org-jefferson"));
  assert.equal(item.status, "review");
  assert.ok(requested.includes(ARTICLE_URL));
  const rssHealth = result.sources.find((source) => source.id === "christianacare-information-technology");
  assert.equal(rssHealth?.state, "healthy");
  assert.equal(rssHealth?.itemCount, 1);
});

test("article fetch failures keep RSS discovery, identity, and source-health", async () => {
  const result = await ingestRssWithHealth(new Date("2026-08-26T12:00:00.000Z"), feedAwareFetch((url) => {
    if (url.includes("news.christianacare.org") && url.includes("/feed/")) {
      return new Response(rssFeed([{
        title: "Workflow update",
        link: ARTICLE_URL,
        description: "Epic workflow deployment.",
        guid: "workflow-update",
      }]), { status: 200 });
    }
    if (url === ARTICLE_URL) return new Response("", { status: 503 });
    return undefined;
  }));
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.body, "Epic workflow deployment.");
  assert.equal(result.items[0]?.source.url, ARTICLE_URL);
  assert.equal(result.sources.find((source) => source.id === "christianacare-information-technology")?.state, "healthy");
});

test("off-allowlist article URLs are never fetched", async () => {
  const requested: string[] = [];
  const offHost = "https://example.com/arbitrary-crawl";
  const result = await ingestRssWithHealth(new Date("2026-08-26T12:00:00.000Z"), async (input) => {
    const url = String(input);
    requested.push(url);
    if (url.includes("news.christianacare.org") && url.includes("/feed/")) {
      return new Response(rssFeed([{ title: "Off-host item", link: offHost, description: "dek" }]), { status: 200 });
    }
    if (isRegistryFeedUrl(url)) return new Response(EMPTY_RSS, { status: 200 });
    return new Response("should not fetch", { status: 200 });
  });
  assert.equal(result.items.length, 1);
  assert.ok(!requested.includes(offHost));
  assert.ok(requested.every((url) => !url.includes("example.com")));
});

test("already-seen URLs and duplicate identities are not re-fetched", async () => {
  const articleRequests: string[] = [];
  const health = "https://inquirer.com/health/shared-story";
  const result = await ingestRssWithHealth(new Date("2026-08-26T12:00:00.000Z"), feedAwareFetch((url) => {
    if (url.includes("inquirer.com") && url.includes("health") && url.includes("outboundfeeds")) {
      return new Response(rssFeed([{ title: "Shared", link: `${health}?utm_source=health`, description: "Health dek." }]), { status: 200 });
    }
    if (url.includes("inquirer.com") && url.includes("business") && url.includes("outboundfeeds")) {
      return new Response(rssFeed([{ title: "Shared", link: `${health}/`, description: "Business dek." }]), { status: 200 });
    }
    if (url === health) {
      articleRequests.push(url);
      return new Response(articlePage(`<article>${longText("Full Inquirer article names Penn Medicine")}</article>`), { status: 200 });
    }
    return undefined;
  }), { knownSourceUrls: new Set(["https://news.christianacare.org/already-seen"]) });
  assert.equal(result.items.filter((item) => item.source.url === health).length, 1);
  assert.equal(articleRequests.length, 1);
  assert.equal(sourceIdentityKey(result.items[0]!), `url:${health}`);
});

test("known source URLs skip article extraction", async () => {
  const requested: string[] = [];
  const result = await ingestRssWithHealth(new Date("2026-08-26T12:00:00.000Z"), feedAwareFetch((url) => {
    requested.push(url);
    if (url.includes("news.christianacare.org") && url.includes("/feed/")) {
      return new Response(rssFeed([{ title: "Already seen", link: ARTICLE_URL, description: "RSS dek." }]), { status: 200 });
    }
    return undefined;
  }), { knownSourceUrls: new Set([ARTICLE_URL]) });
  assert.equal(result.items[0]?.body, "RSS dek.");
  assert.ok(!requested.includes(ARTICLE_URL));
});

test("candidate cap and concurrency bounds apply only to article fetches", async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const articleUrls: string[] = [];
  const items = Array.from({ length: 12 }, (_, index) => ({
    title: `Story ${index + 1}`,
    link: `https://news.christianacare.org/story-${index + 1}`,
    description: "RSS dek.",
    pubDate: `Wed, ${26 - index} Aug 2026 12:00:00 GMT`,
  }));
  const result = await overlayNewsArticles(
    items.map((raw, index) => rssItemToContent(raw, "ChristianaCare News · Information Technology", "2026-08-26T12:00:00.000Z", index)),
    {
      allowedHosts: ALLOWED_HOSTS,
      fetchImpl: async (input) => {
        const url = String(input);
        articleUrls.push(url);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 15));
        inFlight -= 1;
        return new Response(articlePage(`<article>${longText(`Full page for ${url}`)}</article>`), { status: 200 });
      },
    },
  );
  assert.equal(articleUrls.length, NEWS_ARTICLE_CANDIDATE_CAP);
  assert.ok(maxInFlight <= NEWS_ARTICLE_CONCURRENCY);
  assert.equal(result.items.length, 12);
  assert.equal(result.items.filter((item) => item.body.startsWith("Full page for ")).length, NEWS_ARTICLE_CANDIDATE_CAP);
  assert.equal(result.items.filter((item) => item.body === "RSS dek.").length, 12 - NEWS_ARTICLE_CANDIDATE_CAP);
});

test("off-allowlist redirects are not followed", async () => {
  const requested: string[] = [];
  await overlayNewsArticles([
    rssItemToContent({
      title: "Redirected",
      link: ARTICLE_URL,
      description: "RSS dek.",
      pubDate: "Wed, 26 Aug 2026 12:00:00 GMT",
      guid: ARTICLE_URL,
    }, "ChristianaCare News · Information Technology", "2026-08-26T12:00:00.000Z"),
  ], {
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: async (input) => {
      const url = String(input);
      requested.push(url);
      if (url === ARTICLE_URL) {
        return new Response(null, { status: 302, headers: { location: "https://evil.example/phish" } });
      }
      return new Response("followed off-allowlist", { status: 200 });
    },
  });
  assert.deepEqual(requested, [ARTICLE_URL]);
});

test("same-host trailing-slash redirects preserve the server target", async () => {
  const requested: string[] = [];
  const slashUrl = `${ARTICLE_URL}/`;
  const result = await overlayNewsArticles([articleItem()], {
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: async (input) => {
      const url = String(input);
      requested.push(url);
      if (url === ARTICLE_URL) {
        return new Response(null, { status: 301, headers: { location: "/epic-workflow-update/" } });
      }
      if (url === slashUrl) {
        return new Response(articlePage(`<article>${longText("Full redirected article")}</article>`), {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      return new Response("unexpected", { status: 500 });
    },
  });
  assert.deepEqual(requested, [ARTICLE_URL, slashUrl]);
  assert.equal(result.metrics.success, 1);
  assert.equal(result.attempts[0]?.state, "success");
  assert.equal(result.attempts[0]?.url, ARTICLE_URL);
  assert.equal(result.items[0]?.source.url, ARTICLE_URL);
  assert.ok(result.items[0]?.body.includes("Full redirected article"));
});

test("www redirects remain allowlisted without being rewritten to the apex", async () => {
  const apexUrl = "https://inquirer.com/health/redirected-story";
  const wwwUrl = "https://www.inquirer.com/health/redirected-story";
  const requested: string[] = [];
  const result = await overlayNewsArticles([articleItem(apexUrl)], {
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: async (input) => {
      const url = String(input);
      requested.push(url);
      if (url === apexUrl) return new Response(null, { status: 302, headers: { location: wwwUrl } });
      if (url === wwwUrl) {
        return new Response(articlePage(`<main>${longText("Inquirer redirected body")}</main>`), {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      return new Response("unexpected", { status: 500 });
    },
  });
  assert.deepEqual(requested, [apexUrl, wwwUrl]);
  assert.equal(result.metrics.success, 1);
  assert.equal(result.attempts[0]?.url, apexUrl);
  assert.equal(result.items[0]?.source.url, apexUrl);
});

test("same-host cleartext redirect targets are upgraded without an HTTP request", async () => {
  const requested: string[] = [];
  const slashUrl = `${ARTICLE_URL}/`;
  const result = await overlayNewsArticles([articleItem()], {
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: async (input) => {
      const url = String(input);
      requested.push(url);
      if (url === ARTICLE_URL) {
        return new Response(null, { status: 301, headers: { location: `http://news.christianacare.org/epic-workflow-update/` } });
      }
      return new Response(articlePage(`<article>${longText("Safely upgraded article")}</article>`), {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    },
  });
  assert.deepEqual(requested, [ARTICLE_URL, slashUrl]);
  assert.ok(requested.every((url) => url.startsWith("https://")));
  assert.equal(result.metrics.success, 1);
});

test("redirect validation rejects cross-host cleartext, feed-shaped, and non-default-port targets", async () => {
  for (const location of [
    "http://whyy.org/unsafe/",
    "http://news.christianacare.org:8080/unsafe/",
    "https://news.christianacare.org/feed/",
    "https://news.christianacare.org:8443/article/",
    "https://user:pass@news.christianacare.org/article/",
    "https://news.christianacare.org.evil.example/article/",
    "//evil.example/article/",
    "javascript:alert(1)",
    "data:text/html,unsafe",
  ]) {
    const requested: string[] = [];
    const result = await overlayNewsArticles([articleItem()], {
      allowedHosts: ALLOWED_HOSTS,
      fetchImpl: async (input) => {
        requested.push(String(input));
        return new Response(null, { status: 301, headers: { location } });
      },
    });
    assert.deepEqual(requested, [ARTICLE_URL]);
    assert.equal(result.attempts[0]?.error, "Redirect left allowlist");
  }
});

test("redirect cycles fail immediately within the fixed hop budget", async () => {
  const requested: string[] = [];
  const result = await overlayNewsArticles([articleItem()], {
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: async (input) => {
      const url = String(input);
      requested.push(url);
      return new Response(null, { status: 301, headers: { location: url } });
    },
  });
  assert.deepEqual(requested, [ARTICLE_URL]);
  assert.equal(result.attempts[0]?.error, "Too many redirects");
});

test("multi-URL redirect cycles are detected before repeating a request", async () => {
  const requested: string[] = [];
  const second = `${ARTICLE_URL}/second`;
  const result = await overlayNewsArticles([articleItem()], {
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: async (input) => {
      const url = String(input);
      requested.push(url);
      return new Response(null, {
        status: 302,
        headers: { location: url === ARTICLE_URL ? second : ARTICLE_URL },
      });
    },
  });
  assert.deepEqual(requested, [ARTICLE_URL, second]);
  assert.equal(result.attempts[0]?.error, "Too many redirects");
});

test("unique redirect chains cannot exceed the fixed hop budget", async () => {
  const requested: string[] = [];
  const result = await overlayNewsArticles([articleItem()], {
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: async (input) => {
      const url = String(input);
      requested.push(url);
      const next = `${ARTICLE_URL}/hop-${requested.length}`;
      return new Response(null, { status: 302, headers: { location: next } });
    },
  });
  assert.equal(requested.length, NEWS_ARTICLE_MAX_REDIRECTS + 1);
  assert.equal(new Set(requested).size, requested.length);
  assert.equal(result.attempts[0]?.error, "Too many redirects");
});

test("non-redirect 3xx statuses do not follow Location", async () => {
  const requested: string[] = [];
  const result = await overlayNewsArticles([articleItem()], {
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: async (input) => {
      requested.push(String(input));
      return new Response(null, { status: 304, headers: { location: `${ARTICLE_URL}/` } });
    },
  });
  assert.deepEqual(requested, [ARTICLE_URL]);
  assert.equal(result.attempts[0]?.error, "HTTP 304");
});

test("oversized article responses stay on the RSS snippet", async () => {
  const result = await overlayNewsArticles([
    rssItemToContent({
      title: "Huge page",
      link: ARTICLE_URL,
      description: "RSS dek.",
      pubDate: "Wed, 26 Aug 2026 12:00:00 GMT",
      guid: ARTICLE_URL,
    }, "ChristianaCare News · Information Technology", "2026-08-26T12:00:00.000Z"),
  ], {
    allowedHosts: ALLOWED_HOSTS,
    fetchImpl: async () => new Response("x".repeat(NEWS_ARTICLE_MAX_BYTES + 1), {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
  });
  const [item] = result.items;
  assert.equal(item?.body, "RSS dek.");
});

test("durable extraction cache reuses bounded text until the refresh is due", async () => {
  const cachedText = longText("Cached full article");
  const item = rssItemToContent({
    title: "Cached article",
    link: ARTICLE_URL,
    description: "RSS dek.",
    pubDate: "Wed, 26 Aug 2026 12:00:00 GMT",
    guid: ARTICLE_URL,
  }, "ChristianaCare News · Information Technology", "2026-08-27T12:00:00.000Z");
  const state: NewsArticleExtractionState = {
    url: ARTICLE_URL,
    state: "success",
    cachedText,
    method: "article",
    attemptCount: 1,
    lastAttemptedAt: "2026-08-26T12:00:00.000Z",
    lastSuccessAt: "2026-08-26T12:00:00.000Z",
    nextAttemptAt: "2026-09-02T12:00:00.000Z",
  };
  let fetches = 0;
  const result = await overlayNewsArticles([item], {
    allowedHosts: ALLOWED_HOSTS,
    newsExtractions: new Map([[ARTICLE_URL, state]]),
    now: new Date("2026-08-27T12:00:00.000Z"),
    fetchImpl: async () => {
      fetches += 1;
      throw new Error("not due");
    },
  });
  assert.equal(fetches, 0);
  assert.equal(result.items[0]?.body, cachedText);
  assert.equal(result.attempts.length, 0);
  assert.equal(result.metrics.reused, 1);
});

test("failed due refresh preserves stale cache and records bounded retry backoff", async () => {
  const cachedText = longText("Previously extracted article");
  const item = rssItemToContent({
    title: "Updated article",
    link: ARTICLE_URL,
    description: "RSS dek.",
    pubDate: "Wed, 26 Aug 2026 12:00:00 GMT",
    guid: ARTICLE_URL,
  }, "ChristianaCare News · Information Technology", "2026-08-27T12:00:00.000Z");
  const previous: NewsArticleExtractionState = {
    url: ARTICLE_URL,
    state: "success",
    cachedText,
    method: "json-ld",
    attemptCount: 1,
    lastAttemptedAt: "2026-08-20T12:00:00.000Z",
    lastSuccessAt: "2026-08-20T12:00:00.000Z",
    nextAttemptAt: "2026-08-27T12:00:00.000Z",
  };
  const now = new Date("2026-08-27T12:00:00.000Z");
  const result = await overlayNewsArticles([item], {
    allowedHosts: ALLOWED_HOSTS,
    newsExtractions: new Map([[ARTICLE_URL, previous]]),
    now,
    fetchImpl: async () => new Response("upstream error", { status: 503 }),
  });
  assert.equal(result.items[0]?.body, cachedText);
  assert.equal(result.metrics.failed, 1);
  assert.equal(result.metrics.preserved, 1);
  assert.equal(result.attempts[0]?.state, "failed");
  assert.equal(result.attempts[0]?.cachedText, cachedText);
  assert.equal(
    result.attempts[0]?.nextAttemptAt,
    new Date(now.getTime() + newsArticleBackoffMs("failed", 1)).toISOString(),
  );
});

test("a successful page without usable article text records no-content cooldown", async () => {
  const item = rssItemToContent({
    title: "Thin page",
    link: ARTICLE_URL,
    description: "RSS dek.",
    pubDate: "Wed, 26 Aug 2026 12:00:00 GMT",
    guid: ARTICLE_URL,
  }, "ChristianaCare News · Information Technology", "2026-08-27T12:00:00.000Z");
  const result = await overlayNewsArticles([item], {
    allowedHosts: ALLOWED_HOSTS,
    now: new Date("2026-08-27T12:00:00.000Z"),
    fetchImpl: async () => new Response(articlePage("<main>Too short.</main>"), {
      status: 200,
      headers: { "content-type": "text/html" },
    }),
  });
  assert.equal(result.items[0]?.body, "RSS dek.");
  assert.equal(result.metrics.noContent, 1);
  assert.equal(result.attempts[0]?.state, "no-content");
  assert.match(result.attempts[0]?.error ?? "", /No usable article body/);
});

test("fair News selection gives each source a turn before taking a second item", () => {
  const selected = selectFairNewsArticleCandidates([
    { origin: "source-a", publishedAt: 4, index: 0, id: "a1" },
    { origin: "source-a", publishedAt: 3, index: 1, id: "a2" },
    { origin: "source-b", publishedAt: 2, index: 2, id: "b1" },
    { origin: "source-c", publishedAt: 1, index: 3, id: "c1" },
  ], 3);
  assert.deepEqual(selected.map((row) => row.id), ["a1", "b1", "c1"]);
  assert.equal(newsArticleBackoffMs("failed", 99), 7 * 24 * 60 * 60 * 1000);
});
