import json
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.content import service
from app.content.models import ContentRevision

FIXTURE = Path(__file__).resolve().parents[2] / "content" / "site-fixture.json"


@pytest.mark.asyncio
async def test_initialize_preserves_source_and_skips_unverified_tours(db_session):
    from app.content.initialize import initialize_content

    data = json.loads(FIXTURE.read_text())
    assert await initialize_content(db_session, data) == 17
    release_id, content = await service.get_public_content(db_session)
    assert release_id
    assert set(content["campus_profile"]) == {c["key"] for c in data["campuses"]}
    assert set(content["campus_tour"]) == {"yihua"}
    assert content["campus_profile"]["renwu"]["line"] == ""
    assert content["campus_profile"]["yihua"]["instagram"] == "https://www.instagram.com/ivy.kids.school.ig/"
    assert content["campus_profile"]["yihua"]["youtube"] == "https://www.youtube.com/@IvyKidsVideos"
    assert content["campus_profile"]["renwu"]["instagram"] == content["campus_profile"]["renwu"]["youtube"] == ""
    assert content["site_footer"]["copyright"] == data["footer"]["copyright"]
    # 常見問題（shared_faq、campus_faq）2026-10-08 起不再是內容類型，初始化不再建立。
    assert "shared_faq" not in content and "campus_faq" not in content
    assert len(content["day_experience"]["moments"]) == 6
    assert content["home_news"]["sample_note"] == data["news"]["sampleNote"]
    assert [a["id"] for a in content["home_news"]["articles"]] == [a["id"] for a in data["news"]["articles"]]
    # 預約同意文字與橫幅、五校簡介與臉書備註 2026-10-08 起 fixture 沒有、匯入也不再帶
    # （版本本身與公開輸出都沒有這些 key）；隱私說明本文由園方提供，匯入時留空。
    retired_booking = {"consent_text", "banner_title_template", "banner_body", "banner_button_label"}
    retired_profile = {"intro", "description", "fb_note"}
    assert not retired_booking & set(data["booking"]) and "consentText" not in data["booking"]
    assert all(not retired_profile & set(c) and "fbNote" not in c for c in data["campuses"])
    booking = await service.published_payload(db_session, "booking_content", None)
    assert not retired_booking & set(booking)
    assert content["booking_content"]["cta_label"] == data["booking"]["ctaLabel"]
    assert content["booking_content"]["privacy_sections"] == []
    for campus in data["campuses"]:
        profile = await service.published_payload(db_session, "campus_profile", campus["key"])
        assert not retired_profile & set(profile)
        assert profile["name"] == campus["name"]
    assert await initialize_content(db_session, data) == 0
    assert (await service.get_public_content(db_session))[0] == release_id
    assert await db_session.scalar(select(func.count()).select_from(ContentRevision)) == 17


@pytest.mark.asyncio
async def test_initialize_never_overwrites_or_publishes_existing_drafts(db_session):
    from app.content.initialize import initialize_content

    item = await service.get_or_create_content_item(db_session, "home_hero", None)
    revision = await service.create_revision(
        db_session, item,
        {"eyebrow": "園方草稿", "copy_lines": ["待審稿"], "cta_label": "參觀"},
        0, None,
    )
    assert await initialize_content(db_session, json.loads(FIXTURE.read_text())) == 16
    assert item.latest_version == 1
    assert item.current_published_revision_id is None
    assert revision.payload["eyebrow"] == "園方草稿"
    assert "home_hero" not in (await service.get_public_content(db_session))[1]
