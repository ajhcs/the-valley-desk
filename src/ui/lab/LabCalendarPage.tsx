import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { catalog } from "../../lib/catalog";
import { LabDetail } from "./LabDetail";
import { LabFilterGroup } from "./LabFilters";
import { LabShell } from "./LabShell";
import {
  etParts,
  etWallToUtc,
  etYmd,
  formatEtMonthTitle,
  formatEtWeekday,
  horizonPoints,
  monthCells,
  nextInMonth,
  pointsOnDay,
  shiftMonth,
} from "./lab";

type CalFilter = "all" | "clock" | "event";

const CAL_FILTERS: { id: CalFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "clock", label: "Clocks" },
  { id: "event", label: "Events" },
];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function LabCalendarPage() {
  const now = useMemo(() => new Date(), []);
  const todayKey = etYmd(now);
  const today = etParts(now);
  const allPoints = useMemo(() => horizonPoints(catalog), []);
  const nextPoint = allPoints.find((point) => point.at >= now.toISOString());
  const initialKey = nextPoint ? etYmd(nextPoint.at) : todayKey;
  const initialParts = initialKey.split("-").map(Number);
  const [year, setYear] = useState(initialParts[0] ?? today.year);
  const [month, setMonth] = useState(initialParts[1] ?? today.month);
  const [filter, setFilter] = useState<CalFilter>("all");
  const [selectedKey, setSelectedKey] = useState(initialKey);
  const [openId, setOpenId] = useState<string | undefined>();
  const cellRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const focusMovedCell = useRef(false);
  const points = useMemo(() => {
    return filter === "all" ? allPoints : allPoints.filter((point) => point.kind === filter);
  }, [allPoints, filter]);
  const cells = useMemo(() => monthCells(year, month), [year, month]);
  const dayPoints = pointsOnDay(points, selectedKey);
  const nextVisiblePoint = points.find((point) => point.at >= now.toISOString());
  const nextMonthPoint = nextInMonth(points, year, month, now);
  const viewingToday = year === today.year && month === today.month && selectedKey === todayKey;
  const selectedPoint = dayPoints.find((point) => point.id === openId) ?? dayPoints[0];
  const selectedParts = selectedKey.split("-").map(Number);
  const selectedDayLabel = formatEtWeekday(
    etWallToUtc(selectedParts[0] ?? year, selectedParts[1] ?? month, selectedParts[2] ?? 1, 12).toISOString(),
  );

  useEffect(() => {
    if (!focusMovedCell.current) return;
    cellRefs.current[selectedKey]?.focus();
    focusMovedCell.current = false;
  }, [cells, selectedKey]);

  function goMonth(delta: number) {
    const next = shiftMonth(year, month, delta);
    setYear(next.year);
    setMonth(next.month);
    setSelectedKey(`${next.year}-${String(next.month).padStart(2, "0")}-01`);
    setOpenId(undefined);
    focusMovedCell.current = true;
  }

  function goToday() {
    setYear(today.year);
    setMonth(today.month);
    setSelectedKey(todayKey);
    setOpenId(undefined);
    focusMovedCell.current = true;
  }

  function moveDay(delta: number) {
    const index = cells.findIndex((cell) => cell.key === selectedKey);
    const next = cells[Math.min(cells.length - 1, Math.max(0, (index < 0 ? 0 : index) + delta))];
    if (!next) return;
    if (!next.inMonth) {
      setYear(next.year);
      setMonth(next.month);
    }
    setSelectedKey(next.key);
    setOpenId(undefined);
    focusMovedCell.current = true;
  }

  function selectPoint(point: (typeof points)[number]) {
    const key = etYmd(point.at);
    const parts = key.split("-").map(Number);
    setYear(parts[0] ?? year);
    setMonth(parts[1] ?? month);
    setSelectedKey(key);
    setOpenId(point.id);
  }

  function onGridKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      moveDay(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      moveDay(-1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      moveDay(7);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveDay(-7);
    } else if (event.key === "Home") {
      event.preventDefault();
      const first = cells.find((cell) => cell.inMonth);
      if (first) {
        setSelectedKey(first.key);
        focusMovedCell.current = true;
      }
    } else if (event.key === "End") {
      event.preventDefault();
      const last = [...cells].reverse().find((cell) => cell.inMonth);
      if (last) {
        setSelectedKey(last.key);
        focusMovedCell.current = true;
      }
    } else if (event.key === "PageDown") {
      event.preventDefault();
      goMonth(1);
    } else if (event.key === "PageUp") {
      event.preventDefault();
      goMonth(-1);
    }
  }

  return (
    <LabShell title="Calendar" kicker="Month-first horizon">
      <p className="LabLead">
        Same catalog markers as the horizon: clocks and published events, including multi-day spans.
      </p>
      <div className="LabCalBar">
        <div className="LabCalNav" aria-label="Month controls">
          <button type="button" className="LabFilters-btn" onClick={() => goMonth(-1)}>
            Previous month
          </button>
          <h2 className="LabCalTitle">{formatEtMonthTitle(year, month)}</h2>
          <button type="button" className="LabFilters-btn" onClick={() => goMonth(1)}>
            Next month
          </button>
          <button type="button" className={viewingToday ? "LabFilters-btn is-on" : "LabFilters-btn"} onClick={goToday}>
            Today
          </button>
        </div>
        <LabFilterGroup label="Calendar filters" value={filter} options={CAL_FILTERS} onChange={setFilter} />
      </div>
      <p className="LabCalLegend" aria-label="Marker types">
        <span><i className="is-clock" /> Cutover</span>
        <span><i className="is-event" /> Event</span>
      </p>
      {nextVisiblePoint ? (
        <section className="LabCalNext" aria-labelledby="lab-cal-next-title">
          <p>{nextMonthPoint && nextMonthPoint.id !== nextVisiblePoint.id ? "Next on the desk" : "Next"}</p>
          <button type="button" className="LabTextBtn" onClick={() => selectPoint(nextVisiblePoint)}>
            <strong id="lab-cal-next-title">{nextVisiblePoint.item.title}</strong>
            <span>{formatEtWeekday(nextVisiblePoint.at)} · {nextVisiblePoint.kind === "clock" ? "CUTOVER" : "EVENT"}</span>
          </button>
          {nextMonthPoint && nextMonthPoint.id !== nextVisiblePoint.id ? (
            <button type="button" className="LabTextBtn" onClick={() => selectPoint(nextMonthPoint)}>
              <strong>Next this month</strong>
              <span>{nextMonthPoint.item.title} · {nextMonthPoint.kind === "clock" ? "CUTOVER" : "EVENT"}</span>
            </button>
          ) : null}
        </section>
      ) : null}
      <div className="LabCal" role="grid" aria-label={formatEtMonthTitle(year, month)} onKeyDown={onGridKey}>
        <div className="LabCal-week" role="row">
          {WEEKDAYS.map((day) => (
            <div key={day} role="columnheader" className="LabCal-head">
              {day}
            </div>
          ))}
        </div>
        {Array.from({ length: cells.length / 7 }, (_, week) => (
          <div key={week} className="LabCal-week" role="row">
            {cells.slice(week * 7, week * 7 + 7).map((cell) => {
              const marks = pointsOnDay(points, cell.key);
              const on = cell.key === selectedKey;
              return (
                <button
                  key={cell.key}
                  type="button"
                  role="gridcell"
                  aria-selected={on}
                  aria-current={cell.key === todayKey ? "date" : undefined}
                  aria-label={`${formatEtWeekday(etWallToUtc(cell.year, cell.month, cell.day, 12).toISOString())} — ${marks.length} ${marks.length === 1 ? "marker" : "markers"}${marks.length ? `: ${marks.map((mark) => mark.item.title).join("; ")}` : ""}`}
                  tabIndex={on ? 0 : -1}
                  ref={(node) => {
                    cellRefs.current[cell.key] = node;
                  }}
                  className={[
                    "LabCal-day",
                    cell.inMonth ? "" : "is-out",
                    on ? "is-on" : "",
                    cell.key === todayKey ? "is-today" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => {
                    setSelectedKey(cell.key);
                    setOpenId(undefined);
                    if (!cell.inMonth) {
                      setYear(cell.year);
                      setMonth(cell.month);
                    }
                  }}
                >
                  <span className="LabCal-num">{cell.day}</span>
                  <span className="LabCal-dots">
                    {marks.some((mark) => mark.kind === "clock") ? <i className="is-clock" /> : null}
                    {marks.some((mark) => mark.kind === "event") ? <i className="is-event" /> : null}
                  </span>
                  {marks.length ? (
                    <span className="LabCal-count">{marks.length}</span>
                  ) : null}
                  {marks.slice(0, 2).map((mark) => (
                    <span key={mark.id} className={mark.kind === "clock" ? "LabCal-mark is-clock" : "LabCal-mark"}>
                      {mark.item.title}
                    </span>
                  ))}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="LabSplit">
        <section>
          <h2 className="LabSub">{selectedDayLabel}</h2>
          {dayPoints.length === 0 ? (
            <p className="LabEmpty">No clocks or events on this day.</p>
          ) : dayPoints.length > 1 ? (
            <ul className="LabMini">
              {dayPoints.map((point) => (
                <li key={point.id}>
                  <button
                    type="button"
                    className={point.id === selectedPoint?.id ? "LabTextBtn is-on" : "LabTextBtn"}
                    onClick={() => setOpenId(point.id)}
                  >
                    {point.item.title}
                  </button>
                  <span>{point.kind === "clock" ? "CUTOVER" : "EVENT"}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
        {selectedPoint ? (
          <LabDetail key={selectedPoint.id} item={selectedPoint.item} labelledBy="lab-cal-selected" />
        ) : null}
      </div>
    </LabShell>
  );
}
