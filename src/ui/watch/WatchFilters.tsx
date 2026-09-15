import { useNavigate } from "@tanstack/react-router";
import { useId, useState, type FormEvent } from "react";
import { parseWatchQuery, WATCH_QUERY_TEXT_LIMIT, watchQuerySearch, type WatchKind, type WatchQuery, type WatchQueryKey } from "../../content/watch-query";
import type { WatchPublicRecord } from "../../content/watch-schema";
import { JURISDICTION_LABELS, LICENSE_LABELS, LIFECYCLE_LABELS, RESOURCE_LABELS } from "./watch-labels";

function FilterSelect({ name, label, value, choices }: { name: WatchQueryKey; label: string; value?: string; choices: Record<string, string> }) {
  return <label className="WatchField"><span>{label}</span><select name={name} defaultValue={value ?? ""}>
    <option value="">{name === "limit" ? "Default" : "All"}</option>
    {value && !Object.hasOwn(choices, value) ? <option value={value}>{value}</option> : null}
    {Object.entries(choices).map(([id, name]) => <option value={id} key={id}>{name}</option>)}
  </select></label>;
}

export function WatchFilters({ kind, query, items, hash = "" }: { kind: WatchKind; query: WatchQuery; items: WatchPublicRecord[]; hash?: string }) {
  const navigate = useNavigate();
  const errorId = useId();
  const [errors, setErrors] = useState<string[]>([]);
  const path = kind === "policy" ? "/policy-watch" : "/technology-watch";
  const { values } = query;
  const organizations = new Map(items.flatMap(item => item.kind === "technology" ? item.localRelationships.map(relation =>
    [relation.value.entityId, relation.value.entityName] as const) : []));
  if (values.organization && !organizations.has(values.organization)) organizations.set(values.organization, "Selected organization");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [name, value] of new FormData(event.currentTarget)) {
      if (typeof value === "string" && value) params.set(name, value);
    }
    const next = parseWatchQuery(params, kind);
    setErrors(next.errors);
    if (next.errors.length) return;
    void navigate({ to: path, search: watchQuerySearch(next.values, kind), hash, resetScroll: false });
  };
  return <form className="WatchFilters" method="get" action={path} onSubmit={submit}
    onReset={() => { setErrors([]); void navigate({ to: path, search: {}, hash, resetScroll: false }); }}
    aria-label={`${kind === "policy" ? "Policy" : "Technology"} Watch filters`} aria-describedby={errors.length ? errorId : undefined}>
    <label className="WatchField is-search"><span>Search</span>
      <input type="search" name="q" maxLength={WATCH_QUERY_TEXT_LIMIT} defaultValue={values.q ?? ""} />
    </label>
    <div className="WatchFilterOptions">
      {kind === "policy" ? <>
        <FilterSelect name="jurisdiction" label="Jurisdiction" value={values.jurisdiction} choices={JURISDICTION_LABELS} />
        <FilterSelect name="stage" label="Lifecycle" value={values.stage} choices={LIFECYCLE_LABELS} />
      </> : <>
        <FilterSelect name="type" label="Resource type" value={values.type} choices={RESOURCE_LABELS} />
        <FilterSelect name="organization" label="Organization" value={values.organization}
          choices={Object.fromEntries([...organizations].sort((a, b) => a[1].localeCompare(b[1])))} />
        <FilterSelect name="license" label="License classification" value={values.license} choices={LICENSE_LABELS} />
      </>}
      <FilterSelect name="limit" label="Records per page" value={values.limit} choices={{ "10": "10", "20": "20", "50": "50" }} />
    </div>
    <div className="WatchActions"><button type="submit">Apply filters</button><button type="reset" className="is-quiet">Reset</button></div>
    {errors.length ? <ul id={errorId} className="WatchFilterErrors" role="alert">{errors.map(error => <li key={error}>{error}</li>)}</ul> : null}
  </form>;
}
