import { makeDiscoveryDate } from '../../content/discovery-schema';
import { canonicalDiscoveryEvidenceJson as canonical } from '../discovery-evidence-store';
import { DiscoveryRuntimeError, DiscoveryRuntimeSource } from './runtime-contract';
import { constructDiscoveryEndpoint } from './endpoint';
import { DiscoverySourceRequest } from './source-contract';
import {
  DiscoveryCollectionDraft,
  DiscoveryCollectionPageReceipt,
  type DiscoveryCollectionParseInput,
  type DiscoveryCollectionLead,
} from './collection-contract';
import type { DiscoveryTrustedAdapterRepresentation } from './adapter';
import { decodeDiscoveryMetadataJson } from './metadata-preflight';

export type DiscoveryGithubResolvers = {
  resolveSource(id: string): Promise<DiscoveryRuntimeSource | null>;
  resolvePage(id: string): Promise<DiscoveryCollectionPageReceipt | null>;
  resolveRepresentation(ref: {id: string; revision: number}): Promise<DiscoveryTrustedAdapterRepresentation | null>;
  baselineReceiptForSource?(id: string): Promise<string | null>;
};
export type DiscoveryGithubMetadata = {
  nativeId: string;
  alias?: string;
  role?: 'repository-owner' | 'contributor-account' | 'commit-author-account' | 'unresolved-personal-author';
  declaredProfileLinks?: string[];
  licenseHint?: {spdxId: string; sourceVersion: string};
};
export type DiscoveryGithubGap = 'search-truncated' | 'page-cap' | 'item-cap' | 'private-repository';
const fail = (code: string): never => {
  throw new DiscoveryRuntimeError('parser-failed', `discovery-github-${code}`);
};
const record = (v: unknown): Record<string, any> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail('object');
  return v as Record<string, any>;
};
function text(v: unknown, max = 512): string {
  if (typeof v !== 'string' || !v.length || v.length > max) return fail('text');
  return v;
}
function numeric(v: unknown): string {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 1) return fail('native-id');
  return String(v);
}
async function sha(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('');
}
function body(bytes: Uint8Array, repositories?: 'repository' | 'inventory' | 'search-repositories'): any {
  if (bytes.length > 48000) return fail('body-cap');
  return decodeDiscoveryMetadataJson(bytes, 'github', fail, repositories);
}
function route(path: string) {
  if (/^\/(users|orgs)\/[A-Za-z0-9_.-]+$/.test(path)) return 'profile';
  if (/^\/(users|orgs)\/[A-Za-z0-9_.-]+\/repos$/.test(path)) return 'inventory';
  if (path === '/search/repositories') return 'search-repositories';
  if (path === '/search/users') return 'search-users';
  if (/^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(path)) return 'repository';
  const match = /^\/repos\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(releases|tags|commits|contributors)$/.exec(path);
  if (match) return match[1];
  return fail('unsupported-route');
}
function dates(row: Record<string,any>, fields: string[]) { return fields.filter(f=> row[f] !== undefined && row[f] !== null).map(field=>({field,date:makeDiscoveryDate('instant',text(row[field],100))})); }
function profileLinks(row: Record<string,any>) { return ['html_url','blog'].flatMap(field=>{ if (!row[field]) return []; try { const u=new URL(row[field]);
return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash?[u.href]:[]; } catch { return []; } }); }
function account(row: Record<string,any>, metadata: DiscoveryGithubMetadata[], role?: DiscoveryGithubMetadata['role']): DiscoveryCollectionLead {
  const id = numeric(row.id), login = text(row.login);
  if (!['User', 'Organization', 'Bot'].includes(row.type)) return fail('account-type');
  const standardLogin = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(login);
  const appBotLogin = row.type === 'Bot' && /^[A-Za-z0-9][A-Za-z0-9-]{0,99}\[bot\]$/.test(login);
  if (!standardLogin && !appBotLogin) return fail('account-alias');
  metadata.push({nativeId:id,alias:login,...(role?{role}:{}),declaredProfileLinks:profileLinks(row)});
  return {nativeId:id,kind:'account',displayName:login,sourceStage:'profile',sourceDates:dates(row,['created_at','updated_at']),relatedAccounts:[],unresolvedPeople:[],publicationAuthorized:false};
}
function repository(row: Record<string,any>, metadata: DiscoveryGithubMetadata[]): DiscoveryCollectionLead {
  const id=numeric(row.id), owner=record(row.owner), ownerId=numeric(owner.id), alias=text(row.full_name);
  if (row.private !== false) return fail('private-repository');
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(text(row.name))||alias !== `${text(owner.login)}/${text(row.name)}`) return fail('repository-alias');
  metadata.push({nativeId:id,alias}); account(owner,metadata,'repository-owner');
  if (row.license !== null && row.license !== undefined) { const license=record(row.license);
  if (license.spdx_id) metadata.push({nativeId:id,licenseHint:{spdxId:text(license.spdx_id,200),sourceVersion:'baseline'}}); }
  return {nativeId:id,kind:'artifact',artifactKind:'repository',displayName:alias,sourceStage:'baseline',sourceDates:dates(row,['created_at','updated_at','pushed_at']),relatedAccounts:[ownerId],unresolvedPeople:[],publicationAuthorized:false};
}
export function createDiscoveryGithubAdapter(resolvers: DiscoveryGithubResolvers) {
  const trustedResolvers={...resolvers};
  async function source(id: string) { const raw=await trustedResolvers.resolveSource(id);
  if (!raw) return fail('source-missing');
  const s=DiscoveryRuntimeSource.parse(JSON.parse(canonical(raw)));
  if(s.provider!=='github'||s.endpointTemplate.origin!=='https://api.github.com') return fail('source-provider'); route(s.endpointTemplate.path);
  return s; }
  async function retainedPage(id: string) {
    const raw=await trustedResolvers.resolvePage(id);
    if(!raw) return fail('receipt-missing');
    const page=DiscoveryCollectionPageReceipt.parse(raw);
    if(page.id!==id || !page.committed) return fail('receipt-binding');
    const resolved=await trustedResolvers.resolveRepresentation(page.representation);
    if(!resolved) return fail('unretained');
    const retained={...resolved,bytes:new Uint8Array(resolved.bytes),request:DiscoverySourceRequest.parse(JSON.parse(canonical(resolved.request)))};
    const request=DiscoverySourceRequest.parse(JSON.parse(canonical(retained.request)));
    if(retained.id!==page.representation.id||retained.revision!==page.representation.revision||request.sourceId!==page.sourceId||request.provider!=='github'||await sha(retained.bytes)!==page.representationSha256||retained.representationSha256!==page.representationSha256||await sha(new TextEncoder().encode(canonical(request)))!==page.requestSha256) return fail('receipt-binding');
    const s=await source(page.sourceId);
    if(page.sourceRevision!==s.revision||request.endpointConstructor!==s.endpointTemplate.id||canonical(request.configuration)!==canonical(s.configuration)||request.installation!==s.installation||request.scopeId!==s.scopeId||canonical(request.enrollment)!==canonical(s.enrollment)||canonical(request.parser)!==canonical(s.parser)||canonical(request.permission)!==canonical(s.permission)) return fail('receipt-source-binding');
    return {page,retained,request,s};
  }
  async function repositoryBinding(receiptId: string) {
    const r=await retainedPage(receiptId);
    if(route(r.s.endpointTemplate.path)!=='repository'||r.page.truncated||r.page.rejectedCount||r.page.providerLimited||r.page.leadCount!==1) return fail('baseline-receipt');
    const raw=record(body(r.retained.bytes, 'repository'));
    const lead=repository(raw,[]);
    if(r.s.endpointTemplate.path!==`/repos/${lead.displayName}`) return fail('baseline-alias');
    return {repositoryId:lead.nativeId,alias:lead.displayName,receiptId,representation:r.page.representation};
  }
  async function inspect(input: DiscoveryCollectionParseInput) {
    input={...input,bytes:new Uint8Array(input.bytes),request:DiscoverySourceRequest.parse(JSON.parse(canonical(input.request))),parser:{...input.parser}};
    const request=input.request, s=await source(request.sourceId), t=s.endpointTemplate;
    if(request.provider!=='github'||request.endpointConstructor!==t.id||canonical(request.configuration)!==canonical(s.configuration)||canonical(request.enrollment)!==canonical(s.enrollment)||canonical(request.parser)!==canonical(s.parser)||request.installation!==s.installation||request.scopeId!==s.scopeId||canonical(request.permission)!==canonical(s.permission)||canonical(input.parser)!==canonical(s.parser)||await sha(input.bytes)!==input.representationSha256||await sha(new TextEncoder().encode(canonical(request)))!==input.requestSha256) return fail('request-binding');
    await constructDiscoveryEndpoint(t,Object.entries(request.parameters));
    if(!Number.isSafeInteger(input.maxItems)||input.maxItems<1||input.maxItems>100) return fail('item-budget');
    const kind=route(t.path), raw=body(input.bytes, ['repository','inventory','search-repositories'].includes(kind) ? kind as 'repository' | 'inventory' | 'search-repositories' : undefined), metadata: DiscoveryGithubMetadata[]=[], gaps: DiscoveryGithubGap[]=[];
    const single=kind==='repository'||kind==='profile', search=kind.startsWith('search-');
    let rows: any[], providerLimited=false;
    if(single) rows=[record(raw)]; else if(search) { const result=record(raw);
    if(typeof result.incomplete_results!=='boolean'||!Number.isSafeInteger(result.total_count)||result.total_count<0||!Array.isArray(result.items)) return fail('search-shape');
    rows=result.items;
    providerLimited=result.incomplete_results||result.total_count>1000;
    if(providerLimited) gaps.push('search-truncated'); } else { if(!Array.isArray(raw)) return fail('list-shape');
    rows=raw; }
    const perPage=Number(request.parameters.per_page??t.fixed.per_page??30), page=Number(request.parameters.page??t.fixed.page??1);
    if(!Number.isSafeInteger(perPage)||perPage<1||perPage>100||!Number.isSafeInteger(page)||page<1||rows.length>(single?1:perPage)) return fail('page-shape');
    let binding: Awaited<ReturnType<typeof repositoryBinding>>|undefined;
    if(['releases','tags','commits','contributors'].includes(kind)) { const receipt=await trustedResolvers.baselineReceiptForSource?.(s.id);
    if(!receipt) return fail('baseline-required');
    binding=await repositoryBinding(receipt);
    if(t.path!==`/repos/${binding.alias}/${kind}`) return fail('list-binding'); }
    const leads: DiscoveryCollectionLead[]=[];
    for(const value of rows) {
      const row=record(value);
      if(['repository','inventory','search-repositories'].includes(kind)) { if(row.private===true) { gaps.push('private-repository');
      providerLimited=true; continue; } const lead=repository(row,metadata);
      if(kind==='repository'&&t.path!==`/repos/${lead.displayName}`) return fail('repository-path-binding');
      if(kind==='inventory'&&t.path.split('/')[2].toLowerCase()!==record(row.owner).login.toLowerCase()) return fail('inventory-owner-binding');
      leads.push(lead); }
      else if(['profile','search-users','contributors'].includes(kind)) { const lead=account(row,metadata,kind==='contributors'?'contributor-account':undefined);
      if(kind==='profile'&&(t.path.split('/')[2].toLowerCase()!==lead.displayName.toLowerCase()||(t.path.startsWith('/orgs/')?row.type!=='Organization':row.type!=='User'&&row.type!=='Bot'))) return fail('profile-path-binding');
      leads.push(lead); }
      else {
        const base: DiscoveryCollectionLead={nativeId:binding!.repositoryId,kind:'artifact',artifactKind:'repository',displayName:binding!.alias,sourceStage:'baseline',sourceDates:[],relatedAccounts:[],unresolvedPeople:[],publicationAuthorized:false};
        if(kind==='releases'&&row.url!==undefined&&row.url!==`https://api.github.com/repos/${binding!.alias}/releases/${numeric(row.id)}`) return fail('release-native-binding');
        if(kind==='commits'&&row.url!==undefined&&row.url!==`https://api.github.com/repos/${binding!.alias}/commits/${row.sha}`) return fail('commit-native-binding');
        if(kind==='releases') { base.sourceStage='release';
        base.sourceVersion=`release:${numeric(row.id)}`;
        base.displayName=text(row.name||row.tag_name);
        if(typeof row.draft!=='boolean'||typeof row.prerelease!=='boolean') return fail('release-shape');
        base.sourceDates=dates(row,['created_at','published_at']); }
        if(kind==='tags') { base.sourceStage='tag';
        base.sourceVersion=`tag:${text(row.name,180)}`;
        const target=text(record(row.commit).sha,64);
        if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(target)) return fail('tag-sha');
        base.sourceVersion=`tag:${text(row.name,120)}:${target}`; }
        if(kind==='commits') { base.sourceStage='commit';
        const hash=text(row.sha,64);
        if(!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(hash)) return fail('commit-sha');
        base.sourceVersion=hash;
        const commit=record(row.commit);
        const author=record(commit.author);
        base.sourceDates=dates(author,['date']).map(v=>({...v,field:'author_date'}));
        if(commit.committer) base.sourceDates.push(...dates(record(commit.committer),['date']).map(v=>({...v,field:'committer_date'})));
        if(row.author) {const a=account(record(row.author),metadata,'commit-author-account');
        base.relatedAccounts=[a.nativeId];} if(author.name) {base.unresolvedPeople=[text(author.name)];
        metadata.push({nativeId:base.nativeId,role:'unresolved-personal-author'});} }
        leads.push(base);
      }
    }
    const truncated=leads.length>input.maxItems;
    if(truncated) gaps.push('item-cap');
    if(search) { const total=record(raw).total_count, offset=(page-1)*perPage;
    if(!providerLimited && (total<offset+rows.length || rows.length<perPage&&total>offset+rows.length)) return fail('search-count-conflict'); }
    let nextCheckpoint: string|null=null, terminal=single;
    if(!single) {
      const responseLink = input.responseLink;
      if(responseLink===undefined) return fail('pagination-metadata-required');
      if(responseLink!==null) {
        if(typeof responseLink!=='string'||responseLink.length>8192) return fail('link-shape');
        const parts=responseLink.split(',');
        if(parts.length>8) return fail('link-bound');
        const seen=new Set<string>();
        for(const part of parts) {
          const match=/^\s*<([^<>]+)>\s*;\s*rel="(next|prev|first|last)"\s*$/.exec(part);
          if(!match||seen.has(match[2])) return fail('link-shape');
          seen.add(match[2]);
          let url:URL; try {url=new URL(match[1]);} catch {return fail('link-url');}
          if(url.origin!==t.origin||url.pathname!==t.path||url.username||url.password||url.hash) return fail('link-scope');
          const entries=[...url.searchParams.entries()];
          if(new Set(entries.map(([k])=>k)).size!==entries.length) return fail('link-duplicate');
          const parameters:Record<string,string>={};
          for(const [key,value] of entries) {if(Object.hasOwn(t.fixed,key)) {if(t.fixed[key]!==value) return fail('link-fixed');} else parameters[key]=value;}
          if(Object.keys(t.fixed).some(key=>url.searchParams.get(key)!==t.fixed[key])) return fail('link-fixed');
          await constructDiscoveryEndpoint(t,Object.entries(parameters));
          const expected={...request.parameters,page:parameters.page};
          if(canonical(parameters)!==canonical(expected)||t.pageParameter!=='page') return fail('link-parameters');
          if(match[2]==='next') { if(Number(parameters.page)!==page+1) return fail('link-sequence');
          nextCheckpoint=parameters.page; }
        }
      }
      if(nextCheckpoint===null) {terminal=rows.length<perPage;
      if(!terminal) {providerLimited=true;gaps.push('page-cap');}}
      else { const rule=t.parameters.page;
      if(!rule||rule.kind!=='integer'||Number(nextCheckpoint)>rule.max||search&&page*perPage>=1000) {providerLimited=true;gaps.push('page-cap');nextCheckpoint=null;} }
    }
    if(providerLimited||truncated) terminal=false;
    const draft=DiscoveryCollectionDraft.parse({schemaVersion:'discovery-collection-v1',requestSha256:input.requestSha256,representationSha256:input.representationSha256,parser:input.parser,representationFormat:'json',leads:leads.slice(0,input.maxItems),terminal,nextCheckpoint:truncated?null:nextCheckpoint,rejectedCount:Math.max(0,leads.length-input.maxItems),truncated,providerLimited});
    return {draft,metadata,gaps:[...new Set(gaps)],provenance:{sourceId:s.id,sourceRevision:s.revision,requestSha256:input.requestSha256,representationSha256:input.representationSha256,parser:{...input.parser},request:JSON.parse(canonical(request))}};
  }
  const parse=async(input:DiscoveryCollectionParseInput)=>(await inspect(input)).draft;
  return {provider:'github' as const, parser:parse,parse,inspect,repositoryBinding,
    async plan(sourceId:string,parameters:Record<string,string>) { const s=await source(sourceId);
    return {sourceId,parameters:{...parameters},endpoint:await constructDiscoveryEndpoint(s.endpointTemplate,Object.entries(parameters))}; },
    async nextPage(receiptId:string) { const {page}=await retainedPage(receiptId);
    if(page.truncated||page.rejectedCount||page.providerLimited||page.limitationCode) return fail('incomplete-page');
    return page.nextCheckpoint; }
  };
}
