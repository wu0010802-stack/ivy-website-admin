"""參觀案件 CSV 匯出用的中文欄名與代碼對照。

後台畫面用 admin/src/api/labels.ts 的同一套文字；後端讀不到前端檔案，所以
這裡另放一份，改其中一邊時另一邊一起改。tests/test_visit_attention_export.py 會檢查
每個狀態、來源、得知管道代碼都有對照，新增代碼時忘了補就會紅。"""

from __future__ import annotations

import re

from app.booking.models import VisitRequestStatus, VisitRequestSource
from app.campuses.models import CAMPUS_NAMES

EXPORT_HEADERS = (
    "校區", "狀態", "來源", "家長", "手機", "送出時間",
    "孩子姓名", "孩子生日", "Email", "得知管道", "人數",
    "參觀日期", "開始", "結束",
)

STATUS_LABELS = {
    VisitRequestStatus.CONFIRMED.value: "預約正常",
    VisitRequestStatus.COMPLETED.value: "已到場",
    VisitRequestStatus.NO_SHOW.value: "未到場",
    VisitRequestStatus.CANCELLED.value: "已取消",
}

SOURCE_LABELS = {
    VisitRequestSource.WEB.value: "官網表單",
    VisitRequestSource.PHONE.value: "電話",
    VisitRequestSource.LINE.value: "LINE",
    VisitRequestSource.WALK_IN.value: "親自到園",
    VisitRequestSource.EXTERNAL.value: "外部預約網站",
}

REFERRAL_LABELS = {
    "friends_family": "親友介紹",
    "sibling": "哥哥姊姊讀過或正在讀",
    "nearby": "住附近／路過看到",
    "flyer": "傳單／DM",
    "online": "網路上看到",
    "other": "其他",
    # 2026-10-03 以前的選項，舊案件仍會有。
    "facebook": "Facebook",
    "google_reviews": "Google 評論",
    "parent_community": "媽媽社團",
}


def campus_label(key: str) -> str:
    # 校區名去掉「校」字，和後台一致（義華、明華…）。
    name = CAMPUS_NAMES.get(key)
    return name.removesuffix("校") if name else key


def status_label(value: str) -> str:
    return STATUS_LABELS.get(value, value)


def source_label(value: str) -> str:
    return SOURCE_LABELS.get(value, value)


def referral_label(values: list[str]) -> str:
    return "、".join(REFERRAL_LABELS.get(value, value) for value in values)


_MOBILE = re.compile(r"(09\d{2})(\d{3})(\d{3})")


def format_phone(value: str) -> str:
    """0912345601 寫成 0912-345-601。Excel 直接開 CSV 會把純數字的手機當數值、
    吃掉開頭的 0；加了連字號就維持文字。不在儲存格前面補 tab 或寫成 ="…"：
    前者會被公式注入防護再補一個單引號，後者等於自己造公式。"""
    match = _MOBILE.fullmatch(value)
    return "-".join(match.groups()) if match else value
