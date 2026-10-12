"""高雄市里界 GeoJSON（docs/specs/2026-10-08-admissions-area-design.md §5.6）。檔案隨
backend 提交，產生方式見 app/admissions/geo_data/README.md；API 原樣回傳，另外提供
(區, 里) → 里代碼對照。"""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from pathlib import Path

BOUNDARY_PATH = Path(__file__).resolve().parent.parent / "geo_data" / "kaohsiung-villages.geojson"
# 內政部國土測繪中心村里界圖 VILLAGE_NLSC_1150817（115/08/17 版）。
BOUNDARY_VERSION = "115-08-17"


@lru_cache(maxsize=1)
def boundary_bytes() -> bytes:
    return BOUNDARY_PATH.read_bytes()


@lru_cache(maxsize=1)
def boundary_etag() -> str:
    digest = hashlib.sha1(boundary_bytes()).hexdigest()[:12]
    return f'"villages-{BOUNDARY_VERSION}-{digest}"'


@lru_cache(maxsize=1)
def _village_codes() -> dict[tuple[str, str], str]:
    """(區, 里) → 里代碼。里名在不同區可以重複（例：中正里），所以鍵是兩個一起；同一個 (區, 里) 出現
    兩次是界圖檔案有問題，直接報錯，不靜默讓後面的蓋掉前面的。"""
    codes: dict[tuple[str, str], str] = {}
    for feature in json.loads(boundary_bytes())["features"]:
        properties = feature["properties"]
        key = (properties["TOWNNAME"], properties["VILLNAME"])
        if key in codes:
            raise ValueError(f"里界資料有重複的行政區與里：{key[0]}{key[1]}")
        codes[key] = properties["VILLCODE"]
    return codes


def village_code(district: str, village: str) -> str | None:
    return _village_codes().get((district, village))
