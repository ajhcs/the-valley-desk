import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getPlatformProxy, unstable_splitSqlQuery } from 'wrangler';
import { createDiscoveryEvidenceStore } from '../src/ingest/discovery-evidence-store';
import { putDiscoveryEntity } from '../src/ingest/discovery-store';
import type { D1DatabaseLike } from '../src/ingest/persistence';

const time = '2026-11-14T12:00:00Z';
const later = '2026-11-14T12:05:00Z';
const ref = (id: string, revision = 1) => ({ id, revision });
const artifactScope = (artifactId:string) => ({kind:'artifact' as const,artifactId,artifactVersion:'v1',material:'text' as const});
const context = (operationId: string, expectedRevision: number | null = null) => ({ operationId, expectedRevision, capabilityToken: 'synthetic-capability' });
const digest = (v: string | Uint8Array) => createHash('sha256').update(v).digest('hex');

// Isolated synthetic D1 only; capability resolver is a fixture, not authentication.
test('WP05 evidence and provenance acceptance against local D1', { timeout: 120_000 }, async t => {
  const proxy = await getPlatformProxy<{ DISCOVERY_TEST_DB: D1DatabaseLike }>({
    configPath: fileURLToPath(new URL('./fixtures/discovery-d1/wrangler.jsonc', import.meta.url)), envFiles: [], persist: false, remoteBindings: false,
  });
  t.after(() => proxy.dispose());
  const db = proxy.env.DISCOVERY_TEST_DB;
  const migrations = new URL('../migrations/', import.meta.url);
  const names = readdirSync(migrations).filter(n => /^00(?:[0-3]\d|4[0-2])_.*\.sql$/.test(n)).sort();
  assert.equal(names.length, 42, 'all migrations 0001–0042 are required');
  for (const name of names) await db.batch(unstable_splitSqlQuery(readFileSync(new URL(name, migrations), 'utf8')).map(sql => db.prepare(sql)));
  let currentTime = time;
  const store = createDiscoveryEvidenceStore(db, {
    now: () => currentTime,
    resolveCapability: async (token, request) => {
      assert.equal(token, 'synthetic-capability');
      return { receiptId: 'synthetic:receipt', principalId: 'synthetic:reviewer', authenticationContextId: 'synthetic:auth', ...request, expiresAt: '2099-01-01T00:00:00Z', minimalAuditRetention: 'allow' as const };
    },
  });
  const dump = async () => {
    const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'discovery_%' ORDER BY name").all<{ name: string }>()).results!;
    const rows: Record<string, unknown> = {};
    for (const { name } of tables) rows[name] = (await db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()).results;
    return rows;
  };
  const report: Record<string, unknown> = { runtime: process.version, synthetic: true, database: 'isolated-local-D1', migrations: names, cases: {} };
  const cases = report.cases as Record<string, unknown>;
  const record = (id: string, kind: string, value: string, rights?: object) => ({ id, revision: 1, kind, value, ...(rights ? { rights } : {}) });
  for (const c of [record('enrollment:one','enrollment','active'), record('configuration:one','configuration','v1'),
    {...record('permission:one','permission','allow'),permission:{enrollment:ref('enrollment:one'),configuration:ref('configuration:one'),materialScope:artifactScope('artifact:one'),fetch:true,retain:true,transform:true}}, record('parser:one','parser','text-or-json-v1'),
    record('normalizer:one','normalizer','utf8-nfc-lf-v1'), record('policy:one','policy','v1'),
    record('rights:one','rights','synthetic-permission', { materialScope:artifactScope('artifact:one'),retain:true,transform:true })]) {
    await store.appendControl(context(`control:${c.id}`), c as never);
  }
  // Acceptance cases follow after the common fixtures.
  const origin = { id:'origin:one', revision:1, originalWorkId:'work:original', members:['mirror:one','mirror:two','mirror:three'], memberEndpoints:{'mirror:one':'https://example.test/mirror/one','mirror:two':'https://example.test/mirror/two','mirror:three':'https://example.test/mirror/three'}, retentionRights:[ref('rights:one')], policy:ref('policy:one'), reason:'Synthetic mirrors of one original' };
  await store.appendOrigin(context('origin:one:1'), origin);
  const base = { enrollment:ref('enrollment:one'), configuration:ref('configuration:one'), permission:ref('permission:one'),
    rights:ref('rights:one'), origin:ref('origin:one'), parser:ref('parser:one'), normalizer:ref('normalizer:one'),
    materialScope:artifactScope('artifact:one'), originMemberId:'mirror:one', actualEndpoint:'https://example.test/mirror/one',
    capturedAt:time,byteKind:'captured-body-bytes' as const,format:'text' as const };
  const raw = 'Before\r\nCafe\u0301 😀 quoted\r\nAfter';
  const normalized = 'Before\nCafé 😀 quoted\nAfter';
  const bytes = new TextEncoder().encode(raw);
  const capture = { ...base,id:'representation:one',revision:1,bytes };
  const quote = '😀 quoted', start = normalized.indexOf(quote);
  const evidence = { id:'evidence:one',revision:1,representation:ref('representation:one'),selector:{kind:'text-span' as const,start,end:start+quote.length,quote} };
  await t.test('source-response intake requires issued binding and provisional origin remains unresolved', async () => {
    await store.appendControl(context('control:intake:enrollment'),record('enrollment:intake','enrollment','active') as never);
    await store.appendControl(context('control:intake:configuration'),record('configuration:intake','configuration','v1') as never);
    const scope = {kind:'source-response' as const,sourceId:'source:intake',installation:'installation:intake',scopeId:'scope:intake',enrollment:ref('enrollment:intake'),configuration:ref('configuration:intake'),endpointConstructor:'constructor:intake',endpointTemplateSha256:digest('template'),requestScopeSha256:digest('query'),material:'metadata' as const};
    const rights = {id:'rights:intake',revision:1,kind:'rights',value:'synthetic',rights:{materialScope:scope,retain:true,transform:true}};
    const permission = {id:'permission:intake',revision:1,kind:'permission',value:'synthetic',permission:{enrollment:ref('enrollment:intake'),configuration:ref('configuration:intake'),materialScope:scope,fetch:true,retain:true,transform:true}};
    await store.appendControl(context('control:intake:rights'),rights as never);
    await store.appendControl(context('control:intake:permission'),permission as never);
    const requestSha256 = digest('issued-request'), issuedRequest = ref('issued:intake'), endpoint = 'https://example.test/search?q=synthetic';
    let tamper: ((binding:any)=>any) | null = null;
    const intake = createDiscoveryEvidenceStore(db, {
      now:()=>currentTime,
      resolveCapability:async(token,request)=>{ assert.equal(token,'synthetic-capability'); return {receiptId:'synthetic:receipt',principalId:'synthetic:reviewer',authenticationContextId:'synthetic:auth',...request,expiresAt:'2099-01-01T00:00:00Z',minimalAuditRetention:'allow' as const}; },
      resolveIssuedSourceRequest:async(token,request)=>{
        assert.equal(token,'synthetic-issued-binding');
        const binding = {...request,issuedRequest,requestSha256,materialScope:scope,actualEndpoint:endpoint,originMemberId:'mirror:intake',permission:ref('permission:intake'),rights:ref('rights:intake'),expiresAt:'2099-01-01T00:00:00Z'};
        return tamper ? tamper(binding) : binding;
      },
    });
    const issued = {id:issuedRequest.id,revision:1,requestSha256,materialScope:scope,actualEndpoint:endpoint,originMemberId:'mirror:intake',permission:ref('permission:intake'),rights:ref('rights:intake'),expiresAt:'2099-01-01T00:00:00Z',requestBindingToken:'synthetic-issued-binding'};
    const noResolverBefore = await dump();
    await assert.rejects(store.appendIssuedSourceRequest(context('issued:missing-resolver'),issued));
    assert.deepEqual(await dump(),noResolverBefore);
    await intake.appendIssuedSourceRequest(context('issued:intake'),issued);
    const origin = {id:'origin:intake',revision:1,status:'provisional-source-response' as const,originalWorkId:null,materialScope:scope,issuedRequest,requestSha256,members:['mirror:intake'],memberEndpoints:{'mirror:intake':endpoint},retentionRights:[ref('rights:intake')],policy:ref('policy:one'),reason:'Synthetic provisional intake',requestBindingToken:'synthetic-issued-binding'};
    await intake.appendOrigin(context('origin:intake'),origin);
    const response = {...base,id:'representation:intake',revision:1,enrollment:ref('enrollment:intake'),configuration:ref('configuration:intake'),permission:ref('permission:intake'),rights:ref('rights:intake'),origin:ref('origin:intake'),originMemberId:'mirror:intake',materialScope:scope,actualEndpoint:endpoint,issuedRequest,requestSha256,requestBindingToken:'synthetic-issued-binding',bytes:new TextEncoder().encode('{"items":[]}'),format:'json' as const};
    for (const [label,change] of [
      ['material',(b:any)=>({...b,materialScope:{...b.materialScope,material:'text'}})],
      ['source',(b:any)=>({...b,materialScope:{...b.materialScope,sourceId:'source:wrong'}})],
      ['configuration',(b:any)=>({...b,materialScope:{...b.materialScope,configuration:ref('configuration:intake',2)}})],
      ['template',(b:any)=>({...b,materialScope:{...b.materialScope,endpointTemplateSha256:digest('other-template')}})],
      ['query',(b:any)=>({...b,materialScope:{...b.materialScope,requestScopeSha256:digest('other-query')}})],
      ['request',(b:any)=>({...b,requestSha256:digest('other-request')})],
      ['endpoint',(b:any)=>({...b,actualEndpoint:'https://example.test/other'})],
      ['null',()=>null],
    ] as const) {
      tamper = change; const before = await dump();
      await assert.rejects(intake.appendRepresentation(context(`capture:intake:bad:${label}`),{...response,id:`representation:intake:bad:${label}`}));
      assert.deepEqual(await dump(),before);
    }
    tamper = null;
    const entityCount = await db.prepare('SELECT count(*) AS n FROM discovery_catalog_entities').first<{n:number}>();
    assert.equal(entityCount?.n,0);
    await intake.appendRepresentation(context('capture:intake'),response);
    await intake.appendEvidence(context('evidence:intake'),{id:'evidence:intake',revision:1,representation:ref('representation:intake'),selector:{kind:'json-pointer',pointer:'/items',value:[]}});
    assert.deepEqual(await db.prepare('SELECT count(*) AS n FROM discovery_catalog_entities').first(),entityCount);
    await assert.rejects(intake.distinctOriginCount([ref('evidence:intake')]),/unresolved-provenance/);
    const revokedScope = {...scope,sourceId:'source:intake-revoked',requestScopeSha256:digest('revoked-query')};
    await store.appendControl(context('control:intake:revoked-rights'),{...rights,id:'rights:intake-revoked',rights:{...rights.rights,materialScope:revokedScope}} as never);
    await store.appendControl(context('control:intake:revoked-permission'),{...permission,id:'permission:intake-revoked',permission:{...permission.permission,materialScope:revokedScope}} as never);
    const revokedRequest = ref('issued:intake-revoked'), revokedDigest = digest('issued-revoked'), revokedEndpoint = 'https://example.test/search?q=revoked';
    tamper = b => ({...b,issuedRequest:revokedRequest,requestSha256:revokedDigest,materialScope:revokedScope,actualEndpoint:revokedEndpoint,originMemberId:'mirror:intake-revoked',permission:ref('permission:intake-revoked'),rights:ref('rights:intake-revoked')});
    await intake.appendIssuedSourceRequest(context('issued:intake-revoked'),{...issued,id:revokedRequest.id,requestSha256:revokedDigest,materialScope:revokedScope,actualEndpoint:revokedEndpoint,originMemberId:'mirror:intake-revoked',permission:ref('permission:intake-revoked'),rights:ref('rights:intake-revoked')});
    await intake.appendOrigin(context('origin:intake-revoked'),{...origin,id:'origin:intake-revoked',materialScope:revokedScope,issuedRequest:revokedRequest,requestSha256:revokedDigest,members:['mirror:intake-revoked'],memberEndpoints:{'mirror:intake-revoked':revokedEndpoint},retentionRights:[ref('rights:intake-revoked')]});
    await store.revokeRetention(context('revoke:intake-pristine'),{id:'revoke:intake-pristine',revision:1,rights:ref('rights:intake-revoked'),policy:ref('policy:one'),reason:'Synthetic revoked before capture'});
    const revocationBefore = await dump();
    await assert.rejects(store.appendControl(context('rights:intake:regrant'),{...rights,id:'rights:intake:regrant',rights:{...rights.rights,materialScope:revokedScope}} as never));
    assert.deepEqual(await dump(),revocationBefore);
    await assert.rejects(store.appendControl(context('permission:intake:regrant'),{...permission,id:'permission:intake:regrant',permission:{...permission.permission,materialScope:revokedScope}} as never));
    assert.deepEqual(await dump(),revocationBefore);
    await assert.rejects(intake.appendOrigin(context('origin:intake:regrant'),{...origin,id:'origin:intake:regrant',materialScope:revokedScope,issuedRequest:revokedRequest,requestSha256:revokedDigest,members:['mirror:intake-revoked'],memberEndpoints:{'mirror:intake-revoked':revokedEndpoint},retentionRights:[ref('rights:intake:regrant')],reason:'forbidden-source-rationale-7462'}));
    assert.deepEqual(await dump(),revocationBefore);
    assert.equal(JSON.stringify(await dump()).includes('forbidden-source-rationale-7462'),false);
    await intake.observeRepresentation(context('observation:intake:unrelated'),{id:'observation:intake:unrelated',revision:1,representation:ref('representation:intake'),observedAt:later});
    const deniedBefore = await dump();
    await assert.rejects(intake.appendRepresentation(context('capture:intake:revoked'),{...response,id:'representation:intake:revoked',materialScope:revokedScope,permission:ref('permission:intake-revoked'),rights:ref('rights:intake-revoked'),origin:ref('origin:intake-revoked'),originMemberId:'mirror:intake-revoked',actualEndpoint:revokedEndpoint,issuedRequest:revokedRequest,requestSha256:revokedDigest}));
    assert.deepEqual(await dump(),deniedBefore);
    tamper = null;
    await store.appendControl(context('control:intake:configuration:2',1),{...record('configuration:intake','configuration','v2'),revision:2} as never);
    const stale = await dump();
    await assert.rejects(intake.appendRepresentation(context('capture:intake:stale'),{...response,id:'representation:intake:stale'}));
    assert.deepEqual(await dump(),stale);
    await store.revokeRetention(context('revoke:intake'),{id:'revoke:intake',revision:1,rights:ref('rights:intake'),policy:ref('policy:one'),reason:'Synthetic source grant withdrawn'});
    assert.equal((await store.readRevision('representation','representation:intake',1))?.tombstoned,true);
    const revoked = await dump();
    try { const replay = await intake.appendRepresentation(context('capture:intake'),response); assert.equal(replay.tombstoned,true); } catch { /* refusal preserves revocation */ }
    assert.deepEqual(await dump(),revoked);
    cases.sourceResponse = { noDiscoveredEntities:true,issuedBindingRequired:true,mismatchesRejected:true,provisionalOriginUnresolved:true,staleConfigurationRejected:true,revocationRemovesResponse:true,revokedGrantRejectsFreshCapture:true,replayCannotResurrect:true };
  });
  await putDiscoveryEntity(db, { operationId:'entity:person', expectedRevision:null,
    entity:{ schemaVersion:'discovery-v1', id:'person:one', revision:1, kind:'person', displayName:'Synthetic person' } });
  await t.test('AC01: evidence remains bound to exact retained revision and hashes', async () => {
    const ack = await store.appendRepresentation(context('capture:one'),capture);
    assert.equal(ack.committed,true);
    await store.appendEvidence(context('evidence:one'),evidence);
    const original = await store.readRevision('representation','representation:one',1);
    const text = JSON.stringify(original);
    assert.ok(text.includes(digest(bytes)), 'original byte hash retained');
    assert.ok(text.includes(digest(normalized)), 'normalized UTF-8 text hash retained separately');
    assert.notEqual(digest(bytes),digest(normalized));
    const changed = new TextEncoder().encode(raw.replace('After','AftEr'));
    await store.appendRepresentation(context('capture:two',1),{...capture,revision:2,bytes:changed,capturedAt:later});
    assert.deepEqual(await store.readRevision('representation','representation:one',1), original);
    assert.ok(JSON.stringify(await store.readRevision('representation','representation:one',2)).includes(digest(changed)));
    assert.ok(JSON.stringify(await store.readRevision('evidence','evidence:one',1)).includes('representation:one'));
    await store.appendEvidence(context('evidence:historical'),{...evidence,id:'evidence:historical'});
    assert.ok(await store.readRevision('evidence','evidence:historical',1));
    cases.AC01 = { originalBytesSha256:digest(bytes), normalizedSha256:digest(normalized), changedBytesSha256:digest(changed), originalRevision:1, changedRevision:2 };
  });
  await t.test('AC02: invalid UTF-16 spans and structured pointers leave all rows unchanged', async () => {
    const rejections: unknown[] = [];
    for (const [label, selector] of [
      ['wrong quote',{kind:'text-span',start,end:start+quote.length,quote:'😀 wrong'}],
      ['inside surrogate',{kind:'text-span',start:start+1,end:start+2,quote:normalized.slice(start+1,start+2)}],
      ['out of range',{kind:'text-span',start:999,end:1000,quote:'x'}],
    ] as const) {
      const before = await dump();
      await assert.rejects(store.appendEvidence(context(`invalid:${label.replaceAll(' ','-')}`),{...evidence,id:`invalid:${label.replaceAll(' ','-')}`,selector}));
      const after = await dump(); assert.deepEqual(after,before);
      rejections.push({label,counts:Object.fromEntries(Object.entries(before).map(([k,v])=>[k,(v as unknown[]).length]))});
    }
    await store.appendRepresentation(context('capture:json'),{...base,id:'representation:json',revision:1,format:'json',bytes:new TextEncoder().encode('{"items":[{"name":"Alpha"}],"count":5,"empty":null,"a/b~c":"escaped","__proto__":{"own":"owned"}}')});
    const structured = { id:'evidence:json',revision:1,representation:ref('representation:json'),selector:{kind:'json-pointer' as const,pointer:'/items/0/name',value:'Alpha'} };
    await store.appendEvidence(context('evidence:json'),structured);
    for (const [label,pointer,value] of [['number','/count',5],['null','/empty',null],['escaped','/a~1b~0c','escaped'],['own-proto','/__proto__/own','owned']] as const) {
      await store.appendEvidence(context(`json:valid:${label}`),{...structured,id:`json:valid:${label}`,selector:{kind:'json-pointer',pointer,value}});
    }
    for (const [label,pointer,value] of [['missing','/items/1/name','Alpha'],['mismatch','/items/0/name','Beta'],['number-string','/count','5'],['null-string','/empty','null'],['inherited','/constructor/name','Object'],['bad-escape','/a~2b','escaped']] as const) {
      const before = await dump();
      await assert.rejects(store.appendEvidence(context(`json:${label}`),{...structured,id:`json:${label}`,selector:{kind:'json-pointer',pointer,value}}));
      assert.deepEqual(await dump(),before);
      rejections.push({label,counts:Object.fromEntries(Object.entries(before).map(([k,v])=>[k,(v as unknown[]).length]))});
    }
    await store.appendRepresentation(context('capture:unicode-json'),{...base,id:'representation:unicode-json',revision:1,format:'json',bytes:new TextEncoder().encode('{"é":"composed","e\\u0301":"decomposed"}')});
    for (const [id,pointer,value] of [['composed','/é','composed'],['decomposed','/e\u0301','decomposed']] as const) {
      await store.appendEvidence(context(`evidence:unicode:${id}`),{id:`evidence:unicode:${id}`,revision:1,representation:ref('representation:unicode-json'),selector:{kind:'json-pointer',pointer,value}});
    }
    const duplicateBefore = await dump();
    await assert.rejects(store.appendRepresentation(context('capture:duplicate-json'),{...base,id:'representation:duplicate-json',revision:1,format:'json',bytes:new TextEncoder().encode('{"a":1,"\\u0061":2}')}),/duplicate-json-key/);
    assert.deepEqual(await dump(),duplicateBefore);
    await store.appendRepresentation(context('capture:json-exponent'),{...base,id:'representation:json-exponent',revision:1,format:'json',bytes:new TextEncoder().encode('{"n":1e3}')});
    await store.appendEvidence(context('evidence:json-exponent'),{id:'evidence:json-exponent',revision:1,representation:ref('representation:json-exponent'),selector:{kind:'json-pointer',pointer:'/n',value:1000}});
    for (const [label,number] of [['integer','9007199254740993'],['decimal','1.0000000000000001']] as const) {
      const before = await dump();
      await assert.rejects(store.appendRepresentation(context(`capture:lossy:${label}`),{...base,id:`representation:lossy:${label}`,revision:1,format:'json',bytes:new TextEncoder().encode(`{\"n\":${number}}`)}));
      assert.deepEqual(await dump(),before);
    }
    cases.AC02 = { rejections };
  });
  await t.test('AC03: idempotent capture and distinct observation', async () => {
    const before = await dump();
    const replay = await store.appendRepresentation(context('capture:one'),capture);
    assert.equal(replay.committed,true); assert.equal(replay.revision,1);
    assert.deepEqual(await dump(),before);
    await assert.rejects(store.appendRepresentation(context('capture:one'),{...capture,bytes:new TextEncoder().encode('conflict')}));
    assert.deepEqual(await dump(),before);
    await assert.rejects(store.appendRepresentation(context('capture:unchanged',2),{...capture,revision:3,bytes:new TextEncoder().encode(raw.replace('After','AftEr')),capturedAt:later}),/discovery-evidence-use-observation/);
    assert.deepEqual(await dump(),before);
    await store.observeRepresentation(context('observation:later'),{id:'observation:later',revision:1,representation:ref('representation:one'),observedAt:later});
    const observed = await store.readRevision('observation','observation:later',1);
    assert.ok(JSON.stringify(observed).includes(later));
    cases.AC03 = { replay, observed };
  });
  await t.test('AC04: three mirrors share one origin', async () => {
    const refs = [ref('evidence:one')];
    for (const [n,endpoint] of [['two','https://example.test/mirror/two'],['three','https://example.test/mirror/three']] as const) {
      await store.appendRepresentation(context(`capture:mirror:${n}`),{...capture,id:`representation:mirror:${n}`,originMemberId:`mirror:${n}`,actualEndpoint:endpoint});
      const e = {...evidence,id:`evidence:mirror:${n}`,representation:ref(`representation:mirror:${n}`)};
      await store.appendEvidence(context(`evidence:mirror:${n}`),e); refs.push(ref(e.id));
    }
    assert.equal(await store.distinctOriginCount(refs),1);
    cases.AC04 = { mirrors:3, distinctOrigins:1, originLedger:await store.readRevision('origin','origin:one',1) };
  });
  const claim = (id:string,value:string) => ({id,revision:1,subject:{kind:'person' as const,id:'person:one'},subjectRevision:1,predicate:'affiliation',value,uncertainty:'asserted' as const,validFrom:null,validUntil:null,evidence:[ref('evidence:one')],policy:ref('policy:one')});
  await t.test('AC05: contradictory claims and correction retain history', async () => {
    await store.appendClaim(context('claim:a'),claim('claim:a','Organization A'));
    await store.appendClaim(context('claim:b'),claim('claim:b','Organization B'));
    const first = {id:'decision:affiliation',revision:1,claim:ref('claim:a'),decision:'accepted' as const,reason:'Private decision canary: synthetic-never-retain-9823',policy:ref('policy:one'),decidedAt:time};
    const firstAck = await store.appendDecision(context('decision:one'),first);
    const corrected = {...first,revision:2,claim:ref('claim:b'),reason:'Synthetic correction',supersedes:ref('decision:affiliation'),decidedAt:later};
    const secondAck = await store.appendDecision(context('decision:two',1),corrected);
    const before = await dump();
    assert.deepEqual(await store.appendDecision(context('decision:two',1),corrected),secondAck);
    assert.deepEqual(await dump(),before);
    for (const [kind,id,revision] of [['claim','claim:a',1],['claim','claim:b',1],['decision','decision:affiliation',1],['decision','decision:affiliation',2]] as const) assert.ok(await store.readRevision(kind,id,revision));
    const scope = await db.prepare("SELECT scope_key FROM discovery_evidence_decision_scopes WHERE decision_id='decision:affiliation'").first<{scope_key:string}>();
    assert.ok(scope);
    await assert.rejects(db.prepare('INSERT OR REPLACE INTO discovery_evidence_decision_scopes VALUES(?,?)').bind(scope.scope_key,'decision:forged').run());
    assert.deepEqual(await dump(),before);
    cases.AC05 = { firstAck,secondAck, bothClaimsAndDecisionsInspectable:true,scopeReplacementRejected:true };
  });
  await t.test('AC04: reviewed origin merge and split invalidate dependent decisions', async () => {
    const mkOrigin = (id:string,work:string,members:string[],revision=1) => ({id,revision,originalWorkId:work,members,memberEndpoints:Object.fromEntries(members.map(m=>[m,`https://example.test/${m.replace(':','/')}`])),retentionRights:[ref('rights:one')],policy:ref('policy:one'),reason:'Synthetic reviewed origin ledger',...(members.length===0?{retired:true}:{})});
    await store.appendOrigin(context('origin:merge:a:1'),mkOrigin('origin:merge:a','work:a',['mirror:a']));
    await store.appendOrigin(context('origin:merge:b:1'),mkOrigin('origin:merge:b','work:b',['mirror:b']));
    const makeEvidence = async (suffix:string,originId:string,originRevision:number,member:string) => {
      const rep = `representation:merge:${suffix}`, ev = `evidence:merge:${suffix}`;
      await store.appendRepresentation(context(`capture:merge:${suffix}`),{...capture,id:rep,origin:ref(originId,originRevision),originMemberId:member,actualEndpoint:`https://example.test/${member.replace(':','/')}`});
      await store.appendEvidence(context(`evidence:merge:${suffix}`),{...evidence,id:ev,representation:ref(rep)});
      return ref(ev);
    };
    const invalidBefore = await dump();
    await assert.rejects(store.appendRepresentation(context('capture:wrong-member'),{...capture,id:'representation:wrong-member',origin:ref('origin:merge:a'),originMemberId:'mirror:b',actualEndpoint:'https://example.test/mirror/b'}));
    assert.deepEqual(await dump(),invalidBefore);
    const ea = await makeEvidence('a1','origin:merge:a',1,'mirror:a'), eb = await makeEvidence('b1','origin:merge:b',1,'mirror:b');
    assert.equal(await store.distinctOriginCount([ea,eb]),2);
    await store.appendClaim(context('claim:merge'),{...claim('claim:merge','Synthetic origin assertion'),predicate:'origin-test',evidence:[ea]});
    await store.appendDecision(context('decision:merge'),{id:'decision:merge',revision:1,claim:ref('claim:merge'),decision:'accepted',reason:'Synthetic corroboration',policy:ref('policy:one'),decidedAt:time});
    await store.appendOrigin(context('origin:merge:b:2',1),mkOrigin('origin:merge:b','work:b',[],2));
    const retiredBefore = await dump();
    await assert.rejects(store.appendRepresentation(context('capture:retired'),{...capture,id:'representation:retired',origin:ref('origin:merge:b',2),originMemberId:'mirror:b',actualEndpoint:'https://example.test/mirror/b'}));
    assert.deepEqual(await dump(),retiredBefore);
    await store.appendOrigin(context('origin:merge:a:2',1),mkOrigin('origin:merge:a','work:a',['mirror:a','mirror:b'],2));
    assert.equal((await store.readRevision('decision','decision:merge',1))?.invalidated,true);
    const mergedA = await makeEvidence('a2','origin:merge:a',2,'mirror:a'), mergedB = await makeEvidence('b2','origin:merge:a',2,'mirror:b');
    assert.equal(await store.distinctOriginCount([mergedA,mergedB]),1);
    assert.ok(JSON.stringify(await store.readRevision('representation','representation:merge:b2',1)).includes('mirror:b'));
    await store.appendOrigin(context('origin:merge:a:3',2),mkOrigin('origin:merge:a','work:a',['mirror:a'],3));
    await store.appendOrigin(context('origin:split:c:1'),mkOrigin('origin:split:c','work:c',['mirror:b']));
    assert.equal((await store.readRevision('evidence',mergedA.id,1))?.invalidated,true);
    const splitA = await makeEvidence('a3','origin:merge:a',3,'mirror:a'), splitB = await makeEvidence('b3','origin:split:c',1,'mirror:b');
    assert.equal(await store.distinctOriginCount([splitA,splitB]),2);
    cases.originRevisions = { before:2, merged:1, split:2, priorDecisionInvalidated:true, priorEvidenceInvalidated:true };
  });
  await t.test('catalog bridge rejects both prior anchors and later consumers atomically', async () => {
    await db.prepare("INSERT INTO discovery_catalog_evidence_refs VALUES('anchor:prior',1)").run();
    let before = await dump();
    await assert.rejects(store.appendEvidence(context('evidence:collision'),{...evidence,id:'anchor:prior'}),/discovery-evidence-catalog-anchor-collision/);
    assert.deepEqual(await dump(),before);
    const payload = JSON.stringify({evidence:[ref('evidence:one')]});
    const statements = [
      db.prepare('INSERT INTO discovery_catalog_decision_refs VALUES(?,?,?)').bind('bridge:decision',1,payload),
      db.prepare('INSERT INTO discovery_catalog_aliases VALUES(?,?,?,?,?)').bind('bridge:alias','person:one','person','alias',payload),
      db.prepare('INSERT INTO discovery_catalog_relation_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind('bridge:relation',1,'affiliation','person:one',1,'person','person:one',1,'person','bridge:decision',1,null,payload),
    ];
    for (const statement of statements) {
      before = await dump();
      await assert.rejects(db.batch([db.prepare("INSERT INTO discovery_catalog_evidence_refs VALUES('bridge:would-leak',1)"),statement]),/discovery-evidence-catalog-bridge-unqualified/);
      assert.deepEqual(await dump(),before);
    }
    cases.catalogBridge = { priorAnchorRejected:true, laterDecisionAliasRelationRejected:true, rollback:true };
  });
  await t.test('stale and late failure roll back the complete D1 batch', async () => {
    await store.appendControl(context('race:initial'),record('policy:race','policy','initial') as never);
    const results = await Promise.allSettled([
      store.appendControl(context('race:a',1),{...record('policy:race','policy','A'),revision:2} as never),
      store.appendControl(context('race:b',1),{...record('policy:race','policy','B'),revision:2} as never),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length,1);
    assert.equal(results.filter(r => r.status === 'rejected').length,1);
    const before = await dump();
    const prefix: D1DatabaseLike = { prepare: sql => db.prepare(sql), batch: statements => db.batch([db.prepare("INSERT INTO discovery_catalog_evidence_refs VALUES('would:leak',1)"),...statements]) };
    const staleStore = createDiscoveryEvidenceStore(prefix, {now:()=>time,resolveCapability:async (_token,request)=>({receiptId:'synthetic:receipt',principalId:'synthetic:reviewer',authenticationContextId:'synthetic:auth',...request,expiresAt:'2099-01-01T00:00:00Z',minimalAuditRetention:'allow'})});
    await assert.rejects(staleStore.appendRepresentation(context('stale:capture',1),{...capture,revision:2,bytes:new TextEncoder().encode('stale')}));
    assert.deepEqual(await dump(),before);
    const broken: D1DatabaseLike = { prepare: sql => db.prepare(sql), batch: statements => db.batch([...statements,db.prepare("INSERT INTO discovery_catalog_evidence_refs VALUES('forced:failure',0)")]) };
    const brokenStore = createDiscoveryEvidenceStore(broken, {now:()=>time,resolveCapability:async (_token,request)=>({receiptId:'synthetic:receipt',principalId:'synthetic:reviewer',authenticationContextId:'synthetic:auth',...request,expiresAt:'2099-01-01T00:00:00Z',minimalAuditRetention:'allow'})});
    await assert.rejects(brokenStore.appendRepresentation(context('failed:capture'),{...capture,id:'representation:failed'}));
    assert.deepEqual(await dump(),before);
    cases.rollback = { rowCounts:Object.fromEntries(Object.entries(before).map(([k,v])=>[k,(v as unknown[]).length])), staleAndFinalFailurePreservedRows:true };
  });
  await t.test('corrupt retained bytes are quarantined even after a payload hash is recomputed', async () => {
    for (const suffix of ['digest-mismatch','rehashed-bad-bytes']) {
      const id = `representation:corrupt:${suffix}`, evidenceId = `evidence:corrupt:${suffix}`;
      await store.appendRepresentation(context(`capture:corrupt:${suffix}`),{...capture,id});
      await store.appendEvidence(context(`evidence:corrupt:${suffix}`),{...evidence,id:evidenceId,representation:ref(id)});
      const old = await db.prepare("SELECT payload_json FROM discovery_evidence_contents WHERE kind='representation' AND id=? AND revision=1").bind(id).first<{payload_json:string}>();
      assert.ok(old);
      const tampered = JSON.parse(old.payload_json);
      tampered.bytes[0] ^= 1;
      const payload = JSON.stringify(tampered);
      const triggerNames = suffix === 'rehashed-bad-bytes' ? ['discovery_evidence_contents_update','discovery_evidence_revisions_update'] : ['discovery_evidence_contents_update'];
      const triggers = await Promise.all(triggerNames.map(name=>db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").bind(name).first<{sql:string}>()));
      assert.ok(triggers.every(Boolean));
      try {
        for (const name of triggerNames) await db.prepare(`DROP TRIGGER ${name}`).run();
        await db.prepare("UPDATE discovery_evidence_contents SET payload_json=? WHERE kind='representation' AND id=? AND revision=1").bind(payload,id).run();
        if (suffix === 'rehashed-bad-bytes') await db.prepare("UPDATE discovery_evidence_revisions SET content_sha256=? WHERE kind='representation' AND id=? AND revision=1").bind(digest(payload),id).run();
      } finally { for (const trigger of triggers) if (trigger) await db.prepare(trigger.sql).run(); }
      const before = await dump();
      const read = await store.readRevision('representation',id,1);
      assert.equal(read?.quarantined,true); assert.equal(read?.usable,false); assert.equal(read?.content,null);
      assert.deepEqual(await dump(),before);
      await assert.rejects(store.appendEvidence(context(`evidence:corrupt:new:${suffix}`),{...evidence,id:`evidence:corrupt:new:${suffix}`,representation:ref(id)}));
      assert.deepEqual(await dump(),before);
      await assert.rejects(store.appendClaim(context(`claim:corrupt:${suffix}`),{...claim(`claim:corrupt:${suffix}`,'Synthetic corrupt claim'),predicate:`corrupt:${suffix}`,evidence:[ref(evidenceId)]}));
      assert.deepEqual(await dump(),before);
    }
    cases.corruption = { alteredPayloadQuarantined:true,rehashedBadBytesQuarantined:true,readPerformedNoWrite:true,dependentWritesRejected:true };
  });
  await t.test('ancestral rights expiry, renewal, scope ownership and expired removal', async () => {
    const seed = async (tag:string,expiresAt?:string) => {
      const artifactId = `artifact:${tag}`, rightsId = `rights:${tag}`, permissionId = `permission:${tag}`, originId = `origin:${tag}`;
      const rights = {...record(rightsId,'rights','synthetic-permission',{materialScope:artifactScope(artifactId),retain:true,transform:true}),...(expiresAt?{expiresAt}:{})};
      await store.appendControl(context(`control:${tag}:rights`),rights as never);
      await store.appendControl(context(`control:${tag}:permission`),{...record(permissionId,'permission','allow'),permission:{enrollment:ref('enrollment:one'),configuration:ref('configuration:one'),materialScope:artifactScope(artifactId),fetch:true,retain:true,transform:true}} as never);
      await store.appendOrigin(context(`origin:${tag}`),{id:originId,revision:1,originalWorkId:`work:${tag}`,members:[`mirror:${tag}`],memberEndpoints:{[`mirror:${tag}`]:`https://example.test/mirror/${tag}`},retentionRights:[ref(rightsId)],policy:ref('policy:one'),reason:'Synthetic scope fixture'});
      const representation = {...capture,id:`representation:${tag}`,materialScope:artifactScope(artifactId),rights:ref(rightsId),permission:ref(permissionId),origin:ref(originId),originMemberId:`mirror:${tag}`,actualEndpoint:`https://example.test/mirror/${tag}`,bytes:new TextEncoder().encode(`Independent content ${tag}`)};
      await store.appendRepresentation(context(`capture:${tag}`),representation);
      const evidenceRecord = {...evidence,id:`evidence:${tag}`,representation:ref(representation.id),selector:{kind:'text-span' as const,start:0,end:11,quote:'Independent'}};
      await store.appendEvidence(context(`evidence:${tag}`),evidenceRecord);
      return {rights,rightsId,originId,representation,evidenceRecord};
    };
    const expiring = await seed('expiring','2027-01-01T00:00:00Z');
    const renewing = await seed('renewing');
    const unrelated = await seed('other-scope');
    await store.appendClaim(context('claim:expiring-existing'),{...claim('claim:expiring-existing','Existing synthetic claim'),predicate:'expire-decision',evidence:[ref(expiring.evidenceRecord.id)]});
    let before = await dump();
    await assert.rejects(store.appendRepresentation(context('capture:wrong-rights-owner'),{...expiring.representation,id:'representation:wrong-rights-owner',origin:ref(unrelated.originId),originMemberId:'mirror:other-scope',actualEndpoint:'https://example.test/mirror/other-scope'}));
    assert.deepEqual(await dump(),before);
    await store.appendControl(context('rights:renewing:2',1),{...renewing.rights,revision:2} as never);
    before = await dump();
    await assert.rejects(store.appendEvidence(context('evidence:renewal-stale'),{...renewing.evidenceRecord,id:'evidence:renewal-stale'}));
    assert.deepEqual(await dump(),before);
    await assert.rejects(store.appendControl(context('rights:denied',2),{...renewing.rights,revision:3,rights:{...(renewing.rights.rights as object),retain:false}} as never));
    assert.deepEqual(await dump(),before);
    currentTime = '2028-01-01T00:00:00Z';
    try {
      for (const [label,operation] of [
        ['evidence',()=>store.appendEvidence(context('expired:evidence'),{...expiring.evidenceRecord,id:'expired:evidence'})],
        ['claim',()=>store.appendClaim(context('expired:claim'),{...claim('expired:claim','Synthetic expired claim'),predicate:'expired-rights',evidence:[ref(expiring.evidenceRecord.id)]})],
        ['decision',()=>store.appendDecision(context('expired:decision'),{id:'expired:decision',revision:1,claim:ref('claim:expiring-existing'),decision:'accepted',reason:'Synthetic expired decision',policy:ref('policy:one'),decidedAt:later})],
        ['observation',()=>store.observeRepresentation(context('expired:observation'),{id:'expired:observation',revision:1,representation:ref(expiring.representation.id),observedAt:later})],
      ] as const) {
        before = await dump();
        await assert.rejects(operation(),undefined,label);
        assert.deepEqual(await dump(),before);
      }
      await store.revokeRetention(context('revoke:expired'),{id:'revoke:expired',revision:1,rights:ref(expiring.rightsId),policy:ref('policy:one'),reason:'Synthetic expired rights removal'});
      assert.equal((await store.readRevision('representation',expiring.representation.id,1))?.tombstoned,true);
    } finally { currentTime = time; }
    cases.ancestorRights = {expiredEvidenceClaimDecisionObservationRejected:true,renewalRejectsOldPin:true,wrongScopeRejected:true,expiredRemovalSucceeded:true};
  });
  await t.test('AC06: refresh failure preserves evidence; reviewed revocation removes it and blocks replay', async () => {
    const before = await store.readRevision('evidence','evidence:one',1);
    await store.recordRefreshFailure(context('refresh:failure'),{id:'refresh:failure',revision:1,representation:ref('representation:one'),observedAt:later,code:'upstream-failed'});
    assert.deepEqual(await store.readRevision('evidence','evidence:one',1),before);
    const failure = await store.readRevision('refresh-failure','refresh:failure',1);
    assert.ok(JSON.stringify(failure).includes('upstream-failed'));
    await store.appendPrivateNote(context('note:private'),{id:'note:private',revision:1,subject:{kind:'claim',...ref('claim:a')},text:'private-note-canary-5271'});
    await store.appendControl(context('rights:one:2',1),{...record('rights:one','rights','synthetic-permission',{materialScope:artifactScope('artifact:one'),retain:true,transform:true}),revision:2} as never);
    await store.appendOrigin(context('origin:uncaptured'),{id:'origin:uncaptured',revision:1,originalWorkId:'work:uncaptured',members:['mirror:uncaptured'],memberEndpoints:{'mirror:uncaptured':'https://example.test/mirror/uncaptured'},retentionRights:[ref('rights:one',2)],policy:ref('policy:one'),reason:'uncaptured-origin-canary-4712'});
    await store.appendControl(context('rights:two'),record('rights:two','rights','synthetic-permission',{materialScope:artifactScope('artifact:two'),retain:true,transform:true}) as never);
    await store.appendControl(context('permission:two'),{...record('permission:two','permission','allow'),permission:{enrollment:ref('enrollment:one'),configuration:ref('configuration:one'),materialScope:artifactScope('artifact:two'),fetch:true,retain:true,transform:true}} as never);
    await store.appendOrigin(context('origin:other'),{id:'origin:other',revision:1,originalWorkId:'work:other',members:['mirror:other'],memberEndpoints:{'mirror:other':'https://example.test/mirror/other'},retentionRights:[ref('rights:two')],policy:ref('policy:one'),reason:'Unrelated synthetic work'});
    await store.appendRepresentation(context('capture:other'),{...capture,id:'representation:other',materialScope:artifactScope('artifact:two'),rights:ref('rights:two'),permission:ref('permission:two'),origin:ref('origin:other'),originMemberId:'mirror:other',actualEndpoint:'https://example.test/mirror/other',bytes:new TextEncoder().encode('Unrelated permitted content')});
    await store.appendEvidence(context('evidence:other'),{id:'evidence:other',revision:1,representation:ref('representation:other'),selector:{kind:'text-span',start:0,end:9,quote:'Unrelated'}});
    const unrelatedBefore = await store.readRevision('evidence','evidence:other',1);
    const logCapture: string[] = [];
    const originalLog = console.log, originalError = console.error;
    console.log = (...args:unknown[]) => { logCapture.push(args.map(String).join(' ')); };
    console.error = (...args:unknown[]) => { logCapture.push(args.map(String).join(' ')); };
    try { await store.revokeRetention(context('revoke:one'),{id:'revoke:one',revision:1,rights:ref('rights:one',2),policy:ref('policy:one'),reason:'Synthetic rights withdrawn'}); } finally { console.log = originalLog; console.error = originalError; }
    const revokedScopeBefore = await dump();
    await assert.rejects(store.appendControl(context('rights:one:regrant'),record('rights:one:regrant','rights','synthetic-permission',{materialScope:artifactScope('artifact:one'),retain:true,transform:true}) as never));
    assert.deepEqual(await dump(),revokedScopeBefore);
    await assert.rejects(store.appendControl(context('permission:one:regrant'),{...record('permission:one:regrant','permission','allow'),permission:{enrollment:ref('enrollment:one'),configuration:ref('configuration:one'),materialScope:artifactScope('artifact:one'),fetch:true,retain:true,transform:true}} as never));
    assert.deepEqual(await dump(),revokedScopeBefore);
    await assert.rejects(store.appendOrigin(context('origin:one:regrant'),{id:'origin:one:regrant',revision:1,originalWorkId:'work:regrant',members:['mirror:regrant'],memberEndpoints:{'mirror:regrant':'https://example.test/regrant'},retentionRights:[ref('rights:one:regrant')],policy:ref('policy:one'),reason:'forbidden-artifact-rationale-8653'}));
    assert.deepEqual(await dump(),revokedScopeBefore);
    assert.equal(JSON.stringify(await dump()).includes('forbidden-artifact-rationale-8653'),false);
    const redacted = await dump();
    const flattened = JSON.stringify(redacted);
    for (const forbidden of [raw,normalized,quote,'Organization A','Organization B','Alpha','synthetic-never-retain-9823','private-note-canary-5271','uncaptured-origin-canary-4712',JSON.stringify(Array.from(bytes))]) assert.equal(flattened.includes(forbidden),false,`retained forbidden content: ${forbidden}`);
    assert.equal(logCapture.join('\n').includes('synthetic-never-retain-9823'),false);
    assert.equal(logCapture.join('\n').includes('private-note-canary-5271'),false);
    assert.deepEqual(await store.readRevision('evidence','evidence:other',1),unrelatedBefore);
    assert.equal((await store.readRevision('rights','rights:one',1))?.tombstoned,true);
    assert.equal((await store.readRevision('rights','rights:one',2))?.tombstoned,true);
    assert.equal((await store.readRevision('origin','origin:uncaptured',1))?.tombstoned,true);
    const after = await store.readRevision('evidence','evidence:one',1);
    assert.ok(after?.tombstoned || after?.invalidated);
    try { const replay = await store.appendRepresentation(context('capture:one'),capture); assert.equal(replay.tombstoned,true); } catch { /* refusal also prevents resurrection */ }
    assert.deepEqual(await dump(),redacted);
    await store.observeRepresentation(context('observation:other'),{id:'observation:other',revision:1,representation:ref('representation:other'),observedAt:later});
    assert.ok(await store.readRevision('observation','observation:other',1));
    cases.AC06 = { failure, after, forbiddenStringsAbsent:true, replayDidNotResurrect:true };
  });
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
  const evidenceDir = new URL('../.discovery-work/wp05-terra/',import.meta.url);
  mkdirSync(evidenceDir,{recursive:true});
  writeFileSync(new URL('local-d1-results.json',evidenceDir),JSON.stringify(report,null,2)+'\n');
});
