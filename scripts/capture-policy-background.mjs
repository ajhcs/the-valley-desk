// Read-only official HTTP capture, offline PDF extraction, local background dossier.
// No D1, editorial, deployment, authentication or routing operations.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { policyBackground } from '../src/ingest/policy-background.ts';

const output = process.argv.find(a => a.startsWith('--output='))?.slice(9);
if (!output) throw Error('Required: --output=/new/restricted/evidence/directory');
const dir = resolve(output);
mkdirSync(dir, { mode: 0o700 }); // Fail if already present: never overwrite a receipt.
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (name, value) => writeFileSync(`${dir}/${name}`, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
const receipt = { schemaVersion: 'policy-background-capture-v1', startedAt: new Date().toISOString(),
  implementationCommit: execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim(),
  implementationTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], {encoding:'utf8'}).trim(),
  workingTreeClean: !execFileSync('git', ['status', '--porcelain'], {encoding:'utf8'}).trim(),
  productionMutation: false, productionPersistence: false, bills: [] };
const headers = { 'user-agent': 'TheValleyDesk/0.1 (+https://github.com/ajhcs/the-valley-desk)', accept: 'text/html,application/pdf' };
async function capture(url, limit, type) {
  const startedAt = new Date().toISOString(), start = performance.now(), hops = [];
  const signal = AbortSignal.timeout(20_000);
  try {
    for (let hop = 0; hop <= 4; hop++) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !['palegis.us', 'www.palegis.us'].includes(parsed.host) ||
          parsed.username || parsed.password || parsed.search || parsed.hash) throw Error('unapproved-official-url');
      const r = await fetch(url, {headers, redirect:'manual', signal});
      hops.push({url, status:r.status, elapsedMs:Math.round(performance.now()-start)});
      if ([301,302,303,307,308].includes(r.status)) {
        const next = r.headers.get('location');
        await r.body?.cancel();
        if (!next) throw Error('redirect-without-location');
        url = new URL(next,url).href;
        continue;
      }
      if (!r.ok || !r.headers.get('content-type')?.toLowerCase().includes(type)) {
        await r.body?.cancel(); throw Error(!r.ok ? `http-${r.status}` : 'unexpected-content-type');
      }
      if (!r.body) throw Error('missing-body');
      const reader = r.body.getReader(), chunks = []; let size = 0;
      try {
        while (true) {
          const {done,value} = await reader.read(); if (done) break;
          size += value.length;
          if (size > limit) throw Error('byte-limit');
          chunks.push(Buffer.from(value));
        }
      } finally { await reader.cancel(); }
      const bytes = Buffer.concat(chunks);
      return { bytes, observation: {startedAt, finishedAt:new Date().toISOString(), finalUrl:url, hops,
        elapsedMs:Math.round(performance.now()-start), byteCount:size, sha256:sha(bytes)} };
    }
    throw Error('redirect-limit');
  } catch (error) {
    throw Object.assign(Error(error.name === 'TimeoutError' ? 'timed-out' : error.message),
      {observation:{startedAt, finishedAt:new Date().toISOString(), hops, elapsedMs:Math.round(performance.now()-start)}});
  }
}
const escape = s => String(s).replace(/[\\`*_{}\[\]<>#|]/g, '\\$&').replace(/\r?\n/g,' ');
let md = '# Pennsylvania policy background — local review dossier\n\nNot a news publication. No production import or editorial approval occurred. Status is as observed below; bill text remains a proposal, not a finding of operative law.\n';
for (const bill of ['hb1925','sb1113','hb1993']) {
  const row = {bill, outcome:'failed'};
  receipt.bills.push(row);
  try {
    const url = `https://www.palegis.us/legislation/bills/2025/${bill}`;
    const page = await capture(url, 524288, 'text/html');
    save(`${bill}.html`, page.bytes);
    const background = policyBackground(page.bytes.toString('utf8'), url, page.observation.finishedAt);
    Object.assign(row, {officialPage:page.observation, background});
    if (background.record.blocker || !background.record.current) throw Error('official-record-blocked');
    const pdfUrl = background.record.current.url;
    const pdf = await capture(pdfUrl, 5_000_000, 'application/pdf');
    // Redirects cannot silently select another bill or printer.
    if (new URL(pdf.observation.finalUrl).pathname !== new URL(pdfUrl).pathname) throw Error('pdf-redirect-version-mismatch');
    save(`${bill}.pdf`,pdf.bytes);
    row.pdf = pdf.observation;
    const manifest = { record:background.record, officialPageSha256:page.observation.sha256, pdfUrl };
    save(`${bill}.binding.json`,manifest);
    const extraction = spawnSync('node_modules/.policy-pdf/bin/python', ['scripts/extract-legislative-pdf.py', `${dir}/${bill}.pdf`, `${dir}/${bill}.binding.json`,
      '--match','artificial intelligence'], {encoding:'utf8',timeout:60_000,maxBuffer:12_000_000});
    if (extraction.error || !extraction.stdout) throw Error('extractor-unavailable-or-time-limit');
    const evidence = JSON.parse(extraction.stdout);
    save(`${bill}.extraction.json`,evidence);
    row.extractionSha256 = sha(JSON.stringify(evidence,null,2)+'\n');
    row.outcome = evidence.outcome;
    row.extraction = {pageCount:evidence.pageCount, passageCount:evidence.passages?.length, blockers:evidence.blockers,
      interpretationBlockers:evidence.interpretationBlockers};
    const r = background.record;
    md += `\n## ${r.bill} · ${r.session} · ${r.current.printer}\n\nObserved: ${background.observedAt}. [Official history](${url}#HistorySection).\n\nLatest action: ${escape(r.action)}. Action date: ${r.actionAt ?? 'unavailable'}. Text-version date: ${r.current.textDate ?? 'unavailable'} (not the action date).\n\nOfficial synopsis: ${escape(background.synopsis)}\n\n### Recorded actions\n\n`;
    md += background.actions.map(a=>`- ${a.actionAt?.slice(0,10) ?? 'Date unavailable'}: ${escape(a.wording)}`).join('\n') + '\n';
    md += `\n### Printer history\n\n` + r.history.map(v=>`- [${v.printer}](${v.url}) — text date ${v.textDate?.slice(0,10) ?? 'unavailable'}${v.printer === r.current.printer ? ' (selected current text)' : ' (historical text)'}`).join('\n');
    md += `\n\n### Literal PDF evidence\n\nExtraction: ${evidence.outcome}; ${evidence.pageCount ?? 'unknown'} pages. PDF SHA-256: \`${evidence.artifactSha256}\`. Review blockers: ${[...(evidence.blockers??[]),...(evidence.interpretationBlockers??[])].join(', ') || 'none'}.\n\nPassages below are excerpts, not complete provisions or legal conclusions. The full page text and all matches are in [the extraction receipt](${bill}.extraction.json).\n\n`;
    md += (evidence.passages??[]).slice(0,8).map(p=>`- [PDF page ${p.pageNumber}](${p.citationUrl}): ${escape(p.text)}`).join('\n') + '\n';
  } catch (error) {
    row.error = error.message;
    if (error.observation) row.failedFetch = error.observation;
    md += `\n## ${bill.toUpperCase()} — evidence unavailable\n\nBlocker: ${escape(error.message)}. No successful empty result is inferred.\n`;
  }
}
receipt.finishedAt = new Date().toISOString();
receipt.assessment = receipt.bills.every(b=>b.outcome==='complete') ? 'local-byte-extraction-complete; interpretation-and-production-integration-unfinished' : 'partial-or-failed';
save('background.md',md);
save('receipt.json',receipt);
console.log(JSON.stringify({directory:dir,assessment:receipt.assessment,bills:receipt.bills.map(b=>({bill:b.bill,outcome:b.outcome,error:b.error,extraction:b.extraction}))},null,2));
if (receipt.bills.some(b=>b.outcome!=='complete')) process.exitCode=2;
