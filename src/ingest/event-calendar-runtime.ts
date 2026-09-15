import publishedCatalog from "../content/published-catalog.json";
import { ContentCatalog } from "../content/schema";
import { mergePublishedContent } from "./public-feed";
import { readPublishedContent, readPublicationTombstones } from "./persistence";
import type { D1DatabaseLike } from "./persistence";
import { maintainEventCalendar } from "./event-calendar";
import { publicOrigin } from "../lib/canonical";

export async function syncPublishedEventCalendar(db: D1DatabaseLike, now = new Date(), origin = publicOrigin()) {
  const snapshot = await db.prepare("SELECT revision FROM event_calendar_publication_clock WHERE singleton=1")
    .first<{revision:number}>();
  if (!snapshot || !Number.isSafeInteger(snapshot.revision)) throw Error("calendar-publication-clock-unavailable");
  const dynamic = await readPublishedContent(db);
  const withdrawn = await readPublicationTombstones(db);
  const items = mergePublishedContent(ContentCatalog.parse(publishedCatalog), dynamic, withdrawn);
  // Only a current, approved D1 republication may reverse a retained withdrawal.
  // Stale bundled events and mere collector rediscovery cannot do so.
  return maintainEventCalendar(db, items, withdrawn, now, origin,
    dynamic.filter(item => item.kind === "event").map(item => item.id), () => [
      db.prepare(`INSERT INTO event_calendar_write_guards SELECT ?,CASE WHEN
        (SELECT revision FROM event_calendar_publication_clock WHERE singleton=1)=? THEN 1 ELSE 0 END`)
        .bind(crypto.randomUUID(),snapshot.revision),
    ]);
}
