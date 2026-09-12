import { useEffect, useState } from "react";
import { PublicRepresentativeResult } from "../../content/watch-representatives";
import { REPRESENTATIVE_LOOKUPS } from "../../content/representative-sources";

function today() {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)!.value).join("-");
}
export function RepresentativeLookup({ initialBodyId = "pa-house" }: { initialBodyId?: string }) {
  const [scopeIndex, setScopeIndex] = useState(Math.max(0, REPRESENTATIVE_LOOKUPS.findIndex(scope => scope.bodyId === initialBodyId)));
  const [district, setDistrict] = useState(""), [asOf, setAsOf] = useState(today);
  const [districts, setDistricts] = useState<Array<{ id: string; label: string }>>([]);
  const [query, setQuery] = useState(""), [result, setResult] = useState<PublicRepresentativeResult | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const scope = REPRESENTATIVE_LOOKUPS[scopeIndex];
  useEffect(() => {
    if (!query) return;
    const controller = new AbortController();
    setState("loading"); setResult(null);
    fetch("/api/v2/watch/representatives?" + query, { signal: controller.signal, credentials: "omit", cache: "no-store", redirect: "error" })
      .then(async response => { if (!response.ok) throw new Error("unavailable"); return PublicRepresentativeResult.parse(await response.json()); })
      .then(value => { if (!controller.signal.aborted) {
        if (!new URLSearchParams(query).has("districtId")) setDistricts(previous => [...new Map(
          [...previous, ...value.offices.map(office => office.district)].map(item => [item.id, item])).values()]);
        setResult(value); setState("ready");
      } })
      .catch(() => { if (!controller.signal.aborted) setState("error"); });
    return () => controller.abort();
  }, [query]);
  function search(cursor?: string) {
    const values = new URLSearchParams({ jurisdiction: scope.jurisdiction, jurisdictionId: scope.jurisdictionId,
      bodyId: scope.bodyId, asOf, limit: "20" });
    if (district.trim()) values.set("districtId", district.trim());
    if (cursor) values.set("cursor", cursor);
    setQuery(values.toString());
  }
  return <section aria-labelledby="representatives-heading" className="border-t border-zinc-300 py-6">
    <h2 id="representatives-heading" className="text-xl font-semibold">Representatives</h2>
    <form onSubmit={event => { event.preventDefault(); search(); }} className="my-4 flex flex-wrap items-end gap-3">
      <label className="flex min-w-0 flex-col gap-1">Chamber<select value={scopeIndex} onChange={event => {
        setScopeIndex(Number(event.target.value)); setDistrict(""); setDistricts([]); setQuery(""); setResult(null); setState("idle");
      }} className="max-w-full border border-zinc-400 p-2">
        {REPRESENTATIVE_LOOKUPS.map((value, index) => <option key={index} value={index}>{value.label}</option>)}
      </select></label>
      <label className="flex flex-col gap-1">Selected district<select value={district} onChange={event => setDistrict(event.target.value)}
        className="w-48 max-w-full border border-zinc-400 p-2">
        <option value="">All districts</option>
        {districts.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></label>
      <label className="flex flex-col gap-1">As of<input type="date" value={asOf} max={today()} required onChange={event => setAsOf(event.target.value)}
        className="border border-zinc-400 p-2" /></label>
      <button type="submit" className="border border-zinc-600 px-4 py-2">Find representatives</button>
      <a href={scope.lookupUrl} className="underline">Official district lookup</a>
    </form>
    <div aria-live="polite" aria-busy={state === "loading"}>
      {state === "loading" && <p>Loading representatives...</p>}
      {state === "error" && <p role="alert">Representative data is temporarily unavailable.</p>}
      {result?.dataState === "unavailable" && <p>No accepted directory is available for this chamber.</p>}
      {result?.dataAsOf && <p>Roster as of {new Date(result.dataAsOf).toLocaleDateString("en-US", { timeZone: "America/New_York" })}
        {result.dataState === "stale" ? " (stale)" : ""}</p>}
      {result?.dataState !== "unavailable" && result?.offices.length === 0 && <p>No verified office records match this selection.</p>}
      {result?.offices.map(office => <article key={office.id} className="border-b border-zinc-300 py-4">
        <h3 className="font-semibold">{office.bodyName}: {office.district.label}</h3>
        {office.members.map(member => <div key={member.membershipId} className="py-2">
          <p className="font-medium">{member.displayName}{member.party ? " (" + member.party + ")" : ""}</p>
          <p>{member.state.replaceAll("-", " ")}; {member.validFrom} to {member.validTo ?? "end not recorded"}</p>
          {member.officialProfileUrl && <a className="underline" href={member.officialProfileUrl}>Official profile and contact</a>}
          {member.committeeRoles.map(role => <p key={role.id}>{role.bodyName}: {role.role.replaceAll("-", " ")}</p>)}
        </div>)}
        {office.seats.verifiedVacant > 0 && <p>{office.seats.verifiedVacant} verified vacant seat(s)</p>}
        {office.seats.unverified > 0 && <p>{office.seats.unverified} seat(s) without current verified membership</p>}
        <details><summary>Official sources</summary><ul>{office.sources.map(source => <li key={source.id}>
          <a className="underline" href={source.url}>{source.label}</a>{source.locator ? " - " + source.locator : ""}
        </li>)}</ul></details>
      </article>)}
      {result?.nextCursor && <button type="button" onClick={() => search(result.nextCursor!)} className="mt-4 border border-zinc-600 px-4 py-2">Next results</button>}
    </div>
  </section>;
}
