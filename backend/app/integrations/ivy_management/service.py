"""把官網的預約與招生訪視合成園務系統要的「lead」清單（唯讀、keyset 分頁）。

一筆 lead＝一個家長報名：
1. 第一段（vr）：該校所有沒被排除的預約，依 (created_at, id)；有招生訪視就帶上（visit_request_id 對得上）。
2. 第二段（rv）：沒有預約的招生訪視（手動建立或原預約已刪除），依 (created_at, id)。
連到「已被排除的預約」的訪視兩段都不回（它有 visit_request_id，不在第二段；預約被排除，不在第一段）。

分頁用游標（cursor.py），不用 OFFSET；訪視與場次都按頁批次查，沒有 N+1。
沒有招生訪視的預約用 booking_link.fields_from_visit_request 換算欄位，但參觀日期只採場次日期：
換算函式在沒有場次時會拿「今天」補，這裡不沿用，沒有場次就是 null。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import noload

from app.admissions import booking_link, funnel
from app.admissions.models import RecruitmentVisit
from app.booking.exclusion import not_excluded
from app.booking.models import VisitRequest, VisitSlot
from app.integrations.ivy_management.cursor import Cursor
from app.integrations.ivy_management.schemas import Lead

# 已匿名化時一定回 null 的個資欄位。
PII_FIELDS = (
    "child_name", "birthday", "phone", "contact_name", "address", "notes", "parent_response", "referrer",
)
# 沒有招生訪視時，只有訪視才有的欄位。
_VISIT_ONLY_FIELDS = ("address", "district", "referrer", "deposit_collector", "parent_response")


def _utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.astimezone(timezone.utc) if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _visit_fields(visit: RecruitmentVisit) -> dict:
    return {
        "child_name": visit.child_name,
        "birthday": visit.birthday,
        "grade": visit.grade,
        "phone": visit.phone,
        "contact_name": visit.contact_name,
        "address": visit.address,
        "district": visit.district,
        "source": visit.source,
        "referrer": visit.referrer,
        "deposit_collector": visit.deposit_collector,
        "notes": visit.notes,
        "parent_response": visit.parent_response,
        "target_school_year": visit.target_school_year,
        "target_semester": visit.target_semester,
    }


def _visit_state(visit: RecruitmentVisit | None) -> dict:
    if visit is None:
        return {
            "stage": None, "updated_at": None, "month": None,
            "has_deposit": False, "enrolled": False, "transfer_term": False,
        }
    return {
        "stage": funnel.derive_stage(visit),
        "updated_at": _utc(visit.updated_at),
        "month": visit.month,
        "has_deposit": bool(visit.has_deposit),
        "enrolled": bool(visit.enrolled),
        "transfer_term": bool(visit.transfer_term),
    }


def _finish(values: dict, *, anonymized: bool) -> Lead:
    if anonymized:
        for name in PII_FIELDS:
            values[name] = None
    return Lead(**values, anonymized=anonymized)


def lead_from_request(
    visit_request: VisitRequest,
    visit: RecruitmentVisit | None,
    *,
    slot_date: date | None,
    today: date,
) -> Lead:
    """一筆官網預約（可能已有招生訪視）。"""
    if visit is not None:
        fields = _visit_fields(visit)
        visit_date: date | None = visit.visit_date
    else:
        converted = booking_link.fields_from_visit_request(visit_request, today=today, slot_date=slot_date)
        fields = {
            name: converted.get(name)
            for name in (
                "child_name", "birthday", "grade", "phone", "contact_name", "source", "notes",
                "target_school_year", "target_semester",
            )
        }
        fields.update({name: None for name in _VISIT_ONLY_FIELDS})
        visit_date = slot_date
    anonymized = visit_request.anonymized_at is not None or (visit is not None and visit.anonymized_at is not None)
    return _finish(
        {
            "id": f"vr:{visit_request.id}",
            "origin": "visit_request",
            "visit_request_id": visit_request.id,
            "recruitment_visit_id": visit.id if visit is not None else None,
            "booking_status": visit_request.status,
            "booking_source": visit_request.source,
            "created_at": _utc(visit_request.created_at),
            "visit_date": visit_date,
            **_visit_state(visit),
            **fields,
        },
        anonymized=anonymized,
    )


def lead_from_visit(visit: RecruitmentVisit) -> Lead:
    """沒有預約的招生訪視。"""
    return _finish(
        {
            "id": f"rv:{visit.id}",
            "origin": "manual_visit",
            "visit_request_id": None,
            "recruitment_visit_id": visit.id,
            "booking_status": None,
            "booking_source": None,
            "created_at": _utc(visit.created_at),
            "visit_date": visit.visit_date,
            **_visit_state(visit),
            **_visit_fields(visit),
        },
        anonymized=visit.anonymized_at is not None,
    )


def _after(model, cursor: Cursor | None, segment: str):
    """游標在這一段時：只取排在游標那筆之後的列。"""
    if cursor is None or cursor.segment != segment:
        return []
    return [tuple_(model.created_at, model.id) > tuple_(cursor.created_at, cursor.row_id)]


async def _request_rows(
    db: AsyncSession, campus_key: str, cursor: Cursor | None, count: int
) -> list[tuple[VisitRequest, RecruitmentVisit | None, date | None]]:
    requests = list(
        (
            await db.scalars(
                select(VisitRequest)
                .where(VisitRequest.campus_key == campus_key, not_excluded(), *_after(VisitRequest, cursor, "vr"))
                .order_by(VisitRequest.created_at, VisitRequest.id)
                .limit(count)
            )
        ).all()
    )
    if not requests:
        return []
    visits = {
        visit.visit_request_id: visit
        for visit in (
            await db.scalars(
                select(RecruitmentVisit)
                .where(RecruitmentVisit.visit_request_id.in_([request.id for request in requests]))
                # geo 預設 selectin 多查一次；這裡用不到。
                .options(noload(RecruitmentVisit.geo))
            )
        ).all()
    }
    slot_ids = {request.slot_id for request in requests if request.slot_id is not None}
    slot_dates: dict[uuid.UUID, date] = {}
    if slot_ids:
        slot_dates = dict((await db.execute(select(VisitSlot.id, VisitSlot.slot_date).where(VisitSlot.id.in_(slot_ids)))).all())
    return [(request, visits.get(request.id), slot_dates.get(request.slot_id)) for request in requests]


async def _manual_visits(
    db: AsyncSession, campus_key: str, cursor: Cursor | None, count: int
) -> list[RecruitmentVisit]:
    return list(
        (
            await db.scalars(
                select(RecruitmentVisit)
                .where(
                    RecruitmentVisit.campus_key == campus_key,
                    RecruitmentVisit.visit_request_id.is_(None),
                    *_after(RecruitmentVisit, cursor, "rv"),
                )
                .order_by(RecruitmentVisit.created_at, RecruitmentVisit.id)
                .limit(count)
                .options(noload(RecruitmentVisit.geo))
            )
        ).all()
    )


async def fetch_page(
    db: AsyncSession, campus_key: str, *, limit: int, cursor: Cursor | None, today: date
) -> tuple[list[Lead], str | None]:
    """回傳 (這一頁的 lead, 下一頁游標)。多取一筆判斷還有沒有下一頁：第一段不夠一頁就接第二段。"""
    entries: list[tuple[Lead, Cursor]] = []
    # 游標已經在第二段時，第一段不必再查（它的列都排在游標之前）。
    if cursor is None or cursor.segment == "vr":
        for request, visit, slot_date in await _request_rows(db, campus_key, cursor, limit + 1):
            lead = lead_from_request(request, visit, slot_date=slot_date, today=today)
            entries.append((lead, Cursor("vr", request.created_at, request.id)))
    if len(entries) <= limit:
        for visit in await _manual_visits(db, campus_key, cursor, limit + 1 - len(entries)):
            entries.append((lead_from_visit(visit), Cursor("rv", visit.created_at, visit.id)))
    if len(entries) > limit:
        entries = entries[:limit]
        return [lead for lead, _ in entries], entries[-1][1].encode()
    return [lead for lead, _ in entries], None
