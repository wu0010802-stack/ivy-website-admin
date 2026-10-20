"""招生機會、趨勢與附近預售建案（2026-10-13、2026-10-20 規格）。"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

from app.admissions.schemas.area import AreaCampusOut, AreaFiltersOut


# ---- 招生機會（2026-10-13 招生機會規格 §6）----

OpportunitySignal = Literal["below", "typical", "above", "few_children", "not_judged"]


class AreaPopulationOut(BaseModel):
    """各里人口的版本與口徑。version 是統計月份「115-09」，還沒匯入是 null；age_band 固定 "2-5"。"""

    version: str | None
    synced_at: datetime | None
    age_band: Literal["2-5"]
    source_note: str


class AreaOpportunityBaselineOut(BaseModel):
    """本校半徑內（里的面積重心在圈內）的合計。rate＝visit ÷ children 的百分比（小數一位，分母 0 是 null）；
    judged＝visit 至少 10 位，才判斷哪些里偏少。"""

    villages: int
    children: int
    infants: int
    visit: int
    rate: float | None
    judged: bool


class AreaOpportunityRowOut(BaseModel):
    """半徑內一個里。children＝2–5 歲、infants＝0–1 歲；rate＝visit ÷ children（百分比）；
    expected＝照附近的參觀率應有的參觀人數、shortfall＝expected − visit（皆小數一位，沒有附近平均是 null）。
    signal：below 明顯偏少、typical 差不多、above 比附近多、few_children 應有不到 1 位、not_judged 附近參觀不到 10 位。"""

    district: str
    village: str
    village_code: str
    # 本校到里界面積重心的直線距離，取整到 100 m。
    distance_m: int
    children: int
    infants: int
    visit: int
    rate: float | None
    expected: float | None
    shortfall: float | None
    signal: OpportunitySignal


class AreaOpportunityMissingOut(BaseModel):
    """半徑內、但各里人口沒有這個里（來源和里界的里清單有出入）：沒有孩子數，參觀不進附近平均，也不是半徑外。
    visit＝這個里的參觀人數。"""

    district: str
    village: str
    village_code: str
    distance_m: int
    visit: int


class AreaOpportunityOut(BaseModel):
    as_of: datetime
    filters: AreaFiltersOut
    radius_km: int
    population: AreaPopulationOut
    campus: AreaCampusOut
    # 沒有人口資料或本校沒座標時是 null（villages 也是空的）。
    baseline: AreaOpportunityBaselineOut | None
    # 比對到里、但里在半徑外的參觀人數；沒對到里的（只到區、未定位、待比對、沒填地址、已匿名化）參觀人數，
    # 和其中沒填地址的（未匿名化；畫面把它和「沒對到里」分開寫）。
    outside_visit: int
    unplaced_visit: int
    no_address_visit: int
    # 半徑內但人口表沒有的里（通常是空的）；參觀多的在前、再依距離、區、里名。
    no_population_villages: list[AreaOpportunityMissingOut]
    # 依「應有 − 實際」由大到小；同值依孩子數、區、里名。
    villages: list[AreaOpportunityRowOut]


class AreaTrendsPopulationSourceOut(BaseModel):
    """各里人口：使用中的月份 M；year_ago_month 是 M−12，年齡歷史裡 M 與 M−12 都在才有值。"""

    month: str | None
    year_ago_month: str | None


class AreaTrendsMonthsOut(BaseModel):
    """出生或遷入遷出：表裡最新的月份（還沒匯入是 null）、近 12 個月裡有資料的月份、沒有資料的月份（舊到新）。"""

    latest: str | None
    months: list[str]
    missing: list[str]


class AreaTrendsIncomeSourceOut(BaseModel):
    """各里所得（C 段）：使用中的年度（民國，還沒匯入是 null）；note 是畫面照引的顯名與官方附註（沒匯入是空字串）。"""

    year: int | None
    note: str


class AreaTrendsSchoolDistrictSourceOut(BaseModel):
    """國小學區（D 段）：隨程式提交的對照檔的學年度（民國）與來源說明。"""

    school_year: int
    note: str


class AreaTrendsNewHomesSourceOut(BaseModel):
    """新成屋交屋（B2 段）：使用中的最新季（還沒匯入是 null）、近 4 季裡表有資料的季（舊到新）、本校半徑內有里的區裡
    沒對到里的筆數（只到區、待比對、里名對不到里界；不進里表）；note 是畫面照引的來源（沒匯入是空字串）。"""

    latest: str | None
    seasons: list[str]
    unplaced: int
    note: str


class AreaTrendsPresaleSourceOut(BaseModel):
    """在建預售（2026-10-20 預售建案規格 P10）：使用中的版本（「115-10」，還沒匯入是 null）、本校半徑內有里的區裡在建案
    沒對到里的案數（只到區、待比對；不進里表）；note 是畫面照引的來源（沒匯入是空字串）。"""

    version: str | None
    unplaced: int
    note: str


class AreaTrendsSourcesOut(BaseModel):
    population: AreaTrendsPopulationSourceOut
    births: AreaTrendsMonthsOut
    migration: AreaTrendsMonthsOut
    # 內政部戶政司三個資料集的來源（一句）。
    note: str
    income: AreaTrendsIncomeSourceOut
    new_homes: AreaTrendsNewHomesSourceOut
    presale: AreaTrendsPresaleSourceOut
    school_districts: AreaTrendsSchoolDistrictSourceOut


class AreaTrendsBirthPeriodOut(BaseModel):
    """半徑合計每 12 個月一期的出生數（2026-10-14 出生走勢規格 §4.2）。starts／ends 是「114-10」「115-09」；
    months 是這一期有資料的月數、missing 是這一期裡沒有資料的月份（舊到新）；change_pct 和前一期（更舊的）
    只比兩期都有資料的同月份（小數一位），比較的月份不到 6 個、前一期可比的出生不到 20 位、或沒有前一期時 null。"""

    starts: str
    ends: str
    months: int
    missing: list[str]
    births: int
    change_pct: float | None


class AreaTrendsBaselineOut(BaseModel):
    """本校半徑內（里界面積重心在圈內）的合計；里界調整合併的組整組算進來（含半徑外的組員）。
    children＝本月 2–5 歲；kids_net＝這一年淨增、kids_base＝一年前 1–4 歲（只加算得出的列）；
    births_change_pct＝和前一年同月份比的增減百分比（小數一位），比較的月份不到 6 個或前一年可比的出生不到 20 位時 null。"""

    villages: int
    # 里界調整合併組帶進來、在半徑外的里數（children、kids_net 等都含它們）；沒有是 0。
    villages_outside: int = 0
    children: int | None
    kids_net: int | None
    kids_base: int | None
    births_12m: int | None
    births_months: int
    births_compared_months: int
    births_change_pct: float | None
    # 每 12 個月一期，最新一期在前；沒有出生資料或湊不滿 10 個月時是空陣列。
    births_series: list[AreaTrendsBirthPeriodOut]
    migration_net_12m: int | None
    migration_months: int
    # 新成屋交屋（B2 段）：近 4 季到里的筆數、最近一季的筆數、近 4 季裡有資料的季數；沒匯入新成屋是 null、0。
    new_homes: int | None
    new_homes_latest: int | None
    new_homes_seasons: int
    # 在建預售（P10）：半徑內各里（合併組整組）在建住宅建案的戶數與案數；沒匯入預售建案是 null。
    presale_households: int | None
    presale_cases: int | None


class AreaTrendsVillageSchoolOut(BaseModel):
    """一列對到的國小：partial＝只有部分鄰屬於這所（合併組裡有里不屬這所也算），free_zone＝和別校自由學區。
    district 是學校所在的區（有同名學校，畫面寫「區＋校名」）。"""

    code: str
    name: str
    district: str
    partial: bool
    free_zone: bool


class AreaTrendsVillageOut(BaseModel):
    """半徑內一個里，或同區里界調整過的一組（merged，key 是 group:<區>:<組內最小代碼>、village 是頓號連起的里名、
    codes 含已廢止的舊代碼）。kids_level：up2 增加多／up1 增加／flat 差不多／down1 減少／down2 減少多／
    few 一年前 1–4 歲不到 20 位／unknown 算不出來。migration_net_12m＝跨區遷入 − 遷出 ＋ 住址變更入 − 出。"""

    key: str
    district: str
    village: str
    codes: list[str]
    merged: bool
    # 本校到里界面積重心的直線距離，取整到 100 m；合併組取組內最近的里。
    distance_m: int
    children: int | None
    kids_net: int | None
    kids_base: int | None
    kids_level: Literal["up2", "up1", "flat", "down1", "down2", "few", "unknown"]
    births_12m: int | None
    migration_net_12m: int | None
    # 所得中位數（千元，規格 V9：只當背景，不排序、不分級）。沒有所得的里（115-07 新設）與合併組是 null（中位數
    # 不能相加）；income_boundary_changed＝里界在所得年度之後調整過（數字是調整前的範圍）。
    income_median: int | None
    income_boundary_changed: bool
    # 新成屋交屋（B2 段）：近 4 季、最近一季到里的筆數（含預售屋交屋，不等於已入住）。匯入了新成屋，沒有交屋的里是 0；
    # 還沒匯入是 null。合併組整組相加。
    new_homes: int | None
    new_homes_latest: int | None
    # 各代碼自己的近 4 季筆數（只列有交屋的里；沒匯入是空的）。合併組的 new_homes 是整組的，地圖用這個替組內各里上色。
    new_homes_by_code: dict[str, int]
    # 在建預售（P10）：該里在建住宅建案的戶數合計（不等於已售出或已入住）。匯入了預售建案，沒有的里是 0；還沒匯入是 null。
    # 合併組整組相加；presale_by_code 是各代碼自己的戶數（只列有的），地圖用它替組內各里上色。
    presale_households: int | None
    presale_by_code: dict[str, int]
    # 國小學區（D 段）：整里在前、部分在後。
    schools: list[AreaTrendsVillageSchoolOut]


class AreaTrendsSchoolOut(BaseModel):
    """依國小學區（D 段）：學區碰到本校半徑內任一個里的國小，每所合計整個學區（含半徑外的里）。部分里與自由學區
    的里同時算進每一所，各列不能相加。enrollment：district 一般學區／open 大學區（實驗教育）／spacious 空間充裕
    ／capped 總量管制。kids_net 只加算得出的里（kids_partial＝有里界調整過或缺一年前年齡的里沒算進去）；
    rate＝參觀人數 ÷ 2–5 歲（%，小數一位，沒有孩子數是 null）。"""

    code: str
    name: str
    district: str
    enrollment: Literal["district", "open", "spacious", "capped"]
    villages_full: int
    villages_partial: int
    children: int | None
    kids_net: int | None
    kids_partial: bool
    visit: int
    rate: float | None


class AreaTrendsOut(BaseModel):
    as_of: datetime
    filters: AreaFiltersOut
    radius_km: int
    campus: AreaCampusOut
    sources: AreaTrendsSourcesOut
    # 本校沒座標時是 null（villages 也是空的）。
    baseline: AreaTrendsBaselineOut | None
    # 這一年淨增算不出來的原因：no_population 人口還沒匯入、no_year_ago 一年前的年齡還沒匯入、
    # no_migration 遷入遷出不足 10 個月；算得出來是 null。
    kids_unavailable: Literal["no_population", "no_year_ago", "no_migration"] | None
    # 依這一年淨增由大到小（算不出來的在最後）；同值依 2–5 歲孩子、區、里名。
    villages: list[AreaTrendsVillageOut]
    # 依參觀人數由大到小；同值依 2–5 歲孩子、學校所在區、校名。本校沒座標時是空的。
    schools: list[AreaTrendsSchoolOut]


# ---- 附近預售建案（2026-10-20 預售建案規格 P11、P12）----


class AreaPresaleSourceOut(BaseModel):
    """使用中的版本（「115-10」，還沒匯入是 null）、本校半徑內有里的區裡在建案沒對到里的案數（只到區、待比對；不列在清單）、
    畫面照引的來源（沒匯入是空字串）。"""

    version: str | None
    unplaced: int
    note: str


class AreaPresaleSummaryOut(BaseModel):
    cases: int
    households: int


class AreaPresaleItemOut(BaseModel):
    """半徑內一個在建預售建案。expected_year／expected_half 是預計交屋（建照日加依戶數的月數，粗估，只到半年：1 上半年、
    2 下半年）；overdue＝已過預計時間還沒登記。match_level：parcel 依地號座標、exact／nearby／street 依門牌街名；
    lat／lon 只有 parcel、exact、nearby 才有（街名只到里的沒有座標，距離取里界面積重心）。"""

    name: str
    district: str
    village: str
    village_code: str
    households: int
    permit_on: date
    expected_year: int
    expected_half: Literal[1, 2]
    overdue: bool
    # 本校到建案（有座標）或里界面積重心的直線距離，取整到 100 m。
    distance_m: int
    match_level: Literal["parcel", "exact", "nearby", "street"]
    lat: float | None
    lon: float | None


class AreaPresaleOut(BaseModel):
    as_of: datetime
    radius_km: int
    campus: AreaCampusOut
    source: AreaPresaleSourceOut
    summary: AreaPresaleSummaryOut
    # 依預計交屋由近到遠（已過預計時間的在最前），同值依距離、區、案名。
    items: list[AreaPresaleItemOut]
