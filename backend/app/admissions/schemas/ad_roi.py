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
    # 助攻（touch=last）／收尾（touch=first）：另一次進站是這個平台的廣告、但歸屬給別的來源的案件，與其中到場、預繳。
    # 不分攤花費、不算進成本（2026-11-19 docs/specs/2026-11-19-cookie-stats-design.md §1）。
    assist_cases: int
    assist_completed: int
    assist_deposited: int
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


class AdConversionEventOut(BaseModel):
    event: Literal["visit_attended", "deposit_paid"]
    pending: int
    sent: int
    failed: int
    skipped: int


class AdConversionPlatformOut(BaseModel):
    platform: Literal["ga4", "meta", "openai", "line"]
    # 正式站有沒有設好這個平台的伺服器端金鑰（沒設就不會記識別碼，也不會排入）。
    configured: bool
    events: list[AdConversionEventOut]
    last_sent_at: datetime | None
    # 最近一筆失敗或略過的原因（HTTP 狀態與平台錯誤摘要，或 expired／no_identifier／anonymized／not_configured）；不含個資。
    last_problem: str | None
    last_problem_at: datetime | None
    # 期間內送出的官網預約，帶到這個平台識別碼的件數。
    cases_with_ids: int


class AdConversionStatusOut(BaseModel):
    """回傳廣告平台的狀態（2026-11-19 docs/specs/2026-11-19-cookie-stats-design.md §8）。"""

    as_of: datetime
    days: int
    # 期間內送出的官網預約（排除測試／重複），識別碼覆蓋率的分母。
    cases: int
    platforms: list[AdConversionPlatformOut]
