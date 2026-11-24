import type { Listing } from "./public-directory-research";
import { countyGeometry } from "./public-directory-counties";
import { browsePath, counties, type DirectoryCatalog } from "./public-directory-data";
import { entityHref, summaryLedger, type DirectorySummary, type Names } from "./public-directory-entity";
import { count, healthTopic, href, html, kindLedger, searchInput } from "./public-directory-ui";

type Home = ReturnType<DirectoryCatalog["home"]>;
type Row = { name: string; href: string; n: number };

const states = { PA: "Pennsylvania", NJ: "New Jersey" } as const;

/** Where each county's name and count sit on the map, in map units, placed by measuring the labels
 *  against every border at phone and desktop sizes. Philadelphia, Camden, Delaware and Gloucester are
 *  too narrow to hold theirs, so their labels stand clear of the borders with a short leader from the
 *  county; the map gains a little room at the foot for two of them. */
type Label = { x: number; y: number; start?: boolean; from?: [number, number]; off?: boolean };
const labelAt: Record<string, Label> = {
  "42017": { x: 146, y: 61 }, "34021": { x: 252, y: 72 }, "42091": { x: 147, y: 131 }, "42029": { x: 84, y: 178 },
  "34005": { x: 297, y: 193 },
  "42101": { x: 233, y: 159, start: true, from: [197, 160] },
  "34007": { x: 292, y: 268, start: true, from: [257, 234], off: true },
  "42045": { x: 128, y: 271, from: [147, 214], off: true },
  "34015": { x: 190, y: 296, from: [199, 252], off: true },
};
const mapBox = "0 0 372 312";

const tallyItems = (rows: Row[]) =>
  rows.map((r) => `<li><a href="${html(r.href)}">${html(r.name)}</a><span>${count(r.n)}</span></li>`).join("");

/** A counted list. With a limit, the rows past it sit behind a disclosure so long lists stay short. */
function tally(id: string, heading: string, rows: Row[], limit = Infinity) {
  if (!rows.length) return "";
  const rest = rows.slice(limit);
  const more = rest.length
    ? `<details class="tally-more"><summary>Show all ${count(rows.length)}</summary><ul>${tallyItems(rest)}</ul></details>`
    : "";
  return `<section class="tally home-${id}" aria-labelledby="home-${id}-title"><h2 id="home-${id}-title">${heading}</h2><ul>${tallyItems(rows.slice(0, limit))}</ul>${more}</section>`;
}

/** The counties as a map that is also their links. Each county is a link named in full for keyboards
 *  and screen readers. Names and counts sit in a layer above every county, so a label that overruns a
 *  narrow county is never covered by its neighbour; that layer repeats the links for the pointer only.
 *  The outline of a county under the pointer or in focus is drawn again above every county, so no
 *  neighbour hides part of it. */
function countyMap(rows: { fips: string; name: string; state: keyof typeof states; href: string; n: number }[], unit: string) {
  const shapes = rows.map(({ fips, name, state, href: url, n }) => {
    const label = `${name} County, ${states[state]}, ${count(n)} ${n === 1 ? unit.replace(/s$/, "") : unit}`;
    return `<g role="listitem"><a class="c-${fips}" href="${html(url)}" aria-label="${html(label)}"><path id="county-${fips}" d="${countyGeometry[fips].path}" fill-rule="evenodd"/></a></g>`;
  });
  const labels = rows.map(({ fips, name, href: url, n }) => {
    const { x, y, start, from, off } = labelAt[fips];
    const classes = [start && "is-callout", off && "is-off-map"].filter(Boolean).join(" ");
    const [ex, ey] = start ? [x - 3, y - 4] : [x, y - 11];
    const leader = from ? `<path class="county-leader" d="M${from[0]},${from[1]}L${ex},${ey}"/><circle class="county-leader-end" cx="${from[0]}" cy="${from[1]}" r="1.6"/>` : "";
    return `<a class="c-${fips}" href="${html(url)}" tabindex="-1">${leader}<text${classes ? ` class="${classes}"` : ""} x="${x}" y="${y}"><tspan class="county-name">${name}</tspan><tspan class="county-n" x="${x}" dy="1.15em">${count(n)}</tspan></text></a>`;
  });
  return `<section class="home-counties" aria-labelledby="home-counties-title">
    <h2 id="home-counties-title">Counties</h2>
    <svg class="county-map" viewBox="${mapBox}" role="list">
      <g class="county-shapes" role="none">${shapes.join("")}</g>
      <g class="county-rings" aria-hidden="true">${rows.map(({ fips }) => `<use class="c-${fips}" href="#county-${fips}"/>`).join("")}</g>
      <g class="county-labels" aria-hidden="true">${labels.join("")}</g>
    </svg>
  </section>`;
}

export function renderDirectoryHome(
  catalog: DirectoryCatalog,
  home: Home,
  publications = 0,
  _latest: Listing[] = [],
  summary?: DirectorySummary,
  names?: Names,
  _now = new Date(),
) {
  const research = summary && names && publications;
  const topicRows: Row[] = (research
    ? summary.facets.topic
        .filter((r) => healthTopic(names.topic(r.value)))
        .map((r) => ({ name: names.topic(r.value), href: entityHref("topic", r.value), n: r.n }))
    : home.topics.map((r) => ({ name: r.name, href: catalog.entityHref("topic", r.name), n: r.count }))).slice(0, 8);
  const countyCounts = new Map<string, number>(
    research
      ? summary.facets.county.map((r) => [names.county(r.value), r.n])
      : home.counties.map((r) => [r.name, r.count]),
  );
  const countyRows = counties.map((c) => ({
    ...c,
    href: research ? entityHref("county", c.name.toLowerCase()) : catalog.entityHref("county", c.name),
    n: countyCounts.get(c.name) ?? 0,
  }));
  const institutionRows: Row[] = research
    ? summary.facets.institution.map((r) => ({ name: names.institution(r.value), href: entityHref("institution", r.value), n: r.n }))
    : home.institutions.map((r) => ({ name: r.name, href: catalog.entityHref("institution", r.name), n: r.count }));
  const unit = research ? "listings" : "projects";
  const week = research && summary.week ? Object.values(summary.week).reduce((sum, n) => sum + (n ?? 0), 0) : 0;
  const examples = home.examples.map((example) => `<a href="${href({ q: example, sort: "relevance" })}">${html(example)}</a>`);
  return `<div class="frame home">
    <div class="home-top">
      <div class="home-intro">
        <h1>Healthcare research in the Delaware Valley</h1>
        ${research
          ? kindLedger(summaryLedger(summary), week ? `<span class="muted" aria-hidden="true"> · </span><a class="ledger-new" href="${browsePath}?sort=activity">${count(week)} new or updated this week</a>` : "")
          : `<p class="lede">${count(home.total)} research software projects.</p>`}
        <form class="home-search" role="search" action="${browsePath}" method="get">${searchInput("", "Search a subject or institution")}</form>
        <p class="home-examples">${examples.length ? `Try ${examples.join(", ")}, or see <a href="/discover/new">what’s new</a>.` : `See <a href="/discover/new">what’s new</a>.`}</p>
      </div>
      ${countyMap(countyRows, unit)}
    </div>
    <div class="home-ways">
      ${tally("topics", "Topics", topicRows)}
      ${tally("institutions", `Institutions <span class="muted">${count(institutionRows.length)}</span>`, institutionRows, 12)}
    </div>
  </div>`;
}
