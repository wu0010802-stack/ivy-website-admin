"""歷年註冊的去識別 JSON（2026-10-20 招生潛力與市佔率規格 §3.1）：本機 extract 寫出、正式站 import 讀入。

只有數字與表上的截止日，多出任何欄位（例如不小心帶到備註裡的姓名）整份拒絕；錯誤訊息只寫欄位位置與錯誤種類、
不印輸入值。這個模組在正式站跑，不可在模組層 import workbook（它依賴只在 extract 群組裝的 xlrd）。"""
from __future__ import annotations

from dataclasses import asdict
from datetime import date
from typing import TYPE_CHECKING, Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, ValidationError, field_validator
from pydantic_core import PydanticCustomError

from app.admissions import constants
from app.campuses.models import CAMPUS_KEYS

if TYPE_CHECKING:
    from app.admissions.history.workbook import ParsedWorkbook

FORMAT = "ivy-enrollment-history/1"
FIRST_SCHOOL_YEAR = 99  # 園方的歷年註冊表從 99 上開始
Count = Annotated[int, Field(ge=0, le=999)]
# 表上的新生目標＝目標−舊生在籍，在籍多過目標時是負的（真檔有 −2～−5），所以只有這一欄允許負值。
SignedCount = Annotated[int, Field(ge=-999, le=999)]


class TermRowIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    school_year: int = Field(ge=FIRST_SCHOOL_YEAR, le=constants.SCHOOL_YEAR_MAX)
    semester: Literal[1, 2]
    grade: Literal["大班", "中班", "小班", "幼幼班"]
    as_of: date
    registered: Count
    target: Count | None = None
    returning_enrolled: Count | None = None
    returning_deposit: Count | None = None
    returning_registered: Count | None = None
    new_target: SignedCount | None = None
    new_visits: Count | None = None
    new_deposits: Count | None = None
    new_registered: Count | None = None
    repeat_deposit: Count | None = None
    repeat_registered: Count | None = None


class EnrollmentHistoryIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    format: Literal["ivy-enrollment-history/1"]
    campus_key: str
    rows: list[TermRowIn] = Field(min_length=1, max_length=1000)
    warnings: list[Annotated[str, StringConstraints(max_length=120)]] = Field(default_factory=list, max_length=200)

    @field_validator("campus_key")
    @classmethod
    def _known_campus(cls, value: str) -> str:
        if value not in CAMPUS_KEYS:
            raise ValueError("沒有這個校區")
        return value

    @field_validator("rows")
    @classmethod
    def _unique_terms(cls, rows: list[TermRowIn]) -> list[TermRowIn]:
        keys = [(row.school_year, row.semester, row.grade) for row in rows]
        if len(set(keys)) != len(keys):
            raise PydanticCustomError("duplicate_term", "學期與年級重複")
        return rows


def build_payload(parsed: ParsedWorkbook, campus_key: str) -> dict:
    """解析結果 → 可直接 json.dumps 的 dict（日期轉 ISO 字串）；格式有沒有問題交給 load_payload 驗。"""
    rows = [{**asdict(row), "as_of": row.as_of.isoformat()} for row in parsed.rows]
    return {"format": FORMAT, "campus_key": campus_key, "rows": rows, "warnings": list(parsed.warnings)}


def load_payload(text: str) -> EnrollmentHistoryIn:
    """JSON 文字直接給 pydantic 解析。"""
    return EnrollmentHistoryIn.model_validate_json(text)


def _position(item: dict) -> str:
    """欄位位置；extra_forbidden 的最後一段是檔案裡多出來的鍵名（可能就是姓名），不印，改寫「（多餘欄位）」。"""
    loc = [str(part) for part in item["loc"]]
    if item["type"] == "extra_forbidden" and loc:
        loc[-1] = "（多餘欄位）"
    return ".".join(loc) or "(整份)"


def describe_error(error: ValidationError) -> str:
    """只列欄位位置與錯誤種類（前 5 個），不印輸入值，多餘欄位的鍵名也不印：檔案裡可能混進姓名。"""
    parts = [f"{_position(item)}：{item['type']}" for item in error.errors()[:5]]
    more = len(error.errors()) - len(parts)
    return "；".join(parts) + (f"；另有 {more} 個錯誤" if more > 0 else "")
