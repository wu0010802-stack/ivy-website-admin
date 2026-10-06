"""招生入學的後台 CSV 下載（2026-10-03 匯出擴充，10-06 對 main 修訂）：訪視明細與未預繳名單。

給園方用 Excel 看：中文欄名、西元日期、台北時間；欄位和後台畫面一致（10-05「畫面放回已有的
欄位」之後，來源分類、帶參觀老師、娃娃車也在畫面上，所以進 CSV），只有地址分析同意
（geocoding_consent_at）依 DESIGN「不上畫面」不進。和 export.py（轉給園務匯入程式的 JSONL、
園務欄位名）是兩回事，不要混用。BOM 與公式注入防護在 app/common/csv_export.py。

和後台前端各有一份、要同步的對照：階段文字（admin/src/admissions/constants.ts stageMeta、
WITHDRAWN_FROM_LABELS）、來源分類六項短文字（admin/src/admissions/sourceCategories.ts
SOURCE_CATEGORY_CHOICES），由 admin/src/__tests__/admissionsDownloadLabels.test.ts 讀這個檔的原始碼比對。

稽核 metadata 只記套用了哪些篩選；搜尋字、介紹者、來源原文可能是人名，只記「有篩選」；
負責人只記類別（me、none、staff），不記帳號 id；未預繳名單的原因、班別不在選項內時記 other。鍵要在 admin/src/api/labels.ts 有中文
（labelCoverage.test.ts 會解析下面兩個函式的 applied）。"""

from __future__ import annotations

import uuid
from collections.abc import Mapping, Sequence
from datetime import date, datetime, timezone
from typing import TYPE_CHECKING, Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import constants, funnel
from app.auth.models import User
from app.booking.export_labels import campus_label, format_phone
from app.common.csv_export import roc_month_csv
from app.common.timezones import OPERATING_TZ

if TYPE_CHECKING:
    from app.admissions.models import RecruitmentVisit
    from app.admissions.records import RecruitmentVisitFilters

# 順序同後台訪視明細的畫面與編輯表單；改欄位時 test_admissions_download.py 的 EXPECTED_HEADERS 要跟著改。
RECORD_HEADERS: tuple[str, ...] = (
    "校區", "月份", "序號", "參觀日期", "幼生姓名", "英文名字", "生日", "班別", "入學學年", "入學學期",
    "階段", "預繳", "已註冊", "聯絡人", "電話", "地址", "父親職業", "母親職業", "來源", "來源分類",
    "家長介紹", "帶參觀老師", "搭娃娃車", "收預繳人員", "未預繳原因", "未預繳說明", "保留座位", "註冊日期",
    "轉學期", "退出原因", "下次聯絡", "負責人", "最近聯絡", "官網預約", "電訪回應", "備註", "建檔時間",
)

NO_DEPOSIT_HEADERS: tuple[str, ...] = (
    "校區", "月份", "序號", "姓名", "班別", "原因分類", "轉換潛力", "冷名單",
    "說明", "來源", "家長介紹", "電訪回應", "建檔時間",
)

SEMESTER_LABELS = {1: "上學期", 2: "下學期"}
PRIORITY_LABELS = {"high": "高", "medium": "中", "low": "低"}
# 同 admin constants.ts WITHDRAWN_FROM_LABELS：退出的訪視寫清楚從哪一段退的。
WITHDRAWN_FROM_LABELS = {"deposited": "退預繳", "enrolled": "退註冊"}
# 同 admin sourceCategories.ts SOURCE_CATEGORY_CHOICES（表單六項「孩子從哪裡來」的短文字，順序同）。
# 其他三類（舊資料才有）用 constants.SOURCE_CATEGORIES 的園務原文。
SOURCE_CATEGORY_SHORT_LABELS = {
    "sibling_current": "在校生弟妹",
    "sibling_graduate": "畢業生弟妹",
    "referral": "家長介紹／社區招生",
    "self_report": "自報生（廣告、鄰居、網路、活動）",
    "invite_success": "邀約來園",
    "returning": "舊生復學",
}
# 畫面上原因分類沒填寫「未分類」。
UNCLASSIFIED = "未分類"


def _day(value: date | None) -> str:
    return value.strftime("%Y/%m/%d") if value else ""


def _when(value: datetime | None) -> str:
    if value is None:
        return ""
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(OPERATING_TZ).strftime("%Y/%m/%d %H:%M")


def _yes_no(value: bool | None) -> str:
    return "是" if value else "否"


def _bus(value: bool | None) -> str:
    return "" if value is None else ("要搭" if value else "不搭")


def stage_label(visit: RecruitmentVisit) -> str:
    """同後台 stageMeta：退出依 withdrawn_from 寫「已退預繳」或「已退註冊」（沒有值當從預繳退），
    其餘「已訪視／已預繳／已註冊」。"""
    stage = funnel.derive_stage(visit)
    if stage == "withdrawn":
        return f"已{WITHDRAWN_FROM_LABELS.get(visit.withdrawn_from or 'deposited', '退預繳')}"
    return constants.STAGE_LABELS[stage]


def source_category_label(code: str | None) -> str:
    """六項用短文字，其他代碼用園務原文，都沒有就寫代碼本身；NULL 空白。"""
    if not code:
        return ""
    return SOURCE_CATEGORY_SHORT_LABELS.get(code) or constants.SOURCE_CATEGORIES.get(code) or code


async def owner_names(db: AsyncSession, visits: Sequence[RecruitmentVisit]) -> dict[uuid.UUID, str]:
    """追蹤負責人的名稱（規則同後台 ownerLabel：顯示名稱，沒有就 Email），一次查完，
    不逐列查。沒有負責人的訪視不需要查詢；查不到的帳號不在回傳裡（匯出寫空白）。"""
    ids = {visit.follow_up_owner_id for visit in visits if visit.follow_up_owner_id is not None}
    if not ids:
        return {}
    rows = await db.execute(select(User.id, User.display_name, User.email).where(User.id.in_(ids)))
    return {user_id: display_name or email for user_id, display_name, email in rows}


def record_row(visit: RecruitmentVisit, owner_names: Mapping[uuid.UUID, str] | None = None) -> list[str]:
    """owner_names 是 owner_names() 的結果；沒給或對不到就寫空白。"""
    owner = owner_names.get(visit.follow_up_owner_id, "") if owner_names and visit.follow_up_owner_id else ""
    return [
        campus_label(visit.campus_key),
        roc_month_csv(visit.month),
        visit.seq_no or "",
        _day(visit.visit_date),
        visit.child_name,
        visit.english_name or "",
        _day(visit.birthday),
        visit.grade or "",
        str(visit.target_school_year) if visit.target_school_year is not None else "",
        SEMESTER_LABELS.get(visit.target_semester, ""),
        stage_label(visit),
        _yes_no(visit.has_deposit),
        _yes_no(visit.enrolled),
        visit.contact_name or "",
        format_phone(visit.phone) if visit.phone else "",
        # 同畫面：沒有地址就用區域。
        visit.address or visit.district or "",
        visit.father_occupation or "",
        visit.mother_occupation or "",
        visit.source or "",
        source_category_label(visit.source_category),
        visit.referrer or "",
        visit.tour_guide_name or "",
        _bus(visit.rides_bus),
        visit.deposit_collector or "",
        visit.no_deposit_reason or "",
        visit.no_deposit_reason_detail or "",
        visit.provisional_grade or "",
        _day(visit.enrolled_on),
        _yes_no(visit.transfer_term),
        visit.withdraw_reason or "",
        _when(visit.follow_up_at),
        owner,
        _when(visit.last_contacted_at),
        "是" if visit.visit_request_id else "否",
        visit.parent_response or "",
        visit.notes or "",
        _when(visit.created_at),
    ]


def no_deposit_row(campus_key: str, record: dict[str, Any]) -> list[str]:
    """record 是 stats.no_deposit_records 回傳的一筆（NoDepositRecordOut 的欄位）。"""
    return [
        campus_label(campus_key),
        roc_month_csv(record["month"]),
        record["seq_no"] or "",
        record["child_name"],
        record["grade"] or "",
        record["no_deposit_reason"] or UNCLASSIFIED,
        PRIORITY_LABELS.get(record["priority"] or "", ""),
        _yes_no(record["cold"]),
        record["no_deposit_reason_detail"] or "",
        record["source"] or "",
        record["referrer"] or "",
        record["parent_response"] or "",
        _when(record["created_at"]),
    ]


def records_audit_metadata(filters: RecruitmentVisitFilters) -> dict:
    applied = {
        "month": filters.month,
        "grade": filters.grade,
        "school_year": filters.target_school_year,
        "semester": filters.target_semester,
        "has_source": True if filters.source else None,
        "has_referrer": True if filters.referrer else None,
        "has_deposit": filters.has_deposit,
        "no_deposit_reason": filters.no_deposit_reason,
        "funnel_stage": filters.stage,
        "has_visit_request": True if filters.visit_request_id else None,
        "has_search": True if filters.q else None,
        "follow_up": filters.follow_up,
        # 負責人只記類別，不記帳號 id：me、none，或 staff（指定某位同仁）。
        "owner": (filters.owner if filters.owner in ("me", "none") else "staff") if filters.owner else None,
    }
    return {key: value for key, value in applied.items() if value is not None}


# 稽核紀錄裡「篩選值不在選項內」的固定寫法（admin labels.ts 寫成「其他（不在選項內）」）。
OTHER_FILTER_VALUE = "other"


def _known_choice(value: str | None, choices: Sequence[str]) -> str | None:
    """未預繳名單端點的 reason、grade 收任意字串（最長 60、20）：不在選項內的可能是人名，
    不能原文寫進稽核紀錄，改記固定值；空字串同沒篩選（端點對空字串不篩）。"""
    if not value:
        return None
    return value if value in choices else OTHER_FILTER_VALUE


def no_deposit_audit_metadata(
    *,
    school_year: int | None,
    semester: int | None,
    reason: str | None,
    grade: str | None,
    priority: str | None,
    overdue_days: int | None,
    cold_only: bool | None,
) -> dict:
    applied = {
        "school_year": school_year,
        "semester": semester,
        "no_deposit_reason": _known_choice(reason, constants.NO_DEPOSIT_REASONS),
        "grade": _known_choice(grade, constants.GRADES),
        "priority": priority,
        "overdue_days": overdue_days,
        "cold_only": True if cold_only else None,
    }
    return {key: value for key, value in applied.items() if value is not None}
