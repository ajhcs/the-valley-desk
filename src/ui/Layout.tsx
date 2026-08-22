import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { SiteFooter } from "./home/SiteFooter";

export function Layout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isHome = pathname === "/";

  return (
    <div className="Shell">
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
            <Link to="/news" className="NavLink is-news">
              News
            </Link>
            <Link to="/events" className="NavLink is-events">
              Events
            </Link>
          </nav>
        </div>
      </header>
      <main className="SiteMain">
        <Outlet />
      </main>
      {isHome ? null : (
        <div className="SiteChromeFooter">
          <SiteFooter />
        </div>
      )}
    </div>
  );
}
