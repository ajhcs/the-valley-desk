import { useEffect, useId, useState } from "react";
import { PublicRepresentativeResult } from "../../content/watch-representatives";
import { REPRESENTATIVE_LOOKUPS, type RepresentativeLookupScope } from "../../content/representative-sources";

function today() {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-");
}
export function RepresentativeLookup({ initialBodyId = "pa-house", scopes = REPRESENTATIVE_LOOKUPS,
  requireScopeSelection = false, heading = "Representatives", context }: {
  initialBodyId?: string; scopes?: readonly RepresentativeLookupScope[]; requireScopeSelection?: boolean;
  heading?: string; context?: string;
}) {
  const headingId = useId();
  const [scopeIndex, setScopeIndex] = useState(() => requireScopeSelection ? -1 : Math.max(0, scopes.findIndex(scope => scope.bodyId === initialBodyId)));
  const [district, setDistrict] = useState(""), [asOf, setAsOf] = useState(today);
  const [districts, setDistricts] = useState<Array<{ id: string; label: string }>>([]);
  const [query, setQuery] = useState(""), [result, setResult] = useState<PublicRepresentativeResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const scope = scopes[scopeIndex];
  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let active = true;
    setState("loading"); setResult(null);
    fetch("/api/v2/watch/representatives?" + query, { signal: controller.signal, credentials: "omit", cache: "no-store", redirect: "error" })
      .then(async response => { if (!response.ok) throw new Error("unavailable"); return PublicRepresentativeResult.parse(await response.json()); })
      .then(value => { if (active) {
        if (!new URLSearchParams(query).has("districtId")) setDistricts(previous => [...new Map(
          [...previous, ...value.offices.map(office => office.district)].map(item => [item.id, item])).values()]);
        setResult(value); setState("ready");
      } })
      .catch(() => { if (active) setState("error"); })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; controller.abort(); clearTimeout(timeout); };
  }, [query, attempt]);
  function search(cursor?: string) {
    if (!scope) return;
    const values = cursor && query ? new URLSearchParams(query) : new URLSearchParams({ jurisdiction: scope.jurisdiction, jurisdictionId: scope.jurisdictionId,
      bodyId: scope.bodyId, asOf, limit: "20" });
    if (!cursor && district.trim()) values.set("districtId", district.trim());
    if (cursor) values.set("cursor", cursor);
    else values.delete("cursor");
    setResult(null); setState("loading");
    setQuery(values.toString());
    setAttempt(value => value + 1);
  }
  function retry() { setResult(null); setState("loading"); setAttempt(value => value + 1); }
  return <section aria-labelledby={headingId} className="WatchRepresentatives">
    <h2 id={headingId}>{heading}</h2>
    {context ? <p className="WatchNote">{context}</p> : null}
    <form onSubmit={event => { event.preventDefault(); search(); }} className="WatchRepresentativeFilters">
      <label className="WatchField">{requireScopeSelection ? "State delegation" : "Chamber"}<select value={scopeIndex} onChange={event => {
        setScopeIndex(Number(event.target.value)); setDistrict(""); setDistricts([]); setQuery(""); setResult(null); setState("idle");
      }}>
        {requireScopeSelection ? <option value={-1}>Select state delegation</option> : null}
        {scopes.map((value, index) => <option key={`${value.bodyId}:${value.jurisdictionId}`} value={index}>{value.label}</option>)}
      </select></label>
      <label className="WatchField">Selected district<select value={district} onChange={event => setDistrict(event.target.value)}>
        <option value="">All districts</option>
        {districts.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></label>
      <label className="WatchField">As of<input type="date" value={asOf} max={today()} required onChange={event => setAsOf(event.target.value)} /></label>
      <div className="WatchActions"><button type="submit" disabled={!scope || state === "loading"}>Find representatives</button>
        {scope ? <a href={scope.lookupUrl} rel="noreferrer">Official district lookup</a> : null}</div>
    </form>
    <div aria-live="polite" aria-busy={state === "loading"}>
      {state === "loading" && <p className="WatchLoading" role="status">Loading representatives...</p>}
      {state === "error" && <div className="WatchState" role="alert"><h3>Representative data is temporarily unavailable.</h3>
        <p><button type="button" onClick={retry}>Retry representative lookup</button></p></div>}
      {result?.dataState === "unavailable" && <div className="WatchState"><h3>{result.unavailableReason === "historical-coverage-unavailable"
        ? "Historical membership is not established for this date." : "No accepted directory is available for this chamber."}</h3>
        {scope ? <p><a href={scope.lookupUrl} rel="noreferrer">Open the official chamber directory</a></p> : null}</div>}
      {result && result.dataState !== "unavailable" ? <p className="WatchNote">Selected districts on {result.selectedAsOf}</p> : null}
      {result?.dataAsOf && <p className="WatchNote">Roster as of {new Date(result.dataAsOf).toLocaleDateString("en-US", { timeZone: "America/New_York" })}
        {result.dataState === "stale" ? " (stale)" : ""}</p>}
      {result?.dataState !== "unavailable" && result?.offices.length === 0 && <p>No verified office records match this selection.</p>}
      {result?.offices.map(office => <article key={office.id} className="WatchRepresentativeOffice">
        <h3>{office.bodyName}: {office.district.label}</h3>
        {office.members.map(member => <div key={member.membershipId} className="WatchRepresentativeMember">
          <p className="WatchFactValue">{member.displayName}{member.party ? " (" + member.party + ")" : ""}</p>
          <p className="WatchNote">{member.datePrecision === "observation"
            ? `${member.state === "last-known" ? "Last known roster" : "Official roster"} observed ${member.observedAt?.slice(0, 10)}. Term dates not established.`
            : `${member.state.replaceAll("-", " ")}; ${member.validFrom} to ${member.validTo ?? "end not recorded"}`}</p>
          {member.officialProfileUrl && <a href={member.officialProfileUrl} rel="noreferrer">Official profile and contact</a>}
          {member.committeeRoles.map(role => <p key={role.id}>{role.bodyName}: {role.role.replaceAll("-", " ")}</p>)}
        </div>)}
        {office.seats.verifiedVacant > 0 && <p>{office.seats.verifiedVacant} verified vacant seat(s)</p>}
        {office.seats.unverified > 0 && <p>{office.seats.unverified} seat(s) without current verified membership</p>}
        <details className="WatchSources"><summary>Official sources</summary><ul>{office.sources.map(source => <li key={source.id}>
          <a href={source.url} rel="noreferrer">{source.label}</a>{source.locator ? " - " + source.locator : ""}
        </li>)}</ul></details>
      </article>)}
      {result && (result.nextCursor || new URLSearchParams(query).has("cursor")) ? <nav className="WatchPagination" aria-label="Representative pagination">
        {new URLSearchParams(query).has("cursor") ? <button type="button" className="is-quiet" onClick={() => search()}>First page</button> : <span />}
        {result.nextCursor ? <button type="button" onClick={() => search(result.nextCursor!)}>Next results</button> : <span>End of results</span>}
      </nav> : null}
    </div>
  </section>;
}
