"""Stage 1: export visible publications with a PMCID from production D1 (read-only SELECT)."""
import json
import os
import subprocess
import sys

sys.path.insert(0, __import__("os").path.dirname(__import__("os").path.abspath(__file__)))
from common import CHECKOUT, work_dir, write_json

SQL = """SELECT id, json_extract(record,'$.pmcid') AS pmcid, json_extract(record,'$.doi') AS doi, title,
 json_extract(record,'$.pmid') AS pmid,
 json_extract(record,'$.published') AS published, topic, json_extract(record,'$.institutions') AS institutions,
 json_extract(record,'$.counties') AS counties, json_extract(record,'$.label') AS label
 FROM research_visible WHERE kind='publication' AND json_extract(record,'$.pmcid') IS NOT NULL"""


def main():
    out = work_dir() / "papers.json"
    if out.exists() and "--force" not in sys.argv:
        print("papers.json exists; skipping export"); return
    env = dict(os.environ, CLOUDFLARE_ACCOUNT_ID=os.environ.get("CLOUDFLARE_ACCOUNT_ID", "1e5f92087e779df50f3f3546a0eed22e"))
    cmd = ["npx", "--no-install", "wrangler", "d1", "execute", "the-valley-desk", "--remote", "--json",
           "--command", " ".join(SQL.split())]
    res = subprocess.run(cmd, cwd=CHECKOUT, env=env, stdin=subprocess.DEVNULL, capture_output=True, text=True, check=True)
    data = json.loads(res.stdout)
    rows = data[0]["results"]
    for r in rows:
        r["institutions"] = json.loads(r["institutions"] or "[]")
        r["counties"] = json.loads(r["counties"] or "[]")
    write_json(out, rows)
    print("exported", len(rows), "rows_read", data[0]["meta"].get("rows_read"))


if __name__ == "__main__":
    main()
