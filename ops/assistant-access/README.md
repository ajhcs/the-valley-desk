# AI-assistant access: operating notes

The Worker serves a read-only MCP server at `/mcp`, a setup page at `/discover/connect`, a server card at `/mcp/server-card` and WebMCP page tools through `public/webmcp.js`. Code is in `src/assistant/`. Tests are in `test/assistant-access.test.ts` (`npm run test:assistant`). `local-transcript.txt` is a local run against a loaded database.

## How it reads data

Record reads call `servePublicDirectory`, the handler behind `/api/directory/*`, with an internal request. Removals, the 503 fail-closed check, version filtering and the public field list are therefore the site's own. The two list tools call the exported `removalIds` and `institutionRefs` and run one new aggregate query over `research_facets` joined to `research_visible`.

The server adds no logging and no database writes.

## Limits

| Limit | Value | Where |
| --- | --- | --- |
| Page size | 24 records, fixed by the directory API | `limits.pageSize` |
| Deepest page | 1,000 | `limits.maxPage` |
| Tool result | about 60 kB of JSON, records dropped from the end and `truncated: true` set | `limits.resultBytes` |
| Request body | 16 kB, HTTP 413 beyond | `maxRequestBytes` |
| Search words, other text filters | 200 and 180 characters | `limits` |
| Byline in `fetch` | first 25 names, with `author_count` | `limits.bylineNames` |
| Institution and topic lists | 300 entries | `limits.listEntries` |
| Listing counts | memoized per isolate for 5 minutes | `limits.facetMemoMs` |

Responses are `Cache-Control: no-store`, like the pages, so a removal applies on the next call. The one exception is the listing counts in `list_institutions` and `list_topics_and_counties`, which can lag a removal by up to five minutes. They are numbers only. Each call still reads the removal table and the visibility view first, so unreadable removal state fails closed even on a memo hit.

The server card is `Cache-Control: public, max-age=3600`. `tools/list` and `server/discover` tell 2026-07-28 clients they may cache for one hour.

## Protocol

- Revision 2026-07-28: no handshake or session. Each request carries its version in `_meta` and in the `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` headers, which are checked against the body.
- Revisions 2025-11-25, 2025-06-18 and 2025-03-26: `initialize`, `notifications/initialized` and `ping` are answered without minting a session id. The published TypeScript SDKs (`@modelcontextprotocol/sdk` 1.32.2 and `@modelcontextprotocol/client` 2.4.0) and Inspector 2.16.0 still negotiate 2025-11-25, so this path is the one real clients use today.
- `GET` and `DELETE` return 405. A malformed `Origin` returns 403. Any well-formed web origin is accepted, because the server holds no cookies or credentials for a cross-site request to abuse.
- No authorization. The specification makes it optional, and there is nothing private to protect.

## Rate limiting

`tools/call` is limited to 60 calls a minute per caller IP address through the Workers Rate Limiting binding `MCP_RATE_LIMITER` in `wrangler.jsonc`. Beyond that the server returns HTTP 429. `tools/list` and `server/discover` are not counted. Without the binding the code skips the check.

- `period` must be 10 or 60 seconds. Counting is per Cloudflare location and approximate.
- `namespace_id` `"1001"` only has to be unique within the Cloudflare account. Change it if another Worker on the account already uses that number.
- Cloudflare advises against IP keys because many users can share one address. Requests from ChatGPT or Claude arrive from the provider's servers, so many people can share one counter. Raise `limit` if legitimate callers see 429.
- Cloudflare's Workers pricing page lists no charge for the binding. That it is free was not confirmed.
- The IP address is used as a counting key inside Cloudflare. The Worker does not log or store it.

A WAF rate limiting rule on `/mcp` is a second layer if needed. The Free plan allows one rule, counted by IP over 10 seconds.

Each tool call is one Worker request and about five to seven D1 queries. Workers Free allows 100,000 requests a day across the whole site. Workers Paid is $5 a month. An unfiltered search counts every visible listing, as the site's own browse page does, so D1 rows read grow with the directory.

## Open items

- Confirm what Workers Logs records per request and for how long, then correct the Privacy section of `/discover/connect` if needed (see `ops/chatgpt-app/privacy.md`).
- `/.well-known/ai-catalog.json`, the domain-level index that the server card proposal points to, is not served. Its entry format could not be confirmed from a primary source.
- The ChatGPT app is tools-only. A result component (MCP Apps `ui://` resource) is optional and was left out because it cannot be tested without a ChatGPT workspace.
