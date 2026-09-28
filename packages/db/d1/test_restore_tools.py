"""Checks for the lossless COPY and logical PostgreSQL restore comparison."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from copy_to_jsonl import decode_field, extract
from verify_pg_restore import canonical_row, digests, pg_array


class RestoreToolsTest(unittest.TestCase):
    def test_copy_escapes_and_null_are_distinct(self) -> None:
        self.assertIsNone(decode_field(r"\N"))
        self.assertEqual(decode_field(r"\\N"), r"\N")
        self.assertEqual(decode_field(r"one\ttwo\nthree\\four"), "one\ttwo\nthree\\four")
        self.assertEqual(decode_field(r"\x41\101"), "AA")
        with self.assertRaises(ValueError):
            decode_field("broken\\")

    def test_copy_block_requires_complete_rows(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "data.sql"
            source.write_text("COPY public.stories (id, title_hu) FROM stdin;\n"
                              "id-1\tElső\\tsor\n\\.\n")
            self.assertEqual(extract(source, root / "out"), {"stories": 1})
            self.assertEqual(json.loads((root / "out/stories.jsonl").read_text()),
                             {"id": "id-1", "title_hu": "Első\tsor"})

    def test_logical_hash_normalizes_pg_types_and_row_order(self) -> None:
        types = {"flag": "boolean", "count": "integer", "score": "numeric",
                 "tags": "ARRAY", "payload": "jsonb", "at": "timestamp with time zone"}
        export = {"flag": True, "count": 2, "score": "1", "tags": ["a", "b,c"],
                  "payload": {"a": 1, "z": [2]}, "at": "2026-09-27T18:02:49Z"}
        restored = {"flag": "t", "count": "2", "score": "1.00",
                    "tags": '{a,"b,c"}', "payload": '{"z":[2],"a":1}',
                    "at": "2026-09-27 18:02:49+00:00"}
        self.assertEqual(canonical_row(export, types), canonical_row(restored, types))
        self.assertEqual(digests([json.dumps(export)], types),
                         digests([json.dumps(restored)], types))
        self.assertEqual(pg_array("{}"), [])


if __name__ == "__main__":
    unittest.main()
