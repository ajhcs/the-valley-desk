# Weekly publication updates

After the 2026 backfill is live, seed the weekly cursor to the last complete Europe PMC index date in the verified annual release. Each window contains the next seven provider-index days, including overdue windows after an interruption. The public publication date comes from the earliest supported electronic date and can be earlier. Exact identifier matches against all existing files preserve earlier publication IDs and added dates.

The BuilderBob user timer advances one window at a time. The script gathers Europe PMC candidates, applies the annual affiliation, date, type and identity rules, and checks exact DOI metadata in Crossref. A capped OpenRouter call assigns topics from title, venue and indexed terms when the source signal is unclear. The classifier sees no author, affiliation, byline contact or private hold information. Mechanical eligibility runs first. Held or unclassifiable records stay in the private run. A malformed response or more than 12% Other science blocks the batch. A request with no receipt requires provider reconciliation before a retry.

The script opens a pull request that lists the spot-check IDs. The merge records the spot check. The next poll waits for CI on the exact PR and merge heads, checks the approved file and privately retained delta hashes, captures a D1 bookmark, loads the batch in parts and refreshes stored counts. If a load stops midway, rerun the same batch. The cursor advances only once the data and sample IDs have been verified. A closed PR leaves the cursor in place.

## Install on BuilderBob

Use a private mode-0700 directory at `/workspace/build/builderbob/tvd-weekly-publications`. The service clone and raw receipts live there. Provision the existing verified GeoNames US.zip archive under that state directory as `US.zip`, and the accepted privacy-hold identifiers and their alternates as a private one-identifier-per-line `hold-ids.txt`. Set up a private `openrouter.key` with a provider-set spending limit for this publication job. The script price, payload, record and one-submit limits keep a weekly window below $1.

Clone the reviewed `main` into the state directory’s `checkout` path. Confirm it is clean. Seed the cursor and run the command from the service unit once before enabling the timer. Keep GitHub and Wrangler authentication in their existing credential stores. Use the trusted BuilderBob identity and keep the unattended checkout separate from other worktrees.

Install the reviewed user service and timer with the BuilderBob operator’s agreed scope. Check their next invocation and journal, and verify the first scheduled PR and live batch against the roll-out checks. The timer uses the same script when a spot check or CI is still pending.
