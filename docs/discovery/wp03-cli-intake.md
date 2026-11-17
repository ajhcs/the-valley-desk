# WP03 offline intake command

This command assesses explicit local files with the implemented offline signature store.
It does not fetch sources, enroll humans, generate/sign keys or records, import claims
into the catalog, recruit reviewers, grant rights or issue a freeze. WP03 remains
incomplete; the actual manifest has zero real cases and no enrolled human reviewers.

Run with the qualified workspace Node 22 runtime and `tsx/esm`:

```sh
node --import tsx/esm scripts/discovery-reference-intake.mjs \
  --manifest /absolute/path/reference-manifest.json \
  --bundle /absolute/path/signed-records.json \
  --trust-policy /absolute/path/operator-trust-policy.json \
  --expected-policy-sha256 OUT_OF_BAND_LOWERCASE_SHA256 \
  --output /absolute/private-directory/new-summary.json
```

All five arguments are mandatory, exactly once. File paths must be absolute and
normalized. Obtain the expected SHA-256 through a separate trusted operator procedure;
do not take a checksum supplied by the untrusted bundle as authority. It selects and
checks the exact raw policy file bytes. It does not enroll trust, identify the operator,
prove policy freshness or prevent rollback. No environment credentials are read. The
system clock is used for verification; there is no caller clock override. Run with a
sanitized environment and workspace TMPDIR/cache paths as for other discovery checks.

The policy and signed records follow [the signed-intake contract](wp03-signed-intake.md).
They remain distinct files from the manifest and from each other (including inode aliases).
No keys are enrolled by reading a bundle. Actual operator key provenance, permitted
scope delegation, current revision/anti-rollback and revocation snapshot replacement
remain necessary. Cryptographic integrity does not establish human or source truth.

Raw inputs are capped before UTF-8 decoding or JSON parsing: manifest and bundle
16,000,000 bytes each, policy 262,144 bytes. A growing file is read at most cap+1 bytes
and rejected if over cap. Inputs must be regular files; final symlinks, symlink ancestors,
FIFOs/devices, absent files and hardlink aliases among inputs are rejected. Fatal UTF-8
validation precedes strict JSON parsing. Duplicate decoded keys (including escaped
aliases), invalid Unicode/unpaired surrogates, unsafe integers and decimal/exponent or
negative-zero number forms are rejected rather than silently normalized. JSON depth is
limited to 32 and value nodes to 500,000. These narrow number semantics fit manifest
revision/count integers. Raw signed bytes are not normalized for policy checksums.

The output is a new file only. It cannot replace any file, symlink, input or alias.
Its direct parent must already exist, be owned by the current UID and have mode 0700.
Symlink ancestors are rejected. Output ancestors must be owned by root/current UID;
group/other-writable ancestors are rejected before reaching a private current-UID
ancestor. A private ancestor protects nested paths from other Unix identities. This
is a same-operator boundary; another process with the same UID can replace trusted
files or directories and is outside its protection. Do not use an untrusted same-UID
writer as an intake source. Inputs should be stable local snapshots.

The report is written to an exclusive 0600 temporary file in the output directory,
flushed, then atomically linked into the absent destination without overwrite; the
temporary name is removed on success or ordinary error. Concurrent invocations for the
same destination admit one writer. The command does not change process umask. No
report is produced for invalid inputs. A killed process may leave its private temporary
file; ordinary failures remove it. Output is capped at 65,536 bytes before writing.

The JSON report contains status, readiness, counts, finding count, fixed finding
categories, raw manifest/bundle/policy-file SHA-256 digests and trust scope.
These digests bind exact selected files without disclosing their contents. It excludes detailed findings,
identifiers, source text, receipts, labels and held-out history. stdout emits only a
fixed state; stderr emits only `invalid_offline_intake` on invalid input, without file
paths, schema property names or raw errors. Keep even aggregate readiness reports
private; the command creates no public artifact.

| Exit | Meaning |
| --- | --- |
| 0 | `ready_for_accountable_freeze_review`; still not_frozen, no package acceptance |
| 2 | `blocked`; valid intake needs further evidence/review, including bad or absent signatures |
| 3 | `invalid_offline_intake`; bad arguments/files/checksum/JSON/schema or output failure |

The report always has `freezeIssued: false`, `packageAccepted: false` and
`status: not_frozen`. Exit 0 does not accept WP03 or establish evaluation performance.
The actual empty manifest is blocked with zero held-out/recall/audit counts. Review
[the remaining accountable handoff inputs](wp03-intake.md) before freeze review.

Entrypoint checks resolve the invoked filename before comparison; symlink invocation
and script paths containing spaces execute normally. Importing the module alone does
not start intake.
