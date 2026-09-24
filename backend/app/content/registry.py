from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Callable

from pydantic import BaseModel

from app.content.schemas import (
    AdmissionContentPayload,
    BookingContentPayload,
    CampusFaqPayload,
    CampusProfilePayload,
    CampusTourPayload,
    DayExperiencePayload,
    HomeAboutPayload,
    HomeCampusBoardPayload,
    HomeHeroPayload,
    HomeNewsPayload,
    SiteFooterPayload,
    SiteMetaPayload,
    is_scheduled_visible,
)


def _media_ids_from_images(entries: list[dict]) -> list[uuid.UUID]:
    """`image` 欄位同時相容兩種值：舊的 fixture 素材代號字串（例如
    "campus"，不是有效 UUID，直接略過）與素材庫的媒體 UUID。只有後者
    需要建立 MediaUsage 引用保護。"""
    ids: list[uuid.UUID] = []
    for entry in entries:
        image = entry.get("image", "")
        try:
            ids.append(uuid.UUID(str(image)))
        except (ValueError, AttributeError):
            continue
    return ids


def _extract_campus_tour_media_ids(payload: dict) -> list[uuid.UUID]:
    return _media_ids_from_images(payload.get("scenes", []))


def _extract_home_news_media_ids(payload: dict) -> list[uuid.UUID]:
    return _media_ids_from_images(payload.get("articles", []))


_SCHEDULE_KEYS = ("show_from", "show_until")


def _visible_entries(entries: list[dict], today: str) -> list[dict]:
    # 排程日期是後台用的，官網不需要，也不必讓訪客看到「幾號會上架」。
    return [
        {k: v for k, v in entry.items() if k not in _SCHEDULE_KEYS}
        for entry in entries
        if is_scheduled_visible(entry, today)
    ]


def _public_home_news(payload: dict, today: str) -> dict:
    """只把今天該顯示的消息與活動交給官網；尚未上架或已過下架日的留在
    後台，發布紀錄裡的原始 payload 不動。"""
    return {
        **payload,
        "articles": _visible_entries(payload.get("articles", []), today),
        "events": _visible_entries(payload.get("events", []), today),
    }


@dataclass(frozen=True)
class ContentKindConfig:
    payload_model: type[BaseModel]
    # True：跨校共用內容，只有 super_admin 能編，分校不能改共用內容。
    # False：該 kind 需要搭配 campus_key，一般 campus scope 規則套用。
    shared_only: bool
    # 從已驗證過的 payload dict 抓出目前引用了哪些素材庫媒體 UUID，供
    # content/service.py 同步 MediaUsage（沒有引用媒體庫的 kind 用預設
    # 的「永遠沒有引用」，不必特別處理）。
    extract_media_ids: Callable[[dict], list[uuid.UUID]] = field(default=lambda payload: [])
    # 公開 API 輸出前的過濾（例如依上下架日期），參數是 payload 與台北
    # 時間的今天（YYYY-MM-DD）。預設原樣輸出。
    public_view: Callable[[dict, str], dict] = field(default=lambda payload, today: payload)


CONTENT_KIND_REGISTRY: dict[str, ContentKindConfig] = {
    "home_about": ContentKindConfig(HomeAboutPayload, shared_only=True),
    "home_hero": ContentKindConfig(HomeHeroPayload, shared_only=True),
    "site_footer": ContentKindConfig(SiteFooterPayload, shared_only=True),
    "site_meta": ContentKindConfig(SiteMetaPayload, shared_only=True),
    "home_campus_board": ContentKindConfig(HomeCampusBoardPayload, shared_only=True),
    "booking_content": ContentKindConfig(BookingContentPayload, shared_only=True),
    "day_experience": ContentKindConfig(DayExperiencePayload, shared_only=True),
    "home_news": ContentKindConfig(
        HomeNewsPayload,
        shared_only=True,
        extract_media_ids=_extract_home_news_media_ids,
        public_view=_public_home_news,
    ),
    "admission_content": ContentKindConfig(AdmissionContentPayload, shared_only=True),
    # 以下三種需要搭配 campus_key，每校各自一份，不是共用內容。
    "campus_profile": ContentKindConfig(CampusProfilePayload, shared_only=False),
    "campus_faq": ContentKindConfig(CampusFaqPayload, shared_only=False),
    "campus_tour": ContentKindConfig(
        CampusTourPayload, shared_only=False, extract_media_ids=_extract_campus_tour_media_ids
    ),
}
