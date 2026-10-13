# 參觀場次：場次使用情況（2026-10-13）設計

日期：2026-10-13
狀態：使用者 10-13 逐段核可設計（三段），待審規格
基準：`origin/main` `8c4ec20a`
分支：`feature/visit-slot-usage-20261013`（worktree `~/Repositories/ivy-website-wt/visit-slot-usage-20261013`）

## 1. 背景與目標

使用者 10-13 要「更多可以做招生判讀的資料，不限區域分析」，從候選裡選了四項，分四個子專案依序做（見 `~/.claude` 記憶 admissions-public-data-candidates-20261013；其餘三項是托嬰中心＋園所異動、商圈出生趨勢、預約全程漏斗＋退出時點，各自另開規格）。本規格是第一項，先做的理由：它要「從現在開始記」，晚做的每一天都是補不回來的資料。

現況（origin/main `8c4ec20a`）：

- 公開預約頁讀場次時，伺服器就把額滿的場次濾掉（`backend/app/booking/routes.py:810`），家長的月曆上「額滿的日子」和「沒開場次的日子」長得一樣；系統沒有任何地方記下「家長想約、卻約不到近期」。
- 總覽只算今天起 7 天的已約／可約（`backend/app/operations/dashboard_service.py`），沒有過去場次的填滿紀錄。

要回答的兩個問題：

1. 家長打開預約頁時，最早能約到哪天？有多少次是 7 天內已經約不到、甚至整段沒有場次？
2. 過去每個時段（星期 × 時間）坐了幾成？哪些常額滿、可以加開；哪些很少人約、可以收掉或縮短？

### 1.1 成功標準

1. 「參觀場次」頁多一個頁籤「場次使用情況」（`?tab=usage`），跟「接待月曆」共用校區選擇。
2. 「最早能約哪天」從上線起每天累積；「各時段坐了幾成」上線當天就有歷史（從現有資料回推）。
3. 判讀標籤「常額滿／很少人約／還不判斷」由後端依常數判斷，畫面只顯示。
4. 公開預約頁外觀與回傳內容不變；不存任何能辨識家長的資料。

### 1.2 實作裁定（2026-10-13，使用者核可）

| # | 事項 | 裁定 | 理由 |
|---|---|---|---|
| U1 | 「想約約不到」怎麼記 | **只在伺服器記**：新預約表單讀場次時，記「最早能約的日子離今天幾天」；**不改公開頁外觀** | 使用者選；最快上線。看不到家長想要哪一天（那要在月曆標「額滿」並記點擊，另案） |
| U2 | 放哪裡 | **參觀場次頁加頁籤**（接待月曆／場次使用情況） | 看完就能切回月曆改規則；櫃台與分校管理者都看得到 |
| U3 | 記錄的形式 | 每日彙總表 `slot_lookup_daily`（台北日期 × 校區 × 等待區間 → 次數），不存單次紀錄 | 比照 `page_view_daily`：不存 IP、裝置、cookie、時間點 |
| U4 | 等待區間 | 「明天以前」（0–1 天）、「2–3 天」、「4–7 天」、「超過 7 天」、「沒有場次」 | 7 天是「這週約不到」的直覺界線 |
| U5 | 計數單位 | 寫「次」不寫「位」 | 沒有可辨識的資料就不能去重；同一位家長重新整理或切校區算兩次 |
| U6 | 已約 | 排在該場次、狀態 confirmed／completed／no_show 的預約數（同接待月曆 `_CALENDAR_STATUSES`）；cancelled 不算 | 到場或沒來都佔了位子 |
| U7 | 哪些場次算 | 場次日期早於台北今天、`closed = false` | 關掉的場次（休假、手動關閉）不是家長不約 |
| U8 | 分組 | 實際場次的「星期 × 開始時間 × 結束時間」，不看規則 | 規則改過後新舊時段各成一列，不會混算 |
| U9 | 範圍 | 近 4／12／26 週，預設 12 | 一季看得出規律，半年看得出季節 |
| U10 | 判讀門檻 | 同一時段**不到 4 場**→「還不判斷」；額滿場次 **≥ 50%** →「常額滿」；填滿率 **≤ 20%** →「很少人約」；其餘不標 | 使用者核可的建議值；描述性門檻，不做統計檢定（場次數少，檢定沒有偵測力） |
| U11 | 「最早能約哪天」的範圍 | 固定近 4 週（含今天，28 個台北日） | 資料累積前不給切換；之後要再加 |

### 1.3 不做

- 月曆標「額滿」、點擊額滿日、候補通知（U1；候補會收聯絡方式，等於新的預約語意）。
- 未來場次的填滿（總覽已有本週已約／可約）。
- 「提前幾天就額滿」：改期（`visit_request_events` 的 rescheduled）會讓逐時佔位很難回推；「最早能約哪天」已反映同一件事。
- 預測、自動加開或關閉場次。
- 家長改期管理頁的讀場次不記（那是已預約的家長換時間，不是新需求）。

## 2. 記錄「最早能約哪天」

### 2.1 資料表

一支 migration（接在 `f3c8a2d47b19` 後面），只新增一張表，不改既有資料（不需部署前備份閘門）：

`slot_lookup_daily`

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | UUID PK | |
| `day` | Date NOT NULL | 台北日期 |
| `campus_key` | String(32) NOT NULL | 校區 key（同 `page_view_daily`，不設外鍵） |
| `bucket` | String(16) NOT NULL | `within_1`／`days_2_3`／`days_4_7`／`over_7`／`none`（CHECK 約束） |
| `lookups` | Integer NOT NULL | 次數 |

- 唯一約束 `(day, campus_key, bucket)`；寫入用 `INSERT … ON CONFLICT DO UPDATE SET lookups = lookups + 1`（同 `traffic_service.record_page_view`）。
- 降級：drop table。
- 不進園務轉移契約、不進保存期限清理（彙總、無個資，同瀏覽量長期保留）。

### 2.2 什麼時候記

公開端點 `GET /public/slots` 加一個可省略的查詢參數 `purpose`，只接受 `new_booking`（其他值 422）。**只在下列條件全部成立時記一次**：

1. 帶了 `purpose=new_booking`；
2. 校區存在且 active（停用的本來就回空清單，`routes.py:790`）；
3. 該校預約方式是 `slots`（其他方式家長看不到場次，記了會全部變成「沒有場次」）。

等待天數＝回傳清單裡最早一個場次的 `slot_date` − 台北今天（`today_local()`）；清單是空的記 `none`。名額本來就在這支端點算好（`routes.py:808`），不多查資料庫，只多一次累加寫入。

- `purpose` 只決定記不記，**不影響回傳內容**；沒帶的請求（含改期管理頁 `web/app/composables/useParentVisit.ts:105`、舊版快取的頁面）行為完全不變。
- 寫入失敗（含資料庫錯誤）只記 log，照常回傳場次；不能因為記錄失敗讓家長讀不到場次。實作時確認寫入與讀取的交易邊界，失敗時不能留下中止的交易。
- 端點原有的每來源限流不變；刻意灌次數的人會先被限流擋。

### 2.3 web

`web/app/components/VisitForm.vue` 的 `loadSlots()` 查詢多帶 `purpose: 'new_booking'`；`useParentVisit.ts` 不帶。同源代理照常轉送查詢字串。

## 3. 回推「各時段坐了幾成」

只讀 `visit_slots` 與 `visit_requests`，不改資料表：

- 場次：`campus_key` 相符、`slot_date` 在 `[台北今天 − 週數 × 7, 台北今天 − 1]`、`closed = false`。
- 每個場次的已約＝`slot_id` 是它、狀態在 `_CALENDAR_STATUSES` 的預約數；額滿＝已約 ≥ `capacity`。
- 依（星期, `start_time`, `end_time`）分組，每組：場次數、總名額（capacity 加總）、已約加總、填滿率（已約 ÷ 總名額，上限 100%）、額滿場次數。
- 判讀（U10）：場次數 < 4 →`too_few`；額滿場次數 ÷ 場次數 ≥ 0.5 →`often_full`；填滿率 ≤ 0.2 →`rarely_booked`；其餘 `normal`。門檻是後端常數，回應裡也帶出來給說明文字用。
- 排序：星期一到星期日，再依開始時間。

## 4. API

`GET /admin/visit-slot-usage?campus_key=<key>&weeks=<4|12|26>`

- 權限同接待月曆：`require_scope(current_user, "booking.read", campus_keys=[campus_key])`；`campus_key` 必填；`weeks` 只收 4／12／26，否則 422 `INVALID_WEEKS`。
- 只回數字，沒有個資，不寫操作紀錄。
- 回應：

```json
{
  "campus_key": "yihua",
  "booking_mode": "slots",
  "today": "2026-10-13",
  "lookups": {
    "date_from": "2026-09-16",
    "date_to": "2026-10-13",
    "first_recorded_day": null,
    "total": 0,
    "buckets": [{ "key": "within_1", "count": 0 }, { "key": "days_2_3", "count": 0 }, { "key": "days_4_7", "count": 0 }, { "key": "over_7", "count": 0 }, { "key": "none", "count": 0 }]
  },
  "slots": {
    "weeks": 12,
    "date_from": "2026-07-21",
    "date_to": "2026-10-12",
    "thresholds": { "min_slots": 4, "often_full_share": 0.5, "rarely_booked_rate": 0.2 },
    "rows": [
      { "weekday": 5, "start_time": "10:00", "end_time": "11:00", "slot_count": 12, "capacity_total": 36, "booked": 33, "fill_rate": 0.917, "full_count": 9, "signal": "often_full" }
    ]
  }
}
```

- `first_recorded_day`：這個校區最早有紀錄的那天（全期，不限 4 週）；沒有任何紀錄為 `null`，畫面據此區分「還沒開始累積」與「近 4 週沒有人打開」。
- `buckets` 固定五個、固定順序，沒有紀錄的寫 0。
- `weekday` 0＝星期一 … 6＝星期日（同 `visit_rules.weekday` 與 Python `date.weekday()`）。
- OpenAPI 與產生的型別照慣例更新，跑 `npm run contract:check`。

## 5. 畫面（admin）

### 5.1 頁籤

`admin/src/views/VisitCalendarView.vue` 頂端加 `el-tabs`：「接待月曆」（現有內容不動）／「場次使用情況」。頁籤寫進網址 `?tab=usage`（預設 calendar 時不帶），做法比照招生入學（`AdmissionsView.vue` 的 `setTab`）；校區選擇器在頁籤外、兩個頁籤共用，切校區兩邊都跟著換。只有切到「場次使用情況」才讀新 API。

### 5.2 場次使用情況（新元件）

由上到下：

1. **最早能約哪天（近 4 週）**
   - 一句總結：「近 4 週家長打開{校名}預約頁 N 次，其中 M 次 7 天內已經約不到，K 次整段沒有場次可選。」（M＝`over_7`＋`none`，K＝`none`；數字為 0 時照寫）。
   - 五個區間的次數，CSS 長條＋數字（DESIGN.md「不裝圖表套件」）。
2. **各時段坐了幾成**：上方 4／12／26 週切換；沿用 `admin/src/components/admissions/StatsDimensionTable.vue`（時段、場次數、總名額、已約、填滿率（長條）、額滿場次、判讀），可匯出 CSV（檔名 `場次使用情況-{校名}-近{N}週-{日期}.csv`），手機在框內橫捲。判讀欄文字：「常額滿，可以考慮加開」「很少人約，可以考慮收掉或縮短」「還不到 4 場，還不判斷」；`normal` 寫「—」。
   - 有任一列是「常額滿」時，表格下方一個連結「到接待月曆改規則」，切回第一個頁籤。
3. **怎麼算**：預設收合的說明（比照 `admin/src/components/analytics/AnalyticsExplainer.vue`），寫 U5、U6、U7、U10 的口徑。

文案直白、不寫製作過程；顏色、字級走 token。

### 5.3 邊界情況

| 情況 | 第 1 塊 | 第 2 塊 |
|---|---|---|
| 上線初期（`first_recorded_day` 為 null） | 「還沒有家長打開預約頁的紀錄。」 | 照常（回推） |
| 預約方式不是 slots、近 4 週也沒有紀錄 | 「目前的預約方式不是自選場次，家長看不到場次。」 | 範圍內有過去的場次就照常顯示，沒有就寫「近 N 週沒有開放的場次。」 |
| 範圍內沒有已過去的場次 | 照常 | 「近 N 週沒有開放的場次。」 |
| 讀取失敗 | 兩塊共用一次請求：整頁籤顯示錯誤＋「重新載入」，不影響接待月曆頁籤 | 同左 |

（兩塊來自同一支 API，所以失敗是一起失敗；第 3 段口頭設計說的「各自失敗」在同一支 API 下不成立，這裡更正為一起失敗、一起重試。）

## 6. 個資與相容

- 新表只有日期、校區、區間、次數；不存 IP、User-Agent、cookie、時間點、家長任何欄位。隱私權政策不需改。
- 公開端點回傳不變；`purpose` 可省略，舊版頁面照常運作（只是不記）。
- 不影響預約語意、idempotency、名額並發（只讀名額，不改送單流程）。

## 7. 驗證

- 後端 pytest（用獨立測試庫）：
  - 記錄：帶／不帶 `purpose`；五個區間的邊界（0、1、2、3、4、7、8 天，`none`）；不存在、停用、非 slots 的校區不記；寫入失敗時照常回傳場次且 session 可繼續用；`purpose` 其他值 422；同日同校同區間累加。
  - 回推：取消不算、completed／no_show 算；`closed` 跳過；今天與未來場次不算；台北日期邊界（UTC 前一天 16:00 之後）；分組含結束時間；填滿率上限 100%（capacity 被調低時）；`too_few`／`often_full`／`rarely_booked` 的邊界值（剛好 4 場、剛好 50%、剛好 20%）；排序。
  - API：校區權限（無權校區 403、沒有 `booking.read` 的角色 403）、`weeks` 422、`first_recorded_day`、`booking_mode`、`buckets` 固定五個。
- admin 單元測試：頁籤與網址同步（含直接開 `?tab=usage`、切校區保留頁籤）；只有切到頁籤才讀 API；總結句的數字；三種空狀態；錯誤與重新載入；CSV 匯出內容與檔名；「到接待月曆改規則」切回頁籤。
- web 單元測試：預約表單帶 `purpose: 'new_booking'`，改期管理頁不帶。
- stack e2e（新 spec）：打開義華預約頁 → 後台參觀場次 → 場次使用情況，總次數至少 1；公開請求一律帶自己的 XFF。推 main 前跑完整 stack 套件。
- typecheck（admin、web）、`npm run contract:check`、後端全套由主 session 背景跑；畫面 390／1280／1440 不溢出、axe 0。

## 8. 文件與部署

- README 頂部日期段；DESIGN.md 新增「參觀場次：場次使用情況」（U1–U11、只存彙總、不改公開頁）。
- 一支只新增表的 migration；部署後在 `deploy/README.md` 補紀錄。未經使用者要求不 push main。
