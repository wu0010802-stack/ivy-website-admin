"""錯誤回報遮蔽的效能回歸（2026-11-26，redactregex）。

POST /public/client-errors 在 async 路由裡同步跑 redact_text 與 js_location。舊的網址 query、Email、
堆疊位置三條正規式每個起點都先吃到結尾再回溯，一長串 '/'、'//a?'、連續字母就是 O(n²)：Nitro 允許的
6000 字堆疊就讓 API 唯一的事件迴圈卡零點幾秒，API 自己允許的 50000 字更到十幾秒。

這裡守兩件事：最壞情況的耗時有上限，以及改寫後的遮蔽與位置結果和舊正規式一模一樣
（舊的三條原封不動留在下面當規格，用固定亂數種子的短字串逐一比對）。"""
from __future__ import annotations

import random
import re
import time

from sqlalchemy import select

from app.operations import error_reports
from app.operations.models import ErrorGroup

API = "/api/website/v1"
URL = f"{API}/public/client-errors"

# 2026-11-26 以前的寫法：結果正確，只是最壞情況是二次方。
_OLD_URL_QUERY = re.compile(
    r"(?P<url>(?:[A-Za-z][A-Za-z0-9+.\-]*:)?//[^\s'\"<>()?#]+|(?<![\w/.:\-])/[^\s'\"<>()?#:]+)"
    r"[?#][^\s'\"<>()]*?(?P<pos>(?::\d+){0,2})(?=[\s'\"<>)\]]|$)"
)
_OLD_EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+")
_OLD_JS_FRAME = re.compile(
    r"(?<![\w/.:\-])(?P<file>/[^\s()'\"<>?#:]*)(?:[?#][^\s()'\"<>]*?)?:(?P<line>\d+):(?P<col>\d+)(?=[\s)\]]|$)"
)


def _old_strip_url_queries(text: str) -> str:
    return _OLD_URL_QUERY.sub(lambda m: m.group("url") + m.group("pos"), text)


def _old_js_location(stack: str) -> str | None:
    match = _OLD_JS_FRAME.search(stack)
    return None if match is None else f"{match.group('file')}:{match.group('line')}:{match.group('col')}"


def _elapsed_ms(fn, *args, **kwargs) -> float:
    """取三次裡最快的一次：CI 偶爾被別的工作搶 CPU，不能讓單次抖動變成紅燈。"""
    best = float("inf")
    for _ in range(3):
        start = time.perf_counter()
        fn(*args, **kwargs)
        best = min(best, (time.perf_counter() - start) * 1000)
    return best


# ----------------------------------------------------------------------------- 耗時上限

# 每一種都是舊寫法的最壞情況（8000 字＝STACK_LIMIT）：舊版要 100～900 ms，線性的寫法 1 ms 上下。
_WORST_CASES = {
    "一長串斜線": "/" * 8000,
    "//a? 重複、結尾接左括號": "//a?" * 2000 + "(",
    "/a? 重複、結尾接左括號": "/a?" * 2666 + "(",
    "scheme:// 重複": "a://" * 2000,
    "完整網址 # 重複、結尾接左括號": "http://a#" * 888 + "(",
    "連續字母（Email 本地部分）": "a" * 8000,
    "英數與減號（Email 本地部分）": "a1-" * 2666,
}


def test_redact_text_is_linear_on_the_old_worst_cases():
    for label, text in _WORST_CASES.items():
        elapsed = _elapsed_ms(error_reports.redact_text, text)
        assert elapsed < 50, f"{label}：{elapsed:.1f} ms"


def test_js_location_is_linear_on_the_old_worst_cases():
    for label, stack in {**_WORST_CASES, "/a# 重複、結尾接左括號": "/a#" * 2666 + "("}.items():
        elapsed = _elapsed_ms(error_reports.js_location, stack)
        assert elapsed < 50, f"{label}：{elapsed:.1f} ms"


def test_client_entry_at_the_nitro_limits_does_not_block_the_event_loop():
    """稽核重現的那一筆：官網 Nitro 允許的上限內（message 500、stack 6000），舊版要 0.2～0.5 秒。"""
    for stack in ("/" * 6000, "//a?" * 1499 + "(((", "/a?" * 2000):
        elapsed = _elapsed_ms(
            error_reports.client_entry,
            source="web", kind="TypeError", message="/" * 500, stack=stack, path="/" * 300, release=None, user_agent=None,
        )
        assert elapsed < 50, f"{stack[:8]}…：{elapsed:.1f} ms"


def test_client_entry_clips_each_field_before_redacting(monkeypatch):
    """API 收的本文比欄位上限長很多（stack 50000）：先截到欄位上限再遮蔽，最壞情況才跟著欄位上限走，
    不跟著 API 收的長度走。"""
    seen: dict[str, list[int]] = {}
    real_redact, real_location = error_reports.redact_text, error_reports.js_location

    def redact_spy(text: str, **kwargs) -> str:
        seen.setdefault(text[:1], []).append(len(text))
        return real_redact(text, **kwargs)

    def location_spy(stack):
        seen.setdefault("location", []).append(len(stack or ""))
        return real_location(stack)

    monkeypatch.setattr(error_reports, "redact_text", redact_spy)
    monkeypatch.setattr(error_reports, "js_location", location_spy)
    entry = error_reports.client_entry(
        source="web", kind="K" * 2000, message="m" * 20_000, stack="s" * 50_000, path="/" + "p" * 1999,
        release=None, user_agent=None,
    )
    assert max(seen["K"]) <= error_reports.KIND_LIMIT
    assert max(seen["m"]) <= error_reports.MESSAGE_LIMIT
    assert max(seen["/"]) <= error_reports.PATH_LIMIT
    assert max(seen["s"]) <= error_reports.STACK_LIMIT
    assert max(seen["location"]) <= error_reports.STACK_LIMIT
    assert len(entry.kind) <= error_reports.KIND_LIMIT and len(entry.message) <= error_reports.MESSAGE_LIMIT
    assert len(entry.path) <= error_reports.PATH_LIMIT and len(entry.stack or "") <= error_reports.STACK_LIMIT


async def test_report_at_the_api_limit_is_stored_quickly_and_redacted(public_client, db_session):
    """不經 Nitro 直接打 API：stack 是 API 允許的上限 50000 字（舊版單筆卡 14 秒以上）。"""
    stack = "Error: boom\n    at go (/_nuxt/a.js?email=mom@example.com:3:4)\n" + "/" * (50_000 - 60)
    start = time.perf_counter()
    response = await public_client.post(URL, json={
        "source": "web", "kind": "TypeError", "message": "//a?" * 125, "stack": stack[:50_000], "path": "/x",
    })
    elapsed = time.perf_counter() - start
    assert response.status_code == 204
    assert elapsed < 1.0, f"{elapsed:.2f} s"
    [group] = (await db_session.execute(select(ErrorGroup))).scalars().all()
    assert group.location == "/_nuxt/a.js:3:4"
    assert "mom@example.com" not in (group.sample_stack or "") and "email=" not in (group.sample_stack or "")
    assert len(group.sample_stack or "") <= error_reports.STACK_LIMIT


# ----------------------------------------------------------------------------- 結果和舊正規式一致

# 每組字元都刻意含網址與堆疊的語法字元（/ : ? # ] 與分隔用的空白、引號、括號），短字串才湊得出各種邊角。
_ALPHABETS = (
    "/:?#]a1( )'.-_@%+x",
    "/?#:]1a(",
    "/:?#]ab12( ) \n\"<>.-+中",
    "a@.-_%+1 b]",
    "/?#:]123 ()",
    "ht:/p?#1]",
    "/?#:]1١\u3000\x1c中a(",
)


def _samples(count: int = 4000, max_length: int = 40):
    rng = random.Random(20261126)
    for alphabet in _ALPHABETS:
        for _ in range(count):
            yield "".join(rng.choice(alphabet) for _ in range(rng.randint(0, max_length)))


def test_url_query_stripping_matches_the_old_regex():
    for sample in _samples():
        assert error_reports._strip_url_queries(sample) == _old_strip_url_queries(sample), repr(sample)


def test_email_redaction_matches_the_old_regex():
    for sample in _samples():
        assert error_reports._redact_emails(sample) == _OLD_EMAIL.sub("[email]", sample), repr(sample)


def test_js_location_matches_the_old_regex():
    for sample in _samples():
        assert error_reports.js_location(sample) == (_old_js_location(sample) if sample else None), repr(sample)


def test_documented_cases_keep_their_results():
    """實際會遇到的寫法（堆疊 frame、query 裡的電話與 Email、連續的 Email）結果不變。"""
    redact = error_reports.redact_text
    assert redact("at f (https://a.example/e.js?v=3:12:34)") == "at f (https://a.example/e.js:12:34)"
    assert redact("at g (/_nuxt/f.js?email=mom@example.com:5:6)") == "at g (/_nuxt/f.js:5:6)"
    assert redact("g@https://cdn.example/x.js?v=1:2:3\nh@/_nuxt/c.js#x:7:8") == "g@https://cdn.example/x.js:2:3\nh@/_nuxt/c.js:7:8"
    assert redact("fetch /api/x?phone=0912345678 failed") == "fetch /api/x failed"
    assert redact("[https://a.example/p?q=1] /b?c]") == "[https://a.example/p] /b]"
    assert redact("a@b.c.%d@e.f mom@example.com.") == "[email][email] [email]."
    assert error_reports.js_location("E\n    at f (/_nuxt/a.js?v=1#x:10:20)\n    at g (/_nuxt/b.js:3:4)") == "/_nuxt/a.js:10:20"
