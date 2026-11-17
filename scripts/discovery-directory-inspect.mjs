import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {decodeDiscoveryMetadataJson} from '../src/ingest/discovery/metadata-preflight.ts';
import {makeDiscoveryDate} from '../src/content/discovery-schema.ts';
import {DirectoryFactPacketSchema,canonical} from '../src/ingest/discovery/directory-acquisition.ts';
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=code=>{throw new Error(code)};
const obj=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,allowed)=>{if(!obj(v)||Object.keys(v).some(k=>!allowed.includes(k)))fail('field-census');};
const str=v=>{if(typeof v!=='string'||!v.trim()||v.length>1000||/[\u0000-\u001f\u007f]/.test(v))fail('text');return v;};
const integer=v=>{if(!Number.isSafeInteger(v)||v<0)fail('integer');return v;};
const url=v=>{str(v);let u;try{u=new URL(v)}catch{fail('url')};if(u.protocol!=='https:'||u.username||u.password||u.hash||u.port||/[\s\\]/.test(v))fail('url');return u;};
function continuation(header,request,count,incomplete,total){
 if(header!==null&&typeof header!=='string'||header?.length>8192)fail('link');
 let next=null;const rels=new Set();
 if(header){for(const part of header.split(/,\s*(?=<)/)){
  const match=/^\s*<([^<>]+)>\s*;\s*rel="(next|prev|first|last)"\s*$/.exec(part);if(!match||rels.has(match[2]))fail('link');rels.add(match[2]);
  const u=url(match[1]),base=new URL(request.url);if(u.origin!==base.origin||u.pathname!==base.pathname)fail('link');
  const seen=new Set();for(const[k,v]of u.searchParams){if(seen.has(k)||k!=='page'&&base.searchParams.get(k)!==v)fail('link');seen.add(k);}
  if(seen.size!==new Set(base.searchParams.keys()).size||![...base.searchParams.keys()].every(k=>seen.has(k)))fail('link');
  const page=u.searchParams.get('page');if(!page||!/^\d+$/.test(page)||Number(page)<1||!Number.isSafeInteger(Number(page)))fail('link');
  if(match[2]==='next'){if(Number(page)!==request.page+1)fail('link');next=u.href;}
 }}
 if(incomplete)return {state:'unknown',nextUrl:null};
 if(next)return {state:'more',nextUrl:next};
 if(request.kind==='fixed_repo')return {state:'none',nextUrl:null};
 if(request.provider==='crossref'){if(total!==null&&total<=count)return {state:'none',nextUrl:null};const u=new URL(request.url);u.searchParams.set('offset',String(count));return {state:'more',nextUrl:u.href};}
 return {state:count<Number(request.parameters.per_page)?'none':'unknown',nextUrl:null};
}
function published(v){
 if(v===undefined)return [];
 keys(v,['date-parts']);const a=v['date-parts'];if(!Array.isArray(a)||a.length!==1||!Array.isArray(a[0])||a[0].length<1||a[0].length>3||a[0].some(x=>!Number.isSafeInteger(x)))fail('date');
 const value=a[0].map((x,i)=>String(x).padStart(i===0?4:2,'0')).join('-');
 try{return [{field:'published',date:makeDiscoveryDate(['year','month','day'][a[0].length-1],value)}]}catch{fail('date')}
}
export function inspect(bytes,definition,page,permit,manifestSha,header,observedDate,parserSha,census){
 if(bytes.byteLength>48000)fail('byte-cap');
 const mode=definition.kind==='fixed_repo'?'repository':definition.kind==='topic_search'?'search-repositories':'inventory';
 const body=decodeDiscoveryMetadataJson(bytes,definition.provider,()=>fail('whole-payload-preflight'),definition.provider==='github'?mode:undefined);
 let rows,total=null,incomplete=false,prefix;
 if(definition.provider==='github'){
  if(definition.kind==='fixed_repo'){rows=[body];prefix='';}
  else if(definition.kind==='topic_search'){
   keys(body,census.search_root_keys);integer(body.total_count);if(typeof body.incomplete_results!=='boolean'||!Array.isArray(body.items))fail('search-shape');rows=body.items;total=body.total_count;incomplete=body.incomplete_results;prefix='/items';
  }else{if(!Array.isArray(body))fail('array');rows=body;prefix='';}
 }else{
  keys(body,['status','message-type','message-version','message']);if(body.status!=='ok'||body['message-type']!=='work-list'||typeof body['message-version']!=='string')fail('crossref-envelope');
  keys(body.message,['facets','total-results','items','items-per-page','query','next-cursor']);
  keys(body.message.facets,[]);integer(body.message['total-results']);integer(body.message['items-per-page']);keys(body.message.query,['start-index','search-terms']);integer(body.message.query['start-index']);str(body.message.query['search-terms']);
  if(!Array.isArray(body.message.items))fail('array');rows=body.message.items;total=body.message['total-results'];prefix='/message/items';incomplete=Object.hasOwn(body.message,'next-cursor');
  if(incomplete)str(body.message['next-cursor']);
 }
 if(rows.length>definition.maximum_items||total!==null&&total<rows.length)fail('cardinality');
 if(definition.provider==='crossref'&&(body.message.query['search-terms']!==definition.parameters.query||body.message.query['start-index']!==0||body.message['items-per-page']!==Number(definition.parameters.rows)))fail('crossref-envelope');
 const nativeBodySha256=sha(bytes),receiptId='GL03:receipt:'+definition.id;
 const facts=rows.map((row,index)=>{
  let nativeId,title,link,ownerType=null,archived=null,fork=null,dates=[],pointers;
  const point=definition.kind==='fixed_repo'?'':prefix+'/'+index;
  if(definition.provider==='github'){
   keys(row,[...census.repository_keys,...(definition.kind==='topic_search'?census.search_additional_item_keys:[])]);
   keys(row.owner,census.nested_keys.owner);if(row.license!==null&&row.license!==undefined)keys(row.license,census.nested_keys.license);
   const booleans=['allow_forking','archived','disabled','fork','has_discussions','has_downloads','has_issues','has_pages','has_projects','has_pull_requests','has_wiki','is_template','private','web_commit_signoff_required'];
   const numbers=['id','forks','forks_count','network_count','open_issues','open_issues_count','size','stargazers_count','subscribers_count','watchers','watchers_count'];
   for(const [key,value] of Object.entries(row)){
    if(key==='owner'||key==='license'||key==='text_matches'||key==='score')continue;
    if(key==='topics'){if(!Array.isArray(value)||value.length>100||value.some(v=>typeof v!=='string'))fail('repository-shape');}
    else if(booleans.includes(key)){if(typeof value!=='boolean')fail('repository-shape');}
    else if(numbers.includes(key)){integer(value);}
    else if(value!==null&&typeof value!=='string')fail('repository-shape');
   }
   for(const [key,value] of Object.entries(row.owner)){
    if(key==='id')integer(value);
    else if(key==='site_admin'){if(typeof value!=='boolean')fail('repository-shape');}
    else if(value!==null&&typeof value!=='string')fail('repository-shape');
   }
   if(row.license)for(const value of Object.values(row.license))if(value!==null&&typeof value!=='string')fail('repository-shape');
   if(Object.hasOwn(row,'text_matches')&&(!Array.isArray(row.text_matches)||row.text_matches.length))fail('unpermitted-material');
   if(row.score!==undefined&&(!Number.isFinite(row.score)||typeof row.score!=='number'))fail('score');
   integer(row.id);integer(row.owner.id);if(row.id<1||row.owner.id<1||row.private!==false||!['User','Organization'].includes(row.owner.type))fail('identity');
   if(!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(row.owner.login)||!/^[A-Za-z0-9_.-]{1,100}$/.test(row.name)||row.full_name!==row.owner.login+'/'+row.name)fail('identity');
   if(definition.expected_owner_id!==null&&(String(row.owner.id)!==definition.expected_owner_id||row.owner.type!==definition.expected_owner_type))fail('owner-identity');
   const req=new URL(definition.url);if(definition.kind==='fixed_repo'&&req.pathname!=='/repos/'+row.full_name)fail('repository-identity');
   if((definition.kind==='account_user'||definition.kind==='account_org')&&row.owner.login.toLowerCase()!==req.pathname.split('/')[2].toLowerCase())fail('owner-identity');
   if(row.html_url!=='https://github.com/'+row.full_name||url(row.html_url).hostname!=='github.com'||typeof row.archived!=='boolean'||typeof row.fork!=='boolean'||typeof row.disabled!=='boolean')fail('repository-shape');
   nativeId=String(row.id);title=str(row.full_name);link=row.html_url;ownerType=row.owner.type;archived=row.archived;fork=row.fork;
   for(const field of ['created_at','updated_at','pushed_at'])if(row[field]!==null&&row[field]!==undefined){try{dates.push({field,date:makeDiscoveryDate('instant',str(row[field]))})}catch{fail('date')}}
   pointers={nativeId:point+'/id',title:point+'/full_name',url:point+'/html_url',ownerType:point+'/owner/type',archived:point+'/archived',fork:point+'/fork',sourceVersion:null,sourceDates:dates.map(d=>({field:d.field,pointer:point+'/'+d.field}))};
  }else{
   keys(row,['DOI','title','type','published','URL']);nativeId=str(row.DOI);if(!/^10\.\d{4,9}\/\S+$/.test(nativeId)||!Array.isArray(row.title)||!row.title.length||row.title.length>5||row.title.some(t=>typeof t!=='string'))fail('publication-identity');
   title=str(row.title[0]);if(definition.parameters.filter==='type:journal-article'&&row.type!=='journal-article')fail('publication-identity');if(!['journal-article','proceedings-article','book-chapter','dissertation','report'].includes(row.type))fail('publication-identity');link=str(row.URL);if(url(link).hostname!=='doi.org'||decodeURIComponent(new URL(link).pathname.slice(1)).toLowerCase()!==nativeId.toLowerCase())fail('publication-identity');dates=published(row.published);
   pointers={nativeId:point+'/DOI',title:point+'/title/0',url:point+'/URL',ownerType:null,archived:null,fork:null,sourceVersion:null,sourceDates:dates.map(d=>({field:d.field,pointer:point+'/published/date-parts/0'}))};
  }
  const frontier={schemaVersion:'discovery-directory-private-frontier-v1',id:'GL03:lead:'+sha(definition.provider+'\n'+nativeId.toLowerCase()),revision:1,source:{kind:'collection-lead',provider:definition.provider,sourceId:page.sourceId,scopeId:page.scopeId,pageReceiptId:receiptId,requestSha256:permit.requestSha256,representationSha256:nativeBodySha256,leadIndex:index,lead:{nativeId,kind:'artifact',displayName:title,artifactKind:definition.provider==='github'?'repository':'publication',sourceStage:definition.provider==='github'?'baseline':'publication',sourceDates:dates,relatedAccounts:[],unresolvedPeople:[],publicationAuthorized:false}},disposition:'pending',duplicateOf:null,reason:null,publicationAuthorized:false};
  return {nativeId,kind:definition.provider==='github'?'repository':'publication',title,url:link,pointers,ownerType,archived,fork,frontier};
 });
 const ids=facts.map(f=>f.nativeId.toLowerCase());if(new Set(ids).size!==ids.length)fail('duplicate-native-identity');
 // This separately qualified one-page policy never interprets or follows Link.
 const next=definition.continuation_policy==='opaque_unknown'?{state:'unknown',nextUrl:null}:continuation(header,definition,rows.length,incomplete,total),state=next.state;
 const request={method:page.method,url:next.nextUrl,accept:page.accept,encoding:page.encoding,userAgent:page.userAgent,githubApiVersion:page.githubApiVersion,maxBytes:page.maxBytes,timeoutMs:page.timeoutMs,redirects:page.redirects};
 const packet=DirectoryFactPacketSchema.parse({schemaVersion:'directory-factual-page-v1',publicationAuthorized:false,receiptId,pageId:page.id,manifestSha256:manifestSha,qualificationSha256:page.qualificationSha256,requestSha256:permit.requestSha256,nativeBodySha256,parserSha256:parserSha,parserRevision:page.parserRevision,observedDate,continuation:state,nextRequestSha256:next.nextUrl?sha(canonical(request)):null,providerIncomplete:incomplete,facts,projectionSha256:sha(canonical(facts))});
 return {packet,summary:{itemCount:facts.length,providerTotal:total,providerIncomplete:incomplete,continuation:state,continuationPolicy:definition.continuation_policy??'strict_link',rawBodyRetained:false,bodyProjectionReproducible:false}};
}
if(process.argv[1]&&pathToFileURL(process.argv[1]).href===import.meta.url){
 try{
  const input=JSON.parse(readFileSync(0,'utf8'));if(typeof input.bodyBase64!=='string'||input.bodyBase64.length>64000)fail('byte-cap');
  const definition=input.requestManifest.requests.find(r=>r.id===input.requestId);if(!definition)fail('unplanned-request');
  const result=inspect(Buffer.from(input.bodyBase64,'base64'),definition,input.page,input.permit,input.manifestSha256,input.linkHeader,input.observedDate,input.parserSha256,input.requestManifest.github_preflight_key_census);
  process.stdout.write(JSON.stringify({ok:true,...result}));
 }catch(e){const allowed=['byte-cap','field-census','whole-payload-preflight','cardinality','identity','owner-identity','repository-identity','repository-shape','publication-identity','unpermitted-material','link','date','integer','array','text','url','score','search-shape','crossref-envelope','duplicate-native-identity','unplanned-request'];process.stdout.write(JSON.stringify({ok:false,code:allowed.includes(e?.message)?e.message:'projection-validation'}));process.exitCode=1;}
}
