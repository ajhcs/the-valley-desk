import { Link } from "@tanstack/react-router";
import { publicFeatures } from "../../lib/public-features";

export function SiteFooter() {
  const { discovery, policyBackground } = publicFeatures();
  return (
    <footer className="SiteFooter directory-chrome desk-footer">
      <div className="desk-footer-sky"><div className="desk-footer-art" aria-hidden="true" /></div>
      <div className="desk-footer-river">
      <div className="desk-frame desk-footer-inner">
        <a className="desk-footer-brand" href="/">The Valley Desk</a>
        <nav className="SiteFooter-links desk-footer-links" aria-label="Footer">
          {discovery ? <><a href="/discover/works">Projects</a><a href="/discover/methodology">Methodology</a></> : null}
          {policyBackground ? <Link to="/policy">Policy background</Link> : null}
        </nav>
        <p className="SiteFooter-copy desk-footer-copy">
          Built by <a href="https://colelyons.com/">Cole Lyons</a>
        </p>
      </div>
      </div>
    </footer>
  );
}
