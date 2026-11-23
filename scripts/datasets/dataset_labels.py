"""Source-grounded matching for a repository's actual submitter.

Callers must supply only a field that the repository identifies as a submitter
or contact. An explicitly named principal investigator is separate repository
evidence for a controlled-access study. Each call represents one person's or
organization's field, so location cannot leak between unrelated contributors.
"""
import re
import unicodedata

from common import COUNTIES, SKIP_OUTSIDE, registry


REPOSITORY_ALIASES = {
    'upenn': ('UPenn', 'U Penn', 'U. Penn', 'Univ Pennsylvania'),
    'penn-medicine': ('Penn Medicine', 'UPHS'),
    'perelman-school-of-medicine': ('PSOM', 'UPenn Perelman School of Medicine'),
    'chop': ('CHOP',),
    'thomas-jefferson-university': ('TJU', 'Jefferson', 'Thomas Jefferson'),
    'fox-chase': ('Fox Chase', 'FCCC'),
    'wistar': ('Wistar',),
    'princeton-university': ('Princeton Univ', 'Princeton Univeristy'),
}
AMBIGUOUS_ALIAS = {'jefferson', 'thomas jefferson', 'princeton univeristy'}


def repository_names(inst):
    return [inst.get('name', '')] + (inst.get('aliases') or [])


def short_name(inst, text, city=''):
    # Short names are meaningful as institution fields, including a department
    # or city in a separate comma-delimited segment.
    parts = {_orthographic(part) for part in re.split(r'[,;|()]', text)}
    for alias in REPOSITORY_ALIASES.get(inst['id'], ()):
        normalized = _orthographic(alias)
        if normalized not in parts:
            continue
        if normalized in AMBIGUOUS_ALIAS and not any(
                _normalize(site.get('place', '')) in ({_normalize(city)} | parts)
                for site in inst.get('sites', []) if site.get('place')):
            continue
        return alias
    return None


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


# Regional cities that need not appear among an institution's registered sites.
# Keep the state paired with the city to avoid matching a namesake elsewhere.
REGIONAL_CITIES = {
    'nj': set('camden|trenton|princeton|lawrenceville|cherry hill|stratford|glassboro|sewell|voorhees|mount laurel|marlton|moorestown|willingboro|browns mills|ewing|hamilton|pennington|hopewell|plainsboro|cranbury'.split('|')),
    'pa': set('philadelphia|doylestown|langhorne|wynnewood|bala cynwyd|glenside|blue bell|king of prussia|wayne|villanova|radnor|swarthmore|haverford|bryn mawr|media|west chester|exton|malvern|chester|norristown|lansdale|plymouth meeting|horsham|ambler|conshohocken|fort washington|newtown|bristol|levittown|abington|elkins park|upper darby|chesterbrook|spring house'.split('|')),
}


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
    state_text = {'pennsylvania': 'pa', 'new jersey': 'nj'}.get(state_text, state_text)
    matches = []
    for inst in institutions if institutions is not None else registry():
        names = repository_names(inst)
        name = next((n for n in names if _contains(normalized, n)), None) or short_name(inst, raw, city)
        # This observed GEO misspelling is accepted only with the independently
        # supplied Philadelphia, Pennsylvania contact location. Do not generalize
        # this into fuzzy alias matching.
        if (not name and inst.get('id') == 'chop'
                and _contains(normalized, "children's hospital of phildelphia")
                and city_text == 'philadelphia' and state_text == 'pa'):
            name = "Children's Hospital of Phildelphia"
        if not name:
            continue
        sites = [s for s in inst.get('sites') or [] if s.get('county') in COUNTIES and s.get('place')]
        location = next((s for s in sites if
                         (_normalize(s['place']) == city_text if city_text else _contains(normalized, s['place']))
                         and (not state_text or state_text == _normalize(s.get('state', '')))), None)
        if (inst.get('kind') == 'company' or inst.get('id') in SKIP_OUTSIDE) and not location:
            continue
        # A non-company institution can be named by an affiliation in another
        # known regional city; the registry's site list is not exhaustive.
        # A contradictory state or a city outside the region cannot establish it.
        regional_city = bool(city_text and city_text in REGIONAL_CITIES.get(state_text, set()))
        if city_text and not location and not (regional_city and state_text in ('pa', 'nj')):
            continue
        if state_text and state_text not in ('pa', 'nj'):
            continue
        matches.append({'institution': inst['id'], 'matched_name': name,
                        'submitter': raw, 'city': city or None, 'state': state or None,
                        'matched_site': location.get('place') if location else None,
                        'regional_city': city if city_text and regional_city else None})
    ids = sorted({m['institution'] for m in matches})
    by_id = {i['id']: i for i in (institutions if institutions is not None else registry())}
    counties = sorted({by_id[i].get('homeCounty') for i in ids if by_id[i].get('homeCounty') in COUNTIES})
    return {'institutions': ids, 'counties': counties, 'matches': matches}


def match_geo_institution(institution, city='', state='', institutions=None):
    """Match GEO's explicit institution field, preserving its supplied address.

    Exact registry names and aliases establish identity, including when the
    contact address is elsewhere. Companies still need their regional site.
    This must not be used on free text or fields with a different source role.
    """
    records = list(institutions if institutions is not None else registry())
    value = _normalize(institution)
    matches = []
    for inst in records:
        name = next((n for n in repository_names(inst) if n and _normalize(n) == value), None)
        if not name and re.fullmatch(r'[^,;|()]+', institution or ''):
            name = short_name(inst, institution, city)
        if not name:
            continue
        if inst.get('kind') == 'company':
            result = match_submitter(institution, city, state, [inst])
            matches.extend(result['matches'])
        else:
            matches.append({'institution': inst['id'], 'matched_name': name,
                            'submitter': institution, 'city': city or None,
                            'state': state or None, 'matched_site': None,
                            'regional_city': None})
    ids = sorted({m['institution'] for m in matches})
    by_id = {i['id']: i for i in records}
    return {'institutions': ids,
            'counties': sorted({by_id[i].get('homeCounty') for i in ids
                                if by_id[i].get('homeCounty') in COUNTIES}),
            'matches': matches}


def _orthographic(value):
    """Normalize punctuation and spacing, without spelling or token inference."""
    return re.sub(r'\s+', ' ', re.sub(r'[^\w]+', ' ', _normalize(value))).strip()


def match_paper_affiliation(affiliation, institutions=None):
    """Match names literally present in one paper author affiliation.

    Only the cited affiliation text is evidence. Registry parent relationships
    and paper-level institution tags are deliberately not expanded. Companies
    and outside organizations require a named regional site in the same text.
    """
    records = list(institutions if institutions is not None else registry())
    segments = [_orthographic(part) for part in (affiliation or '').split(';')]
    matches = []
    for inst in records:
        names = [inst.get('name', '')] + (inst.get('aliases') or [])
        eligible = [(n, segment) for segment in segments for n in names
                    if _contains(segment, _orthographic(n))]
        if inst.get('kind') == 'company' or inst.get('id') in SKIP_OUTSIDE:
            eligible = [(n, segment) for n, segment in eligible if any(
                site.get('county') in COUNTIES and site.get('place')
                and _contains(segment, _orthographic(site['place']))
                for site in inst.get('sites') or [])]
        if not eligible:
            continue
        name, segment = eligible[0]
        sites = [s for s in inst.get('sites') or [] if s.get('county') in COUNTIES
                 and s.get('place') and _contains(segment, _orthographic(s['place']))]
        matches.append({'institution': inst['id'], 'matched_name': name,
                        'affiliation': affiliation,
                        'matched_site': sites[0]['place'] if sites else None})
    ids = sorted({m['institution'] for m in matches})
    by_id = {i['id']: i for i in records}
    return {'institutions': ids,
            'counties': sorted({by_id[i].get('homeCounty') for i in ids
                                if by_id[i].get('homeCounty') in COUNTIES}),
            'matches': matches}

def investigator_ids(record, institutions=None):
    """Resolve affiliations explicitly supplied for a repository's investigators."""
    records = list(institutions if institutions is not None else registry())
    fields = record.get('pi_affiliations') or [record.get('pi_block') or '']
    return sorted({identifier for field in fields for identifier in (
        set(match_paper_affiliation(field, records)['institutions'])
        | set(match_submitter(field, institutions=records)['institutions']))})
