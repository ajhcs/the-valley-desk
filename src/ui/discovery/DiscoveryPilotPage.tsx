import { useEffect, useState } from "react";
import { DiscoveryPilotResultSchema } from "../../content/discovery-pilot";
import type { DiscoveryPilotRecord, DiscoveryPilotResult, DiscoveryPilotCitation, DiscoveryPilotSearchMatch } from "../../content/discovery-pilot";
import { pilotAuthorPreview, pilotDateLabel, pilotRecordPath } from "./pilot-presentation";
import "./discovery-pilot.css";

const labels = { repository: "Repository", publication: "Publication", organization: "Organization" };
const providers = { github: "GitHub", crossref: "Crossref", ror: "ROR" };

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

function PilotRecord({ item, query, citations, match }: { item: DiscoveryPilotRecord; query: string; citations: DiscoveryPilotCitation[]; match: DiscoveryPilotSearchMatch }) {
  const [authorsOpen, setAuthorsOpen] = useState(false);
  const preview = pilotAuthorPreview(item.authors, query);
  const links = citations.filter(citation => citation.repository.id === item.id || citation.publication.id === item.id);
  const matchedCitation = links.find(citation => citation.repository.id === match.relatedRecordId || citation.publication.id === match.relatedRecordId);
  const matchedRecord = matchedCitation ? (match.basis === "cited-publication" ? matchedCitation.publication : matchedCitation.repository) : null;
  return <article className="PilotCard" aria-labelledby={`title-${item.id}`}>
    <div className="PilotCard-top"><span>{labels[item.kind]}</span><span>{providers[item.provider]}</span></div>
    <h2 id={`title-${item.id}`}><a href={item.url} rel="noreferrer">{item.title}</a></h2>
    {item.description ? <p className="PilotDescription">{item.description}</p> : null}
    {item.owner ? <p className="PilotByline">Repository owner: {item.owner.name} ({item.owner.kind === "Organization" ? "organization account" : "user account"})</p> : null}
    <p className="PilotDate">{item.sourceDate ? <>{item.sourceDate.label}: <time dateTime={item.sourceDate.value}>{pilotDateLabel(item.sourceDate.value)}</time></> : "Source date not supplied"}</p>
    <div className="PilotActions"><a className="PilotOriginal" href={item.url} rel="noreferrer">Open original {labels[item.kind].toLowerCase()}</a></div>
    {match.basis !== "own-metadata" && matchedRecord ? <p className="PilotMatch">Found through {match.basis === "cited-publication" ? "a cited publication" : "a repository citing this paper"}: <a href={pilotRecordPath(matchedRecord)}>{matchedRecord.title}</a>.</p> : null}
    {item.authors.length ? <div className="PilotAuthors">
      <h3>Authors in this source record ({item.authors.length})</h3>
      {!authorsOpen ? <ul className="PilotAuthorPreview" aria-label={preview.matchesSearch ? "Authors matching the search" : "Author preview"}>{preview.authors.map(author => <li key={author.sourceIndex}><strong>{author.name}</strong>
        {author.affiliations[0] ? <span className="PilotAffiliationPreview">{author.affiliations[0]}</span> : null}
      </li>)}</ul> : null}
      {!authorsOpen && item.authors.every(author => author.affiliations.length === 0) ? <p className="PilotMuted">Affiliations were not supplied in this metadata.</p> : null}
      <details open={authorsOpen} onToggle={event => setAuthorsOpen(event.currentTarget.open)}><summary>View all {item.authors.length} authors and affiliations</summary>
        <p className="PilotMuted">Affiliations reported with {item.sourceDate?.value.slice(0, 4) ?? "the"} publication; current roles and software contributions are not verified.</p>
        <ul>{item.authors.map(author => <li key={author.sourceIndex}><strong>{author.name}</strong>
          {author.affiliations.length ? <ul>{author.affiliations.map((affiliation, i) => <li key={i}>{affiliation}</li>)}</ul> : <span> — affiliation not supplied in this record</span>}
        </li>)}</ul>
      </details>
    </div> : null}
    {item.kind === "repository" ? <p className="PilotMuted">This repository record does not establish a regional work location.</p> : null}
    {item.kind === "organization" ? <p className="PilotMuted">Registry location: {item.geography.reportedLocations.join("; ") || "not supplied"}. This does not locate individual authors or their work.</p> : null}
    {links.length ? <div className="PilotRelated"><h3>{item.kind === "repository" ? "Cited publication" : "Repository citing this publication"}</h3><ul>{links.map(citation => {
      const related = item.kind === "repository" ? citation.publication : citation.repository;
      return <li key={related.id}><a className="PilotRelatedTitle" href={pilotRecordPath(related)}>{related.title}</a>
        <div className="PilotRelatedActions"><a href={pilotRecordPath(related)}>View {related.kind === "publication" ? "publication" : "repository"} metadata</a><a href={related.url} rel="noreferrer">Open original {related.kind}</a><a href={citation.evidence.url} rel="noreferrer">View citation evidence</a></div>
      </li>;
    })}</ul></div> : null}
    <details className="PilotSource"><summary>Source details · captured {pilotDateLabel(item.source.observedAt)}</summary>
      <dl><dt>Provider identifier</dt><dd>{item.nativeId}</dd>
        <dt>Metadata source</dt><dd><a href={item.source.url} rel="noreferrer">Original {providers[item.provider]} record</a></dd>
        <dt>Observed</dt><dd><time dateTime={item.source.observedAt}>{pilotDateLabel(item.source.observedAt)} (UTC)</time></dd>
        <dt>Metadata use basis</dt><dd><a href={item.source.useBasis.url} rel="noreferrer">{item.source.useBasis.label}</a></dd>
      </dl>
      {item.additionalDates.length ? <ul>{item.additionalDates.map(date => <li key={date.label}>{date.label}: <time dateTime={date.value}>{pilotDateLabel(date.value)}</time></li>)}</ul> : null}
      <details><summary>Technical source trace</summary><p>Original capture timestamp: <code>{item.source.observedAt}</code></p><p>Snapshot SHA-256: <code>{item.source.sha256}</code></p><ul>{item.provenance.map((ref, i) => <li key={i}>{ref.field}: <code>{ref.pointer}</code></li>)}</ul></details>
      {item.description ? <p>The repository description is source-reported metadata.</p> : null}
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

  return <section className="DiscoveryPilot" aria-labelledby="pilot-heading">
    <header className="PilotHeading"><p className="PilotEyebrow">Greater Philadelphia · Discovery pilot</p>
      <h1 id="pilot-heading">Explore health-tech research.</h1>
      <p>Find repositories, publications and the people named in their sources.</p>
      <p className="PilotScope">Historical source records · current roles unverified</p>
    </header>
    <form action="/discover" method="get" className="PilotFilters" aria-label="Filter the research directory">
      <label className="PilotSearch">Search work, authors or organizations<input type="search" name="q" maxLength={160} defaultValue={params.get("q") ?? ""} placeholder="Try MRI, CaPTk or Philip Cook" /></label>
      <div className="PilotField"><label htmlFor="pilot-kind">Record type</label><select id="pilot-kind" name="kind" defaultValue={params.get("kind") ?? "all"}><option value="all">All types</option><option value="repository">Repositories</option><option value="publication">Publications</option><option value="organization">Organizations</option></select></div>
      <div className="PilotField"><label htmlFor="pilot-sort">Sort by</label><select id="pilot-sort" name="sort" defaultValue={params.get("sort") ?? "title-asc"}><option value="title-asc">Title A–Z</option><option value="title-desc">Title Z–A</option><option value="source-date-desc">Newest source date</option><option value="source-date-asc">Oldest source date</option></select></div>
      <button type="submit">Apply filters</button><a href="/discover">Reset</a>
      <details className="PilotAdvanced" open={params.has("provider") && params.get("provider") !== "all"}><summary>More filters</summary><label htmlFor="pilot-provider">Metadata provider</label><select id="pilot-provider" name="provider" defaultValue={params.get("provider") ?? "all"}><option value="all">All providers</option><option value="github">GitHub</option><option value="crossref">Crossref</option><option value="ror">ROR</option></select></details>
    </form>
    <div className="PilotResultHeader"><div className="PilotStatus" role="status" aria-live="polite">
      {state.status === "loading" ? "Loading the selected collection…" : state.status === "error" ? state.message : `${state.result.filteredRecords} of ${state.result.totalRecords} selected records`}
    </div>{state.status === "ready" ? <details className="PilotAbout"><summary>About this pilot</summary><p>This is a selected source sample, not a complete regional roster. Records can describe the same project. Repository owners, publication authors and current professional roles are separate.</p><p>The DVRPC scope is Bucks, Chester, Delaware, Montgomery and Philadelphia counties in Pennsylvania; Burlington, Camden, Gloucester and Mercer in New Jersey. Publication affiliations do not establish current employment or where software was created.</p><p>Search includes complete author rosters from these metadata records and context from the two supported repository citations. It does not infer additional relationships or person identities.</p></details> : null}</div>
    {state.status === "ready" ? <>
      {state.result.items.length ? <div className="PilotGrid">{state.result.items.map(item => <PilotRecord key={item.id} item={item} query={state.result.query.q} citations={state.result.citations} match={state.result.matches.find(match => match.recordId === item.id)!} />)}</div> : <section className="PilotEmpty"><h2>No records match these filters.</h2><p>Try a broader term or <a href="/discover">reset the filters</a>.</p></section>}
    </> : state.status === "error" ? <p><a href="/discover">Reset filters and reload</a></p> : null}
  </section>;
}
