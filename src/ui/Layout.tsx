import { Link, Outlet } from "@tanstack/react-router";

const nav = [
  ["/", "Home"],
  ["/news", "News"],
  ["/events", "Events"],
  ["/voices", "Voices"],
  ["/policy", "Policy"],
  ["/ai", "AI"],
  ["/briefing", "Briefing"],
] as const;

export function Layout() {
  return (
    <div className="min-h-screen">
      <header className="border-b" style={{ borderColor: "var(--ink)" }}>
        <div className="mx-auto max-w-5xl px-4 py-4 flex items-center gap-3">
          <Link to="/" className="shrink-0" aria-label="The Valley Desk home">
            <img
              src="/header-lockup.svg"
              alt="The Valley Desk"
              className="h-10 w-auto"
            />
          </Link>
          <p className="text-xs hidden sm:block" style={{ color: "var(--text)" }}>
            Local health-tech news for people and agents
          </p>
          <a
            href="/feed.json"
            className="ml-auto text-xs underline"
            style={{ color: "var(--admiral)" }}
          >
            feed.json
          </a>
        </div>
        <nav className="mx-auto max-w-5xl px-4 pb-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {nav.map(([to, label]) => (
            <Link key={to} to={to} className="hover:underline" style={{ color: "var(--ink)" }}>
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
