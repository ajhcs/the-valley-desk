import { Link } from "@tanstack/react-router";
import { isWatchSlug, type WatchKind } from "../../content/watch-query";
import { watchDetailApiPath, WatchReadError } from "./watch-api";
import { instantLabel, RESOURCE_LABELS } from "./watch-labels";
import { useWatchRequest } from "./use-watch-request";
import { PolicyDossier } from "./PolicyDossier";
import { TechnologyDossier } from "./TechnologyDossier";
import { PaSourceHealth, WatchDataStatus, WatchError, WatchSave, WatchSaveNotice, WatchSources, WatchUnknowns } from "./WatchShared";
import "./watch.css";

export function WatchDetailPage({ kind, slug }: { kind: WatchKind; slug: string }) {
  const valid = isWatchSlug(slug);
  const { state, retry, health } = useWatchRequest(valid ? watchDetailApiPath(kind, slug) : null, kind, slug);
  const data = state.phase === "ready" && state.data.response.version === "watch-detail-1" ? state.data.response : null;
  const item = data?.item;
  const error = !valid ? new WatchReadError("not-found") : state.phase === "error" ? state.error : null;
  return <article className={`WatchPage WatchDossier is-${kind}`} aria-busy={!error && !item}>
    <nav className="WatchBreadcrumb" aria-label="Breadcrumb"><Link to={kind === "policy" ? "/policy-watch" : "/technology-watch"} search={{}}>
      {kind === "policy" ? "Policy Watch" : "Technology Watch"}</Link><span aria-hidden="true"> / </span><span>Dossier</span></nav>
    {error ? <><h1>{kind === "policy" ? "Policy Dossier" : "Technology Dossier"}</h1><WatchError error={error} retry={retry} kind={kind} /></> :
      !item || !data ? <><h1>{kind === "policy" ? "Policy Dossier" : "Technology Dossier"}</h1><p className="WatchLoading" role="status">Loading accepted record...</p></> : <>
        <header className="WatchHeading"><div><p className="WatchEyebrow">{item.kind === "policy" ? "Policy dossier" : RESOURCE_LABELS[item.resourceType]}</p><h1>{item.title}</h1></div><WatchSave item={item} /></header>
        <div className="WatchDossierMeta"><p>Oldest included fact verification: <time dateTime={item.verifiedAt}>{instantLabel(item.verifiedAt)}</time>.</p>
          <WatchDataStatus asOf={data.asOf} stale={state.phase === "ready" && state.data.stale} />
          <button type="button" className="WatchRefresh" onClick={retry}>Refresh record</button>
        </div>
        <PaSourceHealth entries={health} items={[item]} />
        <WatchSaveNotice />
        {item.kind === "policy" ? <PolicyDossier item={item} /> : <TechnologyDossier item={item} />}
        <WatchUnknowns item={item} />
        <section className="WatchSection"><h2>Source Record</h2><WatchSources item={item} label="All accepted sources" /></section>
      </>}
  </article>;
}
