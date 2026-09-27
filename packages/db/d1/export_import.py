#!/usr/bin/env python3
"""Export a verified SQLite snapshot as an ordered SQL file for Wrangler D1.

All tables and indexes are created before rows are inserted. Foreign keys are
deferred for the import, so cyclic references remain checked at commit. The
result contains application data but no connection credentials.
"""

from __future__ import annotations

import argparse
import re
import sqlite3
from pathlib import Path


IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z_0-9]*\Z")
MAX_STATEMENT_BYTES = 100_000
# These nullable references form the only cycles in the reviewed schema.
# D1's remote importer may split an SQL file across transactions, so PRAGMA
# defer_foreign_keys is insufficient. Insert them as NULL, then restore them
# after all parent rows exist.
DEFERRED_REFERENCES = {
    "categories": {"parent_id"},
    "stories": {"current_version_id"},
}


def quote(identifier: str) -> str:
    if not IDENTIFIER.fullmatch(identifier):
        raise ValueError(f"Unexpected SQLite identifier: {identifier!r}")
    return f'"{identifier}"'


def literal(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, bytes):
        return "X'" + value.hex() + "'"
    return "'" + str(value).replace("'", "''") + "'"


def dependency_order(db: sqlite3.Connection, tables: list[str]) -> list[str]:
    table_set = set(tables)
    parents: dict[str, set[str]] = {}
    for table in tables:
        columns = {row[1]: row for row in db.execute(f"PRAGMA table_info({quote(table)})")}
        deferred = DEFERRED_REFERENCES.get(table, set())
        fk_rows = db.execute(f"PRAGMA foreign_key_list({quote(table)})").fetchall()
        fk_columns = {row[3] for row in fk_rows}
        if not deferred.issubset(fk_columns):
            raise ValueError(f"Deferred references changed for {table}")
        if any(columns[name][3] for name in deferred):
            raise ValueError(f"Cannot defer a NOT NULL foreign key on {table}")
        parents[table] = {row[2] for row in fk_rows if row[3] not in deferred}
        if not parents[table].issubset(table_set):
            raise ValueError(f"Missing parent table of {table}")
    order: list[str] = []
    remaining = set(tables)
    while remaining:
        ready = sorted(table for table in remaining if not (parents[table] & remaining))
        if not ready:
            raise ValueError(f"Foreign key cycle without nullable deferred edge: {sorted(remaining)}")
        order.extend(ready)
        remaining.difference_update(ready)
    return order


def export(source: Path, output: Path) -> tuple[int, int]:
    db = sqlite3.connect(f"file:{source}?mode=ro", uri=True)
    try:
        tables = [row[0] for row in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )]
        if not tables:
            raise ValueError("No application tables in source snapshot")
        if db.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError("Source snapshot failed SQLite integrity_check")
        if db.execute("PRAGMA foreign_key_check").fetchone():
            raise ValueError("Source snapshot failed foreign_key_check")

        ordered_tables = dependency_order(db, tables)
        output.parent.mkdir(parents=True, exist_ok=True)
        row_count = 0
        with output.open("w", encoding="utf-8") as out:
            out.write("-- Application data export; contains no database credentials.\n")
            for table in tables:
                ddl = db.execute(
                    "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
                ).fetchone()[0]
                out.write(ddl + ";\n")
            for (ddl,) in db.execute(
                "SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name"
            ):
                out.write(ddl + ";\n")
            deferred_updates: list[str] = []
            for table in ordered_tables:
                table_name = quote(table)
                fields = [row[1] for row in db.execute(f"PRAGMA table_info({table_name})")]
                deferred = DEFERRED_REFERENCES.get(table, set())
                id_index = fields.index("id") if deferred else -1
                for row in db.execute(f"SELECT * FROM {table_name}"):
                    insert_values = [None if field in deferred else value for field, value in zip(fields, row)]
                    statement = f"INSERT INTO {table_name} VALUES (" + ",".join(map(literal, insert_values)) + ");"
                    if len(statement.encode("utf-8")) > MAX_STATEMENT_BYTES:
                        raise ValueError(f"D1 statement exceeds {MAX_STATEMENT_BYTES} bytes in {table}")
                    out.write(statement + "\n")
                    for field in deferred:
                        value = row[fields.index(field)]
                        if value is not None:
                            deferred_updates.append(
                                f"UPDATE {table_name} SET {quote(field)}={literal(value)} "
                                f"WHERE \"id\"={literal(row[id_index])};"
                            )
                    row_count += 1
            for statement in deferred_updates:
                out.write(statement + "\n")
            out.write("PRAGMA foreign_key_check;\n")
        return len(tables), row_count
    finally:
        db.close()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    tables, rows = export(args.source, args.output)
    print(f"D1 SQL export: {tables} tables, {rows} rows, {args.output.stat().st_size} bytes")


if __name__ == "__main__":
    main()
