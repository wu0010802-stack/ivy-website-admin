"""寄給家長的預約確認信（純文字）。只放預約內容與修改連結，不放孩子生日、
完整電話、提問內容。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time

from app.booking.outbox import PARENT_VISIT_BOOKED, PARENT_VISIT_CANCELLED, PARENT_VISIT_CHANGED
from app.common.timezones import OPERATING_TZ

_WEEKDAYS = "一二三四五六日"
_TITLES = {
    PARENT_VISIT_BOOKED: "參觀預約成功",
    PARENT_VISIT_CHANGED: "參觀預約已變更",
    PARENT_VISIT_CANCELLED: "參觀預約已取消",
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


def build_parent_email(mail: ParentEmail) -> tuple[str, str]:
    short_name = mail.campus_name[:-1] if mail.campus_name.endswith("校") else mail.campus_name
    when = visit_when(mail.slot_date, mail.start_time) if mail.slot_date and mail.start_time else None
    subject = f"【常春藤{short_name}】{_TITLES[mail.kind]}" + (f"：{when}" if when else "")

    if mail.kind == PARENT_VISIT_BOOKED:
        intro = f"您已完成常春藤{mail.campus_name}的參觀預約，期待與您見面。"
    elif mail.kind == PARENT_VISIT_CHANGED:
        intro = "您的參觀預約已更新，以下是最新內容。"
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
    elif mail.manage_url:
        deadline = f"（{_deadline_text(mail.change_deadline)}前可以線上修改）" if mail.change_deadline else ""
        lines += [f"要改時間、修改資料或取消，請開啟這個連結{deadline}：", mail.manage_url, "請勿把這個連結轉給他人。"]
    else:
        lines.append("要改時間或取消，請使用預約完成頁上的連結，或來電洽詢。")

    lines += ["", "這封信由系統自動寄出，請勿直接回覆。"]
    return subject, "\n".join(lines)
