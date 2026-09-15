import { z } from "zod";
import { CanonicalInstant, PolicyIdentity, PolicyAction, EvidenceReference, HttpsUrl, WatchId,
  canonicalJson, policyIdentityKey, sha256, tupleKey } from "../content/watch-schema";
import { parseSourcePublicationDate } from "./watch/feed-adapter";
import { policyBackground } from "./policy-background";

const Text = z.string().trim().min(1).max(6000);
const Label = Text.pipe(z.string().max(240));
export const PolicyCaptureInput = z.object({ sourceId: WatchId, sourceUrl: HttpsUrl, sourceLabel: Label,
  retrievedAt: CanonicalInstant }).strict();
export type PolicyCaptureInput = z.infer<typeof PolicyCaptureInput>;
export const NativePolicyCapture = z.object({
  parserVersion: Label, source: PolicyCaptureInput, identity: PolicyIdentity, title: Label,
  native: z.unknown(), titlePointer: z.string(), identityPointer: z.string(),
  historyComplete: z.boolean(),
  actions: z.array(z.object({ eventKey: z.string().min(1).max(12_000), nativeCode: Label, text: Text, bodyId: WatchId,
    rawDate: z.string().nullable(), dateFormat: z.enum(["iso", "nj-day", "local-day"]), sourceOrder: z.number().int().nonnegative().nullable(),
    pointer: z.string() }).strict()).max(200),
  version: z.object({ nativeId: Label.nullable(), textUrl: HttpsUrl.nullable(), sourceDate: z.string().nullable() }).strict(),
  gaps: z.array(Label).max(20),
}).strict();
export type NativePolicyCapture = z.infer<typeof NativePolicyCapture>;
function object(value: unknown): Record<string, unknown> {
  return z.record(z.unknown()).parse(value);
}
function rows(value: unknown, maximum = 200): Record<string, unknown>[] {
  return z.array(z.record(z.unknown())).max(maximum).parse(value);
}
function nativeUrl(input: PolicyCaptureInput, hosts: string[]) {
  const url = new URL(PolicyCaptureInput.parse(input).sourceUrl);
  if (!hosts.includes(url.hostname)) throw new Error("policy-native-source-host");
}
function capture(value: NativePolicyCapture) {
  const parsed = NativePolicyCapture.parse(value);
  if (new TextEncoder().encode(canonicalJson(parsed)).length > 500_000) throw new Error("policy-native-byte-limit");
  if (new Set(parsed.actions.map(action => action.eventKey)).size !== parsed.actions.length) throw new Error("policy-native-action-identity-conflict");
  return parsed;
}
const gap = "Native metadata does not establish current legal effect or reviewed applicability.";
function legislativeType(code: string): "bill" | "resolution" {
  if (["HR", "S", "A", "HB", "SB"].includes(code)) return "bill";
  if (["HJRES", "SJRES", "HCONRES", "SCONRES", "HRES", "SRES", "AJR", "SJR", "ACR", "SCR", "AR", "SR", "HCR", "HR"].includes(code)) return "resolution";
  throw new Error("policy-native-instrument-type-unmapped");
}
/** LOC's native JSON bill and /actions records. Key provisioning/fetching is separate. */
export function parseCongressPolicy(input: unknown, source: PolicyCaptureInput) {
  nativeUrl(source, ["api.congress.gov", "www.congress.gov"]);
  const native = object(input), bill = object(native.bill), history = rows(native.actions ?? []);
  const type = Label.parse(bill.type).toUpperCase(), number = z.coerce.number().int().positive().parse(bill.number);
  const congress = z.coerce.number().int().positive().parse(bill.congress);
  const bodyId = type.startsWith("H") ? "us-house" : "us-senate";
  return capture({ parserVersion: "congress-policy-json-1", source, native, title: Label.parse(bill.title),
    titlePointer: "/native/bill/title", identityPointer: "/native/bill", historyComplete: false,
    identity: { jurisdiction: "federal", jurisdictionId: "us", bodyId, sessionKey: String(congress),
      instrumentType: legislativeType(type), sourceInstrumentId: type + number },
    actions: history.map((item, index) => ({
      eventKey: canonicalJson(item),
      nativeCode: Label.parse(item.actionCode ?? item.type ?? "unmapped"), text: Text.parse(item.text), bodyId,
      rawDate: typeof item.actionDate === "string" ? item.actionDate : null, dateFormat: "iso", sourceOrder: null,
      pointer: "/native/actions/" + index,
    })), version: { nativeId: null, textUrl: null, sourceDate: null }, gaps: [gap, "Action API pagination completeness and text versions require separate capture."] });
}
export function parseFederalRegisterPolicy(input: unknown, source: PolicyCaptureInput) {
  nativeUrl(source, ["www.federalregister.gov", "www.govinfo.gov"]);
  const native = object(input), type = z.enum(["Rule", "Proposed Rule"]).parse(native.type);
  const number = Label.parse(native.document_number), date = z.string().parse(native.publication_date);
  const shortTitle = Label.safeParse(native.title);
  return capture({ parserVersion: "federal-register-policy-json-1", source, native, title: shortTitle.success ? shortTitle.data : number,
    titlePointer: shortTitle.success ? "/native/title" : "/native/document_number", identityPointer: "/native", historyComplete: true,
    identity: { jurisdiction: "federal", jurisdictionId: "us", bodyId: "federal-register", sessionKey: "standing",
      instrumentType: type === "Rule" ? "rule" : "proposed-rule", sourceInstrumentId: number },
    actions: [{ eventKey: number + ":publication", nativeCode: type, text: Text.parse(native.action ?? type),
      bodyId: "federal-register", rawDate: date, dateFormat: "iso", sourceOrder: null, pointer: "/native" }],
    version: { nativeId: number, textUrl: typeof native.pdf_url === "string" ? HttpsUrl.parse(native.pdf_url) : null, sourceDate: date },
    gaps: [gap, "Publication of a final rule does not establish that every provision is in effect."] });
}
export function parseDelawareIntroducedPolicy(input: unknown, source: PolicyCaptureInput) {
  nativeUrl(source, ["legis.delaware.gov"]);
  const native = object(input), title = Label.parse(native.Title), match = /^(HB|SB|HCR|SCR|HJR|SJR|HR|SR)\s+([0-9]+)$/.exec(title);
  if (!match) throw new Error("policy-native-amendment-or-type-unmapped");
  const session = z.coerce.number().int().positive().parse(native.GeneralAssemblySession);
  const bodyId = match[1].startsWith("H") ? "de-house" : "de-senate";
  return capture({ parserVersion: "delaware-introduced-json-1", source, native,
    title: title, titlePointer: "/native/Title", identityPointer: "/native", historyComplete: false,
    identity: { jurisdiction: "DE", jurisdictionId: "de", bodyId, sessionKey: String(session),
      instrumentType: match[1] === "HB" || match[1] === "SB" ? "bill" : "resolution", sourceInstrumentId: title },
    actions: [{ eventKey: title + ":introduced", nativeCode: "IntroducedLegislation", text: "Introduced",
      bodyId, rawDate: z.string().parse(native.IntroducedDate), dateFormat: "local-day", sourceOrder: null, pointer: "/native" }],
    version: { nativeId: null, textUrl: null, sourceDate: null }, gaps: [gap, "Introduction feed is not a complete bill action history.", "Source clock has no UTC offset; date precision only."] });
}
/** Rows are parsed with Python's standard CSV parser in the offline archive command. */
export function parseNewJerseyPolicy(input: unknown, sessionKey: string, source: PolicyCaptureInput) {
  nativeUrl(source, ["pub.njleg.state.nj.us"]);
  if (!/^[0-9]{4}$/.test(sessionKey)) throw new Error("policy-native-session-required");
  const native = object(input), bill = object(native.bill), history = rows(native.history);
  const type = Label.parse(bill.BillType), number = z.coerce.number().int().positive().parse(bill.BillNumber);
  const bodyId = type.startsWith("A") ? "nj-assembly" : "nj-senate";
  return capture({ parserVersion: "nj-legislative-text-csv-1", source, native,
    title: Label.safeParse(type + number + ": " + Text.parse(bill.Synopsis)).success ? type + number + ": " + Text.parse(bill.Synopsis) : Label.parse(bill.ActualBillNumber),
    titlePointer: "/native/bill", identityPointer: "/native/bill", historyComplete: true,
    identity: { jurisdiction: "NJ", jurisdictionId: "nj", bodyId, sessionKey,
      instrumentType: legislativeType(type), sourceInstrumentId: type + number },
    actions: history.map((item, index) => {
      if (Label.parse(item.BillType) !== type || Number(item.BillNumber) !== number) throw new Error("policy-native-bill-history-conflict");
      return { eventKey: String(z.coerce.number().int().positive().parse(item.Sequence)), nativeCode: Label.parse(item.Action),
        text: Text.parse(String(item.Action) + (item.Comment ? " " + item.Comment : "")),
        bodyId: item.House === "A" ? "nj-assembly" : item.House === "S" ? "nj-senate" : bodyId,
        rawDate: typeof item.DateAction === "string" ? item.DateAction : null, dateFormat: "nj-day", sourceOrder: Number(item.Sequence),
        pointer: "/native/history/" + index };
    }), version: { nativeId: null, textUrl: null, sourceDate: null },
    gaps: [gap, "CurrentStatus and action abbreviations remain native, not inferred lifecycle transitions."] });
}
export function parsePhiladelphiaPolicy(input: unknown, sessionKey: string, source: PolicyCaptureInput) {
  nativeUrl(source, ["webapi.legistar.com"]);
  if (!new URL(source.sourceUrl).pathname.startsWith("/v1/phila/")) throw new Error("policy-native-tenant-conflict");
  const native = object(input), matter = object(native.matter), history = rows(native.histories);
  const id = z.coerce.number().int().positive().parse(matter.MatterId), type = z.enum(["Bill", "Resolution"]).parse(matter.MatterTypeName);
  const shortTitle = Label.safeParse(matter.MatterTitle);
  return capture({ parserVersion: "philadelphia-legistar-json-1", source, native, title: shortTitle.success ? shortTitle.data : Label.parse(matter.MatterFile),
    titlePointer: shortTitle.success ? "/native/matter/MatterTitle" : "/native/matter/MatterFile", identityPointer: "/native/matter", historyComplete: false,
    identity: { jurisdiction: "regional", jurisdictionId: "pa-philadelphia", bodyId: "philadelphia-city-council", sessionKey: Label.parse(sessionKey),
      instrumentType: type === "Bill" ? "ordinance" : "resolution", sourceInstrumentId: String(id) },
    actions: history.map((item, index) => {
      if (item.MatterHistoryMatterId !== id) throw new Error("policy-native-matter-history-conflict");
      return { eventKey: String(z.number().int().positive().parse(item.MatterHistoryId)),
        nativeCode: String(item.MatterHistoryActionId ?? "unmapped"), text: Text.parse(item.MatterHistoryActionName),
        bodyId: "philadelphia-city-council", rawDate: typeof item.MatterHistoryActionDate === "string" ? item.MatterHistoryActionDate : null,
        dateFormat: "local-day", sourceOrder: null, pointer: "/native/histories/" + index };
    }), version: { nativeId: matter.MatterVersion === null || matter.MatterVersion === undefined ? null : String(matter.MatterVersion),
      textUrl: null, sourceDate: null }, gaps: [gap, "Tenant/session enrollment and complete history require source qualification."] });
}
function atPointer(value: unknown, pointer: string): unknown {
  let current = value;
  for (const key of pointer.slice(1).split("/").map(part => part.replace(/~1/g, "/").replace(/~0/g, "~"))) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, key)) throw new Error("policy-native-pointer-unavailable");
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}
export async function materializePolicyCapture(input: unknown) {
  const parsed = NativePolicyCapture.parse(input), subjectId = await policyIdentityKey(parsed.identity);
  const representation = canonicalJson({ native: parsed.native }), representationSha256 = await sha256(representation);
  const observationId = await tupleKey("policy-native-observation-v1", [subjectId, parsed.source.sourceId, representationSha256]);
  const observation = { id: observationId, sourceId: parsed.source.sourceId, sourceUrl: parsed.source.sourceUrl,
    parserVersion: parsed.parserVersion, representation };
  const evidence: EvidenceReference[] = [];
  async function cite(pointer: string) {
    const id = await tupleKey("policy-native-evidence-v1", [observationId, pointer]);
    if (!evidence.some(item => item.id === id)) evidence.push(EvidenceReference.parse({ id, observationId, sourceId: parsed.source.sourceId,
      sourceUrl: parsed.source.sourceUrl, sourceLabel: parsed.source.sourceLabel, parserVersion: parsed.parserVersion, representationSha256,
      kind: "structured", pointer, valueJson: canonicalJson(atPointer({ native: parsed.native }, pointer)) }));
    return id;
  }
  const titleEvidenceId = await cite(parsed.titlePointer), identityEvidenceId = await cite(parsed.identityPointer);
  const actions = [];
  for (const action of parsed.actions) {
    const evidenceId = await cite(action.pointer);
    let rawDate = action.rawDate;
    if (rawDate && action.dateFormat === "local-day") rawDate = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?$/.test(rawDate) ? rawDate.slice(0, 10) : rawDate;
    if (rawDate && action.dateFormat === "nj-day") {
      const match = /^([0-9]{1,2})\/([0-9]{1,2})\/([0-9]{4}) 0:00:00$/.exec(rawDate);
      rawDate = match ? match[3] + "-" + match[1].padStart(2, "0") + "-" + match[2].padStart(2, "0") : rawDate;
    }
    const date = parseSourcePublicationDate(rawDate, evidenceId, null);
    const id = await tupleKey("policy-native-action-v1", [subjectId, await sha256(action.eventKey)]);
    actions.push({ eventKey: action.eventKey, evidenceId, value: PolicyAction.parse({ id, nativeCode: action.nativeCode, text: action.text,
      bodyId: action.bodyId, sourceOccurredAt: date, sourceOrder: action.sourceOrder }) });
  }
  return { parsed, subjectId, observation, evidence, titleEvidenceId, identityEvidenceId, actions };
}

/** Reuses the qualified PA bill-page extractor; retains exact HTML in the native
 * representation so parsed fields cannot be mistaken for an independently sourced record. */
export function parsePennsylvaniaPolicy(html: string, source: PolicyCaptureInput) {
  nativeUrl(source, ["www.palegis.us", "palegis.us"]);
  if (new TextEncoder().encode(html).length > 350_000) throw new Error("policy-native-byte-limit");
  const background = policyBackground(html, source.sourceUrl, source.retrievedAt);
  const record = background.record;
  const bodyId = record.bill.startsWith("HB ") ? "pa-house" : "pa-senate";
  const native = { html, record, actions: background.actions };
  return capture({ parserVersion: "pa-bill-history-html-1", source, native, title: record.bill,
    titlePointer: "/native/record/bill", identityPointer: "/native/record", historyComplete: background.historyOutcome === "complete",
    identity: { jurisdiction: "PA", jurisdictionId: "pa", bodyId, sessionKey: record.session,
      instrumentType: "bill", sourceInstrumentId: record.bill },
    actions: background.actions.map((action, index) => ({ eventKey: action.wording, nativeCode: "history-text",
      text: action.wording, bodyId, rawDate: action.actionAt?.slice(0, 10) ?? null, dateFormat: "iso", sourceOrder: null,
      pointer: "/native/actions/" + index })),
    version: { nativeId: record.current?.printer ?? null, textUrl: record.current?.url ?? null,
      sourceDate: record.current?.textDate?.slice(0, 10) ?? null },
    gaps: [gap, ...background.blockers.map(String)] });
}
