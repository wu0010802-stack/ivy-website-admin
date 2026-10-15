"""在籍學生測試共用：合成的清冊 HTML 與去識別 JSON（全是假資料；真的清冊檔不進 repo）。"""
from __future__ import annotations

import json
from typing import Any

HEADER = ("編號", "性別", "出生日期", "通訊地址", "入學日期", "實際年齡")
_FILLER = {"編號": "1", "性別": "女", "入學日期": "2025/08/01", "實際年齡": "4歲8個月"}


def roster_html(rows: list[tuple[str, str]], *, printed: str | None = "2026/10/15", header: tuple[str, ...] = HEADER) -> str:
    """仿教保資訊網「園所幼生清冊」匯出檔：抬頭一張表、名冊一張表。rows 是 (出生日期, 通訊地址)，其他欄填假值。"""
    printed_row = f"<tr><td>列印日期：{printed}</td></tr>" if printed else ""
    head = "".join(f"<td>{name}</td>" for name in header)
    body = ""
    for birthday, address in rows:
        values = {**_FILLER, "出生日期": birthday, "通訊地址": address}
        body += "<tr>" + "".join(f"<td>{values[name]}</td>" for name in header) + "</tr>"
    return (
        "<meta http-equiv=Content-Type content=text/html;charset=utf-8>"
        f'<div id="ContentPlaceHolder1"><table><tr><td>高雄市私立測試幼兒園幼生清冊</td></tr>{printed_row}</table>'
        f"<table><tr>{head}</tr>{body}</table></div>"
    )


def student(**changes: Any) -> dict[str, Any]:
    values: dict[str, Any] = {
        "grade": "小班", "district": "三民區", "village": "本揚里", "match_level": "exact",
        "unlocated_reason": None, "lat": 22.642, "lng": 120.344,
    }
    values.update(changes)
    return values


def points_payload(students: list[dict[str, Any]] | None = None, **changes: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "format": "ivy-enrolled-points/1", "campus_key": "yihua", "roster_date": "2026-10-15",
        "school_year": 115, "doorplate_version": "115-10", "students": students if students is not None else [student()],
    }
    payload.update(changes)
    return payload


def payload_text(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False)
