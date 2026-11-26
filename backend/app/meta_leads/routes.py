"""後台「廣告名單」收件匣（docs/specs/2026-11-26-meta-lead-inbox-design.md §5）。

權限沿用參觀案件：看名單 booking.read，略過、放回、立即同步 booking.handle，都受校區範圍限制。
轉成案件走原本的補登端點（POST /admin/visit-requests 帶 meta_lead_id，app/booking/admin_visit_routes.py）。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import campus_scope, require_scope
from app.meta_leads import service
from app.meta_leads.models import MetaLead, MetaLeadSync
from app.meta_leads.schemas import (
    LeadStatus,
    MetaLeadAnswerOut,
    MetaLeadCounts,
    MetaLeadListOut,
    MetaLeadOut,
    MetaLeadPendingOut,
    MetaLeadSyncIn,
    MetaLeadSyncStatusOut,
)
from app.meta_leads.sync import sync_leads
from app.operations import audit_service

router = APIRouter(prefix="/api/website/v1", tags=["meta-leads"])

LIST_LIMIT = 200


def _error(code: int, error_code: str, message: str) -> HTTPException:
    return HTTPException(status_code=code, detail={"code": error_code, "message": message})


def _status_conflict() -> HTTPException:
    return _error(status.HTTP_409_CONFLICT, "META_LEAD_STATUS", "這筆名單已經處理過了，請重新整理")


def _lead_out(lead: MetaLead) -> MetaLeadOut:
    answers = [
        MetaLeadAnswerOut(question=str(item.get("question", "")), answer=str(item.get("answer", "")))
        for item in (lead.answers or [])
        if isinstance(item, dict)
    ]
    return MetaLeadOut(
        id=lead.id,
        campus_key=lead.campus_key,
        form_name=lead.form_name,
        platform=lead.platform,
        is_organic=lead.is_organic,
        created_at=lead.created_at,
        parent_name=lead.parent_name,
        phone=lead.phone,
        answers=answers,
        status=lead.status,  # type: ignore[arg-type]
        visit_request_id=lead.visit_request_id,
        handled_at=lead.handled_at,
    )


def _transport(request: Request):
    # 測試注入 httpx.MockTransport；正式站是 None（真的連 Meta）。與粉專貼文共用同一個注入點。
    return getattr(request.app.state, "facebook_transport", None)


def _configured(request: Request, campus_key: str) -> bool:
    settings = request.app.state.settings
    return settings.meta_leads_sync_enabled and campus_key in settings.facebook_page_ids


async def _list_out(db: AsyncSession, request: Request, campus_key: str, status_filter: LeadStatus) -> MetaLeadListOut:
    sync_row = await db.get(MetaLeadSync, campus_key)
    counts = dict(
        (await db.execute(
            select(MetaLead.status, func.count()).where(MetaLead.campus_key == campus_key).group_by(MetaLead.status)
        )).all()
    )
    leads = await db.scalars(
        select(MetaLead)
        .where(MetaLead.campus_key == campus_key, MetaLead.status == status_filter)
        # 新名單舊的在前（先來的先聯絡）；處理過的新的在前。
        .order_by(MetaLead.created_at.asc() if status_filter == "new" else MetaLead.created_at.desc())
        .limit(LIST_LIMIT)
    )
    return MetaLeadListOut(
        configured=_configured(request, campus_key),
        sync_seconds=request.app.state.settings.meta_leads_sync_seconds,
        sync=MetaLeadSyncStatusOut(
            last_attempt_at=sync_row.last_attempt_at,
            last_success_at=sync_row.last_success_at,
            last_error=sync_row.last_error,
            last_count=sync_row.last_count,
        ) if sync_row else None,
        counts=MetaLeadCounts(**counts),
        leads=[_lead_out(lead) for lead in leads],
    )


@router.get("/admin/meta-leads", response_model=MetaLeadListOut)
async def list_meta_leads(
    request: Request,
    campus_key: str = Query(min_length=1, max_length=32),
    status_filter: LeadStatus = Query(default="new", alias="status"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> MetaLeadListOut:
    """這校的名單（新的：舊到新；處理過的：新到舊，最多 200 筆）與拉取狀態。"""
    require_scope(current_user, "booking.read", campus_keys=[campus_key])
    return await _list_out(db, request, campus_key, status_filter)


@router.get("/admin/meta-leads/pending", response_model=MetaLeadPendingOut)
async def pending_meta_leads(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> MetaLeadPendingOut:
    """看得到的各校還有幾筆新名單（側欄提示用）。"""
    require_scope(current_user, "booking.read")
    query = select(MetaLead.campus_key, func.count()).where(MetaLead.status == "new").group_by(MetaLead.campus_key)
    scope = campus_scope(current_user)
    if scope is not None:
        query = query.where(MetaLead.campus_key.in_(scope))
    return MetaLeadPendingOut(campuses=dict((await db.execute(query)).all()))


@router.post("/admin/meta-leads/sync", response_model=MetaLeadListOut)
async def sync_meta_leads(
    payload: MetaLeadSyncIn,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> MetaLeadListOut:
    """立即拉這一校（不等每分鐘的自動拉取）。失敗寫在回應的 sync.last_error，不回錯誤碼。"""
    require_scope(current_user, "booking.handle", campus_keys=[payload.campus_key])
    if not _configured(request, payload.campus_key):
        raise _error(status.HTTP_409_CONFLICT, "META_LEADS_NOT_CONFIGURED", "這校還沒接上 Meta 名單")
    results = await sync_leads(
        request.app.state.session_factory, request.app.state.settings,
        campus_keys=[payload.campus_key], transport=_transport(request),
    )
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="meta_leads.sync",
        target_type="meta_lead_page",
        target_id=payload.campus_key,
        campus_key=payload.campus_key,
        metadata={
            "new_leads": results[0].count if results else 0,
            "sync_failed": not results or results[0].error is not None,
        },
    )
    await db.commit()
    return await _list_out(db, request, payload.campus_key, "new")


@router.post("/admin/meta-leads/{lead_id}/dismiss", response_model=MetaLeadOut)
async def dismiss_meta_lead(
    lead_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> MetaLeadOut:
    """不轉成案件（例如打不通、重複、只是問問），收到「略過」；隨時可以放回。"""
    lead = await service.lock_lead(db, current_user, lead_id, "booking.handle")
    try:
        await service.dismiss(db, lead, current_user)
    except service.LeadStatusConflict:
        raise _status_conflict() from None
    await db.commit()
    return _lead_out(lead)


@router.post("/admin/meta-leads/{lead_id}/restore", response_model=MetaLeadOut)
async def restore_meta_lead(
    lead_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> MetaLeadOut:
    lead = await service.lock_lead(db, current_user, lead_id, "booking.handle")
    try:
        await service.restore(db, lead, current_user)
    except service.LeadStatusConflict:
        raise _status_conflict() from None
    await db.commit()
    return _lead_out(lead)
