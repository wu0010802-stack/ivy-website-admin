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
    data = json.loads(boundary_bytes())
    return {
        (feature["properties"]["TOWNNAME"], feature["properties"]["VILLNAME"]): feature["properties"]["VILLCODE"]
        for feature in data["features"]
    }


def village_code(district: str, village: str) -> str | None:
    return _village_codes().get((district, village))
