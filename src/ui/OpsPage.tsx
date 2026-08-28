import { useEffect, useState } from "react";

type OpsPayload = {
  schemaVersion?: string;
  buildSha?: string;
  run?: { state?: string; started_at?: string; finished_at?: string } | null;
  queue?: Array<{ queue_status?: string; count?: number }>;
  publications?: { count?: number; updated_at?: string } | null;
  sources?: Array<{ source_id?: string; state?: string; consecutive_failures?: number; last_checked_at?: string }>;
  review?: { items?: unknown[] };
  emailReview?: { items?: unknown[] };
  signalVerification?: {
    discoveries?: Array<{ verification_state?: string; count?: number }>;
    pointers?: Array<{ state?: string; count?: number }>;
  };
  signalReview?: { items?: unknown[] };
};

function OpsPage() {
  const [payload, setPayload] = useState<OpsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/ops/api/automation/status/review", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Status request failed (${response.status})`);
        return response.json() as Promise<OpsPayload>;
      })
      .then((next) => {
        if (active) setPayload(next);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "Status request failed");
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <article aria-labelledby="ops-title" className="OpsPage">
      <p className="OpsPage-kicker">Private operations</p>
      <h1 id="ops-title">The Valley Desk operations</h1>
      {error ? <p role="alert">{error}</p> : null}
      {!payload && !error ? <p>Loading operational status…</p> : null}
      {payload ? (
        <>
          <dl>
            <div><dt>Build</dt><dd>{payload.buildSha ?? "unknown"}</dd></div>
            <div><dt>Schema</dt><dd>{payload.schemaVersion ?? "unknown"}</dd></div>
            <div><dt>Last run</dt><dd>{payload.run?.state ?? "unknown"}</dd></div>
            <div><dt>Published</dt><dd>{payload.publications?.count ?? 0}</dd></div>
            <div><dt>Review candidates</dt><dd>{payload.review?.items?.length ?? 0}</dd></div>
            <div><dt>Email pointers</dt><dd>{payload.emailReview?.items?.length ?? 0}</dd></div>
            <div><dt>Signal verified</dt><dd>{payload.signalVerification?.pointers?.find((row) => row.state === "verified")?.count ?? 0}</dd></div>
            <div><dt>Signal failed</dt><dd>{payload.signalVerification?.pointers?.find((row) => row.state === "failed")?.count ?? 0}</dd></div>
          </dl>
          <h2>Source health</h2>
          <ul>
            {(payload.sources ?? []).map((source) => (
              <li key={source.source_id ?? source.last_checked_at ?? "source"}>
                {source.source_id ?? "unknown"}: {source.state ?? "unknown"}
                {source.consecutive_failures ? ` (${source.consecutive_failures} failures)` : ""}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </article>
  );
}

export { OpsPage };
