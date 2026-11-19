import {
  browsePath, counties, directoryParams, entityPath, facetLabels, githubProfile, methodPath, pageSize, withoutFilter,
  type DirectoryCatalog, type DirectoryQuery, type FacetKey,
} from "./public-directory-data";
import {
  contactLink, count, entityLink, externalLink, href, html, projectCards, projectCount, searchInput,
} from "./public-directory-ui";

type Results = ReturnType<DirectoryCatalog["list"]>;
const fields = Object.keys(facetLabels) as FacetKey[];
const formId = "directory-filters";
const scopeField = { institution: "institution", lab: "owner", topic: "topic", county: "county" } as const;

function queryPurpose(view: Results) {
  const { q, facets, paper, since } = view.query;
  const topics = facets.topic?.join(" or ");
  const institutions = facets.institution?.join(" or ");
  const counties = facets.county?.map(county => `${county} County`).join(" or ");
  const basic = [topics ? `${topics} projects` : "Projects", institutions && `at ${institutions}`, counties && `in ${counties}`].filter(Boolean).join(" ");
  const extra = fields.filter(field => !["topic", "institution", "county"].includes(field))
    .flatMap(field => view.query.facets[field]?.length ? [`${facetLabels[field]}: ${view.query.facets[field]?.join(" or ")}`] : []);
  return [basic, q && `matching “${q}”`, paper && "with a paper", since && `active since ${since}`, extra.length && `· ${extra.join(" · ")}`]
    .filter(Boolean).join(" ");
}

export function scopeName(view: Results): string | undefined {
  const entity = view.scope?.entity;
  if (!entity) return;
  return entity.kind === "county" ? `${entity.name} County`
    : entity.kind === "lab" && !view.scope?.account ? `@${entity.name}`
    : entity.kind === "lab" && view.scope?.account?.toLowerCase() === entity.name.toLowerCase() ? `@${entity.name}` : entity.name;
}

function hasFilters(query: DirectoryQuery) {
  return !!(query.q || query.paper || query.since || Object.keys(query.facets).length);
}

export function resultsHead(view: Results) {
  const base = view.scope ? entityPath(view.scope.entity) : browsePath;
  const scope = scopeName(view);
  const filtered = hasFilters(view.query);
  const title = [scope, filtered ? queryPurpose(view) : scope ? "" : "Project directory",
    view.query.page > 1 ? `Page ${count(view.query.page)}` : ""].filter(Boolean).join(" · ");
  const description = filtered
    ? `${queryPurpose(view)}. ${projectCount(view.matchCount)} found in ${scope ? `${scope} in ` : ""}The Valley Desk directory.`
    : `Browse ${projectCount(view.total)}${scope ? ` listed under ${scope}` : ""} in the Delaware Valley health technology, biomedicine and life sciences directory.`;
  const canonical = !filtered && view.query.sort === "updated" && view.query.page > 1
    ? `${base}?page=${view.query.page}` : base;
  return { title, description, canonical };
}

function entityOverview(catalog: DirectoryCatalog, view: Results) {
  const scope = view.scope!;
  const { entity, summary } = scope;
  const county = counties.find(item => item.name === entity.name);
  const mix = (heading: string, values: { name: string; count: number }[], field: FacetKey) =>
    values.length ? `<div><dt>${heading}</dt><dd>${values.slice(0, 3).map(({ name, count: matches }) => {
      const target = field === "topic" ? catalog.entityHref("topic", name)
        : `${entityPath(entity)}?${directoryParams({ facets: { [field]: [name] } })}`;
      return `<a href="${html(target)}">${html(name)}</a> <span>(${count(matches)})</span>`;
    }).join(" · ")}</dd></div>` : "";
  return `<div class="entity-intro">
    <p class="entity-kind">${entity.kind === "lab" ? "GitHub account" : facetLabels[scopeField[entity.kind]]}${county && entity.kind === "county" ? ` · ${county.state === "PA" ? "Pennsylvania" : "New Jersey"}` : ""}</p>
    <h1>${html(scopeName(view)!)}</h1>
    ${entity.kind === "lab" && scope.account ? `<p class="entity-account">${externalLink(githubProfile(scope.account), `@${scope.account} on GitHub`)}${scope.ownerKind ? ` · ${html(scope.ownerKind === "organization" ? "Organization" : "User account")}` : ""}</p>` : ""}
    ${summary.total ? `<dl class="entity-stats">
      <div><dt>Projects listed</dt><dd>${count(summary.total)}</dd></div>
      <div><dt>Active in the past 12 months</dt><dd>${count(summary.active)}</dd></div>
    </dl>
    <dl class="entity-mix">
      ${entity.kind !== "institution" && summary.institutions.length ? `<div><dt>${entity.kind === "lab" ? "Institutions linked to these projects" : "Leading institutions"}</dt><dd>${summary.institutions.slice(0, 3).map(row => `${entityLink(catalog, "institution", row.name)} <span>(${count(row.count)})</span>`).join(" · ")}</dd></div>` : ""}
      ${entity.kind !== "lab" && summary.labs.length ? `<div><dt>Leading GitHub accounts</dt><dd>${summary.labs.slice(0, 3).map(row => `${entityLink(catalog, "lab", row.name, `@${row.name}`)} <span>(${count(row.count)})</span>`).join(" · ")}</dd></div>` : ""}
      ${entity.kind === "topic" ? "" : mix("Leading topics", summary.topics, "topic")}
      ${mix("Leading recorded languages", summary.languages, "language")}
    </dl>` : ""}
  </div>`;
}

function facetControls(view: Results) {
  const selected = view.query.facets;
  const locked = view.scope && scopeField[view.scope.entity.kind];
  return `<details class="filter-panel" id="directory-filter-panel" open>
    <summary>Filters</summary>
    <div class="filter-body">
      <div class="filter-sheet-toolbar"><span>${projectCount(view.matchCount)}</span><button class="button secondary" type="button" data-close-filters>Done</button></div>
      <h2 class="desktop-filter-heading">Filter projects</h2>
      <p class="muted">Choose any values within a group. Counts reflect the search and other groups.</p>
      ${fields.filter(key => key !== locked && view.facets[key].length).map(key => {
        const chosen = selected[key] ?? [];
        const open = key === "topic" || key === "institution" || chosen.length > 0;
        const options = chosen.length ? view.facets[key].slice().sort((a, b) =>
          Number(chosen.includes(b.name)) - Number(chosen.includes(a.name))) : view.facets[key];
        const previewCount = key === "institution" ? Math.max(5, chosen.length) : options.length;
        const remaining = options.slice(previewCount);
        const optionList = (rows: typeof options) => `<ul>${rows.map(({ name, count: matches }) => `<li><label class="facet-option">
          <input form="${formId}" type="checkbox" name="${key}" value="${html(name)}"${chosen.includes(name) ? " checked" : ""}>
          <span>${html(key === "owner" ? `@${name}` : name)}</span><span class="option-count">${count(matches)}</span>
        </label></li>`).join("")}</ul>`;
        return `<details class="facet" id="directory-${key}"${open ? " open" : ""}>
          <summary>${facetLabels[key]}${selected[key]?.length ? ` <span class="selected-count">${count(selected[key].length)}</span>` : ""}</summary>
          ${key === "county" ? `<p id="county-coverage" class="muted">${count(view.countyKnown)} of ${count(view.total)} projects in this collection have a known county.</p>` : ""}
          ${key === "label" ? `<a class="label-help" href="${methodPath}#regional-evidence">What these labels mean</a>` : ""}
          <fieldset${key === "county" ? ' aria-describedby="county-coverage"' : ""}>
            <legend class="sr-only">${facetLabels[key]}</legend>
            ${optionList(options.slice(0, previewCount))}
            ${remaining.length ? `<details class="facet-more" id="directory-institution-more">
              <summary><span class="facet-more-expand">Show ${count(remaining.length)} more institutions</span><span class="facet-more-collapse">Show fewer institutions</span></summary>
              ${optionList(remaining)}
            </details>` : ""}
          </fieldset>
        </details>`;
      }).join("")}
      <label class="check-control"><input form="${formId}" type="checkbox" name="paper" value="1"${view.query.paper ? " checked" : ""}> Has a paper</label>
      <label class="date-control" for="directory-since">Updated since
        <input form="${formId}" type="date" id="directory-since" name="since" value="${html(view.query.since)}">
        <span class="muted">Uses the last code push when available.</span>
      </label>
      <button class="button secondary filter-apply" type="submit" form="${formId}">Apply filters</button>
    </div>
  </details>`;
}

function filterChips(query: DirectoryQuery, base: string) {
  const link = (text: string, next: DirectoryQuery) =>
    `<li><a class="filter-chip" href="${href(next, base)}" data-directory-link aria-label="Remove ${html(text)}">${html(text)} <span aria-hidden="true">×</span></a></li>`;
  const chips = [
    query.q && link(`Search: ${query.q}`, withoutFilter(query, "q")),
    ...fields.flatMap(field => (query.facets[field] ?? []).map(value => link(`${facetLabels[field]}: ${value}`, withoutFilter(query, field, value)))),
    query.paper && link("Has a paper", withoutFilter(query, "paper")),
    query.since && link(`Updated since ${query.since}`, withoutFilter(query, "since")),
  ].filter(Boolean).join("");
  return chips ? `<div class="active-filters"><ul aria-label="Active filters">${chips}</ul>
    <a class="reset-link" href="${href({ sort: query.sort === "relevance" ? "updated" : query.sort, view: query.view }, base)}" data-directory-link>Clear all filters</a></div>` : "";
}

function sortControl(view: Results) {
  const options = [
    ["updated", "Recently updated"],
    ["name", "Name A–Z"],
    ...(view.query.q.match(/[\p{L}\p{N}]/u) ? [["relevance", "Relevance"]] : []),
    ...(view.hasStars ? [["stars", "Most stars"]] : []),
    ...(view.hasAdded ? [["added", "Most recently added"]] : []),
  ];
  return `<div class="sort-control"><label for="directory-sort">Sort</label>
    <select class="sort-value" form="${formId}" name="sort" id="directory-sort">
      ${options.map(([value, label]) => `<option value="${value}"${view.query.sort === value ? " selected" : ""}>${label}</option>`).join("")}
    </select>
    <noscript><button class="button secondary" type="submit" form="${formId}">Sort projects</button></noscript>
  </div>`;
}

function pagination(view: Results, base: string) {
  if (view.pageCount < 2) return "";
  const { page } = view.query;
  const pages = [...new Set([1, ...[page - 1, page, page + 1].filter(value => value > 1 && value < view.pageCount), view.pageCount])];
  const pageLink = (target: number, label: string, rel?: string) =>
    `<a href="${href({ ...view.query, page: target }, base)}" data-directory-link data-page-link${rel ? ` rel="${rel}"` : ""}>${label}</a>`;
  return `<nav class="pagination" aria-label="Results pages">
    <div class="page-links">
      ${page > 1 ? pageLink(page - 1, "Previous", "prev") : ""}
      ${pages.map((value, index) => `${index > 0 && value > pages[index - 1] + 1 ? '<span aria-hidden="true">…</span>' : ""}
        ${page === value ? `<span class="current-page" aria-current="page">${count(value)}</span>`
        : pageLink(value, count(value))}`).join("")}
      ${page < view.pageCount ? pageLink(page + 1, "Next", "next") : ""}
    </div>
    <form class="page-jump" id="directory-jump" action="${html(base)}" method="get">
      ${Array.from(directoryParams({ ...view.query, page: 1 }), ([key, value]) => `<input type="hidden" name="${key}" value="${html(value)}">`).join("")}
      <label for="directory-page">Go to page</label><input type="number" id="directory-page" name="page" inputmode="numeric" min="1" max="${view.pageCount}" required>
      <span class="muted">of ${count(view.pageCount)}</span><button class="button secondary" type="submit">Go</button>
    </form>
  </nav>`;
}

function emptyResults(view: Results, base: string) {
  const next = view.suggestion;
  return `<div class="empty-result">
    <h3>No matching projects</h3>
    ${next ? `<p><a href="${href(next.query, base)}" data-directory-link>Remove ${html(next.label)}</a> to see ${projectCount(next.count)}.</p>`
    : `<p>Try a shorter search term or <a href="${href({ view: view.query.view }, base)}" data-directory-link>clear all filters</a>.</p>`}
  </div>`;
}

export function renderResultsRegion(catalog: DirectoryCatalog, view: Results) {
  const base = view.scope ? entityPath(view.scope.entity) : browsePath;
  const heading = view.scope ? "Projects in this collection" : "Search results";
  const compact = view.query.view === "compact";
  const first = (view.query.page - 1) * pageSize + 1;
  const range = view.matchCount > pageSize ? ` · ${count(first)}–${count(first + view.projects.length - 1)}` : "";
  const head = resultsHead(view);
  return `<div id="directory-results" data-directory-title="${html(head.title)}" data-directory-description="${html(head.description)}" data-directory-canonical="${html(head.canonical)}">
    <form id="${formId}" class="results-search" role="search" action="${html(base)}" method="get">
      ${view.query.view ? `<input type="hidden" name="view" value="${view.query.view}">` : ""}
      ${searchInput(view.query.q)}
    </form>
    <div class="results-layout">
      <aside class="filters-aside" aria-label="Project filters">${facetControls(view)}</aside>
      <section class="results-content" aria-labelledby="results-heading">
        <h2 class="sr-only" id="results-heading" tabindex="-1">${heading}</h2>
        <div class="results-toolbar">
          <p class="results-count"><strong>${projectCount(view.matchCount)}</strong>${range ? `<span class="muted">${range}</span>` : ""}</p>
          <div class="result-controls">${sortControl(view)}
            <nav class="view-switch" aria-label="Results layout">
              <a href="${href({ ...view.query, view: "cards" }, base)}" data-directory-link data-view-link="cards"${compact ? "" : ' aria-current="true"'}>Cards</a>
              <a href="${href({ ...view.query, view: "compact" }, base)}" data-directory-link data-view-link="compact"${compact ? ' aria-current="true"' : ""}>Compact</a>
            </nav>
          </div>
        </div>
        ${filterChips(view.query, base)}
        ${view.projects.length ? projectCards(catalog, view.projects, compact ? "compact" : "cards") : emptyResults(view, base)}
        ${pagination(view, base)}
      </section>
    </div>
  </div>`;
}

export function renderDirectoryResults(catalog: DirectoryCatalog, view: Results) {
  return `<div class="frame page results-page">
    ${view.scope ? `<nav class="breadcrumb" aria-label="Directory breadcrumb"><a href="${browsePath}">All projects</a><span aria-hidden="true">/</span><span>${html(scopeName(view)!)}</span></nav>${entityOverview(catalog, view)}`
      : '<div class="results-intro"><h1>Research directory</h1><p>Explore research projects connected to the nine-county Delaware Valley.</p></div>'}
    ${view.scope && ["institution","topic"].includes(view.scope.entity.kind) ? `<p><a href="/discover/updates.xml?${view.scope.entity.kind}=${view.scope.entity.slug}">Follow additions via RSS</a></p>` : ""}
    ${view.scope?.entity.kind === "county" && view.total === 0 ? `<section class="empty-result county-empty"><h2>No projects listed yet</h2>
      <p>The directory currently has no projects with a recorded connection to ${html(scopeName(view)!)}. ${contactLink("Suggest a project", undefined, `Project submission for ${scopeName(view)}`)}.</p>
      <a class="button secondary" href="${browsePath}">Browse all projects</a></section>`
    : `<p class="sr-only" id="directory-live" role="status" aria-live="polite" aria-atomic="true"></p>${renderResultsRegion(catalog, view)}`}
  </div>`;
}
