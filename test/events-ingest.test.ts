import assert from "node:assert/strict";
import { test } from "node:test";

import { evaluateCandidate } from "../src/ingest/editor.ts";
import { eventSchedule } from "../src/lib/calendar.ts";
import {
  DVHIMSS_MAX_PAGES,
  JSON_LD_MAX_COLLECTION,
  JSON_LD_MAX_DEPTH,
  JSON_LD_MAX_VISITED,
  classifyNjEventKey,
  isSafeTribeNextUrl,
  matchKnownNjdvhimssEvents,
  njSnapshotCompleteness,
  parseJsonLdEvents,
  parseNjdvhimssPage,
  parseTribeEventsResponse,
  parseVisibleEventCards,
  toIso,
  tribeFallbackId,
  tribeNextPageUrl,
  tribeRecordId,
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

test("a failed event source is classified as a failure instead of a backoff skip", async () => {
  const result = await ingestEventsWithHealth(new Date(FETCHED_AT), async (input) => {
    if (String(input).includes("wp-json/tribe")) throw new Error("DVHIMSS upstream unavailable");
    return new Response(recognizedNj("Season recap"), { status: 200 });
  });
  const dvhimss = result.sources.find((source) => source.id === "dvhimss-events");
  assert.equal(dvhimss?.state, "upstream-failed");
  assert.equal(dvhimss?.error, "DVHIMSS upstream unavailable");
  assert.equal(dvhimss?.nextAttemptAt, undefined);
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
  assert.equal(cards.events[0]?.startsAt, "2026-12-04T05:00:00.000Z");
});

test("visible event cards never borrow a following card's date", () => {
  const html = recognizedNj(`
    <article class="event-card"><h2>Undated announcement</h2></article>
    <article class="event-card"><h2>Dated forum</h2><time datetime="2026-12-04">December 4</time></article>
  `);
  const cards = parseVisibleEventCards(html);
  assert.equal(cards.events.some((event) => event.title === "Undated announcement"), false);
  assert.equal(cards.events.some((event) => event.title === "Dated forum"), true);
  assert.equal(cards.malformed, 1);
});

test("a registration link without a real event heading is malformed", () => {
  const cards = parseVisibleEventCards(recognizedNj(`
    <article class="event-card">
      <a href="https://cvent.me/NAqAxv">Register</a>
      <time datetime="2026-12-04">December 4</time>
    </article>
  `));
  assert.equal(cards.events.length, 0);
  assert.equal(cards.malformed, 1);
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

test("known events sharing the official listing page keep distinct event identities", async () => {
  const html = recognizedNj(`
    <a href="https://cvent.me/NAqAxv">Register Today</a>
    Tuesday, October 13, 2026 through October 15, 2026
    <h5>Golf</h5>
  `);
  const items = await scrapeNjdvhimss(async () => new Response(html, { status: 200 }), FETCHED_AT);
  assert.deepEqual(
    items.map((item) => item.id).sort(),
    ["evt-njdvhimss-fall-2026", "evt-njdvhimss-golf-2026"],
  );
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

test("page-wide Cvent is not assigned to unrelated generic events", async () => {
  const html = recognizedNj(`
    <a href="https://cvent.me/NAqAxv">Register Today</a>
    Tuesday, October 13, 2026 through October 15, 2026
    <h5>Golf</h5>
    <script type="application/ld+json">
      ${JSON.stringify({
        "@type": "Event",
        name: "Winter Forum",
        startDate: "2026-12-04",
        url: "https://njdvhimssevent.com/winter-forum",
      })}
    </script>
  `);
  const items = await scrapeNjdvhimss(async () => new Response(html, { status: 200 }), FETCHED_AT);
  const conference = items.find((item) => item.id === "evt-njdvhimss-fall-2026");
  const golf = items.find((item) => item.id === "evt-njdvhimss-golf-2026");
  const winter = items.find((item) => item.title === "Winter Forum");
  assert.equal(conference?.registrationUrl, "https://cvent.me/NAqAxv");
  assert.equal(golf?.registrationUrl, "https://cvent.me/NAqAxv");
  assert.ok(winter);
  assert.equal(winter?.registrationUrl, undefined);
  assert.equal(winter?.autoPublish, false);
  assert.equal(winter?.status, "review");
});

test("date-only stays date-only and timezone-less clocks use America/New_York", async () => {
  assert.equal(toIso("2026-12-04"), "2026-12-04T05:00:00.000Z");
  assert.equal(toIso("December 4, 2026"), "2026-12-04T05:00:00.000Z");
  assert.equal(toIso("2026-10-13T16:30:00"), "2026-10-13T20:30:00.000Z");
  assert.equal(toIso("2026-09-14 13:00:00", "America/New_York", { assumeUtc: true }), "2026-09-14T13:00:00.000Z");
  assert.equal(toIso("2026-09-14 09:00:00"), "2026-09-14T13:00:00.000Z");
  assert.equal(toIso("2026-02-30"), undefined);
  assert.equal(toIso("2026-02-30T09:00:00Z"), undefined);
  assert.equal(toIso("2026-02-30T09:00:00-04:00"), undefined);
  assert.equal(toIso("2026-13-01"), undefined);
  assert.equal(toIso("2026-12-04T09:99:00"), undefined);
  const html = recognizedNj(`
    <script type="application/ld+json">
      ${JSON.stringify({
        "@type": "Event",
        name: "Winter Forum",
        startDate: "2026-12-04",
        endDate: "2026-12-05",
      })}
    </script>
  `);
  const items = await scrapeNjdvhimss(async () => new Response(html, { status: 200 }), FETCHED_AT);
  const winter = items.find((item) => item.title === "Winter Forum");
  assert.equal(winter?.startsAt, "2026-12-04T05:00:00.000Z");
  assert.equal(winter?.endsAt, "2026-12-05T05:00:00.000Z");
  assert.equal(eventSchedule(winter!).kind, "date-only");
  assert.equal(eventSchedule(winter!).startDay, "2026-12-04");
  const local = await fetchDvhimssCalendar(eventsFetch({
    tribe: () => tribePage([tribeEvent(7, {
      utc_start_date: undefined,
      start_date: "2026-09-14 09:00:00",
      timezone: "America/New_York",
    })]),
  }), FETCHED_AT);
  assert.equal(local[0]?.startsAt, "2026-09-14T13:00:00.000Z");
  const invalidZone = await fetchDvhimssCalendar(eventsFetch({
    tribe: () => tribePage([tribeEvent(8, { timezone: "Not/AZone" })]),
  }), FETCHED_AT);
  assert.equal(invalidZone[0]?.timezone, "America/New_York");
  assert.doesNotThrow(() => eventSchedule(invalidZone[0]!));
});

test("event source redirects cannot leave the official host allowlist", async () => {
  await assert.rejects(
    fetchDvhimssCalendar(async () => new Response(null, {
      status: 302,
      headers: { location: "https://attacker.example/events.json" },
    }), FETCHED_AT),
    /allowlist/,
  );
});

test("invalid or unusable Tribe pagination metadata forces a partial snapshot", async () => {
  assert.equal(
    tribeSnapshotCompleteness({
      rawCount: 1,
      parsedCount: 1,
      pagesFetched: 1,
      totalPages: 1,
      hasNext: false,
      hitPageCap: false,
      laterPageFailed: false,
      lastPageSize: 1,
      perPage: 100,
      paginationInvalid: true,
      originUrl: TRIBE_ARCHIVE,
    }),
    "partial",
  );
  const unsafeNext = await ingestEventsWithHealth(new Date(FETCHED_AT), eventsFetch({
    tribe: () => tribePage([tribeEvent(1)], {
      next_rest_url: "https://attacker.invalid/wp-json/tribe/events/v1/events?page=2",
    }),
  }));
  const unsafe = unsafeNext.sources.find((source) => source.id === "dvhimss-events");
  assert.equal(unsafe?.itemCount, 1);
  assert.equal(unsafe?.completeness, "partial");
  assert.equal(sourceAuthorizesDisappearance(unsafe!), false);

  const zeroPages = await ingestEventsWithHealth(new Date(FETCHED_AT), eventsFetch({
    tribe: () => tribePage([tribeEvent(1)], { total_pages: 0, total: 1 }),
  }));
  assert.equal(zeroPages.sources.find((source) => source.id === "dvhimss-events")?.completeness, "partial");

  const lyingTotal = await ingestEventsWithHealth(new Date(FETCHED_AT), eventsFetch({
    tribe: () => tribePage([tribeEvent(1)], { total: 40 }),
  }));
  assert.equal(lyingTotal.sources.find((source) => source.id === "dvhimss-events")?.completeness, "partial");
});

test("relative event URLs resolve against the official source and same-page links do not collapse identity", async () => {
  assert.equal(isSafeTribeNextUrl("/wp-json/tribe/events/v1/events?page=2", TRIBE_ARCHIVE), true);
  const html = recognizedNj(`
    <script type="application/ld+json">
      ${JSON.stringify({
        "@graph": [
          {
            "@type": "Event",
            name: "Winter Forum",
            startDate: "2026-12-04",
            url: "/winter-forum",
            offers: { url: "https://cvent.me/Winter" },
          },
          {
            "@type": "Event",
            name: "Spring Mixer",
            startDate: "2026-03-03",
            url: "https://njdvhimssevent.com/",
          },
          {
            "@type": "Event",
            name: "Board Breakfast",
            startDate: "2026-04-01",
            url: "/",
          },
        ],
      })}
    </script>
  `);
  const items = await scrapeNjdvhimss(async () => new Response(html, { status: 200 }), FETCHED_AT);
  const winter = items.find((item) => item.title === "Winter Forum");
  const mixer = items.find((item) => item.title === "Spring Mixer");
  const breakfast = items.find((item) => item.title === "Board Breakfast");
  assert.equal(winter?.source.url, "https://njdvhimssevent.com/winter-forum");
  assert.equal(winter?.id, "evt-njdvhimss-winter-forum-2026-12-04-winter-forum");
  assert.equal(mixer?.id, "evt-njdvhimss-spring-mixer-2026-03-03");
  assert.equal(breakfast?.id, "evt-njdvhimss-board-breakfast-2026-04-01");
  assert.notEqual(mixer?.id, breakfast?.id);
  assert.equal(mixer?.source.url, "https://njdvhimssevent.com/");
  assert.equal(breakfast?.source.url, "https://njdvhimssevent.com/");
  const relativeTribe = await fetchDvhimssCalendar(eventsFetch({
    tribe: () => tribePage([tribeEvent(8, { url: "/event/8/" })]),
  }), FETCHED_AT);
  assert.equal(relativeTribe[0]?.source.url, "https://dvhimss.org/event/8/");
});

test("event source URLs and citations stay on official chapter hosts", async () => {
  const html = recognizedNj(`
    <script type="application/ld+json">
      ${JSON.stringify({
        "@type": "Event",
        name: "Winter Forum",
        startDate: "2026-12-04",
        url: "https://attacker.invalid/winter-forum",
        offers: { url: "https://attacker.invalid/register" },
      })}
    </script>
  `);
  const items = await scrapeNjdvhimss(async () => new Response(html, { status: 200 }), FETCHED_AT);
  const winter = items.find((item) => item.title === "Winter Forum");
  assert.equal(winter?.source.url, "https://njdvhimssevent.com/");
  assert.equal(winter?.citations?.[0]?.url, "https://njdvhimssevent.com/");
  assert.equal(winter?.registrationUrl, undefined);
  const tribe = await fetchDvhimssCalendar(eventsFetch({
    tribe: () => tribePage([tribeEvent(9, {
      url: "https://attacker.invalid/event/9",
      website: "https://attacker.invalid/register",
    })]),
  }), FETCHED_AT);
  assert.equal(tribe[0]?.source.url, "https://dvhimss.org/events-calendar");
  assert.equal(tribe[0]?.citations?.[0]?.url, "https://dvhimss.org/events-calendar");
  assert.equal(tribe[0]?.registrationUrl, undefined);
});

test("card parse failures keep valid siblings and mark the NJ snapshot partial", async () => {
  const html = recognizedNj(`
    <article class="event-card"><p>Broken card with no title or date</p></article>
    <script type="application/ld+json">
      ${JSON.stringify({
        "@type": "Event",
        name: "Winter Forum",
        startDate: "2026-12-04",
        offers: { url: "https://cvent.me/Winter" },
      })}
    </script>
  `);
  const parsed = parseNjdvhimssPage(html);
  assert.equal(parsed.cardMalformed, 1);
  assert.equal(parsed.events.some((event) => event.title === "Winter Forum"), true);
  const result = await ingestEventsWithHealth(new Date(FETCHED_AT), eventsFetch({ nj: html }));
  const nj = result.sources.find((source) => source.id === "njhimss-events");
  assert.equal(nj?.itemCount, 1);
  assert.equal(nj?.completeness, "partial");
  assert.equal(sourceAuthorizesDisappearance(nj!), false);
});

test("missing Tribe IDs use a deterministic fallback or are skipped as malformed", async () => {
  assert.equal(tribeRecordId({ title: "No id" }), undefined);
  assert.equal(tribeFallbackId("Keep me", "2026-09-14T13:00:00.000Z", "https://dvhimss.org/event/keep/"), "fallback-keep-me-2026-09-14-event-keep");
  const kept = await fetchDvhimssCalendar(eventsFetch({
    tribe: () => tribePage([{
      title: "Keep me",
      utc_start_date: "2026-09-14 13:00:00",
      url: "https://dvhimss.org/event/keep/",
      website: "https://web.cvent.com/event/keep",
    }]),
  }), FETCHED_AT);
  assert.equal(kept.length, 1);
  assert.equal(kept[0]?.id, "evt-dvhimss-fallback-keep-me-2026-09-14-event-keep");
  assert.equal(kept[0]?.source.externalId, "fallback-keep-me-2026-09-14-event-keep");
  const again = await fetchDvhimssCalendar(eventsFetch({
    tribe: () => tribePage([{
      title: "Keep me",
      utc_start_date: "2026-09-14 13:00:00",
      url: "https://dvhimss.org/event/keep/",
    }]),
  }), FETCHED_AT);
  assert.equal(again[0]?.id, kept[0]?.id);
  const skipped = await ingestEventsWithHealth(new Date(FETCHED_AT), eventsFetch({
    tribe: () => tribePage([{ website: "https://web.cvent.com/event/x" }, tribeEvent(42)]),
  }));
  const dvhimss = skipped.sources.find((source) => source.id === "dvhimss-events");
  assert.equal(skipped.items.filter((item) => item.source.origin === "dvhimss-events").length, 1);
  assert.equal(dvhimss?.completeness, "partial");
  assert.equal(sourceAuthorizesDisappearance(dvhimss!), false);
});

test("known conference and golf keys require event-level title and date evidence", () => {
  assert.equal(classifyNjEventKey("NJ/DVHIMSS Fall Conference 2026", "2026-10-13T20:30:00.000Z"), "fall-conference");
  assert.equal(classifyNjEventKey("NJDVHIMSS Annual Golf Outing", "2026-10-13T13:30:00.000Z"), "golf");
  assert.equal(classifyNjEventKey("Annual Golf Outing", "2026-10-13T13:30:00.000Z").startsWith("generic:"), true);
  assert.equal(classifyNjEventKey("Golf committee meeting", "2026-12-04T05:00:00.000Z").startsWith("generic:"), true);
  assert.equal(classifyNjEventKey("Fall Conference planning webinar", "2026-10-13T20:30:00.000Z").startsWith("generic:"), true);
  assert.equal(classifyNjEventKey("NJ/DVHIMSS Fall Conference 2026", "2026-03-01T05:00:00.000Z").startsWith("generic:"), true);
  const html = recognizedNj(`
    <a href="https://cvent.me/NAqAxv">Register Today</a>
    Tuesday, October 13, 2026 through October 15, 2026
    <script type="application/ld+json">
      ${JSON.stringify({
        "@type": "Event",
        name: "Golf committee meeting",
        startDate: "2026-12-04",
        url: "https://njdvhimssevent.com/golf-committee",
      })}
    </script>
  `);
  const parsed = parseNjdvhimssPage(html);
  const committee = parsed.events.find((event) => event.title === "Golf committee meeting");
  assert.equal(committee?.key.startsWith("generic:"), true);
  assert.equal(parsed.events.some((event) => event.key === "fall-conference"), true);
  assert.equal(parsed.events.some((event) => event.key === "golf"), false);
});

test("deeply nested NJ JSON-LD fails closed as a truncated partial snapshot", async () => {
  let nested: unknown = {
    "@type": "Event",
    name: "Buried Forum",
    startDate: "2026-12-04",
    url: "https://njdvhimssevent.com/buried-forum",
  };
  for (let depth = 0; depth < JSON_LD_MAX_DEPTH + 40; depth += 1) {
    nested = { "@graph": [nested] };
  }
  const html = recognizedNj(`<script type="application/ld+json">${JSON.stringify(nested)}</script>`);
  const parsed = parseJsonLdEvents(html);
  assert.equal(parsed.truncated, true);
  assert.ok(parsed.events.length <= JSON_LD_MAX_VISITED);
  assert.equal(parsed.events.some((event) => event.title === "Buried Forum"), false);
  assert.equal(
    njSnapshotCompleteness({
      recognized: true,
      itemCount: parsed.events.length,
      jsonLdEventCount: parsed.nodeCount,
      jsonLdMalformed: parsed.malformed,
      jsonLdTruncated: parsed.truncated,
    }),
    "partial",
  );
  const result = await ingestEventsWithHealth(new Date(FETCHED_AT), eventsFetch({ nj: html }));
  const nj = result.sources.find((source) => source.id === "njhimss-events");
  assert.equal(nj?.completeness, "partial");
  assert.equal(sourceAuthorizesDisappearance(nj!), false);

  const wide = Array.from({ length: JSON_LD_MAX_COLLECTION + 80 }, (_, index) => ({
    "@type": "Event",
    name: `Overflow Forum ${index}`,
    startDate: "2026-12-04",
    url: `https://njdvhimssevent.com/overflow-${index}`,
  }));
  const wideParsed = parseJsonLdEvents(recognizedNj(
    `<script type="application/ld+json">${JSON.stringify({ "@graph": wide })}</script>`,
  ));
  assert.equal(wideParsed.truncated, true);
  assert.ok(wideParsed.events.length <= JSON_LD_MAX_COLLECTION);
  assert.ok(wideParsed.events.length < wide.length);
});

test("generic NJ events with the same title and day keep distinct identities unless they are true duplicates", async () => {
  const html = recognizedNj(`
    <script type="application/ld+json">
      ${JSON.stringify({
        "@graph": [
          {
            "@type": "Event",
            name: "Chapter Briefing",
            startDate: "2026-11-10T09:00:00-05:00",
            url: "https://njdvhimssevent.com/briefing-morning",
            location: { "@type": "Place", name: "Newark" },
          },
          {
            "@type": "Event",
            name: "Chapter Briefing",
            startDate: "2026-11-10T14:00:00-05:00",
            url: "https://njdvhimssevent.com/briefing-afternoon",
            location: { "@type": "Place", name: "Princeton" },
          },
          {
            "@type": "Event",
            name: "Chapter Briefing",
            startDate: "2026-11-10T09:00:00-05:00",
            url: "https://njdvhimssevent.com/briefing-morning",
            location: { "@type": "Place", name: "Newark" },
          },
        ],
      })}
    </script>
  `);
  const parsed = parseNjdvhimssPage(html);
  const briefings = parsed.events.filter((event) => event.title === "Chapter Briefing");
  assert.equal(briefings.length, 2);
  assert.notEqual(briefings[0]?.key, briefings[1]?.key);
  const items = await scrapeNjdvhimss(async () => new Response(html, { status: 200 }), FETCHED_AT);
  const ids = items.filter((item) => item.title === "Chapter Briefing").map((item) => item.id).sort();
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
  assert.equal(
    classifyNjEventKey("Winter Forum", "2026-12-04"),
    classifyNjEventKey("Winter Forum", "2026-12-04T05:00:00.000Z"),
  );
  assert.notEqual(
    classifyNjEventKey("Chapter Briefing", "2026-11-10T14:00:00-05:00", { venue: "Newark" }),
    classifyNjEventKey("Chapter Briefing", "2026-11-10T14:00:00-05:00", { venue: "Princeton" }),
  );
  assert.notEqual(
    classifyNjEventKey("Chapter Briefing", "2026-11-10T09:00:00-05:00"),
    classifyNjEventKey("Chapter Briefing", "2026-11-10T14:00:00-05:00"),
  );
});
