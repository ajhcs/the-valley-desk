/** Bounded DOM extraction; candidates remain partial review evidence.
 * Outputs remain review-only. No fetch, freshness, affiliation or storage writes. */
import {parse, type DefaultTreeAdapterTypes as Tree} from "parse5";
import {coveragePack} from "./coverage-pack";
import {normalizePersonName, normalizeTitle} from "./executive-history";
import {looksInstructionLike} from "./untrusted-text";
type Node=Tree.Node;
type Element=Tree.Element;
export type DomPreviewCandidate={name:string;displayName:string;title:string;normalizedName:string;normalizedTitle:string;sourceId:string;institutionId:string;sourceUrl:string;sourceSection:string;scope:string;sourcePublishedAt:null;currentAffiliationVerified:false};
const PROFILE:Record<string,string>={"src-chop-desai":"Bimal Desai","src-chop-pennington":"Jeffrey Pennington","src-chop-salmasian":"Hojjat Salmasian"};
const SOURCE_IDS=new Set([...Object.keys(PROFILE),"src-chop-leadership","src-temple-leadership","src-inspira-leadership","src-nemours-leadership"]);
export const isLeadershipDomReviewSource=(sourceId:string)=>SOURCE_IDS.has(sourceId);
const isElement=(n:Node):n is Element=>"tagName" in n;
const children=(n:Node):Node[]=>"childNodes" in n?n.childNodes:[];
const attr=(n:Node,key:string)=>isElement(n)?n.attrs.find(a=>a.name===key)?.value??"":"";
const tag=(n:Node)=>isElement(n)?n.tagName:"";
const has=(n:Node,name:string)=>attr(n,"class").split(/\s+/).includes(name);
function all(n:Node,predicate:(n:Node)=>boolean):Node[]{return [...(predicate(n)?[n]:[]),...children(n).flatMap(c=>all(c,predicate))];}
function text(n:Node):string{
 if("value" in n)return n.value;
 if(["script","style","template","noscript"].includes(tag(n)))return "";
 return children(n).map(text).join(" ").replace(/\s+/g," ").trim();
}
function lines(n:Node,skip?:Node):string{
 if(n===skip)return "";
 if("value" in n)return n.value;
 if(["script","style","template","noscript"].includes(tag(n)))return "";
 if(tag(n)==="br")return "\n";
 return children(n).map(c=>lines(c,skip)).join("");
}
function owned(n:Node,predicate:(n:Node)=>boolean,isCard:(n:Node)=>boolean):Node[]{
 return children(n).flatMap(c=>isCard(c)?[]:[...(predicate(c)?[c]:[]),...owned(c,predicate,isCard)]);
}
// Plain bounded facts only; reject remaining entity-like prefixes even without
// semicolons. Ordinary prose ampersands followed by spaces remain supported.
export function isPlainFactText(value:unknown,max=240):value is string{
 return typeof value==="string"&&value.length<=max&&!/[<>\\\u0000-\u001f\u007f]/.test(value)
  &&!/&(?:[a-z]|#)/i.test(value);
}
const CREDENTIALS=new Set(["BSN","CENP","CHC","CPA","CPHRM","DNP","DO","DPT","EDD","ESQ","FAAP","FACHE","FACS","FAMIA","FNP-BC","JD","MA","MAPP","MBA","MBI","MD","MF","MHA","MHS-CL","MHSC","MIS","MPA","MPH","MPT","MS","MSN","NE-BC","NEA-BC","OTR/L","PHD","RN","RPH"]);
function factualDisplayName(value:string){
 if(!isPlainFactText(value,240)||!/^\p{L}[\p{L}\p{M}0-9.,'" /-]+$/u.test(value))return false;
 const parts=value.split(",");
 return parts.slice(1).every(part=>/^(?:jr\.?|sr\.?|[ivx]{1,4})$/i.test(part.trim())
  ||CREDENTIALS.has(part.replace(/[.\s]/g,"").toUpperCase()));
}
function credentialFreeName(display:string){
 const parts=display.split(",");const base=parts.shift()?.trim()??"";
 return [base,...parts.filter(p=>/^(?:jr\.?|sr\.?|[ivx]{1,4})$/i.test(p.trim())).map(p=>p.trim())].join(" ");
}
const ROLE=/\b(?:chief|president|officer|director|vice president|pediatrician-in-chief|surgeon-in-chief)\b/i;
function personName(name:string){
 return name.length<=120&&name.trim().split(/\s+/).length>=2&&name.trim().split(/\s+/).length<=9
  && /^[\p{L}][\p{L}\p{M}.''" -]+$/u.test(name)&&!ROLE.test(name)&&!/\b(?:chair|board|leadership|degree|certifications?|titles?|residency|education|team)\b/i.test(name);
}
function roleLine(value:string){
 return value.length>0&&isPlainFactText(value)&&ROLE.test(value)
  &&!/[.!?]\s+[A-Z]|\b(?:serves|served|joined|is a|was a|has been|brings)\b/i.test(value);
}
export function previewLeadershipDom(sourceId:string,html:string,sourceUrl?:string){
 const candidates:DomPreviewCandidate[]=[];const rejected:{reason:string;section?:string}[]=[];
 const result={qualification:"offline-review-only" as const,extractionStatus:"partial" as const,renewFreshness:false as const,authorizeDeparture:false as const,currentAffiliationVerified:false as const,candidates,rejected};
 const source=coveragePack.sources.find(s=>s.id===sourceId);
 if(!source||!SOURCE_IDS.has(sourceId)||sourceUrl!==source.url){rejected.push({reason:"unregistered-source-or-url"});return result;}
 if(new TextEncoder().encode(html).byteLength>512000){rejected.push({reason:"over-capture-bound"});return result;}
 if(looksInstructionLike(html)){rejected.push({reason:"hostile-untrusted-document"});return result;}
 const document=parse(html);
 // Bound traversal before recursive text/owned-field helpers touch untrusted DOM.
 const pending:Array<{node:Node;depth:number}>=[{node:document,depth:0}];let nodes=0;
 while(pending.length){const entry=pending.pop()!;
  if(++nodes>20000||entry.depth>128){rejected.push({reason:"document-complexity-bound"});return result;}
  for(const child of children(entry.node))pending.push({node:child,depth:entry.depth+1});
 }

 const explicitArticle=all(document,n=>tag(n)==="meta"&&((attr(n,"property")==="og:type"&&attr(n,"content")==="article")||attr(n,"property")==="article:published_time")).length>0
  ||all(document,n=>tag(n)==="script"&&attr(n,"type")==="application/ld+json").some(n=>{
    try{
     const value=JSON.parse(children(n).map(c=>"value" in c?c.value:"").join(""));
     const values:unknown[]=[value];let count=0;
     while(values.length){const item=values.pop();if(++count>10000)return true;
      if(Array.isArray(item)){if(count+item.length>10000)return true;for(const value of item)values.push(value);}
      else if(item!==null&&typeof item==="object"){
       if(Object.entries(item).some(([key,v])=>key==="@type"&&[v].flat().some(t=>typeof t==="string"&&/^(?:https?:\/\/schema\.org\/)?(?:NewsArticle|Article|BlogPosting)$/i.test(t))))return true;
       const nested=Object.values(item);if(count+nested.length>10000)return true;for(const value of nested)values.push(value);
      }
     }
     return false;
    }catch{return false;}
   });
 if(explicitArticle){rejected.push({reason:"explicit-article-context"});return result;}
 const add=(displayName:string,title:string,section:string,scope:string)=>{
  if(!factualDisplayName(displayName)){rejected.push({reason:"non-factual-display-name"});return;}
  const name=credentialFreeName(displayName);
  if(!personName(name)){rejected.push({reason:"non-person-or-ambiguous-name",section});return;}
  if(!roleLine(title)){rejected.push({reason:"unpaired-or-non-role-title",section});return;}
  candidates.push({name,displayName,title,normalizedName:normalizePersonName(name),normalizedTitle:normalizeTitle(title),sourceId,institutionId:source.institutionId,sourceUrl:source.url,sourceSection:section,scope,sourcePublishedAt:null,currentAffiliationVerified:false});
 };
 const unique=(nodes:Node[],reason:string)=>{if(nodes.length!==1){rejected.push({reason});return undefined;}return nodes[0];};
 const roots=all(document,n=>sourceId==="src-temple-leadership"?tag(n)==="article"&&has(n,"leadership-wrapper"):tag(n)==="main"&&(sourceId.startsWith("src-chop-")?attr(n,"id")==="main-content":true));
 const root=unique(roots,"missing-or-ambiguous-source-root");if(!root)return result;
 const pageHeadings=all(root,n=>tag(n)==="h1").map(text);
 const headingOK=PROFILE[sourceId]?pageHeadings.some(h=>normalizePersonName(credentialFreeName(h))===normalizePersonName(PROFILE[sourceId]))
  :sourceId==="src-chop-leadership"?pageHeadings.some(h=>/^(?:CHOP )?Executive Leadership$/i.test(h))
  :sourceId==="src-temple-leadership"?pageHeadings.includes("Temple Health Leadership")
  :sourceId==="src-inspira-leadership"?pageHeadings.includes("Executive Management and Senior Leadership Team")
  :pageHeadings.includes("Leadership & Governance");
 if(!headingOK){rejected.push({reason:"source-page-identity-mismatch"});return result;}
 if(PROFILE[sourceId]){
  const hero=unique(all(root,n=>tag(n)==="chop-health-professional-hero"),"ambiguous-profile-hero");
  const name=hero&&unique(all(hero,n=>tag(n)==="h2"),"ambiguous-profile-name");
  if(!name||normalizePersonName(credentialFreeName(text(name)))!==normalizePersonName(PROFILE[sourceId])){rejected.push({reason:"wrong-profile-identity"});return result;}
  const panel=unique(all(root,n=>tag(n)==="chop-accordion-panel"&&all(n,c=>tag(c)==="h3"&&text(c)==="Titles").length===1),"ambiguous-profile-titles-panel");
  if(panel){const titles=owned(panel,n=>tag(n)==="p",n=>tag(n)==="chop-accordion-panel").map(text).filter(roleLine);if(!titles.length)rejected.push({reason:"missing-profile-role"});else add(text(name),titles.join("; "),"Titles","profile");}
 }else if(sourceId==="src-chop-leadership"){
  const isCard=(n:Node)=>tag(n)==="chop-basic-card";
  for(const card of all(root,isCard)){
   const name=owned(card,n=>tag(n)==="h2",isCard);const titles=owned(card,n=>tag(n)==="p",isCard).map(text).filter(roleLine);
   if(name.length!==1||titles.length!==1){rejected.push({reason:"ambiguous-card-fields"});continue;}
   add(text(name[0]!),titles[0]!,"CHOP Executive Leadership","executive-roster");
  }
 }else if(sourceId==="src-temple-leadership"){
  const body=unique(all(root,n=>has(n,"text_body")),"ambiguous-temple-body");if(!body)return result;
  for(const p of all(body,n=>tag(n)==="p")){
   const names=all(p,n=>tag(n)==="strong"||tag(n)==="b");if(names.length!==1){if(names.length)rejected.push({reason:"ambiguous-paragraph-name"});continue;}
   const name=names[0]!;const titles=lines(p,name).split("\n").map(s=>s.replace(/\s+/g," ").trim()).filter(roleLine);
   if(!titles.length){rejected.push({reason:"missing-paragraph-role"});continue;}
   add(text(name),titles.join("; "),"Temple Health Leadership","executive-roster");
  }
 }else if(sourceId==="src-inspira-leadership"){
  const isCard=(n:Node)=>has(n,"paragraph--type--wysiwyg");
  for(const card of all(root,isCard)){
   const names=owned(card,n=>tag(n)==="h2",isCard);const titles=owned(card,n=>tag(n)==="h3",isCard);
   if(!names.length)continue;
   if(names.length!==1||titles.length!==1){rejected.push({reason:"ambiguous-card-fields"});continue;}
   add(text(names[0]!),text(titles[0]!),"Executive Management and Senior Leadership Team","executive-roster");
  }
 }else{
  const panels=all(root,n=>has(n,"cmp-tabs__tabpanel"));
  for(const panel of panels){
   const sectionNodes=all(panel,n=>tag(n)==="h2"&&has(n,"cmp-title__text"));
   const section=sectionNodes.length===1?text(sectionNodes[0]!):"";
   if(!["Nemours Executive Cabinet","Senior Vice Presidents and Medical Leadership"].includes(section)){rejected.push({reason:"board-or-unproven-section"});continue;}
   const isCard=(n:Node)=>has(n,"column");
   for(const card of all(panel,isCard)){
    const names=owned(card,n=>tag(n)==="h2"&&!has(n,"cmp-title__text"),isCard);const titles=owned(card,n=>tag(n)==="h3",isCard);
    if(!names.length)continue;
    if(names.length!==1||titles.length!==1){rejected.push({reason:"ambiguous-card-fields",section});continue;}
    const title=text(titles[0]!);
    if(/\bFlorida\b/i.test(title)){rejected.push({reason:"outside-regional-scope",section});continue;}
    add(text(names[0]!),title,section,/\bDelaware Valley\b/i.test(title)?"delaware-valley":"institution-wide-or-unspecified");
   }
  }
 }
 const duplicates=new Set<string>();const seen=new Set<string>();for(const row of candidates){if(seen.has(row.normalizedName))duplicates.add(row.normalizedName);seen.add(row.normalizedName);}
 for(let i=candidates.length-1;i>=0;i--)if(duplicates.has(candidates[i]!.normalizedName)){candidates.splice(i,1);rejected.push({reason:"ambiguous-duplicate-identity"});}
 return result;
}
