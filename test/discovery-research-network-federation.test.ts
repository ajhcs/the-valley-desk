import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { federate, type Observation } from '../src/ingest/discovery/research-network-federation.ts';
const o = (id: string, url: string, nativeId: string | null = null): Observation => ({ id: `test:${id}`, batch: 'test', kind: 'repository', url, nativeId, fields: {} });
test('federates identical URL observations and preserves source contexts', () => {
 const r = federate([o('a','https://github.com/Org/Repo','123'),o('b','https://github.com/org/repo')],[],[]);
 assert.equal(r.repositories.length,1); assert.equal(r.repositories[0].nativeId,'123'); assert.deepEqual(r.repositories[0].observations,['test:a','test:b']);
});
test('rejects alias conflicts, duplicate IDs and invalid actual dates', () => {
 assert.throws(() => federate([o('a','https://github.com/a/b','1'),o('b','https://github.com/a/b','2')],[],[]),/Conflicting/);
 assert.throws(() => federate([o('a','https://github.com/a/b','1'),o('b','https://github.com/c/d','1')],[],[]),/Conflicting/);
 assert.throws(() => federate([o('a','https://github.com/a/b'),o('a','https://github.com/a/b')],[],[]),/Duplicate/);
 assert.throws(() => federate([{...o('a','x'),observedDate:'2026-02-30'}],[],[]),/Invalid/);
});
test('preserves scoped graph and classifies paths without counting them as repositories', () => {
 const r=federate([o('a','https://github.com/a/b/wiki/x')],[{id:'cooper:person:a',type:'person',label:'A',sourcePointer:'row:1'}],[]);
 assert.equal(r.observations[0].urlKind,'file-path-reference'); assert.equal(r.repositories.length,0); assert.equal(r.nodes[0].publicationAuthorized,false);
 assert.throws(()=>federate([],[],[{id:'cooper:x',source:'cooper:missing',target:'cooper:missing',relationship:'reported',status:'source_reported_not_independently_verified',sourcePointer:'1'}]),/endpoint/);
});

test('rejects malformed or unallowlisted input and reserved routes', () => {
 assert.throws(() => federate([{...o('a','x'), fields:{contact:'x'}}],[],[]),/schema/);
 assert.throws(() => federate([{...o('a','x'), fields:{reportedLastPushUtc:'2026-02-30T00:00:00Z'}}],[],[]),/timestamp/);
 const r=federate([o('a','https://github.com/topics/health'),o('b','https://github.com/a//b')],[],[]); assert.equal(r.repositories.length,0);
});
test('rejects unsafe scalar, nested context and timestamp values', () => {
 for (const fields of [{reportedFork:'false'},{reportedCount:'zero'},{sourcePointer:42},{currentAffiliationVerified:'yes'},{reportedContext:{groupLabel:{biography:'profile'}}},{reportedContext:{currentAffiliationVerified:'true'}},{reportedContext:{evidenceUrls:[17]}},{pushedAt:'2026-11-17T24:00:00Z'}]) assert.throws(() => federate([{...o('x','x'),fields}],[],[]));
 assert.throws(() => federate([{...o('x','x'),nativeId:''}],[],[]));
 assert.throws(() => federate([{...o('x','x'),observedDate:''}],[],[]));
});
