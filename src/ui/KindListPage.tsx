import { useRouterState } from "@tanstack/react-router";
import type { ContentItem } from "../content/schema";
import { listPagePath, pageFromSearch, paginate } from "../content/pagination";
import { latestVoices, publishedNewsList } from "../content/queries";
import { filterOptions, filteredNews, parseNewsEventFilters } from "../content/news-event-filters";
import { catalog } from "../lib/catalog";
import { entityLookup } from "../lib/entities";
import { KIND_LABEL } from "../lib/kind";
import { Rail } from "./home/Rail";
import { NewsEventEmpty, NewsEventFilters, NewsEventPagination } from "./NewsEventFilters";

function Pagination({
  path,
  label,
  pageWindow,
}: {
  path: "/news" | "/voices";
  label: string;
  pageWindow: ReturnType<typeof paginate<ContentItem>>;
}) {
  if (pageWindow.totalPages <= 1 && pageWindow.indexable) return null;
  const status = pageWindow.indexable
    ? `Page ${pageWindow.page} of ${pageWindow.totalPages}`
    : "This page is not in the list.";
  return (
    <nav className="Pagination" aria-label={`${label} pagination`}>
      {pageWindow.prevPage != null ? (
        <a href={listPagePath(path, pageWindow.prevPage)} rel="prev">Previous</a>
      ) : null}
      <p className="Pagination-status" aria-live="polite">{status}</p>
      {pageWindow.nextPage != null ? (
        <a href={listPagePath(path, pageWindow.nextPage)} rel="next">Next</a>
      ) : null}
    </nav>
  );
}

export function KindListPage({ kind }: { kind: ContentItem["kind"] }) {
  const searchStr = useRouterState({ select: (s) => s.location.searchStr });
  const busy = useRouterState({ select: (s) => s.isLoading });
  const request = parseNewsEventFilters(searchStr, "news");
  const items =
    kind === "voice"
        ? latestVoices(catalog, Number.MAX_SAFE_INTEGER)
        : filteredNews(catalog, request);
  const page = paginate(items, pageFromSearch(searchStr));
  const choices = kind === "voice" ? [] : publishedNewsList(catalog);
  const path = kind === "voice" ? "/voices" : "/news";
  const rail = kind === "voice" ? "voices" : "news";
  const label =
    kind === "voice" ? "VOICES · LATEST" : "NEWS · LATEST";
  const title =
    kind === "voice" ? KIND_LABEL.voice : KIND_LABEL.news;
  const matchText = page.total === 1 ? " matches these filters" : " match these filters";
  const resultStatus = busy ? "Updating stories..."
    : request.errors.length ? "Filters need attention."
    : !page.indexable ? "Page unavailable."
    : `${page.total} ${page.total === 1 ? "story" : "stories"}${request.active ? matchText : " published"}.`;
  return (
    <article className="KindList">
      <h1 className="KindList-title">{title}</h1>
      {kind !== "voice" ? (
        <NewsEventFilters key={searchStr} section="news" request={request} busy={busy}
          organizations={filterOptions(choices.flatMap((item) => item.orgs), (id) => entityLookup.match(id)?.name ?? id)}
          topics={filterOptions(choices.flatMap((item) => item.topics))} />
      ) : null}
      <div className={kind === "voice" ? "KindList-sections" : "KindList-sections NewsEventResults"} aria-busy={busy}>
        {kind !== "voice" ? <p className="NewsEventResults-count" role="status">
          {resultStatus}
        </p> : null}
        {kind === "voice" || page.items.length ? <Rail label={label} rail={rail} items={page.items} /> : (
          <NewsEventEmpty path="/news" request={request} invalidPage={!page.indexable} />
        )}
        {kind === "voice" ? <Pagination path={path} label={title} pageWindow={page} /> : (
          <NewsEventPagination path="/news" request={request} pageWindow={page} />
        )}
      </div>
    </article>
  );
}
