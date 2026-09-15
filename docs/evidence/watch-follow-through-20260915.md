# Watch Follow-Through - 2026-09-15

## Candidate Scope

This is a concrete improvement release, not completed public Watch acceptance.
Voices promotion is removed from primary navigation, footer, homepage, Lab links,
and crawler discovery. Existing Voices archive and article URLs remain available.
Watch navigation follows the same fail-closed public feature as its server routes.
`WATCH_PUBLIC_ENABLED` and Watch collection remain disabled in this candidate.

The existing News RSS registry adds Delaware Government News at
https://news.delaware.gov/feed/. It is general government discovery, not a claim
that every item concerns healthcare. No fixed health-system attribution or new
publication exemption is assigned. Normal News relevance and evidence gates apply.
The September 15 bounded capture returned 417,987 bytes, 50 parsed observations,
zero rejected items, and an explicitly partial/truncated Watch inventory.
Evidence: `/mnt/d/tmp/plumbob/tvd-source-capture-20260915-1Ty1CV/`.

## Collection And Evidence

Endpoint-aware robots matching uses pinned `robots-parser@3.0.1`, the actual
crawler agent, and the exact endpoint. Applicable denials and unsupported access
remain held. Crawl delays are honored within the request budget or held.
An unrelated `/wp-admin` restriction no longer blocks a permitted `/feed/`.

The Federal Register official JSON adapter is connected to the existing leased,
bounded scheduled collector. It retains raw bytes before staging native policy
captures and unreviewed editorial proposals. It distinguishes rules/proposed
rules from notices, preserves native identity and source dates, and does not
infer legal effect. Enrolled pagination only; failed/partial captures do not
advance checkpoints. Each native write transaction checks current source
permission and the collector lease. Unchanged304 responses preserve raw identity;
changed API envelopes retain distinct representation-bound observations.

The existing CMS source candidate now names the installed parser but remains
pending, not automatically qualified or activated. The actual September 15
inventory contained five notices, not five policy proposals. No new federal
policy coverage is claimed from that capture.

Technology proposals now bind individual fields to relevant retained source
paragraphs and artifact metadata. Affiliation text no longer supports unrelated
usage/setup/license claims. See `technology-field-evidence-20260915.md`.

## Explicit Remaining Work

- Complete source qualification/activation and genuine public-record acceptance.
- Decide whether Watch should retain per-dossier human approval or gain a tested
  deterministic official-fact publication path. No fabricated human decisions.
- Connect current PA/NJ/DE native discovery, representative refresh, sponsors,
  local bodies and all eleven county coverage obligations.
- Implement the accepted policy interpretation resolver; current runtime still
  deliberately provides no interpretation authority.
- Verify artifact-specific regional eligibility for technology records.
- Complete real model evaluation, D1 capacity, accessibility and the prospective
  observation window. Local tests do not establish these production outcomes.

The latest access recheck permits NJ downloads and the Federal Register API.
PA robots406 and Delaware legislative robots transport failure remain held.
Supported alternate official feeds/downloads are the next path, not evasion.
Cloudflare Builds inspection now succeeds and returned no configured triggers
for the production Worker. The earlier403 blocker must not be repeated.
