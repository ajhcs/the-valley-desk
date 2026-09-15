import type { PublicTechnologyProfile } from "../../content/watch-schema";
import { instantLabel, LICENSE_LABELS, RELATIONSHIP_LABELS, SETUP_LABELS, watchLabel } from "./watch-labels";
import { WatchSources } from "./WatchShared";

function TextList({ values, empty }: { values: string[]; empty: string }) {
  return values.length ? <ul className="WatchTextList">{values.map((value, index) => <li key={index}>{value}</li>)}</ul> : <p className="WatchNote">{empty}</p>;
}

export function TechnologyDossier({ item }: { item: PublicTechnologyProfile }) {
  return <>
    <section className="WatchSection"><h2>Purpose</h2><p>{item.purpose?.value ?? "Purpose has not been established."}</p>
      {item.purpose ? <WatchSources item={item} fact={item.purpose} /> : null}
      <h3>Intended users</h3>{item.intendedUsers ? <><TextList values={item.intendedUsers.value} empty="No intended users are identified in the accepted assessment." /><WatchSources item={item} fact={item.intendedUsers} /></> : <p>Intended users have not been established.</p>}
    </section>
    <section className="WatchSection"><h2>Delaware Valley Connections</h2>
      <ul className="WatchDetailList">{item.localRelationships.map(fact => {
        const relation = fact.value;
        const artifact = item.artifacts.find(artifact => artifact.value.id === relation.artifactId)!.value;
        return <li key={relation.id}><h3>{relation.entityName}</h3><p>{RELATIONSHIP_LABELS[relation.type]} | {relation.temporalStatus === "historical" ? "Historical connection" : relation.temporalStatus === "observed" ? "Connection documented at verification" : "Current at verification"}</p>
          <p className="WatchNote">Artifact: {artifact.nativeId}, {artifact.version}</p>
          <p className="WatchNote">From {relation.validFrom ?? "date not established"}; {relation.validTo ? `before ${relation.validTo}` : "end date not established"}.</p>
          <p className="WatchNote">Checked <time dateTime={relation.checkedAt}>{instantLabel(relation.checkedAt)}</time>
            {relation.validThrough ? <>; verification valid through <time dateTime={relation.validThrough}>{instantLabel(relation.validThrough)}</time></> : null}.</p>
          <WatchSources item={item} fact={fact} />
        </li>;
      })}</ul>
    </section>
    <section className="WatchSection"><h2>Workflow</h2>
      {item.workflow ? <>
        <div className="WatchSplit"><div><h3>Inputs</h3><TextList values={item.workflow.value.inputs} empty="Inputs are not identified in the accepted workflow." /></div>
          <div><h3>Outputs</h3><TextList values={item.workflow.value.outputs} empty="Outputs are not identified in the accepted workflow." /></div></div>
        <h3>Steps</h3><ol className="WatchSteps">{item.workflow.value.steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
        <WatchSources item={item} fact={item.workflow} />
      </> : <p>No workflow has been established.</p>}
    </section>
    <section className="WatchSection"><h2>Setup</h2>
      {item.setup ? <>
        <p className="WatchFactValue">{SETUP_LABELS[item.setup.value.verification]}</p>
        <p>Version: {item.setup.value.version ?? "not established"}</p>
        <h3>Prerequisites</h3>{item.setup.value.prerequisites ? <TextList values={item.setup.value.prerequisites} empty="No prerequisites are identified in the accepted assessment." /> : <p>Prerequisites have not been established.</p>}
        {item.setup.value.guideUrl ? <p><a href={item.setup.value.guideUrl} rel="noreferrer">Maintainer setup guide</a></p> : <p>No setup guide has been established.</p>}
        <WatchSources item={item} fact={item.setup} />
      </> : <p>Setup has not been verified.</p>}
    </section>
    <section className="WatchSection"><h2>Artifacts</h2>
      <ul className="WatchDetailList">{item.artifacts.map(fact => <li key={fact.value.id}>
        <h3><a href={fact.value.url} rel="noreferrer">{fact.value.nativeId}</a></h3>
        <dl className="WatchFacts"><div><dt>Type</dt><dd>{watchLabel(fact.value.artifactType)}</dd></div><div><dt>Version</dt><dd>{fact.value.version}</dd></div>
          <div><dt>Host</dt><dd>{fact.value.host}</dd></div><div><dt>Access</dt><dd>{watchLabel(fact.value.availability)}</dd></div></dl>
        <WatchSources item={item} fact={fact} />
      </li>)}</ul>
    </section>
    <section className="WatchSection"><h2>Licenses</h2>
      {(["code", "data", "weights"] as const).map(scope => <div className="WatchLicenseScope" key={scope}><h3>{watchLabel(scope)}</h3>
        {item.licenses.some(fact => fact.value.scope === scope) ? <ul className="WatchDetailList">{item.licenses.filter(fact => fact.value.scope === scope).map((fact, index) => {
          const license = fact.value;
          const artifact = item.artifacts.find(artifact => artifact.value.id === license.artifactId)!.value;
          return <li key={`${license.artifactId}-${index}`}><p className="WatchFactValue">{LICENSE_LABELS[license.classification]}</p>
            <p>{artifact.nativeId} | {license.artifactVersion}{license.spdxId ? ` | ${license.spdxId}` : ""}</p>
            <TextList values={license.conditions} empty="No additional conditions are recorded in this accepted assessment." />
            {license.sourceUrl ? <p><a href={license.sourceUrl} rel="noreferrer">License source</a></p> : null}
            <WatchSources item={item} fact={fact} />
          </li>;
        })}</ul> : <p className="WatchNote">No accepted {scope} license assessment is available.</p>}
      </div>)}
    </section>
    <section className="WatchSection"><h2>Limitations</h2>
      {item.limitations ? <><TextList values={item.limitations.value} empty="No limitations are identified in the accepted assessment." /><WatchSources item={item} fact={item.limitations} /></> : <p>Limitations have not been established.</p>}
    </section>
  </>;
}
