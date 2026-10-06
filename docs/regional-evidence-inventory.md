# Institution scope and freshness review slice

This additive slice is a pure offline projection. Its entry point is
`buildRegionalEvidenceReview` in `src/content/regional-evidence.ts`. No active
registry, collector, scheduler, parser, affiliation, alert, Ops route, deployment
setting or package script is changed. The canonical checkout and other owners'
checkouts are outside its edit boundary.

## Institution and source identities

The fixed monitor set remains the existing 16 IDs, including LVHN and St. Luke's
with their existing geographic edge posture. Its news registry has 16 source
rows attributed to 14 distinct institutions: Cooper and LVHN each have two.
Princeton and Doylestown are attribution gaps. That does not establish an absence
of news. Wistar and other inventory institutions do not enter this denominator.

`counts.coreNewsAttributionGaps` exhaustively counts fixed-core institutions with
no news registry attribution. Its two mutually exclusive classifications are
`coreNewsReviewScopeAttributionGaps` (a review-only newsroom relationship exists)
and `coreNewsRegistrationGaps` (neither registry attribution nor a review
relationship exists). The two classifications sum to the exhaustive total;
registry-attributed institutions plus that total equal the fixed 16.
`coreNewsKnownSubsidiaryAttributionGaps` separately counts Princeton and
Doylestown when they lack registry attribution, regardless of whether review
links exist. On the unchanged fixture these metrics are respectively 2, 2, 0
and 2. They are registration/attribution declarations, never a count of qualified
institution coverage or proof that news is absent.

The fixture `fixtures/regional-evidence/institution-scope-v1.json` records four
separate Penn newsroom relationships (UPHS, Perelman, Princeton, Doylestown), two
Jefferson Digital Commons relationships (University, Health), and the existing
University CaPTk link. Perelman is a separate review descriptor outside the fixed
monitor set; neither Perelman nor University research is silently equated with
UPHS. Source IDs remain `ofs-penn-news`, `rgn-jefferson-research` and
`rgn-penn-captk`. Additional relationships create no collector or health identity.
Every source appears once in `sources`; relationship counts are separate.

Penn scope is supported by the delegated research on its existing media resource
page, and Jefferson scope by the delegated research on its repository about page.
These summaries are not represented as verbatim quotations, byte-verified
captures or newly observed evidence. Their observation times and capture hashes
are deliberately null. The CaPTk record references `ev-penn-captk-link` from the
existing inventory, whose exact source and institution join is checked; this
adapter does not reverify retained bytes. No external institution request occurs.
Returned strings are untrusted data and must be rendered as text.

The relationship schema requires an exact source, institution, kind and evidence
join, matching source host and channel. Source scope needs source-scope evidence; a repository link needs link
evidence. An article, profile, committee or invited repository work cannot become
source-scope evidence. All relationship declarations remain review-only. Source
health may be fresh while institution coverage freshness remains unknown. No
declaration or healthy/complete source receipt establishes current employment,
repository ownership or a complete leadership roster. This slice adds no path to
qualify those claims.

## Separate clocks

| Clock | Existing authority | Daily leadership behavior |
| --- | --- | --- |
| Read projection source health | `src/ingest/regional-coverage.ts` / `regionalCoverageInputs` | 48 hours; existing hourly 2 hours and weekly 192 hours remain unchanged |
| Operational leadership diagnostic | `src/lib/operational-status.ts` / `leadershipFreshnessBudgetMs`, importing `src/ingest/leadership-config.ts` | 24-hour cadence plus bounded 2-hour grace = 26 hours; hourly 2 hours, weekly 170 hours |
| Observed author affiliation | `src/ingest/regional-contracts.ts` / `PublicAffiliation` and `resolveInstitutionalAuthor` | At most seven days; exact expiry is excluded; independent profile/evidence token required |

The operational helper is used by `src/ingest/automation.ts` and
`src/ingest/review-api.ts` to produce runtime leadership diagnostics. The review
slice imports that helper and `buildRuntimeLeadershipCoverage`; it does not
invent another daily constant or change the read projection's 48-hour policy.
The output labels both clocks and flags their difference. This is reconciliation
for review, not a policy change. Operational freshness uses separate scheduler
receipts and cadence from the trusted registry. Generic source-health receipts,
retry dates and relationship declarations cannot substitute for those receipts.

At exactly 26 hours the operational helper still considers an observation
current; immediately after it expires while the 48-hour read projection remains
fresh. At exactly seven days an affiliation token expires. A new source check
does not renew an affiliation or qualify subsidiaries. Missing receipts remain
unknown. None of these clocks proves an article's publication date, a person's
appointment date, a departure or a full roster. The existing read-view snapshot
lifetime (15 minutes) is also unrelated and is not changed by this slice.

## Offline reproduction

Run in this candidate's own dependency tree, using the existing supported Node
runtime. Test concurrency is one; shell timeouts bound both commands.

```sh
timeout 90 node --import tsx/esm --test --test-concurrency=1 test/regional-evidence.test.ts test/regional-contracts.test.ts test/regional-coverage.test.ts test/regional-read-view.test.ts
timeout 30 node --import tsx/esm scripts/validate-regional-evidence.ts
```

The validation script loads bundled JSON only. Its fixed `asOf` is a reproducible
offline review instant, not a live source observation. It accepts no options,
health files, URLs, database bindings or credentials. Tests include synthetic
positive source-scope controls and the five requested negative boundaries.
Actual bundled registries supply the 16/14 denominator test. No production smoke,
held-source retry or integration acceptance is claimed.

Candidate verification passes 45 focused tests (19 new and 26 existing), strict
application type checking, strict test/script type checking, offline JSON
projection and the repository secret scan. The test runtime is the existing
BuilderBob Node 24.21.0. The deployed dependency tree lacks `@types/node`, so the
extra test/script check uses an isolated artifact copy of already installed
Node 20.19.27 definitions and their `undici-types` dependency; no package manifest,
lockfile or shared dependency directory is modified. The final tests also run
under a guard that blocks and counts fetch and outbound Node network APIs, while
permitting TSX's Unix sockets only beneath this candidate's temporary directory.
Exact commands, check hashes and the guard receipt accompany the frozen commit.

## Exact integration boundary

The candidate adds only these five files:

- `src/content/regional-evidence.ts`
- `fixtures/regional-evidence/institution-scope-v1.json`
- `test/regional-evidence.test.ts`
- `scripts/validate-regional-evidence.ts`
- `docs/regional-evidence-inventory.md`

A future interface owner may call `buildRegionalEvidenceReview` with the
unchanged regional inventory, coverage pack, official source registry, trusted
as-of time and optional separately supplied generic/leadership receipts. Read
`sources` as the unique collection identity table, `relationships` as the
review-only institution edges, and `coreNews` as attribution status. Counts over
relationships must never be used as source-health counts. The two receipt
families have distinct schemas; raw errors and completeness are omitted.

Do not insert these relationships into active `institutionId`/`institutionIds`
fields, enroll authors, duplicate Penn collectors, relabel a complete roster,
extend source freshness or change affiliation TTL during integration. No current
Worker, source registry, read-view pagination, package test command or publication
gate imports this module. CI inclusion and any consumer wiring require separate
coordinated review. Actual institution-specific content binding, retained scope
verification, author-profile transports and source-policy review remain future
qualification work. This is an immutable review candidate once its commit and
evidence receipt are supplied; no PR or deployment is part of this task.
