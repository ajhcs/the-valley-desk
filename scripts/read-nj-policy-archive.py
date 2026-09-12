"""Read bounded official NJ text exports using the standard ZIP and CSV parsers."""
import csv
import hashlib
import io
import json
import pathlib
import sys
import zipfile

if len(sys.argv) != 4:
    raise SystemExit("Usage: read-nj-policy-archive.py ARCHIVE BILL_TYPE BILL_NUMBER")
path = pathlib.Path(sys.argv[1])
if path.stat().st_size > 2_000_000:
    raise ValueError("Archive exceeds byte bound")
data = path.read_bytes()
with zipfile.ZipFile(io.BytesIO(data)) as archive:
    selected = {}
    for name in ("MAINBILL.TXT", "BILLHIST.TXT"):
        info = archive.getinfo(name)
        if info.file_size > 5_000_000 or info.compress_size > 2_000_000:
            raise ValueError("Entry exceeds byte bound")
        raw = archive.read(name)
        reader = csv.DictReader(io.StringIO(raw.decode("cp1252"), newline=""))
        matches = []
        for count, row in enumerate(reader):
            if count >= 30_000:
                raise ValueError("CSV row bound exceeded")
            if row["BillType"].strip() == sys.argv[2] and row["BillNumber"] == sys.argv[3]:
                matches.append(row)
        selected[name] = matches
    if len(selected["MAINBILL.TXT"]) != 1 or len(selected["BILLHIST.TXT"]) > 200:
        raise ValueError("Missing or ambiguous instrument")
    print(json.dumps({"archiveSha256": hashlib.sha256(data).hexdigest(),
        "bill": selected["MAINBILL.TXT"][0], "history": selected["BILLHIST.TXT"]}))
