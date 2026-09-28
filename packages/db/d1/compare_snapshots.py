#!/usr/bin/env python3
"""Compare two read-only normalized SQLite snapshots before a D1 cutover.

Output contains counts and column names, never article text or credentials.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path


def connect(path: Path) -> sqlite3.Connection:
    database = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    database.execute("PRAGMA query_only = ON")
    return database


def tables(database: sqlite3.Connection) -> list[str]:
    return [row[0] for row in database.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )]


def columns(database: sqlite3.Connection, table: str) -> list[str]:
    return [row[1] for row in database.execute(f'PRAGMA table_info("{table}")')]


def summary(old: sqlite3.Connection, new: sqlite3.Connection) -> dict:
    names = sorted(set(tables(old)) | set(tables(new)))
    result: dict = {"tables": {}}
    for name in names:
        old_columns = columns(old, name)
        new_columns = columns(new, name)
        old_count = old.execute(f'SELECT count(*) FROM "{name}"').fetchone()[0] if old_columns else 0
        new_count = new.execute(f'SELECT count(*) FROM "{name}"').fetchone()[0] if new_columns else 0
        entry = {
            "old_rows": old_count,
            "new_rows": new_count,
            "old_only_columns": sorted(set(old_columns) - set(new_columns)),
            "new_only_columns": sorted(set(new_columns) - set(old_columns)),
        }
        key = next((candidate for candidate in ("id", "story_id", "fingerprint_hash")
                    if candidate in old_columns and candidate in new_columns), None)
        if key:
            old_keys = {row[0] for row in old.execute(f'SELECT "{key}" FROM "{name}"')}
            new_keys = {row[0] for row in new.execute(f'SELECT "{key}" FROM "{name}"')}
            entry["key"] = key
            entry["shared_keys"] = len(old_keys & new_keys)
            entry["old_only_keys"] = len(old_keys - new_keys)
            entry["new_only_keys"] = len(new_keys - old_keys)
            entry["old_duplicate_keys"] = old_count - len(old_keys)
            entry["new_duplicate_keys"] = new_count - len(new_keys)
        for label, database, available in (("old", old, old_columns), ("new", new, new_columns)):
            for time_column in ("created_at", "updated_at", "published_at"):
                if time_column in available:
                    minimum, maximum = database.execute(
                        f'SELECT min("{time_column}"), max("{time_column}") FROM "{name}"'
                    ).fetchone()
                    entry[f"{label}_{time_column}_range"] = [minimum, maximum]
        result["tables"][name] = entry
    result["old_total_rows"] = sum(value["old_rows"] for value in result["tables"].values())
    result["new_total_rows"] = sum(value["new_rows"] for value in result["tables"].values())
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--old", required=True, type=Path)
    parser.add_argument("--new", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    old = connect(args.old)
    new = connect(args.new)
    report = summary(old, new)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"old_total_rows": report["old_total_rows"],
                      "new_total_rows": report["new_total_rows"], "tables": len(report["tables"])}))


if __name__ == "__main__":
    main()
