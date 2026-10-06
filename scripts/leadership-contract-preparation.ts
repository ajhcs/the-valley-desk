/** Offline synthetic contract harness. Deliberately not imported by collectors.
 * data-fixture-* bindings are test inventions, not selectors for any publisher.
 * No preview can qualify a source or authorize freshness, affiliation or departure.
 */
import { parse, type DefaultTreeAdapterTypes } from "parse5";
import { looksInstructionLike } from "../src/ingest/untrusted-text";
import preparation from "../fixtures/leadership-contract-preparation-20261005.json";
import { normalizePersonName } from "../src/ingest/executive-history";
type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;
const isElement = (node: Node): node is Element => "tagName" in node;
function attr(node: Node, name: string) {return isElement(node) ? node.attrs.find(row=>row.name===name)?.value : undefined;}
function children(node: Node): Node[] {return "childNodes" in node ? node.childNodes : [];}
function walk(node: Node, predicate: (node:Node)=>boolean): Node[] {return [...(predicate(node)?[node]:[]),...children(node).flatMap(child=>walk(child,predicate))];}
function text(node:Node):string {
 if("value" in node) return node.value;
 if(isElement(node)&&["script","style","template","noscript"].includes(node.tagName)) return "";
 return children(node).map(text).join(" ").replace(/\s+/g," ").trim();
}
function ownedFields(card:Node,field:string):Node[] {
 return children(card).flatMap(child=>attr(child,"data-fixture-person")!==undefined?[]:[...(attr(child,"data-fixture-field")===field?[child]:[]),...ownedFields(child,field)]);
}
const LABEL = /^(?:titles?|certifications?|graduate degrees?|residenc(?:y|ies)|executive leadership|temple health leadership|chair(?:man)?(?: of)?(?: the)? board(?: of directors)?|chief .+ officer|president(?: and .+)?)$/i;
export function previewSyntheticLeadershipContract(sourceId:string,html:string) {
 const contract=preparation.contracts.find(row=>row.sourceId===sourceId);
 const rejected:{name:string;reason:string}[]=[];
 const candidates:{name:string;title:string;sourceId:string;institutionId:string;publishedAt:string|null;currentAffiliationVerified:false}[]=[];
 const historicalClaims:typeof candidates=[];
 const result={qualification:"awaiting-due-capture" as const,extractionStatus:"partial" as const,currentAffiliationVerified:false as const,renewFreshness:false as const,authorizeDeparture:false as const,candidates,historicalClaims,rejected};
 if(!contract){rejected.push({name:"",reason:"source-outside-preparation"});return result;}
 if(looksInstructionLike(html)){rejected.push({name:"",reason:"hostile-untrusted-markup"});return result;}
 const document=parse(html);
 const roots=walk(document,node=>attr(node,"data-fixture-source")===sourceId);
 if(roots.length!==1||attr(roots[0],"data-fixture-institution")!==contract.institutionId){rejected.push({name:"",reason:"unproven-institution-root"});return result;}
 const explicitArticle=walk(document,node=>isElement(node)&&node.tagName==="meta"&&attr(node,"property")==="og:type"&&attr(node,"content")==="article").length>0;
 const published=walk(document,node=>isElement(node)&&node.tagName==="meta"&&attr(node,"property")==="article:published_time").map(node=>attr(node,"content")).find(value=>value&&Number.isFinite(Date.parse(value)))??null;
 for(const card of walk(roots[0],node=>attr(node,"data-fixture-person")!==undefined)){
  const names=ownedFields(card,"name"),titles=ownedFields(card,"title");
  const name=names.length===1?text(names[0]):"";const title=titles.length===1?text(titles[0]):"";
  let reason="";
  if(names.length!==1||titles.length!==1)reason="unpaired-or-ambiguous-fields";
  else if(attr(card,"data-fixture-institution")!==contract.institutionId)reason="cross-institution";
  else if(!contract.allowedFixtureScopes.includes(attr(card,"data-fixture-scope")??""))reason="wrong-section-or-region";
  else if(LABEL.test(name)||!/^\p{L}[\p{L}.'’ -]+ \p{L}[\p{L}.'’ -]+$/u.test(name))reason="non-person-label";
  else if(contract.expectedProfileIdentity&&normalizePersonName(name)!==normalizePersonName(contract.expectedProfileIdentity))reason="wrong-profile-identity";
  else if(!/\b(?:chief|president|officer|director|vice president)\b/i.test(title))reason="unrecognized-role";
  else if(explicitArticle||attr(card,"data-fixture-article")==="true")reason="historical-article-claim";
  const row={name,title,sourceId,institutionId:contract.institutionId,publishedAt:published,currentAffiliationVerified:false as const};
  if(reason){rejected.push({name,reason});if(reason==="historical-article-claim")historicalClaims.push(row);continue;}
  candidates.push(row);
 }
 const names=new Set<string>();
 for(const row of [...candidates]){
  const normalized=normalizePersonName(row.name);
  if(names.has(normalized)){for(let i=candidates.length-1;i>=0;i--)if(normalizePersonName(candidates[i].name)===normalized)candidates.splice(i,1);rejected.push({name:row.name,reason:"ambiguous-duplicate-identity"});}
  names.add(normalized);
 }
 return result;
}
