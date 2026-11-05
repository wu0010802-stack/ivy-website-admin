"""後台手機推播（Web Push）的訂閱管理（2026-11-05）。

員工把後台加到手機主畫面（PWA）、在「我的帳號」按「開啟通知」後，瀏覽器把訂閱（endpoint＋兩把公開金鑰）
送到這裡存起來；新預約與網站錯誤發生時由 notifications/service.py、error_alerts.py 對訂閱送推播。

- 全部要登入；寫入類走 get_current_user 內建的 CSRF／Origin 檢查。
- 只有「會收到任何推播」的人可以訂閱：具 booking.handle 的角色（含總管理者）；其他 403。推播沒設定金鑰回 409。
- API 與 log 都不回傳 endpoint 與金鑰（知道 endpoint 的人能對那台裝置丟通知）。
- endpoint 只收白名單內的推播服務（vapid.endpoint_allowed，防 SSRF），訂閱時驗一次、送出前再驗一次。"""

from __future__ import annotations

import re
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import case, delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import require_scope
from app.common import ratelimit
from app.common.timezones import now_utc
from app.notifications import vapid, web_push
from app.notifications.models import PushSubscription

router = APIRouter(prefix="/api/website/v1", tags=["push"])

# 每人最多幾台裝置；超過時刪掉最舊的（新的一台一定留著）。
MAX_DEVICES_PER_USER = 10
# 測試通知會真的打到推播服務，連點限制一下：每人每分鐘 3 次。
TEST_PUSH_LIMIT = ratelimit.Limit("push_test", window_seconds=60, max_per_window=3)
# 推播能力＝能處理參觀案件（和新預約通知的收件人同一個定義）；總管理者在這個角色集合裡。
CAPABILITY = "booking.handle"
TEST_PAYLOAD = {
    "title": "測試通知",
    "body": "這台裝置已開啟後台通知，有新的參觀預約時會在這裡提醒。",
    "url": "/admin/account",
    "tag": "push-test",
}


def _not_configured() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"code": "PUSH_NOT_CONFIGURED", "message": "尚未設定手機推播的金鑰"},
    )


def device_label(user_agent: str | None) -> str:
    """由 User-Agent 推得的裝置名稱，畫面上讓人認得是哪一台。iPhone／iPad 只有從主畫面開啟才能訂閱
    （iOS 16.4 起的限制），所以直接寫「主畫面」。"""
    ua = user_agent or ""
    if re.search(r"iPhone|iPod", ua):
        return "iPhone（主畫面）"
    if "iPad" in ua:
        return "iPad（主畫面）"
    if "Android" in ua:
        system = "Android"
    elif "Windows" in ua:
        system = "Windows"
    elif "CrOS" in ua:
        system = "Chromebook"
    elif "Macintosh" in ua or "Mac OS X" in ua:
        system = "Mac"
    elif "Linux" in ua:
        system = "Linux"
    else:
        return "其他裝置"
    # Edge／Opera／Samsung 的 UA 也含 Chrome，先判斷它們；Chrome 的 UA 也含 Safari，所以 Safari 最後判斷。
    for needle, browser in (
        ("Edg", "Edge"),
        ("OPR", "Opera"),
        ("SamsungBrowser", "Samsung 瀏覽器"),
        ("Firefox", "Firefox"),
        ("Chrome", "Chrome"),
        ("Safari", "Safari"),
    ):
        if needle in ua:
            return f"{system} {browser}"
    return system


class PushConfigOut(BaseModel):
    enabled: bool
    # 公鑰本來就要給瀏覽器（applicationServerKey），不是秘密；沒啟用時不回。
    public_key: str | None


class PushSubscriptionKeys(BaseModel):
    model_config = ConfigDict(extra="forbid")

    p256dh: str = Field(min_length=1, max_length=200)
    auth: str = Field(min_length=1, max_length=100)


class PushSubscriptionIn(BaseModel):
    model_config = ConfigDict(extra="ignore")  # 瀏覽器的 PushSubscription.toJSON() 另有 expirationTime

    endpoint: str = Field(min_length=1, max_length=vapid.ENDPOINT_MAX_LENGTH)
    keys: PushSubscriptionKeys


class PushEndpointIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    endpoint: str = Field(min_length=1, max_length=vapid.ENDPOINT_MAX_LENGTH)


class PushDeviceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    device_label: str
    created_at: datetime
    last_success_at: datetime | None


class PushTestOut(BaseModel):
    sent: int
    failed: int


def _require_capable(user: User) -> None:
    require_scope(user, CAPABILITY)


@router.get("/admin/push/config", response_model=PushConfigOut)
async def get_push_config(request: Request, current_user: User = Depends(get_current_user)) -> PushConfigOut:
    settings = request.app.state.settings
    enabled = settings.web_push_enabled
    return PushConfigOut(enabled=enabled, public_key=settings.vapid_public_key if enabled else None)


@router.get("/admin/push/subscriptions", response_model=list[PushDeviceOut])
async def list_my_devices(
    current_user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db_session)
) -> list[PushSubscription]:
    result = await db.execute(
        select(PushSubscription)
        .where(PushSubscription.user_id == current_user.id)
        .order_by(PushSubscription.created_at, PushSubscription.id)
    )
    return list(result.scalars())


@router.post("/admin/push/subscriptions", response_model=PushDeviceOut, status_code=status.HTTP_201_CREATED)
async def subscribe(
    payload: PushSubscriptionIn,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> PushSubscription:
    _require_capable(current_user)
    if not request.app.state.settings.web_push_enabled:
        raise _not_configured()
    if not vapid.endpoint_allowed(payload.endpoint):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "PUSH_ENDPOINT_NOT_ALLOWED", "message": "不支援這個瀏覽器的通知服務"},
        )
    try:
        p256dh = vapid.b64url_encode(vapid.public_key_point(payload.keys.p256dh))
        auth = vapid.b64url_encode(vapid.auth_secret(payload.keys.auth))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "PUSH_KEYS_INVALID", "message": "通知金鑰格式不正確"},
        ) from exc

    now = now_utc()
    label = device_label(request.headers.get("user-agent"))
    values = {
        "user_id": current_user.id,
        "p256dh": p256dh,
        "auth": auth,
        "device_label": label,
        "failure_count": 0,
        "last_failure_at": None,
    }
    stmt = insert(PushSubscription).values(
        id=uuid.uuid4(), endpoint=payload.endpoint, created_at=now, **values
    )
    # 同一個 endpoint 只會有一列（同一台裝置換人登入就改綁）。原本就是這個人的，開啟日期不變。
    stmt = stmt.on_conflict_do_update(
        index_elements=[PushSubscription.endpoint],
        set_={
            **values,
            "created_at": case(
                (PushSubscription.user_id == stmt.excluded.user_id, PushSubscription.created_at),
                else_=stmt.excluded.created_at,
            ),
        },
    ).returning(PushSubscription.id)
    subscription_id = (await db.execute(stmt)).scalar_one()
    # 超過上限就刪最舊的；剛訂閱的這一台一定留著。
    surplus = (
        select(PushSubscription.id)
        .where(PushSubscription.user_id == current_user.id, PushSubscription.id != subscription_id)
        .order_by(PushSubscription.created_at.desc(), PushSubscription.id.desc())
        .offset(MAX_DEVICES_PER_USER - 1)
    )
    await db.execute(delete(PushSubscription).where(PushSubscription.id.in_(surplus)))
    await db.commit()
    subscription = await db.get(PushSubscription, subscription_id, populate_existing=True)
    assert subscription is not None
    return subscription


@router.post("/admin/push/subscriptions/remove", status_code=status.HTTP_204_NO_CONTENT)
async def unsubscribe_this_device(
    payload: PushEndpointIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    """這台裝置關閉通知：刪掉自己的那一筆（別人的 endpoint 刪不到；找不到也回 204）。"""
    await db.execute(
        delete(PushSubscription).where(
            PushSubscription.endpoint == payload.endpoint, PushSubscription.user_id == current_user.id
        )
    )
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/admin/push/subscriptions/{subscription_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_device(
    subscription_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    result = await db.execute(
        delete(PushSubscription)
        .where(PushSubscription.id == subscription_id, PushSubscription.user_id == current_user.id)
        .returning(PushSubscription.id)
    )
    if result.first() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個項目")
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/admin/push/test", response_model=PushTestOut)
async def send_test_push(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> PushTestOut:
    """送一則「測試通知」給自己所有的裝置，確認手機真的收得到。"""
    _require_capable(current_user)
    settings = request.app.state.settings
    if not settings.web_push_enabled:
        raise _not_configured()
    try:
        await ratelimit.limiter(request).check(TEST_PUSH_LIMIT, str(current_user.id))
    except ratelimit.RateLimited as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "RATE_LIMITED", "message": "測試通知送太多次了，請稍後再試"},
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc
    subscriptions = await web_push.subscriptions_of(db, [current_user.id])
    if not subscriptions:
        return PushTestOut(sent=0, failed=0)
    async with web_push.new_client(getattr(request.app.state, "push_transport", None)) as client:
        results = await web_push.deliver(db, subscriptions, TEST_PAYLOAD, settings=settings, client=client)
    await db.commit()
    sent = sum(result.outcome == "ok" for result in results)
    return PushTestOut(sent=sent, failed=len(results) - sent)
