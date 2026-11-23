import { OPS_ALERT_RECIPIENT, OPS_ALERT_SENDER, type SendEmailBindingLike } from "../lib/alerts";
import { readRequestTextBounded, tokenMatches } from "./review-api";

export const directoryNotificationPath = "/api/directory/ops-notification";
const headers = { "cache-control": "no-store", "cdn-cache-control": "no-store", "x-robots-tag": "noindex" };
const subjects = {
  failed: "directory run failed",
  stopped: "directory run stopped",
  "three-nights": "three consecutive directory updates",
  test: "directory notification test",
} as const;

type NotificationEnv = {
  DIRECTORY_NOTIFICATION_TOKEN?: string;
  NOTIFY_OPS?: SendEmailBindingLike;
};

export async function handleDirectoryNotification(request: Request, env: NotificationEnv) {
  const expected = env.DIRECTORY_NOTIFICATION_TOKEN;
  const supplied = /^Bearer ([a-f0-9]{64})$/.exec(request.headers.get("authorization") ?? "")?.[1];
  if (new URL(request.url).hostname !== "thevalleydesk.org" || request.method !== "POST" ||
      !expected || !supplied || !await tokenMatches(expected, supplied)) {
    return new Response(null, { status: 404, headers });
  }
  if (!/^application\/json\s*(?:;|$)/i.test(request.headers.get("content-type") ?? "")) {
    return new Response(null, { status: 415, headers });
  }

  let note: { kind?: unknown; text?: unknown } | null;
  try {
    const raw = await readRequestTextBounded(request, 4096);
    if (raw === null) return new Response(null, { status: 413, headers });
    note = JSON.parse(raw);
  } catch {
    return new Response(null, { status: 400, headers });
  }
  const kind = note?.kind;
  if (!note || typeof kind !== "string" || !Object.hasOwn(subjects, kind) ||
      Object.keys(note).some(key => key !== "kind" && key !== "text")) {
    return new Response(null, { status: 400, headers });
  }
  const text = kind === "test" ? "BuilderBob successfully reached the Valley Desk directory email route." : note.text;
  if (typeof text !== "string" || !text.trim() || /[\x00-\x08\x0b-\x1f\x7f]/.test(text)) {
    return new Response(null, { status: 400, headers });
  }
  if (!env.NOTIFY_OPS) return new Response(null, { status: 503, headers });
  try {
    await env.NOTIFY_OPS.send({
      to: OPS_ALERT_RECIPIENT, from: OPS_ALERT_SENDER,
      subject: "[The Valley Desk] " + subjects[kind as keyof typeof subjects], text,
    });
    return new Response(null, { status: 204, headers });
  } catch {
    return new Response(null, { status: 502, headers });
  }
}
