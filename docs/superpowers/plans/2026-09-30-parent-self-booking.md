# 家長自選場次預約 Implementation Plan（總覽）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 官網預約只剩「家長自選後台開放的場次、送出即預約成功」，附修改連結與確認信；後台狀態精簡成預約正常／時間已過／已取消，場次設定與月曆合成「參觀場次」一頁。

**Architecture:** 資料庫 7 種 `VisitRequestStatus` 不變，後端停止產生 `contacting`／`pending_confirmation`，新增 `cancel_reason` 欄位與列表分組；修改連結由 `HMAC(session_secret 衍生金鑰, token 列 id)` 重算，DB 只存雜湊；寄給家長的信走既有 outbox，寄件當下才重算連結。前端：官網表單／結果頁／管理頁改版；後台列表改 group、明細去掉聯絡中、補登必選場次、`VisitCalendarView` 改寫成「參觀場次」（固定場次卡＋月曆），`VisitSlotsView`／`VisitSchedulePanel` 移除。

**Tech Stack:** FastAPI 0.136.1（釘版）、SQLAlchemy 2.0 async＋asyncpg、Alembic、PostgreSQL、pytest＋pytest-asyncio；Nuxt 4＋Vue 3＋TS、vitest；後台 Vue 3＋Pinia＋Element Plus＋Vite、vitest＋@vue/test-utils＋jsdom；Playwright（stack e2e）。

**Spec:** `docs/specs/2026-09-30-parent-self-booking-design.md`（實作前必讀；本計畫與規格衝突時以規格為準，並回報）。

## 分階段（一次 session 只做一個階段，階段間有硬閘）

| 階段 | 檔案 | 內容 | 閘門（全部通過才進下一階段） |
|---|---|---|---|
| A | `2026-09-30-parent-self-booking-A-backend.md` | migration、送單、修改連結、家長 API、家長信、列表分組、場次 API、舊測試改寫、契約 | `cd backend && uv run pytest -q` 全綠；`npm run contract:check` 通過 |
| B | `2026-09-30-parent-self-booking-B-web.md` | 官網表單、結果頁、管理頁、場次名稱 | `npm --prefix web run typecheck`；`npm run test:website` |
| C | `2026-09-30-parent-self-booking-C-admin.md` | 後台列表、明細、補登、預約設定、參觀場次頁 | `npm --prefix admin run typecheck`；`npm --prefix admin run test:unit` |
| D | `2026-09-30-parent-self-booking-D-e2e-docs.md` | stack e2e、畫面驗證、文件、部署紀錄草稿 | `npm run e2e:build && npm run test:e2e:stack`；Playwright 桌機 1440／手機 390 截圖 |

web 與 api 必須同一次部署上線（舊 web 送單會被新 api 拒絕）。本計畫**不含部署**；部署與上線前人工步驟見規格 §7，由使用者決定時間。

## 工作環境

- worktree：`/private/tmp/ivy-website-self-booking-20260930`（sparse checkout，從 origin/main `0a00625`），分支 `feature/parent-self-booking-20260930`。所有指令在這個目錄跑，不要動 `~/Desktop/ivy-website-admin`。
- 開工前：`git -C /private/tmp/ivy-website-self-booking-20260930 fetch origin && git -C /private/tmp/ivy-website-self-booking-20260930 log --oneline -1 origin/main`。若 origin/main 已前進，先問使用者要不要 rebase（其他 session 可能也加了 migration，會撞 alembic head）。
- 相依套件：backend 用自己的 venv（`cd backend && uv sync`，**不要** symlink 別的 worktree 的 `.venv`，editable 安裝會載入別人的原始碼）；`web/node_modules`、`admin/node_modules` 若要 symlink 回 `~/Desktop/ivy-website-admin`，先確認兩邊 `package-lock.json` 相同（`cmp`），不同就 `npm ci`。
- 後端測試庫：本機 Postgres `ivy_website_test`。第一次跑前：
  ```bash
  cd backend
  WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev \
  WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test \
  WEBSITE_SESSION_SECRET=local-test-session-secret-0930 uv run alembic upgrade head
  ```
  若該庫被其他 worktree 共用、head 對不上，改建自己的庫：`createdb ivy_website_test_selfbook`，上面與跑 pytest 時都設 `WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_selfbook`。

## Global Constraints

- FastAPI 釘在 0.136.1，不升任何相依套件版本；不新增 Python 或 npm 套件。
- Node 22（`.nvmrc`）。機器 8GB RAM：同時只跑一組測試或建置。
- 不 push、不部署、不改正式 DB、不發真實信（本機只用 sink：`WEBSITE_NOTIFICATION_EMAIL_SINK_DIR`）。
- **commit 需使用者授權**（repo 規則「未經要求不 commit」）。使用者在執行前授權「在 feature 分支逐 task commit」時，才照各 task 的 commit 步驟做；commit 訊息用 Conventional Commit、繁體中文，結尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。只 `git add` 列出的檔案，禁止 `git add .`／`-A`／`commit -a`。
- 資料庫 `VisitRequestStatus` 七個值不刪、不改名；不刪 `booking_mode` enum 的 `inquiry` 值；不刪 `slots_auto_confirm`、`preferred_time` 欄位。
- 名額單位一律「組」；場次名稱：開始時間 < 12:00 為「上午場」，否則「下午場」，格式 `上午場 10:00`。
- 顏色一律走既有 CSS token，不寫 rgba／oklch／hex 字面值。
- 後端新增 outbox kind、audit action、metadata 鍵、VisitRequestSource 值時，同步 `admin/src/api/labels.ts`（`labelCoverage.test.ts` 會比對）。
- 最後一個名額的並發規則要用真 PostgreSQL 測（不可只測 UI disabled）；outbox 只在交易提交後對外寄送；通知失敗不影響案件。
- 修改連結的原始 token 不得寫進 DB、outbox payload、log 或 audit metadata。
- API 或 schema 有變就跑 `npm run contract:generate`，提交 `contracts/openapi.json` 與 `contracts/generated/website-api.d.ts`。
- 家長信件不放孩子生日、完整電話、提問內容；園方信件維持「不附個資」。
- 家長端寫入端點沿用 `require_parent_request`（`X-Ivy-Parent: 1`、擋 cross-site、每分鐘 30 次）與 `_require_same_visit_request`、`require_change_window`。

## Review Focus

規格沒逐條寫、但最可能讓使用者踩到的五種情況。每一條的測試已放進負責該程式碼的 task：

1. **星期編號不一致**：後端 `visit_rules.weekday` 是 Python `weekday()`（0＝週一），JS `Date.getDay()` 是 0＝週日。場次換算與月曆色塊若用錯，會把週一的場次顯示成週日。→ C4 `sessions.test.ts`「weekday 0 is Monday」。
2. **舊的多場區間規則長度除不盡**（例如 09:30–11:00 每 40 分鐘）：後端只產生完整的場次（09:30–10:10、10:10–10:50），換算成「場次」再存回時必須產生完全相同的時段，否則 `sync_rule_slots` 會刪建場次。→ C4「round-trips a range rule whose length is not a multiple」。
3. **家長取消後，原本的送單請求被網路重送**（同一把 Idempotency-Key）：回應是 `status=cancelled`、`manage_path=null`。結果頁不能顯示「預約成功」。→ A3 `test_replay_after_cancel_has_no_manage_path`、B1 `visit-result.spec.ts`「只有 confirmed 才算預約成功」。
4. **在管理頁停留跨過截止時間才按送出**：API 回 409 `CHANGE_DEADLINE_PASSED`，頁面要重抓資料、收起三個操作並顯示來電說明，不能只跳錯誤。→ B3 `parent-visit.spec.ts`「停在頁面上跨過截止時間：重抓資料、收起操作並說明」。
5. **停止申請一個已有預約的場次**：已約的家長照常有效、不列「待人工處理」、仍可從這一場改到別場或取消；公開場次清單不再出現這一場。→ A7 `test_manual_stop_keeps_bookings_valid_and_out_of_attention`、`test_parent_can_leave_a_stopped_slot`。
