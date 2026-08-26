import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { navSection } from "../lib/nav";
import { DocumentHead } from "./DocumentHead";
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
            <img className="MarkFold" src="/mark-a-fold.svg" alt="" />
            <span className="Wordmark">
              <span className="Wordmark-kicker">The</span>
              <span className="Wordmark-name">Valley Desk</span>
            </span>
          </Link>
          <nav className="SiteNav">
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
            <Link
              to="/voices"
              className="NavLink is-voices"
              activeOptions={{ exact: true }}
              activeProps={{
                className: "NavLink is-voices",
                "aria-current": current === "voices" ? "page" : undefined,
              }}
              inactiveProps={{
                className: "NavLink is-voices",
                "aria-current": current === "voices" ? "page" : undefined,
              }}
            >
              Voices
            </Link>
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
