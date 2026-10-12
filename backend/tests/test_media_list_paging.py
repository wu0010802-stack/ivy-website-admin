"""素材列表在資料庫篩選與分頁（2026-10-08）：分頁與總數、state_total、標籤選單、
校區／種類／失敗篩選、中文標籤、關鍵字的 % 與 _、校區範圍、排序穩定。"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app.media.models import MediaAsset, MediaKind, MediaStatus

API = "/api/website/v1"
MEDIA = f"{API}/admin/media"
BASE_TIME = datetime(2026, 10, 1, tzinfo=timezone.utc)


async def _asset(
    db_session,
    name: str,
    *,
    minutes: int = 0,
    campus_key: str | None = "yihua",
    kind: MediaKind = MediaKind.IMAGE,
    status: MediaStatus = MediaStatus.READY,
    tags: list[str] | None = None,
    alt_text: str | None = None,
    caption: str | None = None,
    archived: bool = False,
    deleted: bool = False,
    media_id: uuid.UUID | None = None,
) -> str:
    """直接寫一筆素材（不走上傳，列表測試不需要真的檔案）。tags 跟正式資料一樣經
    SQLAlchemy 的 JSON 型別寫入。"""
    created_at = BASE_TIME + timedelta(minutes=minutes)
    asset = MediaAsset(
        id=media_id or uuid.uuid4(),
        campus_key=campus_key,
        kind=kind,
        status=status,
        storage_key=uuid.uuid4().hex,
        original_filename=name,
        content_type="video/mp4" if kind == MediaKind.VIDEO else "image/jpeg",
        size_bytes=1024,
        tags=tags or [],
        alt_text=alt_text,
        caption=caption,
        created_at=created_at,
        archived_at=created_at if archived else None,
        deleted_at=created_at if deleted else None,
    )
    db_session.add(asset)
    await db_session.commit()
    return str(asset.id)


async def _list(client, **params) -> dict:
    response = await client.get(MEDIA, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def _names(body: dict) -> list[str]:
    return [item["original_filename"] for item in body["items"]]


@pytest.mark.asyncio
async def test_paging_total_and_newest_first(admin_client, db_session):
    for i in range(5):
        await _asset(db_session, f"p{i}.jpg", minutes=i)

    first = await _list(admin_client, page=1, page_size=2)
    assert _names(first) == ["p4.jpg", "p3.jpg"]
    assert (first["total"], first["state_total"], first["page"], first["page_size"]) == (5, 5, 1, 2)
    assert _names(await _list(admin_client, page=2, page_size=2)) == ["p2.jpg", "p1.jpg"]
    assert _names(await _list(admin_client, page=3, page_size=2)) == ["p0.jpg"]
    # 超過最後一頁是空的，總數照給（後台用來退回上一頁）。
    beyond = await _list(admin_client, page=4, page_size=2)
    assert beyond["items"] == [] and beyond["total"] == 5

    # 預設每頁 60 張，上限 200。
    assert (await _list(admin_client))["page_size"] == 60
    assert (await admin_client.get(MEDIA, params={"page_size": 201})).status_code == 422
    assert (await admin_client.get(MEDIA, params={"page": 0})).status_code == 422
    # 頁碼大到 offset 超出 bigint 時回 422，不是資料庫錯誤的 500。
    assert (await admin_client.get(MEDIA, params={"page": 10**20})).status_code == 422


@pytest.mark.asyncio
async def test_same_created_at_orders_by_id_without_repeats(admin_client, db_session):
    ids = sorted((uuid.uuid4() for _ in range(5)), reverse=True)
    for media_id in ids:
        await _asset(db_session, f"{media_id}.jpg", minutes=0, media_id=media_id)

    seen = []
    for page in (1, 2, 3):
        seen += [item["id"] for item in (await _list(admin_client, page=page, page_size=2))["items"]]
    assert seen == [str(media_id) for media_id in ids]


@pytest.mark.asyncio
async def test_state_total_ignores_filters(admin_client, db_session):
    await _asset(db_session, "a.jpg", tags=["戶外"])
    await _asset(db_session, "b.mp4", kind=MediaKind.VIDEO, campus_key=None)
    await _asset(db_session, "c.jpg", campus_key="minghua")
    await _asset(db_session, "old.jpg", archived=True)
    await _asset(db_session, "gone.jpg", deleted=True)

    for params in ({"kind": "video"}, {"campus": "minghua"}, {"tag": "戶外"}, {"q": "a.jpg"}, {"campus": "__shared"}):
        body = await _list(admin_client, **params)
        assert body["total"] == 1, params
        assert body["state_total"] == 3, params
    archived = await _list(admin_client, state="archived")
    assert (_names(archived), archived["state_total"]) == (["old.jpg"], 1)
    deleted = await _list(admin_client, state="deleted", kind="video")
    assert (deleted["total"], deleted["state_total"]) == (0, 1)


@pytest.mark.asyncio
async def test_tags_sorted_by_usage_then_text_within_state(admin_client, db_session):
    await _asset(db_session, "1.jpg", tags=["畢業典禮", "戶外"])
    await _asset(db_session, "2.jpg", tags=["戶外"])
    await _asset(db_session, "3.jpg", tags=["戶外", "乙"])
    await _asset(db_session, "4.jpg", tags=["甲", "畢業典禮"])
    await _asset(db_session, "5.jpg", tags=["乙"])
    # 別的分頁狀態用過的標籤不列。
    await _asset(db_session, "old.jpg", tags=["封存才有"], archived=True)

    body = await _list(admin_client, kind="video", q="找不到")
    # 戶外 3、畢業典禮 2、乙 2（同次數依字串排）、甲 1；不受其他篩選影響。
    assert body["tags"] == ["戶外", *sorted(["畢業典禮", "乙"]), "甲"]
    assert (await _list(admin_client, state="archived"))["tags"] == ["封存才有"]


@pytest.mark.asyncio
async def test_campus_filter_shared_key_and_include_shared(admin_client, db_session):
    await _asset(db_session, "shared.jpg", campus_key=None, minutes=3)
    await _asset(db_session, "yihua.jpg", campus_key="yihua", minutes=2)
    await _asset(db_session, "minghua.jpg", campus_key="minghua", minutes=1)

    assert _names(await _list(admin_client)) == ["shared.jpg", "yihua.jpg", "minghua.jpg"]
    assert _names(await _list(admin_client, campus="__shared")) == ["shared.jpg"]
    assert _names(await _list(admin_client, campus="yihua")) == ["yihua.jpg"]
    assert _names(await _list(admin_client, campus="yihua", include_shared="true")) == ["shared.jpg", "yihua.jpg"]
    # include_shared 只和校區代號一起用：__shared 本來就只有共用。
    assert _names(await _list(admin_client, campus="__shared", include_shared="true")) == ["shared.jpg"]


@pytest.mark.asyncio
async def test_campus_admin_sees_only_shared_and_own_campus(minghua_client, db_session):
    await _asset(db_session, "shared.jpg", campus_key=None, minutes=3, tags=["共用"])
    await _asset(db_session, "yihua.jpg", campus_key="yihua", minutes=2, tags=["義華才有"])
    await _asset(db_session, "minghua.jpg", campus_key="minghua", minutes=1, tags=["明華"])

    body = await _list(minghua_client)
    assert _names(body) == ["shared.jpg", "minghua.jpg"]
    assert (body["total"], body["state_total"]) == (2, 2)
    assert sorted(body["tags"]) == sorted(["共用", "明華"])
    # 看不到的校區：沒有結果（不是 404）；帶 include_shared 時照舊列共用（選圖器）。
    hidden = await _list(minghua_client, campus="yihua")
    assert (hidden["items"], hidden["total"], hidden["state_total"]) == ([], 0, 2)
    assert _names(await _list(minghua_client, campus="yihua", include_shared="true")) == ["shared.jpg"]
    assert _names(await _list(minghua_client, q="yihua")) == []
    assert _names(await _list(minghua_client, tag="義華才有")) == []


@pytest.mark.asyncio
async def test_kind_and_exclude_failed(admin_client, db_session):
    await _asset(db_session, "ok.jpg", minutes=4)
    await _asset(db_session, "bad.jpg", status=MediaStatus.FAILED, minutes=3)
    await _asset(db_session, "run.mp4", kind=MediaKind.VIDEO, status=MediaStatus.PROCESSING, minutes=2)
    await _asset(db_session, "bad.mp4", kind=MediaKind.VIDEO, status=MediaStatus.FAILED, minutes=1)

    assert _names(await _list(admin_client, kind="image")) == ["ok.jpg", "bad.jpg"]
    assert _names(await _list(admin_client, kind="video", exclude_failed="true")) == ["run.mp4"]
    assert _names(await _list(admin_client, exclude_failed="true")) == ["ok.jpg", "run.mp4"]
    assert (await admin_client.get(MEDIA, params={"kind": "gif"})).status_code == 422


@pytest.mark.asyncio
async def test_chinese_tags_filter_and_search(admin_client, db_session):
    tagged = await _asset(db_session, "a.jpg", tags=["戶外教學", "畢業"], minutes=2)
    await _asset(db_session, "b.jpg", tags=["室內"], minutes=1)
    # 跟正式資料一樣，JSON 欄位存的是跳脫過的文字：轉成文字比對抓不到中文。
    raw = (await db_session.execute(text("SELECT tags::text FROM media_assets WHERE id = :id"), {"id": tagged})).scalar_one()
    assert "戶外教學" not in raw

    assert [i["id"] for i in (await _list(admin_client, tag="戶外教學"))["items"]] == [tagged]
    # 標籤要整個相符，片段不算。
    assert (await _list(admin_client, tag="戶外"))["items"] == []
    assert [i["id"] for i in (await _list(admin_client, q="外教"))["items"]] == [tagged]
    assert [i["id"] for i in (await _list(admin_client, q="畢"))["items"]] == [tagged]


@pytest.mark.asyncio
async def test_search_matches_filename_alt_and_caption_case_insensitive(admin_client, db_session):
    await _asset(db_session, "Garden.JPG", minutes=3)
    await _asset(db_session, "x.jpg", alt_text="孩子在沙坑玩耍", minutes=2)
    await _asset(db_session, "y.jpg", caption="2025 畢業典禮大合照", minutes=1)

    assert _names(await _list(admin_client, q="garden")) == ["Garden.JPG"]
    assert _names(await _list(admin_client, q="沙坑")) == ["x.jpg"]
    assert _names(await _list(admin_client, q="大合照")) == ["y.jpg"]
    # 前後空白不算。
    assert _names(await _list(admin_client, q="  沙坑 ")) == ["x.jpg"]


@pytest.mark.asyncio
async def test_search_percent_and_underscore_are_literal(admin_client, db_session):
    await _asset(db_session, "100%.jpg", minutes=5)
    await _asset(db_session, "a_b.jpg", minutes=4)
    await _asset(db_session, "axb.jpg", minutes=3)
    await _asset(db_session, "back\\slash.jpg", minutes=2)
    await _asset(db_session, "tagged.jpg", minutes=1, tags=["50%off"])

    # 標籤裡的 % 也照字面比對。
    assert _names(await _list(admin_client, q="%")) == ["100%.jpg", "tagged.jpg"]
    assert _names(await _list(admin_client, q="_")) == ["a_b.jpg"]
    assert _names(await _list(admin_client, q="a_b")) == ["a_b.jpg"]
    assert _names(await _list(admin_client, q="\\")) == ["back\\slash.jpg"]
    assert _names(await _list(admin_client, q="0%o")) == ["tagged.jpg"]


@pytest.mark.asyncio
async def test_control_chars_rejected(admin_client):
    for params in ({"q": "a\x00b"}, {"tag": "\x00"}, {"campus": "yi\x01hua"}):
        response = await admin_client.get(MEDIA, params=params)
        assert response.status_code == 422, params


@pytest.mark.asyncio
async def test_json_null_tags_do_not_break_list(admin_client, db_session):
    """PATCH 明寫 tags: null 時存成 JSON 的 null（不是 SQL NULL）：列表、關鍵字與標籤選單照常。"""
    media_id = await _asset(db_session, "null-tags.jpg", minutes=2)
    await _asset(db_session, "tagged.jpg", tags=["戶外"], minutes=1)
    patched = await admin_client.patch(f"{MEDIA}/{media_id}", json={"expected_version": 1, "tags": None})
    assert patched.status_code == 200, patched.text
    raw = (await db_session.execute(text("SELECT tags::text FROM media_assets WHERE id = :id"), {"id": media_id})).scalar_one()
    assert raw == "null"

    body = await _list(admin_client, q="null-tags")
    assert _names(body) == ["null-tags.jpg"]
    assert body["items"][0]["tags"] == []
    assert body["tags"] == ["戶外"]
    assert _names(await _list(admin_client, tag="戶外")) == ["tagged.jpg"]
