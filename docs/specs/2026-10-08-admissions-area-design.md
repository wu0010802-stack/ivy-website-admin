# 招生入學「區域分析」設計

日期：2026-10-08
狀態：草案，待使用者審閱
對象：業主、接手實作的 Claude
基準：`origin/main` `82937a9f`（招生入學已部署；依 `2026-10-05-visit-family-page-design.md` 記載正式站招生開關已開；migration head `c4e8a2f61b97`）

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
3. 家長地址不離開官網資料庫：比對、統計、畫圖都不呼叫任何外部服務。
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
- 訪視明細：`district`、`village`、`geo=unlocated` 篩選；展開列顯示比對結果。
- 文件回寫：招生規格、DESIGN.md、轉移契約 README、README 日期段落。

### 3.2 本次不做

- 市場資料：0–6 歲人口、飽和度、機會判讀（D1）。資料來源已查證可行（內政部 RIS ODRP014，村里代碼與里界 100% 對應），日後要做再開。
- 各校 3／6 km 競爭環（D1）。
- 地址分析同意勾選、任何把家長地址送外部服務的定位（D3）。
- Google 評分、Google 收錄園所、車程分鐘（需外部路線服務）。
- 高雄市以外的門牌與園所（五校都在高雄市；外縣市地址歸「非高雄市」）。
- 園務的未接線功能：`selectedDistrict` 過濾、車程環、空的熱力圖層、園所中心點對話框、Google 重同步鈕。

## 4. 公開資料來源（2026-10-08 實際下載驗證）

| 資料 | 來源 | 格式與量 | 授權 | 更新 |
|---|---|---|---|---|
| 高雄市門牌坐標 | 高雄市政府資料開放平台「高雄市115年門牌坐標資料-TWD97」（`data.kcg.gov.tw/DataSet/Detail/1d7e3a54-6884-4cb0-b07c-c7c9cd411414`），檔案 `https://data.kcg.gov.tw/File/DirectDownload/<guid>` | UTF-8 BOM CSV，約 102MB、129 萬列（含樓層列），去樓層後約 76.5 萬個基礎門牌 | 政府資料開放授權條款第一版 | 每月新 guid、每年新資料集 |
| 村里界圖 | 內政部國土測繪中心「村里界圖（TWD97經緯度）」（`data.gov.tw/dataset/7438`），zip 內 SHP | 全國 7,986 筆；高雄市 893 個里＋11 筆未編定 | 政府資料開放授權條款第一版 | 不定期（目前 115/08/17 版） |
| 幼兒園 | `https://kiang.github.io/ap.ece.moe.edu.tw/preschools.json`（kiang 每日爬全國教保資訊網） | GeoJSON 約 10MB，全國 7,700 筆；高雄市 780 筆（營業中 734） | MIT；引用須註明 `https://ap.ece.moe.edu.tw/webecems/pubSearch.aspx` | 每日 |
| 底圖圖磚 | 國土測繪中心 WMTS 電子地圖 `https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{y}/{x}` | 圖磚 | 政府資料開放授權條款第一版；標註「© 國土測繪中心」 | — |

資料特性（實作必須處理）：

- 門牌欄位：`省市縣市代碼, 鄉鎮市區代碼, 村里, 鄰, 街路段, 地區, 巷, 弄, 號, 橫座標, 縱座標`。只有區代碼、沒有區名（區代碼對照表另在同平台）；號、巷、弄是全形數字；「號」常含樓層（`１２８號十樓之１`），同號各樓座標相同；街路段為空時改用「地區」（約 4.3 萬列）。
- 座標是 TWD97 TM2（EPSG:3826），匯入時轉 WGS84。
- 村里名稱有缺字：`北美術館`、`南美術館`、`達卡努瓦` 要補「里」，補完後 893 個里與界圖完全對齊。
- 以「區＋街路段＋地區＋巷＋弄＋號」查，有 104 個鍵對到兩個里（約 0.01%；計畫 A 用正確的號碼寫法重算）：標「里有歧義」，不硬選。
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
| `dataset_version` | String(32) | 匯入批次標記，例 `115-10#a1b2c3`（同月份重匯不會和使用中的混在一起）；換版時新舊批次並存到切換完成 |
| `town_code` | String(8) | 區代碼，例 `6400500` |
| `district` | String(8) | 區名，例 `三民區`（由區代碼表轉） |
| `village` | String(16) | 里名（已補「里」字） |
| `street` | String(40) | 街路段；空時填「地區」值，並以 `street_kind` 區分 |
| `street_kind` | String(8) | `road`／`area` |
| `lane`、`alley` | String(16) NOT NULL | 巷、弄（`66`、`博愛`、`1之3`）；沒有時存 `""` |
| `number`、`number_sub` | Integer | 號、之號（無之號為 0） |
| `lat`、`lng` | Float | WGS84 |

索引：`(dataset_version, town_code, street, lane, alley, number, number_sub)`。實測一版含索引約 185MB（表 94MB＋索引 91MB）。

### 5.2 `geo_kindergartens`

`source_id`（kiang `id`，唯一鍵）、`reg_no`、`name`、`kind`（`public`／`nonprofit`／`quasi_public`／`private`）、`pre_public_period`、`district`、`address`、`lat`、`lng`、`approved_capacity`、`monthly_fee_estimate`、`has_penalty`、`phone`、`is_active`、`synced_at`。只存高雄市、營業中。

### 5.3 `geo_dataset_status`

一種資料一列（`doorplates`／`kindergartens`／`campuses`）：`active_version`（內部批次標記）、`label`（畫面顯示的「115-10」）、`synced_at`、`checked_at`、`last_attempt_at`、`last_error`（截斷，不含地址）。`campuses` 存校址＋門牌批次的指紋，變了就重算訪視。

### 5.4 `recruitment_visit_geo`（訪視比對結果，官網專用）

| 欄位 | 說明 |
|---|---|
| `visit_id` | PK，FK `recruitment_visits.id` ON DELETE CASCADE |
| `village` | 里名，可空 |
| `match_level` | `exact`／`nearby`／`street`／`district`／`unlocated`／`pending` |
| `unlocated_reason` | `no_address`／`outside_kaohsiung`／`no_doorplate`／`ambiguous_village`／`anonymized`，可空 |
| `distance_m` | 到本校直線距離，取整到 100 m，可空 |
| `doorplate_version` | 比對當時的門牌版本 |
| `matched_at` | timestamptz |

**不存家長座標。** 行政區另寫回 `recruitment_visits.district`（見 5.5）。

### 5.5 `recruitment_visits.district`

由伺服器依比對結果填寫行政區（例 `三民區`），比對不到行政區時為 NULL。前端送 `district` 仍被 `extra="forbid"` 拒收（`test_admissions_records.py` 既有測試保留）。園務有同名欄位，JSONL 匯出（`export.py`）本來就帶。

### 5.6 里界 GeoJSON

隨 backend 套件提交 `backend/app/admissions/geo_data/kaohsiung-villages.geojson`：高雄市 893 里、mapshaper 簡化 10%、只留 `TOWNNAME`、`VILLNAME`、`VILLCODE`，約 600KB（gzip 約 130KB）。產生指令與界圖版本寫在同目錄 `README.md`。

## 6. 地址比對

### 6.1 時機

- 訪視建立、或更新時 `address` 有變：在同一個交易內比對並寫 `recruitment_visit_geo` 與 `district`。只查資料庫，不呼叫外部服務。
- 門牌表尚未匯入：`match_level=pending`，匯入完成後由同步工作補比。
- 門牌換版、校址變更：同步工作重算所有未匿名化且有地址的訪視（分批）。

### 6.2 正規化與解析

1. NFKC（全形轉半形）、`臺`→`台`（門牌表街名寫「台上路」「南台路」；判斷外縣市時兩種寫法都認）、去空白。
2. 去郵遞區號（開頭 3–6 碼數字或 `[831]`）、去「高雄市」；舊制「高雄縣○○鄉／鎮／市」轉新區名（對照表放程式常數）。
3. 解析區名；沒有區名或區不在高雄市 38 區 → 看地址是否明寫其他縣市：是則 `outside_kaohsiung`，否則 `no_doorplate`。
4. 去掉「○○里」「○鄰」字樣（使用者寫的里不採信，以門牌表為準）。
5. 解析街路段（路／街／大道＋可選「○段」，段號轉中文數字以對齊門牌表）、巷、弄、號、之號；「號」之後的樓層全部丟棄。巷弄號的中文數字轉阿拉伯數字。

### 6.3 比對等級（依序）

| 等級 | 條件 | 寫入 |
|---|---|---|
| `exact` | 區＋街路段＋巷＋弄＋號＋之號完全對到（之號對不到時退回同號之 0） | 里、距離 |
| `nearby` | 同區同街路段同巷弄，取號碼差最小的門牌（同單雙號優先） | 里、距離 |
| `street` | 對不到巷弄，但該街路段所有門牌都在同一個里 | 里；距離空 |
| `district` | 只解析得出區 | 區；里與距離空 |
| `unlocated` | 其他 | 原因 |

精確鍵對到兩個里時：`match_level=district`、`unlocated_reason=ambiguous_village`。

### 6.4 校區座標

校址取自已發布內容的校區資料（`backend/app/content/schemas.py` 校區 `address`），以同一套比對取座標（只接受 `exact`／`nearby`）。比對不到時該校距離全部為空，API 回原因。

### 6.5 距離

直線距離（haversine），取整到 100 m。距離分組：`0–1`、`1–3`、`3–6`、`6+` km、`none`。

## 7. 資料同步

- 沿用 `backend/app/workers/maintenance.py` 的背景機制，但另用一把 advisory lock（`ivy-website:geo-sync`），不放進既有 `run_cycle` 的鎖內，避免一兩分鐘的匯入卡住排程發布與通知。
- 啟用條件：`WEBSITE_ADMISSIONS_ENABLED` 與 `WEBSITE_GEO_AUTO_SYNC` 都為 true。`WEBSITE_GEO_AUTO_SYNC` **所有環境預設 false**：正式站招生開關已開，若預設開會在部署當下匯入約 185MB，要等使用者確認 Railway PG 空間後手動打開。
- 頻率：每天檢查一次；資料表空時立刻匯入；門牌、幼兒園各自超過 30 天未成功更新才下載。
- 門牌：從資料集頁找最新月份的 `File/DirectDownload/<guid>`（找不到本年度資料集時退回搜尋前一年度）；`WEBSITE_GEO_DOORPLATE_URL` 可直接指定檔案網址。串流下載＋逐列解析＋分批 `COPY` 進新版本，全部成功才更新 `active_version` 並刪舊版本；任何失敗保留舊版本、寫 `last_error`。不落地、不整檔讀進記憶體。
- 幼兒園：下載 `preschools.json`、濾高雄市營業中、整批換新。
- 換版後觸發 6.1 的重算。
- CLI：`python -m app.cli geo-sync [--doorplates-file PATH] [--kindergartens-file PATH] [--force]`，平台改版或抓不到時的手動退路。
- 測試與開發：不連外；測試用 `backend/tests/fixtures/geo/` 的小樣本（數百列門牌、十幾所幼兒園）。

## 8. API

皆在 `prefix=/api/website/v1`、招生開關底下；權限 `_require_campus(user, "admissions.read", campus_key)`；只讀、不寫稽核；回應只有聚合數字與公開園所資料，不含任何家長個資。

### 8.1 `GET /admin/admissions/area`

參數：`campus_key`（必填）、`school_year`、`semester`（同 `/stats`，沿用 `_base_filters`）。

回應 `AdmissionsAreaOut`：

- `as_of`、`filters`
- `data_status`：`doorplate_version`、`doorplates_synced_at`、`kindergartens_synced_at`、`boundary_version`
- `campus`：`key`、`name`、`lat`、`lng`；比對不到時座標為 null 並帶 `locate_error`
- `totals`：`visit`、`with_address`、`village_level`、`district_level`、`unlocated`、`pending`、`unlocated_reasons: [{reason, count}]`
- `districts: [{district, visit, deposit, visit_to_deposit_rate}]`，依參觀人數降冪、區名排序
- `villages: [{district, village, village_code, visit, deposit, visit_to_deposit_rate}]`
- `distance_bands: [{band, visit, deposit, visit_to_deposit_rate}]`，固定五列依序

計數與比率沿用 `stats.py` 的 `COUNT_FIELDS` 與 `pct`（分母 0 回 null）。`village_code` 由里界資料的 `TOWNNAME`＋`VILLNAME` 對應。

### 8.2 `GET /admin/admissions/area/kindergartens`

參數：`campus_key`（必填）、`radius_km`（1／3／6，預設 3）。回應：`synced_at`、`source_note`、`items: [{id, name, kind, pre_public_period, address, lat, lng, distance_m, approved_capacity, monthly_fee_estimate, has_penalty, phone, is_own}]`，依距離排序。`is_own`：與任一校區座標相距 50 m 內，畫面標「本機構」、不算競爭園所。校區座標未定位時回空清單與原因。

### 8.3 `GET /admin/admissions/area/boundaries`

回 5.6 的 GeoJSON；`ETag`＋`Cache-Control: private, max-age=86400`。

### 8.4 訪視明細篩選

`GET /admin/admissions/records` 新增 `district`、`village`（字串完全相等）與 `geo=no_village`（未定位到里：`match_level` 為 `district`、`unlocated` 或 `pending`）。

### 8.5 訪視回應

`RecruitmentVisitOut` 新增 `geo: {village, match_level, unlocated_reason, distance_m} | null`（給明細展開列）。

## 9. 後台畫面

### 9.1 子分頁

`StatsTab.vue` 新增「區域分析」，`name=stats-area`，`useAdmissionsFilters.ts` 的 `STATS_SUBS` 加 `area`（網址 `sub=area`）；順序同園務：總覽、班別、來源、接待、**區域**、未預繳原因、五校比較。`lazy`，點開才呼叫 8.1–8.3。換頁首篩選時重讀（沿用 `useRequestSequence`）。

### 9.2 版面（桌機）

1. **狀態列**：「門牌資料 115 年 10 月・幼兒園 10/08 更新」與「有地址 42 筆：38 筆到里、4 筆未定位到里（2 筆只到區、2 筆查無門牌）（查看）」，「查看」跳明細 `geo=no_village`。
2. **第一列**：左地圖（約 3/5）、右附近幼兒園清單（約 2/5）。
3. **第二列**：行政區排行、里排行、距離分布三張 `StatsDimensionTable`（欄位：區域／參觀人數 bar／預繳人數／預繳率；表頭用語同其他子分頁），各自可匯出 CSV；每列有「查看」鈕（`StatsDimensionTable` 新增 `actionLabel` prop 與 `action` 事件，不匯出到 CSV），跳訪視明細並帶區域篩選。

### 9.3 地圖（`AreaMap.vue`，Leaflet 動態 import）

- 底圖：國土測繪 EMAP；右下標「© 國土測繪中心」。
- 里界：依參觀人數分 5 級著色（顏色走 token、0 筆不上色、半透明）；hover 顯示里名（桌機）；點擊彈出「三民區鼎金里・參觀 5・預繳 2（40.0%）・查看明細」。
- 本校：SVG divIcon 星號；1／3／6 km 虛線圓（跟著清單的半徑選擇）。
- 幼兒園：依類型上色的小圓點（`circleMarker`），可開關；點擊彈出名稱、類型、距離、核定人數。
- 初始視野：本校為中心、半徑 6 km 範圍；校區未定位時 fit 高雄市里界。
- 不載 Leaflet 預設圖示檔；Leaflet CSS 隨 chunk 打包。
- 手機：地圖高約 50vh；預設不攔截單指捲動（`dragging` 關、`touchZoom` 關），點「移動地圖」後才可拖曳縮放，再點「完成」恢復。

### 9.4 附近幼兒園清單（`NearbyKindergartens.vue`）

- 搜尋（名稱、地址）、類型 chip（公立／非營利／準公共／私立）、半徑 1／3／6 km。
- 每列：名稱（去掉「高雄市私立／市立」前綴）、類型、距離、核定人數、月費（估）、有裁罰時顯示標記；本機構標「本機構」。
- 點列：地圖移過去並打開該點的彈出框。展開：地址、電話、準公共期間、全國教保資訊網連結。
- 先顯示 20 筆，其餘按「顯示更多」。
- 底部：「資料來源：全國教保資訊網（kiang 整理），月費為估計值」。

### 9.5 空狀態與錯誤（DESIGN 規則：寫原因、不顯示假 0）

- 範圍內沒有訪視：沿用其他子分頁的空狀態。
- 有訪視但都沒有地址：「這個範圍的訪視都還沒填地址」。
- 門牌未匯入（`doorplate_version` 為 null）：「門牌資料尚未匯入，匯入後會自動比對」；表格照常顯示（全部歸待比對）。
- 校區未定位：距離表改顯示原因；地圖 fit 高雄市。
- 里界或圖磚載入失敗：地圖區顯示錯誤與重試，表格不受影響。

### 9.6 訪視明細

- 展開列「地址」下多一行：`三民區鼎金里・距本校 1.2 km`、`三民區（里有歧義）`、`未定位：查無門牌` 等。
- 區域篩選：明細上方常駐提示列「區域：三民區鼎金里」／「區域：未定位到里」＋「顯示全部」（比照 `vr` 預約篩選；區域沒有對應下拉，放進篩選 chip 列在收合「更多篩選」時會被一起收掉）；網址 `area`（沿用 `useAdmissionsFilters`）。

### 9.7 CSP

`web/server/utils/security-headers.ts`：只對 `/admin` 路徑的 `img-src` 加 `https://wmts.nlsc.gov.tw`；公開站不變。

## 10. 個資與保存

- 家長地址只在官網資料庫內比對；比對與同步的 log 不記地址，只記等級與原因。
- 唯一的外部請求是地圖圖磚（只含視野範圍，不含家長資料）與同步工作下載公開資料。
- `recruitment_visit_geo` 不存家長座標，距離取整到 100 m。
- 匿名化（`retention.py` `anonymize_visit`）：既有清 `address`；新增把 `recruitment_visit_geo` 的 `village`、`distance_m` 清空、`match_level` 改為 `district`（有行政區時）或 `unlocated`（沒有時）、`unlocated_reason=anonymized`；`recruitment_visits.district` 保留（同園務、同既有行為）。
- 地圖與表格只呈現里層級聚合；後台人員本來就看得到明細地址，不另做小數量抑制。

## 11. 與園務的相容性

- `district` 開始有值，語意同園務（行政區字串）；`export.py` 已匯出，不改。
- `recruitment_visit_geo`、`geo_*` 為官網專用，不進 `contracts/ivy-recruitment`。
- `contracts/ivy-recruitment/README.md` 第 10 點（官網不做行政區）改寫為新做法，並註明併入園務時：園務 `district` 由後端 regex 解析、官網由門牌比對，兩者口徑要擇一。

## 12. 文件回寫

- 招生規格 §3.2、§9.3、§10、§12.3：標註「2026-10-08 使用者裁定改做區域分析，見本規格」。
- DESIGN.md 招生章節：新增區域分析規則（資料來源、精度、無同意勾選、不送第三方、地圖用色）；「圖一律是表格＋CSS 長條，不裝圖表套件」補例外「地圖用 Leaflet，圖表仍不裝」；「不做」清單拿掉區域分析。
- `StatsTab.vue:19` 與 `backend/app/admissions/stats.py` 檔頭的「不做行政區」註解。
- `backend/.env.example`：`WEBSITE_GEO_AUTO_SYNC`、`WEBSITE_GEO_DOORPLATE_URL`。
- README 頂部日期段落；部署後 `deploy/README.md` 補紀錄與開啟同步步驟。

## 13. 部署

- migration 只新增表；部署後畫面顯示「門牌資料尚未匯入」。
- 開啟同步前置：確認 Railway PG 剩餘空間 ≥ 500MB（門牌一版約 185MB，換版時新舊兩版短暫並存約 370MB）。
- 開啟：Railway api service 設 `WEBSITE_GEO_AUTO_SYNC=true` → 重新部署 → 看 api log 的 geo-sync 結果與後台狀態列。
- 照 CLAUDE.md：不自行 push、不部署。

## 14. 測試與驗收

### 14.1 後端 pytest（真 PostgreSQL、獨立測試庫）

- 地址解析：至少 40 個案例（全形、之號、樓層、舊高雄縣、缺區、外縣市、「地區」型門牌、美術館里補字、中文數字巷弄、段號）。
- 比對：五個等級與里有歧義。
- `/area`：口徑（與 `/stats` 的參觀人數、預繳人數一致）、學年學期篩選、未定位原因加總、空校區、權限（editor／readonly 403、越權校區 404）、開關關閉 404。
- `/area/kindergartens`：半徑、排序、`is_own`、校區未定位。
- `/area/boundaries`：ETag。
- 同步：假 HTTP 成功才切換版本、失敗保留舊版本與 `last_error`、換版觸發重算；`WEBSITE_GEO_AUTO_SYNC=false` 不跑。
- 匿名化、明細篩選、`district` 拒收前端送值。

### 14.2 實際資料驗證（不進 CI）

以完整門牌 CSV 匯入本機測試庫，拿 kiang 高雄市 650 筆幼兒園地址跑比對：`exact`＋`nearby` ≥ 95%；結果寫進實作紀錄。

### 14.3 admin vitest

子分頁各狀態（9.5）、三張表、跳轉帶篩選、清單搜尋／類型／半徑、地圖元件（mock `leaflet`）、`sub=area` 進網址、明細比對結果與區域提示列。

### 14.4 stack e2e

一條：建立有地址的訪視 → 區域分析的里排行出現該里 → 點列跳到明細帶篩選。

### 14.5 驗收

`npm --prefix admin run typecheck`／test、`npm run contract:check`、後端全套 pytest、stack e2e；dev server 上用 Playwright 看桌機 1440 與手機 390。

## 15. 風險

| 風險 | 處理 |
|---|---|
| 高雄平台每年換資料集、每月換 guid、改版 | 自動找最新失敗只記錯誤、保留舊版；`WEBSITE_GEO_DOORPLATE_URL` 與 CLI 指定檔案為退路 |
| kiang 為單人維護的第三方鏡像 | 存進自己的 DB、不即時抓；中斷時保留最後一版 |
| 手填地址錯字多 | 明細顯示比對結果，人員可修正；未定位可篩出 |
| Railway PG 空間 | 同步預設關，確認空間後才開 |
| 里界與門牌版本差 | 里以門牌表為準 |

## 16. 待確認

- Railway PG 剩餘空間（開同步前）。
- 舊高雄縣鄉鎮名對照的完整性（實作時以 38 區清單核對）。
