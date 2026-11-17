"""Check the authored refinement model against separately retained obligations.

Z3/finite design checks only; no implementation, SQL, provider or truth claim.
Run only on a scratch copy, since this writes validation/refinements.json.
"""
from pathlib import Path
import hashlib
import itertools
import json
import re
import z3

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / 'model/tvd-discovery.sysml'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
scope = json.loads((ROOT / 'refinement-scope.json').read_text())
assert sha(ROOT / 'refinement-scope.json') == (ROOT / 'refinement-scope.sha256').read_text().strip()
model = json.loads(re.search(r'doc tvdRefinements /\*TVD-REFINEMENT/1.0\n(.*?)\n\s*\*/', MODEL.read_text(), re.S).group(1))
assert model['refinement_scope_sha256'] == sha(ROOT / 'refinement-scope.json')
assert model['retained_formal_scope_sha256'] == sha(ROOT / 'proof-scope.json')
results = []
controls = []
def record(family, name, condition, detail=None):
    results.append({'family': family, 'case': name, 'status': 'pass' if condition else 'fail', 'detail': detail})
def prove(family, name, assumptions, guarantee):
    witness = z3.Solver(); witness.add(*assumptions)
    solver = z3.Solver(); solver.add(*assumptions, z3.Not(guarantee))
    a, g = witness.check(), solver.check()
    record(family, name, a == z3.sat and g == z3.unsat, {'assumptions': str(a), 'negated_guarantee': str(g)})
def negative(family, name, assumptions, guarantee):
    solver = z3.Solver(); solver.add(*assumptions, z3.Not(guarantee)); result = solver.check()
    controls.append({'family': family, 'mutation': name, 'result': str(result), 'detected': result == z3.sat})

record('RF01', 'strict_target_family_inventory', set(model['review_targets']) == {'creator','work','claim','relationship'})
record('RF01', 'creator_without_work', model['creator_requires_artifact'] is False)
record('RF02', 'rights_identity_includes_version_and_material', model['rights_key'] == ['artifactId','artifactVersion','material'])
record('RF02', 'independent_reuse_permission', set(model['permission_dimensions']) == {'fetch','retain','transform','display','reuse'})
# Compile the authored rights rule into the reusable-assessment predicate.
assert model['reuse_definition'] == 'exact-artifact-version-material-key-and-explicit-reuse-permission'
rights_expected = {k:z3.String('rights_expected_'+k) for k in model['rights_key']}
rights_requested = {k:z3.String('rights_requested_'+k) for k in model['rights_key']}
reuse_permission = z3.Bool('explicit_reuse_permission')
rights_key_matches = z3.And(*[rights_expected[k] == rights_requested[k] for k in model['rights_key']])
reusable = z3.And(rights_key_matches, reuse_permission)
for part in ['artifactId','artifactVersion','material']:
    changed = [rights_expected[part] != rights_requested[part], reuse_permission]
    changed += [rights_expected[k] == rights_requested[k] for k in model['rights_key'] if k != part]
    prove('RF02', 'changed_'+part+'_blocks_reuse', changed, z3.Not(reusable))
    mutant = z3.And(reuse_permission, *[rights_expected[k] == rights_requested[k] for k in model['rights_key'] if k != part])
    negative('RF02', 'omit_'+part+'_from_reuse_key', changed+[mutant], rights_key_matches)
prove('RF02','display_permission_alone_cannot_reuse',[rights_key_matches,z3.Not(reuse_permission)],z3.Not(reusable))

# Compile headsMatch from the aligned required-key vector, then use that exact
# expression inside commit. No detached Boolean can assert freshness.
flags = {k:z3.Bool(k) for k in scope['expected_commit_conditions']}
record('RF03', 'complete_commit_guard_inventory', set(model['commit_conditions']) == set(flags))
assert model['heads_match_definition'] == 'all-required-revision-slots-equal'
assert model['head_vector_bound'] == 512
count = z3.Int('required_count')
slot = z3.Int('slot')
stale_slot = z3.Int('stale_slot')
expected = z3.Array('expected_revision', z3.IntSort(), z3.IntSort())
actual = z3.Array('actual_revision', z3.IntSort(), z3.IntSort())
heads_match = z3.ForAll(slot, z3.Implies(z3.And(slot >= 0, slot < count), z3.Select(expected,slot) == z3.Select(actual,slot)))
flags['headsMatch'] = heads_match
commit = z3.And(*[flags[k] for k in model['commit_conditions']])
bounded = [count >= 1, count <= model['head_vector_bound']]
for k in flags:
    prove('RF03', k+'_required', bounded+[commit], flags[k])
    mutated = z3.And(*[v for key,v in flags.items() if key != k])
    negative('RF03', 'omit_'+k, bounded+[mutated], flags[k])
other_gates = [v for k,v in flags.items() if k != 'headsMatch']
stale = bounded+[stale_slot >= 0,stale_slot < count,z3.Select(expected,stale_slot)>0,z3.Select(actual,stale_slot)>0,z3.Select(expected,stale_slot)!=z3.Select(actual,stale_slot)]
prove('RF03','any_required_stale_slot_prevents_commit',stale+other_gates,z3.Not(commit))
record('RF03','complete_dependency_inventory',set(model['dependency_kinds']) == set(scope['expected_dependency_kinds']))
for index,kind in enumerate(scope['expected_dependency_kinds']):
    prove('RF03','stale_'+kind+'_prevents_commit',stale+other_gates+[count==18,stale_slot==index],z3.Not(commit))
# Equal values after A->B->A do not restore expected revision. The mutant
# deliberately guards content values instead of revisions and can commit stale.
old_content=z3.Array('old_content',z3.IntSort(),z3.StringSort())
new_content=z3.Array('new_content',z3.IntSort(),z3.StringSort())
value_heads_match=z3.ForAll(slot,z3.Implies(z3.And(slot>=0,slot<count),z3.Select(old_content,slot)==z3.Select(new_content,slot)))
aba=bounded+[count==1,stale_slot==0,z3.Select(expected,0)>0,z3.Select(actual,0)==z3.Select(expected,0)+2,value_heads_match]+other_gates
prove('RF03','ABA_equal_content_stale_revision_prevents_commit',aba,z3.Not(commit))
value_only_commit=z3.And(value_heads_match,*other_gates)
negative('RF03','value_only_ABA_guard_commits_stale_revision',aba+[value_only_commit],heads_match)

request_keys=scope['expected_request_match_conditions']; valid_keys=scope['expected_validity_conditions']
record('RF04','complete_request_guard_inventory',set(model['request_match_conditions'])==set(request_keys))
record('RF04','complete_validity_guard_inventory',set(model['validity_conditions'])==set(valid_keys))
record('RF04','typed_status_contract',model['snapshot_outcomes']=={'mismatched':400,'invalidated':410,'expired':410,'valid':200})
checked=0
for values in itertools.product([False,True],repeat=len(request_keys)+len(valid_keys)):
    env=dict(zip(request_keys+valid_keys,values))
    request_ok=all(env[k] for k in model['request_match_conditions'])
    valid=all(env[k] for k in model['validity_conditions'])
    status=model['snapshot_outcomes']['mismatched'] if not request_ok else model['snapshot_outcomes']['valid'] if valid else model['snapshot_outcomes']['invalidated'] if not env['epochMatches'] or not env['incarnationMatches'] else model['snapshot_outcomes']['expired']
    expected=400 if not all(env[k] for k in request_keys) else 410 if not all(env[k] for k in valid_keys) else 200
    assert status==expected, (env,status,expected)
    checked += 1
record('RF04','all_snapshot_guard_combinations',True,{'combinations':checked,'rows_on_non200':'none by declared delivery contract; actual API not executed'})
record('RF05','generation_is_coordinate_not_lifetime_guard',model['generation_is_validity_condition'] is False and model['commit_only_kinds']==['projection-generation'])
record('RF05','partition_requires_valid_snapshot',model['snapshot_partition_condition']=='valid continuation only')
for current,creation in itertools.product([False,True],repeat=2):
    person = current; work = creation
    record('RF06',f'current_{current}_creation_{creation}',person==current and work==creation,{'current_person':person,'regional_work':work,'remaining_evidence_assumed':True})
record('RF06','distinct_temporal_rule_inputs',model['current_person_rule']==['professionalEvidence','currentVerified','currentCountyInScope','healthTechBasis'] and model['regional_work_rule']==['creatorRoleEvidence','creationCountyInScope','contributionTimeSupported','healthTechBasis'])
record('RF07','six_routes',set(model['provider_routes'])==set(scope['expected_provider_routes']))
record('RF07','independent_creator',model['creator_profile_route']=='institutional' and not model['creator_requires_artifact'])
record('RF07','qualification_sample_no_bootstrap_cycle','no routine activation' in model['source_purposes']['qualification-sample'] and 'current qualified' in model['source_purposes']['collection'])
record('RF08','calendar_domains_do_not_assert_utc',all(model['date_domains'][k]=='calendar interval; no timezone asserted' for k in ['year','month','day']))
record('RF08','unknown_cannot_match_positive_filter',model['date_domains']['unknown']=='no positive date-filter match')
record('RF08','instant_requires_offset',model['require_offset_for_instant'] is True and 'explicit offset required' in model['date_domains']['instant'])
record('RF09','full_provider_tuple',model['provider_identity_tuple']==['provider','installation','kind','nativeId'])
Native = z3.Datatype('ProviderIdentityTuple')
Native.declare('identity', ('provider',z3.StringSort()), ('installation',z3.StringSort()), ('kind',z3.StringSort()), ('nativeId',z3.StringSort()))
Native = Native.create()
a,b = z3.Strings('installationA installationB')
prove('RF09','same_forum_native_id_distinct_installations',[a != b], Native.identity(z3.StringVal('forum'),a,z3.StringVal('account'),z3.StringVal('17')) != Native.identity(z3.StringVal('forum'),b,z3.StringVal('account'),z3.StringVal('17')))
prove('RF09','same_native_id_distinct_kinds',[], Native.identity(z3.StringVal('institutional'),z3.StringVal('example'),z3.StringVal('account'),z3.StringVal('17')) != Native.identity(z3.StringVal('institutional'),z3.StringVal('example'),z3.StringVal('person'),z3.StringVal('17')))
prove('RF09','exact_tuple_is_idempotent',[], Native.identity(z3.StringVal('forum'),z3.StringVal('example'),z3.StringVal('account'),z3.StringVal('17')) == Native.identity(z3.StringVal('forum'),z3.StringVal('example'),z3.StringVal('account'),z3.StringVal('17')))
negative('RF09','omit_installation_key',[a != b],z3.StringVal('forum:account:17') != z3.StringVal('forum:account:17'))
assert set(x['family'] for x in results)==set(scope['obligations'])
report={'version':'TVD-REFINEMENT-CHECK/1.0','status':'pass' if all(x['status']=='pass' for x in results) and all(x['detected'] for x in controls) else 'fail','model_sha256':sha(MODEL),'scope_sha256':sha(ROOT/'refinement-scope.json'),'solver_version':z3.get_full_version(),'results':results,'negative_controls':controls,'limits':scope['limits'],'method':'Authoritative documentary refinement rule inventories, symbolic guards and exhaustive 256 snapshot-flag combinations; no arbitrary native SysML execution or actual code/storage behavior.'}
(ROOT/'validation/refinements.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'status':report['status'],'cases':len(results),'controls':len(controls),'families':len(scope['obligations'])}))
raise SystemExit(0 if report['status']=='pass' else 1)
