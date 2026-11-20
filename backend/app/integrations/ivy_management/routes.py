"""園務系統定期拉官網招生資料的唯讀端點。只在 settings.ivy_sync_enabled 時由 main.create_app 掛上，
沒開就是 404。驗證是機器金鑰（auth.py），不用後台 session；不寫稽核表（園務每幾十分鐘拉一次，會洗版），
成功只記一行結構化 INFO log。"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_db_session
from app.common.timezones import now_utc, today_local
from app.integrations.ivy_management import service
from app.integrations.ivy_management.auth import require_integration_key
from app.integrations.ivy_management.cursor import Cursor, InvalidCursor
from app.integrations.ivy_management.schemas import LeadsPage

logger = logging.getLogger("app.integrations.ivy_management")

router = APIRouter(prefix="/api/website/v1/integrations/ivy-management", tags=["integrations"])

DEFAULT_LIMIT = 200
MAX_LIMIT = 200


@router.get("/leads", response_model=LeadsPage)
async def list_leads(
    response: Response,
    campus_key: str = Depends(require_integration_key),
    cursor: str | None = Query(default=None, description="上一頁回傳的 next_cursor；不透明字串，不要自己組"),
    limit: int = Query(default=DEFAULT_LIMIT, ge=1, le=MAX_LIMIT),
    db: AsyncSession = Depends(get_db_session),
) -> LeadsPage:
    """一校的 lead 清單（官網預約＋沒有預約的招生訪視），游標分頁，取到 next_cursor 為 null 為止。"""
    # 驗證通過才解游標：沒有金鑰的人不該從 422 摸到端點的行為。
    try:
        position = Cursor.decode(cursor) if cursor is not None else None
    except InvalidCursor:
        raise HTTPException(
            status_code=422,
            detail={"code": "INVALID_CURSOR", "message": "cursor 格式不正確，請從第一頁重新取"},
        ) from None
    as_of = now_utc()
    items, next_cursor = await service.fetch_page(
        db, campus_key, limit=limit, cursor=position, today=today_local(as_of)
    )
    response.headers["Cache-Control"] = "no-store"
    logger.info(
        "園務同步取資料：campus=%s count=%d last_page=%s", campus_key, len(items), next_cursor is None
    )
    return LeadsPage(campus_key=campus_key, as_of=as_of, items=items, next_cursor=next_cursor)
