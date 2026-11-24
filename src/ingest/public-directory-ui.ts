import type { GuidanceStep } from "./directory-use-guidance";
import {
  browsePath, directoryParams, githubAccount, httpsUrl, lastActivity, methodPath, projectPath,
  type DirectoryCatalog, type DirectoryProject, type DirectoryQuery, type EntityKind, type FacetKey,
} from "./public-directory-data";
import { icon, topicIcon, type IconName } from "./public-directory-icons";

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

export function regionalLabel(project: { label: string }) {
  const verified = project.label === "Verified";
  return `<a class="evidence${verified ? " evidence-verified" : ""}" href="${methodPath}#${verified ? "verified" : "listed"}">${icon(verified ? "verified" : "listed")}${html(project.label)}</a>`;
}

/**
 * The evidence label as a single icon for listing cards. The connection sentence stays on the
 * listing's own page and in the tooltip; the card shows only who and where.
 */
export function evidenceMark(label: string, detail?: string | null) {
  const verified = label === "Verified";
  const text = detail ? `${label}: ${detail}` : label;
  return `<a class="evidence-mark${verified ? " is-verified" : ""}" href="${methodPath}#${verified ? "verified" : "listed"}" title="${html(text)}">${icon(verified ? "verified" : "listed")}<span class="sr-only">${html(text)}</span></a>`;
}

/** A short run of linked names after an icon, with a count for the rest. */
export function namedLinks(glyph: IconName, links: string[], shown = 3) {
  if (!links.length) return "";
  const rest = links.length - shown;
  return `<span class="meta-item">${icon(glyph)}<span>${links.slice(0, shown).join(", ")}${rest > 0 ? ` <span class="muted">+${count(rest)}</span>` : ""}</span></span>`;
}

/** A source link reduced to an icon, named for screen readers and on hover. */
export function sourceIcon(value: string | null | undefined, label: string) {
  const url = httpsUrl(value);
  return url ? `<a class="source-mark" href="${html(url)}" rel="noreferrer" title="${html(label)}">${icon("source")}<span class="sr-only">${html(label)}</span></a>` : "";
}

export function searchInput(query = "", placeholder = "Search the directory") {
  return `<div class="search-box">
    <label class="sr-only" for="directory-search">Search research listings</label>
    ${icon("search", undefined, "search-icon")}
    <input type="search" id="directory-search" name="q" value="${html(query)}" placeholder="${html(placeholder)}" maxlength="200">
    <button class="search-go" type="submit" aria-label="Search">${icon("arrow")}</button>
  </div>`;
}

/** The five kinds of listing, in the order every count line names them. */
export const ledgerKinds = [
  ["publication", "publication", "publication", "publications"],
  ["project", "software", "software project", "software projects"],
  ["study", "study", "clinical study", "clinical studies"],
  ["dataset", "dataset", "dataset", "datasets"],
  ["regional-data", "regional", "regional dataset", "regional datasets"],
] as const;
export type LedgerKind = (typeof ledgerKinds)[number][0];
export type LedgerEntry = { kind: LedgerKind; n: number; href?: string; current?: boolean };

/**
 * Counts by kind as one sentence, each figure led by its kind's mark: "82,134 publications,
 * 3,466 software projects and 32 regional datasets". The same marks label the listing cards, so
 * the count line doubles as a key. A figure with a link opens that kind's listings.
 */
export function kindLedger(entries: LedgerEntry[], tail = "") {
  const parts = ledgerKinds.flatMap(([kind, glyph, one, many]) => {
    const entry = entries.find((e) => e.kind === kind);
    if (!entry || !entry.n) return [];
    const body = `<span class="nowrap">${icon(glyph)}<b>${count(entry.n)}</b></span> ${entry.n === 1 ? one : many}`;
    const state = entry.current ? ' aria-current="true"' : "";
    return [`<span class="tally-item tally-${kind}">${entry.href && !entry.current ? `<a href="${html(entry.href)}">${body}</a>` : `<span${state}>${body}</span>`}</span>`];
  });
  if (!parts.length) return "";
  const sentence = parts.length < 3 ? parts.join(" and ") : parts.slice(0, -1).join(", ") + " and " + parts.at(-1);
  return `<p class="ledger">${sentence}${tail}</p>`;
}

export function projectPlace(catalog: DirectoryCatalog, project: DirectoryProject) {
  const account = githubAccount(project);
  const lab = project.lab || project.owner?.name;
  const item = (glyph: IconName, content: string) => `<span class="meta-item">${icon(glyph)}${content}</span>`;
  return [
    project.institution && item("institution", entityLink(catalog, "institution", project.institution)),
    account && item(lab ? "account" : project.profileLocation ? "place" : "account",
      entityLink(catalog, "lab", account, lab || project.profileLocation || `@${account}`)),
    !account && lab && item("account", html(lab)),
  ].filter(Boolean).join("");
}

export const kindIcon = (glyph: IconName, name: string) => `<span class="kind">${icon(glyph)}${html(name)}</span>`;
export const topicTag = (link: string, topic: string) => `<span class="meta-item">${topicIcon(topic)}${link}</span>`;

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
    <p class="record-kind">${kindIcon("software", "Software")}${project.language ? `<a href="${facetHref("language", project.language)}">${html(project.language)}</a>` : ""}${project.license ? `<a href="${facetHref("license", project.license)}">${html(project.license)}</a>` : ""}${kindDate(project, dateField)}${project.archived === true ? '<span class="archive-mark">Archived</span>' : ""}</p>
    <h3 class="record-title"><a href="${html(projectPath(project))}">${html(project.name)}</a></h3>
    <p class="record-summary">${html(project.purpose)}</p>
    <p class="record-evidence">${evidenceMark(project.label, project.connection)}${place}</p>
    <p class="record-topic">${topicTag(entityLink(catalog, "topic", project.topic), project.topic)}</p>
  </li>`;
}

export function projectCards(
  catalog: DirectoryCatalog, projects: readonly DirectoryProject[], variant: "cards" | "compact" = "cards", dateField: "activity" | "added" = "activity",
) {
  return `<ol class="records" data-view="${variant === "compact" ? "compact" : "full"}">${projects.map(project => projectRecord(catalog, project, dateField)).join("")}</ol>`;
}

/**
 * A quiet feedback block for listing pages: a one-click usefulness rating and a folded correction
 * form. Both post to the private reader inbox; /directory-feedback.js sends them without a reload.
 */
export function feedbackBlock(page: string, removal: string) {
  const hidden = `<input type="hidden" name="page" value="${html(page)}">`;
  const trap = '<div class="inbox-trap" aria-hidden="true"><input type="text" name="website" tabindex="-1" autocomplete="off"></div>';
  return `<section class="page-feedback" id="feedback" aria-label="Feedback on this page">
    <form class="feedback-rate" method="post" action="/discover/feedback" data-feedback>${hidden}
      <span>Was this page useful?</span>
      <button type="submit" name="rating" value="useful">Yes</button>
      <button type="submit" name="rating" value="not-useful">No</button>
    </form>
    <p class="feedback-status" role="status" hidden></p>
    <details class="feedback-more"><summary>Suggest a correction</summary>
      <form class="inbox-form" method="post" action="/discover/feedback" data-feedback>${hidden}
        <label><span>What should change?</span><textarea name="message" rows="3" required maxlength="2000"></textarea></label>
        <label><span>Your email <span class="muted">(optional, for a reply)</span></span><input type="email" name="email" maxlength="200" autocomplete="email"></label>
        ${trap}
        <button class="button secondary" type="submit">Send</button>
      </form>
    </details>
    <p class="feedback-removal muted">${removal}</p>
  </section>`;
}

export function renderUseGuidance(steps: GuidanceStep[]) {
  if (!steps.length) return "";
  return `<section class="record-section"><h2>How to use</h2><ol>${steps.map(step => `<li>${html(step.text)}${step.links?.map(link => ` ${externalLink(link.url, link.label)}`).join("") ?? ""}${step.command ? `<pre><code>${html(step.command)}</code></pre>` : ""}</li>`).join("")}</ol></section>`;
}
