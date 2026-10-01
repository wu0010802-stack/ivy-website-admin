# 官網招生分析擴充：預約與流量（需求與交接）

| 項目 | 內容 |
|---|---|
| 日期 | 2026-09-30 初版；2026-10-01 依線上現況更新 |
| 狀態 | 需求規格，**尚未實作** |
| 基準 | `origin/main` `b216133`，同時也是線上部署版本 |
| 範圍 | `/admin/analytics` 的預約與流量分析：階段 1（整理既有資料）、階段 3（UTM 與表單成效） |
| 不在範圍 | 入學結果、名額、流失原因（原階段 2），已改由 [`docs/specs/2026-09-30-website-admissions-design.md`](../specs/2026-09-30-website-admissions-design.md)（草案待審）處理 |
| 對象 | 業主、招生管理者、接手實作的 Claude |
| 交接提示 | [給 Claude 的實作任務](../handoff/2026-09-30-claude-enrollment-analytics.md) |

## 摘要

**10-01 有四件事改變了這份需求：**

1. **原階段 2 由入學規格取代。** 業主在 09-30 裁定照抄園務系統的招生模型（參觀 → 預繳 → 註冊），放在新的「招生入學」頁。本報告不再設計入學結果與招生目標。
2. **家長自選場次上線。** 送單即預約成功（`confirmed`），系統同時寫入 `request_created` 與 `visit_confirmed` 兩個事件。結果是官網的「確認率」由程式結構決定、恆為 100%，而且「待聯絡」這個階段已經不存在。
3. **內頁從 09-30 下午起也回報瀏覽。** 但後台流量面板的說明還寫著「尚未計入」。
4. **線上只有義華開放線上預約。** 明華、崇德、國際、仁武都顯示「線上預約即將開放，歡迎來電洽詢」，所以目前的官網預約數字只代表義華。

**階段 1 新增兩項必修：** 確認率的切換處理、流量說明的更正。原本的「待聯絡」改成三種有明確來源的「待處理」（第 3.4 節）。

## 1. 這份報告要回答的問題

| 問題 | 回答的地方 |
|---|---|
| 五校的官網預約量、取消、到場與未到，彼此差多少？ | 本報告階段 1（`/admin/analytics`） |
| 哪些預約還要人處理：時間已過但沒標到場、追蹤到期、舊案？ | 本報告階段 1 |
| 預約孩子的年齡／班別分布，對得上各校的招收年級嗎？ | 本報告階段 1 |
| 流量趨勢如何？哪些來源、活動帶來預約？表單完成率是多少？ | 本報告階段 3 |
| 哪一校、哪個年級還有招生缺口？預繳、註冊、流失原因？ | 入學規格（招生入學頁） |

這一版**不做**：AI 意願評分、錄取建議、招生預測、收入或投資報酬推算，也不自動判定孩子的入學資格。

## 2. 現況（`b216133`）

### 2.1 預約資料模型（家長自選場次之後）

**狀態**

- 資料庫保留全部 7 種狀態：`new`、`contacting`、`pending_confirmation`、`confirmed`、`cancelled`、`no_show`、`completed`（`backend/app/booking/models.py:22`）。
- 官網新送的單直接是 `confirmed`。系統不再產生 `contacting`、`pending_confirmation`；`POST …/contacting` 回 410。
- 後台列表分四組：待處理（只剩上線前的舊案）、預約正常、時間已過、已取消（`backend/app/booking/status_groups.py`）。
- 取消時記原因 `cancel_reason`：家長取消、園方取消、保留逾時（`models.py:110,174`）。

**仍保留的欄位**

| 欄位 | 位置 |
|---|---|
| 追蹤時間 `follow_up_at` | `models.py:180` |
| 聯絡紀錄 `VisitContactNote` | `models.py:299` |
| 承辦人 | `models.py:167` |
| 案件來源 `source`（web／phone／line／walk_in／external） | `models.py:155` |
| 家長複選的「從哪裡知道我們」`referral_sources` | `models.py:127` |

官網送單時 Email 與場次都是必填。

**各校預約方式**

只有預約方式設為 `slots` 的校區才會顯示表單（`web/app/utils/booking-action.ts:51-59`）。10-01 線上只有義華是這個設定。

### 2.2 分析頁現有功能

- **漏斗：** 已送出需求 → 已確認預約 → 已完成參觀 → 已取消（`admin/src/views/AnalyticsView.vue`）。
- **計算口徑：** 確認率與取消率只拿官網來源計算。事件依「發生日期」統計，所以同一期間裡可能混著不同時間建立的案件。
- **來源：** 有「案件來源」與「從哪裡知道我們」兩個切換維度。舊資料沒有記來源的，另列「未記錄」。
- **預約按鈕點擊：** 分成預約表單、LINE、電話、外部網站四種。
- **流量面板**（`admin/src/components/SiteTrafficPanel.vue`）：7／28／90 天的瀏覽次數、手機比例、各頁瀏覽、LCP／INP／CLS 與樣本數。API 已經提供每日資料，但畫面只用到最後一天（`:40`）。
- **後端：** 事件彙總在 `backend/app/operations/analytics_service.py`。`AnalyticsEvent` 沒有案件 id（`backend/app/operations/models.py:67`），所以不能拿它還原個別案件的流程。

**09-30 上午的線上觀察（歷史快照，不代表五校招生實績）**

- 近 28 天（09/03–09/30）共 226 次瀏覽。這是瀏覽次數，不是 226 位家長。
- 義華開站至今 1 筆需求，確認、完成、取消都是 0。
- 本次沒有開啟家長案件明細、沒有匯出，也沒有寫入正式資料。

### 2.3 要在階段 1 修正的兩個既有問題

1. **確認率失真。** 10-01 起，官網每筆新案件同時記「已送出需求」和「已確認預約」，所以確認率必然是 100%（`backend/app/booking/service.py:440-451`）。期間如果跨過 10-01，還會混到舊流程的人工確認。
2. **流量說明過時。** `SiteTrafficPanel.vue:81-82` 還寫著「目前只計算首頁、五校介紹頁與預約參觀頁；關於我們……還沒有計入」。實際上，`web/shared/telemetry.ts:2-8` 從 09-30 下午起已經回報 `about`、`curriculum`、`environment`、`admission`、`news`，後台也有這些頁名（`admin/src/api/traffic.ts:6-10`）。涵蓋範圍是在期間中途擴大的，所以前後的瀏覽量不能直接比。

### 2.4 不可誤用的既有欄位

1. **`VisitRequest.status=completed` 是「已到場」，不是入學。** 入學要看入學規格的預繳、註冊紀錄。
2. **參觀場次的 `capacity` 是可接待的家庭組數，不是班級名額。**
3. **`web/app/utils/admission-classes.ts:57-58` 的 `ClassStatus='enrolled'` 是依生日推算的「今年在幼兒園年齡」，不是報名結果。**

## 3. 指標口徑（實作與測試的共同依據）

### 3.1 計數單位

- 一律稱「預約案件數」，並明示不是不重複的家庭或孩子人數。
- 同一支電話可能是兄弟姊妹，**禁止只依電話自動合併**。
- 同一個孩子預約兩校，兩校各算一筆；跨校加總時標示「案件數」。
- 測試或重複的案件，可以人工標示後排除。標記時要留原因、操作者，以及稽核紀錄。

### 3.2 事件量與跨期比較

| 類型 | 用途 | 禁止的做法 |
|---|---|---|
| 事件趨勢 | 期間內發生的建立、取消、到場、未到次數，用來看工作量 | 拿本月到場數除以本月新預約，當成轉換率 |
| 案件現況 | 預約正常、時間已過、已取消的筆數，以及待處理清單 | 用預定日期已過，直接判定「已到場」 |
| 跨 10-01 的期間 | 標示流程切換，比率分成兩段顯示，或只顯示 10-01 之後 | 把新舊流程的確認率混在一起平均 |

10-01 之後，建議用**到場率、未到率、取消率（依原因）**取代確認率。每一種比率都同時顯示分子與分母。

### 3.3 比率與空值

- 分母為 0 時，比率回 `null`，畫面顯示「—／無可計算資料」。
- 分母小於 20 時，提示「樣本較少」。20 只是介面提示的門檻，不代表統計顯著。
- 缺來源、缺生日、班別超出範圍，都各自列為「未記錄」或「範圍外」，不要歸到 web、某校或某班。
- 查詢失敗時要顯示錯誤，不能偽裝成 0。

### 3.4 「待處理」的定義（取代「待聯絡」）

自選場次之後，已經沒有「等園方聯絡確認」這個階段。改列三種有明確來源的待處理：

| 種類 | 條件 | 依據 |
|---|---|---|
| 舊案待處理 | 狀態仍是 `new`、`contacting`、`pending_confirmation` | `status_groups.py` 的 pending 組 |
| 時間已過、未標到場 | `confirmed`，而且場次開始時間已過 | `status_groups.py` 的 past 組裡，扣掉已標到場或未到的案件 |
| 追蹤到期 | `follow_up_at` 不晚於現在，而且狀態不是 `cancelled`、`completed` | `backend/app/booking/routes.py:926-932`，與總覽同一個定義 |

- 「時間已過、未標到場」就是入學規格第 6.1 節的待辦來源。兩邊要共用同一個查詢，不能各寫一份。
- 原本規劃的「首次聯絡延遲」不再列為指標：新流程沒有聯絡確認這一步，聯絡紀錄改為選填的補充。

### 3.5 來源

| 種類 | 意思 | 注意 |
|---|---|---|
| 案件來源 | 家長怎麼進入案件系統：web、phone、line、walk_in、external | |
| 認知來源 | 家長自填怎麼知道園所，可以複選 | 不能相加當總數，也不做單一來源的百分比圓餅圖 |
| 活動來源 | 階段 3 的 UTM 標記 | 和上面兩種並存，彼此不覆寫 |

LINE 或電話的點擊只代表「想聯絡」，不能算成已聯絡、已預約或已入學。

## 4. 階段 1：整理既有預約與流量資料

**這一階段不新增資料表，也不寫 migration。**

| # | 項目 | `b216133` 現況 |
|---|---|---|
| 1 | 授權範圍內的五校並排比較，欄位為預約量、取消（依原因）、到場、未到、待處理三種 | 未實作：分析頁一次只能看一校 |
| 2 | 用 traffic API 的每日資料畫流量日趨勢；事件趨勢由後端補每日彙總 | 部分：API 有每日資料，畫面只用最後一天 |
| 3 | 依選定學年度，顯示預約孩子的生日對應班別分布 | 未實作 |
| 4 | 待處理三種的計數；有 `booking.read` 的人可以點進已套好篩選的案件清單，只有 `analytics.read` 的人只看去識別統計 | 部分：總覽有追蹤到期與 needs_attention，分析頁沒有 |
| 5 | 處理確認率失真（第 2.3 節第 1 點、第 3.2 節） | 已暫時處理並上線（`6b76f11`）：期間碰到 10/01 以後就不計官網確認率。到場率、未到率仍待做 |
| 6 | 更正流量涵蓋說明，並在趨勢上標出 09-30 的涵蓋擴大 | 說明已更正並上線（`6b76f11`）；趨勢上的標示仍待做 |
| 7 | 保留既有的日期、來源、取消、CTA 與速度分析 | 已有，不能倒退 |
| 8 | 每張圖都標明期間、計數單位、更新時間、資料涵蓋範圍 | 部分 |

**第 1 項的邊界：** 入學規格的「五校比較」（招生入學頁 `GET /compare`）比的是參觀、預繳、註冊。分析頁的五校比較只放預約與流量指標，兩邊不要重複做同一張表。如果業主希望合併成一處，要在實作前裁定。

**第 3 項的班別規則：** 重用 `admission-classes.ts`：8 月 1 日切換民國學年度、9/2～隔年 9/1 為同一屆（`:19-21`）。這是既有的產品規則，本次沒有核對法規，不能說成法定的入學資格。後端如果要做同樣的計算，前後端要共用同一組測試案例。

**交付：** 可操作的報表、權限與日期邊界的測試、桌機與手機的畫面驗證。驗收結果記在 `docs/website-admin/acceptance.md`，新增「招生分析階段 1」一節。

## 5. 階段 3：UTM 與表單成效

等階段 1 的資料穩定可用之後才做。這個階段要新增欄位，需要 migration。

**UTM 收集**

- [ ] 制定命名規則，收集 `utm_source`、`utm_medium`、`utm_campaign`、`utm_content`。採「本次瀏覽最後一組完整有效標記」，隨預約一起保存。畫面上要說明這是這個口徑，不是跨裝置的完整旅程歸因。
- [ ] 限制長度與字元，不保存完整 URL 或 query string，拒絕明顯的個資格式；沒有標記就顯示「未歸因」。站內換頁時，不要清掉記憶體裡已取得的標記。
- [ ] 維持目前的隱私邊界：不記 IP、不設追蹤 cookie、尊重 DNT 與 GPC。標記只放在本次頁面執行期間的記憶體裡；重新整理或開新分頁後找不回來，就標「未知」。
- [x] ~~補齊入學資訊等頁面的 page_view~~：已在 09-30 完成（見第 2.3 節第 2 點）。

**表單成效**

- [ ] 用只存在於這次表單記憶體裡的隨機 `form_attempt_id`，區分「開始」「送出失敗」「成功」。成功以後端建立案件或冪等回傳同一案件為準；重試不能算成多筆。
- [ ] 公開端只送必要的匿名 attempt 事件，不存表單文字、家長或孩子的識別資料、案件 id。DNT／GPC 開啟時，業務表單照常可以送出，只是不記分析事件。
- [ ] 表單完成率＝同一批開始的 attempt 中有成功的數量 ÷ 有效的開始 attempt。還沒建立這個關聯之前，只能顯示事件次數，不能宣稱放棄率。

**廣告費用**

- [ ] 用人工紀錄廣告費（校區 × 活動 × 費用期間）。五校共用的活動要明確分配，或另列「未分配」。
- [ ] 每筆預約、每位到場的成本分開標示。費用沒填和費用確定為 0 要分開；成果是 0 時不做除法。電話、LINE 只能用人工補登的來源，不能用點擊數倒推。

UTM 參考：[Google Analytics 網址標記說明](https://support.google.com/analytics/answer/10917952?hl=zh-Hant)。本報告不要求導入 GA4，也不建立任何付費服務。

## 6. 實作定位

### 6.1 既有入口

| 路徑 | 注意事項 |
|---|---|
| `admin/src/views/AnalyticsView.vue` | 保留既有分析；新增內容依責任拆成元件，不要全部塞回這個 view |
| `admin/src/components/SiteTrafficPanel.vue` | 日趨勢與涵蓋說明（第 2.3 節） |
| `admin/src/composables/usePermissions.ts`、`useCampusScope.ts` | 用 API 回傳的 effective_capabilities；切換校區時取消或忽略舊請求 |
| `backend/app/operations/routes.py`、`analytics_service.py`、`traffic_service.py` | 新報表不改既有 endpoint 的語意 |
| `backend/app/booking/status_groups.py`、`attention.py`、`backend/app/operations/dashboard_service.py` | 待處理三種定義的來源，要共用、不要另抄 |
| `backend/app/booking/models.py`、`service.py`、`workflow_service.py` | 案件、事件寫入、到場與歷程 |
| `backend/app/auth/permissions.py` | capability 與校區授權的唯一依據 |
| `web/app/utils/admission-classes.ts` | 班別與學年度換算 |
| `web/shared/telemetry.ts`、`web/app/plugins/telemetry.client.ts`、`web/app/utils/cta-analytics.ts` | 事件白名單與匿名格式；處理 DNT／GPC |
| `contracts/openapi.json`、`contracts/generated/website-api.d.ts` | 用既有指令產生，不要手改 |

### 6.2 API 與查詢

- 新的彙總放在 `backend/app/operations/` 下獨立的 service，路由沿用 `/api/website/v1/admin` 前綴。
- 回應至少要有：`as_of`、實際生效的篩選條件、計數單位、分子與分母、未知或被排除的筆數。型別要分得出 0、`null`、未設定。
- 日期採台北時間的半開區間：開始日 00:00（含）到結束日隔天 00:00（不含）。時間以 UTC 儲存。
- 在 SQL 裡聚合，避免逐校、逐案件的 N+1 查詢。用隔離的測試資料驗證，不在正式庫跑全表試驗。

### 6.3 權限與 migration

- `analytics.read` 可以看授權範圍內的去識別統計，但不代表可以讀個資、待處理名單或匯出。
- 各操作的權限：

  | 操作 | capability |
  |---|---|
  | 看案件明細 | `booking.read` |
  | 編輯 | `booking.handle` |
  | 匯出 | `booking.export` |

  能讀不等於能匯出。
- 沿用 `require_scope` 與 `campus_scope`（`permissions.py:85,118`）：capability 不符回 403，越權存取校區回 404。用 id 直接存取時也一樣。
- 階段 3 的 migration 要接在最新 main 的唯一 head 之後；如果有平行開發，先確認沒有多個 head。入學規格也會新增 migration，兩者都要從當下的 main head 接。正式環境的 migration、發布與資料回填不在本文件的授權範圍內。

## 7. 驗收矩陣

原本的 E09–E20（同批案件、入學結果、招生目標）隨階段 2 移到入學規格，那邊以 R 系列驗收。

| 編號 | 階段 | 案例 | 必須成立的結果 |
|---|---|---|---|
| E01 | 1 | 全區管理者與單校帳號查同一張報表 | 只回各自授權範圍；自己改 campus 或 id 也不能越權 |
| E02 | 1 | 只有 `analytics.read` 的內容角色 | 看得到去識別統計，看不到家長明細，也不能匯出 |
| E03 | 1 | 台北午夜、月底、跨年的邊界 | 每筆事件只算在正確的那一天，沒有重複或遺漏 |
| E04 | 1 | 每日資料中有空白日期 | 圖表正確呈現資料範圍；查詢失敗不能偽裝成 0 |
| E05 | 1 | 生日 9/1、9/2；學年度在 7/31、8/1 切換 | 後端與前端 helper 的結果一致 |
| E06 | 1 | 缺生日、舊的年齡文字、範圍外的生日 | 顯示「未記錄」或「範圍外」，不猜班別 |
| E07 | 1 | 快速切換校區與日期，回應順序顛倒 | 畫面只顯示最後一次的選取，沒有別校的殘留 |
| E08 | 1 | 舊案 pending、時間已過未標到場、追蹤到期、已到場、已取消 | 待處理三種的計數符合第 3.4 節；已到場與已取消不算 |
| E21 | 3 | UTM 缺值、過長、含個資；站內換頁 | 驗證安全；未知歸因標示清楚；不會被沒有標記的頁面清掉 |
| E22 | 3 | DNT／GPC 開啟、收集 API 失敗 | 不送分析事件，業務送單照常 |
| E23 | 3 | 表單失敗後重試、成功回應遺失後再送、跨日才成功 | 同一個 attempt 或冪等案件不重複計數，並回到開始的那一批 |
| E24 | 3 | 費用未知、費用為 0、五校共用活動、沒有成果 | 成本不重複分配；未知、0、無法計算三者分得清楚 |
| E25 | 全部 | 1440px 桌機、390px 手機、鍵盤操作 | 篩選、表格、空狀態都可用；表格可以受控橫捲，頁面不溢出 |
| E26 | 1 | 期間跨過 10-01，新舊流程的案件都有 | 不顯示混合的確認率；到場、未到、取消率附分子與分母 |
| E27 | 1 | 流量期間跨過 09-30 下午 | 涵蓋說明正確，並標出涵蓋擴大的時間點；不宣稱瀏覽量成長 |

測試一律用合成資料與隔離的資料庫。

## 8. 驗證指令

Node 用 `.nvmrc` 指定的 22；一次只跑一組測試，避免 8GB 記憶體不夠用。下列指令都已在 package.json 與 CI 中確認存在，但**本文件的工作沒有執行任何產品測試**。

```sh
npm --prefix admin run typecheck
npm --prefix admin run test:unit -- --maxWorkers=2
npm --prefix admin run build
npm --prefix web run typecheck
npm run test:website -- --maxWorkers=2
npm run contract:generate   # API 或 schema 有變更才需要；產生後要審查差異
npm run contract:check
cd backend && uv run --frozen pytest -q   # 先確認環境指向隔離的測試庫
```

**既有測試的位置**（`b216133` 都存在；案件相關測試在 10-01 改版時改寫過，以 main 現況為準）：

| 類別 | 檔案 |
|---|---|
| 統計 | `backend/tests/test_analytics_funnel.py`、`test_traffic.py`、`test_operations.py`；`admin/src/__tests__/analyticsFunnel.test.ts`、`traffic.test.ts` |
| 案件 | `backend/tests/test_visit_workflow.py`、`test_visit_case_handling.py`、`test_visit_manual_and_assign.py`、`test_visit_manual_workflow.py`、`test_visit_attention_export.py`、`test_booking_concurrency.py`；`admin/src/__tests__/workflowFeatures.test.ts` |
| 權限 | `backend/tests/test_auth_scope.py`、`test_permission_table.py`；`admin/src/__tests__/permissionsUx.test.ts`、`useCampusScope.test.ts` |
| 收集與班別 | `web/tests/cta-analytics.spec.ts`、`telemetry-plugin.spec.ts`、`telemetry.spec.ts`、`admission.spec.ts` |

## 9. 執行邊界

1. **開工先確認版本：** git status、HEAD、最新 `origin/main`、線上 `/release.json`。
2. **另開 worktree 實作：** 從 `origin/main` 開新的 worktree。磁碟空間小，用 sparse checkout。不要在落後的 `feature/website-admin` 工作樹上做，也不要整包搬它的未提交修改。
3. **依序執行：** 階段 1 → 3，一次 session 只做一個階段，每個階段都要有可驗收的成果。開工前先確認入學規格的審閱狀態；它也會動到後台導覽與權限表，兩邊要協調。
4. **不碰園務系統：** campus key 不是園務系統的 tenant_id。不連 `ivy-backend`、`ivy-frontend`、`ivyManageSystem` 的資料庫，也不引入 RLS 或租戶流程。
5. **限定修改範圍：** 只改 `web/`、`admin/`、`backend/`、`contracts/`，以及必要的文件與測試。不改已凍結的 vanilla 原型，不升級 FastAPI 0.136.1。
6. **需要另外取得同意的事：** commit、push、部署、執行正式 migration、寫入正式資料、發送通知。`main` 的 push 會觸發正式部署。
7. **回報內容：**
   - 完成範圍、指標定義、檔案位置
   - 實際跑過的驗證與結果、桌機與手機的證據、剩餘事項
   - 本機測試、commit、push、CI、migration、線上版本，各自分開說明

   沒驗證過的不能寫「通過」。

## 附錄：程式證據（`b216133`）

| 主題 | 位置 |
|---|---|
| 預約狀態 | `backend/app/booking/models.py:22`（7 種狀態）、`:97`（VisitRequest）、`:110,174`（取消原因）、`:127`（認知來源）、`:167`（承辦人）、`:180`（`follow_up_at`）、`:299`（聯絡紀錄） |
| 自選場次送單 | `backend/app/booking/service.py:440-451`（同時寫 `request_created` 與 `visit_confirmed`）；`backend/app/booking/status_groups.py`（後台四組） |
| 追蹤到期 | `backend/app/booking/routes.py:926-932`（排除 cancelled 與 completed，與總覽同一定義） |
| 到場 | `backend/app/booking/workflow_service.py:227-240`（`mark_completed` 寫入 `visit_completed`） |
| 統計事件 | `backend/app/operations/models.py:13-27`（事件種類）、`:67`（`AnalyticsEvent`，沒有案件 id） |
| 流量 | `admin/src/components/SiteTrafficPanel.vue:40`（只取最後一天）、`:81-82`（過時的涵蓋說明）；`web/shared/telemetry.ts:2-8`（頁型）；`admin/src/api/traffic.ts:6-10`（後台頁名） |
| 預約方式 | `web/app/utils/booking-action.ts:51-59`（只有 `slots` 才顯示表單） |
| 權限 | `backend/app/auth/permissions.py:38`（`analytics.read` 的角色）、`:43`（`booking.handle`）、`:85`（`campus_scope`）、`:118`（`require_scope`） |
| 班別 | `web/app/utils/admission-classes.ts:19-21`（學年度）、`:57-58`（`ClassStatus` 的語意） |
