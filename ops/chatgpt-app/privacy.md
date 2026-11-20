# Privacy statement for the ChatGPT listing

The published policy is the Privacy section of `https://thevalleydesk.org/discover/connect#privacy`. This file records the same statement and the facts behind it, so the two can be kept in step.

## Statement

The Valley Desk app searches a public directory of healthcare research. It asks for a search and nothing about you.

**What the app receives.** Only the tool inputs ChatGPT chooses to send: search words, filters (kind, institution, topic, county, label, dates, sort, page) and record ids. It does not receive your conversation, your name, your account or your location. It has no accounts, cookies or sign-in.

**What we keep.** The Valley Desk does not write tool inputs or results to its logs or its database. Search words travel in the request body, which our request logs do not record.

**Our host.** Cloudflare delivers each request and, to do so, processes the IP address it came from. Requests from ChatGPT arrive from OpenAI's servers. Cloudflare keeps standard request logs for the site (time, address requested, response status, country and client software) for a few days, for reliability and abuse prevention.

**What we share.** Nothing is sold or shared. Results are public directory records.

**Retention.** Tool inputs and results: not retained. Host request logs: a few days, under the Cloudflare account's log retention setting.

**Your choices.** Disconnect the app in ChatGPT at any time. For a correction or the removal of a listing, email the directory team at the address on `https://thevalleydesk.org/discover/methodology`.

**Audience.** The app is suitable for general audiences and is not directed at children under 13. It gives no medical advice.

## Facts behind the statement

| Claim | Basis | Status |
| --- | --- | --- |
| The server writes no tool inputs or results | `src/assistant/` contains no logging call and no database write. The only database access is `SELECT` through the directory's existing read functions. | Verified by reading the code |
| Search words are not in request logs | Tool arguments are sent in the POST body to `/mcp`. The URL is always `/mcp` with no query string. | Verified by reading the code |
| Cloudflare request logs exist | `wrangler.jsonc` sets `observability.enabled: true` with `head_sampling_rate: 1`, so Workers Logs records an invocation entry per request. | Verified in configuration |
| What an invocation entry holds, and for how long | Inferred from Cloudflare's Workers Logs documentation: request URL, method, status, selected headers and location fields. Retention depends on the plan. | **Owner to confirm** in the Cloudflare dashboard (Workers, the-valley-desk, Logs) and correct "a few days" on the connect page if it differs |
| Optional rate limiting | If the `MCP_RATE_LIMITER` binding is added, the caller's IP address is used as the counting key inside Cloudflare. It is not logged by the Worker. | Add a sentence to the statement if the binding is enabled |

If logging changes (for example, adding `logOps` calls to the MCP route, or enabling Logpush), update the connect page and this file in the same change.
