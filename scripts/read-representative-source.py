"""Bounded standard-library parsing of retained official NJ CSV and PA HTML."""
import csv
import hashlib
import io
import json
import pathlib
import sys
import zipfile
from html.parser import HTMLParser

path = pathlib.Path(sys.argv[2])
if path.stat().st_size > 2_000_000:
    raise ValueError("Source exceeds byte bound")
raw = path.read_bytes()
if sys.argv[1] == "nj":
    tables = {}
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        for name in ("ROSTER.TXT", "LEGBIO.TXT"):
            info = archive.getinfo(name)
            if info.file_size > 250_000 or info.compress_size > 250_000:
                raise ValueError("Archive entry exceeds bound")
            reader = csv.DictReader(io.StringIO(archive.read(name).decode("cp1252"), newline=""))
            if len(reader.fieldnames) != len(set(reader.fieldnames)):
                raise ValueError("Duplicate CSV fields")
            rows = list(reader)
            if not 1 <= len(rows) <= 150 or any(None in row for row in rows):
                raise ValueError("CSV row shape or count")
            tables[name] = rows
    print(json.dumps({"rawSha256": hashlib.sha256(raw).hexdigest(), "tables": tables}))
elif sys.argv[1] == "pa":
    class Members(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.rows = []
            self.current = None
            self.capture_name = False

        def handle_starttag(self, tag, attrs):
            values = dict(attrs)
            classes = values.get("class", "").split()
            if tag == "div" and "member" in classes:
                self.current = {"district": values.get("data-district"), "party": values.get("data-party"), "displayName": "", "profile": None}
                self.rows.append(self.current)
            if self.current and tag == "a" and "thumb-info-wrapper" in classes:
                self.current["profile"] = values.get("href", "").strip()
            if self.current and tag == "span" and "thumb-info-inner" in classes:
                self.capture_name = True

        def handle_endtag(self, tag):
            if tag == "span":
                self.capture_name = False

        def handle_data(self, value):
            if self.capture_name and self.current:
                self.current["displayName"] += value

    parser = Members()
    parser.feed(raw.decode("utf8"))
    if not 1 <= len(parser.rows) <= 203:
        raise ValueError("PA member count")
    print(json.dumps({"rawSha256": hashlib.sha256(raw).hexdigest(), "rows": parser.rows}))
else:
    raise ValueError("Expected nj or pa")
