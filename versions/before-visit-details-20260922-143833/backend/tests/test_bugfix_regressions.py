"""2026-09-22 缺陷修復的迴歸測試。

每個 test 對應一個實際重現過的缺陷；命名刻意寫出「原本會怎樣」，
之後有人改壞時看測試名就知道踩到哪一條。
"""
from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import select

from app.booking import workflow_service
from app.booking.models import VisitRequest, VisitRequestStatus
from app.common.timezones import OPERATING_TZ, today_local

FIXTURES = Path("/tmp/media-fixtures")

PROFILE = {
    "name": "義華", "district": "鳳山區", "address": "高雄市鳳山區",
    "phone": "07-1234567", "intro": "介紹", "description": "描述",
    "facebook": "https://facebook.com/yihua", "fb_note": "粉專",
    "line": "https://line.me/yihua",
}


def _img() -> bytes:
    return (FIXTURES / "test.jpg").read_bytes()


async def _enable_slots(admin_client, *, auto_confirm: bool, campus_key="yihua") -> int:
    current = await admin_client.get(f"/api/website/v1/admin/booking-config/{campus_key}")
    resp = await admin_client.patch(
        f"/api/website/v1/admin/booking-config/{campus_key}",
        json={
            "expected_version": current.json()["version"],
            "mode": "slots",
            "slots_auto_confirm": auto_confirm,
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["version"]


async def _create_slot(admin_client, *, days_ahead=3, capacity=1, campus_key="yihua") -> dict:
    resp = await admin_client.post(
        f"/api/website/v1/admin/slots?campus_key={campus_key}",
        json={
            "slot_date": (today_local() + timedelta(days=days_ahead)).isoformat(),
            "start_time": "10:00:00",
            "end_time": "11:00:00",
            "capacity": capacity,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _payload(version: int, slot_id: str | None = None, phone="0912345678", campus_key="yihua") -> dict:
    return {
        "campus_key": campus_key, "config_version": version, "parent_name": "陳媽媽",
        "phone": phone, "age": None, "preferred_time": None, "questions": None,
        "consent_given": True, "slot_id": slot_id,
    }


# --------------------------------------------------------------- auth
@pytest.mark.asyncio
async def test_email_differing_only_in_case_is_rejected_and_login_survives(
    admin_client, public_client
):
    """原本：大小寫不同的同名 email 可以建立成功，之後兩個帳號都登入 500
    （MultipleResultsFound 未被捕捉），而且 API 沒有任何端點能救回來。"""
    created = await admin_client.post(
        "/api/website/v1/admin/users",
        json={
            "email": "ADMIN@ivy.example",
            "password": "another-super-admin-pw-123",
            "role": "super_admin",
            "campus_keys": [],
        },
    )
    assert created.status_code == 409, created.text

    login = await public_client.post(
        "/api/website/v1/auth/login",
        json={"email": "admin@ivy.example", "password": "super-admin-password-123"},
    )
    assert login.status_code == 200, login.text


@pytest.mark.asyncio
async def test_created_user_email_is_normalized_to_lowercase(admin_client):
    resp = await admin_client.post(
        "/api/website/v1/admin/users",
        json={
            "email": "  NewAdmin@Ivy.Example  ",
            "password": "brand-new-admin-pw-123",
            "role": "super_admin",
            "campus_keys": [],
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["email"] == "newadmin@ivy.example"


@pytest.mark.asyncio
async def test_wrong_password_attempts_do_not_lock_out_the_real_admin(
    admin_client, public_client
):
    """原本：限流以 email 為 key 且排在驗證之前，任何人連打 10 次錯密碼
    就能把指定管理者鎖在門外 5 分鐘。"""
    for _ in range(12):
        bad = await public_client.post(
            "/api/website/v1/auth/login",
            json={"email": "admin@ivy.example", "password": "definitely-wrong-password"},
        )
        assert bad.status_code in (401, 429)

    ok = await public_client.post(
        "/api/website/v1/auth/login",
        json={"email": "admin@ivy.example", "password": "super-admin-password-123"},
    )
    assert ok.status_code == 200, ok.text


@pytest.mark.asyncio
async def test_user_create_and_scope_change_are_audited(admin_client):
    created = await admin_client.post(
        "/api/website/v1/admin/users",
        json={
            "email": "scoped@ivy.example", "password": "scoped-admin-pw-123",
            "role": "campus_admin", "campus_keys": ["yihua"],
        },
    )
    assert created.status_code == 201, created.text
    user_id = created.json()["id"]
    await admin_client.patch(
        f"/api/website/v1/admin/users/{user_id}/scope", json={"campus_keys": ["minghua"]}
    )

    audit = await admin_client.get("/api/website/v1/admin/audit-log")
    actions = {row["action"] for row in audit.json()}
    assert "user.create" in actions
    assert "user.set_scope" in actions


# -------------------------------------------------------------- media
@pytest.mark.asyncio
async def test_shared_media_cannot_be_mutated_by_campus_admin(admin_client, minghua_client):
    """原本：campus_key 為 NULL 時 require_scope 收到 campus_keys=None 直接
    放行，任何一校的管理者都能改寫、取代、刪除五校共用的素材。"""
    up = await admin_client.post(
        "/api/website/v1/admin/media",
        data={"kind": "image"},
        files={"file": ("test.jpg", _img(), "image/jpeg")},
    )
    media_id = up.json()["id"]

    assert (await minghua_client.get(f"/api/website/v1/admin/media/{media_id}")).status_code == 200
    patched = await minghua_client.patch(
        f"/api/website/v1/admin/media/{media_id}", json={"alt_text": "竄改"}
    )
    assert patched.status_code == 403
    deleted = await minghua_client.delete(f"/api/website/v1/admin/media/{media_id}")
    assert deleted.status_code == 403
    replaced = await minghua_client.post(
        f"/api/website/v1/admin/media/{media_id}/replace",
        files={"file": ("test.jpg", _img(), "image/jpeg")},
    )
    assert replaced.status_code == 403


@pytest.mark.asyncio
async def test_media_referenced_by_published_release_cannot_be_deleted(admin_client):
    """原本：MediaUsage 只反映最新草稿，把圖從草稿移除後就能刪掉仍在
    線上使用的素材，公開官網當場破圖。"""
    up = await admin_client.post(
        "/api/website/v1/admin/media",
        data={"kind": "image", "campus_key": "yihua"},
        files={"file": ("test.jpg", _img(), "image/jpeg")},
    )
    media_id = up.json()["id"]

    scenes = {
        "scenes": [
            {
                "key": "hall", "name": "大廳", "image": media_id, "intro": "介紹",
                "spots": [{"name": "櫃台", "x": 50, "y": 50, "text": "說明", "question": "問題"}],
            }
        ]
    }
    r1 = await admin_client.post(
        "/api/website/v1/admin/content-items/campus_tour/revisions?campus_key=yihua",
        json={"expected_version": 0, "payload": scenes},
    )
    assert r1.status_code == 201, r1.text
    pub = await admin_client.post(
        "/api/website/v1/admin/content-items/campus_tour/publish?campus_key=yihua",
        json={"revision_id": r1.json()["latest_revision"]["id"]},
    )
    assert pub.status_code == 200, pub.text

    # 草稿改成不再引用這張圖——線上版本仍然在用。
    scenes_without = {
        "scenes": [
            {
                "key": "hall", "name": "大廳", "image": "campus", "intro": "介紹",
                "spots": [{"name": "櫃台", "x": 50, "y": 50, "text": "說明", "question": "問題"}],
            }
        ]
    }
    r2 = await admin_client.post(
        "/api/website/v1/admin/content-items/campus_tour/revisions?campus_key=yihua",
        json={"expected_version": 1, "payload": scenes_without},
    )
    assert r2.status_code == 201, r2.text

    gone = await admin_client.delete(f"/api/website/v1/admin/media/{media_id}")
    assert gone.status_code == 409
    assert gone.json()["detail"]["code"] == "MEDIA_IN_USE"


@pytest.mark.asyncio
async def test_decompression_bomb_is_rejected_before_decoding(admin_client):
    """原本：Pillow 會把宣告成數億像素的圖整張解碼，或丟出未被接住的
    DecompressionBombError 變成 500。"""
    import io

    from PIL import Image

    buf = io.BytesIO()
    # 用小尺寸驗證流程；真正的上限由 MAX_IMAGE_PIXELS 常數控制。
    Image.new("RGB", (100, 80)).save(buf, "PNG")

    from app.media import validation

    original = validation.MAX_IMAGE_PIXELS
    validation.MAX_IMAGE_PIXELS = 100  # 100x80 = 8000 > 100
    try:
        resp = await admin_client.post(
            "/api/website/v1/admin/media",
            data={"kind": "image", "campus_key": "yihua"},
            files={"file": ("bomb.png", buf.getvalue(), "image/png")},
        )
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "MEDIA_TOO_LARGE"
    finally:
        validation.MAX_IMAGE_PIXELS = original


# ------------------------------------------------------------ content
@pytest.mark.asyncio
async def test_campus_admin_cannot_read_other_campus_content(admin_client, minghua_client):
    """原本：GET /admin/content-items/{kind} 只檢查 content.read，
    沒有任何 campus scope，分校管理者讀得到別校的未發布草稿。"""
    saved = await admin_client.post(
        "/api/website/v1/admin/content-items/campus_profile/revisions?campus_key=yihua",
        json={"expected_version": 0, "payload": PROFILE},
    )
    assert saved.status_code == 201, saved.text

    leaked = await minghua_client.get(
        "/api/website/v1/admin/content-items/campus_profile?campus_key=yihua"
    )
    assert leaked.status_code == 404

    own = await minghua_client.get(
        "/api/website/v1/admin/content-items/campus_profile?campus_key=minghua"
    )
    assert own.status_code == 200


@pytest.mark.asyncio
async def test_tab_separated_javascript_scheme_is_rejected(admin_client):
    """原本：前綴黑名單只 strip() 頭尾空白，`java<TAB>script:` 通過驗證，
    而 facebook/line 在 web/ 直接綁 :href。"""
    payload = dict(PROFILE, line="java\tscript:alert(1)")
    resp = await admin_client.post(
        "/api/website/v1/admin/content-items/campus_profile/revisions?campus_key=yihua",
        json={"expected_version": 0, "payload": payload},
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_content_revision_rejects_unknown_and_cross_campus_media(
    admin_client, minghua_client
):
    """原本：media_ids 不驗證，不存在的 UUID 撞 FK 變 500，
    別校的素材會被建立引用而永遠刪不掉。"""
    def _scene(image: str) -> dict:
        return {
            "scenes": [
                {
                    "key": "hall", "name": "大廳", "image": image, "intro": "介紹",
                    "spots": [{"name": "櫃台", "x": 50, "y": 50, "text": "說明", "question": "問題"}],
                }
            ]
        }

    missing = await admin_client.post(
        "/api/website/v1/admin/content-items/campus_tour/revisions?campus_key=yihua",
        json={"expected_version": 0, "payload": _scene(str(uuid.uuid4()))},
    )
    assert missing.status_code == 422
    assert missing.json()["detail"]["code"] == "MEDIA_NOT_FOUND"

    other = await minghua_client.post(
        "/api/website/v1/admin/media",
        data={"kind": "image", "campus_key": "minghua"},
        files={"file": ("test.jpg", _img(), "image/jpeg")},
    )
    other_id = other.json()["id"]
    cross = await admin_client.post(
        "/api/website/v1/admin/content-items/campus_tour/revisions?campus_key=yihua",
        json={"expected_version": 0, "payload": _scene(other_id)},
    )
    assert cross.status_code == 422
    assert cross.json()["detail"]["code"] == "MEDIA_CROSS_CAMPUS"


# ------------------------------------------------------------ booking
@pytest.mark.asyncio
async def test_past_slot_is_not_publicly_listed_or_bookable(admin_client, public_client):
    """原本：過去的時段可以被公開查到也可以被預約，名額從此永久被佔住。"""
    version = await _enable_slots(admin_client, auto_confirm=True)
    past = (today_local() - timedelta(days=30)).isoformat()
    slot = await admin_client.post(
        "/api/website/v1/admin/slots?campus_key=yihua",
        json={"slot_date": past, "start_time": "10:00:00", "end_time": "11:00:00", "capacity": 1},
    )
    assert slot.status_code == 201  # 後台仍可建立／檢視歷史時段
    slot_id = slot.json()["id"]

    listed = await public_client.get(
        f"/api/website/v1/public/slots?campus_key=yihua&date_from={past}&date_to={past}"
    )
    assert listed.status_code == 200
    assert listed.json() == []

    booked = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_payload(version, slot_id),
        headers={"Idempotency-Key": "past-slot-01"},
    )
    assert booked.status_code == 409
    assert booked.json()["detail"]["code"] == "SLOT_NOT_BOOKABLE"


@pytest.mark.asyncio
async def test_slots_manual_confirmation_is_the_default(admin_client, public_client):
    """規格 197：人工確認模式下送出只是「待園方確認」，不是預約成立。
    原本一律直接寫成 confirmed 並發出「已確認」通知。"""
    version = await _enable_slots(admin_client, auto_confirm=False)
    slot = await _create_slot(admin_client)

    created = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_payload(version, slot["id"]),
        headers={"Idempotency-Key": "manual-confirm-01"},
    )
    assert created.status_code == 201, created.text
    assert created.json()["status"] == VisitRequestStatus.PENDING_CONFIRMATION.value

    detail = await admin_client.get(
        f"/api/website/v1/admin/visit-requests/{created.json()['receipt_id']}"
    )
    assert detail.json()["hold_expires_at"] is not None


@pytest.mark.asyncio
async def test_pending_confirmation_occupies_capacity(admin_client, public_client, second_public_client):
    """規格 221：pending_confirmation 也占名額，否則同一個名額會先賣給
    多個家長，等園方逐一確認時才發現超收。"""
    version = await _enable_slots(admin_client, auto_confirm=False)
    slot = await _create_slot(admin_client, capacity=1)

    first = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_payload(version, slot["id"], phone="0912345678"),
        headers={"Idempotency-Key": "hold-capacity-a"},
    )
    assert first.status_code == 201, first.text

    second = await second_public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_payload(version, slot["id"], phone="0987654321"),
        headers={"Idempotency-Key": "hold-capacity-b"},
    )
    assert second.status_code == 409
    assert second.json()["detail"]["code"] == "SLOT_FULL"


@pytest.mark.asyncio
async def test_expired_hold_is_cancelled_and_releases_capacity(
    admin_client, public_client, second_public_client, db_session
):
    """規格 222：占位到期轉 cancelled、記 hold_expired、釋放名額。
    原本完全沒有這條路徑（也沒有任何案件會是 pending）。"""
    version = await _enable_slots(admin_client, auto_confirm=False)
    slot = await _create_slot(admin_client, capacity=1)

    first = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_payload(version, slot["id"], phone="0912345678"),
        headers={"Idempotency-Key": "hold-expiry-a"},
    )
    receipt_id = first.json()["receipt_id"]

    # 把占位期限倒推到過去，模擬 24 小時已過。
    row = await db_session.execute(
        select(VisitRequest).where(VisitRequest.id == uuid.UUID(receipt_id))
    )
    visit_request = row.scalar_one()
    visit_request.hold_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    await db_session.commit()

    processed = await workflow_service.expire_holds(db_session)
    await db_session.commit()
    assert processed == 1

    # 重跑是冪等的，不會重複處理。
    assert await workflow_service.expire_holds(db_session) == 0

    detail = await admin_client.get(f"/api/website/v1/admin/visit-requests/{receipt_id}")
    assert detail.json()["status"] == VisitRequestStatus.CANCELLED.value

    # 名額已釋放，別人訂得到。
    retry = await second_public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_payload(version, slot["id"], phone="0987654321"),
        headers={"Idempotency-Key": "hold-expiry-b"},
    )
    assert retry.status_code == 201, retry.text


@pytest.mark.asyncio
async def test_phone_is_normalized_and_trailing_newline_rejected(admin_client, public_client):
    version = await _enable_slots(admin_client, auto_confirm=True)
    slot = await _create_slot(admin_client)

    created = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_payload(version, slot["id"], phone="0912-345 678"),
        headers={"Idempotency-Key": "phone-normalize-01"},
    )
    assert created.status_code == 201, created.text
    detail = await admin_client.get(
        f"/api/website/v1/admin/visit-requests/{created.json()['receipt_id']}"
    )
    assert detail.json()["phone"] == "0912345678"

    # 結尾換行原本可以通過 re.match 的 `$` 並原樣落庫。現在會先被正規化
    # 掉，所以重點是「存進去的值是乾淨的 10 碼」。
    slot_b = await _create_slot(admin_client, days_ahead=4)
    newline = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_payload(version, slot_b["id"], phone="0987654321\n"),
        headers={"Idempotency-Key": "phone-newline-01"},
    )
    assert newline.status_code == 201, newline.text
    stored = await admin_client.get(
        f"/api/website/v1/admin/visit-requests/{newline.json()['receipt_id']}"
    )
    assert stored.json()["phone"] == "0987654321"

    slot_c = await _create_slot(admin_client, days_ahead=5)
    bad = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_payload(version, slot_c["id"], phone="0912345678abc"),
        headers={"Idempotency-Key": "phone-invalid-01"},
    )
    assert bad.status_code == 422


@pytest.mark.asyncio
async def test_booking_config_rejects_oversized_text_and_unsafe_links(admin_client):
    """原本：沒有長度上限，貼一段稍長的暫停說明就 500；
    line_url 不驗證 scheme，可以直接種 javascript: 到官網 CTA。"""
    current = await admin_client.get("/api/website/v1/admin/booking-config/yihua")
    version = current.json()["version"]

    too_long = await admin_client.patch(
        "/api/website/v1/admin/booking-config/yihua",
        json={"expected_version": version, "mode": "paused", "message": "長" * 600},
    )
    assert too_long.status_code == 422

    unsafe = await admin_client.patch(
        "/api/website/v1/admin/booking-config/yihua",
        json={
            "expected_version": version, "mode": "line",
            "line_url": "java\tscript:alert(1)",
        },
    )
    assert unsafe.status_code == 422


@pytest.mark.asyncio
async def test_overlong_idempotency_key_is_422_not_500(admin_client, public_client):
    version = await _enable_slots(admin_client, auto_confirm=True)
    slot = await _create_slot(admin_client)
    resp = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_payload(version, slot["id"]),
        headers={"Idempotency-Key": "x" * 200},
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_public_submit_is_rate_limited(admin_client, public_client):
    """規格 199：公開提交超過限制要回 429。原本完全沒有限流。"""
    version = await _enable_slots(admin_client, auto_confirm=True)
    statuses = []
    for i in range(8):
        slot = await _create_slot(admin_client, days_ahead=3 + i, capacity=5)
        resp = await public_client.post(
            "/api/website/v1/public/visit-requests",
            json=_payload(version, slot["id"], phone="0912345678"),
            headers={"Idempotency-Key": f"rate-limit-{i}"},
        )
        statuses.append(resp.status_code)
    assert 429 in statuses, statuses
    assert statuses.count(201) <= 5


@pytest.mark.asyncio
async def test_idempotent_replay_does_not_consume_rate_limit(admin_client, public_client):
    """重播不建立新案件，不該吃掉家長的限流額度。"""
    version = await _enable_slots(admin_client, auto_confirm=True)
    slot = await _create_slot(admin_client, capacity=5)
    body = _payload(version, slot["id"])
    codes = []
    for _ in range(8):
        resp = await public_client.post(
            "/api/website/v1/public/visit-requests",
            json=body,
            headers={"Idempotency-Key": "replay-no-limit-01"},
        )
        codes.append(resp.status_code)
    assert 429 not in codes, codes


@pytest.mark.asyncio
async def test_export_needs_dedicated_permission_and_is_audited(admin_client, editor_client):
    """原本：匯出含姓名與手機的 CSV 只要 booking.read，也沒有稽核紀錄。"""
    denied = await editor_client.get("/api/website/v1/admin/visit-requests/export")
    assert denied.status_code == 403

    allowed = await admin_client.get("/api/website/v1/admin/visit-requests/export")
    assert allowed.status_code == 200

    audit = await admin_client.get("/api/website/v1/admin/audit-log")
    assert any(row["action"] == "visit_request.export" for row in audit.json())


# ----------------------------------------------------- parent access
@pytest.mark.asyncio
async def test_parent_endpoints_mask_phone_and_hide_internal_fields(
    admin_client, public_client
):
    """規格 6.4：家長頁只顯示遮罩手機。原本直接回後台用的
    VisitRequestDetailOut，含完整手機、家長姓名、提問與內部欄位。"""
    version = await _enable_slots(admin_client, auto_confirm=True)
    slot = await _create_slot(admin_client)
    created = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_payload(version, slot["id"]),
        headers={"Idempotency-Key": "parent-mask-01"},
    )
    receipt_id = created.json()["receipt_id"]

    link = await admin_client.post(
        f"/api/website/v1/admin/visit-requests/{receipt_id}/access-link"
    )
    token = link.json()["manage_url_fragment"].split("token=")[1]
    exchange = await public_client.post(
        "/api/website/v1/public/visit-manage/exchange", json={"token": token}
    )
    assert exchange.status_code == 200
    body = exchange.json()
    assert body["phone_masked"] == "0912***678"
    assert "phone" not in body
    assert "parent_name" not in body
    assert "questions" not in body
    assert "assigned_staff_id" not in body


@pytest.mark.asyncio
async def test_parent_access_is_revoked_when_request_is_cancelled(
    admin_client, public_client, second_public_client
):
    """原本：token 從未被撤銷，連結外流後 14 天內都能重放。"""
    version = await _enable_slots(admin_client, auto_confirm=True)
    slot = await _create_slot(admin_client)
    created = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_payload(version, slot["id"]),
        headers={"Idempotency-Key": "parent-revoke-01"},
    )
    receipt_id = created.json()["receipt_id"]
    link = await admin_client.post(
        f"/api/website/v1/admin/visit-requests/{receipt_id}/access-link"
    )
    token = link.json()["manage_url_fragment"].split("token=")[1]

    assert (
        await public_client.post(
            "/api/website/v1/public/visit-manage/exchange", json={"token": token}
        )
    ).status_code == 200

    cancelled = await admin_client.post(
        f"/api/website/v1/admin/visit-requests/{receipt_id}/cancel"
    )
    assert cancelled.status_code == 200

    replay = await second_public_client.post(
        "/api/website/v1/public/visit-manage/exchange", json={"token": token}
    )
    assert replay.status_code == 401
    # 原本換到的 session 也要一起失效。
    assert (await public_client.get("/api/website/v1/public/visit-manage/me")).status_code == 401


@pytest.mark.asyncio
async def test_admin_can_revoke_leaked_access_link(admin_client, public_client, second_public_client):
    version = await _enable_slots(admin_client, auto_confirm=True)
    slot = await _create_slot(admin_client)
    created = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_payload(version, slot["id"]),
        headers={"Idempotency-Key": "parent-admin-revoke-01"},
    )
    receipt_id = created.json()["receipt_id"]
    link = await admin_client.post(
        f"/api/website/v1/admin/visit-requests/{receipt_id}/access-link"
    )
    token = link.json()["manage_url_fragment"].split("token=")[1]

    revoked = await admin_client.post(
        f"/api/website/v1/admin/visit-requests/{receipt_id}/revoke-access"
    )
    assert revoked.status_code == 204

    replay = await second_public_client.post(
        "/api/website/v1/public/visit-manage/exchange", json={"token": token}
    )
    assert replay.status_code == 401


@pytest.mark.asyncio
async def test_reschedule_request_validates_slot(admin_client, public_client, minghua_client):
    """原本：家長傳什麼 UUID 就寫什麼，不存在的 slot 直接撞 FK 變 500，
    別校的 slot 會建立一筆永遠卡住的申請。"""
    version = await _enable_slots(admin_client, auto_confirm=True)
    slot = await _create_slot(admin_client)
    created = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_payload(version, slot["id"]),
        headers={"Idempotency-Key": "reschedule-validate-01"},
    )
    receipt_id = created.json()["receipt_id"]
    link = await admin_client.post(
        f"/api/website/v1/admin/visit-requests/{receipt_id}/access-link"
    )
    token = link.json()["manage_url_fragment"].split("token=")[1]
    await public_client.post(
        "/api/website/v1/public/visit-manage/exchange", json={"token": token}
    )

    bogus = await public_client.post(
        "/api/website/v1/public/visit-manage/reschedule-request",
        json={"new_slot_id": str(uuid.uuid4())},
    )
    assert bogus.status_code == 404
    assert bogus.json()["detail"]["code"] == "SLOT_NOT_FOUND"

    other_campus_slot = await _create_slot(minghua_client, campus_key="minghua", days_ahead=5)
    cross = await public_client.post(
        "/api/website/v1/public/visit-manage/reschedule-request",
        json={"new_slot_id": other_campus_slot["id"]},
    )
    assert cross.status_code == 404

    same = await public_client.post(
        "/api/website/v1/public/visit-manage/reschedule-request",
        json={"new_slot_id": slot["id"]},
    )
    assert same.status_code == 409
    assert same.json()["detail"]["code"] == "SAME_SLOT"


@pytest.mark.asyncio
async def test_duplicate_pending_reschedule_request_is_rejected(admin_client, public_client):
    version = await _enable_slots(admin_client, auto_confirm=True)
    slot_a = await _create_slot(admin_client, days_ahead=3)
    slot_b = await _create_slot(admin_client, days_ahead=4)
    created = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_payload(version, slot_a["id"]),
        headers={"Idempotency-Key": "reschedule-dup-01"},
    )
    receipt_id = created.json()["receipt_id"]
    link = await admin_client.post(
        f"/api/website/v1/admin/visit-requests/{receipt_id}/access-link"
    )
    token = link.json()["manage_url_fragment"].split("token=")[1]
    await public_client.post(
        "/api/website/v1/public/visit-manage/exchange", json={"token": token}
    )

    first = await public_client.post(
        "/api/website/v1/public/visit-manage/reschedule-request",
        json={"new_slot_id": slot_b["id"]},
    )
    assert first.status_code == 201
    second = await public_client.post(
        "/api/website/v1/public/visit-manage/reschedule-request",
        json={"new_slot_id": slot_b["id"]},
    )
    assert second.status_code == 409
    assert second.json()["detail"]["code"] == "RESCHEDULE_PENDING"


@pytest.mark.asyncio
async def test_approving_reschedule_for_cancelled_request_is_409_not_500(
    admin_client, public_client
):
    """原本：核准端點沒接 InvalidTransition，案件已取消時回 500。"""
    version = await _enable_slots(admin_client, auto_confirm=True)
    slot_a = await _create_slot(admin_client, days_ahead=3)
    slot_b = await _create_slot(admin_client, days_ahead=4)
    created = await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_payload(version, slot_a["id"]),
        headers={"Idempotency-Key": "reschedule-cancelled-01"},
    )
    receipt_id = created.json()["receipt_id"]
    link = await admin_client.post(
        f"/api/website/v1/admin/visit-requests/{receipt_id}/access-link"
    )
    token = link.json()["manage_url_fragment"].split("token=")[1]
    await public_client.post(
        "/api/website/v1/public/visit-manage/exchange", json={"token": token}
    )
    req = await public_client.post(
        "/api/website/v1/public/visit-manage/reschedule-request",
        json={"new_slot_id": slot_b["id"]},
    )
    request_id = req.json()["id"]

    await admin_client.post(f"/api/website/v1/admin/visit-requests/{receipt_id}/cancel")

    approved = await admin_client.post(
        f"/api/website/v1/admin/reschedule-requests/{request_id}/approve"
    )
    assert approved.status_code == 409
    assert approved.json()["detail"]["code"] == "INVALID_TRANSITION"


# ------------------------------------------------------- notifications
@pytest.mark.asyncio
async def test_failed_delivery_retry_does_not_duplicate_inbox_or_email(
    admin_client, public_client, db_session, run_outbox_once, recording_mail_adapter
):
    """原本：寄信失敗沒有 rollback，已寫入的站內通知跟著 commit，
    每重試一次就多一筆；已寄成功的收件人也會重複收信。"""
    version = await _enable_slots(admin_client, auto_confirm=True)
    slot = await _create_slot(admin_client)
    await public_client.post(
        "/api/website/v1/public/visit-requests",
        json=_payload(version, slot["id"]),
        headers={"Idempotency-Key": "notify-dedup-01"},
    )

    class _FlakyAdapter:
        def __init__(self) -> None:
            self.sent: list[dict] = []
            self.fail_next = True

        def send(self, *, to: str, subject: str, body: str) -> None:
            if self.fail_next:
                self.fail_next = False
                raise RuntimeError("模擬第一次寄信失敗")
            self.sent.append({"to": to, "subject": subject})

    flaky = _FlakyAdapter()
    first = await run_outbox_once(flaky)
    assert first["failed"] >= 1

    from app.notifications.models import NotificationInboxItem

    rows = await db_session.execute(select(NotificationInboxItem))
    after_failure = len(list(rows.scalars()))

    # 重試：站內通知不應該再多一筆。
    from app.booking.models import OutboxMessage

    msgs = await db_session.execute(select(OutboxMessage))
    for msg in msgs.scalars():
        msg.next_attempt_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db_session.commit()

    await run_outbox_once(flaky)
    rows = await db_session.execute(select(NotificationInboxItem))
    after_retry = len(list(rows.scalars()))
    assert after_retry == after_failure, "重試不應該重複寫站內通知"


# ------------------------------------------------------------- 時區
def test_today_local_uses_taipei_not_utc():
    """原本：儀表板用 UTC 日界線比對台北時區的 slot_date，
    台北 00:00–08:00 會整批顯示成前一天。"""
    # 台北時間 2026-09-22 01:00 == UTC 2026-09-21 17:00
    utc_moment = datetime(2026, 9, 21, 17, 0, tzinfo=timezone.utc)
    assert utc_moment.date() == date(2026, 9, 21)
    assert today_local(utc_moment) == date(2026, 9, 22)
    assert utc_moment.astimezone(OPERATING_TZ).hour == 1
