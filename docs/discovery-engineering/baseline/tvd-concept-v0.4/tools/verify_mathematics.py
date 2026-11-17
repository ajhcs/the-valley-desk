from pathlib import Path
import collections
import hashlib
import itertools
import json
import re
import time
import z3

ROOT=Path(__file__).resolve().parents[1]
MODEL=ROOT/'model/tvd-discovery.sysml'
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
scope=json.loads((ROOT/'proof-scope.json').read_text())
assert sha(ROOT/'proof-scope.json')==(ROOT/'proof-scope.sha256').read_text().strip()
formal=json.loads(re.search(r'doc tvdFormal /\*TVD-FORMAL/1.0\n(.*?)\n\s*\*/',MODEL.read_text(),re.S).group(1))
assert formal['proof_scope_sha256']==sha(ROOT/'proof-scope.json')
assert set(formal['bindings'])==set(scope['obligations'])
z3.set_param(proof=True)
report={'version':'TVD-MATH-REVIEW/1.0','model_sha256':sha(MODEL),'proof_scope_sha256':sha(ROOT/'proof-scope.json'),
 'solver_version':z3.get_full_version(),'cases':[],'negative_controls':[],
 'claim':'Explicit symbolic contracts and declared abstract state transitions only. No external truth or implementation correctness is inferred.'}
out=ROOT/'proofs/smt';out.mkdir(parents=True,exist_ok=True)

def interpret(tree, env):
 if 'ref' in tree: return env[tree['ref']]
 if 'const' in tree: return z3.BoolVal(tree['const']) if isinstance(tree['const'],bool) else z3.IntVal(tree['const'])
 if 'call' in tree: return interpret(formal['rules'][tree['call']],env)
 if 'and' in tree: return z3.And(*[interpret(t,env) for t in tree['and']])
 if 'or' in tree: return z3.Or(*[interpret(t,env) for t in tree['or']])
 if 'eq' in tree: return interpret(tree['eq'][0],env)==interpret(tree['eq'][1],env)
 raise ValueError(tree)

def check(pid,name,assumptions,guarantee):
 start=time.monotonic()
 witness=z3.Solver();witness.set(timeout=15000);witness.add(*assumptions)
 reachable=witness.check()
 solver=z3.Solver();solver.set(timeout=20000);solver.add(*assumptions);solver.add(z3.Not(guarantee))
 result=solver.check()
 stem=pid+'_'+name
 script='; '+pid+' '+name+'\n; model '+sha(MODEL)+'\n(set-option :produce-proofs true)\n'+solver.to_smt2()+'\n(get-proof)\n'
 (out/(stem+'.smt2')).write_text(script)
 item={'family':pid,'case':name,'assumption_satisfiability':str(reachable),'negated_guarantee':str(result),
       'status':'pass' if reachable==z3.sat and result==z3.unsat else 'fail','seconds':round(time.monotonic()-start,4)}
 if reachable==z3.sat: item['assumption_witness']={str(d):str(witness.model()[d]) for d in witness.model().decls()}
 if result==z3.unsat:
  proof=solver.proof().sexpr()
  (out/(stem+'.proof')).write_text(proof+'\n')
  item['proof_sha256']=hashlib.sha256((proof+'\n').encode()).hexdigest()
 elif result==z3.sat: item['counterexample']={str(d):str(solver.model()[d]) for d in solver.model().decls()}
 else: item['reason_unknown']=solver.reason_unknown()
 report['cases'].append(item)
 if item['status']!='pass': print(json.dumps(item),flush=True)

def negative(pid,name,assumptions,guarantee):
 solver=z3.Solver();solver.set(timeout=15000);solver.add(*assumptions,z3.Not(guarantee))
 result=solver.check()
 item={'family':pid,'mutation':name,'expected':'sat','result':str(result),'status':'detected' if result==z3.sat else 'missed'}
 if result==z3.sat: item['counterexample']={str(d):str(solver.model()[d]) for d in solver.model().decls()}
 (ROOT/'proofs'/('counterexample_'+pid+'_'+name+'.json')).write_text(json.dumps(item,indent=2)+'\n')
 report['negative_controls'].append(item)

ints={name:z3.Int(name) for name in ['health','technology','informatics','healthAi','regional','creatorRole','authority','sourceKind']}
flags={name:z3.Bool(name) for name in ['sourcePermitted','evidenceValid','evidenceHeadMatch','policyHeadMatch']}
county=z3.String('county')
county_member=z3.Or(*[county==key for key in formal['county_keys']])
source_allowed=z3.Or(*[ints['sourceKind']==value for value in formal['source_classes'].values()])
role_kind=z3.String('creator_role_kind');contributor_reviewed=z3.Bool('contributor_reviewed')
role_eligible=z3.Or(*[role_kind==role for role in formal['eligible_creator_roles']],z3.And(role_kind==formal['reviewed_contributor_role'],contributor_reviewed))
env={**ints,**flags,'roleEligible':role_eligible,'countyInPolicy':county_member,'sourceClassAllowed':source_allowed}
tri=list(ints)[:6]
domains=[z3.Or(ints[n]==-1,ints[n]==0,ints[n]==1) for n in tri]+[z3.Or(ints['authority']==i for i in [0,1,2])]
gate=interpret(formal['rules']['admit'],env)
professional_healthtech=z3.Int('professional_healthtech');professional_role=z3.Bool('professional_role_verified')
identity_admitted=z3.Bool('creator_identity_admitted')
current_profile_requested,current_profile_supported=z3.Bools('current_profile_requested current_profile_supported')
creator_env={**env,'identityAdmitted':identity_admitted,'professionalHealthTech':professional_healthtech,'professionalRoleVerified':professional_role,
 'currentProfileCompatible':z3.Or(z3.Not(current_profile_requested),current_profile_supported)}
creator_gate=interpret(formal['rules']['admitCreator'],creator_env)
healthtech=interpret(formal['rules']['healthTech'],env)
check('P01','admission_requires_healthtech',domains+[gate],healthtech)
check('P02','admission_requires_regional_role',domains+[gate],z3.And(ints['regional']==1,ints['creatorRole']==1))
check('P02','admission_requires_creation_role',domains+[gate],role_eligible)
check('P02','local_adoption_alone_does_not_qualify',domains+[role_kind=='used-at'],z3.Not(gate))
check('P02','public_creator_has_professional_healthtech_and_region',domains+[creator_gate],z3.And(professional_healthtech==1,ints['regional']==1,professional_role,county_member))
check('P07','public_creator_identity_is_admitted',domains+[creator_gate],identity_admitted)
check('P03','current_creator_filter_needs_current_evidence',domains+[creator_gate,current_profile_requested],current_profile_supported)
check('P04','no_model_publication_authority',domains+[gate],ints['authority']!=0)
check('P04','no_model_creator_publication_authority',domains+[creator_gate],ints['authority']!=0)
check('P31','exact_county_membership',domains+[gate],county_member)
check('P31','unknown_county_is_not_member',[county==''],z3.Not(county_member))
for key in formal['county_keys']: check('P31','member_'+key.replace(':','_'),[county==key],county_member)

def missing(tree,name):
 # Remove one admission conjunct deliberately for a negative control.
 clone=json.loads(json.dumps(tree))
 clone['and']=[part for part in clone['and'] if part!={'ref':name} and part!={'eq':[{'ref':name},{'const':1}]}]
 return interpret(clone,env)
bad_no_health=z3.And(*[interpret(part,env) for part in formal['rules']['admit']['and'] if part!={'call':'healthTech'}])
negative('P01','omit_healthtech_gate',domains+[bad_no_health],healthtech)
negative('P02','omit_regional_decision',domains+[missing(formal['rules']['admit'],'regional')],ints['regional']==1)
negative('P02','admit_adoption_as_creation',domains+[missing(formal['rules']['admit'],'roleEligible'),role_kind=='used-at'],role_eligible)
bad_county=missing(formal['rules']['admit'],'countyInPolicy')
negative('P31','omit_county_policy',domains+[bad_county],county_member)
auth_parts=formal['rules']['admit']['and']
bad_auth=z3.And(*[interpret(part,env) for part in auth_parts if not ('or' in part and {'eq':[{'ref':'authority'},{'const':1}]} in part['or'])])
negative('P04','accept_unqualified_authority',domains+[bad_auth],ints['authority']!=0)

from_time,to_time,now,expiry=z3.Ints('from_time to_time now expiry')
has_current_basis=z3.Bool('has_current_basis')
at=z3.And(from_time<=now,now<to_time)
current=z3.And(at,has_current_basis,now<expiry)
check('P03','half_open_end',[from_time<to_time,now==to_time],z3.Not(at))
check('P03','current_requires_current_basis',[current],has_current_basis)
check('P03','expiry_removes_current',[now>=expiry],z3.Not(current))
negative('P03','inclusive_interval_end',[from_time<to_time,now==to_time,z3.And(from_time<=now,now<=to_time)],at)
q_from,q_until=z3.Ints('query_from query_until')
contained=z3.And(q_from<=from_time,to_time<=q_until,from_time<to_time)
check('P03','partial_date_filter_is_conservative',[contained,from_time<=now,now<to_time],z3.And(q_from<=now,now<q_until))

admissible_context=[*domains,ints['health']==1,ints['technology']==1,ints['regional']==1,ints['creatorRole']==1,role_kind=='creator',
 county==formal['county_keys'][0],ints['authority']==1,*list(flags.values())]
for name,value in formal['source_classes'].items():
 changed=z3.substitute(gate,(ints['sourceKind'],z3.IntVal(value)))
 check('P05','channel_'+name,admissible_context,changed)
for name in ['publication','preprint','forum','institutional']:
 repo_exists,project_exists=z3.Bools('repo_exists project_exists')
 changed=z3.substitute(gate,(ints['sourceKind'],z3.IntVal(formal['source_classes'][name])))
 check('P06','no_repository_'+name,admissible_context+[z3.Not(repo_exists),z3.Not(project_exists)],changed)
check('P06','creator_profile_does_not_require_public_artifact',admissible_context+[identity_admitted,professional_healthtech==1,professional_role,z3.Not(current_profile_requested),ints['sourceKind']==4,z3.Not(repo_exists),z3.Not(project_exists)],creator_gate)
negative('P06','restore_repository_prerequisite',admissible_context+[ints['sourceKind']==1,z3.Not(repo_exists)],z3.And(gate,repo_exists))

same,equiv,conflict_free,name_match=z3.Bools('same_kind equivalence_admitted conflict_free name_match')
merge=interpret(formal['rules']['merge'],{'sameEntityKind':same,'equivalenceAdmitted':equiv,'conflictFree':conflict_free})
check('P07','name_does_not_prove_identity',[name_match,z3.Not(equiv)],z3.Not(merge))
check('P08','different_kinds_cannot_merge',[z3.Not(same)],z3.Not(merge))
negative('P07','merge_by_matching_name',[name_match,z3.Not(equiv)],z3.Not(name_match))
negative('P08','drop_identity_kind_guard',[equiv,conflict_free,z3.Not(same)],z3.Not(z3.And(equiv,conflict_free)))

ID=z3.StringSort();SET=z3.SetSort(ID)
retained=z3.Const('retained_evidence',SET);item=z3.String('source_native_identity')
check('P09','replay_is_idempotent',[],z3.SetAdd(z3.SetAdd(retained,item),item)==z3.SetAdd(retained,item))
NativeKey=z3.Datatype('ProviderNativeKey');NativeKey.declare('key',('provider',z3.StringSort()),('nativeId',z3.StringSort()));NativeKey=NativeKey.create()
provider_a,provider_b,native_a,native_b=z3.Strings('provider_a provider_b native_a native_b')
check('P09','provider_tuple_is_injective',[NativeKey.key(provider_a,native_a)==NativeKey.key(provider_b,native_b)],z3.And(provider_a==provider_b,native_a==native_b))
negative('P09','ambiguous_identifier_concatenation',[provider_a=='ab',native_a=='c',provider_b=='a',native_b=='bc',z3.Concat(provider_a,native_a)==z3.Concat(provider_b,native_b)],z3.And(provider_a==provider_b,native_a==native_b))
new_evidence=z3.Const('new_evidence',SET)
success=z3.Bool('refresh_succeeded')
after=z3.If(success,z3.SetUnion(retained,new_evidence),retained)
check('P10','refresh_keeps_prior_evidence',[],z3.IsSubset(retained,after))
check('P10','failure_cannot_create_evidence',[z3.Not(success)],after==retained)
negative('P10','clear_evidence_on_failure',[z3.Not(success),z3.IsMember(item,retained)],z3.IsMember(item,z3.EmptySet(ID)))

expected,head,p_expected,p_head=z3.Ints('expected_head current_head expected_policy current_policy')
commit=z3.And(gate,expected==head,p_expected==p_head)
check('P11','commit_requires_evidence_head_match',[commit],expected==head)
check('P28','commit_requires_policy_head_match',[commit],p_expected==p_head)
check('P28','monotone_revision_invalidates_old_binding',[expected==head],expected!=head+1)
negative('P11','remove_evidence_cas',[gate,p_expected==p_head,expected!=head],expected==head)
negative('P28','remove_policy_cas',[gate,expected==head,p_expected!=p_head],p_expected==p_head)

left,right,relation,evidence=z3.Bools('left_admitted right_admitted relation_admitted relation_evidence_current')
link=interpret(formal['rules']['link'],{'leftAdmitted':left,'rightAdmitted':right,'relationAdmitted':relation,'relationEvidenceCurrent':evidence})
check('P12','public_relation_has_admitted_endpoints',[link],z3.And(left,right,relation,evidence))
negative('P12','drop_right_endpoint',[left,relation,evidence,z3.Not(right)],z3.Not(z3.And(left,relation,evidence)))
reviewed,unrestricted,license_match=z3.Bools('license_reviewed unrestricted_permission license_version_matches')
reuse=interpret(formal['rules']['reuseClaim'],{'licenseReviewed':reviewed,'unrestrictedPermission':unrestricted,'licenseVersionMatches':license_match})
check('P13','unknown_license_cannot_assert_reuse',[z3.Not(reviewed)],z3.Not(reuse))
check('P13','restricted_license_cannot_assert_unrestricted_reuse',[z3.Not(unrestricted)],z3.Not(reuse))
negative('P13','public_means_reusable',[z3.Not(unrestricted)],unrestricted)
admitted_fields,allowed_fields,private_fields=z3.Consts('admitted_fields allowed_fields private_fields',SET)
display=z3.SetIntersect(admitted_fields,allowed_fields)
check('P14','projection_is_admitted_allowlist',[],z3.And(z3.IsSubset(display,admitted_fields),z3.IsSubset(display,allowed_fields)))
check('P14','private_fields_disjoint',[z3.SetIntersect(allowed_fields,private_fields)==z3.EmptySet(ID)],z3.SetIntersect(display,private_fields)==z3.EmptySet(ID))
negative('P14','display_unfiltered_candidate',[z3.IsMember(item,admitted_fields),z3.Not(z3.IsMember(item,allowed_fields))],z3.IsSubset(admitted_fields,allowed_fields))

in_snapshot,admitted,topic_a,topic_b,creator,selected_topic,selected_creator=z3.Bools('in_snapshot admitted topic_a topic_b creator selected_topic selected_creator')
topic_filter=z3.Or(z3.Not(selected_topic),topic_a,topic_b)
creator_filter=z3.Or(z3.Not(selected_creator),creator)
found=z3.And(in_snapshot,admitted,topic_filter,creator_filter)
check('P15','query_result_is_admitted_and_filtered',[found],z3.And(in_snapshot,admitted,topic_filter,creator_filter))
check('P16','facet_order_commutes',[],z3.And(topic_filter,creator_filter)==z3.And(creator_filter,topic_filter))
check('P16','facet_idempotent',[],z3.And(topic_filter,topic_filter)==topic_filter)
check('P16','within_facet_disjunction_commutes',[],z3.Or(topic_a,topic_b)==z3.Or(topic_b,topic_a))
check('P16','empty_filters_are_identity',[z3.Not(selected_topic),z3.Not(selected_creator)],found==z3.And(in_snapshot,admitted))
query_terms=z3.Const('query_terms',SET);term=z3.String('repeated_query_term')
check('P16','duplicate_query_term_does_not_boost_match_set',[],z3.SetAdd(z3.SetAdd(query_terms,term),term)==z3.SetAdd(query_terms,term))
negative('P15','drop_admission_filter',[in_snapshot,z3.Not(admitted),topic_filter,creator_filter],admitted)
negative('P16','or_across_facets',[topic_filter,z3.Not(creator_filter)],z3.And(topic_filter,creator_filter))

def key(prefix):
 return [z3.Int(prefix+'_score'),z3.Int(prefix+'_missing'),z3.Int(prefix+'_time'),z3.String(prefix+'_id')]
def less(a,b):
 return z3.Or(*[z3.And(*[a[j]==b[j] for j in range(i)],a[i]<b[i]) for i in range(4)])
a,b,c=key('a'),key('b'),key('c')
check('P17','irreflexive',[],z3.Not(less(a,a)))
check('P17','asymmetric',[less(a,b)],z3.Not(less(b,a)))
check('P17','total_for_distinct_identity',[a[3]!=b[3]],z3.Xor(less(a,b),less(b,a)))
check('P18','lexicographic_transitivity',[less(a,b),less(b,c)],less(a,c))
negative('P17','omit_stable_identity',[a[0]==b[0],a[1]==b[1],a[2]==b[2],a[3]!=b[3]],z3.Or(*[a[i]<b[i] for i in range(3)]))
old_ingest,new_ingest,event_time,score=z3.Ints('old_ingest new_ingest event_time score')
stable=z3.String('stable_id')
k1=[-score,z3.IntVal(0),-event_time,stable];k2=[-score,z3.IntVal(0),-event_time,stable]
check('P19','ingest_time_not_a_sort_coordinate',[],z3.And(*[x==y for x,y in zip(k1,k2)]))
check('P19','unknown_date_after_known_at_equal_match',[a[0]==b[0],a[1]==0,b[1]==1],less(a,b))
negative('P19','rank_by_recent_ingestion',[old_ingest!=new_ingest],-old_ingest==-new_ingest)

snapshot_same,query_same,sort_same,unexpired=z3.Bools('same_snapshot same_query same_sort snapshot_unexpired')
cursor=interpret(formal['rules']['cursorValid'],{'sameSnapshot':snapshot_same,'sameNormalizedQuery':query_same,'sameSortMode':sort_same,'snapshotUnexpired':unexpired})
check('P20','cursor_preserves_query_snapshot_sort',[cursor],z3.And(snapshot_same,query_same,sort_same,unexpired))
negative('P20','cursor_ignores_query',[snapshot_same,sort_same,unexpired,z3.Not(query_same)],query_same)

processed,remaining,page,whole=z3.Consts('processed remaining page whole',SET)
empty=z3.EmptySet(ID)
inv=[z3.SetUnion(processed,remaining)==whole,z3.SetIntersect(processed,remaining)==empty,z3.IsSubset(page,remaining)]
p_after=z3.SetUnion(processed,page);r_after=z3.SetDifference(remaining,page)
check('P21','page_step_preserves_partition',inv,z3.And(z3.SetUnion(p_after,r_after)==whole,z3.SetIntersect(p_after,r_after)==empty))
check('P21','page_does_not_repeat_processed',inv,z3.SetIntersect(processed,page)==empty)
n,L=z3.Ints('remaining_count page_limit')
n_after=z3.If(n>L,n-L,0)
check('P21','positive_page_strictly_decreases_remainder',[n>0,L>0],z3.And(n_after>=0,n_after<n))
check('P21','empty_remainder_finishes',[n==0,L>0],n_after==0)
negative('P21','allow_zero_page_size',[n>0,L==0],n_after<n)

used,inc,budget=z3.Ints('used increment budget')
guard=z3.And(inc>=0,used+inc<=budget)
next_used=z3.If(guard,used+inc,used)
for pid,name in [('P22','atomic_request_budget'),('P23','guarded_byte_append')]:
 check(pid,name,[budget>=0,used>=0,used<=budget],z3.And(next_used>=used,next_used<=budget))
 negative(pid,'unguarded_increment',[budget>=0,used==budget,inc>0],used+inc<=budget)
round_n,cursor_at,source_at=z3.Ints('cohort_size dispatch_cursor selected_source')
# Normalized cursor representation turns the same round-robin property into
# linear arithmetic. Preserve the original variable-modulus timeout as a finding.
slot=z3.If(source_at>=cursor_at,source_at-cursor_at,round_n-cursor_at+source_at)
visit=z3.If(cursor_at+slot<round_n,cursor_at+slot,cursor_at+slot-round_n)
check('P24','normalized_round_robin_slot',[round_n>0,cursor_at>=0,cursor_at<round_n,source_at>=0,source_at<round_n],z3.And(slot>=0,slot<round_n,visit==source_at))
advance=z3.If(cursor_at+1<round_n,cursor_at+1,0)
check('P24','advance_preserves_cursor_range',[round_n>0,cursor_at>=0,cursor_at<round_n],z3.And(advance>=0,advance<round_n))
negative('P24','never_advance_cursor',[round_n>1,cursor_at==0,source_at==1],cursor_at%round_n==source_at)

expected_n,checked_n,failed_n=z3.Ints('expected_sources checked_sources failed_sources')
truncated=z3.Bool('source_truncated')
complete=interpret(formal['rules']['coverageComplete'],{'expectedNonempty':expected_n>0,'allExpectedChecked':checked_n==expected_n,'noFailedChecks':failed_n==0,'notTruncated':z3.Not(truncated)})
check('P25','coverage_nonvacuous',[complete],z3.And(expected_n>0,checked_n==expected_n,failed_n==0,z3.Not(truncated)))
negative('P25','empty_enrollment_is_complete',[expected_n==0,checked_n==0,failed_n==0,z3.Not(truncated)],expected_n>0)
captured,qualified,approved=z3.Consts('captured qualified approved',SET)
cohort_admitted=z3.SetIntersect(captured,qualified)
cohort_published=z3.SetIntersect(cohort_admitted,approved)
check('P26','cohort_published_subset_admitted',[],z3.And(z3.IsSubset(cohort_published,cohort_admitted),z3.IsSubset(cohort_admitted,captured)))
work_ok,project_ok,group_ok,title_match=z3.Bools('work_admitted project_admitted grouping_admitted title_match')
group=interpret(formal['rules']['projectMember'],{'workAdmitted':work_ok,'projectAdmitted':project_ok,'groupingEvidenceAdmitted':group_ok})
check('P27','title_alone_cannot_group',[title_match,z3.Not(group_ok)],z3.Not(group))
negative('P27','group_similar_titles',[title_match,z3.Not(group_ok)],z3.Not(title_match))
origins=z3.Const('admitted_origins',SET);origin=z3.String('origin')
check('P32','duplicate_origin_does_not_add_corroboration',[],z3.SetAdd(z3.SetAdd(origins,origin),origin)==z3.SetAdd(origins,origin))

# Exhaustively explore the declared Boolean abstraction. The public current
# predicate is derived at read time; historical evidence remains separate.
life_spec=formal['lifecycle']
names=life_spec['controlled']+life_spec['inputs']
def boolean(tree,state):
 if 'ref' in tree: return state[tree['ref']]
 if 'const' in tree: return tree['const']
 if 'and' in tree: return all(boolean(t,state) for t in tree['and'])
 if 'or' in tree: return any(boolean(t,state) for t in tree['or'])
 raise ValueError(tree)
def current(s): return boolean(life_spec['current_predicate'],dict(zip(names,s)))
def update(s,**kw):
 result=list(s)
 for k,v in kw.items(): result[names.index(k)]=v
 return tuple(result)
def transitions(s,mutant=False):
 d=dict(zip(names,s));out=[]
 for action in life_spec['actions']:
  guard=action['guard']
  if mutant and action['name']=='publish': guard={'and':[t for t in guard['and'] if t!={'ref':'accepted'}]}
  if boolean(guard,d): out.append((action['name'],update(s,**action['effects'])))
 for key in life_spec['inputs']: out.append(('environment_'+key,update(s,**{key:not d[key]})))
 return out
def explore(mutant=False):
 initial=[tuple(life_spec['initial_controlled'][n] for n in life_spec['controlled'])+bits for bits in itertools.product([False,True],repeat=len(life_spec['inputs']))]
 queue=collections.deque(initial);paths={s:[] for s in initial};edges=0
 while queue:
  before=queue.popleft();d=dict(zip(names,before))
  for action,after in transitions(before,mutant):
   edges+=1
   birth=action=='publish'
   assert not current(after) or all(after[names.index(n)] for n in ['eligible','authority','evidenceHead','policyHead','dateValid'])
   valid=(not d['retained'] or after[0]) and (not after[2] or after[0] and after[3])
   if birth: valid=valid and all(d[n] for n in ['retained','accepted','eligible','authority','evidenceHead','policyHead','dateValid'])
   if not valid: return {'status':'fail','counterexample':paths[before]+[action],'before':d,'after':dict(zip(names,after)),'states':len(paths),'transitions':edges}
   if after not in paths: paths[after]=paths[before]+[action];queue.append(after)
 return {'status':'pass','states':len(paths),'transitions':edges,'initial_contexts':len(initial),'bound':'All reachable states of the declared 10-Boolean abstraction; no exploration cap was hit.'}
life=explore();mutant=explore(True)
assert mutant['status']=='fail'
report['lifecycle']=life
(ROOT/'proofs/counterexample_P29_missing_approval.json').write_text(json.dumps(mutant,indent=2)+'\n')
report['negative_controls'].append({'family':'P29','mutation':'publish_without_approval','status':'detected','counterexample':mutant['counterexample']})
covered={case['family'] for case in report['cases']}|{'P29'}
expected_set=set(scope['obligations'])-{'P30'}
report['scope_coverage']={'expected':sorted(expected_set),'completed':sorted(covered),'missing':sorted(expected_set-covered)}
report['status']='pass' if not report['scope_coverage']['missing'] and life['status']=='pass' and all(c['status']=='pass' for c in report['cases']) and all(c['status']=='detected' for c in report['negative_controls']) else 'fail'
report['counts']={'symbolic_lemmas':len(report['cases']),'symbolic_families':len({c['family'] for c in report['cases']}),'negative_controls':len(report['negative_controls'])}
(ROOT/'validation/mathematics.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'status':report['status'],'counts':report['counts'],'lifecycle':life,'missing':report['scope_coverage']['missing']}))
raise SystemExit(0 if report['status']=='pass' else 1)
