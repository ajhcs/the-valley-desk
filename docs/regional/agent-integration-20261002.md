# Regional discovery and agent integration — bounded local candidate

This candidate integrates the independently accepted evidence core (tree d7ace075a05d89c5b0a3fd16b57b1d887d5916be) with a temporary read-only local browser/MCP preview. It preserves the existing frontend, production Worker, schedules, PA components and all source activations. No commit, deployment, production collector or public marketplace submission is performed.

## Concrete behavior and limits

The source inventory tool returns 33 institutions and 49 registered/proposed sources when unfiltered, including 39 configured sources without supplied health observations. Its 127 missing institution/channel registrations are unreviewed applicability gaps, not proof every institution needs every channel. Current-affiliation and accepted-publication counts are unknown. Its citations are declaration metadata; the inventory adapter does not verify their retained spans.

A separate discovery tool replays three retained snapshots against the six-institution regional proposal inventory: 22 Jefferson university RSS listings, five Wistar PubMed metadata records and one Penn-linked public GitHub repository (CBICA/CaPTk, numeric ID 128938343). Three of those six institutions have no discovery snapshot in this replay. This subset is neither a comprehensive regional census nor complete institution output coverage. Jefferson's geographical scope remains unverified; university evidence is not health-system evidence. Four of the five Wistar records contain explicit same-author-affiliation Wistar and Philadelphia, PA literals. The remaining record is held. Publication-time affiliation does not identify a unique current employee.

Discovery responses retain attribution, observation dates, reported source publication dates, evidence hashes, review holds and explicit provenance limitations. RSS listing dates do not establish original research-work dates. PubMed electronic/journal calendar dates are separately reported; partial dates remain unknown. Names never become person IDs. GitHub ownership, clinical eligibility and artifact licensing remain unverified. The repository detail carries the retained first-party research-use disclaimer as a cited source fact, with no new editorial inference.

RSS/institutional/GitHub captures are locally verified against retained bytes. The PubMed qualification was manually observed at 2026-10-02T04:54:59.456Z; only its redacted metadata projection was retained. This adapter recomputes that projection hash and record binding, but cannot verify the original XML wire hash. Its `upstreamWireBytesVerifiedByThisAdapter` is false. A copied projection and hash alone do not establish upstream authenticity. Author names/affiliations remain reported metadata, bounded, contact-email-redacted and untrusted. No abstracts or full text are exposed.

## Tools and local routes

- `regional_source_inventory`: strict institution/channel/configuration filters, limit 1–50, snapshot-bound pagination; registration gaps and supplied-receipt freshness.
- `regional_discovery_candidates`: strict institution/provider filters, limit 1–10, snapshot-bound pagination; partial cached candidates, qualified dates and citations.
- `regional_discovery_record`: exact snapshot/record binding, authorLimit 0–20 (default 8), bounded reported affiliations and literal repository context.

The official @modelcontextprotocol/sdk 1.30.0 implements stateless Streamable HTTP with SDK-negotiated MCP 2025-11-25 compatibility; no MCP 2026-07-28 support is claimed. Native browser tools use `document.modelContext` in supporting secure contexts. Unsupported browsers render the current frontend. Registration adds no visible UI.

The temporary preview binds only 127.0.0.1, checks exact Host/Origin and fixed endpoint paths, rejects query-string endpoint overrides, requires JSON POST reads, bounds request bytes at 16 KiB and tool output at 128 KiB, and applies 10-second read/fetch deadlines. Browser requests omit credentials and reject redirects. Returned strings are untrusted data and cannot authorize actions. Error responses omit backend/source text. MCP error results omit structuredContent so they do not masquerade as successful output-schema records. Server-held prepared views are private tokens with 15-minute expiry; copied tokens, cross-filter cursors and client-controlled time are rejected.

The bootstrap is injected only by the explicit local-preview harness. Neither production browser entry nor Cloudflare Worker routes are changed. The MCP package has an independent lockfile (94 dependencies installed offline with scripts disabled); the accepted root dependency manifests remain byte-identical. No separate permanent service, authentication mechanism or credential is introduced.

Run on BuilderBob with existing root dependencies and the preview subpackage installed:

```
node --import tsx/esm scripts/agents/regional-agent-journey.mjs /absolute/evidence-directory /absolute/retained-captures.json /absolute/retained-pubmed-projection.json
```

Retained capture paths are operator inputs, never browser/tool arguments. The journey uses only loopback and blocks external browser requests. The manual publication discovery CLI is an explicit separate operator tool, not called by these reads, schedules or the journey. This candidate makes no new source/model calls.

## Validation and release decisions

Author-run evidence: 204 regional tests pass, including 21 new metadata/view/transport checks; application and tooling typechecks pass; deterministic retained-source replay verifies 12/12 inventory spans; production frontend build passes (existing >500 kB chunk advisory). Official SDK initialize/list/call and real native browser discovery/execution pass for all three tools. Eight screenshots cover baseline/native, desktop/mobile, light/dark; decoded RGBA hashes match in all four comparisons. The unsupported-browser fallback renders the current homepage. Actual JSON response examples and execution logs accompany the frozen candidate. A live ChatGPT account/marketplace journey has not been performed.

The newly integrated transport boundaries require a separate focused review of the exact frozen candidate. Core acceptance does not confer transport acceptance. Local validation authorizes no production activation.

Release decisions before any deployment: accept the focused transport review; decide whether to wire these public read routes into the existing Worker and browser entry; define public read rate/abuse controls and deployment-specific origin handling; decide storage/provenance for retained snapshots and future source-health receipts; review permitted source activation individually; verify protocol/client compatibility in the intended deployed client. Existing OpenRouter preference is unaffected; no model request or paid API is added.

The model-verifier recurrence and queue-impact check remains unverified. Read-only production SSH works; the September production note points to a checkout that is currently absent. No suitable existing authorized D1 diagnostic path was established. That does not establish an application outage. No verifier/model execution, token reuse or queue mutation was attempted.

## Remaining backlog and owners

| Work | Implemented locally | Remaining gap / acceptance | Owner |
|---|---|---|---|
| Institutional breadth, including community institutions | Six inactive regional proposals include Esperanza and Mazzoni; explicit temporal citations and scope uncertainty | Qualify additional permitted first-party sources individually; do not infer health-system identity from universities | Regional source workstream |
| RSS/publication discovery | Retained RSS replay and Wistar-only metadata projection; strict namespaces, dates, caps and no retries | Feed health receipts, source-specific permitted activation, broader publication providers with retained provenance | Regional source workstream; parent approves activation |
| People/affiliations | Reported publication affiliations and accepted temporal core contracts | Authoritative first-party identity evidence and temporal disambiguation before person enrollment/current-employment claims | Regional source workstream |
| GitHub output | First-party institution link plus numeric repository API identity | Verify each org/repo against institutional evidence; license/current-maintainer review separate | Regional source workstream |
| Freshness/missing-source visibility | Partial inventory, unobserved-health states, channel gaps and missing snapshot counts | Authorized operational receipts; applicability review; verifier recurrence/queue-impact read | Regional source workstream; ops owner |
| Editorial enrichment | Cited literal source context, review holds and explicit inference boundaries | Product/editorial review for any visible article-context presentation or publication | Parent/editorial owner |
| Regional conferences | No new comprehensive conference coverage claimed | Qualify first-party event/conference sources, dates and affiliation evidence individually | Regional source workstream |
| PA legislation / PA403 | Separate existing owner's work, untouched | PA403 remains held; no publisher contact | PA owner thread01a0f326-a0ab-73b9-b7fb-1c2da8e7a0e3 |
