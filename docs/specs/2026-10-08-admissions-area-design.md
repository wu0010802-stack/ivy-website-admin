# 招生入學「區域分析」設計

日期：2026-10-08
狀態：已實作於分支 `feature/admissions-area-20261008`，**未部署**；2026-10-08 依實作結果與主控裁定回寫（實作裁定見 §17）
對象：業主、接手實作的 Claude
基準：`origin/main` `82937a9f`（招生入學已部署；依 `2026-10-05-visit-family-page-design.md` 記載正式站招生開關已開；migration head `c4e8a2f61b97`；本功能新增一支 migration `e7a1c4d9b2f6`。2026-10-12 合併時 origin/main 已多了後台清理的三支（`304dd12e96bc`→`e48a3ccedcd8`→`a9e11038c869`），本 migration 改接在 `a9e11038c869` 後面，head 仍是 `e7a1c4d9b2f6`）

前置文件：

- 招生入學：`docs/specs/2026-09-30-website-admissions-design.md`（以下稱「招生規格」）。
- 園務區域分析原始實作：`~/Desktop/ivy-frontend/src/components/recruitment/RecruitmentAreaTab.vue`、`RecruitmentAddressHeatmap.vue`、`RecruitmentNearbySchoolList.vue`；`~/Desktop/ivy-backend/services/recruitment_market_intelligence.py`、`api/recruitment/hotspots.py`、`market.py`。

## 1. 背景與目標

使用者 2026-10-08 要把園務系統「招生入學 → 統計分析 → 區域分析」搬進官網後台，但不搬全部功能。

招生規格 §3.2、§9.3 原本把區域分析列為「不做」（2026-09-30 裁定延後），本規格取代該裁定。

園務的區域分析由五塊組成：行政區統計卡、市場情報（人口／競爭園所／飽和度／機會判讀）、各校 3／6 km 競爭環、地圖熱點（家長地址送 Google／TGOS 定位、K-匿名街區格）、附近幼兒園側欄（Google Places＋教育部名冊）。官網只取其中一部分，並把資料來源全部換成公開資料、在本機比對。

### 1.1 成功標準

1. 招生人員在「統計分析 → 區域分析」看得到本校家長來源依行政區與里的分布、預繳率，以及距本校遠近的分布。
2. 地圖上看得到里界著色、本校位置與附近幼兒園，點里或表格列可以跳到該區域的訪視明細。
3. 家長地址不離開官網資料庫：比對與統計不呼叫任何外部服務；畫地圖只向底圖伺服器要圖磚（請求只帶視野範圍，不帶家長資料）。
4. 不需要任何付費 API key。

## 2. 已裁定事項（2026-10-08 使用者）

| # | 事項 | 裁定 |
|---|---|---|
| D1 | 範圍 | 做「里別來源統計＋里界地圖」核心、附近幼兒園清單、來源距離分布；**不做**市場資料與機會判讀（人口、飽和度）、各校 3／6 km 競爭環 |
| D2 | 定位精度 | 到「里」即可 |
| D3 | 同意勾選 | **不做**「地址分析同意」勾選（維持 2026-10-05「不上畫面」的裁定）；因此家長地址不得送第三方 |
| D4 | 園所資料來源 | 只用公開資料（教育部全國教保資訊網經 kiang 整理），不用 Google Places |
| D5 | 地圖 | Leaflet＋國土測繪中心電子地圖圖磚 |
| D6 | 設計三段 | 資料與比對、API 與畫面、個資／相容／部署／測試三段於對話中逐段核可 |

## 3. 範圍

### 3.1 本次要做

- 高雄市門牌、幼兒園、里界三種公開資料的匯入與每月更新。
- 訪視地址 → 行政區＋里＋到本校直線距離的本機比對；地址新增或修改時即時比對，資料換版時重算。
- `GET /admin/admissions/area`、`/area/kindergartens`、`/area/boundaries` 三支 API。
- 統計分析新子分頁「區域分析」：狀態列、地圖、附近幼兒園清單、行政區／里／距離三張表。
- 訪視明細：`district`、`village`、`geo=no_village`（有地址卻未定位到里）篩選；展開列顯示比對結果。
- 文件回寫：招生規格、DESIGN.md、轉移契約 README、README 日期段落、`deploy/README.md` 的同步操作說明。

### 3.2 本次不做

- 市場資料：0–6 歲人口、飽和度、機會判讀（D1）。資料來源已查證可行（內政部 RIS ODRP014，村里代碼與里界 100% 對應），日後要做再開。**2026-10-13 更新**：人口與機會判讀已做（招生機會，`docs/specs/2026-10-13-admissions-opportunity-design.md`）；飽和度仍不做。
- 托嬰中心與園所異動（新設、停辦、類型變動）：**2026-10-14 已做**（`docs/specs/2026-10-14-provider-changes-design.md`）；核定人數變動與月費估算變動仍不做。
- 各校 3／6 km 競爭環（D1）。
- 地址分析同意勾選、任何把家長地址送外部服務的定位（D3）。
- Google 評分、Google 收錄園所、車程分鐘（需外部路線服務）。
- 高雄市以外的門牌與園所（五校都在高雄市；外縣市地址歸「非高雄市」）。
- 園務的未接線功能：`selectedDistrict` 過濾、車程環、空的熱力圖層、園所中心點對話框、Google 重同步鈕。

## 4. 公開資料來源（2026-10-08 實際下載驗證）

| 資料 | 來源 | 格式與量 | 授權 | 更新 |
|---|---|---|---|---|
| 高雄市門牌坐標 | 高雄市政府資料開放平台「高雄市115年門牌坐標資料-TWD97」（`data.kcg.gov.tw/DataSet/Detail/1d7e3a54-6884-4cb0-b07c-c7c9cd411414`），檔案 `https://data.kcg.gov.tw/File/DirectDownload/<guid>` | UTF-8 BOM CSV，約 102MB、129 萬列（含樓層列），去樓層後 775,772 個基礎門牌（略過 544 列） | 政府資料開放授權條款第一版 | 每月新 guid、每年新資料集 |
| 村里界圖 | 內政部國土測繪中心「村里界圖（TWD97經緯度）」（`data.gov.tw/dataset/7438`），zip 內 SHP | 全國 7,986 筆；高雄市 893 個里＋11 筆未編定 | 政府資料開放授權條款第一版 | 不定期（目前 115/08/17 版） |
| 幼兒園 | `https://kiang.github.io/ap.ece.moe.edu.tw/preschools.json`（kiang 每日爬全國教保資訊網） | GeoJSON 約 10MB，全國 7,700 筆；高雄市 780 筆（營業中 734） | MIT；引用須註明 `https://ap.ece.moe.edu.tw/webecems/pubSearch.aspx` | 每日 |
| 底圖圖磚 | 國土測繪中心 WMTS 電子地圖 `https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}` | 圖磚 | 政府資料開放授權條款第一版；標註「© 國土測繪中心」 | — |

資料特性（實作必須處理）：

- 門牌欄位：`省市縣市代碼, 鄉鎮市區代碼, 村里, 鄰, 街路段, 地區, 巷, 弄, 號, 橫座標, 縱座標`。只有區代碼、沒有區名（區代碼對照表另在同平台）；號、巷、弄是全形數字；「號」常含樓層（`１２８號十樓之１`），同號各樓座標相同；街路段為空時改用「地區」（約 4.3 萬列）。
- 座標是 TWD97 TM2（EPSG:3826），匯入時轉 WGS84。
- 村里名稱有缺字：`北美術館`、`南美術館`、`達卡努瓦` 要補「里」，補完後 893 個里與界圖完全對齊。
- 以「區＋街路段（或地區）＋巷＋弄＋號＋之號」查，765,998 個鍵裡有 104 個對到兩個里（約 0.014%，以實作的解析在 115 年 10 月版重算過）：標「里有歧義」，不硬選。
- 巷、弄不一定是數字：有 1.6 萬列具名巷（「博愛巷」「光明10巷」）與「1之3弄」；「號之N」（`５２號之５`）有 3,348 列；「附」號與「特8號」等 544 列略過。
- 門牌（10 月版）與界圖（8 月版）版本不同，約 1.6% 的門牌點落在別的里界內：**里一律以門牌表「村里」欄為準**，座標只用來算距離。
- 界圖要濾掉 `VILLNAME` 空白的 11 筆（含東沙、南沙），否則地圖 `fitBounds` 會縮到南海。
- 幼兒園：`type` 只有公立／私立／非營利；準公共由 `pre_public`（如 `113-115`）的學年區間是否涵蓋目前學年推得；`monthly` 是 kiang 估算值；`penalty` 只有有／無；高雄市有 1 筆座標是字串型別。**不用 `punish_all.json`**（以行為人姓名為鍵，含個資）。
- 高雄市資料平台已非 CKAN：`/api/3/action/*` 回 404；頁面上的「CSV」鈕是會跳轉的 HTML 殼，要用 `File/DirectDownload/<guid>`；HEAD 回 405、Range 被忽略。

## 5. 資料模型

一支 migration，只新增資料表；`recruitment_visits` 不改結構。四張 `geo_*` 表是公開資料、與校區無關。

### 5.1 `geo_doorplates`（高雄門牌，去樓層）

| 欄位 | 型別 | 說明 |
|---|---|---|
| `id` | BigInteger（Identity） | 主鍵 |
| `dataset_version` | String(16) | 匯入批次標記，例 `115-10#a1b2c3`（13 字；同月份重匯不會和使用中的混在一起）；換版時新舊批次並存到切換完成 |
| `town_code` | String(8) | 區代碼，例 `6400500` |
| `district` | String(8) | 區名，例 `三民區`（由區代碼表轉） |
| `village` | String(16) | 里名（已補「里」字） |
| `street` | String(40) | 街路段；空時填「地區」值，並以 `street_kind` 區分 |
| `street_kind` | String(8) | `road`／`area` |
| `lane`、`alley` | String(16) NOT NULL | 巷、弄（`66`、`博愛`、`1之3`）；沒有時存 `""` |
| `number`、`number_sub` | Integer | 號、之號（無之號為 0） |
| `lat`、`lng` | Float | WGS84 |

索引 `ix_geo_doorplates_lookup`：`(dataset_version, town_code, street, lane, alley, number, number_sub)`。115 年 10 月版 775,772 列，實測一版含索引約 185MB（表 94MB＋索引 91MB）。

### 5.2 `geo_kindergartens`

`source_id`（String(64)，kiang `id`，主鍵）、`reg_no`、`name`、`kind`（`public`／`nonprofit`／`quasi_public`／`private`）、`pre_public_period`、`district`、`address`、`lat`、`lng`、`approved_capacity`、`monthly_fee_estimate`、`has_penalty`、`phone`、`is_active`、`synced_at`。只存高雄市、營業中；不存負責人姓名。

### 5.3 `geo_dataset_status`

一種資料一列（`doorplates`／`kindergartens`／`campuses`）：`active_version`（內部批次標記）、`label`（畫面顯示的「115-10」）、`synced_at`、`checked_at`、`last_attempt_at`、`last_error`（截斷 300 字，不含地址）。幼兒園的 `active_version`、`label` 都是同步日期；`campuses` 存「各校已發布校址＋使用中門牌批次」的指紋（內部用，畫面不讀），變了就重算訪視。

### 5.4 `recruitment_visit_geo`（訪視比對結果，官網專用）

| 欄位 | 說明 |
|---|---|
| `visit_id` | PK，FK `recruitment_visits.id` ON DELETE CASCADE |
| `village` | 里名，可空 |
| `match_level` | `exact`／`nearby`／`street`／`district`／`unlocated`／`pending` |
| `unlocated_reason` | `no_address`／`outside_kaohsiung`／`no_doorplate`／`ambiguous_village`／`anonymized`，可空 |
| `distance_m` | 到本校直線距離，取整到 100 m，可空 |
| `doorplate_version` | 比對當時的門牌月份標籤（畫面用的「115-10」，String(16)；不是內部批次標記） |
| `matched_at` | timestamptz |

**不存家長座標。** 行政區另寫回 `recruitment_visits.district`（見 5.5）。

### 5.5 `recruitment_visits.district`

由伺服器填寫行政區（例 `三民區`）。**行政區取自地址文字的解析**（舊高雄縣鄉鎮市轉新區名），不是門牌表：門牌資料尚未匯入、只比對到區、里有歧義時也有值，門牌資料只用來補里與座標。地址空白、明寫其他縣市、或解析不出高雄市區名時為 NULL。前端送 `district` 仍被 `extra="forbid"` 拒收（`test_admissions_records.py` 既有測試保留）。園務有同名欄位，JSONL 匯出（`export.py`）本來就帶。

### 5.6 里界 GeoJSON

隨 backend 套件提交 `backend/app/admissions/geo_data/kaohsiung-villages.geojson`：高雄市 893 里、mapshaper 簡化 10%、只留 `TOWNNAME`、`VILLNAME`、`VILLCODE`，約 600KB（gzip 約 130KB）。產生指令與界圖版本寫在同目錄 `README.md`。

## 6. 地址比對

### 6.1 時機

- 訪視建立、或更新時 `address` 有變：在同一個交易內比對並寫 `recruitment_visit_geo` 與 `district`。只查資料庫，不呼叫外部服務。沒有地址也寫一列（`unlocated`／`no_address`），所以「待比對」只出現在兩種情況：上線前就存在、還沒重算的舊訪視，以及門牌資料尚未匯入的期間（見下一點）。
- 門牌表尚未匯入：`match_level=pending`（行政區照樣由地址文字解析），匯入完成後由同步工作補比。
- 門牌換版、校址變更：同步工作重算所有未匿名化的訪視（含沒填地址的，補寫 `no_address` 列），每 100 筆一個交易（一批持有這些列的列鎖直到 commit，同時編輯其中一筆要等，`lock_timeout` 只有 10 秒，所以批次不放大）。只寫 `district` 與 `recruitment_visit_geo`，不動 `version`、`updated_at`；而且只在地址仍是剛讀到的值時才寫，使用者同時改了地址就不覆蓋（他那筆交易已用新地址比對過）。觸發條件是 `geo_dataset_status` 的 `campuses` 指紋變了（各校已發布校址或使用中門牌批次不同）。

### 6.2 正規化與解析

1. NFKC（全形轉半形）、`臺`→`台`（門牌表街名寫「台上路」「南台路」；判斷外縣市時兩種寫法都認）、去空白、各種破折號統一成 `-`。
2. 去郵遞區號（開頭 3、5 或 6 碼數字，可包在 `[ ]` 或 `( )` 裡）、去「高雄市」；舊制「高雄縣○○鄉／鎮／市」轉新區名（對照表放程式常數）。
3. 開頭明寫其他縣市 → `outside_kaohsiung`；否則解析區名，沒有區名或區不在高雄市 38 區 → `no_doorplate`。
4. 去掉「○○里」「○鄰」字樣（使用者寫的里不採信，以門牌表為準；街名本身帶「里」字的如「五里路」不誤刪）。
5. 解析街路段（路／街／大道＋可選「○段」，段號與路名序數轉中文數字以對齊門牌表）、巷、弄、號、之號；「號」之後的樓層全部丟棄。巷弄號的中文數字轉阿拉伯數字。號碼超過 99999 或無法解析視為沒寫號。

### 6.3 比對等級（依序）

| 等級 | 條件 | 寫入 |
|---|---|---|
| `exact` | 區＋街路段＋巷＋弄＋號＋之號完全對到（之號對不到時退回同號之 0） | 里、距離 |
| `nearby` | 同區同街路段同巷弄、號碼差 **30 以內**；**同單雙號（同一側街廓）優先**，再取號碼差最小的門牌 | 里、距離 |
| `street` | 對不到門牌，但「巷弄、巷、整條街路段」由窄到寬其中一層的所有門牌都在同一個里 | 里；距離空 |
| `district` | 只解析得出區（含門牌表沒有這條街、里有歧義） | 區；里與距離空 |
| `unlocated` | 沒有地址、明寫其他縣市、解析不出高雄市的區 | 原因 |
| `pending` | 門牌資料尚未匯入（有比對列）；或上線前的舊訪視還沒重算（沒有比對列，`district` 也是空） | 前者：區（由地址文字解析），里與距離空；後者：什麼都沒有，要等第一次重算 |

精確鍵對到兩個里時：`match_level=district`、`unlocated_reason=ambiguous_village`。

上線前就存在的舊訪視沒有 `recruitment_visit_geo` 列，`recruitment_visits.district` 也是空的：`district` 只在新建訪視、改地址、或重算時寫入，而重算只在 `run_geo_sync` 結束時觸發（`rematch_if_changed`，沒有別的入口）。所以這些訪視在區域分析歸「待比對」，**不會出現在行政區排行**（排行以 `district` 分組），直到第一次同步。第一次同步時 `geo_dataset_status` 沒有 `campuses` 那一列，指紋視為變了，會重算所有未匿名化的訪視（含門牌檔案模式、含下載失敗的那一輪；背景迴圈第一輪或 CLI `geo-sync` 都一樣），這時才補上 `district` 與比對列；已匿名化的舊訪視不補建。

同單雙號優先的理由：里界常沿街道中線劃分，對側門牌號碼雖然更近，卻常在另一個里。例：同街同巷弄有 10 號（甲里）、11 號（乙里）、13 號（乙里），查 12 號回甲里（同為雙號、差 2），不是乙里（差 1 但對側）。

### 6.4 校區座標

校址取自已發布內容的校區資料（content `campus_profile` 的 `address`），以同一套比對取座標（只接受 `exact`／`nearby`）。比對不到時 API 的 `campus.locate_error` 回原因：`no_address`（找不到本校地址）、`pending`（門牌資料尚未匯入）、`no_doorplate`（本校地址比對不到門牌）。**校區沒有座標時，區域分析的距離分組一律歸 `none`**，不使用訪視上存的舊距離（那是以前的校址算的）。本校改址後，已存的距離要等下一次同步（指紋變了才重算）或手動跑 CLI `geo-sync` 才更新，這段時間差接受。

2026-10-12 補：`campus.district` 一律帶校址文字解析出的行政區（`parse_address`，不看門牌），沒座標時也有；地圖靠它先框住校址所在的區（9.3）。外部地址轉座標服務不採用（只送公開校址也一樣）：國土測繪 `api.nlsc.gov.tw` 回 `PERMISSION DENIED`（要申請）、OSM Nominatim 五校都查不到、Google 要付費、TGOS 要申請金鑰。115 年 10 月真實門牌比對，五校已發布校址全部 `exact`。

### 6.5 距離

直線距離（haversine），取整到 100 m。距離分組：`0-1`、`1-3`、`3-6`、`6+` km、`none`（小於 1000 m 算 `0-1`，剛好 1000／3000／6000 m 算外面那一組）。

## 7. 資料同步

- **背景迴圈**：`backend/app/workers/geo_loop.py` 的 `GeoSyncLoop`，自己一個 asyncio task，不併進 `maintenance.py` 的 `run_cycle`（那一輪持全域 advisory lock、每 60 秒一次，一兩分鐘的匯入會讓排程發布與通知一起延後）。啟動後等 30 秒才跑第一輪，之後每 `WEBSITE_GEO_SYNC_CHECK_SECONDS`（預設 86400，限 300 秒至 7 天）醒一次。
- **互斥**：同一時間只允許一個同步，不論是 CLI、背景迴圈或多個副本。`run_geo_sync` 開頭用專用連線（AUTOCOMMIT，不開交易，下載幾分鐘也不會被閒置交易逾時收回）取 session 級 advisory lock（`hashtext('ivy-website:geo-sync')`），整個同步期間持有；搶不到丟 `GeoSyncBusy`——背景迴圈記 info log、跳過這一輪，CLI 印「另一個公開資料同步正在進行，稍後再試」並 exit 1。否則後到的同步開頭清「使用中以外的批次」，會刪掉先到的同步剛寫好的列。
- **啟用條件**：`WEBSITE_ADMISSIONS_ENABLED` 與 `WEBSITE_GEO_AUTO_SYNC` 都為 true 才啟動迴圈。`WEBSITE_GEO_AUTO_SYNC` **所有環境預設 false**（`config.py` 預設與 `.env.example` 都是關）：正式站招生開關已開，若預設開會在部署當下匯入約 185MB，要等使用者確認 Railway PG 空間後手動打開。CLI 不看這個開關。
- **頻率**：資料表空時立刻匯入；門牌、幼兒園各自距上次「確認」（`checked_at`，沒有則 `synced_at`）超過 30 天才去看來源。門牌先找最新月份，和使用中的月份一樣就不下載、只更新 `checked_at`；`--force` 略過 30 天與月份相同的判斷。
- **門牌**：從資料開放平台的搜尋頁找最新年度資料集，再從資料集頁找最新月份的 `File/DirectDownload/<guid>`（最新年度還沒有資源時退回前一年度）；`WEBSITE_GEO_DOORPLATE_URL` 可直接指定檔案網址（必須 https）。串流下載＋逐列解析＋每 5,000 列一個交易、用 `COPY` 寫進新批次，不落地、不整檔讀進記憶體。**換版前雙重核對**：實際匯入筆數不得少於 50 萬（下載到殘缺檔不換版；CLI 指定檔案不檢查下限），且資料庫裡該批次的實際列數要等於匯入筆數；通過才更新 `active_version` 並刪舊批次（切換與刪除分兩個交易）。任何失敗保留舊版本、寫 `last_error`（只記我們自己的訊息或例外類別，不含地址與回應內容）。門牌同步真的要進行時（不是因為還沒到期而略過），開頭先清掉之前中斷留下的半套批次。
- **幼兒園**：下載 `WEBSITE_GEO_KINDERGARTENS_URL`（預設 kiang 的 `preschools.json`，必須 https）、濾高雄市營業中、整批換新。
- **重算**：每次同步結束都檢查指紋（各校已發布校址＋使用中門牌批次），變了才觸發 6.1 的重算；指紋沒變時什麼都不做。所以即使 `WEBSITE_GEO_AUTO_SYNC` 關著，手動跑一次 CLI 也會補上校址變更後的重算。
- **CLI**：`python -m app.cli geo-sync [--force] [--doorplates-file PATH] [--doorplates-version 115-10] [--kindergartens-file PATH]`，平台改版或抓不到時的手動退路。指定任一個檔案就完全不連外，沒指定檔案的那一種跳過；`--doorplates-version` 省略時從檔名找「115-10」「115_10」，找不到用今天的民國年月。門牌或幼兒園任一個失敗，或另一個同步正在進行，結束碼為 1。
- **測試與開發**：不連外；HTTP 一律用 `httpx.MockTransport`，公開資料用 `backend/tests/fixtures/geo/` 的小樣本（115 行門牌 CSV、13 所幼兒園 JSON、兩個存下來的資料平台頁面）。

## 8. API

皆在 `prefix=/api/website/v1`、招生開關底下；權限 `_require_campus(user, "admissions.read", campus_key)`；只讀、不寫稽核；回應只有聚合數字與公開園所資料，不含任何家長個資。

### 8.1 `GET /admin/admissions/area`

參數：`campus_key`（必填）、`school_year`、`semester`（同 `/stats`，沿用 `_base_filters`）。

回應 `AdmissionsAreaOut`：

- `as_of`、`filters`
- `data_status`：`doorplate_version`（畫面用的月份標籤「115-10」，尚未匯入為 null）、`doorplates_synced_at`、`kindergartens_synced_at`、`boundary_version`（里界檔版本，目前 `115-08-17`）
- `campus`：`key`、`name`、`lat`、`lng`、`district`（校址文字解析出的行政區，2026-10-12 加）；比對不到時座標為 null 並帶 `locate_error`（`no_address`／`pending`／`no_doorplate`）
- `totals`：以**有地址**為母數（實作裁定 R5），欄位與不變式如下表
- `districts: [{district, visit, deposit, visit_to_deposit_rate}]`，依參觀人數降冪、區名排序；含只到區的訪視與已匿名化的訪視（`district` 匿名化後保留）
- `villages: [{district, village, village_code, visit, deposit, visit_to_deposit_rate}]`，只含比對到里的訪視，依參觀人數降冪
- `distance_bands: [{band, visit, deposit, visit_to_deposit_rate}]`，固定五列依序；校區沒有座標時全部歸 `none`

| `totals` 欄位 | 意義 |
|---|---|
| `visit` | 範圍內全部訪視（`with_address` ＋ `no_address` ＋ `anonymized`） |
| `with_address` | 未匿名化且有填地址（`address` 非 NULL 且 trim 後非空；判斷與訪視明細 `geo=no_village` 共用同一個函式，畫面數字才會和「查看」跳到的清單一致） |
| `village_level` | 有地址且比對到里（`exact`／`nearby`／`street`） |
| `district_level` | 有地址且只到區（`district`，含里有歧義） |
| `unlocated` | 有地址且 `unlocated`（查無門牌、非高雄市） |
| `pending` | 有地址且 `pending`，或還沒有比對列 |
| `no_address` | 未匿名化、沒填地址 |
| `anonymized` | 已匿名化（地址已清掉，不算有地址） |
| `unlocated_reasons` | 只算「有地址卻沒到里」的原因：`outside_kaohsiung`、`no_doorplate`、`ambiguous_village`（OpenAPI enum 只有這三值），筆數大於 0 才列，筆數多的在前、同筆數依此固定順序 |

兩條不變式（有測試鎖住）：`village_level + district_level + unlocated + pending == with_address`；`with_address + no_address + anonymized == visit`。

計數與比率沿用 `stats.py` 的 `COUNT_FIELDS` 與 `pct`（分母 0 回 null）。`village_code` 由里界資料的 `TOWNNAME`＋`VILLNAME` 對應，對不到為 null。

### 8.2 `GET /admin/admissions/area/kindergartens`

參數：`campus_key`（必填）、`radius_km`（1／3／6，預設 3；其他值回 422 `INVALID_RADIUS`）。回應 `AreaKindergartensOut`：`synced_at`、`source_note`、`campus`（同 8.1）、`radius_km`、`items: [{source_id, name, kind, pre_public_period, address, lat, lng, distance_m, approved_capacity, monthly_fee_estimate, has_penalty, phone, is_own}]`，依距離（同距離依名稱）排序。`is_own`：與任一校區座標相距 50 m 內，畫面標「本機構」、不算競爭園所。校區座標未定位時回空清單，原因在 `campus.locate_error`。

### 8.3 `GET /admin/admissions/area/boundaries`

回 5.6 的 GeoJSON（`application/geo+json`）；不分校區，只要有 `admissions.read` 權限。`ETag`＋`Cache-Control: private, max-age=86400`，`If-None-Match` 相同回 304。

### 8.4 訪視明細篩選

`GET /admin/admissions/records` 與 `/records/export`（共用篩選）新增：

- `district`、`village`（字串完全相等；`district` 比 `recruitment_visits.district`，所以含已匿名化的訪視；`village` 只算已比對到里且未匿名化的訪視，同名里的下鑽一定同時送 `district` 與 `village`）；
- `geo=no_village`：**有地址卻沒比對到里**——`match_level` 為 `district`、`unlocated`、`pending` 或沒有比對列；沒填地址的、已匿名化的不算（沒有地址可以補查）。筆數與區域分析狀態列「未定位到里」相同。

匯出稽核的 metadata 另記 `area`（`district`／`village`／`no_village`，只記篩了哪一種，不記區名與里名）。

### 8.5 訪視回應

`RecruitmentVisitOut` 新增 `geo: {village, match_level, unlocated_reason, distance_m} | null`（給明細展開列）；上線前的舊訪視在背景重算前為 `null`。

## 9. 後台畫面

### 9.1 子分頁

`StatsTab.vue` 新增「區域分析」，`name=stats-area`，`useAdmissionsFilters.ts` 的 `STATS_SUBS` 加 `area`（網址 `sub=area`）；順序同園務：總覽、班別、來源、接待、**區域**、未預繳原因、五校比較。`lazy`，點開才呼叫 8.1–8.3。換頁首篩選時重讀（沿用 `useRequestSequence`，只採用最後一次的回應，快速切換校區不混校）；里界只有一份，換校區、學期不重讀。地圖元件 `AreaMap.vue` 由 `AreaTab` 以 `defineAsyncComponent` 另切 chunk，點開子分頁才下載。

### 9.2 版面（桌機）

1. **狀態列**：「門牌資料 115 年 10 月版・幼兒園名單 10/08 更新」與以有地址為母數的摘要「有地址 42 筆：到里 38 筆、未定位到里 4 筆（只到區 2、查無門牌 1、待比對 1）（查看）」（實作裁定 R5）：括號內只列非零項；「查看」跳明細 `area=no_village`，筆數與「未定位到里」相同；有沒填地址的另加「；另有 N 筆沒填地址」，已匿名化的不放在狀態列。門牌資料尚未匯入時第一句改為「門牌資料尚未匯入，家長地址暫時對不到里、算不出距離；匯入後自動補上。」（2026-10-12 改寫，原句只說「會自動比對」看不出影響）。
2. **第一列**：左地圖（3fr）、右附近幼兒園清單（2fr）；寬度 1200px 以上才並排，以下單欄。
3. **第二列**：行政區排行、里排行、距離分布三張 `StatsDimensionTable`（欄位：區域／參觀人數 bar／預繳人數／預繳率；表頭用語同其他子分頁），各自可匯出 CSV。版面是 `auto-fit` 格線、每張至少約 32rem：1440 螢幕一列兩張、距離分布換到下一列；窄螢幕單欄，表格在自己的框內橫捲。**只有行政區表與里表每列有「查看明細」鈕**（`StatsDimensionTable` 新增 `actionLabel` prop 與 `action` 事件，不匯出到 CSV），跳訪視明細並帶區域篩選；**距離分布表沒有**（沒有對應的明細篩選，實作裁定 R13）。手機（≤720px）不多那一欄：按鈕欄在最右邊、一打開只露幾 px，改成 sticky 名稱欄本身是連結（讀屏名稱同按鈕「查看明細：三民區本揚里」），2026-10-12。

### 9.3 地圖（`AreaMap.vue`，Leaflet 動態 import）

- 底圖：國土測繪 EMAP；右下標「© 國土測繪中心」。
- 里界：依參觀人數分 5 級著色（顏色走 token、0 筆不上色、半透明）；hover 顯示里名（桌機）；點擊彈出「三民區鼎金里・參觀 5・預繳 2（40.0%）・查看明細」。
- 本校：SVG divIcon 星號；1／3／6 km 虛線圓（跟著清單的半徑選擇）。
- 幼兒園：依類型上色的小圓點（`circleMarker`），可開關；點擊彈出名稱、類型、距離、核定人數。
- 初始視野（2026-10-12 改）：本校為中心、剛好框住目前的半徑圈（直徑見方、四邊留 24px），換 1／3／6 公里時視野跟著框住新的圈。本校沒座標時框住 `campus.district` 那一區的里界外框（不必等門牌）；連區都不知道（沒有校址、外縣市）才 fit 整個高雄市里界（含山區，畫面是半個南台灣）。切到別的子分頁再切回來，重新取景到這個視野，之前的縮放不保留。
- 圖例：參觀人數 5 級各自涵蓋的人數、幼兒園類型與「本機構」；本校星號與本機構圓點用品牌金，四種類型色避開狀態綠與草稿暖黃。本校位置未標示時圖例區寫原因。
- 不載 Leaflet 預設圖示檔；Leaflet CSS 隨 chunk 打包。
- 桌機地圖高 520px，滾輪不縮放。手機：地圖高約 50vh（最小 280px）；預設不攔截單指捲動（`dragging` 關、`touchZoom` 關），點「移動地圖」後才可拖曳縮放，再點「完成」恢復。
- 失敗處理：底圖圖磚一張都沒載到、又連續失敗 4 張才顯示「底圖載入失敗。」＋重試（偶發失敗不跳）；Leaflet 載入或建圖失敗顯示「地圖載入失敗，請重試或重新整理頁面。」＋重試；地圖 chunk 本身載入失敗（部署後舊 hash 檔已不存在，重抓同一個檔救不回來）顯示「地圖沒有載入成功，請重新整理這一頁。」＋重新整理鈕；里界載入失敗顯示「里界載入失敗，地圖無法顯示。」＋重試。以上四種都不影響表格與幼兒園清單。

### 9.4 附近幼兒園清單（`NearbyKindergartens.vue`）

- 搜尋（名稱、地址）、類型 chip（公立／非營利／準公共／私立，可複選）、半徑 1／3／6 km。
- 每列：名稱（去掉「高雄市私立／市立」前綴）、類型、距離、核定人數、月費（估）、有裁罰時顯示標記；本機構標「本機構」。
- 點列：地圖移過去並打開該點的彈出框，同時展開該列（再點一次只收合）。展開：地址、電話、準公共期間、全國教保資訊網查詢頁連結（教保資訊網沒有單一園所的固定網址）。
- 先顯示 20 筆，其餘按「顯示更多」。
- 底部：「資料來源：全國教保資訊網（kiang 整理），月費為估計值・10/08 更新」。
- 範圍內只有本機構、沒有其他園所時寫「N 公里內沒有其他幼兒園。」，不顯示空白列表；校區未定位時寫原因（見 9.5）。

### 9.5 空狀態與錯誤（DESIGN 規則：寫原因、不顯示假 0）

- 範圍內沒有訪視：沿用其他子分頁的空狀態。
- 有訪視但都沒有可比對的地址（`with_address` 為 0）：只有沒填地址寫「這個範圍的訪視都還沒填地址。」；只有已匿名化寫「這個範圍的訪視地址都已依保存期限清除，無法比對。」；兩者都有寫「這個範圍的訪視沒有可比對的地址：N 筆沒填地址、M 筆已依保存期限清除。」，不把匿名化說成沒填。
- 門牌未匯入（`doorplate_version` 為 null）：「門牌資料尚未匯入，家長地址暫時對不到里、算不出距離；匯入後自動補上。」；表格照常顯示（有地址的全部歸待比對）。
- 幼兒園資料尚未匯入（`kindergartens_synced_at`／清單 `synced_at` 為 null）：狀態列補「幼兒園名單尚未匯入」（門牌也未匯入時兩句各自成段）；附近幼兒園清單寫「幼兒園名單尚未匯入。」，不顯示搜尋框、類型 chip 與「更新」頁尾，不寫「N 公里內沒有其他幼兒園」（空清單不代表附近沒有競爭園所）。校區未定位的原因優先於這一句。
- 校區未定位：距離表改寫原因（依 `locate_error`：找不到本校地址／門牌資料尚未匯入／本校地址比對不到門牌，後接「，無法計算距離。」）；幼兒園清單同樣寫原因；地圖框住校址所在的區（不知道區才 fit 高雄市），圖例下寫「本校位置未標示（原因），地圖先顯示三民區。」。
- 里界或圖磚載入失敗：地圖區顯示錯誤與重試，表格不受影響。

### 9.6 訪視明細

- 展開列「地址」下多一行「區域」：`三民區鼎金里・距本校 1.2 km`、`三民區（只到區）`、`三民區（里有歧義）`、`非高雄市地址`、`未定位：查無門牌`、`待比對` 等；沒填地址、已匿名化的不列；有填地址卻沒有比對紀錄（geo 為 null 的舊資料）寫「待比對」，與 `area=no_village` 篩選同口徑。
- 區域篩選：明細上方常駐提示列，句型比照 `vr` 預約篩選（實作裁定 R14，`areaNotice()`）：「只顯示三民區本揚里的訪視。」／「只顯示未定位到里的訪視（只到區、查無門牌、非高雄市地址或待比對）。」＋「不限區域」（2026-10-12 起；原本叫「顯示全部」，與 `vr` 提示的鈕同名，改為各自的文字，`vr` 那顆是「不限這筆預約」。區域沒有對應下拉，放進篩選 chip 列在收合「更多篩選」時會被一起收掉，所以不放 chip）。網址 `area`（沿用 `useAdmissionsFilters`，只在 `tab=records` 有效，離開明細就清掉）：`三民區`、`三民區/本揚里`、`no_village`；手改成其他字串一律當沒篩，網址改回乾淨的 query。

### 9.7 CSP

`web/server/utils/security-headers.ts`：只對 `/admin` 路徑的 `img-src` 加 `https://wmts.nlsc.gov.tw`；公開站不變。

## 10. 個資與保存

- 家長地址只在官網資料庫內比對；比對與同步的 log 不記地址，只記等級與原因。
- 唯一的外部請求是地圖圖磚（只含視野範圍，不含家長資料）與同步工作下載公開資料。
- `recruitment_visit_geo` 不存家長座標，距離取整到 100 m。
- （2026-10-15）在籍學生分布另存取整到約 100 m 的學生座標，是使用者的裁定，只限在籍資料、訪視仍不存座標；見 `docs/specs/2026-10-15-admissions-enrolled-map-design.md` E3。
- 匿名化（`retention.py` `anonymize_visit`）：既有清 `address`；新增把 `recruitment_visit_geo` 的 `village`、`distance_m` 清空、`match_level` 改為 `district`（有行政區時）或 `unlocated`（沒有時）、`unlocated_reason=anonymized`；`recruitment_visits.district` 保留（同園務、同既有行為）。沒有比對列的舊訪視不補建。鎖定順序與重算一致：兩邊都先鎖訪視列（依 id 由小到大；匿名化的 `SELECT … FOR UPDATE` 依 `recruitment_visits.id` 排序）、再動 geo 列。
- 地圖與表格只呈現里層級聚合；後台人員本來就看得到明細地址，不另做小數量抑制。
- 區域分析頁的統計：已匿名化的訪視不算有地址（`totals.anonymized`），但行政區表仍含它們（`district` 保留）；整個範圍都是已匿名化時，畫面寫「地址都已依保存期限清除，無法比對」（見 9.5）。

## 11. 與園務的相容性

- `district` 開始有值，語意同園務（行政區字串）；`export.py` 已匯出，不改。**口徑不同**：官網由地址文字解析、只認高雄市 38 區（舊高雄縣鄉鎮轉新區名），外縣市地址的 `district` 為 NULL（`outside_kaohsiung`）；園務由後端 regex 切出「○○區」，外縣市地址也會切出該縣市的區名。併入園務時要擇一。
- `recruitment_visit_geo`、`geo_*` 為官網專用，不進 `contracts/ivy-recruitment`。
- `contracts/ivy-recruitment/README.md`：第 10 點（官網不做行政區）改寫，新增第 18 點記錄上述口徑差異、`district` 的來源（地址文字；門牌資料只補里與座標）、官網不送外部服務與不做同意勾選、匿名化行為。

## 12. 文件回寫（2026-10-08 已完成）

- 招生規格 `docs/specs/2026-09-30-website-admissions-design.md`：§3.2 加 2026-10-08 更新段、§5.1 `district` 與 §6.6 不收 `district` 的註記、§9.3 兩處（警示行動入口的「官網不做行政區」與「不做」清單）、§10 統計分析與訪視明細兩列、§12.3 欄位對照表加一列。
- DESIGN.md 招生章節：新增「招生入學：區域分析」（資料來源、精度到里、無同意勾選、不送第三方、同步預設關、地圖用色走 token）；「圖一律是表格＋CSS 長條，不裝圖表套件」補例外「地圖用 Leaflet，圖表仍不裝」；「不做」清單拿掉區域分析。
- `StatsTab.vue` 與 `backend/app/admissions/stats.py` 檔頭、`_action_queue` 的「不做行政區」註解已改。
- `backend/.env.example`：`WEBSITE_GEO_AUTO_SYNC`、`WEBSITE_GEO_DOORPLATE_URL`、`WEBSITE_GEO_KINDERGARTENS_URL`、`WEBSITE_GEO_SYNC_CHECK_SECONDS`。
- README 頂部日期段落；`deploy/README.md` 新增「公開地理資料同步（招生區域分析）」操作說明（怎麼開、前置、手動退路）。**部署後**還要在 `deploy/README.md` 另補部署紀錄（日期、commit、實際開關狀態）。

## 13. 部署

- migration `e7a1c4d9b2f6` 只新增表；部署後畫面顯示「門牌資料尚未匯入」。
- 開啟同步前置：確認 Railway PG 剩餘空間 ≥ 500MB（門牌一版約 185MB，換版時新舊兩版並存約 370MB；`DELETE` 不把空間還給檔案系統，第一次換版後穩態約 370–400MB，不會回到 185MB）。
- 開啟：Railway api service 設 `WEBSITE_GEO_AUTO_SYNC=true` → 重新部署 → 看 api log 的 geo-sync 結果與後台狀態列。完整步驟與手動退路（CLI `geo-sync`）見 `deploy/README.md`「公開地理資料同步（招生區域分析）」。
- 本校改址後距離要等下一次同步（或手動 `geo-sync`）才重算，記在部署紀錄。
- 照 CLAUDE.md：不自行 push、不部署。

## 14. 測試與驗收

### 14.1 後端 pytest（真 PostgreSQL、獨立測試庫）

A、B 階段新增 `test_geo_*`（address、projection、schema、doorplates、kindergartens、matcher、sync、loop、boundaries）、`test_admissions_area`、`test_admissions_visit_geo` 共 247 個測試（以 `pytest --collect-only` 計）。涵蓋：

- 地址解析：`test_geo_address.py` 73 個測試（全形、之號、樓層、舊高雄縣、缺區、外縣市、「地區」型門牌、美術館里補字、中文數字巷弄、段號、異常中文數字與超大號碼）。
- 比對：各等級、里有歧義、同單雙號優先、門牌未匯入的 pending、校區座標、距離四捨五入到 100 m、重算不動 `version`／`updated_at`、重算不蓋掉同時進行的地址修改。
- `/area`：口徑（與 `/stats` 的參觀人數、預繳人數一致）、學年學期篩選、`totals` 兩條不變式、未定位原因排序、空校區、校區未定位時距離全歸 `none`、權限（editor／readonly 403、越權校區 404）、開關關閉 404。
- `/area/kindergartens`：半徑（含其他值 422）、排序、`is_own`、校區未定位。
- `/area/boundaries`：ETag、權限。
- 同步：假 HTTP 成功才切換版本、失敗或下載中斷保留舊版本與 `last_error`、筆數太少或與資料庫實際列數不符不換版、同月份不重下載、`--force`、換版與校址變更觸發重算；全域鎖（持鎖時回 `GeoSyncBusy`、鎖會釋放、同步期間不佔著交易）；背景迴圈只在兩個開關都開時啟動；CLI 旗標與 exit code。
- 匿名化、明細篩選（`geo=no_village` 不含沒地址與已匿名化的）、`district` 拒收前端送值、匯出稽核只記篩了哪一種。

### 14.2 實際資料驗證（不進 CI）

`backend/scripts/geo_match_report.py`（只准寫入名稱含 `geo` 的專用測試報告庫，`WEBSITE_ENVIRONMENT=test`）以完整門牌 CSV 匯入，拿 kiang 高雄市營業中 734 所幼兒園地址跑比對，2026-10-08 本機結果：門牌 775,772 列（略過 544 列）；`exact` 708、`nearby` 11、`street` 2、`district` 13，`exact`＋`nearby` 98.0%（門檻 95%）；門牌表含索引 185MB。沒對到的 15 筆多為園所自己的寫法（異體字「廣褔巷」「大褔街」、「370之2、之3、之4號」多號並列）或門牌表沒有該號。這是幼兒園地址的結果，不代表家長手填地址的比對率。

### 14.3 admin vitest

`areaFilter`、`areaFormat`、`areaMap`（mock `leaflet`）、`areaTab`、`areaTabChunkFailure`、`nearbyKindergartens`、`statsDimensionCsv`、`statsTab`、`admissionsView`、`admissionsRecords`、`admissionsApi`。涵蓋：子分頁各狀態（9.5）、三張表、跳轉帶篩選、清單搜尋／類型／半徑、`sub=area` 進網址、明細比對結果與區域提示列、網址 `area` 被手改、快速切換校區不混校、地圖與里界載入失敗。既有的 `ux20261005`、`crossUx20261002`、`a11yStructure`、`noLiteralBom` 守門測試仍適用。

### 14.4 stack e2e

`tests/stack/admissions-area.spec.ts` 三條：一條完整流程——建立有地址的訪視 → 區域分析的狀態列、三張表、附近幼兒園、地圖里界著色 → 點列「查看明細」跳到明細帶篩選；另兩條是 1440 與 390 的截圖測試（斷言地圖有里界路徑、沒有失敗提示、頁面不橫向溢出，390 另斷言地圖預設不攔單指捲動）。stack 啟動時以 `geo-sync --doorplates-file … --kindergartens-file …` 匯入 `tests/stack/fixtures/` 的小樣本，不連外；底圖圖磚被攔成透明圖。真瀏覽器 e2e 抓到過 mock 測試看不到的 Leaflet 建圖順序錯誤（先取視野再加圖層），保留為回歸。

### 14.5 驗收

`npm --prefix admin run typecheck`／test、`npm --prefix web run test:unit`（CSP）、`npm run contract:check`、後端全套 pytest、stack e2e；dev server 上用 Playwright 看桌機 1440 與手機 390。

## 15. 風險

| 風險 | 處理 |
|---|---|
| 高雄平台每年換資料集、每月換 guid、改版 | 自動找最新失敗只記錯誤、保留舊版；`WEBSITE_GEO_DOORPLATE_URL` 與 CLI 指定檔案為退路 |
| kiang 為單人維護的第三方鏡像 | 存進自己的 DB、不即時抓；中斷時保留最後一版 |
| 手填地址錯字多 | 明細顯示比對結果，人員可修正；未定位可篩出 |
| Railway PG 空間 | 同步預設關，確認空間後才開 |
| 里界與門牌版本差 | 里以門牌表為準 |
| 兩個同步同時跑會刪掉對方剛寫好的批次 | session 級 advisory lock，搶不到不跑（CLI exit 1） |
| 本校改址後距離失準 | 不存家長座標，無法即時重算；下一次同步或手動 `geo-sync` 才更新，接受這段時間差 |

## 16. 待確認

- Railway PG 剩餘空間（開同步前）。
- 舊高雄縣鄉鎮名對照：27 個鄉鎮市已與 38 區清單核對（轉出的新區名都在 38 區內，另 11 個原高雄市區不需轉換）。
- 併入園務時 `district` 的口徑擇一（見 §11）。
- 家長手填地址的真實比對率：目前只有幼兒園地址的 98.0%，上線開同步後用 `未定位到里` 的筆數觀察。

## 17. 實作裁定（2026-10-08，主控）

實作期間為了讓畫面、篩選與資料口徑一致所做的裁定，已回寫到上面各節；列在這裡方便追溯。

| 編號 | 裁定 | 回寫位置 |
|---|---|---|
| R4 | `geo=no_village` 限有地址（`address` 非 NULL 且 trim 後非空）且比對層級不在里層級；含沒有比對列的舊訪視，不含沒填地址、已匿名化的 | §8.4 |
| R5 | `totals` 以有地址為母數，另加 `no_address`、`anonymized`，兩條不變式；`unlocated_reasons` 只算有地址卻沒到里的三種原因；狀態列文案依此 | §8.1、§9.2 |
| R6 | 校區沒有座標時距離分組全歸 `none`；校址改了、要等同步重算的時間差接受 | §6.4、§15 |
| R7 | `nearby` 同單雙號優先、號碼差 30 以內 | §6.3 |
| R8 | 校區未定位三種原因分開寫文案 | §9.5 |
| R13 | 距離分布表沒有「查看明細」 | §9.2 |
| R14 | 明細提示列比照 `vr` 句型（`areaNotice()`），不放 chip | §9.6 |
| R21 | 規格數字與命名以實作為準（`dataset_version` String(16)、`source_id`、重算對象含沒填地址的訪視、幼兒園 734 所、門牌 775,772 列、地址解析 73 個測試等） | §4、§5、§6.1、§8.2、§14 |
| — | 同步的全域鎖收進 `run_geo_sync`（AUTOCOMMIT 連線的 session 級 advisory lock，`GeoSyncBusy`），背景迴圈與 CLI 都接這個例外 | §7 |
| — | 啟用新批次前雙重核對（下限 50 萬列、資料庫實際列數） | §7 |
| — | 匿名化先動訪視列、再動 geo 列，與重算同一個鎖定順序 | §10 |
| — | 報告腳本只准寫名稱含 `geo` 的專用測試庫 | §14.2 |
| — | 三張表桌機改 `auto-fit` 格線；地圖 chunk 載入失敗顯示整頁重新整理；整範圍匿名化文案 | §9.2、§9.3、§9.5 |
