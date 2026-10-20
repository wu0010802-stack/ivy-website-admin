"""區域分析、園所紀錄、托嬰、同業收費與園所異動（2026-10-08、2026-10-14 規格）。"""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

from app.admissions.schemas.records import AreaUnlocatedReason
from app.admissions.schemas.stats import AdmissionsRateRange


# ---- 區域分析（2026-10-08 區域分析規格 §8）----

DistanceBandKey = Literal["0-1", "1-3", "3-6", "6+", "none"]
KindergartenKind = Literal["public", "nonprofit", "quasi_public", "private"]
BabycareKind = Literal["center", "home"]
ProviderName = Literal["kindergarten", "babycare"]
ProviderChangeKind = Literal["opened", "closed", "kind_changed"]
ChangeDateBasis = Literal["registered", "observed"]
# 異動列的 kind：幼兒園是四種類型，托嬰是 center／home。
ChangeItemKind = Literal["public", "nonprofit", "quasi_public", "private", "center", "home"]
# 欄位叫 date 的 model 裡，用別名當型別，避免欄位名稱遮住 datetime.date。
DateOnly = date


class AreaFiltersOut(BaseModel):
    campus_key: str
    school_year: int | None
    semester: int | None


class AreaDataStatusOut(BaseModel):
    """公開資料的版本：門牌（民國年-月，例 115-10；還沒匯入是 null）、幼兒園更新時間、里界版本、
    各里人口月份（例 115-09，2026-10-13 招生機會；還沒匯入是 null）、托嬰名單更新時間（2026-10-14；還沒匯入是 null）。"""

    doorplate_version: str | None
    doorplates_synced_at: datetime | None
    kindergartens_synced_at: datetime | None
    babycare_synced_at: datetime | None
    boundary_version: str
    population_version: str | None
    population_synced_at: datetime | None


class AreaCampusOut(BaseModel):
    key: str
    name: str
    lat: float | None
    lng: float | None
    # 校址比對不到門牌的原因（no_address／no_doorplate／pending）；有座標時是 null。
    locate_error: str | None
    # 校址文字解析出的行政區（不看門牌）；沒有校址、外縣市或解析不出高雄的區時是 null。
    # 沒座標時後台地圖先框住這一區。
    district: str | None


class AreaReasonCountOut(BaseModel):
    # 只有有地址卻沒到里的三種原因；no_address、anonymized 各有自己的層級與筆數（見 AreaTotalsOut）。
    reason: AreaUnlocatedReason
    count: int


class AreaTotalsOut(BaseModel):
    """以有地址為母數（主控裁定 R5）。
    visit＝範圍內全部訪視＝with_address＋no_address＋anonymized。
    with_address＝未匿名化且有填地址（判斷同訪視明細的 geo=no_village 篩選）
    ＝village_level＋district_level＋unlocated＋pending。
    no_address＝未匿名化、沒填地址；anonymized＝已匿名化（地址已清掉，不算有地址）。
    unlocated_reasons 只算有地址、卻沒到里的原因（外縣市、查無門牌、里有歧義），
    只列筆數大於 0 的，筆數多的在前、同筆數依固定順序。"""

    visit: int
    with_address: int
    village_level: int
    district_level: int
    unlocated: int
    pending: int
    no_address: int
    anonymized: int
    unlocated_reasons: list[AreaReasonCountOut]


class AreaDistrictRowOut(BaseModel):
    district: str
    visit: int
    deposit: int
    visit_to_deposit_rate: float | None
    visit_to_deposit_range: AdmissionsRateRange | None


class AreaVillageRowOut(BaseModel):
    district: str
    village: str
    # 內政部村里代碼（11 碼），對照里界 GeoJSON 的 VILLCODE；對不到是 null。
    village_code: str | None
    visit: int
    deposit: int
    visit_to_deposit_rate: float | None
    visit_to_deposit_range: AdmissionsRateRange | None


class AreaDistanceBandOut(BaseModel):
    band: DistanceBandKey
    visit: int
    deposit: int
    visit_to_deposit_rate: float | None
    visit_to_deposit_range: AdmissionsRateRange | None


class AdmissionsAreaOut(BaseModel):
    as_of: datetime
    filters: AreaFiltersOut
    data_status: AreaDataStatusOut
    campus: AreaCampusOut
    totals: AreaTotalsOut
    # 有行政區的訪視依行政區分組（含只到區、已匿名化），參觀人數降冪、區名升冪。
    districts: list[AreaDistrictRowOut]
    # 比對到里的訪視依（行政區, 里）分組，參觀人數降冪。
    villages: list[AreaVillageRowOut]
    # 固定五列：0-1、1-3、3-6、6+、none。校區沒有座標時全部歸 none。
    distance_bands: list[AreaDistanceBandOut]


class AreaEvaluationLatestOut(BaseModel):
    year: int
    completed_on: date | None
    result: str


class AreaKindergartenOut(BaseModel):
    source_id: str
    name: str
    kind: KindergartenKind
    pre_public_period: str | None
    address: str
    lat: float
    lng: float
    distance_m: int
    approved_capacity: int | None
    # kiang 依收費明細估算的月費，不是官方欄位。
    monthly_fee_estimate: int | None
    has_penalty: bool
    phone: str | None
    # 與任一校區座標相距 50 公尺內：畫面標「本機構」，不算競爭園所。
    is_own: bool
    # 2026-10-15 附近同業比較：每位核定幼生的室內／戶外面積（m²，一位小數）、幼童專用車、兼辦國小課後人數（0＝無）。
    indoor_m2_per_child: float | None = None
    outdoor_m2_per_child: float | None = None
    has_shuttle: bool | None = None
    after_school_capacity: int | None = None
    # 2026-10-20 裁罰與評鑑：近 3 年裁罰件數（同一裁處日＋文號為一件）、最近一次裁處日（不限 3 年內）、3 年前有沒有裁罰、
    # 最近一次評鑑（學年度取最大，同學年取完成日最新）。沒有紀錄是 0／null／false。
    penalties_recent: int = 0
    penalty_latest_on: date | None = None
    has_older_penalty: bool = False
    evaluation_latest: AreaEvaluationLatestOut | None = None


class AreaKindergartensOut(BaseModel):
    synced_at: datetime | None
    # 裁罰、評鑑上次整表替換成功的時間；從沒匯入成功過是 null（畫面寫「尚未匯入」，不寫「沒有紀錄」）。
    penalties_synced_at: datetime | None = None
    evaluations_synced_at: datetime | None = None
    source_note: str
    campus: AreaCampusOut
    radius_km: int
    items: list[AreaKindergartenOut]


PenaltyKind = Literal["fine", "stop_enrollment", "reduce_enrollment", "closure", "other"]
PenaltySubject = Literal["operator", "staff"]


class AreaPenaltyRecordOut(BaseModel):
    """一筆處分。對象只有類別（operator＝園方〔負責人〕、staff＝教保人員個人〔行為人〕），沒有任何姓名。"""

    occurred_on: date
    doc_no: str
    law: str
    content: str
    kind: PenaltyKind
    amount: int | None
    period_start: date | None
    period_end: date | None
    # 只有 kind 是 other 時才有：來源的處分原文。
    punishment_text: str | None
    subject: PenaltySubject | None
    # 裁處日在近 3 年內（和清單的件數同一個起算日）。
    recent: bool


class AreaEvaluationRecordOut(BaseModel):
    school_year: int
    completed_on: date | None
    result: str


class AreaKindergartenRecordsOut(BaseModel):
    """展開一所園所時讀的全部裁罰與評鑑（2026-10-20 規格 §5）。"""

    source_id: str
    name: str
    penalties_synced_at: datetime | None
    evaluations_synced_at: datetime | None
    source_note: str
    penalties: list[AreaPenaltyRecordOut]
    evaluations: list[AreaEvaluationRecordOut]


# ---- 托嬰與園所異動（2026-10-14 規格 §6）----


class AreaBabycareItemOut(BaseModel):
    source_id: str
    name: str
    kind: BabycareKind
    address: str
    lat: float
    lng: float
    distance_m: int
    # 核定人數與實際收托（官方回報，統計時點官方沒有說明）；來源沒給是 null，畫面寫「—」。
    approved_capacity: int | None
    enrolled: int | None
    phone: str | None
    # 2026-10-15：逐所明細的日間托育平均月費與說明、評鑑等級與年度（民國）、準公共資格；沒抓到是 null。
    monthly_fee: int | None = None
    fee_note: str | None = None
    evaluation_grade: str | None = None
    evaluation_year: int | None = None
    quasi_public: bool | None = None


class AreaBabycareSummaryOut(BaseModel):
    """營業中的所數、核定合計、實際收托合計（null 不計入）。只放數量，不算任何比例。
    2026-10-15 起另有月費中位數與範圍（少於 3 所不算中位數）、本校 2 歲班月均、收費學年。"""

    count: int
    approved_total: int
    enrolled_total: int
    fee_count: int = 0
    fee_median: int | None = None
    fee_min: int | None = None
    fee_max: int | None = None
    own_age2_monthly: int | None = None
    fee_school_year: int | None = None


class AreaBabycareOut(BaseModel):
    synced_at: datetime | None
    source_note: str
    campus: AreaCampusOut
    radius_km: int
    summary: AreaBabycareSummaryOut
    items: list[AreaBabycareItemOut]


class AreaFeeItemsOut(BaseModel):
    """一學期的逐項公告收費（元）；課後延托是每月。來源沒寫是 null，畫面寫「—」。"""

    tuition: int | None
    misc_fee: int | None
    materials: int | None
    activities: int | None
    lunch: int | None
    snack: int | None
    after_care_monthly: int | None


class AreaPeerFeeOwnOut(BaseModel):
    source_id: str
    name: str
    semester_total: int
    months: float | None
    monthly_average: int | None
    items: AreaFeeItemsOut
    transport_note: str | None


class AreaPeerFeeGroupOut(BaseModel):
    """一種類型的半徑內家數（不含本機構）、有公布收費的家數、中位數（少於 3 所是 null）、最低、最高；
    私立一般且本校也是私立一般時才有本校排名（第 own_rank 高，共 rank_total 所，含本校）。"""

    kind: KindergartenKind
    schools: int
    with_fee: int
    median: int | None
    lowest: int | None
    highest: int | None
    own_rank: int | None
    rank_total: int | None


FeeItemKey = Literal["tuition", "misc_fee", "materials", "activities", "lunch", "snack", "after_care_monthly"]


class AreaPeerFeeItemOut(BaseModel):
    key: FeeItemKey
    own: int | None
    peer_median: int | None
    peer_count: int


class AreaPeerFeeSchoolOut(BaseModel):
    source_id: str
    name: str
    kind: KindergartenKind
    distance_m: int
    is_own: bool
    semester_total: int | None
    monthly_average: int | None
    items: AreaFeeItemsOut
    transport_note: str | None


class AreaPeerFeesOut(BaseModel):
    """附近同業收費（2026-10-15 規格 §6）。synced_at 是 null＝收費從沒匯入；school_year 是資料學年，
    比 current_school_year 舊時畫面要寫明。own_missing：not_found＝附近找不到本校的教保資訊網資料、
    no_fee＝本校沒有公布這個年齡的收費；本校沒定位時兩者都是 null（原因在 campus.locate_error）。"""

    campus: AreaCampusOut
    radius_km: int
    age: int
    school_year: int | None
    current_school_year: int
    synced_at: datetime | None
    source_note: str
    own: AreaPeerFeeOwnOut | None
    own_missing: Literal["not_found", "no_fee"] | None
    groups: list[AreaPeerFeeGroupOut]
    items: list[AreaPeerFeeItemOut]
    schools: list[AreaPeerFeeSchoolOut]


class AreaTrackingSinceOut(BaseModel):
    """各種名單開始記錄異動的日子（基準日）；還沒記錄過是 null。"""

    kindergarten: DateOnly | None
    babycare: DateOnly | None


class AreaChangeItemOut(BaseModel):
    provider: ProviderName
    source_id: str
    name: str
    kind: ChangeItemKind
    change: ProviderChangeKind
    # registered＝設立日（幼兒園新設）、observed＝我們同步到的那天（來源沒有停辦日）。
    date: DateOnly
    date_basis: ChangeDateBasis
    distance_m: int
    # 只有 kind_changed 才有：舊的與新的幼兒園類型。
    old_kind: KindergartenKind | None
    new_kind: KindergartenKind | None


class AreaChangesOut(BaseModel):
    campus: AreaCampusOut
    radius_km: int
    window_months: int
    tracking_since: AreaTrackingSinceOut
    items: list[AreaChangeItemOut]
