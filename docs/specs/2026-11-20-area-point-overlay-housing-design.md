# 區域分析：任意點評估、五校版圖、各里房價租金（2026-11-20）

狀態：使用者 2026-11-20 核可（照設計做到開 PR、不推 main）。實作分支 `feature/area-point-overlay-20261120`，從 origin/main `bb4a7a47` 開。

## 1. 為什麼做

區域分析（`/admin/admissions-stats?campus=…&sub=area`）目前所有數字都以「本校」為圓心，只能回答「本校周邊長怎樣」。使用者 11-20 從擴充候選清單挑了三項：

1. **任意點評估**：在地圖上任意一點（或輸入地址）看半徑內的孩子、同業、托嬰、預售、異動、房價租金，用在第六校、分班、課後班選址，不限幼兒園。
2. **五校版圖**：五校在籍學生畫在同一張圖、各校一色，看哪些里兩校以上都在收、哪些里孩子多但五校都沒人。
3. **各里房價與租金**：實價登錄算各里房價中位數與整戶月租中位數，和既有的所得中位數並看。

## 2. 目標、非目標、反目標

**目標**
- 任意點的數字和本校、五校比較表**同一套計算**：同一個圓心算出來的數字三處一致。
- 五校版圖一眼看出重疊與空白的里。
- 房價租金和所得並列，口徑清楚（排除了什麼、幾筆、哪幾季）。

**非目標**
- 房價租金**不在地圖上色、不排序、不分級、不判讀**（使用者 11-20 選「同所得」；所得的 V9 裁定見 `docs/specs/2026-10-14-admissions-village-trends-design.md`）。
- 任意點不存檔、不命名、不做多點並排比較；只有一根圖釘，位置寫在網址。
- 不新增權限：區域分析所有路由都是 `admissions.stats`（只有 SUPER_ADMIN），五校版圖本來就只有總部看得到。
- 不在本案補匯國際、崇德、仁武的在籍清冊（照 `deploy/README.md`「在籍學生匯入」另做）；畫面老實寫哪幾校尚未匯入。
- 五校比較表（`AreaCompareTable.vue`）欄位不變。
- 不做預測、飽和度、競爭環、Google 評分與車程（已否決清單）。

**反目標（技術上能動也算失敗）**
- 任意點的數字和同圓心的本校數字對不起來。
- 候選點的地址送到任何外部服務，或寫進稽核紀錄、log。
- 五校版圖能看出個別學生的住處：沿用在籍點既有的 100 公尺取整（`Numeric(6,3)`／`Numeric(7,3)`），同校同格合併成一點，不帶班別以外的任何欄位。
- 房價把親友交易、預售屋交屋這類非市場價混進去。

## 3. 使用者已決定的事

| 日期 | 決定 |
|---|---|
| 11-20 | 做候選清單第 1、2、11 項 |
| 11-20 | 房價租金「同所得，不上色」：只進各里表、里卡片、CSV、任意點卡片 |
| 11-20 | 照本設計做到開 PR，不推 main；部署由使用者決定 |

## 4. 做法比較（Approaches）

**任意點的後端**
- A（採用）：在現有六支查詢（`query_opportunity`、`query_trends`、`query_peer_fees`、`query_babycare`、`query_changes`、`query_presale`）加關鍵字參數 `center`，給了就用它當圓心、略過「本校」專屬的部分。新模組只負責組裝。數字和單校畫面天然一致，改動集中。
- B：另寫一套「以點計算」的查詢。重複邏輯、日後兩邊漂移（反目標第一條），不採用。
- C：前端拿現有各端點逐支打。各端點都綁 `campus_key`，做不到任意點，不採用。

**房價資料**
- A（採用）：新表逐筆存（只存里、季、單價或月租、門牌鍵），查詢時算中位數。中位數不能跨季合併，也要支援合併里組與任意圓圈，只能存逐筆。
- B：同步時算好每里每季的中位數。合併組、圓圈範圍、近 4 季合計都算不出正確中位數，不採用。
- C：在 `geo_new_home_sales` 加價格欄位。那張表只收新成屋（完工 12 個月內），房價要全部住宅買賣，而且 10-14 規格 §8 刻意不存價格，不混用。

**五校版圖**
- A（採用）：新端點一次回五校的點與各里分校人數，前端新增一個地圖模式。
- B：前端對每校打 `/area/enrolled` 五次再自己合併。分校人數、空白里（要人口表）要在前端算，且五次請求；不採用。

## 5. 任意點評估

### 5.1 畫面

工具列（`AreaTab.vue` 的 `.area-toolbar`）在「範圍」之後加一組「地點」：
- 按鈕「放一個點」（切換鈕）。按下後游標變十字，**下一次**點地圖就放圖釘（這一下不選里），放完自動退出放點狀態。Esc 取消放點狀態。
- 地址輸入框（placeholder「輸入地址找位置」）＋「找」：用本機門牌比對定位，找到就放圖釘並把地圖移過去；找不到在輸入框下方寫原因（「找不到這個門牌」「不在高雄市」）。
- 有圖釘時多一顆「清除」。

地圖（`AreaMap.vue`）：
- 圖釘用 divIcon（Phosphor MapPin 的 path，和校區星形區隔），可拖曳；拖完更新位置。
- 圖釘外圍畫同一個範圍半徑的圈，樣式和本校圈不同（新 token `--area-point`，實線、不填色）。
- 本校的星形與圈照舊。

網址：`pt=<lat>,<lng>`（各取小數 4 位，約 11 公尺）。`areaView.ts` 解析與輸出；格式錯、超出高雄範圍（`geo/kaohsiung.py` 的 `KAOHSIUNG_LAT_RANGE`／`KAOHSIUNG_LNG_RANGE`）當沒帶。換地圖模式、換範圍都保留圖釘；換校區保留（圖釘不屬於校區）。

右欄（`AreaSidePane.vue`）優先順序：**選了里 → 里卡片；沒選里但有圖釘 → 地點卡片；都沒有 → 該模式的排行**。里卡片關掉後回到地點卡片。

地點卡片（新元件 `PointCard.vue`）：

```
這一點 3 公里內                       [清除]
三民區寶興里・最近的校區 義華 1.8 公里

                      這一點      義華
2–5 歲孩子             8,420     9,788
0–1 歲                 3,100     3,560
這一年淨增              +36       −52
幼兒園（私立／準公共／公立／非營利）  9／6／2／1   …
托嬰                     14        21
私立一般 3 歲一學期中位   …         …
在建預售（戶）          1,230      …
近 12 個月園所異動         1         2
房價中位數（萬元／坪）    29.9      27.4
整戶月租中位數（元）     18,500    16,800
常春藤在籍住在圈內   義華 40・明華 3   …

人口 115-10・收費 114 學年・實價 115S3（近 4 季）
```

- 第二欄是頁首選的校區、同一個範圍。本校沒座標時第二欄整欄寫「—」並在欄頭註明原因（沿用 `campusNotLocatedReason`）。
- 幼兒園家數**不含常春藤各校**（同 `is_own` 規則）；圖釘就在某校 50 公尺內時，那校也不算進去。
- 房價、月租不到 5 筆寫「—（N 筆）」。
- 「這一年淨增」算不出來時寫原因（沿用五校比較表的 `kids_unavailable` 文字）。
- 在籍那一列只列有匯入清冊且人數大於 0 的校；五校都沒匯入寫「尚未匯入清冊」；有匯入但圈內 0 位的校不列，最後一句補「其他已匯入的校 0 位」。
- 讀取中骨架；失敗顯示「讀不到這一點的資料」＋重試。
- 窄螢幕（工作台單欄）卡片照現有規則在地圖下方。

### 5.2 API

`GET /api/website/v1/admin/admissions/area/point?lat=&lng=&radius_km=&campus_key=`

- 權限：`require_scope(user, "admissions.stats")`；`campus_key` 選填，給了就照單校路由的 `_require_campus` 檢查。
- `radius_km` 用既有的 `_require_integer_radius`（1、3、6）。
- `lat`、`lng`：浮點數、在高雄範圍內，否則 422 `POINT_OUT_OF_RANGE`。進計算前四捨五入到小數 4 位（和網址一致，快取鍵穩定）。
- 只讀：不 flush、不 commit、不寫稽核。

回應 `AreaPointOut`：

```
as_of: datetime
radius_km: int
point: { lat, lng, district: str|None, village: str|None, village_code: str|None }   # village_at 點在哪個里
nearest_campus: { key, name, distance_m } | None    # 有座標的校區中最近的；都沒座標是 null
sources: {
  population_version: str|None,
  fee_school_year: int|None,
  housing: { latest: str|None, seasons: list[str], note: str }
}
rows: { point: AreaPointRowOut, campus: AreaPointRowOut | None }   # 沒給 campus_key 時 campus 是 null
```

`AreaPointRowOut`：

```
unavailable: "no_campus_point" | "error" | None
locate_error: str | None
children, infants, kids_net: int | None
kids_unavailable: str | None
kindergartens: AreaCompareKindergartensOut | None
babycare: int | None
fee_median: int | None                 # 私立一般 3 歲一學期公告收費
presale_households: int | None         # 預售建案沒匯入是 null
changes_12m: int | None
housing: { sale_median, sale_count, rent_median, rent_count } | None   # 實價沒匯入是 null；不到 5 筆中位數是 null、筆數照給
enrolled: list[{ campus_key, count }]  # 只列已匯入清冊的校（count 可為 0），順序同 CAMPUS_KEYS
```

`GET /api/website/v1/admin/admissions/area/locate?address=`
- 權限同上。`address` 去頭尾空白後 1–100 字，否則 422。
- 用 `matcher.locate(db, address, version=<使用中門牌版本>)`；`match_level` 是 exact／nearby 且有座標才算找到，回 `{ lat, lng, district, village, match_level }`；否則 404 `ADDRESS_NOT_FOUND`，`detail.reason` 是 `GeoMatch.unlocated_reason`（外縣市、查無門牌、門牌尚未匯入…）。
- 地址**不寫稽核、不進 log**（請求 log 若會記 query string，這支改用 POST body；實作時先查 `app` 的請求 log 會不會記 query，會就改 `POST /area/locate`，body `{address}`）。

### 5.3 後端做法

- `area.py` 加 `point_center(lat, lng) -> dict`：形狀同 `campus_out` 的回傳（`key=""`、`name="這一點"`、`locate_error=None`、`district` 由 `boundaries.village_at` 推）。
- 六支查詢加 keyword-only `center: dict | None = None`：
  - 給了 `center` 就不呼叫 `campus_out`／`campus_points[campus_key]`，直接用它。
  - `query_opportunity`：不呼叫 `visits_by_village`（參觀相關欄位維持 0／None），孩子數照算。
  - `query_peer_fees`：不找本校（`own`、`own_missing` 都 null、不排名）；`is_own` 仍用五校座標判斷。
  - `query_babycare`：`own_age2_monthly` 是 null。
  - `query_trends`：只支援 `kids_only=True` 搭 `center`（另加房價，見 §7.3）；`center` 搭完整模式時 raise `ValueError`（沒有呼叫端）。
  - `query_changes`、`query_presale`：只換圓心。
  - 不給 `center` 時行為**完全不變**（既有測試全過即證明）。
- 新模組 `backend/app/admissions/area_point.py`：
  - `point_row(db, center, radius_km)`：savepoint 包住（同 `area_compare._row`），依序呼叫六支查詢＋房價（§7.3）＋在籍點計數，組成 `AreaPointRowOut`。出錯回 `unavailable="error"`。
  - 在籍計數：讀 `EnrolledStudentPoint` 有座標的列，haversine 到圓心 ≤ 半徑的人數依 `campus_key` 加總；只列 `EnrolledRoster` 有的校。
  - `query_point(db, lat, lng, radius_km, campus_key)`：組 `AreaPointOut`；`campus` 列用 `campus_out` 當 `center` 再走同一個 `point_row`（本校沒座標 → `unavailable="no_campus_point"`）。
- **一致性**：測試要斷言「以某校座標當圓心的 point 列」和 `area_compare` 該校列的 children、kids_net、kindergartens、babycare、fee_median（＝私立中位數）、changes_12m 相同。

## 6. 五校版圖

### 6.1 畫面

- `MAP_MODES` 在「在籍學生」之後加 `campuses`，label「五校版圖」。網址 `map=campuses`。
- 點：每個（校區, 取整座標）一個 circleMarker，顏色依校區（新 token `--area-campus-yihua`、`-minghua`、`-chongde`、`-intl`、`-renwu`；key 以 `CAMPUS_KEYS` 實際值為準），多人的點半徑大一點（同 `drawEnrolled`）。五色要和 `--area-kind-*` 四種幼兒園類型色、`--area-chance`、`--area-kind-babycare` 分得開，並在白底對比 ≥ 3:1（圖形元件）。
- 里著色：依「這個里有幾校有在籍」——0 校不上色（`--l0`）、1 校 `--area-level-1`、2 校以上 `--area-level-3`。
- 圖例：五校色點＋校名＋人數；未匯入的校灰字「尚未匯入」。
- 本校星形照畫；其他四校也畫星形（小一號、用各校色），讓「點離哪校近」看得出來。
- 右欄（該模式的排行，沒選里時）兩段：
  1. 「兩校以上都在收的里」：里名、各校人數（色點＋數字）、合計，依合計降冪，全部列出。
  2. 「孩子多、五校都沒有在籍的里」：任一有座標校區 6 公里內、已匯入的校在這個里都 0 位，依 2–5 歲孩子數降冪取前 15；列孩子數、最近的校與距離。標題下一句「只算已匯入清冊的校：義華、明華」（依實際）。
  - 點清單的里 → 選里（沿用 `focusVillage`／`select-village`）。
- 里卡片：五校版圖模式下，「在籍」那一列改成各校分列（只列 > 0 的校）。
- 表格分頁不新增。

### 6.2 API

`GET /api/website/v1/admin/admissions/area/enrolled-overview`
- 權限：`require_scope(user, "admissions.stats")`；校區清單＝`CAMPUS_KEYS` 中 `covers_campus(user, key)` 的（同 `/area/compare`）。
- 回應 `AreaEnrolledOverviewOut`：

```
campuses: list[{ key, name, imported: bool, roster_date: date|None, total: int, placed: int, lat, lng }]
points:   list[{ lat, lng, campus_key, count }]            # 同校同格合併，不帶班別
villages: list[{ village_code, district, village, counts: dict[campus_key,int], total }]   # 只列 total>0
overlap:  list[同 villages 的列]                            # counts 裡 >0 的校 ≥2，total 降冪
gaps:     list[{ village_code, district, village, children, nearest_campus_key, distance_m }]   # 前 15
population_version: str | None
gap_radius_km: int   # 6
```

- 里歸屬：`EnrolledStudentPoint.district`＋`village` 經 `boundaries.village_code` 換代碼；對不到的不進 villages（照算進 points 與 total）。
- gaps：人口表（`GeoVillagePopulation`）的 2–5 歲（opportunity 的 `AGE_BAND`）；人口沒匯入 → gaps 空、`population_version` null；沒有任何校匯入 → gaps 空（「都沒人」沒有意義）。

## 7. 各里房價與租金

### 7.1 資料來源與篩選

來源：內政部不動產交易實價查詢服務網季檔 `https://plvr.land.moi.gov.tw/DownloadSeason?season=<季>&fileName=<檔>`，高雄市買賣 `e_lvr_land_a.csv`、租賃 `e_lvr_land_c.csv`（2026-11-20 實測 115S3：買賣 10,086 列、租賃 7,908 列；格式同 `geo/new_homes.py` 開頭說明：UTF-8 BOM、兩列表頭）。季別與「還沒出」的判斷沿用 `new_homes`（`season_url` 換檔名、`decode`）。

**買賣（H1）**，全部符合才收：
- 交易標的含「建物」；主要用途含「住」。
- 建物型態以「住宅大樓」「華廈」「公寓」「透天厝」「套房」開頭。
- 交易筆棟數（例「土地2建物1車位1」）的建物數 = 1。
- 備註不含：親友、員工、特殊關係、共有人、瑕疵、急買急賣、政府機關、債權債務、拍賣、含增建、未登記建物、毛胚、預售屋（預售屋交屋的價格是幾年前簽約時的價格）。
- 單價（元／坪）＝(總價元 − 車位總價元) ÷ ((建物移轉總面積 − 車位移轉總面積) ÷ 3.30579)，四捨五入到百元；淨面積 ≥ 10 m²、總價 > 0 才收。
- 115S3 實測：可用 4,108 筆、中位數 29.9 萬／坪。

**租賃（H2）**，全部符合才收：
- 交易標的含「房屋」；主要用途含「住」；出租型態 =「整棟(戶)出租」。
- 建物型態同 H1 的住宅清單。
- 備註不含：親友、員工、特殊關係。
- 月租＝總額元（> 0）。
- 115S3 實測：整戶出租 4,230 筆、月租中位數 18,500 元。

**存什麼**（新表 `geo_housing_deals`，一支 migration 只新增這張表）：
`kind`（sale／rent）、`serial`（編號；PK＝(kind, serial)）、`season`、`building_type`、`district`、門牌鍵（`street`、`lane`、`alley`、`number`、`number_sub`，同 `GeoNewHomeSale`）、`village`、`match_level`、`doorplate_version`、`unit_price`（買賣，元／坪）、`monthly_rent`（租賃，元）。
**不存**：地址原文、樓層、總價、面積、交易日、格局、建案名稱。

**比對**：地址解析與門牌比對完全沿用 `new_homes`（`_address`、`match_keys`、`_district_of`）；門牌換版時和新成屋一起重比（`rematch`）。

**同步**：
- 資料集 key `housing`（`geo_dataset_status`），label＝最新季；系統狀態頁標籤「房價租金」。
- 保留最新 4 季。找最新季沿用 `discover_new_home_seasons` 的邏輯（可抽共用）。一季要**買賣與租賃兩個檔都拿得到**才寫（同一個交易刪掉該季再寫）；少一個就跳過那一季。
- 換版門檻：該季買賣可用筆數 < 1,000 或租賃 < 1,000 就不寫、記 `last_error`（殘缺檔）。
- 排程同新成屋（`_series_due`，30 天），CLI 支援 `--force` 與離線檔案（檔名帶季別，例 `115S3_e_lvr_land_a.csv`／`115S3_e_lvr_land_c.csv`）。

### 7.2 計算

- 里：近 4 季、`match_level` 在 `VILLAGE_LEVELS` 的筆數；買賣取 `unit_price` 中位數、租賃取 `monthly_rent` 中位數；**少於 5 筆中位數是 null**、筆數照給。
- 合併里組（`trends` 的 `group:` 單位）：組內各代碼的交易合併後算（不同於所得的整組 null）。
- 圓圈（任意點與本校欄）：里界重心在半徑內的里的交易合併後算（同 `trends` 的 `near`）。
- 中位數：新寫 `housing.median(values, minimum=5)`，偶數筆取中間兩筆平均後四捨五入到整數（見 §11 第 5 條）。

### 7.3 API

- `/area/trends` 每個里列加 `housing_sale_median`、`housing_sale_count`、`housing_rent_median`、`housing_rent_count`；`sources` 加 `housing: { latest, seasons, note }`。`kids_only` 不讀（五校比較不受影響）。
- 任意點的 `housing` 用同一個函式（`trends.py` 新的 `_housing(db, codes)`，或 `geo/housing.py` 的查詢函式）。

### 7.4 畫面

- 各里表（`villageTable.ts`）在「所得中位數」之後加兩欄「房價中位（萬／坪）」（例 `29.9`）、「整戶月租中位」（例 `18,500`）；不到 5 筆寫 `—`。**不加排序選項**。
- CSV 加四欄：房價中位數（元／坪）、房價筆數、月租中位數（元）、月租筆數，另在備註寫季別範圍與排除條件。
- 里卡片（`villageFacts.ts`）在所得之後加兩列，detail 寫「近 4 季 N 筆」。
- 表格下方資料來源加一句：「房價、月租：內政部實價登錄近 4 季（115S4～115S3），排除親友、特殊關係、預售屋交屋等非一般交易；房價扣除車位」。
- 地圖不著色（使用者決定）。

## 8. 測試

- 後端
  - 房價解析：假資料 fixture（公司名、地址一律虛構）涵蓋每條排除規則、車位扣除、建物數 ≠ 1、套房、租賃非整戶、筆數門檻、只有一個檔的季跳過、保留 4 季。
  - `center` 參數：不給時既有測試全過；給本校座標時和不給的結果在共用欄位上相同。
  - `/area/point`：權限（非 SUPER_ADMIN 403）、範圍外 422、本校沒座標、campus 列和 `area_compare` 同校列一致、在籍計數、房價少於 5 筆。
  - `/area/locate`：找到、找不到、門牌未匯入、超長地址；確認地址不出現在稽核表。
  - `/area/enrolled-overview`：兩校匯入、一校匯入、都沒匯入、gaps 的 6 公里與前 15、人口未匯入。
  - `/area/trends` 新欄位與合併組。
- 後台（vitest）：`areaView` 的 `pt` 解析輸出、`PointCard` 各狀態、五校版圖圖例與右欄清單、各里表新欄與 CSV、里卡片新列。
- stack e2e（`tests/stack/admissions-area.spec.ts`）：放圖釘看到卡片、輸入地址、切到五校版圖。
- 契約：`npm run contract:generate`、`contract:check`。

## 9. 部署

- 一支 migration，只新增 `geo_housing_deals`，不改既有資料 → 不需要備份閘門。合併前 fetch main 看有沒有新 migration（避免兩個 head）。
- 上線後自動同步一天內會抓最近 4 季；要立刻有資料就由使用者 `!` 跑 `geo-sync --force`（指令寫進 `deploy/README.md`）。
- Railway 連得到 plvr（新成屋同步已在用同一個網址）。

## 10. 留給實作者決定（寫在這裡的是建議）

- `--area-campus-*` 五色的實際色值（守上面的對比與區隔規則；寫進 `admin/src/style.css` 的 `--area-*` 區塊並附一行理由）。
- 地址定位用 GET 或 POST（看請求 log 會不會記 query string）。
- `discover_new_home_seasons` 是否抽成共用。
- CLI 旗標名稱。

## 11. 寫稿者裁定（實作者視角檢查後，2026-11-20）

這些是寫稿者的決定，不是使用者裁定；使用者看 PR 時可推翻。

1. **`/area/point` 不做伺服器快取或限流**：前端只在放下圖釘、拖曳結束、按「找」時送，並用 `useRequestSequence` 只採最後一次回應；半徑 6 公里一次約十來個查詢，總部帳號人少，不值得多一層快取（§5.2「快取鍵穩定」那句只是取整的理由）。
2. **房價里級覆蓋率接受大量「—」**：實價登錄 2.0 的買賣與租賃門牌都到號（115S3 租賃 7,908 筆只有 1 筆是區間門牌），新成屋同一份檔比對到里 98.9%～99.9%，所以瓶頸是筆數不是比對。市區的里近 4 季多半 ≥ 5 筆，偏鄉多半「—」，這是預期結果。實作完用本機真資料量「≥ 5 筆的里數」寫進 PR，不調門檻。
3. **「孩子多、五校都沒有在籍」的範圍**（§6.2 gaps）：候選里＝**已匯入清冊的校**中任一校 6 公里內；再排除「五校中最近的校是**尚未匯入**的校」的里（那是別校的腹地，我們沒資料，不能說沒人）。「最近的校」欄位從五校挑。只有義華匯入時，靠近仁武的里因此不列。
4. **`geo_housing_deals` 主鍵 `(kind, serial)`**：照 `new_homes.replace_season` 的寫法，先刪該季再以 `(kind, serial)` upsert，`where 舊列.season < 新列.season`（更正案件在較新的季就覆蓋，較舊的季不蓋新的）。
5. **中位數另寫**：`geo_fees.median`（`geo/fees.py:131`）少於 3 筆回 None，不適用；新寫 `housing.median(values, minimum=5)`：少於 5 筆回 None，偶數筆取中間兩筆平均四捨五入。§7.2 最後一句以此為準。
6. **`/area/locate` 用 GET**：API 的 uvicorn 存取紀錄已拿掉查詢字串（`backend/app/logging_config.py:8-11` 的 `StripQueryString`），應用層 log 只印 path（`main.py`）。Nuxt 同源代理不記查詢字串（實作時再確認 `web/server` 的代理；若會記，改 POST）。
7. **季檔下載**：`new_homes.season_url` 加 `file_name` 參數（預設 `e_lvr_land_a.csv`，既有呼叫不變）；`discover_new_home_seasons`（`geo/sync.py:1716`）只看買賣檔有沒有出，房價沿用它找最新季，再逐季抓租賃檔；`KEEP_SEASONS` 房價自己一個常數 4。
8. **`village_at(lng, lat)`** 參數 lng 在前、只回代碼；名稱用 `boundaries.village_names()[code]` 反查（district, village）。
9. **六支查詢的簽名**：`campus_key` 改成 `str | None`，`center` 給了就不讀 `campus_key`；`campus_key` 與 `center` 都沒給時 raise `ValueError`。`query_kindergartens` 不在任意點範圍內（家數用 `query_peer_fees` 的 groups，同五校比較表），不改。
10. **`MAP_MODES` 順序**：「在籍學生」是第一個，`campuses` 放第二個（緊接在籍學生）。
11. **租賃也要主要用途含「住」**（Task 1 實作時補）：§7.1 實測的 4,230 筆／18,500 元就是加了這條；不加是 4,640 筆／18,000 元（混進店面住商）。
12. **不存 `village_code`**：同 `GeoNewHomeSale` 只存（區, 里）名稱，查詢時用 `boundaries.village_code` 轉；里界換版時不必回寫代碼。
