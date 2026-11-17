> 施工已完成（2026-11-17），以設計文件與程式為準；本計畫保留作紀錄。

# 園方 LINE 群組互動 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓園方 LINE 群組除了收卡片，還能查今天／明天／本週參觀名單、按按鈕標記到場／未到場並填招生結果欄位，並有每日摘要、顏色、每群組開關、總部群組、@所有人、新成員說明、@官方帳號選單。

**Architecture:** 後端 FastAPI。推播目標改由新表 `line_group_settings`（每群組的開關、是否總部群組）決定，`line_flex.py` 增加各種卡片版型；webhook（`line_routes.py`）把群組事件交給兩個新模組：`line_group_commands.py`（文字指令、@、新成員）與 `line_group_actions.py`（postback：到場、未到場、招生結果欄位）。狀態變更一律呼叫現有 `workflow_service` 與 `admissions` 函式，不另寫一套。每日摘要由定期工作直接推播（不經 outbox，理由見 Global Constraints 的「與設計文件的差異」）。

**Tech Stack:** FastAPI 0.136.1（釘版，勿升）、SQLAlchemy 2.0 async、Alembic、PostgreSQL（測試用真庫）、pytest；admin 是 Vue 3＋Element Plus＋Vitest。

**Spec:** `docs/specs/2026-11-17-line-group-interactions-design.md`（下稱「設計」）。施工者兩份都要讀。

## Global Constraints

- 工作目錄 `/Users/yilunwu/Repositories/ivy-website-wt/line-group-20261117`（分支 `feature/line-group-20261117`，從 `origin/main` `ffe857e3`）。**未經使用者要求不 commit、不 push、不合併 main**；下面每個 Task 的「Commit」步驟只在使用者說可以 commit 時才做，否則改成 `git status --short` 確認只動了該 Task 列的檔案。
- 後端測試：`cd backend && WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/<測試庫> uv run pytest <路徑> -q`。本機多個 session 並行：先 `createdb ivywebsite_test_linegroup` 並 `WEBSITE_ENVIRONMENT=test` 加 DATABASE_URL／SESSION_SECRET 後 `uv run alembic upgrade head`；同時只跑一組測試（8GB RAM）。
- FastAPI **0.136.1 釘版**；不新增依賴。
- LINE API 在測試一律用 `httpx.MockTransport`（沿用 `tests/test_line_integrations_20261116.py` 的 `FakeLine`／`_webhook`／`_sign`／`fake_line` fixture）；不連真的 LINE。
- 群組推播卡片與回覆**不放電話、Email、孩子資料**；家長稱呼一律用 `service.line_parent_name`（拿掉網址、限 20 字）。altText 不帶家長稱呼與網址。
- 回覆（reply）不計則數；主動推播才計。一次 push 的訊息物件數就是則數。
- 權限只走 `backend/app/auth/permissions.py` 的 capability 表，不在路由寫 `role != SUPER_ADMIN`。
- 稽核動作名稱在呼叫端寫字面值；新鍵要在 `admin/src/utils/auditLabels.ts`（或現有稽核標籤檔，用 `grep -rn "line.parent.link" admin/src` 找位置）歸類並寫中文，`labelCoverage.test.ts` 會掃。
- 新增或改 API 後跑 `npm run contract:generate`，再 `npm run contract:check`。
- 常數值照設計：摘要 08:00（台灣時間）；查詢限流每群組每分鐘 6 次；說明回覆每群組 10 分鐘 1 次；確認 token 5 分鐘；色彩——新預約 `#244933`、已確認 `#1F5FA8`、已改期 `#B35A14`（施工時量到 `#C4631A` 只有 4.08:1，改用 `#B35A14`）、已取消 `#B3261E`（標題字色；對白底對比 ≥ 4.5:1，Task 4 的測試要算）。
- **與設計文件的差異（我的決定，已回寫設計 §4.1）**：`outbox_messages.visit_request_id` 是 NOT NULL 外鍵，摘要不屬於任何案件，所以摘要不寫 outbox；由 `workers/maintenance.py` 新增一步直接推播，用新表 `line_digest_runs (target_id, digest_date)` 主鍵去重，推播成功才寫列，失敗下一輪（60 秒後）重試到當天 12:00 為止。確認 token 改為無狀態 HMAC（含動作、案件 id、到期時間）：重放時案件已不是 `confirmed`，自然回目前狀態，不需另存。

## Review Focus

1. **群組裡按別校案件的按鈕**（舊卡片被轉貼、群組被改綁）：必須被擋，回「這個群組沒有權限處理這筆」，不寫任何東西。→ Task 9、10 測。
2. **同一個按鈕連按兩次／兩人同時按**：只寫一次，第二次回目前狀態，不丟 500。→ Task 9 測。
3. **偽造或過期的 postback data**（亂填索引、過期 token、非 UUID）：回固定錯誤文字，不丟例外、不洩漏內部資訊。→ Task 9、10 測。
4. **當天沒有參觀、或超過 11 筆**：摘要不發／加「另有 N 筆」；carousel 不超過 12 張。→ Task 5、7 測。
5. **群組已被移出（`left_at` 不為空）或不是任何校的目標**：不回應任何指令、不推播。→ Task 6、8 測。

---

## File Structure

| 路徑 | 動作 | 責任 |
|---|---|---|
| `backend/app/notifications/models.py` | 修改 | 新增 `LineGroupSetting`、`LineDigestRun` 兩個模型 |
| `backend/migrations/versions/<新 rev>_line_group_settings.py` | 新增 | 兩張表；`down_revision = "c4d2e8a1f6b3"`（以 `uv run alembic heads` 為準，開工時再確認一次） |
| `backend/app/notifications/line_group_settings.py` | 新增 | 預設值、`GroupTarget`、`targets_for`、`group_for_command` |
| `backend/app/notifications/line_flex.py` | 修改 | 顏色、按鈕、名單／摘要／選單／說明／確認／結果／選擇卡版型 |
| `backend/app/notifications/line_group_commands.py` | 新增 | 文字指令解析與名單回覆、@選單、新成員說明 |
| `backend/app/notifications/line_group_actions.py` | 新增 | postback 資料編碼與驗證、到場／未到場、招生結果欄位 |
| `backend/app/notifications/line_digest.py` | 新增 | 每日摘要的查詢、組裝、推播與去重 |
| `backend/app/notifications/service.py` | 修改 | LINE 推播段落改成多目標＋種類過濾＋@所有人；`visit_upcoming` 對開摘要的群組略過 |
| `backend/app/notifications/line_routes.py` | 修改 | webhook 把群組事件交給 commands／actions；後台設定 API 增加群組開關 |
| `backend/app/workers/maintenance.py` | 修改 | 新增「每日摘要」步驟 |
| `backend/app/booking/models.py`、`history.py` | 修改 | `VisitEventSource` 新增 `LINE_GROUP`；`Actor.line_group()` |
| `admin/src/views/LineNotificationsView.vue`、相關 api／型別 | 修改 | 每群組開關與總部群組 |
| `admin/src/utils/labels.ts`、稽核標籤檔 | 修改 | 新通知種類與稽核鍵的中文 |
| `backend/tests/test_line_group_*.py` | 新增 | 各 Task 的測試（檔名見各 Task） |
| `docs/specs/…`、`README.md`、`deploy/README.md` | 修改 | 回寫差異、日期段落 |

---

### Task 1: 群組設定資料表與目標計算

**Files:**
- Modify: `backend/app/notifications/models.py`
- Create: `backend/migrations/versions/<rev>_line_group_settings.py`、`backend/app/notifications/line_group_settings.py`
- Test: `backend/tests/test_line_group_settings.py`

**Interfaces:**
- Produces（Task 6、7、8、9 使用）:
  - 模型 `LineGroupSetting(target_id PK→line_groups, kinds: list[str] JSONB, digest_enabled: bool, mention_all_same_day: bool, is_hq: bool, updated_at, updated_by)`；`LineDigestRun(target_id, digest_date)` 複合主鍵＋`created_at`。
  - `STAFF_KINDS: tuple[str, ...] = ("visit_request_created", "visit_request_confirmed", "visit_request_rescheduled", "visit_request_cancelled")`（設計 §4.4 的四個種類）。
  - `@dataclass(frozen=True) class GroupTarget: target_id: str; kinds: frozenset[str]; digest_enabled: bool; mention_all_same_day: bool; is_hq: bool`。
  - `async def targets_for(db, campus_key: str) -> list[GroupTarget]`：該校的校區群組（`line_campus_targets`，`left_at` 為空）∪ 所有 `is_hq` 且 `left_at` 為空的群組，去重；沒有設定列的群組用預設（`kinds=全部`、`digest_enabled=True`、`mention_all_same_day=True`、`is_hq=False`）。
  - `async def campuses_served(db, target_id: str) -> list[str] | None`：這個群組可查詢／操作的校區 key 清單；`is_hq` → 全部啟用中的校區；校區群組 → 它在 `line_campus_targets` 對到的校；群組不存在、`left_at` 不為空或不是任何目標 → `None`。

- [ ] **Step 1: 寫失敗的測試** `test_line_group_settings.py`：
  - `test_targets_for_unset_group_gets_defaults`：只設義華的校區群組、沒有設定列 → `targets_for(db, "yihua")` 回一個 `GroupTarget`，`kinds == frozenset(STAFF_KINDS)`、`digest_enabled is True`。
  - `test_hq_group_is_added_to_every_campus`：另一個群組 `is_hq=True` → `targets_for` 對 `yihua`、`minghua` 都含它，且義華同時含校區群組（兩個目標）。
  - `test_group_that_left_is_excluded`：`left_at` 有值的校區群組與總部群組都不出現。
  - `test_campuses_served`：校區群組回自己的校；總部群組回全部啟用中的校；未綁群組回 `None`。
- [ ] **Step 2: 執行確認失敗**：`uv run pytest tests/test_line_group_settings.py -q`，預期 ImportError／找不到模型。
- [ ] **Step 3: 實作**：在 `models.py` 加兩個模型（風格照同檔 `LineCampusTarget`）；`uv run alembic revision -m line_group_settings` 後手寫兩張表的建立與 `downgrade`（`line_group_settings.kinds` 預設用 server_default 寫入四個種類的 JSON）；`line_group_settings.py` 實作上面介面。
- [ ] **Step 4: 驗證 migration 與測試**：`uv run alembic upgrade head && uv run alembic downgrade -1 && uv run alembic upgrade head`、再跑 Step 2 的測試，預期全過。
- [ ] **Step 5: Commit**（見 Global Constraints）：`feat(line): 群組設定資料表與推播目標計算`。

---

### Task 2: 後台群組設定 API

**Files:**
- Modify: `backend/app/notifications/line_routes.py`（`LineGroupOut`、`_settings_out`、新增更新路由）、`contracts/openapi.json` 與產生的型別
- Test: `backend/tests/test_line_group_settings_api.py`

**Interfaces:**
- Consumes: Task 1 的 `LineGroupSetting`、`STAFF_KINDS`。
- Produces: `LineGroupOut` 多四欄 `kinds: list[str]`、`digest_enabled: bool`、`mention_all_same_day: bool`、`is_hq: bool`；`PUT /admin/line/groups/{target_id}`，body `LineGroupSettingsUpdate(kinds: list[str], digest_enabled: bool, mention_all_same_day: bool, is_hq: bool)`，回 `LineSettingsOut`。權限與現有 `update_line_campus_target` 相同；`kinds` 含未知種類 → 422；群組不存在或 `left_at` 不為空 → 404；`is_hq=True` 只能設在 `verified_at` 不為空的群組（和校區目標相同規則，錯誤碼沿用現有「群組未驗證」那個）。稽核 `line.group.settings.update`，metadata 記四個欄位的新值。

- [ ] **Step 1: 寫失敗的測試**：`test_get_line_settings_includes_group_flags_with_defaults`、`test_update_group_settings_persists_and_audits`（斷言 `AuditLogEntry.action == "line.group.settings.update"`）、`test_unknown_kind_rejected_422`、`test_unverified_group_cannot_be_hq`、`test_non_authorized_user_forbidden`（沿用同檔其他測試的無權限使用者做法）。
- [ ] **Step 2: 執行確認失敗。**
- [ ] **Step 3: 實作**路由與回應欄位；沒有設定列時 PUT 建立、有則更新（upsert）。
- [ ] **Step 4: 驗證**：測試通過；`npm run contract:generate && npm run contract:check` 通過。
- [ ] **Step 5: Commit**：`feat(line): 後台可設定每個群組的通知種類與總部群組`。

---

### Task 3: 後台群組設定畫面

**Files:**
- Modify: `admin/src/views/LineNotificationsView.vue`、其 api／型別（取自 `contracts/generated`，不手寫型別）、`admin/src/utils/labels.ts`（四個種類與摘要的中文）、稽核標籤檔（`line.group.settings.update`）
- Test: `admin/src/__tests__/lineGroupSettings.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `PUT /admin/line/groups/{target_id}` 與 `LineGroupOut` 新欄位。

- [ ] **Step 1: 寫失敗的測試**（仿 `lineIntegrations20261116.test.ts` 的掛載方式）：
  - `renders one switch per notification kind for each verified group`：四個種類各一顆開關（字面：新的參觀預約、參觀預約已確認、參觀預約已改期、參觀預約已取消）＋「每日摘要」＋「當天異動 @所有人」＋「設為總部群組」。
  - `toggling a switch sends the full settings object`：切換「每日摘要」後 PUT body 為 `{kinds:[…], digest_enabled:false, mention_all_same_day:true, is_hq:false}`。
  - `unverified groups show no switches`。
- [ ] **Step 2: 確認失敗**：`npm --prefix admin run test:unit -- lineGroupSettings`。
- [ ] **Step 3: 實作**畫面（沿用現有群組列的版面與 Element Plus 元件；文案客氣、不寫開發輔助字）。
- [ ] **Step 4: 驗證**：該測試過；`npm --prefix admin run typecheck`、`labelCoverage.test.ts` 過。
- [ ] **Step 5: Commit**：`feat(admin): LINE 通知頁每群組通知開關`。

---

### Task 4: 卡片顏色與到場按鈕

**Files:**
- Modify: `backend/app/notifications/line_flex.py`、`backend/app/notifications/service.py`（`staff_line_message` 傳新參數）
- Create: `backend/app/notifications/line_group_actions.py`（先只放 postback 資料編碼，Task 9、10 再擴充）
- Test: `backend/tests/test_line_group_cards.py`

**Interfaces:**
- Produces（`line_group_actions.py`）:
  - `def encode(action: str, *parts: str) -> str` → `"ivy:" + ":".join([action, *parts])`，超過 290 字元丟 `ValueError`。
  - `def decode(data: str) -> tuple[str, list[str]] | None`：不是 `ivy:` 開頭或格式不對回 `None`。
  - 動作代碼常數：`ATTEND_ASK="att"`、`NOSHOW_ASK="nos"`、`ATTEND_OK="attok"`、`NOSHOW_OK="nosok"`、`CANCEL="no"`、招生欄位 `RF_DEPOSIT="rfd"`（只回確認卡）、`RF_DEPOSIT_OK="rfdok"`（確認後才寫入）、`RF_NODEP_ASK="rfn"`、`RF_NODEP="rfnr"`、`RF_SOURCE_ASK="rfs"`、`RF_SOURCE="rfsc"`、`RF_BUS="rfb"`。
- Produces（`line_flex.py`）:
  - `KIND_STYLE: dict[str, tuple[str, str]]`（kind → (標題字色, 按鈕色)），四個種類用 Global Constraints 的色碼；未知 kind 回退 `BRAND`。
  - `staff_card(...)` 新增關鍵字參數 `kind: str = "visit_request_created"` 與 `attend_buttons: bool = False`；`attend_buttons=True` 時 footer 在「開啟案件」下加兩顆 postback 按鈕「已到場」「未到場」（`data=encode(ATTEND_ASK, receipt_id)`／`encode(NOSHOW_ASK, receipt_id)`）。取消種類永遠不放這兩顆。
  - `service.staff_line_message(..., kind=...)` 把種類帶進去；只有案件狀態是 `confirmed` 且有場次時 `attend_buttons=True`。

- [ ] **Step 1: 寫失敗的測試** `test_line_group_cards.py`：
  - `test_each_kind_has_its_own_title_color`：四個 kind 產生的 header 標題 `color` 各不相同，且與 `KIND_STYLE` 一致。
  - `test_title_colors_meet_contrast_on_white`：四個標題色對 `#FFFFFF` 的 WCAG 對比 ≥ 4.5（測試內自己算相對亮度）。
  - `test_attend_buttons_present_for_confirmed_booking_and_absent_for_cancelled`：斷言 footer 內 postback 按鈕的 `data` 等於 `encode("att", receipt_id)`；cancelled 卡沒有任何 postback 按鈕。
  - `test_card_has_no_phone_email_or_child_data_and_alttext_has_no_parent_name`：序列化整張卡，斷言不含測試案件的電話與 Email 字串，altText 不含家長稱呼。
  - `test_encode_decode_roundtrip_and_rejects_garbage`：`decode("ivy:att:<uuid>") == ("att", ["<uuid>"])`、`decode("x") is None`、`decode("ivy:")` 不丟例外。
- [ ] **Step 2: 確認失敗。**
- [ ] **Step 3: 實作**；顏色常數放在 `line_flex.py`。
- [ ] **Step 4: 驗證**：`uv run pytest tests/test_line_group_cards.py tests/test_line_notifications.py tests/test_line_integrations_20261116.py -q` 全過（既有卡片測試如果斷言舊標題色，改為斷言新常數，並在回報中列出）。
- [ ] **Step 5: Commit**：`feat(line): 群組卡片依種類換色並加到場按鈕`。

---

### Task 5: 名單、摘要、選單、說明、確認、結果、選擇卡版型

**Files:**
- Modify: `backend/app/notifications/line_flex.py`
- Test: `backend/tests/test_line_group_flex.py`

**Interfaces:**
- Consumes: Task 4 的 `encode`、動作代碼。
- Produces（都回 `dict` 訊息，經 `flex_message`／`text_message`）:
  - `@dataclass(frozen=True) class VisitRow: receipt_id: str; campus_name: str; when: str; parent_name: str | None; status: str`（`when` 已格式化，`parent_name` 已清理）。
  - `def visit_list_message(title: str, rows: list[VisitRow], *, empty_text: str) -> dict`：無資料回 `text_message(empty_text)`；有資料回 carousel，第一張總覽（標題、各校筆數），之後每筆一張（含「已到場」「未到場」按鈕，僅 `status == "confirmed"`）；最多 12 張，超過 11 筆時第 12 張為「另有 N 筆，請開後台」（無按鈕）。
  - `def menu_message() -> dict`：Flex，三顆 **message action** 按鈕（文字分別是 `今天參觀`、`明天參觀`、`本週參觀`）。
  - `def help_message() -> dict`：文字，列出三個指令與「@官方帳號可叫出選單」。
  - `def confirm_message(action: str, receipt_id: str, who: str, when: str, token: str) -> dict`：Flex，標題「確認〈who〉〈when〉已到場？」（action 為未到場時改字），兩顆 postback：「確認」`encode(ATTEND_OK|NOSHOW_OK, receipt_id, token)`、「取消」`encode(CANCEL)`。
  - `def attended_result_message(who: str, *, recruitment_visit_id: str | None, receipt_id: str, admin_url: str | None, already_deposited: bool) -> dict`：Flex。有 `recruitment_visit_id` 時含三排按鈕（預繳：已預繳／未預繳；來源分類；搭交通車：搭／不搭）＋「到後台填完整資料」（`admin_url` 非空才放）；`None` 時只放後台連結。
  - `def reasons_message(recruitment_visit_id: str) -> dict`、`def sources_message(recruitment_visit_id: str) -> dict`：Flex 選擇卡，按鈕文字取 `constants.NO_DEPOSIT_REASONS` 與 `constants.LINE_SOURCE_CHOICES` 的六項短標籤（使用者 10-06 裁定的六個來源分類，不是九個），`data` 帶**索引**（`encode(RF_NODEP, rvid, str(index))`、`encode(RF_SOURCE, rvid, str(index))`；來源索引對應 `LINE_SOURCE_CHOICES` 的順序）。

- [ ] **Step 1: 寫失敗的測試**：
  - `test_visit_list_rows_become_carousel_with_summary_first`：3 筆 → 4 張（1 總覽＋3），每筆 confirmed 的有兩顆 postback。
  - `test_visit_list_caps_at_12_bubbles_with_overflow_note`：15 筆 → 恰 12 張，最後一張文字含「另有 4 筆」。
  - `test_visit_list_empty_returns_text`。
  - `test_menu_buttons_are_message_actions_with_exact_text`。
  - `test_confirm_message_buttons_carry_token_and_stay_under_300_chars`：用最長的 uuid＋token 斷言兩顆按鈕 `data` 長度 < 300。
  - `test_result_message_without_recruitment_visit_has_only_admin_link`、`test_result_message_with_recruitment_visit_has_all_field_buttons`。
  - `test_reasons_and_sources_cards_cover_every_constant_in_order`：按鈕文字依序等於 `NO_DEPOSIT_REASONS` 與 `LINE_SOURCE_CHOICES` 的短標籤，`data` 索引 `0..n-1`。
- [ ] **Step 2: 確認失敗。** Step 3: 實作（顏色、文字樣式沿用 Task 4）。Step 4: `uv run pytest tests/test_line_group_flex.py -q` 全過。Step 5: Commit：`feat(line): 群組名單、摘要、確認與結果卡版型`。

---

### Task 6: 推播改成多目標、種類過濾、@所有人

**Files:**
- Modify: `backend/app/notifications/service.py`（`dispatch_outbox_message` 的 LINE 段落，約 676–715 行）
- Test: `backend/tests/test_line_group_dispatch.py`

**Interfaces:**
- Consumes: Task 1 `targets_for`、`GroupTarget`；Task 4 的 `staff_line_message(kind=...)`。
- Produces: `def mention_all_message() -> dict`（放 `line.py` 或 `line_flex.py`）：`{"type":"textV2","text":"{everyone} 今天有臨時變動，請看上方卡片","substitution":{"everyone":{"type":"mention","mentionee":{"type":"all"}}}}`。

行為（設計 §4.4、§4.5、§4.1）：
- 對 `targets_for(db, campus_key)` 的每個目標各推一次；`recipient_key=target_id`、`channel="line"`（已有 `_already_delivered`／`_record_delivery`）；重試只補沒成功的目標。
- 目標的 `kinds` 不含這個 kind → 略過該目標（不記 delivery）。
- `kind == reminders.UPCOMING_VISIT_KIND`：只推給 `digest_enabled == False` 的目標（開摘要的不推）。
- 種類是新預約／已改期／已取消，且案件相關場次日期（改期用新場次；取消用被取消的那個場次，即案件當下的 `slot`，若已清空就不加）等於 `today_local()`，且目標 `mention_all_same_day` → 同一次 push 的 messages 為 `[卡片, mention_all_message()]`。
- 任一目標推播失敗不擋其他目標與 Email；最後拋出第一個錯誤讓整筆重試（沿用現有 `line_error` 作法）。

- [ ] **Step 1: 寫失敗的測試**（用 `FakeLine`，斷言 `fake_line.pushes`）：
  - `test_campus_and_hq_group_both_receive_new_booking`：兩個 push，`to` 各是校區群組與總部群組。
  - `test_kind_toggle_off_skips_that_group_only`：總部群組 `kinds` 去掉 `visit_request_cancelled` → 取消案件只推校區群組。
  - `test_upcoming_visit_not_pushed_to_digest_group_but_pushed_when_digest_off`。
  - `test_same_day_booking_adds_everyone_mention_as_second_message`：今天場次 → `messages` 長度 2、第二個 `type == "textV2"` 且含 `mentionee.type == "all"`；明天場次 → 長度 1。
  - `test_mention_all_off_sends_card_only`。
  - `test_retry_only_resends_failed_group`：兩目標，第二個回 429 → 拋錯；重跑只多一個 push（給第二個目標）。
  - `test_group_that_left_gets_nothing`。
- [ ] **Step 2: 確認失敗。** Step 3: 重寫該段落成迴圈。Step 4: `uv run pytest tests/test_line_group_dispatch.py tests/test_line_notifications.py tests/test_notification_retry_reminders.py tests/test_notifications.py -q` 全過。Step 5: Commit：`feat(line): 群組推播支援總部群組、種類開關與當天 @所有人`。

---

### Task 7: 每日摘要

**Files:**
- Create: `backend/app/notifications/line_digest.py`
- Modify: `backend/app/workers/maintenance.py`（`CycleResult` 加 `digests_sent: int = 0`；在「提醒」步驟後、outbox 步驟前或後皆可，但要用同一個 `line_transport`）
- Test: `backend/tests/test_line_group_digest.py`

**Interfaces:**
- Consumes: Task 1（`LineDigestRun`、`targets_for` 的反向：需要「所有 `digest_enabled` 且未離開的目標群組」→ 在 `line_group_settings.py` 增 `async def digest_targets(db) -> list[GroupTarget]`，含各目標服務的校區）、Task 5 `visit_list_message`、`VisitRow`。
- Produces:
  - `async def rows_for_day(db, campus_keys: list[str], day: date) -> list[VisitRow]`：這些校當天 `status == confirmed` 且有場次的案件，依場次時間排序；排除標記為測試／重複的案件（`booking.exclusion`，沿用 `reminders.due_upcoming` 的排除方式）；家長稱呼用 `line_parent_name`。（Task 8 的名單查詢也用它，範圍擴為 `rows_between(db, campus_keys, start, end)`，`rows_for_day` 呼叫它。）
  - `async def send_due_digests(db, settings, *, line_client, now: datetime | None = None) -> int`：台灣時間 ≥ 08:00 且 < 12:00；對每個 digest 目標：已有 `LineDigestRun(target_id, today)` 略過；當天沒有任何案件略過（**也不寫 run 列**，因為之後可能補登；但同一天已發過就不再發）；推播成功才寫 run 列並回傳計數；`push` 的 `key` 用 `uuid.uuid5(NAMESPACE_URL, f"digest:{target_id}:{day}")`。標題「今日參觀（M/D 週X）」。

- [ ] **Step 1: 寫失敗的測試**（凍結時間用 `now` 參數）：
  - `test_digest_sent_once_at_8am_with_all_confirmed_visits_sorted`：07:59 不發；08:00 發 1 則；08:30 再跑不重發（`LineDigestRun` 一列）。
  - `test_no_visits_no_digest_and_no_run_row`。
  - `test_more_than_11_visits_adds_overflow_bubble`（呼叫 Task 5 版型，斷言 carousel 12 張）。
  - `test_hq_group_digest_covers_all_campuses_campus_group_only_its_own`。
  - `test_digest_off_group_gets_none`。
  - `test_push_failure_keeps_no_run_row_and_retries_next_cycle_until_noon`：第一次 push 回 500 → 無 run 列；第二次成功 → 有；`now=12:00` 不再嘗試。
  - `test_cancelled_and_excluded_visits_not_listed`。
- [ ] **Step 2: 確認失敗。** Step 3: 實作並在 `maintenance._run_steps` 接上（失敗只記 `failed_steps.append("digest")`，不擋其他步驟）。Step 4: `uv run pytest tests/test_line_group_digest.py tests/test_maintenance*.py -q` 全過（先 `ls tests | grep maintenance` 確認檔名）。Step 5: Commit：`feat(line): 每日早上參觀摘要`。

---

### Task 8: 群組文字指令、@選單、新成員說明

**Files:**
- Create: `backend/app/notifications/line_group_commands.py`
- Modify: `backend/app/notifications/line_routes.py`（`_handle_group_events` 之後新增 `await line_group_commands.handle(request, db, events)`；只在 `line_webhook`（main 帳號）呼叫）
- Test: `backend/tests/test_line_group_commands.py`

**Interfaces:**
- Consumes: Task 1 `campuses_served`；Task 5 版型；Task 7 `rows_between`。
- Produces: `async def handle(request, db, events: list[dict]) -> None`。行為：
  - 只處理 `source.type == "group"` 且 `campuses_served` 非 `None` 的事件。
  - `message` 文字去掉前後空白與開頭的 `@名稱 ` 後，若完全等於 `今天參觀`／`明天參觀`／`本週參觀`（本週＝今天到本週日）→ reply `visit_list_message`；若此則訊息 `message.mention.mentionees` 有 `isSelf == True` 且剩餘文字為空 → reply `menu_message`；有 `isSelf` 且剩餘文字是 `今天`／`明天`／`本週` → 當查詢處理。其他訊息一律不回應。
  - 限流：`ratelimit.Limit("line_group_query", window_seconds=60, max_per_window=6)`，key 為 `target_id`；超過直接不回。
  - `memberJoined` 或 `join` → reply `help_message`；限流 `Limit("line_group_help", window_seconds=600, max_per_window=1)`。
  - reply 失敗（`LinePushError`／`httpx.HTTPError`）只記 warning（沿用 `_handle_user_events` 的寫法）。

- [ ] **Step 1: 寫失敗的測試**（用 `_webhook(app, events, account="main")` 與簽章；群組事件 source `{"type":"group","groupId":"C"+"a"*32,"userId":...}`）：
  - `test_today_visits_command_replies_with_list_and_costs_no_push`：`fake_line.replies` 一則 carousel、`fake_line.pushes` 為空。
  - `test_command_needs_exact_match`：`"今天參觀嗎"`、`"今天"` 都不回。
  - `test_campus_group_sees_only_its_campus_hq_sees_all`。
  - `test_unbound_or_left_group_gets_no_reply`。
  - `test_mention_self_returns_menu_and_short_word_works_with_mention`。
  - `test_seventh_query_in_a_minute_is_ignored`。
  - `test_member_joined_replies_help_once_per_10_minutes`。
  - `test_reply_failure_does_not_break_webhook`（reply 回 500 → webhook 仍 200）。
  - `test_messages_are_not_stored`：webhook 前後 `line_groups` 以外沒有新增含訊息文字的列（掃 `AuditLogEntry` 與 `LineGroup` 欄位不含指令文字）。
- [ ] **Step 2: 確認失敗。** Step 3: 實作。Step 4: `uv run pytest tests/test_line_group_commands.py tests/test_line_notifications.py -q` 全過。Step 5: Commit：`feat(line): 群組可查參觀名單、叫出選單，新成員自動說明`。

---

### Task 9: 到場／未到場（二次確認）

**Files:**
- Modify: `backend/app/notifications/line_group_actions.py`、`backend/app/booking/models.py`（`VisitEventSource.LINE_GROUP = "line_group"`）、`backend/app/booking/history.py`（`Actor.line_group()` classmethod，`user_id=None`）、`backend/app/notifications/line_routes.py`（webhook 加 `await line_group_actions.handle(request, db, events)`）、後台歷程時間線的來源顯示（`grep -rn "VisitEventSource\|\"system\"" admin/src` 找 `visitTimeline.ts` 一帶，把 `line_group` 顯示為「LINE 群組」）
- Test: `backend/tests/test_line_group_attend.py`

**Interfaces:**
- Consumes: Task 4 的 `encode/decode` 與動作代碼；Task 5 的 `confirm_message`、`attended_result_message`；Task 1 `campuses_served`；現有 `workflow_service.lock_status/mark_completed/mark_no_show/arrives_early`、`slot_service.has_started`、`today_local`、`audit_service.log_action`、`Settings.admissions_enabled`、`booking_link.ensure_from_visit_request`。
- Produces:
  - `def make_token(secret: str, action: str, receipt_id: str, *, now: datetime) -> str`：`f"{exp_epoch}.{hmac_hex16}"`，HMAC-SHA256 密鑰 `session_secret`，訊息 `f"line-group-confirm\0{action}\0{receipt_id}\0{exp}"`，有效 300 秒；`def check_token(secret, action, receipt_id, token, *, now) -> bool`（常數時間比較）。
  - `async def handle(request, db, events: list[dict]) -> None`：處理 `postback` 事件，`decode(event["postback"]["data"])`；來源不是群組、或 `campuses_served` 為 `None`、或 `decode` 失敗 → 不回應。
  - 規則（設計 §5）：
    - `att`／`nos`（詢問）：讀案件；校區必須在 `campuses_served` 內，否則 reply「這個群組沒有權限處理這筆」；案件非 `confirmed` → reply 目前狀態（「已標記已到場」「已標記未到場」「已取消」）；已到場需滿足「場次今天或已開始」（`arrives_early` 為真且場次日期 > 今天 → reply「要到參觀當天才能標記」）；未到場需 `slot_service.has_started`，否則 reply「參觀時段開始後才能標記未到場」；通過 → reply `confirm_message`（token 用 `make_token`）。
    - `attok`／`nosok`（確認）：先 `check_token`，失敗 reply「這個確認已過期，請重新按一次」；再用 `workflow_service.lock_status` 鎖列重讀，重做上面的所有檢查（授權、狀態、時間），然後呼叫 `mark_completed(db, vr, actor=Actor.line_group(), admissions_enabled=settings.admissions_enabled, early=workflow_service.arrives_early(vr.slot))`／`mark_no_show(db, vr, actor=Actor.line_group())`；`InvalidTransition` → reply 其 `message`；成功 → 稽核 `line.group.visit_attend`／`line.group.visit_no_show`（metadata：`group_id`、`from_status`、`to_status`，事件有 `source.userId` 就加 `line_user_id`）→ commit → reply 結果（已到場且招生入學開著時帶 `attended_result_message`，`recruitment_visit_id` 由 `RecruitmentVisit.visit_request_id == vr.id` 查）。
    - `no`：reply「已取消」。
  - 回覆文字全部集中成模組常數，測試直接引用。

- [ ] **Step 1: 寫失敗的測試**（建案件用 `book_slot`；群組用 Task 1 的設定；postback 事件 `{"type":"postback","replyToken":"t","source":{"type":"group","groupId":G},"postback":{"data":...}}`）：
  - `test_ask_then_confirm_marks_completed_and_creates_recruitment_visit`：今天已開始的場次、`admissions_enabled=True`：按 `att` → 回確認卡、案件仍 `confirmed`；按 `attok`＋有效 token → 案件 `completed`、`RecruitmentVisit` 一列、`AdConversionJob` 一列（`visit_attended`）、歷程 `source == "line_group"`、`AuditLogEntry.action == "line.group.visit_attend"`。
  - `test_confirm_without_ask_still_needs_valid_token`、`test_expired_token_rejected`（`now` 往後 301 秒）、`test_token_for_another_receipt_rejected`。
  - `test_double_confirm_second_press_reports_current_state_and_writes_once`：第二次 reply「已標記已到場」，`RecruitmentVisit` 仍一列、`AdConversionJob` 仍一列。
  - `test_other_campus_case_is_refused`（Review Focus 1）：義華群組按明華案件 → 「這個群組沒有權限處理這筆」，案件仍 `confirmed`、無稽核列。
  - `test_total_future_day_slot_refused_until_the_day`；`test_today_not_started_slot_uses_early_arrival`（`completed`，`after.early` 為真）；`test_no_show_only_after_slot_started`。
  - `test_garbage_data_is_ignored_or_fixed_reply`：`"ivy:att:not-a-uuid"`、`"ivy:attok:<uuid>:garbage"`、`"zzz"` 皆不丟例外、webhook 200（Review Focus 3）。
  - `test_admissions_disabled_still_marks_but_result_has_only_admin_link`。
  - `test_group_that_left_cannot_act`。
- [ ] **Step 2: 確認失敗。** Step 3: 實作；`Actor.line_group()` 與列舉新增；先 `grep -n "VisitEventSource\|source" backend/app/booking/models.py` 確認 `visit_request_events.source` 有無 CHECK，有就補 migration（沒有就不用）。Step 4: `uv run pytest tests/test_line_group_attend.py tests/test_visit_request*.py -q` 全過（`ls tests | grep visit_request` 確認檔名）。Step 5: Commit：`feat(line): 群組按鈕標記已到場與未到場（二次確認）`。

---

### Task 10: 招生結果欄位按鈕

**Files:**
- Modify: `backend/app/notifications/line_group_actions.py`
- Test: `backend/tests/test_line_group_recruitment.py`

**Interfaces:**
- Consumes: Task 5 的 `reasons_message`、`sources_message`；`records.get_visit_for_update(db, visit_id)`、`records.update_visit(db, visit, *, changes: dict, expected_version: int, actor_user_id=None) -> list[str]`、`funnel.transition(db, visit, *, to_stage, expected_version, actor_user_id, ...)`（先讀 `funnel.py:108-135` 確認完整參數順序）、`records.VersionConflict`、`funnel.TransitionNotAllowed`、`constants.NO_DEPOSIT_REASONS`、`constants.LINE_SOURCE_CHOICES`。
- Produces: `handle` 增加動作 `rfd`（已預繳）、`rfn`（開原因卡）、`rfnr`（寫原因，參數 `index`）、`rfs`（開分類卡）、`rfsc`（寫分類，參數 `index`）、`rfb`（參數 `1`／`0`，寫 `rides_bus`）。
- 規則（設計 §5.1）：
  - 每個動作先以 `RecruitmentVisit.id` 讀訪視（`with_for_update`），驗證：存在、未匿名化（`anonymized_at is None`）、未退出（`withdrawn_at is None`）、`visit_request_id` 不為空、其案件校區在 `campuses_served` 內；任一不符 reply「這筆已不能在群組填寫」（授權不符用「這個群組沒有權限處理這筆」）。
  - `rfd`（施工修正：先回確認卡，不寫入；確認卡的 `rfdok` 帶無狀態 token，驗過才走以下轉換，因為預繳會排不可撤回的廣告回傳）：`funnel.transition(..., to_stage="deposited", expected_version=visit.version, actor_user_id=None)`；已是預繳（`has_deposit`）→ reply「已是預繳狀態」。
  - `rfnr`：`has_deposit` 為真 → reply「已是預繳狀態，要更正請到後台」；索引超出範圍或非整數 → reply 固定錯誤文字；否則 `update_visit(changes={"no_deposit_reason": NO_DEPOSIT_REASONS[i]}, ...)`。
  - `rfsc`：索引對 `LINE_SOURCE_CHOICES`，寫 `source_category` 代碼；`rfb`：寫 `rides_bus`。
  - `VersionConflict` → 重讀一次再試，仍衝突 reply「資料剛被更新，請再按一次」。
  - 每次寫入後稽核 `line.group.recruitment_field`，metadata 只有 `{"field": <欄位名>, "value": <代碼或布林>, "group_id": G}`（原因寫索引代碼的文字**不放**，只放索引數字；不放任何自由文字）；招生歷程 `actor_user_id=None`；reply「已記錄：〈欄位中文〉〈值〉」。

- [ ] **Step 1: 寫失敗的測試**（先用 Task 9 流程建立已到場案件與招生訪視，helper 放測試檔內）：
  - `test_deposit_button_moves_funnel_and_logs_deposit_added`：`has_deposit` 為真、事件 `deposit_added` 一筆、稽核一筆。
  - `test_no_deposit_reason_written_by_index_and_card_covers_all_reasons`：索引 3 → `no_deposit_reason == NO_DEPOSIT_REASONS[3]`。
  - `test_source_category_and_bus_written`。
  - `test_not_deposit_after_deposit_is_refused`（已預繳後按 `rfnr` → 回「已是預繳狀態，要更正請到後台」，欄位不變）。
  - `test_forged_index_and_nonint_are_rejected_without_write`（Review Focus 3）：索引 `99`、`-1`、`abc`。
  - `test_other_campus_and_anonymized_and_withdrawn_are_refused`（Review Focus 1）。
  - `test_version_conflict_retries_once`：測試中在 `update_visit` 前用另一個 session 先把版本加一。
  - `test_audit_and_event_metadata_contain_no_free_text`：斷言稽核 metadata 的鍵只有 `field、value、group_id`（和可能的 `line_user_id`），招生歷程 metadata 不含備註或家長回應。
- [ ] **Step 2: 確認失敗。** Step 3: 實作。Step 4: `uv run pytest tests/test_line_group_recruitment.py tests/test_admissions*.py -q` 全過。Step 5: Commit：`feat(line): 到場後在群組用按鈕填招生結果欄位`。

---

### Task 11: 標籤、文件與整體驗證

**Files:**
- Modify: `service._KIND_LABELS`（不需要新通知種類時不動）、`admin/src/utils/labels.ts` 與稽核標籤檔（`line.group.visit_attend`、`line.group.visit_no_show`、`line.group.recruitment_field`、`line.group.settings.update` 的中文：標記已到場（LINE 群組）、標記未到場（LINE 群組）、填寫招生欄位（LINE 群組）、更新群組通知設定）、`docs/specs/2026-11-17-line-group-interactions-design.md`（§4.1 回寫「不經 outbox」差異；§5 token 改為無狀態 HMAC）、`README.md` 頂部日期段落、`deploy/README.md` 頂部（上線步驟：migration 為新增兩張表、不必備份；預設行為變更＝每日摘要取代群組的「即將參觀」卡片；實測清單抄設計附錄）

- [ ] **Step 1:** `grep -rn "line.group.verify" admin/src` 找標籤檔，加四個鍵；`npm --prefix admin run test:unit -- labelCoverage` 過。
- [ ] **Step 2: 跑整體驗證**（同時只跑一組）：
  - `cd backend && uv run pytest -q`（全套，預期全過；別在跑到一半時改原始碼）。
  - `npm --prefix admin run typecheck && npm --prefix admin run test:unit`。
  - `npm run contract:check`、`python3 -m unittest discover -s deploy/tests`、`npm --prefix web run typecheck`。
- [ ] **Step 3:** 若 `backend/.test_durations` 因新增大量測試而偏離，`uv run pytest --store-durations` 重產。
- [ ] **Step 4:** 更新文件；回報時明列「未驗證項」＝設計附錄四項（真群組實測）。
- [ ] **Step 5: Commit**（使用者同意時）：`docs(line): 群組互動規格回寫與上線紀錄`。

---

## Self-Review

- **Spec coverage**：1（Task 7）、2（Task 8）、4＋§5.1（Task 4、5、9、10）、7（Task 4）、8（Task 1、2、3、6）、11（Task 6）、12、13（Task 8）；§6 則數（Task 6、7 的 push 物件數測試）；§7 驗證（Task 11）；附錄 4 項屬真群組實測，不在計畫內。無缺口。
- **型別一致**：`GroupTarget`／`campuses_served`／`targets_for`（Task 1）→ Task 6、7、8、9、10 沿用同名；`encode/decode` 與動作代碼（Task 4）→ Task 5、9、10 沿用；`VisitRow`／`rows_between`（Task 5、7）→ Task 8 沿用。
- **差異**：摘要不經 outbox、token 無狀態，已在 Global Constraints 與 Task 11 回寫設計。
- **比例**：計畫只給簽章、行為與測試名稱與關鍵斷言，函式本體留給施工者。
