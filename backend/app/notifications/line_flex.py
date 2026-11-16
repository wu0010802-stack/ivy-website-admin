"""LINE 卡片訊息（Flex Message）的版型（2026-11-16，docs/specs/2026-11-16-line-integrations-design.md §3、§5、§6）。

- 園方群組：標題、校區、參觀時段、家長稱呼，一顆「開啟案件」按鈕（取代原本純文字＋網址）。
- 家長一對一：預約成功、變更、取消、停課、參觀提醒，和 Email 同一份內容（parent_email.parent_notice）。
- 「我的預約」：家長在官方帳號輸入「我的預約」時回覆的清單。

altText 是聊天列表與手機通知看到的字：不放家長稱呼與網址（鎖定畫面看得到）。
顏色沿用官網 tokens.css 的品牌深綠（--green）與次要文字（--muted）換算成 hex；LINE 不吃 CSS 變數。"""

from __future__ import annotations

import re

from app.notifications.line import flex_message
from app.notifications.parent_email import ParentNotice

BRAND = "#244933"
MUTED = "#505F55"
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


def _button(label: str, uri: str, *, primary: bool = True) -> dict:
    button = {"type": "button", "height": "sm", "action": {"type": "uri", "label": label[:20], "uri": uri}}
    if primary:
        button.update(style="primary", color=BRAND)
    else:
        button.update(style="link", color=BRAND)
    return button


def _usable_uri(uri: str | None) -> str | None:
    """按鈕只放 https 與 tel；太長或其他協定就不放按鈕（LINE 會整則拒收）。"""
    if not uri or len(uri) > _URI_MAX:
        return None
    return uri if uri.startswith(("https://", "tel:")) else None


def _bubble(eyebrow: str, title: str, body: list[dict], buttons: list[dict]) -> dict:
    bubble: dict = {
        "type": "bubble",
        "header": {
            "type": "box",
            "layout": "vertical",
            "spacing": "xs",
            "contents": [_text(eyebrow, size="xs", color=MUTED), _text(title, size="lg", weight="bold", color=BRAND)],
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
    buttons = [_button("開啟案件", link)] if link else []
    return flex_message(alt, _bubble(SITE_LABEL, label, rows, buttons))


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
