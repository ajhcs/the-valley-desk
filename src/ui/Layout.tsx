import { Outlet, useRouterState } from "@tanstack/react-router";
import { publicFeatures } from "../lib/public-features";
import { DocumentHead } from "./DocumentHead";
import { FoldMark } from "./FoldMark";
import { MentionScope } from "./MentionScope";
import { SiteFooter } from "./home/SiteFooter";
import { SkipLink } from "./SkipLink";
import { ThemeControl } from "./ThemeControl";

export function Layout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isLab = pathname === "/lab" || pathname.startsWith("/lab/");
  return (
    <div className="Shell">
      <DocumentHead />
      {!isLab ? <SkipLink className="SiteSkip" href="#main-content">Skip to content</SkipLink> : null}
      {!isLab ? <header className="SiteHeader">
        <div className="SiteHeader-inner">
          <a href="/" className="SiteHeader-brand">
            <FoldMark />
            <span className="Wordmark">
              <span className="Wordmark-kicker">The</span>
              <span className="Wordmark-name">Valley Desk</span>
            </span>
          </a>
          {publicFeatures().discovery ? <nav className="SiteNav" aria-label="Primary">
            <a className="NavLink" href="/discover/works">Projects</a>
          </nav> : null}
          <ThemeControl />
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
