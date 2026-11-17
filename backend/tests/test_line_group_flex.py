"""群組名單、摘要、選單、確認、結果、選擇卡版型（純函式，不碰資料庫）。"""

import json
import uuid

from app.admissions import constants
from app.notifications import line_flex as lf
from app.notifications.line_group_actions import (
    ATTEND_OK, CANCEL, NOSHOW_OK, RF_BUS, RF_DEPOSIT, RF_DEPOSIT_OK, RF_NODEP, RF_NODEP_ASK, RF_SOURCE, RF_SOURCE_ASK,
    decode,
)


def _walk(node):
    if isinstance(node, dict):
        yield node
        for v in node.values():
            yield from _walk(v)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v)


def _buttons(node):
    return [n for n in _walk(node) if n.get("type") == "button"]


def _postbacks(node):
    return [b for b in _buttons(node) if b["action"]["type"] == "postback"]


def _row(i, status="confirmed", campus="義華"):
    return lf.VisitRow(receipt_id=str(uuid.uuid4()), campus_name=campus, when=f"11/18 10:{i:02d}", parent_name=f"家長{i}", status=status)


def test_visit_list_rows_become_carousel_with_summary_first():
    msg = lf.visit_list_message("今天參觀", [_row(1), _row(2), _row(3)], empty_text="沒有")
    assert msg["type"] == "flex"
    bubbles = msg["contents"]["contents"]
    assert len(bubbles) == 4
    assert "義華" in json.dumps(bubbles[0], ensure_ascii=False)
    for b in bubbles[1:]:
        assert len(_postbacks(b)) == 2
    assert "家長" not in msg["altText"]


def test_visit_list_non_confirmed_has_no_buttons():
    msg = lf.visit_list_message("今天參觀", [_row(1, status="cancelled")], empty_text="沒有")
    assert _postbacks(msg["contents"]["contents"][1]) == []


def test_visit_list_caps_at_12_bubbles_with_overflow_note():
    msg = lf.visit_list_message("本週參觀", [_row(i) for i in range(15)], empty_text="沒有")
    bubbles = msg["contents"]["contents"]
    assert len(bubbles) == 12
    last = json.dumps(bubbles[-1], ensure_ascii=False)
    assert "另有 4 筆" in last
    assert _buttons(bubbles[-1]) == []


def test_visit_list_empty_returns_text():
    assert lf.visit_list_message("今天參觀", [], empty_text="這段時間沒有參觀預約") == {
        "type": "text", "text": "這段時間沒有參觀預約"}


def test_menu_buttons_are_message_actions_with_exact_text():
    msg = lf.menu_message()
    actions = [b["action"] for b in _buttons(msg["contents"])]
    assert [(a["type"], a["text"]) for a in actions] == [("message", "今天參觀"), ("message", "明天參觀"), ("message", "本週參觀")]


def test_help_message_lists_commands():
    msg = lf.help_message()
    assert msg["type"] == "text"
    for s in ("今天參觀", "明天參觀", "本週參觀", "@官方帳號"):
        assert s in msg["text"]


def test_confirm_message_buttons_carry_token_and_stay_under_300_chars():
    rid, token = str(uuid.uuid4()), "x" * 120
    for action, ok in (("att", ATTEND_OK), ("nos", NOSHOW_OK)):
        msg = lf.confirm_message(action, rid, "王家", "11/18 10:00", token)
        pbs = _postbacks(msg["contents"])
        assert len(pbs) == 2
        assert all(len(b["action"]["data"]) < 300 for b in pbs)
        assert decode(pbs[0]["action"]["data"]) == (ok, [rid, token])
        assert decode(pbs[1]["action"]["data"])[0] == CANCEL
    assert "已到場" in json.dumps(lf.confirm_message("att", rid, "王家", "t", token), ensure_ascii=False)
    assert "未到場" in json.dumps(lf.confirm_message("nos", rid, "王家", "t", token), ensure_ascii=False)


def test_deposit_confirm_card_carries_token_and_hides_parent_name_in_alt():
    """「已預繳」也二次確認（會排廣告轉換回傳）：同一個確認卡版型，確認帶 rfdok＋招生訪視 id＋token。"""
    rv, token, who = str(uuid.uuid4()), "1763340000." + "a" * 16, "王小明媽媽"
    msg = lf.confirm_message(RF_DEPOSIT, rv, who, "", token)
    pbs = _postbacks(msg["contents"])
    assert [b["action"]["label"] for b in pbs] == ["確認", "取消"]
    assert decode(pbs[0]["action"]["data"]) == (RF_DEPOSIT_OK, [rv, token])
    assert decode(pbs[1]["action"]["data"]) == (CANCEL, [])
    assert all(len(b["action"]["data"]) < 300 for b in pbs)
    assert msg["altText"] == "請確認已預繳" and who not in msg["altText"]
    assert f"確認{who}已預繳？" in json.dumps(msg["contents"], ensure_ascii=False)


def test_result_message_without_recruitment_visit_has_only_admin_link():
    msg = lf.attended_result_message("王家", recruitment_visit_id=None, receipt_id="r1",
                                     admin_url="https://x.example/a", already_deposited=False)
    bs = _buttons(msg["contents"])
    assert len(bs) == 1 and bs[0]["action"]["type"] == "uri"


def test_result_message_with_recruitment_visit_has_all_field_buttons():
    rv = str(uuid.uuid4())
    msg = lf.attended_result_message("王家", recruitment_visit_id=rv, receipt_id="r1",
                                     admin_url="https://x.example/a", already_deposited=False)
    pbs = _postbacks(msg["contents"])
    assert [decode(b["action"]["data"])[0] for b in pbs] == [RF_DEPOSIT, RF_NODEP_ASK, RF_SOURCE_ASK, RF_BUS, RF_BUS]
    assert [decode(b["action"]["data"])[1] for b in pbs][3:] == [[rv, "1"], [rv, "0"]]
    assert len([b for b in _buttons(msg["contents"]) if b["action"]["type"] == "uri"]) == 1


def test_result_message_already_deposited_omits_deposit_buttons():
    rv = str(uuid.uuid4())
    msg = lf.attended_result_message("王家", recruitment_visit_id=rv, receipt_id="r1",
                                     admin_url=None, already_deposited=True)
    acts = [decode(b["action"]["data"])[0] for b in _postbacks(msg["contents"])]
    assert RF_DEPOSIT not in acts and RF_NODEP_ASK not in acts
    assert "已預繳" in json.dumps(msg, ensure_ascii=False)
    assert not [b for b in _buttons(msg["contents"]) if b["action"]["type"] == "uri"]


def test_reasons_and_sources_cards_cover_every_constant_in_order():
    rv = str(uuid.uuid4())
    # 來源分類同後台表單只列六項短標籤（2026-10-06 裁定），不是九類全列。
    six = ["在校生弟妹", "畢業生弟妹", "家長介紹／社區招生", "自報生（廣告、鄰居、網路、活動）", "邀約來園", "舊生復學"]
    assert [label for _code, label in constants.LINE_SOURCE_CHOICES] == six
    assert all(code in constants.SOURCE_CATEGORIES for code, _label in constants.LINE_SOURCE_CHOICES)
    for msg, action, labels in (
        (lf.reasons_message(rv), RF_NODEP, list(constants.NO_DEPOSIT_REASONS)),
        (lf.sources_message(rv), RF_SOURCE, six),
    ):
        pbs = _postbacks(msg["contents"])
        assert [b["action"]["label"] for b in pbs] == labels
        assert all(len(b["action"]["label"]) <= 20 and b["action"]["label"] for b in pbs)
        assert [decode(b["action"]["data"]) for b in pbs] == [(action, [rv, str(i)]) for i in range(len(labels))]


def _empty_boxes(node):
    return [n for n in _walk(node) if n.get("type") == "box" and not n.get("contents")]


def test_alt_text_never_contains_parent_name():
    who = "王小明媽媽"
    rid, rv = str(uuid.uuid4()), str(uuid.uuid4())
    msgs = [lf.confirm_message("att", rid, who, "10:00", "t"), lf.confirm_message("nos", rid, who, "10:00", "t"),
            lf.confirm_message(RF_DEPOSIT, rv, who, "", "t"),
            lf.attended_result_message(who, recruitment_visit_id=rv, receipt_id=rid, admin_url=None, already_deposited=False),
            lf.attended_result_message(who, recruitment_visit_id=None, receipt_id=rid, admin_url=None, already_deposited=False),
            lf.no_show_result_message(who)]
    assert all(who not in m["altText"] for m in msgs)


def test_no_show_result_is_a_card_with_name_only_in_body():
    msg = lf.no_show_result_message("王小明媽媽")
    assert msg["type"] == "flex" and msg["altText"] == "已標記未到場"
    assert "已標記王小明媽媽未到場" in json.dumps(msg["contents"]["body"], ensure_ascii=False)
    assert "王小明媽媽" not in json.dumps(msg["contents"]["header"], ensure_ascii=False)
    assert _buttons(msg["contents"]) == []


def test_no_builder_emits_empty_box():
    rv, rid = str(uuid.uuid4()), str(uuid.uuid4())
    msgs = [lf.menu_message(), lf.reasons_message(rv), lf.sources_message(rv),
            lf.confirm_message("att", rid, "王", "t", "k"), lf.confirm_message(RF_DEPOSIT, rv, "王", "", "k"),
            lf.attended_result_message("王", recruitment_visit_id=None, receipt_id=rid, admin_url=None, already_deposited=False),
            lf.attended_result_message("王", recruitment_visit_id=rv, receipt_id=rid, admin_url=None, already_deposited=True),
            lf.visit_list_message("今天參觀", [_row(1)], empty_text="x"), lf.no_show_result_message("王")]
    for m in msgs:
        assert _empty_boxes(m["contents"]) == []
