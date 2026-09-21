from __future__ import annotations

from dataclasses import dataclass

from pydantic import BaseModel

from app.content.schemas import (
    BookingContentPayload,
    CampusFaqPayload,
    CampusProfilePayload,
    CampusTourPayload,
    DayExperiencePayload,
    HomeAboutPayload,
    HomeCampusBoardPayload,
    HomeHeroPayload,
    SiteFooterPayload,
    SiteMetaPayload,
)


@dataclass(frozen=True)
class ContentKindConfig:
    payload_model: type[BaseModel]
    # True：跨校共用內容，只有 super_admin 能編，分校不能改共用內容。
    # False：該 kind 需要搭配 campus_key，一般 campus scope 規則套用。
    shared_only: bool


CONTENT_KIND_REGISTRY: dict[str, ContentKindConfig] = {
    "home_about": ContentKindConfig(HomeAboutPayload, shared_only=True),
    "home_hero": ContentKindConfig(HomeHeroPayload, shared_only=True),
    "site_footer": ContentKindConfig(SiteFooterPayload, shared_only=True),
    "site_meta": ContentKindConfig(SiteMetaPayload, shared_only=True),
    "home_campus_board": ContentKindConfig(HomeCampusBoardPayload, shared_only=True),
    "booking_content": ContentKindConfig(BookingContentPayload, shared_only=True),
    "day_experience": ContentKindConfig(DayExperiencePayload, shared_only=True),
    # 以下兩種需要搭配 campus_key，每校各自一份，不是共用內容。
    "campus_profile": ContentKindConfig(CampusProfilePayload, shared_only=False),
    "campus_faq": ContentKindConfig(CampusFaqPayload, shared_only=False),
    "campus_tour": ContentKindConfig(CampusTourPayload, shared_only=False),
}
