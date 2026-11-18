import { countyGeometry, countyViewBox } from "./public-directory-counties";
import { browsePath, counties, methodPath, type DirectoryCatalog, type Facet } from "./public-directory-data";
import { count, facetHref, href, html, projectCards, projectCount, searchInput } from "./public-directory-ui";

type Home = ReturnType<DirectoryCatalog["home"]>;

function chart<T extends Facet>(rows: T[], link: (row: T) => string, label: string) {
  if (!rows.length) return '<p class="muted">No data available.</p>';
  const max = Math.max(...rows.map(row => row.count), 1);
  return `<ul class="bar-chart" aria-label="${html(label)}">${rows.map(row => `<li>
    <a href="${link(row)}">
      <span>${html(row.name)}</span>
      <svg aria-hidden="true" viewBox="0 0 100 10" preserveAspectRatio="none"><rect class="bar-track" width="100" height="10"/><rect class="bar-amount" width="${(100 * row.count / max).toFixed(2)}" height="10"/></svg>
      <strong>${count(row.count)}</strong>
    </a>
  </li>`).join("")}</ul>`;
}

function map(catalog: DirectoryCatalog, home: Home) {
  const maximum = Math.max(...home.counties.map(row => row.count), 1);
  const entries = counties.map(county => {
    const value = home.counties.find(row => row.name === county.name)?.count ?? 0;
    const tone = value ? Math.max(1, Math.ceil(Math.sqrt(value / maximum) * 4)) : 0;
    return { ...county, value, tone, url: html(catalog.entityHref("county", county.name)) };
  });
  return `<figure class="county-figure">
    <svg class="county-map" viewBox="${countyViewBox}" aria-hidden="true">
      ${entries.map(({ fips, name, url, value, tone }) => {
        const { path, x, y } = countyGeometry[fips];
        const short = name === "Philadelphia" ? "Phila." : name === "Montgomery" ? "Montg." : name;
        return `<a href="${url}" tabindex="-1" data-tone="${tone}">
          <title>${name} County, ${projectCount(value)}</title>
          <path d="${path}" fill-rule="evenodd"/>
          <text x="${x}" y="${y}" dy=".35em">${short}</text>
        </a>`;
      }).join("")}
    </svg>
    <figcaption><strong>${count(home.countyKnown)} of ${count(home.total)}</strong> projects have a known county. Counts reflect recorded project connections.</figcaption>
    <ul class="county-key" aria-label="Projects with a known county">
      ${entries.map(({ name, state, url, value, tone }) => `<li><a href="${url}"><span class="swatch" data-tone="${tone}" aria-hidden="true"></span><span>${name} <abbr title="${state === "PA" ? "Pennsylvania" : "New Jersey"}">${state}</abbr></span><strong>${count(value)}</strong></a></li>`).join("")}
    </ul>
  </figure>`;
}

export function renderDirectoryHome(catalog: DirectoryCatalog, home: Home) {
  return `<section class="home-hero">
    <div class="frame">
      <h1>Health technology in the Delaware Valley</h1>
      <p>Find public software for health technology, biomedicine and life sciences across nine counties in Pennsylvania and New Jersey.</p>
      <form class="home-search" role="search" action="${browsePath}" method="get">${searchInput()}</form>
      <div class="home-actions">
        ${home.examples.length ? `<span>Try ${home.examples.map((example, i) => `${i ? '<span aria-hidden="true"> · </span>' : ""}<a href="${href({ q: example, sort: "relevance" })}">${html(example)}</a>`).join("")}</span>` : ""}
        <a href="${browsePath}">Browse all projects <span aria-hidden="true">→</span></a>
      </div>
    </div>
  </section>
  <div class="frame home-body">
    <dl class="atlas-stats" aria-label="Directory totals">
      <div><dt>Projects</dt><dd>${count(home.total)}</dd></div>
      <div><dt>Institutions</dt><dd>${count(home.institutions.length)}</dd></div>
      <div><dt>GitHub accounts</dt><dd>${count(home.labs.length)}</dd></div>
      <div><dt><a href="${methodPath}#verified">Verified projects</a></dt><dd>${count(home.verifiedCount)}</dd></div>
    </dl>
    <section class="atlas" aria-labelledby="atlas-title">
      <h2 id="atlas-title">The regional landscape</h2>
      <div class="atlas-grid">
        <section class="atlas-map" aria-labelledby="county-title">
          <h3 id="county-title">Projects with a known county</h3>
          ${map(catalog, home)}
        </section>
        <div class="atlas-distributions">
          <section aria-labelledby="topic-title">
            <h3 id="topic-title">Projects by topic</h3>
            ${chart(home.topics, topic => html(catalog.entityHref("topic", topic.name)), "Project counts by topic")}
          </section>
          <section aria-labelledby="institution-title">
            <div class="section-heading"><h3 id="institution-title">Projects by institution</h3><a href="${browsePath}#directory-institution">All institutions</a></div>
            ${chart(home.institutions.slice(0, 7), institution => html(catalog.entityHref("institution", institution.name)), "Project counts at the seven largest institutions")}
          </section>
        </div>
      </div>
    </section>
    <div class="home-explore">
      <section aria-labelledby="year-title">
        <h2 id="year-title">Last activity by year</h2>
        <p class="muted">Based on the last code push when available, otherwise the repository update date.</p>
        ${chart(home.years, year => facetHref("year", year.name), "Project counts by year of last activity")}
      </section>
      <section aria-labelledby="labs-title">
        <div class="section-heading"><h2 id="labs-title">Most active labs and accounts</h2><a href="${browsePath}#directory-owner">All accounts</a></div>
        <p class="muted">Ranked by projects with activity in the past 12 months.</p>
        ${chart(home.activeLabs, account => html(catalog.entityHref("lab", account.login)), "Recent project counts by GitHub account")}
      </section>
    </div>
    ${home.verified.length ? `<section class="home-projects">
      <div class="section-heading"><h2>Verified projects</h2><a href="${facetHref("label", "Verified")}">All Verified projects</a></div>
      ${projectCards(catalog, home.verified)}
    </section>` : ""}
    ${home.recent.length ? `<section class="home-projects">
      <div class="section-heading"><h2>Recently updated projects</h2><a href="${browsePath}">All projects</a></div>
      ${projectCards(catalog, home.recent)}
    </section>` : ""}
    ${home.added.length ? `<section class="home-projects">
      <div class="section-heading"><h2>Recently added projects</h2><a href="${href({ sort: "added" })}">Browse by date added</a></div>
      ${projectCards(catalog, home.added, "cards", "added")}
    </section>` : ""}
  </div>`;
}
