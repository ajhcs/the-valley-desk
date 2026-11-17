"""Build a private preview from a review export and the same native queue.

The preview is deliberately a different schema from the signed directory.
Admission requires the independently reviewed selection used by the public builder.
"""
import argparse
from collections import Counter
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import runpy

PRIVATE_ROOT = Path('/workspace/build/builderbob')
PUBLIC_BASELINE = Path(__file__).resolve().parents[1] / 'src/content/discovery-directory-catalog.json'
REVIEW = runpy.run_path(str(Path(__file__).with_name('serve-discovery-review.py')))
MAX_BYTES = 32 * 1024 * 1024


def unique_keys(items):
    result = dict(items)
    if len(result) != len(items):
        raise ValueError('duplicate-key')
    return result


def read_json(path):
    if not path.is_file():
        raise ValueError('input-file')
    with path.open('rb') as handle:
        data = handle.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise ValueError('input-size')
    return json.loads(data, object_pairs_hook=unique_keys), sha256(data).hexdigest()


def private_path(value):
    path = Path(value)
    if not path.is_absolute() or path == PRIVATE_ROOT or path.resolve() != path or not path.is_relative_to(PRIVATE_ROOT):
        raise ValueError('private-path')
    # Require a private run directory beneath the shared build root.
    run = PRIVATE_ROOT / path.relative_to(PRIVATE_ROOT).parts[0]
    info = run.stat()
    if not run.is_dir() or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError('private-run')
    return path


def queue_index(envelope):
    queue = envelope['result']
    if envelope['ok'] is not True or queue['visibility'] != 'private' or queue['publicationAuthorized'] is not False:
        raise ValueError('private-queue')
    candidates = {}
    for row in queue['candidates']:
        native_id = row['nativeId']
        if native_id in candidates:
            raise ValueError('queue-identity')
        candidates[native_id] = REVIEW['canonical_candidate'](row)
    return candidates


def build_preview(envelope, queue_hash, review, review_hash, baseline, baseline_hash):
    if (review['schemaVersion'] != 1 or review['visibility'] != 'private'
            or review['publicationAuthorized'] is not False or review['queueSha256'] != queue_hash
            or not re.fullmatch(r'[a-f0-9]{64}', review['contextSha256'])):
        raise ValueError('review-binding')
    candidates = queue_index(envelope)
    already_listed = {
        work['nativeIdentity']['nativeId']: work['id']
        for work in baseline['works'] if (work.get('nativeIdentity') or {}).get('provider') == 'github'
    }
    disposition, drafts = {}, []
    for row in review['decisions']:
        native_id = row['nativeId']
        candidate = candidates.get(native_id)
        if (native_id in disposition or candidate is None or candidate['repository'] != row['repository']
                or candidate['originalUrl'] != row['originalUrl'] or type(row['revision']) is not int
                or row['revision'] < 0 or not REVIEW['nonempty'](row['reason'], 1000)):
            raise ValueError('decision-binding')
        criteria = row['criteria']
        state = REVIEW['decide'](criteria)
        if state != row['decision']:
            raise ValueError('decision-state')
        notes = row['evidence']
        refs = row['evidenceRefs']
        if [note['id'] for note in notes] != refs or any(
            note != REVIEW['evidence_row'](native_id, note['locator'], note['fact'], note['observedDate'], note['criteria'])
            for note in notes
        ):
            raise ValueError('evidence-binding')
        evidence = REVIEW['select_evidence']({**candidate, 'evidence': notes}, criteria, refs)
        disposition[native_id] = state
        if state == 'eligible':
            listing = REVIEW['make_listing'](candidate, row['preparedListing'], evidence, prefilled=True)
            if native_id not in already_listed:
                drafts.append({
                    'nativeId': native_id,
                    'repository': row['repository'],
                    'reviewRevision': row['revision'],
                    'criteria': criteria,
                    'reason': row['reason'],
                    'evidence': notes,
                    'listing': listing,
                })
        elif row.get('preparedListing') is not None:
            raise ValueError('listing-disposition')
    counts = {state: 0 for state in ('eligible', 'held', 'rejected')}
    counts.update(Counter(disposition.values()))
    return {
        'schemaVersion': 'discovery-private-admission-preview-v1',
        'visibility': 'private',
        'publicationAuthorized': False,
        'queueSha256': queue_hash,
        'reviewSha256': review_hash,
        'reviewContextSha256': review['contextSha256'],
        'publicBaseline': {
            'version': baseline['version'],
            'sha256': baseline_hash,
            'works': len(baseline['works']),
        },
        'counts': {
            **counts,
            'unreviewed': len(candidates) - len(disposition),
            'alreadyListed': counts['eligible'] - len(drafts),
            'proposed': len(drafts),
        },
        'drafts': sorted(drafts, key=lambda row: int(row['nativeId'])),
    }


def main(args):
    queue_path, decisions_path, output = map(private_path, (args.queue, args.decisions, args.output))
    queue, queue_hash = read_json(queue_path)
    review, review_hash = read_json(decisions_path)
    baseline, baseline_hash = read_json(PUBLIC_BASELINE)
    preview = build_preview(queue, queue_hash, review, review_hash, baseline, baseline_hash)
    encoded = (json.dumps(preview, indent=2, ensure_ascii=False) + '\n').encode()
    with os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600), 'wb') as handle:
        handle.write(encoded)
        handle.flush()
        os.fsync(handle.fileno())
    print(json.dumps(preview['counts']))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--queue', required=True)
    parser.add_argument('--decisions', required=True)
    parser.add_argument('--output', required=True)
    try:
        main(parser.parse_args())
    except (ValueError, OSError, IndexError, TypeError, KeyError) as exc:
        exit(f'admission preview rejected ({type(exc).__name__})')
