from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class CampusOut(BaseModel):
    key: str
    name: str
    active: bool
    deactivated_at: datetime | None = None
    deactivated_reason: str | None = None

    model_config = {"from_attributes": True}


class CampusStatusUpdate(BaseModel):
    active: bool
    reason: str | None = Field(default=None, max_length=200)


class CampusStatusOut(CampusOut):
    # 停用時仍在進行中的案件數（新需求、聯絡中、待確認、已確認）。這些不
    # 會被自動取消，列給園方人工處理。
    open_requests: int = 0
