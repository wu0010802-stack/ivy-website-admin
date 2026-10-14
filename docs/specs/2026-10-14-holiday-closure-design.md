# 參觀場次：國定假日匯入、停班停課通知；操作紀錄搜尋、站內通知翻頁（2026-10-14）設計

日期：2026-10-14
狀態：使用者 10-14 從功能盤點裡選了這幾項（「先做這些」），本規格是實作依據
基準：`origin/main` `3a047c2`
分支：`feature/holiday-closure-20261014`

## 1. 背景與目標

使用者 10-14 從功能盤點選了兩件：

1. **國定假日匯入＋颱風停課一鍵處理**：休假只能在接待月曆一天一天設；系統沒有國定假日資料。關閉一天之後，已約的家長只會列進「待人工處理」，櫃台要一通一通打電話。
2. **操作紀錄依操作者篩選、改成伺服器端搜尋；站內通知超過 100 則可以翻頁**：操作紀錄的搜尋只比對已載入的那幾百筆（`admin/src/views/AuditView.vue:166`），站內通知只列最新 100 則（`backend/app/notifications/routes.py` `limit(100)`）。

### 1.1 成功標準

1. 接待月曆有「匯入國定假日」：從政府資料開放平台下載某一年的辦公日曆（連不到時上傳同一份 CSV），預覽後套用到選定的校區，國定假日與補假成為休假日。
2. 接待月曆有「停班停課」：選日期與校區，一次關閉當天所有場次；勾選後寄信給已約的家長，信裡附修改連結，家長自己改約或取消。
3. 停課日的預約，家長在修改期限過後仍可線上改約或取消（原本 24 小時內只能打電話）。
4. 操作紀錄可以選「操作者」，搜尋字由伺服器比對全部紀錄（不只已載入的），清單與匯出同一個條件。
5. 站內通知可以「載入更早的通知」；「未讀」頁籤由伺服器篩，頁籤數字是範圍內的真實總數。

## 2. 國定假日匯入

### 2.1 資料來源

政府資料開放平台資料集 14718「中華民國政府行政機關辦公日曆表」（人事行政總處），每年一份 CSV，通常 6 月公布隔年。欄位（2026-10-14 實測 114、115、116 年）：

| 欄位 | 內容 |
|---|---|
| `西元日期` | `20261010` |
| `星期` | `一`…`日`（不採用，星期由日期算） |
| `是否放假` | `2`＝放假、`0`＝上班 |
| `備註` | 節日名稱；一般週末是空白；`補假`、`補行上班` |

- 編碼不固定：115、116 年是 UTF-8 含 BOM，114 年更新版是 Big5（cp950）。先試 `utf-8-sig`，失敗再試 `cp950`。
- 同一年可能有更新版（例如「114年…(1141020更新)」）：自動下載時挑「更新」日期最新的那份。
- 「Google行事曆專用」那份欄位不同，不支援；上傳時回明確的錯誤訊息。

### 2.2 哪些日子算假日

- `是否放假 = 2` 而且（星期一到五，或 `備註` 有寫節日名稱）。一般週末（沒有備註）不列。
- 名稱用 `備註`，空白時寫「放假」。補假照樣列（備註就是「補假」）。
- 補行上班（週六上班）**不加開場次**：參觀場次照每週固定規則，不跟著行政機關上班。

### 2.3 套用規則（per 校區）

- 星期一到五的假日：一律建休假日，**不管這校目前有沒有每週規則**（四校還沒設場次，之後設了規則也不會在假日開出場次）。
- 週末的假日（例如國慶日剛好星期六）：只有這校每週規則有那一天才建。
- 早於台北今天的日期不建（`skipped_past`）。
- 那天已經是休假日：不動，原因維持園方寫的（`skipped_existing`）。
- 建立走既有的 `schedule_service.add_exception`（同一把設定列鎖、關閉當天已產生的場次），原因寫「中秋節（國定假日）」，接待月曆顯示「休假：中秋節（國定假日）」。
- 多校一次套用時依校區 key 排序取鎖，和停班停課同一個順序。
- 已約在這些日子的預約不自動取消（同既有休假規則），回應帶 `affected_requests`，畫面提示到那一天用「寄停課通知」或逐筆處理。
- 「取消休假」照舊一天一天在月曆上按。

### 2.4 API

- `POST /admin/holiday-calendar/fetch` `{year}`：伺服器向 data.gov.tw 取資料集清單，下載該年 CSV、解析後回預覽。`year` 只收今年與明年（西元）。
  - 只走 https（同 geo 同步的 `_require_https`），檔案上限 512 KB。
  - 連不到、逾時、非 200：`502 HOLIDAY_SOURCE_UNAVAILABLE`「連不到政府資料開放平台，請改用上傳檔案」。
  - 清單裡沒有那一年：`404 HOLIDAY_YEAR_NOT_PUBLISHED`。
- `POST /admin/holiday-calendar/parse`（multipart `file`）：解析上傳的 CSV，回同樣的預覽。上限 512 KB。格式不對：`422 HOLIDAY_CSV_INVALID`＋原因。
- 兩支都只解析、不寫資料，不寫操作紀錄（`test_audit_coverage` 豁免）；權限：`booking.manage`（任一校）。
- 預覽 `HolidayCalendarOut`：`source`（`open_data`／`upload`）、`source_label`（資料集上的檔名或上傳檔名）、`years`、`holidays[]`（`date`、`name`、`weekday` 0＝星期一）。
- `POST /admin/holiday-calendar/apply` `{campus_keys, holidays[{date, name}], dry_run}`：
  - `campus_keys` 1–5 個不重複、每一校都要 `booking.manage`（沒有權限的校區回 404，同其他 campus scope）。
  - `holidays` 1–80 筆、日期不重複；`name` 去頭尾空白 1–40 字、不收控制字元。
  - `dry_run=true` 只算數字不寫；`false` 才建休假日，每一校寫一筆操作紀錄 `visit_exception.import_holidays`（建立幾天、略過幾天、第一天與最後一天、受影響的預約數）。
  - 回應：`dry_run`、`skipped_past`、`campuses[]`（`campus_key`、`created`、`skipped_existing`、`skipped_weekend`、`affected_requests`、`affected_dates[]`）。

## 3. 停班停課

### 3.1 語意

- 「停班停課」＝把一天設成休假日（既有的 `visit_exceptions`），可以一次好幾校；原因（必填，例如「颱風停班停課」）**會寫進給家長的信**。
- 已約那天的預約**不自動取消**：家長收到信後自己改約或取消；沒有 Email、或正式站沒設寄信時，照舊列在「待人工處理」由櫃台聯絡。
- 「停課日」以**那一天有沒有休假日**判斷，不看單一場次的關閉來源：園方先手動「停止申請」、之後整天休假的場次（`closed_source` 仍是 `manual`），已約的家長一樣不能來。`needs_attention_condition` 跟著改成「場次那天是休假日、參觀日還沒過、已確認」，總覽與案件清單「待人工處理」同一批。

### 3.2 API

`POST /admin/visit-closures` `{closure_date, campus_keys, reason, notify_parents, dry_run}`

- `closure_date`：台北今天到 60 天內；`campus_keys` 規則同 2.4；`reason` 去頭尾空白 1–60 字、不收控制字元。
- `dry_run=true`：回每校要關的場次數、已約的預約數、有 Email 的、已經寄過停課通知的，不寫任何資料。
- `dry_run=false`：每一校（依 key 排序）`add_exception`（原本就是休假日則更新原因），再處理那天已確認的預約：
  - `notify_parents=true` 而且正式站有設寄信（`smtp_host`）：每筆有 Email 的預約排一封家長信 `parent_visit_day_closed`。`dedupe_key = day_closed:<預約 id>:<日期>`，同一筆同一天只寄一次（再按一次算 `already_notified`）。排信前 `ensure_access_token`，確保信裡放得進修改連結。案件歷程記 `closure_notice`（原因寫進 reason）。
  - 沒有 Email 的算 `no_email`，畫面請櫃台來電。
  - 每一校一筆操作紀錄 `visit_closure.create`（日期、原因、關閉場次數、已約數、寄出數、沒有 Email 數）。
- 回應：`dry_run`、`closure_date`、`parent_email_enabled`、`campuses[]`（`campus_key`、`already_closed`、`closed_slots`、`confirmed_requests`、`with_email`、`notified`、`already_notified`、`no_email`）。

### 3.3 家長信

- 種類 `parent_visit_day_closed`，標題「【常春藤○○】參觀日停課，請改約時間：10/16（四）上午場 09:30」。
- 內文：因「原因」，這天停課，原本的參觀無法進行；校區、日期場次、地址、電話；修改連結（「請開啟這個連結改約其他時間，或取消這次預約」），**不寫修改期限**（停課日不受期限限制，見 3.4）。
- 寄出當下再確認：案件仍是已確認、場次那天仍是休假日、場次還沒開始；不符合就標 skipped（家長已經改約、園方取消了停課）。
- 原因放在 outbox payload（不含家長個資）。

### 3.4 停課日不受線上修改期限限制

- `parent_policy.day_closed(db, visit_request)`：場次那天是休假日、而且還沒過（台北日期）。
- 是停課日時，家長管理頁的取消、改約、改資料都不檢查期限（`require_change_window` 與 `ParentVisitRequestOut` 共用）；其餘條件不變（已確認、分校啟用、預約方式是自選場次、每案每日次數）。
- `ParentVisitRequestOut` 多 `day_closed: bool`；為真時 `change_deadline` 回 `null`。官網管理頁顯示「園方這天停課，原本的參觀無法進行。請選擇新的時間，或取消這次預約。」，不顯示期限。

### 3.5 畫面（admin）

- 接待月曆頁首（有 `booking.manage`）：「停班停課」「匯入國定假日」兩顆按鈕。
- 停班停課對話框：日期（預設今天）、校區（可複選，預設目前看的這校；管多校的人可勾全部）、原因（必填，快速選「颱風停班停課」「臨時停課」）、「寄信請家長改約」（預設勾；沒設寄信時停用並說明）。按「確認」前先 dry run 列出每校的數字，送出後顯示結果與「沒有 Email、要來電的 N 組」連到待人工處理清單。
- 匯入國定假日對話框：選年份（今年／明年）→「從政府資料開放平台下載」或「上傳 CSV」→ 預覽假日清單（可取消勾選個別日子）→ 選校區 → dry run 數字 → 套用。
- 月曆的某一天是休假日、而且還有已確認的預約時，那天的面板多一顆「寄停課通知（N 組）」，開同一個對話框（日期、校區固定，原因帶休假原因）。

## 4. 操作紀錄：操作者篩選、伺服器端搜尋

- `GET /admin/audit-log` 新增：
  - `actor`：`system`（沒有操作者的紀錄）或帳號 UUID；其他值 422 `INVALID_ACTOR`。
  - `q`（可重複，最多 30 個、每個 1–100 字）：任一個詞符合就列出。比對（不分大小寫、`%`／`_` 照字面）：`action`、`target_type`、`target_id`、`campus_key`、操作者 Email 與顯示名稱、對象帳號的 Email 與顯示名稱（`target_type = user`）、`user_agent`、`metadata`（轉 jsonb 文字，中文照原字比對）；`ip_address` 只有 `audit.read_all` 的人比對（看不到 IP 的人不能用搜尋去猜）。
- `GET /admin/audit-log/actors?campus_key=`：這個範圍內出現過的操作者（含「系統」），最近操作的在前，最多 200 個；權限同列表。
- 後台把搜尋字轉成詞：原字＋各中文對照表（動作、對象類型、校區、角色、預約方式、內容種類、欄位名稱…）裡名稱含這個字的代碼，例如「休假」→`visit_exception.create`、`visit_exception.delete`…。清單與匯出都用伺服器篩過的結果，不再在前端二次過濾。
- 中文「細節」是前端由 metadata 組出來的；伺服器比對 metadata 原文與代碼，所以極少數只出現在組好的中文句子裡的字（例如裝置名稱「電腦」）搜不到，畫面上的提示寫「搜尋操作、操作者、校區、內容種類與細節裡的代碼」。

## 5. 站內通知翻頁

- `GET /admin/notifications` 新增 `before`＋`before_id`（游標，兩個一起帶，否則 422 `INVALID_CURSOR`）、`unread_only`、`limit`（1–200，預設 100）。排序改成 `created_at DESC, id DESC`（游標穩定）。回應仍是陣列，舊版後台照常可用。
- `GET /admin/notifications/counts?campus_key=`：範圍內的總則數、未讀數、各校未讀數。權限與範圍同列表。
- 後台：「未讀」頁籤改由伺服器篩；頁籤數字用 counts；清單底部「載入更早的通知」；拿掉「只列出最新 100 則」的提示。

## 6. 不做

- 自動偵測颱風停班停課（人事行政總處、高雄市政府的公告沒有穩定的機器可讀來源）；由園方按「停班停課」。
- 每年自動套用國定假日（不經人確認就關場次，園方可能某些假日照常開放）。
- 補行上班日加開場次。
- 停課時自動取消預約、簡訊或 LINE 通知家長（家長信仍只走 Email）。
- 「取消休假」一次取消好幾天。
- 操作紀錄依動作類型的下拉篩選（用搜尋字處理）。

## 7. 驗證

- 後端（真 PostgreSQL）：解析（兩種編碼、缺欄、Google 格式、週末假日）、下載（挑最新更新版、找不到年份、連線失敗）、套用（dry run 不寫、週一到五一律建、週末看規則、已有休假不動、過去日期略過、關閉既有場次、權限、操作紀錄）、停班停課（多校、寄信去重、沒有 Email、沒設寄信、家長過期限仍可改約與取消、寄出前已改約就略過、待人工處理含手動停止申請的場次）、操作紀錄（操作者、系統、搜尋詞、IP 只給總部、`%` 照字面、操作者清單範圍）、通知（游標、未讀、counts 範圍）。
- 前端：admin 搜尋詞展開、兩個對話框、通知翻頁的單元測試；web 管理頁停課提示；typecheck、`contract:check`；本機 stack 上用 Playwright 看桌機與手機。
