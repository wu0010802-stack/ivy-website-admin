from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

LeadStatus = Literal["new", "converted", "dismissed"]


class MetaLeadAnswerOut(BaseModel):
    # Meta 的題目代碼（內建欄位是 email 之類的英文代碼；自訂題目通常是題目文字）。
    question: str
    answer: str


class MetaLeadOut(BaseModel):
    id: uuid.UUID
    campus_key: str
    form_name: str | None
    # Meta 回的 platform：fb、ig 等。
    platform: str | None
    is_organic: bool | None
    # 家長在 Meta 送出表單的時間。
    created_at: datetime
    # 轉成案件後清掉：已轉案件的這三欄是 null／空陣列，資料看案件。
    parent_name: str | None
    phone: str | None
    answers: list[MetaLeadAnswerOut]
    status: LeadStatus
    visit_request_id: uuid.UUID | None
    handled_at: datetime | None


class MetaLeadSyncStatusOut(BaseModel):
    last_attempt_at: datetime | None
    last_success_at: datetime | None
    # 只有步驟、HTTP 狀態與 Meta 錯誤代碼（例：讀取名單（HTTP 403、code 200）＝權杖缺 leads_retrieval）。
    last_error: str | None
    last_count: int | None


class MetaLeadCounts(BaseModel):
    new: int = 0
    converted: int = 0
    dismissed: int = 0


class MetaLeadListOut(BaseModel):
    # 這校有沒有接上 Meta 名單（WEBSITE_META_LEADS_ENABLED 開著、而且 WEBSITE_FACEBOOK_PAGES 有這校）。
    configured: bool
    sync_seconds: int
    sync: MetaLeadSyncStatusOut | None
    counts: MetaLeadCounts
    leads: list[MetaLeadOut]


class MetaLeadSyncIn(BaseModel):
    campus_key: str = Field(min_length=1, max_length=32)


class MetaLeadPendingOut(BaseModel):
    """看得到的各校還沒處理的新名單數（側欄提示用）；只列有新名單的校。"""

    campuses: dict[str, int]
