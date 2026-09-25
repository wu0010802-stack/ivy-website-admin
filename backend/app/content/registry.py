from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Callable

from pydantic import BaseModel

from app.content.schemas import (
    AdmissionContentPayload,
    BookingContentPayload,
    CampusFaqPayload,
    CampusNewsPayload,
    CampusProfilePayload,
    CampusTourPayload,
    DayExperiencePayload,
    HomeAboutPayload,
    HomeCampusBoardPayload,
    HomeHeroPayload,
    HomeNewsPayload,
    LEGACY_DEMO_CONSENT_TEXT,
    PRIVACY_SAMPLE_MARKER,
    SiteFooterPayload,
    SharedFaqPayload,
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


def _extract_news_media_ids(payload: dict) -> list[uuid.UUID]:
    """消息封面，加上結構化內文裡的圖片區塊（home_news、campus_news 共用）。"""
    articles = payload.get("articles", [])
    blocks = [
        block
        for article in articles
        for block in article.get("body", []) or []
        if isinstance(block, dict) and block.get("type") == "image"
    ]
    return _media_ids_from_images(articles) + _media_ids_from_images(blocks)


def _extract_site_meta_media_ids(payload: dict) -> list[uuid.UUID]:
    share = payload.get("share_image") or ""
    try:
        return [uuid.UUID(share)] if share else []
    except ValueError:
        return []


def _mark_tour_spots_for_review(payload: dict, previous: dict | None) -> dict:
    """照片換了的場景，熱點一律標成待複核；照片沒變則沿用前端送來的值
    （園方按「熱點已複核」就是送 True）。全新的場景視為在新照片上放點，
    不需要複核。"""
    old_images = {
        scene.get("key"): scene.get("image") for scene in (previous or {}).get("scenes", [])
    }
    for scene in payload.get("scenes", []):
        key = scene.get("key")
        if key in old_images and old_images[key] != scene.get("image"):
            scene["spots_reviewed"] = False
    return payload


def _tour_publish_blocker(payload: dict) -> str | None:
    pending = [s.get("name") or s.get("key") for s in payload.get("scenes", []) if s.get("spots_reviewed") is False]
    if pending:
        return f"場景「{'、'.join(pending)}」換了照片，熱點還沒複核，確認位置後才能發布"
    return None


def _booking_publish_blocker(payload: dict) -> str | None:
    """原型的示範同意文字、隱私說明還留著後台帶入的示意文字時不能發布
    （正式條款由園方提供）。家長送單會記錄同意的是哪一版，發布出去的就是
    家長看到的文字。"""
    if (payload.get("consent_text") or "").strip() == LEGACY_DEMO_CONSENT_TEXT:
        return "同意條款文字還是原型的示範文字（資料不會傳送給學校），請改成正式文字再發布"
    texts = [payload.get("privacy_title", "")]
    for section in payload.get("privacy_sections", []):
        texts += [section.get("heading", ""), section.get("body", "")]
    if any(PRIVACY_SAMPLE_MARKER in (text or "") for text in texts):
        return f"隱私說明還有「{PRIVACY_SAMPLE_MARKER}」草稿文字，請換成園方提供的正式內容再發布"
    return None


_SCHEDULE_KEYS = ("show_from", "show_until")


def _visible_entries(entries: list[dict], today: str) -> list[dict]:
    # 排程日期是後台用的，官網不需要，也不必讓訪客看到「幾號會上架」。
    return [
        {k: v for k, v in entry.items() if k not in _SCHEDULE_KEYS}
        for entry in entries
        if is_scheduled_visible(entry, today)
    ]


def _public_news(payload: dict, today: str) -> dict:
    """只把今天該顯示的消息與活動交給官網；尚未上架或已過下架日的留在
    後台，發布紀錄裡的原始 payload 不動（home_news、campus_news 共用）。"""
    return {
        **payload,
        "articles": _visible_entries(payload.get("articles", []), today),
        "events": _visible_entries(payload.get("events", []), today),
    }


def _public_home_hero(payload: dict, today: str) -> dict:
    # 2026-09-23 拿掉首屏按鈕：舊版本裡的按鈕文字不再輸出。
    return {k: v for k, v in payload.items() if k != "cta_label"}


def _public_shared_faq(payload: dict, today: str) -> dict:
    # 停用的共用題目不輸出（舊資料沒有 enabled 欄位，視為啟用）。
    return {**payload, "items": [i for i in payload.get("items", []) if i.get("enabled", True)]}


def _public_campus_faq(payload: dict, today: str) -> dict:
    """停用的本校題目只留問題文字與 enabled=False：官網靠它把同一題的共用
    題目藏起來（見 CampusFaqPayload），回答不必讓訪客拿到。"""
    items = [
        item if item.get("enabled", True) else {"q": item.get("q", ""), "a": "", "enabled": False}
        for item in payload.get("items", [])
    ]
    return {**payload, "items": items}


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
    # 存草稿前的伺服器端調整（新 payload, 上一版 payload 或 None）→ 新 payload。
    before_save: Callable[[dict, dict | None], dict] = field(default=lambda payload, previous: payload)
    # 發布前檢查；回傳字串代表不能發布的原因。
    publish_blocker: Callable[[dict], str | None] = field(default=lambda payload: None)
    # 公開 API 輸出前的過濾（例如依上下架日期），參數是 payload 與台北
    # 時間的今天（YYYY-MM-DD）。預設原樣輸出。
    public_view: Callable[[dict, str], dict] = field(default=lambda payload, today: payload)
    # 欄位規則版本，存進每一版 revision（ContentRevision.schema_version）。只加
    # 有預設值的欄位不必調；改名、刪欄位、收緊規則讓舊資料過不了驗證時才加一，
    # 並在發布與還原時處理舊版本。2026-09-25 以前存的版本一律記為 1。
    schema_version: int = 1


CONTENT_KIND_REGISTRY: dict[str, ContentKindConfig] = {
    "home_about": ContentKindConfig(HomeAboutPayload, shared_only=True),
    "home_hero": ContentKindConfig(HomeHeroPayload, shared_only=True, public_view=_public_home_hero),
    "site_footer": ContentKindConfig(SiteFooterPayload, shared_only=True),
    "site_meta": ContentKindConfig(
        SiteMetaPayload, shared_only=True, extract_media_ids=_extract_site_meta_media_ids
    ),
    "home_campus_board": ContentKindConfig(HomeCampusBoardPayload, shared_only=True),
    "booking_content": ContentKindConfig(
        BookingContentPayload, shared_only=True, publish_blocker=_booking_publish_blocker
    ),
    "day_experience": ContentKindConfig(DayExperiencePayload, shared_only=True),
    # 2：2026-09-25 起消息與活動的校區改成 scope＋campus_keys（舊版的 campus
    # 文字在驗證時換算，見 schemas._ScopedEntry），並加上內文、推薦與活動時間。
    "home_news": ContentKindConfig(
        HomeNewsPayload,
        shared_only=True,
        extract_media_ids=_extract_news_media_ids,
        public_view=_public_news,
        schema_version=2,
    ),
    # 全站共用常見問題；各校在 campus_faq 決定要不要顯示、放在哪裡。
    "shared_faq": ContentKindConfig(SharedFaqPayload, shared_only=True, public_view=_public_shared_faq),
    "admission_content": ContentKindConfig(AdmissionContentPayload, shared_only=True),
    # 以下需要搭配 campus_key，每校各自一份，不是共用內容。
    "campus_profile": ContentKindConfig(CampusProfilePayload, shared_only=False),
    "campus_faq": ContentKindConfig(CampusFaqPayload, shared_only=False, public_view=_public_campus_faq),
    # 各校自己的消息與活動（分校人員只編本校），官網和 home_news 合併顯示。
    "campus_news": ContentKindConfig(
        CampusNewsPayload,
        shared_only=False,
        extract_media_ids=_extract_news_media_ids,
        public_view=_public_news,
    ),
    "campus_tour": ContentKindConfig(
        CampusTourPayload,
        shared_only=False,
        extract_media_ids=_extract_campus_tour_media_ids,
        before_save=_mark_tour_spots_for_review,
        publish_blocker=_tour_publish_blocker,
    ),
}


def schema_version_of(kind: str) -> int:
    config = CONTENT_KIND_REGISTRY.get(kind)
    return config.schema_version if config is not None else 1
