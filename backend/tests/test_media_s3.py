"""素材改存 S3 相容物件儲存（WEBSITE_MEDIA_STORAGE=s3）。

S3 以 moto 模擬，不連任何真的儲存服務。"""

from __future__ import annotations

from pathlib import Path

import boto3
import httpx
import pytest
from moto import mock_aws

from app.auth.models import Role
from app.config import Settings
from app.main import create_app
from app.media import service as media_service
from tests.conftest import _create_user, _logged_in_client, _test_settings

BUCKET = "ivy-media"
PREFIX = "media/"
FIXTURES = Path("/tmp/media-fixtures")
S3_SETTINGS = {
    "s3_bucket": BUCKET,
    "s3_access_key_id": "test-access-key",
    "s3_secret_access_key": "test-secret-key",
    "s3_region": "us-east-1",
    "s3_prefix": PREFIX,
}


@pytest.fixture
def s3():
    with mock_aws():
        media_service._s3_storage.cache_clear()
        client = boto3.client(
            "s3", region_name="us-east-1", aws_access_key_id="test-access-key", aws_secret_access_key="test-secret-key"
        )
        client.create_bucket(Bucket=BUCKET)
        yield client
    media_service._s3_storage.cache_clear()


def _objects(client) -> set[str]:
    return {obj["Key"] for obj in client.list_objects_v2(Bucket=BUCKET).get("Contents", [])}


@pytest.fixture
async def s3_app(s3, tmp_path):
    settings = _test_settings().model_copy(
        update={"media_storage": "s3", "media_root": str(tmp_path / "unused-volume"), **S3_SETTINGS}
    )
    app = create_app(settings)
    yield app
    await app.state.engine.dispose()


async def _admin(app) -> httpx.AsyncClient:
    async with app.state.session_factory() as db:
        await _create_user(db, "s3-admin@ivy.example", "s3-admin-password-123", Role.SUPER_ADMIN)
    return await _logged_in_client(app, "s3-admin@ivy.example", "s3-admin-password-123")


async def _upload(client: httpx.AsyncClient) -> dict:
    response = await client.post(
        "/api/website/v1/admin/media",
        data={"kind": "image", "campus_key": "yihua"},
        files={"file": ("test.jpg", (FIXTURES / "test.jpg").read_bytes(), "image/jpeg")},
    )
    assert response.status_code == 201, response.text
    return response.json()


async def test_upload_serve_range_and_delete_through_s3(s3_app, s3, tmp_path):
    original = (FIXTURES / "test.jpg").read_bytes()
    client = await _admin(s3_app)
    try:
        asset = await _upload(client)
        assert asset["status"] == "ready"
        keys = _objects(s3)
        assert len(keys) == 2, "原檔＋縮圖"
        assert all(key.startswith(PREFIX) for key in keys)
        # 沒有寫進本機 volume。
        assert not (tmp_path / "unused-volume").exists() or not any((tmp_path / "unused-volume").iterdir())

        url = f"/api/website/v1/admin/media/{asset['id']}/file"
        full = await client.get(url)
        assert full.status_code == 200
        assert full.content == original
        assert full.headers["content-type"] == "image/jpeg"
        assert full.headers["x-content-type-options"] == "nosniff"
        assert full.headers["cache-control"] == "private, no-store"
        assert full.headers["accept-ranges"] == "bytes"

        # 影片拖曳與 iOS 播放靠 Range → 206。
        partial = await client.get(url, headers={"Range": "bytes=0-9"})
        assert partial.status_code == 206
        assert partial.content == original[:10]
        assert partial.headers["content-range"] == f"bytes 0-9/{len(original)}"

        suffix = await client.get(url, headers={"Range": "bytes=-5"})
        assert suffix.status_code == 206 and suffix.content == original[-5:]

        # 多段 Range 不支援：當作沒有 Range，回整個檔案。
        multi = await client.get(url, headers={"Range": "bytes=0-1,4-5"})
        assert multi.status_code == 200 and multi.content == original

        beyond = await client.get(url, headers={"Range": f"bytes={len(original) + 100}-"})
        assert beyond.status_code == 416
        assert beyond.headers["content-range"] == f"bytes */{len(original)}"

        deleted = await client.delete(f"/api/website/v1/admin/media/{asset['id']}")
        assert deleted.status_code == 204
        assert _objects(s3) == set()
    finally:
        await client.aclose()


async def test_missing_object_is_404_not_500(s3_app, s3):
    client = await _admin(s3_app)
    try:
        asset = await _upload(client)
        for key in _objects(s3):
            s3.delete_object(Bucket=BUCKET, Key=key)
        response = await client.get(f"/api/website/v1/admin/media/{asset['id']}/file")
        assert response.status_code == 404
    finally:
        await client.aclose()


async def test_copy_volume_to_s3_cli_is_idempotent(app, s3, monkeypatch, capsys):
    """先用本機儲存上傳（模擬現在的正式站），再用 CLI 搬到 S3。"""
    from app import cli

    client = await _admin(app)
    try:
        asset = await _upload(client)
    finally:
        await client.aclose()
    assert asset["status"] == "ready"
    local_root = Path(app.state.settings.media_root)

    settings = app.state.settings.model_copy(update=S3_SETTINGS)
    monkeypatch.setattr(cli, "get_settings", lambda: settings)

    async def factory():
        return app.state.session_factory

    monkeypatch.setattr(cli, "_session_factory", factory)

    await cli.media_copy_to_s3(dry_run=True)
    assert "將複製 2" in capsys.readouterr().out
    assert _objects(s3) == set()

    await cli.media_copy_to_s3(dry_run=False)
    assert "已複製 2" in capsys.readouterr().out
    copied = _objects(s3)
    assert len(copied) == 2
    for key in copied:
        body = s3.get_object(Bucket=BUCKET, Key=key)["Body"].read()
        assert body == (local_root / key.removeprefix(PREFIX)).read_bytes()

    await cli.media_copy_to_s3(dry_run=False)
    assert "已複製 0、S3 已有 2" in capsys.readouterr().out


async def test_copy_cli_refuses_without_s3_settings(app, monkeypatch):
    from app import cli

    monkeypatch.setattr(cli, "get_settings", lambda: app.state.settings)
    with pytest.raises(SystemExit):
        await cli.media_copy_to_s3(dry_run=True)


def _settings(**overrides) -> Settings:
    return Settings(
        database_url="postgresql+asyncpg://localhost/ivy_website_dev",
        session_secret="test-only-secret-please-rotate",
        **overrides,
    )


def test_s3_settings_validation():
    with pytest.raises(ValueError):
        _settings(media_storage="s3")
    with pytest.raises(ValueError):
        _settings(s3_bucket=BUCKET, s3_access_key_id="k")
    with pytest.raises(ValueError):
        _settings(**S3_SETTINGS, s3_endpoint_url="https://user:pw@example.r2.cloudflarestorage.com")
    with pytest.raises(ValueError):
        _settings(environment="production", **S3_SETTINGS, s3_endpoint_url="http://example.r2.cloudflarestorage.com")
    with pytest.raises(ValueError):
        _settings(**{**S3_SETTINGS, "s3_prefix": "../escape"})

    ok = _settings(media_storage="s3", **{**S3_SETTINGS, "s3_prefix": "/site/media/"})
    assert ok.s3_prefix == "site/media/"
    assert ok.s3_configured
    assert "test-secret-key" not in repr(ok)
    assert _settings().media_storage == "local" and not _settings().s3_configured


async def test_local_storage_serves_ranges_too(admin_client):
    """本機儲存靠 Starlette FileResponse 處理 Range；兩種儲存行為要一致。"""
    original = (FIXTURES / "test.jpg").read_bytes()
    asset = await _upload(admin_client)
    url = f"/api/website/v1/admin/media/{asset['id']}/file"
    partial = await admin_client.get(url, headers={"Range": "bytes=0-9"})
    assert partial.status_code == 206
    assert partial.content == original[:10]
    assert partial.headers["content-range"] == f"bytes 0-9/{len(original)}"
