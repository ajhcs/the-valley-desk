import { readFileSync, writeFileSync, readdirSync, lstatSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { canonicalDiscoveryEvidenceJson as canonical } from '../src/ingest/discovery-evidence-store.ts';
import { ENRICHMENT_LIMITS, GITHUB_ENRICHMENT_REVISION, enrichmentUrl, inspectGithubEnrichmentPage, buildGithubEnrichmentQueue, validateRetainedGithubProjection } from '../src/ingest/discovery/github-enrichment.ts';
const sha256 = value => createHash('sha256').update(value).digest('hex');

const mapPath = 'docs/discovery/go-live/evidence/GL05/research-account-map.json';
const networkPath = 'docs/discovery/go-live/evidence/GL05/regional-additions-20261117/qualification-queue.json';
const excluded = ['christiana', 'lehigh', 'scranton'];
export function validateRetainedEnrichmentPage(packet, scopeBytes, name, journalPacket) {
  const scope = JSON.parse(scopeBytes), scopeSha = sha256(scopeBytes);
  const account = scope.roster.find(a => a.login === packet.login);
  const receiptId = sha256(`${scopeSha}\n${packet.login}\n${packet.page}`);
  const allowed = new Set(['receiptId', 'scopeSha256', 'login', 'page', 'requestUrl', 'issuedAt', 'observedAt', 'status', 'httpStatus', 'rawBodyRetained', 'sourceObservationIds', 'projection', 'responseBytes', 'projectionSha256', 'failureCode', 'rateLimit']);
  const statuses = ['received', 'malformed', 'unavailable', 'unknown', 'rate-limited', 'refused', 'redirect'];
  if (!journalPacket || canonical(packet) !== canonical(journalPacket) || Object.keys(packet).some(key => !allowed.has(key)) ||
    !statuses.includes(packet.status) || !account || packet.scopeSha256 !== scopeSha || packet.receiptId !== receiptId || name !== `page-${receiptId}.json` ||
    packet.requestUrl !== enrichmentUrl(account.login, packet.page) || packet.rawBodyRetained !== false ||
    canonical(packet.sourceObservationIds) !== canonical(account.sourceObservationIds)) throw new Error('receipt-binding');
  for (const date of [packet.issuedAt, packet.observedAt]) if (typeof date !== 'string' || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString() !== date) throw new Error('receipt-binding');
  if (packet.observedAt < packet.issuedAt || !Number.isSafeInteger(packet.responseBytes) || packet.responseBytes < 0 || packet.responseBytes > ENRICHMENT_LIMITS.maxBytesPerResponse + 1 ||
    packet.httpStatus !== null && (!Number.isSafeInteger(packet.httpStatus) || packet.httpStatus < 100 || packet.httpStatus > 599)) throw new Error('receipt-binding');
  if (packet.failureCode !== undefined && (packet.status === 'received' || typeof packet.failureCode !== 'string' || !/^[a-z][a-z0-9:-]{0,99}$/.test(packet.failureCode))) throw new Error('receipt-binding');
  if (packet.rateLimit !== undefined && (!packet.rateLimit || typeof packet.rateLimit !== 'object' || Array.isArray(packet.rateLimit) ||
    Object.entries(packet.rateLimit).some(([key, value]) => !['x-ratelimit-remaining', 'x-ratelimit-reset', 'retry-after'].includes(key) || !Number.isSafeInteger(value) || value < 0))) throw new Error('receipt-binding');
  if (packet.status === 'received' && (!packet.projection || packet.projection.publicationAuthorized !== false ||
    packet.projection.rawBodyRetained !== false || !/^[a-f0-9]{64}$/.test(packet.projection.nativeBodySha256) ||
    sha256(canonical(packet.projection)) !== packet.projectionSha256)) throw new Error('receipt-binding');
  if (packet.status === 'received') {
    if (packet.httpStatus !== 200 || packet.responseBytes > ENRICHMENT_LIMITS.maxBytesPerResponse) throw new Error('receipt-binding');
    validateRetainedGithubProjection(packet.projection, account.login, packet.page, scope.schemaVersion);
  } else if (packet.projection !== null || packet.projectionSha256 !== undefined) throw new Error('receipt-binding');
  return packet;
}

export function readEnrichmentJournal(directory, scopeBytes, names) {
  const path = resolve(directory, '..', 'journal.sqlite'), stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 63) !== 0) throw new Error('receipt-binding');
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (db.prepare("SELECT value FROM meta WHERE key='scope'").get()?.value !== sha256(scopeBytes)) throw new Error('receipt-binding');
    const scope = JSON.parse(scopeBytes), rows = db.prepare('SELECT login,page,status,receipt FROM attempts').all();
    if (rows.length > scope.limits.maxRequests || rows.length !== names.length) throw new Error('receipt-binding');
    const packets = new Map();
    for (const row of rows) {
      if (typeof row.receipt !== 'string') throw new Error('receipt-binding');
      const packet = JSON.parse(row.receipt), name = `page-${packet.receiptId}.json`;
      if (!names.includes(name) || packets.has(name) || packet.login !== row.login || packet.page !== row.page || packet.status !== row.status) throw new Error('receipt-binding');
      packets.set(name, packet);
    }
    return packets;
  } finally { db.close(); }
}

export function prepareEnrichmentYieldSample(queue, queueSha256) {
  if (queue.publicationAuthorized !== false || !Array.isArray(queue.candidates) || queue.candidates.length < 100) throw new Error('sample-cohort');
  if (queue.candidates.some(candidate => !/^[1-9]\d*$/.test(candidate.nativeId)) ||
    new Set(queue.candidates.map(candidate => candidate.nativeId)).size !== queue.candidates.length) throw new Error('sample-cohort');
  const seed = 'GL08-yield-20261117-v1';
  const selected = queue.candidates.map(candidate => ({ candidate, key: sha256(`${seed}\n${candidate.nativeId}`) }))
    .sort((a, b) => a.key.localeCompare(b.key, 'en')).slice(0, 100);
  return { id: seed, visibility: 'private', publicationAuthorized: false, queueSha256,
    method: 'First 100 SHA-256(seed + newline + native repository ID) values; no topic, description, known-match, fork, archive or account-type filter.',
    denominator: queue.candidates.length, scope: 'Enriched seed cohort only; not representative of all primary-region collections.',
    reviewStatus: 'not_started', eligibleFraction: null, minutesPerAdmission: null,
    rows: selected.map(({ candidate }) => ({ ...candidate, review: { usefulPurpose: null, healthRelevance: null,
      datedWorkRegionalBasis: null, originalLink: null, eligible: null, evidence: [], reason: null,
      activeReviewMinutes: null, reviewer: null } })),
  };
}
export function prepareGithubEnrichmentScope() {
  const mapBytes = readFileSync(mapPath), queueBytes = readFileSync(networkPath);
  const map = JSON.parse(mapBytes), queue = JSON.parse(queueBytes);
  const files = new Map(map.inputSources.map(source => [source.source, readFileSync(source.source)]));
  for (const source of map.inputSources) if (sha256(files.get(source.source)) !== source.sha256) throw new Error('source-drift');
  const roster = map.accounts.map(account => {
    const evidence = account.occurrenceIds.map(ref => {
      const [path, pointer] = ref.split('#');
      const bytes = files.get(path);
      if (!bytes || !/^\/(accounts|accountOnlyLeads)\/\d+$/.test(pointer)) throw new Error('source-pointer');
      const [, section, index] = pointer.split('/');
      const row = JSON.parse(bytes)[section]?.[Number(index)];
      const originalUrl = section === 'accounts' ? row?.accountUrl : row?.url;
      if (!row || row.account?.toLowerCase() !== account.key || originalUrl?.toLowerCase() !== account.url.toLowerCase()) throw new Error('account-source-binding');
      return { path, sha256: sha256(bytes), pointer, evidenceUrl: section === 'accounts' ? row.accountLinkSource : row.source,
        institutionOrLab: section === 'accounts' ? row.institutionOrLab : row.institution, temporalScope: row.affiliationTimeScope };
    });
    const primary = queue.observations.filter(o => o.accountKey === account.key && !excluded.includes(o.batch));
    if (!primary.length || !evidence.length || evidence.some(e => typeof e.evidenceUrl !== 'string')) throw new Error('primary-source-required');
    return { login: account.key, originalUrl: account.url, evidence,
      sourceObservationIds: primary.map(o => o.id).sort(),
      regionalEligibility: 'unreviewed-source-association; not current employment or project worksite' };
  });
  if (new Set(roster.map(a => a.login)).size !== roster.length) throw new Error('duplicate-roster');
  return {
    id: `GL08-github-enrichment-20261117-${GITHUB_ENRICHMENT_REVISION.split('-').at(-1)}`, schemaVersion: GITHUB_ENRICHMENT_REVISION,
    status: 'prepared_for_scoped_approval', visibility: 'private', publicationAuthorized: false,
    baseline: '8f0ac660de0c56db19b52478514ee52051f56efa',
    selection: 'Frozen 41-account source-linked PA/NJ/professional seed cohort already federated in the primary-region queue; not all primary-region accounts or a yield sample.',
    excludedCollections: excluded, inputs: [{ path: mapPath, sha256: sha256(mapBytes) }, { path: networkPath, sha256: sha256(queueBytes) }],
    route: { method: 'GET', origin: 'https://api.github.com', path: '/users/{login}/repos',
      query: { type: 'owner', sort: 'full_name', direction: 'asc', per_page: ENRICHMENT_LIMITS.perPage },
      accept: 'application/vnd.github+json', apiVersion: '2022-11-28', redirects: 0, retries: 0,
      authentication: 'anonymous', concurrency: 1,
      identity: 'All nonempty page owners must match the frozen login and one observed native account ID/type. Empty inventories without an observed owner remain identity-unverified.',
      continuation: 'Validate same-route Link relations and immutable native-owner paths; issue only reconstructed frozen-route next pages. A full unlinked page is incomplete.',
    },
    limits: { ...ENRICHMENT_LIMITS, maxRequests: 55, minimumDelayMs: 1000, maxSpendUsd: 0 },
    stop: ['401/403/429 or redirect: hold entire provider batch', 'Transport/inspection failure: hold account without retry', 'Global request/time limit: leave unissued pages pending', 'Per-account page cap: record incomplete', 'No account expansion, source bodies, contacts, recurring collection or public admission'],
    retainedFields: ['nativeId', 'fullName', 'originalUrl', 'description', 'fork', 'archived', 'createdAt', 'updatedAt', 'pushedAt', 'owner.nativeId', 'owner.login', 'owner.type', 'sourcePointer', 'receiptId', 'observedAt', 'sourceObservationIds'],
    roster,
  };
}

export function main(args = process.argv.slice(2)) {
  const [action, file] = args;
  if (action === 'prepare' && file && args.length === 2) {
    const scope = prepareGithubEnrichmentScope();
    writeFileSync(file, JSON.stringify(scope, null, 2) + '\n', { flag: 'wx' });
    return { accounts: scope.roster.length, scopeSha256: sha256(readFileSync(file)), requestsMax: scope.limits.maxRequests };
  }
  if (action === 'inspect' && args.length === 1) {
    const input = readFileSync(0);
    if (input.length > 360000) throw new Error('input-cap');
    const p = JSON.parse(input);
    if (typeof p.bodyBase64 !== 'string' || p.bodyBase64.length > 342000) throw new Error('input-cap');
    const bytes = Buffer.from(p.bodyBase64, 'base64');
    return { ...inspectGithubEnrichmentPage(bytes, p.login, p.page, p.link, p.previousOwner ?? null), nativeBodySha256: sha256(bytes) };
  }
  if (action === 'queue' && file && args.length >= 2) {
    const observations = [];
    const provenance = [];
    const seenReceipts = new Set();
    for (const directory of args.slice(1)) {
      const scopeBytes = readFileSync(resolve(directory, '..', 'scope.json'));
      const names = readdirSync(directory).sort();
      if (names.some(name => !/^page-[a-f0-9]{64}\.json$/.test(name))) throw new Error('receipt-binding');
      const journal = readEnrichmentJournal(directory, scopeBytes, names);
      for (const name of names) {
        const bytes = readFileSync(resolve(directory, name));
        const packet = validateRetainedEnrichmentPage(JSON.parse(bytes), scopeBytes, name, journal.get(name));
        if (seenReceipts.has(packet.receiptId)) throw new Error('receipt-binding');
        seenReceipts.add(packet.receiptId);
        provenance.push({ path: resolve(directory, name), sha256: sha256(bytes), status: packet.status });
        if (packet.status !== 'received') continue;
        for (const repo of packet.projection.repositories) observations.push({ ...repo, receiptId: packet.receiptId,
          observedAt: packet.observedAt, sourceObservationIds: packet.sourceObservationIds });
      }
    }
    return { ...buildGithubEnrichmentQueue(observations), provenance };
  }
  if (action === 'sample' && file && args.length === 2) {
    const bytes = readFileSync(file), queue = JSON.parse(bytes);
    if (queue.ok !== true) throw new Error('sample-cohort');
    return prepareEnrichmentYieldSample(queue.result, sha256(bytes));
  }
  throw new Error('usage: prepare SCOPE_FILE | inspect < INPUT | queue PRIVATE_PAGES_DIRECTORY [DIRECTORY...] | sample QUEUE_FILE');
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { process.stdout.write(JSON.stringify({ ok: true, result: main() }) + '\n'); }
  catch (error) {
    const code = error instanceof Error && /^(github-enrichment:[a-z-]+|source-drift|source-pointer|account-source-binding|primary-source-required|duplicate-roster|input-cap|receipt-binding|sample-cohort|usage:)/.test(error.message) ? error.message : 'enrichment-operation-rejected';
    process.stdout.write(JSON.stringify({ ok: false, code }) + '\n'); process.exitCode = 1;
  }
}
