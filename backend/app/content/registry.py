from __future__ import annotations

from dataclasses import dataclass

from pydantic import BaseModel

from app.content.schemas import HomeAboutPayload, HomeHeroPayload, SiteFooterPayload


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
}
