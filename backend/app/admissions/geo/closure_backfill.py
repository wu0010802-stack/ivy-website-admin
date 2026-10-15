"""幼兒園停辦的一次性回補（2026-10-15 規格 §5）。

kiang 的 preschools.json 把停辦園所的 is_active 留在 1，2026-10-15 前的同步因此從沒記過幼兒園停辦。
改以教育部名單判斷後，第一次同步會一次下架約 47 所舊筆；這份檔（scripts/build_kindergarten_closures.py
從名單歷史算出、隨程式提交）告訴同步每一所該怎麼處理：closed＋left_on＝停辦事件寫在離開名單那天；
closed 沒有日期（2025-06 前就消失）或 renamed（改名、換承辦）＝只下架、不寫事件。只在某所「這一輪要下架」時查。"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import date
from pathlib import Path

BACKFILL_FILE = Path(__file__).resolve().parent.parent / "geo_data" / "kindergarten-closures-20261015.csv"
COLUMNS = ["source_id", "name", "left_on", "reason"]
REASONS = ("closed", "renamed")


class BackfillFormatError(ValueError):
    """回補檔的欄位或內容不對；同步把訊息寫進 last_error、幼兒園整輪不換版。"""


@dataclass(frozen=True)
class ClosureBackfill:
    reason: str  # "closed" | "renamed"
    left_on: date | None  # 離開教育部名單的台北日期；2025-06 前就消失的是 None（renamed 的日期只是紀錄，同步用不到）


def load_closure_backfill(path: Path = BACKFILL_FILE) -> dict[str, ClosureBackfill]:
    """回補檔 → {source_id: ClosureBackfill}。檔案不在、欄位、reason、日期、source_id 重複任一不對就丟 BackfillFormatError。"""
    entries: dict[str, ClosureBackfill] = {}
    try:
        handle = path.open(encoding="utf-8", newline="")
    except FileNotFoundError as exc:
        raise BackfillFormatError(f"找不到 {path.name}") from exc
    with handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != COLUMNS:
            raise BackfillFormatError(f"{path.name} 的欄位不對")
        for line, row in enumerate(reader, start=2):
            source_id = (row["source_id"] or "").strip()
            reason = (row["reason"] or "").strip()
            left_on_text = (row["left_on"] or "").strip()
            if not source_id or reason not in REASONS or source_id in entries:
                raise BackfillFormatError(f"{path.name} 第 {line} 列不對")
            try:
                left_on = date.fromisoformat(left_on_text) if left_on_text else None
            except ValueError as exc:
                raise BackfillFormatError(f"{path.name} 第 {line} 列的日期不對") from exc
            if left_on_text and left_on.isoformat() != left_on_text:  # fromisoformat 也收 20260915 這種寫法
                raise BackfillFormatError(f"{path.name} 第 {line} 列的日期不對")
            entries[source_id] = ClosureBackfill(reason, left_on)
    return entries
