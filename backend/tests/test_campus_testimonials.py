"""分校資料的家長分享影片（campus_profile.testimonials）：規則、素材引用、公開輸出、初始化。"""
from __future__ import annotations

import copy
import json
import shutil
import uuid
from pathlib import Path

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.content import schemas as content_schemas
from app.content.initialize import initial_payloads
from app.content.registry import CONTENT_KIND_REGISTRY, set_at_path
from app.content.schemas import CampusProfilePayload
from app.media.models import MediaUsage

API = "/api/website/v1"
MEDIA = f"{API}/admin/media"
FIXTURES = Path("/tmp/media-fixtures")
FIXTURE = Path(__file__).resolve().parents[2] / "web" / "server" / "data" / "site-fixture.json"

requires_ffmpeg = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None, reason="影片需要 ffmpeg／ffprobe"
)

BASE = {
    "name": "義華校", "district": "鳳山區", "address": "地址", "phone": "07", "facebook": "", "line": "",
}


def _item(**changes) -> dict:
    item = {
        "youtube_url": "https://www.youtube.com/watch?v=oaVMxHvquU0",
        "quote": "老師把孩子放第一，不是把父母放第一。",
        "speaker": "樂樂媽咪",
    }
    item.update(changes)
    return item


def _profile(**changes) -> dict:
    return {**BASE, **changes}


async def _upload(client, *, campus_key: str | None = None, kind: str = "image") -> dict:
    form = {"kind": kind}
    if campus_key:
        form["campus_key"] = campus_key
    name = "a.mp4" if kind == "video" else "a.jpg"
    content = (FIXTURES / ("test.mp4" if kind == "video" else "test.jpg")).read_bytes()
    response = await client.post(MEDIA, data=form, files={"file": (name, content, "video/mp4" if kind == "video" else "image/jpeg")})
    assert response.status_code == 201, response.text
    return response.json()


async def _save(client, payload: dict, *, campus_key: str = "yihua", version: int = 0):
    return await client.post(
        f"{API}/admin/content-items/campus_profile/revisions?campus_key={campus_key}",
        json={"expected_version": version, "payload": payload},
    )


async def _publish(client, saved: dict, *, campus_key: str = "yihua") -> None:
    response = await client.post(
        f"{API}/admin/content-items/campus_profile/publish?campus_key={campus_key}",
        json={"revision_id": saved["latest_revision"]["id"]},
    )
    assert response.status_code == 200, response.text


# ---------------------------------------------------------------------------
# 欄位規則
# ---------------------------------------------------------------------------


def test_default_is_none_meaning_builtin():
    assert CampusProfilePayload.model_validate(BASE).testimonials is None


def test_empty_list_and_four_items_are_valid():
    assert CampusProfilePayload.model_validate(_profile(testimonials=[])).testimonials == []
    four = [_item(youtube_url=f"{'abcdefghij'}{i}") for i in range(4)]
    assert len(CampusProfilePayload.model_validate(_profile(testimonials=four)).testimonials) == 4


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/watch?v=oaVMxHvquU0",
        "https://youtu.be/oaVMxHvquU0",
        "https://www.youtube.com/shorts/oaVMxHvquU0",
        "oaVMxHvquU0",
    ],
)
def test_youtube_url_forms_that_resolve_to_an_id(url):
    parsed = CampusProfilePayload.model_validate(_profile(testimonials=[_item(youtube_url=url)]))
    assert content_schemas.youtube_id(parsed.testimonials[0].youtube_url) == "oaVMxHvquU0"


@pytest.mark.parametrize(
    "changes",
    [
        {"youtube_url": "https://example.com/video"},
        {"youtube_url": "not a video"},
        {"youtube_url": ""},
        {"youtube_url": "https://www.youtube.com/watch?v=short"},
        {"youtube_url": "https://www.youtube.com/watch?v=oaVMxHvquU0&x=" + "a" * 300},
        {"quote": "一" * 41},
        {"quote": ""},
        {"quote": "   "},
        {"speaker": "一" * 21},
        {"speaker": ""},
        {"speaker": "  　 "},
        {"quote": "javascript:alert(1)"},
        {"speaker": "javascript:alert(1)"},
        {"poster_alt": "一" * 201},
        {"poster": {"media_id": "story-yihua-oavmxhvquu0"}},
    ],
)
def test_item_rules(changes):
    with pytest.raises(ValidationError):
        CampusProfilePayload.model_validate(_profile(testimonials=[_item(**changes)]))


def test_quote_and_speaker_are_stripped_and_length_boundaries_pass():
    parsed = CampusProfilePayload.model_validate(
        _profile(testimonials=[_item(quote=f"  {'一' * 40}  ", speaker=f"　{'二' * 20} ")])
    )
    assert parsed.testimonials[0].quote == "一" * 40
    assert parsed.testimonials[0].speaker == "二" * 20


def test_more_than_four_is_rejected():
    five = [_item(youtube_url=f"abcdefghij{i}") for i in range(5)]
    with pytest.raises(ValidationError, match="最多 4 支"):
        CampusProfilePayload.model_validate(_profile(testimonials=five))


def test_item_error_loc_carries_index():
    with pytest.raises(ValidationError) as exc:
        CampusProfilePayload.model_validate(_profile(testimonials=[_item(), _item(quote="一" * 41)]))
    assert ("testimonials", 1, "quote") in [e["loc"] for e in exc.value.errors()]


# ---------------------------------------------------------------------------
# 素材引用
# ---------------------------------------------------------------------------


def test_media_refs_cover_each_poster_with_indexed_path():
    ids = [str(uuid.uuid4()) for _ in range(2)]
    payload = CampusProfilePayload.model_validate(
        _profile(testimonials=[_item(poster={"media_id": ids[0]}), _item(youtube_url="abcdefghij1"), _item(youtube_url="abcdefghij2", poster={"media_id": ids[1]})])
    ).model_dump()
    refs = CONTENT_KIND_REGISTRY["campus_profile"].extract_media_refs(payload)
    assert [(str(r.media_id), r.path, r.kind) for r in refs] == [
        (ids[0], "testimonials[0].poster.media_id", "image"),
        (ids[1], "testimonials[2].poster.media_id", "image"),
    ]


def test_media_refs_ignore_none_and_empty_testimonials():
    for value in (None, []):
        payload = CampusProfilePayload.model_validate(_profile(testimonials=value)).model_dump()
        assert CONTENT_KIND_REGISTRY["campus_profile"].extract_media_refs(payload) == []


def test_replace_path_reaches_the_poster_media_id():
    old, new = str(uuid.uuid4()), str(uuid.uuid4())
    payload = CampusProfilePayload.model_validate(_profile(testimonials=[_item(poster={"media_id": old})])).model_dump()
    path = CONTENT_KIND_REGISTRY["campus_profile"].extract_media_refs(payload)[0].path
    set_at_path(payload, path, new)
    assert payload["testimonials"][0]["poster"]["media_id"] == new


# ---------------------------------------------------------------------------
# 存草稿、發布與公開輸出
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_api_rejects_bad_testimonials_with_422_and_writes_nothing(admin_client):
    for testimonials in (
        [_item(youtube_url="https://example.com/x")],
        [_item(youtube_url=f"abcdefghij{i}") for i in range(5)],
        [_item(quote="一" * 41)],
    ):
        response = await _save(admin_client, _profile(testimonials=testimonials))
        assert response.status_code == 422, testimonials
    item = (await admin_client.get(f"{API}/admin/content-items/campus_profile?campus_key=yihua")).json()
    assert item["latest_version"] == 0


@requires_ffmpeg
@pytest.mark.asyncio
async def test_video_as_poster_is_rejected_with_field_path(admin_client):
    video = await _upload(admin_client, kind="video")
    response = await _save(admin_client, _profile(testimonials=[_item(), _item(youtube_url="abcdefghij1", poster={"media_id": video["id"]})]))
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "MEDIA_KIND_MISMATCH"
    assert response.json()["detail"]["field_path"] == "testimonials[1].poster.media_id"


@pytest.mark.asyncio
async def test_poster_from_another_campus_is_rejected(admin_client):
    other = await _upload(admin_client, campus_key="minghua")
    response = await _save(admin_client, _profile(testimonials=[_item(poster={"media_id": other["id"]})]))
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "MEDIA_CROSS_CAMPUS"


@pytest.mark.asyncio
async def test_none_and_empty_list_are_saved_and_appear_in_public_output(admin_client, public_client, db_session):
    from tests.conftest import publish_booking_consent

    await publish_booking_consent(db_session)  # 先有一個 release，/public/site 才有內容可讀
    expected = {}
    for version, value in enumerate((None, [], None), start=0):
        saved = await _save(admin_client, _profile(testimonials=value), version=version)
        assert saved.status_code == 201, saved.text
        assert saved.json()["latest_revision"]["payload"]["testimonials"] == value
        await _publish(admin_client, saved.json())
        live = (await public_client.get(f"{API}/public/site")).json()["content"]["campus_profile"]["yihua"]
        assert "testimonials" in live and live["testimonials"] == value
        expected = live
    assert expected["testimonials"] is None


@pytest.mark.asyncio
async def test_custom_list_round_trips_and_poster_media_is_public(admin_client, public_client, db_session):
    from tests.conftest import publish_booking_consent

    await publish_booking_consent(db_session)
    poster = await _upload(admin_client, campus_key="yihua")
    unused = await _upload(admin_client, campus_key="yihua")
    items = [
        _item(poster={"media_id": poster["id"], "focus_x": 30, "focus_y": 60}, poster_alt="媽媽在說話"),
        _item(youtube_url="https://youtu.be/U5kRPt7By90", quote="第二位", speaker="榕榕媽咪"),
    ]
    saved = await _save(admin_client, _profile(testimonials=items))
    assert saved.status_code == 201, saved.text
    # 引用中的素材會被記下來（刪除保護），路徑帶索引。
    rows = (await db_session.execute(select(MediaUsage.field_name, MediaUsage.media_id))).all()
    assert [(name, str(media_id)) for name, media_id in rows] == [("testimonials[0].poster.media_id", poster["id"])]
    assert (await admin_client.delete(f"{MEDIA}/{poster['id']}")).status_code == 409
    await _publish(admin_client, saved.json())

    site = (await public_client.get(f"{API}/public/site")).json()
    live = site["content"]["campus_profile"]["yihua"]["testimonials"]
    assert live == [
        {
            "youtube_url": "https://www.youtube.com/watch?v=oaVMxHvquU0",
            "quote": "老師把孩子放第一，不是把父母放第一。",
            "speaker": "樂樂媽咪",
            "poster": {"media_id": poster["id"], "focus_x": 30.0, "focus_y": 60.0},
            "poster_alt": "媽媽在說話",
        },
        {
            "youtube_url": "https://youtu.be/U5kRPt7By90",
            "quote": "第二位",
            "speaker": "榕榕媽咪",
            "poster": None,
            "poster_alt": "",
        },
    ]
    # 公開素材清單只列被引用的，封面圖可取得。
    assert poster["id"] in site["media"] and unused["id"] not in site["media"]
    assert (await public_client.get(f"{API}/public/media/{poster['id']}/file")).status_code == 200


@pytest.mark.asyncio
async def test_replace_references_rewrites_poster_media_id(admin_client):
    old = await _upload(admin_client, campus_key="yihua")
    new = await _upload(admin_client, campus_key="yihua")
    saved = (await _save(admin_client, _profile(testimonials=[_item(poster={"media_id": old["id"], "focus_x": 40, "focus_y": 60})]))).json()
    response = await admin_client.post(
        f"{MEDIA}/{old['id']}/replace-references",
        json={"replacement_id": new["id"], "items": [{"content_item_id": saved["id"], "expected_version": 1}]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["items"][0]["field_paths"] == ["testimonials[0].poster.media_id"]
    latest = (await admin_client.get(f"{API}/admin/content-items/campus_profile?campus_key=yihua")).json()["latest_revision"]["payload"]
    assert latest["testimonials"][0]["poster"] == {"media_id": new["id"], "focus_x": 40.0, "focus_y": 60.0}


# ---------------------------------------------------------------------------
# 初始化：fixture 的 testimonials 是官網內建，不匯入（None＝沿用內建）
# ---------------------------------------------------------------------------


def test_fixture_yihua_has_builtin_testimonials_but_initialize_does_not_import_them():
    data = json.loads(FIXTURE.read_text())
    yihua = next(campus for campus in data["campuses"] if campus["key"] == "yihua")
    assert len(yihua["testimonials"]) == 4  # 前提：fixture 確實有，下面才有意義
    entries = {
        campus: payload for kind, campus, payload in initial_payloads(copy.deepcopy(data)) if kind == "campus_profile"
    }
    assert set(entries) == {campus["key"] for campus in data["campuses"]}
    for key, payload in entries.items():
        assert payload["testimonials"] is None, key
