# 退出原因分類與統計（2026-10-15）設計

日期：2026-10-15
狀態：設計 10-15 經使用者核可（八項分類清單由使用者選定）；規格 10-15 經使用者核可（含寫規格時補的預設值；W6 統計位置是規格階段才定、使用者審閱時同意）
基準：`origin/main` `aae0debc`（migration head `c6a9e3f15d27`；**本案新增一支 migration**）
分支（實作）：`feature/withdraw-reason-20261015`
上游：10-15 後台功能盤點，使用者選定六項之一（第 2 波，排在「招生歷程兩種事件」之後）。預繳速度規格把「退出原因代碼」列為另案（`docs/specs/2026-10-12-admissions-deposit-pace-design.md:53`）；預約全程規格只看退出時點、不看原因（`docs/specs/2026-10-15-booking-journey-design.md:53`）。

## 1. 背景與目標

退預繳、退註冊時要填的「原因」是自由文字（`recruitment_visits.withdraw_reason`，Text），沒有任何統計或篩選用到它。園務端也一樣是自由文字、沒有代碼表、沒有統計（`ivy-backend/models/recruitment.py:89-95`），所以官網可以自己加分類，不需要和園務同步改。

### 1.1 成功標準

1. 標記退預繳、退註冊時，必選一個退出原因分類；說明改成選填。
2. 統計分析看得到「退出原因分佈」（分退預繳、退註冊），舊資料歸「未分類」，而且可以事後補分類。
3. 訪視明細可以依退出原因分類篩選，匯出 CSV 有這一欄。
4. 轉給園務的資料，園務端不用改程式；「退出原因」文字欄照樣有內容。

### 1.2 裁定

| # | 事項 | 裁定 | 理由 |
|---|---|---|---|
| W1 ✔ | 分類清單 | 八項（順序即顯示順序）：`抽中公幼／非營利`、`改讀其他私立幼兒園`、`搬家／距離因素`、`費用考量`、`家庭照顧安排改變`、`孩子健康／適應因素`、`課程／環境有疑慮`、`未註明／聯絡不上` | 使用者 10-15 選定；用詞比照「未預繳原因」（`constants.py:13-22`） |
| W2 ✔ | 必選與說明 | 轉成退出（`deposited→withdrawn`、`enrolled→withdrawn`）時分類必選、說明選填；其他要填原因的轉換（`enrolled→deposited`、`enrolled→visited`）照舊要填文字 | 使用者 10-15 核可 |
| W3 ✔ | 舊資料 | 不自動猜分類；分類為空的退出者在統計歸「未分類」 | 自由文字推分類容易錯 |
| W4 ✔ | 匿名化 | 清說明（`withdraw_reason`）、保留分類 | 比照未預繳原因：分類保留、說明清掉（`retention.py:70-71`） |
| W5 ✔ | 轉給園務 | `columns.withdraw_reason` ＝「分類」或「分類：說明」（兩者都空才是 null）；分類另放 `extensions.withdraw_reason_category` | 園務的轉換 API 要求退出原因必填（`ivy-backend/services/recruitment_funnel.py:530-533`），組成文字讓園務卡片有內容；`columns` 的鍵集合被契約測試鎖死等於園務欄位（`test_admissions_contract.py:53`），新欄位只能放延伸 |
| W6 | 統計位置 | 統計分析的「未預繳原因」分頁改名「未預繳與退出原因」，最下面加一張「退出原因分佈」表（欄：原因、退預繳、退註冊、合計）；網址 `sub=nodeposit` 不變 | 兩者都在回答「為什麼沒留下來」；不新增第十個子分頁 |
| W7 | 事後補分類 | 已退出的訪視可以在編輯訪視時改分類（PATCH records 收 `withdraw_reason_category`，只有階段是已退出時才收，否則 422） | 舊資料要能補成有分類；說明文字仍只在退出那一刻填 |
| W8 | 統計口徑 | 母體＝頁首範圍（校區＋入學學年＋學期，`stats._base_filters`）內已退出的訪視；分退預繳（`withdrawn_from='deposited'`）、退註冊（`'enrolled'`）；附「未分類 N 筆」 | 與其他統計表同一個範圍；退出時點已在預約全程，這裡只看原因 |
| W9 | 取消退出 | 清掉分類與說明 | 同現有對 `withdraw_reason` 的處理（`funnel.py:208`） |
| W10 | 事件 | `withdrawn` 事件的 `metadata_json` 加 `{"withdraw_reason_category": …}`；`reason` 仍是說明 | 歷程看得到分類；分類不是個資 |

### 1.3 不做

- 依說明文字自動歸類、分類的趨勢或預測。
- 園務端改動；預約端取消原因的分類。
- 「其他」選項（說明欄已經可以補充，不再加）。

## 2. 現況（`origin/main` `aae0debc`）

- 欄位：`backend/app/admissions/models.py:140-142`（`withdrawn_at`、`withdrawn_from`、`withdraw_reason` Text）。
- 轉換：`POST /admin/admissions/records/{id}/transition`（`routes.py:359-427`）→ `funnel.transition`；`TransitionRequest.reason`（`schemas.py:289-298`，上限 2000）；要填原因的轉換 `_REASON_REQUIRED`（`funnel.py:43`），缺了 422 `TRANSITION_FIELDS_REQUIRED`（`funnel.py:148-149`、`routes.py:405-414`）；退出寫入 `funnel.py:195-203`；取消退出 :208。
- 先例「未預繳原因」：選項 `constants.py:13-22`；欄位 `no_deposit_reason` String(60)＋CHECK（`models.py:60,128`；migration `4a7e2c9d1b63_admissions.py:24,81`，`tests/test_admissions_schema.py` 比對字面值）；篩選 `records.py:313,380-381`；選項 API `records.py:463-488`；統計 `stats.py:324-336`（NULL 歸 `UNCLASSIFIED_REASON`，:51）；前端選項手抄 `admin/src/admissions/constants.ts:63-67`，`admissionsConstants.test.ts:20-22` 對 Python 原始碼比對。
- 畫面：退出對話框 `admin/src/components/admissions/TransitionDialog.vue`（:56-57 標題、:96 必填檢查、:105 送出、:194 textarea）；顯示 `RecordsTab.vue:275`、`components/visit/FamilyAdmissionsData.vue:43`、歷程 `EventsDrawer.vue:248`；CSV `backend/app/admissions/download.py:147`。
- 統計分頁 `admin/src/components/admissions/StatsTab.vue:404-441`（「未預繳原因」）。
- 契約：`export.py:79`（`columns.withdraw_reason` 原樣）、延伸欄位 `export.py:133-150`；`contracts/ivy-recruitment/ivy-schema.json:48`；`contracts/ivy-recruitment/README.md:46`（延伸欄位）、:72。

## 3. 設計

### 3.1 資料

- `constants.py` 加 `WITHDRAW_REASON_CATEGORIES`（W1 八項）。
- migration：`recruitment_visits.withdraw_reason_category String(40) NULL`，CHECK `withdraw_reason_category IS NULL OR withdraw_reason_category IN (…)`（用 `_sql_in`，字面值與常數逐字相同）；另一條 CHECK：`withdraw_reason_category IS NULL OR withdrawn_at IS NOT NULL`。`down_revision` 取實作當下 `origin/main` 的 head（§5）。
- 不回填。

### 3.2 API

- `TransitionRequest` 加 `withdraw_reason_category: WithdrawReasonCategory | None`（`Literal`）。
- `funnel.transition`：轉成退出時分類必填（缺了 → `TransitionFieldsMissing(["withdraw_reason_category"])`），`reason` 改為選填；寫入分類與說明；`withdrawn` 事件 metadata 加分類（W10）。取消退出清兩者（W9）。
- `RecruitmentVisitUpdate` 加 `withdraw_reason_category`；不是已退出 → 422 `RECRUITMENT_NOT_WITHDRAWN`（中文「只有已退出的訪視可以設定退出原因分類」）。若「招生歷程兩種事件」已合併，這個修改會照常寫 `details_updated`。
- 訪視列表／匯出篩選加 `withdraw_reason_category`（含特別值 `unclassified`＝已退出但沒有分類）；`options` 回傳分類清單。
- `RecruitmentVisitOut` 加分類欄位；`/stats` 回應加 `withdraw_reasons: [{reason, deposited, enrolled, total}]`（八項依 W1 順序，`未分類` 最後；全部為 0 的列也回，前端決定是否隱藏）與 `withdraw_total`。
- CSV（`download.py`）在「退出原因」旁加「退出原因分類」欄。
- 匯出（`export.py`）：`columns.withdraw_reason` 依 W5 組成；`extensions` 加 `withdraw_reason_category`。
- 匿名化（`retention.anonymize_visit`）不清分類（W4，現有程式只清 `withdraw_reason`，不需改，但要加測試釘住）。

### 3.3 畫面

- 退出對話框（mode destructive 且目標是退出時）：上面「退出原因」下拉（必選，el-select，八項），下面「說明（選填）」textarea。退回註冊、退回參觀的對話框不變。
- 訪視明細：已退出的列顯示「退出：費用考量（說明…）」；篩選列加「退出原因」下拉（含「未分類」）。
- 編輯訪視（RecordDialog）：已退出時多一個「退出原因分類」下拉（W7）。
- 家庭頁招生資料（`FamilyAdmissionsData.vue`）顯示分類與說明。
- 歷程：`withdrawn` 事件的變更行加「原因：費用考量」。
- 統計分析：分頁改名「未預繳與退出原因」；最下面加 `StatsDimensionTable`「退出原因分佈」，提示「依頁首的入學學年與學期；改版前退出、還沒補分類的歸『未分類』，可在訪視明細補上」。點列跳到訪視明細並帶入該分類篩選（沿用 `open-records` 事件）。
- 前端選項手抄在 `admin/src/admissions/constants.ts`，`admissionsConstants.test.ts` 加一條比對 Python 常數。

## 4. 測試

- 後端：
  - schema：CHECK 字面值與常數相同；有分類但沒退出 → DB 拒絕。
  - 轉換：退預繳／退註冊沒有分類 → 422；只有分類、沒說明 → 成功；退回註冊、退回參觀仍要文字原因；取消退出清兩者；事件 metadata 有分類。
  - PATCH 補分類：已退出成功；未退出 422。
  - 篩選含 `unclassified`；CSV 有新欄位。
  - 統計：八項＋未分類、退預繳／退註冊分欄、受學年學期與校區範圍影響。
  - 匯出：只有分類 → `columns.withdraw_reason` 是分類；分類＋說明 → 「分類：說明」；都沒有 → null；`extensions` 有分類；契約測試通過。
  - 匿名化後分類保留、說明清空。
- admin vitest：退出對話框必選與送出 payload、明細顯示與篩選、統計表、`admissionsConstants`。
- stack e2e：既有退出流程的 spec 改成要選分類；加一條「選分類退出 → 統計表出現 1 筆」。

## 5. 部署與風險

- 一支 migration，只加可空欄位與 CHECK，不改寫既有資料，不需要先備份（部署前備份的規則是：改寫既有資料的 migration 才要先備份正式 DB）。
- migration 串接：同期還有「在籍學生分布」（`f2a7c1e9d4b3`，down=`c6a9e3f15d27`）、「預計入學時間」「預約案件排除」各一支。實作開工時 `down_revision` 接當時 `origin/main` 的 head；合併前 `git fetch`，若別支先進 main 就改接它，確保只有一個 head。
- 後台與 API 同一次部署；舊版後台頁面送出退出時沒有分類會被 422 擋下，重新整理即可。

## 6. 與其他工作的關係

- 「招生歷程兩種事件」先做；本案的補分類會自動產生 `details_updated`。
- 與「預計入學時間」「預約案件排除」只有 migration 串接的關係。
