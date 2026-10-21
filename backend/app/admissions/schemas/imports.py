"""後台資料匯入：在籍清冊與歷年註冊的預覽、確認與清除（2026-10-21 規格 §5–§8）。

在籍清冊預覽的輸入只有班別與地址（姓名、生日在瀏覽器就丟掉），一律 extra="forbid"；回應裡的點位和
EnrolledRosterIn 的內容相同，原樣送回「確認匯入」。地址只在預覽請求裡出現，不進任何回應。
歷年註冊預覽的輸入是瀏覽器擷取後的格子表（表頭兩列與年級列，內容不明的格子只留位置），回應裡的 payload 和
EnrollmentHistoryIn 相同，原樣送回「確認匯入」。"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictFloat, StrictInt, StrictStr, StringConstraints, field_validator, model_validator

from app.admissions import academic, constants
from app.admissions.history.grid import EMPTY, MASKED, GridCell, SheetGrid
from app.admissions.schemas.enrolled import EnrolledGrade


# ---- 在籍清冊預覽（輸入）----


class EnrolledUploadStudentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    grade: EnrolledGrade
    # 清冊沒填地址的學生送空字串：同 CLI，比對時列為 no_address，算進總數但沒有點。
    address: str = Field(max_length=120)


class EnrolledPreviewIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    roster_date: date
    students: list[EnrolledUploadStudentIn] = Field(min_length=1, max_length=2000)

    @field_validator("roster_date")
    @classmethod
    def _plausible_term(cls, value: date) -> date:
        # 學年算出來要落在匯入端（EnrolledRosterIn.school_year）收得下的範圍，不然預覽通過、確認匯入卻被擋。
        if not constants.SCHOOL_YEAR_MIN <= academic.current_term(value)[0] <= constants.SCHOOL_YEAR_MAX:
            raise ValueError("清冊日期不在合理範圍")
        return value


# ---- 在籍清冊預覽（輸出）----


class EnrolledImportPointOut(BaseModel):
    grade: EnrolledGrade
    district: str | None
    village: str | None
    match_level: str
    unlocated_reason: str | None
    lat: float | None
    lng: float | None


class EnrolledImportPayloadOut(BaseModel):
    format: Literal["ivy-enrolled-points/1"]
    campus_key: str
    roster_date: date
    school_year: int
    doorplate_version: str
    students: list[EnrolledImportPointOut]


class EnrolledImportUnplacedOut(BaseModel):
    match_level: str
    unlocated_reason: str | None
    # masked_address() 的結果（「義華路…」），切不出街路是空字串；不會有門牌號碼或樓層。
    street: str


class EnrolledPreviewOut(BaseModel):
    roster_date: date
    school_year: int
    doorplate_version: str
    total: int
    placed: int
    placed_ratio: float
    # 有點比例達門檻（MIN_PLACED_RATIO），確認匯入才收。
    importable: bool
    levels: dict[str, int]
    methods: dict[str, int]
    inferred: int
    grades: dict[str, int]
    unplaced: list[EnrolledImportUnplacedOut]
    payload: EnrolledImportPayloadOut


# ---- 匯入狀態 ----


class EnrolledImportStatusOut(BaseModel):
    roster_date: date
    school_year: int
    doorplate_version: str
    total: int
    placed: int
    imported_at: datetime


class HistoryImportStatusOut(BaseModel):
    rows: int
    first_school_year: int
    first_semester: int
    last_school_year: int
    last_semester: int
    imported_at: datetime


class ImportStatusOut(BaseModel):
    # 使用中的門牌資料月份（「115-10」，和 EnrolledImportStatusOut.doorplate_version 同一種寫法）；還沒匯入過是 None。
    active_doorplate_version: str | None
    enrolled: EnrolledImportStatusOut | None
    history: HistoryImportStatusOut | None


class EnrolledApplyOut(BaseModel):
    students: int
    placed: int


class EnrolledClearOut(BaseModel):
    removed: bool


# ---- 歷年註冊預覽（輸入）----

# 瀏覽器只送表頭兩列（第 2、3 列）與年級／總人數那五列（第 4–999 列之間），所以最多 7 列。
HISTORY_HEADER_ROWS = (2, 3)
HISTORY_MAX_ROW = 999
HISTORY_MAX_ROWS = 7
# 格子裡的數字上限：JavaScript 的整數到 2**53 都精確；超過的不是人數，也避免 float() 溢位。
_MAX_CELL_NUMBER = 2**53


class HistoryMaskedCellIn(BaseModel):
    """有內容但不明的格子（率欄、備註、姓名）：只留位置，沒有值。"""

    model_config = ConfigDict(extra="forbid")

    masked: Literal[True]


# 嚴格型別：JSON 的 true／false 不能當成 1／0 混進來，文字格也不能被轉成數字。
HistoryCellIn = (
    Annotated[StrictInt, Field(ge=-_MAX_CELL_NUMBER, le=_MAX_CELL_NUMBER)]
    | Annotated[StrictFloat, Field(ge=-_MAX_CELL_NUMBER, le=_MAX_CELL_NUMBER, allow_inf_nan=False)]
    | Annotated[StrictStr, StringConstraints(max_length=200)]
    | HistoryMaskedCellIn
    | None
)


def _grid_cell(cell: HistoryCellIn) -> GridCell:
    # 驗證已經擋掉其他型別：這裡只會碰到 None、遮住、字串與（嚴格的）數字。
    if cell is None:
        return EMPTY
    if isinstance(cell, HistoryMaskedCellIn):
        return MASKED
    if isinstance(cell, str):
        return GridCell("text", cell)
    return GridCell("number", float(cell))


class HistorySheetIn(BaseModel):
    """一張工作表的擷取結果：表名、欄數，以及稀疏的列（列號 → 格子，每列長度不超過 width）。"""

    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=20)
    width: int = Field(ge=1, le=64)
    rows: dict[int, list[HistoryCellIn]]

    @field_validator("rows")
    @classmethod
    def _known_rows(cls, rows: dict[int, list[HistoryCellIn]]) -> dict[int, list[HistoryCellIn]]:
        if len(rows) > HISTORY_MAX_ROWS:
            raise ValueError("列數太多")
        if any(row not in HISTORY_HEADER_ROWS and not 4 <= row <= HISTORY_MAX_ROW for row in rows):
            raise ValueError("列號不在表頭與年級列的範圍")
        return rows

    @model_validator(mode="after")
    def _within_width(self) -> "HistorySheetIn":
        if any(len(cells) > self.width for cells in self.rows.values()):
            raise ValueError("有一列比 width 長")
        return self

    def to_grid(self) -> SheetGrid:
        """轉成解析層吃的格子表；kind 與 value 一定一致（數字一律 float，和 xlrd 讀進來的數字格相同）。"""
        return SheetGrid(
            name=self.name,
            width=self.width,
            rows={row: [_grid_cell(cell) for cell in cells] for row, cells in self.rows.items()},
        )


class HistoryPreviewIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sheets: list[HistorySheetIn] = Field(min_length=1, max_length=100)


# ---- 歷年註冊預覽（輸出）----


class HistoryTermOut(BaseModel):
    school_year: int
    semester: int


class HistoryChangeOut(BaseModel):
    """兩邊都有、註冊人數不同的（學期, 年級）。"""

    school_year: int
    semester: int
    grade: str
    before: int
    after: int


class EnrollmentHistoryRowOut(BaseModel):
    """欄位同 history.payload.TermRowIn（原樣送回確認匯入）。"""

    school_year: int
    semester: Literal[1, 2]
    grade: Literal["大班", "中班", "小班", "幼幼班"]
    as_of: date
    registered: int
    target: int | None
    returning_enrolled: int | None
    returning_deposit: int | None
    returning_registered: int | None
    new_target: int | None
    new_visits: int | None
    new_deposits: int | None
    new_registered: int | None
    repeat_deposit: int | None
    repeat_registered: int | None


class EnrollmentHistoryPayloadOut(BaseModel):
    format: Literal["ivy-enrollment-history/1"]
    campus_key: str
    rows: list[EnrollmentHistoryRowOut]
    warnings: list[str]


class HistoryPreviewOut(BaseModel):
    rows: int
    first: HistoryTermOut
    last: HistoryTermOut
    # 資料庫有、新檔沒有的學期（依學期排序）；確認匯入會整校取代，這些學期會消失。
    removed_terms: list[HistoryTermOut]
    # 兩邊都有、registered 不同的（學期, 年級）。
    changed: list[HistoryChangeOut]
    warnings: list[str]
    payload: EnrollmentHistoryPayloadOut


class HistoryApplyOut(BaseModel):
    rows: int
