import publishedProjects from "../content/public-directory-projects.json";

export type DirectoryProject = {
  id: string;
  code: string;
  name: string;
  purpose: string;
  topic: string;
  institution: string | null;
  county: string | null;
  label: "Verified" | "Listed";
  connection: string;
  source: string | null;
  paper: string | null;
  language: string | null;
  license: string | null;
  updated: string | null;
  added: string;
};

type Facet = { name: string; count: number };
type Query = { q: string; institution: string; topic: string; county: string; page: number };
export type DirectoryView = {
  kind: "home" | "results" | "project" | "unavailable" | "not-found" | "removed";
  title: string;
  total: number;
  institutionCount: number;
  projects: DirectoryProject[];
  project?: DirectoryProject;
  query: Query;
  facets: { institutions: Facet[]; topics: Facet[]; counties: Facet[] };
  matchCount: number;
  pageCount: number;
};

const aliases = new Map([
  ["GL04:work:crossref:gaston", "692249664"],
  ["GL05:work:crossref:sleepboost", "617168725"],
  ["GL05:work:crossref:openpbta", "192607622"],
]);
const projects = publishedProjects as DirectoryProject[];
const normalize = (input: string) =>
  input.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const orderedProjects = projects.slice().sort((a, b) => b.added.localeCompare(a.added) ||
  (b.updated ?? "").localeCompare(a.updated ?? "") ||
  a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

const index = new Map(projects.map(project => [project.id, normalize([
  project.name, project.purpose, project.code, project.topic, project.institution,
  project.county, project.language, project.connection, project.paper, project.id,
].filter(Boolean).join(" "))]));

function facetsFor(rows: DirectoryProject[], key: "institution" | "topic" | "county"): Facet[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = row[key];
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts, ([name, count]) => ({ name, count })).sort((a,b) =>
    b.count - a.count || a.name.localeCompare(b.name));
}

const PAGE_SIZE = 24;
const blank: Query = { q: "", institution: "", topic: "", county: "", page: 1 };

function readQuery(params: URLSearchParams): Query {
  const field = (name: string) => (params.get(name) ?? "").trim().slice(0, 160);
  const value = field("page");
  return {
    q: field("q"),
    institution: field("institution"),
    topic: field("topic"),
    county: field("county"),
    page: /^[1-9][0-9]{0,3}$/.test(value) ? Number(value) : 1,
  };
}

function search(rows: DirectoryProject[], query: Query) {
  const terms = normalize(query.q).split(" ").filter(Boolean);
  const facet = (value: string, actual: string | null) =>
    value === "" || (actual !== null && normalize(value) === normalize(actual));
  return rows.filter(project =>
    facet(query.institution, project.institution) &&
    facet(query.topic, project.topic) &&
    facet(query.county, project.county) &&
    terms.every(term => index.get(project.id)?.includes(term)),
  );
}

export function publicProjectId(value: string): string | null {
  if (/^[1-9][0-9]{0,19}$/.test(value)) return value;
  const oldRepository = /^GL[0-9]{2}:work:github:([1-9][0-9]{0,19})$/.exec(value);
  return oldRepository?.[1] ?? aliases.get(value) ?? null;
}

export function directoryView(
  kind: DirectoryView["kind"], removed: ReadonlySet<string>, params = new URLSearchParams(), id?: string,
): DirectoryView {
  const visible = kind === "unavailable" ? [] : orderedProjects.filter(project => !removed.has(project.id));
  const facets = {
    institutions: facetsFor(visible, "institution"),
    topics: facetsFor(visible, "topic"),
    counties: facetsFor(visible, "county"),
  };
  const view: DirectoryView = {
    kind, title: "Discover", total: visible.length, institutionCount: facets.institutions.length,
    projects: [], query: blank, facets, matchCount: 0, pageCount: 1,
  };
  if (kind === "home") return { ...view, title: "The Valley Desk", projects: visible.slice(0, 9) };
  if (kind === "results") {
    const query = readQuery(params);
    const matches = search(visible, query);
    const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
    query.page = Math.min(query.page, pageCount);
    const offset = (query.page - 1) * PAGE_SIZE;
    return { ...view, query, pageCount, matchCount: matches.length, projects: matches.slice(offset, offset + PAGE_SIZE) };
  }
  if (id) {
    if (removed.has(id)) return { ...view, kind: "removed", title: "Project removed" };
    const project = visible.find(row => row.id === id);
    if (project) return { ...view, kind: "project", title: project.name, project };
  }
  if (kind === "unavailable") return { ...view, title: "Directory temporarily unavailable" };
  return { ...view, kind: "not-found", title: "Project not found" };
}
