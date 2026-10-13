"""招生區域分析測試共用：tests/fixtures/geo/ 的公開資料樣本、發布校址、建訪視。

樣本取自 2026-10-08 下載的真實公開資料，不含任何個人資料：
- doorplates-sample.csv：高雄市 115 年 10 月門牌坐標（原檔格式，UTF-8 帶 BOM、CRLF），
  義華路 62–72 號、仁武京吉一路 102／106 號、五校校址、旗津三路 900 巷（1 號對到兩個里）、
  仁心路博愛巷（具名巷＋弄）、右昌一巷（「地區」型）、中華一路（北美術館里缺「里」字）、
  憲政路（整條同一里）、府北路 25 號四樓之 3 附 1（附號寫在樓層後）。
- preschools-sample.json：kiang preschools.json 的 13 筆（去掉負責人等欄位），含停業、
  臺南市、座標是字串、準公共、非營利、公立、本機構。
- kcg-search.html、kcg-dataset.html：高雄市資料開放平台搜尋頁與資料集頁的連結片段。
- ris-odrp014-11509-p1.json、-p2.json：內政部戶政司 ODRP014 115 年 9 月的兩頁（2026-10-13 下載），
  義華附近 24 個里＋新北市 2 筆、臺南市 1 筆（要被篩掉）；只留 0–9 歲欄位，其餘欄位與原檔相同，
  totalPage 改成 2。"""

from __future__ import annotations

import json
import re
from datetime import date, datetime, timezone
from pathlib import Path

import httpx

from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.admissions.geo.doorplates import DoorplateParser, DoorplateRow, copy_doorplates
from app.admissions.geo.kindergartens import parse_preschools, replace_kindergartens
from app.admissions.geo import population as population_io
from app.admissions.geo.models import GeoDatasetStatus, GeoDoorplate, GeoKindergarten
from app.admissions.geo.sync import LOCK_KEY
from app.admissions.models import RecruitmentVisit

FIXTURES = Path(__file__).parent / "fixtures" / "geo"
SAMPLE_TAG = "115-10#sample"
SAMPLE_LABEL = "115-10"
SAMPLE_SCHOOL_YEAR = 115
# 義華校址（高雄市三民區義華路68號）在樣本門牌裡的座標。
YIHUA_POINT = (22.6424556, 120.3437133)
SAMPLE_ADDRESSES: dict[str, str] = {
    "yihua_exact": "高雄市三民區義華路68號",  # 本揚里，距義華 0 m
    "yihua_nearby": "高雄市三民區義華路74號",  # 樣本沒有 74 號，最近 72 號，本揚里
    "district_only": "高雄市三民區九如一路1號",  # 樣本沒有這條路
    "outside": "臺南市東區中華東路二段185巷14號",
    "ambiguous": "高雄市旗津區旗津三路900巷1號",  # 中華里、復興里各有一筆
}


def sample_doorplate_rows() -> list[DoorplateRow]:
    parser = DoorplateParser()
    rows: list[DoorplateRow] = []
    with (FIXTURES / "doorplates-sample.csv").open(encoding="utf-8", newline="") as handle:
        for line in handle:
            row = parser.feed(line)
            if row is not None:
                rows.append(row)
    return rows


RIS_SAMPLE_MONTH = "11509"
RIS_SAMPLE_PAGES = (FIXTURES / "ris-odrp014-11509-p1.json", FIXTURES / "ris-odrp014-11509-p2.json")
# 樣本裡高雄市的里數（另有 3 筆外縣市要被篩掉）。
RIS_SAMPLE_VILLAGES = 24
_RIS_URL = re.compile(re.escape(population_io.RIS_BASE) + r"/([0-9]{5})\?page=([0-9]+)")


def ris_sample_pages(month: str = RIS_SAMPLE_MONTH) -> list[dict]:
    """樣本兩頁的 API 回應；month 不是 11509 時把每列的統計月份改成那個月（假裝是那個月的資料）。"""
    pages = []
    for path in RIS_SAMPLE_PAGES:
        data = json.loads(path.read_text(encoding="utf-8"))
        for row in data["responseData"]:
            row["statistic_yyymm"] = month
        pages.append(data)
    return pages


def ris_response(url: str, *, months: set[str] | None = None) -> httpx.Response | None:
    """假的內政部 ODRP014：網址不是它就回 None（由呼叫端處理）。months 給定時只有這些月份有資料，
    其他月份回「查無資料」；沒給就每個月份都有（月份改成網址上的）。"""
    matched = _RIS_URL.fullmatch(url)
    if matched is None:
        return None
    month, page = matched.group(1), int(matched.group(2))
    if months is not None and month not in months:
        return httpx.Response(200, json={"responseCode": population_io.RESPONSE_NO_DATA, "responseMessage": "查無資料"})
    pages = ris_sample_pages(month)
    if not 1 <= page <= len(pages):
        return httpx.Response(200, json={"responseCode": population_io.RESPONSE_NO_DATA, "responseMessage": "查無資料"})
    return httpx.Response(200, json=pages[page - 1])


def sample_preschools() -> dict:
    return json.loads((FIXTURES / "preschools-sample.json").read_text(encoding="utf-8"))


async def load_geo_samples(db: AsyncSession) -> None:
    """清掉三張公開資料表，載入門牌與幼兒園樣本並設為使用中（doorplates、kindergartens
    兩筆狀態都有 synced_at）。可以重複呼叫。會 commit。"""
    await db.execute(delete(GeoDoorplate))
    await db.execute(delete(GeoKindergarten))
    await db.execute(delete(GeoDatasetStatus))
    await copy_doorplates(db, SAMPLE_TAG, sample_doorplate_rows())
    now = datetime.now(timezone.utc)
    db.add(
        GeoDatasetStatus(
            dataset="doorplates", active_version=SAMPLE_TAG, label=SAMPLE_LABEL, synced_at=now, checked_at=now
        )
    )
    await db.flush()
    rows = parse_preschools(sample_preschools(), school_year=SAMPLE_SCHOOL_YEAR)
    await replace_kindergartens(db, rows, synced_at=now)
    await db.commit()


async def publish_campus_address(db: AsyncSession, campus_key: str, address: str) -> None:
    """發布一版只有必填欄位的校區資料，讓 campus_point 讀得到校址。會 commit。"""
    from app.content import service as content_service

    payload = {
        "name": f"{campus_key} 測試校", "district": "", "address": address, "phone": "07-0000000",
        "intro": "", "description": "", "facebook": "", "fb_note": "", "line": "",
    }
    item = await content_service.get_or_create_content_item(db, "campus_profile", campus_key)
    revision = await content_service.create_revision(db, item, payload, item.latest_version, None)
    await content_service.publish_revision(db, item, revision, None)
    await db.commit()


async def add_visit(
    db: AsyncSession, *, address: str | None, campus_key: str = "yihua", anonymized: bool = False
) -> RecruitmentVisit:
    """直接寫一筆最小的招生訪視（不走 API、不比對）。會 flush、不 commit。"""
    now = datetime.now(timezone.utc)
    visit = RecruitmentVisit(
        campus_key=campus_key,
        month="115.09",
        visit_date=date(2026, 9, 8),
        child_name="區域測試",
        address=address,
        created_at=now,
        updated_at=now,
        anonymized_at=now if anonymized else None,
    )
    db.add(visit)
    await db.flush()
    return visit


async def lock_is_free(app) -> bool:
    """公開資料同步的 advisory lock 現在有沒有被任何連線握著：用全新連線（NullPool，不受同連線可重入、
    連線池影響）去拿，拿到就馬上關掉那條連線。"""
    fresh = create_async_engine(app.state.engine.url, poolclass=NullPool)
    try:
        async with fresh.connect() as other:
            other = await other.execution_options(isolation_level="AUTOCOMMIT")
            got = await other.scalar(text("SELECT pg_try_advisory_lock(hashtext(:key))"), {"key": LOCK_KEY})
            await other.invalidate()  # 關掉這條連線，鎖隨連線釋放
            return bool(got)
    finally:
        await fresh.dispose()
