import {
  browsePath, directoryParams, githubAccount, httpsUrl, lastActivity, methodPath, projectPath,
  type DirectoryCatalog, type DirectoryProject, type DirectoryQuery, type EntityKind, type FacetKey,
} from "./public-directory-data";

const numberFormat = new Intl.NumberFormat("en-US");
const dateFormat = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
});

export const count = (value: number) => numberFormat.format(value);
export const projectCount = (value: number) => `${count(value)} ${value === 1 ? "project" : "projects"}`;

export const html = (value: string | number) => String(value).replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

export function href(query: Partial<DirectoryQuery> = {}, path = browsePath) {
  const params = directoryParams(query);
  return html(params.size ? `${path}?${params}` : path);
}

export const facetHref = (field: FacetKey, value: string) => href({ facets: { [field]: [value] } });

export function externalLink(value: string | null | undefined, label: string, className?: string) {
  const url = httpsUrl(value);
  return url ? `<a href="${html(url)}" rel="noreferrer"${className ? ` class="${html(className)}"` : ""}>${html(label)}</a>` : "";
}

export function entityLink(catalog: DirectoryCatalog, kind: EntityKind, name: string, label = name) {
  return `<a href="${html(catalog.entityHref(kind, name))}">${html(label)}</a>`;
}

export function timestamp(value?: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value
    ? `<time datetime="${html(value)}">${html(dateFormat.format(date))}</time>` : "";
}

export function contactLink(label: string, project?: DirectoryProject, subject?: string) {
  const title = subject ?? (project ? `Directory correction or removal for ${project.name}` : "Valley Desk directory feedback");
  const body = project ? `Project: ${project.name}\nDirectory ID: ${project.id}\nRepository: ${project.code}\n\n` : "";
  const params = new URLSearchParams({ subject: title, body });
  return `<a href="mailto:leads@thevalleydesk.org?${html(params.toString().replaceAll("+", "%20"))}">${html(label)}</a>`;
}

export const labelDefinitions = {
  Verified: "A source ties the exact repository to the region.",
  Listed: "A source shows a regional association through the GitHub account or lab.",
};

export function regionalLabel(project: DirectoryProject) {
  const verified = project.label === "Verified";
  return `<a class="evidence${verified ? " evidence-verified" : ""}" href="${methodPath}#${verified ? "verified" : "listed"}">${html(project.label)}</a>`;
}

export function searchInput(query = "") {
  return `<div class="search-box">
    <label class="sr-only" for="directory-search">Search projects</label>
    <svg class="search-icon" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>
    <input type="search" id="directory-search" name="q" value="${html(query)}" placeholder="Search the directory" maxlength="200">
    <button class="button primary" type="submit">Search</button>
  </div>`;
}

export function projectPlace(catalog: DirectoryCatalog, project: DirectoryProject) {
  const account = githubAccount(project);
  const lab = project.lab || project.owner?.name;
  return [
    project.institution && entityLink(catalog, "institution", project.institution),
    account && entityLink(catalog, "lab", account, lab || `GitHub: @${account}`),
    !account && lab && html(lab),
  ].filter(Boolean).join('<span class="separator" aria-hidden="true"> / </span>');
}

export function projectCards(
  catalog: DirectoryCatalog, projects: readonly DirectoryProject[], variant: "cards" | "compact" = "cards", dateField: "activity" | "added" = "activity",
) {
  return `<div class="project-grid" data-view="${variant}">${projects.map(project => {
    const place = projectPlace(catalog, project);
    const topic = entityLink(catalog, "topic", project.topic);
    const date = timestamp(dateField === "added" ? project.added : lastActivity(project));
    const dateLabel = dateField === "added" ? "Added" : lastActivity(project) === project.pushed ? "Pushed" : "Updated";
    return `<article class="project-card">
      <div class="card-lead">
        ${variant === "cards" ? `<div class="card-topic">${topic}</div>` : ""}
        <h3><a href="${html(projectPath(project))}">${html(project.name)}</a></h3>
        ${place ? `<p class="card-place">${place}</p>` : ""}
      </div>
      <p class="card-purpose">${html(project.purpose)}</p>
      <div class="card-meta">${regionalLabel(project)}
        ${variant === "compact" ? topic : ""}
        ${project.archived === true ? '<span class="archive-mark">Archived</span>' : ""}
        ${project.language ? `<a href="${facetHref("language", project.language)}">${html(project.language)}</a>` : ""}
        ${date ? `<span class="card-date">${dateLabel} ${date}</span>` : ""}
      </div>
    </article>`;
  }).join("")}</div>`;
}
