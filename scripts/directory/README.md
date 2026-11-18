# Public directory projection

The Worker reads `src/content/public-directory-projects.json`. The signed discovery catalog has its own build and check commands.

Build from a frozen snapshot with Python 3 and the repository's Node dependencies installed. Use an existing mode-0700 directory outside the checkout for private artifacts.

```sh
npm run directory:build -- --inputs "$snapshot" --review-dir "$review"
npm run directory:check
```

The input directory contains `inventory.sqlite`, `research-network.json`, `qualification-queue.json`, `catalog.json` (the frozen signed catalog), and the retained roster exports under `rosters/`. The `native/` directory contains the optional native metadata, README and fork comparisons from the same snapshot. The `prior/` directory holds retained rechecks, source notes and `release-sources/led.json` for the manually added launch repository. SQLite inputs are opened read-only. Capture dates and source files must be retained with the snapshot. Builds make no network requests.

Reviewed changes are keyed by decimal repository ID in `overrides.json`. Each item has `field`, `value`, `source`, `date` and `author`. Use `record` as the field for a reviewed addition, with all required fields and its actual addition date in the value. Additional files can be supplied in precedence order with `--private-overrides`. Keep evidence quotes, delist reasons and decisions inside the review directory. The private files use the same shape and may also carry a `quote` of up to 300 characters. A `delist` entry requires a reason and belongs in a private file.

The build validates the candidate before replacing the public file. It compares the count with the existing output, or with the file supplied by `--baseline`. Use `--removals` to supply an available local removal snapshot as a JSON array of GitHub IDs. The build also passes its effective decline IDs. The standalone check can run in CI without inventory access and accepts `--baseline`, `--decline` and `--removals` when these inputs are available.

During the launch audit, `--permit-launch-truncation` permits only the inherited purpose strings pinned by ID and SHA-256. An ordinary check rejects every truncated purpose. Remove the exception after reviewing those records. `--launch-format --output "$review/launch-reproduction.json"` emits the historical bytes for comparison in the private review directory.
