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
    <label class="sr-only" for="directory-search">Search research listings</label>
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
    account && entityLink(catalog, "lab", account, lab || project.profileLocation || `GitHub: @${account}`),
    !account && lab && html(lab),
  ].filter(Boolean).join('<span class="separator" aria-hidden="true"> / </span>');
}

/** Publication dates keep their source precision: a year, a month or a day. */
const monthYear = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
export function partialDateText(value?: string | null) {
  if (!value) return "";
  if (/^\d{4}$/.test(value)) return value;
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return monthYear.format(new Date(`${value}-01T00:00:00Z`));
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && timestamp(value) ? dateFormat.format(new Date(`${value}T00:00:00Z`)) : "";
}
export function partialDate(value?: string | null) {
  const text = partialDateText(value);
  return text ? `<time datetime="${html(value!)}">${html(text)}</time>` : "";
}
export const dateText = (value?: string | null) => (timestamp(value) ? partialDateText(value) : "");

/**
 * Topics with a landing page, a feed and a place in the topic filter. "Other science" marks papers
 * the topic rules could not place in a health topic: it is a label on the record, searchable and
 * shown on institution and county pages, but it is not a browsable topic.
 */
export const otherTopic = "Other science";
export const otherTopicSlug = "other-science";
export const healthTopic = (topic?: string | null) =>
  !!topic && topic !== otherTopic && topic.toLowerCase().replace(/[^a-z0-9]+/g, "-") !== otherTopicSlug;

const kindDate = (project: DirectoryProject, dateField: "activity" | "added") => {
  const date = timestamp(dateField === "added" ? project.added : lastActivity(project));
  const label = dateField === "added" ? "Added" : lastActivity(project) === project.pushed ? "Code pushed" : "Updated";
  return date ? `<span>${label} ${date}</span>` : "";
};

/** One catalogue entry for a software project. Publications share the same structure. */
export function projectRecord(catalog: DirectoryCatalog, project: DirectoryProject, dateField: "activity" | "added" = "activity") {
  const place = projectPlace(catalog, project);
  return `<li class="record record-software">
    <p class="record-kind"><span class="kind">Software</span>${project.language ? `<a href="${facetHref("language", project.language)}">${html(project.language)}</a>` : ""}${project.license ? `<a href="${facetHref("license", project.license)}">${html(project.license)}</a>` : ""}${kindDate(project, dateField)}${project.archived === true ? '<span class="archive-mark">Archived</span>' : ""}</p>
    <h3 class="record-title"><a href="${html(projectPath(project))}">${html(project.name)}</a></h3>
    <p class="record-summary">${html(project.purpose)}</p>
    ${place ? `<p class="record-place">${place}</p>` : ""}
    <p class="record-evidence">${regionalLabel(project)}${project.connection ? ` ${html(project.connection)}` : ""}</p>
    <p class="record-topic">${entityLink(catalog, "topic", project.topic)}</p>
  </li>`;
}

export function projectCards(
  catalog: DirectoryCatalog, projects: readonly DirectoryProject[], variant: "cards" | "compact" = "cards", dateField: "activity" | "added" = "activity",
) {
  return `<ol class="records" data-view="${variant === "compact" ? "compact" : "full"}">${projects.map(project => projectRecord(catalog, project, dateField)).join("")}</ol>`;
}
