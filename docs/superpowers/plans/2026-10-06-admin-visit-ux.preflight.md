# Pre-flight scan：2026-10-06-admin-visit-ux

- 對象：`docs/superpowers/plans/2026-10-06-admin-visit-ux.md`（4839 行，Task 0–12）
- 程式基準：worktree `feature/admin-visit-ux-20261006`，HEAD `3d50e0a1`（已確認）；sparse 含 `.github admin backend content contracts deploy docs scripts tests web`；`admin/node_modules`、`backend/.venv`、測試庫 `ivy_website_visitux1006_test` 都還沒有（Task 0 要建）
- 方法：逐 Task 讀計畫，用 grep／sed 對照 `3d50e0a1` 的程式與測試；只讀不跑測試
- 嚴重度：**阻擋**＝照計畫做必定紅燈或做不下去；**高**＝會紅燈或違反已定案規則；**中**＝行為／文案錯，或測試保護不足；**低**＝措辭、整潔、守門條件不準

---

## 1. 跨 Task 的共用介面

| # | 產出 → 消費 | 共用的東西 | 產出端規格 | 消費端用法 | 一致？ |
|---|---|---|---|---|---|
| I1 | T1 → T2 | `useVisitCase` 欄位（Hero） | return 有 `detail staff handled followUpTracked followUpDue familyPending familyVisit statusDisplay callPhone clockNow` | Hero 讀這 10 個欄位＋`injectVisitCase()` | ✅ |
| I2 | T1 → T3 | `useVisitCase` 欄位與方法（PrimaryAction） | `canHandle visitStarted familyPending familyVisit canReadAdmissions canCreateAdmissions admissionsAvailable('yes'\|'no'\|'unknown') lookupFailed pendingAction busy creatingAdmissions rebookOpen markCompleted markNoShow decideReschedule family.lookup/create` | `StageInput.admissionsAvailable` 型別和 `AdmissionsAvailability` 相同；T3 自己在 composable 加 `openAdmissionsForm` 並放進 return | ✅ |
| I3 | T2 → T3 | Hero 的 `<slot name="actions">`、`compact` | Hero props `{compact?}`，slot 位置在狀態與撥號之間 | T3 換成 `<VisitPrimaryAction :plain="compact" />` | ✅ |
| I4 | T1 → T4 | Timeline 用到的欄位 | `notes detail.history staff familyVisit familyLogs familyEvents extrasFailed family.loadExtras canHandle canCreateAdmissions newNote followUpAt followUpTracked followUpPast pendingAction busy addNote` 都在 return | `vc.staff`（`VisitStaffOut[]`）傳給 `TimelineInput.staff: (StaffPerson & {id})[]`，形狀相容；T4 把 `familyNoteList` 從 return 拿掉，view 的 toRefs 也要跟著刪 | ✅ |
| I5 | T1/T3 → T5 | Facts／Settings／Dialogs 用到的欄位 | `confirmedAtShown bookingDataOpen bookingDataTitle isWebCase manualRescheduleOpen rescheduleSlots rescheduleSlotId rescheduleReason canManage slotLabel chosenSlotText reschedule linkApplicable emailEnabled refreshDetail attendanceDue cancel rebookOpen onRebooked arrivalOpen arrivalLead admissionsVisit familyOptions family.replaceVisit/reload` | 都在 T1 的 return 清單裡 | ✅ |
| I6 | T3 → T5 | 取消提示文字、RecordDialog 的 `cancel-text`、FamilyActions 的 `primary` | T3 在 view 裡改成「家長沒來請用上方的「沒來」」，`arrivalLead ? ARRIVAL_FORM_CANCEL_TEXT : undefined`；`primary` 預設 true | T5 的 Settings／Dialogs 原樣搬過去；明細傳 `:primary="false"` | ✅ |
| I7 | T4 → T5 | Timeline 根元素的 class | `section.panel.case-timeline.detail__notes` | T5 在 1100px 以下用 `.detail__notes {order:3}`（子元件的根元素會拿到父層的 scope id） | ✅ |
| I8 | T2–T5 → T9 | 元件 props、`noteDirty`／`busy`、hooks | Hero `compact`、Facts `compact`、Timeline `limit`／`fullPath`、PrimaryAction `plain`、hooks `onChanged`／`onRebooked`、`FamilyActions.primary` | Preview 的用法都對得上；`useUnsavedChanges(computed(...), computed(...))` 的簽名相符 | ✅ |
| I9 | T1 → T2/3/4/5/8/9 測試 | `visitCaseKit.ts` | `VISIT_ID futureSlot pastSlot visitCase caseRoutes mountRoutes(path,{list,detail},{user,admissions})` | 各新測試的 import 與參數（T8 用 `{admissions:true}`、T3/T5 用 `{user}`）都存在 | ✅ |
| I10 | T6 → T7 | labels 與 API | `VISIT_VIEWS VisitView VISIT_VIEW_LABELS legacyStatusView`；後端 `view=upcoming\|past\|arrived\|cancelled`，`order=…\|visit_asc\|visit_desc`，`view-counts → {upcoming, past_unmarked}` | `listApiParams` 在「全部」不送 view（後端 `view=all` 會回 422，前後一致）；`loadCounts` 讀 `upcoming`／`past_unmarked` | ✅ |
| I11 | T6／T7 → 明細「下一筆」 | `list=` 帶的鍵 | 列表的 `detailTo` 帶 `view=…&order=visit_*` | T7 在明細的 `LIST_KEYS` 加 `'view'`；`order` 原本就收；後端接受 `visit_*` | ✅ |
| I12 | T7 → T8 | `listState`、`activeTab`、`detailTo`、`groupsByDay` | T7 的介面 | T8 用 `groupsByDay(listState.value)`、`:to="detailTo(row.id)"` | ✅ |
| I13 | T2 → T8 | `visitSchedule` 的基本函式 | `taipeiDay daysBetween slotStart slotEnd SlotTime` | T8 的 `dayBucket`／`visitPhase` 直接用 | ✅ |
| I14 | T8 → T9 | 列與清單 | `nextInList`、`VisitListRow` 的 `selected`／`previewable`、`openDetail(row)`、`requests`、`div.visit-list` | T9 把 props 改成綁 `selectedId`／`wide` | ✅ |
| I15 | T8 列元件 ↔ T8 的測試改寫 | 勾選欄點歪了不算點進案件 | `VisitListRow.onRowClick` 只排除 `a, button, input, label, .el-checkbox` | Step 9 叫 `visitRequestsBatch.test.ts`「點 `.visit-row__check`（span）後路徑仍是 `/visit-requests`」，但這個 span 不在排除名單裡，會 emit `activate` 然後換頁 | ❌（P4） |
| I16 | T3 程式 ↔ T3 測試 | 「記錄聯絡」改淺色 | Step 7 寫 `type="primary" :plain="!primary"`，產出的 class 是 `el-button--primary is-plain` | 測試斷言 `not.toContain('el-button--primary')` | ❌（P2） |
| I17 | T1 composable ↔ 既有測試的掛載方式 | `id` 是空字串時不讀 | Step 4「`load()` 開頭加 `if (!id.value) return`」 | `receptionUx20261002`、`ux20261005` 直接 `mount(VisitDetailView)`，路由是 `/:p(.*)*`，`route.params.id` 是 undefined，之前靠 mock 回應照樣讀得到 | ❌（P1） |
| I18 | T3 → T8 | 「填招生資料」的開法 | 明細用 `openAdmissionsForm()`：沒有 lead、取消鈕是「取消」 | 列表用 `arrival.openFor(row)`：lead 固定寫「已標記 ○○ 已到場…」、取消鈕固定「之後再填」、失敗時的警告也講「已標記已到場」 | △（P7） |
| I19 | T7 內部 | 匯出範圍說明 vs 實際送出的參數 | `hasFilters` 拿掉頁籤、`clearFilters` 不重設頁籤 | `exportCsv` 仍送 `view=upcoming`，但 `#export-scope` 寫「可見校區的全部案件」 | △（P6） |
| I20 | T7 → T10 | 返回鍵的文字 | `參觀案件（接下來）`（要從列表點進來，origin＝visit-list） | e2e 用 `getByRole('button', {name:'參觀案件（接下來）'})` | ✅ |
| I21 | T2/4/5/8/9 → T10 | e2e 選擇器 | `.case-hero__sub .case-hero__relative .case-facts dd .case-timeline .timeline__item[data-kind] .visit-row a.visit-row__main .visit-row__check .el-checkbox .visit-day__title aside[aria-label=案件預覽] .visit-preview__open` | 都在對應的 Task 裡 | ✅ |
| I22 | T4（刪 FamilyContactNotes）→ T10 | `.family-notes__item` | T4 刪掉元件 | `tests/stack/admissions-follow-up.spec.ts:130` 還在用 `.family-notes__item`，T10 Step 1 只改到該檔的 `.requests-table tr` | ❌（P5） |
| I23 | T10 新 spec ↔ 既有 spec | `submitPublicRequest` 的 Idempotency-Key＝`e2e-${campus}-${phone}` | 新 spec 用 `SECOND_CAMPUS`＋`0912000661` | `booking-flow.spec.ts:180` 已經用同一組送「分頁甲家長」；payload 不同、key 相同，後跑的那支 beforeAll 會失敗 | ❌（P3） |

---

## 2. 各 Task 是否自洽

| Task | 測試 vs 程式 | 新建檔 vs 之後的修改 | 引用的路徑／符號／行號（抽查） | 判定 |
|---|---|---|---|---|
| T0 | — | — | alembic 指令只設 `WEBSITE_DATABASE_URL`，沒設 `WEBSITE_TEST_DATABASE_URL`；`config.py:249-251` 在 `environment=test` 時沒有測試庫網址會直接 raise，`migrations/env.py:37` 用的是 `active_migration_database_url()`（test 環境＝測試庫）。Step 3 括號裡的 `uv run pytest tests/test_visit_groups.py -q` 沒帶環境變數，會落到 conftest 預設的 `ivy_website_test`（共用庫） | ❌ P8、P9 |
| T1 | 新測試 3 個 it 和程式對得上（`mockGet` 支援函式值、`pathsTo` 用前綴、`markNoShow` 呼叫 `api.post(path)` 只帶一個參數、`statusDisplay.label` 是「預約正常」）。但加了 `if (!id.value) return` 之後，Step 6 清單裡的 `receptionUx20261002` 會紅，Step 6 又規定「不要改測試」 | `useVisitCase` 的 return 清單就是後面所有 Task 的介面，T3（加 `openAdmissionsForm`）、T4（刪 `familyNoteList`）都有寫明 | 行號 41–60、84–98、103–106、111–201、317–420、421–498、503–507、518–614、617–685、707–725、776–780 都對得上 `3d50e0a1`。三個小落差：①61–71 包含 67–68 的 `rescheduleSelect`／`rescheduleTitle`，但同一段又說「不搬」；②第 70 行 `readVisitNoteDraft(route.params.id)` 用到 `route`，composable 裡要改成 `id.value`，計畫沒寫；③骨架在模組層宣告了 `DETAIL_STALE_MS`，111–201 又把第 118 行搬進來，會重複宣告。46 行的 `isFamily`、`familyStaff`、`familyOptions`、`extrasFailed` 也要改成 `family.*`，替換清單沒列全（typecheck 會抓到） | ❌ P1；低 L1 |
| T2 | `relativeVisitTime` 9 個案例我逐一算過，都對；Hero 測試的 `10:00–11:00`、`結束了 2 小時`、`撥號`、aria-label 也都對 | Hero 的 slot 在 T3 換掉、CSS 從 view 搬走，前後一致 | `Phone`、`StatusTag`、`stageMeta`、`arrivedLabel`、`staffEmailById` 都存在；`ux20260928B2:227` 確實有 `撥電話給家長`，同一個 it 沒有「只在手機」的斷言 | ✅ |
| T3 | `caseStage` 的表 13 列和實作相符；`/complete`、改期申請淺色／實心、名額不足、唯讀、建立招生訪視這幾個 it 都對。**「記錄聯絡」那個 it 會紅**（I16） | `FamilyActions.primary` 由 T5、T9 消費 | `cancel()` 第 423 行的字串、`.detail__danger` 第 1044 行都對；受影響的測試檔都在。`caseHandling:113-114` 用的是 `button(wrapper,'標記已到場')…toBeUndefined()`，Step 9 只說找「按鈕文字 === '…'」，如果沒一起改，這兩行會變成永遠通過的空斷言 | ❌ P2；中 M4 |
| T4 | `buildTimeline` 4 個 it 我逐一算過，都對（配對、排序、家庭版面的 phase／source、`排下次聯絡 2026/10/10 10:00`）；元件測試的 `logCalls=2`、`data-phase=before`（`arrivedAt` 是 null 時 cut＝∞）也都對 | 刪 `FamilyContactNotes`／`VisitHistoryTimeline`：其他程式沒有人引用（grep 只剩 view 和 `familyNotesHistory.test`） | `familyNotes`／`familyHistory`／`personLabel`／`recruitmentEventChanges`／`eventLabel`／`visitEvent*`／`staffOf(…,'actor')` 都存在；`RecruitmentEventOut` 有 `reason`、`actor_name`。刪掉的 `familyNotesHistory.test.ts` 裡「讀不到又沒有紀錄時不寫『還沒有紀錄』」「唯讀只看到一句」沒有搬到新測試，新元件在那種情況會同時寫兩句 | ✅；中 M5 |
| T5 | 設定列測試「`.detail__actions > .reschedule--collapsed` 的文字 toBe『改到其他場次…』」，同時 Step 5 要「收合時的連結下面加一行 hint」；如果那行放進 `.reschedule--collapsed` 裡面，這個測試和 `ux20261005`、`receptionUx` 都會紅 | 最終版面的 class（`detail__family-actions`、`detail__family-data`、order 1–5）在測試與 CSS 兩邊一致 | `formatDate` 輸出 `2022/05/01`（zh-TW）；`ParentAccessLinkPanel` 是單一根元素，`class` 能 fallthrough；沒有連結時文字是「還沒有產生連結。」；`FamilyAdmissionsData` 的根元素是 `section.panel.family-data` | △ M3 |
| T6 | 後端 5 個測試和實作對得上：`create_slot(days_ahead=)`、`booking_consent`、`minghua_client`、`set_booking_mode` 都在；CSV 的 `row[3]`＝「家長」；dashboard 的鍵是 `awaiting_attendance`；同時間依 `created_at` 排，順序穩定 | `legacyStatusView` 在 T6 加、T7 用；`legacyStatusGroup` 在 T7 刪 | `status_groups` 已經 import `date`、`and_`、`now_utc`、`OPERATING_TZ`；`routes.py` 的 `VisitRequestFilters`（858）、`audit_metadata` 的 `"group"`（945）、list（957）、group-counts（974）、export（1062）都在 `/{visit_request_id}`（1261）之前；`labelCoverage` 會讀 `audit_metadata` 的鍵，T6 有補 `view` 標籤 | ✅ |
| T7 | `visitListQuery` 的 19 個舊連結案例、round-trip、API 參數、`searchTerm` 我都算過，都對 | `activeTab`、`listState` 被 T8、T9 用 | `DashboardView:437-438`、`shellDashboard:106`、`uxRound6:108-112`、`openRequestsUx:110-134`、`receptionUx:209-226`、`attentionExportDeadline:82-101` 的行號都對。`arrivalAdmissionsForm`、`visitRequestsBatch` 還在 mock `group-counts`（沒有列在要改的清單），但打 `view-counts` 時會落到 `/admin/visit-requests` 前綴拿到陣列，數字變 0，不會壞 | △ P6 |
| T8 | `visitSchedule` 新增的分組、狀態、`nextInList` 案例算過都對；清單測試的標題、`10:00`／`進行中`、換日重讀（`watch(today)`）、批次全選、平鋪時寫「送出」、1280 以下換頁，也都對 | `VisitListRow` 的 props／emits 被 T9 消費 | `formatWeekday`、`formatTime`、`attendanceDue`、`useArrivalAdmissionsForm().opensForm/openFor` 都存在；`visitRequestsBatch` 改寫的指示和列元件矛盾（I15）；`uxRound6:186-195`、`openRequestsUx:120` 的行號都對 | ❌ P4；中 P7 |
| T9 | 6 個 it 和實作對得上：`matchMedia` stub 讓 `wide` 成立；取消後 `onChanged` → 列表重讀 → `nextInList` 遞補 r3；淺色斷言把 link／text 鈕排除；時間線 4 筆列 3 筆＋「還有 1 筆」 | 只消費前面的 Task | `useNarrowScreen(query)`、`useUnsavedChanges`（裡面有 `onBeforeRouteLeave`，子元件可用）、`ArrowDown` 都存在 | ✅（R22 例外見 L4） |
| T10 | — | 新 spec 和既有 spec 撞 key（I23）；`admissions-follow-up.spec.ts:130` 沒改到（I22） | `submitPublicRequest`、`gotoAdmin`、`SECOND_CAMPUS`、`storageStatePath`、`dynamicParts` 都存在；stack 預設 viewport 是 1440×900，`booking-flow` 用 reception 帳號開預覽沒問題；只有 `visit-detail` 這張基準圖要重拍 | ❌ P3、P5 |
| T11 | — | — | Step 4「grep 承辦 沒有輸出」：`VisitRequestsView.vue:43-44` 的 `openOnly` 註解提到承辦人，這段會保留，所以一定有輸出；「diff 只在 File Structure 表列的檔案」：表裡沒列多數改到的測試檔（listUx、visitGroups…），一定不成立。`alembic heads` 不會執行 env.py，所以沒帶測試庫網址也不會壞 | 低 L2 |
| T12 | — | — | README 第一行就是 `## 2026-10-06 成效統計…`，沒有 `# …` 標題，「`#` 標題之後」的定位要改成「檔頭」；DESIGN.md 第 1 行是 `# Design`、第 3 行是「官網後台總覽」，插入位置正確 | 低 L3 |

---

## 3. 審查標準會當成缺陷的強制要求

| # | Task | 計畫的要求 | 為什麼會被判缺陷 | 建議 |
|---|---|---|---|---|
| D1 | T1 Step 6 | 「既有測試一個都不用改…有紅燈…不要改測試」，同時又要加 `if (!id.value) return` | 兩條指令互相矛盾，實作者只能違反其中一條 | 刪掉 guard（Preview 是 `v-if="selectedId"` 才掛，`id` 永遠不會是空的） |
| D2 | T3 Step 9 | 只叫實作者改「按鈕文字 === '標記已到場'」 | `caseHandling:113-114` 的 `toBeUndefined()` 如果保留舊字，會變成永遠通過、檢查不到東西的斷言 | 明寫：包含 `button(wrapper,'標記已到場'/'標記未到場')` 在內，全部換成新字 |
| D3 | T4 | 刪 `familyNotesHistory.test.ts`，並說「案例移到上面兩個新測試」 | 有 2 個情境（讀不到又沒有紀錄、唯讀的空狀態）沒有搬過去，等於刪測試卻沒有等價覆蓋 | 在 `visitCaseTimeline.test.ts` 補兩個 it，元件同時修成讀不到時不寫「還沒有紀錄」 |
| D4 | T3 PrimaryAction CSS | `@media (max-width:900px)` 和 `.case-hero__actions--stacked` 兩段宣告逐字重複 | 審查會判成同一段樣式貼兩份 | 改成共用的 selector list，或用 `:is()` 合併 |
| D5 | T3／T8 | `opensForm`（`admissionsAvailable==='yes' && canCreateAdmissions`）在 PrimaryAction 和 `markCompleted` 各算一次；`followUpDue` 在 `VisitListRow` 和 `useVisitCase` 各寫一次 | 規則重複，日後只改一邊就會不一致 | `opensForm` 放進 `useVisitCase` 的 return；列的 `followUpDue` 抽成 `visitSchedule` 的純函式 |
| D6 | T5 `visitCaseLayout` 第 2 個 it | 用 regex 讀 SFC 的 CSS 原始碼 | 測的是實作細節，偏脆；不過 repo 已有前例（`ux20261005`） | 可以接受，但在 T11 的 1100px Playwright 上驗實際的排列順序（T10 已經有一半） |
| D7 | T11 Step 4 | 「grep 沒有輸出」「diff 只在表列檔案」 | 守門條件一定會失敗（見 T11 列），閘門形同虛設 | 改成「新加的程式沒有承辦」，以及「diff 只在各 Task 的 Files 段列出的檔案」 |

（沒有發現完全沒有斷言的測試。）

---

## 4. 和既有規則的衝突（CLAUDE.md、DESIGN.md 的後台定案）

| 規則 | 計畫的做法 | 結果 |
|---|---|---|
| 十級字級 token（第九輪） | 全部用 `var(--text-*)`；grep 計畫沒有 `font-size: Npx`；用到的 token 都在 `style.css:57-66` | ✅ |
| 不用彩色側條（第九輪） | `.timeline__dot` 是四邊 2px（不是側邊）；選中的列只換底色 | ✅ |
| 列表用 plain 鈕（第九輪、10-06 行程板） | 列內「到了」是 `primary plain`，「填招生資料」是 link，批次鈕是 plain | ✅ |
| 實心主色一頁一顆 | 明細只有頁首主鈕；Timeline「新增紀錄」、明細的「記錄聯絡」都改成 plain。**例外**：`ParentAccessLinkPanel` 產生連結後出現的「複製連結」是實心 `type="primary"`，在預覽裡違反 R22，在明細裡會變成兩顆實心 | 低 L4（原本就有，但預覽是新的情境） |
| 危險確認框 `autofocus: false`（第七輪明寫包含取消預約） | `cancel()` 的 `ElMessageBox.prompt` 原本就沒有 `autofocus: false`，T1 原樣搬過去，T3 改這段文字時也沒補 | 中 M6（Global Constraints 自己寫了這條，但沒有落實） |
| 承辦人已拿掉（10-06） | mock 裡的承辦相關設計一律不做；舊連結 `?assignee=…&open=1` 落到「全部」 | ✅ |
| 拿掉待處理（10-05） | 頁籤裡沒有 pending；`group=pending` 落到「全部」 | ✅ |
| 到場後接著開 RecordDialog（10-06） | 明細、列表、預覽三個入口都保留；批次不開 | ✅（但列表的「填招生資料」借用 `openFor`，文案講成「已標記到場」，見 P7） |
| 操作色青藍、錯誤走 notify | 用 `--admin-accent*`；新程式沒有 `ElMessage.error/warning` | ✅ |
| 三層標題、取消在最底、下一筆、離頁保護 | 都保留；DESIGN 的「取代的舊規則」有列第五輪 `order=oldest`、第六輪 `list=`、第九輪手機順序與欄寬 | ✅ |
| Global Constraints 的色票清單 | 清單沒有 `--el-color-warning-*`、`--radius*`、`--top-h`、`--el-color-primary`，但計畫自己的 CSS 和原本搬過來的 CSS 都有用到 | 低 L5（清單要放寬，不是程式錯） |

---

## 5. 環境

| 項目 | 計畫寫的 | 判定 |
|---|---|---|
| 新測試庫先 `alembic upgrade head` | T0 Step 2 有這一步，但指令是 `WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=…visitux1006_test …`，**沒有設 `WEBSITE_TEST_DATABASE_URL`**，會被 `config.py:249-251` 擋下（`test 環境必須明確設定 WEBSITE_TEST_DATABASE_URL`），庫沒有 migrate，T0 Step 3 和 T6 的 pytest 都會失敗 | ❌ P8：換成指定指令 `cd backend; WEBSITE_SESSION_SECRET=test-only-secret-please-rotate WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_visitux1006_test uv run alembic upgrade head` |
| T0 Step 3 的 pytest | `uv run pytest tests/test_visit_groups.py -q` 沒有帶 `WEBSITE_TEST_DATABASE_URL`，會落到 conftest 預設的 `ivy_website_test`（別的 session 也在用） | ❌ P9：前面補 `WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_visitux1006_test` |
| 其他 pytest 指令 | Global Constraints、T6、T11 都帶了 `visitux1006_test` | ✅ |
| stack e2e 獨立 DB 與埠 | T10 Step 4、T11 Step 3 都 `export E2E_DB_NAME=ivy_website_visitux1006_e2e_test E2E_API_PORT=8761 E2E_WEB_PORT=3761`，避開 8710／3710；跑完 `dropdb`；build 輸出在 worktree 裡（`web/public/admin`、`output/e2e-stack`），不會撞到別人 | ✅。注意：shell 的 export 不會留到下一次 Bash 呼叫，所以 export 和 `test:e2e:stack` 要放在同一次呼叫 |
| e2e 送單限流 | `SUBMIT_LIMIT_BY_SOURCE_CAMPUS` 是每來源每校每小時 5 筆；目前 minghua 有 4 筆（booking-flow 2、visual 1、roles 1），新 spec 再加 1 筆剛好 5，完全沒有餘裕 | 低 L6：確認 Playwright retries＝0，或新 spec 改用後台補登 API 建案（號碼撞 key 是另一個問題，見 P3） |
| subagent 與長測試 | 全套 vitest／pytest／stack 都交給 controller；pytest 在背景跑 | ✅ |

---

## 問題總表（依嚴重度）

| ID | 嚴重度 | Task | 問題 | 建議裁定 |
|---|---|---|---|---|
| P1 | 阻擋 | T1 | `load()` 的 `if (!id.value) return` 會讓 `receptionUx20261002`（在 T1 Step 6 的清單裡）和 `ux20261005` 直接 mount 的明細永遠停在骨架；Step 6 又禁止改測試 | 刪掉 guard（預覽只在有 `selectedId` 時掛載）；T1 Step 6 補上 `ux20261005 arrivalAdmissionsForm bookingConsentReadiness openRequestsUx` |
| P8 | 阻擋 | T0 | alembic 指令少了 `WEBSITE_TEST_DATABASE_URL`，Settings 驗證失敗、測試庫沒有 migrate | 換成使用者指定的指令（見第 5 節） |
| P2 | 高 | T3 | 「記錄聯絡改淺色」的斷言 `not.toContain('el-button--primary')` 和 Step 7 的 `type="primary" plain` 矛盾，必紅 | 改測試成 `toContain('is-plain')`（和核准改期的斷言同一種寫法，也符合 plain 主色鈕規則） |
| P3 | 高 | T10 | `visit-schedule.spec` 用 `minghua`＋`0912000661`，和 `booking-flow.spec.ts:180` 同一個 Idempotency-Key、不同 payload，後跑的那支會失敗 | 換一個沒用過的號碼，例如 `0912000881` |
| P4 | 高 | T8 | `visitRequestsBatch` 改寫要求點 `.visit-row__check` 不換頁，但 `onRowClick` 沒排除這個 span，會 emit `activate` | `closest()` 加上 `.visit-row__check`（符合原本「點歪了不算」的規則） |
| P5 | 高 | T10 | `admissions-follow-up.spec.ts:130` 的 `.family-notes__item` 沒列進要改的清單，T4 刪元件後會紅 | 改成 `.timeline__item[data-kind="note"]` |
| P9 | 中 | T0 | Step 3 的 pytest 沒帶測試庫網址，會連到共用的 `ivy_website_test` | 補上 env |
| P6 | 中 | T7 | 頁籤不算篩選以後，`#export-scope` 寫「全部案件」，實際卻送 `view=` 只匯出一個頁籤；「清除篩選」後的空狀態也還在說「查看全部案件」 | 匯出說明把頁籤算進去（例如「匯出範圍：「接下來」的全部結果」），或在「全部」以外的頁籤一律視為有篩選 |
| P7 | 中 | T8 | 列表的「填招生資料」用 `openFor`，表單寫「已標記○○已到場」、取消鈕是「之後再填」、失敗警告也這樣講，和明細 `openAdmissionsForm`（沒有 lead）不一致 | `openFor(row, { justArrived: false })`：不寫 lead、取消鈕維持預設、失敗時改用中性文案；列表的 RecordDialog `cancel-text` 跟著 lead 決定 |
| M3 | 中 | T5 | 收合時新加的「改好後原場次的名額會空出來。」位置沒講清楚，放進 `.reschedule--collapsed` 裡面會讓 3 個測試的 `toBe('改到其他場次…')` 紅掉 | 明寫放在 `.reschedule--collapsed` 外面、當它的下一個兄弟元素 |
| M4 | 中 | T3 | 改按鈕文字的指示沒涵蓋 `button(wrapper,'標記…')…toBeUndefined()`，不改就變成空斷言 | 明寫全部替換 |
| M5 | 中 | T4 | 刪掉的 `familyNotesHistory` 案例沒搬；讀不到又沒有紀錄時會同時寫兩句 | 補兩個 it，元件改成讀不到時不寫「還沒有紀錄」 |
| M6 | 中 | T1／T3 | 取消預約的 prompt 沒有 `autofocus: false`（第七輪規則，Global Constraints 也重申） | 在 T3 Step 4 改取消文字時一起補 |
| L1 | 低 | T1 | 搬移範圍和「不搬」清單有重疊、第 70 行的 `route`、`DETAIL_STALE_MS` 重複宣告、`isFamily` 等沒列進替換清單 | 在 Step 4 註記 |
| L2 | 低 | T11 | 兩個守門條件一定失敗（承辦註解、File Structure 沒列測試檔） | 改寫成可以成立的條件 |
| L3 | 低 | T12 | README 沒有 `#` 標題 | 改成「插在檔頭」 |
| L4 | 低 | T5／T9 | 「複製連結」是實心主鈕，在預覽裡違反 R22 | 放在設定列時改成 plain，或明列成例外 |
| L5 | 低 | 全域 | 色票清單比計畫自己用的 token 還窄 | 放寬清單：加入 `--el-color-warning-*`、`--el-color-primary`、`--radius*`、`--top-h` |
| L6 | 低 | T10 | minghua 送單加上新 spec 後剛好到每小時 5 筆的上限（yihua 也已經 4 筆），沒有餘裕 | 確認 Playwright retries＝0；或新 spec 改用後台補登 API 建案，不經公開送單 |
