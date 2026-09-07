# Version-bound policy background — local review workflow

This candidate adds local tools, not a new production collector or public route.
Keep the accepted e0d03be Worker running. No migration, baseline import, routing,
credential change, schedule reset, or publication is part of this workflow.

## Extract and review official bytes

From the repository, on the verified development data mount:

```bash
npm run policy:pdf:bootstrap
npm run test:policy-pdf
npm run policy:background:capture -- --output=/mnt/d/tmp/plumbob/NEW-UNUSED-DIRECTORY
```

Python 3 with venv support is required. The bootstrap creates an ignored virtual
environment under node_modules and installs a SHA-256-locked pypdf wheel; it
does not modify system Python. Capture requires a new output directory and
refuses to overwrite prior evidence. It fetches the three official bill pages,
parses their selected printer records, and fetches only HTTPS official-host
PDFs. Redirects, response statuses, timing, original bytes, page hashes, and
literal page-linked passages are retained. Limits: 20 seconds per HTTP fetch,
4 redirects, 5 MB/PDF, 500 pages, 32,000 characters/page, 2 million characters
total and 60 seconds per extractor process. No arbitrary host is followed.

`background.md` is a reviewer-readable baseline, with latest action **as observed**,
designated official action history, separate text-version dates, prior printers,
official synopsis, and page-linked excerpts. It is not a newly dated news article.
Full page text and all matching passages are in the per-bill extraction JSON.
The first eight keyword excerpts shown in Markdown are not complete provisions.
No model is called; no claim about applicability or operative law is inferred.

Fail closed for mismatched bill/session/printer/PDF headers, missing action dates,
malformed or encrypted PDFs, image-only pages, page errors and bounds. Partially
extractable documents remain partial; their readable pages do not prove complete
coverage. SB1113's Session of 2026 header is valid within session 2025–2026, but
2023 would not be. Prior-printer numbers in amended PDF headers remain history.

Engineering owner: Knox. Reviewers must inspect the official PDF's amendment
markup before interpreting a passage as a proposed current provision. Even a
complete extraction retains `proposed-text-not-operative-law` and
`amendment-markup-requires-review` interpretation holds. This is not OCR or a
trusted extraction service: an arbitrary operator-supplied binding JSON is not
authenticated provenance. Use the capture receipt plus retained HTML/PDF hashes.

## Prospective timing, without rewriting history

The SELECT-only contract is `docs/evidence/policy-prospective-timing.sql`.
An authorized read-only operator may export it through the documented Wrangler
session path. Keep the original result, observation start/end, public build SHA,
query checksum and D1 metadata in a restricted evidence directory. No collection
invocation is needed. Do not store credentials.

```bash
node --import tsx/esm scripts/report-policy-timing.mjs query.json BUILD-START-UTC OBSERVATION-UTC
```

An optional fourth argument supplies reviewer-qualified evidence: a JSON object
mapping durable development IDs to supporting official evidence links. A row's
new first-seen time alone does not establish genuinely new legislative substance.
Without that qualification, new rows remain visible but excluded from acceptance.
Do not qualify slug repairs, changed page hashes, or rediscovered old actions.

The SQL binds the durable version's first_seen_at to the exact bill, session,
printer, stage and development date; only the actual current editorial fingerprint
can supply its milestone. Earlier versions cannot borrow later dispositions.
Current discovery/relevance fields are separately named, not attributed to a
historical version's processing attempt. Filtered and unadmitted records are not
automatically actionable failures. Unsupported or absent milestones remain
unresolved; completed durations and unresolved ages are separate fields.

Preserve the historical 8239.929-second (2h17m20s rounded) miss. Changed slug
milestones are not the original disposition time and must not overwrite it.
Date-only action dates cannot prove precise public availability; the tool does
not claim the one-hour detection target from those dates. An empty cohort or one
successful observation does not establish sustained two-hour timeliness.

## Still unfinished; no deployment requested for this local tool candidate

- Durable production PDF artifact/page storage bound to policy_versions and an
  authenticated extraction receipt; feeding these pages into relevance/editorial
  processing with explicit evidence selection and truncation accounting.
- Review of amendment markup and complete, version-bound provision grouping
  across page boundaries. Literal keyword excerpts do not complete that task.
- A reader-facing policy background surface and authenticated reviewer evidence
  view backed by durable records. The Markdown dossier is a local presentation,
  not a live watchlist. No baseline manifest was imported.
- Prospective, genuinely new developments observed across enough natural cycles
  to establish sustained timeliness. No timestamp resets or new monitor here.

Gate and CI now include mandatory captured-PDF byte tests in addition to existing
repository tests, smoke, one build and security checks. A passed local gate
qualifies these local tools only, not the unfinished production capabilities.
