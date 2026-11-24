/**
 * Discovery across kinds for researchers: similar research for a record, the institutions and
 * counties most active for a search, and the institutions that most often share listings with
 * an institution. Every view is about groups and records, never about individual people.
 */
import { rows, type Listing, type ResearchDb } from "./public-directory-research";
import { entityHref, type Names } from "./public-directory-entity";
import { count, html } from "./public-directory-ui";

// Words too common in this corpus to tell two records apart. Matching on them makes the
// full-text ranking slow and the results generic.
const COMMON = new Set(
  `a about across after against all among an analysis and any approach are as assessment associated association at based
  be between beyond both but by care case cases cell cells characteristics clinical cohort comparison could data
  development disease diseases during effect effects efficacy evaluation evidence factors for from health high how
  human humans impact improve improving in into is it its large low management may method methods model models more
  new non not novel of on or our outcome outcomes over patient patients people population potential practice
  primary program prospective quality randomized rate rates related report research results retrospective review
  risk role safety series single studies study system systematic than that the their these this through to
  treatment trial trials two under use used using versus via vs was we what when which with within without years
  adult adults alliance among assessing center centers challenges characterization children consensus current
  determinants evaluating experience features findings guideline guidelines identification implications insights
  investigation lessons national outcomes perspective perspectives phase pilot recommendations standards statement
  strategies toward towards trends update updated insight multicenter observational protocol randomised versus`.split(/\s+/),
);

// Indexing check-tags and design labels that say nothing about the subject.
const GENERIC_TERMS = new Set(
  [
    "humans", "male", "female", "adult", "aged", "aged, 80 and over", "middle aged", "young adult", "adolescent", "child",
    "child, preschool", "infant", "infant, newborn", "animals", "mice", "rats", "retrospective studies", "prospective studies",
    "cohort studies", "cross-sectional studies", "follow-up studies", "risk factors", "treatment outcome", "united states",
    "pennsylvania", "philadelphia", "new jersey", "surveys and questionnaires", "time factors", "incidence", "prevalence",
  ],
);

const tokens = (text: string) => (text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
const distinctive = (word: string) => word.length >= 4 && !COMMON.has(word) && !/^\d+$/.test(word);

/**
 * A full-text query for records like this one: up to eight distinctive words, preferring words
 * that appear both in the title and in a specific subject term, then subject terms, then title words.
 * Returns nothing when the record has too little distinctive text to compare.
 */
export function similarMatch(title: string, terms: string[] = []): string | undefined {
  const titleWords = tokens(title).filter(distinctive);
  const termWords = terms
    .filter((t) => !GENERIC_TERMS.has(t.toLowerCase()))
    .flatMap(tokens)
    .filter(distinctive);
  const inTerms = new Set(termWords);
  // Subject terms name the subject more reliably than title wording, so they come before the
  // remaining title words.
  const ordered = [...titleWords.filter((w) => inTerms.has(w)), ...termWords, ...titleWords];
  const chosen = [...new Set(ordered)].slice(0, 8);
  return chosen.length >= 2 ? chosen.map((w) => `"${w}"`).join(" OR ") : undefined;
}

/** The text a record is compared on. */
export function similarText(item: Listing): { title: string; terms: string[] } {
  if (item.kind === "publication") return { title: item.record.title, terms: item.record.terms };
  if (item.kind === "study") return { title: item.record.title, terms: item.record.conditions };
  if (item.kind === "dataset" || item.kind === "regional-data") return { title: item.record.title + " " + item.record.summary, terms: [] };
  const p = item.record;
  return { title: [p.name, p.purpose].filter(Boolean).join(" "), terms: p.topics ?? [] };
}

/**
 * Up to `limit` visible listings that best match the record's distinctive words, across kinds,
 * excluding the given ids (the record itself and its versions). No kind fills more than four places.
 */
export async function similarListings(db: ResearchDb, item: Listing, exclude: string[], limit = 6): Promise<Listing[]> {
  const { title, terms } = similarText(item);
  const match = similarMatch(title, terms);
  if (!match) return [];
  const ranked = await rows<{ id: string }>(
    db,
    "SELECT l.id FROM research_search s JOIN research_listings l ON l.rowid=s.rowid WHERE research_search MATCH ? ORDER BY rank LIMIT 24",
    match,
  );
  const skip = new Set([item.record.id, ...exclude]);
  const ids = ranked.map((r) => r.id).filter((id) => !skip.has(id));
  if (!ids.length) return [];
  const found = await rows<{ id: string; kind: Listing["kind"]; record: string; work_id: string }>(
    db,
    "SELECT id,kind,record,work_id FROM research_visible WHERE id IN (SELECT value FROM json_each(?))",
    JSON.stringify(ids),
  );
  const byId = new Map(found.map((r) => [r.id, r]));
  const perKind = new Map<string, number>();
  const works = new Set<string>();
  const titles = new Set([title.toLowerCase()]);
  const out: Listing[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row || out.length >= limit) continue;
    const listing = { kind: row.kind, record: JSON.parse(row.record) } as Listing;
    const name = String(listing.kind === "project" ? listing.record.name : listing.record.title).toLowerCase();
    if (works.has(row.work_id) || titles.has(name) || (perKind.get(row.kind) ?? 0) >= 4) continue;
    works.add(row.work_id);
    titles.add(name);
    perKind.set(row.kind, (perKind.get(row.kind) ?? 0) + 1);
    out.push(listing);
  }
  return out;
}

export const groupSample = 400;

export type ActiveGroups = { institution: { value: string; n: number }[]; county: { value: string; n: number }[]; sampled: number };

/**
 * The institutions and counties recorded most often among the `groupSample` listings that best
 * match a search. Bounded so that a broad search costs the same as a narrow one.
 */
export async function activeGroups(db: ResearchDb, match: string): Promise<ActiveGroups> {
  const found = await rows<{ field: "institution" | "county" | "sampled"; value: string; n: number }>(
    db,
    `WITH m AS MATERIALIZED (
       SELECT v.id FROM research_search s JOIN research_listings l ON l.rowid=s.rowid JOIN research_visible v ON v.id=l.id
       WHERE research_search MATCH ? ORDER BY rank LIMIT ${groupSample})
     SELECT f.field,f.value,count(*) n FROM m JOIN research_facets f ON f.id=+m.id
     WHERE +f.field IN ('institution','county') GROUP BY f.field,f.value
     UNION ALL SELECT 'sampled','',count(*) FROM m`,
    match,
  );
  const pick = (field: "institution" | "county", limit: number) =>
    found.filter((r) => r.field === field).sort((a, b) => b.n - a.n || a.value.localeCompare(b.value)).slice(0, limit).map(({ value, n }) => ({ value, n }));
  return { institution: pick("institution", 8), county: pick("county", 5), sampled: found.find((r) => r.field === "sampled")?.n ?? 0 };
}

/** Institutions outside this one's own system that share the most listings with it. */
export async function partners(db: ResearchDb, institution: string, limit = 8) {
  try {
    return await rows<{ partner: string; n: number }>(
      db,
      "SELECT partner,sum(n) n FROM (SELECT partner,n FROM research_summary_partners WHERE institution=? UNION ALL SELECT partner,n FROM research_summary_dataset_partners WHERE institution=? AND (SELECT enabled FROM dataset_visibility WHERE id=1)=1) GROUP BY partner ORDER BY n DESC,partner LIMIT ?",
      institution,
      institution,
      limit,
    );
  } catch (error) {
    if (!/no such table/i.test(String(error))) throw error;
    try {
      return await rows<{ partner: string; n: number }>(db,
        "SELECT partner,n FROM research_summary_partners WHERE institution=? ORDER BY n DESC,partner LIMIT ?", institution, limit);
    } catch (legacyError) {
      if (/no such table/i.test(String(legacyError))) return [];
      throw legacyError;
    }
  }
}

/** Aside on an institution page: partner institutions outside its own system. */
export function partnerList(rows: { partner: string; n: number }[], names: Names) {
  if (!rows.length) return "";
  return `<section class="tally partners"><h2>Shares the most research with</h2><p class="tally-note">Other institutions named on the same research, outside this institution’s own system. Counts update with each data load.</p><ul>${rows
    .map((r) => `<li><a href="${html(entityHref("institution", r.partner))}">${html(names.institution(r.partner))}</a><span>${count(r.n)}</span></li>`)
    .join("")}</ul></section>`;
}

/** Aside on a search: who in the region works on the subject searched for. */
export function groupList(groups: ActiveGroups, names: Names, q: string) {
  if (!groups.institution.length) return "";
  const within = (field: "institution" | "county", value: string) =>
    `${entityHref(field, value)}?${new URLSearchParams({ q })}`;
  const sample = groups.sampled >= groupSample ? `the ${count(groupSample)} listings that best match` : `the ${count(groups.sampled)} listings that match`;
  return `<section class="tally groups" aria-labelledby="groups-title"><h2 id="groups-title">Who works on this in the region</h2><p class="tally-note">Institutions and counties named most often among ${sample} “${html(q)}”. Each link opens that institution’s or county’s listings for this search.</p><ul>${groups.institution
    .map((r) => `<li><a href="${html(within("institution", r.value))}">${html(names.institution(r.value))}</a><span>${count(r.n)}</span></li>`)
    .join("")}</ul>${groups.county.length ? `<h3>Counties</h3><ul>${groups.county
    .map((r) => `<li><a href="${html(within("county", r.value))}">${html(names.county(r.value))} County</a><span>${count(r.n)}</span></li>`)
    .join("")}</ul>` : ""}</section>`;
}
