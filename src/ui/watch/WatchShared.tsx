/** @jsxRuntime automatic */
import type { PaHealthEntry } from "../../content/pa-source-freshness";
import { Link } from "@tanstack/react-router";
import type { WatchKind } from "../../content/watch-query";
import type { WatchPublicRecord } from "../../content/watch-schema";
import type { WatchReadError } from "./watch-api";
import { instantLabel, watchLabel } from "./watch-labels";
import { useWatchSaves } from "./watch-saves";

export function WatchSave({ item }: { item: WatchPublicRecord }) {
  const saves = useWatchSaves();
  const saved = saves.items.some(value => value.kind === item.kind && value.id === item.id);
  return <label className="WatchSave"><input type="checkbox" checked={saved}
    aria-label={`Save ${item.title}`} onChange={event => saves.setSaved(item.kind, item.id, event.target.checked)} />
    <span>{saved ? "Saved" : "Save"}</span></label>;
}

export function WatchSaveNotice() {
  const { message, sessionOnly } = useWatchSaves();
  return message || sessionOnly ? <p className="WatchNote" role="status">{message ?? "Saved preferences are available for this visit only."}</p> : null;
}

export function WatchSources({ item, fact, label = "Sources" }: {
  item: WatchPublicRecord; fact?: { evidenceIds: string[]; verifiedAt?: string } | null; label?: string;
}) {
  const sources = fact ? item.sources.filter(source => fact.evidenceIds.includes(source.id)) : item.sources;
  if (!sources.length) return null;
  return <details className="WatchSources"><summary>{label} ({sources.length})</summary>
    {fact?.verifiedAt ? <p className="WatchNote">Fact verified <time dateTime={fact.verifiedAt}>{instantLabel(fact.verifiedAt)}</time></p> : null}
    <ul>{sources.map(source => <li key={source.id}>
      <a href={source.url} rel="noreferrer">{source.label}</a>
      <p className="WatchNote">{new URL(source.url).hostname}{source.locator ? ` | ${source.locator}` : ""}</p>
      {source.quote ? <blockquote>{source.quote}</blockquote> : null}
    </li>)}</ul>
  </details>;
}

export function WatchUnknowns({ item }: { item: WatchPublicRecord }) {
  if (!item.unknowns.length) return null;
  return <section className="WatchSection"><h2>Not Yet Established</h2>
    <dl className="WatchFacts">{item.unknowns.map((unknown, index) => <div key={`${unknown.field}-${index}`}>
      <dt>{watchLabel(unknown.field)}</dt><dd>{unknown.reason}</dd>
    </div>)}</dl>
  </section>;
}

export function WatchDataStatus({ asOf, stale }: { asOf: string | null; stale: boolean }) {
  return <div className={`WatchDataStatus${stale ? " is-stale" : ""}`}>
    {stale ? <p role="status"><strong>Retained snapshot.</strong> Live data is unavailable; this accepted snapshot may be out of date.</p> : null}
    <p>Accepted publication snapshot as of {asOf ? <time dateTime={asOf}>{instantLabel(asOf)}</time> : "not established"}.
      {" "}Source-check freshness is not established.</p>
  </div>;
}

export function WatchError({ error, retry, kind, firstPage }: {
  error: WatchReadError; retry: () => void; kind: WatchKind; firstPage?: string;
}) {
  const message = {
    "not-found": ["Record not found", "No public Watch record is available at this address."],
    held: ["Record held for evidence review", "Supporting evidence changed or no longer meets the publication requirements. Earlier facts are not displayed."],
    unavailable: ["Watch data is unavailable", "The directory service could not return accepted records. This does not mean there are no records."],
    "invalid-query": ["Check your filters", "The service did not accept these filters. Reset them or revise the query."],
    "cursor-expired": ["This page has expired", "The directory changed after this page link was issued. Return to the first page to continue."],
    "invalid-response": ["Watch data could not be verified", "The response did not match the public record contract. No facts from that response are displayed."],
    network: ["Watch data could not be reached", "The request did not complete. Check your connection and retry."],
    timeout: ["The Watch request timed out", "The directory service did not respond in time. No earlier facts are being shown."],
  }[error.code];
  return <section className="WatchState" role="alert"><h2>{message[0]}</h2><p>{message[1]}</p>
    <div className="WatchActions">
      {error.code !== "not-found" && error.code !== "invalid-query" && error.code !== "cursor-expired" ? <button type="button" onClick={retry}>Retry</button> : null}
      {firstPage ? <a href={firstPage}>Return to the first page</a> :
        <Link to={kind === "policy" ? "/policy-watch" : "/technology-watch"} search={{}}>Return to directory</Link>}
    </div>
  </section>;
}

export function PaSourceHealth({ entries, items = [] }: { entries: PaHealthEntry[]; items?: WatchPublicRecord[] }) {
  if (!entries.length) return null;
  const clock = (value:string|null) => value ? <time dateTime={value}>{instantLabel(value)}</time> : "unknown";
  return <section className="WatchSection"><h2>PA source freshness</h2>{entries.map(entry => <div key={`${entry.subjectId}:${entry.sourceId}`}>
    <p>{items.find(item=>item.id===entry.subjectId) ? <a href={`/policy-watch/${items.find(item=>item.id===entry.subjectId)!.slug}`}>{items.find(item=>item.id===entry.subjectId)!.title}</a> : 'PA bill'}{' | '}
      {items.find(item=>item.id===entry.subjectId)?.sources.find(source=>source.sourceId===entry.sourceId)?.label ?? entry.sourceId}</p>
    <p>Export freshness: {entry.health.freshness}. Latest bill status remains unverified.</p>
    <dl className="WatchFacts">
      <div><dt>Export timestamp</dt><dd>{clock(entry.health.exportAt)}</dd></div>
      <div><dt>Export age</dt><dd>{entry.health.exportAgeMs === null ? "unknown" : `${Math.floor(entry.health.exportAgeMs / 60_000)} minutes`}</dd></div>
      <div><dt>Bill last update</dt><dd>{clock(entry.health.billLastUpdateAt)}</dd></div>
      <div><dt>Last attempted source check</dt><dd>{clock(entry.health.lastCheckedAt)}</dd></div>
      <div><dt>Last successful upstream check</dt><dd>{clock(entry.health.lastSuccessfulUpstreamCheckAt)}</dd></div>
      <div><dt>Evidence origin</dt><dd>{watchLabel(entry.health.origin)}</dd></div>
    </dl>
    {entry.health.currentFailure ? <p role="status">Current source failure: {entry.health.currentFailure}. Prior dated evidence is retained.</p> : null}
  </div>)}</section>;
}
