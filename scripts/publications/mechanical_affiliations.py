"""Match literal regional author affiliations and keep the supporting clauses private."""

from collections import defaultdict
from functools import lru_cache
import json
import re
import unicodedata

from institutions import load_reference
from metadata import authorship, source_url, title_of
from project import orcid, plain


def norm(value):
    return " ".join(re.findall(r"[^\W_]+", unicodedata.normalize("NFKC", value or "").casefold()))


NON_BYLINE = re.compile(
    r"^(?:(?:additional|invited|peer|expert|external|manuscript) )?(?:reviewers?|collaborators?|contributors?|acknowledgments?|appendix|group information|editorial team)(?: \d+)?$",
    re.I,
)
GROUP_NOTE = re.compile(
    r"\b(?:the authors are|authors? affiliations? (?:are|were)|author information|group author members|collaborators? listed|appendix |reviewer affiliations|authors? include|the reviewers are|in (?:alphabetical|author) order)\b",
    re.I,
)
INITIALS = re.compile(r"\((?:[A-Z][. ]?){2,5}(?:,?\s+(?:and\s+)?(?:[A-Z][. ]?){2,5})*\)")


def provenance_filter(author, affiliation, aff_owners):
    if GROUP_NOTE.search(affiliation):
        return False
    # Initials in a pooled note must include this exact byline author's initials.
    if refs := INITIALS.findall(affiliation):
        if len(aff_owners) > 1 or ";" in affiliation or len(refs) > 1:
            tokens = norm(author).split()
            possible = {
                "".join(p[0] for p in tokens if p),
                "".join(p[0] for p in tokens[::-1] if p),
            }
            refs_normalized = {norm(r).replace(" ", "") for r in refs}
            if not possible & refs_normalized:
                return False
    return True


EMAIL = re.compile(r"\b[\w.+%\-]+@[\w.\-]+\.[A-Za-z]{2,}\b", re.I)
URL = re.compile(r"(?:https?://|mailto:|www\.)[^\s;]+", re.I)
CONTACT_CAPTION = re.compile(
    r"\b(?:electronic address|email address|e-mail|email|tel(?:ephone)?|fax)\s*:\s*[^;\n]*(?=;|\n|$)",
    re.I,
)
# These are geographic place cues and outside-campus names, never institution aliases.
OUTSIDE = re.compile(
    r"\b(?:wilmington|piscataway|newark|new brunswick|pittsburgh|hershey|university park|"
    r"plainsboro|new york|rochest(?:er)|new brunswick|paterson|boston|los angeles|lehigh valley|"
    r"allentown|rahway|kenilworth|cape may court house|new castle|orlando|jacksonville|"
    r"orange county|washington dc|abington massachusetts|wyomissing|suwanee|vineland|bengaluru|bangalore)\b",
    re.I,
)
OUTSIDE_STATE = re.compile(
    r",\s*(?:DE|NY|MD|OH|MA|CT|CA|TX|FL|VA|NC|SC|GA|RI|DC|IL|MI|MN|"
    r"WA|CO|OR|WI|TN|IN|KY|ME|NH|VT|WV|AZ|MO|AL|IA|ID|KS|LA|MS|MT|NE|NV|NM|ND|OK|SD|UT|WY)"
    r"(?=\s+\d{5}\b|\s*(?:,|\.|;|$))"
)
FOREIGN = re.compile(
    r"\b(?:united kingdom|canada|australia|india|germany|france|china|japan|italy|spain|"
    r"netherlands|switzerland|denmark|sweden|belgium|ireland|mexico|south korea)\b",
    re.I,
)


def country_suffix(country_codes):
    names = {
        "uk",
        "u k",
        "gb",
        "gbr",
        "england",
        "scotland",
        "wales",
        "northern ireland",
        "united kingdom",
        "south korea",
        "north korea",
        "vietnam",
        "russia",
        "bolivia",
        "taiwan",
        "iran",
        "laos",
        "syria",
        "czech republic",
        "hong kong",
        "macau",
        "turkey",
        "ivory coast",
        "cape verde",
    }
    if country_codes is not None:
        for country in json.loads(country_codes.read_text(encoding="utf-8"))["3166-1"]:
            if country["alpha_2"] != "US":
                names.update((country.get("name", ""), country.get("common_name", "")))
    values = {norm(value) for value in names if value}
    found = "|".join(
        ("(?<!new )" if value == "jersey" else "") + re.escape(value)
        for value in sorted(values, key=lambda v: (-len(v), v))
    )
    return re.compile(rf"\b(?:{found})(?:\s+\d+)?$")


STATE_CODE = {
    "alabama": "AL",
    "alaska": "AK",
    "arizona": "AZ",
    "arkansas": "AR",
    "california": "CA",
    "colorado": "CO",
    "connecticut": "CT",
    "delaware": "DE",
    "district of columbia": "DC",
    "florida": "FL",
    "georgia": "GA",
    "hawaii": "HI",
    "idaho": "ID",
    "illinois": "IL",
    "indiana": "IN",
    "iowa": "IA",
    "kansas": "KS",
    "kentucky": "KY",
    "louisiana": "LA",
    "maine": "ME",
    "maryland": "MD",
    "massachusetts": "MA",
    "michigan": "MI",
    "minnesota": "MN",
    "mississippi": "MS",
    "missouri": "MO",
    "montana": "MT",
    "nebraska": "NE",
    "nevada": "NV",
    "new hampshire": "NH",
    "new jersey": "NJ",
    "new mexico": "NM",
    "new york": "NY",
    "north carolina": "NC",
    "north dakota": "ND",
    "ohio": "OH",
    "oklahoma": "OK",
    "oregon": "OR",
    "pennsylvania": "PA",
    "rhode island": "RI",
    "south carolina": "SC",
    "south dakota": "SD",
    "tennessee": "TN",
    "texas": "TX",
    "utah": "UT",
    "vermont": "VT",
    "virginia": "VA",
    "washington": "WA",
    "west virginia": "WV",
    "wisconsin": "WI",
    "wyoming": "WY",
}
STATES = "|".join(
    sorted(
        set(STATE_CODE) | {v.lower() for v in STATE_CODE.values()},
        key=lambda state: (-len(state), state),
    )
)
STATE_TOKEN = re.compile(rf"^\s+(?:state of )?({STATES})\b")
WRONG_PENN = re.compile(
    r"\b(?:indiana|millersville|west chester|commonwealth|california|clarion|kutztown|"
    r"bloomsburg|east stroudsburg|edinboro|slippery rock|mansfield|shippensburg|cheyney) university of pennsylvania\b"
)
REQUIRES_SITE = {"saint-mary-langhorne", "penn-state", "rutgers"}
SITE_TERMS = {
    ("chop", "Philadelphia"): (
        "3401 civic center boulevard",
        "3401 civic center blvd",
        "19104",
    ),
    ("cooper-health", "Camden"): (
        "one cooper plaza",
        "1 cooper plaza",
        "246 s 6th st",
        "08103",
    ),
    ("thomas-jefferson-university", "Philadelphia"): (
        "19107",
        "19144",
        "901 walnut street",
        "1020 walnut street",
    ),
    ("jefferson-health", "Philadelphia"): (
        "111 south 11th street",
        "111 s 11th st",
        "19107",
    ),
    ("thomas-jefferson-university-hospital", "Philadelphia"): (
        "111 south 11th street",
        "111 s 11th st",
        "19107",
    ),
    ("philadelphia-va-medical-center", "Philadelphia"): (
        "3900 woodland avenue",
        "3900 woodland ave",
        "19104",
    ),
    ("pennsylvania-hospital", "Philadelphia"): ("800 spruce street", "800 spruce st"),
    ("gsk", "Upper Providence"): ("collegeville",),
    ("gsk", "Upper Merion"): ("king of prussia",),
    ("merck", "Upper Gwynedd"): ("north wales",),
    ("bristol-myers-squibb", "Lawrenceville"): ("princeton pike", "08543"),
    ("upenn", "Kennett Square"): ("new bolton center",),
}


def clean(value):
    return EMAIL.sub(" ", URL.sub(" ", CONTACT_CAPTION.sub(" ", value or "")))


def ortho(text):
    text = re.sub(r"\bphila\b", "philadelphia", norm(text))
    text = re.sub(
        r"\bchildren(?: s|s)? hospital of philadelphia\b",
        "children s hospital of philadelphia",
        text,
    )
    text = re.sub(
        r"\b(?:corporal michael j )?crescenz (?:department of veterans affairs(?: medical center)?|"
        r"veterans affairs medical center|va medical center|vamc)\b|\bcorporal michael j crescenz\b",
        "corporal michael j crescenz va medical center",
        text,
    )
    return text


def expression(values):
    return re.compile(
        r"(?<!\w)(?:" + "|".join(re.escape(k) for k in sorted(values, key=lambda a: (-len(a), a))) + r")(?!\w)"
    )


class AffiliationRules:
    def __init__(self, path, country_codes):
        self.foreign_country_suffix = country_suffix(country_codes)
        self.inst = {x["id"]: x for x in load_reference(path)}
        names = defaultdict(set)
        self.places = defaultdict(set)
        self.local = {}
        for slug, e in self.inst.items():
            for name in (e["name"], *e["aliases"]):
                names[ortho(name)].add(slug)
            for site in e["sites"]:
                self.places[norm(site["place"])].add((site["state"], site["county"]))
            loc = defaultdict(set)
            for site in e["sites"]:
                terms = [
                    site["place"],
                    site["name"],
                    *SITE_TERMS.get((slug, site["place"]), ()),
                ]
                for term in terms:
                    if len(key := norm(term)) >= 4:
                        loc[key].add(site["county"])
            self.local[slug] = dict(loc)
        self.names = dict(names)
        self.matcher = expression(names)
        self.known_places = expression(self.places)

    def locations(self, slug, text):
        return set().union(
            *(counts for term, counts in self.local[slug].items() if " " + term + " " in " " + text + " ")
        )

    def geography_conflicts(self, locality):
        for match in self.known_places.finditer(locality):
            after_city = locality[match.end() :]
            if self.foreign_country_suffix.search(after_city):
                return True
            state_match = STATE_TOKEN.match(after_city)
            if state_match:
                state = state_match[1]
                expected = {abbr for abbr, _ in self.places[match.group()]}
                state_code = STATE_CODE.get(state, state.upper())
                if state_code not in expected:
                    return True
                zipcode = re.match(r"\s+(\d{5})\b", after_city[state_match.end() :])
                if zipcode:
                    prefix = int(zipcode[1][:3])
                    if state_code == "PA" and 70 <= prefix <= 89 or state_code == "NJ" and 150 <= prefix <= 196:
                        return True
        return False

    @lru_cache(maxsize=65536)
    def claims(self, affiliation, separate=""):
        original = clean(affiliation)
        external = clean(separate)
        accumulated = defaultdict(set)
        outside_units = set()
        blocks = [a for a in re.split(r";|\n|\u2022|\s+\|\s+", original) if a.strip()]
        for raw in blocks:
            text = ortho(raw)
            matches = list(self.matcher.finditer(text))
            if not matches:
                continue
            for i, hit in enumerate(matches):
                tail = text[hit.end() : matches[i + 1].start() if i + 1 < len(matches) else len(text)]
                label = hit.group()
                ends_here = i == len(matches) - 1
                places = {m.group() for m in self.known_places.finditer(tail)}
                outside_named_site = bool(
                    OUTSIDE.search(tail)
                    or FOREIGN.search(tail)
                    or self.foreign_country_suffix.search(tail)
                    or (ends_here and OUTSIDE_STATE.search(raw))
                    or "penn medicine princeton medical center" in text
                )
                for slug in self.names[label]:
                    outlets = outside_named_site
                    if slug == "upenn" and WRONG_PENN.search(text):
                        continue
                    if (
                        slug == "upenn"
                        and label == "university of pennsylvania"
                        and re.match(r" hospitals?\b", tail)
                    ):
                        continue
                    evidence = tail
                    locality_from_name = label if slug in {"penn-state-abington", "rutgers-camden"} else ""
                    related = self.inst[slug]["parent"]
                    if (
                        i + 1 < len(matches)
                        and related in self.names[matches[i + 1].group()]
                        and not places
                        and not outlets
                    ):
                        parent_tail = text[
                            matches[i + 1].end() : matches[i + 2].start() if i + 2 < len(matches) else len(text)
                        ]
                        evidence = (tail + " " + parent_tail).strip()
                        outlets = bool(
                            OUTSIDE.search(parent_tail)
                            or FOREIGN.search(parent_tail)
                            or self.foreign_country_suffix.search(parent_tail)
                        )
                    if external and len(blocks) == 1 and len(matches) == 1:
                        evidence = (evidence + " " + ortho(external)).strip()
                        outlets = outlets or bool(
                            OUTSIDE.search(ortho(external))
                            or OUTSIDE_STATE.search(external)
                            or FOREIGN.search(ortho(external))
                            or self.foreign_country_suffix.search(ortho(external))
                        )
                    registry = self.inst[slug]
                    if self.geography_conflicts(evidence):
                        if (
                            not registry["outside"]
                            and slug not in REQUIRES_SITE
                            and registry["kind"] != "company"
                        ):
                            accumulated.setdefault(slug, set())
                        continue
                    if outlets:
                        outside_units.add(slug)
                        continue
                    counties = self.locations(slug, evidence + " " + locality_from_name)
                    if label == "jefferson einstein hospital" and not counties:
                        continue
                    if places and not counties:
                        # The clause gives a different or unregistered named site.
                        # Keep a regional unresolved claim only if the place is in the region.
                        if not all(len(self.places[p]) == 1 for p in places):
                            continue
                    if slug in REQUIRES_SITE or registry["kind"] == "company":
                        if not counties:
                            continue
                    if (
                        not counties
                        and not places
                        and not registry["outside"]
                        and (
                            ends_here
                            or not OUTSIDE.search(text)
                            and not self.foreign_country_suffix.search(text)
                        )
                    ):
                        # A literal uniquely sited unit can establish its site.
                        counties = (
                            {t["county"] for t in registry["sites"]} if len(registry["sites"]) == 1 else set()
                        )
                    accumulated[slug].update(counties if len(counties) == 1 else ())
        return (
            tuple((slug, tuple(sorted(counties))) for slug, counties in sorted(accumulated.items())),
            tuple(sorted(outside_units)),
        )


POOL_HEADER = re.compile(r"^\s*authors?['’]? affiliations?\s*:\s*", re.I)
POOL_LABEL = re.compile(r"\(([^()]+)\)\s*[.,]*$")


def partition_pooled_byline(people):
    # Keep unmarked source affiliations in place. Explicit terminal name lists
    # can restore ownership when the index put an entire group under one author.
    result = [p | {"affiliations": []} for p in people]
    names = defaultdict(set)
    for i, person in enumerate(people):
        for word in norm(person["name"]).split():
            if len(word) > 2:
                names[word].add(i)
    seen = set()
    for i, person in enumerate(people):
        for aff in person["affiliations"]:
            if not POOL_HEADER.match(aff):
                result[i]["affiliations"].append(aff)
                continue
            if aff in seen:
                continue
            seen.add(aff)
            for clause in POOL_HEADER.sub("", aff).split(";"):
                label = POOL_LABEL.search(clause)
                if not label:
                    continue
                identifiers = re.split(r",|\band\b", label[1])
                for name in identifiers:
                    owners = names[norm(name)]
                    if len(owners) == 1:
                        owner = next(iter(owners))
                        if clause not in result[owner]["affiliations"]:
                            result[owner]["affiliations"].append(clause)
    return result


def source_map(item, rules):
    provider, record = item["provider"], item["record"]
    people = partition_pooled_byline(authorship(provider, record))
    owners = defaultdict(set)
    for position, person in enumerate(people):
        for affiliation in person["affiliations"]:
            owners[clean(affiliation)].add(position)
    validated = []
    direct = set()
    counties = set()
    excluded = set()
    evidence = []
    for position, person in enumerate(people):
        name = plain(clean(person["name"]))
        if not name or NON_BYLINE.fullmatch(norm(name)):
            continue
        regional = False
        for affiliation in person["affiliations"]:
            text = clean(affiliation)
            if not provenance_filter(name, text, owners[text]):
                continue
            location = " ".join(place for a, place in person.get("affiliation_places", []) if a == affiliation)
            hits, outside = rules.claims(affiliation, location)
            excluded.update(outside)
            for institution, areas in hits:
                regional = True
                direct.add(institution)
                counties.update(areas)
                evidence.append(
                    {
                        "index": position,
                        "institution": institution,
                        "counties": list(areas),
                        "affiliation": text,
                    }
                )
        validated.append({"name": name, "orcid": orcid(person), "regional": regional})
    parents = {rules.inst[x]["parent"] for x in direct if rules.inst[x]["parent"]} - direct
    parents -= excluded - direct
    return {
        "source": source_url(provider, record),
        "provider": provider,
        "title": plain(title_of(provider, record)),
        "authors": validated,
        "direct": sorted(direct),
        "parents": sorted(parents),
        "counties": sorted(counties),
        "excluded": sorted(excluded - direct),
        "evidence": evidence,
    }
