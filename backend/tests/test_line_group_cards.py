"""群組卡片：依種類換色、到場按鈕、postback 資料編碼（2026-11-17 LINE 群組互動 Task 4）。"""

from __future__ import annotations

import json
import uuid

import pytest

from app.notifications import line_flex, line_group_actions
from app.notifications.line_group_actions import decode, encode

KINDS = ["visit_request_created", "visit_request_confirmed", "visit_request_rescheduled", "visit_request_cancelled"]
RECEIPT = str(uuid.uuid4())


def _card(kind: str, *, attend: bool = False, parent: str | None = "林小姐") -> dict:
    return line_flex.staff_card(
        "標題", "義華校", when="11/20 上午", parent_name=parent, receipt_id=RECEIPT,
        url="https://admin.example.com/x", kind=kind, attend_buttons=attend,
    )


def _title_color(message: dict) -> str:
    header = message["contents"]["header"]["contents"]
    return header[1]["color"]


def _postbacks(message: dict) -> list[dict]:
    found: list[dict] = []

    def walk(node):
        if isinstance(node, dict):
            if node.get("type") == "postback":
                found.append({"action": node})
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(message)
    return found


def _postbacks_raw(message: dict) -> list[dict]:
    buttons = message["contents"]["footer"]["contents"]
    return [b for b in buttons if b["action"]["type"] == "postback"]


def _luminance(hex_color: str) -> float:
    channels = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    lin = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def test_each_kind_has_its_own_title_color():
    colors = [_title_color(_card(kind)) for kind in KINDS]
    assert len(set(colors)) == 4
    for kind, color in zip(KINDS, colors):
        assert color == line_flex.KIND_STYLE[kind][0]
    assert _title_color(_card("something_unknown")) == line_flex.BRAND


def test_title_colors_meet_contrast_on_white():
    for kind in KINDS:
        for c in line_flex.KIND_STYLE[kind]:
            assert (1.05) / (_luminance(c) + 0.05) >= 4.5, (kind, c)


def test_attend_buttons_present_for_confirmed_booking_and_absent_for_cancelled():
    posts = _postbacks(_card("visit_request_created", attend=True))
    assert [p["action"]["data"] for p in posts] == [encode("att", RECEIPT), encode("nos", RECEIPT)]
    assert [p["action"]["label"] for p in posts] == ["已到場", "未到場"]
    assert all("displayText" not in p["action"] for p in posts)
    for p in _postbacks_raw(_card("visit_request_created", attend=True)):
        assert p["style"] == "link" and p["color"] == line_flex.KIND_STYLE["visit_request_created"][1]
    assert _postbacks(_card("visit_request_created", attend=False)) == []
    assert _postbacks(_card("visit_request_cancelled", attend=True)) == []


def test_only_confirm_buttons_carry_display_text_without_parent_name():
    """確認卡的「確認」帶 displayText（LINE 以按的人的名義在群組顯示，留下誰確認的；設計 §5 第 2 點），
    字面固定、不含家長稱呼或時段。「取消」與所有詢問類按鈕不帶，按了不在群組留言。"""
    for action, shown in (("att", "確認已到場"), ("nos", "確認未到場"), ("rfd", "確認已預繳")):
        message = line_flex.confirm_message(action, RECEIPT, "林小姐", "11/20（四）10:00", "1.abc")
        confirm, cancel = [p["action"] for p in _postbacks(message)]
        assert confirm["label"] == "確認" and confirm["displayText"] == shown
        assert len(confirm["displayText"]) <= 300
        assert "林小姐" not in confirm["displayText"] and "10:00" not in confirm["displayText"]
        assert cancel["label"] == "取消" and "displayText" not in cancel
    rv = str(uuid.uuid4())
    asks = [
        _card("visit_request_created", attend=True),
        line_flex.attended_result_message("林小姐", recruitment_visit_id=rv, receipt_id=RECEIPT, admin_url=None, already_deposited=False),
        line_flex.reasons_message(rv),
        line_flex.sources_message(rv),
        line_flex.visit_list_message(
            "今日參觀",
            [line_flex.VisitRow(receipt_id=RECEIPT, campus_name="義華校", when="11/20（四）10:00", parent_name="林小姐", status="confirmed")],
            empty_text="",
        ),
    ]
    for message in asks:
        posts = _postbacks(message)
        assert posts and all("displayText" not in p["action"] for p in posts)


def test_card_has_no_phone_email_or_child_data_and_alttext_has_no_parent_name():
    message = _card("visit_request_created", attend=True)
    dumped = json.dumps(message, ensure_ascii=False)
    for secret in ("0912345678", "parent@example.com", "小寶"):
        assert secret not in dumped
    assert "林小姐" not in message["altText"]
    assert "http" not in message["altText"]


def test_encode_decode_roundtrip_and_rejects_garbage():
    rid = str(uuid.uuid4())
    assert decode(f"ivy:att:{rid}") == ("att", [rid])
    assert decode(encode("rfs", rid, "2")) == ("rfs", [rid, "2"])
    assert decode("x") is None
    assert decode("ivy:") is None
    assert decode("") is None
    with pytest.raises(ValueError):
        encode("att", "x" * 300)
    assert line_group_actions.ATTEND_ASK == "att" and line_group_actions.RF_BUS == "rfb"


# ---- Meta 廣告名單卡片（2026-11-28）：和官網參觀通知分開的版型 ----


def _meta_card(url: str | None = "https://admin.example.com/admin/meta-leads?campus=yihua&openExternalBrowser=1") -> dict:
    return line_flex.meta_leads_card("義華校", 2, url)


def test_meta_leads_card_has_a_filled_header_unlike_site_cards():
    bubble = _meta_card()["contents"]
    fill = bubble["styles"]["header"]["backgroundColor"]
    assert fill == line_flex.META_BLUE
    # 官網卡片是白底、標題換色；Meta 卡片整條標題列鋪色、字是白的，顏色也不和任何一種官網卡片相同。
    assert "styles" not in _card("visit_request_created")["contents"]
    assert fill not in {color for pair in line_flex.KIND_STYLE.values() for color in pair} | {line_flex.BRAND}
    eyebrow, title = bubble["header"]["contents"]
    assert (eyebrow["text"], title["text"]) == ("Meta 廣告", "新的廣告名單")
    assert eyebrow["color"] == title["color"] == "#FFFFFF"
    assert 1.05 / (_luminance(fill) + 0.05) >= 4.5


def test_meta_leads_card_button_opens_the_inbox_and_alt_text_has_no_link():
    message = _meta_card()
    assert message["type"] == "flex"
    assert message["altText"] == "[Meta 廣告] 義華校有 2 筆新名單"
    rows = [[cell["text"] for cell in row["contents"]] for row in message["contents"]["body"]["contents"][:2]]
    assert rows == [["校區", "義華校"], ["新名單", "2 筆"]]
    (button,) = message["contents"]["footer"]["contents"]
    assert button["style"] == "primary" and button["color"] == line_flex.META_BLUE
    assert button["action"] == {
        "type": "uri", "label": "開啟廣告名單",
        "uri": "https://admin.example.com/admin/meta-leads?campus=yihua&openExternalBrowser=1",
    }
    # 沒設後台網址：沒有按鈕，卡片照送。
    assert "footer" not in _meta_card(None)["contents"]
