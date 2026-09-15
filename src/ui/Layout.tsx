import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { navSection } from "../lib/nav";
import { publicFeatures } from "../lib/public-features";
import { DocumentHead } from "./DocumentHead";
import { FoldMark } from "./FoldMark";
import { MentionScope } from "./MentionScope";
import { SiteFooter } from "./home/SiteFooter";
import { SkipLink } from "./SkipLink";

export function Layout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = navSection(pathname);
  const isLab = pathname === "/lab" || pathname.startsWith("/lab/");
  return (
    <div className="Shell">
      <DocumentHead />
      {!isLab ? <SkipLink className="SiteSkip" href="#main-content">Skip to content</SkipLink> : null}
      {!isLab ? <header className="SiteHeader">
        <div className="SiteHeader-inner">
          <Link to="/" className="SiteHeader-brand">
            <FoldMark />
            <span className="Wordmark">
              <span className="Wordmark-kicker">The</span>
              <span className="Wordmark-name">Valley Desk</span>
            </span>
          </Link>
          <nav className="SiteNav" aria-label="Primary">
            <Link
              to="/news"
              className="NavLink is-news"
              activeOptions={{ exact: true }}
              activeProps={{
                className: "NavLink is-news",
                "aria-current": current === "news" ? "page" : undefined,
              }}
              inactiveProps={{
                className: "NavLink is-news",
                "aria-current": current === "news" ? "page" : undefined,
              }}
            >
              News
            </Link>
            <Link
              to="/events"
              className="NavLink is-events"
              activeOptions={{ exact: true }}
              activeProps={{
                className: "NavLink is-events",
                "aria-current": current === "events" ? "page" : undefined,
              }}
              inactiveProps={{
                className: "NavLink is-events",
                "aria-current": current === "events" ? "page" : undefined,
              }}
            >
              Events
            </Link>
            {publicFeatures().watch ? <>
              <Link to="/policy-watch" search={{}} className="NavLink is-policy-watch"
                aria-current={current === "policy-watch" ? "page" : undefined}>Policy Watch</Link>
              <Link to="/technology-watch" search={{}} className="NavLink is-technology-watch"
                aria-current={current === "technology-watch" ? "page" : undefined}>Technology Watch</Link>
            </> : null}
          </nav>
        </div>
      </header> : null}
      <main id="main-content" tabIndex={-1} className={isLab ? "SiteMain is-lab" : "SiteMain"}>
        <MentionScope key={pathname}>
          <Outlet />
        </MentionScope>
      </main>
      {!isLab ? <SiteFooter /> : null}
    </div>
  );
}
