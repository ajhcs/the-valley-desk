import { useEffect, useState } from "react";
import { calendarSubscriptionUrls } from "../lib/calendarSubscription";

export function CalendarSubscription() {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    void fetch("/events.ics", { method: "HEAD", credentials: "omit", redirect: "error", signal: controller.signal })
      .then(response => {
        if (!controller.signal.aborted) setAvailable(response.ok && /^text\/calendar(?:;|$)/i.test(response.headers.get("content-type") ?? ""));
      }).catch(() => {}).finally(() => clearTimeout(timeout));
    return () => { controller.abort(); clearTimeout(timeout); };
  }, []);
  const links = calendarSubscriptionUrls();
  return <div className="CalendarSubscription">
    {available ? <><a href={links.subscribe}>Subscribe to events</a><a href={links.download} download="the-valley-desk-events.ics">Download calendar</a></> : null}
  </div>;
}
