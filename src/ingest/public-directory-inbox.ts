/**
 * Reader suggestions and page feedback. Submissions go to the private `reader_inbox` table
 * (migration 0049); nothing here is ever shown publicly. Agents review the table with
 * `wrangler d1 execute` as described in ops/reader-inbox.md.
 */
import { directoryCatalog } from "./public-directory-data";
import { renderDirectoryPage } from "./public-directory-page";
import { icon } from "./public-directory-icons";

export const suggestPath = "/discover/suggest";
export const feedbackPath = "/discover/feedback";

type Statement = { bind(...values: unknown[]): { run(): Promise<unknown>; first<T>(): Promise<T | null> } };
type InboxDb = { prepare(sql: string): Statement };
type Limiter = { limit(options: { key: string }): Promise<{ success: boolean }> };
export type InboxEnv = { VALLEY_DESK_DB?: InboxDb; READER_RATE_LIMITER?: Limiter };

const itemTypes = {
  publication: "A publication",
  software: "Software or code",
  dataset: "A dataset",
  tool: "An open tool or resource",
  other: "Something else",
} as const;
type ItemType = keyof typeof itemTypes;

/** A ceiling on stored rows per UTC day, so a flood cannot exhaust database writes. */
const dailyCap = 2000;
const limits = { url: 500, connection: 600, message: 2000, email: 200, page: 300 };
const noStore = { "cache-control": "no-store", "cdn-cache-control": "no-store" };

export const isInboxPath = (path: string) => [suggestPath, feedbackPath].includes(path.replace(/\/$/, ""));

const clean = (value: FormDataEntryValue | null, max: number) =>
  typeof value === "string" ? value.replace(/\u0000/g, "").trim().slice(0, max) : "";

function httpsLink(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : "";
  } catch {
    return "";
  }
}

/** A same-site path for the page a reader was on, never an absolute or protocol-relative URL. */
const localPath = (value: string) => (/^\/(?!\/)[^\s]*$/.test(value) ? value : "");
const emailLike = (value: string) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : "");

/** A short, salted-by-day hash of the client address: enough to spot repeats, not to identify anyone. */
async function clientKey(request: Request, day: string) {
  const address = request.headers.get("cf-connecting-ip") ?? "";
  if (!address) return "";
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${day}:${address}`)));
  return [...bytes.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sameOrigin(request: Request, origin: string) {
  const from = request.headers.get("origin");
  if (!from) return true;
  return from === origin || from === new URL(request.url).origin;
}

const wantsJson = (request: Request) => (request.headers.get("accept") ?? "").includes("application/json");

function reply(request: Request, ok: boolean, back: string, status = ok ? 200 : 400) {
  if (wantsJson(request)) {
    return new Response(JSON.stringify({ ok }), { status, headers: { ...noStore, "content-type": "application/json" } });
  }
  return new Response(null, { status: 303, headers: { ...noStore, location: ok ? back : `${suggestPath}?sent=error#suggest` } });
}

function suggestPage(origin: string, nonce: string | undefined, state: string) {
  const sent = state === "suggestion" || state === "feedback";
  const options = (Object.entries(itemTypes) as [ItemType, string][])
    .map(([value, label], i) => `<label class="choice"><input type="radio" name="item_type" value="${value}"${i === 0 ? " checked" : ""}> ${label}</label>`)
    .join("");
  const honeypot = `<div class="inbox-trap" aria-hidden="true"><label>Leave this empty<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>`;
  const content = `<div class="frame page inbox-page">
    <nav class="breadcrumb" aria-label="Breadcrumb"><a href="/discover/works">Directory</a></nav>
    <h1>Suggest research</h1>
    <p class="lede">Know of a paper, codebase, dataset or open tool from the Delaware Valley that belongs here? Send a link and we will take a look.</p>
    ${sent ? `<p class="inbox-sent" role="status">${icon("verified")}Thank you. ${state === "suggestion" ? "We will review your suggestion." : "Your note reached us."}</p>` : ""}
    ${state === "error" ? `<p class="inbox-sent inbox-error" role="alert">That did not go through. Please check the link and try again, or email <a href="mailto:leads@thevalleydesk.org">leads@thevalleydesk.org</a>.</p>` : ""}
    <form class="inbox-form" method="post" action="${suggestPath}" id="suggest">
      <fieldset><legend>What is it?</legend><div class="choices">${options}</div></fieldset>
      <label><span>Link <span class="muted">(DOI, GitHub, dataset page or website)</span></span>
        <input type="url" name="url" required maxlength="${limits.url}" placeholder="https://" inputmode="url"></label>
      <label><span>Connection to the region <span class="muted">(optional)</span></span>
        <input type="text" name="connection" maxlength="${limits.connection}" placeholder="Institution, lab or place"></label>
      <label><span>Anything else <span class="muted">(optional)</span></span>
        <textarea name="message" rows="3" maxlength="${limits.message}"></textarea></label>
      <label><span>Your email <span class="muted">(optional, only if you would like a reply)</span></span>
        <input type="email" name="email" maxlength="${limits.email}" autocomplete="email"></label>
      ${honeypot}
      <button class="button primary" type="submit">Send suggestion</button>
    </form>
    <section class="inbox-feedback" aria-labelledby="feedback-title" id="feedback">
      <h2 id="feedback-title">Feedback on the site</h2>
      <form class="inbox-form" method="post" action="${feedbackPath}">
        <input type="hidden" name="page" value="${suggestPath}">
        <label><span>What should we improve?</span><textarea name="message" rows="3" required maxlength="${limits.message}"></textarea></label>
        <label><span>Your email <span class="muted">(optional)</span></span>
          <input type="email" name="email" maxlength="${limits.email}" autocomplete="email"></label>
        ${honeypot}
        <button class="button secondary" type="submit">Send feedback</button>
      </form>
    </section>
    <p class="inbox-privacy muted">We keep what you send privately and use it only to improve the directory. Removal requests can also go to <a href="mailto:leads@thevalleydesk.org">leads@thevalleydesk.org</a>.</p>
  </div>`;
  return renderDirectoryPage(
    {
      kind: "research",
      title: "Suggest research",
      summary: "Suggest a paper, codebase, dataset or open tool connected to the Delaware Valley, or send feedback on the directory.",
      path: suggestPath,
      content,
      robots: "noindex, follow",
    },
    directoryCatalog,
    origin,
    nonce,
  );
}

async function store(env: InboxEnv, row: Record<string, string | null>) {
  const db = env.VALLEY_DESK_DB;
  if (!db) return false;
  const day = (row.received_at ?? "").slice(0, 10);
  const today = await db
    .prepare("SELECT count(*) AS n FROM reader_inbox WHERE received_at >= ?")
    .bind(day)
    .first<{ n: number }>();
  if ((today?.n ?? 0) >= dailyCap) return false;
  await db
    .prepare(
      "INSERT INTO reader_inbox (kind, received_at, page, rating, item_type, url, connection, message, email, client) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(row.kind, row.received_at, row.page, row.rating, row.item_type, row.url, row.connection, row.message, row.email, row.client)
    .run();
  return true;
}

export async function handleReaderInbox(request: Request, env: InboxEnv, origin: string, nonce?: string) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "");
  const method = request.method.toUpperCase();

  if (method === "GET" || method === "HEAD") {
    if (path === feedbackPath) return new Response(null, { status: 308, headers: { ...noStore, location: `${suggestPath}#feedback` } });
    const body = suggestPage(origin, nonce, url.searchParams.get("sent") ?? "");
    return new Response(method === "HEAD" ? null : body, {
      headers: { ...noStore, "content-type": "text/html; charset=utf-8", "x-robots-tag": "noindex" },
    });
  }
  if (method !== "POST") return new Response(null, { status: 405, headers: { ...noStore, allow: "GET, HEAD, POST" } });

  const form = await request.formData().catch(() => null);
  const page = localPath(clean(form?.get("page") ?? null, limits.page));
  const back = `${suggestPath}?sent=${path === suggestPath ? "suggestion#suggest" : "feedback#feedback"}`;
  if (!form || !sameOrigin(request, origin)) return reply(request, false, back, 403);
  // A filled trap field is a bot. Answer as if it worked so it learns nothing.
  if (clean(form.get("website"), 200)) return reply(request, true, back);

  const address = request.headers.get("cf-connecting-ip") ?? "unknown";
  if (env.READER_RATE_LIMITER && !(await env.READER_RATE_LIMITER.limit({ key: address })).success) {
    return reply(request, false, back, 429);
  }

  const now = new Date().toISOString();
  const rating = clean(form.get("rating"), 20);
  const message = clean(form.get("message"), limits.message);
  const email = emailLike(clean(form.get("email"), limits.email));
  const row: Record<string, string | null> = {
    received_at: now,
    page: page || null,
    email: email || null,
    message: message || null,
    client: (await clientKey(request, now.slice(0, 10))) || null,
    rating: null,
    item_type: null,
    url: null,
    connection: null,
  };

  if (path === suggestPath) {
    const link = httpsLink(clean(form.get("url"), limits.url));
    const type = clean(form.get("item_type"), 20);
    if (!link) return reply(request, false, back);
    Object.assign(row, {
      kind: "suggestion",
      url: link,
      item_type: type in itemTypes ? type : "other",
      connection: clean(form.get("connection"), limits.connection) || null,
    });
  } else {
    if (rating !== "useful" && rating !== "not-useful" && !message) return reply(request, false, back);
    Object.assign(row, { kind: "feedback", rating: rating === "useful" || rating === "not-useful" ? rating : null });
  }

  const saved = await store(env, row).catch(() => false);
  return reply(request, saved, back, saved ? 200 : 503);
}
