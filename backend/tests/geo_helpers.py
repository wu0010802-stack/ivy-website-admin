"""招生區域分析測試共用：tests/fixtures/geo/ 的公開資料樣本、發布校址、建訪視。

樣本取自 2026-10-08 下載的真實公開資料，不含任何個人資料：
- doorplates-sample.csv：高雄市 115 年 10 月門牌坐標（原檔格式，UTF-8 帶 BOM、CRLF），
  義華路 62–72 號、仁武京吉一路 102／106 號、五校校址、旗津三路 900 巷（1 號對到兩個里）、
  仁心路博愛巷（具名巷＋弄）、右昌一巷（「地區」型）、中華一路（北美術館里缺「里」字）、
  憲政路（整條同一里）、府北路 25 號四樓之 3 附 1（附號寫在樓層後）。
- preschools-sample.json：kiang preschools.json 的 13 筆（去掉負責人等欄位），含停業、
  臺南市、座標是字串、準公共、非營利、公立、本機構。
- babycare-sample.json：kiang babycare.json 的 9 筆（2026-10-14 下載），高雄營業中 6 筆（離義華 165／435／
  939／1297／1657／8307 公尺，含一筆托育家園、一筆地址有重複「高雄市…區…里」前綴）、高雄停業 2 筆、新北市 1 筆。
- kcg-search.html、kcg-dataset.html：高雄市資料開放平台搜尋頁與資料集頁的連結片段。
- ris-odrp014-11509-p1.json、-p2.json：內政部戶政司 ODRP014 115 年 9 月的兩頁（2026-10-13 下載），
  義華附近 24 個里＋新北市 2 筆、臺南市 1 筆（要被篩掉）；只留 0–9 歲欄位，其餘欄位與原檔相同，
  totalPage 改成 2。
- ris-odrp061-11509.json、ris-odrp011-11509.json：ODRP061（出生，2026-10-14 起取代 ODRP010）、ODRP011（遷入遷出）
  115 年 9 月同樣那 24 個里（ODRP011 與 ODRP061 的底稿 ODRP010 都是 2026-10-14 下載，帶 COUNTY=高雄市）＋新北市 2 筆（同日不帶 COUNTY 下載的第一頁），
  欄位與原檔相同、一頁。ODRP061 樣本是把 ODRP010 的下載檔手動多加了 household_no、neighbor_no2、people_total、
  twinborn_child_m／f、birth_legal_m／f 七個欄位，不是真實的 ODRP061 下載（程式只用 birth_total，其餘解析時丟掉）。
- fia-112_165-E-sample.csv：財政資訊中心 112 年度各里所得（2026-10-14 下載）同樣那 24 個里，加三民區「其他」「合計」、
  「高雄市其他」兩列、115-07 已廢止的鹽埕區慈愛里（對不到里界）；原檔格式（引號裡的 BOM、欄名「縣市別」、CRLF）。
- plvr-115S3_e_lvr_land_a-sample.csv：實價登錄 115S3 高雄市買賣檔（2026-10-14 下載）原檔格式（BOM、兩列表頭、CRLF）：
  7 筆真實列（預售屋交屋、完工剛好 12 個月前、完工太久、只有土地、商業用、沒有完工日、只有車位），另 6 筆是拿真實列
  改成門牌樣本裡的門牌（編號 SAMPLE 開頭）：義華路 68 號（exact）、68 號之１三樓（之號接中文樓層）、80 號（nearby）、
  憲政路 999 號（street）、「義華路６６號等１８５戶共用部分」（沒有市、區）、完工在登記期間之後的月份。"""

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
from app.admissions.geo.babycare import parse_babycare
from app.admissions.geo.kindergartens import parse_preschools
from app.admissions.geo import population as population_io
from app.admissions.geo import village_series as series_io
from app.admissions.geo.models import GeoBabycare, GeoDatasetStatus, GeoDoorplate, GeoKindergarten, GeoProviderEvent
from app.admissions.geo.providers import apply_babycare, apply_kindergartens
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
_RIS_PATH = re.compile(re.escape(series_io.RIS_ROOT) + r"/(ODRP(?:01[14]|061))/([0-9]{5})")
RIS_SERIES_FIXTURES = {"ODRP061": FIXTURES / "ris-odrp061-11509.json", "ODRP011": FIXTURES / "ris-odrp011-11509.json"}


def ris_sample_pages(month: str = RIS_SAMPLE_MONTH) -> list[dict]:
    """樣本兩頁的 API 回應；month 不是 11509 時把每列的統計月份改成那個月（假裝是那個月的資料）。"""
    pages = []
    for path in RIS_SAMPLE_PAGES:
        data = json.loads(path.read_text(encoding="utf-8"))
        for row in data["responseData"]:
            row["statistic_yyymm"] = month
        pages.append(data)
    return pages


def ris_series_page(code: str, month: str = RIS_SAMPLE_MONTH) -> dict:
    """ODRP061／ODRP011 樣本（一頁）；month 不是 11509 時把每列的統計月份改成那個月。"""
    data = json.loads(RIS_SERIES_FIXTURES[code].read_text(encoding="utf-8"))
    for row in data["responseData"]:
        row["statistic_yyymm"] = month
    return data


def ris_response(
    url: str, *, months: set[str] | None = None, series_months: set[str] | None = None
) -> httpx.Response | None:
    """假的內政部 ODRP014（各里人口）、ODRP061（出生）、ODRP011（遷入遷出）：網址不是它們就回 None（由呼叫端
    處理）。months 給定時 ODRP014 只有這些月份有資料、series_months 給定時 ODRP061／011 只有這些月份有資料，
    其他月份回「查無資料」；沒給就每個月份都有（月份改成網址上的）。"""
    parsed = httpx.URL(url)
    matched = _RIS_PATH.fullmatch(f"{parsed.scheme}://{parsed.host}{parsed.path}")
    if matched is None:
        return None
    # 同步一律帶 COUNTY=高雄市；沒帶就是程式寫錯（會抓到全國資料），回 400 讓測試看得到。
    if parsed.params.get("COUNTY") != population_io.KAOHSIUNG_NAME:
        return httpx.Response(400)
    code, month, page = matched.group(1), matched.group(2), int(parsed.params.get("page", "0"))
    no_data = {"responseCode": population_io.RESPONSE_NO_DATA, "responseMessage": "查無資料"}
    if code in RIS_SERIES_FIXTURES:
        if (series_months is not None and month not in series_months) or page != 1:
            return httpx.Response(200, json=no_data)
        return httpx.Response(200, json=ris_series_page(code, month))
    if months is not None and month not in months:
        return httpx.Response(200, json=no_data)
    pages = ris_sample_pages(month)
    if not 1 <= page <= len(pages):
        return httpx.Response(200, json={"responseCode": population_io.RESPONSE_NO_DATA, "responseMessage": "查無資料"})
    return httpx.Response(200, json=pages[page - 1])


INCOME_SAMPLE = FIXTURES / "fia-112_165-E-sample.csv"
# 樣本裡對得到里界的里數（慈愛里對不到、「其他」「合計」不是里）。
INCOME_SAMPLE_VILLAGES = 24


def datagov_income_listing(years: list[int]) -> dict:
    """data.gov.tw 資料集 17971 的回應（只留用得到的欄位）：每個年度一個財政資訊中心的高雄市檔。"""
    return {
        "success": True,
        "result": {
            "datasetId": "17971",
            "distribution": [
                {"resourceDescription": f"{year}年度綜稅綜合所得總額各縣市鄉鎮村里統計分析表-高雄市",
                 "resourceDownloadUrl": f"https://www.fia.gov.tw/WEB/fia/ias/ias{year}/{year}_165-E.csv",
                 "resourceFormat": "CSV"}
                for year in years
            ],
        },
    }


NEW_HOMES_SAMPLE = FIXTURES / "plvr-115S3_e_lvr_land_a-sample.csv"
NEW_HOMES_SAMPLE_SEASON = "115S3"
# 樣本裡符合新成屋（V7）的筆數。
NEW_HOMES_SAMPLE_ROWS = 7
PLVR_ERROR_PAGE = '<table class="border"><tr><td class="text_bg">系統訊息</td></tr></table>'


def plvr_sample(season: str = NEW_HOMES_SAMPLE_SEASON, *, serial_prefix: bool = True) -> bytes:
    """新成屋樣本假裝成另一季：建築完成年月整批平移（和 115S3 差幾季就移幾個 3 個月），符合 V7 的列不變；
    serial_prefix 時編號前面加季別（各季的編號不重複，同真實資料）。"""
    import csv as csv_module
    import io as io_module

    shift = (int(season[:3]) * 4 + int(season[-1])) - (int(NEW_HOMES_SAMPLE_SEASON[:3]) * 4 + int(NEW_HOMES_SAMPLE_SEASON[-1]))
    text = NEW_HOMES_SAMPLE.read_bytes().decode("utf-8").lstrip("\ufeff")
    rows = list(csv_module.reader(io_module.StringIO(text)))
    header = rows[0]
    completed, serial = header.index("建築完成年月"), header.index("編號")
    for row in rows[2:]:
        value = row[completed]
        if len(value) == 7 and value.isdigit() and shift:
            index = int(value[:3]) * 12 + int(value[3:5]) - 1 + shift * 3
            row[completed] = f"{index // 12:03d}{index % 12 + 1:02d}{value[5:]}"
        if serial_prefix and season != NEW_HOMES_SAMPLE_SEASON:
            row[serial] = f"{season}{row[serial]}"[:40]
    buffer = io_module.StringIO()
    csv_module.writer(buffer, lineterminator="\r\n").writerows(rows)
    return ("\ufeff" + buffer.getvalue()).encode("utf-8")


def plvr_response(url: str, *, seasons: set[str] | None = None) -> httpx.Response | None:
    """假的實價登錄季檔下載：網址不是它就回 None。seasons 給定時只有這些季有檔，其他季和真的一樣回 HTTP 200 的
    錯誤頁；沒給就每一季都有。"""
    parsed = httpx.URL(url)
    if f"{parsed.scheme}://{parsed.host}{parsed.path}" != "https://plvr.land.moi.gov.tw/DownloadSeason":
        return None
    season = parsed.params.get("season", "")
    if parsed.params.get("fileName") != "e_lvr_land_a.csv" or (seasons is not None and season not in seasons):
        return httpx.Response(200, text=PLVR_ERROR_PAGE, headers={"content-type": "text/html"})
    return httpx.Response(200, content=plvr_sample(season), headers={"content-type": "application/octet-stream"})


def income_response(url: str, *, years: tuple[int, ...] = (112,)) -> httpx.Response | None:
    """假的 data.gov.tw 資料集 17971 與財政資訊中心：網址不是它們就回 None。資料集列出 years，那些年度的檔是
    樣本，其他年度 404（同真的）。"""
    from app.admissions.geo import income as income_io

    if url == income_io.DATASET_API:
        return httpx.Response(200, json=datagov_income_listing(list(years)))
    year = income_io.year_of_url(url)
    if year is None:
        return None
    if year in years:
        return httpx.Response(200, content=INCOME_SAMPLE.read_bytes(), headers={"content-type": "text/csv"})
    return httpx.Response(404, text="error page!", headers={"content-type": "text/html"})


def sample_preschools() -> dict:
    return json.loads((FIXTURES / "preschools-sample.json").read_text(encoding="utf-8"))


def sample_babycare() -> dict:
    return json.loads((FIXTURES / "babycare-sample.json").read_text(encoding="utf-8"))


async def load_geo_samples(db: AsyncSession) -> None:
    """清掉三張公開資料表，載入門牌與幼兒園樣本並設為使用中（doorplates、kindergartens
    兩筆狀態都有 synced_at）。可以重複呼叫。會 commit。"""
    await db.execute(delete(GeoDoorplate))
    await db.execute(delete(GeoProviderEvent))
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
    await apply_kindergartens(db, rows, synced_at=now, school_year=SAMPLE_SCHOOL_YEAR)
    await db.commit()


async def load_babycare_sample(db: AsyncSession, *, now: datetime | None = None) -> None:
    """清掉托嬰名單與異動紀錄，載入托嬰樣本（高雄營業中 6 所）並設為使用中。可以重複呼叫。會 commit。
    不動幼兒園與其他狀態列（load_geo_samples 的狀態列斷言只認 doorplates、kindergartens 兩筆）。"""
    await db.execute(delete(GeoProviderEvent).where(GeoProviderEvent.provider == "babycare"))
    await db.execute(delete(GeoBabycare))
    await db.execute(delete(GeoDatasetStatus).where(GeoDatasetStatus.dataset == "babycare"))
    await apply_babycare(db, parse_babycare(sample_babycare()), synced_at=now or datetime.now(timezone.utc))
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
