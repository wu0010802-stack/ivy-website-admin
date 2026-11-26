"""廣告名單的欄位整理與狀態轉移（docs/specs/2026-11-26-meta-lead-inbox-design.md）。

狀態欄位只在這個檔寫（app/state_machines.py 的 META_LEAD）：略過、放回、轉成案件。
新名單由同步以欄位預設值 'new' 寫入（app/meta_leads/sync.py）。"""

from __future__ import annotations

import re
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import User
from app.auth.permissions import ScopeDenied, require_scope
from app.booking.models import VisitRequest
from app.common.timezones import OPERATING_TZ, now_utc
from app.meta_leads.models import MetaLead
from app.operations import audit_service

# Meta 即時表單內建的聯絡欄位代碼；姓名、電話另存欄位，不放進作答清單。
_FULL_NAME = "full_name"
_FIRST_NAME = "first_name"
_LAST_NAME = "last_name"
_PHONE = "phone_number"
_CONTACT_FIELDS = frozenset({_FULL_NAME, _FIRST_NAME, _LAST_NAME, _PHONE})
_TW_MOBILE = re.compile(r"(?:\+?886|00886)0?(9\d{8})")
# 轉案件時案件的網站來源：廣告、Meta（app/booking/attribution.py 的代碼）。
ADS_SOURCE = "ads"
META_PLATFORM = "meta"
# 案件 ad_click_ids 裡放 Meta 名單編號的鍵；回傳 Meta 時送成 user_data.lead_id（app/ad_conversions/）。
LEAD_ID_KEY = "meta_lead_id"


class LeadStatusConflict(Exception):
    """名單現在的狀態不能做這個動作（別人剛處理過）。"""


class LeadCampusMismatch(Exception):
    """名單不是這一校的。"""


def normalize_phone(raw: str | None) -> str | None:
    """台灣手機（+886 9xx…、886…）轉成 09 開頭；其他格式只去掉空白與分隔符號。"""
    if not raw:
        return None
    compact = re.sub(r"[\s\-().]", "", raw)
    if match := _TW_MOBILE.fullmatch(compact):
        return f"0{match.group(1)}"
    return compact[:32] or None


def contact_fields(fields: tuple[tuple[str, str], ...]) -> tuple[str | None, str | None, list[dict]]:
    """Graph 的 field_data → (家長姓名, 電話, 其餘作答)。同名欄位只取第一個。"""
    first: dict[str, str] = {}
    answers: list[dict] = []
    for name, answer in fields:
        if name in _CONTACT_FIELDS:
            first.setdefault(name, answer)
        else:
            answers.append({"question": name, "answer": answer})
    full = first.get(_FULL_NAME) or " ".join(
        part for part in (first.get(_FIRST_NAME), first.get(_LAST_NAME)) if part
    )
    return (full.strip()[:64] or None), normalize_phone(first.get(_PHONE)), answers


async def lock_lead(db: AsyncSession, user: User, lead_id: uuid.UUID, capability: str) -> MetaLead:
    """鎖住名單列並檢查校區權限；找不到或沒權限一律 ScopeDenied（不透露別校有沒有這筆）。"""
    lead = await db.scalar(select(MetaLead).where(MetaLead.id == lead_id).with_for_update())
    if lead is None:
        raise ScopeDenied()
    require_scope(user, capability, campus_keys=[lead.campus_key])
    return lead


async def _log(db: AsyncSession, lead: MetaLead, user: User, action: str) -> None:
    await audit_service.log_action(
        db,
        actor_user_id=user.id,
        action=action,
        target_type="meta_lead",
        target_id=str(lead.id),
        campus_key=lead.campus_key,
    )


async def dismiss(db: AsyncSession, lead: MetaLead, user: User) -> None:
    """不轉成案件，收到「略過」；隨時可以放回。"""
    if lead.status != "new":
        raise LeadStatusConflict()
    lead.status = "dismissed"
    lead.handled_by, lead.handled_at = user.id, now_utc()
    await _log(db, lead, user, "meta_lead.dismiss")


async def restore(db: AsyncSession, lead: MetaLead, user: User) -> None:
    if lead.status != "dismissed":
        raise LeadStatusConflict()
    lead.status = "new"
    lead.handled_by, lead.handled_at = user.id, now_utc()
    await _log(db, lead, user, "meta_lead.restore")


def check_convertible(lead: MetaLead, campus_key: str) -> None:
    """補登前的檢查：同一校、還沒轉過。重送同一張補登表單的情況由呼叫端先處理。"""
    if lead.campus_key != campus_key:
        raise LeadCampusMismatch()
    if lead.status not in ("new", "dismissed"):
        raise LeadStatusConflict()


def conversion_tracking(lead: MetaLead) -> dict:
    """轉成的案件要寫的網站來源欄位與點擊識別碼（app/booking/service.py 的 tracking）。
    日期是家長在 Meta 送出表單的台北日期；活動代碼留空（utm_campaign 的代碼表不收 Meta 行銷活動 ID）。"""
    on = lead.created_at.astimezone(OPERATING_TZ).date()
    return {
        "first_touch_source": ADS_SOURCE,
        "first_touch_ad_platform": META_PLATFORM,
        "first_touch_on": on,
        "last_touch_source": ADS_SOURCE,
        "last_touch_ad_platform": META_PLATFORM,
        "last_touch_on": on,
        "ad_click_ids": {LEAD_ID_KEY: lead.lead_id},
    }


def mark_converted(lead: MetaLead, visit_request: VisitRequest, user: User) -> None:
    """補登成功後（同一個交易）：標已轉案件、記案件 id，清掉名單上的個資（已在案件裡）。
    操作紀錄由補登的 visit_request.manual_create 記（metadata 帶 meta_lead_id）。"""
    if lead.status not in ("new", "dismissed"):
        raise LeadStatusConflict()
    lead.status = "converted"
    lead.visit_request_id = visit_request.id
    lead.handled_by, lead.handled_at = user.id, now_utc()
    lead.parent_name = None
    lead.phone = None
    lead.answers = None
