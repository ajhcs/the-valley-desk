"""Stage 6: DataCite datasets whose creators carry a regional-institution ROR.

Raw pages are cached under datacite-inst/<registry id>/<n>.json.gz. Filtering happens in build.py.
"""
import json
import os
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import SKIP_OUTSIDE, http, read_gz_json, registry, save_counts, work_dir, write_gz_json

API = "https://api.datacite.org/dois?"


def fetch_institution(inst, root):
    d = root / inst["id"]; d.mkdir(parents=True, exist_ok=True)
    if (d / "done").exists():
        return
    ror = inst["ror"].rstrip("/")
    url = API + urllib.parse.urlencode({
        "query": f'creators.affiliation.affiliationIdentifier:"{ror}"',
        "resource-type-id": "dataset", "page[size]": 500, "page[cursor]": 1, "affiliation": "true"})
    n = 0
    while url:
        f = d / f"{n:04d}.json.gz"
        if f.exists():
            page = read_gz_json(f)
        else:
            status, body = http(url, timeout=180, accept="application/vnd.api+json")
            if status != 200:
                print("failed", inst["id"], status, flush=True); return
            page = json.loads(body)
            write_gz_json(f, page)
        url = (page.get("links") or {}).get("next") if page.get("data") else None
        n += 1
    (d / "done").write_text("ok")
    print(inst["id"], "pages", n, flush=True)


def main():
    root = work_dir() / "datacite-inst"; root.mkdir(exist_ok=True)
    for inst in registry():
        if inst.get("ror") and inst["id"] not in SKIP_OUTSIDE:
            fetch_institution(inst, root)
    save_counts("datacite-institution")


if __name__ == "__main__":
    main()
