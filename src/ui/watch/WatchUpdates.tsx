import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { watchDirectoryPath, watchQuerySearch, type WatchKind, type WatchQuery } from "../../content/watch-query";
import type { WatchUpdate } from "../../content/watch-updates";
import { sourceDateLabel } from "./watch-labels";
import { WatchDataStatus, WatchError } from "./WatchShared";
import { WatchReadError } from "./watch-api";
import { readWatchUpdates, watchUpdatesApiPath } from "./watch-updates-api";
const LABELS = { "policy-action": "Policy action", "software-release": "Software release",
  "paper-publication": "Paper published", "dataset-release": "Dataset release", "product-release": "Product release" };
type Data = Awaited<ReturnType<typeof readWatchUpdates>>;
type State = { key: string } & ({ phase: "loading" } | { phase: "ready"; data: Data } | { phase: "error"; error: WatchReadError });
export function WatchUpdateRecord({ item, kind }: { item: WatchUpdate; kind: WatchKind }) {
  return <li className="WatchRow WatchUpdateRow"><article aria-labelledby={"update-" + item.id}>
    <p className="WatchEyebrow">{LABELS[item.type]}</p>
    <h2 id={"update-" + item.id}><Link to={kind === "policy" ? "/policy-watch/$slug" : "/technology-watch/$slug"}
      params={{ slug: item.subjectSlug }} search={{}}>{item.title}</Link></h2>
    <p className="WatchUpdateDate">{sourceDateLabel(item.sourceOccurredAt)}</p>
    <p className="WatchNote">{item.subjectTitle}</p>
    {item.summary ? <p>{item.summary}</p> : null}
    <details className="WatchSources"><summary>Development sources ({item.sources.length})</summary>
      <ul>{item.sources.map(source => <li key={source.id}><a href={source.url} rel="noreferrer">{source.label}</a>
        {source.locator ? <p className="WatchNote">{source.locator}</p> : null}
        {source.quote ? <blockquote>{source.quote}</blockquote> : null}</li>)}</ul>
    </details>
  </article></li>;
}
export function WatchUpdates({ kind, query }: { kind: WatchKind; query: WatchQuery }) {
  const [attempt, setAttempt] = useState(0);
  const url = watchUpdatesApiPath(kind, query.values), key = JSON.stringify([url, attempt]);
  const [state, setState] = useState<State>({ key: "", phase: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let active = true;
    void readWatchUpdates(kind, query.values, controller.signal).then(data => {
      if (active) setState({ key, phase: "ready", data });
    }).catch(error => {
      if (active) setState({ key, phase: "error", error: controller.signal.aborted ? new WatchReadError("timeout") :
        error instanceof WatchReadError ? error : new WatchReadError("network") });
    }).finally(() => clearTimeout(timeout));
    return () => { active = false; controller.abort(); clearTimeout(timeout); };
  }, [key, kind, url]);
  const current = state.key === key ? state : { key, phase: "loading" as const };
  const retry = () => setAttempt(value => value + 1);
  const path = kind === "policy" ? "/policy-watch" : "/technology-watch";
  return <section className="WatchResults WatchUpdates" aria-label={kind === "policy" ? "Latest policy changes" : "Latest technology releases"}
    aria-busy={current.phase === "loading"}>
    <div className="WatchViewHeading"><h2>{kind === "policy" ? "Latest Changes" : "Latest Releases"}</h2>
      <button type="button" className="WatchRefresh" onClick={retry} disabled={current.phase === "loading"}>Refresh updates</button></div>
    {current.phase === "loading" ? <p className="WatchLoading" role="status">Loading dated updates...</p> :
      current.phase === "error" ? <WatchError kind={kind} error={current.error} retry={retry}
        firstPage={watchDirectoryPath(kind, query.values) + "#latest"} /> :
      <><div className="WatchResultBar"><p role="status">{current.data.response.items.length} updates on this page</p>
        <WatchDataStatus asOf={current.data.response.asOf} stale={current.data.stale} /></div>
        {current.data.response.items.length ? <ul className="WatchRecordList">{current.data.response.items.map(item =>
          <WatchUpdateRecord key={item.id} kind={kind} item={item} />)}</ul> :
          <section className="WatchState"><h3>No dated updates match this selection.</h3>
            <p><Link to={path} search={{}} hash="">Browse the directory</Link></p></section>}
        {query.values.cursor || current.data.response.nextCursor ? <nav className="WatchPagination" aria-label="Update pagination">
          {query.values.cursor ? <Link to={path} search={watchQuerySearch(query.values, kind)} hash="latest">First page</Link> : <span />}
          {current.data.response.nextCursor ? <Link to={path} search={watchQuerySearch(query.values, kind, current.data.response.nextCursor)} hash="latest" rel="next">Next updates</Link> : <span>End of updates</span>}
        </nav> : null}
      </>}
  </section>;
}

