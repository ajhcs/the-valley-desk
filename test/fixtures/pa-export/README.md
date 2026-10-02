# Historical PA publisher research fixture

`originalZipPath` is the logical historical archive basename, not a tracked binary.
The unchanged 1,649,358-byte archive transferred through Library is reconstructed
in memory from 51 independent canonical base64 parts in lexical order. Each part
encodes at most 32 KiB raw bytes and has one trailing LF: at most 43,693 text bytes,
2,199,263 text bytes total. `pa-original-transport.json` binds names, order, counts,
sizes and per-part SHA256. These generated transport files are not publisher
responses and do not change acquisition provenance. File mode: `100644`.
Raw archive SHA256:
`f1f5484439dd2f2d22ef9e956169aa296fe1893b97b1625b8d917fed7c13a003`.
Do not repackage or substitute a synthetic ZIP. The full historical original and
capture remain separately preserved; this candidate supersedes packaging only.

Regenerate in a clean fixture directory with existing Node runtime:
`node scripts/package-pa-fixture.mjs <original-archive>`.
The generator requires the pinned raw identity and refuses overwrites. The bounded
stdlib helper rejects invalid names, extra/missing parts, symlinks, oversize files,
noncanonical base64, changed manifests and changed bytes before returning an archive.
Default CI still runs the full original Node/actual workerd and Library assertions.

`receipt.json` and `research-capture-manifest.json` are derived, privacy-minimized
metadata, version `pa-research-public-metadata-1`. They retain public publisher
URLs, raw archive/member hashes and sizes, lexical record derivations, source and
acquisition times, and separately labeled research observations. Private transfer
identifiers, filesystem attributes, host paths and retrieval details are omitted.
The manifest checksum binds the revised repository bytes, not the original private
manifest. Exact private originals remain separately preserved outside this checkout.
The four XML records are unchanged lexical derivations from the original member.
Additional PDF/RSS checksums describe research observations; their response bytes
are not retained in this fixture. `synthetic.ts` labels fabricated envelopes and ZIPs.

The mandatory offline Node/workerd test verifies raw ZIP/member size and checksum,
record derivations, minimized manifest checksum and runtime parity. Missing or
altered evidence fails. Paths resolve beside this README without host storage.

The export at 2026-09-30 19:30:06Z (15:30:06 EDT) predates the separately observed
House final passage at 19:45Z (15:45 EDT), 144–59. No canonical vote response bytes
were retained; that research observation is not source-reviewed evidence and does
not enter accepted Watch facts. Current status, enactment and legal effect remain
unknown. Library transfer/materialization grants no successful upstream source
check, rights/access approval, qualification, activation or publication authority.
The publisher ZIP HTTP403 hold and unknown HTML robots HTTP406 posture remain.
Fixture authorization permits offline testing, not production ingestion.
