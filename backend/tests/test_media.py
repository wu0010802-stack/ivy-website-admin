from __future__ import annotations

from pathlib import Path

import pytest

from app.media import service
from app.media.models import MediaKind

FIXTURES = Path("/tmp/media-fixtures")


def _read(name: str) -> bytes:
    return (FIXTURES / name).read_bytes()


@pytest.mark.asyncio
async def test_upload_real_image_succeeds(admin_client):
    response = await admin_client.post(
        "/api/website/v1/admin/media",
        data={"kind": "image", "campus_key": "yihua"},
        files={"file": ("test.jpg", _read("test.jpg"), "image/jpeg")},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == "ready"
    assert body["content_type"] == "image/jpeg"
    assert body["width"] == 100 and body["height"] == 80
    assert len(body["variants"]) == 1
    assert body["variants"][0]["kind"] == "thumbnail"


@pytest.mark.asyncio
async def test_upload_real_video_succeeds_with_poster(admin_client):
    response = await admin_client.post(
        "/api/website/v1/admin/media",
        data={"kind": "video", "campus_key": "yihua"},
        files={"file": ("test.mp4", _read("test.mp4"), "video/mp4")},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == "ready"
    assert body["content_type"] == "video/mp4"
    assert len(body["variants"]) == 1
    assert body["variants"][0]["kind"] == "poster"


@pytest.mark.asyncio
async def test_disguised_extension_rejected(admin_client):
    # fake.jpg 其實是純文字檔，宣稱 kind=image 但解碼會失敗。
    response = await admin_client.post(
        "/api/website/v1/admin/media",
        data={"kind": "image", "campus_key": "yihua"},
        files={"file": ("fake.jpg", _read("fake.jpg"), "image/jpeg")},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "MEDIA_INVALID"


@pytest.mark.asyncio
async def test_oversized_image_rejected(admin_client, monkeypatch):
    monkeypatch.setattr("app.media.validation.MAX_IMAGE_BYTES", 100)
    response = await admin_client.post(
        "/api/website/v1/admin/media",
        data={"kind": "image", "campus_key": "yihua"},
        files={"file": ("test.jpg", _read("test.jpg"), "image/jpeg")},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "MEDIA_TOO_LARGE"


@pytest.mark.asyncio
async def test_cross_campus_upload_rejected(minghua_client):
    response = await minghua_client.post(
        "/api/website/v1/admin/media",
        data={"kind": "image", "campus_key": "yihua"},
        files={"file": ("test.jpg", _read("test.jpg"), "image/jpeg")},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_cross_campus_read_rejected(admin_client, minghua_client):
    upload = await admin_client.post(
        "/api/website/v1/admin/media",
        data={"kind": "image", "campus_key": "yihua"},
        files={"file": ("test.jpg", _read("test.jpg"), "image/jpeg")},
    )
    media_id = upload.json()["id"]
    response = await minghua_client.get(f"/api/website/v1/admin/media/{media_id}")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_shared_campus_null_media_visible_to_all(admin_client, minghua_client):
    upload = await admin_client.post(
        "/api/website/v1/admin/media",
        data={"kind": "image"},
        files={"file": ("test.jpg", _read("test.jpg"), "image/jpeg")},
    )
    media_id = upload.json()["id"]
    response = await minghua_client.get(f"/api/website/v1/admin/media/{media_id}")
    assert response.status_code == 200


@pytest.mark.asyncio
async def test_referenced_media_cannot_be_deleted(admin_client, db_session):
    upload = await admin_client.post(
        "/api/website/v1/admin/media",
        data={"kind": "image", "campus_key": "yihua"},
        files={"file": ("test.jpg", _read("test.jpg"), "image/jpeg")},
    )
    media_id = upload.json()["id"]

    import uuid

    await service.add_usage(db_session, uuid.UUID(media_id), "yihua", "content-item-1", "hero.photo")
    await db_session.commit()

    response = await admin_client.delete(f"/api/website/v1/admin/media/{media_id}")
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "MEDIA_IN_USE"


@pytest.mark.asyncio
async def test_unreferenced_media_can_be_deleted(admin_client):
    upload = await admin_client.post(
        "/api/website/v1/admin/media",
        data={"kind": "image", "campus_key": "yihua"},
        files={"file": ("test.jpg", _read("test.jpg"), "image/jpeg")},
    )
    media_id = upload.json()["id"]
    response = await admin_client.delete(f"/api/website/v1/admin/media/{media_id}")
    assert response.status_code == 204


@pytest.mark.asyncio
async def test_replace_creates_new_asset_and_keeps_old_untouched(admin_client, db_session):
    import uuid

    upload = await admin_client.post(
        "/api/website/v1/admin/media",
        data={"kind": "image", "campus_key": "yihua"},
        files={"file": ("test.jpg", _read("test.jpg"), "image/jpeg")},
    )
    old_id = upload.json()["id"]
    # 模擬「另一校」（這裡用 minghua 的一筆使用記錄代表其他引用者）仍引用舊 id
    await service.add_usage(db_session, uuid.UUID(old_id), "minghua", "other-campus-content", "photo")
    await db_session.commit()

    replace = await admin_client.post(
        f"/api/website/v1/admin/media/{old_id}/replace",
        files={"file": ("test.png", _read("test.png"), "image/png")},
    )
    assert replace.status_code == 201
    new_id = replace.json()["id"]
    assert new_id != old_id

    # 舊 asset 仍存在、未被覆蓋，其他校的引用不受影響
    old_still_there = await admin_client.get(f"/api/website/v1/admin/media/{old_id}")
    assert old_still_there.status_code == 200
    assert old_still_there.json()["content_type"] == "image/jpeg"


@pytest.mark.asyncio
async def test_public_media_file_served_without_auth(admin_client, public_client):
    upload = await admin_client.post(
        "/api/website/v1/admin/media",
        data={"kind": "image"},
        files={"file": ("test.jpg", _read("test.jpg"), "image/jpeg")},
    )
    media_id = upload.json()["id"]

    response = await public_client.get(f"/api/website/v1/public/media/{media_id}/file")
    assert response.status_code == 200
    assert response.content == _read("test.jpg")


@pytest.mark.asyncio
async def test_public_media_file_404_for_unknown_id(public_client):
    import uuid

    response = await public_client.get(f"/api/website/v1/public/media/{uuid.uuid4()}/file")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_campus_tour_referencing_media_blocks_delete_until_reference_removed(
    admin_client, public_client
):
    upload = await admin_client.post(
        "/api/website/v1/admin/media",
        data={"kind": "image", "campus_key": "yihua"},
        files={"file": ("test.jpg", _read("test.jpg"), "image/jpeg")},
    )
    media_id = upload.json()["id"]

    def scene(image: str) -> dict:
        return {
            "key": "s1",
            "name": "場景",
            "image": image,
            "intro": "intro",
            "spots": [{"name": "熱點", "x": 50, "y": 50, "text": "t", "question": "q"}],
        }

    draft = await admin_client.post(
        "/api/website/v1/admin/content-items/campus_tour/revisions?campus_key=yihua",
        json={"expected_version": 0, "payload": {"scenes": [scene(media_id)]}},
    )
    assert draft.status_code == 201, draft.text

    # 圖片被目前草稿引用中，不能刪除。
    delete_blocked = await admin_client.delete(f"/api/website/v1/admin/media/{media_id}")
    assert delete_blocked.status_code == 409
    assert delete_blocked.json()["detail"]["code"] == "MEDIA_IN_USE"

    # 官網也真的讀得到這張圖（不用登入）。
    public_file = await public_client.get(f"/api/website/v1/public/media/{media_id}/file")
    assert public_file.status_code == 200

    # 存新版把圖片換成舊的 fixture 代號字串，不再引用素材庫這張圖。
    item = await admin_client.get(
        "/api/website/v1/admin/content-items/campus_tour?campus_key=yihua"
    )
    await admin_client.post(
        "/api/website/v1/admin/content-items/campus_tour/revisions?campus_key=yihua",
        json={
            "expected_version": item.json()["latest_version"],
            "payload": {"scenes": [scene("campus")]},
        },
    )

    # 引用已經釋放，現在可以刪除了。
    delete_ok = await admin_client.delete(f"/api/website/v1/admin/media/{media_id}")
    assert delete_ok.status_code == 204
