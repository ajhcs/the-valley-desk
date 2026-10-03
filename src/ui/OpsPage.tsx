import { useEffect, useState } from "react";
import { registerRegionalBrowserTools } from "../agents/regional-browser";
import { PolicyBaseline } from "./PolicyBaselinePage";
import { WatchEditorialReview } from "./WatchEditorialReview";

type OpsPayload = {
  schemaVersion?: string;
  buildSha?: string;
  run?: { state?: string; started_at?: string; finished_at?: string } | null;
  queue?: Array<{ queue_status?: string; count?: number }>;
  publications?: { count?: number; updated_at?: string } | null;
  sources?: Array<{
    source_id?: string;
    source_type?: string;
    state?: string;
    consecutive_failures?: number;
    last_checked_at?: string;
    next_attempt_at?: string;
    last_success_at?: string;
    last_fallback_url?: string | null;
    last_http_status?: number | null;
    last_error?: string | null;
    institution_ids?: string[];
    failure_age_ms?: number | null;
  }>;
  review?: { items?: unknown[] };
  emailReview?: { items?: unknown[] };
  signalVerification?: {
    discoveries?: Array<{ verification_state?: string; count?: number }>;
    pointers?: Array<{ state?: string; count?: number }>;
  };
  signalReview?: { items?: unknown[] };
  socialEvidence?: {
    available?: boolean;
    packets?: Array<{ status?: string; count?: number; last_seen_at?: string; last_processed_at?: string | null }>;
  };
  valeCollector?: {
    available?: boolean;
    latest?: {
      manifest_version?: string;
      manifest_hash?: string;
      outcome?: string;
      finished_at?: string;
      accounts_checked?: number;
      posts_seen?: number;
      accepted?: number;
      duplicates?: number;
      failures?: number;
      consecutive_failures?: number;
      paused_at?: string | null;
      platforms_json?: string;
      failure_reasons_json?: string;
      platforms?: Record<string, {
        state?: string;
        accessVerified?: boolean;
        targetsChecked?: number;
        postsSeen?: number;
        accepted?: number;
        duplicates?: number;
        failures?: number;
        reason?: string;
      }>;
      failureReasons?: string[];
    } | null;
    lastSuccessful?: { finished_at?: string; manifest_version?: string; manifest_hash?: string } | null;
  };
  modelHealth?: { available?: boolean; attempts?: Array<{ outcome?: string; count?: number; last_attempted_at?: string }> };
  alerts?: { available?: boolean; open?: Array<{
    fingerprint?: string;
    event?: string;
    severity?: string;
    state?: string;
    condition_state?: string;
    institution_id?: string | null;
    subsystem?: string;
    group_key?: string;
    occurrence_count?: number;
    next_notify_at?: string;
    recovery_count?: number;
    detail_json?: string;
  }> };
  executiveIntelligence?: {
    coverage?: Array<{ short_name?: string; official_source_status?: string; official_source_note?: string }>;
    runtimeCoverage?: Array<{
      shortName?: string;
      state?: string;
      coverageLost?: boolean;
      sourceIds?: string[];
      healthySourceIds?: string[];
      lastSuccessAt?: string | null;
      failureAgeMs?: number | null;
      nextRetryAt?: string | null;
      sourceStates?: Array<{ sourceId?: string; state?: string; reason?: string | null }>;
    }>;
  };
};

function ageLabel(milliseconds?: number | null) {
  if (milliseconds == null || !Number.isFinite(milliseconds)) return "unknown";
  const minutes = Math.max(0, Math.round(milliseconds / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function OpsPage() {
  const [payload, setPayload] = useState<OpsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const lifecycle = new AbortController();
    void registerRegionalBrowserTools(document, "ops", lifecycle.signal);
    return () => { lifecycle.abort(); };
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/ops/api/automation/status/review", { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) throw new Error(`Status request failed (${response.status})`);
        const next = await response.json() as OpsPayload;
        if (active) {
          setPayload(next);
          setError(null);
        }
      } catch (reason: unknown) {
        if (active) setError(reason instanceof Error ? reason.message : "Status request failed");
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const packetCount = (status: string) => Number(
    payload?.socialEvidence?.packets?.find((row) => row.status === status)?.count ?? 0,
  );
  const packetTotal = (payload?.socialEvidence?.packets ?? []).reduce((total, row) => total + Number(row.count ?? 0), 0);
  const latestVale = payload?.valeCollector?.latest;
  const lastSuccessfulVale = payload?.valeCollector?.lastSuccessful?.finished_at;
  const valePauseRequired = Number(latestVale?.consecutive_failures ?? 0) >= 3 || Boolean(latestVale?.paused_at);
  const runtimeCoverage = payload?.executiveIntelligence?.runtimeCoverage ?? [];

  return (
    <article aria-labelledby="ops-title" className="OpsPage">
      <p className="OpsPage-kicker">Private operations</p>
      <h1 id="ops-title">The Valley Desk operations</h1>
      <WatchEditorialReview />
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
            <div><dt>Social packets received</dt><dd>{packetTotal}</dd></div>
            <div><dt>Social packets in review</dt><dd>{packetCount("review")}</dd></div>
            <div><dt>Social packets processed</dt><dd>{packetCount("processed")}</dd></div>
            <div><dt>Vale last success</dt><dd>{lastSuccessfulVale ?? "not reported"}</dd></div>
            <div><dt>Vale collector state</dt><dd>{valePauseRequired ? "paused after repeated failures" : latestVale ? "reported" : "not reported"}</dd></div>
            <div><dt>Vale failure streak</dt><dd>{latestVale?.consecutive_failures ?? 0}</dd></div>
          </dl>
          <h2>Vale collector</h2>
          <p>
            {latestVale
              ? `${latestVale.outcome ?? "unknown"} · finished ${latestVale.finished_at ?? "unknown"} · ${latestVale.accounts_checked ?? 0} accounts · ${latestVale.posts_seen ?? 0} posts · ${latestVale.accepted ?? 0} accepted · ${latestVale.duplicates ?? 0} duplicates · ${latestVale.failures ?? 0} failures${latestVale.paused_at ? ` · paused ${latestVale.paused_at}` : ""}`
              : "No Vale collector receipt has been reported."}
          </p>
          {latestVale ? (
            <>
              <h3>Platform health</h3>
              <ul>
                {Object.entries(latestVale.platforms ?? {}).map(([platform, health]) => (
                  <li key={platform}>
                    {platform}: {health.state ?? "unknown"} · access {health.accessVerified ? "verified" : "not verified"}
                    {` · ${health.targetsChecked ?? 0} targets · ${health.postsSeen ?? 0} posts · ${health.accepted ?? 0} accepted · ${health.duplicates ?? 0} duplicates · ${health.failures ?? 0} failures`}
                    {health.reason ? ` · ${health.reason}` : ""}
                  </li>
                ))}
              </ul>
              {latestVale.failureReasons?.length ? <p>Failure reasons: {latestVale.failureReasons.join(" · ")}</p> : null}
            </>
          ) : null}
          <h2>Open alerts</h2>
          {(payload.alerts?.open ?? []).length ? (
            <ul>
              {(payload.alerts?.open ?? []).map((alert) => (
                <li key={alert.fingerprint ?? alert.event ?? "alert"}>
                  {alert.severity ?? "unknown"} · {alert.condition_state ?? alert.state ?? "unknown"} · {alert.subsystem ?? "automation"}
                  {alert.institution_id ? ` · ${alert.institution_id}` : " · pack-wide"}
                  {`: ${alert.event ?? alert.fingerprint ?? "alert"}`}
                  {alert.occurrence_count ? ` (${alert.occurrence_count} occurrences)` : ""}
                  {alert.next_notify_at ? ` · next ${alert.next_notify_at}` : ""}
                  {alert.detail_json ? ` · ${alert.detail_json}` : ""}
                </li>
              ))}
            </ul>
          ) : <p>No open durable alerts.</p>}
          <h2>Editor model health</h2>
          <ul>
            {(payload.modelHealth?.attempts ?? []).map((attempt) => (
              <li key={attempt.outcome ?? "model-attempt"}>
                {attempt.outcome ?? "unknown"}: {attempt.count ?? 0}
              </li>
            ))}
          </ul>
          <h2>Source health</h2>
          <ul>
            {(payload.sources ?? []).map((source) => (
              <li key={source.source_id ?? source.last_checked_at ?? "source"}>
                {source.source_id ?? "unknown"}: {source.state ?? "unknown"}
                {source.institution_ids?.length ? ` · ${source.institution_ids.join(", ")}` : ""}
                {source.consecutive_failures ? ` (${source.consecutive_failures} failures)` : ""}
                {source.failure_age_ms != null ? ` · failure age ${ageLabel(source.failure_age_ms)}` : ""}
                {source.next_attempt_at ? ` · next ${source.next_attempt_at}` : ""}
                {source.last_fallback_url ? ` · fallback ${source.last_fallback_url}` : ""}
                {source.last_error ? ` · ${source.last_error}` : ""}
              </li>
            ))}
          </ul>
          <h2>Executive coverage</h2>
          <ul>
            {(payload.executiveIntelligence?.coverage ?? []).map((institution) => (
              <li key={institution.short_name ?? "institution"}>
                {institution.short_name ?? "unknown"}: {institution.official_source_status ?? "unreported"}
                {institution.official_source_note ? ` · ${institution.official_source_note}` : ""}
              </li>
            ))}
          </ul>
          <h2>Leadership coverage</h2>
          <ul>
            {runtimeCoverage.map((institution) => (
              <li key={institution.shortName ?? institution.sourceIds?.join(",") ?? "institution"}>
                {institution.shortName ?? "unknown"}: {institution.state ?? "unknown"}
                {institution.coverageLost ? " · coverage lost" : ` · ${institution.healthySourceIds?.length ?? 0}/${institution.sourceIds?.length ?? 0} authoritative sources healthy`}
                {institution.lastSuccessAt ? ` · last success ${institution.lastSuccessAt}` : " · no successful check"}
                {institution.failureAgeMs != null ? ` · failure age ${ageLabel(institution.failureAgeMs)}` : ""}
                {institution.nextRetryAt ? ` · next ${institution.nextRetryAt}` : ""}
                {institution.sourceStates?.length ? ` · ${institution.sourceStates.map((source) => `${source.sourceId ?? "source"}=${source.state ?? "unknown"}`).join(", ")}` : ""}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <PolicyBaseline review />
    </article>
  );
}

export { OpsPage };
