"""Emit replayable D1 SQL for paper-to-repository links from a reviewed CSV.

The CSV needs paper_id and existing_project_id columns; other columns are ignored and nothing
else is stored. Rows are only added, so a rerun is safe. --replace first clears the table so a
corrected file can supersede an earlier one in the same transaction-sized batch.
"""
import argparse
import csv
import re
import sys

PAPER = re.compile(r"^(doi:10\.\S+|pmid:[0-9]+|arxiv:\S+)$")
PROJECT = re.compile(r"^[1-9][0-9]{0,19}$")


def quote(value):
    if "\0" in value:
        raise ValueError("NUL in SQL input")
    return "'" + value.replace("'", "''") + "'"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("links", type=argparse.FileType("r", encoding="utf-8"))
    parser.add_argument("--replace", action="store_true")
    args = parser.parse_args()
    pairs = set()
    for number, row in enumerate(csv.DictReader(args.links), start=2):
        paper, project = (row.get("paper_id") or "").strip(), (row.get("existing_project_id") or "").strip()
        if not PAPER.match(paper) or not PROJECT.match(project):
            sys.exit(f"Line {number}: expected a publication id and a numeric project id")
        pairs.add((paper, project))
    if args.replace:
        print("DELETE FROM paper_repository_links;")
    for paper, project in sorted(pairs):
        print(f"INSERT OR IGNORE INTO paper_repository_links(paper_id,project_id) VALUES({quote(paper)},{quote(project)});")


if __name__ == "__main__":
    main()
