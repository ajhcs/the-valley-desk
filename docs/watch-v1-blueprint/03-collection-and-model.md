# Collection, Muse, and Operating Design

## 1. Source Enrollment Contract

Broader coverage means more qualified sources producing distinct eligible facts,
not a larger list of URLs. The machine-readable `source-plan.json` is a planning
inventory. Its `qualification` fields deliberately say `target`, not `active`.
Existing healthy sources remain enrolled through the existing registries.

Each new source must have an enrollment receipt containing:

| Field | Required evidence |
| --- | --- |
| Identity/ownership | Stable registry ID, family, desk, jurisdiction/institution, engineer owner, editorial owner |
| Authority | First-party status, official institutional link, or explicit secondary/discovery-only classification |
| Endpoint | Exact HTTPS URL, expected final hosts/paths, transport, documented redirects, access conditions |
| Permission/access | Terms and reuse assessment, public vs authenticated API, credentials required, robots/access posture |
| Parsing | Parser ID/version, actual sample time/hash, required field paths, pagination, completeness classification |
| Dates/identity | Native record IDs, session/version mapping, source date precision, document link behavior |
| Schedule | Source update cadence, polling cadence, overlap window, full-reconciliation cadence, per-host pacing |
| Operations | Typed failure mapping, timeout/size caps, retry policy, alert owner, fallback and fallback authority |
| Qualification | Two bounded successful samples where feasible, replay test, negative parser fixture, manual source comparison |

Qualification is an engineering/editorial decision recorded outside model output.
An automatically found feed enters a suggestion queue, not the trusted registry.
No login scraping, paywall bypass, anti-bot evasion, unrestricted link crawling,
or execution of downloaded repository code is part of this design.

### Source order

1. Official API or structured bulk export with durable identifiers.
2. First-party RSS, Atom, JSON Feed, ICS, or documented event JSON.
3. Public semantic HTML/JSON-LD with a bounded source-specific parser.
4. A narrowly scoped scraper after sample qualification.
5. Secondary reporting/indexes as leads or attributed context, under existing
   corroboration rules. A fallback cannot inherit official authority.

Use the source's update behavior, not format preference alone: a reliable official
HTML action page may be fresher than a weekday bulk export. Keep both if the
incremental path and reconciliation path add distinct value.

## 2. Launch Coverage Matrix

The exact source-family list and county IDs are in `source-plan.json`. All federal
and PA/NJ/DE legislative, regulatory, and member families are first-release
requirements. Every county needs a named official body/source or an explicit,
time-bounded editorial monitoring assignment shown on the coverage page.

| Family | Strategy | Important mapping / acceptance |
| --- | --- | --- |
| Federal legislation | Congress.gov incremental API plus overlapping catch-up windows and official text links | Congress/session/type/number; action/chamber; member identifiers; do not infer enactment from a chamber vote |
| Federal regulations | Federal Register discovery, linked official rendition, Regulations.gov docket context | Proposal/final/correction/withdrawal relationships, comment windows, effective vs compliance dates |
| PA legislation | Existing fast detail/RSS adapters plus current-session ZIP/XML reconciliation | Printer number, amendment ID, co-sponsorship memo, source action ordering, authoritative text version |
| NJ legislation | Public detail/calendar path plus separately parsed Access export and vote CSV | Native schema/readme mapping, session, sponsors, actions, documents; do not treat the old GIS/member download as current |
| DE legislation | Qualified JSON feeds, official detail pages, current General Assembly reconciliation | Introduced/out-of-committee/stricken/in-lieu/chamber-passed/signed; session rollover |
| State regulation | PA Bulletin/IRRC; NJ OAL/agency notices; DE Register/agency notices | Issue/date, proposal/adoption/expiration/correction, source text, comment deadline precision |
| Representatives | Official chamber/member/committee rosters and official lookup links | Terms, vacancies, multi-member districts, current roster as-of and historical role preservation |
| Philadelphia | Legistar matters, attachments, meetings, people; official city notices | Confirm actual client API; distinguish agenda item, legislative file, sponsor, action, and version |
| Other 10 counties | County councils/commissioners, agenda centers, health boards, relevant notices | Name monitored bodies; municipal gaps remain explicit rather than claiming county-wide completeness |

PA publishes ZIP/XML bill history with a documented weekday hourly update path.
NJ documents Access bill tracking and vote CSV, with weekday updates. Delaware
publishes categorized JSON/RSS feeds and warns that feed URLs change by General
Assembly. These facts guide adapter choice; no exact feed has been production
qualified by this planning task. [PA data](https://www.palegis.us/data),
[NJ formats](https://njleg.state.nj.us/faq),
[DE feeds](https://legis.delaware.gov/RSSFeed)

### Expansion beyond policy

News: preserve the existing six feed entries and institution registry. Qualify
newsroom coverage across the 16 covered systems before adding long lists of
secondary reporting. Technical.ly's current entry needs repair/qualification,
not another duplicate entry. Track additional unique useful discoveries.

Events: preserve the two chapter adapters; target 8-12 additional academic,
association, health-system, innovation, and informatics calendars distributed
across all three states. Source quality and attendance details take precedence
over hitting the numeric range.

Technology: inventory 25-40 verified institution/lab/project channels and 50-100
artifact targets as a first enrollment range. Start with institutional provenance,
then repositories, publications, research datasets, documentation, and releases.
Include Penn/CBICA, CHOP/D3b, Jefferson, Temple, Drexel, regional Rowan/Rutgers
teams, University of Delaware, and ChristianaCare only where the specific lab,
campus, or artifact meets the existing geography. University-wide affiliation
alone does not make an out-of-region campus local.

## 3. Adapter Pattern

Proposed interface sketch, to be adapted to existing source-specific contracts:

```ts
interface WatchAdapter {
  id: string;
  version: string;
  collect(input: {
    source: EnrolledSource;
    checkpoint: SourceCheckpoint | null;
    now: Date;
    signal: AbortSignal;
    fetchPublic: BoundedRegisteredFetch;
  }): Promise<{
    observations: RawObservation[];
    proposedCheckpoint: SourceCheckpoint | null;
    health: SourceRunNote;
    completeness: "complete" | "partial" | "empty-unverified";
  }>;
}
```

The names above are design types, not existing imports. Reuse the repo's bounded
fetch, exact-host checks, retry helpers, parsers, and `SourceRunNote`. Separate
network collection from pure parsing so fixtures need no network.

Parser test folder convention:

```text
test/fixtures/watch/<adapter>/<sample-id>/
  manifest.json     source URL, fetched time, source identity, hash, reuse notes
  input.json/xml    bounded public sample or minimal synthetic equivalent
  expected.json    typed normalized observations and exact supported dates
```

Do not commit copyrighted full articles, private data, credentials, or oversized
PDFs as test fixtures. Prefer small attributed excerpts, public governmental
records after reuse review, or synthetic fixtures for parser mechanics.

### Collection algorithm

1. Check enrollment, due time, existing lock/lease, per-host budget, and last good
   representation. Return a schedule outcome without pretending a fetch occurred
   when the source is not due.
2. Fetch with bounded time, bytes, redirect count, and exact registered hosts.
   Parse upstream error/rate-limit responses before attempting content parsing.
3. Use conditional requests. HTTP 304 plus a retained good representation is a
   check, not a new artifact or a proof of a full source inventory.
4. Parse only expected source structure. A consent page/login shell is not an
   empty legislation feed. Record `parser-failed` or access failure as appropriate.
5. Validate native IDs, source date precision, document links, and source scope.
   Unknown fields are held with explicit reasons, not filled by model guessing.
6. Persist bounded observations before enrichment. Deduplicate using substantive
   keys. Retain original `firstSeenAt` and every supporting source relationship.
7. Acknowledge all required pages before committing the checkpoint. A page cap
   yields a partial snapshot with a resumable cursor, not complete success.
8. Queue eligible changed records fairly. Reconciliation and change discovery
   share identity rules so they cannot create duplicate developments.

Use overlap windows appropriate to source lag: initial proposal is 48 hours for
timestamped incremental APIs, plus a weekly full current-session reconciliation.
This is an adjustable starting policy, not a guarantee that every source is
complete within 48 hours. Sources with non-monotonic corrections need longer or
full reconciliation and a fixture showing the correction is detected.

## 4. Heavy Batch Path

W05 selects the actual runtime. Keep the first implementation operator-triggered
until access, packaging, limits, receipts, and schedule behavior are qualified.
Use existing Python PDF tooling where applicable; benchmark additional extraction
libraries before adding them. An archive/parser job is not a new autonomous
editor and cannot publish content.

Proposed protected route: `POST /api/signals/watch-batch`. Its dedicated
`WATCH_BATCH_INGEST_TOKEN` may only submit packets for allowed enrolled sources.
It is distinct from review, social, provider, and Cloudflare credentials. No
public/browser client receives it. Provisioning is a separate authorized action.

Packet fields: contract version; packet ID; enrolled source ID; parser version;
source checkpoint; original artifact hash/size; extraction hash; fetch time;
completeness; bounded normalized observations; and deterministic observation keys.
The server verifies the source/host/path, identity, hashes, size, and schema before
persisting. A valid packet is accepted for processing, never for publication.

Proposed application limits to qualify against real PA/NJ samples: 20 MB compressed
archive, 100 MB expanded total, 2,000 entries, 10 MB individual non-PDF data member,
120 seconds parse time, and 50 normalized observations or 256 KB per packet.
Existing PDF-specific caps remain unchanged unless their own review authorizes a
change. These batch numbers are proposed initial circuit breakers, not statements
of upstream file size or platform capacity. Oversized sources produce a hold and
a capacity decision; do not silently truncate a supposedly complete inventory.

Use proven archive/XML/Access readers. Reject path traversal, links outside the
scratch root, unexpected executable content, nested archives, XML external entity
resolution, and decompression overrun. Do not enable macros or evaluate source
scripts. Each job uses task-owned mounted scratch and removes its temporary files.

Idempotency behavior:

| Condition | Response | Cursor effect |
| --- | --- | --- |
| New valid packet persisted | 202 with receipt/packet ID and accepted observation count | Collector may acknowledge this packet |
| Identical packet replay | 200 with original receipt | No duplicate writes or model work |
| Same packet ID, different bytes | 409 conflict | No advancement |
| Invalid schema/source/hash | 422 typed rejection | No advancement |
| Missing/invalid credential | Same protected-route denial convention as existing API | No data disclosed |
| Storage unavailable | Retryable failure | No advancement |

Receipt retention must exceed the source replay horizon. Even if a packet receipt
is eventually pruned, per-observation uniqueness still prevents duplicate work.

## 5. Fair Capacity, Not Just Larger Caps

The current lane defaults are weights/targets whose sum exceeds the global cap,
not guaranteed independent capacity. Preserve the behavior proven by baseline
tests and measure actual News/Events service before changing scheduling.

Initial full-cap reservation proposal for a 32-candidate pass:

| Lane | Reservation |
| --- | ---: |
| News | 12 |
| Events | 6 |
| Policy | 5 |
| Technology | 4 |
| Finance | 1 |
| Procurement | 1 |
| Existing product news | 1 |
| Leadership | 1 |
| Shared remaining slot | 1 |
| Voices | 0 for the retired new-collection surface |

The reservations sum to 31; one slot and unused reservations are lent fairly.
Policy's five slots rotate across federal, PA, NJ, DE, and local. Local work also
rotates across due enrolled bodies. Product news and Technology are distinct
editorial lanes; assign each candidate to one lane so the same development is
not charged twice. Preserve existing historical Voices delivery.

Use persistent round-robin/deficit state at actual dispatch, including when
effective capacity is smaller than the nominal reservations. Starting every
short run at News would starve later lanes. Store the last dispatched lane and
per-jurisdiction cursor; retain unused deficits with a bounded ceiling. Within a
lane, reserve timely work but age the backlog so fresh arrivals cannot indefinitely
displace older eligible records. Failed and cooling-down sources do not consume
other sources' due-check reservations.

**A 32-candidate cap is not a throughput promise.** With concurrency four and two
sequential model calls per candidate, a 110-second window completes at most one
full four-candidate wave if both calls take 45 seconds. It cannot complete 32
such candidates. Source relevance and high-risk verification add work too.
Measure actual service times; stop dispatch before insufficient deadline remains;
persist unstarted work; report selected, started, completed, and deferred
separately. Never count a selected-but-unstarted item as an attempt or SLO pass.

Use a simulated clock/fake provider to test the scheduler at fast, moderate,
timeout, and zero-budget conditions. Increasing the registry or item cap does not
fix a measured deadline bottleneck. If sustained eligible arrivals exceed service,
W05/W12 must adjust qualified processing capacity or scope of source cadence with
explicit owner review; do not weaken publication gates to clear the queue.

## 6. Muse 1.3 Qualification

Use exact ID `meta/muse-spark-1.3-contributor`. The provider listing documents
structured JSON-schema output, a 1,048,576-token context window, and prices of
$0.10/M input and $0.20/M output at research time. Contributor prompts/outputs may
be used to improve Meta products. Account access and privacy-policy compatibility
must be checked separately; no provider calls or settings changes were made here.
[Model listing](https://openrouter.ai/meta/muse-spark-1.3-contributor)

### Experiment design

Create a versioned, editor-labeled corpus of 100 cases: 20 News, 10 Events, 35
Policy (seven per federal/PA/NJ/DE/local group), 25 Technology, and 10 cross-cutting
failure cases. Designate 20 for calibration and freeze 80 as a holdout before
prompt tuning. Label critical cases within the 100; do not inflate the denominator
by counting a repeated request as a new source example.

Each case records source fixtures/hashes, expected identity and dates, eligibility,
required literal evidence, allowed claims, prohibited conclusions, required holds,
and editorial usefulness rubric. Include old baseline projects, nonlocal technology,
Penn/Penn State confusion, license ambiguity, incomplete amendments, missing
definitions, duplicate sources, canceled events, date-only actions, and conflicting
official statuses.

Run paired 1.2/1.3 comparisons with identical evidence, budgets, deterministic
gates, and frozen prompts. Randomize review order and hide model identity from
copy-quality reviewers. Repeat designated critical cases three times per model to
observe variability; report repetitions separately. Have a second reviewer resolve
critical label disagreements before declaring a regression.

Phase one changes only the model/configuration compatibility. Keep existing split
classification/copy calls. Phase two adds Watch-specific enrichment prompts after
the model comparison is accepted. Do not bundle new model, new prompts, relaxed
gates, and higher budgets into one experiment.

### Input/output boundaries

Input is resolved public evidence, bounded relevant prior context, entity IDs, and
an explicit task schema. Do not send credentials, private review notes, subscriber
data, patient information, or unrestricted raw pages. Retrieved text is untrusted
data. Instruction-like source text follows existing hold behavior.

Output proposes evidence IDs/spans, entity matches, material change, and short
copy. It cannot add a trusted institution, invent a source URL, supply a review
decision, or approve its own claim ledger. Validate Zod, exact evidence binding,
local relationship, date/license/status, and current delivery gates independently.
Policy interpretation remains human-attested against the exact dependency set.

Use the existing completion wrapper, timeout, and structured error taxonomy.
Reconcile the actual `minimal` editor reasoning setting and separate verifier
options against the accepted base: README and source currently describe different
historical settings. Test the exact request shape under the intended account;
documentation support alone is not an endpoint qualification.

### Acceptance and spend

Critical negative cases: zero newly publishable unsupported claims and all required
holds. Holdout relevance/explanation must be at least baseline by the agreed rubric;
report case-level wins/losses, not just one average. Track schema validity, grounded
claim precision, eligible-development recall, false holds, latency p50/p95, timeout
rate, calls/tokens/cost per accepted development, and unresolved queue age.

Do not claim statistical superiority from a small handpicked set. Report sample
sizes and paired disagreements. Zero errors in this suite is a launch gate, not
proof of zero future error.

Before any paid evaluation, set an authorized run cap and anticipated maximum
calls. In production, reserve cost in a durable daily ledger before every provider
request, including relevance, copy, verification, retries, and shadow calls.
Use conservative configured input/output bounds and current pricing; reconcile
actual usage. An ambiguous timeout retains its reservation pending reconciliation.
A per-candidate budget is not a daily spending limit. Exhaustion holds work while
deterministic official-event publication can continue.

For illustration only: 6,000 input and 1,500 output tokens at the quoted rates cost
$0.0009 per call, or $0.90 for 1,000 calls. This is not a candidate/day forecast.
Do not confuse provider latency statistics with this pipeline's end-to-end timing.

W03 runs bounded review-only shadow processing after offline acceptance, then
prepares an exact-config switch and rollback. It does not activate publication
for new Watch contracts automatically.

## 7. Operational Signals and Ownership

| Signal | Definition / denominator | Initial action |
| --- | --- | --- |
| Source usability | Required enrolled sources with a usable accepted snapshot within cadence/grace | Warning on a missed due window; access/parser failure remains typed |
| Coverage gap | Required family/body without qualified source or staffed monitoring | Launch hold or explicit permitted county assignment, not green health |
| Queue age | Now minus earliest eligible unstarted observation, by desk/jurisdiction | Investigate service deficit before increasing caps |
| Policy detection | First persisted observation minus demonstrable public availability | Target p95 <= 60 min for continuously updated critical sources |
| Policy disposition | First cited brief OR explicit blocker minus first discovery | Target <= 2 h; separately measure time to reviewed usable brief |
| Technology detection | First seen minus release/index availability for enrolled sources | Target <= 6 h releases; <= 24 h paper index availability |
| Projection lag | Accepted publication minus available public revision | Retry outbox; alert on lag beyond one normal processing cycle |
| Unique useful yield | Distinct eligible developments attributable to source / checks | Use to prioritize expansion; do not reward duplicate volume |
| Model spend | Actual plus unresolved reservations by UTC day/task/desk | Stop new requests at cap; no silent fallback |

A blocker satisfies a response/disposition promise, not the reader-value promise.
Track blocker age, reason, assigned editor, and resolution separately. Otherwise
the service can appear timely while providing no useful analysis.

Review load needs a named editor and backup across required operating windows.
Initial staffing calculation: observed review-required arrivals/day multiplied by
median and p95 review minutes, plus source enrollment and correction time. Do not
assign a two-hour human completion SLO without confirmed coverage. Urgent unreviewed
provisions remain clearly held; metadata can still be presented if independently
accepted.

Alerts reuse existing durable fingerprints, cooldown, and recovery semantics.
Do not send outage mail for an ordinary evidence rejection or notify on every
unchanged check. Do not expose operational credentials or private diagnostics in
the public coverage page. A quiet week does not prove detection latency.
