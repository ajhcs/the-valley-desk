"""Join public-safe sizing counts from two separately queried indexes."""
import argparse
import csv
import json
from pathlib import Path

from sizing import YEARS


def counts(run, source):
    with (run / f'sizing-{source}.csv').open(encoding='utf-8') as stream:
        return {r['id']: r for r in csv.DictReader(stream)}


def percent(numerator, denominator):
    return f'{100 * int(numerator) / denominator:.1f}%' if denominator and numerator != '' else ''


def summarize(run):
    counts_by_provider = {source: counts(run, source) for source in ('openalex', 'europepmc')}
    expected = set(counts_by_provider['openalex'])
    if set(counts_by_provider['europepmc']) != expected:
        raise ValueError('provider tables cover different institution sets')
    fields = ('preprints', 'pmids', 'open_access')
    metrics = (*map(str, YEARS), 'total', *fields, *(field + '_share' for field in fields), 'types', 'failure')
    info = ('id', 'name', 'counties')
    writer = csv.DictWriter(
        (run / 'sizing-by-institution.csv').open('w', encoding='utf-8', newline=''),
        fieldnames=[*info, *(f'{provider}_{key}' for provider in counts_by_provider for key in metrics)],
        lineterminator='\n',
    )
    writer.writeheader()
    source_totals = {provider: {str(y): 0 for y in YEARS} for provider in counts_by_provider}
    for slug in sorted(expected):
        row = {key: counts_by_provider['openalex'][slug][key] for key in info}
        for provider, table in counts_by_provider.items():
            data = table[slug]
            values = {key: data[key] for key in metrics if key in data}
            if all(data[str(year)] != '' for year in YEARS):
                values['total'] = sum(int(data[str(y)]) for y in YEARS)
                for field in fields:
                    values[field + '_share'] = percent(data[field], values['total'])
            for year in YEARS:
                if data[str(year)] != '':
                    source_totals[provider][str(year)] += int(data[str(year)])
            row.update({f'{provider}_{key}': value for key, value in values.items()})
        writer.writerow(row)
    (run / 'sizing-institution-incidence-totals.json').write_text(json.dumps(source_totals, indent=2) + '\n')
    return len(expected)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run', type=Path)
    args = parser.parse_args()
    print(f'Joined {summarize(args.run)} rows')
