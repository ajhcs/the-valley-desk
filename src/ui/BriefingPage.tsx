import { catalog } from "../lib/catalog";
import { briefingSinceYesterday5pmET, windowStartYesterday5pmET } from "../content/queries";
import { ItemCard } from "./ItemCard";

export function BriefingPage() {
  const items = briefingSinceYesterday5pmET(catalog);
  const start = windowStartYesterday5pmET();
  const startLabel = start.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <section>
      <h1 className="text-sm font-semibold tracking-widest uppercase" style={{ color: "var(--ink)" }}>
        Briefing
      </h1>
      <p className="mt-2 text-sm" style={{ color: "var(--text)" }}>
        Since {startLabel} ET. Desk order is clockAt if present, else publishedAt; overlap breaks ties. Review can appear here.
      </p>
      {items.length === 0 ? (
        <p className="mt-4 text-sm">Nothing in this window yet.</p>
      ) : (
        items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            rail={item.kind === "event" ? "events" : "news"}
          />
        ))
      )}
    </section>
  );
}
