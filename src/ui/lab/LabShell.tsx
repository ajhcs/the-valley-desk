import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { LAB_VIEWS, type LabPath } from "./lab";
import { LabLockup } from "./LabMark";
import { SkipLink } from "../SkipLink";
import { publicFeatures } from "../../lib/public-features";
import "./lab.css";

const TITLES: Record<LabPath, string> = {
  "/lab": "Lab",
  "/lab/briefing": "Lab · Briefing",
  "/lab/systems": "Lab · Systems",
  "/lab/horizon": "Lab · Horizon",
  "/lab/calendar": "Lab · Calendar",
};

export function LabShell({
  title,
  kicker,
  children,
}: {
  title: string;
  kicker: string;
  children: ReactNode;
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname }).replace(/\/+$/, "") || "/";
  const current = (LAB_VIEWS.find((view) => view.to === pathname)?.to ?? "/lab") as LabPath;

  useEffect(() => {
    document.title = `${TITLES[current]} · The Valley Desk`;
  }, [current]);

  return (
    <div className="Lab">
      <SkipLink className="LabSkip" href="#lab-content">
        Skip to prototype
      </SkipLink>
      <header className="LabMast">
        <Link to="/" className="LabHome"><LabLockup /></Link>
        {publicFeatures().discovery ? <nav className="LabPublicNav" aria-label="Public sections">
          <a href="/discover/works">Projects</a>
        </nav> : null}
        <p className="LabMast-note">Design lab</p>
      </header>
      <nav className="LabSwitch" aria-label="Prototype views">
        {LAB_VIEWS.map((view) => {
          const active = view.to === current;
          return (
            <Link
              key={view.to}
              to={view.to}
              className={active ? "LabSwitch-link is-active" : "LabSwitch-link"}
              activeOptions={{ exact: true }}
              aria-current={active ? "page" : undefined}
            >
              {view.label}
            </Link>
          );
        })}
      </nav>
      <header className="LabHead">
        <p className="LabKicker">{kicker}</p>
        <h1>{title}</h1>
      </header>
      <div id="lab-content" className="LabBody" tabIndex={-1}>
        {children}
      </div>
    </div>
  );
}
