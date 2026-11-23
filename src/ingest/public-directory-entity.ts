import { counties } from "./public-directory-data";
import {
  facetSlug,
  rows,
  topicPath,
  type Institution,
  type ListingKind,
  type Options,
  type ResearchDb,
} from "./public-directory-research";
import { count, externalLink, healthTopic, html, otherTopic, otherTopicSlug, timestamp } from "./public-directory-ui";

export type ScopeField = "institution" | "topic" | "county";
type Tally = { value: string; n: number };
export type DirectorySummary = {
  kinds: Partial<Record<ListingKind, { works: number; first: string | null; last: string | null; added: string | null }>>;
  facets: Record<ScopeField, Tally[]>;
};

/**
 * Counts for a whole directory or one institution, topic or county. Removed listings are
 * excluded through research_visible, and a preprint with its journal version counts once.
 */
export async function summarize(db: ResearchDb, scope?: { field: ScopeField; value: string }): Promise<DirectorySummary> {
  return (await storedSummary(db, scope)) ?? countSummary(db, scope);
}

type KindRow = { kind: ListingKind; works: number; first: string | null; last: string | null; added: string | null };
type TallyRow = { field: ScopeField; value: string; n: number };

function summaryOf(kinds: KindRow[], tallies: TallyRow[], scope?: { field: ScopeField; value: string }): DirectorySummary {
  const facets: DirectorySummary["facets"] = { institution: [], topic: [], county: [] };
  for (const row of tallies) if (!(scope && row.field === scope.field && row.value === scope.value)) facets[row.field].push(row);
  return { kinds: Object.fromEntries(kinds.map(({ kind, ...rest }) => [kind, rest])), facets };
}

/**
 * Counts written by ops/research-summary.sql after an import. Returns nothing while those tables
 * are missing or mid-refresh, so the caller counts directly. The whole-directory row is written
 * last and marks a finished refresh.
 */
async function storedSummary(db: ResearchDb, scope?: { field: ScopeField; value: string }) {
  const key = [scope?.field ?? "", scope?.value ?? ""];
  try {
    const kinds = await rows<KindRow & { ready: number }>(
      db,
      "SELECT kind,works,first,last,added,EXISTS(SELECT 1 FROM research_summary_kinds WHERE scope_field='' AND scope_value='') ready FROM research_summary_kinds WHERE scope_field=? AND scope_value=?",
      ...key,
    );
    if (!kinds.length || !kinds[0].ready) return undefined;
    const tallies = await rows<TallyRow>(
      db,
      "SELECT field,value,n FROM research_summary_facets WHERE scope_field=? AND scope_value=? ORDER BY n DESC,value",
      ...key,
    );
    return summaryOf(kinds.map(({ ready: _ready, ...row }) => row), tallies, scope);
  } catch {
    return undefined;
  }
}

async function countSummary(db: ResearchDb, scope?: { field: ScopeField; value: string }): Promise<DirectorySummary> {
  const within = scope ? " AND v.id IN (SELECT id FROM research_facets WHERE field=? AND value=?)" : "";
  const args = scope ? [scope.field, scope.value] : [];
  const kinds = await rows<{ kind: ListingKind; works: number; first: string | null; last: string | null; added: string | null }>(
    db,
    "SELECT kind,count(DISTINCT group_id) works,min(nullif(activity,'')) first,max(nullif(activity,'')) last,max(nullif(added,'')) added FROM research_visible v WHERE 1=1" +
      within +
      " GROUP BY kind",
    ...args,
  );
  const tallies = await rows<{ field: ScopeField; value: string; n: number }>(
    db,
    "SELECT f.field,f.value,count(DISTINCT v.group_id) n FROM research_facets f JOIN research_visible v ON v.id=f.id WHERE f.field IN ('institution','topic','county')" +
      within +
      " GROUP BY f.field,f.value ORDER BY n DESC,f.value",
    ...args,
  );
  return summaryOf(kinds, tallies, scope);
}

export type Names = {
  institution: (id: string) => string;
  topic: (slug: string) => string;
  county: (slug: string) => string;
};
export function namesFor(refs: Institution[], options: Options): Names {
  return {
    institution: (id) => refs.find((r) => r.id === id)?.name ?? options.institution.get(id) ?? id,
    topic: (slug) => options.topic.get(slug) ?? (slug === otherTopicSlug ? otherTopic : slug),
    county: (slug) => counties.find((c) => facetSlug(c.name) === slug)?.name ?? slug,
  };
}
export const entityHref = (field: ScopeField, value: string) =>
  field === "topic" ? topicPath(value) : `/discover/${field}/${encodeURIComponent(value)}`;

const list = (items: string[]) =>
  items.length < 3 ? items.join(" and ") : items.slice(0, -1).join(", ") + " and " + items.at(-1);
const plural = (n: number, one: string, many: string) => `${count(n)} ${n === 1 ? one : many}`;

export function kindPhrase(summary: DirectorySummary) {
  const pubs = summary.kinds.publication?.works ?? 0;
  const projects = summary.kinds.project?.works ?? 0;
  const studies = summary.kinds.study?.works ?? 0;
  const datasets = summary.kinds.dataset?.works ?? 0;
  return list(
    [
      pubs ? plural(pubs, "publication", "publications") : "",
      projects ? plural(projects, "research software project", "research software projects") : "",
      studies ? plural(studies, "clinical study", "clinical studies") : "",
      datasets ? plural(datasets, "dataset", "datasets") : "",
    ].filter(Boolean),
  );
}

function tallyText(rows: Tally[], field: ScopeField, names: Names, links: boolean, limit = 3) {
  return list(
    rows
      .filter((r) => field !== "topic" || healthTopic(names.topic(r.value)))
      .slice(0, limit)
      .map((r) => {
        const name = field === "county" ? names.county(r.value) + " County" : names[field](r.value);
        return (links ? `<a href="${html(entityHref(field, r.value))}">${html(name)}</a>` : name) + ` (${count(r.n)})`;
      }),
  );
}

/**
 * Plain sentences that answer what the directory holds for an entity. Every figure is computed
 * from the summary. Returns HTML for the page and text for the meta description.
 */
export function entitySentences(
  field: ScopeField | undefined,
  name: string,
  summary: DirectorySummary,
  names: Names,
) {
  const what = kindPhrase(summary) || "no listings";
  const opening =
    field === "institution"
      ? `${name} has ${what} listed in the directory.`
      : field === "topic"
        ? `The directory lists ${what} on ${name.toLowerCase()} connected to the Delaware Valley.`
        : field === "county"
          ? `The directory lists ${what} with a recorded connection to ${name}.`
          : `The directory lists ${what} connected to the nine-county Delaware Valley.`;
  const sentences = (links: boolean) => {
    const parts = [opening];
    if (field !== "topic" && summary.facets.topic.length)
      parts.push(`The largest topics are ${tallyText(summary.facets.topic, "topic", names, links)}.`);
    if (field !== "institution" && summary.facets.institution.length)
      parts.push(`The most listings come from ${tallyText(summary.facets.institution, "institution", names, links)}.`);
    if (field === "institution" && summary.facets.county.length)
      parts.push(`The most listings record ${tallyText(summary.facets.county, "county", names, links)}.`);
    return parts;
  };
  return { html: sentences(true).join(" "), text: sentences(false).join(" "), opening };
}

function tallyList(heading: string, rows: Tally[], field: ScopeField, names: Names, limit = 12) {
  const shown = rows.filter((r) => field !== "topic" || healthTopic(names.topic(r.value))).slice(0, limit);
  if (!shown.length) return "";
  return `<section class="tally"><h2>${heading}</h2><ul>${shown
    .map(
      (r) =>
        `<li><a href="${html(entityHref(field, r.value))}">${html(field === "county" ? names.county(r.value) + " County" : names[field](r.value))}</a><span>${count(r.n)}</span></li>`,
    )
    .join("")}</ul></section>`;
}

export function asOf(now: Date) {
  return `<p class="as-of">Counts computed from the directory on ${timestamp(now.toISOString().slice(0, 10))}. A preprint and its journal version count once. The counts describe listings that meet the <a href="/discover/methodology">inclusion rule</a>, not a complete record of regional research.</p>`;
}

const orgTypes: Record<string, string> = {
  university: "CollegeOrUniversity",
  "hospital or health system": "MedicalOrganization",
  "research institute": "ResearchOrganization",
  company: "Corporation",
  nonprofit: "NGO",
  government: "GovernmentOrganization",
};
type FullInstitution = Institution & {
  kind?: string;
  parent?: string | null;
  ror?: string | null;
  homepage?: string | null;
};
const kindLabels: Record<string, string> = {
  university: "University or college",
  "hospital or health system": "Hospital or health system",
  "research institute": "Research institute",
  company: "Company",
  nonprofit: "Nonprofit organization",
  government: "Government agency",
};

/** Schema.org Organization for a registry entry. Only registry fields are used. */
export function organizationSchema(ref: Institution | undefined, name: string, origin: string, refs: Institution[]) {
  const r = ref as FullInstitution | undefined;
  const parent = r?.parent ? refs.find((x) => x.id === r.parent) : undefined;
  const same = [r?.ror, r?.homepage].filter((v): v is string => !!v && /^https:\/\//.test(v));
  return {
    "@type": (r?.kind && orgTypes[r.kind]) || "Organization",
    name,
    ...(r?.homepage && /^https:\/\//.test(r.homepage) ? { url: r.homepage } : {}),
    ...(same.length ? { sameAs: same } : {}),
    ...(parent
      ? { parentOrganization: { "@type": "Organization", name: parent.name, url: origin + entityHref("institution", parent.id) } }
      : {}),
    ...(r?.sites.length
      ? {
          location: r.sites.map((s) => ({
            "@type": "Place",
            name: s.name,
            address: {
              "@type": "PostalAddress",
              addressLocality: s.place,
              ...(s.state ? { addressRegion: s.state } : {}),
              addressCountry: "US",
            },
          })),
        }
      : {}),
  };
}

/** Header for an institution, topic or county landing page: plain answers, then the index. */
export function entityHeader(opts: {
  field: ScopeField;
  slug: string;
  name: string;
  ref?: Institution;
  refs: Institution[];
  summary: DirectorySummary;
  names: Names;
  now: Date;
  feed: string;
}) {
  const { field, slug, name, ref, refs, summary, names, now, feed } = opts;
  const r = ref as FullInstitution | undefined;
  const county = field === "county" ? counties.find((c) => facetSlug(c.name) === slug) : undefined;
  const eyebrow =
    field === "institution"
      ? (r?.kind && kindLabels[r.kind]) || "Institution"
      : field === "topic"
        ? "Research topic"
        : `County · ${county?.state === "NJ" ? "New Jersey" : "Pennsylvania"}`;
  const sentences = entitySentences(field, name, summary, names);
  const parent = r?.parent ? refs.find((x) => x.id === r.parent) : undefined;
  const children = r ? refs.filter((x) => (x as FullInstitution).parent === r.id) : [];
  const sites =
    field === "institution"
      ? (ref?.sites ?? [])
      : field === "county"
        ? refs.flatMap((x) => x.sites.map((s) => ({ ...s, owner: x }))).filter((s) => facetSlug(s.county) === slug)
        : [];
  const related = [
    parent || children.length
      ? `<section class="tally sites"><h2>Related institutions</h2><ul>${parent ? `<li>Part of <a href="${html(entityHref("institution", parent.id))}">${html(parent.name)}</a></li>` : ""}${children
          .map((c) => `<li><a href="${html(entityHref("institution", c.id))}">${html(c.name)}</a></li>`)
          .join("")}</ul></section>`
      : "",
    field !== "institution" ? tallyList("Institutions", summary.facets.institution, "institution", names, 10) : "",
    field !== "topic" ? tallyList("Topics", summary.facets.topic, "topic", names) : "",
    field !== "county" ? tallyList("Counties", summary.facets.county, "county", names) : "",
    sites.length
      ? `<section class="tally sites"><h2>Regional sites</h2><ul>${sites
          .map(
            (s) =>
              `<li>${externalLink(s.source, s.name) || html(s.name)}<span>${html(s.place + ", " + s.county + " County")}${"owner" in s && field === "county" ? " · " + html((s.owner as Institution).name) : ""}</span></li>`,
          )
          .join("")}</ul></section>`
      : "",
  ].filter(Boolean);
  return {
    description: sentences.text,
    opening: sentences.opening,
    header: `<header class="entity-head">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/discover/works">Directory</a><span aria-hidden="true">/</span><span>${html(name)}</span></nav>
      <p class="eyebrow">${html(eyebrow)}</p>
      <h1>${html(name)}</h1>
      <p class="lede">${sentences.html}</p>
      ${asOf(now)}
      <p class="entity-links"><a href="${html(feed)}">RSS feed of additions for ${html(name)}</a>${r?.homepage ? ` ${externalLink(r.homepage, "Institution website ↗")}` : ""}</p>
    </header>`,
    index: related.join(""),
  };
}

/** Index of every topic, institution and county with listings, for the home page and llms.txt. */
export function homeIndex(summary: DirectorySummary, names: Names) {
  const institutions = summary.facets.institution;
  return {
    topics: tallyList("Topics", summary.facets.topic, "topic", names, 20),
    counties: tallyList("Counties", summary.facets.county, "county", names, 9),
    institutions: institutions.length
      ? `<section class="tally tally-columns"><h2>Institutions <span class="muted">(${count(institutions.length)})</span></h2><ul>${institutions
          .map(
            (r) =>
              `<li><a href="${html(entityHref("institution", r.value))}">${html(names.institution(r.value))}</a><span>${count(r.n)}</span></li>`,
          )
          .join("")}</ul></section>`
      : "",
  };
}
