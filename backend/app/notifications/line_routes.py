"""LINE 群組推播：webhook（記錄 bot 所在的群組）與後台設定。

設定流程：官方帳號開啟 Messaging API 與 webhook（網址見後台「LINE 通知」頁）
→ 把官方帳號拉進各校員工群組 → 後台替每校選群組 → 按「送測試訊息」確認。"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone

import httpx

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import require_scope
from app.campuses.models import CAMPUS_KEYS, Campus
from app.common import ratelimit
from app.notifications import line as line_api
from app.notifications.models import LineCampusTarget, LineGroup
from app.notifications.service import campus_line_target, line_text
from app.operations import audit_service

logger = logging.getLogger("app.line")

router = APIRouter(prefix="/api/website/v1", tags=["line"])

WEBHOOK_PATH = "/api/website/v1/line/webhook"
# 測試推播會用掉官方帳號的每月則數，限制一下誤按連點。
TEST_PUSH_LIMIT = ratelimit.Limit("line_test_push", window_seconds=600, max_per_window=5)
_SEEN_EVENTS = {"join", "message", "memberJoined", "memberLeft", "follow", "postback"}


def _client(request: Request) -> line_api.LineMessagingClient:
    settings = request.app.state.settings
    return line_api.LineMessagingClient(
        settings.line_messaging_access_token,
        transport=getattr(request.app.state, "line_transport", None),
    )


def _target(event: dict) -> tuple[str, str] | None:
    source = event.get("source")
    if not isinstance(source, dict):
        return None
    source_type = source.get("type")
    target_id = source.get("groupId") if source_type == "group" else source.get("roomId") if source_type == "room" else None
    if not isinstance(target_id, str) or not line_api.TARGET_ID_RE.match(target_id):
        return None
    return source_type, target_id


@router.post("/line/webhook", include_in_schema=False)
async def line_webhook(request: Request, db: AsyncSession = Depends(get_db_session)) -> dict:
    """LINE 平台呼叫的 webhook。只處理群組／多人聊天室的進出，用來知道 bot
    在哪些群組；不存任何訊息內容，也不回覆。簽章不符一律拒絕。"""
    settings = request.app.state.settings
    if not settings.line_messaging_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    body = await request.body()
    if not line_api.verify_signature(
        settings.line_messaging_channel_secret, body, request.headers.get("x-line-signature")
    ):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="簽章不符")
    try:
        payload = json.loads(body)
        events = payload.get("events", []) if isinstance(payload, dict) else []
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="格式錯誤") from exc

    now = datetime.now(timezone.utc)
    unnamed: set[str] = set()
    for event in events if isinstance(events, list) else []:
        if not isinstance(event, dict):
            continue
        found = _target(event)
        if found is None:
            continue
        source_type, target_id = found
        group = await db.get(LineGroup, target_id)
        if event.get("type") == "leave":
            if group is not None and group.left_at is None:
                group.left_at = now
            continue
        if event.get("type") not in _SEEN_EVENTS:
            continue
        if group is None:
            group = LineGroup(
                target_id=target_id, source_type=source_type, first_seen_at=now, last_seen_at=now
            )
            db.add(group)
        group.last_seen_at = now
        group.left_at = None
        if group.name is None and source_type == "group":
            unnamed.add(target_id)
    await db.commit()

    # 群組名稱只是方便後台辨認，拿不到就算了；放在 commit 之後，LINE API
    # 慢或失敗都不影響已記下的群組。
    if unnamed:
        async with _client(request) as client:
            for target_id in unnamed:
                name = await client.group_name(target_id)
                if name:
                    group = await db.get(LineGroup, target_id)
                    if group is not None and group.name is None:
                        group.name = name
        await db.commit()
    return {}


class LineGroupOut(BaseModel):
    target_id: str
    source_type: str
    name: str | None
    first_seen_at: datetime
    last_seen_at: datetime
    left_at: datetime | None


class LineCampusTargetOut(BaseModel):
    campus_key: str
    campus_name: str
    target_id: str | None


class LineSettingsOut(BaseModel):
    enabled: bool
    webhook_url: str | None
    groups: list[LineGroupOut]
    targets: list[LineCampusTargetOut]


class LineCampusTargetUpdate(BaseModel):
    target_id: str | None


async def _settings_out(request: Request, db: AsyncSession) -> LineSettingsOut:
    settings = request.app.state.settings
    groups = (await db.execute(select(LineGroup).order_by(LineGroup.first_seen_at))).scalars().all()
    # 依全站固定順序（義華、明華、崇德、國際、仁武），不照 key 的字母排。
    order = {key: index for index, key in enumerate(CAMPUS_KEYS)}
    campuses = sorted(
        (await db.execute(select(Campus))).scalars().all(), key=lambda c: (order.get(c.key, len(order)), c.key)
    )
    mapping = dict((await db.execute(select(LineCampusTarget.campus_key, LineCampusTarget.target_id))).all())
    return LineSettingsOut(
        enabled=settings.line_messaging_enabled,
        webhook_url=f"{settings.admin_origin.rstrip('/')}{WEBHOOK_PATH}" if settings.admin_origin else None,
        groups=[LineGroupOut.model_validate(g, from_attributes=True) for g in groups],
        targets=[
            LineCampusTargetOut(campus_key=c.key, campus_name=c.name, target_id=mapping.get(c.key))
            for c in campuses
        ],
    )


@router.get("/admin/line", response_model=LineSettingsOut)
async def get_line_settings(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> LineSettingsOut:
    require_scope(current_user, "notifications.manage")
    return await _settings_out(request, db)


async def _campus(db: AsyncSession, campus_key: str) -> Campus:
    campus = (await db.execute(select(Campus).where(Campus.key == campus_key))).scalar_one_or_none()
    if campus is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個校區")
    return campus


@router.put("/admin/line/campus-targets/{campus_key}", response_model=LineSettingsOut)
async def update_line_campus_target(
    campus_key: str,
    payload: LineCampusTargetUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> LineSettingsOut:
    require_scope(current_user, "notifications.manage")
    await _campus(db, campus_key)
    existing = await db.get(LineCampusTarget, campus_key, with_for_update=True)
    before = existing.target_id if existing else None
    if payload.target_id is None:
        if existing is not None:
            await db.delete(existing)
    else:
        group = await db.get(LineGroup, payload.target_id)
        if group is None or group.left_at is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"code": "LINE_GROUP_UNAVAILABLE", "message": "官方帳號不在這個群組裡，請重新把它拉進群組"},
            )
        now = datetime.now(timezone.utc)
        if existing is None:
            db.add(
                LineCampusTarget(
                    campus_key=campus_key, target_id=group.target_id, updated_at=now, updated_by=current_user.id
                )
            )
        else:
            existing.target_id = group.target_id
            existing.updated_at = now
            existing.updated_by = current_user.id
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="line.campus_target.update",
        target_type="campus",
        target_id=campus_key,
        campus_key=campus_key,
        metadata={"before": before, "after": payload.target_id},
    )
    await db.commit()
    return await _settings_out(request, db)


@router.post("/admin/line/campus-targets/{campus_key}/test", status_code=status.HTTP_204_NO_CONTENT)
async def send_line_test_message(
    campus_key: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> None:
    """送一則測試訊息到這校指定的群組，確認設定真的通。"""
    require_scope(current_user, "notifications.manage")
    settings = request.app.state.settings
    if not settings.line_messaging_enabled:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "LINE_NOT_CONFIGURED", "message": "尚未設定 LINE 官方帳號的 Messaging API 金鑰"},
        )
    campus = await _campus(db, campus_key)
    target = await campus_line_target(db, campus_key)
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "LINE_TARGET_MISSING", "message": "這個校區還沒有指定 LINE 群組"},
        )
    try:
        await ratelimit.limiter(request).check(TEST_PUSH_LIMIT, str(current_user.id))
    except ratelimit.RateLimited as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "RATE_LIMITED", "message": "測試訊息送太多次了，請稍後再試"},
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc

    text = line_text("LINE 通知測試：之後這校的參觀案件通知會送到這個群組", campus.name, None, None)
    try:
        async with _client(request) as client:
            await client.push_text(target, text, key=uuid.uuid4())
    except (line_api.LinePushError, httpx.HTTPError) as exc:
        logger.warning("LINE 測試推播失敗：%s", type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "LINE_PUSH_FAILED", "message": "LINE 推播失敗，請確認金鑰與官方帳號仍在群組裡"},
        ) from exc
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="line.test_push",
        target_type="campus",
        target_id=campus_key,
        campus_key=campus_key,
    )
    await db.commit()
