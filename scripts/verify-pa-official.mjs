// Read-only official HTTP fetch plus local byte replay. Never calls production
// collection, D1, publication, credential, or routing APIs.
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { discoverOfficialSources, officialSourceRegistry, officialPolicyIdentity, officialSourceRelevanceInput } from '../src/ingest/official-source-discovery.ts';
import { readPaBillEvidence, paBillSynopsis } from '../src/ingest/pa-bill-evidence.ts';
import { fetchUpstream } from '../src/ingest/upstream.ts';

const receiptArg = process.argv.find(arg => arg.startsWith('--receipt='));
if (!receiptArg) throw Error('Required: --receipt=/restricted/evidence/path.json');
const receiptPath = resolve(receiptArg.slice('--receipt='.length));
mkdirSync(dirname(receiptPath), { recursive: true, mode: 0o700 });
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
assert.equal(git('status', '--porcelain', '--untracked-files=no'), '', 'Commit implementation before official replay');
const receipt = { startedAt: new Date().toISOString(), commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), productionMutation: false, results: [], passed: false };
try {
  for (const source of officialSourceRegistry.sources.filter(s => /^ofs-pa-legislature-(?:hb|sb)\d+$/.test(s.id))) {
    const startedAt = new Date().toISOString();
    const start = performance.now();
    const response = await fetchUpstream({ url: source.url, fetchImpl: fetch, maxBytes: 524288, timeoutMs: 8000, attempts: 1,
      headers: { 'user-agent': 'TheValleyDesk/0.1 (+https://github.com/ajhcs/the-valley-desk)', accept: 'text/html,application/xhtml+xml' },
      allowedRedirectHosts: new Set(['palegis.us', 'www.palegis.us']), maxRedirects: 4,
    });
    const rawPath = `${receiptPath}.${source.id}.html`;
    writeFileSync(rawPath, response.body, { mode: 0o600 });
    const rawSha256 = createHash('sha256').update(response.body).digest('hex');
    const result = await discoverOfficialSources({ sources: [source], now: new Date(startedAt), detailCapPerRun: 0,
      fetchImpl: async () => new Response(response.body, { headers: { 'content-type': 'text/html' } }),
    });
    const candidate = result.candidates[0];
    const record = readPaBillEvidence(candidate?.detailText);
    const identity = candidate && officialPolicyIdentity(candidate);
    const synopsis = paBillSynopsis(response.body);
    const delivered = candidate && officialSourceRelevanceInput(candidate).candidate.detailText;
    receipt.results.push({ sourceId: source.id, startedAt, finishedAt: new Date().toISOString(), milliseconds: Math.round(performance.now() - start),
      sourceUrl: source.url, finalUrl: response.url, rawPath, rawSha256, record, identity, detailHash: candidate?.detailHash,
      synopsis, synopsisDelivered: Boolean(synopsis && delivered?.includes(synopsis)), pdfContentsExtracted: false,
      error: candidate?.detailError ?? result.snapshots[0]?.error });
    assert.equal(result.snapshots[0]?.state, 'success');
    assert.equal(result.candidates.length, 1);
    assert.equal(record?.blocker, null);
    assert.ok(record?.actionAt && record.current?.printer && record.current.url);
    assert.ok(identity && identity.versionId === record.current.printer && identity.textUrl === record.current.url);
    assert.equal(identity.developmentAt, record.actionAt);
    assert.ok(synopsis && delivered?.includes(synopsis), 'Official synopsis must reach the relevance input');
  }
  assert.equal(receipt.results.length, 3);
  assert.equal(git('rev-parse', 'HEAD'), receipt.commit);
  receipt.passed = true;
} catch (error) {
  receipt.error = error.message;
  process.exitCode = 1;
} finally {
  receipt.finishedAt = new Date().toISOString();
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(receipt, null, 2));
}
