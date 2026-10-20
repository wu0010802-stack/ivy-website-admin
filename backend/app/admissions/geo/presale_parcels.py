"""預售建案的地號座標表（docs/specs/2026-10-20-admissions-presale-design.md P6、P7）的檔案格式與匯入。

座標由本機腳本 scripts/fetch_presale_parcels.py 向國土測繪中心查好，寫成 presale_parcels.csv；這個檔隨公開資料打包
（`geo-sync --bundle`，種類 presale_parcels）或用 `--presale-parcels-file` 匯入。**正式站同步迴圈完全不連國土測繪中心**
——這個模組只有讀檔與寫資料庫，查詢的網路部分在 nlsc.py（只有腳本 import）。

CSV 欄位：district,section_name,landno,office,sect,lon,lat,fetched_on。(district, section_name, landno) 是鍵，
section_name、landno 出自 presale.first_parcel（同步與腳本用同一個函式，兩邊才對得起來）；office、sect 是國土測繪中心的
所碼與段碼（留作稽核，匯入時不用）；lon、lat 空白＝國土測繪中心查無（下次不重查，除非 --retry-missing）。匯入是 upsert、
不刪舊列（地號不會因為建案下架就失效）；查無的新結果不會蓋掉已有的座標。"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass
from datetime import date
from math import isfinite

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.geo.kaohsiung import DISTRICTS, in_kaohsiung
from app.admissions.geo.models import GeoParcelPoint

COLUMNS = ("district", "section_name", "landno", "office", "sect", "lon", "lat", "fetched_on")
MAX_ROWS = 20_000
_LANDNO = re.compile(r"[0-9]{1,8}(?:-[0-9]{1,8})?")


class ParcelFormatError(ValueError):
    """地號座標檔的格式或內容不對；訊息會寫進 geo_dataset_status.last_error，不含檔案內容。"""


@dataclass(frozen=True)
class ParcelRow:
    district: str
    section_name: str
    landno: str
    office: str
    sect: str
    lon: float | None
    lat: float | None
    fetched_on: date

    @property
    def key(self) -> tuple[str, str, str]:
        return (self.district, self.section_name, self.landno)


def landno8(landno: str) -> str | None:
    """地號文字轉國土測繪中心的 8 碼（主號 4 碼＋子號 4 碼）：「120-1」→「01200001」、「75」→「00750000」；
    主號或子號超過 4 位數回 None。"""
    if _LANDNO.fullmatch(landno) is None:
        return None
    main, _, sub = landno.partition("-")
    if len(str(int(main))) > 4 or len(str(int(sub or 0))) > 4:
        return None
    return f"{int(main):04d}{int(sub or 0):04d}"


def parse_csv(text: str) -> list[ParcelRow]:
    """解析地號座標檔。表頭不對、鍵不合法、座標只有一邊或不在高雄、日期錯、列數過多都丟 ParcelFormatError（整檔不匯入）。
    同一個鍵重複時後面的蓋過前面的。"""
    reader = csv.reader(io.StringIO(text.lstrip("﻿")))
    try:
        header = [cell.strip() for cell in next(reader)]
    except (StopIteration, csv.Error) as exc:
        raise ParcelFormatError("地號座標檔是空的或不是 CSV") from exc
    if tuple(header) != COLUMNS:
        raise ParcelFormatError(f"地號座標檔的表頭要是 {','.join(COLUMNS)}")
    kept: dict[tuple[str, str, str], ParcelRow] = {}
    try:
        for cells in reader:
            if not cells:
                continue
            if len(kept) >= MAX_ROWS:
                raise ParcelFormatError(f"地號座標檔超過 {MAX_ROWS} 列")
            row = _row(cells)
            kept[row.key] = row
    except csv.Error as exc:
        raise ParcelFormatError("地號座標檔不是正確的 CSV") from exc
    return list(kept.values())


def _row(cells: list[str]) -> ParcelRow:
    if len(cells) != len(COLUMNS):
        raise ParcelFormatError("地號座標檔有欄位數不對的列")
    district, section, landno, office, sect, lon_text, lat_text, fetched = (cell.strip() for cell in cells)
    if district not in DISTRICTS or not section or len(section) > 40 or "\x00" in section:
        raise ParcelFormatError("地號座標檔有區名或段名不合法的列")
    if _LANDNO.fullmatch(landno) is None:
        raise ParcelFormatError("地號座標檔有地號格式不對的列")
    lon = lat = None
    if lon_text or lat_text:
        try:
            lon, lat = float(lon_text), float(lat_text)
        except ValueError as exc:
            raise ParcelFormatError("地號座標檔有座標不是數字的列") from exc
        if not (isfinite(lon) and isfinite(lat) and in_kaohsiung(lat, lon)):
            raise ParcelFormatError("地號座標檔有座標不在高雄市範圍的列")
    try:
        fetched_on = date.fromisoformat(fetched)
    except ValueError as exc:
        raise ParcelFormatError("地號座標檔有查詢日期格式不對的列（要 YYYY-MM-DD）") from exc
    return ParcelRow(district, section, landno, office[:8], sect[:8], lon, lat, fetched_on)


def render_csv(rows: list[ParcelRow]) -> str:
    """寫成 CSV 文字（UTF-8，不帶 BOM；排序固定，重跑腳本差異最小）。"""
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(COLUMNS)
    for row in sorted(rows, key=lambda item: item.key):
        writer.writerow(
            [
                row.district, row.section_name, row.landno, row.office, row.sect,
                "" if row.lon is None else f"{row.lon:.7f}", "" if row.lat is None else f"{row.lat:.7f}",
                row.fetched_on.isoformat(),
            ]
        )
    return buffer.getvalue()


async def import_points(db: AsyncSession, rows: list[ParcelRow]) -> int:
    """upsert（不 commit）：不刪舊列；查無座標的新結果不蓋掉已有的座標。回傳寫入的列數。"""
    table = GeoParcelPoint.__table__
    for start in range(0, len(rows), 1000):
        stmt = pg_insert(table).values(
            [
                {"district": r.district, "section_name": r.section_name, "landno": r.landno, "lon": r.lon, "lat": r.lat,
                 "fetched_on": r.fetched_on}
                for r in rows[start : start + 1000]
            ]
        )
        await db.execute(
            stmt.on_conflict_do_update(
                index_elements=[table.c.district, table.c.section_name, table.c.landno],
                set_={
                    "lon": func.coalesce(stmt.excluded.lon, table.c.lon),
                    "lat": func.coalesce(stmt.excluded.lat, table.c.lat),
                    "fetched_on": stmt.excluded.fetched_on,
                },
            )
        )
    return len(rows)
