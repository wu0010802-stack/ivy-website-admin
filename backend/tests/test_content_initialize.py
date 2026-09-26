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
    assert await initialize_content(db_session, data) == 21
    release_id, content = await service.get_public_content(db_session)
    assert release_id
    assert set(content["campus_profile"]) == {c["key"] for c in data["campuses"]}
    assert set(content["campus_tour"]) == {"yihua"}
    assert content["campus_profile"]["renwu"]["line"] == ""
    assert content["campus_profile"]["yihua"]["instagram"] == "https://www.instagram.com/ivy.kids.school.ig/"
    assert content["campus_profile"]["yihua"]["youtube"] == "https://www.youtube.com/@IvyKidsVideos"
    assert content["campus_profile"]["renwu"]["instagram"] == content["campus_profile"]["renwu"]["youtube"] == ""
    assert content["site_footer"]["copyright"] == data["footer"]["copyright"]
    # 五校一字不差的題目搬進全站共用題目，各校只留帶校名的那題（預設顯示共用題）。
    shared_qs = [item["q"] for item in content["shared_faq"]["items"]]
    assert shared_qs == [item["q"] for i, item in enumerate(data["campuses"][0]["faq"]["items"]) if i != 2]
    assert all(item["scope"] == "global" and item["enabled"] for item in content["shared_faq"]["items"])
    minghua_faq = content["campus_faq"]["minghua"]
    assert [item["q"] for item in minghua_faq["items"]] == [data["campuses"][1]["faq"]["items"][2]["q"]]
    assert minghua_faq["items"][0]["a"] == data["campuses"][1]["faq"]["items"][2]["a"]
    assert minghua_faq["include_shared"] is True and minghua_faq["shared_position"] == "before"
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
    assert await db_session.scalar(select(func.count()).select_from(ContentRevision)) == 21


@pytest.mark.asyncio
async def test_initialize_never_overwrites_or_publishes_existing_drafts(db_session):
    from app.content.initialize import initialize_content

    item = await service.get_or_create_content_item(db_session, "home_hero", None)
    revision = await service.create_revision(
        db_session, item,
        {"eyebrow": "園方草稿", "copy_lines": ["待審稿"], "cta_label": "參觀"},
        0, None,
    )
    assert await initialize_content(db_session, json.loads(FIXTURE.read_text())) == 20
    assert item.latest_version == 1
    assert item.current_published_revision_id is None
    assert revision.payload["eyebrow"] == "園方草稿"
    assert "home_hero" not in (await service.get_public_content(db_session))[1]


@pytest.mark.asyncio
async def test_existing_sites_adopt_shared_faq_only_where_untouched(db_session):
    """共用題目是後來才加的：已經初始化過的環境補建共用題目時，只把「官網上
    就是原型匯入的版本、之後沒有新版本」的校區改用共用題目；改過的、有草稿
    的都不動。"""
    from app.content.initialize import faq_adoption_candidates, initialize_content

    data = json.loads(FIXTURE.read_text())
    original = {c["key"]: c["faq"]["items"] for c in data["campuses"]}

    async def publish_faq(campus_key: str, items: list[dict]):
        item = await service.get_or_create_content_item(db_session, "campus_faq", campus_key)
        revision = await service.create_revision(db_session, item, {"items": items}, item.latest_version, None)
        await service.publish_revision(db_session, item, revision, None)
        return item

    # 舊環境：五校都是整份原型模板（舊版 payload 沒有 enabled／include_shared）。
    for key, items in original.items():
        await publish_faq(key, items)
    # 明華改過一題；崇德有還沒發布的草稿。
    edited = [dict(item) for item in original["minghua"]]
    edited[0]["a"] = "明華自己的回答"
    await publish_faq("minghua", edited)
    chongde = await service.get_or_create_content_item(db_session, "campus_faq", "chongde")
    await service.create_revision(db_session, chongde, {"items": original["chongde"][:2]}, 1, None)
    await db_session.commit()

    assert await faq_adoption_candidates(db_session, data) == ["yihua", "international", "renwu"]
    await initialize_content(db_session, data)
    await db_session.commit()
    _, content = await service.get_public_content(db_session)

    assert len(content["shared_faq"]["items"]) == 3
    # 崇德的草稿拿掉了第 4 題，那題共用題目先不給崇德（草稿發布後才不會又冒出來）；
    # 明華只改了回答，問題文字都還在，照常適用。
    assert all(
        item["scope"] == "campus" and item["campus_keys"] == ["yihua", "minghua", "international", "renwu"]
        for item in content["shared_faq"]["items"]
    )
    assert [i["q"] for i in content["campus_faq"]["yihua"]["items"]] == [original["yihua"][2]["q"]]
    assert [i["q"] for i in content["campus_faq"]["renwu"]["items"]] == [original["renwu"][2]["q"]]
    # 改過的明華與有草稿的崇德原樣保留。
    assert [i["a"] for i in content["campus_faq"]["minghua"]["items"]][0] == "明華自己的回答"
    assert len(content["campus_faq"]["minghua"]["items"]) == 4
    assert len(content["campus_faq"]["chongde"]["items"]) == 4
    assert chongde.latest_version == 2

    # 共用題目已經有了，重跑不再動任何校區。
    assert await faq_adoption_candidates(db_session, data) == []
    assert await initialize_content(db_session, data) == 0


def _merged_questions(campus_key: str, content: dict) -> list[str]:
    """跟官網 content-overlay.ts 的 mergeCampusFaq 同一套規則，只取問題文字。"""
    faq = content["campus_faq"][campus_key]
    own = faq["items"]
    own_qs = {item["q"].strip() for item in own}
    shared = [] if faq.get("include_shared") is False else [
        item["q"] for item in content.get("shared_faq", {}).get("items", [])
        if item.get("enabled", True)
        and (item.get("scope") != "campus" or campus_key in item.get("campus_keys", []))
        and item["q"].strip() not in own_qs
    ]
    shown = [item["q"] for item in own if item.get("enabled", True)]
    return shown + shared if faq.get("shared_position") == "after" else shared + shown


@pytest.mark.asyncio
async def test_campus_that_reworded_a_shared_question_does_not_get_duplicates(db_session):
    """園方改過共用那幾題的問題文字（標點、用字）：官網只認文字完全相同的同一題，
    補建共用題目後不能讓那一校同時出現本校版與共用版。共用題目先不給那一校，
    其他校照常改用共用題目；CLI 會列出缺哪幾題原文。"""
    from app.content.initialize import faq_initialization_plan, initialize_content

    data = json.loads(FIXTURE.read_text())
    original = {c["key"]: c["faq"]["items"] for c in data["campuses"]}
    for key, items in original.items():
        item = await service.get_or_create_content_item(db_session, "campus_faq", key)
        revision = await service.create_revision(db_session, item, {"items": items}, 0, None)
        await service.publish_revision(db_session, item, revision, None)
    reworded = [dict(item) for item in original["minghua"]]
    reworded[0]["q"] = reworded[0]["q"].rstrip("？?") + "呢？"
    item = await service.get_or_create_content_item(db_session, "campus_faq", "minghua")
    revision = await service.create_revision(db_session, item, {"items": reworded}, 1, None)
    await service.publish_revision(db_session, item, revision, None)
    await db_session.commit()

    plan = await faq_initialization_plan(db_session, data)
    assert plan.adopt == ["yihua", "chongde", "international", "renwu"]
    assert plan.held_back == {"minghua": [original["minghua"][0]["q"]]}

    await initialize_content(db_session, data)
    await db_session.commit()
    _, content = await service.get_public_content(db_session)
    minghua = _merged_questions("minghua", content)
    assert minghua == [item["q"] for item in reworded]
    for key in ("yihua", "chongde", "international", "renwu"):
        assert sorted(_merged_questions(key, content)) == sorted(item["q"] for item in original[key])


@pytest.mark.asyncio
async def test_all_campuses_reworded_creates_shared_faq_disabled(db_session):
    """五校都改過：共用題目整批建成停用，官網每一校都維持原樣。"""
    from app.content.initialize import faq_initialization_plan, initialize_content

    data = json.loads(FIXTURE.read_text())
    for campus in data["campuses"]:
        items = [dict(item) for item in campus["faq"]["items"]]
        items[1]["q"] = items[1]["q"] + " "  # 只差空白算同一題，不擋
        items[3]["q"] = "（改寫）" + items[3]["q"]
        item = await service.get_or_create_content_item(db_session, "campus_faq", campus["key"])
        revision = await service.create_revision(db_session, item, {"items": items}, 0, None)
        await service.publish_revision(db_session, item, revision, None)
    await db_session.commit()

    plan = await faq_initialization_plan(db_session, data)
    assert plan.adopt == []
    assert set(plan.held_back) == {c["key"] for c in data["campuses"]}
    assert all(questions == [data["campuses"][0]["faq"]["items"][3]["q"]] for questions in plan.held_back.values())

    await initialize_content(db_session, data)
    await db_session.commit()
    _, content = await service.get_public_content(db_session)
    assert content["shared_faq"]["items"] == []
    for campus in data["campuses"]:
        assert len(_merged_questions(campus["key"], content)) == len(campus["faq"]["items"])
