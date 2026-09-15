import { useEffect, useState, type FormEvent } from "react";
import type { policyBaselineView } from "../ingest/policy-pdf";
import { provisionContext, type EvidencePage, type Provision } from "../ingest/policy-provisions";
import { publicFeatures } from "../lib/public-features";
import { NotFound } from "./NotFound";
import "./policy-baseline.css";

type Baseline = Awaited<ReturnType<typeof policyBaselineView>>;
type Bill = Baseline["bills"][number];
type Group = Bill["provisions"][number];
function date(value: string | null | undefined, dateOnly = false) {
  if (!value) return "Unavailable — evidence required";
  const parsed = new Date(value);
  return Number.isFinite(parsed.valueOf()) ? dateOnly ? parsed.toISOString().slice(0,10) : parsed.toISOString().replace("T", " ").replace(".000Z", "Z").replace("Z", " UTC") : "Invalid source date — review required";
}
function officialLink(value: string | undefined) {
  try { const url = new URL(value ?? ""); return url.protocol === "https:" && ["palegis.us", "www.palegis.us"].includes(url.host) ? url.href : undefined; }
  catch { return undefined; }
}

function ProvisionReview({ bill, group, onSaved }: { bill: Bill; group: Group; onSaved: () => void }) {
  const [pages, setPages] = useState<EvidencePage[]>([]);
  const [loaded, setLoaded] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [decision, setDecision] = useState("hold");
  const [summary, setSummary] = useState(group.summary ?? "");
  const [questions, setQuestions] = useState<string>(group.questions.join("\n"));
  const [note, setNote] = useState("");
  const [spans, setSpans] = useState<Array<{page:number;line:number;quote:string}>>([]);
  const artifactId = bill.artifact!.id;
  const evidence = group.evidence;
  const context = evidence ? provisionContext(evidence, bill.provisions.map(g => g.evidence).filter((g): g is Provision => !!g)) : [];
  const requiredPages = [...new Set(context.flatMap(g => g.parts.map(p => p.page)))].sort((a,b) => a-b);
  const unresolved = context.some(g => g.unresolvedReferences.length > 0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/ops/api/policy-pdf/${artifactId}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(`Evidence request failed (${response.status})`); return response.json(); })
      .then(value => setPages(value.pages))
      .catch(reason => { if (!controller.signal.aborted) setError(String(reason)); });
    return () => controller.abort();
  }, [artifactId]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await fetch(`/ops/api/policy-provisions/${group.id}/review`, { method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ evidenceSha256: group.evidenceSha256,
          decision, summary, supportingSpans:spans, questions: questions.split("\n").map(q => q.trim()).filter(Boolean),
          renderedPages: requiredPages.filter(n => loaded.includes(n)).map(n => ({ page: n, sha256: pages.find(p => p.pageNumber === n)!.renderSha256 })),
          verificationNote: note, confirmedDefinitionsExceptionsAndReferences: confirmed }),
      });
      if (!response.ok) { const result = await response.json(); throw new Error(`Review not saved: ${result.error} (${response.status})`); }
      onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Review failed"); }
    finally { setSaving(false); }
  }
  return <section className="PolicyReview" aria-label={`Evidence review: ${group.heading}`}>
    <p>This decision applies only to this provision hash and its complete referenced context. It cannot authorize a news article.</p>
    <p><a href={`/ops/api/policy-pdf/${artifactId}/content`}>Download retained original PDF</a> · checksum <code>{bill.artifact!.sha256}</code></p>
    {unresolved ? <p role="status">Approval blocked: external or ambiguous references still require evidence. Record a specific hold.</p> : null}
    {context.map(g => <details key={g.ordinal} open={g.ordinal === evidence?.ordinal}>
      <summary>{g.ordinal === evidence?.ordinal ? "Complete provision" : "Required context"}: {g.heading}</summary>
      <ol className="PolicyLines">{g.parts.map(p => <li key={`${p.page}-${p.line}`}>
        <small>PDF p. {p.page}, extracted line {p.line + 1}{p.marks.length ? ` · ${p.marks.join(", ")} hint — check render` : ""}</small>
        <span>{p.text}</span>
        {p.text.length >= 12 ? <label className="PolicyCheckbox"><input type="checkbox" aria-label={`Cite page ${p.page} line ${p.line+1}`}
          checked={spans.some(s=>s.page===p.page&&s.line===p.line)}
          onChange={e=>setSpans(old=>e.target.checked ? [...old,{page:p.page,line:p.line,quote:p.text}].slice(-12) : old.filter(s=>s.page!==p.page||s.line!==p.line))} />Use as literal supporting evidence</label> : null}
      </li>)}</ol>
    </details>)}
    <details><summary>Rendered pages required for this interpretation ({requiredPages.join(", ")})</summary>
      <p>Compare all additions, deletions, definitions, exceptions and references. Extracted text does not resolve amendment typography.</p>
      {requiredPages.map(n => <figure key={n}>
        <img loading="lazy" src={`/ops/api/policy-pdf/${artifactId}/pages/${n}/render`} alt={`${bill.bill} ${bill.printer}, complete PDF page ${n}`}
          onLoad={() => setLoaded(old => old.includes(n) ? old : [...old,n])} onError={() => setError(`Rendered page ${n} unavailable; approval blocked.`)} />
        <figcaption>PDF page {n} · <a href={`${officialLink(bill.textUrl)}#page=${n}`} target="_blank" rel="noreferrer">Official original, page {n}</a></figcaption>
      </figure>)}
    </details>
    <form onSubmit={event => void submit(event)}>
      <p>Approved summaries and unresolved questions are public background. Keep private operational details in the verification note, which is not delivered to readers.</p>
      <label>Decision<select aria-label="Decision" value={decision} onChange={e => setDecision(e.target.value)}>
        <option value="hold">Evidence / interpretation hold</option><option value="approved" disabled={unresolved}>Approve background summary only</option>
      </select></label>
      <label>Proposed provision summary<textarea aria-label="Proposed provision summary" value={summary} maxLength={4000} onChange={e => setSummary(e.target.value)} /></label>
      <p>{spans.length}/12 literal evidence spans selected. Every substantive claim must be supported; selecting a span does not verify interpretation.</p>
      <label>Unresolved questions (one per line; required for a hold)<textarea aria-label="Unresolved questions" value={questions} onChange={e => setQuestions(e.target.value)} /></label>
      <label>Rendered-page verification note<textarea aria-label="Rendered-page verification note" required minLength={20} maxLength={3000} value={note} onChange={e => setNote(e.target.value)} /></label>
      <label className="PolicyCheckbox"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
        I checked the summary against these rendered pages, including amendment formatting, definitions, exceptions and references.</label>
      <button disabled={saving || (decision === "approved" && (!confirmed || unresolved || !spans.length || !pages.length || requiredPages.some(n => !loaded.includes(n))))}>
        {saving ? "Saving…" : "Record evidence-specific decision"}
      </button>
    </form>
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}

export function PolicyBaseline({ review = false }: { review?: boolean }) {
  const [data, setData] = useState<Baseline | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void fetch(review ? "/ops/api/policy-background" : "/api/policy-watchlist", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(`Policy evidence unavailable (${response.status})`); return response.json(); })
      .then(value => { if (value.kind !== "policy-background" || !Array.isArray(value.bills)) throw new Error("Invalid policy evidence response"); setData(value); setError(""); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Policy evidence unavailable"); });
    return () => controller.abort();
  }, [review, revision]);
  return <section className="PolicyBaseline" aria-label={review ? "Private policy evidence review" : "Policy background"}>
    <p className="PolicyKicker">Pennsylvania · Legislative background{review ? " · Private review" : ""}</p>
    {review ? <h2>Policy evidence review</h2> : <h1>Healthcare policy watchlist</h1>}
    <p className="PolicyIntro">What is proposed, what has been observed, and what still needs interpretation. These older legislative materials are background—not newly reported developments or enacted requirements.</p>
    {error ? <p role="alert">{error} <button onClick={() => setRevision(n => n+1)}>Retry read-only request</button></p> : null}
    {!data && !error ? <p role="status">Loading retained policy evidence…</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {data?.bills.length === 0 ? <p>No tracked bill records are available. This is not evidence of successful PDF processing.</p> : null}
    {data?.bills.length ? <nav className="PolicyJump" aria-label="Tracked bills">{data.bills.map(b=><a key={b.versionId} href={`#bill-${b.versionId}`}>{b.bill} · {b.printer}</a>)}</nav> : null}
    {data?.bills.map(bill => <article className="PolicyBill" key={bill.versionId} aria-labelledby={`bill-${bill.versionId}`}>
      <header><h2 id={`bill-${bill.versionId}`}>{bill.bill}</h2><p>Session {bill.session} · {bill.printer}</p></header>
      <dl className="PolicyFacts">
        <div><dt>Latest observed action</dt><dd>{bill.action || "Unavailable — review required"}</dd></div>
        <div><dt>Legislative action date</dt><dd>{date(bill.actionAt,true)}</dd></div>
        <div><dt>Text-version date</dt><dd>{date(bill.textDate,true)}</dd></div>
        <div><dt>Record last observed</dt><dd>{date(bill.observedAt)}</dd></div>
        <div><dt>PDF captured</dt><dd>{bill.artifact ? date(bill.artifact.capturedAt) : "Not yet retained"}</dd></div>
        <div><dt>Evidence processing</dt><dd>{bill.artifact ? `${bill.artifact.state}${bill.artifact.pageCount ? ` · ${bill.artifact.pageCount} pages` : ""}${bill.artifact.error ? ` · ${bill.artifact.error}` : ""}` : "Pending authorized PDF capture and extraction"}</dd></div>
      </dl>
      <p className="PolicyCitations"><a href={officialLink(bill.sourceUrl)}>Official bill history</a> · <a href={officialLink(bill.textUrl)}>Selected official text ({bill.printer})</a></p>
      {bill.artifact ? <details><summary>Version-bound evidence identity</summary><p>SHA-256 <code>{bill.artifact.sha256}</code></p><p>Artifact <code>{bill.artifact.id}</code></p></details> : null}
      <h3>Proposed provisions &amp; interpretation</h3>
      <p>Section groups preserve printed wording across page breaks. A summary appears only after rendered-page review; unreviewed groups are not claims about the proposal.</p>
      {bill.provisions.length && !bill.provisions.some(g=>g.decision==="approved") ? <p><strong>Interpretation remains open.</strong> No substantive summary has been approved for this text. The section index preserves the proposal and its unresolved questions for review.</p> : null}
      {!bill.provisions.length ? <p>Provisions unavailable until complete evidence is retained. No substantive interpretation has been admitted.</p> : null}
      {bill.provisions.length ? <details className="PolicySectionIndex" open={review || bill.provisions.some(g=>g.decision==="approved")}><summary>Section index and interpretations ({bill.provisions.length} groups)</summary>
      {[...bill.provisions].sort((a,b)=>Number(b.decision==="approved")-Number(a.decision==="approved")).map(group => <details className="PolicyProvision" key={group.id} open={group.decision === "approved"}>
        <summary><span>{group.heading}</span><small>{group.decision === "approved" ? "Reviewed background summary" : group.decision === "hold" ? "Interpretation hold" : "Not yet interpreted"}</small></summary>
        {group.summary ? <p className="PolicySummary">{group.summary}</p> : <p>No summary admitted.</p>}
        {group.questions.length ? <ul>{group.questions.map((q: string,i: number) => <li key={i}>{q}</li>)}</ul> : null}
        <p>Selected text, PDF {group.pages.length === 1 ? "page" : "pages"} {group.pages.map((n,i) => <span key={n}>{i ? ", " : ""}<a href={`${officialLink(bill.textUrl)}#page=${n}`}>{n}</a></span>)} · {bill.printer}</p>
        {group.reviewedContextPages.length ? <p>Reviewed context, including definitions and exceptions: {group.reviewedContextPages.map((n,i)=><span key={n}>{i?", ":""}<a href={`${officialLink(bill.textUrl)}#page=${n}`}>p. {n}</a></span>)}</p> : null}
        {group.references.length ? <p>Printed section references: {group.references.join(", ")}. Reference presence alone does not establish its meaning.</p> : null}
        {review ? <><button onClick={() => setOpen(open === group.id ? null : group.id)}>{open === group.id ? "Close evidence review" : "Inspect full evidence and record review"}</button>
          {open === group.id ? <ProvisionReview bill={bill} group={group} onSaved={() => { setOpen(null); setRevision(n => n+1); setNotice("Evidence-specific review saved. No publication was authorized."); }} /> : null}</> : null}
      </details>)}</details> : null}
    </article>)}
    <p className="PolicyTiming">Background interpretation does not establish collection timeliness. Prospective timing requires a genuinely new official development; no eligible samples means no conclusion.</p>
  </section>;
}

export function PolicyBaselinePage() { return publicFeatures().policyBackground ? <PolicyBaseline /> : <NotFound />; }
