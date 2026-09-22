import importlib.util
import unittest
from pathlib import Path


class SchemaGuardTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).resolve().parents[1] / "check_schema.py"
        self.assertTrue(path.exists(), "API schema guard 尚未建立")
        spec = importlib.util.spec_from_file_location("check_schema", path)
        self.guard = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.guard)

    def test_old_database_blocks_new_application(self):
        with self.assertRaisesRegex(RuntimeError, "migration"):
            self.guard.validate_revision(["ce3082c9bf69"], ["a1c4f7e92b30"])

    def test_empty_database_requires_explicit_migration(self):
        with self.assertRaisesRegex(RuntimeError, "migration"):
            self.guard.validate_revision([], ["a1c4f7e92b30"])

    def test_matching_revision_can_start(self):
        self.guard.validate_revision(["a1c4f7e92b30"], ["a1c4f7e92b30"])

    def test_multiple_migration_heads_block_startup(self):
        with self.assertRaisesRegex(RuntimeError, "migration"):
            self.guard.validate_revision(["a", "b"], ["a", "b"])


if __name__ == "__main__":
    unittest.main()
