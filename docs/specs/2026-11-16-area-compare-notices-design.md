# 區域分析：人口年份滑桿、五校並排、園所異動通知（設計）

- 日期：2026-11-16
- 狀態：已核可（11-16）、已實作（`feature/area-compare-notices-20261116`，未合併、未部署）
- 基準：`origin/main` `9db3ce17`
- 工作分支：`feature/area-compare-notices-20261116`（worktree `~/Repositories/ivy-website-wt/area-compare-notices-20261116`）
- 相關規格：區域分析 `2026-10-08-admissions-area-design.md`、招生機會 `2026-10-13-admissions-opportunity-design.md`、里的變化 `2026-10-14-admissions-village-trends-design.md`、園所異動 `2026-10-14-provider-changes-design.md`、同業比較 `2026-10-15-peer-comparison-design.md`、地圖工作台 `2026-10-16-admissions-area-workbench-design.md`、招生潛力 `2026-10-20-admissions-potential-share-design.md`

## 1. 為什麼要做

招生統計的區域分析（`/admin/admissions-stats?campus=…&sub=area`）目前所有功能都停在「看單一校、看現在」。業主 11-16 從候選清單挑了三項：

1. **人口年份滑桿**：2–5 歲著色只有最新一個月。各里歷年九月人口從 107 年起已經在庫裡，卻沒有地方看「這個里這幾年孩子變多還是變少」。
2. **五校並排**：總部要比五校周邊環境只能一校一校切，記數字再自己比。
3. **園所異動通知**：附近新設、停辦、類型變動、裁罰每 7 天同步一次，但要自己點進來才看得到；單一校 3 公里內一年只有 0～1 件，很容易錯過。

## 2. 目標、非目標、反目標

**目標**
- 在「2–5 歲孩子」模式拉年份，從 107 年九月看到最新一個月，各年份的著色能直接比較。
- 一張表比五校在同一半徑內的 2–5 歲人口、一年增減、附近幼兒園（分類型）與托嬰家數、本校 3 歲收費排名、近 12 個月異動件數。
- 五校各自 3 公里內出現新的園所異動或裁罰時，總管理者在「站內通知」看得到，一件事一則。

**非目標**
- 滑桿不套用到其他模式（參觀、招生機會、孩子增減、在籍學生等）；里卡片與表格照舊只顯示最新資料。
- 五校並排不做排名、不打分數、不給「哪校最有機會」的結論。
- 通知不寄 Email、不發 LINE、不推播；沒有個人層級的開關或訂閱設定；評鑑結果不通知。

**反目標（做了也算失敗）**
- 分校管理者或接待看到這些通知（招生統計 10-16 起只給總部，`admissions.stats`）。
- 上線第一輪把現有一年份異動和全部歷史裁罰一次塞進通知。
- 滑桿換年份時色階跟著重算，結果每年看起來都差不多（看不出變化）。
- 把飽和度、競爭環、預測等已否決的判讀偷渡進來。

## 3. 業主已定的事（11-16）

- 三項都做，順序：滑桿 → 五校並排 → 通知。
- 五校並排放在既有的「五校比較」子分頁（`sub=compare`），接在招生件數表下面（不放在區域分析頁）。
- 通知出現在側欄既有的「站內通知」（校區通知），只有總管理者看得到這幾種；不用個人通知（那個只顯示在發布紀錄頁）。

## 4. 做法比較

| 項目 | 選項 | 取捨 | 採用 |
|---|---|---|---|
| 五校並排的位置 | A 五校比較分頁 / B 區域分析頂端折疊列 | A 比五校的人本來就去那裡、區域分析維持單校工作台；B 看地圖時能對照但頁面更長 | A（業主選） |
| 通知的出處 | A 校區通知（站內通知）＋依權限過濾 / B 個人通知 | A 現有頁面、依校區分組天然合適，要在列表與計數加權限過濾；B 收件人精準但入口藏在發布紀錄頁 | A（業主選） |
| 滑桿的色階 | 每年各自最大值 / 全部年份共用最大值 | 各自最大值每年看起來都一樣、看不出變化；共用最大值讓「最新」的圖例數字和現在略有不同 | 共用（寫稿者建議） |
| 通知去重 | 在既有表加欄位 / 另開記帳表 | 異動事件與「設立日新設」不在同一張表，裁罰整表重寫沒有「首次看到」欄位；另開一張記帳表最單純 | 記帳表 |

## 5. 人口年份滑桿

### 5.1 資料
- 來源表 `geo_village_ages_september`（`backend/app/admissions/geo/models.py`）：全高雄、每年九月底一批、民國 107 年起（`september.FIRST_YEAR`），欄位 `age_0..age_6`。107–108 年三民、鳳山舊里代碼在寫入時已換成現行代碼（`september.normalize`），換不到的（115-07 廢止的 12 個里）照原代碼存。
- 「最新」沿用 `/area/opportunity` 現在用的 `geo_village_population`（最新月份）。
- 2–5 歲＝`age_2+age_3+age_4+age_5`，與 `opportunity.AGE_BAND`、`share.KIDS_AGES` 同口徑。
- 範圍內的里沿用招生機會的定義：里界面積重心在本校半徑內（`boundaries.village_centroids`）。

### 5.2 API
新增 `GET /admin/admissions/area/children-history?campus_key=&radius_km=`（權限同其他區域端點：`_require_campus(user, "admissions.stats", campus_key)`；`radius_km` 只收 1、3、6）。回應：

```
{
  campus: AreaCampusOut,
  radius_km: 3,
  latest: { label: "115-10", synced_at },        // 最新月份；沒有人口資料時為 null
  years: [107, 108, …, 115],                      // 九月表裡實際有的年份，舊到新
  villages: [
    { village_code, district, village, distance_m,
      counts: { "107": 412, …, "115": 389, "latest": 380 },   // 某年沒資料＝null（例如 115-07 新設的里，之前各年都是 null）
      adjusted: ["115-07"] }                                    // 界線調整過的月份（見下），沒有＝[]
  ],
  retired: [ { village_code, district, village, last_year } ], // 有資料但現行里界沒有的代碼，只列和範圍內的里同一區的
  max_children: 512                                            // 範圍內所有年份＋最新的最大值，前端色階用
}
```

本校沒座標或九月表全空時，`villages` 為空並帶原因（沿用 `opportunityUnavailable` 的寫法與 `locate_error`）。

**里界調整（115-07 的實例）**：七區 21 里調整，例如仁武區廍北、廍南併成廍後，左營區福山分出福愛、福華、福榮（`geo_data/README.md` 有完整對照）。九月表只把 107–108 年三民、鳳山的舊代碼換碼，115-07 的調整沒有、也無法換碼（一個舊里拆給好幾個新里）。所以：
- 新設的里在調整前各年是 null，地圖畫成「沒有資料」的樣式，不硬湊數字。
- 已廢止的里畫不出來（現行里界沒有它），列在 `retired`；「同一區」用代碼前 7 碼判斷（廢止的里沒有重心，無法判斷是否在半徑內，文字要寫「同區」而不是「範圍內」）。
- 名字沒變、界線改了的里（福山、菜公等），代碼相同但前後年份不可比。`adjusted` 沿用里的變化（`trends.py` V5）的判斷：某月行政區域調整人數 ≥ 該里人口 1% 且 ≥ 20 人。月份歷史資料只保留 25 個月，更早的調整偵測不到，可以接受（107–108 的換碼已處理）。

### 5.3 畫面
- 只在「看什麼＝2–5 歲孩子」時出現，放在工具列「範圍」之後（同一個 `.area-toolbar__group` 結構）：

  ```
  年份  107 ── 108 ── … ── 114 ── 115.09 ──●最新(115.10)   ▶
  ```

- Element Plus `el-slider`（admin 還沒用過，要在 `admin/src/element-plus.css` 補 CSS，`elementPlusStyles.test.ts` 會檢查）。刻度標籤：九月年份寫「107」，最新寫月份。
- **預設停在「最新」**，畫面與現在一致（除了色階，見下）。
- ▶ 播放：每 1 秒前進一年，到最新停；拖滑桿、換模式、換半徑、換校區都會停止播放。`prefers-reduced-motion` 時不顯示播放鈕。
- 色階：`levelOf(count, max_children)`，所有年份共用；圖例照 `legendRanges(max_children)`。
- 右欄排行：依選的年份排序，每列值「N 位」，細節「比前一年 ±n」。第一年、前一年沒資料、或這兩個時間點之間有 `adjusted` 月份時不寫增減，改寫「界線 115-07 調整」。
- 里卡片、表格不跟著年份變（照舊顯示最新）；卡片上的 2–5 歲維持最新數字。
- 選到的年份裡，`retired` 有在那一年有資料的里時，地圖下方一行：「同區另有 N 個已廢止的里（廍北、廍南）有這年的資料，地圖上畫不出來。」
- 網址：新增 `year` 參數（`107`…或省略＝最新），由 `areaView.ts` 讀寫；只在 children 模式有效，換到其他模式時拿掉。
- 讀取時機：進入 children 模式才讀（不在 AreaTab 一掛載就讀），換校區、半徑清空重讀、只採用最後一次回應（`useRequestSequence`，同其他區塊）。讀取失敗：滑桿不出現、照常顯示最新（現有資料流不受影響），工具列原因列寫「歷年人口讀取失敗」。

## 6. 五校並排

### 6.1 API
新增 `GET /admin/admissions/area/compare?radius_km=3`（權限同既有 `/admin/admissions/compare`：`require_scope(user, "admissions.stats")`，校區取 `CAMPUS_KEYS` 中 `covers_campus` 的）。每校一列：

| 欄位 | 來源 | 備註 |
|---|---|---|
| `children` | 範圍內各里 2–5 歲合計（同 `/area/opportunity` 的 `baseline.children`） | |
| `kids_net` | 這一年淨增（同 `/area/trends` 的 `baseline.kids_net`） | 不能算時 null＋`kids_unavailable` |
| `kindergartens` | `{private, quasi_public, public, nonprofit}` 家數，**不含常春藤五校** | 以當下學年判定類型，同附近清單 |
| `babycare` | 範圍內托嬰家數 | |
| `own_fee` / `fee_median` / `fee_rank` / `fee_rank_total` / `own_kind` | 本校 3 歲學期總額；範圍內私立一般組的中位數；本校在私立一般組的排名（同 `/area/fees` 的 private 組） | 同業比較 10-15 的口徑是「只和私立一般比」，所以本校不是私立一般（例如準公共）時排名為 null，格子寫「本校準公共」，中位數照列；本校沒收費資料時寫 `own_missing` 的原因 |
| `changes_12m` | 近 12 個月異動件數（同 `/area/changes`） | |
| `unavailable` | 本校沒座標時的原因（`locate_error`） | 這一列其餘欄位 null |

- 實作盡量重用既有計算函式；`trends` 只需要 `kids_net`，不要為了這一欄跑完整份 trends（出生、遷入、新屋、預售、國小學區都不需要）——抽出只算 2–5 歲淨增的函式，單校與五校共用，確保兩邊數字一致。
- 五校逐校計算、各自成敗：一校出錯只有那一列寫原因，其他列照常；整支不回 500。

### 6.2 畫面
- `StatsTab.vue` 的「五校比較」分頁，招生件數表（`CompareTable`）下面加一張「周邊環境」表，表頭右側有範圍切換（1／3／6 公里，預設 3）。
- 這張表不吃頁首的學年學期（人口、園所都是當下資料），表下註明「人口為最新月份；收費為 3 歲、私立一般」。
- 欄：校區｜2–5 歲｜一年增減｜幼兒園 私立／準公共／公立／非營利｜托嬰｜本校 3 歲收費｜私立一般中位數｜排名（第 n 高／共 m）｜近 12 月異動。
- 點校區名 → 切到該校的區域分析（`sub=area`、`campus=<key>`、帶同一個半徑不需要，半徑本來就是畫面狀態）。
- 用 `StatsDimensionTable`（同 `CompareTable`），可匯出 CSV，檔名照 `csvFilename('招生統計', '五校周邊環境', '<n>公里', 日期)`。
- 讀取：進入五校比較分頁且分頁可見才讀，與招生件數表各自成敗。

## 7. 園所異動通知

### 7.1 什麼會發通知
每校（有座標的）3 公里內：

| 種類 | 來源 | 範例文字 |
|---|---|---|
| 新設／重新營業 | `nearby_changes` 的 `opened`（事件或設立日） | 義華 3 公里內新設：○○幼兒園（1.2 km，私立） |
| 停辦 | `closed` 事件 | 義華 3 公里內停辦：○○托嬰中心（0.8 km） |
| 類型變動 | `kind_changed` 事件 | 義華 3 公里內類型變動：○○幼兒園 私立 → 準公共（2.1 km） |
| 新公布的裁罰 | `geo_kindergarten_penalties`，園所在 3 公里內 | 義華 3 公里內裁罰：○○幼兒園（1.5 km，115-10-02） |

- 常春藤五校自己（距任一校 50 m 內，同 `OWN_CAMPUS_RADIUS_M`）不通知。
- 同一個園所同時在兩校 3 公里內 → 兩校各一則（通知依校區分組，總部按校區看）。

### 7.2 去重、首輪與時間窗
- 新表 `geo_change_notices`（記帳）：`id`、`campus_key`、`dedupe_key`（唯一，含校區）、`kind`、`created_at`、`notified`（bool；只記帳不發時為 false）。
  - 異動：`"<campus>:<provider>:<source_id>:<change>:<date>"`，`date` 取 `nearby_changes` 給的日期（同一所同一種它已經只留一筆、設立日優先）。另外同一（校區、provider、source_id、change）90 天內已經發過就不再發（防兩種來源日期不同時發兩則）。
  - 裁罰：一份處分書一則：`"<campus>:penalty:<school_name>:<occurred_on>:<doc_no>"`（同一份處分書引好幾條法條時合成一則，內文列出法條）。
- 新表 `geo_change_notice_baselines`：`(campus_key, kind)` 主鍵＋`established_at`。**首輪**＝這個校區這一種（異動／裁罰）還沒有基準列：這一輪把當下符合的全部記帳（`notified=false`）、寫入基準列，不發通知。有基準列之後，即使首輪 0 筆，下一件也照常通知。之後才有座標的校區同理。
- **時間窗**：有基準之後，日期太舊的也只記帳不發——異動日期早於 90 天前、裁罰處分日早於 365 天前。避免園所後來才定位進 3 公里、裁罰後來才對上園所、停辦回補等情況把舊事一次湧進來。
- 停辦後 30 天內恢復營業：停辦事件會被刪掉；已發的停辦通知不撤回、也不另發「恢復」通知（寫稿者決定，見 §11）。

### 7.3 什麼時候檢查
- `run_geo_sync` 最後（`rematch_if_changed` 之後、回傳 `GeoSyncResult` 前），自己開一個 session、一個交易：寫通知與記帳一起 commit。
- 每輪都檢查（自動同步每天一輪；冪等，沒新東西就什麼都不寫）。CLI `geo-sync` 走同一條路。
- 失敗只記 log（含 traceback）與 `GeoSyncResult` 的新欄位 `notices`（"updated" | "skipped" | "failed"）＋發了幾則，不讓同步本身失敗。

### 7.4 寫進哪裡、誰看得到
- 直接寫 `NotificationInboxItem`（`campus_key`＝那一校、`kind`＝`area_provider_change` 或 `area_penalty`、`payload` 帶顯示所需：名稱、類型、新舊類型、距離、日期、`provider`、`source_id`）。不經 outbox（outbox 綁預約案件），也不推播（`PUSH_KINDS` 不加）。
- 權限：`notifications/routes.py` 的 `_inbox_scope`（列表與計數共用）與「全部標為已讀」對沒有 `admissions.stats` 的使用者排除這兩種 kind（帶 `campus_key` 查也一樣，直接不回，不報 403）。單筆標已讀拿 id 硬打回 404（同查無此則）。總管理者按「全部標為已讀」時這兩種一起標掉。
- 已讀狀態是全校共用（現有設計），總部多人共用一份已讀，可以接受。
- 後端 `_KIND_LABELS` 加兩種的標題；前端 `NotificationsView.vue` 的 `KIND_META` 加圖示與色調（Phosphor，異動用建築類、裁罰用警示類，色調 info／warning），內文由 payload 組；連結到 `/admissions-stats?campus=<key>&sub=area&map=peers`（裁罰另帶開該園所紀錄的方式，若現有網址參數做不到就只開同業模式）。

## 8. 權限、開關、操作紀錄
- 三支新端點與兩種通知都只給 `admissions.stats`（總管理者）；`tests/test_permission_table.py` 規則照守（不在路由寫角色判斷）。
- 讀取端點不寫稽核（同其他區域端點）。
- 通知檢查在 `WEBSITE_GEO_AUTO_SYNC` 關閉時不會自動跑（同步本身不跑），CLI 手動同步仍會檢查。

## 9. 資料與 migration
- 一支 migration：只新增 `geo_change_notices`、`geo_change_notice_baselines`。不改既有資料，不需要部署前備份閘門。`down_revision` 接當時 main 的 head。
- 其他兩項不動資料表。

## 10. 測試與驗證
- 後端：children-history（年份齊全、某年缺、新設的里前幾年 null、已廢止的里只列同區、界線調整標記、本校沒座標、半徑邊界、權限 403／404）；area/compare（五校各自成敗、`kids_net` 與單校 trends 一致、家數排除本機構、收費與 `/area/fees` 一致、本校準公共、只回可見校區）；通知（首輪只記帳且寫基準、首輪 0 筆後下一件照發、第二輪只發新的、超過時間窗只記帳、兩校重疊各一則、本機構不發、同處分書多法條一則、90 天內同事不重發、同步失敗與通知失敗互不影響、非總管理者列表／計數／全部已讀／單筆已讀都看不到或改不到）。
- 前端：滑桿（只在 children 模式、預設最新、共用色階、播放停止條件、網址 year 讀寫、失敗退回）、排行「比前一年」、周邊環境表（欄位、CSV、點校區切換、失敗隔離）、通知列表的新 kind 文字與連結。
- 契約：`npm run contract:generate`／`contract:check`。
- 跑：後端全套（專屬測試庫）、`npm --prefix admin run typecheck`、`test:unit`、`npm run test:website`、stack e2e 招生相關；dev server 上用 Playwright 看桌機 1440 與手機 390（滑桿、五校表）。

## 11. 寫稿者自己做的決定（請業主過目）
1. 滑桿色階所有年份共用最大值（「最新」的圖例數字會和現在略有不同）。
2. 滑桿只在 2–5 歲模式，里卡片與表格不跟著年份變。
3. 有播放鈕，1 秒一年。
4. 五校表的收費只看 3 歲、和私立一般比（同業比較 10-15 的口徑）；本校是準公共時排名寫「本校準公共」，中位數照列。
5. 通知半徑固定 3 公里，不提供設定。
6. 停辦後又恢復，不撤回、不另發通知。
7. 評鑑結果不通知。
8. 首輪只記帳不通知；之後異動超過 90 天、裁罰超過 365 天的舊事只記帳不通知。
9. 同一份裁罰處分書一則通知（多條法條合併）。
10. 滑桿遇到 115-07 里界調整：新設的里在調整前畫成沒有資料、廢止的里只在地圖下方列名、界線改過的里不寫跨調整的增減。

## 12. 留給實作的
- 抽 `kids_net` 單獨計算的函式邊界（合併組 merged 的處理要和 trends 完全一致）。
- children-history 的 `latest` 欄與 `/area/opportunity` 的資料來源一致的方式（同一個 status label）。
- 通知 kind 是一種還是兩種、payload 欄位命名。
- NotificationsView 裁罰連結能不能直接開該園所紀錄。

### 實作裁定（2026-11-16）
- `kids_only` 抽在 `query_trends` 內（跳過所得、新屋、預售、國小學區），不另寫一支函式；合併組、`kids_unavailable` 與單校完全相同（`test_kids_only_matches_full`）。
- children-history 的 `years` 取整張九月表的年份（不是只看範圍內），範圍內某年缺資料的里該年是 null；`latest` 與 `/area/opportunity` 同用 `population_status`。九月表全空 → `unavailable="no_history"`。
- 通知 kind 兩種：`area_provider_change`、`area_penalty`（`notifications/area_kinds.py`）；payload 欄位見 `geo/notices.py`。排除本機構時異動靠另查園所座標（`nearby_changes` 不回座標）。
- 前端 `yearChangeText` 多一個選填參數 `latestLabel`（最新月份），才能判斷「最新」那一格與前一格之間有沒有界線調整；`PaneData.childrenHistory／childrenStop` 設為選填。
- 裁罰通知連結只開該校區域分析的同業模式（現有網址參數沒有「開某園所紀錄」）。
- 前端測試要用 Node 22（`.nvmrc`）；Node 25 會因 `localStorage.clear` 讓 sidebar 等檔假紅。

