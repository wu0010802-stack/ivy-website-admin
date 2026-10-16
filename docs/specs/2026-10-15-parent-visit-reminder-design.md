# 參觀前一天提醒信（家長）（2026-10-15）設計

日期：2026-10-15
狀態：設計 10-15 經使用者核可（寄送時機「參觀前 24 小時」由使用者逐題選定）；規格 10-15 經使用者核可（含寫規格時補的預設值）
基準：`origin/main` `aae0debc`（migration head `c6a9e3f15d27`；**本案不新增 migration**）
分支（實作）：`feature/parent-reminder-20261015`
上游：10-15 後台功能盤點，使用者選定六項之一（第 1 波）。家長自選場次規格把它列為「不做（之後有需求再加）」（`docs/specs/2026-09-30-parent-self-booking-design.md:33`）；10-15 上線的「預約全程」已量得到「沒來」，這封信是要壓低它。

## 1. 背景與目標

現在參觀前 24 小時只提醒**員工**（`visit_upcoming`，`backend/app/notifications/reminders.py`），家長除了預約當下的確認信，參觀前不會再收到任何信。

### 1.1 成功標準

1. 已確認、有 Email 的參觀，在開始前 24 小時寄一封提醒信給家長；同一個場次只寄一次。
2. 信裡有日期場次、地址、電話；要改期或取消時，期限內附修改連結，期限過了請家長來電。
3. 取消、改期、停課、匿名化之後，舊的提醒不會寄出。
4. 沒設寄信（SMTP）時不寄、不報錯，和其他家長信一樣。

### 1.2 裁定

| # | 事項 | 裁定 | 理由 |
|---|---|---|---|
| R1 ✔ | 時機 | 開始前 24 小時（`UPCOMING_VISIT_LEAD`，與員工提醒同一個常數） | 使用者 10-15 選定；最接近參觀日、最不容易忘 |
| R2 ✔ | 管道 | 只寄 Email | 既有裁定：家長信只走 Email（`docs/specs/2026-10-12-admin-batch-design.md:43`、`docs/specs/2026-10-14-holiday-closure-design.md:132`） |
| R3 ✔ | 誰收得到 | 狀態已確認、未匿名化、有 Email 的案件；官網預約與後台補登都算 | 補登有填 Email 的也收得到確認信，提醒信一致 |
| R4 ✔ | 剛約或剛改期 | 確認時間或最後一次改期時間晚於「開始前 24 小時」就不寄 | 同員工提醒（`reminders.py:123-125`）：那封確認信或變更信本身就是提醒。官網預約最短要提前 24 小時（`booking_configs.min_lead_hours` 預設 24），所以這條主要擋後台補登與臨時改期 |
| R5 ✔ | 去重 | 去重鍵 `parent_visit_reminder:{案件 id}:{場次 id}`；改期換場次就是新鍵 | 同員工提醒的做法（`reminders.py:89-90`），靠 `outbox_messages.dedupe_key` 唯一索引 |
| R6 ✔ | 寄出前再判斷 | 狀態仍是已確認、場次沒變（payload 的 `slot_id`）、還沒開始、那天不是停課日、未匿名化；任一不符就 skipped | 停課日另有「停課，請改約」信；沿用既有家長信的寄件檢查（`notifications/service.py:280-297`） |
| R7 ✔ | 修改連結 | 寄出當下 `parent_change_open` 為真（那間學校的線上修改期限還沒過）就附修改連結與截止時間；否則寫「要改期或取消，請來電 〇〇」 | 期限預設也是開始前 24 小時（`booking/parent_policy.py:17`），多數情況提醒到的時候已過期限；學校把期限調短時家長還能線上改 |
| R8 | 「明天」或「今天」 | 依寄出當下的台北日期決定：參觀日是明天寫「明天」、是今天寫「今天」 | 系統停擺後補寄時，「明天」可能已經不對 |
| R9 | 不寫案件時間線 | 和其他家長信一樣，不寫 `visit_request_events` | 寄送狀態在通知佇列與寄送失敗清單看得到 |
| R10 | 舊佇列作廢 | 沿用家長信「排進佇列超過 24 小時就作廢」（`notifications/service.py:271-272`） | 提醒信排入時離開始還有 24 小時，正常會在幾分鐘內寄出 |

### 1.3 不做

- 簡訊、LINE、站內通知給家長。
- 第二封提醒、自訂提醒時間、各校開關、家長退訂。
- 在信裡放孩子資料或完整電話（沿用家長信「不附個資」）。

## 2. 現況（`origin/main` `aae0debc`）

- 員工提醒：維護排程每輪第三步 `enqueue_due_reminders`（`workers/maintenance.py:158-166`）。查詢 `reminders.py:101-116`：狀態 confirmed、`anonymized_at` 為空、場次日在今天到 2 天後；逐筆算開始時間，`remind_at <= now < 開始` 才排（:119-121）。寄送前 `still_applies`（:139-162）。
- 家長信 kind（`booking/outbox.py:29-35`）：`parent_visit_booked`、`parent_visit_changed`、`parent_visit_cancelled`、`parent_visit_day_closed`；`PARENT_KINDS` 集合。標題與內文 `notifications/parent_email.py:18-23,58-104`（`visit_when`、`session_label`、`_deadline_text` 可重用）。寄件分派 `notifications/service.py` `_dispatch_parent_email`（:269-334：無 adapter skipped、超過 24 小時 skipped、非 confirmed skipped、場次已開始 skipped、`notification_deliveries` 以 `parent:{id}` 去重）。
- 修改連結：`booking/access_service.py` `current_manage_path` 寄件當下重算（:103-109）；有效期 max(發出＋14 天, 場次開始＋7 天)（:38-39）。
- 寄送失敗清單的 kind 中文：`notifications/service.py:38-42`、`admin/src/api/labels.ts`。
- 測試：`backend/tests/test_notification_retry_reminders.py`（員工提醒 :248-409）、`test_parent_email.py`、`test_visit_closure.py`。

## 3. 設計

### 3.1 排入

- `booking/outbox.py` 加 `PARENT_VISIT_REMINDER = "parent_visit_reminder"`，加進 `PARENT_KINDS`。`enqueue_parent_email` 不接受這個 kind（和 `day_closed` 一樣只由專屬函式排）。
- `reminders.enqueue_due_reminders` 在同一次掃描裡，對每個符合員工提醒條件、**且有 Email** 的案件，再寫一筆家長提醒：`kind=parent_visit_reminder`、payload `{visit_request_id, slot_id}`、去重鍵 R5。R4 的判斷與員工提醒共用同一段。
- 回傳的計數分開記（員工、家長），維護排程的 log 照現有格式多一個數字。

### 3.2 寄送

- `_dispatch_parent_email` 處理新 kind，寄件前檢查 R6（另加：payload 的 `slot_id` ≠ 案件目前的 `slot_id` → skipped；`parent_policy.day_closed` 為真 → skipped）。
- `parent_email.py` 加標題「參觀提醒」與內文組法：

```
主旨：【常春藤〇〇】參觀提醒：明天 10/16（四）上午場 09:30

〇先生／小姐您好：

提醒您，明天 10/16（四）上午場 09:30 在常春藤〇〇參觀。
地址：〇〇〇
電話：〇〇〇

（期限內，例如該校期限設 12 小時）要改期或取消，請在 10/15（三）21:30 前使用這個連結：<修改連結>
（期限過了）要改期或取消，請來電 〇〇〇。

這封信由系統自動寄出，請勿直接回覆。
```

  - 稱呼、地址、電話、參觀人數（有才列）的取法與確認信相同。
  - 修改連結重算不出來（缺 `admin_origin` 或 `session_secret`）時，改寫「要改期或取消，請來電」，不寫「請使用預約完成頁連結」。
- 寄送失敗照既有重試（5 次，退避 10／30／60／300／900 秒），失敗後出現在寄送失敗清單，可重寄；重寄時一樣跑 R6。

### 3.3 後台

- `labels.ts` 與 `notifications/service.py:38-42` 加 kind 中文「參觀提醒（家長）」；`labelCoverage.test.ts` 比對。
- 不加任何設定畫面。

## 4. 測試

- 後端 `backend/tests/test_parent_visit_reminder.py`：
  - 開始前 24 小時整點排入；24 小時又 1 分鐘前不排；開始後不排。
  - 沒有 Email 不排；已匿名化不排；確認時間晚於 `remind_at`（補登臨時約）不排；改期時間晚於 `remind_at` 不排。
  - 同一場次重跑掃描只有一筆；改期換場次後舊列 skipped、新場次在新的時間點排入。
  - 寄出前取消 → skipped；當天停課 → skipped。
  - 期限內附修改連結與截止時間；期限過了寫來電；連結重算不出來寫來電。
  - 「明天」與「今天」兩種主旨。
  - 維護排程一輪同時排員工與家長提醒並寄出（`recording_mail_adapter`）；`failing_mail_adapter` 重試到失敗後出現在寄送失敗清單、kind 中文正確。
  - 沒有 adapter → skipped，不拋錯。
- admin vitest：`labelCoverage` 新 kind。
- 不加 stack e2e（家長信在 stack 裡沒有寄件出口；後端測試已涵蓋）。

## 5. 部署與風險

- 不新增 migration、不新增環境變數。
- 正式站設好 SMTP 之前，這封信一律 skipped（可在「系統狀態」頁確認寄信設定）。
- 上線後第一輪掃描，會替接下來 24 小時內、確認時間早於提醒時間點的參觀補排提醒——這是預期行為。

## 6. 與其他工作的關係

- 「預約案件排除」（第 3 波）：被排除的案件不排、不寄提醒。哪一案後合併，就由它補上這個條件與測試。
- 與「系統狀態頁」不共用檔案。

## 7. 實作紀錄

- 實作計畫 `docs/superpowers/plans/2026-10-15-admin-wave1-status-reminder.md`；與「系統狀態頁」合為一支分支 `feature/admin-wave1-20261015`（上方「分支」欄寫的是原本的分開命名）。實作時 §6 說「與系統狀態頁不共用檔案」不成立：實際共用 `admin/src/api/labels.ts`（kind 中文與測試信操作紀錄中文）與 `backend/app/workers/maintenance.py`（`started_at` 與「提醒」步驟）。
- 與規格的差異（計畫裁定）：
  - P6：排入是新函式 `reminders.enqueue_due_parent_reminders(db, now)`，與員工提醒共用私有的到點判斷 `_due_upcoming`，在維護排程「提醒」步驟內依序呼叫（`enqueue_due_reminders` 的回傳不變，仍是員工則數）；`CycleResult` 多 `parent_reminders_enqueued`，CLI `process-notifications` 多印一行。規格 §3.1 寫的是在 `enqueue_due_reminders` 同一次掃描裡再寫一筆，計數分開記。
  - P7：kind 常數 `PARENT_VISIT_REMINDER` 放 `booking/outbox.py`（和其他家長信一起，加進 `PARENT_KINDS`、`enqueue_parent_email` 不接受），不放 `reminders.py`；`REMINDER_KINDS` 不變。
  - P8：實作順序先做寄送端（kind、信件內容、寄送判斷），再做排入端，每個 commit 都可運作。
- 與規格的差異（實作中的控制者裁定）：
  - **outbox payload 是 `{campus_key, receipt_id, slot_id}`**，和其他家長信、員工提醒一致（`_dispatch_parent_email` 讀 `receipt_id`），不是 §3.1 寫的 `{visit_request_id, slot_id}`；去重鍵照 R5。
  - P-7：家長提醒排入放在「提醒」步驟內**另一個 try 與 session**，員工提醒先 commit；家長段失敗只把 `reminders` 記進失敗步驟，不回滾已寫好的員工提醒、員工計數照實；不新增步驟名。
  - P-6：R7 的期限判斷用 `booking.parent_policy.parent_change_open`／`parent_change_deadline`（以該校 `change_deadline_hours` 計），不自寫比較。
  - P-4：提醒信內文比 §3.2 範例多「校區：〇〇校」「日期與場次：…（起迄時間）」兩行（沿用家長信共用的內文組法，有參觀人數時另列一行）；沒有電話時改寫「要改期或取消，請來電洽詢」。
  - 規格沒寫：沒設寄信時排入照常發生（排進佇列），寄送當下 skipped；「明天／今天」只認這兩種日數，其他日數不寫字（主旨與內文省略）；家長提醒不走員工提醒的 `still_applies`（kind 不在 `REMINDER_KINDS`），寄出前判斷全在 `_dispatch_parent_email`。
- 已知限制：改期後又改回原本那一場，該場的去重鍵 `parent_visit_reminder:{案件 id}:{場次 id}` 已用過，不會再寄第二次提醒。
- 已知限制：提醒到點時那天若已是停課日，提醒照樣排入（`_due_upcoming` 不看停課）、寄送時 `day_closed` 判斷後標成 skipped（停課另有停課信），去重鍵已經用掉；園方之後（在開始前 24 小時內）取消停課，家長不會再收到這場的提醒。
