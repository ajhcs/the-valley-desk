#!/usr/bin/env python3
"""Validate the public regional dataset contract without network access."""
import datetime
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit

FIELDS = set('id title summary publisher portal url topic counties granularity time_span update_cadence access license formats api how_to_use added checked'.split())
COUNTIES = {'Bucks', 'Chester', 'Delaware', 'Montgomery', 'Philadelphia', 'Burlington', 'Camden', 'Gloucester', 'Mercer'}
TOPICS = {'Biomedical and life sciences', 'Clinical care', 'Disease research', 'Medical imaging', 'Neuroscience', 'Other science', 'Public health', 'Rehabilitation and accessibility', 'Research data'}
def string(x): return isinstance(x, str) and bool(x.strip()) and '\0' not in x
def url(x):
    if not string(x): return False
    p = urlsplit(x)
    return p.scheme == 'https' and bool(p.hostname) and not p.username and not p.password

def validate_records(records):
    if not isinstance(records, list) or not records: raise ValueError('Expected nonempty regional data array')
    ids = set()
    for r in records:
        if not isinstance(r, dict) or set(r) != FIELDS: raise ValueError('Invalid regional record fields')
        if not string(r['id']) or not re.fullmatch(r'regional:[a-z0-9]+(?:-[a-z0-9]+)*', r['id']) or r['id'] in ids: raise ValueError('Invalid or duplicate regional ID')
        ids.add(r['id'])
        if not all(string(r[k]) for k in ('title','summary','publisher','portal')) or not url(r['url']): raise ValueError('Invalid regional description')
        if r['topic'] not in TOPICS or r['access'] not in {'open','registration','controlled'}: raise ValueError('Invalid topic or access')
        c=r['counties']
        if not isinstance(c,list) or not c or any(not isinstance(x,str) or x not in COUNTIES for x in c) or len(c)!=len(set(c)): raise ValueError('Invalid counties')
        if any(r[k] is not None and not string(r[k]) for k in ('granularity','time_span','update_cadence','license')): raise ValueError('Invalid optional text')
        f=r['formats']
        if f is not None and (not isinstance(f,list) or not f or not all(string(x) for x in f) or len(f)!=len(set(f))): raise ValueError('Invalid formats')
        a=r['api']
        if a is not None and (not isinstance(a,dict) or set(a)!={'url','type'} or not url(a['url']) or not string(a['type'])): raise ValueError('Invalid API')
        h=r['how_to_use']
        if not isinstance(h,dict) or set(h)!={'step','url','caveats','citation'} or not string(h['step']) or not url(h['url']) or not string(h['citation']) or not isinstance(h['caveats'],list) or not all(string(x) for x in h['caveats']) or len(h['caveats'])!=len(set(h['caveats'])): raise ValueError('Invalid instructions')
        for k in ('added','checked'):
            try:
                if not isinstance(r[k],str) or datetime.date.fromisoformat(r[k]).isoformat()!=r[k]: raise ValueError()
            except ValueError: raise ValueError('Invalid date') from None

if __name__ == '__main__':
    try:
        for path in sys.argv[1:] or [str(Path(__file__).with_name('seed.json'))]:
            records=json.loads(Path(path).read_text()); validate_records(records); print(f'{path}: {len(records)} valid records')
    except (ValueError, OSError, KeyError, TypeError) as exc:
        print(str(exc), file=sys.stderr); sys.exit(1)
