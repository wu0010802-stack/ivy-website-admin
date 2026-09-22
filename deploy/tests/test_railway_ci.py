import importlib.util
import json
import subprocess
import tempfile
import unittest
from io import BytesIO
from pathlib import Path
from unittest.mock import patch
from urllib.error import URLError


MODULE_PATH = Path(__file__).resolve().parents[1] / "railway_ci.py"


class RailwayCITests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(MODULE_PATH.exists(), "部署工具尚未建立")
        spec = importlib.util.spec_from_file_location("railway_ci", MODULE_PATH)
        self.ci = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.ci)

    def test_snapshot_uses_commit_and_excludes_local_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            repo, snapshot = root / "repo", root / "snapshot"
            repo.mkdir()
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            for name in self.ci.SOURCE_PATHS:
                if name == ".dockerignore":
                    (repo / name).write_text("**/.env*\n")
                else:
                    (repo / name).mkdir()
                    (repo / name / "tracked.txt").write_text("committed")
            (repo / "web/.env.production").write_text("synthetic-secret")
            (repo / "web/public").mkdir()
            (repo / "web/public/release.json").write_text('{"snapshot":"old"}')
            subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
            subprocess.run([
                "git", "-C", str(repo), "-c", "user.name=CI Test",
                "-c", "user.email=ci@example.invalid", "commit", "-qm", "fixture",
            ], check=True)
            (repo / "web/tracked.txt").write_text("uncommitted change")
            (repo / "web/untracked.txt").write_text("local only")
            release = self.ci.prepare(repo, "HEAD", snapshot)
            self.assertEqual((snapshot / "web/tracked.txt").read_text(), "committed")
            self.assertFalse((snapshot / "web/.env.production").exists())
            self.assertFalse((snapshot / "web/untracked.txt").exists())
            self.assertEqual(release["snapshot"], self.ci.snapshot_hash(snapshot))
            self.assertEqual(json.loads((snapshot / "web/public/release.json").read_text()), release)

    def test_wait_does_not_accept_an_older_success(self):
        with patch.object(self.ci, "railway_json", side_effect=[
            [{"id": "old", "status": "SUCCESS"}, {"id": "new", "status": "BUILDING"}],
            [{"id": "new", "status": "SUCCESS"}],
        ]), patch.object(self.ci.time, "sleep") as sleep:
            self.ci.wait_for_deployment("api", "new")
        self.assertEqual(sleep.call_count, 1)

    def test_failed_deployment_fails_the_job(self):
        with patch.object(self.ci, "railway_json", return_value=[{"id": "new", "status": "FAILED"}]):
            with self.assertRaisesRegex(RuntimeError, "FAILED"):
                self.ci.wait_for_deployment("api", "new")

    def test_wait_times_out(self):
        with patch.object(self.ci.time, "monotonic", side_effect=[0, 1]):
            with self.assertRaisesRegex(RuntimeError, "逾時"):
                self.ci.wait_for_deployment("api", "new", timeout=0)

    def test_api_failure_prevents_web_deploy_and_smoke(self):
        with patch.object(self.ci, "deploy_service", side_effect=RuntimeError("FAILED")) as deploy, patch.object(self.ci, "smoke") as smoke:
            with self.assertRaisesRegex(RuntimeError, "FAILED"):
                self.ci.deploy(Path("unused"))
            self.assertEqual(deploy.call_count, 1)
            self.assertEqual(deploy.call_args.args[1], "api")
            smoke.assert_not_called()

    def test_wrong_online_release_fails_smoke(self):
        with patch.object(self.ci, "get_json", return_value={"snapshot": "old", "base_commit": "old"}):
            with self.assertRaisesRegex(RuntimeError, "release"):
                self.ci.smoke({"snapshot": "new", "base_commit": "new"})

    def test_public_read_retries_transient_network_error(self):
        self.assertTrue(hasattr(self.ci, "read_public"), "公開 GET 尚無重試")
        response = BytesIO(b'{"status":"ok"}')
        response.headers = {"Content-Type": "application/json"}
        with patch.object(self.ci, "urlopen", side_effect=[URLError("TLS timeout"), response]), patch.object(self.ci.time, "sleep"):
            self.assertEqual(self.ci.get_json("/health"), {"status": "ok"})

    def test_public_read_eventually_fails_on_network_error(self):
        self.assertTrue(hasattr(self.ci, "read_public"), "公開 GET 尚無重試")
        with patch.object(self.ci, "urlopen", side_effect=URLError("offline")), patch.object(self.ci.time, "sleep"):
            with self.assertRaises(URLError):
                self.ci.get_json("/health")


if __name__ == "__main__":
    unittest.main()
