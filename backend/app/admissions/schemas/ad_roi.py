"""廣告花費的 schema（2026-11-16 docs/specs/2026-11-16-ad-roi-design.md §6.2）。"""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class AdSpendIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    amount: int = Field(ge=0, le=10_000_000)
    note: str | None = Field(default=None, max_length=100)

    @field_validator("note", mode="before")
    @classmethod
    def _strip_note(cls, value):
        # 去頭尾空白，空字串當沒填
        if isinstance(value, str):
            value = value.strip()
            return value or None
        return value


class AdSpendEntryOut(BaseModel):
    month: str
    platform: str
    amount: int
    note: str | None
    updated_at: datetime


class AdSpendListOut(BaseModel):
    entries: list[AdSpendEntryOut]


class AdRoiGoogleCampaignOut(BaseModel):
    campaign_id: str
    campaign_name: str
    cost: int
    clicks: int
    impressions: int
    leads: int
    cost_per_click: int | None


class AdRoiGoogleOut(BaseModel):
    configured: bool
    error: str | None
    currency: str | None
    time_zone: str | None
    fetched_at: datetime | None
    campaigns: list[AdRoiGoogleCampaignOut]


class AdRoiRowOut(BaseModel):
    key: Literal["google", "openai", "meta", "line", "other", "unknown", "offline", "organic", "unrecorded"]
    spend: int | None
    spend_state: Literal["ok", "unset", "not_configured", "error", "none"]
    missing_months: int
    clicks: int | None
    cases: int
    completed: int
    no_show: int
    deposited: int
    cost_per_case: int | None
    cost_per_completed: int | None
    cost_per_deposit: int | None
    cost_partial: bool


class AdRoiPendingOut(BaseModel):
    upcoming: int
    awaiting_attendance: int
    considering: int


class AdRoiCampusOut(BaseModel):
    campus_key: str
    platform: str
    cases: int
    completed: int
    deposited: int


class AdRoiOut(BaseModel):
    """廣告成效（§7）：touch 是歸屬口徑；rows 照 ROW_KEYS 順序。"""

    as_of: datetime
    touch: Literal["last", "first"]
    months: list[str]
    google: AdRoiGoogleOut
    rows: list[AdRoiRowOut]
    pending: AdRoiPendingOut
    by_campus: list[AdRoiCampusOut]
