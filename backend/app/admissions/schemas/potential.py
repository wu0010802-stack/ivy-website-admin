"""招生潛力與市佔率、三個來源（2026-10-20 規格）。"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

from app.admissions.schemas.area import AreaCampusOut


# ---- 招生潛力與市佔率（2026-10-20 招生潛力與市佔率規格 §5）----


class PotentialShareYearOut(BaseModel):
    school_year: int
    # 上學期四個年級日期欄註冊人數相加（不含重讀保留生）。
    registered: int
    # 同學年九月底半徑內 2–5 歲戶籍人數；那一年沒有九月列時 children、villages、share 都是 null（不是 0）。
    children: int | None
    villages: int | None
    share: float | None
    # 里代碼變過的學年，把同區舊代碼一起計入分母（note 另有說明）。
    merged: bool


class PotentialElementaryYearOut(BaseModel):
    school_year: int
    grade1: int
    # 學區內 6 歲戶籍人數（一個里對到 n 所學校各算 1/n，所以是小數）。
    age6: float
    ratio: float
    # 那一年有一年級人數的學校數。
    schools: int


class PotentialElementaryCheckOut(BaseModel):
    # 半徑內各里所屬的國小數。
    schools: int
    years: list[PotentialElementaryYearOut]
    # 最新一年以前各年比值的平均；latest_ratio 偏離它超過門檻時 warn 為 true。
    mean: float
    latest_ratio: float
    warn: bool


class PotentialShareOut(BaseModel):
    status: Literal["ready", "not_imported", "no_campus_point"]
    radius_km: int
    # 最新一個有市佔率的學年、市佔率最高的學年（同分取較新）；沒有任何學年算得出市佔率時是 null。
    latest: PotentialShareYearOut | None
    best: PotentialShareYearOut | None
    years: list[PotentialShareYearOut]
    elementary_check: PotentialElementaryCheckOut | None
    notes: list[str]


# ---- 招生潛力的三個來源（2026-10-20 招生潛力第二、三波規格 §5）----


class PotentialAssumptionOut(BaseModel):
    """「怎麼算」的一列：用到的參數與出處，值一律是字串（單位與出處寫在裡面）。不放任何占有率的原值。"""

    label: str
    value: str


class ClosureYearOut(BaseModel):
    # 學年窗口（10 月到隔年 9 月）：weighted＝窗口內各事件承接率取 1 的流入加總；沒停辦的窗口也列，值 0。
    school_year: int
    weighted: float
    events: int


class ClosureSkippedOut(BaseModel):
    # no_capacity＝核定名額沒填而略過；outside_windows＝不在任何完整窗口（進行中，或早於第一個窗口）。
    no_capacity: int
    outside_windows: int


class ClosureCountedEventOut(BaseModel):
    occurred_on: date
    name: str
    approved_capacity: int
    distance_m: int
    school_year: int
    # 承接率取 1 的流入（還沒乘承接率）。
    weighted: float


class ClosureDetailsOut(BaseModel):
    years: list[ClosureYearOut]
    skipped: ClosureSkippedOut
    # 算進去的事件裡，價格係數因缺收費資料取 1 的事件數。
    price_unknown: int
    events: list[ClosureCountedEventOut]


class VillageBandOut(BaseModel):
    # 距離帶（km）：0-1、1-2、2-3。有一帶有孩子的里不到 3 個時，三帶的 enrolled、expected、gap 都是 null（只剩里數與孩子數）。
    band: Literal["0-1", "1-2", "2-3"]
    villages: int
    kids: int
    enrolled: int | None
    expected: float | None
    gap: float | None


class VillageModelOut(BaseModel):
    # log μ = a + b·距離（km）+ log(2–5 歲)。
    a: float
    b: float


class VillageDetailsOut(BaseModel):
    # 只有距離帶彙總，沒有逐里的值。來源沒有數字時 bands 是空的、model 是 null。
    bands: list[VillageBandOut]
    model: VillageModelOut | None


class PresaleDeliveryOut(BaseModel):
    name: str
    households: int
    expected_year: int
    # 1 上半年、2 下半年（預計交屋只到半年）。
    expected_half: Literal[1, 2]
    # 取整 100 m。
    distance_m: int
    # 中值貢獻；來源二把距離帶藏起來時是 null（不然可以反推占有率）。
    mid: float | None
    # 預計交屋早於今天、還沒登記。
    overdue: bool


class PresaleDetailsOut(BaseModel):
    deliveries: list[PresaleDeliveryOut]


class PotentialSourceOut(BaseModel):
    """三個來源共同的欄位；各來源的 key 與 details 在子類別。no_data 時 low、mid、high 是 null，reason 說明為什麼。"""

    status: Literal["ok", "no_data"]
    low: float | None
    mid: float | None
    high: float | None
    reason: str | None
    assumptions: list[PotentialAssumptionOut]


class PotentialClosureSourceOut(PotentialSourceOut):
    key: Literal["closures"]
    details: ClosureDetailsOut


class PotentialVillageSourceOut(PotentialSourceOut):
    key: Literal["villages"]
    details: VillageDetailsOut


class PotentialPresaleSourceOut(PotentialSourceOut):
    key: Literal["presale"]
    details: PresaleDetailsOut


PotentialSourceKey = Literal["closures", "villages", "presale"]


class PotentialTotalOut(BaseModel):
    # 只加 status 為 ok 的來源；included 列出加了哪些。
    low: float
    mid: float
    high: float
    included: list[PotentialSourceKey]


class PotentialCapacityOut(BaseModel):
    # 本校核定名額、最近一次在籍清冊人數、目前空位（核定 − 在籍，不小於 0）。
    approved: int
    enrolled: int
    open: int


class PotentialEventOut(BaseModel):
    # 本校 3 km 內的幼兒園停辦（供走勢圖標記）；school_year 是來源一的學年窗口（10 月到隔年 9 月）。
    occurred_on: date
    name: str
    approved_capacity: int | None
    distance_m: int
    school_year: int


class PotentialEstimateOut(BaseModel):
    status: Literal["ready", "no_campus_point"]
    # 固定三筆、固定順序：closures、villages、presale。
    sources: list[
        Annotated[
            PotentialClosureSourceOut | PotentialVillageSourceOut | PotentialPresaleSourceOut, Field(discriminator="key")
        ]
    ]
    total: PotentialTotalOut | None
    capacity: PotentialCapacityOut | None
    events: list[PotentialEventOut]


class PotentialOut(BaseModel):
    campus: AreaCampusOut
    share: PotentialShareOut
    potential: PotentialEstimateOut
    generated_at: datetime
