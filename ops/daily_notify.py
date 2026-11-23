"""Deliver private state directory notices through the Valley Desk Worker."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import subprocess
from uuid import uuid4

from daily_d1 import ORIGIN, compact, save

ENDPOINT = ORIGIN + "/api/directory/ops-notification"


def queue(state, kind, text, *, name=None):
    directory = state / "notices"
    directory.mkdir(mode=0o700, exist_ok=True)
    save(directory / ((name or uuid4().hex) + ".json"), {"kind": kind, "text": text})


def send(state, notice):
    credential = state / "notification-token"
    metadata = credential.lstat()
    if metadata.st_uid != os.getuid() or not stat.S_ISREG(metadata.st_mode) or stat.S_IMODE(metadata.st_mode) != 0o600:
        raise ValueError("Notification token file must be private")
    token = credential.read_text().strip()
    if not re.fullmatch(r"[a-f0-9]{64}", token):
        raise ValueError("Invalid notification token")
    # Feed headers and body over stdin. The secret is absent from argv and the environment.
    payload = compact(notice)
    if len(payload.encode()) > 4096:
        raise ValueError("Directory notice exceeds the message limit")
    config = (
        f'header = "Authorization: Bearer {token}"\n'
        'header = "Content-Type: application/json"\n'
        'data-binary = ' + json.dumps(payload, ensure_ascii=False) + '\n'
    )
    result = subprocess.run(
        ["curl", "--disable", "--config", "-", "--silent", "--max-time", "15", "--output", os.devnull,
         "--write-out", "%{http_code}", ENDPOINT],
        input=config, text=True, capture_output=True, timeout=17,
    )
    if result.returncode or result.stdout != "204":
        raise RuntimeError("The Worker did not confirm email delivery (HTTP " + str(result.stdout[:3] or "unknown") + ")")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("state", type=Path)
    parser.add_argument("--test", action="store_true")
    args = parser.parse_args()
    os.umask(0o077)
    state = args.state
    with (state / "notification.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.test:
            if (state / "notification-test.json").exists():
                print("Directory test email was already accepted by NOTIFY_OPS.")
                return
            send(state, {"kind": "test"})
            save(state / "notification-test.json", {"worker_accepted": True, "http_status": 204})
            print("Directory test email accepted by NOTIFY_OPS (HTTP 204).")
            return
        notices = sorted((state / "notices").glob("*.json"))
        if not notices and os.environ.get("SERVICE_RESULT") not in (None, "success"):
            queue(state, "failed", "The Valley Desk daily service failed. See the BuilderBob user journal.")
            notices = sorted((state / "notices").glob("*.json"))
        for path in notices:
            send(state, json.loads(path.read_text()))
            path.unlink()


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        raise SystemExit("Directory email was not confirmed. " +
                         (str(error) if isinstance(error, RuntimeError) else "See private service state."))
