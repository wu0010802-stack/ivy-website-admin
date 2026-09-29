"""部署映像的 base image 以 digest 釘版（2026-09-29 資安稽核）：浮動 tag 會在
沒有 code review 的情況下換掉映像內容，也無法回溯某次部署實際跑的是哪個映像。
tag 保留給人看，digest 才是實際拉取的依據；更新時兩個一起改。"""

import re
import unittest
from pathlib import Path

DEPLOY = Path(__file__).resolve().parents[1]
PINNED = re.compile(r"^FROM\s+[a-z0-9./-]+:[A-Za-z0-9._-]+@sha256:[0-9a-f]{64}(\s+AS\s+\w+)?\s*$", re.IGNORECASE)


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


if __name__ == "__main__":
    unittest.main()
