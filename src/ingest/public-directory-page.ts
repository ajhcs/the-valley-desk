import {
  activityCutoff, apiPath, browsePath, counties, githubAccount, httpsUrl, lastActivity, methodPath, paperUrl, projectPapers, projectPath,
  type DirectoryCatalog, type DirectoryProject,
} from "./public-directory-data";
import { renderDirectoryHome } from "./public-directory-home";
import { renderDirectoryResults, resultsHead } from "./public-directory-results";
import {
  contactLink, count, entityLink, externalLink, facetHref, html, labelDefinitions, projectCards,
  projectPlace, regionalLabel, timestamp,
} from "./public-directory-ui";

export type DirectoryView =
  | { kind: "home"; data: ReturnType<DirectoryCatalog["home"]> }
  | { kind: "results"; data: ReturnType<DirectoryCatalog["list"]> }
  | { kind: "project"; project: DirectoryProject; related: ReturnType<DirectoryCatalog["related"]>; now: Date }
  | { kind: "methodology" }
  | { kind: "removed" | "not-found" | "unavailable" };

const siteName = "The Valley Desk";
const description = "A public directory of health technology, biomedicine and life sciences software connected to the nine-county Delaware Valley.";

function header(view: DirectoryView) {
  return `<a class="skip-link" href="#main">Skip to content</a>
    <header class="directory-chrome desk-masthead">
      <div class="desk-frame desk-masthead-inner">
        <a class="desk-brand" href="/"${view.kind === "home" ? ' aria-current="page"' : ""}>
          <img class="desk-mark" src="/mark-a-fold.svg" alt="" width="36" height="36">
          <span class="desk-wordmark"><span>The</span><strong>Valley Desk</strong></span>
        </a>
        <nav class="desk-primary" aria-label="Primary"><a href="${browsePath}"${view.kind === "results" && !view.data.scope ? ' aria-current="page"' : ""}>Projects</a></nav>
        <div class="desk-theme" hidden>
          <label for="directory-theme">Theme</label>
          <select id="directory-theme">
            <option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option>
          </select>
        </div>
      </div>
    </header>`;
}

function footer() {
  return `<footer class="directory-chrome desk-footer">
    <div class="desk-frame desk-footer-inner">
      <a class="desk-footer-brand" href="/">The Valley Desk</a>
      <nav class="desk-footer-links" aria-label="Footer">
        <a href="${browsePath}">Projects</a><a href="${methodPath}">Methodology</a><a href="mailto:leads@thevalleydesk.org">Leads</a>
        <a href="/feed.json">feed.json</a><a href="/feed.xml">feed.xml</a>
      </nav>
      <p class="desk-footer-copy">© thedeskgroup - <a href="https://ushso.org/">USHSO.org</a></p>
    </div>
  </footer>`;
}

function projectDetail(catalog: DirectoryCatalog, { project, related, now }: Extract<DirectoryView, { kind: "project" }>) {
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
  return `<article class="frame page project-page">
    <nav class="breadcrumb" aria-label="Directory breadcrumb">
      <a href="${browsePath}">All projects</a><span aria-hidden="true">/</span>${entityLink(catalog, "topic", project.topic)}
    </nav>
    <header class="project-intro">
      <div>
        <h1>${html(project.name)}</h1>
        ${place || county ? `<p class="project-place">${[place, county].filter(Boolean).join('<span class="separator" aria-hidden="true"> / </span>')}</p>` : ""}
      </div>
      <div class="project-actions">
        ${externalLink(project.code, "View code on GitHub ↗", "button primary")}
        ${externalLink(project.homepage, "Project website ↗", "button secondary")}
      </div>
      <p class="project-purpose">${html(project.purpose)}</p>
      ${repositoryState ? `<p class="archive-mark detail-archive">${html(repositoryState)}</p>` : ""}
    </header>
    <div class="project-info">
      <div>
        <section class="detail-section" aria-labelledby="connection-title">
          <h2 id="connection-title">Regional connection</h2>
          <div class="evidence-explanation">${regionalLabel(project)}<span>${labelDefinitions[project.label]}</span></div>
          ${project.connection ? `<p>${html(project.connection)}</p>` : ""}
          <div class="detail-links">${externalLink(project.source, "View regional source ↗")}<a href="${methodPath}#regional-evidence">Read the methodology</a></div>
          ${timestamp(project.checked) ? `<p class="muted">Source checked ${timestamp(project.checked)}</p>` : ""}
        </section>
        ${papers.length ? `<section class="detail-section" aria-labelledby="paper-title">
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
      ${facts.length ? `<section class="detail-section repo-facts" aria-labelledby="metadata-title">
        <h2 id="metadata-title">Repository facts</h2>
        <dl>${facts.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("")}</dl>
      </section>` : ""}
    </div>
    ${related.sameLab.length ? `<section class="related-projects">
      <div class="section-heading"><h2>More from this lab or account</h2>${account ? entityLink(catalog, "lab", account, "View account projects") : ""}</div>
      ${projectCards(catalog, related.sameLab)}
    </section>` : ""}
    ${related.sameTopic.length ? `<section class="related-projects">
      <div class="section-heading"><h2>Related work at the same institution</h2></div>
      ${projectCards(catalog, related.sameTopic)}
    </section>` : ""}
    <p class="project-report">${contactLink("Report a correction or request removal", project)}</p>
  </article>`;
}

function methodology() {
  const places = (state: "PA" | "NJ") => counties.filter(county => county.state === state)
    .map(county => `<a href="/discover/county/${county.name.toLowerCase()}">${county.name}</a>`).join(", ");
  return `<article class="frame page prose-page">
    <nav class="breadcrumb" aria-label="Directory breadcrumb"><a href="${browsePath}">All projects</a></nav>
    <h1>Directory methodology</h1>
    <p class="prose-intro">The Valley Desk indexes public GitHub repositories building health technology, biomedical or life sciences software with a documented Delaware Valley connection.</p>
    <section>
      <h2>What gets listed</h2>
      <p>A repository must contain its own work and have a plausible health, biomedical or life sciences purpose described in the repository or a linked source. A roster, an institution’s page or a releasing paper with a regional affiliation must connect the project to the region.</p>
      <p>Empty repositories, coursework, personal configuration, unmodified forks and general-purpose mirrors are excluded.</p>
    </section>
    <section id="regional-evidence">
      <h2>Regional evidence</h2>
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
      <p>County counts include projects with a source-supported county. Activity uses the last code push when captured, or the GitHub repository update date otherwise. Repository update dates can reflect changes besides code. Missing language, license, paper and county fields are omitted from project summaries.</p>
    </section>
    <section>
      <h2>Corrections, removals and submissions</h2>
      <p>${contactLink("Email the directory team")} with the GitHub URL and, for a correction or submission, a source for the regional connection. For a removal request, include the project URL or directory ID and the reason for the request.</p>
    </section>
    <section id="data">
      <h2>Machine-readable directory</h2>
      <p><a href="${apiPath}">Download the project catalog as JSON</a>. It returns a <code>projects</code> array. Use <code>${apiPath}/{id}</code> for a single <code>project</code> by GitHub repository ID.</p>
      <p>Both support GET and HEAD. Removed projects are excluded from the catalog and return HTTP 410 at their own URL. The endpoints return HTTP 503 when removal records are unavailable.</p>
      <p><a href="/sitemap.xml">Sitemap</a> · <a href="/llms.txt">llms.txt</a></p>
    </section>
  </article>`;
}

const messages = {
  "removed": ["Project removed", "This project is no longer listed in the directory."],
  "not-found": ["Page not found", "The link may be old or mistyped. You can still search the directory."],
  "unavailable": ["Directory temporarily unavailable", "Please try again in a few minutes."],
} as const;

function pageHead(view: DirectoryView, origin: string) {
  const url = (path: string) => origin + path;
  const basic = (title: string, summary: string, path?: string) => ({
    title, description: summary, canonical: path, schema: undefined as Record<string, unknown> | undefined,
  });
  switch (view.kind) {
    case "home":
      return { ...basic("Health technology in the Delaware Valley", description, "/"),
        schema: { "@type": "WebSite", name: siteName, url: url("/"), description } };
    case "results": {
      const head = resultsHead(view.data);
      return { ...head, schema: { "@type": "CollectionPage", url: url(head.canonical), name: head.title, description: head.description } };
    }
    case "project": {
      const { project } = view;
      const path = projectPath(project);
      const repo = httpsUrl(project.code);
      const homepage = httpsUrl(project.homepage);
      const license = httpsUrl(project.license);
      const citations = projectPapers(project).flatMap(paper => paperUrl(paper) ?? []);
      return { ...basic(project.name, project.purpose, path), schema: {
        "@type": "SoftwareSourceCode", name: project.name, description: project.purpose, url: url(path),
        ...(repo ? { codeRepository: repo } : {}), ...(homepage ? { sameAs: homepage } : {}),
        programmingLanguage: project.language || undefined, license,
        dateModified: project.updated || project.pushed || undefined, dateCreated: project.created || undefined,
        citation: citations.length ? citations : undefined,
      } };
    }
    case "methodology": {
      const head = basic("Directory methodology", "How projects are selected, what regional evidence means and how to request a correction or removal.", methodPath);
      return { ...head, schema: { "@type": "AboutPage", name: head.title, url: url(methodPath), description: head.description } };
    }
    default: return basic(messages[view.kind][0], messages[view.kind][1]);
  }
}

function jsonLd(schema: Record<string, unknown> | undefined, nonce?: string) {
  if (!schema) return "";
  const safe = JSON.stringify({ "@context": "https://schema.org", ...schema }).replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
  return `<script id="directory-schema" type="application/ld+json"${nonce ? ` nonce="${html(nonce)}"` : ""}>${safe}</script>`;
}

export function renderDirectoryPage(view: DirectoryView, catalog: DirectoryCatalog, origin: string, nonce?: string) {
  let content: string;
  switch (view.kind) {
    case "home": content = renderDirectoryHome(catalog, view.data); break;
    case "results": content = renderDirectoryResults(catalog, view.data); break;
    case "project": content = projectDetail(catalog, view); break;
    case "methodology": content = methodology(); break;
    default: {
      const [title, message] = messages[view.kind];
      content = `<section class="frame page message-page"><h1>${title}</h1><p>${message}</p>
        <a class="button primary" href="${browsePath}">Browse projects</a></section>`;
    }
  }
  const head = pageHead(view, origin);
  const title = `${head.title} · ${siteName}`;
  const canonical = head.canonical ? origin + head.canonical : undefined;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${html(title)}</title>
    <meta name="description" content="${html(head.description)}">
    ${canonical ? `<link rel="canonical" href="${html(canonical)}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="${siteName}">
    <meta property="og:title" content="${html(title)}">
    <meta property="og:description" content="${html(head.description)}">
    <meta property="og:url" content="${html(canonical)}">
    <meta property="og:image" content="${html(origin)}/directory-share.png">
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="The Valley Desk, health technology in the Delaware Valley">` : '<meta name="robots" content="noindex">'}
    ${jsonLd(head.schema, nonce)}
    <script src="/theme.js"></script>
    <script src="/directory-theme.js" defer></script>
    ${view.kind === "results" || view.kind === "home" ? '<script src="/directory-search.js" defer></script>' : ""}
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600;700&amp;family=IBM+Plex+Serif:wght@400;500;600&amp;display=swap">
    <link rel="stylesheet" href="/directory-chrome.css">
    <link rel="stylesheet" href="/directory.css">
  </head>
  <body class="directory-site">
    ${header(view)}
    <main id="main" tabindex="-1">${content}</main>
    ${footer()}
  </body>
</html>`;
}
