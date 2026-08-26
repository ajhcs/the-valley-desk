import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { briefingSinceYesterday5pmET, windowStartYesterday5pmET } from "../../content/queries";
import type { ContentItem } from "../../content/schema";
import { catalog } from "../../lib/catalog";
import { formatEventWhen } from "../../lib/calendar";
import { formatDate, formatWhen } from "../../lib/format";
import { itemHref } from "../../lib/kind";
import { MentionText } from "../MentionText";
import { LabFilterGroup } from "./LabFilters";
import { LabShell } from "./LabShell";
import {
  briefingFilterOptions,
  eventsThisWeek,
  filterBriefing,
  formatEtClock,
  formatEtWeekday,
  isBriefingUnread,
  nextBriefingAt,
  readBriefingLastRead,
  topicLabel,
  writeBriefingLastRead,
  type BriefingFilter,
} from "./lab";

function rowTime(item: ContentItem) {
  return formatEtClock(item.publishedAt ?? item.updatedAt);
}

export function LabChronoPage() {
  const [filter, setFilter] = useState<BriefingFilter>("all");
  const [active, setActive] = useState(0);
  const [lastRead, setLastRead] = useState<string | undefined>();
  const now = useMemo(() => new Date(), []);
  const windowItems = briefingSinceYesterday5pmET(catalog, now);
  const rows = useMemo(() => filterBriefing(windowItems, filter), [filter, windowItems]);
  const windowStart = windowStartYesterday5pmET(now);
  const week = eventsThisWeek(catalog, now);
  const next = nextBriefingAt(now);
  const selected = rows[Math.min(active, Math.max(rows.length - 1, 0))];

  useEffect(() => {
    const prev = readBriefingLastRead(window.localStorage);
    setLastRead(prev);
    writeBriefingLastRead(window.localStorage, now.toISOString());
  }, [now]);

  return (
    <LabShell title="Chronological briefing" kicker="Since 17:00 ET">
      <p className="LabLead" aria-live="polite">
        {windowItems.length} in the current window since {formatWhen(windowStart.toISOString())}. This is the finite twice-daily catch-up, not the archive.
      </p>
      <LabFilterGroup
        label="Briefing filters"
        value={filter}
        options={briefingFilterOptions()}
        onChange={(id) => {
          setFilter(id);
          setActive(0);
        }}
      />
      <div className="LabSplit">
        <div
          className="LabList"
          role="list"
          aria-label="Chronological items"
        >
          {rows.length === 0 ? (
            <p className="LabEmpty">
              {windowItems.length === 0
                ? `Nothing in this catch-up window yet. Next check-in ${formatEtClock(next.toISOString())} ET.`
                : "Nothing published in this filter."}
            </p>
          ) : (
            rows.map((item, index) => {
              const on = item.id === selected?.id;
              const unread = isBriefingUnread(item, lastRead);
              return (
                <article
                  key={item.id}
                  role="listitem"
                  className={[on ? "LabRow is-active" : "LabRow", unread ? "is-unread" : "is-read"].filter(Boolean).join(" ")}
                  style={{ ["--i" as string]: index }}
                  onClick={() => setActive(index)}
                >
                  <time className="LabRow-time" dateTime={item.publishedAt ?? item.updatedAt}>
                    {rowTime(item)}
                  </time>
                  <div className="LabRow-copy">
                    <h2>
                      <Link to={itemHref(item)}>
                        <MentionText text={item.title} item={item} />
                      </Link>
                    </h2>
                    {item.impactSentence ? (
                      <p>
                        <MentionText text={item.impactSentence} item={item} interactive />
                      </p>
                    ) : null}
                    <p className="LabRow-src">{formatDate(item.publishedAt)}</p>
                  </div>
                  <span className="LabTag">{topicLabel(item)}</span>
                  {unread ? <span className="LabUnread">Unread</span> : null}
                </article>
              );
            })
          )}
        </div>
        <aside className="LabSide">
          <section className="LabCard">
            <h2>Next clock</h2>
            <p className="LabCard-clock">{formatEtClock(next.toISOString())} ET</p>
            <p>Suggested next personal check-in at the 06:00 / 17:00 ET cadence.</p>
            <p className="LabRow-src">{formatEtWeekday(next.toISOString())}</p>
          </section>
          <section className="LabCard">
            <h2>Today / this week</h2>
            {week.length === 0 ? (
              <p className="LabEmpty">No published events this week.</p>
            ) : (
              <ul className="LabMini">
                {week.map((item) => (
                  <li key={item.id}>
                    <Link to={itemHref(item)}>
                      <MentionText text={item.title} item={item} />
                    </Link>
                    <span>{formatEventWhen(item)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </LabShell>
  );
}
