"""素材標籤與說明欄位的孤立代理字元（lone surrogate，U+D800–U+DFFF）。

FastAPI 用 json.loads 解析本文，"\\ud83d" 會解成一個孤立代理字元；標籤的每一項沒有長度限制，
pydantic 的 str 照收。標籤存在 JSON 欄，json.dumps 把它寫成 "\\ud83d"，PostgreSQL 的 json 型別
只檢查語法所以收下，但素材庫列表把 tags 轉成 jsonb 時拒收（代理字元必須成對），整個素材庫與
所有選圖器一起 500；回應序列化也會失敗，PATCH 本身與素材詳情都是 500，從畫面修不回來。比照
2026-11-12 QA M2（NUL 標籤）擋在 schema 回 422，並讓更早存進去的壞標籤不會打垮列表。說明、
圖說、來源、授權有 max_length，pydantic 驗長度時已經退回（string_unicode，422）；一起列進來，
免得哪天放寬長度限制時又變成寫進 text 欄才 500。
"""
from __future__ import annotations

import io
import json
import uuid

import pytest
from PIL import Image

API = "/api/website/v1"


def _png() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (40, 30), (10, 120, 60)).save(buf, "PNG")
    return buf.getvalue()


async def _upload(client, campus_key: str = "yihua", filename: str = "lone.png") -> dict:
    up = await client.post(
        f"{API}/admin/media",
        data={"kind": "image", "campus_key": campus_key},
        files={"file": (filename, _png(), "image/png")},
    )
    assert up.status_code == 201, up.text
    return up.json()


async def _patch_raw(client, media_id: str, payload: dict):
    """httpx 的 json= 會把字串編成 UTF-8，孤立代理字元在用戶端就編不出去；
    改用 json.dumps 預設的 ASCII 跳脫（"\\ud83d"），就是瀏覽器或腳本實際送得出的本文。"""
    return await client.patch(
        f"{API}/admin/media/{media_id}",
        content=json.dumps(payload).encode("ascii"),
        headers={"content-type": "application/json"},
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("tags", ["\ud83d"]),
        ("tags", ["戶外\udc00"]),
        ("tags", ["好標籤", "\udfff尾"]),
        ("alt_text", "孩子\ud83d在操場"),
        ("caption", "午後\udc00"),
        ("source_attribution", "園方\ud800"),
        ("license_note", "可公開\udbff"),
    ],
)
async def test_patch_rejects_lone_surrogates(admin_client, editor_client, field, value):
    """有 media.manage 的帳號（這裡是義華的內容編輯）送孤立代理字元：回 422，不寫入、不加版本。"""
    media = await _upload(admin_client)
    media_id = media["id"]

    bad = await _patch_raw(editor_client, media_id, {"expected_version": 1, field: value})
    assert bad.status_code == 422, (field, bad.text)

    detail = await editor_client.get(f"{API}/admin/media/{media_id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["version"] == 1
    assert detail.json()["tags"] == []

    for params in ("", "?campus=yihua&include_shared=true&exclude_failed=true"):
        listing = await editor_client.get(f"{API}/admin/media{params}")
        assert listing.status_code == 200, (params, listing.text)
        assert [item["id"] for item in listing.json()["items"]] == [media_id]


@pytest.mark.asyncio
async def test_emoji_tags_with_valid_surrogate_pairs_still_work(admin_client):
    """成對的代理（emoji 經 ASCII 跳脫送來）是合法字元：照收，列表的標籤選單、篩選與搜尋都要比得到。"""
    media = await _upload(admin_client)
    media_id = media["id"]

    patched = await _patch_raw(admin_client, media_id, {"expected_version": 1, "tags": ["🎈氣球", "戶外"]})
    assert patched.status_code == 200, patched.text
    assert patched.json()["tags"] == ["🎈氣球", "戶外"]

    listing = await admin_client.get(f"{API}/admin/media")
    assert listing.status_code == 200, listing.text
    assert sorted(listing.json()["tags"]) == sorted(["🎈氣球", "戶外"])
    by_tag = await admin_client.get(f"{API}/admin/media", params={"tag": "🎈氣球"})
    assert [item["id"] for item in by_tag.json()["items"]] == [media_id]
    by_q = await admin_client.get(f"{API}/admin/media", params={"q": "🎈"})
    assert [item["id"] for item in by_q.json()["items"]] == [media_id]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bad_tag",
    [
        "\ud83d",
        # 兩個孤立代理中間夾一個反斜線：JSON 文字是 "\ud83d\\\ude00"，列表的保護不能把它們接成一對。
        "\ud83d\\\ude00",
    ],
    ids=["lone-high", "split-by-backslash"],
)
async def test_library_survives_a_stored_lone_surrogate_tag(admin_client, editor_client, db_session, bad_tag):
    """擋輸入之前就存進去的壞標籤：列表、選圖器、搜尋與詳情都不能 500，而且從畫面改得回來。"""
    from app.media.models import MediaAsset

    broken = await _upload(admin_client, filename="broken.png")
    healthy = await _upload(admin_client, filename="healthy.png")
    asset = await db_session.get(MediaAsset, uuid.UUID(broken["id"]))
    # json.dumps 預設的 ASCII 跳脫：存進 JSON 欄的就是 "\ud83d"（同正式站實際留下的資料）。
    asset.tags = [bad_tag, "好標籤"]
    other = await db_session.get(MediaAsset, uuid.UUID(healthy["id"]))
    # 合法的 emoji 標籤不能被這層保護誤傷。
    other.tags = ["🎈氣球", "\\ud83d字面"]
    await db_session.commit()

    for client in (admin_client, editor_client):
        for params in (
            {},
            {"campus": "yihua", "include_shared": "true", "exclude_failed": "true"},
            {"q": "broken"},
            {"q": "好標籤"},
            {"tag": "好標籤"},
        ):
            listing = await client.get(f"{API}/admin/media", params=params)
            assert listing.status_code == 200, (params, listing.text)

        listing = (await client.get(f"{API}/admin/media")).json()
        assert {item["id"] for item in listing["items"]} == {broken["id"], healthy["id"]}
        # 壞的那一筆在統計裡當成沒有標籤；另一筆照常。
        assert sorted(listing["tags"]) == sorted(["🎈氣球", "\\ud83d字面"])
        shown = next(item for item in listing["items"] if item["id"] == broken["id"])
        # 畫面上只看得到存得進 jsonb 的標籤，送回去就把壞資料修掉。
        assert shown["tags"] == ["好標籤"]

        detail = await client.get(f"{API}/admin/media/{broken['id']}")
        assert detail.status_code == 200, detail.text
        assert detail.json()["tags"] == ["好標籤"]

    fixed = await editor_client.patch(
        f"{API}/admin/media/{broken['id']}", json={"expected_version": 1, "tags": ["好標籤"]}
    )
    assert fixed.status_code == 200, fixed.text
    assert fixed.json()["tags"] == ["好標籤"]
    listing = (await admin_client.get(f"{API}/admin/media")).json()
    assert sorted(listing["tags"]) == sorted(["好標籤", "🎈氣球", "\\ud83d字面"])
    by_tag = await admin_client.get(f"{API}/admin/media", params={"tag": "好標籤"})
    assert [item["id"] for item in by_tag.json()["items"]] == [broken["id"]]
