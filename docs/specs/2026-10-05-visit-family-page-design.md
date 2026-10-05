# 預約明細當家庭頁：參觀案件與招生入學整合設計

日期：2026-10-05
狀態：草案，待使用者審閱
對象：業主、接手實作的 Claude
基準：`origin/main` `e0819f3a`（招生入學已部署、正式站開關已開；migration head `4373bcc82d9d`）
Mock-up：`~/Desktop/ivy-website-admin/design/visit-family-page-mockup-20261005/`（`index.html` 四個畫面，`shots/` 桌機 1440 與手機 390 截圖；資料皆虛構）

前置文件：

- 參觀後追蹤：`docs/specs/2026-10-04-admissions-follow-up-design.md`（以下稱「追蹤規格」）。
- 招生入學：`docs/specs/2026-09-30-website-admissions-design.md`（以下稱「招生規格」）。
- 家長自選場次：`docs/specs/2026-09-30-parent-self-booking-design.md`（以下稱「預約規格」）。

本規格只改後台畫面，另外在兩個 API 回應各加一個欄位。資料表、轉換規則、統計公式、轉移契約（`contracts/ivy-recruitment`）都不動，也沒有 migration。

## 1. 背景與目標

使用者 2026-10-05 指著正式站 `/admin/visit-requests` 與 `/admin/admissions?campus=yihua` 問「要怎麼整合」，選定的目的是「**一個家庭從頭看到尾**」：從預約、到場、追蹤到預繳、註冊，都在同一頁看完，不用兩頁來回跳；兩頁本身保留。

### 1.1 現況

| 環節 | 現況 | 位置 |
|---|---|---|
| 兩頁分工 | 參觀案件管參觀前（場次、改期、取消、標記到場）；招生入學管參觀後（預繳、註冊、追蹤、統計）；兩頁同在側欄「參觀預約」組 | `admin/src/router/nav.ts:62-72` |
| 接縫 | 標記已到場時同一個交易複製一筆 `recruitment_visits`，以唯一的 `visit_request_id` 關聯；之後兩份資料各自演進、不同步 | `backend/app/booking/workflow_service.py:228-263`、`backend/app/admissions/booking_link.py:46-110` |
| 預約明細的招生區塊 | 已到場且有招生訪視時，顯示「參觀後追蹤」摘要（階段、下次聯絡、負責人、最近聯絡）與「記錄聯絡」「排下次聯絡」；處理區另有「○○・在招生入學查看」連結 | `admin/src/views/VisitDetailView.vue:967-990`、`:1151-1158` |
| 招生的單筆檢視 | 「參觀→入學 歷程」抽屜：時間線合併參觀前聯絡、招生事件、參觀後聯絡，可「移到…」換階段；看板點卡片、訪視明細點姓名、待追蹤「歷程」都開它 | `admin/src/components/admissions/EventsDrawer.vue:1-120` |
| 招生 → 預約 | 訪視明細的「查看預約」連結 | `admin/src/components/admissions/RecordsTab.vue:524`、`:606` |

### 1.2 斷點

1. **預約明細看不到參觀後的全貌**：不能換階段（預繳、註冊、退出），「聯絡紀錄」只列參觀前的，「案件歷程」只有預約事件，招生資料（年級、入學學期、來源…）完全看不到。
2. **招生抽屜看不到參觀前的全貌**：沒有預約歷程（送出、改期、到場）、沒有家長填的資料、不能做預約的操作。
3. 兩邊各做了一半，同事要依問題在兩頁之間切換；兩頁互相嵌了對方一部分（預約明細嵌追蹤摘要、招生明細嵌「查看預約」）。

### 1.3 成功標準

1. 有預約的家庭，從預約送出到註冊的資料與操作都在 `/visit-requests/:id` 一頁完成：看資料、編輯招生資料、記錄聯絡、排下次聯絡、換階段。
2. 招生入學點有預約的家庭會開這一頁，返回時回到原本的分頁與篩選。
3. 沒有預約（手動新增）的訪視、沒有招生權限的帳號、招生開關關閉時，畫面與今天一致。
4. 不新增資料表、不改轉換規則與權限、不改轉移契約、沒有 migration。

## 2. 已裁定事項

| 日期 | 裁定 | 來源 |
|---|---|---|
| 2026-10-05 | 整合目的：一個家庭從頭看到尾（兩頁可以保留） | 使用者 |
| 2026-10-05 | 家庭範圍：一筆預約加上它的招生訪視（現有 `visit_request_id` 關聯）；不串重新預約的前後案、不用電話比對 | 使用者 |
| 2026-10-05 | 採方案 A：預約明細當家庭頁；招生點有預約的卡片跳過去，手動新增的維持抽屜。否決 B（共用時間線、入口不變）與 C（新的招生訪視整頁） | 使用者 |
| 2026-10-05 | 設計第 1 段（家庭頁版面）、第 2 段（招生入口與返回）、第 3 段（資料、權限、例外、測試）逐段同意 | 使用者 |
| 2026-10-05 | 聯絡紀錄與案件歷程維持兩塊，不合成一條（稽核事件會淹掉聯絡內容）；家長預約時填的資料收合不刪 | Claude 提出，使用者同意第 1 段時未推翻 |
| 2026-10-05 | 看過 mock-up 後同意寫規格 | 使用者 |

## 3. 範圍

### 3.1 本次要做

1. 預約明細在「家庭版面」條件成立時（第 5.1 節）改版：頁首、招生資料、合併聯絡紀錄、合併案件歷程、招生處理區。
2. 招生入學的看板、訪視明細、待追蹤：有預約的列點下去開預約明細；拿掉「查看預約」連結。
3. 預約明細的返回鍵依來源顯示「招生入學」或「參觀案件」。
4. 後端：看板卡片與待追蹤列多回 `visit_request_id`。
5. 文件：DESIGN.md、README、acceptance.md，以及修正兩份已過時的規格段落（第 11 節）。

### 3.2 本次不做

- 合併 `visit_requests` 與 `recruitment_visits`、讓兩份家長資料同步。
- 用電話或姓名比對成「家庭」、串重新預約鏈。
- 新增招生事件類型。「修改招生資料」「排下次聯絡」目前不寫 `recruitment_event_log`，案件歷程不會有這兩種事件（排下次聯絡會出現在聯絡紀錄那筆底下）。要記就得加事件類型，會動到轉移契約的列舉，另案。
- 手動新增訪視的整頁（維持抽屜）、抽屜本身的改動。
- 到場前的預約明細、案件列表、參觀場次、側欄。
- 併入園務的任何調整。

## 4. 名詞

- **家庭版面**：預約明細（`/visit-requests/:id`）在第 5.1 節條件成立時的版面。
- **招生訪視**：`recruitment_visits` 一筆。
- **參觀前／參觀後聯絡**：分別存在 `visit_contact_notes` 與 `recruitment_contact_logs`。

## 5. 預約明細（家庭版面）

### 5.1 條件

以下全部成立才用家庭版面，任一不成立就是今天的畫面：

1. 預約 `status === 'completed'`。
2. 招生 API 可用（現有 `admissionsAvailable === 'yes'`，即招生開關開著）。
3. 查得到這筆預約的招生訪視（現有 `admissionsVisit`）。
4. 帳號有 `admissions.read`。

「已到場但沒有招生訪視」維持今天的畫面與「建立招生訪視」按鈕；補建成功後直接切成家庭版面，不用重新整理。

### 5.2 頁首

| 項目 | 家庭版面 |
|---|---|
| 右上狀態 | 招生階段標籤（大，`StatusTag`），文字與色調同訪視明細「階段」欄（`stageMeta`，從 `RecordsTab.vue` 搬到 `admissions/constants.ts` 共用）；下方小字「MM/DD 到場」，日期取招生訪視的 `visit_date` |
| 第一行小字 | 現有「校區・送出時間 官網送出／補登」後面加「・預約承辦 {名字}」；沒有承辦人就不加 |
| 最後處理 | 從預約歷程（園方操作）、招生事件（有操作者）、參觀後聯絡紀錄三者取最新一筆；文字分別是預約事件名稱、`eventLabel()`、「記錄聯絡」 |
| 參觀時間 | 不變 |
| 撥號鈕（手機） | 撥招生訪視的 `phone`；空的話退回預約的 `phone` |

### 5.3 招生資料

主欄最上方一塊面板「招生資料」，兩欄 `el-descriptions`（手機一欄）。

- **固定列**：幼生姓名、英文名字、生日、適讀班級、聯絡人、電話、入學學期、搭娃娃車、帶參觀老師、來源分類、來源備註、介紹者。
- **有值才列**：收預繳人員（有預繳時）、未預繳原因（已訪視且有填）、退出原因（已退出）、地址、父親職業、母親職業、備註、家長回應。
- 姓名是 `MISSING_CHILD_NAME` 時顯示「待補」標籤（同訪視明細）。
- 欄位名稱與選項以「招生訪視照紙本補欄位」（`feature/admissions-paper-fields-20261005`）併入 main 後的 `RecordDialog.vue` 為準；該分支還沒進 main 前不開工（第 12 節）。
- 標題右側「編輯」：有 `admissions.write` 且未匿名化才顯示，開現有 `RecordDialog`（`mode="edit"`）；存檔後用回傳的訪視更新畫面，409 重讀。
- 已匿名化：顯示匿名化文字、沒有編輯鈕。

招生資料下方緊接著今天的「家長填寫的資料」面板，改成可收合、預設收合：標題官網送出的寫「家長預約時填寫的資料」，補登的寫「補登時的案件資料」，標題列右側「展開／收起」（`aria-expanded`），內容就是今天的表格（沿用同一份標記，不另抄一份）。

### 5.4 聯絡紀錄

- 同一個列表，合併參觀前（`GET /admin/visit-requests/{id}/contact-notes`）與參觀後（`listContactLogs(visitId)`），**新的在上**（同今天的預約聯絡紀錄方向）。
- 每筆的標籤依**時間**判斷：早於預約歷程中 `completed`（標記已到場）事件的時間標「參觀前」，其餘標「參觀後」。預約的舊資料裡有到場後才寫在預約上的紀錄，照時間標成「參觀後」才不會誤導。
- 參觀後聯絡多一行粗體「{管道}・聯絡到了／沒聯絡到」，有排下次聯絡時底下加一行「排下次聯絡 MM/DD（週X）HH:mm」。
- 排序時間：參觀前用 `created_at`，參觀後用 `contacted_at`；同一時間時參觀後排前面。
- 家庭版面**不顯示**今天的文字輸入框與下次聯絡選擇器，新增一律用處理區的「記錄聯絡」（`ContactLogDialog`）。
- 參觀後紀錄讀不到時：列表照列參觀前的，上方提示「參觀後的聯絡紀錄讀不到」附「重新載入」。
- 標題旁說明：「參觀前記在預約、參觀後記在招生，這裡一起列」。

### 5.5 案件歷程

- 合併預約歷程（`detail.history`，`VisitHistoryOut`）與招生事件（`listEvents(visitId)`，`RecruitmentEventOut`），**新的在上**（同今天的 `VisitHistoryTimeline`）。
- 每筆加來源小標「預約」或「招生」。
- 預約事件的呈現照今天（`visitEventTitle`、變更行、原因、「查看關聯案件」）。
- 招生事件的標題用 `eventLabel(event_type, metadata_json)`，變更行用階段變化（同抽屜的 `stageChange`）與座位內容（`seatDetail`），再加原因、操作者 `actor_name`。
- 同一時間（到場與建立訪視同一個交易）時，招生事件排在預約事件上面（時間順序上建立訪視在到場之後）。
- 招生事件讀不到時：只列預約歷程，上方提示「招生的歷程讀不到」附「重新載入」。

### 5.6 處理區（右欄）

家庭版面取代今天 `completed` 分支的「這筆案件已結案…」內容：

1. **摘要**：招生階段標籤、下次聯絡（到期用警示色，同 `isDue`）、最近聯絡（取最新一筆參觀後聯絡的「MM/DD 管道・聯絡到了／沒聯絡到」，沒有就寫「還沒有聯絡紀錄」）。
2. **按鈕**（有 `admissions.write` 且未匿名化）：
   - 「記錄聯絡」（主要鈕，滿版）：開 `ContactLogDialog`。
   - 「排下次聯絡」／「改期／負責人」：只在還在追的階段（`isOpenStage`）出現，開 `FollowUpDialog`。
   - 「移到…」：選項是 `moveTargets(stage, can)`，沒有選項就不顯示；選了開 `TransitionDialog`，規則與權限照招生現有（`admin/src/admissions/constants.ts:87-97`）。已訪視只能移到已預繳；已預繳可回已訪視，或移到已註冊（需 `admissions.convert`）、退預繳。
3. **負責人**：招生負責人 `follow_up_owner_id`。有 `admissions.write`、未匿名化、還在追的階段時是下拉，改了呼叫 `updateFollowUp`（帶原本的 `follow_up_at` 與 `expected_version`）；其他情況顯示文字。選項用 `listAdmissionsStaff(campus_key)`。
4. **重新預約**：小字「家長想再約別的時間？」加連結「重新預約（另建新案）」，開現有 `ManualVisitDialog`。

家庭版面拿掉：預約承辦人下拉（改寫在頁首小字）、「○○・在招生入學查看」連結。各對話框儲存後，用回傳的訪視更新頁首、招生資料、處理區，並重讀聯絡紀錄與招生事件。

### 5.7 拿掉的區塊

- 「參觀後追蹤」區塊（`VisitDetailView.vue:967-990`）與它的「到招生入學」連結：內容已分到頁首、處理區與聯絡紀錄。
- 家長管理連結區塊本來就只在未結案時出現（`linkApplicable`，`:892`），不受影響。

### 5.8 手機（≤ 900px，沿用現有斷點）

順序是：頁首 → 撥號鈕 → 處理區 → 聯絡紀錄 → 招生資料 → 案件歷程，跟今天「處理面板在前、聯絡紀錄在家長資料前」的排法一致。招生資料改成一欄。390px 不能有橫向捲動。

### 5.9 例外與狀態

| 情況 | 行為 |
|---|---|
| 招生開關關閉 | 今天的畫面（`admissionsAvailable === 'no'`） |
| 帳號沒有 `admissions.read` | 今天的畫面；聯絡紀錄輸入框保留 |
| 有 `admissions.read`、沒有 `admissions.write` | 家庭版面唯讀：沒有編輯、記錄聯絡、排聯絡、移到…，負責人顯示文字 |
| 已到場、沒有招生訪視 | 今天的畫面＋「建立招生訪視」；成功後切成家庭版面 |
| 招生訪視已匿名化 | 家庭版面唯讀（同抽屜） |
| 招生訪視讀取失敗 | 處理區顯示「招生資料讀不到」＋「重新載入」，其他預約內容照常 |
| 同時有人改（409） | 沿用各對話框的 `@stale`：重讀招生訪視，把新版本交回還開著的對話框（同今天 `onFollowUpStale`） |
| 快速切換「下一筆」 | 所有招生讀取都要過現有的 generation／`useRequestSequence` 檢查，舊回應不能蓋掉新的一筆 |

### 5.10 程式結構

`VisitDetailView.vue` 已經 1685 行，招生相關的部分抽出去：

- `admin/src/composables/useFamilyAdmissions.ts`：依預約讀招生訪視、事件、參觀後聯絡、負責人名單、選項，處理競態與 409 重讀；提供 `isFamily`、`visit`、`events`、`contactLogs`、`reload()`、`replaceVisit()`。現有的 `loadAdmissionsVisit`、`followUpVisit`、`openContactLog`、`openFollowUpDialog`、`onFollowUpStale` 搬進來或改用它。
- `admin/src/components/visit/FamilyAdmissionsData.vue`：招生資料面板＋收合的預約資料。
- `admin/src/components/visit/FamilyActions.vue`：處理區的家庭版面（摘要、按鈕、負責人、重新預約、各對話框）。
- `admin/src/components/visit/FamilyContactNotes.vue`：合併後的聯絡紀錄。
- 案件歷程：`VisitHistoryTimeline.vue` 加選填 prop `recruitmentEvents`，沒傳時輸出跟今天一模一樣。

先抽出、維持行為不變並讓既有測試全過，再加家庭版面（第 12 節步驟 2、3）。

## 6. 招生入學的入口與返回

### 6.1 點單筆的規則

新增一個共用函式（放 `admin/src/admissions/`）：這一列有 `visit_request_id`，而且帳號有 `booking.read`，就 `router.push('/visit-requests/<visit_request_id>')`；否則照舊開 `EventsDrawer`。

| 入口 | 位置 | 改法 |
|---|---|---|
| 漏斗看板點卡片 | `FunnelBoard.vue:196`、`:293` | 套規則。拖曳、卡片上的「移到…」不變 |
| 訪視明細點姓名（桌機） | `RecordsTab.vue:602` | 套規則 |
| 訪視明細「歷程」（手機卡片） | `RecordsTab.vue:540` | 套規則 |
| 訪視明細「查看預約」連結 | `RecordsTab.vue:524`、`:606` | 拿掉（點姓名就到了） |
| 待追蹤「歷程」 | `FollowUpsTab.vue:209`、`:251` | 套規則。列上的「記錄聯絡」「排下次聯絡」不變 |
| 未預繳名單「查看」、訪視明細「更多→編輯」 | — | 不變 |

按鈕文字維持「歷程」：兩邊都通往同一份歷程內容。

訪視明細的 `vr` 網址參數與提示條保留，舊書籤仍然可用；只是預約明細不再產生這種連結。

### 6.2 返回

- 預約明細判斷來源的方式同今天的 `cameFromVisitList()`（`VisitDetailView.vue:804-813`，讀 `history.state.back`）。上一頁路徑是 `/admissions` 時，返回鍵文字改成「招生入學」，按下去 `router.back()`。招生的分頁、學年、學期、子分頁都存在網址，回去會停在原處。
- 其他來源維持今天的行為（從案件列表來用 `router.back()`，其他情況開 `/visit-requests`）。
- 「下一筆」維持只在從案件列表進來（帶 `list`）時出現。
- 招生頁沒有 keep-alive，返回會重新掛載、重新讀看板，剛換的階段會反映出來。
- 側欄高亮與麵包屑維持「參觀案件」（`AdminLayout.vue:45`）。

## 7. 後端與 API

| 變更 | 位置 |
|---|---|
| `FunnelCardOut` 加 `visit_request_id: uuid.UUID \| None` | `backend/app/admissions/schemas.py`（`has_visit_request` 在 `:293`）；`funnel.py:205-218` `_card()` 加一行 |
| `FollowUpRowOut` 加 `visit_request_id: uuid.UUID \| None` | `schemas.py`（`has_visit_request` 在 `:738`）；`follow_up.py:327` 加一行 |

- `has_visit_request` 保留（前端與既有測試還在用）。
- 跑 `npm run contract:generate` 更新 `contracts/openapi.json` 與 `contracts/generated/website-api.d.ts`，再跑 `contract:check`。
- 轉移契約 `contracts/ivy-recruitment` 是匯出格式，不受影響。
- 沒有 migration；部署前不需要備份。

## 8. 權限

不新增權限，沿用現有：

| 動作 | 需要 |
|---|---|
| 進預約明細 | `booking.read`（不變） |
| 看家庭版面 | 另需 `admissions.read` |
| 編輯招生資料、記錄聯絡、排下次聯絡、改負責人 | `admissions.write` |
| 移到… | 依 `transitionCapability`：`admissions.write` 或 `admissions.convert` |
| 招生入學點列跳到預約明細 | `booking.read`；沒有就開抽屜 |

今天 reception、campus_admin、super_admin 兩類權限都有（`backend/app/auth/permissions.py:36-54`），實際上大家都會看到家庭版面；判斷仍要寫，預防日後權限拆開。

## 9. 與園務的差異

園務點招生卡片一律開歷程抽屜（JourneyTimeline），也沒有官網預約模組。官網改成有預約的卡片開預約明細，屬於刻意分歧，寫進 DESIGN.md 新章節的「和園務分歧」，併入園務時一起決定。招生模組本身的資料、規則、統計都沒有分歧。

## 10. 測試與驗收

### 10.1 自動測試

- **後端 pytest**：
  - 看板卡片與待追蹤列有預約時回 `visit_request_id`，手動新增的回 `null`。
  - 契約測試照過。
  - 全套用獨立測試庫，由主 session 在背景跑。
- **後台 vitest**：
  - 開關關閉、沒有 `admissions.read`、已到場但沒有訪視三種情況，DOM 與今天一致（以既有 `visitDetails.test.ts` 等測試守門）。
  - 家庭版面：頁首階段與到場日、承辦人小字、撥號用招生電話；招生資料固定列與有值才列；收合區塊。
  - 聯絡紀錄合併排序、依到場時間標「參觀前／參觀後」、同時間的順序、參觀後讀取失敗的提示。
  - 案件歷程合併排序與來源小標；沒傳 `recruitmentEvents` 時輸出不變。
  - 處理區各權限組合下的按鈕；「移到…」選項等於 `moveTargets`；對話框儲存後畫面更新；409 重讀。
  - 補建後切換成家庭版面；快速切「下一筆」時舊回應不會蓋掉新的。
  - 招生三個入口：有預約＋`booking.read` 會 push 路由；沒有預約或沒有權限時開抽屜；「查看預約」連結已拿掉。
  - 返回鍵：上一頁是 `/admissions` 時文字是「招生入學」並呼叫 `router.back()`。
- **stack e2e（真 PostgreSQL）**：
  1. 補登一筆預約，標記已到場。
  2. 在預約明細看到家庭版面「已訪視」，記錄一筆聯絡。
  3. 移到已預繳。
  4. 回招生看板，卡片在「已預繳」。
  5. 點卡片回到同一筆預約明細，返回鍵寫「招生入學」，按下去回到看板。
  6. 另建一筆手動訪視，點卡片會開抽屜。

### 10.2 必跑指令

`npm --prefix admin run typecheck`、`npm --prefix admin run test:unit`、`npm run contract:check`、後端 pytest 全套、`npm run e2e:build` 後 `npm run test:e2e:stack`（招生與預約相關 spec）。機器只有 8GB，同時只跑一組。

### 10.3 畫面驗收

在 dev server 上用 Playwright 截桌機 1440 與手機 390：已訪視、已預繳（從招生點進來）、唯讀帳號、開關關閉四種，和 mock-up 對照；手機沒有橫向捲動。

### 10.4 驗收清單

| # | 驗收 |
|---|---|
| F1 | 有預約、已到場的家庭，預約明細能看到招生資料、合併聯絡紀錄、合併歷程，並能記錄聯絡、排下次聯絡、編輯、移到… |
| F2 | 招生看板、訪視明細、待追蹤點有預約的列會開預約明細；手動新增的開抽屜 |
| F3 | 從招生點進來，返回回到原分頁與篩選，看板反映剛才的變更 |
| F4 | 開關關閉、沒有招生權限、已到場但沒有訪視三種情況，畫面與改版前相同 |
| F5 | 後端新欄位、契約一致；沒有 migration |

## 11. 文件

- DESIGN.md 新增「預約明細當家庭頁（2026-10-05）」：條件、版面規則、入口規則、和園務分歧。
- README 頂部加日期段落；`docs/website-admin/acceptance.md` 補註 F1–F5。
- 修正已過時的規格段落（以 DESIGN.md 10-05「拿掉官網預約分頁」為準）：
  - 招生規格 §6.1 `:205-215` 仍寫「官網預約」分頁。
  - 追蹤規格 `:24` 引用已刪的 `ArrivalsTab.vue`、§7.5 `:283-290` 批次標記位置、`:491` 開開關後到「官網預約」分頁補建。
  - 追蹤規格 §7.6 的「參觀後追蹤」區塊改指向本規格。

## 12. 前提與實作順序

**開工前提**（兩個都是別的 session 進行中的工作）：

1. `feature/visit-no-pending-20261005`（`8b0efde2`，拿掉「待處理」，含 migration `1e5612e187ff`）進 main。它改了 `VisitRequestsView.vue`、`nav.ts`、`labels.ts`、`AdminLayout.vue`。
2. `feature/admissions-paper-fields-20261005`（招生訪視照紙本補欄位，含 migration `3fe1cfb2dbf7`，尚未 commit）進 main。它改了 `RecordDialog.vue`、`admissions/schemas.py`，招生資料面板依它的欄位。

注意：上述兩個 migration 的 `down_revision` 都是 `4373bcc82d9d`，後合併的那個要改接前一個，否則 main 會有兩個 alembic head。

兩個都進 main 後，把本分支 `feature/visit-family-page-20261005` rebase 到新的 main 再開工。worktree 在 `~/Repositories/ivy-website-wt/visit-family-page-20261005`（sparse；`npm ci`、`uv sync` 到時再跑）。

**步驟**（一個 session 做完）：

1. 後端兩個欄位、測試、`contract:generate`。
2. 抽出 `useFamilyAdmissions` 與元件，**行為不變**，既有測試全過。
3. 家庭版面（第 5 節）與測試。
4. 招生入口與返回（第 6 節）與測試。
5. stack e2e、Playwright 截圖對照 mock-up。
6. 文件（第 11 節）。

**部署**：push main 就是正式部署，由使用者自己執行；沒有 migration，不需要備份。部署後在 `deploy/README.md` 補紀錄，然後清 worktree。

## 13. 待裁定

無。以下是實作時的預設，使用者可以推翻：

- 撥號鈕用招生訪視的電話（招生資料是園方維護的那份）。
- 招生入口的按鈕文字維持「歷程」。
- `vr` 網址參數保留給舊書籤。
