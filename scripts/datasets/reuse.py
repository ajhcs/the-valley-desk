"""Metadata-only reuse decisions; repository citations do not prove production."""
import calendar
import re
from collections import defaultdict
from datetime import date


def identifiers(paper):
    ids = set()
    for key in ('id', 'doi', 'pmid', 'pmcid'):
        value = str(paper.get(key) or '').strip().lower()
        value = re.sub(r'^https?://(?:dx\.)?doi\.org/', '', value)
        value = re.sub(r'^(?:doi|pmid):', '', value)
        if re.fullmatch(r'10\.\d{4,9}/\S+', value):
            ids.add('doi:' + value.rstrip('.,;'))
        elif re.fullmatch(r'\d+', value):
            ids.add('pmid:' + value)
        elif re.fullmatch(r'pmc\d+', value):
            ids.add(value)
    return ids


def parse_date(value, latest=False):
    value = str(value or '')[:10]
    try:
        if re.fullmatch(r'\d{4}', value):
            value += '-12-31' if latest else '-01-01'
        elif re.fullmatch(r'\d{4}-\d{2}', value):
            year, month = map(int, value.split('-'))
            value += f'-{calendar.monthrange(year, month)[1]:02}' if latest else '-01'
        return date.fromisoformat(value)
    except (ValueError, TypeError):
        return None


def more_than_year_before(repo_date, paper_date):
    r, p = parse_date(repo_date, latest=True), parse_date(paper_date)
    if not r or not p:
        return False
    anniversary = date(r.year + 1, r.month, min(r.day, calendar.monthrange(r.year + 1, r.month)[1]))
    return anniversary < p


def public_dates(kind, source):
    """Return public release evidence, never registration or submission dates."""
    if kind == 'doi':
        issued = [x.get('date') for x in source.get('dates', [])
                  if x.get('dateType') == 'Issued' and parse_date(x.get('date'))]
        if issued:
            return [('issued', value) for value in issued]
        year = source.get('year')
        return [('publicationYear', str(year))] if parse_date(year) else []
    value = source.get('released')
    return [('released', value)] if parse_date(value) else []


def adjudicate(rows, papers, read_cache):
    # Union known DOI, PMID and PMCID aliases, including transitive matches.
    parent = {}
    def root(x):
        parent.setdefault(x, x)
        if parent[x] != x:
            parent[x] = root(parent[x])
        return parent[x]
    for p in papers.values():
        aliases = sorted(identifiers(p))
        for alias in aliases[1:]:
            parent[root(alias)] = root(aliases[0])
    def aliases(row):
        return identifiers(papers.get(row.get('paper'), {})) | identifiers({'id': row.get('paper'), 'pmcid': row.get('pmcid')})
    def paper_key(row):
        return min((root(i) for i in aliases(row)), default=str(row.get('paper')))
    def sources_for(row):
        kind, key = row['unit_type'], row['unit']
        kind = 'sra' if kind in ('sra-run', 'sra-study') else kind
        rec = read_cache(kind, key) or {}
        sources = [(kind, key, rec)]
        if kind in ('geo-sample', 'geo-gds'):
            sources.extend(('geo', s, read_cache('geo', s) or {}) for s in rec.get('series', []))
        linked = rec.get('bioprojects') or [] if kind == 'assembly' else ([rec['bioproject']] if kind == 'sra' and rec.get('bioproject') else [])
        if kind == 'geo':
            linked = rec.get('bioproject') or []
        elif kind in ('geo-sample', 'geo-gds'):
            linked = [b for _, _, series in sources[1:] for b in (series.get('bioproject') or [])]
        sources.extend(('bioproject', b, read_cache('bioproject', b) or {}) for b in linked)
        return sources
    def group_key(row):
        sources = sources_for(row)
        # Group distinct accession forms resolving to one public repository unit.
        for kind, key, rec in reversed(sources[1:]):
            if kind in ('geo', 'bioproject') and rec.get('ok'):
                return kind, key.upper()
        if sources[0][0] == 'sra' and (study := sources[0][2].get('study')):
            return 'sra', study.upper()
        return sources[0][0], sources[0][1].upper()
    groups = defaultdict(set)
    for row in rows:
        if row.get('decision') == 'produced' and row.get('unit_type') and row.get('unit'):
            groups[group_key(row)].add(paper_key(row))
    out = []
    for row in rows:
        if row.get('decision') not in ('produced', 'reused') or not row.get('unit_type') or not row.get('unit'):
            continue
        sources = sources_for(row)
        cited, citations = set(), []
        for k, accession, source in sources:
            source_citations = list(source.get('citations') or [])
            # DataCite's outgoing References relation is a citation by the record;
            # inverse relations such as IsReferencedBy are not.
            source_citations.extend({'id': x.get('id')} for x in source.get('related', [])
                                    if x.get('type') in ('References', 'Cites') and x.get('id'))
            for c in source_citations:
                cited.update(identifiers(c if isinstance(c, dict) else {'id': c}))
                citations.append({'kind': k, 'accession': accession, 'citation': c})
        cited_match = bool({root(a) for a in cited} & {root(a) for a in aliases(row)})
        dated = [(k, a, field, value) for k, a, source in sources
                 for field, value in public_dates(k, source)]
        paper = papers.get(row['paper'], {})
        old = any(more_than_year_before(d[3], paper.get('published')) for d in dated)
        multi = len(groups[group_key(row)]) > 1
        reason = ('original mention classified as reuse' if row['decision'] == 'reused' else
                  'repository cites paper' if cited_match else ('repository date more than 12 months before paper' if old else ('multiple papers claim accession' if multi else 'no metadata reuse override')))
        out.append({'paper': row['paper'], 'pmcid': row.get('pmcid'), 'unit_type': row['unit_type'], 'unit': row['unit'],
                    'original_decision': row['decision'], 'decision': 'reused' if row['decision'] == 'reused' or (not cited_match and (old or multi)) else row['decision'],
                    'reason': reason, 'paper_published': paper.get('published'), 'repository_dates': [dict(kind=k, accession=a, field=f, date=d,
                                              **({'source': source['release_source']} if source.get('release_source') else {}))
                                         for k, a, source in sources for f, d in public_dates(k, source)],
                    'repository_citations': citations, 'citation_match': cited_match, 'multiple_papers': multi,
                    'citation_metadata': [{'kind': k, 'accession': a, 'available': 'citations' in source or (k == 'doi' and 'related' in source)} for k, a, source in sources]})
    return out


def replay_date_decisions(old_decisions, rows, papers, read_cache):
    """Replay only legacy date-rule rejections; retain every other legacy decision.

    Missing release or paper dates leave a previous rejection in place. Decisions
    are matched by occurrence order for duplicate paper/unit keys.
    """
    fresh = adjudicate(rows, papers, read_cache)
    by_key = defaultdict(list)
    for decision in fresh:
        by_key[(decision['paper'], decision['unit_type'], decision['unit'])].append(decision)
    result = []
    for old in old_decisions:
        key = (old['paper'], old['unit_type'], old['unit'])
        candidates = by_key.get(key, [])
        current = candidates.pop(0) if candidates else None
        if old.get('reason') != 'repository date more than 12 months before paper':
            result.append(dict(old))
        elif (current is None or not current['repository_dates'] or not parse_date(current.get('paper_published'))
              or not {(d['kind'], d['accession']) for d in old.get('repository_dates', [])
                      if more_than_year_before(d.get('date'), old.get('paper_published'))}
                     <= {(d['kind'], d['accession']) for d in current['repository_dates']}):
            result.append({**old, 'date_replay': 'unresolved: public release or paper date unavailable'})
        else:
            result.append({**current, 'date_replay': 'evaluated'})
    return result
