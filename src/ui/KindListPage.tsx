import type { ContentItem } from "../content/schema";
import { latestVoices, productWatch, publishedNewsList } from "../content/queries";
import { catalog } from "../lib/catalog";
import { KIND_LABEL } from "../lib/kind";
import { Rail } from "./home/Rail";
import { ProductWatch } from "./ProductWatch";

export function KindListPage({ kind }: { kind: ContentItem["kind"] }) {
  const watched = kind === "news" ? productWatch(catalog) : [];
  const watchedIds = new Set(watched.map((item) => item.id));
  const items =
    kind === "voice"
        ? latestVoices(catalog, Number.MAX_SAFE_INTEGER)
        : publishedNewsList(catalog).filter((item) => !watchedIds.has(item.id));
  const rail = kind === "voice" ? "voices" : "news";
  const label =
    kind === "voice" ? "VOICES · LATEST" : "NEWS · LATEST";
  const title =
    kind === "voice" ? KIND_LABEL.voice : KIND_LABEL.news;
  return (
    <article className="KindList">
      <h1 className="KindList-title">{title}</h1>
      <div className="KindList-sections">
        {watched.length ? <ProductWatch items={watched} /> : null}
        <Rail label={label} rail={rail} items={items} />
      </div>
    </article>
  );
}
