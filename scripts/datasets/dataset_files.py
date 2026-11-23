"""Repository file evidence for DOI datasets; never downloads file payloads.

The cache stores one JSON response per DOI. Fetch serially to remain well below
three simultaneous requests to each host. Unavailable or incomplete evidence
is a hold, not evidence that a data file exists.
"""
import argparse
import hashlib
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

UA = 'valley-desk-research/1.0'
RATE_LIMIT_RETRY_AFTER = None
DATA_EXT = re.compile(r'\.(?:csv|tsv|xls|xlsx|ods|parquet|feather|jsonl?|xml|rdf|nt|ttl|h5|hdf5|h5ad|loom|rds|rda|rdata|sav|dta|sas7bdat|mat|npy|npz|pkl|pickle|sqlite|db|sql|vcf|bcf|bam|sam|cram|fastq|fq|fasta|fa|bed|bim|fam|bgen|gff|gtf|wig|bw|bigwig|nii|dcm|dicom|nrrd|mha|mhd|tif|tiff|png|jpg|jpeg|bmp|ome|svs|nd2|czi|avi|mp4|wav|edf|bdf|set|fif|zip|tar|tgz|gz|bz2|xz|7z|rar|zarr|tar\.gz)$', re.I)
DOCUMENT = re.compile(r'\.(?:pdf|docx?|pptx?|txt|md|rtf|html?)$', re.I)

def cache_path(cache_dir, doi):
    return Path(cache_dir) / (hashlib.sha256(doi.lower().removeprefix('doi:').encode()).hexdigest() + '.json')

def concrete(names):
    return [n for n in names if isinstance(n, str) and DATA_EXT.search(n.strip()) and not DOCUMENT.search(n.strip())]

def file_decision(doi, metadata=None, cache_dir=None):
    """Return a conservative decision using complete repository file evidence.

    Metadata formats are used only after access denial, never to override a
    missing/empty manifest. Unsupported hosts are outside this file check.
    """
    if not api_url(doi):
        prefix = doi.lower().removeprefix('doi:').split('/')[0]
        return {'status': 'hold' if prefix in ('10.5281', '10.5061', '10.6084', '10.25452', '10.17632') else 'not_applicable', 'reason': 'unsupported DOI shape or repository'}
    path = cache_path(cache_dir, doi) if cache_dir else None
    if not path or not path.exists():
        return {'status': 'hold', 'reason': 'file manifest not cached'}
    obj = json.loads(path.read_text())
    state = obj.get('state')
    names = obj.get('files') or []
    hits = concrete(names)
    if state == 'complete' and hits:
        return {'status': 'keep', 'reason': 'repository file manifest contains data', 'files': hits}
    if state in ('denied', 'forbidden'):
        meta = metadata or {}
        title = meta.get('title') or ''
        descriptions = meta.get('descriptions') or []
        if isinstance(descriptions, str): descriptions = [descriptions]
        narrative = ' '.join([title] + [d for d in descriptions if isinstance(d, str)])
        # Specific measured material or named data files, never a generic format alone.
        evidence = re.search(r"\b(?:rna[- ]seq(?:uencing)? reads|sequencing reads|gene expression (?:measurements|profiles|counts)|(?:patient|participant|clinical|survey) (?:measurements|responses|records)|microscopy images|(?:mri|fmri|ct) (?:images|scans)|electrophysiolog(?:y|ical) recordings|mass spectrometr(?:y|ic) (?:measurements|spectra)|[\w.-]+\.(?:csv|tsv|xlsx?|fastq|bam|vcf|h5ad|nii|parquet))\b", narrative, re.I)
        if evidence:
            return {'status': 'keep', 'reason': 'repository denied API; metadata describes concrete data content', 'evidence': evidence.group(0)}
    return {'status': 'hold', 'reason': 'repository file evidence: ' + str(state or 'invalid')}

def api_url(doi):
    d = doi.lower().removeprefix('doi:')
    m = re.fullmatch(r'10\.5281/zenodo\.(\d+)', d)
    if m: return 'https://zenodo.org/api/records/' + m.group(1)
    if d.startswith('10.5061/dryad.'): return 'https://datadryad.org/api/v2/datasets/' + urllib.parse.quote('doi:' + d, safe='')
    m = re.fullmatch(r'10\.(?:6084|25452)/m9\.figshare\.(\d+)(?:\.v(\d+))?', d)
    if m: return 'https://api.figshare.com/v2/articles/' + m.group(1) + ('/versions/' + m.group(2) if m.group(2) else '')
    m = re.fullmatch(r'10\.17632/([a-z0-9]+)(?:\.(\d+))?', d)
    if m: return 'https://api.mendeley.com/datasets/' + m.group(1) + '?' + (('version=' + m.group(2) + '&') if m.group(2) else '') + 'fields=files'
    return None

def get(url):
    global RATE_LIMIT_RETRY_AFTER
    RATE_LIMIT_RETRY_AFTER = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/vnd.mendeley-public-dataset.1+json' if 'api.mendeley.com' in url else 'application/json'})
            with urllib.request.urlopen(req, timeout=25) as r:
                return r.status, json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                RATE_LIMIT_RETRY_AFTER = e.headers.get('Retry-After')
            if e.code in (500, 502, 503, 504) and attempt < 2:
                time.sleep(2 ** attempt); continue
            return e.code, None
        except (OSError, ValueError):
            if attempt < 2: time.sleep(2 ** attempt); continue
            return 0, None
    return 0, None

def fetch(doi):
    url = api_url(doi)
    if not url: return {'doi': doi, 'state': 'unsupported', 'files': []}
    status, obj = get(url)
    retry_after = RATE_LIMIT_RETRY_AFTER
    if status == 404 and 'zenodo.org/api/records/' in url:
        concept = url.rsplit('/', 1)[-1]
        lookup = 'https://zenodo.org/api/records/?' + urllib.parse.urlencode({'q': 'conceptrecid:' + concept, 'sort': 'mostrecent', 'size': 1})
        lookup_status, result = get(lookup)
        retry_after = RATE_LIMIT_RETRY_AFTER
        hits = ((result or {}).get('hits') or {}).get('hits') or [] if isinstance(result, dict) else []
        if lookup_status == 200 and hits and str(hits[0].get('conceptrecid')) == concept:
            url, status, obj = lookup, 200, hits[0]
        elif lookup_status != 200:
            url, status, obj = lookup, lookup_status, None
    if status != 200:
        return {'doi': doi, 'url': url, 'http': status, 'retry_after': retry_after, 'state': 'denied' if status == 401 else 'forbidden' if status == 403 else 'missing' if status in (404, 410) else 'error', 'files': []}
    if 'datadryad.org' in url:
        link = ((obj.get('_links') or {}).get('stash:version') or {}).get('href')
        if not link: return {'doi': doi, 'url': url, 'state': 'incomplete', 'files': []}
        url = urllib.parse.urljoin('https://datadryad.org', link.rstrip('/') + '/files')
        status, obj = get(url)
        retry_after = RATE_LIMIT_RETRY_AFTER
        if status != 200: return {'doi': doi, 'url': url, 'http': status, 'retry_after': retry_after, 'state': 'denied' if status == 401 else 'forbidden' if status == 403 else 'missing' if status in (404,410) else 'error', 'files': []}
        files = (obj.get('_embedded') or {}).get('stash:files')
        # A paginated list is not a complete manifest.
        if (obj.get('_links') or {}).get('next') or (isinstance(files, list) and obj.get('total', len(files)) != len(files)): return {'doi': doi, 'url': url, 'state': 'incomplete', 'files': []}
    elif isinstance(obj, list): files = obj
    else: files = obj.get('files') if isinstance(obj, dict) else None
    if not isinstance(files, list): return {'doi': doi, 'url': url, 'state': 'incomplete', 'files': []}
    names = [f.get('key') or f.get('name') or f.get('path') for f in files if isinstance(f, dict)]
    return {'doi': doi, 'url': url, 'state': 'complete', 'files': [n for n in names if n]}

def main():
    p = argparse.ArgumentParser(); p.add_argument('--input', required=True, help='newline-separated DOI list'); p.add_argument('--cache', required=True); p.add_argument('--retry-errors', action='store_true'); args = p.parse_args()
    root = Path(args.cache); root.mkdir(parents=True, exist_ok=True, mode=0o700)
    for doi in dict.fromkeys(x.strip().lower().removeprefix('doi:') for x in Path(args.input).read_text().splitlines() if x.strip()):
        if not api_url(doi): continue
        dest = cache_path(root, doi)
        if dest.exists() and not (args.retry_errors and json.loads(dest.read_text()).get('state') in ('error', 'incomplete')): continue
        result = fetch(doi)
        tmp = dest.with_name(dest.name + '.' + str(os.getpid()) + '.tmp'); tmp.write_text(json.dumps(result, sort_keys=True) + '\n'); tmp.chmod(0o600); tmp.replace(dest)
        print(doi, result['state'], len(result['files']), flush=True)
        if result.get('http') == 429:
            print('Rate limited; stop this queue and retry later. Retry-After:', result.get('retry_after'), flush=True)
            break

if __name__ == '__main__': main()
