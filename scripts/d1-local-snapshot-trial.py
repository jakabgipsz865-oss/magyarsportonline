#!/usr/bin/env python3
"""Read-only audit JSONL -> SQLite staging trial with logical checksums.

This is a data conversion rehearsal, not an application-ready D1 schema.
"""
import argparse
import hashlib
import json
import re
import sqlite3
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path


TABLE_RE = re.compile(r"CREATE TABLE (?:public|drizzle)\.([a-z_]+) \(\n(.*?)\n\);", re.S)
FK_RE = re.compile(
    r"ALTER TABLE ONLY public\.([a-z_]+)\s+ADD CONSTRAINT [^;]+?"
    r"FOREIGN KEY \(([a-z_]+)\) REFERENCES public\.([a-z_]+)\(([a-z_]+)\);",
    re.S,
)


def pg_array(value):
    if isinstance(value, list):
        return value
    if not isinstance(value, str) or not (value.startswith("{") and value.endswith("}")):
        raise ValueError("invalid PostgreSQL array representation")
    if value == "{}":
        return []
    out, part, quoted, escaped = [], "", False, False
    for char in value[1:-1]:
        if escaped:
            part += char
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == '"':
            quoted = not quoted
        elif char == "," and not quoted:
            out.append(part)
            part = ""
        else:
            part += char
    out.append(part)
    return out


def normalize(value, pg_type):
    if value is None:
        return None
    if pg_type.endswith("[]"):
        return json.dumps(pg_array(value), ensure_ascii=False, separators=(",", ":"))
    if pg_type.startswith("jsonb") or pg_type.startswith("json"):
        parsed = json.loads(value) if isinstance(value, str) else value
        return json.dumps(parsed, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    if pg_type.startswith("timestamp"):
        dt = datetime.fromisoformat(str(value).replace(" ", "T"))
        if dt.tzinfo is None:
            raise ValueError("timestamp without timezone in export")
        return dt.astimezone(timezone.utc).isoformat(timespec="microseconds")
    if pg_type.startswith("numeric") or pg_type.startswith("double precision"):
        return format(Decimal(str(value)).normalize(), "f")
    if pg_type.startswith("boolean"):
        if value in (True, "t", "true", "True", 1):
            return 1
        if value in (False, "f", "false", "False", 0):
            return 0
        raise ValueError("invalid boolean")
    if pg_type.startswith(("integer", "bigint", "smallint")):
        return int(value)
    if "vector" in pg_type:
        raise ValueError("non-NULL pgvector embedding requires an explicit migration design")
    return str(value)


def row_digest(row):
    return hashlib.sha256(json.dumps(row, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--schema", type=Path, required=True)
    parser.add_argument("--tables", type=Path, required=True)
    parser.add_argument("--sqlite", type=Path, required=True)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()
    schema = args.schema.read_text()
    definitions = {}
    for table, block in TABLE_RE.findall(schema):
        columns = {}
        for line in block.splitlines():
            match = re.match(r"    ([a-z_]+) ((?:timestamp with time zone|double precision|[a-z_]+(?:\[\])?|public\.[a-z_]+(?:\(\d+\))?))", line)
            if match:
                columns[match.group(1)] = match.group(2)
        definitions[table] = columns
    files = sorted(args.tables.glob("*.jsonl"))
    if {p.stem for p in files} != set(definitions):
        raise ValueError({"missing_in_schema": sorted({p.stem for p in files} - set(definitions)), "missing_export": sorted(set(definitions) - {p.stem for p in files})})
    if args.sqlite.exists():
        raise FileExistsError(args.sqlite)
    args.sqlite.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(args.sqlite)
    report = {"status": "PASS", "scope": "snapshot_data_conversion_only", "tables": {}, "foreign_keys": {}, "embedding_non_null": 0}
    try:
        for path in files:
            table = path.stem
            columns = definitions[table]
            ddl = ", ".join(f'"{name}" {"INTEGER" if pg_type.startswith(("integer", "bigint", "smallint", "boolean")) else "TEXT"}' for name, pg_type in columns.items())
            conn.execute(f'CREATE TABLE "{table}" ({ddl})')
            if "id" in columns:
                conn.execute(f'CREATE INDEX "{table}_id_check_idx" ON "{table}" (id)')
            source_hashes = []
            names = list(columns)
            max_row_bytes = 0
            source_ids = []
            with path.open() as stream:
                for line in stream:
                    if not line.strip():
                        continue
                    raw = json.loads(line)
                    if set(raw) != set(names):
                        raise ValueError(f"{table}: columns differ from backup schema")
                    normalized = {name: normalize(raw[name], columns[name]) for name in names}
                    max_row_bytes = max(max_row_bytes, len(json.dumps(normalized, ensure_ascii=False).encode()))
                    if max_row_bytes > 2_000_000:
                        raise ValueError(f"{table}: row exceeds D1 2 MB limit")
                    source_hashes.append(row_digest(normalized))
                    if "id" in raw:
                        source_ids.append(str(raw["id"]))
                    conn.execute(f'INSERT INTO "{table}" VALUES ({",".join("?" for _ in names)})', [normalized[name] for name in names])
            dest_hashes = [row_digest(dict(zip(names, row))) for row in conn.execute(f'SELECT * FROM "{table}"')]
            if sorted(source_hashes) != sorted(dest_hashes):
                raise ValueError(f"{table}: logical row checksums differ")
            if len(source_ids) != len(set(source_ids)):
                raise ValueError(f"{table}: duplicate id")
            combined = hashlib.sha256("\n".join(sorted(source_hashes)).encode()).hexdigest()
            report["tables"][table] = {"rows": len(source_hashes), "logical_sha256": combined, "max_normalized_row_bytes": max_row_bytes}
        conn.commit()
        foreign_keys = FK_RE.findall(schema)
        if len(foreign_keys) != 31:
            raise ValueError(f"expected 31 foreign keys, found {len(foreign_keys)}")
        for child, column, parent, parent_column in foreign_keys:
            query = f'SELECT count(*) FROM "{child}" c LEFT JOIN "{parent}" p ON c."{column}" = p."{parent_column}" WHERE c."{column}" IS NOT NULL AND p."{parent_column}" IS NULL'
            missing = conn.execute(query).fetchone()[0]
            report["foreign_keys"][f"{child}.{column}->{parent}.{parent_column}"] = missing
            if missing:
                raise ValueError(f"broken relationship: {child}.{column}->{parent}.{parent_column}: {missing}")
        report["sqlite_bytes"] = args.sqlite.stat().st_size
        report["table_count"] = len(files)
        report["foreign_key_count"] = len(foreign_keys)
        report["total_rows"] = sum(row["rows"] for row in report["tables"].values())
        report["integrity_check"] = conn.execute("PRAGMA integrity_check").fetchone()[0]
        if report["integrity_check"] != "ok":
            raise ValueError("SQLite integrity check failed")
    except Exception as error:
        report["status"] = "FAIL"
        report["error"] = str(error)
        raise
    finally:
        conn.close()
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({key: report[key] for key in ("status", "table_count", "total_rows", "foreign_key_count", "sqlite_bytes", "integrity_check")}))


if __name__ == "__main__":
    main()
