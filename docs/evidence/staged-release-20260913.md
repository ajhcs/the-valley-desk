# Staged Release: 2026-09-13

This is a staged implementation release, not full Policy/Technology Watch acceptance.
The user explicitly requested completion and go-live. Publication still requires
actual named review of exact source evidence; broad release authorization does not
supply those decisions. Source access-policy clarification remains pending.

## Qualified Scope

Deploy the integrated News/Events improvements and authenticated Watch review UI
to the existing Worker after the exact candidate gate. Apply additive0031-0036.
Keep WATCH_PUBLIC_ENABLED and POLICY_BACKGROUND_PUBLIC_ENABLED false. Keep new
Watch collection disabled. Enable EVENT_CALENDAR_COLLECTION_ENABLED for existing
published event data, but keep EVENT_CALENDAR_PUBLIC_ENABLED false until a natural
successful synchronization and persisted-calendar validation are observed.
Preserve Spark1.3, model budgets, schedules, secret bindings, routes and domains.

The operator review screen uses existing Access identity and exact proposal hashes.
It cannot approve a model-authored verification receipt or bypass source permission.
Failed queue reads return503, not a successful empty queue. Review UI and scale
tests are registered in the normal test command.

## Fresh Evidence

Production health still reports290d41c5ca08a23df3637fd32ca9b366a4850aaf/schema0030.
Cloudflare deployment metadata still identifies Worker9a0502f8-5a77-45ec-8a88-c7ee539566e7
at100%. Correct tag-based Builds trigger API returns403; no push or merge until
those controls can be coordinated. Use the established manual deployment path.

Fresh export restored successfully into disposable actual local D1. Before/after
0031-0036:22 published records,1657 ingest runs, zero foreign-key violations.
Complete publication rows retained SHA256
b81a3f845ec95525aab82c49f247a7710642a030600a1680f77a7e5b11abf524.
Old290d41c and candidate Node Worker handlers both read67 public feed identities
against the migrated restored database. This is not an actual workerd write test.

Dedicated R2 bucket the-valley-desk-backups was created in the existing account.
Public development URL is disabled; no custom domains exist; no Worker binding
or other project bucket changed. Export uploaded under a unique hash-bound key:
releases/2026-09-13/pre-0031-d46997f386ed05730fc1694b1525dbbe87b83381fb963071334b806f8f19dfb3.sql.
Remote download hashes identically to the locally restored export:
d46997f386ed05730fc1694b1525dbbe87b83381fb963071334b806f8f19dfb3.
This closes the separate off-box export placement gap, not automatic backup
scheduling or cross-provider disaster recovery. Retain this object; no lifecycle
deletion rule was added.

Evidence: /mnt/d/tmp/plumbob/tvd-watch-go-live-EhZRfI/.
Candidate0f43d6b passed its exact gate and retained-asset review UI checks.
Remote0031 applied, but0032 failed with D1 incomplete input before Worker deploy.
Remote ledger31 and absence of representative tables confirmed rollback of0032.
The installed client SQL splitter retained all eight statements; the precise
remote parser cause is unproven. Move the nested CASE predicate into trigger WHEN
without changing accepted-only revision checks. Regression tests cover initial
and matching acceptance, stale acceptance rejection, stale rejection and missing
draft foreign keys. A fresh disposable D1 restore with the corrected0031-0036
retains the same publication hash,22 rows,1657 runs and zero FK violations.
This migration correction requires a new exact gate before retry or deployment.

## Rollback And Public Exposure

Record current deployment immediately before mutation. Restore recorded Worker
9a0502f8-5a77-45ec-8a88-c7ee539566e7 with its recorded configuration on regression,
retaining additive tables/history. Do not restore the entire production database
for a code-only rollback or erase intervening News/Event writes.

After deployment verify build/schema/config, News/Events/feed routes, Access denial
without trusted identity, held Watch endpoints, and the next natural calendar run.
Only then consider a separate calendar-public flag promotion with readbacks.

Full Watch exposure remains gated by qualified sources, named accepted content,
missing federal/DE/local coverage, policy interpretation and regional technology
evidence, real model evaluation and reader acceptance. The1000-subject SQLite
benchmark verifies bounded responses and invalidation, but demonstrates whole-kind
JSON/dependency scan growth; Cloudflare load/cost qualification remains open.
Seven-day natural observation starts after qualified public Watch exposure.
