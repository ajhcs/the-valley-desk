import { Link, useRouterState } from "@tanstack/react-router";
import { parseWatchQuery, watchDirectoryPath, watchQuerySearch, type WatchKind, type WatchQuery } from "../../content/watch-query";
import type { WatchPublicRecord } from "../../content/watch-schema";
import { watchDirectoryApiPath } from "./watch-api";
import { JURISDICTION_LABELS, LEGAL_EFFECT_LABELS, LICENSE_LABELS, LIFECYCLE_LABELS, READINESS_LABELS, RELATIONSHIP_LABELS, RESOURCE_LABELS, sourceDateLabel } from "./watch-labels";
import { useWatchRequest } from "./use-watch-request";
import { WatchFilters } from "./WatchFilters";
import { PaSourceHealth, WatchDataStatus, WatchError, WatchSave, WatchSaveNotice, WatchSources } from "./WatchShared";
import { RepresentativeLookup } from "./RepresentativeLookup";
import { WatchUpdates } from "./WatchUpdates";
import { latestQuerySupported, watchView, watchViewSearch, type WatchView } from "./watch-views";
import "./watch.css";

export function WatchDirectoryRecord({ item, query }: { item: WatchPublicRecord; query: WatchQuery }) {
  return <li className="WatchRow">
    <article aria-labelledby={`watch-record-${item.id}`}>
      <div className="WatchRowHeading"><div>
        <p className="WatchEyebrow">{item.kind === "policy" ? `${JURISDICTION_LABELS[item.jurisdiction]} | ${item.identity.value.sourceInstrumentId}` : RESOURCE_LABELS[item.resourceType]}</p>
        <h2 id={`watch-record-${item.id}`}><Link to={item.kind === "policy" ? "/policy-watch/$slug" : "/technology-watch/$slug"}
          params={{ slug: item.slug }} search={{}}>{item.title}</Link></h2>
      </div><WatchSave item={item} /></div>
      {item.kind === "policy" ? <>
        <dl className="WatchStatusFacts"><div><dt>Lifecycle</dt><dd>{LIFECYCLE_LABELS[item.lifecycle]}</dd></div>
          <div><dt>Legal effect</dt><dd>{LEGAL_EFFECT_LABELS[item.legalEffect]}</dd></div>
          <div><dt>Interpretation</dt><dd>{READINESS_LABELS[item.interpretation.readiness]}</dd></div></dl>
        <p>{item.summary?.value ?? "Policy summary not yet established."}</p>
        {item.latestAction ? <div className="WatchLatest"><p><strong>Latest action:</strong> {item.latestAction.value.text}</p>
          <p className="WatchNote">{sourceDateLabel(item.latestAction.value.sourceOccurredAt)}</p>
          <WatchSources item={item} fact={item.latestAction} label="Action sources" />
        </div> : <p className="WatchNote">Latest action not yet established.</p>}
      </> : <>
        <p>{item.purpose?.value ?? "Purpose not yet established."}</p>
        <ul className="WatchLocalList" aria-label="Verified local connections">{item.localRelationships.map(relation => <li key={relation.value.id}>
          {RELATIONSHIP_LABELS[relation.value.type]}{" "}<Link to="/technology-watch" search={watchQuerySearch({ ...query.values, organization: relation.value.entityId }, "technology")}>
            {relation.value.entityName}</Link>{" "}<span className="WatchNote">({relation.value.temporalStatus === "historical" ? "historical connection" : relation.value.temporalStatus === "observed" ? "documented connection" : "current at verification"})</span>
        </li>)}</ul>
        <p className="WatchNote">Artifact license assessments: {item.licenseClassifications.length ? item.licenseClassifications.map(value => LICENSE_LABELS[value]).join(", ") : "not established"}.</p>
      </>}
      <WatchSources item={item} label="Record sources" />
    </article>
  </li>;
}

export function WatchDirectoryPage({ kind }: { kind: WatchKind }) {
  const search = useRouterState({ select: state => state.location.searchStr });
  const hash = useRouterState({ select: state => state.location.hash });
  const parsedQuery = parseWatchQuery(search, kind);
  const view = watchView(kind, hash, parsedQuery.values);
  const query = view === "latest" && !latestQuerySupported(parsedQuery.values) ? {
    ...parsedQuery, errors: [...parsedQuery.errors, "These filters are not available for Latest updates."] } : parsedQuery;
  const directoryView = view === "directory" || view === "papers";
  const path = kind === "policy" ? "/policy-watch" : "/technology-watch";
  const { state, retry, health } = useWatchRequest(query.errors.length || !directoryView ? null : watchDirectoryApiPath(kind, query.values), kind);
  const data = state.phase === "ready" && state.data.response.version === "watch-directory-1" ? state.data.response : null;
  const loading = directoryView && !query.errors.length && state.phase === "loading";
  const views: Array<{ id: WatchView; label: string }> = [
    { id: "latest", label: kind === "policy" ? "Latest Changes" : "Latest Releases" },
    { id: "directory", label: kind === "policy" ? "Policy Directory" : "Technology Directory" },
    kind === "technology" ? { id: "papers", label: "Papers" } : { id: "representatives", label: "Representatives" },
  ];
  return <article className={`WatchPage is-${kind}`}>
    <header className="WatchHeading"><div><p className="WatchEyebrow">{views.find(item => item.id === view)?.label}</p><h1>{kind === "policy" ? "Policy Watch" : "Technology Watch"}</h1>
      <p className="WatchScope">{kind === "policy" ? "CMS federal proposals. State and local legislative coverage is not yet complete." : "Selected technologies with verified Delaware Valley connections"}</p>
    </div>{directoryView ? <button type="button" className="WatchRefresh" onClick={retry} disabled={loading || query.errors.length > 0}>Refresh</button> : null}</header>
    <nav className="WatchViews" aria-label={`${kind === "policy" ? "Policy" : "Technology"} Watch views`}>
      {views.map(item => <Link key={item.id} to={path} search={watchViewSearch(kind, item.id, query.errors.length ? {} : query.values)}
        hash={item.id === "latest" || item.id === "representatives" ? item.id : ""} aria-current={view === item.id ? "page" : undefined}
        activeOptions={{ exact: true, includeHash: true }} resetScroll={false}>{item.label}</Link>)}
    </nav>
    {directoryView ? <WatchFilters key={`${kind}:${search}:${view}`} kind={kind} query={query} items={data?.items ?? []} /> : null}
    {directoryView ? <WatchSaveNotice /> : null}
    <div className="WatchResults" aria-busy={loading}>
      {query.errors.length ? <section className="WatchState" role="alert"><h2>Check your filters</h2>
        <ul>{query.errors.map(error => <li key={error}>{error}</li>)}</ul><Link to={path} search={{}}>Reset filters</Link>
      </section> : view === "representatives" ? <RepresentativeLookup /> :
      view === "latest" ? <WatchUpdates kind={kind} query={query} /> :
      loading ? <p className="WatchLoading" role="status">Loading accepted {kind} records...</p> :
      state.phase === "error" ? <WatchError kind={kind} error={state.error} retry={retry} firstPage={watchDirectoryPath(kind, query.values)} /> :
      data ? <>
        <div className="WatchResultBar"><p role="status">{data.items.length} {data.items.length === 1 ? "record" : "records"} on this page</p>
          <WatchDataStatus asOf={data.asOf} stale={state.phase === "ready" && state.data.stale} /></div>
        <PaSourceHealth entries={health} items={data.items} />
        {data.items.length ? <ul className="WatchRecordList">{data.items.map(item => <WatchDirectoryRecord key={item.id} item={item} query={query} />)}</ul> :
          <section className="WatchState"><h2>{view === "papers" ? "No accepted papers match these filters." : query.active ? "No records match these filters." : "No accepted records are listed yet."}</h2>
            {query.active ? <Link to={path} search={{}}>Reset filters</Link> : null}
          </section>}
        {query.values.cursor || data.nextCursor ? <nav className="WatchPagination" aria-label={`${kind === "policy" ? "Policy" : "Technology"} Watch pagination`}>
          {query.values.cursor ? <Link to={path} search={watchQuerySearch(query.values, kind)}>First page</Link> : <span />}
          {data.nextCursor ? <Link to={path} search={watchQuerySearch(query.values, kind, data.nextCursor)} rel="next">Next records</Link> : <span>End of results</span>}
        </nav> : null}
      </> : null}
    </div>
  </article>;
}
