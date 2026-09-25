from __future__ import annotations

import uuid
from datetime import date, datetime

import re
from typing import Annotated, Literal, Union
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.campuses.models import CAMPUS_KEYS, CAMPUS_NAMES
from app.media.schemas import PublicMediaOut

# 階段 B 第一版只實作一種內容 kind（home_about，首頁「關於常春藤」文字）；
# 其餘內容仍由 Nuxt 端 fixture 提供，尚未搬進這套 typed content 系統。
# 完整 ContentItem.kind 清單與逐項 editor 屬於 Task 5 剩餘範圍，見
# docs/website-admin/acceptance.md 的階段 B 小結。

_BLOCKED_URL_SCHEMES = ("javascript:", "data:", "vbscript:")
_ALLOWED_URL_SCHEMES = ("https://", "http://", "mailto:", "tel:")

# 瀏覽器在解析 href 的 scheme 時會忽略內嵌的 TAB／換行／NUL 等控制字元，
# 所以 `java<TAB>script:alert(1)` 放進 <a href> 一樣會執行。只做 strip()
# 的前綴比對擋不住這種寫法，比對前必須先把所有不可見字元清掉。
_INVISIBLE_RE = re.compile(r"[\x00-\x20\x7f\u00ad\u200b-\u200f\u2028\u2029\ufeff]")


def _strip_invisible(value: str) -> str:
    return _INVISIBLE_RE.sub("", value)


def _reject_unsafe_scheme(value: str) -> str:
    """純文字欄位用：文案可以是任何內容，只擋會變成可執行連結的 scheme。"""
    lowered = _strip_invisible(value).lower()
    if any(lowered.startswith(scheme) for scheme in _BLOCKED_URL_SCHEMES):
        raise ValueError("不允許的網址格式")
    return value


def _require_safe_url(value: str) -> str:
    """真的會被綁進 href 的欄位用：改成允許清單。黑名單永遠會漏（不同
    編碼、新 scheme），這些欄位只可能是連結，直接限定合法開頭最穩。"""
    candidate = _strip_invisible(value)
    if candidate == "":
        return value
    if not candidate.lower().startswith(_ALLOWED_URL_SCHEMES):
        raise ValueError("網址必須以 https://、http://、mailto: 或 tel: 開頭")
    return value


_MEDIA_CODE_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9-]*")


def _require_safe_media_ref(value: str) -> str:
    """場景圖片欄位同時相容素材庫 UUID、舊 fixture 代號與外部網址
    （見 content/registry.py 的說明）。沒有 scheme 的純代號原樣放行，
    看起來像網址的才套允許清單。"""
    candidate = _strip_invisible(value)
    if ":" not in candidate:
        # 代號會被前端拿去查圖片 manifest（一般物件），`__proto__`、
        # `constructor` 這類鍵會查到原型而讓校區頁渲染失敗；素材代號與
        # UUID 都只用英數與連字號，其他字元一律拒絕。
        if candidate and not _MEDIA_CODE_PATTERN.fullmatch(candidate):
            raise ValueError("圖片代號只能是英數字與連字號，或素材庫 UUID")
        return value
    return _require_safe_url(value)


# 內容欄位會被公開 API 整份聚合、每個頁面的 SSR 都帶著跑，所以每個文字
# 欄位都要有上限：不然一個校區管理者發布一段超長 FAQ，就能讓全站所有
# 訪客的每次載入一起變重。現有最長的文案不到 300 字，2000 字很寬。
CONTENT_TEXT_MAX_LENGTH = 2000


class _ContentPayload(BaseModel):
    model_config = ConfigDict(str_max_length=CONTENT_TEXT_MAX_LENGTH)


def _require_media_id(value: str, message: str = "請從素材庫選擇") -> str:
    try:
        return str(uuid.UUID(value))
    except ValueError as exc:
        raise ValueError(message) from exc


class FocusPointPayload(_ContentPayload):
    """版位的裁切焦點（規格 L108）：照片上的 0–100 百分比座標，左上為 0。
    官網換成 object-position，不存任意 CSS 字串。"""

    x: float = Field(ge=0, le=100)
    y: float = Field(ge=0, le=100)


class MediaSlotPayload(_ContentPayload):
    """內容裡的一個素材版位：素材庫的素材與這個版位自己的焦點（規格 L141：
    不強迫所有版位共用同一個裁切）。焦點留空＝用素材本身設定的焦點，素材
    也沒設就置中。版位本身留空（None）＝官網沿用內建素材。"""

    media_id: str
    focus_x: float | None = Field(default=None, ge=0, le=100)
    focus_y: float | None = Field(default=None, ge=0, le=100)

    @field_validator("media_id")
    @classmethod
    def _media_id(cls, value: str) -> str:
        return _require_media_id(value)

    @model_validator(mode="after")
    def _focus_pair(self) -> "MediaSlotPayload":
        if (self.focus_x is None) != (self.focus_y is None):
            raise ValueError("焦點的左右與上下位置要一起設定")
        return self


MEDIA_ALT_MAX_LENGTH = 200


class HomeAboutPayload(_ContentPayload):
    title: str
    since_label: str
    body_text: str
    caption: str
    # 2026-09-25 新增（2026-09-23 起「關於」只放一張照片）：留空沿用官網內建照片。
    photo: MediaSlotPayload | None = None
    photo_alt: str = Field(default="", max_length=MEDIA_ALT_MAX_LENGTH)

    @field_validator("title", "since_label", "body_text", "caption", "photo_alt")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)


class HomeHeroPayload(_ContentPayload):
    """首屏小標與標語。2026-09-23 使用者拿掉了首屏按鈕，按鈕文字（cta_label）
    不再是欄位：舊版本裡的值驗證時直接忽略（extra 預設 ignore），存檔與官網
    都不再帶。

    2026-09-25 起首屏影片與照片也可以從素材庫換（規格 L90）：桌機與手機影片
    是不同版位（手機沒設就用桌機那支）、poster 是影片載入前與不自動播放時
    看到的照片、替代圖是影片載入失敗時換上的照片（沒設就用 poster）。都留空
    時官網沿用內建的影片與照片。"""

    eyebrow: str
    copy_lines: list[str]
    video_desktop: MediaSlotPayload | None = None
    video_mobile: MediaSlotPayload | None = None
    poster: MediaSlotPayload | None = None
    poster_alt: str = Field(default="", max_length=MEDIA_ALT_MAX_LENGTH)
    fallback_image: MediaSlotPayload | None = None

    @field_validator("eyebrow", "poster_alt")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)

    @field_validator("copy_lines")
    @classmethod
    def _copy_lines_safe_and_bounded(cls, value: list[str]) -> list[str]:
        if not (1 <= len(value) <= 3):
            raise ValueError("copy_lines 需為 1 到 3 行")
        return [_reject_unsafe_scheme(line) for line in value]


# 主選單與頁尾連結（規格 L89）：只收站內路徑（/ 開頭、不能是 // 開頭的
# 協定相對網址）或 https 外部網址。外部連結官網會加 ↗ 並另開分頁。
_SITE_PATH_RE = re.compile(r"/(?!/)[A-Za-z0-9\-._~/#?=&%]*")
SITE_LINK_MAX_LENGTH = 300
PRIMARY_NAV_MAX = 8
FOOTER_LINKS_MAX = 12


# WHATWG URL 不接受的主機名稱字元（urlsplit 不擋）。
_FORBIDDEN_HOST_CHARS_RE = re.compile(r"[%<>^|]")


def _is_external_site_link(candidate: str) -> bool:
    """官網（siteLink）與後台（siteLinkError）用 new URL() 解析外部連結，解析失敗
    就不當連結。這裡要擋下同樣的網址，否則存得進去、官網卻默默少一個連結：
    埠號不是 0–65535 的數字、主機名稱有不允許的字元。"""
    if _INVISIBLE_RE.search(candidate) or "\\" in candidate or not candidate.lower().startswith("https://"):
        return False
    try:
        parsed = urlsplit(candidate)
        # 埠號超出範圍或不是數字時 .port 才會丟 ValueError。
        _ = parsed.port
    except ValueError:
        return False
    host = parsed.hostname or ""
    return "." in host and "@" not in parsed.netloc and not _FORBIDDEN_HOST_CHARS_RE.search(host)


def _require_site_link(value: str) -> str:
    candidate = value.strip()
    if not candidate:
        raise ValueError("請填寫連結")
    if len(candidate) > SITE_LINK_MAX_LENGTH:
        raise ValueError(f"連結最多 {SITE_LINK_MAX_LENGTH} 字")
    if _SITE_PATH_RE.fullmatch(candidate) or _is_external_site_link(candidate):
        return candidate
    raise ValueError("連結要是站內路徑（/ 開頭，例如 /admission、/#about）或 https:// 開頭的外部網址")


def _unique_hrefs(links: list, what: str) -> None:
    hrefs = [link.href for link in links]
    if len(hrefs) != len(set(hrefs)):
        raise ValueError(f"{what}的連結不可重複")


class SiteLinkPayload(_ContentPayload):
    label: str = Field(min_length=1, max_length=20)
    href: str

    @field_validator("label")
    @classmethod
    def _label(cls, value: str) -> str:
        return _reject_unsafe_scheme(_nonblank(value, "連結文字不能空白"))

    @field_validator("href")
    @classmethod
    def _href(cls, value: str) -> str:
        return _require_site_link(value)


class NavLinkPayload(SiteLinkPayload):
    # 頁首選單中文下方的英文小字；英文字型是只含 ASCII 的子集，只收英數與基本標點。
    label_en: str = Field(default="", max_length=40)

    @field_validator("label_en")
    @classmethod
    def _label_en(cls, value: str) -> str:
        if any(not (" " <= char <= "~") for char in value):
            raise ValueError("英文小字只能用英文字母、數字與基本標點")
        return _reject_unsafe_scheme(value)


class SiteFooterPayload(_ContentPayload):
    tagline: str
    copyright: str
    bottom_note: str
    campus_list_label: str
    # 頁尾連結（依清單順序）。None＝還沒在後台設定過，官網沿用內建的連結。
    links: list[SiteLinkPayload] | None = None

    @field_validator("tagline", "copyright", "bottom_note", "campus_list_label")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)

    @field_validator("links")
    @classmethod
    def _links_bounded(cls, value: list[SiteLinkPayload] | None) -> list[SiteLinkPayload] | None:
        if value is None:
            return None
        if len(value) > FOOTER_LINKS_MAX:
            raise ValueError(f"頁尾連結最多 {FOOTER_LINKS_MAX} 個")
        _unique_hrefs(value, "頁尾")
        return value


class SiteMetaPayload(_ContentPayload):
    title: str
    description: str
    header_phone_number: str
    header_phone_note: str
    # 以下為 2026-09-24 新增，預設值讓舊的已發布版本照常通過驗證。
    # 社群分享圖：素材庫媒體 UUID；空字串沿用首頁大圖的分享圖。
    share_image: str = ""
    share_image_alt: str = Field(default="", max_length=200)
    # 入學資訊頁的搜尋標題與描述；空字串沿用官網內建文字。
    admission_title: str = Field(default="", max_length=120)
    admission_description: str = Field(default="", max_length=300)
    # 只能「收緊」：部署設定沒開索引時，這裡勾了也不會變成可索引。
    allow_indexing: bool = True
    # 主選單（頁首與選單面板，依清單順序）。None＝還沒在後台設定過，官網沿用
    # 內建選單。品牌名稱與 Logo 依 2026-09-19 核可鎖定，不在這裡。
    primary_nav: list[NavLinkPayload] | None = None

    @field_validator(
        "title", "description", "header_phone_number", "header_phone_note",
        "share_image_alt", "admission_title", "admission_description",
    )
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)

    @field_validator("share_image")
    @classmethod
    def _share_image_is_media_id(cls, value: str) -> str:
        if value == "":
            return value
        try:
            return str(uuid.UUID(value))
        except ValueError as exc:
            raise ValueError("分享圖請從素材庫選擇") from exc

    @field_validator("primary_nav")
    @classmethod
    def _nav_bounded(cls, value: list[NavLinkPayload] | None) -> list[NavLinkPayload] | None:
        if value is None:
            return None
        if not 1 <= len(value) <= PRIMARY_NAV_MAX:
            raise ValueError(f"主選單需為 1 到 {PRIMARY_NAV_MAX} 個項目")
        _unique_hrefs(value, "主選單")
        return value


class HomeCampusBoardPayload(_ContentPayload):
    section_title: str
    eyebrow: str
    note: str
    # 首頁五校的排列順序與預設顯示的校區（規格 L107）。預設值就是原本官網
    # 內建的順序，舊版本照常通過驗證。停用的校區官網會略過。
    campus_order: list[str] = Field(default_factory=lambda: list(CAMPUS_KEYS))
    default_campus: str = CAMPUS_KEYS[0]

    @field_validator("section_title", "eyebrow", "note")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)

    @field_validator("campus_order")
    @classmethod
    def _order_is_permutation(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("校區順序不可重複")
        if sorted(value) != sorted(CAMPUS_KEYS):
            raise ValueError("校區順序要剛好包含五校，不能缺漏")
        return value

    @field_validator("default_campus")
    @classmethod
    def _default_known(cls, value: str) -> str:
        if value not in CAMPUS_KEYS:
            raise ValueError("不認得的預設校區")
        return value


# 隱私／個資使用說明的草稿標記。後台「帶入示意段落」產生的文字都帶這個
# 標記，含標記的版本不能發布（registry 的 publish_blocker）：正式條款要由
# 園方提供，不讓示意文字被當成正式說明放上官網。
PRIVACY_SAMPLE_MARKER = "【示意】"
PRIVACY_SECTIONS_MAX = 12

# 原型 fixture 的示範同意文字（「資料不會傳送給學校」），正式官網不能再
# 發布它；匯入初始內容時換成官網一直顯示的正式文字（見 migration
# 31eb94190b1c 的說明）。
LEGACY_DEMO_CONSENT_TEXT = "我了解這是操作示範，資料不會傳送給學校，不代表預約成立。"
FORMAL_CONSENT_TEXT = "我同意園方使用本次填寫的資料聯絡與安排參觀；送出需求後，仍須由園方確認參觀時間。"


class PrivacySectionPayload(_ContentPayload):
    """隱私說明的一段：小標（可留空）與內文。只收純文字，官網照段落顯示。"""

    heading: str = Field(default="", max_length=60)
    body: str = Field(min_length=1)

    @field_validator("heading", "body")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)

    @field_validator("body")
    @classmethod
    def _body_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("段落內文不能空白")
        return value


class BookingContentPayload(_ContentPayload):
    cta_label: str
    cta_label_en: str
    consent_text: str
    banner_title_template: str
    banner_body: str
    banner_button_label: str
    # 2026-09-25 新增（規格 L130）：官網頁尾與預約表單可開啟的隱私／個資使用
    # 說明。空清單＝還沒有正式說明，官網不顯示入口。預設值讓舊版本照常通過驗證。
    privacy_title: str = Field(default="", max_length=40)
    privacy_sections: list[PrivacySectionPayload] = Field(
        default_factory=list, max_length=PRIVACY_SECTIONS_MAX
    )

    @field_validator(
        "cta_label",
        "cta_label_en",
        "consent_text",
        "banner_title_template",
        "banner_body",
        "banner_button_label",
        "privacy_title",
    )
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)


# 拍立得相紙的色調：只能選官網既有的色票（規格 L91：不能輸入 CSS）。
DAY_MOMENT_TINTS = ("yellow", "mint", "peach", "cream")


class DayMomentPayload(_ContentPayload):
    key: str
    time: str
    label: str
    caption: str
    title: str
    story: str
    question: str
    answer: str
    # 2026-09-25 新增：照片從素材庫選；留空時原有的六張沿用內建照片，後台新增
    # 的卡片顯示無照片的相紙。色調留空＝沿用內建卡的色調。
    photo: MediaSlotPayload | None = None
    alt: str = Field(default="", max_length=MEDIA_ALT_MAX_LENGTH)
    tint: Literal["yellow", "mint", "peach", "cream"] | None = None

    @field_validator("time", "label", "caption", "title", "story", "question", "answer", "alt")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)


class DayExperiencePayload(_ContentPayload):
    eyebrow: str
    eyebrow_en: str
    note: str
    source_note: str
    moments: list[DayMomentPayload]
    # 2026-09-25 新增：背景影片（桌機、手機分開，手機沒設用桌機那支）、共同的
    # poster 與影片左下角的說明文字。留空（None）＝沿用官網內建。影片是靜音的
    # 裝飾背景（aria-hidden），沒有對白，字幕檔（.vtt）另列待辦。
    film_desktop: MediaSlotPayload | None = None
    film_mobile: MediaSlotPayload | None = None
    film_poster: MediaSlotPayload | None = None
    film_caption_zh: str | None = Field(default=None, max_length=40)
    film_caption_en: str | None = Field(default=None, max_length=60)

    @field_validator("eyebrow", "eyebrow_en", "note", "source_note")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)

    @field_validator("film_caption_zh", "film_caption_en")
    @classmethod
    def _caption_safe(cls, value: str | None) -> str | None:
        return None if value is None else _reject_unsafe_scheme(value)

    @field_validator("moments")
    @classmethod
    def _moments_bounded(cls, value: list[DayMomentPayload]) -> list[DayMomentPayload]:
        if not (1 <= len(value) <= 12):
            raise ValueError("moments 需為 1 到 12 筆")
        keys = [m.key for m in value]
        if len(keys) != len(set(keys)):
            raise ValueError("moments 的 key 不可重複")
        return value


_ISO_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _require_iso_date(value: str) -> str:
    """消息／活動日期：官網直接拿字串切日、月與排序，所以固定 YYYY-MM-DD，
    並確認是真的存在的日期（2026-02-30 這種擋掉）。"""
    if not _ISO_DATE_RE.match(value):
        raise ValueError("日期格式需為 YYYY-MM-DD")
    try:
        date.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("不存在的日期") from exc
    return value


def _require_optional_iso_date(value: str | None) -> str | None:
    if value is None or value == "":
        return None
    return _require_iso_date(value)


class _ScheduledPayload(_ContentPayload):
    """上架／下架日期（台北時間，含當天）。兩個都是選填：留空代表一發布就
    顯示、永遠不自動下架。官網讀公開內容時依今天日期過濾，不需要排程工作，
    也不必為了下架再發布一次。"""

    show_from: str | None = None
    show_until: str | None = None

    @field_validator("show_from", "show_until")
    @classmethod
    def _schedule_iso(cls, value: str | None) -> str | None:
        return _require_optional_iso_date(value)

    @model_validator(mode="after")
    def _schedule_order(self):
        if self.show_from and self.show_until and self.show_until < self.show_from:
            raise ValueError("下架日期不能早於上架日期")
        return self


def is_scheduled_visible(entry: dict, today: str) -> bool:
    """today 為台北時間的 YYYY-MM-DD；日期字串固定格式，可以直接比大小。"""
    show_from = entry.get("show_from")
    show_until = entry.get("show_until")
    if show_from and today < show_from:
        return False
    if show_until and today > show_until:
        return False
    return True


# ---------------------------------------------------------------------------
# 消息與活動（home_news 全站、campus_news 各校）
# ---------------------------------------------------------------------------

_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")

# 規格 3.4：消息內文只支援段落、小標、清單、圖片與驗證後連結，存成結構化
# 資料，官網逐塊用固定的元素顯示，不插入任何使用者 HTML。
NEWS_BODY_MAX_BLOCKS = 40


_WHITESPACE_RE = re.compile(r"\s")


def _require_web_url(value: str) -> str:
    """活動與內文的外部連結只收 http／https（不收 mailto、tel：這裡是「報名表、
    活動詳情」這類網頁連結）。

    網址中間不能有空白（含全形空白、不換行空白）：官網的 safeWebUrl 與後台的
    webUrlInvalid 都用 `^https?://\\S+$` 判斷，這裡放行的話後台存得進去、官網卻
    默默不顯示連結；只刪掉半形空白又會把網址悄悄改成另一個。頭尾的空白照樣去掉。"""
    trimmed = value.strip()
    if _WHITESPACE_RE.search(trimmed):
        raise ValueError("連結網址中間不能有空白，請貼上完整的一個網址")
    candidate = _strip_invisible(trimmed)
    if candidate == "":
        return ""
    if not candidate.lower().startswith(("https://", "http://")) or len(candidate) <= len("https://"):
        raise ValueError("連結必須是 https:// 或 http:// 開頭的完整網址")
    return candidate


class NewsParagraphBlock(_ContentPayload):
    type: Literal["paragraph"]
    text: str

    @field_validator("text")
    @classmethod
    def _text(cls, value: str) -> str:
        return _reject_unsafe_scheme(_nonblank(value, "段落不能空白"))


class NewsHeadingBlock(_ContentPayload):
    type: Literal["heading"]
    text: str = Field(max_length=60)

    @field_validator("text")
    @classmethod
    def _text(cls, value: str) -> str:
        return _reject_unsafe_scheme(_nonblank(value, "小標不能空白"))


class NewsListBlock(_ContentPayload):
    type: Literal["list"]
    ordered: bool = False
    items: list[str]

    @field_validator("items")
    @classmethod
    def _items(cls, value: list[str]) -> list[str]:
        kept = [_reject_unsafe_scheme(v) for v in value if v.strip()]
        return _bounded(kept, 1, 20, "清單")


class NewsImageBlock(_ContentPayload):
    type: Literal["image"]
    # 素材庫媒體 UUID（內文圖片一律從素材庫選，才有引用保護）。
    image: str
    alt: str = Field(default="", max_length=200)
    caption: str = Field(default="", max_length=120)

    @field_validator("image")
    @classmethod
    def _image(cls, value: str) -> str:
        try:
            return str(uuid.UUID(value))
        except ValueError as exc:
            raise ValueError("內文圖片請從素材庫選擇") from exc

    @field_validator("alt", "caption")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)


class NewsLinkBlock(_ContentPayload):
    type: Literal["link"]
    label: str = Field(max_length=40)
    url: str

    @field_validator("label")
    @classmethod
    def _label(cls, value: str) -> str:
        return _reject_unsafe_scheme(_nonblank(value, "連結文字不能空白"))

    @field_validator("url")
    @classmethod
    def _url(cls, value: str) -> str:
        url = _require_web_url(value)
        if not url:
            raise ValueError("請填寫連結網址")
        return url


NewsBodyBlock = Annotated[
    Union[NewsParagraphBlock, NewsHeadingBlock, NewsListBlock, NewsImageBlock, NewsLinkBlock],
    Field(discriminator="type"),
]


NEWS_SCOPE_GLOBAL = "global"
NEWS_SCOPE_CAMPUS = "campus"


class _ScopedEntry(_ContentPayload):
    """全站消息的適用範圍（規格 3.4）：global＝全校；campus＝指定校區清單
    （至少一校、只收五校的 key，依五校固定順序存）。

    2026-09-25 以前的版本只有一個手打的 campus 文字（「義華校」「全校」），
    讀舊版本時照五校名稱換成 scope：認得的校名換成那一校，其他一律當全校。"""

    scope: Literal["global", "campus"] = NEWS_SCOPE_GLOBAL
    campus_keys: list[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _legacy_campus_label(cls, data):
        if isinstance(data, dict) and "scope" not in data and "campus" in data:
            label = str(data.get("campus") or "").strip()
            key = next((k for k, name in CAMPUS_NAMES.items() if name == label), None)
            data = {k: v for k, v in data.items() if k != "campus"}
            data["scope"] = NEWS_SCOPE_CAMPUS if key else NEWS_SCOPE_GLOBAL
            data["campus_keys"] = [key] if key else []
        return data

    @model_validator(mode="after")
    def _scope_keys(self):
        if self.scope == NEWS_SCOPE_GLOBAL:
            self.campus_keys = []
            return self
        unknown = [key for key in self.campus_keys if key not in CAMPUS_KEYS]
        if unknown:
            raise ValueError(f"不認得的校區：{'、'.join(unknown)}")
        if not self.campus_keys:
            raise ValueError("指定校區時至少要選一校")
        self.campus_keys = [key for key in CAMPUS_KEYS if key in self.campus_keys]
        return self


class _NewsArticleFields(_ScheduledPayload):
    id: str = Field(min_length=1, max_length=64)
    date: str
    category: str
    title: str = Field(min_length=1)
    # 摘要：卡片、清單與沒有內文時的詳細頁都顯示這段（2026-09-25 以前唯一的
    # 內文欄位，舊資料原樣當摘要）。
    description: str
    # 結構化內文（見 NewsBodyBlock）；空清單＝詳細頁只顯示摘要。
    body: list[NewsBodyBlock] = Field(default_factory=list, max_length=NEWS_BODY_MAX_BLOCKS)
    # 同 campus_tour 的場景圖：素材庫媒體 UUID，或舊 fixture 素材代號。
    image: str
    alt: str

    @field_validator("id", "category", "title", "description", "alt")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)

    @field_validator("date")
    @classmethod
    def _date_iso(cls, value: str) -> str:
        return _require_iso_date(value)

    @field_validator("image")
    @classmethod
    def _image_ref_safe(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("每則消息都要有一張照片")
        return _require_safe_media_ref(value)


class _NewsEventFields(_ScheduledPayload):
    id: str = Field(min_length=1, max_length=64)
    date: str
    title: str = Field(min_length=1)
    description: str
    # 規格 3.4：開始／結束時間（或全天）、地點、相關連結。月份仍由日期推導。
    all_day: bool = True
    start_time: str | None = None
    end_time: str | None = None
    location: str = Field(default="", max_length=80)
    link_url: str = ""
    link_label: str = Field(default="", max_length=20)

    @field_validator("id", "title", "description", "location", "link_label")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)

    @field_validator("date")
    @classmethod
    def _date_iso(cls, value: str) -> str:
        return _require_iso_date(value)

    @field_validator("start_time", "end_time")
    @classmethod
    def _time_format(cls, value: str | None) -> str | None:
        if value is None or value == "":
            return None
        if not _TIME_RE.match(value):
            raise ValueError("時間格式需為 HH:MM（24 小時制）")
        return value

    @field_validator("link_url")
    @classmethod
    def _link(cls, value: str) -> str:
        return _require_web_url(value)

    @model_validator(mode="after")
    def _time_and_link_rules(self):
        if self.all_day:
            self.start_time = None
            self.end_time = None
        elif self.start_time is None:
            raise ValueError("不是全天的活動要填開始時間")
        elif self.end_time is not None and self.end_time <= self.start_time:
            raise ValueError("結束時間要晚於開始時間")
        if not self.link_url:
            self.link_label = ""
        return self


class NewsArticlePayload(_NewsArticleFields, _ScopedEntry):
    # 首頁推薦（規格 3.1）：有任何推薦的消息時，首頁只輪播推薦的，依後台
    # 清單順序；完全沒有推薦時照舊依日期新到舊（官網 utils/news-content.ts）。
    featured: bool = False


class NewsEventPayload(_NewsEventFields, _ScopedEntry):
    pass


def _unique_ids(entries: list, what: str) -> None:
    ids = [entry.id for entry in entries]
    if len(ids) != len(set(ids)):
        raise ValueError(f"{what}的 id 不可重複")


_YOUTUBE_ID_RE = re.compile(
    r"(?:youtu\.be/|youtube(?:-nocookie)?\.com/(?:watch\?(?:.*&)?v=|shorts/|embed/|live/))([\w-]{11})"
)
HOME_FILMS_MAX = 8


def youtube_id(value: str) -> str:
    """跟官網 utils/filmCarousel.ts 的 youtubeId 同一套規則：常見的 YouTube
    網址或 11 碼影片 ID；看不懂回空字串。"""
    text = value.strip()
    match = _YOUTUBE_ID_RE.search(text)
    if match:
        return match.group(1)
    return text if re.fullmatch(r"[\w-]{11}", text) else ""


class HomeFilmPayload(_ContentPayload):
    """首頁手機版「活動影片」的一支（桌機不顯示）。素材庫影片可以只播其中
    一段（start～end 秒，end 留空＝播到結尾）；YouTube 先顯示縮圖，點了才載入。
    標題不顯示，是螢幕閱讀器念的名稱。"""

    id: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=40)
    source: Literal["file", "youtube"]
    video: MediaSlotPayload | None = None
    start: float = Field(default=0, ge=0, le=3600)
    end: float | None = Field(default=None, gt=0, le=3600)
    # 封面照片；素材庫影片沒設就用影片自動抽的畫面，YouTube 沒設就用它的縮圖。
    poster: MediaSlotPayload | None = None
    youtube_url: str = Field(default="", max_length=SITE_LINK_MAX_LENGTH)

    @field_validator("id", "title")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)

    @model_validator(mode="after")
    def _source_fields(self) -> "HomeFilmPayload":
        if self.source == "file":
            if self.video is None:
                raise ValueError("請從素材庫選一支影片")
            self.youtube_url = ""
        else:
            if not youtube_id(self.youtube_url):
                raise ValueError("看不懂的 YouTube 連結，請貼影片網址")
            self.video = None
        if self.end is not None and self.end <= self.start:
            raise ValueError("結束秒數要大於開始秒數")
        return self


class HomeNewsPayload(_ContentPayload):
    # 有值時首頁「近期活動」「最新消息」標出「示意內容」，並在區塊底部顯示這段
    # 說明；換成真實消息後清空即可。
    sample_note: str
    # 允許 0 筆：沒有真實消息時寧可空著（官網會改顯示「目前沒有…」），
    # 也不要為了過驗證而虛構內容。
    articles: list[NewsArticlePayload]
    events: list[NewsEventPayload]
    # 首頁最新消息最多輪播幾則（每組 3 則）；None＝全部。
    home_display_count: int | None = Field(default=None, ge=1, le=30)
    # 首頁手機版「活動影片」清單（2026-09-25 新增）。None＝還沒在後台設定過，
    # 官網沿用內建的四支影片片段。
    films: list[HomeFilmPayload] | None = None

    @field_validator("films")
    @classmethod
    def _films_bounded(cls, value: list[HomeFilmPayload] | None) -> list[HomeFilmPayload] | None:
        if value is None:
            return None
        if not 1 <= len(value) <= HOME_FILMS_MAX:
            raise ValueError(f"活動影片需為 1 到 {HOME_FILMS_MAX} 支")
        _unique_ids(value, "活動影片")
        return value

    @field_validator("sample_note")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)

    @field_validator("articles")
    @classmethod
    def _articles_bounded(cls, value: list[NewsArticlePayload]) -> list[NewsArticlePayload]:
        if len(value) > 30:
            raise ValueError("消息最多 30 則")
        _unique_ids(value, "消息")
        return value

    @field_validator("events")
    @classmethod
    def _events_bounded(cls, value: list[NewsEventPayload]) -> list[NewsEventPayload]:
        if len(value) > 12:
            raise ValueError("活動最多 12 筆")
        _unique_ids(value, "活動")
        return value


class CampusNewsArticlePayload(_NewsArticleFields):
    """分校自己的消息：只屬於這一校（內容項的 campus_key），沒有適用範圍與
    首頁推薦——跨校與首頁的安排由總部在全站消息決定（規格 3.4）。"""


class CampusNewsEventPayload(_NewsEventFields):
    pass


class CampusNewsPayload(_ContentPayload):
    """各校消息與活動（campus_news），分校管理者與內容編輯只能編自己校。
    官網把它和全站消息（home_news）合併顯示。"""

    articles: list[CampusNewsArticlePayload] = Field(default_factory=list)
    events: list[CampusNewsEventPayload] = Field(default_factory=list)

    @field_validator("articles")
    @classmethod
    def _articles_bounded(cls, value: list[CampusNewsArticlePayload]) -> list[CampusNewsArticlePayload]:
        if len(value) > 12:
            raise ValueError("每校消息最多 12 則")
        _unique_ids(value, "消息")
        return value

    @field_validator("events")
    @classmethod
    def _events_bounded(cls, value: list[CampusNewsEventPayload]) -> list[CampusNewsEventPayload]:
        if len(value) > 12:
            raise ValueError("每校活動最多 12 筆")
        _unique_ids(value, "活動")
        return value


def _reject_unsafe_strings(node: object) -> None:
    """巢狀內容一次掃過所有字串，只擋會變成可執行連結的 scheme（同 _reject_unsafe_scheme）。"""
    if isinstance(node, str):
        _reject_unsafe_scheme(node)
    elif isinstance(node, dict):
        for value in node.values():
            _reject_unsafe_strings(value)
    elif isinstance(node, list):
        for value in node:
            _reject_unsafe_strings(value)


def _nonblank(value: str, message: str) -> str:
    if not value.strip():
        raise ValueError(message)
    return value


def _bounded(value: list, low: int, high: int, what: str) -> list:
    if not low <= len(value) <= high:
        raise ValueError(f"{what}需為 {low}–{high} 項" if low else f"{what}最多 {high} 項")
    return value


class AdmissionStepPayload(_ContentPayload):
    when: str
    title: str
    text: str

    @field_validator("title")
    @classmethod
    def _title(cls, value: str) -> str:
        return _nonblank(value, "步驟標題不可空白")


class AdmissionPhasePayload(_ContentPayload):
    tag: str
    title: str
    items: list[str]
    tips: list[str]

    @field_validator("title")
    @classmethod
    def _title(cls, value: str) -> str:
        return _nonblank(value, "階段標題不可空白")

    @field_validator("items")
    @classmethod
    def _items(cls, value: list[str]) -> list[str]:
        return _bounded([v for v in value if v.strip()], 0, 20, "必備品")

    @field_validator("tips")
    @classmethod
    def _tips(cls, value: list[str]) -> list[str]:
        return _bounded([v for v in value if v.strip()], 0, 12, "提醒")


class AdmissionUniformDayPayload(_ContentPayload):
    day: str
    wear: str


class AdmissionSubsidyPayload(_ContentPayload):
    amount: str
    unit: str
    who: str
    by: str

    @field_validator("amount")
    @classmethod
    def _amount(cls, value: str) -> str:
        return _nonblank(value, "補助金額不可空白")


class AdmissionAllowancePayload(_ContentPayload):
    order: str
    amount: str


class AdmissionRefundGroupPayload(_ContentPayload):
    label: str
    lines: list[str]

    @field_validator("lines")
    @classmethod
    def _lines(cls, value: list[str]) -> list[str]:
        return _bounded([v for v in value if v.strip()], 1, 12, "每組退費說明")


class AdmissionRefundPayload(_ContentPayload):
    title: str
    groups: list[AdmissionRefundGroupPayload]
    note: str

    @field_validator("title")
    @classmethod
    def _title(cls, value: str) -> str:
        return _nonblank(value, "退費情況標題不可空白")

    @field_validator("groups")
    @classmethod
    def _groups(cls, value: list[AdmissionRefundGroupPayload]) -> list[AdmissionRefundGroupPayload]:
        return _bounded(value, 1, 6, "退費說明組")


class AdmissionContentPayload(_ContentPayload):
    """入學資訊頁（/admission）。區塊大標寫在官網程式裡（標題字型子集），
    這裡只放園方會改的內容：金額、步驟、須知、退費規定。分班對照由官網依
    生日規則計算，不存資料。"""

    # 有值時頁面頂端顯示這行提醒（例如「金額以各校公告為準」）；清空就不顯示。
    notice: str
    intro: str
    steps: list[AdmissionStepPayload]
    phases: list[AdmissionPhasePayload]
    uniform_week: list[AdmissionUniformDayPayload]
    uniform_note: str
    pickup_notes: list[str]
    registration_notes: list[str]
    fee_intro: str
    subsidies: list[AdmissionSubsidyPayload]
    allowance_title: str
    allowance: list[AdmissionAllowancePayload]
    allowance_note: str
    refunds: list[AdmissionRefundPayload]

    @field_validator("steps")
    @classmethod
    def _steps(cls, value: list[AdmissionStepPayload]) -> list[AdmissionStepPayload]:
        return _bounded(value, 1, 10, "入學步驟")

    @field_validator("phases")
    @classmethod
    def _phases(cls, value: list[AdmissionPhasePayload]) -> list[AdmissionPhasePayload]:
        return _bounded(value, 0, 4, "入園階段")

    @field_validator("uniform_week")
    @classmethod
    def _week(cls, value: list[AdmissionUniformDayPayload]) -> list[AdmissionUniformDayPayload]:
        return _bounded(value, 0, 7, "每週穿著")

    @field_validator("pickup_notes", "registration_notes")
    @classmethod
    def _notes(cls, value: list[str]) -> list[str]:
        return _bounded([v for v in value if v.strip()], 0, 8, "說明")

    @field_validator("subsidies")
    @classmethod
    def _subsidies(cls, value: list[AdmissionSubsidyPayload]) -> list[AdmissionSubsidyPayload]:
        return _bounded(value, 0, 6, "補助項目")

    @field_validator("allowance")
    @classmethod
    def _allowance(cls, value: list[AdmissionAllowancePayload]) -> list[AdmissionAllowancePayload]:
        return _bounded(value, 0, 6, "育兒津貼")

    @field_validator("refunds")
    @classmethod
    def _refunds(cls, value: list[AdmissionRefundPayload]) -> list[AdmissionRefundPayload]:
        return _bounded(value, 0, 10, "退費情況")

    @model_validator(mode="after")
    def _no_script_scheme(self) -> "AdmissionContentPayload":
        _reject_unsafe_strings(self.model_dump())
        return self


# 地圖網址白名單：Google 地圖的分享網址（含台灣網域與短網址），只收 https。
_MAP_PATH_HOSTS = {"www.google.com", "google.com", "www.google.com.tw", "google.com.tw"}
_MAP_HOSTS = {"maps.google.com", "maps.google.com.tw"}
MAP_URL_MESSAGE = "地圖連結只接受 Google 地圖的 https 網址（例如 https://maps.app.goo.gl/…）"


def is_map_url(value: str) -> bool:
    if _INVISIBLE_RE.search(value) or "\\" in value or not value.lower().startswith("https://"):
        return False
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError:
        return False
    host = (parsed.hostname or "").lower()
    if port is not None or parsed.username is not None or parsed.password is not None:
        return False
    path = parsed.path
    if host in _MAP_PATH_HOSTS:
        return path == "/maps" or path.startswith("/maps/")
    if host in _MAP_HOSTS:
        return True
    if host == "maps.app.goo.gl":
        return len(path) > 1
    if host == "goo.gl":
        return path.startswith("/maps/") and len(path) > len("/maps/")
    return False


def require_map_url(value: str) -> str:
    candidate = value.strip()
    if candidate == "":
        return ""
    if not is_map_url(candidate):
        raise ValueError(MAP_URL_MESSAGE)
    return candidate


class CampusProfilePayload(_ContentPayload):
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
    # 地圖連結（規格 L111：地址與地圖分別編輯）。只收 Google 地圖網址；空字串＝
    # 官網照舊用地址組成 Google 地圖搜尋連結。
    map_url: str = Field(default="", max_length=SITE_LINK_MAX_LENGTH)
    # 2026-09-25 新增（規格 L107-108）：封面照片與建築線稿從素材庫選，留空沿用
    # 官網內建。封面在兩個版位裁成不同比例，各有自己的焦點：card_focus＝首頁
    # 五校卡片與預約頁的校區照片、hero_focus＝分校頁首屏。版位焦點留空時用
    # 封面設定的焦點，再沒有就用素材本身的焦點。沒換封面也可以只調焦點。
    cover: MediaSlotPayload | None = None
    card_focus: FocusPointPayload | None = None
    hero_focus: FocusPointPayload | None = None
    # 首頁五校分頁上的建築線稿（平常）與上色版（選到那一校時疊上去）。
    line_art: MediaSlotPayload | None = None
    line_art_colour: MediaSlotPayload | None = None

    @field_validator("name", "district", "address", "phone", "intro", "description", "fb_note")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)

    @field_validator("map_url")
    @classmethod
    def _map_url(cls, value: str) -> str:
        return require_map_url(value)

    @field_validator("facebook", "line")
    @classmethod
    def _social_links_safe(cls, value: str) -> str:
        # 這兩個欄位在 web/app/components/CampusBoard.vue 直接綁 :href，
        # 是 CMS 內容通到公開站 href 的唯一路徑，必須用允許清單。
        return _require_safe_url(value)


class CampusFaqItemPayload(_ContentPayload):
    q: str
    a: str
    # 停用的題目留在後台、官網不顯示（規格 3.4：逐題啟用狀態）。
    enabled: bool = True

    @field_validator("q", "a")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)

    @model_validator(mode="after")
    def _shown_needs_text(self) -> "CampusFaqItemPayload":
        # 停用的題目可以只有問題（「本校不顯示」某題共用題目就是存成這樣）；
        # 要在官網顯示的題目問題與回答都要有，不然官網會出現一題空白的回答。
        if self.enabled and not (self.q.strip() and self.a.strip()):
            raise ValueError("在官網顯示的題目，問題與回答都不能空白（不想顯示請改成停用）")
        return self


def campus_faq_blank_items(payload: dict) -> list[int]:
    """在官網顯示、但問題或回答空白的本校題目（從 1 起算的題號）。存檔時
    CampusFaqItemPayload 已經擋下；這裡給發布前檢查用，擋住規則收緊前存的草稿。"""
    return [
        index
        for index, item in enumerate(payload.get("items", []) or [], start=1)
        if isinstance(item, dict)
        and item.get("enabled", True)
        and not (str(item.get("q") or "").strip() and str(item.get("a") or "").strip())
    ]


FAQ_SHARED_POSITIONS = ("before", "after")


class CampusFaqPayload(_ContentPayload):
    """各校常見問題：本校自己的題目，加上要不要顯示全站共用題目與放哪裡。

    本校有一題和共用題目問題文字相同時，這校顯示本校的版本（停用就是這校
    不顯示那一題），其他校照樣顯示共用的答案（規格 3.2：局部修改不改動其他校）。"""

    # 可以是 0 題：全部用共用題目的校區不必另外寫。
    items: list[CampusFaqItemPayload]
    include_shared: bool = True
    shared_position: Literal["before", "after"] = "before"

    @field_validator("items")
    @classmethod
    def _items_bounded(cls, value: list[CampusFaqItemPayload]) -> list[CampusFaqItemPayload]:
        if len(value) > 20:
            raise ValueError("本校題目最多 20 題")
        return value


class SharedFaqItemPayload(_ScopedEntry):
    id: str = Field(min_length=1, max_length=64)
    q: str
    a: str
    enabled: bool = True

    @field_validator("id", "q", "a")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)

    @field_validator("q", "a")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        return _nonblank(value, "問題與回答都不能空白")


class SharedFaqPayload(_ContentPayload):
    """全站共用常見問題（shared_faq）：總管理者或有「全站共用內容」授權的人編輯。
    每題可以適用全部分校或指定分校；各校在自己的常見問題決定要不要顯示、
    放在本校題目之前或之後。"""

    items: list[SharedFaqItemPayload]

    @field_validator("items")
    @classmethod
    def _items_bounded(cls, value: list[SharedFaqItemPayload]) -> list[SharedFaqItemPayload]:
        if len(value) > 20:
            raise ValueError("共用題目最多 20 題")
        _unique_ids(value, "共用題目")
        return value


class TourSpotPayload(_ContentPayload):
    name: str
    x: float = Field(ge=0, le=100)
    y: float = Field(ge=0, le=100)
    text: str
    question: str

    @field_validator("name", "text", "question")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)


class TourScenePayload(_ContentPayload):
    key: str
    name: str
    image: str
    intro: str
    spots: list[TourSpotPayload]
    # 規格 3.3：換了場景照片，原本的熱點座標可能對不上新照片。伺服器在
    # 照片變更時一律把它改回 False（不信任前端），園方在後台逐點確認後
    # 按「熱點已複核」才會是 True；有未複核的場景不能發布。
    spots_reviewed: bool = True

    @field_validator("key", "name", "intro")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)

    @field_validator("image")
    @classmethod
    def _image_ref_safe(cls, value: str) -> str:
        return _require_safe_media_ref(value)

    @field_validator("spots")
    @classmethod
    def _spots_bounded(cls, value: list[TourSpotPayload]) -> list[TourSpotPayload]:
        if not (1 <= len(value) <= 8):
            raise ValueError("每個場景的熱點需為 1 到 8 個")
        return value


class CampusTourPayload(_ContentPayload):
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
    # 存檔當下的欄位規則版本（registry.schema_version）。
    schema_version: int = 1
    review_status: str = "draft"
    review_note: str | None = None
    submitted_at: datetime | None = None
    reviewed_at: datetime | None = None

    model_config = {"from_attributes": True}


class ContentRevisionRestoreRequest(BaseModel):
    # 還原會新增一版，跟一般存檔一樣要樂觀鎖，不能蓋掉別人剛存的草稿。
    expected_version: int
    # True：還原後直接發布（同一個交易）；False：只變成最新草稿。
    publish: bool = False


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


class ContentRevisionSummaryOut(BaseModel):
    """版本歷史列表用；不含 payload，點開單一版本再讀。"""

    id: uuid.UUID
    version: int
    created_at: datetime
    created_by_email: str | None
    is_published: bool
    ever_published: bool
    last_published_at: datetime | None
    # draft | pending_review | approved | rejected | superseded（送審後又有新版）
    review_status: str = "draft"
    review_note: str | None = None
    reviewed_at: datetime | None = None
    schema_version: int = 1


class SubmitReviewRequest(BaseModel):
    revision_id: uuid.UUID


class ReviewDecisionRequest(BaseModel):
    revision_id: uuid.UUID
    decision: Literal["approve", "reject"]
    # 退回一定要寫原因，編輯才知道要改什麼。
    note: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _reject_needs_note(self):
        if self.decision == "reject" and not (self.note or "").strip():
            raise ValueError("退回時請寫下原因")
        return self


class ScheduleRequest(BaseModel):
    revision_id: uuid.UUID
    # 必須帶時區（前端送 +08:00），存 UTC。
    publish_at: datetime

    @field_validator("publish_at")
    @classmethod
    def _aware(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("排程時間要帶時區")
        return value


class PublishJobOut(BaseModel):
    id: uuid.UUID
    revision_id: uuid.UUID
    revision_version: int
    publish_at: datetime
    status: str
    error: str | None
    created_by_email: str | None
    finished_at: datetime | None
    # 沒有發布（failed／skipped）的排程已經處理過：有人按了「知道了」，或官網
    # 之後換過這項內容的版本。編輯頁只提示還沒處理的；其他狀態一律 false。
    resolved: bool = False


class PendingReviewOut(BaseModel):
    kind: str
    campus_key: str | None
    revision_id: uuid.UUID
    version: int
    submitted_at: datetime | None
    submitted_by_email: str | None


class PublicSiteOut(BaseModel):
    schema_version: str
    release_id: str | None
    content: dict
    # 內容引用到的素材資訊，key 是素材 id（見 media/schemas.PublicMediaOut）。
    media: dict[str, PublicMediaOut] = Field(default_factory=dict)


class PublishJobListOut(BaseModel):
    """全站排程清單的一列：比單一內容頁的 PublishJobOut 多了是哪一項內容。"""

    id: uuid.UUID
    kind: str
    campus_key: str | None
    revision_id: uuid.UUID
    revision_version: int
    publish_at: datetime
    status: str
    error: str | None
    created_by_email: str | None
    created_at: datetime
    finished_at: datetime | None
    # 目前登入的人能不能取消（有這項內容的發布權限）。
    can_cancel: bool


class ReleaseChangeOut(BaseModel):
    content_item_id: uuid.UUID
    kind: str
    campus_key: str | None
    revision_id: uuid.UUID
    revision_version: int
    # 這次發布之前官網上的版本；第一次上線為 null。
    previous_revision_version: int | None


class ReleaseOut(BaseModel):
    id: uuid.UUID
    created_at: datetime
    created_by_email: str | None
    # publish | review | scheduled | restore | release_restore | initialize；
    # 2026-09-25 以前的發布沒有記錄，為 null。
    source: str | None
    restored_from_release_id: uuid.UUID | None
    is_current: bool
    # 和前一次發布相比換掉的內容（只列你看得到的校區與共用內容）。
    changes: list[ReleaseChangeOut]


class ReleasePageOut(BaseModel):
    items: list[ReleaseOut]
    # 還有更早的紀錄時，下一頁帶 before=這個時間。
    next_before: datetime | None


class ReleaseRestoreRequest(BaseModel):
    # 畫面上看到的「目前版本」；有人剛好又發布過就回 409，請重新整理再決定。
    expected_current_release_id: uuid.UUID | None = None


class ReleaseRestoreOut(BaseModel):
    release: ReleaseOut
    changed_count: int
    # 目標那次發布之後才第一次上線、維持現狀的內容項數。
    kept_count: int
