import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const UA = "TheValleyDesk/0.1 (+https://github.com/ajhcs/the-valley-desk)";

const sources = [
  { name: "Inquirer Health", urls: ["https://www.inquirer.com/arc/outboundfeeds/rss/category/health/?outputType=xml"] },
  { name: "Inquirer Business", urls: ["https://www.inquirer.com/arc/outboundfeeds/rss/category/business/?outputType=xml"] },
  { name: "WHYY", urls: ["https://whyy.org/feed/", "https://whyy.org/topics/health/feed/"] },
  // Technical.ly stays out of the RSS queue — their "feed" URLs often return HTML.
  // { name: "Technical.ly", urls: ["https://technical.ly/feed/", "https://technical.ly/philadelphia/feed/"] },
];

function decodeXml(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeXml(m[1]) : "";
}

function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "item";
}

function looksLikeRss(body) {
  return /<rss[\s>]|<rdf:RDF|<feed[\s>]/i.test(body);
}

const fetchedAt = new Date().toISOString();
const working = [];
const items = [];

for (const source of sources) {
  for (const url of source.urls) {
    try {
      const res = await fetch(url, { headers: { "user-agent": UA } });
      const body = await res.text();
      console.log(res.status, url);
      if (res.status === 200 && looksLikeRss(body)) {
        const raws = [...body.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => ({
          title: tag(m[1], "title"),
          link: tag(m[1], "link") || tag(m[1], "guid"),
          description: tag(m[1], "description"),
          pubDate: tag(m[1], "pubDate") || tag(m[1], "dc:date"),
          guid: tag(m[1], "guid"),
        })).filter((r) => r.title && r.link);
        working.push({ name: source.name, url, status: 200, count: raws.length });
        raws.forEach((raw, index) => {
          const parsed = Date.parse(raw.pubDate);
          items.push({
            id: `rss-${slugify(source.name)}-${index}-${slugify(raw.guid || raw.link).slice(0, 24)}`,
            slug: slugify(`${source.name}-${raw.title}`),
            kind: "news",
            title: raw.title,
            dek: raw.description.replace(/<[^>]+>/g, "").slice(0, 240),
            body: raw.description.replace(/<[^>]+>/g, "").slice(0, 2000),
            status: "review",
            publishedAt: Number.isFinite(parsed) ? new Date(parsed).toISOString() : undefined,
            updatedAt: fetchedAt,
            topics: [],
            orgs: [],
            region: "regional",
            authors: [],
            source: {
              kind: "ingest",
              origin: source.name,
              url: raw.link,
              fetchedAt,
              externalId: raw.guid || raw.link,
            },
            citations: [{ name: source.name, url: raw.link }],
            relatedEventIds: [],
            relatedVoiceIds: [],
          });
        });
        break;
      }
    } catch (err) {
      console.log("fail", url, err.message);
    }
  }
}

mkdirSync(join(root, "data"), { recursive: true });
const queuePath = join(root, "data/review-queue.json");
let existing = [];
try {
  const raw = JSON.parse(readFileSync(queuePath, "utf8"));
  existing = Array.isArray(raw) ? raw : raw.items || [];
} catch {
  existing = [];
}
const byId = new Map(existing.map((i) => [i.id, i]));
for (const [id, item] of [...byId.entries()]) {
  const origin = item?.source?.origin || "";
  if (/technical\.ly/i.test(origin) || /technical\.ly/i.test(item?.source?.url || "")) byId.delete(id);
}
for (const item of items) {
  const prev = byId.get(item.id);
  if (prev && prev.status === "published") continue;
  byId.set(item.id, item);
}
const merged = [...byId.values()];
let extra = {};
try {
  extra = JSON.parse(readFileSync(queuePath, "utf8"));
} catch {
  extra = {};
}
delete extra.items;
delete extra.working;
writeFileSync(queuePath, JSON.stringify({ ...extra, fetchedAt, working, items: merged }, null, 2) + "\n");
console.log("working RSS", JSON.stringify(working, null, 2));
console.log("wrote data/review-queue.json", merged.length, "items");
