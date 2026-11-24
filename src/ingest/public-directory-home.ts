import type { Listing } from "./public-directory-research";
import { countyGeometry, countyViewBox } from "./public-directory-counties";
import { browsePath, counties, type DirectoryCatalog } from "./public-directory-data";
import { entityHref, summaryLedger, type DirectorySummary, type Names } from "./public-directory-entity";
import { count, healthTopic, href, html, kindLedger, searchInput } from "./public-directory-ui";

type Home = ReturnType<DirectoryCatalog["home"]>;
type Row = { name: string; href: string; n: number };

const states = { PA: "Pennsylvania", NJ: "New Jersey" } as const;

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

/** The counties as a shaded map that is also their links. Each county is a link named in full, with
 *  its count, for keyboards, screen readers and the hover tooltip; the shade says how many listings it
 *  has. Names sit in a layer above every county so a neighbour never covers one; that layer repeats the
 *  links for the pointer only. The outline of a county under the pointer or in focus is drawn again
 *  above every county. */
function countyMap(rows: { fips: string; name: string; state: keyof typeof states; href: string; n: number }[], unit: string) {
  const most = Math.max(...rows.map((row) => row.n), 1);
  const shapes = rows.map(({ fips, name, state, href: url, n }) => {
    const label = `${name} County, ${states[state]}, ${count(n)} ${n === 1 ? unit.replace(/s$/, "") : unit}`;
    const tone = n ? Math.max(1, Math.ceil(Math.sqrt(n / most) * 4)) : 0;
    return `<g role="listitem" data-tone="${tone}"><a class="c-${fips}" href="${html(url)}" aria-label="${html(label)}"><title>${html(label)}</title><path id="county-${fips}" d="${countyGeometry[fips].path}" fill-rule="evenodd"/></a></g>`;
  });
  const labels = rows.map(({ fips, name, href: url }) => {
    const { x, y } = countyGeometry[fips];
    const short = name === "Philadelphia" ? "Phila." : name === "Montgomery" ? "Montg." : name;
    return `<a class="c-${fips}" href="${html(url)}" tabindex="-1"><text x="${x}" y="${y}" dy=".35em">${short}</text></a>`;
  });
  return `<section class="home-counties" aria-labelledby="home-counties-title">
    <h2 id="home-counties-title">Counties</h2>
    <svg class="county-map" viewBox="${countyViewBox}" role="list">
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
