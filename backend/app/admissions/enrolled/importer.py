"""匯入本機比對產生的去識別 JSON（2026-10-15 規格 §3.5）。多出任何欄位（例如不小心帶到地址）整份拒絕，
錯誤訊息只寫欄位位置與錯誤種類、不印輸入值；同一校整批取代，在呼叫端的單一交易內完成。"""
from __future__ import annotations

import logging
import re
from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import constants
from app.admissions.enrolled.models import POINT_LEVELS, EnrolledRoster, EnrolledStudentPoint
from app.admissions.geo.kaohsiung import DISTRICTS, in_kaohsiung
from app.campuses.models import CAMPUS_KEYS

logger = logging.getLogger("app.admissions.enrolled")

# 最後一道關：district、village 是自由文字欄位，白名單擋下不小心帶進來的地址或其他字串。
_VILLAGE = re.compile(r"[一-鿿]{1,6}[里村]")


class EnrolledStudentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    grade: Literal["幼幼班", "小班", "中班", "大班", "其他"]
    district: str | None = Field(default=None, max_length=8)
    village: str | None = Field(default=None, max_length=16)
    match_level: Literal["exact", "nearby", "street", "district", "unlocated"]
    unlocated_reason: Literal["no_address", "outside_kaohsiung", "no_doorplate", "ambiguous_village"] | None = None
    lat: Decimal | None = Field(default=None, max_digits=6, decimal_places=3)
    lng: Decimal | None = Field(default=None, max_digits=7, decimal_places=3)

    @field_validator("district")
    @classmethod
    def _known_district(cls, value: str | None) -> str | None:
        if value is not None and value not in DISTRICTS:
            raise ValueError("不是高雄市的行政區")
        return value

    @field_validator("village")
    @classmethod
    def _village_name(cls, value: str | None) -> str | None:
        if value is not None and _VILLAGE.fullmatch(value) is None:
            raise ValueError("不是里名")
        return value

    @model_validator(mode="after")
    def _point_rules(self) -> EnrolledStudentIn:
        has_lat, has_lng = self.lat is not None, self.lng is not None
        if has_lat != has_lng:
            raise ValueError("lat 與 lng 要一起有或一起沒有")
        if (self.match_level in POINT_LEVELS) != has_lat:
            raise ValueError("只有 exact、nearby 有座標，而且一定要有")
        if has_lat and not in_kaohsiung(float(self.lat), float(self.lng)):
            raise ValueError("座標不在高雄市範圍內")
        return self


class EnrolledRosterIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    format: Literal["ivy-enrolled-points/1"]
    campus_key: str
    roster_date: date
    school_year: int = Field(ge=constants.SCHOOL_YEAR_MIN, le=constants.SCHOOL_YEAR_MAX)
    doorplate_version: str = Field(min_length=1, max_length=16)
    students: list[EnrolledStudentIn] = Field(min_length=1, max_length=5000)

    @field_validator("campus_key")
    @classmethod
    def _known_campus(cls, value: str) -> str:
        if value not in CAMPUS_KEYS:
            raise ValueError("沒有這個校區")
        return value


def load_payload(text: str) -> EnrolledRosterIn:
    """JSON 文字直接給 pydantic 解析（數字照原文轉 Decimal，小數位數才驗得準）。"""
    return EnrolledRosterIn.model_validate_json(text)


def describe_error(error: ValidationError) -> str:
    """只列欄位位置與錯誤種類（前 5 個），不印輸入值：檔案裡可能混進地址。"""
    parts = [f"{'.'.join(str(part) for part in item['loc']) or '(整份)'}：{item['type']}" for item in error.errors()[:5]]
    more = len(error.errors()) - len(parts)
    return "；".join(parts) + (f"；另有 {more} 個錯誤" if more > 0 else "")


async def replace_roster(db: AsyncSession, payload: EnrolledRosterIn) -> tuple[int, int]:
    """整批取代該校清冊（刪清冊列，資料庫 ON DELETE CASCADE 帶走舊的點）；回 (人數, 有點人數)。呼叫端 commit。"""
    await db.execute(delete(EnrolledRoster).where(EnrolledRoster.campus_key == payload.campus_key))
    db.add(
        EnrolledRoster(
            campus_key=payload.campus_key, roster_date=payload.roster_date, school_year=payload.school_year,
            doorplate_version=payload.doorplate_version, total=len(payload.students),
        )
    )
    await db.flush()
    db.add_all(EnrolledStudentPoint(campus_key=payload.campus_key, **item.model_dump()) for item in payload.students)
    await db.flush()
    placed = sum(1 for item in payload.students if item.lat is not None)
    logger.info(
        "在籍學生清冊已匯入：%s，%d 位（有點 %d 位），清冊日期 %s",
        payload.campus_key, len(payload.students), placed, payload.roster_date.isoformat(),
    )
    return len(payload.students), placed


async def clear_roster(db: AsyncSession, campus_key: str) -> bool:
    """刪除該校清冊與所有點；本來就沒有回 False。呼叫端 commit。"""
    result = await db.execute(delete(EnrolledRoster).where(EnrolledRoster.campus_key == campus_key))
    return bool(result.rowcount)
