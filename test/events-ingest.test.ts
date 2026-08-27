import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluateCandidate } from "../src/ingest/editor.ts";
import {
  DVHIMSS_MAX_PAGES,
  isSafeTribeNextUrl,
  matchKnownNjdvhimssEvents,
  njSnapshotCompleteness,
  parseJsonLdEvents,
  parseNjdvhimssPage,
  parseTribeEventsResponse,
  parseVisibleEventCards,
  tribeNextPageUrl,
  tribeSnapshotCompleteness,
} from "../src/ingest/event-parser.ts";
import { fetchDvhimssCalendar, ingestEventsWithHealth, scrapeNjdvhimss } from "../src/ingest/events.ts";
import { sourceAuthorizesDisappearance } from "../src/ingest/source-health.ts";

const FETCHED_AT = "2026-08-26T12:00:00.000Z";
const TRIBE_ARCHIVE = "https://dvhimss.org/wp-json/tribe/events/v1/events?per_page=100";

function recognizedNj(body: string) {
  return `<html><head><title>NJDVHIMSS</title>
    <link rel="canonical" href="https://njdvhimssevent.com/" />
    </head><body>${body}</body></html>`;
}

function tribeEvent(id: number, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `Chapter Event ${id}`,
    url: `https://dvhimss.org/event/${id}/`,
    utc_start_date: "2026-09-14 13:00:00",
    website: "https://web.cvent.com/event/chapter-forum",
    ...extra,
  };
}

function tribePage(events: unknown[], extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ events, ...extra }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function nextRestUrl(page: number) {
  return `https://dvhimss.org/wp-json/tribe/events/v1/events/?page=${page}&per_page=100`;
}

function eventsFetch(opts: {
  tribe?: (url: string) => Response | Promise<Response>;
  nj?: string;
}) {
  const nj = opts.nj ?? recognizedNj("Season recap");
  return async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("wp-json/tribe")) {
      if (opts.tribe) return opts.tribe(url);
      return tribePage([]);
    }
    return new Response(nj, { status: 200 });
  };
}

function pageNumber(url: string) {
  try {
    return Number(new URL(url).searchParams.get("page") || "1");
  } catch {
    return 1;
  }
}

test("Tribe pagination follows next_rest_url and is complete when metadata says the walk is done", async () => {
  const fetchImpl = eventsFetch({
    tribe(url) {
      const page = pageNumber(url);
      if (page === 1) {
        return tribePage([tribeEvent(1)], {
          total: 2,
          total_pages: 2,
          next_rest_url: nextRestUrl(2),
        });
      }
      if (page === 2) {
        return tribePage([tribeEvent(2)], { total: 2, total_pages: 2 });
      }
      throw new Error(`unexpected page ${url}`);
    },
  });
  const result = await ingestEventsWithHealth(new Date(FETCHED_AT), fetchImpl);
  const dvhimss = result.sources.find((source) => source.id === "dvhimss-events");
  const events = result.items.filter((item) => item.source.origin === "dvhimss-events");
  assert.deepEqual(events.map((item) => item.source.externalId), ["1", "2"]);
  assert.equal(dvhimss?.itemCount, 2);
  assert.equal(dvhimss?.completeness, "complete");
  assert.equal(dvhimss?.complete, true);
  assert.equal(sourceAuthorizesDisappearance(dvhimss!), true);
});

test("Tribe pagination stops at the hard page cap and marks the snapshot partial", async () => {
  const fetchImpl = eventsFetch({
    tribe(url) {
      const page = pageNumber(url);
      assert.ok(page <= DVHIMSS_MAX_PAGES, `fetched page ${page} beyond cap`);
      return tribePage([tribeEvent(page)], {
        total: DVHIMSS_MAX_PAGES + 1,
        total_pages: DVHIMSS_MAX_PAGES + 1,
        next_rest_url: nextRestUrl(page + 1),
      });
    },
  });
  const result = await ingestEventsWithHealth(new Date(FETCHED_AT), fetchImpl);
  const dvhimss = result.sources.find((source) => source.id === "dvhimss-events");
  const events = result.items.filter((item) => item.source.origin === "dvhimss-events");
  assert.equal(events.length, DVHIMSS_MAX_PAGES);
  assert.equal(dvhimss?.completeness, "partial");
  assert.equal(dvhimss?.complete, false);
  assert.equal(sourceAuthorizesDisappearance(dvhimss!), false);
});

test("a later Tribe page failure keeps earlier rows and does not authorize disappearance", async () => {
  const fetchImpl = eventsFetch({
    tribe(url) {
      if (pageNumber(url) === 1) {
        return tribePage([tribeEvent(1)], {
          total_pages: 2,
          next_rest_url: nextRestUrl(2),
        });
      }
      return new Response("upstream timeout", { status: 503 });
    },
  });
  const result = await ingestEventsWithHealth(new Date(FETCHED_AT), fetchImpl);
  const dvhimss = result.sources.find((source) => source.id === "dvhimss-events");
  assert.equal(dvhimss?.itemCount, 1);
  assert.equal(dvhimss?.state, "healthy");
  assert.equal(dvhimss?.completeness, "partial");
  assert.equal(sourceAuthorizesDisappearance(dvhimss!), false);
});

test("a full Tribe page without pagination metadata is a partial snapshot", () => {
  assert.equal(
    tribeSnapshotCompleteness({
      rawCount: 100,
      parsedCount: 100,
      pagesFetched: 1,
      hasNext: false,
      hitPageCap: false,
      laterPageFailed: false,
      lastPageSize: 100,
      perPage: 100,
    }),
    "partial",
  );
  assert.equal(
    tribeSnapshotCompleteness({
      rawCount: 2,
      parsedCount: 2,
      pagesFetched: 1,
      totalPages: 1,
      hasNext: false,
      hitPageCap: false,
      laterPageFailed: false,
      lastPageSize: 2,
      perPage: 100,
    }),
    "complete",
  );
});

test("Tribe next_rest_url must stay on the official archive host and path", () => {
  const origin = TRIBE_ARCHIVE;
  assert.equal(isSafeTribeNextUrl(nextRestUrl(2), origin), true);
  assert.equal(isSafeTribeNextUrl("https://attacker.invalid/wp-json/tribe/events/v1/events?page=2", origin), false);
  assert.equal(isSafeTribeNextUrl("https://dvhimss.org/wp-json/tribe/events/v1/events/23007", origin), false);
  const page = parseTribeEventsResponse(JSON.stringify({
    events: [tribeEvent(1)],
    next_rest_url: "https://attacker.invalid/wp-json/tribe/events/v1/events?page=2",
    total_pages: 2,
  }));
  assert.equal(tribeNextPageUrl(origin, page, 1, origin), "https://dvhimss.org/wp-json/tribe/events/v1/events?per_page=100&page=2");
});

test("one malformed Tribe row does not discard valid siblings", async () => {
  const items = await fetchDvhimssCalendar(eventsFetch({
    tribe: () => tribePage([
      { id: 99, website: "https://web.cvent.com/event/x" },
      tribeEvent(42, { title: "Keep me" }),
      "not-an-object",
    ]),
  }), FETCHED_AT);
  assert.equal(items.length, 1);
  assert.equal(items[0]?.title, "Keep me");
  assert.equal(items[0]?.autoPublish, true);
  assert.equal(items[0]?.status, "published");
});

test("all-malformed Tribe rows are a partial snapshot and cannot trigger disappearance", async () => {
  const result = await ingestEventsWithHealth(new Date(FETCHED_AT), eventsFetch({
    tribe: () => tribePage([{ id: 99, website: "https://web.cvent.com/event/x" }]),
  }));
  const dvhimss = result.sources.find((source) => source.id === "dvhimss-events");
  assert.equal(dvhimss?.itemCount, 0);
  assert.equal(dvhimss?.completeness, "partial");
  assert.equal(sourceAuthorizesDisappearance(dvhimss!), false);
});

test("NJ JSON-LD Event nodes parse dates, venue, and Cvent offers", async () => {
  const html = recognizedNj(`
    <script type="application/ld+json">
      ${JSON.stringify({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "WebSite", name: "NJDVHIMSS" },
          {
            "@type": "Event",
            name: "NJ/DVHIMSS Fall Conference 2026",
            startDate: "2026-10-13T16:30:00-04:00",
            endDate: "2026-10-15T11:30:00-04:00",
            location: {
              "@type": "Place",
              name: "Hard Rock Hotel & Casino",
              address: { "@type": "PostalAddress", addressLocality: "Atlantic City" },
            },
            offers: { "@type": "Offer", url: "https://cvent.me/NAqAxv" },
          },
        ],
      })}
    </script>
  `);
  const parsed = parseJsonLdEvents(html);
  assert.equal(parsed.nodeCount, 1);
  assert.equal(parsed.malformed, 0);
  assert.equal(parsed.events[0]?.key, "fall-conference");
  const items = await scrapeNjdvhimss(async () => new Response(html, { status: 200 }), FETCHED_AT);
  const conference = items.find((item) => item.id === "evt-njdvhimss-fall-2026");
  assert.ok(conference);
  assert.equal(conference?.registrationUrl, "https://cvent.me/NAqAxv");
  assert.equal(conference?.autoPublish, true);
  assert.equal(conference?.status, "published");
  assert.equal(conference?.startsAt, new Date("2026-10-13T16:30:00-04:00").toISOString());
  assert.equal(conference?.venue, "Hard Rock Hotel & Casino");
  const decision = evaluateCandidate(conference!, null, new Date(FETCHED_AT));
  assert.equal(decision.action, "publish");
  assert.equal(decision.rule, "official-chapter-event");
});

test("malformed JSON-LD Event rows keep valid siblings and mark the snapshot partial", async () => {
  const html = recognizedNj(`
    <script type="application/ld+json">
      ${JSON.stringify({
        "@context": "https://schema.org",
        "@graph": [
          { "@type": "Event", name: "Broken listing" },
          {
            "@type": "Event",
            name: "Winter Forum",
            startDate: "2026-12-04",
            offers: { url: "https://cvent.me/Winter" },
          },
        ],
      })}
    </script>
  `);
  const parsed = parseNjdvhimssPage(html);
  assert.equal(parsed.jsonLdEventCount, 2);
  assert.equal(parsed.jsonLdMalformed, 1);
  assert.equal(parsed.events.length, 1);
  const result = await ingestEventsWithHealth(new Date(FETCHED_AT), eventsFetch({ nj: html }));
  const nj = result.sources.find((source) => source.id === "njhimss-events");
  assert.equal(nj?.itemCount, 1);
  assert.equal(nj?.completeness, "partial");
  assert.equal(sourceAuthorizesDisappearance(nj!), false);
  assert.equal(result.items.find((item) => item.title === "Winter Forum")?.autoPublish, true);
});

test("visible event-card and date/link fallback extracts a dated listing", () => {
  const html = recognizedNj(`
    <article class="event-card">
      <h2><a href="https://njdvhimssevent.com/winter-forum">Winter Forum</a></h2>
      <time datetime="2026-12-04">December 4, 2026</time>
    </article>
  `);
  const cards = parseVisibleEventCards(html);
  assert.equal(cards.events.length, 1);
  assert.equal(cards.events[0]?.title, "Winter Forum");
  assert.equal(cards.events[0]?.startsAt, "2026-12-04T00:00:00.000Z");
});

test("known NJ conference and golf listings are still detected from visible dates", () => {
  const html = recognizedNj(`
    <a href="https://cvent.me/NAqAxv">Register Today</a>
    Tuesday, October 13, 2026 through October 15, 2026
    <h5>Golf</h5>
  `);
  const known = matchKnownNjdvhimssEvents(html);
  assert.deepEqual(known.map((event) => event.key), ["fall-conference", "golf"]);
});

test("JSON-LD offers still require a verified Cvent host before auto-publish", async () => {
  const html = recognizedNj(`
    <script type="application/ld+json">
      ${JSON.stringify({
        "@type": "Event",
        name: "Winter Forum",
        startDate: "2026-12-04",
        offers: { url: "https://attacker.invalid/register" },
      })}
    </script>
  `);
  const items = await scrapeNjdvhimss(async () => new Response(html, { status: 200 }), FETCHED_AT);
  assert.equal(items[0]?.title, "Winter Forum");
  assert.equal(items[0]?.registrationUrl, undefined);
  assert.equal(items[0]?.autoPublish, false);
  assert.equal(items[0]?.status, "review");
});

test("a recognized NJ page with one fallback event stays partial for disappearance safety", async () => {
  const html = recognizedNj(`
    <a href="https://cvent.me/NAqAxv">Register Today</a>
    Tuesday, October 13, 2026 through October 15, 2026
  `);
  const result = await ingestEventsWithHealth(new Date(FETCHED_AT), eventsFetch({ nj: html }));
  const nj = result.sources.find((source) => source.id === "njhimss-events");
  assert.equal(nj?.itemCount, 1);
  assert.equal(nj?.completeness, "partial");
  assert.equal(sourceAuthorizesDisappearance(nj!), false);
  assert.equal(njSnapshotCompleteness({ recognized: true, itemCount: 1, jsonLdEventCount: 0, jsonLdMalformed: 0 }), "partial");
});

test("one well-formed JSON-LD Event on a recognized page is a complete snapshot", async () => {
  const html = recognizedNj(`
    <script type="application/ld+json">
      ${JSON.stringify({
        "@type": "Event",
        name: "Winter Forum",
        startDate: "2026-12-04",
        offers: { url: "https://cvent.me/Winter" },
      })}
    </script>
  `);
  const result = await ingestEventsWithHealth(new Date(FETCHED_AT), eventsFetch({ nj: html }));
  const nj = result.sources.find((source) => source.id === "njhimss-events");
  assert.equal(nj?.itemCount, 1);
  assert.equal(nj?.completeness, "complete");
  assert.equal(sourceAuthorizesDisappearance(nj!), true);
});
