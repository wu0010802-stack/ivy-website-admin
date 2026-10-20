"""幼兒園停辦的一次性回補（2026-10-15 規格 §5）。

kiang 的 preschools.json 把停辦園所的 is_active 留在 1，2026-10-15 前的同步因此從沒記過幼兒園停辦。
改以教育部名單判斷後，第一次同步會一次下架約 47 所舊筆；這份檔（scripts/build_kindergarten_closures.py
從名單歷史算出、隨程式提交）告訴同步每一所該怎麼處理：closed＋left_on＝停辦事件寫在離開名單那天；
closed 沒有日期（回補窗口前就消失）或 renamed（改名、換承辦）＝只下架、不寫事件。只在某所「這一輪要下架」時查。

2026-10-20（招生潛力第二、三波）起窗口延伸到 2022-08，檔名改 kindergarten-closures-20261020.csv 並取代 10-15 檔，
多四個欄位（核定、座標、類型，取自離開前最後一版的 preschools.json），讓資料表沒有的停辦園所也能補一列。"""

from __future__ import annotations

import csv
import math
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from app.admissions.geo.kaohsiung import in_kaohsiung
from app.admissions.geo.models import KINDERGARTEN_KINDS

BACKFILL_FILE = Path(__file__).resolve().parent.parent / "geo_data" / "kindergarten-closures-20261020.csv"
COLUMNS = ("source_id", "name", "left_on", "reason", "approved_capacity", "lat", "lng", "kind")
REASONS = ("closed", "renamed")
_INT4_MAX = 2_147_483_647


class BackfillFormatError(ValueError):
    """回補檔的欄位或內容不對；同步把訊息寫進 last_error、幼兒園整輪不換版。"""


@dataclass(frozen=True)
class ClosureBackfill:
    reason: str  # "closed" | "renamed"
    left_on: date | None  # 離開教育部名單的台北日期；回補窗口前就消失的是 None（renamed 的日期只是紀錄，同步用不到）
    # 以下取自離開前最後一版的 preschools.json，找不到的是 None；預設值讓只關心 reason／left_on 的呼叫端不必填。
    name: str = ""
    approved_capacity: int | None = None
    lat: float | None = None
    lng: float | None = None
    kind: str | None = None  # KINDERGARTEN_KINDS 之一


def _parse_date(text: str, where: str) -> date | None:
    try:
        left_on = date.fromisoformat(text) if text else None
    except ValueError as exc:
        raise BackfillFormatError(f"{where}的日期不對") from exc
    if text and left_on.isoformat() != text:  # fromisoformat 也收 20260915 這種寫法
        raise BackfillFormatError(f"{where}的日期不對")
    return left_on


def _parse_capacity(text: str, where: str) -> int | None:
    if not text:
        return None
    if not (text.isascii() and text.isdigit()) or int(text) > _INT4_MAX:  # 只收非負整數；超出 int4 寫入資料表會失敗
        raise BackfillFormatError(f"{where}的核定人數不對")
    return int(text)


def _parse_coordinates(lat_text: str, lng_text: str, where: str) -> tuple[float | None, float | None]:
    if not lat_text and not lng_text:
        return None, None
    try:
        lat, lng = float(lat_text), float(lng_text)  # 只有一個、或不是數字都在這裡擋下
    except ValueError as exc:
        raise BackfillFormatError(f"{where}的座標不對") from exc
    if not (math.isfinite(lat) and math.isfinite(lng) and in_kaohsiung(lat, lng)):  # 和 parse_preschools 收的座標同一個外框
        raise BackfillFormatError(f"{where}的座標不對")
    return lat, lng


def load_closure_backfill(path: Path = BACKFILL_FILE) -> dict[str, ClosureBackfill]:
    """回補檔 → {source_id: ClosureBackfill}。檔案不在、欄位、reason、日期、名稱、核定、座標、類型、source_id 重複
    任一不對就丟 BackfillFormatError；核定、座標、類型三欄可以空（空字串＝None）。"""
    entries: dict[str, ClosureBackfill] = {}
    try:
        handle = path.open(encoding="utf-8", newline="")
    except FileNotFoundError as exc:
        raise BackfillFormatError(f"找不到 {path.name}") from exc
    with handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None or tuple(reader.fieldnames) != COLUMNS:
            raise BackfillFormatError(f"{path.name} 的欄位不對")
        for line, row in enumerate(reader, start=2):
            where = f"{path.name} 第 {line} 列"
            source_id = (row["source_id"] or "").strip()
            name = (row["name"] or "").strip()
            reason = (row["reason"] or "").strip()
            kind = (row["kind"] or "").strip()
            if not source_id or not name or reason not in REASONS or source_id in entries:
                raise BackfillFormatError(f"{where}不對")
            if kind and kind not in KINDERGARTEN_KINDS:
                raise BackfillFormatError(f"{where}的類型不對")
            lat, lng = _parse_coordinates((row["lat"] or "").strip(), (row["lng"] or "").strip(), where)
            entries[source_id] = ClosureBackfill(
                reason=reason,
                left_on=_parse_date((row["left_on"] or "").strip(), where),
                name=name,
                approved_capacity=_parse_capacity((row["approved_capacity"] or "").strip(), where),
                lat=lat,
                lng=lng,
                kind=kind or None,
            )
    return entries
