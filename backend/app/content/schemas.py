from __future__ import annotations

import uuid
from datetime import date, datetime

import re

from pydantic import BaseModel, Field, field_validator, model_validator

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


def _require_safe_media_ref(value: str) -> str:
    """場景圖片欄位同時相容素材庫 UUID、舊 fixture 代號與外部網址
    （見 content/registry.py 的說明）。沒有 scheme 的純代號原樣放行，
    看起來像網址的才套允許清單。"""
    candidate = _strip_invisible(value)
    if ":" not in candidate:
        return value
    return _require_safe_url(value)


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


class NewsArticlePayload(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    date: str
    campus: str
    category: str
    title: str = Field(min_length=1)
    description: str
    # 同 campus_tour 的場景圖：素材庫媒體 UUID，或舊 fixture 素材代號。
    image: str
    alt: str

    @field_validator("id", "campus", "category", "title", "description", "alt")
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


class NewsEventPayload(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    date: str
    campus: str
    title: str = Field(min_length=1)
    description: str

    @field_validator("id", "campus", "title", "description")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)

    @field_validator("date")
    @classmethod
    def _date_iso(cls, value: str) -> str:
        return _require_iso_date(value)


class HomeNewsPayload(BaseModel):
    # 有值時首頁「近期活動」「最新消息」標出「示意內容」，並在區塊底部顯示這段
    # 說明；換成真實消息後清空即可。
    sample_note: str
    # 允許 0 筆：沒有真實消息時寧可空著（官網會改顯示「目前沒有…」），
    # 也不要為了過驗證而虛構內容。
    articles: list[NewsArticlePayload]
    events: list[NewsEventPayload]

    @field_validator("sample_note")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)

    @field_validator("articles")
    @classmethod
    def _articles_bounded(cls, value: list[NewsArticlePayload]) -> list[NewsArticlePayload]:
        if len(value) > 30:
            raise ValueError("消息最多 30 則")
        ids = [a.id for a in value]
        if len(ids) != len(set(ids)):
            raise ValueError("消息的 id 不可重複")
        return value

    @field_validator("events")
    @classmethod
    def _events_bounded(cls, value: list[NewsEventPayload]) -> list[NewsEventPayload]:
        if len(value) > 12:
            raise ValueError("活動最多 12 筆")
        ids = [e.id for e in value]
        if len(ids) != len(set(ids)):
            raise ValueError("活動的 id 不可重複")
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


class AdmissionStepPayload(BaseModel):
    when: str
    title: str
    text: str

    @field_validator("title")
    @classmethod
    def _title(cls, value: str) -> str:
        return _nonblank(value, "步驟標題不可空白")


class AdmissionPhasePayload(BaseModel):
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


class AdmissionUniformDayPayload(BaseModel):
    day: str
    wear: str


class AdmissionSubsidyPayload(BaseModel):
    amount: str
    unit: str
    who: str
    by: str

    @field_validator("amount")
    @classmethod
    def _amount(cls, value: str) -> str:
        return _nonblank(value, "補助金額不可空白")


class AdmissionAllowancePayload(BaseModel):
    order: str
    amount: str


class AdmissionRefundGroupPayload(BaseModel):
    label: str
    lines: list[str]

    @field_validator("lines")
    @classmethod
    def _lines(cls, value: list[str]) -> list[str]:
        return _bounded([v for v in value if v.strip()], 1, 12, "每組退費說明")


class AdmissionRefundPayload(BaseModel):
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


class AdmissionContentPayload(BaseModel):
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

    @field_validator("name", "district", "address", "phone", "intro", "description", "fb_note")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)

    @field_validator("facebook", "line")
    @classmethod
    def _social_links_safe(cls, value: str) -> str:
        # 這兩個欄位在 web/app/components/CampusBoard.vue 直接綁 :href，
        # 是 CMS 內容通到公開站 href 的唯一路徑，必須用允許清單。
        return _require_safe_url(value)


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
