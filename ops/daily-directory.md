# Daily directory updates

The BuilderBob user timer runs at 3:10 a.m. Eastern. The runner refreshes listed
GitHub metadata, searches the retained regional account rosters for new projects,
runs the Europe PMC affiliation and Terra topic pipeline, collects the two-state
ClinicalTrials.gov index and reviews the reader inbox. It sends a guarded D1
import and rebuilds the directory summaries. A code release is needed only when
the Worker or loader changes.

The inbox query reads the record ID, type and link. It does not select emails,
messages or the reader's connection text. GitHub URLs must resolve to a public
repository with independently supported regional account evidence. Registry and
publication suggestions are matched to independently qualified records. Notes
use fixed outcomes or a public listing ID.

## BuilderBob cutover

Use a clean checkout of the reviewed code at
`/workspace/build/builderbob/tvd-daily-directory/checkout` with its locked npm
dependencies. The private state directory uses mode 0700. Provision the existing
GeoNames `US.zip` and the private `hold-ids.txt` from the weekly service there.
The daily cursor inherits the weekly publication watermark on first run.

Run `python3 ops/daily-directory.py STATE --measure` after production has the
reader inbox migration. The result records D1's rows-read metrics for the
project queries, version lookup, visibility, removals, inbox and the first page
of each inventory. Then run `python3 ops/daily-directory.py STATE --plan` to
check the proposed data changes. The service verifies that the live home, county,
project and API responses are using D1 before the first write.

Link the two reviewed unit files to the user unit directory. Cut over the
weekly timer to the daily timer once the production source and inbox are
available and the 5% gate passes. Preserve the existing weekly state and its
cursor.

The runner keeps the D1 Time Travel bookmark and import digest in the run
receipt. A pending import is retried only against the same directory revision,
and a committed load resumes at its checks. The snapshot branch
`data/directory-snapshots` contains public listing projections only. It receives
a fast-forward commit per completed night. No data pull request is opened.

`daily.log` gives one line per date. Failed or stopped runs queue
`notification.txt`. The first three consecutive completed nights also write
`first-three-nights.txt` and queue a one-time report. With a private
`notification-url` file and optional `notification-token` in the state directory,
the user service sends its queued notice to the configured HTTPS endpoint.
Without one it tries a desktop notification and keeps the notice if delivery fails.
