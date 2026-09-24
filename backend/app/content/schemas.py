from __future__ import annotations

import uuid
from datetime import date, datetime

import re

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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


class HomeAboutPayload(_ContentPayload):
    title: str
    since_label: str
    body_text: str
    caption: str

    @field_validator("title", "since_label", "body_text", "caption")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)


class HomeHeroPayload(_ContentPayload):
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


class SiteFooterPayload(_ContentPayload):
    tagline: str
    copyright: str
    bottom_note: str
    campus_list_label: str

    @field_validator("tagline", "copyright", "bottom_note", "campus_list_label")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)


class SiteMetaPayload(_ContentPayload):
    title: str
    description: str
    header_phone_number: str
    header_phone_note: str

    @field_validator("title", "description", "header_phone_number", "header_phone_note")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)


class HomeCampusBoardPayload(_ContentPayload):
    section_title: str
    eyebrow: str
    note: str

    @field_validator("section_title", "eyebrow", "note")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)


class BookingContentPayload(_ContentPayload):
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


class DayMomentPayload(_ContentPayload):
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


class DayExperiencePayload(_ContentPayload):
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


class NewsArticlePayload(_ScheduledPayload):
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


class NewsEventPayload(_ScheduledPayload):
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


class HomeNewsPayload(_ContentPayload):
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


class CampusFaqItemPayload(_ContentPayload):
    q: str
    a: str

    @field_validator("q", "a")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)


class CampusFaqPayload(_ContentPayload):
    items: list[CampusFaqItemPayload]

    @field_validator("items")
    @classmethod
    def _items_bounded(cls, value: list[CampusFaqItemPayload]) -> list[CampusFaqItemPayload]:
        if not (1 <= len(value) <= 20):
            raise ValueError("items 需為 1 到 20 筆")
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

    model_config = {"from_attributes": True}


class ContentRevisionSummaryOut(BaseModel):
    """版本紀錄列表的一列。payload 可能很大（消息最多 30 則），列表不帶，
    要比對內容時再用單筆端點讀。"""

    id: uuid.UUID
    version: int
    created_at: datetime
    created_by_email: str | None
    is_published: bool


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


class PublicSiteOut(BaseModel):
    schema_version: str
    release_id: str | None
    content: dict
