#!/usr/bin/env python3
"""Turn a verified SQLite staging database into Wrangler D1 import SQL."""
import argparse
import sqlite3
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("sqlite", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise FileExistsError(args.output)
    conn = sqlite3.connect(f"file:{args.sqlite}?mode=ro", uri=True)
    try:
        with args.output.open("w") as output:
            for line in conn.iterdump():
                if line in ("BEGIN TRANSACTION;", "COMMIT;"):
                    continue
                if len(line.encode()) > 100_000:
                    raise ValueError("SQL statement exceeds the D1 100 KB limit")
                output.write(line + "\n")
    finally:
        conn.close()
    print(f"SQL bytes: {args.output.stat().st_size}")


if __name__ == "__main__":
    main()
