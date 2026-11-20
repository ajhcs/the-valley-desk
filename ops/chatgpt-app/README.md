# ChatGPT app package

Draft submission material for listing The Valley Desk in ChatGPT. Nothing here has been submitted, and no account was created or terms accepted in preparing it.

The app is the public MCP server at `https://thevalleydesk.org/mcp`. It is tools-only: five read-only tools, no sign-in and no custom UI component. ChatGPT renders the answer and cites each record's Valley Desk URL.

| File | Purpose |
| --- | --- |
| `submission-checklist.md` | Ordered steps for the owner, including what must be decided or created first |
| `listing.md` | Listing text with character counts |
| `test-prompts.md` | Five positive and three negative review cases with expected results |
| `privacy.md` | Privacy statement, matched to what the server logs |
| `plugin.json`, `mcp.json` | Draft package files for the upload ZIP |

## Documents this was built against

Read on 20 November 2026.

- OpenAI Apps SDK documentation at `developers.openai.com/apps-sdk` (build/mcp-server, reference, plan/tools, deploy/submission, deploy/connect-chatgpt, app-submission-guidelines, guides/security-privacy, mcp-apps-in-chatgpt). The pages carry no revision date. Submission screenshots are stamped 27 September 2026. The documentation now calls an app a plugin and takes submissions at `platform.openai.com/plugins`.
- OpenAI help article 12584461 on connecting a custom MCP server.
- Model Context Protocol specification revision 2026-07-28, with the 2025-11-25, 2025-06-18 and 2025-03-26 handshake kept for older clients.

These pages were read through a summarising fetch tool. Exact field names and limits in `plugin.json`, `mcp.json` and `listing.md` should be checked against the portal's own validator at upload. The checklist marks each such point.

## What the server already provides for ChatGPT

- Streamable HTTP at a stable `/mcp` URL, no authentication.
- Every tool sets `readOnlyHint: true`, `destructiveHint: false`, `openWorldHint: false` and `idempotentHint: true`, declares an `outputSchema`, and carries `_meta.securitySchemes: [{ "type": "noauth" }]` and the `openai/toolInvocation/invoking` and `invoked` status strings.
- `search` and `fetch` follow the shapes ChatGPT expects for deep research and citations: `search` returns `results[]` with `id`, `title` and `url`; `fetch` returns `id`, `title`, `text`, `url` and `metadata`.
- Domain verification: `GET /.well-known/openai-apps-challenge` returns the Worker variable `OPENAI_APPS_CHALLENGE` as plain text, and 404 until it is set.
- Responses carry no session, trace or user identifiers.
