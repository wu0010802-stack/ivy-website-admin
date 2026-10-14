# 托嬰中心與園所異動（2026-10-14）設計

日期：2026-10-14
狀態：設計經使用者 10-14 逐段核可（範圍、異動種類、資料與同步、讀取與計算、後台畫面、測試與部署六項）；本規格待使用者核可後才寫實作計畫
基準：`origin/main` `abc994c`
分支：`feature/provider-changes-20261014`
上游：招生判讀四個子專案的第二個（①場次使用情況已上線 `fbed245a`；③商圈出生趨勢、④預約全程漏斗另開）

## 1. 背景與目標

區域分析目前看得到「家長從哪裡來」「附近有哪些幼兒園」「哪些里孩子多、來參觀的少」。還缺兩件事：

- **上游**：本校附近有哪些托嬰中心、實際收托多少孩子。孩子 2 歲前在外面托育，是幼幼班最自然的來源之一，也是可以主動拜訪、放傳單的對象。
- **變化**：附近有沒有新設的競爭園所，或有園所停辦（那一帶的家長會重新找學校）。現在的幼兒園同步每次整批覆蓋、停辦的直接丟掉，完全看不到。

### 1.1 成功標準

1. 招生入學 → 統計分析 → 區域分析的「附近幼兒園」卡片可以切到「托嬰中心」，列出半徑內的托嬰中心與公共托育家園（核定、實際收托、距離），地圖可顯示它們。
2. 卡片下方有「附近園所的變化」：近 12 個月半徑內的新設、停辦、類型變動，幼兒園與托嬰都涵蓋。
3. 托嬰名單與園所變化每 7 天自動更新（`WEBSITE_GEO_AUTO_SYNC` 開著時），正式站連不到來源時有 CLI 檔案匯入的退路。
4. 預設狀態的畫面不變；沒有任何異動時明確寫沒有，不顯示假的空白。
5. 家長資料不送任何外部服務；新端點只讀公開園所資料。

### 1.2 實作裁定（2026-10-14，使用者已核可的標 ✔，其餘為預設值，業主可改）

| # | 事項 | 裁定 | 理由 |
|---|---|---|---|
| P1 ✔ | 範圍 | 托嬰名單＋異動提醒；異動只有三種：**新設或重新營業**、**停辦**、**類型變動**（私立⇄準公共等，只有幼兒園） | 使用者 10-14 選定。核定人數變動與月費估算變動不列 |
| P2 | 月費估算異動不列 | 不做 | 月費是 kiang 依收費明細推算的估計值，一年只有 6 所變、跨幅超過 1 萬元，多半是估算法改變，不是園所真的調價 |
| P3 | 新設的判斷 | 幼兒園＝**設立日**（來源 `reg_date`）在近 12 個月內且營業中，**不靠事件、上線後第一輪同步就有**；托嬰沒有設立日，改成「基準日之後第一次出現」，寫一筆 `opened` 事件 | 實測一年前後比對：幼兒園新出現 17 所，其中不少設立日是 2021 年（來源晚收錄的公立附設等），對家長不是新園，不能當新設 |
| P4 | 重新營業 | 先前停辦（`is_active` 假）又出現在名單裡 → 寫 `opened` 事件（幼兒園、托嬰皆然）。例外見 P6 | 使用者一併選了「新設或重新營業」 |
| P5 | 停辦的判斷 | 上次營業中、這次名單沒有或不營業 → 寫 `closed` 事件，日期是我們同步到的那天（台北） | 來源沒有停辦日 |
| P6 | 短暫消失不算停辦 | 重新營業時，若同一所 30 天內有 `closed` 事件，就**刪掉那筆停辦事件、不寫 `opened`** | 來源偶爾漏收一兩所；漏收又補回來不該在畫面留下一筆停辦 |
| P7 | 類型變動 | 只比幼兒園的 `kind`。**舊的類型用這次同步當下的學年重算**（由資料表裡的舊列：公立、非營利不變；私立或準公共視為「私立」，用舊列的準公共期間重算），再和新列的 `kind` 比；不同才寫 `kind_changed`（`old_value`、`new_value` 存類型）。**護欄（2026-10-14 實作時補，業主尚未看過）**：舊列與新列都是私立基底、而且兩邊都有準公共期間字串時，視為續約或換期間，不算類型變動；加入（舊列沒有期間）、退出（新期間為空）、公立／非營利／私立之間的基底改變照算 | 準公共的期間是學年區間，8 月學年更替時沒改過資料的園所類型會自己變，直接比會一次冒出一批假異動。護欄的理由：真實資料裡高雄 735 所有 268 所的期間是「113-115」，約 116 學年續約換成新期間時，沒有護欄會一次對這整批寫出誤導的類型變動（來源學年更替後才改期間＝寫私立→準公共，但這些學校去年就是準公共；8 月前先公布＝寫準公共→私立，完全是假的）。取捨：期間有→換成另一個有的學校永遠不會被標記，包含「斷了幾年後又加入」與「提前退出、來源把期間改短」兩種真實異動，單看一次同步分不出它們和續約的差別 |
| P8 | 基準日 | `geo_dataset_status.baseline_on`：第一次用新程式成功同步的台北日期。表裡原本沒有列（托嬰第一次）時不寫任何事件，只建立基準；原本有列（幼兒園）照常比對 | 沒有「上一次」就比不出停辦，畫面寫「從 N 月 N 日起記錄」 |
| P9 | 殘缺檔不換版 | 上次營業中的數量 ≥ **20** 時，新檔營業中的數量少於上次的 **80%** 就不換版、保留舊資料、寫 `last_error`；`geo-sync --force` 可略過 | 壞下載或來源改版不能讓所有園所一夜之間變成「停辦」（同人口「至少 850 里」的做法） |
| P10 | 同步頻率 | 幼兒園、托嬰各自每 **7 天**看一次來源（`PROVIDER_REFRESH_AFTER`）；門牌、人口維持 30 天。基準日（`baseline_on`）還是空的（還沒用新程式同步過）也視為到期，所以上線後第一輪背景同步就補上設立日 | 兩個檔案只有約 10 MB 與 1.4 MB；30 天一次的話停辦日期最多晚一個月。背景迴圈本來就是每天看一次 |
| P11 | 視窗 | 畫面與 API 固定看**近 12 個月**（今天往前推 12 個月，含當天起算；2/29 取 2/28）；事件資料保留 24 個月，每次該資料同步成功後清掉更舊的 | 一年各 0～1 件，12 個月才有東西可看；保留 24 個月留給之後想看更久 |
| P12 | 半徑 | 沿用 1／3／6 公里，與「附近幼兒園」共用同一個選擇 | 同現有；不另造半徑 |
| P13 | 托嬰類型 | 名稱含「家園」＝公共托育家園（`home`），其餘＝托嬰中心（`center`）。實測高雄 138 中心、13 家園 | 來源沒有類型欄位 |
| P14 | 資源上限 | 沿用 2026-10-13 深度掃描的做法：托嬰下載上限 **8 MB**（正常 1.4 MB，`BABYCARE_MAX_BYTES`，解壓後計）、時間上限 **5 分鐘**（`BABYCARE_TIME_BUDGET`）；來源網址設定 `geo_babycare_url` 只收 https | 與幼兒園 64 MB／10 分鐘同一套，只擋失控的來源 |

### 1.3 不做

- **核定人數變動、月費估算變動**：P1、P2。
- **托嬰分配到「里」、加進招生機會的里表**：家長常在上班地點附近送托，托嬰中心所在的里不等於孩子住的里，放進里表會誤導。
- **托嬰收托 ÷ 0–1 歲人口等比例**：和已否決的飽和度同一類，核定與實際收托的定義又沒有官方說明，容易誤導。畫面只放數量。
- **收托人數趨勢**：一年內 138 所中 78 所的數字有變，是日常波動，前幾個月看不出趨勢；要做另開。
- **預測**（例如「這些孩子明年進幼幼班」）：已否決。
- **點「變化」列讓地圖定位、清單匯出 CSV、公開官網顯示**：這一版不做。停辦的園所本來就不在地圖上。
- **用 git 歷史回補更早的異動**：實測一年前後比對，幼兒園 0 所停辦，回補沒有資訊量；GitHub 檔案要走 API 且常連不上。

## 2. 資料來源

| 項目 | 內容 |
|---|---|
| 托嬰名單 | kiang 整理的全國托嬰中心與公共托育家園，`https://kiang.github.io/ncwisweb.sfaa.gov.tw/babycare.json`（GeoJSON FeatureCollection，全國 2,074 筆、約 1.4 MB）。來源網站為衛生福利部社會及家庭署（`sfaa.gov.tw`）。GitHub Actions 每天自動更新 |
| 托嬰欄位 | `properties`：`id`（如 `CW10112243`）、`name`、`city`、`address`、`phone`、`capacity`（核定）、`status`（實際收托）、`is_active`（布林）；`geometry`：Point（經度、緯度，浮點數）。**沒有設立日、類型、月費** |
| 高雄實測（2026-10-14） | 160 筆、營業中 151、核定合計 6,449、實際收托合計 4,980（填滿率中位 92.5%）；地址一律以 3 位郵遞區號開頭，18 筆有重複的「高雄市…區…里」前綴；4 筆電話空白；`capacity`、`status` 都是整數 |
| 幼兒園名單 | 既有 `https://kiang.github.io/ap.ece.moe.edu.tw/preschools.json`（`config.geo_kindergartens_url`）。多用一個欄位：`reg_date`（設立日，`YYYY/MM/DD`；高雄營業中 735 所全都有） |
| 授權與標註 | 畫面註明「資料來源：衛生福利部社會及家庭署公開資料（kiang 整理）」；實際收托只寫「實際收托（官方資料）」，統計時點與定義官方沒有說明，不當成即時數字 |

實測：一年前（2025-10-13）與現在（2026-10-14）兩份快照比對，高雄全市：

| | 幼兒園 | 托嬰 |
|---|---|---|
| 營業中 | 718 → 735 | 142 → 151 |
| 新增 | 17 所（設立日在近 12 個月內 8 所、近 24 個月內 14 所） | 13 所 |
| 停辦 | 0 | 4 所 |
| 核定人數變 | 7 所 | 3 所 |
| 月費估算變 | 6 所 | — |
| 準公共期間變 | 6 所 | — |
| 實際收托數字變 | — | 78／138 所（日常波動） |

平均到單一校 3 公里內（約 20 所幼兒園、約 21 所托嬰），一年各只有 0～1 件新設或停辦。所以「附近園所的變化」多數時候是空的，這是資料的真實樣子，不是壞掉。

## 3. 資料模型

一支 migration（新 revision id，`down_revision` = `b4d7e1a92c58`）：

- **新表 `geo_babycare`**（公開資料、與校區無關、官網專用、不進園務轉移契約）：

  | 欄位 | 型別 | 說明 |
  |---|---|---|
  | `source_id` | String(64) PK | 來源的 `id` |
  | `name` | String(120) NOT NULL | |
  | `kind` | String(8) NOT NULL | `center`／`home`（P13）；`ck_geo_babycare_kind` |
  | `address` | String(200) NOT NULL | 去掉開頭的郵遞區號；有兩個「高雄市」時取第二個起（整理成單一地址） |
  | `lat`、`lng` | Float NOT NULL | 來源座標，需在高雄市外框內（`in_kaohsiung`） |
  | `approved_capacity` | Integer NULL | 核定人數；超出 int4 或不是數字存 NULL |
  | `enrolled` | Integer NULL | 實際收托；同上 |
  | `phone` | String(40) NULL | 空白存 NULL |
  | `is_active` | Boolean NOT NULL default true | |
  | `synced_at` | DateTime(tz) NOT NULL | |

  索引 `ix_geo_babycare_lat_lng (lat, lng)`。不存負責人姓名（來源本來就沒有）。
- **新表 `geo_provider_events`**（異動紀錄）：

  | 欄位 | 型別 | 說明 |
  |---|---|---|
  | `id` | BigInteger Identity PK | |
  | `provider` | String(16) NOT NULL | `kindergarten`／`babycare`；`ck_geo_provider_events_provider` |
  | `source_id` | String(64) NOT NULL | 對應 `geo_kindergartens` 或 `geo_babycare` 的主鍵（兩張表所以不設外鍵；列一律不刪，只標停辦） |
  | `change` | String(16) NOT NULL | `opened`／`closed`／`kind_changed`；`ck_geo_provider_events_change` |
  | `occurred_on` | Date NOT NULL | 同步到的台北日期 |
  | `old_value`、`new_value` | String(16) NULL | `kind_changed` 才有，存幼兒園類型 |

  唯一約束 `uq_geo_provider_events_once (provider, source_id, change, occurred_on)`；索引 `ix_geo_provider_events_occurred_on (occurred_on)`。不存名稱與座標，讀的時候 join 對應的園所表（列不刪，所以不會斷）。
- **`geo_kindergartens` 加欄位** `registered_on` Date NULL（設立日；`reg_date` 不是 `YYYY/MM/DD` 或不是真的日期時存 NULL）。既有的 `is_active` 欄位從此真的會是假（停辦時）。
- **`geo_dataset_status`**：加欄位 `baseline_on` Date NULL；`DATASETS` 多收 `babycare`，`ck_geo_dataset_status_dataset` drop 再 create，條件字串與 `models.py` 逐字相同（`tests/test_geo_schema.py` 檢查）。
- 不改既有資料。降級：刪兩張新表、拿掉兩個新欄位、刪 `babycare` 狀態列、約束改回。
- **凡讀 `geo_kindergartens` 的地方一律只讀 `is_active` 為真的**。2026-10-14 grep 過，讀這張表的只有 `kindergartens.nearby()`（已有此條件，`area.py` 透過它讀）；寫入的只有 `replace_kindergartens`（本規格由 `apply_changes` 取代）。新增的讀取（設立日新設）同樣要帶此條件。

## 4. 同步

併進既有的 `run_geo_sync`，成為第四種資料，各自成敗、各自的時間上限；幼兒園與托嬰共用同一組比對邏輯（`app/admissions/geo/providers.py`，新檔）。

- **背景與頻率**：同門牌、幼兒園，`WEBSITE_ADMISSIONS_ENABLED` 與 `WEBSITE_GEO_AUTO_SYNC` 都開才跑，背景迴圈本來每天看一次。`_due` 多一個間隔參數：幼兒園、托嬰 `PROVIDER_REFRESH_AFTER = 7 天`，門牌、人口維持 `REFRESH_AFTER = 30 天`。`baseline_on` 還是空的（含狀態列不存在）也算到期（P10）：既有幼兒園資料在上線後第一輪就補上設立日，不必等 7 天。托嬰資料表空時立刻抓。
- **下載**：`_fetch_capped(client, settings.geo_babycare_url, max_bytes=BABYCARE_MAX_BYTES)`，解析 JSON 與篩選丟執行緒（同幼兒園）。`parse_babycare`：只留 `city` 為高雄市（臺／台視為相同）的列；`is_active` 為真的才算營業中（不營業的整列不收，當作「名單沒有」）；缺必要欄位（`id`、`name`）、座標不是有限數或不在高雄市外框內、欄位超過資料表欄寬、`id` 重複，整筆略過並計入 `ParseReport.skipped`；一所營業中的都沒有丟 `BabycareFormatError`。
- **比對（`providers.apply_changes`）**：不再「刪光再寫」，改成依 `source_id` 比對現有列：
  1. 先檢查 P9 殘缺檔；不過就不換版（`last_error`：名單營業中的數量比上次少了兩成以上，疑似殘缺，未更新）。
  2. 現有營業中、新檔沒有 → `is_active` 設假、寫 `closed`。
  3. 新檔有、現有也有 → 更新所有欄位、`is_active` 設真；若現有是停辦（`is_active` 假）→ 重新營業：先找同一所 `occurred_on` 在 30 天內的 `closed` 事件，有就**刪掉它、不寫 `opened`**（P6），沒有才寫 `opened`。幼兒園再比類型（P7），不同寫 `kind_changed`。
  4. 新檔有、現有沒有 → 插入。托嬰且現有表原本有列 → 寫 `opened`；幼兒園不寫（新設看設立日，P3）；現有表原本是空的 → 什麼事件都不寫（基準，P8）。
  5. 事件用 `INSERT … ON CONFLICT DO NOTHING`（唯一約束），同一天重跑不會重複。
  6. 全部在同一個交易裡做完；成功後清掉 24 個月前的事件（P11），更新 `geo_dataset_status`（`active_version`、`label` 為同步日期，`baseline_on` 為空就設為今天，`last_error` 清掉）。
- **幼兒園解析**：`KindergartenRow` 多 `registered_on: date | None`，`parse_preschools` 解析 `reg_date`。`replace_kindergartens` 由 `apply_changes` 取代（函式與測試一併改，沒有別的呼叫端）。
- **CLI 退路**：`python -m app.cli geo-sync --babycare-file <JSON>`（與 `--kindergartens-file` 同樣：指定任一檔案就完全不連外；檔案匯入一樣過 P9，要略過加 `--force`）。`--help` 與說明文字同步更新。
- **時間與大小上限**：`BABYCARE_TIME_BUDGET = 5 分鐘`、`BABYCARE_MAX_BYTES = 8 MB`（P14）；`_within_budget` 包住。
- `last_error` 只記我們自己的訊息或例外類別，不含回應內容。`GeoSyncResult` 多 `babycare`、`babycare_rows_skipped`。

## 5. 計算（`app/admissions/geo/babycare.py` 與 `area.py`，只讀）

- **附近托嬰**：`babycare.nearby(db, lat, lng, radius_m)`，與 `kindergartens.nearby` 同樣的做法（經緯度方框先篩、再算大圓距離、取整公尺，依距離再依名稱排序），只讀 `is_active` 為真的。`summary`：營業中所數、核定合計、實際收托合計（`NULL` 不計入）。**不算任何比例**。
- **附近變化**：`area_service.query_changes(db, campus_key, radius_km)`：
  1. 事件：`geo_provider_events` 中 `occurred_on` 在視窗內，join 對應園所表取名稱、座標、類型，半徑內的。
  2. 設立日新設：`geo_kindergartens` 中 `is_active` 為真且 `registered_on` 在視窗內、半徑內的，轉成 `opened`，日期依據 `registered`。
  3. 同一所同一種異動只留一筆（`registered` 優先）。
  4. 依日期新到舊、距離近到遠、名稱排序。
  5. `tracking_since`：幼兒園、托嬰各自的 `baseline_on`。
- 本校沒座標：不算，回 `campus.locate_error`（同附近幼兒園）。

## 6. API

兩支新端點，招生開關底下；權限 `_require_campus(user, "admissions.read", campus_key)`；只讀、不寫稽核；`radius_km` 只收 1／3／6，其他值與非整數回 422 `INVALID_RADIUS`。

`GET /api/website/v1/admin/admissions/area/babycare?campus_key=&radius_km=3`，回應 `AreaBabycareOut`：

| 欄位 | 說明 |
|---|---|
| `campus`、`radius_km` | 同 `/area/kindergartens` |
| `synced_at` | 托嬰名單最近一次成功同步；從未匯入為 null（畫面寫「尚未匯入」，不顯示假的「附近沒有托嬰中心」） |
| `source_note` | 「資料來源：衛生福利部社會及家庭署公開資料（kiang 整理）」 |
| `summary` | `count`、`approved_total`、`enrolled_total` |
| `items[]` | `source_id`、`name`、`kind`（`center`／`home`）、`address`、`lat`、`lng`、`distance_m`、`approved_capacity`、`enrolled`、`phone`（後三者可為 null） |

`GET /api/website/v1/admin/admissions/area/changes?campus_key=&radius_km=3`，回應 `AreaChangesOut`：

| 欄位 | 說明 |
|---|---|
| `campus`、`radius_km` | 同上 |
| `window_months` | 固定 12 |
| `tracking_since` | `{ kindergarten: 日期 \| null, babycare: 日期 \| null }`，基準日；null＝還沒記錄過 |
| `items[]` | `provider`（`kindergarten`／`babycare`）、`source_id`、`name`、`kind`（幼兒園類型或托嬰 `center`／`home`）、`change`（`opened`／`closed`／`kind_changed`）、`date`、`date_basis`（`registered`＝設立日、`observed`＝我們同步到的日期）、`distance_m`、`old_kind`、`new_kind`（後兩者只有 `kind_changed`） |

`/admin/admissions/area` 的 `data_status` 另加 `babycare_synced_at`（給狀態列）。契約（`contracts/openapi.json`、`generated/website-api.d.ts`）重新產生。

## 7. 後台畫面

位置：招生入學 → 統計分析 → 區域分析。預設狀態的畫面不變（跟招生機會一樣，新東西要切過去才看得到）。

### 7.1 「附近幼兒園」卡片

- 頂端加一組切換（`el-radio-group`，`aria-label="名單種類"`）：**幼兒園**（預設）／**托嬰中心**。半徑（1／3／6 公里）兩邊共用，位置不變。
- 托嬰中心清單最上面一句：「3 公里內托嬰中心 21 所，核定 N 位，實際收托 M 位。」`NULL` 不計入。
- 每列：名稱、類型標籤（托嬰中心／托育家園）、距離・核定 N 人・實際收托 M 人。點一列展開地址與電話，同時請地圖移過去並開啟該園資訊（行為同幼兒園）；再點一次只收合。
- 狀態：讀取中（骨架）、讀取失敗（可重試）、本校沒座標（寫原因）、名單尚未匯入、半徑內沒有托嬰中心（「3 公里內沒有托嬰中心。」）。
- 來源小字：`source_note`・「N 月 N 日更新」。

### 7.2 地圖

- 圖例多一個「托嬰中心」勾選，**預設不勾**（維持現有畫面與視覺基準）。把卡片切到托嬰中心、或點托嬰清單的某一列，會自動打開這個圖層。
- 托嬰標點用**菱形**（`L.divIcon`），幼兒園維持圓點：不只靠顏色分辨。顏色用新 token `--area-kind-babycare`（避開幼兒園四色、本機構色、招生機會的玫瑰色 `--area-chance`；不寫 rgba／oklch 字面值）。
- 點標點的資訊框：名稱、類型、距離、核定、實際收托、電話。

### 7.3 「附近園所的變化」區塊（卡片正下方）

- 標題「附近園所的變化」，副標「近 12 個月・3 公里內」（跟半徑走）。
- 每列：年月、種類標籤（**新設**／**停辦**／**類型變動**）、幼兒園或托嬰標籤、名稱、距離；類型變動多寫「私立 → 準公共」。日期依據：設立日寫「設立日 2026/02」；同步到的日期寫「2026/10 起出現在名單」「2026/10 起不在名單」。這一版列不可點。
- 沒有任何異動：「近 12 個月，3 公里內沒有新設、停辦或類型變動的園所。」
- 底下小字：幼兒園或托嬰的基準日不到 12 個月前時寫「停辦與類型變動從 N 月 N 日起記錄；新設以設立日為準（托嬰從 N 月 N 日起記錄）。」；基準日都是空（還沒同步過）時寫「尚未開始記錄。」
- 狀態：讀取中、讀取失敗（可重試）、本校沒座標（寫原因）。讀取失敗不影響卡片、地圖與其他表。

### 7.4 狀態列與手機

- 頁首狀態列加一段「托嬰名單 10/14 更新」；從未匯入寫「托嬰名單尚未匯入」。
- 手機：切換鈕可換行、不撐出頁面；清單與新區塊沿用現有規則。
- 無障礙：菱形與圖例文字並列；切換與清單列的 `aria-*` 同幼兒園清單；新元件通過 axe。
- 視覺基準：`tests/stack/visual.spec.ts` 沒有涵蓋區域分析頁（2026-10-14 確認），不需更新截圖基準；畫面用 Playwright 截圖人工確認 1440／390。

## 8. 個資

- 家長地址與訪視資料完全不參與：兩支新端點只讀公開的園所資料與異動紀錄，回應沒有任何家長資訊。
- 托嬰電話與名稱是政府公開的營業資訊，畫面呈現方式同幼兒園清單；來源沒有負責人姓名，也不新增。
- 唯一新增的外部請求是同步工作下載 `babycare.json`，不帶任何家長資料。

## 9. 測試

- **後端（真 PostgreSQL）**
  - `parse_babycare`：座標與數字欄位為字串／缺值／超出 int4、非高雄、停業、缺必要欄位、`id` 重複、欄位超過欄寬、地址整理（郵遞區號、重複前綴）、中心與家園分類、一所營業中的都沒有。`parse_preschools` 的 `reg_date`：合格日期、格式錯誤、不存在的日期（2026/02/30）、空白。
  - `providers.apply_changes`：第一次（托嬰空表）不寫事件但建立基準；新設（托嬰）；停辦；重新營業；30 天內回來撤掉停辦事件且不寫 `opened`、超過 30 天回來寫 `opened`；類型變動；**學年更替本身不產生 `kind_changed`**、準公共期間真的改了才產生；殘缺檔保護（含 `--force` 略過、上次不足 20 所不檢查）；同一天重跑不重複；24 個月前的事件被清掉；`baseline_on` 只設一次。
  - 同步（`httpx.MockTransport`）：托嬰各自成敗（幼兒園失敗不影響托嬰）、`--babycare-file` 完全不連外、7 天頻率與基準日空白視為到期、超過大小／時間上限寫進狀態列並保留舊資料。CLI 參數。
  - 計算與 API：半徑篩選與排序、`summary`、`NULL` 不計入、尚未匯入、本校沒座標、權限與校區範圍、`INVALID_RADIUS`；`changes` 的 12 個月視窗邊界（第 12 個月前一天含／後一天不含）、設立日當天就出現的新設、日期依據、同一所同一種只留一筆、`tracking_since`、排序。
  - schema：新表與約束、`registered_on`／`baseline_on` 欄位、migration 單一 head、約束文字與 `models.py` 逐字相同。
- **後台 vitest**：切換與各狀態、托嬰清單文字與展開、圖層自動打開、異動區塊各種文字（三種異動、兩種日期依據、空狀態、基準日小字）、狀態列。
- **契約**：`npm run contract:generate`、`contract:check`。
- **stack e2e**：區域分析頁切到托嬰中心、勾圖層、異動區塊空狀態與文字、1440／390 不橫向溢出、axe 無違規。
- 照 CLAUDE.md：後端全套 pytest 由主 session 背景跑，不交給 subagent；機器只有 8GB，同時只跑一組。

## 10. 部署

- migration 只新增表、加欄位並放寬一個約束，不改既有資料，不需先備份。
- 正式站 `WEBSITE_GEO_AUTO_SYNC` 已開：部署後第一輪背景同步會補上幼兒園設立日、建立托嬰名單與基準日；來源同樣是 `kiang.github.io`，Railway 連得到。正式站連不到時走 `geo-sync --babycare-file`，步驟寫進 `deploy/README.md`「公開地理資料同步」。
- 回退：舊映像不認得新 revision，`check_schema.py` 會擋（見 CICD.md）；要退先用新映像跑 `alembic downgrade b4d7e1a92c58`（刪新表與新欄位、約束改回；已記的異動一併消失，下次同步重新建立基準）再切舊映像。
- 照 CLAUDE.md：不自行合併 main、不部署。

## 11. 文件回寫

README 頂部日期段落；DESIGN.md 招生章節新增「招生入學：托嬰中心與園所異動」，區域分析「不做」清單補托嬰收托比例、托嬰分配到里、收托趨勢；`deploy/README.md` 同步說明（頻率 7 天、托嬰、CLI）；托嬰資料來源寫在 `app/admissions/geo/babycare.py` 的檔頭說明與 DESIGN.md（`geo_data/README.md` 只講里界檔，不放這個）；`docs/specs/2026-10-08-admissions-area-design.md` 的延後項目加註「托嬰與園所異動 10-14 已做」。
