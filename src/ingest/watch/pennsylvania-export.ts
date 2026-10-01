import { XMLParser, XMLValidator } from "fast-xml-parser";
import { z } from "zod";
import { canonicalJson, sha256 } from "../../content/watch-schema";
import { NativePolicyCapture, type PolicyCaptureInput } from "../policy-watch-native";
import { extractBoundedZip } from "./bounded-zip";
import { SourceEnrollment } from "./source-enrollment";

export const PA_EXPORT_PARSER_ID = "watch-pa-bill-history-export";
export const PA_EXPORT_URL = "https://www.palegis.us/data/file?documentType=BillHistoryData&session=2025_0";
export const PA_EXPORT_NORMALIZER = "watch-pa-zip-xml-v1";
const Text = z.string().min(1).max(6000);
const Document = z.object({ id: z.string().regex(/^20250[HS]B[0-9]{4}$/), sessionYear: z.literal("2025"), session: z.literal("0"),
  body: z.enum(["H", "S"]), type: z.literal("B"), number: z.string().regex(/^\d{1,4}$/), shortTitle: Text,
  versions: z.array(z.object({ sequence: z.number().int().positive(), pn: z.string().regex(/^[1-9]\d*$/),
    textUrl: z.string().url(), textDate: z.null() }).strict()).min(1).max(100),
  actions: z.array(z.object({ sequence: z.number().int().positive(), chamber: z.enum(["H", "S"]),
    verb: z.string().min(1).max(240), text: Text, rawDate: z.string(), date: z.string(), pn: z.string().regex(/^[1-9]\d*$/) }).strict()).min(1).max(100),
}).strict();
type Document = z.infer<typeof Document>;
const array = (input: unknown): unknown[] => input === undefined || input === "" ? [] : Array.isArray(input) ? input : [input];
const obj = (input: unknown) => z.record(z.unknown()).parse(input);
const literal = (input: unknown, attributes: readonly string[] = []) => {
  if (typeof input !== "object" || input === null) return z.string().parse(input);
  const node = obj(input);
  if (Object.keys(node).some(key => key !== "#text" && !attributes.includes(key)) ||
      attributes.some(key => key in node && typeof node[key] !== "string")) throw Error("pa-export-scalar-structure");
  return z.string().parse(node["#text"]);
};
const sequence = (input: unknown) => z.number().int().positive().parse(Number(z.string().regex(/^0*[1-9]\d*$/).parse(input)));

function day(raw: string) {
  const match = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(raw);
  if (!match) throw Error("pa-export-action-date");
  const iso = `20${match[3]}-${match[1]}-${match[2]}`;
  if (new Date(iso + "T00:00:00Z").toISOString().slice(0, 10) !== iso) throw Error("pa-export-action-date");
  return iso;
}
export function paExportClock(raw: string) {
  const match = /^(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM) (EDT|EST)$/.exec(raw);
  if (!match) throw Error("pa-export-clock");
  const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const month = months.indexOf(match[1]) + 1, hour = Number(match[4]);
  if (hour < 1 || hour > 12 || Number(match[5]) > 59 || Number(match[6]) > 59) throw Error("pa-export-clock");
  const local = `${match[3]}-${String(month).padStart(2,"0")}-${match[2].padStart(2,"0")}T${String(hour % 12 + (match[7] === "PM" ? 12 : 0)).padStart(2,"0")}:${match[5]}:${match[6]}`;
  const instant = new Date(local + (match[8] === "EDT" ? "-04:00" : "-05:00")).toISOString();
  // Roundtrip both date and declared NY offset; mislabeled clocks fail closed.
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23" }).formatToParts(new Date(instant));
  const get = (key: string) => parts.find(part => part.type === key)?.value;
  if (`${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}` !== local) throw Error("pa-export-clock-zone-or-date");
  return { raw, instant, precision: "second" as const, timezone: "America/New_York", offset: match[8] };
}

/** Replayable semantic document only. Archive/export/update/check clocks live in receipts. */
export function parsePennsylvaniaExportPolicy(input: unknown, source: PolicyCaptureInput): NativePolicyCapture {
  const document = Document.parse(input), bill = `${document.body}B${Number(document.number)}`;
  if (source.sourceUrl !== PA_EXPORT_URL || document.id !== `20250${document.body}B${document.number.padStart(4,"0")}`) throw Error("pa-export-bill-identity");
  for (const [index, version] of document.versions.entries()) {
    if (version.sequence !== index + 1 || version.textUrl !== `https://www.palegis.us/legislation/bills/text/PDF/2025/0/${bill}/PN${version.pn}`) throw Error("pa-export-version-association");
  }
  if (new Set(document.versions.map(version => version.pn)).size !== document.versions.length) throw Error("pa-export-duplicate-pn");
  for (const [index, action] of document.actions.entries()) {
    if (action.sequence !== index + 1 || action.date !== day(action.rawDate) || !document.versions.some(version => version.pn === action.pn) ||
        (index && action.date < document.actions[index - 1].date)) throw Error("pa-export-action-association");
  }
  const native = { document, bill: `${document.body}B ${Number(document.number)}`, synopsis: document.shortTitle }, current = document.versions[0];
  return NativePolicyCapture.parse({ parserVersion: "pa-bill-history-xml-1", source, native, title: `${document.body}B ${Number(document.number)}`,
    identity: { jurisdiction: "PA", jurisdictionId: "pa", bodyId: document.body === "H" ? "pa-house" : "pa-senate", sessionKey: "2025-2026", instrumentType: "bill", sourceInstrumentId: `${document.body}B ${Number(document.number)}` },
    titlePointer: "/native/bill", identityPointer: "/native/document", historyComplete: false,
    actions: document.actions.map((action, index) => ({ eventKey: `${action.sequence}:${action.chamber}:${action.rawDate}:${action.text}:${action.pn}`,
      nativeCode: action.verb, text: action.text, bodyId: action.chamber === "H" ? "pa-house" : "pa-senate", rawDate: action.date,
      dateFormat: "iso", sourceOrder: action.sequence, pointer: `/native/document/actions/${index}` })),
    version: { nativeId: `PN ${current.pn}`, textUrl: current.textUrl, sourceDate: null },
    gaps: ["Native metadata does not establish current legal effect or reviewed applicability.",
      "Export history is a historical snapshot, not verified latest bill status.", "PN text dates and full PDF text require separate evidence."] });
}

export function validatedPaExportSource(input: unknown) {
  const source = SourceEnrollment.parse(input);
  if (source.transport !== "official-zip-xml" || source.parserId !== PA_EXPORT_PARSER_ID || source.parserVersion !== "1" || !source.paExport ||
      source.desk !== "policy" || source.jurisdiction !== "PA" || source.family !== "legislation" || source.authority !== "official" ||
      source.dateTimezone !== "America/New_York" || source.requiresAuth || source.endpoints.length !== 1 || source.endpoints[0] !== PA_EXPORT_URL) throw Error("pa-export-source-contract");
  return source;
}

export async function derivePaExport(input: unknown, bytes: Uint8Array) {
  const source = validatedPaExportSource(input), profile = source.paExport!;
  if (bytes.length > source.maxBytes) throw Error("pa-export-raw-byte-limit");
  const entries = await extractBoundedZip(bytes), member = entries.find(entry => entry.name === profile.memberName);
  if (entries.length !== 1 || !member) throw Error("pa-export-member-missing-or-ambiguous");
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(member.bytes);
  if (/<!DOCTYPE|<!ENTITY|<!\[CDATA\[|<!--/i.test(xml) || /&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[\da-fA-F]+;)/.test(xml)) throw Error("pa-export-xml-entities-or-declarations");
  let depth = 0;
  for (const tag of xml.matchAll(/<[^>]*>/g)) {
    if (/^<\?/.test(tag[0])) continue;
    if (/^<\//.test(tag[0])) depth--;
    else if (!/\/\s*>$/.test(tag[0])) depth++;
    if (depth > 16 || depth < 0) throw Error("pa-export-xml-depth");
  }
  if (depth || XMLValidator.validate(xml) !== true) throw Error("pa-export-xml-structure");
  const envelope = /^\s*<\?xml version="1\.0" encoding="UTF-8"\?>\s*<historyExport exportDate="([^"]+)" totalDocuments="(\d+)">\s*<session year="2025" session="0">([\s\S]*)<\/session>\s*<\/historyExport>\s*$/.exec(xml);
  if (!envelope) throw Error("pa-export-session-or-envelope");
  const exportDate = paExportClock(envelope[1]), rawArchiveSha256 = await sha256(bytes), memberSha256 = await sha256(member.bytes);
  // Numeric XML references require this decoder option; the lexical allowlist above
  // still rejects every HTML-only named entity, custom entity and declaration.
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", parseTagValue: false, parseAttributeValue: false, trimValues: false, processEntities: true, htmlEntities: true });
  const records = [], ids = new Set<string>(); let lastEnd = 0;
  for (const match of envelope[3].matchAll(/<bill\b[^>]*>[\s\S]*?<\/bill>/g)) {
    if (envelope[3].slice(lastEnd, match.index).trim()) throw Error("pa-export-inventory-structure");
    lastEnd = match.index + match[0].length;
    const id = /^<bill id="([^"]+)" lastUpdate="([^"]*)">/.exec(match[0]);
    if (!id || !/^20250[HS][A-Z]{1,3}\d{4}$/.test(id[1]) || ids.has(id[1])) throw Error("pa-export-duplicate-or-invalid-document");
    ids.add(id[1]);
    const identity = /^20250([HS][A-Z]{1,3})(\d{4})$/.exec(id[1])!;
    const bill = identity[1] + Number(identity[2]);
    if (!profile.selectedBills.includes(bill as typeof profile.selectedBills[number])) continue;
    const record = obj(parser.parse(match[0]).bill), versions = obj(record.printersNumberHistory), actions = obj(record.actionHistory);
    if (literal(record.subType) !== "B") throw Error("pa-export-bill-subtype");
    const document = Document.parse({ id: id[1], sessionYear: literal(record.sessionYear), session: literal(record.session), body: literal(record.body),
      type: literal(record.type, ["@description"]), number: literal(record.number), shortTitle: literal(record.shortTitle),
      versions: array(versions.number).map(value => { const row = obj(value); return { sequence: sequence(row["@sequence"]), pn: literal(row, ["@sequence", "@billTextPdfUrl"]), textUrl: row["@billTextPdfUrl"], textDate: null }; }),
      actions: array(actions.action).map(value => { const row = obj(value); return { sequence: sequence(row["@sequence"]), chamber: row["@actionChamber"], verb: literal(row.verb), text: literal(row.fullAction), rawDate: literal(row.date), date: day(literal(row.date)), pn: literal(row.printersNumber) }; }) });
    parsePennsylvaniaExportPolicy(document, { sourceId: source.id, sourceUrl: source.endpoints[0], sourceLabel: source.name, retrievedAt: exportDate.instant });
    const lastUpdate = paExportClock(id[2]);
    if (lastUpdate.instant > exportDate.instant) throw Error("pa-export-update-after-export");
    const path = `/historyExport/session/bill[@id='${id[1]}']`;
    const fieldPaths = { id: `${path}/@id`, sessionYear: `${path}/sessionYear`, session: `${path}/session`, body: `${path}/body`, type: `${path}/type`, number: `${path}/number`,
      shortTitle: `${path}/shortTitle`, versions: `${path}/printersNumberHistory/number`, actions: `${path}/actionHistory/action` };
    const fields = await Promise.all(Object.entries(fieldPaths).map(async ([field, xmlPath]) => ({ field, xmlPath,
      valueSha256: await sha256(canonicalJson(document[field as keyof Document])) })));
    records.push({ bill, document, documentSha256: await sha256(match[0]), semanticSha256: await sha256(canonicalJson(document)), lastUpdate, fields });
  }
  if (envelope[3].slice(lastEnd).trim() || ids.size !== Number(envelope[2]) || records.length !== profile.selectedBills.length) throw Error("pa-export-missing-selected-or-count-conflict");
  records.sort((a,b) => a.bill.localeCompare(b.bill));
  const receipt = { normalizerVersion: PA_EXPORT_NORMALIZER, rawArchiveSha256, memberName: member.name, memberSha256, expandedBytes: member.bytes.length,
    exportDate, inventoryCount: ids.size, selectedCount: records.length, completeCoverage: false,
    records: records.map(({ document: _document, ...record }) => record) };
  return { receipt, records, normalizedText: canonicalJson(receipt) };
}

/** The only binary normalizer. Text guards for all existing adapters stay literal. */
export async function normalizeWatchRepresentation(source: SourceEnrollment, bytes: Uint8Array) {
  return source.transport === "official-zip-xml" ? (await derivePaExport(source, bytes)).normalizedText : new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function assertPaExportProgress(previousText: string, currentText: string) {
  const previous = JSON.parse(previousText), current = JSON.parse(currentText);
  if (previous.normalizerVersion !== PA_EXPORT_NORMALIZER || current.normalizerVersion !== PA_EXPORT_NORMALIZER ||
      current.exportDate.instant < previous.exportDate.instant) throw Error("pa-export-clock-regression");
  for (const old of previous.records) {
    const next = current.records.find((record: {bill:string}) => record.bill === old.bill);
    if (!next || next.lastUpdate.instant < old.lastUpdate.instant ||
        (next.lastUpdate.instant === old.lastUpdate.instant && next.semanticSha256 !== old.semanticSha256)) throw Error("pa-export-bill-clock-or-content-conflict");
  }
}

export function paSnapshotFreshness(input: { exportAt: string; lastCheckedAt: string; lastSuccessfulUpstreamCheckAt: string | null;
  currentFailure: string | null; origin: "library-research" | "upstream" }, now: string) {
  return { ...input, exportAgeMs: Math.max(0, Date.parse(now) - Date.parse(input.exportAt)),
    lastSuccessfulUpstreamCheckAt: input.origin === "library-research" ? null : input.lastSuccessfulUpstreamCheckAt,
    latestStatusVerified: false as const };
}
