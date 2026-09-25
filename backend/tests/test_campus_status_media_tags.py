"""分校停用／啟用；素材標籤、圖說與授權註記。"""
from __future__ import annotations

import io

import pytest
from PIL import Image


# 預約表單要有已發布的同意文字（啟用 inquiry／slots、官網送單）。
pytestmark = pytest.mark.usefixtures("booking_consent")

API = "/api/website/v1"


@pytest.mark.asyncio
async def test_deactivate_campus_stops_public_booking_and_keeps_cases(admin_client, public_client):
    current = await admin_client.get(f"{API}/admin/booking-config/yihua")
    await admin_client.patch(
        f"{API}/admin/booking-config/yihua",
        json={"expected_version": current.json()["version"], "mode": "inquiry"},
    )
    manual = await admin_client.post(
        f"{API}/admin/visit-requests",
        json={"campus_key": "yihua", "source": "phone", "parent_name": "林爸爸", "phone": "0912345678", "consent_given": True},
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
            "phone": "0922333444", "consent_given": True,
        },
        headers={"Idempotency-Key": "inactive-campus-01"},
    )
    assert submit.status_code == 409, submit.text
    assert submit.json()["detail"]["code"] == "BOOKING_UNAVAILABLE"

    # 既有案件還在、沒被取消。
    case = await admin_client.get(f"{API}/admin/visit-requests/{manual.json()['id']}")
    assert case.json()["status"] == "new"

    on = await admin_client.patch(f"{API}/admin/campuses/yihua/status", json={"active": True})
    assert on.json()["active"] is True
    assert on.json()["deactivated_at"] is None
    assert (await public_client.get(f"{API}/public/booking-config/yihua")).json()["mode"] == "inquiry"


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
    assert [m["id"] for m in by_tag.json()] == [media_id]
    by_q = await admin_client.get(f"{API}/admin/media?q=遊戲")
    assert [m["id"] for m in by_q.json()] == [media_id]
    assert len((await admin_client.get(f"{API}/admin/media")).json()) == 2

    too_long = await admin_client.patch(f"{API}/admin/media/{media_id}", json={"expected_version": 1, "tags": ["x" * 31]})
    assert too_long.status_code == 422
