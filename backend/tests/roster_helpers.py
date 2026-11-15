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


async def seed_baseline(db, campus_key: str = "renwu") -> None:
    """規格 §6.3 驗算基準（仁武 115.11.11，姓名虛構）：直接寫資料庫，省掉兩百多次 API 呼叫。
    在籍 60／59／40／45（幼幼班 10 位 113/9/2 之後出生、9 月入園）；預繳 (115,1) 幼幼 8、
    (115,2) 中 1＋幼幼 23（幼幼 31 位不足齡）、(116,1) 小 4＋幼幼 20。"""
    import uuid
    from datetime import date, datetime, timezone

    from app.admissions.roster.models import RosterClass, RosterStudent

    now = datetime.now(timezone.utc)
    rooms: dict[str, RosterClass] = {}
    for order, (grade, code) in enumerate((("大班", "大1"), ("中班", "中1"), ("小班", "小1"), ("幼幼班", "幼1"))):
        rooms[grade] = RosterClass(
            id=uuid.uuid4(), campus_key=campus_key, school_year=115, grade=grade, name=f"{code}班", class_code=code,
            sort_order=0, version=1, created_at=now, updated_at=now,
        )
    db.add_all(rooms.values())
    await db.flush()
    counter = 0

    def kid(**fields) -> RosterStudent:
        nonlocal counter
        counter += 1
        values = dict(
            id=uuid.uuid4(), campus_key=campus_key, school_year=115, child_name=f"測試{counter}", status="enrolled",
            created_at=now, updated_at=now,
        )
        values.update(fields)
        return RosterStudent(**values)

    def in_class(grade: str, count: int, **fields):
        return [kid(class_id=rooms[grade].id, grade=grade, position=index, **fields) for index in range(count)]

    rows = []
    rows += in_class("大班", 60)
    rows += in_class("中班", 59)
    rows += in_class("小班", 40)
    toddlers = [
        kid(class_id=rooms["幼幼班"].id, grade="幼幼班", position=index, birthday=date(2023, 5, 1)) for index in range(35)
    ] + [
        kid(
            class_id=rooms["幼幼班"].id, grade="幼幼班", position=35 + index, birthday=date(2024, 10, 1),
            enrollment_date=date(2026, 9, 14),
        )
        for index in range(10)
    ]
    rows += toddlers

    def pend(grade: str, year: int, semester: int, count: int, **fields):
        return [
            kid(
                status="pending", grade=grade, school_year=year, target_school_year=year, target_semester=semester,
                deposit_date=date(2026, 9, 1), **fields,
            )
            for _ in range(count)
        ]

    rows += pend("幼幼班", 115, 1, 8, birthday=date(2024, 10, 1))
    rows += pend("中班", 115, 2, 1)
    rows += pend("幼幼班", 115, 2, 23, birthday=date(2024, 10, 1))
    rows += pend("小班", 116, 1, 4)
    rows += pend("幼幼班", 116, 1, 20)
    db.add_all(rows)
    await db.commit()
