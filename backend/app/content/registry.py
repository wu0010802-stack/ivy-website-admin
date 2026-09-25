from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field, replace
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
    campus_faq_blank_items,
    is_scheduled_visible,
)


@dataclass(frozen=True)
class MediaRef:
    """內容裡一處素材引用：素材 id、欄位路徑（例如 `articles[2].body[0].image`）
    與那一項的標題（消息標題、場景名稱），給素材庫的「用在哪裡」與批次替換用。
    `kind` 是這個版位要的素材種類（image／video），存檔時檢查；None＝不檢查
    （2026-09-25 以前的圖片欄位）。`clip` 是影片只播其中一段時的
    （開始秒數, 結束秒數或 None），存檔時對照影片長度檢查。"""

    media_id: uuid.UUID
    path: str
    label: str | None = None
    kind: str | None = None
    clip: tuple[float, float | None] | None = None


def _media_ref(value: object, path: str, label: object = None) -> MediaRef | None:
    """`image` 欄位同時相容兩種值：舊的 fixture 素材代號字串（例如
    "campus"，不是有效 UUID，直接略過）與素材庫的媒體 UUID。只有後者
    需要建立 MediaUsage 引用保護。"""
    try:
        media_id = uuid.UUID(str(value))
    except (ValueError, AttributeError):
        return None
    return MediaRef(media_id, path, str(label) if label else None)


def _refs(candidates: list[MediaRef | None]) -> list[MediaRef]:
    return [ref for ref in candidates if ref is not None]


def _extract_campus_tour_media_refs(payload: dict) -> list[MediaRef]:
    return _refs(
        [
            _media_ref(scene.get("image", ""), f"scenes[{i}].image", scene.get("name"))
            for i, scene in enumerate(payload.get("scenes", []) or [])
            if isinstance(scene, dict)
        ]
    )


def _extract_news_media_refs(payload: dict) -> list[MediaRef]:
    """消息封面，加上結構化內文裡的圖片區塊（home_news、campus_news 共用）。"""
    refs: list[MediaRef | None] = []
    for i, article in enumerate(payload.get("articles", []) or []):
        if not isinstance(article, dict):
            continue
        title = article.get("title")
        refs.append(_media_ref(article.get("image", ""), f"articles[{i}].image", title))
        for j, block in enumerate(article.get("body", []) or []):
            if isinstance(block, dict) and block.get("type") == "image":
                refs.append(_media_ref(block.get("image", ""), f"articles[{i}].body[{j}].image", title))
    return _refs(refs)


def _extract_site_meta_media_refs(payload: dict) -> list[MediaRef]:
    share = payload.get("share_image") or ""
    return _refs([_media_ref(share, "share_image")]) if share else []


def _slot_ref(payload: dict, field_name: str, kind: str, prefix: str = "", label: object = None) -> MediaRef | None:
    """素材版位（MediaSlotPayload）的引用，路徑指到 `…media_id`，批次替換才能
    直接改那個字串。"""
    slot = payload.get(field_name)
    if not isinstance(slot, dict):
        return None
    ref = _media_ref(slot.get("media_id"), f"{prefix}{field_name}.media_id", label)
    return MediaRef(ref.media_id, ref.path, ref.label, kind) if ref else None


def _extract_home_hero_media_refs(payload: dict) -> list[MediaRef]:
    return _refs(
        [
            _slot_ref(payload, "video_desktop", "video"),
            _slot_ref(payload, "video_mobile", "video"),
            _slot_ref(payload, "poster", "image"),
            _slot_ref(payload, "fallback_image", "image"),
        ]
    )


def _extract_home_about_media_refs(payload: dict) -> list[MediaRef]:
    return _refs([_slot_ref(payload, "photo", "image")])


def _extract_day_media_refs(payload: dict) -> list[MediaRef]:
    refs = [
        _slot_ref(payload, "film_desktop", "video"),
        _slot_ref(payload, "film_mobile", "video"),
        _slot_ref(payload, "film_poster", "image"),
    ]
    for i, moment in enumerate(payload.get("moments", []) or []):
        if isinstance(moment, dict):
            refs.append(_slot_ref(moment, "photo", "image", f"moments[{i}].", moment.get("title")))
    return _refs(refs)


def _extract_campus_profile_media_refs(payload: dict) -> list[MediaRef]:
    return _refs(
        [
            _slot_ref(payload, "cover", "image"),
            _slot_ref(payload, "line_art", "image"),
            _slot_ref(payload, "line_art_colour", "image"),
        ]
    )


def _extract_home_news_media_refs(payload: dict) -> list[MediaRef]:
    refs: list[MediaRef | None] = list(_extract_news_media_refs(payload))
    for i, film in enumerate(payload.get("films") or []):
        if isinstance(film, dict):
            prefix = f"films[{i}]."
            video = _slot_ref(film, "video", "video", prefix, film.get("title"))
            if video is not None:
                end = film.get("end")
                video = replace(video, clip=(float(film.get("start") or 0), None if end is None else float(end)))
            refs.append(video)
            refs.append(_slot_ref(film, "poster", "image", prefix, film.get("title")))
    return _refs(refs)


_PATH_TOKEN = re.compile(r"([A-Za-z_][A-Za-z0-9_]*)|\[(\d+)\]")


def set_at_path(payload: dict, path: str, value: object) -> None:
    """把 `articles[2].body[0].image` 這種路徑指到的欄位改成 value（原地修改）。
    路徑只來自 extract_media_refs，格式固定；對不上時丟 KeyError／IndexError。"""
    tokens: list[str | int] = []
    for part in path.split("."):
        for name, index in _PATH_TOKEN.findall(part):
            tokens.append(name if name else int(index))
    target: object = payload
    for token in tokens[:-1]:
        target = target[token]  # type: ignore[index]
    target[tokens[-1]] = value  # type: ignore[index]


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
    家長看到的文字。

    同意文字也不能空白：發布中的同意文字是空白時，已開放表單的校區送單都會被擋
    （consent.current_consent 視為沒有同意文字），官網卻還顯示表單。"""
    consent_text = (payload.get("consent_text") or "").strip()
    if not consent_text:
        return "同意條款文字不能空白，家長要看得到同意的內容才能勾選，請填寫後再發布"
    if consent_text == LEGACY_DEMO_CONSENT_TEXT:
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
    題目藏起來（見 CampusFaqPayload），回答不必讓訪客拿到。跟共用題目無關的
    停用題連問題也不該輸出，要對照共用題目才知道，由 service.get_public_content
    讀完整份內容後再用 drop_unshared_faq_markers 拿掉。"""
    items = [
        item if item.get("enabled", True) else {"q": item.get("q", ""), "a": "", "enabled": False}
        for item in payload.get("items", [])
    ]
    return {**payload, "items": items}


def drop_unshared_faq_markers(campus_key: str, payload: dict, shared: dict | None) -> dict:
    """公開的各校常見問題只保留「藏住某題共用題目」的停用題：問題文字要跟
    官網上這一校看得到的共用題目（已過 _public_shared_faq，只剩啟用的）完全
    相同才留，其他停用題整題不輸出——園方停用就是從官網拿掉，問題文字也不該
    還能從 /public/site 讀到。比對規則同官網 mergeCampusFaq（去頭尾空白）。"""
    shared_questions = {
        str(item.get("q") or "").strip()
        for item in (shared or {}).get("items", []) or []
        if isinstance(item, dict)
        and (item.get("scope") != "campus" or campus_key in (item.get("campus_keys") or []))
    }
    items = [
        item
        for item in payload.get("items", []) or []
        if not isinstance(item, dict)
        or item.get("enabled", True)
        or str(item.get("q") or "").strip() in shared_questions
    ]
    return {**payload, "items": items}


def _campus_faq_publish_blocker(payload: dict) -> str | None:
    blank = campus_faq_blank_items(payload)
    if blank:
        numbers = "、".join(str(n) for n in blank)
        return f"第 {numbers} 題設為在官網顯示，但問題或回答是空白，請補上回答或改成停用再發布"
    return None


@dataclass(frozen=True)
class ContentKindConfig:
    payload_model: type[BaseModel]
    # True：跨校共用內容，只有 super_admin 能編，分校不能改共用內容。
    # False：該 kind 需要搭配 campus_key，一般 campus scope 規則套用。
    shared_only: bool
    # 從 payload dict 抓出引用了哪些素材庫媒體（含欄位路徑），供同步
    # MediaUsage、刪除保護與批次替換（沒有引用媒體庫的 kind 用預設的
    # 「永遠沒有引用」，不必特別處理）。
    extract_media_refs: Callable[[dict], list[MediaRef]] = field(default=lambda payload: [])
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

    def extract_media_ids(self, payload: dict) -> list[uuid.UUID]:
        return [ref.media_id for ref in self.extract_media_refs(payload)]


CONTENT_KIND_REGISTRY: dict[str, ContentKindConfig] = {
    "home_about": ContentKindConfig(
        HomeAboutPayload, shared_only=True, extract_media_refs=_extract_home_about_media_refs
    ),
    "home_hero": ContentKindConfig(
        HomeHeroPayload,
        shared_only=True,
        extract_media_refs=_extract_home_hero_media_refs,
        public_view=_public_home_hero,
    ),
    "site_footer": ContentKindConfig(SiteFooterPayload, shared_only=True),
    "site_meta": ContentKindConfig(
        SiteMetaPayload, shared_only=True, extract_media_refs=_extract_site_meta_media_refs
    ),
    "home_campus_board": ContentKindConfig(HomeCampusBoardPayload, shared_only=True),
    "booking_content": ContentKindConfig(
        BookingContentPayload, shared_only=True, publish_blocker=_booking_publish_blocker
    ),
    "day_experience": ContentKindConfig(
        DayExperiencePayload, shared_only=True, extract_media_refs=_extract_day_media_refs
    ),
    # 2：2026-09-25 起消息與活動的校區改成 scope＋campus_keys（舊版的 campus
    # 文字在驗證時換算，見 schemas._ScopedEntry），並加上內文、推薦與活動時間。
    "home_news": ContentKindConfig(
        HomeNewsPayload,
        shared_only=True,
        extract_media_refs=_extract_home_news_media_refs,
        public_view=_public_news,
        schema_version=2,
    ),
    # 全站共用常見問題；各校在 campus_faq 決定要不要顯示、放在哪裡。
    "shared_faq": ContentKindConfig(SharedFaqPayload, shared_only=True, public_view=_public_shared_faq),
    "admission_content": ContentKindConfig(AdmissionContentPayload, shared_only=True),
    # 以下需要搭配 campus_key，每校各自一份，不是共用內容。
    "campus_profile": ContentKindConfig(
        CampusProfilePayload, shared_only=False, extract_media_refs=_extract_campus_profile_media_refs
    ),
    "campus_faq": ContentKindConfig(
        CampusFaqPayload,
        shared_only=False,
        publish_blocker=_campus_faq_publish_blocker,
        public_view=_public_campus_faq,
    ),
    # 各校自己的消息與活動（分校人員只編本校），官網和 home_news 合併顯示。
    "campus_news": ContentKindConfig(
        CampusNewsPayload,
        shared_only=False,
        extract_media_refs=_extract_news_media_refs,
        public_view=_public_news,
    ),
    "campus_tour": ContentKindConfig(
        CampusTourPayload,
        shared_only=False,
        extract_media_refs=_extract_campus_tour_media_refs,
        before_save=_mark_tour_spots_for_review,
        publish_blocker=_tour_publish_blocker,
    ),
}


def schema_version_of(kind: str) -> int:
    config = CONTENT_KIND_REGISTRY.get(kind)
    return config.schema_version if config is not None else 1
