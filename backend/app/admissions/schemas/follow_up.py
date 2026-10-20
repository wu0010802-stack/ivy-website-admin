"""參觀後追蹤（docs/specs/2026-10-04-admissions-follow-up-design.md 第 6、9 節）。"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

from app.admissions import constants
from app.admissions.funnel import Stage
from app.admissions.schemas._common import Grade, OptionalText
from app.admissions.schemas.records import RecruitmentVisitOut


# ---- 參觀後追蹤（docs/specs/2026-10-04-admissions-follow-up-design.md 第 6、9 節）----

ContactChannel = Literal[tuple(constants.CONTACT_CHANNELS)]
FollowUpKind = Literal[constants.FOLLOW_UP_KINDS]


class ContactLogCreate(BaseModel):
    """記錄一次聯絡（規格 6.3）。next_follow_up_at 必填、可為 null：一定要決定下次聯絡的
    時間或「不用再追」，已到期的訪視記完才會離開清單。"""

    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=1)
    # 沒帶用送出當下；可補登較早的時間，不能晚於現在。時間一律要帶時區（沒帶 422），
    # 才能和伺服器的現在比較。
    contacted_at: AwareDatetime | None = None
    channel: ContactChannel
    reached: bool
    # 聯絡到時必填；沒聯絡到時選填（例如「沒接」）。
    note: OptionalText = Field(default=None, max_length=constants.CONTACT_NOTE_MAX)
    next_follow_up_at: AwareDatetime | None
    # 把這次內容寫進電訪回應（取代原內容）；只在聯絡到時可用。
    update_parent_response: bool = False

    @model_validator(mode="after")
    def _reached_rules(self) -> "ContactLogCreate":
        if self.reached and self.note is None:
            raise ValueError("聯絡到時請寫下聯絡內容")
        if self.update_parent_response and not self.reached:
            raise ValueError("沒聯絡到時不能寫進電訪回應")
        return self


class ContactLogOut(BaseModel):
    id: uuid.UUID
    recruitment_visit_id: uuid.UUID
    contacted_at: datetime
    channel: ContactChannel
    reached: bool
    # 依保存政策匿名化後為 null。
    note: str | None
    next_follow_up_at: datetime | None
    created_by: uuid.UUID | None
    # 記錄者的顯示名稱，沒設定時是 Email；帳號已刪除時為 None。
    created_by_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class ContactLogResultOut(BaseModel):
    """記錄聯絡的回應：新的聯絡紀錄與更新後的訪視（畫面不必再讀一次）。"""

    log: ContactLogOut
    visit: RecruitmentVisitOut


class FollowUpUpdate(BaseModel):
    """只改下次聯絡或負責人（規格 6.4）：沒送＝不動，送 null＝清除（用 model_fields_set 判斷）。"""

    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=1)
    follow_up_at: AwareDatetime | None = None
    follow_up_owner_id: uuid.UUID | None = None


class FollowUpRowOut(BaseModel):
    """待追蹤分頁的一列（規格 9）。只回追蹤要用的欄位：要打電話，所以有電話；不含生日、地址。"""

    visit_id: uuid.UUID
    child_name: str
    grade: Grade | None
    stage: Stage
    visit_date: date
    contact_name: str | None
    phone: str | None
    follow_up_at: datetime | None
    follow_up_owner_id: uuid.UUID | None
    # 顯示名稱，沒設定時是 Email；沒有負責人時為 null。
    follow_up_owner_name: str | None
    # 負責人帳號是否還啟用；沒有負責人時為 null。
    follow_up_owner_active: bool | None
    last_contacted_at: datetime | None
    last_contact_channel: ContactChannel | None
    last_contact_reached: bool | None
    has_visit_request: bool
    # 由哪一筆官網預約建立；招生入學點卡片時開那筆預約明細（2026-10-05 家庭頁規格 6.1）。
    visit_request_id: uuid.UUID | None
    version: int


class FollowUpTotalsOut(BaseModel):
    """全校區三種追蹤狀態的筆數（不受負責人篩選影響）；upcoming 只算 7 天內。"""

    due: int
    upcoming: int
    unscheduled: int


class FollowUpListOut(BaseModel):
    as_of: datetime
    campus_key: str
    scope: FollowUpKind
    totals: FollowUpTotalsOut
    # 目前範圍加負責人篩選後的筆數。
    total: int
    page: int
    page_size: int
    rows: list[FollowUpRowOut]


class AdmissionsStaffOut(BaseModel):
    """可以當這個校區追蹤負責人的帳號（啟用中、有 admissions.write、涵蓋該校區）。"""

    id: uuid.UUID
    display_name: str | None
    email: str
