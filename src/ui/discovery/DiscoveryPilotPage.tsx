import { useEffect, useState } from "react";
import { DiscoveryPilotResultSchema } from "../../content/discovery-pilot";
import type { DiscoveryPilotRecord, DiscoveryPilotResult } from "../../content/discovery-pilot";
import "./discovery-pilot.css";

const labels = { repository: "Repository", publication: "Publication", organization: "Organization" };
const providers = { github: "GitHub", crossref: "Crossref", ror: "ROR" };
const dateLabel = (value: string) => value.length > 10 ? `${value.slice(0, 10)} (UTC)` : value;

async function readBoundedMetadata(response: Response) {
  if (!(response.headers.get("content-type") ?? "").includes("application/json") || !response.body) throw new Error("Unexpected response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 1_048_576) throw new Error("Response too large");
      text += decoder.decode(part.value, { stream: true });
    }
    return DiscoveryPilotResultSchema.parse(JSON.parse(text + decoder.decode()));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function PilotRecord({ item }: { item: DiscoveryPilotRecord }) {
  return <article className="PilotCard" aria-labelledby={`title-${item.id}`}>
    <div className="PilotCard-top"><span>{labels[item.kind]}</span><span>{providers[item.provider]}</span></div>
    <h2 id={`title-${item.id}`}><a href={item.url} rel="noreferrer">{item.title}</a></h2>
    {item.owner ? <p className="PilotByline">Repository owner: {item.owner.name} ({item.owner.kind === "Organization" ? "organization account" : "user account"})</p> : null}
    {item.authors.length ? <div className="PilotAuthors">
      <h3>Selected publication authors</h3>
      <p>{item.authors.slice(0, 3).map(author => author.name).join(" · ")}{item.authors.length > 3 ? ` · ${item.authors.length - 3} more` : ""}</p>
      <details><summary>Selected authors and reported affiliations</summary>
        <ul>{item.authors.map(author => <li key={author.sourceIndex}><strong>{author.name}</strong>
          {author.affiliations.length ? <ul>{author.affiliations.map((affiliation, i) => <li key={i}>{affiliation}</li>)}</ul> : <span> — affiliation not supplied in this record</span>}
        </li>)}</ul>
        <p>These are publication-reported affiliations, not verified current roles or software contributions.</p>
      </details>
    </div> : null}
    <div className="PilotRegional">
      <h3>{item.geography.basis === "publication-reported-affiliation" ? "Publication-reported affiliations" : item.geography.basis === "registry-reported-location" ? "Organization registry location" : "Regional basis"}</h3>
      {item.geography.reportedLocations.length ? <ul>{item.geography.reportedLocations.map((location, i) => <li key={i}>{location}</li>)}</ul> : <p>Not established by this metadata record.</p>}
      {item.geography.basis === "registry-reported-location" ? <p>An organization location does not locate its authors or their work.</p> : null}
    </div>
    <p className="PilotDate">{item.sourceDate ? <>{item.sourceDate.label}: <time dateTime={item.sourceDate.value}>{dateLabel(item.sourceDate.value)}</time></> : "Source date not supplied"}</p>
    {item.relatedLinks.length ? <div className="PilotRelated"><h3>Cited publications</h3><ul>{item.relatedLinks.map(link => <li key={link.targetId}>
      <a href={link.url} rel="noreferrer">{link.targetTitle}</a>{" "}<a className="PilotEvidenceLink" href={link.evidence.url} rel="noreferrer">Repository citation</a>
      <small>Observed {dateLabel(link.evidence.observedAt)} through the GitHub connector.</small>
    </li>)}</ul></div> : null}
    <a className="PilotOriginal" href={item.url} rel="noreferrer">Open {labels[item.kind].toLowerCase()} <span aria-hidden="true">↗</span></a>
    <details className="PilotSource"><summary>Source and metadata provenance</summary>
      <dl><dt>Provider identifier</dt><dd>{item.nativeId}</dd>
        <dt>Metadata source</dt><dd><a href={item.source.url} rel="noreferrer">Original {providers[item.provider]} record</a></dd>
        <dt>Observed</dt><dd><time dateTime={item.source.observedAt}>{item.source.observedAt}</time></dd>
        <dt>Metadata use basis</dt><dd><a href={item.source.useBasis.url} rel="noreferrer">{item.source.useBasis.label}</a></dd>
        <dt>Source snapshot SHA-256</dt><dd><code>{item.source.sha256}</code></dd>
      </dl>
      {item.additionalDates.length ? <ul>{item.additionalDates.map(date => <li key={date.label}>{date.label}: <time dateTime={date.value}>{dateLabel(date.value)}</time></li>)}</ul> : null}
      <details><summary>Field trace</summary><ul>{item.provenance.map((ref, i) => <li key={i}>{ref.field}: <code>{ref.pointer}</code></li>)}</ul></details>
      <p>The metadata use basis does not license the repository software, article text or linked materials.</p>
    </details>
  </article>;
}

type LoadState = { status: "loading" } | { status: "ready"; result: DiscoveryPilotResult } | { status: "error"; message: string };

export function DiscoveryPilotPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const search = typeof window === "undefined" ? "" : window.location.search;
  const params = new URLSearchParams(search);
  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    void (async () => {
      try {
        const response = await fetch(`/api/discovery-pilot${search}`, { signal: controller.signal, credentials: "omit", cache: "no-store" });
        if (!response.ok) {
          setState({ status: "error", message: response.status === 400 ? "These filters are not supported. Reset the filters and try again." : response.status === 404 ? "The discovery pilot is not available in this environment." : "The directory could not be loaded. Please try again." });
          return;
        }
        const result = await readBoundedMetadata(response);
        if (!controller.signal.aborted) setState({ status: "ready", result });
      } catch {
        if (!controller.signal.aborted) setState({ status: "error", message: "The directory could not be loaded. Please try again." });
      }
    })();
    return () => controller.abort();
  }, [search]);

  return <main id="main-content" className="DiscoveryPilot" tabIndex={-1}>
    <header className="PilotHeading"><p className="PilotEyebrow">Discovery pilot</p>
      <h1>Health-tech research, at the source.</h1>
      <p>Explore a selected collection of repositories, publications and organizations connected with regional research. Follow the original sources to learn more.</p>
      <p className="PilotScope">Focus: the nine-county DVRPC region in Pennsylvania and New Jersey. Publication affiliations describe the source record; current employment and the location where work was created are not established.</p>
    </header>
    <form action="/discover" method="get" className="PilotFilters" aria-label="Filter the research directory">
      <label className="PilotSearch">Search work, authors or organizations<input type="search" name="q" maxLength={160} defaultValue={params.get("q") ?? ""} placeholder="Try MRI, genomics or Philadelphia" /></label>
      <div className="PilotField"><label htmlFor="pilot-kind">Record type</label><select id="pilot-kind" name="kind" defaultValue={params.get("kind") ?? "all"}><option value="all">All types</option><option value="repository">Repositories</option><option value="publication">Publications</option><option value="organization">Organizations</option></select></div>
      <div className="PilotField"><label htmlFor="pilot-provider">Metadata provider</label><select id="pilot-provider" name="provider" defaultValue={params.get("provider") ?? "all"}><option value="all">All providers</option><option value="github">GitHub</option><option value="crossref">Crossref</option><option value="ror">ROR</option></select></div>
      <div className="PilotField"><label htmlFor="pilot-sort">Sort by</label><select id="pilot-sort" name="sort" defaultValue={params.get("sort") ?? "title-asc"}><option value="title-asc">Title A–Z</option><option value="title-desc">Title Z–A</option><option value="source-date-desc">Newest source date</option><option value="source-date-asc">Oldest source date</option></select></div>
      <button type="submit">Apply filters</button><a href="/discover">Reset</a>
    </form>
    <div className="PilotStatus" role="status" aria-live="polite">
      {state.status === "loading" ? "Loading the selected collection…" : state.status === "error" ? state.message : `${state.result.filteredRecords} of ${state.result.totalRecords} selected records`}
    </div>
    {state.status === "ready" ? <>
      <p className="PilotCollectionNote">This is a limited source sample, not a complete regional roster. Counts describe records, including related representations of the same project. Repository owners and publication authors are separate roles.</p>
      {state.result.items.length ? <div className="PilotGrid">{state.result.items.map(item => <PilotRecord key={item.id} item={item} />)}</div> : <section className="PilotEmpty"><h2>No records match these filters.</h2><p>Try a broader term or <a href="/discover">reset the filters</a>.</p></section>}
    </> : state.status === "error" ? <p><a href="/discover">Reset filters and reload</a></p> : null}
  </main>;
}
