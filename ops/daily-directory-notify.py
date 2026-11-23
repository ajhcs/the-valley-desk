"""Deliver pending non-sensitive directory notices through the operator's configured endpoint."""

import os
from pathlib import Path
import subprocess
import sys
from urllib.parse import urlsplit


def main(state):
    path = state / "notification.txt"
    if not path.exists():
        return
    endpoint_file = state / "notification-url"
    if endpoint_file.is_file():
        url = endpoint_file.read_text().strip()
        parsed = urlsplit(url)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Invalid notification endpoint")
        token = state / "notification-token"
        # Keep private credentials and the endpoint out of the argument list.
        config = 'url = ' + curl_value(url) + '\n'
        if token.is_file():
            config += 'header = ' + curl_value("Authorization: Bearer " + token.read_text().strip()) + '\n'
        subprocess.run(["curl", "--config", "-", "--silent", "--fail", "--max-time", "20",
                        "--request", "POST", "--data-binary", "@" + str(path), "--output", os.devnull],
                       text=True, input=config, check=True, timeout=25)
    else:
        subprocess.run(["notify-send", "--expire-time=0", "The Valley Desk", path.read_text().strip()],
                       capture_output=True, check=True, timeout=15)
    path.unlink()


def curl_value(value):
    if any(ord(char) < 32 for char in value):
        raise ValueError("Invalid notification configuration")
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


if __name__ == "__main__":
    try:
        main(Path(sys.argv[1]))
    except (OSError, ValueError, subprocess.SubprocessError):
        raise SystemExit("Valley Desk notice is pending in the state directory.")
