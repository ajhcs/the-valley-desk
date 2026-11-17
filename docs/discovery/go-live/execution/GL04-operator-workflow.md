# GL04 reviewed snapshot workflow

This is an offline, PR-reviewed directory workflow. It is separate from live
WP14/WP16 admission and the independent human benchmark. The user authorized
the orchestrator and assigned agents to perform ordinary listing review. Names,
model confidence and a receipt hash inside a candidate file cannot grant that
authority. The reviewed source-code pin is the trust boundary.

## Current reviewed generation

The immutable [source review](GL04-selection-review.json) approves two exact
lean records: a CAMIPM-linked CrCEST repository without a paper prerequisite,
and the GASTON publication as a standalone entry. The latter was historically
discovered through its repository; standalone admission supplies no independent
discovery credit. Original native metadata and historical contexts are preserved.

The private [frontier crosswalk](../evidence/GL04/frontier-crosswalk.json) resolves
every GL03 candidate to its stable captured frontier ID, native identity,
receipt and retained fact pointer. One captured candidate is accepted into this
new reviewed snapshot; seven remain held. The three failed source scopes also
remain held. GASTON comes from the previously retained corpus. The capture
frontiers remain immutable with `publicationAuthorized: false`; the separate
reviewed selection controls the projection. No review silently consumes or
deletes captured evidence.

Run `npm run discovery:directory:check` to reproduce and compare the current
public catalog/removal metadata and private generation state/report, including
the immutable generation archive. `npm test` invokes Watch and Discovery through
the existing `posttest`; all five GL04 test files are registered in Discovery.
`npm run build` checks the directory before generating the legacy feed/build.
No command refreshes a source, reviews a candidate or enrolls collection.

## A later addition, correction or removal

1. Start from `generation-report.json`'s `nextPriorState`. It names exact
   content-addressed state bytes under `generations/<sha256>.json`. Preserve that
   archive; never use mutable `generation-state.json` as an anchored parent.
2. Prepare a new versioned selection and source observations, preserving earlier
   accepted files. Update the builder's fixed selection/private-output paths and
   the trusted authority as a reviewed PR change. No CLI argument may supply a
   replacement authority. Use current evidence permissions and qualify new source
   methods before acquisition.
3. Bind each lean claim to its actual subject, source role, observation, native
   identity and supported precision. Retained native metadata, qualified GL03
   fact packets and curated primary observations have distinct methods. A digest
   of a discarded response is not retained native evidence. A county map does
   not prove affiliation; an author affiliation does not identify a repository
   owner or current employer.
4. Record accept, hold, duplicate, outside-scope, correction or removal receipts.
   Their binding digest covers evidence mappings and target; their work digest
   excludes only `reviewRefs` to avoid a circular hash. The complete selection
   digest includes those references and every emitted field. A duplicate needs a
   distinct active target at its exact revision. Holds preserve the queue and do
   not renew a previously published record's check date.
5. A correction targets the exact prior work/revision, preserves canonical native
   identity and advances revision by one. Removal targets a prior work/revision,
   emits no work, and appends cumulative ID/native-identity suppression. Dangling
   relations must be corrected in the same selection. There is no reinstatement
   shortcut. Removing a work under another internal ID cannot bypass its native
   identity tombstone.
6. Sol independently reviews the exact source slice and creates a new immutable
   selection-review artifact. The operator verifies its scope and source evidence,
   then pins its bytes, complete selection digest, explicit roles and archived
   prior state in `directory-review-authority.ts`. The builder never generates
   that approval from candidate data. Ordinary agent review is not an independent
   human label or a scientific-validity finding.
7. Build, compare the change report and reproduce with `--check`. The content
   version covers emitted records and suppression state. Keep every prior archive
   exact. Repeat source, lifecycle, public-boundary and relevant route checks;
   changed snapshots require cursor restart. Public removal metadata contains
   only version and removed work IDs; private reasons, bindings and native-key
   hashes stay outside the Worker.

The current catalog contains two works and no support-only objects. A project
group count is not established; no people or project total is advertised. The
older 28-record catalog, nine citations and three historical regional contexts
remain separate compatibility and evidence material.

## Read surfaces and release

With the local-only `DISCOVERY_DIRECTORY_ENABLED="true"` flag, the Worker serves
`GET/HEAD /api/discovery/v1/works`, exact work details, `/discover/works` and
`/discover/work/:id`. IDs use canonical percent encoding. The bounded initial
query is `q`, `kind`, `limit` (1–50) and snapshot-bound `after`. Unknown/duplicate
parameters fail; changed or invalid cursors require restart. API and complete
HTML responses are bounded to 128,000 bytes and are no-store/noindex at this
stage. The generation's real API list is 7,367 bytes.

Only generated public JSON enters these routes. Reads never fetch providers,
query a database or accept mutation. A missing/false flag returns 404. Missing
work is 404, a removed work is 410, and inconsistent catalog/removal metadata is
503. The legacy `/discover` and `/api/discovery-pilot` behavior remains separate.
GL05 owns ordinary topic/search improvements; GL06 owns the product front door
and polished presentation. GL08 owns operational correction/rollback rehearsal,
and GL09 owns broader source and county coverage.

The flag remains absent from production configuration. GL11 retains the exact
release, compatibility, monitoring and rollback gate under existing deployment
authorization. GL04 does not activate a public service or accept those packages.
