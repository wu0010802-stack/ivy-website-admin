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
    assert await initialize_content(db_session, data) == 20
    release_id, content = await service.get_public_content(db_session)
    assert release_id
    assert set(content["campus_profile"]) == {c["key"] for c in data["campuses"]}
    assert set(content["campus_tour"]) == {"yihua"}
    assert content["campus_profile"]["renwu"]["line"] == ""
    assert content["site_footer"]["copyright"] == data["footer"]["copyright"]
    assert content["campus_faq"]["minghua"]["items"] == data["campuses"][1]["faq"]["items"]
    assert len(content["day_experience"]["moments"]) == 6
    assert content["home_news"]["sample_note"] == data["news"]["sampleNote"]
    assert [a["id"] for a in content["home_news"]["articles"]] == [a["id"] for a in data["news"]["articles"]]
    # 原型的示範同意文字（資料不會傳送給學校）不能發布到正式站，匯入時換成
    # 官網一直顯示的正式文字；隱私說明本文由園方提供，匯入時留空。
    from app.content.schemas import FORMAL_CONSENT_TEXT, LEGACY_DEMO_CONSENT_TEXT

    assert data["booking"]["consentText"] == LEGACY_DEMO_CONSENT_TEXT
    assert content["booking_content"]["consent_text"] == FORMAL_CONSENT_TEXT
    assert content["booking_content"]["privacy_sections"] == []
    assert await initialize_content(db_session, data) == 0
    assert (await service.get_public_content(db_session))[0] == release_id
    assert await db_session.scalar(select(func.count()).select_from(ContentRevision)) == 20


@pytest.mark.asyncio
async def test_initialize_never_overwrites_or_publishes_existing_drafts(db_session):
    from app.content.initialize import initialize_content

    item = await service.get_or_create_content_item(db_session, "home_hero", None)
    revision = await service.create_revision(
        db_session, item,
        {"eyebrow": "園方草稿", "copy_lines": ["待審稿"], "cta_label": "參觀"},
        0, None,
    )
    assert await initialize_content(db_session, json.loads(FIXTURE.read_text())) == 19
    assert item.latest_version == 1
    assert item.current_published_revision_id is None
    assert revision.payload["eyebrow"] == "園方草稿"
    assert "home_hero" not in (await service.get_public_content(db_session))[1]
