import { renderListingCards, type Listing } from "./public-directory-research";
import { countyGeometry, countyViewBox } from "./public-directory-counties";
import { browsePath, counties, type DirectoryCatalog } from "./public-directory-data";
import { asOf, entityHref, kindPhrase, type DirectorySummary, type Names } from "./public-directory-entity";
import { count, healthTopic, href, html, projectCards, searchInput, timestamp } from "./public-directory-ui";

type Home = ReturnType<DirectoryCatalog["home"]>;
type Row = { name: string; href: string; n: number; note?: string };

function tally(heading: string, rows: Row[], extra = "", columns = false) {
  if (!rows.length) return "";
  return `<section class="tally${columns ? " tally-columns" : ""}"><h2>${heading}</h2><ul>${rows
    .map((r) => `<li><a href="${html(r.href)}">${html(r.name)}</a><span>${count(r.n)}</span></li>`)
    .join("")}</ul>${extra}</section>`;
}

function map(rows: Map<string, number>, hrefFor: (name: string) => string, unit: string) {
  const maximum = Math.max(...rows.values(), 1);
  const entries = counties.map((county) => {
    const value = rows.get(county.name) ?? 0;
    const tone = value ? Math.max(1, Math.ceil(Math.sqrt(value / maximum) * 4)) : 0;
    return { ...county, value, tone, url: html(hrefFor(county.name)) };
  });
  return `<figure class="county-figure">
    <svg class="county-map" viewBox="${countyViewBox}" role="img" aria-labelledby="county-map-title">
      <title id="county-map-title">Map of the nine Delaware Valley counties shaded by ${unit} that record each county</title>
      ${entries
        .map(({ fips, name, url, value, tone }) => {
          const { path, x, y } = countyGeometry[fips];
          const short = name === "Philadelphia" ? "Phila." : name === "Montgomery" ? "Montg." : name;
          return `<a href="${url}" tabindex="-1" aria-hidden="true" data-tone="${tone}">
          <title>${name} County, ${count(value)} ${unit}</title>
          <path d="${path}" fill-rule="evenodd"/>
          <text x="${x}" y="${y}" dy=".35em">${short}</text>
        </a>`;
        })
        .join("")}
    </svg>
    <figcaption>Shading shows the number of ${unit} that record each county. A listing can record more than one county or none.</figcaption>
  </figure>`;
}

export function renderDirectoryHome(
  catalog: DirectoryCatalog,
  home: Home,
  publications = 0,
  latest: Listing[] = [],
  summary?: DirectorySummary,
  names?: Names,
  now = new Date(),
) {
  const research = summary && names && publications;
  const pubs = summary?.kinds.publication;
  const lede = research
    ? `The directory lists ${kindPhrase(summary)} connected to Bucks, Chester, Delaware, Montgomery and Philadelphia counties in Pennsylvania and Burlington, Camden, Gloucester and Mercer counties in New Jersey.${pubs?.first && pubs.last ? ` Publication dates run from ${pubs.first.slice(0, 4)} to ${pubs.last.slice(0, 4)}.` : ""} Each listing names the source of its regional connection.`
    : `The directory lists ${count(home.total)} research software projects connected to Bucks, Chester, Delaware, Montgomery and Philadelphia counties in Pennsylvania and Burlington, Camden, Gloucester and Mercer counties in New Jersey. Each listing names the source of its regional connection.`;
  const topicRows: Row[] = research
    ? summary.facets.topic
        .filter((r) => healthTopic(names.topic(r.value)))
        .map((r) => ({ name: names.topic(r.value), href: entityHref("topic", r.value), n: r.n }))
    : home.topics.map((r) => ({ name: r.name, href: catalog.entityHref("topic", r.name), n: r.count }));
  const countyCounts = new Map<string, number>(
    research
      ? summary.facets.county.map((r) => [names.county(r.value), r.n])
      : home.counties.map((r) => [r.name, r.count]),
  );
  const countyRows: Row[] = counties.map((c) => ({
    name: `${c.name} County, ${c.state}`,
    href: research ? entityHref("county", c.name.toLowerCase()) : catalog.entityHref("county", c.name),
    n: countyCounts.get(c.name) ?? 0,
  }));
  const institutionRows: Row[] = research
    ? summary.facets.institution.map((r) => ({ name: names.institution(r.value), href: entityHref("institution", r.value), n: r.n }))
    : home.institutions.map((r) => ({ name: r.name, href: catalog.entityHref("institution", r.name), n: r.count }));
  const unit = research ? "listings" : "projects";
  const added = research ? Object.values(summary.kinds).map((kind) => kind.added).filter(Boolean).sort().at(-1) : undefined;
  return `<div class="frame home">
    <section class="home-intro">
      <h1>Healthcare research in the Delaware Valley</h1>
      <p class="lede">${lede}</p>
      <form class="home-search" role="search" action="${browsePath}" method="get">${searchInput()}</form>
      ${home.examples.length ? `<p class="home-examples">For example: ${home.examples.map((example) => `<a href="${href({ q: example, sort: "relevance" })}">${html(example)}</a>`).join(", ")}</p>` : ""}
    </section>
    <div class="home-grid">
      <section class="home-latest" aria-labelledby="latest-title">
        <div class="section-heading"><h2 id="latest-title">${research ? "Latest additions" : "Recently added projects"}</h2><a href="/discover/new">All additions${added ? `, latest ${timestamp(added)}` : ""}</a></div>
        ${research ? renderListingCards(latest, catalog) : home.added.length ? projectCards(catalog, home.added, "cards", "added") : projectCards(catalog, home.recent)}
      </section>
      <section class="home-place" aria-labelledby="place-title">
        <h2 id="place-title">By county</h2>
        ${map(countyCounts, (name) => (research ? entityHref("county", name.toLowerCase()) : catalog.entityHref("county", name)), unit)}
        ${tally("Counties", countyRows).replace("<h2>Counties</h2>", '<h3 class="sr-only">Counties</h3>')}
      </section>
    </div>
    <div class="home-index">
      ${tally(research ? "Topics" : "Project topics", topicRows)}
      ${tally(`Institutions <span class="muted">(${count(institutionRows.length)})</span>`, institutionRows, "", true)}
    </div>
    ${home.recent.length ? `<section class="home-software" aria-labelledby="software-title">
      <div class="section-heading"><h2 id="software-title">Recently updated software</h2><a href="${browsePath}?tools=project">Filter software by language, license and activity</a></div>
      ${projectCards(catalog, home.recent.slice(0, 4))}
      ${home.activeLabs.length ? `<p class="home-labs">Most active GitHub accounts in the past 12 months: ${home.activeLabs.map((a) => `<a href="${html(catalog.entityHref("lab", a.login))}">${html(a.name)}</a> (${count(a.count)})`).join(", ")}.</p>` : ""}
    </section>` : ""}
    ${research ? asOf(now) : ""}
  </div>`;
}
