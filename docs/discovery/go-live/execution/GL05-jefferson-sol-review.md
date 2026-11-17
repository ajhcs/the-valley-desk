# GL05 Jefferson private import — independent Sol review

Reviewed 17 November 2026 by `agent:sol_gl04_review`. **Accepted within the private import boundary.** No unresolved blocker remains in the reviewed transformation, deduplication, queue or preservation behavior. This report does not amend the approved GL05 six-work source selection, its immutable field attestation, the original 41-account map, or the GL05 core acceptance report.

## Counts and provenance

The raw input is `/workspace/worktrees/builderbob/thevalleydesk/work/jefferson-github-census-20261117-p1MShY`, supplied by the user from peer thread `01a1e6ca-ab77-7850-8977-7c860e5ed7d3`. No message was sent to that peer, no supplied script was run, no source request or failed-source retry was made, and no original article body or abstract was copied. Independent local hashing verified every one of the ten entries in `SHA256SUMS`; all eleven raw files, including the checksum file itself, match the private baseline after review. Hash consistency establishes the supplied snapshot's bytes, not provider truth or collection permission.

| Population | Independent readback | Meaning |
| --- | --- | --- |
| Account inventory | 29 keys; 28 successful; 1 failed | Handles, with no native account IDs or verified account control. |
| Zero-result account | `cpnn-lab`, successful with 0 repositories | Does not establish absence of work. |
| Repository inventory | 231 rows, 231 numeric IDs and 231 case-folded aliases; 81 forks, 4 archived | Reported native metadata, not 231 eligible Jefferson health projects. |
| Bibliography | 308 distinct PMC IDs | Two reported queries returned 313 and 57 rows before deduplication. Search mention need not be affiliation. |
| Historical full-text outcomes | 299 reported successes, 9 reported failures | Outcomes retained as historical reports. No acquisition or use qualification is inherited. |
| Article–URL queue | 504 distinct pairs, from 650 original occurrences; 117 repeated pairs | Repeated mentions are traceable, not independent projects. |
| URL classification | 423 repository-shaped URLs, 39 paths, 18 account-only links, 24 invalid fragments | Includes 14 unsafe/outside-GitHub URLs withheld as hashes; shape does not verify existence or study-code relationship. |
| Combined private map | 68 account keys, 277 repository candidates: 231 reported native IDs plus 46 URL-only leads | Two handle overlaps and one repository overlap with the unchanged original map. No verified novelty, distinct-person or project total. |

I compared all 231 native rows directly with the raw account snapshot for ID, alias, URL, fork, archive and timestamps, and checked their exact account/repository pointers. All 308 bibliographic IDs, titles and row pointers match the raw metadata. Each of the 504 rows matches its CSV article/URL pair or withheld-URL hash and logical row number. All 650 occurrence pointers resolve to the same article and URL in the supplied JSONL. This checks transformation and binding; it does not independently verify the papers or provider responses.

## Field and identity boundaries

The allowlist retains bibliographic identifiers, title, source-reported publication date, standard PMC URL and source pointer. Repository metadata retains reported ID, full name, URL, fork/archive flags, timestamps, bounded description and SPDX hint. Neither description nor license hint grants health-purpose approval or reuse permission. Pair records retain URL/hash, mechanical triage flags, original occurrence positions and unreviewed status. No abstract, article text, author list, author affiliation, email or extracted article context field appears in the sanitized source objects. Account `context` and `reportedContext` are explicit short report annotations; they are not article extracts.

Reported group labels carry source-report line pointers, source URLs when supplied, association categories and `currentAffiliationVerified:false`. Empty source-URL arrays remain visibly report-only. Lab branding, a publication author, a self-profile, a past collaboration and institutional ownership are distinct. Historical Edwards/Moss material remains historical and does not establish a current Jefferson role, physical worksite or every repository's attribution. No physical-site or county inference is added. Context for a named project is not propagated as approval for all repositories in an account.

`talexand003` remains a failed lookup and a separate account key from `talex-labs`; the report's asserted redirect is not a verified identity merge. The `tingtingzhan/hyper.gam` 404 remains an unavailable historical link, with no newly observed native repository or active-publication claim. `JeffersonLab` remains the explicit unrelated DOE-facility negative and is absent from institution-associated account inventory. All publication-pair relationships remain `unknown`, `unreviewed` and `publicationAuthorized:false`; dependency, external collaboration and actual study code have not been adjudicated.

## Independent challenges and repairs

The first function probe run passed 11/12: a malformed `articleId='not-a-PMC'` was accepted. The original result is retained, and the repaired strict PMC identifier contract passes the same probe. Initial code inspection also identified missing sanitized-byte receipt validation and loss of account source pointers/context. Engineering repaired those before the final tests. Calendar-valid observation dates and a hash for each withheld URL are now required. Strict nested schemas reject unrecognized abstract/contact/context fields, including when an attacker recomputes the mutable manifest's sanitized output hashes. These hashes are consistency receipts, not a public review grant.

Final independently executed checks:

- 12/12 function challenges: duplicate accounts, conflicting native IDs/aliases, namespace substitution, unsafe integers, missing native pointer, impossible day, malformed PMC identity, missing withheld hash, zero source row, duplicate pair, extra sensitive fields and preserved account pointers.
- 6/6 isolated actual CLI cases: unchanged `--check`; unsealed native-field mutation rejected; resealed bibliography abstract, account contact and occurrence-context fields rejected; unknown `--publish` argument rejected. Only sanitized fixture copies were made under the private audit directory.
- 10/10 substantive projection checks, including all-row equality/pointer closure, closed field sets, recursive prohibited-key absence and unverified-current-affiliation status.
- Repository-owned focused test file: 6/6 passing under qualified Node 22.23.2. Actual map generator `--check` passes.
- The repository-owned offline sanitizer reproduced all four sanitized source files byte-for-byte from the supplied snapshot. Independent overwrite and path-traversal probes both fail closed. It verifies checksums and uses explicit field/context mappings; it never runs the supplied acquisition scripts or contacts sources. This is repeatability for the exact dated snapshot, not a general Jefferson census or permission to collect another tranche.

The first private harness used a `.ts` path outside an ESM package and failed at module linking before test execution; the retained `.mts` run above corrected that harness setup. No implementation failure or pass was inferred from the linking failure.

## Preservation and acceptance limits

Final independent hashes confirm the original GL05 selection (`4d5ce6ece7cf1f58f72502454e5adca0f199ef794f2b273470f1a967c64c050f`), immutable source attestation (`c0566029032d7e27df634d7bf63aa26d67f5cfa7254b3dd5f8b3192f78780782`) and original 41-account map (`1a3eb51039f73812ff29bfa022e8e4648cab0f718ab9357a83eae2e540712e0c`) are unchanged. The six public works remain the approved directory slice. This import adds no publication, source enrollment, public relation, benchmark eligibility, GL09 completion credit or deployment.

Private intake and deterministic reconstruction are accepted. Project-specific health purpose, dated regional relationship, source-use rights, person/account identity, actual repository–paper role and current availability remain review work. Repeated imports must preserve failed, unavailable, outside-scope and held outcomes. Source acquisition requires its own qualified route. Root records core full-regression, exact-head CI and operator/release decisions separately; this report neither substitutes for nor expands those gates.

## Reviewed bytes and retained evidence

- `src/ingest/discovery/research-map-import.ts`: `0a568b10fda41c7ba7c8a5ed2de3e24649a59a22e5de45b7ae5ef1ef09071547`
- `scripts/build-research-map-import.mjs`: `4a34803d84f2a1474a16edadceaea1d487ff2ca7f9407a7232047d260bfb2859`
- `scripts/sanitize-jefferson-intake.py`: `22bc418b8cd7c8b573f3ffcd3736244400c750fd0e30e6070801cf6ffc75cd60`
- `test/discovery-research-map-import.test.ts`: `361ddd76b0b497bd0155af68346118f7518981d4595b9d1e4920e17b0e499521`

Source intake manifest: `edc3ea466c9680af7c144a98d6b6fddda35440e5a8d1e24ee12b358007207e14`; account evidence: `319f330be78bc99a21c437aec0ac1f0e1888fa9b1ce09c7d307386c09bcc6035`. Final generated map, queue and all input hashes are recorded in the private final readback below.

Private evidence directory: `/workspace/build/builderbob/tvd-jefferson-import-20261117/sol/` (mode 0700). It retains the failed initial test result, final results, bounded CLI fixture attempts and logs. No raw article metadata/body was copied there.

| Private evidence file | SHA-256 |
| --- | --- |
| `raw-baseline.json` | `73de128ceb875745439ddf68a9cb19d34fac3778e54816784d66878577bf592f` |
| `projection-audit.json` | `055f54666fa52740d44742e6590f5854d9df873e2e729414af6b6dc3ec47944e` |
| `probes.initial.json` | `491021fe04e3784fcf447a91f2026d03bab82fa490cbbfbadb6fcdc1008b4c90` |
| `probes.final.json` | `af431b4f0474ef269b6e09fb649917dbdb44198d4b78b3cd660f763d37935fce` |
| `cli-probes.json` | `34e405cd2d640c69060e75c628d6d682f7ee2b2858e7afbf3dd7c05414205b0a` |
| `sanitizer-negative-probes.json` | `febd7cd2a85a963aa268feee93c901590d9de503997b34494399373ac7b9888c` |
| `final-readback.json` | `2af8cb8f14f206ee65cd371fa44fbd417cc22eaa0bb07685a2c7c527febf7fb8` |
