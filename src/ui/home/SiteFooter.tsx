import { Link } from "@tanstack/react-router";
import { publicFeatures } from "../../lib/public-features";

export function SiteFooter() {
  const { discovery, policyBackground } = publicFeatures();
  return (
    <footer className="SiteFooter directory-chrome desk-footer">
      <div className="desk-frame desk-footer-inner">
        <a className="desk-footer-brand" href="/">The Valley Desk</a>
        <nav className="SiteFooter-links desk-footer-links" aria-label="Footer">
          {discovery ? <><a href="/discover/works">Projects</a><a href="/discover/methodology">Methodology</a></> : null}
          {policyBackground ? <Link to="/policy">Policy background</Link> : null}
          <a href="mailto:leads@thevalleydesk.org">Leads</a>
          <a href="/feed.json">feed.json</a>
          <a href="/feed.xml">feed.xml</a>
        </nav>
        <p className="SiteFooter-copy desk-footer-copy">
          © thedeskgroup - <a href="https://ushso.org/">USHSO.org</a>
        </p>
      </div>
    </footer>
  );
}
