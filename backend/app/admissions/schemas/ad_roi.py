"""廣告花費的 schema（2026-11-16 docs/specs/2026-11-16-ad-roi-design.md §6.2）。"""

from __future__ import annotations

from datetime import datetime

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
