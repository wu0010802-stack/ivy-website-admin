"""預售建案（內政部實價登錄「預售屋建案備查」，高雄市單檔 e_lvr_buildcase.csv；
docs/specs/2026-10-20-admissions-presale-design.md §2、§3、§5）。

這裡只管解析、狀態與預計交屋、定位與重比、寫入；下載、排程與換版門檻在 sync.py，地號座標表的匯入與本機查詢在 presale_parcels.py。

來源檔（2026-10-20 實測）：
- UTF-8 帶 BOM、CRLF、兩列表頭（中、英）、15 欄：鄉鎮市區、建案名稱、坐落街道、起造人、層棟戶數、使用分區、主要用途、主要建材、
  申報備查日期、銷售期間、坐落基地、建照核發日期、建造執照、第1次登記日期、編號。每月 1 日重產，自 110-07-01 起累計，沒有歷史快照。
- 「銷售期間」是未加引號的自由文字，含換行與逗號：以「<高雄行政區名>,」開頭判斷新記錄、續行併入；左邊取前 4 欄、右邊取後 5 欄，
  中間依序是層棟戶數（純整數）、使用分區、主要用途、主要建材、申報備查日期，其餘全算銷售期間。
- 層棟戶數是該備查案總戶數（以銷售期間文字與預售成交筆數兩種方式驗證，非官方定義）；日期是 7 碼民國 yyyMMdd，空值或格式錯當空。
- 起造人欄含「負責人:姓名」，也有自然人：**整欄不讀**，不進任何資料結構，測試 fixture 也一律用假公司名。

狀態（P3）：非住宅（主要用途不含「住」）不進任何統計；住宅有第 1 次登記日＝已登記；沒有登記、建照日在今天往回 6 年內＝在建；
其餘（建照超過 6 年或沒有建照日）＝不明，不進在建統計。預計交屋（P4，粗估）：建照日加依戶數的月數。

定位（P5）：①坐落基地第一筆地號在地號座標表有座標 → 點入里界（parcel）；②坐落街道比對門牌（多條路各自比對，全到里且同一個里才算該里，
否則取第一條路）；③只到區。坐落街道本身是「段＋地號」格式的直接跳到③（除非①命中）。"""

from __future__ import annotations

import csv
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime

from sqlalchemy import delete, func, select, tuple_, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.admissions.geo import boundaries, matcher
from app.admissions.geo.kaohsiung import DISTRICTS
from app.admissions.geo.models import (
    PRESALE_VILLAGE_LEVELS,
    GeoDatasetStatus,
    GeoParcelPoint,
    GeoPresaleBuildcase,
)

SOURCE_URL = "https://plvr.land.moi.gov.tw/Download?PayType=saleremark&fileName=e_lvr_buildcase.csv"
# 單檔上限（正常約 180 KB）。
MAX_BYTES = 2 * 1024 * 1024
SOURCE_NOTE = "內政部實價登錄 預售屋建案備查；地號位置：國土測繪中心"
# 換版門檻（P8）：表裡已有至少這麼多案時，新檔解析出的高雄筆數少於表內的這個比例就不換。
SHRINK_MIN_EXISTING = 100
SHRINK_RATIO = 0.8
# 解析失敗的壞行超過這個比例，整個檔不收（本機實測 661 筆 0 失敗）。
MAX_FAILED_SHARE = 0.05
# 狀態（P3）：在建＝住宅、沒登記、建照日在往回幾年內。
BUILDING_YEARS = 6
# 欄位位置與名稱（表頭檢查用）。
_HEADER_AT = {
    0: "鄉鎮市區", 1: "建案名稱", 2: "坐落街道", 3: "起造人", 4: "層棟戶數", 6: "主要用途", 8: "申報備查日期",
    10: "坐落基地", 11: "建照核發日期", 13: "第1次登記日期",
}
_LEFT, _RIGHT = 4, 5  # 左邊 4 欄、右邊 5 欄固定；中間第 1 個是層棟戶數。
_COLUMNS = 15
_NEW_RECORD = re.compile("^(?:" + "|".join(sorted(map(re.escape, DISTRICTS), key=len, reverse=True)) + "),")
_ROC_DATE = re.compile(r"([0-9]{3})([0-9]{2})([0-9]{2})")
_PARCEL = re.compile(r"^(?P<section>[^0-9]+?)(?P<main>[0-9]+)(?:[-之](?P<sub>[0-9]+))?")
# 坐落街道本身是「段＋地號」格式：含「地號」、「等N筆」，或開頭是（不含路街巷弄的）段名接數字。
_PARCEL_STREET = re.compile(r"地號|等[0-9]+筆|^[^0-9路街巷弄]+?段[0-9]")
# 多條路的連接字（「與／及／和／、」加逗號、斜線、v.s）：前一個字要是路名或號的結尾才拆，免得切壞「和平路」「和隆街」。
_CONNECTOR = re.compile(r"[與及和、，,／/~～]|[vV][.．]?[sS][.．]?")
_BEFORE_CONNECTOR = "路街道巷弄段號口旁邊側0123456789"
_ROAD_MARK = re.compile(r"[路街道巷弄]")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


class PresaleFormatError(ValueError):
    """預售建案檔的格式或內容不對；訊息會寫進 geo_dataset_status.last_error，不含檔案內容。"""


@dataclass(frozen=True)
class PresaleRow:
    district: str
    name: str
    street: str
    households: int
    main_use: str
    residential: bool
    declared_on: date | None
    permit_on: date | None
    first_registered_on: date | None
    parcel_section: str | None
    parcel_no: str | None

    @property
    def key(self) -> tuple[str, str]:
        return (self.district, self.name)


@dataclass
class PresaleBatch:
    """一次解析的結果。total 是記錄數（續行已併入），failed 是解析不出來的壞行，skipped 是不是高雄行政區的列。"""

    rows: list[PresaleRow] = field(default_factory=list)
    total: int = 0
    failed: int = 0
    skipped: int = 0


@dataclass(frozen=True)
class PresaleMatch:
    match_level: str
    village_code: str | None = None
    village: str | None = None
    lat: float | None = None
    lon: float | None = None


# ---- 解析 ----


def decode(body: bytes) -> str | None:
    """下載或檔案的位元組 → 文字；不是預售建案檔（錯誤頁、HTML）回 None。"""
    try:
        text = body.decode("utf-8")
    except UnicodeDecodeError:
        return None
    return text if text.lstrip("\ufeff").startswith("鄉鎮市區") else None


def roc_date(text: str) -> date | None:
    """7 碼民國日期「1090813」→ 2020-08-13；空白、格式錯（「113311」）、日期不存在回 None。"""
    matched = _ROC_DATE.fullmatch(text.strip())
    if matched is None:
        return None
    try:
        return date(int(matched.group(1)) + 1911, int(matched.group(2)), int(matched.group(3)))
    except ValueError:
        return None


def first_parcel(lands: str | None, district: str | None = None) -> tuple[str, str] | None:
    """坐落基地 → 第一筆地號 (段名, 地號文字)。「澄清段二小段75地號」→ ("澄清段二小段", "75")、「新甲段1118-13地號」→
    ("新甲段", "1118-13")、「昭明段0135-0005地號等7筆」→ ("昭明段", "135-5")；地號的子號 0 不寫（「1137-0000」→"1137"）。
    解析不出（沒有段名、沒有地號數字）回 None。段名前面的「高雄市」與區名、後面的「地號」會去掉。
    地號座標表的鍵（段名、地號）一律出自這裡，本機查詢腳本與同步用同一個函式，兩邊才對得起來。"""
    text = re.sub(r"\s+", "", unicodedata.normalize("NFKC", lands or ""))
    matched = _PARCEL.match(text)
    if matched is None:
        return None
    section = matched.group("section")
    for prefix in ("高雄市", district or ""):
        if prefix and section.startswith(prefix) and len(section) > len(prefix):
            section = section[len(prefix):]
    section = re.sub(r"地號$", "", section)
    if "段" not in section or len(section) > 40:
        return None
    main, sub = int(matched.group("main")), int(matched.group("sub") or 0)
    landno = str(main) if sub == 0 else f"{main}-{sub}"
    return (section, landno[:16]) if len(landno) <= 16 else None


def _records(text: str) -> list[str]:
    """表頭之後的記錄：「<行政區>,」開頭的行是新記錄，其餘（銷售期間裡的換行）併進前一筆。"""
    records: list[str] = []
    for line in re.split(r"\r\n|\n|\r", text.lstrip("\ufeff"))[1:]:
        if not line:
            continue
        if _NEW_RECORD.match(line):
            records.append(line)
        elif records:
            records[-1] += " " + line
    return records


def _clean(text: str) -> str:
    """去頭尾空白與控制字元（PostgreSQL 不收 NUL）。"""
    return _CONTROL.sub("", text).strip()


def _row(fields: list[str]) -> PresaleRow | None:
    """一筆記錄的欄位 → PresaleRow；欄位不夠、戶數不是整數、案名空白回 None（壞行）。"""
    if len(fields) < _COLUMNS:
        return None
    district, name, street = (_clean(fields[0]), _clean(fields[1]), _clean(fields[2]))
    middle = fields[_LEFT:-_RIGHT]  # 層棟戶數、使用分區、主要用途、主要建材、申報備查日期、銷售期間…
    households = middle[0].strip()
    if not households.isdigit() or not name or len(households) > 6:
        return None
    lands, permit, first_registered = fields[-_RIGHT], fields[-_RIGHT + 1], fields[-_RIGHT + 3]
    parcel = first_parcel(lands, district)
    main_use = _clean(middle[2])
    return PresaleRow(
        district=district,
        name=name[:80],
        street=street[:80],
        households=int(households),
        main_use=main_use[:60],
        residential="住" in main_use,
        declared_on=roc_date(middle[4]),
        permit_on=roc_date(permit),
        first_registered_on=roc_date(first_registered),
        parcel_section=parcel[0] if parcel else None,
        parcel_no=parcel[1] if parcel else None,
    )


def parse_csv(text: str, *, minimum: int = 1) -> PresaleBatch:
    """容錯解析預售建案檔。表頭不對、壞行超過 5%、解析出的高雄案數少於 minimum 都丟 PresaleFormatError。
    同一個 (區, 案名) 再出現視為同案更新（P1）。"""
    lines = re.split(r"\r\n|\n|\r", text.lstrip("\ufeff"), maxsplit=1)
    if not lines[0].strip():
        raise PresaleFormatError("預售建案檔是空的")
    try:
        header = next(csv.reader([lines[0]]))
    except (StopIteration, csv.Error) as exc:
        raise PresaleFormatError("預售建案檔不是 CSV") from exc
    if len(header) != _COLUMNS or any(header[at].strip() != title for at, title in _HEADER_AT.items()):
        raise PresaleFormatError("預售建案檔的表頭不是預期的 15 欄")
    batch = PresaleBatch()
    kept: dict[tuple[str, str], PresaleRow] = {}
    for record in _records(text):
        batch.total += 1
        try:
            row = _row(next(csv.reader([record])))
        except (StopIteration, csv.Error):
            row = None
        if row is None:
            batch.failed += 1
        elif row.district not in DISTRICTS:
            batch.skipped += 1
        else:
            kept[row.key] = row
    batch.rows = list(kept.values())
    if batch.total and batch.failed > batch.total * MAX_FAILED_SHARE:
        raise PresaleFormatError(f"預售建案檔有 {batch.failed} 筆解析不出來（共 {batch.total} 筆），不寫入")
    if len(batch.rows) < minimum:
        raise PresaleFormatError(f"預售建案檔只解析出 {len(batch.rows)} 案，少於 {minimum} 案（可能是殘缺檔），不寫入")
    return batch


# ---- 狀態與預計交屋 ----


def years_before(day: date, years: int) -> date:
    try:
        return day.replace(year=day.year - years)
    except ValueError:  # 2/29
        return day.replace(year=day.year - years, day=28)


def add_months(day: date, months: int) -> date:
    index = day.year * 12 + day.month - 1 + months
    year, month = divmod(index, 12)
    month += 1
    for last in (day.day, 30, 29, 28):  # 月底截齊（1/31 + 1 個月 = 2/28）
        try:
            return date(year, month, last)
        except ValueError:
            continue
    raise AssertionError("unreachable")  # pragma: no cover


def status_of(
    *, residential: bool, first_registered_on: date | None, permit_on: date | None, today: date
) -> str:
    """building 在建／registered 已登記／unknown 不明／non_residential 非住宅（P3）。"""
    if not residential:
        return "non_residential"
    if first_registered_on is not None:
        return "registered"
    if permit_on is not None and permit_on >= years_before(today, BUILDING_YEARS):
        return "building"
    return "unknown"


def delivery_months(households: int) -> int:
    """建照日到交屋的粗估月數（P4）：依 2019–2022 建照、已登記者的中位數（實測 275 案）。"""
    if households <= 20:
        return 25
    if households <= 100:
        return 36
    if households <= 300:
        return 48
    return 52


def expected_delivery(permit_on: date, households: int) -> date:
    return add_months(permit_on, delivery_months(households))


def delivery_half(expected: date) -> tuple[int, int]:
    """(西元年, 1 上半年／2 下半年)；畫面只寫到半年。"""
    return expected.year, 1 if expected.month <= 6 else 2


# ---- 定位 ----


def is_parcel_street(street: str) -> bool:
    return _PARCEL_STREET.search(unicodedata.normalize("NFKC", street)) is not None


def split_roads(street: str) -> list[str]:
    """坐落街道 → 一條或多條路。連接字前一個字是路名或號的結尾才拆；多條時沒有路名的片段（「…對面」）丟掉。"""
    street = unicodedata.normalize("NFKC", street)
    pieces: list[str] = []
    start = 0
    for found in _CONNECTOR.finditer(street):
        if found.start() > start and street[found.start() - 1] in _BEFORE_CONNECTOR:
            pieces.append(street[start:found.start()])
            start = found.end()
    pieces.append(street[start:])
    pieces = [piece.strip() for piece in pieces if piece.strip()]
    marked = [piece for piece in pieces if _ROAD_MARK.search(piece)]
    return marked[:3] or pieces[:1]


def _village_of(district: str | None, village: str | None) -> tuple[str, str] | None:
    code = boundaries.village_code(district, village) if district and village else None
    return (code, village) if code and village else None


async def parcel_lookup(db: AsyncSession) -> dict[tuple[str, str, str], tuple[float, float]]:
    """地號座標表 → {(區, 段名, 地號): (經度, 緯度)}，只含查到座標的。"""
    rows = await db.execute(
        select(GeoParcelPoint.district, GeoParcelPoint.section_name, GeoParcelPoint.landno, GeoParcelPoint.lon, GeoParcelPoint.lat)
        .where(GeoParcelPoint.lon.is_not(None), GeoParcelPoint.lat.is_not(None))
    )
    return {(district, section, landno): (lon, lat) for district, section, landno, lon, lat in rows.all()}


async def match_case(
    db: AsyncSession,
    *,
    district: str,
    street: str,
    parcel_section: str | None,
    parcel_no: str | None,
    version: str | None,
    parcels: dict[tuple[str, str, str], tuple[float, float]],
) -> PresaleMatch:
    """一個建案 → 比對結果（P5）。parcels 是 parcel_lookup 的結果（一批只查一次）。"""
    point = parcels.get((district, parcel_section or "", parcel_no or ""))
    if point is not None:
        code = boundaries.village_at(*point)
        names = boundaries.village_names()
        if code is not None and code in names:
            return PresaleMatch("parcel", code, names[code][1], lat=point[1], lon=point[0])
    if version is None:
        return PresaleMatch("pending")
    if not street or is_parcel_street(street):
        return PresaleMatch("district")
    found: list[tuple[matcher.GeoMatch, tuple[str, str] | None]] = []
    for road in split_roads(street):
        match = await matcher.locate(db, f"高雄市{district}{road}", version=version)
        placed = _village_of(match.district, match.village) if match.match_level in PRESALE_VILLAGE_LEVELS else None
        found.append((match, placed))
    chosen = found[0]
    # 全部的路都到里、而且是同一個里：算該里，座標取第一個有座標的；否則取第一條路的結果。
    if all(placed is not None for _, placed in found) and len({placed for _, placed in found}) == 1:
        chosen = next(((m, p) for m, p in found if m.lat is not None), found[0])
    match, placed = chosen
    if placed is None:
        return PresaleMatch("district")
    return PresaleMatch(match.match_level, placed[0], placed[1], lat=match.lat, lon=match.lng)


def _values(
    row: PresaleRow, match: PresaleMatch, *, label: str | None, source_version: str, now: datetime
) -> dict:
    return {
        "district": row.district, "name": row.name, "street": row.street, "households": row.households,
        "main_use": row.main_use, "residential": row.residential, "declared_on": row.declared_on,
        "permit_on": row.permit_on, "first_registered_on": row.first_registered_on,
        "parcel_section": row.parcel_section, "parcel_no": row.parcel_no,
        "village_code": match.village_code, "village": match.village, "match_level": match.match_level,
        "lon": match.lon, "lat": match.lat,
        "doorplate_version": label if match.match_level != "pending" else None,
        "source_version": source_version, "updated_at": now,
    }


# ---- 資料庫 ----


async def replace_cases(
    db: AsyncSession, batch: PresaleBatch, *, source_version: str, now: datetime, check_shrink: bool = True
) -> int:
    """換上新檔（不 commit）：以新檔為準——不在新檔裡的案刪掉（來源是累計檔，消失代表撤案或更正），同一個 (區, 案名) 覆蓋。
    表內已有至少 100 案、新檔不到 80% 時丟 PresaleFormatError（check_shrink=False 略過，對應 --force）。回傳寫入的案數。"""
    existing = await db.scalar(select(func.count()).select_from(GeoPresaleBuildcase)) or 0
    if check_shrink and existing >= SHRINK_MIN_EXISTING and len(batch.rows) < existing * SHRINK_RATIO:
        raise PresaleFormatError(f"預售建案只有 {len(batch.rows)} 案，比上次的 {existing} 案少了兩成以上，疑似殘缺，未更新")
    version, label = await matcher.doorplate_state(db)
    parcels = await parcel_lookup(db)
    table = GeoPresaleBuildcase.__table__
    values = []
    for row in batch.rows:
        match = await match_case(
            db, district=row.district, street=row.street, parcel_section=row.parcel_section,
            parcel_no=row.parcel_no, version=version, parcels=parcels,
        )
        values.append(_values(row, match, label=label, source_version=source_version, now=now))
    keys = [row.key for row in batch.rows]
    await db.execute(delete(GeoPresaleBuildcase).where(tuple_(table.c.district, table.c.name).not_in(keys)))
    for start in range(0, len(values), 400):
        stmt = pg_insert(table).values(values[start : start + 400])
        await db.execute(
            stmt.on_conflict_do_update(
                index_elements=[table.c.district, table.c.name],
                set_={name: stmt.excluded[name] for name in values[0] if name not in ("district", "name")},
            )
        )
    return len(values)


async def write_batch(
    session_factory: async_sessionmaker[AsyncSession],
    batch: PresaleBatch,
    *,
    source_version: str,
    digest: str,
    now: datetime,
    check_shrink: bool = True,
) -> int:
    """換上新檔並更新狀態列（active_version＝檔案內容的 sha256，label＝來源版本「115-10」），同一個交易。"""
    async with session_factory() as db:
        written = await replace_cases(db, batch, source_version=source_version, now=now, check_shrink=check_shrink)
        status = await db.get(GeoDatasetStatus, "presale_buildcases", with_for_update=True)
        if status is None:
            status = GeoDatasetStatus(dataset="presale_buildcases")
            db.add(status)
        status.active_version = digest
        status.label = source_version
        status.synced_at = now
        status.checked_at = now
        status.last_error = None
        await db.commit()
    return written


async def rematch(
    session_factory: async_sessionmaker[AsyncSession], *, everything: bool = False, per_commit: int = 100
) -> int:
    """重比建案：everything（地號座標匯入後）重比全部；否則只重比「比對當時的門牌月份和使用中的不同」的列（門牌換版、
    之前門牌還沒匯入）。門牌還沒匯入且不是 everything 時什麼都不做。回傳實際改變的案數。"""
    async with session_factory() as db:
        version, label = await matcher.doorplate_state(db)
        if version is None and not everything:
            return 0
        stmt = select(GeoPresaleBuildcase)
        if not everything:
            stmt = stmt.where(GeoPresaleBuildcase.doorplate_version.is_distinct_from(label))
        keys = [(row.district, row.name) for row in (await db.execute(stmt)).scalars()]
    changed = 0
    for start in range(0, len(keys), per_commit):
        async with session_factory() as db:
            parcels = await parcel_lookup(db)
            rows = (
                await db.execute(
                    select(GeoPresaleBuildcase).where(
                        tuple_(GeoPresaleBuildcase.district, GeoPresaleBuildcase.name).in_(keys[start : start + per_commit])
                    )
                )
            ).scalars().all()
            for row in rows:
                match = await match_case(
                    db, district=row.district, street=row.street, parcel_section=row.parcel_section,
                    parcel_no=row.parcel_no, version=version, parcels=parcels,
                )
                new_label = label if match.match_level != "pending" else None
                same = (
                    (row.village_code, row.village, row.match_level, row.lon, row.lat, row.doorplate_version)
                    == (match.village_code, match.village, match.match_level, match.lon, match.lat, new_label)
                )
                if not same:
                    changed += 1
                    await db.execute(
                        update(GeoPresaleBuildcase)
                        .where(GeoPresaleBuildcase.district == row.district, GeoPresaleBuildcase.name == row.name)
                        .values(
                            village_code=match.village_code, village=match.village, match_level=match.match_level,
                            lon=match.lon, lat=match.lat, doorplate_version=new_label,
                        )
                        .execution_options(synchronize_session=False)
                    )
            await db.commit()
    return changed

