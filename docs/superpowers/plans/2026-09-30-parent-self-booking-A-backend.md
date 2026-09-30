# 階段 A：後端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 後端改成「只收自選場次、送出即成立」，送單即發修改連結並寄家長信，家長可直接改期與改資料，列表可依預約正常／時間已過／已取消分組，存每週規則即補場次。

**Architecture:** 見總覽 `2026-09-30-parent-self-booking.md`。本階段只動 `backend/`、`contracts/`、`admin/src/api/labels.ts`（標籤同步）。

**Tech Stack:** FastAPI 0.136.1、SQLAlchemy 2.0 async、Alembic、PostgreSQL、pytest-asyncio（`asyncio_mode = "auto"`）。

**Spec:** `docs/specs/2026-09-30-parent-self-booking-design.md` §3、§5、§6。

**先讀：** 總覽的「工作環境」「Global Constraints」「Review Focus」。

## 本階段對規格的技術調整（實作以這裡為準，Task A9 回寫規格）

- 取消原因欄位叫 `cancel_reason`，值沿用 `app/operations/models.py` 的 `parent`／`staff`／`hold_expired`（不另訂 `cancelled_by`／`system`）。舊歷程沒有 `source` 的取消案件回填為 NULL。
- 送單缺 `slot_id`／`email`、補登缺 `slot_id`：由 schema 必填擋下，回 FastAPI 標準 422（`detail[].loc` 指到欄位），不另訂 `SLOT_REQUIRED`／`EMAIL_REQUIRED` 代碼。官網依 `loc` 標欄位錯誤。
- 家長改資料的版本衝突沿用既有代碼 `VISIT_REQUEST_VERSION_CONFLICT`。
- 送單回應欄位叫 `manage_path`（`/visit/manage#token=…`，相對路徑），不是完整網址；信件用 `WEBSITE_ADMIN_ORIGIN` 組完整網址。
- 更換 `WEBSITE_SESSION_SECRET` 的影響：已發出的連結**仍可用到到期**（兌換只比對雜湊），但系統無法再重算這些連結（重送、寄信拿不到連結）；園方可按「重新產生連結並寄出」補發。
- migration 切成暫停時的預設說明是「線上預約即將開放，歡迎來電洽詢。」（分校電話存在 CMS 內容，不在 `campuses` 表，migration 不讀）。
- `details_updated` 歷程只記改了哪些欄位名稱（`after={"fields": [...]}`），不記內容（歷程表規定不放個資）。
- `booking_mode` 是 PG native enum，**存的是大寫名稱**（`'INQUIRY'`、`'SLOTS'`、`'PAUSED'`），SQL 字面值一律大寫。

## 執行注意

- A2 起會讓約 178 個既有測試變紅（見附錄 `2026-09-30-parent-self-booking-A-test-migration.md`），A8 統一修。**A2–A7 每個 task 只跑自己的新測試檔**，全套在 A8 之後才會綠。
- 所有新測試檔頂端加 `pytestmark = pytest.mark.usefixtures("booking_consent")`（切 slots 模式需要已發布的同意文字）。
- 跑單一測試檔：`cd backend && uv run pytest tests/<file>.py -q`（需要時加 `WEBSITE_TEST_DATABASE_URL=…`，見總覽）。

## 檔案結構

| 檔案 | 動作 | 責任 |
|---|---|---|
| `backend/migrations/versions/c7d2e9f4a1b8_parent_self_booking.py` | 新增 | `cancel_reason` 欄位、回填、inquiry 退場、全面自動確認 |
| `backend/app/booking/models.py` | 修改 | `VisitRequest.cancel_reason` |
| `backend/app/booking/status_groups.py` | 新增 | 顯示狀態與分組條件（純函式＋SQL 條件） |
| `backend/app/booking/access_service.py` | 修改 | 可重算的修改連結、有效期、確保／延長 |
| `backend/app/booking/outbox.py` | 修改 | 家長信 kind 常數與 `enqueue_parent_email` |
| `backend/app/notifications/parent_email.py` | 新增 | 家長信內容（純函式） |
| `backend/app/notifications/service.py` | 修改 | 家長信派送分支、`_KIND_LABELS` |
| `backend/app/booking/service.py` | 修改 | 送單只收 slots、一律成立、發連結、排家長信；`update_config` |
| `backend/app/booking/workflow_service.py` | 修改 | 刪 `mark_contacting`；取消記原因；改期延長連結；家長改資料；排家長信 |
| `backend/app/booking/schemas.py` | 修改 | 送單必填、回應 `manage_path`、家長輸出、改資料請求、分組輸出 |
| `backend/app/booking/routes.py` | 修改 | 送單回應、退場端點、分組篩選與計數、月曆欄位、補登 |
| `backend/app/booking/access_routes.py` | 修改 | 家長直接改期、改資料、退場申請改期、重寄確認信、重新產生連結 |
| `backend/app/booking/readiness.py` | 修改 | 表單模式只剩 slots |
| `backend/app/booking/attention.py` | 修改 | 只有休假日關閉才列待人工處理 |
| `backend/app/booking/schedule_routes.py` | 修改 | 存規則即補場次 |
| `backend/app/workers/runner.py`、`workers/maintenance.py` | 修改 | 把 `access_secret` 傳給派送 |
| `backend/tests/conftest.py` | 修改 | `create_slot`、`book_slot`、`legacy_request`、`legacy_reschedule_request`、`open_manage`；ParentClient 補 email |
| `backend/tests/test_self_booking_*.py` 等新檔 | 新增 | 各 task 的測試 |
| `admin/src/api/labels.ts` | 修改 | 新 kind、audit action、歷程事件的中文 |
| `contracts/openapi.json`、`contracts/generated/website-api.d.ts` | 重產 | 契約 |

---

### Task A1：Migration、`cancel_reason` 欄位與測試 helper

**Files:**
- Create: `backend/migrations/versions/c7d2e9f4a1b8_parent_self_booking.py`
- Modify: `backend/app/booking/models.py`（`VisitRequest` 類別，約 97–188 行）
- Modify: `backend/tests/conftest.py`（`ParentClient.post` 約 199 行；檔尾加 helper）
- Test: `backend/tests/test_self_booking_migration.py`

**Interfaces:**
- Produces（conftest，後面所有 task 使用）：
  - `async def create_slot(admin_client, campus_key: str = "yihua", *, days_ahead: int = 3, start_time: str = "10:00:00", end_time: str = "11:00:00", capacity: int = 2) -> str`
  - `async def book_slot(admin_client, public_client, campus_key: str = "yihua", *, days_ahead: int = 3, start_time: str = "10:00:00", end_time: str = "11:00:00", capacity: int = 2, idempotency_key: str | None = None, **fields) -> dict`，回傳鍵 `receipt_id`、`slot_id`、`slot_date`、`manage_path`、`response`
  - `async def legacy_request(db, *, campus_key="yihua", status="new", slot_id=None, hold_expires_at=None, email=None, parent_name="舊案家長", phone="0911000111", source="web", party_size=2) -> str`
  - `async def legacy_reschedule_request(db, visit_request_id, requested_slot_id) -> str`
  - `async def open_manage(public_client, manage_path: str) -> dict`（A3 起才有 `manage_path`，A1 先寫好）
  - migration 模組函式 `backfill_cancel_reasons(conn) -> None`、`migrate_booking_modes(conn) -> list[dict]`
  - `VisitRequest.cancel_reason: str | None`

- [ ] **Step 1：確認 alembic head**

```bash
cd /private/tmp/ivy-website-self-booking-20260930/backend
WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev \
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test \
WEBSITE_SESSION_SECRET=local-test-session-secret-0930 uv run alembic heads
```
Expected: `e9c3a7d5f214 (head)`。若不是，下一步的 `down_revision` 改成實際 head，並回報。

- [ ] **Step 2：寫失敗的測試**

`backend/tests/test_self_booking_migration.py`：

```python
from __future__ import annotations

import importlib.util
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import select

from app.booking import schedule_service, service
from app.booking.models import BookingConfig, BookingMode, VisitRequest, VisitRequestEvent
from app.operations.models import AuditLogEntry
from tests.conftest import legacy_request

_MIGRATION = (
    Path(__file__).resolve().parents[1] / "migrations" / "versions" / "c7d2e9f4a1b8_parent_self_booking.py"
)


def _migration():
    spec = importlib.util.spec_from_file_location("parent_self_booking_migration", _MIGRATION)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


async def _run(db_session, fn):
    conn = await db_session.connection()
    result = await conn.run_sync(fn)
    await db_session.commit()
    return result


async def _config(db_session, campus_key: str, *, mode: BookingMode, message: str | None = None) -> BookingConfig:
    config = await service.get_or_create_config(db_session, campus_key)
    config.mode = mode
    config.message = message
    config.slots_auto_confirm = False
    await db_session.commit()
    return config


@pytest.mark.asyncio
async def test_inquiry_campuses_switch_to_slots_or_paused(db_session):
    await _config(db_session, "yihua", mode=BookingMode.INQUIRY)
    await _config(db_session, "minghua", mode=BookingMode.INQUIRY)
    await _config(db_session, "chongde", mode=BookingMode.INQUIRY, message="暑假暫停參觀")
    await _config(db_session, "renwu", mode=BookingMode.LINE)
    await schedule_service.replace_rules(
        db_session,
        "yihua",
        [{"weekday": 0, "start_time": "10:00:00", "end_time": "11:00:00", "slot_minutes": 60, "capacity": 1}],
        None,
    )
    await db_session.commit()
    versions = {
        key: (await db_session.get(BookingConfig, key)).version for key in ("yihua", "minghua", "chongde", "renwu")
    }

    changes = await _run(db_session, _migration().migrate_booking_modes)

    assert sorted((c["campus_key"], c["mode"]) for c in changes) == [
        ("chongde", "paused"),
        ("minghua", "paused"),
        ("yihua", "slots"),
    ]
    db_session.expire_all()
    yihua = await db_session.get(BookingConfig, "yihua")
    minghua = await db_session.get(BookingConfig, "minghua")
    chongde = await db_session.get(BookingConfig, "chongde")
    renwu = await db_session.get(BookingConfig, "renwu")
    assert yihua.mode == BookingMode.SLOTS
    assert minghua.mode == BookingMode.PAUSED
    assert minghua.message == "線上預約即將開放，歡迎來電洽詢。"
    assert chongde.message == "暑假暫停參觀"
    assert renwu.mode == BookingMode.LINE
    assert all(c.slots_auto_confirm for c in (yihua, minghua, chongde, renwu))
    assert yihua.version > versions["yihua"]
    assert renwu.version > versions["renwu"]  # 自動確認改了也要讓舊表單重新讀設定
    audits = (
        await db_session.execute(
            select(AuditLogEntry).where(AuditLogEntry.action == "booking_config.migrate_self_booking")
        )
    ).scalars().all()
    assert sorted(a.campus_key for a in audits) == ["chongde", "minghua", "yihua"]
    assert all(a.metadata_json["before"] == {"mode": "inquiry"} for a in audits)


@pytest.mark.asyncio
async def test_cancel_reason_is_backfilled_from_history(db_session):
    by_parent = await legacy_request(db_session, status="cancelled", phone="0911000001")
    by_staff = await legacy_request(db_session, status="cancelled", phone="0911000002")
    expired = await legacy_request(db_session, status="cancelled", phone="0911000003")
    unknown = await legacy_request(db_session, status="cancelled", phone="0911000004")
    now = datetime.now(timezone.utc)
    for visit_id, event_type, source in (
        (by_parent, "cancelled", "parent"),
        (by_staff, "cancelled", "staff"),
        (expired, "hold_expired", "system"),
        (unknown, "cancelled", None),
    ):
        db_session.add(
            VisitRequestEvent(
                id=uuid.uuid4(), visit_request_id=uuid.UUID(visit_id), event_type=event_type, created_at=now, source=source
            )
        )
    await db_session.commit()

    await _run(db_session, _migration().backfill_cancel_reasons)

    db_session.expire_all()
    reasons = {
        visit_id: (await db_session.get(VisitRequest, uuid.UUID(visit_id))).cancel_reason
        for visit_id in (by_parent, by_staff, expired, unknown)
    }
    assert reasons == {by_parent: "parent", by_staff: "staff", expired: "hold_expired", unknown: None}
```

- [ ] **Step 3：跑測試確認失敗**

Run: `cd backend && uv run pytest tests/test_self_booking_migration.py -q`
Expected: FAIL（`ImportError: cannot import name 'legacy_request'` 或找不到 migration 檔）。

- [ ] **Step 4：加 model 欄位**

`backend/app/booking/models.py` 的 `VisitRequest`：`__table_args__` 加一個 CheckConstraint，欄位放在 `cancelled_at` 下面：

```python
    __table_args__ = (
        UniqueConstraint("campus_key", "idempotency_key", name="uq_visit_request_idempotency"),
        CheckConstraint("party_size IS NULL OR party_size BETWEEN 1 AND 10", name="ck_visit_requests_party_size"),
        CheckConstraint(
            "cancel_reason IS NULL OR cancel_reason IN ('parent', 'staff', 'hold_expired')",
            name="ck_visit_requests_cancel_reason",
        ),
    )
```

```python
    # 誰取消的（值同 app.operations.models.CANCEL_REASONS）；後台列表寫「家長取消／園方取消／逾期未確認」。
    # 2026-09-30 以前、歷程沒有記來源的舊取消案件為 NULL。
    cancel_reason: Mapped[str | None] = mapped_column(String(16), nullable=True)
```

- [ ] **Step 5：寫 migration**

`backend/migrations/versions/c7d2e9f4a1b8_parent_self_booking.py`：

```python
"""家長自選場次（2026-09-30 業主裁定）：退場「填表待聯絡」、全面送出即成立、案件記取消原因。

資料改寫：
- booking_configs：mode=INQUIRY 的分校，有每週規則或未來可預約場次 → SLOTS，否則 → PAUSED
  （沒有暫停說明時填預設文案）；所有列 slots_auto_confirm=true；有改動的列 version+1，
  讓還開著舊表單的家長送出時收到 BOOKING_CONFIG_CHANGED。每一校的模式切換寫一筆稽核。
- visit_requests.cancel_reason：從歷程回填（hold_expired → hold_expired；cancelled 依 source）。

downgrade 只移除 cancel_reason，不把模式改回 inquiry。
"""

from __future__ import annotations

import json
import uuid

import sqlalchemy as sa
from alembic import op

revision = "c7d2e9f4a1b8"
down_revision = "e9c3a7d5f214"
branch_labels = None
depends_on = None

PAUSED_MESSAGE = "線上預約即將開放，歡迎來電洽詢。"


def backfill_cancel_reasons(conn) -> None:
    conn.execute(
        sa.text(
            """
            UPDATE visit_requests AS vr
            SET cancel_reason = CASE
                WHEN e.event_type = 'hold_expired' THEN 'hold_expired'
                WHEN e.source = 'parent' THEN 'parent'
                WHEN e.source = 'staff' THEN 'staff'
                ELSE NULL
            END
            FROM (
                SELECT DISTINCT ON (visit_request_id) visit_request_id, event_type, source
                FROM visit_request_events
                WHERE event_type IN ('cancelled', 'hold_expired')
                ORDER BY visit_request_id, created_at DESC
            ) AS e
            WHERE vr.id = e.visit_request_id AND vr.status = 'cancelled'
            """
        )
    )


def migrate_booking_modes(conn) -> list[dict]:
    # booking_mode 是 native enum，存的是大寫名稱。
    rows = conn.execute(
        sa.text("SELECT campus_key, message FROM booking_configs WHERE mode = 'INQUIRY' ORDER BY campus_key")
    ).mappings().all()
    changes: list[dict] = []
    for row in rows:
        has_schedule = conn.execute(
            sa.text(
                """
                SELECT EXISTS (SELECT 1 FROM visit_rules WHERE campus_key = :key)
                    OR EXISTS (
                        SELECT 1 FROM visit_slots
                        WHERE campus_key = :key AND closed = false
                          AND slot_date >= (now() AT TIME ZONE 'Asia/Taipei')::date
                    )
                """
            ),
            {"key": row["campus_key"]},
        ).scalar()
        target = "slots" if has_schedule else "paused"
        message = row["message"]
        if target == "paused" and not (message or "").strip():
            message = PAUSED_MESSAGE
        conn.execute(
            sa.text(
                """
                UPDATE booking_configs
                SET mode = CAST(:mode AS booking_mode), message = :message, updated_at = now()
                WHERE campus_key = :key
                """
            ),
            {"mode": target.upper(), "message": message, "key": row["campus_key"]},
        )
        conn.execute(
            sa.text(
                """
                INSERT INTO audit_log_entries
                    (id, actor_user_id, action, target_type, target_id, campus_key, metadata_json, created_at)
                VALUES
                    (:id, NULL, 'booking_config.migrate_self_booking', 'booking_config', :key, :key,
                     CAST(:metadata AS JSON), now())
                """
            ),
            {
                "id": uuid.uuid4(),
                "key": row["campus_key"],
                "metadata": json.dumps({"before": {"mode": "inquiry"}, "after": {"mode": target}}),
            },
        )
        changes.append({"campus_key": row["campus_key"], "mode": target})
    conn.execute(
        sa.text(
            """
            UPDATE booking_configs
            SET slots_auto_confirm = true, version = version + 1, updated_at = now()
            WHERE slots_auto_confirm = false OR campus_key = ANY(:changed)
            """
        ),
        {"changed": [c["campus_key"] for c in changes]},
    )
    return changes


def upgrade() -> None:
    op.add_column("visit_requests", sa.Column("cancel_reason", sa.String(16), nullable=True))
    op.create_check_constraint(
        "ck_visit_requests_cancel_reason",
        "visit_requests",
        "cancel_reason IS NULL OR cancel_reason IN ('parent', 'staff', 'hold_expired')",
    )
    bind = op.get_bind()
    backfill_cancel_reasons(bind)
    migrate_booking_modes(bind)


def downgrade() -> None:
    op.drop_constraint("ck_visit_requests_cancel_reason", "visit_requests", type_="check")
    op.drop_column("visit_requests", "cancel_reason")
```

- [ ] **Step 6：conftest 補 helper**

`backend/tests/conftest.py`：

1. `ParentClient.post` 內，`body.setdefault("party_size", 2)` 下一行加：

```python
            # 2026-09-30 起官網送單 Email 必填；要驗缺 Email 的測試自己帶 None。
            body.setdefault("email", "parent@example.com")
```

2. 檔尾加（`today_local` 從 `app.common.timezones` import；`timedelta`、`datetime`、`timezone`、`uuid` 若檔頭沒有就補 import）：

```python
async def create_slot(
    admin_client,
    campus_key: str = "yihua",
    *,
    days_ahead: int = 3,
    start_time: str = "10:00:00",
    end_time: str = "11:00:00",
    capacity: int = 2,
) -> str:
    slot_date = (today_local() + timedelta(days=days_ahead)).isoformat()
    response = await admin_client.post(
        f"/api/website/v1/admin/slots?campus_key={campus_key}",
        json={"slot_date": slot_date, "start_time": start_time, "end_time": end_time, "capacity": capacity},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def book_slot(
    admin_client,
    public_client,
    campus_key: str = "yihua",
    *,
    days_ahead: int = 3,
    start_time: str = "10:00:00",
    end_time: str = "11:00:00",
    capacity: int = 2,
    idempotency_key: str | None = None,
    **fields,
) -> dict:
    """官網家長選一個場次送出（送出即 confirmed）。先建時段再切 slots，
    set_booking_mode 就不會另外補每週規則。"""
    slot_id = await create_slot(
        admin_client, campus_key, days_ahead=days_ahead, start_time=start_time, end_time=end_time, capacity=capacity
    )
    mode = await set_booking_mode(admin_client, campus_key, mode="slots")
    assert mode.status_code == 200, mode.text
    body = {
        "campus_key": campus_key,
        "config_version": mode.json()["version"],
        "parent_name": "陳媽媽",
        "phone": "0912345678",
        "consent_given": True,
        "slot_id": slot_id,
        **fields,
    }
    response = await public_client.post(
        VISIT_SUBMIT_PATH, json=body, headers={"Idempotency-Key": idempotency_key or f"book-{slot_id}"}
    )
    assert response.status_code in (200, 201), response.text
    return {
        "receipt_id": response.json()["receipt_id"],
        "slot_id": slot_id,
        "slot_date": (today_local() + timedelta(days=days_ahead)).isoformat(),
        "manage_path": response.json().get("manage_path"),
        "response": response,
    }


async def legacy_request(
    db: AsyncSession,
    *,
    campus_key: str = "yihua",
    status: str = "new",
    slot_id=None,
    hold_expires_at: datetime | None = None,
    email: str | None = None,
    parent_name: str = "舊案家長",
    phone: str = "0911000111",
    source: str = "web",
    party_size: int | None = 2,
) -> str:
    """本案上線前才會產生的案件（new／contacting／pending_confirmation 等）。
    新流程沒有 API 能建出這些狀態，直接寫 DB；不產生 outbox、analytics、歷程。"""
    from app.booking.models import VisitRequest

    visit_request = VisitRequest(
        id=uuid.uuid4(),
        campus_key=campus_key,
        idempotency_key=f"legacy-{uuid.uuid4().hex}",
        payload_hash="0" * 64,
        config_version=0,
        parent_name=parent_name,
        phone=phone,
        email=email,
        referral_sources=[],
        party_size=party_size,
        consent_given=True,
        status=status,
        source=source,
        slot_id=uuid.UUID(str(slot_id)) if slot_id else None,
        hold_expires_at=hold_expires_at,
        created_at=datetime.now(timezone.utc),
    )
    db.add(visit_request)
    await db.commit()
    return str(visit_request.id)


async def legacy_reschedule_request(db: AsyncSession, visit_request_id, requested_slot_id) -> str:
    """家長「申請改期」已退場；後台核准／退回仍要處理舊資料。"""
    from app.booking.access_models import RescheduleRequest

    record = RescheduleRequest(
        id=uuid.uuid4(),
        visit_request_id=uuid.UUID(str(visit_request_id)),
        requested_slot_id=uuid.UUID(str(requested_slot_id)),
        status="pending",
        created_at=datetime.now(timezone.utc),
    )
    db.add(record)
    await db.commit()
    return str(record.id)


async def open_manage(public_client, manage_path: str) -> dict:
    """用送單回應的修改連結換家長 session（cookie 留在 public_client）。"""
    token = manage_path.split("token=", 1)[1]
    response = await public_client.post("/api/website/v1/public/visit-manage/exchange", json={"token": token})
    assert response.status_code == 200, response.text
    return response.json()
```

- [ ] **Step 7：升級測試庫並跑測試**

```bash
cd backend
WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev \
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test \
WEBSITE_SESSION_SECRET=local-test-session-secret-0930 uv run alembic upgrade head
uv run pytest tests/test_self_booking_migration.py -q
```
Expected: `2 passed`。再跑一次 `alembic downgrade -1 && alembic upgrade head`（同樣的環境變數）確認可逆。

- [ ] **Step 8：Commit（需使用者已授權）**

```bash
git add backend/migrations/versions/c7d2e9f4a1b8_parent_self_booking.py backend/app/booking/models.py \
  backend/tests/conftest.py backend/tests/test_self_booking_migration.py
git commit -m "feat(booking): 退場填表待聯絡的 migration 與取消原因欄位

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A2：送單只收場次且一律成立；退場 inquiry 與「聯絡中」；補登必選場次；記錄取消原因

**Files:**
- Modify: `backend/app/booking/schemas.py`（`VisitRequestCreate` 約 306 行、`VisitRequestManualCreate` 約 321 行、`BookingConfigOut` 約 114 行、`BookingConfigUpdateRequest` 約 129 行、`PublicBookingConfigOut` 約 206 行）
- Modify: `backend/app/booking/service.py`（`_validate_submission` 228 行起、`submit_visit_request` 380–396 行、`update_config` 116 行、`CONFIG_AUDIT_FIELDS` 66 行、`HOLD_TTL`）
- Modify: `backend/app/booking/workflow_service.py`（刪 `mark_contacting` 190 行起；`cancel` 162 行；`expire_holds` 348 行）
- Modify: `backend/app/booking/routes.py`（PATCH booking-config 約 112 行、公開 booking-config 212 行、`/contacting` 1517 行、補登 1036 行）
- Modify: `backend/app/booking/readiness.py`（`FORM_MODES` 64 行）
- Test: `backend/tests/test_self_booking_submit.py`

**Interfaces:**
- Consumes: A1 的 `create_slot`、`book_slot`、`legacy_request`、`set_booking_mode`、`start_visit_slot`。
- Produces: `VisitRequestCreate.slot_id: uuid.UUID`（必填）、`VisitRequestCreate.email: EmailStr`（必填）、`VisitRequestManualCreate.slot_id: uuid.UUID`（必填）；`BookingConfigOut`／`PublicBookingConfigOut` 不再有 `slots_auto_confirm`；`VisitRequest.cancel_reason` 在取消時寫入。

- [ ] **Step 1：寫失敗的測試**

`backend/tests/test_self_booking_submit.py`：

```python
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.booking import service
from app.booking.models import BookingMode
from app.booking.workflow_service import expire_holds
from tests.conftest import book_slot, create_slot, legacy_request, set_booking_mode

pytestmark = pytest.mark.usefixtures("booking_consent")
API = "/api/website/v1"


async def _slots_mode(admin_client) -> tuple[str, int]:
    slot_id = await create_slot(admin_client)
    response = await set_booking_mode(admin_client, "yihua", mode="slots")
    assert response.status_code == 200, response.text
    return slot_id, response.json()["version"]


def _body(version: int, **extra) -> dict:
    return {
        "campus_key": "yihua",
        "config_version": version,
        "parent_name": "陳媽媽",
        "phone": "0912345678",
        "consent_given": True,
        **extra,
    }


@pytest.mark.asyncio
async def test_submission_is_confirmed_even_if_old_config_said_manual(admin_client, public_client, db_session):
    slot_id, version = await _slots_mode(admin_client)
    config = await service.get_or_create_config(db_session, "yihua")
    config.slots_auto_confirm = False  # 上線前的舊設定列
    await db_session.commit()

    response = await public_client.post(
        f"{API}/public/visit-requests", json=_body(version, slot_id=slot_id), headers={"Idempotency-Key": "self-01"}
    )

    assert response.status_code == 201, response.text
    assert response.json()["status"] == "confirmed"
    detail = (await admin_client.get(f"{API}/admin/visit-requests/{response.json()['receipt_id']}")).json()
    assert detail["hold_expires_at"] is None
    assert detail["confirmed_at"] is not None


@pytest.mark.asyncio
async def test_submission_needs_a_slot_and_an_email(admin_client, public_client):
    slot_id, version = await _slots_mode(admin_client)

    no_slot = await public_client.post(
        f"{API}/public/visit-requests", json=_body(version), headers={"Idempotency-Key": "self-02"}
    )
    no_email = await public_client.post(
        f"{API}/public/visit-requests",
        json=_body(version, slot_id=slot_id, email=None),
        headers={"Idempotency-Key": "self-03"},
    )

    assert no_slot.status_code == 422
    assert ["body", "slot_id"] in [error["loc"] for error in no_slot.json()["detail"]]
    assert no_email.status_code == 422
    assert ["body", "email"] in [error["loc"] for error in no_email.json()["detail"]]


@pytest.mark.asyncio
async def test_inquiry_mode_can_no_longer_be_selected(admin_client):
    response = await set_booking_mode(admin_client, "yihua", mode="inquiry")

    assert response.status_code == 400
    assert response.json()["detail"]["code"] == "BOOKING_MODE_RETIRED"


@pytest.mark.asyncio
async def test_leftover_inquiry_config_is_shown_as_paused(admin_client, public_client, db_session):
    config = await service.get_or_create_config(db_session, "yihua")
    config.mode = BookingMode.INQUIRY
    config.message = None
    await db_session.commit()

    public = (await public_client.get(f"{API}/public/booking-config/yihua")).json()

    assert public["mode"] == "paused"
    assert public["message"] == "線上預約即將開放，歡迎來電洽詢。"
    assert "slots_auto_confirm" not in public


@pytest.mark.asyncio
async def test_contacting_endpoint_is_retired(admin_client, db_session):
    case_id = await legacy_request(db_session, status="new")

    response = await admin_client.post(f"{API}/admin/visit-requests/{case_id}/contacting")

    assert response.status_code == 410
    assert response.json()["detail"]["code"] == "ENDPOINT_RETIRED"


@pytest.mark.asyncio
async def test_manual_entry_requires_a_slot_and_is_confirmed(admin_client):
    base = {"campus_key": "yihua", "source": "phone", "parent_name": "王先生", "phone": "0933111222", "consent_given": True}

    missing = await admin_client.post(
        f"{API}/admin/visit-requests", json=base, headers={"Idempotency-Key": "manual-self-01"}
    )
    slot_id = await create_slot(admin_client, days_ahead=1)  # 24 小時預約窗內，園方仍可排
    created = await admin_client.post(
        f"{API}/admin/visit-requests", json={**base, "slot_id": slot_id}, headers={"Idempotency-Key": "manual-self-02"}
    )

    assert missing.status_code == 422
    assert ["body", "slot_id"] in [error["loc"] for error in missing.json()["detail"]]
    assert created.status_code == 201, created.text
    assert created.json()["status"] == "confirmed"
    assert created.json()["slot"]["id"] == slot_id


@pytest.mark.asyncio
async def test_cancel_records_who_cancelled(admin_client, public_client, db_session):
    booked = await book_slot(admin_client, public_client)
    cancelled = await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/cancel", json={})
    assert cancelled.status_code == 200, cancelled.text

    slot_id = await create_slot(admin_client, days_ahead=5, start_time="14:00:00", end_time="15:00:00")
    expired_id = await legacy_request(
        db_session,
        status="pending_confirmation",
        slot_id=slot_id,
        hold_expires_at=datetime.now(timezone.utc) - timedelta(minutes=1),
    )
    await expire_holds(db_session)
    await db_session.commit()

    staff = (await admin_client.get(f"{API}/admin/visit-requests/{booked['receipt_id']}")).json()
    system = (await admin_client.get(f"{API}/admin/visit-requests/{expired_id}")).json()
    assert staff["cancel_reason"] == "staff"
    assert system["cancel_reason"] == "hold_expired"
```

（`cancel_reason` 由 Step 3 加進 `VisitRequestDetailOut`，所以最後一個測試在本 task 就能過。）

- [ ] **Step 2：跑測試確認失敗**

Run: `cd backend && uv run pytest tests/test_self_booking_submit.py -q`
Expected: 多數 FAIL（status `pending_confirmation`、沒有 422、inquiry 仍可切、`/contacting` 仍 200…）。

- [ ] **Step 3：schema**

`backend/app/booking/schemas.py`：

```python
class VisitRequestCreate(_VisitRequestFields):
    # 2026-09-30 起官網只剩自選場次：場次與 Email 必填（確認信與修改連結寄到這裡）。
    email: EmailStr = Field(max_length=254)
    slot_id: uuid.UUID
    config_version: int
    consent_revision_id: uuid.UUID | None = None
    turnstile_token: str | None = Field(default=None, max_length=2048)
```

`VisitRequestManualCreate`：把 `slot_id` 改成必填 `slot_id: uuid.UUID`（補登一律直接排入場次）。

`VisitRequestDetailOut`：在 `cancelled_at` 下面加 `cancel_reason: str | None = None`。

`BookingConfigOut`、`PublicBookingConfigOut`：刪除 `slots_auto_confirm` 欄位。`BookingConfigUpdateRequest`：刪除 `slots_auto_confirm` 欄位（舊後台多送的欄位會被 pydantic 忽略）。

- [ ] **Step 4：service**

`backend/app/booking/service.py`：

1. `_validate_submission`：

```python
    if config.mode != BookingMode.SLOTS:
        raise BookingUnavailable()
```
取代原本的 `if config.mode not in (BookingMode.INQUIRY, BookingMode.SLOTS)`；刪除 `if config.mode != BookingMode.SLOTS: return accepted_consent, None` 與 `if not slot_id: raise BookingUnavailable()` 兩段（schema 已保證有 `slot_id`）。

2. `submit_visit_request` 的狀態區塊換成：

```python
    # 2026-09-30 業主裁定：只有自選場次，送出即預約成立（不再有人工確認與占位）。
    status = VisitRequestStatus.CONFIRMED.value
    confirmed_at = now
    hold_expires_at = None
    slot_id = str(slot.id)
```
並刪除 `elif status == VisitRequestStatus.PENDING_CONFIRMATION.value:` 那段 enqueue。`if status == VisitRequestStatus.CONFIRMED.value:` 改成無條件執行（保留 `visit_request_confirmed` outbox 與 `VISIT_CONFIRMED` 統計）。`HOLD_TTL` 若已無人使用就刪（`grep -rn HOLD_TTL backend/app`）。

3. `update_config`：刪掉 `slots_auto_confirm` 參數，函式內改成 `config.slots_auto_confirm = True`；`CONFIG_AUDIT_FIELDS` 移除 `"slots_auto_confirm"`（若有）。`grep -rn "slots_auto_confirm" backend/app` 清掉其他引用（`readiness.py`、`routes.py` 呼叫 `update_config` 的地方）。

- [ ] **Step 5：readiness、routes**

`readiness.py`：`FORM_MODES = (BookingMode.SLOTS,)`。

`routes.py` PATCH `/admin/booking-config/{campus_key}`：在權限檢查之後、呼叫 readiness 之前加：

```python
    if payload.mode == BookingMode.INQUIRY:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "BOOKING_MODE_RETIRED",
                "message": "「填表後由園方聯絡」已停用，請改用自選場次，或暫停線上預約",
            },
        )
```

公開 `GET /public/booking-config/{campus_key}`：在建出輸出物件之後加：

```python
    # 上線前的舊設定：填表待聯絡已退場，官網一律當成暫停。
    if output.mode == BookingMode.INQUIRY:
        output.mode = BookingMode.PAUSED
        output.message = output.message or "線上預約即將開放，歡迎來電洽詢。"
```
（變數名依該函式實際寫法；它原本就有「分校停用時改 PAUSED」的同類邏輯，放在它旁邊。）

`/admin/visit-requests/{visit_request_id}/contacting`：整個函式換成：

```python
@router.post("/admin/visit-requests/{visit_request_id}/contacting", include_in_schema=False)
async def mark_contacting_retired(visit_request_id: uuid.UUID) -> None:
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail={"code": "ENDPOINT_RETIRED", "message": "「聯絡中」已停用，請直接排入場次或取消"},
    )
```

補登 `POST /admin/visit-requests`：`slot_id` 已必填；確認該 handler 在建案後一定呼叫 `workflow_service.confirm_with_slot`（把原本的 `if payload.slot_id:` 條件拿掉），SlotFull／SlotClosed／SlotNotBookable 的錯誤對應沿用原樣。

- [ ] **Step 6：workflow_service**

刪除 `mark_contacting` 整個函式與 `__all__` 中的引用（`grep -rn mark_contacting backend/app` 應為 0）。

`cancel`：在 `visit_request.hold_expires_at = None` 下一行加，並讓統計沿用同一個值：

```python
    reason_code = analytics_service.cancel_reason(actor)
    visit_request.cancel_reason = reason_code
```
```python
    await analytics_service.record_cancelled(db, visit_request, reason=reason_code)
```

`expire_holds`：逐筆設 `CANCELLED` 的地方加 `visit_request.cancel_reason = CANCEL_REASON_HOLD_EXPIRED`。

- [ ] **Step 7：跑測試**

Run: `cd backend && uv run pytest tests/test_self_booking_submit.py -q`
Expected: `7 passed`。

- [ ] **Step 8：Commit（需授權）**

```bash
git add backend/app/booking/schemas.py backend/app/booking/service.py backend/app/booking/workflow_service.py \
  backend/app/booking/routes.py backend/app/booking/readiness.py backend/tests/test_self_booking_submit.py
git commit -m "feat(booking): 官網只收自選場次、送出即成立，退場填表待聯絡與聯絡中

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A3：修改連結（可重算、送單即發、重送同一條）

**Files:**
- Modify: `backend/app/booking/access_service.py`
- Modify: `backend/app/booking/service.py`（`submit_visit_request` 簽章與建案後）
- Modify: `backend/app/booking/routes.py`（公開送單 335–530 行、`/confirm` 1314 行、補登 1036 行）
- Modify: `backend/app/booking/access_routes.py`（`access-link` 229 行）
- Modify: `backend/app/booking/workflow_service.py`（`reschedule` 270 行）
- Modify: `backend/app/booking/schemas.py`（`VisitRequestOut` 387 行）
- Test: `backend/tests/test_parent_manage_link.py`

**Interfaces:**
- Consumes: A1 helper、A2 的送單。
- Produces（`app.booking.access_service`）：
  - `TOKEN_MIN_TTL = timedelta(days=14)`、`TOKEN_AFTER_VISIT = timedelta(days=7)`（取代 `TOKEN_TTL`）
  - `def token_expiry(slot: VisitSlot | None, now: datetime) -> datetime`
  - `def manage_path(raw_token: str) -> str` → `"/visit/manage#token=<raw>"`
  - `async def create_access_token(db, visit_request_id: uuid.UUID, *, secret: str, slot: VisitSlot | None) -> tuple[str, datetime]`
  - `async def issue_access_token(db, visit_request_id, *, secret, slot) -> tuple[str, datetime]`（先撤銷再建）
  - `async def ensure_access_token(db, visit_request_id, *, secret, slot) -> None`
  - `async def current_manage_path(db, visit_request_id, *, secret: str) -> str | None`
  - `async def extend_token_expiry(db, visit_request_id, slot: VisitSlot) -> None`
  - `service.submit_visit_request(..., access_secret: str)`（新增必填關鍵字參數）
  - `VisitRequestOut.manage_path: str | None`

- [ ] **Step 1：寫失敗的測試**

`backend/tests/test_parent_manage_link.py`：

```python
from __future__ import annotations

import hashlib
import uuid
from datetime import date, time, timedelta

import pytest
from sqlalchemy import select

from app.booking import access_service
from app.booking.access_models import ParentAccessToken
from app.booking.models import OutboxMessage
from app.common.timezones import slot_start_utc
from tests.conftest import VISIT_SUBMIT_PATH, book_slot, create_slot, open_manage

pytestmark = pytest.mark.usefixtures("booking_consent")
API = "/api/website/v1"


@pytest.mark.asyncio
async def test_submission_returns_a_manage_path_that_opens_the_booking(admin_client, public_client):
    booked = await book_slot(admin_client, public_client)

    assert booked["manage_path"].startswith("/visit/manage#token=")
    assert booked["response"].headers["cache-control"] == "no-store"
    opened = await open_manage(public_client, booked["manage_path"])
    assert opened["id"] == booked["receipt_id"]


@pytest.mark.asyncio
async def test_replay_returns_the_same_manage_path(admin_client, public_client):
    booked = await book_slot(admin_client, public_client, idempotency_key="link-replay-01")
    body = {
        "campus_key": "yihua",
        "config_version": (await admin_client.get(f"{API}/admin/booking-config/yihua")).json()["version"],
        "parent_name": "陳媽媽",
        "phone": "0912345678",
        "consent_given": True,
        "slot_id": booked["slot_id"],
    }

    replay = await public_client.post(VISIT_SUBMIT_PATH, json=body, headers={"Idempotency-Key": "link-replay-01"})

    assert replay.status_code == 200, replay.text
    assert replay.json()["manage_path"] == booked["manage_path"]


@pytest.mark.asyncio
async def test_replay_after_cancel_has_no_manage_path(admin_client, public_client):
    booked = await book_slot(admin_client, public_client, idempotency_key="link-replay-02")
    config_version = (await admin_client.get(f"{API}/admin/booking-config/yihua")).json()["version"]
    await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/cancel", json={})
    body = {
        "campus_key": "yihua",
        "config_version": config_version,
        "parent_name": "陳媽媽",
        "phone": "0912345678",
        "consent_given": True,
        "slot_id": booked["slot_id"],
    }

    replay = await public_client.post(VISIT_SUBMIT_PATH, json=body, headers={"Idempotency-Key": "link-replay-02"})

    assert replay.status_code == 200, replay.text
    assert replay.json()["status"] == "cancelled"
    assert replay.json()["manage_path"] is None


@pytest.mark.asyncio
async def test_raw_token_is_never_stored(admin_client, public_client, db_session):
    booked = await book_slot(admin_client, public_client)
    raw = booked["manage_path"].split("token=", 1)[1]

    tokens = (await db_session.execute(select(ParentAccessToken))).scalars().all()
    payloads = (await db_session.execute(select(OutboxMessage.payload))).scalars().all()

    assert [t.token_hash for t in tokens] == [hashlib.sha256(raw.encode()).hexdigest()]
    assert all(raw not in str(payload) for payload in payloads)


@pytest.mark.asyncio
async def test_link_lasts_until_a_week_after_a_far_visit(admin_client, public_client, db_session):
    near = await book_slot(admin_client, public_client, days_ahead=3, phone="0912000001")
    far = await book_slot(admin_client, public_client, days_ahead=40, phone="0912000002")

    tokens = {
        str(t.visit_request_id): t for t in (await db_session.execute(select(ParentAccessToken))).scalars().all()
    }
    near_token, far_token = tokens[near["receipt_id"]], tokens[far["receipt_id"]]
    assert near_token.expires_at - near_token.created_at >= timedelta(days=14) - timedelta(seconds=5)
    far_detail = (await admin_client.get(f"{API}/admin/visit-requests/{far['receipt_id']}")).json()
    far_start = slot_start_utc(
        date.fromisoformat(far_detail["slot"]["slot_date"]), time.fromisoformat(far_detail["slot"]["start_time"])
    )
    assert abs((far_token.expires_at - (far_start + timedelta(days=7))).total_seconds()) < 5


@pytest.mark.asyncio
async def test_staff_reschedule_to_a_later_day_extends_the_link(admin_client, public_client, db_session):
    booked = await book_slot(admin_client, public_client, days_ahead=3)
    later = await create_slot(admin_client, days_ahead=50)
    before = (await db_session.execute(select(ParentAccessToken.expires_at))).scalar_one()

    moved = await admin_client.post(
        f"{API}/admin/visit-requests/{booked['receipt_id']}/reschedule", json={"new_slot_id": later}
    )

    assert moved.status_code == 200, moved.text
    db_session.expire_all()
    after = (await db_session.execute(select(ParentAccessToken.expires_at))).scalar_one()
    assert after > before


@pytest.mark.asyncio
async def test_link_cannot_be_rederived_after_secret_rotation(app, admin_client, public_client, db_session):
    booked = await book_slot(admin_client, public_client)
    visit_id = uuid.UUID(booked["receipt_id"])

    assert await access_service.current_manage_path(db_session, visit_id, secret=app.state.settings.session_secret) == booked["manage_path"]
    assert await access_service.current_manage_path(db_session, visit_id, secret="rotated-secret-0930") is None
    # 已發出的連結仍能兌換（只比對雜湊），直到到期或被撤銷。
    await open_manage(public_client, booked["manage_path"])


@pytest.mark.asyncio
async def test_staff_regenerate_revokes_the_old_link(admin_client, public_client):
    booked = await book_slot(admin_client, public_client)

    regenerated = await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/access-link")
    old = await public_client.post(
        f"{API}/public/visit-manage/exchange", json={"token": booked["manage_path"].split("token=", 1)[1]}
    )

    assert regenerated.status_code == 200, regenerated.text
    assert old.status_code == 401
    await open_manage(public_client, regenerated.json()["manage_url_fragment"])
```

- [ ] **Step 2：跑測試確認失敗**

Run: `cd backend && uv run pytest tests/test_parent_manage_link.py -q`
Expected: FAIL（`manage_path` 不存在）。

- [ ] **Step 3：access_service**

`backend/app/booking/access_service.py`：檔頭 import 加 `base64`、`hmac`，以及 `from app.common.timezones import slot_start_utc`；把 `TOKEN_TTL` 換成下面這組，並改寫 `create_access_token`：

```python
# 修改連結的有效期：至少 14 天；參觀日較遠時延到參觀開始後 7 天。
TOKEN_MIN_TTL = timedelta(days=14)
TOKEN_AFTER_VISIT = timedelta(days=7)
_ACCESS_KEY_LABEL = b"ivy-parent-access-v1"


def _derive_raw(secret: str, token_id: uuid.UUID) -> str:
    """原始 token 由伺服器密鑰與 token 列 id 算出：DB 只存雜湊，送單重播與寄信時
    仍能重算出同一條連結；只有 DB 沒有密鑰算不出來。"""
    key = hmac.new(secret.encode("utf-8"), _ACCESS_KEY_LABEL, hashlib.sha256).digest()
    digest = hmac.new(key, token_id.bytes, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def token_expiry(slot: VisitSlot | None, now: datetime) -> datetime:
    floor = now + TOKEN_MIN_TTL
    if slot is None:
        return floor
    return max(floor, slot_start_utc(slot.slot_date, slot.start_time) + TOKEN_AFTER_VISIT)


def manage_path(raw_token: str) -> str:
    return f"/visit/manage#token={raw_token}"


async def create_access_token(
    db: AsyncSession, visit_request_id: uuid.UUID, *, secret: str, slot: VisitSlot | None
) -> tuple[str, datetime]:
    """建一條修改連結，回傳 (原始 token, 到期時間)。呼叫端負責先撤銷舊連結。"""
    now = datetime.now(timezone.utc)
    token_id = uuid.uuid4()
    raw_token = _derive_raw(secret, token_id)
    expires_at = token_expiry(slot, now)
    db.add(
        ParentAccessToken(
            id=token_id,
            visit_request_id=visit_request_id,
            token_hash=_hash(raw_token),
            created_at=now,
            expires_at=expires_at,
        )
    )
    await db.flush()
    return raw_token, expires_at


async def issue_access_token(
    db: AsyncSession, visit_request_id: uuid.UUID, *, secret: str, slot: VisitSlot | None
) -> tuple[str, datetime]:
    await revoke_access_for_visit_request(db, visit_request_id)
    return await create_access_token(db, visit_request_id, secret=secret, slot=slot)


async def current_manage_path(db: AsyncSession, visit_request_id: uuid.UUID, *, secret: str) -> str | None:
    """目前有效連結的站內路徑；已撤銷、已過期，或是 2026-09-30 以前隨機產生（重算不出來）
    的連結，回傳 None。"""
    token = await active_access_token(db, visit_request_id)
    if token is None:
        return None
    raw_token = _derive_raw(secret, token.id)
    if _hash(raw_token) != token.token_hash:
        return None
    return manage_path(raw_token)


async def ensure_access_token(
    db: AsyncSession, visit_request_id: uuid.UUID, *, secret: str, slot: VisitSlot | None
) -> None:
    if await current_manage_path(db, visit_request_id, secret=secret) is None:
        await issue_access_token(db, visit_request_id, secret=secret, slot=slot)


async def extend_token_expiry(db: AsyncSession, visit_request_id: uuid.UUID, slot: VisitSlot) -> None:
    """改到較晚的場次時，連結跟著延長；不縮短已發出的期限。"""
    token = await active_access_token(db, visit_request_id)
    if token is not None:
        token.expires_at = max(token.expires_at, token_expiry(slot, datetime.now(timezone.utc)))
        await db.flush()
```
（`VisitSlot` 已在檔頭 import；`secrets`、`_TOKEN_BYTES` 仍給 session 用，保留。）

- [ ] **Step 4：送單發連結、回應帶路徑**

`service.submit_visit_request` 加關鍵字參數 `access_secret: str`；在 `history.record_event(... "created" ...)` 之後加：

```python
    await access_service.create_access_token(db, visit_request.id, secret=access_secret, slot=slot)
```
（`from app.booking import access_service`；確認沒有循環 import：`access_service` 不 import `service`。）

`schemas.VisitRequestOut` 加：

```python
    # 家長的修改連結（站內路徑，含 #token=）。已取消／已結案或連結已撤銷時為 None。
    manage_path: str | None = None
```

`routes.create_visit_request`：
- 函式一開頭加 `response.headers["Cache-Control"] = "no-store"`。
- 呼叫 `service.submit_visit_request(...)` 加 `access_secret=settings.session_secret`。
- 加一個模組層 helper，函式內**每一個** `return VisitRequestOut(...)`（早期重播、`_late_replay`、最後的新建／重播）都補上 `manage_path=await _manage_path(db, request, <visit>.id)`：

```python
async def _manage_path(db: AsyncSession, request: Request, visit_request_id: uuid.UUID) -> str | None:
    return await access_service.current_manage_path(
        db, visit_request_id, secret=request.app.state.settings.session_secret
    )
```

- [ ] **Step 5：其他發放點與延長**

`access_routes.create_parent_access_link`：把 `revoke_access_for_visit_request` ＋ `create_access_token` 兩行換成

```python
    raw_token, expires_at = await access_service.issue_access_token(
        db, visit_request_id, secret=request.app.state.settings.session_secret, slot=visit_request.slot
    )
```
其餘（`replaced`、歷程、audit、回應）不變。

`routes` 的 `/confirm`（舊案排入場次）與補登：`confirm_with_slot` 成功之後、`db.commit()` 之前加

```python
    await access_service.ensure_access_token(
        db, visit_request.id, secret=request.app.state.settings.session_secret, slot=visit_request.slot
    )
```
（handler 若沒有 `request: Request` 參數就補上；`visit_request.slot` 在 `confirm_with_slot` 內已設定。）

`workflow_service.reschedule`：`visit_request.slot = new_slot` 之後加 `await access_service.extend_token_expiry(db, visit_request.id, new_slot)`。

- [ ] **Step 6：跑測試**

Run: `cd backend && uv run pytest tests/test_parent_manage_link.py tests/test_self_booking_submit.py -q`
Expected: 全部 PASS。

- [ ] **Step 7：Commit（需授權）**

```bash
git add backend/app/booking/access_service.py backend/app/booking/service.py backend/app/booking/routes.py \
  backend/app/booking/access_routes.py backend/app/booking/workflow_service.py backend/app/booking/schemas.py \
  backend/tests/test_parent_manage_link.py
git commit -m "feat(booking): 送單即發可重算的家長修改連結，重送回同一條

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A4：寄給家長的信（預約成功／已變更／已取消）、重寄與重新產生

**Files:**
- Modify: `backend/app/booking/outbox.py`
- Create: `backend/app/notifications/parent_email.py`
- Modify: `backend/app/notifications/service.py`（`_KIND_LABELS` 26 行、`dispatch_outbox_message` 232 行）
- Modify: `backend/app/workers/runner.py`（`process_outbox_batch`）、`backend/app/workers/maintenance.py`（約 182–200 行）
- Modify: `backend/app/booking/service.py`、`workflow_service.py`（觸發點）
- Modify: `backend/app/booking/access_routes.py`（重新產生連結後寄信、新增重寄端點）、`schemas.py`（`ParentAccessLinkCreatedOut`、`PublicBookingConfigOut`、`BookingConfigOut`）
- Modify: `backend/app/booking/routes.py`（公開與後台 booking-config 帶 `parent_email_enabled`）
- Modify: `admin/src/api/labels.ts`（`NOTIFICATION_KIND_LABELS`、`AUDIT_ACTION_LABELS`）
- Test: `backend/tests/test_parent_email.py`

**Interfaces:**
- Produces（`app.booking.outbox`）：`PARENT_VISIT_BOOKED = "parent_visit_booked"`、`PARENT_VISIT_CHANGED = "parent_visit_changed"`、`PARENT_VISIT_CANCELLED = "parent_visit_cancelled"`、`PARENT_KINDS: frozenset[str]`、`def enqueue_parent_email(db, visit_request: VisitRequest, kind: str) -> None`（沒有 Email 就不排）
- Produces（`app.notifications.parent_email`）：`session_label(start: time) -> str`、`visit_when(slot_date: date, start: time) -> str`、`@dataclass(frozen=True) class ParentEmail`、`build_parent_email(mail: ParentEmail) -> tuple[str, str]`
- Produces：`process_outbox_batch(..., access_secret: str | None = None)`、`dispatch_outbox_message(..., access_secret: str | None = None)`；`PublicBookingConfigOut.parent_email_enabled: bool`、`BookingConfigOut.parent_email_enabled: bool`；`POST /admin/visit-requests/{id}/resend-confirmation` → 202 `{"queued": true}`；`ParentAccessLinkCreatedOut.emailed: bool`

- [ ] **Step 1：寫失敗的測試**

`backend/tests/test_parent_email.py`：

```python
from __future__ import annotations

from datetime import date, datetime, time, timezone

import pytest
from sqlalchemy import select

from app.booking.models import OutboxMessage
from app.notifications.parent_email import ParentEmail, build_parent_email, session_label, visit_when
from app.workers.runner import process_outbox_batch
from tests.conftest import book_slot, create_slot, open_manage

pytestmark = pytest.mark.usefixtures("booking_consent")
API = "/api/website/v1"
ORIGIN = "https://www.ivy.example"


def test_session_label_splits_at_noon():
    assert session_label(time(9, 59)) == "上午場 09:59"
    assert session_label(time(12, 0)) == "下午場 12:00"
    assert visit_when(date(2026, 10, 2), time(10, 0)) == "10/02（五）上午場 10:00"


def _mail(**changes) -> ParentEmail:
    base = dict(
        kind="parent_visit_booked",
        campus_name="義華校",
        salutation="陳小姐",
        slot_date=date(2026, 10, 2),
        start_time=time(10, 0),
        end_time=time(11, 0),
        party_size=2,
        campus_address="高雄市三民區範例路 1 號",
        campus_phone="07-3000000",
        manage_url=f"{ORIGIN}/visit/manage#token=abc",
        change_deadline=datetime(2026, 10, 1, 2, 0, tzinfo=timezone.utc),
        cancel_reason=None,
        rebook_url=f"{ORIGIN}/visit/yihua",
    )
    base.update(changes)
    return ParentEmail(**base)


def test_booked_mail_has_time_link_and_deadline():
    subject, body = build_parent_email(_mail())

    assert subject == "【常春藤義華】參觀預約成功：10/02（五）上午場 10:00"
    assert body.startswith("陳小姐您好：")
    assert "日期與場次：10/02（五）上午場 10:00（10:00–11:00）" in body
    assert "參觀人數：2 位" in body
    assert f"{ORIGIN}/visit/manage#token=abc" in body
    assert "10/01（四）10:00前可以線上修改" in body


def test_cancelled_mail_says_who_and_has_no_manage_link():
    subject, body = build_parent_email(_mail(kind="parent_visit_cancelled", cancel_reason="staff", manage_url=None))

    assert subject == "【常春藤義華】參觀預約已取消：10/02（五）上午場 10:00"
    assert "園方已取消這次參觀預約" in body
    assert "#token=" not in body
    assert f"{ORIGIN}/visit/yihua" in body


async def _run(db_session, adapter, app):
    return await process_outbox_batch(
        db_session, adapter, limit=50, admin_origin=ORIGIN, access_secret=app.state.settings.session_secret
    )


def _parent_mails(adapter, to="parent@example.com"):
    return [mail for mail in adapter.sent if mail["to"] == to]


@pytest.mark.asyncio
async def test_booking_sends_one_mail_to_the_parent_with_a_working_link(
    app, admin_client, public_client, db_session, recording_mail_adapter
):
    booked = await book_slot(admin_client, public_client, child_name="小寶", child_birthdate="2022-05-01")

    await _run(db_session, recording_mail_adapter, app)

    mails = _parent_mails(recording_mail_adapter)
    assert len(mails) == 1
    assert mails[0]["subject"].startswith("【常春藤義華】參觀預約成功：")
    assert f"{ORIGIN}{booked['manage_path']}" in mails[0]["body"]
    for secret in ("2022-05-01", "0912345678", "小寶"):
        assert secret not in mails[0]["body"]
    assert any(mail["to"] != "parent@example.com" for mail in recording_mail_adapter.sent)  # 園方信照寄


@pytest.mark.asyncio
async def test_parent_mail_is_skipped_without_an_adapter(app, admin_client, public_client, db_session):
    await book_slot(admin_client, public_client)

    await process_outbox_batch(db_session, None, limit=50, admin_origin=ORIGIN, access_secret=app.state.settings.session_secret)

    statuses = (
        await db_session.execute(select(OutboxMessage.status).where(OutboxMessage.kind == "parent_visit_booked"))
    ).scalars().all()
    assert statuses == ["skipped"]


@pytest.mark.asyncio
async def test_staff_cancel_and_reschedule_mail_the_parent(
    app, admin_client, public_client, db_session, recording_mail_adapter
):
    booked = await book_slot(admin_client, public_client)
    later = await create_slot(admin_client, days_ahead=6, start_time="14:30:00", end_time="15:30:00")
    await _run(db_session, recording_mail_adapter, app)
    recording_mail_adapter.sent.clear()

    await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/reschedule", json={"new_slot_id": later})
    await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/cancel", json={})
    await _run(db_session, recording_mail_adapter, app)

    subjects = [mail["subject"] for mail in _parent_mails(recording_mail_adapter)]
    assert any("參觀預約已變更" in s and "下午場 14:30" in s for s in subjects)
    cancelled = [m for m in _parent_mails(recording_mail_adapter) if "參觀預約已取消" in m["subject"]]
    assert len(cancelled) == 1 and "園方已取消" in cancelled[0]["body"]


@pytest.mark.asyncio
async def test_parent_cancel_mail_says_the_parent_cancelled(
    app, admin_client, public_client, db_session, recording_mail_adapter
):
    booked = await book_slot(admin_client, public_client)
    await open_manage(public_client, booked["manage_path"])
    await _run(db_session, recording_mail_adapter, app)
    recording_mail_adapter.sent.clear()

    response = await public_client.post(
        f"{API}/public/visit-manage/cancel", json={"visit_request_id": booked["receipt_id"]}
    )
    await _run(db_session, recording_mail_adapter, app)

    assert response.status_code == 200, response.text
    assert "您已取消這次參觀預約" in _parent_mails(recording_mail_adapter)[0]["body"]


@pytest.mark.asyncio
async def test_outbox_payloads_only_carry_ids(admin_client, public_client, db_session):
    await book_slot(admin_client, public_client)

    payloads = (
        await db_session.execute(select(OutboxMessage.payload).where(OutboxMessage.kind.like("parent_%")))
    ).scalars().all()

    assert payloads and all(set(p) == {"campus_key", "receipt_id"} for p in payloads)


@pytest.mark.asyncio
async def test_resend_and_regenerate_queue_parent_mail(admin_client, public_client, db_session):
    booked = await book_slot(admin_client, public_client)

    resend = await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/resend-confirmation")
    regenerate = await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/access-link")

    assert resend.status_code == 202, resend.text
    assert regenerate.json()["emailed"] is True
    kinds = (
        await db_session.execute(select(OutboxMessage.kind).where(OutboxMessage.kind.like("parent_%")))
    ).scalars().all()
    assert sorted(kinds) == ["parent_visit_booked", "parent_visit_booked", "parent_visit_changed"]


@pytest.mark.asyncio
async def test_resend_is_refused_for_a_cancelled_booking(admin_client, public_client):
    booked = await book_slot(admin_client, public_client)
    await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/cancel", json={})

    response = await admin_client.post(f"{API}/admin/visit-requests/{booked['receipt_id']}/resend-confirmation")

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "RESEND_NOT_AVAILABLE"


@pytest.mark.asyncio
async def test_booking_config_says_whether_parent_mail_is_on(app, admin_client, public_client):
    off = (await public_client.get(f"{API}/public/booking-config/yihua")).json()
    app.state.settings.smtp_host = "smtp.example.invalid"
    app.state.settings.smtp_from = "noreply@ivy.example"
    on = (await public_client.get(f"{API}/public/booking-config/yihua")).json()
    admin = (await admin_client.get(f"{API}/admin/booking-config/yihua")).json()

    assert off["parent_email_enabled"] is False
    assert on["parent_email_enabled"] is True
    assert admin["parent_email_enabled"] is True
```

- [ ] **Step 2：跑測試確認失敗**

Run: `cd backend && uv run pytest tests/test_parent_email.py -q`
Expected: FAIL（`ModuleNotFoundError: app.notifications.parent_email`）。

- [ ] **Step 3：kind 常數與排信 helper**

`backend/app/booking/outbox.py` 檔尾：

```python
# 寄給家長的確認信（只走 Email，不寫站內通知、不推 LINE）。payload 只放 id，
# 修改連結在寄件當下才重算，原始 token 不進 DB。
PARENT_VISIT_BOOKED = "parent_visit_booked"
PARENT_VISIT_CHANGED = "parent_visit_changed"
PARENT_VISIT_CANCELLED = "parent_visit_cancelled"
PARENT_KINDS = frozenset({PARENT_VISIT_BOOKED, PARENT_VISIT_CHANGED, PARENT_VISIT_CANCELLED})


def enqueue_parent_email(db: AsyncSession, visit_request, kind: str) -> None:
    if kind not in PARENT_KINDS:
        raise ValueError(kind)
    if not visit_request.email:
        return
    enqueue_outbox(
        db, visit_request.id, kind, {"campus_key": visit_request.campus_key, "receipt_id": str(visit_request.id)}
    )
```

- [ ] **Step 4：信件內容**

`backend/app/notifications/parent_email.py`：

```python
"""寄給家長的預約確認信（純文字）。只放預約內容與修改連結，不放孩子生日、
完整電話、提問內容。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time

from app.booking.outbox import PARENT_VISIT_BOOKED, PARENT_VISIT_CANCELLED, PARENT_VISIT_CHANGED
from app.common.timezones import OPERATING_TZ

_WEEKDAYS = "一二三四五六日"
_TITLES = {
    PARENT_VISIT_BOOKED: "參觀預約成功",
    PARENT_VISIT_CHANGED: "參觀預約已變更",
    PARENT_VISIT_CANCELLED: "參觀預約已取消",
}


def session_label(start: time) -> str:
    return f"{'上午場' if start.hour < 12 else '下午場'} {start:%H:%M}"


def visit_when(slot_date: date, start: time) -> str:
    return f"{slot_date:%m/%d}（{_WEEKDAYS[slot_date.weekday()]}）{session_label(start)}"


def _deadline_text(deadline: datetime) -> str:
    local = deadline.astimezone(OPERATING_TZ)
    return f"{local:%m/%d}（{_WEEKDAYS[local.weekday()]}）{local:%H:%M}"


@dataclass(frozen=True)
class ParentEmail:
    kind: str
    campus_name: str
    salutation: str
    slot_date: date | None
    start_time: time | None
    end_time: time | None
    party_size: int | None
    campus_address: str | None
    campus_phone: str | None
    manage_url: str | None
    change_deadline: datetime | None
    cancel_reason: str | None
    rebook_url: str | None


def build_parent_email(mail: ParentEmail) -> tuple[str, str]:
    short_name = mail.campus_name[:-1] if mail.campus_name.endswith("校") else mail.campus_name
    when = visit_when(mail.slot_date, mail.start_time) if mail.slot_date and mail.start_time else None
    subject = f"【常春藤{short_name}】{_TITLES[mail.kind]}" + (f"：{when}" if when else "")

    if mail.kind == PARENT_VISIT_BOOKED:
        intro = f"您已完成常春藤{mail.campus_name}的參觀預約，期待與您見面。"
    elif mail.kind == PARENT_VISIT_CHANGED:
        intro = "您的參觀預約已更新，以下是最新內容。"
    elif mail.cancel_reason == "parent":
        intro = "您已取消這次參觀預約。"
    elif mail.cancel_reason == "staff":
        intro = "園方已取消這次參觀預約，如有疑問請來電洽詢。"
    else:
        intro = "這次參觀預約已取消。"

    lines = [f"{mail.salutation}您好：", "", intro, "", f"校區：{mail.campus_name}"]
    if when:
        span = f"（{mail.start_time:%H:%M}–{mail.end_time:%H:%M}）" if mail.end_time else ""
        lines.append(f"日期與場次：{when}{span}")
    if mail.party_size:
        lines.append(f"參觀人數：{mail.party_size} 位")
    if mail.campus_address:
        lines.append(f"地址：{mail.campus_address}")
    if mail.campus_phone:
        lines.append(f"電話：{mail.campus_phone}")
    lines.append("")

    if mail.kind == PARENT_VISIT_CANCELLED:
        lines.append(f"想再預約參觀，請到：{mail.rebook_url}" if mail.rebook_url else "想再預約參觀，歡迎來電洽詢。")
    elif mail.manage_url:
        deadline = f"（{_deadline_text(mail.change_deadline)}前可以線上修改）" if mail.change_deadline else ""
        lines += [f"要改時間、修改資料或取消，請開啟這個連結{deadline}：", mail.manage_url, "請勿把這個連結轉給他人。"]
    else:
        lines.append("要改時間或取消，請使用預約完成頁上的連結，或來電洽詢。")

    lines += ["", "這封信由系統自動寄出，請勿直接回覆。"]
    return subject, "\n".join(lines)
```

- [ ] **Step 5：派送分支**

`backend/app/notifications/service.py`：

1. `_KIND_LABELS` 加三項（字串要與 `admin/src/api/labels.ts` 完全一致）：

```python
    "parent_visit_booked": "家長確認信（預約成功）",
    "parent_visit_changed": "家長確認信（預約已變更）",
    "parent_visit_cancelled": "家長確認信（預約已取消）",
```

2. import：`from app.booking import access_service`、`from app.booking.outbox import PARENT_KINDS, PARENT_VISIT_CANCELLED`、`from app.booking.parent_policy import change_deadline_hours, parent_change_deadline`、`from app.content import service as content_service`、`from app.notifications.parent_email import ParentEmail, build_parent_email`。

3. 新函式（放在 `dispatch_outbox_message` 上方）：

```python
async def _dispatch_parent_email(
    db: AsyncSession,
    *,
    outbox_message_id: uuid.UUID,
    kind: str,
    payload: dict,
    adapter: EmailAdapter | None,
    created_at: datetime | None,
    admin_origin: str | None,
    access_secret: str | None,
) -> bool:
    """寄給家長的確認信：只寄 Email。回傳 False 代表不適用（沒設定寄信、太舊、
    沒有 Email、已匿名化），runner 會標成 skipped、不重試。"""
    if adapter is None:
        return False
    if created_at is not None and datetime.now(timezone.utc) - created_at > EXTERNAL_DELIVERY_STALE_AFTER:
        return False
    visit_request = await _load_visit_request(db, payload.get("receipt_id"))
    if visit_request is None or visit_request.anonymized_at is not None or not visit_request.email:
        return False
    recipient_key = f"parent:{visit_request.id}"
    if await _already_delivered(db, outbox_message_id, "email", recipient_key):
        return True
    origin = admin_origin.rstrip("/") if admin_origin else None
    manage_url = None
    if kind != PARENT_VISIT_CANCELLED and origin and access_secret:
        path = await access_service.current_manage_path(db, visit_request.id, secret=access_secret)
        manage_url = f"{origin}{path}" if path else None
    profile = await content_service.published_payload(db, "campus_profile", visit_request.campus_key) or {}
    slot = visit_request.slot
    subject, body = build_parent_email(
        ParentEmail(
            kind=kind,
            campus_name=await _campus_name(db, visit_request.campus_key),
            salutation=parent_salutation(visit_request.parent_name),
            slot_date=slot.slot_date if slot else None,
            start_time=slot.start_time if slot else None,
            end_time=slot.end_time if slot else None,
            party_size=visit_request.party_size,
            campus_address=str(profile.get("address") or "").strip() or None,
            campus_phone=str(profile.get("phone") or "").strip() or None,
            manage_url=manage_url,
            change_deadline=parent_change_deadline(
                visit_request, await change_deadline_hours(db, visit_request.campus_key)
            ),
            cancel_reason=visit_request.cancel_reason,
            rebook_url=f"{origin}/visit/{visit_request.campus_key}" if origin else None,
        )
    )
    await asyncio.to_thread(
        adapter.send, to=_header_safe(visit_request.email), subject=_header_safe(subject), body=body
    )
    _record_delivery(db, outbox_message_id, "email", recipient_key)
    await db.commit()
    return True
```
（先確認 `_load_visit_request` 有 `selectinload(VisitRequest.slot)`；沒有就補，`parent_change_deadline` 會讀 `visit.slot`。）

4. `dispatch_outbox_message` 簽章加 `access_secret: str | None = None`，函式第一行：

```python
    if kind in PARENT_KINDS:
        return await _dispatch_parent_email(
            db,
            outbox_message_id=outbox_message_id,
            kind=kind,
            payload=payload,
            adapter=adapter,
            created_at=created_at,
            admin_origin=admin_origin,
            access_secret=access_secret,
        )
```

5. `workers/runner.py`：`process_outbox_batch` 加 `access_secret: str | None = None`，傳進 `dispatch_outbox_message(..., access_secret=access_secret)`。`workers/maintenance.py` 呼叫 `process_outbox_batch` 處加 `access_secret=settings.session_secret`。

- [ ] **Step 6：觸發點**

- `service.submit_visit_request`：`create_access_token` 那行之後 `enqueue_parent_email(db, visit_request, PARENT_VISIT_BOOKED)`。
- `workflow_service.confirm_with_slot`：`enqueue_outbox(... "visit_request_confirmed" ...)` 之後 `enqueue_parent_email(db, visit_request, PARENT_VISIT_BOOKED)`（涵蓋補登與舊案排入場次）。
- `workflow_service.reschedule`：`enqueue_outbox(... "visit_request_rescheduled" ...)` 之後 `enqueue_parent_email(db, visit_request, PARENT_VISIT_CHANGED)`。
- `workflow_service.cancel`：`enqueue_outbox(... "visit_request_cancelled" ...)` 之後：

```python
    if visit_request.slot_id is not None:
        enqueue_parent_email(db, visit_request, PARENT_VISIT_CANCELLED)
```
（`expire_holds` 不寄。）

- [ ] **Step 7：重新產生、重寄、寄信開關**

`schemas.ParentAccessLinkCreatedOut` 加 `emailed: bool = False`；`PublicBookingConfigOut` 與 `BookingConfigOut` 加 `parent_email_enabled: bool = False`。

`access_routes.create_parent_access_link`：`issue_access_token` 之後：

```python
    emailed = bool(visit_request.email)
    enqueue_parent_email(db, visit_request, PARENT_VISIT_CHANGED)
```
回應加 `emailed=emailed`。

同檔新增（放在 `access-link` 端點下方）：

```python
@router.post("/admin/visit-requests/{visit_request_id}/resend-confirmation", status_code=status.HTTP_202_ACCEPTED)
async def resend_parent_confirmation(
    visit_request_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    result = await db.execute(
        select(VisitRequest).options(selectinload(VisitRequest.slot)).where(VisitRequest.id == visit_request_id)
    )
    visit_request = result.scalar_one_or_none()
    if visit_request is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個項目")
    require_scope(current_user, "booking.handle", campus_keys=[visit_request.campus_key])
    await workflow_service.lock_status(db, visit_request)
    if visit_request.status != VisitRequestStatus.CONFIRMED.value or not visit_request.email:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "RESEND_NOT_AVAILABLE", "message": "只有已排入場次、有 Email 的預約可以重寄確認信"},
        )
    await access_service.ensure_access_token(
        db, visit_request.id, secret=request.app.state.settings.session_secret, slot=visit_request.slot
    )
    enqueue_parent_email(db, visit_request, PARENT_VISIT_BOOKED)
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="visit_request.resend_confirmation",
        target_type="visit_request",
        target_id=str(visit_request.id),
        campus_key=visit_request.campus_key,
        metadata={},
    )
    await db.commit()
    return {"queued": True}
```

`routes.py` 公開與後台的 `GET booking-config`：輸出物件加 `parent_email_enabled=bool(request.app.state.settings.smtp_host)`（handler 沒有 `request` 參數就補）。

- [ ] **Step 8：後台標籤同步**

`admin/src/api/labels.ts`：
- `NOTIFICATION_KIND_LABELS` 加 `parent_visit_booked: '家長確認信（預約成功）'`、`parent_visit_changed: '家長確認信（預約已變更）'`、`parent_visit_cancelled: '家長確認信（預約已取消）'`。
- `AUDIT_ACTION_LABELS` 加 `'visit_request.resend_confirmation': '重寄家長確認信'`、`'booking_config.migrate_self_booking': '改為家長自選場次（系統轉換）'`。

- [ ] **Step 9：跑測試**

```bash
cd backend && uv run pytest tests/test_parent_email.py tests/test_parent_manage_link.py tests/test_self_booking_submit.py -q
cd ../admin && npx vitest run src/__tests__/labelCoverage.test.ts
```
Expected: 全部 PASS。

- [ ] **Step 10：Commit（需授權）**

```bash
git add backend/app/booking/outbox.py backend/app/notifications/parent_email.py backend/app/notifications/service.py \
  backend/app/workers/runner.py backend/app/workers/maintenance.py backend/app/booking/service.py \
  backend/app/booking/workflow_service.py backend/app/booking/access_routes.py backend/app/booking/schemas.py \
  backend/app/booking/routes.py admin/src/api/labels.ts backend/tests/test_parent_email.py
git commit -m "feat(notifications): 寄給家長預約成功、變更、取消的確認信

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A5：家長直接改期與修改資料

**Files:**
- Modify: `backend/app/booking/access_service.py`（`create_reschedule_request` 172–245 行 → `validate_parent_reschedule`）
- Modify: `backend/app/booking/workflow_service.py`（新增 `update_details_by_parent`）
- Modify: `backend/app/booking/access_routes.py`（新增 `reschedule`、`PATCH me`；`reschedule-request` 改 410）
- Modify: `backend/app/booking/schemas.py`（`ParentVisitRequestOut` 504 行起；新增 `ParentRescheduleRequest`、`ParentDetailsUpdate`）
- Modify: `admin/src/api/labels.ts`（`VISIT_EVENT_LABELS` 加 `details_updated`）
- Test: `backend/tests/test_parent_self_service.py`

**Interfaces:**
- Consumes: A3 `open_manage`、`extend_token_expiry`（`reschedule` 內已呼叫）；A4 `enqueue_parent_email`、`PARENT_VISIT_CHANGED`。
- Produces:
  - `POST /public/visit-manage/reschedule`，body `{"visit_request_id": uuid, "slot_id": uuid}` → `ParentVisitRequestOut`
  - `PATCH /public/visit-manage/me`，body `ParentDetailsUpdate` → `ParentVisitRequestOut`
  - `ParentVisitRequestOut` 新欄位：`parent_name`、`phone`、`email`、`child_name`、`child_birthdate`、`party_size`、`questions`、`version`、`can_edit`；移除 `phone_masked`
  - `access_service.validate_parent_reschedule(db, visit_request, slot_id) -> VisitSlot`（丟 `RescheduleNotAllowed(code, message)`）
  - `workflow_service.update_details_by_parent(db, visit_request, changes: dict, *, expected_version: int) -> list[str]`

- [ ] **Step 1：寫失敗的測試**

`backend/tests/test_parent_self_service.py`：

```python
from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import select

from app.booking.models import OutboxMessage, VisitRequestEvent
from tests.conftest import VISIT_SUBMIT_PATH, book_slot, create_slot, open_manage, set_booking_mode

pytestmark = pytest.mark.usefixtures("booking_consent")
API = "/api/website/v1"
MANAGE = f"{API}/public/visit-manage"


async def _booked_and_open(admin_client, public_client, **kwargs) -> dict:
    booked = await book_slot(admin_client, public_client, **kwargs)
    await open_manage(public_client, booked["manage_path"])
    return booked


@pytest.mark.asyncio
async def test_me_returns_the_editable_details(admin_client, public_client):
    booked = await _booked_and_open(admin_client, public_client, child_name="小寶")

    me = (await public_client.get(f"{MANAGE}/me")).json()

    assert me["parent_name"] == "陳媽媽"
    assert me["phone"] == "0912345678"
    assert me["email"] == "parent@example.com"
    assert me["child_name"] == "小寶"
    assert me["can_edit"] is True and me["can_reschedule"] is True
    assert "phone_masked" not in me
    assert me["version"] >= 1
    assert me["id"] == booked["receipt_id"]


@pytest.mark.asyncio
async def test_parent_reschedules_directly(admin_client, public_client, db_session):
    booked = await _booked_and_open(admin_client, public_client)
    other = await create_slot(admin_client, days_ahead=5, start_time="14:30:00", end_time="15:30:00")

    response = await public_client.post(
        f"{MANAGE}/reschedule", json={"visit_request_id": booked["receipt_id"], "slot_id": other}
    )

    assert response.status_code == 200, response.text
    assert response.json()["slot"]["id"] == other
    assert response.json()["status"] == "confirmed"
    event = (
        await db_session.execute(select(VisitRequestEvent).where(VisitRequestEvent.event_type == "rescheduled"))
    ).scalar_one()
    assert event.source == "parent"
    kinds = (await db_session.execute(select(OutboxMessage.kind))).scalars().all()
    assert "parent_visit_changed" in kinds and "visit_request_rescheduled" in kinds


@pytest.mark.asyncio
async def test_last_seat_goes_to_exactly_one_of_parent_reschedule_and_new_booking(
    admin_client, public_client, second_public_client
):
    booked = await _booked_and_open(admin_client, public_client)
    last = await create_slot(admin_client, days_ahead=6, capacity=1)
    version = (await admin_client.get(f"{API}/admin/booking-config/yihua")).json()["version"]

    reschedule, submit = await asyncio.gather(
        public_client.post(f"{MANAGE}/reschedule", json={"visit_request_id": booked["receipt_id"], "slot_id": last}),
        second_public_client.post(
            VISIT_SUBMIT_PATH,
            json={
                "campus_key": "yihua",
                "config_version": version,
                "parent_name": "林媽媽",
                "phone": "0922333444",
                "consent_given": True,
                "slot_id": last,
            },
            headers={"Idempotency-Key": "race-last-seat"},
        ),
    )

    assert sorted([reschedule.status_code, submit.status_code]) in ([200, 409], [201, 409])
    loser = reschedule if reschedule.status_code == 409 else submit
    assert loser.json()["detail"]["code"] == "SLOT_FULL"
    slots = (await admin_client.get(f"{API}/admin/slots?campus_key=yihua")).json()
    assert next(s for s in slots if s["id"] == last)["booked_count"] == 1


@pytest.mark.asyncio
async def test_reschedule_after_deadline_is_refused(admin_client, public_client):
    booked = await _booked_and_open(admin_client, public_client, days_ahead=3)
    other = await create_slot(admin_client, days_ahead=5)
    await set_booking_mode(admin_client, "yihua", mode="slots", parent_change_deadline_hours=336)

    response = await public_client.post(
        f"{MANAGE}/reschedule", json={"visit_request_id": booked["receipt_id"], "slot_id": other}
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "CHANGE_DEADLINE_PASSED"


@pytest.mark.asyncio
async def test_reschedule_request_endpoint_is_retired(admin_client, public_client):
    booked = await _booked_and_open(admin_client, public_client)
    other = await create_slot(admin_client, days_ahead=5)

    response = await public_client.post(
        f"{MANAGE}/reschedule-request", json={"visit_request_id": booked["receipt_id"], "new_slot_id": other}
    )

    assert response.status_code == 410
    assert response.json()["detail"]["code"] == "ENDPOINT_RETIRED"


@pytest.mark.asyncio
async def test_parent_updates_details_without_leaking_them_into_history(admin_client, public_client, db_session):
    booked = await _booked_and_open(admin_client, public_client)
    me = (await public_client.get(f"{MANAGE}/me")).json()

    response = await public_client.patch(
        f"{MANAGE}/me",
        json={
            "visit_request_id": booked["receipt_id"],
            "expected_version": me["version"],
            "phone": "0922-333-444",
            "email": "new@example.com",
            "party_size": 3,
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["phone"] == "0922333444"
    assert response.json()["email"] == "new@example.com"
    assert response.json()["version"] == me["version"] + 1
    event = (
        await db_session.execute(select(VisitRequestEvent).where(VisitRequestEvent.event_type == "details_updated"))
    ).scalar_one()
    assert event.source == "parent"
    assert sorted(event.after["fields"]) == ["email", "party_size", "phone"]
    assert "0922333444" not in str(event.after) and "new@example.com" not in str(event.after)
    kinds = (await db_session.execute(select(OutboxMessage.kind))).scalars().all()
    assert kinds.count("parent_visit_changed") == 1


@pytest.mark.asyncio
async def test_same_details_write_nothing(admin_client, public_client, db_session):
    booked = await _booked_and_open(admin_client, public_client)
    me = (await public_client.get(f"{MANAGE}/me")).json()

    response = await public_client.patch(
        f"{MANAGE}/me",
        json={"visit_request_id": booked["receipt_id"], "expected_version": me["version"], "phone": me["phone"]},
    )

    assert response.status_code == 200
    assert response.json()["version"] == me["version"]
    events = (
        await db_session.execute(select(VisitRequestEvent).where(VisitRequestEvent.event_type == "details_updated"))
    ).scalars().all()
    assert events == []


@pytest.mark.asyncio
async def test_details_version_conflict_and_required_fields(admin_client, public_client):
    booked = await _booked_and_open(admin_client, public_client)
    me = (await public_client.get(f"{MANAGE}/me")).json()

    stale = await public_client.patch(
        f"{MANAGE}/me",
        json={"visit_request_id": booked["receipt_id"], "expected_version": me["version"] - 1, "party_size": 4},
    )
    cleared = await public_client.patch(
        f"{MANAGE}/me",
        json={"visit_request_id": booked["receipt_id"], "expected_version": me["version"], "email": None},
    )

    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "VISIT_REQUEST_VERSION_CONFLICT"
    assert cleared.status_code == 422


@pytest.mark.asyncio
async def test_details_update_checks_the_session_matches(admin_client, public_client):
    first = await _booked_and_open(admin_client, public_client, phone="0912000001")
    await _booked_and_open(admin_client, public_client, phone="0912000002", days_ahead=4)

    response = await public_client.patch(
        f"{MANAGE}/me", json={"visit_request_id": first["receipt_id"], "expected_version": 1, "party_size": 4}
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "PARENT_SESSION_CHANGED"
```

- [ ] **Step 2：跑測試確認失敗**

Run: `cd backend && uv run pytest tests/test_parent_self_service.py -q`
Expected: FAIL（404 on `/reschedule`、`me` 缺欄位）。

- [ ] **Step 3：schema**

`schemas.py`：

```python
class ParentRescheduleRequest(BaseModel):
    visit_request_id: uuid.UUID
    slot_id: uuid.UUID


class ParentDetailsUpdate(BaseModel):
    """家長自己修改的欄位；只送有改的欄位。必填欄位不能清空。"""

    visit_request_id: uuid.UUID
    expected_version: int
    parent_name: str | None = Field(default=None, min_length=1, max_length=64)
    phone: str | None = None
    email: EmailStr | None = Field(default=None, max_length=254)
    child_name: str | None = Field(default=None, min_length=1, max_length=64)
    child_birthdate: date | None = None
    party_size: int | None = Field(default=None, ge=1, le=10)
    questions: str | None = Field(default=None, max_length=500)

    @field_validator("parent_name", "child_name", mode="before")
    @classmethod
    def _strip(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("parent_name", "child_name", "questions")
    @classmethod
    def _no_control_chars(cls, value):
        return _reject_control_chars(value)

    @field_validator("phone")
    @classmethod
    def _phone(cls, value: str | None) -> str | None:
        return normalize_phone(value) if value is not None else value

    @field_validator("child_birthdate")
    @classmethod
    def _birthdate_not_future(cls, value: date | None) -> date | None:
        if value is not None and value > today_local():
            raise ValueError("寶貝出生日期不能晚於今天")
        return value

    @model_validator(mode="after")
    def _required_stay_filled(self):
        for field in ("parent_name", "phone", "email", "child_name", "party_size"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} 不能清空")
        return self

    def changes(self) -> dict:
        return {
            field: getattr(self, field)
            for field in self.model_fields_set
            if field not in {"visit_request_id", "expected_version"}
        }
```

`ParentVisitRequestOut`：刪 `phone_masked`（與只給它用的 `_mask_phone`，若無其他引用）；加欄位

```python
    parent_name: str
    phone: str
    email: str | None = None
    child_name: str | None = None
    child_birthdate: date | None = None
    party_size: int | None = None
    questions: str | None = None
    version: int
    can_edit: bool = False
```
`from_visit_request` 對應填入上述欄位，並

```python
            can_edit=visit_request.status == "confirmed" and change_open and campus_active,
```

- [ ] **Step 4：service**

`access_service.py`：把 `create_reschedule_request` 改成只驗證、不建申請、不寄信：

```python
async def validate_parent_reschedule(
    db: AsyncSession, visit_request: VisitRequest, requested_slot_id: uuid.UUID
) -> VisitSlot:
    """家長直接改期前的檢查（名額與鎖在 workflow_service.reschedule 內再驗一次）。"""
    await db.refresh(visit_request, attribute_names=["status", "slot_id"], with_for_update=True)
    if visit_request.status != VisitRequestStatus.CONFIRMED.value:
        raise RescheduleNotAllowed("INVALID_TRANSITION", f"狀態 {visit_request.status} 的案件不能改期")
    campus = await db.get(Campus, visit_request.campus_key)
    if campus is not None and not campus.active:
        raise RescheduleNotAllowed("BOOKING_UNAVAILABLE", "本校目前暫停受理線上參觀預約，請來電洽詢")
    slot = (await db.execute(select(VisitSlot).where(VisitSlot.id == requested_slot_id))).scalar_one_or_none()
    if slot is None or slot.campus_key != visit_request.campus_key:
        raise RescheduleNotAllowed("SLOT_NOT_FOUND", "找不到這個時段")
    if slot.closed:
        raise RescheduleNotAllowed("SLOT_CLOSED", "這個時段已停止申請")
    config = await db.get(BookingConfig, visit_request.campus_key)
    if not slot_service.is_publicly_bookable(slot, **slot_service.window_for(config)):
        raise RescheduleNotAllowed("SLOT_NOT_BOOKABLE", "這個時段目前無法預約")
    if slot.id == visit_request.slot_id:
        raise RescheduleNotAllowed("SAME_SLOT", "這就是目前的參觀時段")
    return slot
```
`RESCHEDULE_REQUESTED_KIND` 若 `notifications` 或其他地方仍引用就保留常數，否則刪。

`workflow_service.py`（import `from app.booking.outbox import PARENT_VISIT_CHANGED, enqueue_parent_email` 若 A4 尚未加）：

```python
EDITABLE_BY_PARENT = ("parent_name", "phone", "email", "child_name", "child_birthdate", "party_size", "questions")


async def update_details_by_parent(
    db: AsyncSession, visit_request: VisitRequest, changes: dict, *, expected_version: int
) -> list[str]:
    """家長從修改連結改資料。歷程只記改了哪些欄位，不記內容（歷程不放個資）。
    回傳實際改變的欄位；沒有變化就什麼都不寫。"""
    await db.refresh(
        visit_request, attribute_names=["status", "version", *EDITABLE_BY_PARENT], with_for_update=True
    )
    if visit_request.status != VisitRequestStatus.CONFIRMED.value:
        raise InvalidTransition(f"狀態 {visit_request.status} 的案件不能修改資料")
    if visit_request.version != expected_version:
        raise VersionConflict(visit_request.version)
    changed = [f for f in EDITABLE_BY_PARENT if f in changes and getattr(visit_request, f) != changes[f]]
    if not changed:
        return []
    for field in changed:
        setattr(visit_request, field, changes[field])
    visit_request.version += 1
    history.record_event(db, visit_request.id, "details_updated", actor=PARENT, after={"fields": changed})
    enqueue_parent_email(db, visit_request, PARENT_VISIT_CHANGED)
    await db.flush()
    return changed
```

- [ ] **Step 5：routes**

`access_routes.py`：`RescheduleRequestCreate` 與舊端點函式本體換成 410：

```python
@router.post("/public/visit-manage/reschedule-request", include_in_schema=False)
async def parent_request_reschedule_retired() -> None:
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail={"code": "ENDPOINT_RETIRED", "message": "改期已改成直接選新場次，請重新整理頁面"},
    )
```

新增：

```python
@router.post(
    "/public/visit-manage/reschedule",
    response_model=ParentVisitRequestOut,
    dependencies=[Depends(require_parent_request)],
)
async def parent_reschedule(
    payload: ParentRescheduleRequest,
    response: Response,
    session_token: str | None = Cookie(default=None, alias=PARENT_SESSION_COOKIE),
    db: AsyncSession = Depends(get_db_session),
) -> ParentVisitRequestOut:
    response.headers["Cache-Control"] = "private, no-store"
    visit_request = await _require_parent_session(db, session_token)
    _require_same_visit_request(visit_request, payload.visit_request_id)
    await require_change_window(db, visit_request)
    try:
        await access_service.validate_parent_reschedule(db, visit_request, payload.slot_id)
        await workflow_service.reschedule(db, visit_request, payload.slot_id, actor=PARENT)
    except access_service.RescheduleNotAllowed as exc:
        await db.rollback()
        code = status.HTTP_404_NOT_FOUND if exc.code == "SLOT_NOT_FOUND" else status.HTTP_409_CONFLICT
        raise HTTPException(status_code=code, detail={"code": exc.code, "message": exc.message}) from exc
    except workflow_service.SlotFull as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "SLOT_FULL", "message": "這個場次剛好額滿了，請選擇其他場次"},
        ) from exc
    except workflow_service.SlotClosed as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "SLOT_CLOSED", "message": "這個場次已停止申請"},
        ) from exc
    except slot_service.SlotNotBookable as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "SLOT_NOT_BOOKABLE", "message": "這個場次目前無法預約"},
        ) from exc
    except workflow_service.InvalidTransition as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail={"code": "INVALID_TRANSITION", "message": exc.message}
        ) from exc
    await db.commit()
    await db.refresh(visit_request, attribute_names=["slot"])
    return await _parent_output(db, visit_request)


@router.patch(
    "/public/visit-manage/me",
    response_model=ParentVisitRequestOut,
    dependencies=[Depends(require_parent_request)],
)
async def parent_update_details(
    payload: ParentDetailsUpdate,
    response: Response,
    session_token: str | None = Cookie(default=None, alias=PARENT_SESSION_COOKIE),
    db: AsyncSession = Depends(get_db_session),
) -> ParentVisitRequestOut:
    response.headers["Cache-Control"] = "private, no-store"
    visit_request = await _require_parent_session(db, session_token)
    _require_same_visit_request(visit_request, payload.visit_request_id)
    await require_change_window(db, visit_request)
    try:
        await workflow_service.update_details_by_parent(
            db, visit_request, payload.changes(), expected_version=payload.expected_version
        )
    except workflow_service.InvalidTransition as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail={"code": "INVALID_TRANSITION", "message": exc.message}
        ) from exc
    except workflow_service.VersionConflict as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "VISIT_REQUEST_VERSION_CONFLICT",
                "message": "這筆預約剛被修改過，請重新載入後再改",
                "current_version": exc.current_version,
            },
        ) from exc
    await db.commit()
    return await _parent_output(db, visit_request)
```
（`slot_service`、`PARENT` 若未 import 就補。）

- [ ] **Step 6：後台歷程標籤**

`admin/src/api/labels.ts` 的 `VISIT_EVENT_LABELS` 加 `details_updated: '家長修改資料'`。若後台歷程元件會把 `after` 的鍵翻成中文，另在對應表加 `fields: '修改的欄位'`（`grep -n "VISIT_EVENT_LABELS\|historyFieldLabel" admin/src -r` 找到位置）。

- [ ] **Step 7：跑測試**

```bash
cd backend && uv run pytest tests/test_parent_self_service.py tests/test_parent_email.py tests/test_parent_manage_link.py -q
cd ../admin && npx vitest run src/__tests__/labelCoverage.test.ts
```
Expected: 全部 PASS。

- [ ] **Step 8：Commit（需授權）**

```bash
git add backend/app/booking/access_service.py backend/app/booking/workflow_service.py \
  backend/app/booking/access_routes.py backend/app/booking/schemas.py admin/src/api/labels.ts \
  backend/tests/test_parent_self_service.py
git commit -m "feat(booking): 家長從修改連結直接改場次與修改資料

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A6：後台列表分組與顯示狀態

**Files:**
- Create: `backend/app/booking/status_groups.py`
- Modify: `backend/app/booking/schemas.py`（`VisitRequestDetailOut` 454 行；新增 `VisitGroupCountsOut`）
- Modify: `backend/app/booking/routes.py`（`VisitRequestFilters` 829 行起；list 928 行；新增 group-counts，**必須放在** `GET /admin/visit-requests/{visit_request_id}`（約 1179 行）之前）
- Test: `backend/tests/test_visit_groups.py`

**Interfaces:**
- Produces（`app.booking.status_groups`）：`GROUPS = ("pending", "upcoming", "past", "cancelled")`、`PENDING_STATUSES`、`def display_status(status: str, slot_date: date | None, start_time: time | None, now: datetime | None = None) -> str`、`def group_condition(group: str, now: datetime | None = None)`
- Produces（API）：`GET /admin/visit-requests?group=<g>`；`GET /admin/visit-requests/group-counts` → `{"pending": int, "upcoming": int, "past": int, "cancelled": int}`；`VisitRequestDetailOut.display_status: str`（computed）、`cancel_reason`

- [ ] **Step 1：寫失敗的測試**

`backend/tests/test_visit_groups.py`：

```python
from __future__ import annotations

from datetime import date, datetime, time, timezone

import pytest

from app.booking.status_groups import display_status
from tests.conftest import book_slot, legacy_request, start_visit_slot

pytestmark = pytest.mark.usefixtures("booking_consent")
API = "/api/website/v1"
NOW = datetime(2026, 10, 2, 2, 0, tzinfo=timezone.utc)  # 台北 10:00


def test_display_status_turns_past_at_slot_start():
    assert display_status("confirmed", date(2026, 10, 2), time(10, 0), NOW) == "past"
    assert display_status("confirmed", date(2026, 10, 2), time(10, 1), NOW) == "upcoming"
    assert display_status("completed", date(2026, 10, 9), time(10, 0), NOW) == "past"
    assert display_status("no_show", date(2026, 10, 9), time(10, 0), NOW) == "past"
    assert display_status("contacting", None, None, NOW) == "pending"
    assert display_status("pending_confirmation", date(2026, 10, 9), time(10, 0), NOW) == "pending"
    assert display_status("cancelled", date(2026, 10, 9), time(10, 0), NOW) == "cancelled"


async def _ids(admin_client, **params) -> dict:
    response = await admin_client.get(f"{API}/admin/visit-requests", params=params)
    assert response.status_code == 200, response.text
    return {row["id"]: row for row in response.json()}


@pytest.mark.asyncio
async def test_list_filters_and_counts_by_group(admin_client, public_client, db_session):
    upcoming = await book_slot(admin_client, public_client, days_ahead=3, phone="0922000001")
    past = await book_slot(admin_client, public_client, days_ahead=4, phone="0922000002")
    await start_visit_slot(db_session, past["receipt_id"])
    done = await book_slot(admin_client, public_client, days_ahead=5, phone="0922000003")
    await start_visit_slot(db_session, done["receipt_id"])
    assert (await admin_client.post(f"{API}/admin/visit-requests/{done['receipt_id']}/complete")).status_code == 200
    cancelled = await book_slot(admin_client, public_client, days_ahead=6, phone="0922000004")
    assert (await admin_client.post(f"{API}/admin/visit-requests/{cancelled['receipt_id']}/cancel", json={})).status_code == 200
    pending = await legacy_request(db_session, status="contacting")

    assert set(await _ids(admin_client, group="upcoming")) == {upcoming["receipt_id"]}
    assert set(await _ids(admin_client, group="past")) == {past["receipt_id"], done["receipt_id"]}
    assert set(await _ids(admin_client, group="pending")) == {pending}
    cancelled_rows = await _ids(admin_client, group="cancelled")
    assert set(cancelled_rows) == {cancelled["receipt_id"]}
    assert cancelled_rows[cancelled["receipt_id"]]["cancel_reason"] == "staff"

    everything = await _ids(admin_client)
    assert everything[upcoming["receipt_id"]]["display_status"] == "upcoming"
    assert everything[past["receipt_id"]]["display_status"] == "past"
    assert everything[pending]["display_status"] == "pending"

    counts = await admin_client.get(f"{API}/admin/visit-requests/group-counts")
    assert counts.status_code == 200, counts.text
    assert counts.json() == {"pending": 1, "upcoming": 1, "past": 2, "cancelled": 1}
    other = (await admin_client.get(f"{API}/admin/visit-requests/group-counts", params={"campus_key": "minghua"})).json()
    assert other == {"pending": 0, "upcoming": 0, "past": 0, "cancelled": 0}


@pytest.mark.asyncio
async def test_unknown_group_is_rejected(admin_client):
    response = await admin_client.get(f"{API}/admin/visit-requests", params={"group": "contacting"})

    assert response.status_code == 422
```

- [ ] **Step 2：跑測試確認失敗**

Run: `cd backend && uv run pytest tests/test_visit_groups.py -q`
Expected: FAIL（`ModuleNotFoundError: app.booking.status_groups`）。

- [ ] **Step 3：status_groups**

`backend/app/booking/status_groups.py`：

```python
"""後台列表的四組顯示狀態（2026-09-30 業主裁定，參考義華舊後台）：
待處理（只剩上線前的舊案）／預約正常／時間已過／已取消。資料庫的 7 種狀態不變，
只在這裡歸組；場次開始的那一刻起算「時間已過」。"""

from __future__ import annotations

from datetime import date, datetime, time

from sqlalchemy import and_, or_, select

from app.booking.models import VisitRequest, VisitRequestStatus, VisitSlot
from app.common.timezones import OPERATING_TZ, now_utc, slot_start_utc

GROUPS = ("pending", "upcoming", "past", "cancelled")
PENDING_STATUSES = (
    VisitRequestStatus.NEW.value,
    VisitRequestStatus.CONTACTING.value,
    VisitRequestStatus.PENDING_CONFIRMATION.value,
)
_DONE_STATUSES = (VisitRequestStatus.COMPLETED.value, VisitRequestStatus.NO_SHOW.value)


def display_status(status: str, slot_date: date | None, start_time: time | None, now: datetime | None = None) -> str:
    if status in PENDING_STATUSES:
        return "pending"
    if status == VisitRequestStatus.CANCELLED.value:
        return "cancelled"
    if status in _DONE_STATUSES:
        return "past"
    if slot_date is None or start_time is None:
        return "pending"
    return "upcoming" if slot_start_utc(slot_date, start_time) > (now or now_utc()) else "past"


def _started_slot_ids(now: datetime):
    local = now.astimezone(OPERATING_TZ)
    return select(VisitSlot.id).where(
        or_(
            VisitSlot.slot_date < local.date(),
            and_(VisitSlot.slot_date == local.date(), VisitSlot.start_time <= local.time().replace(tzinfo=None)),
        )
    )


def group_condition(group: str, now: datetime | None = None):
    current = now or now_utc()
    if group == "pending":
        return VisitRequest.status.in_(PENDING_STATUSES)
    if group == "cancelled":
        return VisitRequest.status == VisitRequestStatus.CANCELLED.value
    confirmed = VisitRequest.status == VisitRequestStatus.CONFIRMED.value
    started = _started_slot_ids(current)
    if group == "upcoming":
        return and_(confirmed, VisitRequest.slot_id.is_not(None), VisitRequest.slot_id.not_in(started))
    if group == "past":
        return or_(and_(confirmed, VisitRequest.slot_id.in_(started)), VisitRequest.status.in_(_DONE_STATUSES))
    raise ValueError(group)
```

- [ ] **Step 4：schema**

`schemas.py`：`from pydantic import computed_field`、`from app.booking import status_groups`。`VisitRequestDetailOut` 加：

```python
    @computed_field  # type: ignore[prop-decorator]
    @property
    def display_status(self) -> str:
        """pending／upcoming／past／cancelled，後台列表與明細用這個分組顯示。"""
        slot = self.slot
        return status_groups.display_status(
            self.status, slot.slot_date if slot else None, slot.start_time if slot else None
        )
```

```python
class VisitGroupCountsOut(BaseModel):
    pending: int
    upcoming: int
    past: int
    cancelled: int
```
（確認 `status_groups` 不 import `schemas`，避免循環。）

- [ ] **Step 5：routes**

`VisitRequestFilters.__init__` 加參數與屬性：

```python
        group: str | None = Query(
            default=None,
            pattern="^(pending|upcoming|past|cancelled)$",
            description="案件分組：pending 待處理／upcoming 預約正常／past 時間已過／cancelled 已取消",
        ),
```
```python
        self.group = group
```
`apply` 內 status 篩選旁加：

```python
        if self.group:
            stmt = stmt.where(status_groups.group_condition(self.group))
```
`audit_metadata` 若會列出套用的條件，加上 `group`（若 `labelCoverage` 要求中文，加到 `AUDIT_METADATA_KEYS`）。

緊接在 `list_visit_requests` 之後新增：

```python
@router.get("/admin/visit-requests/group-counts", response_model=VisitGroupCountsOut)
async def visit_request_group_counts(
    filters: VisitRequestFilters = Depends(),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitGroupCountsOut:
    """分頁上的數字：套用同一組篩選（狀態與分組除外）後各組幾筆。"""
    require_scope(current_user, "booking.read")
    filters.status = None
    filters.group = None
    base = filters.apply(select(func.count()).select_from(VisitRequest), current_user, "booking.read")
    counts = {}
    for group in status_groups.GROUPS:
        counts[group] = (await db.execute(base.where(status_groups.group_condition(group)))).scalar_one()
    return VisitGroupCountsOut(**counts)
```

- [ ] **Step 6：跑測試**

Run: `cd backend && uv run pytest tests/test_visit_groups.py -q`
Expected: `3 passed`。

- [ ] **Step 7：Commit（需授權）**

```bash
git add backend/app/booking/status_groups.py backend/app/booking/schemas.py backend/app/booking/routes.py \
  backend/tests/test_visit_groups.py
git commit -m "feat(booking): 後台列表依預約正常、時間已過、已取消分組

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A7：存規則即補場次、停止申請不列待人工處理、月曆帶版本

**Files:**
- Modify: `backend/app/booking/schedule_routes.py`（`update_visit_schedule` 64–118 行）
- Modify: `backend/app/booking/schemas.py`（`VisitScheduleSlotSyncOut`、`CalendarSlotOut` 約 2328 對應的 Python 類別）
- Modify: `backend/app/booking/attention.py`
- Modify: `backend/app/booking/routes.py`（`get_visit_calendar` 680–738 行）
- Test: `backend/tests/test_session_schedule.py`

**Interfaces:**
- Produces：`VisitScheduleSlotSyncOut.created: int`；`CalendarSlotOut.version: int`、`CalendarSlotOut.closed_source: str | None`。

- [ ] **Step 1：寫失敗的測試**

`backend/tests/test_session_schedule.py`：

```python
from __future__ import annotations

from datetime import timedelta

import pytest

from app.common.timezones import today_local
from tests.conftest import book_slot, create_slot, open_manage

pytestmark = pytest.mark.usefixtures("booking_consent")
API = "/api/website/v1"


@pytest.mark.asyncio
async def test_saving_rules_fills_slots_right_away(admin_client):
    current = (await admin_client.get(f"{API}/admin/visit-schedule/yihua")).json()

    response = await admin_client.put(
        f"{API}/admin/visit-schedule/yihua",
        json={
            "expected_version": current["version"],
            "min_lead_hours": 24,
            "max_advance_days": 14,
            "rules": [
                {"weekday": day, "start_time": "10:00:00", "end_time": "11:00:00", "slot_minutes": 60, "capacity": 1}
                for day in range(7)
            ],
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["slot_sync"]["created"] >= 14
    today = today_local()
    slots = (
        await admin_client.get(
            f"{API}/admin/slots?campus_key=yihua&date_from={today}&date_to={today + timedelta(days=14)}"
        )
    ).json()
    assert len(slots) >= 14


async def _slot(admin_client, slot_id: str, slot_date: str) -> dict:
    rows = (await admin_client.get(f"{API}/admin/slots?campus_key=yihua&date_from={slot_date}&date_to={slot_date}")).json()
    return next(row for row in rows if row["id"] == slot_id)


@pytest.mark.asyncio
async def test_manual_stop_keeps_bookings_valid_and_out_of_attention(admin_client, public_client):
    booked = await book_slot(admin_client, public_client)
    slot = await _slot(admin_client, booked["slot_id"], booked["slot_date"])

    stopped = await admin_client.patch(
        f"{API}/admin/slots/{booked['slot_id']}", json={"closed": True, "expected_version": slot["version"]}
    )

    assert stopped.status_code == 200, stopped.text
    attention = (await admin_client.get(f"{API}/admin/visit-requests", params={"needs_attention": "true"})).json()
    assert booked["receipt_id"] not in {row["id"] for row in attention}
    public = (
        await public_client.get(
            f"{API}/public/slots",
            params={"campus_key": "yihua", "date_from": booked["slot_date"], "date_to": booked["slot_date"]},
        )
    ).json()
    assert booked["slot_id"] not in {row["id"] for row in public}
    detail = (await admin_client.get(f"{API}/admin/visit-requests/{booked['receipt_id']}")).json()
    assert detail["status"] == "confirmed"


@pytest.mark.asyncio
async def test_holiday_still_needs_attention(admin_client, public_client):
    booked = await book_slot(admin_client, public_client)

    holiday = await admin_client.post(
        f"{API}/admin/visit-schedule/yihua/exceptions", json={"exception_date": booked["slot_date"], "reason": "研習"}
    )

    assert holiday.status_code == 201, holiday.text
    attention = (await admin_client.get(f"{API}/admin/visit-requests", params={"needs_attention": "true"})).json()
    assert booked["receipt_id"] in {row["id"] for row in attention}


@pytest.mark.asyncio
async def test_parent_can_leave_a_stopped_slot(admin_client, public_client):
    booked = await book_slot(admin_client, public_client)
    await open_manage(public_client, booked["manage_path"])
    other = await create_slot(admin_client, days_ahead=5, start_time="14:30:00", end_time="15:30:00")
    slot = await _slot(admin_client, booked["slot_id"], booked["slot_date"])
    await admin_client.patch(
        f"{API}/admin/slots/{booked['slot_id']}", json={"closed": True, "expected_version": slot["version"]}
    )

    moved = await public_client.post(
        f"{API}/public/visit-manage/reschedule", json={"visit_request_id": booked["receipt_id"], "slot_id": other}
    )

    assert moved.status_code == 200, moved.text
    assert moved.json()["slot"]["id"] == other


@pytest.mark.asyncio
async def test_calendar_slots_carry_version_and_close_source(admin_client, public_client):
    booked = await book_slot(admin_client, public_client)

    calendar = (
        await admin_client.get(
            f"{API}/admin/visit-calendar",
            params={"date_from": booked["slot_date"], "date_to": booked["slot_date"], "campus_key": "yihua"},
        )
    ).json()

    row = next(item for item in calendar if item["id"] == booked["slot_id"])
    assert isinstance(row["version"], int)
    assert row["closed_source"] is None
```

- [ ] **Step 2：跑測試確認失敗**

Run: `cd backend && uv run pytest tests/test_session_schedule.py -q`
Expected: FAIL（`created` 不存在、停止申請的案件出現在待人工處理、月曆沒有 `version`）。

- [ ] **Step 3：實作**

`schemas.VisitScheduleSlotSyncOut` 加 `created: int = 0`。

`schedule_routes.update_visit_schedule`：`slot_sync = await schedule_service.sync_rule_slots(...)` 下一行：

```python
    # 存檔當下就把新規則的場次補到最遠開放天數，不等下一輪定期工作
    # （config.rules_extended_on 上面已清空，所以這裡一定會補）。
    slot_sync["created"] = await schedule_service.extend_from_rules(db, campus_key)
```

`attention.py`：

```python
from app.booking.models import SlotClosedSource, VisitRequest, VisitRequestStatus, VisitSlot
```
```python
    # 2026-09-30 起「停止申請」（園方手動關閉）只是不收新預約，已約的家長照常參觀；
    # 只有休假日整天關閉，已排入的家長才需要人工聯絡。
    closed_upcoming_slots = select(VisitSlot.id).where(
        VisitSlot.closed.is_(True),
        VisitSlot.closed_source == SlotClosedSource.EXCEPTION.value,
        VisitSlot.slot_date >= today_local(current),
    )
```

`CalendarSlotOut` 加 `version: int` 與 `closed_source: str | None = None`；`get_visit_calendar` 建 `CalendarSlotOut(...)` 時帶 `version=slot.version, closed_source=slot.closed_source`。

- [ ] **Step 4：跑測試**

Run: `cd backend && uv run pytest tests/test_session_schedule.py -q`
Expected: `5 passed`。

- [ ] **Step 5：Commit（需授權）**

```bash
git add backend/app/booking/schedule_routes.py backend/app/booking/schemas.py backend/app/booking/attention.py \
  backend/app/booking/routes.py backend/tests/test_session_schedule.py
git commit -m "feat(booking): 存每週規則即補場次，停止申請不再列入待人工處理

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task A8：既有後端測試改寫（分三批）

**Files:** 附錄 `2026-09-30-parent-self-booking-A-test-migration.md` 列的測試檔。

**Interfaces:** Consumes A1 的 helper；不改任何 `backend/app` 程式。若某個測試揭露 A2–A7 的實作錯誤，停下來回報，不要改測試遷就。

每一批的步驟相同：

- [ ] **Step 1：照附錄改寫該批檔案**（規則見附錄開頭；OBSOLETE 就刪，不要改成測別的）
- [ ] **Step 2：只跑該批檔案**，全綠為止
- [ ] **Step 3：Commit（需授權）**，訊息 `test(booking): 既有測試改用自選場次建案（第 N 批）`

**第 1 批（送單與設定）：** test_booking_modes.py、test_secfix_booking.py、test_booking_concurrency.py、test_booking_consent_readiness.py、test_visit_details.py、test_visit_option_codes.py、test_campus_status_media_tags.py、test_bugfix_regressions.py

Run: `cd backend && uv run pytest tests/test_booking_modes.py tests/test_secfix_booking.py tests/test_booking_concurrency.py tests/test_booking_consent_readiness.py tests/test_visit_details.py tests/test_visit_option_codes.py tests/test_campus_status_media_tags.py tests/test_bugfix_regressions.py -q`

**第 2 批（案件處理與家長端）：** test_visit_workflow.py、test_visit_case_handling.py、test_parent_access.py、test_reception_handling.py、test_visit_manual_workflow.py、test_visit_manual_and_assign.py、test_audit_actions.py、test_edit_versions.py、test_display_names.py、test_request_id_and_error_codes.py、test_visit_attention_export.py、test_visit_schedule.py

Run: `cd backend && uv run pytest tests/test_visit_workflow.py tests/test_visit_case_handling.py tests/test_parent_access.py tests/test_reception_handling.py tests/test_visit_manual_workflow.py tests/test_visit_manual_and_assign.py tests/test_audit_actions.py tests/test_edit_versions.py tests/test_display_names.py tests/test_request_id_and_error_codes.py tests/test_visit_attention_export.py tests/test_visit_schedule.py -q`

**第 3 批（通知、背景工作、統計、保存）：** test_notifications.py、test_notification_email.py、test_notification_retry_reminders.py、test_maintenance.py、test_line_notifications.py、test_security_hardening.py、test_operations.py、test_analytics_funnel.py、test_retention_policy.py

Run: `cd backend && uv run pytest tests/test_notifications.py tests/test_notification_email.py tests/test_notification_retry_reminders.py tests/test_maintenance.py tests/test_line_notifications.py tests/test_security_hardening.py tests/test_operations.py tests/test_analytics_funnel.py tests/test_retention_policy.py -q`

最後跑全套：`cd backend && uv run pytest -q`，Expected: 全部 PASS（約 1,000 項）。有失敗就列出檔名與原因回報，不要跳過。

---

### Task A9：契約、標籤檢查與階段閘門

**Files:**
- Modify（重產）：`contracts/openapi.json`、`contracts/generated/website-api.d.ts`
- Modify: `docs/specs/2026-09-30-parent-self-booking-design.md`（把本階段開頭「對規格的技術調整」寫回 §3、§5、§7）

- [ ] **Step 1：重產契約**

```bash
cd /private/tmp/ivy-website-self-booking-20260930 && npm run contract:generate && npm run contract:check
```
Expected: `contract:check` 無差異、exit 0。

- [ ] **Step 2：確認沒有漏網的舊引用**

```bash
grep -rn "mark_contacting\|create_reschedule_request\|slots_auto_confirm\|TOKEN_TTL\b\|phone_masked" backend/app
```
Expected: 只剩 `models.py` 的 `slots_auto_confirm` 欄位定義、`service.py` 設為 True 那行。

- [ ] **Step 3：後台標籤覆蓋**

```bash
cd admin && npx vitest run src/__tests__/labelCoverage.test.ts
```
Expected: PASS。

- [ ] **Step 4：回寫規格**

把本檔「本階段對規格的技術調整」逐條改進規格對應段落（§3.1 送單 422、§3.2 `manage_path`／密鑰更換、§3.3 版本衝突代碼與 `phone_masked`、§3.5 `cancel_reason`、§5.1 暫停說明、§7 第 5 點）。

- [ ] **Step 5：階段閘門**

```bash
cd backend && uv run pytest -q
cd .. && npm run contract:check
```
兩者都要貼出成功輸出。**web 與 admin 的 typecheck 在這個階段預期會失敗**（契約已改、前端還沒跟上），由階段 B、C 修。

- [ ] **Step 6：Commit（需授權）**

```bash
git add contracts/openapi.json contracts/generated/website-api.d.ts docs/specs/2026-09-30-parent-self-booking-design.md
git commit -m "chore(contracts): 家長自選場次的 API 契約與規格技術調整

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
