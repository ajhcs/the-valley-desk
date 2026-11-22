import type { RetiredEditorialSection } from "../lib/editorial-retirement";
import {
  activityCutoff, apiPath, browsePath, counties, githubAccount, httpsUrl, lastActivity, methodPath, paperUrl, projectPapers, projectPath,
  type DirectoryCatalog, type DirectoryProject,
} from "./public-directory-data";
import type { Listing } from "./public-directory-research";
import { renderDirectoryHome } from "./public-directory-home";
import type { DirectorySummary, Names } from "./public-directory-entity";
import { renderDirectoryResults, resultsHead } from "./public-directory-results";
import {
  contactLink, count, entityLink, externalLink, facetHref, html, labelDefinitions, projectCards,
  projectPlace, regionalLabel, timestamp,
} from "./public-directory-ui";

export type DirectoryView =
  | {
      kind: "research"; title: string; summary: string; path: string; content: string;
      /** Defaults to path. Filtered views name themselves and carry robots "noindex, follow". */
      canonical?: string; robots?: string; schema?: Record<string, unknown> | Record<string, unknown>[];
      breadcrumbs?: [string, string][]; meta?: string; feed?: { title: string; href: string }; ogType?: string;
    }
  | { kind: "home"; publications?: number; latest?: Listing[]; data: ReturnType<DirectoryCatalog["home"]>; summary?: DirectorySummary; names?: Names; now?: Date }
  | { kind: "results"; data: ReturnType<DirectoryCatalog["list"]>; noindex?: boolean }
  | { kind: "project"; linked?: {url:string;title:string}[]; mentions?: {url:string;title:string}[]; project: DirectoryProject; related: ReturnType<DirectoryCatalog["related"]>; now: Date }
  | { kind: "methodology"; publications?: boolean; studies?: boolean }
  | { kind: "retired"; section: RetiredEditorialSection }
  | { kind: "listing-removed" | "study-removed" | "removed" | "not-found" | "unavailable" };

const siteName = "The Valley Desk";
const description = "Find and follow healthcare research connected to the nine-county Delaware Valley.";

function current(view: DirectoryView) {
  if (view.kind === "methodology") return methodPath;
  if (view.kind === "research") return view.path === "/discover/new" ? "/discover/new" : view.path === browsePath ? browsePath : "";
  return view.kind === "results" && !view.data.scope ? browsePath : "";
}

function header(view: DirectoryView) {
  const here = current(view);
  const link = (path: string, label: string) => `<a href="${path}"${here === path ? ' aria-current="page"' : ""}>${label}</a>`;
  return `<a class="skip-link" href="#main">Skip to content</a>
    <header class="directory-chrome desk-masthead">
      <div class="desk-frame desk-masthead-inner">
        <a class="desk-brand" href="/"${view.kind === "home" ? ' aria-current="page"' : ""}>
          <img class="desk-mark" src="/mark-a-fold.svg" alt="" width="32" height="32">
          <span class="desk-wordmark">The Valley Desk</span>
        </a>
        <nav class="desk-primary" aria-label="Primary">${link(browsePath, "Search")}${link("/discover/new", "What’s new")}${link(methodPath, "Methodology")}</nav>
      </div>
    </header>`;
}

function footer() {
  return `<footer class="directory-chrome desk-footer">
    <div class="desk-frame desk-footer-inner">
      <p class="desk-footer-about"><a class="desk-footer-brand" href="/">The Valley Desk</a> lists healthcare research with a documented connection to Bucks, Chester, Delaware, Montgomery and Philadelphia counties in Pennsylvania and Burlington, Camden, Gloucester and Mercer counties in New Jersey.</p>
      <nav class="desk-footer-links" aria-label="Footer">
        <a href="${browsePath}">Search</a><a href="/discover/new">What’s new</a><a href="${methodPath}">Methodology</a><a href="/discover/updates.xml">RSS</a><a href="${methodPath}#data">Data and API</a><a href="/llms.txt">llms.txt</a>
      </nav>
      <div class="desk-theme">
        <label for="directory-theme">Theme</label>
        <select id="directory-theme">
          <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
        </select>
      </div>
      <p class="desk-footer-copy">© thedeskgroup - <a href="https://ushso.org/">USHSO.org</a></p>
    </div>
  </footer>`;
}

function projectDetail(catalog: DirectoryCatalog, { project, related, now, linked, mentions }: Extract<DirectoryView, { kind: "project" }>) {
  const activity = lastActivity(project);
  const place = projectPlace(catalog, project);
  const papers = projectPapers(project);
  const county = project.county && entityLink(catalog, "county", project.county, `${project.county} County`);
  const account = githubAccount(project);
  const tags = project.topics?.map(tag => `<a href="${facetHref("tag", tag)}">${html(tag)}</a>`).join(" · ");
  const pushed = timestamp(project.pushed);
  const updated = timestamp(project.updated);
  const facts = [
    ["Language", project.language && `<a href="${facetHref("language", project.language)}">${html(project.language)}</a>`],
    ["License", project.license && `<a href="${facetHref("license", project.license)}">${html(project.license)}</a>`],
    ["Last code push", pushed],
    ["Last repository update", updated],
    ["Created", timestamp(project.created)],
    ["Added to directory", timestamp(project.added)],
    ["GitHub stars at capture", project.stars != null ? count(project.stars) : ""],
    ["Archive status", project.archived === true ? "Archived" : project.archived === false ? "Not archived" : ""],
    ["GitHub topics", tags],
  ].filter(([, value]) => value);
  const repositoryState = project.archived === true ? "Archived on GitHub"
    : activity && activity < activityCutoff(now, 2) ? `Last recorded activity in ${activity.slice(0, 4)}` : "";
  return `<article class="frame page record-page project-page">
    <nav class="breadcrumb" aria-label="Breadcrumb">
      <a href="${browsePath}">Directory</a><span aria-hidden="true">/</span>${entityLink(catalog, "topic", project.topic)}
    </nav>
    <header class="record-head">
      <p class="record-kind"><span class="kind">Software</span>${project.language ? `<span>${html(project.language)}</span>` : ""}${pushed ? `<span>Code pushed ${pushed}</span>` : ""}</p>
      <h1>${html(project.name)}</h1>
      <p class="lede">${html(project.purpose)}</p>
      ${place || county ? `<p class="record-place">${[place, county].filter(Boolean).join('<span class="separator" aria-hidden="true"> · </span>')}</p>` : ""}
      ${repositoryState ? `<p class="archive-mark detail-archive">${html(repositoryState)}</p>` : ""}
      <p class="record-actions">${externalLink(project.code, "View code on GitHub ↗", "button primary")} ${externalLink(project.homepage, "Project website ↗", "button secondary")}</p>
    </header>
    <div class="record-body">
      <div>
        <section class="record-section" aria-labelledby="connection-title">
          <h2 id="connection-title">Regional connection</h2>
          <p class="record-evidence">${regionalLabel(project)} <span class="muted">${labelDefinitions[project.label]}</span></p>
          ${project.connection ? `<p>${html(project.connection)}</p>` : ""}
          <p class="detail-links">${externalLink(project.source, "View regional source ↗")}<a href="${methodPath}#regional-evidence">How regional evidence is labelled</a></p>
          ${timestamp(project.checked) ? `<p class="muted">Source checked ${timestamp(project.checked)}</p>` : ""}
        </section>
        ${linked?.length ? `<section class="record-section"><h2>Publications in the directory</h2><ul class="plain-list">${linked.map(p => `<li><a href="${html(p.url)}">${html(p.title)}</a></li>`).join("")}</ul></section>` : ""}
        ${mentions?.length ? `<section class="record-section" aria-labelledby="mentions-title"><h2 id="mentions-title">Papers that link to this repository</h2><p class="muted">The full text of each paper links to this repository. A link can be a citation or use, not only a release.</p><ul class="plain-list">${mentions.map(p => `<li><a href="${html(p.url)}">${html(p.title)}</a></li>`).join("")}</ul></section>` : ""}
        ${papers.length ? `<section class="record-section" aria-labelledby="paper-title">
          <h2 id="paper-title">${papers.length === 1 ? "Paper" : "Papers"}</h2>
          <ul class="papers">${papers.map(paper => {
            const url = paperUrl(paper);
            const doi = paper.doi || (url?.startsWith("https://doi.org/") ? url.slice("https://doi.org/".length) : "");
            const title = paper.title || (doi ? `DOI ${doi}` : "Read the linked paper");
            const citation = [paper.venue, paper.year, paper.title && doi ? `DOI ${doi}` : ""].filter(Boolean);
            return `<li><cite>${externalLink(url, title) || html(title)}</cite>
              ${citation.length ? `<p>${html(citation.join(" · "))}</p>` : ""}</li>`;
          }).join("")}</ul>
        </section>` : ""}
      </div>
      ${facts.length ? `<section class="record-section repo-facts" aria-labelledby="metadata-title">
        <h2 id="metadata-title">Repository facts</h2>
        <dl class="facts">${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl>
      </section>` : ""}
    </div>
    ${related.sameLab.length ? `<section class="related">
      <div class="section-heading"><h2>More from this lab or account</h2>${account ? entityLink(catalog, "lab", account, "All projects from this account") : ""}</div>
      ${projectCards(catalog, related.sameLab)}
    </section>` : ""}
    ${related.sameTopic.length ? `<section class="related">
      <div class="section-heading"><h2>Related work at the same institution</h2></div>
      ${projectCards(catalog, related.sameTopic)}
    </section>` : ""}
    <p class="record-report">${contactLink("Report a correction or request removal", project)}</p>
  </article>`;
}

function methodology(publications = false, studies = false) {
  const places = (state: "PA" | "NJ") => counties.filter(county => county.state === state)
    .map(county => `<a href="/discover/county/${county.name.toLowerCase()}">${county.name}</a>`).join(", ");
  return `<article class="frame page prose-page">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${browsePath}">Directory</a></nav>
    <h1>Methodology</h1>
    <p class="lede">How listings are chosen, what the regional evidence labels mean, which dates are recorded, and how to correct or remove a listing. The date added records when a listing entered the directory. Published records when a paper appeared. Pushed records when code last changed.</p>
    <section>
      <h2>What gets listed</h2>
      ${publications ? `<p>A publication needs a persistent DOI, PubMed ID or preprint identifier, a health or life-science subject, and a regional institution named in the affiliation metadata. Corrections and retraction notices are excluded. An eligible paper that has been retracted carries a retraction label. Linked preprint and journal versions have separate records and count once in publication totals.</p>` : ""}
      <p>A repository must contain its own work and have a plausible health, biomedical or life sciences purpose described in the repository or a linked source. A roster, an institution’s page or a releasing paper with a regional affiliation must connect the project to the region.</p>
      <p>Empty repositories, coursework, personal configuration, unmodified forks and general-purpose mirrors are excluded.</p>
      ${publications ? `<p>Projects and publications use eight health topics. A publication that the topic rules cannot place in a health topic carries the label Other science. It remains searchable and appears on institution and county pages, but it has no topic page or topic feed.</p>` : ""}
      ${studies ? `<p>The clinical studies index includes interventional trials, observational studies and expanded access records from ClinicalTrials.gov. A study needs at least one registry-listed facility in a supported county. We use the reported city and state, a corroborated institution site or a Census ZIP Code Tabulation Area contained in one county. Ambiguous locations are held until their county can be supported. Overall and site statuses come from the registry. Study listings can be searched by registry condition.</p>` : ""}
    </section>
    <section id="regional-evidence">
      <h2>Regional evidence</h2><p>For scholarly work, a Verified affiliation names the institution and a regional place, or a single-site regional institution. Listed indicates an indexer assignment or an institution match with an uncertain site. Company affiliations require a stated regional site. A county requires evidence placing the affiliation there. On multi-institution papers, filters match the institutions and counties recorded for the work. Follow the affiliation source to identify the site. A byline reports names as published.</p>
      <dl class="definition-list">
        <div id="verified"><dt>Verified</dt><dd>${labelDefinitions.Verified}</dd></div>
        <div id="listed"><dt>Listed</dt><dd>${labelDefinitions.Listed}</dd></div>
      </dl>
      <p>A label describes the evidence for the regional connection. Follow the project’s regional source for the specific claim. Placement in the directory does not establish ownership, employment, a worksite or clinical validation.</p>
    </section>
    <section>
      <h2>Regional and repository coverage</h2>
      <p><strong>Pennsylvania</strong> ${places("PA")}.</p>
      <p><strong>New Jersey</strong> ${places("NJ")}.</p>
      <p>County counts include listings with a source-supported county. Activity uses the last code push when captured, or the GitHub repository update date otherwise. Repository update dates can reflect changes besides code. Missing language, license, paper and county fields are omitted from project summaries.</p>
    </section>
    <section>
      <h2>Corrections, removals and submissions</h2>
      <p>${contactLink("Email the directory team")} with the listing URL or persistent identifier and, for a correction or submission, a source for the regional connection. For a removal request, include the listing URL or directory ID and the reason for the request.</p>
    </section>
    <section id="citing">
      <h2>Citing a listing</h2>
      <p>Cite the publication or repository itself, using the publisher link or DOI on its page. To cite the regional connection, give the directory page URL, its evidence label and the date you accessed it. Counts on institution, topic and county pages are computed when the page is requested and change as listings are added or removed.</p>
    </section>
    <section id="data">
      <h2>Machine-readable directory</h2><p><a href="/discover/updates.xml">Subscribe to directory additions</a>. Institution, topic and county pages offer scoped feeds.</p>
      <p><a href="${apiPath}">Download the project catalog as JSON</a>. It returns a <code>projects</code> array. Use <code>${apiPath}/{id}</code> for a single <code>project</code> by GitHub repository ID.</p>
      ${publications ? `<p><a href="/api/directory/publications">Browse publication records as JSON</a>. Results include distinct work and record totals, with up to 24 records per page.</p>` : ""}
      ${studies ? `<p><a href="/api/directory/studies">Browse clinical studies as JSON</a>. Look up one study with <code>/api/directory/studies/{NCTId}</code>.</p>` : ""}
      <p><a href="/api/directory/listings">Read directory additions as JSON</a>. Use the institution, topic, county and kind filters to narrow a feed or JSON listing.</p>
      <p>The endpoints support GET and HEAD. Removed projects are excluded from the catalog and return HTTP 410 at their own URL. The endpoints return HTTP 503 when removal records are unavailable.</p>
      <p>Search engines and AI assistants may crawl and cite the public pages. <a href="/robots.txt">robots.txt</a> states the crawler policy, <a href="/llms.txt">llms.txt</a> summarizes the site for language-model tools, and the <a href="/sitemap.xml">sitemap</a> lists every public page.</p>
      <p><a href="/discover/connect">Connect an AI assistant</a> to search the directory through its read-only MCP server at <code>/mcp</code>.</p>
    </section>
  </article>`;
}

const messages = {
  "listing-removed": ["Publication removed","This publication has been removed from the directory."],
  "study-removed": ["Clinical study removed", "This study has been removed from the directory."],
  "removed": ["Project removed", "This project is no longer listed in the directory."],
  "not-found": ["Page not found", "The link may be old or mistyped. You can still search the directory."],
  "unavailable": ["Directory temporarily unavailable", "Please try again in a few minutes."],
} as const;

function pageMessage(view: Extract<DirectoryView, { kind: "retired" | keyof typeof messages }>): readonly [string, string] {
  return view.kind === "retired"
    ? [`${view.section} is retired`, "Find regional healthcare research or follow new listings in the directory."]
    : messages[view.kind];
}

type Schema = Record<string, unknown>;
type Head = {
  title: string; description: string; canonical?: string; robots?: string; schema: Schema[];
  meta?: string; feed?: { title: string; href: string }; ogType?: string;
};

export function breadcrumbSchema(origin: string, crumbs: [string, string][]): Schema {
  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: origin + path })),
  };
}

/** The directory as a catalogue of two datasets, described from the public endpoints. */
export function dataCatalogSchema(origin: string, publications: boolean): Schema {
  const dataset = (name: string, description: string, api: string) => ({
    "@type": "Dataset", name, description, url: origin + browsePath, isAccessibleForFree: true,
    spatialCoverage: { "@type": "Place", name: "Delaware Valley: Bucks, Chester, Delaware, Montgomery and Philadelphia counties, Pennsylvania; Burlington, Camden, Gloucester and Mercer counties, New Jersey" },
    distribution: { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: origin + api },
  });
  return {
    "@type": "DataCatalog", "@id": origin + "/#catalog", name: "The Valley Desk research directory", url: origin + browsePath,
    description: "Healthcare research connected to the nine-county Delaware Valley, with the source of each regional connection.",
    publisher: { "@type": "Organization", name: siteName, url: origin + "/" },
    dataset: [
      ...(publications ? [dataset("Regional healthcare publications", "Scholarly publications with an author affiliation at a Delaware Valley institution, with the affiliation source and evidence label.", "/api/directory/publications")] : []),
      dataset("Regional research software", "Public GitHub repositories with a health or life-science purpose and a documented connection to a Delaware Valley institution.", apiPath),
    ],
  };
}

function websiteSchema(origin: string): Schema {
  return {
    "@type": "WebSite", "@id": origin + "/#website", name: siteName, url: origin + "/", description, inLanguage: "en-US",
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${origin}${browsePath}?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
}

function hasQuery(view: Extract<DirectoryView, { kind: "results" }>) {
  const { q, paper, since, facets, page, sort } = view.data.query;
  return !!(q || paper || since || Object.keys(facets).length || page > 1 || (sort !== "updated" && sort !== "relevance"));
}

function pageHead(view: DirectoryView, origin: string, catalog: DirectoryCatalog): Head {
  const url = (path: string) => origin + path;
  const basic = (title: string, summary: string, path?: string): Head => ({ title, description: summary, canonical: path, schema: [] });
  switch (view.kind) {
    case "research": {
      const schemas = view.schema ? (Array.isArray(view.schema) ? view.schema : [view.schema]) : [];
      return {
        ...basic(view.title, view.summary, view.canonical ?? view.path), robots: view.robots, meta: view.meta, feed: view.feed, ogType: view.ogType,
        schema: [...schemas, ...(view.breadcrumbs ? [breadcrumbSchema(origin, view.breadcrumbs)] : [])],
      };
    }
    case "home": {
      const lede = view.summary ? homeDescription(view.summary) : description;
      return { ...basic("Healthcare research in the Delaware Valley", lede, "/"),
        schema: [websiteSchema(origin), dataCatalogSchema(origin, !!view.publications)] };
    }
    case "results": {
      const head = resultsHead(view.data);
      const scope = view.data.scope?.entity;
      return { ...head, robots: view.noindex || hasQuery(view) ? "noindex, follow" : undefined,
        feed: scope && (scope.kind === "institution" || scope.kind === "topic")
          ? { title: `Additions: ${head.title}`, href: `/discover/updates.xml?${scope.kind}=${scope.slug}` } : undefined,
        schema: [
          { "@type": "CollectionPage", url: url(head.canonical), name: head.title, description: head.description, isPartOf: { "@id": origin + "/#website" } },
          breadcrumbSchema(origin, [["Directory", browsePath], ...(scope ? [[head.title.split(" · ")[0], head.canonical] as [string, string]] : [])]),
        ] };
    }
    case "project": {
      const { project } = view;
      const path = projectPath(project);
      const repo = httpsUrl(project.code);
      const homepage = httpsUrl(project.homepage);
      const license = httpsUrl(project.license);
      const citations = projectPapers(project).flatMap(paper => paperUrl(paper) ?? []);
      const where = [project.institution, project.county && `${project.county} County`].filter(Boolean).join(", ");
      return { ...basic(project.name, `${project.purpose}${/[.!?]$/.test(project.purpose) ? "" : "."} Research software${where ? ` connected to ${where}` : ""} in The Valley Desk directory, with the source of its regional connection.`, path), ogType: "article", schema: [{
        "@type": "SoftwareSourceCode", name: project.name, description: project.purpose, url: url(path),
        ...(repo ? { codeRepository: repo } : {}), ...(homepage ? { sameAs: homepage } : {}),
        programmingLanguage: project.language || undefined, license,
        dateModified: project.updated || project.pushed || undefined, dateCreated: project.created || undefined,
        keywords: project.topics?.length ? project.topics.join(", ") : undefined, about: project.topic,
        ...(project.institution ? { sourceOrganization: { "@type": "Organization", name: project.institution } } : {}),
        citation: citations.length ? citations : undefined,
      }, breadcrumbSchema(origin, [["Directory", browsePath], [project.topic, catalog.entityHref("topic", project.topic)], [project.name, path]])] };
    }
    case "methodology": {
      const head = basic("Methodology", "How The Valley Desk selects healthcare research listings, what Verified and Listed regional evidence means, which dates it records, and how to request a correction or removal.", methodPath);
      return { ...head, schema: [
        { "@type": "AboutPage", name: head.title, url: url(methodPath), description: head.description, isPartOf: { "@id": origin + "/#website" } },
        dataCatalogSchema(origin, !!view.publications),
        breadcrumbSchema(origin, [["Directory", browsePath], ["Methodology", methodPath]]),
      ] };
    }
    default: return basic(...pageMessage(view));
  }
}

function homeDescription(summary: DirectorySummary) {
  const pubs = summary.kinds.publication?.works ?? 0, projects = summary.kinds.project?.works ?? 0;
  const studies = summary.kinds.study?.works ?? 0;
  const holdings = studies
    ? `${count(pubs)} publications, ${count(projects)} research software projects and ${count(studies)} clinical studies`
    : `${count(pubs)} publications and ${count(projects)} research software projects`;
  return `${holdings} connected to the nine-county Delaware Valley in Pennsylvania and New Jersey. Search by institution, topic or county and follow new listings.`;
}

function jsonLd(schemas: Schema[], nonce?: string) {
  if (!schemas.length) return "";
  const value = schemas.length === 1 ? { "@context": "https://schema.org", ...schemas[0] } : { "@context": "https://schema.org", "@graph": schemas };
  const safe = JSON.stringify(value).replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
  return `<script id="directory-schema" type="application/ld+json"${nonce ? ` nonce="${html(nonce)}"` : ""}>${safe}</script>`;
}

export function renderDirectoryPage(view: DirectoryView, catalog: DirectoryCatalog, origin: string, nonce?: string) {
  let content: string;
  switch (view.kind) {
    case "research": content = view.content; break;
    case "home": content = renderDirectoryHome(catalog, view.data, view.publications, view.latest, view.summary, view.names, view.now); break;
    case "results": content = renderDirectoryResults(catalog, view.data); break;
    case "project": content = projectDetail(catalog, view); break;
    case "methodology": content = methodology(view.publications, view.studies); break;
    default: {
      const [title, message] = pageMessage(view);
      content = `<section class="frame page message-page"><h1>${html(title)}</h1><p>${html(message)}</p>
        <a class="button primary" href="${browsePath}">Browse research</a></section>`;
    }
  }
  const head = pageHead(view, origin, catalog);
  const title = `${head.title} · ${siteName}`;
  const canonical = head.canonical ? origin + head.canonical : undefined;
  const robots = canonical ? head.robots : "noindex";
  const feed = head.feed ?? { title: "Directory additions", href: "/discover/updates.xml" };
  return `<!doctype html>
<html lang="en-US">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${html(title)}</title>
    <meta name="description" content="${html(head.description)}">
    ${robots ? `<meta name="robots" content="${robots}">` : ""}
    ${canonical ? `<link rel="canonical" href="${html(canonical)}">
    <meta property="og:type" content="${head.ogType ?? "website"}">
    <meta property="og:site_name" content="${siteName}">
    <meta property="og:title" content="${html(title)}">
    <meta property="og:description" content="${html(head.description)}">
    <meta property="og:url" content="${html(canonical)}">
    <meta property="og:locale" content="en_US">
    <meta property="og:image" content="${html(origin)}/directory-share.png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="The Valley Desk, healthcare research in the Delaware Valley">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="alternate" type="application/rss+xml" title="${html(feed.title)}" href="${html(feed.href)}">` : ""}
    ${head.meta ?? ""}
    ${jsonLd(head.schema, nonce)}
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600&amp;family=IBM+Plex+Serif:wght@500;600&amp;display=optional">
    <link rel="stylesheet" href="/directory-chrome.css">
    <link rel="stylesheet" href="/directory.css">
    <script src="/theme.js"></script>
    <script src="/directory-theme.js" defer></script>
    <script src="/webmcp.js" defer></script>
    ${view.kind === "results" || view.kind === "home" ? '<script src="/directory-search.js" defer></script>' : ""}
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  </head>
  <body class="directory-site">
    ${header(view)}
    <main id="main" tabindex="-1">${content}</main>
    ${footer()}
  </body>
</html>`;
}
