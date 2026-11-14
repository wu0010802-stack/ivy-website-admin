"""編班表測試共用的小工具（2026-11-15 計畫）。姓名一律虛構。
測試檔用 `from tests.admissions_helpers import reception_yihua_client  # noqa: F401` 取得帳號 fixture。"""

from __future__ import annotations

import itertools

from tests.admissions_helpers import ADMISSIONS

ROSTER = f"{ADMISSIONS}/roster"

_CODES = itertools.count(1)
_GRADE_PREFIX = {"大班": "大", "中班": "中", "小班": "小", "幼幼班": "幼"}


async def make_class(client, campus_key: str = "yihua", **overrides) -> dict:
    """用 API 建一個班（預設義華、115、大班、班序自動遞增），回傳 ClassOut。"""
    grade = overrides.get("grade", "大班")
    number = next(_CODES)
    body = {
        "school_year": 115,
        "grade": grade,
        "name": f"{_GRADE_PREFIX[grade]}{number}班",
        "class_code": f"{_GRADE_PREFIX[grade]}{number}",
    }
    body.update(overrides)
    response = await client.post(f"{ROSTER}/classes?campus_key={campus_key}", json=body)
    assert response.status_code == 201, response.text
    return response.json()
