"""Project public ClinicalTrials.gov records with a supported nine-county site."""
import argparse
from collections import Counter, defaultdict
import csv
from datetime import date, datetime
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "publications"))
from institutions import load_reference

API = "https://clinicaltrials.gov/api/v2"
CENSUS = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt"
STATES = {"Pennsylvania": "PA", "New Jersey": "NJ"}
COUNTIES = {
    "42017": "Bucks", "42029": "Chester", "42045": "Delaware", "42091": "Montgomery",
    "42101": "Philadelphia", "34005": "Burlington", "34007": "Camden",
    "34015": "Gloucester", "34021": "Mercer",
}
FIELDS = ",".join((
    "NCTId", "BriefTitle", "StudyType", "Phase", "Condition", "OverallStatus",
    "StudyFirstPostDate", "LastUpdatePostDate", "LocationFacility", "LocationCity",
    "LocationState", "LocationZip", "LocationCountry", "LocationStatus",
))
ID = re.compile(r"NCT[0-9]{8}")
ZIP = re.compile(r"([0-9]{5})(?:-[0-9]{4})?")
CONTACT = re.compile(r"\b[^\s@]+@[^\s@]+\.[a-z]{2,}\b|\b\d{3}[-. ]\d{3}[-. ]\d{4}\b", re.I)


def text(value):
    return " ".join(value.split()) if isinstance(value, str) else ""


def name(value):
    return " ".join(re.findall(r"[^\W_]+", text(value).casefold()))


def public_text(value, limit=512):
    value = text(value)
    return value if len(value) <= limit and not CONTACT.search(value) else ""


def fetch(url, private, *, reuse=False):
    digest = hashlib.sha256(url.encode()).hexdigest()
    target = private / (digest + ".body")
    if reuse and target.exists():
        return target.read_bytes()
    request = Request(url, headers={"User-Agent": "The Valley Desk regional studies index"})
    for delay in (1, 2, 0):
        try:
            with urlopen(request, timeout=45) as response:
                body = response.read(32 * 1024 * 1024 + 1)
                if len(body) > 32 * 1024 * 1024:
                    raise ValueError("Source response exceeds the byte limit")
                target.write_bytes(body)
                target.with_suffix(".json").write_text(json.dumps({
                    "url": url, "received": datetime.now().astimezone().isoformat(),
                    "sha256": hashlib.sha256(body).hexdigest(),
                }) + "\n")
                return body
        except HTTPError as err:
            if err.code not in (429, 500, 502, 503, 504) or not delay:
                raise
        except (URLError, TimeoutError):
            if not delay:
                raise
        time.sleep(delay)


def county_sets(body):
    census = csv.DictReader(io.StringIO(body.decode("utf-8-sig")), delimiter="|")
    result = defaultdict(set)
    for row in census:
        if row["GEOID_ZCTA5_20"] and int(row["AREALAND_PART"] or "0") > 0:
            result[row["GEOID_ZCTA5_20"]].add(row["GEOID_COUNTY_20"])
    return result


def facility_refs(institutions):
    matches = defaultdict(set)
    for ref in institutions:
        for site in ref["sites"]:
            labels = [ref["name"], *ref["aliases"], site["name"]]
            for label in labels:
                matches[(name(label), name(site["place"]), site["state"], site["county"])].add(ref["id"])
    return matches


def county_for(facility, city, state, zip_code, zips, facilities):
    state_fips = {"PA": "42", "NJ": "34"}[state]
    candidates = zips.get(zip_code, ())
    if candidates and not any(fips.startswith(state_fips) for fips in candidates):
        return None
    known = {
        county for county in COUNTIES.values()
        if (name(facility), name(city), state, county) in facilities
    }
    if state == "PA" and name(city) == "philadelphia":
        known.add("Philadelphia")
    if candidates:
        plausible = {COUNTIES.get(fips) for fips in candidates}
        if known and not known.intersection(plausible):
            return None
        known.intersection_update(plausible)
        if len(candidates) == 1 and not known:
            return next(iter(plausible))
    return next(iter(known)) if len(known) == 1 else None


def project(study, zips, facilities, run_date, existing):
    protocol = study["protocolSection"]
    identifiers = protocol["identificationModule"]
    nct = identifiers["nctId"]
    title = public_text(identifiers.get("briefTitle"))
    study_type = protocol.get("designModule", {}).get("studyType")
    status = protocol.get("statusModule", {})
    overall = status.get("overallStatus")
    if not ID.fullmatch(nct) or not title or study_type not in {"INTERVENTIONAL", "OBSERVATIONAL", "EXPANDED_ACCESS"} or not overall:
        return None
    sites = {}
    institutions = set()
    for location in protocol.get("contactsLocationsModule", {}).get("locations", []):
        state = STATES.get(location.get("state"))
        city = public_text(location.get("city"), 100)
        facility = public_text(location.get("facility"), 250)
        postal = ZIP.fullmatch(text(location.get("zip")))
        if location.get("country") != "United States" or not (state and city and facility):
            continue
        zip_code = postal.group(1) if postal else ""
        county = county_for(facility, city, state, zip_code, zips, facilities)
        if not county:
            continue
        site_status = public_text(location.get("status"), 30) or None
        key = (facility, city, state, zip_code, site_status or "")
        sites[key] = {"facility": facility, "city": city, "state": state, "zip": zip_code,
                      "county": county, "status": site_status}
        institutions.update(facilities.get((name(facility), name(city), state, county), ()))
    if not sites:
        return None
    source = "https://clinicaltrials.gov/study/" + nct
    conditions = {public_text(term, 150) for term in protocol.get("conditionsModule", {}).get("conditions", [])}
    return {
        "id": nct, "title": title, "type": study_type, "status": overall,
        "phases": protocol.get("designModule", {}).get("phases", []),
        "first_posted": status.get("studyFirstPostDateStruct", {}).get("date"),
        "last_updated": status.get("lastUpdatePostDateStruct", {}).get("date"),
        "conditions": sorted(conditions - {""}), "sites": [sites[key] for key in sorted(sites)],
        "institutions": sorted(institutions), "counties": sorted({s["county"] for s in sites.values()}),
        "source": source, "url": source, "label": "Verified",
        "connection": "ClinicalTrials.gov lists a study site in the Delaware Valley.",
        "added": existing.get(nct, run_date), "checked": run_date,
    }


def studies(state, private, *, replay=False):
    params = {"query.locn": "AREA[LocationState]" + state, "fields": FIELDS,
              "countTotal": "true", "pageSize": 1000}
    seen = set()
    tokens = set()
    expected = None
    while True:
        page = json.loads(fetch(API + "/studies?" + urlencode(params), private, reuse=replay))
        total = page.get("totalCount", expected)
        if total is None or (expected is not None and total != expected):
            raise RuntimeError(f"Registry total changed while paging {state}")
        expected = total
        for study in page["studies"]:
            nct = study["protocolSection"]["identificationModule"]["nctId"]
            if nct in seen:
                raise RuntimeError(f"Duplicate registry ID while paging {state}")
            seen.add(nct)
            yield nct, study
        token = page.get("nextPageToken")
        if not token:
            break
        if token in tokens:
            raise RuntimeError(f"Repeated registry cursor for {state}")
        tokens.add(token)
        params["pageToken"] = token
    if len(seen) != expected or not seen:
        raise RuntimeError(f"Incomplete registry inventory for {state}: {len(seen)} of {expected}")


def confirmed_outside(study, identifier, zips):
    protocol = study["protocolSection"]
    if protocol["identificationModule"]["nctId"] != identifier:
        raise ValueError("ClinicalTrials.gov returned the wrong study")
    locations = protocol.get("contactsLocationsModule", {}).get("locations")
    if not isinstance(locations, list):
        return False
    for site in locations:
        if not site.get("country"):
            return False
        if site["country"] != "United States":
            continue
        state = site.get("state")
        if not state:
            return False
        if state in STATES:
            postal = ZIP.fullmatch(text(site.get("zip")))
            county_set = zips.get(postal[1], set()) if postal else set()
            state_fips = "42" if state == "Pennsylvania" else "34"
            if (name(site.get("city")) == "philadelphia" or not county_set
                    or any(not code.startswith(state_fips) or code in COUNTIES for code in county_set)):
                return False
    return True


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("private", type=Path)
    cli.add_argument("--previous", type=Path)
    cli.add_argument("--date", type=date.fromisoformat, default=datetime.now(ZoneInfo("America/New_York")).date())
    cli.add_argument("--replay", action="store_true")
    cli.add_argument("--verify-missing", action="store_true")
    args = cli.parse_args()
    private = args.private.resolve(strict=True)
    if not private.is_dir() or private.stat().st_mode & 0o077:
        cli.error("Use a dedicated mode-0700 run directory.")
    metadata = private / "metadata"
    metadata.mkdir(mode=0o700, exist_ok=True)
    census = county_sets(fetch(CENSUS, metadata, reuse=True))
    refs = facility_refs(load_reference())
    existing = {}
    if args.previous:
        for line in args.previous.open():
            row = json.loads(line)
            existing[row["id"]] = row["added"]
    version_url = API + "/version"
    before = json.loads(fetch(version_url, metadata, reuse=args.replay))
    inventory = {}
    for state in STATES:
        for nct, study in studies(state, metadata, replay=args.replay):
            if nct in inventory and inventory[nct] != study:
                raise RuntimeError(f"Registry projections conflict for {nct}")
            inventory[nct] = study
    data = [row for nct, study in sorted(inventory.items())
            if (row := project(study, census, refs, args.date.isoformat(), existing))]
    missing = existing.keys() - {r["id"] for r in data}
    outside = []
    if args.verify_missing:
        for identifier in sorted(missing):
            if not ID.fullmatch(identifier):
                raise ValueError("Invalid listing identity in prior clinical snapshot")
            try:
                exact = json.loads(fetch(API + "/studies/" + identifier + "?fields=" + FIELDS, metadata,
                                         reuse=args.replay))
            except HTTPError as error:
                if error.code == 404:
                    continue
                raise
            if confirmed_outside(exact, identifier, census):
                outside.append(identifier)
    after = json.loads(fetch(version_url, metadata, reuse=args.replay))
    if before != after:
        raise RuntimeError("ClinicalTrials.gov refreshed during the census. Retry with a new run directory.")
    if not data:
        raise RuntimeError("No regional studies passed the geographic gate")
    output = private / "clinical-studies.jsonl"
    with output.open("w", encoding="utf-8") as stream:
        for row in data:
            stream.write(json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")
    print(json.dumps({"version": before, "candidates": len(inventory), "published_projection": len(data),
                      "types": Counter(r["type"] for r in data),
                      "counties": Counter(c for r in data for c in r["counties"]),
                      "previous_missing": len(missing), "confirmed_outside": outside,
                      "sha256": hashlib.sha256(output.read_bytes()).hexdigest()}, sort_keys=True))


if __name__ == "__main__":
    main()
