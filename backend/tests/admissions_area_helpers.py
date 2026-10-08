"""區域分析測試的直接寫入工具（2026-10-08 區域分析規格）：訪視與比對結果直接寫資料庫，
不經 API、不靠門牌樣本，才能精確控制每一層的筆數。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.academic import roc_month
from app.admissions.constants import ANONYMIZED_TEXT
from app.admissions.geo.models import RecruitmentVisitGeo
from app.admissions.models import RecruitmentVisit

API = "/api/website/v1"
AREA = f"{API}/admin/admissions/area"
NOW = datetime(2026, 10, 8, 4, 0, tzinfo=timezone.utc)
ADDRESS = "高雄市三民區測試路1號"


async def add_visit(
    db: AsyncSession,
    *,
    campus_key: str = "yihua",
    address: str | None = ADDRESS,
    district: str | None = None,
    has_deposit: bool = False,
    anonymized: bool = False,
    target_school_year: int = 115,
    target_semester: int = 1,
    visit_date: date = date(2026, 9, 1),
    geo: dict | None = None,
) -> RecruitmentVisit:
    """直接寫一筆訪視；geo 給 {"level", "village", "reason", "distance_m"} 時另寫一列比對結果。
    anonymized=True 時地址一律是 None（同保存政策清過的樣子）。"""
    visit = RecruitmentVisit(
        id=uuid.uuid4(),
        campus_key=campus_key,
        month=roc_month(visit_date),
        seq_no=None,
        visit_date=visit_date,
        child_name=ANONYMIZED_TEXT if anonymized else "測試幼生",
        address=None if anonymized else address,
        district=district,
        has_deposit=has_deposit,
        rides_bus=False,
        enrolled=False,
        transfer_term=False,
        target_school_year=target_school_year,
        target_semester=target_semester,
        anonymized_at=NOW if anonymized else None,
        version=1,
        created_at=NOW,
        updated_at=NOW,
    )
    db.add(visit)
    await db.flush()
    if geo is not None:
        db.add(
            RecruitmentVisitGeo(
                visit_id=visit.id,
                village=geo.get("village"),
                match_level=geo["level"],
                unlocated_reason=geo.get("reason"),
                distance_m=geo.get("distance_m"),
                doorplate_version="115-10",
                matched_at=NOW,
            )
        )
        await db.flush()
    return visit


async def seed_area(db: AsyncSession) -> dict[str, RecruitmentVisit]:
    """義華 115 學年上學期 11 筆（V1–V11）＋不該算進來的 2 筆（X1 明華、X2 114 學年）。

    | 代號 | 預繳 | 行政區 | 比對結果 | 層級 |
    |---|---|---|---|---|
    | V1 | 是 | 三民區 | exact 鼎金里 800 m | village |
    | V2 | 否 | 三民區 | nearby 鼎金里 1200 m | village |
    | V3 | 是 | 三民區 | street 寶業里 | village |
    | V4 | 否 | 左營區 | district（只到區） | district |
    | V5 | 否 | 三民區 | district／ambiguous_village | district |
    | V6 | 否 | — | unlocated／no_address（沒地址） | unlocated |
    | V7 | 否 | — | unlocated／outside_kaohsiung | unlocated |
    | V8 | 否 | — | pending | pending |
    | V9 | 否 | — | 沒有比對結果、有地址（上線前的舊訪視） | pending |
    | V10 | 否 | 三民區 | 已匿名化、沒有比對結果 | district／anonymized |
    | V11 | 否 | — | 已匿名化、unlocated／anonymized | unlocated／anonymized |
    """
    visits = {
        "V1": await add_visit(db, district="三民區", has_deposit=True,
                              geo={"level": "exact", "village": "鼎金里", "distance_m": 800}),
        "V2": await add_visit(db, district="三民區", geo={"level": "nearby", "village": "鼎金里", "distance_m": 1200}),
        "V3": await add_visit(db, district="三民區", has_deposit=True, geo={"level": "street", "village": "寶業里"}),
        "V4": await add_visit(db, district="左營區", geo={"level": "district"}),
        "V5": await add_visit(db, district="三民區", geo={"level": "district", "reason": "ambiguous_village"}),
        "V6": await add_visit(db, address=None, geo={"level": "unlocated", "reason": "no_address"}),
        "V7": await add_visit(db, address="臺北市大安區測試路1號", geo={"level": "unlocated", "reason": "outside_kaohsiung"}),
        "V8": await add_visit(db, geo={"level": "pending"}),
        "V9": await add_visit(db),
        "V10": await add_visit(db, district="三民區", anonymized=True),
        "V11": await add_visit(db, anonymized=True, geo={"level": "unlocated", "reason": "anonymized"}),
        "X1": await add_visit(db, campus_key="minghua", district="左營區",
                              geo={"level": "exact", "village": "明建里", "distance_m": 300}),
        "X2": await add_visit(db, target_school_year=114, district="三民區",
                              geo={"level": "exact", "village": "鼎金里", "distance_m": 300}),
    }
    return visits
