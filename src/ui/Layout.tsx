import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { SiteFooter } from "./home/SiteFooter";

export function Layout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isHome = pathname === "/";

  return (
    <div className="min-h-screen">
      <header>
        <div className="mx-auto max-w-5xl px-4 py-4 flex items-center gap-3">
          <Link to="/" className="shrink-0 flex items-center gap-3" aria-label="The Valley Desk home">
            <img className="MarkFold" src="/mark-a-fold.svg" alt="" />
            <span className="Wordmark">
              <span className="Wordmark-kicker">The</span>
              <span className="Wordmark-name">Valley Desk</span>
            </span>
          </Link>
          <nav className="ml-auto flex gap-x-5 text-sm">
            <Link
              to="/news"
              className="NavLink is-news"
              activeProps={{ className: "NavLink is-news is-active" }}
            >
              News
            </Link>
            <Link
              to="/events"
              className="NavLink is-events"
              activeProps={{ className: "NavLink is-events is-active" }}
            >
              Events
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
      {isHome ? null : <div className="mx-auto max-w-5xl px-4 pb-8"><SiteFooter /></div>}
    </div>
  );
}
