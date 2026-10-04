"""特色教學頁（curriculum_page）：payload 規則與素材引用。"""
from __future__ import annotations

import copy
import uuid

import pytest
from pydantic import ValidationError

from app.content.page_schemas import CURRICULUM_DIRECTION_KEYS, CurriculumPagePayload
from app.content.registry import CONTENT_KIND_REGISTRY, set_at_path


def _base(**changes) -> dict:
    payload = {
        "hero_eyebrow": "常春藤幼兒園 · 特色教學",
        "hero_title": "從動手做開始，\n愛上學習。",
        "hero_highlight": "動手做",
        "hero_lede": "四個年段與七個課程方向。",
        "hero_notice": "",
        "chapters": [{"label": f"章節{i}", "hint": "小字"} for i in range(4)],
        "years_title": "從幼幼班到大班，\n一年一個樣子。",
        "years_text": "帶著走的核心素養。",
        "spiral_label": "螺旋式課程",
        "spiral_text": "加深、加廣課程。",
        "years_caption": "",
        "years": [{"motto": "老師好愛我", "text": "說明"} for _ in range(4)],
        "directions_title": "每一種學習，\n都從好奇開始。",
        "directions_text": "說明。",
        "directions": [{"key": key, "title": "標題", "sub": "副標", "text": "說明"} for key in CURRICULUM_DIRECTION_KEYS],
        "gallery_title": "每一件作品",
        "gallery_text": "說明。",
        "gallery_source": "",
        "gallery": [{"label": "作品"} for _ in range(8)],
        "daily_title": "五件事",
        "daily_text": "說明。",
        "daily_source": "",
        "daily": [{"title": "靜心", "text": "說明"} for _ in range(5)],
        "belief_title": "我們相信",
        "beliefs": ["重視愛與關懷"] * 5,
        "belief_close": "結語。",
        "belief_source": "",
    }
    payload.update(changes)
    return payload


def test_registered_as_shared_only_and_valid_base():
    assert CONTENT_KIND_REGISTRY["curriculum_page"].shared_only is True
    parsed = CurriculumPagePayload.model_validate(_base())
    assert parsed.hero_photo is None and parsed.directions[0].photo is None


def test_title_newlines_are_normalised():
    parsed = CurriculumPagePayload.model_validate(_base(hero_title="從動手做開始，\r\n愛上學習。"))
    assert parsed.hero_title == "從動手做開始，\n愛上學習。"


@pytest.mark.parametrize(
    "title",
    ["一\n二\n三\n四", "一" * 15, "從動手做開始，\n\n愛上學習。", "  ", "\n愛上學習。"],
)
def test_title_rules(title):
    with pytest.raises(ValidationError):
        CurriculumPagePayload.model_validate(_base(hero_title=title))


@pytest.mark.parametrize(
    "changes",
    [
        {"hero_lede": "第一行\n第二行"},
        {"hero_lede": "字" * 91},
        {"hero_lede": "  "},
        {"spiral_label": "字" * 11},
        {"beliefs": ["字" * 25] + ["重視愛與關懷"] * 4},
        {"hero_lede": "javascript:alert(1)"},
    ],
)
def test_text_rules(changes):
    with pytest.raises(ValidationError):
        CurriculumPagePayload.model_validate(_base(**changes))


def test_optional_texts_may_be_blank():
    parsed = CurriculumPagePayload.model_validate(_base(hero_notice="", gallery_source="", years_caption="", hero_highlight=""))
    assert parsed.hero_notice == "" and parsed.hero_highlight == ""


@pytest.mark.parametrize("field,count", [("chapters", 3), ("years", 5), ("gallery", 7), ("daily", 6), ("beliefs", 4)])
def test_lists_have_fixed_counts(field, count):
    data = copy.deepcopy(_base())
    item = data[field][0]
    data[field] = [copy.deepcopy(item) for _ in range(count)]
    with pytest.raises(ValidationError):
        CurriculumPagePayload.model_validate(data)


def test_direction_keys_are_fixed_and_quote_has_no_photo():
    data = _base()
    data["directions"] = list(reversed(data["directions"]))
    with pytest.raises(ValidationError):
        CurriculumPagePayload.model_validate(data)
    data = _base()
    data["directions"][3]["photo"] = {"media_id": str(uuid.uuid4())}
    with pytest.raises(ValidationError, match="沒有照片"):
        CurriculumPagePayload.model_validate(data)


@pytest.mark.parametrize("highlight", ["不存在", "開始，\n愛上"])
def test_highlight_must_be_inside_one_title_line(highlight):
    with pytest.raises(ValidationError, match="顏料"):
        CurriculumPagePayload.model_validate(_base(hero_highlight=highlight))


def test_media_refs_cover_every_photo_slot():
    ids = [str(uuid.uuid4()) for _ in range(5)]
    data = _base(hero_photo={"media_id": ids[0]}, years_photo={"media_id": ids[1]})
    data["directions"][2]["photo"] = {"media_id": ids[2]}
    data["gallery"][7]["photo"] = {"media_id": ids[3], "focus_x": 30, "focus_y": 40}
    data["daily"][0]["photo"] = {"media_id": ids[4]}
    refs = CONTENT_KIND_REGISTRY["curriculum_page"].extract_media_refs(data)
    assert [(str(r.media_id), r.path, r.kind) for r in refs] == [
        (ids[0], "hero_photo.media_id", "image"),
        (ids[1], "years_photo.media_id", "image"),
        (ids[2], "directions[2].photo.media_id", "image"),
        (ids[3], "gallery[7].photo.media_id", "image"),
        (ids[4], "daily[0].photo.media_id", "image"),
    ]
    assert refs[2].label == "標題"
    replacement = str(uuid.uuid4())
    set_at_path(data, refs[2].path, replacement)
    assert data["directions"][2]["photo"]["media_id"] == replacement
