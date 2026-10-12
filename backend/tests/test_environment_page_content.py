"""常春藤環境頁前三章（environment_page）：payload 規則、素材引用、初始化與權限。"""
from __future__ import annotations

import copy
import io
import json
import shutil
import uuid
from pathlib import Path

import pytest
from PIL import Image
from pydantic import ValidationError

from app.content.initialize import initial_payloads
from app.content.page_schemas import (
    ENVIRONMENT_CARE_ITEM_TEXTS,
    ENVIRONMENT_FEATURE_TEXTS,
    ENVIRONMENT_FEATURE_TITLE_PER_LINE,
    ENVIRONMENT_HEART_LIMIT,
    ENVIRONMENT_MEAL_TEXTS,
    ENVIRONMENT_SPACE_TEXTS,
    ENVIRONMENT_TEXTS,
    ENVIRONMENT_TITLES,
    EnvironmentPagePayload,
)
from app.content.registry import CONTENT_KIND_REGISTRY, set_at_path
from tests.conftest import publish_booking_consent

API = "/api/website/v1"
ITEM = f"{API}/admin/content-items/environment_page"
MEDIA = f"{API}/admin/media"
FIXTURE = Path(__file__).resolve().parents[2] / "web" / "server" / "data" / "site-fixture.json"

requires_ffmpeg = pytest.mark.skipif(
    shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None, reason="影片需要 ffmpeg／ffprobe"
)


def _fixture() -> dict:
    return json.loads(FIXTURE.read_text())


def _fixture_payload() -> dict:
    """初始化帶入的 payload（fixture 的 environmentPage 轉成後台欄位名稱）。"""
    entries = {kind: payload for kind, _campus, payload in initial_payloads(_fixture())}
    return copy.deepcopy(entries["environment_page"])


def _changed(**changes) -> dict:
    return {**_fixture_payload(), **changes}


def _with(path: list, value) -> dict:
    data = _fixture_payload()
    target = data
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    return data


def test_registered_as_shared_only_and_the_fixture_copy_is_valid():
    assert CONTENT_KIND_REGISTRY["environment_page"].shared_only is True
    payload = EnvironmentPagePayload.model_validate(_fixture_payload())
    assert payload.hero_photo is None and payload.care_photo is None and payload.feature.photo is None
    assert payload.hero_highlight == "安心"
    assert [space.campus_label for space in payload.spaces] == ["", "", "明華校", "", "", ""]
    assert [meal.time for meal in payload.meals] == ["08:30", "10:00", "11:40", "12:00", "15:30"]


@pytest.mark.parametrize(
    "changes",
    [
        # 固定項目數
        lambda: _changed(chapter_names=["幼兒保育", "校園環境", "幼兒餐點"]),
        lambda: _changed(hearts=["愛心", "細心", "耐心", "貼心"]),
        lambda: _changed(hearts=["愛心", "細心", "耐心", "貼心", "同理心", "信心"]),
        lambda: _with(["care_items"], _fixture_payload()["care_items"][:4]),
        lambda: _with(["care_items"], _fixture_payload()["care_items"] * 2),
        lambda: _with(["spaces"], _fixture_payload()["spaces"][:5]),
        lambda: _with(["meals"], _fixture_payload()["meals"][:4]),
        lambda: _with(["meals"], _fixture_payload()["meals"] + [_fixture_payload()["meals"][-1]]),
        # 愛心系列每項最多 4 字
        lambda: _with(["hearts", 4], "一二三四五"),
        lambda: _with(["hearts", 0], ""),
        # 餐點時間：HH:MM、嚴格由早到晚
        lambda: _with(["meals", 0, "time"], "8:30"),
        lambda: _with(["meals", 0, "time"], "24:00"),
        # 全形數字不放行（regex 的 \d 會比對全形，官網的時間格式只認半形）
        lambda: _with(["meals", 0, "time"], "0\uff18:30"),
        lambda: _with(["meals", 0, "time"], "08:3\uff10"),
        lambda: _with(["meals", 1, "time"], "08:30"),  # 和上一餐同時間
        lambda: _with(["meals", 2, "time"], "09:00"),  # 比上一餐早
        # 大標畫螢光的字要在大標某一行裡
        lambda: _changed(hero_highlight="開心"),
        # 標題：最多 3 行、每行字數
        lambda: _changed(hero_title="一\n二\n三\n四"),
        lambda: _changed(hero_title="一" * (ENVIRONMENT_TITLES["hero_title"][0] + 1)),
        lambda: _with(["feature", "title"], "一" * (ENVIRONMENT_FEATURE_TITLE_PER_LINE + 1)),
        # 內文不能換行、不能空白
        lambda: _changed(hero_lede="第一行\n第二行"),
        lambda: _changed(care_text="  "),
        # 會變成可執行連結的 scheme
        lambda: _changed(trail_hint="javascript:alert(1)"),
        lambda: _with(["spaces", 1, "text"], "JavaScript:alert(1)"),
        lambda: _with(["meals", 3, "note"], "data:text/html,x"),
    ],
)
def test_rules(changes):
    with pytest.raises(ValidationError):
        EnvironmentPagePayload.model_validate(changes())


def test_blankable_fields_are_saved_blank_and_the_page_still_validates():
    data = _changed(hero_highlight="", hero_notice="  　 ")
    data["spaces"][2]["campus_label"] = " "
    parsed = EnvironmentPagePayload.model_validate(data)
    assert (parsed.hero_highlight, parsed.hero_notice, parsed.spaces[2].campus_label) == ("", "", "")


def test_multiline_titles_accept_up_to_three_lines_and_stay_per_line():
    lines = ["一" * ENVIRONMENT_TITLES["care_title"][0]] * 3
    assert EnvironmentPagePayload.model_validate(_changed(care_title="\n".join(lines))).care_title.count("\n") == 2


def _locs(payload: dict) -> list[tuple]:
    with pytest.raises(ValidationError) as exc:
        EnvironmentPagePayload.model_validate(payload)
    return [e["loc"] for e in exc.value.errors()]


def test_error_locations_carry_the_item_index():
    assert ("hearts", 2) in _locs(_with(["hearts", 2], "一" * (ENVIRONMENT_HEART_LIMIT + 1)))
    assert ("chapter_names", 1) in _locs(_with(["chapter_names", 1], "一" * 7))
    assert ("care_items", 3, "text") in _locs(_with(["care_items", 3, "text"], "字" * 200))
    assert ("spaces", 5, "note") in _locs(_with(["spaces", 5, "note"], "字" * 40))
    assert ("meals", 3, "time") in _locs(_with(["meals", 3, "time"], "12:60"))
    # 順序不對指到整份清單（不是某一餐）
    assert ("meals",) in _locs(_with(["meals", 3, "time"], "11:00"))


def test_meal_order_error_names_the_rule():
    with pytest.raises(ValidationError, match="由早到晚"):
        EnvironmentPagePayload.model_validate(_with(["meals", 2, "time"], "09:00"))


def test_limits_are_one_and_a_half_times_the_builtin_copy():
    """上限＝內建文字長度 × 1.5 取整（標題逐行；列表各項取該欄最長那筆）。

    例外：第四章段落（內建那句 2026-10-12 改過，上限依新句子算）；首屏大標與第四章標題用版面實測值
    （page_schemas.py 的說明：×1.5 會讓每行折成兩行）。"""
    data = _fixture()["environmentPage"]

    def longest(value) -> int:
        if isinstance(value, str):
            return max(len(line) for line in value.split("\n"))
        return max(longest(item) for item in value)

    def field(source: dict, name: str):
        parts = name.split("_")
        return source[parts[0] + "".join(part.title() for part in parts[1:])]

    measured = {"hero_title": 9, "tour_title": 10}
    for name, (per_line, *_rest) in ENVIRONMENT_TITLES.items():
        expected = measured.get(name, int(longest(field(data, name)) * 1.5))
        assert per_line == expected, name
        assert per_line >= longest(field(data, name)), name
    for name, (limit, *_rest) in ENVIRONMENT_TEXTS.items():
        assert limit == int(longest(field(data, name)) * 1.5), name
    for table, items in (
        (ENVIRONMENT_CARE_ITEM_TEXTS, data["careItems"]),
        (ENVIRONMENT_SPACE_TEXTS, data["spaces"]),
        (ENVIRONMENT_MEAL_TEXTS, data["meals"]),
    ):
        for name, (limit, *_rest) in table.items():
            assert limit == int(longest([field(item, name) for item in items]) * 1.5), name
    for name, (limit, *_rest) in ENVIRONMENT_FEATURE_TEXTS.items():
        assert limit == int(longest(data["feature"][name]) * 1.5), name
    assert ENVIRONMENT_FEATURE_TITLE_PER_LINE == int(longest(data["feature"]["title"]) * 1.5)
    assert ENVIRONMENT_HEART_LIMIT == int(longest(data["hearts"]) * 1.5)


def test_every_builtin_text_fits_its_own_limit():
    # 預設內容本身要過驗證（上面的 test_registered… 已驗過），這裡再確認沒有一欄剛好貼著上限：
    # 上限都比內建長度大（1.5 倍），後台改寫才有空間。
    payload = EnvironmentPagePayload.model_validate(_fixture_payload())
    assert len(payload.hero_lede) < ENVIRONMENT_TEXTS["hero_lede"][0]
    assert len(payload.feature.text) < ENVIRONMENT_FEATURE_TEXTS["text"][0]


def test_media_refs_cover_every_photo_slot_as_images():
    ids = [str(uuid.uuid4()) for _ in range(2 + 1 + 5 + 6)]
    data = _fixture_payload()
    data["hero_photo"] = {"media_id": ids[0]}
    data["care_photo"] = {"media_id": ids[1]}
    data["feature"]["photo"] = {"media_id": ids[2]}
    for i in range(5):
        data["care_items"][i]["photo"] = {"media_id": ids[3 + i]}
    for i in range(6):
        data["spaces"][i]["photo"] = {"media_id": ids[8 + i]}
    refs = CONTENT_KIND_REGISTRY["environment_page"].extract_media_refs(data)
    assert [(str(r.media_id), r.path) for r in refs] == [
        (ids[0], "hero_photo.media_id"),
        (ids[1], "care_photo.media_id"),
        (ids[2], "feature.photo.media_id"),
        *[(ids[3 + i], f"care_items[{i}].photo.media_id") for i in range(5)],
        *[(ids[8 + i], f"spaces[{i}].photo.media_id") for i in range(6)],
    ]
    assert {r.kind for r in refs} == {"image"}
    assert refs[3].label == "健康把關紀錄" and refs[2].label == "在遊戲裡，\n慢慢長大。"
    replacement = str(uuid.uuid4())
    for ref in (refs[2], refs[4], refs[-1]):
        set_at_path(data, ref.path, replacement)
    assert data["feature"]["photo"]["media_id"] == data["care_items"][1]["photo"]["media_id"] == replacement
    assert data["spaces"][5]["photo"]["media_id"] == replacement


def test_no_refs_when_no_photo_is_chosen():
    assert CONTENT_KIND_REGISTRY["environment_page"].extract_media_refs(_fixture_payload()) == []


@pytest.mark.asyncio
async def test_initialize_publishes_the_fixture_environment_copy(db_session):
    # 初始化後已發布的版本要等於 fixture 那段文案，CMS 發布前後畫面才不會跳。
    from app.content import service
    from app.content.initialize import initialize_content

    await initialize_content(db_session, _fixture())
    published = await service.published_payload(db_session, "environment_page", None)
    assert published == EnvironmentPagePayload.model_validate(_fixture_payload()).model_dump()
    fixture = _fixture()["environmentPage"]
    # 巢狀欄位名稱 camelCase → snake_case 要真的轉到（轉不到會被靜默丟掉，變成空字串）
    assert published["spaces"][2]["campus_label"] == fixture["spaces"][2]["campusLabel"] == "明華校"
    assert published["feature"]["note"] == fixture["feature"]["note"]
    assert published["hero_title"] == fixture["heroTitle"]
    assert published["tour_text"] == fixture["tourText"]
    assert published["hero_photo"] is None and published["care_photo"] is None


def test_initialize_entry_has_no_photos():
    data = _fixture_payload()
    assert data["hero_photo"] is None and data["care_photo"] is None and data["feature"]["photo"] is None
    assert all(item["photo"] is None for item in data["care_items"] + data["spaces"])


def test_the_fourth_chapter_text_no_longer_credits_the_campus_pages():
    # 分校資訊頁已拿掉（2026-10-12），第四章段落不再說「取自各分校頁」。
    assert "分校頁" not in _fixture()["environmentPage"]["tourText"]


async def _save(client, payload: dict):
    item = (await client.get(ITEM)).json()
    return await client.post(f"{ITEM}/revisions", json={"expected_version": item["latest_version"], "payload": payload})


@pytest.mark.asyncio
async def test_public_site_has_page_only_after_publish(admin_client, public_client, db_session):
    await publish_booking_consent(db_session)  # 先有一個 release，/public/site 才有內容可讀
    assert "environment_page" not in (await public_client.get(f"{API}/public/site")).json()["content"]
    saved = await _save(admin_client, _fixture_payload())
    assert saved.status_code == 201, saved.text
    published = await admin_client.post(f"{ITEM}/publish", json={"revision_id": saved.json()["latest_revision"]["id"]})
    assert published.status_code == 200, published.text
    live = (await public_client.get(f"{API}/public/site")).json()["content"]["environment_page"]
    assert live == EnvironmentPagePayload.model_validate(_fixture_payload()).model_dump()


@pytest.mark.asyncio
async def test_unknown_media_in_a_list_photo_is_rejected(admin_client):
    payload = _fixture_payload()
    payload["spaces"][3]["photo"] = {"media_id": str(uuid.uuid4())}
    saved = await _save(admin_client, payload)
    assert saved.status_code == 422
    assert saved.json()["detail"]["code"] == "MEDIA_NOT_FOUND"


@pytest.mark.asyncio
async def test_meals_out_of_order_returns_422_and_writes_nothing(admin_client):
    payload = _with(["meals", 2, "time"], "09:00")
    saved = await _save(admin_client, payload)
    assert saved.status_code == 422
    assert [error["loc"] for error in saved.json()["detail"]] == [["meals"]]
    assert (await admin_client.get(ITEM)).json()["latest_version"] == 0


@pytest.mark.asyncio
async def test_a_wrong_count_returns_422(admin_client):
    payload = _fixture_payload()
    payload["care_items"].pop()
    saved = await _save(admin_client, payload)
    assert saved.status_code == 422
    assert [error["loc"] for error in saved.json()["detail"]] == [["care_items"]]


def _jpeg(width: int = 160, height: int = 120) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (width, height), (78, 184, 122)).save(buf, "JPEG")
    return buf.getvalue()


async def _upload(client) -> dict:
    # 環境頁是全站共用內容，用共用素材（不帶 campus_key）。
    response = await client.post(MEDIA, data={"kind": "image"}, files={"file": ("env.jpg", _jpeg(), "image/jpeg")})
    assert response.status_code == 201, response.text
    return response.json()


@requires_ffmpeg
@pytest.mark.asyncio
async def test_video_as_a_photo_is_rejected(admin_client):
    video = await admin_client.post(
        MEDIA,
        data={"kind": "video"},
        files={"file": ("a.mp4", (Path("/tmp/media-fixtures") / "test.mp4").read_bytes(), "video/mp4")},
    )
    assert video.status_code == 201, video.text
    payload = _fixture_payload()
    payload["care_items"][1]["photo"] = {"media_id": video.json()["id"]}
    saved = await _save(admin_client, payload)
    assert saved.status_code == 422
    assert saved.json()["detail"]["code"] == "MEDIA_KIND_MISMATCH"
    assert saved.json()["detail"]["field_path"] == "care_items[1].photo.media_id"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("path", "field_path"),
    [
        (["hero_photo"], "hero_photo.media_id"),
        (["feature", "photo"], "feature.photo.media_id"),
        (["care_items", 4, "photo"], "care_items[4].photo.media_id"),
    ],
)
async def test_photo_is_tracked_protected_and_batch_replaced(admin_client, path, field_path):
    old = await _upload(admin_client)
    payload = _fixture_payload()
    target = payload
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = {"media_id": old["id"], "focus_x": None, "focus_y": None}
    saved = await _save(admin_client, payload)
    assert saved.status_code == 201, saved.text
    item = saved.json()

    usages = (await admin_client.get(f"{MEDIA}/{old['id']}/usages")).json()
    [ref] = usages["references"]
    assert (ref["kind"], ref["field_path"], ref["version"]) == ("environment_page", field_path, 1)
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
    assert replaced.json()["items"][0]["field_paths"] == [field_path]
    latest = (await admin_client.get(ITEM)).json()["latest_revision"]["payload"]
    swapped = latest
    for key in path:
        swapped = swapped[key]
    assert swapped["media_id"] == new["id"]
    assert (await admin_client.get(f"{MEDIA}/{old['id']}/usages")).json()["references"] == []


@pytest.mark.asyncio
async def test_editor_can_read_but_not_edit(editor_client):
    assert (await editor_client.get(ITEM)).status_code == 200
    denied = await _save(editor_client, _fixture_payload())
    assert denied.status_code == 403
