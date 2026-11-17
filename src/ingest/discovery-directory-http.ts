import {z} from 'zod';
import {DirectoryIdSchema, DirectorySnapshotSchema, type DirectoryWork} from '../content/discovery-directory';
import {parseDirectoryQuery, readDirectoryDetail, readDirectoryList} from './discovery-directory';
import type {DirectorySearchResult} from './discovery-directory-search';

export type DirectoryEnvironment = {DISCOVERY_DIRECTORY_ENABLED?: unknown};
export const DIRECTORY_RESPONSE_BYTE_LIMIT = 128000;
const common = {'cache-control':'no-store','cdn-cache-control':'no-store','x-robots-tag':'noindex'};
const Removals = z.object({schemaVersion:z.literal('discovery-directory-removals-v1'),snapshotVersion:DirectoryIdSchema,removedIds:z.array(DirectoryIdSchema).max(10000)}).strict();
export function validatedDirectoryRelease(snapshotInput: unknown, removalInput: unknown) {
  const snapshot = DirectorySnapshotSchema.parse(snapshotInput), removals = Removals.parse(removalInput);
  if (snapshot.version !== removals.snapshotVersion || new Set(removals.removedIds).size !== removals.removedIds.length || snapshot.works.some(w=>removals.removedIds.includes(w.id))) throw Error('directory-release-mismatch');
  return {snapshot, removals};
}
export function directoryPathId(segment: string): string {
  const id = decodeURIComponent(segment);
  if (encodeURIComponent(id)!==segment || !DirectoryIdSchema.safeParse(id).success) throw Error('directory-id');
  return id;
}

function workReference(work: DirectoryWork) {
  return {
    id: work.id,
    title: work.title.value,
    kind: work.kind,
    detailHref: `/api/discovery/v1/works/${encodeURIComponent(work.id)}`,
  };
}

function compactWork(work: DirectoryWork) {
  // Snapshot validation guarantees both claims. Keep the qualifiers attached to
  // the displayed regional claim and leave the other claims in the detail.
  const purpose = work.claims.find(claim => claim.kind === 'health-purpose')!;
  const region = work.claims.find(claim => claim.kind === 'regional-connection')!;
  return {
    ...workReference(work),
    originalUrl: work.url.value,
    checkedAt: work.checkedAt,
    sourceDate: work.sourceDate?.value ?? null,
    purpose: {claimId: purpose.id, text: purpose.text},
    regionalConnection: {
      claimId: region.id,
      institution: region.institution,
      campus: region.campus,
      municipality: region.municipality,
      county: region.county,
      state: region.state,
      regionalBasis: region.regionalBasis,
      asOf: region.asOf,
      subjectRole: region.subjectRole,
      subjectLabel: region.subjectLabel,
      scope: region.scope,
      qualification: region.qualification,
    },
  };
}

function compactList(result: DirectorySearchResult) {
  return {
    schemaVersion: 'discovery-directory-list-compact-v1',
    snapshotVersion: result.snapshotVersion,
    snapshotSha256: result.snapshotSha256,
    totalWorks: result.totalWorks,
    matchingWorks: result.matchingWorks,
    items: result.items.map(compactWork),
    nextAfter: result.nextAfter,
    query: result.query,
    aliasRevision: result.aliasRevision,
    matches: result.matches,
    supportItems: result.supportItems.map(workReference),
    supportCount: result.supportCount,
    facets: result.facets,
  };
}

export async function handleDiscoveryDirectory(request: Request, env: DirectoryEnvironment, snapshotInput: unknown, removalInput: unknown): Promise<Response> {
  const head=request.method==='HEAD';
  const reply=(status:number,body:unknown,extra:Record<string,string>={})=>{
    const encoded=JSON.stringify(body);
    if(new TextEncoder().encode(encoded).byteLength>DIRECTORY_RESPONSE_BYTE_LIMIT) return new Response(head?null:JSON.stringify({error:{code:'directory-unavailable'}}),{status:503,headers:{...common,'content-type':'application/json; charset=utf-8'}});
    return new Response(head?null:encoded,{status,headers:{...common,'content-type':'application/json; charset=utf-8',...extra}});
  };
  if(env.DISCOVERY_DIRECTORY_ENABLED!=='true')return reply(404,{error:{code:'not-found'}});
  if(request.method!=='GET'&&!head)return reply(405,{error:{code:'method-not-allowed'}},{allow:'GET, HEAD'});
  const url=new URL(request.url);
  let release:ReturnType<typeof validatedDirectoryRelease>;
  try{release=validatedDirectoryRelease(snapshotInput,removalInput);}catch{return reply(503,{error:{code:'directory-unavailable'}});}
  if(/^\/api\/discovery\/v1\/works\/?$/.test(url.pathname)){
    const views = url.searchParams.getAll('view');
    if (views.length > 1 || (views.length === 1 && views[0] !== 'compact')) return reply(400,{error:{code:'invalid-query'}});
    const compact = views.length === 1;
    if (compact) url.searchParams.delete('view');
    let query;
    try{query=parseDirectoryQuery(url.searchParams);}catch{return reply(400,{error:{code:'invalid-query'}});}
    try{
      const result = await readDirectoryList(release.snapshot,query);
      return reply(200,compact ? compactList(result) : result);
    }
    catch(error){return error instanceof Error && error.message.startsWith('directory-cursor-')?reply(409,{error:{code:'restart-query'}}):reply(503,{error:{code:'directory-unavailable'}});}
  }
  const match=/^\/api\/discovery\/v1\/works\/([^/]+)$/.exec(url.pathname);
  if(!match)return reply(404,{error:{code:'not-found'}});
  let id;
  try{if(url.search)throw Error('query');id=directoryPathId(match[1]);}catch{return reply(400,{error:{code:'invalid-query'}});}
  if(release.removals.removedIds.includes(id))return reply(410,{error:{code:'work-removed'},snapshotVersion:release.snapshot.version,id});
  const work=readDirectoryDetail(release.snapshot,id);
  return work?reply(200,{schemaVersion:'discovery-directory-detail-v1',snapshotVersion:release.snapshot.version,work}):reply(404,{error:{code:'not-found'}});
}
