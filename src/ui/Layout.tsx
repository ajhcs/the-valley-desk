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
          <div
            aria-hidden="true"
            className="h-10 w-10 shrink-0 border"
            style={{ borderColor: "var(--ink)" }}
            title="Logo slot"
          />
          <div>
            <p className="text-xl font-semibold" style={{ color: "var(--ink)" }}>
              The Valley Desk
            </p>
            <p className="text-xs" style={{ color: "var(--text)" }}>
              Local health-tech news for people and agents
            </p>
          </div>
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
