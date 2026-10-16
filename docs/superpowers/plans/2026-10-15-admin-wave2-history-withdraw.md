# 第 2 波：招生歷程兩種事件＋退出原因分類 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 招生歷程多記「修改招生資料」「排下次聯絡」兩種官網專用事件；退預繳、退註冊改成必選八項「退出原因分類」（說明選填），可篩選、匯出、補分類，統計分析多一張「退出原因分佈」，轉給園務的資料不需要園務改程式。

**Architecture:** 歷程事件只在既有 service（`records.update_visit`、`follow_up.update_follow_up`、`booking_link.sync_from_visit_request`）同一個交易內多寫一筆 `recruitment_event_log`，標成 `WEBSITE_ONLY_EVENT_TYPES`，不動資料表與園務列舉。退出原因加一個可空欄位 `recruitment_visits.withdraw_reason_category`（一支 migration、兩條 CHECK），轉換、補分類、篩選、CSV、統計、JSONL 匯出各自補一段；前端照「未預繳原因」的先例手抄常數、原始碼比對。

**Tech Stack:** FastAPI 0.136.1（釘版）、SQLAlchemy 2.0、Alembic、PostgreSQL、pytest；Vue 3 + TypeScript + Element Plus、vitest；Playwright stack e2e；openapi-typescript 契約。

**Spec:**
- `docs/specs/2026-10-15-admissions-history-events-design.md`（歷程事件，H1–H9）
- `docs/specs/2026-10-15-withdraw-reason-category-design.md`（退出原因，W1–W10）

兩份都是使用者 10-15 核可（W6 統計位置也已同意）。基準 `origin/main` `aae0debc`（migration head `c6a9e3f15d27`），開工時 rebase 到當時最新的 `origin/main`。

> **分支**：兩份規格的「分支」欄寫各自分支（`feature/admissions-history-events-20261015`、`feature/withdraw-reason-20261015`）；本計畫合為一支 `feature/admin-wave2-20261015`：先做歷程事件（Task 1–2，不動資料表），再做退出原因（Task 3–7，一支 migration）。退出原因的「補分類」走 PATCH records，會自動產生歷程事件，所以順序不能反。

## 共通規則與指令

- 繁體中文（台灣用語），技術名詞與識別符保留原文。commit 訊息繁體中文、Conventional Commit，結尾一行空白後 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。`git add` 一律列出檔名，**禁止** `git add .`、`-A`、`commit -a`；不 push。
- 顏色只走 token（`var(--…)`）；畫面不放開發輔助用字；不裝圖表套件。
- 機器 8GB RAM：一次只跑一組測試；子代理不跑後端全套 pytest、admin 全套 vitest、stack 全套（超過 10 分鐘無輸出會被 watchdog 殺），全套由控制者在 Task 10 背景分開跑。
- worktree：`~/Repositories/ivy-website-wt/admin-wave2-20261015`（分支 `feature/admin-wave2-20261015`），以下指令都從它的根目錄出發。
- 後端單檔測試（`WEBSITE_*` 逐一寫在同一行；測試庫由控制者在 Task 0 建好）：
  `cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_wave2_1015_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen pytest -q -p no:cacheprovider <檔案或 node id>`
  以下簡寫為 `PYTEST <檔案>`。
- 前端：`cd admin; source ~/.nvm/nvm.sh; nvm use 22; VITEST_MAX_FORKS=2 npx vitest run <檔案>`、`npm run typecheck`（`source nvm.sh` 會 exit 3，用分號串接、不要用 `&&`）。高負載下 `Test timed out in 5000ms` 就加 `--testTimeout=60000` 重跑並在報告寫明。以下簡寫為 `VITEST <檔案>`。
- 契約：**不要用 `npm run contract:check`／`contract:generate`**（內含 `uv run`，會改到共用 venv 的 `.pth`）。
  - 重新產生：`cd backend && env -i PATH="$PATH" HOME="$HOME" .venv/bin/python scripts/export_openapi.py && cd .. && source ~/.nvm/nvm.sh; npx openapi-typescript contracts/openapi.json -o contracts/generated/website-api.d.ts`
  - 檢查：`cd backend && env -i PATH="$PATH" HOME="$HOME" .venv/bin/python scripts/export_openapi.py --check && cd .. && node scripts/check-contract-types.mjs`
  以下簡寫為 `CONTRACT_GEN`、`CONTRACT_CHECK`。

## Global Constraints

（逐字取自兩份規格的裁定欄；每個 task 都隱含這一節。）

歷程事件
- **H1**：新增 `details_updated`（修改招生資料）與 `follow_up_updated`（排下次聯絡）。
- **H2**：兩者加進 `WEBSITE_ONLY_EVENT_TYPES`，匯出不轉；契約 `website_only.event_types` 同步更新，`enums.event_types`（園務列舉）不變。
- **H3**：`metadata_json = {"fields": [排序後的欄位名]}`；不記舊值與新值；`reason` 為空。
- **H4**：`booking_link.sync_from_visit_request` 真的改了欄位時寫 `details_updated`，`metadata_json.origin = "visit_request_sync"`；`actor_user_id` 是改預約的同仁。
- **H5**：`PATCH …/follow-up` 真的改了 `follow_up_at` 或負責人時寫 `follow_up_updated`；**記錄聯絡時順便排的不寫**；註冊、退出時系統自動清掉下次聯絡也不寫。
- **H6**：`{"follow_up_at": ISO 字串或 null, "previous_follow_up_at": ISO 字串或 null, "owner_changed": bool}`；不記負責人 id。
- **H7**：`from_stage = to_stage = derive_stage(visit)`。
- **H8**：這兩種事件有 actor，會更新家庭頁的「最後處理」。
- **H9**：不回補舊資料。

退出原因
- **W1**：八項（順序即顯示順序）：`抽中公幼／非營利`、`改讀其他私立幼兒園`、`搬家／距離因素`、`費用考量`、`家庭照顧安排改變`、`孩子健康／適應因素`、`課程／環境有疑慮`、`未註明／聯絡不上`。
- **W2**：轉成退出（`deposited→withdrawn`、`enrolled→withdrawn`）時分類必選、說明選填；其他要填原因的轉換（`enrolled→deposited`、`enrolled→visited`）照舊要填文字。
- **W3**：不自動猜分類；分類為空的退出者在統計歸「未分類」。
- **W4**：匿名化清說明（`withdraw_reason`）、保留分類。
- **W5**：`columns.withdraw_reason` ＝「分類」或「分類：說明」（兩者都空才是 null）；分類另放 `extensions.withdraw_reason_category`。
- **W6**：「未預繳原因」分頁改名「未預繳與退出原因」，最下面加「退出原因分佈」表（欄：原因、退預繳、退註冊、合計）；網址 `sub=nodeposit` 不變。
- **W7**：已退出的訪視可以在編輯訪視時改分類（PATCH records 收 `withdraw_reason_category`，只有階段是已退出時才收，否則 422）。
- **W8**：母體＝頁首範圍（校區＋入學學年＋學期）內已退出的訪視；分退預繳、退註冊；附「未分類 N 筆」。
- **W9**：取消退出清掉分類與說明。
- **W10**：`withdrawn` 事件的 `metadata_json` 加 `{"withdraw_reason_category": …}`；`reason` 仍是說明。
- **不做**：記錄欄位前後值與負責人是誰；依說明自動歸類、趨勢或預測；園務端改動；預約端取消原因分類；「其他」選項。

## 計畫裁定（Plan Rulings）

| # | 裁定 | 理由 |
|---|---|---|
| P1 | 一支分支 `feature/admin-wave2-20261015`，Task 1–2 歷程事件、Task 3–7 退出原因 | 退出原因的補分類依賴 `details_updated`（規格 W7、歷程規格 §6） |
| P2 | 「排下次聯絡」變更行寫成「下次聯絡：2026/10/20 10:00」（`formatDateTime`），清掉寫「改為不用再追」 | 同一個歷程抽屜裡聯絡紀錄的「排下次聯絡」已用 `formatDateTime`（`EventsDrawer.vue:256`），兩種寫法並存會亂；規格 §3.3 的「10/20（一）」只是示意 |
| P3 | `details_updated` 的 `fields`：一般編輯 `sorted(changed)`（H3）；預約同步用 `synced` 原順序（固定是 `_SYNCED_FIELDS` 的順序） | 同步的順序本來就固定，與同一筆稽核 metadata 一致 |
| P4 | 退出沒有分類：422 `TRANSITION_FIELDS_REQUIRED`，`fields=["withdraw_reason_category"]`，訊息「請填寫：退出原因」 | 沿用既有錯誤格式（`routes.py:405-414`），舊版後台頁面送出時看得懂 |
| P5 | 補分類：不是已退出 → 422 `RECRUITMENT_NOT_WITHDRAWN`；送 `null` 想清空 → 422（標準驗證錯誤）；新增訪視不收這欄 | 規格沒寫能不能清空；清空只會讓資料退回未分類 |
| P6 | 轉換的稽核 metadata 維持 `from_stage／to_stage／has_reason`，不加分類；訪視明細匯出的稽核 metadata 多 `withdraw_reason_category`（值是固定選項或 `unclassified`，不會有人名） | 減少要改的既有斷言；匯出稽核本來就記每個篩選 |
| P7 | `GET /options` **不加**分類清單 | 前端照未預繳原因手抄常數＋對 `constants.py` 原始碼比對（`admissionsConstants.test.ts`），不讀 options；規格 §3.2 那一句在 Task 9 對齊 |
| P8 | `/stats` 照規格回 9 列（含 0 筆）；畫面只列合計 > 0 的列，全部 0 時顯示空狀態「此區間沒有退預繳或退註冊的訪視」 | 規格 §3.2「前端決定是否隱藏」 |
| P9 | 訪視明細的退出原因篩選寫進網址 `wr`（只在 `tab=records` 有意義，比照 `area`）；統計表「查看明細」用 `open-records` 帶 `{ withdraw }` 過去 | 跨分頁帶篩選的既有做法（`AdmissionsView.vue:32-39`、`useAdmissionsFilters.ts`） |
| P10 | 測試 helper `record_at_stage(..., "withdrawn")` 一律帶分類「改讀其他私立幼兒園」；其他直接退出的既有測試逐一補分類 | 一次修好大多數既有測試；分類值選一個不會和 `費用考量` 測試撞名的 |
| P11 | stack e2e 用 `international` 校區（其他 spec 都沒用），結束時（含失敗）用 API 刪掉建立的訪視 | 不汙染其他 spec 的看板與統計 |

## 規格疑點（不改規格，Task 9 在規格 §實作紀錄 寫明）

1. 歷程 H4 寫「家長在管理頁改的為空」：現況只有後台改家長資料會呼叫同步（`backend/app/booking/workflow_service.py:515`），家長端改資料不同步到招生，所以同步事件的 actor 一定有值。程式照樣允許 `None`，測試只驗後台路徑。
2. 退出原因 §3.2「`options` 回傳分類清單」：見 P7，不做。
3. W5 推論：匿名化後說明清空、分類保留，所以匯出的 `columns.withdraw_reason` 會變成「分類」而不是 null（舊行為是 null）。契約 README 要寫明（Task 5）。
4. W10 讓 `withdrawn` 事件有 metadata，與 `contracts/ivy-recruitment/README.md:85`「其他事件（…`withdrawn`…）官網不寫 metadata」衝突：Task 5 改 README。
5. 歷程 §3.3 的日期格式：見 P2。
6. W7 沒寫補分類能不能清空：見 P5。

## Review Focus

（規格沒有直接說、但最可能咬到使用者的情況；每一條都有 task 內的測試釘住。）

1. **舊版後台頁面（快取）退出時沒送分類**：要回 422「請填寫：退出原因」、訪視不變，不是 500 或默默成功。→ Task 4 `test_withdraw_requires_category_and_reason_is_optional`。
2. **取消退出後再退一次**：舊分類不能殘留、要重選。→ Task 4 `test_cancel_withdrawal_clears_category_and_withdrawing_again_needs_a_new_one`。
3. **補分類時順手改了別的欄位**：歷程只有一筆、兩個欄位名、沒有電話原文。→ Task 4 `test_patch_can_classify_a_withdrawn_visit_and_records_history`。
4. **匿名化之後**：分類保留、說明清空、匯出的退出原因只剩分類。→ Task 5 `test_anonymization_keeps_category_and_clears_detail`。
5. **快取的舊後台遇到新事件類型**：中文查不到時顯示原字串、不壞畫面。→ Task 2 `eventLabel` 測試。
6. **網址 `wr` 被手改成亂碼**：當沒篩、從網址清掉。→ Task 7 `admissionsView.test.ts`。
7. **從統計點「未分類」**：明細只列已退出且沒有分類的。→ Task 5 `test_records_filter_by_category_and_unclassified`＋Task 7 統計表測試。

## File Structure

後端
- Modify `backend/app/admissions/constants.py`：兩種事件、官網專用清單、`DETAILS_ORIGIN_SYNC`（Task 1）；`WITHDRAW_REASON_CATEGORIES`、`WITHDRAW_UNCLASSIFIED`、`LEN_WITHDRAW_CATEGORY`（Task 3）。
- Modify `backend/app/admissions/records.py`：`update_visit` 寫歷程（Task 1）、`NotWithdrawn`（Task 4）、篩選（Task 5）。
- Modify `backend/app/admissions/follow_up.py`：`update_follow_up` 寫歷程（Task 1）。
- Modify `backend/app/admissions/booking_link.py`：同步寫歷程（Task 1）。
- Modify `backend/app/admissions/routes.py`：傳 actor（Task 1）、轉換與補分類（Task 4）。
- Modify `backend/app/admissions/models.py`：欄位與兩條 CHECK（Task 3）。
- Create `backend/migrations/versions/5c8e1f3a9d27_withdraw_reason_category.py`（Task 3）。
- Modify `backend/app/admissions/schemas.py`：分類 Literal、Out／Update／Transition（Task 4）、統計（Task 5）。
- Modify `backend/app/admissions/funnel.py`：轉換（Task 4）。
- Modify `backend/app/admissions/download.py`、`export.py`、`stats.py`（Task 5）。
- Tests：Create `backend/tests/test_admissions_history_events.py`（Task 1）、`backend/tests/test_withdraw_reason_category_schema.py`（Task 3）、`backend/tests/test_admissions_withdraw_reason.py`（Task 4–5）；Modify `admissions_helpers.py`、`test_admissions_schema.py`、`test_admissions_funnel.py`、`test_admissions_intake.py`、`test_admissions_follow_up.py`、`test_admin_visit_details.py`、`test_admissions_download.py`、`test_admissions_contract.py`、`test_admissions_retention.py`、`test_admissions_stats.py`。

契約
- Modify `contracts/ivy-recruitment/ivy-schema.json`（Task 1）、`contracts/ivy-recruitment/README.md`（Task 1、5）；重新產生 `contracts/openapi.json`、`contracts/generated/website-api.d.ts`（Task 1、4、5）。

前端（`admin/src/`）
- Modify `admissions/constants.ts`（Task 2、6）、`admissions/family.ts`（Task 2、6）、`api/labels.ts`（Task 5）、`api/admissions.ts`（Task 6、7）、`components/admissions/TransitionDialog.vue`、`RecordDialog.vue`、`components/visit/FamilyAdmissionsData.vue`（Task 6）、`components/admissions/RecordsTab.vue`（Task 6、7）、`components/admissions/StatsTab.vue`、`admissions/useAdmissionsFilters.ts`、`views/AdmissionsView.vue`（Task 7）。
- Tests：`__tests__/admissionsConstants.test.ts`、`familyPage.test.ts`（Task 2、6）、`admissionsFunnel.test.ts`、`admissionsApi.test.ts`、`admissionsRecordDialog.test.ts`、`familyAdmissionsData.test.ts`、`admissionsTestKit.ts`（Task 6）、`admissionsRecords.test.ts`、`admissionsView.test.ts`、`statsTab.test.ts`、`compareTable.test.ts`（Task 7）。

e2e／文件
- Create `tests/stack/admissions-withdraw.spec.ts`；Modify `tests/stack/exports.spec.ts`（Task 8）。
- Modify `DESIGN.md`、`README.md`、`docs/website-admin/acceptance.md`、兩份規格（Task 9）。

---

## Task 0：環境（控制者先備，不交給實作者）

- [ ] **Step 1：開 worktree（從規格分支開，再 rebase 到最新 main）**

```bash
git -C ~/Desktop/ivy-website-admin fetch origin
git -C ~/Desktop/ivy-website-admin worktree add --no-checkout -b feature/admin-wave2-20261015 ~/Repositories/ivy-website-wt/admin-wave2-20261015 docs/admin-batch-specs-20261015
cd ~/Repositories/ivy-website-wt/admin-wave2-20261015
git sparse-checkout set --cone web backend admin content contracts tests deploy scripts docs .github
git checkout -q
git rebase origin/main
git log --oneline -3
```

預期：rebase 無衝突（規格分支只有 `docs/` 新檔）；本計畫檔在 `docs/superpowers/plans/` 裡。`web` 整個目錄在 cone 內，後端測試要讀的 `web/server/data`、`web/public`、`web/app/generated` 與 admin 測試讀的 `web/app`、`web/server` 都在；`deploy` 也在。

- [ ] **Step 2：依賴與自己的 venv**（不要 symlink 別的 worktree 的 `backend/.venv`）

```bash
cd ~/Repositories/ivy-website-wt/admin-wave2-20261015
source ~/.nvm/nvm.sh; nvm use 22; npm ci; (cd admin && npm ci); (cd web && npm ci)
(cd backend && uv sync --frozen)
```

- [ ] **Step 3：記下 migration head**

```bash
cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen alembic heads
```

預期：**單一** head。若是 `c6a9e3f15d27`，Task 3 照寫；若在途分支已進 main（例如在籍學生分布 `f2a7c1e9d4b3`），把這個值告訴 Task 3 的實作者，Task 3 的 `down_revision`、docstring 的 `Revises:` 與測試的 `DOWN_REVISION` 都改成它。

- [ ] **Step 4：建測試庫並升到 head**

```bash
createdb ivy_website_wave2_1015_test
createdb ivy_website_wave2_1015_e2e_test
cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_wave2_1015_test WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_wave2_1015_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen alembic upgrade head
```

Task 3 加了 migration 之後要再跑一次這行 `alembic upgrade head`（控制者跑）。e2e 用 `E2E_DB_NAME=ivy_website_wave2_1015_e2e_test E2E_API_PORT=8746 E2E_WEB_PORT=3746`。

---

### Task 1：歷程事件後端（兩種官網專用事件）

**Files:**
- Modify: `backend/app/admissions/constants.py:53-65`
- Modify: `backend/app/admissions/records.py:255-285`（`update_visit`）
- Modify: `backend/app/admissions/follow_up.py:203-232`（`update_follow_up`）
- Modify: `backend/app/admissions/booking_link.py:23`（import）、`:196-208`（`if synced:` 區塊）
- Modify: `backend/app/admissions/routes.py:255`、`:719-721`
- Modify: `contracts/ivy-recruitment/ivy-schema.json:83`、`contracts/ivy-recruitment/README.md`（「刻意與園務不同」第 6 點）
- Regenerate: `contracts/openapi.json`、`contracts/generated/website-api.d.ts`
- Create: `backend/tests/test_admissions_history_events.py`
- Modify: `backend/tests/test_admin_visit_details.py`（加一個測試與 import）

**Interfaces:**
- Produces：`constants.EVENT_TYPES` 多 `"details_updated"`、`"follow_up_updated"`；`constants.WEBSITE_ONLY_EVENT_TYPES == ("created", "details_updated", "follow_up_updated")`；`constants.DETAILS_ORIGIN_SYNC == "visit_request_sync"`。
- `records.update_visit(db, visit, *, changes: dict, expected_version: int, actor_user_id: uuid.UUID | None = None) -> list[str]`（Task 4 在同一個函式加分類檢查）。
- `follow_up.update_follow_up(db, visit, *, changes: dict, expected_version: int, now: datetime | None = None, actor_user_id: uuid.UUID | None = None) -> list[str]`。
- 事件 metadata 形狀：`details_updated` → `{"fields": [...]}`（同步另加 `"origin": "visit_request_sync"`）；`follow_up_updated` → `{"follow_up_at", "previous_follow_up_at", "owner_changed"}`（Task 2 前端讀）。

- [ ] **Step 1：寫失敗的測試**

建立 `backend/tests/test_admissions_history_events.py`：

```python
"""招生歷程加「修改招生資料」「排下次聯絡」（docs/specs/2026-10-15-admissions-history-events-design.md）。

兩種都是官網專用事件：只記欄位名與日期，不記內容；匯出給園務時不轉。"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.admissions import constants, export, retention
from app.admissions.models import RecruitmentEventLog
from app.auth.models import User
from tests.admissions_helpers import ADMISSIONS, create_record, reception_yihua_client, record_at_stage  # noqa: F401

RECORDS = f"{ADMISSIONS}/records"


def _in(**delta) -> str:
    return (datetime.now(timezone.utc) + timedelta(**delta)).isoformat()


async def _events(client, record: dict, event_type: str | None = None) -> list[dict]:
    response = await client.get(f"{RECORDS}/{record['id']}/events")
    assert response.status_code == 200, response.text
    return [event for event in response.json() if event_type is None or event["event_type"] == event_type]


async def _patch(client, record: dict, **changes):
    return await client.patch(f"{RECORDS}/{record['id']}", json={"expected_version": record["version"], **changes})


async def _follow_up(client, record: dict, **changes):
    return await client.patch(
        f"{RECORDS}/{record['id']}/follow-up", json={"expected_version": record["version"], **changes}
    )


def test_both_types_are_website_only():
    assert constants.EVENT_TYPES[-2:] == ("details_updated", "follow_up_updated")
    assert constants.WEBSITE_ONLY_EVENT_TYPES == ("created", "details_updated", "follow_up_updated")


@pytest.mark.asyncio
async def test_details_updated_records_only_field_names(admin_client):
    record = await create_record(admin_client, address="中正路 1 號", notes="想了解午睡")
    response = await _patch(admin_client, record, address="民族路 2 號", contact_name="王媽媽")
    assert response.status_code == 200, response.text
    [event] = await _events(admin_client, record, "details_updated")
    assert (event["from_stage"], event["to_stage"], event["reason"]) == ("visited", "visited", None)
    assert event["metadata_json"] == {"fields": ["address", "contact_name"]}
    assert event["actor_name"] == "admin@ivy.example"
    dumped = json.dumps(event, ensure_ascii=False)
    assert "民族路" not in dumped and "王媽媽" not in dumped


@pytest.mark.asyncio
async def test_unchanged_patch_writes_no_event(admin_client):
    record = await create_record(admin_client, notes="想了解午睡")
    response = await _patch(admin_client, record, notes="想了解午睡")
    assert response.status_code == 200, response.text
    assert response.json()["version"] == record["version"]
    assert [event["event_type"] for event in await _events(admin_client, record)] == ["created"]


@pytest.mark.asyncio
async def test_details_updated_uses_the_current_stage(admin_client):
    record = await record_at_stage(admin_client, "deposited", notes="舊備註")
    response = await _patch(admin_client, record, notes="新備註")
    assert response.status_code == 200, response.text
    [event] = await _events(admin_client, record, "details_updated")
    assert (event["from_stage"], event["to_stage"]) == ("deposited", "deposited")


@pytest.mark.asyncio
async def test_follow_up_updated_records_before_and_after(admin_client):
    record = await create_record(admin_client)
    scheduled = await _follow_up(admin_client, record, follow_up_at=_in(days=3))
    assert scheduled.status_code == 200, scheduled.text
    cleared = await _follow_up(admin_client, scheduled.json(), follow_up_at=None)
    assert cleared.status_code == 200, cleared.text
    first, second = await _events(admin_client, record, "follow_up_updated")
    when = datetime.fromisoformat(scheduled.json()["follow_up_at"])
    assert first["metadata_json"]["previous_follow_up_at"] is None
    assert datetime.fromisoformat(first["metadata_json"]["follow_up_at"]) == when
    assert first["metadata_json"]["owner_changed"] is False
    assert second["metadata_json"]["follow_up_at"] is None
    assert datetime.fromisoformat(second["metadata_json"]["previous_follow_up_at"]) == when
    assert (first["from_stage"], first["to_stage"]) == ("visited", "visited")


@pytest.mark.asyncio
async def test_owner_change_only_marks_owner_changed(admin_client, reception_yihua_client, db_session):
    record = await create_record(admin_client)
    reception_id = await db_session.scalar(select(User.id).where(User.email == "admissions-reception-yihua@ivy.example"))
    response = await _follow_up(admin_client, record, follow_up_owner_id=str(reception_id))
    assert response.status_code == 200, response.text
    [event] = await _events(admin_client, record, "follow_up_updated")
    assert event["metadata_json"] == {"follow_up_at": None, "previous_follow_up_at": None, "owner_changed": True}
    assert str(reception_id) not in json.dumps(event["metadata_json"])


@pytest.mark.asyncio
async def test_contact_log_does_not_write_follow_up_event(admin_client):
    record = await create_record(admin_client)
    logged = await admin_client.post(
        f"{RECORDS}/{record['id']}/contact-logs",
        json={
            "expected_version": record["version"], "channel": "phone", "reached": True,
            "note": "下週再談", "next_follow_up_at": _in(days=2),
        },
    )
    assert logged.status_code == 201, logged.text
    assert [event["event_type"] for event in await _events(admin_client, record)] == ["created"]


@pytest.mark.asyncio
async def test_stage_change_clearing_follow_up_writes_no_follow_up_event(admin_client):
    record = await record_at_stage(admin_client, "deposited")
    scheduled = await _follow_up(admin_client, record, follow_up_at=_in(days=1))
    assert scheduled.status_code == 200, scheduled.text
    enrolled = await admin_client.post(
        f"{RECORDS}/{record['id']}/transition",
        json={
            "to_stage": "enrolled", "expected_version": scheduled.json()["version"],
            "grade": "小班", "target_school_year": 115, "target_semester": 1,
        },
    )
    assert enrolled.status_code == 200, enrolled.text
    assert enrolled.json()["follow_up_at"] is None
    assert len(await _events(admin_client, record, "follow_up_updated")) == 1


@pytest.mark.asyncio
async def test_export_skips_both_types(admin_client, db_session):
    record = await record_at_stage(admin_client, "deposited", notes="舊")
    patched = await _patch(admin_client, record, notes="新")
    assert patched.status_code == 200, patched.text
    assert (await _follow_up(admin_client, patched.json(), follow_up_at=_in(days=2))).status_code == 200
    result = await export.export_campus(db_session, "yihua", tenant_id=1)
    types = [row["columns"]["event_type"] for row in result["recruitment_event_log"]]
    assert types == ["deposit_added"]


@pytest.mark.asyncio
async def test_anonymization_keeps_history_events(admin_client, db_session):
    record = await create_record(admin_client, notes="舊")
    patched = await _patch(admin_client, record, notes="新")
    assert (await _follow_up(admin_client, patched.json(), follow_up_at=_in(days=2))).status_code == 200
    assert await retention.anonymize_due(db_session, 1, now=datetime.now(timezone.utc) + timedelta(days=2)) >= 1
    await db_session.commit()
    rows = (
        await db_session.execute(
            select(RecruitmentEventLog.event_type, RecruitmentEventLog.metadata_json)
            .where(RecruitmentEventLog.recruitment_visit_id == uuid.UUID(record["id"]))
            .order_by(RecruitmentEventLog.created_at)
        )
    ).all()
    assert [row.event_type for row in rows] == ["created", "details_updated", "follow_up_updated"]
    assert rows[1].metadata_json == {"fields": ["notes"]}
```

在 `backend/tests/test_admin_visit_details.py`：import 區把 `from app.admissions.models import RecruitmentVisit` 改成 `from app.admissions.models import RecruitmentEventLog, RecruitmentVisit`；檔尾加：

```python
@pytest.mark.asyncio
async def test_synced_fields_are_recorded_in_admissions_history(admin_client, public_client, db_session):
    """2026-10-15 招生歷程（H4）：從預約同步過來的變更寫 details_updated，只記欄位名並標 origin；沒同步就不寫。"""
    booking = await _completed_with_recruitment(admin_client, public_client, db_session, phone=OLD_PHONE)
    case_id = booking["id"]
    response = await _patch(admin_client, case_id, expected_version=await _version(admin_client, case_id), phone=NEW_PHONE)
    assert response.status_code == 200, response.text
    visit = await _recruitment(db_session, case_id)

    async def history() -> list[RecruitmentEventLog]:
        result = await db_session.execute(
            select(RecruitmentEventLog)
            .where(RecruitmentEventLog.recruitment_visit_id == visit.id, RecruitmentEventLog.event_type == "details_updated")
            .execution_options(populate_existing=True)
        )
        return list(result.scalars())

    [event] = await history()
    assert event.metadata_json == {"fields": ["phone"], "origin": "visit_request_sync"}
    assert (event.from_stage, event.to_stage, event.reason) == ("visited", "visited", None)
    assert event.actor_user_id is not None
    assert NEW_PHONE not in json.dumps(event.metadata_json)

    email_only = await _patch(admin_client, case_id, expected_version=await _version(admin_client, case_id), email=NEW_EMAIL)
    assert email_only.status_code == 200, email_only.text
    assert len(await history()) == 1  # Email 不同步到招生，不寫歷程
```

- [ ] **Step 2：跑測試確認失敗**

Run: `PYTEST tests/test_admissions_history_events.py tests/test_admin_visit_details.py::test_synced_fields_are_recorded_in_admissions_history`
Expected：`test_both_types_are_website_only` 等全部 FAIL（`EVENT_TYPES` 沒有新類型、`details_updated` 查無事件）。

- [ ] **Step 3：實作**

`backend/app/admissions/constants.py:53-65` 改成：

```python
# recruitment_event_log.event_type。created 是官網延伸（園務不寫），匯出時不轉。
# 2026-10-15 招生歷程：details_updated（修改招生資料）、follow_up_updated（排下次聯絡）也是官網延伸，
# 只記欄位名與日期（metadata 不放個資），匯出時同樣不轉。
EVENT_TYPES: tuple[str, ...] = (
    "created",
    "deposit_added",
    "deposit_removed",
    "converted",
    "revert_converted",
    "withdrawn",
    "withdraw_cancelled",
    "seat_reserved",
    "seat_released",
    "details_updated",
    "follow_up_updated",
)
WEBSITE_ONLY_EVENT_TYPES: tuple[str, ...] = ("created", "details_updated", "follow_up_updated")
# details_updated 的 metadata_json.origin：預約改家長資料時同步過來的（一般編輯不帶 origin）。
DETAILS_ORIGIN_SYNC = "visit_request_sync"
```

`backend/app/admissions/records.py` 的 `update_visit`（`:255-285`）整個換成：

```python
async def update_visit(
    db: AsyncSession,
    visit: RecruitmentVisit,
    *,
    changes: dict,
    expected_version: int,
    actor_user_id: uuid.UUID | None = None,
) -> list[str]:
    """改表單欄位（呼叫前已 get_visit_for_update）。changes 只含請求有送的欄位；
    回傳值真的有變的欄位名（沒變就不加版本、不寫歷程）。參觀日期換到別的月份時，月份
    跟著換，並在新月份重新配號（舊序號在新月份可能已被用掉）。

    有變時同一個交易寫一筆 details_updated 歷程（2026-10-15 規格 H3）：只記排序後的欄位名，
    不記舊值與新值。"""
    from app.admissions.funnel import derive_stage

    if visit.version != expected_version:
        raise VersionConflict(visit.version)
    values = dict(changes)
    _check_term_editable(visit, values)
    if values.get("tour_guide_user_id") is not None and values["tour_guide_user_id"] != visit.tour_guide_user_id:
        await _resolve_tour_guide(db, values)
    changed = [key for key, value in values.items() if getattr(visit, key) != value]
    if not changed:
        return []
    for key in changed:
        setattr(visit, key, values[key])
    if "visit_date" in changed:
        month = academic.roc_month(visit.visit_date)
        if month != visit.month:
            await _lock_month(db, visit.campus_key, month)
            # 先算新序號再一起改：先改 month 的話，查詢前的 autoflush 會把舊序號寫進新月份。
            seq_no = await _next_seq_no(db, visit.campus_key, month)
            visit.month, visit.seq_no = month, seq_no
    visit.version += 1
    visit.updated_at = _now()
    stage = derive_stage(visit)
    write_event(
        db, visit, event_type="details_updated", from_stage=stage, to_stage=stage,
        actor_user_id=actor_user_id, metadata={"fields": sorted(changed)},
    )
    await db.flush()
    if "address" in changed:
        await _apply_geo(db, visit)
    return changed
```

`backend/app/admissions/follow_up.py` 的 `update_follow_up`（`:203-232`）整個換成：

```python
async def update_follow_up(
    db: AsyncSession,
    visit: RecruitmentVisit,
    *,
    changes: dict,
    expected_version: int,
    now: datetime | None = None,
    actor_user_id: uuid.UUID | None = None,
) -> list[str]:
    """只改下次聯絡或負責人（規格 6.4）。changes 只含請求有送的鍵（follow_up_at、
    follow_up_owner_id），值 None＝清除。回傳真的有變的欄位；沒變就不加版本。

    有變時同一個交易寫一筆 follow_up_updated 歷程（2026-10-15 規格 H5、H6）：前後的下次聯絡
    時間與「負責人有沒有換」，不記負責人是誰。記錄聯絡（add_contact_log）順便排的不走這裡。"""
    current = now or _now()
    if visit.version != expected_version:
        raise records.VersionConflict(visit.version)
    if "follow_up_at" in changes:
        _check_next_follow_up(visit, changes["follow_up_at"], current)
    owner_id = changes.get("follow_up_owner_id")
    if owner_id is not None and owner_id != visit.follow_up_owner_id:
        users = await _load_users(db, [owner_id])
        problem = owner_problem(users.get(owner_id), visit.campus_key)
        if problem is not None:
            raise OwnerInvalid(problem)
    changed = [key for key, value in changes.items() if getattr(visit, key) != value]
    if not changed:
        return []
    previous = visit.follow_up_at
    for key in changed:
        setattr(visit, key, changes[key])
    visit.version += 1
    visit.updated_at = current
    stage = derive_stage(visit)
    records.write_event(
        db, visit, event_type="follow_up_updated", from_stage=stage, to_stage=stage,
        actor_user_id=actor_user_id,
        metadata={
            "follow_up_at": visit.follow_up_at.isoformat() if visit.follow_up_at else None,
            "previous_follow_up_at": previous.isoformat() if previous else None,
            "owner_changed": "follow_up_owner_id" in changed,
        },
        created_at=current,
    )
    await db.flush()
    return changed
```

`backend/app/admissions/booking_link.py`：`:23` 改成 `from app.admissions import academic, constants, follow_up, funnel, records`；`:196` 起的 `if synced:` 區塊換成：

```python
    if synced:
        visit.version += 1
        visit.updated_at = datetime.now(timezone.utc)
        # 2026-10-15 招生歷程（H4）：同步過來的也寫一筆 details_updated，只記欄位名並標 origin。
        stage = funnel.derive_stage(visit)
        records.write_event(
            db, visit, event_type="details_updated", from_stage=stage, to_stage=stage,
            actor_user_id=actor_user_id, metadata={"fields": list(synced), "origin": constants.DETAILS_ORIGIN_SYNC},
        )
        await audit_service.log_action(
            db,
            actor_user_id=actor_user_id,
            action="recruitment_visit.synced_from_visit_request",
            target_type="recruitment_visit",
            target_id=str(visit.id),
            campus_key=visit.campus_key,
            metadata={"fields": synced},
        )
```

`backend/app/admissions/routes.py`：
- `:255` 改成 `changed = await records.update_visit(db, visit, changes=changes, expected_version=payload.expected_version, actor_user_id=current_user.id)`
- `:719-721` 改成：

```python
        changed = await follow_up.update_follow_up(
            db, visit, changes=changes, expected_version=payload.expected_version, actor_user_id=current_user.id
        )
```

- [ ] **Step 4：跑測試確認通過**

Run: `PYTEST tests/test_admissions_history_events.py tests/test_admin_visit_details.py tests/test_admissions_records.py tests/test_admissions_follow_up.py tests/test_admissions_booking_link.py tests/test_admissions_academic.py`
Expected：全部 PASS（`test_admissions_contract.py` 此時還會紅，下一步修）。

- [ ] **Step 5：契約快照與 README**

`contracts/ivy-recruitment/ivy-schema.json:83` 改成：

```json
  "website_only": {"event_types": ["created", "details_updated", "follow_up_updated"]}
```

`contracts/ivy-recruitment/README.md`「刻意與園務不同的地方」第 6 點整條換成：

```markdown
6. 官網多寫三種歷程事件，園務不寫，匯出時略過：`created`（`metadata_json.origin` 為 `manual` 或 `visit_request`）；2026-10-15 起的 `details_updated`（修改招生資料，`metadata_json` 是 `{"fields": [欄位名]}`，從預約同步的另有 `"origin": "visit_request_sync"`）與 `follow_up_updated`（排下次聯絡，`{"follow_up_at", "previous_follow_up_at", "owner_changed"}`）。三者都列在 `ivy-schema.json` 的 `website_only.event_types`。
```

同檔「欄位轉換」表的 `version`、`anonymized_at`、`created` 事件那一列，第一欄改成「`version`、`anonymized_at`、`created`／`details_updated`／`follow_up_updated` 事件」。

然後 `CONTRACT_GEN`。

- [ ] **Step 6：跑契約測試**

Run: `PYTEST tests/test_admissions_contract.py`，再 `CONTRACT_CHECK`
Expected：PASS；`export_openapi.py --check` 與 `check-contract-types.mjs` 都說一致。

- [ ] **Step 7：Commit**

```bash
git add backend/app/admissions/constants.py backend/app/admissions/records.py backend/app/admissions/follow_up.py backend/app/admissions/booking_link.py backend/app/admissions/routes.py backend/tests/test_admissions_history_events.py backend/tests/test_admin_visit_details.py contracts/ivy-recruitment/ivy-schema.json contracts/ivy-recruitment/README.md contracts/openapi.json contracts/generated/website-api.d.ts
git commit -m "feat(admissions): 招生歷程記錄修改招生資料與排下次聯絡（官網專用事件）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2：歷程事件前端（中文與變更行）

**Files:**
- Modify: `admin/src/admissions/constants.ts:73-93`（`EVENT_LABELS`、`eventLabel`）
- Modify: `admin/src/admissions/family.ts:1-8`（import）、`:103-118`（`recruitmentEventChanges`）
- Test: `admin/src/__tests__/admissionsConstants.test.ts`、`admin/src/__tests__/familyPage.test.ts`

**Interfaces:**
- Consumes（Task 1）：事件 metadata 形狀（見 Task 1 Interfaces）；`RecruitmentEvent['event_type']` 型別已含兩種新類型（Task 1 重新產生）。
- Produces：`eventLabel('details_updated', { origin: 'visit_request_sync' }) === '修改招生資料（從預約同步）'`；`recruitmentEventChanges` 對兩種新事件回變更行（Task 6 在同一個函式再加 `withdrawn` 的一行）。

- [ ] **Step 1：寫失敗的測試**

`admin/src/__tests__/admissionsConstants.test.ts` 在 `describe('與後端 constants.py 對齊'` 區塊內加：

```ts
  it('官網專用的歷程事件（2026-10-15）有中文，預約同步的另標來源；查不到的顯示原字串', () => {
    expect(EVENT_LABELS.details_updated).toBe('修改招生資料')
    expect(EVENT_LABELS.follow_up_updated).toBe('排下次聯絡')
    expect(eventLabel('details_updated', { fields: ['phone'] })).toBe('修改招生資料')
    expect(eventLabel('details_updated', { fields: ['phone'], origin: 'visit_request_sync' })).toBe('修改招生資料（從預約同步）')
    expect(eventLabel('created', { origin: 'manual' })).toBe('建立訪視（手動新增）')
    expect(eventLabel('something_new', null)).toBe('something_new')
  })
```

`admin/src/__tests__/familyPage.test.ts` 在 `it('招生事件的變更行：階段變化與保留座位'` 之後加：

```ts
  it('招生事件的變更行：修改招生資料只列欄位中文、排下次聯絡寫時間或不用再追（2026-10-15）', () => {
    expect(recruitmentEventChanges(recruitmentEvent({
      event_type: 'details_updated', from_stage: 'visited', to_stage: 'visited',
      metadata_json: { fields: ['phone', 'tour_guide_name', 'tour_guide_user_id', 'mystery'] },
    }))).toEqual(['改了：電話、帶參觀老師、mystery'])
    expect(recruitmentEventChanges(recruitmentEvent({
      event_type: 'follow_up_updated', from_stage: 'deposited', to_stage: 'deposited',
      metadata_json: { follow_up_at: '2026-10-20T02:00:00Z', previous_follow_up_at: null, owner_changed: true },
    }))).toEqual(['下次聯絡：2026/10/20 10:00', '負責人已變更'])
    expect(recruitmentEventChanges(recruitmentEvent({
      event_type: 'follow_up_updated', from_stage: 'visited', to_stage: 'visited',
      metadata_json: { follow_up_at: null, previous_follow_up_at: '2026-10-20T02:00:00Z', owner_changed: false },
    }))).toEqual(['改為不用再追'])
  })

  it('修改招生資料也算家庭頁的「最後處理」（H8）', () => {
    const edited = recruitmentEvent({
      id: 'e9', event_type: 'details_updated', from_stage: 'visited', to_stage: 'visited',
      metadata_json: { fields: ['phone'] }, created_at: '2026-10-15T03:00:00Z',
    })
    expect(familyLastHandled([], [recruitmentEvent(), edited], [], null)).toMatchObject({ what: '修改招生資料', at: '2026-10-15T03:00:00Z' })
  })
```

- [ ] **Step 2：跑測試確認失敗**

Run: `VITEST src/__tests__/admissionsConstants.test.ts src/__tests__/familyPage.test.ts`
Expected：新的兩個 `it` FAIL（`EVENT_LABELS.details_updated` 是 undefined、變更行是空陣列）。

- [ ] **Step 3：實作**

`admin/src/admissions/constants.ts`：`EVENT_LABELS` 最後兩行之後加兩項，`eventLabel` 整個換掉：

```ts
export const EVENT_LABELS: Record<string, string> = {
  created: '建立訪視',
  deposit_added: '加上預繳',
  deposit_removed: '取消預繳',
  converted: '標記註冊',
  revert_converted: '取消註冊',
  withdrawn: '退預繳／退註冊',
  withdraw_cancelled: '取消退費',
  seat_reserved: '保留座位',
  seat_released: '釋放保留',
  // 2026-10-15 官網專用事件（後端 WEBSITE_ONLY_EVENT_TYPES）：只記欄位名與日期。
  details_updated: '修改招生資料',
  follow_up_updated: '排下次聯絡',
}

const CREATED_ORIGIN_LABELS: Record<string, string> = { visit_request: '官網預約到場', manual: '手動新增' }
// details_updated 的 metadata.origin（後端 DETAILS_ORIGIN_SYNC）：預約改家長資料時同步過來的。
const DETAILS_ORIGIN_LABELS: Record<string, string> = { visit_request_sync: '從預約同步' }

/** 查不到的事件顯示原字串（園務同樣做法）；建立訪視、預約同步過來的修改依 metadata.origin 補來源。 */
export function eventLabel(eventType: string, metadata?: unknown): string {
  const label = EVENT_LABELS[eventType] ?? eventType
  if (!metadata || typeof metadata !== 'object') return label
  const origin = String((metadata as { origin?: unknown }).origin)
  const source = eventType === 'created' ? CREATED_ORIGIN_LABELS[origin] : eventType === 'details_updated' ? DETAILS_ORIGIN_LABELS[origin] : undefined
  return source ? `${label}（${source}）` : label
}
```

`admin/src/admissions/family.ts`：
- `:4` 改成 `import { RECRUITMENT_FIELD_LABELS, formatDateTime, staffLabel, staffOf } from '../api/labels'`
- `recruitmentEventChanges`（`:103-118`）整個換成：

```ts
/**
 * 招生事件的變更行：階段變化（「已訪視 → 已預繳」）、保留座位的年級學期、修改招生資料的欄位（只有
 * 欄位中文，不含內容）、排下次聯絡的時間（2026-10-15）。歷程抽屜與預約明細共用。
 */
export function recruitmentEventChanges(event: RecruitmentEvent): string[] {
  const lines: string[] = []
  const metadata = (event.metadata_json && typeof event.metadata_json === 'object' ? event.metadata_json : {}) as Record<string, unknown>
  if (event.from_stage && event.to_stage && event.from_stage !== event.to_stage) {
    lines.push(`${stageLabel(event.from_stage)} → ${stageLabel(event.to_stage)}`)
  }
  if (event.event_type === 'seat_reserved' || event.event_type === 'seat_released') {
    const grade = typeof metadata.grade === 'string' ? metadata.grade : ''
    const year = typeof metadata.school_year === 'number' ? metadata.school_year : null
    const semester = typeof metadata.semester === 'number' ? metadata.semester : null
    const seat = [grade, year ? termLabel(year, semester) : ''].filter(Boolean).join('・')
    if (seat) lines.push(seat)
  }
  if (event.event_type === 'details_updated' && Array.isArray(metadata.fields)) {
    // 帶參觀老師的帳號與姓名是兩個欄位、同一個中文，只列一次。
    const names = Array.from(new Set(metadata.fields.map((field) => RECRUITMENT_FIELD_LABELS[String(field)] ?? String(field))))
    if (names.length) lines.push(`改了：${names.join('、')}`)
  }
  if (event.event_type === 'follow_up_updated') {
    const at = typeof metadata.follow_up_at === 'string' ? metadata.follow_up_at : null
    const before = typeof metadata.previous_follow_up_at === 'string' ? metadata.previous_follow_up_at : null
    if (at) lines.push(`下次聯絡：${formatDateTime(at)}`)
    else if (before) lines.push('改為不用再追')
    if (metadata.owner_changed === true) lines.push('負責人已變更')
  }
  return lines
}
```

- [ ] **Step 4：跑測試確認通過**

Run: `VITEST src/__tests__/admissionsConstants.test.ts src/__tests__/familyPage.test.ts src/__tests__/admissionsFunnel.test.ts`
Expected：PASS。

- [ ] **Step 5：Commit**

```bash
git add admin/src/admissions/constants.ts admin/src/admissions/family.ts admin/src/__tests__/admissionsConstants.test.ts admin/src/__tests__/familyPage.test.ts
git commit -m "feat(admin): 歷程顯示修改招生資料與排下次聯絡

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3：退出原因分類的資料層（常數、欄位、migration）

**Files:**
- Modify: `backend/app/admissions/constants.py`（`WITHDRAWN_FROM` 之後）
- Modify: `backend/app/admissions/models.py:30`（import）、`:36-38`（約束字串）、`__table_args__`、`:141` 之後（欄位）
- Create: `backend/migrations/versions/5c8e1f3a9d27_withdraw_reason_category.py`
- Create: `backend/tests/test_withdraw_reason_category_schema.py`
- Modify: `backend/tests/test_admissions_schema.py:50-58`

**Interfaces:**
- Produces：`constants.WITHDRAW_REASON_CATEGORIES`（八項 tuple）、`constants.WITHDRAW_UNCLASSIFIED == "unclassified"`、`constants.LEN_WITHDRAW_CATEGORY == 40`；`RecruitmentVisit.withdraw_reason_category: str | None`；約束 `ck_recruitment_visits_withdraw_reason_category`、`ck_recruitment_visits_withdraw_category_withdrawn`；revision `5c8e1f3a9d27`。

- [ ] **Step 1：確認 head**

Run（在 `backend/`）：`WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen alembic heads`
Expected：單一 head。以下程式碼假設是 `c6a9e3f15d27`；**不是就把 migration 的 `down_revision`、docstring 的 `Revises:`、測試的 `DOWN_REVISION` 三處改成實際的 head**。

- [ ] **Step 2：寫失敗的測試**

建立 `backend/tests/test_withdraw_reason_category_schema.py`：

```python
"""退出原因分類的 migration 與約束（docs/specs/2026-10-15-withdraw-reason-category-design.md §3.1）。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import CheckConstraint, text
from sqlalchemy.exc import IntegrityError

from app.admissions import constants
from app.admissions.models import RecruitmentVisit

BACKEND = Path(__file__).resolve().parents[1]
REVISION = "5c8e1f3a9d27"
# 實作當下 origin/main 的 head；合併前別的 migration 先進 main，就改這裡和 migration 的 down_revision。
DOWN_REVISION = "c6a9e3f15d27"
MIGRATION = BACKEND / "migrations" / "versions" / f"{REVISION}_withdraw_reason_category.py"
CHECK_NAMES = ("ck_recruitment_visits_withdraw_reason_category", "ck_recruitment_visits_withdraw_category_withdrawn")
NOW = datetime(2026, 10, 15, 4, 0, tzinfo=timezone.utc)


def _checks() -> dict[str, str]:
    return {c.name: str(c.sqltext) for c in RecruitmentVisit.__table__.constraints if isinstance(c, CheckConstraint)}


def _visit(**overrides) -> RecruitmentVisit:
    return RecruitmentVisit(
        id=uuid.uuid4(), campus_key="yihua", month="115.09", visit_date=date(2026, 9, 8), child_name="王小明",
        created_at=NOW, updated_at=NOW, **overrides,
    )


def test_categories_are_the_approved_eight():
    assert constants.WITHDRAW_REASON_CATEGORIES == (
        "抽中公幼／非營利", "改讀其他私立幼兒園", "搬家／距離因素", "費用考量",
        "家庭照顧安排改變", "孩子健康／適應因素", "課程／環境有疑慮", "未註明／聯絡不上",
    )
    assert max(len(value) for value in constants.WITHDRAW_REASON_CATEGORIES) <= constants.LEN_WITHDRAW_CATEGORY
    assert RecruitmentVisit.__table__.columns["withdraw_reason_category"].type.length == constants.LEN_WITHDRAW_CATEGORY
    assert constants.WITHDRAW_UNCLASSIFIED not in constants.WITHDRAW_REASON_CATEGORIES


def test_migration_follows_head_without_branching_and_keeps_data():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    script = ScriptDirectory.from_config(config)
    assert script.get_revision(REVISION).down_revision == DOWN_REVISION
    assert len(script.get_heads()) == 1
    source = MIGRATION.read_text(encoding="utf-8")
    # 只加可空欄位與約束，不改既有資料：與上一版程式相容（deploy/CICD.md）。
    assert "op.execute" not in source and "UPDATE " not in source


def test_check_conditions_are_identical_in_model_and_migration():
    source = MIGRATION.read_text(encoding="utf-8")
    checks = _checks()
    for name in CHECK_NAMES:
        assert f'"{name}"' in source, name
        assert f'"{checks[name]}"' in source, f"{name} 的條件與 migration 不一致：{checks[name]}"


@pytest.mark.asyncio
async def test_column_and_constraints_exist(db_session):
    names = set(
        (await db_session.execute(text("SELECT conname FROM pg_constraint WHERE conrelid = 'recruitment_visits'::regclass"))).scalars()
    )
    assert set(CHECK_NAMES) <= names
    column = (
        await db_session.execute(
            text(
                "SELECT data_type, character_maximum_length, is_nullable FROM information_schema.columns "
                "WHERE table_name = 'recruitment_visits' AND column_name = 'withdraw_reason_category'"
            )
        )
    ).one()
    assert tuple(column) == ("character varying", 40, "YES")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "overrides",
    [
        {"withdraw_reason_category": "其他", "withdrawn_at": NOW, "withdrawn_from": "deposited"},
        {"withdraw_reason_category": "費用考量"},  # 沒有退出卻有分類
    ],
    ids=["unknown_value", "not_withdrawn"],
)
async def test_database_rejects_bad_categories(db_session, overrides):
    db_session.add(_visit(**overrides))
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_database_accepts_a_category_on_a_withdrawn_visit(db_session):
    db_session.add(_visit(withdraw_reason_category="費用考量", withdrawn_at=NOW, withdrawn_from="deposited"))
    await db_session.flush()
    await db_session.rollback()
```

`backend/tests/test_admissions_schema.py:50-58` 改成（另一支 migration 加的約束不在 4a7e2c9d1b63 裡）：

```python
# 參觀後追蹤（2026-10-04）另一個 migration 加的約束，在 test_admissions_follow_up_schema.py 檢查。
FOLLOW_UP_CHECKS = {"ck_recruitment_visits_follow_up_open"}
# 退出原因分類（2026-10-15）另一個 migration 加的約束，在 test_withdraw_reason_category_schema.py 檢查。
WITHDRAW_CATEGORY_CHECKS = {"ck_recruitment_visits_withdraw_reason_category", "ck_recruitment_visits_withdraw_category_withdrawn"}


def test_check_conditions_are_identical_in_model_and_migration():
    source = MIGRATION.read_text(encoding="utf-8")
    later = FOLLOW_UP_CHECKS | WITHDRAW_CATEGORY_CHECKS
    visit_checks = {name: sql for name, sql in _checks(RecruitmentVisit).items() if name not in later}
```

（函式其餘部分不動。）

- [ ] **Step 3：跑測試確認失敗**

Run: `PYTEST tests/test_withdraw_reason_category_schema.py`
Expected：FAIL（`constants` 沒有 `WITHDRAW_REASON_CATEGORIES`）。

- [ ] **Step 4：實作**

`backend/app/admissions/constants.py`，在 `WITHDRAWN_FROM` 那兩行之後加：

```python
# 退出原因分類（2026-10-15 規格 W1，官網延伸）：園務的退出原因是自由文字、沒有代碼。順序即畫面順序，
# 字串即代碼（同未預繳原因）；說明仍寫在 withdraw_reason。與 migration 5c8e1f3a9d27 的字面值逐字相同。
WITHDRAW_REASON_CATEGORIES: tuple[str, ...] = (
    "抽中公幼／非營利",
    "改讀其他私立幼兒園",
    "搬家／距離因素",
    "費用考量",
    "家庭照顧安排改變",
    "孩子健康／適應因素",
    "課程／環境有疑慮",
    "未註明／聯絡不上",
)
# 訪視明細篩選用的特別值：已退出但沒有分類（改版前退出的舊資料）。
WITHDRAW_UNCLASSIFIED = "unclassified"
LEN_WITHDRAW_CATEGORY = 40
```

`backend/app/admissions/models.py`：
- `:30` import 改成 `from app.admissions.constants import CONTACT_CHANNELS, GRADES, NO_DEPOSIT_REASONS, SOURCE_CATEGORIES, WITHDRAW_REASON_CATEGORIES, WITHDRAWN_FROM`
- `FOLLOW_UP_OPEN_CHECK` 那一行之後加：

```python
# 退出原因分類（2026-10-15）：有分類就一定已退出。與 migration 5c8e1f3a9d27 的字面值逐字相同
# （tests/test_withdraw_reason_category_schema.py 檢查）。
WITHDRAW_CATEGORY_WITHDRAWN_CHECK = "withdraw_reason_category IS NULL OR withdrawn_at IS NOT NULL"
```

- `RecruitmentVisit.__table_args__` 在 `ck_recruitment_visits_withdrawn_from` 那一行之後加：

```python
        CheckConstraint(
            _sql_in("withdraw_reason_category", WITHDRAW_REASON_CATEGORIES),
            name="ck_recruitment_visits_withdraw_reason_category",
        ),
        CheckConstraint(WITHDRAW_CATEGORY_WITHDRAWN_CHECK, name="ck_recruitment_visits_withdraw_category_withdrawn"),
```

- `withdraw_reason: Mapped[str | None] = mapped_column(Text, nullable=True)` 之後加：

```python
    # 退出原因分類（2026-10-15 規格 W1）：退預繳、退註冊時必選；說明仍是 withdraw_reason（選填）。
    # 取消退出時與說明一起清掉；匿名化只清說明、保留分類（W4）。
    withdraw_reason_category: Mapped[str | None] = mapped_column(String(40), nullable=True)
```

建立 `backend/migrations/versions/5c8e1f3a9d27_withdraw_reason_category.py`（兩個 CHECK 字串各寫成**一行**字面值，測試靠逐字比對）：

```python
"""招生訪視加「退出原因分類」（2026-10-15 規格 docs/specs/2026-10-15-withdraw-reason-category-design.md §3.1）

recruitment_visits 加可空欄位 withdraw_reason_category（八項分類）與兩個 CHECK：值要在清單內、
有分類就一定已退出。只加欄位與約束，不改既有資料（舊的退出者分類是 NULL，畫面歸「未分類」），
不需要先備份正式庫；上一版程式不讀也不寫這個欄位，先跑 migration 再換程式也相容。
約束條件字串與 app/admissions/models.py 逐字相同（tests/test_withdraw_reason_category_schema.py 檢查）。

降級直接刪約束與欄位（已填的分類一併消失）。

Revision ID: 5c8e1f3a9d27
Revises: c6a9e3f15d27
Create Date: 2026-10-15
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "5c8e1f3a9d27"
down_revision = "c6a9e3f15d27"
branch_labels = None
depends_on = None

CATEGORY_CHECK = "withdraw_reason_category IS NULL OR withdraw_reason_category IN ('抽中公幼／非營利', '改讀其他私立幼兒園', '搬家／距離因素', '費用考量', '家庭照顧安排改變', '孩子健康／適應因素', '課程／環境有疑慮', '未註明／聯絡不上')"
WITHDRAWN_CHECK = "withdraw_reason_category IS NULL OR withdrawn_at IS NOT NULL"


def upgrade() -> None:
    op.add_column("recruitment_visits", sa.Column("withdraw_reason_category", sa.String(40), nullable=True))
    op.create_check_constraint("ck_recruitment_visits_withdraw_reason_category", "recruitment_visits", CATEGORY_CHECK)
    op.create_check_constraint("ck_recruitment_visits_withdraw_category_withdrawn", "recruitment_visits", WITHDRAWN_CHECK)


def downgrade() -> None:
    op.drop_constraint("ck_recruitment_visits_withdraw_category_withdrawn", "recruitment_visits", type_="check")
    op.drop_constraint("ck_recruitment_visits_withdraw_reason_category", "recruitment_visits", type_="check")
    op.drop_column("recruitment_visits", "withdraw_reason_category")
```

- [ ] **Step 5：升級測試庫**（請控制者跑 Task 0 Step 4 的 `alembic upgrade head`，或自己跑同一行）

Expected：`Running upgrade c6a9e3f15d27 -> 5c8e1f3a9d27`。再跑一次 `alembic heads` 確認只有 `5c8e1f3a9d27`。

- [ ] **Step 6：跑測試確認通過**

Run: `PYTEST tests/test_withdraw_reason_category_schema.py tests/test_admissions_schema.py tests/test_admissions_follow_up_schema.py`
Expected：PASS。

- [ ] **Step 7：Commit**

```bash
git add backend/app/admissions/constants.py backend/app/admissions/models.py backend/migrations/versions/5c8e1f3a9d27_withdraw_reason_category.py backend/tests/test_withdraw_reason_category_schema.py backend/tests/test_admissions_schema.py
git commit -m "feat(admissions): 招生訪視加退出原因分類欄位與 migration

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4：退出時必選分類、已退出可補分類（API）

**Files:**
- Modify: `backend/app/admissions/schemas.py:23-29`（型別別名）、`:126-160`（`RecruitmentVisitUpdate`）、`:222-224`（`RecruitmentVisitOut`）、`:289-311`（`TransitionRequest`）
- Modify: `backend/app/admissions/funnel.py:42-43`、`:121-218`（`transition`）
- Modify: `backend/app/admissions/records.py`（`NotWithdrawn`、`update_visit` 加檢查）
- Modify: `backend/app/admissions/routes.py:244-278`、`:356`（`_FIELD_NAMES`）、`:381-393`
- Modify: `backend/tests/admissions_helpers.py:108`
- Modify: `backend/tests/test_admissions_funnel.py`（`CASES`、`test_withdraw_and_revert_require_reason`、`:190`、`:270`）
- Modify: `backend/tests/test_admissions_intake.py:162,221,229`、`backend/tests/test_admissions_follow_up.py:359`
- Create: `backend/tests/test_admissions_withdraw_reason.py`
- Regenerate: `contracts/openapi.json`、`contracts/generated/website-api.d.ts`

**Interfaces:**
- Consumes（Task 1、3）：`records.update_visit(..., actor_user_id=)`；`constants.WITHDRAW_REASON_CATEGORIES`；欄位 `withdraw_reason_category`。
- Produces：`schemas.WithdrawReasonCategory`（Literal）；`TransitionRequest.withdraw_reason_category`、`RecruitmentVisitUpdate.withdraw_reason_category`、`RecruitmentVisitOut.withdraw_reason_category`；`funnel.transition(..., withdraw_reason_category: str | None = None)`；`records.NotWithdrawn`；422 `RECRUITMENT_NOT_WITHDRAWN`。前端（Task 6）送 `withdraw_reason_category`。

- [ ] **Step 1：寫失敗的測試**

建立 `backend/tests/test_admissions_withdraw_reason.py`：

```python
"""退出原因分類（docs/specs/2026-10-15-withdraw-reason-category-design.md）。

Task 4：轉換與補分類。Task 5 在檔尾加篩選、統計、匯出與匿名化。"""

from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy import update

from app.admissions.models import RecruitmentVisit
from tests.admissions_helpers import ADMISSIONS, manual_fields, record_at_stage, transition

RECORDS = f"{ADMISSIONS}/records"
FEE = "費用考量"
# record_at_stage(..., "withdrawn") 一律用這個分類、說明「家長改送他校」（tests/admissions_helpers.py）。
HELPER_CATEGORY = "改讀其他私立幼兒園"


async def _post(client, record: dict, to_stage: str, **fields):
    return await client.post(
        f"{RECORDS}/{record['id']}/transition",
        json={"to_stage": to_stage, "expected_version": record["version"], **fields},
    )


async def _events(client, record: dict, event_type: str) -> list[dict]:
    return [e for e in (await client.get(f"{RECORDS}/{record['id']}/events")).json() if e["event_type"] == event_type]


async def _unclassify(db_session, record: dict) -> None:
    """模擬改版前就退出的舊資料：分類是 NULL。"""
    await db_session.execute(
        update(RecruitmentVisit).where(RecruitmentVisit.id == uuid.UUID(record["id"])).values(withdraw_reason_category=None)
    )
    await db_session.commit()


@pytest.mark.asyncio
@pytest.mark.parametrize("start", ["deposited", "enrolled"])
async def test_withdraw_requires_category_and_reason_is_optional(admin_client, start):
    record = await record_at_stage(admin_client, start)
    missing = await _post(admin_client, record, "withdrawn", reason="家長改送他校")
    assert missing.status_code == 422, missing.text
    assert missing.json()["detail"]["code"] == "TRANSITION_FIELDS_REQUIRED"
    assert missing.json()["detail"]["fields"] == ["withdraw_reason_category"]
    assert missing.json()["detail"]["message"] == "請填寫：退出原因"
    assert (await admin_client.get(f"{RECORDS}/{record['id']}")).json()["version"] == record["version"]

    done = await _post(admin_client, record, "withdrawn", withdraw_reason_category=FEE)
    assert done.status_code == 200, done.text
    body = done.json()
    assert (body["stage"], body["withdraw_reason_category"], body["withdraw_reason"]) == ("withdrawn", FEE, None)
    [event] = await _events(admin_client, record, "withdrawn")
    assert (event["metadata_json"], event["reason"]) == ({"withdraw_reason_category": FEE}, None)


@pytest.mark.asyncio
async def test_unknown_category_is_422(admin_client):
    record = await record_at_stage(admin_client, "deposited")
    assert (await _post(admin_client, record, "withdrawn", withdraw_reason_category="其他")).status_code == 422


@pytest.mark.asyncio
@pytest.mark.parametrize("to_stage", ["deposited", "visited"])
async def test_revert_from_enrolled_still_requires_text_reason(admin_client, to_stage):
    record = await record_at_stage(admin_client, "enrolled")
    response = await _post(admin_client, record, to_stage, withdraw_reason_category=FEE)
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["fields"] == ["reason"]


@pytest.mark.asyncio
async def test_cancel_withdrawal_clears_category_and_withdrawing_again_needs_a_new_one(admin_client):
    record = await record_at_stage(admin_client, "deposited")
    withdrawn = await transition(admin_client, record, "withdrawn", withdraw_reason_category=FEE, reason="學費")
    back = await transition(admin_client, withdrawn, "deposited")
    assert (back["withdraw_reason_category"], back["withdraw_reason"]) == (None, None)
    again = await _post(admin_client, back, "withdrawn")
    assert again.status_code == 422 and again.json()["detail"]["fields"] == ["withdraw_reason_category"]


@pytest.mark.asyncio
async def test_patch_can_classify_a_withdrawn_visit_and_records_history(admin_client, db_session):
    record = await record_at_stage(admin_client, "withdrawn")
    await _unclassify(db_session, record)
    legacy = (await admin_client.get(f"{RECORDS}/{record['id']}")).json()
    assert legacy["withdraw_reason_category"] is None
    response = await admin_client.patch(
        f"{RECORDS}/{record['id']}",
        json={"expected_version": legacy["version"], "withdraw_reason_category": "搬家／距離因素", "contact_name": "陳爸爸"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["withdraw_reason_category"] == "搬家／距離因素"
    [event] = await _events(admin_client, record, "details_updated")
    assert event["metadata_json"] == {"fields": ["contact_name", "withdraw_reason_category"]}
    assert (event["from_stage"], event["to_stage"]) == ("withdrawn", "withdrawn")
    assert "陳爸爸" not in json.dumps(event, ensure_ascii=False)


@pytest.mark.asyncio
async def test_patch_category_on_a_visit_that_has_not_withdrawn_is_422(admin_client):
    record = await record_at_stage(admin_client, "deposited")
    response = await admin_client.patch(
        f"{RECORDS}/{record['id']}", json={"expected_version": record["version"], "withdraw_reason_category": FEE}
    )
    assert response.status_code == 422, response.text
    assert response.json()["detail"] == {"code": "RECRUITMENT_NOT_WITHDRAWN", "message": "只有已退出的訪視可以設定退出原因分類"}
    assert (await admin_client.get(f"{RECORDS}/{record['id']}")).json()["version"] == record["version"]


@pytest.mark.asyncio
async def test_patch_cannot_clear_category_and_create_does_not_accept_it(admin_client):
    record = await record_at_stage(admin_client, "withdrawn")
    cleared = await admin_client.patch(
        f"{RECORDS}/{record['id']}", json={"expected_version": record["version"], "withdraw_reason_category": None}
    )
    assert cleared.status_code == 422
    created = await admin_client.post(
        f"{RECORDS}?campus_key=yihua", json=manual_fields(withdraw_reason_category=FEE)
    )
    assert created.status_code == 422
```

（Task 5 會在檔尾加測試並擴充 import 區；這裡只放 Task 4 用得到的 import，`ruff` 不會報 F401。）

- [ ] **Step 2：跑測試確認失敗**

Run: `PYTEST tests/test_admissions_withdraw_reason.py`
Expected：FAIL（`TransitionRequest` 不收 `withdraw_reason_category`，回 422 extra_forbidden；`fields` 是 `["reason"]`）。

- [ ] **Step 3：實作 schema**

`backend/app/admissions/schemas.py`：
- `:26` `WithdrawnFrom = …` 之後加 `WithdrawReasonCategory = Literal[constants.WITHDRAW_REASON_CATEGORIES]`
- `RecruitmentVisitUpdate` 在 `target_semester: Semester | None = None` 之後加：

```python
    # 退出原因分類（2026-10-15 規格 W7）：只有已退出的訪視能改（不是 422 RECRUITMENT_NOT_WITHDRAWN），
    # 不能清空；說明仍只在退出那一刻填。
    withdraw_reason_category: WithdrawReasonCategory | None = None
```

  並把 `_not_cleared` 的 decorator 改成 `@field_validator("visit_date", "target_school_year", "target_semester", "withdraw_reason_category")`。
- `RecruitmentVisitOut` 的 `withdraw_reason: str | None` 之後加 `withdraw_reason_category: WithdrawReasonCategory | None`。
- `TransitionRequest`：docstring「後台一律送齊八個欄位」改成「九個欄位」；`reason` 那兩行改成：

```python
    # 取消註冊（已註冊往回退）必填；退預繳、退註冊選填（2026-10-15 規格 W2）；其他轉換可以附註。
    reason: OptionalText = Field(default=None, max_length=constants.TEXT_MAX)
    # 退預繳、退註冊必選（2026-10-15 規格 W2）；其他轉換不讀。
    withdraw_reason_category: WithdrawReasonCategory | None = None
```

- [ ] **Step 4：實作轉換**

`backend/app/admissions/funnel.py:42-43` 改成：

```python
# 原因必填：從已註冊往前退（園務 is_destructive）。退出改成必選分類、說明選填（2026-10-15 規格 W2）。
_REASON_REQUIRED = {("enrolled", "deposited"), ("enrolled", "visited")}
_CATEGORY_REQUIRED = {("deposited", "withdrawn"), ("enrolled", "withdrawn")}
```

`transition` 的參數在 `target_semester: int | None = None,` 之後加 `withdraw_reason_category: str | None = None,`；docstring 最後補一點：

```
    - 退出（退預繳、退註冊）時退出原因分類必選、說明（reason）選填；分類寫進訪視與 withdrawn
      事件的 metadata（2026-10-15 規格 W2、W10）。取消退出時分類與說明一起清掉（W9）。
```

`raise TransitionFieldsMissing(["reason"])` 那兩行之後加：

```python
    if (from_stage, to_stage) in _CATEGORY_REQUIRED and withdraw_reason_category is None:
        raise TransitionFieldsMissing(["withdraw_reason_category"])
```

`elif to_stage == "withdrawn":` 區塊的最後兩行改成：

```python
        visit.withdraw_reason = reason
        visit.withdraw_reason_category = withdraw_reason_category
        event("withdrawn", from_stage, "withdrawn", metadata={"withdraw_reason_category": withdraw_reason_category})
```

`else:`（取消退出）區塊在 `visit.withdraw_reason = None` 之後加 `visit.withdraw_reason_category = None`。

- [ ] **Step 5：實作補分類與路由**

`backend/app/admissions/records.py`：`class TermLocked` 之前加：

```python
class NotWithdrawn(Exception):
    """只有已退出的訪視可以設定退出原因分類（2026-10-15 規格 W7；路由回 422 RECRUITMENT_NOT_WITHDRAWN）。"""
```

`update_visit` 裡 `_check_term_editable(visit, values)` 之後加：

```python
    if "withdraw_reason_category" in values and visit.withdrawn_at is None:
        raise NotWithdrawn()
```

`backend/app/admissions/routes.py`：
- `update_recruitment_visit` 的 `except records.TermLocked as exc:` 區塊之後加：

```python
    except records.NotWithdrawn as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "RECRUITMENT_NOT_WITHDRAWN", "message": "只有已退出的訪視可以設定退出原因分類"},
        ) from exc
```

- `:356` 改成 `_FIELD_NAMES = {"reason": "原因", "grade": "年級", "target_school_year": "入學學年", "withdraw_reason_category": "退出原因"}`
- `funnel.transition(...)` 呼叫在 `target_semester=payload.target_semester,` 之後加 `withdraw_reason_category=payload.withdraw_reason_category,`

- [ ] **Step 6：更新既有測試與 helper**

`backend/tests/admissions_helpers.py:108` 改成：

```python
    return await transition(client, record, "withdrawn", reason="家長改送他校", withdraw_reason_category="改讀其他私立幼兒園")
```

docstring「原因『家長改送他校』」改成「原因『家長改送他校』、分類『改讀其他私立幼兒園』」。

`backend/tests/test_admissions_funnel.py`：
- `CASES` 的 `("deposited", None, "withdrawn", {"reason": "改送他校"},` 那一筆改成：

```python
    ("deposited", None, "withdrawn", {"reason": "改送他校", "withdraw_reason_category": "改讀其他私立幼兒園"},
     {"withdrawn_from": "deposited", "withdraw_reason": "改送他校", "withdraw_reason_category": "改讀其他私立幼兒園",
      "has_deposit": False},
     [("withdrawn", "deposited", "withdrawn", "改送他校")]),
    ("enrolled", None, "withdrawn", {"reason": "搬家", "withdraw_reason_category": "搬家／距離因素"},
     {"withdrawn_from": "enrolled", "withdraw_reason": "搬家", "withdraw_reason_category": "搬家／距離因素",
      "has_deposit": False, "enrolled": False, "enrolled_on": None},
     [("withdrawn", "enrolled", "withdrawn", "搬家")]),
```

  （取代原本兩筆退出 case）；兩筆取消退出 case 的期望欄位各加 `"withdraw_reason_category": None`。
- `test_withdraw_and_revert_require_reason` 整個換成：

```python
@pytest.mark.asyncio
@pytest.mark.parametrize(("start", "to_stage"), [("enrolled", "deposited"), ("enrolled", "visited")])
async def test_revert_requires_reason(admin_client, start, to_stage):
    record = await record_at_stage(admin_client, start)
    for reason in (None, "   "):
        response = await _post(admin_client, record, to_stage, reason=reason)
        assert response.status_code == 422, response.text
        assert response.json()["detail"]["code"] == "TRANSITION_FIELDS_REQUIRED"
        assert response.json()["detail"]["fields"] == ["reason"]
    assert (await admin_client.get(f"{RECORDS}/{record['id']}")).json()["version"] == record["version"]


@pytest.mark.asyncio
@pytest.mark.parametrize("start", ["deposited", "enrolled"])
async def test_withdraw_requires_category_not_reason(admin_client, start):
    """2026-10-15 規格 W2：退出改成必選分類、說明選填。"""
    record = await record_at_stage(admin_client, start)
    for reason in (None, "   ", "改送他校"):
        response = await _post(admin_client, record, "withdrawn", reason=reason)
        assert response.status_code == 422, response.text
        assert response.json()["detail"]["fields"] == ["withdraw_reason_category"]
    assert (await admin_client.get(f"{RECORDS}/{record['id']}")).json()["version"] == record["version"]
```

- `:190` 改成 `withdrawn = await transition(reception_yihua_client, other, "withdrawn", reason="改送他校", withdraw_reason_category="改讀其他私立幼兒園")`
- `:215`（`test_concurrent_transition_conflict`）的 `_post(campus_admin_yihua_client, record, "withdrawn", reason="改送他校")` 加 `withdraw_reason_category="改讀其他私立幼兒園"`：不加的話這個請求若先到，會回 422 而不是 200／409，兩個請求的結果組合就不對。`:201`、`:205` 回 409／403 的那兩個（版本與權限在欄位檢查之前）不用改。
- `:270` 改成 `await transition(admin_client, record, "withdrawn", reason="家長說孩子叫小明，住中正路", withdraw_reason_category="搬家／距離因素")`（稽核斷言不變，P6）

`backend/tests/test_admissions_intake.py:162,221,229`、`backend/tests/test_admissions_follow_up.py:359` 的 `transition(..., "withdrawn", reason=…)` 各加 `withdraw_reason_category="改讀其他私立幼兒園"`。

確認沒有漏網：`grep -rn 'transition(.*"withdrawn"' backend/tests | grep -v withdraw_reason_category` 應該只剩 `test_admissions_withdraw_reason.py` 裡刻意不給分類的那幾行。

- [ ] **Step 7：重新產生契約並跑測試**

`CONTRACT_GEN`，然後
Run: `PYTEST tests/test_admissions_withdraw_reason.py tests/test_admissions_funnel.py tests/test_admissions_intake.py tests/test_admissions_follow_up.py tests/test_admissions_records.py tests/test_admin_bug_audit_20261006.py tests/test_admissions_retention.py tests/test_admissions_history_events.py`
Expected：PASS（`test_admissions_contract.py`、`test_admissions_download.py` 在 Task 5 再跑）。

- [ ] **Step 8：Commit**

```bash
git add backend/app/admissions/schemas.py backend/app/admissions/funnel.py backend/app/admissions/records.py backend/app/admissions/routes.py backend/tests/admissions_helpers.py backend/tests/test_admissions_funnel.py backend/tests/test_admissions_intake.py backend/tests/test_admissions_follow_up.py backend/tests/test_admissions_withdraw_reason.py contracts/openapi.json contracts/generated/website-api.d.ts
git commit -m "feat(admissions): 退出時必選退出原因分類、已退出可補分類

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5：分類的篩選、CSV、統計、轉移契約與匿名化

**Files:**
- Modify: `backend/app/admissions/records.py:27-33`（Literal）、`RecruitmentVisitFilters`（`:296-407`）
- Modify: `backend/app/admissions/download.py:36-41`（`RECORD_HEADERS`）、`record_row`、`records_audit_metadata`
- Modify: `backend/app/admissions/export.py`（`withdraw_reason_text`、`ivy_visit_row`、`extension_row`）
- Modify: `backend/app/admissions/stats.py:34`（import）、`_no_deposit_reasons` 之後（新函式）、`query_stats`
- Modify: `backend/app/admissions/schemas.py:562`（新 model）、`AdmissionsStatsOut`
- Modify: `admin/src/api/labels.ts:654-679`（`RECRUITMENT_FIELD_LABELS`）、`:1428` 附近（匯出稽核 metadata）
- Modify: `contracts/ivy-recruitment/README.md`
- Tests：`backend/tests/test_admissions_withdraw_reason.py`（檔尾加）、`test_admissions_download.py`、`test_admissions_contract.py`、`test_admissions_retention.py:26-30`、`test_admissions_stats.py`（`test_stats_empty_campus`）
- Regenerate：契約

**Interfaces:**
- Consumes（Task 3、4）：欄位與常數；`schemas.WithdrawReasonCategory`。
- Produces：`GET /admin/admissions/records` 與 `/records/export` 多 query `withdraw_reason_category`（八項或 `unclassified`）；CSV 多「退出原因分類」欄（在「退出原因」前面）；`/stats` 多 `withdraw_reasons: [{reason, deposited, enrolled, total}]`（9 列，八項依 W1 順序＋「未分類」）與 `withdraw_total`；`export.withdraw_reason_text(category, detail) -> str | None`；`extensions.withdraw_reason_category`。前端 Task 7 讀 `withdraw_reasons`、送 `withdraw_reason_category`。

- [ ] **Step 1：寫失敗的測試**

`backend/tests/test_admissions_withdraw_reason.py` 的 import 區（`from __future__` 之後到 `RECORDS =` 之前）換成：

```python
import json
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update

from app.admissions import constants, export, retention
from app.admissions.models import RecruitmentVisit
from tests.admissions_helpers import ADMISSIONS, create_record, manual_fields, record_at_stage, transition
```

檔尾加：

```python
# ---- Task 5：篩選、統計、匯出、匿名化 ----


@pytest.mark.asyncio
async def test_records_filter_by_category_and_unclassified(admin_client, db_session):
    fee = await record_at_stage(admin_client, "deposited", child_name="費用")
    await transition(admin_client, fee, "withdrawn", withdraw_reason_category=FEE)
    await record_at_stage(admin_client, "withdrawn", child_name="改讀")
    legacy = await record_at_stage(admin_client, "withdrawn", child_name="舊資料")
    await _unclassify(db_session, legacy)
    await create_record(admin_client, child_name="還在")

    async def names(value: str) -> set[str]:
        response = await admin_client.get(RECORDS, params={"campus_key": "yihua", "withdraw_reason_category": value})
        assert response.status_code == 200, response.text
        return {row["child_name"] for row in response.json()}

    assert await names(FEE) == {"費用"}
    assert await names(HELPER_CATEGORY) == {"改讀"}
    assert await names(constants.WITHDRAW_UNCLASSIFIED) == {"舊資料"}
    bad = await admin_client.get(RECORDS, params={"campus_key": "yihua", "withdraw_reason_category": "其他"})
    assert bad.status_code == 422


@pytest.mark.asyncio
async def test_stats_withdraw_reasons_by_category_and_side(admin_client, db_session):
    deposited = await record_at_stage(admin_client, "deposited", child_name="甲")
    await transition(admin_client, deposited, "withdrawn", withdraw_reason_category=FEE)
    await record_at_stage(admin_client, "withdrawn", withdrawn_from="enrolled", child_name="乙")
    legacy = await record_at_stage(admin_client, "withdrawn", child_name="丙")
    await _unclassify(db_session, legacy)
    await record_at_stage(admin_client, "withdrawn", child_name="下學期", target_semester=2)  # 頁首選上學期時不算
    await record_at_stage(admin_client, "withdrawn", campus_key="minghua", child_name="明華的")
    await create_record(admin_client, child_name="沒退出")

    response = await admin_client.get(f"{ADMISSIONS}/stats", params={"campus_key": "yihua", "school_year": 115, "semester": 1})
    assert response.status_code == 200, response.text
    body = response.json()
    assert [row["reason"] for row in body["withdraw_reasons"]] == [*constants.WITHDRAW_REASON_CATEGORIES, "未分類"]
    rows = {row["reason"]: row for row in body["withdraw_reasons"]}
    assert rows[FEE] == {"reason": FEE, "deposited": 1, "enrolled": 0, "total": 1}
    assert rows[HELPER_CATEGORY] == {"reason": HELPER_CATEGORY, "deposited": 0, "enrolled": 1, "total": 1}
    assert rows["未分類"] == {"reason": "未分類", "deposited": 1, "enrolled": 0, "total": 1}
    assert rows["搬家／距離因素"]["total"] == 0
    assert body["withdraw_total"] == 3


@pytest.mark.asyncio
async def test_export_composes_withdraw_reason_and_extension(admin_client, db_session):
    only_category = await record_at_stage(admin_client, "deposited", child_name="只有分類")
    await transition(admin_client, only_category, "withdrawn", withdraw_reason_category=FEE)
    both = await record_at_stage(admin_client, "withdrawn", child_name="兩者都有")
    legacy = await record_at_stage(admin_client, "withdrawn", child_name="舊資料")
    await _unclassify(db_session, legacy)
    stay = await create_record(admin_client, child_name="沒退出")

    result = await export.export_campus(db_session, "yihua", tenant_id=1)
    columns = {row["website_id"]: row["columns"] for row in result["recruitment_visits"]}
    extensions = {row["website_id"]: row for row in result["extensions"]}
    assert columns[only_category["id"]]["withdraw_reason"] == FEE
    assert columns[both["id"]]["withdraw_reason"] == f"{HELPER_CATEGORY}：家長改送他校"
    assert columns[legacy["id"]]["withdraw_reason"] == "家長改送他校"
    assert columns[stay["id"]]["withdraw_reason"] is None
    assert "withdraw_reason_category" not in columns[both["id"]]  # 園務欄位不能多
    assert extensions[only_category["id"]]["withdraw_reason_category"] == FEE
    assert extensions[legacy["id"]]["withdraw_reason_category"] is None
    [withdrawn] = [
        row for row in result["recruitment_event_log"]
        if row["mapping"]["recruitment_visit_website_id"] == only_category["id"] and row["columns"]["event_type"] == "withdrawn"
    ]
    assert withdrawn["columns"]["metadata_json"]["withdraw_reason_category"] == FEE


@pytest.mark.asyncio
async def test_anonymization_keeps_category_and_clears_detail(admin_client, db_session):
    record = await record_at_stage(admin_client, "withdrawn", child_name="王小明")
    assert await retention.anonymize_due(db_session, 1, now=datetime.now(timezone.utc) + timedelta(days=2)) >= 1
    await db_session.commit()
    visit = await db_session.scalar(
        select(RecruitmentVisit).where(RecruitmentVisit.id == uuid.UUID(record["id"])).execution_options(populate_existing=True)
    )
    assert (visit.withdraw_reason_category, visit.withdraw_reason) == (HELPER_CATEGORY, None)
    result = await export.export_campus(db_session, "yihua", tenant_id=1)
    [row] = [r for r in result["recruitment_visits"] if r["website_id"] == record["id"]]
    assert row["columns"]["withdraw_reason"] == HELPER_CATEGORY
```

`backend/tests/test_admissions_download.py`：
- `EXPECTED_HEADERS` 的 `"轉學期", "退出原因",` 改成 `"轉學期", "退出原因分類", "退出原因",`；`:70-71` 的 `37` 改 `38`；檔頭 docstring「37 欄」改「38 欄」。
- 檔尾加：

```python
@pytest.mark.asyncio
async def test_records_export_has_withdraw_category_column_and_audits_the_filter(admin_client, db_session):
    """2026-10-15 退出原因分類：CSV 在「退出原因」前多一欄分類；依分類篩選時稽核記篩選值。"""
    await record_at_stage(admin_client, "withdrawn", child_name="退預繳寶貝")
    _, rows = _csv(await admin_client.get(f"{RECORDS_EXPORT}?campus_key=yihua"))
    row = next(r for r in rows if r["幼生姓名"] == "退預繳寶貝")
    assert (row["退出原因分類"], row["退出原因"]) == ("改讀其他私立幼兒園", "家長改送他校")
    _, filtered = _csv(await admin_client.get(f"{RECORDS_EXPORT}?campus_key=yihua&withdraw_reason_category=unclassified"))
    assert filtered == []
    entries = (
        await db_session.execute(
            select(AuditLogEntry.metadata_json)
            .where(AuditLogEntry.action == "recruitment_visit.export")
            .order_by(AuditLogEntry.created_at)
        )
    ).scalars().all()
    assert entries[-1]["withdraw_reason_category"] == "unclassified"
```

`backend/tests/test_admissions_contract.py`：在 `assert by_id[withdrawn["id"]]["columns"]["withdrawn_from"] == "enrolled"` 之後加：

```python
    # 2026-10-15 退出原因分類：園務的退出原因欄寫「分類：說明」，分類另放延伸檔。
    assert by_id[withdrawn["id"]]["columns"]["withdraw_reason"] == "改讀其他私立幼兒園：家長改送他校"
```

  並在 `extensions = {…}` 那一行之後加 `assert extensions[withdrawn["id"]]["withdraw_reason_category"] == "改讀其他私立幼兒園"`。

`backend/tests/test_admissions_retention.py:26-30` 的 `STAT_COLUMNS` 在 `"withdrawn_from",` 之後加 `"withdraw_reason_category",`（匿名化不清分類）。

`backend/tests/test_admissions_stats.py` 的 `test_stats_empty_campus`，在 `assert result["no_deposit_total"] == 0` 之後加：

```python
    assert [row["total"] for row in result["withdraw_reasons"]] == [0] * 9
    assert result["withdraw_reasons"][-1]["reason"] == "未分類"
    assert result["withdraw_total"] == 0
```

- [ ] **Step 2：跑測試確認失敗**

Run: `PYTEST tests/test_admissions_withdraw_reason.py tests/test_admissions_download.py tests/test_admissions_contract.py tests/test_admissions_stats.py::test_stats_empty_campus`
Expected：FAIL（篩選參數 422 以外被忽略、`withdraw_reasons` KeyError、CSV 少一欄、匯出是原文）。

- [ ] **Step 3：實作篩選與 CSV**

`backend/app/admissions/records.py`：`_GeoFilter = Literal["no_village"]` 之後加：

```python
# 退出原因分類篩選（2026-10-15）：八項，或 unclassified＝已退出但沒有分類。
_WithdrawFilter = Literal[(*constants.WITHDRAW_REASON_CATEGORIES, constants.WITHDRAW_UNCLASSIFIED)]
```

`RecruitmentVisitFilters.__init__` 在 `no_deposit_reason: …` 參數之後加：

```python
        withdraw_reason_category: _WithdrawFilter | None = Query(
            default=None, description="退出原因分類；unclassified＝已退出但沒有分類（2026-10-15）"
        ),
```

`self.no_deposit_reason = no_deposit_reason` 之後加 `self.withdraw_reason_category = withdraw_reason_category`；`apply` 裡 `if self.no_deposit_reason:` 區塊之後加：

```python
        if self.withdraw_reason_category == constants.WITHDRAW_UNCLASSIFIED:
            stmt = stmt.where(
                RecruitmentVisit.withdrawn_at.is_not(None), RecruitmentVisit.withdraw_reason_category.is_(None)
            )
        elif self.withdraw_reason_category:
            stmt = stmt.where(RecruitmentVisit.withdraw_reason_category == self.withdraw_reason_category)
```

`backend/app/admissions/download.py`：
- `RECORD_HEADERS` 的 `"轉學期", "退出原因",` 改成 `"轉學期", "退出原因分類", "退出原因",`
- `record_row` 的 `visit.withdraw_reason or "",` 之前加一行 `visit.withdraw_reason_category or "",`
- `records_audit_metadata` 的 `"no_deposit_reason": filters.no_deposit_reason,` 之後加：

```python
        # 退出原因分類只會是固定選項或 unclassified（端點以 Literal 驗證），記值本身。
        "withdraw_reason_category": filters.withdraw_reason_category,
```

`admin/src/api/labels.ts`：
- `RECRUITMENT_FIELD_LABELS` 最後加 `withdraw_reason_category: '退出原因分類',`
- 匯出稽核 metadata（`no_deposit_reason: (v) => …` 那一行之後）加：

```ts
  withdraw_reason_category: (v) => `篩選退出原因：${v === 'unclassified' ? '未分類' : String(v)}`,
```

- [ ] **Step 4：實作匯出**

`backend/app/admissions/export.py`，`ivy_visit_row` 之前加：

```python
def withdraw_reason_text(category: str | None, detail: str | None) -> str | None:
    """轉給園務的退出原因文字（2026-10-15 規格 W5）：園務只有自由文字欄（轉換時還必填），分類與說明
    組成「分類：說明」；只有其中一個就是那一個；兩者都沒有才是 None。匿名化後只剩分類。"""
    if category and detail:
        return f"{category}：{detail}"
    return category or detail
```

`ivy_visit_row` 的 `"withdraw_reason": visit.withdraw_reason,` 改成 `"withdraw_reason": withdraw_reason_text(visit.withdraw_reason_category, visit.withdraw_reason),`；`extension_row` 的 `"mother_occupation": visit.mother_occupation,` 之後加：

```python
        # 2026-10-15 退出原因分類（園務沒有對應欄位；columns.withdraw_reason 已組成文字）。
        "withdraw_reason_category": visit.withdraw_reason_category,
```

- [ ] **Step 5：實作統計**

`backend/app/admissions/schemas.py`：`class AdmissionsNoDepositPriority` 之前加：

```python
class AdmissionsWithdrawReason(BaseModel):
    """退出原因分佈一列（2026-10-15 規格 W8）：八項依清單順序，「未分類」排最後；0 筆的列也回。"""

    reason: str
    deposited: int
    enrolled: int
    total: int
```

`AdmissionsStatsOut` 的 `no_deposit_summary: AdmissionsNoDepositSummary` 之後加：

```python
    withdraw_reasons: list[AdmissionsWithdrawReason]
    withdraw_total: int
```

`backend/app/admissions/stats.py`：
- `:34` 改成 `from app.admissions.constants import NO_DEPOSIT_PRIORITY, WITHDRAW_REASON_CATEGORIES, split_tour_guides`
- `_priority_totals` 之前加：

```python
def _withdraw_reasons(rows: Iterable[Any]) -> list[dict[str, Any]]:
    """退出原因分佈（2026-10-15 規格 W8）：rows 是 (分類, withdrawn_from, 筆數)。八項依清單順序、
    沒有分類的歸「未分類」排最後；0 筆的列也回（畫面自己決定要不要列）。"""
    buckets = {
        reason: {"reason": reason, "deposited": 0, "enrolled": 0, "total": 0}
        for reason in (*WITHDRAW_REASON_CATEGORIES, UNCLASSIFIED_REASON)
    }
    for category, withdrawn_from, count in rows:
        bucket = buckets.get(category or UNCLASSIFIED_REASON, buckets[UNCLASSIFIED_REASON])
        side = "enrolled" if withdrawn_from == "enrolled" else "deposited"
        bucket[side] += int(count)
        bucket["total"] += int(count)
    return list(buckets.values())
```

- `query_stats` 在 `summary = await _no_deposit_summary(db, no_deposit_filters, now)` 之後加：

```python
    # 退出原因分佈（2026-10-15）：同一個頁首範圍內已退出的訪視，分退預繳、退註冊。
    withdraw_reasons = _withdraw_reasons(
        (
            await db.execute(
                select(v.withdraw_reason_category, v.withdrawn_from, func.count())
                .where(*filters, v.withdrawn_at.is_not(None))
                .group_by(v.withdraw_reason_category, v.withdrawn_from)
            )
        ).all()
    )
```

- 回傳 dict 的 `"no_deposit_summary": summary,` 之後加：

```python
        "withdraw_reasons": withdraw_reasons,
        "withdraw_total": sum(row["total"] for row in withdraw_reasons),
```

- [ ] **Step 6：契約 README**

`contracts/ivy-recruitment/README.md`：
- `extensions.jsonl` 那段的鍵清單在 `"mother_occupation",` 之後加 `"withdraw_reason_category",`，句尾補：「`withdraw_reason_category` 是 2026-10-15 起的退出原因分類（八項之一，改版前退出的為 `null`），匿名化後保留。」
- 「欄位轉換」表在 `english_name`… 那一列之後加：

```markdown
| `withdraw_reason_category`、`withdraw_reason` | `withdraw_reason`；`extensions` | 2026-10-15 起官網的退出原因分成「分類」（八項）與「說明」（選填）。園務只有自由文字欄，`columns.withdraw_reason` 寫「分類：說明」，只有其中一個就寫那一個，兩者都沒有才是 `null`；匿名化會清說明、保留分類，所以匿名化後是分類本身。分類另放 `extensions.withdraw_reason_category` |
```

- 「歷程 metadata 與園務不同的地方」最後一句改成：

```markdown
`withdrawn` 自 2026-10-15 起 `metadata_json` 有 `{"withdraw_reason_category": 分類}`（官網延伸，園務不寫，匯入端可原樣保留或略過）。其他事件（`deposit_added`、`deposit_removed`、`revert_converted`、`withdraw_cancelled`）官網不寫 metadata（只有 `website_actor`）。
```

- 「刻意與園務不同的地方」最後加第 20 點：

```markdown
20. 退出原因分類（2026-10-15，`docs/specs/2026-10-15-withdraw-reason-category-design.md`）：退預繳、退註冊時必選八項之一、說明選填；園務是必填的自由文字。官網的取消註冊（已註冊往回退）照舊必填文字。`/stats` 多 `withdraw_reasons`（分退預繳、退註冊，「未分類」＝改版前退出）與 `withdraw_total`。
```

然後 `CONTRACT_GEN`。

- [ ] **Step 7：跑測試確認通過**

Run: `PYTEST tests/test_admissions_withdraw_reason.py tests/test_admissions_download.py tests/test_admissions_contract.py tests/test_admissions_retention.py tests/test_admissions_stats.py`，再 `CONTRACT_CHECK`，再 `VITEST src/__tests__/labelCoverage.test.ts`
Expected：PASS（labelCoverage 會解析 `records_audit_metadata` 的新鍵）。

- [ ] **Step 8：Commit**

```bash
git add backend/app/admissions/records.py backend/app/admissions/download.py backend/app/admissions/export.py backend/app/admissions/stats.py backend/app/admissions/schemas.py backend/tests/test_admissions_withdraw_reason.py backend/tests/test_admissions_download.py backend/tests/test_admissions_contract.py backend/tests/test_admissions_retention.py backend/tests/test_admissions_stats.py admin/src/api/labels.ts contracts/ivy-recruitment/README.md contracts/openapi.json contracts/generated/website-api.d.ts
git commit -m "feat(admissions): 退出原因分類的篩選、CSV、統計與轉移契約

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6：後台退出對話框、補分類、明細顯示

**Files:**
- Modify: `admin/src/admissions/constants.ts`（分類常數與文字函式）、`admin/src/admissions/family.ts`（`withdrawn` 變更行）
- Modify: `admin/src/api/admissions.ts:85-97`（`transitionRequest` 預設）
- Modify: `admin/src/components/admissions/TransitionDialog.vue`
- Modify: `admin/src/components/admissions/RecordDialog.vue`
- Modify: `admin/src/components/visit/FamilyAdmissionsData.vue:5,43`
- Modify: `admin/src/components/admissions/RecordsTab.vue:12,275`
- Tests：`admin/src/__tests__/admissionsConstants.test.ts`、`familyPage.test.ts`、`admissionsFunnel.test.ts`、`admissionsApi.test.ts`、`admissionsRecordDialog.test.ts`、`familyAdmissionsData.test.ts`、`admissionsTestKit.ts:119`

**Interfaces:**
- Consumes（Task 4、5）：`RecruitmentVisit.withdraw_reason_category`、`TransitionRequest.withdraw_reason_category`、PATCH 收分類。
- Produces（Task 7 用）：`WITHDRAW_REASON_CATEGORIES`、`type WithdrawReasonCategory`、`UNCLASSIFIED_WITHDRAW = 'unclassified'`、`UNCLASSIFIED_LABEL = '未分類'`、`isWithdrawFilter(value: string): boolean`、`withdrawFilterLabel(value: string): string`、`withdrawReasonText(visit): string`。

- [ ] **Step 1：寫失敗的測試**

`admin/src/__tests__/admissionsConstants.test.ts`：import 加 `WITHDRAW_REASON_CATEGORIES, isWithdrawFilter, withdrawFilterLabel, withdrawReasonText`；在 `it('年級、階段、未預繳原因逐字相同'` 裡加一行 `expect([...WITHDRAW_REASON_CATEGORIES]).toEqual(tuple('WITHDRAW_REASON_CATEGORIES'))`；另加：

```ts
describe('退出原因分類（2026-10-15）', () => {
  it('顯示文字：分類：說明；只有一個就寫那一個；都沒有是空字串', () => {
    expect(withdrawReasonText({ withdraw_reason_category: '費用考量', withdraw_reason: '學費比預期高' })).toBe('費用考量：學費比預期高')
    expect(withdrawReasonText({ withdraw_reason_category: '費用考量', withdraw_reason: null })).toBe('費用考量')
    expect(withdrawReasonText({ withdraw_reason_category: null, withdraw_reason: '改送他校' })).toBe('改送他校')
    expect(withdrawReasonText({})).toBe('')
  })

  it('篩選值：八項與 unclassified 才算數；未分類有說明', () => {
    expect(isWithdrawFilter('費用考量')).toBe(true)
    expect(isWithdrawFilter('unclassified')).toBe(true)
    expect(isWithdrawFilter('其他')).toBe(false)
    expect(withdrawFilterLabel('unclassified')).toBe('未分類（改版前退出）')
    expect(withdrawFilterLabel('費用考量')).toBe('費用考量')
  })
})
```

`admin/src/__tests__/familyPage.test.ts`，在 Task 2 加的 `it` 之後加：

```ts
  it('退出事件寫出分類（2026-10-15）', () => {
    expect(recruitmentEventChanges(recruitmentEvent({
      event_type: 'withdrawn', from_stage: 'deposited', to_stage: 'withdrawn', metadata_json: { withdraw_reason_category: '費用考量' },
    }))).toEqual(['已預繳 → 退預繳／退註冊', '原因：費用考量'])
  })
```

（`stageLabel('withdrawn')` 是「退預繳／退註冊」，見 `constants.ts:46-51`。）

`admin/src/__tests__/familyAdmissionsData.test.ts` 的 `it('預繳、未預繳原因、退出原因依階段才列'` 最後加：

```ts
    cleanup()
    const classified = await mountWith(FamilyAdmissionsData, { props: { visit: visit({ ...paper, stage: 'withdrawn', withdrawn_at: '2026-10-09T00:00:00Z', withdrawn_from: 'deposited', withdraw_reason_category: '費用考量', withdraw_reason: '學費' }), options, editable: true } })
    expect(valueOf(classified.wrapper, '退出原因')).toBe('費用考量：學費')
```

`admin/src/__tests__/admissionsTestKit.ts:119` 的 `withdraw_reason: null,` 改成 `withdraw_reason: null, withdraw_reason_category: null,`。

`admin/src/__tests__/admissionsApi.test.ts:46-49` 與 `admissionsFunnel.test.ts:156-159`、`:232-235` 三個 `toEqual({ to_stage: …, target_semester: … })` 的期望各加 `withdraw_reason_category: null`。

`admin/src/__tests__/admissionsFunnel.test.ts` 的 `it('鍵盤「移到…」：櫃台只列有權限的目的欄；標題寫「已預繳 → 退預繳」，要填原因才能標記退預繳'`：名稱改成「…要選退出原因才能標記退預繳」，`reason` textarea 那四行換成：

```ts
    expect(document.body.querySelector('textarea[aria-label="原因"]')).toBeNull()
    const note = document.body.querySelector<HTMLTextAreaElement>('textarea[aria-label="說明"]')!
    note.value = '家長決定不讀'
    note.dispatchEvent(new Event('input'))
    await flushPromises()
    expect(dialogButton('標記退預繳')!.disabled).toBe(true)  // 只寫說明不夠，要選分類
    wrapper.getComponent(TransitionDialog).findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', '費用考量')
    await flushPromises()
```

  最後的斷言改成 `toMatchObject({ to_stage: 'withdrawn', expected_version: 4, withdraw_reason_category: '費用考量', reason: '家長決定不讀' })`。
  `:520-545` 抽屜那個「移到…」測試同樣換掉 `reason` 四行（填說明、選分類），斷言改成 `toMatchObject({ to_stage: 'withdrawn', expected_version: 4, withdraw_reason_category: '費用考量', reason: '家長決定不讀' })`。
  在 `describe('轉換確認框：確認鍵寫出動作…'` 裡加：

```ts
  it('退出只選分類、不寫說明也能送（說明送 null）；退回已預繳仍要寫原因、沒有分類下拉', async () => {
    const post = mockPost({ '/admin/admissions/records/v-1/transition': visit({ stage: 'withdrawn' }) })
    const wrapper = await openDialog('deposited', 'withdrawn', { version: 3 })
    wrapper.findComponent({ name: 'ElSelect' }).vm.$emit('update:modelValue', '搬家／距離因素')
    await flushPromises()
    dialogButton('標記退預繳')!.click()
    await flushPromises()
    expect(bodyOf(post, '/admin/admissions/records/v-1/transition')).toMatchObject({
      to_stage: 'withdrawn', expected_version: 3, withdraw_reason_category: '搬家／距離因素', reason: null,
    })
    cleanup()
    const revert = await openDialog('enrolled', 'deposited')
    expect(revert.findComponent({ name: 'ElSelect' }).exists()).toBe(false)
    expect(document.body.querySelector('textarea[aria-label="原因"]')).not.toBeNull()
  })
```

  （`openDialog`（`admissionsFunnel.test.ts:559-565`）直接回傳 TransitionDialog 的 wrapper。）

`admin/src/__tests__/admissionsRecordDialog.test.ts` 的 `describe('編輯訪視（規格 6.6）'` 裡加：

```ts
  it('已退出的訪視可以補退出原因分類，只送這一欄；其他階段沒有這個欄位（2026-10-15）', async () => {
    const record = visit({ stage: 'withdrawn', withdrawn_at: '2026-10-09T00:00:00Z', withdrawn_from: 'deposited', withdraw_reason: '改送他校', version: 6 })
    const patch = mockPatch({ '/admin/admissions/records/v-1': visit({ version: 7 }) })
    const { wrapper } = await openDialog({ mode: 'edit', record })
    expect(bodyText()).toContain('退出時的說明：改送他校')
    byPlaceholder(wrapper, 'ElSelect', '請選擇退出原因').vm.$emit('update:modelValue', '費用考量')
    await flushPromises()
    bodyButton('儲存')!.click()
    await flushPromises()
    expect(patch).toHaveBeenCalledWith('/admin/admissions/records/v-1', { withdraw_reason_category: '費用考量', expected_version: 6 })
    cleanup()
    const visited = await openDialog({ mode: 'edit', record: visit() })
    expect(visited.wrapper.findAllComponents({ name: 'ElSelect' }).some((select) => select.props('placeholder') === '請選擇退出原因')).toBe(false)
  })
```

- [ ] **Step 2：跑測試確認失敗**

Run: `VITEST src/__tests__/admissionsConstants.test.ts src/__tests__/familyPage.test.ts src/__tests__/familyAdmissionsData.test.ts src/__tests__/admissionsApi.test.ts src/__tests__/admissionsFunnel.test.ts src/__tests__/admissionsRecordDialog.test.ts`
Expected：FAIL（常數不存在、沒有分類下拉、body 沒有 `withdraw_reason_category`）。

- [ ] **Step 3：實作常數與 API**

`admin/src/admissions/constants.ts`，`NO_DEPOSIT_REASONS` 之後加：

```ts
// 退出原因分類（2026-10-15，後端 constants.py WITHDRAW_REASON_CATEGORIES，順序同畫面；admissionsConstants.test.ts 逐字比對）。
export const WITHDRAW_REASON_CATEGORIES = [
  '抽中公幼／非營利', '改讀其他私立幼兒園', '搬家／距離因素', '費用考量',
  '家庭照顧安排改變', '孩子健康／適應因素', '課程／環境有疑慮', '未註明／聯絡不上',
] as const
export type WithdrawReasonCategory = (typeof WITHDRAW_REASON_CATEGORIES)[number]
// 訪視明細篩選的特別值：已退出但沒有分類（後端 WITHDRAW_UNCLASSIFIED）；統計表的列名是「未分類」（stats.py UNCLASSIFIED_REASON）。
export const UNCLASSIFIED_WITHDRAW = 'unclassified'
export const UNCLASSIFIED_LABEL = '未分類'

export function isWithdrawFilter(value: string): boolean {
  return value === UNCLASSIFIED_WITHDRAW || (WITHDRAW_REASON_CATEGORIES as readonly string[]).includes(value)
}

export function withdrawFilterLabel(value: string): string {
  return value === UNCLASSIFIED_WITHDRAW ? `${UNCLASSIFIED_LABEL}（改版前退出）` : value
}

/** 退出原因的顯示文字：「費用考量：說明」；只有其中一個就寫那一個（改版前的舊資料只有說明）；都沒有是空字串。 */
export function withdrawReasonText(visit: { withdraw_reason_category?: string | null; withdraw_reason?: string | null }): string {
  return [visit.withdraw_reason_category, visit.withdraw_reason].filter(Boolean).join('：')
}
```

`admin/src/admissions/family.ts` 的 `recruitmentEventChanges`，在 `details_updated` 區塊之前加：

```ts
  if (event.event_type === 'withdrawn' && typeof metadata.withdraw_reason_category === 'string') {
    lines.push(`原因：${metadata.withdraw_reason_category}`)
  }
```

`admin/src/api/admissions.ts` 的 `transitionRequest` 在 `target_semester: null,` 之後加 `withdraw_reason_category: null,`。

- [ ] **Step 4：實作轉換確認框**

`admin/src/components/admissions/TransitionDialog.vue`：
- import 從 constants 多帶 `WITHDRAW_REASON_CATEGORIES, type WithdrawReasonCategory`。
- 檔頭註解「退出與從已註冊往回要原因」改成「退出要選退出原因分類、說明選填（2026-10-15），從已註冊往回要寫原因」。
- `const reason = ref('')` 之後加 `const category = ref<WithdrawReasonCategory | null>(null)`。
- `const warning = …` 之後加 `const withdrawing = computed(() => props.target?.to === 'withdrawn')`。
- `watch(open, …)` 裡 `reason.value = ''` 之後加 `category.value = null`。
- `const reasonInput = …` 之後加 `const categorySelect = ref<{ focus: () => void } | null>(null)`；`focusFirst` 的 destructive 那行改成 `else if (mode.value === 'destructive') (withdrawing.value ? categorySelect.value : reasonInput.value)?.focus()`。
- `ready` 的 destructive 那行改成 `if (mode.value === 'destructive') return withdrawing.value ? category.value !== null : reason.value.trim() !== ''`。
- `fields` 的 destructive 那行改成：

```ts
  if (mode.value === 'destructive') {
    return withdrawing.value
      ? { withdraw_reason_category: category.value, reason: reason.value.trim() || null }
      : { reason: reason.value.trim() }
  }
```

- template 的 `<el-form-item v-else-if="mode === 'destructive'" label="原因（必填）">` 之前插入：

```vue
      <template v-else-if="mode === 'destructive' && withdrawing">
        <el-form-item label="退出原因" required>
          <el-select ref="categorySelect" v-model="category" placeholder="請選擇退出原因" aria-label="退出原因" style="width: 100%">
            <el-option v-for="item in WITHDRAW_REASON_CATEGORIES" :key="item" :label="item" :value="item" />
          </el-select>
        </el-form-item>
        <el-form-item label="說明（選填）">
          <el-input v-model="reason" type="textarea" :rows="3" maxlength="2000" placeholder="補充說明" aria-label="說明" />
        </el-form-item>
      </template>
```

- [ ] **Step 5：實作補分類與顯示**

`admin/src/components/admissions/RecordDialog.vue`：
- `:10` import 多帶 `WITHDRAW_REASON_CATEGORIES, type WithdrawReasonCategory`。
- `FormState` 加 `withdraw_reason_category: WithdrawReasonCategory | null`；`blank()` 回傳加 `withdraw_reason_category: null`；`fromRecord` 加 `withdraw_reason_category: (record.withdraw_reason_category as WithdrawReasonCategory | null | undefined) ?? null,`。
- `changes(record)` 在 `if (record.has_deposit) { … }` 區塊之後加：

```ts
  // 退出原因分類只在已退出時能改（2026-10-15 規格 W7），不放進 payload()：新增訪視不收這欄。
  if (record.stage === 'withdrawn') {
    before.withdraw_reason_category = record.withdraw_reason_category ?? null
    after.withdraw_reason_category = form.withdraw_reason_category
  }
```

- template「預繳狀態」區塊裡、`<el-form-item v-if="!hasDeposit && showReasonDetail" label="原因說明">` 之前插入：

```vue
        <el-form-item v-if="current?.stage === 'withdrawn'" label="退出原因分類">
          <el-select v-model="form.withdraw_reason_category" placeholder="請選擇退出原因" aria-label="退出原因分類" style="width: 100%">
            <el-option v-for="item in WITHDRAW_REASON_CATEGORIES" :key="item" :label="item" :value="item" />
          </el-select>
          <span v-if="current?.withdraw_reason" class="field-help">退出時的說明：{{ current.withdraw_reason }}</span>
        </el-form-item>
```

`admin/src/components/visit/FamilyAdmissionsData.vue`：`:5` import 多帶 `withdrawReasonText`；`:43` 改成 `['退出原因', v.stage === 'withdrawn' ? withdrawReasonText(v) : null],`。

`admin/src/components/admissions/RecordsTab.vue`：`:12` import 多帶 `withdrawReasonText`；`:275` 改成 `{ label: '退出原因', value: withdrawReasonText(row), wide: true },`。

- [ ] **Step 6：跑測試確認通過**

Run: `VITEST src/__tests__/admissionsConstants.test.ts src/__tests__/familyPage.test.ts src/__tests__/familyAdmissionsData.test.ts src/__tests__/admissionsApi.test.ts src/__tests__/admissionsFunnel.test.ts src/__tests__/admissionsRecordDialog.test.ts src/__tests__/admissionsRecords.test.ts src/__tests__/eventsDrawer*.test.ts`
Expected：PASS（`eventsDrawer*` 沒有符合的檔就略過那個 glob）。

- [ ] **Step 7：Commit**

```bash
git add admin/src/admissions/constants.ts admin/src/admissions/family.ts admin/src/api/admissions.ts admin/src/components/admissions/TransitionDialog.vue admin/src/components/admissions/RecordDialog.vue admin/src/components/visit/FamilyAdmissionsData.vue admin/src/components/admissions/RecordsTab.vue admin/src/__tests__/admissionsConstants.test.ts admin/src/__tests__/familyPage.test.ts admin/src/__tests__/familyAdmissionsData.test.ts admin/src/__tests__/admissionsApi.test.ts admin/src/__tests__/admissionsFunnel.test.ts admin/src/__tests__/admissionsRecordDialog.test.ts admin/src/__tests__/admissionsTestKit.ts
git commit -m "feat(admin): 退出對話框選退出原因、編輯可補分類、明細顯示分類

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7：依退出原因篩選、統計加「退出原因分佈」

**Files:**
- Modify: `admin/src/api/admissions.ts:14-35`（`RecordFilters`）
- Modify: `admin/src/admissions/useAdmissionsFilters.ts`（`wr`）
- Modify: `admin/src/views/AdmissionsView.vue:24-39`、`:153-162`
- Modify: `admin/src/components/admissions/RecordsTab.vue`（prop、篩選、chips、清除）
- Modify: `admin/src/components/admissions/StatsTab.vue:32`（emit 型別）、`:249-266` 附近（列與欄）、`:404-441`（分頁）
- Tests：`admin/src/__tests__/admissionsRecords.test.ts:198-199,537`、`admissionsView.test.ts`、`statsTab.test.ts`、`compareTable.test.ts:79,120`

**Interfaces:**
- Consumes（Task 5、6）：`/records?withdraw_reason_category=`、`/stats` 的 `withdraw_reasons`；`isWithdrawFilter`、`withdrawFilterLabel`、`WITHDRAW_REASON_CATEGORIES`、`UNCLASSIFIED_WITHDRAW`、`UNCLASSIFIED_LABEL`。
- Produces：網址參數 `wr`（只在 `tab=records`）；`useAdmissionsFilters()` 多回傳 `withdraw: Ref<string>`；`RecordsTab` 的 `v-model:withdrawCategory`；`StatsTab` 的 `open-records` 可帶 `{ withdraw: string }`。

- [ ] **Step 1：寫失敗的測試**

`admin/src/__tests__/admissionsRecords.test.ts`：`:198`、`:199`、`:537` 三個 `fieldLabels(...)` 期望陣列，在 `'未預繳原因'` 之後各插入 `'退出原因'`。另加（放在同檔篩選相關的 describe 裡）：

```ts
  it('退出原因篩選送給後端、未分類有說明；選了寫回父層（網址 wr，2026-10-15）', async () => {
    const get = mockGet({ '/admin/admissions/records': [] })
    const { wrapper } = await mountWith(RecordsTab, { props: props({ withdrawCategory: 'unclassified' }) })
    expect(lastQuery(get).get('withdraw_reason_category')).toBe('unclassified')
    const select = wrapper.findAllComponents({ name: 'ElSelect' }).find((item) => item.props('ariaLabel') === '退出原因')!
    expect(select.findAllComponents({ name: 'ElOption' }).map((option) => option.props('label')).at(-1)).toBe('未分類（改版前退出）')
    select.vm.$emit('update:modelValue', '費用考量')
    expect(wrapper.emitted('update:withdrawCategory')).toEqual([['費用考量']])
  })
```

  （`props`、`lastQuery` 是該檔頂端既有的 helper（`admissionsRecords.test.ts:21-23`），掛載方式同 `:58`。）

`admin/src/__tests__/admissionsView.test.ts`，在 `(i)` 那個 `it` 之後加：

```ts
  it('(i2) 訪視明細的 wr（退出原因）：八項與 unclassified 讀得回來；亂碼清掉；統計「查看明細」帶 withdraw 過去並拿掉 month、area', async () => {
    for (const wr of ['費用考量', 'unclassified']) {
      mockGet({ ...routesOn, '/admin/admissions/records': [] })
      const good = await mountWith(AdmissionsView, { path: `/admissions?campus=yihua&tab=records&wr=${encodeURIComponent(wr)}` })
      expect(good.wrapper.findComponent(RecordsTab).props('withdrawCategory')).toBe(wr)
      expect(good.router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'records', wr })
      cleanup()
    }
    mockGet({ ...routesOn, '/admin/admissions/records': [] })
    const bad = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=records&wr=hack' })
    expect(bad.wrapper.findComponent(RecordsTab).props('withdrawCategory')).toBe('')
    expect(bad.router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'records' })
    cleanup()
    mockGet({ ...routesOn, '/admin/admissions/records': [] })
    const { wrapper, router } = await mountWith(AdmissionsView, { path: '/admissions?campus=yihua&tab=stats&sub=nodeposit' })
    wrapper.findComponent(StatsTab).vm.$emit('open-records', { withdraw: 'unclassified' })
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua', tab: 'records', wr: 'unclassified' })
    wrapper.findComponent({ name: 'ElTabs' }).vm.$emit('update:modelValue', 'funnel')
    await flushPromises()
    expect(router.currentRoute.value.query).toEqual({ campus: 'yihua' })
  })
```

`admin/src/__tests__/statsTab.test.ts` 與 `admin/src/__tests__/compareTable.test.ts`：子分頁名稱 `'未預繳原因'`（完整字串、後面直接接引號）全部改成 `'未預繳與退出原因'`：

```bash
sed -i '' "s/'未預繳原因'/'未預繳與退出原因'/g" admin/src/__tests__/statsTab.test.ts admin/src/__tests__/compareTable.test.ts
grep -n "未預繳原因'" admin/src/__tests__/statsTab.test.ts admin/src/__tests__/compareTable.test.ts
```

  預期 grep 沒有輸出（「未預繳原因分佈」表名不受影響，因為後面不是引號）。然後：
- `statsTab.test.ts` 的 `stats()` 預設值在 `no_deposit_summary: …` 之後加：

```ts
    withdraw_reasons: [
      { reason: '費用考量', deposited: 1, enrolled: 1, total: 2 },
      { reason: '搬家／距離因素', deposited: 0, enrolled: 0, total: 0 },
      { reason: '未分類', deposited: 1, enrolled: 0, total: 1 },
    ],
    withdraw_total: 3,
```

- `emptyStats()` 的 `no_deposit_summary: …` 之後加 `withdraw_reasons: [], withdraw_total: 0,`；`compareTable.test.ts:79` 的 `no_deposit_total: 0,` 之後加 `withdraw_reasons: [], withdraw_total: 0,`。
- `it('九張統計表（總覽 2、班別 2、來源 1、接待 3、未預繳原因 1）各用自己的表名當檔名'` 改名「十張統計表（…、未預繳與退出原因 2）…」，`panes` 的那一列改成 `['未預繳與退出原因', ['未預繳原因分佈', '退出原因分佈']],`。
- 在 `it('未預繳原因：三張數字卡…'` 之後加：

```ts
  it('退出原因分佈：只列有筆數的原因，「查看明細」帶分類（未分類帶 unclassified）回訪視明細', async () => {
    mockGet({ '/admin/admissions/stats': stats(), [NO_DEPOSIT_PATH]: noDepositRecords })
    const { wrapper } = await mountWith(StatsTab, { props: props() })
    const pane = await openSubTab(wrapper, '未預繳與退出原因')
    const section = block(pane, '退出原因分佈')
    expect(headers(section)).toEqual(['原因', '退預繳', '退註冊', '合計', '操作'])
    expect(bodyRows(section).map((row) => row.slice(0, 4))).toEqual([['費用考量', '1', '1', '2'], ['未分類', '1', '0', '1']])
    expect(pane.text()).toContain('改版前退出、還沒補分類的歸「未分類」，可在訪視明細補上')
    await section.get('button[aria-label="查看明細：未分類"]').trigger('click')
    expect(wrapper.emitted('open-records')).toEqual([[{ withdraw: 'unclassified' }]])
  })

  it('退出原因分佈：全部 0 筆時顯示空狀態', async () => {
    mockGet({ '/admin/admissions/stats': emptyStats(), [NO_DEPOSIT_PATH]: noDepositRecords })
    const { wrapper } = await mountWith(StatsTab, { props: props() })
    const pane = await openSubTab(wrapper, '未預繳與退出原因')
    expect(block(pane, '退出原因分佈').text()).toContain('此區間沒有退預繳或退註冊的訪視')
  })
```

  （桌機寬度下動作欄表頭是視覺隱藏的「操作」（`StatsDimensionTable.vue:157`）；合計欄是 bar，`cells` 取到的文字若含數字以外的字，照實際畫面調整第 4 格的期望。）

- [ ] **Step 2：跑測試確認失敗**

Run: `VITEST src/__tests__/admissionsRecords.test.ts src/__tests__/admissionsView.test.ts src/__tests__/statsTab.test.ts src/__tests__/compareTable.test.ts`
Expected：FAIL（沒有「退出原因」篩選、分頁名稱還是「未預繳原因」、沒有退出原因表）。

- [ ] **Step 3：實作網址與篩選**

`admin/src/api/admissions.ts` 的 `RecordFilters` 在 `no_deposit_reason?: string | null` 之後加：

```ts
  // 退出原因分類（2026-10-15）：八項，或 unclassified＝已退出但沒有分類。
  withdraw_reason_category?: string | null
```

`admin/src/admissions/useAdmissionsFilters.ts`：
- import 加 `import { isWithdrawFilter } from './constants'`
- 檔頭說明在 `area` 那點之後加一點：`- wr：訪視明細的退出原因分類（八項或 unclassified，2026-10-15）；統計「退出原因分佈」的「查看明細」帶過來，只在 tab=records 有意義，離開訪視明細就拿掉，認不得的值當沒篩。`
- `const area = ref('')` 之後加 `const withdraw = ref('')`
- `apply` 的 `area.value = …` 之後加：

```ts
    const wr = text(query.wr)
    withdraw.value = tab.value === 'records' && isWithdrawFilter(wr) ? wr : ''
```

- `stateQuery` 的 `area` 那行之後加 `if (tab.value === 'records' && withdraw.value) query.wr = withdraw.value`
- `watch(tab, …)` 裡 `if (value !== 'records') area.value = ''` 改成 `if (value !== 'records') { area.value = ''; withdraw.value = '' }`
- 同步網址的 `watch([...])` 陣列在 `area,` 之後加 `withdraw,`
- return 物件在 `area,` 之後加 `withdraw,`

`admin/src/views/AdmissionsView.vue`：
- 解構 `useAdmissionsFilters()` 的清單在 `area,` 之後加 `withdraw,`
- `openRecords` 換成：

```ts
// 統計的警示與行動入口「查看本月明細」、區域分析與退出原因分佈的「查看明細」：切到訪視明細並帶月份、區域或
// 退出原因。三者擇一：帶一個就拿掉另外兩個，免得疊成更窄的範圍。用 push 不用 replace：看完明細按上一頁回到統計。
function openRecords(filter: { month?: string; area?: string; withdraw?: string }) {
  const query: LocationQuery = { ...route.query, tab: 'records' }
  delete query.month
  delete query.area
  delete query.wr
  if (filter.month) query.month = filter.month
  if (filter.area) query.area = filter.area
  if (filter.withdraw) query.wr = filter.withdraw
  void router.push({ query })
}
```

- `<RecordsTab` 加 `v-model:withdrawCategory="withdraw"`（放在 `v-model:area="area"` 之後）。

`admin/src/components/admissions/RecordsTab.vue`：
- import 從 constants 多帶 `UNCLASSIFIED_WITHDRAW, WITHDRAW_REASON_CATEGORIES, withdrawFilterLabel`（`withdrawReasonText` 已在 Task 6 匯入）。
- 檔頭註解「月份、vr、區域（area，2026-10-08）由頁面寫進網址」改成「月份、vr、區域（area，2026-10-08）、退出原因（wr，2026-10-15）由頁面寫進網址」。
- `defineProps` 加 `/** 統計「退出原因分佈」帶來的分類（網址 wr）；八項或 unclassified。 */ withdrawCategory?: string`；`defineEmits` 加 `'update:withdrawCategory': [value: string]`。
- `filtered` 的條件在 `noDepositReason.value` 之後加 `|| props.withdrawCategory`。
- `currentFilters` 的 `no_deposit_reason: …` 之後加 `withdraw_reason_category: props.withdrawCategory || null,`。
- `filterKey` 陣列在 `noDepositReason.value,` 之後加 `props.withdrawCategory ?? '',`。
- `setMonth` 之後加：

```ts
function setWithdrawCategory(value: string | null | undefined) {
  emit('update:withdrawCategory', value ?? '')
}
```

- `clearFilters` 的 `emit('update:area', '')` 之後加 `emit('update:withdrawCategory', '')`。
- `hiddenFilters` 的 `noDepositReason` 那一行之後加：

```ts
  if (props.withdrawCategory) list.push({ key: 'withdraw', label: `退出原因：${withdrawFilterLabel(props.withdrawCategory)}`, clear: () => setWithdrawCategory('') })
```

- template 的「未預繳原因」`filter-field` 之後插入：

```vue
        <div class="filter-field">
          <span>退出原因</span>
          <el-select :model-value="withdrawCategory || undefined" clearable placeholder="全部原因" aria-label="退出原因" class="records-filters__wide" @update:model-value="setWithdrawCategory">
            <el-option v-for="item in WITHDRAW_REASON_CATEGORIES" :key="item" :label="item" :value="item" />
            <el-option :value="UNCLASSIFIED_WITHDRAW" :label="withdrawFilterLabel(UNCLASSIFIED_WITHDRAW)" />
          </el-select>
        </div>
```

- [ ] **Step 4：實作統計表**

`admin/src/components/admissions/StatsTab.vue`：
- `:32` emit 型別改成 `'open-records': [filter: { month?: string; area?: string; withdraw?: string }]`。
- `:15` 的 `import { SEMESTER_LABELS } from '../../admissions/constants'` 改成 `import { SEMESTER_LABELS, UNCLASSIFIED_LABEL, UNCLASSIFIED_WITHDRAW } from '../../admissions/constants'`。
- `noDepositKpis` 之後加：

```ts
// 退出原因分佈（2026-10-15 規格 W6、W8）：後端回八項＋未分類（含 0 筆），畫面只列有筆數的。
const withdrawColumns: StatsColumn[] = [
  { key: 'reason', label: '原因', sticky: true },
  { key: 'deposited', label: '退預繳', kind: 'count' },
  { key: 'enrolled', label: '退註冊', kind: 'count' },
  { key: 'total', label: '合計', kind: 'bar' },
]
const withdrawRows = computed(() =>
  (stats.value?.withdraw_reasons ?? [])
    .filter((row) => row.total > 0)
    .map((row) => ({
      reason: row.reason,
      deposited: row.deposited,
      enrolled: row.enrolled,
      total: row.total,
      code: row.reason === UNCLASSIFIED_LABEL ? UNCLASSIFIED_WITHDRAW : row.reason,
    })),
)
function openWithdrawRecords(row: Record<string, unknown>) {
  if (typeof row.code === 'string') emit('open-records', { withdraw: row.code })
}
```

- template：`<el-tab-pane label="未預繳原因" name="stats-nodeposit" lazy>` 改成 `<el-tab-pane label="未預繳與退出原因" name="stats-nodeposit" lazy>`；同一個 pane 裡 `<NoDepositList … />` 之後、`</div>` 之前插入：

```vue
          <StatsDimensionTable
            title="退出原因分佈"
            :export-filename="csvName('退出原因分佈')"
            :rows="withdrawRows"
            :columns="withdrawColumns"
            row-key="reason"
            empty-text="此區間沒有退預繳或退註冊的訪視"
            action-label="查看明細"
            @action="openWithdrawRecords"
          />
          <p class="hint">依頁首的入學學年與學期；改版前退出、還沒補分類的歸「未分類」，可在訪視明細補上。</p>
```

（若 `@action` 的參數型別與 `Record<string, unknown>` 對不上，照 `StatsDimensionTable` 的 `Row` 型別改 `openWithdrawRecords` 的參數型別，不要用 `any`。）

- [ ] **Step 5：跑測試與型別檢查**

Run: `VITEST src/__tests__/admissionsRecords.test.ts src/__tests__/admissionsView.test.ts src/__tests__/statsTab.test.ts src/__tests__/compareTable.test.ts src/__tests__/labelCoverage.test.ts`，再 `cd admin; npm run typecheck`
Expected：PASS、typecheck 無錯誤。

- [ ] **Step 6：Commit**

```bash
git add admin/src/api/admissions.ts admin/src/admissions/useAdmissionsFilters.ts admin/src/views/AdmissionsView.vue admin/src/components/admissions/RecordsTab.vue admin/src/components/admissions/StatsTab.vue admin/src/__tests__/admissionsRecords.test.ts admin/src/__tests__/admissionsView.test.ts admin/src/__tests__/statsTab.test.ts admin/src/__tests__/compareTable.test.ts
git commit -m "feat(admin): 訪視明細依退出原因篩選、統計加退出原因分佈

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8：stack e2e

**Files:**
- Create: `tests/stack/admissions-withdraw.spec.ts`
- Modify: `tests/stack/exports.spec.ts:27-32`（`RECORD_HEADER`）

**Interfaces:**
- Consumes：Task 1–7 的 API 與畫面（`[draggable="true"]` 看板卡片、抽屜標題「參觀→入學 歷程」、抽屜「移到其他階段」按鈕、確認框「已預繳 → 退預繳」、`combobox` 名稱「退出原因」、`textbox` 名稱「說明」、統計表「退出原因分佈」與「查看明細：費用考量」按鈕）。

- [ ] **Step 1：更新匯出欄位**

`tests/stack/exports.spec.ts` 的 `RECORD_HEADER`，`'轉學期', '退出原因',` 改成 `'轉學期', '退出原因分類', '退出原因',`。

- [ ] **Step 2：寫 e2e**

建立 `tests/stack/admissions-withdraw.spec.ts`：

```ts
import { expect, test } from '@playwright/test'
import { currentTerm } from '../../admin/src/admissions/academic'
import { adminApi, taipeiDate } from './api'
import { expectNoHorizontalOverflow, gotoAdmin, openAs } from './pages'

// 第 2 波（2026-10-15）：招生歷程兩種事件＋退出原因分類。用沒有其他 spec 動到的國際校（計畫裁定 P11）。
// 訪視、預繳、改電話用 API 做；畫面上看歷程、在歷程抽屜標記退預繳並選原因，再到統計「未預繳與退出原因」
// 看分佈、點「查看明細」帶著篩選回到訪視明細。結束時（含失敗）刪掉這筆訪視。
const CAMPUS = 'international'
const CHILD = 'E2E退出寶貝'
const TERM = currentTerm(taipeiDate(0))

interface VisitOut { id: string; version: number }

test('修改招生資料進歷程 → 退預繳選原因 → 統計分佈 → 查看明細帶篩選', async ({ browser }) => {
  test.setTimeout(120_000)
  const api = await adminApi('super_admin')
  let visit = await api.send<VisitOut>('POST', `/admin/admissions/records?campus_key=${CAMPUS}`, {
    visit_date: taipeiDate(-3), child_name: CHILD, birthday: `${TERM.schoolYear + 1911 - 3}-03-15`,
    target_school_year: TERM.schoolYear, target_semester: TERM.semester, phone: '0912000881',
  })
  const { context, page } = await openAs(browser, 'super_admin')
  try {
    visit = await api.send<VisitOut>('POST', `/admin/admissions/records/${visit.id}/transition`, { to_stage: 'deposited', expected_version: visit.version })
    visit = await api.send<VisitOut>('PATCH', `/admin/admissions/records/${visit.id}`, { expected_version: visit.version, phone: '0912000882' })
    const drawer = page.getByRole('dialog', { name: '參觀→入學 歷程' })

    await test.step('歷程抽屜看得到「修改招生資料」，只寫改了哪個欄位', async () => {
      await gotoAdmin(page, `/admissions?campus=${CAMPUS}`, '招生入學')
      await page.locator('[draggable="true"]', { hasText: CHILD }).click()
      const item = drawer.locator('.events__item', { hasText: '修改招生資料' })
      await expect(item).toContainText('改了：電話')
      await expect(item).not.toContainText('0912')
    })

    await test.step('在歷程抽屜標記退預繳：沒選原因不能送，選了「費用考量」才送出', async () => {
      await drawer.getByRole('button', { name: '移到其他階段' }).click()
      await page.getByRole('menuitem', { name: '退預繳／退註冊', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: '已預繳 → 退預繳' })
      const confirm = dialog.getByRole('button', { name: '標記退預繳', exact: true })
      await expect(confirm).toBeDisabled()
      await dialog.getByRole('combobox', { name: '退出原因' }).click()
      await page.getByRole('option', { name: '費用考量', exact: true }).click()
      await dialog.getByRole('textbox', { name: '說明' }).fill('學費比預期高')
      await confirm.click()
      await expect(dialog).toBeHidden()
      await expect(drawer.locator('.events__item', { hasText: '退預繳／退註冊' })).toContainText('原因：費用考量')
    })

    await test.step('統計「未預繳與退出原因」有一筆費用考量；查看明細帶分類回訪視明細', async () => {
      await gotoAdmin(page, `/admissions?campus=${CAMPUS}&sy=all&tab=stats&sub=nodeposit`, '招生入學')
      await expect(page.getByRole('tab', { name: '未預繳與退出原因' })).toHaveAttribute('aria-selected', 'true')
      const table = page.locator('.stats-block').filter({ has: page.locator('.stats-block__title', { hasText: '退出原因分佈' }) })
      await expect(table.locator('tbody tr')).toHaveCount(1)
      await table.getByRole('button', { name: '查看明細：費用考量' }).click()
      await expect(page).toHaveURL(/tab=records/)
      await expect(page).toHaveURL(new RegExp(`wr=${encodeURIComponent('費用考量')}`))
      await expect(page.getByText(CHILD).first()).toBeVisible()
      await page.setViewportSize({ width: 390, height: 844 })
      await expectNoHorizontalOverflow(page)
    })
  } finally {
    const current = await api.get<VisitOut>(`/admin/admissions/records/${visit.id}`)
    await api.send('DELETE', `/admin/admissions/records/${visit.id}?expected_version=${current.version}`)
    await api.dispose()
    await context.close()
  }
})
```

- [ ] **Step 3：只跑這兩支**（控制者或有 stack 環境的實作者；不要和其他測試同時跑）

```bash
export E2E_DB_NAME=ivy_website_wave2_1015_e2e_test E2E_API_PORT=8746 E2E_WEB_PORT=3746
source ~/.nvm/nvm.sh; nvm use 22; npm run e2e:build; npx playwright test -c playwright.stack.config.ts tests/stack/admissions-withdraw.spec.ts tests/stack/exports.spec.ts
```

Expected：PASS。卡片點了沒開抽屜、或抽屜的動作按鈕名稱不同時，先在畫面上確認實際的可及名稱再改 spec，不要改元件去配合測試。

- [ ] **Step 4：Commit**

```bash
git add tests/stack/admissions-withdraw.spec.ts tests/stack/exports.spec.ts
git commit -m "test(e2e): 招生歷程兩種事件與退出原因分類

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9：文件與規格對齊

**Files:**
- Modify: `DESIGN.md`、`README.md`、`docs/website-admin/acceptance.md`
- Modify: `docs/specs/2026-10-15-admissions-history-events-design.md`、`docs/specs/2026-10-15-withdraw-reason-category-design.md`

- [ ] **Step 1：DESIGN.md**

在 `## 招生入學：預約全程漏斗與退出時點（2026-10-15，…）` 那一節之後、下一個 `## ` 之前（`grep -n "^## 招生入學：預約全程漏斗" DESIGN.md`）插入：

```markdown
## 招生入學：招生歷程兩種事件與退出原因分類（2026-10-15，`feature/admin-wave2-20261015`）

規格 `docs/specs/2026-10-15-admissions-history-events-design.md`、`docs/specs/2026-10-15-withdraw-reason-category-design.md`。

- **招生歷程**：多兩種官網專用事件。「修改招生資料」只在欄位真的有變時記，只記欄位名（不記內容，歷程不放個資），從預約同步過來的標「（從預約同步）」；「排下次聯絡」只記從追蹤直接改的（前後時間、負責人有沒有換，不記是誰），記錄聯絡時順便排的、註冊或退出時系統清掉的都不記。兩者都列在 `WEBSITE_ONLY_EVENT_TYPES`，匯出給園務時不轉，園務的事件列舉不變；舊資料不回補。
- **退出原因分類**：退預繳、退註冊時必選八項（抽中公幼／非營利、改讀其他私立幼兒園、搬家／距離因素、費用考量、家庭照顧安排改變、孩子健康／適應因素、課程／環境有疑慮、未註明／聯絡不上），說明選填；取消註冊（已註冊往回退）照舊要寫原因。改版前退出的歸「未分類」，可在編輯訪視時補分類（只有已退出的能改、不能清空）。取消退出時分類與說明一起清掉；匿名化只清說明、保留分類。
- **畫面**：訪視明細依退出原因篩選（網址 `wr`，含「未分類」），匯出 CSV 多「退出原因分類」欄；統計分析的「未預繳原因」分頁改名「未預繳與退出原因」，最下面加「退出原因分佈」（依頁首的入學學年學期，分退預繳、退註冊，只列有筆數的原因，「查看明細」帶分類回訪視明細）。
- **轉給園務**：園務的退出原因是自由文字，`columns.withdraw_reason` 寫「分類：說明」（只有一個就寫那一個），分類另放延伸欄位；`withdrawn` 事件 metadata 多分類。園務不用改程式。
- **不做**：記欄位前後值或負責人是誰、依說明自動歸類、退出原因的趨勢或預測、「其他」選項、預約端取消原因的分類。預約全程規格「退出原因統計另案」由這裡補上。
```

- [ ] **Step 2：README.md 頂部**

在最上方插入（驗證條由 Task 10 回填）：

```markdown
## 2026-10-15 招生歷程兩種事件＋退出原因分類（`feature/admin-wave2-20261015`）

後台第 2 波（10-15 盤點選定的六項之二、三）。招生歷程多記「修改招生資料」（只記欄位名）與「排下次聯絡」（只記從追蹤直接改的），兩者都是官網專用、不轉給園務；退預繳、退註冊改成必選八項退出原因分類、說明選填，舊資料歸「未分類」並可補分類，訪視明細可依分類篩選與匯出，統計分析「未預繳與退出原因」多一張退出原因分佈。規則見 DESIGN.md「招生入學：招生歷程兩種事件與退出原因分類」，計畫 `docs/superpowers/plans/2026-10-15-admin-wave2-history-withdraw.md`。

- **資料**：一支 migration `5c8e1f3a9d27`（`recruitment_visits.withdraw_reason_category`，只加可空欄位與兩條 CHECK，不改既有資料，不需先備份）；歷程事件不動資料表。
- **轉移契約**：`website_only.event_types` 多兩種；`columns.withdraw_reason` 改成「分類：說明」；延伸檔多 `withdraw_reason_category`（`contracts/ivy-recruitment/README.md` 第 6、20 點）。
- **不做**：記欄位前後值、自動歸類、預測、「其他」選項。
```

- [ ] **Step 3：acceptance.md**

檔尾加：

```markdown
## 招生歷程兩種事件與退出原因分類（2026-10-15，`feature/admin-wave2-20261015`，未部署）

| 項目 | 驗收方式 | 狀態 |
|---|---|---|
| 修改招生資料寫歷程、只記欄位名、沒變不寫 | `backend/tests/test_admissions_history_events.py` | 待 Task 10 |
| 預約同步寫歷程並標 origin | `backend/tests/test_admin_visit_details.py::test_synced_fields_are_recorded_in_admissions_history` | 待 Task 10 |
| 排下次聯絡只記直接改的 | `test_admissions_history_events.py`（聯絡紀錄、轉換清掉都不寫） | 待 Task 10 |
| 兩種事件不匯出、契約 website_only 一致 | `test_admissions_contract.py`、`test_admissions_history_events.py::test_export_skips_both_types` | 待 Task 10 |
| 退出必選分類、說明選填、取消退出清掉 | `backend/tests/test_admissions_withdraw_reason.py` | 待 Task 10 |
| 補分類只限已退出、寫歷程 | `test_admissions_withdraw_reason.py` | 待 Task 10 |
| 篩選、CSV、統計、匯出組字、匿名化保留分類 | `test_admissions_withdraw_reason.py`、`test_admissions_download.py`、`test_admissions_retention.py` | 待 Task 10 |
| 畫面：確認框、補分類、篩選與網址、統計表 | admin vitest（`admissionsFunnel`、`admissionsRecordDialog`、`admissionsRecords`、`admissionsView`、`statsTab`） | 待 Task 10 |
| 真實瀏覽器流程、390px 不溢出 | `tests/stack/admissions-withdraw.spec.ts` | 待 Task 10 |
```

- [ ] **Step 4：規格加實作紀錄**

兩份規格檔尾各加一節：

`docs/specs/2026-10-15-admissions-history-events-design.md`：

```markdown
## 7. 實作紀錄

- 實作計畫 `docs/superpowers/plans/2026-10-15-admin-wave2-history-withdraw.md`，與退出原因分類合為一支 `feature/admin-wave2-20261015`（計畫裁定 P1）。
- 與規格的差異：「排下次聯絡」變更行沿用歷程抽屜既有的 `formatDateTime`（「下次聯絡：2026/10/20 10:00」），不另做「10/20（一）」格式（P2）；預約同步的 `fields` 用同步順序（P3）。
- 規格疑點：H4 的「家長在管理頁改的為空」不會發生——現況只有後台改家長資料會同步到招生（`backend/app/booking/workflow_service.py:515`）。
```

`docs/specs/2026-10-15-withdraw-reason-category-design.md`：

```markdown
## 7. 實作紀錄

- 實作計畫 `docs/superpowers/plans/2026-10-15-admin-wave2-history-withdraw.md`，與招生歷程兩種事件合為一支 `feature/admin-wave2-20261015`；migration `5c8e1f3a9d27`（down 見 migration 檔）。
- 與規格的差異：`GET /options` 不加分類清單，前端照未預繳原因手抄常數並對原始碼比對（P7）；補分類不能清空、新增訪視不收這欄（P5）；轉換的稽核 metadata 不加分類（P6）；統計 API 回 9 列含 0 筆、畫面只列有筆數的（P8）；篩選網址參數 `wr`（P9）。
- 推論寫明：匿名化後匯出的 `columns.withdraw_reason` 是分類本身（不再是 null）；`withdrawn` 事件開始帶 metadata，契約 README 已改。
```

- [ ] **Step 5：檢查並 Commit**

```bash
grep -n "TBD\|TODO\|待補" DESIGN.md README.md docs/website-admin/acceptance.md docs/specs/2026-10-15-admissions-history-events-design.md docs/specs/2026-10-15-withdraw-reason-category-design.md | head
git add DESIGN.md README.md docs/website-admin/acceptance.md docs/specs/2026-10-15-admissions-history-events-design.md docs/specs/2026-10-15-withdraw-reason-category-design.md
git commit -m "docs: 招生歷程兩種事件與退出原因分類（規則、驗收、與規格的差異）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Expected：grep 在本案新增的段落沒有占位字（舊段落的「待補」不算）。

---

### Task 10：全套驗證與交付（控制者在背景分開跑，不交給子代理）

- [ ] **Step 1：後端全套**（約 20 分鐘；背景；一次只跑這一組）

```bash
cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_wave2_1015_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen pytest -q -p no:cacheprovider
```

Expected：0 failed。若有 `FileNotFoundError`（`web/server/data`、`deploy`、`web/public`），是 sparse 目錄缺檔，不是程式問題：`git sparse-checkout add web/server/data web/public web/app web/app/generated web/server deploy` 後重跑。台北週五的 `test_booking_consent_readiness` 場次同步、週末的 `test_booking_concurrency` 是 main 既有的日期相依紅燈，對照 `origin/main` 同一個測試確認後在紀錄寫明。

- [ ] **Step 2：admin 全套、typecheck、契約**

```bash
cd admin; source ~/.nvm/nvm.sh; nvm use 22; VITEST_MAX_FORKS=2 npx vitest run
npm run typecheck; (cd ../web && npm run typecheck)
cd ../backend && env -i PATH="$PATH" HOME="$HOME" .venv/bin/python scripts/export_openapi.py --check && cd .. && node scripts/check-contract-types.mjs
```

Expected：全部通過。

- [ ] **Step 3：stack 全套**（背景）

```bash
export E2E_DB_NAME=ivy_website_wave2_1015_e2e_test E2E_API_PORT=8746 E2E_WEB_PORT=3746
npm run e2e:build && npx playwright test -c playwright.stack.config.ts
```

Expected：0 failed（`admissions-follow-up` 在台北 00–01 點的時間相依紅燈照既有說明處理；visual 基準差異 <1% 不算失敗）。

- [ ] **Step 4：對 main 並重接 migration**

```bash
git fetch origin
git log --oneline HEAD..origin/main | head -20
```

若 `origin/main` 有新 commit：`git merge origin/main`，然後 `cd backend && … uv run --frozen alembic heads`。**出現兩個 head**（在籍學生分布 `f2a7c1e9d4b3`、kindergarten-registry、peer-fees 或第 3 波的 migration 先進了 main）時：把 `5c8e1f3a9d27_withdraw_reason_category.py` 的 `down_revision` 與 docstring `Revises:`、`tests/test_withdraw_reason_category_schema.py` 的 `DOWN_REVISION` 改成 main 的 head；`dropdb ivy_website_wave2_1015_test && createdb ivy_website_wave2_1015_test` 後重跑 Task 0 Step 4 的 `alembic upgrade head`；重跑 `PYTEST tests/test_withdraw_reason_category_schema.py tests/test_admissions_schema.py`、契約重新產生與檢查、受影響的測試（特別是動到 `StatsTab.vue`、`useAdmissionsFilters.ts`、`schemas.py`、`booking_link.py`、契約檔的）。確認 `alembic heads` 單一後 commit（`fix(admissions): 退出原因分類 migration 改接 <head>`）。

- [ ] **Step 5：回填 README 驗證條**

在 README 本案段落加「驗證」條：各數字註明跑在哪個 commit、`origin/main` 是哪個 commit；沒做的事：沒有在正式站驗證、沒有登入正式後台看畫面、正式資料沒有退出原因分類（全部會是未分類）、未 push、未部署。acceptance.md 本節的「待 Task 10」改成實際結果。commit。

- [ ] **Step 6：交付**

回報：完成摘要、驗證結果（數字與 commit）、計畫裁定與實作中的新裁定、需要使用者決定的事（`feature/admin-wave2-20261015` 要不要 push main＝部署，給使用者用 `!` 跑的指令；migration 只加欄位不需先備份）。**不自己 push。** 部署後在 `deploy/README.md` 補紀錄，並清掉 worktree、分支與兩個測試庫（`dropdb ivy_website_wave2_1015_test`、`dropdb ivy_website_wave2_1015_e2e_test`）。
