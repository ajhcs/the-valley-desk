# Datasets pipeline (phase 1)

Builds dataset listings from two sources: accessions in our papers (Europe PMC annotations, classified from PMC full text) and DataCite datasets whose creators carry a regional institution ROR. Python 3 standard library only. Each stage caches to disk and skips finished work.

```sh
export TVD_DATASETS_WORK=/workspace/build/builderbob/tvd-datasets-phase1   # private, mode 0700
export PATH=/workspace/build/builderbob/tvd-datasets-phase1/bin:$PATH        # node -> Node 24, for wrangler
export CLOUDFLARE_ACCOUNT_ID=...   # export runs one read-only SELECT against production D1
PHASE0=/workspace/build/builderbob/tvd-datasets-phase0 python3 -I -B scripts/datasets/run.py
python3 -I -B scripts/datasets/validate.py
```

| Stage | Script | Output in the work directory |
|---|---|---|
| export | `s1_export.py` | `papers.json` (visible publications with a PMCID) |
| annotations | `s2_annotations.py` | `annotations/`, `candidate-mentions.jsonl` |
| fulltext | `s3_fulltext.py` | `fulltext/<PMCID>.json.gz` (text blocks only, gzip) |
| classify | `s4_classify.py` | `mentions-classified.jsonl` (rules v3) |
| repos | `s5_repos.py` | `repo-cache/` (GEO, BioProject, SRA, assembly, dbGaP, EGA, PRIDE, RCSB, EMDB, BioStudies, DataCite) |
| datacite | `s6_datacite.py` | `datacite-inst/` |
| build | `build.py`, `datacite_rules.py` | `datasets.jsonl`, `code-candidates.jsonl`, `spot-check-50.jsonl`, `build-stats.json` |
| validate | `validate.py` | exit status |
| report | `report.py` | `report.md` |

Requests use the generic User-Agent `valley-desk-research/1.0`, at most 3 concurrent requests per host, about 3 per second to NCBI, and backoff on errors and 429s. Caches keep only the fields the listings need; contact names, emails and phone numbers are not stored.

Classification (v3) starts from the phase 0 v2 rules and stays strict: any reuse cue for an accession in a paper wins over a deposit cue. Changes from v2 are listed in `report.md`. Labels: **Verified** when the repository record names a regional submitter or creator (GEO contact institute or city, BioProject or SRA submitter, PRIDE affiliation, dbGaP principal investigator, BioStudies organization, DataCite creator ROR in the registry); otherwise **Listed** through the producing paper.
