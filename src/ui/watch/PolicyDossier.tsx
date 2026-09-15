import type { PublicPolicyDossier } from "../../content/watch-schema";
import { JURISDICTION_LABELS, LEGAL_EFFECT_LABELS, LIFECYCLE_LABELS, READINESS_LABELS, sourceDateLabel, watchLabel } from "./watch-labels";
import { WatchSources } from "./WatchShared";

export function PolicyDossier({ item }: { item: PublicPolicyDossier }) {
  const identity = item.identity.value;
  return <>
    <section className="WatchSection"><h2>Instrument</h2>
      <dl className="WatchFacts">
        <div><dt>Jurisdiction</dt><dd>{JURISDICTION_LABELS[item.jurisdiction]}</dd></div>
        <div><dt>Instrument</dt><dd>{identity.sourceInstrumentId}</dd></div>
        <div><dt>Type</dt><dd>{watchLabel(identity.instrumentType)}</dd></div>
        <div><dt>Session</dt><dd>{identity.sessionKey}</dd></div>
        <div><dt>Source body ID</dt><dd>{identity.bodyId}</dd></div>
        <div><dt>Source jurisdiction ID</dt><dd>{identity.jurisdictionId}</dd></div>
      </dl>
      <WatchSources item={item} fact={item.identity} label="Identity sources" />
    </section>
    <section className="WatchSection"><h2>Status</h2>
      <div className="WatchSplit">
        <div><h3>Lifecycle</h3><p className="WatchFactValue">{LIFECYCLE_LABELS[item.lifecycle]}</p>
          {item.lifecycleFact ? <WatchSources item={item} fact={item.lifecycleFact} /> : null}</div>
        <div><h3>Legal effect</h3><p className="WatchFactValue">{LEGAL_EFFECT_LABELS[item.legalEffect]}</p>
          {item.legalEffectFact ? <WatchSources item={item} fact={item.legalEffectFact} /> : null}</div>
      </div>
    </section>
    <section className="WatchSection"><h2>Summary</h2>
      <p>{item.summary?.value ?? "No policy summary has been established for this record."}</p>
      {item.summary ? <WatchSources item={item} fact={item.summary} /> : null}
      {item.topics?.length ? <p className="WatchNote">Topics: {item.topics.map(watchLabel).join(", ")}</p> : null}
    </section>
    <section className={`WatchSection${item.interpretation.readiness === "evidence-changed" ? " is-held" : ""}`}>
      <h2>Interpretation</h2><p className="WatchFactValue">{READINESS_LABELS[item.interpretation.readiness]}</p>
      {item.interpretation.summary ? <><p>{item.interpretation.summary.value}</p><WatchSources item={item} fact={item.interpretation.summary} /></> :
        <p>{item.interpretation.reason ?? "No reviewed interpretation is available."}</p>}
    </section>
    <section className="WatchSection"><h2>Latest Action</h2>
      {item.latestAction ? <>
        <p>{item.latestAction.value.text}</p><p className="WatchNote">{sourceDateLabel(item.latestAction.value.sourceOccurredAt)}</p>
        <p className="WatchNote">Source code: {item.latestAction.value.nativeCode} | Source body: {item.latestAction.value.bodyId}</p>
        <WatchSources item={item} fact={item.latestAction} />
      </> : <p>No latest action has been established.</p>}
    </section>
    <section className="WatchSection"><h2>Action Timeline</h2>
      {item.timeline.length ? <ol className="WatchTimeline">{item.timeline.map(action => <li key={action.value.id}>
        <p className="WatchNote">{sourceDateLabel(action.value.sourceOccurredAt)}</p><h3>{action.value.nativeCode}</h3><p>{action.value.text}</p>
        <p className="WatchNote">Source body: {action.value.bodyId}{action.value.sourceOrder === null ? "" : ` | Source order: ${action.value.sourceOrder}`}</p>
        <WatchSources item={item} fact={action} />
      </li>)}</ol> : <p>No additional accepted action history is available.</p>}
    </section>
  </>;
}
