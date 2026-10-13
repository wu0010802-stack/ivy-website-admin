# 場次使用情況 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在「參觀場次」頁加「場次使用情況」頁籤：伺服器記家長打開新預約表單時最早能約哪天，並從現有場次與預約回推各時段的填滿率與判讀。

**Architecture:** 新表 `slot_lookup_daily` 存每日彙總（日×校×等待區間→次數）；`GET /public/slots` 在 `purpose=new_booking` 時順手累加一次（失敗只記 log）。新 API `GET /admin/visit-slot-usage` 一次回傳「最早能約哪天（近 4 週）」與「各時段填滿率」；admin 把 `VisitCalendarView` 改成兩個頁籤，新頁籤由獨立元件 `SlotUsagePane.vue` 負責。

**Tech Stack:** FastAPI 0.136.1（已釘版）＋SQLAlchemy 2.0 async＋Alembic＋PostgreSQL；admin 為 Vue 3＋Element Plus＋Vitest；web 為 Nuxt 4；e2e 為 Playwright stack。

**Spec:** `docs/specs/2026-10-13-visit-slot-usage-design.md`（commit `90c58fcf`）。本計畫與規格逐節對照，裁定編號 U1–U11 見規格 §1.2。

## Global Constraints

- 工作目錄一律是 worktree `/Users/yilunwu/Repositories/ivy-website-wt/visit-slot-usage-20261013`（分支 `feature/visit-slot-usage-20261013`，基準 origin/main `8c4ec20a`）；不要動 `~/Desktop/ivy-website-admin` 那份落後 main 的 checkout。
- Node 22（`.nvmrc`）；`source nvm.sh` 會 exit 3，Node 指令用分號串接、別用 `&&`。後端用 `uv run`。
- 機器 8GB RAM：同時只跑一組測試；`VITEST_MAX_FORKS=2`。subagent 跑超過 10 分鐘無輸出會被殺，後端全套 pytest 由主 session 背景跑。
- 後端 pytest 的 `WEBSITE_*` 變數要寫在同一行命令（Bash 不保留環境變數），且用**專屬測試庫** `ivy_website_slotusage1013_test`，不用共用預設庫。
- 一支 migration `b4d7e1a92c58`，`down_revision = "f3c8a2d47b19"`，**只新增表**（無 `op.execute`、無 UPDATE、無 add_column），不需部署前備份閘門。
- 計數單位寫「次」不寫「位」（U5）；只存彙總：不存 IP、User-Agent、cookie、時間點（U3）。
- 已約＝狀態 confirmed／completed／no_show（沿用 `slot_service.occupying_condition()`）；場次 `closed = false`；日期用台北時間 `today_local()`（U6、U7）。
- 判讀常數：`MIN_SLOTS = 4`、`OFTEN_FULL_SHARE = 0.5`、`RARELY_BOOKED_RATE = 0.2`（U10）；範圍 `weeks ∈ {4, 12, 26}`；「最早能約哪天」固定近 28 個台北日（U11）。
- 等待區間固定五個、固定順序：`within_1`、`days_2_3`、`days_4_7`、`over_7`、`none`。
- 公開頁外觀與回傳內容不變；`purpose` 只決定記不記。改期管理頁（`useParentVisit.ts`）不帶 `purpose`。
- 文案直白，不寫製作過程；顏色與字級走 token（`var(--ink)`、`var(--text-sm)` 等），不寫 rgba／oklch 字面值；圖一律是表格＋CSS 長條，不裝圖表套件。
- 不 commit 到 main、不 push、不部署（使用者要求才做）。commit 用 Conventional Commit、繁體中文，結尾 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`。
- 不 `git add .`／`-A`；只 add 本計畫列出的檔案。

## Review Focus

1. **只送 `purpose=new_booking` 才記**：同一支端點不帶參數（改期管理頁、舊版快取頁面）或帶其他值（422）都不能多記一筆，也不能影響回傳場次。
2. **記錄失敗不能讓家長讀不到場次**：寫入丟 `SQLAlchemyError` 時，回應仍是 200 與正確場次清單，且同一個 session 之後還能用（rollback 乾淨）。
3. **不存在、停用、非自選場次（line／phone／external／paused）的校區不記**：否則這些校區每次都會被算成「沒有場次」把次數灌高。
4. **台北日期邊界**：UTC 前一天 16:00 之後已是台北隔天；等待天數與「已經過去的場次」都以 `today_local()` 為準，不能用 UTC 日期。
5. **填滿率不超過 100%**：容量被調低到低於已約數時，填滿率仍封頂 100%，額滿仍算額滿。
6. **取消的預約不算、未到場算；關閉的場次不算；今天與未來的場次不算**。
7. **規則改過後新舊時段各自一列**：分組鍵含結束時間，不是只有開始時間。
8. **已知限制（不實作，只在此記下）**：`purpose=new_booking` 時等待天數以「回傳清單最早一筆」算，依請求的日期範圍而定；正式網頁一律送「今天到 +60 天」。有人手動用窄範圍帶 `purpose` 會被歸錯區間，這是規格 §2.2 刻意的簡化，被限流與資料量小所吸收。

## File Structure

| 檔案 | 動作 | 責任 |
|---|---|---|
| `backend/app/booking/models.py` | 修改 | 新增 `SlotLookupDaily` 與 `LOOKUP_BUCKETS` |
| `backend/migrations/versions/b4d7e1a92c58_slot_lookup_daily.py` | 新增 | 建表 `slot_lookup_daily` |
| `backend/app/booking/slot_lookup.py` | 新增 | 等待區間判斷、寫入累加、讀近 28 天彙總（寫入路徑與彙總讀取） |
| `backend/app/booking/slot_usage.py` | 新增 | 回推各時段填滿率與判讀（純計算＋查詢） |
| `backend/app/booking/schemas.py` | 修改 | `SlotUsageOut` 等回應模型 |
| `backend/app/booking/routes.py` | 修改 | `/public/slots` 加 `purpose`；新增 `/admin/visit-slot-usage` |
| `backend/tests/conftest.py` | 修改 | `_clean_tables` 加 `slot_lookup_daily` |
| `backend/tests/test_slot_lookup.py` | 新增 | 區間判斷、寫入、公開端點行為 |
| `backend/tests/test_slot_usage.py` | 新增 | 回推填滿率、判讀、API 權限與回應 |
| `backend/tests/test_slot_lookup_schema.py` | 新增 | migration 接續與只新增表 |
| `contracts/openapi.json`、`contracts/generated/website-api.d.ts` | 重產 | `npm run contract:generate` |
| `admin/src/api/types.ts` 或呼叫端型別 | 視契約 | 新 API 型別（用契約產生的型別） |
| `admin/src/utils/slotUsage.ts` | 新增 | 總結句、判讀文字、星期與時段標籤、CSV 欄位（純函式） |
| `admin/src/components/sessions/SlotUsagePane.vue` | 新增 | 新頁籤的畫面與讀取 |
| `admin/src/views/VisitCalendarView.vue` | 修改 | 加 `el-tabs`、`?tab=usage` 同步 |
| `admin/src/__tests__/slotUsage.test.ts` | 新增 | 純函式與元件、頁籤與網址同步 |
| `web/app/utils/visit-form.ts` | 修改 | 新增 `newBookingSlotsQuery()` |
| `web/app/components/VisitForm.vue` | 修改 | `loadSlots()` 改用該函式 |
| `web/tests/slot-lookup-purpose.spec.ts` | 新增 | 預約表單帶 `purpose`、管理頁不帶 |
| `tests/stack/slot-usage.spec.ts` | 新增 | 開預約頁 → 後台看到這一次 |
| `README.md`、`DESIGN.md` | 修改 | 日期段與規則；`deploy/README.md` 留到部署後 |

---

### Task 1: 資料表與 migration

**Files:**
- Modify: `backend/app/booking/models.py`（在 `VisitContactNote` 之前或檔尾加 `SlotLookupDaily`；import 區已有 `Date, Integer, String, UniqueConstraint, CheckConstraint, Index`）
- Create: `backend/migrations/versions/b4d7e1a92c58_slot_lookup_daily.py`
- Modify: `backend/tests/conftest.py:128-160`（TRUNCATE 清單加 `slot_lookup_daily`）
- Create: `backend/tests/test_slot_lookup_schema.py`

**Interfaces:**
- Produces: `app.booking.models.SlotLookupDaily`（欄位 `id: uuid`、`day: date`、`campus_key: str`、`bucket: str`、`lookups: int`；唯一約束名 `uq_slot_lookup_daily_bucket` on `(day, campus_key, bucket)`）；常數 `app.booking.models.LOOKUP_BUCKETS = ("within_1", "days_2_3", "days_4_7", "over_7", "none")`。

- [ ] **Step 1: 寫失敗的測試** — 建 `backend/tests/test_slot_lookup_schema.py`

```python
"""場次使用情況：slot_lookup_daily 的 migration 與約束（2026-10-13 規格 §2.1）。"""

from __future__ import annotations

import uuid
from datetime import date
from pathlib import Path

import pytest
from sqlalchemy import CheckConstraint, text
from sqlalchemy.exc import IntegrityError

from app.booking.models import LOOKUP_BUCKETS, SlotLookupDaily

BACKEND = Path(__file__).resolve().parents[1]
MIGRATION = BACKEND / "migrations" / "versions" / "b4d7e1a92c58_slot_lookup_daily.py"


def test_migration_follows_population_head_and_only_adds_a_table():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    script = ScriptDirectory.from_config(config)
    assert script.get_revision("b4d7e1a92c58").down_revision == "f3c8a2d47b19"
    assert script.get_heads() == ["b4d7e1a92c58"]
    upgrade = MIGRATION.read_text(encoding="utf-8").split("def upgrade()", 1)[1].split("def downgrade()", 1)[0]
    assert "op.execute" not in upgrade and "UPDATE " not in upgrade and "add_column" not in upgrade


def test_bucket_check_constraint_matches_model_and_migration():
    checks = {c.name: str(c.sqltext) for c in SlotLookupDaily.__table__.constraints if isinstance(c, CheckConstraint)}
    assert set(checks) == {"ck_slot_lookup_daily_bucket"}
    condition = checks["ck_slot_lookup_daily_bucket"]
    assert all(f"'{bucket}'" in condition for bucket in LOOKUP_BUCKETS)
    assert condition in MIGRATION.read_text(encoding="utf-8")


@pytest.mark.asyncio
async def test_unique_bucket_and_check_are_enforced(db_session):
    def row(bucket: str, lookups: int = 1) -> SlotLookupDaily:
        return SlotLookupDaily(id=uuid.uuid4(), day=date(2026, 10, 13), campus_key="yihua", bucket=bucket, lookups=lookups)

    db_session.add(row("within_1"))
    await db_session.commit()
    db_session.add(row("within_1"))
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()
    db_session.add(row("tomorrow"))
    with pytest.raises(IntegrityError):
        await db_session.commit()
    await db_session.rollback()
    assert await db_session.scalar(text("SELECT count(*) FROM slot_lookup_daily")) == 1
```

- [ ] **Step 2: 跑測試確認失敗**

先建專屬測試庫並升到目前 head（舊 head），再跑：

```bash
createdb ivy_website_slotusage1013_test 2>/dev/null; cd /Users/yilunwu/Repositories/ivy-website-wt/visit-slot-usage-20261013/backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_slotusage1013_test uv run pytest tests/test_slot_lookup_schema.py -x -q
```
Expected: FAIL（`ImportError: cannot import name 'LOOKUP_BUCKETS'`）。

- [ ] **Step 3: 加 model** — 在 `backend/app/booking/models.py` 的 `VisitContactNote` class 之前插入

```python
# 家長打開新預約表單時，最早能約的場次離今天幾天，分五個區間（2026-10-13 場次使用情況規格 §2）。
LOOKUP_BUCKETS = ("within_1", "days_2_3", "days_4_7", "over_7", "none")


class SlotLookupDaily(Base):
    """新預約表單讀場次的次數，按台北日期、校區、等待區間累計成一列。比照 page_view_daily：
    不存 IP、User-Agent、cookie 與單次時間點；campus_key 不設外鍵（校區日後停用也留著歷史）。"""

    __tablename__ = "slot_lookup_daily"
    __table_args__ = (
        UniqueConstraint("day", "campus_key", "bucket", name="uq_slot_lookup_daily_bucket"),
        CheckConstraint(
            "bucket IN ('within_1', 'days_2_3', 'days_4_7', 'over_7', 'none')",
            name="ck_slot_lookup_daily_bucket",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    day: Mapped[date_] = mapped_column(Date, nullable=False, index=True)
    campus_key: Mapped[str] = mapped_column(String(32), nullable=False)
    bucket: Mapped[str] = mapped_column(String(16), nullable=False)
    lookups: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
```

- [ ] **Step 4: 寫 migration** — 建 `backend/migrations/versions/b4d7e1a92c58_slot_lookup_daily.py`

```python
"""場次使用情況：新預約表單讀場次的每日彙總表（2026-10-13 規格 §2.1）

規格：docs/specs/2026-10-13-visit-slot-usage-design.md。只新增 slot_lookup_daily，不改既有資料，
不需要先備份正式庫。上一版程式不讀新表，先跑 migration 再換程式也相容。約束條件字串與
app/booking/models.py 逐字相同（tests/test_slot_lookup_schema.py 檢查）。

Revision ID: b4d7e1a92c58
Revises: f3c8a2d47b19
Create Date: 2026-10-13
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "b4d7e1a92c58"
down_revision = "f3c8a2d47b19"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "slot_lookup_daily",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("campus_key", sa.String(32), nullable=False),
        sa.Column("bucket", sa.String(16), nullable=False),
        sa.Column("lookups", sa.Integer(), nullable=False),
        sa.UniqueConstraint("day", "campus_key", "bucket", name="uq_slot_lookup_daily_bucket"),
        sa.CheckConstraint(
            "bucket IN ('within_1', 'days_2_3', 'days_4_7', 'over_7', 'none')",
            name="ck_slot_lookup_daily_bucket",
        ),
    )
    op.create_index("ix_slot_lookup_daily_day", "slot_lookup_daily", ["day"])


def downgrade() -> None:
    op.drop_index("ix_slot_lookup_daily_day", table_name="slot_lookup_daily")
    op.drop_table("slot_lookup_daily")
```

- [ ] **Step 5: TRUNCATE 清單加新表** — `backend/tests/conftest.py` 的 `_clean_tables`，把 `"page_view_daily, web_vital_samples, "` 改為

```python
                "page_view_daily, web_vital_samples, slot_lookup_daily, "
```

- [ ] **Step 6: 升級測試庫並跑測試**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/visit-slot-usage-20261013/backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_slotusage1013_test uv run alembic upgrade head; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_slotusage1013_test uv run pytest tests/test_slot_lookup_schema.py tests/test_geo_schema.py -q
```
Expected: 全過。若 `alembic upgrade` 抱怨 `sa.Uuid`，改用專案其他 migration 建 UUID 主鍵的寫法（`grep -n "Uuid\|UUID" backend/migrations/versions/*.py | head`）照抄。

- [ ] **Step 7: 驗證降級可逆**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/visit-slot-usage-20261013/backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_slotusage1013_test uv run alembic downgrade -1; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_slotusage1013_test uv run alembic upgrade head
```
Expected: 兩段都成功、無錯誤。

- [ ] **Step 8: Commit**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/visit-slot-usage-20261013 && git add backend/app/booking/models.py backend/migrations/versions/b4d7e1a92c58_slot_lookup_daily.py backend/tests/conftest.py backend/tests/test_slot_lookup_schema.py && git commit -m "feat(booking): 新增 slot_lookup_daily 彙總表（場次使用情況）

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 記錄「最早能約哪天」

**Files:**
- Create: `backend/app/booking/slot_lookup.py`
- Modify: `backend/app/booking/routes.py:769-822`（`list_public_slots`）
- Create: `backend/tests/test_slot_lookup.py`

**Interfaces:**
- Consumes: `SlotLookupDaily`、`LOOKUP_BUCKETS`（Task 1）；`today_local()`（`app.common.timezones`）。
- Produces（`app.booking.slot_lookup`）：
  - `def bucket_for(days: int | None) -> str` — `None` 回 `"none"`；`<=1` → `within_1`；`<=3` → `days_2_3`；`<=7` → `days_4_7`；其餘 `over_7`。
  - `async def record_lookup(db: AsyncSession, *, campus_key: str, earliest: date | None, today: date) -> None` — upsert 累加，**不 commit**。
  - `LOOKUP_WINDOW_DAYS = 28`
  - `async def lookup_summary(db, campus_key: str, today: date) -> dict` — 回傳 `{"date_from": date, "date_to": date, "first_recorded_day": date | None, "total": int, "buckets": [{"key": str, "count": int} × 5]}`（Task 3 的 API 使用）。

- [ ] **Step 1: 寫失敗的測試（區間與寫入）** — 建 `backend/tests/test_slot_lookup.py`

```python
"""場次使用情況：記錄新預約表單讀場次（2026-10-13 規格 §2）。"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.booking import slot_lookup
from app.booking.models import LOOKUP_BUCKETS, SlotLookupDaily
from app.common.timezones import today_local

from tests.conftest import create_slot, set_booking_mode

API = "/api/website/v1"


@pytest.mark.parametrize(
    ("days", "bucket"),
    [(None, "none"), (-1, "within_1"), (0, "within_1"), (1, "within_1"), (2, "days_2_3"), (3, "days_2_3"),
     (4, "days_4_7"), (7, "days_4_7"), (8, "over_7"), (60, "over_7")],
)
def test_bucket_for_boundaries(days, bucket):
    assert slot_lookup.bucket_for(days) == bucket


def test_every_bucket_is_reachable_and_known():
    seen = {slot_lookup.bucket_for(d) for d in (None, 0, 2, 4, 8)}
    assert seen == set(LOOKUP_BUCKETS)


@pytest.mark.asyncio
async def test_record_lookup_accumulates_per_day_campus_bucket(db_session):
    today = date(2026, 10, 13)
    for _ in range(3):
        await slot_lookup.record_lookup(db_session, campus_key="yihua", earliest=today + timedelta(days=2), today=today)
    await slot_lookup.record_lookup(db_session, campus_key="yihua", earliest=None, today=today)
    await slot_lookup.record_lookup(db_session, campus_key="minghua", earliest=today + timedelta(days=2), today=today)
    await db_session.commit()
    rows = {(r.campus_key, r.bucket): r.lookups for r in (await db_session.scalars(select(SlotLookupDaily))).all()}
    assert rows == {("yihua", "days_2_3"): 3, ("yihua", "none"): 1, ("minghua", "days_2_3"): 1}


@pytest.mark.asyncio
async def test_lookup_summary_has_five_ordered_buckets_and_first_recorded_day(db_session):
    today = date(2026, 10, 13)
    empty = await slot_lookup.lookup_summary(db_session, "yihua", today)
    assert [b["key"] for b in empty["buckets"]] == list(LOOKUP_BUCKETS)
    assert empty["total"] == 0 and empty["first_recorded_day"] is None
    assert empty["date_from"] == today - timedelta(days=27) and empty["date_to"] == today

    db_session.add_all([
        SlotLookupDaily(day=today - timedelta(days=40), campus_key="yihua", bucket="over_7", lookups=9),  # 窗外但算 first_recorded_day
        SlotLookupDaily(day=today - timedelta(days=27), campus_key="yihua", bucket="none", lookups=2),     # 窗內第一天
        SlotLookupDaily(day=today - timedelta(days=28), campus_key="yihua", bucket="none", lookups=5),     # 窗外
        SlotLookupDaily(day=today, campus_key="yihua", bucket="within_1", lookups=4),
        SlotLookupDaily(day=today, campus_key="minghua", bucket="within_1", lookups=7),                    # 別校
    ])
    await db_session.commit()
    summary = await slot_lookup.lookup_summary(db_session, "yihua", today)
    assert summary["first_recorded_day"] == today - timedelta(days=40)
    assert summary["total"] == 6
    assert {b["key"]: b["count"] for b in summary["buckets"]} == {"within_1": 4, "days_2_3": 0, "days_4_7": 0, "over_7": 0, "none": 2}
```

注意：`SlotLookupDaily(...)` 不帶 `id` 時靠 model 的 `default=uuid.uuid4`，Step 3 之後會過。

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/visit-slot-usage-20261013/backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_slotusage1013_test uv run pytest tests/test_slot_lookup.py -x -q
```
Expected: FAIL（`ImportError: cannot import name 'slot_lookup'`）。

- [ ] **Step 3: 實作 `backend/app/booking/slot_lookup.py`**

```python
"""新預約表單讀場次的每日彙總（場次使用情況，2026-10-13 規格 §2）。

只存「最早能約的場次離今天幾天」的區間次數：沒有 IP、裝置、cookie、時間點，也沒有任何能辨識
家長的欄位，所以計數單位是「次」（同一位家長重新整理算兩次）。寫入由 GET /public/slots 在
purpose=new_booking 時呼叫，失敗不得影響回應（見 routes.list_public_slots）。"""
from __future__ import annotations

import uuid
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.models import LOOKUP_BUCKETS, SlotLookupDaily

LOOKUP_WINDOW_DAYS = 28


def bucket_for(days: int | None) -> str:
    """最早能約的場次離今天幾天 → 區間；None＝整段沒有場次。"""
    if days is None:
        return "none"
    if days <= 1:
        return "within_1"
    if days <= 3:
        return "days_2_3"
    if days <= 7:
        return "days_4_7"
    return "over_7"


async def record_lookup(db: AsyncSession, *, campus_key: str, earliest: date | None, today: date) -> None:
    """累加一次。不 commit：呼叫端決定交易邊界。"""
    days = None if earliest is None else (earliest - today).days
    stmt = insert(SlotLookupDaily).values(
        id=uuid.uuid4(), day=today, campus_key=campus_key, bucket=bucket_for(days), lookups=1
    )
    await db.execute(
        stmt.on_conflict_do_update(
            constraint="uq_slot_lookup_daily_bucket", set_={"lookups": SlotLookupDaily.lookups + 1}
        )
    )


async def lookup_summary(db: AsyncSession, campus_key: str, today: date) -> dict:
    """近 LOOKUP_WINDOW_DAYS 個台北日（含今天）的各區間次數；first_recorded_day 是這個校區最早有紀錄的那天（全期）。"""
    date_from = today - timedelta(days=LOOKUP_WINDOW_DAYS - 1)
    rows = await db.execute(
        select(SlotLookupDaily.bucket, func.sum(SlotLookupDaily.lookups))
        .where(SlotLookupDaily.campus_key == campus_key, SlotLookupDaily.day >= date_from, SlotLookupDaily.day <= today)
        .group_by(SlotLookupDaily.bucket)
    )
    counts = {bucket: int(total) for bucket, total in rows.all()}
    first = await db.scalar(select(func.min(SlotLookupDaily.day)).where(SlotLookupDaily.campus_key == campus_key))
    buckets = [{"key": key, "count": counts.get(key, 0)} for key in LOOKUP_BUCKETS]
    return {
        "date_from": date_from,
        "date_to": today,
        "first_recorded_day": first,
        "total": sum(item["count"] for item in buckets),
        "buckets": buckets,
    }
```

- [ ] **Step 4: 跑測試確認通過**

同 Step 2 的指令。Expected: 全過。

- [ ] **Step 5: 寫失敗的端點測試** — 附加在 `backend/tests/test_slot_lookup.py` 檔尾

```python
async def _lookups(db_session) -> dict[tuple[str, str], int]:
    await db_session.rollback()  # 結束舊交易，才讀得到端點剛提交的列
    return {(r.campus_key, r.bucket): r.lookups for r in (await db_session.scalars(select(SlotLookupDaily))).all()}


def _range(days: int = 60) -> str:
    return f"date_from={today_local().isoformat()}&date_to={(today_local() + timedelta(days=days)).isoformat()}"


@pytest.mark.asyncio
async def test_new_booking_purpose_records_one_lookup_with_earliest_bucket(admin_client, public_client, db_session):
    await create_slot(admin_client, days_ahead=5)
    await create_slot(admin_client, days_ahead=20, start_time="14:00:00", end_time="15:00:00")
    assert (await set_booking_mode(admin_client, mode="slots")).status_code == 200
    response = await public_client.get(f"{API}/public/slots?campus_key=yihua&{_range()}&purpose=new_booking")
    assert response.status_code == 200
    assert [s["slot_date"] for s in response.json()] == sorted(s["slot_date"] for s in response.json())
    assert await _lookups(db_session) == {("yihua", "days_4_7"): 1}
    await public_client.get(f"{API}/public/slots?campus_key=yihua&{_range()}&purpose=new_booking")
    assert await _lookups(db_session) == {("yihua", "days_4_7"): 2}


@pytest.mark.asyncio
async def test_no_slots_at_all_records_none(admin_client, public_client, db_session):
    await create_slot(admin_client, days_ahead=58)  # 讓 slots 模式能啟用，但查詢範圍只到 +10 天
    assert (await set_booking_mode(admin_client, mode="slots")).status_code == 200
    response = await public_client.get(f"{API}/public/slots?campus_key=yihua&{_range(10)}&purpose=new_booking")
    assert response.status_code == 200 and response.json() == []
    assert await _lookups(db_session) == {("yihua", "none"): 1}


@pytest.mark.asyncio
async def test_without_purpose_or_with_other_value(admin_client, public_client, db_session):
    await create_slot(admin_client, days_ahead=5)
    assert (await set_booking_mode(admin_client, mode="slots")).status_code == 200
    plain = await public_client.get(f"{API}/public/slots?campus_key=yihua&{_range()}")
    assert plain.status_code == 200 and len(plain.json()) == 1
    assert await _lookups(db_session) == {}
    bad = await public_client.get(f"{API}/public/slots?campus_key=yihua&{_range()}&purpose=reschedule")
    assert bad.status_code == 422
    assert await _lookups(db_session) == {}


@pytest.mark.asyncio
async def test_purpose_does_not_change_the_response(admin_client, public_client):
    await create_slot(admin_client, days_ahead=5)
    assert (await set_booking_mode(admin_client, mode="slots")).status_code == 200
    plain = await public_client.get(f"{API}/public/slots?campus_key=yihua&{_range()}")
    tagged = await public_client.get(f"{API}/public/slots?campus_key=yihua&{_range()}&purpose=new_booking")
    assert plain.json() == tagged.json()


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["line", "phone", "paused"])
async def test_non_slots_campus_is_not_recorded(admin_client, public_client, db_session, mode):
    extra = {"line": {"line_url": "https://line.me/R/ti/p/@ivy"}, "phone": {"phone": "07-3928366"}, "paused": {}}[mode]
    assert (await set_booking_mode(admin_client, mode=mode, **extra)).status_code == 200
    response = await public_client.get(f"{API}/public/slots?campus_key=yihua&{_range()}&purpose=new_booking")
    assert response.status_code == 200
    assert await _lookups(db_session) == {}


@pytest.mark.asyncio
async def test_unknown_and_deactivated_campus_are_not_recorded(admin_client, public_client, db_session):
    unknown = await public_client.get(f"{API}/public/slots?campus_key=nowhere&{_range()}&purpose=new_booking")
    assert unknown.status_code == 200 and unknown.json() == []
    from sqlalchemy import update
    from app.campuses.models import Campus

    await db_session.execute(update(Campus).where(Campus.key == "renwu").values(active=False))
    await db_session.commit()
    stopped = await public_client.get(f"{API}/public/slots?campus_key=renwu&{_range()}&purpose=new_booking")
    assert stopped.status_code == 200 and stopped.json() == []
    assert await _lookups(db_session) == {}


@pytest.mark.asyncio
async def test_recording_failure_still_returns_the_slots_and_keeps_the_session_usable(
    admin_client, public_client, db_session, monkeypatch
):
    from sqlalchemy.exc import OperationalError

    await create_slot(admin_client, days_ahead=5)
    assert (await set_booking_mode(admin_client, mode="slots")).status_code == 200

    async def boom(*args, **kwargs):
        raise OperationalError("INSERT", {}, Exception("connection lost"))

    monkeypatch.setattr(slot_lookup, "record_lookup", boom)
    response = await public_client.get(f"{API}/public/slots?campus_key=yihua&{_range()}&purpose=new_booking")
    assert response.status_code == 200 and len(response.json()) == 1
    monkeypatch.undo()
    # 之後的請求照常記（沒有被上一次的失敗卡住）。
    again = await public_client.get(f"{API}/public/slots?campus_key=yihua&{_range()}&purpose=new_booking")
    assert again.status_code == 200
    assert sum((await _lookups(db_session)).values()) == 1


@pytest.mark.asyncio
async def test_lookup_day_and_wait_come_from_the_routes_taipei_today(admin_client, public_client, db_session, monkeypatch):
    """記錄的日期與等待天數都取自路由的 today_local()（台北時間），不是 UTC 日期或 date.today()。"""
    from app.booking import routes as booking_routes

    await create_slot(admin_client, days_ahead=3)
    assert (await set_booking_mode(admin_client, mode="slots")).status_code == 200
    slot_date = (today_local() + timedelta(days=3))
    # 假裝台北今天是「場次日期 − 1 天」→ 最早場次離今天 1 天，記在 within_1，記錄日期是假的今天。
    fake_today = slot_date - timedelta(days=1)
    monkeypatch.setattr(booking_routes, "today_local", lambda *a, **k: fake_today)
    response = await public_client.get(
        f"{API}/public/slots?campus_key=yihua&date_from={today_local().isoformat()}&date_to={slot_date.isoformat()}&purpose=new_booking"
    )
    assert response.status_code == 200
    rows = await db_session.scalars(select(SlotLookupDaily))
    got = [(r.day, r.bucket) for r in rows.all()]
    assert got == [(fake_today, "within_1")]
```

說明：`public_client`／`admin_client`／`create_slot`／`set_booking_mode` 都在 `tests/conftest.py`；`set_booking_mode` 對 `line`／`phone` 需要的欄位若與上面不同，照 `tests/test_booking_modes.py` 的呼叫方式調整。`test_lookup_uses_taipei_today_not_utc` 會讓 `is_publicly_bookable` 仍以真實時間判斷場次（只有 `routes.today_local` 被換掉），因此場次離「假今天」的天數在這個測試裡是 1。

- [ ] **Step 6: 跑端點測試確認失敗**

同 Step 2 的指令。Expected: FAIL（`purpose` 參數還不存在：帶 `purpose` 的請求 200 但沒有記錄；`reschedule` 值回 200 而非 422）。

- [ ] **Step 7: 修改 `backend/app/booking/routes.py`**

(a) import 區：`from sqlalchemy.exc import SQLAlchemyError` 已有。`from typing import Literal` 若檔內尚未 import，加在最上面的標準庫 import 區。把 `slot_service,` 那組 import 的 `from app.booking import (...)` 清單加入 `slot_lookup,`（按字母序放在 `service,` 與 `slot_service,` 之間）。

(b) 把 `list_public_slots` 簽名與函式尾端改成（只列變動處）：

```python
@router.get("/public/slots", response_model=list[PublicVisitSlotOut])
async def list_public_slots(
    campus_key: str,
    request: Request,
    date_from: date = Query(...),
    date_to: date = Query(...),
    purpose: Literal["new_booking"] | None = Query(default=None),
    db: AsyncSession = Depends(get_db_session),
) -> list[PublicVisitSlotOut]:
```

函式內原本的 `result = [] ... return result` 改成：

```python
    result = []
    for slot in bookable:
        remaining = max(slot.capacity - booked_by_slot.get(slot.id, 0), 0)
        if remaining <= 0:
            continue
        result.append(
            PublicVisitSlotOut(
                id=slot.id,
                slot_date=slot.slot_date,
                start_time=slot.start_time,
                end_time=slot.end_time,
                remaining=remaining,
            )
        )
    # 場次使用情況（2026-10-13）：新預約表單讀場次時記一次「最早能約哪天」。只有校區存在且 active（停用的
    # 上面已回空清單）、預約方式是自選場次才記；失敗只記 log，不能讓家長讀不到場次。
    if purpose == "new_booking" and campus is not None and config is not None and config.mode == BookingMode.SLOTS:
        today = today_local()
        earliest = min((s.slot_date for s in result), default=None)
        try:
            await slot_lookup.record_lookup(db, campus_key=campus_key, earliest=earliest, today=today)
            await db.commit()
        except SQLAlchemyError:
            await db.rollback()
            logger.warning("record slot lookup failed", exc_info=True)
    return result
```

注意：`result` 是 pydantic 物件，commit／rollback 不影響它；`campus`、`config` 在此之後不再讀取。

- [ ] **Step 8: 跑端點測試與既有公開場次測試**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/visit-slot-usage-20261013/backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_slotusage1013_test uv run pytest tests/test_slot_lookup.py tests/test_secfix_booking.py tests/test_visit_schedule.py tests/test_visit_workflow.py -q
```
Expected: 全過（既有測試不帶 `purpose`，行為不變）。

- [ ] **Step 9: Commit**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/visit-slot-usage-20261013 && git add backend/app/booking/slot_lookup.py backend/app/booking/routes.py backend/tests/test_slot_lookup.py && git commit -m "feat(booking): 新預約表單讀場次時記錄最早能約哪天

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 回推各時段填滿率與 API

**Files:**
- Create: `backend/app/booking/slot_usage.py`
- Modify: `backend/app/booking/schemas.py`（檔尾加回應模型）
- Modify: `backend/app/booking/routes.py`（新增 `/admin/visit-slot-usage`）
- Create: `backend/tests/test_slot_usage.py`

**Interfaces:**
- Consumes: `slot_lookup.lookup_summary`（Task 2）、`slot_service.occupying_condition()`、`require_scope`、`BookingConfig`。
- Produces（`app.booking.slot_usage`）：
  - 常數 `MIN_SLOTS = 4`、`OFTEN_FULL_SHARE = 0.5`、`RARELY_BOOKED_RATE = 0.2`、`WEEK_CHOICES = (4, 12, 26)`
  - `def signal_for(slot_count: int, full_count: int, fill_rate: float) -> str` — 回 `"too_few" | "often_full" | "rarely_booked" | "normal"`
  - `async def slot_rows(db, campus_key: str, weeks: int, today: date) -> dict` — 回 `{"weeks": int, "date_from": date, "date_to": date, "thresholds": {"min_slots": 4, "often_full_share": 0.5, "rarely_booked_rate": 0.2}, "rows": [{"weekday": int, "start_time": time, "end_time": time, "slot_count": int, "capacity_total": int, "booked": int, "fill_rate": float, "full_count": int, "signal": str}]}`
- Produces（API）：`GET /admin/visit-slot-usage?campus_key=&weeks=` → 規格 §4 的 JSON；schema 類別 `SlotUsageOut`。

- [ ] **Step 1: 寫失敗的測試（判讀函式與回推）** — 建 `backend/tests/test_slot_usage.py`

```python
"""場次使用情況：回推各時段填滿率與 API（2026-10-13 規格 §3、§4）。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone

import pytest

from app.booking import slot_lookup, slot_usage
from app.booking.models import SlotLookupDaily, VisitRequest, VisitSlot
from app.common.timezones import today_local

from tests.conftest import legacy_request

API = "/api/website/v1"


@pytest.mark.parametrize(
    ("slot_count", "full_count", "fill_rate", "expected"),
    [
        (3, 3, 1.0, "too_few"),          # 不到 4 場：全額滿也不判斷
        (4, 2, 0.9, "often_full"),       # 剛好 4 場、剛好 50% 額滿
        (4, 1, 0.9, "normal"),           # 25% 額滿、填滿率高 → 不標
        (10, 4, 0.1, "rarely_booked"),
        (10, 0, 0.2, "rarely_booked"),   # 剛好 20%
        (10, 0, 0.21, "normal"),
        (10, 5, 0.1, "often_full"),      # 兩個條件都成立時常額滿優先
    ],
)
def test_signal_for_boundaries(slot_count, full_count, fill_rate, expected):
    assert slot_usage.signal_for(slot_count, full_count, fill_rate) == expected


async def _slot(db, *, day: date, start: time = time(10, 0), end: time = time(11, 0), capacity: int = 2,
                closed: bool = False, campus: str = "yihua") -> uuid.UUID:
    slot = VisitSlot(
        id=uuid.uuid4(), campus_key=campus, slot_date=day, start_time=start, end_time=end,
        capacity=capacity, closed=closed, created_at=datetime.now(timezone.utc),
    )
    db.add(slot)
    await db.commit()
    return slot.id


async def _book(db, slot_id, status: str, n: int = 1) -> None:
    for i in range(n):
        await legacy_request(db, status=status, slot_id=slot_id, phone=f"09100{uuid.uuid4().int % 100000:05d}")


def _monday_before(today: date, weeks_back: int) -> date:
    base = today - timedelta(weeks=weeks_back)
    return base - timedelta(days=base.weekday())


@pytest.mark.asyncio
async def test_booked_counts_confirmed_completed_no_show_but_not_cancelled(db_session):
    today = today_local()
    day = _monday_before(today, 2)
    slot_id = await _slot(db_session, day=day, capacity=5)
    await _book(db_session, slot_id, "confirmed")
    await _book(db_session, slot_id, "completed")
    await _book(db_session, slot_id, "no_show")
    await _book(db_session, slot_id, "cancelled", n=2)
    out = await slot_usage.slot_rows(db_session, "yihua", 4, today)
    [row] = out["rows"]
    assert (row["weekday"], row["slot_count"], row["capacity_total"], row["booked"], row["full_count"]) == (0, 1, 5, 3, 0)
    assert row["fill_rate"] == pytest.approx(0.6)


@pytest.mark.asyncio
async def test_closed_today_future_and_other_campus_slots_are_ignored(db_session):
    today = today_local()
    past = today - timedelta(days=3)
    await _slot(db_session, day=past, closed=True)
    await _slot(db_session, day=today)
    await _slot(db_session, day=today + timedelta(days=3))
    await _slot(db_session, day=past, campus="minghua")
    out = await slot_usage.slot_rows(db_session, "yihua", 4, today)
    assert out["rows"] == []
    assert out["date_to"] == today - timedelta(days=1)
    assert out["date_from"] == today - timedelta(weeks=4)


@pytest.mark.asyncio
async def test_group_key_includes_weekday_start_and_end_time(db_session):
    today = today_local()
    day = _monday_before(today, 1)
    await _slot(db_session, day=day, start=time(10, 0), end=time(11, 0))
    await _slot(db_session, day=day, start=time(10, 0), end=time(11, 30))   # 結束時間不同 → 另一列
    await _slot(db_session, day=day + timedelta(days=1), start=time(10, 0), end=time(11, 0))  # 星期二
    out = await slot_usage.slot_rows(db_session, "yihua", 4, today)
    keys = [(r["weekday"], r["start_time"], r["end_time"]) for r in out["rows"]]
    assert keys == [(0, time(10, 0), time(11, 0)), (0, time(10, 0), time(11, 30)), (1, time(10, 0), time(11, 0))]


@pytest.mark.asyncio
async def test_fill_rate_is_capped_at_100_percent_and_still_counts_as_full(db_session):
    today = today_local()
    day = _monday_before(today, 1)
    slot_id = await _slot(db_session, day=day, capacity=1)
    await _book(db_session, slot_id, "confirmed", n=3)   # 後來把容量調低到 1，已約仍是 3
    [row] = (await slot_usage.slot_rows(db_session, "yihua", 4, today))["rows"]
    assert row["fill_rate"] == 1.0 and row["full_count"] == 1 and row["booked"] == 3


@pytest.mark.asyncio
async def test_signals_over_a_real_group(db_session):
    today = today_local()
    full_slots = []
    for week in range(1, 5):   # 四個星期一，10:00，容量 1，全部額滿
        full_slots.append(await _slot(db_session, day=_monday_before(today, week), capacity=1))
    for slot_id in full_slots:
        await _book(db_session, slot_id, "confirmed")
    for week in range(1, 5):   # 四個星期二，14:00，容量 5，只有一場約 1 個
        sid = await _slot(db_session, day=_monday_before(today, week) + timedelta(days=1), start=time(14, 0), end=time(15, 0), capacity=5)
        if week == 1:
            await _book(db_session, sid, "completed")
    rows = {r["weekday"]: r for r in (await slot_usage.slot_rows(db_session, "yihua", 12, today))["rows"]}
    assert rows[0]["signal"] == "often_full" and rows[0]["slot_count"] == 4 and rows[0]["full_count"] == 4
    assert rows[1]["signal"] == "rarely_booked" and rows[1]["fill_rate"] == pytest.approx(0.05)


@pytest.mark.asyncio
async def test_taipei_date_boundary_uses_given_today(db_session):
    """today 由呼叫端用 today_local() 傳入；傳進去的「台北今天」之前的場次才算過去。"""
    today = date(2026, 10, 13)
    await _slot(db_session, day=date(2026, 10, 12))   # 台北昨天 → 算
    await _slot(db_session, day=date(2026, 10, 13))   # 台北今天 → 不算
    out = await slot_usage.slot_rows(db_session, "yihua", 4, today)
    assert [r["slot_count"] for r in out["rows"]] == [1]
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/visit-slot-usage-20261013/backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_slotusage1013_test uv run pytest tests/test_slot_usage.py -x -q
```
Expected: FAIL（`ImportError: cannot import name 'slot_usage'`）。

- [ ] **Step 3: 實作 `backend/app/booking/slot_usage.py`**

```python
"""各時段過去坐了幾成（場次使用情況，2026-10-13 規格 §3）。

只讀 visit_slots 與 visit_requests，不改資料表。場次＝校區相符、日期在 [今天−週數×7, 昨天]、
沒有關閉；已約＝排在該場次、占名額的案件數（已確認、已完成、未到場，取消不算，沿用
slot_service.occupying_condition）。依（星期, 開始時間, 結束時間）分組，規則改過後新舊時段各成一列。"""
from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.booking import slot_service
from app.booking.models import VisitRequest, VisitSlot

WEEK_CHOICES = (4, 12, 26)
# 判讀門檻（規格 U10）：描述性門檻，不做統計檢定——場次數少，檢定沒有偵測力。
MIN_SLOTS = 4
OFTEN_FULL_SHARE = 0.5
RARELY_BOOKED_RATE = 0.2


def signal_for(slot_count: int, full_count: int, fill_rate: float) -> str:
    """too_few（不到 MIN_SLOTS 場，還不判斷）／often_full／rarely_booked／normal。兩個條件都成立時常額滿優先。"""
    if slot_count < MIN_SLOTS:
        return "too_few"
    if full_count / slot_count >= OFTEN_FULL_SHARE:
        return "often_full"
    if fill_rate <= RARELY_BOOKED_RATE:
        return "rarely_booked"
    return "normal"


async def slot_rows(db: AsyncSession, campus_key: str, weeks: int, today: date) -> dict:
    date_from = today - timedelta(weeks=weeks)
    date_to = today - timedelta(days=1)
    booked = (
        select(VisitRequest.slot_id.label("slot_id"), func.count().label("n"))
        .where(slot_service.occupying_condition())
        .group_by(VisitRequest.slot_id)
        .subquery()
    )
    booked_n = func.coalesce(booked.c.n, 0)
    result = await db.execute(
        select(VisitSlot.slot_date, VisitSlot.start_time, VisitSlot.end_time, VisitSlot.capacity, booked_n)
        .select_from(VisitSlot)
        .outerjoin(booked, booked.c.slot_id == VisitSlot.id)
        .where(
            VisitSlot.campus_key == campus_key,
            VisitSlot.slot_date >= date_from,
            VisitSlot.slot_date <= date_to,
            VisitSlot.closed.is_(False),
        )
    )
    groups: dict[tuple[int, object, object], dict] = {}
    for slot_date, start, end, capacity, n in result.all():
        key = (slot_date.weekday(), start, end)
        group = groups.setdefault(key, {"slot_count": 0, "capacity_total": 0, "booked": 0, "full_count": 0})
        group["slot_count"] += 1
        group["capacity_total"] += capacity
        group["booked"] += n
        if n >= capacity:
            group["full_count"] += 1
    rows = []
    for (weekday, start, end), group in sorted(groups.items(), key=lambda item: (item[0][0], item[0][1], item[0][2])):
        fill_rate = min(group["booked"] / group["capacity_total"], 1.0) if group["capacity_total"] else 0.0
        rows.append(
            {
                "weekday": weekday,
                "start_time": start,
                "end_time": end,
                **group,
                "fill_rate": round(fill_rate, 3),
                "signal": signal_for(group["slot_count"], group["full_count"], fill_rate),
            }
        )
    return {
        "weeks": weeks,
        "date_from": date_from,
        "date_to": date_to,
        "thresholds": {"min_slots": MIN_SLOTS, "often_full_share": OFTEN_FULL_SHARE, "rarely_booked_rate": RARELY_BOOKED_RATE},
        "rows": rows,
    }
```

說明：`round(fill_rate, 3)` 讓 JSON 好讀；測試用 `pytest.approx`。

- [ ] **Step 4: 跑測試確認通過**

同 Step 2 的指令。Expected: 全過。

- [ ] **Step 5: 寫失敗的 API 測試** — 附加在 `backend/tests/test_slot_usage.py` 檔尾

```python
URL = f"{API}/admin/visit-slot-usage"


@pytest.mark.asyncio
async def test_api_shape_for_super_admin(admin_client, db_session):
    today = today_local()
    slot_id = await _slot(db_session, day=_monday_before(today, 1), capacity=2)
    await _book(db_session, slot_id, "confirmed")
    db_session.add(SlotLookupDaily(day=today, campus_key="yihua", bucket="over_7", lookups=3))
    await db_session.commit()
    response = await admin_client.get(f"{URL}?campus_key=yihua&weeks=12")
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"campus_key", "booking_mode", "today", "lookups", "slots"}
    assert body["campus_key"] == "yihua" and body["today"] == today.isoformat()
    assert [b["key"] for b in body["lookups"]["buckets"]] == ["within_1", "days_2_3", "days_4_7", "over_7", "none"]
    assert body["lookups"]["total"] == 3 and body["lookups"]["first_recorded_day"] == today.isoformat()
    assert body["slots"]["weeks"] == 12 and body["slots"]["thresholds"] == {"min_slots": 4, "often_full_share": 0.5, "rarely_booked_rate": 0.2}
    [row] = body["slots"]["rows"]
    assert row["start_time"] == "10:00:00" and row["booked"] == 1 and row["signal"] == "too_few"


@pytest.mark.asyncio
@pytest.mark.parametrize("weeks", ["0", "5", "52", "abc"])
async def test_api_rejects_unknown_weeks(admin_client, weeks):
    response = await admin_client.get(f"{URL}?campus_key=yihua&weeks={weeks}")
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_api_requires_campus_key(admin_client):
    assert (await admin_client.get(f"{URL}?weeks=12")).status_code == 422


@pytest.mark.asyncio
async def test_api_campus_scope(minghua_client):
    assert (await minghua_client.get(f"{URL}?campus_key=minghua&weeks=4")).status_code == 200
    denied = await minghua_client.get(f"{URL}?campus_key=yihua&weeks=4")
    assert denied.status_code in (403, 404)


@pytest.mark.asyncio
async def test_api_requires_login(public_client):
    assert (await public_client.get(f"{URL}?campus_key=yihua&weeks=4")).status_code == 401


@pytest.mark.asyncio
async def test_api_reports_booking_mode(admin_client):
    from tests.conftest import set_booking_mode

    assert (await set_booking_mode(admin_client, mode="phone", phone="07-3928366")).status_code == 200
    body = (await admin_client.get(f"{URL}?campus_key=yihua&weeks=4")).json()
    assert body["booking_mode"] == "phone"
    assert body["lookups"]["first_recorded_day"] is None and body["slots"]["rows"] == []
```

說明：沒有 `booking.read` 的角色 403 的測試，需要有一個該權限以外的角色 fixture；`editor_client` 可能有 `booking.read`。若 `tests/conftest.py` 沒有現成「無 booking.read」的使用者，改成用 `has_capability` 的角色表（`app/auth/permissions.py`）確認哪個角色沒有 `booking.read`，再用 `_create_user` 建一個該角色的帳號登入後斷言 403；找不到這種角色就刪掉該測試並在 commit 說明。`minghua_client` 打無權校區的實際狀態碼，以 `GET /admin/visit-calendar?campus_key=yihua` 現有行為為準（`require_scope(..., campus_keys=[...])`）。

- [ ] **Step 6: 跑 API 測試確認失敗**

同 Step 2。Expected: FAIL（404，路由不存在）。

- [ ] **Step 7: 加回應模型** — `backend/app/booking/schemas.py` 檔尾（`PublicVisitSlotOut` 之後或檔尾；確認檔頭已 import `date, time`、`BaseModel`、`Literal`，沒有就補）

```python
class SlotLookupBucketOut(BaseModel):
    key: Literal["within_1", "days_2_3", "days_4_7", "over_7", "none"]
    count: int


class SlotLookupSummaryOut(BaseModel):
    date_from: date
    date_to: date
    first_recorded_day: date | None
    total: int
    buckets: list[SlotLookupBucketOut]


class SlotUsageThresholdsOut(BaseModel):
    min_slots: int
    often_full_share: float
    rarely_booked_rate: float


class SlotUsageRowOut(BaseModel):
    weekday: int
    start_time: time
    end_time: time
    slot_count: int
    capacity_total: int
    booked: int
    fill_rate: float
    full_count: int
    signal: Literal["too_few", "often_full", "rarely_booked", "normal"]


class SlotUsageSlotsOut(BaseModel):
    weeks: int
    date_from: date
    date_to: date
    thresholds: SlotUsageThresholdsOut
    rows: list[SlotUsageRowOut]


class SlotUsageOut(BaseModel):
    campus_key: str
    booking_mode: str | None
    today: date
    lookups: SlotLookupSummaryOut
    slots: SlotUsageSlotsOut
```

- [ ] **Step 8: 加路由** — `backend/app/booking/routes.py`，緊接在 `get_visit_calendar` 之後。import 區補 `slot_usage,`（`from app.booking import (...)` 清單，按字母序在 `slot_service,` 之後）與 `SlotUsageOut`（`from app.booking.schemas import (...)` 清單）。

```python
@router.get("/admin/visit-slot-usage", response_model=SlotUsageOut)
async def get_visit_slot_usage(
    campus_key: str,
    weeks: int = Query(default=12),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> SlotUsageOut:
    """場次使用情況（2026-10-13 規格 §4）：新預約表單近 4 週的「最早能約哪天」＋各時段過去坐了幾成。
    權限同接待月曆；只回數字，沒有個資，不寫操作紀錄。"""
    require_scope(current_user, "booking.read", campus_keys=[campus_key])
    if weeks not in slot_usage.WEEK_CHOICES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "INVALID_WEEKS", "message": "weeks 只能是 4、12 或 26"},
        )
    today = today_local()
    config = await db.get(BookingConfig, campus_key)
    return SlotUsageOut(
        campus_key=campus_key,
        booking_mode=config.mode.value if config is not None else None,
        today=today,
        lookups=await slot_lookup.lookup_summary(db, campus_key, today),
        slots=await slot_usage.slot_rows(db, campus_key, weeks, today),
    )
```

注意：`weeks: int = Query(default=12)` 讓 `abc` 回 FastAPI 預設 422；`0／5／52` 走 `INVALID_WEEKS` 422。

- [ ] **Step 9: 跑測試**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/visit-slot-usage-20261013/backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_slotusage1013_test uv run pytest tests/test_slot_usage.py tests/test_slot_lookup.py tests/test_slot_lookup_schema.py -q
```
Expected: 全過。

- [ ] **Step 10: 重產契約並檢查**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/visit-slot-usage-20261013; npm run contract:generate; npm run contract:check
```
Expected: `contract:check` 通過；`git status --short` 只多 `contracts/openapi.json` 與 `contracts/generated/website-api.d.ts` 兩個變動（還有 Task 1–3 已列的檔）。

- [ ] **Step 11: Commit**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/visit-slot-usage-20261013 && git add backend/app/booking/slot_usage.py backend/app/booking/schemas.py backend/app/booking/routes.py backend/tests/test_slot_usage.py contracts/openapi.json contracts/generated/website-api.d.ts && git commit -m "feat(booking): 後台 API 回傳各時段填滿率與最早能約哪天

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: web 預約表單帶 `purpose`

**Files:**
- Modify: `web/app/utils/visit-form.ts`（新增 `newBookingSlotsQuery`）
- Modify: `web/app/components/VisitForm.vue:147-150`
- Create: `web/tests/slot-lookup-purpose.spec.ts`

**Interfaces:**
- Produces: `newBookingSlotsQuery(campusKey: string, today: string, days = 60): { campus_key: string; date_from: string; date_to: string; purpose: 'new_booking' }`（`web/app/utils/visit-form.ts`）。

- [ ] **Step 1: 寫失敗的測試** — 建 `web/tests/slot-lookup-purpose.spec.ts`

```ts
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { newBookingSlotsQuery, taipeiDate } from '../app/utils/visit-form'

// 2026-10-13 場次使用情況：只有「新預約表單」讀場次時帶 purpose=new_booking，伺服器才記一次「最早能約哪天」；
// 家長改期的管理頁（useParentVisit）讀同一支端點，不帶就不記。

const read = (file: string) => readFileSync(path.resolve(__dirname, '..', file), 'utf8')

describe('新預約表單讀場次的查詢', () => {
  it('帶校區、今天到 60 天後與 purpose=new_booking', () => {
    const query = newBookingSlotsQuery('yihua', '2026-10-13')
    expect(query).toEqual({ campus_key: 'yihua', date_from: '2026-10-13', date_to: '2026-12-12', purpose: 'new_booking' })
  })

  it('可以指定天數', () => {
    expect(newBookingSlotsQuery('renwu', '2026-10-13', 10).date_to).toBe('2026-10-23')
  })

  it('預約表單用這個函式，不自己拼查詢', () => {
    const source = read('app/components/VisitForm.vue')
    expect(source).toContain('newBookingSlotsQuery(')
    expect(source).not.toMatch(/query:\s*\{\s*campus_key:\s*campusKey/)
  })

  it('改期管理頁不帶 purpose', () => {
    expect(read('app/composables/useParentVisit.ts')).not.toContain('purpose')
  })

  it('taipeiDate 仍是台北日期（日期加法不受時區影響）', () => {
    expect(taipeiDate(new Date('2026-10-12T16:30:00Z'))).toBe('2026-10-13')
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/visit-slot-usage-20261013/web; npx vitest run tests/slot-lookup-purpose.spec.ts
```
Expected: FAIL（`newBookingSlotsQuery` 不是函式）。若 `taipeiDate` 不在 `visit-form.ts` 匯出（`VisitForm.vue:6` 的 import 顯示它在），或簽名與假設不同，照現有簽名調整最後一個測試。

- [ ] **Step 3: 實作** — `web/app/utils/visit-form.ts` 加（放在 `taipeiDate` 之後）

```ts
/** 新預約表單讀公開場次的查詢（2026-10-13）：多帶 purpose=new_booking，伺服器據此記一次「最早能約哪天」。
 *  purpose 只決定記不記，不影響回傳的場次；改期管理頁讀同一支端點，不帶。 */
export function newBookingSlotsQuery(campusKey: string, today: string, days = 60) {
  const end = new Date(`${today}T12:00:00+08:00`)
  end.setUTCDate(end.getUTCDate() + days)
  return { campus_key: campusKey, date_from: today, date_to: taipeiDate(end), purpose: 'new_booking' as const }
}
```

`T12:00:00+08:00` 是台北正午，加整數天後轉台北日期不會跨日。`taipeiDate` 接受 `Date`（`VisitForm.vue` 原本就這樣呼叫）。

- [ ] **Step 4: 改 `VisitForm.vue`** — import 加 `newBookingSlotsQuery`（`VisitForm.vue:6` 那行），並把 `loadSlots()` 裡

```ts
      query: { campus_key: campusKey, date_from: today.value, date_to: taipeiDate(new Date(Date.now() + 60 * 86400000)) }
```
改成
```ts
      query: newBookingSlotsQuery(campusKey, today.value)
```
`taipeiDate` 若 `VisitForm.vue` 其他地方仍有用就保留 import，沒有就從 import 清單拿掉。

- [ ] **Step 5: 跑測試與型別檢查**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/visit-slot-usage-20261013/web; npx vitest run tests/slot-lookup-purpose.spec.ts tests/campus-booking.spec.ts; npm run typecheck
```
Expected: 全過。

- [ ] **Step 6: Commit**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/visit-slot-usage-20261013 && git add web/app/utils/visit-form.ts web/app/components/VisitForm.vue web/tests/slot-lookup-purpose.spec.ts && git commit -m "feat(web): 預約表單讀場次時帶 purpose=new_booking

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: admin 純函式（總結句、判讀、標籤）

**Files:**
- Create: `admin/src/utils/slotUsage.ts`
- Create: `admin/src/__tests__/slotUsage.test.ts`（本任務只寫純函式部分）

**Interfaces:**
- Consumes: 契約型別 `components['schemas']['SlotUsageOut']`（`contracts/generated/website-api.d.ts`，Task 3 產生）。admin 引用契約型別的方式見 `admin/src/api/types.ts:5`（`import type { components } from '../../../contracts/generated/website-api'`）。
- Produces（`admin/src/utils/slotUsage.ts`）：
  - `export type SlotUsage = components['schemas']['SlotUsageOut']`，`SlotUsageRow = SlotUsage['slots']['rows'][number]`
  - `BUCKET_LABELS: Record<string, string>` — `within_1:'明天以前'`、`days_2_3:'2–3 天'`、`days_4_7:'4–7 天'`、`over_7:'超過 7 天'`、`none:'沒有場次'`
  - `WEEKDAY_LABELS = ['週一','週二','週三','週四','週五','週六','週日']`
  - `slotLabel(row: SlotUsageRow): string` — 例「週六 10:00–11:00」（去掉秒）
  - `signalText(signal: SlotUsageRow['signal']): string` — `often_full` →「常額滿，可以考慮加開」、`rarely_booked` →「很少人約，可以考慮收掉或縮短」、`too_few` →「還不到 4 場，還不判斷」（4 取自 `thresholds.min_slots`，所以簽名是 `signalText(signal, minSlots)`）、`normal` →「—」
  - `lookupSummaryText(campusName: string, lookups: SlotUsage['lookups']): string`
  - `lookupEmptyText(usage: SlotUsage): string | null` — 依規格 §5.3 回空狀態文字，有資料回 `null`
  - `slotsEmptyText(usage: SlotUsage): string | null`
  - `usageCsvFilename(campusName: string, weeks: number, today: string): string` — `場次使用情況-{校名}-近{N}週-{YYYYMMDD}.csv`

- [ ] **Step 1: 寫失敗的測試** — 建 `admin/src/__tests__/slotUsage.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import {
  BUCKET_LABELS, lookupEmptyText, lookupSummaryText, signalText, slotLabel, slotsEmptyText, usageCsvFilename,
} from '../utils/slotUsage'
import type { SlotUsage } from '../utils/slotUsage'

const usage = (changes: Partial<SlotUsage> = {}, lookups: Partial<SlotUsage['lookups']> = {}, slots: Partial<SlotUsage['slots']> = {}): SlotUsage => ({
  campus_key: 'yihua', booking_mode: 'slots', today: '2026-10-13',
  lookups: {
    date_from: '2026-09-16', date_to: '2026-10-13', first_recorded_day: '2026-10-01', total: 10,
    buckets: [
      { key: 'within_1', count: 1 }, { key: 'days_2_3', count: 2 }, { key: 'days_4_7', count: 3 },
      { key: 'over_7', count: 3 }, { key: 'none', count: 1 },
    ],
    ...lookups,
  },
  slots: {
    weeks: 12, date_from: '2026-07-21', date_to: '2026-10-12',
    thresholds: { min_slots: 4, often_full_share: 0.5, rarely_booked_rate: 0.2 },
    rows: [{ weekday: 5, start_time: '10:00:00', end_time: '11:00:00', slot_count: 12, capacity_total: 36, booked: 33, fill_rate: 0.917, full_count: 9, signal: 'often_full' }],
    ...slots,
  },
  ...changes,
})

describe('場次使用情況：文字', () => {
  it('區間標籤五個，順序固定', () => {
    expect(Object.values(BUCKET_LABELS)).toEqual(['明天以前', '2–3 天', '4–7 天', '超過 7 天', '沒有場次'])
  })

  it('時段標籤：星期＋去掉秒的起訖', () => {
    expect(slotLabel(usage().slots.rows[0]!)).toBe('週六 10:00–11:00')
  })

  it('判讀文字', () => {
    expect(signalText('often_full', 4)).toBe('常額滿，可以考慮加開')
    expect(signalText('rarely_booked', 4)).toBe('很少人約，可以考慮收掉或縮短')
    expect(signalText('too_few', 4)).toBe('還不到 4 場，還不判斷')
    expect(signalText('normal', 4)).toBe('—')
  })

  it('總結句：7 天內約不到＝超過 7 天＋沒有場次，整段沒有場次單獨列', () => {
    expect(lookupSummaryText('義華校', usage().lookups)).toBe(
      '近 4 週家長打開義華校預約頁 10 次，其中 4 次 7 天內已經約不到，1 次整段沒有場次可選。',
    )
  })

  it('檔名', () => {
    expect(usageCsvFilename('義華校', 12, '2026-10-13')).toBe('場次使用情況-義華校-近12週-20261013.csv')
  })
})

describe('場次使用情況：空狀態（規格 §5.3）', () => {
  it('還沒有任何紀錄', () => {
    const empty = usage({}, { first_recorded_day: null, total: 0, buckets: usage().lookups.buckets.map(b => ({ ...b, count: 0 })) })
    expect(lookupEmptyText(empty)).toBe('還沒有家長打開預約頁的紀錄。')
  })

  it('以前記過、近 4 週沒有人打開', () => {
    const quiet = usage({}, { total: 0, buckets: usage().lookups.buckets.map(b => ({ ...b, count: 0 })) })
    expect(lookupEmptyText(quiet)).toBe('近 4 週沒有家長打開預約頁。')
  })

  it('不是自選場次、近 4 週也沒有紀錄', () => {
    const phone = usage({ booking_mode: 'phone' }, { first_recorded_day: null, total: 0 })
    expect(lookupEmptyText(phone)).toBe('目前的預約方式不是自選場次，家長看不到場次。')
  })

  it('以前是自選場次、後來改成電話：近 4 週沒有紀錄時也說明預約方式', () => {
    const switched = usage({ booking_mode: 'phone' }, { total: 0, buckets: usage().lookups.buckets.map(b => ({ ...b, count: 0 })) })
    expect(lookupEmptyText(switched)).toBe('目前的預約方式不是自選場次，家長看不到場次。')
  })

  it('有資料就沒有空狀態', () => {
    expect(lookupEmptyText(usage())).toBeNull()
  })

  it('範圍內沒有過去的場次', () => {
    expect(slotsEmptyText(usage({}, {}, { rows: [] }))).toBe('近 12 週沒有開放的場次。')
    expect(slotsEmptyText(usage())).toBeNull()
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/visit-slot-usage-20261013/admin; VITEST_MAX_FORKS=2 npx vitest run src/__tests__/slotUsage.test.ts
```
Expected: FAIL（找不到 `../utils/slotUsage`）。

- [ ] **Step 3: 實作 `admin/src/utils/slotUsage.ts`**

```ts
import type { components } from '../../../contracts/generated/website-api'

// 場次使用情況的顯示文字與空狀態（2026-10-13 規格 §5）。純函式，畫面元件與測試共用。
export type SlotUsage = components['schemas']['SlotUsageOut']
export type SlotUsageRow = SlotUsage['slots']['rows'][number]

export const BUCKET_LABELS: Record<string, string> = {
  within_1: '明天以前',
  days_2_3: '2–3 天',
  days_4_7: '4–7 天',
  over_7: '超過 7 天',
  none: '沒有場次',
}

export const WEEKDAY_LABELS = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'] as const

const hm = (time: string) => time.slice(0, 5)

export function slotLabel(row: Pick<SlotUsageRow, 'weekday' | 'start_time' | 'end_time'>): string {
  return `${WEEKDAY_LABELS[row.weekday] ?? ''} ${hm(row.start_time)}–${hm(row.end_time)}`
}

export function signalText(signal: SlotUsageRow['signal'], minSlots: number): string {
  if (signal === 'often_full') return '常額滿，可以考慮加開'
  if (signal === 'rarely_booked') return '很少人約，可以考慮收掉或縮短'
  if (signal === 'too_few') return `還不到 ${minSlots} 場，還不判斷`
  return '—'
}

const count = (lookups: SlotUsage['lookups'], key: string) => lookups.buckets.find(b => b.key === key)?.count ?? 0

export function lookupSummaryText(campusName: string, lookups: SlotUsage['lookups']): string {
  const none = count(lookups, 'none')
  const beyondWeek = count(lookups, 'over_7') + none
  return `近 4 週家長打開${campusName}預約頁 ${lookups.total} 次，其中 ${beyondWeek} 次 7 天內已經約不到，${none} 次整段沒有場次可選。`
}

export function lookupEmptyText(usage: SlotUsage): string | null {
  const { lookups } = usage
  if (lookups.total > 0) return null
  if (usage.booking_mode !== 'slots') return '目前的預約方式不是自選場次，家長看不到場次。'
  if (lookups.first_recorded_day === null) return '還沒有家長打開預約頁的紀錄。'
  return '近 4 週沒有家長打開預約頁。'
}

export function slotsEmptyText(usage: SlotUsage): string | null {
  return usage.slots.rows.length === 0 ? `近 ${usage.slots.weeks} 週沒有開放的場次。` : null
}

export function usageCsvFilename(campusName: string, weeks: number, today: string): string {
  return `場次使用情況-${campusName}-近${weeks}週-${today.replaceAll('-', '')}.csv`
}
```

匯入路徑與 `admin/src/api/types.ts:5` 相同（同樣在 `admin/src/` 下兩層以內）。

- [ ] **Step 4: 跑測試確認通過**

同 Step 2。Expected: 全過。

- [ ] **Step 5: Commit**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/visit-slot-usage-20261013 && git add admin/src/utils/slotUsage.ts admin/src/__tests__/slotUsage.test.ts && git commit -m "feat(admin): 場次使用情況的文字與空狀態函式

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: admin 畫面與頁籤

**Files:**
- Create: `admin/src/components/sessions/SlotUsagePane.vue`
- Modify: `admin/src/views/VisitCalendarView.vue`
- Modify: `admin/src/__tests__/slotUsage.test.ts`（附加元件與頁籤測試）

**Interfaces:**
- Consumes: `utils/slotUsage.ts`（Task 5）、`StatsDimensionTable`（`admin/src/components/admissions/StatsDimensionTable.vue`，props：`title, rows, columns, rowKey, emptyText, caption?, exportFilename?, csvCell?`；`StatsColumn` 在 `admin/src/admissions/statsFormat.ts:9`）、`AnalyticsExplainer`（`admin/src/components/analytics/AnalyticsExplainer.vue`）、`useRequestSequence`、`api.get`。
- Produces: `SlotUsagePane`，props `{ campusKey: string; campusName: string }`，emit `go-calendar`（「到接待月曆改規則」連結按下）。

- [ ] **Step 1: 寫失敗的測試（元件）** — 附加在 `admin/src/__tests__/slotUsage.test.ts` 檔尾，並在檔頭 import 區補

```ts
import { afterEach, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import SlotUsagePane from '../components/sessions/SlotUsagePane.vue'
import { api } from '../api/client'
```

（原本 `import { describe, expect, it } from 'vitest'` 改成 `import { afterEach, describe, expect, it, vi } from 'vitest'`，不要重複 import。）

```ts
const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach(wrapper => wrapper.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
})

async function mountPane(data: SlotUsage | Error) {
  const get = vi.spyOn(api, 'get')
  if (data instanceof Error) get.mockRejectedValue(data)
  else get.mockResolvedValue(data as never)
  const wrapper = mount(SlotUsagePane, { props: { campusKey: 'yihua', campusName: '義華校' }, global: { plugins: [ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, get }
}

const urlOf = (get: { mock: { calls: unknown[][] } }) => get.mock.calls.map(call => String(call[0]))

describe('SlotUsagePane', () => {
  it('讀 API（預設近 12 週）並顯示總結句、五個區間與時段表', async () => {
    const { wrapper, get } = await mountPane(usage())
    expect(urlOf(get)).toEqual(['/admin/visit-slot-usage?campus_key=yihua&weeks=12'])
    expect(wrapper.text()).toContain('近 4 週家長打開義華校預約頁 10 次')
    for (const label of ['明天以前', '2–3 天', '4–7 天', '超過 7 天', '沒有場次']) expect(wrapper.text()).toContain(label)
    expect(wrapper.text()).toContain('週六 10:00–11:00')
    expect(wrapper.text()).toContain('常額滿，可以考慮加開')
    expect(wrapper.text()).toContain('到接待月曆改規則')
  })

  it('切換週數會重讀', async () => {
    const { wrapper, get } = await mountPane(usage())
    await wrapper.get('[data-test="weeks-26"]').trigger('click')
    await flushPromises()
    expect(urlOf(get).at(-1)).toBe('/admin/visit-slot-usage?campus_key=yihua&weeks=26')
  })

  it('沒有常額滿的列就不顯示「到接待月曆改規則」', async () => {
    const calm = usage({}, {}, { rows: [{ weekday: 0, start_time: '10:00:00', end_time: '11:00:00', slot_count: 6, capacity_total: 12, booked: 6, fill_rate: 0.5, full_count: 0, signal: 'normal' }] })
    const { wrapper } = await mountPane(calm)
    expect(wrapper.text()).not.toContain('到接待月曆改規則')
  })

  it('連結按下發出 go-calendar', async () => {
    const { wrapper } = await mountPane(usage())
    await wrapper.get('[data-test="go-calendar"]').trigger('click')
    expect(wrapper.emitted('go-calendar')).toHaveLength(1)
  })

  it('上線初期：第一塊寫還沒有紀錄，第二塊照常', async () => {
    const fresh = usage({}, { first_recorded_day: null, total: 0, buckets: usage().lookups.buckets.map(b => ({ ...b, count: 0 })) })
    const { wrapper } = await mountPane(fresh)
    expect(wrapper.text()).toContain('還沒有家長打開預約頁的紀錄。')
    expect(wrapper.text()).toContain('週六 10:00–11:00')
  })

  it('非自選場次的校區', async () => {
    const phone = usage({ booking_mode: 'phone' }, { first_recorded_day: null, total: 0, buckets: usage().lookups.buckets.map(b => ({ ...b, count: 0 })) }, { rows: [] })
    const { wrapper } = await mountPane(phone)
    expect(wrapper.text()).toContain('目前的預約方式不是自選場次，家長看不到場次。')
    expect(wrapper.text()).toContain('近 12 週沒有開放的場次。')
  })

  it('讀取失敗：整個頁籤顯示錯誤與重新載入，重新載入會再讀', async () => {
    const { wrapper, get } = await mountPane(new Error('boom'))
    expect(wrapper.text()).toContain('無法讀取場次使用情況，請重新載入。')
    get.mockResolvedValue(usage() as never)
    await wrapper.get('[data-test="reload"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('近 4 週家長打開義華校預約頁 10 次')
  })

  it('換校區重讀，舊回應不會蓋掉新回應', async () => {
    const slow = new Promise<SlotUsage>(resolve => setTimeout(() => resolve(usage({ campus_key: 'yihua' })), 20))
    const get = vi.spyOn(api, 'get')
      .mockReturnValueOnce(slow as never)
      .mockResolvedValueOnce(usage({ campus_key: 'minghua' }, { total: 99 }) as never)
    const wrapper = mount(SlotUsagePane, { props: { campusKey: 'yihua', campusName: '義華校' }, global: { plugins: [ElementPlus] } })
    wrappers.push(wrapper)
    await wrapper.setProps({ campusKey: 'minghua', campusName: '明華校' })
    await new Promise(resolve => setTimeout(resolve, 40))
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('打開明華校預約頁 99 次')
  })

  it('「怎麼算」說明預設收合，內容寫出口徑', async () => {
    const { wrapper } = await mountPane(usage())
    const details = wrapper.get('details')
    expect(details.attributes('open')).toBeUndefined()
    for (const phrase of ['次', '取消', '關閉', '4 場', '50%', '20%']) expect(details.text()).toContain(phrase)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

同 Task 5 Step 2 的指令。Expected: FAIL（找不到 `SlotUsagePane.vue`）。

- [ ] **Step 3: 實作 `admin/src/components/sessions/SlotUsagePane.vue`**

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { api } from '../../api/client'
import { useRequestSequence } from '../../composables/useRequestSequence'
import { barWidth, type StatsColumn } from '../../admissions/statsFormat'
import AnalyticsExplainer from '../analytics/AnalyticsExplainer.vue'
import StatsDimensionTable from '../admissions/StatsDimensionTable.vue'
import {
  BUCKET_LABELS, lookupEmptyText, lookupSummaryText, signalText, slotLabel, slotsEmptyText, usageCsvFilename,
  type SlotUsage, type SlotUsageRow,
} from '../../utils/slotUsage'

// 場次使用情況（2026-10-13 規格 §5.2）：上面是新預約表單近 4 週的「最早能約哪天」，下面是各時段過去坐了幾成。
// 兩塊來自同一支 API，失敗是一起失敗、一起重試。數字寫出來，長條只是輔助（DESIGN.md：圖是表格＋CSS 長條）。
const props = defineProps<{ campusKey: string; campusName: string }>()
defineEmits<{ 'go-calendar': [] }>()

const WEEK_CHOICES = [4, 12, 26] as const
const weeks = ref<(typeof WEEK_CHOICES)[number]>(12)
const usage = ref<SlotUsage | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const requests = useRequestSequence()

async function load() {
  const request = requests.begin()
  loading.value = true
  error.value = null
  try {
    const result = await api.get<SlotUsage>(`/admin/visit-slot-usage?campus_key=${props.campusKey}&weeks=${weeks.value}`)
    if (requests.isCurrent(request)) usage.value = result
  } catch {
    if (requests.isCurrent(request)) {
      usage.value = null
      error.value = '無法讀取場次使用情況，請重新載入。'
    }
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}
watch(() => [props.campusKey, weeks.value], load, { immediate: true })

const lookupEmpty = computed(() => (usage.value ? lookupEmptyText(usage.value) : null))
const slotsEmpty = computed(() => (usage.value ? slotsEmptyText(usage.value) : null))
const maxBucket = computed(() => Math.max(1, ...(usage.value?.lookups.buckets.map(b => b.count) ?? [0])))
const hasOftenFull = computed(() => usage.value?.slots.rows.some(r => r.signal === 'often_full') ?? false)

type Row = SlotUsageRow & { slot: string; fill: number; signalLabel: string; key: string }
const rows = computed<Row[]>(() => (usage.value?.slots.rows ?? []).map(r => ({
  ...r,
  key: `${r.weekday}-${r.start_time}-${r.end_time}`,
  slot: slotLabel(r),
  fill: Math.round(r.fill_rate * 100),
  signalLabel: signalText(r.signal, usage.value?.slots.thresholds.min_slots ?? 4),
})))
const columns: StatsColumn[] = [
  { key: 'slot', label: '時段', kind: 'text', sticky: true },
  { key: 'slot_count', label: '場次數', kind: 'count' },
  { key: 'capacity_total', label: '總名額', kind: 'count' },
  { key: 'booked', label: '已約', kind: 'count' },
  { key: 'fill', label: '填滿率（%）', kind: 'bar' },
  { key: 'full_count', label: '額滿場次', kind: 'count' },
  { key: 'signalLabel', label: '判讀', kind: 'text' },
]
</script>

<template>
  <div class="usage" :aria-busy="loading">
    <el-alert v-if="error" type="error" :closable="false" show-icon :title="error">
      <el-button size="small" data-test="reload" @click="load">重新載入</el-button>
    </el-alert>

    <template v-else-if="usage">
      <section class="usage__block" aria-labelledby="usage-lookup-title">
        <h2 id="usage-lookup-title" class="usage__title">最早能約哪天（近 4 週）</h2>
        <p v-if="lookupEmpty" class="empty-note">{{ lookupEmpty }}</p>
        <template v-else>
          <p class="usage__summary">{{ lookupSummaryText(campusName, usage.lookups) }}</p>
          <ul class="usage__buckets">
            <li v-for="bucket in usage.lookups.buckets" :key="bucket.key" class="usage__bucket">
              <span class="usage__bucket-label">{{ BUCKET_LABELS[bucket.key] }}</span>
              <span class="usage__bar" aria-hidden="true"><span :style="{ width: barWidth(bucket.count, maxBucket) }" /></span>
              <span class="usage__bucket-count num">{{ bucket.count }} 次</span>
            </li>
          </ul>
        </template>
        <p v-if="usage.lookups.first_recorded_day" class="hint">從 {{ usage.lookups.first_recorded_day }} 開始記錄。</p>
      </section>

      <section class="usage__block" aria-labelledby="usage-slots-title">
        <div class="usage__head">
          <h2 id="usage-slots-title" class="usage__title">各時段坐了幾成</h2>
          <div class="usage__weeks" role="group" aria-label="統計範圍">
            <el-button
              v-for="choice in WEEK_CHOICES" :key="choice" size="small" :data-test="`weeks-${choice}`"
              :type="weeks === choice ? 'primary' : 'default'" :aria-pressed="weeks === choice" @click="weeks = choice"
            >近 {{ choice }} 週</el-button>
          </div>
        </div>
        <p v-if="slotsEmpty" class="empty-note">{{ slotsEmpty }}</p>
        <StatsDimensionTable
          v-else :title="`時段（${usage.slots.date_from} 至 ${usage.slots.date_to}）`" :rows="rows" :columns="columns" row-key="key"
          empty-text="" :export-filename="usageCsvFilename(campusName, usage.slots.weeks, usage.today)"
        />
        <p v-if="hasOftenFull" class="usage__link">
          <el-link type="primary" data-test="go-calendar" @click="$emit('go-calendar')">到接待月曆改規則</el-link>
        </p>
      </section>

      <AnalyticsExplainer summary="這些數字怎麼算">
        <ul>
          <li>最早能約哪天：家長每打開一次新預約表單算一次，所以單位是「次」，同一位家長重新整理或切校區會算兩次；沒有存任何能辨識家長的資料。</li>
          <li>只算已經過去的場次，不含今天與未來；園方關閉的場次（休假、手動關閉）不算。</li>
          <li>已約＝排進這個場次、沒有取消的預約；後來到場或沒來都算佔了位子。填滿率＝已約 ÷ 總名額，最多 100%。</li>
          <li>同一個時段（星期＋開始＋結束時間）不到 {{ usage.slots.thresholds.min_slots }} 場，還不判斷；一半（{{ Math.round(usage.slots.thresholds.often_full_share * 100) }}%）以上的場次額滿，標「常額滿」；填滿率在 {{ Math.round(usage.slots.thresholds.rarely_booked_rate * 100) }}% 以下，標「很少人約」。這是描述，不是預測。</li>
        </ul>
      </AnalyticsExplainer>
    </template>
  </div>
</template>

<style scoped>
.usage { display: grid; gap: 24px; }
.usage__block { display: grid; gap: 12px; }
.usage__head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.usage__title { margin: 0; font-size: var(--text-lg); }
.usage__summary { margin: 0; color: var(--ink); }
.usage__buckets { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.usage__bucket { display: grid; grid-template-columns: 7em minmax(0, 1fr) 4.5em; align-items: center; gap: 12px; font-size: var(--text-sm); }
.usage__bar { height: 10px; border-radius: 5px; background: var(--surface-3); overflow: hidden; }
.usage__bar > span { display: block; height: 100%; border-radius: 5px; background: var(--el-color-primary); }
.usage__bucket-count { text-align: right; }
.usage__link { margin: 0; }
@media (max-width: 720px) {
  .usage__bucket { grid-template-columns: 6em minmax(0, 1fr) 4em; gap: 8px; }
}
</style>
```

說明：`barWidth(value, max)` 是 `admin/src/admissions/statsFormat.ts:80` 現有的函式（回 `'NN%'`）。`StatsDimensionTable` 的 `emptyText` 是必填，這裡已用 `slotsEmpty` 在外面處理空狀態，所以傳空字串。`.empty-note`、`.hint` 是全域樣式（10-12 區域分析的 `.empty-note`）。

- [ ] **Step 4: 跑元件測試**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/visit-slot-usage-20261013/admin; VITEST_MAX_FORKS=2 npx vitest run src/__tests__/slotUsage.test.ts
```
Expected: 全過。失敗時先看是測試假設（`data-test`、文字）還是元件的差異，再修；`StatsDimensionTable` 若把 `sticky` 欄當第一欄且需要 `numbered`，不用理會。

- [ ] **Step 5: 寫失敗的測試（頁籤與網址）** — 附加在 `admin/src/__tests__/slotUsage.test.ts` 檔尾。檔頭 import 補

```ts
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import VisitCalendarView from '../views/VisitCalendarView.vue'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'
```

```ts
async function mountCalendarAt(path: string) {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin', { id: 'me', email: 'me@example.invalid', campus_keys: [] })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(VisitCalendarView, {
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

describe('參觀場次頁：頁籤', () => {
  const route = (get: ReturnType<typeof vi.spyOn>) => {
    get.mockImplementation((async (path: string) => {
      if (path.startsWith('/admin/visit-slot-usage')) return usage()
      if (path.startsWith('/admin/visit-schedule/')) return { exceptions: [], rules: [], version: 1, min_lead_hours: 24, max_advance_days: 60 }
      return []
    }) as never)
  }

  it('預設是接待月曆，沒有讀場次使用情況', async () => {
    const get = vi.spyOn(api, 'get'); route(get)
    const { wrapper } = await mountCalendarAt('/visit-calendar?campus=yihua')
    expect(get.mock.calls.map(c => String(c[0])).some(p => p.startsWith('/admin/visit-slot-usage'))).toBe(false)
    expect(wrapper.findAll('[role="tab"]').map(t => t.text())).toEqual(['接待月曆', '場次使用情況'])
    expect(wrapper.find('.calendar__grid').exists()).toBe(true)
  })

  it('直接開 ?tab=usage 就顯示場次使用情況，且只在這時才讀 API', async () => {
    const get = vi.spyOn(api, 'get'); route(get)
    const { wrapper } = await mountCalendarAt('/visit-calendar?campus=yihua&tab=usage')
    expect(get.mock.calls.map(c => String(c[0]))).toContain('/admin/visit-slot-usage?campus_key=yihua&weeks=12')
    expect(wrapper.text()).toContain('最早能約哪天')
  })

  it('切頁籤寫進網址（replace、保留 campus），回月曆時拿掉 tab', async () => {
    const get = vi.spyOn(api, 'get'); route(get)
    const { wrapper, router } = await mountCalendarAt('/visit-calendar?campus=yihua')
    await wrapper.findAll('[role="tab"]')[1]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ campus: 'yihua', tab: 'usage' })
    await wrapper.findAll('[role="tab"]')[0]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.tab).toBeUndefined()
    expect(router.currentRoute.value.query.campus).toBe('yihua')
  })

  it('「到接待月曆改規則」切回第一個頁籤', async () => {
    const get = vi.spyOn(api, 'get'); route(get)
    const { wrapper, router } = await mountCalendarAt('/visit-calendar?campus=yihua&tab=usage')
    await wrapper.get('[data-test="go-calendar"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.tab).toBeUndefined()
    expect(wrapper.find('.calendar__grid').exists()).toBe(true)
  })

  it('切校區兩個頁籤共用：在使用情況頁籤換校會重讀新校', async () => {
    const get = vi.spyOn(api, 'get'); route(get)
    const { wrapper, router } = await mountCalendarAt('/visit-calendar?campus=yihua&tab=usage')
    await router.replace({ query: { campus: 'minghua', tab: 'usage' } })
    await flushPromises()
    expect(get.mock.calls.map(c => String(c[0]))).toContain('/admin/visit-slot-usage?campus_key=minghua&weeks=12')
    expect(wrapper.exists()).toBe(true)
  })
})
```

說明：超級管理者的 `visibleCampusKeys` 預設含五校；若 `testUser('super_admin', { campus_keys: [] })` 讓可見校區為空，改成與 `receptionAndHistory.test.ts` 相同的 setup（它掛同一個 view）。`el-tabs` 的頁籤節點是 `[role="tab"]`；若 Element Plus 版本的 DOM 不同，改用 `.el-tabs__item`。

- [ ] **Step 6: 跑頁籤測試確認失敗**

同 Step 4 的指令。Expected: FAIL（頁籤不存在）。

- [ ] **Step 7: 修改 `admin/src/views/VisitCalendarView.vue`**

(a) script 區：import 補

```ts
import SlotUsagePane from '../components/sessions/SlotUsagePane.vue'
import { campusLabel } from '../api/labels'
```

(b) 在 `const sessionsCard = ref(...)` 之後加

```ts
// 頁籤（2026-10-13 場次使用情況）：預設接待月曆不帶網址；tab=usage 是場次使用情況。
// 校區選擇器在頁籤外，兩個頁籤共用；切頁籤用 replace 寫回網址，不堆歷史。
type VisitTab = 'calendar' | 'usage'
const tabFromQuery = (value: unknown): VisitTab => (value === 'usage' ? 'usage' : 'calendar')
const tab = ref<VisitTab>(tabFromQuery(route.query.tab))
// 離開接待月曆時，每週場次卡片有沒存的修改要先問（取消就留在原頁籤）。
async function setTab(name: string | number) {
  const next = tabFromQuery(name)
  if (next === tab.value) return
  if (tab.value === 'calendar' && (await sessionsCard.value?.confirmLeave()) === false) return
  tab.value = next
}
watch(tab, value => {
  if (tabFromQuery(route.query.tab) === value) return
  const query = { ...route.query }
  if (value === 'usage') query.tab = 'usage'
  else delete query.tab
  void router.replace({ query })
})
watch(() => route.query.tab, value => {
  if (route.path !== CALENDAR_PATH) return
  const next = tabFromQuery(value)
  if (next !== tab.value) tab.value = next
})
const campusName = computed(() => campusLabel(campusFilter.value))
```

(c) 月曆的資料讀取只在接待月曆頁籤需要：`onMounted(() => { load() })` 與 `watch([month, campusFilter], load)` 保持不變（月曆資料便宜，兩個頁籤切換時不重讀月曆即可；使用情況頁籤自己讀）。**不要**為了省一次讀取去動這兩行。

(d) template：把 `<PageHeader …/>` 之後的整段改成：校區選擇器放進頁籤外的工具列，月曆的月份導覽只在月曆頁籤出現。具體：

```vue
    <PageHeader lead="月曆上點一天，看誰要來、調整那天的場次。" more="上方設定每週固定的參觀場次；點月曆上的某一天，可以停止或恢復某一場、設休假、加開，也看得到那天有誰要來。「場次使用情況」看家長最早能約哪天、各時段坐了幾成。" />

    <div class="toolbar calendar__toolbar">
      <el-tabs :model-value="tab" class="calendar__tabs" @update:model-value="setTab">
        <el-tab-pane label="接待月曆" name="calendar" />
        <el-tab-pane label="場次使用情況" name="usage" />
      </el-tabs>
      <CampusSelect :model-value="campusFilter" :keys="visibleCampusKeys" @update:model-value="switchCampus" />
    </div>

    <template v-if="tab === 'calendar'">
      <div class="toolbar calendar__toolbar">
        <div class="calendar__nav">
          <el-button :icon="ArrowLeft" aria-label="上個月" @click="shiftMonth(-1)" />
          <strong class="calendar__month" aria-live="polite">{{ monthLabel }}</strong>
          <el-button :icon="ArrowRight" aria-label="下個月" @click="shiftMonth(1)" />
          <el-button text @click="goToday">今天</el-button>
        </div>
      </div>

      <WeeklySessionsCard v-if="campusFilter" ref="sessionsCard" … 原屬性不動 />
      … 圖例、錯誤提示、月曆格線、DayPanel 原樣搬進來（不改內容） …
    </template>

    <SlotUsagePane v-else-if="campusFilter" :campus-key="campusFilter" :campus-name="campusName" @go-calendar="tab = 'calendar'" />
```

原有的第二個頁面元素（`WeeklySessionsCard`、`calendar__legend`、`el-alert`、`.panel.calendar`、`DayPanel`）整段原樣放進 `<template v-if="tab === 'calendar'">`，只加一層縮排；`ref="sessionsCard"`、`ref="dayPanel"` 不變。`switchCampus` 內的 `sessionsCard.value?.confirmLeave()` 在使用情況頁籤時 `sessionsCard` 為 `null`，`?.` 不會出錯。頁籤切走時 `WeeklySessionsCard` 會被卸載，所以離開前的詢問由 (b) 的 `setTab` 負責。

(e) style 區加

```css
.calendar__tabs { flex: 1; min-width: 0; }
.calendar__tabs :deep(.el-tabs__header) { margin-bottom: 0; }
```

- [ ] **Step 8: 補一個「有未存修改時切頁籤先問」的測試** — 附加在 `describe('參觀場次頁：頁籤')` 裡

```ts
  it('接待月曆有沒存的修改時，切到場次使用情況先問，取消就留在原頁籤', async () => {
    const get = vi.spyOn(api, 'get'); route(get)
    const { wrapper, router } = await mountCalendarAt('/visit-calendar?campus=yihua')
    // 用 script setup 的 ref 換成假的卡片：confirmLeave 回 false＝使用者選了取消。
    ;(wrapper.vm as unknown as { sessionsCard: unknown }).sessionsCard = { confirmLeave: async () => false }
    await wrapper.findAll('[role="tab"]')[1]!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.tab).toBeUndefined()
    expect(wrapper.find('.calendar__grid').exists()).toBe(true)
  })
```

`wrapper.vm` 能讀寫 `<script setup>` 的繫結，所以直接換掉 `sessionsCard` ref。`WeeklySessionsCard` 自己的未存修改保護（`useUnsavedChanges`）已有既有測試，這裡只驗證頁籤會呼叫它。

- [ ] **Step 9: 跑 admin 相關測試與型別檢查**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/visit-slot-usage-20261013/admin; VITEST_MAX_FORKS=2 npx vitest run src/__tests__/slotUsage.test.ts src/__tests__/receptionAndHistory.test.ts src/__tests__/visitSessionsPage.test.ts src/__tests__/a11yStructure.test.ts src/__tests__/permissionsUx.test.ts; npm run typecheck
```
Expected: 全過（既有測試掛同一個 view；若有測試依賴舊的 `.toolbar` 結構，調整該測試的選擇器而不是退回畫面）。

- [ ] **Step 10: Commit**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/visit-slot-usage-20261013 && git add admin/src/components/sessions/SlotUsagePane.vue admin/src/views/VisitCalendarView.vue admin/src/__tests__/slotUsage.test.ts && git commit -m "feat(admin): 參觀場次頁加「場次使用情況」頁籤

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: stack e2e、畫面檢查、文件

**Files:**
- Create: `tests/stack/slot-usage.spec.ts`
- Modify: `tests/stack/a11y.spec.ts`（把新頁籤網址加進掃描清單，沿用檔內寫法）
- Modify: `README.md`（頂部加日期段）
- Modify: `DESIGN.md`（新增一節）

**Interfaces:**
- Consumes: `openAs`、`gotoAdmin`、`expectNoHorizontalOverflow`（`tests/stack/pages.ts`）、`SLOTS_CAMPUS`（`tests/stack/stack-env.ts:35`）、`adminApi`（`tests/stack/api.ts`）。

- [ ] **Step 1: 寫 e2e** — 建 `tests/stack/slot-usage.spec.ts`

```ts
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test, request } from '@playwright/test'
import { expectNoHorizontalOverflow, gotoAdmin, openAs } from './pages'
import { ROOT, SLOTS_CAMPUS, WEB_ORIGIN } from './stack-env'
import { taipeiDate } from './api'

// 2026-10-13 場次使用情況：家長打開義華預約頁讀場次（purpose=new_booking）後，後台
// 參觀場次 → 場次使用情況的「最早能約哪天」至少有 1 次；頁籤進網址，1440／390 不橫向溢出。
// 公開請求一律給自己的來源（X-Forwarded-For），不吃掉別支 spec 的限流額度。

const SHOTS = path.join(ROOT, 'output/playwright')
const USAGE_PATH = `/visit-calendar?campus=${SLOTS_CAMPUS}&tab=usage`
const VIEWPORTS = [
  { name: '1440', device: { viewport: { width: 1440, height: 900 } } },
  { name: '390', device: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
] as const

test.beforeAll(async () => {
  const context = await request.newContext({ baseURL: WEB_ORIGIN, extraHTTPHeaders: { 'X-Forwarded-For': '198.51.100.42' } })
  const response = await context.get(
    `/api/website/v1/public/slots?campus_key=${SLOTS_CAMPUS}&date_from=${taipeiDate(0)}&date_to=${taipeiDate(60)}&purpose=new_booking`,
  )
  expect(response.ok(), await response.text()).toBe(true)
  await context.dispose()
})

for (const { name, device } of VIEWPORTS) {
  test(`${name}px：場次使用情況頁籤有最早能約哪天與各時段表，不橫向溢出`, async ({ browser }) => {
    const { context, page } = await openAs(browser, 'super_admin', device)
    await gotoAdmin(page, USAGE_PATH, '參觀場次')
    await expect(page.getByRole('tab', { name: '場次使用情況', selected: true })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: /^最早能約哪天/ })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: '各時段坐了幾成' })).toBeVisible()
    // 剛才那一次已記下：總結句寫「打開…預約頁 N 次」，N 至少 1。
    await expect(page.locator('.usage__summary')).toContainText(/預約頁 [1-9]\d* 次/)
    await expectNoHorizontalOverflow(page)
    mkdirSync(SHOTS, { recursive: true })
    await page.screenshot({ path: path.join(SHOTS, `slot-usage-${name}.png`), fullPage: true })
    await context.close()
  })
}

test('頁籤寫進網址，切回接待月曆拿掉 tab 並保留校區', async ({ browser }) => {
  const { context, page } = await openAs(browser, 'super_admin')
  await gotoAdmin(page, `/visit-calendar?campus=${SLOTS_CAMPUS}`, '參觀場次')
  await page.getByRole('tab', { name: '場次使用情況' }).click()
  await expect(page).toHaveURL(/tab=usage/)
  await page.getByRole('tab', { name: '接待月曆' }).click()
  await expect(page).not.toHaveURL(/tab=/)
  await expect(page).toHaveURL(new RegExp(`campus=${SLOTS_CAMPUS}`))
  await context.close()
})

test('分校管理者只看得到自己的校', async ({ browser }) => {
  const { context, page } = await openAs(browser, 'campus_admin')
  await gotoAdmin(page, USAGE_PATH, '參觀場次')
  await expect(page.getByRole('heading', { level: 2, name: /^最早能約哪天/ })).toBeVisible()
  await context.close()
})
```

說明：`taipeiDate` 從 `./api` 匯出（`tests/stack/api.ts:43`）；`gotoAdmin` 的第三個參數是頁面標題文字，若「參觀場次」不是 `PageHeader` 的標題文字，照 `tests/stack/schedule-flow.spec.ts` 開這一頁的寫法。

- [ ] **Step 2: a11y 掃描加新頁籤** — 先 `grep -n "visit-calendar" tests/stack/a11y.spec.ts`，在同一份路徑清單加 `/visit-calendar?campus=yihua&tab=usage`，沿用檔內寫法與豁免（若檔內是陣列字串清單就加一行字串）。

- [ ] **Step 3: 跑 stack e2e（專屬庫與 port）**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/visit-slot-usage-20261013; E2E_DB_NAME=ivy_website_slotusage1013_e2e_test E2E_API_PORT=8731 E2E_WEB_PORT=3731 npx playwright test tests/stack/slot-usage.spec.ts tests/stack/a11y.spec.ts tests/stack/schedule-flow.spec.ts 2>&1 | tail -30
```
Expected: 全過。截圖在 `output/playwright/slot-usage-1440.png`、`slot-usage-390.png`，用 Read 看一次：長條、表格、判讀欄在 390 不被切；axe 0。若 stack 啟動指令與此不同，照 `docs/website-admin/README.md` 與 `tests/stack/build.sh`、`start-api.sh`。

- [ ] **Step 4: 推 main 前跑完整 stack 套件一次**（此步只在使用者要求合併／部署時做，避免 429 這類跨 spec 干擾；這次不 push，所以本任務跳過，只在 commit 訊息說明）。

- [ ] **Step 5: README 頂部加日期段** — 在 `README.md` 最上方（第 1 行之前）加

```markdown
## 2026-10-13 場次使用情況（`feature/visit-slot-usage-20261013`）

使用者要「更多可以做招生判讀的資料」，四項裡的第一項。規格 `docs/specs/2026-10-13-visit-slot-usage-design.md`，規則見 DESIGN.md「參觀場次：場次使用情況」。

- **記錄**：公開 `GET /public/slots` 在 `purpose=new_booking` 時記一次「最早能約哪天」（五個區間），只存每日彙總 `slot_lookup_daily`；新預約表單帶這個參數，改期管理頁不帶。不改公開頁外觀。
- **回推**：各時段（星期×起訖）過去 4／12／26 週的場次數、總名額、已約、填滿率、額滿場次，判讀「常額滿／很少人約／還不判斷」。
- **畫面**：參觀場次頁多「場次使用情況」頁籤（`?tab=usage`）。
- **migration**：`b4d7e1a92c58` 只新增表，不需備份閘門。
- **驗證**：（填入實際跑過的指令與結果）
```

驗證那一行等 Task 7 全部跑完後，填入實際的通過數字；沒跑的項目明講沒跑。

- [ ] **Step 6: DESIGN.md 新增一節** — 在 `DESIGN.md` 第 13 行「## 參觀預約統計搬到招生入學…」之前插入

```markdown
## 參觀場次：場次使用情況（2026-10-13，`feature/visit-slot-usage-20261013`）

使用者從招生判讀候選選了「想約約不到＋場次填滿率」。規格 `docs/specs/2026-10-13-visit-slot-usage-design.md`。

- **位置**：參觀場次頁頂端兩個頁籤「接待月曆／場次使用情況」，`?tab=usage`；校區選擇器在頁籤外共用。
- **最早能約哪天**：只在伺服器記（不改公開頁、不在月曆標額滿）；單位是「次」不是「位」，沒有可辨識的資料就不能去重。區間固定五個：明天以前、2–3 天、4–7 天、超過 7 天、沒有場次。固定看近 4 週。
- **各時段坐了幾成**：從現有場次與預約回推，只算過去、沒關閉的場次；已約不含取消。門檻（後端常數）：同一時段不到 4 場還不判斷、額滿場次 ≥ 50% 標「常額滿」、填滿率 ≤ 20% 標「很少人約」。描述性門檻，不做統計檢定，不預測。
- **不做**：月曆標「額滿」與點擊額滿日、候補通知（會收聯絡方式，等於新的預約語意）、未來場次填滿（總覽已有）、「提前幾天額滿」、自動加開或關閉場次。
- **圖**：一律是表格＋CSS 長條，不裝圖表套件。
```

- [ ] **Step 7: Commit**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/visit-slot-usage-20261013 && git add tests/stack/slot-usage.spec.ts tests/stack/a11y.spec.ts README.md DESIGN.md && git commit -m "test(e2e): 場次使用情況 stack 驗證；README 與 DESIGN 記錄

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 全套驗證（主 session 做，不派 subagent）

- [ ] **Step 1: 後端全套（背景跑，專屬測試庫）**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/visit-slot-usage-20261013/backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_slotusage1013_test uv run pytest -q -x -p no:cacheprovider
```
用 `run_in_background` 跑，完成通知後讀結果。Expected: 全過。已知會假失敗的情況：共用暫存目錄的兩個媒體測試與筆電睡眠，單獨重跑確認；週五的 `test_booking_consent_readiness` 場次同步（日期相依）不是本次造成。

- [ ] **Step 2: admin 全套、web 全套、型別、契約**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/visit-slot-usage-20261013; npm --prefix admin run typecheck; npm --prefix web run typecheck; npm run test:website; npm run contract:check
```
Expected: 全過。admin 全套在高負載下可能有逾時假失敗，逐檔單獨重跑確認。一次只跑一組。

- [ ] **Step 3: 填 README 的「驗證」那一行**，commit（`docs: 記錄場次使用情況的驗證結果`）。

- [ ] **Step 4: 整理收尾資訊給使用者**：分支與最後 commit、實際跑過的指令與結果、未驗證項、要使用者執行的 push 指令（`! git -C ~/Repositories/ivy-website-wt/visit-slot-usage-20261013 push origin HEAD:main`；推完看 CI、部署後補 `deploy/README.md`、清 worktree 與 `ivy_website_slotusage1013_test`、`..._e2e_test`）。**不自己 push。**推 main 前提醒使用者（或在使用者要求合併時先做）：跑一次完整 stack 套件，不只跑相關幾支（10-13 booking-stats 的教訓：跨 spec 共用的每來源限流會讓別支 429）。

---

## Self-Review

**Spec coverage**

| 規格 | 任務 |
|---|---|
| §2.1 資料表、唯一約束、CHECK、降級 | Task 1 |
| §2.2 何時記（purpose、校區存在且 active、slots 模式、不影響回傳、失敗不卡住） | Task 2 |
| §2.3 web 帶 purpose／管理頁不帶 | Task 4 |
| §3 回推（狀態、closed、過去、分組含結束時間、封頂、判讀、排序） | Task 3 |
| §4 API 路徑、權限、`weeks` 422、回應形狀、`first_recorded_day`、`booking_mode` | Task 3 |
| §5.1 頁籤與 `?tab=usage`、校區共用、只在切到才讀 | Task 6 |
| §5.2 三個區塊、週數切換、CSV、連結、說明收合 | Task 5、6 |
| §5.3 邊界情況 | Task 5（文字）、Task 6（元件測試） |
| §6 個資與相容 | Task 2（不影響回傳、無個資欄位）；Global Constraints |
| §7 驗證清單 | Task 1–3 後端測試、Task 4 web、Task 5–6 admin、Task 7 e2e/截圖/axe、Task 8 全套 |
| §8 文件與部署 | Task 7（README、DESIGN）；部署紀錄留到使用者推 main 之後 |

**規格內一處需在實作時留意**：規格 §2.2 條件 3 說「該校預約方式是 slots」，已用 `config.mode == BookingMode.SLOTS` 實作；規格 §5.3 第二列的文字「近 N 週沒有開放的場次」在 `slotsEmptyText` 實作。

**Placeholder scan**：計畫中沒有 TBD／TODO。剩下三處要在現場確認既有慣例，已給預設寫法與確認方式：Task 1 Step 6 的 `sa.Uuid`（失敗時照其他 migration 的 UUID 主鍵寫法）、Task 3 Step 5 的「沒有 `booking.read` 的角色」403 測試（找不到這種角色就刪該測試並在 commit 說明）、Task 7 的 stack 啟動指令（以 `docs/website-admin/README.md` 為準）。

**Type consistency**：`bucket_for`／`record_lookup`／`lookup_summary`（Task 2）→ Task 3 路由與 schema 欄位名一致（`date_from`、`date_to`、`first_recorded_day`、`total`、`buckets[{key,count}]`）；`slot_rows` 的列欄位（`weekday`、`start_time`、`end_time`、`slot_count`、`capacity_total`、`booked`、`fill_rate`、`full_count`、`signal`、`thresholds.{min_slots,often_full_share,rarely_booked_rate}`）→ schema → admin 純函式與元件使用的欄位一致；`signalText(signal, minSlots)` 在 Task 5 定義、Task 6 呼叫時傳 `thresholds.min_slots`；`SlotUsagePane` props `campusKey`／`campusName`、emit `go-calendar` 在 Task 6 測試與 `VisitCalendarView` 用法一致；`newBookingSlotsQuery(campusKey, today, days)` 在 Task 4 定義與使用一致。

**Review Focus 對應測試**：1 → `test_without_purpose_or_with_other_value`、`test_purpose_does_not_change_the_response`；2 → `test_recording_failure_still_returns_the_slots_and_keeps_the_session_usable`；3 → `test_non_slots_campus_is_not_recorded`、`test_unknown_and_deactivated_campus_are_not_recorded`；4 → `test_lookup_uses_taipei_today_not_utc`、`test_taipei_date_boundary_uses_given_today`；5 → `test_fill_rate_is_capped_at_100_percent_and_still_counts_as_full`；6 → `test_booked_counts_confirmed_completed_no_show_but_not_cancelled`、`test_closed_today_future_and_other_campus_slots_are_ignored`；7 → `test_group_key_includes_weekday_start_and_end_time`；8 → 已知限制，不實作，記在 Review Focus。
