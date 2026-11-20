from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


class Lead(BaseModel):
    """一個家長報名／訪視（園務系統的招生一筆）。

    id 規則：官網預約是 `vr:<預約 uuid>`（origin＝visit_request，不論有沒有招生訪視）；沒有預約的招生訪視
    （手動建立，或原預約已刪除）是 `rv:<招生訪視 uuid>`（origin＝manual_visit）。個資欄位在預約或招生訪視任一
    已匿名化（anonymized＝true）時一律是 null。"""

    id: str
    origin: Literal["visit_request", "manual_visit"]
    visit_request_id: uuid.UUID | None
    recruitment_visit_id: uuid.UUID | None
    # 預約狀態；manual_visit 沒有預約，為 null。
    booking_status: Literal["confirmed", "completed", "no_show", "cancelled"] | None
    # 預約從哪裡來（web、phone、line、walk_in、external）；manual_visit 為 null。
    booking_source: str | None
    # 招生階段（由欄位推導）；沒有招生訪視為 null。
    stage: Literal["visited", "deposited", "enrolled", "withdrawn"] | None
    created_at: datetime
    # 招生訪視的最後更新時間；沒有招生訪視為 null。
    updated_at: datetime | None
    # 有訪視用訪視的參觀日期，沒有訪視用場次日期，都沒有為 null（不用今天補）。
    visit_date: date | None
    # 民國月份「115.09」；沒有招生訪視為 null。
    month: str | None
    child_name: str | None
    birthday: date | None
    grade: str | None
    phone: str | None
    contact_name: str | None
    address: str | None
    district: str | None
    source: str | None
    referrer: str | None
    deposit_collector: str | None
    notes: str | None
    parent_response: str | None
    has_deposit: bool
    enrolled: bool
    transfer_term: bool
    target_school_year: int | None
    target_semester: int | None
    anonymized: bool


class LeadsPage(BaseModel):
    campus_key: str
    # 這一頁開始查詢的時間（UTC）。各頁各自取；跨頁拼整份快照時以 id 去重，同一個 id 以 updated_at／狀態較新的為準。
    as_of: datetime
    items: list[Lead]
    # 還有下一頁時的不透明游標；已取完為 null。
    next_cursor: str | None = Field(default=None)
