import { z } from "zod";
import type { D1DatabaseLike } from "./persistence";
import { paBillEvidenceText, readPaBillEvidence } from "./pa-bill-evidence";
import { PageEvidence, provisionContext, reconstructProvisions, type EvidencePage, type Provision } from "./policy-provisions";

const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Id = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,239}$/;
const MAX_BYTES = 5_000_000;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status,
  headers: { "content-type": "application/json", "cache-control": "no-store", "x-robots-tag": "noindex" } });
class EvidenceError extends Error { constructor(message: string, readonly status = 409) { super(message); } }
export async function evidenceHash(value: string | Uint8Array) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.buffer))].map(b => b.toString(16).padStart(2, "0")).join("");
}
async function boundedBytes(body: ReadableStream<Uint8Array> | null, limit: number) {
  if (!body) throw new EvidenceError("missing-body", 400);
  const reader = body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length; if (size > limit) throw new EvidenceError("body-limit", 413);
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => undefined); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
async function bodyJson(request: Request, max = 900_000): Promise<unknown> {
  if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) throw new EvidenceError("json-required", 415);
  return JSON.parse(new TextDecoder().decode(await boundedBytes(request.body, max)));
}
function bytesFromDb(value: ArrayBuffer | Uint8Array | number[]) {
  return value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value);
}
type Version = { id: string; instrument_row_id: string; instrument_id: string; session: string; version_id: string;
  jurisdiction: string; text_url: string; evidence_json: string; development_at: string; last_seen_at: string; stage: string };
type Artifact = { id: string; version_row_id: string; sha256: string; byte_count: number; source_url: string;
  binding_json: string; captured_at: string; state: string; page_count: number | null; extraction_sha256: string | null; extraction_error: string | null };
type PageRow = { page_number: number; lines_json: string; text_sha256: string; render_sha256: string; renderer: string };
type GroupRow = { id: string; ordinal: number; heading: string; evidence_sha256: string; evidence_json: string };
const getArtifact = (db: D1DatabaseLike, id: string) => db.prepare("SELECT * FROM policy_pdf_artifacts WHERE id = ?").bind(id).first<Artifact>();

/** Authenticated caller only. URL/identity comes from durable official records,
 * never from a caller-supplied URL. No schedule or collection state is changed. */
export async function capturePolicyPdf(db: D1DatabaseLike, versionId: string, operator: string, fetchImpl: typeof fetch = fetch) {
  const version = await db.prepare(`SELECT v.*, i.instrument_id, i.session, i.jurisdiction
    FROM policy_versions v JOIN policy_instruments i ON i.id = v.instrument_row_id WHERE v.id = ?`).bind(versionId).first<Version>();
  if (!version) throw new EvidenceError("version-not-found", 404);
  const bill = /^(HB|SB) ([1-9]\d*)$/.exec(version.instrument_id), pn = /^PN ([1-9]\d*)$/.exec(version.version_id);
  const session = /^(20\d{2})-(20\d{2})$/.exec(version.session);
  let url: URL;
  try { url = new URL(version.text_url); } catch { throw new EvidenceError("version-url-conflict"); }
  if (version.jurisdiction !== "PA" || !bill || !pn || !session || Number(session[2]) !== Number(session[1]) + 1 ||
      url.protocol !== "https:" || !["palegis.us", "www.palegis.us"].includes(url.host) || url.username || url.password || url.search || url.hash ||
      url.pathname !== `/legislation/bills/text/PDF/${session[1]}/0/${bill[1]}${bill[2]}/PN${pn[1]}`) throw new EvidenceError("version-url-conflict");
  const officialEvidence=JSON.parse(version.evidence_json);
  const record=readPaBillEvidence(paBillEvidenceText(officialEvidence.officialBillRecord));
  if(!record || record.blocker || record.bill!==version.instrument_id || record.session!==version.session || record.current?.printer!==version.version_id || record.current.url!==url.href || !record.actionAt || record.actionAt!==version.development_at) throw new EvidenceError("official-record-binding-conflict");
  const signal = AbortSignal.timeout(15_000); let target = url.href; let bytes: Uint8Array | undefined;
  const hops: Array<{url:string;status:number}> = [];
  for (let hop = 0; hop <= 4; hop++) {
    const next = new URL(target);
    if (next.protocol !== "https:" || !["palegis.us","www.palegis.us"].includes(next.host) || next.username || next.password ||
        next.pathname !== url.pathname || next.search || next.hash) throw new EvidenceError("pdf-redirect-conflict");
    const r = await fetchImpl(target, { redirect: "manual", signal,
      headers: { "user-agent": "TheValleyDesk/0.1 (+https://github.com/ajhcs/the-valley-desk)", accept: "application/pdf" } });
    hops.push({url:target,status:r.status});
    if ([301,302,303,307,308].includes(r.status)) {
      const location = r.headers.get("location"); await r.body?.cancel();
      if (!location) throw new EvidenceError("redirect-without-location");
      target = new URL(location,target).href; continue;
    }
    if (!r.ok || !r.headers.get("content-type")?.toLowerCase().includes("application/pdf")) {
      await r.body?.cancel(); throw new EvidenceError(`official-pdf-http-${r.status}`, 502);
    }
    bytes = await boundedBytes(r.body,MAX_BYTES); break;
  }
  if (!bytes || new TextDecoder().decode(bytes.slice(0,5)) !== "%PDF-") throw new EvidenceError("invalid-pdf-or-redirect-limit");
  const sha256 = await evidenceHash(bytes), id = `pdf-${await evidenceHash(`${versionId}:${sha256}`)}`;
  const existing = await getArtifact(db,id);
  if (existing) return existing;
  const count = await db.prepare("SELECT COUNT(*) n FROM policy_pdf_artifacts WHERE version_row_id = ?").bind(versionId).first<{n:number}>();
  if ((count?.n ?? 0) >= 8) throw new EvidenceError("artifact-capacity-hold");
  const binding = { bill:version.instrument_id, session:version.session, printer:version.version_id, versionId,
    sourceUrl:url.href, officialEvidence, legislativeActionAt:version.development_at,
    observedAt:version.last_seen_at, fetchHops:hops };
  const statements = [db.prepare(`INSERT OR IGNORE INTO policy_pdf_artifacts
    (id,version_row_id,sha256,byte_count,source_url,binding_json,captured_at,captured_by) VALUES (?,?,?,?,?,?,?,?)`)
    .bind(id,versionId,sha256,bytes.length,url.href,JSON.stringify(binding),new Date().toISOString(),operator)];
  for (let offset=0;offset<bytes.length;offset+=100_000) statements.push(db.prepare(
    "INSERT OR IGNORE INTO policy_pdf_chunks (artifact_id,chunk_index,bytes) VALUES (?,?,?)"
  ).bind(id,offset/100_000,bytes.slice(offset,offset+100_000).buffer));
  await db.batch(statements); // D1 atomic batch: metadata and bytes become visible together.
  return getArtifact(db,id);
}

async function storePage(db: D1DatabaseLike, artifact: Artifact, raw: unknown, number: number) {
  const page = PageEvidence.extend({ artifactSha256:Digest, pngBase64:z.string().max(700_000) }).strict().parse(raw);
  if (page.artifactSha256 !== artifact.sha256 || page.pageNumber !== number || number > 100) throw new EvidenceError("page-artifact-conflict");
  const lines = JSON.stringify(page.lines);
  if (page.lines.reduce((n,l)=>n+l.text.length,0)>32_000 || lines.length>100_000) throw new EvidenceError("page-text-limit",413);
  let png: Uint8Array<ArrayBuffer>;
  try { png = Uint8Array.from(atob(page.pngBase64),c=>c.charCodeAt(0)); } catch { throw new EvidenceError("invalid-render-png",400); }
  if (png.length>500_000 || png.length<24 || png.slice(0,8).join(',')!=="137,80,78,71,13,10,26,10") throw new EvidenceError("invalid-render-png");
  const view = new DataView(png.buffer);
  if (view.getUint32(16)>2000 || view.getUint32(20)>3000) throw new EvidenceError("render-dimensions-limit");
  if (await evidenceHash(lines)!==page.textSha256 || await evidenceHash(png)!==page.renderSha256) throw new EvidenceError("page-checksum-conflict");
  const old = await db.prepare("SELECT text_sha256,render_sha256 FROM policy_pdf_pages WHERE artifact_id=? AND page_number=?")
    .bind(artifact.id,number).first<{text_sha256:string;render_sha256:string}>();
  if (!old && artifact.state==="complete") throw new EvidenceError("extraction-immutable");
  await db.prepare(`INSERT OR IGNORE INTO policy_pdf_pages
    (artifact_id,page_number,lines_json,text_sha256,render_sha256,render_png,renderer) VALUES (?,?,?,?,?,?,?)`)
    .bind(artifact.id,number,lines,page.textSha256,page.renderSha256,png.buffer,page.renderer).run();
  const saved = await db.prepare("SELECT text_sha256,render_sha256 FROM policy_pdf_pages WHERE artifact_id=? AND page_number=?")
    .bind(artifact.id,number).first<{text_sha256:string;render_sha256:string}>();
  if (saved?.text_sha256!==page.textSha256 || saved?.render_sha256!==page.renderSha256) throw new EvidenceError("immutable-page-conflict");
  return { outcome:old?"unchanged":"stored", pageNumber:number };
}
async function readPages(db: D1DatabaseLike,id:string): Promise<EvidencePage[]> {
  const rows = await db.prepare("SELECT page_number,lines_json,text_sha256,render_sha256,renderer FROM policy_pdf_pages WHERE artifact_id=? ORDER BY page_number LIMIT 101")
    .bind(id).all<PageRow>();
  return (rows.results??[]).map(r=>PageEvidence.parse({pageNumber:r.page_number,lines:JSON.parse(r.lines_json),textSha256:r.text_sha256,renderSha256:r.render_sha256,renderer:r.renderer}));
}
async function complete(db:D1DatabaseLike, artifact:Artifact, raw:unknown) {
  const data = z.object({artifactSha256:Digest,pageCount:z.number().int().min(1).max(100),
    headerIdentity:z.object({bill:z.string(),session:z.string(),printer:z.string()}).strict()}).strict().parse(raw);
  const binding=JSON.parse(artifact.binding_json);
  if (data.artifactSha256!==artifact.sha256 || data.headerIdentity.bill!==binding.bill || data.headerIdentity.session!==binding.session || data.headerIdentity.printer!==binding.printer) throw new EvidenceError("extraction-binding-conflict");
  const pages=await readPages(db,artifact.id);
  if (pages.length!==data.pageCount || pages.some((p,i)=>p.pageNumber!==i+1 || !p.lines.some(l=>l.role==="body"&&l.text.trim()))) throw new EvidenceError("incomplete-extraction");
  if (pages.reduce((n,p)=>n+p.lines.reduce((k,l)=>k+l.text.length,0),0)>2_000_000) throw new EvidenceError("extraction-text-limit");
  const groups=reconstructProvisions(pages);
  if (!groups.length || groups.length>80) throw new EvidenceError("provision-capacity-hold");
  const digest=await evidenceHash(JSON.stringify({pages,groups}));
  if (artifact.extraction_sha256 && artifact.extraction_sha256!==digest) throw new EvidenceError("extraction-immutable");
  const statements=[];
  for (const group of groups) {
    const evidence={...group,renderPages:[...new Set(group.parts.map(p=>p.page))].map(n=>({page:n,sha256:pages[n-1]!.renderSha256}))};
    const value=JSON.stringify(evidence), hash=await evidenceHash(value);
    statements.push(db.prepare("INSERT OR IGNORE INTO policy_provisions (id,artifact_id,ordinal,heading,evidence_sha256,evidence_json) VALUES (?,?,?,?,?,?)")
      .bind(`${artifact.id}-${group.ordinal}`,artifact.id,group.ordinal,group.heading,hash,value));
  }
  statements.push(db.prepare("UPDATE policy_pdf_artifacts SET state='complete',page_count=?,extraction_sha256=?,extraction_error=NULL WHERE id=? AND (extraction_sha256 IS NULL OR extraction_sha256=?)")
    .bind(data.pageCount,digest,artifact.id,digest));
  await db.batch(statements);
  return {outcome:artifact.extraction_sha256?"unchanged":"complete",provisions:groups.length,extractionSha256:digest};
}

const Review = z.object({ evidenceSha256:Digest, decision:z.enum(["approved","hold"]), summary:z.string().trim().max(4000),
  questions:z.array(z.string().trim().min(1).max(1000)).max(20),
  supportingSpans:z.array(z.object({page:z.number().int().positive(),line:z.number().int().nonnegative(),quote:z.string().min(12).max(2000)}).strict()).max(12),
  renderedPages:z.array(z.object({page:z.number().int().positive(),sha256:Digest}).strict()).max(100),
  verificationNote:z.string().trim().min(20).max(3000),
  confirmedDefinitionsExceptionsAndReferences:z.boolean(),
}).strict();
async function reviewProvision(db:D1DatabaseLike,id:string,raw:unknown,operator:string) {
  const review=Review.parse(raw);
  const group=await db.prepare("SELECT * FROM policy_provisions WHERE id=?").bind(id).first<GroupRow & {artifact_id:string}>();
  if (!group) throw new EvidenceError("provision-not-found",404);
  const artifact=await getArtifact(db,group.artifact_id);
  if (artifact?.state!=="complete" || group.evidence_sha256!==review.evidenceSha256) throw new EvidenceError("review-evidence-conflict");
  const evidence=JSON.parse(group.evidence_json) as Provision;
  const context=await db.prepare("SELECT * FROM policy_provisions WHERE artifact_id=? ORDER BY ordinal").bind(artifact.id).all<GroupRow>();
  const needed=provisionContext(evidence,(context.results??[]).map(g=>JSON.parse(g.evidence_json) as Provision));
  const pageNumbers=[...new Set(needed.flatMap(g=>g.parts.map(p=>p.page)))].sort((a,b)=>a-b);
  const pages=await readPages(db,artifact.id);
  const expected=pageNumbers.map(n=>({page:n,sha256:pages[n-1]!.renderSha256}));
  if(review.supportingSpans.some(span=>!needed.some(g=>g.parts.some(p=>p.page===span.page&&p.line===span.line&&p.text.includes(span.quote))))) throw new EvidenceError("nonliteral-supporting-span");
  if (review.decision==="approved" && (!review.summary || review.questions.length || !review.confirmedDefinitionsExceptionsAndReferences ||
      !review.supportingSpans.length || needed.some(g=>g.unresolvedReferences.length) || JSON.stringify(review.renderedPages)!==JSON.stringify(expected))) throw new EvidenceError("rendered-context-review-required");
  if (review.decision==="hold" && !review.questions.length) throw new EvidenceError("specific-review-question-required");
  const payload=JSON.stringify(review), reviewId=`review-${await evidenceHash(`${id}:${operator}:${payload}`)}`;
  const replay=await db.prepare("SELECT id FROM policy_provision_reviews WHERE id=?").bind(reviewId).first<{id:string}>();
  if(replay) {
    const latest=await db.prepare("SELECT id FROM policy_provision_reviews WHERE provision_id=? ORDER BY reviewed_at DESC,rowid DESC LIMIT 1").bind(id).first<{id:string}>();
    if(latest?.id!==reviewId) throw new EvidenceError("review-superseded-reassessment-required");
  }
  await db.prepare(`INSERT OR IGNORE INTO policy_provision_reviews
    (id,provision_id,evidence_sha256,decision,summary,questions_json,verification_json,reviewer,reviewed_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(reviewId,id,group.evidence_sha256,review.decision,review.summary,JSON.stringify(review.questions),payload,operator,new Date().toISOString()).run();
  return {id:reviewId,decision:review.decision,publicationAuthorized:false};
}

export async function policyBaselineView(db:D1DatabaseLike, privateView=false) {
  const rows=await db.prepare(`SELECT v.*,i.instrument_id,i.session,i.jurisdiction,i.title,i.current_version_id
    FROM policy_versions v JOIN policy_instruments i ON i.id=v.instrument_row_id
    WHERE i.jurisdiction='PA' AND i.instrument_id IN ('HB 1925','SB 1113','HB 1993')
      AND v.version_id=i.current_version_id
      AND v.id=(SELECT v2.id FROM policy_versions v2 WHERE v2.instrument_row_id=i.id AND v2.version_id=i.current_version_id ORDER BY development_at DESC,first_seen_at DESC,id LIMIT 1)
    ORDER BY i.instrument_id LIMIT 3`).all<Version & {title:string}>();
  const bills=await Promise.all((rows.results??[]).map(async version=>{
    const source=JSON.parse(version.evidence_json);
    const artifact=await db.prepare("SELECT * FROM policy_pdf_artifacts WHERE version_row_id=? ORDER BY captured_at DESC,id DESC LIMIT 1").bind(version.id).first<Artifact>();
    const groups=artifact ? (await db.prepare(`SELECT p.*,r.decision,r.summary,r.questions_json,r.reviewed_at,r.verification_json
      FROM policy_provisions p LEFT JOIN policy_provision_reviews r ON r.rowid=(
        SELECT r2.rowid FROM policy_provision_reviews r2 WHERE r2.provision_id=p.id AND r2.evidence_sha256=p.evidence_sha256 ORDER BY reviewed_at DESC,rowid DESC LIMIT 1)
      WHERE p.artifact_id=? ORDER BY ordinal LIMIT 80`).bind(artifact.id).all<GroupRow & {decision:string|null;summary:string|null;questions_json:string|null;reviewed_at:string|null;verification_json:string|null}>()).results??[] : [];
    return { versionId:version.id,bill:version.instrument_id,session:version.session,printer:version.version_id,
      action:source.officialBillRecord?.action ?? version.stage,actionAt:version.development_at,observedAt:version.last_seen_at,
      textDate:source.officialBillRecord?.current?.textDate??null,sourceUrl:source.historyUrl,textUrl:version.text_url,
      priorPrinters:source.officialBillRecord?.history??[],
      artifact:artifact?{id:artifact.id,sha256:artifact.sha256,state:artifact.state,pageCount:artifact.page_count,capturedAt:artifact.captured_at,error:artifact.extraction_error}:null,
      provisions:groups.map(group=>{
        const e=JSON.parse(group.evidence_json) as Provision;
        return {id:group.id,heading:group.heading,evidenceSha256:group.evidence_sha256,
          decision:group.decision??"unreviewed",summary:group.decision==="approved"?group.summary:null,
          questions:group.decision==="approved"?[]:group.questions_json?JSON.parse(group.questions_json):e.interpretationQuestions,
          pages:[...new Set(e.parts.map(p=>p.page))],references:e.references,
          reviewedContextPages:group.decision==="approved" && group.verification_json ? Review.parse(JSON.parse(group.verification_json)).renderedPages.map(p=>p.page) : [],
          ...(privateView?{evidence:e,reviewedAt:group.reviewed_at}:{}),
        };
      }),
    };
  }));
  return {kind:"policy-background",generatedAt:new Date().toISOString(),bills,publicationAuthorized:false,
    notice:"Observed legislative background, not new reporting. Proposed language is not a finding of operative law. Only rendered-page-reviewed summaries are shown."};
}

/** Must be called AFTER the existing bearer/Access authorization check. */
export async function handlePolicyPdfApi(request:Request, db:D1DatabaseLike, pathname:string, operator:string) {
  try {
    if (pathname==="/api/policy-background" && ["GET","HEAD"].includes(request.method)) return json(await policyBaselineView(db,true));
    const capture=/^\/api\/policy-versions\/([^/]+)\/capture$/.exec(pathname);
    if (capture && request.method==="POST") {
      if (!Id.test(capture[1]!)) throw new EvidenceError("invalid-id",400);
      return json(await capturePolicyPdf(db,capture[1]!,operator),201);
    }
    const review=/^\/api\/policy-provisions\/([^/]+)\/review$/.exec(pathname);
    if (review && request.method==="POST") return json(await reviewProvision(db,review[1]!,await bodyJson(request,30_000),operator));
    const route=/^\/api\/policy-pdf\/([^/]+)(?:\/(content|complete|failure|pages)(?:\/(\d+)(\/render)?)?)?$/.exec(pathname);
    if (!route || !Id.test(route[1]!)) return json({error:"not_found"},404);
    const artifact=await getArtifact(db,route[1]!);
    if (!artifact) return json({error:"artifact-not-found"},404);
    if (request.method==="GET" || request.method==="HEAD") {
      if (route[2]==="content") {
        const rows=(await db.prepare("SELECT chunk_index,bytes FROM policy_pdf_chunks WHERE artifact_id=? ORDER BY chunk_index").bind(artifact.id).all<{chunk_index:number;bytes:ArrayBuffer|number[]}>()).results??[];
        const bytes=new Uint8Array(artifact.byte_count); let offset=0;
        for (const [i,row] of rows.entries()) { if(row.chunk_index!==i) throw new EvidenceError("artifact-corrupt"); const b=bytesFromDb(row.bytes); bytes.set(b,offset); offset+=b.length; }
        if(offset!==bytes.length || await evidenceHash(bytes)!==artifact.sha256) throw new EvidenceError("artifact-corrupt");
        return new Response(request.method==="HEAD"?null:bytes.buffer,{headers:{"content-type":"application/pdf","content-disposition":"attachment; filename=policy-evidence.pdf","cache-control":"no-store",etag:artifact.sha256}});
      }
      if (route[2]==="pages" && route[3]) {
        const page=await db.prepare("SELECT * FROM policy_pdf_pages WHERE artifact_id=? AND page_number=?").bind(artifact.id,Number(route[3])).first<PageRow & {render_png:ArrayBuffer|number[]}>();
        if(!page) return json({error:"page-not-found"},404);
        if(route[4]) { const png=bytesFromDb(page.render_png); if(await evidenceHash(png)!==page.render_sha256) throw new EvidenceError("render-corrupt"); return new Response(png.buffer,{headers:{"content-type":"image/png","cache-control":"no-store"}}); }
        return json({pageNumber:page.page_number,lines:JSON.parse(page.lines_json),textSha256:page.text_sha256,renderSha256:page.render_sha256});
      }
      if(!route[2]) return json({artifact,pages:await readPages(db,artifact.id)});
    }
    if(request.method==="POST") {
      if(route[2]==="pages"&&route[3]&&!route[4]) return json(await storePage(db,artifact,await bodyJson(request),Number(route[3])));
      if(route[2]==="complete") return json(await complete(db,artifact,await bodyJson(request,10_000)));
      if(route[2]==="failure") {
        const data=z.object({artifactSha256:Digest,error:z.enum(["extraction-failed","image-only","version-mismatch","render-failed","capacity-limit"])}).strict().parse(await bodyJson(request,1000));
        if(data.artifactSha256!==artifact.sha256) throw new EvidenceError("failure-binding-conflict");
        await db.prepare("UPDATE policy_pdf_artifacts SET state='failed',extraction_error=? WHERE id=? AND state<>'complete'").bind(data.error,artifact.id).run();
        return json({state:artifact.state==="complete"?"complete":"failed"});
      }
    }
    return json({error:"method_not_allowed"},405);
  } catch(error) {
    if(error instanceof EvidenceError) return json({error:error.message},error.status);
    if(error instanceof z.ZodError || error instanceof SyntaxError) return json({error:"invalid-evidence-contract"},400);
    return json({error:"policy-evidence-operation-failed"},503);
  }
}
