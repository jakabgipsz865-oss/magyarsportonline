#!/usr/bin/env python3
"""Compare a local PostgreSQL restore with the audited per-table JSONL export.

The report includes counts and logical SHA-256 values only, never row content.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from copy_to_jsonl import decode_field


DATE_TIME = re.compile(r"^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:")


def pg_array(value: str) -> list[str]:
    if value == "{}":
        return []
    if not (value.startswith("{") and value.endswith("}")):
        raise ValueError("Invalid PostgreSQL array representation")
    values, part, quoted, escaped = [], "", False, False
    for char in value[1:-1]:
        if escaped:
            part += char
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == '"':
            quoted = not quoted
        elif char == "," and not quoted:
            values.append(part)
            part = ""
        else:
            part += char
    values.append(part)
    return values


def canonical(value: object) -> object:
    if isinstance(value, dict):
        return {key: canonical(item) for key, item in sorted(value.items())}
    if isinstance(value, list):
        return [canonical(item) for item in value]
    if isinstance(value, str) and DATE_TIME.match(value):
        try:
            instant = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if instant.tzinfo:
                return instant.astimezone(timezone.utc).isoformat(timespec="microseconds")
            return instant.isoformat(timespec="microseconds")
        except ValueError:
            pass
    return value


def canonical_row(row: dict, types: dict[str, str]) -> dict:
    result = {}
    for key, value in row.items():
        field_type = types.get(key, "")
        if value is not None and field_type == "boolean":
            result[key] = value == "t" if isinstance(value, str) else value
        elif value is not None and field_type in ("smallint", "integer", "bigint"):
            result[key] = int(value)
        elif value is not None and field_type in ("numeric", "real", "double precision"):
            result[key] = format(Decimal(str(value)).normalize(), "f")
        elif value is not None and field_type == "ARRAY":
            result[key] = canonical(pg_array(value) if isinstance(value, str) else value)
        elif value is not None and field_type in ("json", "jsonb"):
            result[key] = canonical(json.loads(value) if isinstance(value, str) else value)
        else:
            result[key] = canonical(value)
    return result


def digests(lines: list[str], types: dict[str, str]) -> Counter[str]:
    return Counter(hashlib.sha256(json.dumps(canonical_row(json.loads(line), types),
                                  ensure_ascii=False, sort_keys=True,
                                  separators=(",", ":")).encode()).hexdigest()
                   for line in lines if line.strip())


def query_table(table: str, host: str, port: int, database: str) -> list[str]:
    schema = "drizzle" if table == "__drizzle_migrations" else "public"
    if not re.fullmatch(r"[a-z_]+", table):
        raise ValueError("Invalid table name")
    sql = f'COPY (SELECT row_to_json(t) FROM "{schema}"."{table}" AS t) TO STDOUT'
    result = subprocess.run(
        ["/opt/homebrew/opt/postgresql@18/bin/psql", "--host", host,
         "--port", str(port), "--dbname", database, "--no-psqlrc", "--quiet",
         "--command", sql], capture_output=True, text=True, check=True,
    )
    return [decode_field(line) for line in result.stdout.splitlines()]


def query_types(table: str, host: str, port: int, database: str) -> dict[str, str]:
    schema = "drizzle" if table == "__drizzle_migrations" else "public"
    sql = ("SELECT coalesce(json_object_agg(column_name, data_type)::text, '{}') "
           "FROM information_schema.columns "
           f"WHERE table_schema = '{schema}' AND table_name = '{table}'")
    result = subprocess.run(
        ["/opt/homebrew/opt/postgresql@18/bin/psql", "--host", host,
         "--port", str(port), "--dbname", database, "--no-psqlrc",
         "--tuples-only", "--no-align", "--command", sql],
        capture_output=True, text=True, check=True,
    )
    return json.loads(result.stdout.strip())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audit-tables", type=Path, required=True)
    parser.add_argument("--host", required=True)
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--database", required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--tables", help="Optional comma-separated subset")
    args = parser.parse_args()
    names = sorted(path.stem for path in args.audit_tables.glob("*.jsonl"))
    if args.tables:
        requested = set(args.tables.split(","))
        names = [name for name in names if name in requested]
        if len(names) != len(requested):
            raise SystemExit("Unknown requested table")
    report = {"status": "PASS", "table_count": len(names), "tables": {}}
    for name in names:
        types = query_types(name, args.host, args.port, args.database)
        audit_lines = (args.audit_tables / f"{name}.jsonl").read_text().splitlines()
        restored_lines = query_table(name, args.host, args.port, args.database)
        audit = digests(audit_lines, types)
        restored = digests(restored_lines, types)
        equal = audit == restored
        if not equal:
            report["status"] = "FAIL"
        combined = hashlib.sha256("\n".join(sorted(restored.elements())).encode()).hexdigest()
        report["tables"][name] = {
            "audit_rows": sum(audit.values()), "restored_rows": sum(restored.values()),
            "logical_sha256": combined, "match": equal,
            "audit_only_rows": sum((audit - restored).values()),
            "restored_only_rows": sum((restored - audit).values()),
        }
        if not equal and audit_lines and restored_lines:
            audit_rows = {row["id"]: canonical_row(row, types)
                          for line in audit_lines if (row := json.loads(line)).get("id")}
            restored_rows = {row["id"]: canonical_row(row, types)
                             for line in restored_lines if (row := json.loads(line)).get("id")}
            differences = Counter()
            for identifier in audit_rows.keys() & restored_rows.keys():
                before, after = audit_rows[identifier], restored_rows[identifier]
                differences.update(key for key in before.keys() | after.keys()
                                   if before.get(key) != after.get(key))
            report["tables"][name]["mismatch_columns"] = dict(differences)
    report["total_rows"] = sum(item["restored_rows"] for item in report["tables"].values())
    args.report.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({"status": report["status"], "table_count": report["table_count"],
                      "total_rows": report["total_rows"], "mismatch_tables": [name for name, item
                      in report["tables"].items() if not item["match"]]}))
    if report["status"] != "PASS":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
