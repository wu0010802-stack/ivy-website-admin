"""手打「@官方帳號名稱」叫出選單（2026-11-28）。

使用者在電腦版 LINE 的總部群組打「@常春藤官網通知」沒有回應：沒有從名單選，訊息不帶 mention 資料，
剝掉「@」之後剩下帳號名稱，不是任何指令，被當成閒聊略過。現在手打的名稱等於官方帳號在 LINE 上的名稱時，
拿掉名稱、當成真的標記：只有名稱 → 選單；名稱後面接短字也認。別人的名字（「@小明」）照舊不回。"""

from __future__ import annotations

import pytest

from app.notifications import line_parent
from app.notifications.line_group_commands import _without_typed_name
from tests.test_line_group_commands import HQ_GROUP, YIHUA_GROUP, _group_event, _world
from tests.test_line_integrations_20261116 import _webhook, fake_line  # noqa: F401  (fixtures)

pytestmark = pytest.mark.usefixtures("booking_consent")

# tests.test_line_integrations_20261116.FakeLine 的 /v2/bot/info 給 main 帳號的名稱。
OWN_NAME = "常春藤官網"


def test_without_typed_name_strips_only_the_whole_name_at_the_start():
    assert _without_typed_name("常春藤官網", OWN_NAME) == ""
    assert _without_typed_name("常春藤官網 今天", OWN_NAME) == "今天"
    assert _without_typed_name("常春藤官網\n待標記", OWN_NAME) == "待標記"
    # 名稱後面要是結尾或空白才算；別人的名字、名稱在句中都不動。
    for text in ("常春藤官網通知書", "小明", "今天 常春藤官網", "常春藤"):
        assert _without_typed_name(text, OWN_NAME) == text, text
    # 名稱查不到（LINE 連不上）就照舊。
    assert _without_typed_name("常春藤官網", None) == "常春藤官網"
    # 帳號名稱裡的全形字、前後空白比照訊息（訊息已 NFKC）。
    assert _without_typed_name("Ivy Kids 今天", " Ｉｖｙ　Ｋｉｄｓ ") == "今天"


async def _send(app, text: str, group: str = HQ_GROUP):
    response = await _webhook(app, [_group_event("message", group, text)], account="main")
    assert response.status_code == 200


async def test_typed_own_name_alone_returns_the_menu(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client)
    for group in (HQ_GROUP, YIHUA_GROUP):
        fake_line.replies.clear()
        await _send(app, f"@{OWN_NAME}", group)
        assert len(fake_line.replies) == 1, group
        assert "參觀名單選單" in fake_line.replies[0]["body"]["messages"][0]["altText"]
    assert fake_line.pushes == []


async def test_typed_own_name_then_short_word_is_a_query(app, fake_line, admin_client, public_client):
    await _world(app, admin_client, public_client)
    await _send(app, f"＠{OWN_NAME} 今天")
    assert len(fake_line.replies) == 1
    assert fake_line.replies[0]["body"]["messages"][0]["altText"].startswith("今日參觀")
    await _send(app, f"@{OWN_NAME} 明華 今天參觀")
    assert len(fake_line.replies) == 2


async def test_other_names_and_chatter_stay_silent(app, fake_line, admin_client, public_client, monkeypatch):
    await _world(app, admin_client, public_client)
    calls = 0
    real = line_parent.bot_info

    async def counted(*args, **kwargs):
        nonlocal calls
        calls += 1
        return await real(*args, **kwargs)

    monkeypatch.setattr(line_parent, "bot_info", counted)
    # 一般閒聊與原本就認得的指令不必查帳號名稱。
    for text in ("大家好", "今天參觀", "@今天", "@"):
        await _send(app, text)
    assert calls == 0
    before = len(fake_line.replies)
    for text in ("@小明", "@小明 今天", f"@{OWN_NAME}通知書", f"@{OWN_NAME} 你好"):
        await _send(app, text)
    assert len(fake_line.replies) == before
    assert calls == 4


async def test_name_lookup_failure_stays_silent(app, fake_line, admin_client, public_client, monkeypatch):
    await _world(app, admin_client, public_client)

    async def unavailable(*args, **kwargs):
        return None

    monkeypatch.setattr(line_parent, "bot_info", unavailable)
    await _send(app, f"@{OWN_NAME}")
    assert fake_line.replies == []
