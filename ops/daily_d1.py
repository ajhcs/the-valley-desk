"""D1 access and public snapshot storage for the daily directory job."""

from collections import defaultdict
import json
import os
import re
import subprocess
from urllib.parse import quote as url_quote

DATABASE = "the-valley-desk"
ORIGIN = "https://thevalleydesk.org"
SNAPSHOT_REF = "refs/heads/data/directory-snapshots"
KINDS = ("project", "publication", "study")
REMOVALS = {
    "project": "SELECT github_id AS id FROM public_directory_removals",
    "publication": "SELECT id FROM publication_removals",
    "study": "SELECT id FROM study_removals",
}
INBOX = "SELECT id,kind,item_type,url FROM reader_inbox WHERE status='new' AND id > {after} ORDER BY id LIMIT 500"
VERSION = "SELECT first FROM research_summary_kinds WHERE scope_field='data' AND scope_value='' AND kind='directory'"
PROJECTS = "SELECT id,record FROM research_listings WHERE kind='project'"
PROBE = "SELECT id FROM research_visible WHERE kind='project' ORDER BY id LIMIT 1"
LISTINGS = "SELECT id,record FROM research_visible WHERE kind={kind} AND id>{after} ORDER BY id LIMIT 2000"


def compact(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def quote(value):
    if "\0" in value:
        raise ValueError("NUL in SQL input")
    return "'" + value.replace("'", "''") + "'"


def save(path, value):
    staged = path.with_suffix(".tmp")
    staged.write_text(compact(value) + "\n", encoding="utf-8")
    staged.replace(path)


def command(root, *args, label, input=None, env=None, timeout=600):
    result = subprocess.run(args, input=input, text=True, capture_output=True, cwd=root, timeout=timeout, env=env)
    if result.returncode:
        raise RuntimeError(f"{label} exited {result.returncode}")
    return result.stdout


class D1:
    def __init__(self, root):
        self.root = root
        bindings = json.loads((root / "wrangler.jsonc").read_text())["d1_databases"]
        if len(bindings) != 1 or bindings[0]["binding"] != "VALLEY_DESK_DB" or bindings[0]["database_name"] != DATABASE:
            raise RuntimeError("Unexpected D1 target")
        self.wrangler = str(root / "node_modules/.bin/wrangler")
        self.reads = defaultdict(int)
        self.unmeasured = set()

    def execute(self, flag, value, label):
        unattended = ("--yes",) if flag == "--file" else ()
        response = command(self.root, self.wrangler, "d1", "execute", DATABASE, "--remote",
                           "--json", *unattended, flag, str(value), label=label)
        # Imports can print progress before the result array.
        start = re.search(r"^\[\s*(?:\{|\])", response, re.M)
        if not start:
            raise RuntimeError(f"{label} returned no D1 result")
        payload = json.JSONDecoder().raw_decode(response[start.start():])[0]
        if not payload or any(item.get("success") is not True for item in payload):
            raise RuntimeError(f"{label} failed in D1")
        for item in payload:
            count = item.get("meta", {}).get("rows_read")
            if not isinstance(count, int):
                self.unmeasured.add(label)
            else:
                self.reads[label] += count
        return payload

    def rows(self, sql, label):
        return self.execute("--command", sql, label)[0]["results"]

    def bookmark(self):
        payload = json.loads(command(self.root, self.wrangler, "d1", "time-travel", "info", DATABASE,
                                     "--json", label="D1 bookmark"))
        value = payload.get("bookmark")
        if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f-]{30,100}", value):
            raise RuntimeError("D1 did not return a Time Travel bookmark")
        return value

    def revision(self):
        rows = self.rows(VERSION, "directory revision")
        return rows[0]["first"] if rows else None

    def probe(self):
        found = self.rows(PROBE, "smoke project candidate")
        if not found or not re.fullmatch(r"[1-9][0-9]{0,19}", found[0]["id"]):
            raise RuntimeError("No public project available for the live check")
        return found[0]["id"]

    def listings(self, kind):
        result = {}
        last = ""
        while True:
            page = self.rows(LISTINGS.format(kind=quote(kind), after=quote(last)), f"{kind} inventory")
            for row in page:
                record = json.loads(row["record"])
                if record["id"] != row["id"]:
                    raise RuntimeError(f"Invalid {kind} identity")
                result[record["id"]] = record
            if len(page) < 2000:
                return result
            last = page[-1]["id"]

    def inbox(self):
        last = 0
        while True:
            rows = self.rows(INBOX.format(after=last), "new inbox rows")
            yield from rows
            if len(rows) < 500:
                return
            last = int(rows[-1]["id"])


def git(root, *args, **kwargs):
    return command(root, "git", *args, label="Git snapshot " + args[0], **kwargs).strip()


def snapshot(root, run_dir, day, records):
    """Push a public-data-only commit using an isolated index and a normal fast-forward push."""
    latest = git(root, "ls-remote", "origin", SNAPSHOT_REF)
    parent = latest.split()[0] if latest else None
    if parent:
        git(root, "fetch", "--quiet", "origin", SNAPSHOT_REF)
        stamp = git(root, "show", "-s", "--format=%s", parent)
        if stamp == f"Directory data {day}":
            return parent
    # A fresh index avoids recording checkout files, credentials or acquisition state.
    env = dict(os.environ, GIT_INDEX_FILE=str(run_dir / "snapshot.index"))
    git(root, "read-tree", "--empty", env=env)
    files = defaultdict(list)
    for kind, entries in records.items():
        for identifier, record in sorted(entries.items()):
            name = "regional-data.jsonl" if kind == "regional-data" else kind + "s.jsonl"
            if kind == "publication":
                year = (record.get("published") or "")[:4]
                name = f"publications/{year if year.isdigit() else 'undated'}.jsonl"
            files[name].append(compact(record))
    index = []
    for name, lines in sorted(files.items()):
        blob = git(root, "hash-object", "-w", "--stdin", input="\n".join(lines) + "\n")
        index.append(f"100644 {blob}\t{name}\n")
    git(root, "update-index", "--index-info", input="".join(index), env=env)
    tree = git(root, "write-tree", env=env)
    args = ("-p", parent) if parent else ()
    commit = git(root, "commit-tree", tree, *args, "-m", f"Directory data {day}")
    git(root, "push", "--quiet", "origin", f"{commit}:{SNAPSHOT_REF}")
    return commit


def live_checks(root, project_id, *, migration_required=True, records=None):
    paths = ("/", "/discover/county/philadelphia", f"/discover/work/{project_id}", f"/api/directory/projects/{project_id}")
    for path in paths:
        headers = command(root, "curl", "--silent", "--show-error", "--max-time", "35", "--output", os.devnull,
                          "--dump-header", "-", ORIGIN + path, label="live directory smoke", timeout=40)
        statuses = re.findall(r"^HTTP/\S+ (\d{3})", headers, re.M)
        if not statuses or statuses[-1] != "200" or migration_required and not re.search(
            r"^x-directory-project-source:\s*d1\s*$", headers, re.I | re.M
        ):
            raise RuntimeError(f"Live directory smoke failed for {path}")
    statuses = dict.fromkeys(paths, 200)
    for kind, endpoint, key in (("publication", "publications", "publication"), ("study", "studies", "study"),
                                ("dataset", "datasets", "dataset"), ("regional-data", "regional-data", "regional_data")):
        rows = (records or {}).get(kind)
        if not rows:
            continue
        row = max(rows.values(), key=lambda row: (row.get("added") or "", row["id"]))
        path = f"/api/directory/{endpoint}/{url_quote(row['id'], safe='')}"
        body = command(root, "curl", "--fail", "--silent", "--show-error", "--max-time", "35",
                       ORIGIN + path + "?refresh-check=1", label=f"live {kind} detail", timeout=40)
        if (json.loads(body).get(key) or {}).get("id") != row["id"]:
            raise RuntimeError(f"Live {kind} detail did not match the D1 listing")
        statuses[path] = 200
    return statuses
