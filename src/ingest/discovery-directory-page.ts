import {DirectorySnapshotSchema, type DirectoryWork} from '../content/discovery-directory';
import {directoryPathId, validatedDirectoryRelease, DIRECTORY_RESPONSE_BYTE_LIMIT, type DirectoryEnvironment} from './discovery-directory-http';
import {parseDirectoryQuery, readDirectoryDetail, readDirectoryList} from './discovery-directory';

const esc=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const link=(href:string,label:string)=>`<a href="${esc(href)}" rel="noreferrer noopener">${esc(label)}</a>`;
const detail=(id:string)=>`/discover/work/${encodeURIComponent(id)}`;
const methods={'provider-metadata':'Retained provider metadata','primary-web-rendering':'Primary source observation','primary-indexed-rendering':'Indexed primary source observation','reviewed-observation':'Reviewed factual observation'} as const;
function workHtml(work:DirectoryWork, snapshot:ReturnType<typeof DirectorySnapshotSchema.parse>, full:boolean):string{
  const health=work.claims.filter(c=>c.kind==='health-purpose'), regions=work.claims.filter(c=>c.kind==='regional-connection');
  return `<article data-work-id="${esc(work.id)}"><h2>${full?esc(work.title.value):link(detail(work.id),work.title.value)}</h2><p>${esc(work.kind)} · ${link(work.url.value,'Open original source')}</p>${health.map(c=>`<p>${esc(c.text)}</p>`).join('')}${regions.map(c=>`<p data-claim-kind="regional-connection">${esc(c.subjectRole==='author-affiliation'?'Publication author '+c.subjectLabel+' — affiliation':'Project connection')}: ${esc([c.institution,c.campus,c.municipality,c.county?c.county+' County':null,c.state].filter(Boolean).join(' · '))} (${esc(c.asOf.value)}). ${esc(c.qualification)}</p>`).join('')}${work.owner?`<p>Source account: ${esc(work.owner.name)} (${esc(work.owner.kind)}).</p>`:''}${work.sourceDate?`<p>Source date: <time>${esc(work.sourceDate.value.value)}</time> (${esc(work.sourceDate.value.precision)}).</p>`:''}<p>Checked <time>${esc(work.checkedAt)}</time>.</p>${work.relations.map(r=>{const target=snapshot.works.find(w=>w.id===r.toId)!;return `<p data-relation="${esc(r.predicate)}">${esc(r.predicate==='repository-cites-work'?'Repository cites publication':'Publication links repository')}: ${link(detail(target.id),target.title.value)}</p>`;}).join('')}${full?`<details><summary>Sources and review</summary><ul>${work.evidence.map(e=>`<li data-evidence-id="${esc(e.id)}">${link(e.sourceUrl,'Original evidence source')} · ${esc(e.method==='reviewed-observation'&&e.pointer.startsWith('/packet/facts/')?'Reviewed metadata observation; original response not retained':methods[e.method])} · observed ${esc(e.observedDate)}<br>Retained observation ${esc(e.observationSha256)} · field ${esc(e.pointer)}</li>`).join('')}</ul></details>`:''}</article>`;
}
export async function handleDiscoveryDirectoryPage(request:Request,env:DirectoryEnvironment,snapshotInput:unknown,removalInput:unknown):Promise<Response>{
  const head=request.method==='HEAD';
  const reply=(status:number,title:string,body:string,extra:Record<string,string>={})=>{
    const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · The Valley Desk</title></head><body><header><a href="/">The Valley Desk</a></header><main><h1>${esc(title)}</h1>${body}</main></body></html>`;
    if(new TextEncoder().encode(html).byteLength>DIRECTORY_RESPONSE_BYTE_LIMIT)return new Response(head?null:'Research directory unavailable',{status:503,headers:{'content-type':'text/plain; charset=utf-8','cache-control':'no-store','cdn-cache-control':'no-store','x-robots-tag':'noindex'}});
    return new Response(head?null:html,{status,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','cdn-cache-control':'no-store','x-robots-tag':'noindex',...extra}});
  };
  if(env.DISCOVERY_DIRECTORY_ENABLED!=='true')return reply(404,'Not found','');
  if(request.method!=='GET'&&!head)return reply(405,'Method not allowed','',{allow:'GET, HEAD'});
  let release:ReturnType<typeof validatedDirectoryRelease>;
  try{release=validatedDirectoryRelease(snapshotInput,removalInput);}catch{return reply(503,'Research directory unavailable','');}
  const url=new URL(request.url),match=/^\/discover\/work\/([^/]+)$/.exec(url.pathname);
  if(match){
    let id;
    try{if(url.search)throw Error('query');id=directoryPathId(match[1]);}catch{return reply(400,'Unsupported request','');}
    if(release.removals.removedIds.includes(id))return reply(410,'Listing removed',`<p>${link('/discover/works','Browse research')}</p>`);
    const work=readDirectoryDetail(release.snapshot,id);
    return work?reply(200,work.title.value,`${workHtml(work,release.snapshot,true)}<p>${link('/discover/works','Browse research')}</p>`):reply(404,'Not found','');
  }
  if(!/^\/discover\/works\/?$/.test(url.pathname))return reply(404,'Not found','');
  let query;
  try{query=parseDirectoryQuery(url.searchParams);}catch{return reply(400,'Unsupported filters',`<p>${link('/discover/works','Reset filters')}</p>`);}
  try{
    const result=await readDirectoryList(release.snapshot,query);
    const next=new URL(url);if(result.nextAfter)next.searchParams.set('after',result.nextAfter);
    return reply(200,'Health-tech research',`<form method="get" action="/discover/works"><label for="research-query">Search research</label><input id="research-query" name="q" value="${esc(query.q)}"><button type="submit">Search</button></form><p>${result.matchingWorks} matching works in this selected catalog (${result.totalWorks} works total).</p>${result.items.length?result.items.map(w=>workHtml(w,release.snapshot,false)).join(''):'<p>No matching works.</p>'}${result.nextAfter?`<p>${link(next.pathname+next.search,'Next page')}</p>`:''}`);
  }catch(error){return error instanceof Error&&error.message.startsWith('directory-cursor-')?reply(409,'Search changed',`<p>${link('/discover/works','Restart search')}</p>`):reply(503,'Research directory unavailable','');}
}
