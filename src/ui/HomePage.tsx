import { catalog } from "../lib/catalog";
import { latestNews, upcomingEvents } from "../content/queries";
import { ItemCard } from "../ui/ItemCard";

export function HomePage() {
  const news = latestNews(catalog);
  const events = upcomingEvents(catalog);
  return (
    <section className="grid gap-8 md:grid-cols-2">
      <div>
        <h1 className="text-sm font-semibold tracking-widest uppercase" style={{ color: "var(--ink)" }}>
          News
        </h1>
        <div>
          {news.map((item) => (
            <ItemCard key={item.id} item={item} rail="news" />
          ))}
        </div>
      </div>
      <div>
        <h1 className="text-sm font-semibold tracking-widest uppercase" style={{ color: "var(--events)" }}>
          Events
        </h1>
        <div>
          {events.map((item) => (
            <ItemCard key={item.id} item={item} rail="events" />
          ))}
        </div>
      </div>
    </section>
  );
}
