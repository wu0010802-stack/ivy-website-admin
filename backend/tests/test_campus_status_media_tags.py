"""分校停用／啟用；素材標籤、圖說與授權註記。"""
from __future__ import annotations

import io

import pytest
from PIL import Image

from tests.conftest import create_slot, set_booking_mode


# 預約表單要有已發布的同意文字（啟用 slots、官網送單）。
pytestmark = pytest.mark.usefixtures("booking_consent")

API = "/api/website/v1"


@pytest.mark.asyncio
async def test_deactivate_campus_stops_public_booking_and_keeps_cases(admin_client, public_client):
    slot_id = await create_slot(admin_client)
    mode = await set_booking_mode(admin_client, mode="slots")
    assert mode.status_code == 200, mode.text
    manual = await admin_client.post(
        f"{API}/admin/visit-requests",
        json={
            "campus_key": "yihua", "source": "phone", "parent_name": "林爸爸", "phone": "0912345678",
            "consent_given": True, "slot_id": slot_id,
        },
        headers={"Idempotency-Key": "campus-status-manual"},
    )
    assert manual.status_code == 201

    off = await admin_client.patch(f"{API}/admin/campuses/yihua/status", json={"active": False, "reason": "整修"})
    assert off.status_code == 200, off.text
    body = off.json()
    assert body["active"] is False
    assert body["deactivated_reason"] == "整修"
    assert body["deactivated_at"] is not None
    assert body["open_requests"] == 1

    public = await public_client.get(f"{API}/public/booking-config/yihua")
    assert public.status_code == 200
    assert public.json()["mode"] == "paused"

    cfg = (await admin_client.get(f"{API}/admin/booking-config/yihua")).json()
    submit = await public_client.post(
        f"{API}/public/visit-requests",
        json={
            "campus_key": "yihua", "config_version": cfg["version"], "parent_name": "陳媽媽",
            "phone": "0922333444", "email": "parent@example.com", "slot_id": slot_id, "consent_given": True,
        },
        headers={"Idempotency-Key": "inactive-campus-01"},
    )
    assert submit.status_code == 409, submit.text
    assert submit.json()["detail"]["code"] == "BOOKING_UNAVAILABLE"

    # 既有案件還在、沒被取消。
    case = await admin_client.get(f"{API}/admin/visit-requests/{manual.json()['id']}")
    assert case.json()["status"] == "confirmed"

    on = await admin_client.patch(f"{API}/admin/campuses/yihua/status", json={"active": True})
    assert on.json()["active"] is True
    assert on.json()["deactivated_at"] is None
    assert (await public_client.get(f"{API}/public/booking-config/yihua")).json()["mode"] == "slots"


@pytest.mark.asyncio
async def test_only_super_admin_can_change_campus_status(minghua_client):
    denied = await minghua_client.patch(f"{API}/admin/campuses/minghua/status", json={"active": False})
    assert denied.status_code == 403


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), (10, 120, 60)).save(buf, "PNG")
    return buf.getvalue()


@pytest.mark.asyncio
async def test_media_tags_caption_license_and_search(admin_client):
    up = await admin_client.post(
        f"{API}/admin/media",
        data={"kind": "image"},
        files={"file": ("playground.png", _png(), "image/png")},
    )
    assert up.status_code == 201, up.text
    media_id = up.json()["id"]
    assert up.json()["tags"] == []

    patched = await admin_client.patch(
        f"{API}/admin/media/{media_id}",
        json={"expected_version": 1, "tags": [" 戶外 ", "遊戲場", "戶外", ""], "caption": "午後的遊戲時間", "license_note": "園方自攝，可公開使用"},
    )
    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert body["tags"] == ["戶外", "遊戲場"]
    assert body["caption"] == "午後的遊戲時間"
    assert body["license_note"] == "園方自攝，可公開使用"

    other = await admin_client.post(
        f"{API}/admin/media", data={"kind": "image"}, files={"file": ("hall.png", _png(), "image/png")}
    )
    assert other.status_code == 201

    by_tag = await admin_client.get(f"{API}/admin/media?tag=戶外")
    assert [m["id"] for m in by_tag.json()["items"]] == [media_id]
    by_q = await admin_client.get(f"{API}/admin/media?q=遊戲")
    assert [m["id"] for m in by_q.json()["items"]] == [media_id]
    assert (await admin_client.get(f"{API}/admin/media")).json()["total"] == 2

    too_long = await admin_client.patch(f"{API}/admin/media/{media_id}", json={"expected_version": 1, "tags": ["x" * 31]})
    assert too_long.status_code == 422


@pytest.mark.asyncio
async def test_media_text_with_control_chars_is_rejected_and_library_keeps_listing(admin_client):
    """2026-11-12 QA M2：標籤含 NUL 時 PATCH 回 200，之後素材庫列表把 tags 轉 jsonb 就整個 500，
    而且從 UI 修不回來（壞的正是要列出這筆素材的列表）；說明、圖說、來源、授權含 NUL 則
    直接打到 PostgreSQL 變 500。控制字元一律擋在 schema。"""
    up = await admin_client.post(
        f"{API}/admin/media",
        data={"kind": "image", "campus_key": "yihua"},
        files={"file": ("nul.png", _png(), "image/png")},
    )
    assert up.status_code == 201, up.text
    media_id = up.json()["id"]

    for field, value in (
        ("tags", ["QA\u0000nul"]),
        ("tags", ["bell\u0007"]),
        ("alt_text", "孩子\u0000在操場"),
        ("caption", "午後\u0000"),
        ("source_attribution", "園方\u0000"),
        ("license_note", "可公開\u0000"),
    ):
        bad = await admin_client.patch(
            f"{API}/admin/media/{media_id}", json={"expected_version": 1, field: value}
        )
        assert bad.status_code == 422, (field, bad.text)

    listing = await admin_client.get(f"{API}/admin/media?campus=yihua")
    assert listing.status_code == 200, listing.text
    assert [item["id"] for item in listing.json()["items"]] == [media_id]


@pytest.mark.asyncio
async def test_media_upload_rejects_control_chars_and_unknown_campus(admin_client):
    """上傳表單的說明、來源含 NUL，或校區代碼不存在（外鍵），原本都是 500。"""
    for data in (
        {"kind": "image", "campus_key": "yihua", "alt_text": "孩子\u0000"},
        {"kind": "image", "campus_key": "yihua", "source_attribution": "園方\u0000"},
    ):
        bad = await admin_client.post(
            f"{API}/admin/media", data=data, files={"file": ("a.png", _png(), "image/png")}
        )
        assert bad.status_code == 422, (data, bad.text)

    unknown = await admin_client.post(
        f"{API}/admin/media",
        data={"kind": "image", "campus_key": "zzz"},
        files={"file": ("a.png", _png(), "image/png")},
    )
    assert unknown.status_code == 404, unknown.text

    # 檔名裡的控制字元直接拿掉，不退件（檔名只是下載時的顯示名稱）。
    named = await admin_client.post(
        f"{API}/admin/media",
        data={"kind": "image", "campus_key": "yihua"},
        files={"file": ("pho\u0000to.png", _png(), "image/png")},
    )
    assert named.status_code == 201, named.text


@pytest.mark.asyncio
async def test_library_lists_even_when_a_stored_tag_holds_nul(admin_client, db_session):
    """擋輸入之前就存進去的壞標籤，不能讓列表一直 500。"""
    import uuid

    from app.media.models import MediaAsset

    up = await admin_client.post(
        f"{API}/admin/media",
        data={"kind": "image", "campus_key": "yihua"},
        files={"file": ("old.png", _png(), "image/png")},
    )
    assert up.status_code == 201, up.text
    asset = await db_session.get(MediaAsset, uuid.UUID(up.json()["id"]))
    asset.tags = ["舊\u0000標籤"]
    await db_session.commit()

    listing = await admin_client.get(f"{API}/admin/media")
    assert listing.status_code == 200, listing.text
    assert len(listing.json()["items"]) == 1
    searched = await admin_client.get(f"{API}/admin/media?q=操場")
    assert searched.status_code == 200, searched.text
