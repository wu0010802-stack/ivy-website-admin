from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator

# 階段 B 第一版只實作一種內容 kind（home_about，首頁「關於常春藤」文字）；
# 其餘內容仍由 Nuxt 端 fixture 提供，尚未搬進這套 typed content 系統。
# 完整 ContentItem.kind 清單與逐項 editor 屬於 Task 5 剩餘範圍，見
# docs/website-admin/acceptance.md 的階段 B 小結。

_BLOCKED_URL_SCHEMES = ("javascript:", "data:", "vbscript:")


def _reject_unsafe_scheme(value: str) -> str:
    lowered = value.strip().lower()
    if any(lowered.startswith(scheme) for scheme in _BLOCKED_URL_SCHEMES):
        raise ValueError("不允許的網址格式")
    return value


class HomeAboutPayload(BaseModel):
    title: str
    since_label: str
    body_text: str
    caption: str

    @field_validator("title", "since_label", "body_text", "caption")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)


class HomeHeroPayload(BaseModel):
    eyebrow: str
    copy_lines: list[str]
    cta_label: str

    @field_validator("eyebrow", "cta_label")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)

    @field_validator("copy_lines")
    @classmethod
    def _copy_lines_safe_and_bounded(cls, value: list[str]) -> list[str]:
        if not (1 <= len(value) <= 3):
            raise ValueError("copy_lines 需為 1 到 3 行")
        return [_reject_unsafe_scheme(line) for line in value]


class SiteFooterPayload(BaseModel):
    tagline: str
    copyright: str
    bottom_note: str
    campus_list_label: str

    @field_validator("tagline", "copyright", "bottom_note", "campus_list_label")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)


class SiteMetaPayload(BaseModel):
    title: str
    description: str
    header_phone_number: str
    header_phone_note: str

    @field_validator("title", "description", "header_phone_number", "header_phone_note")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)


class HomeCampusBoardPayload(BaseModel):
    section_title: str
    eyebrow: str
    note: str

    @field_validator("section_title", "eyebrow", "note")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)


class BookingContentPayload(BaseModel):
    cta_label: str
    cta_label_en: str
    consent_text: str
    banner_title_template: str
    banner_body: str
    banner_button_label: str

    @field_validator(
        "cta_label",
        "cta_label_en",
        "consent_text",
        "banner_title_template",
        "banner_body",
        "banner_button_label",
    )
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)


class DayMomentPayload(BaseModel):
    key: str
    time: str
    label: str
    caption: str
    title: str
    story: str
    question: str
    answer: str

    @field_validator("time", "label", "caption", "title", "story", "question", "answer")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)


class DayExperiencePayload(BaseModel):
    eyebrow: str
    eyebrow_en: str
    note: str
    source_note: str
    moments: list[DayMomentPayload]

    @field_validator("eyebrow", "eyebrow_en", "note", "source_note")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)

    @field_validator("moments")
    @classmethod
    def _moments_bounded(cls, value: list[DayMomentPayload]) -> list[DayMomentPayload]:
        if not (1 <= len(value) <= 12):
            raise ValueError("moments 需為 1 到 12 筆")
        keys = [m.key for m in value]
        if len(keys) != len(set(keys)):
            raise ValueError("moments 的 key 不可重複")
        return value


class CampusProfilePayload(BaseModel):
    name: str
    district: str
    address: str
    phone: str
    intro: str
    description: str
    facebook: str
    fb_note: str
    # 空字串代表這間校區尚未提供 LINE 官方帳號，跟前端 fixture 的
    # `line: string | null` 語意相同（web 端疊資料時把空字串轉回 null）。
    line: str

    @field_validator(
        "name", "district", "address", "phone", "intro", "description", "facebook", "fb_note", "line"
    )
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)


class CampusFaqItemPayload(BaseModel):
    q: str
    a: str

    @field_validator("q", "a")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)


class CampusFaqPayload(BaseModel):
    items: list[CampusFaqItemPayload]

    @field_validator("items")
    @classmethod
    def _items_bounded(cls, value: list[CampusFaqItemPayload]) -> list[CampusFaqItemPayload]:
        if not (1 <= len(value) <= 20):
            raise ValueError("items 需為 1 到 20 筆")
        return value


class TourSpotPayload(BaseModel):
    name: str
    x: float = Field(ge=0, le=100)
    y: float = Field(ge=0, le=100)
    text: str
    question: str

    @field_validator("name", "text", "question")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)


class TourScenePayload(BaseModel):
    key: str
    name: str
    image: str
    intro: str
    spots: list[TourSpotPayload]

    @field_validator("key", "name", "image", "intro")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)

    @field_validator("spots")
    @classmethod
    def _spots_bounded(cls, value: list[TourSpotPayload]) -> list[TourSpotPayload]:
        if not (1 <= len(value) <= 8):
            raise ValueError("每個場景的熱點需為 1 到 8 個")
        return value


class CampusTourPayload(BaseModel):
    scenes: list[TourScenePayload]

    @field_validator("scenes")
    @classmethod
    def _scenes_bounded(cls, value: list[TourScenePayload]) -> list[TourScenePayload]:
        if not (1 <= len(value) <= 6):
            raise ValueError("場景需為 1 到 6 個")
        keys = [s.key for s in value]
        if len(keys) != len(set(keys)):
            raise ValueError("場景的 key 不可重複")
        return value


class ContentRevisionCreateRequest(BaseModel):
    expected_version: int
    payload: dict


class ContentRevisionOut(BaseModel):
    id: uuid.UUID
    version: int
    payload: dict
    created_at: datetime

    model_config = {"from_attributes": True}


class ContentItemOut(BaseModel):
    id: uuid.UUID
    kind: str
    campus_key: str | None
    latest_version: int
    current_published_revision_id: uuid.UUID | None
    latest_revision: ContentRevisionOut | None

    model_config = {"from_attributes": True}


class PublishRequest(BaseModel):
    revision_id: uuid.UUID


class PublicSiteOut(BaseModel):
    schema_version: str
    release_id: str | None
    content: dict
