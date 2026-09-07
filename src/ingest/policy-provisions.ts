import { z } from "zod";

export const PdfLine = z.object({
  text: z.string().max(2000),
  // Layout and strokes are preserved for review, not interpreted as law.
  bbox: z.array(z.number().finite()).length(4),
  role: z.enum(["body", "margin"]),
  marks: z.array(z.enum(["underline", "strike", "uncertain"])).max(3),
}).strict();
export const PageEvidence = z.object({
  pageNumber: z.number().int().min(1).max(500),
  lines: z.array(PdfLine).min(1).max(500),
  textSha256: z.string().regex(/^[a-f0-9]{64}$/),
  renderSha256: z.string().regex(/^[a-f0-9]{64}$/),
  renderer: z.string().min(1).max(100),
});
export type EvidencePage = z.infer<typeof PageEvidence>;
export type Provision = {
  ordinal: number; heading: string;
  parts: Array<{ page: number; line: number; text: string; marks: string[] }>;
  references: string[]; contextOrdinals: number[]; unresolvedReferences: string[];
  interpretationQuestions: string[];
};

/** A referenced definition can itself depend on another section. Cycles are
 * normal in bills; collect the full closure without dropping that context. */
export function provisionContext(group: Provision, groups: Provision[]): Provision[] {
  const needed = new Map<number, Provision>();
  const visit = (current: Provision) => {
    if (needed.has(current.ordinal)) return;
    needed.set(current.ordinal, current);
    for (const ordinal of current.contextOrdinals) {
      const next = groups.find(g => g.ordinal === ordinal);
      if (!next) throw new Error("Missing provision context");
      visit(next);
    }
  };
  visit(group);
  return [...needed.values()].sort((a,b) => a.ordinal-b.ordinal);
}

function sectionNumbers(heading:string):string[] {
  const prefix=/^(?:§\s*|(?:Section|SECTION)\s+)([\d\sa-z]+)\./.exec(heading)?.[1];
  return prefix?.trim().split(/\s+/) ?? [];
}
function sectionReferences(text:string):string[] {
  const result=new Set<string>();
  for(const match of text.matchAll(/\bsections?\s+(\d+[a-z]?)\b|§\s*(\d+[a-z]?)/gi)) {
    result.add(match[1]??match[2]!);
    if(/^sections\b/i.test(match[0])) {
      const list=text.slice(match.index!+match[0].length).split(/\.\s/)[0]!.slice(0,1000);
      for(const next of list.matchAll(/(?:,|\band)\s*(\d+[a-z]?)\b/gi)) result.add(next[1]!);
    }
  }
  return [...result];
}

/** Every body line appears exactly once. Never clip at page or keyword bounds. */
export function reconstructProvisions(pages: EvidencePage[]): Provision[] {
  const groups: Provision[] = [];
  let current: Provision | undefined;
  for (const page of pages) {
    // An amended heading may be separate layout fragments: § / old number /
    // new number / title. Recognize the row, but retain every original fragment.
    const rows: Array<Array<{line:number;value:EvidencePage["lines"][number]}>> = [];
    for (const [line,value] of page.lines.entries()) {
      if(value.role==="margin" || !value.text.trim()) continue;
      const row=rows.at(-1);
      if(row && Math.abs(row[0]!.value.bbox[1]!-value.bbox[1]!)<1) row.push({line,value});
      else rows.push([{line,value}]);
    }
    for (const row of rows) {
      const label=row.map(p=>p.value.text.trim()).join(" ").replace(/\s+\./g,".");
      // A continuation such as "section 3503." or "SECTION 3509 (relating
      // to...)" is a reference, not a section boundary.
      const heading=/^(?:§\s*\d+[a-z]?(?:\s+\d+[a-z]?)*|(?:Section|SECTION)\s+\d+[a-z]?(?:\s+\d+[a-z]?)*)\.\s+\S/.test(label);
      if (!current || heading) {
        current = { ordinal: groups.length, heading: heading ? label : "Preamble and legislative context",
          parts: [], references: [], contextOrdinals: [], unresolvedReferences: [], interpretationQuestions: [] };
        groups.push(current);
      }
      for (const {line,value} of row) current.parts.push({ page: page.pageNumber, line, text: value.text, marks: value.marks });
    }
  }
  const definitions = groups.filter(g => /definitions|exceptions?|exemptions?/i.test(g.heading)).map(g => g.ordinal);
  for (const group of groups) {
    const text = group.parts.map(p => p.text).join(" ");
    group.references = sectionReferences(text);
    group.contextOrdinals = definitions.filter(n => n !== group.ordinal);
    for (const reference of group.references) {
      const matches = groups.filter(g => sectionNumbers(g.heading).includes(reference));
      if (matches.length === 1 && sectionNumbers(matches[0]!.heading).length===1) {
        if (matches[0]!.ordinal !== group.ordinal) group.contextOrdinals.push(matches[0]!.ordinal);
      } else group.unresolvedReferences.push(reference);
    }
    group.contextOrdinals = [...new Set(group.contextOrdinals)];
    if (/^(?:§|Section|SECTION)\s*\d+\s+\d+/.test(group.heading)) group.interpretationQuestions.push("Amended section numbering is retained verbatim; the rendered page must resolve old and proposed numbering.");
    if (group.parts.some(p => p.marks.length)) group.interpretationQuestions.push("Amendment typography or strokes require rendered-page review; no deleted/added wording was silently resolved.");
    if (group.unresolvedReferences.length) group.interpretationQuestions.push("External or ambiguous cross-references require cited context before approval.");
    group.interpretationQuestions.push("Confirm section boundaries, all definitions, exceptions, and cross-references against the rendered PDF before admitting a summary.");
  }
  return groups;
}
