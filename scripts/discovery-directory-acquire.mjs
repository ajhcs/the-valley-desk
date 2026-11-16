import { DatabaseSync } from "node:sqlite";
import { closeSync, lstatSync, openSync, realpathSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import { DirectoryAcquisitionPlanSchema, DirectoryFactPacketSchema, DirectoryNativeReceiptSchema, canonical } from "../src/ingest/discovery/directory-acquisition.ts";
import { createHash } from "node:crypto";
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const BUILD_ROOT = "/workspace/build/builderbob";
function deepFreeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); } return value; }
function checkPrivateDirectory(directory) {
  if (!isAbsolute(directory) || realpathSync(directory) !== directory) throw new Error("private-directory-must-be-real");
  const base = realpathSync(BUILD_ROOT), rel = relative(base, directory), stat = lstatSync(directory);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || !stat.isDirectory() || stat.uid !== process.getuid?.() || (stat.mode & 63) !== 0) throw new Error("private-directory-required");
  return directory;
}
function openPrivateDb(directory) {
  const file = join(checkPrivateDirectory(directory), "frontier.sqlite");
  try {
    const fd = openSync(file, "wx", 384);
    closeSync(fd);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
  }
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 63) !== 0) throw new Error("private-database-required");
  const db = new DatabaseSync(file);
  db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;");
  return db;
}
function identity(provider, installation, nativeId) {
  let id = nativeId;
  if (provider === 'github' || provider === 'pubmed') { if (!/^[1-9]\d*$/.test(id)) throw new Error('invalid-native-id'); }
  else if (provider === 'crossref') { id = id.replace(/^https:\/\/doi\.org\//i, '').toLowerCase(); if (!/^10\.\d{4,9}\/[^\s]+$/.test(id)) throw new Error('invalid-native-id'); }
  else if (provider === 'arxiv') { id = id.replace(/^https:\/\/arxiv\.org\/abs\//i, '').toLowerCase(); if (!/^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[a-z-]+)?\/\d{7})(?:v[1-9]\d*)?$/.test(id)) throw new Error('invalid-native-id'); }
  return JSON.stringify([provider, provider === 'other' ? installation : '', id]);
}
function inspectSafe(input, provider, numericIds = []) {
  const inspect = (value, path = []) => {
    if (Array.isArray(value)) { value.forEach((v, i) => inspect(v, [...path, String(i)])); return; }
    if (value && typeof value === 'object') { for (const [k,v] of Object.entries(value)) inspect(v, [...path,k]); return; }
    if (typeof value !== 'string') return;
    let decoded = value;
    for (let i = 0; i < 3; i++) {
      try { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; } catch { break; }
    }
    decoded = decoded.replace(/&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));?/gi, (m,hex,decimal) => { const n = parseInt(hex ?? decimal, hex ? 16 : 10); return n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : m; }).replace(/&(commat|period|colon);/gi, (_,n) => ({commat:'@',period:'.',colon:':'}[n.toLowerCase()]));
    const nativeNumeric = ['github','pubmed'].includes(provider) && ((path.at(-1) === 'nativeId' && /^[1-9]\d*$/.test(decoded)) || (path.at(-1) === 'id' && numericIds.some(id => decoded === `candidate:${id}` && /^[1-9]\d*$/.test(id))));
    const restrictedKeys = new Set(['token','accesstoken','refreshtoken','password','passwd','secret','clientsecret','apikey','authorization','cookie','credential','credentials','signature','sig','auth','key']);
    if (/^https?:/i.test(decoded)) { try { const u = new URL(decoded); for (const key of u.searchParams.keys()) if (restrictedKeys.has(key.toLowerCase().replace(/[-_\s]/g,''))) throw new Error('private-or-credential-fact'); } catch (error) { if (error instanceof Error && error.message === 'private-or-credential-fact') throw error; } }
    if (/(?:mailto|tel|sms):|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{16,}|\bgithub_pat_[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9_-]{16,}|(?:[?&]|\b)(?:token|access[_-]?token|refresh[_-]?token|password|passwd|secret|client[_-]?secret|api[_-]?key|authorization|cookie|credentials?|signature|sig|auth)=/i.test(decoded)) throw new Error('private-or-credential-fact');
    if (!nativeNumeric && /(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)|\b\d{3})[ .-]\d{3}[ .-]\d{4}\b|\b(?:phone|telephone|mobile|fax)\s*[:=]\s*\+?[\d(). -]{7,}|\b\d{10,15}\b/i.test(decoded)) throw new Error('private-or-credential-fact');
  };
  inspect(input);
}
function safeFacts(packet, provider) {
  inspectSafe(packet, provider, packet.facts.map(f => f.nativeId));
  for (const f of packet.facts) {
    const source = f.frontier.source;
    if (source.kind !== 'collection-lead' || source.lead.publicationAuthorized !== false || source.lead.relatedAccounts.length || source.lead.unresolvedPeople.length || source.lead.institutionalAuthor !== undefined) throw new Error('unsafe-frontier-material');
  }
}

class DirectoryAcquisitionStore {
  #db;
  plan;
  manifestSha256;
  constructor(directory, input) {
    Object.defineProperty(this, 'plan', {value: deepFreeze(DirectoryAcquisitionPlanSchema.parse(input)), writable: false, configurable: false, enumerable: true});
    inspectSafe(this.plan, 'other');
    const gl02 = readFileSync(new URL('../docs/discovery/go-live/execution/GL02-exploration-manifest.json', import.meta.url));
    if (this.plan.gl02ManifestSha256 !== sha256(gl02)) throw new Error('gl02-manifest-mismatch');
    for (const page of this.plan.pages) {
      const request = { method: page.method, url: page.url, accept: page.accept, encoding: page.encoding, userAgent: page.userAgent, githubApiVersion: page.githubApiVersion, maxBytes: page.maxBytes, timeoutMs: page.timeoutMs, redirects: page.redirects };
      if (page.requestSha256 !== sha256(canonical(request))) throw new Error("request-digest-mismatch");
    }
    Object.defineProperty(this, 'manifestSha256', {value: sha256(canonical(this.plan)), writable: false, configurable: false, enumerable: true});
    this.#db = openPrivateDb(directory);
    this.#db.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS attempts (page_id TEXT PRIMARY KEY, status TEXT NOT NULL, issued_at TEXT, receipt TEXT, projection_sha TEXT, packet_sha TEXT, outcome TEXT, pending_count INTEGER NOT NULL DEFAULT 0, pending_packet TEXT);
      CREATE TABLE IF NOT EXISTS activity (id TEXT PRIMARY KEY, exploration_county TEXT NOT NULL, duration_ms INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS candidates (identity TEXT PRIMARY KEY, candidate_id TEXT UNIQUE NOT NULL, exploration_county TEXT NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS candidate_observations (page_id TEXT NOT NULL, lead_index INTEGER NOT NULL, identity TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(page_id,lead_index));`);
    try { this.tx(() => {
      const existing = this.#db.prepare("SELECT value FROM meta WHERE key=?").get("plan_sha");
      if (existing && existing.value !== this.manifestSha256) throw new Error("plan-changed");
      if (!existing) this.#db.prepare("INSERT INTO meta(key,value) VALUES(?,?)").run("plan_sha", this.manifestSha256);
    }); } catch (error) { this.#db.close(); throw error; }
  }
  tx(fn) {
    this.#db.exec("BEGIN IMMEDIATE");
    try {
      const v = fn();
      this.#db.exec("COMMIT");
      return v;
    } catch (e) {
      this.#db.exec("ROLLBACK");
      throw e;
    }
  }
  page(id) {
    const page = this.plan.pages.find((p) => p.id === id);
    if (!page) throw new Error("unplanned-page");
    return page;
  }
  attempt(id) {
    return this.#db.prepare("SELECT * FROM attempts WHERE page_id=?").get(id);
  }
  reserve(pageId) {
    const p = this.page(pageId);
    return this.tx(() => {
      if (this.attempt(pageId)) return "already-reserved";
      if (p.parentPageId) {
        const parent = this.attempt(p.parentPageId);
        if (!parent || parent.status !== "finished" || parent.outcome !== "more") throw new Error("parent-not-continuable");
      }
      const all = this.#db.prepare("SELECT page_id,status FROM attempts").all();
      if (all.some(x => { const q = this.page(String(x.page_id)); const a = this.attempt(String(x.page_id)); return a?.status === 'finished' && ((q.provider === p.provider && ['refused', 'rate-limited'].includes(String(a.outcome))) || (q.sourceId === p.sourceId && q.scopeId === p.scopeId && ['malformed', 'unavailable', 'unknown'].includes(String(a.outcome)))); })) throw new Error('source-scope-held');
      const recorded = this.#db.prepare('SELECT exploration_county,duration_ms FROM activity').all();
      const budgetTotal = all.reduce((n,x) => n + this.page(String(x.page_id)).timeoutMs, 0) + recorded.reduce((n,x) => n + Number(x.duration_ms), 0);
      const budgetCounty = all.filter(x => this.page(String(x.page_id)).county === p.county).reduce((n,x) => n + this.page(String(x.page_id)).timeoutMs, 0) + recorded.filter(x => x.exploration_county === p.county).reduce((n,x) => n + Number(x.duration_ms), 0);
      if (budgetTotal + p.timeoutMs > this.plan.limits.activeMsTotal || budgetCounty + p.timeoutMs > this.plan.limits.activeMsPerCounty) throw new Error('active-time-budget-exhausted');
      if (all.length >= this.plan.limits.totalRequests || all.filter((x) => this.page(String(x.page_id)).provider === p.provider).length >= this.plan.limits.perProviderRequests) throw new Error("request-budget-exhausted");
      if (all.filter((x) => x.status === "reserved" || x.status === "issued").length >= this.plan.limits.concurrentAttempts) throw new Error("concurrency-budget-exhausted");
      const current = this.#db.prepare("SELECT exploration_county FROM candidates").all();
      const active = all.filter(x => x.status === 'reserved' || x.status === 'issued');
      const capacity = this.plan.limits.resultsPerPage;
      if (current.length + (active.length + 1) * capacity > Math.min(this.plan.limits.queue, this.plan.limits.totalLeads) || current.filter(x => x.exploration_county === p.county).length + (active.filter(x => this.page(String(x.page_id)).county === p.county).length + 1) * capacity > this.plan.limits.perCountyLeads) throw new Error('frontier-capacity-reservation');
      this.#db.prepare("INSERT INTO attempts(page_id,status) VALUES(?,?)").run(pageId, "reserved");
      return "reserved";
    });
  }
  // Exactly one invocation may receive a send permit. Once issued, a crash leaves
  // the charge uncertain; neither reopen nor repeated calls authorize a resend.
  markAttempt(pageId, issuedAt) {
    const p = this.page(pageId);
    if (!Number.isFinite(Date.parse(issuedAt)) || new Date(issuedAt).toISOString() !== issuedAt) throw new Error("invalid-issued-time");
    return this.tx(() => {
      const a = this.attempt(pageId);
      if (!a || a.status !== "reserved") throw new Error("attempt-not-reserved");
      const held = this.#db.prepare('SELECT page_id,outcome FROM attempts WHERE status=?').all('finished').some(x => { const q = this.page(String(x.page_id)); return q.provider === p.provider && ['refused','rate-limited'].includes(String(x.outcome)) || q.sourceId === p.sourceId && q.scopeId === p.scopeId && ['malformed','unavailable','unknown'].includes(String(x.outcome)); });
      if (held) throw new Error('source-scope-held');
      const attempts = this.#db.prepare('SELECT page_id FROM attempts').all();
      const activity = this.#db.prepare('SELECT exploration_county,duration_ms FROM activity').all();
      const totalTime = attempts.reduce((n,x) => n + this.page(String(x.page_id)).timeoutMs, 0) + activity.reduce((n,x) => n + Number(x.duration_ms), 0);
      const countyTime = attempts.filter(x => this.page(String(x.page_id)).county === p.county).reduce((n,x) => n + this.page(String(x.page_id)).timeoutMs, 0) + activity.filter(x => x.exploration_county === p.county).reduce((n,x) => n + Number(x.duration_ms), 0);
      if (totalTime > this.plan.limits.activeMsTotal || countyTime > this.plan.limits.activeMsPerCounty) throw new Error('active-time-budget-exhausted');
      this.#db.prepare("UPDATE attempts SET status=?,issued_at=? WHERE page_id=?").run("issued", issuedAt, pageId);
      return { attemptId: `attempt:${sha256(`${this.manifestSha256}\n${pageId}`)}`, operationNonce: sha256(`${this.manifestSha256}\n${pageId}`), pageId, manifestSha256: this.manifestSha256, issuedAt, requestSha256: p.requestSha256, request: { method: p.method, url: p.url, accept: p.accept, encoding: p.encoding, userAgent: p.userAgent, githubApiVersion: p.githubApiVersion, maxBytes: p.maxBytes, timeoutMs: p.timeoutMs, redirects: p.redirects } };
    });
  }
  finish(receiptInput, packetInput) {
    const receipt = DirectoryNativeReceiptSchema.parse(receiptInput), p = this.page(receipt.pageId);
    inspectSafe(receipt, p.provider);
    const packet = packetInput === void 0 ? null : DirectoryFactPacketSchema.parse(packetInput);
    return this.tx(() => {
      const a = this.attempt(receipt.pageId);
      if (a?.status === 'finished') {
        const prior = JSON.parse(String(a.receipt));
        if (canonical(prior) !== canonical(receipt) || (receipt.status === 'received' ? !packet || packet.projectionSha256 !== a.projection_sha || sha256(canonical(packet.facts)) !== a.projection_sha || sha256(canonical(packet)) !== a.packet_sha : packet !== null)) throw new Error('replay-mismatch');
        return {outcome: a.outcome, inserted: 0, pending: a.pending_count, replay: true};
      }
      if (!a || a.status !== "issued" || a.issued_at !== receipt.issuedAt) throw new Error("attempt-not-issued");
      if (this.#db.prepare('SELECT receipt FROM attempts WHERE receipt IS NOT NULL').all().some(x => JSON.parse(String(x.receipt)).id === receipt.id)) throw new Error('duplicate-receipt-id');
      if (receipt.manifestSha256 !== this.manifestSha256 || receipt.sourceId !== p.sourceId || receipt.scopeId !== p.scopeId || receipt.installation !== p.installation || receipt.qualificationSha256 !== p.qualificationSha256 || receipt.requestSha256 !== p.requestSha256 || receipt.responseBytes > p.maxBytes || (receipt.status === "received" && (Date.parse(receipt.completedAt) - Date.parse(receipt.issuedAt) > p.timeoutMs || receipt.parserRevision !== p.parserRevision || receipt.parserSha256 !== p.parserSha256))) throw new Error("receipt-binding-mismatch");
      if (receipt.status !== "received") {
        if (packet) throw new Error("failure-packet-forbidden");
        this.#db.prepare("UPDATE attempts SET status=?,receipt=?,outcome=? WHERE page_id=?").run("finished", JSON.stringify(receipt), receipt.status, p.id);
        return { outcome: receipt.status, inserted: 0, pending: 0 };
      }
      if (!packet || packet.receiptId !== receipt.id || packet.pageId !== p.id || packet.manifestSha256 !== this.manifestSha256 || packet.qualificationSha256 !== p.qualificationSha256 || packet.requestSha256 !== p.requestSha256 || packet.nativeBodySha256 !== receipt.nativeBodySha256 || packet.projectionSha256 !== receipt.projectionSha256 || sha256(canonical(packet)) !== receipt.packetSha256 || packet.parserRevision !== receipt.parserRevision || packet.parserSha256 !== receipt.parserSha256 || packet.projectionSha256 !== sha256(canonical(packet.facts)) || packet.observedDate !== new Date(receipt.completedAt).toISOString().slice(0, 10) || packet.facts.length > this.plan.limits.resultsPerPage) throw new Error("packet-binding-mismatch");
      safeFacts(packet, p.provider);
      const keys = /* @__PURE__ */ new Set();
      for (const [i, fact] of packet.facts.entries()) {
        const source = fact.frontier.source;
        if (source.kind !== "collection-lead" || source.lead.displayName !== fact.title || (source.lead.kind === 'artifact' ? (source.lead.sourceStage === 'preprint' ? 'preprint' : source.lead.artifactKind) : source.lead.kind) !== fact.kind || source.provider !== p.provider || source.sourceId !== p.sourceId || source.scopeId !== p.scopeId || source.pageReceiptId !== receipt.id || source.requestSha256 !== p.requestSha256 || source.representationSha256 !== receipt.nativeBodySha256 || source.leadIndex !== i || source.lead.nativeId !== fact.nativeId || fact.frontier.publicationAuthorized !== false) throw new Error("frontier-binding-mismatch");
        const key = identity(p.provider, p.installation, fact.nativeId);
        if (keys.has(key)) throw new Error("duplicate-page-identity");
        keys.add(key);
      }
      const existing = new Set(this.#db.prepare("SELECT identity FROM candidates").all().map((x) => String(x.identity)));
      const novel = packet.facts.filter((f) => !existing.has(identity(p.provider, p.installation, f.nativeId)));
      const countyCount = this.#db.prepare("SELECT COUNT(*) AS n FROM candidates WHERE exploration_county=?").get(p.county).n;
      const total = existing.size;
      if (total + novel.length > this.plan.limits.queue || total + novel.length > this.plan.limits.totalLeads || countyCount + novel.length > this.plan.limits.perCountyLeads) {
        this.#db.prepare("UPDATE attempts SET status=?,receipt=?,projection_sha=?,packet_sha=?,outcome=?,pending_count=?,pending_packet=? WHERE page_id=?").run("finished", JSON.stringify(receipt), packet.projectionSha256, sha256(canonical(packet)), "capped", packet.facts.length, JSON.stringify(packet), p.id);
        return { outcome: "capped", inserted: 0, pending: packet.facts.length };
      }
      for (const [i, f] of packet.facts.entries()) {
        const key = identity(p.provider, p.installation, f.nativeId);
        this.#db.prepare("INSERT INTO candidates(identity,candidate_id,exploration_county,payload) VALUES(?,?,?,?) ON CONFLICT(identity) DO NOTHING").run(key, f.frontier.id, p.county, JSON.stringify(f));
        this.#db.prepare("INSERT INTO candidate_observations(page_id,lead_index,identity,payload) VALUES(?,?,?,?)").run(p.id, i, key, JSON.stringify(f));
      }
      const nextPage = this.plan.pages.find(q => q.parentPageId === p.id);
      if (packet.continuation === 'more' && nextPage && packet.nextRequestSha256 !== nextPage.requestSha256) throw new Error('continuation-request-mismatch');
      const nextPlanned = Boolean(nextPage);
      const outcome = packet.facts.length === 0 || packet.continuation === "unknown" ? "unknown" : packet.providerIncomplete ? "capped" : packet.continuation === "none" ? "complete" : nextPlanned ? "more" : "capped";
      this.#db.prepare("UPDATE attempts SET status=?,receipt=?,projection_sha=?,packet_sha=?,outcome=? WHERE page_id=?").run("finished", JSON.stringify(receipt), packet.projectionSha256, sha256(canonical(packet)), outcome, p.id);
      return { outcome, inserted: novel.length, pending: 0 };
    });
  }
  recordActivity(id, county, durationMs) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._/-]{0,199}$/.test(id) || !this.plan.pages.some(p => p.county === county) || !Number.isSafeInteger(durationMs) || durationMs < 1) throw new Error('invalid-activity');
    return this.tx(() => { const prior = this.#db.prepare('SELECT exploration_county,duration_ms FROM activity WHERE id=?').get(id); if (prior) { if (prior.exploration_county !== county || prior.duration_ms !== durationMs) throw new Error('activity-replay-mismatch'); return 'already-recorded'; } this.#db.prepare('INSERT INTO activity(id,exploration_county,duration_ms) VALUES(?,?,?)').run(id,county,durationMs); return 'recorded'; });
  }
  pendingPacket(pageId) {
    this.page(pageId);
    const attempt = this.attempt(pageId);
    return attempt?.pending_packet ? JSON.parse(String(attempt.pending_packet)) : null;
  }
  listCandidates() {
    return this.#db.prepare('SELECT identity,candidate_id,exploration_county,payload FROM candidates ORDER BY identity').all().map(row => ({ identity: row.identity, candidateId: row.candidate_id, explorationCounty: row.exploration_county, fact: JSON.parse(String(row.payload)), observations: this.#db.prepare('SELECT page_id,lead_index FROM candidate_observations WHERE identity=? ORDER BY page_id,lead_index').all(row.identity) }));
  }
  progress() {
    return { manifestSha256: this.manifestSha256, attempts: this.#db.prepare("SELECT page_id,status,issued_at,outcome,pending_count FROM attempts ORDER BY page_id").all(), candidates: this.#db.prepare("SELECT COUNT(*) AS count FROM candidates").get() };
  }
  close() {
    this.#db.close();
  }
}
export {
  DirectoryAcquisitionStore
};
