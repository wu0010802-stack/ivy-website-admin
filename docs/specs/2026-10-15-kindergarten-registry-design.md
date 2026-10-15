# 幼兒園營業中改以教育部名單判斷（2026-10-15）設計

日期：2026-10-15
狀態：設計經使用者 10-15 核可（資料來源與判斷、改名與換承辦、第一次同步的回補、畫面與數字、測試與上線五段；回補方式選「回補真實日期」）；本規格待使用者核可後才寫實作計畫
基準：`origin/main` `aae0debc`
分支：`fix/kindergarten-registry-20261015`
上游：修正 `docs/specs/2026-10-14-provider-changes-design.md`（托嬰中心與園所異動）的幼兒園停辦判斷

## 1. 背景與目標

使用者問區域分析「附近園所的變化」會不會出現最近停業的園所，並舉三民區的愛爾蘭、童年綠地。查證結果（2026-10-15）：

- kiang 的 `preschools.json` 仍把這兩所標 `is_active=1`，但教育部名單（同 repo 的 `docs/data/高雄市.csv`，由全國教保資訊網爬下）已經沒有它們：童年綠地 09-11 那版還在、09-15 那版不見；愛爾蘭 10-12 還在、10-13 不見。
- 原因在 kiang 的 `03_geocoding.php`：每天只對**當天名單有的**園所重寫 `docs/data/features/<uuid>.json` 並標 `is_active=1`；名單消失的園所舊檔不會被重寫，最後一步只把「沒有這個欄位」的設成 0。所以 `is_active` 一旦是 1 就永遠不會變回 0；高雄那 46 筆 0 只是欄位出現前就消失的舊檔。
- 後果：我們的 `parse_preschools` 只收 `is_active=1`，停辦的園所永遠算營業中——**幼兒園停辦事件永遠不會寫**（10-14 規格 §1.3「一年前後比對幼兒園 0 所停辦」也是這個原因）；「附近幼兒園」清單與核定人數含已停辦、已改名的舊筆。
- 規模（10-15 名單）：高雄 kiang 營業中 736 筆、教育部名單 689 列，教育部名單的 689 列全部對得到 kiang 的筆；kiang 多出 **47 筆**：14 筆改名或換承辦、33 筆停辦。用名單歷史（2025-06 起 187 版）二分搜尋出各筆離開名單的日期：近 12 個月停辦 **14 所**、改名 4 所；更早停辦 19 所、改名 10 所（其中 17 所停辦、8 所改名在 2025-06 前就消失）。

### 1.1 成功標準

1. 已不在教育部名單的幼兒園不再出現在「附近幼兒園」清單、地圖與任何用到營業中幼兒園的數字。
2. 近 12 個月停辦的 14 所出現在各自半徑內各校的「附近園所的變化」，日期是離開名單的月份（附錄 A）。
3. 改名、換承辦不算停辦，也不算新設。
4. 之後的停辦照每 7 天同步自動記錄，不再依賴 kiang 的 `is_active`。
5. 教育部名單抓不到或格式不對時不換版、保留舊資料，不讓幽靈園所「重新營業」。

### 1.2 實作裁定（2026-10-15，使用者已核可的標 ✔）

| # | 事項 | 裁定 | 理由 |
|---|---|---|---|
| R1 ✔ | 營業中的判斷 | kiang `preschools.json` 的園所，其（`reg_docno`、`title`）出現在教育部名單 CSV 才算營業中；**不再看 `is_active`** | 這組鍵就是 kiang 產生 uuid 用的（`id.csv` 的鍵是 `reg_docno . title`），10-15 名單 689 列全部對得上 |
| R2 ✔ | 名單來源 | 新設定 `geo_kindergartens_registry_url`（環境變數 `WEBSITE_GEO_KINDERGARTENS_REGISTRY_URL`），預設 `https://kiang.github.io/ap.ece.moe.edu.tw/data/%E9%AB%98%E9%9B%84%E5%B8%82.csv`，只收 `https://` | 與 JSON 同 repo、同一個每日 commit 更新；10-15 實測 GitHub Pages 回 200、`text/csv`、204,783 bytes |
| R3 ✔ | 名單抓不到 | 整輪幼兒園同步失敗、寫 `last_error`、保留舊資料；不退回用 `is_active` | 退回會讓已下架的幽靈園所被當成重新營業（寫 `opened`） |
| R4 ✔ | 改名與換承辦 | 某所要下架時，新名單裡若有**地址相同且設立日相同**的另一筆，視為同一所改名或換承辦：舊筆下架、**不寫停辦**；新筆設立日沿用舊的，本來就不會算新設 | 14 組改名或換承辦的設立日、地址都沒變；33 所停辦沒有一所符合。立案文號（`reg_docno`）也沒變，但公立國小附設幼兒園常共用批次文號（10-15 名單有 20 個文號被 2～18 所共用），單用文號會把新威、集來兩所國小附幼的停辦誤判成改名 |
| R5 ✔ | 回補 | 隨程式附上固定資料檔 `backend/app/admissions/geo_data/kindergarten-closures-20261015.csv`，列出 47 筆的處理方式；某筆要下架且在檔裡時，依檔決定寫不寫停辦、寫哪天（§5） | 使用者選「回補真實日期」。上線時即時查 GitHub 歷史不可行：Railway 上沒有 token，未驗證的 API 每小時 60 次，10-14 也實測過常連不上 |
| R6 ✔ | 範圍 | 只改幼兒園。托嬰不動 | 托嬰來源會把停辦的移除，10-14 比對的托嬰停辦 4 筆是真的 |
| R7 ✔ | 畫面 | 版面不變；只改「附近園所的變化」底下的小字（§6） | 幼兒園停辦有回補後涵蓋整個 12 個月，只剩類型變動是從基準日起記錄 |
| R8 | 下載上限 | 名單 CSV 上限 **4 MB**（`KINDERGARTEN_REGISTRY_MAX_BYTES`，正常約 200 KB）；與 JSON 共用既有 `KINDERGARTENS_TIME_BUDGET` 10 分鐘 | 沿用 2026-10-13 深度掃描的做法，只擋失控的來源 |
| R9 | 名稱 | 這份 CSV 在程式與文件裡叫 **registry**（教育部名單） | `enrolled-map-20261015` 分支已用 roster 指「幼生清冊」，避免混淆 |

### 1.3 不做

- **回報 kiang**：要不要回報由使用者決定，這次不做。
- **托嬰的同類檢查**：R6。
- **「改名／換承辦」顯示在變化列表**：只是不誤報停辦，不新增異動種類與標籤。
- **2025-06 前的歷史**：那些園所離開名單超過 16 個月，在 12 個月視窗外，不回推確切日期。
- **新的資料表欄位、migration**：改名判斷用既有的 `address`、`registered_on`；回補用固定檔。

## 2. 資料來源

| 項目 | 內容 |
|---|---|
| 教育部名單 | `kiang/ap.ece.moe.edu.tw` 的 `docs/data/高雄市.csv`（GitHub Pages：`/data/高雄市.csv`），kiang 的 `01_crawler.php` 每天從全國教保資訊網爬下、原樣寫成 CSV。UTF-8、有標頭，欄位 `reg_no,reg_docno,reg_date,title,owner,city,town,type,address,floor,size,size_in,size_out,tel,url,count_approved,shuttle,pre_public,is_free5,is_after,penalty,has_slip` |
| 只用兩欄 | `reg_docno`、`title`。`owner`（負責人姓名）不讀、不存（同 10-14 規格 §8） |
| 10-15 實測 | 689 列、`title` 不重複、`reg_docno` 無空值；（`reg_docno`、`title`）不重複；（`address`、`reg_date`）不重複 |
| 更新時間 | kiang 每天約 19:10（台北）commit，名單與 JSON 同一個 commit；名單沒變的日子沒有 commit |
| 既有 JSON | 照舊用 `preschools.json` 取座標、類型、準公共期間、核定、月費、設立日等；幽靈筆仍留在 JSON 裡（kiang 不刪 feature 檔） |

## 3. 同步改動（`app/admissions/geo/kindergartens.py`、`sync.py`、`config.py`、`cli.py`）

### 3.1 解析

- 新函式 `parse_registry(text) -> set[tuple[str, str]]`：讀 CSV（容許 BOM），回傳（`reg_docno`、`title`）集合，兩欄都去頭尾空白；空值的列略過。沒有標頭、缺這兩欄、一列都沒有 → `KindergartenFormatError`（訊息「教育部幼兒園名單格式不對」）。
- `parse_preschools(data, *, registry, school_year, report)`：多一個必填參數 `registry`。高雄市的 feature 只在（`reg_docno`、`title`）屬於 `registry` 時才收；`is_active` 不再檢查。其餘欄位處理照舊。
- 名單有、JSON 沒有對應 feature（kiang 還沒算座標）→ 不收，計入 `ParseReport.unplaced`（新欄位，只進同步摘要與日誌，不算 `skipped`）。

### 3.2 下載與失敗

- `sync_kindergartens` 先下載名單 CSV（`_fetch_capped`、4 MB），再下載 JSON。任何一個失敗都走既有的失敗路徑（記 `last_error`、回 `failed`），資料不動。
- 殘缺護欄 P9 照舊：新名單營業中的數量少於上次 80% 不換版。第一次用新程式同步時，正式站預估 735 → 689（約 94%），會過。

### 3.3 手動匯入

- `geo-sync` 新參數 `--kindergartens-registry-file <CSV>`。`--kindergartens-file` 與它**必須成對**；只給一個 → CLI 印錯誤、結束碼非 0，不跑任何同步。
- `run_geo_sync(..., kindergartens_registry_file=...)`、`geo_loop` 摘要與 CLI 輸出的選項字典都加 `kindergartens_registry_file`（`test_geo_loop`、`test_geo_babycare_sync` 有精確比對的地方要一起改）。

### 3.4 設定與環境

- `config.py`：`geo_kindergartens_registry_url` 與 https 驗證（比照 `geo_babycare_url`）。
- `tests/stack/start-api.sh` 的 `unset` 清單加 `WEBSITE_GEO_KINDERGARTENS_REGISTRY_URL`。
- `deploy/README.md` 兩處環境變數表各加一列（預設值、必須 https）。

## 4. 改名與換承辦（`app/admissions/geo/providers.py`）

- `_apply` 在「上次營業中、這次不在」的迴圈裡，多問一個可選的判斷函式 `retired_quietly(row) -> str | None`（只有幼兒園傳）：
  - 回 `"renamed"`：這次 `incoming` 裡有另一筆（`source_id` 不同）的 `address` 與 `registered_on` 都和此列相同（`registered_on` 為空不比）→ 下架、不寫事件。
  - 回 `"backfill"`：§5 的回補檔指定 → 依檔寫或不寫。
  - 回 `None`：照舊寫 `closed`，日期是同步當天。
- 判斷順序：回補檔優先，其次改名規則，最後一般停辦。
- `ChangeReport` 多兩個計數：`renamed`（改名下架）、`backfilled`（依回補檔寫的停辦）；同步日誌一起印。

## 5. 第一次同步的回補

### 5.1 檔案

`backend/app/admissions/geo_data/kindergarten-closures-20261015.csv`，UTF-8、有標頭：

| 欄位 | 內容 |
|---|---|
| `source_id` | kiang 的 uuid（＝`geo_kindergartens.source_id`） |
| `name` | 園所名稱（給人看，程式不用） |
| `left_on` | 離開教育部名單的日期（台北）：名單歷史裡**第一個不含這所的版本**的 commit 日期；2025-06 前就消失的留空 |
| `reason` | `closed`（停辦）或 `renamed`（改名或換承辦，依 R4 判斷） |

### 5.2 語意

- 只在該列**這一輪要從營業中變成下架**時查檔：
  - `closed` 且 `left_on` 有值 → 寫 `closed` 事件，`occurred_on = left_on`。
  - `closed` 且 `left_on` 空、或 `renamed` → 下架、不寫事件。
- 檔裡沒有的列照 §4 一般規則。
- 事件靠既有唯一約束冪等；24 個月保留規則照舊（檔裡最早的日期 2025-08-22，在保留期內）。畫面照舊只看近 12 個月，所以 2025-08、2025-09 的兩所寫進事件但不顯示。

### 5.3 產生方式

- 新腳本 `backend/scripts/build_kindergarten_closures.py`（開發用，比照 `build_school_districts.py`，不進執行期）：用 `gh api` 列出 `docs/data/高雄市.csv` 自 2025-06-01 起的 commit，取當前 JSON 營業中、但不在當前名單的高雄筆，逐筆二分搜尋離開日，依 R4 分類，寫出 §5.1 的 CSV。
- **實作當天重跑一次**再提交（名單每天會變）；10-15 的結果見附錄 A。
- 腳本產出與部署之間若又有園所離開名單，那些不在檔裡，上線後第一輪同步依一般規則記成同步當天，日期最多晚幾天。

## 6. 畫面（`admin/src/components/admissions/area/areaFormat.ts` 的 `trackingNote`）

版面、API 都不變。小字改成：

| 情況 | 現在 | 改成 |
|---|---|---|
| 兩邊都還沒同步 | 尚未開始記錄。 | 不變 |
| 兩邊都已記錄滿 12 個月 | （不顯示） | 不變 |
| 兩邊基準日相同、未滿 12 個月 | 停辦與類型變動從 X起記錄；新設以設立日為準（托嬰從 X起記錄）。 | 幼兒園的類型變動與托嬰從 X起記錄。 |
| 其他 | 幼兒園的停辦與類型變動從 X起記錄；托嬰從 Y起記錄；新設的幼兒園以設立日為準。 | 幼兒園的類型變動從 X起記錄；托嬰從 Y起記錄。 |
| 幼兒園還沒同步 | 幼兒園的停辦與類型變動尚未開始記錄；…；新設的幼兒園以設立日為準。 | 幼兒園的停辦與類型變動尚未開始記錄；…。（還沒同步就沒有回補，前半不變） |

（X、Y 照現有 `monthDay` 寫法「10 月 14 日」。未滿視窗的那一側才寫，已滿的省略，規則照舊。所有情況結尾都不再加「新設以設立日為準」：幼兒園的新設與停辦都涵蓋整個視窗，小字只講還沒涵蓋的部分。）

數字變動（上線後第一輪同步生效）：「附近幼兒園」清單、地圖、核定合計、招生機會等用到營業中幼兒園的地方，全高雄少 47 筆。各校半徑 1／3／6 公里內各少幾所，實作時用正式站 JSON＋名單離線算出並寫進驗證紀錄。

## 7. 測試

- **後端單元**（`test_geo_kindergartens.py`）：`parse_registry` 正常、BOM、缺欄位、空檔；`parse_preschools` 只收名單內的、`is_active=0` 但在名單內的照收、名單有但 JSON 沒有的計入 `unplaced`。
- **後端異動**（`test_geo_provider_changes.py` 或同等檔）：改名規則（同地址同設立日 → 不寫；同地址不同設立日 → 寫停辦；設立日為空 → 寫停辦）；回補三種（`closed`＋日期、`closed` 無日期、`renamed`）；回補檔沒有的照一般規則；回補不重複寫（跑兩輪）；回補日期比 30 天早的停辦，之後回到名單時寫 `opened`、不撤銷。
- **同步與 CLI**：名單下載失敗、名單格式不對 → `failed`、資料不動；`--kindergartens-file` 與 `--kindergartens-registry-file` 只給一個 → 報錯；選項字典精確比對的測試補新鍵；`tests/` 的幼兒園樣本 JSON 旁邊加一份樣本名單 CSV。
- **回補檔本身**：一個測試讀真檔，檢查欄位、`reason` 只有兩種值、`left_on` 是合法日期或空、`source_id` 不重複。
- **後台**（`areaFormat.test.ts`）：§6 每種情況的文案。
- **全套**：後端 pytest、admin vitest、typecheck；API 契約沒變，不跑契約產生（契約檢查要跑的話用不經 `uv run` 的指令，見 10-13 修正紀錄）。stack e2e 只在動到 `start-api.sh` 後跑區域分析相關 spec。

## 8. 部署與驗證

- 不新增 migration。要推 `main` 才部署，時間由使用者決定。
- 上線後，下一輪幼兒園同步自動套用（每 7 天；上一輪推測為 10-14，約 10-21，未查正式站確認）。要立刻生效：使用者以 `!` 執行 `geo-sync --force`（auto 模式擋 `railway ssh`）。
- 驗證：同步日誌的營業中數量（預期約 689）、`renamed`、`backfilled` 計數；義華「附近園所的變化」出現童年綠地（2026/09 起不在名單）與愛爾蘭（2026/10 起不在名單），前提是在所選半徑內。
- 部署後在 `deploy/README.md` 補紀錄。

## 9. 文件回寫

- `docs/specs/2026-10-14-provider-changes-design.md`：P5（停辦判斷）註明幼兒園改以教育部名單判斷、見本規格；§1.3「用 git 歷史回補更早的異動」那條註明 10-15 已推翻（理由：當時的 0 所是 `is_active` 不會翻 0 造成的）。
- `README.md` 頂部日期段落。
- `backend/app/admissions/geo_data/README.md`：說明回補檔與產生腳本。

## 10. 已知限制

- 回補檔裡的園所日後若回到名單、又再消失，會再套用檔裡的舊日期（極少見）。
- kiang 若哪天改掉 `is_active` 的行為或刪掉幽靈 feature 檔，本設計照常運作（只看名單）。
- 名單與 JSON 若在同一天不同步（例如新園所先進名單、座標晚一天），只會晚一輪出現，不會誤判停辦；反過來 JSON 有、名單暫時漏收的會被記停辦，30 天內回來就撤銷（既有 P6）。

## 附錄 A：近 12 個月停辦（10-15 結果，實作當天重算）

`left_on` 是名單歷史裡第一個不含該所的版本日期。

| left_on | 行政區 | 園所 | 地址 | 核定 |
|---|---|---|---|---|
| 2025-10-22 | 鼓山區 | 高雄市私立一二三幼兒園 | 南屏路542號1至2樓 | 60 |
| 2025-10-22 | 前鎮區 | 高雄市私立永祥幼兒園 | 瑞孝街77號、79號 | 170 |
| 2025-10-22 | 鳳山區 | 高雄市私立理幼幼兒園 | 八德路二段142巷9號 | 120 |
| 2025-10-22 | 大寮區 | 高雄市私立大寮恆青幼兒園 | 華德街6號 | 90 |
| 2026-01-30 | 小港區 | 高雄市私立文親幼兒園 | 桂江街151號1至2樓 | 34 |
| 2026-02-01 | 大寮區 | 高雄市私立新藝術幼兒園 | 興隆路277號 | 198 |
| 2026-02-05 | 大寮區 | 高雄市私立新創意幼兒園 | 三隆路101號 | 198 |
| 2026-03-25 | 三民區 | 高雄市私立聖愛幼兒園 | 建興路392號 | 90 |
| 2026-04-01 | 岡山區 | 高雄市私立小天才幼兒園 | 嘉華路225巷21弄11號1至3樓 | 30 |
| 2026-07-13 | 六龜區 | 高雄市六龜區新威國民小學附設幼兒園 | 新威212號 | 30 |
| 2026-07-17 | 六龜區 | 高雄市私立安倪幼兒園 | 中庄7號 | 58 |
| 2026-09-15 | 三民區 | 高雄市私立童年綠地幼兒園 | 堅如路46號 | 480 |
| 2026-10-08 | 岡山區 | 高雄市私立時代幼兒園 | 公園西路三段108、110號1至2樓 | 30 |
| 2026-10-13 | 鳥松區 | 高雄市私立愛爾蘭幼兒園 | 本館路3-13號 | 136 |

近 12 個月改名或換承辦 4 組（只下架舊名、不寫事件）：林園郵局職場互助教保服務中心（2025-12-18）、林園非營利幼兒園（2025-12-31）、喬美→榮美（2026-03-25）、巴楠花部落國民中小學附幼→實驗高級中學附幼（2026-09-24）。
