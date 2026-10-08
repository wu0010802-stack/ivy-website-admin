"""2026-09-29 白箱稽核修補（ops 包）：

- public-telemetry-analytics-storage-flood：telemetry 與公開點擊除了單一來源
  限流，另有全站每分鐘與每日上限；超過時安靜丟棄（仍回 204），資料照留不刪。
- line-webhook-nonascii-signature-500：X-Line-Signature 含非 ASCII 字元回
  一般的 401，不是未處理的 500。
- line-group-registration-unverified：群組要在群組裡貼上後台產生的一次性驗證碼
  才能被選為校區推播目標；既有綁定照常運作。
- publish-old-revision-skips-schema-revalidation：立即發布、核准、建立排程與
  排程到期都用目前的欄位規則重驗這一版。
"""
from __future__ import annotations

import time
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import func, select, update

from app.auth.models import Role, User
from app.common.ratelimit import RateLimiter
from app.content import service as content_service
from app.content.models import ContentItem, ContentRevision, PublishJob
from app.content.publish_jobs import run_due_jobs
from app.main import create_app
from app.notifications.line import verify_signature
from app.notifications.models import LineCampusTarget, LineGroup, LineGroupVerificationCode
from app.notifications.service import campus_line_target
from app.operations.models import AnalyticsEvent, AuditLogEntry, PageViewDaily, WebVitalSample
from tests.conftest import _create_user, _logged_in_client, _test_settings
from tests.test_line_notifications import (  # noqa: F401 - fake_line／line_app 是 fixture
    GROUP,
    OTHER_GROUP,
    ROOM,
    _event,
    _sign,
    _super_admin,
    _webhook,
    fake_line,
    line_app,
)

API = "/api/website/v1"
TELEMETRY = f"{API}/public/telemetry"
CLICKS = f"{API}/public/analytics-events"
CODES = f"{API}/admin/line/verification-codes"


# --- telemetry／點擊的全站上限 ---------------------------------------------------


async def _capped_app(**overrides):
    """指定上限的 app；限流時鐘固定，測試不會剛好跨過分鐘界線而多放幾筆。"""
    app = create_app(_test_settings().model_copy(update=overrides))
    frozen = time.time()
    app.state.rate_limiter = RateLimiter(app.state.engine, app.state.settings.session_secret, clock=lambda: frozen)
    return app


def _from(index: int) -> dict:
    # 每次換一個來源 IP：單一來源的限流不會先擋下來，量到的是全站上限。
    return {"x-website-client-ip": f"203.0.113.{index}"}


def _view() -> dict:
    return {"event": "page_view", "page": "campus", "campus": "yihua", "device": "mobile"}


def _vital() -> dict:
    return {"event": "LCP", "page": "home", "campus": None, "device": "desktop", "value": 1200, "id": str(uuid.uuid4())}


def _click() -> dict:
    return {"event_type": "cta_click_line", "campus_key": "yihua", "event_id": str(uuid.uuid4())}


async def _post_all(app, url: str, bodies: list[dict]) -> list[int]:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        return [(await client.post(url, json=body, headers=_from(i))).status_code for i, body in enumerate(bodies)]


@pytest.mark.asyncio
async def test_telemetry_global_minute_cap_drops_silently(db_session):
    app = await _capped_app(telemetry_global_per_minute=3)
    try:
        codes = await _post_all(app, TELEMETRY, [_view() for _ in range(6)])
    finally:
        await app.state.engine.dispose()
    assert codes == [204] * 6, "超過全站上限要安靜丟棄，不回 429（多個來源 IP 都在各自的限額內）"
    assert await db_session.scalar(select(func.sum(PageViewDaily.views))) == 3


@pytest.mark.asyncio
async def test_telemetry_daily_cap_bounds_vitals_and_page_views_together(db_session):
    app = await _capped_app(telemetry_global_per_minute=1000, telemetry_daily_cap=4)
    try:
        codes = await _post_all(app, TELEMETRY, [_vital(), _vital(), _vital(), _view(), _view(), _vital()])
    finally:
        await app.state.engine.dispose()
    assert codes == [204] * 6
    samples = await db_session.scalar(select(func.count()).select_from(WebVitalSample))
    views = await db_session.scalar(select(func.coalesce(func.sum(PageViewDaily.views), 0)))
    assert (samples, views) == (3, 1)


@pytest.mark.asyncio
async def test_visit_click_telemetry_does_not_use_up_the_daily_cap(db_session):
    """visit_click 不寫資料庫，不該吃掉會寫入的事件的額度。"""
    app = await _capped_app(telemetry_global_per_minute=1000, telemetry_daily_cap=1)
    click = {"event": "visit_click", "page": "visit", "campus": "renwu", "device": "mobile"}
    try:
        codes = await _post_all(app, TELEMETRY, [click, click, _view()])
    finally:
        await app.state.engine.dispose()
    assert codes == [204] * 3
    assert await db_session.scalar(select(func.sum(PageViewDaily.views))) == 1


@pytest.mark.asyncio
async def test_click_global_minute_cap_drops_silently(db_session):
    app = await _capped_app(analytics_clicks_global_per_minute=2)
    try:
        codes = await _post_all(app, CLICKS, [_click() for _ in range(5)])
    finally:
        await app.state.engine.dispose()
    assert codes == [204] * 5
    assert await db_session.scalar(select(func.count()).select_from(AnalyticsEvent)) == 2


@pytest.mark.asyncio
async def test_click_daily_cap_drops_silently(db_session):
    app = await _capped_app(analytics_clicks_global_per_minute=1000, analytics_clicks_daily_cap=3)
    try:
        codes = await _post_all(app, CLICKS, [_click() for _ in range(5)])
    finally:
        await app.state.engine.dispose()
    assert codes == [204] * 5
    assert await db_session.scalar(select(func.count()).select_from(AnalyticsEvent)) == 3


@pytest.mark.asyncio
async def test_single_source_limits_still_answer_429():
    """全站上限是另加的一層；單一來源超量仍回 429，讓正常的客戶端知道要退避。"""
    app = await _capped_app()
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            clicks = [(await client.post(CLICKS, json=_click(), headers=_from(7))).status_code for _ in range(21)]
    finally:
        await app.state.engine.dispose()
    assert clicks[:20] == [204] * 20 and clicks[20] == 429


class _MovableClock:
    def __init__(self, now: float) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


@pytest.mark.asyncio
async def test_single_source_cannot_use_up_the_daily_cap(db_session, monkeypatch):
    """稽核 telemetry-daily-cap-silent-blackout：少數來源就能用光全站每日上限，
    之後所有真實瀏覽量被安靜丟棄。全站每日上限之前先有每來源每日上限。"""
    from app.common import ratelimit
    from app.operations import public_caps

    monkeypatch.setattr(
        public_caps, "TELEMETRY_SOURCE_DAILY", ratelimit.Limit("telemetry_source_daily", 86_400, 2, sliding=False)
    )
    app = await _capped_app(telemetry_global_per_minute=1000, telemetry_daily_cap=7)
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            flood = [(await client.post(TELEMETRY, json=_view(), headers=_from(9))).status_code for _ in range(6)]
            # 同一個 IPv6 /64 換位址不算新來源。
            flood += [
                (await client.post(TELEMETRY, json=_view(), headers={"x-website-client-ip": f"2001:db8:9:9::{i}"})).status_code
                for i in range(1, 4)
            ]
            real = [(await client.post(TELEMETRY, json=_view(), headers=_from(10 + i))).status_code for i in range(3)]
    finally:
        await app.state.engine.dispose()
    assert flood == [204] * 9 and real == [204] * 3
    # 灌的兩個來源各只進 2 筆，真實訪客的 3 筆全部進得去（沒有每來源上限時，
    # 灌的 9 筆會先用光全站每日上限 7，真實訪客一筆都進不去）。
    assert await db_session.scalar(select(func.sum(PageViewDaily.views))) == 2 + 2 + 3


@pytest.mark.asyncio
async def test_daily_cap_does_not_carry_over_to_the_next_utc_day(db_session):
    """每日上限原本走滑動窗口，前一天灌滿會把隔天台北早上 8 點起的額度一起壓低。"""
    from app.common.ratelimit import RateLimiter

    app = create_app(_test_settings().model_copy(update={"telemetry_global_per_minute": 1000, "telemetry_daily_cap": 2}))
    day = 86_400
    clock = _MovableClock((int(time.time()) // day) * day + 3_600)
    app.state.rate_limiter = RateLimiter(app.state.engine, app.state.settings.session_secret, clock=clock)
    try:
        first_day = await _post_all(app, TELEMETRY, [_view() for _ in range(3)])
        clock.now += day  # 隔天同一時間
        next_day = await _post_all(app, TELEMETRY, [_view() for _ in range(3)])
    finally:
        await app.state.engine.dispose()
    assert first_day == next_day == [204] * 3
    assert await db_session.scalar(select(func.sum(PageViewDaily.views))) == 4


@pytest.mark.asyncio
async def test_cap_drops_are_logged_once_per_window(db_session, caplog):
    """稽核 telemetry-cap-silent-drop：上限滿了安靜丟棄，但營運端要看得到。"""
    app = await _capped_app(telemetry_global_per_minute=2)
    try:
        await _post_all(app, TELEMETRY, [_view() for _ in range(6)])
    finally:
        await app.state.engine.dispose()
    drops = [r for r in caplog.records if r.levelname == "WARNING" and "telemetry_global" in r.getMessage()]
    assert len(drops) == 1, [r.getMessage() for r in drops]


# --- LINE webhook 簽章 ----------------------------------------------------------


def test_verify_signature_rejects_non_ascii_instead_of_raising():
    body = b'{"events":[]}'
    good = _sign(body)
    assert verify_signature("line-channel-secret-for-tests", body, good)
    for bad in ("\xe9" + good[1:], good + "\xe9", "é"):
        assert verify_signature("line-channel-secret-for-tests", body, bad) is False


@pytest.mark.asyncio
async def test_webhook_non_ascii_signature_is_401_not_500(line_app):
    body = b'{"destination":"U00000000000000000000000000000000","events":[]}'
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=line_app), base_url="http://test") as client:
        response = await client.post(
            f"{API}/line/webhook",
            content=body,
            headers={"content-type": "application/json", "x-line-signature": b"\xe9" + _sign(body)[1:].encode()},
        )
    assert response.status_code == 401


# --- LINE 群組驗證 --------------------------------------------------------------


async def _code(client: httpx.AsyncClient) -> str:
    resp = await client.post(CODES)
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert set(body) == {"code", "expires_at"}
    return body["code"]


def _said(text: str, target: str = GROUP) -> dict:
    return _event("message", target, message={"type": "text", "id": "1", "text": text})


async def _group(app, target: str) -> LineGroup | None:
    async with app.state.session_factory() as db:
        return await db.get(LineGroup, target)


@pytest.mark.asyncio
async def test_unverified_group_cannot_be_assigned(line_app):
    await _webhook(line_app, [_event("join")])
    client = await _super_admin(line_app)
    try:
        listed = (await client.get(f"{API}/admin/line")).json()
        assert listed["groups"][0]["verified_at"] is None
        resp = await client.put(f"{API}/admin/line/campus-targets/yihua", json={"target_id": GROUP})
        assert resp.status_code == 409
        assert resp.json()["detail"]["code"] == "LINE_GROUP_UNVERIFIED"
    finally:
        await client.aclose()
    async with line_app.state.session_factory() as db:
        assert (await db.execute(select(LineCampusTarget))).scalars().all() == []


@pytest.mark.asyncio
async def test_code_posted_in_group_verifies_it_once(line_app):
    await _webhook(line_app, [_event("join"), _event("join", OTHER_GROUP)])
    client = await _super_admin(line_app)
    try:
        code = await _code(client)
        # 一對一聊天、錯的碼都不算；也不影響之後在群組裡貼正確的碼。
        await _webhook(line_app, [
            {"type": "message", "source": {"type": "user", "userId": "U" + "1" * 32},
             "message": {"type": "text", "text": code}},
            _said("IVY-00000000"),
        ])
        assert (await _group(line_app, GROUP)).verified_at is None

        await _webhook(line_app, [_said(f"後台驗證碼：{code.lower()} 謝謝")])
        assert (await _group(line_app, GROUP)).verified_at is not None

        # 一次性：同一個碼貼到另一個群組不會讓那個群組也通過。
        await _webhook(line_app, [_said(code, OTHER_GROUP)])
        assert (await _group(line_app, OTHER_GROUP)).verified_at is None

        listed = (await client.get(f"{API}/admin/line")).json()
        verified = {g["target_id"]: g["verified_at"] for g in listed["groups"]}
        assert verified[GROUP] is not None and verified[OTHER_GROUP] is None

        assigned = await client.put(f"{API}/admin/line/campus-targets/yihua", json={"target_id": GROUP})
        assert assigned.status_code == 200, assigned.text
        other = await client.put(f"{API}/admin/line/campus-targets/minghua", json={"target_id": OTHER_GROUP})
        assert other.status_code == 409 and other.json()["detail"]["code"] == "LINE_GROUP_UNVERIFIED"
    finally:
        await client.aclose()

    async with line_app.state.session_factory() as db:
        rows = (await db.execute(select(LineGroupVerificationCode))).scalars().all()
        actions = (await db.execute(select(AuditLogEntry.action, AuditLogEntry.metadata_json))).all()
    assert len(rows) == 1 and rows[0].used_at is not None and rows[0].used_target_id == GROUP
    # 只存雜湊；稽核也不記驗證碼本身。
    assert code.upper() not in rows[0].code_hash and code.upper().replace("IVY-", "") not in rows[0].code_hash
    assert [a for a, _ in actions].count("line.verification_code.create") == 1
    assert [a for a, _ in actions].count("line.group.verify") == 1
    assert all(code.upper() not in str(meta).upper() for _, meta in actions)


@pytest.mark.asyncio
async def test_expired_code_does_not_verify(line_app):
    await _webhook(line_app, [_event("join", ROOM)])
    client = await _super_admin(line_app)
    try:
        code = await _code(client)
    finally:
        await client.aclose()
    async with line_app.state.session_factory() as db:
        await db.execute(
            update(LineGroupVerificationCode).values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1))
        )
        await db.commit()
    await _webhook(line_app, [_said(code, ROOM)])
    assert (await _group(line_app, ROOM)).verified_at is None


@pytest.mark.asyncio
async def test_code_expires_after_ten_minutes(line_app):
    client = await _super_admin(line_app)
    try:
        before = datetime.now(timezone.utc)
        resp = await client.post(CODES)
    finally:
        await client.aclose()
    expires_at = datetime.fromisoformat(resp.json()["expires_at"])
    assert timedelta(minutes=9) < expires_at - before <= timedelta(minutes=10, seconds=5)


@pytest.mark.asyncio
async def test_issuing_codes_needs_manage_permission_and_line_configured(line_app, app):
    async with line_app.state.session_factory() as db:
        await _create_user(db, "mh-line@ivy.example", "minghua-admin-password-123", Role.CAMPUS_ADMIN, ["minghua"])
    campus_admin = await _logged_in_client(line_app, "mh-line@ivy.example", "minghua-admin-password-123")
    try:
        assert (await campus_admin.post(CODES)).status_code == 403
    finally:
        await campus_admin.aclose()

    # 沒設定 Messaging API 時 webhook 收不到訊息，驗證碼沒有用處。
    async with app.state.session_factory() as db:
        await _create_user(db, "super-noline@ivy.example", "super-admin-password-123", Role.SUPER_ADMIN)
    unconfigured = await _logged_in_client(app, "super-noline@ivy.example", "super-admin-password-123")
    try:
        resp = await unconfigured.post(CODES)
        assert resp.status_code == 409 and resp.json()["detail"]["code"] == "LINE_NOT_CONFIGURED"
    finally:
        await unconfigured.aclose()


@pytest.mark.asyncio
async def test_issuing_codes_is_rate_limited(line_app):
    client = await _super_admin(line_app)
    try:
        codes = [(await client.post(CODES)).status_code for _ in range(11)]
    finally:
        await client.aclose()
    assert codes[:10] == [201] * 10 and codes[10] == 429


@pytest.mark.asyncio
async def test_existing_binding_to_unverified_group_keeps_working(line_app):
    """修補前綁好的群組不改資料：照常收推播，重存同一個設定也不會被擋。"""
    now = datetime.now(timezone.utc)
    async with line_app.state.session_factory() as db:
        db.add(LineGroup(target_id=GROUP, source_type="group", name="義華校務群", first_seen_at=now, last_seen_at=now))
        db.add(LineGroup(target_id=OTHER_GROUP, source_type="group", name="總部", first_seen_at=now, last_seen_at=now))
        await db.flush()
        db.add(LineCampusTarget(campus_key="yihua", target_id=GROUP, updated_at=now))
        await db.commit()
        assert await campus_line_target(db, "yihua") == GROUP

    client = await _super_admin(line_app)
    try:
        same = await client.put(f"{API}/admin/line/campus-targets/yihua", json={"target_id": GROUP})
        assert same.status_code == 200, same.text
        switch = await client.put(f"{API}/admin/line/campus-targets/yihua", json={"target_id": OTHER_GROUP})
        assert switch.status_code == 409 and switch.json()["detail"]["code"] == "LINE_GROUP_UNVERIFIED"
        cleared = await client.put(f"{API}/admin/line/campus-targets/yihua", json={"target_id": None})
        assert cleared.status_code == 200
    finally:
        await client.aclose()


# --- 發布前重驗欄位規則 ----------------------------------------------------------

NEWS = f"{API}/admin/content-items/campus_news"
Q = "?campus_key=yihua"
_UNSAFE = "javascript:alert(document.domain)"


async def _outdated_revision(db) -> ContentRevision:
    """模擬規則收緊前存下、現在過不了驗證的舊版本（直接寫 DB，繞過存檔驗證）。"""
    item = await content_service.get_or_create_content_item(db, "campus_news", "yihua")
    revision = await content_service.create_revision(
        db, item, {"events": [{"id": "event-1", "date": "2026-11-01", "title": "參觀要預約嗎？", "description": _UNSAFE}]}, item.latest_version, None
    )
    await db.commit()
    return revision


async def _is_live(db, revision_id: uuid.UUID) -> bool:
    item = (await db.execute(select(ContentItem).where(ContentItem.kind == "campus_news"))).scalar_one()
    await db.refresh(item)
    return item.current_published_revision_id == revision_id


@pytest.mark.asyncio
async def test_publish_revalidates_old_revision(admin_client, db_session, public_client):
    revision = await _outdated_revision(db_session)
    resp = await admin_client.post(f"{NEWS}/publish{Q}", json={"revision_id": str(revision.id)})
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "CONTENT_SCHEMA_OUTDATED"
    assert not await _is_live(db_session, revision.id)
    site = await public_client.get(f"{API}/public/site")
    assert _UNSAFE not in site.text


@pytest.mark.asyncio
async def test_approve_revalidates_pending_revision(admin_client, db_session):
    revision = await _outdated_revision(db_session)
    await db_session.execute(
        update(ContentRevision).where(ContentRevision.id == revision.id).values(review_status="pending_review")
    )
    await db_session.commit()
    resp = await admin_client.post(f"{NEWS}/review{Q}", json={"revision_id": str(revision.id), "decision": "approve"})
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "CONTENT_SCHEMA_OUTDATED"
    assert not await _is_live(db_session, revision.id)


@pytest.mark.asyncio
async def test_schedule_creation_revalidates_revision(admin_client, db_session):
    revision = await _outdated_revision(db_session)
    resp = await admin_client.post(
        f"{NEWS}/schedules{Q}",
        json={"revision_id": str(revision.id), "publish_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()},
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "CONTENT_SCHEMA_OUTDATED"
    assert await db_session.scalar(select(func.count()).select_from(PublishJob)) == 0


@pytest.mark.asyncio
async def test_due_schedule_with_outdated_revision_fails_once(admin_client, db_session):
    """排好之後規則才收緊：到期時標記失敗並寫明原因，不會每一輪重試。"""
    revision = await _outdated_revision(db_session)
    admin = (await db_session.execute(select(User).where(User.email == "admin@ivy.example"))).scalar_one()
    now = datetime.now(timezone.utc)
    job = PublishJob(
        id=uuid.uuid4(), content_item_id=revision.content_item_id, revision_id=revision.id,
        publish_at=now - timedelta(minutes=1), status="scheduled", created_by=admin.id, created_at=now - timedelta(hours=1),
    )
    db_session.add(job)
    await db_session.commit()

    assert await run_due_jobs(db_session) == {"published": 0, "failed": 1, "skipped": 0}
    assert await run_due_jobs(db_session) == {"published": 0, "failed": 0, "skipped": 0}
    await db_session.refresh(job)
    assert job.status == "failed"
    assert "欄位格式已經過時" in job.error
    assert not await _is_live(db_session, revision.id)
