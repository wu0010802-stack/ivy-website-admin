# 成效統計補強（招生分析階段 1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓後台 `/admin/analytics` 看得到授權範圍內的五校並排比較、選定校區的到場率／未到率／取消率與現在的待處理三種（可點進已篩好的案件清單）、流量與事件的每日趨勢，以及預約孩子依生日換算的班別分布；每張圖都寫期間、單位、更新時間與涵蓋範圍。

**Architecture:** 後端在 `backend/app/operations/` 新增一個去識別的報表 service（預約結果、班別分布）與事件日趨勢查詢，三支新 GET 路由沿用 `/api/website/v1/admin/analytics/*`、`require_scope("analytics.read")` 與校區範圍；「待處理三種」抽成 `backend/app/booking/pending_kinds.py`，總覽、案件列表篩選與新報表共用同一份條件。後台在 `admin/src/components/analytics/` 新增各自抓資料的面板元件（CSS 長條、不裝圖表套件），`AnalyticsView.vue` 只負責排版與傳期間／校區。不新增資料表、不寫 migration。

**Tech Stack:** FastAPI 0.136.1（釘版）、SQLAlchemy 2.0 async、PostgreSQL 14、pytest；Vue 3 + Element Plus + Vite、Vitest + @vue/test-utils；OpenAPI → `openapi-typescript` 契約。

**Spec:** `docs/analysis/2026-09-30-enrollment-analytics-report.md`（第 3 節指標口徑、第 4 節階段 1 第 1–8 項、第 6 節實作定位、第 7 節驗收 E01–E08、E25–E27）；交接提示 `docs/handoff/2026-09-30-claude-enrollment-analytics.md`。

## 設計決定

| # | 決定 | 理由 |
|---|---|---|
| D1 | **五校並排與招生入學 `/compare` 分開做**（使用者 2026-10-03 裁定）。統計頁只放預約與流量指標：預約案件、到場、未到、到場率、取消（依原因）、取消率、現在的待處理三種；不放參觀／預繳／註冊。 | 報告 §4 第 1 項邊界；裁定。 |
| D2 | 「預約結果」用**同批案件**口徑：依案件送出時間 `created_at`（台北日界線）取期間內的案件，看它們**現在**的結果。和既有「預約流程」（依事件發生日期）分開，畫面寫明兩邊不能互相相除。 | 報告 §3.2；`analytics_events` 沒有案件 id（`operations/models.py:67`），也沒有未到場事件，未到率只能從 `visit_requests` 算。 |
| D3 | **到場率＝已到場 ÷（已到場＋未到場）**；未到率同分母；取消率＝已取消 ÷ 預約案件。參觀時間已過但還沒標記的另列「參觀時間過了，還沒標記」，**不算進分母、不當成到場**。分母 0 → `value: null`（畫面「—」）；分母 1–19 → 「樣本較少」。 | 報告 §3.2「禁止用預定日期已過直接判定已到場」、§3.3。分母定義列為待使用者確認（見文末）。 |
| D4 | 比率格式沿用招生入學：後端 `pct()` 一位小數百分比、回應型別直接重用 `AdmissionsRate`（`value/numerator/denominator`）；前端用 `admissions/statsFormat.ts` 的 `formatRate`，寫成「66.7%（2/3）」。 | 同一個後台兩種比率格式會混亂；`admissions/schemas.py:589`、`admissions/stats.py:61` 已有。 |
| D5 | 待處理三種（舊資料待處理／參觀時間過了還沒標記／到期待追蹤）是**現在的狀態，不受期間影響**，條件只寫在 `booking/pending_kinds.py`；總覽 `dashboard_service.py:79-94` 與案件列表 `routes.py:884-891` 改用它。 | 報告 §3.4「兩邊要共用同一個查詢，不能各寫一份」；目前 follow-up 條件在兩處各抄一份。 |
| D6 | 待處理數字只有 `booking.read` 的人看得到連結（連到 `/visit-requests?campus=…&group=pending`、`…&group=past&status=confirmed`、`…&due=1`，和總覽同一組參數）；只有 `analytics.read` 的人只看數字。 | 報告 §6.3、E02。 |
| D7 | 班別換算在**後端**用 `admissions/academic.grade_for_birthday`，共用案例 `contracts/ivy-recruitment/grade-cases.json`（後端、官網、後台三邊已在讀）。缺生日（含舊案只有年齡文字、補登沒問、已匿名化）→「沒有生日資料」；有生日但不在幼幼班～大班 →「不在幼幼班～大班」。含已取消的預約。 | 報告 §4 第 3 項「後端若也算，前後端共用同一組測試案例」；`academic.py:52` 已等價於 `admission-classes.ts`。 |
| D8 | 圖一律「CSS 長條＋數字」，不裝圖表套件；每日趨勢是 CSS 直條，下方 `<details>` 列每日數字。 | DESIGN.md:1559（招生入學統計規則）。 |
| D9 | 每日趨勢標出口徑改變的日子：流量標 **2026-09-30**（內頁開始計入），事件標 **2026-10-01**（自選場次上線）；只畫在期間內的。 | 報告 §4 第 6 項、§3.2、E26、E27。 |
| D10 | 三支新 API 與既有 funnel、traffic 回應都帶 `as_of`（伺服器時間）；新 API 另帶 `unit`。 | 報告 §6.2、§4 第 8 項。 |
| D11 | 各面板元件自己抓資料（同 `SiteTrafficPanel`），`AnalyticsView` 只傳 `range`／`campusKey`。換校只換顯示的列、不重抓「預約結果」（它一次回全部授權校區）；換期間才重抓。 | 報告 §6.1「不要全部塞回這個 view」；E07 用 `useRequestSequence` 擋回應順序顛倒。 |

## 已完成、不做

| 項目 | 現況（origin/main `15fd9a5`） |
|---|---|
| §4 第 5 項：確認率跨 10-01 不混算 | 已做：`admin/src/views/AnalyticsView.vue:131-132` `SELF_BOOKING_SINCE`／`coversSelfBooking`，期間碰到 10/01 以後不計確認率（`6b76f11`）。本計畫只補到場率、未到率。 |
| §4 第 6 項前半：流量涵蓋說明 | 已更正：`admin/src/components/SiteTrafficPanel.vue:81-82` 已寫「2026/09/30 起也計入關於我們…」。本計畫只補趨勢上的標記。 |
| §4 第 7 項：日期、來源、取消、CTA、速度分析 | 已有，本計畫只加 `as_of` 與單位，不改既有計算（`analyticsFunnel.test.ts`、`traffic.test.ts` 照跑）。 |
| `admission-classes.ts` 規則的後端版本 | 已有：`backend/app/admissions/academic.py:52` `grade_for_birthday`＋共用案例（`backend/tests/test_admissions_academic.py:28-37`）。直接用，不另寫。 |

**不在本計畫：** 統計頁 CSV 匯出（歸「匯出擴充」計畫）；測試／重複案件的人工排除標記（報告 §3.1，要新欄位＋migration）；UTM 與表單成效（報告階段 3）。

## Global Constraints

- Node 22（`.nvmrc` 22.23.2）；所有 Node 指令前綴 `source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1;`（分號，不用 `&&`：nvm.sh 會回 3）。
- FastAPI 0.136.1 已釘版，**不升級**；**不新增**任何 npm 或 Python 依賴。
- **不新增資料表、不寫 migration**（報告 §4「這一階段不新增資料表，也不寫 migration」）。
- 計數單位一律寫「預約案件數」，畫面註明「同一個孩子預約兩校算兩筆，不是家庭數」；**禁止依電話合併**（報告 §3.1）。
- `completed` 只代表「已到場」，不是入學；班別是年齡對照，**不是報名或入學結果**。
- 比率分母 0 → `null`／「—」；分母 1–19 → 「樣本較少」；查詢失敗顯示錯誤，**不能顯示成 0**（報告 §3.3）。
- 日期：台北日界線、兩端都含（實作上是 `[開始日 00:00, 結束日隔天 00:00)`）；DB 存 UTC；用 `app.common.timezones.local_day_bounds_utc`。
- 權限在後端落實：`require_scope(user, "analytics.read", campus_keys=[...])`；越權校區回 404；只列 `covers_campus` 為真的校區；回應不含姓名、電話、Email、生日。
- 待處理三種的條件**只能**寫在 `backend/app/booking/pending_kinds.py`。
- 錯誤提示用元件內 `el-alert` 或 `composables/notify.ts`，不直接呼叫 `ElMessage.error／warning`（`crossUx20261002.test.ts` 守門）。
- 狀態用詞以 `admin/src/api/labels.ts` 為準：completed「已到場」、no_show「未到場」、confirmed「預約正常」；「場次」不叫「時段」。
- 圖表：CSS 長條，填色 `var(--el-color-primary)`、底 `var(--surface-3)`／`var(--line)`；顏色只用 token，不寫色值。
- 不 push、不部署、不碰正式庫；commit 用 Conventional Commit、繁體中文，結尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`，`git add` 列明檔案。
- 機器 8GB：一次只跑一組測試；每個 Task 只跑單檔前景測試，全套在最後的驗證閘門由主 session 背景跑。

## Review Focus

1. **台北凌晨的案件與事件**（UTC 前一天 16:00 之後）：一定算在台北的那一天，不重複、不遺漏 → Task 2 `test_period_uses_taipei_days_of_created_at`、Task 3 `test_days_are_taipei_dates_and_zero_filled`。
2. **快速切換期間或校區、回應順序顛倒**：畫面只顯示最後一次的選擇，沒有上一次的殘留 → Task 8「回應順序顛倒…」、Task 9 同類測試。
3. **分母 0 與小樣本**：沒有資料寫「—」不寫 0%，分母 3 提示「樣本較少」→ Task 5 helper 測試、Task 8 面板測試、Task 2 `test_rates_are_null_when_nothing_to_divide`。
4. **已匿名化或沒填生日的案件**：仍算進總數、歸「沒有生日資料」，不被猜成某班、也不消失 → Task 4 `test_missing_or_anonymized_birthdays_are_unrecorded`。
5. **390px 手機**：五校比較表在框內橫捲、頁面本身不橫向溢出 → Task 11 把 `/analytics` 加進 `tests/stack/keyboard.spec.ts` 的溢出檢查。

---

## File Structure

| 檔案 | 動作 | 責任 |
|---|---|---|
| `backend/app/booking/pending_kinds.py` | 新增 | 待處理三種的 SQL 條件，唯一來源 |
| `backend/app/operations/dashboard_service.py:14,79-94` | 修改 | 總覽兩個待辦改用 `pending_kinds` |
| `backend/app/booking/routes.py:19-31,884-891` | 修改 | 案件列表 `follow_up_due` 篩選改用 `pending_kinds` |
| `backend/app/operations/analytics_service.py` | 修改 | `FunnelRange.on(column)`；新增 `get_event_trend` |
| `backend/app/operations/booking_outcomes_service.py` | 新增 | 預約結果（同批案件＋現在待處理）、班別分布 |
| `backend/app/operations/routes.py` | 修改 | 三支新 GET、`_validate_range`、funnel／traffic 加 `as_of` |
| `backend/tests/analytics_fixtures.py` | 新增 | 直接寫庫建場次與任意狀態案件的 helper |
| `backend/tests/test_analytics_pending_kinds.py` | 新增 | E08、總覽與列表一致 |
| `backend/tests/test_analytics_booking_outcomes.py` | 新增 | E01–E03、E26、比率、範圍 |
| `backend/tests/test_analytics_event_trend.py` | 新增 | E03、E04、範圍、`as_of` |
| `backend/tests/test_analytics_class_distribution.py` | 新增 | E05、E06 |
| `contracts/openapi.json`、`contracts/generated/website-api.d.ts` | 產生 | `npm run contract:generate`，不手改 |
| `admin/src/api/types.ts` | 修改 | 新 schema 的型別別名 |
| `admin/src/api/analytics.ts` | 新增 | 三支 API、比率文字、小樣本、待處理連結、`SELF_BOOKING_SINCE` |
| `admin/src/api/traffic.ts` | 修改 | `TrafficSummary.as_of`、`TRAFFIC_COVERAGE_EXPANDED_ON` |
| `admin/src/components/analytics/AnalyticsMeta.vue` | 新增 | 期間・單位・更新時間・涵蓋範圍一行 |
| `admin/src/components/analytics/DailyBars.vue` | 新增 | 每日 CSS 直條＋標記＋每日數字表 |
| `admin/src/components/analytics/BookingOutcomesSection.vue` | 新增 | 五校比較表＋選定校區的預約結果與待處理 |
| `admin/src/components/analytics/EventTrendPanel.vue` | 新增 | 選定校區的每日事件 |
| `admin/src/components/analytics/ClassDistributionPanel.vue` | 新增 | 預約孩子的班別 |
| `admin/src/components/SiteTrafficPanel.vue` | 修改 | 每日瀏覽直條、09-30 標記、meta |
| `admin/src/views/AnalyticsView.vue` | 修改 | 排入新面板、funnel meta、頁首說明 |
| `admin/src/__tests__/analyticsHelpers.test.ts`、`analyticsCharts.test.ts`、`analyticsOutcomes.test.ts`、`analyticsTrend.test.ts`、`analyticsClasses.test.ts` | 新增 | 各元件測試 |
| `admin/src/__tests__/analyticsFunnel.test.ts`、`traffic.test.ts` | 修改 | fixture 加 `as_of`、stub 新面板、新斷言 |
| `tests/stack/keyboard.spec.ts:112-124` | 修改 | `/analytics` 加進後台溢出檢查 |
| `README.md`、`DESIGN.md`、`docs/website-admin/acceptance.md` | 修改 | 紀錄、規則、「招生分析階段 1」驗收 |

---

### Task 0: 開工準備（worktree、依賴、測試庫、基準）

**Files:** 無程式改動。

- [ ] **Step 1: 確認基準與在途工作**

```bash
git -C ~/Desktop/ivy-website-admin fetch origin
git -C ~/Desktop/ivy-website-admin log --oneline -1 origin/main
git -C ~/Desktop/ivy-website-admin worktree list
gh run list --branch main --limit 1
```

Expected: origin/main 是 `15fd9a5` 或更新；記下 head。若有別的 worktree 也在改 `admin/src/views/AnalyticsView.vue` 或 `backend/app/operations/`（例如匯出擴充計畫），先問使用者順序。

- [ ] **Step 2: 開 sparse worktree**

```bash
WT=~/Desktop/ivy-website-analytics-20261003
git -C ~/Desktop/ivy-website-admin worktree add --no-checkout -b feature/admin-analytics-phase1-20261003 "$WT" origin/main
git -C "$WT" sparse-checkout set --cone web backend admin content contracts tests deploy scripts docs .github
git -C "$WT" checkout
```

Expected: `$WT/admin`、`$WT/backend` 存在，`git -C "$WT" status --short` 空白。

- [ ] **Step 3: 安裝依賴（各自的 node_modules／.venv，不 symlink 別人的）**

```bash
cd ~/Desktop/ivy-website-analytics-20261003
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm ci; npm --prefix admin ci; npm --prefix web ci
cd backend; uv sync --frozen
```

Expected: 三個 `npm ci` 結束碼 0；`uv sync` 結束碼 0。

- [ ] **Step 4: 建自己的測試庫並 migrate**

```bash
createdb ivy_website_analytics_test
cd ~/Desktop/ivy-website-analytics-20261003/backend
WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev \
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_analytics_test \
WEBSITE_SESSION_SECRET=local-only-session-secret-123 uv run --frozen alembic upgrade head
```

Expected: 最後一行 `Running upgrade ... -> <head>`，無錯誤。之後所有 pytest 指令前綴 `WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_analytics_test`（下文記為 `$TDB`，可先 `export TDB=postgresql+asyncpg://localhost/ivy_website_analytics_test`）。

- [ ] **Step 5: 跑相關單檔確認基準綠**

```bash
cd ~/Desktop/ivy-website-analytics-20261003/backend
WEBSITE_TEST_DATABASE_URL=$TDB uv run --frozen pytest -q tests/test_analytics_funnel.py tests/test_traffic.py tests/test_operations.py
cd ..; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/analyticsFunnel.test.ts src/__tests__/traffic.test.ts
```

Expected: 全部 passed。若台北時間是週五且失敗的是 `test_booking_consent_readiness` 的場次同步，那是 main 既有的已知失敗，與本計畫無關（不在上面三檔）。

---

### Task 1: 待處理三種只留一份條件

**Files:**
- Create: `backend/app/booking/pending_kinds.py`
- Create: `backend/tests/analytics_fixtures.py`
- Create: `backend/tests/test_analytics_pending_kinds.py`
- Modify: `backend/app/operations/dashboard_service.py:14,79-94`
- Modify: `backend/app/booking/routes.py:19-31,884-891`

**Interfaces:**
- Produces: `pending_kinds.PENDING_KINDS: tuple[str, ...] = ("legacy_pending", "awaiting_attendance", "follow_up_due")`；`pending_kinds.condition(kind: str, now: datetime | None = None) -> ColumnElement[bool]`（未知 kind 丟 `ValueError`）。
- Produces（測試 helper）：`add_slot(db, *, campus_key="yihua", days_from_today=0, start=time(10, 0), capacity=5) -> uuid.UUID`；`add_case(db, *, campus_key="yihua", status="confirmed", created_at=None, slot_id=None, source="web", cancel_reason=None, follow_up_at=None, child_birthdate=None, anonymized=False) -> uuid.UUID`；`taipei(day: date, hour=12, minute=0) -> datetime`（台北牆上時間轉 aware UTC）。helper 只 `flush`，呼叫端自己 `commit`。

- [ ] **Step 1: 寫測試 helper**

`backend/tests/analytics_fixtures.py`：

```python
"""成效統計測試用：直接寫庫建場次與任意狀態、任意送出時間的案件。

自選場次上線後，API 建不出舊流程狀態（new／contacting／pending_confirmation），也不能
指定送出時間；這裡繞過 API，不產生 outbox、歷程或統計事件。只 flush，呼叫端自己 commit。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.booking.models import VisitRequest, VisitSlot
from app.common.timezones import OPERATING_TZ, today_local


def taipei(day: date, hour: int = 12, minute: int = 0) -> datetime:
    """台北牆上時間 → aware UTC。"""
    return datetime.combine(day, time(hour, minute), tzinfo=OPERATING_TZ).astimezone(timezone.utc)


async def add_slot(
    db: AsyncSession,
    *,
    campus_key: str = "yihua",
    days_from_today: int = 0,
    start: time = time(10, 0),
    capacity: int = 5,
) -> uuid.UUID:
    slot = VisitSlot(
        id=uuid.uuid4(),
        campus_key=campus_key,
        slot_date=today_local() + timedelta(days=days_from_today),
        start_time=start,
        end_time=time(start.hour + 1, start.minute),
        capacity=capacity,
        closed=False,
        created_at=datetime.now(timezone.utc),
    )
    db.add(slot)
    await db.flush()
    return slot.id


async def add_case(
    db: AsyncSession,
    *,
    campus_key: str = "yihua",
    status: str = "confirmed",
    created_at: datetime | None = None,
    slot_id: uuid.UUID | None = None,
    source: str = "web",
    cancel_reason: str | None = None,
    follow_up_at: datetime | None = None,
    child_birthdate: date | None = None,
    anonymized: bool = False,
) -> uuid.UUID:
    case = VisitRequest(
        id=uuid.uuid4(),
        campus_key=campus_key,
        idempotency_key=f"report-{uuid.uuid4().hex}",
        payload_hash="0" * 64,
        config_version=0,
        parent_name="測試家長",
        phone="0911000222",
        referral_sources=[],
        consent_given=True,
        status=status,
        source=source,
        slot_id=slot_id,
        cancel_reason=cancel_reason,
        follow_up_at=follow_up_at,
        child_birthdate=child_birthdate,
        anonymized_at=datetime.now(timezone.utc) if anonymized else None,
        created_at=created_at or datetime.now(timezone.utc),
    )
    db.add(case)
    await db.flush()
    return case.id
```

- [ ] **Step 2: 寫失敗的測試**

`backend/tests/test_analytics_pending_kinds.py`：

```python
"""待處理三種（招生分析報告 3.4）只有一份定義：總覽、案件列表的篩選與成效統計共用
booking/pending_kinds.py，總覽的數字點進清單才會是同一批案件。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.booking import pending_kinds
from app.booking.models import VisitRequest
from tests.analytics_fixtures import add_case, add_slot

BASE = "/api/website/v1/admin"


async def _seed(db) -> None:
    past = await add_slot(db, days_from_today=-1)
    future = await add_slot(db, days_from_today=3)
    due = datetime.now(timezone.utc) - timedelta(hours=1)
    await add_case(db, status="new")  # 舊資料待處理
    await add_case(db, status="confirmed", slot_id=past)  # 參觀時間過了、還沒標記
    await add_case(db, status="confirmed", slot_id=future, follow_up_at=due)  # 到期待追蹤
    await add_case(db, status="completed", slot_id=past, follow_up_at=due)  # 已到場：哪一種都不算
    await add_case(db, status="cancelled", slot_id=future, follow_up_at=due, cancel_reason="staff")  # 已取消：不算
    await add_case(db, status="confirmed", slot_id=future, follow_up_at=datetime.now(timezone.utc) + timedelta(days=1))
    await db.commit()


async def _list_count(client, query: str) -> int:
    response = await client.get(f"{BASE}/visit-requests?{query}&page_size=100")
    assert response.status_code == 200, response.text
    return len(response.json())


@pytest.mark.asyncio
async def test_condition_counts_each_kind(db_session):
    await _seed(db_session)
    counts = {
        kind: (
            await db_session.execute(select(func.count()).select_from(VisitRequest).where(pending_kinds.condition(kind)))
        ).scalar_one()
        for kind in pending_kinds.PENDING_KINDS
    }
    assert counts == {"legacy_pending": 1, "awaiting_attendance": 1, "follow_up_due": 1}


@pytest.mark.asyncio
async def test_dashboard_and_list_filters_agree(admin_client, db_session):
    await _seed(db_session)
    dashboard = (await admin_client.get(f"{BASE}/dashboard")).json()
    assert dashboard["awaiting_attendance"] == 1
    assert dashboard["pending_follow_up"] == 1
    assert await _list_count(admin_client, "group=past&status=confirmed") == 1
    assert await _list_count(admin_client, "follow_up_due=true") == 1
    assert await _list_count(admin_client, "group=pending") == 1


def test_unknown_kind_is_a_programming_error():
    with pytest.raises(ValueError):
        pending_kinds.condition("contact_later")
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `cd backend; WEBSITE_TEST_DATABASE_URL=$TDB uv run --frozen pytest -q tests/test_analytics_pending_kinds.py`
Expected: FAIL，`ImportError: cannot import name 'pending_kinds' from 'app.booking'`。

- [ ] **Step 4: 實作 `pending_kinds.py`**

```python
"""「待處理」的三種（2026-09-30 招生分析報告 3.4，取代原本的「待聯絡」）。

自選場次之後沒有「等園方聯絡確認」這一步；還要人處理的只剩：

- legacy_pending：上線前留下、狀態仍是 new／contacting／pending_confirmation 的舊案
  （案件列表「待處理」那一組）。
- awaiting_attendance：已確認、場次已開始，還沒標記到場或未到場（列表「時間已過」的
  已確認部分；總覽「參觀時間過了，還沒標記到場」）。
- follow_up_due：設了下次聯絡時間而且到了，案件沒有取消也沒有到場。

總覽、案件列表的篩選與成效統計都從這裡取條件，數字點進清單才會是同一批案件。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import and_

from app.booking import status_groups
from app.booking.models import VisitRequest, VisitRequestStatus
from app.common.timezones import now_utc

PENDING_KINDS = ("legacy_pending", "awaiting_attendance", "follow_up_due")


def condition(kind: str, now: datetime | None = None):
    current = now or now_utc()
    if kind == "legacy_pending":
        return status_groups.group_condition("pending", current)
    if kind == "awaiting_attendance":
        return and_(
            VisitRequest.status == VisitRequestStatus.CONFIRMED.value,
            status_groups.group_condition("past", current),
        )
    if kind == "follow_up_due":
        return and_(
            VisitRequest.follow_up_at.is_not(None),
            VisitRequest.follow_up_at <= current,
            VisitRequest.status.not_in([VisitRequestStatus.CANCELLED.value, VisitRequestStatus.COMPLETED.value]),
        )
    raise ValueError(f"未知的待處理種類：{kind}")
```

- [ ] **Step 5: 總覽與列表改用它**

`backend/app/operations/dashboard_service.py`：第 14 行 `from app.booking.status_groups import group_condition` 改成 `from app.booking import pending_kinds`（`group_condition` 在本檔只用在這裡，改完就沒有其他引用）；第 79–94 行換成：

```python
    # 參觀時間已過、還沒標記到場或未到場的案件（booking/pending_kinds.py，和案件列表
    # 「時間已過」那一組的已確認部分、成效統計同一個條件）。總覽提醒有人去補標記。
    awaiting_attendance_stmt = _scope(
        select(func.count()).select_from(VisitRequest).where(pending_kinds.condition("awaiting_attendance", now)),
        VisitRequest.campus_key,
    )
    awaiting_attendance = (await db.execute(awaiting_attendance_stmt)).scalar_one()

    pending_follow_up_stmt = _scope(
        select(func.count()).select_from(VisitRequest).where(pending_kinds.condition("follow_up_due", now)),
        VisitRequest.campus_key,
    )
    pending_follow_up = (await db.execute(pending_follow_up_stmt)).scalar_one()
```

`backend/app/booking/routes.py`：第 19–31 行的 `from app.booking import (...)` 依字母順序加入 `pending_kinds,`；第 884–891 行換成：

```python
        if self.follow_up_due:
            # 與總覽「到期待追蹤」、成效統計同一個定義（booking/pending_kinds.py），
            # 總覽的數字點進來才會是同一批案件。
            stmt = stmt.where(pending_kinds.condition("follow_up_due"))
```

改完用 `grep -n "datetime.now(timezone.utc)\|timezone" backend/app/booking/routes.py | head` 確認 `datetime`／`timezone` 在檔內其他地方仍有用到（有就保留 import，沒有才刪）。

- [ ] **Step 6: 跑測試確認通過，並跑既有相關檔**

```bash
cd backend
WEBSITE_TEST_DATABASE_URL=$TDB uv run --frozen pytest -q tests/test_analytics_pending_kinds.py tests/test_operations.py tests/test_visit_attention_export.py
WEBSITE_TEST_DATABASE_URL=$TDB uv run --frozen pytest -q -k "follow_up or dashboard"
```

Expected: 全部 passed。

- [ ] **Step 7: Commit**

```bash
git add backend/app/booking/pending_kinds.py backend/app/operations/dashboard_service.py backend/app/booking/routes.py backend/tests/analytics_fixtures.py backend/tests/test_analytics_pending_kinds.py
git commit -m "$(cat <<'EOF'
refactor(booking): 待處理三種集中到 pending_kinds，總覽與案件列表共用

招生分析報告 3.4 要求待處理定義只有一份；到期待追蹤原本在總覽與列表篩選各抄一份。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 預約結果 API（同批案件、到場率、五校並排、現在待處理）

**Files:**
- Create: `backend/app/operations/booking_outcomes_service.py`
- Create: `backend/tests/test_analytics_booking_outcomes.py`
- Modify: `backend/app/operations/analytics_service.py:139-153`（`FunnelRange`）
- Modify: `backend/app/operations/routes.py`（import、`_validate_range`、新路由與 schema、funnel 改用 `_validate_range`）

**Interfaces:**
- Consumes: `pending_kinds.condition`、`PENDING_KINDS`（Task 1）；`analytics_service.FunnelRange`、`UNKNOWN`；`admissions.stats.pct`；`admissions.schemas.AdmissionsRate`。
- Produces: `FunnelRange.on(column) -> list`（`conditions()` 改成呼叫 `self.on(AnalyticsEvent.created_at)`）；`booking_outcomes_service.booking_outcomes(db, campus_keys: list[str], period: FunnelRange, now: datetime | None = None) -> dict`；`GET /api/website/v1/admin/analytics/booking-outcomes?from=YYYY-MM-DD&to=YYYY-MM-DD` → `BookingOutcomesOut`；routes 內 `_validate_range(date_from, date_to) -> None`。
- `BookingOutcomesOut` 形狀（Task 5 之後的前端依賴）：`{as_of, date_from, date_to, unit: "visit_request", campuses: CampusOutcomeOut[], totals: OutcomeCountsOut, open_now_totals: PendingNowOut}`；`OutcomeCountsOut = {cases, web_cases, pending, upcoming, awaiting_attendance, completed, no_show, cancelled, unscheduled, cancelled_by_reason: {parent, staff, hold_expired, unknown}, attendance_rate, no_show_rate, cancel_rate}`（rate 為 `AdmissionsRate`）；`CampusOutcomeOut = OutcomeCountsOut + {campus_key, active, booking_mode: str | null, open_now: PendingNowOut}`；`PendingNowOut = {legacy_pending, awaiting_attendance, follow_up_due}`。

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_analytics_booking_outcomes.py`：

```python
"""成效統計「預約結果」（招生分析階段 1 第 1、4、5 項）：期間內送出的案件現在各是什麼
結果、到場率與未到率、五校並排只列授權範圍、現在的待處理三種與總覽同一份定義。"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from tests.analytics_fixtures import add_case, add_slot, taipei
from tests.conftest import set_booking_mode

pytestmark = pytest.mark.usefixtures("booking_consent")

URL = "/api/website/v1/admin/analytics/booking-outcomes"
OUTCOME_KEYS = ("pending", "upcoming", "awaiting_attendance", "completed", "no_show", "cancelled", "unscheduled")


def _row(body: dict, campus_key: str = "yihua") -> dict:
    return next(row for row in body["campuses"] if row["campus_key"] == campus_key)


async def _get(client, query: str = "") -> dict:
    response = await client.get(f"{URL}{query}")
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_each_case_lands_in_exactly_one_outcome_with_rates(admin_client, db_session):
    past = await add_slot(db_session, days_from_today=-1)
    future = await add_slot(db_session, days_from_today=3)
    for _ in range(2):
        await add_case(db_session, status="completed", slot_id=past)
    await add_case(db_session, status="no_show", slot_id=past)
    await add_case(db_session, status="confirmed", slot_id=past)
    await add_case(db_session, status="confirmed", slot_id=future, source="phone")
    await add_case(db_session, status="cancelled", slot_id=future, cancel_reason="parent")
    await add_case(db_session, status="cancelled", slot_id=future, cancel_reason=None)
    await add_case(db_session, status="new")
    await db_session.commit()

    row = _row(await _get(admin_client))
    assert row["cases"] == 8
    assert row["web_cases"] == 7
    assert {key: row[key] for key in OUTCOME_KEYS} == {
        "pending": 1, "upcoming": 1, "awaiting_attendance": 1, "completed": 2,
        "no_show": 1, "cancelled": 2, "unscheduled": 0,
    }
    assert sum(row[key] for key in OUTCOME_KEYS) == row["cases"]
    assert row["cancelled_by_reason"] == {"parent": 1, "staff": 0, "hold_expired": 0, "unknown": 1}
    # 參觀時間過了、還沒標記的那 1 筆不算進分母，也不當成到場。
    assert row["attendance_rate"] == {"value": 66.7, "numerator": 2, "denominator": 3}
    assert row["no_show_rate"] == {"value": 33.3, "numerator": 1, "denominator": 3}
    assert row["cancel_rate"] == {"value": 25.0, "numerator": 2, "denominator": 8}


@pytest.mark.asyncio
async def test_rates_are_null_when_nothing_to_divide(admin_client):
    row = _row(await _get(admin_client))
    assert row["cases"] == 0
    for key in ("attendance_rate", "no_show_rate", "cancel_rate"):
        assert row[key] == {"value": None, "numerator": 0, "denominator": 0}


@pytest.mark.asyncio
async def test_period_uses_taipei_days_of_created_at(admin_client, db_session):
    # 兩筆在 UTC 都是 09-30，台北分屬 09-30 與 10-01。
    await add_case(db_session, status="new", created_at=taipei(date(2026, 9, 30), 23, 59))
    await add_case(db_session, status="new", created_at=taipei(date(2026, 10, 1), 0, 0))
    await db_session.commit()
    assert _row(await _get(admin_client, "?from=2026-09-30&to=2026-09-30"))["cases"] == 1
    assert _row(await _get(admin_client, "?from=2026-10-01&to=2026-10-01"))["cases"] == 1
    assert _row(await _get(admin_client, "?from=2026-09-30&to=2026-10-01"))["cases"] == 2


@pytest.mark.asyncio
async def test_only_campuses_in_scope_are_listed(admin_client, minghua_client, db_session):
    await add_case(db_session, campus_key="yihua", status="new")
    await add_case(db_session, campus_key="minghua", status="new")
    await db_session.commit()

    everyone = await _get(admin_client)
    assert [row["campus_key"] for row in everyone["campuses"]] == ["yihua", "minghua", "chongde", "international", "renwu"]
    assert everyone["totals"]["cases"] == 2

    minghua = await _get(minghua_client)
    assert [row["campus_key"] for row in minghua["campuses"]] == ["minghua"]
    assert minghua["totals"]["cases"] == 1
    assert minghua["open_now_totals"]["legacy_pending"] == 1
    # 這支 API 沒有校區參數；自己加上別校也不會擴大範圍。
    tampered = await _get(minghua_client, "?campus_key=yihua")
    assert [row["campus_key"] for row in tampered["campuses"]] == ["minghua"]


@pytest.mark.asyncio
async def test_analytics_only_role_sees_counts_without_personal_data(editor_client, db_session):
    await add_case(db_session, status="new")
    await db_session.commit()
    body = await _get(editor_client)
    assert [row["campus_key"] for row in body["campuses"]] == ["yihua"]
    text = str(body)
    for personal in ("測試家長", "0911000222", "parent_name", "phone", "email", "birthdate"):
        assert personal not in text


@pytest.mark.asyncio
async def test_open_now_matches_dashboard_and_ignores_period(admin_client, db_session):
    old = taipei(date(2026, 9, 1))
    due = datetime.now(timezone.utc) - timedelta(hours=2)
    past = await add_slot(db_session, days_from_today=-1)
    future = await add_slot(db_session, days_from_today=2)
    await add_case(db_session, status="confirmed", slot_id=past, created_at=old)
    await add_case(db_session, status="new", created_at=old)
    await add_case(db_session, status="confirmed", slot_id=future, follow_up_at=due, created_at=old)
    await add_case(db_session, status="cancelled", follow_up_at=due, cancel_reason="staff", created_at=old)
    await db_session.commit()

    dashboard = (await admin_client.get("/api/website/v1/admin/dashboard")).json()
    row = _row(await _get(admin_client, "?from=2026-10-02&to=2026-10-02"))
    assert row["cases"] == 0  # 都是 09-01 送出的，不在期間內
    assert row["open_now"] == {
        "legacy_pending": 1,
        "awaiting_attendance": dashboard["awaiting_attendance"],
        "follow_up_due": dashboard["pending_follow_up"],
    }
    assert row["open_now"]["awaiting_attendance"] == 1
    assert row["open_now"]["follow_up_due"] == 1


@pytest.mark.asyncio
async def test_period_crossing_self_booking_switch_has_no_confirmation_rate(admin_client):
    body = await _get(admin_client, "?from=2026-09-20&to=2026-10-10")
    assert not any("confirm" in key for key in body["totals"])
    assert not any("confirm" in key for key in _row(body))


@pytest.mark.asyncio
async def test_reports_booking_mode_unit_and_validates_range(admin_client):
    switched = await set_booking_mode(admin_client, "yihua", mode="slots")
    assert switched.status_code == 200, switched.text
    body = await _get(admin_client)
    assert _row(body)["booking_mode"] == "slots"
    assert body["unit"] == "visit_request"
    assert body["as_of"]

    reversed_range = await admin_client.get(f"{URL}?from=2026-10-02&to=2026-10-01")
    assert reversed_range.status_code == 422
    assert reversed_range.json()["detail"]["code"] == "INVALID_DATE_RANGE"
    too_long = await admin_client.get(f"{URL}?from=2025-01-01&to=2026-10-01")
    assert too_long.status_code == 422
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd backend; WEBSITE_TEST_DATABASE_URL=$TDB uv run --frozen pytest -q tests/test_analytics_booking_outcomes.py`
Expected: FAIL，各測試 `assert 404 == 200`（路由不存在）。

- [ ] **Step 3: `FunnelRange.on`**

`backend/app/operations/analytics_service.py` 的 `FunnelRange`（第 139 行起）改成：

```python
@dataclass(frozen=True)
class FunnelRange:
    """台北日界線的日期區間，兩端都含；None 代表不限。"""

    date_from: date | None = None
    date_to: date | None = None

    def on(self, column) -> list:
        """套在任一個 UTC 時間欄位上（事件的 created_at、案件的 created_at）。"""
        conditions = []
        if self.date_from is not None:
            conditions.append(column >= local_day_bounds_utc(self.date_from)[0])
        if self.date_to is not None:
            conditions.append(column < local_day_bounds_utc(self.date_to)[1])
        return conditions

    def conditions(self) -> list:
        return self.on(AnalyticsEvent.created_at)
```

- [ ] **Step 4: 實作 service**

`backend/app/operations/booking_outcomes_service.py`：

```python
"""成效統計的「預約結果」（2026-09-30 招生分析報告第 3、4 節，階段 1）。

- 計數單位是預約案件數：同一個孩子預約兩校算兩筆，同一支電話不合併（3.1）。
- 期間依案件的送出時間（created_at，台北日界線、兩端都含）切，是「同批案件」的口徑；
  漏斗（analytics_service.get_campus_funnel）依事件發生日期計數，兩邊不能互相相除（3.2）。
- 到場率＝已到場 ÷（已到場＋未到場）。參觀時間已過但還沒標記的另列
  awaiting_attendance，不算進分母，也不當成到場（3.2：不能用預定日期已過判定已到場）。
- 待處理三種（open_now）是現在的狀態，不受期間影響，條件在 booking/pending_kinds.py，
  和總覽、案件列表同一份。
- 不回傳任何個資；只有 analytics.read 的角色也能看。"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import case, func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.stats import pct
from app.booking import pending_kinds, status_groups
from app.booking.models import BookingConfig, VisitRequest, VisitRequestSource, VisitRequestStatus
from app.campuses.models import Campus
from app.common.timezones import now_utc
from app.operations.analytics_service import UNKNOWN, FunnelRange
from app.operations.models import CANCEL_REASONS

# 每筆案件剛好落在其中一種，加總＝cases。unscheduled：已確認卻沒有場次的舊流程資料。
OUTCOMES = ("pending", "upcoming", "awaiting_attendance", "completed", "no_show", "cancelled", "unscheduled")
CANCEL_REASON_KEYS = (*CANCEL_REASONS, UNKNOWN)


def _rate(numerator: int, denominator: int) -> dict:
    return {"value": pct(numerator, denominator), "numerator": numerator, "denominator": denominator}


def _outcome(now: datetime):
    status = VisitRequest.status
    return case(
        (status_groups.group_condition("pending", now), literal("pending")),
        (status == VisitRequestStatus.CANCELLED.value, literal("cancelled")),
        (status == VisitRequestStatus.COMPLETED.value, literal("completed")),
        (status == VisitRequestStatus.NO_SHOW.value, literal("no_show")),
        (VisitRequest.slot_id.is_(None), literal("unscheduled")),
        (pending_kinds.condition("awaiting_attendance", now), literal("awaiting_attendance")),
        else_=literal("upcoming"),
    )


def _empty_counts() -> dict:
    return {
        "cases": 0,
        "web_cases": 0,
        **{outcome: 0 for outcome in OUTCOMES},
        "cancelled_by_reason": {reason: 0 for reason in CANCEL_REASON_KEYS},
    }


def _with_rates(counts: dict) -> dict:
    marked = counts["completed"] + counts["no_show"]
    return {
        **counts,
        "attendance_rate": _rate(counts["completed"], marked),
        "no_show_rate": _rate(counts["no_show"], marked),
        "cancel_rate": _rate(counts["cancelled"], counts["cases"]),
    }


def _add_into(total: dict, counts: dict) -> None:
    for key in ("cases", "web_cases", *OUTCOMES):
        total[key] += counts[key]
    for reason, value in counts["cancelled_by_reason"].items():
        total["cancelled_by_reason"][reason] += value


async def booking_outcomes(
    db: AsyncSession, campus_keys: list[str], period: FunnelRange, now: datetime | None = None
) -> dict:
    """campus_keys 由呼叫端依權限決定（照 CAMPUS_KEYS 的順序），每校一列。"""
    current = now or now_utc()

    # 先在子查詢算出每筆的結果再分組：CASE 裡的參數（時間、字串）若在 SELECT 與
    # GROUP BY 各綁一次，PostgreSQL 會當成兩個不同的式子而報錯。
    per_case = (
        select(
            VisitRequest.campus_key.label("campus_key"),
            _outcome(current).label("outcome"),
            VisitRequest.cancel_reason.label("cancel_reason"),
            (VisitRequest.source == VisitRequestSource.WEB.value).label("is_web"),
        )
        .where(VisitRequest.campus_key.in_(campus_keys), *period.on(VisitRequest.created_at))
        .subquery()
    )
    rows = (
        await db.execute(
            select(per_case.c.campus_key, per_case.c.outcome, per_case.c.cancel_reason, per_case.c.is_web, func.count())
            .group_by(per_case.c.campus_key, per_case.c.outcome, per_case.c.cancel_reason, per_case.c.is_web)
        )
    ).all()
    counts = {key: _empty_counts() for key in campus_keys}
    for campus_key, outcome, reason, is_web, count in rows:
        bucket = counts[campus_key]
        bucket["cases"] += count
        bucket[outcome] += count
        if is_web:
            bucket["web_cases"] += count
        if outcome == "cancelled":
            bucket["cancelled_by_reason"][reason if reason in CANCEL_REASONS else UNKNOWN] += count

    open_rows = (
        await db.execute(
            select(
                VisitRequest.campus_key,
                *[func.count().filter(pending_kinds.condition(kind, current)) for kind in pending_kinds.PENDING_KINDS],
            )
            .where(VisitRequest.campus_key.in_(campus_keys))
            .group_by(VisitRequest.campus_key)
        )
    ).all()
    open_now = {key: {kind: 0 for kind in pending_kinds.PENDING_KINDS} for key in campus_keys}
    for campus_key, *values in open_rows:
        open_now[campus_key] = dict(zip(pending_kinds.PENDING_KINDS, values, strict=True))

    meta_rows = (
        await db.execute(
            select(Campus.key, Campus.active, BookingConfig.mode)
            .outerjoin(BookingConfig, BookingConfig.campus_key == Campus.key)
            .where(Campus.key.in_(campus_keys))
        )
    ).all()
    meta = {key: (active, mode.value if mode is not None else None) for key, active, mode in meta_rows}

    totals = _empty_counts()
    open_totals = {kind: 0 for kind in pending_kinds.PENDING_KINDS}
    campuses = []
    for key in campus_keys:
        _add_into(totals, counts[key])
        for kind, value in open_now[key].items():
            open_totals[kind] += value
        active, mode = meta.get(key, (True, None))
        campuses.append(
            {"campus_key": key, "active": active, "booking_mode": mode, "open_now": open_now[key], **_with_rates(counts[key])}
        )
    return {
        "as_of": current,
        "date_from": period.date_from,
        "date_to": period.date_to,
        "unit": "visit_request",
        "campuses": campuses,
        "totals": _with_rates(totals),
        "open_now_totals": open_totals,
    }
```

- [ ] **Step 5: 路由、schema、區間檢查**

`backend/app/operations/routes.py`：

1. import 區加入（依現有排序擺放）：

```python
from app.admissions.schemas import AdmissionsRate
from app.auth.permissions import covers_campus  # 加進既有的 permissions import 括號
from app.campuses.models import CAMPUS_KEYS, Campus  # 既有的 Campus import 改成這行
from app.common.timezones import now_utc, today_local
from app.operations import booking_outcomes_service  # 加進既有的 `from app.operations import (...)`
```

2. 在 `FUNNEL_MAX_DAYS = 400` 之後加 `_validate_range`，並把 `get_analytics_funnel` 裡原本的兩段 `if` 換成呼叫它：

```python
def _validate_range(date_from: date | None, date_to: date | None) -> None:
    """成效統計共用的台北日期區間檢查（兩端都有才檢查）。"""
    if date_from is None or date_to is None:
        return
    if date_from > date_to:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "INVALID_DATE_RANGE", "message": "開始日期不能晚於結束日期"},
        )
    if (date_to - date_from).days + 1 > FUNNEL_MAX_DAYS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "INVALID_DATE_RANGE", "message": f"日期區間最長 {FUNNEL_MAX_DAYS} 天"},
        )
```

`get_analytics_funnel` 主體變成：

```python
    require_scope(current_user, "analytics.read", campus_keys=[campus_key])
    _validate_range(date_from, date_to)
    period = analytics_service.FunnelRange(date_from, date_to)
```

（其餘不動。）

3. 在 `get_analytics_funnel` 之後加 schema 與路由：

```python
class OutcomeCountsOut(BaseModel):
    """一批預約案件（期間內送出）現在的結果；各結果加總＝cases。單位是預約案件，
    同一個孩子預約兩校算兩筆，不依電話合併。"""

    cases: int
    # 官網表單送出的；其餘是後台補登（電話、LINE、親自到園、外部網站）。
    web_cases: int
    # 上線前的舊流程狀態（new／contacting／pending_confirmation）。
    pending: int
    # 已確認、場次還沒開始。
    upcoming: int
    # 已確認、場次已開始，還沒標記到場或未到場。
    awaiting_attendance: int
    completed: int
    no_show: int
    cancelled: int
    # 已確認卻沒有場次（舊流程資料，通常是 0）。
    unscheduled: int
    # parent／staff／hold_expired／unknown（舊案沒記原因）。
    cancelled_by_reason: dict[str, int]
    # 已到場 ÷（已到場＋未到場）；還沒標記的不算進分母。
    attendance_rate: AdmissionsRate
    no_show_rate: AdmissionsRate
    # 已取消 ÷ cases。
    cancel_rate: AdmissionsRate


class PendingNowOut(BaseModel):
    """現在的待處理三種（booking/pending_kinds.py），不受期間影響。"""

    legacy_pending: int
    awaiting_attendance: int
    follow_up_due: int


class CampusOutcomeOut(OutcomeCountsOut):
    campus_key: str
    active: bool
    # booking_configs.mode；還沒設定過為 null。
    booking_mode: str | None
    open_now: PendingNowOut


class BookingOutcomesOut(BaseModel):
    as_of: datetime
    date_from: date | None
    date_to: date | None
    unit: Literal["visit_request"]
    # 只有授權範圍內的校區，順序同 CAMPUS_KEYS。
    campuses: list[CampusOutcomeOut]
    totals: OutcomeCountsOut
    open_now_totals: PendingNowOut


@router.get("/admin/analytics/booking-outcomes", response_model=BookingOutcomesOut)
async def get_booking_outcomes(
    date_from: date | None = Query(None, alias="from", description="送出日期起（台北，含），省略＝不限"),
    date_to: date | None = Query(None, alias="to", description="送出日期迄（台北，含），省略＝不限"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    """五校並排與各校的預約結果（去識別統計）。只列授權範圍內的校區，沒有校區參數。"""
    require_scope(current_user, "analytics.read")
    _validate_range(date_from, date_to)
    campus_keys = [key for key in CAMPUS_KEYS if covers_campus(current_user, key)]
    return await booking_outcomes_service.booking_outcomes(
        db, campus_keys, analytics_service.FunnelRange(date_from, date_to)
    )
```

- [ ] **Step 6: 跑測試確認通過**

```bash
cd backend
WEBSITE_TEST_DATABASE_URL=$TDB uv run --frozen pytest -q tests/test_analytics_booking_outcomes.py tests/test_analytics_funnel.py tests/test_permission_table.py
```

Expected: 全部 passed。若 `test_no_hard_coded_role_checks_outside_permission_table` 失敗，表示新程式碼寫了角色判斷，改成 capability。

- [ ] **Step 7: Commit**

```bash
git add backend/app/operations/booking_outcomes_service.py backend/app/operations/analytics_service.py backend/app/operations/routes.py backend/tests/test_analytics_booking_outcomes.py
git commit -m "$(cat <<'EOF'
feat(analytics): 預約結果 API（同批案件的到場率、未到率、五校並排與現在待處理）

依送出日期取期間內的案件看現在的結果；到場率分母只算已標記的，待處理與總覽共用條件。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 事件每日趨勢 API，funnel 與 traffic 加 `as_of`

**Files:**
- Modify: `backend/app/operations/analytics_service.py`（import、`get_event_trend`）
- Modify: `backend/app/operations/routes.py`（`AnalyticsFunnelOut.as_of`、funnel／traffic 回 `as_of`、新路由）
- Create: `backend/tests/test_analytics_event_trend.py`

**Interfaces:**
- Consumes: `FunnelRange`、`_validate_range`（Task 2）。
- Produces: `analytics_service.TREND_MAX_DAYS = 400`；`analytics_service.get_event_trend(db, campus_key: str, period: FunnelRange, today: date) -> dict`；`GET /admin/analytics/event-trend?campus_key=&from=&to=` → `EventTrendOut = {as_of, campus_key, date_from, date_to, truncated, unit: "event", days: [{day, request_created, visit_completed, visit_cancelled, clicks}]}`；`AnalyticsFunnelOut.as_of: datetime`；traffic 回應多 `as_of`。

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_analytics_event_trend.py`：

```python
"""成效統計每日趨勢（招生分析階段 1 第 2、8 項）：事件依台北日期分天、沒事件的日子
補 0、開站至今從第一筆事件起最多 400 天、越權校區 404；funnel 與 traffic 帶更新時間。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta

import pytest

from app.common.timezones import today_local
from app.operations.models import AnalyticsEvent, AnalyticsEventType
from tests.analytics_fixtures import taipei

BASE = "/api/website/v1/admin/analytics"
ZERO = {"request_created": 0, "visit_completed": 0, "visit_cancelled": 0, "clicks": 0}


def _event(db, event_type: AnalyticsEventType, at: datetime, campus_key: str = "yihua") -> None:
    db.add(AnalyticsEvent(id=uuid.uuid4(), event_type=event_type, campus_key=campus_key, created_at=at))


async def _trend(client, query: str) -> dict:
    response = await client.get(f"{BASE}/event-trend?campus_key=yihua{query}")
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_days_are_taipei_dates_and_zero_filled(admin_client, db_session):
    _event(db_session, AnalyticsEventType.REQUEST_CREATED, taipei(date(2026, 9, 30), 23, 59))
    _event(db_session, AnalyticsEventType.REQUEST_CREATED, taipei(date(2026, 10, 1), 0, 0))
    _event(db_session, AnalyticsEventType.BOOKING_CTA_CLICKED, taipei(date(2026, 10, 1), 9))
    _event(db_session, AnalyticsEventType.CTA_CLICK_LINE, taipei(date(2026, 10, 1), 10))
    _event(db_session, AnalyticsEventType.VISIT_CONFIRMED, taipei(date(2026, 10, 1), 10))  # 不在趨勢裡
    _event(db_session, AnalyticsEventType.VISIT_CANCELLED, taipei(date(2026, 10, 3), 10))
    _event(db_session, AnalyticsEventType.REQUEST_CREATED, taipei(date(2026, 10, 1), 11), campus_key="minghua")
    await db_session.commit()

    body = await _trend(admin_client, "&from=2026-09-30&to=2026-10-03")
    assert body["unit"] == "event" and body["truncated"] is False
    assert [day["day"] for day in body["days"]] == ["2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03"]
    assert body["days"][0] == {"day": "2026-09-30", **ZERO, "request_created": 1}
    assert body["days"][1] == {"day": "2026-10-01", **ZERO, "request_created": 1, "clicks": 2}
    assert body["days"][2] == {"day": "2026-10-02", **ZERO}
    assert body["days"][3] == {"day": "2026-10-03", **ZERO, "visit_cancelled": 1}


@pytest.mark.asyncio
async def test_open_start_begins_at_first_event_and_caps_at_400_days(admin_client, db_session):
    today = today_local()
    _event(db_session, AnalyticsEventType.REQUEST_CREATED, taipei(today - timedelta(days=10)))
    await db_session.commit()
    body = await _trend(admin_client, "")
    assert body["date_from"] == (today - timedelta(days=10)).isoformat()
    assert body["date_to"] == today.isoformat()
    assert len(body["days"]) == 11

    _event(db_session, AnalyticsEventType.REQUEST_CREATED, taipei(today - timedelta(days=500)))
    await db_session.commit()
    capped = await _trend(admin_client, "")
    assert capped["truncated"] is True
    assert len(capped["days"]) == 400
    assert capped["date_from"] == (today - timedelta(days=399)).isoformat()


@pytest.mark.asyncio
async def test_no_events_gives_one_zero_day(admin_client):
    body = await _trend(admin_client, "")
    assert body["days"] == [{"day": today_local().isoformat(), **ZERO}]


@pytest.mark.asyncio
async def test_other_campus_is_hidden(minghua_client):
    response = await minghua_client.get(f"{BASE}/event-trend?campus_key=yihua")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_funnel_and_traffic_report_as_of(admin_client):
    funnel = await admin_client.get(f"{BASE}/funnel?campus_key=yihua")
    traffic = await admin_client.get(f"{BASE}/traffic?days=7")
    for response in (funnel, traffic):
        assert response.status_code == 200, response.text
        datetime.fromisoformat(response.json()["as_of"].replace("Z", "+00:00"))
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd backend; WEBSITE_TEST_DATABASE_URL=$TDB uv run --frozen pytest -q tests/test_analytics_event_trend.py`
Expected: FAIL（event-trend 404、funnel／traffic 沒有 `as_of` 的 KeyError）。

- [ ] **Step 3: 實作 `get_event_trend`**

`backend/app/operations/analytics_service.py`：

- `from datetime import date, datetime, timezone` → `from datetime import date, datetime, timedelta, timezone`
- `from sqlalchemy import Text, cast, func, select` → `from sqlalchemy import Date, Text, cast, func, select`
- `from app.common.timezones import local_day_bounds_utc` → `from app.common.timezones import OPERATING_TZ, local_day_bounds_utc`

檔尾加：

```python
# 每日趨勢最多畫幾天（和漏斗的自訂區間上限相同）。
TREND_MAX_DAYS = 400


async def get_event_trend(db: AsyncSession, campus_key: str, period: FunnelRange, today: date) -> dict:
    """每日事件數（台北日期），沒有事件的日子也列。沒給開始日時從這校第一筆事件那天起；
    超過 TREND_MAX_DAYS 天時只回最近的（truncated）。確認事件不列：2026-10-01 起它和
    送出需求同時發生，畫出來只是同一條線。"""
    date_to = period.date_to or today
    date_from = period.date_from
    if date_from is None:
        first = await db.scalar(select(func.min(AnalyticsEvent.created_at)).where(AnalyticsEvent.campus_key == campus_key))
        date_from = min(first.astimezone(OPERATING_TZ).date(), date_to) if first is not None else date_to
    truncated = (date_to - date_from).days + 1 > TREND_MAX_DAYS
    if truncated:
        date_from = date_to - timedelta(days=TREND_MAX_DAYS - 1)

    # 先在子查詢換成台北日期再分組：時區字串若在 SELECT 與 GROUP BY 各綁一次，
    # PostgreSQL 會當成兩個不同的式子。
    per_event = (
        select(
            cast(func.timezone(OPERATING_TZ.key, AnalyticsEvent.created_at), Date).label("day"),
            AnalyticsEvent.event_type.label("event_type"),
        )
        .where(AnalyticsEvent.campus_key == campus_key, *FunnelRange(date_from, date_to).conditions())
        .subquery()
    )
    rows = (
        await db.execute(
            select(per_event.c.day, per_event.c.event_type, func.count()).group_by(per_event.c.day, per_event.c.event_type)
        )
    ).all()
    days = {
        date_from + timedelta(days=offset): {"request_created": 0, "visit_completed": 0, "visit_cancelled": 0, "clicks": 0}
        for offset in range((date_to - date_from).days + 1)
    }
    for day, event_type, count in rows:
        bucket = days.get(day)
        if bucket is None:
            continue
        if event_type in PUBLIC_REPORTABLE_EVENT_TYPES:
            bucket["clicks"] += count
        elif event_type.value in bucket:
            bucket[event_type.value] += count
    return {
        "campus_key": campus_key,
        "date_from": date_from,
        "date_to": date_to,
        "truncated": truncated,
        "days": [{"day": day, **values} for day, values in sorted(days.items())],
    }
```

- [ ] **Step 4: 路由與 `as_of`**

`backend/app/operations/routes.py`：

1. `get_traffic` 的 `return` 改成：

```python
    # 全站匿名彙總（沒有個資、也不分權限範圍），登入的後台帳號都能看。
    summary = await traffic_service.get_traffic_summary(db, days)
    summary["as_of"] = now_utc()
    return summary
```

2. `AnalyticsFunnelOut` 第一個欄位前加：

```python
    # 伺服器產生這份統計的時間（畫面寫「更新」）。
    as_of: datetime
```

`get_analytics_funnel` 的 `return funnel` 前加 `funnel["as_of"] = now_utc()`。

3. 在 `get_booking_outcomes` 之後加：

```python
class EventTrendDayOut(BaseModel):
    day: date
    request_created: int
    visit_completed: int
    visit_cancelled: int
    # 四種預約鈕點擊的合計（表單、LINE、電話、外部網站）。
    clicks: int


class EventTrendOut(BaseModel):
    as_of: datetime
    campus_key: str
    # 實際畫出的區間（沒給開始日＝從這校第一筆事件那天起）。
    date_from: date
    date_to: date
    # 超過 400 天時只回最近 400 天。
    truncated: bool
    unit: Literal["event"]
    # 每天一列，沒有事件的日子也列（全是 0）。
    days: list[EventTrendDayOut]


@router.get("/admin/analytics/event-trend", response_model=EventTrendOut)
async def get_event_trend(
    campus_key: str,
    date_from: date | None = Query(None, alias="from", description="台北日期（含），省略＝從第一筆事件"),
    date_to: date | None = Query(None, alias="to", description="台北日期（含），省略＝今天"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    require_scope(current_user, "analytics.read", campus_keys=[campus_key])
    _validate_range(date_from, date_to)
    trend = await analytics_service.get_event_trend(
        db, campus_key, analytics_service.FunnelRange(date_from, date_to), today_local()
    )
    return {**trend, "as_of": now_utc(), "unit": "event"}
```

- [ ] **Step 5: 跑測試確認通過**

```bash
cd backend
WEBSITE_TEST_DATABASE_URL=$TDB uv run --frozen pytest -q tests/test_analytics_event_trend.py tests/test_analytics_funnel.py tests/test_traffic.py
```

Expected: 全部 passed。

- [ ] **Step 6: Commit**

```bash
git add backend/app/operations/analytics_service.py backend/app/operations/routes.py backend/tests/test_analytics_event_trend.py
git commit -m "$(cat <<'EOF'
feat(analytics): 事件每日趨勢 API，漏斗與流量統計帶更新時間

依台北日期分天、沒有事件的日子補 0，開站至今從第一筆事件起、最多 400 天。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: 預約孩子的班別分布 API

**Files:**
- Modify: `backend/app/operations/booking_outcomes_service.py`（加 `class_distribution`）
- Modify: `backend/app/operations/routes.py`（schema、路由）
- Create: `backend/tests/test_analytics_class_distribution.py`

**Interfaces:**
- Consumes: `admissions.academic.grade_for_birthday`、`admissions.constants.GRADES`、`SCHOOL_YEAR_MIN/MAX`；`FunnelRange.on`、`_validate_range`。
- Produces: `booking_outcomes_service.class_distribution(db, campus_key: str, period: FunnelRange, school_year: int, now: datetime | None = None) -> dict`；`GET /admin/analytics/class-distribution?campus_key=&school_year=&from=&to=` → `ClassDistributionOut = {as_of, campus_key, date_from, date_to, school_year, unit: "visit_request", total, grades: [{grade, count}]（固定 幼幼班、小班、中班、大班 四列）, out_of_range, unrecorded}`。

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_analytics_class_distribution.py`：

```python
"""預約孩子的班別（招生分析階段 1 第 3 項，E05、E06）：用招生入學同一個換算
（admissions/academic.grade_for_birthday）與共用案例；缺生日、已匿名化算「沒有生日
資料」，範圍外另列，不猜班別。"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest

from tests.analytics_fixtures import add_case, taipei

URL = "/api/website/v1/admin/analytics/class-distribution"
CASES = json.loads(
    (Path(__file__).resolve().parents[2] / "contracts" / "ivy-recruitment" / "grade-cases.json").read_text(encoding="utf-8")
)["cases"]


async def _get(client, query: str) -> dict:
    response = await client.get(f"{URL}?{query}")
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
async def test_shared_grade_cases(admin_client, db_session, case):
    await add_case(db_session, child_birthdate=date.fromisoformat(case["birthday"]))
    await db_session.commit()
    body = await _get(admin_client, f"campus_key=yihua&school_year={case['expected_term'][0]}")
    grades = {row["grade"]: row["count"] for row in body["grades"]}
    if case["expected_grade"] is None:
        assert body["out_of_range"] == 1
        assert sum(grades.values()) == 0
    else:
        assert grades[case["expected_grade"]] == 1
        assert body["out_of_range"] == 0
    assert body["total"] == 1 and body["unrecorded"] == 0


@pytest.mark.asyncio
async def test_missing_or_anonymized_birthdays_are_unrecorded(admin_client, db_session):
    await add_case(db_session, child_birthdate=None)
    await add_case(db_session, child_birthdate=None, anonymized=True)  # 匿名化會清掉生日
    await add_case(db_session, child_birthdate=date(2023, 9, 1), status="cancelled", cancel_reason="parent")
    await db_session.commit()
    body = await _get(admin_client, "campus_key=yihua&school_year=115")
    assert [row["grade"] for row in body["grades"]] == ["幼幼班", "小班", "中班", "大班"]
    assert body["unrecorded"] == 2
    assert {row["grade"]: row["count"] for row in body["grades"]}["小班"] == 1  # 已取消也算
    assert body["total"] == 3
    assert body["unit"] == "visit_request" and body["school_year"] == 115


@pytest.mark.asyncio
async def test_period_scope_and_school_year_bounds(admin_client, minghua_client, db_session):
    await add_case(db_session, child_birthdate=date(2023, 9, 1), created_at=taipei(date(2026, 9, 1)))
    await add_case(db_session, child_birthdate=date(2023, 9, 1), created_at=taipei(date(2026, 10, 1)))
    await db_session.commit()
    body = await _get(admin_client, "campus_key=yihua&school_year=115&from=2026-10-01&to=2026-10-31")
    assert body["total"] == 1
    assert (await minghua_client.get(f"{URL}?campus_key=yihua&school_year=115")).status_code == 404
    assert (await admin_client.get(f"{URL}?campus_key=yihua&school_year=99")).status_code == 422
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd backend; WEBSITE_TEST_DATABASE_URL=$TDB uv run --frozen pytest -q tests/test_analytics_class_distribution.py`
Expected: FAIL（404）。

- [ ] **Step 3: 實作 service**

`backend/app/operations/booking_outcomes_service.py`：import 區加

```python
from app.admissions import academic
from app.admissions.constants import GRADES
```

檔尾加：

```python
async def class_distribution(
    db: AsyncSession, campus_key: str, period: FunnelRange, school_year: int, now: datetime | None = None
) -> dict:
    """期間內送出的案件（含已取消），孩子生日換算成 school_year 學年度的班別。換算同
    招生入學（academic.grade_for_birthday，共用案例 contracts/ivy-recruitment/grade-cases.json）；
    這是年齡對照，不是報名或入學結果。沒有生日（舊案只有年齡文字、補登沒問、已匿名化）
    算 unrecorded；有生日但不在幼幼班～大班算 out_of_range。依生日分組在 SQL，換算在 Python。"""
    rows = (
        await db.execute(
            select(VisitRequest.child_birthdate, func.count())
            .where(VisitRequest.campus_key == campus_key, *period.on(VisitRequest.created_at))
            .group_by(VisitRequest.child_birthdate)
        )
    ).all()
    grades = {grade: 0 for grade in GRADES}
    out_of_range = 0
    unrecorded = 0
    for birthday, count in rows:
        if birthday is None:
            unrecorded += count
            continue
        grade = academic.grade_for_birthday(birthday, school_year)
        if grade is None:
            out_of_range += count
        else:
            grades[grade] += count
    return {
        "as_of": now or now_utc(),
        "campus_key": campus_key,
        "date_from": period.date_from,
        "date_to": period.date_to,
        "school_year": school_year,
        "unit": "visit_request",
        "total": unrecorded + out_of_range + sum(grades.values()),
        "grades": [{"grade": grade, "count": count} for grade, count in grades.items()],
        "out_of_range": out_of_range,
        "unrecorded": unrecorded,
    }
```

- [ ] **Step 4: 路由與 schema**

`backend/app/operations/routes.py`：import 加 `from app.admissions.constants import SCHOOL_YEAR_MAX, SCHOOL_YEAR_MIN`；在 `get_event_trend` 之後加：

```python
class GradeCountOut(BaseModel):
    grade: str
    count: int


class ClassDistributionOut(BaseModel):
    as_of: datetime
    campus_key: str
    date_from: date | None
    date_to: date | None
    school_year: int
    unit: Literal["visit_request"]
    total: int
    # 幼幼班～大班固定四列（0 也列）。
    grades: list[GradeCountOut]
    # 有生日但不在幼幼班～大班。
    out_of_range: int
    # 沒有生日：舊案只有年齡文字、補登沒問，或已匿名化。
    unrecorded: int


@router.get("/admin/analytics/class-distribution", response_model=ClassDistributionOut)
async def get_class_distribution(
    campus_key: str,
    school_year: int = Query(ge=SCHOOL_YEAR_MIN, le=SCHOOL_YEAR_MAX, description="換算用的民國學年度"),
    date_from: date | None = Query(None, alias="from", description="送出日期起（台北，含）"),
    date_to: date | None = Query(None, alias="to", description="送出日期迄（台北，含）"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> dict:
    require_scope(current_user, "analytics.read", campus_keys=[campus_key])
    _validate_range(date_from, date_to)
    return await booking_outcomes_service.class_distribution(
        db, campus_key, analytics_service.FunnelRange(date_from, date_to), school_year
    )
```

- [ ] **Step 5: 跑測試確認通過**

```bash
cd backend
WEBSITE_TEST_DATABASE_URL=$TDB uv run --frozen pytest -q tests/test_analytics_class_distribution.py tests/test_admissions_academic.py
```

Expected: 全部 passed。

- [ ] **Step 6: Commit**

```bash
git add backend/app/operations/booking_outcomes_service.py backend/app/operations/routes.py backend/tests/test_analytics_class_distribution.py
git commit -m "$(cat <<'EOF'
feat(analytics): 預約孩子依生日換算班別的分布 API

沿用招生入學的 grade_for_birthday 與共用案例；缺生日與範圍外另列，不猜班別。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: 契約與後台 API 模組

**Files:**
- Regenerate: `contracts/openapi.json`、`contracts/generated/website-api.d.ts`
- Modify: `admin/src/api/types.ts`（第 390 行 `AnalyticsFunnelOut` 附近）
- Create: `admin/src/api/analytics.ts`
- Modify: `admin/src/api/traffic.ts`（`TrafficSummary`、常數）
- Modify: `admin/src/views/AnalyticsView.vue:131`（`SELF_BOOKING_SINCE` 改 import）
- Modify: `admin/src/__tests__/analyticsFunnel.test.ts`（`funnel` 加 `as_of`）、`admin/src/__tests__/traffic.test.ts`（`traffic()` 加 `as_of`）
- Create: `admin/src/__tests__/analyticsHelpers.test.ts`

**Interfaces:**
- Produces（前端各 Task 依賴）：
  - `types.ts`：`BookingOutcomesOut`、`CampusOutcomeOut`、`OutcomeCountsOut`、`PendingNowOut`、`EventTrendOut`、`EventTrendDayOut`、`ClassDistributionOut`、`GradeCountOut`。
  - `analytics.ts`：`interface DateRange { from: string; to: string }`；`SELF_BOOKING_SINCE = '2026-10-01'`；`SMALL_SAMPLE = 20`；`getBookingOutcomes(range: DateRange | null): Promise<BookingOutcomesOut>`；`getEventTrend(campusKey: string, range: DateRange | null): Promise<EventTrendOut>`；`getClassDistribution(campusKey: string, schoolYear: number, range: DateRange | null): Promise<ClassDistributionOut>`；`rateText(rate: AdmissionsRate): string`；`isSmallSample(rate: AdmissionsRate): boolean`；`type PendingKind = 'legacy_pending' | 'awaiting_attendance' | 'follow_up_due'`；`PENDING_KINDS: readonly PendingKind[]`（顯示順序：待標記到場 → 到期追蹤 → 舊資料）；`PENDING_KIND_LABELS: Record<PendingKind, string>`；`pendingLink(kind: PendingKind, campusKey: string): string`；`rangeKey(range: DateRange | null): string`。
  - `traffic.ts`：`TrafficSummary.as_of: string`；`TRAFFIC_COVERAGE_EXPANDED_ON = '2026-09-30'`。

- [ ] **Step 1: 產生契約**

```bash
cd ~/Desktop/ivy-website-analytics-20261003
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm run contract:generate
git diff --stat contracts/
grep -c "BookingOutcomesOut\|EventTrendOut\|ClassDistributionOut" contracts/generated/website-api.d.ts
```

Expected: `contracts/openapi.json` 與 `website-api.d.ts` 有差異；grep 計數 > 0；`AnalyticsFunnelOut` 多了 `as_of`。

- [ ] **Step 2: 型別別名**

`admin/src/api/types.ts` 在 `export type AnalyticsFunnelOut = ...` 那行之後加：

```ts
export type BookingOutcomesOut = components['schemas']['BookingOutcomesOut']
export type CampusOutcomeOut = components['schemas']['CampusOutcomeOut']
export type OutcomeCountsOut = components['schemas']['OutcomeCountsOut']
export type PendingNowOut = components['schemas']['PendingNowOut']
export type EventTrendOut = components['schemas']['EventTrendOut']
export type EventTrendDayOut = components['schemas']['EventTrendDayOut']
export type ClassDistributionOut = components['schemas']['ClassDistributionOut']
export type GradeCountOut = components['schemas']['GradeCountOut']
```

- [ ] **Step 3: 寫失敗的測試**

`admin/src/__tests__/analyticsHelpers.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import {
  PENDING_KINDS, SMALL_SAMPLE, getBookingOutcomes, getClassDistribution, getEventTrend, isSmallSample, pendingLink, rangeKey, rateText,
} from '../api/analytics'

afterEach(() => vi.restoreAllMocks())

describe('成效統計的比率、樣本與連結', () => {
  it('比率附分子分母；分母 0 寫「—」不寫 0%', () => {
    expect(rateText({ value: 66.7, numerator: 2, denominator: 3 })).toBe('66.7%（2/3）')
    expect(rateText({ value: 25, numerator: 2, denominator: 8 })).toBe('25.0%（2/8）')
    expect(rateText({ value: null, numerator: 0, denominator: 0 })).toBe('—')
  })

  it('分母 1–19 提示樣本較少；0 與 20 以上不提示', () => {
    expect(isSmallSample({ value: 50, numerator: 1, denominator: 2 })).toBe(true)
    expect(isSmallSample({ value: 50, numerator: 9, denominator: SMALL_SAMPLE - 1 })).toBe(true)
    expect(isSmallSample({ value: 50, numerator: 10, denominator: SMALL_SAMPLE })).toBe(false)
    expect(isSmallSample({ value: null, numerator: 0, denominator: 0 })).toBe(false)
  })

  it('待處理三種連到案件列表，參數和總覽一樣；順序是待標記到場、到期追蹤、舊資料', () => {
    expect(PENDING_KINDS).toEqual(['awaiting_attendance', 'follow_up_due', 'legacy_pending'])
    expect(pendingLink('awaiting_attendance', 'yihua')).toBe('/visit-requests?campus=yihua&group=past&status=confirmed')
    expect(pendingLink('follow_up_due', 'yihua')).toBe('/visit-requests?campus=yihua&due=1')
    expect(pendingLink('legacy_pending', 'minghua')).toBe('/visit-requests?campus=minghua&group=pending')
  })

  it('rangeKey 把同一段期間算成同一個鍵，開站至今是 all', () => {
    expect(rangeKey(null)).toBe('all')
    expect(rangeKey({ from: '2026-09-01', to: '2026-09-30' })).toBe('2026-09-01~2026-09-30')
  })

  it('API 路徑帶校區、學年與期間；開站至今不帶期間', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({} as never)
    const range = { from: '2026-09-01', to: '2026-09-30' }
    await getBookingOutcomes(null)
    await getBookingOutcomes(range)
    await getEventTrend('yihua', range)
    await getClassDistribution('yihua', 115, null)
    expect(get.mock.calls.map((call) => call[0])).toEqual([
      '/admin/analytics/booking-outcomes',
      '/admin/analytics/booking-outcomes?from=2026-09-01&to=2026-09-30',
      '/admin/analytics/event-trend?campus_key=yihua&from=2026-09-01&to=2026-09-30',
      '/admin/analytics/class-distribution?campus_key=yihua&school_year=115',
    ])
  })
})
```

- [ ] **Step 4: 跑測試確認失敗**

Run: `source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/analyticsHelpers.test.ts`
Expected: FAIL，`Failed to resolve import "../api/analytics"`。

- [ ] **Step 5: 實作 `analytics.ts`**

```ts
// 成效統計補強（2026-09-30 招生分析報告階段 1）的 API 與顯示規則。
// 後端：backend/app/operations/booking_outcomes_service.py、analytics_service.get_event_trend。
import { api } from './client'
import type { AdmissionsRate, BookingOutcomesOut, ClassDistributionOut, EventTrendOut } from './types'
import { NO_VALUE, formatRate } from '../admissions/statsFormat'

export interface DateRange {
  from: string
  to: string
}

// 2026-10-01 起家長自選場次：官網送出即預約成功，同時記「已送出需求」與「已確認預約」。
export const SELF_BOOKING_SINCE = '2026-10-01'
// 分母少於這個數時提示「樣本較少」（報告 3.3：只是介面提示門檻，不代表統計顯著）。
export const SMALL_SAMPLE = 20

/** 期間的比較鍵：父層每次重算 range 物件，用字串判斷是不是真的換了期間。 */
export function rangeKey(range: DateRange | null): string {
  return range ? `${range.from}~${range.to}` : 'all'
}

function withQuery(path: string, params: Record<string, string>, range: DateRange | null): string {
  const query = new URLSearchParams(params)
  if (range) {
    query.set('from', range.from)
    query.set('to', range.to)
  }
  const text = query.toString()
  return text ? `${path}?${text}` : path
}

export function getBookingOutcomes(range: DateRange | null): Promise<BookingOutcomesOut> {
  return api.get<BookingOutcomesOut>(withQuery('/admin/analytics/booking-outcomes', {}, range))
}

export function getEventTrend(campusKey: string, range: DateRange | null): Promise<EventTrendOut> {
  return api.get<EventTrendOut>(withQuery('/admin/analytics/event-trend', { campus_key: campusKey }, range))
}

export function getClassDistribution(campusKey: string, schoolYear: number, range: DateRange | null): Promise<ClassDistributionOut> {
  return api.get<ClassDistributionOut>(
    withQuery('/admin/analytics/class-distribution', { campus_key: campusKey, school_year: String(schoolYear) }, range),
  )
}

/** 「66.7%（2/3）」；分母 0 寫「—」（報告 3.3「—／無可計算資料」）。格式同招生入學統計。 */
export function rateText(rate: AdmissionsRate): string {
  return rate.denominator ? `${formatRate(rate.value)}（${rate.numerator}/${rate.denominator}）` : NO_VALUE
}

export function isSmallSample(rate: AdmissionsRate): boolean {
  return rate.denominator > 0 && rate.denominator < SMALL_SAMPLE
}

// 待處理三種（backend/app/booking/pending_kinds.py）。順序同總覽「下一筆」：待標記到場 → 到期追蹤 → 舊資料。
export type PendingKind = 'legacy_pending' | 'awaiting_attendance' | 'follow_up_due'
export const PENDING_KINDS: readonly PendingKind[] = ['awaiting_attendance', 'follow_up_due', 'legacy_pending']
export const PENDING_KIND_LABELS: Record<PendingKind, string> = {
  awaiting_attendance: '參觀時間過了，還沒標記到場',
  follow_up_due: '到期待追蹤',
  legacy_pending: '舊資料的待處理',
}

/** 點進案件列表、已套好篩選；參數和總覽（DashboardView）同一組，列表會保留子篩選。 */
export function pendingLink(kind: PendingKind, campusKey: string): string {
  const query = new URLSearchParams({ campus: campusKey })
  if (kind === 'awaiting_attendance') {
    query.set('group', 'past')
    query.set('status', 'confirmed')
  } else if (kind === 'follow_up_due') {
    query.set('due', '1')
  } else {
    query.set('group', 'pending')
  }
  return `/visit-requests?${query}`
}
```

- [ ] **Step 6: traffic.ts、AnalyticsView、既有 fixture**

`admin/src/api/traffic.ts`：`TrafficSummary` 加一行 `as_of: string`（放在 `vitals` 之後），檔尾加：

```ts
// 2026-09-30 下午起內頁（關於、特色教學、環境、入學、消息）也回報瀏覽，前後的瀏覽次數不能直接比。
export const TRAFFIC_COVERAGE_EXPANDED_ON = '2026-09-30'
```

`admin/src/views/AnalyticsView.vue`：刪掉第 131 行 `const SELF_BOOKING_SINCE = '2026-10-01'`（保留上方註解），在 import 區加 `import { SELF_BOOKING_SINCE } from '../api/analytics'`。

`admin/src/__tests__/analyticsFunnel.test.ts` 的 `const funnel: AnalyticsFunnelOut = {` 內加 `as_of: '2026-10-03T06:05:00Z',`；`admin/src/__tests__/traffic.test.ts` 的 `traffic()` 回傳物件加 `as_of: '2026-10-03T06:05:00Z',`。

- [ ] **Step 7: 跑測試與型別檢查**

```bash
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1
npm --prefix admin run test:unit -- src/__tests__/analyticsHelpers.test.ts src/__tests__/analyticsFunnel.test.ts src/__tests__/traffic.test.ts
npm --prefix admin run typecheck
npm run contract:check
```

Expected: 測試全過；typecheck 0 錯誤；`contract:check` 結束碼 0。

- [ ] **Step 8: Commit**

```bash
git add contracts/openapi.json contracts/generated/website-api.d.ts admin/src/api/types.ts admin/src/api/analytics.ts admin/src/api/traffic.ts admin/src/views/AnalyticsView.vue admin/src/__tests__/analyticsHelpers.test.ts admin/src/__tests__/analyticsFunnel.test.ts admin/src/__tests__/traffic.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): 成效統計新 API 的契約、型別與顯示規則

比率附分子分母、分母 0 寫「—」、樣本少於 20 提示；待處理連結和總覽同一組參數。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 共用元件：圖表說明列與每日直條

**Files:**
- Create: `admin/src/components/analytics/AnalyticsMeta.vue`
- Create: `admin/src/components/analytics/DailyBars.vue`
- Create: `admin/src/__tests__/analyticsCharts.test.ts`

**Interfaces:**
- Produces: `<AnalyticsMeta :period="string" :unit="string" :as-of="string | null" :coverage="string" />`（後兩個選填）；`<DailyBars :title="string" :points="DailyPoint[]" :unit="string" :markers="DailyMarker[]" />`，`DailyPoint = { day: string; value: number }`、`DailyMarker = { day: string; label: string }`（由 `DailyBars.vue` 匯出型別）；DOM class：`.daily-bars__col`（每天一個，標記日加 `is-marked`）、`.daily-bars__fill`（`style.height` 為百分比）、`.daily-bars__marker`、`.analytics-meta`。

- [ ] **Step 1: 寫失敗的測試**

`admin/src/__tests__/analyticsCharts.test.ts`：

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import AnalyticsMeta from '../components/analytics/AnalyticsMeta.vue'
import DailyBars from '../components/analytics/DailyBars.vue'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach((wrapper) => wrapper.unmount()); wrappers.length = 0 })

function mountBars(props: Record<string, unknown>) {
  const wrapper = mount(DailyBars, { props: { title: '每日瀏覽', unit: '次', points: [], ...props }, global: { plugins: [ElementPlus] } })
  wrappers.push(wrapper)
  return wrapper
}

describe('每日直條', () => {
  const points = [{ day: '2026-09-28', value: 2 }, { day: '2026-09-29', value: 0 }, { day: '2026-09-30', value: 4 }]

  it('每天一根，高度以最多的那天為 100%；數字寫在每日數字表（新到舊）', () => {
    const wrapper = mountBars({ points })
    const fills = wrapper.findAll('.daily-bars__fill').map((fill) => fill.attributes('style'))
    expect(fills).toEqual(['height: 50%;', 'height: 0%;', 'height: 100%;'])
    const rows = wrapper.findAll('.daily-bars__table tbody tr').map((row) => row.text())
    expect(rows[0]).toContain('09/30')
    expect(rows[0]).toContain('4')
    expect(rows).toHaveLength(3)
  })

  it('讀屏摘要寫期間、合計與最多的那天', () => {
    const label = mountBars({ points }).find('.daily-bars__plot').attributes('aria-label')
    expect(label).toBe('每日瀏覽：09/28–09/30 共 6 次，最多是 09/30 的 4 次')
  })

  it('只畫期間內的口徑標記', () => {
    const wrapper = mountBars({
      points,
      markers: [{ day: '2026-09-30', label: '內頁也開始計入' }, { day: '2026-10-05', label: '不在期間內' }],
    })
    expect(wrapper.findAll('.daily-bars__col')[2]!.classes()).toContain('is-marked')
    expect(wrapper.text()).toContain('09/30 起：內頁也開始計入')
    expect(wrapper.text()).not.toContain('不在期間內')
  })

  it('沒有資料時寫出來，不畫空圖', () => {
    const wrapper = mountBars({ points: [] })
    expect(wrapper.text()).toContain('這段期間沒有資料。')
    expect(wrapper.find('.daily-bars__plot').exists()).toBe(false)
  })
})

describe('圖表說明列', () => {
  it('寫期間、單位、更新時間與涵蓋範圍', () => {
    const wrapper = mount(AnalyticsMeta, {
      props: { period: '2026/09/01–2026/09/30', unit: '預約案件數', asOf: '2026-10-03T06:05:00Z', coverage: '只算授權校區' },
    })
    wrappers.push(wrapper)
    const text = wrapper.text()
    expect(text).toContain('期間 2026/09/01–2026/09/30')
    expect(text).toContain('單位：預約案件數')
    expect(text).toContain('10/03 14:05')
    expect(text).toContain('只算授權校區')
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm --prefix admin run test:unit -- src/__tests__/analyticsCharts.test.ts`（先 source nvm）
Expected: FAIL，元件檔不存在。

- [ ] **Step 3: 實作 `AnalyticsMeta.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { formatShortDateTime } from '../../api/labels'

// 每張圖表都寫期間、計數單位、更新時間與涵蓋範圍（招生分析報告第 4 節第 8 項）。
const props = defineProps<{ period: string; unit: string; asOf?: string | null; coverage?: string }>()

const parts = computed(() =>
  [`期間 ${props.period}`, `單位：${props.unit}`, props.asOf ? `更新 ${formatShortDateTime(props.asOf)}` : '', props.coverage ?? '']
    .filter(Boolean),
)
</script>

<template>
  <p class="analytics-meta"><span v-for="part in parts" :key="part">{{ part }}</span></p>
</template>

<style scoped>
.analytics-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 2px 12px;
  margin: 0;
  font-size: 12px;
  color: var(--ink-3);
}
</style>
```

- [ ] **Step 4: 實作 `DailyBars.vue`**

```vue
<script setup lang="ts">
import { computed, useId } from 'vue'

// 每日直條（DESIGN.md 招生入學統計：表格＋CSS 長條、不裝圖表套件，數字一定寫出來）。
// 直條只用來看起伏，每天的數字在下方「每日數字」。markers 是口徑改變的日子
// （例如 09/30 內頁開始計入），只畫期間內的。
export interface DailyPoint { day: string; value: number }
export interface DailyMarker { day: string; label: string }

const props = withDefaults(
  defineProps<{ title: string; points: readonly DailyPoint[]; unit: string; markers?: readonly DailyMarker[] }>(),
  { markers: () => [] },
)

const titleId = useId()
const short = (day: string) => day.slice(5).replace('-', '/')
const max = computed(() => Math.max(0, ...props.points.map((point) => point.value)))
const total = computed(() => props.points.reduce((sum, point) => sum + point.value, 0))
const first = computed(() => props.points[0]?.day ?? '')
const last = computed(() => props.points.at(-1)?.day ?? '')
const peak = computed(() =>
  props.points.reduce<DailyPoint | null>((best, point) => (!best || point.value > best.value ? point : best), null),
)
const visibleMarkers = computed(() => props.markers.filter((marker) => marker.day >= first.value && marker.day <= last.value))
const markedDays = computed(() => new Set(visibleMarkers.value.map((marker) => marker.day)))
const height = (value: number) => (max.value ? `${Math.round((value / max.value) * 100)}%` : '0%')
const summary = computed(() =>
  peak.value
    ? `${props.title}：${short(first.value)}–${short(last.value)} 共 ${total.value} ${props.unit}，最多是 ${short(peak.value.day)} 的 ${peak.value.value} ${props.unit}`
    : `${props.title}：沒有資料`,
)
const newestFirst = computed(() => [...props.points].reverse())
</script>

<template>
  <figure class="daily-bars" :aria-labelledby="titleId">
    <figcaption :id="titleId" class="daily-bars__title">{{ title }}</figcaption>
    <p v-if="!points.length" class="hint">這段期間沒有資料。</p>
    <template v-else>
      <div class="daily-bars__plot" role="img" :aria-label="summary">
        <span
          v-for="point in points"
          :key="point.day"
          class="daily-bars__col"
          :class="{ 'is-marked': markedDays.has(point.day) }"
          :title="`${short(point.day)}：${point.value} ${unit}`"
        >
          <span class="daily-bars__fill" :style="{ height: height(point.value) }" />
        </span>
      </div>
      <div class="daily-bars__axis hint num">
        <span>{{ short(first) }}</span><span>最多 {{ max }} {{ unit }}</span><span>{{ short(last) }}</span>
      </div>
      <p v-for="marker in visibleMarkers" :key="marker.day" class="hint daily-bars__marker">{{ short(marker.day) }} 起：{{ marker.label }}</p>
      <details class="daily-bars__table">
        <summary>每日數字</summary>
        <table>
          <thead><tr><th scope="col">日期</th><th scope="col">{{ unit }}</th></tr></thead>
          <tbody>
            <tr v-for="point in newestFirst" :key="point.day"><th scope="row" class="num">{{ short(point.day) }}</th><td class="num">{{ point.value }}</td></tr>
          </tbody>
        </table>
      </details>
    </template>
  </figure>
</template>

<style scoped>
.daily-bars {
  min-width: 0;
  margin: 0;
}

.daily-bars__title {
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 500;
}

.daily-bars__plot {
  display: flex;
  align-items: flex-end;
  gap: 1px;
  height: 96px;
  border-bottom: 1px solid var(--line);
}

.daily-bars__col {
  display: flex;
  flex: 1 1 0;
  align-items: flex-end;
  min-width: 0;
  height: 100%;
}

/* 口徑改變的那天：左緣一條警示色細線。 */
.daily-bars__col.is-marked {
  box-shadow: inset 2px 0 0 var(--el-color-warning);
}

.daily-bars__fill {
  display: block;
  width: 100%;
  border-radius: 2px 2px 0 0;
  background: var(--el-color-primary);
}

.daily-bars__axis {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
}

.daily-bars__marker {
  margin: 4px 0 0;
}

.daily-bars__table {
  margin-top: 8px;
  font-size: 13px;
}

.daily-bars__table table {
  width: 100%;
  max-width: 320px;
  border-collapse: collapse;
}

.daily-bars__table th,
.daily-bars__table td {
  padding: 4px 8px;
  border-bottom: 1px solid var(--line);
  font-weight: 400;
  text-align: left;
}

.daily-bars__table td {
  text-align: right;
}
</style>
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npm --prefix admin run test:unit -- src/__tests__/analyticsCharts.test.ts`
Expected: PASS（6 項）。若 `style` 斷言因 jsdom 序列化不同而失敗，改成 `expect(fill.element.style.height).toBe('50%')`，不要改實作。

- [ ] **Step 6: Commit**

```bash
git add admin/src/components/analytics/AnalyticsMeta.vue admin/src/components/analytics/DailyBars.vue admin/src/__tests__/analyticsCharts.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): 成效統計的每日直條與圖表說明列元件

CSS 直條＋每日數字表，口徑改變的日子畫細線並寫說明；每張圖寫期間、單位與更新時間。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 官網瀏覽的每日趨勢與 09/30 標記

**Files:**
- Modify: `admin/src/components/SiteTrafficPanel.vue`（import、`dailyPoints`、模板第 86–101 行之間）
- Modify: `admin/src/__tests__/traffic.test.ts`（新 describe）

**Interfaces:**
- Consumes: `DailyBars`、`AnalyticsMeta`（Task 6）；`TRAFFIC_COVERAGE_EXPANDED_ON`、`TrafficSummary.as_of`（Task 5）。

- [ ] **Step 1: 寫失敗的測試**

`admin/src/__tests__/traffic.test.ts` 檔尾加：

```ts
describe('每日瀏覽趨勢', () => {
  async function mountWith(daily: TrafficSummary['daily']) {
    vi.spyOn(api, 'get').mockResolvedValue({ ...traffic(), daily } as never)
    const wrapper = mount(SiteTrafficPanel, { global: { plugins: [ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    return wrapper
  }

  it('每天一根直條；期間包含 09/30 時標出內頁開始計入', async () => {
    const wrapper = await mountWith([
      { day: '2026-09-29', views: 3 }, { day: '2026-09-30', views: 5 }, { day: '2026-10-01', views: 1 },
    ])
    expect(wrapper.findAll('.daily-bars__col')).toHaveLength(3)
    expect(wrapper.text()).toContain('09/30 起：')
    expect(wrapper.text()).toContain('單位：瀏覽次數')
    expect(wrapper.text()).toContain('10/03 14:05')
  })

  it('期間不含 09/30 時不畫標記', async () => {
    const wrapper = await mountWith([{ day: '2026-10-02', views: 3 }, { day: '2026-10-03', views: 4 }])
    expect(wrapper.text()).not.toContain('09/30 起：')
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm --prefix admin run test:unit -- src/__tests__/traffic.test.ts`
Expected: FAIL（找不到 `.daily-bars__col`）。

- [ ] **Step 3: 實作**

`SiteTrafficPanel.vue` script：import 加

```ts
import { TRAFFIC_COVERAGE_EXPANDED_ON } from '../api/traffic'  // 併進既有的 '../api/traffic' import
import AnalyticsMeta from './analytics/AnalyticsMeta.vue'
import DailyBars from './analytics/DailyBars.vue'
```

在 `const today = computed(...)` 之後加：

```ts
const dailyPoints = computed(() => (summary.value?.daily ?? []).map((item) => ({ day: item.day, value: item.views })))
const TRAFFIC_MARKERS = [{ day: TRAFFIC_COVERAGE_EXPANDED_ON, label: '內頁也開始計入瀏覽，這天前後的次數不能直接比較' }]
const rangeText = computed(() => (summary.value ? `${summary.value.since.replaceAll('-', '/')}–${summary.value.until.replaceAll('-', '/')}` : ''))
```

模板：在 `</div>`（`stat-list` 結束，第 100 行附近）與 `<h3 class="traffic__title">各頁瀏覽</h3>` 之間插入：

```html
        <DailyBars title="每日瀏覽" :points="dailyPoints" unit="次" :markers="TRAFFIC_MARKERS" />
        <AnalyticsMeta :period="rangeText" unit="瀏覽次數（不是人數）" :as-of="summary.as_of" coverage="全站五校合計，不分校區權限" />
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npm --prefix admin run test:unit -- src/__tests__/traffic.test.ts src/__tests__/analyticsCharts.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add admin/src/components/SiteTrafficPanel.vue admin/src/__tests__/traffic.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): 官網瀏覽加每日趨勢，標出 09/30 內頁開始計入

原本 API 有每日資料但畫面只用最後一天；跨過 09/30 的期間前後不能直接比較。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: 預約結果與五校比較面板

**Files:**
- Create: `admin/src/components/analytics/BookingOutcomesSection.vue`
- Create: `admin/src/__tests__/analyticsOutcomes.test.ts`
- Modify: `admin/src/views/AnalyticsView.vue`（import、`rangeReady`、模板第 247 行 filter-bar 結束後）
- Modify: `admin/src/__tests__/analyticsFunnel.test.ts`（`setup()` stubs、新測試）

**Interfaces:**
- Consumes: `getBookingOutcomes`、`rateText`、`isSmallSample`、`PENDING_KINDS`、`PENDING_KIND_LABELS`、`pendingLink`、`rangeKey`（Task 5）；`AnalyticsMeta`（Task 6）；`StatsDimensionTable`（`components/admissions/StatsDimensionTable.vue`，既有）。
- Produces: `<BookingOutcomesSection :range="DateRange | null" :campus-key="string" :period-label="string" :show-compare="boolean" />`。

- [ ] **Step 1: 寫失敗的測試**

`admin/src/__tests__/analyticsOutcomes.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import BookingOutcomesSection from '../components/analytics/BookingOutcomesSection.vue'
import { api, ApiError } from '../api/client'
import type { BookingOutcomesOut, CampusOutcomeOut, OutcomeCountsOut, Role } from '../api/types'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach((wrapper) => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

const rate = (numerator: number, denominator: number) =>
  ({ value: denominator ? Math.round((numerator / denominator) * 1000) / 10 : null, numerator, denominator })

function counts(over: Partial<OutcomeCountsOut> = {}): OutcomeCountsOut {
  const base = {
    cases: 8, web_cases: 7, pending: 1, upcoming: 1, awaiting_attendance: 1, completed: 2, no_show: 1, cancelled: 2, unscheduled: 0,
    cancelled_by_reason: { parent: 1, staff: 0, hold_expired: 0, unknown: 1 },
    ...over,
  }
  const marked = base.completed + base.no_show
  return { ...base, attendance_rate: rate(base.completed, marked), no_show_rate: rate(base.no_show, marked), cancel_rate: rate(base.cancelled, base.cases) }
}

const EMPTY = { cases: 0, web_cases: 0, pending: 0, upcoming: 0, awaiting_attendance: 0, completed: 0, no_show: 0, cancelled: 0,
  cancelled_by_reason: { parent: 0, staff: 0, hold_expired: 0, unknown: 0 } }

function row(campusKey: string, over: Partial<OutcomeCountsOut> = {}, mode: string | null = 'slots'): CampusOutcomeOut {
  return { ...counts(over), campus_key: campusKey, active: true, booking_mode: mode, open_now: { legacy_pending: 1, awaiting_attendance: 2, follow_up_due: 3 } }
}

function outcomes(rows: CampusOutcomeOut[] = [row('yihua'), row('minghua', EMPTY, 'phone')], asOf = '2026-10-03T06:05:00Z'): BookingOutcomesOut {
  return { as_of: asOf, date_from: null, date_to: null, unit: 'visit_request', campuses: rows, totals: counts(),
    open_now_totals: { legacy_pending: 2, awaiting_attendance: 4, follow_up_due: 6 } }
}

async function mountSection(role: Role, props: Record<string, unknown> = {}, data: BookingOutcomesOut = outcomes()) {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser(role, { campus_keys: ['yihua', 'minghua'] })
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/analytics')
  await router.isReady()
  const get = vi.spyOn(api, 'get').mockResolvedValue(data as never)
  const wrapper = mount(BookingOutcomesSection, {
    props: { range: null, campusKey: 'yihua', periodLabel: '開站至今', showCompare: true, ...props },
    global: { plugins: [pinia, router, ElementPlus] },
  })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, get }
}

const caseLinks = (wrapper: VueWrapper) =>
  wrapper.findAll('a').map((link) => link.attributes('href')).filter((href) => href?.startsWith('/visit-requests'))

describe('預約結果', () => {
  it('寫出到場率、未到率、取消率（附分子分母），小樣本提示，還沒標記的另外寫', async () => {
    const { wrapper, get } = await mountSection('reception')
    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith('/admin/analytics/booking-outcomes')
    const text = wrapper.text()
    expect(text).toContain('66.7%（2/3）')
    expect(text).toContain('33.3%（1/3）')
    expect(text).toContain('25.0%（2/8）')
    expect(text).toContain('樣本較少')
    expect(text).toContain('另有 1 件參觀時間過了還沒標記')
    expect(text).toContain('家長自行取消 1・未記錄原因 1')
    expect(text).toContain('單位：預約案件數')
  })

  it('有案件權限的人點得進已套好篩選的案件列表', async () => {
    const { wrapper } = await mountSection('reception')
    expect(caseLinks(wrapper)).toEqual([
      '/visit-requests?campus=yihua&group=past&status=confirmed',
      '/visit-requests?campus=yihua&due=1',
      '/visit-requests?campus=yihua&group=pending',
    ])
  })

  it('只有統計權限的人只看數字，沒有連到案件的連結', async () => {
    const { wrapper } = await mountSection('editor')
    expect(caseLinks(wrapper)).toEqual([])
    expect(wrapper.text()).toContain('你的帳號只能看統計數字')
    expect(wrapper.text()).toContain('3 件')
  })

  it('換校只換顯示的那一列不重抓；換期間才重抓', async () => {
    const { wrapper, get } = await mountSection('reception')
    await wrapper.setProps({ campusKey: 'minghua' })
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('明華校目前的預約方式是「電話洽詢」')
    expect(wrapper.text()).toContain('—')
    await wrapper.setProps({ range: { from: '2026-09-01', to: '2026-09-30' } })
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(2)
    expect(get).toHaveBeenLastCalledWith('/admin/analytics/booking-outcomes?from=2026-09-01&to=2026-09-30')
  })

  it('父層重算出同一段期間不會重抓', async () => {
    const { wrapper, get } = await mountSection('reception', { range: { from: '2026-09-01', to: '2026-09-30' } })
    await wrapper.setProps({ range: { from: '2026-09-01', to: '2026-09-30' } })
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('五校比較每校一列加合計，比率附分子分母；不給 showCompare 就不畫', async () => {
    const { wrapper } = await mountSection('super_admin')
    const rows = wrapper.findAll('.stats-table tbody tr').map((tr) => tr.text())
    expect(rows).toHaveLength(3)
    expect(rows[0]).toContain('義華')
    expect(rows[0]).toContain('66.7%（2/3）')
    expect(rows[1]).toContain('明華')
    expect(rows[1]).toContain('電話洽詢')
    expect(rows[2]).toContain('合計')
    const single = await mountSection('super_admin', { showCompare: false })
    expect(single.wrapper.find('.stats-table').exists()).toBe(false)
  })

  it('回應順序顛倒時只顯示最後一次選的期間', async () => {
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin')
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/analytics')
    await router.isReady()
    const resolvers: ((value: unknown) => void)[] = []
    vi.spyOn(api, 'get').mockImplementation(() => new Promise((resolve) => { resolvers.push(resolve) }))
    const wrapper = mount(BookingOutcomesSection, {
      props: { range: null, campusKey: 'yihua', periodLabel: '開站至今', showCompare: false },
      global: { plugins: [pinia, router, ElementPlus] },
    })
    wrappers.push(wrapper)
    await wrapper.setProps({ range: { from: '2026-09-01', to: '2026-09-30' } })
    resolvers[1]!(outcomes([row('yihua', { cases: 5, web_cases: 5 })]))
    await flushPromises()
    resolvers[0]!(outcomes([row('yihua', { cases: 99, web_cases: 99 })]))
    await flushPromises()
    expect(wrapper.text()).toContain('5')
    expect(wrapper.text()).not.toContain('99')
  })

  it('讀取失敗顯示錯誤，不顯示 0', async () => {
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin')
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/analytics')
    await router.isReady()
    vi.spyOn(api, 'get').mockRejectedValue(new ApiError(500, null))
    const wrapper = mount(BookingOutcomesSection, {
      props: { range: null, campusKey: 'yihua', periodLabel: '開站至今', showCompare: true },
      global: { plugins: [pinia, router, ElementPlus] },
    })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.text()).toContain('無法讀取預約結果')
    expect(wrapper.find('.stat__value').exists()).toBe(false)
  })
})
```

`admin/src/__tests__/analyticsFunnel.test.ts`：`setup()` 的 `stubs: { SiteTrafficPanel: true }` 改成 `stubs: { SiteTrafficPanel: true, BookingOutcomesSection: true, EventTrendPanel: true, ClassDistributionPanel: true }`，並在第一個 `describe` 內加：

```ts
  it('預約結果面板拿到目前的校區與期間；看得到兩校以上才畫五校比較', async () => {
    const { wrapper } = await setup()
    const section = wrapper.findComponent({ name: 'BookingOutcomesSection' })
    expect(section.exists()).toBe(true)
    expect(section.props()).toMatchObject({ campusKey: 'yihua', range: null, periodLabel: '開站至今', showCompare: true })
  })
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm --prefix admin run test:unit -- src/__tests__/analyticsOutcomes.test.ts src/__tests__/analyticsFunnel.test.ts`
Expected: FAIL（元件不存在；`BookingOutcomesSection` 找不到）。

- [ ] **Step 3: 實作元件**

`admin/src/components/analytics/BookingOutcomesSection.vue`：

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ApiError } from '../../api/client'
import type { BookingOutcomesOut, CampusOutcomeOut } from '../../api/types'
import { BOOKING_MODE_LABELS, campusLabel, cancelReasonLabel } from '../../api/labels'
import {
  PENDING_KINDS, PENDING_KIND_LABELS, getBookingOutcomes, isSmallSample, pendingLink, rangeKey, rateText, type DateRange,
} from '../../api/analytics'
import type { StatsColumn } from '../../admissions/statsFormat'
import { usePermissions } from '../../composables/usePermissions'
import { useRequestSequence } from '../../composables/useRequestSequence'
import StatsDimensionTable from '../admissions/StatsDimensionTable.vue'
import AnalyticsMeta from './AnalyticsMeta.vue'

// 預約結果（GET /admin/analytics/booking-outcomes，招生分析報告階段 1 第 1、4、5 項）：期間內
// 送出的案件現在各是什麼結果。一次回全部授權校區，換校只換顯示的列、不重抓；換期間才重抓。
// 和下方「預約流程」（依事件發生日期）口徑不同，畫面寫明不能互相相除。
const props = defineProps<{ range: DateRange | null; campusKey: string; periodLabel: string; showCompare: boolean }>()

const UNIT = '預約案件數（同一個孩子預約兩校算兩筆，不是家庭數）'
const COVERAGE = '依送出日期取這段期間的案件，看它們現在的結果；和下方「預約流程」依事件發生日期計算不同，兩邊的數字不能互相相除。'

const { can } = usePermissions()
const data = ref<BookingOutcomesOut | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const requests = useRequestSequence()

async function load() {
  const request = requests.begin()
  loading.value = true
  error.value = null
  try {
    const result = await getBookingOutcomes(props.range)
    if (requests.isCurrent(request)) data.value = result
  } catch (err) {
    if (!requests.isCurrent(request)) return
    const detail = err instanceof ApiError ? (err.detail as { message?: string } | null) : null
    error.value = detail && typeof detail === 'object' && detail.message ? detail.message : '無法讀取預約結果，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch(() => rangeKey(props.range), load, { immediate: true })

const row = computed<CampusOutcomeOut | null>(() => data.value?.campuses.find((item) => item.campus_key === props.campusKey) ?? null)
const canOpenCases = computed(() => can('booking.read'))
const modeLabel = (mode: string | null) => (mode ? BOOKING_MODE_LABELS[mode] ?? mode : '尚未設定')
const reasonText = (reasons: Record<string, number>) =>
  Object.entries(reasons).filter(([, value]) => value > 0).map(([reason, value]) => `${cancelReasonLabel(reason)} ${value}`).join('・')

const stats = computed(() => {
  const current = row.value
  if (!current) return []
  return [
    { label: '預約案件', value: current.cases, note: `官網 ${current.web_cases}・補登 ${current.cases - current.web_cases}` },
    { label: '已到場', value: current.completed, note: '' },
    { label: '未到場', value: current.no_show, note: '' },
    { label: '參觀時間過了，還沒標記', value: current.awaiting_attendance, note: '' },
    { label: '預約正常（還沒到參觀日）', value: current.upcoming, note: '' },
    { label: '已取消', value: current.cancelled, note: reasonText(current.cancelled_by_reason) },
    ...(current.pending ? [{ label: '舊資料的待處理', value: current.pending, note: '' }] : []),
    ...(current.unscheduled ? [{ label: '已確認、沒有場次（舊資料）', value: current.unscheduled, note: '' }] : []),
  ]
})

const rates = computed(() => {
  const current = row.value
  if (!current) return []
  return [
    { key: 'attendance', label: '到場率', rate: current.attendance_rate, hint: '已到場 ÷（已到場＋未到場）' },
    { key: 'no_show', label: '未到率', rate: current.no_show_rate, hint: '未到場 ÷（已到場＋未到場）' },
    { key: 'cancel', label: '取消率', rate: current.cancel_rate, hint: '已取消 ÷ 預約案件' },
  ]
})

const COLUMNS: StatsColumn[] = [
  { key: 'campus', label: '校區', sticky: true },
  { key: 'mode', label: '預約方式' },
  { key: 'cases', label: '預約案件', kind: 'count' },
  { key: 'completed', label: '已到場', kind: 'count' },
  { key: 'no_show', label: '未到場', kind: 'count' },
  { key: 'attendance', label: '到場率' },
  { key: 'cancelled', label: '已取消', kind: 'count' },
  { key: 'reasons', label: '取消原因' },
  { key: 'cancel', label: '取消率' },
  { key: 'awaiting_now', label: '待標記到場（現在）', kind: 'count' },
  { key: 'follow_up_now', label: '到期待追蹤（現在）', kind: 'count' },
  { key: 'legacy_now', label: '舊資料待處理（現在）', kind: 'count' },
]

const compareRows = computed(() => {
  if (!data.value) return []
  const rows: Record<string, unknown>[] = data.value.campuses.map((item) => ({
    key: item.campus_key,
    campus: `${campusLabel(item.campus_key)}${item.active ? '' : '（已停用）'}`,
    mode: modeLabel(item.booking_mode),
    cases: item.cases,
    completed: item.completed,
    no_show: item.no_show,
    attendance: rateText(item.attendance_rate),
    cancelled: item.cancelled,
    reasons: reasonText(item.cancelled_by_reason),
    cancel: rateText(item.cancel_rate),
    awaiting_now: item.open_now.awaiting_attendance,
    follow_up_now: item.open_now.follow_up_due,
    legacy_now: item.open_now.legacy_pending,
  }))
  const totals = data.value.totals
  const open = data.value.open_now_totals
  rows.push({
    key: 'total', campus: '合計', mode: '', cases: totals.cases, completed: totals.completed, no_show: totals.no_show,
    attendance: rateText(totals.attendance_rate), cancelled: totals.cancelled, reasons: reasonText(totals.cancelled_by_reason),
    cancel: rateText(totals.cancel_rate), awaiting_now: open.awaiting_attendance, follow_up_now: open.follow_up_due, legacy_now: open.legacy_pending,
  })
  return rows
})
</script>

<template>
  <div class="outcomes-section">
    <StatsDimensionTable
      v-if="showCompare && data"
      :title="`五校比較（${periodLabel}）`"
      :rows="compareRows"
      :columns="COLUMNS"
      row-key="key"
      empty-text="沒有可比較的校區"
      caption="數字是預約案件數，同一個孩子預約兩校算兩筆；比率括號內是分子／分母。「現在」三欄是此刻的待處理，不受期間影響。不受上方「查看校區」影響。"
    />

    <section class="panel" aria-labelledby="outcomes-title" :aria-busy="loading">
      <div class="panel__head">
        <h2 id="outcomes-title">預約結果{{ row ? `・${campusLabel(row.campus_key)}校` : '' }}</h2>
        <span class="hint" role="status">{{ loading && data ? '更新中…' : '' }}</span>
      </div>
      <div class="panel__body outcomes__body">
        <el-alert v-if="error" type="error" :closable="false" show-icon :title="error"><el-button @click="load">重新載入</el-button></el-alert>
        <el-skeleton v-else-if="loading && !data" animated :rows="4" aria-label="正在讀取預約結果" />
        <template v-else-if="data">
          <p v-if="!row" class="field-help">這個校區沒有資料。</p>
          <template v-else>
            <p v-if="row.booking_mode !== 'slots'" class="hint">
              {{ campusLabel(row.campus_key) }}校目前的預約方式是「{{ modeLabel(row.booking_mode) }}」，官網預約的件數會很少或是 0。
            </p>
            <div class="stat-list outcomes__stats">
              <div v-for="stat in stats" :key="stat.label" class="stat">
                <span class="stat__label">{{ stat.label }}</span>
                <span class="stat__value">{{ stat.value }}</span>
                <span v-if="stat.note" class="hint">{{ stat.note }}</span>
              </div>
            </div>
            <dl class="outcomes__rates">
              <div v-for="item in rates" :key="item.key">
                <dt>{{ item.label }}</dt>
                <dd class="num">
                  {{ rateText(item.rate) }}
                  <el-tag v-if="isSmallSample(item.rate)" size="small" type="info">樣本較少</el-tag>
                </dd>
                <dd class="hint">{{ item.hint }}</dd>
              </div>
            </dl>
            <p v-if="row.awaiting_attendance" class="hint">
              另有 {{ row.awaiting_attendance }} 件參觀時間過了還沒標記，標記之後到場率會變。
            </p>

            <h3 class="outcomes__title">現在待處理</h3>
            <p class="hint">此刻的狀態，不受上方期間影響。</p>
            <ul class="outcomes__pending">
              <li v-for="kind in PENDING_KINDS" :key="kind">
                <span>{{ PENDING_KIND_LABELS[kind] }}</span>
                <router-link v-if="canOpenCases && row.open_now[kind] > 0" class="num" :to="pendingLink(kind, row.campus_key)">{{ row.open_now[kind] }} 件</router-link>
                <span v-else class="num">{{ row.open_now[kind] }} 件</span>
              </li>
            </ul>
            <p v-if="!canOpenCases" class="hint">你的帳號只能看統計數字，看不到是哪幾筆案件。</p>
          </template>
          <AnalyticsMeta :period="periodLabel" :unit="UNIT" :as-of="data.as_of" :coverage="COVERAGE" />
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.outcomes-section {
  display: grid;
  gap: 16px;
  margin-bottom: 16px;
}

.outcomes__body {
  display: grid;
  gap: 12px;
}

.outcomes__body > .hint,
.outcomes__body > .field-help {
  margin: 0;
}

.outcomes__rates {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin: 0;
}

.outcomes__rates dt {
  color: var(--ink-3);
  font-size: 13px;
}

.outcomes__rates dd {
  margin: 2px 0 0;
}

.outcomes__rates dd.num {
  font-size: 18px;
  font-weight: 600;
}

.outcomes__title {
  margin: 8px 0 0;
  font-size: 14px;
}

.outcomes__pending {
  list-style: none;
  margin: 0;
  padding: 0;
}

.outcomes__pending li {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
}

.outcomes__pending li + li {
  border-top: 1px solid var(--line);
}

@media (max-width: 600px) {
  .outcomes__rates {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
```

- [ ] **Step 4: 放進 AnalyticsView**

`admin/src/views/AnalyticsView.vue`：

- import：`import BookingOutcomesSection from '../components/analytics/BookingOutcomesSection.vue'`
- `rangeTooLong` 之後加：

```ts
// 自訂區間還沒選好或太長時，各面板都不送請求（和預約流程同一個條件）。
const rangeReady = computed(() => period.value !== 'custom' || (customRange.value !== null && !rangeTooLong.value))
```

- 模板 `</div>`（filter-bar 結束）之後、`<el-empty v-if="!visibleCampusKeys.length" …>` 之前插入：

```html
    <BookingOutcomesSection
      v-if="visibleCampusKeys.length && campusKey && rangeReady"
      :range="range"
      :campus-key="campusKey"
      :period-label="periodLabel"
      :show-compare="visibleCampusKeys.length > 1"
    />
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npm --prefix admin run test:unit -- src/__tests__/analyticsOutcomes.test.ts src/__tests__/analyticsFunnel.test.ts`
Expected: PASS。若 `caseLinks` 的 href 在 memory history 下帶前綴（例如 `#`），把斷言改成比對 `router.resolve(href).fullPath`，不要改 `pendingLink`。

- [ ] **Step 6: Commit**

```bash
git add admin/src/components/analytics/BookingOutcomesSection.vue admin/src/__tests__/analyticsOutcomes.test.ts admin/src/views/AnalyticsView.vue admin/src/__tests__/analyticsFunnel.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): 成效統計加預約結果與五校比較（到場率、未到率、現在待處理）

同批案件口徑、比率附分子分母；有案件權限才點得進已篩好的案件列表。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: 選定校區的每日變化面板

**Files:**
- Create: `admin/src/components/analytics/EventTrendPanel.vue`
- Create: `admin/src/__tests__/analyticsTrend.test.ts`
- Modify: `admin/src/views/AnalyticsView.vue`（import；在「預約流程」`</section>` 之後插入）

**Interfaces:**
- Consumes: `getEventTrend`、`SELF_BOOKING_SINCE`、`rangeKey`（Task 5）；`DailyBars`、`AnalyticsMeta`（Task 6）。
- Produces: `<EventTrendPanel :campus-key="string" :range="DateRange | null" :period-label="string" />`。

- [ ] **Step 1: 寫失敗的測試**

`admin/src/__tests__/analyticsTrend.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import EventTrendPanel from '../components/analytics/EventTrendPanel.vue'
import { api } from '../api/client'
import type { EventTrendOut } from '../api/types'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach((wrapper) => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

const day = (date: string, over: Partial<EventTrendOut['days'][number]> = {}) =>
  ({ day: date, request_created: 0, visit_completed: 0, visit_cancelled: 0, clicks: 0, ...over })

const trend = (over: Partial<EventTrendOut> = {}): EventTrendOut => ({
  as_of: '2026-10-03T06:05:00Z', campus_key: 'yihua', date_from: '2026-09-30', date_to: '2026-10-02', truncated: false, unit: 'event',
  days: [day('2026-09-30', { request_created: 2, clicks: 1 }), day('2026-10-01', { request_created: 4, clicks: 8 }), day('2026-10-02')],
  ...over,
})

async function mountPanel(data: EventTrendOut = trend(), props: Record<string, unknown> = {}) {
  const get = vi.spyOn(api, 'get').mockResolvedValue(data as never)
  const wrapper = mount(EventTrendPanel, { props: { campusKey: 'yihua', range: null, periodLabel: '開站至今', ...props }, global: { plugins: [ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, get }
}

const heights = (wrapper: VueWrapper) => wrapper.findAll('.daily-bars__fill').map((fill) => (fill.element as HTMLElement).style.height)

describe('每日變化', () => {
  it('預設畫送出需求，標出 10/01 自選場次上線，寫實際畫出的期間', async () => {
    const { wrapper, get } = await mountPanel()
    expect(get).toHaveBeenCalledWith('/admin/analytics/event-trend?campus_key=yihua')
    expect(heights(wrapper)).toEqual(['50%', '100%', '0%'])
    expect(wrapper.text()).toContain('10/01 起：家長自選場次上線')
    expect(wrapper.text()).toContain('期間 2026/09/30–2026/10/02')
    expect(wrapper.text()).toContain('未到場沒有每日紀錄')
  })

  it('切到預約鈕點擊不重抓，直條換成點擊數', async () => {
    const { wrapper, get } = await mountPanel()
    wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', 'clicks')
    await flushPromises()
    expect(get).toHaveBeenCalledTimes(1)
    expect(heights(wrapper)).toEqual(['13%', '100%', '0%'])
  })

  it('換校或換期間才重抓', async () => {
    const { wrapper, get } = await mountPanel()
    await wrapper.setProps({ campusKey: 'minghua' })
    await flushPromises()
    await wrapper.setProps({ range: { from: '2026-09-01', to: '2026-09-30' } })
    await flushPromises()
    expect(get.mock.calls.map((call) => call[0])).toEqual([
      '/admin/analytics/event-trend?campus_key=yihua',
      '/admin/analytics/event-trend?campus_key=minghua',
      '/admin/analytics/event-trend?campus_key=minghua&from=2026-09-01&to=2026-09-30',
    ])
  })

  it('超過 400 天寫明只畫最近 400 天', async () => {
    const { wrapper } = await mountPanel(trend({ truncated: true }))
    expect(wrapper.text()).toContain('只畫最近 400 天')
  })

  it('讀取失敗顯示錯誤', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('network'))
    const wrapper = mount(EventTrendPanel, { props: { campusKey: 'yihua', range: null, periodLabel: '開站至今' }, global: { plugins: [ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.text()).toContain('無法讀取每日變化')
    expect(wrapper.find('.daily-bars__plot').exists()).toBe(false)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm --prefix admin run test:unit -- src/__tests__/analyticsTrend.test.ts`
Expected: FAIL（元件不存在）。

- [ ] **Step 3: 實作**

`admin/src/components/analytics/EventTrendPanel.vue`：

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { EventTrendOut } from '../../api/types'
import { SELF_BOOKING_SINCE, getEventTrend, rangeKey, type DateRange } from '../../api/analytics'
import { useRequestSequence } from '../../composables/useRequestSequence'
import AnalyticsMeta from './AnalyticsMeta.vue'
import DailyBars from './DailyBars.vue'

// 選定校區的每日事件（GET /admin/analytics/event-trend）。和「預約流程」同一個口徑：依事件發生
// 的台北日期計數；確認不畫（10/01 起和送出需求同時發生），未到場沒有事件，看「預約結果」。
type Series = 'request_created' | 'visit_completed' | 'visit_cancelled' | 'clicks'
const SERIES: { value: Series; label: string }[] = [
  { value: 'request_created', label: '送出需求' },
  { value: 'visit_completed', label: '已到場' },
  { value: 'visit_cancelled', label: '已取消' },
  { value: 'clicks', label: '預約鈕點擊' },
]
const MARKERS = [{ day: SELF_BOOKING_SINCE, label: '家長自選場次上線，送出即預約成功' }]

const props = defineProps<{ campusKey: string; range: DateRange | null; periodLabel: string }>()
const series = ref<Series>('request_created')
const trend = ref<EventTrendOut | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const requests = useRequestSequence()

async function load() {
  const request = requests.begin()
  loading.value = true
  error.value = null
  try {
    const result = await getEventTrend(props.campusKey, props.range)
    if (requests.isCurrent(request)) trend.value = result
  } catch {
    if (requests.isCurrent(request)) error.value = '無法讀取每日變化，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch(() => `${props.campusKey}|${rangeKey(props.range)}`, load, { immediate: true })

const seriesLabel = computed(() => SERIES.find((item) => item.value === series.value)!.label)
const points = computed(() => (trend.value?.days ?? []).map((item) => ({ day: item.day, value: item[series.value] })))
const slash = (day: string) => day.replaceAll('-', '/')
const actualPeriod = computed(() => (trend.value ? `${slash(trend.value.date_from)}–${slash(trend.value.date_to)}` : props.periodLabel))
</script>

<template>
  <section class="panel" aria-labelledby="event-trend-title" :aria-busy="loading">
    <div class="panel__head trend__head">
      <h2 id="event-trend-title">每日變化</h2>
      <el-radio-group v-model="series" size="small" aria-label="要看的項目">
        <el-radio-button v-for="item in SERIES" :key="item.value" :value="item.value">{{ item.label }}</el-radio-button>
      </el-radio-group>
    </div>
    <div class="panel__body trend__body">
      <el-alert v-if="error" type="error" :closable="false" show-icon :title="error"><el-button @click="load">重新載入</el-button></el-alert>
      <el-skeleton v-else-if="loading && !trend" animated :rows="3" aria-label="正在讀取每日變化" />
      <template v-else-if="trend">
        <DailyBars :title="`每日${seriesLabel}`" :points="points" unit="次" :markers="MARKERS" />
        <AnalyticsMeta :period="actualPeriod" unit="事件次數（依發生日期）" :as-of="trend.as_of" />
        <p v-if="trend.truncated" class="hint">期間超過 400 天，只畫最近 400 天。</p>
        <p class="hint">已到場、已取消可能是更早送出的預約；未到場沒有每日紀錄，請看上方「預約結果」。</p>
      </template>
    </div>
  </section>
</template>

<style scoped>
.trend__head {
  flex-wrap: wrap;
  gap: 8px 12px;
}

.trend__body {
  display: grid;
  gap: 8px;
}

.trend__body > .hint {
  margin: 0;
}
</style>
```

`AnalyticsView.vue`：import `EventTrendPanel from '../components/analytics/EventTrendPanel.vue'`；在 `analytics__results` 裡第一個 `<section class="panel">`（預約流程）的 `</section>` 之後插入 `<EventTrendPanel :campus-key="campusKey" :range="range" :period-label="periodLabel" />`。

- [ ] **Step 4: 跑測試確認通過**

Run: `npm --prefix admin run test:unit -- src/__tests__/analyticsTrend.test.ts src/__tests__/analyticsFunnel.test.ts`
Expected: PASS（`13%` 是 1 ÷ 8 四捨五入）。

- [ ] **Step 5: Commit**

```bash
git add admin/src/components/analytics/EventTrendPanel.vue admin/src/__tests__/analyticsTrend.test.ts admin/src/views/AnalyticsView.vue
git commit -m "$(cat <<'EOF'
feat(admin): 成效統計加選定校區的每日變化（送出、到場、取消、點擊）

依事件發生日期分天，標出 10/01 自選場次上線。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: 預約孩子的班別面板

**Files:**
- Create: `admin/src/components/analytics/ClassDistributionPanel.vue`
- Create: `admin/src/__tests__/analyticsClasses.test.ts`
- Modify: `admin/src/views/AnalyticsView.vue`（import；在「預約鈕點擊」`</section>` 之後插入）

**Interfaces:**
- Consumes: `getClassDistribution`、`rangeKey`（Task 5）；`currentTerm`、`schoolYearOptions`（`admissions/academic.ts`）；`StatsDimensionTable`；`AnalyticsMeta`。
- Produces: `<ClassDistributionPanel :campus-key="string" :range="DateRange | null" :period-label="string" />`。

- [ ] **Step 1: 寫失敗的測試**

`admin/src/__tests__/analyticsClasses.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import ClassDistributionPanel from '../components/analytics/ClassDistributionPanel.vue'
import { api } from '../api/client'
import { currentTerm } from '../admissions/academic'
import type { ClassDistributionOut } from '../api/types'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach((wrapper) => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

const dist = (over: Partial<ClassDistributionOut> = {}): ClassDistributionOut => ({
  as_of: '2026-10-03T06:05:00Z', campus_key: 'yihua', date_from: null, date_to: null, school_year: 115, unit: 'visit_request',
  total: 9, grades: [{ grade: '幼幼班', count: 2 }, { grade: '小班', count: 3 }, { grade: '中班', count: 1 }, { grade: '大班', count: 0 }],
  out_of_range: 1, unrecorded: 2, ...over,
})

async function mountPanel(data: ClassDistributionOut = dist()) {
  const get = vi.spyOn(api, 'get').mockResolvedValue(data as never)
  const wrapper = mount(ClassDistributionPanel, { props: { campusKey: 'yihua', range: null, periodLabel: '開站至今' }, global: { plugins: [ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, get }
}

describe('預約孩子的班別', () => {
  it('預設用目前學年換算；四個班加範圍外與沒有生日，各自一列', async () => {
    const { wrapper, get } = await mountPanel()
    expect(get).toHaveBeenCalledWith(`/admin/analytics/class-distribution?campus_key=yihua&school_year=${currentTerm().schoolYear}`)
    const rows = wrapper.findAll('.stats-table tbody tr').map((tr) => tr.text())
    expect(rows).toHaveLength(6)
    expect(rows[1]).toContain('小班')
    expect(rows[1]).toContain('3')
    expect(rows[4]).toContain('不在幼幼班～大班')
    expect(rows[5]).toContain('沒有生日資料')
    expect(wrapper.text()).toContain('不代表已報名或入學')
    expect(wrapper.text()).toContain('單位：預約案件數（含已取消）')
  })

  it('換學年重抓', async () => {
    const { wrapper, get } = await mountPanel()
    const next = currentTerm().schoolYear + 1
    wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', next)
    await flushPromises()
    expect(get).toHaveBeenLastCalledWith(`/admin/analytics/class-distribution?campus_key=yihua&school_year=${next}`)
  })

  it('沒有預約案件時寫出來，不列一排 0', async () => {
    const { wrapper } = await mountPanel(dist({ total: 0, grades: dist().grades.map((row) => ({ ...row, count: 0 })), out_of_range: 0, unrecorded: 0 }))
    expect(wrapper.text()).toContain('這段期間沒有預約案件。')
    expect(wrapper.find('.stats-table').exists()).toBe(false)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm --prefix admin run test:unit -- src/__tests__/analyticsClasses.test.ts`
Expected: FAIL（元件不存在）。

- [ ] **Step 3: 實作**

`admin/src/components/analytics/ClassDistributionPanel.vue`：

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ClassDistributionOut } from '../../api/types'
import { getClassDistribution, rangeKey, type DateRange } from '../../api/analytics'
import { currentTerm, schoolYearOptions } from '../../admissions/academic'
import type { StatsColumn } from '../../admissions/statsFormat'
import { useRequestSequence } from '../../composables/useRequestSequence'
import StatsDimensionTable from '../admissions/StatsDimensionTable.vue'
import AnalyticsMeta from './AnalyticsMeta.vue'

// 預約孩子的生日換算成某學年度的班別（GET /admin/analytics/class-distribution）。換算在後端
// （admissions/academic.grade_for_birthday，和招生入學、官網入學資訊頁共用案例
// contracts/ivy-recruitment/grade-cases.json），這裡只顯示。是年齡對照，不是報名或入學結果。
const props = defineProps<{ campusKey: string; range: DateRange | null; periodLabel: string }>()

const baseYear = currentTerm().schoolYear
const yearOptions = schoolYearOptions(baseYear, [2, 1, 0, -1])
const schoolYear = ref(baseYear)
const data = ref<ClassDistributionOut | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const requests = useRequestSequence()

async function load() {
  const request = requests.begin()
  loading.value = true
  error.value = null
  try {
    const result = await getClassDistribution(props.campusKey, schoolYear.value, props.range)
    if (requests.isCurrent(request)) data.value = result
  } catch {
    if (requests.isCurrent(request)) error.value = '無法讀取班別分布，請重新載入。'
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

watch(() => `${props.campusKey}|${rangeKey(props.range)}|${schoolYear.value}`, load, { immediate: true })

const COLUMNS: StatsColumn[] = [
  { key: 'label', label: '班別', sticky: true },
  { key: 'count', label: '預約案件', kind: 'bar' },
]
const rows = computed(() =>
  data.value
    ? [
        ...data.value.grades.map((row) => ({ key: row.grade, label: row.grade, count: row.count })),
        { key: 'out_of_range', label: '不在幼幼班～大班', count: data.value.out_of_range },
        { key: 'unrecorded', label: '沒有生日資料', count: data.value.unrecorded },
      ]
    : [],
)
</script>

<template>
  <section class="panel" aria-labelledby="class-dist-title" :aria-busy="loading">
    <div class="panel__head classes__head">
      <h2 id="class-dist-title">預約孩子的班別</h2>
      <label class="filter-field classes__year">
        <span>學年度</span>
        <el-select v-model="schoolYear" aria-label="換算的學年度">
          <el-option v-for="year in yearOptions" :key="year" :value="year" :label="`${year} 學年度`" />
        </el-select>
      </label>
    </div>
    <div class="panel__body classes__body">
      <el-alert v-if="error" type="error" :closable="false" show-icon :title="error"><el-button @click="load">重新載入</el-button></el-alert>
      <el-skeleton v-else-if="loading && !data" animated :rows="3" aria-label="正在讀取班別分布" />
      <template v-else-if="data">
        <p v-if="data.total === 0" class="field-help">這段期間沒有預約案件。</p>
        <StatsDimensionTable v-else :title="`${data.school_year} 學年度的班別`" :rows="rows" :columns="COLUMNS" row-key="key" empty-text="沒有資料" />
        <AnalyticsMeta :period="periodLabel" unit="預約案件數（含已取消）" :as-of="data.as_of" />
        <p class="hint">
          依孩子生日換算：民國 Y/9/2～Y+1/9/1 出生為同一屆，8/1 起算新學年。這是年齡對照，不代表已報名或入學。
          「沒有生日資料」是舊案只填了年齡、補登時沒問生日，或已依保存政策匿名化。
        </p>
      </template>
    </div>
  </section>
</template>

<style scoped>
.classes__head {
  flex-wrap: wrap;
  gap: 8px 12px;
}

.classes__year :deep(.el-select) {
  width: 140px;
}

.classes__body {
  display: grid;
  gap: 8px;
}

.classes__body > .hint,
.classes__body > .field-help {
  margin: 0;
}
</style>
```

`AnalyticsView.vue`：import `ClassDistributionPanel from '../components/analytics/ClassDistributionPanel.vue'`；在 `analytics__results` 最後一個 `</section>`（預約鈕點擊）之後插入 `<ClassDistributionPanel :campus-key="campusKey" :range="range" :period-label="periodLabel" />`。

- [ ] **Step 4: 跑測試確認通過**

Run: `npm --prefix admin run test:unit -- src/__tests__/analyticsClasses.test.ts src/__tests__/analyticsFunnel.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add admin/src/components/analytics/ClassDistributionPanel.vue admin/src/__tests__/analyticsClasses.test.ts admin/src/views/AnalyticsView.vue
git commit -m "$(cat <<'EOF'
feat(admin): 成效統計加預約孩子的班別分布

依選定學年度換算，範圍外與沒有生日另列；寫明是年齡對照、不是入學結果。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: 預約流程的說明列、頁首說明與手機溢出檢查

**Files:**
- Modify: `admin/src/views/AnalyticsView.vue`（`PageHeader` lead；預約流程 panel 的 `.analytics__note` 之後）
- Modify: `admin/src/__tests__/analyticsFunnel.test.ts`
- Modify: `tests/stack/keyboard.spec.ts:112-124`

**Interfaces:**
- Consumes: `AnalyticsMeta`、`AnalyticsFunnelOut.as_of`。

- [ ] **Step 1: 寫失敗的測試**

`analyticsFunnel.test.ts` 第一個 `describe` 內加：

```ts
  it('預約流程寫出單位與更新時間', async () => {
    const { wrapper } = await setup()
    const panel = wrapper.findAll('.panel').find((item) => item.text().includes('預約流程'))!
    expect(panel.text()).toContain('單位：事件次數（依發生日期）')
    expect(panel.text()).toContain('10/03 14:05')
  })
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npm --prefix admin run test:unit -- src/__tests__/analyticsFunnel.test.ts`
Expected: FAIL（找不到「單位：事件次數」）。

- [ ] **Step 3: 實作**

`AnalyticsView.vue`：

- import `AnalyticsMeta from '../components/analytics/AnalyticsMeta.vue'`。
- `PageHeader` 的 `lead` 改成：`官網瀏覽量與網頁速度，以及各校參觀預約的結果（到場、未到、取消）、每日變化、來源與預約孩子的班別，可以依期間與校區查看。`
- 預約流程 panel 最後一個 `<p class="analytics__note">依事件發生的日期…</p>` 之後加：

```html
        <div class="analytics__meta"><AnalyticsMeta :period="periodLabel" unit="事件次數（依發生日期）" :as-of="funnel.as_of" /></div>
```

- `<style scoped>` 加：

```css
.analytics__meta {
  padding: 0 24px 16px;
}
```

`tests/stack/keyboard.spec.ts`：`ADMIN_PAGES` 在 `['/booking', '各校預約方式'],` 之後加 `['/analytics', '成效統計'],`。

- [ ] **Step 4: 跑測試確認通過**

```bash
npm --prefix admin run test:unit -- src/__tests__/analyticsFunnel.test.ts
npm --prefix admin run typecheck
```

Expected: PASS、typecheck 0 錯誤。stack 的溢出檢查在 Task 13 跑。

- [ ] **Step 5: Commit**

```bash
git add admin/src/views/AnalyticsView.vue admin/src/__tests__/analyticsFunnel.test.ts tests/stack/keyboard.spec.ts
git commit -m "$(cat <<'EOF'
feat(admin): 預約流程寫出單位與更新時間，成效統計加入手機溢出檢查

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: 文件

**Files:**
- Modify: `README.md`（頂部加日期段落）
- Modify: `DESIGN.md`（新增一節）
- Modify: `docs/website-admin/acceptance.md`（檔尾新增「招生分析階段 1」）

- [ ] **Step 1: README 頂部**

在第一個 `## ` 之前加（日期與驗證數字依實際結果填寫，不要照抄範例數字）：

```markdown
## 2026-10-0X 成效統計補強：預約結果、五校比較、每日趨勢與班別（`feature/admin-analytics-phase1-20261003`，未部署）

依 `docs/analysis/2026-09-30-enrollment-analytics-report.md` 階段 1；計畫 `docs/superpowers/plans/2026-10-03-admin-analytics-phase1.md`。規則見 DESIGN.md「成效統計補強」。

- **後端**：`GET /admin/analytics/booking-outcomes`（同批案件的結果、到場率、未到率、取消率、現在待處理三種，只列授權校區）、`/event-trend`（每日事件，台北日期）、`/class-distribution`（生日換算班別）；funnel 與 traffic 帶 `as_of`。待處理三種集中到 `booking/pending_kinds.py`，總覽與案件列表共用。不新增資料表、沒有 migration。
- **後台**：`components/analytics/` 新增五個元件；官網瀏覽加每日趨勢與 09/30 標記。
- **驗證**（Node 22）：（依 Task 13 實際結果填寫：pytest、admin vitest、typecheck、contract:check、stack、截圖）。
- **未做**：統計匯出（匯出擴充計畫）、測試案件人工排除（要 migration）、UTM（階段 3）。
```

- [ ] **Step 2: DESIGN.md**

在「招生入學（2026-10-01）」一節之後加：

```markdown
## 成效統計補強（2026-10-0X，招生分析階段 1）

- **兩種口徑分開寫**：「預約結果」依送出日期取期間內的案件、看它們現在的結果；「預約流程」與「每日變化」依事件發生日期計數。畫面寫明兩邊數字不能互相相除。
- **到場率＝已到場 ÷（已到場＋未到場）**，未到率同分母；參觀時間過了還沒標記的另外寫，不算進分母、不當成到場。比率一律附分子／分母（「66.7%（2/3）」），分母 0 寫「—」，分母 1–19 加「樣本較少」tag。
- **待處理三種**（參觀時間過了還沒標記、到期待追蹤、舊資料的待處理）寫「現在」，不受期間影響；有案件權限才是連結，連到和總覽同一組篩選。
- **五校比較**看得到兩校以上才畫，和招生入學的 `/compare` 分開（2026-10-03 使用者裁定），不放參觀／預繳／註冊。加一列「合計」。
- **每日趨勢**是 CSS 直條，數字在「每日數字」裡；口徑改變的日子（流量 09/30、事件 10/01）在直條左緣畫警示色細線，下方寫「MM/DD 起：…」。
- **每張圖下方一行說明**：期間、單位、更新時間、涵蓋範圍（`AnalyticsMeta`）。
- **班別**是年齡對照，寫明「不代表已報名或入學」；沒有生日、不在幼幼班～大班各自一列，不猜班別。
```

- [ ] **Step 3: acceptance.md**

檔尾加（狀態與證據依 Task 13 實際結果填）：

```markdown
## 招生分析階段 1（2026-10-0X，`feature/admin-analytics-phase1-20261003`，尚未部署）

規格 `docs/analysis/2026-09-30-enrollment-analytics-report.md` §4、§7；計畫 `docs/superpowers/plans/2026-10-03-admin-analytics-phase1.md`。

| 編號 | 案例 | 狀態 | 證據 |
|---|---|---|---|
| E01 | 全區與單校帳號查同一張報表 | | `test_analytics_booking_outcomes.py::test_only_campuses_in_scope_are_listed`、`test_analytics_event_trend.py::test_other_campus_is_hidden`、`test_analytics_class_distribution.py::test_period_scope_and_school_year_bounds` |
| E02 | 只有 analytics.read | | `test_analytics_only_role_sees_counts_without_personal_data`；`analyticsOutcomes.test.ts`「只有統計權限的人只看數字」 |
| E03 | 台北午夜、月底、跨年 | | `test_period_uses_taipei_days_of_created_at`、`test_days_are_taipei_dates_and_zero_filled` |
| E04 | 每日資料有空白日期、查詢失敗 | | `test_days_are_taipei_dates_and_zero_filled`、`test_no_events_gives_one_zero_day`；各面板「讀取失敗顯示錯誤」 |
| E05 | 生日 9/1、9/2；學年 7/31、8/1 | | `test_analytics_class_distribution.py::test_shared_grade_cases`（共用 `grade-cases.json`） |
| E06 | 缺生日、舊年齡文字、範圍外 | | `test_missing_or_anonymized_birthdays_are_unrecorded`、`test_shared_grade_cases` 的範圍外案例 |
| E07 | 快速切換、回應順序顛倒 | | `analyticsOutcomes.test.ts`「回應順序顛倒…」；各面板以 `useRequestSequence` 擋 |
| E08 | 待處理三種計數 | | `test_analytics_pending_kinds.py`、`test_open_now_matches_dashboard_and_ignores_period` |
| E25 | 1440／390、鍵盤 | | stack `keyboard.spec.ts` 後台溢出（含 `/analytics`）；截圖 `output/playwright/analytics-{1440,390}.png` |
| E26 | 期間跨 10-01 | | `test_period_crossing_self_booking_switch_has_no_confirmation_rate`；既有 `analyticsFunnel.test.ts` 確認率測試 |
| E27 | 流量期間跨 09-30 | | `traffic.test.ts`「每日瀏覽趨勢」兩項 |
```

- [ ] **Step 4: Commit**

```bash
git add README.md DESIGN.md docs/website-admin/acceptance.md
git commit -m "$(cat <<'EOF'
docs(analytics): 記錄成效統計補強的規則與招生分析階段 1 驗收

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 13: 驗證閘門（主 session 執行）

**Files:** 依結果回填 Task 12 的 README／acceptance 數字後再 commit 一次。

全套測試由**主 session** 用背景指令跑，一次一組；不要讓 subagent 跑全套或等背景指令（10 分鐘無輸出會被中止）。

- [ ] **Step 1: 後端全套（背景）**

```bash
cd ~/Desktop/ivy-website-analytics-20261003/backend
WEBSITE_TEST_DATABASE_URL=$TDB PYTHONUNBUFFERED=1 uv run --frozen pytest -q -o faulthandler_timeout=240
```

Expected: 全部 passed（約 1300 項、bcrypt rounds 4 後約 8 分鐘）。已知假失敗：台北週五 `test_booking_consent_readiness` 的場次同步——在 origin/main 上單獨跑同一項也失敗（main 既有、日期相依）才可忽略，並在回報註明。

- [ ] **Step 2: 前端與契約（逐一執行）**

```bash
cd ~/Desktop/ivy-website-analytics-20261003
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1
npm --prefix admin run typecheck
npm --prefix admin run test:unit -- --maxWorkers=2
npm --prefix admin run build
npm --prefix web run typecheck
npm run test:website -- --maxWorkers=2
npm run contract:check
```

Expected: 全部結束碼 0。admin vitest 在其他 session 高負載時若有個別 5 秒逾時，單獨重跑該檔確認。

- [ ] **Step 3: stack e2e（自訂庫與埠，避開別的 session）**

```bash
cd ~/Desktop/ivy-website-analytics-20261003
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1
export E2E_DB_NAME=ivy_website_analytics_e2e_test E2E_API_PORT=8751 E2E_WEB_PORT=3751
npm run e2e:build
npx playwright test -c playwright.stack.config.ts tests/stack/keyboard.spec.ts
npm run test:e2e:stack
```

Expected: keyboard 全過（含 `/analytics` 390／1440 不溢出）；整套全過。`media.spec.ts` 整套跑時偶發失敗是 main 既有問題——單獨重跑 `npx playwright test -c playwright.stack.config.ts tests/stack/media.spec.ts` 通過即可，回報註明。

- [ ] **Step 4: 畫面截圖（桌機與手機）**

用 stack 起好的服務（或 `start-api.sh`／`start-web.sh`）以 super_admin 登入，寫臨時腳本 `output/playwright/analytics-shots.cjs`：

```js
const { chromium } = require('playwright')
;(async () => {
  const browser = await chromium.launch({ channel: 'chrome' })
  for (const [name, viewport] of [['1440', { width: 1440, height: 900 }], ['390', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, storageState: 'output/e2e-stack/auth/super_admin.json', locale: 'zh-TW', timezoneId: 'Asia/Taipei' })
    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:${process.env.E2E_WEB_PORT}/admin/analytics`, { waitUntil: 'networkidle' })
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    console.log(name, 'overflow', overflow)
    await page.screenshot({ path: `output/playwright/analytics-${name}.png`, fullPage: true })
    await context.close()
  }
  await browser.close()
})()
```

Run: `node output/playwright/analytics-shots.cjs`
Expected: 兩個 `overflow 0`；打開兩張截圖人工確認：五校比較表在框內橫捲、第一欄固定；每日直條與說明列沒有擠壓；手機上比率一欄一列。

- [ ] **Step 5: 回填文件並 commit**

把 Step 1–4 的實際數字填回 README 段落與 acceptance 表的「狀態」欄（通過／部分，沒跑的寫未驗證），然後：

```bash
git add README.md docs/website-admin/acceptance.md
git commit -m "$(cat <<'EOF'
docs(analytics): 補上成效統計補強的驗證結果

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 6: 收尾**

`git -C ~/Desktop/ivy-website-analytics-20261003 status --short` 應為空白。回報：完成範圍、指標公式、修改檔案、實際跑過的指令與結果、未驗證項（Safari／iOS 實機、正式站資料）。

**合併上線由使用者決定（push main＝正式部署）。** 本計畫沒有 migration，不需要部署前備份；合併前先 `git fetch` 並確認 `contracts/` 沒有和其他分支（例如匯出擴充）衝突，有衝突就在合併後重跑 `npm run contract:generate` 與 `contract:check`。

---

## 待使用者確認（不影響開工，Task 8／10 前確認即可）

1. **到場率分母**：本計畫用「已到場＋未到場」，時間已過還沒標記的另外寫、不算進分母。若業主要把還沒標記的也算進分母（比率會偏低，但不會因為沒人標記而虛高），只改 `booking_outcomes_service._with_rates` 與 Task 2、5、8 的斷言。
2. **班別預設學年**：本計畫預設「目前學年」（8/1 換年）。若業主習慣在招生季看「下一學年」，改 `ClassDistributionPanel.vue` 的 `schoolYear` 初值即可。
3. **班別是否排除已取消**：本計畫含已取消（看需求）。若要排除，後端 `class_distribution` 加 `VisitRequest.status != 'cancelled'`，單位文字改「不含已取消」。
