"""後台：LINE 圖文選單（2026-11-28，docs/specs/2026-11-28-line-apis-design.md §4）。"""

from __future__ import annotations

from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import require_scope
from app.common import ratelimit
from app.config import LineAccountCredentials
from app.notifications import line_rich_menus
from app.notifications.line_routes import LineSettingsOut, _settings_out

router = APIRouter(prefix="/api/website/v1", tags=["line"])

# LINE 建立、刪除選單各限每小時 100 次；一次套用最多建 2 個、刪 2 個。
RICH_MENU_LIMIT = ratelimit.Limit("line_rich_menu", window_seconds=600, max_per_window=6)


class LineRichMenuUpdate(BaseModel):
    # all＝所有好友（會蓋掉 LINE Official Account Manager 設的選單）、booked＝只給已預約的家長、None＝不使用。
    mode: Literal["all", "booked"] | None


class LineRichMenuAreaOut(BaseModel):
    label: str
    clicks: int
    users: int


class LineRichMenuKindOut(BaseModel):
    kind: Literal["default", "booked"]
    # False＝LINE 沒給數字：點的人不到 20 位，或剛建好還沒統計。
    available: bool
    impressions: int | None = None
    impression_users: int | None = None
    areas: list[LineRichMenuAreaOut] = []


class LineRichMenuInsightOut(BaseModel):
    # UTC+9 的日期；to_date＝昨天。
    from_date: date
    to_date: date
    menus: list[LineRichMenuKindOut]
    # 查 LINE 失敗：HTTP 狀態碼（401＝金鑰失效），連不上是 0。
    error_status: int | None = None


def _account(request: Request, account_key: str) -> LineAccountCredentials:
    account = request.app.state.settings.line_accounts.get(account_key)
    if account is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個官方帳號")
    return account


@router.put("/admin/line/accounts/{account_key}/rich-menu", response_model=LineSettingsOut)
async def update_line_rich_menu(
    account_key: str,
    payload: LineRichMenuUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> LineSettingsOut:
    """替這個官方帳號建立、重建或停用程式管理的圖文選單。重送同一個模式＝照現在的內容重建（校區改了電話或地址之後用）。"""
    require_scope(current_user, "notifications.manage")
    account = _account(request, account_key)
    try:
        await ratelimit.limiter(request).check(RICH_MENU_LIMIT, str(current_user.id))
    except ratelimit.RateLimited as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "RATE_LIMITED", "message": "圖文選單改太多次了，請稍後再試"},
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc
    settings = request.app.state.settings
    transport = getattr(request.app.state, "line_transport", None)
    actor_id = current_user.id
    if payload.mode is None:
        await line_rich_menus.remove(db, account, actor_user_id=actor_id, transport=transport)
    else:
        try:
            await line_rich_menus.apply(
                db, settings, account, payload.mode, actor_user_id=actor_id, transport=transport
            )
        except line_rich_menus.RichMenuUnavailable as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"code": "LINE_RICH_MENU_UNAVAILABLE", "message": "還沒設定官網網址，不能建立圖文選單"},
            ) from exc
        except line_rich_menus.RichMenuFailed as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail={"code": "LINE_RICH_MENU_FAILED", "message": "LINE 沒有建立成功，請稍後再試"},
            ) from exc
    return await _settings_out(request, db)


@router.get("/admin/line/accounts/{account_key}/rich-menu/insight", response_model=LineRichMenuInsightOut)
async def get_line_rich_menu_insight(
    account_key: str,
    request: Request,
    days: int = Query(28, ge=7, le=90),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> LineRichMenuInsightOut:
    """各版選單近 N 天顯示幾次、每一格被點幾次（LINE 的統計，隔天才有；點的人不到 20 位時沒有數字）。"""
    require_scope(current_user, "notifications.manage")
    account = _account(request, account_key)
    result = await line_rich_menus.insight(
        db, request.app.state.settings, account, days, getattr(request.app.state, "line_transport", None)
    )
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="這個官方帳號沒有程式建立的圖文選單")
    return LineRichMenuInsightOut(**result)
