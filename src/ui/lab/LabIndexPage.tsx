import { Link } from "@tanstack/react-router";
import { catalog } from "../../lib/catalog";
import { entities } from "../../lib/entities";
import { upcomingEvents } from "../../content/queries";
import { LabShell } from "./LabShell";
import { chronologicalDesk, horizonPoints, liveSystems, upcomingHorizon } from "./lab";

export function LabIndexPage() {
  const desk = chronologicalDesk(catalog);
  const systems = liveSystems(entities);
  const horizon = upcomingHorizon(horizonPoints(catalog));
  const events = upcomingEvents(catalog, new Date(), Number.MAX_SAFE_INTEGER);
  return (
    <LabShell title="Four ways to read the same desk." kicker="Lab">
      <p className="LabLead">
        The same published desk, four ways to read it. {desk.length} published rows, {systems.length} health systems, {horizon.length} upcoming clocks and events, {events.length} future events.
      </p>
      <ul className="LabIndex">
        <li>
          <Link to="/lab/briefing">
            <span>Briefing</span>
            <strong>Chronological desk</strong>
            <em>What landed, in time order, for a calm 06:00 / 17:00 ET check-in.</em>
          </Link>
        </li>
        <li>
          <Link to="/lab/systems">
            <span>Systems</span>
            <strong>Health-system command grid</strong>
            <em>One card per seed system. Movement and signed facts, no org routes.</em>
          </Link>
        </li>
        <li>
          <Link to="/lab/horizon">
            <span>Horizon</span>
            <strong>Deadline timeline</strong>
            <em>News clocks and published events on a selectable 30-day axis.</em>
          </Link>
        </li>
        <li>
          <Link to="/lab/calendar">
            <span>Calendar</span>
            <strong>Month-first horizon</strong>
            <em>Same markers on a day/month grid with drill-down.</em>
          </Link>
        </li>
      </ul>
    </LabShell>
  );
}
