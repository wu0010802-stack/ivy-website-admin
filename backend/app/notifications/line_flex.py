"""LINE 卡片訊息（Flex Message）的版型（2026-11-16，docs/specs/2026-11-16-line-integrations-design.md §3、§5、§6）。

- 園方群組：標題、校區、參觀時段、家長稱呼，一顆「開啟案件」按鈕（取代原本純文字＋網址）。
- 家長一對一：預約成功、變更、取消、停課、參觀提醒，和 Email 同一份內容（parent_email.parent_notice）。
- 「我的預約」：家長在官方帳號輸入「我的預約」時回覆的清單。

altText 是聊天列表與手機通知看到的字：不放家長稱呼與網址（鎖定畫面看得到）。
顏色沿用官網 tokens.css 的品牌深綠（--green）與次要文字（--muted）換算成 hex；LINE 不吃 CSS 變數。"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.admissions import constants as admissions_constants
from app.notifications.line import flex_message, text_message
from app.notifications.line_group_actions import (
    ATTEND_ASK, ATTEND_OK, CANCEL, NOSHOW_ASK, NOSHOW_OK, RF_BUS, RF_DEPOSIT, RF_DEPOSIT_OK, RF_NODEP, RF_NODEP_ASK,
    RF_SOURCE, RF_SOURCE_ASK, encode,
)
from app.notifications.parent_email import ParentNotice

BRAND = "#244933"
MUTED = "#505F55"
# 園方群組卡片依種類換色：kind -> (標題字色, 按鈕色)。LINE 不吃 CSS 變數，這裡直接寫 hex；
# 標題字色對白底對比皆 >= 4.5（tests/test_line_group_cards.py 會算）。未知種類回退 BRAND。
KIND_STYLE: dict[str, tuple[str, str]] = {
    "visit_request_created": ("#244933", "#244933"),
    "visit_request_confirmed": ("#1F5FA8", "#1F5FA8"),
    "visit_request_rescheduled": ("#B35A14", "#B35A14"),
    "visit_request_cancelled": ("#B3261E", "#B3261E"),
}
CANCELLED_KIND = "visit_request_cancelled"
SITE_LABEL = "常春藤官網"
_URI_MAX = 1000


def _text(text: str, **style) -> dict:
    return {"type": "text", "text": text, "wrap": True, **style}


def _row(label: str, value: str) -> dict:
    return {
        "type": "box",
        "layout": "baseline",
        "spacing": "md",
        "contents": [
            _text(label, size="sm", color=MUTED, flex=2),
            _text(value, size="sm", flex=5),
        ],
    }


def _button(label: str, uri: str, *, primary: bool = True, color: str = BRAND) -> dict:
    button = {"type": "button", "height": "sm", "action": {"type": "uri", "label": label[:20], "uri": uri}}
    if primary:
        button.update(style="primary", color=color)
    else:
        button.update(style="link", color=color)
    return button


def _postback_button(label: str, data: str, *, color: str = BRAND, display_text: str | None = None) -> dict:
    """display_text：按了以後 LINE 以按的人的名義在聊天室送出的字（上限 300 字）；只有確認卡的「確認」用，
    固定字面、不放家長稱呼。沒給就不送出任何字。"""
    action = {"type": "postback", "label": label[:20], "data": data}
    if display_text:
        action["displayText"] = display_text[:300]
    return {"type": "button", "height": "sm", "style": "link", "color": color, "action": action}


def _usable_uri(uri: str | None) -> str | None:
    """按鈕只放 https 與 tel；太長或其他協定就不放按鈕（LINE 會整則拒收）。"""
    if not uri or len(uri) > _URI_MAX:
        return None
    return uri if uri.startswith(("https://", "tel:")) else None


def _bubble(eyebrow: str, title: str, body: list[dict], buttons: list[dict], *, title_color: str = BRAND) -> dict:
    bubble: dict = {
        "type": "bubble",
        "header": {
            "type": "box",
            "layout": "vertical",
            "spacing": "xs",
            "contents": [_text(eyebrow, size="xs", color=MUTED), _text(title, size="lg", weight="bold", color=title_color)],
        },
        "body": {"type": "box", "layout": "vertical", "spacing": "sm", "contents": body},
    }
    if buttons:
        bubble["footer"] = {"type": "box", "layout": "vertical", "spacing": "sm", "contents": buttons}
    return bubble


def staff_card(
    label: str,
    campus_name: str,
    *,
    when: str | None,
    parent_name: str | None,
    receipt_id: str | None,
    url: str | None,
    kind: str = "visit_request_created",
    attend_buttons: bool = False,
) -> dict:
    """園方群組推播。parent_name 已經過 service.line_parent_name 清理（拿掉網址、限 20 字）。
    沒有後台連結（沒設 admin_origin）時改放案件編號，讓群組裡的人還能自己找。"""
    rows = [_row("校區", campus_name)]
    if when:
        rows.append(_row("參觀時段", when))
    if parent_name:
        rows.append(_row("家長", parent_name))
    link = _usable_uri(url)
    if receipt_id and not link:
        rows.append(_row("案件編號", receipt_id))
    alt = f"[{SITE_LABEL}] {label}｜{campus_name}" + (f"｜{when}" if when else "")
    title_color, button_color = KIND_STYLE.get(kind, (BRAND, BRAND))
    buttons = [_button("開啟案件", link, color=button_color)] if link else []
    if attend_buttons and receipt_id and kind != CANCELLED_KIND:
        buttons.append(_postback_button("已到場", encode(ATTEND_ASK, receipt_id), color=button_color))
        buttons.append(_postback_button("未到場", encode(NOSHOW_ASK, receipt_id), color=button_color))
    return flex_message(alt, _bubble(SITE_LABEL, label, rows, buttons, title_color=title_color))


def parent_card(notice: ParentNotice) -> dict:
    """家長一對一通知。按鈕：notice 的連結（修改／改約／重新預約）＋撥打電話。"""
    body = [_text(notice.intro, size="sm")]
    body.append({"type": "separator", "margin": "md"})
    body.append({
        "type": "box", "layout": "vertical", "spacing": "sm", "margin": "md",
        "contents": [_row(label, value) for label, value in notice.details],
    })
    note = notice.note
    buttons: list[dict] = []
    link = _usable_uri(notice.url)
    if link and notice.button:
        # Email 版寫「請開啟這個連結：」接網址；卡片改指下面的按鈕。
        note = note.replace("請開啟這個連結", "請按下方按鈕").replace("使用這個連結", "按下方按鈕").rstrip("：:") + "。"
        if notice.inline_url:
            note = note.replace("請到。", "請按下方按鈕。")
        buttons.append(_button(notice.button, link))
    body.append(_text(note, size="sm", color=MUTED, margin="md"))
    # 只留半形數字與 +（全形數字、分機文字不放）；一個數字都沒有就不放按鈕，不送出空的 tel:（LINE 會整則拒收）。
    main_number = re.split(r"分機|轉|#|ext", notice.campus_phone or "", maxsplit=1, flags=re.IGNORECASE)[0]
    digits = "".join(ch for ch in main_number if ch in "0123456789+")
    if len(digits.lstrip("+")) >= 6:
        buttons.append(_button("撥打電話", f"tel:{digits}", primary=not buttons))
    return flex_message(notice.subject, _bubble("常春藤幼兒園", notice.title, body, buttons))


def my_visits_carousel(items: list[dict]) -> dict:
    """「我的預約」：每筆一張卡（最多 10 張，LINE 輪播上限 12）。item：campus_name、when、manage_url（可為 None）、note。"""
    bubbles = []
    for item in items[:10]:
        body = [_row("校區", item["campus_name"]), _row("日期與場次", item["when"])]
        if item.get("note"):
            body.append(_text(item["note"], size="xs", color=MUTED, margin="md"))
        link = _usable_uri(item.get("manage_url"))
        bubbles.append(_bubble("常春藤幼兒園", "參觀預約", body, [_button("查看或修改", link)] if link else []))
    alt = f"您有 {len(items)} 筆參觀預約"
    contents = bubbles[0] if len(bubbles) == 1 else {"type": "carousel", "contents": bubbles}
    return flex_message(alt, contents)


# ---- 群組互動（2026-11-17，docs/specs/2026-11-17-line-group-interactions-design.md §4.1、§4.2、§4.7、§5、§5.1）----
# 全是純函式：不查資料庫、不送出。按鈕的 postback data 只放動作代碼、id、索引，不放中文字面。

CAROUSEL_MAX = 12
GROUP_LIST_EYEBROW = "常春藤官網｜參觀"


@dataclass(frozen=True)
class VisitRow:
    """名單／摘要的一筆。when 已格式化；parent_name 已經過 service.line_parent_name 清理。"""

    receipt_id: str
    campus_name: str
    when: str
    parent_name: str | None
    status: str


def _hbox(contents: list[dict]) -> dict:
    return {"type": "box", "layout": "horizontal", "spacing": "sm", "contents": contents}


def visit_list_message(title: str, rows: list[VisitRow], *, empty_text: str) -> dict:
    """第一張總覽（標題、各校筆數），之後每筆一張（confirmed 才有已到場／未到場）。
    LINE carousel 上限 12 張：超過 11 筆時第 12 張寫「另有 N 筆」。altText 只放標題與筆數。"""
    if not rows:
        return text_message(empty_text)
    counts: dict[str, int] = {}
    for row in rows:
        counts[row.campus_name] = counts.get(row.campus_name, 0) + 1
    summary = _bubble(
        GROUP_LIST_EYEBROW, title,
        [_row("合計", f"{len(rows)} 筆")] + [_row(name, f"{n} 筆") for name, n in counts.items()],
        [],
    )
    # 總覽 1 張＋最多 11 筆。超過 11 筆時，第 11 筆（第 12 張）不放按鈕、改附「另有 N 筆，請開後台」。
    overflow = len(rows) > CAROUSEL_MAX - 1
    shown = rows[: CAROUSEL_MAX - 1]
    bubbles = [summary]
    for i, row in enumerate(shown):
        body = [_row("校區", row.campus_name), _row("參觀時段", row.when)]
        if row.parent_name:
            body.append(_row("家長", row.parent_name))
        last = overflow and i == len(shown) - 1
        buttons = []
        if row.status == "confirmed" and not last:
            buttons = [
                _postback_button("已到場", encode(ATTEND_ASK, row.receipt_id)),
                _postback_button("未到場", encode(NOSHOW_ASK, row.receipt_id)),
            ]
        if last:
            body.append(_text(f"另有 {len(rows) - len(shown)} 筆，請開後台", size="sm", color=MUTED, margin="md"))
        bubbles.append(_bubble(GROUP_LIST_EYEBROW, "參觀預約", body, buttons))
    return flex_message(f"{title}（共 {len(rows)} 筆）", {"type": "carousel", "contents": bubbles})


_MENU_COMMANDS = ("今天參觀", "明天參觀", "本週參觀")


def menu_message() -> dict:
    buttons = [
        {"type": "button", "height": "sm", "style": "primary", "color": BRAND,
         "action": {"type": "message", "label": text, "text": text}}
        for text in _MENU_COMMANDS
    ]
    return flex_message("參觀名單選單", _bubble(SITE_LABEL, "要查哪一段時間的參觀？", [_text("想查看哪一段時間的參觀預約？", size="sm", color=MUTED)], buttons))


def help_message() -> dict:
    return text_message(
        "歡迎使用常春藤官網通知。在這個群組輸入下列文字，可以查詢參觀預約：\n"
        "・今天參觀\n・明天參觀\n・本週參觀\n"
        "也可以 @官方帳號 叫出選單。"
    )


# 詢問動作 → (確認動作, 標題用字, altText, 「確認」的 displayText)。altText 不放家長稱呼（鎖定畫面看得到）；
# displayText 會以按的人的名義留在群組（看得出誰確認的，設計 §5 第 2 點），同樣不放稱呼與時段。
# 這幾句不能是群組指令（line_group_commands 只認「今天參觀」等整句，tests 會檢查）。
_CONFIRM_KINDS: dict[str, tuple[str, str, str, str]] = {
    ATTEND_ASK: (ATTEND_OK, "已到場", "請確認參觀已到場", "確認已到場"),
    NOSHOW_ASK: (NOSHOW_OK, "未到場", "請確認參觀未到場", "確認未到場"),
    RF_DEPOSIT: (RF_DEPOSIT_OK, "已預繳", "請確認已預繳", "確認已預繳"),
}
CONFIRM_DISPLAY_TEXTS = tuple(kind[3] for kind in _CONFIRM_KINDS.values())


def confirm_message(action: str, target_id: str, who: str, when: str, token: str) -> dict:
    """二次確認卡。action 是 ATTEND_ASK、NOSHOW_ASK（target_id＝案件 id）或 RF_DEPOSIT（target_id＝招生訪視 id，
    when 傳空字串）；「確認」帶無狀態 token（HMAC，含到期）與 displayText，「取消」不帶。"""
    ok, word, alt, shown = _CONFIRM_KINDS[action]
    title = f"確認{who}{when}{word}？"
    buttons = [
        _postback_button("確認", encode(ok, target_id, token), display_text=shown),
        _postback_button("取消", encode(CANCEL), color=MUTED),
    ]
    return flex_message(alt, _bubble(SITE_LABEL, title, [_text("按下確認才會寫入，誤按請按取消。", size="sm", color=MUTED)], buttons))


def attended_result_message(
    who: str,
    *,
    recruitment_visit_id: str | None,
    receipt_id: str,
    admin_url: str | None,
    already_deposited: bool,
) -> dict:
    """到場結果卡。有招生訪視才放結果欄位按鈕（預繳、來源分類、交通車）；後台連結 admin_url 非空才放。
    receipt_id 只用於呼叫端對照，卡片上不顯示。"""
    title = f"已標記{who}已到場"
    body: list[dict] = [_text(title, size="sm")]
    buttons: list[dict] = []
    if recruitment_visit_id:
        rv = recruitment_visit_id
        body.append(_text("可順手記錄結果：", size="sm", color=MUTED))
        if already_deposited:
            body.append(_text("已預繳", size="sm"))
        else:
            buttons.append(_hbox([
                _postback_button("已預繳", encode(RF_DEPOSIT, rv)),
                _postback_button("未預繳", encode(RF_NODEP_ASK, rv)),
            ]))
        buttons.append(_postback_button("來源分類", encode(RF_SOURCE_ASK, rv)))
        buttons.append(_hbox([
            _postback_button("搭交通車", encode(RF_BUS, rv, "1")),
            _postback_button("不搭", encode(RF_BUS, rv, "0")),
        ]))
    link = _usable_uri(admin_url)
    if link:
        buttons.append(_button("到後台填完整資料", link, primary=False))
    return flex_message("已標記到場", _bubble(SITE_LABEL, title, body, buttons))


NO_SHOW_RESULT_ALT = "已標記未到場"


def no_show_result_message(who: str) -> dict:
    """未到場結果卡：家長稱呼只放在卡片內文；altText（鎖定畫面、聊天列表看得到）不放。
    純文字訊息沒有 altText，通知預覽會直接顯示整句，所以帶稱呼的結果一律用卡片。"""
    return flex_message(
        NO_SHOW_RESULT_ALT,
        _bubble(SITE_LABEL, NO_SHOW_RESULT_ALT, [_text(f"已標記{who}未到場", size="sm")], []),
    )


def _choice_card(title: str, hint: str, action: str, recruitment_visit_id: str, labels: list[str]) -> dict:
    buttons = [_postback_button(label, encode(action, recruitment_visit_id, str(i))) for i, label in enumerate(labels)]
    return flex_message(title, _bubble(SITE_LABEL, title, [_text(hint, size="sm", color=MUTED)], buttons))


def reasons_message(recruitment_visit_id: str) -> dict:
    """未預繳原因選擇卡；順序與字面照 constants.NO_DEPOSIT_REASONS，data 帶索引。"""
    return _choice_card("請選未預繳原因", "請選擇未預繳原因", RF_NODEP, recruitment_visit_id, list(admissions_constants.NO_DEPOSIT_REASONS))


def sources_message(recruitment_visit_id: str) -> dict:
    """來源分類選擇卡：同後台表單只列六項短標籤（constants.LINE_SOURCE_CHOICES，2026-10-06 裁定），data 帶其索引。"""
    return _choice_card(
        "請選來源分類", "請選擇來源分類", RF_SOURCE, recruitment_visit_id,
        [label for _code, label in admissions_constants.LINE_SOURCE_CHOICES],
    )


def mention_all_message() -> dict:
    """當天異動時跟在卡片後面的 @所有人（LINE textV2 的 mention all）。"""
    return {
        "type": "textV2",
        "text": "{everyone} 今天有臨時變動，請看上方卡片",
        "substitution": {"everyone": {"type": "mention", "mentionee": {"type": "all"}}},
    }
