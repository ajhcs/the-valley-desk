import { useEffect, useRef, useState } from "react";
import type { readEditorialProposal } from "../ingest/watch-editorial";
import { validateEditorialDetail } from "./watch-editorial-client";
import "./watch-editorial-review.css";

type Detail = NonNullable<Awaited<ReturnType<typeof readEditorialProposal>>>;
type Queue = { items: Array<{ id: string; subjectId: string; subjectRevision: number; kind: string }>; nextCursor: string | null };
async function request(path: string, init?: RequestInit) {
  const signal = AbortSignal.any([AbortSignal.timeout(20_000), ...(init?.signal ? [init.signal] : [])]);
  const response = await fetch(`/ops/api/watch-drafts${path}`, { credentials: "same-origin", cache: "no-store", redirect: "error", ...init, signal });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${body?.error ?? "watch-review-request-failed"} (${response.status})`);
  if (!body || typeof body !== "object") throw new Error("watch-review-invalid-response");
  return body;
}

export function WatchEditorialReview() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [queueError, setQueueError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [receipt, setReceipt] = useState("");
  const [recordedAction, setRecordedAction] = useState<"accepted" | "rejected" | null>(null);
  const submitting = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    setQueue(null); setQueueError("");
    void request(cursor ? `?after=${encodeURIComponent(cursor)}` : "", { signal: controller.signal }).then(value => {
      if (!Array.isArray(value.items) || value.items.some((item: Queue["items"][number]) => typeof item.id !== "string") ||
        !(value.nextCursor === null || typeof value.nextCursor === "string")) throw new Error("watch-review-invalid-queue");
      if (!controller.signal.aborted) setQueue(value);
    }).catch(reason => { if (!controller.signal.aborted) setQueueError(String(reason.message ?? reason)); });
    return () => controller.abort();
  }, [cursor, refresh]);
  useEffect(() => {
    const controller = new AbortController();
    setDetail(null); setError(""); setConfirmed(false); setReceipt(""); setRecordedAction(null);
    if (selected) void request(`/${encodeURIComponent(selected)}`, { signal: controller.signal }).then(async value => {
      const validated = await validateEditorialDetail(value, selected);
      if (!controller.signal.aborted) setDetail(validated);
    }).catch(reason => { if (!controller.signal.aborted) setError(String(reason.message ?? reason)); });
    return () => controller.abort();
  }, [selected, refresh]);
  async function decide(action: "accepted" | "rejected") {
    if (!detail || !confirmed || submitting.current) return;
    submitting.current = true; setBusy(true); setError(""); setReceipt("");
    try {
      const result = await request(`/${encodeURIComponent(detail.id)}/decision`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ sha256: detail.sha256, action }) });
      if (typeof result.decisionId !== "string" || typeof result.outcome !== "string") throw new Error("watch-review-invalid-receipt");
      setReceipt(`Decision ${action}: ${result.outcome}. Receipt ${result.decisionId}`);
      setRecordedAction(action);
      setQueue(previous => previous ? { ...previous, items: previous.items.filter(item => item.id !== detail.id) } : previous);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "watch-review-request-failed"); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <section className="WatchEditorialReview" aria-labelledby="watch-review-title">
    <header><h2 id="watch-review-title">Watch editorial review</h2><button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Refresh</button></header>
    {queueError ? <p role="alert">{queueError}</p> : !queue ? <p role="status">Loading drafts...</p> : null}
    {queue ? <><ul className="WatchEditorialReview-queue">{queue.items.map(item => <li key={item.id}><button disabled={busy} type="button" aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}>{item.kind}: {item.subjectId} · revision {item.subjectRevision}</button></li>)}</ul>
      {!queue.items.length ? <p>No pending drafts on this page.</p> : null}
      <nav aria-label="Draft pages"><button type="button" disabled={busy || !cursor} onClick={() => setCursor(null)}>First page</button><button type="button" disabled={busy || !queue.nextCursor} onClick={() => setCursor(queue.nextCursor)}>Next page</button></nav></> : null}
    {error ? <p role="alert">{error}</p> : null}
    {selected && !detail && !error ? <p role="status">Loading proposal...</p> : null}
    {detail ? <div className="WatchEditorialReview-detail">
      <h3>{detail.proposal.draft.kind}: {detail.proposal.draft.id}</h3>
      <dl><dt>Revision</dt><dd>{detail.proposal.draft.subjectRevision}</dd><dt>Proposal SHA-256</dt><dd><code>{detail.sha256}</code></dd><dt>Created</dt><dd>{detail.createdAt}</dd><dt>Decision</dt><dd>{detail.decision?.action ?? "Pending"}</dd></dl>
      <h4>Proposed facts</h4>{detail.proposal.facts.map(fact => <div className="WatchEditorialReview-fact" key={fact.id}><h5>{fact.field}</h5><pre>{JSON.stringify(fact.value, null, 2)}</pre><p>Fact: {fact.id}</p><p>Evidence: {fact.evidenceIds.join(", ")}</p>{fact.interpretationDependencies ? <pre>{JSON.stringify(fact.interpretationDependencies, null, 2)}</pre> : null}</div>)}
      <h4>Retained evidence</h4>{detail.proposal.evidence.map(evidence => <div className="WatchEditorialReview-evidence" key={evidence.id}><h5>{evidence.id}</h5><a href={evidence.sourceUrl.startsWith("https://") ? evidence.sourceUrl : undefined} target="_blank" rel="noreferrer">{evidence.sourceLabel}</a><pre>{evidence.kind === "structured" ? evidence.valueJson : evidence.quote}</pre><details><summary>Provenance and exact location</summary><pre>{JSON.stringify(evidence, null, 2)}</pre></details></div>)}
      <details><summary>Complete stored proposal</summary><pre>{JSON.stringify(detail.proposal, null, 2)}</pre></details>
      <label className="WatchEditorialReview-confirm"><input type="checkbox" disabled={busy} checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> Evidence and proposed values reviewed for this exact revision</label>
      <div className="WatchEditorialReview-actions"><button type="button" disabled={busy || !confirmed || (recordedAction ?? detail.decision?.action) === "rejected"} onClick={() => void decide("accepted")}>{(recordedAction ?? detail.decision?.action) === "accepted" ? "Retry accepted delivery" : "Accept reviewed proposal"}</button><button type="button" disabled={busy || !confirmed || !!detail.decision || !!recordedAction} onClick={() => void decide("rejected")}>Reject proposal</button></div>
      {busy ? <p role="status">Recording decision...</p> : null}{receipt ? <p role="status">{receipt}</p> : null}
    </div> : null}
  </section>;
}
