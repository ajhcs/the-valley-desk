# WP03 offline intake CLI — Sol

2026-11-15. Preparation progress only; WP03 remains incomplete. No real cases,
permissions, reviewers or trust enrollment were created. No freeze or acceptance issued.

Added `scripts/discovery-reference-intake.mjs` with explicit manifest, signed bundle,
separately provisioned trust-policy file, mandatory out-of-band expected raw-file
SHA-256 and new output path. It invokes the existing cryptographic store and readiness
APIs. The exact checksum selects policy bytes; it does not prove operator identity,
enrollment, current revision, source truth or rights. No network, environment credentials,
key generation/signing, catalog writes or source acquisition occur in the command.

Input raw-byte bounds precede fatal UTF-8 decoding/strict JSON parsing. The parser
rejects duplicate decoded keys, unsafe/noncanonical numbers, lone surrogates and BOM,
with depth/node budgets. File descriptors use no-follow/nonblocking opens and require
regular files; input symlink ancestors and inode aliases are rejected. Output parent
must be private current-UID 0700; protected ancestry is checked. An exclusive 0600
file is flushed and atomically linked without overwrite, with ordinary-error cleanup.
This protects against other Unix identities, not another dishonest same-UID process.

Reports retain only counts/fixed finding categories, readiness, pinned policy checksum, raw manifest/bundle SHA-256 digests
and trust scope. Labels, raw findings, IDs, paths, schema errors and held-out history
are excluded. stdout/stderr are fixed states. Exit 0 means readiness for accountable
freeze review, 2 means blocked, 3 means invalid. Every published report remains
not_frozen, freezeIssued false, packageAccepted false.

Validation: workspace Node v22.23.2, sanitized environment, original HOME preserved,
TMPDIR/XDG_CACHE_HOME/npm cache scoped to `.discovery-work/wp03-cli-sol/`.
`node --import tsx/esm --test test/discovery-reference-cli.test.ts`: 19 passed, 0 failed.

Subprocess integration tests cover the actual empty inventory; ephemeral signed reviewer
authority and its tampered signature; policy checksum mismatch; decoded/escaped duplicate
keys; lossy numbers; malformed JSON; invalid UTF-8/BOM/lone surrogate; raw-size/depth/node
limits; missing/nonregular/FIFO inputs; symlink parents/files; hardlink aliases and path
collisions; existing outputs and nonprivate parent; fixed error privacy; 0600 summaries;
and a two-process output race admitting exactly one writer with no temporary residue.
Astra found the initial entrypoint guard silently skipped symlink invocation. The guard
now resolves argv[1] with realpath before comparing fileURLToPath(import.meta.url).
Permanent subprocess regressions verify symlink and copied space-containing entrypoints
reject no-argument invocation with exit 3, valid symlink invocation assesses, and an
import alone remains silent with exit 0.
Ephemeral private test keys stay in process memory; only synthetic public records are
written to private scratch. The ready exit-0 path requires a complete permitted corpus
and is not claimed exercised by the real empty inventory.

The CLI was also invoked directly against the unchanged original actual manifest with
an empty bundle and explicitly unenrolled diagnostic policy. It returned exit 2,
`blocked`, not_frozen, zero heldout/recall/audit, no freeze/acceptance. The private report
is `.discovery-work/wp03-cli-sol/actual-report/summary-final.json` (0600). That one-day diagnostic
policy grants no authority and is not evidence of operator enrollment.

| Evidence | SHA-256 |
| --- | --- |
| scripts/discovery-reference-intake.mjs | 1551cb006704abeb0e7992f14e77297a334e1f62c1b753d2ccd273b64c4b5fc2 |
| test/discovery-reference-cli.test.ts | 71018255a9a4394ba3c9e1e1c46ebaf080edef5027089409d4e0fdb58bde907b |
| docs/discovery/wp03-cli-intake.md | 461a94c34ebda8b6a1b99379470572740597965f72e28396a51e8b10baec16d6 |
| .discovery-work/wp03-cli-sol/actual-report/summary-final.json | 919b786466eb701cc7e57ce0943f8a338b466f6c318ac6b6b2dcae5492d29846 |
| .discovery-work/wp03-cli-sol/tests.log | 16d8a6d85e2bcc077b60d3f9fd1f4c6a4b8548d23661e4ca2a92bee5a2914e4d |
