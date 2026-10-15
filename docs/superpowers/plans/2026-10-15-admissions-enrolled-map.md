# 在籍學生分布 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 區域分析地圖多一個「在籍學生」模式：每位在籍學生在地圖上一個點（取整約 100 m），可依班別篩選，下方有距離分布與里排行；清冊地址只在本機比對，正式站只匯入去識別 JSON。

**Architecture:** 後端新增 `app/admissions/enrolled/` 套件，負責以下幾件事：
- 讀教保資訊網清冊、算班別；
- 補行政區後比對門牌（沿用 `matcher.locate_parsed`）；
- 輸出去識別 JSON；
- 用 CLI 匯入；
- 查詢 API。

資料存在兩張新表。前端在 `AreaMap.vue` 加一個點圖層與班別篩選，`AreaTab.vue` 讀新端點，另加 `EnrolledPanel.vue` 兩張表。

**Tech Stack:**
- 後端：FastAPI 0.136.1、SQLAlchemy 2.0 async、Alembic、PostgreSQL、pydantic v2、pytest（asyncio auto）。
- 前端：Vue 3、Element Plus、Leaflet（動態 import）、vitest、Playwright stack e2e。

**Spec:** `docs/specs/2026-10-15-admissions-enrolled-map-design.md`（本計畫依規格寫，執行者兩份都要讀）

## Global Constraints

- **清冊原檔**：`~/Downloads/園所幼生清冊資料匯出.xls`，**只有主 session 在 Task 11 能讀**。subagent 一律不得讀取、複製或列出內容；不得放進 repo、worktree 或 `output/`。所有測試只用合成資料。
- **正式站只存**：班別、區、里、比對等級、`unlocated_reason`、取整座標。**不存**地址、編號、生日、性別、入學日期、補區方式。
- **座標**：緯度、經度都取到小數 3 位（`numeric(6,3)`／`numeric(7,3)`）。
- **距離**：查詢時用目前的本校座標計算，取整到 100 m，分帶沿用 `area.DISTANCE_BANDS = ("0-1", "1-3", "3-6", "6+", "none")`。
- **班別**：只有 `("幼幼班", "小班", "中班", "大班", "其他")`。9/1 還沒滿 2 歲的算幼幼班，滿 6 歲以上歸「其他」。學年取 `academic.current_term(清冊日期)[0]`。
- **權限**：`_require_campus(user, "admissions.read", campus_key)`。總部與該校的 `campus_admin`、`reception` 可以看；`editor`、`readonly` 回 403；校區不在範圍內回 404。
- **輸出格式**：`format` 欄固定為 `"ivy-enrolled-points/1"`。匯入時 pydantic 設 `extra="forbid"`，錯誤訊息只列欄位位置與錯誤種類，**不得印出任何輸入值**。
- **顏色**：一律走 `admin/src/style.css` 的 token。`AreaMap.vue` 的 `<style>` 不能出現 `rgb(`／`oklch(`／`hsl(`／`#abc` 字面值（`areaMap.test.ts` 有守門）。Leaflet 只能動態 import。
- **後台文案**：直白中文，不寫操作說明或開發輔助用字。
- **不新增任何套件**（Python、npm 都不加）。
- **Node**：22（`.nvmrc` 是 22.23.2）。`source ~/.nvm/nvm.sh` 的回傳值是 3，所以 Node 指令用分號串接，不要用 `&&`。
- **pytest**：一律用獨立測試庫 `WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_enrolled1015_test`。
- **資源限制**：機器只有 8GB RAM，同時只跑一組測試。
- **分支與提交**：只在 `feature/enrolled-map-20261015` 提交，Conventional Commit、繁體中文，訊息結尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。**不 push、不部署**；不用 `git add .`、`-A`。
- **工作目錄**：`/Users/yilunwu/Repositories/ivy-website-wt/enrolled-map-20261015`（sparse worktree，已含 web、backend、admin、content、contracts、tests、deploy、scripts、docs、.github）。以下指令中的 `$WT` 都代表這個路徑。

## Review Focus

1. **地址的寫法變化**：全形數字、`&nbsp;`、HTML 實體，結果要和半形一樣比對成功。由 Task 2（實體解碼）與 Task 3（全形、不換行空白）測試。
2. **同一地址兩位學生（手足）**：兩位都要算進總數，地圖上合成同一格、人數是 2。由 Task 4（輸出兩筆）與 Task 6（同格合併）測試。
3. **換校區時篩選還停在舊校的班別**：例如「小班」；換到新校後要回到「全部」。由 Task 9 測試。
4. **篩到某班 0 人**：地圖沒有點，圖例寫「地圖上 0 位」，里排行顯示空狀態文字。由 Task 8、Task 9 測試。
5. **390px 寬**：六顆模式鈕加班別篩選換行後，頁面不能橫捲。由 Task 10 測試。

---

### Task 1: 環境、資料表與 migration

**Files:**
- Create: `backend/app/admissions/enrolled/__init__.py`
- Create: `backend/app/admissions/enrolled/models.py`
- Modify: `backend/app/admissions/models.py`（檔尾，`from app.admissions.geo import models as _geo_models` 之後）
- Create: `backend/migrations/versions/f2a7c1e9d4b3_enrolled_points.py`
- Modify: `backend/tests/conftest.py:134-150`（`_clean_tables` 的 TRUNCATE 字串）
- Modify: `backend/tests/test_geo_schema.py:155`（head 斷言）
- Test: `backend/tests/test_enrolled_schema.py`

**Interfaces:**
- Produces:
  - 常數 `ENROLLED_GRADES`、`ENROLLED_LEVELS`、`ENROLLED_REASONS`、`POINT_LEVELS`。
  - ORM `EnrolledRoster(campus_key, roster_date, school_year, doorplate_version, total, imported_at)`。
  - ORM `EnrolledStudentPoint(id, campus_key, grade, district, village, match_level, unlocated_reason, lat: Decimal|None, lng: Decimal|None)`。

- [ ] **Step 1: 準備環境（只做一次）**

```bash
cd $WT/backend; uv sync --frozen
cd $WT/admin; source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm ci
cd $WT; source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm ci
createdb ivy_website_enrolled1015_test
cd $WT/backend; WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_enrolled1015_test WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_enrolled1015_test WEBSITE_SESSION_SECRET=local-only-session-secret-not-for-any-real-environment uv run alembic upgrade head
```

Expected：alembic 最後一行是 `Running upgrade e4f1a8c6b203 -> c6a9e3f15d27`。另外確認 revision id 沒有撞號：`grep -rl f2a7c1e9d4b3 backend/migrations` 沒有任何輸出。

- [ ] **Step 2: 寫失敗的 schema 測試**

`backend/tests/test_enrolled_schema.py`：

```python
"""在籍學生兩張表（2026-10-15 規格 §4）：約束字串與 migration 逐字相同，CHECK 擋得住壞資料。"""
from __future__ import annotations

from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.admissions.enrolled.models import EnrolledRoster, EnrolledStudentPoint

MIGRATION = Path(__file__).parents[1] / "migrations" / "versions" / "f2a7c1e9d4b3_enrolled_points.py"


def _point(**changes) -> EnrolledStudentPoint:
    values = dict(
        campus_key="yihua", grade="小班", district="三民區", village="本揚里", match_level="exact",
        unlocated_reason=None, lat=Decimal("22.642"), lng=Decimal("120.344"),
    )
    values.update(changes)
    return EnrolledStudentPoint(**values)


async def _roster(db) -> None:
    db.add(EnrolledRoster(campus_key="yihua", roster_date=date(2026, 10, 15), school_year=115, doorplate_version="115-10", total=3))
    await db.commit()


async def _expect_rejected(db, instance) -> None:
    db.add(instance)
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()


def test_check_conditions_match_the_migration_verbatim():
    source = MIGRATION.read_text(encoding="utf-8")
    checks = [c for c in EnrolledStudentPoint.__table__.constraints if (c.name or "").startswith("ck_")]
    assert len(checks) == 5
    for constraint in checks:
        assert str(constraint.sqltext) in source, constraint.name


async def test_points_accept_valid_rows(db_session):
    await _roster(db_session)
    db_session.add_all([
        _point(),
        _point(match_level="street", lat=None, lng=None),
        _point(match_level="unlocated", unlocated_reason="outside_kaohsiung", district=None, village=None, lat=None, lng=None),
        _point(grade="其他"),
    ])
    await db_session.commit()
    assert await db_session.scalar(select(func.count()).select_from(EnrolledStudentPoint)) == 4


@pytest.mark.parametrize(
    "changes",
    [
        {"grade": "小一"},
        {"match_level": "pending"},
        {"lat": None},
        {"match_level": "street"},
        {"unlocated_reason": "anonymized"},
    ],
)
async def test_points_reject_bad_rows(db_session, changes):
    await _roster(db_session)
    await _expect_rejected(db_session, _point(**changes))


async def test_deleting_the_roster_removes_its_points(db_session):
    await _roster(db_session)
    db_session.add(_point())
    await db_session.commit()
    await db_session.delete(await db_session.get(EnrolledRoster, "yihua"))
    await db_session.commit()
    assert await db_session.scalar(select(func.count()).select_from(EnrolledStudentPoint)) == 0
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `cd $WT/backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_enrolled1015_test uv run pytest tests/test_enrolled_schema.py -q`
Expected：FAIL，`ModuleNotFoundError: No module named 'app.admissions.enrolled'`。

- [ ] **Step 4: 寫 models、migration、清表與 head**

`backend/app/admissions/enrolled/__init__.py`：

```python
"""在籍學生分布（2026-10-15 規格 docs/specs/2026-10-15-admissions-enrolled-map-design.md）。"""
```

`backend/app/admissions/enrolled/models.py`：

```python
"""在籍學生分布的兩張表（2026-10-15 規格 §4）：每校一份清冊快照，每位學生一列去識別的點。
不存地址、編號、生日、性別；座標取到小數 3 位（約 100 m）。約束字串與 migration
f2a7c1e9d4b3 逐字相同（tests/test_enrolled_schema.py 檢查）。"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, Numeric, SmallInteger, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.admissions.geo.models import _in
from app.db import Base

ENROLLED_GRADES: tuple[str, ...] = ("幼幼班", "小班", "中班", "大班", "其他")
ENROLLED_LEVELS: tuple[str, ...] = ("exact", "nearby", "street", "district", "unlocated")
ENROLLED_REASONS: tuple[str, ...] = ("no_address", "outside_kaohsiung", "no_doorplate", "ambiguous_village")
# 只有這兩種比對等級有座標（同 matcher：street 只到里、沒有座標）。
POINT_LEVELS: tuple[str, ...] = ("exact", "nearby")


class EnrolledRoster(Base):
    __tablename__ = "enrolled_rosters"

    campus_key: Mapped[str] = mapped_column(String(32), ForeignKey("campuses.key", ondelete="RESTRICT"), primary_key=True)
    roster_date: Mapped[date] = mapped_column(Date, nullable=False)
    school_year: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    doorplate_version: Mapped[str] = mapped_column(String(16), nullable=False)
    total: Mapped[int] = mapped_column(Integer, nullable=False)
    imported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now())


class EnrolledStudentPoint(Base):
    __tablename__ = "enrolled_student_points"
    __table_args__ = (
        CheckConstraint(_in("grade", ENROLLED_GRADES), name="ck_enrolled_student_points_grade"),
        CheckConstraint(_in("match_level", ENROLLED_LEVELS), name="ck_enrolled_student_points_level"),
        CheckConstraint(_in("unlocated_reason", ENROLLED_REASONS, nullable=True), name="ck_enrolled_student_points_reason"),
        CheckConstraint("(lat IS NULL) = (lng IS NULL)", name="ck_enrolled_student_points_coords"),
        CheckConstraint("lat IS NULL OR match_level IN ('exact', 'nearby')", name="ck_enrolled_student_points_point_level"),
        Index("ix_enrolled_student_points_campus", "campus_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campus_key: Mapped[str] = mapped_column(
        String(32), ForeignKey("enrolled_rosters.campus_key", ondelete="CASCADE"), nullable=False
    )
    grade: Mapped[str] = mapped_column(String(8), nullable=False)
    district: Mapped[str | None] = mapped_column(String(8), nullable=True)
    village: Mapped[str | None] = mapped_column(String(16), nullable=True)
    match_level: Mapped[str] = mapped_column(String(16), nullable=False)
    unlocated_reason: Mapped[str | None] = mapped_column(String(24), nullable=True)
    lat: Mapped[Decimal | None] = mapped_column(Numeric(6, 3), nullable=True)
    lng: Mapped[Decimal | None] = mapped_column(Numeric(7, 3), nullable=True)
```

`backend/app/admissions/models.py` 檔尾（`_geo_models` 那行之後）加：

```python
from app.admissions.enrolled import models as _enrolled_models  # noqa: E402,F401
```

`backend/migrations/versions/f2a7c1e9d4b3_enrolled_points.py`：

```python
"""在籍學生分布：新增 enrolled_rosters、enrolled_student_points 兩張表（2026-10-15 規格 §4）

規格：docs/specs/2026-10-15-admissions-enrolled-map-design.md。
只新增表，不改既有資料，不需要先備份正式庫；上一版程式不讀新表，先跑 migration 再換程式也相容。
約束條件字串與 app/admissions/enrolled/models.py 逐字相同（tests/test_enrolled_schema.py 檢查）。
降級刪掉兩張表，已匯入的在籍學生點一併消失。

Revision ID: f2a7c1e9d4b3
Revises: c6a9e3f15d27
Create Date: 2026-10-15
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "f2a7c1e9d4b3"
down_revision = "c6a9e3f15d27"
branch_labels = None
depends_on = None

GRADE_CHECK = "grade IN ('幼幼班', '小班', '中班', '大班', '其他')"
LEVEL_CHECK = "match_level IN ('exact', 'nearby', 'street', 'district', 'unlocated')"
REASON_CHECK = (
    "unlocated_reason IS NULL OR unlocated_reason IN ('no_address', 'outside_kaohsiung', 'no_doorplate', 'ambiguous_village')"
)
COORDS_CHECK = "(lat IS NULL) = (lng IS NULL)"
POINT_LEVEL_CHECK = "lat IS NULL OR match_level IN ('exact', 'nearby')"


def upgrade() -> None:
    op.create_table(
        "enrolled_rosters",
        sa.Column("campus_key", sa.String(32), sa.ForeignKey("campuses.key", ondelete="RESTRICT"), primary_key=True),
        sa.Column("roster_date", sa.Date(), nullable=False),
        sa.Column("school_year", sa.SmallInteger(), nullable=False),
        sa.Column("doorplate_version", sa.String(16), nullable=False),
        sa.Column("total", sa.Integer(), nullable=False),
        sa.Column("imported_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "enrolled_student_points",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "campus_key", sa.String(32), sa.ForeignKey("enrolled_rosters.campus_key", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("grade", sa.String(8), nullable=False),
        sa.Column("district", sa.String(8), nullable=True),
        sa.Column("village", sa.String(16), nullable=True),
        sa.Column("match_level", sa.String(16), nullable=False),
        sa.Column("unlocated_reason", sa.String(24), nullable=True),
        sa.Column("lat", sa.Numeric(6, 3), nullable=True),
        sa.Column("lng", sa.Numeric(7, 3), nullable=True),
        sa.CheckConstraint(GRADE_CHECK, name="ck_enrolled_student_points_grade"),
        sa.CheckConstraint(LEVEL_CHECK, name="ck_enrolled_student_points_level"),
        sa.CheckConstraint(REASON_CHECK, name="ck_enrolled_student_points_reason"),
        sa.CheckConstraint(COORDS_CHECK, name="ck_enrolled_student_points_coords"),
        sa.CheckConstraint(POINT_LEVEL_CHECK, name="ck_enrolled_student_points_point_level"),
    )
    op.create_index("ix_enrolled_student_points_campus", "enrolled_student_points", ["campus_key"])


def downgrade() -> None:
    op.drop_index("ix_enrolled_student_points_campus", table_name="enrolled_student_points")
    op.drop_table("enrolled_student_points")
    op.drop_table("enrolled_rosters")
```

`backend/tests/conftest.py` 的 `_clean_tables`：TRUNCATE 字串裡，在 `"recruitment_visit_geo, ` 那一段前面加 `"enrolled_student_points, enrolled_rosters, "`。兩張表都要在 `RESTART IDENTITY CASCADE` 之前。

`backend/tests/test_geo_schema.py:155`：`["c6a9e3f15d27"]` 改成 `["f2a7c1e9d4b3"]`。

- [ ] **Step 5: 套用 migration，再跑測試確認通過**

```bash
cd $WT/backend; WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_enrolled1015_test WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_enrolled1015_test WEBSITE_SESSION_SECRET=local-only-session-secret-not-for-any-real-environment uv run alembic upgrade head
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_enrolled1015_test uv run pytest tests/test_enrolled_schema.py tests/test_geo_schema.py -q
```

Expected：兩檔全部 PASS。另外跑一次 `alembic downgrade -1` 再 `upgrade head`，確認可以往返（同一組環境變數）。

- [ ] **Step 6: Commit**

```bash
cd $WT
git add backend/app/admissions/enrolled/__init__.py backend/app/admissions/enrolled/models.py backend/app/admissions/models.py \
  backend/migrations/versions/f2a7c1e9d4b3_enrolled_points.py backend/tests/conftest.py backend/tests/test_geo_schema.py \
  backend/tests/test_enrolled_schema.py
git commit -m "feat(admissions): 在籍學生分布的兩張資料表與 migration

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 讀清冊與班別換算

**Files:**
- Create: `backend/app/admissions/enrolled/roster.py`
- Create: `backend/tests/enrolled_helpers.py`
- Test: `backend/tests/test_enrolled_roster.py`

**Interfaces:**
- Produces:
  - `class RosterError(ValueError)`
  - `RosterRow(birthday: date, address: str)`
  - `Roster(printed_on: date | None, rows: tuple[RosterRow, ...])`
  - `parse_roster(text: str) -> Roster`
  - `roster_grade(birthday: date, school_year: int) -> str`
  - 測試 helper：`roster_html(rows, *, printed="2026/10/15", header=HEADER) -> str`、`student(**changes) -> dict`、`points_payload(students=None, **changes) -> dict`、`payload_text(payload) -> str`

- [ ] **Step 1: 寫測試 helper 與失敗的測試**

`backend/tests/enrolled_helpers.py`：

```python
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
```

`backend/tests/test_enrolled_roster.py`：

```python
"""教保資訊網幼生清冊的讀取與班別換算（2026-10-15 規格 §2、E7、E8）。"""
from __future__ import annotations

from datetime import date

import pytest

from app.admissions.enrolled.roster import Roster, RosterError, RosterRow, parse_roster, roster_grade
from tests.enrolled_helpers import roster_html


def test_reads_birthday_and_address_by_header_text():
    roster = parse_roster(roster_html([("2022/02/11", "測試里1鄰測試路1號"), ("2020/09/26", "測試路2號")]))
    assert roster == Roster(
        printed_on=date(2026, 10, 15),
        rows=(RosterRow(date(2022, 2, 11), "測試里1鄰測試路1號"), RosterRow(date(2020, 9, 26), "測試路2號")),
    )


def test_column_order_does_not_matter():
    header = ("通訊地址", "實際年齡", "出生日期", "編號")
    roster = parse_roster(roster_html([("2022/02/11", "測試路1號")], header=header))
    assert roster.rows == (RosterRow(date(2022, 2, 11), "測試路1號"),)


def test_html_entities_in_the_address_are_decoded():
    roster = parse_roster(roster_html([("2022/02/11", "測試里1鄰&nbsp;測試路&#49;號")]))
    assert roster.rows[0].address == "測試里1鄰\xa0測試路1號"


def test_missing_print_date_is_none():
    assert parse_roster(roster_html([("2022/02/11", "測試路1號")], printed=None)).printed_on is None


def test_missing_required_column_is_an_error():
    with pytest.raises(RosterError, match="出生日期"):
        parse_roster(roster_html([("2022/02/11", "測試路1號")], header=("編號", "通訊地址")))


def test_bad_birthday_names_the_row_but_not_the_address():
    with pytest.raises(RosterError) as caught:
        parse_roster(roster_html([("2022/02/11", "測試路1號"), ("111/02/11", "秘密路9號")]))
    assert "第 3 列" in str(caught.value)
    assert "秘密路" not in str(caught.value)


def test_empty_roster_is_an_error():
    with pytest.raises(RosterError, match="沒有任何學生"):
        parse_roster(roster_html([]))


@pytest.mark.parametrize(
    ("birthday", "grade"),
    [
        (date(2021, 9, 1), "大班"),
        (date(2021, 9, 2), "中班"),
        (date(2024, 9, 1), "幼幼班"),
        (date(2024, 9, 2), "幼幼班"),  # 9/1 還沒滿 2 歲：學年中滿 2 歲才入園，實際在幼幼班（E7）
        (date(2020, 9, 2), "大班"),
        (date(2020, 9, 1), "其他"),  # 9/1 已滿 6 歲（E8）
    ],
)
def test_grade_for_school_year_115(birthday, grade):
    assert roster_grade(birthday, 115) == grade
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd $WT/backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_enrolled1015_test uv run pytest tests/test_enrolled_roster.py -q`
Expected：FAIL，`ModuleNotFoundError: No module named 'app.admissions.enrolled.roster'`。

- [ ] **Step 3: 實作 roster.py**

`backend/app/admissions/enrolled/roster.py`：

```python
"""教保資訊網「園所幼生清冊」匯出檔（2026-10-15 規格 §2）：UTF-8 HTML，副檔名 .xls。
只取「出生日期」「通訊地址」兩欄（依表頭文字找欄）；編號、性別、入學日期、實際年齡讀了就丟。
純函式，不碰資料庫。錯誤訊息只寫第幾列，不寫地址。"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from html.parser import HTMLParser

from app.admissions.academic import grade_for_birthday

BIRTHDAY_COLUMN = "出生日期"
ADDRESS_COLUMN = "通訊地址"
_PRINTED = re.compile(r"列印日期[:：]\s*(\d{4})/(\d{1,2})/(\d{1,2})")
_DATE = re.compile(r"^(\d{4})/(\d{1,2})/(\d{1,2})$")


class RosterError(ValueError):
    """清冊格式不對；訊息可以直接印給操作的人看（不含地址）。"""


@dataclass(frozen=True)
class RosterRow:
    birthday: date
    address: str


@dataclass(frozen=True)
class Roster:
    printed_on: date | None
    rows: tuple[RosterRow, ...]


class _Tables(HTMLParser):
    """把每個 <table> 收成「列 × 格文字」；td、th 一視同仁，實體字元由 HTMLParser 解碼。"""

    def __init__(self) -> None:
        super().__init__()
        self.tables: list[list[list[str]]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "table":
            self.tables.append([])
        elif tag == "tr":
            self._row = []
        elif tag in ("td", "th"):
            self._cell = []

    def handle_endtag(self, tag: str) -> None:
        if tag in ("td", "th") and self._cell is not None and self._row is not None:
            self._row.append("".join(self._cell).strip())
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if self.tables:
                self.tables[-1].append(self._row)
            self._row = None

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)


def _date(text: str) -> date | None:
    matched = _DATE.match(text.strip())
    if matched is None:
        return None
    try:
        return date(int(matched[1]), int(matched[2]), int(matched[3]))
    except ValueError:
        return None


def _printed_on(tables: list[list[list[str]]]) -> date | None:
    for table in tables:
        for row in table:
            for cell in row:
                matched = _PRINTED.search(cell)
                if matched:
                    try:
                        return date(int(matched[1]), int(matched[2]), int(matched[3]))
                    except ValueError:
                        return None
    return None


def parse_roster(text: str) -> Roster:
    parser = _Tables()
    parser.feed(text)
    parser.close()
    for table in parser.tables:
        if not table or BIRTHDAY_COLUMN not in table[0] or ADDRESS_COLUMN not in table[0]:
            continue
        header = table[0]
        birthday_at, address_at = header.index(BIRTHDAY_COLUMN), header.index(ADDRESS_COLUMN)
        rows: list[RosterRow] = []
        # 列號照試算表的算法：表頭是第 1 列。
        for number, cells in enumerate(table[1:], start=2):
            if len(cells) != len(header):
                raise RosterError(f"名冊第 {number} 列的欄數和表頭不同")
            birthday = _date(cells[birthday_at])
            if birthday is None:
                raise RosterError(f"名冊第 {number} 列的出生日期不是 YYYY/MM/DD")
            rows.append(RosterRow(birthday, cells[address_at]))
        if not rows:
            raise RosterError("名冊沒有任何學生")
        return Roster(_printed_on(parser.tables), tuple(rows))
    raise RosterError(f"找不到有「{BIRTHDAY_COLUMN}」「{ADDRESS_COLUMN}」兩欄的名冊表格")


def roster_grade(birthday: date, school_year: int) -> str:
    """學年班別（9/1 足歲基準，同 academic.grade_for_birthday）。9/1 還沒滿 2 歲的是學年中滿 2 歲才入園，
    實際在幼幼班（規格 E7）；滿 6 歲以上歸「其他」（E8）。"""
    grade = grade_for_birthday(birthday, school_year)
    if grade is not None:
        return grade
    age = school_year + 1911 - birthday.year - (1 if (birthday.month, birthday.day) > (9, 1) else 0)
    return "幼幼班" if age < 2 else "其他"
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd $WT/backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_enrolled1015_test uv run pytest tests/test_enrolled_roster.py -q`
Expected：全部 PASS。

- [ ] **Step 5: Commit**

```bash
cd $WT
git add backend/app/admissions/enrolled/roster.py backend/tests/enrolled_helpers.py backend/tests/test_enrolled_roster.py
git commit -m "feat(admissions): 讀教保資訊網幼生清冊並換算學年班別

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 補行政區後比對門牌

**Files:**
- Modify: `backend/app/admissions/geo/address.py`（新增 `strip_county`、`leading_village`；`parse_address` 改成呼叫它們，行為不變）
- Create: `backend/app/admissions/enrolled/locate.py`
- Test: `backend/tests/test_enrolled_locate.py`

**Interfaces:**
- Consumes：`matcher.CampusPoint`、`matcher.GeoMatch`、`matcher.locate_parsed(db, parsed, *, version)`、`projection.haversine_m`、`GeoDoorplate`。
- Produces：
  - `address.strip_county(text: str) -> tuple[str, bool]`：輸入已正規化的地址，回傳（其餘文字, 是否外縣市）。
  - `address.leading_village(text: str) -> tuple[str, str] | None`：回傳（里名, 里鄰之後的文字）。
  - `locate.PROBE_DISTRICT = "三民區"`
  - `locate.rest_text(raw: str) -> str`
  - `locate.RosterMatch(match: GeoMatch, method: str)`
  - `async locate.locate_roster_address(db, raw: str, *, version: str, campus: CampusPoint) -> RosterMatch`
  - `method` 的值只有這幾種：`written`、`village_unique`、`village_nearest`、`village_mismatch`、`street_unique`、`street_nearest`、`none`。

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_enrolled_locate.py`：

```python
"""清冊地址補行政區後比對門牌（2026-10-15 規格 §3.2）。門牌用樣本＋幾筆專為同名里、同名路造的假門牌。"""
from __future__ import annotations

import pytest
import pytest_asyncio

from app.admissions.enrolled.locate import locate_roster_address
from app.admissions.geo.kaohsiung import CODE_OF_DISTRICT
from app.admissions.geo.matcher import CampusPoint
from app.admissions.geo.models import GeoDoorplate
from tests.geo_helpers import SAMPLE_TAG, YIHUA_POINT, load_geo_samples

CAMPUS = CampusPoint("yihua", YIHUA_POINT[0], YIHUA_POINT[1], None, "三民區")


def _plate(district: str, village: str, street: str, number: int, lat: float, lng: float) -> GeoDoorplate:
    return GeoDoorplate(
        dataset_version=SAMPLE_TAG, town_code=CODE_OF_DISTRICT[district], district=district, village=village,
        street=street, street_kind="road", lane="", alley="", number=number, number_sub=0, lat=lat, lng=lng,
    )


@pytest_asyncio.fixture
async def plates(db_session):
    await load_geo_samples(db_session)
    db_session.add_all([
        # 同名里在兩區：三民區那一筆離義華近。
        _plate("三民區", "雙區里", "測試一路", 1, 22.6450, 120.3450),
        _plate("鳳山區", "雙區里", "測試一路", 1, 22.6200, 120.3600),
        # 地址寫本揚里，門牌表這一號在寶業里（里界調整過）。
        _plate("三民區", "寶業里", "測試三路", 7, 22.6440, 120.3420),
        # 同名路在兩區：三民區那一筆離義華近。
        _plate("苓雅區", "苓東里", "共用路", 3, 22.6200, 120.3100),
        _plate("三民區", "本揚里", "共用路", 3, 22.6460, 120.3430),
    ])
    await db_session.commit()
    return db_session


async def _locate(db, raw: str):
    result = await locate_roster_address(db, raw, version=SAMPLE_TAG, campus=CAMPUS)
    return result.match.match_level, result.match.district, result.match.village, result.method


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("本揚里1鄰義華路68號", ("exact", "三民區", "本揚里", "village_unique")),
        ("本揚里１鄰義華路６８號", ("exact", "三民區", "本揚里", "village_unique")),
        ("本揚里1鄰\xa0義華路68號", ("exact", "三民區", "本揚里", "village_unique")),
        ("雙區里2鄰測試一路1號", ("exact", "三民區", "雙區里", "village_nearest")),
        ("本揚里3鄰測試三路7號", ("exact", "三民區", "寶業里", "village_mismatch")),
        ("義華路68號", ("exact", "三民區", "本揚里", "street_unique")),
        ("共用路3號", ("exact", "三民區", "本揚里", "street_nearest")),
        ("沒有里5鄰義華路70號", ("exact", "三民區", "本揚里", "street_unique")),
        ("高雄市三民區義華路68號", ("exact", "三民區", "本揚里", "written")),
    ],
)
async def test_located_addresses(plates, raw, expected):
    assert await _locate(plates, raw) == expected


async def test_street_without_a_matching_number_is_street_level(plates):
    level, district, _village, method = await _locate(plates, "義華路999號")
    assert (level, district, method) == ("street", "三民區", "street_unique")


@pytest.mark.parametrize(
    ("raw", "reason", "method"),
    [
        ("臺北市內湖區文德路1號", "outside_kaohsiung", "written"),
        ("不存在路9號", "no_doorplate", "none"),
        ("", "no_address", "none"),
    ],
)
async def test_unlocated_addresses(plates, raw, reason, method):
    result = await locate_roster_address(plates, raw, version=SAMPLE_TAG, campus=CAMPUS)
    assert (result.match.match_level, result.match.unlocated_reason, result.method) == ("unlocated", reason, method)
    assert result.match.lat is None and result.match.district is None
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd $WT/backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_enrolled1015_test uv run pytest tests/test_enrolled_locate.py -q`
Expected：FAIL，`ModuleNotFoundError: No module named 'app.admissions.enrolled.locate'`。

- [ ] **Step 3: address.py 抽出兩個 helper（行為不變）**

在 `backend/app/admissions/geo/address.py` 的 `parse_address` 之前加：

```python
def strip_county(text: str) -> tuple[str, bool]:
    """已正規化的地址 → (拿掉郵遞區號、國名與「高雄市」字首後的文字, 是否外縣市)。"""
    text = _POSTAL.sub("", text)
    text = re.sub(r"^(?:中華民國)?(?:台灣省?)?", "", text)
    if text.startswith(("高雄市", "高雄縣")):
        return text[3:], False
    if text.startswith("高雄"):
        return text[2:], False
    return text, text.startswith(OTHER_COUNTIES)


def leading_village(text: str) -> tuple[str, str] | None:
    """開頭是「〇〇里〇鄰」或「〇〇里」接街路時，回 (里名, 里鄰之後的文字)。「五里路」「大里街」這種
    街名本身帶里字的不算：拿掉之後剩下的必須還是「兩個字以上＋路／街／大道」。"""
    village = _VILLAGE.match(text)
    if village and (village.group(2) or _STARTS_WITH_ROAD.match(village.group(3))):
        return village.group(1), village.group(3)
    return None
```

`parse_address` 的開頭從

```python
    text = _POSTAL.sub("", text)
    text = re.sub(r"^(?:中華民國)?(?:台灣省?)?", "", text)
    if text.startswith(("高雄市", "高雄縣")):
        text = text[3:]
    elif text.startswith("高雄"):
        text = text[2:]
    elif text.startswith(OTHER_COUNTIES):
        return ParsedAddress(None, None, None, None, None, 0, True)
```

改成

```python
    text, outside = strip_county(text)
    if outside:
        return ParsedAddress(None, None, None, None, None, 0, True)
```

里鄰那段從

```python
    village = _VILLAGE.match(text)
    if village and (village.group(2) or _STARTS_WITH_ROAD.match(village.group(3))):
        text = village.group(3)
    text = re.sub(r"^\d+鄰", "", text)
```

改成（保留原本的註解）

```python
    village = leading_village(text)
    if village is not None:
        text = village[1]
    text = re.sub(r"^\d+鄰", "", text)
```

Run: `cd $WT/backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_enrolled1015_test uv run pytest tests/test_geo_address.py tests/test_geo_matcher.py -q`
Expected：全部 PASS（重構不改行為）。

- [ ] **Step 4: 實作 locate.py**

`backend/app/admissions/enrolled/locate.py`：

```python
"""清冊地址 → 門牌比對（2026-10-15 規格 §3.2）。教保資訊網的通訊地址多半沒寫縣市區（「〇〇里〇鄰〇〇路…」
或直接從路名開始），parse_address 要地址先寫區；這裡先用里名或街路名在門牌表找出候選區，逐區比對再挑一個：
等級最好的；同等級取離本校最近的；都沒座標時取本校所在區，最後依區名（結果才穩定）。"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import distinct, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from app.admissions.geo.address import leading_village, normalize_text, parse_address, strip_county
from app.admissions.geo.matcher import CampusPoint, GeoMatch, locate_parsed
from app.admissions.geo.models import GeoDoorplate
from app.admissions.geo.projection import haversine_m

# 只用來從沒寫區的地址切出街路名：parse_address 要先看到區才會往下切，區名本身不影響街路。
PROBE_DISTRICT = "三民區"
_LEVEL_RANK = {"exact": 0, "nearby": 1, "street": 2, "district": 3, "pending": 4, "unlocated": 5}


@dataclass(frozen=True)
class RosterMatch:
    match: GeoMatch
    # written｜village_unique｜village_nearest｜village_mismatch｜street_unique｜street_nearest｜none
    method: str


def _unlocated(reason: str) -> GeoMatch:
    return GeoMatch(None, None, "unlocated", reason, None, None)


def rest_text(raw: str) -> str:
    """拿掉郵遞區號、國名與「高雄市」字首，剩下從里或街路開始的文字（已正規化）。"""
    return strip_county(normalize_text(raw))[0]


def _distance(match: GeoMatch, campus: CampusPoint) -> float:
    if match.lat is None or match.lng is None or campus.lat is None or campus.lng is None:
        return float("inf")
    return haversine_m(campus.lat, campus.lng, match.lat, match.lng)


def _best(results: list[tuple[str, GeoMatch]], campus: CampusPoint) -> GeoMatch:
    _, match = min(
        results,
        key=lambda item: (
            _LEVEL_RANK[item[1].match_level], _distance(item[1], campus), item[0] != campus.district, item[0],
        ),
    )
    return match


async def _districts_with(db: AsyncSession, version: str, column: InstrumentedAttribute, value: str) -> list[str]:
    rows = await db.execute(
        select(distinct(GeoDoorplate.district)).where(GeoDoorplate.dataset_version == version, column == value)
    )
    return sorted(rows.scalars().all())


async def _try_districts(db: AsyncSession, districts: list[str], text: str, version: str) -> list[tuple[str, GeoMatch]]:
    results: list[tuple[str, GeoMatch]] = []
    for district in districts:
        parsed = parse_address(f"{district}{text}")
        if parsed is None or parsed.district is None:
            continue
        results.append((district, await locate_parsed(db, parsed, version=version)))
    return results


async def locate_roster_address(db: AsyncSession, raw: str, *, version: str, campus: CampusPoint) -> RosterMatch:
    parsed = parse_address(raw)
    if parsed is None:
        return RosterMatch(_unlocated("no_address"), "none")
    if parsed.outside_kaohsiung:
        return RosterMatch(_unlocated("outside_kaohsiung"), "written")
    if parsed.district is not None:
        return RosterMatch(await locate_parsed(db, parsed, version=version), "written")

    text = rest_text(raw)
    village = leading_village(text)
    if village is not None:
        name, rest = village
        districts = await _districts_with(db, version, GeoDoorplate.village, name)
        results = await _try_districts(db, districts, text, version)
        if results:
            consistent = [item for item in results if item[1].village == name]
            if consistent:
                return RosterMatch(_best(consistent, campus), "village_unique" if len(districts) == 1 else "village_nearest")
            return RosterMatch(_best(results, campus), "village_mismatch")
        # 門牌表沒有這個里名：拿掉里鄰，改用街路找。
        text = rest

    probe = parse_address(f"{PROBE_DISTRICT}{text}")
    street = probe.street if probe is not None else None
    if not street:
        return RosterMatch(_unlocated("no_doorplate"), "none")
    districts = await _districts_with(db, version, GeoDoorplate.street, street)
    results = await _try_districts(db, districts, text, version)
    if not results:
        return RosterMatch(_unlocated("no_doorplate"), "none")
    return RosterMatch(_best(results, campus), "street_unique" if len(districts) == 1 else "street_nearest")
```

- [ ] **Step 5: 跑測試確認通過**

Run: `cd $WT/backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_enrolled1015_test uv run pytest tests/test_enrolled_locate.py tests/test_geo_address.py -q`
Expected：全部 PASS。

如果「義華路999號」那一則的區不是三民區，先用 `grep 義華路 backend/tests/fixtures/geo/doorplates-sample.csv` 確認樣本裡義華路的分布，再修正**測試的預期**。不要為了遷就測試去改比對規則。

- [ ] **Step 6: Commit**

```bash
cd $WT
git add backend/app/admissions/geo/address.py backend/app/admissions/enrolled/locate.py backend/tests/test_enrolled_locate.py
git commit -m "feat(admissions): 清冊地址用里名或路名補行政區後比對門牌

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 本機比對指令 `enrolled-match`

**Files:**
- Create: `backend/app/admissions/enrolled/match.py`
- Modify: `backend/app/cli.py`（新增 `enrolled_match_options`、`enrolled_match_command`；在 `main()` 的 usage 字串與 `elif` 加分支）
- Test: `backend/tests/test_enrolled_match.py`

**Interfaces:**
- Consumes：
  - `parse_roster`、`roster_grade`、`Roster`（Task 2）；
  - `locate_roster_address`、`PROBE_DISTRICT`、`rest_text`（Task 3）；
  - `matcher.active_doorplate_version`、`matcher.doorplate_label`、`matcher.campus_point`、`academic.current_term`、`POINT_LEVELS`、`ENROLLED_GRADES`。
- Produces：
  - `match.FORMAT = "ivy-enrolled-points/1"`
  - `match.MIN_PLACED_RATIO = 0.9`
  - `class match.MatchError(RuntimeError)`
  - `match.MatchOutcome(payload: dict, report: list[str], placed_ratio: float)`
  - `match.round_coord(value: float) -> float`
  - `match.masked_address(raw: str) -> str`
  - `async match.match_roster(db, roster: Roster, *, campus_key: str, roster_date: date) -> MatchOutcome`
  - `cli.enrolled_match_options(args: list[str]) -> dict`
  - `async cli.enrolled_match_command(*, roster: Path, campus_key: str, out: Path, roster_date: date | None, allow_low_hit: bool) -> None`

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_enrolled_match.py`：

```python
"""本機比對：清冊 → 去識別 JSON ＋ 命中報告（2026-10-15 規格 §3.3–3.5）。"""
from __future__ import annotations

import json
from datetime import date

import pytest

from app import cli
from app.admissions.enrolled.match import MatchError, masked_address, match_roster, round_coord
from app.admissions.enrolled.roster import parse_roster
from app.cli import enrolled_match_command, enrolled_match_options
from tests.enrolled_helpers import roster_html
from tests.geo_helpers import load_geo_samples, publish_campus_address

STUDENT_KEYS = {"grade", "district", "village", "match_level", "unlocated_reason", "lat", "lng"}
ROWS = [
    ("2023/03/01", "本揚里1鄰義華路68號"),
    ("2023/03/01", "本揚里1鄰義華路68號"),  # 手足同住：兩位都要算
    ("2021/05/05", "高雄市三民區義華路999號"),
    ("2022/12/12", "臺北市內湖區文德路1號"),
]


async def _ready(db) -> None:
    await load_geo_samples(db)
    await publish_campus_address(db, "yihua", "高雄市三民區義華路68號")


def test_round_coord_keeps_three_decimals():
    assert round_coord(22.6424556) == 22.642
    assert round_coord(120.3437133) == 120.344
    assert round_coord(22.6425) == 22.643


def test_masked_address_keeps_only_the_street():
    assert masked_address("本揚里1鄰義華路68號3樓") == "義華路…"
    assert masked_address("高雄市三民區義華路12巷3號") == "義華路…"
    assert masked_address("臺北市內湖區文德路1號") == ""
    assert masked_address("") == ""


async def test_payload_is_deidentified_and_sorted(db_session):
    await _ready(db_session)
    outcome = await match_roster(db_session, parse_roster(roster_html(ROWS)), campus_key="yihua", roster_date=date(2026, 10, 15))
    payload = outcome.payload
    assert set(payload) == {"format", "campus_key", "roster_date", "school_year", "doorplate_version", "students"}
    assert payload["format"] == "ivy-enrolled-points/1"
    assert (payload["roster_date"], payload["school_year"], payload["doorplate_version"]) == ("2026-10-15", 115, "115-10")
    students = payload["students"]
    assert len(students) == 4
    assert all(set(item) == STUDENT_KEYS for item in students)
    assert [item["grade"] for item in students] == ["小班", "小班", "小班", "大班"]
    placed = [item for item in students if item["lat"] is not None]
    assert [(item["lat"], item["lng"]) for item in placed] == [(22.642, 120.344), (22.642, 120.344)]
    text = json.dumps(payload, ensure_ascii=False)
    assert "義華路" not in text and "文德路" not in text
    assert outcome.placed_ratio == 0.5


async def test_report_counts_and_masks_unplaced_addresses(db_session):
    await _ready(db_session)
    outcome = await match_roster(db_session, parse_roster(roster_html(ROWS)), campus_key="yihua", roster_date=date(2026, 10, 15))
    report = "\n".join(outcome.report)
    assert "共 4 位" in report
    assert "有點 2 位（50.0%）" in report
    assert "班別：小班 3、大班 1" in report
    assert "義華路…" in report
    assert "999" not in report and "文德路" not in report


async def test_needs_doorplates_and_a_located_campus(db_session):
    roster = parse_roster(roster_html(ROWS))
    with pytest.raises(MatchError, match="門牌"):
        await match_roster(db_session, roster, campus_key="yihua", roster_date=date(2026, 10, 15))
    await load_geo_samples(db_session)
    with pytest.raises(MatchError, match="本校沒有座標"):
        await match_roster(db_session, roster, campus_key="yihua", roster_date=date(2026, 10, 15))


def test_cli_options(tmp_path):
    roster = tmp_path / "roster.xls"
    roster.write_text(roster_html(ROWS), encoding="utf-8")
    options = enrolled_match_options(["--roster", str(roster), "--campus", "yihua", "--out", str(tmp_path / "o.json")])
    assert options == {
        "roster": roster, "campus_key": "yihua", "out": tmp_path / "o.json", "roster_date": None, "allow_low_hit": False,
    }
    assert enrolled_match_options(
        ["--roster", str(roster), "--campus", "yihua", "--out", "o.json", "--roster-date", "2026-10-15", "--allow-low-hit"]
    )["roster_date"] == date(2026, 10, 15)


@pytest.mark.parametrize(
    "args",
    [
        [],
        ["--roster", "/no/such.xls", "--campus", "yihua", "--out", "o.json"],
        ["--campus", "yihua", "--out", "o.json"],
        ["--roster", "ROSTER", "--campus", "nowhere", "--out", "o.json"],
        ["--roster", "ROSTER", "--campus", "yihua", "--out", "o.json", "--roster-date", "115/10/15"],
    ],
)
def test_cli_rejects_bad_options(tmp_path, args):
    roster = tmp_path / "roster.xls"
    roster.write_text(roster_html(ROWS), encoding="utf-8")
    with pytest.raises(SystemExit):
        enrolled_match_options([str(roster) if item == "ROSTER" else item for item in args])


@pytest.fixture
def cli_db(app, monkeypatch):
    async def session_factory():
        return app.state.session_factory

    monkeypatch.setattr(cli, "_session_factory", session_factory)
    monkeypatch.setattr(cli, "get_settings", lambda: app.state.settings)


async def test_cli_refuses_a_low_hit_rate_unless_allowed(db_session, cli_db, tmp_path, capsys):
    await _ready(db_session)
    roster = tmp_path / "roster.xls"
    roster.write_text(roster_html(ROWS), encoding="utf-8")
    out = tmp_path / "points.json"
    options = dict(roster=roster, campus_key="yihua", out=out, roster_date=None)
    with pytest.raises(SystemExit) as caught:
        await enrolled_match_command(**options, allow_low_hit=False)
    assert caught.value.code == 2
    assert not out.exists()
    assert "不到 90%" in capsys.readouterr().err
    await enrolled_match_command(**options, allow_low_hit=True)
    assert json.loads(out.read_text(encoding="utf-8"))["format"] == "ivy-enrolled-points/1"


async def test_cli_needs_a_roster_date(db_session, cli_db, tmp_path, capsys):
    roster = tmp_path / "roster.xls"
    roster.write_text(roster_html(ROWS, printed=None), encoding="utf-8")
    with pytest.raises(SystemExit) as caught:
        await enrolled_match_command(roster=roster, campus_key="yihua", out=tmp_path / "o.json", roster_date=None, allow_low_hit=True)
    assert caught.value.code == 1
    assert "--roster-date" in capsys.readouterr().err
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd $WT/backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_enrolled1015_test uv run pytest tests/test_enrolled_match.py -q`
Expected：FAIL，`ModuleNotFoundError: No module named 'app.admissions.enrolled.match'`。

- [ ] **Step 3: 實作 match.py**

`backend/app/admissions/enrolled/match.py`：

```python
"""本機比對（2026-10-15 規格 §3.3–3.5）：清冊 → 去識別 JSON ＋ 命中報告。只讀資料庫（門牌、已發布校址）。
輸出只有班別、區、里、比對等級、原因、取整座標，依班別、區、里、座標排序（列序對不回清冊編號）；
沒有點的學生在報告裡只印到街路名。"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import academic
from app.admissions.enrolled.locate import PROBE_DISTRICT, locate_roster_address, rest_text
from app.admissions.enrolled.models import ENROLLED_GRADES, ENROLLED_LEVELS, POINT_LEVELS
from app.admissions.enrolled.roster import Roster, roster_grade
from app.admissions.geo import matcher
from app.admissions.geo.address import parse_address

FORMAT = "ivy-enrolled-points/1"
MIN_PLACED_RATIO = 0.9
_METHOD_ORDER = ("written", "village_unique", "village_nearest", "village_mismatch", "street_unique", "street_nearest", "none")
_INFERRED = ("village_nearest", "village_mismatch", "street_nearest")


class MatchError(RuntimeError):
    """比對前提不成立（門牌沒匯入、本校沒座標）；訊息直接印給操作的人。"""


@dataclass(frozen=True)
class MatchOutcome:
    payload: dict[str, Any]
    report: list[str]
    placed_ratio: float


def round_coord(value: float) -> float:
    """取到小數 3 位（約 100 m），四捨五入；先轉字串再進 Decimal，避免二進位誤差。"""
    return float(Decimal(str(value)).quantize(Decimal("0.001"), rounding=ROUND_HALF_UP))


def masked_address(raw: str) -> str:
    """報告用：只留街路名（巷、弄、號、樓都不印）；外縣市或切不出街路回空字串。"""
    parsed = parse_address(raw)
    if parsed is not None and parsed.district is None and not parsed.outside_kaohsiung:
        parsed = parse_address(f"{PROBE_DISTRICT}{rest_text(raw)}")
    return f"{parsed.street}…" if parsed is not None and parsed.street else ""


def _joined(counter: Counter, order: tuple[str, ...]) -> str:
    return "、".join(f"{key} {counter[key]}" for key in order if counter[key])


async def match_roster(db: AsyncSession, roster: Roster, *, campus_key: str, roster_date: date) -> MatchOutcome:
    version = await matcher.active_doorplate_version(db)
    label = await matcher.doorplate_label(db)
    if version is None or label is None:
        raise MatchError("門牌資料尚未匯入，先跑 geo-sync --doorplates-file")
    campus = await matcher.campus_point(db, campus_key)
    if campus.lat is None or campus.lng is None:
        raise MatchError(f"本校沒有座標（{campus.locate_error}），無法比對")
    school_year = academic.current_term(roster_date)[0]

    students: list[dict[str, Any]] = []
    levels: Counter = Counter()
    methods: Counter = Counter()
    grades: Counter = Counter()
    unplaced_lines: list[str] = []
    for row in roster.rows:
        result = await locate_roster_address(db, row.address, version=version, campus=campus)
        match = result.match
        grade = roster_grade(row.birthday, school_year)
        placed = match.match_level in POINT_LEVELS and match.lat is not None and match.lng is not None
        students.append({
            "grade": grade,
            "district": match.district,
            "village": match.village,
            "match_level": match.match_level,
            "unlocated_reason": match.unlocated_reason,
            "lat": round_coord(match.lat) if placed else None,
            "lng": round_coord(match.lng) if placed else None,
        })
        levels[match.match_level] += 1
        methods[result.method] += 1
        grades[grade] += 1
        if not placed:
            unplaced_lines.append(f"  {match.match_level}／{match.unlocated_reason or '-'}　{masked_address(row.address)}")

    students.sort(key=lambda item: (
        ENROLLED_GRADES.index(item["grade"]), item["district"] or "", item["village"] or "",
        item["lat"] if item["lat"] is not None else 0.0, item["lng"] if item["lng"] is not None else 0.0,
        item["match_level"],
    ))
    total = len(students)
    placed_count = sum(1 for item in students if item["lat"] is not None)
    ratio = placed_count / total
    inferred = sum(methods[key] for key in _INFERRED)
    report = [
        f"清冊 {roster_date.isoformat()}・{school_year} 學年・門牌 {label}・共 {total} 位",
        f"有點 {placed_count} 位（{ratio:.1%}）",
        f"比對等級：{_joined(levels, ENROLLED_LEVELS)}",
        f"補區方式：{_joined(methods, _METHOD_ORDER)}（推定 {inferred} 位）",
        f"班別：{_joined(grades, ENROLLED_GRADES)}",
    ]
    if unplaced_lines:
        report += ["沒有點的學生（等級／原因　街路）：", *sorted(unplaced_lines)]
    payload = {
        "format": FORMAT,
        "campus_key": campus_key,
        "roster_date": roster_date.isoformat(),
        "school_year": school_year,
        "doorplate_version": label,
        "students": students,
    }
    return MatchOutcome(payload, report, ratio)
```

- [ ] **Step 4: cli.py 加 `enrolled-match`**

在 `backend/app/cli.py` 的 `geo_sync_command` 之後、`main()` 之前加：

```python
def enrolled_match_options(args: list[str]) -> dict:
    """`enrolled-match` 的參數（2026-10-15 在籍學生規格 §3.5）：在本機比對清冊，輸出去識別 JSON。"""
    from datetime import date as date_type

    from app.campuses.models import CAMPUS_KEYS

    usage = (
        "用法：python -m app.cli enrolled-match --roster <清冊 xls> --campus <校區> --out <JSON> "
        "[--roster-date YYYY-MM-DD] [--allow-low-hit]"
    )
    values: dict[str, str] = {}
    allow_low_hit = False
    flags = {"--roster": "roster", "--campus": "campus", "--out": "out", "--roster-date": "roster_date"}
    index = 0
    while index < len(args):
        arg = args[index]
        if arg == "--allow-low-hit":
            allow_low_hit = True
            index += 1
        elif arg in flags and index + 1 < len(args) and not args[index + 1].startswith("--"):
            values[flags[arg]] = args[index + 1]
            index += 2
        else:
            raise SystemExit(usage)
    if not {"roster", "campus", "out"} <= values.keys():
        raise SystemExit(usage)
    roster = Path(values["roster"])
    if not roster.is_file():
        raise SystemExit(f"找不到清冊檔：{roster}")
    if values["campus"] not in CAMPUS_KEYS:
        raise SystemExit(f"沒有這個校區：{values['campus']}")
    roster_date = None
    if "roster_date" in values:
        try:
            roster_date = date_type.fromisoformat(values["roster_date"])
        except ValueError:
            raise SystemExit("--roster-date 要寫 YYYY-MM-DD") from None
    return {
        "roster": roster, "campus_key": values["campus"], "out": Path(values["out"]),
        "roster_date": roster_date, "allow_low_hit": allow_low_hit,
    }


async def enrolled_match_command(*, roster: Path, campus_key: str, out: Path, roster_date, allow_low_hit: bool) -> None:
    from app.admissions.enrolled.match import MIN_PLACED_RATIO, MatchError, match_roster
    from app.admissions.enrolled.roster import RosterError, parse_roster

    try:
        parsed = parse_roster(roster.read_text(encoding="utf-8"))
    except (RosterError, UnicodeDecodeError) as error:
        print(f"清冊讀取失敗：{error}", file=sys.stderr)
        raise SystemExit(1) from None
    day = roster_date or parsed.printed_on
    if day is None:
        print("清冊沒有列印日期，請用 --roster-date 指定", file=sys.stderr)
        raise SystemExit(1)
    factory = await _session_factory()
    async with factory() as db:
        try:
            outcome = await match_roster(db, parsed, campus_key=campus_key, roster_date=day)
        except MatchError as error:
            print(f"比對失敗：{error}", file=sys.stderr)
            raise SystemExit(1) from None
    for line in outcome.report:
        print(line)
    if outcome.placed_ratio < MIN_PLACED_RATIO and not allow_low_hit:
        print(f"有點比例 {outcome.placed_ratio:.1%} 不到 90%，沒有寫出檔案；確認後可加 --allow-low-hit", file=sys.stderr)
        raise SystemExit(2)
    out.write_text(json.dumps(outcome.payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"已寫出 {out}")
```

`main()` 的 usage 字串，在 `"geo-sync [...] [--bundle <ZIP>]` 之後加一段：

```python
            "|enrolled-match --roster <xls> --campus <key> --out <JSON> [--roster-date YYYY-MM-DD] [--allow-low-hit]"
```

`main()` 的 `elif command == "geo-sync":` 分支之後加：

```python
    elif command == "enrolled-match":
        asyncio.run(enrolled_match_command(**enrolled_match_options(sys.argv[2:])))
```

- [ ] **Step 5: 跑測試確認通過**

Run: `cd $WT/backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_enrolled1015_test uv run pytest tests/test_enrolled_match.py -q`
Expected：全部 PASS。

- [ ] **Step 6: Commit**

```bash
cd $WT
git add backend/app/admissions/enrolled/match.py backend/app/cli.py backend/tests/test_enrolled_match.py
git commit -m "feat(admissions): enrolled-match 在本機比對清冊並輸出去識別 JSON

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 匯入指令 `enrolled-import`

**Files:**
- Create: `backend/app/admissions/enrolled/importer.py`
- Modify: `backend/app/cli.py`（新增 `enrolled_import_options`、`enrolled_import_command`；在 `main()` 的 usage 與 `elif` 加分支）
- Test: `backend/tests/test_enrolled_import.py`

**Interfaces:**
- Consumes：`EnrolledRoster`、`EnrolledStudentPoint`、`ENROLLED_GRADES`、`ENROLLED_LEVELS`、`ENROLLED_REASONS`、`POINT_LEVELS`（Task 1）；`kaohsiung.in_kaohsiung(lat, lng)`；`CAMPUS_KEYS`；`constants.SCHOOL_YEAR_MIN/MAX`。
- Produces：
  - `importer.EnrolledStudentIn`、`importer.EnrolledRosterIn`（pydantic）
  - `importer.load_payload(text: str) -> EnrolledRosterIn`
  - `importer.describe_error(error: ValidationError) -> str`
  - `async importer.replace_roster(db, payload) -> tuple[int, int]`（呼叫端 commit）
  - `async importer.clear_roster(db, campus_key) -> bool`
  - `cli.enrolled_import_options(args) -> dict`
  - `async cli.enrolled_import_command(*, file: Path | None, clear: str | None) -> None`

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_enrolled_import.py`：

```python
"""匯入去識別 JSON（2026-10-15 規格 §3.5）：多欄位整份拒絕、錯誤訊息不印輸入值、整批取代、失敗不動舊資料。"""
from __future__ import annotations

import pytest
from pydantic import ValidationError
from sqlalchemy import func, select

from app import cli
from app.admissions.enrolled.importer import clear_roster, describe_error, load_payload, replace_roster
from app.admissions.enrolled.models import ENROLLED_GRADES, ENROLLED_LEVELS, ENROLLED_REASONS, EnrolledRoster, EnrolledStudentPoint
from app.cli import enrolled_import_command, enrolled_import_options
from tests.enrolled_helpers import payload_text, points_payload, student


async def _count(db) -> int:
    return await db.scalar(select(func.count()).select_from(EnrolledStudentPoint))


def test_literals_match_the_table_constants():
    from typing import get_args

    from app.admissions.enrolled.importer import EnrolledStudentIn

    fields = EnrolledStudentIn.model_fields
    assert get_args(fields["grade"].annotation) == ENROLLED_GRADES
    assert get_args(fields["match_level"].annotation) == ENROLLED_LEVELS
    assert get_args(get_args(fields["unlocated_reason"].annotation)[0]) == ENROLLED_REASONS


async def test_replace_roster_swaps_the_whole_campus(db_session):
    await replace_roster(db_session, load_payload(payload_text(points_payload([student(), student(grade="中班")]))))
    await db_session.commit()
    assert await _count(db_session) == 2
    total, placed = await replace_roster(
        db_session,
        load_payload(payload_text(points_payload([student(match_level="street", lat=None, lng=None)], roster_date="2026-11-01"))),
    )
    await db_session.commit()
    assert (total, placed) == (1, 0)
    assert await _count(db_session) == 1
    roster = await db_session.get(EnrolledRoster, "yihua")
    assert (roster.total, roster.roster_date.isoformat()) == (1, "2026-11-01")


async def test_clear_roster(db_session):
    await replace_roster(db_session, load_payload(payload_text(points_payload())))
    await db_session.commit()
    assert await clear_roster(db_session, "yihua") is True
    await db_session.commit()
    assert await _count(db_session) == 0
    assert await clear_roster(db_session, "yihua") is False


@pytest.mark.parametrize(
    "payload",
    [
        points_payload([student(address="高雄市三民區秘密路9號")]),
        points_payload(note="x"),
        points_payload([student(grade="小一")]),
        points_payload([student(match_level="pending")]),
        points_payload([student(match_level="street")]),
        points_payload([student(lat=None, lng=None)]),
        points_payload([student(lng=None)]),
        points_payload([student(lat=25.033, lng=121.565)]),
        points_payload([student(lat=22.6424)]),
        points_payload([student(unlocated_reason="anonymized")]),
        points_payload(campus_key="nowhere"),
        points_payload(format="ivy-enrolled-points/2"),
        points_payload([]),
    ],
)
def test_bad_payloads_are_rejected(payload):
    with pytest.raises(ValidationError):
        load_payload(payload_text(payload))


def test_error_description_never_echoes_input_values():
    with pytest.raises(ValidationError) as caught:
        load_payload(payload_text(points_payload([student(address="高雄市三民區秘密路9號")])))
    text = describe_error(caught.value)
    assert "students.0.address" in text
    assert "秘密路" not in text


def test_cli_options(tmp_path):
    file = tmp_path / "points.json"
    file.write_text("{}", encoding="utf-8")
    assert enrolled_import_options(["--file", str(file)]) == {"file": file, "clear": None}
    assert enrolled_import_options(["--clear", "--campus", "yihua"]) == {"file": None, "clear": "yihua"}
    for args in ([], ["--file", "/no/such.json"], ["--clear", "--campus", "nowhere"], ["--clear"]):
        with pytest.raises(SystemExit):
            enrolled_import_options(args)


@pytest.fixture
def cli_db(app, monkeypatch):
    async def session_factory():
        return app.state.session_factory

    monkeypatch.setattr(cli, "_session_factory", session_factory)
    monkeypatch.setattr(cli, "get_settings", lambda: app.state.settings)


async def test_cli_import_then_a_bad_file_keeps_the_old_data(db_session, cli_db, tmp_path, capsys):
    good = tmp_path / "good.json"
    good.write_text(payload_text(points_payload([student(), student(grade="大班")])), encoding="utf-8")
    await enrolled_import_command(file=good, clear=None)
    assert "匯入 yihua：2 位（有點 2 位），清冊日期 2026-10-15" in capsys.readouterr().out
    bad = tmp_path / "bad.json"
    bad.write_text(payload_text(points_payload([student(address="高雄市三民區秘密路9號")])), encoding="utf-8")
    with pytest.raises(SystemExit) as caught:
        await enrolled_import_command(file=bad, clear=None)
    assert caught.value.code == 1
    err = capsys.readouterr().err
    assert "沒有匯入" in err and "秘密路" not in err
    assert await _count(db_session) == 2


async def test_cli_clear(db_session, cli_db, tmp_path, capsys):
    good = tmp_path / "good.json"
    good.write_text(payload_text(points_payload()), encoding="utf-8")
    await enrolled_import_command(file=good, clear=None)
    await enrolled_import_command(file=None, clear="yihua")
    assert "已刪除 yihua 的在籍學生資料" in capsys.readouterr().out
    assert await _count(db_session) == 0
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd $WT/backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_enrolled1015_test uv run pytest tests/test_enrolled_import.py -q`
Expected：FAIL，`ModuleNotFoundError: No module named 'app.admissions.enrolled.importer'`。

- [ ] **Step 3: 實作 importer.py**

`backend/app/admissions/enrolled/importer.py`：

```python
"""匯入本機比對產生的去識別 JSON（2026-10-15 規格 §3.5）。多出任何欄位（例如不小心帶到地址）整份拒絕，
錯誤訊息只寫欄位位置與錯誤種類、不印輸入值；同一校整批取代，在呼叫端的單一交易內完成。"""
from __future__ import annotations

import logging
from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import constants
from app.admissions.enrolled.models import POINT_LEVELS, EnrolledRoster, EnrolledStudentPoint
from app.admissions.geo.kaohsiung import in_kaohsiung
from app.campuses.models import CAMPUS_KEYS

logger = logging.getLogger("app.admissions.enrolled")


class EnrolledStudentIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    grade: Literal["幼幼班", "小班", "中班", "大班", "其他"]
    district: str | None = Field(default=None, max_length=8)
    village: str | None = Field(default=None, max_length=16)
    match_level: Literal["exact", "nearby", "street", "district", "unlocated"]
    unlocated_reason: Literal["no_address", "outside_kaohsiung", "no_doorplate", "ambiguous_village"] | None = None
    lat: Decimal | None = Field(default=None, max_digits=6, decimal_places=3)
    lng: Decimal | None = Field(default=None, max_digits=7, decimal_places=3)

    @model_validator(mode="after")
    def _point_rules(self) -> EnrolledStudentIn:
        has_lat, has_lng = self.lat is not None, self.lng is not None
        if has_lat != has_lng:
            raise ValueError("lat 與 lng 要一起有或一起沒有")
        if (self.match_level in POINT_LEVELS) != has_lat:
            raise ValueError("只有 exact、nearby 有座標，而且一定要有")
        if has_lat and not in_kaohsiung(float(self.lat), float(self.lng)):
            raise ValueError("座標不在高雄市範圍內")
        return self


class EnrolledRosterIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    format: Literal["ivy-enrolled-points/1"]
    campus_key: str
    roster_date: date
    school_year: int = Field(ge=constants.SCHOOL_YEAR_MIN, le=constants.SCHOOL_YEAR_MAX)
    doorplate_version: str = Field(min_length=1, max_length=16)
    students: list[EnrolledStudentIn] = Field(min_length=1, max_length=5000)

    @field_validator("campus_key")
    @classmethod
    def _known_campus(cls, value: str) -> str:
        if value not in CAMPUS_KEYS:
            raise ValueError("沒有這個校區")
        return value


def load_payload(text: str) -> EnrolledRosterIn:
    """JSON 文字直接給 pydantic 解析（數字照原文轉 Decimal，小數位數才驗得準）。"""
    return EnrolledRosterIn.model_validate_json(text)


def describe_error(error: ValidationError) -> str:
    """只列欄位位置與錯誤種類（前 5 個），不印輸入值：檔案裡可能混進地址。"""
    parts = [f"{'.'.join(str(part) for part in item['loc']) or '(整份)'}：{item['type']}" for item in error.errors()[:5]]
    more = len(error.errors()) - len(parts)
    return "；".join(parts) + (f"；另有 {more} 個錯誤" if more > 0 else "")


async def replace_roster(db: AsyncSession, payload: EnrolledRosterIn) -> tuple[int, int]:
    """整批取代該校清冊（刪清冊列，資料庫 ON DELETE CASCADE 帶走舊的點）；回 (人數, 有點人數)。呼叫端 commit。"""
    await db.execute(delete(EnrolledRoster).where(EnrolledRoster.campus_key == payload.campus_key))
    db.add(
        EnrolledRoster(
            campus_key=payload.campus_key, roster_date=payload.roster_date, school_year=payload.school_year,
            doorplate_version=payload.doorplate_version, total=len(payload.students),
        )
    )
    await db.flush()
    db.add_all(EnrolledStudentPoint(campus_key=payload.campus_key, **item.model_dump()) for item in payload.students)
    await db.flush()
    placed = sum(1 for item in payload.students if item.lat is not None)
    logger.info(
        "在籍學生清冊已匯入：%s，%d 位（有點 %d 位），清冊日期 %s",
        payload.campus_key, len(payload.students), placed, payload.roster_date.isoformat(),
    )
    return len(payload.students), placed


async def clear_roster(db: AsyncSession, campus_key: str) -> bool:
    """刪除該校清冊與所有點；本來就沒有回 False。呼叫端 commit。"""
    result = await db.execute(delete(EnrolledRoster).where(EnrolledRoster.campus_key == campus_key))
    return bool(result.rowcount)
```

- [ ] **Step 4: cli.py 加 `enrolled-import`**

接在 `enrolled_match_command` 之後：

```python
def enrolled_import_options(args: list[str]) -> dict:
    """`enrolled-import` 的參數（2026-10-15 在籍學生規格 §3.5）。"""
    from app.campuses.models import CAMPUS_KEYS

    usage = "用法：python -m app.cli enrolled-import --file <JSON>｜enrolled-import --clear --campus <校區>"
    if len(args) == 2 and args[0] == "--file":
        path = Path(args[1])
        if not path.is_file():
            raise SystemExit(f"找不到檔案：{path}")
        return {"file": path, "clear": None}
    if len(args) == 3 and args[0] == "--clear" and args[1] == "--campus":
        if args[2] not in CAMPUS_KEYS:
            raise SystemExit(f"沒有這個校區：{args[2]}")
        return {"file": None, "clear": args[2]}
    raise SystemExit(usage)


async def enrolled_import_command(*, file: Path | None, clear: str | None) -> None:
    from pydantic import ValidationError

    from app.admissions.enrolled.importer import clear_roster, describe_error, load_payload, replace_roster

    factory = await _session_factory()
    if clear is not None:
        async with factory() as db:
            removed = await clear_roster(db, clear)
            await db.commit()
        print(f"已刪除 {clear} 的在籍學生資料" if removed else f"{clear} 本來就沒有在籍學生資料")
        return
    assert file is not None
    try:
        payload = load_payload(file.read_text(encoding="utf-8"))
    except ValidationError as error:
        print(f"檔案格式不對，沒有匯入：{describe_error(error)}", file=sys.stderr)
        raise SystemExit(1) from None
    except UnicodeDecodeError:
        print("檔案不是 UTF-8，沒有匯入", file=sys.stderr)
        raise SystemExit(1) from None
    async with factory() as db:
        total, placed = await replace_roster(db, payload)
        await db.commit()
    print(f"匯入 {payload.campus_key}：{total} 位（有點 {placed} 位），清冊日期 {payload.roster_date.isoformat()}")
```

`main()` 的 usage 字串再加一段 `"|enrolled-import --file <JSON>|enrolled-import --clear --campus <key>"`。

`main()` 加分支：

```python
    elif command == "enrolled-import":
        asyncio.run(enrolled_import_command(**enrolled_import_options(sys.argv[2:])))
```

- [ ] **Step 5: 跑測試確認通過**

Run: `cd $WT/backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_enrolled1015_test uv run pytest tests/test_enrolled_import.py tests/test_enrolled_match.py -q`
Expected：全部 PASS。

- [ ] **Step 6: Commit**

```bash
cd $WT
git add backend/app/admissions/enrolled/importer.py backend/app/cli.py backend/tests/test_enrolled_import.py
git commit -m "feat(admissions): enrolled-import 匯入去識別 JSON、整校取代或刪除

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 查詢 API `GET /admin/admissions/area/enrolled`

**Files:**
- Create: `backend/app/admissions/enrolled/query.py`
- Modify: `backend/app/admissions/schemas.py`（檔尾加 `AreaEnrolled*Out`）
- Modify: `backend/app/admissions/routes.py`（import 區加 `enrolled_query` 與 `AreaEnrolledOut`；在 `/area/boundaries` 端點之前加新端點）
- Modify: `contracts/openapi.json`、`contracts/generated/website-api.d.ts`（重產）
- Test: `backend/tests/test_admissions_enrolled.py`

**Interfaces:**
- Consumes：`EnrolledRoster`、`EnrolledStudentPoint`、`ENROLLED_GRADES`（Task 1）；`replace_roster`、`load_payload`（Task 5，測試用）；`area.distance_band`、`area.DISTANCE_BANDS`、`geo.boundaries.village_code`、`geo.models.VILLAGE_LEVELS`、`projection.haversine_m`；`matcher.campus_point`（**用模組屬性呼叫**，測試會 monkeypatch）。
- Produces：
  - `async query.query_enrolled(db, campus_key) -> dict`
  - 回應型別 `AreaEnrolledOut`，欄位見 Step 3。`unplaced` 每一項是 `{reason, counts}`，`counts` 依班別分開，讓前端可以依篩選加總。

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_admissions_enrolled.py`：

```python
"""在籍學生分布 API（2026-10-15 規格 §5）。"""
from __future__ import annotations

import pytest

from app.admissions.enrolled.importer import load_payload, replace_roster
from app.admissions.geo import boundaries, matcher
from app.main import create_app
from tests.admissions_area_helpers import AREA
from tests.admissions_helpers import readonly_yihua_client, reception_yihua_client  # noqa: F401
from tests.conftest import _logged_in_client, _test_settings
from tests.enrolled_helpers import payload_text, points_payload, student

ENROLLED = f"{AREA}/enrolled"
YIHUA_LAT, YIHUA_LNG = 22.6424556, 120.3437133
ZERO = {"幼幼班": 0, "小班": 0, "中班": 0, "大班": 0, "其他": 0}


@pytest.fixture
def located_campus(monkeypatch):
    async def located(db, campus_key):
        return matcher.CampusPoint(campus_key=campus_key, lat=YIHUA_LAT, lng=YIHUA_LNG, locate_error=None, district="三民區")

    monkeypatch.setattr(matcher, "campus_point", located)


async def _seed(db, students=None) -> None:
    students = students or [
        student(grade="小班"),  # (22.642, 120.344)，約 60 m
        student(grade="中班"),  # 同一格
        student(grade="大班", district="左營區", village="新上里", lat=22.700, lng=120.300),  # 約 7.8 km
        student(grade="小班", match_level="street", lat=None, lng=None),
        student(grade="幼幼班", match_level="unlocated", unlocated_reason="outside_kaohsiung", district=None, village=None, lat=None, lng=None),
    ]
    await replace_roster(db, load_payload(payload_text(points_payload(students))))
    await db.commit()


async def test_not_imported(admin_client, located_campus):
    response = await admin_client.get(f"{ENROLLED}?campus_key=yihua")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "not_imported"
    assert (body["total"], body["points"], body["grades"]) == (0, [], [])


async def test_aggregates_points_grades_unplaced_bands_and_villages(admin_client, db_session, located_campus):
    await _seed(db_session)
    response = await admin_client.get(f"{ENROLLED}?campus_key=yihua")
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store"
    body = response.json()
    assert (body["status"], body["roster_date"], body["school_year"], body["doorplate_version"], body["total"]) == (
        "ready", "2026-10-15", 115, "115-10", 5,
    )
    assert body["grades"] == [
        {"grade": "幼幼班", "total": 1, "placed": 0},
        {"grade": "小班", "total": 2, "placed": 1},
        {"grade": "中班", "total": 1, "placed": 1},
        {"grade": "大班", "total": 1, "placed": 1},
    ]
    assert body["points"] == [
        {"lat": 22.642, "lng": 120.344, "counts": {**ZERO, "小班": 1, "中班": 1}},
        {"lat": 22.7, "lng": 120.3, "counts": {**ZERO, "大班": 1}},
    ]
    assert body["unplaced"] == [
        {"reason": "street", "counts": {**ZERO, "小班": 1}},
        {"reason": "outside_kaohsiung", "counts": {**ZERO, "幼幼班": 1}},
    ]
    assert body["distance_bands"] == [
        {"band": "0-1", "counts": {**ZERO, "小班": 1, "中班": 1}},
        {"band": "1-3", "counts": ZERO},
        {"band": "3-6", "counts": ZERO},
        {"band": "6+", "counts": {**ZERO, "大班": 1}},
        {"band": "none", "counts": {**ZERO, "小班": 1, "幼幼班": 1}},
    ]
    assert body["villages"][0] == {
        "district": "三民區", "village": "本揚里", "village_code": boundaries.village_code("三民區", "本揚里"),
        "counts": {**ZERO, "小班": 2, "中班": 1}, "total": 3,
    }
    assert [(row["district"], row["village"], row["total"]) for row in body["villages"]] == [
        ("三民區", "本揚里", 3), ("左營區", "新上里", 1),
    ]


async def test_other_grade_is_listed_only_when_present(admin_client, db_session, located_campus):
    await _seed(db_session, [student(grade="其他")])
    body = (await admin_client.get(f"{ENROLLED}?campus_key=yihua")).json()
    assert body["grades"][-1] == {"grade": "其他", "total": 1, "placed": 1}


async def test_unlocated_campus_puts_everyone_in_none(admin_client, db_session, monkeypatch):
    async def unlocated(db, campus_key):
        return matcher.CampusPoint(campus_key=campus_key, lat=None, lng=None, locate_error="pending", district="三民區")

    monkeypatch.setattr(matcher, "campus_point", unlocated)
    await _seed(db_session)
    bands = {row["band"]: sum(row["counts"].values()) for row in (await admin_client.get(f"{ENROLLED}?campus_key=yihua")).json()["distance_bands"]}
    assert bands == {"0-1": 0, "1-3": 0, "3-6": 0, "6+": 0, "none": 5}


async def test_permissions(reception_yihua_client, readonly_yihua_client, minghua_client, editor_client, admin_client, public_client, located_campus):
    path = f"{ENROLLED}?campus_key="
    assert (await reception_yihua_client.get(path + "yihua")).status_code == 200
    assert (await reception_yihua_client.get(path + "minghua")).status_code == 404
    assert (await minghua_client.get(path + "yihua")).status_code == 404
    assert (await editor_client.get(path + "yihua")).status_code == 403
    assert (await readonly_yihua_client.get(path + "yihua")).status_code == 403
    assert (await admin_client.get(path + "nowhere")).status_code == 404
    assert (await public_client.get(path + "yihua")).status_code == 401


async def test_hidden_when_admissions_are_disabled():
    disabled = create_app(_test_settings().model_copy(update={"admissions_enabled": False}))
    client = await _logged_in_client(disabled, "admin@ivy.example", "super-admin-password-123")
    try:
        assert (await client.get(f"{ENROLLED}?campus_key=yihua")).status_code == 404
    finally:
        await client.aclose()
        await disabled.state.engine.dispose()
        await disabled.state.rate_limit_engine.dispose()
```

（`admin@ivy.example` 帳號由 `admin_client` fixture 建立。如果 `test_hidden_when_admissions_are_disabled` 登入失敗，照 `test_admissions_opportunity.py:258-267` 的寫法，把 `admin_client` 加進參數。）

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd $WT/backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_enrolled1015_test uv run pytest tests/test_admissions_enrolled.py -q`
Expected：FAIL，新端點回 404，或 `ModuleNotFoundError`。

- [ ] **Step 3: 實作 query、schemas 與 route**

`backend/app/admissions/enrolled/query.py`：

```python
"""在籍學生分布查詢（2026-10-15 規格 §5）：只回去識別的聚合——取整座標合併的點、各班人數、沒有點的原因、
距離帶、各里人數。距離用目前的本校座標即時算、取整 100 m（規格 E10）。"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.area import DISTANCE_BANDS, distance_band
from app.admissions.enrolled.models import ENROLLED_GRADES, EnrolledRoster, EnrolledStudentPoint
from app.admissions.geo import boundaries, matcher
from app.admissions.geo.models import VILLAGE_LEVELS
from app.admissions.geo.projection import haversine_m

UNPLACED_ORDER = ("street", "district", "outside_kaohsiung", "unlocated")


def _zero() -> dict[str, int]:
    return {grade: 0 for grade in ENROLLED_GRADES}


def _unplaced_reason(level: str, reason: str | None) -> str:
    if level in ("street", "district"):
        return level
    return "outside_kaohsiung" if reason == "outside_kaohsiung" else "unlocated"


def _empty() -> dict[str, Any]:
    return {
        "status": "not_imported", "roster_date": None, "school_year": None, "doorplate_version": None,
        "imported_at": None, "total": 0, "grades": [], "points": [], "unplaced": [], "distance_bands": [], "villages": [],
    }


async def query_enrolled(db: AsyncSession, campus_key: str) -> dict[str, Any]:
    roster = await db.get(EnrolledRoster, campus_key)
    if roster is None:
        return _empty()
    rows = (
        await db.execute(select(EnrolledStudentPoint).where(EnrolledStudentPoint.campus_key == campus_key))
    ).scalars().all()
    campus = await matcher.campus_point(db, campus_key)
    located = campus.lat is not None and campus.lng is not None

    totals, placed = _zero(), _zero()
    cells: dict[tuple[float, float], dict[str, int]] = {}
    unplaced: dict[str, dict[str, int]] = {reason: _zero() for reason in UNPLACED_ORDER}
    bands: dict[str, dict[str, int]] = {band: _zero() for band in DISTANCE_BANDS}
    villages: dict[tuple[str, str], dict[str, int]] = {}
    for row in rows:
        totals[row.grade] += 1
        point = (float(row.lat), float(row.lng)) if row.lat is not None and row.lng is not None else None
        distance: int | None = None
        if point is None:
            unplaced[_unplaced_reason(row.match_level, row.unlocated_reason)][row.grade] += 1
        else:
            placed[row.grade] += 1
            cells.setdefault(point, _zero())[row.grade] += 1
            if located:
                distance = int(round(haversine_m(campus.lat, campus.lng, point[0], point[1]) / 100.0)) * 100
        bands[distance_band(distance)][row.grade] += 1
        if row.match_level in VILLAGE_LEVELS and row.district and row.village:
            villages.setdefault((row.district, row.village), _zero())[row.grade] += 1

    village_rows = [
        {
            "district": district, "village": village, "village_code": boundaries.village_code(district, village),
            "counts": counts, "total": sum(counts.values()),
        }
        for (district, village), counts in villages.items()
    ]
    village_rows.sort(key=lambda item: (-item["total"], item["district"], item["village"]))
    return {
        "status": "ready",
        "roster_date": roster.roster_date,
        "school_year": roster.school_year,
        "doorplate_version": roster.doorplate_version,
        "imported_at": roster.imported_at,
        "total": roster.total,
        "grades": [
            {"grade": grade, "total": totals[grade], "placed": placed[grade]}
            for grade in ENROLLED_GRADES
            if grade != "其他" or totals[grade] > 0
        ],
        "points": [{"lat": lat, "lng": lng, "counts": counts} for (lat, lng), counts in sorted(cells.items())],
        "unplaced": [
            {"reason": reason, "counts": unplaced[reason]} for reason in UNPLACED_ORDER if sum(unplaced[reason].values())
        ],
        "distance_bands": [{"band": band, "counts": bands[band]} for band in DISTANCE_BANDS],
        "villages": village_rows,
    }
```

`backend/app/admissions/schemas.py` 檔尾加：

```python
# ---- 在籍學生分布（2026-10-15 規格 §5）----

EnrolledGrade = Literal["幼幼班", "小班", "中班", "大班", "其他"]
EnrolledUnplacedReason = Literal["street", "district", "outside_kaohsiung", "unlocated"]


class AreaEnrolledGradeOut(BaseModel):
    grade: EnrolledGrade
    total: int
    placed: int


class AreaEnrolledPointOut(BaseModel):
    # 取到小數 3 位（約 100 m）的格子；同一格的學生合在一起，依班別計數。
    lat: float
    lng: float
    counts: dict[EnrolledGrade, int]


class AreaEnrolledUnplacedOut(BaseModel):
    reason: EnrolledUnplacedReason
    counts: dict[EnrolledGrade, int]


class AreaEnrolledBandOut(BaseModel):
    band: DistanceBandKey
    counts: dict[EnrolledGrade, int]


class AreaEnrolledVillageOut(BaseModel):
    district: str
    village: str
    village_code: str | None
    counts: dict[EnrolledGrade, int]
    total: int


class AreaEnrolledOut(BaseModel):
    status: Literal["ready", "not_imported"]
    roster_date: date | None
    school_year: int | None
    doorplate_version: str | None
    imported_at: datetime | None
    total: int
    grades: list[AreaEnrolledGradeOut]
    points: list[AreaEnrolledPointOut]
    unplaced: list[AreaEnrolledUnplacedOut]
    distance_bands: list[AreaEnrolledBandOut]
    villages: list[AreaEnrolledVillageOut]
```

`backend/app/admissions/routes.py`：
- import 區加 `from app.admissions.enrolled import query as enrolled_query`。
- 從 `app.admissions.schemas` 的 import 清單加入 `AreaEnrolledOut`，照字母順序插入。
- 在 `/admin/admissions/area/boundaries` 端點之前加：

```python
@router.get("/admin/admissions/area/enrolled", response_model=AreaEnrolledOut)
async def get_admissions_area_enrolled(
    campus_key: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> AreaEnrolledOut:
    """在籍學生分布（2026-10-15 規格 §5）：本機比對後匯入的去識別點（取整約 100 m）、各班人數、沒有點的原因、
    距離帶與各里人數。和學年學期、半徑無關（清冊是某一天的快照）。只讀，不寫稽核；回應由中介層補 no-store。"""
    _require_campus(current_user, "admissions.read", campus_key)
    return AreaEnrolledOut.model_validate(await enrolled_query.query_enrolled(db, campus_key))
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd $WT/backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_enrolled1015_test uv run pytest tests/test_admissions_enrolled.py tests/test_admissions_area.py -q`
Expected：全部 PASS。

- [ ] **Step 5: 重產契約並檢查**

```bash
cd $WT; source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm run contract:generate; npm run contract:check
grep -n "AreaEnrolledOut" contracts/generated/website-api.d.ts | head -3
```

Expected：`contract:check` 成功；`.d.ts` 裡有 `AreaEnrolledOut`。

這個 worktree 的 `backend/.venv` 是自己的（Task 1 用 `uv sync` 建的），不會改到別人的 venv。

- [ ] **Step 6: Commit**

```bash
cd $WT
git add backend/app/admissions/enrolled/query.py backend/app/admissions/schemas.py backend/app/admissions/routes.py \
  backend/tests/test_admissions_enrolled.py contracts/openapi.json contracts/generated/website-api.d.ts
git commit -m "feat(admissions): 在籍學生分布 API（同格合併、各班人數、距離帶、各里）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: admin 的 API、型別與格式函式

**Files:**
- Modify: `admin/src/api/types.ts`（area 型別區塊末尾、`VillageProperties` 之前）
- Modify: `admin/src/api/admissions.ts`（檔頭註解與 import；`getAreaBoundaries` 之前）
- Modify: `admin/src/components/admissions/area/areaFormat.ts`（`MapMode`、`MAP_MODES`；檔尾新增在籍學生段）
- Modify: `admin/src/__tests__/admissionsTestKit.ts`（新增 `areaEnrolled()`）
- Test: `admin/src/__tests__/areaFormat.test.ts`

**Interfaces:**
- Produces：
  - 型別：`AreaEnrolled`、`AreaEnrolledPoint`、`AreaEnrolledVillage`、`EnrolledGrade`；`getAreaEnrolled(campusKey: string): Promise<AreaEnrolled>`。
  - `areaFormat`：
    - `MapMode` 多 `'enrolled'`；
    - `type GradeFilter = 'all' | EnrolledGrade`；
    - `ENROLLED_GRADE_ORDER`；
    - `pointCount(counts, filter): number`；
    - `gradeOptions(data): {value: GradeFilter; label: string}[]`；
    - `pointPopupText(counts, filter): string`；
    - `enrolledLegendText(data, filter): { lead: string; unplaced: string }`；
    - `enrolledMapNote(data: AreaEnrolled | null, failed: boolean): string`；
    - `enrolledBandRows(data)`；
    - `enrolledVillageRows(data, filter)`。
  - 測試工廠：`areaEnrolled(changes?)`。

- [ ] **Step 1: 寫測試工廠與失敗的測試**

`admin/src/__tests__/admissionsTestKit.ts`：import 區的型別清單加 `AreaEnrolled`；檔尾加：

```ts
/** 在籍學生（2026-10-15 規格 §5）：義華 5 位；第一格兩位（小班、中班），一位只對到里（小班）。 */
export function areaEnrolled(changes: Partial<AreaEnrolled> = {}): AreaEnrolled {
  const zero = { 幼幼班: 0, 小班: 0, 中班: 0, 大班: 0, 其他: 0 }
  return {
    status: 'ready',
    roster_date: '2026-10-15',
    school_year: 115,
    doorplate_version: '115-10',
    imported_at: '2026-10-15T08:00:00Z',
    total: 5,
    grades: [
      { grade: '幼幼班', total: 1, placed: 1 },
      { grade: '小班', total: 2, placed: 1 },
      { grade: '中班', total: 1, placed: 1 },
      { grade: '大班', total: 1, placed: 1 },
    ],
    points: [
      { lat: 22.642, lng: 120.344, counts: { ...zero, 小班: 1, 中班: 1 } },
      { lat: 22.65, lng: 120.35, counts: { ...zero, 幼幼班: 1 } },
      { lat: 22.7, lng: 120.3, counts: { ...zero, 大班: 1 } },
    ],
    unplaced: [{ reason: 'street', counts: { ...zero, 小班: 1 } }],
    distance_bands: [
      { band: '0-1', counts: { ...zero, 小班: 1, 中班: 1 } },
      { band: '1-3', counts: { ...zero, 幼幼班: 1 } },
      { band: '3-6', counts: { ...zero } },
      { band: '6+', counts: { ...zero, 大班: 1 } },
      { band: 'none', counts: { ...zero, 小班: 1 } },
    ],
    villages: [
      { district: '三民區', village: '本揚里', village_code: '64000050015', counts: { ...zero, 小班: 2, 中班: 1 }, total: 3 },
      { district: '三民區', village: '寶業里', village_code: '64000050025', counts: { ...zero, 幼幼班: 1 }, total: 1 },
      { district: '左營區', village: '新上里', village_code: '64000030020', counts: { ...zero, 大班: 1 }, total: 1 },
    ],
    ...changes,
  }
}
```

`admin/src/__tests__/areaFormat.test.ts`：
- import 清單補上 `enrolledBandRows, enrolledLegendText, enrolledMapNote, enrolledVillageRows, gradeOptions, pointCount, pointPopupText`；
- 從 `./admissionsTestKit` 補 `areaEnrolled`。
- 把 471–474 行那則測試改成：

```ts
  it('地圖著色多一個「在籍學生」，排在新屋交屋後面', () => {
    expect(MAP_MODES.map((mode) => mode.value)).toEqual(['visits', 'children', 'opportunity', 'trend', 'homes', 'enrolled'])
    expect(MAP_MODES.at(-1)!.label).toBe('在籍學生')
  })
```

檔尾加：

```ts
describe('在籍學生（2026-10-15 規格 §6）', () => {
  const counts = { 幼幼班: 0, 小班: 1, 中班: 1, 大班: 0, 其他: 0 }

  it('一格的人數：全部是各班加總，選一班只算那班', () => {
    expect(pointCount(counts, 'all')).toBe(2)
    expect(pointCount(counts, '小班')).toBe(1)
    expect(pointCount(counts, '大班')).toBe(0)
  })

  it('篩選選項：全部＋後端給的各班，標人數', () => {
    expect(gradeOptions(areaEnrolled()).map((option) => option.label)).toEqual(['全部 5', '幼幼班 1', '小班 2', '中班 1', '大班 1'])
    expect(gradeOptions(areaEnrolled())[0]!.value).toBe('all')
  })

  it('點的彈出框：只列大於 0 的班別；選一班只寫那班', () => {
    expect(pointPopupText(counts, 'all')).toBe('這附近 2 位：小班 1、中班 1')
    expect(pointPopupText(counts, '中班')).toBe('這附近 1 位：中班 1')
  })

  it('圖例：清冊日期、學年、地圖上幾位；沒有點的依篩選加總，0 就不寫', () => {
    expect(enrolledLegendText(areaEnrolled(), 'all')).toEqual({
      lead: '清冊 2026/10/15・115 學年班別・地圖上 4 位', unplaced: '沒有點 1 位（只對到里 1）',
    })
    expect(enrolledLegendText(areaEnrolled(), '大班')).toEqual({ lead: '清冊 2026/10/15・115 學年班別・地圖上 1 位', unplaced: '' })
    expect(enrolledLegendText(areaEnrolled(), '其他').lead).toBe('清冊 2026/10/15・115 學年班別・地圖上 0 位')
  })

  it('停用原因：讀取失敗、尚未匯入；讀取中與有資料都可以用', () => {
    expect(enrolledMapNote(null, true)).toBe('在籍學生讀取失敗。')
    expect(enrolledMapNote(areaEnrolled({ status: 'not_imported' }), false)).toBe('尚未匯入在籍名冊。')
    expect(enrolledMapNote(null, false)).toBe('')
    expect(enrolledMapNote(areaEnrolled(), false)).toBe('')
  })

  it('距離分布列：每帶一列，各班與合計；沒有座標寫出來', () => {
    const rows = enrolledBandRows(areaEnrolled())
    expect(rows.map((row) => row.band_label)).toEqual(['1 公里內', '1–3 公里', '3–6 公里', '6 公里以上', '沒有座標'])
    expect(rows[0]).toMatchObject({ 小班: 1, 中班: 1, total: 2 })
  })

  it('里排行列：依篩選算人數、0 人的里拿掉，多的排前面', () => {
    expect(enrolledVillageRows(areaEnrolled(), 'all').map((row) => [row.place, row.count])).toEqual([
      ['三民區本揚里', 3], ['三民區寶業里', 1], ['左營區新上里', 1],
    ])
    expect(enrolledVillageRows(areaEnrolled(), '小班').map((row) => [row.place, row.count])).toEqual([['三民區本揚里', 2]])
    expect(enrolledVillageRows(areaEnrolled(), '其他')).toEqual([])
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd $WT/admin; source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npx vitest run src/__tests__/areaFormat.test.ts --testTimeout=60000`
Expected：FAIL（缺 export、型別 `AreaEnrolled` 不存在）。

- [ ] **Step 3: 實作型別、API 與 areaFormat**

`admin/src/api/types.ts`，在 `AreaTrendsBirthPeriod` 那行之後加：

```ts
// 在籍學生分布（2026-10-15 規格 §5）：每格（取整約 100 m）各班人數、沒有點的原因、距離帶與各里人數。
export type AreaEnrolled = components['schemas']['AreaEnrolledOut']
export type AreaEnrolledPoint = components['schemas']['AreaEnrolledPointOut']
export type AreaEnrolledVillage = components['schemas']['AreaEnrolledVillageOut']
export type EnrolledGrade = components['schemas']['AreaEnrolledGradeOut']['grade']
```

`admin/src/api/admissions.ts`：
- 檔頭第二行的清單補上「、在籍學生 getAreaEnrolled（2026-10-15）」；
- import 型別清單加 `AreaEnrolled`；
- 在 `getAreaBoundaries` 之前加：

```ts
/** 在籍學生分布（2026-10-15 規格 §5）：只看校區（清冊是某一天的快照）；沒匯入時 status 是 not_imported。 */
export function getAreaEnrolled(campusKey: string): Promise<AreaEnrolled> {
  return api.get<AreaEnrolled>(`/admin/admissions/area/enrolled?${toQuery({ campus_key: campusKey })}`)
}
```

`admin/src/components/admissions/area/areaFormat.ts`：
- type import 清單加 `AreaEnrolled, EnrolledGrade`；
- `MapMode` 改成 `'visits' | 'children' | 'opportunity' | 'trend' | 'homes' | 'enrolled'`；
- 上方註解補「；在籍學生（2026-10-15）」；
- `MAP_MODES` 最後加 `{ value: 'enrolled', label: '在籍學生' },`。

檔尾加：

```ts
// ---- 在籍學生（2026-10-15 規格 §6）----

/** 班別篩選：全部或某一班（AreaTab 持有，地圖與下方表格同步）。 */
export type GradeFilter = 'all' | EnrolledGrade
export const ENROLLED_GRADE_ORDER: readonly EnrolledGrade[] = ['幼幼班', '小班', '中班', '大班', '其他']
type GradeCounts = Readonly<Record<string, number>>

/** 一格（或一列）依篩選的人數：全部＝各班加總。 */
export function pointCount(counts: GradeCounts, filter: GradeFilter): number {
  if (filter === 'all') return ENROLLED_GRADE_ORDER.reduce((sum, grade) => sum + (counts[grade] ?? 0), 0)
  return counts[filter] ?? 0
}

/** 篩選選項：「全部 192」＋各班（「其他」只在有人時出現，後端 grades 已照這個規則給）。 */
export function gradeOptions(data: AreaEnrolled): { value: GradeFilter; label: string }[] {
  return [
    { value: 'all', label: `全部 ${formatCount(data.total)}` },
    ...data.grades.map((item) => ({ value: item.grade, label: `${item.grade} ${formatCount(item.total)}` })),
  ]
}

/** 點的彈出框：「這附近 2 位：小班 1、中班 1」；只列大於 0 的班別，選一班時只寫那班。 */
export function pointPopupText(counts: GradeCounts, filter: GradeFilter): string {
  const grades = filter === 'all' ? ENROLLED_GRADE_ORDER : [filter]
  const parts = grades.filter((grade) => (counts[grade] ?? 0) > 0).map((grade) => `${grade} ${counts[grade]}`)
  return `這附近 ${formatCount(pointCount(counts, filter))} 位：${parts.join('、')}`
}

const UNPLACED_LABELS: Record<AreaEnrolled['unplaced'][number]['reason'], string> = {
  street: '只對到里',
  district: '只對到區',
  outside_kaohsiung: '外縣市',
  unlocated: '對不到',
}

/** 圖例：「清冊 2026/10/15・115 學年班別・地圖上 180 位」，沒有點的另起一句（依篩選加總；0 就空字串）。 */
export function enrolledLegendText(data: AreaEnrolled, filter: GradeFilter): { lead: string; unplaced: string } {
  const date = (data.roster_date ?? '').replaceAll('-', '/')
  const onMap = data.points.reduce((sum, point) => sum + pointCount(point.counts, filter), 0)
  const lead = `清冊 ${date}・${data.school_year} 學年班別・地圖上 ${formatCount(onMap)} 位`
  const parts = data.unplaced
    .map((item) => ({ label: UNPLACED_LABELS[item.reason], count: pointCount(item.counts, filter) }))
    .filter((item) => item.count > 0)
  const missing = parts.reduce((sum, item) => sum + item.count, 0)
  const unplaced = missing
    ? `沒有點 ${formatCount(missing)} 位（${parts.map((item) => `${item.label} ${formatCount(item.count)}`).join('、')}）`
    : ''
  return { lead, unplaced }
}

/** 地圖「在籍學生」停用的原因：讀取失敗或還沒匯入；可以用回空字串（讀取中也可以用，同其他模式）。 */
export function enrolledMapNote(data: AreaEnrolled | null, failed: boolean): string {
  if (failed) return '在籍學生讀取失敗。'
  return data?.status === 'not_imported' ? '尚未匯入在籍名冊。' : ''
}

const ENROLLED_BAND_LABELS: Record<string, string> = {
  '0-1': '1 公里內',
  '1-3': '1–3 公里',
  '3-6': '3–6 公里',
  '6+': '6 公里以上',
  none: '沒有座標',
}

/** 距離分布表的列：每個距離帶一列，各班人數與合計。 */
export function enrolledBandRows(data: AreaEnrolled): Record<string, string | number>[] {
  return data.distance_bands.map((item) => ({
    band: item.band,
    band_label: ENROLLED_BAND_LABELS[item.band] ?? item.band,
    ...Object.fromEntries(ENROLLED_GRADE_ORDER.map((grade) => [grade, item.counts[grade] ?? 0])),
    total: pointCount(item.counts, 'all'),
  }))
}

/** 里排行的列：依篩選算人數，0 人的里不列；人數多的在前，同數依名稱。 */
export function enrolledVillageRows(data: AreaEnrolled, filter: GradeFilter): { key: string; place: string; count: number }[] {
  return data.villages
    .map((row) => ({
      key: row.village_code ?? `${row.district}/${row.village}`,
      place: `${row.district}${row.village}`,
      count: pointCount(row.counts, filter),
    }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || (a.place < b.place ? -1 : a.place > b.place ? 1 : 0))
}
```

- [ ] **Step 4: 跑測試與型別檢查確認通過**

Run: `cd $WT/admin; source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npx vitest run src/__tests__/areaFormat.test.ts --testTimeout=60000; npm run typecheck`
Expected：測試全部 PASS。`areaMap.test.ts` 的按鈕清單斷言要到 Task 8 才改，這一步不跑它。

typecheck 若只在 `AreaMap.vue` 報 `MapMode` 窮舉相關的錯，留給 Task 8 處理；其他錯誤要在這一步修掉。

- [ ] **Step 5: Commit**

```bash
cd $WT
git add admin/src/api/types.ts admin/src/api/admissions.ts admin/src/components/admissions/area/areaFormat.ts \
  admin/src/__tests__/admissionsTestKit.ts admin/src/__tests__/areaFormat.test.ts
git commit -m "feat(admin): 在籍學生的 API、型別與格式函式

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 地圖的在籍學生點圖層與班別篩選

**Files:**
- Modify: `admin/src/components/admissions/area/AreaMap.vue`
- Modify: `admin/src/style.css`（area token 區，`--area-down-2` 之後）
- Test: `admin/src/__tests__/areaMap.test.ts`

**Interfaces:**
- Consumes：Task 7 的 `AreaEnrolled`、`AreaEnrolledPoint`、`GradeFilter`、`pointCount`、`gradeOptions`、`pointPopupText`、`enrolledLegendText`。
- Produces：
  - AreaMap 新 props：`enrolled?: AreaEnrolled | null`（預設 null）、`enrolledNote?: string`（預設 `''`）、`gradeFilter?: GradeFilter`（預設 `'all'`）。
  - 新 emit：`'update:gradeFilter': [value: GradeFilter]`。
  - 圖層：第 3 個 `layerGroup`，建立順序在幼兒園、托嬰之後。
  - 樣式 class：`area-enrolled`、`area-enrolled--multi`。

- [ ] **Step 1: 寫失敗的測試**

`admin/src/__tests__/areaMap.test.ts`：
- import 清單加 `areaEnrolled`。
- 把「五種著色…」那則（約 1819–1829 行）的標題改成「六種著色…」，按鈕清單斷言改成 `['參觀人數', '2–5 歲孩子', '招生機會', '孩子增減', '新屋交屋', '在籍學生']`。

檔尾加：

```ts
describe('在籍學生（2026-10-15 規格 §6）', () => {
  const enrolledGroup = (): any => leaflet.created.layerGroup![2]
  const enrolledMarkers = (): any[] => (leaflet.created.circleMarker ?? []).filter((marker) => String(marker.options.className).startsWith('area-enrolled'))
  async function choose(wrapper: VueWrapper, mode: string) {
    wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', mode)
    await flushPromises()
  }

  it('沒匯入時按鈕停用並寫原因；在籍學生模式中原因出現就退回參觀人數', async () => {
    const missing = await mountMap({ enrolled: areaEnrolled({ status: 'not_imported' }), enrolledNote: '尚未匯入在籍名冊。' })
    expect(missing.findAll('.el-radio-button.is-disabled').map((item) => item.text())).toEqual(['在籍學生'])
    expect(missing.get('.area-map__mode-note').text()).toBe('尚未匯入在籍名冊。')

    const ready = await mountMap({ enrolled: areaEnrolled() })
    await choose(ready, 'enrolled')
    await ready.setProps({ enrolledNote: '在籍學生讀取失敗。' })
    await flushPromises()
    expect(ready.findAll('.el-radio-button')[0]!.classes()).toContain('is-active')
  })

  it('切到在籍學生：里不上色、點圖層加到地圖；兩位以上的格畫大一級；切走就收起', async () => {
    const wrapper = await mountMap({ enrolled: areaEnrolled() })
    expect(one('map').addLayer).not.toHaveBeenCalledWith(enrolledGroup())
    await choose(wrapper, 'enrolled')
    const latest: any = leaflet.created.geoJSON!.at(-1)
    expect(latest.options.style(feature('三民區', '本揚里')).className).toBe('area-village area-village--l0')
    expect(one('map').addLayer).toHaveBeenCalledWith(enrolledGroup())
    expect(enrolledMarkers().map((marker) => [marker.latlng, marker.options.className, marker.options.radius])).toEqual([
      [[22.642, 120.344], 'area-enrolled area-enrolled--multi', 7],
      [[22.65, 120.35], 'area-enrolled', 5],
      [[22.7, 120.3], 'area-enrolled', 5],
    ])
    await choose(wrapper, 'visits')
    expect(one('map').removeLayer).toHaveBeenCalledWith(enrolledGroup())
  })

  it('班別篩選：只畫有那班的格；0 人的班別地圖上沒有點、圖例寫 0 位', async () => {
    const wrapper = await mountMap({ enrolled: areaEnrolled(), gradeFilter: '小班' })
    await choose(wrapper, 'enrolled')
    expect(enrolledMarkers().map((marker) => marker.options.className)).toEqual(['area-enrolled'])
    await wrapper.setProps({ gradeFilter: '其他' })
    await flushPromises()
    expect(enrolledGroup().clearLayers).toHaveBeenCalled()
    expect(enrolledMarkers()).toHaveLength(1) // 先前畫的那一個；其他沒有新增
    expect(wrapper.get('.area-legend--enrolled').text()).toContain('地圖上 0 位')
  })

  it('篩選鈕回報 update:gradeFilter；圖例寫清冊日期與沒有點的人數', async () => {
    const wrapper = await mountMap({ enrolled: areaEnrolled() })
    await choose(wrapper, 'enrolled')
    const groups = wrapper.findAllComponents({ name: 'ElRadioGroup' })
    expect(groups[1]!.findAll('.el-radio-button').map((item) => item.text())).toEqual(['全部 5', '幼幼班 1', '小班 2', '中班 1', '大班 1'])
    groups[1]!.vm.$emit('update:modelValue', '中班')
    expect(wrapper.emitted('update:gradeFilter')).toEqual([['中班']])
    const legend = wrapper.get('.area-legend--enrolled').text()
    expect(legend).toContain('清冊 2026/10/15・115 學年班別・地圖上 4 位')
    expect(legend).toContain('沒有點 1 位（只對到里 1）')
  })

  it('點的彈出框寫這附近幾位、各班；里的彈出框寫在籍人數', async () => {
    const wrapper = await mountMap({ enrolled: areaEnrolled() })
    await choose(wrapper, 'enrolled')
    const marker = enrolledMarkers()[0]
    expect((marker.bindPopup.mock.calls[0]![0]() as HTMLElement).textContent).toBe('這附近 2 位：小班 1、中班 1')
    const village = { bindPopup: vi.fn(), bindTooltip: vi.fn() }
    const latest: any = leaflet.created.geoJSON!.at(-1)
    latest.options.onEachFeature({ properties: { TOWNNAME: '三民區', VILLNAME: '本揚里', VILLCODE: '64000050015' } }, village)
    const popup = village.bindPopup.mock.calls[0]![0]() as HTMLElement
    expect([...popup.children].map((node) => node.textContent)).toEqual(['三民區本揚里', '在籍 3 位'])
  })

  it('顏色走 token（style.css 的 --area-enrolled），元件裡不寫色碼', () => {
    const source = readFileSync(join(__dirname, '..', 'components', 'admissions', 'area', 'AreaMap.vue'), 'utf8')
    expect(source).toContain('fill: var(--area-enrolled)')
    const style = readFileSync(join(__dirname, '..', 'style.css'), 'utf8')
    expect(style).toMatch(/--area-enrolled: var\(--admin-accent\)/)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd $WT/admin; source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npx vitest run src/__tests__/areaMap.test.ts --testTimeout=60000`
Expected：FAIL，按鈕只有五顆、`layerGroup![2]` 是 undefined。

- [ ] **Step 3: 實作**

`admin/src/style.css`，在 `--area-down-2: var(--area-chance);` 之後加：

```css
  /* 在籍學生（2026-10-15）：每格學生一個點，一律用操作藍（白邊、畫在最上層），班別用篩選切換、不另挑四色——
     地圖上已有四種幼兒園類型色、本機構金、托嬰洋紅、招生機會玫瑰，再加四色會和幼兒園圓點混在一起。 */
  --area-enrolled: var(--admin-accent);
```

`AreaMap.vue` 要改這幾處（其他不動）：

1. **import**：型別 import 加 `AreaEnrolled, AreaEnrolledPoint`。從 `./areaFormat` 的 import 加 `enrolledLegendText, gradeOptions, pointCount, pointPopupText, type GradeFilter`。

2. **props 與 emit**：props 加以下三個；`withDefaults` 的預設值加 `enrolled: null, enrolledNote: '', gradeFilter: 'all'`。

```ts
    /** 在籍學生（2026-10-15 規格 §6）；沒讀到是 null。 */
    enrolled?: AreaEnrolled | null
    /** 「在籍學生」用不了的原因；空字串＝可以用。 */
    enrolledNote?: string
    /** 在籍學生的班別篩選（AreaTab 持有，和下方表格同步）。 */
    gradeFilter?: GradeFilter
```

emit 改成：

```ts
const emit = defineEmits<{ 'open-area': [filter: { district: string; village: string }]; 'update:gradeFilter': [value: GradeFilter] }>()
```

3. **非響應式變數**：在 `babycareMarkers` 下面加：

```ts
// 在籍學生的點（2026-10-15）：只在「在籍學生」模式加到地圖上；後加的圖層畫在上面，點蓋過幼兒園。
let enrolledGroup: Leaflet.LayerGroup | null = null
```

4. **`modeNote`、`modeNotes`、`canvasLabel` 與圖例**

`modeNote` 改成：

```ts
function modeNote(value: MapMode): string {
  if (value === 'visits') return ''
  if (value === 'enrolled') return props.enrolledNote
  if (value === 'homes') return props.homesNote
  return value === 'trend' ? props.trendNote : props.opportunityNote
}
```

`modeNotes` 的陣列改成 `[props.opportunityNote, props.trendNote, props.homesNote, props.enrolledNote]`。

在 `modeLabel` 之後加：

```ts
const gradeChoices = computed(() => (props.enrolled?.status === 'ready' ? gradeOptions(props.enrolled) : []))
const enrolledLegend = computed(() =>
  props.enrolled?.status === 'ready' ? enrolledLegendText(props.enrolled, props.gradeFilter) : null,
)
const canvasLabel = computed(() => {
  if (mode.value === 'enrolled') return `${props.campusName}周邊在籍學生住處地圖（每格約 100 公尺標一點）；同樣的資料在下方的在籍學生表`
  const table = mode.value === 'visits' ? '里排行' : mode.value === 'trend' || mode.value === 'homes' ? '里的變化表' : '招生機會表'
  return `${props.campusName}周邊里界地圖（依${modeLabel.value}著色）；同樣的資料在下方的${table}與幼兒園清單`
})
```

5. **`villageClass`**：函式第一行加：

```ts
  if (mode.value === 'enrolled') return 'area-village area-village--l0'
```

6. **`villagePopup`**

`lines` 改成：

```ts
  const lines =
    mode.value === 'visits'
      ? [popupLine(row ? `參觀 ${row.visit}・預繳 ${row.deposit}（${formatRate(row.visit_to_deposit_rate)}）` : '這個範圍沒有參觀')]
      : mode.value === 'enrolled'
        ? enrolledVillageLines(properties)
        : mode.value === 'trend'
          ? trendLines(properties)
          : mode.value === 'homes'
            ? homesLines(properties)
            : opportunityLines(properties)
```

「查看明細」的條件改成 `if (mode.value !== 'enrolled' && row && row.visit > 0)`。

在 `villagePopup` 之前加：

```ts
// 在籍學生模式的里彈出框：這個里依目前篩選的在籍人數。
function enrolledVillageLines(properties: VillageProperties): HTMLParagraphElement[] {
  const row = props.enrolled?.villages.find((item) => item.village_code === properties.VILLCODE)
  const count = row ? pointCount(row.counts, props.gradeFilter) : 0
  return [popupLine(count ? `在籍 ${formatCount(count)} 位` : '這個里沒有在籍學生')]
}
```

7. **畫點**：在 `setShowBabycare` 之前加：

```ts
function enrolledPopup(point: AreaEnrolledPoint): HTMLElement {
  const root = document.createElement('div')
  root.className = 'area-popup'
  root.append(popupLine(pointPopupText(point.counts, props.gradeFilter)))
  return root
}

// 每格一個點（後端已依取整座標合併）；依篩選只畫有人的格，兩位以上畫大一級。
function drawEnrolled() {
  const group = enrolledGroup
  if (!L || !group) return
  group.clearLayers()
  for (const point of props.enrolled?.points ?? []) {
    const count = pointCount(point.counts, props.gradeFilter)
    if (count === 0) continue
    const marker = L.circleMarker([point.lat, point.lng], {
      radius: count > 1 ? 7 : 5,
      className: count > 1 ? 'area-enrolled area-enrolled--multi' : 'area-enrolled',
      weight: 1.5,
    })
    marker.bindPopup(() => enrolledPopup(point))
    group.addLayer(marker)
  }
}

function syncEnrolledLayer() {
  if (!map || !enrolledGroup) return
  if (mode.value === 'enrolled') map.addLayer(enrolledGroup)
  else map.removeLayer(enrolledGroup)
}
```

8. **`destroyMap`**：在 `babycareMarkers.clear()` 之後加 `enrolledGroup = null`。

9. **`buildMap`**：
   - 在 `if (showBabycare.value) babycareGroup.addTo(map)` 之後加 `enrolledGroup = leaflet.layerGroup()`；
   - 在 `drawBabycare()` 之後加 `drawEnrolled()` 與 `syncEnrolledLayer()`。

10. **watch**：在 `watch(() => props.babycare, drawBabycare)` 之後加：

```ts
watch([() => props.enrolled, () => props.gradeFilter], drawEnrolled)
watch(mode, syncEnrolledLayer)
```

把「正在看的模式變得用不了」那個 watch 的來源陣列補上 `() => props.enrolledNote`。

11. **template**：
    - 容器的 `:aria-label` 改成 `:aria-label="canvasLabel"`。
    - 圖例區，把 `<ul v-if="mode === 'trend'"` 改成 `v-else-if`，並在它前面加：

```vue
      <div v-if="mode === 'enrolled'" class="area-legend area-legend--enrolled">
        <el-radio-group
          v-if="gradeChoices.length"
          :model-value="gradeFilter"
          size="small"
          aria-label="在籍學生班別"
          @update:model-value="emit('update:gradeFilter', $event as GradeFilter)"
        >
          <el-radio-button v-for="option in gradeChoices" :key="option.value" :value="option.value">{{ option.label }}</el-radio-button>
        </el-radio-group>
        <p v-if="enrolledLegend" class="area-map__enrolled-note">
          <span class="area-dot area-dot--enrolled" aria-hidden="true" />{{ enrolledLegend.lead }}
        </p>
        <p v-if="enrolledLegend?.unplaced" class="area-map__enrolled-note">{{ enrolledLegend.unplaced }}</p>
      </div>
```

12. **`<style scoped>`**：在 `.area-dot--babycare` 規則之後加：

```css
.area-legend--enrolled {
  display: grid;
  flex-basis: 100%;
  gap: 6px;
}

.area-map__enrolled-note {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
}

.area-dot--enrolled { background: var(--area-enrolled); }
```

在 `.area-map :deep(.area-kg--own)` 規則之後加：

```css
.area-map :deep(.area-enrolled) {
  fill: var(--area-enrolled);
  fill-opacity: 0.85;
  stroke: var(--surface);
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd $WT/admin; source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npx vitest run src/__tests__/areaMap.test.ts src/__tests__/areaFormat.test.ts --testTimeout=60000; npm run typecheck`
Expected：全部 PASS，typecheck 沒有錯誤。

如果既有測試用 `leaflet.created.layerGroup![1]` 取托嬰時因為建立順序變了而壞掉，回頭確認 `enrolledGroup` 是在托嬰**之後**才建立。不要去改既有測試的索引。

- [ ] **Step 5: Commit**

```bash
cd $WT
git add admin/src/components/admissions/area/AreaMap.vue admin/src/style.css admin/src/__tests__/areaMap.test.ts
git commit -m "feat(admin): 區域地圖加「在籍學生」點圖層與班別篩選

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 在籍學生表與 AreaTab 接線

**Files:**
- Create: `admin/src/components/admissions/area/EnrolledPanel.vue`
- Modify: `admin/src/components/admissions/area/AreaTab.vue`
- Test: `admin/src/__tests__/areaTab.test.ts`

**Interfaces:**
- Consumes：
  - Task 7 的 `getAreaEnrolled`、`enrolledMapNote`、`enrolledBandRows`、`enrolledVillageRows`、`ENROLLED_GRADE_ORDER`、`GradeFilter`；
  - Task 8 的 AreaMap props `enrolled`、`enrolledNote` 與 `v-model:grade-filter`。
- Produces：`EnrolledPanel` props `{ data: AreaEnrolled | null; failed: boolean; gradeFilter: GradeFilter; csvName: (title: string) => string }`、emit `retry`。

- [ ] **Step 1: 寫失敗的測試**

`admin/src/__tests__/areaTab.test.ts`：
- import 清單加 `areaEnrolled`。
- AreaMap stub 的 `props` 陣列加 `'enrolled', 'enrolledNote', 'gradeFilter'`，`emits` 改成 `['open-area', 'update:gradeFilter']`。
- `routes()` 多一個參數 `enrolled: unknown = areaEnrolled()`，回傳物件加 `'/admin/admissions/area/enrolled': enrolled`（**一定要加**：mockGet 依最長前綴對應，沒加的話會拿到 `/admin/admissions/area` 的回應）。
- `mountTab` 照原樣呼叫 `routes(area, opportunity)`。

檔尾加：

```ts
describe('在籍學生（2026-10-15 規格 §6）', () => {
  it('依校區讀在籍學生（不帶學年學期）；資料與停用原因傳給地圖；表格出現', async () => {
    const { wrapper, get } = await mountTab()
    expect(Object.fromEntries(queryOf(pathsTo(get, '/admin/admissions/area/enrolled')[0]!))).toEqual({ campus_key: 'yihua' })
    const map = wrapper.findComponent({ name: 'AreaMap' })
    expect(map.props('enrolled')).toMatchObject({ status: 'ready', total: 5 })
    expect(map.props('enrolledNote')).toBe('')
    expect(map.props('gradeFilter')).toBe('all')
    expect(bodyRows(block(wrapper, '在籍學生距離分布'))[0]).toEqual(['1 公里內', '0', '1', '1', '0', '2'])
    expect(bodyRows(block(wrapper, '在籍學生里排行（全部）')).map((row) => row.slice(0, 3))).toEqual([
      ['1', '三民區本揚里', '3'], ['2', '三民區寶業里', '1'], ['3', '左營區新上里', '1'],
    ])
  })

  it('沒匯入：地圖寫尚未匯入，沒有在籍學生表', async () => {
    mockGet(routes(areaStats(), areaOpportunity(), areaEnrolled({ status: 'not_imported' })))
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    await flushPromises()
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('enrolledNote')).toBe('尚未匯入在籍名冊。')
    expect(wrapper.findAll('.stats-block__title').map((title) => title.text())).not.toContain('在籍學生距離分布')
  })

  it('地圖換班別：里排行跟著換；篩到 0 人的班別寫空狀態', async () => {
    const { wrapper } = await mountTab()
    wrapper.findComponent({ name: 'AreaMap' }).vm.$emit('update:gradeFilter', '小班')
    await flushPromises()
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('gradeFilter')).toBe('小班')
    expect(bodyRows(block(wrapper, '在籍學生里排行（小班）')).map((row) => row.slice(1, 3))).toEqual([['三民區本揚里', '2']])
    wrapper.findComponent({ name: 'AreaMap' }).vm.$emit('update:gradeFilter', '其他')
    await flushPromises()
    expect(block(wrapper, '在籍學生里排行（其他）').text()).toContain('這個班別沒有比對到里的學生')
  })

  it('換校區：篩選回到全部並重讀', async () => {
    const { wrapper, get } = await mountTab()
    wrapper.findComponent({ name: 'AreaMap' }).vm.$emit('update:gradeFilter', '小班')
    await flushPromises()
    await wrapper.setProps({ campusKey: 'minghua' })
    await flushPromises()
    expect(queryOf(pathsTo(get, '/admin/admissions/area/enrolled').at(-1)!).get('campus_key')).toBe('minghua')
    await vi.waitFor(() => expect(wrapper.findComponent({ name: 'AreaMap' }).props('gradeFilter')).toBe('all'))
  })

  it('讀取失敗：寫錯誤與重試，地圖按鈕停用；重試成功恢復', async () => {
    let fail = true
    mockGet(routes(areaStats(), areaOpportunity(), () => {
      if (fail) throw new Error('boom')
      return areaEnrolled()
    }))
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await vi.waitFor(() => expect(wrapper.find('.enrolled-error').exists()).toBe(true))
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('enrolledNote')).toBe('在籍學生讀取失敗。')
    fail = false
    await button(wrapper.get('.enrolled-error') as never, '重新載入')!.trigger('click')
    await flushPromises()
    expect(block(wrapper, '在籍學生距離分布')).toBeDefined()
  })

  it('匯出距離分布 CSV：只有聚合數字', async () => {
    const { wrapper } = await mountTab()
    await block(wrapper, '在籍學生距離分布').get('[data-test="stats-csv"]').trigger('click')
    const [filename, csv] = vi.mocked(downloadCsv).mock.calls.at(-1)!
    expect(filename).toBe('招生統計-在籍學生距離分布.csv')
    expect(csv.slice(1).split('\r\n')[0]).toBe('距本校,幼幼班,小班,中班,大班,合計')
  })
})
```

（`bodyRows(...)[0]` 的欄位順序是：距本校、幼幼班、小班、中班、大班、合計。這份測資沒有「其他」，所以不出現「其他」欄。

`StatsDimensionTable` 的 `count` 欄若把 0 顯示成別的字樣（例如「—」），以元件既有的顯示為準修改**預期值**，不要改元件。）

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd $WT/admin; source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npx vitest run src/__tests__/areaTab.test.ts --testTimeout=60000`
Expected：新的 describe FAIL，找不到在籍學生表。

- [ ] **Step 3: 實作 EnrolledPanel 與接線**

`admin/src/components/admissions/area/EnrolledPanel.vue`：

```vue
<script setup lang="ts">
import { computed } from 'vue'
import StatsDimensionTable from '../StatsDimensionTable.vue'
import type { AreaEnrolled } from '../../../api/types'
import type { StatsColumn } from '../../../admissions/statsFormat'
import { ENROLLED_GRADE_ORDER, enrolledBandRows, enrolledVillageRows, type GradeFilter } from './areaFormat'

// 在籍學生（2026-10-15 規格 §6）：距離分布（距離帶 × 班別）與里排行（跟著地圖上的班別篩選）。
// 只呈現後端的聚合數字；匯出的 CSV 也只有這些數字。
const props = defineProps<{
  data: AreaEnrolled | null
  failed: boolean
  gradeFilter: GradeFilter
  csvName: (title: string) => string
}>()
defineEmits<{ retry: [] }>()

// 里排行先列 10 個，其餘按「顯示全部」（匯出 CSV 一律是全部）。
const COLLAPSED_ROWS = 10

const grades = computed(() =>
  ENROLLED_GRADE_ORDER.filter((grade) => grade !== '其他' || props.data?.grades.some((item) => item.grade === '其他')),
)
const bandColumns = computed<StatsColumn[]>(() => [
  { key: 'band_label', label: '距本校', sticky: true },
  ...grades.value.map((grade): StatsColumn => ({ key: grade, label: grade, kind: 'count' })),
  { key: 'total', label: '合計', kind: 'count' },
])
const bandRows = computed(() => (props.data ? enrolledBandRows(props.data) : []))
const filterLabel = computed(() => (props.gradeFilter === 'all' ? '全部' : props.gradeFilter))
const VILLAGE_COLUMNS: StatsColumn[] = [
  { key: 'place', label: '里', sticky: true },
  { key: 'count', label: '人數', kind: 'bar' },
]
const villageRows = computed(() => (props.data ? enrolledVillageRows(props.data, props.gradeFilter) : []))
</script>

<template>
  <el-alert v-if="failed" class="enrolled-error" type="error" :closable="false" show-icon title="無法讀取在籍學生，請重新載入。">
    <el-button size="small" @click="$emit('retry')">重新載入</el-button>
  </el-alert>
  <div v-else-if="data && data.status === 'ready'" class="enrolled-panel">
    <StatsDimensionTable
      title="在籍學生距離分布"
      :rows="bandRows"
      :columns="bandColumns"
      row-key="band"
      empty-text="沒有在籍學生"
      :export-filename="csvName('在籍學生距離分布')"
    />
    <StatsDimensionTable
      :title="`在籍學生里排行（${filterLabel}）`"
      :rows="villageRows"
      :columns="VILLAGE_COLUMNS"
      row-key="key"
      numbered
      empty-text="這個班別沒有比對到里的學生"
      :export-filename="csvName(`在籍學生里排行-${filterLabel}`)"
      :collapsed-rows="COLLAPSED_ROWS"
    />
  </div>
</template>

<style scoped>
.enrolled-panel {
  display: grid;
  gap: 16px;
}

@media (min-width: 1200px) {
  .enrolled-panel {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    align-items: start;
  }
}
</style>
```

`AreaTab.vue` 要改這幾處：
1. **import**：
   - 加 `import EnrolledPanel from './EnrolledPanel.vue'`；
   - API import 加 `getAreaEnrolled`；
   - 型別 import 加 `AreaEnrolled`；
   - `./areaFormat` 的 import 加 `enrolledMapNote, type GradeFilter`。
2. **載入**：在 `homesNote` 之後加：

```ts
// 在籍學生（2026-10-15 規格 §6）：只依校區讀（清冊是某一天的快照，和學年學期、半徑無關）。
// 班別篩選放這裡：地圖與下方表格同步；換校區回到全部（新校不一定有同一班）。
const gradeFilter = ref<GradeFilter>('all')
const enrolled = ref<AreaEnrolled | null>(null)
const enrolledFailed = ref(false)
const enrolledRequests = useRequestSequence()
async function loadEnrolled() {
  const request = enrolledRequests.begin()
  enrolled.value = null
  enrolledFailed.value = false
  if (!props.campusKey) return
  try {
    const result = await getAreaEnrolled(props.campusKey)
    if (enrolledRequests.isCurrent(request)) enrolled.value = result
  } catch {
    if (enrolledRequests.isCurrent(request)) enrolledFailed.value = true
  }
}
watch(() => props.campusKey, () => {
  gradeFilter.value = 'all'
  void loadEnrolled()
}, { immediate: true })
const enrolledNote = computed(() => enrolledMapNote(enrolled.value, enrolledFailed.value))
```

3. **template**：
   - `<AreaMap ...>` 加 `:enrolled="enrolled"`、`:enrolled-note="enrolledNote"`、`v-model:grade-filter="gradeFilter"`。
   - 在 `<OpportunityPanel` 那行之前加：

```vue
      <EnrolledPanel
        :data="enrolled"
        :failed="enrolledFailed"
        :grade-filter="gradeFilter"
        :csv-name="csvName"
        @retry="loadEnrolled()"
      />
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd $WT/admin; source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npx vitest run src/__tests__/areaTab.test.ts src/__tests__/areaMap.test.ts src/__tests__/areaFormat.test.ts src/__tests__/areaTabChunkFailure.test.ts --testTimeout=60000; npm run typecheck`
Expected：全部 PASS，typecheck 沒有錯誤。

- [ ] **Step 5: Commit**

```bash
cd $WT
git add admin/src/components/admissions/area/EnrolledPanel.vue admin/src/components/admissions/area/AreaTab.vue admin/src/__tests__/areaTab.test.ts
git commit -m "feat(admin): 區域分析加在籍學生表，班別篩選與地圖同步

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: stack e2e

**Files:**
- Modify: `tests/stack/db.ts`（新增 `seedEnrolled`）
- Modify: `tests/stack/admissions-area.spec.ts`（新增兩則 test）

**Interfaces:**
- Consumes：Task 1 的兩張表；Task 8、Task 9 的 class 與標題（`.area-legend--enrolled`、`path.area-enrolled`、`path.area-enrolled--multi`、`在籍學生距離分布`、`在籍學生里排行（…）`）。
- Produces：`seedEnrolled(campus: string, points: readonly EnrolledSeed[], streetOnly: number): void`。

- [ ] **Step 1: 寫 seed 與測試**

`tests/stack/db.ts` 檔尾加：

```ts
export type EnrolledSeed = readonly [lat: number, lng: number, grade: '幼幼班' | '小班' | '中班' | '大班', district: string, village: string]

/**
 * 在籍學生（2026-10-15）：正式站由 CLI 匯入本機比對的 JSON；e2e 不跑 CLI，直接寫兩張表（重複執行先清掉）。
 * points 的座標在這裡取到小數 3 位；streetOnly 位只對到里（沒有點）的小班。
 */
export function seedEnrolled(campus: string, points: readonly EnrolledSeed[], streetOnly: number): void {
  const rows = [
    ...points.map(([lat, lng, grade, district, village]) =>
      `(gen_random_uuid(), :'campus', '${grade}', '${district}', '${village}', 'exact', NULL, ${lat.toFixed(3)}, ${lng.toFixed(3)})`),
    ...Array.from({ length: streetOnly }, () => `(gen_random_uuid(), :'campus', '小班', '左營區', '新上里', 'street', NULL, NULL, NULL)`),
  ]
  psql(
    `DELETE FROM enrolled_rosters WHERE campus_key = :'campus';
     INSERT INTO enrolled_rosters (campus_key, roster_date, school_year, doorplate_version, total)
     VALUES (:'campus', DATE '2026-10-15', 115, '115-10', ${rows.length});
     INSERT INTO enrolled_student_points (id, campus_key, grade, district, village, match_level, unlocated_reason, lat, lng)
     VALUES ${rows.join(',\n')};`,
    { campus },
  )
}
```

`tests/stack/admissions-area.spec.ts`：
- import 改成 `import { seedBirthSeries, seedEnrolled, seedProviderChanges } from './db'`。
- 在檔尾的 390px「移動地圖」test 之前加：

```ts
test('在籍學生：切模式畫出學生點 → 篩班別點跟著變 → 表格數字；沒匯入的校按鈕停用', async ({ browser }) => {
  test.setTimeout(90_000)
  mkdirSync(SHOTS, { recursive: true })
  const api = await adminApi('super_admin')
  const area = await api.get<{ campus: { lat: number; lng: number } }>(`/admin/admissions/area?campus_key=${CAMPUS}`)
  const { lat, lng } = area.campus
  seedEnrolled(CAMPUS, [
    [lat + 0.001, lng, '小班', '左營區', '新上里'],
    [lat + 0.001, lng, '中班', '左營區', '新上里'],
    [lat - 0.004, lng + 0.002, '大班', '左營區', '新上里'],
  ], 1)
  const { context, page } = await openAs(browser, 'super_admin')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openArea(page)

  await test.step('切到在籍學生：兩個點（一個兩位、畫大一級），圖例寫地圖上 3 位、沒有點 1 位', async () => {
    await page.locator('.area-map__modes .el-radio-button', { hasText: '在籍學生' }).click()
    await expect(page.locator('.area-map path.area-enrolled')).toHaveCount(2)
    await expect(page.locator('.area-map path.area-enrolled--multi')).toHaveCount(1)
    const legend = page.locator('.area-legend--enrolled')
    await expect(legend).toContainText('地圖上 3 位')
    await expect(legend).toContainText('沒有點 1 位（只對到里 1）')
    await page.locator('.area-top').screenshot({ path: path.join(SHOTS, 'admissions-enrolled-1440.png') })
  })

  await test.step('篩大班：只剩一個點；里排行跟著換', async () => {
    await page.locator('.area-legend--enrolled .el-radio-button', { hasText: '大班' }).click()
    await expect(page.locator('.area-map path.area-enrolled')).toHaveCount(1)
    await expect(statsBlock(page, '在籍學生里排行（大班）').locator('tbody tr')).toHaveCount(1)
  })

  await test.step('距離分布：1 公里內 3 位、沒有座標 1 位', async () => {
    const rows = statsBlock(page, '在籍學生距離分布').locator('tbody tr')
    await expect(rows.first().locator('th, td').last()).toHaveText('3')
    await expect(rows.last().locator('th, td').first()).toHaveText('沒有座標')
    await expect(rows.last().locator('th, td').last()).toHaveText('1')
  })

  await test.step('沒匯入的校：在籍學生按鈕停用並寫原因', async () => {
    await openArea(page, UNLOCATED_CAMPUS)
    await expect(page.locator('.area-map__modes .el-radio-button.is-disabled', { hasText: '在籍學生' })).toHaveCount(1)
    await expect(page.locator('.area-map__modes')).toContainText('尚未匯入在籍名冊。')
  })

  expect(errors, '頁面不該有未處理的錯誤').toEqual([])
  await Promise.all([context.close(), api.dispose()])
})

test('390px：在籍學生的模式鈕與班別篩選換行，不撐出頁面', async ({ browser }) => {
  mkdirSync(SHOTS, { recursive: true })
  const api = await adminApi('super_admin')
  const area = await api.get<{ campus: { lat: number; lng: number } }>(`/admin/admissions/area?campus_key=${CAMPUS}`)
  seedEnrolled(CAMPUS, [[area.campus.lat + 0.001, area.campus.lng, '小班', '左營區', '新上里']], 0)
  const { context, page } = await openAs(browser, 'super_admin', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await openArea(page)
  await page.locator('.area-map__modes .el-radio-button', { hasText: '在籍學生' }).click()
  await expect(page.locator('.area-legend--enrolled .el-radio-button').first()).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: path.join(SHOTS, 'admissions-enrolled-390.png'), fullPage: true })
  await Promise.all([context.close(), api.dispose()])
})
```

- [ ] **Step 2: 建置並跑這支 spec**

```bash
cd $WT; source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm run e2e:build
E2E_DB_NAME=ivy_website_enrolled1015_e2e_test E2E_API_PORT=8761 E2E_WEB_PORT=3761 caffeinate -dimsu npx playwright test -c playwright.stack.config.ts tests/stack/admissions-area.spec.ts --project=chrome
```

Expected：整支 spec PASS，包括既有的那幾則。`--project=chrome` 要放在檔名**之後**。

若失敗，先看 `output/playwright` 的截圖與 trace 判斷原因，再修實作或選擇器。不要放寬斷言。

- [ ] **Step 3: 清掉 e2e 庫並 commit**

```bash
dropdb --if-exists ivy_website_enrolled1015_e2e_test
cd $WT
git add tests/stack/db.ts tests/stack/admissions-area.spec.ts
git commit -m "test(stack): 在籍學生模式的地圖點、班別篩選與 390px 版面

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: 真實清冊本機比對與畫面確認（**只限主 session**）

這一步會讀學生個資，不能派給 subagent。產出物（去識別 JSON、截圖）不進 repo。

**Files:**
- 不改 repo 檔。輸出寫到 session scratchpad：`$SP=/private/tmp/claude-501/-Users-yilunwu-Desktop-ivy-website-admin/023bf26e-ff4c-4f62-9747-7041a427034b/scratchpad`。

- [ ] **Step 1: 建本機比對庫**

```bash
createdb ivy_website_enrolled_real_test
cd $WT/backend
export WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_enrolled_real_test \
  WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_enrolled_real_test \
  WEBSITE_SESSION_SECRET=local-only-session-secret-not-for-any-real-environment WEBSITE_ADMISSIONS_ENABLED=true
uv run alembic upgrade head; uv run python -m app.cli seed; uv run python -m app.cli initialize-content ../web/server/data/site-fixture.json
```

Bash 工具不會保留環境變數，所以每一條指令前都要把同一組 `WEBSITE_*` 寫在同一行。

- [ ] **Step 2: 下載 115-10 門牌並匯入（約 10 分鐘）**

用 `app.admissions.geo.sync.discover_doorplate_source` 找出當月的 `File/DirectDownload/<guid>`，在本機下載到 `$SP/doorplates-115-10.csv`。接著跑：

`uv run python -m app.cli geo-sync --doorplates-file $SP/doorplates-115-10.csv`

Expected：輸出「門牌：updated（使用中 115-10）」。

- [ ] **Step 3: 跑比對**

`uv run python -m app.cli enrolled-match --roster "/Users/yilunwu/Downloads/園所幼生清冊資料匯出.xls" --campus yihua --out $SP/enrolled-yihua-20261015.json`

Expected：印出報告；有點比例 ≥ 90% 才會寫出檔案。把報告**原文**貼給使用者。報告裡沒有點的學生只會印到街路名。

有點比例不到 90% 時，依報告裡沒有點的類型（街路名＋等級）找出解析規則的缺口，回到 Task 3 用 TDD 補規則（測試只寫合成地址），然後重跑這一步。

- [ ] **Step 4: 本機畫面確認**

```bash
uv run python -m app.cli enrolled-import --file $SP/enrolled-yihua-20261015.json
printf '%s\n%s\n%s\n' local-admin@ivy.example local-admin-password-123 local-admin-password-123 | uv run python -m app.cli bootstrap-admin
```

然後：
1. 起 api，指令照 `tests/stack/start-api.sh` 最後一行，port 用 8762，背景執行。
2. 起 admin，照 memory「區域分析本機示範」：admin vite dev，`ADMIN_API_INTERNAL_BASE` 指向 api。
3. 用 Playwright 登入，截義華「在籍學生」桌機 1440 與手機 390 的畫面，存到 `$WT/output/enrolled-real/`（已 gitignore）。

截圖給使用者看。看完停掉 api 與 vite。

- [ ] **Step 5: 收尾**

`dropdb ivy_website_enrolled_real_test`，刪掉 `$SP/doorplates-115-10.csv`。

`$SP/enrolled-yihua-20261015.json` 留著，上線匯入時要用。跟使用者說：這份 JSON 有取整座標，上線匯入後要刪掉。原始清冊在 Downloads，是否刪除由使用者決定。

---

### Task 12: 文件與全套驗證

**Files:**
- Modify: `deploy/README.md`（「公開地理資料同步」之後新增「在籍學生匯入」一節）
- Modify: `docs/specs/2026-10-08-admissions-area-design.md`（§10 第三點後補一行）
- Modify: `docs/specs/2026-10-15-admissions-enrolled-map-design.md`（狀態行；§3.4、§5、§8 對齊實作）
- Modify: `DESIGN.md`（招生／區域分析相關章節加一條定案）

- [ ] **Step 1: 寫文件**

`deploy/README.md` 新增一節：

```markdown
### 在籍學生匯入（2026-10-15）

清冊地址只在本機比對，正式站只收去識別 JSON（規格 `docs/specs/2026-10-15-admissions-enrolled-map-design.md`）。
1. 本機：照規格 §3.1 建比對庫（門牌版本要和正式站使用中的一樣），跑
   `python -m app.cli enrolled-match --roster <清冊 xls> --campus <key> --out <JSON>`；有點比例不到 90% 不會寫檔。
2. `! railway volume -p <project> -e <env> files -v api-volume upload <JSON> /enrolled-<key>-<日期>.json`
3. `! railway ssh --project <project> --environment <env> --service api -- python -m app.cli enrolled-import --file /data/enrolled-<key>-<日期>.json`
   （輸出「匯入 <key>：N 位（有點 M 位）」；同一校整批取代）
4. 在自己的終端機或 Railway 網頁刪掉 volume 上的 JSON（agent 刪不了；檔內有取整座標）。
刪除整校：`python -m app.cli enrolled-import --clear --campus <key>`。migration `f2a7c1e9d4b3` 只新增兩張表，不需要備份。
```

`docs/specs/2026-10-08-admissions-area-design.md` §10，在「`recruitment_visit_geo` 不存家長座標…」那一點之後加一點：

```markdown
- （2026-10-15）在籍學生分布另存取整到約 100 m 的學生座標，是使用者的裁定，只限在籍資料、訪視仍不存座標；見 `docs/specs/2026-10-15-admissions-enrolled-map-design.md` E3。
```

`docs/specs/2026-10-15-admissions-enrolled-map-design.md`，改成和實作一致：
- 狀態行改成「10-15 實作完成、本機驗證通過，待部署」。
- §3.4：有點比例不到 90% 時「不寫出檔案、結束碼 2」。
- §5：`unplaced` 每項是 `{reason, counts}`，依班別分開。
- §8 stack e2e：改成「用 `tests/stack/db.ts` 的 `seedEnrolled` 直接寫兩張表（stack 不跑 CLI；CLI 由後端測試涵蓋）」。

`DESIGN.md`：在招生統計或區域分析的章節加一條：

```markdown
- 在籍學生（2026-10-15）：地圖每格學生一個點，一律操作藍（`--area-enrolled`）、班別用篩選切換，不用四色分班（會和幼兒園類型色混淆）。
```

- [ ] **Step 2: 全套驗證**

各組依序跑，同時只跑一組：

```bash
cd $WT/backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_enrolled1015_test uv run pytest -q
cd $WT/admin; source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm run typecheck; npx vitest run --maxWorkers=2 --testTimeout=60000
cd $WT; source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm run contract:check; npm --prefix web run typecheck; npm run test:website
```

Expected：每一組都全綠。後端全套由主 session 在背景跑，subagent 等超過 10 分鐘沒有輸出會被 watchdog 終止。

有失敗時把輸出原文記下來，修好再重跑該組。

- [ ] **Step 3: Commit**

```bash
cd $WT
git add deploy/README.md docs/specs/2026-10-08-admissions-area-design.md docs/specs/2026-10-15-admissions-enrolled-map-design.md DESIGN.md
git commit -m "docs: 在籍學生分布的匯入步驟、規格對齊實作與設計定案

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: 交給使用者決定上線**

回報內容：
- commit 清單；
- 各組測試的結果數字；
- 真實清冊的命中報告；
- 截圖路徑。

部署指令給使用者用 `!` 執行：推 main（等於部署），部署後再照 deploy/README「在籍學生匯入」的步驟匯入。**不自己 push**。
