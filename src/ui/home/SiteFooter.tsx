import { Link } from "@tanstack/react-router";

export function SiteFooter() {
  return (
    <footer className="SiteFooter">
      <nav className="SiteFooter-links">
        <Link to="/news">News</Link>
        <Link to="/events">Events</Link>
        <a href="/feed.json">feed.json</a>
        <a href="/feed.xml">feed.xml</a>
      </nav>
      <p className="SiteFooter-copy">© The Valley Desk</p>
    </footer>
  );
}
