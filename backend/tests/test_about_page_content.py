"""關於常春藤頁（about_page）：payload 規則與素材引用。"""
from __future__ import annotations

import copy
import io
import json
import uuid
from pathlib import Path

import pytest
from PIL import Image
from pydantic import ValidationError

from app.content.initialize import _copy_fields, initial_payloads
from app.content.page_schemas import ABOUT_MILESTONE_KEYS, AboutPagePayload
from app.content.registry import CONTENT_KIND_REGISTRY
from tests.conftest import publish_booking_consent

YEARS = (1997, 2001, 2005, 2020, 2021)
API = "/api/website/v1"
ITEM = f"{API}/admin/content-items/about_page"
MEDIA = f"{API}/admin/media"
FIXTURE = Path(__file__).resolve().parents[2] / "content" / "site-fixture.json"
WEB_FIXTURE = Path(__file__).resolve().parents[2] / "web" / "server" / "data" / "site-fixture.json"


def _fixture_payload() -> dict:
    return _copy_fields(json.loads(FIXTURE.read_text())["aboutPage"], "about_page")


def _base(**changes) -> dict:
    payload = {
        "hero_title": "從一間幼兒園，\n長成五所校園。",
        "hero_lede": "1997 年，第一間常春藤在高雄義華路成立。",
        "hero_caption": "把每個孩子，放在心上。",
        "chapter_names": ["一路走來", "全人教育", "我們的期許", "家長怎麼說"],
        "story_title": "近三十年，\n長出五所校園。",
        "story_text": "說明。",
        "milestones": [{"key": key, "year": year, "text": "說明"} for key, year in zip(ABOUT_MILESTONE_KEYS, YEARS)],
        "whole_title": "六大領域，\n陪孩子完整長大。",
        "whole_text": "說明。",
        "whole_fine": "補充。",
        "whole_fine_source": "源自幼兒園教保活動課程大綱",
        "hope_title": "孩子的第一所學校，\n也是第二個家。",
        "hope_quotes": ["第一段。", "第二段。"],
        "outro_title": "五所校園",
        "outro_text": "說明。",
    }
    payload.update(changes)
    return payload


def test_registered_as_shared_only_and_valid_base():
    assert CONTENT_KIND_REGISTRY["about_page"].shared_only is True
    assert AboutPagePayload.model_validate(_base()).hero_photo is None


@pytest.mark.parametrize(
    "changes",
    [
        {"hero_title": "一" * 13},
        {"hope_title": "一\n二\n三\n四"},
        {"chapter_names": ["一路走來", "全人教育", "我們的期許"]},
        {"chapter_names": ["一路走來走來走", "全人教育", "我們的期許", "家長怎麼說"]},
        {"hope_quotes": ["只有一段。"]},
        {"outro_title": "五所校園五所校"},
        {"hero_lede": "第一行\n第二行"},
        {"story_text": "javascript:alert(1)"},
    ],
)
def test_rules(changes):
    with pytest.raises(ValidationError):
        AboutPagePayload.model_validate(_base(**changes))


def _locs(changes) -> list[tuple]:
    with pytest.raises(ValidationError) as exc:
        AboutPagePayload.model_validate(_base(**changes))
    return [e["loc"] for e in exc.value.errors()]


def test_string_lists_validate_per_item_so_loc_carries_index():
    assert ("hope_quotes", 1) in _locs({"hope_quotes": ["第一段。", "一" * 71]})
    names = ["一路走來", "全人教育", "一" * 7, "家長怎麼說"]
    assert ("chapter_names", 2) in _locs({"chapter_names": names})


def test_milestone_item_error_loc_carries_index():
    data = _base()
    data["milestones"][3]["text"] = "一" * 31
    with pytest.raises(ValidationError) as exc:
        AboutPagePayload.model_validate(data)
    assert ("milestones", 3, "text") in [e["loc"] for e in exc.value.errors()]


def test_milestones_fixed_keys_years_in_range_and_in_order():
    data = _base()
    data["milestones"] = list(reversed(data["milestones"]))
    with pytest.raises(ValidationError, match="五站"):
        AboutPagePayload.model_validate(data)
    data = copy.deepcopy(_base())
    data["milestones"][0]["year"] = 1949
    with pytest.raises(ValidationError):
        AboutPagePayload.model_validate(data)
    data = copy.deepcopy(_base())
    data["milestones"][1]["year"] = 1990
    with pytest.raises(ValidationError, match="由早到晚"):
        AboutPagePayload.model_validate(data)
    data = copy.deepcopy(_base())
    data["milestones"][0]["year"] = 1998  # 義華創校年份待園方確認，可以改
    data["milestones"][1]["year"] = 1998  # 同年可以
    assert AboutPagePayload.model_validate(data).milestones[0].year == 1998


def test_media_refs_cover_the_three_photos():
    ids = [str(uuid.uuid4()) for _ in range(3)]
    data = _base(hero_photo={"media_id": ids[0]}, hero_back_photo={"media_id": ids[1]}, hope_photo={"media_id": ids[2]})
    refs = CONTENT_KIND_REGISTRY["about_page"].extract_media_refs(data)
    assert [(str(r.media_id), r.path) for r in refs] == [
        (ids[0], "hero_photo.media_id"),
        (ids[1], "hero_back_photo.media_id"),
        (ids[2], "hope_photo.media_id"),
    ]


def test_both_fixtures_carry_the_same_about_copy():
    assert json.loads(FIXTURE.read_text())["aboutPage"] == json.loads(WEB_FIXTURE.read_text())["aboutPage"]


def test_fixture_copy_passes_and_keeps_the_history():
    payload = AboutPagePayload.model_validate(_fixture_payload())
    assert [(m.key, m.year) for m in payload.milestones] == list(zip(ABOUT_MILESTONE_KEYS, YEARS))
    copy_text = json.dumps(_fixture_payload(), ensure_ascii=False)
    for phrase in ("三十多", "週年", "美語部", "補習班"):
        assert phrase not in copy_text


def test_whole_fine_source_with_only_spaces_is_saved_blank():
    parsed = AboutPagePayload.model_validate(_base(whole_fine_source="  \u3000 "))
    assert parsed.whole_fine_source == ""


def test_initialize_includes_about_page():
    entries = {kind: payload for kind, _campus, payload in initial_payloads(json.loads(FIXTURE.read_text()))}
    assert entries["about_page"].get("hero_photo") is None
    assert entries["about_page"].get("hope_photo") is None


async def _save(client, payload: dict):
    item = (await client.get(ITEM)).json()
    return await client.post(f"{ITEM}/revisions", json={"expected_version": item["latest_version"], "payload": payload})


@pytest.mark.asyncio
async def test_public_site_has_page_only_after_publish(admin_client, public_client, db_session):
    await publish_booking_consent(db_session)  # 先有一個 release，/public/site 才有內容可讀
    assert "about_page" not in (await public_client.get(f"{API}/public/site")).json()["content"]
    saved = await _save(admin_client, _fixture_payload())
    assert saved.status_code == 201, saved.text
    published = await admin_client.post(f"{ITEM}/publish", json={"revision_id": saved.json()["latest_revision"]["id"]})
    assert published.status_code == 200, published.text
    live = (await public_client.get(f"{API}/public/site")).json()["content"]["about_page"]
    assert live == AboutPagePayload.model_validate(_fixture_payload()).model_dump()


@pytest.mark.asyncio
async def test_unknown_media_is_rejected(admin_client):
    payload = _fixture_payload()
    payload["hope_photo"] = {"media_id": str(uuid.uuid4())}
    saved = await _save(admin_client, payload)
    assert saved.status_code == 422
    assert saved.json()["detail"]["code"] == "MEDIA_NOT_FOUND"


@pytest.mark.asyncio
async def test_hope_quote_too_long_returns_422_with_item_index(admin_client):
    payload = _fixture_payload()
    payload["hope_quotes"][1] = "字" * 71
    saved = await _save(admin_client, payload)
    assert saved.status_code == 422
    assert [error["loc"] for error in saved.json()["detail"]] == [["hope_quotes", 1]]


def _jpeg(width: int = 160, height: int = 120) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), (78, 184, 122)).save(buf, "JPEG")
    return buf.getvalue()


async def _upload(client) -> dict:
    # 關於頁是全站共用內容，用共用素材（不帶 campus_key）。
    response = await client.post(MEDIA, data={"kind": "image"}, files={"file": ("about.jpg", _jpeg(), "image/jpeg")})
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.asyncio
@pytest.mark.parametrize("field", ["hope_photo", "hero_back_photo"])
async def test_photo_is_tracked_protected_and_batch_replaced(admin_client, field):
    old = await _upload(admin_client)
    payload = _fixture_payload()
    payload[field] = {"media_id": old["id"], "focus_x": None, "focus_y": None}
    saved = await _save(admin_client, payload)
    assert saved.status_code == 201, saved.text
    item = saved.json()

    usages = (await admin_client.get(f"{MEDIA}/{old['id']}/usages")).json()
    [ref] = usages["references"]
    assert (ref["kind"], ref["field_path"], ref["version"]) == ("about_page", f"{field}.media_id", 1)
    assert ref["states"] == ["draft"]
    assert usages["can_delete"] is False

    blocked = await admin_client.delete(f"{MEDIA}/{old['id']}")
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "MEDIA_IN_USE"

    new = await _upload(admin_client)
    replaced = await admin_client.post(
        f"{MEDIA}/{old['id']}/replace-references",
        json={"replacement_id": new["id"], "items": [{"content_item_id": item["id"], "expected_version": 1}]},
    )
    assert replaced.status_code == 200, replaced.text
    assert replaced.json()["items"][0]["field_paths"] == [f"{field}.media_id"]
    latest = (await admin_client.get(ITEM)).json()["latest_revision"]["payload"]
    assert latest[field]["media_id"] == new["id"]
    assert (await admin_client.get(f"{MEDIA}/{old['id']}/usages")).json()["references"] == []


@pytest.mark.asyncio
async def test_editor_can_read_but_not_edit(editor_client):
    assert (await editor_client.get(ITEM)).status_code == 200
    denied = await _save(editor_client, _fixture_payload())
    assert denied.status_code == 403
