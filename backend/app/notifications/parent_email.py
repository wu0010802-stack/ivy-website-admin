"""寄給家長的預約確認信（純文字）。只放預約內容與修改連結，不放孩子生日、
完整電話、提問內容。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time

from app.booking.outbox import (
    PARENT_EMAIL_CHANGED,
    PARENT_VISIT_BOOKED,
    PARENT_VISIT_CANCELLED,
    PARENT_VISIT_CHANGED,
    PARENT_VISIT_DAY_CLOSED,
    PARENT_VISIT_REMINDER,
)
from app.common.timezones import OPERATING_TZ

_WEEKDAYS = "一二三四五六日"
_TITLES = {
    PARENT_VISIT_BOOKED: "參觀預約成功",
    PARENT_VISIT_CHANGED: "參觀預約已變更",
    PARENT_VISIT_CANCELLED: "參觀預約已取消",
    PARENT_VISIT_DAY_CLOSED: "參觀日停課，請改約時間",
    PARENT_VISIT_REMINDER: "參觀提醒",
    PARENT_EMAIL_CHANGED: "參觀預約的聯絡 Email 已變更",
}


def session_label(start: time) -> str:
    return f"{'上午場' if start.hour < 12 else '下午場'} {start:%H:%M}"


def visit_when(slot_date: date, start: time) -> str:
    return f"{slot_date:%m/%d}（{_WEEKDAYS[slot_date.weekday()]}）{session_label(start)}"


def _deadline_text(deadline: datetime) -> str:
    local = deadline.astimezone(OPERATING_TZ)
    return f"{local:%m/%d}（{_WEEKDAYS[local.weekday()]}）{local:%H:%M}"


@dataclass(frozen=True)
class ParentEmail:
    kind: str
    campus_name: str
    salutation: str
    slot_date: date | None
    start_time: time | None
    end_time: time | None
    party_size: int | None
    campus_address: str | None
    campus_phone: str | None
    manage_url: str | None
    change_deadline: datetime | None
    cancel_reason: str | None
    rebook_url: str | None
    # 停課通知的原因（園方填給家長看的，例如「颱風停班停課」）；其他種類為 None。
    closure_reason: str | None = None
    # 參觀提醒寫「明天」或「今天」（寄出當下的台北日期，規格 R8）；其他種類為 None。
    day_word: str | None = None
    # 寄件當下那天停課（parent_policy.day_closed）：預約成功／已變更信改寫成停課內容。
    day_closed: bool = False
    # 寄件當下已過線上修改期限：預約成功／已變更信不寫截止時間、請家長來電。
    change_window_passed: bool = False


def build_parent_email(mail: ParentEmail) -> tuple[str, str]:
    short_name = mail.campus_name[:-1] if mail.campus_name.endswith("校") else mail.campus_name
    when = visit_when(mail.slot_date, mail.start_time) if mail.slot_date and mail.start_time else None
    day = f"{mail.day_word} " if mail.kind == PARENT_VISIT_REMINDER and mail.day_word else ""
    # 停課日的預約成功／已變更信（停課後家長改資料、園方重寄或換連結）不能寫成照常參觀，
    # 標題、開頭與連結段落都比照停課通知（2026-10-20 稽核）。
    closed_notice = mail.kind == PARENT_VISIT_DAY_CLOSED or (
        mail.day_closed and mail.kind in (PARENT_VISIT_BOOKED, PARENT_VISIT_CHANGED)
    )
    title = _TITLES[PARENT_VISIT_DAY_CLOSED] if closed_notice else _TITLES[mail.kind]
    subject = f"【常春藤{short_name}】{title}" + (f"：{day}{when}" if when else "")
    closed_text = f"常春藤{mail.campus_name}這天停課，原本約好的參觀無法進行，很抱歉。"

    if mail.kind == PARENT_VISIT_DAY_CLOSED:
        because = f"因{mail.closure_reason}，" if mail.closure_reason else ""
        intro = f"{because}{closed_text}"
    elif closed_notice and mail.kind == PARENT_VISIT_CHANGED:
        intro = f"您的參觀預約已更新。{closed_text}"
    elif closed_notice:
        intro = closed_text
    elif mail.kind == PARENT_VISIT_BOOKED:
        intro = f"您已完成常春藤{mail.campus_name}的參觀預約，期待與您見面。"
    elif mail.kind == PARENT_VISIT_CHANGED:
        intro = "您的參觀預約已更新，以下是最新內容。"
    elif mail.kind == PARENT_VISIT_REMINDER:
        intro = f"提醒您，{day}{when} 在常春藤{mail.campus_name}參觀。" if when else f"提醒您，記得到常春藤{mail.campus_name}參觀。"
    elif mail.cancel_reason == "parent":
        intro = "您已取消這次參觀預約。"
    elif mail.cancel_reason == "staff":
        intro = "園方已取消這次參觀預約，如有疑問請來電洽詢。"
    else:
        intro = "這次參觀預約已取消。"

    lines = [f"{mail.salutation}您好：", "", intro, "", f"校區：{mail.campus_name}"]
    if when:
        span = f"（{mail.start_time:%H:%M}–{mail.end_time:%H:%M}）" if mail.end_time else ""
        lines.append(f"日期與場次：{when}{span}")
    if mail.party_size:
        lines.append(f"參觀人數：{mail.party_size} 位")
    if mail.campus_address:
        lines.append(f"地址：{mail.campus_address}")
    if mail.campus_phone:
        lines.append(f"電話：{mail.campus_phone}")
    lines.append("")

    if mail.kind == PARENT_VISIT_CANCELLED:
        lines.append(f"想再預約參觀，請到：{mail.rebook_url}" if mail.rebook_url else "想再預約參觀，歡迎來電洽詢。")
    elif closed_notice:
        # 停課日沒有線上修改期限（parent_policy.day_closed），不寫截止時間。
        if mail.manage_url:
            lines += ["請開啟這個連結改約其他時間，或取消這次預約：", mail.manage_url, "請勿把這個連結轉給他人。"]
        else:
            lines.append("請來電改約其他時間，或告訴我們要取消這次預約。")
    elif mail.kind == PARENT_VISIT_REMINDER:
        # 提醒時多半已過線上修改期限（預設參觀前 24 小時）：期限內才附連結，否則請家長來電（規格 R7）。
        if mail.manage_url and mail.change_deadline:
            lines += [
                f"要改期或取消，請在 {_deadline_text(mail.change_deadline)} 前使用這個連結：",
                mail.manage_url,
                "請勿把這個連結轉給他人。",
            ]
        elif mail.campus_phone:
            lines.append(f"要改期或取消，請來電 {mail.campus_phone}。")
        else:
            lines.append("要改期或取消，請來電洽詢。")
    elif mail.change_window_passed:
        # 最短提前時間可以短於修改期限：送出當下期限就過了，不寫已過的截止時間（2026-10-20 稽核）。
        call = f"請來電 {mail.campus_phone}" if mail.campus_phone else "請來電洽詢"
        lines.append(f"已過線上修改期限，要改時間或取消，{call}。")
    elif mail.manage_url:
        deadline = f"（{_deadline_text(mail.change_deadline)}前可以線上修改）" if mail.change_deadline else ""
        lines += [f"要改時間、修改資料或取消，請開啟這個連結{deadline}：", mail.manage_url, "請勿把這個連結轉給他人。"]
    else:
        lines.append("要改時間或取消，請使用預約完成頁上的連結，或來電洽詢。")

    lines += ["", "這封信由系統自動寄出，請勿直接回覆。"]
    return subject, "\n".join(lines)


def build_email_changed_notice(
    *, campus_name: str, slot_date: date | None, start_time: time | None, campus_phone: str | None
) -> tuple[str, str]:
    """寄到舊信箱的 Email 變更通知（2026-10-22 資安稽核）。收件人已經不是這筆預約的聯絡人：
    不稱呼姓名（可能已被改掉）、不附修改連結、不寫新信箱，只說哪一校哪一場、不是本人就來電。"""
    short_name = campus_name[:-1] if campus_name.endswith("校") else campus_name
    when = visit_when(slot_date, start_time) if slot_date and start_time else None
    subject = f"【常春藤{short_name}】{_TITLES[PARENT_EMAIL_CHANGED]}"
    visit = f"常春藤{campus_name}{when}的參觀預約" if when else f"常春藤{campus_name}的參觀預約"
    call = f"請盡快來電 {campus_phone} 告訴我們" if campus_phone else "請盡快來電告訴我們"
    lines = [
        "您好：",
        "",
        f"您在{visit}，聯絡 Email 剛剛改成了另一個信箱。之後的通知與修改連結都會寄到新的信箱，這個信箱不會再收到。",
        "",
        f"如果這不是您本人的操作，{call}。",
        "",
        "這封信由系統自動寄出，請勿直接回覆。",
    ]
    return subject, "\n".join(lines)
