import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { discoverOfficialSources, officialSourceRegistry } from "../../src/ingest/official-source-discovery";
import { persistOfficialSourceCandidates, persistOfficialSourceSnapshots } from "../../src/ingest/official-source-automation";
import type { D1DatabaseLike, D1StatementLike } from "../../src/ingest/persistence";

export const pdfCases = [
  {bill:"hb1925",printer:"3349",pages:43},
  {bill:"sb1113",printer:"1376",pages:29},
  {bill:"hb1993",printer:"2515",pages:7},
] as const;
export const fixture = (name:string) => readFileSync(new URL(`../fixtures/pa-legislation/${name}`,import.meta.url));

class Statement implements D1StatementLike {
  private values: unknown[] = [];
  constructor(private statement: StatementSync) {}
  bind(...values: unknown[]) {
    const next = new Statement(this.statement);
    next.values = values.map(v=>v instanceof ArrayBuffer ? new Uint8Array(v) : v);
    return next;
  }
  async first<T>() { return (this.statement.get(...this.values as never[]) as T) ?? null; }
  async all<T>() { return {results:this.statement.all(...this.values as never[]) as T[]}; }
  async run() { return this.statement.run(...this.values as never[]); }
}
export function pdfDatabase(path=":memory:") {
  const sqlite = new DatabaseSync(path);
  sqlite.exec("PRAGMA foreign_keys=ON");
  const migrations = new URL("../../migrations/",import.meta.url);
  for (const name of readdirSync(migrations).filter(n=>n.endsWith(".sql")).sort()) sqlite.exec(readFileSync(new URL(name,migrations),"utf8"));
  const db: D1DatabaseLike = {
    prepare(query) { return new Statement(sqlite.prepare(query)); },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try { const result=[]; for(const statement of statements) result.push(await statement.run()); sqlite.exec("COMMIT"); return result; }
      catch(error) { sqlite.exec("ROLLBACK"); throw error; }
    },
  };
  return {db,sqlite};
}
export async function seedPdfBills(db:D1DatabaseLike) {
  for(const {bill} of pdfCases) {
    const source=officialSourceRegistry.sources.find(s=>s.id===`ofs-pa-legislature-${bill}`)!;
    const result=await discoverOfficialSources({sources:[source],now:new Date("2026-09-07T21:00:00.000Z"),detailCapPerRun:0,
      fetchImpl:async()=>new Response(fixture(`captured-${bill}-20260906.html`),{headers:{"content-type":"text/html"}}),
    });
    await persistOfficialSourceSnapshots(db,result.snapshots);
    await persistOfficialSourceCandidates(db,result.candidates,result.snapshots,new Set());
  }
}
export const officialPdfFixtureFetch: typeof fetch = async input => {
  const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url);
  const entry=pdfCases.find(c=>url.pathname===`/legislation/bills/text/PDF/2025/0/${c.bill.toUpperCase()}/PN${c.printer}`);
  if(!entry || !["palegis.us","www.palegis.us"].includes(url.host)) throw Error(`Unexpected fixture request: ${url.origin}${url.pathname}`);
  return new Response(fixture(`captured-${entry.bill}-pn${entry.printer}-20260907.pdf`),{headers:{"content-type":"application/pdf"}});
};
