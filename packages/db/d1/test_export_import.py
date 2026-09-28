"""Regression test for D1's transaction-splitting remote SQL importer."""

from __future__ import annotations

import sqlite3
import tempfile
import unittest
from pathlib import Path

from export_import import export


class OrderedImportTest(unittest.TestCase):
    def test_cyclic_foreign_keys_survive_statement_by_statement_import(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "source.sqlite"
            script = root / "import.sql"
            target = root / "target.sqlite"
            db = sqlite3.connect(source)
            db.executescript("""
                CREATE TABLE categories (
                    id TEXT PRIMARY KEY, parent_id TEXT,
                    FOREIGN KEY (parent_id) REFERENCES categories(id)
                );
                CREATE TABLE stories (
                    id TEXT PRIMARY KEY, current_version_id TEXT,
                    FOREIGN KEY (current_version_id) REFERENCES story_versions(id)
                );
                CREATE TABLE story_versions (
                    id TEXT PRIMARY KEY, story_id TEXT NOT NULL,
                    FOREIGN KEY (story_id) REFERENCES stories(id)
                );
                INSERT INTO categories VALUES ('child', 'parent');
                INSERT INTO categories VALUES ('parent', NULL);
                INSERT INTO stories VALUES ('story', 'version');
                INSERT INTO story_versions VALUES ('version', 'story');
            """)
            self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])
            db.close()

            self.assertEqual(export(source, script), (3, 4))
            imported = sqlite3.connect(target)
            imported.execute("PRAGMA foreign_keys=ON")
            # Each SQL statement commits independently, like a split D1 import.
            for statement in script.read_text().split(";\n"):
                if statement.strip():
                    imported.execute(statement)
                    imported.commit()
            self.assertEqual(imported.execute("PRAGMA foreign_key_check").fetchall(), [])
            self.assertEqual(
                imported.execute("SELECT current_version_id FROM stories").fetchone()[0],
                "version",
            )
            self.assertEqual(
                imported.execute("SELECT parent_id FROM categories WHERE id='child'").fetchone()[0],
                "parent",
            )
            imported.close()


if __name__ == "__main__":
    unittest.main()
