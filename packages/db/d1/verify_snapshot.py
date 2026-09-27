#!/usr/bin/env python3
"""Verify an isolated D1 SQLite import against a normalized PostgreSQL snapshot.

Only audit table columns are compared, so columns added by a pending app
migration do not fabricate historical values. REAL values are compared through
canonical decimal strings; all other values retain their normalized type.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
from decimal import Decimal
from pathlib import Path


def table_hash(connection: sqlite3.Connection, table: str, fields: list[str], real_fields: set[str]) -> tuple[int, str]:
    columns = ", ".join('"' + field + '"' for field in fields)
    digests = []
    for row in connection.execute(f'SELECT {columns} FROM "{table}"'):
        normalized = {
            field: format(Decimal(str(value)).normalize(), "f")
            if field in real_fields and value is not None else value
            for field, value in zip(fields, row)
        }
        digests.append(hashlib.sha256(json.dumps(normalized, ensure_ascii=False,
            sort_keys=True, separators=(",", ":")).encode()).hexdigest())
    combined = hashlib.sha256("\n".join(sorted(digests)).encode()).hexdigest()
    return len(digests), combined


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--d1-sqlite", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    source = sqlite3.connect(f"file:{args.source}?mode=ro", uri=True)
    target = sqlite3.connect(f"file:{args.d1_sqlite}?mode=ro", uri=True)
    report: dict[str, object] = {"status": "PASS", "scope": "isolated D1 schema and snapshot",
                                 "tables": {}, "foreign_keys": {}}
    try:
        tables = [row[0] for row in source.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")]
        target_tables = {row[0] for row in target.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' "
            "AND substr(name, 1, 4) != '_cf_'")}
        if set(tables) != target_tables:
            report["status"] = "FAIL"
            report["table_set_drift"] = sorted(set(tables) ^ target_tables)
        for table in tables:
            fields = [row[1] for row in source.execute(f'PRAGMA table_info("{table}")')]
            real_fields = {row[1] for row in target.execute(f'PRAGMA table_info("{table}")')
                           if row[2] == "REAL"}
            before = table_hash(source, table, fields, real_fields)
            after = table_hash(target, table, fields, real_fields)
            report["tables"][table] = {"source_rows": before[0], "d1_rows": after[0],
                                       "logical_sha256": after[1], "match": before == after}
            if before != after:
                report["status"] = "FAIL"
        fk_count = 0
        for table in tables:
            fk_count += len(target.execute(f'PRAGMA foreign_key_list("{table}")').fetchall())
        report["foreign_key_count"] = fk_count
        report["foreign_key_failures"] = target.execute("PRAGMA foreign_key_check").fetchall()
        report["integrity_check"] = target.execute("PRAGMA integrity_check").fetchone()[0]
        report["table_count"] = len(tables)
        report["total_rows"] = sum(value["d1_rows"] for value in report["tables"].values())
        if fk_count != 31 or report["foreign_key_failures"] or report["integrity_check"] != "ok":
            report["status"] = "FAIL"
    finally:
        source.close()
        target.close()
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({key: report[key] for key in (
        "status", "table_count", "total_rows", "foreign_key_count", "integrity_check")}, ensure_ascii=False))
    if report["status"] != "PASS":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
