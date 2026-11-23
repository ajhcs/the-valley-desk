"""Source-grounded matching for a repository's actual submitter.

Callers must supply only a field that the repository identifies as a submitter
or contact. A paper affiliation, PI, creator, or unqualified organization is
not evidence of who deposited a dataset. Each call represents one person's or
organization's field, so location cannot leak between unrelated contributors.
"""
import re
import unicodedata

from common import COUNTIES, SKIP_OUTSIDE, registry


def _normalize(value):
    value = unicodedata.normalize('NFKC', value or '').casefold()
    value = value.replace('’', "'")
    return re.sub(r'\s+', ' ', value).strip()


def _contains(text, phrase):
    """Match a whole registry name, respecting word boundaries."""
    phrase = _normalize(phrase)
    if not phrase:
        return False
    return bool(re.search(r'(?<!\w)' + re.escape(phrase) + r'(?!\w)', text))


def match_submitter(text, city='', state='', institutions=None):
    """Match one submitter's literal affiliation and return traceable evidence.

    Regional organizations can match by registry name or alias. Companies and
    organizations headquartered outside the region require a city matching a
    regional registry site in the same submitter field or the separate city
    field. A supplied state must agree with that site. City alone cannot match.
    The caller is responsible for retaining the source URL and field role.
    """
    raw = text or ''
    normalized = _normalize(raw)
    city_text = _normalize(city)
    state_text = _normalize(state)
    matches = []
    for inst in institutions if institutions is not None else registry():
        names = [inst.get('name', '')] + (inst.get('aliases') or [])
        name = next((n for n in names if _contains(normalized, n)), None)
        if not name:
            continue
        sites = [s for s in inst.get('sites') or [] if s.get('county') in COUNTIES and s.get('place')]
        location = next((s for s in sites if
                         (_normalize(s['place']) == city_text if city_text else _contains(normalized, s['place']))
                         and (not state_text or state_text == _normalize(s.get('state', '')))), None)
        if (inst.get('kind') == 'company' or inst.get('id') in SKIP_OUTSIDE) and not location:
            continue
        # An explicitly supplied city contradicting the registered sites cannot
        # establish that this is the regional institution or campus.
        if city_text and sites and not location:
            continue
        matches.append({'institution': inst['id'], 'matched_name': name,
                        'submitter': raw, 'city': city or None, 'state': state or None,
                        'matched_site': location.get('place') if location else None})
    ids = sorted({m['institution'] for m in matches})
    by_id = {i['id']: i for i in (institutions if institutions is not None else registry())}
    counties = sorted({by_id[i].get('homeCounty') for i in ids if by_id[i].get('homeCounty') in COUNTIES})
    return {'institutions': ids, 'counties': counties, 'matches': matches}
