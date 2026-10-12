# 招生統計「預繳速度」與「可能範圍」設計

日期：2026-10-12
狀態：已實作於分支 `feature/admissions-deposit-pace-20261012`，**未部署**
對象：業主、接手實作的 Claude
基準：`origin/main` `f09ad269`（招生入學、區域分析都已部署；本功能不加 migration）

前置文件：

- 招生入學：`docs/specs/2026-09-30-website-admissions-design.md`（以下稱「招生規格」），統計在第 9 節。
- 區域分析：`docs/specs/2026-10-08-admissions-area-design.md`。
- 轉移契約：`contracts/ivy-recruitment/README.md`「刻意與園務不同的地方」。
- 招生分析報告：`docs/analysis/2026-09-30-enrollment-analytics-report.md`（第 34 行「不做 AI 意願評分、招生預測」；本規格不做這兩項，見 §3.2）。

## 1. 背景與目標

招生統計（`/admin/admissions?tab=stats`）的判斷目前全是照抄園務的固定規則，有兩個會誤導人的地方：

1. **時間還沒到，被當成表現差。** 「本月漏斗轉換下滑」拿最新月份的參觀轉預繳率跟上個月比（`backend/app/admissions/stats.py` `_alerts`、`query_stats`）。最新月份的家長多半才參觀幾天，還沒到會預繳的時候，所以這個比率天生偏低，月初特別容易誤報。「來源結構失衡」也一樣：剛開始投放的新來源，家長都還沒到預繳的時候，預繳率看起來就偏低。
2. **筆數太少，被當成差異。** 各表只列原始預繳率，3 筆裡 3 筆預繳就寫 100%，看不出這個數字有多不可靠。

### 1.1 成功標準

1. 月初、新來源剛投放時，不再因為「家長還沒到預繳時間」而發出警示；真的比過去慢時照樣發。
2. 班別、來源、帶參觀老師、行政區、里、距離帶、五校比較的預繳率旁邊，看得到「可能範圍」。
3. 統計總覽看得到「家長參觀後通常幾天內預繳」。
4. 不改資料表、不加套件；家長資料匿名化後照樣能算。

## 2. 已裁定事項（2026-10-12 使用者）

| # | 事項 | 裁定 |
|---|---|---|
| P1 | 範圍 | 做「預繳速度」（曲線＋兩個警示改判斷）與「可能範圍」；不做追蹤優先序分數、註冊數預測、機器學習評分 |
| P2 | 樣本數提示 | **推翻 2026-10-01「招生統計不做樣本數提示」**（`DESIGN.md` 招生入學節「不做」清單），改做「可能範圍」 |
| P3 | 警示判斷 | 「本月漏斗轉換下滑」「來源結構失衡」**直接改用預繳速度判斷**，不保留園務的判斷；和園務不同處記進轉移契約第 19 點 |
| P4 | 其他口徑 | 預繳時間取最後一次標記預繳的日期、之後退出也算預繳過；門檻 10 位；80% 範圍；帶參觀老師只加範圍不排名；月度表不加範圍 |

## 3. 範圍

### 3.1 本次要做

- 後端新增純計算模組 `backend/app/admissions/estimation.py`（不連資料庫、不加相依套件）。
- 後端新增 `backend/app/admissions/deposit_pace.py`：查每筆訪視的參觀日與預繳時間，算預繳速度曲線與比較。
- `/stats` 新增 `deposit_timing`、`deposit_pace` 兩塊；`by_grade`、`by_source`、`by_tour_guide` 每列加 `visit_to_deposit_range`；兩個警示改判斷與文案。
- `/area` 的行政區、里、距離帶每列加 `visit_to_deposit_range`。
- `/compare` 每列加 `visit_to_deposit_range`。
- 後台：統計總覽加「預繳速度」卡、月比卡加一行；共用統計表加「可能範圍」欄（含 CSV）；五校比較、區域分析三張表跟著加；統計分析頂部加一段預設收起的說明。
- 文件：DESIGN.md、轉移契約 README、README 頂部紀錄、招生規格第 9 節加註。

### 3.2 本次不做

- 追蹤優先序分數（等於招生分析報告排除的「意願評分」輕量版）、註冊數預測、任何機器學習模型。
- 預繳日期欄位（補登舊訪視時預繳天數會偏長，見 §4.3、§15）、退出原因代碼。兩者都要改資料表與轉移契約，另案。
- 月度表、年度表、班別×月份、帶參觀老師×年級格子、帶參觀老師×來源、未預繳原因、決策摘要卡的範圍。
- 依可能範圍排序或排名（包含帶參觀老師）。
- 修改園務系統。

## 4. 口徑

### 4.1 母體

和 `/stats` 相同：`_base_filters(campus_key, school_year, semester)`（校區＋入學學年＋學期）。已匿名化的訪視照算（參觀日與事件時間在匿名化後都保留，`retention.py` 只清事件的 `reason`）。參觀日晚於台北今天的訪視不列入預繳速度（正常流程不會出現）。

### 4.2 預繳過

一筆訪視「預繳過」＝`has_deposit` 為 true，**或** `withdrawn_at` 有值（只有已預繳、已註冊可以退出，`withdrawn_from` CHECK 只允許這兩個）。

- 退預繳回到已訪視、取消退出回到已訪視的，目前是已訪視，不算預繳過。
- 和現有預繳率的差別：現有各表的「預繳」只算 `has_deposit`，已退出的不算。預繳速度把之後退出的也算進去，因為它量的是「多快決定預繳」。卡片上寫明「之後退出的也算預繳過」。

### 4.3 預繳時間

預繳時間＝這筆訪視**最後一筆** `deposit_added` 事件的 `created_at`，換成台北日期。

- 會改 `has_deposit` 的只有看板轉換（`funnel.py` `transition()`），每次標記預繳都寫 `deposit_added`；新增、編輯訪視都改不到預繳（`_VisitEditable` 不收 `has_deposit`）。所以正常資料不會「預繳過卻沒有事件」。
- 例外（測試資料、手改 SQL）：預繳過但沒有 `deposit_added` 事件的，算進 `missing_time`，**不列入**預繳速度的曲線與比較，卡片寫出筆數。
- 取最後一筆的理由：退預繳後再標記預繳，最後一筆才是有效的；取消退出（回到已預繳）不會寫新事件，最後一筆仍是原本那次。
- **已知失真**：事件時間是人員在後台按下的時間。補登舊訪視（參觀日早於今天許多天）再標記預繳，天數會偏長。卡片寫明「補登的訪視天數會偏長」。

### 4.4 天數

- 預繳過：`天數 = max(0, 預繳日 − 參觀日)`。
- 還沒預繳：觀察到今天為止，`天數 = 台北今天 − 參觀日`，在統計上當成「到今天還沒預繳」（右設限），不當成「不會預繳」。

## 5. 預繳速度曲線（Kaplan–Meier）

對母體內有效的訪視（扣掉 `missing_time` 與參觀日在未來的）算累積預繳率 `F(t) = 1 − S(t)`：

- `S(t) = Π_{事件日 u ≤ t} (1 − d_u / n_u)`，`d_u`＝第 u 天預繳的筆數，`n_u`＝天數 ≥ u 的筆數（同一天先算預繳、再算到今天為止的）。
- 觀察點：第 7、14、30、60、90 天。每個觀察點回 `cumulative_rate`（百分比、小數一位）與 `visits_reached`（參觀滿 t 天的筆數，即 `台北今天 − 參觀日 ≥ t`）。`visits_reached` 為 0 時 `cumulative_rate` 為 null。
- 一半時間 `half_by_day`：第 90 天的累積預繳率有值且大於 0 時，找最小的整數天 d 使 `F(d) ≥ F(90) / 2`；否則為 null。畫面寫成「到第 90 天會預繳的家長，一半在參觀後 d 天內就預繳了」。
- 門檻：有預繳時間的預繳筆數（曲線上的事件數）**少於 10** 時 `status = "insufficient"`，不回觀察點。

## 6. 預繳速度比較與兩個警示

### 6.1 比較方法（`pace_check`）

輸入「要檢查的一組訪視」與「拿來比的另一組訪視」：

1. 用「拿來比的那組」算 §5 的曲線 `F_b`。這組的事件數少於 10 → `evaluable = false`，`reason = "insufficient_baseline"`。
2. 要檢查的那組每筆訪視 i：已參觀天數 `a_i = 台北今天 − 參觀日`，預期到今天已預繳的機率 `p_i = F_b(a_i)`（`a_i` 超過 `F_b` 最後一個觀察到的天數時，沿用最後的值）。
3. 預期筆數 `expected = Σ p_i`；實際筆數 `observed` ＝這組裡預繳過的筆數。
4. 照過去的速度，實際筆數少到這個程度的機率 `p = P(X ≤ observed)`，`X` 是各筆獨立、機率 `p_i` 的預繳筆數總和（Poisson-binomial，精確算）。
5. **偏慢**＝`evaluable` 且 `p ≤ 0.10` 且 `expected − observed ≥ 2`。第二個條件避免「預期 0.8 筆、實際 0 筆」這種差太少的情況也報。

要檢查的那組沒有訪視時 `evaluable = false`，`reason = "no_visits"`。

### 6.2 「本月漏斗轉換下滑」（`FUNNEL_DROP`）

- 要檢查的那組：參考月份（`reference_month`，沒指定時用最新有資料的月份，同現行）參觀的訪視。
- 拿來比的那組：母體內 `month` 欄（參觀月份）不等於參考月份的訪視，參考月份之後的月份也算。
- 偏慢才發警示。代碼、等級（warning）、`target_tab`（records）、`target_filter`（month）不變。
- 標題改為「本月預繳比過去慢」；訊息「`{月份}` 參觀的 `{n}` 位家長，依過去的預繳速度到今天應有約 `{expected:.1f}` 筆預繳，實際 `{observed}` 筆。」
- **不再比參觀轉註冊**：註冊集中在開學前，逐月比沒有意義。原本「月比下降 10 個百分點以上」的規則與 `FUNNEL_DROP_THRESHOLD` 一併拿掉。
- 月比（`month_over_month`）本身的數字照舊回傳與顯示。

### 6.3 「來源結構失衡」（`SOURCE_IMBALANCE`）

- 候選來源：近 90 天（`created_at`）占比 ≥ 40% 的來源，計算方式同現行。
- 對每個候選來源：要檢查的那組＝這個來源近 90 天的訪視；拿來比的那組＝母體內**其他來源**的訪視（不限 90 天）。
- 偏慢的候選才算失衡；有兩個時取占比高的，同占比取標籤升序第一個（同現行）。
- 訊息「`{來源}` 近 90 天占比 `{share:.1f}`%，依其他來源的預繳速度應有約 `{expected:.1f}` 筆預繳，實際 `{observed}` 筆。」
- 行動入口 `REVIEW_SOURCE` 描述改為「`{來源}` 近 90 天占比 `{share:.1f}`%，預繳比其他來源慢，先看這個來源的後續追蹤。」
- 不再用「預繳率低於整體」判斷。

### 6.4 月比卡要顯示的比較結果

`/stats` 另回 `deposit_pace`（§9.1），就是 §6.2 那次比較的結果，沒發警示時也回，讓月比卡顯示「依過去的預繳速度，到今天應有約 E 筆預繳，實際 O 筆」。

## 7. 可能範圍（Beta 收縮）

### 7.1 算法

每列的參觀數 `v`、預繳數 `d`（現有欄位，`has_deposit` 口徑，不改），全體預繳率 `r`（§7.2，0–1 的比例）：

- 事前：Beta(`k·r`, `k·(1−r)`)，`k = 10`（等於先借 10 位全體平均的家長）。
- 事後：Beta(`d + k·r`, `v − d + k·(1−r)`)。
- 可能範圍＝事後分布的 10% 與 90% 分位數（80% 範圍），百分比、小數一位，回 `{low, high}`。
- `v = 0` 或 `r` 為 null 時回 null。
- 範圍不一定包含原始預繳率：筆數少時會往全體平均靠。例：`r` = 0.3、3 筆裡 3 筆 → 範圍 28.8–63.8%。

### 7.2 各表的「全體」

全體預繳率 `r = (全體預繳數 + 1) / (全體參觀數 + 2)`；全體參觀數為 0 時 `r` 為 null（各列也都是 0 筆，範圍 null）。加一是為了全體還沒有任何預繳（或全部都預繳）時，範圍不會縮成「0–0%」這種假的確定；資料多時和原始比率幾乎一樣。

| 表 | 全體預繳數／參觀數 |
|---|---|
| 班別、來源、帶參觀老師（`/stats`） | 母體的 `kpi.deposit`／`kpi.visit` |
| 行政區、里、距離帶（`/area`） | 距離帶各列相加（每筆訪視恰好落在一個距離帶，含 `none`） |
| 五校比較（`/compare`） | 這次回傳的各校相加 |

帶參觀老師：一筆有多位老師時每位各算一次（同現行），範圍照各自的 `v`、`d` 算。

## 8. 計算模組 `estimation.py`

純函式，只用 Python 標準函式庫，不碰 SQLAlchemy；將來併入園務可以整支搬過去。

| 函式 | 說明 |
|---|---|
| `regularized_incomplete_beta(x, a, b)` | 不完全 Beta 函數比值 I_x(a, b)，連分式（Lentz）求值 |
| `beta_ppf(q, a, b)` | Beta 分位數，對 `regularized_incomplete_beta` 二分搜尋到 1e-9 |
| `prior_rate(deposits, visits)` | §7.2，`(deposits + 1) / (visits + 2)`；`visits` 為 0 回 None |
| `rate_range(successes, trials, prior_rate, *, strength=10, level=0.8)` | §7.1，回 `{"low", "high"}` 或 None |
| `kaplan_meier(observations)` | 輸入 `(天數, 是否預繳)` 序列，回事件日與 `F(t)` 階梯 |
| `cumulative_at(curve, day)` | 取第 day 天的 `F`，超過最後觀察天數沿用最後的值 |
| `poisson_binomial_cdf(probabilities, k)` | `P(X ≤ k)`，動態規劃精確算 |

常數集中在 `deposit_pace.py`：`PACE_MIN_EVENTS = 10`、`PACE_P_THRESHOLD = 0.10`、`PACE_MIN_SHORTFALL = 2.0`、`TIMING_CHECKPOINTS = (7, 14, 30, 60, 90)`；`estimation.py` 放 `RANGE_PRIOR_STRENGTH = 10`、`RANGE_LEVEL = 0.8`。

## 9. API 變更

都是新增欄位，既有欄位不改名、不改型別。權限、路由不變。改完跑 `npm run contract:generate` 並提交 `contracts/openapi.json` 與 `contracts/generated/website-api.d.ts`。

### 9.1 `GET /admin/admissions/stats`

新增：

```text
deposit_timing: {
  status: "ok" | "insufficient",
  visits: int,                    # 列入曲線的訪視數
  deposited: int,                 # 曲線上的預繳筆數（事件數）
  missing_time: int,              # 預繳過但沒有 deposit_added 事件
  min_events: int,                # 10
  checkpoints: [{ day: int, cumulative_rate: float | null, visits_reached: int }],   # insufficient 時為 []
  half_by_day: int | null,
}
deposit_pace: {
  evaluable: bool,
  reason: "no_reference_month" | "no_visits" | "insufficient_baseline" | null,
  month: str | null,
  visits: int,
  expected: float | null,         # 小數一位
  observed: int,
  slow: bool,
}
```

`by_grade[]`、`by_source[]`、`by_tour_guide[]` 每列加 `visit_to_deposit_range: { low: float, high: float } | null`。

`alerts[]` 的 `FUNNEL_DROP`、`SOURCE_IMBALANCE` 改判斷與文案（§6.2、§6.3），代碼不變。

### 9.2 `GET /admin/admissions/area`

`districts[]`、`villages[]`、`distance_bands[]` 每列加 `visit_to_deposit_range`。

### 9.3 `GET /admin/admissions/compare`

`rows[]` 每列加 `visit_to_deposit_range`（只有參觀轉預繳；其他三個比率不加）。

## 10. 後台畫面

沿用 DESIGN.md 招生統計規則：表格＋CSS 長條、不裝圖表套件、數字一定寫出來、沒有資料寫原因。

### 10.1 統計總覽

- **「預繳速度」卡**，放在月比卡之後：
  - 五列（第 7／14／30／60／90 天）：天數、CSS 長條（寬度依五列最大值）、累積預繳率、小字「參觀滿 t 天：n 位」。`cumulative_rate` 為 null 寫「—」與「還沒有家長參觀滿 t 天」。
  - 摘要一句（`half_by_day` 有值時）：「到第 90 天會預繳的家長，一半在參觀後 d 天內就預繳了。」
  - 註記：「預繳時間是後台標記預繳的日期，補登的訪視天數會偏長；之後退出的也算預繳過。」`missing_time > 0` 時加「另有 N 筆已預繳但沒有預繳紀錄時間，不列入。」
  - `insufficient`：「預繳過的家長還不到 10 位（目前 N 位），先不計算預繳速度。」
- **月比卡**加一行：
  - `evaluable`：「依過去的預繳速度，到今天應有約 E 筆預繳，實際 O 筆。」`slow` 時用警示色。
  - `insufficient_baseline`：「其他月份的預繳還不到 10 筆，先不比較預繳速度。」
  - `no_visits`、`no_reference_month`：不顯示這一行。

### 10.2 可能範圍欄

- 共用統計表（`StatsDimensionTable.vue`）新增欄位種類 `range`：顯示「29–64%」（整數，`Math.round`），null 寫「—」。
- 班別、來源、帶參觀老師（`StatsTab.vue`）與行政區、里、距離帶（`AreaTab.vue`）的預繳率欄後面加「可能範圍」欄。
- 五校比較（`CompareTable.vue`）在「參觀轉預繳」後加「可能範圍」欄。
- 排序不變（依參觀數），不提供依範圍排序。
- CSV：「可能範圍」拆成「可能範圍下限」「可能範圍上限」兩欄，小數一位，沒有值寫空白（DESIGN「後台匯出擴充」的空值規則）。
- 手機 390px：表格照現行在框內橫捲，頁面不被撐寬。

### 10.3 說明

統計分析的範圍說明下方（子分頁列上方，每個子分頁都看得到）加一段預設收起的說明（標題「怎麼看可能範圍與預繳速度」），內容：

- 可能範圍：依筆數估計真實預繳率大概落在哪裡；筆數少時範圍寬，而且會往全校平均靠，所以 3 筆裡 3 筆不代表比全校好。
- 預繳速度：剛參觀的家長還沒到會預繳的時候，所以兩個警示改成「依過去的速度到今天應該有幾筆」來判斷。

## 11. 與園務的相容性

- 不改資料表、不改匯出（`export.py`、`ivy-schema.json`、JSONL 都不動），轉移契約的資料部分不受影響。
- 轉移契約 README「刻意與園務不同」新增第 19 點：兩個警示的判斷（§6）、`deposit_timing`／`deposit_pace`、可能範圍（§7），以及算法集中在 `estimation.py`、併入時由園務決定要不要跟進。
- 第 8 點（月比 null 不判定下滑）改寫：月比仍照第 8 點算 delta，但「本月漏斗轉換下滑」從 2026-10-12 起改由第 19 點判斷。
- `stats.py` 開頭的「刻意與園務不同」註解同步更新。

## 12. 文件回寫

- `DESIGN.md`：新增「招生統計：預繳速度與可能範圍（2026-10-12）」；招生入學節「不做」清單拿掉「樣本數提示」並註明 10-12 推翻；成效統計補強節「招生入學統計仍不做樣本數提示」改寫。
- `docs/specs/2026-09-30-website-admissions-design.md` 第 9 節：加一行指向本規格。
- `README.md` 頂部加日期紀錄。
- 本規格狀態改為「已實作」並回寫實作裁定。

## 13. 測試與驗證

### 13.1 後端

- `test_admissions_estimation.py`（純函式）：
  - `beta_ppf` 對封閉解：Beta(1,1) 的 q 分位數＝q；Beta(a,1)＝q^(1/a)；Beta(1,b)＝1−(1−q)^(1/b)；Beta(a,a) 的中位數＝0.5。另加 scipy 離線算好的參考值（Beta(6,7) 的 10%＝0.28817、90%＝0.63772，容許 1e-4）。
  - `rate_range`：3/3、`prior_rate` 0.3 → 28.8／63.8；`trials = 0` 或 `prior_rate` 為 None → None。`prior_rate(0, 5)` 是 1/7、`prior_rate(0, 0)` 是 None。
  - `kaplan_meier`：手算的小例子（含同一天預繳與到今天為止並存、全部到今天為止、第 0 天預繳）。
  - `poisson_binomial_cdf`：小 n 對窮舉、機率 0 或 1、k 超出範圍。
- `test_admissions_deposit_pace.py`（真資料庫，經 `admissions_helpers` 的 API 轉換寫事件，或新 helper 直接寫 `deposit_added` 事件並指定時間）：
  - **月初不誤報**：上個月家長已參觀滿 30 天、預繳 40%；本月家長才參觀 3 天、0 筆預繳 → 不發 `FUNNEL_DROP`（舊判斷會發）。
  - 真的偏慢會發，訊息數字正確。
  - 其他月份預繳不到 10 筆 → 不發，`deposit_pace.reason = "insufficient_baseline"`。
  - 退出後仍算預繳過；退預繳回已訪視不算；預繳過但沒事件進 `missing_time`；已匿名化照算。
  - **新來源不誤報**：近 90 天占 50% 的新來源、家長都才參觀幾天 → 不發 `SOURCE_IMBALANCE`；舊來源真的偏慢 → 發。
  - `deposit_timing` 的觀察點、`visits_reached`、`half_by_day`、`insufficient`。
- 改寫現有 `test_admissions_stats.py` 中鎖舊判斷的測試（`test_alert_thresholds_and_source_imbalance`、`test_funnel_drop_alert_at_exact_threshold`），其餘保持通過。
- `/area`、`/compare` 的範圍欄位：對既有 seed 驗一兩列的數值與 null。

### 13.2 後台

- `statsFormat` 的範圍格式、`StatsDimensionTable` 的 `range` 欄與 CSV 兩欄、`StatsOverview` 預繳速度卡三種狀態與月比卡那一行、`CompareTable`、`AreaTab`。
- `admissionsTestKit.ts`、`statsTab.test.ts`、`compareTable.test.ts` 的型別化範本補新欄位。

### 13.3 驗證指令

- 後端：專屬測試庫跑招生相關 pytest，最後主 session 背景跑全套。
- `npm run contract:check`、admin `typecheck`＋vitest 全套、`npm --prefix web run typecheck`、`npm run test:website`。
- stack e2e：`admissions-flow`、`admissions-area`、`exports` 三支（用專屬庫名與埠）；`admissions-flow` 加斷言：統計總覽出現「預繳過的家長還不到 10 位」。
- Playwright 截圖統計總覽與五校比較，1440 與 390 各一張，確認沒有橫向溢出。

## 14. 部署

- 沒有 migration，不需要備份閘門。
- 跟著招生入學開關（`WEBSITE_ADMISSIONS_ENABLED`），不另加開關。
- 推 `main` 會觸發正式部署，由使用者決定時機。
- 正式庫目前是測試資料，預繳速度卡會先顯示「還不到 10 位」，兩個警示也會因為 `insufficient_baseline` 暫時不發，要等真實資料累積。

## 15. 已知限制

- 預繳時間是後台操作時間，補登舊訪視會讓天數偏長，也會讓預繳速度看起來偏慢。要解決得加「實際預繳日」欄位（§3.2）。
- 同一個孩子的多筆訪視（重新預約、手動補登）當成獨立的家長算，範圍會稍微偏窄。
- `k = 10`、80%、p ≤ 0.10、少 2 筆以上、10 筆門檻都是經驗值，沒有用實際資料校準；有一季真實資料後再檢討。
- 「拿來比的那組」用的是母體內其他月份或其他來源，招生季前後預繳速度本來就不同（例如開學前特別快），季節差異會混在裡面。

## 16. 實作裁定

實作時和規格字面不同、或規格沒寫死而補定的地方只有這三點，其餘照規格：

1. **CSV 範圍欄以數字輸出**：「可能範圍下限」「可能範圍上限」寫成數字，後端值 29.0 輸出 `29`，不補成 `29.0`（§10.2 寫「小數一位」，實際不補零；有小數的值照原樣，如 `46.9`；沒有值仍寫空白）。
2. **刪掉 `_points`**：`stats.py` 一併刪掉只被舊「本月漏斗轉換下滑」警示用的 `_points` 輔助函式。
3. **文案與版面**：預繳速度卡與月比卡那一行的文案、版面照 §10.1；說明區塊放在統計範圍說明下方、子分頁列上方（§10.3）。
