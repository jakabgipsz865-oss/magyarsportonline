#!/usr/bin/env python3
"""Generate a constrained SQLite/D1 schema from a reviewed PostgreSQL schema dump.

This is a migration input, not a PostgreSQL SQL translator. Unsupported types,
defaults and indexes fail explicitly. The two remediation migrations are applied
only when their columns are absent from the source dump.
"""

from __future__ import annotations

import argparse
import re
from collections import defaultdict
from pathlib import Path


TABLE = re.compile(r"CREATE TABLE (?:public|drizzle)\.([a-z_]+) \(\n(.*?)\n\);", re.S)
ENUM = re.compile(r"CREATE TYPE public\.([a-z_]+) AS ENUM \(\n(.*?)\n\);", re.S)
CONSTRAINT = re.compile(
    r"ALTER TABLE ONLY (?:public|drizzle)\.([a-z_]+)\s+"
    r"ADD CONSTRAINT [a-z_]+ (PRIMARY KEY|UNIQUE|FOREIGN KEY) \(([^)]+)\)"
    r"(?: REFERENCES public\.([a-z_]+)\(([^)]+)\))?;",
    re.S,
)
INDEX = re.compile(
    r"CREATE (UNIQUE )?INDEX ([a-z_]+) ON public\.([a-z_]+) "
    r"USING (btree|gin) \((.*?)\);",
    re.S,
)
ADD_COLUMN = re.compile(r'ALTER TABLE "([a-z_]+)" ADD COLUMN "([a-z_]+)" (.*?);')
ADD_INDEX = re.compile(r'CREATE INDEX "([a-z_]+)" ON "([a-z_]+)" USING btree \((.*?)\);')
PG_TYPES = (
    "timestamp with time zone", "double precision", "public.vector(1536)",
    "numeric(10,6)", "numeric(4,3)", "text[]", "jsonb", "uuid", "bigint",
    "integer", "boolean", "real", "text",
)
IDENT = re.compile(r"^[a-z_][a-z_0-9]*$")


def quote(identifier: str) -> str:
    if not IDENT.fullmatch(identifier):
        raise ValueError(f"Unsafe identifier: {identifier!r}")
    return f'"{identifier}"'


def sqlite_type(pg_type: str) -> str:
    if pg_type in ("integer", "bigint", "boolean"):
        return "INTEGER"
    if pg_type in ("real", "double precision"):
        return "REAL"
    if pg_type in PG_TYPES or pg_type.startswith("public."):
        return "TEXT"
    raise ValueError(f"Unsupported PostgreSQL type: {pg_type}")


def sqlite_default(value: str) -> str | None:
    if value == "gen_random_uuid()":
        # The application must provide a crypto.randomUUID() value on insert.
        return None
    if value == "now()":
        return "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))"
    if value == "true":
        return "1"
    if value == "false":
        return "0"
    if re.fullmatch(r"-?[0-9]+", value):
        return value
    match = re.fullmatch(r"'((?:[^']|'')*)'::(?:public\.[a-z_]+|text|jsonb)", value)
    if match:
        return "'" + match.group(1) + "'"
    raise ValueError(f"Unsupported PostgreSQL default: {value}")


def parse_column(line: str, enums: dict[str, list[str]]) -> tuple[str, str]:
    match = re.fullmatch(r"    ([a-z_]+) (.*?)(?:,)?", line)
    if not match:
        raise ValueError(f"Unrecognized column: {line}")
    name, remainder = match.groups()
    pg_type = next((part for part in PG_TYPES if remainder.startswith(part)), None)
    if pg_type is None:
        enum_match = re.match(r"public\.([a-z_]+)", remainder)
        if not enum_match or enum_match.group(1) not in enums:
            raise ValueError(f"Unrecognized type: {line}")
        pg_type = enum_match.group(0)
    tail = remainder[len(pg_type):].strip()
    not_null = "NOT NULL" in tail
    default_match = re.search(r"DEFAULT (.*?)(?: NOT NULL)?$", tail)
    default = sqlite_default(default_match.group(1)) if default_match else None
    definition = f"{quote(name)} {sqlite_type(pg_type)}"
    if not_null:
        definition += " NOT NULL"
    if default is not None:
        definition += f" DEFAULT {default}"
    if pg_type in ("jsonb", "text[]"):
        definition += f" CHECK (json_valid({quote(name)}))"
    if pg_type.startswith("public.") and pg_type != "public.vector(1536)":
        values = enums[pg_type.removeprefix("public.")]
        literals = ", ".join("'" + item.replace("'", "''") + "'" for item in values)
        definition += f" CHECK ({quote(name)} IN ({literals}))"
    return name, definition


def make_schema(pg_schema: str, remediation_sql: str) -> str:
    enums = {
        name: re.findall(r"'((?:[^']|'')*)'", values)
        for name, values in ENUM.findall(pg_schema)
    }
    tables = TABLE.findall(pg_schema)
    if len(tables) != 28 or len(enums) != 28:
        raise ValueError(f"Expected 28 tables and enums; got {len(tables)}, {len(enums)}")
    constraints: dict[str, list[str]] = defaultdict(list)
    foreign_keys = 0
    for table, kind, columns, parent, parent_columns in CONSTRAINT.findall(pg_schema):
        names = [name.strip() for name in columns.split(",")]
        fields = ", ".join(quote(name) for name in names)
        if kind == "FOREIGN KEY":
            foreign_keys += 1
            targets = ", ".join(quote(name.strip()) for name in parent_columns.split(","))
            clause = f"FOREIGN KEY ({fields}) REFERENCES {quote(parent)} ({targets}) DEFERRABLE INITIALLY DEFERRED"
        else:
            clause = f"{kind} ({fields})"
        constraints[table].append(clause)
    if foreign_keys != 31:
        raise ValueError(f"Expected 31 foreign keys; got {foreign_keys}")

    extra_columns: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for table, name, definition in ADD_COLUMN.findall(remediation_sql):
        if table not in {item[0] for item in tables}:
            raise ValueError(f"Unknown remediation table: {table}")
        pg_type = "timestamp with time zone" if definition.startswith("timestamp with time zone") else definition.split()[0]
        sqlite = f"{quote(name)} {sqlite_type(pg_type)}"
        if "NOT NULL" in definition:
            sqlite += " NOT NULL"
        default_match = re.search(r"DEFAULT (.*?)(?: NOT NULL)?$", definition)
        if default_match:
            sqlite += f" DEFAULT {sqlite_default(default_match.group(1))}"
        extra_columns[table].append((name, sqlite))

    statements = [
        "-- D1 target schema generated from a reviewed PostgreSQL dump plus remediation migrations.",
        "-- UUIDs are supplied by the application; timestamp and JSON values are normalized at import.",
        "PRAGMA foreign_keys = ON;",
    ]
    for table, block in tables:
        parsed = [parse_column(line, enums) for line in block.splitlines()]
        names = {name for name, _ in parsed}
        parsed.extend((name, ddl) for name, ddl in extra_columns[table] if name not in names)
        fields = [ddl for _, ddl in parsed] + constraints[table]
        statements.append(f"CREATE TABLE {quote(table)} (\n  " + ",\n  ".join(fields) + "\n);")

    skipped_indexes: list[str] = []
    for unique, name, table, method, expression in INDEX.findall(pg_schema):
        if method == "gin":
            skipped_indexes.append(name)
            continue
        if name == "raw_articles_source_guid_unique":
            expression = "source_id, json_extract(extracted_entities, '$.rssGuid')"
        elif not re.fullmatch(r"[a-z_, ]+", expression):
            raise ValueError(f"Unsupported index expression: {name} = {expression}")
        statements.append(f"CREATE {'UNIQUE ' if unique else ''}INDEX {quote(name)} ON {quote(table)} ({expression});")
    for name, table, expression in ADD_INDEX.findall(remediation_sql):
        expressions = expression.replace('"', "")
        if not re.fullmatch(r"[a-z_, ]+", expressions):
            raise ValueError(f"Unsupported remediation index: {name}")
        statements.append(f"CREATE INDEX {quote(name)} ON {quote(table)} ({expressions});")
    if set(skipped_indexes) != {
        "editorial_knowledge_entries_contexts_gin_idx",
        "editorial_knowledge_entries_match_terms_gin_idx",
    }:
        raise ValueError(f"Unexpected GIN indexes: {skipped_indexes}")
    statements.append("-- PostgreSQL GIN indexes above require a separate D1 JSON search plan.")
    return "\n\n".join(statements) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pg-schema", type=Path, required=True)
    parser.add_argument("--migration", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    remediation = "\n".join(path.read_text() for path in args.migration)
    output = make_schema(args.pg_schema.read_text(), remediation)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(output)
    print(f"D1 schema: {args.output}, {len(output)} bytes")


if __name__ == "__main__":
    main()
