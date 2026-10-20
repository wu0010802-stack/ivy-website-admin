"""部署映像的 base image 以 digest 釘版（2026-09-29 資安稽核）：浮動 tag 會在
沒有 code review 的情況下換掉映像內容，也無法回溯某次部署實際跑的是哪個映像。
tag 保留給人看，digest 才是實際拉取的依據；更新時兩個一起改。"""

import importlib.util
import re
import unittest
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
PINNED = re.compile(r"^FROM\s+[a-z0-9./-]+:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}(\s+AS\s+\w+)?\s*$", re.IGNORECASE)


def _source_paths() -> tuple[str, ...]:
    spec = importlib.util.spec_from_file_location("railway_ci", DEPLOY / "railway_ci.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.SOURCE_PATHS


class DockerfilePinTests(unittest.TestCase):
    def test_every_base_image_is_pinned_by_digest(self):
        for name in ("api.Dockerfile", "web.Dockerfile"):
            lines = [line for line in (DEPLOY / name).read_text().splitlines() if line.upper().startswith("FROM ")]
            self.assertTrue(lines, name)
            for line in lines:
                self.assertRegex(line, PINNED, f"{name}: {line}")

    def test_web_build_and_runtime_stages_use_the_same_image(self):
        images = [line.split()[1] for line in (DEPLOY / "web.Dockerfile").read_text().splitlines() if line.startswith("FROM ")]
        self.assertEqual(len(set(images)), 1, images)

    def test_copy_sources_are_all_in_the_ci_snapshot(self):
        # CD 只用 git archive 打包 SOURCE_PATHS；Dockerfile COPY 到快照沒有的路徑會讓映像 build 失敗，
        # SOURCE_PATHS 列了 git 已沒有追蹤檔案的目錄則是 git archive 本身失敗（2026-10-12 刪 content/ 時的教訓）。
        allowed = set(_source_paths())
        for name in ("api.Dockerfile", "web.Dockerfile"):
            for line in (DEPLOY / name).read_text().splitlines():
                if not line.startswith("COPY ") or "--from=" in line:
                    continue
                args = [a for a in line.split()[1:] if not a.startswith("--")]
                for source in args[:-1]:
                    self.assertIn(source.split("/")[0], allowed, f"{name}: {line}")

    def test_ci_snapshot_paths_exist_in_the_repo(self):
        repo = DEPLOY.parent
        for name in _source_paths():
            self.assertTrue((repo / name).exists(), f"SOURCE_PATHS 的 {name} 在 repo 裡不存在，git archive 會失敗")


class ApiImageBytecodeTests(unittest.TestCase):
    """執行期 uid 10001 寫不進映像、又設 PYTHONDONTWRITEBYTECODE：bytecode 只能在 build 時編好（2026-10-20）。"""

    def test_api_image_compiles_bytecode_at_build_time(self):
        text = (DEPLOY / "api.Dockerfile").read_text()
        self.assertRegex(text, r"(?m)^ENV .*\bUV_COMPILE_BYTECODE=1\b")
        self.assertRegex(text, r"compileall .*\bapp\b.*\bmigrations\b")

    def test_backend_tests_stay_out_of_the_build_context(self):
        ignored = (DEPLOY.parent / ".dockerignore").read_text().splitlines()
        self.assertIn("backend/tests", ignored)
        self.assertIn("backend/.test_durations", ignored)


if __name__ == "__main__":
    unittest.main()
