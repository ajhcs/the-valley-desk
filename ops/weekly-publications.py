"""Advance one approved Valley Desk publication window on a trusted BuilderBob checkout."""
import argparse
from datetime import date, datetime, timedelta
from hashlib import sha256
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from urllib.parse import quote
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
TARGET = "the-valley-desk"
ORIGIN = "ajhcs/the-valley-desk"
NY = ZoneInfo("America/New_York")
CONTENT = "src/content"


def run(*command, cwd=ROOT, output=False, check=True):
    result = subprocess.run(command, cwd=cwd, text=True, capture_output=output, check=check)
    return result.stdout.strip() if output else result.returncode


def save(path, payload):
    temporary = path.with_suffix(".pending")
    temporary.write_text(json.dumps(payload, sort_keys=True, indent=2) + "\n")
    temporary.replace(path)


def load(path):
    return json.loads(path.read_text())


def pr_info(branch, cwd):
    result = subprocess.run(
        ["gh", "pr", "list", "--repo", ORIGIN, "--head", branch, "--base", "main", "--state", "all",
         "--limit", "1", "--json", "number,url,state,headRefOid,mergeCommit,reviewDecision"],
        cwd=cwd, capture_output=True, text=True, check=True,
    )
    prs = json.loads(result.stdout)
    return prs[0] if prs else None


def passed_ci(sha, cwd):
    data = json.loads(run("gh", "run", "list", "--repo", ORIGIN, "--workflow", "CI", "--commit", sha,
                          "--limit", "1", "--json", "headSha,conclusion,status", cwd=cwd, output=True))
    return bool(data and data[0] == {"headSha": sha, "conclusion": "success", "status": "completed"})


def configure_checkout(root):
    if not root.exists():
        run("git", "clone", "--single-branch", "--branch", "main",
            "https://github.com/" + ORIGIN + ".git", str(root))
    if run("git", "status", "--porcelain", cwd=root, output=True):
        raise RuntimeError(f"Weekly checkout has pending changes at {root}. Preserve and reconcile them.")
    remote = run("git", "remote", "get-url", "origin", cwd=root, output=True)
    if remote != "https://github.com/" + ORIGIN + ".git":
        raise ValueError("Unexpected weekly repository remote.")
    run("git", "fetch", "origin", "main", cwd=root)
    run("git", "switch", "--detach", "origin/main", cwd=root)


def collect(root, private, branch, start, stop, today, args):
    manifest_path = private / "manifest.json"
    if not manifest_path.exists():
        cmd = [
            sys.executable, "scripts/publications/weekly.py", str(private), start.isoformat(),
            stop.isoformat(), "--added", today.isoformat(), "--postal", str(args.postal),
            "--hold-ids", str(args.hold_ids),
        ]
        if args.countries:
            cmd.extend(("--countries", str(args.countries)))
        run(*cmd, cwd=root)
    manifest = load(manifest_path)
    if not manifest["additions"]:
        if manifest["model_assignments"]:
            raise RuntimeError("No model classifications passed. Resolve the private batch before advancing.")
        return None
    filename = manifest["output"]
    if not re.fullmatch(r"public-directory-publications-[0-9]{4}\.jsonl", filename):
        raise ValueError("Unexpected annual projection path.")
    target = Path(CONTENT) / filename
    branch_exists = run("git", "show-ref", "--verify", "--quiet", f"refs/heads/{branch}", cwd=root, check=False) == 0
    if branch_exists:
        run("git", "switch", branch, cwd=root)
        if sha256((root / target).read_bytes()).hexdigest() != manifest["file_sha256"]:
            raise ValueError("Weekly branch differs from the retained release bytes.")
    else:
        run("git", "switch", "-c", branch, cwd=root)
        shutil.copyfile(private / filename, root / target)
        run("git", "add", "--", str(target), cwd=root)
        run("git", "diff", "--cached", "--check", cwd=root)
        run("git", "commit", "-m", f"Add Europe PMC publications through {stop}", cwd=root)
    run("git", "push", "origin", f"HEAD:refs/heads/{branch}", cwd=root)
    summary = private / "pr-body.md"
    observations = "\n".join(f"- `{id}`" for id in manifest["spot_check"])
    summary.write_text(
        f"Europe PMC first-index window {start} through {stop}, inclusive. "
        f"{manifest['additions']} eligible additions, {manifest['other_science']} labelled Other science, "
        f"and {manifest['model_assignments']} sent for one topic assignment. "
        f"The integrated validator checked {manifest['integrated_records']} records.\n\n"
        f"Spot check the identity, source affiliation, dates and topic for these records before merging.\n\n{observations}\n\n"
        f"Delta SHA-256 `{manifest['delta_sha256']}`. The production load starts after the merge and green CI.\n"
    )
    run("gh", "pr", "create", "--repo", ORIGIN, "--base", "main", "--head", branch,
        "--title", f"Add weekly Europe PMC publications through {stop}", "--body-file", str(summary), cwd=root)
    return pr_info(branch, root)


def d1(root, *args):
    raw = run("npx", "--no-install", "wrangler", "d1", "execute", TARGET, "--remote", "--json", *args,
              cwd=root, output=True)
    # Remote file imports emit upload progress before the JSON result.
    result = re.search(r"^\[", raw, re.MULTILINE)
    if not result:
        raise RuntimeError("Wrangler did not return a D1 result.")
    return json.loads(raw[result.start():])


def load_approved(root, private, pr):
    merged = pr["mergeCommit"]["oid"]
    head = pr["headRefOid"]
    if not passed_ci(head, root) or not passed_ci(merged, root):
        print(f"Waiting for successful CI on the reviewed head and merge of PR #{pr['number']}.")
        return False
    run("git", "merge-base", "--is-ancestor", merged, "origin/main", cwd=root)
    manifest = load(private / "manifest.json")
    filename = manifest["output"]
    target = root / CONTENT / filename
    if sha256(target.read_bytes()).hexdigest() != manifest["file_sha256"]:
        raise RuntimeError("Approved and current main bytes differ from the spot-check batch.")
    delta = private / "delta.jsonl"
    if sha256(delta.read_bytes()).hexdigest() != manifest["delta_sha256"]:
        raise RuntimeError("The retained delta was changed after validation.")
    if not (root / "node_modules/.bin/wrangler").exists():
        run("npm", "ci", cwd=root)
    binding = json.loads((root / "wrangler.jsonc").read_text())["d1_databases"]
    if len(binding) != 1 or binding[0]["database_name"] != TARGET or binding[0]["binding"] != "VALLEY_DESK_DB":
        raise RuntimeError("Production binding does not match the configured directory database.")
    ledger = d1(root, "--command", "SELECT name FROM d1_migrations WHERE name='0046_research_directory.sql'")
    if not ledger or not ledger[0]["results"]:
        raise RuntimeError("The production research schema is missing.")
    # Retain a bookmark once before the first attempted write. Retries replay the same reviewed rows.
    checkpoint = private / "bookmark.txt"
    if not checkpoint.exists():
        checkpoint.write_text(run("npx", "--no-install", "wrangler", "d1", "time-travel", "info", TARGET,
                                  cwd=root, output=True) + "\n")
    sql = subprocess.check_output([sys.executable, "ops/load-research.py", "--publications", str(delta)], cwd=root, text=True)
    lines = sql.splitlines(keepends=True)
    for start in range(0, len(lines), 250):
        part = private / f"load-{start // 250:04d}.sql"
        part.write_text("".join(lines[start:start + 250]))
        result = d1(root, "--file", str(part))
        if not result or not all(item.get("success") for item in result):
            raise RuntimeError(f"D1 rejected part {part.name}")
        save(part.with_suffix(".receipt.json"), result)
    summary = d1(root, "--file", "ops/research-summary.sql")
    if not summary or not all(item.get("success") for item in summary):
        raise RuntimeError("D1 did not finish refreshing counts.")
    sample = manifest["spot_check"]
    selected = ",".join("'" + value.replace("'", "''") + "'" for value in sample)
    check = d1(root, "--command", f"SELECT id FROM research_visible WHERE kind='publication' AND id IN ({selected})")
    if {row["id"] for row in check[0]["results"]} != set(sample):
        raise RuntimeError("Production spot-check records differ from the approved batch. Check the current removals.")
    readback = {}
    sampled = set(sample[:3])
    for line in delta.open(encoding="utf-8"):
        entry = json.loads(line)
        if entry["id"] not in sampled:
            continue
        url = "https://thevalleydesk.org/api/directory/publications/" + quote(entry["id"], safe="")
        request = Request(url, headers={"User-Agent": "ValleyDesk-WeeklyPublicationCheck/1.0"})
        with urlopen(request, timeout=20) as response:
            public = json.load(response)["publication"]
        if public["id"] != entry["id"] or public["topic"] != entry["topic"]:
            raise RuntimeError("A live API result differs from the approved batch.")
        readback[entry["id"]] = url
    save(private / "loaded.json", {"merge": merged, "head": head, "pr": pr["url"], "public_readback": readback,
                                  "sample": len(sample), "loaded": datetime.now(NY).isoformat()})
    print(f"Loaded and refreshed counts for PR #{pr['number']}.")
    return True


def tick(args):
    root = args.state / "checkout"
    state = args.state / "cursor.json"
    previous = date.fromisoformat(load(state)["loaded_through"])
    start = previous + timedelta(days=1)
    stop = previous + timedelta(days=7)
    today = datetime.now(NY).date()
    if stop >= today:
        return
    private = args.state / stop.isoformat()
    private.mkdir(mode=0o700, exist_ok=True)
    configure_checkout(root)
    branch = f"codex/publications-week-ending-{stop}"
    pr = pr_info(branch, root)
    if pr is None:
        pr = collect(root, private, branch, start, stop, today, args)
        if pr is None:
            save(state, {"loaded_through": stop.isoformat()})
            return
        print(f"Spot check before merging {pr['url']}")
    if pr["state"] == "MERGED":
        if load_approved(root, private, pr):
            save(state, {"loaded_through": stop.isoformat()})
    elif pr["state"] == "CLOSED":
        raise RuntimeError(f"Weekly PR #{pr['number']} was closed. Reconcile the batch before advancing.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("state", type=Path)
    parser.add_argument("--postal", type=Path, required=True)
    parser.add_argument("--hold-ids", type=Path, required=True)
    parser.add_argument("--countries", type=Path)
    parser.add_argument("--seed", type=date.fromisoformat, help="Set the cursor to an already verified live annual cutoff.")
    args = parser.parse_args()
    args.state = args.state.resolve(strict=True)
    if args.state.stat().st_mode & 0o077:
        parser.error("Use a mode-0700 scheduler state directory.")
    os.umask(0o077)
    with (args.state / "weekly.lock").open("a") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        if args.seed:
            state = args.state / "cursor.json"
            if state.exists():
                parser.error("The existing release cursor must be reconciled before reseeding.")
            save(state, {"loaded_through": args.seed.isoformat()})
        else:
            tick(args)


if __name__ == "__main__":
    main()
