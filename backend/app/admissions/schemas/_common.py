"""招生 schema 共用的列舉型別與文字清理（原 schemas.py 開頭）。"""

from __future__ import annotations

from datetime import date
from typing import Annotated, Literal

from pydantic import AfterValidator, Field

from app.admissions import constants
from app.booking.schemas import has_control_chars
from app.common.timezones import today_local


Grade = Literal[constants.GRADES]
NoDepositReason = Literal[constants.NO_DEPOSIT_REASONS]
SourceCategory = Literal[tuple(constants.SOURCE_CATEGORIES)]
WithdrawnFrom = Literal[constants.WITHDRAWN_FROM]
WithdrawReasonCategory = Literal[constants.WITHDRAW_REASON_CATEGORIES]
EventType = Literal[constants.EVENT_TYPES]
Priority = Literal[tuple(constants.NO_DEPOSIT_PRIORITY)]
SchoolYear = Annotated[int, Field(ge=constants.SCHOOL_YEAR_MIN, le=constants.SCHOOL_YEAR_MAX)]
Semester = Annotated[int, Field(ge=1, le=2)]


def clean_text(value):
    """去頭尾空白；空字串回 None；含控制字元丟 ValueError（換行、TAB 可以）。"""
    if not isinstance(value, str):
        return value
    if has_control_chars(value):
        raise ValueError("內容含有不允許的控制字元")
    return value.strip() or None


OptionalText = Annotated[str | None, AfterValidator(clean_text)]


def _required_text(value: str | None, message: str) -> str:
    cleaned = clean_text(value)
    if cleaned is None:
        raise ValueError(message)
    return cleaned


def _not_future(value: date | None) -> date | None:
    if value is not None and value > today_local():
        raise ValueError("生日不能晚於今天")
    return value


def _roc_date(value: date | None, label: str) -> date | None:
    """民國年要落在 SCHOOL_YEAR_MIN～MAX：參觀日期的 month 才會是三位數年份（roc_month
    直接 year-1911）；註冊日期用同一個範圍擋掉打錯的年份。"""
    if value is not None and not constants.SCHOOL_YEAR_MIN <= value.year - 1911 <= constants.SCHOOL_YEAR_MAX:
        raise ValueError(f"{label}的民國年必須在 {constants.SCHOOL_YEAR_MIN}～{constants.SCHOOL_YEAR_MAX} 之間")
    return value


def _roc_visit_date(value: date | None) -> date | None:
    return _roc_date(value, "參觀日期")
