"""Collect independently dated PubMed and preprint observations for private review."""
from collections import defaultdict
from datetime import timedelta
import re
from time import monotonic, sleep
from urllib.parse import quote
from xml.etree import ElementTree

from collect import deduplicate, doi, pmid
from mechanical import identity_tokens
from metadata import iso_precision, issue_date

PROVIDERS = ("pubmed", "biorxiv", "medrxiv")
PUBMED_MAX = 10_000
PREPRINT_PAGE = 30
GITHUB_LINK = re.compile(
    r"""(?<![A-Za-z0-9.@/-])(?:https?://)?(?:www\.)?github\.com/([A-Za-z0-9-]+)/"""
    r"""([A-Za-z0-9_.-]+)(?=$|[/?#\s)>;,'"])""", re.I)
CODE_STATEMENT = re.compile(
    r"\b(?:code availability|(?:source |analysis )?code (?:and data )?(?:for (?:this|the) (?:study|work) )?"
    r"(?:is |are |was )?(?:publicly )?(?:available|released|provided)|we (?:provide|release) (?:the|our) code"
    r"|code\b[^.!?]{0,100}\b(?:is|are|was) (?:publicly |freely )?available)\b", re.I)


class CoverageError(RuntimeError):
    """The source did not establish coverage of the requested search."""


def parse_xml(data):
    if not data.strip() or re.search(rb"<!ENTITY|<!DOCTYPE[^>]*\[", data, re.I):
        raise CoverageError("Unsafe or empty provider XML")
    return ElementTree.fromstring(data)


def text(parent, path):
    node = parent.find(path)
    return " ".join("".join(node.itertext()).split()) if node is not None else ""


def github_urls(values):
    return sorted({
        f"https://github.com/{owner.casefold()}/{name.casefold().rstrip('.').removesuffix('.git')}"
        for value in values for owner, name in GITHUB_LINK.findall(value)
        if name.casefold().rstrip(".").removesuffix(".git") and owner.casefold() not in {"orgs", "users", "topics", "search"}
    })


def jats_repositories(document, pmcid):
    if document.tag == "pmc-articleset" and len(document) == 1:
        document = document[0]
    meta = document.find("./front/article-meta")
    if document.tag != "article" or meta is None:
        raise CoverageError("Unexpected full-text document")
    ids = {f"PMC{(node.text or '').removeprefix('PMC')}" for node in meta.findall("article-id")
           if node.get("pub-id-type") in {"pmcid", "pmc"}}
    if ids != {pmcid}:
        raise CoverageError("Full-text document did not confirm the requested PMCID")
    results = set()
    for container in ("front", "body", "back"):
        root = document.find(container)
        if root is None:
            continue
        for section in root.iter():
            if section.tag not in {"sec", "notes", "fn"}:
                continue
            heading = next((label for path in ("title", "label", "p/bold", "p/italic")
                            if (label := text(section, path))), "")
            kind = {section.get(key) for key in ("sec-type", "notes-type", "fn-type")}
            if CODE_STATEMENT.search(heading) or "code-availability" in kind:
                for paragraph in section.findall("p"):
                    results.update(paragraph_repositories(paragraph, named_section=True))
        if container != "front":
            for paragraph in root.iter("p"):
                results.update(paragraph_repositories(paragraph))
    return sorted(results)


def paragraph_repositories(paragraph, *, named_section=False):
    statement = " ".join(paragraph.itertext())
    if not named_section and not CODE_STATEMENT.search(statement):
        return []
    return github_urls([statement, *(item.get("{http://www.w3.org/1999/xlink}href", "")
                                     for item in paragraph.iter("ext-link"))])


def pubmed_date(node):
    year, month, day = (text(node, key) for key in ("Year", "Month", "Day"))
    if not year:
        return issue_date(text(node, "MedlineDate"))
    if month.isdecimal():
        month = month.zfill(2)
    if day.isdecimal():
        day = day.zfill(2)
    parts = [part for part in (year, month, day) if part]
    return issue_date(" ".join(parts)) if month and not month.isdecimal() else iso_precision("-".join(parts))


def pubmed_records(document, expected):
    if document.tag != "PubmedArticleSet":
        raise CoverageError("Unexpected PubMed response type")
    records = {}
    for entry in document:
        if entry.tag == "PubmedArticle":
            citation = entry.find("MedlineCitation")
            article = entry.find("MedlineCitation/Article")
            metadata = entry.find("PubmedData")
        elif entry.tag == "PubmedBookArticle":
            citation = article = entry.find("BookDocument")
            metadata = entry.find("PubmedBookData")
        else:
            raise CoverageError("Unexpected PubMed citation type")
        if citation is None or article is None:
            raise CoverageError("Missing PubMed citation")
        identifier = pmid(text(citation, "PMID"))
        if identifier not in expected or identifier in records:
            raise CoverageError("Unrequested or repeated PMID")
        values = {f"pmid:{identifier}"}
        for node in article.findall("ELocationID"):
            if node.get("EIdType") == "doi" and node.get("ValidYN") != "N" and (value := doi((node.text or "").strip())):
                values.add(f"doi:{value}")
        dates = {}
        if metadata is not None:
            for node in metadata.findall("ArticleIdList/ArticleId"):
                if node.get("IdType") == "doi" and (value := doi((node.text or "").strip())):
                    values.add(f"doi:{value}")
                if node.get("IdType") == "pmc" and re.fullmatch(r"PMC[1-9][0-9]*", node.text or ""):
                    values.add(f"pmcid:{node.text}")
            for node in metadata.findall("History/PubMedPubDate"):
                if (kind := node.get("PubStatus")) in {"entrez", "epublish"} and (day := pubmed_date(node)):
                    dates[kind] = day
        affiliations = [text(node, "Affiliation") for node in article.findall("AuthorList/Author/AffiliationInfo")]
        online = next((day for node in article.findall("ArticleDate") if node.get("DateType") == "Electronic"
                       and (day := pubmed_date(node))), dates.get("epublish"))
        issue = article.find("Journal/JournalIssue/PubDate")
        if issue is None:
            issue = article.find("Book/PubDate")
        types = {(node.text or "").casefold() for node in article.findall("PublicationTypeList/PublicationType")}
        kind = "book" if entry.tag == "PubmedBookArticle" else "preprint" if "preprint" in types else "citation"
        records[identifier] = {
            "source_id": identifier, "identifiers": sorted(values), "title": text(article, "ArticleTitle"),
            "source": f"https://pubmed.ncbi.nlm.nih.gov/{identifier}/",
            "kind": kind,
            "created_in_pubmed": dates.get("entrez"), "published_online": online,
            "issue_date": pubmed_date(issue) if issue is not None else None,
            "affiliations": [value for value in affiliations if value],
        }
    if records.keys() != set(expected):
        raise CoverageError("PubMed EFetch did not return all requested PMIDs")
    return records


def collect_pubmed(get, roster, start, end):
    names = sorted({name.replace('"', "").strip() for row in roster
                    for name in [row["name"], *row["aliases"]] if len(name.strip()) > 3})
    if not names:
        raise CoverageError("No PubMed affiliation search terms")
    identifiers = set()

    def search(terms, first, last):
        query = " OR ".join(f'"{name}"[ad:~0]' for name in terms)
        from_day, to_day = (day.isoformat().replace("-", "/") for day in (first, last))
        result = get("pubmed", "/esearch.fcgi", {
            "db": "pubmed", "retmode": "json", "retmax": PUBMED_MAX, "tool": "TheValleyDesk",
            "term": f"({query}) AND ({from_day}:{to_day}[crdt])",
        })["esearchresult"]
        if result.get("errorlist") or int(result["retstart"]) != 0:
            raise CoverageError("PubMed search reported an error")
        count = int(result["count"])
        if count > PUBMED_MAX:
            if first < last:
                midpoint = first + (last - first) // 2
                search(terms, first, midpoint)
                search(terms, midpoint + timedelta(days=1), last)
                return
            if len(terms) > 1:
                midpoint = len(terms) // 2
                search(terms[:midpoint], first, last)
                search(terms[midpoint:], first, last)
                return
            raise CoverageError("PubMed search exceeded its result limit")
        ids = result["idlist"]
        if count != len(ids) or count != len(set(ids)) or any(pmid(value) != value for value in ids):
            raise CoverageError("PubMed ESearch did not return every unique result")
        identifiers.update(ids)

    for start_at in range(0, len(names), 12):
        search(names[start_at:start_at + 12], start, end)
    ordered = sorted(identifiers, key=int)
    for start_at in range(0, len(ordered), 100):
        requested = ordered[start_at:start_at + 100]
        document = get("pubmed", "/efetch.fcgi", {
            "db": "pubmed", "id": ",".join(requested), "retmode": "xml", "tool": "TheValleyDesk",
        }, decode=parse_xml, accept="application/xml")
        yield from pubmed_records(document, requested).values()


def preprint_feed(get, provider, start, end, *, published=False):
    offset, total = 0, None
    previous_page = None
    route, size = ("pubs", 100) if published else ("details", PREPRINT_PAGE)
    empty = f"no articles found for {start} {end}" if published else "no posts found"
    while total is None or offset < total:
        endpoint = f"/{route}/{provider}/{start}/{end}/{offset}"
        result = get(provider, endpoint if published else endpoint + "/json", {})
        status, = result["messages"]
        rows = result["collection"]
        if offset == 0 and not rows and status.get("status", "").lower() == empty:
            return
        count = int(status["total"])
        if total is None:
            total = count
        if (status["status"] != "ok" or status["interval"] != f"{start}:{end}" or int(status["cursor"]) != offset
                or total != count or len(rows) != int(status["count"]) or len(rows) != min(size, total - offset)
                or rows == previous_page):
            raise CoverageError("Preprint feed did not cover the requested page")
        yield from rows
        previous_page = rows
        offset += len(rows)


def collect_preprints(get, provider, start, end):
    seen = {}
    for row in preprint_feed(get, provider, start, end):
        identifier, version, posted = doi(row["doi"]), int(row["version"]), iso_precision(row["date"])
        key = (identifier, version)
        relation = doi(row.get("published"))
        if (not identifier or version < 1 or (row.get("server") or "").casefold() != provider
                or not posted or len(posted) != 10 or not str(start) <= posted <= str(end)
                or relation == identifier):
            raise CoverageError("Invalid preprint version")
        if key in seen:
            if row != seen[key]:
                raise CoverageError("Conflicting observations of the same preprint version")
            continue
        seen[key] = row
        yield {
            "source_id": identifier, "identifiers": [f"doi:{identifier}"], "version": version,
            "kind": "preprint", "version_posted": posted, "first_posted": posted if version == 1 else None,
            "published_as_doi": relation, "title": row["title"],
            "source": "https://doi.org/" + quote(identifier, safe="/"),
            "affiliations": [row["author_corresponding_institution"]] if row.get("author_corresponding_institution") else [],
            "code_links": github_urls([row["abstract"]]) if CODE_STATEMENT.search(row.get("abstract") or "") else [],
        }


def collect_published_preprints(get, provider, start, end):
    seen = {}
    for row in preprint_feed(get, provider, start, end, published=True):
        preprint, journal = doi(row["preprint_doi"]), doi(row["published_doi"])
        published = iso_precision(row["published_date"])
        if (not preprint or not journal or preprint == journal
                or row["preprint_platform"].casefold() != provider
                or not published or len(published) != 10 or not str(start) <= published <= str(end)):
            raise CoverageError("Invalid preprint publication relation")
        key = preprint, journal
        if key in seen:
            if row != seen[key]:
                raise CoverageError("Conflicting observations of the same preprint publication relation")
            continue
        seen[key] = row
        institution = row.get("preprint_author_corresponding_institution")
        yield {
            "preprint": f"doi:{preprint}", "journal": f"doi:{journal}", "journal_publication_day": published,
            "provider": provider, "source": "https://doi.org/" + quote(preprint, safe="/"),
            "affiliations": [institution] if institution else [],
        }


def paced_requests(receipts):
    """Share a request interval between the preprint feeds on their single API host."""
    last_request = {}

    def get(provider, endpoint, params, **options):
        host = "preprint" if provider in {"biorxiv", "medrxiv"} else provider
        interval = 0.75 if host == "europepmc" else 0.5
        if host in last_request:
            sleep(max(0, interval - (monotonic() - last_request[host])))
        last_request[host] = monotonic()
        return receipts.get(provider, endpoint, params, replay=True, attempts=1, **options)

    return get


def reconcile(observations, baseline, holds):
    by_key = {(row["provider"], row["source_id"], row.get("version", 0)): {
        "provider": row["provider"], "record": row, "institutions": set(row["institutions"]),
    } for row in observations}
    seen, catalog = defaultdict(set), {row["id"]: row for row in baseline}
    for owner, row in catalog.items():
        for value in identity_tokens(row):
            seen[value].add(owner)

    def known_identifiers(observation):
        tokens = set(observation["record"]["identifiers"])
        for owner in {owner for token in tokens for owner in seen[token]}:
            tokens.update(identity_tokens(catalog[owner]))
        return sorted(tokens)

    for group in deduplicate(by_key, identifiers_for=known_identifiers):
        all_tokens = set(group["identifiers"])
        exact = group["observations"]
        tokens = {token for entry in exact for token in entry["record"]["identifiers"]}
        owners = {owner for token in tokens for owner in seen[token]}
        kinds = {entry["record"]["kind"] for entry in exact}
        kinds.update("preprint" if catalog[owner]["type"] == "preprint" else "citation" for owner in owners)
        versions = sorted({entry["record"]["published_as_doi"] for entry in exact
                           if entry["record"].get("published_as_doi")})
        if all_tokens & holds:
            yield {"status": "held", "providers": sorted({row["provider"] for row in exact})}
            continue
        repeated_kind = any(sum(value.startswith(kind + ":") for value in all_tokens) > 1
                            for kind in ("doi", "pmid", "arxiv", "pmcid"))
        conflict = repeated_kind or len(owners) > 1 or ("preprint" in kinds and "citation" in kinds)
        yield {
            "status": "identity_conflict" if conflict else "existing" if owners else "candidate",
            "identifiers": sorted(tokens), "catalog_ids": sorted(owners),
            "published_as_dois": versions, "observations": [entry["record"] for entry in exact],
        }
