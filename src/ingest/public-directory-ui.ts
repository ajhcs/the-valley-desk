import type { GuidanceStep } from "./directory-use-guidance";
import {
  browsePath, directoryParams, githubAccount, httpsUrl, lastActivity, methodPath, projectPath,
  type DirectoryCatalog, type DirectoryProject, type DirectoryQuery, type EntityKind, type FacetKey,
} from "./public-directory-data";
import { icon, type IconName } from "./public-directory-icons";

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
 * The evidence label on a listing card: the plain word "Verified", linked to its definition, and
 * nothing for Listed. The label, connection sentence and source link stay on the listing's page.
 */
export function evidenceMark(label: string) {
  return label === "Verified" ? `<a class="verified-word" href="${methodPath}#verified">Verified</a>` : "";
}

/** The first names of a list, then a count for the rest: "Penn, CHOP +2". */
export function namedLinks(links: string[], shown = 2) {
  if (!links.length) return "";
  const rest = links.length - shown;
  return links.slice(0, shown).join(", ") + (rest > 0 ? ` <span class="meta-more">+${count(rest)}</span>` : "");
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

const metaSep = '<span class="meta-sep" aria-hidden="true"> · </span>';
/** The topic as the last item of a card's meta line. CSS hides it when it would start a new line. */
export const topicTag = (link: string) => `<span class="meta-topic"><span>${metaSep}${link}</span></span>`;

/**
 * A listing card's one meta line: the kind label, then the facts a reader scans for, separated by
 * middots, then the topic when it fits.
 */
export function cardMeta(kind: string, items: (string | false | null | undefined)[], topic = "") {
  return `<p class="record-meta"><span class="meta-main">${kind}${items.filter(Boolean).join(metaSep)}</span>${topic}</p>`;
}

/**
 * Bookkeeping for a record page, folded into one quiet line: when the source was last checked,
 * with the remaining internal fields (listing ID, date added and the like) inside "Record details".
 */
export function recordDetails(checked: string, rows: [string, string | false | null | undefined][], checkedLabel = "Source checked") {
  const when = timestamp(checked) || (checked ? html(checked) : "");
  const facts = rows.filter((row): row is [string, string] => !!row[1]);
  const line = when ? `<span>${html(checkedLabel)} ${when}</span>` : "";
  if (!facts.length) return line ? `<p class="record-details">${line}</p>` : "";
  return `<details class="record-details"><summary>${line}<span class="record-details-label">Record details</span></summary><dl class="facts">${facts.map(([label, value]) => `<div><dt>${html(label)}</dt><dd>${value}</dd></div>`).join("")}</dl></details>`;
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

/** "Pushed" or "Updated", by whichever date is the project's last recorded activity. */
function activityDate(project: DirectoryProject) {
  const activity = lastActivity(project);
  const date = timestamp(activity);
  return date ? `<span class="nowrap">${activity === project.pushed ? "Pushed" : "Updated"} ${date}</span>` : "";
}

/** One catalogue entry for a software project: title, one meta line and a one-line summary. */
export function projectRecord(catalog: DirectoryCatalog, project: DirectoryProject) {
  const account = githubAccount(project);
  const lab = project.lab || project.owner?.name;
  const who = project.institution ? entityLink(catalog, "institution", project.institution)
    : account ? entityLink(catalog, "lab", account, lab || project.profileLocation || `@${account}`) : lab ? html(lab) : "";
  return `<li class="record record-software">
    <h3 class="record-title"><a href="${html(projectPath(project))}">${html(project.name)}</a></h3>
    ${cardMeta(kindIcon("software", "Software"), [
      project.language && `<a href="${facetHref("language", project.language)}">${html(project.language)}</a>`,
      activityDate(project), who, project.archived === true && "Archived", evidenceMark(project.label),
    ], topicTag(entityLink(catalog, "topic", project.topic)))}
    ${project.purpose ? `<p class="record-summary">${html(project.purpose)}</p>` : ""}
  </li>`;
}

/**
 * Cards for software projects. The compact view drops the summary and sets the meta line beside the
 * title on wide screens. Cards no longer show the date added, so the last argument is ignored.
 */
export function projectCards(
  catalog: DirectoryCatalog, projects: readonly DirectoryProject[], variant: "cards" | "compact" = "cards", _dateField?: "activity" | "added",
) {
  return `<ol class="records" data-view="${variant === "compact" ? "compact" : "full"}">${projects.map(project => projectRecord(catalog, project)).join("")}</ol>`;
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
