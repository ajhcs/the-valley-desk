import { canonicalJson, sha256 } from "../../src/content/watch-schema";
import { watchUrlIdentity } from "../../src/ingest/watch/source-enrollment";
import { REQUIRED_DESK_COUNTS } from "../../src/ingest/watch-model-evaluation";

export type DraftEvidence={id:string;desk:keyof typeof REQUIRED_DESK_COUNTS;groupId:string;sourceUrl:string;
  sourceTextSha256:string;characters:number;provenance:unknown;limitations:string[];policyJurisdiction?:string};

export function underlyingGroup(id:string,url:string) {
  if(["evt-dvhimss-22958","evt-njdvhimss-fall-2026"].includes(id))return "event:njdvhimss-fall-2026";
  if(["evt-dvhimss-23007","evt-njdvhimss-golf-2026"].includes(id))return "event:njdvhimss-golf-2026";
  const bill=/\/legislation\/bills\/(\d{4})\/(hb\d+|sb\d+)/i.exec(url);
  if(bill)return "policy:PA:"+bill[1]+":"+bill[2]!.toLowerCase();
  return "url:"+watchUrlIdentity(url);
}
export async function prepareEvaluationInventory(records:DraftEvidence[],provenance:unknown) {
  const unique=new Map<string,DraftEvidence>();
  if(records.length>5000)throw Error("evaluation-inventory-row-limit");
  for(const record of records){
    if(!Object.hasOwn(REQUIRED_DESK_COUNTS,record.desk))throw Error("evaluation-desk");
    if(record.desk==="policy"&&!["federal","PA","NJ","DE","local"].includes(record.policyJurisdiction??""))throw Error("evaluation-policy-jurisdiction");
    watchUrlIdentity(record.sourceUrl);
    if(record.characters<1||record.characters>2_000_000)throw Error("evaluation-inventory-source-length");
    if(!/^[a-f0-9]{64}$/.test(record.sourceTextSha256))throw Error("evaluation-source-hash");
    if(!record.groupId||unique.has(record.id))throw Error("duplicate-or-missing-evaluation-identity");
    unique.set(record.id,record);
  }
  // Equivalent source bytes and the same underlying event/instrument/repository
  // must not inflate category totals or cross the future split boundary.
  const parents=new Map(records.map(record=>[record.id,record.id]));
  const find=(id:string):string=>{const parent=parents.get(id)!;if(parent===id)return id;const root=find(parent);parents.set(id,root);return root;};
  const merge=(a:string,b:string)=>{const roots=[find(a),find(b)].sort();parents.set(roots[1]!,roots[0]!);};
  const groupOwners=new Map<string,string>(),textOwners=new Map<string,string>();
  for(const record of records){
    const group=groupOwners.get(record.groupId),text=textOwners.get(record.sourceTextSha256);
    if(group)merge(record.id,group);if(text)merge(record.id,text);
    groupOwners.set(record.groupId,record.id);textOwners.set(record.sourceTextSha256,record.id);
  }
  const seenGroups=new Set<string>(),drafts:unknown[]=[],counts=Object.fromEntries(Object.keys(REQUIRED_DESK_COUNTS).map(desk=>[desk,0]));
  const policyCounts={federal:0,PA:0,NJ:0,DE:0,local:0};
  for(const record of [...unique.values()].sort((a,b)=>a.id.localeCompare(b.id))){
    const splitGroupId=find(record.id),duplicate=seenGroups.has(splitGroupId);
    if(!duplicate){
      seenGroups.add(splitGroupId);counts[record.desk]++;
      if(record.desk==="policy"&&record.policyJurisdiction&&record.policyJurisdiction in policyCounts)
        policyCounts[record.policyJurisdiction as keyof typeof policyCounts]++;
    }
    drafts.push({...record,splitGroupId,duplicateGroupOrText:duplicate,split:null,critical:null,
      expected:null,reviewerLabels:[],adjudication:null,readiness:"agent-prepared-not-human-labeled"});
  }
  const coverage=Object.entries(REQUIRED_DESK_COUNTS).map(([desk,required])=>({desk,required,
    distinctDraftGroups:counts[desk],draftSlotUpperBound:Math.min(required,counts[desk]!),missingDraftSlots:Math.max(0,required-counts[desk]!),
    approvedCases:0}));
  return {version:"real-evaluation-preparation-1",status:"not-an-evaluation-corpus",provenance,
    evidenceManifestSha256:await sha256(canonicalJson([...records].sort((a,b)=>a.id.localeCompare(b.id)))),requiredCases:100,approvedCases:0,
    runnable:false,configuration:null,pricing:null,modelMetrics:null,
    split:{calibrationRequired:20,holdoutRequired:80,frozen:false,assigned:0,
      rule:"Keep all versions, aliases, companion bills, corrections and project artifacts in the same reviewed group; deduplicate syndicated events before assignment"},
    coverage,policyCoverage:Object.entries(policyCounts).map(([jurisdiction,count])=>({jurisdiction,required:7,distinctDraftGroups:count,missingDraftSlots:Math.max(0,7-count)})),
    reviewRequirements:["two-independent-human-labels","critical-case-adjudication","literal-evidence-and-expected-claims",
      "legacy-input-mapping-review","reuse-assessment","semantic-group-review","freeze-20-calibration-80-holdout-before-tuning"],
    drafts};
}
