"""高雄市門牌坐標資料（TWD97）的逐列解析與分批匯入（規格 §4、§7）。

CSV 約 102MB、129 萬列，一律串流：解析器一次吃一行；匯入每 5,000 列一個交易、用
COPY 寫進去，不整檔讀進記憶體，也不讓交易在下載時閒置（執行期連線有
idle_in_transaction 逾時）。全部匯完才由 activate_doorplates 切換使用中的批次；
任何一步失敗都只會留下沒人查的批次，下次同步開頭清掉。

逐列解析時，欄位超過資料表欄寬、號碼超出範圍、座標不是有限數或不在高雄市外框內的列，和
其他解析不了的列一樣略過並計數（DoorplateParser.skipped），不讓一列壞資料使整批 COPY 失敗。

「號」含樓層的列（「１２８號十樓之１」）去掉樓層後和同號重複、而且前後相鄰，用前一列
的鍵去重。「附」號（「７４附２號」）、「特８號」「一棟二樓1號」這類不是一般門牌的寫法
（全市約 800 列）直接略過。執行期資料庫角色只有 DML 權限（deploy/README.md），所以
清批次用 DELETE、不用 TRUNCATE。"""

from __future__ import annotations

import csv
import logging
import math
import re
import unicodedata
from collections.abc import AsyncIterable
from dataclasses import astuple, dataclass
from datetime import datetime

from sqlalchemy import delete, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.admissions.geo.address import bounded_number, normalize_text, unit_token
from app.admissions.geo.kaohsiung import TOWN_CODES, fix_village_name, in_kaohsiung
from app.admissions.geo.models import GeoDatasetStatus, GeoDoorplate
from app.admissions.geo.projection import twd97_tm2_to_wgs84
from app.common.csv_export import BOM

EXPECTED_HEADER = ["省市縣市代碼", "鄉鎮市區代碼", "村里", "鄰", "街路段", "地區", "巷", "弄", "號", "橫座標", "縱座標"]
DOORPLATE_COLUMNS = (
    "town_code", "district", "village", "street", "street_kind", "lane", "alley",
    "number", "number_sub", "lat", "lng",
)
COPY_BATCH_SIZE = 5000
logger = logging.getLogger("app.admissions.geo.doorplates")
# 以資料表欄寬為準（lane、alley 的上限另在 address.unit_token，同為 16）。
_STREET_WIDTH = GeoDoorplate.__table__.c.street.type.length
_VILLAGE_WIDTH = GeoDoorplate.__table__.c.village.type.length
# 「號」：主號、之號；門牌表也有把之號寫在號後面的（「５２號之５」），但「號」後面接樓層
# 的「之」（「十樓之１」）不算。
_NUMBER = re.compile(r"臨?(\d+)(?:之(\d+))?(?:之\d+)*號(?:之(\d+)(?![樓\d]))?")


class DoorplateFormatError(ValueError):
    """CSV 欄位和預期不同（平台改版）。訊息不含任何資料內容。"""


@dataclass(frozen=True)
class DoorplateRow:
    town_code: str
    district: str
    village: str
    street: str
    street_kind: str
    lane: str
    alley: str
    number: int
    number_sub: int
    lat: float
    lng: float


def _unit(value: str, suffix: str) -> str | None:
    """巷、弄欄位 → 編號字串；沒有是空字串，超過欄寬回 None。"""
    normalized = normalize_text(value)
    return unit_token(normalized.removesuffix(suffix)) if normalized else ""


class DoorplateParser:
    """一次餵一行（行尾換行可有可無）。第一個非空行必須是表頭；回傳 None＝這行略過。"""

    def __init__(self) -> None:
        self._header_checked = False
        self._previous: tuple | None = None
        self.parsed = 0
        self.skipped = 0

    def feed(self, line: str) -> DoorplateRow | None:
        line = line.rstrip("\r\n")
        if not line:
            return None
        fields = next(csv.reader([line]))
        if not self._header_checked:
            if fields and fields[0].startswith(BOM):
                fields[0] = fields[0][1:]
            if fields != EXPECTED_HEADER:
                raise DoorplateFormatError("門牌資料的欄位和預期不同")
            self._header_checked = True
            return None
        row = self._row(fields)
        if row is None:
            self.skipped += 1
            return None
        key = astuple(row)[:9]
        if key == self._previous:
            return None
        self._previous = key
        self.parsed += 1
        return row

    @staticmethod
    def _row(fields: list[str]) -> DoorplateRow | None:
        if len(fields) != len(EXPECTED_HEADER):
            return None
        _, town_code, village, _, road, area, lane, alley, number_text, x, y = fields
        district = TOWN_CODES.get(town_code)
        matched = _NUMBER.match(unicodedata.normalize("NFKC", number_text))
        street = normalize_text(road or area)
        if district is None or matched is None or not street or not village.strip():
            return None
        village = fix_village_name(village)
        lane_text, alley_text = _unit(lane, "巷"), _unit(alley, "弄")
        if len(street) > _STREET_WIDTH or len(village) > _VILLAGE_WIDTH or lane_text is None or alley_text is None:
            return None
        number = bounded_number(matched.group(1))
        sub_text = matched.group(2) or matched.group(3)
        number_sub = bounded_number(sub_text) if sub_text else 0
        if number is None or number_sub is None:
            return None
        coordinates = _coordinates(x, y)
        if coordinates is None:
            return None
        lat, lng = coordinates
        return DoorplateRow(
            town_code=town_code,
            district=district,
            village=village,
            street=street,
            street_kind="road" if road else "area",
            lane=lane_text,
            alley=alley_text,
            number=number,
            number_sub=number_sub,
            lat=round(lat, 7),
            lng=round(lng, 7),
        )


def _coordinates(x: str, y: str) -> tuple[float, float] | None:
    """TWD97 橫縱座標 → (緯度, 經度)；不是有限數、投影算不出來（溢位）、或不在高雄市外框內回 None。"""
    try:
        easting, northing = float(x), float(y)
        if not (math.isfinite(easting) and math.isfinite(northing)):
            return None
        lat, lng = twd97_tm2_to_wgs84(easting, northing)
    except (ValueError, OverflowError):
        return None
    return (lat, lng) if in_kaohsiung(lat, lng) else None


async def copy_doorplates(db: AsyncSession, tag: str, rows: list[DoorplateRow]) -> None:
    """把一批門牌以 COPY 寫進 tag 批次（不 commit）。走 asyncpg 原生連線。"""
    if not rows:
        return
    connection = await db.connection()
    raw = await connection.get_raw_connection()
    await raw.driver_connection.copy_records_to_table(
        GeoDoorplate.__tablename__,
        records=[(tag, *astuple(row)) for row in rows],
        columns=("dataset_version", *DOORPLATE_COLUMNS),
    )


async def delete_batches(db: AsyncSession, *, keep: str | None) -> None:
    """刪掉 keep 以外的所有批次（不 commit）。一個舊批次約 76 萬列，放寬語句逾時。"""
    await db.execute(text("SET LOCAL statement_timeout = 0"))
    stmt = delete(GeoDoorplate)
    if keep is not None:
        stmt = stmt.where(GeoDoorplate.dataset_version != keep)
    await db.execute(stmt)


async def _discard_batch(session_factory: async_sessionmaker[AsyncSession], tag: str) -> None:
    async with session_factory() as db:
        await db.execute(text("SET LOCAL statement_timeout = 0"))
        await db.execute(delete(GeoDoorplate).where(GeoDoorplate.dataset_version == tag))
        await db.commit()


async def import_doorplates(
    session_factory: async_sessionmaker[AsyncSession],
    tag: str,
    rows: AsyncIterable[DoorplateRow],
    *,
    batch_size: int = COPY_BATCH_SIZE,
) -> int:
    """把 rows 全部寫進 tag 批次，回傳列數。每批一個交易；失敗時刪掉這個批次再往上丟。
    清批次本身也失敗（例如連線一起斷了）時只記 log、照樣丟原本的例外：殘留的批次沒人查，
    下次同步開頭會清掉。"""
    count = 0
    batch: list[DoorplateRow] = []
    try:
        async for row in rows:
            batch.append(row)
            if len(batch) >= batch_size:
                async with session_factory() as db:
                    await copy_doorplates(db, tag, batch)
                    await db.commit()
                count += len(batch)
                batch = []
        if batch:
            async with session_factory() as db:
                await copy_doorplates(db, tag, batch)
                await db.commit()
            count += len(batch)
    except Exception:
        try:
            await _discard_batch(session_factory, tag)
        except Exception:  # noqa: BLE001 - 不能蓋掉原本的例外
            logger.warning("清除失敗的門牌批次 %s 時又出錯，留給下次同步清理", tag, exc_info=True)
        raise
    return count


async def activate_doorplates(
    session_factory: async_sessionmaker[AsyncSession], tag: str, label: str, *, now: datetime
) -> None:
    """切換使用中的批次，再刪掉其他批次。切換和刪除分兩個交易：刪除失敗（例如逾時）也
    不影響已經切過去的查詢，剩下的舊批次下次同步開頭再清。"""
    async with session_factory() as db:
        status = await db.get(GeoDatasetStatus, "doorplates", with_for_update=True)
        if status is None:
            status = GeoDatasetStatus(dataset="doorplates")
            db.add(status)
        status.active_version = tag
        status.label = label
        status.synced_at = now
        status.checked_at = now
        status.last_error = None
        await db.commit()
    async with session_factory() as db:
        await delete_batches(db, keep=tag)
        await db.commit()
