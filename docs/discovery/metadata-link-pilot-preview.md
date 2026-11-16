# Run the metadata-and-link pilot locally

The pilot is a read-only selected collection at `/discover`, backed by
`/api/discovery-pilot`. It is disabled by default. This procedure supplies the
flag to a loopback-only Worker with no database, credentials, cron, email binding,
public route or production configuration. It does not collect sources or deploy.
Use the selected implementation checkout and its qualified Node 22 runtime.

```bash
export PATH=/workspace/build/builderbob/runtimes/node-v22.23.2-linux-x64/bin:/usr/local/bin:/usr/bin:/bin
npm run discovery:pilot:check
npm run build
mkdir -p .discovery-work/pilot-preview/tmp .discovery-work/pilot-preview/cache
python3 - <<'PY'
import json
from pathlib import Path
root = Path.cwd().resolve()
config = {
    'name': 'tvd-metadata-pilot-local',
    'main': str(root / 'worker.js'),
    'compatibility_date': '2026-08-26',
    'compatibility_flags': ['nodejs_compat'],
    'assets': {
        'directory': str(root / 'dist'),
        'binding': 'ASSETS',
        'run_worker_first': True,
    },
    'vars': {
        'PUBLIC_ORIGIN': 'https://thevalleydesk.org',
        'DISCOVERY_PILOT_ENABLED': 'true',
        'WATCH_PUBLIC_ENABLED': 'false',
        'POLICY_BACKGROUND_PUBLIC_ENABLED': 'false',
    },
}
Path('.discovery-work/pilot-preview/wrangler.json').write_text(
    json.dumps(config, indent=2) + '\n'
)
PY
env -i HOME="$HOME" USER=builderbob LOGNAME=builderbob LANG=C.UTF-8 \
  PATH="$PATH" TMPDIR="$PWD/.discovery-work/pilot-preview/tmp" \
  XDG_CACHE_HOME="$PWD/.discovery-work/pilot-preview/cache" \
  XDG_CONFIG_HOME="$PWD/.discovery-work/pilot-preview/cache/config" \
  WRANGLER_SEND_METRICS=false \
  ./node_modules/.bin/wrangler dev \
    --config .discovery-work/pilot-preview/wrangler.json \
    --local --ip 127.0.0.1 --port 4188 \
    --persist-to .discovery-work/pilot-preview/state
```

Open `http://127.0.0.1:4188/discover`. Keep the terminal process running; stop it
with Ctrl-C. Vite alone does not provide this Worker API. The canonical metadata
origin remains the site's HTTPS origin; the preview server itself is loopback.
Use a fresh private config directory without `.dev.vars` or credential files.
Do not enable the flag in `wrangler.jsonc` or invoke deployment for this preview.

## Useful checks

- Search **Naqvi**: one publication, with its author affiliations available
  for inspection. Rockville and Philadelphia affiliations belong to their named
  authors; none is presented as current employment.
- Filter **Repositories**: six records, including two supported outbound
  publication citations. Each citation exposes its commit-pinned repository
  evidence link. Other relationships are withheld.
- Search **CaPTk**, filter **Publications**: the retained repository citation now
  finds the paper and explains that match. Its publication metadata names Penn
  without supplying a city. The UI does not fill that gap from another record.
- Search **Philip Cook**, filter **Publications**: QSIPrep is found through the
  complete 42-author metadata roster. Its query-matched preview shows Philip A.
  Cook; the full author disclosure preserves source order and missing affiliations.
- From a cited-publication or citing-repository section, use **View publication
  metadata** or **View repository metadata** to inspect the related record locally.
  The separate original-source and citation-evidence links retain their targets.
- Sort by source date: repository push, publication and registry modification
  dates retain their own labels. Partial dates retain their precision and sort
  by the start of the stated interval; unknown dates sort last in either direction.
- Search an absent term: a useful empty state appears. Reload or share the URL
  to preserve filters. Reset returns the complete selected collection.
- Expand provenance: inspect the native identifier, source URL, observation
  time, use basis, snapshot digest and field pointers. These are metadata traces,
  not a software/article license or independently measured truth label.
- Disable JavaScript: original-source links remain available in the server's
  noscript list. No external provider is automatically fetched by the pilot.

The existing site shell uses Google Fonts. That font dependency is separate from
source-provider acquisition; independent browser checks record or block it.
Original-source actions are ordinary outbound links. The automated browser
navigation check intercepts its DOI destination and does not fetch an article.

## Updates and qualification

Edit the reviewed selection rather than the generated catalog. Run
`npm run discovery:pilot:build`, independently compare the projection with its
retained source evidence, and run `npm run discovery:pilot:check`. The latter
also runs in the normal discovery test chain and rejects generated drift.
No command in this workflow refreshes the retained source snapshots.

The [active plan](metadata-link-pilot-plan.md), [source basis](metadata-link-pilot-sources.md)
and [independent review](reviews/metadata-link-pilot-astra.md) define scope and
limits. Local package acceptance is distinct from delivered-head CI, which is
tracked on PR30 before the implementation handoff completes. Neither is public
release authorization, benchmark validation or evidence of regional completeness.
