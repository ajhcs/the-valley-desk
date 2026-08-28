import { useRouterState } from "@tanstack/react-router";
import type { ContentItem } from "../content/schema";
import { listPagePath, pageFromSearch, paginate } from "../content/pagination";
import { latestVoices, publishedNewsList } from "../content/queries";
import { catalog } from "../lib/catalog";
import { KIND_LABEL } from "../lib/kind";
import { Rail } from "./home/Rail";

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
  const items =
    kind === "voice"
        ? latestVoices(catalog, Number.MAX_SAFE_INTEGER)
        : publishedNewsList(catalog);
  const page = paginate(items, pageFromSearch(searchStr));
  const path = kind === "voice" ? "/voices" : "/news";
  const rail = kind === "voice" ? "voices" : "news";
  const label =
    kind === "voice" ? "VOICES · LATEST" : "NEWS · LATEST";
  const title =
    kind === "voice" ? KIND_LABEL.voice : KIND_LABEL.news;
  return (
    <article className="KindList">
      <h1 className="KindList-title">{title}</h1>
      <div className="KindList-sections">
        <Rail label={label} rail={rail} items={page.items} />
        <Pagination path={path} label={title} pageWindow={page} />
      </div>
    </article>
  );
}
