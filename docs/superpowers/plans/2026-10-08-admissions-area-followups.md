# 招生區域分析：延後項目（任務審查與最終審查留下的，部署後再排）

日期：2026-10-08～10-11　分支：`feature/admissions-area-20261008`

來源：實作期間每個任務審查的 Minor 與最終整支審查的分級。最終審查把以下全部歸為「可延後」（Critical 0、Important 1 已修）。其中標「建議」的是審查者認為便宜、有空順手做的。

## 已修（不在此清單）

最終審查的 Important（幼兒園資料從未匯入顯示假 0）與 F1–F9 已在 `2919ed5f`、`7d3c9bdc`、`6e359d09` 修掉。

## 延後項目（依任務）

- **A1**：之N樓防護測試、U+2212 減號、小寫 f、4 字里名
- **A1**：「一百二十號」只吃到二十（百不在字集）；DeprecationWarning 來自 passlib／authlib 既有雜訊
- **A1**：「一百二十號」解成 20（百不在字集，建議遇百／千回 None）；lane/alley 無長度上限（下游寫入前要擋）；000068 前導零超 5 字回 None
- **A2**：projection.py docstring「橢球差公分級」用詞不準（實為基準實現差）；docstring 說 1e-9 但測試斷言 1e-6
- **A3**：test_geo_schema 的 CHECK 對照只比字串出現、未鎖 constraint 名稱集合；DB 約束測試只驗例外型別、未測 unlocated_reason 正反例；第一個測試綁三件事
- **A4**（建議合併前修，最終審查降為可延後）：kindergartens._int_or_none 遇浮點數放大 10 倍（15073.0→150730），月費靜默錯
- **A4**（建議合併前修，最終審查降為可延後）：doorplates／kindergartens 解析未檢查欄寬（street 40、village 16、pre_public_period 16）與座標是否在高雄範圍，一列超長會讓整批 COPY 失敗、每月同步都卡住
- **A4**：import_doorplates 清理失敗會蓋掉原始例外；幼兒園版本日期用 UTC（台北 00–08 點顯示前一天）；test_load_geo_samples_is_repeatable 未斷言 label
- **A5**（建議合併前修，最終審查降為可延後）：nearby 用 func.abs(number-n)<=30 用不到索引第 6 欄，改 number.between(n-30, n+30)（rematch 會跑幾千筆）
- **A5**：active_version 與 label 分兩次讀，換版瞬間可能一新一舊；nearby 同側等距跨里時靠匯入順序選邊；apply_visit_geo 清空測試斷言記憶體值未 refresh；併發測試只斷言無 geo 列；未測「忽略非使用中批次」與 rematch 寫距離路徑
- **A6**：follow_redirects 可被導到非 https；log 只記例外類別名（正式站難查，可加 exc_info）；頁面 regex 依賴 title 在 href 前；最新年度頁 HTTP 錯不退回前一年；_stream_rows 未 aclosing
- **A6**：_exclusive 解鎖只抓 Exception，連續兩次取消可能讓鎖隨連線外洩（可用 shield 或 BaseException＋invalidate）；隨機 GUID 檔名約 8.3% 仍誤判月份（lookbehind 可改排除英數）；WEBSITE_DB_POOL_SIZE=1 且無 overflow 時鎖連線會佔滿連線池
- **A7**：ETag 測試未比對 sha1 本身；_village_codes 重複鍵會靜默覆蓋（目前 0 重複）；village_code 未測跨區同名；README 重建指令用 /tmp
- **A8**：關閉順序 geo 迴圈排在媒體迴圈前（plan-mandated，最多多等 10 秒）；只要一種 skipped 就不記摘要；stop 逾時取消沒 warning；無 stop-during-sync 測試；conftest 未釘 geo_auto_sync=False；CLI main 分派無測試、failed 時不印原因
- **A9**：brief Step 2 用 /tmp/ivy-geo-report（應用 scratchpad）
- **B1**：records.py:58 docstring「也不丟例外」不精確（R20，B6 處理）；schemas MatchLevel/UnlocatedReason 手抄 geo 常數，建議加 get_args 對照測試；geo relationship 全域 selectin 讓匯出／看板／匿名化多一次 IN 查詢；測試檔預留 import 待 B2／B3 後確認；列表回應 geo、PATCH 帶 district 422、補建端點未單獨測
- **B2**：未測「只動本次匿名化的訪視」與重跑冪等（審查者一次性測試已證實）；synchronize_session fetch 同步未測；anonymize_visit docstring 第一段誤稱會清 geo
- **B3**：匯出測試未驗 row_count（列表／匯出一致）；缺區域篩選與學年學期組合測試；district/village 長度 422 未測；稽核 area 只記最細一種；district/village 未 strip；village 單獨用會跨區同名命中（C 下鑽要一併送 district）
- **B4**：test_area_totals_invariants_on_seed 建構上恆成立；odd-rows 測試註解誤稱 "-" 會被正規化掉（實為 no_doorplate）；row.active 與「沒地址也沒比對列」分支無測試；_data_status 重查 label；預留給 B5 的未用 import 待確認
- **B5**：If-None-Match 只認完全相同的強 ETag（W/、清單、* 不回 304）；boundaries 缺不相符 ETag 反例、304 未驗 Cache-Control、893 寫死；kindergartens 透傳欄位未完整比對；權限缺 readonly 與不存在校區、無「不寫稽核」斷言；本校 campus_point 算兩次；排序鍵與 nearby 重複；radius_km 非整數回預設 422 結構
- **B6**：records.py:68-70 docstring 斷行；三值 Literal 與 REASON_ORDER 兩份來源
- **C1**：api 層 import type 反向依賴 areaFormat.ts（C2 加函式時別對 api 做 value import）；VillageBoundaries geometry 型別寬鬆（C6 需轉型）；geo 窄型別無 @ts-expect-error 反向測試
- **C2**：areaFormat.test 多一條後端沒有的不變式（reasons 合計＝district_level＋unlocated）；kit 幼兒園座標與 distance_m 不對應、本機構距校區 80m＞50m；999m 顯示 1000 m；style.css 註解稱避開暖黃但本機構用品牌金；areaFilter 缺過長值案例；kit 未 satisfies 契約型別；shortDay 同名異義
- **C3+C4**：缺 RecordsTab CSV 匯出帶區域參數的元件測試；缺「顯示全部」→網址串接測試；filterKey 用原始 props.area；vr 與 area 提示列可並存、兩顆同名「顯示全部」；地址欄未 trim 的既有行為；visitGeoText 註解與呼叫端待比對規則有落差（C8 統一）
- **C5**：nameColumn 退路與空 columns 的 aria 未測；名稱缺值時 aria 為「查看明細：—」；手機上查看欄要橫捲到最右（C10 截圖確認）；emit payload 型別寬鬆（C8 接線需收窄）
- **C6**：ResizeObserver disconnect 與 narrow 重畫未測；canvas 無 aria 名稱、「完成」缺語境、多邊形不可鍵盤聚焦（表格／清單有等價路徑）、動態插入的 role=status
- **C6**：console.error spy 的 mockRestore 未放 finally；tileload/tileerror listener 銷毀時未 off；真實 Leaflet remove() 丟錯後重試可能 "already initialized"
- **C7**：搜尋比對帶前綴的完整名稱（輸入「高雄市」幾乎全中）、無 NFKC／大小寫正規化；新視窗連結只有 ↗ 無報讀說明；展開鈕無 aria-controls；搜尋／chip 變動不重設顯示更多；半徑測試用 vm.$emit；approved_capacity null 未測；others=0 時仍顯示搜尋與 chip
- **C8**：每次換校區／學期都重建 Leaflet 與 893 里界（設計取捨，地圖可常駐）；AreaTab 層缺幼兒園失敗隔離、連續換半徑丟舊回應、門牌未匯入表格照常的測試；.area-empty 虛線框與 .stats-empty 外觀不一；匿名化範圍是否顯示行政區表待業主
- **C10**（建議合併前修，最終審查降為可延後）：start-api.sh 未 unset WEBSITE_GEO_AUTO_SYNC／WEBSITE_GEO_DOORPLATE_URL（開發者 shell 有設時 stack 會連外）；e2e 無圖磚確實被攔且載入的正向斷言
- **C10**：waitForLoadState('networkidle')；name==='390' 分支；未定位校區分支無真瀏覽器 e2e
- **C11**：規格基準「正式站招生開關已開」沿用 10-05 規格記載，未再核對；品牌金與暖黃同色系辨識度待 C12 目視
- **C12**：390 里排行「查看明細」初始只露 7px、無可橫捲提示；1440 里表比行政區表低 23px、距離表右側留白；e2e 偶發逾時與 macOS 維護睡眠吻合（caffeinate 下全過）

## 最終審查另外列的 Minor（未修）

- 里界 GeoJSON 600KB 未壓縮（`routes.py` 的 `/area/boundaries`；規格寫的 gzip 約 130KB 尚未實現）；快取一天，影響有限。可預先 gzip 或掛 GZipMiddleware。
- `tests/test_geo_loop.py` 把 `run_geo_sync` 換成假的，「同步期間不佔交易」沒有驗到真同步；`sleep(0.3)` 期望至少兩次呼叫，負載高時有輕微 flaky 風險。
- 部署說明「回滾再上線」的清除 SQL：說明寫「規則同 retention.py」略誇大，實際只清還留著里或距離的列；「啟用前先補」那句沒再提醒不帶參數的 `geo-sync` 會連帶做首次約 100MB 的門牌下載（前文有寫）。
- 規格 §14.1 寫「共 247 個測試」，修正後已多約 20 個。
- 既有問題（非本分支引入）：「義華路二十之一號」解成 number=1；「六十八號之一」之號不認中文數字；「一百零八巷」之類具名巷對不到門牌表只能退到街路層級。

## 待業主／使用者決定

- 整個範圍都已匿名化時，要不要仍顯示行政區表（後端保留了 district；目前整個區塊藏起來並寫原因）。
- 正式站招生開關是否已開（規格沿用 10-05 的記載，未再核對）；`WEBSITE_GEO_AUTO_SYNC` 要開之前要確認 Railway PG 剩餘空間 ≥ 500MB。
- 與並行分支 `chore/admin-cleanup-20261008` 的 migration 撞 parent：兩支都合進 main 前，後合者要把自己的 migration `down_revision` 改接新的 head、解 `conftest` 的 TRUNCATE 衝突。
