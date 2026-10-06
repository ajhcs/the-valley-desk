# Regional DOM release dependency audit - October 6, 2026

GitHub CI132 on PR25 commit e209e82c48b6f4ea6df08bdca77e01941c8d4378 passed tests, mandatory official PDF regressions, production build and local D1 migration/scheduled smoke. Its npm audit gate failed for two high-severity advisories in the existing dependency graph, blocking merge and deployment despite accepted parser integration.

GHSA-wq5f-xc86-pv6w identifies sharp before0.35.5; the fixed package includes the repaired upstream librsvg binaries. GHSA-68fv-2mgg-jv7q identifies source-map-js before1.2.2. References: https://github.com/advisories/GHSA-wq5f-xc86-pv6w and https://github.com/advisories/GHSA-68fv-2mgg-jv7q . Advisory details and published npm package versions were checked against primary sources on October6.

The root package now overrides sharp to exact0.35.5 and source-map-js to exact1.2.2. The lockfile updates only those packages and matching sharp/libvips platform packages. Wrangler remains4.143.1, Miniflare remains5.20260926.1-alpha, and application/parser/Worker/auth/capture code is byte-identical to independently accepted local candidate c79491f8226205f44b987d9f6ff537ecad34ab92.

The audit tool's forced Wrangler downgrade was not used. The current latest Miniflare still pins the affected sharp version, so a scoped patched-version override is required instead of an unrelated toolchain upgrade. New dependency installation and checks occurred in a separate BuilderBob clone with its own node_modules and task cache; existing shared dependencies, accepted checkouts and PA/PR18 remain unchanged. Public npm registry calls do not use paid APIs or change credentials.

Release gates must include npm audit --audit-level=high, full tests, production build, secret scan, Ops smoke and Worker dry run using the patched isolated dependency tree, followed by independent review and GitHub CI. Previously accepted code/rejected integration reports remain immutable. No gate is waived, no capture window/expiry/hold is changed, and no production mutation occurs until the exact successor passes.
