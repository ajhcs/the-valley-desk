// Read-only directory tools shared by the MCP server and, through it, the WebMCP page tools.
// Record reads go through servePublicDirectory, the handler behind the public JSON API, so
// removals, the fail-closed check and version filtering behave exactly as they do on the site.
import { counties, directoryCatalog, projectPath } from "../ingest/public-directory-data";
import { institutionRefs, removalIds, servePublicDirectory } from "../ingest/public-directory";
import {
  dateBound,
  facetSlug,
  optionsFor,
  pubPath,
  publicationTitle,
  rows,
  type Institution,
  type Publication,
  type ResearchDb,
} from "../ingest/public-directory-research";

export const limits = {
  pageSize: 24, // Fixed by the directory API. Every page holds at most this many records.
  maxPage: 1000,
  resultBytes: 60_000,
  queryLength: 200,
  filterLength: 180,
  bylineNames: 25,
  listEntries: 300,
  facetMemoMs: 300_000,
};

export type ToolContext = { db?: ResearchDb; origin: string; publicationsEnabled: boolean; now?: Date };
type Args = Record<string, string | number | undefined>;
type Property = {
  type: "string" | "integer";
  description: string;
  enum?: readonly string[];
  maxLength?: number;
  pattern?: string;
  minimum?: number;
  maximum?: number;
};
type InputSchema = {
  type: "object";
  properties: Record<string, Property>;
  required?: string[];
  additionalProperties: false;
};

class ToolError extends Error {}
class Unavailable extends Error {}

const datePattern = "^\\d{4}(-\\d{2}(-\\d{2})?)?$";
const dayPattern = "^\\d{4}-\\d{2}-\\d{2}$";
const countyNames = counties.map((county) => county.name);
const text = (description: string, maxLength = limits.filterLength): Property => ({
  type: "string",
  description,
  maxLength,
});
const filters = {
  kind: { type: "string", description: "Limit to software projects or to publications.", enum: ["project", "publication"] },
  institution: text("Institution name or id, for example \"Drexel University\". list_institutions returns the names."),
  topic: text("Topic name, for example \"Medical imaging\". list_topics_and_counties returns the names."),
  county: { type: "string", description: "One of the nine Delaware Valley counties.", enum: countyNames },
  page: { type: "integer", description: "Page number. Each page holds up to 24 records.", minimum: 1, maximum: limits.maxPage },
} satisfies Record<string, Property>;

const listing = {
  type: "object",
  properties: {
    id: { type: "string", description: "Directory id. Pass it to fetch." },
    kind: { type: "string", enum: ["project", "publication"] },
    title: { type: "string" },
    url: { type: "string", description: "The Valley Desk page for this record. Cite this URL." },
    label: { type: "string", enum: ["Verified", "Listed"], description: "Strength of the regional evidence." },
    connection: { type: "string", description: "The observed regional connection, as recorded." },
    summary: { type: "string" },
    topic: { type: "string" },
    institutions: { type: "array", items: { type: "string" } },
    counties: { type: "array", items: { type: "string" } },
    dates: {
      type: "object",
      description: "published: when a paper appeared. pushed: when project code last changed. added: when the record entered the directory.",
      properties: { published: { type: "string" }, pushed: { type: "string" }, added: { type: "string" } },
    },
    type: { type: "string" },
    venue: { type: "string" },
    retracted: { type: "boolean" },
  },
  required: ["id", "kind", "title", "url", "label", "dates"],
};
const pageSchema = {
  type: "object",
  properties: {
    results: { type: "array", items: listing },
    page: { type: "integer" },
    page_size: { type: "integer" },
    total_pages: { type: "integer" },
    total_records: { type: "integer" },
    truncated: { type: "boolean", description: "True when records were dropped to fit the response size cap." },
    browse_url: { type: "string", description: "The same search on the site." },
  },
  required: ["results", "page", "page_size", "total_pages", "total_records"],
};
const countSchema = (extra: Record<string, unknown>) => ({
  type: "array",
  items: {
    type: "object",
    properties: { name: { type: "string" }, url: { type: "string" }, listings: { type: "integer" }, ...extra },
    required: ["name", "url", "listings"],
  },
});

// Hints for hosts. The directory is a bounded catalog and every tool only reads it.
const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const meta = (invoking: string, invoked: string) => ({
  securitySchemes: [{ type: "noauth" }],
  "openai/toolInvocation/invoking": invoking,
  "openai/toolInvocation/invoked": invoked,
});

type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: InputSchema;
  outputSchema: Record<string, unknown>;
  run: (args: Args, context: ToolContext) => Promise<Record<string, unknown>>;
  invoking: string;
  invoked: string;
};

const tools: Tool[] = [
  {
    name: "search",
    title: "Search the research directory",
    description:
      "Search The Valley Desk directory of healthcare research software projects and publications connected to the nine-county Delaware Valley (Philadelphia region). Matches titles, topics, institutions and keywords. Every filter is optional. Returns up to 24 records per page with the site URL, the Verified or Listed evidence label and labelled dates.",
    inputSchema: {
      type: "object",
      properties: {
        query: text("Words to match, for example \"sepsis prediction\".", limits.queryLength),
        ...filters,
        label: { type: "string", description: "Limit to one regional evidence label.", enum: ["Verified", "Listed"] },
        date_from: { type: "string", description: "Earliest published date (publications) or last code push (projects). YYYY, YYYY-MM or YYYY-MM-DD.", pattern: datePattern },
        date_to: { type: "string", description: "Latest published date or last code push. YYYY, YYYY-MM or YYYY-MM-DD.", pattern: datePattern },
        added_from: { type: "string", description: "Earliest date added to the directory. YYYY, YYYY-MM or YYYY-MM-DD.", pattern: datePattern },
        added_to: { type: "string", description: "Latest date added to the directory. YYYY, YYYY-MM or YYYY-MM-DD.", pattern: datePattern },
        sort: { type: "string", description: "added: newest directory additions first (default). date: newest published or pushed first. title: A to Z.", enum: ["added", "date", "title"] },
      },
      additionalProperties: false,
    },
    outputSchema: pageSchema,
    run: (args, context) => search(args, context),
    invoking: "Searching The Valley Desk",
    invoked: "Searched The Valley Desk",
  },
  {
    name: "fetch",
    title: "Get one directory record",
    description:
      "Get one publication or software project from The Valley Desk directory by its directory id (from search or whats_new) or its thevalleydesk.org URL. Returns the full public record, including the regional connection, its source, and linked projects or publication versions.",
    inputSchema: {
      type: "object",
      properties: { id: text("Directory id such as \"doi:10.1000/example\" or \"474026\", or the record's thevalleydesk.org URL.", 600) },
      required: ["id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        text: { type: "string", description: "The record as plain text." },
        url: { type: "string", description: "The Valley Desk page for this record. Cite this URL." },
        metadata: { type: "object", description: "The record's fields, including kind, label and dates." },
      },
      required: ["id", "title", "text", "url", "metadata"],
    },
    run: (args, context) => fetchRecord(String(args.id), context),
    invoking: "Reading the directory record",
    invoked: "Read the directory record",
  },
  {
    name: "whats_new",
    title: "New listings since a date",
    description:
      "List records added to The Valley Desk directory on or after a date, newest additions first. The date is when the record entered the directory, which can differ from when the research was published.",
    inputSchema: {
      type: "object",
      properties: {
        since: { type: "string", description: "Earliest date added, as YYYY-MM-DD.", pattern: dayPattern },
        ...filters,
      },
      required: ["since"],
      additionalProperties: false,
    },
    outputSchema: pageSchema,
    run: ({ since, ...rest }, context) => search({ ...rest, added_from: since, sort: "added" }, context, "/discover/new"),
    invoking: "Checking new listings",
    invoked: "Checked new listings",
  },
  {
    name: "list_institutions",
    title: "List institutions",
    description:
      "List the regional institutions in The Valley Desk directory with the number of listings recorded for each. Use a returned name as the institution filter in search.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: {
        institutions: countSchema({
          id: { type: "string" },
          also_known_as: { type: "array", items: { type: "string" } },
          counties: { type: "array", items: { type: "string" } },
        }),
        truncated: { type: "boolean" },
      },
      required: ["institutions"],
    },
    run: async (_args, context) => {
      const { institutions, truncated } = await facets(context);
      return { institutions, ...(truncated ? { truncated } : {}) };
    },
    invoking: "Listing institutions",
    invoked: "Listed institutions",
  },
  {
    name: "list_topics_and_counties",
    title: "List topics and counties",
    description:
      "List the topics and the nine Delaware Valley counties in The Valley Desk directory with the number of listings recorded for each. Use a returned name as the topic or county filter in search.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: { topics: countSchema({}), counties: countSchema({ state: { type: "string" } }) },
      required: ["topics", "counties"],
    },
    run: async (_args, context) => {
      const { topics, counties: places } = await facets(context);
      return { topics, counties: places };
    },
    invoking: "Listing topics and counties",
    invoked: "Listed topics and counties",
  },
];

export const toolDefinitions = tools.map(({ name, title, description, inputSchema, outputSchema, invoking, invoked }) => ({
  name,
  title,
  description,
  inputSchema,
  outputSchema,
  annotations: { title, ...annotations },
  _meta: meta(invoking, invoked),
}));
export const hasTool = (name: unknown) => tools.some((tool) => tool.name === name);

function validate(schema: InputSchema, input: unknown): Args {
  if (input === undefined || input === null) input = {};
  if (typeof input !== "object" || Array.isArray(input)) throw new ToolError("Arguments must be an object.");
  const args: Args = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    const rule = schema.properties[key];
    if (!rule) throw new ToolError(`Unknown argument "${key.slice(0, 40)}". Allowed: ${Object.keys(schema.properties).join(", ") || "none"}.`);
    if (raw === undefined || raw === null || raw === "") continue;
    if (rule.type === "integer") {
      const value = typeof raw === "string" && /^\d{1,9}$/.test(raw) ? Number(raw) : raw;
      if (typeof value !== "number" || !Number.isInteger(value) || value < rule.minimum! || value > rule.maximum!) {
        throw new ToolError(`${key} must be a whole number from ${rule.minimum} to ${rule.maximum}. Narrow the search with filters to reach later records.`);
      }
      args[key] = value;
      continue;
    }
    if (typeof raw !== "string") throw new ToolError(`${key} must be a string.`);
    const value = raw.trim();
    if (rule.maxLength && value.length > rule.maxLength) throw new ToolError(`${key} must be at most ${rule.maxLength} characters.`);
    if (rule.enum) {
      const match = rule.enum.find((option) => option.toLowerCase() === value.toLowerCase().replace(/ county$/, ""));
      if (!match) throw new ToolError(`${key} must be one of: ${rule.enum.join(", ")}.`);
      args[key] = match;
      continue;
    }
    if (rule.pattern && !(rule.pattern === dayPattern ? value.length === 10 && dateBound(value) : dateBound(value))) {
      throw new ToolError(`${key} must be a date written as ${rule.pattern === dayPattern ? "YYYY-MM-DD" : "YYYY, YYYY-MM or YYYY-MM-DD"}.`);
    }
    if (value) args[key] = value;
  }
  for (const key of schema.required ?? []) if (args[key] === undefined) throw new ToolError(`${key} is required.`);
  return args;
}

async function api(context: ToolContext, path: string) {
  const response = await servePublicDirectory(
    new Request(context.origin + path),
    context.db,
    context.origin,
    undefined,
    undefined,
    context.publicationsEnabled,
  );
  if (response.status === 503) throw new Unavailable();
  return { status: response.status, body: (await response.json()) as Record<string, any> };
}

const clip = (value: unknown, length: number) => {
  const string = typeof value === "string" ? value.trim() : "";
  return string.length > length ? string.slice(0, length - 1).trimEnd() + "…" : string;
};
const present = <T extends Record<string, unknown>>(record: T) =>
  Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined && value !== null && value !== "" && !(Array.isArray(value) && !value.length)),
  ) as Partial<T>;
const institutionName = (refs: Institution[], id: string) => refs.find((ref) => ref.id === id)?.name ?? id;

type ApiListing = { kind: "project"; record: Record<string, any> } | { kind: "publication"; record: Publication };
function summarize(item: ApiListing, context: ToolContext, refs: Institution[]) {
  if (item.kind === "publication") {
    const p = item.record;
    return present({
      id: p.id,
      kind: item.kind,
      title: publicationTitle(p),
      url: context.origin + pubPath(p.id),
      label: p.label,
      connection: clip(p.connection, 300),
      topic: p.topic,
      institutions: p.institutions.map((id) => institutionName(refs, id)),
      counties: p.counties,
      dates: present({ published: p.published, added: p.added }),
      type: p.type,
      venue: p.venue,
      retracted: p.retracted || undefined,
    });
  }
  const p = item.record;
  return present({
    id: p.id,
    kind: item.kind,
    title: p.name,
    url: context.origin + projectPath({ id: p.id }),
    label: p.label,
    connection: clip(p.connection, 300),
    summary: clip(p.purpose, 300),
    topic: p.topic,
    institutions: [p.institution].filter(Boolean),
    counties: [p.county].filter(Boolean),
    dates: present({ pushed: p.pushed, added: p.added }),
  });
}

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
function capped<T extends Record<string, unknown>>(result: T, list: keyof T): T {
  const entries = result[list] as unknown[];
  let truncated = false;
  while (entries.length > 1 && bytes(result) > limits.resultBytes) {
    entries.pop();
    truncated = true;
  }
  return truncated ? { ...result, truncated } : result;
}

async function refsFor(context: ToolContext): Promise<Institution[]> {
  if (!context.publicationsEnabled) return [];
  try {
    return await institutionRefs(context.db!);
  } catch {
    throw new Unavailable();
  }
}

async function search(args: Args, context: ToolContext, browse = "/discover/works") {
  const params = new URLSearchParams();
  const names = { query: "q", sort: "sort" } as Record<string, string>;
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue;
    params.set(names[key] ?? key, key === "sort" ? { added: "added", date: "activity", title: "name" }[String(value)]! : String(value));
  }
  const { status, body } = await api(context, "/api/directory/listings?" + params);
  if (status !== 200) throw new Unavailable();
  const refs = await refsFor(context);
  const results = (body.listings as ApiListing[]).map((item) => summarize(item, context, refs));
  // The project-only fallback has no date index. Refuse to present unfiltered records as filtered.
  const within = (value: string | undefined, key: string) =>
    (!args[key + "_from"] || (!!value && value >= String(args[key + "_from"]))) &&
    (!args[key + "_to"] || (!!value && value <= args[key + "_to"] + "~"));
  const dated = (r: { dates?: object }) => (r.dates ?? {}) as { published?: string; pushed?: string; added?: string };
  if (!results.every((r) => within(dated(r).added, "added") && within(dated(r).published ?? dated(r).pushed, "date"))) {
    throw new ToolError("Date filters are unavailable right now. Search again without date_from, date_to, added_from, added_to or since.");
  }
  const view = new URLSearchParams(params);
  if (browse !== "/discover/works") view.delete("sort");
  return capped(
    {
      results,
      page: body.page as number,
      page_size: limits.pageSize,
      total_pages: body.total_pages as number,
      total_records: body.record_total as number,
      browse_url: context.origin + browse + (view.size ? "?" + view : ""),
    },
    "results",
  );
}

function recordId(value: string, origin: string) {
  let id = value.trim();
  if (/^https?:\/\//i.test(id)) {
    let url: URL;
    try {
      url = new URL(id);
    } catch {
      throw new ToolError("id is not a valid URL.");
    }
    const match = /^\/discover\/(work|publication)\/([^/]+)\/?$/.exec(url.pathname);
    if (!["thevalleydesk.org", "www.thevalleydesk.org", new URL(origin).hostname].includes(url.hostname) || !match) {
      throw new ToolError("fetch reads thevalleydesk.org record URLs (/discover/work/… or /discover/publication/…) and directory ids only.");
    }
    try {
      id = decodeURIComponent(match[2]);
    } catch {
      throw new ToolError("id is not a valid URL.");
    }
  }
  return id;
}

async function fetchRecord(value: string, context: ToolContext) {
  const id = recordId(value, context.origin);
  const project = /^[1-9][0-9]{0,19}$/.test(id);
  const { status, body } = await api(
    context,
    (project ? "/api/directory/projects/" : "/api/directory/publications/") + encodeURIComponent(id),
  );
  if (status === 410) throw new ToolError("This record has been removed from the directory.");
  if (status !== 200) throw new ToolError("No directory record has this id. Use search to find records and their ids.");
  if (project) {
    const p = body.project as Record<string, any>;
    const url = context.origin + projectPath({ id: p.id });
    const metadata = present({
      kind: "project",
      label: p.label,
      connection: p.connection,
      connection_source: p.source,
      summary: p.purpose,
      topic: p.topic,
      institutions: [p.institution].filter(Boolean),
      counties: [p.county].filter(Boolean),
      dates: present({ pushed: p.pushed, added: p.added }),
      source_checked: p.checked,
      code: p.code,
      homepage: p.homepage,
      lab: p.lab,
      language: p.language,
      license: p.license,
      stars: p.stars,
      archived: p.archived,
      tags: (p.topics ?? []).slice(0, 20),
      papers: (p.papers ?? []).slice(0, 10).map((paper: Record<string, unknown>) => present(paper)),
    });
    return { id: p.id, title: p.name, text: plain(p.name, url, metadata), url, metadata };
  }
  const p = body.publication as Publication;
  const refs = await refsFor(context);
  const url = context.origin + pubPath(p.id);
  const metadata = present({
    kind: "publication",
    label: p.label,
    connection: p.connection,
    connection_source: p.source,
    type: p.type,
    venue: p.venue,
    topic: p.topic,
    terms: (p.terms ?? []).slice(0, 20),
    institutions: p.institutions.map((ref) => institutionName(refs, ref)),
    counties: p.counties,
    dates: present({ published: p.published, added: p.added }),
    source_checked: p.checked,
    retracted: p.retracted || undefined,
    publication_url: p.url,
    open_access_url: p.open_access?.url,
    byline: p.authors.slice(0, limits.bylineNames).map((author) => author.name),
    author_count: p.author_count,
    projects: p.projects.map((pid) => context.origin + projectPath({ id: pid })),
    preprint_of: p.preprint_of ? context.origin + pubPath(p.preprint_of) : undefined,
    published_as: p.published_as ? context.origin + pubPath(p.published_as) : undefined,
  });
  const title = publicationTitle(p);
  return { id: p.id, title, text: plain(title, url, metadata), url, metadata };
}

function plain(title: string, url: string, metadata: Record<string, unknown>) {
  const line = (value: unknown): string =>
    Array.isArray(value)
      ? value.map(line).join("; ")
      : value && typeof value === "object"
        ? Object.entries(value).map(([key, item]) => `${key} ${line(item)}`).join(", ")
        : String(value);
  return [title, url, ...Object.entries(metadata).map(([key, value]) => `${key.replaceAll("_", " ")}: ${line(value)}`)].join("\n");
}

type Count = { field: string; value: string; n: number };
const memo = new WeakMap<object, { at: number; counts: Count[] }>();

async function facets(context: ToolContext) {
  const now = context.now ?? new Date();
  const { db, origin } = context;
  let removed: Set<string>;
  let refs: Institution[] = [];
  let counts: Count[] | undefined;
  try {
    removed = await removalIds(db);
    // Read through the visibility view on every call so unreadable removal state fails closed
    // even while the aggregate counts below are memoized.
    if (context.publicationsEnabled && (await rows(db!, "SELECT id FROM research_visible WHERE kind='publication' LIMIT 1")).length) {
      refs = await institutionRefs(db!);
      const cached = memo.get(db!);
      counts = cached && now.getTime() - cached.at < limits.facetMemoMs ? cached.counts : undefined;
      if (!counts) {
        counts = await rows<Count>(
          db!,
          "SELECT f.field field,f.value value,count(*) n FROM research_facets f JOIN research_visible v ON v.id=f.id WHERE f.field IN ('institution','topic','county') GROUP BY f.field,f.value",
        );
        memo.set(db!, { at: now.getTime(), counts });
      }
    }
  } catch {
    throw new Unavailable();
  }
  const byCount = <T extends { name: string; listings: number }>(list: T[]) =>
    list.sort((a, b) => b.listings - a.listings || a.name.localeCompare(b.name, "en"));
  const page = (field: string, slug: string) => origin + "/discover/" + field + "/" + encodeURIComponent(slug);
  if (!counts) {
    // Projects only: the bundled catalog, less current removals.
    const home = directoryCatalog.home(removed, now);
    const list = (kind: "institution" | "topic" | "county", values: { name: string; count: number }[]) =>
      byCount(values.map(({ name, count }) => ({ name, url: origin + directoryCatalog.entityHref(kind, name), listings: count })));
    const known = new Map(home.counties.map((county) => [county.name, county.count]));
    return {
      institutions: list("institution", home.institutions).slice(0, limits.listEntries),
      truncated: home.institutions.length > limits.listEntries,
      topics: list("topic", home.topics).slice(0, limits.listEntries),
      counties: counties.map(({ name, state }) => ({ name, state, url: page("county", name.toLowerCase()), listings: known.get(name) ?? 0 })),
    };
  }
  const count = (field: string, slug: string) => counts!.find((row) => row.field === field && row.value === slug)?.n ?? 0;
  const options = optionsFor(directoryCatalog, removed, refs);
  const named = new Set(refs.map((ref) => ref.id));
  const institutions = byCount([
    ...refs.map((ref) => ({
      id: ref.id,
      name: ref.name,
      also_known_as: ref.aliases.slice(0, 5),
      counties: [...new Set(ref.sites.map((site) => site.county))],
      url: page("institution", ref.id),
      listings: count("institution", ref.id),
    })),
    ...counts
      .filter((row) => row.field === "institution" && !named.has(row.value))
      .map((row) => ({ id: row.value, name: options.institution.get(row.value) ?? row.value, url: page("institution", row.value), listings: row.n })),
  ]);
  return capped(
    {
      institutions: institutions.slice(0, limits.listEntries).map((entry) => present(entry)),
      truncated: institutions.length > limits.listEntries,
      topics: byCount(
        counts
          .filter((row) => row.field === "topic")
          .map((row) => ({ name: options.topic.get(row.value) ?? row.value, url: page("topic", row.value), listings: row.n })),
      ).slice(0, limits.listEntries),
      counties: counties.map(({ name, state }) => ({ name, state, url: page("county", facetSlug(name)), listings: count("county", facetSlug(name)) })),
    },
    "institutions",
  );
}

export async function callTool(name: string, input: unknown, context: ToolContext) {
  const tool = tools.find((candidate) => candidate.name === name)!;
  const failure = (message: string) => ({ content: [{ type: "text", text: message }], isError: true });
  try {
    const structuredContent = await tool.run(validate(tool.inputSchema, input), context);
    return { content: [{ type: "text", text: JSON.stringify(structuredContent) }], structuredContent, isError: false };
  } catch (error) {
    if (error instanceof ToolError) return failure(error.message);
    // Fail closed: no record data leaves the server when removals or the index cannot be read.
    return failure("The directory is temporarily unavailable. No records were returned. Try again in a few minutes.");
  }
}
