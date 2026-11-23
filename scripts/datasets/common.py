"""Shared helpers for the datasets pipeline: polite HTTP, caches, registry and counters."""
import gzip
import json
import os
import random
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

USER_AGENT = "valley-desk-research/1.0"
TODAY = date.fromisoformat(os.environ.get("TVD_DATASETS_DATE") or
                           datetime.now(ZoneInfo("America/New_York")).date().isoformat()).isoformat()
CHECKOUT = Path(__file__).resolve().parents[2]
REGISTRY_PATH = CHECKOUT / "src" / "content" / "public-directory-institutions.json"
COUNTIES = {"Bucks", "Chester", "Delaware", "Montgomery", "Philadelphia",
            "Burlington", "Camden", "Gloucester", "Mercer"}
# Institutions whose main campus or headquarters is outside the region.
SKIP_OUTSIDE = {"penn-state", "rutgers", "johnson-and-johnson", "merck", "gsk", "bristol-myers-squibb"}

_host_locks = {}
_host_guard = threading.Lock()
_host_last = {}
_count_lock = threading.Lock()
COUNTS = Counter()
FAILS = Counter()
MAX_PER_HOST = 3
# Minimum spacing between request starts per host (NCBI allows about 3/s without a key).
MIN_GAP = {"eutils.ncbi.nlm.nih.gov": 0.36, "www.ncbi.nlm.nih.gov": 0.36}


def work_dir():
    return Path(os.environ.get("TVD_DATASETS_WORK", "/workspace/build/builderbob/tvd-datasets-phase1"))


def _sem(host):
    with _host_guard:
        if host not in _host_locks:
            _host_locks[host] = threading.BoundedSemaphore(MAX_PER_HOST)
        return _host_locks[host]


def _pace(host):
    gap = MIN_GAP.get(host)
    if not gap:
        return
    while True:
        with _host_guard:
            now = time.monotonic()
            wait = _host_last.get(host, 0) + gap - now
            if wait <= 0:
                _host_last[host] = now
                return
        time.sleep(wait)


def http(url, data=None, timeout=90, attempts=5, accept=None, ok404=False, content_type=None):
    """GET (or POST when data is given). Returns (status, bytes). Retries with backoff on errors/429/5xx."""
    host = urllib.parse.urlsplit(url).hostname
    headers = {"User-Agent": USER_AGENT}
    if accept:
        headers["Accept"] = accept
    if content_type:
        headers["Content-Type"] = content_type
    if isinstance(data, dict):
        data = urllib.parse.urlencode(data).encode()
    last = None
    for attempt in range(attempts):
        with _sem(host):
            _pace(host)
            with _count_lock:
                COUNTS[host] += 1
            try:
                req = urllib.request.Request(url, data=data, headers=headers)
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    return r.status, r.read()
            except urllib.error.HTTPError as e:
                last = e.code
                if e.code in (400, 404, 410) and ok404:
                    return e.code, e.read() if hasattr(e, "read") else b""
                if e.code in (400, 401, 403, 404, 410):
                    with _count_lock:
                        FAILS[host] += 1
                    return e.code, b""
                retry_after = e.headers.get("Retry-After") if e.headers else None
                delay = float(retry_after) if retry_after and retry_after.isdigit() else 2 ** attempt * 2
            except Exception as e:  # network errors, timeouts
                last = type(e).__name__
                delay = 2 ** attempt * 2
        time.sleep(delay + random.random())
    with _count_lock:
        FAILS[host] += 1
    return last if isinstance(last, int) else 0, b""


def save_counts(stage):
    path = work_dir() / "requests.json"
    data = json.loads(path.read_text()) if path.exists() else {}
    prev = data.get(stage, {"requests": {}, "failures": {}})
    for k, v in COUNTS.items():
        prev["requests"][k] = prev["requests"].get(k, 0) + v
    for k, v in FAILS.items():
        prev["failures"][k] = prev["failures"].get(k, 0) + v
    data[stage] = prev
    path.write_text(json.dumps(data, indent=1, sort_keys=True))
    COUNTS.clear(); FAILS.clear()


def write_gz_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with gzip.open(tmp, "wt", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    tmp.replace(path)


def read_gz_json(path):
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)


def write_json(path, obj):
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False))
    tmp.replace(path)


def write_jsonl(path, rows):
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False, sort_keys=False) + "\n")
    tmp.replace(path)


def read_jsonl(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def registry():
    return json.loads(REGISTRY_PATH.read_text())


def ror_index():
    """ROR id (bare, lowercase) -> registry entry, excluding institutions centred outside the region."""
    out = {}
    for inst in registry():
        if inst.get("ror") and inst["id"] not in SKIP_OUTSIDE:
            out[inst["ror"].rstrip("/").rsplit("/", 1)[-1].lower()] = inst
    return out


def inst_counties(inst):
    c = {s.get("county") for s in inst.get("sites") or [] if s.get("county") in COUNTIES}
    if inst.get("homeCounty") in COUNTIES:
        c.add(inst["homeCounty"])
    return c


# Regional names used to read free-text submitter fields (GEO, BioProject, PRIDE, dbGaP).
# Each pattern maps to a registry id. Order matters: specific before general.
REGIONAL_NAMES = [
    (r"children'?s hospital of philadelphia|\bCHOP\b", "chop"),
    (r"perelman school of medicine", "perelman-school-of-medicine"),
    (r"hospital of the university of pennsylvania", "hospital-of-the-university-of-pennsylvania"),
    (r"penn presbyterian", "penn-presbyterian"),
    (r"university of pennsylvania|\bupenn\b|penn medicine", "upenn"),
    (r"wistar", "wistar"),
    (r"fox chase", "fox-chase"),
    (r"lewis katz school of medicine", "lewis-katz-school-of-medicine"),
    (r"temple university", "temple-university"),
    (r"drexel", "drexel"),
    (r"sidney kimmel", "sidney-kimmel-medical-college"),
    (r"thomas jefferson university|jefferson university|jefferson medical college", "thomas-jefferson-university"),
    (r"monell", "monell"),
    (r"coriell", "coriell"),
    (r"lankenau institute", "limr"),
    (r"blumberg institute", "blumberg-institute"),
    (r"princeton university|princeton neuroscience", "princeton-university"),
    (r"cooper medical school", "cooper-medical-school"),
    (r"rowan university", "rowan-university"),
    (r"villanova", "villanova-university"),
    (r"swarthmore", "swarthmore-college"),
    (r"haverford college", "haverford-college"),
    (r"bryn mawr college", "bryn-mawr-college"),
    (r"saint joseph'?s university|st\.? joseph'?s university", "saint-josephs-university"),
    (r"university of the sciences", "university-of-the-sciences"),
    (r"philadelphia college of osteopathic", "pcom"),
    (r"college of new jersey", "the-college-of-new-jersey"),
    (r"wills eye", "wills-eye-hospital"),
    (r"philadelphia va|corporal michael j\.? crescenz|crescenz va", "philadelphia-va-medical-center"),
    (r"nemours", "nemours"),
    (r"st\.? christopher'?s hospital", "st-christophers-hospital"),
    (r"west chester university", "west-chester-university"),
    (r"deborah heart", "deborah-heart-and-lung-center"),
    (r"salus university", "salus"),
    (r"capital health", "capital-health"),
    (r"main line health", "main-line-health"),
    (r"virtua", "virtua-health"),
    (r"rutgers.{0,20}camden", "rutgers-camden"),
    (r"penn state abington", "penn-state-abington"),
]
REGIONAL_NAMES = [(re.compile(p, re.I), i) for p, i in REGIONAL_NAMES]
# Registry ids whose names alone do not settle a regional site (multi-site organisations).
MULTISITE = {"nemours", "virtua-health", "main-line-health"}
REGION_CITIES = re.compile(
    r"\b(philadelphia|camden|trenton|princeton|lawrenceville|cherry hill|doylestown|langhorne|wynnewood|"
    r"bala cynwyd|glenside|blue bell|king of prussia|wayne|villanova|radnor|swarthmore|haverford|bryn mawr|"
    r"media|west chester|exton|malvern|chester|norristown|lansdale|plymouth meeting|horsham|ambler|"
    r"conshohocken|fort washington|newtown|bristol|levittown|stratford|glassboro|sewell|voorhees|"
    r"mount laurel|marlton|moorestown|willingboro|browns mills|ewing|hamilton|pennington|hopewell|"
    r"plainsboro|cranbury|lambertville|abington|elkins park|upper darby|chesterbrook|spring house)\b", re.I)


def regional_ids(text):
    """Registry ids named in free text."""
    found = []
    for rx, iid in REGIONAL_NAMES:
        if rx.search(text or "") and iid not in found:
            found.append(iid)
    # A sub-unit implies its parent only when the parent is named too; do not add parents silently.
    return found


def strip_markup(s):
    import html as _html
    s = re.sub(r"<[^>]+>", " ", s or "")
    s = _html.unescape(s)
    return re.sub(r"\s+", " ", s).strip()


MARKETING = re.compile(r"\b(novel|groundbreaking|cutting[- ]edge|state[- ]of[- ]the[- ]art|unprecedented|comprehensive|first[- ]ever|revolutionary)\s+", re.I)


def one_sentence(text, limit=240):
    """First meaningful sentence from repository text, trimmed to the limit."""
    t = strip_markup(text)
    t = re.sub(r"^(abstract|summary|description|overview|background|this dataset|dataset)\s*[:.\-]\s*", "", t, flags=re.I)
    t = re.sub(r"\s*\((?:https?://|doi:)[^)]*\)", "", t)
    parts = re.split(r"(?<=[a-z0-9\)\]%])[.!?]\s+(?=[A-Z])", t)
    sentence = ""
    for p in parts:
        p = p.strip()
        if len(p) < 25 or re.match(r"(?i)(this (?:sub)?series|this superseries|refer to individual|keywords?:|overall design)", p):
            if not sentence and len(p) >= 25:
                pass
            else:
                continue
        sentence = p
        break
    if not sentence:
        sentence = parts[0].strip() if parts else ""
    sentence = MARKETING.sub("", sentence).strip()
    if sentence and sentence[0].islower():
        sentence = sentence[0].upper() + sentence[1:]
    if len(sentence) > limit - 1:
        cut = sentence[:limit - 1]
        cut = cut[:cut.rfind(" ")] if " " in cut[60:] else cut
        sentence = cut.rstrip(",;:- ") + "…"
    elif sentence and sentence[-1] not in ".!?":
        sentence += "."
    return sentence
