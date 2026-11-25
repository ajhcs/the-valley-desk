"""Apply the audited annual mechanical inclusion rules to new publication candidates."""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from pathlib import Path
import re
from urllib.parse import quote, urlsplit, urlunsplit
from zipfile import ZipFile

from collect import doi, epmc_ids
from mechanical_affiliations import (
    AffiliationRules,
    STATE_CODE,
    STATES,
    clean,
    norm,
    ortho,
    source_map,
)
from metadata import earliest_date, electronic_dates, source_url
from project import journal, open_access, plain, selected_terms

POSTAL_ALIASES = {
    ("ewing", "08628"),
    ("ewing", "08618"),
    ("east norriton", "19403"),
    ("upper gwynedd", "19486"),
    ("lawrenceville", "08648"),
}
EXCLUDED_TYPES = {
    "published erratum",
    "erratum",
    "correction",
    "corrigendum",
    "obituary",
    "biography",
    "autobiography",
    "retraction of publication",
    "retraction notice",
    "expression of concern",
    "news",
    "newspaper article",
    "periodical index",
    "table of contents",
    "meeting announcement",
    "introductory journal article",
    "patient education handout",
    "editorial board",
    "publisher note",
}
EXCLUDED_TITLE = re.compile(
    r"^(?:(?:publisher|author|formal) )?(?:correction(?:\s+to\b|\s+of\b|\s*:)|erratum\b|"
    r"corrigendum\b|retraction(?:\s+notice\b|\s+of\b|\s*:)|withdrawal notice\b|"
    r"expression of concern\b|in memoriam\b|in memory of\b|in tribute to\b|"
    r"(?:an? )?obituary\b|(?:an? )?(?:memorial )?tribute to\b|table of contents\b|"
    r"editorial board\b|preface(?:\W|$)|foreword(?:\W|$)|"
    r"acknowledg(?:e)?ment (?:to|of) reviewers\b)",
    re.I,
)
NOTICE = re.compile(r"^(?:retraction|expression of concern|notice of retraction)\b", re.I)
MISCONDUCT = re.compile(
    r"\b(?:misconduct|fabricat\w*|falsif\w*|plagiari\w*|image manipulat\w*|fraud)\b",
    re.I,
)
PERSON = re.compile(
    r"\b(?:professor|[Dd]r\.?|author named)\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b|"
    r"\b[A-Z][a-z]+\s+[A-Z][a-z]+\s+(?:was found|admitted|was responsible)\b",
)
PATIENT = re.compile(
    r"\b(?i:(?:the patient|a patient|the participant|the child) (?:was |is )?"
    r"(?:named|identified by name as)|patient(?:’|\x27)s (?:full )?name (?:was|is)) "
    r"(?:Mr\.? |Ms\.? |Mrs\.? )?[A-Z][a-z]{2,} [A-Z][a-z]{2,}\b",
)
PUBLICATION_TYPES = (
    ("preprint", {"preprint"}),
    (
        "conference-abstract",
        {"conference abstract", "meeting abstract", "congress abstract"},
    ),
    ("case-report", {"case reports", "case report"}),
    ("review", {"review", "systematic review", "meta-analysis", "scoping review"}),
    (
        "clinical-trial-report",
        {
            "clinical trial",
            "clinical trial, phase i",
            "clinical trial, phase ii",
            "clinical trial, phase iii",
            "clinical trial, phase iv",
            "randomized controlled trial",
            "controlled clinical trial",
            "pragmatic clinical trial",
            "clinical trial, veterinary",
        },
    ),
    ("dataset-paper", {"data paper", "dataset", "data descriptor", "published data"}),
    ("letter", {"letter", "research letter"}),
    ("editorial", {"editorial"}),
    (
        "article",
        {
            "journal article",
            "research article",
            "observational study",
            "comparative study",
            "multicenter study",
        },
    ),
)
RESOLVERS = {
    "doi": "https://doi.org/",
    "pmid": "https://pubmed.ncbi.nlm.nih.gov/",
    "arxiv": "https://arxiv.org/abs/",
}


@dataclass(frozen=True)
class Projection:
    record: dict | None = None
    evidence: dict | None = None
    reason: str | None = None


def identity_tokens(record):
    return {
        record["id"],
        *(f"{key}:{record[key]}" for key in ("doi", "pmid", "pmcid", "arxiv") if record.get(key)),
    }


def source_pmcid(record):
    pmcid = record.get("pmcid") or (record.get("id") if record.get("source") == "PMC" else None)
    return pmcid if isinstance(pmcid, str) and re.fullmatch(r"PMC[0-9]+", pmcid) else None


def load_postal_codes(path):
    postal = defaultdict(set)
    with ZipFile(path) as archive, archive.open("US.txt") as stream:
        for line in stream:
            _, code, city, _, state, _, *_ = line.decode().rstrip("\r\n").split("\t")
            postal[code].add((norm(city), state))
    if not postal:
        raise ValueError("postal reference contains no localities")
    return postal


def source_open_access(records):
    access = next((result for record in records if (result := open_access(record))), None)
    if not access or not access["url"] or not any(c.isspace() for c in access["url"]):
        return access
    parts = urlsplit(access["url"])
    if parts.scheme != "https" or not parts.hostname or any(c.isspace() for c in parts.netloc):
        return None
    access["url"] = urlunsplit(
        parts._replace(
            path=quote(parts.path, safe="/%:@!$&'()*+,;=-._~"),
            query=quote(parts.query, safe="=%/?&:@!$'()*+,;~-._"),
            fragment=quote(parts.fragment, safe="%/?&=:@!$'()*+,;~-._"),
        )
    )
    return access


def publication_type(records, types):
    if all(record.get("source") == "PPR" for record in records):
        return "preprint"
    fallback = "article" if any(map(journal, records)) else "other"
    return next((name for name, indexed in PUBLICATION_TYPES if indexed & types), fallback)


class AnnualAffiliationRules(AffiliationRules):
    def claims(self, affiliation, separate=""):
        # Preserve a separate local clause when a joint Nemours/Jefferson clause gives Wilmington.
        clauses = re.split(r";|\n|\u2022|\s+\|\s+", affiliation)

        def outside_joint_site(clause):
            text = ortho(clean(clause))
            return all(name in text for name in ("nemours", "thomas jefferson", "wilmington")) and not any(
                city in text.split("wilmington", 1)[0] for city in ("philadelphia", "camden")
            )

        return super().claims(
            "; ".join(clause for clause in clauses if not outside_joint_site(clause)),
            separate,
        )


class MechanicalProjector:
    """Select new records from Europe PMC and preserve exact identity exclusions.

    Evidence is for a private run directory. Topic is unassigned in the projected
    record and must be established before the public validator or loader is called.
    """

    def __init__(
        self,
        registry: Path,
        postal_codes: Path,
        existing,
        excluded_identifiers,
        run_date: str,
        *,
        country_codes: Path | None = None,
    ):
        self.rules = AnnualAffiliationRules(registry, country_codes)
        self.postal = load_postal_codes(postal_codes)
        cities = "|".join(
            map(
                re.escape,
                sorted(self.rules.places, key=lambda city: (-len(city), city)),
            )
        )
        self.city_zip = re.compile(
            rf"\b({cities}) (?:({STATES}) )?(?:(?:united states(?: of america)?|usa|us) )?"
            r"(?:(?:zip(?: code)?|postal code) )?(\d{5})\b",
        )
        self.seen = {token for row in existing for token in identity_tokens(row)}
        self.excluded = set(excluded_identifiers)
        self.run_date = date.fromisoformat(run_date).isoformat()

    def postal_conflict(self, affiliation):
        for city, state, code in self.city_zip.findall(ortho(affiliation)):
            options = self.postal.get(code, ())
            state = STATE_CODE.get(state, state.upper())
            if not options or (city, code) in POSTAL_ALIASES:
                continue
            if not any(
                place == city and (not state or abbreviation == state) for place, abbreviation in options
            ):
                return True
        return False

    def select_byline(self, europe):
        selections = []
        for observation in europe:
            result = source_map(observation, self.rules)
            result["counties"] = sorted(
                {
                    county
                    for row in result["evidence"]
                    if not self.postal_conflict(row["affiliation"])
                    for county in row["counties"]
                }
            )
            selections.append(result)
        return max(
            selections,
            key=lambda value: (
                bool(value["direct"]),
                bool(value["counties"]),
                len(value["direct"]),
                len(value["authors"]),
            ),
        )

    def project(self, candidate, refreshed_records=None):
        if candidate["provider_key"][0] != "europepmc":
            return Projection(reason="no Europe PMC discovery route")
        if candidate["identifier_conflict"] or not candidate["id"]:
            return Projection(reason="unresolved identity")
        observations = candidate["observations"]
        indexed = [row for row in observations if row["provider"] == "europepmc"]
        if not indexed:
            return Projection(reason="no Europe PMC observation")

        replacements = refreshed_records or {}
        europe = [
            item
            | {"record": replacements.get((item["record"]["source"], item["record"]["id"]), item["record"])}
            for item in indexed
        ]
        records = [item["record"] for item in europe]
        all_indexed = [item["record"] for item in indexed] + records
        identifiers = set(candidate["identifiers"])
        pmcids = {value for record in all_indexed if (value := source_pmcid(record))}
        for record in all_indexed:
            identifiers.update(epmc_ids(record))
        keys = identifiers | {f"pmcid:{value}" for value in pmcids}
        if keys & self.excluded:
            return Projection(reason="prior privacy hold or removal")
        if keys & self.seen:
            return Projection(reason="duplicate or already published")
        ids = {}
        for kind in RESOLVERS:
            matches = {value.split(":", 1)[1] for value in identifiers if value.startswith(f"{kind}:")}
            if len(matches) > 1:
                return Projection(reason="unresolved identity")
            ids[kind] = next(iter(matches), None)
        identifier = next(((kind, value) for kind, value in ids.items() if value), None)
        if identifier is None:
            return Projection(reason="no supported scholarly identifier")

        selected = self.select_byline(europe)
        if not all(selected[key] for key in ("direct", "title", "authors", "source")):
            return Projection(reason="no qualifying literal byline")
        types = {
            value.casefold()
            for row in records
            for value in (row.get("pubTypeList") or {}).get("pubType", [])
            if isinstance(value, str)
        }
        titles = [plain(row.get("title")) or "" for row in records]
        is_notice = bool(types & {"retraction of publication", "expression of concern"}) or any(
            NOTICE.search(title) for title in titles
        )
        if "case reports" in types or is_notice:
            texts = titles + [plain(row.get("abstractText")) or "" for row in records]
            if any(
                PATIENT.search(text) or (is_notice and MISCONDUCT.search(text) and PERSON.search(text))
                for text in texts
            ):
                return Projection(reason="potential privacy hold")
        if types & EXCLUDED_TYPES or any(EXCLUDED_TITLE.search(title) for title in titles):
            return Projection(reason="excluded by indexed type or title")

        supplemental = [row for row in observations if row["provider"] != "europepmc"]
        if any(re.match(r"^withdrawn\s*:", title, re.I) for title in titles):
            withdrawals = {
                f"doi:{value}"
                for row in supplemental
                if row["provider"] == "crossref"
                for notice in row["record"].get("update-to", [])
                if notice.get("type") == "withdrawal" and (value := doi(notice.get("DOI")))
            }
            if identifiers & withdrawals:
                return Projection(reason="publisher-withdrawn original")

        exact_sources = europe + supplemental
        published = earliest_date(exact_sources, through=self.run_date)
        if not published:
            return Projection(reason="publication date unsupported")

        identifier_kind, identifier_value = identifier
        pid = f"{identifier_kind}:{identifier_value}"
        selected_source = selected["source"]
        records.sort(key=lambda row: source_url("europepmc", row) != selected_source)
        people = selected["authors"]
        byline = (
            people
            if len(people) <= 30
            else [
                person
                for index, person in enumerate(people)
                if index < 10 or index == len(people) - 1 or person["regional"]
            ]
        )
        direct = selected["direct"]
        parents = selected["parents"]
        names = ", ".join(self.rules.inst[slug]["name"] for slug in direct)
        lead = (
            "An author affiliation on the Europe PMC record names "
            if len(direct) == 1
            else ("Author affiliations on the Europe PMC record name ")
        )
        connection = lead + names
        if parents:
            connection += ", with " + ", ".join(self.rules.inst[slug]["name"] for slug in parents)
            connection += " linked by the institution reference"
        if not connection.endswith("."):
            connection += "."
        row = {
            "id": pid,
            "title": selected["title"],
            "type": publication_type(records, types),
            "published": published,
            "venue": next((value for record in records if (value := journal(record))), None),
            **ids,
            "pmcid": next(iter(pmcids)) if len(pmcids) == 1 else None,
            "url": RESOLVERS[identifier_kind] + quote(identifier_value, safe="/"),
            "authors": byline,
            "author_count": len(people),
            "institutions": sorted(set(direct) | set(parents)),
            "counties": selected["counties"],
            "topic": None,
            "terms": next((terms for record in records if (terms := selected_terms(record))), []),
            "label": "Verified" if selected["counties"] else "Listed",
            "connection": connection,
            "source": selected_source,
            "open_access": source_open_access(records),
            "projects": [],
            "preprint_of": None,
            "published_as": None,
            "retracted": "retracted publication" in types,
            "added": self.run_date,
            "checked": self.run_date,
        }
        self.seen.update(keys)
        return Projection(
            record=row,
            evidence={
                "id": pid,
                "public": row,
                "sources": exact_sources,
                "archive_dates": [],
                "explicit_online_dates": list(electronic_dates(exact_sources)),
                "index_dates": sorted(
                    {
                        item["record"]["firstIndexDate"]
                        for item in indexed
                        if item["record"].get("firstIndexDate")
                    }
                ),
            },
        )
