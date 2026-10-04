# Leadership source quality: local review candidate

Base: approved regional release `139e53ee0d39695111d9d42785d220e079f5490c`.
Owner: regional ingestion workstream, BuilderBob. Independent of PA PR18 and the held Ops diagnostic patch.

## Implemented locally

- Retain bounded `said Name, credentials, role at/of/for Institution` article claims only when the institution immediately qualifies the role. Add long-form CMIO/nursing executive roles and president/chief executive. Article dates and `currentAffiliationVerified: false` remain attached; no arrivals, departures or current-roster updates are authorized.
- Preserve ISO 8601 publication offsets with or without a colon, including Rutgers's actual `-0400` representation. Fetch time and dateModified never substitute for publication time; invalid dates remain unverified.
- Stop generic heading extraction before another non-role heading, so a person cannot inherit the next person's title. Preserve role headings.
- Recognize the explicit empty Incapsula bootstrap signature before the empty-text branch. Keep ordinary app shells empty-unverified. Both remain degraded and on existing failure backoff.
- Label leadership counts in daily digests as condition evaluations. This extends the already implemented individual-alert label; scheduler, freshness, recovery, grouping and notification thresholds stay intact.
- Add the officially evidenced Cooper Norcross Health alias to the existing Cooper institution. No new person records or institution merge, source URL, source status, cadence or activation changes.

## Evidence and limits

Normal public web discovery identified Penn's linked CEO profile, Cooper's own September 28 release, and Rutgers's September 15 joint-program release. Three bounded direct public reads on BuilderBob were made once; no registered held URL was directly retried and no changed identity/network or challenge execution was used.

| Alternative | Observed representation | Qualification |
| --- | --- | --- |
| [Penn CEO profile](https://www.pennmedicine.org/about/our-people/meet-our-ceo) | Web-rendered official profile names Kevin Mahoney; direct read returned HTTP200, 212 bytes, an empty Incapsula bootstrap | Legitimate profile candidate, collector access unproven. It is a CEO profile, not an information-services roster. No registration/activation. |
| [Cooper release](https://blogs.cooperhealth.org/news/2026/09/cooper-norcross-health-first-in-new-jersey-to-bring-ambient-ai-to-the-nursing-bedside-with-microsoft-dragon-copilot/) | Direct HTTP200; decoded public HTML; publication `2026-09-28T20:39:34+00:00` | Own publisher's dated CMIO attribution and name-change evidence. Current full roster remains missing. |
| [Rutgers joint-program release](https://www.rutgers.edu/news/rutgers-and-rwjbarnabas-health-launch-innovation-hub-powered-amazon-web-services) | Direct HTTP200; publication `2026-09-15T11:03:19-0400` | Institutional partner's dated RWJBarnabas president/chief executive attribution. Not RWJBarnabas's own roster or confirmation of a complete current team. |

Offline before/after replay uses the same captured decoded HTML, with fake fetch functions. Both article claims were previously omitted. The patched parser retains them as partial, with zero current-role observations and no source recovery. Penn's new profile capture is demonstrably a challenge; historical 212-byte failures have no retained body/hash proving the same cause. Do not relabel old rows from byte count alone.

The tracked fixture uses minimized synthetic wrappers around short literal official clauses; it is explicitly not wire HTML or newly verified current-person records. Full captures, hashes and read receipts remain in the review evidence directory, outside the checkout. No source contents are instructions.

## Backlog, owners and acceptance

| Coverage component | Implemented baseline/candidate | Remaining work | Owner | Acceptance |
| --- | --- | --- | --- | --- |
| Freshness and source issue accounting | Baseline already has cadence-aware freshness, per-source errors/retries, explicit condition-evaluation units in individual alerts | Candidate clarifies the same unit in daily digests | Regional ingestion / parent review | 176 evaluations must never be presented as 176 new failures; fetch2/failed0 cannot recover backoff gaps |
| Article affiliation evidence | Baseline already gates historical/undated articles; candidate retains newly supported quote syntax and offset dates | Review-only evidence can inform editorial context; it cannot certify current teams | Regional ingestion; parent editorial review | Literal institution attribution, original publication date, source URL and partial/unverified status; zero current-role events |
| Penn leadership | Current IS source empty-unverified; new public CEO profile directly challenged | Locate permitted usable IS/leadership evidence at normal cadence; evaluate a separately scoped CEO profile | Regional source owner | First-party evidence with actual parseable representation, scoped current-role proof, repeated daily snapshots or independent official confirmation |
| Penn Princeton | Newsroom primary and reporting alternate are configured; current coverage lost | Genuine current team/profile source needed; financial report supports only its period | Regional source owner | No article/report refetch masquerades as current complete roster; reconcile publication/effective dates and actual source scope |
| Penn Doylestown | Appointment article retains historical claims if accessible; current coverage lost | Verify current leadership from permitted official roster/profile and reconcile undated provider affiliations with dated appointment evidence | Regional source owner | Disambiguated person, institution and effective date; no current-role inference from a stale provider biography or appointment alone |
| Cooper | Own public release now parseable locally; new alias verified | Complete current team source remains blocked | Regional source owner | Permitted official current roster or scoped profile; no early blocked-path retry, no article-based coverage recovery |
| LVHN | Medical-staff leadership/committee source is blocked and narrower than whole-system executives | Verify Jefferson/LVHN regional versus enterprise scope and temporal institutional relationship | Regional source owner | Explicit official scope and dates; do not conflate medical staff committees, regional leaders and Jefferson enterprise executives |
| RWJBarnabas | Partner article now parseable locally; own roster blocked | Own current leadership evidence and reviewed source configuration remain needed | Regional source owner | Preserve partner attribution separately; no whole-team recovery from a single dated quote |

Registered retry holds remain Penn IS / Cooper / LVHN October9 23:01:13.480Z; Princeton / Doylestown October7 19:45:33.365Z; RWJBarnabas October8 01:30:44.555Z. These are retained scheduling facts, not authorization to override cadence. New LVHN public news path encountered HTTP403 through web discovery and was not retried. No institution or PA publisher was contacted.

## Review and rollout holds

Local tests/build/secret checks and an immutable patch handoff are the deliverables. Parent coordinates exact changes and independent review. This candidate is not deployed or activated. D1 replay/mutation remains held while the prior anomalous receipt is unresolved; no new provider query is needed for these tests. Ops disclosure approval remains unanswered, its separate patch inert, and no login retry is requested. Broad people, institution, publication and GitHub coverage remains partial; this candidate proves these scoped parser/clarity improvements only.

## Local validation

11 focused regression tests and the complete repository suite pass (723 main + 146 watch = 869). Frontend TypeScript/Vite build and required secret scan pass (553 files). Build retains the existing bundle-size advisory. A semantic registry comparison proves all 23 monitored source definitions, schedules and person records are unchanged; only the Cooper alias is added. Offline captured-HTML replay shows Cooper and Rutgers `unrecognized -> partial`, one dated claim each, and Penn `empty-unverified -> challenge`; all have zero current-role events and no new last-success timestamp. All application work and tests ran on BuilderBob. Lenovo carried SSH/SCP transport only.
