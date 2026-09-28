#!/usr/bin/env python3
"""Convert pg_restore --data-only COPY blocks to table JSONL without a server.

The PostgreSQL custom dump is read by pg_restore first. This script parses
its text COPY stream strictly, preserving nulls, Unicode, and escaped control
characters. It does not connect to or modify the source database.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path


COPY_HEADER = re.compile(r"COPY (?:public|drizzle)\.([a-z_]+) \(([a-z_, ]+)\) FROM stdin;\n\Z")
ESCAPES = {"b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t", "v": "\v", "\\": "\\"}


def decode_field(field: str) -> str | None:
    if field == r"\N":
        return None
    result: list[str] = []
    index = 0
    while index < len(field):
        char = field[index]
        if char != "\\":
            result.append(char)
            index += 1
            continue
        index += 1
        if index >= len(field):
            raise ValueError("Unterminated COPY escape")
        escape = field[index]
        if escape in ESCAPES:
            result.append(ESCAPES[escape])
            index += 1
        elif escape == "x":
            if index + 2 >= len(field) or not re.fullmatch(r"[0-9a-fA-F]{2}", field[index + 1:index + 3]):
                raise ValueError("Malformed hex COPY escape")
            result.append(chr(int(field[index + 1:index + 3], 16)))
            index += 3
        elif escape in "01234567":
            match = re.match(r"[0-7]{1,3}", field[index:])
            if match is None:
                raise ValueError("Malformed octal COPY escape")
            result.append(chr(int(match.group(), 8)))
            index += len(match.group())
        else:
            raise ValueError(f"Unknown COPY escape: \\{escape}")
    return "".join(result)


def extract(source: Path, output_dir: Path) -> dict[str, int]:
    if output_dir.exists():
        raise FileExistsError(output_dir)
    output_dir.mkdir(parents=True)
    counts: dict[str, int] = {}
    table: str | None = None
    columns: list[str] = []
    output = None
    try:
        with source.open(encoding="utf-8") as stream:
            for line_number, line in enumerate(stream, 1):
                if table is None:
                    match = COPY_HEADER.fullmatch(line)
                    if match is None:
                        continue
                    table = match.group(1)
                    if table in counts:
                        raise ValueError(f"Duplicate COPY block for {table}")
                    columns = [part.strip() for part in match.group(2).split(",")]
                    counts[table] = 0
                    output = (output_dir / f"{table}.jsonl").open("w", encoding="utf-8")
                    continue
                if line == "\\.\n":
                    output.close()
                    output = None
                    table = None
                    continue
                fields = line.removesuffix("\n").split("\t")
                if len(fields) != len(columns):
                    raise ValueError(f"{table}: {line_number}: expected {len(columns)} fields, got {len(fields)}")
                row = {name: decode_field(value) for name, value in zip(columns, fields)}
                output.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
                counts[table] += 1
        if table is not None:
            raise ValueError(f"Unterminated COPY block for {table}")
    finally:
        if output is not None:
            output.close()
    return counts


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-sql", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    counts = extract(args.data_sql, args.output_dir)
    if len(counts) != 28:
        raise SystemExit(f"Expected 28 data tables, got {len(counts)}")
    print(json.dumps({"tables": len(counts), "total_rows": sum(counts.values()), "counts": counts},
                     sort_keys=True))


if __name__ == "__main__":
    main()
