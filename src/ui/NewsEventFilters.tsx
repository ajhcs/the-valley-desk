import { Link, useNavigate } from "@tanstack/react-router";
import type { FormEvent } from "react";
import {
  EVENT_FORMAT_OPTIONS,
  FILTER_TEXT_LIMIT,
  newsEventFilterSearch,
  type FilterOption,
  type NewsEventFilterKey,
  type NewsEventFilterRequest,
  type NewsEventFilterValues,
  type NewsEventSection,
} from "../content/news-event-filters";
import type { PageWindow } from "../content/pagination";
import "./news-event-filters.css";

function FilterSelect({ name, label, value, options }: {
  name: NewsEventFilterKey;
  label: string;
  value?: string;
  options: readonly FilterOption[];
}) {
  const unavailable = value && !options.some((option) => option.value === value);
  return (
    <label className="NewsEventFilters-field">
      <span>{label}</span>
      <select name={name} defaultValue={value ?? ""}>
        <option value="">All</option>
        {unavailable ? <option value={value}>{value} (not in current results)</option> : null}
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

export function NewsEventFilters({ section, request, organizations, topics, busy }: {
  section: NewsEventSection;
  request: NewsEventFilterRequest;
  organizations: FilterOption[];
  topics: FilterOption[];
  busy: boolean;
}) {
  const navigate = useNavigate();
  const path = section === "news" ? "/news" : "/events";
  const { values } = request;
  const selectedCount = Object.entries(values).filter(([key, value]) => key !== "q" && Boolean(value)).length;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const next: NewsEventFilterValues = {};
    for (const key of ["q", "organization", "host", "topic", "format", "from", "to"] as const) {
      const value = data.get(key);
      if (typeof value === "string") next[key] = value;
    }
    void navigate({ to: path, search: newsEventFilterSearch(next, section), resetScroll: false });
  };
  return (
    <form className="NewsEventFilters" method="get" action={path} onSubmit={submit}
      onReset={() => { void navigate({ to: path, search: {}, resetScroll: false }); }}
      aria-label={`${section === "news" ? "News" : "Event"} filters`}>
      <label className="NewsEventFilters-field is-search">
        <span>Search</span>
        <input name="q" type="search" maxLength={FILTER_TEXT_LIMIT} defaultValue={values.q ?? ""} />
      </label>
      <details className="NewsEventFilters-details" open={selectedCount > 0 || request.errors.length > 0}>
        <summary>Filters{selectedCount ? ` (${selectedCount} applied)` : ""}</summary>
        <div className="NewsEventFilters-options">
          <FilterSelect name={section === "news" ? "organization" : "host"} label={section === "news" ? "Organization" : "Host"}
            value={section === "news" ? values.organization : values.host} options={organizations} />
          <FilterSelect name="topic" label="Topic" value={values.topic} options={topics} />
          {section === "events" ? <FilterSelect name="format" label="Format" value={values.format} options={EVENT_FORMAT_OPTIONS} /> : null}
          <label className="NewsEventFilters-field">
            <span>{section === "news" ? "Published from" : "Starts from"}</span>
            <input name="from" type="date" defaultValue={values.from ?? ""} />
          </label>
          <label className="NewsEventFilters-field">
            <span>{section === "news" ? "Published through" : "Starts through"}</span>
            <input name="to" type="date" defaultValue={values.to ?? ""} />
          </label>
        </div>
      </details>
      <div className="NewsEventFilters-actions">
        <button type="submit" disabled={busy}>{busy ? "Updating..." : "Apply filters"}</button>
        <button type="reset">Reset</button>
      </div>
    </form>
  );
}

export function NewsEventEmpty({ path, request, invalidPage = false }: {
  path: "/news" | "/events";
  request: NewsEventFilterRequest;
  invalidPage?: boolean;
}) {
  return (
    <div className="NewsEventEmpty">
      {request.errors.length ? (
        <>
          <h2>Check your filters</h2>
          <ul>{request.errors.map((error) => <li key={error}>{error}</li>)}</ul>
        </>
      ) : invalidPage ? (
        <h2>This page is not in the list.</h2>
      ) : (
        <h2>{request.active
          ? `No ${path === "/news" ? "stories" : "upcoming events"} match these filters.`
          : path === "/news" ? "No stories are published in this list yet." : "No upcoming events are listed right now."}</h2>
      )}
      {request.active || invalidPage ? <Link to={path} search={{}} resetScroll={false}>{request.active ? "Reset filters" : "Return to the first page"}</Link> : null}
    </div>
  );
}

export function NewsEventPagination({ path, request, pageWindow }: {
  path: "/news" | "/events";
  request: NewsEventFilterRequest;
  pageWindow: PageWindow<unknown>;
}) {
  if (request.errors.length || (pageWindow.totalPages <= 1 && pageWindow.indexable)) return null;
  const section = path === "/news" ? "news" : "events";
  return (
    <nav className="Pagination" aria-label={`${section === "news" ? "News" : "Events"} pagination`}>
      {pageWindow.prevPage != null ? (
        <Link to={path} search={newsEventFilterSearch(request.values, section, pageWindow.prevPage)}
          rel="prev">Previous</Link>
      ) : null}
      <p className="Pagination-status">{pageWindow.indexable ? `Page ${pageWindow.page} of ${pageWindow.totalPages}` : "This page is not in the list."}</p>
      {pageWindow.nextPage != null ? (
        <Link to={path} search={newsEventFilterSearch(request.values, section, pageWindow.nextPage)}
          rel="next">Next</Link>
      ) : null}
    </nav>
  );
}
