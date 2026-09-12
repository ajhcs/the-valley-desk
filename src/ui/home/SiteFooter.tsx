import { Link } from "@tanstack/react-router";
import { publicFeatures } from "../../lib/public-features";

export function SiteFooter() {
  return (
    <footer className="SiteFooter">
      <nav className="SiteFooter-links">
        <Link to="/news">News</Link>
        <Link to="/events">Events</Link>
        <Link to="/voices">Voices</Link>
        {publicFeatures().policyBackground ? <Link to="/policy">Policy background</Link> : null}
        <a href="mailto:leads@thevalleydesk.org">Leads</a>
        <a href="/feed.json">feed.json</a>
        <a href="/feed.xml">feed.xml</a>
      </nav>
      <p className="SiteFooter-copy">
        © thedeskgroup - <a href="https://ushso.org/">USHSO.org</a>
      </p>
    </footer>
  );
}
