# Leadership identity incident trace — 2026-09-06

This trace used read-only Cloudflare D1 `SELECT` statements and the retained operational-notice export. Every D1 receipt reported `changes: 0`, `rows_written: 0`, and `changed_db: false`. No role was reopened, no alert was cleared, and no production code or schema was changed.

## What failed

The historical exception `Cannot build executive candidate without institution-scoped identity` was not caused by a blank `covered_people` row. A production integrity query returned `blank_identity_rows: 0`.

The old departure path instead:

1. treated any complete monitored official page, including a `person-bio`, as evidence that every omitted executive had departed;
2. closed the durable `executive_roles` row; and only then
3. rendered an editorial candidate through the static coverage pack, which did not contain dynamically enrolled people and threw the exception.

That ordering allowed a role mutation to survive an exception. The repository candidate now restricts absence evidence to complete `leadership-page` rosters and constructs/validates the stored identity and editorial candidate before closing a role.

## Exact September 2 records

The retained notice reports occurrence 7 at `2026-09-02T18:03:29.615Z`. The corresponding overall ingest run was `30da6f61-1766-4064-a79a-6ae07721a31c` (`18:02:32.232Z`–`18:03:29.202Z`, state `succeeded`, 102 items), demonstrating that a leadership substage exception did not fail the whole run.

Two dynamically enrolled CHOP roles were closed at the same immediately preceding verifier timestamp, `2026-09-02T18:00:12.840Z`:

| Role ID | Person | Source | Effective interval |
|---|---|---|---|
| `role-person-inst-chop-jesse-a-taylor-inst-chop-2026-09-02T03:30:42.396Z` | `person-inst-chop-jesse-a-taylor` / Jesse A. Taylor, MD | `src-chop-leadership` | `2026-09-02T03:30:42.396Z`–`2026-09-02T18:00:12.840Z` |
| `role-person-inst-chop-joseph-w-st-geme-iii-inst-chop-2026-09-02T03:30:42.396Z` | `person-inst-chop-joseph-w-st-geme-iii` / Joseph W. St. Geme III, MD | `src-chop-leadership` | `2026-09-02T03:30:42.396Z`–`2026-09-02T18:00:12.840Z` |

The role table has no `updated_at` or incident foreign key, so it cannot assign one of those two simultaneous closures to occurrence 7 and the other to a later occurrence. It does identify the exact affected record set for that failure window. A second retained notice recorded the same exception at occurrence 68 on `2026-09-03T18:17:18.305Z`.

The CHOP snapshot set used that day mixed one `leadership-page` with three `person-bio` sources. All were stored as complete, and the old verifier incorrectly allowed person-bio omission to establish roster-wide absence:

| Source | Kind | Fetched | Extracted people |
|---|---|---|---:|
| `src-chop-leadership` | `leadership-page` | `2026-09-02T03:30:42.396Z` | 3 |
| `src-chop-desai` | `person-bio` | same | 4 |
| `src-chop-pennington` | `person-bio` | same | 2 |
| `src-chop-salmasian` | `person-bio` | same | 5 |

## Affected historical population

Production contains 205 `person-inst-*` dynamic roles; 204 are closed. This is an audit population, not a claim that every closure is false. It must be reviewed before any separately authorized repair.

| Institution | Dynamic roles | Closed |
|---|---:|---:|
| CHOP | 3 | 3 |
| ChristianaCare | 19 | 19 |
| Inspira | 3 | 3 |
| Main Line | 19 | 19 |
| Nemours | 47 | 47 |
| RWJBarnabas | 42 | 41 |
| St. Luke's | 28 | 28 |
| Temple | 1 | 1 |
| Tower | 17 | 17 |
| Virtua | 26 | 26 |

The first dynamic role was created at `2026-08-29T03:15:50.528Z`; the latest dynamic role event was `2026-09-05T10:30:06.246Z`.

## Acceptance and recovery boundary

Regression tests prove that:

- omissions from person-bio sources cannot close a role;
- a valid dynamic departure can proceed without consulting the static pack;
- a malformed stored identity is isolated before mutation and remains open/actionable.

Historical repair is intentionally unexecuted. A recovery operator must export the 205-row audit population, corroborate each closure against two complete independent leadership rosters, and only then prepare an explicit, reviewed repair manifest. Reopening all 204 rows automatically would replace one unsupported assertion with another.
