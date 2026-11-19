import { z } from 'zod';
import { DIRECTORY_TOPICS, readDirectorySnapshot, type DirectoryView, type DirectoryWork } from '../content/discovery-directory';

export const DIRECTORY_SEARCH_ALIAS_REVISION = 'directory-search-aliases-v1' as const;
export const DIRECTORY_SEARCH_ALIASES = Object.freeze({
  topics: Object.freeze({ ai: 'machine-learning', ml: 'machine-learning', 'machine learning': 'machine-learning' } as const),
  institutions: Object.freeze({ 'rutgers camden': 'Rutgers University–Camden', 'rutgers university camden': 'Rutgers University–Camden', 'rutgers the state university of new jersey camden': 'Rutgers University–Camden' } as const),
  countyPhraseSuffix: 'county' as const,
});
const kinds = ['repository', 'publication', 'preprint', 'discussion', 'project'] as const;
const counties = ['Bucks', 'Chester', 'Delaware', 'Montgomery', 'Philadelphia', 'Burlington', 'Camden', 'Gloucester', 'Mercer'] as const;
const Query = z.object({
  q: z.string().max(200).refine(v=>!/[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(v)).default(''), kind: z.enum(kinds).optional(), topic: z.enum(DIRECTORY_TOPICS).optional(),
  county: z.enum(counties).optional(), institution: z.string().min(1).max(200).refine(v=>v.trim()===v && v.length>0 && !/[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(v)).optional(),
  sort: z.enum(['relevance', 'title-asc', 'source-date-desc']).default('relevance'),
  limit: z.coerce.number().int().min(1).max(50).default(25), after: z.string().min(1).max(3000).optional(),
}).strict();
export type DirectoryQuery = z.infer<typeof Query>;
type Reason = { workId: string; basis: 'own' | 'related'; sourceWorkId: string; relationId: string | null; predicate: 'repository-cites-work' | 'work-links-repository' | null; relationFromId: string | null; relationToId: string | null; claimIds: string[]; evidenceIds: string[] };
type Facet = { value: string; count: number };
export type DirectorySearchResult = { schemaVersion:'discovery-directory-list-v1'; snapshotVersion:string; snapshotSha256:string; totalWorks:number; matchingWorks:number; items:DirectoryWork[]; nextAfter:string|null; query:DirectoryQuery; aliasRevision:typeof DIRECTORY_SEARCH_ALIAS_REVISION; matches:Reason[]; supportItems:DirectoryWork[]; supportCount:number; facets:{kind:Facet[];topic:Facet[];county:Facet[];institution:Facet[]} };
export function parseDirectoryQuery(params: URLSearchParams): DirectoryQuery {
  if (params.toString().length > 8192) throw Error('directory-query-size');
  const withoutCursor = new URLSearchParams(params); withoutCursor.delete('after');
  if (withoutCursor.toString().length > 4096) throw Error('directory-query-size');
  const raw: Record<string,string> = Object.create(null), seen = new Set<string>();
  for (const [key,value] of params) {
    if (!['q','kind','topic','county','institution','sort','limit','after'].includes(key) || seen.has(key)) throw Error('directory-query-key');
    seen.add(key);
    if (value === '' && ['kind','topic','county','institution'].includes(key)) continue;
    raw[key]=value;
  }
  if (raw.limit !== undefined && !/^(?:[1-9]|[1-4][0-9]|50)$/.test(raw.limit)) throw Error('directory-query-limit');
  return Query.parse(raw);
}
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0;
const fold=(s:string)=>s.normalize('NFKC').toLowerCase();
const words=(s:string):string[]=>fold(s).match(/[\p{L}\p{N}]+/gu) ?? [];
const normalized=(s:string)=>words(s).join(' ');
const canonical=(v:unknown):string=>Array.isArray(v)?`[${v.map(canonical).join(',')}]`:v!==null&&typeof v==='object'?`{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical((v as Record<string,unknown>)[k])}`).join(',')}}`:JSON.stringify(v);
async function sha(v:unknown){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(v)));return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');}
function institutionKey(s:string) { const n=normalized(s); return /^(?:rutgers university camden|rutgers camden|rutgers the state university of new jersey camden)$/.test(n)?'rutgers camden':n; }
function canonicalInstitution(s:string) { return institutionKey(s)==='rutgers camden' ? 'Rutgers University–Camden' : s; }
type Term={type:'word'|'topic'|'county'|'institution';value:string};
function terms(q:string):Term[] {
  let input=normalized(q); const out:Term[]=[];
  const consume=(re:RegExp,term:Term)=>{input=input.replace(re,()=>{out.push(term);return ' ';});};
  consume(/\brutgers the state university of new jersey camden\b/g,{type:'institution',value:'rutgers camden'});
  consume(/\brutgers (?:university )?camden\b/g,{type:'institution',value:'rutgers camden'});
  for(const county of counties) consume(new RegExp(`\\b${county.toLowerCase()} county\\b`,'g'),{type:'county',value:county});
  consume(/\bmachine learning\b/g,{type:'topic',value:'machine-learning'});
  for(const token of input.split(/\s+/).filter(Boolean)) out.push(token==='ai'||token==='ml'?{type:'topic',value:'machine-learning'}:{type:'word',value:token});
  return out;
}
type Unit={type:'field'|'claim';text:string;claimId?:string;evidenceIds:string[];topic?:string;county?:string;institution?:string};
function units(w:DirectoryWork):Unit[] {
  const u:Unit[]=[{type:'field',text:w.id,evidenceIds:[]},{type:'field',text:w.title.value,evidenceIds:[w.title.evidenceId]},{type:'field',text:w.url.value,evidenceIds:[w.url.evidenceId]}];
  if(w.nativeIdentity)u.push({type:'field',text:w.nativeIdentity.nativeId,evidenceIds:[w.nativeIdentity.evidenceId]});
  if(w.description)u.push({type:'field',text:w.description.value,evidenceIds:[w.description.evidenceId]});
  if(w.owner)u.push({type:'field',text:w.owner.name,evidenceIds:[w.owner.evidenceId]});
  for(const c of w.claims) {
    if(c.kind==='health-purpose')u.push({type:'claim',text:c.text,claimId:c.id,evidenceIds:c.evidenceIds});
    else if(c.kind==='topic')u.push({type:'claim',text:c.topic,topic:c.topic,claimId:c.id,evidenceIds:c.evidenceIds});
    else {
      const place = c.regionalBasis === 'region' ? [c.qualification] : [c.campus,c.municipality,c.county,c.state];
      u.push({type:'claim',text:[c.institution,...place,c.subjectLabel].filter(Boolean).join(' '),claimId:c.id,evidenceIds:c.evidenceIds,county:c.county??undefined,institution:c.institution??undefined});
    }
  }
  return u;
}
function hits(term:Term,u:Unit):boolean {
  if(term.type==='topic')return u.topic===term.value;
  if(term.type==='county')return u.county===term.value;
  if(term.type==='institution')return !!u.institution && institutionKey(u.institution)===term.value;
  return words(u.text).includes(term.value);
}
type Relation=DirectoryWork['relations'][number];
type Plan={work:DirectoryWork; neighbor:DirectoryWork|null;relation:Relation|null; matched:Unit[];exact:boolean};
function matchPlan(work:DirectoryWork,neighbor:DirectoryWork|null,relation:Relation|null,q:DirectoryQuery,excluded?:'kind'|'topic'|'county'|'institution',includeUnusedNeighbor=false):Plan|null {
  if(excluded!=='kind'&&q.kind&&work.kind!==q.kind)return null;
  const own=units(work), other=neighbor?units(neighbor):[], all=[...own,...other], matched:Unit[]=[];
  const take=(f:(u:Unit)=>boolean)=>{const found=all.find(f);if(!found)return false;matched.push(found);return true;};
  const parsedTerms=terms(q.q);
  const exact=q.q.trim()!=='' && !(parsedTerms.length===1 && parsedTerms[0].type==='topic') && [work.id,work.nativeIdentity?.nativeId??'',work.url.value].some(v=>fold(v)===fold(q.q.trim()));
  if(q.q.trim() && !parsedTerms.length && !exact)return null;
  if(exact){const exactUnit=own.find(u=>fold(u.text)===fold(q.q.trim()));if(exactUnit)matched.push(exactUnit);}
  else for(const t of parsedTerms) if(!take(u=>hits(t,u)))return null;
  if(excluded!=='topic'&&q.topic&&!take(u=>u.topic===q.topic))return null;
  if(excluded!=='county'&&q.county&&!take(u=>u.county===q.county))return null;
  if(excluded!=='institution'&&q.institution&&!take(u=>!!u.institution&&institutionKey(u.institution)===institutionKey(q.institution!)))return null;
  if(neighbor && !includeUnusedNeighbor && !matched.some(u=>other.includes(u)))return null;
  return {work,neighbor,relation,matched,exact};
}
export async function readDirectoryList(input:unknown,queryInput:unknown,view: DirectoryView = 'release'):Promise<DirectorySearchResult> {
  const snapshot=readDirectorySnapshot(input,view), q=Query.parse(queryInput), digest=await sha(snapshot);
  const byId=new Map(snapshot.works.map(w=>[w.id,w]));
  const neighbors=new Map<string,{work:DirectoryWork;relation:Relation}[]>();
  for(const w of snapshot.works)for(const r of w.relations){const other=byId.get(r.toId)!; for(const [a,b] of [[w,other],[other,w]] as const)neighbors.set(a.id,[...(neighbors.get(a.id)??[]),{work:b,relation:r}]);}
  for(const list of neighbors.values())list.sort((a,b)=>cmp(a.work.id,b.work.id)||cmp(a.relation.id,b.relation.id));
  const plans=(w:DirectoryWork,excluded?:'kind'|'topic'|'county'|'institution')=>{const own=matchPlan(w,null,null,q,excluded); if(own&&!excluded)return [own]; const related=(neighbors.get(w.id)??[]).map(n=>matchPlan(w,n.work,n.relation,q,excluded,!!excluded)).filter((x):x is Plan=>x!==null); return own?[own,...related]:related;};
  const all=snapshot.works.map(w=>plans(w)[0]).filter((p):p is Plan=>!!p);
  all.sort((a,b)=>{
    if(q.sort==='title-asc')return cmp(fold(a.work.title.value),fold(b.work.title.value))||cmp(a.work.id,b.work.id);
    if(q.sort==='relevance'&&q.q.trim()){const rank=(p:Plan)=>p.exact?0:p.neighbor?2:1;const d=rank(a)-rank(b);if(d)return d;}
    if(q.sort==='source-date-desc'||q.sort==='relevance'&&q.q.trim()){const ad=a.work.sourceDate?.value.value,bd=b.work.sourceDate?.value.value;if(ad!==bd){if(!ad)return 1;if(!bd)return -1;const d=cmp(bd,ad);if(d)return d;}}
    return cmp(a.work.id,b.work.id);
  });
  const queryKey={q:fold(q.q.trim()).replace(/\s+/g,' '),terms:terms(q.q),kind:q.kind??null,topic:q.topic??null,county:q.county??null,institution:q.institution?institutionKey(q.institution):null,sort:q.sort,limit:q.limit};
  const queryDigest=await sha(queryKey);
  let start=0;if(q.after){let decoded:unknown;try{decoded=JSON.parse(decodeURIComponent(q.after));}catch{throw Error('directory-cursor-invalid');}const parsed=z.tuple([z.string(),z.string(),z.string(),z.string()]).safeParse(decoded);if(!parsed.success||parsed.data[0]!==digest||parsed.data[1]!==DIRECTORY_SEARCH_ALIAS_REVISION||parsed.data[2]!==queryDigest)throw Error('directory-cursor-restart');start=all.findIndex(p=>p.work.id===parsed.data[3])+1;if(!start)throw Error('directory-cursor-restart');}
  const page=all.slice(start,start+q.limit), supports=new Map<string,DirectoryWork>();
  const matches:Reason[]=page.map(p=>{if(p.neighbor)supports.set(p.neighbor.id,p.neighbor);return {workId:p.work.id,basis:p.neighbor?'related':'own',sourceWorkId:p.neighbor?.id??p.work.id,relationId:p.relation?.id??null,predicate:p.relation?.predicate??null,relationFromId:p.relation?.fromId??null,relationToId:p.relation?.toId??null,claimIds:[...new Set(p.matched.flatMap(u=>u.claimId?[u.claimId]:[]))],evidenceIds:[...new Set([...p.matched.flatMap(u=>u.evidenceIds),...(p.relation?.evidenceIds??[])])]};});
  const selectedIds=new Set(page.map(p=>p.work.id));for(const id of selectedIds)supports.delete(id);
  const facet=(dimension:'kind'|'topic'|'county'|'institution'):Facet[]=>{const counts=new Map<string,number>();for(const work of snapshot.works){const possible=plans(work,dimension);if(!possible.length)continue;const values=new Set<string>();for(const p of possible){if(dimension==='kind')values.add(work.kind);else for(const u of [...units(work),...(p.neighbor?units(p.neighbor):[])]){const v=dimension==='topic'?u.topic:dimension==='county'?u.county:u.institution;if(v)values.add(dimension==='institution'?canonicalInstitution(v):v);}}for(const v of values)counts.set(v,(counts.get(v)??0)+1);}return [...counts].sort(([a],[b])=>cmp(a,b)).map(([value,count])=>({value,count}));};
  const supportItems=[...supports.values()].sort((a,b)=>cmp(a.id,b.id));
  return {schemaVersion:'discovery-directory-list-v1',snapshotVersion:snapshot.version,snapshotSha256:digest,totalWorks:snapshot.works.length,matchingWorks:all.length,items:page.map(p=>p.work),nextAfter:start+page.length<all.length?encodeURIComponent(JSON.stringify([digest,DIRECTORY_SEARCH_ALIAS_REVISION,queryDigest,page.at(-1)!.work.id])):null,query:q,aliasRevision:DIRECTORY_SEARCH_ALIAS_REVISION,matches,supportItems,supportCount:supportItems.length,facets:{kind:facet('kind'),topic:facet('topic'),county:facet('county'),institution:facet('institution')}};
}
