import {DirectorySnapshotSchema, type DirectoryWork} from '../content/discovery-directory';
import {directoryPathId, validatedDirectoryRelease, DIRECTORY_RESPONSE_BYTE_LIMIT, type DirectoryEnvironment} from './discovery-directory-http';
import {parseDirectoryQuery, readDirectoryDetail, readDirectoryList} from './discovery-directory';
import type {DirectorySearchResult, DirectoryQuery} from './discovery-directory-search';

const esc=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const link=(href:string,label:string)=>`<a href="${esc(href)}" rel="noreferrer noopener">${esc(label)}</a>`;
const detail=(id:string)=>`/discover/work/${encodeURIComponent(id)}`;
const methods={'provider-metadata':'Retained provider metadata','primary-web-rendering':'Primary source observation','primary-indexed-rendering':'Indexed primary source observation','reviewed-observation':'Reviewed factual observation'} as const;
function workHtml(work:DirectoryWork, snapshot:ReturnType<typeof DirectorySnapshotSchema.parse>, full:boolean):string{
  const health=work.claims.filter(c=>c.kind==='health-purpose'), regions=work.claims.filter(c=>c.kind==='regional-connection');
  return `<article data-work-id="${esc(work.id)}"><h2>${full?esc(work.title.value):link(detail(work.id),work.title.value)}</h2><p>${esc(work.kind)} · ${link(work.url.value,'Open original source')}</p>${health.map(c=>`<p>${esc(c.text)}</p>`).join('')}${regions.map(c=>`<p data-claim-kind="regional-connection">${esc(c.subjectRole==='author-affiliation'?'Publication author '+c.subjectLabel+' — affiliation':'Project connection')}: ${esc([c.institution,c.campus,c.municipality,c.county?c.county+' County':null,c.state].filter(Boolean).join(' · '))} (${esc(c.asOf.value)}). ${esc(c.qualification)}</p>`).join('')}${work.owner?`<p>Source account: ${esc(work.owner.name)} (${esc(work.owner.kind)}).</p>`:''}${work.sourceDate?`<p>Source date: <time>${esc(work.sourceDate.value.value)}</time> (${esc(work.sourceDate.value.precision)}).</p>`:''}<p>Checked <time>${esc(work.checkedAt)}</time>.</p>${work.relations.map(r=>{const target=snapshot.works.find(w=>w.id===r.toId)!;return `<p data-relation="${esc(r.predicate)}">${esc(r.predicate==='repository-cites-work'?'Repository cites publication':'Publication links repository')}: ${link(detail(target.id),target.title.value)}</p>`;}).join('')}${full?`<details><summary>Sources and review</summary><ul>${work.evidence.map(e=>`<li data-evidence-id="${esc(e.id)}">${link(e.sourceUrl,'Original evidence source')} · ${esc(e.method==='reviewed-observation'&&e.pointer.startsWith('/packet/facts/')?'Reviewed metadata observation; original response not retained':methods[e.method])} · observed ${esc(e.observedDate)}<br>Retained observation ${esc(e.observationSha256)} · field ${esc(e.pointer)}</li>`).join('')}</ul></details>`:''}</article>`;
}

const topicLabels: Record<string,string> = {'machine-learning':'AI / machine learning','medical-imaging':'Medical imaging','clinical-informatics':'Clinical informatics','biomedical-data':'Biomedical data','assistive-technology':'Assistive technology','public-health':'Public health','sleep':'Sleep'};
function searchForm(query:DirectoryQuery,facets:DirectorySearchResult['facets']):string {
  const select=(name:'kind'|'topic'|'county'|'institution',label:string)=>{
    const selected=query[name]??'', values=[...facets[name]];
    if(selected&&!values.some(v=>v.value===selected))values.push({value:selected,count:0});
    return `<label for="research-${name}">${label}</label><select id="research-${name}" name="${name}"><option value="">All ${label.toLowerCase()}</option>${values.map(v=>`<option value="${esc(v.value)}"${selected===v.value?' selected':''}>${esc(name==='topic'?(topicLabels[v.value]??v.value):name==='county'?v.value+' County':v.value)} (${v.count})</option>`).join('')}</select>`;
  };
  // Empty selects are omitted by the request parser; a submitted form never carries a stale cursor.
  return `<form method="get" action="/discover/works"><label for="research-query">Search research</label><input id="research-query" name="q" value="${esc(query.q)}" aria-describedby="research-search-help"><p id="research-search-help">Try sleep AI, Camden County, Rutgers-Camden, a repository name or a DOI. Terms can match one directly linked work. County describes a supported research association.</p>${select('topic','Topics')}${select('institution','Institutions')}${select('county','Counties')}${select('kind','Kinds')}<label for="research-sort">Order</label><select id="research-sort" name="sort">${[['relevance','Best match'],['title-asc','Title'],['source-date-desc','Source date (unknown last)']].map(([value,label])=>`<option value="${value}"${query.sort===value?' selected':''}>${label}</option>`).join('')}</select><input type="hidden" name="limit" value="${query.limit}"><button type="submit">Search</button> ${link('/discover/works','Reset filters')}</form><p>Each facet counts works after the other selected filters; linked evidence may support a match. Dates and affiliations retain their source scope.</p>`;
}
function matchExplanation(work:DirectoryWork,result:DirectorySearchResult,snapshot:ReturnType<typeof DirectorySnapshotSchema.parse>):string {
  if(!result.query.q.trim()&&!result.query.kind&&!result.query.topic&&!result.query.county&&!result.query.institution)return '';
  const reason=result.matches.find(m=>m.workId===work.id);if(!reason)return '';
  const claimLabels=reason.claimIds.flatMap(id=>snapshot.works.flatMap(w=>w.claims.filter(c=>c.id===id).map(c=>c.kind==='topic'?(topicLabels[c.topic]??c.topic):c.kind==='regional-connection'?[c.institution,c.county?c.county+' County':c.municipality].filter(Boolean).join(' · '):'Research purpose')));
  const supporting=snapshot.works.find(w=>w.id===reason.sourceWorkId);
  return `<p data-match-basis="${reason.basis}">${reason.basis==='related'&&supporting?`Match uses a directly linked work: ${link(detail(supporting.id),supporting.title.value)}. `:'Match in this work. '}${esc([...new Set(claimLabels)].join('; '))}${reason.predicate?` · ${esc(reason.predicate==='repository-cites-work'?'Evidence: repository cites publication.':'Evidence: publication links repository.')}`:''}</p>`;
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
    return reply(200,'Health-tech research',`${searchForm(query,result.facets)}<p>${result.matchingWorks} matching works in this selected catalog (${result.totalWorks} works total).</p>${result.items.length?result.items.map(w=>workHtml(w,release.snapshot,false)+matchExplanation(w,result,release.snapshot)).join(''):`<p>No matching works. Try fewer terms or ${link('/discover/works','reset filters')}.</p>`}${result.supportItems.length?`<aside aria-label="Related evidence"><h2>Related evidence used</h2><p>${result.supportItems.length} related works support this page; these are separate from its search results.</p><ul>${result.supportItems.map(w=>`<li>${link(detail(w.id),w.title.value)}</li>`).join('')}</ul></aside>`:''}${result.nextAfter?`<p>${link(next.pathname+next.search,'Next page')}</p>`:''}`);
  }catch(error){return error instanceof Error&&error.message.startsWith('directory-cursor-')?reply(409,'Search changed',`<p>${link('/discover/works','Restart search')}</p>`):reply(503,'Research directory unavailable','');}
}
