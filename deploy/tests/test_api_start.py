import ast
import unittest
from pathlib import Path


START_PATH = Path(__file__).resolve().parents[1] / "api-start.py"


class ApiStartOrderTests(unittest.TestCase):
    def steps(self):
        found = []
        for node in ast.walk(ast.parse(START_PATH.read_text())):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
                continue
            if node.func.attr == "run":
                keywords = {k.arg: ast.unparse(k.value) for k in node.keywords}
                found.append((node.lineno, ast.unparse(node.args[0]), keywords))
            elif node.func.attr == "execvp":
                found.append((node.lineno, ast.unparse(node.args[0]), {}))
        return [step[1:] for step in sorted(found)]

    def test_migrates_then_verifies_then_serves(self):
        (migrate, migrate_kw), (check, check_kw), (serve, _) = self.steps()
        self.assertIn("'alembic', 'upgrade', 'head'", migrate)
        self.assertIn("check-schema.py", check)
        self.assertIn("uvicorn", serve)
        # 任一步失敗都要讓容器停在啟動前，不能帶著舊 schema 起 API。
        self.assertEqual(migrate_kw.get("check"), "True")
        self.assertEqual(check_kw.get("check"), "True")
        # Railway healthcheck 120 秒；migration 要在那之前自己逾時、回滾。
        self.assertLess(int(migrate_kw["timeout"]), 120)


if __name__ == "__main__":
    unittest.main()
