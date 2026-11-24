# Regional data release

Each production section requires the owner's explicit approval, including after merge. The commands assume a clean release checkout at the approved commit and its locked dependencies.

## Prepare the release checkout

```bash
export PATH="$(dirname "$(readlink -f /home/builderbob/.local/bin/node-24.22.0)"):$PATH"
export CLOUDFLARE_ACCOUNT_ID=1e5f92087e779df50f3f3546a0eed22e
release_sha=$(git rev-parse HEAD)
release_dir=$(mktemp -d /workspace/tmp/builderbob/tvd-regional-data.XXXXXXXX)
export WRANGLER_LOG_PATH="$release_dir/wrangler.log"
wrangler=(/home/builderbob/.local/bin/node-24.22.0 "$PWD/node_modules/wrangler/bin/wrangler.js")
d1=the-valley-desk

npm run build
"${wrangler[@]}" deploy --config "$PWD/wrangler.jsonc" --dry-run \
  --outdir "$release_dir/bundle" --var "BUILD_SHA:$release_sha"
find dist -type f -print0 | sort -z | xargs -0 sha256sum > "$release_dir/assets.sha256"
sha256sum "$release_dir/bundle/worker.js" > "$release_dir/worker.sha256"
```

## Apply only migration 0052

Capture the current D1 Time Travel bookmark and migration ledger in the release directory. Continue only after confirming the target, prerequisite schema through 0050, and that the scoped pending list contains only `0052_regional_data.sql`. Keep 0041 through 0045 unapplied. Migration 0051 belongs to a separate release.

```bash
"${wrangler[@]}" d1 time-travel info "$d1" --json > "$release_dir/bookmark-before.json"
"${wrangler[@]}" d1 execute "$d1" --remote --json --command \
  "SELECT name FROM d1_migrations WHERE name >= '0040' ORDER BY name" > "$release_dir/migrations-before.json"
mkdir "$release_dir/migrations"
cp wrangler.jsonc "$release_dir/wrangler.jsonc"
cp migrations/0052_regional_data.sql "$release_dir/migrations/"
"${wrangler[@]}" d1 migrations list "$d1" --remote --config "$release_dir/wrangler.jsonc"
"${wrangler[@]}" d1 migrations apply "$d1" --remote --config "$release_dir/wrangler.jsonc"
"${wrangler[@]}" d1 execute "$d1" --remote --json --command \
  "SELECT name FROM d1_migrations WHERE name >= '0040' ORDER BY name"
"${wrangler[@]}" d1 execute "$d1" --remote --json --command \
  "SELECT enabled FROM regional_data_visibility WHERE id=1"
```

The ledger should contain 0052 once and the visibility query should return zero.

## Load the reviewed records while hidden

```bash
python3 -B scripts/regional-data/validate.py
python3 -B ops/load-research.py --regional-data scripts/regional-data/seed.json \
  --respect-removals > "$release_dir/regional-data.sql"
"${wrangler[@]}" d1 execute "$d1" --remote --file "$release_dir/regional-data.sql"
"${wrangler[@]}" d1 execute "$d1" --remote --file ops/research-summary.sql
"${wrangler[@]}" d1 execute "$d1" --remote --json --command \
  "SELECT (SELECT count(*) FROM research_listings WHERE kind='regional-data') AS loaded,
          (SELECT count(*) FROM research_visible WHERE kind='regional-data') AS visible"
```

Check the loaded count against the reviewed seed and retained removals. The visible count should be zero.

## Deploy the approved bundle

Review the live Worker bindings and variables against the approved config before this step.

```bash
sha256sum -c "$release_dir/assets.sha256"
sha256sum -c "$release_dir/worker.sha256"
"${wrangler[@]}" deploy "$release_dir/bundle/worker.js" --config "$PWD/wrangler.jsonc" \
  --no-bundle --keep-vars --var "BUILD_SHA:$release_sha"
curl --fail --silent --show-error https://thevalleydesk.org/api/health
```

## Enable visibility and verify live behavior

Deploying the Worker leaves county and search data unchanged. Load the records into D1 and run `ops/research-summary.sql` after the load and again after changing visibility. Verify live record and search results, plus county, topic, llms.txt, RSS, sitemap and MCP responses.

```bash
"${wrangler[@]}" d1 execute "$d1" --remote --command \
  "UPDATE regional_data_visibility SET enabled=1 WHERE id=1"
"${wrangler[@]}" d1 execute "$d1" --remote --file ops/research-summary.sql
"${wrangler[@]}" d1 execute "$d1" --remote --json --command \
  "SELECT id FROM research_visible WHERE kind='regional-data' ORDER BY added DESC,id LIMIT 24" \
  > "$release_dir/catalog-rows-read.json"
"${wrangler[@]}" d1 execute "$d1" --remote --json --command \
  "SELECT v.id FROM research_visible v JOIN research_facets f ON f.id=v.id
   WHERE v.kind='regional-data' AND f.field='county' AND f.value='philadelphia'
   ORDER BY v.added DESC,v.id LIMIT 24" > "$release_dir/county-rows-read.json"

seq 20 | xargs -n 1 -P 5 sh -c '
  curl --fail --silent --show-error --output /dev/null \
    --write-out "%{http_code} %{time_total}\n" \
    "https://thevalleydesk.org/discover/datasets?kind=regional-data&county=philadelphia"
' regional-data > "$release_dir/catalog-burst.log"
```

Check D1 `meta.rows_read` and the burst responses. Use production telemetry to account for the complete request, including the cache version query and related facets. Local timings do not establish production query cost. To take the catalog offline, set `enabled=0` using the same D1 command and rebuild the summaries.

## Enable freshness in the existing BuilderBob schedule

The existing service runs from `/workspace/build/builderbob/tvd-daily-directory/checkout` at 3:10 a.m. Eastern. Schedule this cutover outside an active run. Follow the existing directory rollout for dependency verification before updating that checkout. The approval must cover both the checkout change and the opt-in state file.

```bash
daily_state=/workspace/build/builderbob/tvd-daily-directory
daily_checkout="$daily_state/checkout"
test -z "$(git -C "$daily_checkout" status --porcelain)"
git -C "$daily_checkout" fetch origin main
git -C "$daily_checkout" merge-base --is-ancestor HEAD "$release_sha"
git -C "$daily_checkout" merge-base --is-ancestor "$release_sha" origin/main
git -C "$daily_checkout" switch --detach "$release_sha"
umask 077
printf '%s\n' '{"enabled":true}' > "$daily_state/regional-data-config.json.next"
mv "$daily_state/regional-data-config.json.next" "$daily_state/regional-data-config.json"
systemctl --user list-timers valley-desk-directory.timer
```

The existing timer will pick up the code and configuration at its next invocation. Inspect the private run receipt and review rows after the first scheduled check.

```bash
"${wrangler[@]}" d1 execute "$d1" --remote --json --command \
  "SELECT id,attempted,checked,publisher_updated,review_reason FROM regional_data_checks ORDER BY id"
```
