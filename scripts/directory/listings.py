"""Display metadata for the public software projection."""
import json
import re
from pathlib import Path

INSTITUTIONS = Path(__file__).resolve().parents[2] / 'src/content/public-directory-institutions.json'
PROFILE_COUNTIES = {
    'Philadelphia, PA': 'Philadelphia',
    'Doylestown, PA': 'Bucks',
    'Camden, NJ': 'Camden',
    'Princeton, NJ': 'Mercer',
    'Ewing, NJ': 'Mercer',
}
EMOJI = re.compile(
    r'[#*0-9]\ufe0f?\u20e3|[\U0001f1e6-\U0001f1ff\U0001f300-\U0001faff]'
    r'|[\u2300-\u27ff\u2b00-\u2bff\u00a9\u00ae]\ufe0f'
    r'|[\u200d\ufe0f\U000e0020-\U000e007f]'
)
WELCOME = re.compile(r'^welcome to(?:\s+|$)', re.I)
REFRESH_FIELDS = {'language', 'license', 'profileLocation', 'county', 'countyBasis'}


def update_display(rows):
    homes = {}
    for institution in json.loads(INSTITUTIONS.read_text(encoding='utf-8')):
        if county := institution.get('homeCounty'):
            for label in (institution['name'], *institution['aliases']):
                homes[label.casefold()] = county
    for row in rows:
        name = WELCOME.sub('', EMOJI.sub('', row['name']).strip()).strip()
        row['name'] = name or row['code'].rsplit('/', 1)[-1]
        if row.get('county'):
            continue
        institution = row.get('institution')
        if institution and (county := homes.get(institution.casefold())):
            row['county'] = county
            row['countyBasis'] = 'institution'
        elif not institution and (county := PROFILE_COUNTIES.get(row.get('profileLocation'))):
            row['county'] = county
            row['countyBasis'] = 'profile'
