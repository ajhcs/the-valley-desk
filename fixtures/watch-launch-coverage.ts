import plan from "../docs/watch-v1-blueprint/source-plan.json";

const proposed:Record<string,string[]>={
  "federal-regulation":["candidate-federal-cms"],
  "pa-legislation":["candidate-pa-memos"],"pa-members":["candidate-pa-members"],
  "nj-legislation":["candidate-nj-downloads"],"de-legislation":["candidate-de-introduced"],
};
export const launchCoverage={
  status:"unqualified-candidate-inventory",
  policyFamilies:plan.policyFamilies.map(family=>({id:family.id,jurisdiction:family.jurisdiction,
    requiredAtLaunch:family.requiredAtLaunch,candidateSourceIds:proposed[family.id]??[],
    status:"not-qualified",engineeringOwnerId:null,editorialOwnerId:null,
    nextAction:proposed[family.id]?"Resolve source-specific capture/parser blockers and review evidence":"Identify exact official endpoint and implement family-specific parser"})),
  counties:plan.counties.map(county=>({id:county.id,state:county.state,county:county.county,targetBody:county.targetBody,
    status:county.id==="pa-philadelphia"?"captured-inventory-parser-unavailable":"no-qualified-source-or-monitoring-assignment",
    candidateSourceIds:county.id==="pa-philadelphia"?["candidate-philadelphia"]:[],
    monitoringAssignment:null,backupEditorId:null,evidenceLog:null,municipalCoverage:"not-enumerated",
    nextAction:county.id==="pa-philadelphia"?"Qualify Council agenda/legislation parser and separate city notices":"Enumerate official county body notices and assign a named editor/backup with cadence"})),
};
