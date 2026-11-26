"""2026-11-26：Content-Type 不是 JSON（例如 text/plain）時，FastAPI 直接拿原始 bytes 去驗證收 JSON 模型的端點，
422 的 input 就是那串 bytes。jsonable_encoder 對 bytes 用嚴格的 o.decode()，本文不是 UTF-8 就丟
UnicodeDecodeError，422 處理器自己炸掉，轉成 500 並寫進錯誤群組、觸發總管理者推播——匿名就能做到
（web 代理會原樣轉送 content-type 與本文）。2026-11-12 QA M1 擋了 surrogate 與 NaN，這條沒擋到。"""

from __future__ import annotations

import httpx
import pytest

from app.operations import error_reports

API = "/api/website/v1"


@pytest.fixture
def server_error_calls(monkeypatch) -> list:
    """記下 record_server_error 的呼叫，不真的寫錯誤群組；422 是呼叫端的問題，一次都不該記。"""
    calls: list = []

    async def _spy(request, exc) -> None:
        calls.append(exc)

    monkeypatch.setattr(error_reports, "record_server_error", _spy)
    return calls


def _raw_client(app) -> httpx.AsyncClient:
    # raise_app_exceptions=False：舊程式會先回 500 再重新拋出例外，這樣才看得到實際回給呼叫端的狀態碼。
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
        headers={"X-Ivy-Parent": "1"},
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "path, content_type, raw_body",
    [
        ("/auth/login", "text/plain", b"\xff"),
        ("/public/visit-requests", "text/plain", b"\xff"),
        # 表單編碼送到收 JSON 模型的端點一樣是原始 bytes。
        ("/auth/login", "application/x-www-form-urlencoded", b"email=\xfe\xff"),
        # UTF-8 編碼的 surrogate（ED A0 80）也是嚴格解碼解不開的。
        ("/public/visit-requests", "text/plain; charset=utf-8", b'"\xed\xa0\x80"'),
    ],
)
async def test_non_utf8_non_json_body_is_a_422_not_a_server_error(app, server_error_calls, path, content_type, raw_body):
    async with _raw_client(app) as client:
        response = await client.post(
            f"{API}{path}",
            content=raw_body,
            headers={"content-type": content_type, "Idempotency-Key": "validation422-raw-body"},
        )

    assert response.status_code == 422, response.text
    body = response.json()
    assert isinstance(body["detail"], list) and body["detail"]
    assert all({"loc", "msg", "type"} <= set(item) for item in body["detail"])
    # 原始本文仍帶回去，只是解不開的位元組換成 U+FFFD（和 _json_safe 處理 surrogate 的做法一致）。
    body_errors = [item for item in body["detail"] if item["loc"] and item["loc"][0] == "body"]
    assert body_errors and body_errors[0]["input"] == raw_body.decode("utf-8", "replace")
    assert "\ufffd" in body_errors[0]["input"]
    assert server_error_calls == []


@pytest.mark.asyncio
async def test_utf8_non_json_body_still_echoes_the_text(app, server_error_calls):
    """合法 UTF-8 的 text/plain 本來就回 422，修正後 input 照樣是原文，不因換掉解碼方式而走樣。"""
    async with _raw_client(app) as client:
        response = await client.post(
            f"{API}/auth/login", content="帳號".encode(), headers={"content-type": "text/plain"}
        )

    assert response.status_code == 422, response.text
    assert response.json()["detail"][0]["input"] == "帳號"
    assert server_error_calls == []
