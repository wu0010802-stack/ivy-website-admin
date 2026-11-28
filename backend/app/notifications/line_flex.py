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
    ATTEND_ASK, ATTEND_OK, CANCEL, NOSHOW_ASK, NOSHOW_OK, REPORT_DETAIL, RF_BUS, RF_DEPOSIT, RF_DEPOSIT_OK, RF_FOLLOW,
    RF_NODEP, RF_NODEP_ASK, RF_SOURCE, RF_SOURCE_ASK, encode,
)
from app.notifications.parent_email import ParentNotice

BRAND = "#244933"
MUTED = "#505F55"
# 鋪色標題列上的字（_bubble 的 header_fill）。
ON_FILL = "#FFFFFF"
# 園方群組卡片依種類換色：kind -> (標題字色, 按鈕色)。LINE 不吃 CSS 變數，這裡直接寫 hex；
# 標題字色對白底對比皆 >= 4.5（tests/test_line_group_cards.py 會算）。未知種類回退 BRAND。
KIND_STYLE: dict[str, tuple[str, str]] = {
    "visit_request_created": ("#244933", "#244933"),
    "visit_request_confirmed": ("#1F5FA8", "#1F5FA8"),
    "visit_request_rescheduled": ("#B35A14", "#B35A14"),
    "visit_request_cancelled": ("#B3261E", "#B3261E"),
}
CANCELLED_KIND = "visit_request_cancelled"
# 取消卡片的「取消方」（visit_requests.cancel_reason；值同 operations.models.CANCEL_REASONS）。
CANCEL_SIDE_LABELS = {"parent": "家長取消", "staff": "園方取消", "hold_expired": "占位逾期"}
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


def _postback_button(
    label: str, data: str, *, color: str = BRAND, display_text: str | None = None, primary: bool = False
) -> dict:
    """display_text：按了以後 LINE 以按的人的名義在聊天室送出的字（上限 300 字）；確認卡的「確認」與家長的
    「會準時到」用，固定字面、不放家長稱呼。沒給就不送出任何字。"""
    action = {"type": "postback", "label": label[:20], "data": data}
    if display_text:
        action["displayText"] = display_text[:300]
    return {"type": "button", "height": "sm", "style": "primary" if primary else "link", "color": color, "action": action}


def _usable_uri(uri: str | None) -> str | None:
    """按鈕只放 https 與 tel；太長或其他協定就不放按鈕（LINE 會整則拒收）。"""
    if not uri or len(uri) > _URI_MAX:
        return None
    return uri if uri.startswith(("https://", "tel:")) else None


def _bubble(
    eyebrow: str, title: str, body: list[dict], buttons: list[dict], *, title_color: str = BRAND,
    header_fill: str | None = None,
) -> dict:
    """header_fill：整條標題列鋪這個底色、字改白（Meta 廣告名單用，和白底的官網卡片分開）。"""
    eyebrow_color, title_color = (ON_FILL, ON_FILL) if header_fill else (MUTED, title_color)
    bubble: dict = {
        "type": "bubble",
        "header": {
            "type": "box",
            "layout": "vertical",
            "spacing": "xs",
            "contents": [
                _text(eyebrow, size="xs", color=eyebrow_color),
                _text(title, size="lg", weight="bold", color=title_color),
            ],
        },
        "body": {"type": "box", "layout": "vertical", "spacing": "sm", "contents": body},
    }
    if header_fill:
        bubble["styles"] = {"header": {"backgroundColor": header_fill}}
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
    party_size: int | None = None,
    cancel_reason: str | None = None,
) -> dict:
    """園方群組推播。parent_name 已經過 service.line_parent_name 清理（拿掉網址、限 20 字）。
    沒有後台連結（沒設 admin_origin）時改放案件編號，讓群組裡的人還能自己找。
    2026-11-25 起多帶參觀人數與取消卡片的「取消方」（都不是個資；altText 不變）。"""
    rows = [_row("校區", campus_name)]
    if when:
        rows.append(_row("參觀時段", when))
    if parent_name:
        rows.append(_row("家長", parent_name))
    if party_size:
        rows.append(_row("參觀人數", f"{party_size} 位"))
    if kind == CANCELLED_KIND and cancel_reason in CANCEL_SIDE_LABELS:
        rows.append(_row("取消方", CANCEL_SIDE_LABELS[cancel_reason]))
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


# ---- Meta 廣告名單（2026-11-28）----
# 和官網參觀通知分開的版型：官網卡片是白底、標題換色；這張整條標題列鋪 Meta 的品牌藍、字是白的
# （白字對比 4.8，tests/test_line_group_cards.py 會算）。
META_BLUE = "#0866FF"
META_LABEL = "Meta 廣告"
META_LEADS_TITLE = "新的廣告名單"
META_LEADS_BUTTON = "開啟廣告名單"


def meta_leads_card(campus_name: str, count: int, url: str | None) -> dict:
    """新的 Meta 廣告名單（app/meta_leads/sync.py 每校一則）。只有校名與筆數，不放家長姓名與電話
    （群組成員不一定都該看到個資）。沒有後台連結（沒設 admin_origin）時不放按鈕。"""
    body = [
        _row("校區", campus_name),
        _row("新名單", f"{count} 筆"),
        _text("請到後台「廣告名單」聯絡家長。", size="sm", color=MUTED, margin="md"),
    ]
    link = _usable_uri(url)
    buttons = [_button(META_LEADS_BUTTON, link, color=META_BLUE)] if link else []
    alt = f"[{META_LABEL}] {campus_name}有 {count} 筆新名單"
    return flex_message(alt, _bubble(META_LABEL, META_LEADS_TITLE, body, buttons, header_fill=META_BLUE))


ATTENDANCE_BUTTON = "會準時到"
MAP_BUTTON = "導航到園所"


def parent_card(notice: ParentNotice, *, attendance_data: str | None = None) -> dict:
    """家長一對一通知。按鈕：會準時到（參觀提醒才有，attendance_data 是 postback data，2026-11-25）、
    notice 的連結（修改／改約／重新預約）、導航到園所（notice.map_url，2026-11-25）、撥打電話。
    第一顆是實心按鈕，其餘是文字連結樣式。"""
    body = [_text(notice.intro, size="sm")]
    body.append({"type": "separator", "margin": "md"})
    body.append({
        "type": "box", "layout": "vertical", "spacing": "sm", "margin": "md",
        "contents": [_row(label, value) for label, value in notice.details],
    })
    note = notice.note
    buttons: list[dict] = []
    if attendance_data:
        buttons.append(_postback_button(ATTENDANCE_BUTTON, attendance_data, display_text=ATTENDANCE_BUTTON, primary=True))
    link = _usable_uri(notice.url)
    if link and notice.button:
        # Email 版寫「請開啟這個連結：」接網址；卡片改指下面的按鈕。
        note = note.replace("請開啟這個連結", "請按下方按鈕").replace("使用這個連結", "按下方按鈕").rstrip("：:") + "。"
        if notice.inline_url:
            note = note.replace("請到。", "請按下方按鈕。")
        buttons.append(_button(notice.button, link, primary=not buttons))
    map_link = _usable_uri(notice.map_url)
    if map_link and map_link.startswith("https://"):
        buttons.append(_button(MAP_BUTTON, map_link, primary=False))
    body.append(_text(note, size="sm", color=MUTED, margin="md"))
    # 只留半形數字與 +（全形數字、分機文字不放）；一個數字都沒有就不放按鈕，不送出空的 tel:（LINE 會整則拒收）。
    main_number = re.split(r"分機|轉|#|ext", notice.campus_phone or "", maxsplit=1, flags=re.IGNORECASE)[0]
    digits = "".join(ch for ch in main_number if ch in "0123456789+")
    if len(digits.lstrip("+")) >= 6:
        buttons.append(_button("撥打電話", f"tel:{digits}", primary=not buttons))
    return flex_message(notice.subject, _bubble("常春藤幼兒園", notice.title, body, buttons))


def my_visits_carousel(items: list[dict]) -> dict:
    """「我的預約」：每筆一張卡（最多 10 張，LINE 輪播上限 12）。item：campus_name、when、manage_url（可為 None）、note、
    cancel_data（「取消預約」的 postback data；線上異動期限過了是 None，2026-11-25）、deadline_note（期限過了的說明）。"""
    bubbles = []
    for item in items[:10]:
        body = [_row("校區", item["campus_name"]), _row("日期與場次", item["when"])]
        if item.get("deadline_note"):
            body.append(_text(item["deadline_note"], size="sm", margin="md"))
        if item.get("note"):
            body.append(_text(item["note"], size="xs", color=MUTED, margin="md"))
        link = _usable_uri(item.get("manage_url"))
        buttons = [_button("查看或修改", link)] if link else []
        if item.get("cancel_data"):
            buttons.append(_postback_button("取消預約", item["cancel_data"], color=MUTED))
        bubbles.append(_bubble("常春藤幼兒園", "參觀預約", body, buttons))
    alt = f"您有 {len(items)} 筆參觀預約"
    contents = bubbles[0] if len(bubbles) == 1 else {"type": "carousel", "contents": bubbles}
    return flex_message(alt, contents)


PARENT_CANCEL_CONFIRM_TEXT = "確定取消"


def parent_cancel_confirm(campus_name: str, when: str, *, ok_data: str, keep_data: str) -> dict:
    """家長在「我的預約」按「取消預約」後的確認卡（2026-11-25）。「確定取消」帶 token 與 displayText。"""
    body = [
        _row("校區", campus_name),
        _row("日期與場次", when),
        _text("取消後這個時段會開放給其他家長；要再參觀請重新預約。", size="sm", color=MUTED, margin="md"),
    ]
    buttons = [
        _postback_button(PARENT_CANCEL_CONFIRM_TEXT, ok_data, display_text=PARENT_CANCEL_CONFIRM_TEXT, primary=True),
        _postback_button("不取消", keep_data, color=MUTED),
    ]
    return flex_message("確定取消這次參觀？", _bubble("常春藤幼兒園", "確定取消這次參觀？", body, buttons))


# ---- 群組互動（2026-11-17，docs/specs/2026-11-17-line-group-interactions-design.md §4.1、§4.2、§4.7、§5、§5.1）----
# 全是純函式：不查資料庫、不送出。按鈕的 postback data 只放動作代碼、id、索引，不放中文字面。

CAROUSEL_MAX = 12
# 下次聯絡的按鈕（到場結果卡與待追蹤名單共用）：文字、天數；時間是台北 10:00（line_group_actions.follow_up_time）。
FOLLOW_UP_BUTTONS = (("明天聯絡", "1"), ("3天後聯絡", "3"), ("1週後聯絡", "7"))
GROUP_LIST_EYEBROW = "常春藤官網｜參觀"


@dataclass(frozen=True)
class VisitRow:
    """名單／摘要的一筆。when 已格式化；parent_name 已經過 service.line_parent_name 清理。"""

    receipt_id: str
    campus_name: str
    when: str
    parent_name: str | None
    status: str
    # 2026-11-25：參觀人數、家長在 LINE 參觀提醒按了「會準時到」（場次對得上才算）。
    party_size: int | None = None
    attendance_confirmed: bool = False


def _hbox(contents: list[dict]) -> dict:
    return {"type": "box", "layout": "horizontal", "spacing": "sm", "contents": contents}


CONTACT_ROW_LABEL = "昨天官網"


def visit_list_message(title: str, rows: list[VisitRow], *, empty_text: str, contact: str | None = None) -> dict:
    """第一張總覽（標題、各校筆數），之後每筆一張（confirmed 才有已到場／未到場）。
    LINE carousel 上限 12 張：超過 11 筆時第 12 張寫「另有 N 筆」。altText 只放標題與筆數。"""
    if not rows:
        return text_message(empty_text)
    counts: dict[str, int] = {}
    for row in rows:
        counts[row.campus_name] = counts.get(row.campus_name, 0) + 1
    summary = _bubble(
        GROUP_LIST_EYEBROW, title,
        [_row("合計", f"{len(rows)} 筆")] + [_row(name, f"{n} 筆") for name, n in counts.items()]
        # 每日摘要才帶（2026-11-26）：昨天官網上按電話、LINE 鈕的次數。
        + ([{"type": "separator", "margin": "md"}, _row(CONTACT_ROW_LABEL, contact)] if contact else []),
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
        if row.party_size:
            body.append(_row("參觀人數", f"{row.party_size} 位"))
        if row.attendance_confirmed:
            body.append(_row("家長回覆", ATTENDANCE_CONFIRMED_TEXT))
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


ATTENDANCE_CONFIRMED_TEXT = "會準時到"
# @官方帳號 的選單（2026-11-25 擴充，docs/specs/2026-11-25-line-group-commands-design.md §8）：兩顆一列；
# 按了以按的人的名義送出那句指令，再由 line_group_commands 處理。總部群組多統計與額度。
_MENU_ROWS = (
    ("今天參觀", "明天參觀"),
    ("本週參觀", "下週參觀"),
    ("待標記", "待追蹤"),
    ("今天名額", "休假日"),
    ("待辦", "指令"),
)
_MENU_HQ_ROWS = (("本週統計", "額度"), ("週報", "月報"))
MENU_ALT = "參觀名單選單"


def menu_commands(*, is_hq: bool = False) -> tuple[str, ...]:
    rows = (*_MENU_ROWS, *_MENU_HQ_ROWS) if is_hq else _MENU_ROWS
    return tuple(text for row in rows for text in row)


def _message_button(text: str) -> dict:
    return {"type": "button", "height": "sm", "style": "primary", "color": BRAND, "flex": 1,
            "action": {"type": "message", "label": text, "text": text}}


def menu_message(*, is_hq: bool = False) -> dict:
    rows = (*_MENU_ROWS, *_MENU_HQ_ROWS) if is_hq else _MENU_ROWS
    buttons = [_hbox([_message_button(text) for text in row]) for row in rows]
    return flex_message(MENU_ALT, _bubble(SITE_LABEL, "要查什麼？", [_text("按一下就會查；也可以直接輸入指令。", size="sm", color=MUTED)], buttons))


def help_message(*, is_hq: bool = False) -> dict:
    lines = [
        "常春藤官網通知：在這個群組輸入下面的文字就能查詢（整則訊息只打指令）。",
        "【參觀名單】今天參觀、明天參觀、本週參觀、下週參觀、11/28 參觀",
        "【要處理的】待標記（時間過了還沒標到場）、待追蹤（招生聯絡到期）、待辦（各校現在的數字）",
        "【名額】今天名額、明天名額、本週名額、下週名額、11/28 名額",
        "【休假】休假日（近 14 天的休假與停課）",
        "【官網按鈕】今天聯絡（今天與昨天有多少人按了電話、LINE）",
    ]
    if is_hq:
        lines.append("【總部專用】本週統計、上週統計、本月統計、上月統計、週報、月報、額度")
    lines += [
        "指令前面可以加校名只看一校，例如「義華 今天參觀」。",
        "用手機查詢時，結果下方會出現切換鈕（例如看完今天參觀，直接按「明天參觀」）。",
        "標記官方帳號（@）會跳出選單；輸入「指令」可以再看一次這份說明。",
    ]
    return text_message("\n".join(lines))


@dataclass(frozen=True)
class FollowUpRow:
    """待追蹤名單的一筆（招生訪視）。contact 已清理（拿掉網址、限 20 字）；不放孩子姓名與電話。"""

    visit_id: str
    campus_name: str
    contact: str | None
    visited: str
    due: str
    # 對應的預約（有才放「開啟案件」）。
    receipt_id: str | None = None


FOLLOW_UP_TITLE = "待追蹤"
FOLLOW_UP_EYEBROW = "常春藤官網｜招生追蹤"


def follow_up_list_message(rows: list[FollowUpRow], *, admin_urls: dict[str, str] | None = None) -> dict:
    """待追蹤名單（2026-11-25）：第一張總覽（各校筆數），之後每筆一張，按鈕是延後下次聯絡（同到場結果卡的 rff）
    與「開啟案件」（admin_urls：訪視 id → 後台網址）。超過 11 筆時第 12 張寫「另有 N 筆」。呼叫端確認 rows 不是空的。"""
    urls = admin_urls or {}
    counts: dict[str, int] = {}
    for row in rows:
        counts[row.campus_name] = counts.get(row.campus_name, 0) + 1
    summary = _bubble(
        FOLLOW_UP_EYEBROW, f"{FOLLOW_UP_TITLE}（到期）",
        [_row("合計", f"{len(rows)} 筆")] + [_row(name, f"{n} 筆") for name, n in counts.items()],
        [],
    )
    overflow = len(rows) > CAROUSEL_MAX - 1
    shown = rows[: CAROUSEL_MAX - 1]
    bubbles = [summary]
    for i, row in enumerate(shown):
        body = [_row("校區", row.campus_name)]
        if row.contact:
            body.append(_row("家長", row.contact))
        body += [_row("參觀日", row.visited), _row("應聯絡", row.due)]
        last = overflow and i == len(shown) - 1
        buttons: list[dict] = []
        if last:
            body.append(_text(f"另有 {len(rows) - len(shown)} 筆，請開後台", size="sm", color=MUTED, margin="md"))
        else:
            buttons.append(_hbox([_postback_button(label, encode(RF_FOLLOW, row.visit_id, days)) for label, days in FOLLOW_UP_BUTTONS]))
            link = _usable_uri(urls.get(row.visit_id))
            if link:
                buttons.append(_button("開啟案件", link, primary=False))
        bubbles.append(_bubble(FOLLOW_UP_EYEBROW, "下次聯絡已到", body, buttons))
    return flex_message(f"{FOLLOW_UP_TITLE}（共 {len(rows)} 筆）", {"type": "carousel", "contents": bubbles})


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
    """到場結果卡。有招生訪視才放結果欄位按鈕（預繳、來源分類、交通車、下次聯絡）；後台連結 admin_url 非空才放。
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
        # 下次聯絡（2026-11-25）：同後台快捷鍵，台北 10:00。
        buttons.append(_hbox([
            _postback_button(label, encode(RF_FOLLOW, rv, days)) for label, days in FOLLOW_UP_BUTTONS
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


# ---- 月報（2026-11-26，docs/specs/2026-11-26-line-group-reports-design.md §3）----

REPORT_EYEBROW = "常春藤官網｜月報"
_BAR_TRACK = "#E6ECE8"


def _bar(cases: int, top: int) -> dict:
    """一條橫條：長度＝這校預約數 ÷ 各校最大值。0 筆只留底色。"""
    track: dict = {
        "type": "box", "layout": "vertical", "height": "10px", "cornerRadius": "5px",
        "backgroundColor": _BAR_TRACK, "flex": 5, "contents": [{"type": "filler"}],
    }
    if cases > 0 and top > 0:
        track["contents"] = [{
            "type": "box", "layout": "vertical", "height": "10px", "cornerRadius": "5px",
            "backgroundColor": BRAND, "width": f"{max(4, round(cases * 100 / top))}%",
            "contents": [{"type": "filler"}],
        }]
    return track


def monthly_report_message(report, *, detail_buttons: list[dict] | None = None) -> dict:
    """report：line_group_reports.MonthlyReport。只有數字與校名；altText 只放月份與合計筆數。
    detail_buttons：各校明細鈕（report_detail_buttons，2026-11-27），放在 footer。"""
    title = f"{report.month} 月月報"
    top = max((campus.cases for campus in report.campuses), default=0)
    body: list[dict] = [
        _row("預約", f"{report.cases} 筆{report.cases_delta}"),
        _row("到場率", f"{report.attendance}（前一個月 {report.attendance_before}）"),
        _row("預繳", f"{report.deposits} 筆{report.deposits_delta}"),
        {"type": "separator", "margin": "md"},
        _text("各校預約數", size="sm", color=MUTED, margin="md"),
    ]
    for campus in report.campuses:
        body.append({
            "type": "box", "layout": "horizontal", "spacing": "md", "alignItems": "center", "margin": "md",
            "contents": [
                _text(campus.name, size="sm", flex=2, wrap=False),
                _bar(campus.cases, top),
                _text(str(campus.cases), size="sm", flex=1, align="end", wrap=False),
            ],
        })
        body.append(_text(f"到場率 {campus.attendance}｜預繳 {campus.deposits}", size="xs", color=MUTED))
    body.append(_text("依預約送出日；到場率＝到場 ÷ 已標記。", size="xs", color=MUTED, margin="md"))
    if detail_buttons:
        body.append(_text(DETAIL_HINT, size="xs", color=MUTED, margin="md"))
    return flex_message(f"{title}：預約 {report.cases} 筆", _bubble(REPORT_EYEBROW, title, body, detail_buttons or []))


# ---- 週報、月報的各校明細（2026-11-27，docs/specs/2026-11-27-line-card-buttons-design.md §2）----

WEEKLY_EYEBROW = "常春藤官網｜週報"
DETAIL_PICKER_TITLE = "看各校明細"
DETAIL_HINT = "按校名看那一校的進件管道、官網來源、取消與未到場名單。"
DETAIL_BUTTONS_PER_ROW = 3
_DETAIL_EYEBROWS = {"w": "常春藤官網｜週報明細", "m": "常春藤官網｜月報明細"}
_DETAIL_NOTE = "依預約送出日；官網來源是家長第一次進站的管道；名單只放家長稱呼。"


def short_campus_name(name: str) -> str:
    """按鈕上的校名：去掉「校」（義華校 → 義華）。"""
    return name.removesuffix("校") or name


def detail_display_text(name: str) -> str:
    """明細鈕按了以後群組看到的字（看得出是誰按的）。不能是群組指令（tests 會檢查）。"""
    return f"{short_campus_name(name)}明細"


def report_detail_buttons(code: str, start, campuses: list[tuple[str, str]]) -> list[dict]:
    """各校明細鈕，三顆一列。code：w（週報）／m（月報）；start：那一期第一天；campuses：(key, 名稱)。"""
    day = start.strftime("%Y%m%d")
    buttons = [
        {**_postback_button(short_campus_name(name), encode(REPORT_DETAIL, code, key, day), display_text=detail_display_text(name)), "flex": 1}
        for key, name in campuses
    ]
    return [_hbox(buttons[i:i + DETAIL_BUTTONS_PER_ROW]) for i in range(0, len(buttons), DETAIL_BUTTONS_PER_ROW)]


def report_picker_message(code: str, start, campuses: list[tuple[str, str]]) -> dict:
    """週報（純文字掛不了按鈕）後面跟的小卡：只有各校明細鈕。"""
    # 這張跟在週報後面：聊天列表與通知看到的是它的 altText，寫明是週報的。
    return flex_message(
        f"週報：{DETAIL_PICKER_TITLE}",
        _bubble(WEEKLY_EYEBROW, DETAIL_PICKER_TITLE, [_text(DETAIL_HINT, size="sm", color=MUTED)],
                report_detail_buttons(code, start, campuses)),
    )


def _counts(pairs: list[tuple[str, int]]) -> str:
    return "｜".join(f"{label} {count}" for label, count in pairs)


def _names(names: list[str], total: int) -> str:
    more = total - len(names)
    return "、".join(names) + (f" 等 {total} 位" if more > 0 else "")


def report_detail_message(code: str, detail, *, analytics_url: str | None = None) -> dict:
    """detail：line_group_reports.CampusDetail。只有數字、校名、日期與家長稱呼；altText 不放稱呼。"""
    span = f"{detail.start.month}/{detail.start.day}–{detail.end.month}/{detail.end.day}"
    title = f"{detail.name} {span}"
    body: list[dict] = [_row("預約", f"{detail.cases} 筆")]
    if detail.channels:
        body.append(_row("進件管道", _counts(detail.channels)))
    if detail.web_sources:
        body.append(_row("官網來源", _counts(detail.web_sources)))
    if detail.cases:
        body.append(_row(
            "結果",
            f"到場 {detail.completed}｜未到場 {detail.no_show}｜待標記 {detail.awaiting}"
            f"｜尚未參觀 {detail.upcoming}｜取消 {detail.cancelled}",
        ))
        body.append(_row("到場率", detail.attendance))
    if detail.cancel_sides:
        body.append(_row("取消", _counts(detail.cancel_sides)))
    body.append(_row("預繳", f"{detail.deposits} 筆"))
    if detail.no_show_names or detail.awaiting_names:
        body.append({"type": "separator", "margin": "md"})
    if detail.no_show_names:
        body.append(_row("未到場", _names(detail.no_show_names, detail.no_show)))
    if detail.awaiting_names:
        body.append(_row("待標記", _names(detail.awaiting_names, detail.awaiting)))
    body.append(_text(_DETAIL_NOTE, size="xs", color=MUTED, margin="md"))
    link = _usable_uri(analytics_url)
    buttons = [_button("開成效統計", link, primary=False)] if link else []
    return flex_message(f"{title} 明細", _bubble(_DETAIL_EYEBROWS.get(code, REPORT_EYEBROW), title, body, buttons))


# ---- 統計異常提醒（2026-11-27 §4；原本是純文字，app/operations/stats_health.py）----

STATS_HEALTH_EYEBROW = "常春藤官網｜統計健康檢查"
STATS_MUTE_BUTTON = "知道了，先不提醒"
STATS_MUTE_DISPLAY = "知道了，我來看"


def stats_health_message(title: str, messages: list[str], *, mute_data: str, analytics_url: str | None) -> dict:
    """每項問題一行；「知道了」帶 postback（3 天內同樣的問題不再提醒），「開成效統計」有網址才放。"""
    body = [_text(f"・{message}", size="sm") for message in messages]
    body.append(_text("按「知道了」：這幾項 3 天內早上先不提醒（問題還在之後會再提醒）；後台成效統計頁照常顯示。",
                      size="xs", color=MUTED, margin="md"))
    buttons = [_postback_button(STATS_MUTE_BUTTON, mute_data, display_text=STATS_MUTE_DISPLAY, primary=True)]
    link = _usable_uri(analytics_url)
    if link:
        buttons.append(_button("開成效統計", link, primary=False))
    return flex_message(title, _bubble(STATS_HEALTH_EYEBROW, title, body, buttons))
