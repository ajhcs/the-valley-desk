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
      {!isLab ? <header className="SiteHeader directory-chrome desk-masthead">
        <div className="SiteHeader-inner desk-frame desk-masthead-inner">
          <a href="/" className="SiteHeader-brand desk-brand">
            <FoldMark className="desk-mark" />
            <span className="Wordmark desk-wordmark">
              <span className="Wordmark-kicker">The</span>
              <strong className="Wordmark-name">Valley Desk</strong>
            </span>
          </a>
          {publicFeatures().discovery ? <nav className="SiteNav desk-primary" aria-label="Primary">
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
