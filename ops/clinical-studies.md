# Clinical studies directory

ClinicalTrials.gov is the authority for the study title, type, conditions, NCT identifier, overall status, facility and facility status. All three registered study types and every reported status are in scope. The site shows local facilities, first posted and last updated dates, and a link to the live registry. It leaves eligibility, contact and treatment information in the registry.

Run the collector with a mode-0700 directory and retain the exact response files. It walks the Pennsylvania and New Jersey location indexes through their advertised unique totals and checks that the registry version stays fixed. It matches reported facility and city to the institution reference where available, recognizes Philadelphia, and otherwise requires a single-county Census ZCTA. County conflicts and unsupported locations do not qualify. The first import file contains only the public field projection. [ClinicalTrials.gov API](https://clinicaltrials.gov/data-api/api) · [Census geography](https://www.census.gov/geographies/reference-files/time-series/geo/relationship-files.2020.html)

```sh
python3 scripts/trials/collect.py "$run_dir"
python3 scripts/trials/collect.py "$run_dir" --replay
python3 ops/load-research.py --studies "$run_dir/clinical-studies.jsonl" > "$run_dir/import.sql"
```

Release the reviewed code and projection through CI. Rehearse migration 0047, the same chunked loader used for publications, and the count refresh against isolated D1. Apply 0047 in a scoped migration directory that excludes the pending discovery migrations. Record a production Time Travel bookmark and start with study visibility off. Import the reviewed bytes in numbered chunks, reconcile counts and sample registry links, then deploy the Worker from checked main.

Enable visibility with `UPDATE study_visibility SET enabled=1 WHERE id=1` and run `ops/research-summary.sql` immediately. Check that study search, a county result, a study detail, API, feed, sitemap and MCP agree. Rollback sets the same row to `0` and refreshes counts before restoring an older Worker.

A later collection takes `--previous` to preserve added dates. Run the loader on new and changed rows. Investigate IDs absent from the new projection against their individual registry record before explicitly suppressing a listing. Use `--study-removals` with a JSON array of exact NCT IDs to suppress reviewed removals, refresh the counts, and confirm HTTP 410 and absence from reads.
