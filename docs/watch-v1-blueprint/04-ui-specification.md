# UI and Interaction Specification

## 1. Design Intent

Build a publication with practical reference tools, not a monitoring dashboard
that overwhelms the successful News experience. Reuse IBM Plex, `FoldMark`, the
current wordmark, restrained rules, and existing spacing/interaction conventions.
Use white surfaces and readable neutral text; brand ink, sky, event gold, and
small semantic accents should not turn the page into one dominant color field.

Page sections are unframed layouts or full-width bands. Repeated result rows may
have dividers; do not place cards inside cards. No giant hero, dashboard KPI cards,
marketing explanation, radar chart, or decorative illustration is required.
Headings inside contextual columns remain small enough to scan.

The [offline mockup](mockups/index.html) illustrates hierarchy and interactions,
not an alternate application architecture. It uses the existing mark asset and
local font fallbacks. Production must inherit the application's IBM Plex loading,
not copy a second font-loading implementation from the mockup.

## 2. Routes and Information Architecture

```text
Home
  lead + current News + Events
  compact Policy Watch and Technology Watch previews
News
  filters + chronological results + existing story permalinks
Events
  Chapter Radar + Next Up + filters + calendar export/subscription
Policy Watch
  Latest Changes / Active Measures / Hearings & Deadlines / Representatives
  lasting dossier -> reviewed scope -> responsible people -> sources/history
Technology Watch
  Latest Releases / Technology Directory / Papers
  lasting profile -> workflow/access -> evidence/license -> developments
Voices archive
  existing routes, omitted from primary navigation
Coverage
  named source families/bodies, as-of, known gaps, contact for corrections
```

Keep navigation predictable on detail pages. A technology development links back
to its resource profile; a policy story links to its instrument dossier. A dossier
links to the existing canonical story instead of reproducing it as another article.

## 3. Policy Watch List

Desktop hierarchy:

```text
THE VALLEY DESK    News    Events    Policy Watch    Technology Watch
------------------------------------------------------------------
POLICY WATCH                                        Saved subjects
Latest Changes | Active Measures | Hearings & Deadlines | Representatives
Jurisdiction   County/body   Topic   Stage   Search
------------------------------------------------------------------
MAIN RESULTS                                      NEXT KNOWN DATES
PA / official instrument + session                 Type + date
Title                                             Instrument link
Latest action + responsible chamber/body           Official source
Reviewed applicability or explicit review hold
Change date | Source | Save                         COVERAGE
------------------------------------------------  Federal / PA / NJ / DE
NJ / next result ...                               Named local scope
```

Each row must answer: what is it, what changed, where does it apply, what is its
current evidenced status, and what can the reader inspect next? Display a short
accepted scope sentence, not an invented impact score.

Filters are URL-backed. State filters include Federal, PA, NJ, DE, and Local.
Choosing Local reveals county/body filters. Changing the jurisdiction clears an
incompatible county and cursor. Preserve other applicable filters. Date range
validation rejects an end before start. Search submits on Enter or an explicit
search control; use a short debounce only if it does not cause repeated announcements.

Views have different data semantics:

| View | Results | Default order |
| --- | --- | --- |
| Latest Changes | Accepted material developments | Source date with visible precision |
| Active Measures | Accepted instruments with supported active lifecycle | Next confirmed action date, then recent substantive development; unknown dates last |
| Hearings & Deadlines | Hearings, comment deadlines, effective dates, compliance dates | Date, with explicit event type and timezone/precision |
| Representatives | Official offices and verified memberships | Jurisdiction, body, district, person |

Do not show a progress bar that implies legislation only moves forward. Native
status text, a normalized explanatory label, and a timeline are more accurate.
Status is text plus optional color; color alone cannot distinguish a proposed
rule from enacted law.

## 4. Policy Dossier

Required sections in reading order:

1. Instrument identity, title, session, jurisdiction, source-native status, and
   separate legal-effect label. Include one primary official-document link.
2. What changed: concise accepted change description with source date/precision.
3. Applicability: regulated entity types, geographic scope, effective/compliance
   conditions, definitions/exceptions, and explicit unknowns. A synopsis-only item
   says its provision-level interpretation is not yet reviewed.
4. Responsible people: sponsors/co-sponsors and responsible committee; links to
   directory entries. Separately label the reader's selected representatives.
5. Dates: hearings, comment close, effective, compliance, and other deadlines.
   Do not collapse them into one unlabeled "due date."
6. Timeline: action, source, chamber/body, version, date precision. Old actions
   remain accessible; amendments do not overwrite the original introduction.
7. Source documents and reviewed interpretation: version label, verification
   date, excerpt/page reference, source link, and review state. Advocacy has its
   own attributed section, not mixed into the official-text block.
8. Related News and relevant Events, based on explicit relation IDs.

A changed PDF produces a visible current-review hold in the affected section.
The prior interpretation can remain in a labeled historical revision, but not as
the current applicability answer. Do not expose private reviewer notes; use a
curated public hold reason such as "Amended definitions await review."

## 5. Representatives Flow

Entry -> choose jurisdiction -> choose chamber/district or municipality -> see
current accepted memberships -> official contact/profile links -> related measures.

Provide an official address-lookup link adjacent to district selection. V1 does
not accept/store addresses or infer a district from ZIP/county. The chosen
district is a reader preference stored locally; it is not verified residency.
The wording should be "Selected district," not "We found your representatives."

Display name, office/chamber, district or at-large designation, party when sourced,
committee roles, official contact page, and roster as-of. No scraped private phone
numbers. If current membership cannot be verified, show the office and its data
state; do not invent a person or assert vacancy from missing data.

Historical sponsor panels show the role at the action date. A current official's
name change, departure, or successor must not rewrite historical sponsorship.
For NJ Assembly, display all verified members of the district. For Philadelphia,
district and at-large representation are separate categories.

## 6. Technology Watch List

```text
TECHNOLOGY WATCH
Latest Releases | Technology Directory | Papers
Organization   Use case   Resource type   License   Search
------------------------------------------------------------------
Project / artifact name                             RELATIONSHIP
Plain-language purpose                             Built here / Used here
Documented material change                         Named local institution
Type | release/publication date | license           Code / Docs / Paper
```

Directory sorts by name or accepted filter-specific criteria. Latest shows only
verified material developments, not first ingestion. Papers show publication type,
authors/institutions where verified, preprint status, publication date, and linked
code/data availability without implying code exists.

OSS is a prominent license filter, not the default classification for GitHub.
Source-available/restricted, proprietary, unknown, and not-applicable are distinct.
Keep license class independent of research evidence and deployment status.

## 7. Technology Profile and ORCA Example

The profile answers these reader tasks without requiring the reader to open five
external pages first:

| Block | Fields / state |
| --- | --- |
| Purpose | Problem, intended user, resource type, supported scope |
| Local connection | Verified entity, relationship type, artifact-specific source, as-of |
| Workflow | Inputs -> processing/integration -> outputs; what the system does not do |
| Access and setup | Prerequisites, access restrictions, version-pinned guide, demo/example data, maintainer-documented vs desk-tested |
| Evidence | Paper/version, evaluation setting, limitations, preprint label, source-reported pilot/use |
| License | Separate code/data/weights terms, identifier/custom label, checked version and primary license link |
| Maintenance | Latest verified release, archived status if source-reported, docs/version checked; quiet repository is not automatically abandoned |
| Related coverage | Releases, papers, policy context, existing News/Event links |

ORCA is a reference-access tool associated with CHOP. The researched workflow is
an institutional order-set extract, conversion to structured files, and an offline
viewer; the demo uses fabricated content. The profile must distinguish reference
access from live ordering and identify institution-specific data/configuration
work. No release date or desk-tested deployment was verified in this task.
[Repository](https://github.com/Stephonomon/orca-cds)

The reviewed license is restricted/source-available, not permissive OSS; clinical
use requires separate authorization under its terms. The UI should prominently
link the actual license and say access conditions require review, not offer a
one-click clinical deployment instruction. Recheck at the pinned revision before
publication. [License](https://github.com/Stephonomon/orca-cds/blob/main/LICENSE.md)

The bibliographic record links the paper and regional affiliations; this task did
not evaluate the full study. Do not fabricate effectiveness metrics, readiness,
security assurance, or clinical approval. [Paper record](https://pubmed.ncbi.nlm.nih.gov/40419254/)

Correct the existing registry's creator/platform conflation: CHOP-related creation,
Epic as a supporting environment, repository ownership, and rights holder are
different fields. Retain the old product ID as an alias when migrating relations.

## 8. Focused News and Events Improvements

### News

Keep the lead selection, story layout, chronological emphasis, concise impact,
and source links. Add organization/topic/date filters and bounded search. Add
explicit "Previous development" / "Policy record" / "Technology profile" links
when a relation exists. Distinguish original publication, substantive update,
verification, and correction. Re-hydrating a source never bumps a story to the top.

Home keeps News and Events as its core. Replace the Voices home rail with two
compact Watch previews, each no more than three current accepted developments.
If a Watch has no current developments, link its baseline directory without
manufacturing recency. Do not allow automated content to set `featured: true`.

### Events

Preserve Chapter Radar, Next Up, why-attend copy, people/organization context, and
existing Google Calendar actions. Add date/county/topic/host/format filters; show
source-confirmed price and registration deadline only when available. "Unknown"
and "Free" are not interchangeable. Registration closed is not canceled.

Use a qualified calendar library. Proposed candidate is `ical-generator` for
serialization, with `ical.js` as an independent parser in tests; prove the selected
versions work in Workers before adopting. Do not hand-roll escaping/folding.
[Generator](https://github.com/sebbo2002/ical-generator),
[parser](https://github.com/kewisch/ical.js)

Calendar behavior:

- Stable `UID` derived from the canonical event ID and publication domain.
- Source-supported timed events serialize UTC instants; display in the event's
  sourced timezone. Never parse an ambiguous local wall time without a timezone.
- All-day events use DATE values and exclusive end dates. Existing `EventItem`
  requires instants, so add a versioned date-only representation before publishing
  true all-day events. Do not fake `startsAt` at midnight to satisfy v1.
- `SEQUENCE` changes only for material calendar updates; `DTSTAMP` is a stored
  revision time, not a new value on every GET. Source-confirmed cancellation
  retains UID and uses `STATUS:CANCELLED` in the subscription projection.
- Subscription polling is not an iTIP meeting invitation. Do not claim that a
  downloaded file can recall a user's previously imported event or that every
  calendar refreshes immediately.
- Retain canceled/rescheduled entries in the subscription for a proposed 90-day
  reconciliation window; completed/canceled HTML permalinks remain available.
- Output `text/calendar; charset=utf-8`, valid CRLF/escaping/folding, safe
  filenames, bounded content, stable ETag, and actual source URLs.

Test spring/fall `America/New_York` DST, an unknown end time, all-day exclusive
end, commas/semicolons/newlines/non-ASCII, duplicate sources, rescheduling, and
cancellation with an independent parser. [iCalendar standard](https://www.rfc-editor.org/rfc/rfc5545.html)

## 9. Component Contracts

| Component | Input / behavior | Do not do |
| --- | --- | --- |
| `WatchViewNav` | URL-backed views with active semantics | Add `role=tab` to links without implementing the full tab keyboard pattern |
| `WatchFilters` | Validated search state, count, reset; dependent filter clearing | Maintain unrelated local copies of URL state |
| `PolicyRow` | Accepted public summary, source date, stage, links | Read raw model output directly |
| `TechnologyRow` | Accepted purpose, relationship, license, development/date | Use popularity as eligibility or readiness |
| `EvidenceDisclosure` | Accepted excerpt/source/version; native disclosure where suitable | Fetch private review records from the browser |
| `RepresentativeList` | Office/membership records at a declared date | Assume a single member per district |
| `SavedSubjectControl` | Stable subject ID, local-storage preference, accessible pressed/checked state | Store evidence, tokens, addresses, or subscription claims |
| `DataStateNotice` | Loading/empty/stale/error distinctions | Treat network failure as "No results" |
| `WatchPager` | Cursor history and normalized filter state | Generate arbitrary offset pages across a changing dataset |

Illustrative React state pattern; adapt navigation to the installed TanStack API:

```tsx
function SearchField({ value, onSubmit }: {
  value: string;
  onSubmit: (q: string) => void;
}) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);
  return <form onSubmit={(event) => {
    event.preventDefault();
    onSubmit(draft.trim()); // Parent replaces filters and clears the cursor.
  }}>
    <label htmlFor="watch-search">Search</label>
    <input id="watch-search" value={draft} maxLength={120}
      onChange={(event) => setDraft(event.target.value)} />
    <button type="submit">Search</button>
  </form>;
}
```

This sketch is explanatory, not a compiled production component. The executable
examples live separately. Use existing icon conventions; where none exist,
qualify `lucide-react` for save/external-link/calendar/filter controls. Every
icon-only action has an accessible name and a hover/focus tooltip. Clear commands
can use text; binary settings use native checkbox/toggle semantics.

## 10. State and Accessibility Matrix

| State | Reader sees | Required behavior |
| --- | --- | --- |
| Initial load | Stable row placeholders or reserved content area | No layout jump; `aria-busy` on result region |
| Valid empty | No results for current filters; visible reset | Controls remain usable; no outage wording |
| No enrolled coverage | Scope-specific coverage gap | Do not imply no policies exist |
| Stale accepted data | Actual as-of and brief stale notice | Sources and existing content remain accessible |
| API error, no fallback | Unavailable message with retry | Preserve filters; do not cache as a valid empty response |
| Evidence changed | Current reviewed block held; old revision labeled historical | No stale approval inheritance |
| Unknown date/license | Explicit unknown with reason/source link | No invented badge or sortable instant |
| Long title/name | Natural wrapping within row | No ellipsis hiding the only identifying text |
| Saved storage unavailable | Control still works for session or explains failure | No uncaught localStorage exception |
| Filtered deep link | Same selected values after reload/back | Cursor cleared only when filters change |
| Retraction | Current delivery tombstone/correction behavior | Older cursor cannot restore withdrawn public content |

Responsive acceptance: 320, 390, 768, and 1440 CSS pixels; also desktop browser
zoom at 200%. Filters wrap or use native menus; page itself must not horizontally
scroll. Context columns follow main content on small screens. Prefer a two-row
mobile primary nav over tiny text or inaccessible overflow. Use stable icon sizes,
grid tracks with `minmax(0, 1fr)`, and `overflow-wrap` for long source titles.

Keyboard: visible focus, skip link, logical heading order, labeled controls,
focus restored after dialog close if any, and results announced once per completed
filter change. Use native links for navigation and native disclosure for source
details. Save buttons expose pressed state. Do not make entire rows clickable
containers with nested competing actions. Honor reduced motion and the existing
single-session fold behavior. Do not scale font size with viewport width.

Task-based acceptance: a representative reader can find applicability and next
date, find official representatives for a selected district, or explain a
technology's purpose/local connection/access prerequisites within 30 seconds.
Record task wording, participant count, successes, and confusion. The target is
a usability hypothesis to test, not a result claimed by the mockup.
