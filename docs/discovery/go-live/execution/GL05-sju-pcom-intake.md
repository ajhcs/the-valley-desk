# GL05 SJU and PCOM private source intake

The supplied packages were processed offline as metadata-only, source-reported and unreviewed leads. Publication is not authorized. Original files are retained in place; every file is represented by SHA-256 and byte length in its batch manifest. The PCOM checksum list was verified against all 61 listed files, with the checksum list itself separately hashed. SJU did not supply a checksum list. No supplied research script was executed and no new source request was made.

| Batch | Source | Retained records | Original files hashed |
| --- | --- | ---: | ---: |
| SJU | `sju-healthcare-github-inventory-20261117` | 254 | 7 |
| PCOM | `pcom-github-network-20261116-6UMUyY` | 853 | 62 |

Per-file counts appear in each source assertion's coverage. PCOM includes 29 account snapshot records as well as the five CSV tables. Fifty-one screened-person notes are marked as truncated bounded prefixes, not complete or adjudicated findings; safe citation URLs from the complete notes are retained separately. Row references identify physical CSV start lines and snapshot references identify JSON pointers. These are source-scoped record IDs, not native identity assertions.

SJU repository records include external, historical, teaching and unconfirmed leads. University of the Sciences is a historical Philadelphia predecessor; Lancaster is a separate campus context. PCOM's 582 account-level repository leads and corpus mentions are not counts of PCOM projects. PCOM Philadelphia and Georgia campuses are distinct and Wistar is a partner. Institutional context does not establish individual or project geography, current roles or ownership. Current, historical, external and uncertain relationships must remain qualified during any review.

The selected metadata excludes article, README and biography bodies and contact details; URLs with credentials or unsafe parameters are withheld. The original package may contain such material and remains outside the retained metadata artifacts. Source checks and reported classifications do not establish source truth or present availability.

Local source QA requires both original packages:

```sh
python3 scripts/sanitize-sju-pcom-intakes.py --batch sju --check
python3 scripts/sanitize-sju-pcom-intakes.py --batch pcom --check
python3 -m unittest discover -s test/sourceqa -p test_sju_pcom_intakes.py -v
```

All three checks passed locally. The sanitizer's `--output` accepts only a new absolute directory under `/workspace`, rejects source overlaps, existing paths, traversal and symlink ancestors, and never overwrites a retained output.
