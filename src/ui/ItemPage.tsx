import { Link } from "@tanstack/react-router";
import { bySlug } from "../content/queries";
import type { EventItem } from "../content/schema";
import { catalog } from "../lib/catalog";
import { formatDate, formatWhen, sourceLine } from "../lib/format";
import { KIND_LABEL, KIND_PATH } from "../lib/kind";
import { EventJsonLd } from "./EventJsonLd";

export function ItemPage({ slug }: { slug: string }) {
  const item = bySlug(catalog, slug);
  if (!item) {
    return <p className="text-sm">Not found, or not published.</p>;
  }
  const accent = item.kind === "event" ? "var(--events)" : "var(--ink)";
  const when = item.kind === "event" ? formatWhen((item as EventItem).startsAt) : formatDate(item.publishedAt);
  return (
    <article>
      <EventJsonLd item={item} />
      <p className="text-xs tracking-wide uppercase" style={{ color: accent }}>
        <Link to={KIND_PATH[item.kind]} className="hover:underline">{KIND_LABEL[item.kind]}</Link>
        {" · "}
        {item.region}
      </p>
      <h1 className="text-3xl mt-2" style={{ color: "var(--text)" }}>{item.title}</h1>
      <p className="mt-2 text-lg">{item.dek}</p>
      <p className="mt-2 text-xs" style={{ color: accent }}>
        {when} · {sourceLine(item)}
        {item.source.url ? " · " + item.source.url : ""}
      </p>
      <p className="mt-6 whitespace-pre-wrap">{item.body}</p>
    </article>
  );
}
