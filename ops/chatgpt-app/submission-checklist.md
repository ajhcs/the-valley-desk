# Submission checklist

For the owner. Steps 1 to 4 can be done now. Steps 5 onward need the MCP server deployed to production.

## Decide first

- [ ] **Developer name.** The listing shows a verified individual or business name. Choose which.
- [ ] **Terms of service.** Verify that `https://thevalleydesk.org/discover/terms` is public and enter it in the form.
- [ ] **Support contact.** The listing draft points to the methodology page, which carries the directory team's email address. Change it if a different contact is wanted.
- [ ] **Logo.** Export `public/mark-a-fold.svg` as a square PNG if the portal does not take SVG.
- [ ] **Countries and languages.** The draft assumes English and no country restriction.

## Before deploying

1. [ ] Review and merge the pull request that adds `/mcp`.
2. [ ] Rate limiting is on at 60 tool calls a minute per IP address. Confirm `namespace_id` `"1001"` in `wrangler.jsonc` is not used by another Worker on the account.
3. [ ] Deploy through the normal release process.
4. [ ] Check production:
   - `https://thevalleydesk.org/discover/connect` loads.
   - `https://thevalleydesk.org/mcp/server-card` returns JSON.
   - `npx @modelcontextprotocol/inspector@latest` connects to `https://thevalleydesk.org/mcp` over Streamable HTTP and lists five tools.

## Confirm the privacy statement

5. [ ] In the Cloudflare dashboard, open the Worker's logs and confirm what an invocation entry records and how long entries are kept. Correct the Privacy section of `/discover/connect` and `privacy.md` if either differs from "a few days".

## Test in ChatGPT

6. [ ] On chatgpt.com open Plugins, choose **Add custom MCP server**, enter the name, the connection URL `https://thevalleydesk.org/mcp` and no authentication, then **Create as a plugin**. This needs a plan that allows custom servers (Business, Enterprise, Edu, or Pro with read-only tools, per the help article).
7. [ ] Run every case in `test-prompts.md` in a new chat and fill in the "Seen in production" lines.
8. [ ] Record a short screen capture of two or three cases. The form requires a demo recording URL.

## Submit

9. [ ] Sign in at `https://platform.openai.com/plugins` as an organization owner (or with Apps Management Write). Complete individual or business verification under organization settings if not already done. **This is the step that creates or uses an OpenAI platform account and accepts its terms.**
10. [ ] Build the ZIP with `plugin.json` and `mcp.json` at its root: `cd ops/chatgpt-app && zip valley-desk-plugin.zip plugin.json mcp.json`. Fix anything the portal's validator reports. The two files are drafts written from the documentation, not from the validator.
11. [ ] Upload the ZIP, choose **no authentication**, and let the portal connect to and scan the MCP server.
12. [ ] **Verify the domain.** The portal issues a challenge token. Add it to `wrangler.jsonc` under `vars` as `"OPENAI_APPS_CHALLENGE": "<token>"`, deploy, and confirm `https://thevalleydesk.org/.well-known/openai-apps-challenge` returns exactly the token. The token is not a secret. It can be removed after verification unless the portal re-checks it.
13. [ ] Enter the listing fields from `listing.md`, the privacy policy URL, and the eight review cases from `test-prompts.md`.
14. [ ] Read the policy attestations. The points that apply here: tools are read-only and annotated as such; inputs are the minimum needed; responses carry no identifiers or tracking; no advertising; suitable for ages 13 and over; no medical advice; no implied OpenAI endorsement.
15. [ ] **Submit for review.** Feedback arrives by email. One review can be open at a time.

## After approval

16. [ ] Open the approved version and select **Publish plugin**. Approval does not publish it.
17. [ ] OpenAI rescans the server daily. Tool changes go live after its automated checks. Listing changes need a new ZIP version. A change of server URL needs OpenAI support.
