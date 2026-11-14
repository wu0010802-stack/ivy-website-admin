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


async def add_students(client, class_id: str, names: list[str], *, campus_key: str = "yihua", school_year: int = 115):
    """貼上名單建在籍幼生，回傳 students 清單（失敗就讓測試紅）。"""
    response = await client.post(
        f"{ROSTER}/students?campus_key={campus_key}",
        json={"school_year": school_year, "names": names, "class_id": class_id},
    )
    assert response.status_code == 201, response.text
    return response.json()["students"]


async def add_pending(
    client, name: str = "測試丙", *, campus_key: str = "yihua", school_year: int = 115, class_id: str | None = None, **pending
) -> dict:
    """補登一位預繳未入園的幼生（預設幼幼班、115 上、預繳日 2026-09-01），回傳 StudentOut。"""
    fields = {"grade": "幼幼班", "target_school_year": 115, "target_semester": 1, "deposit_date": "2026-09-01"}
    fields.update(pending)
    body = {"school_year": school_year, "names": [name], "pending": fields}
    if class_id is not None:
        body["class_id"] = class_id
    response = await client.post(f"{ROSTER}/students?campus_key={campus_key}", json=body)
    assert response.status_code == 201, response.text
    return response.json()["students"][0]


async def patch_student(client, student: dict, **fields):
    return await client.patch(
        f"{ROSTER}/students/{student['id']}", json={"expected_version": student["version"], **fields}
    )


async def move_student(client, student: dict, class_id: str | None, position: int = 0):
    return await client.post(
        f"{ROSTER}/students/{student['id']}/move",
        json={"class_id": class_id, "position": position, "expected_version": student["version"]},
    )


async def act(client, student: dict, action: str, **body):
    """已入園（enter）、離園（leave）、退預繳（refund）、恢復（restore）。"""
    return await client.post(
        f"{ROSTER}/students/{student['id']}/{action}", json={"expected_version": student["version"], **body}
    )
