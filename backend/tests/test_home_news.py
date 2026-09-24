"""首頁消息與活動（home_news）搬進 CMS：payload 規則、初始化與素材引用。"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.content.schemas import HomeNewsPayload

FIXTURE = Path(__file__).resolve().parents[2] / "content" / "site-fixture.json"
MEDIA = Path("/tmp/media-fixtures")


def _article(**overrides) -> dict:
    base = {
        "id": "a1", "date": "2026-10-01", "campus": "義華校", "category": "校園日常",
        "title": "標題", "description": "說明", "image": "garden", "alt": "替代文字",
    }
    return {**base, **overrides}


def _event(**overrides) -> dict:
    base = {"id": "e1", "date": "2026-10-03", "campus": "全校", "title": "活動", "description": "說明"}
    return {**base, **overrides}


def test_fixture_news_validates_and_drops_derived_month():
    news = json.loads(FIXTURE.read_text())["news"]
    payload = HomeNewsPayload.model_validate(
        {"sample_note": news["sampleNote"], "articles": news["articles"], "events": news["events"]}
    ).model_dump()
    assert len(payload["articles"]) == 6
    assert "month" not in payload["events"][0]


def test_empty_lists_allowed_so_nothing_has_to_be_invented():
    payload = HomeNewsPayload.model_validate({"sample_note": "", "articles": [], "events": []})
    assert payload.articles == [] and payload.events == []


@pytest.mark.parametrize("bad", ["2026/10/01", "2026-02-30", "10-01", ""])
def test_dates_must_be_real_iso_dates(bad):
    with pytest.raises(ValidationError):
        HomeNewsPayload.model_validate({"sample_note": "", "articles": [_article(date=bad)], "events": []})
    with pytest.raises(ValidationError):
        HomeNewsPayload.model_validate({"sample_note": "", "articles": [], "events": [_event(date=bad)]})


@pytest.mark.parametrize(
    "article",
    [
        _article(image=""),
        _article(image="javascript:alert(1)"),
        _article(title=""),
        _article(title="javascript:alert(1)"),
    ],
)
def test_article_rejects_missing_or_unsafe_fields(article):
    with pytest.raises(ValidationError):
        HomeNewsPayload.model_validate({"sample_note": "", "articles": [article], "events": []})


def test_duplicate_ids_and_limits_rejected():
    with pytest.raises(ValidationError):
        HomeNewsPayload.model_validate({"sample_note": "", "articles": [_article(), _article()], "events": []})
    with pytest.raises(ValidationError):
        HomeNewsPayload.model_validate({"sample_note": "", "articles": [], "events": [_event(), _event()]})
    with pytest.raises(ValidationError):
        HomeNewsPayload.model_validate({
            "sample_note": "", "articles": [], "events": [_event(id=f"e{i}") for i in range(13)],
        })


@pytest.mark.asyncio
async def test_home_news_is_shared_only(minghua_client):
    response = await minghua_client.post(
        "/api/website/v1/admin/content-items/home_news/revisions",
        json={"expected_version": 0, "payload": {"sample_note": "", "articles": [], "events": []}},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_news_photo_from_media_library_is_protected_and_published(admin_client, public_client):
    upload = await admin_client.post(
        "/api/website/v1/admin/media",
        data={"kind": "image"},
        files={"file": ("test.jpg", (MEDIA / "test.jpg").read_bytes(), "image/jpeg")},
    )
    media_id = upload.json()["id"]
    payload = {"sample_note": "", "articles": [_article(image=media_id)], "events": [_event()]}

    draft = await admin_client.post(
        "/api/website/v1/admin/content-items/home_news/revisions",
        json={"expected_version": 0, "payload": payload},
    )
    assert draft.status_code == 201, draft.text
    blocked = await admin_client.delete(f"/api/website/v1/admin/media/{media_id}")
    assert blocked.status_code == 409

    published = await admin_client.post(
        "/api/website/v1/admin/content-items/home_news/publish",
        json={"revision_id": draft.json()["latest_revision"]["id"]},
    )
    assert published.status_code == 200, published.text
    site = await public_client.get("/api/website/v1/public/site")
    assert site.json()["content"]["home_news"] == payload


@pytest.mark.asyncio
async def test_campus_owned_photo_cannot_be_used_in_shared_news(admin_client):
    upload = await admin_client.post(
        "/api/website/v1/admin/media",
        data={"kind": "image", "campus_key": "yihua"},
        files={"file": ("test.jpg", (MEDIA / "test.jpg").read_bytes(), "image/jpeg")},
    )
    response = await admin_client.post(
        "/api/website/v1/admin/content-items/home_news/revisions",
        json={"expected_version": 0, "payload": {
            "sample_note": "", "articles": [_article(image=upload.json()["id"])], "events": [],
        }},
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "MEDIA_CROSS_CAMPUS"
