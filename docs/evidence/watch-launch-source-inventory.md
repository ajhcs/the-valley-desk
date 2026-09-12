# Launch Source Preparation Inventory

Prepared 2026-09-12. This is an executable candidate inventory, not qualified or
active coverage. No model calls, production writes, source activation, rights
acceptance or named-reviewer signatures were performed.

## Executable Workflow

```sh
node --import tsx scripts/prepare-watch-source.mjs
node --import tsx scripts/prepare-watch-source.mjs --capture candidate-orca --out /absolute/task/scratch
node --import tsx scripts/prepare-watch-source.mjs --replay /absolute/receipt.json --body /absolute/representation.body
node --import tsx --test test/watch-source-preparation.test.ts
```

The default operation is offline inventory. Capture accepts exactly one fixed
candidate ID, never an arbitrary URL. Output must be an existing task scratch
directory under /mnt/d/tmp/plumbob or this worktree's test/fixtures/watch-launch.
Each capture writes new exclusive files; replay compares exact bytes, configuration
digest and canonical parser output. Run under the normal per-command writer lease.
Add the new test to the integration branch's explicit test list.

Bounds are 500,000 representation bytes, 50 parsed items, 64,000 robots bytes,
one endpoint, no pagination, no redirects, one attempt, ten seconds per request
and a 25-second overall deadline. Robots plus endpoint requests are paced by one
second when both are attempted. There is no broad crawl or credential lookup.
Exact retained bytes are the decoded HTTP response-body bytes exposed by fetch,
not compressed wire bytes. UTF-8 decoding is strict. Snapshot hashes cover those
retained bytes; parser-output hashes cover canonical structured JSON.

All candidate enrollments have state pending and no qualification receipt.
Preparation outputs deliberately lack accepted access/rights decisions or owners.
Repository metadata is only a baseline observation: it does not establish a new
release, local eligibility, an OSS license or safe clinical use.

## Nine Candidates

| Candidate | Evidence or discovery | Observed disposition |
| --- | --- | --- |
| ORCA-CDS | Public repository API for Stephonomon/orca-cds | Captured and parsed one repository baseline; current numeric ID 1308325438 |
| Penn CaPTk | Public repository API for CBICA/CaPTk | Captured and parsed one repository baseline; current numeric ID 128938343 |
| PA House memos | Exact RSS link from official data page | Tool stopped at robots HTTP 406; RSS endpoint was not attempted |
| PA House members | Exact RSS link from official data page | Tool stopped at unavailable robots; RSS endpoint was not attempted |
| DE introduced legislation | Exact RSS link from official RSS page | Tool stopped at robots fetch failure; feed was not attempted |
| NJ downloads | Official legislature downloads page | Robots is Allow:/ plus Host/Sitemap metadata; current preparer conservatively reports unrecognized and does not fetch listing |
| Federal Register CMS | Documented API query, per_page=5 | Current preparer stops for robots review; API request not attempted |
| Philadelphia Council | Official Legislation.aspx listing | 79,156 bytes captured; no installed Watch HTML parser, so no legislative facts extracted |
| Delaware government news | /feed/ is served as RSS according to browser-tool content type | Current preparer stops because robots contains Disallow:/wp-admin; this does not establish a restriction on /feed/ |

Exact configurations and discovery URLs are in fixtures/watch-launch-candidates.ts.
The fixtures contain nine targets rather than filling a quota with guessed URLs.
A CHOP OPEN /feed/ exploration stopped at robots review; because its feed contract
was not independently verified, it was removed from the executable inventory.
The access-attempt receipt remains truthful historical evidence, not source coverage.

Official source references inspected through bounded browser reads:

- PA publishes the exact House memo and member RSS links at https://www.palegis.us/data.
- DE publishes categorized RSS links and warns that General Assembly rollover can
  change links at https://legis.delaware.gov/RSSFeed.
- NJ offers downloads at https://www.njleg.state.nj.us/downloads.
- Federal Register documents its public API at https://www.federalregister.gov/developers/documentation/api/v1.
- GitHub documents unauthenticated public repository reads at https://docs.github.com/en/rest/repos/repos#get-a-repository.
- ORCA's project page identifies CHOP development/evaluation at https://github.com/Stephonomon/orca-cds.
- CaPTk's project page identifies Penn CBICA and separately links restrictive research
  use/license information at https://github.com/CBICA/CaPTk. Public repository visibility
  must not be translated into an OSS badge.

These browser inspections are discovery/access context, not retained qualification
samples. The raw API and Philadelphia captures below are retained samples.

## Retained Samples

ORCA, captured 2026-09-12T17:20:00.494Z, 5,394 bytes:

- Representation SHA-256: 01997e8be3249b56118afe0ca5645cfb345379ad1f971be9f16478c928b2f497
- Parser output SHA-256: e1698332a2beae4911490b9091b91f693f5bdc68069588bad681feb1081b7286

CaPTk, captured 2026-09-12T17:20:14.117Z, 6,227 bytes:

- Representation SHA-256: ae61f8ff1a8458922d0417e81d4b6431128c6a0871f1ea0262d0cd09b30f3ea2
- Parser output SHA-256: ac05dcc1b7640b1d5c77e1c532e5333323b6dc1151053ea997319a006790c644

Philadelphia, captured 2026-09-12T17:20:55.367Z, 79,156 bytes:

- Representation SHA-256: 0d4b78f54d053c52a5e0550abe9536c119f477a63b9e54665ad138d50cae6bad
- Parser output: absent, explicitly unsupported.

All files and access-attempt receipts live under test/fixtures/watch-launch.
Both repository outputs retain source-date-unknown and unverified regional/license
eligibility. A second time-separated sample per source is still required by the
existing qualification contract; two different repositories are not two samples
of either source. Negative/replay tests are engineering evidence, not human approval.

## Coverage Dispositions

fixtures/watch-launch-coverage.ts derives the exact mandatory families and county
list from the original source plan so none silently disappears. Federal, PA, NJ
and DE legislation/regulation/member families remain not-qualified. Federal dockets,
federal members/legislation, PA regulation, NJ regulation/members and DE
regulation/members still need exact family-specific endpoints and parsers.

Philadelphia has a retained listing but no qualified semantic parser or city-notice
coverage. Bucks, Montgomery, Chester, Delaware (PA), Camden, Burlington, Gloucester,
Salem, Atlantic (NJ), and New Castle (DE) each explicitly have no qualified source
or assigned monitoring fallback. All eleven lack a named editor/backup/cadence/evidence
log and municipal enumeration. A county name or state feed does not substitute for
that coverage. These are launch gaps, not claims of a smaller launch scope.

Next high-value expansion: validate the official PA/DE feeds above, implement
Federal Register document/action identity semantics, qualify NJ batch retrieval,
then establish Philadelphia agenda/matter identities. Technology expansion should
add reviewed release endpoints and local-evidence/license bytes for the two stable
repository IDs before adding CHOP D3b/OpenPedCan, Penn CBICA tools, institutional
papers and database channels. Those additional names are investigation targets,
not enrolled endpoints or measured coverage.

## Access Review Boundary

The current preparer uses deliberately conservative robots checks. It treats any
nonempty Disallow or Crawl-delay as review-required and does not implement agent
groups or path specificity. This produces tool holds for unrelated paths and must
not be described as publisher prohibition. A missing/unparseable robots response
is also not a conclusion that an officially documented public API/feed is forbidden.
Public read access and permission to republish excerpts are separate questions.

On 2026-09-12 the tool-review layer rejected a proposed combined patch that would
use documented public-feed/API access modes for PA/DE/Federal Register and narrower
literal robots path matching. The stated concern was unauthorized access-policy
bypass with unverified rights. No part of that patch was applied and no additional
public requests followed the rejection. Root was notified and requested user
approval. This inventory preserves the original behavior; it does not work around
the rejection. A reviewer should resolve that explicit operational boundary using
the official documentation and retained robots evidence, without manufacturing
source qualification or rights acceptance.

## Verification

Six new offline tests and 57 adjacent adapter/collector tests pass: inactive enrollment/coverage contracts, exact real-capture
replay, malformed/private/oversized/invalid-date negatives, conservative access
holds, no-auth/no-redirect/no-retry bounded capture, and CLI inventory/replay.
Tests invoke no live source or model. No production rollout or launch completeness
is claimed by this evidence packet. Application build and 396-file secret scan passed.
