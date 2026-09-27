#!/usr/bin/env python3
"""Compare a Wrangler --local D1 import with the normalized audit snapshot."""
import argparse
import hashlib
import json
import sqlite3
from pathlib import Path


def digest(row):
    return hashlib.sha256(json.dumps(row, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--expected", type=Path, required=True)
    parser.add_argument("--d1-sqlite", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    expected = json.loads(args.expected.read_text())
    conn = sqlite3.connect(f"file:{args.d1_sqlite}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    result = {"status": "PASS", "scope": "Wrangler local D1 snapshot import", "tables": {}, "foreign_keys": {}}
    try:
        for table, reference in expected["tables"].items():
            hashes = [digest(dict(row)) for row in conn.execute(f'SELECT * FROM "{table}"')]
            combined = hashlib.sha256("\n".join(sorted(hashes)).encode()).hexdigest()
            correct = len(hashes) == reference["rows"] and combined == reference["logical_sha256"]
            result["tables"][table] = {"rows": len(hashes), "logical_sha256": combined, "match": correct}
            if not correct:
                result["status"] = "FAIL"
        for relationship in expected["foreign_keys"]:
            left, right = relationship.split("->")
            child, column = left.split(".")
            parent, parent_column = right.split(".")
            missing = conn.execute(
                f'SELECT count(*) FROM "{child}" c LEFT JOIN "{parent}" p ON c."{column}" = p."{parent_column}" '
                f'WHERE c."{column}" IS NOT NULL AND p."{parent_column}" IS NULL'
            ).fetchone()[0]
            result["foreign_keys"][relationship] = missing
            if missing:
                result["status"] = "FAIL"
        result["integrity_check"] = conn.execute("PRAGMA integrity_check").fetchone()[0]
        if result["integrity_check"] != "ok":
            result["status"] = "FAIL"
        result["table_count"] = len(result["tables"])
        result["total_rows"] = sum(table["rows"] for table in result["tables"].values())
        result["foreign_key_count"] = len(result["foreign_keys"])
    finally:
        conn.close()
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps({key: result[key] for key in ("status", "table_count", "total_rows", "foreign_key_count", "integrity_check")}))
    if result["status"] != "PASS":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
