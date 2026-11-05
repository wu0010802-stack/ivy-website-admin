"""外部存活監測（2026-11-05，deploy/uptime_check.py + .github/workflows/uptime.yml）：四項檢查、
單項失敗、重試後成功、逾時與連線失敗、User-Agent 不含個資、workflow 的設定。

用本機 http.server 當「正式站」；重試間隔注入假的 sleep，不真的等 20 秒。"""
from __future__ import annotations

import importlib.util
import json
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("uptime_check", ROOT / "deploy" / "uptime_check.py")
uptime = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = uptime  # dataclass 解析型別註記要從 sys.modules 找到自己
SPEC.loader.exec_module(uptime)

HEALTH = {"status": "ok", "environment": "production", "fixture_enabled": False}
SITE = {"release_id": "r1", "content": {"home": {}}}


class FakeSite:
    """routes: 路徑 → (狀態碼, content-type, 本文) 或「依第幾次請求回不同結果」的函式。"""

    def __init__(self) -> None:
        self.routes: dict = {
            "/": (200, "text/html", b"<!doctype html><html><body>ok</body></html>"),
            "/api/website/v1/health": (200, "application/json", json.dumps(HEALTH).encode()),
            "/api/public-site": (200, "application/json", json.dumps(SITE).encode()),
            "/admin/": (200, "text/html", b"<html><body><div id=app></div></body></html>"),
        }
        self.hits: dict[str, int] = {}
        self.headers: list[dict[str, str]] = []
        self.delay: dict[str, float] = {}
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                outer.hits[self.path] = outer.hits.get(self.path, 0) + 1
                outer.headers.append({k.lower(): v for k, v in self.headers.items()})
                time.sleep(outer.delay.get(self.path, 0))
                route = outer.routes.get(self.path, (404, "text/plain", b"not found"))
                status, content_type, body = route(outer.hits[self.path]) if callable(route) else route
                try:
                    self.send_response(status)
                    self.send_header("Content-Type", content_type)
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                except OSError:  # 客戶端逾時先斷線
                    pass

            def log_message(self, *args):  # 不把請求紀錄灌進測試輸出
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    def __enter__(self) -> "FakeSite":
        self.thread.start()
        return self

    def __exit__(self, *exc) -> None:
        self.server.shutdown()
        self.server.server_close()


class Recorder:
    def __init__(self) -> None:
        self.lines: list[str] = []
        self.sleeps: list[float] = []

    def log(self, line: str) -> None:
        self.lines.append(line)

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)


def run(site: FakeSite, recorder: Recorder, **kwargs) -> int:
    return uptime.main([site.url], sleep=recorder.sleep, log=recorder.log, **kwargs)


def test_all_four_checks_pass_with_one_summary_line():
    with FakeSite() as site:
        recorder = Recorder()
        assert run(site, recorder) == 0
        assert site.hits == {"/": 1, "/api/website/v1/health": 1, "/api/public-site": 1, "/admin/": 1}
    assert recorder.sleeps == []
    assert len(recorder.lines) == 1
    assert "全部正常" in recorder.lines[0] and "FAIL" not in recorder.lines[0]
    for path in ("/=ok", "/api/website/v1/health=ok", "/api/public-site=ok", "/admin/=ok"):
        assert path in recorder.lines[0]


def test_a_single_failing_check_fails_the_run_after_three_attempts_with_an_error_annotation():
    with FakeSite() as site:
        site.routes["/api/public-site"] = (502, "text/plain", b"bad gateway")
        recorder = Recorder()
        assert run(site, recorder) == 1
        # 失敗的那項打滿三次，其餘各一次；每輪之間等 20 秒（共兩次）。
        assert site.hits == {"/": 1, "/api/website/v1/health": 1, "/api/public-site": 3, "/admin/": 1}
    assert recorder.sleeps == [20.0, 20.0]
    errors = [line for line in recorder.lines if line.startswith("::error")]
    assert len(errors) == 1
    assert "/api/public-site" in errors[0] and "HTTP 502" in errors[0] and "3 次" in errors[0]
    assert "1 項失敗" in recorder.lines[-1] and "/api/public-site=FAIL" in recorder.lines[-1]
    assert "/admin/=ok" in recorder.lines[-1]


def test_a_check_that_recovers_within_three_attempts_passes():
    with FakeSite() as site:
        site.routes["/api/website/v1/health"] = lambda n: (503, "text/plain", b"restarting") if n < 3 else (200, "application/json", json.dumps(HEALTH).encode())
        recorder = Recorder()
        assert run(site, recorder) == 0
        assert site.hits["/api/website/v1/health"] == 3
        assert site.hits["/"] == 1  # 已經過的不重打
    assert recorder.sleeps == [20.0, 20.0]
    assert not [line for line in recorder.lines if line.startswith("::error")]
    assert "第 3 次才過" in recorder.lines[-1]


def test_still_failing_on_the_third_attempt_is_a_failure():
    with FakeSite() as site:
        site.routes["/"] = lambda n: (500, "text/plain", b"x") if n < 4 else (200, "text/html", b"</html>")
        assert run(site, Recorder()) == 1
        assert site.hits["/"] == 3


@pytest.mark.parametrize(
    ("path", "route", "message"),
    [
        ("/", (200, "text/html", b"<html><body>cut off"), "</html>"),
        ("/api/website/v1/health", (200, "application/json", json.dumps({**HEALTH, "status": "degraded"}).encode()), "status 不是 ok"),
        ("/api/website/v1/health", (200, "application/json", json.dumps({**HEALTH, "environment": "staging"}).encode()), "environment 不是 production"),
        ("/api/website/v1/health", (200, "text/html", b"<html>proxy error page</html>"), "不是 JSON"),
        ("/api/website/v1/health", (200, "application/json", b"[1, 2]"), "不是 JSON 物件"),
        ("/api/public-site", (200, "application/json", json.dumps({"release_id": "r1", "content": {}}).encode()), "沒有已發布內容"),
        ("/api/public-site", (200, "application/json", json.dumps({"content": {"a": 1}}).encode()), "沒有已發布內容"),
        ("/admin/", (404, "text/plain", b"nope"), "HTTP 404"),
        ("/admin/", (200, "text/html", b""), "空的"),
    ],
)
def test_content_checks_reject_wrong_answers(path, route, message):
    with FakeSite() as site:
        site.routes[path] = route
        recorder = Recorder()
        assert run(site, recorder) == 1
    [error] = [line for line in recorder.lines if line.startswith("::error")]
    assert path in error and message in error


def test_slow_responses_time_out():
    with FakeSite() as site:
        site.delay["/admin/"] = 1.0
        recorder = Recorder()
        assert run(site, recorder, timeout=0.2) == 1
    [error] = [line for line in recorder.lines if line.startswith("::error")]
    assert "/admin/" in error and "逾時" in error


def test_connection_refused_fails_every_check_without_leaking_details():
    with FakeSite() as site:
        url = site.url
    recorder = Recorder()
    assert uptime.main([url], sleep=recorder.sleep, log=recorder.log) == 1
    errors = [line for line in recorder.lines if line.startswith("::error")]
    assert len(errors) == 4 and all("連線失敗" in error for error in errors)
    assert "4 項失敗" in recorder.lines[-1]


def test_user_agent_is_generic_and_carries_no_identity():
    assert uptime.USER_AGENT == "ivy-website-uptime/1.0"
    with FakeSite() as site:
        site.routes["/admin/"] = (500, "text/plain", b"x")  # 重試也要用同一個 UA
        run(site, Recorder())
        sent = site.headers
    assert len(sent) == 4 + 2
    for headers in sent:
        assert headers["user-agent"] == "ivy-website-uptime/1.0"
        assert not {"authorization", "cookie", "x-forwarded-for"} & set(headers)
    source = (ROOT / "deploy" / "uptime_check.py").read_text(encoding="utf-8")
    assert not re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", source)  # 沒有 email


def test_base_url_defaults_to_production_and_rejects_non_urls():
    seen: list[str] = []

    def get(url, timeout):
        seen.append(url)
        raise OSError("blocked in test")

    recorder = Recorder()
    assert uptime.main([], sleep=recorder.sleep, get=get, log=recorder.log) == 1
    assert seen[0] == "https://web-production-04caa.up.railway.app/"
    seen.clear()
    assert uptime.main(["https://example.test/"], sleep=recorder.sleep, get=get, log=recorder.log) == 1
    assert seen[0] == "https://example.test/"  # 結尾斜線不會變成雙斜線
    assert uptime.main(["ftp://x"], sleep=recorder.sleep, get=get, log=recorder.log) == 2
    assert uptime.main([""], sleep=recorder.sleep, get=get, log=recorder.log) == 1  # 空字串＝沒設定，退回預設網址


def test_annotation_messages_escape_workflow_command_characters():
    assert uptime._annotation_text("a%b\nc\rd") == "a%25b%0Ac%0Dd"


def test_default_retry_settings_match_the_documented_ones():
    assert (uptime.ATTEMPTS, uptime.RETRY_DELAY_SECONDS, uptime.TIMEOUT_SECONDS) == (3, 20.0, 15.0)
    # 最壞情況：三輪四項都逾時 ＋ 兩次等待，要在 workflow 的 5 分鐘上限內。
    worst = uptime.ATTEMPTS * len(uptime.CHECKS) * uptime.TIMEOUT_SECONDS + (uptime.ATTEMPTS - 1) * uptime.RETRY_DELAY_SECONDS
    assert worst < 5 * 60


def test_workflow_is_scheduled_read_only_and_pinned():
    workflow = (ROOT / ".github" / "workflows" / "uptime.yml").read_text(encoding="utf-8")
    assert "cron: '*/10 * * * *'" in workflow and "workflow_dispatch:" in workflow
    assert re.search(r"permissions:\n  contents: read", workflow)
    assert re.search(r"concurrency:\n  group: uptime\n  cancel-in-progress: false", workflow)
    assert "timeout-minutes: 5" in workflow
    assert "actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4" in workflow
    assert "sparse-checkout: deploy/uptime_check.py" in workflow
    assert "vars.UPTIME_BASE_URL || 'https://web-production-04caa.up.railway.app'" in workflow
    assert 'python3 deploy/uptime_check.py "$UPTIME_BASE_URL"' in workflow
    # 同一個 SHA 釘版與 website.yml 一致
    pinned = re.search(r"actions/checkout@([0-9a-f]{40})", (ROOT / ".github" / "workflows" / "website.yml").read_text(encoding="utf-8"))
    assert pinned and pinned.group(1) in workflow
