"""官網外部存活監測（2026-11-05）：GitHub Actions 每 10 分鐘執行（.github/workflows/uptime.yml）。

從 Railway 以外的地方打正式站，掛了就以結束碼 1 讓 workflow 失敗，GitHub 會寄失敗通知信。只用標準庫、
只做 GET、不帶任何帳號或 cookie；User-Agent 固定 ivy-website-uptime/1.0，不放任何帳號、email 或人名。

四項檢查（每項最多 3 次、間隔 20 秒，撐得過部署重啟；逾時 15 秒）：
- GET /                      200 且內容有 </html>
- GET /api/website/v1/health 200、JSON status=ok、environment=production（這支不查資料庫）
- GET /api/public-site       200、JSON 有 release_id 與 content（這支會讀資料庫，判斷同 railway_ci.py smoke）
- GET /admin/                200

重試以「一輪」為單位：第一輪四項都打，失敗的等 20 秒再一輪，最多三輪，所以整體最壞約 220 秒，
在 workflow 的 5 分鐘上限內。用法：python3 deploy/uptime_check.py [網址]。"""
from __future__ import annotations

import json
import sys
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

DEFAULT_BASE_URL = "https://www.ivykidschool.com"
USER_AGENT = "ivy-website-uptime/1.0"
ATTEMPTS = 3
RETRY_DELAY_SECONDS = 20.0
TIMEOUT_SECONDS = 15.0
# 首頁與 public-site 都在幾百 KB 以內；上限只是不讓異常的回應吃光記憶體。
MAX_BODY_BYTES = 10 * 1024 * 1024


class CheckFailed(Exception):
    """某一項檢查沒過；訊息會原樣出現在 workflow 的錯誤註記，不放回應本文。"""


def _json(body: bytes) -> dict:
    try:
        value = json.loads(body)
    except ValueError as error:
        raise CheckFailed("回應不是 JSON") from error
    if not isinstance(value, dict):
        raise CheckFailed("回應不是 JSON 物件")
    return value


def validate_home(body: bytes) -> None:
    if b"</html>" not in body.lower():
        raise CheckFailed("頁面內容不完整（沒有 </html>）")


def validate_health(body: bytes) -> None:
    health = _json(body)
    if health.get("status") != "ok":
        raise CheckFailed(f"health status 不是 ok（{health.get('status')!r}）")
    if health.get("environment") != "production":
        raise CheckFailed(f"health environment 不是 production（{health.get('environment')!r}）")


def validate_public_site(body: bytes) -> None:
    site = _json(body)
    if not site.get("release_id") or not site.get("content"):
        raise CheckFailed("公開 CMS 沒有已發布內容（缺 release_id 或 content）")


def validate_admin(body: bytes) -> None:
    if not body:
        raise CheckFailed("後台頁面是空的")


@dataclass(frozen=True)
class Check:
    path: str
    validate: Callable[[bytes], None]


CHECKS: tuple[Check, ...] = (
    Check("/", validate_home),
    Check("/api/website/v1/health", validate_health),
    Check("/api/public-site", validate_public_site),
    Check("/admin/", validate_admin),
)


@dataclass
class Result:
    path: str
    ok: bool
    attempts: int
    reason: str = ""


def fetch(url: str, timeout: float = TIMEOUT_SECONDS) -> tuple[int, bytes]:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Cache-Control": "no-cache"})
    with urlopen(request, timeout=timeout) as response:
        return response.status, response.read(MAX_BODY_BYTES)


def _attempt(base_url: str, check: Check, timeout: float, get: Callable[..., tuple[int, bytes]]) -> str | None:
    """打一次。通過回 None，沒過回原因。"""
    try:
        status, body = get(base_url + check.path, timeout)
        if status != 200:
            return f"HTTP {status}"
        check.validate(body)
    except CheckFailed as error:
        return str(error)
    except HTTPError as error:
        return f"HTTP {error.code}"
    except TimeoutError:
        return f"逾時（{timeout:g} 秒）"
    except URLError as error:
        reason = error.reason
        return "逾時" if isinstance(reason, TimeoutError) else f"連線失敗（{type(reason).__name__}）"
    except OSError as error:
        return f"連線失敗（{type(error).__name__}）"
    return None


def run_checks(
    base_url: str,
    *,
    checks: Sequence[Check] = CHECKS,
    attempts: int = ATTEMPTS,
    delay: float = RETRY_DELAY_SECONDS,
    timeout: float = TIMEOUT_SECONDS,
    sleep: Callable[[float], None] = time.sleep,
    get: Callable[..., tuple[int, bytes]] = fetch,
    log: Callable[[str], None] = print,
) -> list[Result]:
    base = base_url.rstrip("/")
    results = {check.path: Result(check.path, False, 0) for check in checks}
    pending = list(checks)
    for round_number in range(1, attempts + 1):
        still_failing: list[Check] = []
        for check in pending:
            reason = _attempt(base, check, timeout, get)
            result = results[check.path]
            result.attempts = round_number
            if reason is None:
                result.ok, result.reason = True, ""
            else:
                result.reason = reason
                still_failing.append(check)
                log(f"第 {round_number} 次 GET {check.path} 沒過：{reason}")
        pending = still_failing
        if not pending:
            break
        if round_number < attempts:
            sleep(delay)
    return [results[check.path] for check in checks]


def _annotation_text(text: str) -> str:
    """GitHub workflow command 的訊息要跳脫 % 與換行。"""
    return text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")


def report(base_url: str, results: Sequence[Result], log: Callable[[str], None] = print) -> int:
    for result in results:
        if not result.ok:
            message = f"GET {result.path} 失敗（試了 {result.attempts} 次）：{result.reason}"
            log(f"::error title=官網存活檢查失敗::{_annotation_text(message)}")
    summary = "　".join(
        f"{result.path}={'ok' if result.ok else 'FAIL'}" + (f"（第 {result.attempts} 次才過）" if result.ok and result.attempts > 1 else "")
        for result in results
    )
    failed = [result for result in results if not result.ok]
    log(f"uptime {base_url}　{'全部正常' if not failed else f'{len(failed)} 項失敗'}　{summary}")
    return 1 if failed else 0


def main(
    argv: Sequence[str] | None = None,
    *,
    sleep: Callable[[float], None] = time.sleep,
    get: Callable[..., tuple[int, bytes]] = fetch,
    delay: float = RETRY_DELAY_SECONDS,
    timeout: float = TIMEOUT_SECONDS,
    log: Callable[[str], None] = print,
) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    base_url = (args[0] if args else "") or DEFAULT_BASE_URL
    if not base_url.startswith(("https://", "http://")):
        log(f"::error title=官網存活檢查設定錯誤::網址要以 https:// 開頭：{_annotation_text(base_url[:80])}")
        return 2
    results = run_checks(base_url, sleep=sleep, get=get, delay=delay, timeout=timeout, log=log)
    return report(base_url.rstrip("/"), results, log)


if __name__ == "__main__":
    sys.exit(main())
