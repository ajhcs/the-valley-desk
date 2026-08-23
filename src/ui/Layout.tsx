import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { navSection } from "../lib/nav";
import { DocumentHead } from "./DocumentHead";
import { MentionScope } from "./MentionScope";
import { SiteFooter } from "./home/SiteFooter";

export function Layout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const current = navSection(pathname);
  return (
    <div className="Shell">
      <DocumentHead />
      <header className="SiteHeader">
        <div className="SiteHeader-inner">
          <Link to="/" className="SiteHeader-brand" aria-label="The Valley Desk home">
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
      </header>
      <main className="SiteMain">
        <MentionScope key={pathname}>
          <Outlet />
        </MentionScope>
      </main>
      <SiteFooter />
    </div>
  );
}
