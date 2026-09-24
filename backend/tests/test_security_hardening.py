"""2026-09-24 安全掃描報告修補的回歸測試（每個測試註明對應的問題）。"""
from __future__ import annotations

import asyncio
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import func, select, update

from app.auth.models import Role, User
from app.booking.access_models import ParentSession
from app.booking.models import OutboxMessage, OutboxStatus, VisitContactNote, VisitRequest, VisitRequestStatus
from app.media.models import MediaAsset, MediaStatus
from app.operations import retention_service
from tests.conftest import _create_user, _logged_in_client


async def _enable_slots(admin_client, campus_key="yihua", auto_confirm=True) -> int:
    current = await admin_client.get(f"/api/website/v1/admin/booking-config/{campus_key}")
    resp = await admin_client.patch(
        f"/api/website/v1/admin/booking-config/{campus_key}",
        json={"expected_version": current.json()["version"], "mode": "slots", "slots_auto_confirm": auto_confirm},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["version"]


async def _create_slot(admin_client, campus_key="yihua", capacity=1, days_ahead=3) -> dict:
    resp = await admin_client.post(
        f"/api/website/v1/admin/slots?campus_key={campus_key}",
        json={
            "slot_date": (date.today() + timedelta(days=days_ahead)).isoformat(),
            "start_time": "10:00:00",
            "end_time": "11:00:00",
            "capacity": capacity,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _payload(campus_key, version, slot_id=None, *, parent_name="陳媽媽", phone="0912345678") -> dict:
    body = {
        "campus_key": campus_key,
        "config_version": version,
        "parent_name": parent_name,
        "phone": phone,
        "age": "3-4",
        "preferred_time": None,
        "questions": None,
        "consent_given": True,
    }
    if slot_id is not None:
        body["slot_id"] = slot_id
    return body


async def _expire_hold(db_session, receipt_id: str) -> None:
    await db_session.execute(
        update(VisitRequest)
        .where(VisitRequest.id == uuid.UUID(receipt_id))
        .values(hold_expires_at=datetime.now(timezone.utc) - timedelta(minutes=1))
    )
    await db_session.commit()


# --- #1 逾期占位 -------------------------------------------------------------


@pytest.mark.asyncio
async def test_expired_hold_does_not_occupy_capacity_before_cleanup(
    admin_client, public_client, second_public_client, db_session
):
    version = await _enable_slots(admin_client, auto_confirm=False)
    slot = await _create_slot(admin_client, capacity=1)
    first = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_payload("yihua", version, slot["id"]),
        headers={"Idempotency-Key": "expired-hold-a"},
    )
    assert first.status_code == 201, first.text
    await _expire_hold(db_session, first.json()["receipt_id"])

    # 清理排程沒跑，名額也不能被到期占位卡住。
    second = await second_public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_payload("yihua", version, slot["id"], phone="0987654321"),
        headers={"Idempotency-Key": "expired-hold-b"},
    )
    assert second.status_code == 201, second.text


@pytest.mark.asyncio
async def test_process_notifications_releases_holds_without_email_sink(
    app, admin_client, public_client, db_session, monkeypatch
):
    from app import cli

    version = await _enable_slots(admin_client, auto_confirm=False)
    slot = await _create_slot(admin_client, capacity=1)
    created = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_payload("yihua", version, slot["id"]),
        headers={"Idempotency-Key": "expired-hold-cli"},
    )
    receipt_id = created.json()["receipt_id"]
    await _expire_hold(db_session, receipt_id)

    settings = app.state.settings.model_copy(update={"notification_email_sink_dir": None})
    monkeypatch.setattr(cli, "get_settings", lambda: settings)

    async def factory():
        return app.state.session_factory

    monkeypatch.setattr(cli, "_session_factory", factory)
    await cli.process_notifications_once()

    detail = await admin_client.get(f"/api/website/v1/admin/visit-requests/{receipt_id}")
    assert detail.json()["status"] == VisitRequestStatus.CANCELLED.value


# --- #8 CSV 前導控制字元 -----------------------------------------------------


@pytest.mark.asyncio
async def test_csv_export_neutralises_formula_after_leading_control_chars(admin_client, public_client):
    version = await _enable_slots(admin_client)
    slot = await _create_slot(admin_client, capacity=3)
    for index, name in enumerate(["\t=HYPERLINK(\"http://x\")", " +1+1", "\r@SUM(A1)"]):
        resp = await public_client.post(
            "/api/website/v1/public/visit-requests",
            json=_payload("yihua", version, slot["id"], parent_name=name, phone=f"091234567{index}"),
            headers={"Idempotency-Key": f"csv-control-{index}"},
        )
        assert resp.status_code == 201, resp.text

    export = await admin_client.get("/api/website/v1/admin/visit-requests/export?campus_key=yihua")
    assert export.status_code == 200
    assert "'\t=HYPERLINK" in export.text
    assert "' +1+1" in export.text
    assert "'\r@SUM" in export.text


# --- #9 預留角色不可讀案件個資 ------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("role", [Role.EDITOR, Role.READONLY])
async def test_editor_and_readonly_cannot_list_visit_requests(app, db_session, role):
    email = f"{role.value}@ivy.example"
    await _create_user(db_session, email, "reserved-role-password-1", role, campus_keys=["yihua"])
    client = await _logged_in_client(app, email, "reserved-role-password-1")
    try:
        listing = await client.get("/api/website/v1/admin/visit-requests?campus_key=yihua")
        assert listing.status_code == 403
        # 去識別的漏斗統計仍可看。
        funnel = await client.get("/api/website/v1/admin/analytics/funnel?campus_key=yihua")
        assert funnel.status_code == 200
        dashboard = await client.get("/api/website/v1/admin/dashboard")
        assert dashboard.status_code == 200
        assert dashboard.json()["today_visit_list"] == []
    finally:
        await client.aclose()


# --- #10/#12/#23 限流：改存 DB，行為測試在 test_rate_limits.py ------------


# --- #14 共用通知已讀需要管理權 ------------------------------------------------


def test_marking_shared_notification_read_requires_manage():
    from app.auth.permissions import has_capability

    reception = User(role=Role.RECEPTION)
    assert has_capability(reception, "booking.read")
    assert not has_capability(reception, "booking.manage")


# --- #13/#15/#19 家長存取 -----------------------------------------------------


async def _confirmed_booking_with_spare_slot(admin_client, public_client):
    version = await _enable_slots(admin_client, auto_confirm=True)
    slot_a = await _create_slot(admin_client, capacity=2, days_ahead=3)
    slot_b = await _create_slot(admin_client, capacity=2, days_ahead=4)
    created = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_payload("yihua", version, slot_a["id"]),
        headers={"Idempotency-Key": "parent-hardening"},
    )
    assert created.status_code == 201, created.text
    receipt_id = created.json()["receipt_id"]
    link = await admin_client.post(f"/api/website/v1/admin/visit-requests/{receipt_id}/access-link")
    token = link.json()["manage_url_fragment"].split("token=")[1]
    return receipt_id, token, slot_b["id"]


@pytest.mark.asyncio
async def test_repeated_exchange_keeps_parent_sessions_bounded(admin_client, public_client, db_session):
    from app.booking.access_service import MAX_ACTIVE_SESSIONS_PER_REQUEST

    receipt_id, token, _ = await _confirmed_booking_with_spare_slot(admin_client, public_client)
    for _ in range(MAX_ACTIVE_SESSIONS_PER_REQUEST + 5):
        resp = await public_client.post("/api/website/v1/public/visit-manage/exchange", json={"token": token})
        assert resp.status_code == 200
    count = await db_session.execute(
        select(func.count()).select_from(ParentSession).where(ParentSession.visit_request_id == uuid.UUID(receipt_id))
    )
    assert count.scalar_one() == MAX_ACTIVE_SESSIONS_PER_REQUEST
    # 最新換到的 session 仍可用。
    assert (await public_client.get("/api/website/v1/public/visit-manage/me")).status_code == 200


async def _blocks_until_first_commits(first_session, second_call) -> asyncio.Task:
    """第一個交易已寫入但尚未提交時啟動第二個操作，確認它在等鎖。"""
    task = asyncio.create_task(second_call)
    await asyncio.sleep(0.5)
    assert not task.done(), "第二個交易沒有等第一個交易的鎖"
    await first_session.commit()
    return task


@pytest.mark.asyncio
async def test_concurrent_reschedule_requests_serialize_on_visit_request(app, admin_client, public_client):
    from app.booking import access_service

    receipt_id, _, slot_b_id = await _confirmed_booking_with_spare_slot(admin_client, public_client)
    factory = app.state.session_factory
    async with factory() as first, factory() as second:
        request_a = await first.get(VisitRequest, uuid.UUID(receipt_id))
        request_b = await second.get(VisitRequest, uuid.UUID(receipt_id))
        await access_service.create_reschedule_request(first, request_a, uuid.UUID(slot_b_id))
        task = await _blocks_until_first_commits(
            first, access_service.create_reschedule_request(second, request_b, uuid.UUID(slot_b_id))
        )
        with pytest.raises(access_service.RescheduleNotAllowed) as exc:
            await task
        assert exc.value.code == "RESCHEDULE_PENDING"
        await second.rollback()


@pytest.mark.asyncio
async def test_revoke_during_exchange_revokes_the_new_session(app, admin_client, public_client):
    """#13：交換已通過 token 檢查但尚未提交時撤銷，提交後新 session 也要失效。"""
    from app.booking import access_service

    receipt_id, token, _ = await _confirmed_booking_with_spare_slot(admin_client, public_client)
    factory = app.state.session_factory
    async with factory() as first, factory() as second:
        raw_session, _ = await access_service.exchange_token(first, token)
        task = await _blocks_until_first_commits(
            first, access_service.revoke_access_for_visit_request(second, uuid.UUID(receipt_id))
        )
        await task
        await second.commit()
    async with factory() as check:
        assert await access_service.get_visit_request_for_session(check, raw_session) is None


# --- #16 登出 CSRF ----------------------------------------------------------


@pytest.mark.asyncio
async def test_logout_requires_csrf_and_does_not_clear_cookie_without_session(admin_client, public_client):
    csrf = admin_client.headers.pop("x-csrf-token")
    forged = await admin_client.post("/api/website/v1/auth/logout")
    assert forged.status_code == 403
    assert "set-cookie" not in forged.headers
    assert (await admin_client.get("/api/website/v1/auth/me")).status_code == 200

    anonymous = await public_client.post("/api/website/v1/auth/logout")
    assert anonymous.status_code == 204
    assert "set-cookie" not in anonymous.headers

    admin_client.headers["x-csrf-token"] = csrf
    real = await admin_client.post("/api/website/v1/auth/logout")
    assert real.status_code == 204
    assert (await admin_client.get("/api/website/v1/auth/me")).status_code == 401


# --- #21 儀表板失敗通知依校區 ------------------------------------------------


@pytest.mark.asyncio
async def test_dashboard_failed_notifications_are_campus_scoped(
    admin_client, minghua_client, public_client, db_session
):
    for campus_key, phone in (("yihua", "0911111111"), ("minghua", "0922222222")):
        current = await admin_client.get(f"/api/website/v1/admin/booking-config/{campus_key}")
        config = await admin_client.patch(
            f"/api/website/v1/admin/booking-config/{campus_key}",
            json={"expected_version": current.json()["version"], "mode": "inquiry"},
        )
        resp = await public_client.post(
            "/api/website/v1/public/visit-requests",
            json=_payload(campus_key, config.json()["version"], phone=phone),
            headers={"Idempotency-Key": f"failed-outbox-{campus_key}"},
        )
        assert resp.status_code == 201, resp.text
    await db_session.execute(update(OutboxMessage).values(status=OutboxStatus.FAILED.value))
    await db_session.commit()
    total = (await db_session.execute(select(func.count()).select_from(OutboxMessage))).scalar_one()
    minghua_total = (
        await db_session.execute(
            select(func.count())
            .select_from(OutboxMessage)
            .join(VisitRequest, OutboxMessage.visit_request_id == VisitRequest.id)
            .where(VisitRequest.campus_key == "minghua")
        )
    ).scalar_one()
    assert 0 < minghua_total < total

    assert (await minghua_client.get("/api/website/v1/admin/dashboard")).json()["failed_notifications"] == minghua_total
    assert (await admin_client.get("/api/website/v1/admin/dashboard")).json()["failed_notifications"] == total


# --- #26 並行停權不能停掉所有總管理者 ------------------------------------------


@pytest.mark.asyncio
async def test_concurrent_deactivation_keeps_one_super_admin(app, admin_client, db_session):
    from app.auth import service as auth_service

    second = await _create_user(db_session, "second-admin@ivy.example", "second-admin-password-123", Role.SUPER_ADMIN)
    first_id = uuid.UUID((await admin_client.get("/api/website/v1/auth/me")).json()["user"]["id"])
    factory = app.state.session_factory
    async with factory() as tx_a, factory() as tx_b:
        user_a = await tx_a.get(User, first_id)
        user_b = await tx_b.get(User, second.id)
        await auth_service.set_user_active(tx_a, user_a, False)
        task = await _blocks_until_first_commits(tx_a, auth_service.set_user_active(tx_b, user_b, False))
        with pytest.raises(auth_service.LastSuperAdminProtected):
            await task
        await tx_b.rollback()


# --- #3/#29 內容輸入 --------------------------------------------------------


@pytest.mark.asyncio
async def test_content_text_fields_are_bounded(admin_client):
    resp = await admin_client.post(
        "/api/website/v1/admin/content-items/campus_faq/revisions?campus_key=yihua",
        json={"expected_version": 0, "payload": {"items": [{"q": "問題", "a": "長" * 2001}]}},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize("image", ["__proto__", "constructor.name", "../x"])
async def test_tour_image_code_rejects_non_asset_keys(admin_client, image):
    scene = {
        "key": "hall", "name": "大廳", "image": image, "intro": "介紹",
        "spots": [{"name": "櫃台", "x": 50, "y": 50, "text": "說明", "question": "問題"}],
    }
    resp = await admin_client.post(
        "/api/website/v1/admin/content-items/campus_tour/revisions?campus_key=yihua",
        json={"expected_version": 0, "payload": {"scenes": [scene]}},
    )
    assert resp.status_code == 422


# --- #4 本文上限 -------------------------------------------------------------


@pytest.mark.asyncio
async def test_oversized_json_body_rejected_before_parsing(public_client):
    resp = await public_client.post(
        "/api/website/v1/public/visit-requests",
        content=b"{" + b" " * (1024 * 1024 + 10) + b"}",
        headers={"Content-Type": "application/json", "Idempotency-Key": "too-big"},
    )
    assert resp.status_code == 413


@pytest.mark.asyncio
async def test_anonymous_media_upload_rejected_before_reading_body(public_client):
    resp = await public_client.post(
        "/api/website/v1/admin/media",
        data={"kind": "image"},
        files={"file": ("x.jpg", b"\xff" * 4096, "image/jpeg")},
    )
    assert resp.status_code == 401


# --- #2 素材配額與失敗原檔 ---------------------------------------------------


@pytest.mark.asyncio
async def test_failed_video_processing_removes_original(app, admin_client, db_session):
    fake_mp4 = b"\x00\x00\x00\x18ftypmp42" + b"\x00" * 2048
    resp = await admin_client.post(
        "/api/website/v1/admin/media",
        data={"kind": "video", "campus_key": "yihua"},
        files={"file": ("fake.mp4", fake_mp4, "video/mp4")},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["status"] == MediaStatus.FAILED.value
    asset = (await db_session.execute(select(MediaAsset).where(MediaAsset.id == uuid.UUID(resp.json()["id"])))).scalar_one()
    assert not (Path(app.state.settings.media_root) / asset.storage_key).exists()


@pytest.mark.asyncio
async def test_campus_media_quota_enforced(app, admin_client):
    image = Path("/tmp/media-fixtures/test.jpg").read_bytes()
    app.state.settings.media_quota_bytes_per_campus = len(image) + 10
    first = await admin_client.post(
        "/api/website/v1/admin/media",
        data={"kind": "image", "campus_key": "yihua"},
        files={"file": ("a.jpg", image, "image/jpeg")},
    )
    assert first.status_code == 201, first.text
    second = await admin_client.post(
        "/api/website/v1/admin/media",
        data={"kind": "image", "campus_key": "yihua"},
        files={"file": ("b.jpg", image, "image/jpeg")},
    )
    assert second.status_code == 409
    assert second.json()["detail"]["code"] == "MEDIA_QUOTA_EXCEEDED"
    # 其他校區各自一份配額。
    other = await admin_client.post(
        "/api/website/v1/admin/media",
        data={"kind": "image", "campus_key": "minghua"},
        files={"file": ("c.jpg", image, "image/jpeg")},
    )
    assert other.status_code == 201, other.text


# --- #27 匿名化清除聯絡紀錄 --------------------------------------------------


@pytest.mark.asyncio
async def test_retention_anonymizes_contact_notes(admin_client, public_client, db_session):
    version = await _enable_slots(admin_client)
    slot = await _create_slot(admin_client)
    created = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_payload("yihua", version, slot["id"]),
        headers={"Idempotency-Key": "retention-note"},
    )
    receipt_id = created.json()["receipt_id"]
    note = await admin_client.post(
        f"/api/website/v1/admin/visit-requests/{receipt_id}/contact-notes",
        json={"note": "陳媽媽 0912345678 說週三可以", "follow_up_at": None},
    )
    assert note.status_code == 201, note.text
    cancel = await admin_client.post(f"/api/website/v1/admin/visit-requests/{receipt_id}/cancel")
    assert cancel.status_code == 200, cancel.text
    await db_session.execute(
        update(VisitRequest)
        .where(VisitRequest.id == uuid.UUID(receipt_id))
        .values(created_at=datetime.now(timezone.utc) - timedelta(days=400))
    )
    await db_session.commit()

    await retention_service.run_retention_sweep(db_session, dry_run=False)
    await db_session.commit()

    notes = (
        await db_session.execute(
            select(VisitContactNote.note).where(VisitContactNote.visit_request_id == uuid.UUID(receipt_id))
        )
    ).scalars().all()
    assert notes == [retention_service.ANONYMIZED_NOTE]


# --- #24 家長取消與園方結案併發 ------------------------------------------------


@pytest.mark.asyncio
async def test_cancel_waits_for_concurrent_no_show_and_keeps_terminal_state(app, admin_client, public_client):
    from app.booking import workflow_service

    receipt_id, _, _ = await _confirmed_booking_with_spare_slot(admin_client, public_client)
    factory = app.state.session_factory
    async with factory() as staff, factory() as parent:
        staff_view = await staff.get(VisitRequest, uuid.UUID(receipt_id))
        parent_view = await parent.get(VisitRequest, uuid.UUID(receipt_id))
        await workflow_service.mark_no_show(staff, staff_view)
        task = await _blocks_until_first_commits(staff, workflow_service.cancel(parent, parent_view))
        with pytest.raises(workflow_service.InvalidTransition):
            await task
        await parent.rollback()
    detail = await admin_client.get(f"/api/website/v1/admin/visit-requests/{receipt_id}")
    assert detail.json()["status"] == VisitRequestStatus.NO_SHOW.value
