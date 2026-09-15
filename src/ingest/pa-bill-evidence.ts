import { z } from "zod";

const TextVersion = z.object({ printer: z.string(), url: z.string().url(), textDate: z.string().nullable() });
const Evidence = z.object({
  bill: z.string(), session: z.string(), current: TextVersion.nullable(),
  history: z.array(TextVersion), action: z.string(), actionAt: z.string().nullable(), blocker: z.string().nullable(),
});
export type PaBillEvidence = z.infer<typeof Evidence>;
const PREFIX = "Pennsylvania official bill record: ";
const clean = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/&#(?:160|x0*a0);|&nbsp;/gi, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/** Dates are source dates at UTC midnight, never inferred from observation time. */
export function paSourceDate(value: string) {
  const m = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2}),?\s+(20\d{2})\b/i.exec(value);
  if (!m) return null;
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(m[1]!.slice(0, 3).toLowerCase());
  const date = new Date(Date.UTC(Number(m[3]), month, Number(m[2])));
  return date.getUTCMonth() === month && date.getUTCDate() === Number(m[2]) ? date.toISOString() : null;
}

export function extractPaBillEvidence(html: string, pageUrl: string): PaBillEvidence {
  const page = /\/legislation\/bills\/(20\d{2})\/(hb|sb)(\d+)\/?$/i.exec(new URL(pageUrl).pathname);
  if (!page) throw Error("Unsupported Pennsylvania bill identity");
  const bill = `${page[2]!.toUpperCase()} ${page[3]}`;
  const evidence: PaBillEvidence = { bill, session: `${page[1]}-${Number(page[1]) + 1}`, current: null, history: [], action: "", actionAt: null, blocker: null };
  // Each printer card is one official record: its label, PDF, and text date
  // must agree. Never select the first PN from navigation or action history.
  const cards = html.split(/<div\b[^>]*class=["']card\s+float-start[^"']*["'][^>]*>/i).slice(1);
  let currentCount = 0;
  for (const card of cards) {
    const printer = /<div\b[^>]*class=["']mt-2["'][^>]*>\s*PN\s+(\d+)\s*<\/div>/i.exec(card)?.[1];
    if (!printer) continue;
    const current = /title=["']Most recent printers number["']/i.test(card);
    if (current) currentCount++;
    const anchor = /<a\b(?=[^>]*title=["']PDF Bill Text["'])([^>]*)>/i.exec(card)?.[1];
    const href = anchor && /href=["']([^"']+)["']/i.exec(anchor)?.[1];
    const url = href ? new URL(href, pageUrl) : null;
    const expected = `/legislation/bills/text/PDF/${page[1]}/0/${page[2]!.toUpperCase()}${page[3]}/PN${printer}`;
    if (!url || url.protocol !== "https:" || !["www.palegis.us", "palegis.us"].includes(url.hostname) || url.pathname !== expected || url.search || url.hash) {
      evidence.blocker = "PA bill review blocker: inconsistent printer/PDF/bill/session association";
      continue;
    }
    const label = /aria-label=["']([^"']+)["']/i.exec(anchor ?? "")?.[1];
    if (label && !label.includes(`${bill} PN ${printer} Bill Text`)) {
      evidence.blocker = "PA bill review blocker: inconsistent PDF label";
      continue;
    }
    url.hostname = "palegis.us";
    const dateField = current
      ? /<span\b[^>]*title=["']Most recent printers number["'][^>]*>([\s\S]*?)<\/span>/i.exec(card)?.[1]
      : /<small\b[^>]*>([\s\S]*?)<\/small>/i.exec(card)?.[1];
    const record = { printer: `PN ${printer}`, url: url.href, textDate: paSourceDate(clean(dateField ?? "")) };
    evidence.history.push(record);
    if (current) evidence.current = record;
  }
  if (currentCount !== 1 || !evidence.current) evidence.blocker ??= "PA bill review blocker: unambiguous current printer record required";
  const actionField = /<strong\b[^>]*>\s*Last Action:\s*<\/strong>([\s\S]*?)(?:<span\b|<\/div>)/i.exec(html)?.[1];
  evidence.action = clean(actionField ?? "");
  evidence.actionAt = paSourceDate(evidence.action);
  if (!evidence.actionAt) evidence.blocker ??= "PA bill review blocker: official latest action date missing or invalid";
  if (evidence.history.length > 20) evidence.blocker = "PA bill review blocker: printer history exceeds evidence bound";
  return evidence;
}

export function paBillEvidenceText(evidence: PaBillEvidence) {
  return PREFIX + JSON.stringify(evidence) + "\n";
}

/** Official synopsis, not PDF contents. Keep it outside the version identity
 * record so improved extraction cannot create a new legislative development. */
export function paBillSynopsis(html: string) {
  const field = /<div\b[^>]*id=["']shortTitle-wrapper["'][^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1];
  if (!field) return "";
  const text = clean(field.replace(/<button\b[\s\S]*?<\/button>/gi, "").replace(/<span\b[^>]*id=["']shortTitle-dots["'][^>]*>[\s\S]*?<\/span>/gi, "").replace(/<[^>]*>/g, ""));
  // Never silently deliver a partial synopsis as the complete designated field.
  return text.length >= 12 && text.length <= 4000 ? text : "";
}

/** The bounded evidence prefix survives schema-0027 detail persistence/readback. */
export function readPaBillEvidence(text: string | undefined) {
  if (!text?.startsWith(PREFIX)) return undefined;
  try { return Evidence.parse(JSON.parse(text.slice(PREFIX.length).split("\n")[0]!)); } catch { return undefined; }
}
