"""招生區域分析的公開地理資料與訪視比對結果（docs/specs/2026-10-08-admissions-area-design.md 第 5 節；
各里人口見 docs/specs/2026-10-13-admissions-opportunity-design.md 第 3 節；各里出生、遷入遷出、
年齡的月份歷史見 docs/specs/2026-10-14-admissions-village-trends-design.md 第 3.1 節，各里所得見同一份第 3.3 節）。

這些表都是官網專用，不進園務轉移契約。geo_doorplates／geo_kindergartens／
geo_village_population／geo_village_births／geo_village_migration／geo_village_ages／
geo_village_income／geo_dataset_status 是公開資料、與校區無關；recruitment_visit_geo 一筆訪視一列，不存家長座標。
列舉用 String＋CheckConstraint，條件字串與建立（或最後改寫）該約束的 migration 逐字相同：
geo_dataset_status 的 dataset 是 d8b3f6a2c914，其餘是 e7a1c4d9b2f6（tests/test_geo_schema.py 檢查）。

這個模組不 import app.admissions.models：admissions/models.py 檔尾會 import 這裡，
再從 RecruitmentVisit 那邊建立 geo relationship（階段 B）；反過來 import 會循環。
所以 RecruitmentVisitGeo 只有指向 recruitment_visits.id 的外鍵，沒有 relationship。"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Identity,
    Index,
    Integer,
    String,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

MATCH_LEVELS = ("exact", "nearby", "street", "district", "unlocated", "pending")
UNLOCATED_REASONS = ("no_address", "outside_kaohsiung", "no_doorplate", "ambiguous_village", "anonymized")
# 有里的比對等級；exact、nearby 另有座標（算得出距離）。
VILLAGE_LEVELS = ("exact", "nearby", "street")
KINDERGARTEN_KINDS = ("public", "nonprofit", "quasi_public", "private")
STREET_KINDS = ("road", "area")
# population：各里人口（2026-10-13 招生機會），migration f3c8a2d47b19 加進約束。
# births、migration：各里出生、遷入遷出的月份歷史（2026-10-14 里的變化），migration c5e9a1f3b7d2 加進約束。
# income：各里綜合所得（2026-10-14 里的變化 C 段），migration d8b3f6a2c914 加進約束。
DATASETS = ("doorplates", "kindergartens", "campuses", "population", "births", "migration", "income")


def _in(column: str, values: tuple[str, ...], *, nullable: bool = False) -> str:
    listed = ", ".join(f"'{value}'" for value in values)
    condition = f"{column} IN ({listed})"
    return f"{column} IS NULL OR {condition}" if nullable else condition


class GeoDoorplate(Base):
    """高雄市門牌（去樓層）。dataset_version 是匯入批次標記（「115-10#a1b2c3」）：同一個
    月份重匯也不會和使用中的批次混在一起，切換完成才刪舊批次。巷、弄沒有時存空字串，
    查詢一律用等號比對；具名巷（「博愛巷」）存「博愛」。"""

    __tablename__ = "geo_doorplates"
    __table_args__ = (
        CheckConstraint(_in("street_kind", STREET_KINDS), name="ck_geo_doorplates_street_kind"),
        Index(
            "ix_geo_doorplates_lookup",
            "dataset_version", "town_code", "street", "lane", "alley", "number", "number_sub",
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    dataset_version: Mapped[str] = mapped_column(String(16), nullable=False)
    town_code: Mapped[str] = mapped_column(String(8), nullable=False)
    district: Mapped[str] = mapped_column(String(8), nullable=False)
    village: Mapped[str] = mapped_column(String(16), nullable=False)
    street: Mapped[str] = mapped_column(String(40), nullable=False)
    street_kind: Mapped[str] = mapped_column(String(8), nullable=False)
    lane: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    alley: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    number: Mapped[int] = mapped_column(Integer, nullable=False)
    number_sub: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)


class GeoKindergarten(Base):
    """高雄市營業中的幼兒園（kiang 整理的全國教保資訊網資料）。不存負責人姓名。"""

    __tablename__ = "geo_kindergartens"
    __table_args__ = (
        CheckConstraint(_in("kind", KINDERGARTEN_KINDS), name="ck_geo_kindergartens_kind"),
        Index("ix_geo_kindergartens_lat_lng", "lat", "lng"),
    )

    source_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    reg_no: Mapped[str | None] = mapped_column(String(80), nullable=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    pre_public_period: Mapped[str | None] = mapped_column(String(16), nullable=True)
    district: Mapped[str] = mapped_column(String(8), nullable=False)
    address: Mapped[str] = mapped_column(String(200), nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    approved_capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    monthly_fee_estimate: Mapped[int | None] = mapped_column(Integer, nullable=True)
    has_penalty: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class GeoDatasetStatus(Base):
    """一種資料一列。
    - doorplates：active_version＝使用中的匯入批次標記（查詢用），label＝畫面上的「115-10」；
    - kindergartens：active_version、label 都是同步日期；
    - campuses：active_version＝「各校已發布校址＋使用中門牌批次」的指紋，變了就重算訪視
      （同步工作內部用，畫面不讀）；
    - population：active_version、label 都是人口統計月份「115-09」；一年前的年齡回補失敗也寫在這裡；
    - births、migration：active_version、label 都是歷史表裡最新的月份「115-09」；
    - income：active_version、label 都是所得年度（民國）「112」。
    last_error 是最近一次失敗的原因，不含任何地址；成功或確認來源沒變時清掉。"""

    __tablename__ = "geo_dataset_status"
    __table_args__ = (CheckConstraint(_in("dataset", DATASETS), name="ck_geo_dataset_status_dataset"),)

    dataset: Mapped[str] = mapped_column(String(20), primary_key=True)
    active_version: Mapped[str | None] = mapped_column(String(64), nullable=True)
    label: Mapped[str | None] = mapped_column(String(16), nullable=True)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    checked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(300), nullable=True)


class GeoVillagePopulation(Base):
    """高雄市各里的學齡前人口（內政部戶政司 ODRP014，2026-10-13 招生機會規格 §3）。只存使用中的
    一個月份，換月時同一個交易刪光再寫入；月份記在 geo_dataset_status 的 population。各歲人數是
    男女相加、統計月底的足歲；只存 0–6 歲（幼兒園年齡加前後一歲）與全里人口。"""

    __tablename__ = "geo_village_population"

    village_code: Mapped[str] = mapped_column(String(11), primary_key=True)
    district: Mapped[str] = mapped_column(String(8), nullable=False)
    village: Mapped[str] = mapped_column(String(16), nullable=False)
    age_0: Mapped[int] = mapped_column(Integer, nullable=False)
    age_1: Mapped[int] = mapped_column(Integer, nullable=False)
    age_2: Mapped[int] = mapped_column(Integer, nullable=False)
    age_3: Mapped[int] = mapped_column(Integer, nullable=False)
    age_4: Mapped[int] = mapped_column(Integer, nullable=False)
    age_5: Mapped[int] = mapped_column(Integer, nullable=False)
    age_6: Mapped[int] = mapped_column(Integer, nullable=False)
    people_total: Mapped[int] = mapped_column(Integer, nullable=False)


class _VillageMonth:
    """月份歷史表共用的欄位（2026-10-14 里的變化規格 §3.1）：主鍵（月份「115-09」、里代碼）。存所有
    64000 開頭的代碼，包括已不在里界檔裡的舊代碼（里界調整合併時要用）；名稱照來源存。"""

    month: Mapped[str] = mapped_column(String(6), primary_key=True)
    village_code: Mapped[str] = mapped_column(String(11), primary_key=True)
    district: Mapped[str] = mapped_column(String(8), nullable=False)
    village: Mapped[str] = mapped_column(String(16), nullable=False)


class GeoVillageBirths(_VillageMonth, Base):
    """各里每月出生數（內政部戶政司 ODRP010，依出生登記的戶籍里）。來源查無資料的月份整個月沒有列。"""

    __tablename__ = "geo_village_births"

    births: Mapped[int] = mapped_column(Integer, nullable=False)


class GeoVillageMigration(_VillageMonth, Base):
    """各里每月遷入遷出（內政部戶政司 ODRP011），都是男＋女：moved_in／moved_out＝跨區遷入、遷出合計
    （他區、他縣市、國外、初設、廢止），address_in／address_out＝住址變更（同區換址），
    boundary_in／boundary_out＝行政區域調整。"""

    __tablename__ = "geo_village_migration"

    moved_in: Mapped[int] = mapped_column(Integer, nullable=False)
    moved_out: Mapped[int] = mapped_column(Integer, nullable=False)
    address_in: Mapped[int] = mapped_column(Integer, nullable=False)
    address_out: Mapped[int] = mapped_column(Integer, nullable=False)
    boundary_in: Mapped[int] = mapped_column(Integer, nullable=False)
    boundary_out: Mapped[int] = mapped_column(Integer, nullable=False)


class GeoVillageAges(_VillageMonth, Base):
    """各里每月 0–6 歲人數與全里人口（內政部戶政司 ODRP014）。使用中的月份另在 geo_village_population；
    這裡存月份歷史，給「這一年淨增」比一年前的同一批孩子。"""

    __tablename__ = "geo_village_ages"

    age_0: Mapped[int] = mapped_column(Integer, nullable=False)
    age_1: Mapped[int] = mapped_column(Integer, nullable=False)
    age_2: Mapped[int] = mapped_column(Integer, nullable=False)
    age_3: Mapped[int] = mapped_column(Integer, nullable=False)
    age_4: Mapped[int] = mapped_column(Integer, nullable=False)
    age_5: Mapped[int] = mapped_column(Integer, nullable=False)
    age_6: Mapped[int] = mapped_column(Integer, nullable=False)
    people_total: Mapped[int] = mapped_column(Integer, nullable=False)


class GeoVillageIncome(Base):
    """各里綜合所得（財政部財政資訊中心，2026-10-14 里的變化規格 §3.3）。只存最新一個年度、只存對得到
    里界的里；金額單位千元（中位數、第一／第三分位數、平均數），taxpayers 是納稅單位（申報戶，不是戶籍戶）。
    只當背景（規格 V9）：不著色、不分級、不排序。"""

    __tablename__ = "geo_village_income"

    village_code: Mapped[str] = mapped_column(String(11), primary_key=True)
    district: Mapped[str] = mapped_column(String(8), nullable=False)
    village: Mapped[str] = mapped_column(String(16), nullable=False)
    year: Mapped[int] = mapped_column(Integer, nullable=False)
    taxpayers: Mapped[int] = mapped_column(Integer, nullable=False)
    median: Mapped[int] = mapped_column(Integer, nullable=False)
    q1: Mapped[int] = mapped_column(Integer, nullable=False)
    q3: Mapped[int] = mapped_column(Integer, nullable=False)
    mean: Mapped[int] = mapped_column(Integer, nullable=False)


class RecruitmentVisitGeo(Base):
    """訪視地址的比對結果（規格 §5.4）。行政區寫回 recruitment_visits.district，這裡放里、
    比對等級、未定位原因、到本校的直線距離（取整到 100 m）、比對當時的門牌月份。"""

    __tablename__ = "recruitment_visit_geo"
    __table_args__ = (
        CheckConstraint(_in("match_level", MATCH_LEVELS), name="ck_recruitment_visit_geo_match_level"),
        CheckConstraint(
            _in("unlocated_reason", UNLOCATED_REASONS, nullable=True), name="ck_recruitment_visit_geo_reason"
        ),
    )

    visit_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("recruitment_visits.id", ondelete="CASCADE"), primary_key=True
    )
    village: Mapped[str | None] = mapped_column(String(16), nullable=True)
    match_level: Mapped[str] = mapped_column(String(16), nullable=False)
    unlocated_reason: Mapped[str | None] = mapped_column(String(24), nullable=True)
    distance_m: Mapped[int | None] = mapped_column(Integer, nullable=True)
    doorplate_version: Mapped[str | None] = mapped_column(String(16), nullable=True)
    matched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
