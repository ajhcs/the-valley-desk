import { Link } from "@tanstack/react-router";

/** Unpublished/unknown page. Live shell comes from Layout. Worker keeps HTTP 404. */
export function NotFound() {
  return (
    <article className="NotFound">
      <h1>This page is not published.</h1>
      <p>The link may be old, unpublished, or mistyped. Nothing was invented to fill it.</p>
      <p>
        <Link to="/">Back to the desk</Link>
      </p>
    </article>
  );
}
