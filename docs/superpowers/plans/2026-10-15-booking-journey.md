# 預約全程漏斗與退出時點 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 招生入學 → 統計分析多一個子分頁「預約全程」：同一批預約案件從「預約 → 到場 → 有招生訪視 → 預繳 → 註冊」各階段的人數、比率與各段天數，以及家庭離開的時點（取消、沒來、未標記、參觀後未預繳、預繳後退出）。

**Architecture:** 新檔 `backend/app/admissions/journey.py` 分兩層：`compute_journey` 只吃整理好的案件列（純函式，不碰資料庫），`query_journey` 負責查庫並整理成案件列；一支唯讀 API `GET /admin/admissions/journey`。前端新增 `JourneyTab.vue` 加三個區塊元件與 `journeyFormat.ts`，每個區塊各自一張 `StatsDimensionTable`。**不新增 migration**，所有時間取自既有欄位與事件表。

**Tech Stack:** FastAPI 0.136.1（釘版）、SQLAlchemy 2.0、PostgreSQL、pytest；Vue 3 + TypeScript + Element Plus、vitest；Playwright stack e2e；openapi-typescript 契約。

**Spec:** `docs/specs/2026-10-15-booking-journey-design.md`（使用者 10-15 核可，commit `8f25b487`）。基準 `origin/main` `7ae6de45`。

## 共通規則與指令

- 繁體中文（台灣用語），技術名詞與識別符保留原文；commit 訊息繁體中文、Conventional Commit，結尾加 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`；只 `git add` 你動到的檔案（不要 `git add .`、`-A`、`commit -a`）；不要 push。
- 顏色一律走 token（`var(--…)`），不寫 rgba／oklch／hex 字面值；不裝圖表套件；畫面不放開發輔助用字。
- 一次只跑一組測試（機器 8GB RAM）；子代理不跑後端全套 pytest、admin 全套 vitest、stack 全套（超過 10 分鐘會被 watchdog 殺，由控制者在 Task 7 背景分開跑）。
- worktree：`~/Repositories/ivy-website-wt/booking-journey-20261015`（分支 `feature/booking-journey-20261015`），以下指令都從它的根目錄出發。
- 後端測試指令（`<DB>` 用控制者備好的 `ivy_website_journey1015_test`，已升到 head）：
  `cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/<DB> WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen pytest -q -p no:cacheprovider <檔案或 node id>`（`WEBSITE_*` 必須逐一寫在同一行）。
- 前端指令：`cd admin; source ~/.nvm/nvm.sh; nvm use 22; npx vitest run <檔案>`、`npm run typecheck`（用分號串接，`source nvm.sh` 會 exit 3，不要用 `&&`）；高負載下遇到 `Test timed out in 5000ms` 加 `--testTimeout=60000` 重跑並在報告寫明。
- 契約：**不要用 `npm run contract:check`／`contract:generate`**（它們呼叫 `uv run`，會改到共用 venv）。用：
  `cd backend && env -i PATH="$PATH" HOME="$HOME" .venv/bin/python scripts/export_openapi.py --check && cd .. && node scripts/check-contract-types.mjs`；
  重新產生：`cd backend && env -i PATH="$PATH" HOME="$HOME" .venv/bin/python scripts/export_openapi.py && cd .. && source ~/.nvm/nvm.sh; npx openapi-typescript contracts/openapi.json -o contracts/generated/website-api.d.ts`。

## Global Constraints

（逐字取自規格；每個 task 都隱含這一節。）

- **一批家庭（J3）**：**預定參觀日**落在所選期間、且已過參觀時間的預約案件，一案一筆；官網預約與後台補登（電話、LINE、親自、外部）都算，來源可篩（全部／官網／後台補登），預設全部。
- **預定參觀日（J4）**：沿用單案列表「參觀日」的算法：有場次用場次日（取消的場次保留；改期過的用目前場次）；提早到場釋出場次者取最後一次 `completed` 事件的台北日；算不出來的案件不進批次，涵蓋說明另列筆數。
- **每案一類（J5）**：已到場（`completed`）、沒來（`no_show`）、已取消（`cancelled`）、時間已過未標記（`confirmed` 且場次已開始）；尚未到參觀時間（`confirmed` 且場次未開始）不納入。
- **有訪視（J6）**：已到場案件裡，`recruitment_visits.visit_request_id` 指到它的那一筆；沒有就是「已到場但沒有訪視」。
- **預繳、註冊、退出（J7）**：預繳過＝`has_deposit` 或 `withdrawn_at` 非空；註冊過＝`enrolled` 或 `withdrawn_from = 'enrolled'`；預繳後退出＝`withdrawn_at` 非空，分退預繳與退註冊；階段是「曾經到達」，所以註冊過 ⊂ 預繳過 ⊂ 有訪視 ⊂ 已到場 ⊂ 預約案件。（計畫裁定 P6 補強：預繳過也包含 `enrolled`。）
- **參觀後未預繳（J8）**：有訪視、沒預繳過、`withdrawn_at` 為空，依 `recruitment_visits.visit_date` 到今天的天數分「觀察中」（0–13 天）、「逾期」（14–89 天）、「冷名單」（90 天以上），互斥；14 與 90 沿用 `stats.py` 的 `DEFAULT_OVERDUE_DAYS`、`COLD_LEAD_DAYS`；不預測。
- **預繳日（J9）**：最後一筆 `deposit_added` 事件的台北日；沒有事件的案件不納入天數、另列筆數。
- **時點指標（J10）**：預約提前量＝預約送出日（`created_at` 台北日）到預定參觀日；取消時點＝取消日（`cancelled_at` 台北日）到預定參觀日；參觀到預繳＝`visit_date` 到預繳日；預繳到註冊＝預繳日到 `enrolled_on`；預繳到退出＝預繳日到 `withdrawn_at` 台北日。各給中位數與筆數；負值不納入天數、另列筆數。
- **取消時點分區（J11）**：當天、1 天前、2–3 天前、4–7 天前、超過 7 天前，另有「參觀日之後才取消」；家長與園方分開（`cancel_reason`：`parent`、`staff`，其餘為其他）。
- **比率（J12）**：到場率＝到場÷（到場＋沒來）；取消率＝取消÷預約案件；有訪視比例＝有訪視÷已到場；預繳率＝預繳過÷有訪視；註冊率＝註冊過÷預繳過；預繳後退出比例＝退出÷預繳過；每個比率附分子分母，分母 0 回 null；畫面分母不足 20 標「樣本較少」。
- **API（J13）**：`GET /admin/admissions/journey`；參數 `campus_key`、`from`、`to`（台北日，含）、`source`（`all`｜`web`｜`assisted`，預設 `all`）；權限 `admissions.read` 加校區範圍；招生功能關閉回 404；`to` 超過今天截到今天；期間超過 400 天或 `from > to` 回 422；不寫稽核、不寫任何資料。
- **畫面（J14）**：統計分析子分頁「預約全程」（排在「參觀預約」後面）；期間預設最近 3 個月；校區沿用頁首；學年學期下拉在這頁停用；期間、來源進網址；四塊（摘要句、全程漏斗、家庭在哪裡離開、各段要花多久）；每個區塊的表各自一張 `StatsDimensionTable`（不嵌套）；CSS 長條。
- **涵蓋說明（J15）**：回傳並顯示：期間內沒有預約案件的訪視筆數、已到場但沒有訪視的筆數、預定參觀日算不出來的案件筆數；不受 `source` 篩選影響。
- **匿名化（J16）**：已匿名化的預約與訪視照算。
- **不做（§1.3）**：預測與評分；退出原因統計；首次聯絡延遲與聯絡紀錄分析；預約提前量與額滿的關係；跨校合併；補欄位或回補舊資料；公開官網顯示；匯出含個資。
- **不新增 migration**；唯讀；不寫稽核。

## 計畫裁定（Plan Rulings）

| # | 裁定 | 理由 |
|---|---|---|
| P1 | 摘要句直接放在 `JourneyTab.vue`（一個 `<p>`），不另開 `JourneySummary.vue`；區塊元件是三個（`JourneyFunnel`、`JourneyExits`、`JourneyTiming`） | 摘要句只是一個計算出來的字串，獨立成元件沒有邊界可言；規格 §3.3 寫的是四塊內容，不是四個檔案 |
| P2 | 預定參觀日算不出來的案件（沒有場次也沒有 `completed` 事件）無法歸到期間，改以**預約送出日（台北日）落在期間內**的才計入 `coverage.undated_cases`，且不進批次 | 規格 J4 說「另列筆數」但沒定義怎麼決定屬於哪個期間；用送出日是最保守的錨點，只影響這一個筆數 |
| P3 | `to` 截到今天之後若 `from > to`（例如整段在未來）回 422 `INVALID_DATE_RANGE`；回應的 `filters.date_to` 是截過的日期 | 規格 J13「to 超過今天就截到今天；from > to 回 422」的直接推論 |
| P4 | 「每案一類」的 SQL CASE 直接 import `booking_outcomes_service._outcome`（私有函式）而不複製 | 規格 J5 要求與預約結果分類完全一致；複製會在日後兩邊漂移。該檔的 `OUTCOMES` 常數另含 `upcoming`，在 Python 端丟掉 |
| P5 | 預定參觀日的 SQL（場次日期 coalesce 提早到場的最後一次 `completed` 事件台北日）照抄 `booking/routes.py` 的 `_visited_on_column`，不 import（它在路由模組裡，且綁了列表查詢） | 規格 J4 要求與列表一致；用測試釘住提早到場案例 |
| P6 | 預繳過定義加上 `enrolled`：`has_deposit` 或 `enrolled` 或 `withdrawn_at` 非空 | 規格 J7 要求「註冊過 ⊂ 預繳過」，若資料裡出現 `enrolled=true`、`has_deposit=false`（舊資料或事後修改），只用 `has_deposit` 會破壞不變式；T6 同步把規格 J7 補上 |
| P7 | 網址參數：`jp`（期間：`90`、`180`、`365`、`custom`，預設 `90` 不寫）、`jf`／`jt`（自訂區間，`YYYY-MM-DD`，只在 `jp=custom` 寫）、`js`（來源：`web`、`assisted`，`all` 不寫）；只在 `tab=stats&sub=journey` 時寫進網址、離開就拿掉 | 規格 J14 要求期間與來源進網址；比照 `area` 只在 records 有意義的作法；`useAdmissionsFilters` 的 `syncUrl` 會整個覆寫 query，所以必須在同一個 composable 裡管理 |
| P8 | e2e 用校區 `renwu`，種子用固定標記（家長姓名「E2E旅程」開頭）寫庫，測試結束（含失敗）一律清除 | 其他 spec 不在 `renwu` 建預約或訪視；`admissions-area.spec.ts` 只在自己的案例裡暫時改 `renwu` 的地址，兩者在 `workers: 1` 下不會同時發生；清除避免汙染後面的 spec |
| P9 | 預約提前量用所有批次案件（含取消、沒來）；中位數到小數一位（`round(x, 1)`），畫面整數不寫小數 | 取消的案件也有提前量；中位數可能是 x.5 |
| P10 | `deposit_to_withdrawn` 只給合計（退預繳與退註冊合在一起）一組天數，不分開 | 退出人數少，分開只會讓每格更小；規格 §3.2 的回傳本來就只有一組 |

## Review Focus

（規格沒有直接說、但最可能咬到使用者的情況；每一條都有 task 內的測試釘住。）

1. **台北日界線**：UTC 16:00 之後的時間（例如 `created_at`、`cancelled_at`、`deposit_added` 在 UTC 16:30＝台北隔天 00:30）算錯一天，會讓提前量、取消時點、預繳天數全部差一天。→ Task 2 `test_taipei_day_boundary`。
2. **批次邊界與已過參觀時間**：預定參觀日剛好等於 `from`／`to`、今天已開始但沒標記（算未標記）與今天還沒開始（不納入）、`to` 在未來被截到今天。→ Task 2 `test_cohort_boundaries_are_inclusive`、`test_unmarked_today_and_upcoming_today`、`test_to_is_clamped_to_today`。
3. **連結不對稱**：訪視連到批次外的預約不該出現；已到場但沒有訪視、手動新增的訪視只進涵蓋說明；匿名化案件照算。→ Task 2 `test_visit_of_a_request_outside_the_period_is_not_counted`、`test_funnel_through_linked_visits`、`test_anonymized_cases_are_counted`。
4. **提早到場與改期**：提早到場釋出場次的案件預定參觀日取標記當天；改期過的案件算最後場次日且計入改期數。→ Task 2 `test_early_complete_uses_the_completion_day`、`test_rescheduled_case_uses_the_current_slot`。
5. **不變式在奇怪資料下仍成立**：`enrolled=true` 但 `has_deposit=false`、已退出但 `has_deposit=false`、預繳過卻沒有 `deposit_added` 事件、負的天數。→ Task 1 `test_invariants_hold_for_every_combination`、`test_negative_and_missing_times_are_excluded_not_hidden`。
6. **空批次與小樣本**：沒有任何案件、全部取消、分母不足 20。→ Task 1 `test_empty_cohort`；Task 3／4 的格式與元件測試。
7. **手機寬度**：390px 表格與期間控制不撐出頁面。→ Task 5 e2e。

## File Structure

後端
- Create `backend/app/admissions/journey.py`：`CaseInfo`／`VisitInfo`、`compute_journey`（Task 1）；`load_cases`、`count_visits_without_request`、`query_journey`（Task 2）。
- Modify `backend/app/admissions/schemas.py`：`JourneyOut` 與子模型（Task 2）。
- Modify `backend/app/admissions/routes.py`：`GET /admin/admissions/journey`（Task 2）。
- Create `backend/tests/test_admissions_journey_calc.py`（Task 1）、`backend/tests/test_admissions_journey.py`（Task 2）。
- Modify `contracts/openapi.json`、`contracts/generated/website-api.d.ts`（重新產生）。

前端（`admin/src/`）
- Create `admissions/journeyFormat.ts`（篩選型別與網址編解碼、各表的列、摘要句）。
- Modify `api/admissions.ts`（`getJourney`）、`api/types.ts`（型別）、`admissions/useAdmissionsFilters.ts`（`journey` 狀態與網址）、`components/admissions/StatsTab.vue`（子分頁）、`views/AdmissionsView.vue`（學年學期下拉停用、傳 `journey`）。
- Create `components/admissions/JourneyTab.vue`、`JourneyFunnel.vue`、`JourneyExits.vue`、`JourneyTiming.vue`。
- Modify `__tests__/admissionsTestKit.ts`（`journeyData`）、`__tests__/admissionsView.test.ts`、`__tests__/statsTab.test.ts`；Create `__tests__/journeyFormat.test.ts`、`__tests__/journeyTab.test.ts`。

e2e／文件
- Modify `tests/stack/db.ts`（`seedJourney`、`clearJourney`）；Create `tests/stack/admissions-journey.spec.ts`。
- Modify `DESIGN.md`、`README.md`、`docs/specs/2026-10-15-booking-journey-design.md`。

## Task 0：環境（控制者先備，不交給實作者）

- [ ] **Step 1：補 sparse checkout 與依賴**

```bash
cd ~/Repositories/ivy-website-wt/booking-journey-20261015
git sparse-checkout set docs backend admin web contracts tests deploy scripts
git checkout -q
source ~/.nvm/nvm.sh; nvm use 22
npm ci; (cd admin && npm ci); (cd web && npm ci)
(cd backend && uv sync --frozen)
```

- [ ] **Step 2：建測試庫並升到 head**（注意 `WEBSITE_TEST_DATABASE_URL` 也要給，否則 alembic 在 test 環境會報錯）

```bash
createdb ivy_website_journey1015_test
createdb ivy_website_journey1015_e2e_test
cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_journey1015_test WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_journey1015_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen alembic upgrade head
```

預期：`alembic heads` 單一 head `c6a9e3f15d27`。e2e 使用 `E2E_DB_NAME=ivy_website_journey1015_e2e_test E2E_API_PORT=8744 E2E_WEB_PORT=3744`。

---

### Task 1：彙整核心 `compute_journey`（純函式）

**Files:**
- Create: `backend/app/admissions/journey.py`
- Test: `backend/tests/test_admissions_journey_calc.py`

**Interfaces:**
- Consumes：`app.admissions.stats.pct`、`COLD_LEAD_DAYS`、`DEFAULT_OVERDUE_DAYS`。
- Produces（Task 2、3 依賴）：
  - `journey.SOURCES: tuple[str, ...]`、`OUTCOMES`、`CANCEL_GROUPS`、`CANCEL_BUCKETS`。
  - `journey.VisitInfo(visit_date, has_deposit, enrolled, enrolled_on, withdrawn_on, withdrawn_from, deposit_on)`（frozen dataclass，日期欄位都是台北日 `date`）。
  - `journey.CaseInfo(source, outcome, created_on, visited_on, cancelled_on, cancel_reason, rescheduled, visit)`（frozen dataclass；`outcome` 是 `completed`｜`no_show`｜`cancelled`｜`awaiting_attendance`；`visited_on` 必填）。
  - `journey.compute_journey(cases, *, today, visits_without_request, undated_cases) -> dict`，回傳鍵：`cases`、`visit_outcomes`、`admissions`、`rates`、`timing`、`rescheduled`、`coverage`（內容見 Step 3 的程式碼與測試）。

- [ ] **Step 1：寫測試（先紅）**

新檔 `backend/tests/test_admissions_journey_calc.py`：

```python
"""預約全程漏斗的彙整核心（2026-10-15 預約全程規格 §3.1、§3.2）：純函式，不碰資料庫。

情境表（13 筆，今天 2026-10-15）：期望值都是手算的，改程式前先確認是規格變了。"""

from __future__ import annotations

from datetime import date, timedelta
from itertools import product

import pytest

from app.admissions.journey import CANCEL_BUCKETS, CaseInfo, VisitInfo, compute_journey

TODAY = date(2026, 10, 15)


def d(month: int, day: int) -> date:
    return date(2026, month, day)


def visit(
    visit_date: date, *, deposit: bool = False, deposit_on: date | None = None, enrolled: bool = False,
    enrolled_on: date | None = None, withdrawn_on: date | None = None, withdrawn_from: str | None = None,
) -> VisitInfo:
    return VisitInfo(
        visit_date=visit_date, has_deposit=deposit, enrolled=enrolled, enrolled_on=enrolled_on,
        withdrawn_on=withdrawn_on, withdrawn_from=withdrawn_from, deposit_on=deposit_on,
    )


def case(
    outcome: str, *, source: str = "web", created: date, visited: date, cancelled_on: date | None = None,
    cancel_reason: str | None = None, rescheduled: bool = False, linked: VisitInfo | None = None,
) -> CaseInfo:
    return CaseInfo(
        source=source, outcome=outcome, created_on=created, visited_on=visited, cancelled_on=cancelled_on,
        cancel_reason=cancel_reason, rescheduled=rescheduled, visit=linked,
    )


def scenario() -> list[CaseInfo]:
    return [
        # 1 到場、預繳、註冊
        case("completed", created=d(9, 1), visited=d(9, 8),
             linked=visit(d(9, 8), deposit=True, deposit_on=d(9, 20), enrolled=True, enrolled_on=d(10, 1))),
        # 2 到場、預繳、之後退預繳
        case("completed", created=d(9, 5), visited=d(9, 10),
             linked=visit(d(9, 10), deposit=True, deposit_on=d(9, 15), withdrawn_on=d(9, 30), withdrawn_from="deposited")),
        # 3 到場、沒預繳、參觀後 33 天（逾期）
        case("completed", source="phone", created=d(9, 10), visited=d(9, 12), linked=visit(d(9, 12))),
        # 4 到場、沒預繳、參觀後 7 天（觀察中）
        case("completed", source="line", created=d(10, 1), visited=d(10, 8), linked=visit(d(10, 8))),
        # 5 到場、沒預繳、參觀後 127 天（冷名單）
        case("completed", created=d(6, 1), visited=d(6, 10), linked=visit(d(6, 10))),
        # 6 到場但沒有招生訪視
        case("completed", created=d(9, 20), visited=d(9, 25)),
        # 7 沒來
        case("no_show", created=d(9, 18), visited=d(9, 24)),
        # 8 家長取消（參觀當天）
        case("cancelled", created=d(9, 1), visited=d(9, 20), cancelled_on=d(9, 20), cancel_reason="parent"),
        # 9 園方取消（7 天前）
        case("cancelled", source="phone", created=d(9, 2), visited=d(9, 22), cancelled_on=d(9, 15), cancel_reason="staff"),
        # 10 取消原因沒記（參觀日之後才取消）
        case("cancelled", created=d(9, 3), visited=d(9, 23), cancelled_on=d(9, 30), cancel_reason=None),
        # 11 時間已過未標記
        case("awaiting_attendance", created=d(10, 1), visited=d(10, 10)),
        # 12 到場、預繳過但沒有預繳事件（缺預繳日）
        case("completed", source="walk_in", created=d(9, 25), visited=d(9, 26), linked=visit(d(9, 26), deposit=True)),
        # 13 改過期、到場、預繳、註冊、之後退註冊
        case("completed", created=d(9, 28), visited=d(10, 1), rescheduled=True,
             linked=visit(d(10, 1), deposit=True, deposit_on=d(10, 3), enrolled=True, enrolled_on=d(10, 5),
                          withdrawn_on=d(10, 10), withdrawn_from="enrolled")),
    ]


def run(cases, *, without_request: int = 4, undated: int = 2) -> dict:
    return compute_journey(cases, today=TODAY, visits_without_request=without_request, undated_cases=undated)


def test_scenario_counts():
    result = run(scenario())
    assert result["cases"] == {"total": 13, "by_source": {"web": 9, "phone": 2, "line": 1, "walk_in": 1, "external": 0}}
    assert result["visit_outcomes"] == {
        "completed": 8, "no_show": 1, "cancelled": {"total": 3, "parent": 1, "staff": 1, "other": 1}, "unmarked": 1,
    }
    assert result["admissions"] == {
        "with_visit": 7, "completed_without_visit": 1, "deposited": 4, "enrolled": 2,
        "withdrawn": {"total": 2, "from_deposit": 1, "from_enrolled": 1},
        "not_deposited": {"observing": 1, "overdue": 1, "cold": 1},
    }
    assert result["rescheduled"] == {"cases": 1, "total": 13}
    assert result["coverage"] == {"visits_without_request": 4, "completed_without_visit": 1, "undated_cases": 2}


def test_scenario_rates_carry_numerator_and_denominator():
    rates = {rate["key"]: rate for rate in run(scenario())["rates"]}
    assert list(rates) == ["attendance", "cancel", "with_visit", "deposit", "enrolled", "withdrawn"]
    assert rates["attendance"] == {"key": "attendance", "numerator": 8, "denominator": 9, "pct": 88.9}
    assert rates["cancel"] == {"key": "cancel", "numerator": 3, "denominator": 13, "pct": 23.1}
    assert rates["with_visit"] == {"key": "with_visit", "numerator": 7, "denominator": 8, "pct": 87.5}
    assert rates["deposit"] == {"key": "deposit", "numerator": 4, "denominator": 7, "pct": 57.1}
    assert rates["enrolled"] == {"key": "enrolled", "numerator": 2, "denominator": 4, "pct": 50.0}
    assert rates["withdrawn"] == {"key": "withdrawn", "numerator": 2, "denominator": 4, "pct": 50.0}


def test_scenario_timing():
    timing = run(scenario())["timing"]
    # 提前量（參觀日 − 送出日）：1,2,3,5,5,6,7,7,9,9,19,20,20 → 中位數 7。
    assert timing["lead_days"] == {"median": 7.0, "n": 13, "excluded": 0}
    # 取消時點：8 當天（家長）、9 距 7 天（園方）、10 參觀日之後（其他）。
    zero = dict.fromkeys(CANCEL_BUCKETS, 0)
    assert timing["cancel_before_visit"] == {
        "n": 3, "excluded": 0,
        "parent": {**zero, "same_day": 1}, "staff": {**zero, "days_4_7": 1}, "other": {**zero, "after_visit": 1},
    }
    # 參觀→預繳：1 是 12、2 是 5、13 是 2（12 沒有預繳事件，另列 1 筆）。
    assert timing["visit_to_deposit"] == {"median": 5.0, "n": 3, "excluded": 1}
    # 預繳→註冊：1 是 11、13 是 2 → 中位數 6.5。
    assert timing["deposit_to_enrolled"] == {"median": 6.5, "n": 2, "excluded": 0}
    # 預繳→退出：2 是 15、13 是 7 → 11.0。
    assert timing["deposit_to_withdrawn"] == {"median": 11.0, "n": 2, "excluded": 0}


@pytest.mark.parametrize(
    ("age_days", "bucket"),
    [(0, "observing"), (13, "observing"), (14, "overdue"), (89, "overdue"), (90, "cold"), (400, "cold")],
)
def test_waiting_for_deposit_splits_at_14_and_90_days(age_days, bucket):
    visited = TODAY - timedelta(days=age_days)
    result = run([case("completed", created=visited - timedelta(days=3), visited=visited, linked=visit(visited))])
    waiting = result["admissions"]["not_deposited"]
    assert waiting[bucket] == 1 and sum(waiting.values()) == 1


@pytest.mark.parametrize(
    ("days_before", "bucket"),
    [(-1, "after_visit"), (0, "same_day"), (1, "day_1"), (2, "days_2_3"), (3, "days_2_3"), (4, "days_4_7"), (7, "days_4_7"), (8, "days_8_plus")],
)
def test_cancel_buckets_edges(days_before, bucket):
    visited = d(9, 20)
    result = run([case("cancelled", created=d(9, 1), visited=visited, cancelled_on=visited - timedelta(days=days_before), cancel_reason="parent")])
    counts = result["timing"]["cancel_before_visit"]["parent"]
    assert counts[bucket] == 1 and sum(counts.values()) == 1


def test_negative_and_missing_times_are_excluded_not_hidden():
    cases = [
        # 送出日比參觀日晚（補登順序造成）：提前量不納入。
        case("completed", created=d(9, 12), visited=d(9, 10), linked=visit(d(9, 10), deposit=True, deposit_on=d(9, 5))),
        # 取消但沒有取消時間。
        case("cancelled", created=d(9, 1), visited=d(9, 10), cancelled_on=None, cancel_reason="staff"),
        # 註冊了但缺註冊日。
        case("completed", created=d(9, 1), visited=d(9, 2),
             linked=visit(d(9, 2), deposit=True, deposit_on=d(9, 4), enrolled=True, enrolled_on=None)),
    ]
    timing = run(cases)["timing"]
    assert timing["lead_days"] == {"median": 5.0, "n": 2, "excluded": 1}  # c2 九天、c3 一天；c1 倒置不納入
    assert timing["cancel_before_visit"]["n"] == 0 and timing["cancel_before_visit"]["excluded"] == 1
    assert timing["visit_to_deposit"] == {"median": 2.0, "n": 1, "excluded": 1}  # 第一筆的預繳日早於參觀日：負值不納入
    assert timing["deposit_to_enrolled"] == {"median": None, "n": 0, "excluded": 1}


def test_empty_cohort():
    result = run([], without_request=0, undated=0)
    assert result["cases"] == {"total": 0, "by_source": {"web": 0, "phone": 0, "line": 0, "walk_in": 0, "external": 0}}
    assert all(rate["pct"] is None and rate["denominator"] == 0 for rate in result["rates"])
    assert result["timing"]["lead_days"] == {"median": None, "n": 0, "excluded": 0}
    assert result["rescheduled"] == {"cases": 0, "total": 0}


def test_unknown_outcome_is_a_bug_not_a_silent_miscount():
    with pytest.raises(ValueError):
        run([case("upcoming", created=d(10, 1), visited=d(10, 20))])


def _visit_variants() -> list[VisitInfo | None]:
    """涵蓋各種奇怪組合：預繳旗標、註冊旗標、退出、缺預繳日。"""
    variants: list[VisitInfo | None] = [None]
    for deposit, enrolled, withdrawn_from in product((False, True), (False, True), (None, "deposited", "enrolled")):
        for deposit_on in (None, d(9, 12)):
            variants.append(
                visit(
                    d(9, 10), deposit=deposit, deposit_on=deposit_on, enrolled=enrolled,
                    enrolled_on=d(9, 20) if enrolled else None,
                    withdrawn_on=d(9, 25) if withdrawn_from else None, withdrawn_from=withdrawn_from,
                )
            )
    return variants


def test_invariants_hold_for_every_combination():
    cases = [
        case(outcome, created=d(9, 1), visited=d(9, 10), cancelled_on=d(9, 8) if outcome == "cancelled" else None,
             cancel_reason="parent" if outcome == "cancelled" else None,
             linked=linked if outcome == "completed" else None)
        for outcome in ("completed", "no_show", "cancelled", "awaiting_attendance")
        for linked in _visit_variants()
    ]
    result = run(cases)
    total = result["cases"]["total"]
    outcomes, adm = result["visit_outcomes"], result["admissions"]
    waiting = adm["not_deposited"]
    # (a)
    assert total == outcomes["completed"] + outcomes["no_show"] + outcomes["cancelled"]["total"] + outcomes["unmarked"]
    # (b)
    assert outcomes["completed"] == adm["with_visit"] + adm["completed_without_visit"]
    # (c)
    assert adm["with_visit"] == adm["deposited"] + waiting["observing"] + waiting["overdue"] + waiting["cold"]
    # (d)
    assert total == (
        adm["deposited"] + outcomes["cancelled"]["total"] + outcomes["no_show"] + outcomes["unmarked"]
        + adm["completed_without_visit"] + waiting["observing"] + waiting["overdue"] + waiting["cold"]
    )
    # (e)
    assert adm["enrolled"] <= adm["deposited"] <= adm["with_visit"] <= outcomes["completed"]
    assert adm["withdrawn"]["total"] <= adm["deposited"]
    assert adm["withdrawn"]["total"] == adm["withdrawn"]["from_deposit"] + adm["withdrawn"]["from_enrolled"]
```

- [ ] **Step 2：跑測試確認紅**

```bash
cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_journey1015_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen pytest -q -p no:cacheprovider tests/test_admissions_journey_calc.py
```

預期：collection error（`ModuleNotFoundError: app.admissions.journey`）。

- [ ] **Step 3：實作**

新檔 `backend/app/admissions/journey.py`：

```python
"""預約全程漏斗與退出時點（2026-10-15 預約全程規格 §3）。

預約案件 → 到場 → 有招生訪視 → 預繳 → 註冊，以及家庭離開的時點。本檔分兩層：
- `compute_journey` 只吃整理好的案件列（`CaseInfo`／`VisitInfo`，日期都是台北日），純函式、不碰資料庫；
- 查庫與整理案件列在檔案後半（Task 2 加）。
一批家庭＝預定參觀日落在期間內、已過參觀時間的預約案件，一案一筆；所有階段都從同一批往下數，所以數字
只會遞減。只描述過去，不預測。"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from statistics import median
from typing import Any

from app.admissions.stats import COLD_LEAD_DAYS, DEFAULT_OVERDUE_DAYS, pct

SOURCES = ("web", "phone", "line", "walk_in", "external")
# 預約結果的四類（尚未到參觀時間的 upcoming 在查庫時就丟掉，不會進來）。
OUTCOMES = ("completed", "no_show", "cancelled", "awaiting_attendance")
CANCEL_GROUPS = ("parent", "staff", "other")
# 取消日距預定參觀日：after_visit＝參觀日之後才取消（園方事後取消）。
CANCEL_BUCKETS = ("after_visit", "same_day", "day_1", "days_2_3", "days_4_7", "days_8_plus")


@dataclass(frozen=True)
class VisitInfo:
    """連到預約的招生訪視。日期都是台北日；deposit_on 是最後一筆 deposit_added 的台北日（沒有事件是 None）。"""

    visit_date: date
    has_deposit: bool
    enrolled: bool
    enrolled_on: date | None
    withdrawn_on: date | None
    withdrawn_from: str | None
    deposit_on: date | None

    @property
    def deposited(self) -> bool:
        # 預繳過：目前已預繳、已註冊、或已退出（退出的一定預繳過；註冊的一定預繳過，舊資料可能沒有旗標）。
        return self.has_deposit or self.enrolled or self.withdrawn_on is not None

    @property
    def ever_enrolled(self) -> bool:
        return self.enrolled or self.withdrawn_from == "enrolled"


@dataclass(frozen=True)
class CaseInfo:
    source: str
    outcome: str
    created_on: date
    visited_on: date
    cancelled_on: date | None
    cancel_reason: str | None
    rescheduled: bool
    visit: VisitInfo | None


def _rate(key: str, numerator: int, denominator: int) -> dict[str, Any]:
    return {"key": key, "numerator": numerator, "denominator": denominator, "pct": pct(numerator, denominator)}


def _days(values: list[int], excluded: int) -> dict[str, Any]:
    return {"median": round(float(median(values)), 1) if values else None, "n": len(values), "excluded": excluded}


def _cancel_bucket(days_before: int) -> str:
    if days_before < 0:
        return "after_visit"
    if days_before == 0:
        return "same_day"
    if days_before == 1:
        return "day_1"
    if days_before <= 3:
        return "days_2_3"
    if days_before <= 7:
        return "days_4_7"
    return "days_8_plus"


def _gap(start: date | None, end: date | None, values: list[int]) -> bool:
    """end − start 的天數加進 values；缺日期或負值回 True（呼叫端記成「不納入」）。"""
    if start is None or end is None:
        return True
    days = (end - start).days
    if days < 0:
        return True
    values.append(days)
    return False


def compute_journey(
    cases: list[CaseInfo], *, today: date, visits_without_request: int, undated_cases: int
) -> dict[str, Any]:
    by_source = dict.fromkeys(SOURCES, 0)
    outcomes = dict.fromkeys(OUTCOMES, 0)
    cancelled = dict.fromkeys(CANCEL_GROUPS, 0)
    waiting = {"observing": 0, "overdue": 0, "cold": 0}
    withdrawn = {"from_deposit": 0, "from_enrolled": 0}
    with_visit = deposited = enrolled = without_visit = rescheduled = 0
    lead: list[int] = []
    lead_excluded = 0
    cancel_counts = {group: dict.fromkeys(CANCEL_BUCKETS, 0) for group in CANCEL_GROUPS}
    cancel_n = cancel_excluded = 0
    to_deposit: list[int] = []
    to_deposit_excluded = 0
    to_enrolled: list[int] = []
    to_enrolled_excluded = 0
    to_withdrawn: list[int] = []
    to_withdrawn_excluded = 0

    for item in cases:
        if item.outcome not in outcomes:
            raise ValueError(f"不認得的預約結果：{item.outcome}")
        by_source[item.source] = by_source.get(item.source, 0) + 1
        outcomes[item.outcome] += 1
        if item.rescheduled:
            rescheduled += 1
        lead_excluded += _gap(item.created_on, item.visited_on, lead)
        if item.outcome == "cancelled":
            group = item.cancel_reason if item.cancel_reason in ("parent", "staff") else "other"
            cancelled[group] += 1
            if item.cancelled_on is None:
                cancel_excluded += 1
            else:
                cancel_counts[group][_cancel_bucket((item.visited_on - item.cancelled_on).days)] += 1
                cancel_n += 1
        if item.outcome != "completed":
            continue
        found = item.visit
        if found is None:
            without_visit += 1
            continue
        with_visit += 1
        if found.deposited:
            deposited += 1
            to_deposit_excluded += _gap(found.visit_date, found.deposit_on, to_deposit)
        else:
            age = (today - found.visit_date).days
            waiting["cold" if age >= COLD_LEAD_DAYS else "overdue" if age >= DEFAULT_OVERDUE_DAYS else "observing"] += 1
        if found.ever_enrolled:
            enrolled += 1
            to_enrolled_excluded += _gap(found.deposit_on, found.enrolled_on, to_enrolled)
        if found.withdrawn_on is not None:
            withdrawn["from_enrolled" if found.withdrawn_from == "enrolled" else "from_deposit"] += 1
            to_withdrawn_excluded += _gap(found.deposit_on, found.withdrawn_on, to_withdrawn)

    total = len(cases)
    marked = outcomes["completed"] + outcomes["no_show"]
    withdrawn_total = withdrawn["from_deposit"] + withdrawn["from_enrolled"]
    return {
        "cases": {"total": total, "by_source": by_source},
        "visit_outcomes": {
            "completed": outcomes["completed"],
            "no_show": outcomes["no_show"],
            "cancelled": {"total": outcomes["cancelled"], **cancelled},
            "unmarked": outcomes["awaiting_attendance"],
        },
        "admissions": {
            "with_visit": with_visit,
            "completed_without_visit": without_visit,
            "deposited": deposited,
            "enrolled": enrolled,
            "withdrawn": {"total": withdrawn_total, **withdrawn},
            "not_deposited": waiting,
        },
        "rates": [
            _rate("attendance", outcomes["completed"], marked),
            _rate("cancel", outcomes["cancelled"], total),
            _rate("with_visit", with_visit, outcomes["completed"]),
            _rate("deposit", deposited, with_visit),
            _rate("enrolled", enrolled, deposited),
            _rate("withdrawn", withdrawn_total, deposited),
        ],
        "timing": {
            "lead_days": _days(lead, lead_excluded),
            "cancel_before_visit": {"n": cancel_n, "excluded": cancel_excluded, **cancel_counts},
            "visit_to_deposit": _days(to_deposit, to_deposit_excluded),
            "deposit_to_enrolled": _days(to_enrolled, to_enrolled_excluded),
            "deposit_to_withdrawn": _days(to_withdrawn, to_withdrawn_excluded),
        },
        "rescheduled": {"cases": rescheduled, "total": total},
        "coverage": {
            "visits_without_request": visits_without_request,
            "completed_without_visit": without_visit,
            "undated_cases": undated_cases,
        },
    }
```

- [ ] **Step 4：跑測試確認綠、跑 ruff**

```bash
cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_journey1015_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen pytest -q -p no:cacheprovider tests/test_admissions_journey_calc.py
uv run --frozen ruff check app/admissions/journey.py tests/test_admissions_journey_calc.py
```

預期：全部通過、ruff 無錯誤。若有案例的數字與手算不同，先檢查程式與輸入，不要改期望值；真的是計畫算錯就回報 NEEDS_CONTEXT。

- [ ] **Step 5：Commit**

```bash
git add backend/app/admissions/journey.py backend/tests/test_admissions_journey_calc.py
git commit -m "feat(admissions): 預約全程漏斗的彙整核心（階段、比率、各段天數、離開時點）

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2：查庫、schema、API 與契約

**Files:**
- Modify: `backend/app/admissions/journey.py`（加查庫函式）、`backend/app/admissions/schemas.py`、`backend/app/admissions/routes.py`
- Test: `backend/tests/test_admissions_journey.py`
- Regenerate: `contracts/openapi.json`、`contracts/generated/website-api.d.ts`

**Interfaces:**
- Consumes（Task 1）：`CaseInfo`、`VisitInfo`、`compute_journey`、`SOURCES`；既有：`app.operations.booking_outcomes_service._outcome(now)`、`app.booking.models`（`VisitRequest`、`VisitSlot`、`VisitRequestEvent`、`VisitRequestStatus`）、`app.admissions.models`（`RecruitmentVisit`、`RecruitmentEventLog`）、`app.common.timezones`（`OPERATING_TZ`、`now_utc`、`today_local`）。
- Produces（Task 3、5 依賴）：
  - `journey.query_journey(db, campus_key, date_from, date_to, source, now=None) -> dict`（`source` 是 `all`｜`web`｜`assisted`），回傳 `{"filters": {campus_key, date_from, date_to, source}, "as_of", **compute_journey(...)}`。
  - `GET /admin/admissions/journey?campus_key=&from=&to=&source=` → `JourneyOut`（欄位見 Step 3 的 schema）；`JOURNEY_MAX_DAYS = 400`。
  - 契約型別 `components['schemas']['JourneyOut']`（Task 3 匯出為 `AdmissionsJourney`）。

- [ ] **Step 1：寫測試（先紅）**

新檔 `backend/tests/test_admissions_journey.py`：

```python
"""預約全程漏斗 API 與查庫（2026-10-15 預約全程規格 §3、§4）。

種子直接寫庫：預約案件、場次、事件、招生訪視與預繳事件都能指定時間。固定「現在」是 2026-10-15 12:00（台北），
service 層測試傳 `now`；API 層測試用相對今天的日期。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.admissions import journey
from app.admissions.academic import roc_month
from app.admissions.models import RecruitmentEventLog, RecruitmentVisit
from app.booking.models import VisitRequest, VisitRequestEvent, VisitSlot
from app.common.timezones import OPERATING_TZ, today_local
from app.main import create_app
from app.operations.models import AuditLogEntry
from tests.admissions_helpers import readonly_yihua_client, reception_yihua_client  # noqa: F401
from tests.conftest import _logged_in_client, _test_settings

API = "/api/website/v1"
JOURNEY = f"{API}/admin/admissions/journey"
NOW = datetime(2026, 10, 15, 4, 0, tzinfo=timezone.utc)  # 台北 12:00
TODAY = date(2026, 10, 15)


def at(day: date, hour: int = 12, minute: int = 0) -> datetime:
    """台北牆上時間 → aware UTC。"""
    return datetime.combine(day, time(hour, minute), tzinfo=OPERATING_TZ).astimezone(timezone.utc)


def d(month: int, day: int) -> date:
    return date(2026, month, day)


async def add_case(
    db, *, campus: str = "yihua", status: str = "completed", source: str = "web", slot_day: date | None, slot_hour: int = 10,
    created: datetime, cancelled_at: datetime | None = None, cancel_reason: str | None = None,
    events: list[tuple[str, datetime]] | None = None, anonymized: bool = False,
) -> uuid.UUID:
    slot_id = None
    if slot_day is not None:
        slot = VisitSlot(
            id=uuid.uuid4(), campus_key=campus, slot_date=slot_day, start_time=time(slot_hour, 0),
            end_time=time(slot_hour + 1, 0), capacity=99, closed=False, created_at=created,
        )
        db.add(slot)
        await db.flush()
        slot_id = slot.id
    request = VisitRequest(
        id=uuid.uuid4(), campus_key=campus, idempotency_key=f"journey-{uuid.uuid4().hex}", payload_hash="0" * 64,
        config_version=0, parent_name="測試家長", phone="0911000333", referral_sources=[], consent_given=True,
        status=status, source=source, slot_id=slot_id, cancelled_at=cancelled_at, cancel_reason=cancel_reason,
        anonymized_at=created if anonymized else None, created_at=created,
    )
    db.add(request)
    await db.flush()
    for event_type, when in events or []:
        db.add(VisitRequestEvent(id=uuid.uuid4(), visit_request_id=request.id, event_type=event_type, created_at=when))
    await db.flush()
    return request.id


async def add_visit(
    db, *, request_id: uuid.UUID | None, campus: str = "yihua", visit_date: date, deposit: bool = False,
    deposit_event: datetime | None = None, enrolled: bool = False, enrolled_on: date | None = None,
    withdrawn_at: datetime | None = None, withdrawn_from: str | None = None, anonymized: bool = False,
) -> RecruitmentVisit:
    visit = RecruitmentVisit(
        id=uuid.uuid4(), campus_key=campus, visit_request_id=request_id, month=roc_month(visit_date), seq_no=None,
        visit_date=visit_date, child_name="測試幼生", has_deposit=deposit, rides_bus=False, enrolled=enrolled,
        enrolled_on=enrolled_on, withdrawn_at=withdrawn_at, withdrawn_from=withdrawn_from,
        withdraw_reason="家長改送他校" if withdrawn_at else None, target_school_year=115, target_semester=1,
        version=1, anonymized_at=NOW if anonymized else None, created_at=NOW, updated_at=NOW,
    )
    db.add(visit)
    await db.flush()
    if deposit_event is not None:
        db.add(RecruitmentEventLog(
            id=uuid.uuid4(), recruitment_visit_id=visit.id, event_type="deposit_added", from_stage=None,
            to_stage="deposited", created_at=deposit_event,
        ))
        await db.flush()
    return visit


async def run(db, *, date_from=d(9, 1), date_to=d(10, 15), source="all", campus="yihua", now=NOW) -> dict:
    return await journey.query_journey(db, campus, date_from, date_to, source, now=now)


async def test_cohort_boundaries_are_inclusive(db_session):
    for day in (d(8, 31), d(9, 1), d(9, 30), d(10, 1)):
        await add_case(db_session, slot_day=day, created=at(day - timedelta(days=3)))
    await db_session.commit()
    result = await run(db_session, date_from=d(9, 1), date_to=d(9, 30))
    assert result["cases"]["total"] == 2
    assert result["filters"] == {"campus_key": "yihua", "date_from": d(9, 1), "date_to": d(9, 30), "source": "all"}


async def test_unmarked_today_and_upcoming_today(db_session):
    """今天 10:00 的場次現在（12:00）已開始、沒標記＝時間已過未標記；今天 15:00 還沒開始，不納入。"""
    await add_case(db_session, status="confirmed", slot_day=TODAY, slot_hour=10, created=at(d(10, 1)))
    await add_case(db_session, status="confirmed", slot_day=TODAY, slot_hour=15, created=at(d(10, 1)))
    await db_session.commit()
    result = await run(db_session, date_from=d(10, 1), date_to=TODAY)
    assert result["cases"]["total"] == 1
    assert result["visit_outcomes"]["unmarked"] == 1


async def test_early_complete_uses_the_completion_day(db_session):
    """提早到場、約之後的日子：場次被釋出（沒有場次），預定參觀日取最後一次 completed 事件的台北日（UTC 16:30＝隔天）。"""
    await add_case(
        db_session, slot_day=None, created=at(d(9, 1)), events=[("completed", datetime(2026, 9, 9, 16, 30, tzinfo=timezone.utc))],
    )
    await db_session.commit()
    inside = await run(db_session, date_from=d(9, 10), date_to=d(9, 10))
    assert inside["cases"]["total"] == 1
    assert (await run(db_session, date_from=d(9, 9), date_to=d(9, 9)))["cases"]["total"] == 0


async def test_rescheduled_case_uses_the_current_slot(db_session):
    await add_case(db_session, slot_day=d(9, 20), created=at(d(9, 1)), events=[("rescheduled", at(d(9, 5)))])
    await db_session.commit()
    assert (await run(db_session, date_from=d(9, 20), date_to=d(9, 20)))["cases"]["total"] == 1
    result = await run(db_session, date_from=d(9, 1), date_to=d(9, 19))
    assert result["cases"]["total"] == 0
    assert (await run(db_session, date_from=d(9, 1), date_to=d(9, 30)))["rescheduled"] == {"cases": 1, "total": 1}


async def test_taipei_day_boundary(db_session):
    """UTC 16:30 是台北隔天 00:30：提前量、取消時點、預繳天數都以台北日算。"""
    # 預約 09-07 UTC 16:30（台北 09-08 00:30），參觀 09-08 → 提前量 0 天，不是 −1 也不是 1。
    created = datetime(2026, 9, 7, 16, 30, tzinfo=timezone.utc)
    request = await add_case(db_session, slot_day=d(9, 8), created=created)
    # 預繳事件 09-20 UTC 16:30（台北 09-21）→ 參觀 09-08 後第 13 天。
    await add_visit(
        db_session, request_id=request, visit_date=d(9, 8), deposit=True,
        deposit_event=datetime(2026, 9, 20, 16, 30, tzinfo=timezone.utc),
    )
    # 取消：09-14 UTC 16:30（台北 09-15）、參觀 09-16 → 1 天前。
    await add_case(
        db_session, status="cancelled", slot_day=d(9, 16), created=at(d(9, 1)),
        cancelled_at=datetime(2026, 9, 14, 16, 30, tzinfo=timezone.utc), cancel_reason="parent",
    )
    await db_session.commit()
    timing = (await run(db_session))["timing"]
    # 兩筆：台北 00:30 送出、當天參觀＝0 天；09-01 送出、09-16 參觀＝15 天 → 中位數 7.5。
    assert timing["lead_days"] == {"median": 7.5, "n": 2, "excluded": 0}
    assert timing["visit_to_deposit"] == {"median": 13.0, "n": 1, "excluded": 0}
    assert timing["cancel_before_visit"]["parent"]["day_1"] == 1


async def test_source_filter(db_session):
    await add_case(db_session, source="web", slot_day=d(9, 10), created=at(d(9, 1)))
    await add_case(db_session, source="phone", slot_day=d(9, 11), created=at(d(9, 1)))
    await add_case(db_session, source="walk_in", slot_day=d(9, 12), created=at(d(9, 1)))
    await db_session.commit()
    assert (await run(db_session, source="all"))["cases"]["total"] == 3
    web = await run(db_session, source="web")
    assert (web["cases"]["total"], web["cases"]["by_source"]["web"]) == (1, 1)
    assisted = await run(db_session, source="assisted")
    assert assisted["cases"]["total"] == 2 and assisted["cases"]["by_source"]["web"] == 0


async def test_funnel_through_linked_visits(db_session):
    """預約 → 到場 → 訪視 → 預繳 → 註冊 / 退出，全部經由 visit_request_id。"""
    a = await add_case(db_session, slot_day=d(9, 8), created=at(d(9, 1)))
    await add_visit(db_session, request_id=a, visit_date=d(9, 8), deposit=True, deposit_event=at(d(9, 20)), enrolled=True, enrolled_on=d(10, 1))
    b = await add_case(db_session, slot_day=d(9, 10), created=at(d(9, 5)))
    await add_visit(
        db_session, request_id=b, visit_date=d(9, 10), deposit=True, deposit_event=at(d(9, 15)),
        withdrawn_at=at(d(9, 30)), withdrawn_from="deposited",
    )
    c = await add_case(db_session, slot_day=d(9, 12), created=at(d(9, 10)))
    await add_visit(db_session, request_id=c, visit_date=d(9, 12))  # 沒預繳，33 天 → 逾期
    await add_case(db_session, slot_day=d(9, 25), created=at(d(9, 20)))  # 到場但沒有訪視
    await add_case(db_session, status="no_show", slot_day=d(9, 24), created=at(d(9, 18)))
    await add_case(
        db_session, status="cancelled", slot_day=d(9, 20), created=at(d(9, 1)), cancelled_at=at(d(9, 13)), cancel_reason="staff",
    )
    await db_session.commit()
    result = await run(db_session)
    assert result["cases"]["total"] == 6
    assert result["visit_outcomes"] == {
        "completed": 4, "no_show": 1, "cancelled": {"total": 1, "parent": 0, "staff": 1, "other": 0}, "unmarked": 0,
    }
    assert result["admissions"] == {
        "with_visit": 3, "completed_without_visit": 1, "deposited": 2, "enrolled": 1,
        "withdrawn": {"total": 1, "from_deposit": 1, "from_enrolled": 0},
        "not_deposited": {"observing": 0, "overdue": 1, "cold": 0},
    }
    assert result["timing"]["visit_to_deposit"] == {"median": 8.5, "n": 2, "excluded": 0}
    assert result["timing"]["cancel_before_visit"]["staff"]["days_4_7"] == 1
    assert result["timing"]["deposit_to_enrolled"] == {"median": 11.0, "n": 1, "excluded": 0}
    assert result["timing"]["deposit_to_withdrawn"] == {"median": 15.0, "n": 1, "excluded": 0}


async def test_deposit_day_is_the_last_deposit_event(db_session):
    """同一個訪視有兩筆 deposit_added（先收一次、補收一次）：預繳日取最後一筆的台北日。"""
    request = await add_case(db_session, slot_day=d(9, 8), created=at(d(9, 1)))
    visit = await add_visit(db_session, request_id=request, visit_date=d(9, 8), deposit=True, deposit_event=at(d(9, 12)))
    db_session.add(RecruitmentEventLog(
        id=uuid.uuid4(), recruitment_visit_id=visit.id, event_type="deposit_added", from_stage=None, to_stage="deposited",
        created_at=at(d(9, 18)),
    ))
    # 預繳旗標開著、卻沒有任何 deposit_added 事件：算預繳過，天數另列。
    other = await add_case(db_session, slot_day=d(9, 9), created=at(d(9, 2)))
    await add_visit(db_session, request_id=other, visit_date=d(9, 9), deposit=True)
    await db_session.commit()
    result = await run(db_session)
    assert result["admissions"]["deposited"] == 2
    assert result["timing"]["visit_to_deposit"] == {"median": 10.0, "n": 1, "excluded": 1}


async def test_visit_of_a_request_outside_the_period_is_not_counted(db_session):
    inside = await add_case(db_session, slot_day=d(9, 10), created=at(d(9, 1)))
    outside = await add_case(db_session, slot_day=d(8, 1), created=at(d(7, 20)))
    await add_visit(db_session, request_id=inside, visit_date=d(9, 10), deposit=True, deposit_event=at(d(9, 12)))
    await add_visit(db_session, request_id=outside, visit_date=d(8, 1), deposit=True, deposit_event=at(d(8, 3)))
    await db_session.commit()
    result = await run(db_session, date_from=d(9, 1), date_to=d(9, 30))
    assert result["cases"]["total"] == 1
    assert result["admissions"]["with_visit"] == 1 and result["admissions"]["deposited"] == 1


async def test_coverage_lists_what_the_funnel_does_not_contain(db_session):
    # 沒有預約案件的訪視（手動新增、現場參觀）：visit_date 在期間內才算。
    await add_visit(db_session, request_id=None, visit_date=d(9, 5))
    await add_visit(db_session, request_id=None, visit_date=d(9, 6))
    await add_visit(db_session, request_id=None, visit_date=d(8, 1))  # 期間外
    # 已到場但沒有訪視。
    await add_case(db_session, slot_day=d(9, 10), created=at(d(9, 1)))
    # 預定參觀日算不出來（已到場、沒場次、沒有 completed 事件）：以送出日在期間內計入 undated，不進批次。
    await add_case(db_session, slot_day=None, created=at(d(9, 3)))
    await add_case(db_session, slot_day=None, created=at(d(8, 3)))  # 送出日在期間外：不計
    # 別校的資料不混進來。
    await add_visit(db_session, request_id=None, campus="minghua", visit_date=d(9, 5))
    await db_session.commit()
    result = await run(db_session, date_from=d(9, 1), date_to=d(9, 30))
    assert result["cases"]["total"] == 1
    assert result["coverage"] == {"visits_without_request": 2, "completed_without_visit": 1, "undated_cases": 1}


async def test_coverage_ignores_the_source_filter(db_session):
    await add_visit(db_session, request_id=None, visit_date=d(9, 5))
    await add_case(db_session, source="phone", slot_day=d(9, 10), created=at(d(9, 1)))
    await db_session.commit()
    result = await run(db_session, source="web")
    assert result["cases"]["total"] == 0
    assert result["coverage"]["visits_without_request"] == 1


async def test_anonymized_cases_are_counted(db_session):
    request = await add_case(db_session, slot_day=d(9, 10), created=at(d(9, 1)), anonymized=True)
    await add_visit(db_session, request_id=request, visit_date=d(9, 10), deposit=True, deposit_event=at(d(9, 14)), anonymized=True)
    await db_session.commit()
    result = await run(db_session)
    assert result["cases"]["total"] == 1 and result["admissions"]["deposited"] == 1
    assert result["timing"]["visit_to_deposit"]["median"] == 4.0


# ---- API ----


def api_range(days: int = 30) -> str:
    today = today_local()
    return f"from={today - timedelta(days=days)}&to={today}"


async def test_api_response_shape(admin_client, db_session):
    request = await add_case(db_session, slot_day=today_local() - timedelta(days=5), created=at(today_local() - timedelta(days=9)))
    await add_visit(db_session, request_id=request, visit_date=today_local() - timedelta(days=5))
    await db_session.commit()
    response = await admin_client.get(f"{JOURNEY}?campus_key=yihua&{api_range()}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == {"filters", "as_of", "cases", "visit_outcomes", "admissions", "rates", "timing", "rescheduled", "coverage"}
    assert body["filters"]["source"] == "all" and body["cases"]["total"] == 1
    assert [rate["key"] for rate in body["rates"]] == ["attendance", "cancel", "with_visit", "deposit", "enrolled", "withdrawn"]


async def test_to_is_clamped_to_today(admin_client):
    today = today_local()
    response = await admin_client.get(f"{JOURNEY}?campus_key=yihua&from={today - timedelta(days=10)}&to={today + timedelta(days=30)}")
    assert response.status_code == 200
    assert response.json()["filters"]["date_to"] == today.isoformat()


@pytest.mark.parametrize(
    "query",
    [
        "from=2026-10-10&to=2026-10-01",  # 開始晚於結束
        "from=2024-01-01&to=2026-01-01",  # 超過 400 天
        "from=2999-01-01&to=2999-02-01",  # 整段在未來：截到今天後 from > to
    ],
)
async def test_rejects_bad_ranges(admin_client, query):
    response = await admin_client.get(f"{JOURNEY}?campus_key=yihua&{query}")
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "INVALID_DATE_RANGE"


async def test_rejects_unknown_source(admin_client):
    assert (await admin_client.get(f"{JOURNEY}?campus_key=yihua&{api_range()}&source=hack")).status_code == 422


async def test_permissions(reception_yihua_client, readonly_yihua_client, minghua_client, editor_client, admin_client):
    path = f"{JOURNEY}?{api_range()}&campus_key="
    assert (await reception_yihua_client.get(path + "yihua")).status_code == 200
    assert (await reception_yihua_client.get(path + "minghua")).status_code == 404
    assert (await minghua_client.get(path + "yihua")).status_code == 404
    assert (await editor_client.get(path + "yihua")).status_code == 403
    assert (await readonly_yihua_client.get(path + "yihua")).status_code == 403
    assert (await admin_client.get(path + "nowhere")).status_code == 404


async def test_needs_login(public_client):
    assert (await public_client.get(f"{JOURNEY}?campus_key=yihua&{api_range()}")).status_code == 401


async def test_hidden_when_admissions_disabled(admin_client):
    disabled = create_app(_test_settings().model_copy(update={"admissions_enabled": False}))
    client = await _logged_in_client(disabled, "admin@ivy.example", "super-admin-password-123")
    try:
        assert (await client.get(f"{JOURNEY}?campus_key=yihua&{api_range()}")).status_code == 404
    finally:
        await client.aclose()
        await disabled.state.engine.dispose()
        await disabled.state.rate_limit_engine.dispose()


async def test_never_writes_audit_entries(admin_client, db_session):
    before = await db_session.scalar(select(func.count()).select_from(AuditLogEntry))
    await admin_client.get(f"{JOURNEY}?campus_key=yihua&{api_range()}")
    assert await db_session.scalar(select(func.count()).select_from(AuditLogEntry)) == before
```

- [ ] **Step 2：跑測試確認紅**

```bash
cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_journey1015_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen pytest -q -p no:cacheprovider tests/test_admissions_journey.py
```

預期：全部失敗（`journey.query_journey` 不存在、端點 404）。

- [ ] **Step 3：實作 schema**

`backend/app/admissions/schemas.py` 檔尾新增（`date`、`datetime`、`Literal`、`BaseModel` 檔案裡已經有就不要重複 import）：

```python
# ---- 預約全程漏斗（2026-10-15 預約全程規格 §3.2）----


class JourneyFiltersOut(BaseModel):
    campus_key: str
    date_from: date
    date_to: date
    source: Literal["all", "web", "assisted"]


class JourneyCasesOut(BaseModel):
    total: int
    # web／phone／line／walk_in／external 各幾筆（未知來源也會出現）。
    by_source: dict[str, int]


class JourneyCancelledOut(BaseModel):
    total: int
    parent: int
    staff: int
    # hold_expired 與沒記取消者。
    other: int


class JourneyOutcomesOut(BaseModel):
    completed: int
    no_show: int
    cancelled: JourneyCancelledOut
    # 時間已過、還沒標記到場或沒來。
    unmarked: int


class JourneyWithdrawnOut(BaseModel):
    total: int
    from_deposit: int
    from_enrolled: int


class JourneyWaitingOut(BaseModel):
    """參觀後未預繳：觀察中（0–13 天）、逾期（14–89 天）、冷名單（90 天以上）。"""

    observing: int
    overdue: int
    cold: int


class JourneyAdmissionsOut(BaseModel):
    with_visit: int
    completed_without_visit: int
    # 曾經到達該階段（預繳過含退出者；註冊過含退註冊者）。
    deposited: int
    enrolled: int
    withdrawn: JourneyWithdrawnOut
    not_deposited: JourneyWaitingOut


class JourneyRateOut(BaseModel):
    key: Literal["attendance", "cancel", "with_visit", "deposit", "enrolled", "withdrawn"]
    numerator: int
    denominator: int
    # 百分比到小數一位；分母 0 為 None。
    pct: float | None


class JourneyDaysOut(BaseModel):
    """天數的中位數（小數一位）與筆數；excluded＝缺時間或負值而不納入的筆數。"""

    median: float | None
    n: int
    excluded: int


class JourneyCancelBucketsOut(BaseModel):
    after_visit: int
    same_day: int
    day_1: int
    days_2_3: int
    days_4_7: int
    days_8_plus: int


class JourneyCancelTimingOut(BaseModel):
    n: int
    excluded: int
    parent: JourneyCancelBucketsOut
    staff: JourneyCancelBucketsOut
    other: JourneyCancelBucketsOut


class JourneyTimingOut(BaseModel):
    lead_days: JourneyDaysOut
    cancel_before_visit: JourneyCancelTimingOut
    visit_to_deposit: JourneyDaysOut
    deposit_to_enrolled: JourneyDaysOut
    deposit_to_withdrawn: JourneyDaysOut


class JourneyRescheduledOut(BaseModel):
    cases: int
    total: int


class JourneyCoverageOut(BaseModel):
    visits_without_request: int
    completed_without_visit: int
    undated_cases: int


class JourneyOut(BaseModel):
    filters: JourneyFiltersOut
    as_of: datetime
    cases: JourneyCasesOut
    visit_outcomes: JourneyOutcomesOut
    admissions: JourneyAdmissionsOut
    rates: list[JourneyRateOut]
    timing: JourneyTimingOut
    rescheduled: JourneyRescheduledOut
    coverage: JourneyCoverageOut
```

- [ ] **Step 4：實作查庫（`journey.py` 後半）**

在 `backend/app/admissions/journey.py` 檔頭 import 區補上（和既有 import 合併排序）：

```python
import uuid
from datetime import datetime

from sqlalchemy import Date, and_, cast, exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.models import RecruitmentEventLog, RecruitmentVisit
from app.booking.models import VisitRequest, VisitRequestEvent, VisitRequestStatus, VisitSlot
from app.common.timezones import OPERATING_TZ, now_utc, today_local
from app.operations.booking_outcomes_service import _outcome  # 與「預約結果」同一份分類（計畫裁定 P4）
```

檔尾新增：

```python
CHUNK = 1000


def _taipei_day(column):
    return cast(func.timezone(OPERATING_TZ.key, column), Date)


def _chunks(items: list[uuid.UUID]):
    for start in range(0, len(items), CHUNK):
        yield items[start : start + CHUNK]


def _visited_on():
    """預定參觀日：同單案列表（booking/routes.py `_visited_on_column`）。有場次用場次日期；提早到場、約之後日子
    的案件釋出了場次，沒有場次、而且已完成，改取最後一筆 completed 歷程的台北日；其餘是 None。"""
    slot_date = (
        select(VisitSlot.slot_date).where(VisitSlot.id == VisitRequest.slot_id).correlate(VisitRequest).scalar_subquery()
    )
    completed_on = (
        select(func.max(_taipei_day(VisitRequestEvent.created_at)))
        .where(
            VisitRequestEvent.visit_request_id == VisitRequest.id,
            VisitRequestEvent.event_type == "completed",
            VisitRequest.status == VisitRequestStatus.COMPLETED.value,
        )
        .correlate(VisitRequest)
        .scalar_subquery()
    )
    return func.coalesce(slot_date, completed_on)


async def load_cases(
    db: AsyncSession, campus_key: str, date_from: date, date_to: date, source: str, now: datetime
) -> tuple[list[CaseInfo], int]:
    """批次案件（含連到的招生訪視）與「預定參觀日算不出來」的筆數（P2：以送出日在期間內計入）。"""
    visited_on = _visited_on()
    created_on = _taipei_day(VisitRequest.created_at)
    rescheduled = exists().where(
        VisitRequestEvent.visit_request_id == VisitRequest.id, VisitRequestEvent.event_type == "rescheduled"
    ).correlate(VisitRequest)
    stmt = select(
        VisitRequest.id,
        VisitRequest.source,
        _outcome(now).label("outcome"),
        created_on.label("created_on"),
        _taipei_day(VisitRequest.cancelled_at).label("cancelled_on"),
        VisitRequest.cancel_reason,
        visited_on.label("visited_on"),
        rescheduled.label("rescheduled"),
    ).where(
        VisitRequest.campus_key == campus_key,
        or_(visited_on.between(date_from, date_to), and_(visited_on.is_(None), created_on.between(date_from, date_to))),
    )
    if source == "web":
        stmt = stmt.where(VisitRequest.source == "web")
    elif source == "assisted":
        stmt = stmt.where(VisitRequest.source != "web")
    rows = (await db.execute(stmt)).all()

    undated = sum(1 for row in rows if row.visited_on is None and row.outcome != "upcoming")
    kept = [row for row in rows if row.visited_on is not None and row.outcome != "upcoming"]
    completed_ids = [row.id for row in kept if row.outcome == "completed"]
    visits = await _load_visits(db, completed_ids)
    cases = [
        CaseInfo(
            source=row.source, outcome=row.outcome, created_on=row.created_on, visited_on=row.visited_on,
            cancelled_on=row.cancelled_on, cancel_reason=row.cancel_reason, rescheduled=bool(row.rescheduled),
            visit=visits.get(row.id),
        )
        for row in kept
    ]
    return cases, undated


async def _load_visits(db: AsyncSession, request_ids: list[uuid.UUID]) -> dict[uuid.UUID, VisitInfo]:
    """連到這些預約的招生訪視；預繳日＝最後一筆 deposit_added 的台北日（同預繳速度，已匿名化的照算）。"""
    v, e = RecruitmentVisit, RecruitmentEventLog
    found: dict[uuid.UUID, VisitInfo] = {}
    for chunk in _chunks(request_ids):
        last_deposit = (
            select(e.recruitment_visit_id.label("visit_id"), func.max(e.created_at).label("deposit_at"))
            .join(v, v.id == e.recruitment_visit_id)
            .where(e.event_type == "deposit_added", v.visit_request_id.in_(chunk))
            .group_by(e.recruitment_visit_id)
            .subquery()
        )
        rows = await db.execute(
            select(
                v.visit_request_id, v.visit_date, v.has_deposit, v.enrolled, v.enrolled_on, v.withdrawn_at,
                v.withdrawn_from, last_deposit.c.deposit_at,
            )
            .select_from(v)
            .outerjoin(last_deposit, last_deposit.c.visit_id == v.id)
            .where(v.visit_request_id.in_(chunk))
        )
        for row in rows.all():
            found[row.visit_request_id] = VisitInfo(
                visit_date=row.visit_date,
                has_deposit=row.has_deposit,
                enrolled=row.enrolled,
                enrolled_on=row.enrolled_on,
                withdrawn_on=row.withdrawn_at.astimezone(OPERATING_TZ).date() if row.withdrawn_at is not None else None,
                withdrawn_from=row.withdrawn_from,
                deposit_on=row.deposit_at.astimezone(OPERATING_TZ).date() if row.deposit_at is not None else None,
            )
    return found


async def count_visits_without_request(db: AsyncSession, campus_key: str, date_from: date, date_to: date) -> int:
    """期間內（參觀日）沒有預約案件的招生訪視：手動新增的現場參觀、舊名單補登、連結被刪的。"""
    v = RecruitmentVisit
    return int(
        await db.scalar(
            select(func.count())
            .select_from(v)
            .where(v.campus_key == campus_key, v.visit_request_id.is_(None), v.visit_date.between(date_from, date_to))
        )
        or 0
    )


async def query_journey(
    db: AsyncSession, campus_key: str, date_from: date, date_to: date, source: str, now: datetime | None = None
) -> dict[str, Any]:
    """唯讀：不 flush、不 commit。date_from／date_to 是台北日（含），呼叫端已驗證並把 date_to 截到今天。"""
    current = now or now_utc()
    cases, undated = await load_cases(db, campus_key, date_from, date_to, source, current)
    without_request = await count_visits_without_request(db, campus_key, date_from, date_to)
    result = compute_journey(
        cases, today=today_local(current), visits_without_request=without_request, undated_cases=undated
    )
    return {
        "filters": {"campus_key": campus_key, "date_from": date_from, "date_to": date_to, "source": source},
        "as_of": current,
        **result,
    }
```

- [ ] **Step 5：實作路由**

`backend/app/admissions/routes.py`：

(a) import 區補（已有的不要重複）：`from datetime import date`、`from app.common.timezones import today_local`、`from app.admissions import journey as journey_service`（接在 `from app.admissions import stats as stats_service` 附近）、`JourneyOut` 加進 `from app.admissions.schemas import (...)` 清單（照字母序放在 `IntakeTargetsRequest` 後面）。

(b) 在 `get_admissions_area_trends` 之後新增：

```python
JOURNEY_MAX_DAYS = 400


@router.get("/admin/admissions/journey", response_model=JourneyOut)
async def get_admissions_journey(
    campus_key: str,
    date_from: date = Query(alias="from", description="預定參觀日起（台北，含）"),
    date_to: date = Query(alias="to", description="預定參觀日迄（台北，含）；超過今天會截到今天"),
    source: Literal["all", "web", "assisted"] = Query(default="all", description="all 全部、web 官網、assisted 後台補登"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> JourneyOut:
    """預約全程漏斗與退出時點（2026-10-15 預約全程規格 §3）：預定參觀日在期間內、已過參觀時間的預約案件，
    從預約到到場、有招生訪視、預繳、註冊的人數與各段天數，以及家庭離開的時點。只讀，不寫稽核。"""
    _require_campus(current_user, "admissions.read", campus_key)
    end = min(date_to, today_local())
    if date_from > end:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "INVALID_DATE_RANGE", "message": "開始日期不能晚於結束日期（結束日期最晚是今天）"},
        )
    if (end - date_from).days + 1 > JOURNEY_MAX_DAYS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "INVALID_DATE_RANGE", "message": f"日期區間最長 {JOURNEY_MAX_DAYS} 天"},
        )
    result = await journey_service.query_journey(db, campus_key, date_from, end, source)
    return JourneyOut.model_validate(result)
```

- [ ] **Step 6：跑測試確認綠**

```bash
cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_journey1015_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen pytest -q -p no:cacheprovider tests/test_admissions_journey.py
uv run --frozen ruff check app/admissions tests/test_admissions_journey.py
```

預期：全部通過。若有案例失敗，先查是實作還是測試輸入的錯（每個案例的期望值都已手算），不要為了變綠改期望值；真的是計畫算錯就回報 NEEDS_CONTEXT。再跑一次相鄰測試確認沒有踩到既有程式：`tests/test_admissions_trends.py`、`tests/test_admissions_journey_calc.py`（一次一個檔）。

- [ ] **Step 7：重新產生契約並檢查**

```bash
cd backend && env -i PATH="$PATH" HOME="$HOME" .venv/bin/python scripts/export_openapi.py && cd .. && source ~/.nvm/nvm.sh; npx openapi-typescript contracts/openapi.json -o contracts/generated/website-api.d.ts
cd backend && env -i PATH="$PATH" HOME="$HOME" .venv/bin/python scripts/export_openapi.py --check && cd .. && node scripts/check-contract-types.mjs
git diff --stat contracts/
```

預期：兩個檢查都印「一致」；diff 只有 `JourneyOut` 與子模型、新路徑 `/api/website/v1/admin/admissions/journey`。

- [ ] **Step 8：Commit**

```bash
git add backend/app/admissions/journey.py backend/app/admissions/schemas.py backend/app/admissions/routes.py backend/tests/test_admissions_journey.py contracts/openapi.json contracts/generated/website-api.d.ts
git commit -m "feat(admissions): GET /admin/admissions/journey（預約到預繳的全程漏斗與離開時點）

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3：前端資料層（API、型別、格式、網址狀態）

**Files:**
- Modify: `admin/src/api/admissions.ts`、`admin/src/api/types.ts`、`admin/src/admissions/useAdmissionsFilters.ts`
- Create: `admin/src/admissions/journeyFormat.ts`
- Modify: `admin/src/__tests__/admissionsTestKit.ts`、`admin/src/__tests__/admissionsView.test.ts`
- Create: `admin/src/__tests__/journeyFormat.test.ts`

**Interfaces:**
- Consumes（Task 2）：契約型別 `components['schemas']['JourneyOut']`；`GET /admin/admissions/journey`。
- Produces（Task 4、5 依賴）：
  - `api/types.ts`：`AdmissionsJourney = components['schemas']['JourneyOut']`。
  - `api/admissions.ts`：`getJourney(params: { campus_key: string; from: string; to: string; source: JourneySource }): Promise<AdmissionsJourney>`。
  - `admissions/journeyFormat.ts`：型別 `JourneyPeriod`（`'90' | '180' | '365' | 'custom'`）、`JourneySource`（`'all' | 'web' | 'assisted'`）、`JourneyFilter`；常數 `DEFAULT_JOURNEY_FILTER`、`JOURNEY_PERIODS`、`JOURNEY_SOURCES`、`SMALL_SAMPLE = 20`；函式 `parseJourneyQuery`、`journeyQuery`、`journeyRange`、`rateText`、`funnelRows`、`exitRows`、`cancelRows`、`timingRows`、`journeySummary`（簽名與輸出見 Step 3 與測試）。
  - `useAdmissionsFilters()` 多回傳 `journey: Ref<JourneyFilter>`；`STATS_SUBS` 多一個 `'journey'`（排在 `'booking'` 後面）。
  - `admissionsTestKit.ts`：`journeyData(changes?)`。

- [ ] **Step 1：型別、API、測試資料**

`admin/src/api/types.ts`（和其他 `Admissions*` 型別放一起）新增：

```ts
export type AdmissionsJourney = components['schemas']['JourneyOut']
```

`admin/src/api/admissions.ts` 新增（`toQuery` 與 `api` 檔案裡已有；import 型別）：

```ts
import type { JourneySource } from '../admissions/journeyFormat'
// …（AdmissionsJourney 加進既有的 `import type { … } from './types'`）

/** 預約全程漏斗與退出時點（2026-10-15 規格 §3.2）：預定參觀日在 from～to（台北日，含）的預約案件。 */
export function getJourney(params: { campus_key: string; from: string; to: string; source: JourneySource }): Promise<AdmissionsJourney> {
  return api.get<AdmissionsJourney>(`/admin/admissions/journey?${toQuery(params)}`)
}
```

`admin/src/__tests__/admissionsTestKit.ts` 新增（放在 `areaTrends` 附近；數字與後端 Task 1 的 13 筆情境一致，方便對照）：

```ts
// 預約全程（2026-10-15）：後端 test_admissions_journey_calc 的 13 筆情境。
const buildJourney = () => ({
  filters: { campus_key: 'yihua', date_from: '2026-07-17', date_to: '2026-10-15', source: 'all' },
  as_of: '2026-10-15T04:00:00Z',
  cases: { total: 13, by_source: { web: 9, phone: 2, line: 1, walk_in: 1, external: 0 } },
  visit_outcomes: { completed: 8, no_show: 1, cancelled: { total: 3, parent: 1, staff: 1, other: 1 }, unmarked: 1 },
  admissions: {
    with_visit: 7, completed_without_visit: 1, deposited: 4, enrolled: 2,
    withdrawn: { total: 2, from_deposit: 1, from_enrolled: 1 },
    not_deposited: { observing: 1, overdue: 1, cold: 1 },
  },
  rates: [
    { key: 'attendance', numerator: 8, denominator: 9, pct: 88.9 },
    { key: 'cancel', numerator: 3, denominator: 13, pct: 23.1 },
    { key: 'with_visit', numerator: 7, denominator: 8, pct: 87.5 },
    { key: 'deposit', numerator: 4, denominator: 7, pct: 57.1 },
    { key: 'enrolled', numerator: 2, denominator: 4, pct: 50 },
    { key: 'withdrawn', numerator: 2, denominator: 4, pct: 50 },
  ],
  timing: {
    lead_days: { median: 7, n: 13, excluded: 0 },
    cancel_before_visit: {
      n: 3, excluded: 0,
      parent: { after_visit: 0, same_day: 1, day_1: 0, days_2_3: 0, days_4_7: 0, days_8_plus: 0 },
      staff: { after_visit: 0, same_day: 0, day_1: 0, days_2_3: 0, days_4_7: 1, days_8_plus: 0 },
      other: { after_visit: 1, same_day: 0, day_1: 0, days_2_3: 0, days_4_7: 0, days_8_plus: 0 },
    },
    visit_to_deposit: { median: 5, n: 3, excluded: 1 },
    deposit_to_enrolled: { median: 6.5, n: 2, excluded: 0 },
    deposit_to_withdrawn: { median: 11, n: 2, excluded: 0 },
  },
  rescheduled: { cases: 1, total: 13 },
  coverage: { visits_without_request: 4, completed_without_visit: 1, undated_cases: 2 },
} satisfies AdmissionsJourney)
/** 每次呼叫都是一份新的；changes 整欄換掉。 */
export const journeyData = (changes: Partial<AdmissionsJourney> = {}): AdmissionsJourney => ({ ...buildJourney(), ...changes })
```

（檔頭的 `import type { … } from '../api/types'` 補上 `AdmissionsJourney`。）

- [ ] **Step 2：寫格式函式測試（先紅）**

新檔 `admin/src/__tests__/journeyFormat.test.ts`：

```ts
// 預約全程（2026-10-15 規格 §3.3）：篩選的網址編解碼、各表的列、摘要句。
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_JOURNEY_FILTER, cancelRows, exitRows, funnelRows, journeyQuery, journeyRange, journeySummary, parseJourneyQuery,
  rateText, timingRows,
} from '../admissions/journeyFormat'
import { journeyData } from './admissionsTestKit'

describe('篩選 ↔ 網址', () => {
  it('預設（最近 3 個月、全部來源）不寫進網址；讀不到就是預設', () => {
    expect(journeyQuery(DEFAULT_JOURNEY_FILTER)).toEqual({})
    expect(parseJourneyQuery({})).toEqual(DEFAULT_JOURNEY_FILTER)
  })

  it('期間與來源寫出來、讀回來；自訂區間才帶起訖', () => {
    const filter = { period: '180', from: '', to: '', source: 'web' } as const
    expect(journeyQuery(filter)).toEqual({ jp: '180', js: 'web' })
    expect(parseJourneyQuery({ jp: '180', js: 'web' })).toEqual(filter)
    const custom = { period: 'custom', from: '2026-07-01', to: '2026-09-30', source: 'assisted' } as const
    expect(journeyQuery(custom)).toEqual({ jp: 'custom', jf: '2026-07-01', jt: '2026-09-30', js: 'assisted' })
    expect(parseJourneyQuery({ jp: 'custom', jf: '2026-07-01', jt: '2026-09-30', js: 'assisted' })).toEqual(custom)
  })

  it('認不得的值、日期格式不對、自訂區間缺一端都退回預設', () => {
    expect(parseJourneyQuery({ jp: 'hack', js: 'x' })).toEqual(DEFAULT_JOURNEY_FILTER)
    expect(parseJourneyQuery({ jp: 'custom', jf: '2026-07-01' })).toEqual(DEFAULT_JOURNEY_FILTER)
    expect(parseJourneyQuery({ jp: 'custom', jf: 'abc', jt: '2026-09-30' })).toEqual(DEFAULT_JOURNEY_FILTER)
    // 非自訂時多出來的 jf／jt 被忽略。
    expect(parseJourneyQuery({ jp: '90', jf: '2026-07-01', jt: '2026-09-30' })).toEqual(DEFAULT_JOURNEY_FILTER)
  })

  it('期間換成起訖日：往回推的天數含今天；自訂照給的', () => {
    expect(journeyRange(DEFAULT_JOURNEY_FILTER, '2026-10-15')).toEqual({ from: '2026-07-18', to: '2026-10-15' })
    expect(journeyRange({ ...DEFAULT_JOURNEY_FILTER, period: '365' }, '2026-10-15')).toEqual({ from: '2025-10-16', to: '2026-10-15' })
    expect(journeyRange({ period: 'custom', from: '2026-07-01', to: '2026-09-30', source: 'all' }, '2026-10-15')).toEqual({ from: '2026-07-01', to: '2026-09-30' })
    expect(journeyRange({ period: 'custom', from: '', to: '', source: 'all' }, '2026-10-15')).toBeNull()
  })
})

describe('比率文字', () => {
  it('分子分母一起寫；分母不足 20 加「樣本較少」；分母 0 寫「—」', () => {
    expect(rateText('到場率', { key: 'attendance', numerator: 80, denominator: 96, pct: 83.3 })).toBe('到場率 83.3%（80／96）')
    expect(rateText('到場率', { key: 'attendance', numerator: 8, denominator: 9, pct: 88.9 })).toBe('到場率 88.9%（8／9）・樣本較少')
    expect(rateText('預繳率', { key: 'deposit', numerator: 0, denominator: 0, pct: null })).toBe('預繳率 —')
  })
})

describe('各表的列', () => {
  const data = journeyData()

  it('全程漏斗：預約案件 → 已到場 → 有招生訪視 → 預繳過 → 註冊過，再接預繳後退出', () => {
    expect(funnelRows(data).map((row) => [row.stage, row.count, row.rate])).toEqual([
      ['預約案件', 13, '取消率 23.1%（3／13）・樣本較少'],
      ['已到場', 8, '到場率 88.9%（8／9）・樣本較少'],
      ['有招生訪視', 7, '有訪視比例 87.5%（7／8）・樣本較少'],
      ['預繳過', 4, '預繳率 57.1%（4／7）・樣本較少'],
      ['註冊過', 2, '註冊率 50.0%（2／4）・樣本較少'],
      ['預繳後退出', 2, '退出比例 50.0%（2／4）・樣本較少'],
    ])
  })

  it('家庭在哪裡離開：沒走到預繳過的各類；預繳後退出另列', () => {
    expect(exitRows(data).map((row) => [row.kind, row.count, row.timing])).toEqual([
      ['已取消・家長', 1, '距參觀日見下表'],
      ['已取消・園方', 1, '距參觀日見下表'],
      ['已取消・其他或沒記', 1, '距參觀日見下表'],
      ['沒來', 1, '參觀當天，人工標記'],
      ['時間已過未標記', 1, '場次已過、還沒標記到場或沒來'],
      ['已到場但沒有招生訪視', 1, '沒有連到招生紀錄'],
      ['參觀後未預繳・觀察中', 1, '參觀後 0–13 天'],
      ['參觀後未預繳・逾期', 1, '參觀後 14–89 天'],
      ['參觀後未預繳・冷名單', 1, '參觀後 90 天以上'],
      ['預繳後退出・退預繳', 1, '天數見「各段要花多久」'],
      ['預繳後退出・退註冊', 1, '天數見「各段要花多久」'],
    ])
  })

  it('取消時點：六個區間，家長、園方、其他各一欄；沒有取消回空陣列', () => {
    expect(cancelRows(data)).toEqual([
      { key: 'after_visit', bucket: '參觀日之後才取消', parent: 0, staff: 0, other: 1 },
      { key: 'same_day', bucket: '當天', parent: 1, staff: 0, other: 0 },
      { key: 'day_1', bucket: '1 天前', parent: 0, staff: 0, other: 0 },
      { key: 'days_2_3', bucket: '2–3 天前', parent: 0, staff: 0, other: 0 },
      { key: 'days_4_7', bucket: '4–7 天前', parent: 0, staff: 1, other: 0 },
      { key: 'days_8_plus', bucket: '8 天以上', parent: 0, staff: 0, other: 0 },
    ])
    const none = journeyData({ timing: { ...data.timing, cancel_before_visit: { ...data.timing.cancel_before_visit, n: 0 } } })
    expect(cancelRows(none)).toEqual([])
  })

  it('各段要花多久：中位數（整數不寫小數）、筆數；筆數不足 20 標「樣本較少」、不納入的筆數另寫', () => {
    expect(timingRows(data).map((row) => [row.metric, row.median, row.n, row.note])).toEqual([
      ['預約提前量（預約送出到預定參觀日）', '7 天', 13, '樣本較少'],
      ['參觀到預繳', '5 天', 3, '樣本較少；另有 1 筆沒有預繳日或日期倒置，不納入'],
      ['預繳到註冊', '6.5 天', 2, '樣本較少'],
      ['預繳到退出', '11 天', 2, '樣本較少'],
    ])
    // 筆數夠了就不標；沒有值（n=0）寫「—」也不標樣本較少，只留不納入的筆數。
    const enough = journeyData({ timing: { ...data.timing, lead_days: { median: 7, n: 20, excluded: 0 } } })
    expect(timingRows(enough)[0]).toMatchObject({ median: '7 天', n: 20, note: '' })
    const empty = journeyData({ timing: { ...data.timing, visit_to_deposit: { median: null, n: 0, excluded: 2 } } })
    expect(timingRows(empty)[1]).toMatchObject({ median: '—', n: 0, note: '另有 2 筆沒有預繳日或日期倒置，不納入' })
  })
})

describe('摘要句', () => {
  it('寫期間、預約案件、各結局，到場的往下接招生紀錄、預繳、註冊、預繳後退出', () => {
    expect(journeySummary(journeyData(), '義華')).toBe(
      '2026/07/17–2026/10/15，義華預定參觀的預約 13 筆：到場 8（到場率 88.9%）、取消 3、沒來 1、時間已過未標記 1。' +
        '到場的 8 筆中 7 筆有招生紀錄，預繳 4、註冊 2、預繳後退出 2。',
    )
  })

  it('沒有案件、沒有到場時句子跟著縮短', () => {
    const none = journeyData({ cases: { total: 0, by_source: {} } })
    expect(journeySummary(none, '義華')).toBe('2026/07/17–2026/10/15，義華這段期間沒有預約案件。')
    const noShow = journeyData({
      cases: { total: 2, by_source: { web: 2 } },
      visit_outcomes: { completed: 0, no_show: 1, cancelled: { total: 1, parent: 1, staff: 0, other: 0 }, unmarked: 0 },
      rates: journeyData().rates.map((rate) => (rate.key === 'attendance' ? { ...rate, numerator: 0, denominator: 1, pct: 0 } : rate)),
    })
    expect(journeySummary(noShow, '義華')).toBe(
      '2026/07/17–2026/10/15，義華預定參觀的預約 2 筆：到場 0（到場率 0.0%）、取消 1、沒來 1、時間已過未標記 0。',
    )
  })
})
```

- [ ] **Step 3：跑測試確認紅，再實作 `journeyFormat.ts`**

```bash
cd admin; source ~/.nvm/nvm.sh; nvm use 22; npx vitest run src/__tests__/journeyFormat.test.ts
```

預期：找不到模組 `journeyFormat`。新檔 `admin/src/admissions/journeyFormat.ts`：

```ts
import type { AdmissionsJourney } from '../api/types'
import { NO_VALUE } from './statsFormat'

// 預約全程（2026-10-15 規格 §3.3）：篩選的網址編解碼與各表的列。只呈現後端算好的數字與分級，不另外推估。

export type JourneyPeriod = '90' | '180' | '365' | 'custom'
export type JourneySource = 'all' | 'web' | 'assisted'
export interface JourneyFilter {
  period: JourneyPeriod
  /** 只在 period=custom 有意義（YYYY-MM-DD，台北日）。 */
  from: string
  to: string
  source: JourneySource
}

export const DEFAULT_JOURNEY_FILTER: JourneyFilter = { period: '90', from: '', to: '', source: 'all' }
export const JOURNEY_PERIODS: { value: JourneyPeriod; label: string }[] = [
  { value: '90', label: '最近 3 個月' },
  { value: '180', label: '最近 6 個月' },
  { value: '365', label: '最近 1 年' },
  { value: 'custom', label: '自訂區間' },
]
export const JOURNEY_SOURCES: { value: JourneySource; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'web', label: '官網預約' },
  { value: 'assisted', label: '後台補登' },
]
/** 分母不足這個數字標「樣本較少」（既有統計規則 R:110–113）。 */
export const SMALL_SAMPLE = 20

const DAY = /^\d{4}-\d{2}-\d{2}$/
const text = (value: unknown): string => (typeof value === 'string' ? value : '')

/** 網址 → 篩選：jp 期間、jf／jt 自訂起訖、js 來源；認不得的值一律退回預設。 */
export function parseJourneyQuery(query: Record<string, unknown>): JourneyFilter {
  const source = text(query.js)
  const filter: JourneyFilter = { ...DEFAULT_JOURNEY_FILTER, source: source === 'web' || source === 'assisted' ? source : 'all' }
  const period = text(query.jp)
  if (period === '180' || period === '365') filter.period = period
  if (period === 'custom') {
    const from = text(query.jf)
    const to = text(query.jt)
    if (DAY.test(from) && DAY.test(to)) return { ...filter, period: 'custom', from, to }
  }
  return filter
}

/** 篩選 → 網址參數：預設值不寫；jf／jt 只在自訂區間寫。 */
export function journeyQuery(filter: JourneyFilter): Record<string, string> {
  const query: Record<string, string> = {}
  if (filter.period !== DEFAULT_JOURNEY_FILTER.period) {
    query.jp = filter.period
    if (filter.period === 'custom') {
      query.jf = filter.from
      query.jt = filter.to
    }
  }
  if (filter.source !== 'all') query.js = filter.source
  return query
}

/** 台北日期往前推 days 天（含今天共 days 天）。 */
function daysBefore(today: string, days: number): string {
  const [y, m, d] = today.split('-').map(Number)
  return new Date(Date.UTC(y!, m! - 1, d! - (days - 1))).toISOString().slice(0, 10)
}

/** 篩選換成起訖日（台北日，含）；自訂區間沒選好是 null。 */
export function journeyRange(filter: JourneyFilter, today: string): { from: string; to: string } | null {
  if (filter.period === 'custom') return filter.from && filter.to ? { from: filter.from, to: filter.to } : null
  return { from: daysBefore(today, Number(filter.period)), to: today }
}

type Rate = AdmissionsJourney['rates'][number]

/** 「到場率 83.3%（80／96）」；分母 0 寫「—」；分母不足 20 加「・樣本較少」。 */
export function rateText(label: string, rate: Rate): string {
  if (rate.pct === null) return `${label} ${NO_VALUE}`
  const small = rate.denominator < SMALL_SAMPLE ? '・樣本較少' : ''
  return `${label} ${rate.pct.toFixed(1)}%（${rate.numerator}／${rate.denominator}）${small}`
}

const rateOf = (data: AdmissionsJourney, key: Rate['key']): Rate => data.rates.find((rate) => rate.key === key)!

export interface FunnelRow {
  key: string
  stage: string
  count: number
  rate: string
}

export function funnelRows(data: AdmissionsJourney): FunnelRow[] {
  const { cases, visit_outcomes: outcomes, admissions } = data
  return [
    { key: 'cases', stage: '預約案件', count: cases.total, rate: rateText('取消率', rateOf(data, 'cancel')) },
    { key: 'completed', stage: '已到場', count: outcomes.completed, rate: rateText('到場率', rateOf(data, 'attendance')) },
    { key: 'with_visit', stage: '有招生訪視', count: admissions.with_visit, rate: rateText('有訪視比例', rateOf(data, 'with_visit')) },
    { key: 'deposited', stage: '預繳過', count: admissions.deposited, rate: rateText('預繳率', rateOf(data, 'deposit')) },
    { key: 'enrolled', stage: '註冊過', count: admissions.enrolled, rate: rateText('註冊率', rateOf(data, 'enrolled')) },
    { key: 'withdrawn', stage: '預繳後退出', count: admissions.withdrawn.total, rate: rateText('退出比例', rateOf(data, 'withdrawn')) },
  ]
}

export interface ExitRow {
  key: string
  kind: string
  count: number
  timing: string
}

const CANCEL_NOTE = '距參觀日見下表'
const WITHDRAW_NOTE = '天數見「各段要花多久」'

/** 沒走到「預繳過」的家庭恰好分成前九類；預繳後退出是預繳過的子集，另外兩列。 */
export function exitRows(data: AdmissionsJourney): ExitRow[] {
  const { cancelled, no_show: noShow, unmarked } = data.visit_outcomes
  const { completed_without_visit: noVisit, not_deposited: waiting, withdrawn } = data.admissions
  return [
    { key: 'cancel_parent', kind: '已取消・家長', count: cancelled.parent, timing: CANCEL_NOTE },
    { key: 'cancel_staff', kind: '已取消・園方', count: cancelled.staff, timing: CANCEL_NOTE },
    { key: 'cancel_other', kind: '已取消・其他或沒記', count: cancelled.other, timing: CANCEL_NOTE },
    { key: 'no_show', kind: '沒來', count: noShow, timing: '參觀當天，人工標記' },
    { key: 'unmarked', kind: '時間已過未標記', count: unmarked, timing: '場次已過、還沒標記到場或沒來' },
    { key: 'no_visit', kind: '已到場但沒有招生訪視', count: noVisit, timing: '沒有連到招生紀錄' },
    { key: 'observing', kind: '參觀後未預繳・觀察中', count: waiting.observing, timing: '參觀後 0–13 天' },
    { key: 'overdue', kind: '參觀後未預繳・逾期', count: waiting.overdue, timing: '參觀後 14–89 天' },
    { key: 'cold', kind: '參觀後未預繳・冷名單', count: waiting.cold, timing: '參觀後 90 天以上' },
    { key: 'withdrawn_deposit', kind: '預繳後退出・退預繳', count: withdrawn.from_deposit, timing: WITHDRAW_NOTE },
    { key: 'withdrawn_enrolled', kind: '預繳後退出・退註冊', count: withdrawn.from_enrolled, timing: WITHDRAW_NOTE },
  ]
}

const BUCKET_LABELS = [
  ['after_visit', '參觀日之後才取消'],
  ['same_day', '當天'],
  ['day_1', '1 天前'],
  ['days_2_3', '2–3 天前'],
  ['days_4_7', '4–7 天前'],
  ['days_8_plus', '8 天以上'],
] as const

export interface CancelRow {
  key: string
  bucket: string
  parent: number
  staff: number
  other: number
}

/** 取消日距預定參觀日的分布；沒有取消就沒有這張表（回空陣列）。 */
export function cancelRows(data: AdmissionsJourney): CancelRow[] {
  const timing = data.timing.cancel_before_visit
  if (timing.n === 0) return []
  return BUCKET_LABELS.map(([key, bucket]) => ({
    key, bucket, parent: timing.parent[key], staff: timing.staff[key], other: timing.other[key],
  }))
}

export interface TimingRow {
  key: string
  metric: string
  median: string
  n: number
  /** 「樣本較少」（筆數 1–19）與「另有 N 筆…不納入」，用「；」接起來。 */
  note: string
}

/** 中位數：整數不寫小數（「5 天」「6.5 天」）；沒有值寫「—」。 */
export function daysText(median: number | null): string {
  if (median === null) return NO_VALUE
  return `${Number.isInteger(median) ? median : median.toFixed(1)} 天`
}

export function timingRows(data: AdmissionsJourney): TimingRow[] {
  const { timing } = data
  const row = (key: string, metric: string, days: { median: number | null; n: number; excluded: number }, excludedWhy: string): TimingRow => ({
    key, metric, median: daysText(days.median), n: days.n,
    note: [
      days.n > 0 && days.n < SMALL_SAMPLE ? '樣本較少' : '',
      days.excluded ? `另有 ${days.excluded} 筆${excludedWhy}，不納入` : '',
    ].filter(Boolean).join('；'),
  })
  return [
    row('lead_days', '預約提前量（預約送出到預定參觀日）', timing.lead_days, '日期倒置'),
    row('visit_to_deposit', '參觀到預繳', timing.visit_to_deposit, '沒有預繳日或日期倒置'),
    row('deposit_to_enrolled', '預繳到註冊', timing.deposit_to_enrolled, '缺預繳日或註冊日，或日期倒置'),
    row('deposit_to_withdrawn', '預繳到退出', timing.deposit_to_withdrawn, '缺預繳日，或日期倒置'),
  ]
}

const slashed = (day: string): string => day.replaceAll('-', '/')

/** 摘要句（只描述）：期間、預約案件、各結局；有到場的再接招生紀錄、預繳、註冊、預繳後退出。 */
export function journeySummary(data: AdmissionsJourney, campusName: string): string {
  const range = `${slashed(data.filters.date_from)}–${slashed(data.filters.date_to)}`
  if (data.cases.total === 0) return `${range}，${campusName}這段期間沒有預約案件。`
  const { completed, no_show: noShow, cancelled, unmarked } = data.visit_outcomes
  const attendance = rateOf(data, 'attendance').pct
  const head =
    `${range}，${campusName}預定參觀的預約 ${data.cases.total} 筆：到場 ${completed}` +
    `（到場率 ${attendance === null ? NO_VALUE : `${attendance.toFixed(1)}%`}）、取消 ${cancelled.total}、沒來 ${noShow}、時間已過未標記 ${unmarked}。`
  if (completed === 0) return head
  const { admissions } = data
  return `${head}到場的 ${completed} 筆中 ${admissions.with_visit} 筆有招生紀錄，預繳 ${admissions.deposited}、註冊 ${admissions.enrolled}、預繳後退出 ${admissions.withdrawn.total}。`
}
```

再跑 `journeyFormat.test.ts`，預期全部通過。

- [ ] **Step 4：`useAdmissionsFilters` 加 `journey` 狀態與網址**

`admin/src/admissions/useAdmissionsFilters.ts`：

(a) `STATS_SUBS` 改成（並更新上面的註解：「官網延伸的『預約全程』（2026-10-15）排在『參觀預約』後面」）：

```ts
export const STATS_SUBS = ['overview', 'class', 'source', 'staff', 'area', 'nodeposit', 'compare', 'booking', 'journey'] as const
```

(b) import：

```ts
import { DEFAULT_JOURNEY_FILTER, journeyQuery, parseJourneyQuery, type JourneyFilter } from './journeyFormat'
```

(c) 檔頭註解的狀態清單補一行：`- jp／jf／jt／js：統計分頁「預約全程」的期間、自訂起訖與來源（journeyFormat.ts），只在 tab=stats&sub=journey 有意義，離開就拿掉，手改成認不得的值就退回預設。`

(d) 在 `const sub = ref<StatsSub>('overview')` 後面加 `const journey = ref<JourneyFilter>({ ...DEFAULT_JOURNEY_FILTER })`。

(e) `apply(query)` 最後一行（`sub.value = …` 之後）加：

```ts
    journey.value = tab.value === 'stats' && sub.value === 'journey' ? parseJourneyQuery(query) : { ...DEFAULT_JOURNEY_FILTER }
```

(f) `stateQuery()` 在 `if (tab.value === 'stats' && sub.value !== 'overview') query.sub = sub.value` 後面加：

```ts
    if (tab.value === 'stats' && sub.value === 'journey') Object.assign(query, journeyQuery(journey.value))
```

(g) 監看清單加入 `journey`（用 deep）：把 `watch([campus, schoolYear, semester, tab, visitRequestId, month, area, sub], syncUrl, { immediate: true })` 改成 `watch([campus, schoolYear, semester, tab, visitRequestId, month, area, sub, journey], syncUrl, { immediate: true, deep: true })`。

(h) 離開統計分頁時收回：在 `watch(tab, …)` 裡 `if (value !== 'stats') sub.value = 'overview'` 之後加 `if (value !== 'stats') journey.value = { ...DEFAULT_JOURNEY_FILTER }`；切到別的子分頁時也收回：新增 `watch(sub, (value) => { if (value !== 'journey') journey.value = { ...DEFAULT_JOURNEY_FILTER } })`。

(i) return 物件加 `journey`。

- [ ] **Step 5：網址狀態的測試（`admissionsView.test.ts`）**

(a) 這個檔裡如果有斷言 `STATS_SUBS` 完整內容的案例（`grep -n "STATS_SUBS" admin/src/__tests__/admissionsView.test.ts`），把期望陣列補上 `'journey'`。

(b) 在 `describe('統計子分頁寫進網址（X2a 3A）'` 裡（既有案例編號到 (f)）新增案例（`routesOn` 之外要多給 `/admin/admissions/journey`，先 import `journeyData`，從 `./admissionsTestKit`）：

```ts
  it('(g) sub=journey 的期間與來源讀得回來、改了寫回網址；離開統計分頁拿掉', async () => {
    freezeToday()
    mockGet({ ...routesOn, '/admin/admissions/journey': journeyData() })
    const { wrapper, router } = await mountWith(AdmissionsView, {
      path: '/admissions?campus=yihua&tab=stats&sub=journey&jp=180&js=web',
    })
    expect(wrapper.findComponent(StatsTab).props('sub')).toBe('journey')
    expect(wrapper.findComponent(StatsTab).props('journey')).toEqual({ period: '180', from: '', to: '', source: 'web' })
    const replace = vi.spyOn(router, 'replace')
    wrapper.findComponent(StatsTab).vm.$emit('update:journey', { period: 'custom', from: '2026-07-01', to: '2026-09-30', source: 'assisted' })
    await flushPromises()
    expect(replace).toHaveBeenLastCalledWith({
      query: { campus: 'yihua', tab: 'stats', sub: 'journey', jp: 'custom', jf: '2026-07-01', jt: '2026-09-30', js: 'assisted' },
    })
    wrapper.findComponent({ name: 'ElTabs' }).vm.$emit('update:modelValue', 'records')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'records' })
  })

  it('(h) 別的子分頁網址上多出來的 jp／js 被忽略，也不寫回', async () => {
    freezeToday()
    mockGet(routesOn)
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=stats&sub=source&jp=365&js=web' })
    expect(wrapper.findComponent(StatsTab).props('sub')).toBe('source')
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'stats', sub: 'source' })
  })
```

這兩個案例在 Task 4 完成前會因為 `StatsTab` 還沒有 `journey` prop 而失敗——Step 6 先只驗證**型別檢查與 `journeyFormat.test.ts`**，這兩個案例留到 Task 4 Step 6 一起跑（在 brief 報告寫明）。

- [ ] **Step 6：驗證並 Commit**

```bash
cd admin; source ~/.nvm/nvm.sh; nvm use 22; npx vitest run src/__tests__/journeyFormat.test.ts; npm run typecheck
```

預期：`journeyFormat` 全部通過；typecheck 若因為 `StatsTab` 還沒有 `journey` model 而在 `AdmissionsView` 之外沒有錯誤就是正常（`useAdmissionsFilters` 多回傳的欄位 `AdmissionsView` 不解構就不會錯）。

```bash
git add admin/src/api/admissions.ts admin/src/api/types.ts admin/src/admissions/journeyFormat.ts admin/src/admissions/useAdmissionsFilters.ts admin/src/__tests__/journeyFormat.test.ts admin/src/__tests__/admissionsTestKit.ts admin/src/__tests__/admissionsView.test.ts
git commit -m "feat(admin): 預約全程的資料層（API、格式、期間與來源進網址）

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4：「預約全程」畫面

**Files:**
- Create: `admin/src/components/admissions/JourneyTab.vue`、`JourneyFunnel.vue`、`JourneyExits.vue`、`JourneyTiming.vue`
- Modify: `admin/src/components/admissions/StatsTab.vue`、`admin/src/views/AdmissionsView.vue`
- Test: `admin/src/__tests__/journeyTab.test.ts`（新）、`admin/src/__tests__/statsTab.test.ts`、`admin/src/__tests__/admissionsView.test.ts`

**Interfaces:**
- Consumes（Task 3）：`getJourney`、`AdmissionsJourney`、`journeyFormat.ts` 全部、`useAdmissionsFilters` 的 `journey`。
- Produces（Task 5 依賴的 DOM，逐字）：
  - `JourneyTab.vue` 根節點 `<section class="journey" aria-label="預約全程">`；摘要句 `<p class="journey-summary">`；涵蓋說明 `<p class="hint journey-coverage">`；期間下拉 `aria-label="期間"`；來源 `<el-radio-group aria-label="來源">`；空狀態文字「這段期間沒有預約案件」。
  - 四張表各是一個 `StatsDimensionTable`（`.stats-block`），標題逐字：**「全程漏斗」**、**「家庭在哪裡離開」**、**「取消時點（距參觀日）」**、**「各段要花多久」**；匯出檔名由 `csvName(title)` 組。
  - 漏斗表欄位：階段（sticky）｜人數（bar）｜比率；離開表欄位：類別（sticky）｜人數（bar）｜時點；取消時點表欄位：距參觀日（sticky）｜家長｜園方｜其他；時間表欄位：指標（sticky）｜中位數｜筆數｜說明。
  - `StatsTab` 的 `journey` model（`JourneyFilter`）；子分頁 `name="stats-journey"`、`label="預約全程"`（`lazy`）。

- [ ] **Step 1：元件測試（先紅）**

新檔 `admin/src/__tests__/journeyTab.test.ts`：

```ts
// 預約全程（2026-10-15 規格 §3.3）：期間與來源控制、四塊表、空資料、讀取失敗、涵蓋說明、匯出。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import JourneyTab from '../components/admissions/JourneyTab.vue'
import { DEFAULT_JOURNEY_FILTER } from '../admissions/journeyFormat'
import { cleanup, journeyData, mockGet, mountWith, pathsTo, queryOf } from './admissionsTestKit'

vi.mock('../utils/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../utils/csv')>()), downloadCsv: vi.fn() }))
import { downloadCsv } from '../utils/csv'

afterEach(() => {
  vi.mocked(downloadCsv).mockClear()
  cleanup()
})

const FROZEN = '2026-10-15T09:00:00+08:00'
type Dom = Omit<DOMWrapper<Element>, 'exists'>
const block = (wrapper: VueWrapper, title: string): Dom =>
  wrapper.findAll('.stats-block').find((section) => section.get('.stats-block__title').text() === title)!
const bodyRows = (section: Dom) => section.findAll('tbody tr').map((row) => row.findAll('th, td').map((cell) => cell.text()))

async function mountJourney(changes: Record<string, unknown> = {}, data: unknown = journeyData()) {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(FROZEN))
  const get = mockGet({ '/admin/admissions/journey': data })
  const mounted = await mountWith(JourneyTab, {
    props: { campusKey: 'yihua', filter: { ...DEFAULT_JOURNEY_FILTER }, csvName: (title: string) => `招生統計-${title}.csv`, ...changes },
  })
  await flushPromises()
  return { ...mounted, get }
}

describe('預約全程', () => {
  it('依頁首校區與預設期間（最近 3 個月、全部來源）讀；期間含今天往回 90 天', async () => {
    const { get } = await mountJourney()
    const [path] = pathsTo(get, '/admin/admissions/journey')
    expect(Object.fromEntries(queryOf(path!))).toEqual({ campus_key: 'yihua', from: '2026-07-18', to: '2026-10-15', source: 'all' })
  })

  it('摘要句、四塊表的標題與欄位', async () => {
    const { wrapper } = await mountJourney()
    expect(wrapper.get('.journey-summary').text()).toBe(
      '2026/07/17–2026/10/15，義華預定參觀的預約 13 筆：到場 8（到場率 88.9%）、取消 3、沒來 1、時間已過未標記 1。' +
        '到場的 8 筆中 7 筆有招生紀錄，預繳 4、註冊 2、預繳後退出 2。',
    )
    expect(wrapper.findAll('.stats-block__title').map((title) => title.text())).toEqual([
      '全程漏斗', '家庭在哪裡離開', '取消時點（距參觀日）', '各段要花多久',
    ])
    expect(block(wrapper, '全程漏斗').findAll('thead th').map((th) => th.text())).toEqual(['階段', '人數', '比率'])
    expect(block(wrapper, '家庭在哪裡離開').findAll('thead th').map((th) => th.text())).toEqual(['類別', '人數', '時點'])
    expect(block(wrapper, '取消時點（距參觀日）').findAll('thead th').map((th) => th.text())).toEqual(['距參觀日', '家長', '園方', '其他'])
    expect(block(wrapper, '各段要花多久').findAll('thead th').map((th) => th.text())).toEqual(['指標', '中位數', '筆數', '說明'])
  })

  it('全程漏斗與離開的列、各段天數', async () => {
    const { wrapper } = await mountJourney()
    expect(bodyRows(block(wrapper, '全程漏斗'))[0]).toEqual(['預約案件', '13', '取消率 23.1%（3／13）・樣本較少'])
    expect(bodyRows(block(wrapper, '全程漏斗')).map((row) => row[0])).toEqual(['預約案件', '已到場', '有招生訪視', '預繳過', '註冊過', '預繳後退出'])
    expect(bodyRows(block(wrapper, '家庭在哪裡離開')).map((row) => [row[0], row[1]])).toContainEqual(['參觀後未預繳・逾期', '1'])
    expect(bodyRows(block(wrapper, '各段要花多久'))[1]).toEqual(['參觀到預繳', '5 天', '3', '樣本較少；另有 1 筆沒有預繳日或日期倒置，不納入'])
  })

  it('涵蓋說明與改期數：沒有預約案件的訪視、已到場但沒有訪視、算不出參觀日的案件', async () => {
    const { wrapper } = await mountJourney()
    const text = wrapper.get('.journey-coverage').text()
    expect(text).toContain('另有 4 筆招生訪視沒有預約案件（現場參觀、舊名單補登），不在這個漏斗裡')
    expect(text).toContain('已到場但沒有招生訪視 1 筆')
    expect(text).toContain('預定參觀日算不出來而未納入的案件 2 筆')
    expect(text).toContain('改期過的案件 1／13')
  })

  it('沒有取消就不顯示取消時點表', async () => {
    const data = journeyData()
    const { wrapper } = await mountJourney({}, journeyData({ timing: { ...data.timing, cancel_before_visit: { ...data.timing.cancel_before_visit, n: 0 } } }))
    expect(wrapper.findAll('.stats-block__title').map((title) => title.text())).not.toContain('取消時點（距參觀日）')
  })

  it('這段期間沒有預約案件：只寫一句、不畫表', async () => {
    const { wrapper } = await mountJourney({}, journeyData({ cases: { total: 0, by_source: {} } }))
    expect(wrapper.text()).toContain('這段期間沒有預約案件')
    expect(wrapper.findAll('.stats-block')).toHaveLength(0)
  })

  it('讀取失敗：錯誤與重新載入，不畫舊數字', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(FROZEN))
    mockGet({ '/admin/admissions/journey': () => { throw new Error('boom') } })
    const { wrapper } = await mountWith(JourneyTab, { props: { campusKey: 'yihua', filter: { ...DEFAULT_JOURNEY_FILTER }, csvName: (t: string) => t } })
    await flushPromises()
    expect(wrapper.text()).toContain('無法讀取預約全程，請重新載入')
    expect(wrapper.findAll('.stats-block')).toHaveLength(0)
  })

  it('換來源重讀並把新篩選交給父層', async () => {
    const { wrapper, get } = await mountJourney()
    await wrapper.findAll('.el-radio-button').find((button) => button.text() === '官網預約')!.trigger('click')
    await flushPromises()
    expect(wrapper.emitted('update:filter')!.at(-1)![0]).toEqual({ period: '90', from: '', to: '', source: 'web' })
    wrapper.setProps({ filter: { period: '90', from: '', to: '', source: 'web' } })
    await flushPromises()
    const paths = pathsTo(get, '/admin/admissions/journey')
    expect(Object.fromEntries(queryOf(paths.at(-1)!)).source).toBe('web')
  })

  it('自訂區間沒選好不讀；選好才讀', async () => {
    const { get } = await mountJourney({ filter: { period: 'custom', from: '', to: '', source: 'all' } })
    expect(pathsTo(get, '/admin/admissions/journey')).toHaveLength(0)
  })

  it('匯出 CSV：每張表一個檔名，只有聚合數字', async () => {
    const { wrapper } = await mountJourney()
    await block(wrapper, '全程漏斗').get('[data-test="stats-csv"]').trigger('click')
    const [filename, csv] = vi.mocked(downloadCsv).mock.calls.at(-1)!
    expect(filename).toBe('招生統計-全程漏斗.csv')
    expect(csv.slice(1).split('\r\n')[0]).toBe('階段,人數,比率')
  })
})
```

- [ ] **Step 2：跑測試確認紅**

```bash
cd admin; source ~/.nvm/nvm.sh; nvm use 22; npx vitest run src/__tests__/journeyTab.test.ts
```

預期：找不到模組 `JourneyTab.vue`。

- [ ] **Step 3：實作三個區塊元件**

新檔 `admin/src/components/admissions/JourneyFunnel.vue`：

```vue
<script setup lang="ts">
import { computed } from 'vue'
import StatsDimensionTable from './StatsDimensionTable.vue'
import type { AdmissionsJourney } from '../../api/types'
import { funnelRows } from '../../admissions/journeyFormat'
import type { StatsColumn } from '../../admissions/statsFormat'

// 全程漏斗（2026-10-15 規格 §3.3）：預約案件 → 已到場 → 有招生訪視 → 預繳過 → 註冊過，再接預繳後退出。
// 每個階段是「曾經到達」，全部從同一批案件往下數；長條以預約案件數為 100%。比率附分子分母。
const props = defineProps<{ data: AdmissionsJourney; csvName: (title: string) => string }>()
const TITLE = '全程漏斗'
const COLUMNS: StatsColumn[] = [
  { key: 'stage', label: '階段', sticky: true },
  { key: 'count', label: '人數', kind: 'bar' },
  { key: 'rate', label: '比率' },
]
const rows = computed(() => funnelRows(props.data))
</script>

<template>
  <StatsDimensionTable
    :title="TITLE"
    :rows="rows"
    :columns="COLUMNS"
    row-key="key"
    empty-text="這段期間沒有預約案件"
    :export-filename="csvName(TITLE)"
    caption="每個階段是「曾經到達」：預繳過包含之後退出的，註冊過包含之後退註冊的；預繳後退出另列在最後。"
  />
</template>
```

新檔 `JourneyExits.vue`（離開表＋取消時點表）：

```vue
<script setup lang="ts">
import { computed } from 'vue'
import StatsDimensionTable from './StatsDimensionTable.vue'
import type { AdmissionsJourney } from '../../api/types'
import { cancelRows, exitRows } from '../../admissions/journeyFormat'
import type { StatsColumn } from '../../admissions/statsFormat'

// 家庭在哪裡離開（2026-10-15 規格 §3.3）：沒走到「預繳過」的家庭恰好分成前九類，預繳後退出另兩列；
// 取消另有「距參觀日」的分區表（家長、園方、其他分開）。沒有取消就沒有第二張表。
const props = defineProps<{ data: AdmissionsJourney; csvName: (title: string) => string }>()
const EXIT_TITLE = '家庭在哪裡離開'
const CANCEL_TITLE = '取消時點（距參觀日）'
const EXIT_COLUMNS: StatsColumn[] = [
  { key: 'kind', label: '類別', sticky: true },
  { key: 'count', label: '人數', kind: 'bar' },
  { key: 'timing', label: '時點' },
]
const CANCEL_COLUMNS: StatsColumn[] = [
  { key: 'bucket', label: '距參觀日', sticky: true },
  { key: 'parent', label: '家長', kind: 'count' },
  { key: 'staff', label: '園方', kind: 'count' },
  { key: 'other', label: '其他', kind: 'count' },
]
const exits = computed(() => exitRows(props.data))
const cancels = computed(() => cancelRows(props.data))
</script>

<template>
  <StatsDimensionTable
    :title="EXIT_TITLE"
    :rows="exits"
    :columns="EXIT_COLUMNS"
    row-key="key"
    empty-text="這段期間沒有預約案件"
    :export-filename="csvName(EXIT_TITLE)"
    caption="沒走到「預繳過」的家庭恰好分成前九類；預繳後退出是預繳過裡的一部分，另外列在最後。觀察中的家庭只是還沒到逾期，不預測他們會不會預繳。"
  />
  <StatsDimensionTable
    v-if="cancels.length"
    :title="CANCEL_TITLE"
    :rows="cancels"
    :columns="CANCEL_COLUMNS"
    row-key="key"
    empty-text="這段期間沒有取消"
    :export-filename="csvName(CANCEL_TITLE)"
    caption="取消日距預定參觀日幾天（以目前的場次為準，改過期的算最後那個場次）；「其他」是取消原因沒記或舊流程留下的占位原因。"
  />
</template>
```

新檔 `JourneyTiming.vue`：

```vue
<script setup lang="ts">
import { computed } from 'vue'
import StatsDimensionTable from './StatsDimensionTable.vue'
import type { AdmissionsJourney } from '../../api/types'
import { timingRows } from '../../admissions/journeyFormat'
import type { StatsColumn } from '../../admissions/statsFormat'

// 各段要花多久（2026-10-15 規格 §3.3）：中位數與筆數。預繳日是後台標記預繳的日期，補登或事後標記會讓天數偏長；
// 缺時間或日期倒置的不納入、另寫筆數。
const props = defineProps<{ data: AdmissionsJourney; csvName: (title: string) => string }>()
const TITLE = '各段要花多久'
const COLUMNS: StatsColumn[] = [
  { key: 'metric', label: '指標', sticky: true },
  { key: 'median', label: '中位數' },
  { key: 'n', label: '筆數', kind: 'count' },
  { key: 'note', label: '說明' },
]
const rows = computed(() => timingRows(props.data))
</script>

<template>
  <StatsDimensionTable
    :title="TITLE"
    :rows="rows"
    :columns="COLUMNS"
    row-key="key"
    empty-text="這段期間沒有預約案件"
    :export-filename="csvName(TITLE)"
    caption="預繳日是後台標記預繳的日期（最後一次標記），補登或事後標記的案件天數會偏長；之後退出的家庭也算預繳過；筆數不足 20 標「樣本較少」。"
  />
</template>
```


- [ ] **Step 4：實作 `JourneyTab.vue`**

新檔 `admin/src/components/admissions/JourneyTab.vue`：

```vue
<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import JourneyExits from './JourneyExits.vue'
import JourneyFunnel from './JourneyFunnel.vue'
import JourneyTiming from './JourneyTiming.vue'
import { getJourney } from '../../api/admissions'
import { campusLabel } from '../../api/labels'
import type { AdmissionsJourney } from '../../api/types'
import { taipeiToday } from '../../admissions/academic'
import {
  DEFAULT_JOURNEY_FILTER, JOURNEY_PERIODS, JOURNEY_SOURCES, journeyRange, journeySummary, type JourneyFilter,
} from '../../admissions/journeyFormat'
import { useNarrowScreen } from '../../composables/useNarrowScreen'
import { useRequestSequence } from '../../composables/useRequestSequence'

// 預約全程（2026-10-15 規格 §3.3）：同一批預約案件（預定參觀日在期間內、已過參觀時間）從預約到預繳、註冊的人數與
// 各段天數，以及家庭離開的時點。校區跟頁首；期間不看入學學年學期，所以學年學期下拉在這頁停用、期間在這裡選；
// 期間與來源由父層放在網址（filter）。只呈現後端算好的數字，不預測。
const props = defineProps<{ campusKey: string; csvName: (title: string) => string }>()
const filter = defineModel<JourneyFilter>('filter', { default: () => ({ ...DEFAULT_JOURNEY_FILTER }) })

const data = ref<AdmissionsJourney | null>(null)
const loading = ref(false)
const failed = ref(false)
const requests = useRequestSequence()
const narrow = useNarrowScreen()
const MAX_RANGE_DAYS = 400

const range = computed(() => journeyRange(filter.value, taipeiToday()))
const rangeTooLong = computed(() => {
  if (filter.value.period !== 'custom' || !range.value) return false
  const [from, to] = [range.value.from, range.value.to].map((day) => Date.parse(`${day}T00:00:00Z`))
  return (to! - from!) / 86_400_000 + 1 > MAX_RANGE_DAYS
})
const rangeMessage = computed(() => {
  if (filter.value.period !== 'custom') return ''
  if (!range.value) return '請選擇開始與結束日期。'
  if (rangeTooLong.value) return `自訂區間最長 ${MAX_RANGE_DAYS} 天，請把開始或結束日期調近一點。`
  if (range.value.from > range.value.to) return '開始日期不能晚於結束日期。'
  return ''
})

function isFutureDate(date: Date): boolean {
  const local = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  return local > taipeiToday()
}

const customRange = computed<[string, string] | null>({
  get: () => (filter.value.from && filter.value.to ? [filter.value.from, filter.value.to] : null),
  set: (value) => { filter.value = { ...filter.value, from: value?.[0] ?? '', to: value?.[1] ?? '' } },
})

async function load() {
  const request = requests.begin()
  const current = range.value
  if (!props.campusKey || !current || rangeMessage.value) {
    data.value = null
    failed.value = false
    loading.value = false
    return
  }
  loading.value = true
  failed.value = false
  try {
    const result = await getJourney({ campus_key: props.campusKey, from: current.from, to: current.to, source: filter.value.source })
    if (requests.isCurrent(request)) data.value = result
  } catch {
    if (requests.isCurrent(request)) {
      data.value = null
      failed.value = true
    }
  } finally {
    if (requests.isCurrent(request)) loading.value = false
  }
}

// 換校區：先清空再讀（不留別校的數字）；換期間或來源：保留上一次的數字、淡一點，讀完換掉。
watch(() => props.campusKey, () => { data.value = null; void load() })
watch(() => [filter.value.period, filter.value.from, filter.value.to, filter.value.source], () => void load(), { immediate: true })

const summary = computed(() => (data.value ? journeySummary(data.value, campusLabel(props.campusKey)) : ''))
const empty = computed(() => data.value !== null && data.value.cases.total === 0)
const coverage = computed(() => {
  const found = data.value
  if (!found) return ''
  const { coverage: cover, rescheduled } = found
  return [
    `另有 ${cover.visits_without_request} 筆招生訪視沒有預約案件（現場參觀、舊名單補登），不在這個漏斗裡。`,
    `已到場但沒有招生訪視 ${cover.completed_without_visit} 筆（招生功能關閉期間到場、事後沒補建，或訪視被刪）。`,
    cover.undated_cases ? `預定參觀日算不出來而未納入的案件 ${cover.undated_cases} 筆。` : '',
    `改期過的案件 ${rescheduled.cases}／${rescheduled.total}。`,
  ].filter(Boolean).join('')
})

function setPeriod(value: string | number | boolean | undefined) {
  const period = JOURNEY_PERIODS.find((option) => option.value === value)?.value
  if (period) filter.value = { ...filter.value, period, ...(period === 'custom' ? {} : { from: '', to: '' }) }
}
function setSource(value: string | number | boolean | undefined) {
  const source = JOURNEY_SOURCES.find((option) => option.value === value)?.value
  if (source) filter.value = { ...filter.value, source }
}
</script>

<template>
  <section class="journey" aria-label="預約全程">
    <div class="journey-controls">
      <label class="filter-field">
        <span>期間</span>
        <el-select :model-value="filter.period" aria-label="期間" @update:model-value="setPeriod">
          <el-option v-for="option in JOURNEY_PERIODS" :key="option.value" :label="option.label" :value="option.value" />
        </el-select>
      </label>
      <label v-if="filter.period === 'custom'" class="filter-field">
        <span>自訂區間</span>
        <el-date-picker
          v-model="customRange" type="daterange" value-format="YYYY-MM-DD" format="YYYY/MM/DD" unlink-panels :single-panel="narrow"
          :disabled-date="isFutureDate" :clearable="false" start-placeholder="開始" end-placeholder="結束" range-separator="–" aria-label="預約全程日期區間"
        />
      </label>
      <el-radio-group :model-value="filter.source" size="default" aria-label="來源" @update:model-value="setSource">
        <el-radio-button v-for="option in JOURNEY_SOURCES" :key="option.value" :value="option.value">{{ option.label }}</el-radio-button>
      </el-radio-group>
    </div>

    <p v-if="rangeMessage" class="field-help">{{ rangeMessage }}</p>
    <el-alert v-else-if="failed" type="error" :closable="false" show-icon title="無法讀取預約全程，請重新載入。" class="inline-error">
      <el-button size="small" @click="load()">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="!data" :rows="5" animated />
    <p v-else-if="empty" class="empty-note journey-empty">這段期間沒有預約案件。</p>
    <div v-else class="journey-body" :class="{ 'is-updating': loading }" :aria-busy="loading">
      <p class="journey-summary">{{ summary }}</p>
      <JourneyFunnel :data="data" :csv-name="csvName" />
      <JourneyExits :data="data" :csv-name="csvName" />
      <JourneyTiming :data="data" :csv-name="csvName" />
      <p class="hint journey-coverage">{{ coverage }}</p>
    </div>
  </section>
</template>

<style scoped>
.journey {
  display: grid;
  gap: 12px;
  min-width: 0;
}

.journey-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 12px;
}

.journey-body {
  display: grid;
  gap: 16px;
  min-width: 0;
}

.journey-body.is-updating {
  opacity: 0.6;
}

.journey-summary {
  margin: 0;
  color: var(--ink);
}

.journey-coverage {
  margin: 0;
}

@media (max-width: 720px) {
  .journey-controls > * {
    max-width: 100%;
  }
}
</style>
```

- [ ] **Step 5：接進 `StatsTab` 與 `AdmissionsView`**

`admin/src/components/admissions/StatsTab.vue`：
(a) import：`import JourneyTab from './JourneyTab.vue'`、`import type { JourneyFilter } from '../../admissions/journeyFormat'`、`import { DEFAULT_JOURNEY_FILTER } from '../../admissions/journeyFormat'`。
(b) `const sub = defineModel<StatsSub>('sub', { default: 'overview' })` 後面加 `const journey = defineModel<JourneyFilter>('journey', { default: () => ({ ...DEFAULT_JOURNEY_FILTER }) })`。
(c) 把 `const bookingSub = computed(() => sub.value === 'booking')` 改成：

```ts
// 「參觀預約」與「預約全程」讀自己的 API、不用招生統計：兩個子分頁都不等招生統計，上方的統計範圍與說明不顯示。
const ownDataSub = computed(() => sub.value === 'booking' || sub.value === 'journey')
```

並把模板裡三處 `bookingSub` 換成 `ownDataSub`（`v-if="!bookingSub"` → `v-if="!ownDataSub"`；`v-if="stats || failed || bookingSub"` → `v-if="stats || failed || ownDataSub"`；`v-loading="loading && !bookingSub"` → `v-loading="loading && !ownDataSub"`）。
(d) 在「參觀預約」的 `el-tab-pane` 後面加：

```vue
      <el-tab-pane label="預約全程" name="stats-journey" lazy>
        <JourneyTab v-model:filter="journey" :campus-key="campusKey" :csv-name="csvName" />
      </el-tab-pane>
```

(e) 檔頭註解補一句：「『預約全程』（2026-10-15，JourneyTab）同樣讀自己的 API，期間與來源由頁面放在網址（journey）。」

`admin/src/views/AdmissionsView.vue`：
(a) 解構 `useAdmissionsFilters()` 的那行補上 `journey`（`campus, schoolYear, semester, tab, visitRequestId, month, area, sub, journey, …`）。
(b) `termless` 改成 `const termless = computed(() => tab.value === 'stats' && (sub.value === 'booking' || sub.value === 'journey'))`，註解補「預約全程同理」。
(c) `<StatsTab` 加 `v-model:journey="journey"`（接在 `v-model:sub="sub"` 後面）。

- [ ] **Step 6：測試與 typecheck**

`statsTab.test.ts` 若有斷言子分頁清單或 `bookingSub` 行為的案例，補上「預約全程」並加一個案例：`sub=journey` 時不顯示統計範圍工具列、不等 `/stats`（比照既有 booking 案例的寫法，`grep -n "booking" admin/src/__tests__/statsTab.test.ts` 找）。`admissionsView.test.ts` 的 Task 3 Step 5 案例 (g)(h) 現在應該通過。然後（一次一個檔）：

```bash
cd admin; source ~/.nvm/nvm.sh; nvm use 22; npx vitest run src/__tests__/journeyTab.test.ts; npx vitest run src/__tests__/journeyFormat.test.ts; npx vitest run src/__tests__/statsTab.test.ts; npx vitest run src/__tests__/admissionsView.test.ts; npm run typecheck
```

預期：全部通過、typecheck 無錯誤。若 `admissionsView.test.ts` 有 `STATS_SUBS` 完整清單的斷言要同步補上 `'journey'`（Task 3 已處理，這裡確認）。

- [ ] **Step 7：Commit**

```bash
git add admin/src/components/admissions/JourneyTab.vue admin/src/components/admissions/JourneyFunnel.vue admin/src/components/admissions/JourneyExits.vue admin/src/components/admissions/JourneyTiming.vue admin/src/components/admissions/StatsTab.vue admin/src/views/AdmissionsView.vue admin/src/__tests__/journeyTab.test.ts admin/src/__tests__/statsTab.test.ts admin/src/__tests__/admissionsView.test.ts
git commit -m "feat(admin): 統計分析新增「預約全程」子分頁（漏斗、離開時點、各段天數）

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5：stack e2e（真實資料庫＋瀏覽器）

**Files:**
- Modify: `tests/stack/db.ts`
- Create: `tests/stack/admissions-journey.spec.ts`

**Interfaces:**
- Consumes（Task 2、4）：`/admin/admissions/journey`；Task 4 的 DOM（`.journey-summary`、`.journey-coverage`、四張表的標題與欄位、`aria-label="來源"` 的 radio group）。
- Produces：`db.ts` 匯出 `seedJourney(): void`（冪等）與 `clearJourney(): void`。

校區用 `renwu`（計畫裁定 P8），種子的家長姓名與幼生姓名都以「E2E旅程」開頭，測試結束（含失敗）一律清除。日期都相對「台北今天」，預設期間（最近 3 個月）涵蓋全部。8 筆預約（每筆送出日＝場次日 − 7）：

| 代號 | 結局 | 場次日 | 招生訪視 | 其他 |
|---|---|---|---|---|
| A | 到場 | D−30 | 有；預繳（事件 D−20 12:00）、註冊（`enrolled_on` D−10） | |
| B | 到場 | D−25 | 有；沒預繳（逾期 25 天） | |
| C | 到場 | D−5 | 有；沒預繳（觀察中 5 天） | |
| D | 到場 | D−15 | 沒有 | 到場但沒有訪視 |
| E | 沒來 | D−12 | — | |
| F | 家長取消 | D−9 | — | 取消日 D−9（當天） |
| G | 園方取消 | D−8 | — | 取消日 D−12（4 天前） |
| H | 到場 | D−40 | 有；預繳（事件 D−35）、退預繳（`withdrawn_at` D−20） | |

另有一筆手動新增的訪視（沒有預約案件，`visit_date` D−3）。期望：預約案件 8；到場 5、沒來 1、取消 2（家長 1、園方 1）、未標記 0；有訪視 4、已到場但沒有訪視 1、預繳過 2、註冊過 1、預繳後退出 1（退預繳 1）；未預繳 觀察中 1、逾期 1、冷名單 0；比率 到場率 5／6＝83.3%、取消率 2／8＝25.0%、有訪視比例 4／5＝80.0%、預繳率 2／4＝50.0%、註冊率 1／2＝50.0%、退出比例 1／2＝50.0%；提前量 7 天（8 筆）；參觀到預繳 A＝10、H＝5 → 中位數 7.5 天、2 筆；預繳到註冊 10 天、1 筆；預繳到退出 15 天、1 筆；取消時點 家長「當天」1、園方「4–7 天前」1；涵蓋 沒有預約案件的訪視 1、已到場但沒有訪視 1。

- [ ] **Step 1：`tests/stack/db.ts` 新增種子與清除**

在檔尾新增：

```ts
// 預約全程（2026-10-15）：用 renwu 校區寫一批預約案件、場次、事件與招生訪視，日期相對台北今天。
// 標記：家長姓名與幼生姓名都以「E2E旅程」開頭，clearJourney 靠它清；每筆預約送出日＝場次日 − 7。
const JOURNEY_CAMPUS = 'renwu'
const JOURNEY_MARK = 'E2E旅程'

/** 民國月份「115.09」（recruitment_visits.month）：同後端 academic.roc_month。 */
const rocMonth = (dayExpr: string): string => `((extract(year from ${dayExpr})::int - 1911)::text || '.' || to_char(${dayExpr}, 'MM'))`

/** 台北今天往前推 n 天的日期運算式（SQL）。 */
const day = (n: number): string => `((now() AT TIME ZONE 'Asia/Taipei')::date - ${n})`
/** 台北某天的牆上時間（timestamptz，SQL）。 */
const at = (n: number, time = '12:00'): string => `((${day(n)} + time '${time}') AT TIME ZONE 'Asia/Taipei')`

interface JourneyCase {
  tag: string
  status: 'completed' | 'no_show' | 'cancelled'
  slotDays: number
  cancelledDays?: number
  cancelReason?: 'parent' | 'staff'
  visit?: { deposited?: boolean; depositEventDays?: number; enrolledDays?: number; withdrawnDays?: number }
}

const JOURNEY_CASES: JourneyCase[] = [
  { tag: 'A', status: 'completed', slotDays: 30, visit: { deposited: true, depositEventDays: 20, enrolledDays: 10 } },
  { tag: 'B', status: 'completed', slotDays: 25, visit: {} },
  { tag: 'C', status: 'completed', slotDays: 5, visit: {} },
  { tag: 'D', status: 'completed', slotDays: 15 },
  { tag: 'E', status: 'no_show', slotDays: 12 },
  { tag: 'F', status: 'cancelled', slotDays: 9, cancelledDays: 9, cancelReason: 'parent' },
  { tag: 'G', status: 'cancelled', slotDays: 8, cancelledDays: 12, cancelReason: 'staff' },
  { tag: 'H', status: 'completed', slotDays: 40, visit: { deposited: true, depositEventDays: 35, withdrawnDays: 20 } },
]

function journeyStatements(): string {
  const parts: string[] = []
  for (const item of JOURNEY_CASES) {
    const name = `${JOURNEY_MARK}${item.tag}`
    parts.push(`
      WITH slot AS (
        INSERT INTO visit_slots (id, campus_key, slot_date, start_time, end_time, capacity, closed, version, from_rule, created_at)
        VALUES (gen_random_uuid(), '${JOURNEY_CAMPUS}', ${day(item.slotDays)}, time '10:00', time '11:00', 99, false, 1, false, now())
        RETURNING id
      ), request AS (
        INSERT INTO visit_requests (id, campus_key, idempotency_key, payload_hash, config_version, parent_name, phone,
                                    consent_given, status, source, slot_id, created_at, cancelled_at, cancel_reason, version)
        SELECT gen_random_uuid(), '${JOURNEY_CAMPUS}', 'e2e-journey-${item.tag}-' || gen_random_uuid()::text, repeat('0', 64), 0,
               '${name}', '0911000444', true, '${item.status}', 'web', slot.id, ${at(item.slotDays + 7, '09:00')},
               ${item.cancelledDays === undefined ? 'NULL' : at(item.cancelledDays, '08:00')},
               ${item.cancelReason ? `'${item.cancelReason}'` : 'NULL'}, 1
          FROM slot
        RETURNING id
      )
      ${
        item.visit
          ? `, visit AS (
        INSERT INTO recruitment_visits (id, campus_key, visit_request_id, month, visit_date, child_name, has_deposit, rides_bus, enrolled,
                                        enrolled_on, withdrawn_at, withdrawn_from, withdraw_reason, transfer_term, version, created_at, updated_at)
        SELECT gen_random_uuid(), '${JOURNEY_CAMPUS}', request.id, ${rocMonth(day(item.slotDays))}, ${day(item.slotDays)},
               '${name}', ${item.visit.deposited ? 'true' : 'false'}, false, ${item.visit.enrolledDays === undefined ? 'false' : 'true'},
               ${item.visit.enrolledDays === undefined ? 'NULL' : day(item.visit.enrolledDays)},
               ${item.visit.withdrawnDays === undefined ? 'NULL' : at(item.visit.withdrawnDays)},
               ${item.visit.withdrawnDays === undefined ? 'NULL' : `'deposited'`},
               ${item.visit.withdrawnDays === undefined ? 'NULL' : `'E2E旅程退出'`}, false, 1, now(), now()
          FROM request
        RETURNING id
      )
      ${
        item.visit.depositEventDays === undefined
          ? 'SELECT 1'
          : `INSERT INTO recruitment_event_log (id, recruitment_visit_id, event_type, to_stage, created_at)
      SELECT gen_random_uuid(), visit.id, 'deposit_added', 'deposited', ${at(item.visit.depositEventDays)} FROM visit`
      }`
          : 'SELECT 1'
      };`)
  }
  // 沒有預約案件的訪視（現場參觀）：參觀日 D−3。
  parts.push(`
    INSERT INTO recruitment_visits (id, campus_key, month, visit_date, child_name, has_deposit, rides_bus, enrolled, transfer_term, version, created_at, updated_at)
    VALUES (gen_random_uuid(), '${JOURNEY_CAMPUS}', ${rocMonth(day(3))}, ${day(3)}, '${JOURNEY_MARK}現場', false, false, false, false, 1, now(), now());`)
  return parts.join('\n')
}

/** 清除預約全程的種子（重複執行無害）。順序：訪視（連事件）→ 預約（連事件）→ 場次。 */
export function clearJourney(): void {
  psql(
    `CREATE TEMP TABLE journey_slots AS
       SELECT DISTINCT slot_id FROM visit_requests WHERE parent_name LIKE '${JOURNEY_MARK}%' AND slot_id IS NOT NULL;
     DELETE FROM recruitment_visits WHERE child_name LIKE '${JOURNEY_MARK}%';
     DELETE FROM visit_requests WHERE parent_name LIKE '${JOURNEY_MARK}%';
     DELETE FROM visit_slots WHERE id IN (SELECT slot_id FROM journey_slots);`,
    {},
  )
}

/** 先清再寫，所以重複執行不會重複。 */
export function seedJourney(): void {
  clearJourney()
  psql(journeyStatements(), {})
}
```

SQL 欄位已對照 `VisitSlot`、`VisitRequest`、`RecruitmentVisit`、`RecruitmentEventLog` 的 NOT NULL 欄位（`referral_sources` 有 server_default 所以不寫；`recruitment_visits.enrolled = true` 必須有 `enrolled_on`，種子 A 已給）。先在 psql 對測試庫跑一次確認 INSERT 成功。

- [ ] **Step 2：新增 spec**

新檔 `tests/stack/admissions-journey.spec.ts`：

```ts
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { clearJourney, seedJourney } from './db'
import { expectNoHorizontalOverflow, gotoAdmin, openAs } from './pages'
import { ROOT } from './stack-env'

// 預約全程（2026-10-15 規格 §4）：用 db.ts 在 renwu 校區寫一批案件（8 筆預約＋1 筆現場訪視），日期相對今天；
// 驗證漏斗、離開、取消時點與各段天數的數字，1440／390 不橫向溢出與 axe，再給人看截圖。測試結束一律清除種子。
const CAMPUS = 'renwu'
const SHOTS = path.join(ROOT, 'output/playwright')
const journeyPath = `/admissions?campus=${CAMPUS}&tab=stats&sub=journey`

const block = (page: Page, title: string): Locator =>
  page.locator('.stats-block', { has: page.locator('.stats-block__title', { hasText: title }) }).first()
const rowTexts = async (section: Locator): Promise<string[][]> =>
  section.locator('tbody tr').evaluateAll((rows) => rows.map((row) => [...row.querySelectorAll('th, td')].map((cell) => (cell.textContent ?? '').trim())))

test.beforeEach(() => seedJourney())
test.afterEach(() => clearJourney())

test('預約全程：漏斗、離開、取消時點、各段天數與涵蓋說明', async ({ browser }) => {
  test.setTimeout(90_000)
  mkdirSync(SHOTS, { recursive: true })
  const { context, page } = await openAs(browser, 'super_admin')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await gotoAdmin(page, journeyPath, '招生入學')

  await test.step('摘要句與漏斗表', async () => {
    await expect(page.locator('.journey-summary')).toContainText('預定參觀的預約 8 筆：到場 5（到場率 83.3%）、取消 2、沒來 1、時間已過未標記 0。')
    await expect(page.locator('.journey-summary')).toContainText('到場的 5 筆中 4 筆有招生紀錄，預繳 2、註冊 1、預繳後退出 1。')
    expect(await rowTexts(block(page, '全程漏斗'))).toEqual([
      ['預約案件', '8', '取消率 25.0%（2／8）・樣本較少'],
      ['已到場', '5', '到場率 83.3%（5／6）・樣本較少'],
      ['有招生訪視', '4', '有訪視比例 80.0%（4／5）・樣本較少'],
      ['預繳過', '2', '預繳率 50.0%（2／4）・樣本較少'],
      ['註冊過', '1', '註冊率 50.0%（1／2）・樣本較少'],
      ['預繳後退出', '1', '退出比例 50.0%（1／2）・樣本較少'],
    ])
  })

  await test.step('家庭在哪裡離開：取消、沒來、沒有訪視、觀察中與逾期、退預繳', async () => {
    const rows = await rowTexts(block(page, '家庭在哪裡離開'))
    expect(rows.map((row) => [row[0], row[1]])).toEqual([
      ['已取消・家長', '1'], ['已取消・園方', '1'], ['已取消・其他或沒記', '0'], ['沒來', '1'], ['時間已過未標記', '0'],
      ['已到場但沒有招生訪視', '1'], ['參觀後未預繳・觀察中', '1'], ['參觀後未預繳・逾期', '1'], ['參觀後未預繳・冷名單', '0'],
      ['預繳後退出・退預繳', '1'], ['預繳後退出・退註冊', '0'],
    ])
  })

  await test.step('取消時點：家長當天、園方 4–7 天前', async () => {
    const rows = await rowTexts(block(page, '取消時點（距參觀日）'))
    expect(rows.find((row) => row[0] === '當天')).toEqual(['當天', '1', '0', '0'])
    expect(rows.find((row) => row[0] === '4–7 天前')).toEqual(['4–7 天前', '0', '1', '0'])
  })

  await test.step('各段要花多久', async () => {
    expect(await rowTexts(block(page, '各段要花多久'))).toEqual([
      ['預約提前量（預約送出到預定參觀日）', '7 天', '8', '樣本較少'],
      ['參觀到預繳', '7.5 天', '2', '樣本較少'],
      ['預繳到註冊', '10 天', '1', '樣本較少'],
      ['預繳到退出', '15 天', '1', '樣本較少'],
    ])
  })

  await test.step('涵蓋說明：現場訪視不在漏斗裡', async () => {
    const text = await page.locator('.journey-coverage').innerText()
    expect(text).toContain('另有 1 筆招生訪視沒有預約案件')
    expect(text).toContain('已到場但沒有招生訪視 1 筆')
  })

  await test.step('切到「官網預約」「後台補登」：數字跟著變、網址帶來源', async () => {
    await page.getByRole('radio', { name: '後台補登' }).check({ force: true })
    await expect(page.locator('.journey-empty')).toBeVisible() // 種子都是官網預約，後台補登沒有案件
    await expect(page).toHaveURL(/js=assisted/)
    await page.getByRole('radio', { name: '全部' }).check({ force: true })
    await expect(page.locator('.journey-summary')).toContainText('預約 8 筆')
  })

  await test.step('新區塊沒有 serious／critical 的無障礙問題', async () => {
    const results = await new AxeBuilder({ page }).include('.journey').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    const serious = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    expect(serious.map((violation) => `${violation.id}：${violation.nodes.map((node) => node.target.join(' ')).join('；')}`)).toEqual([])
  })

  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: path.join(SHOTS, 'admissions-journey-1440.png'), fullPage: true })
  expect(errors, '頁面不該有未處理的錯誤').toEqual([])
  await context.close()
})

test('390px：預約全程不撐出頁面', async ({ browser }) => {
  mkdirSync(SHOTS, { recursive: true })
  const { context, page } = await openAs(browser, 'super_admin', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await gotoAdmin(page, journeyPath, '招生入學')
  await expect(page.locator('.journey-summary')).toBeVisible()
  await expect(block(page, '全程漏斗')).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: path.join(SHOTS, 'admissions-journey-390.png'), fullPage: true })
  await context.close()
})
```

- [ ] **Step 3：build 並跑這兩個案例（背景，控制者看結果）**

```bash
cd ~/Repositories/ivy-website-wt/booking-journey-20261015 && source ~/.nvm/nvm.sh; nvm use 22
export E2E_DB_NAME=ivy_website_journey1015_e2e_test E2E_API_PORT=8744 E2E_WEB_PORT=3744
npm run e2e:build
npx playwright test -c playwright.stack.config.ts --workers=1 tests/stack/admissions-journey.spec.ts
```

預期：2 個案例通過（外加 setup）。再人工看 `output/playwright/admissions-journey-1440.png`、`-390.png`：四塊表由上而下、摘要句在最上面、涵蓋說明在最下面、手機沒有橫向溢出。若漏斗表的比率文字與預期不同（例如分母不足 20 的標記），先確認是不是 Task 4 的格式函式與計畫不一致，不要只改測試。

- [ ] **Step 4：Commit**

```bash
git add tests/stack/db.ts tests/stack/admissions-journey.spec.ts
git commit -m "test(e2e): 預約全程（漏斗、離開、取消時點、各段天數、涵蓋說明、手機不溢出）

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6：文件與規格對齊

**Files:**
- Modify: `DESIGN.md`、`README.md`、`docs/specs/2026-10-15-booking-journey-design.md`

**Interfaces:** 無（只改文件）。

- [ ] **Step 1：DESIGN.md 新增一節**

在 `DESIGN.md` 的「招生入學：多年出生數走勢」那一節的結尾後面、下一個 `## ` 之前（`grep -n "^## 招生入學：多年出生數走勢" DESIGN.md` 找位置）插入：

```markdown
## 招生入學：預約全程漏斗與退出時點（2026-10-15，`feature/booking-journey-20261015`）

招生判讀第四個子專案。招生人員問不出「官網預約進來的家庭，在哪一步、什麼時候流失」：預約端的統計止於「已完成參觀」，招生端的漏斗從「已訪視」才開始，兩套資料唯一的連結 `recruitment_visits.visit_request_id` 沒有任何統計用到。規格 `docs/specs/2026-10-15-booking-journey-design.md`。

- **一批家庭**：預定參觀日落在所選期間、已過參觀時間的預約案件，一案一筆；官網與後台補登都算，來源可篩（預設全部）。同批追蹤，所有階段從同一批往下數，所以數字只會遞減；尚未到參觀時間的不納入，避免混進分母（不同批不互除，R:102–104）。預定參觀日沿用預約列表的「參觀日」算法（改期過的算最後場次、提早到場釋出場次者取到場標記日）。
- **階段與離開**：預約案件 → 已到場 → 有招生訪視 → 預繳過 → 註冊過；每個階段是「曾經到達」（預繳過含之後退出、註冊過含之後退註冊）。沒走到預繳過的家庭恰好分成：取消（家長、園方、其他）、沒來、時間已過未標記、已到場但沒有訪視、參觀後未預繳（觀察中 0–13 天、逾期 14–89 天、冷名單 90 天以上，門檻沿用「未預繳」）；預繳後退出（退預繳、退註冊）是預繳過的子集，另列。
- **各段天數**：預約提前量、參觀到預繳、預繳到註冊、預繳到退出（中位數與筆數）；取消時點分區（當天、1 天前、2–3 天前、4–7 天前、8 天以上，另有參觀日之後才取消，家長與園方分開）。缺時間或日期倒置的不納入、另寫筆數。預繳日沿用預繳速度：最後一筆 `deposit_added` 的台北日，補登或事後標記會讓天數偏長。
- **涵蓋說明**：漏斗只含有預約案件的家庭；沒有預約案件的訪視（現場參觀、舊名單補登）、已到場但沒有訪視（招生功能關閉期間到場、事後沒補建，或訪視被刪）、預定參觀日算不出來的案件，各自列筆數，不估算。
- **做法**：讀取時彙整，不改資料表、不新增 migration；`journey.py` 分「純函式彙整」與「查庫」兩層；API `GET /admin/admissions/journey`（`admissions.read` 加校區範圍，唯讀不寫稽核）。畫面是統計分析的新子分頁「預約全程」，四塊各自一張 `StatsDimensionTable`（不嵌套），期間與來源寫進網址（`jp`、`jf`、`jt`、`js`）。
- **不做**：預測與評分（觀察中的家庭不預測會不會預繳）、退出原因統計（`withdraw_reason` 是自由文字、原因代碼另案）、首次聯絡延遲與聯絡紀錄分析、預約提前量與額滿的關係、跨校合併、補欄位或回補舊資料、公開官網顯示。
- **限制**：連結涵蓋率（招生訪視只在招生功能開啟、標記到場時建立）；預繳日失真；editor／readonly 沒有 `admissions.read`，看不到這一頁（10-13 的入口問題不能補回）。
```

- [ ] **Step 2：README.md 頂部加日期段落**

在 `README.md` 最上方（第一個既有的 `## 2026-10-14 …` 或最新日期標題之前）插入（驗證條由 Task 7 回填）：

```markdown
## 2026-10-15 預約全程漏斗與退出時點（`feature/booking-journey-20261015`）

招生判讀四個子專案的第四個（最後一個）。統計分析多一個子分頁「預約全程」：官網預約與後台補登的同一批預約案件，從預約、到場、有招生訪視、預繳、註冊各階段的人數與比率（附分子分母），各段花多久（預約提前量、參觀到預繳、預繳到註冊、預繳到退出，中位數與筆數），以及家庭離開的時點（取消距參觀日幾天、沒來、時間已過未標記、已到場但沒有訪視、參觀後未預繳的觀察中／逾期／冷名單、預繳後退出）。規格 `docs/specs/2026-10-15-booking-journey-design.md`，規則見 DESIGN.md「招生入學：預約全程漏斗與退出時點」。

- **資料**：讀取時彙整，不新增 migration、不改資料表；時間取自預約事件（到場、改期）與招生事件（`deposit_added`）與既有欄位（取消、註冊、退出）。
- **涵蓋**：只含有預約案件的家庭；沒有預約案件的訪視、已到場但沒有訪視、參觀日算不出來的案件各自列筆數。招生功能關閉期間到場、事後沒補建的案件會讓漏斗後半段偏低。
- **權限**：`admissions.read` 加校區範圍；editor、readonly 看不到這一頁（10-13「參觀預約」搬走後留下的入口問題不能由這頁補回）。
- **不做**：預測與評分、退出原因統計（自由文字、無代碼）、首次聯絡延遲、跨校合併、補欄位。
```

- [ ] **Step 3：規格對齊實作**

編輯 `docs/specs/2026-10-15-booking-journey-design.md`：

(a) §1.2 表 J7 的裁定欄「預繳過＝`has_deposit` 或 `withdrawn_at` 非空」改成「預繳過＝`has_deposit`、`enrolled` 或 `withdrawn_at` 非空」，理由欄補一句「註冊的一定預繳過，舊資料可能沒有預繳旗標，不補上會破壞『註冊過 ⊂ 預繳過』（計畫裁定 P6）」。

(b) §3.3 最後一段的「`JourneySummary`／`JourneyFunnel`／`JourneyExits`／`JourneyTiming` 四個區塊元件」改成「`JourneyFunnel`／`JourneyExits`／`JourneyTiming` 三個區塊元件（摘要句直接在 `JourneyTab.vue`，計畫裁定 P1）」。

(c) §3.2 第 2 點「載入」之後補一句：「預定參觀日算不出來的案件無法歸到期間，改以預約送出日（台北日）落在期間內的計入涵蓋說明的 `undated_cases`（計畫裁定 P2）。」

(d) §1.2 表 J14 補一句：「網址參數 `jp`（期間，預設 90 天不寫）、`jf`／`jt`（自訂起訖）、`js`（來源，全部不寫），只在 `sub=journey` 時寫（計畫裁定 P7）。」

(e) 檔尾新增：

```markdown
## 8. 實作紀錄

- 實作計畫 `docs/superpowers/plans/2026-10-15-booking-journey.md`，分支 `feature/booking-journey-20261015`。
- 與規格的差異（計畫裁定）：P1 摘要句不另開元件；P2 預定參觀日算不出來的案件以送出日計入涵蓋說明；P3 `to` 截到今天後 `from > to` 回 422；P4 預約結果的分類直接 import `_outcome`；P6 預繳過含 `enrolled`；P7 網址參數 `jp`／`jf`／`jt`／`js`；P8 e2e 用 `renwu` 並在結束時清除種子；P10 預繳到退出只給合計一組天數；`as_of` 放在回應最上層而不是 `filters` 內；各段天數的筆數不足 20 也標「樣本較少」（規格 §6.5）。
```

- [ ] **Step 4：檢查並 Commit**

```bash
grep -n "TBD\|TODO\|待補" DESIGN.md README.md docs/specs/2026-10-15-booking-journey-design.md | head
git add DESIGN.md README.md docs/specs/2026-10-15-booking-journey-design.md
git commit -m "docs: 預約全程漏斗與退出時點（口徑、限制、與規格的差異）

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

預期：grep 在本案新增的段落沒有占位字（README／DESIGN 其他舊段落的「待補」不算）。

---

### Task 7：全套驗證（控制者在背景分開跑，不交給子代理）

- [ ] **Step 1：後端全套**（約 20 分鐘；背景；一次只跑這一組）

```bash
cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_journey1015_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen pytest -q -p no:cacheprovider
```

預期：0 failed。

- [ ] **Step 2：admin 全套、typecheck、契約**

```bash
cd admin && source ~/.nvm/nvm.sh; nvm use 22; npx vitest run
npm run typecheck; (cd ../web && npm run typecheck)
cd ../backend && env -i PATH="$PATH" HOME="$HOME" .venv/bin/python scripts/export_openapi.py --check && cd .. && node scripts/check-contract-types.mjs
```

預期：全部通過（高負載下 5000ms 逾時的檔改 `--testTimeout=60000` 重跑並寫明）。

- [ ] **Step 3：stack 全套**（背景）

```bash
export E2E_DB_NAME=ivy_website_journey1015_e2e_test E2E_API_PORT=8744 E2E_WEB_PORT=3744
npm run e2e:build && npx playwright test -c playwright.stack.config.ts
```

預期：0 failed（高負載逾時的案例單獨重跑確認，並如實寫在紀錄）。人工看截圖 `output/playwright/admissions-journey-1440.png`、`-390.png`。

- [ ] **Step 4：回填 README 驗證條，再對一次 `origin/main`**

在 `README.md` 本案段落補「驗證」條（各數字註明跑在哪個 commit；沒做的事：沒有在正式站與真實資料驗證、沒有登入正式後台看畫面、正式資料的連結率沒查）；`git fetch origin`，若 main 有新 commit（特別是動 `StatsTab.vue`、`useAdmissionsFilters.ts`、`schemas.py`、契約檔的）就 merge 並重跑契約與受影響的測試；commit。

- [ ] **Step 5：交付**

回報：完成摘要、驗證結果、計畫裁定與實作中的新裁定、需要使用者決定的事（`feature/booking-journey-20261015` 要不要 push main＝部署；editor／readonly 看不到這頁的問題）。**不自己 push。**
