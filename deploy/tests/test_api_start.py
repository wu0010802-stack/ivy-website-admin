import ast
import os
import runpy
import unittest
from pathlib import Path
from unittest import mock


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


class ApiStartStorageTests(unittest.TestCase):
    """素材改存 S3 時不再綁 Railway volume；本機儲存仍然必須有 volume。"""

    def run_start(self, env):
        calls = []
        with mock.patch.dict(os.environ, env, clear=True), \
                mock.patch("subprocess.run", side_effect=lambda *a, **k: calls.append(a[0])), \
                mock.patch("os.execvp", side_effect=lambda *a: calls.append(a[1])), \
                mock.patch("os.getuid", return_value=10001), \
                mock.patch("pwd.getpwuid", return_value=mock.Mock(pw_dir="/home/website")):
            runpy.run_path(str(START_PATH))
        return calls

    def test_s3_storage_starts_without_volume(self):
        calls = self.run_start({"WEBSITE_ENVIRONMENT": "production", "WEBSITE_MEDIA_STORAGE": "s3", "PORT": "8000"})
        self.assertEqual(len(calls), 3)
        self.assertIn("uvicorn", calls[-1])

    def test_local_storage_still_requires_volume(self):
        with self.assertRaises(SystemExit) as ctx:
            self.run_start({"WEBSITE_ENVIRONMENT": "production", "PORT": "8000"})
        self.assertIn("/data volume", str(ctx.exception))


class ApiStartSafetyTests(unittest.TestCase):
    """2026-09-29 資安稽核：映像只給正式站用，漏設環境就不啟動；uvicorn 的
    access log 會連 query string（後台搜尋的家長姓名／手機）一起記，關掉。"""

    run_start = ApiStartStorageTests.run_start

    def test_refuses_to_start_without_environment(self):
        for env in ({"WEBSITE_MEDIA_STORAGE": "s3", "PORT": "8000"},
                    {"WEBSITE_ENVIRONMENT": "  ", "WEBSITE_MEDIA_STORAGE": "s3", "PORT": "8000"}):
            with self.assertRaises(SystemExit) as ctx:
                self.run_start(env)
            self.assertIn("WEBSITE_ENVIRONMENT", str(ctx.exception))

    def test_refuses_before_migrating(self):
        calls = []
        with mock.patch.dict(os.environ, {"WEBSITE_MEDIA_STORAGE": "s3"}, clear=True), \
                mock.patch("subprocess.run", side_effect=lambda *a, **k: calls.append(a[0])), \
                mock.patch("os.execvp", side_effect=lambda *a: calls.append(a[1])):
            with self.assertRaises(SystemExit):
                runpy.run_path(str(START_PATH))
        self.assertEqual(calls, [])

    def test_uvicorn_access_log_is_disabled(self):
        calls = self.run_start({"WEBSITE_ENVIRONMENT": "production", "WEBSITE_MEDIA_STORAGE": "s3", "PORT": "8000"})
        self.assertIn("--no-access-log", calls[-1])


if __name__ == "__main__":
    unittest.main()
