"""素材庫：引用清單（版本與欄位路徑）、批次替換、刪除保護涵蓋舊版本與排程、
封存、刪除改為待清理＋定期清理、影片資訊、上傳上限與暫存檔。"""
from __future__ import annotations

import glob
import importlib.util
import io
import os
import shutil
import tempfile
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from PIL import Image
from sqlalchemy import select, text

from app.media import service as media_service
from app.media.models import MediaAsset, MediaUsage
from app.operations.models import AuditLogEntry

API = "/api/website/v1"
MEDIA = f"{API}/admin/media"
TOUR = f"{API}/admin/content-items/campus_tour"
META = f"{API}/admin/content-items/site_meta"
NEWS = f"{API}/admin/content-items/home_news"
FIXTURES = Path("/tmp/media-fixtures")
MIGRATION = Path(__file__).resolve().parents[1] / "migrations" / "versions" / "b3e7d1f9a524_media_usage_paths_archive_purge.py"

requires_ffmpeg = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None, reason="影片需要 ffmpeg／ffprobe"
)


async def _upload(client, campus_key: str | None = "yihua", name: str = "test.jpg", **form) -> dict:
    data = {"kind": "image", **form}
    if campus_key:
        data["campus_key"] = campus_key
    response = await client.post(
        MEDIA, data=data, files={"file": (name, (FIXTURES / "test.jpg").read_bytes(), "image/jpeg")}
    )
    assert response.status_code == 201, response.text
    return response.json()


def _scene(key: str, name: str, image: str) -> dict:
    return {
        "key": key, "name": name, "image": image, "intro": "介紹",
        "spots": [{"name": "櫃台", "x": 50, "y": 50, "text": "說明", "question": "問題"}],
    }


async def _save_tour(client, version: int, *scenes: dict) -> dict:
    response = await client.post(
        f"{TOUR}/revisions?campus_key=yihua",
        json={"expected_version": version, "payload": {"scenes": list(scenes)}},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _meta(**extra) -> dict:
    return {
        "title": "常春藤", "description": "描述",
        "header_phone_number": "07-0000000", "header_phone_note": "義華", **extra,
    }


def _article(**overrides) -> dict:
    base = {
        "id": "a1", "date": "2026-10-01", "scope": "global", "campus_keys": [], "category": "校園日常",
        "title": "秋季運動會", "description": "說明", "image": "garden", "alt": "替代文字",
    }
    return {**base, **overrides}


async def _audit_actions(db_session) -> list[str]:
    rows = await db_session.execute(select(AuditLogEntry.action).order_by(AuditLogEntry.created_at))
    return list(rows.scalars())


# ---------------------------------------------------------------------------
# 用在哪裡
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_usages_list_revision_field_path_and_state(admin_client, db_session):
    media = await _upload(admin_client)
    other = await _upload(admin_client)
    v1 = await _save_tour(admin_client, 0, _scene("hall", "大廳", media["id"]), _scene("yard", "操場", other["id"]))

    usages = (await admin_client.get(f"{MEDIA}/{media['id']}/usages")).json()
    assert usages["can_delete"] is False and usages["can_archive"] is False
    [ref] = usages["references"]
    assert ref["kind"] == "campus_tour" and ref["campus_key"] == "yihua"
    assert ref["field_path"] == "scenes[0].image"
    assert ref["label"] == "大廳"
    assert ref["version"] == 1 and ref["revision_id"] == v1["latest_revision"]["id"]
    assert ref["states"] == ["draft"]
    assert ref["can_edit"] is True

    # MediaUsage 記的是版本與欄位路徑，不再是內容種類。
    rows = (await db_session.execute(select(MediaUsage).where(MediaUsage.media_id == uuid.UUID(media["id"])))).scalars().all()
    assert [(r.field_name, r.content_kind, str(r.revision_id)) for r in rows] == [
        ("scenes[0].image", "campus_tour", v1["latest_revision"]["id"])
    ]
    listed = {a["id"]: a for a in (await admin_client.get(MEDIA)).json()}
    assert listed[media["id"]]["usage_count"] == 1
    assert listed[media["id"]]["used_in"] == [{"kind": "campus_tour", "campus_key": "yihua"}]

    # 發布後同一版既是草稿也是線上版。
    published = await admin_client.post(
        f"{TOUR}/publish?campus_key=yihua", json={"revision_id": v1["latest_revision"]["id"]}
    )
    assert published.status_code == 200, published.text
    usages = (await admin_client.get(f"{MEDIA}/{media['id']}/usages")).json()
    assert usages["references"][0]["states"] == ["draft", "live"]

    # 草稿換掉之後：只剩官網那一版在用，最新草稿不再列入。
    await _save_tour(admin_client, 1, _scene("hall", "大廳", other["id"]))
    usages = (await admin_client.get(f"{MEDIA}/{media['id']}/usages")).json()
    assert [(r["version"], r["states"]) for r in usages["references"]] == [(1, ["live"])]
    assert usages["history"] == []


@pytest.mark.asyncio
async def test_usages_hide_other_campus_titles_for_shared_media(admin_client, minghua_client):
    """共用素材被義華的草稿用到：明華的人看得到「用在義華校園探索」，但看不到標題。"""
    shared = await _upload(admin_client, campus_key=None)
    await _save_tour(admin_client, 0, _scene("hall", "還沒公開的新教室", shared["id"]))
    usages = (await minghua_client.get(f"{MEDIA}/{shared['id']}/usages")).json()
    [ref] = usages["references"]
    assert ref["campus_key"] == "yihua" and ref["label"] is None and ref["can_edit"] is False


# ---------------------------------------------------------------------------
# 刪除保護：舊版本、排程
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_media_used_by_scheduled_revision_cannot_be_deleted(admin_client):
    media = await _upload(admin_client)
    v1 = await _save_tour(admin_client, 0, _scene("hall", "大廳", media["id"]))
    publish_at = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
    scheduled = await admin_client.post(
        f"{TOUR}/schedules?campus_key=yihua",
        json={"revision_id": v1["latest_revision"]["id"], "publish_at": publish_at},
    )
    assert scheduled.status_code == 201, scheduled.text
    await _save_tour(admin_client, 1, _scene("hall", "大廳", "campus"))

    blocked = await admin_client.delete(f"{MEDIA}/{media['id']}")
    assert blocked.status_code == 409
    detail = blocked.json()["detail"]
    assert detail["code"] == "MEDIA_IN_USE"
    [ref] = detail["usages"]["references"]
    assert ref["states"] == ["scheduled"] and ref["publish_at"] is not None
    # 排程在用也不能封存。
    archive = await admin_client.post(f"{MEDIA}/{media['id']}/archive")
    assert archive.status_code == 409 and archive.json()["detail"]["code"] == "MEDIA_IN_USE"


@pytest.mark.asyncio
async def test_old_revision_keeps_media_so_restore_still_works(admin_client):
    media = await _upload(admin_client)
    v1 = await _save_tour(admin_client, 0, _scene("hall", "大廳", media["id"]))
    await _save_tour(admin_client, 1, _scene("hall", "大廳", "campus"))

    blocked = await admin_client.delete(f"{MEDIA}/{media['id']}")
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "MEDIA_IN_HISTORY"

    restored = await admin_client.post(
        f"{TOUR}/revisions/{v1['latest_revision']['id']}/restore?campus_key=yihua",
        json={"expected_version": 2, "publish": False},
    )
    assert restored.status_code == 201, restored.text
    assert restored.json()["latest_revision"]["payload"]["scenes"][0]["image"] == media["id"]


# ---------------------------------------------------------------------------
# 封存
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_archive_hides_media_and_unarchive_brings_it_back(admin_client, db_session):
    media = await _upload(admin_client)
    in_draft = await _upload(admin_client)
    await _save_tour(admin_client, 0, _scene("hall", "大廳", in_draft["id"]))

    refused = await admin_client.post(f"{MEDIA}/{in_draft['id']}/archive")
    assert refused.status_code == 409
    assert refused.json()["detail"]["usages"]["references"][0]["field_path"] == "scenes[0].image"

    archived = await admin_client.post(f"{MEDIA}/{media['id']}/archive")
    assert archived.status_code == 200 and archived.json()["archived_at"]
    active_ids = [a["id"] for a in (await admin_client.get(MEDIA)).json()]
    assert media["id"] not in active_ids and in_draft["id"] in active_ids
    assert [a["id"] for a in (await admin_client.get(f"{MEDIA}?state=archived")).json()] == [media["id"]]

    # 封存的素材照樣可以被還原的舊版本引用（存檔不會擋）。
    await _save_tour(admin_client, 1, _scene("hall", "大廳", media["id"]))

    back = await admin_client.post(f"{MEDIA}/{media['id']}/unarchive")
    assert back.status_code == 200 and back.json()["archived_at"] is None
    assert (await admin_client.get(f"{MEDIA}?state=archived")).json() == []
    actions = await _audit_actions(db_session)
    assert "media.archive" in actions and "media.unarchive" in actions


@pytest.mark.asyncio
async def test_campus_admin_cannot_archive_other_campus_media(admin_client, minghua_client):
    media = await _upload(admin_client)
    assert (await minghua_client.post(f"{MEDIA}/{media['id']}/archive")).status_code == 404


# ---------------------------------------------------------------------------
# 刪除＝標記待清理，定期工作到期才刪檔，期間可復原
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_marks_for_cleanup_and_can_be_restored(app, admin_client, db_session):
    media = await _upload(admin_client)
    deleted = await admin_client.delete(f"{MEDIA}/{media['id']}")
    assert deleted.status_code == 204

    assert media["id"] not in [a["id"] for a in (await admin_client.get(MEDIA)).json()]
    [trashed] = (await admin_client.get(f"{MEDIA}?state=deleted")).json()
    assert trashed["id"] == media["id"] and trashed["deleted_at"]
    deleted_at = datetime.fromisoformat(trashed["deleted_at"])
    assert datetime.fromisoformat(trashed["purge_after"]) - deleted_at == timedelta(days=7)

    # 待清理的素材不能再被內容選用，也不會出現在官網。
    refused = await admin_client.post(
        f"{TOUR}/revisions?campus_key=yihua",
        json={"expected_version": 0, "payload": {"scenes": [_scene("hall", "大廳", media["id"])]}},
    )
    assert refused.status_code == 422 and refused.json()["detail"]["code"] == "MEDIA_NOT_FOUND"
    assert (await admin_client.get(f"{API}/public/media/{media['id']}/file")).status_code == 404

    restored = await admin_client.post(f"{MEDIA}/{media['id']}/restore")
    assert restored.status_code == 200 and restored.json()["deleted_at"] is None
    assert media["id"] in [a["id"] for a in (await admin_client.get(MEDIA)).json()]
    again = await admin_client.post(f"{MEDIA}/{media['id']}/restore")
    assert again.status_code == 409 and again.json()["detail"]["code"] == "MEDIA_NOT_DELETED"
    actions = await _audit_actions(db_session)
    assert actions.count("media.delete") == 1 and actions.count("media.restore") == 1


@pytest.mark.asyncio
async def test_purge_waits_for_delay_then_removes_files(app, admin_client, db_session):
    media = await _upload(admin_client)
    asset = (await db_session.execute(select(MediaAsset).where(MediaAsset.id == uuid.UUID(media["id"])))).scalar_one()
    files = [Path(app.state.settings.media_root) / asset.storage_key]
    await db_session.refresh(asset, attribute_names=["variants"])
    files += [Path(app.state.settings.media_root) / v.storage_key for v in asset.variants]
    assert all(f.exists() for f in files)
    assert (await admin_client.delete(f"{MEDIA}/{media['id']}")).status_code == 204

    settings = app.state.settings
    storage = media_service.get_storage(settings)
    now = datetime.now(timezone.utc)
    early = await media_service.purge_due(app.state.session_factory, storage, delay_days=7, now=now + timedelta(days=6))
    assert early == 0 and all(f.exists() for f in files)

    purged = await media_service.purge_due(
        app.state.session_factory, storage, delay_days=7, now=now + timedelta(days=7, minutes=1)
    )
    assert purged == 1
    assert not any(f.exists() for f in files)
    db_session.expire_all()
    gone = (
        await db_session.execute(select(MediaAsset).where(MediaAsset.id == uuid.UUID(media["id"])))
    ).scalar_one_or_none()
    assert gone is None
    assert "media.purge" in await _audit_actions(db_session)


@pytest.mark.asyncio
async def test_maintenance_cycle_purges_due_media(app, admin_client, db_session):
    from app.workers.maintenance import run_cycle

    media = await _upload(admin_client)
    assert (await admin_client.delete(f"{MEDIA}/{media['id']}")).status_code == 204
    await db_session.execute(
        text("UPDATE media_assets SET deleted_at = now() - interval '8 days' WHERE id = :id"),
        {"id": uuid.UUID(media["id"])},
    )
    await db_session.commit()
    result = await run_cycle(app.state.session_factory, app.state.settings, worker_id="test")
    assert result.media_purged == 1
    assert "purge_media" not in result.failed_steps


# ---------------------------------------------------------------------------
# 替換與批次替換
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_replace_then_batch_replace_creates_drafts_without_publishing(admin_client, db_session):
    shared = await _upload(admin_client, campus_key=None)
    await admin_client.patch(
        f"{MEDIA}/{shared['id']}", json={"expected_version": 1, "caption": "園慶", "tags": ["活動"], "license_note": "園方自攝"}
    )
    meta = await admin_client.post(
        f"{META}/revisions", json={"expected_version": 0, "payload": _meta(share_image=shared["id"])}
    )
    assert meta.status_code == 201, meta.text
    live = await admin_client.post(f"{META}/publish", json={"revision_id": meta.json()["latest_revision"]["id"]})
    assert live.status_code == 200, live.text
    body = [{"type": "image", "image": shared["id"], "alt": "內文照片"}]
    news = await admin_client.post(
        f"{NEWS}/revisions",
        json={"expected_version": 0, "payload": {"sample_note": "", "articles": [_article(image=shared["id"], body=body)], "events": []}},
    )
    assert news.status_code == 201, news.text

    replacement = await admin_client.post(
        f"{MEDIA}/{shared['id']}/replace",
        files={"file": ("new.png", (FIXTURES / "test.png").read_bytes(), "image/png")},
    )
    assert replacement.status_code == 201, replacement.text
    new = replacement.json()
    assert new["replaces_media_id"] == shared["id"]
    assert new["caption"] == "園慶" and new["tags"] == ["活動"] and new["license_note"] == "園方自攝"

    usages = (await admin_client.get(f"{MEDIA}/{shared['id']}/usages")).json()
    paths = sorted((r["kind"], r["field_path"]) for r in usages["references"])
    assert paths == [
        ("home_news", "articles[0].body[0].image"),
        ("home_news", "articles[0].image"),
        ("site_meta", "share_image"),
    ]
    items = {
        (r["content_item_id"], r["version"]) for r in usages["references"] if "draft" in r["states"]
    }
    result = await admin_client.post(
        f"{MEDIA}/{shared['id']}/replace-references",
        json={
            "replacement_id": new["id"],
            "items": [{"content_item_id": i, "expected_version": v} for i, v in sorted(items)],
        },
    )
    assert result.status_code == 200, result.text
    by_kind = {row["kind"]: row for row in result.json()["items"]}
    assert by_kind["site_meta"]["version"] == 2 and by_kind["site_meta"]["field_paths"] == ["share_image"]
    assert sorted(by_kind["home_news"]["field_paths"]) == ["articles[0].body[0].image", "articles[0].image"]

    meta_now = (await admin_client.get(META)).json()
    assert meta_now["latest_revision"]["payload"]["share_image"] == new["id"]
    # 只產生草稿：官網上的還是舊素材。
    assert meta_now["current_published_revision_id"] == meta.json()["latest_revision"]["id"]
    news_now = (await admin_client.get(NEWS)).json()["latest_revision"]["payload"]["articles"][0]
    assert news_now["image"] == new["id"] and news_now["body"][0]["image"] == new["id"]

    after = (await admin_client.get(f"{MEDIA}/{shared['id']}/usages")).json()
    assert [(r["kind"], r["states"]) for r in after["references"]] == [("site_meta", ["live"])]
    assert (await admin_client.get(f"{MEDIA}/{new['id']}")).json()["usage_count"] == 3

    audit = (
        await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "media.replace_references"))
    ).scalar_one()
    assert audit.target_type == "media_asset" and audit.target_id == shared["id"]
    assert audit.metadata_json["replacement_id"] == new["id"]
    assert len(audit.metadata_json["items"]) == 2


@pytest.mark.asyncio
async def test_batch_replace_is_all_or_nothing_on_stale_version(admin_client):
    old = await _upload(admin_client, campus_key=None)
    new = await _upload(admin_client, campus_key=None)
    meta = await admin_client.post(
        f"{META}/revisions", json={"expected_version": 0, "payload": _meta(share_image=old["id"])}
    )
    news = await admin_client.post(
        f"{NEWS}/revisions",
        json={"expected_version": 0, "payload": {"sample_note": "", "articles": [_article(image=old["id"])], "events": []}},
    )
    response = await admin_client.post(
        f"{MEDIA}/{old['id']}/replace-references",
        json={
            "replacement_id": new["id"],
            "items": [
                {"content_item_id": meta.json()["id"], "expected_version": 1},
                {"content_item_id": news.json()["id"], "expected_version": 5},
            ],
        },
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "CONTENT_VERSION_CONFLICT"
    # 第一項也沒有存進去。
    assert (await admin_client.get(META)).json()["latest_version"] == 1


@pytest.mark.asyncio
async def test_batch_replace_rejects_bad_replacement_and_other_campus(admin_client, minghua_client):
    old = await _upload(admin_client)
    await _save_tour(admin_client, 0, _scene("hall", "大廳", old["id"]))
    item_id = (await admin_client.get(f"{TOUR}?campus_key=yihua")).json()["id"]
    items = [{"content_item_id": item_id, "expected_version": 1}]

    same = await admin_client.post(
        f"{MEDIA}/{old['id']}/replace-references", json={"replacement_id": old["id"], "items": items}
    )
    assert same.status_code == 422 and same.json()["detail"]["code"] == "MEDIA_REPLACEMENT_INVALID"

    other_campus = await _upload(admin_client, campus_key="minghua")
    cross = await admin_client.post(
        f"{MEDIA}/{old['id']}/replace-references", json={"replacement_id": other_campus["id"], "items": items}
    )
    assert cross.status_code == 422 and cross.json()["detail"]["code"] == "MEDIA_CROSS_CAMPUS"

    mine = await _upload(minghua_client, campus_key="minghua")
    denied = await minghua_client.post(
        f"{MEDIA}/{mine['id']}/replace-references",
        json={"replacement_id": other_campus["id"], "items": items},
    )
    assert denied.status_code == 404


# ---------------------------------------------------------------------------
# 上傳：格式、上限、暫存檔、影片資訊、上傳者
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_gif_no_longer_accepted(admin_client):
    buf = io.BytesIO()
    Image.new("RGB", (20, 20), (200, 10, 10)).save(buf, format="GIF")
    response = await admin_client.post(
        MEDIA, data={"kind": "image", "campus_key": "yihua"}, files={"file": ("a.gif", buf.getvalue(), "image/gif")}
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "MEDIA_UNSUPPORTED_FORMAT"


@pytest.mark.asyncio
async def test_upload_limits_follow_settings(app, admin_client, public_client):
    limits = (await admin_client.get(f"{MEDIA}/upload-limits")).json()
    assert limits["max_image_bytes"] == 15 * 1024 * 1024
    assert limits["max_video_bytes"] == 150 * 1024 * 1024
    assert limits["image_types"] == ["image/jpeg", "image/png", "image/webp"]
    assert limits["purge_delay_days"] == 7

    # 請求本文上限由同一組設定推導：影片上限 1 MB → 本文最多 6 MB。
    app.state.settings.media_max_video_mb = 1
    app.state.settings.media_max_image_mb = 1
    response = await public_client.post(
        MEDIA,
        content=b"x" * 10,
        headers={"Content-Type": "multipart/form-data; boundary=x", "Content-Length": str(7 * 1024 * 1024)},
    )
    assert response.status_code == 413


@pytest.mark.asyncio
async def test_upload_is_streamed_to_temp_file_and_cleaned_up(app, admin_client):
    pattern = os.path.join(tempfile.gettempdir(), "media-upload-*")
    before = set(glob.glob(pattern))
    await _upload(admin_client)
    app.state.settings.media_max_image_mb = 0
    too_big = await admin_client.post(
        MEDIA,
        data={"kind": "image", "campus_key": "yihua"},
        files={"file": ("big.jpg", (FIXTURES / "test.jpg").read_bytes(), "image/jpeg")},
    )
    assert too_big.status_code == 413
    assert set(glob.glob(pattern)) == before


@pytest.mark.asyncio
async def test_uploader_email_and_metadata_length_limits(admin_client):
    media = await _upload(admin_client)
    assert media["created_by_email"] == "admin@ivy.example"
    too_long = await admin_client.patch(f"{MEDIA}/{media['id']}", json={"expected_version": 1, "alt_text": "字" * 501})
    assert too_long.status_code == 422
    too_long = await admin_client.patch(f"{MEDIA}/{media['id']}", json={"expected_version": 1, "source_attribution": "字" * 256})
    assert too_long.status_code == 422


@requires_ffmpeg
@pytest.mark.asyncio
async def test_video_records_duration_size_and_accepts_metadata(admin_client):
    response = await admin_client.post(
        MEDIA,
        data={"kind": "video", "campus_key": "yihua"},
        files={"file": ("test.mp4", (FIXTURES / "test.mp4").read_bytes(), "video/mp4")},
    )
    assert response.status_code == 201, response.text
    video = response.json()
    assert video["duration_seconds"] and video["duration_seconds"] > 0
    assert video["width"] and video["height"]

    updated = await admin_client.patch(
        f"{MEDIA}/{video['id']}",
        json={"expected_version": 1, "alt_text": "孩子在沙坑玩", "caption": "午後", "source_attribution": "義華校", "license_note": "園方自攝", "tags": ["戶外"]},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["alt_text"] == "孩子在沙坑玩" and updated.json()["tags"] == ["戶外"]


def test_probe_video_without_ffprobe_returns_empty(monkeypatch, tmp_path):
    from app.media import processing

    def _missing(*args, **kwargs):
        raise FileNotFoundError("ffprobe")

    monkeypatch.setattr(processing.subprocess, "run", _missing)
    probe = processing.probe_video(tmp_path / "x.mp4")
    assert probe == processing.VideoProbe(None, None, None)


# ---------------------------------------------------------------------------
# migration：舊的 media_usages（field_name＝內容種類）改成版本＋欄位路徑
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_migration_backfills_usage_paths_from_latest_revision(app, admin_client, db_session):
    spec = importlib.util.spec_from_file_location("media_usage_paths", MIGRATION)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    first = await _upload(admin_client)
    second = await _upload(admin_client)
    saved = await _save_tour(
        admin_client, 0, _scene("hall", "大廳", first["id"]), _scene("yard", "操場", second["id"])
    )
    # 模擬舊資料：一個素材一筆、field_name 存內容種類、沒有版本。
    await db_session.execute(text("DELETE FROM media_usages"))
    for media_id in (first["id"], second["id"]):
        await db_session.execute(
            text(
                "INSERT INTO media_usages (id, media_id, campus_key, content_item_id, field_name, created_at) "
                "VALUES (:id, :media, 'yihua', :item, 'campus_tour', now())"
            ),
            {"id": uuid.uuid4(), "media": uuid.UUID(media_id), "item": saved["id"]},
        )
    await db_session.commit()

    async with app.state.engine.begin() as conn:
        await conn.run_sync(migration._backfill_usages)

    db_session.expire_all()
    rows = (await db_session.execute(select(MediaUsage).order_by(MediaUsage.field_name))).scalars().all()
    assert [(str(r.media_id), r.field_name, r.content_kind, str(r.revision_id)) for r in rows] == [
        (first["id"], "scenes[0].image", "campus_tour", saved["latest_revision"]["id"]),
        (second["id"], "scenes[1].image", "campus_tour", saved["latest_revision"]["id"]),
    ]
