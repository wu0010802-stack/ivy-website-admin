"""關於常春藤頁（about_page）：payload 規則與素材引用。"""
from __future__ import annotations

import copy
import uuid

import pytest
from pydantic import ValidationError

from app.content.page_schemas import ABOUT_MILESTONE_KEYS, AboutPagePayload
from app.content.registry import CONTENT_KIND_REGISTRY

YEARS = (1997, 2001, 2005, 2020, 2021)


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
