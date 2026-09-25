from __future__ import annotations

import re
import uuid
from datetime import date, datetime, time
from typing import Annotated, Literal

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator

from app.booking.models import BookingMode
from app.booking.parent_policy import (
    MAX_CHANGE_DEADLINE_HOURS,
    MIN_CHANGE_DEADLINE_HOURS,
    parent_change_deadline,
    parent_change_open,
)
from app.common.timezones import today_local

ReferralSource = Literal["facebook", "google_reviews", "parent_community", "friends_family", "other"]
_REFERRAL_SOURCE_ORDER = ("facebook", "google_reviews", "parent_community", "friends_family", "other")

_PHONE_PATTERN = re.compile(r"09[0-9]{8}")
# 規格 190：「先移除空格與連字號」。含全形空白與各種破折號變體，家長從
# 通訊錄貼過來的 0912-345-678 或 0912 345 678 都要能通過。
_PHONE_STRIP_RE = re.compile(r"[\s\-\u2010-\u2015\u2212\uFF0D\u3000]")

# 規格 190 的固定選項。API 只存代碼；中文是顯示用，後台與官網各自對照。
AgeCode = Literal["unknown", "under_2", "2-3", "3-4", "4-5", "5-6"]
ContactTimeCode = Literal["flexible", "weekday_morning", "weekday_afternoon", "other"]
AGE_LABELS: dict[str, str] = {
    "unknown": "尚未確定",
    "under_2": "2 歲以下",
    "2-3": "2–3 歲",
    "3-4": "3–4 歲",
    "4-5": "4–5 歲",
    "5-6": "5–6 歲",
}
CONTACT_TIME_LABELS: dict[str, str] = {
    "flexible": "時間彈性",
    "weekday_morning": "平日上午",
    "weekday_afternoon": "平日下午",
    "other": "其他，另行確認",
}
_DASHES_RE = re.compile(r"[-\u2010-\u2015\u2212\uFF0D]")


def _label_to_code(value, labels: dict[str, str]):
    """舊版官網送的是中文標籤（已快取的頁面、還沒更新的分頁仍可能送），
    收到時換成代碼再驗證；認不得的值交給 Literal 回 422。破折號寫法不一，
    比對前統一。"""
    if not isinstance(value, str):
        return value
    cleaned = value.strip()
    if cleaned == "":
        return None
    if cleaned in labels:
        return cleaned
    normalized = _DASHES_RE.sub("-", cleaned).replace(" ", "")
    for code, label in labels.items():
        if normalized == _DASHES_RE.sub("-", label).replace(" ", ""):
            return code
    return cleaned


VisitSource = Literal["web", "phone", "line", "walk_in", "external"]
ManualVisitSource = Literal["phone", "line", "walk_in", "external"]


def normalize_phone(value: str) -> str:
    # 回傳正規化後的值：validator 的回傳值就是實際落庫的內容，這樣
    # DB 裡一律是乾淨的 10 碼，後台搜尋與匯出才不會被空格分岔。
    normalized = _PHONE_STRIP_RE.sub("", value)
    # fullmatch 而不是 match：`$` 會允許結尾多一個換行，
    # "0912345678\n" 原本可以通過驗證。
    if not _PHONE_PATTERN.fullmatch(normalized):
        raise ValueError("手機號碼格式錯誤，需為 09 開頭的 10 碼數字")
    return normalized


_ALLOWED_LINK_SCHEMES = ("https://", "http://")
_INVISIBLE_RE = re.compile(r"[\x00-\x20\x7f\u00ad\u200b-\u200f\u2028\u2029\ufeff]")


def _validate_public_link(value: str | None) -> str | None:
    """line_url／external_url 會原封不動變成官網 CTA 的 href，只檢查非空
    等於讓管理端可以直接種一個 javascript: 連結到公開站。比對前先清掉
    不可見字元，避免 `java<TAB>script:` 這種寫法繞過。"""
    if value is None:
        return value
    candidate = _INVISIBLE_RE.sub("", value)
    if candidate == "":
        return value
    if not candidate.lower().startswith(_ALLOWED_LINK_SCHEMES):
        raise ValueError("連結必須以 https:// 或 http:// 開頭")
    return value


class BookingConfigOut(BaseModel):
    campus_key: str
    mode: BookingMode
    version: int
    line_url: str | None
    phone: str | None
    external_url: str | None
    message: str | None
    slots_auto_confirm: bool
    # 家長線上取消／申請改期最晚到參觀前幾小時（規格 238）。
    parent_change_deadline_hours: int

    model_config = {"from_attributes": True}


class BookingConfigUpdateRequest(BaseModel):
    expected_version: int
    mode: BookingMode
    # 長度對齊 models.py 的欄位定義：沒有上限的話，後台貼一段稍長的暫停
    # 說明就會在 INSERT 時撞 varchar 長度，變成 500「更新失敗」。
    line_url: str | None = Field(default=None, max_length=500)
    phone: str | None = Field(default=None, max_length=32)
    external_url: str | None = Field(default=None, max_length=500)
    message: str | None = Field(default=None, max_length=500)
    # 規格 197／222：slots 預設為人工確認（家長看到「待園方確認」），
    # 園方要自動確認才明確打開。
    slots_auto_confirm: bool = False
    # 省略＝維持原設定（沒有這個欄位的舊版後台存檔時不會把它改回預設）。
    parent_change_deadline_hours: int | None = Field(
        default=None, ge=MIN_CHANGE_DEADLINE_HOURS, le=MAX_CHANGE_DEADLINE_HOURS
    )

    @field_validator("line_url", "external_url")
    @classmethod
    def _links_safe(cls, value: str | None) -> str | None:
        return _validate_public_link(value)


class BookingReadinessReason(BaseModel):
    """某個預約方式還不能啟用的原因。code 是固定代碼，message 是給園方看的中文。"""

    code: str
    message: str


class BookingImpactOut(BaseModel):
    """切換預約方式前給園方看的影響範圍。切換不會修改既有案件，這些案件
    照常在「參觀案件」處理；數字只是讓人知道還有多少要繼續跟進。"""

    # 還沒結案的案件（待處理、聯絡中、待園方確認、已確認）。
    open_requests: int
    new_requests: int
    contacting: int
    pending_confirmation: int
    # 已確認、時段還沒開始：家長會照原時間來。
    upcoming_confirmed: int
    # 已確認、參觀時間已過，還沒改成完成或未到場（2026-09-26 起）。
    # open_requests ＝ 待處理＋聯絡中＋待園方確認＋兩種已確認。
    past_confirmed: int
    # 官網目前可以預約的場次（與公開查詢同一個判斷：開放中、在開放區間、還有名額）。
    bookable_slots: int
    weekly_rules: int


class BookingConsentBriefOut(BaseModel):
    revision_id: uuid.UUID
    version: int
    has_privacy_notice: bool


class BookingReadinessOut(BaseModel):
    """各預約方式要讀資料才知道的啟用條件（同意文字、場次或規則）與影響範圍。
    連結、電話、暫停說明這類表單欄位由後台畫面即時判斷；存檔時後端會把全部
    條件再驗一次，不符回 400 BOOKING_MODE_NOT_READY。"""

    campus_key: str
    current_mode: BookingMode
    consent: BookingConsentBriefOut | None
    blockers: dict[BookingMode, list[BookingReadinessReason]]
    impact: BookingImpactOut


class PrivacySectionOut(BaseModel):
    heading: str
    body: str


class PrivacyNoticeOut(BaseModel):
    title: str
    sections: list[PrivacySectionOut]


class PublicBookingConfigOut(BaseModel):
    """公開端點只回前端 resolveBookingAction 需要的欄位，不外洩管理用資訊。"""

    campus_key: str
    mode: BookingMode
    version: int
    line_url: str | None
    phone: str | None
    external_url: str | None
    message: str | None
    slots_auto_confirm: bool
    # 規格 L130、L196：表單勾選框顯示的同意文字與它的版本。送單時帶
    # consent_revision_id，伺服器確認仍是發布中的內容才收。沒有已發布的
    # 同意文字時兩者為 None（這時也不能啟用表單類的預約方式）。
    consent_revision_id: uuid.UUID | None = None
    consent_text: str | None = None
    # 同一版的隱私／個資使用說明；沒有正式說明時為 None，官網不顯示入口。
    privacy_notice: PrivacyNoticeOut | None = None

    model_config = {"from_attributes": True}


class _VisitRequestFields(BaseModel):
    """官網表單與後台補登共用的家長／孩子欄位與驗證規則。"""

    campus_key: str
    parent_name: str = Field(min_length=1, max_length=64)
    phone: str
    # 新欄位保持選填，既有前端與舊的重試請求不必補資料才能送出。
    child_name: str | None = Field(default=None, min_length=1, max_length=64)
    child_birthdate: date | None = None
    email: EmailStr | None = Field(default=None, max_length=254)
    referral_sources: list[ReferralSource] = Field(default_factory=list, max_length=5)
    age: AgeCode | None = None
    preferred_time: ContactTimeCode | None = None
    # 規格 L192：問題最多 500 字（官網表單與補登都是）。DB 欄位仍是 1000，
    # 以前收過的長問題照常讀得出來。
    questions: str | None = Field(default=None, max_length=500)
    # 規格 L194：參觀人數 1–10。補登沒問到可以不填；官網新送的需求必填（見 VisitRequestCreate）。
    party_size: int | None = Field(default=None, ge=1, le=10)
    consent_given: bool

    @field_validator("age", mode="before")
    @classmethod
    def _age_code(cls, value):
        return _label_to_code(value, AGE_LABELS)

    @field_validator("preferred_time", mode="before")
    @classmethod
    def _time_code(cls, value):
        return _label_to_code(value, CONTACT_TIME_LABELS)
    slot_id: uuid.UUID | None = None  # mode=slots 時必填

    @field_validator("parent_name")
    @classmethod
    def _parent_name_not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("請填寫家長稱呼")
        # 舊欄位保留原值，避免改寫已成立案件的冪等 payload hash。
        return value

    @field_validator("child_name", mode="before")
    @classmethod
    def _normalize_child_name(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("child_birthdate")
    @classmethod
    def _birthdate_not_future(cls, value: date | None) -> date | None:
        if value is not None and value > today_local():
            raise ValueError("寶貝出生日期不能晚於今天")
        return value

    @field_validator("referral_sources")
    @classmethod
    def _unique_referral_sources(cls, value: list[ReferralSource]) -> list[ReferralSource]:
        # 多選是集合；固定順序也讓相同選項的重試不因點選順序不同而衝突。
        return [source for source in _REFERRAL_SOURCE_ORDER if source in value]

    @field_validator("phone")
    @classmethod
    def _validate_phone(cls, value: str) -> str:
        return normalize_phone(value)

    @field_validator("consent_given")
    @classmethod
    def _require_consent(cls, value: bool) -> bool:
        if not value:
            raise ValueError("需要勾選同意才能送出")
        return value


class VisitRequestCreate(_VisitRequestFields):
    config_version: int
    # party_size（繼承）：官網新送的需求一定要選人數，由 service 在確認不是
    # 重送之後檢查（缺了回 422）。schema 維持選填，是為了更新前送出的同一筆
    # 需求重試時（當時表單沒有人數）仍能回到原案件。
    # 家長看到的同意說明版本（公開預約設定的 consent_revision_id）。沒帶或
    # 已不是發布中的內容回 409 CONSENT_VERSION_CHANGED，前端重新載入後請家長
    # 重新閱讀、勾選。不算進 idempotency 的 payload hash，見 service._hash_payload。
    consent_revision_id: uuid.UUID | None = None



class VisitRequestManualCreate(_VisitRequestFields):
    """後台人工補登（規格 6.2）：家長打電話、傳 LINE、直接到園或從外部
    預約網站來的需求，由園方人員登錄。不受官網預約模式限制——暫停線上
    收件時仍要能記下打電話來的家長。consent_given 在這裡代表「人員已向
    家長說明並取得同意留存資料」，同樣必須為 true。"""

    source: ManualVisitSource
    # 選填：當場就排定時段時直接確認，走與一般確認相同的容量檢查。
    slot_id: uuid.UUID | None = None
    # 選填：第一筆聯絡紀錄（例如「家長來電，想週六參觀」）。
    note: str | None = Field(default=None, max_length=1000)
    # 結案後重新預約時指回舊案；跨校關聯只有總管理者可以做。
    related_request_id: uuid.UUID | None = None


class VisitRequestAssignRequest(BaseModel):
    # None 代表取消指派。
    assigned_staff_id: uuid.UUID | None
    # 畫面載入時案件的 version；別人先改了承辦人或下次聯絡時間就回 409
    # VISIT_REQUEST_VERSION_CONFLICT。
    expected_version: int = Field(ge=1)


class VisitStaffOut(BaseModel):
    """可以承辦案件的後台人員：有 booking.handle 的總管理者、分校管理者與
    櫃台。campus_keys 為空代表總管理者，可承辦任何校區。"""

    id: uuid.UUID
    email: str
    role: str
    campus_keys: list[str]
    is_active: bool


class CalendarVisitOut(BaseModel):
    """月曆格子裡的一位家長：只放接待當天需要的欄位，完整資料點進案件看。"""

    id: uuid.UUID
    status: str
    parent_name: str
    child_name: str | None
    phone: str
    source: str
    assigned_staff_id: uuid.UUID | None
    party_size: int | None = None


class CalendarSlotOut(BaseModel):
    id: uuid.UUID
    campus_key: str
    slot_date: date
    start_time: time
    end_time: time
    capacity: int
    closed: bool
    booked_count: int
    visits: list[CalendarVisitOut]


class VisitRequestOut(BaseModel):
    receipt_id: uuid.UUID
    status: str
    created_at: datetime


class VisitSlotOut(BaseModel):
    id: uuid.UUID
    campus_key: str
    slot_date: date
    start_time: time
    end_time: time
    capacity: int
    closed: bool
    # manual＝園方手動關閉、exception＝休假日關閉；開放中或舊資料為 None。
    closed_source: str | None = None
    booked_count: int
    version: int

    model_config = {"from_attributes": True}


class PublicVisitSlotOut(BaseModel):
    """公開端點只回可用性，不回誰訂走了名額。"""

    id: uuid.UUID
    slot_date: date
    start_time: time
    end_time: time
    remaining: int


class VisitSlotCreateRequest(BaseModel):
    slot_date: date
    start_time: time
    end_time: time
    capacity: int = Field(gt=0, le=200)

    @field_validator("end_time")
    @classmethod
    def _end_after_start(cls, value: time, info) -> time:
        start = info.data.get("start_time")
        if start is not None and value <= start:
            raise ValueError("結束時間必須晚於開始時間")
        return value


class VisitSlotUpdateRequest(BaseModel):
    capacity: int | None = Field(default=None, ge=0, le=200)
    closed: bool | None = None
    # 畫面載入時時段的 version；不符回 409 SLOT_VERSION_CONFLICT。
    expected_version: int = Field(ge=1)


class VisitSlotBriefOut(BaseModel):
    """案件上要顯示的「參觀時間」。容量與已預約數是時段管理頁的事，
    這裡只回日期與起訖；後台明細與列表都直接顯示這一份，不必再打一次
    /admin/slots 去換算家長約在哪一天。"""

    id: uuid.UUID
    slot_date: date
    start_time: time
    end_time: time

    model_config = {"from_attributes": True}


class VisitRequestDetailOut(BaseModel):
    id: uuid.UUID
    campus_key: str
    status: str
    # web＝官網表單；phone／line／walk_in／external＝後台人工補登。
    source: str = "web"
    created_by: uuid.UUID | None = None
    parent_name: str
    phone: str
    child_name: str | None = None
    child_birthdate: date | None = None
    email: str | None = None
    referral_sources: list[ReferralSource] = Field(default_factory=list)
    age: str | None
    preferred_time: str | None
    questions: str | None
    # 參觀人數；舊案件與沒問到人數的補登為 None（畫面顯示「未填」）。
    party_size: int | None = None
    # 同意紀錄（規格 L196）：官網送單記錄家長看到的同意說明版本與伺服器接受
    # 時間；補登由人員代勾，沒有版本。
    consent_given: bool = True
    consent_revision_id: uuid.UUID | None = None
    consent_accepted_at: datetime | None = None
    slot_id: uuid.UUID | None
    # 未排時段（inquiry 待處理）時為 None。序列化會讀 VisitRequest.slot
    # relationship，取這個 schema 的查詢一律要 selectinload，否則 async
    # 下會踩到 lazy load。
    slot: VisitSlotBriefOut | None = None
    assigned_staff_id: uuid.UUID | None
    confirmed_at: datetime | None
    cancelled_at: datetime | None
    follow_up_at: datetime | None
    hold_expires_at: datetime | None = None
    source: VisitSource = "web"
    created_by: uuid.UUID | None = None
    related_request_id: uuid.UUID | None = None
    created_at: datetime
    # 可編輯欄位（承辦人、下次聯絡時間）的樂觀鎖版本。
    version: int

    model_config = {"from_attributes": True}


def _mask_phone(phone: str) -> str:
    """規格 6.4：家長頁只顯示遮罩手機。保留前 4 碼與後 3 碼供本人辨識。"""
    if len(phone) < 7:
        return "*" * len(phone)
    return f"{phone[:4]}***{phone[-3:]}"


class ParentVisitRequestOut(BaseModel):
    """家長端（憑安全連結）看到的案件。刻意不沿用 VisitRequestDetailOut：
    那是後台用的，含未遮罩手機、家長姓名、提問與 assigned_staff_id 等內部
    欄位，連結一旦外流就等於把整份個資交出去。"""

    id: uuid.UUID
    campus_key: str
    status: str
    phone_masked: str
    slot: VisitSlotBriefOut | None = None
    confirmed_at: datetime | None
    cancelled_at: datetime | None
    hold_expires_at: datetime | None
    created_at: datetime
    change_deadline: datetime | None
    # 該校設定的「參觀前幾小時截止」，家長頁的說明文字用。
    change_deadline_hours: int
    can_cancel: bool
    can_reschedule: bool
    reschedule_pending: bool = False

    @classmethod
    def from_visit_request(cls, visit_request, *, deadline_hours: int) -> "ParentVisitRequestOut":
        change_open = parent_change_open(visit_request, deadline_hours)
        return cls(
            id=visit_request.id,
            campus_key=visit_request.campus_key,
            status=visit_request.status,
            phone_masked=_mask_phone(visit_request.phone),
            slot=(
                VisitSlotBriefOut.model_validate(visit_request.slot)
                if visit_request.slot is not None
                else None
            ),
            confirmed_at=visit_request.confirmed_at,
            cancelled_at=visit_request.cancelled_at,
            hold_expires_at=visit_request.hold_expires_at,
            created_at=visit_request.created_at,
            change_deadline=parent_change_deadline(visit_request, deadline_hours),
            change_deadline_hours=deadline_hours,
            can_cancel=visit_request.status in {"new", "contacting", "pending_confirmation", "confirmed"} and change_open,
            can_reschedule=visit_request.status == "confirmed" and change_open,
        )


class VisitContactNoteOut(BaseModel):
    id: uuid.UUID
    note: str
    created_at: datetime
    # 誰記的：同一校多人接手時要知道找誰問。帳號刪除後為 None。
    created_by: uuid.UUID | None = None
    created_by_email: str | None = None

    model_config = {"from_attributes": True}


class VisitRequestConfirmRequest(BaseModel):
    slot_id: uuid.UUID


# 人員填的原因（選填），記在案件歷程；匿名化時清掉。
ReasonText = Annotated[str | None, Field(max_length=500)]


class VisitRequestRescheduleRequest(BaseModel):
    new_slot_id: uuid.UUID
    reason: ReasonText = None


class VisitRequestCancelRequest(BaseModel):
    reason: ReasonText = None


class RescheduleDecisionRequest(BaseModel):
    """退回家長改期申請時的原因（選填）。"""

    reason: ReasonText = None


class VisitHistoryOut(BaseModel):
    """案件歷程一筆。source：staff＝後台人員（actor_email 是誰）、parent＝
    家長（官網送單或管理連結）、system＝定期工作；舊紀錄可能沒有來源。
    before／after 只含狀態、時段（slot_date、start_time、end_time）、承辦人
    或下次聯絡時間，不含家長個資。"""

    id: uuid.UUID
    event_type: str
    source: str | None
    actor_user_id: uuid.UUID | None
    actor_email: str | None
    before: dict | None
    after: dict | None
    reason: str | None
    created_at: datetime


class RescheduleRequestOut(BaseModel):
    """家長線上改期申請。核准前園方要看得到是誰、原本哪一場、想改到哪一場，
    以及那一場現在還剩幾位（已額滿或已開始時核准會失敗）。"""

    id: uuid.UUID
    visit_request_id: uuid.UUID
    campus_key: str
    status: str
    parent_name: str
    current_slot: VisitSlotBriefOut | None
    requested_slot: VisitSlotBriefOut
    requested_slot_remaining: int
    requested_slot_available: bool
    created_at: datetime


class ParentAccessLinkOut(BaseModel):
    """目前有效的家長管理連結；原始網址只在產生當下回傳一次，這裡只告訴
    後台「有沒有、什麼時候到期」。"""

    created_at: datetime
    expires_at: datetime


class ParentAccessLinkCreatedOut(BaseModel):
    """manage_url 是可以直接給家長的完整網址（公開官網 origin＝
    WEBSITE_ADMIN_ORIGIN）；部署沒設定 origin 時為 None，只能用
    manage_url_fragment 自行組網址。兩者都含 token，只回這一次。"""

    manage_url: str | None
    manage_url_fragment: str
    expires_at: datetime
    replaced_previous: bool


class VisitRequestFullOut(VisitRequestDetailOut):
    """案件明細頁用：案件本身＋歷程、待核准的改期申請、家長連結狀態。
    列表與各個轉換端點仍回 VisitRequestDetailOut，不必每列都查歷程。"""

    history: list[VisitHistoryOut]
    pending_reschedule: RescheduleRequestOut | None
    access_link: ParentAccessLinkOut | None
    # 該校的家長線上異動期限（參觀前幾小時），產生連結時要跟家長講清楚。
    parent_change_deadline_hours: int
    # consent_revision_id 是「預約文案」的第幾版，明細顯示用。
    consent_revision_version: int | None = None


class VisitContactNoteCreateRequest(BaseModel):
    note: str = Field(min_length=1, max_length=1000)
    follow_up_at: datetime | None = None
    # 有改下次聯絡時間時必填（會蓋掉案件上的值，要跟改承辦人一樣檢查版本）；
    # 只記一筆聯絡紀錄是新增，不會蓋掉別人的東西，可以省略。
    expected_version: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def _version_needed_for_follow_up(self) -> "VisitContactNoteCreateRequest":
        if self.follow_up_at is not None and self.expected_version is None:
            raise ValueError("設定下次聯絡時間時要帶 expected_version")
        return self


class VisitRuleIn(BaseModel):
    """0＝週一 … 6＝週日。"""

    weekday: int = Field(ge=0, le=6)
    start_time: time
    end_time: time
    slot_minutes: int = Field(ge=10, le=240)
    capacity: int = Field(gt=0, le=200)

    @field_validator("end_time")
    @classmethod
    def _end_after_start(cls, value: time, info) -> time:
        start = info.data.get("start_time")
        if start is not None and value <= start:
            raise ValueError("結束時間必須晚於開始時間")
        return value


class VisitRuleOut(VisitRuleIn):
    id: uuid.UUID

    model_config = {"from_attributes": True}


class VisitExceptionIn(BaseModel):
    exception_date: date
    reason: str | None = Field(default=None, max_length=200)


class VisitExceptionOut(BaseModel):
    id: uuid.UUID
    exception_date: date
    reason: str | None

    model_config = {"from_attributes": True}


class VisitExceptionCreatedOut(VisitExceptionOut):
    closed_slots: int
    # 當天仍要來參觀的案件數；這些案件會出現在案件清單的「待人工處理」。
    affected_requests: int


class VisitExceptionRemovedOut(BaseModel):
    # 因這個休假日關閉、現在重新開放的時段（手動關閉的不動）。
    reopened_slots: int
    # 休假期間沒產生的場次，依每週規則補上的數量。
    created_slots: int


class VisitScheduleSlotSyncOut(BaseModel):
    """存規則時，依規則產生、還沒被使用的未來時段跟著新規則調整的結果。"""

    # 不符合新規則、沒有任何紀錄指著而刪除的場次。
    removed: int
    # 不符合新規則、有歷史案件指著刪不掉，改成關閉（closed_source=rule）。
    closed: int
    # 之前因規則變更停用、現在又符合新規則而重新開放的場次。
    reopened: int
    # 名額還是舊規則的值（園方沒調過），改成新規則名額的場次。
    capacity_updated: int
    # 不符合新規則，但已有家長排入（或有待核准改期申請）而維持原樣的場次。
    kept_booked: int


class VisitScheduleOut(BaseModel):
    campus_key: str
    min_lead_hours: int
    max_advance_days: int
    rules: list[VisitRuleOut]
    exceptions: list[VisitExceptionOut]
    # 定期工作上次依規則補時段的台灣日期；還沒補過（或剛改規則）為 None。
    rules_extended_on: date | None = None
    # 規則與時間窗的樂觀鎖版本（booking_configs.schedule_version）。
    version: int
    # 只有 PUT（存規則）的回應有；GET 為 None。
    slot_sync: VisitScheduleSlotSyncOut | None = None


class VisitScheduleUpdate(BaseModel):
    # 畫面載入時的 version；不符回 409 VISIT_SCHEDULE_VERSION_CONFLICT。
    expected_version: int = Field(ge=1)
    min_lead_hours: int = Field(ge=0, le=24 * 14)
    max_advance_days: int = Field(ge=1, le=365)
    rules: list[VisitRuleIn] = Field(default_factory=list, max_length=50)


class VisitSlotGenerateRequest(BaseModel):
    date_from: date
    date_to: date


class VisitSlotGenerateOut(BaseModel):
    created: int
    skipped_existing: int
    skipped_exception_days: int
