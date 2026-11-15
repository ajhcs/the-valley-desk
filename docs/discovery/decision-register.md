# Discovery implementation decisions

This register records execution decisions and open discrepancies. It does not amend the frozen TVD-CONCEPT-0.4 model or historical proof receipts. WP00 decisions are proposed for independent Sol review and orchestrator acceptance; user authorization is already established.

| ID | Question and selected disposition | Basis and affected records | Reconsideration trigger |
| --- | --- | --- | --- |
| EX00 | Execute the user's local implementation request. Preserve the planning handoff unchanged; use `docs/discovery/execution.json` for active package states. | Current task authorization; WP00–WP30. The handoff's `planning_only` and `not_started` fields describe its historical delivery. | User changes scope, or active execution metadata disagrees with accepted dependencies. |
| EX01 | Work in the selected isolated checkout at `c8b36d7e9b27376bf121d9d6670c500a25c62423`. Preserve local-origin divergence and original worktrees. | `baseline-receipt.json` source/commands. GitHub HEAD/main match selected source; local `origin` is a separate canonical repository with different references. | Any source/upstream change requires a new receipt and impact review; no automatic reset or merge. |
| EX02 | Use repository `docs/OPERATIONS.md`, README's local verification section, and inspected scripts as the maintained replacement for isolated local synthetic validation only. | Current assignment permits this bounded replacement. The exact missing note is `/home/plumbob/.codex/memories/plumbob-server/the-valley-desk-prod.md`; U01 remains partly unresolved. | Production/provider-connected runtime requires current operating documentation, reconciled bindings and explicit operating scope. |
| EX03 | Use verified Samsung `/workspace`; select installed Node 22.23.2 for local CI parity, with workspace caches/temp/state. | `bob-admin workspace-status`; CI requests Node 22. Shell-default Node 18 cannot satisfy the smoke's `node:sqlite` import. | Runtime, engine, storage or lockfile changes require fresh qualification. No host package installation or root-disk fallback. |
| EX04 | Keep engineering integration, editorial decisions, provider access, pilot participation/spending and operations as distinct authorities. | Architecture D07; inputs U02–U09; ownership register. | A concrete authorized input resolves only its own boundary. No model or engineering signoff publishes a real claim. |
| EX05 | Preserve historical formal evidence and its assumptions; hash comparison proves byte preservation only. E01–E06 remain `not_run` in this baseline. | Frozen manifest checks and historical claim ledger; WP02/WP23/WP24. | Fresh scratch reproduction or implementation/empirical evidence supplies a new revision-specific result. |

## Recorded discrepancies

- `origin` points to `/workspace/repos/builderbob/thevalleydesk`, whose HEAD and main differ from the selected source. The GitHub URL was queried directly, without fetching or changing local references. Both observations are retained.
- No deployed revision or health was observed. Runtime identity, configuration, migrations, source health, and live editorial behavior remain unverified. A source match cannot establish runtime equivalence.
- README's Cloudflare provisioning step mentions Muse 1.2 while its automation text and repository configuration use Muse 1.3. `docs/OPERATIONS.md` describes health schema `0037`, while current source includes later migrations and expected schema `0040`. These are inherited documentation discrepancies; WP00 does not modify configuration or infer live values. The orchestrator/operating owner must reconcile them before dependent operations.
- The default Node is 18.19.1. The installed Node 22.23.2 is selected explicitly. A newer installed runtime would be a separate compatibility observation, not CI parity.

## Substantive policy and interface amendments

None are accepted by WP00. Architecture decisions D01–D16 and proposed IF01–IF10 remain inputs to WP01/WP02 reconciliation. Keep the frozen native model and its independent obligations intact; create a new target revision for refinements.

For each proposed amendment, record a stable ID, question, existing rule, evidence, proposed choice, alternatives and reason, affected model/requirement/interface/package IDs, reviewer, acceptance authority, and reconsideration trigger. Policy, identity, rights, query, authority, visibility or temporal changes reopen dependent contracts and tests. Mark prior evidence stale; retain failures and counterexamples. Do not lower a threshold or narrow a reference panel after observing results to obtain a pass.

The orchestrator records an accepted amendment and its dependency impact in the active execution register. WP02 updates the new native model and interface revisions; downstream owners consume the same frozen revision. Where dependency mapping is incomplete, broaden rechecks and retain that limitation. Versioned contracts, decisions, and receipts remain separate from the frozen handoff's historical statuses.
