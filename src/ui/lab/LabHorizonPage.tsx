import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { catalog } from "../../lib/catalog";
import { formatChipLabel } from "../../lib/format";
import { LabDetail } from "./LabDetail";
import { LabFilterGroup } from "./LabFilters";
import { LabShell } from "./LabShell";
import {
  daysUntil,
  etYmd,
  formatEtWeekday,
  horizonPoints,
  horizonWindow,
  pointsInRange,
  upcomingHorizon,
} from "./lab";

type HorizonFilter = "all" | "clock" | "event";

const HORIZON_FILTERS: { id: HorizonFilter; label: string }[] = [
  { id: "all", label: "All markers" },
  { id: "clock", label: "Clocks" },
  { id: "event", label: "Events" },
];

export function LabHorizonPage() {
  const now = useMemo(() => new Date(), []);
  const [filter, setFilter] = useState<HorizonFilter>("all");
  const points = useMemo(() => {
    const all = upcomingHorizon(horizonPoints(catalog), now);
    return filter === "all" ? all : all.filter((point) => point.kind === filter);
  }, [filter, now]);
  const window = horizonWindow(now, 30);
  const ranged = pointsInRange(points, window.start, window.end);
  const clocks = points.filter((point) => point.kind === "clock");
  const merged = new Map<string, (typeof points)[number]>();
  for (const point of [...clocks, ...ranged]) merged.set(point.id, point);
  if (points[0] && (points[0].kind === "clock" || ranged.some((row) => row.id === points[0].id))) {
    merged.set(points[0].id, points[0]);
  }
  const inWindow = [...merged.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  const later = points.filter((point) => !inWindow.some((row) => row.id === point.id));
  const [selectedId, setSelectedId] = useState<string | undefined>(inWindow[0]?.id ?? points[0]?.id);
  const tickRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const laterRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const focusMovedTick = useRef(false);
  const selected = points.find((point) => point.id === selectedId)
    ?? inWindow.find((point) => point.id === selectedId)
    ?? inWindow[0]
    ?? points[0];
  const selectedOnAxis = Boolean(selected && inWindow.some((point) => point.id === selected.id));
  const next = points[0];
  const nextClock = clocks[0];

  useEffect(() => {
    if (!focusMovedTick.current || !selected?.id) return;
    const node = selectedOnAxis ? tickRefs.current[selected.id] : laterRefs.current[selected.id];
    node?.focus();
    node?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
    focusMovedTick.current = false;
  }, [selected?.id, selectedOnAxis]);

  function move(delta: number) {
    if (!inWindow.length) return;
    const index = Math.max(0, inWindow.findIndex((point) => point.id === selected?.id));
    const nextIndex = Math.min(inWindow.length - 1, Math.max(0, index + delta));
    setSelectedId(inWindow[nextIndex].id);
    focusMovedTick.current = true;
  }

  function onAxisKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Home") {
      event.preventDefault();
      setSelectedId(inWindow[0]?.id);
      focusMovedTick.current = true;
    } else if (event.key === "End") {
      event.preventDefault();
      setSelectedId(inWindow[inWindow.length - 1]?.id);
      focusMovedTick.current = true;
    }
  }

  return (
    <LabShell title="Deadline horizon" kicker="30-day view">
      <p className="LabLead">
        Markers are news <code>clockAt</code> values and published event start times. Title-only dates stay off the axis. Clocks stay on the axis even when they sit past 30 days. Events after 30 days are listed under After 30 days and are outside this listbox.
      </p>
      <LabFilterGroup
        label="Horizon filters"
        value={filter}
        options={HORIZON_FILTERS}
        onChange={(id) => {
          setFilter(id);
          setSelectedId(undefined);
        }}
      />
      {next ? (
        <section className="LabNext">
          <p>Next</p>
          <h2>{next.item.title}</h2>
          <p>
            {formatEtWeekday(next.at)} · {daysUntil(next.at, now)} days · {next.kind === "clock" ? "CUTOVER" : "EVENT"}
          </p>
          {nextClock && nextClock.id !== next.id ? (
            <p>
              Next CUTOVER · {nextClock.item.title} · {daysUntil(nextClock.at, now)} days
            </p>
          ) : null}
        </section>
      ) : (
        <p className="LabEmpty">No upcoming clocks or events.</p>
      )}
      {inWindow.length > 2 ? (
        <p className="LabAxisCue" id="lab-horizon-axis-cue">
          Scroll the axis. Off-edge ticks include monitored cutovers beyond 30 days.
        </p>
      ) : null}
      <div
        className="LabAxis"
        role="listbox"
        aria-orientation="horizontal"
        aria-label="Deadline timeline"
        aria-activedescendant={selectedOnAxis && selected ? `lab-tick-${selected.id}` : undefined}
        aria-describedby={inWindow.length > 2 ? "lab-horizon-axis-cue" : undefined}
        onKeyDown={onAxisKey}
      >
        {inWindow.length === 0 ? (
          <p className="LabEmpty">Nothing in the next 30 days for this filter.</p>
        ) : (
          inWindow.map((point, index) => {
            const on = selectedOnAxis && point.id === selected?.id;
            return (
              <button
                key={point.id}
                id={`lab-tick-${point.id}`}
                type="button"
                role="option"
                aria-selected={on}
                tabIndex={on ? 0 : -1}
                ref={(node) => {
                  tickRefs.current[point.id] = node;
                }}
                className={on ? "LabTick is-on" : "LabTick"}
                style={{ ["--i" as string]: index }}
                onClick={() => {
                  setSelectedId(point.id);
                  focusMovedTick.current = true;
                }}
              >
                <span className="LabTick-day">{etYmd(point.at).slice(5)}</span>
                <span className={point.kind === "clock" ? "LabTick-dot is-clock" : "LabTick-dot is-event"} />
                <span className="LabTick-kind">{point.kind === "clock" ? "CUTOVER" : formatChipLabel(point.item)}</span>
                <span className="LabTick-label">{point.item.title}</span>
              </button>
            );
          })
        )}
      </div>
      <div className="LabSplit">
        <div>
          <h2 className="LabSub">Selected</h2>
          {selected ? (
            <LabDetail key={selected.id} item={selected.item} labelledBy="lab-horizon-selected" />
          ) : null}
        </div>
        <aside className="LabSide">
          <section className="LabCard">
            <h2>After 30 days</h2>
            {later.length === 0 ? (
              <p className="LabEmpty">Nothing beyond 30 days.</p>
            ) : (
              <ul className="LabMini">
                {later.map((point) => {
                  const on = !selectedOnAxis && point.id === selected?.id;
                  return (
                    <li key={point.id}>
                      <button
                        type="button"
                        className={on ? "LabTextBtn is-on" : "LabTextBtn"}
                        aria-current={on ? "true" : undefined}
                        ref={(node) => {
                          laterRefs.current[point.id] = node;
                        }}
                        onClick={() => {
                          setSelectedId(point.id);
                          focusMovedTick.current = true;
                        }}
                      >
                        {point.item.title}
                      </button>
                      <span>{formatChipLabel(point.item)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </LabShell>
  );
}
