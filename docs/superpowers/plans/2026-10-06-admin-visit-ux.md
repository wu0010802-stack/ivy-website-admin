# 參觀案件明細時間線（C）與案件列表行程清單（B）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 案件明細改成「頁首一顆主動作＋一條時間線＋家長資料表＋設定列」（方向 C）；參觀案件列表改成「接待語意頁籤＋依參觀日分組的行程清單＋1280 以上右側預覽面板」（方向 B），預覽面板重用明細的元件。

**Architecture:** 先把 `VisitDetailView` 的資料層與所有動作抽成 composable `useVisitCase`（回傳 `reactive`，用 provide／inject 交給子元件），明細畫面再拆成 `VisitCaseHero`／`VisitPrimaryAction`／`VisitCaseTimeline`／`VisitCaseFacts`／`VisitCaseSettings`／`VisitCaseDialogs`。列表的網址與 API 條件抽成純模組 `api/visitListQuery.ts`，台北日期分組、相對時間在 `utils/visitSchedule.ts`，一列是 `VisitListRow`，1280 以上的 `VisitPreviewPanel` 用同一個 composable 與同一組元件。後端只加列表的 `view` 篩選、依參觀時間排序與 `GET /admin/visit-requests/view-counts`，不改舊的 `group` 語意，沒有 migration。

**Tech Stack:** Vue 3.5 + TypeScript + Element Plus + Vue Router 4 + Pinia（admin）、Vitest 4 + @vue/test-utils（jsdom）、FastAPI 0.136.1（釘版）+ Pydantic + SQLAlchemy 2 async + PostgreSQL、pytest（asyncio）、Playwright stack e2e。

**Spec:** 結構層比稿 `design/admin-ux-directions-20261006/`（`README.md`、`index.html` 左現況右 mock 與理由、`c-detail.html`、`b-visits.html`、`shots/c-detail-*.png`、`shots/b-visits-*.png`、`shots/current/`）＋本計畫的「已定案」「裁定」兩節。比稿目錄在這個 worktree 是未追蹤檔，**不要 commit**。DESIGN.md 相關章節：官網後台總覽：今天的行程板、參觀案件拿掉承辦人、標記已到場後接著填招生資料、拿掉「待處理」、拿掉舊狀態程式、預約明細當家庭頁、第九輪、第八輪、第七輪、第六輪、第五輪、第四輪。

## 已定案（使用者 10-06，照做、不再問）

- 順序先 C 後 B，同一分支 `feature/admin-visit-ux-20261006`、同一份計畫。C 拆出的元件給 B 的預覽面板重用，不另寫一套。
- **承辦人 10-06 已拿掉**：mock 裡的承辦人欄、「指派給我」、承辦人篩選、「承辦：怡君」一律不做。（招生的「負責人」是另一件事，FamilyActions 照舊。）
- 現有功能一個都不能少（見「現有功能 → 新位置」）。
- B 的頁籤語意要對到後端；需要的後端改動寫進計畫並重產 contracts。舊連結（總覽、統計、招生看板、通知、側欄、書籤）要相容。
- 既有設計規則：十級字級 token、不用彩色側條、列表用淺色（plain）主色鈕而實心主色一頁一顆、取消預約在面板最底、明細三層標題與返回連結保留、操作色維持青藍、錯誤提示走 `composables/notify.ts`。

## Global Constraints

- worktree：`/Users/yilunwu/Repositories/ivy-website-wt/admin-visit-ux-20261006`（sparse checkout），分支 `feature/admin-visit-ux-20261006`，基準 origin/main `3d50e0a1`。只在這裡讀寫，不動 `~/Desktop/ivy-website-admin` 或其他 worktree。下文 `$WT` 都指這個路徑。
- 介面文字繁體中文（台灣用語）；不寫「載入中」以外的新開發輔助字（現有的保留）。
- 字級只用 `admin/src/style.css` 的 `--text-xs`…`--text-5xl`，不寫 `font-size: Npx`；不寫 2px 以上彩色 `border-left/right` 或 `inset` 側條；`transition` 不動 width／height／max-height（`ux20261005.test.ts` 全 src 掃描守門）。顏色只用 `style.css` `:root` 的 token（`--admin-accent*`、`--status-live*`、`--brand-gold-ink`、`--ink*`、`--line*`、`--surface*`、`--el-color-primary-light-*`），元件不寫色碼。
- 錯誤與警告只用 `notifyError`／`notifyWarning`，不直接呼叫 `ElMessage.error`／`ElMessage.warning`（`crossUx20261002.test.ts`）；`ElMessage.success`／`info` 可以。危險確認框（取消預約、撤銷連結）確定鈕 `el-button--danger`、`autofocus: false`、否定鈕「先不要」。
- 一頁只有一顆實心主色鈕：明細是頁首主動作；列表是「補登案件」，列內與預覽面板的按鈕一律 `plain` 或文字鈕。
- 不新增 npm／Python 套件；FastAPI 維持 0.136.1；**不新增 migration**、不改資料表、不改權限表（`backend/app/auth/permissions.py`）與轉移契約 `contracts/ivy-recruitment`。
- 權限只看 capability（`usePermissions().can(...)`）：`booking.read`／`booking.handle`／`booking.manage`／`booking.export`／`admissions.read`／`admissions.write`；後端路由用 `require_scope`，不寫角色判斷。
- 時間一律以台北（`Asia/Taipei`）計算：前端用 `Intl` 加 `timeZone`、場次字串加 `+08:00`；後端用 `OPERATING_TZ`、`today_local`、`now_utc`。不用瀏覽器本地時區。
- Node 22（`.nvmrc` 22.23.2）。每個指令開頭：`cd $WT; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; …`（`source` 會回傳 3，所以用分號，不用 `&&`）。
- 前端單檔測試：`cd $WT; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; cd admin; npx vitest run src/__tests__/<檔名>.test.ts`。
- 後端單檔測試：`cd $WT/backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_visitux1006_test uv run pytest tests/<檔名>.py -q`。測試庫只用 `ivy_website_visitux1006_test`，不連開發庫、正式庫或別的 session 的測試庫。
- **實作者（subagent）只跑自己 Task 列出的單檔測試**，一次一個檔；admin 全套 vitest、typecheck、後端全套 pytest、stack e2e 只在 Task 11 由 controller（主 session）跑。機器 8GB RAM：同時只跑一組測試；subagent 超過 10 分鐘沒輸出會被中止，長測試一律交給 controller。
- 每個 Task 結尾 commit：只 `git add` 列出的檔案（不用 `git add .`／`-A`／`commit -a`），Conventional Commit、繁體中文，訊息最後一行 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。**不 push、不合 main、不部署、不碰正式庫**（push main＝正式部署）。
- 行號以 `3d50e0a1` 為準；前面的 Task 改過之後行號會位移，一律用計畫給的搜尋字串定位。
- 這些 class 名稱有測試或 stack spec 依賴，搬家時保留（除非該 Task 明寫要改並同步改測試）：`.detail__head`、`.detail__title`、`.detail__handled`、`.detail__when`、`.detail__follow`、`.detail__status`、`.detail__status-sub`、`.detail__status-pending`、`.detail__call`、`.detail__back`、`.detail__next`、`.detail__attendance`、`.detail__admissions`、`.detail__actions`、`.reschedule`、`.reschedule--collapsed`、`.reschedule__toggle`、`.reschedule__title`、`.reschedule-request`、`.detail__danger`、`.detail__cancel`、`.detail__data`、`.detail__link`、`.detail__family-pending`、`.notes__form`、`.notes__row`、`.notes__follow`、`.notes__untracked`、`.notes__hint`、`.notes__status`、`.notes__past`、`.notes__author`、`.timeline__item`、`.timeline__actor`、`.timeline__source`、`.family-data`、`.family-actions*`、`.attendance-actions`、`.status-tab`、`.status-tab__count`、`.order-select`、`.more-filters`、`.requests-filters`、`.filter-chip(s)`、`.filter-field--campus`、`.requests-batch`、`.requests-empty`、`.pager`、`#export-scope`。聯絡紀錄 `textarea[aria-label="新增聯絡紀錄"]` 必須是明細頁上**第一個** textarea，「下次聯絡」必須是**第一個** `ElDatePicker`（8 個測試檔這樣找）。

## File Structure

| 路徑 | 動作 | 責任 |
|---|---|---|
| `admin/src/composables/useVisitCase.ts` | 新增（Task 1） | 一筆案件的資料層與所有動作（讀取、靜默重讀、到場、未到場、取消、改期、核准退回、聯絡紀錄、家長連結後重讀、招生）；provide／inject |
| `admin/src/composables/visitCaseStage.ts` | 新增（Task 3） | 純函式 `caseStage`：依狀態、權限、場次時間、招生可用性決定頁首主動作 |
| `admin/src/utils/visitSchedule.ts` | 新增（Task 2）、擴充（Task 8） | 台北日期、相對時間「結束了 2 小時」、日期分組、列的接待狀態、「下一筆」 |
| `admin/src/api/visitTimeline.ts` | 新增（Task 4） | 純函式 `buildTimeline`：聯絡紀錄＋案件歷程（家庭版面再加參觀後聯絡與招生事件）合成一條 |
| `admin/src/api/visitListQuery.ts` | 新增（Task 7） | 列表網址 ↔ 狀態 ↔ API 參數；舊連結對照；電話搜尋正規化 |
| `admin/src/api/labels.ts` | 修改（Task 6、7） | `VISIT_VIEWS`、`VISIT_VIEW_LABELS`、`legacyStatusView`、操作紀錄 `view` 標籤；拿掉沒有呼叫端的 `legacyStatusGroup` |
| `admin/src/components/visit/VisitCaseHero.vue` | 新增（Task 2） | 頁首：家長・孩子、來源、最後處理、參觀時間＋相對時間、預定聯絡、狀態、撥號、主動作 |
| `admin/src/components/visit/VisitPrimaryAction.vue` | 新增（Task 3） | 頁首主動作：家長到了／沒來、核准退回改期申請、填招生資料、建立招生訪視、重新預約、提示 |
| `admin/src/components/visit/VisitCaseTimeline.vue` | 新增（Task 4） | 時間線：最上面的聯絡紀錄輸入框（含下次聯絡），下面一條合併紀錄 |
| `admin/src/components/visit/VisitCaseFacts.vue` | 新增（Task 5） | 家長資料表（家庭版面可收合） |
| `admin/src/components/visit/VisitCaseSettings.vue` | 新增（Task 5） | 設定列：場次（改期表單）、家長管理連結、最底的取消預約 |
| `admin/src/components/visit/VisitCaseDialogs.vue` | 新增（Task 5） | 重新預約 `ManualVisitDialog`、招生資料 `RecordDialog` |
| `admin/src/components/visit/VisitListRow.vue` | 新增（Task 8） | 列表的一列（桌機一行、手機卡片） |
| `admin/src/components/visit/VisitPreviewPanel.vue` | 新增（Task 9） | 1280 以上右側預覽：同一組 VisitCase 元件＋「打開完整案件頁」「下一筆」 |
| `admin/src/components/ParentAccessLinkPanel.vue` | 修改（Task 5） | 外觀改成設定列（h2 → 列標籤），邏輯與文字不動 |
| `admin/src/components/visit/FamilyActions.vue` | 修改（Task 3） | 加 `primary` prop（明細傳 false：「記錄聯絡」改淺色） |
| `admin/src/components/visit/FamilyContactNotes.vue`、`admin/src/components/VisitHistoryTimeline.vue` | 刪除（Task 4） | 由 `VisitCaseTimeline` 取代 |
| `admin/src/views/VisitDetailView.vue` | 修改（Task 1–5、7） | 只剩組裝、返回、下一筆、離頁保護 |
| `admin/src/views/VisitRequestsView.vue` | 修改（Task 7–9） | 頁籤、篩選、網址、分頁、行程清單、批次、預覽面板 |
| `admin/src/views/DashboardView.vue` | 修改（Task 7） | 「今天有 N 組參觀」連結不再帶 `order=oldest` |
| `admin/src/__tests__/visitCaseKit.ts` | 新增（Task 1） | 新測試共用：案件假資料、路由掛載 |
| `backend/app/booking/status_groups.py` | 修改（Task 6） | `VIEWS`、`view_condition` |
| `backend/app/booking/routes.py` | 修改（Task 6） | 篩選 `view`、排序 `visit_asc`／`visit_desc`、`GET /admin/visit-requests/view-counts` |
| `backend/app/booking/schemas.py` | 修改（Task 6） | `VisitViewCountsOut` |
| `backend/tests/test_visit_views.py` | 新增（Task 6） | 頁籤、排序、件數、匯出、校區範圍 |
| `contracts/openapi.json`、`contracts/generated/website-api.d.ts` | 重產（Task 6） | `npm run contract:generate` |
| `tests/stack/*.spec.ts`、`tests/stack/visual.spec.ts-snapshots/visit-detail-chrome-darwin.png` | 修改、重拍（Task 10） | 新選擇器、新基準 |
| `README.md`、`DESIGN.md`、`docs/website-admin/acceptance.md` | 修改（Task 12） | 日期紀錄、規則、驗收 |

## 現有功能 → 新位置

明細（`VisitDetailView`，原本六段：資料表、聯絡紀錄、家長管理連結、歷程、處理面板、招生訪視）：

| # | 現有功能 | 新位置 | Task |
|---|---|---|---|
| D1 | 返回（招生入學／參觀案件；從列表來用 `router.back`，其他 push 列表） | 頁面頂端照舊；從列表來寫「參觀案件（接下來）」帶頁籤名 | 7 |
| D2 | 下一筆（照來源列表或固定優先序、件數、title、`router.replace`、打字中先問） | 頁面頂端照舊（`VisitDetailView`） | 1 保留 |
| D3 | 讀不到（404 文案）、骨架 | 照舊 | 1 |
| D4 | 家長名 h2、校區・送出時間・來源補登・登錄者、最後處理、重新預約自 | `VisitCaseHero`（h2 改「家長・孩子」） | 2 |
| D5 | 參觀時間、預定聯絡／已到預定聯絡時間 | `VisitCaseHero`（參觀時間旁加「結束了多久／還有幾天」） | 2 |
| D6 | 狀態標籤＋副標；家庭版面招生階段＋「MM/DD 到場」；查招生中的空位 | `VisitCaseHero` 右側 | 2 |
| D7 | 手機撥號鈕 | `VisitCaseHero`「撥號」（全寬度都有，匿名化不出現） | 2 |
| D8 | 唯讀提示「你的帳號只能查看案件…」 | `VisitPrimaryAction` 提示 | 3 |
| D9 | 家長改期申請：核准（名額不足停用）／退回（原因）、剩幾組說明 | `VisitPrimaryAction` 的申請區（還沒開始＝實心主鈕；已開始＝淺色） | 3 |
| D10 | 標記已到場／未到場（場次開始才出現、30 秒時鐘、確認框、招生確認文字、成功後開招生資料表單） | `VisitPrimaryAction`「家長到了」（實心）「沒來」 | 3 |
| D11 | 「參觀場次開始後可以標記…」提示 | `VisitPrimaryAction` 提示 | 3 |
| D12 | 已結案：重新預約（另建新案） | `VisitPrimaryAction` 主鈕 | 3 |
| D13 | 招生訪視：讀不到重新載入／建立招生訪視／沒權限提示 | `VisitPrimaryAction`（`.detail__admissions`），重新預約變次要鈕 | 3 |
| D14 | 家庭版面處理區 FamilyActions（記錄聯絡、排下次聯絡、移到…、招生負責人、重新預約） | 右欄最上（「記錄聯絡」改淺色，主鈕給頁首「填招生資料」） | 3、5 |
| D15 | 聯絡紀錄列表（作者 title＝Email、時間） | `VisitCaseTimeline`「王小美 記了一筆」 | 4 |
| D16 | 新增聯絡紀錄（textarea、⌘／Ctrl＋Enter、草稿 sessionStorage、下次聯絡＋快捷、不給過去、已過提示、已結案不追蹤、版本衝突） | `VisitCaseTimeline` 最上方輸入框 | 4 |
| D17 | 家庭版面聯絡紀錄（參觀前／後、讀不到重新載入） | `VisitCaseTimeline`（標「參觀前／參觀後」，沒有輸入框） | 4 |
| D18 | 案件歷程（變更行、原因、關聯案件連結、actor title；家庭合併招生事件、讀不到重新載入） | `VisitCaseTimeline` 同一條 | 4 |
| D19 | 家長填寫的資料（電話、孩子、生日、Email、得知管道；舊資料才有的參觀人數、年齡、方便時段、想了解的事、同意紀錄、確認／取消時間） | `VisitCaseFacts`（孩子與生日併一行） | 5 |
| D20 | 家庭版面預約資料收合（展開／收起） | `VisitCaseFacts` | 5 |
| D21 | 招生資料面板 FamilyAdmissionsData（可編輯） | 主欄最上（元件不動） | 5 |
| D22 | 手動改期（收成連結、展開移焦點、依日分組、剩幾組、已選整行、60 天沒場次＋`booking.manage` 才給連結、原因、確認框寄信說明、失敗重讀） | `VisitCaseSettings` 場次列 | 5 |
| D23 | 家長管理連結（產生／複製／重新產生並寄出／撤銷／重寄確認信／寄信說明／截止說明／缺 WEBSITE_ADMIN_ORIGIN） | `VisitCaseSettings` 連結列（`ParentAccessLinkPanel` 改外觀） | 5 |
| D24 | 取消預約（面板最底、分隔線、場次開始後改講「沒來」、原因、寄信說明） | `VisitCaseSettings` 最底 | 3 文案、5 位置 |
| D25 | 重新預約 ManualVisitDialog、到場後 RecordDialog | `VisitCaseDialogs` | 5 |
| D26 | 離頁保護、下一筆攔截、30 秒切回重讀並點名、狀態衝突重讀、側欄改期數更新、寄信設定讀取 | `useVisitCase`＋`VisitDetailView` | 1 |
| D27 | 手機順序（撥號 → 處理 → 聯絡紀錄 → 家長資料） | 頁首（含撥號、主鈕）→（家庭：處理）→ 招生資料 → 時間線 → 家長資料 → 設定列 | 5 |

列表（`VisitRequestsView`）：

| # | 現有功能 | 新位置 | Task |
|---|---|---|---|
| L1 | 頁首說明＋「說明」展開、補登案件（實心）、匯出 CSV＋範圍說明 | 照舊（匯出改帶 `view`） | 7 |
| L2 | 狀態頁籤（全部／預約正常／時間已過／已取消）＋件數 | 接下來／時間已過／已到場／已取消／全部；件數只在接下來（全部）與時間已過（還沒標記）出現 | 7 |
| L3 | 搜尋（電話正規化、防抖）、校區（多校常駐、手機收起）、更多篩選（排序、來源、送出日期、只看尚未確認到場、到期待追蹤、待人工處理、未結案）、標籤列、清除篩選 | 照舊；排序多「參觀時間」（預設） | 7 |
| L4 | 待人工處理說明、讀取錯誤＋重新載入 | 照舊 | 7 |
| L5 | 面板標題（看哪一組）＋本頁 N 件 | 清單頂端一行 | 8 |
| L6 | 表格六欄、手機卡片 | `VisitListRow`（時間＋狀態、家長・孩子＋來源＋預定聯絡＋方便時段、校區、電話、動作）；依參觀日分組 | 8 |
| L7 | 列上「到了／沒來」（確認、開招生資料表單、衝突訊息） | `VisitListRow` 照舊；已到場的列多「填招生資料」 | 8 |
| L8 | 批次標記（只看尚未確認到場＋`booking.handle`、勾選、全選、進度、失敗清單） | 列首勾選框＋批次列「全選這一頁」 | 8 |
| L9 | 點列進明細（帶 `list=`） | 1280 以下照舊；1280 以上開右側預覽，⌘／Ctrl／中鍵照舊開新分頁 | 8、9 |
| L10 | 空狀態、分頁（空頁回退、到底不回彈）、網址同步（replace）、切回分頁 60 秒重讀 | 照舊 | 7、8 |
| L11 | 補登 ManualVisitDialog、到場 RecordDialog | 照舊 | 8 |

## 角色可見性（依 capability，不依角色名）

| 能力 | 明細 | 列表 | 預覽面板 |
|---|---|---|---|
| 沒有 `booking.read`（內容編輯） | 路由擋（不變） | 路由擋（不變） | — |
| 只有 `booking.read` | 頁首只有狀態與「只能查看案件」提示；時間線沒有輸入框；家長連結只看狀態沒有按鈕；沒有取消 | 沒有補登、列內沒有到了／沒來、沒有批次 | 同明細 |
| `booking.handle`（含櫃台） | 主動作、輸入框、改期、家長連結按鈕、取消、重新預約 | 補登、到了／沒來、批次 | 同明細 |
| `booking.manage` | 改期沒有場次時給「參觀場次」連結 | — | 同明細 |
| `booking.export` | — | 匯出 CSV | — |
| `admissions.read` | 已到場＋招生開＋查得到訪視＝家庭版面 | — | 家庭版面的處理區與時間線 |
| `admissions.write` | 頁首「填招生資料」「建立招生訪視」、到場後開表單 | 到了之後開表單、已到場列「填招生資料」（還要 `features.admissions`） | 同明細 |

## 裁定（比稿沒講清楚的，我直接決定）

| # | 決定 | 理由 | 錯了的代價 |
|---|---|---|---|
| R1 | 頁籤：**接下來**＝參觀日是台北今天或之後、沒取消（今天整天留著，含已到場、未到場、時間已過還沒標記）；**時間已過**＝場次已開始、狀態是預約正常或未到場；**已到場**＝已到場；**已取消**＝已取消。頁籤可以重疊（今天開始了還沒標記的同時在接下來與時間已過；今天到場的同時在接下來與已到場）。 | mock 的「今天」組含「還沒標記」與「已到場＋填招生資料」，表示今天要整天在接下來；時間已過沿用後端 `awaiting_attendance` 的判準（場次一開始就算），總覽「參觀時間過了，還沒標記到場 N 組」點進來才會是同一批。 | 使用者若要互斥的頁籤，只改 `view_condition` 兩行與 `tabFromQuery`，前端版面不動。 |
| R2 | 頁籤數字：接下來寫全部件數；時間已過只寫**還沒標記**的件數（＝總覽同一個數字），報讀「N 件還沒標記到場」；已到場、已取消、全部不寫數字。 | 已到場、已取消只會一直變大，數字是雜訊；mock 也只有前兩個有數字。 | 想要全部數字時 `view-counts` 加欄位即可。 |
| R3 | 後端新增 `view` 參數與 `view-counts`，**不改**舊 `group` 的語意；`group-counts` 留著不刪（前端不再呼叫）。 | 總覽、成效統計、招生看板與明細「下一筆」都用 `group=past&status=confirmed` 打 API，改語意會連帶改數字口徑。 | 多一支沒人呼叫的端點；之後清理另案刪。 |
| R4 | 網址鍵沿用 `group`，值改成 `upcoming｜past｜arrived｜cancelled｜all`。完全沒有參數＝接下來；有其他參數卻沒有 `group`（或 `group` 不認得）＝改版前的連結（當時沒有 group 就是「全部」），舊 `?status=` 照狀態對到頁籤（confirmed→接下來、completed→已到場、no_show→時間已過、cancelled→已取消、其他→全部）。寫回網址時只有「接下來＋沒有其他條件」省略 `group`。 | 舊連結 `group=past&status=confirmed`、`group=upcoming`、`group=cancelled` 直接沿用；`?due=1`、`?attention=1`、`?open=1` 這類跨頁籤的條件落到「全部」才和總覽數字對得上。 | 舊書籤 `?q=王`（以前是全部）仍落在全部，沒有差。 |
| R5 | 排序預設依頁籤的參觀時間（接下來由近到遠；其他頁籤由近往回）；「更多篩選」的排序多一個「參觀時間」，選「最新／最早送出在前」時不分日期組、每列多寫「MM/DD HH:mm 送出」。總覽「今天有 N 組參觀」連結拿掉 `order=oldest`。 | 行程清單一定要照參觀時間；櫃台早上「最舊的先處理」的需求改由頁籤與分組承擔，但舊連結 `order=oldest` 仍能用。 | 若業主要把送出時間排序拿掉，刪一個選項。 |
| R6 | 分組以台北日期、週一開始：遞增是「今天 MM/DD（週X）／明天 MM/DD（週X）／本週／之後」，遞減是「今天／昨天 MM/DD（週X）／本週稍早／更早」（已取消的未來場次在遞減時排最前，標「明天」「本週」「之後」）；沒有場次的舊案「沒有場次」排最後。分組照目前這一頁的列連續切，跨頁不合併，「N 組」只算這一頁。 | 前端分組最簡單；一頁 20 筆、單校帳號一天幾組，跨頁很少見。 | 跨頁時第 2 頁開頭會再出現同一組標題；要合併改成「載入更多」。 |
| R7 | 每頁維持 20 筆、維持「上一頁／下一頁」。 | 不動分頁就不動空頁回退那套已測過的邏輯。 | 行程長時要多翻一頁。 |
| R8 | 預覽面板只在 `(min-width: 1280px)` 出現；點列（沒有按 ⌘／Ctrl／Shift／Alt、左鍵）開預覽，修飾鍵與中鍵照常開新分頁；1280 以下點列進明細（現在的行為）。一開始不自動選第一筆（右側寫一句「點一筆就會在這裡看到…」）；選取不寫進網址。 | 自動選會讓每次換頁籤多打 2～4 支 API；網址不帶選取，返回列表就回到沒選的狀態，和現在一樣。 | 業主要預設選第一筆，加一行 `select(rows[0])`。 |
| R9 | 預覽的「下一筆」照目前這一頁的順序；最後一筆時停用；處理完那一筆離開清單（例如取消）時，由接手它位置的那筆當下一筆（同明細「下一筆」）。打了一半的聯絡紀錄就換一筆：先問（同明細）。 | 和明細「下一筆」行為一致。 | — |
| R10 | 預覽面板內容與明細同一組元件：頁首（compact、按鈕一律淺色）→（家庭：處理區）→ 家長資料（電話、孩子、Email）→ 時間線（最新 3 筆＋「還有 N 筆，打開完整案件頁」）→ 設定列（取消在最底）→「打開完整案件頁」「下一筆」。招生資料表不放。 | 面板 400px 寬放不下兩欄招生資料；「取消預約在面板最底」與「實心一頁一顆」（列表已有補登）。 | — |
| R11 | 頁首主動作依階段：已確認＋場次已開始＝「家長到了」（實心）「沒來」，有改期申請時申請區的核准是淺色；已確認＋還沒開始＋有申請＝「核准改期」（實心）「退回申請」；已確認＋還沒開始＝沒有主鈕，只寫「參觀場次開始後可以標記已到場或未到場；家長事先說不來，請用下方的「取消預約」。」；家庭版面＝「填招生資料」（要 `admissions.write`、未匿名化）；已到場沒有招生訪視＝「建立招生訪視」或「重新載入」＋次要「重新預約（另建新案）」；其他結案＝「重新預約（另建新案）」；沒有 `booking.handle`＝只寫唯讀提示。 | mock「到了／改期／填招生資料」；還沒開始的案件沒有一定要做的事，硬塞「撥號」或「改期」當主鈕會誘導誤用。 | 業主要「撥號」當主鈕時改 `caseStage` 的 upcoming 分支。 |
| R12 | 主鈕文字改「家長到了」「沒來」（mock，和列表「到了／沒來」同一組詞）；確認框標題與確定鈕仍是「標記已到場？／標記已到場」「標記為未到場？／標記未到場」。 | 確認框沿用 `visitAttendance.ts`，三個入口同一套。 | 改回去是文字替換＋測試。 |
| R13 | 家長管理連結：網址只在產生當下顯示（資料庫只存 hash），**不做 mock 常駐的 `…/manage/8f3a…` 複製**；設定列平常寫有效期限與「重新產生」。名稱沿用「家長管理連結」（確認框、規格、DESIGN 都這樣叫），不改成 mock 的「家長自助修改連結」。 | 技術上做不到常駐複製；改名要動三份文件與確認框。 | — |
| R14 | mock 的「修改資料」連結、「兄姊」「（中班）」不做：後台沒有改家長資料的 API，資料裡也沒有兄姊與班別。孩子一行寫「小安，2022/05/01」。 | 不憑空造欄位。 | — |
| R15 | 時間線合併：聯絡紀錄與同一個交易寫的 `contact_logged` 歷程（同一人、相差 5 秒內）合成一筆，下次聯絡掛在那筆下面（「下次聯絡 10/05 10:00」或「不用再追」）；配不到的 `contact_logged` 照歷程列。新的在上，同一時間聯絡紀錄在前。家庭版面沿用「沒有輸入框，參觀後用『記錄聯絡』」。 | 新增一筆紀錄後端同時寫歷程，不合併會每筆出現兩次。 | — |
| R16 | 撥號：頁首一顆文字鈕「撥號」（`aria-label`「撥號給家長 0912…」），桌機也有；列表不放撥號鈕（電話本身是 `tel:` 連結）。 | mock 頁首有撥號；列表的電話已可點。 | — |
| R17 | 明細兩欄 `1fr＋360px`，1100px 以下一欄；右欄不再 sticky（設定列比畫面高時取消鈕會被卡住）。一欄時順序：頁首 →（家庭：處理區）→ 招生資料 → 時間線 → 家長資料 → 設定列（`display: contents`＋`order`）。 | mock 1100 斷點與手機順序。 | — |
| R18 | 「填招生資料」出現在：明細家庭版面頁首、列表已到場的列（`features.admissions`＋`admissions.write`）。明細頁 FamilyActions 的「記錄聯絡」改淺色（加 `primary` prop，預設仍實心，其他地方不受影響）。 | 實心一頁一顆。 | — |
| R19 | 列表開著過台北午夜時自動重讀一次（今天／明天標籤與接下來內容換日）。 | 櫃台常整天開著列表；總覽已有換日重讀。 | — |
| R20 | 相對時間：還沒開始時「還有 N 天」（台北日期差 ≥2）、「明天」、同一天「還有 N 小時／N 分鐘」；進行中「進行中」；結束後「剛結束」「結束了 N 分鐘／N 小時」，超過一天「結束了 N 天」（台北日期差）。只對預約正常的案件寫；結束後用暖黃（還沒標記）。沒有結束時間的舊資料當一小時。 | mock 與第五輪「要寫剩多久」。 | — |
| R21 | 返回連結從列表來時寫「參觀案件（接下來）」（從 `list=` 的 `view` 取頁籤名）。 | mock 的返回寫來源清單。 | — |
| R22 | 預覽面板的按鈕一律淺色（`VisitPrimaryAction` 的 `plain`）。 | 列表頁的實心是「補登案件」。 | — |

## 待使用者確認

| # | 問題 | 預設（先照這個做） | 不同意時改哪裡 |
|---|---|---|---|
| Q1 | mock 只有四個頁籤；計畫多一個「全部」放最後。 | **保留「全部」**：舊連結 `?due=1`、`?attention=1`、`?open=1`、`?status=new`、找電話要跨狀態搜尋，都需要一個不分頁籤的地方；現在的列表也有「全部」。 | 拿掉的話：`LIST_TABS` 去掉 `all`，舊連結改落到「接下來」並在標籤列提示「到期待追蹤（跨頁籤）」，Task 7 的對照表與測試跟著改。 |

## Review Focus

1. **列表開著過台北午夜**：今天／明天標籤要換成新的一天，接下來要重讀，不能停在昨天的「今天」。（Task 8 測試）
2. **瀏覽器不在台北時區**（出差、CI 是 UTC）：分組、「結束了多久」、預覽的時間都要照台北日期；UTC 已過午夜而台北還沒（或相反）時不能錯一天。（Task 2、8 測試）
3. **預覽面板打了一半的聯絡紀錄就點下一列或「下一筆」**：要先問，選「留在這頁」就不換。（Task 9 測試）
4. **在預覽面板處理完、那一筆離開目前頁籤**（取消、標未到場）：面板繼續顯示那筆，列表重讀，「下一筆」由接手它位置的那筆遞補，不跳回第一筆。（Task 9 測試）
5. **舊連結落點**：總覽（`group=upcoming&order=oldest`、`group=past&status=confirmed`、`due=1`、`attention=1&campus=`）、成效統計、招生看板「去標記到場」、舊書籤 `?status=…`、`?group=pending`、`?assignee=…&open=1`、明細的 `list=group=…` 都要落在對的頁籤，數字對得上。（Task 7 測試）

---

## Task 0：準備 worktree（controller 執行）

**Files:** Create: `docs/superpowers/plans/2026-10-06-admin-visit-ux.md`（本檔，已在）

- [ ] **Step 1：確認基準**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-visit-ux-20261006
git status --short; git log --oneline -1; git sparse-checkout list
```

預期：分支 `feature/admin-visit-ux-20261006`、HEAD `3d50e0a1`；未追蹤只有 `design/admin-ux-directions-20261006/` 與本計畫；sparse 含 `admin backend contracts docs tests web`。

- [ ] **Step 2：裝依賴、建測試庫**（admin、backend、根目錄；根目錄的 `openapi-typescript` 是 Task 6 重產契約要用的。web 只有 Task 10 跑 stack 才裝。）

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-visit-ux-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm ci; npm --prefix admin ci
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-visit-ux-20261006/backend; uv sync
createdb ivy_website_visitux1006_test 2>/dev/null; WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_visitux1006_test WEBSITE_SESSION_SECRET=test-only-secret-please-rotate uv run alembic upgrade head
```

預期：三個安裝都 0 錯誤；alembic 停在單一 head。backend 用自己的 `.venv`，不要 symlink 別的 worktree。

- [ ] **Step 3：基準全綠**（只確認起點，紅燈就停下回報，不要開工）

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-visit-ux-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run typecheck; npm --prefix admin run test:unit; npm run contract:check
```

預期：typecheck 0 錯誤、vitest 全過、契約一致。（後端全套留到 Task 11；這裡只跑 `uv run pytest tests/test_visit_groups.py -q` 確認測試庫可用。）

- [ ] **Step 4：提交計畫**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-visit-ux-20261006
git add docs/superpowers/plans/2026-10-06-admin-visit-ux.md
git commit -F - <<'MSG'
docs(plan): 參觀案件明細時間線（C）與列表行程清單（B）實作計畫

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

# Phase C：案件明細＝一條時間線＋一個主動作

## Task 1：抽出 `useVisitCase`（行為與畫面都不變）

純重構：`VisitDetailView.vue` 第 35–780 行的資料層與動作搬進 composable，畫面一個字都不改；既有測試是安全網。下一筆、返回、離頁保護、改期表單的焦點與下次聯絡的日期快捷留在 view（Task 4、5 再搬）。

**Files:**
- Create: `admin/src/composables/useVisitCase.ts`
- Create: `admin/src/__tests__/visitCaseKit.ts`
- Create: `admin/src/__tests__/visitCase.test.ts`
- Modify: `admin/src/views/VisitDetailView.vue`（`<script setup>` 全段；template 不動）

**Interfaces:**
- Produces（之後所有 Task 都靠這些名字）：
  - `useVisitCase(id: Readonly<Ref<string>>, hooks?: VisitCaseHooks): VisitCase`（回傳 `reactive({...})`，ref 已解包：讀 `vc.detail`、寫 `vc.newNote = 'x'`）
  - `interface VisitCaseHooks { onLoaded?(detail: VisitRequestFullOut): void; onChanged?(): void; onRebooked?(created: VisitRequestDetailOut): void | Promise<void> }`
  - `type VisitCase = ReturnType<typeof useVisitCase>`、`VISIT_CASE_KEY`、`provideVisitCase(vc)`、`injectVisitCase(): VisitCase`、`type DetailAction`
  - `VisitCase` 的欄位（全部列出，後面 Task 用到的名字以此為準）：
    - 可寫狀態：`detail`、`notes`、`availableSlots`、`loading`、`error`、`newNote`、`followUpAt`、`rescheduleSlotId`、`rescheduleReason`、`manualRescheduleOpen`、`pendingAction`、`bookingDataOpen`、`rebookOpen`、`arrivalOpen`、`arrivalLead`、`emailEnabled`、`clockNow`
    - 唯讀：`busy`、`canHandle`、`canManage`、`staff`、`family`（`useFamilyAdmissions` 的回傳，方法 `reload`／`loadExtras`／`lookup`／`create`／`replaceVisit`／`settled`）、`canReadAdmissions`、`canCreateAdmissions`、`admissionsVisit`、`admissionsAvailable`、`creatingAdmissions`、`lookupFailed`、`extrasFailed`、`familyEvents`、`familyLogs`、`familyStaff`、`familyOptions`、`familyVisit`、`familyPending`、`handled`、`noteDirty`、`openSlots`、`rescheduleSlots`、`parentMailNote`、`visitStarted`、`attendanceDue`、`statusDisplay`、`confirmedAtShown`、`followUpTracked`、`followUpDue`、`followUpPast`、`linkApplicable`、`isWebCase`、`familyNoteList`、`latestFamilyContact`、`callPhone`、`bookingDataTitle`
    - 方法：`load(opts?)`、`refreshDetail(mode?)`、`refreshIfStale()`、`cancel()`、`markNoShow()`、`markCompleted()`、`openArrivalForm()`、`reschedule()`、`decideReschedule(action)`、`addNote()`、`onFamilyChanged(visit)`、`onRebooked(created)`、`slotLabel(slot)`、`chosenSlotText(slots, id)`
  - 測試共用 `visitCaseKit.ts`：`VISIT_ID`、`futureSlot`、`pastSlot`、`visitCase(extra)`、`caseRoutes(data, notes?)`、`mountRoutes(path, { list?, detail? }, options?)`

- [ ] **Step 1：寫測試共用工具**

`admin/src/__tests__/visitCaseKit.ts`：

```ts
// 案件明細與列表（2026-10-06 方向 B／C）新測試共用：案件假資料、用真的路由掛 view。
// 檔名不是 *.test.ts，vitest 不會把它當測試跑。
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, RouterView, type Router } from 'vue-router'
import ElementPlus from 'element-plus'
import type { UserOut } from '../api/types'
import { useAuthStore } from '../stores/auth'
import { superAdmin, wrappers } from './admissionsTestKit'

export const VISIT_ID = 'case-a'
export const futureSlot = { id: 's-future', slot_date: '2099-10-01', start_time: '10:00:00', end_time: '11:00:00' }
export const pastSlot = { id: 's-past', slot_date: '2026-01-05', start_time: '10:00:00', end_time: '11:00:00' }

/** GET /admin/visit-requests/{id} 的假資料：預設已確認、官網送出、場次在未來。 */
export function visitCase(extra: Record<string, unknown> = {}) {
  return {
    id: VISIT_ID, campus_key: 'yihua', status: 'confirmed', source: 'web', created_by: null,
    parent_name: '林小姐', phone: '0912000001', child_name: '小安', child_birthdate: '2022-05-01', email: 'p1@example.com',
    referral_sources: ['friends_family'], age: null, preferred_time: null, questions: null, party_size: null,
    consent_given: false, slot_id: futureSlot.id, slot: futureSlot, display_status: 'upcoming',
    confirmed_at: '2026-10-01T08:25:00Z', cancelled_at: null, cancel_reason: null, follow_up_at: null,
    related_request_id: null, created_at: '2026-10-01T08:25:00Z', version: 1,
    history: [], pending_reschedule: null, access_link: null, parent_change_deadline_hours: 24, ...extra,
  }
}

/** mockGet 用：案件本身與聯絡紀錄（前綴取最長，聯絡紀錄不會被案件吃掉）。 */
export function caseRoutes(data: { id?: unknown } & Record<string, unknown>, notes: unknown[] = []) {
  const id = String(data.id ?? VISIT_ID)
  return { [`/admin/visit-requests/${id}`]: data, [`/admin/visit-requests/${id}/contact-notes`]: notes }
}

/** 用真的路由（/visit-requests、/visit-requests/:id）掛 RouterView；route.params.id、onBeforeRouteLeave 都正常。 */
export async function mountRoutes(
  path: string,
  views: { list?: unknown; detail?: unknown },
  options: { user?: UserOut; admissions?: boolean } = {},
): Promise<{ wrapper: VueWrapper; router: Router }> {
  const pinia = createPinia()
  const auth = useAuthStore(pinia)
  auth.user = options.user ?? superAdmin()
  if (options.admissions) auth.features = { ...auth.features, admissions: true }
  const blank = defineComponent({ template: '<div />' })
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/visit-requests', component: (views.list ?? blank) as never },
      { path: '/visit-requests/:id', component: (views.detail ?? blank) as never },
      { path: '/:pathMatch(.*)*', component: blank },
    ],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(RouterView, { attachTo: document.body, global: { plugins: [pinia, router, ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}
```

- [ ] **Step 2：寫失敗的測試**

`admin/src/__tests__/visitCase.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref } from 'vue'
import { flushPromises } from '@vue/test-utils'
import { ElMessageBox } from 'element-plus'
import { cleanup, deferred, mockGet, mockPost, mountWith, pathsTo } from './admissionsTestKit'
import { caseRoutes, pastSlot, visitCase } from './visitCaseKit'
import { useVisitCase, type VisitCase, type VisitCaseHooks } from '../composables/useVisitCase'

afterEach(() => { cleanup(); window.sessionStorage.clear() })

async function mountCase(initial: string, hooks: VisitCaseHooks = {}) {
  const id = ref(initial)
  let vc!: VisitCase
  const Host = defineComponent({ setup() { vc = useVisitCase(id, hooks); return () => h('p', vc.detail?.parent_name ?? '') } })
  const { wrapper } = await mountWith(Host)
  return { wrapper, id, vc: () => vc }
}

describe('useVisitCase（2026-10-06 從案件明細抽出）', () => {
  it('案件與聯絡紀錄一起讀；讀到後通知 onLoaded', async () => {
    const get = mockGet(caseRoutes(visitCase()))
    const onLoaded = vi.fn()
    const { vc } = await mountCase('case-a', { onLoaded })
    expect(pathsTo(get, '/admin/visit-requests/case-a')).toEqual(
      expect.arrayContaining(['/admin/visit-requests/case-a', '/admin/visit-requests/case-a/contact-notes']),
    )
    expect(onLoaded).toHaveBeenCalledWith(expect.objectContaining({ id: 'case-a' }))
    expect(vc().loading).toBe(false)
    expect(vc().statusDisplay?.label).toBe('預約正常')
  })

  it('換案件時，上一筆較晚回來的回應不會蓋掉畫面', async () => {
    const slow = deferred<unknown>()
    mockGet({
      '/admin/visit-requests/case-a': () => slow.promise,
      '/admin/visit-requests/case-a/contact-notes': [],
      ...caseRoutes(visitCase({ id: 'case-b', parent_name: '王先生' })),
    })
    const { id, vc } = await mountCase('case-a')
    id.value = 'case-b'
    await flushPromises()
    slow.resolve(visitCase())
    await flushPromises()
    expect(vc().detail?.id).toBe('case-b')
  })

  it('標記未到場成功：重讀並通知 onChanged 一次', async () => {
    mockGet(caseRoutes(visitCase({ slot: pastSlot, slot_id: pastSlot.id, display_status: 'past' })))
    const post = mockPost()
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const onChanged = vi.fn()
    const { vc } = await mountCase('case-a', { onChanged })
    await vc().markNoShow()
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/visit-requests/case-a/no-show')
    expect(onChanged).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 3：跑測試確認失敗**

Run: `cd $WT; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; cd admin; npx vitest run src/__tests__/visitCase.test.ts`
Expected: FAIL（`Failed to resolve import "../composables/useVisitCase"`）

- [ ] **Step 4：建立 `useVisitCase.ts`**

把 `VisitDetailView.vue` 下列片段**原樣**搬進來（註解一起搬），只做三種修改：`ref.value` 的寫法不變；`onBeforeUnmount(() => window.clearInterval(clock))` 併進下面的生命週期；`void loadNextCases(loaded.campus_key)` 換成 `hooks.onLoaded?.(loaded)`。原檔行號（`3d50e0a1`）：41–60（detail、family、bookingDataOpen、handled、notes）、61–71（slots、改期、草稿）、75–79（followUpAt、followUpBase）、84–98（pendingAction、busy、rebookOpen、權限、staff）、103–106（familyPending、noteDirty）、111–201（error、generation、toPickerValue、sameInstant、syncFollowUp、load、refreshDetail）、317–420（reportError、reloadAfterTransitionConflict、activityKey、refreshIfStale、openSlots、rescheduleSlots、slotLabel、chosenSlotText、emailEnabled、parentMailNote）、421–498（cancel、markNoShow、clock、visitStarted、attendanceDue、statusDisplay）、503–507（confirmedAtShown）、518–614（reschedule、decideReschedule、onRebooked、markCompleted）、617–685（familyNoteList、latestFamilyContact、callPhone、bookingDataTitle、arrivalOpen、arrivalLead、openArrivalForm、onFamilyChanged、addNote）、707–725（followUpTracked、followUpDue、followUpPast）、776–780（linkApplicable、isWebCase）。

檔案骨架（`…原樣…` 處貼上面列的程式碼）：

```ts
// 一筆參觀案件的資料層與動作（2026-10-06 方向 C 從 VisitDetailView 抽出）：案件明細與列表右側的
// 預覽面板共用。回傳 reactive，子元件用 injectVisitCase() 取得同一份（provide／inject），不逐層傳 props。
import { computed, inject, nextTick, onBeforeUnmount, onMounted, provide, reactive, ref, watch, type InjectionKey, type Ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, ApiError } from '../api/client'
import { apiErrorCode, apiErrorMessage, isVersionConflict } from '../api/errors'
import { lastHandled } from '../api/visitHistory'
import type { RecruitmentVisit, VisitContactNoteOut, VisitRequestDetailOut, VisitRequestFullOut, VisitSlotOut } from '../api/types'
import { formatDateTime, formatSlotWhen, maskEmail, slotStarted, visitDisplay, visitDisplayStatus, visitStatus } from '../api/labels'
import { arrivedAt, familyLastHandled, familyNotes, latestContact } from '../admissions/family'
import { useAuthStore } from '../stores/auth'
import { useOpenRequestsStore } from '../stores/openRequests'
import { notifyError, notifyWarning } from './notify'
import { usePermissions } from './usePermissions'
import { useVisitStaff } from './useVisitStaff'
import { useFamilyAdmissions } from './useFamilyAdmissions'
import { arrivalFormLead } from './useArrivalAdmissionsForm'
import { arrivalAdmissionsNote } from './visitAttendance'
import { confirmRescheduleDecision, submitRescheduleDecision, type RescheduleAction } from './rescheduleDecision'
import { readVisitNoteDraft, writeVisitNoteDraft } from './visitNoteDraft'

export type DetailAction = 'cancel' | 'no_show' | 'complete' | 'reschedule' | 'note' | RescheduleAction

export interface VisitCaseHooks {
  /** 每次讀到案件（含動作後的靜默重讀）；明細頁用來算「下一筆」。 */
  onLoaded?: (detail: VisitRequestFullOut) => void
  /** 狀態、場次或聯絡紀錄剛改過；預覽面板用來重讀列表。 */
  onChanged?: () => void
  /** 重新預約（另建新案）建好；明細頁與預覽面板都導到新案件。 */
  onRebooked?: (created: VisitRequestDetailOut) => void | Promise<void>
}

const DETAIL_STALE_MS = 30_000

export function useVisitCase(id: Readonly<Ref<string>>, hooks: VisitCaseHooks = {}) {
  const authStore = useAuthStore()
  const openRequests = useOpenRequestsStore()
  // …原樣（41–60 的 detail、family、familyVisit、bookingDataOpen、handled、notes；
  //   第 44–46 行的解構改成直接用 family.canRead／family.visit…，見下方 return）…
  // …原樣（其餘片段）…

  // 動作成功的出口：cancel／markNoShow／markCompleted／reschedule／decideReschedule 在
  // 「await load({ quiet: true })」之後、addNote 在「await refreshDetail()」之後各加一行：
  //   hooks.onChanged?.()

  async function onRebooked(created: VisitRequestDetailOut) {
    openRequests.refresh(true)
    await hooks.onRebooked?.(created)
  }

  onMounted(() => {
    void load()
    void loadStaff()
    document.addEventListener('visibilitychange', refreshIfStale)
    window.addEventListener('focus', refreshIfStale)
  })
  onBeforeUnmount(() => {
    window.clearInterval(clock)
    document.removeEventListener('visibilitychange', refreshIfStale)
    window.removeEventListener('focus', refreshIfStale)
  })
  // 「下一筆」或預覽換一筆：同一個元件換 id，不重新掛載。
  watch(id, () => {
    generation += 1
    detail.value = null
    notes.value = []
    newNote.value = readVisitNoteDraft(id.value)
    bookingDataOpen.value = false
    followUpAt.value = null
    followUpBase = null
    rescheduleSlotId.value = ''
    rescheduleReason.value = ''
    manualRescheduleOpen.value = false
    void load()
  })

  return reactive({
    detail, notes, availableSlots, loading, error, newNote, followUpAt, rescheduleSlotId, rescheduleReason, manualRescheduleOpen,
    pendingAction, busy, bookingDataOpen, rebookOpen, arrivalOpen, arrivalLead, emailEnabled, clockNow,
    canHandle, canManage, staff, family,
    canReadAdmissions: family.canRead, canCreateAdmissions: family.canWrite, admissionsVisit: family.visit,
    admissionsAvailable: family.available, creatingAdmissions: family.creating, lookupFailed: family.lookupFailed,
    extrasFailed: family.extrasFailed, familyEvents: family.events, familyLogs: family.contactLogs,
    familyStaff: family.staff, familyOptions: family.options,
    familyVisit, familyPending, handled, noteDirty, openSlots, rescheduleSlots, parentMailNote, visitStarted, attendanceDue,
    statusDisplay, confirmedAtShown, followUpTracked, followUpDue, followUpPast, linkApplicable, isWebCase,
    familyNoteList, latestFamilyContact, callPhone, bookingDataTitle,
    load, refreshDetail, refreshIfStale, cancel, markNoShow, markCompleted, openArrivalForm, reschedule, decideReschedule,
    addNote, onFamilyChanged, onRebooked, slotLabel, chosenSlotText,
  })
}

export type VisitCase = ReturnType<typeof useVisitCase>
export const VISIT_CASE_KEY: InjectionKey<VisitCase> = Symbol('visit-case')

export function provideVisitCase(vc: VisitCase): void {
  provide(VISIT_CASE_KEY, vc)
}

/** 案件明細的子元件（頁首、時間線、資料表、設定列…）取得同一份案件。 */
export function injectVisitCase(): VisitCase {
  const vc = inject(VISIT_CASE_KEY, null)
  if (!vc) throw new Error('VisitCase 沒有 provide：子元件要放在案件明細或預覽面板裡')
  return vc
}
```

注意：
- `load()` 開頭加 `if (!id.value) return`，其餘照原樣。
- 原本在 load 裡的 `void loadNextCases(loaded.campus_key)`（第 164 行）換成 `hooks.onLoaded?.(loaded)`，位置不變（`detail.value = loaded` 與 `syncFollowUp` 之後、讀場次之前）。
- 原本的 `async function onRebooked`（575–580）不搬，換成上面的版本；`router.push` 與「新案件已建立…」訊息移到 view 的 hook。
- 原本第 44–46 行的解構（`canRead: canReadAdmissions` …）不搬；composable 內原本用到 `canReadAdmissions.value`、`admissionsAvailable.value`、`canCreateAdmissions.value`、`admissionsVisit.value`、`creatingAdmissions`、`lookupFailed.value`、`familyEvents.value`、`familyLogs.value` 的地方改成 `family.canRead.value`、`family.available.value`、`family.canWrite.value`、`family.visit.value`、`family.creating`、`family.lookupFailed.value`、`family.events.value`、`family.contactLogs.value`。
- 不搬：`useRoute`、`useRouter`、`origin`／`backLabel`／`goBack`、`nextQueue` 一整段（202–315）、`goNext`、`useUnsavedChanges`、`onBeforeRouteUpdate`、`useCampusScope`、`rescheduleSelect`／`rescheduleTitle`／`manualRescheduleShown`／`openManualReschedule`、`disablePast`／`daysLaterAtTen`／`followUpShortcuts`。

- [ ] **Step 5：`VisitDetailView.vue` 改用 composable（template 不動）**

`<script setup>` 改成（保留原本的註解；`…原樣…` 是不搬的那幾段）：

```ts
import { computed, nextTick, ref, toRefs, watch } from 'vue'
import { onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, ArrowRight, Phone } from '@element-plus/icons-vue'
import { api } from '../api/client'
import type { VisitRequestDetailOut } from '../api/types'
import { ageLabel, campusLabel, consentRecordLabel, contactTimeLabel, formatDateTime, formatSlotWhen, partySizeLabel, referralSourceLabels, staffEmail, staffEmailById, staffLabel, staffLabelById, staffOf, visitSourceLabel } from '../api/labels'
import { groupSlotsByDay, slotChoiceTime } from '../utils/sessions'
import { useUnsavedChanges } from '../composables/useUnsavedChanges'
import { useCampusScope } from '../composables/useCampusScope'
import { provideVisitCase, useVisitCase } from '../composables/useVisitCase'
import { ARRIVAL_FORM_CANCEL_TEXT } from '../composables/useArrivalAdmissionsForm'
import StatusTag from '../components/StatusTag.vue'
import ManualVisitDialog from '../components/ManualVisitDialog.vue'
import ParentAccessLinkPanel from '../components/ParentAccessLinkPanel.vue'
import VisitHistoryTimeline from '../components/VisitHistoryTimeline.vue'
import RecordDialog from '../components/admissions/RecordDialog.vue'
import { stageMeta } from '../admissions/constants'
import { arrivedLabel, detailOrigin } from '../admissions/family'
import FamilyAdmissionsData from '../components/visit/FamilyAdmissionsData.vue'
import FamilyActions from '../components/visit/FamilyActions.vue'
import FamilyContactNotes from '../components/visit/FamilyContactNotes.vue'

const route = useRoute()
const router = useRouter()
const id = computed(() => route.params.id as string)

const vc = useVisitCase(id, {
  onLoaded: (loaded) => void loadNextCases(loaded.campus_key),
  onRebooked: async (created) => {
    const failure = await router.push(`/visit-requests/${created.id}`)
    // 紀錄框還有沒新增的紀錄、使用者選擇留在這頁：新案件已經建好了，告訴他之後去哪裡開。
    if (failure) ElMessage.info('新案件已建立，記完這筆紀錄後可以到參觀案件列表開啟')
  },
})
provideVisitCase(vc)
const {
  detail, notes, newNote, followUpAt, rescheduleSlotId, rescheduleReason, manualRescheduleOpen, pendingAction, busy,
  bookingDataOpen, rebookOpen, arrivalOpen, arrivalLead, canHandle, canManage, staff, canReadAdmissions, canCreateAdmissions,
  admissionsVisit, admissionsAvailable, creatingAdmissions, lookupFailed, extrasFailed, familyEvents, familyOptions, familyStaff,
  familyVisit, familyPending, handled, noteDirty, rescheduleSlots, visitStarted, attendanceDue, statusDisplay, confirmedAtShown,
  followUpTracked, followUpDue, followUpPast, linkApplicable, isWebCase, familyNoteList, latestFamilyContact, callPhone,
  bookingDataTitle, loading, error, emailEnabled,
} = toRefs(vc)
const { cancel, markNoShow, markCompleted, reschedule, decideReschedule, addNote, onFamilyChanged, onRebooked, slotLabel, chosenSlotText, refreshDetail } = vc
const family = vc.family
const createAdmissionsVisit = () => vc.family.create()

const { visibleCampusKeys } = useCampusScope({ autoSelect: false })
const { confirmLeave } = useUnsavedChanges(noteDirty, busy)
// 「下一筆」只換 :id，不會觸發離頁守衛，要另外攔。
onBeforeRouteUpdate((to, from) => (to.params.id !== from.params.id ? confirmLeave() : true))

// …原樣：rescheduleSelect、rescheduleTitle、manualRescheduleShown、openManualReschedule（509–516）…
// …原樣：NextCount、nextQueue、NEXT_LIMIT、timeOf、visitTime、byTime、LIST_KEYS、sourceListParams、NONE、queuePosition、
//        loadListNext、loadNextCases、nextCount、nextLabel、nextTitle（81–83、202–315），
//        但裡面的 generation 全部改名 nextGeneration（下面宣告）…
// …原樣：readOrigin、origin、backLabel、goBack、goNext（687–705）…
// …原樣：disablePast、daysLaterAtTen、followUpShortcuts（727–747）…

// 「下一筆」的請求序號：換案件就加一，舊案件較晚回來的清單不能蓋掉（案件本身的序號在 useVisitCase）。
let nextGeneration = 0
watch(id, () => {
  nextGeneration += 1
  origin.value = readOrigin()
  nextQueue.value = null
})
```

`template` 裡原本寫 `:loading="pendingAction === 'cancel'"` 這類都不用改（toRefs 的 ref 在 template 自動解包）。`@saved="family.replaceVisit"`、`@click="family.lookup"`、`@reload="family.loadExtras"` 照舊。vue-tsc 若報沒用到的 import 或解構名稱，刪掉即可，不要動 template。之後每個 Task 改完 view 都一樣：沒用到的 import、解構名稱、CSS 規則順手刪掉。

- [ ] **Step 6：跑新測試與既有明細測試（一次一個檔）**

```bash
cd $WT; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; cd admin
for f in visitCase visitDetails caseHandling ux20260928B2 followUpUx uxRound6 uxRound8Cases visitFamilyPage admissionsVisitDetail receptionUx20261002 selfBookingDetail displayNames familyEntryPoints adminBugAudit20261006; do npx vitest run src/__tests__/$f.test.ts || break; done
```

Expected：全部 PASS，**既有測試一個都不用改**（這是純重構）。有紅燈就是搬漏了，對照原檔補回，不要改測試。

- [ ] **Step 7：Commit**

```bash
cd $WT
git add admin/src/composables/useVisitCase.ts admin/src/views/VisitDetailView.vue admin/src/__tests__/visitCaseKit.ts admin/src/__tests__/visitCase.test.ts
git commit -F - <<'MSG'
refactor(admin): 案件明細的資料層與動作抽成 useVisitCase

預覽面板之後要重用同一份；畫面與行為不變，既有測試全過。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

## Task 2：台北時間工具＋案件頁首 `VisitCaseHero`

**Files:**
- Create: `admin/src/utils/visitSchedule.ts`
- Create: `admin/src/components/visit/VisitCaseHero.vue`
- Create: `admin/src/__tests__/visitSchedule.test.ts`
- Create: `admin/src/__tests__/visitCaseHero.test.ts`
- Modify: `admin/src/views/VisitDetailView.vue`（換掉 `<div class="detail__head">…</div>` 與撥號鈕）
- Modify: `admin/src/__tests__/ux20260928B2.test.ts`（撥號文字）

**Interfaces:**
- Consumes: `injectVisitCase()`、`vc.detail`、`vc.staff`、`vc.handled`、`vc.followUpTracked`、`vc.followUpDue`、`vc.familyPending`、`vc.familyVisit`、`vc.statusDisplay`、`vc.callPhone`、`vc.clockNow`
- Produces:
  - `utils/visitSchedule.ts`：`taipeiDay(time: number): string`（`YYYY-MM-DD`）、`daysBetween(a: string, b: string): number`、`interface SlotTime { slot_date: string; start_time: string; end_time?: string | null }`、`slotStart(slot): number`、`slotEnd(slot): number`、`type RelativeTone = 'live' | 'ended' | ''`、`relativeVisitTime(slot: SlotTime, now: number): { text: string; tone: RelativeTone }`
  - `VisitCaseHero.vue`：props `{ compact?: boolean }`；根元素 `header.detail__head.case-hero`；`<slot name="actions" />`（Task 3 換成 `VisitPrimaryAction`）

- [ ] **Step 1：寫 `visitSchedule` 的失敗測試**

`admin/src/__tests__/visitSchedule.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { daysBetween, relativeVisitTime, taipeiDay } from '../utils/visitSchedule'

// 台北 = UTC+8；寫成 UTC 的時間點，確認不吃瀏覽器時區。
const taipei = (local: string) => Date.parse(`${local}+08:00`)
const slot = { slot_date: '2026-10-06', start_time: '10:00:00', end_time: '11:00:00' }

describe('台北日期', () => {
  it('UTC 還是前一天、台北已經過午夜：算台北那一天', () => {
    expect(taipeiDay(Date.parse('2026-10-06T16:30:00Z'))).toBe('2026-10-07')
    expect(taipeiDay(Date.parse('2026-10-06T15:59:00Z'))).toBe('2026-10-06')
  })
  it('daysBetween 以日期算，跨月也對', () => {
    expect(daysBetween('2026-09-30', '2026-10-02')).toBe(2)
    expect(daysBetween('2026-10-06', '2026-10-05')).toBe(-1)
  })
})

describe('頁首的相對時間', () => {
  it.each([
    ['2026-10-03T10:00:00', '還有 3 天', ''],
    ['2026-10-05T10:00:00', '明天', ''],
    ['2026-10-06T00:30:00', '還有 9 小時', ''],
    ['2026-10-06T09:20:00', '還有 40 分鐘', ''],
    ['2026-10-06T10:30:00', '進行中', 'live'],
    ['2026-10-06T11:00:30', '剛結束', 'ended'],
    ['2026-10-06T11:40:00', '結束了 40 分鐘', 'ended'],
    ['2026-10-06T13:05:00', '結束了 2 小時', 'ended'],
    ['2026-10-08T09:00:00', '結束了 2 天', 'ended'],
  ])('台北 %s → %s', (local, text, tone) => {
    expect(relativeVisitTime(slot, taipei(local))).toEqual({ text, tone })
  })
  it('沒有結束時間的舊資料當一小時', () => {
    expect(relativeVisitTime({ slot_date: '2026-10-06', start_time: '10:00:00' }, taipei('2026-10-06T10:59:00')).text).toBe('進行中')
  })
})
```

- [ ] **Step 2：跑測試確認失敗**

Run: `cd $WT; …; cd admin; npx vitest run src/__tests__/visitSchedule.test.ts`
Expected: FAIL（找不到 `../utils/visitSchedule`）

- [ ] **Step 3：實作 `utils/visitSchedule.ts`**

```ts
// 參觀時間的台北日期與相對時間（2026-10-06 案件明細 C、列表 B）。後台使用者可能不在台灣時區
// （出差、CI 是 UTC），一律以台北日期計算，不用瀏覽器本地時間。場次的日期與時間本來就是台北的。
const TAIPEI = 'Asia/Taipei'
const dayFormatter = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: TAIPEI })

/** 某個時間點在台北是哪一天（YYYY-MM-DD）。 */
export function taipeiDay(time: number): string {
  return dayFormatter.format(new Date(time))
}

/** 兩個 YYYY-MM-DD 相差幾天（b − a）。 */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

export interface SlotTime { slot_date: string; start_time: string; end_time?: string | null }

const at = (date: string, time: string) => Date.parse(`${date}T${time.slice(0, 8)}+08:00`)

export function slotStart(slot: SlotTime): number {
  return at(slot.slot_date, slot.start_time)
}

/** 沒有結束時間的來源當一小時（參觀場次的預設長度）。 */
export function slotEnd(slot: SlotTime): number {
  return slot.end_time ? at(slot.slot_date, slot.end_time) : slotStart(slot) + 3_600_000
}

export type RelativeTone = 'live' | 'ended' | ''

/** 頁首參觀時間旁的「還有 3 天」「明天」「進行中」「結束了 2 小時」（第五輪：寫剩多久，不只給時間戳）。 */
export function relativeVisitTime(slot: SlotTime, now: number): { text: string; tone: RelativeTone } {
  const start = slotStart(slot)
  if (Number.isNaN(start)) return { text: '', tone: '' }
  const end = slotEnd(slot)
  if (now < start) {
    const days = daysBetween(taipeiDay(now), slot.slot_date)
    if (days >= 2) return { text: `還有 ${days} 天`, tone: '' }
    if (days === 1) return { text: '明天', tone: '' }
    const minutes = Math.ceil((start - now) / 60_000)
    return { text: minutes < 60 ? `還有 ${minutes} 分鐘` : `還有 ${Math.floor(minutes / 60)} 小時`, tone: '' }
  }
  if (now < end) return { text: '進行中', tone: 'live' }
  const minutes = Math.floor((now - end) / 60_000)
  if (minutes < 1) return { text: '剛結束', tone: 'ended' }
  if (minutes < 60) return { text: `結束了 ${minutes} 分鐘`, tone: 'ended' }
  if (minutes < 24 * 60) return { text: `結束了 ${Math.floor(minutes / 60)} 小時`, tone: 'ended' }
  return { text: `結束了 ${Math.max(1, daysBetween(slot.slot_date, taipeiDay(now)))} 天`, tone: 'ended' }
}
```

- [ ] **Step 4：跑測試確認通過**

Run: `npx vitest run src/__tests__/visitSchedule.test.ts` → PASS

- [ ] **Step 5：寫頁首的失敗測試**

`admin/src/__tests__/visitCaseHero.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import VisitDetailView from '../views/VisitDetailView.vue'
import { cleanup, mockGet } from './admissionsTestKit'
import { caseRoutes, mountRoutes, visitCase, VISIT_ID } from './visitCaseKit'

afterEach(() => { cleanup(); window.sessionStorage.clear() })
const today = { id: 's-today', slot_date: '2026-10-06', start_time: '10:00:00', end_time: '11:00:00' }

async function mountDetail(data: Record<string, unknown>) {
  mockGet(caseRoutes(data))
  return (await mountRoutes(`/visit-requests/${VISIT_ID}`, { detail: VisitDetailView })).wrapper
}

describe('案件頁首（2026-10-06 方向 C）', () => {
  it('寫家長・孩子、參觀時間，旁邊是台北時間的「結束了 2 小時」（暖黃）', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-06T05:00:00Z')) // 台北 13:00
    const wrapper = await mountDetail(visitCase({ slot: today, slot_id: today.id, display_status: 'past' }))
    expect(wrapper.get('h2.detail__title').text()).toBe('林小姐・小安')
    const relative = wrapper.get('.case-hero__relative')
    expect(relative.text()).toBe('結束了 2 小時')
    expect(relative.attributes('data-tone')).toBe('ended')
    expect(wrapper.get('.detail__when').text()).toContain('10:00–11:00')
  })

  it('還沒開始寫「還有 N 天」；已取消不寫相對時間', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-03T02:00:00Z')) // 台北 10/3 10:00
    const upcoming = await mountDetail(visitCase({ slot: today, slot_id: today.id }))
    expect(upcoming.get('.case-hero__relative').text()).toBe('還有 3 天')
    cleanup()
    const cancelled = await mountDetail(visitCase({ status: 'cancelled', display_status: 'cancelled', slot: today, slot_id: today.id, cancelled_at: '2026-10-02T02:00:00Z' }))
    expect(cancelled.find('.case-hero__relative').exists()).toBe(false)
  })

  it('撥號在頁首（桌機也有）；沒有孩子姓名時標題只有家長', async () => {
    const wrapper = await mountDetail(visitCase({ child_name: null }))
    const call = wrapper.get('a.detail__call')
    expect(call.attributes('href')).toBe('tel:0912000001')
    expect(call.text()).toBe('撥號')
    expect(call.attributes('aria-label')).toBe('撥號給家長 0912000001')
    expect(wrapper.get('h2.detail__title').text()).toBe('林小姐')
  })
})
```

- [ ] **Step 6：跑測試確認失敗**

Run: `npx vitest run src/__tests__/visitCaseHero.test.ts` → FAIL（沒有 `.case-hero__relative`，標題沒有孩子）

- [ ] **Step 7：實作 `VisitCaseHero.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { Phone } from '@element-plus/icons-vue'
import { campusLabel, formatDateTime, formatSlotWhen, staffEmailById, staffLabelById, visitSourceLabel } from '../../api/labels'
import { stageMeta } from '../../admissions/constants'
import { arrivedLabel } from '../../admissions/family'
import { injectVisitCase } from '../../composables/useVisitCase'
import { relativeVisitTime } from '../../utils/visitSchedule'
import StatusTag from '../StatusTag.vue'

// 案件頁首（2026-10-06 方向 C）：家長・孩子、來源與最後處理、參觀時間與「結束了多久」、預定聯絡、
// 狀態；右邊（窄螢幕在下面）是撥號與這個階段的主動作。預覽面板用 compact：標題小一級、按鈕整排在下面。
withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
const vc = injectVisitCase()

// 只對預約正常的案件寫相對時間；結束後暖黃（還沒標記到場）。
const relative = computed(() => {
  const d = vc.detail
  if (!d?.slot || d.status !== 'confirmed') return null
  const result = relativeVisitTime(d.slot, vc.clockNow)
  return result.text ? result : null
})
const source = computed(() => {
  const d = vc.detail
  return d?.source && d.source !== 'web' ? `${visitSourceLabel(d.source)}補登` : '官網送出'
})
</script>

<template>
  <header v-if="vc.detail" class="detail__head case-hero" :class="{ 'case-hero--compact': compact }">
    <div class="case-hero__main">
      <h2 class="detail__title">{{ vc.detail.parent_name }}<span v-if="vc.detail.child_name" class="case-hero__child">・{{ vc.detail.child_name }}</span></h2>
      <p class="hint case-hero__sub">
        {{ campusLabel(vc.detail.campus_key) }}・{{ formatDateTime(vc.detail.created_at) }} {{ source }}<template v-if="vc.detail.created_by">（<span :title="staffEmailById(vc.detail.created_by, vc.staff) || undefined">{{ staffLabelById(vc.detail.created_by, vc.staff) }}</span> 登錄）</template>
      </p>
      <p v-if="vc.handled" class="hint detail__handled">最後處理：{{ vc.handled.who }}・{{ formatDateTime(vc.handled.at) }}・{{ vc.handled.what }}</p>
      <p v-if="vc.detail.related_request_id" class="hint">
        重新預約自 <router-link :to="`/visit-requests/${vc.detail.related_request_id}`">先前的案件</router-link>
      </p>
      <p v-if="vc.detail.slot" class="detail__when">
        <span class="num">{{ formatSlotWhen(vc.detail.slot) }}</span>
        <small v-if="relative" class="case-hero__relative" :data-tone="relative.tone">{{ relative.text }}</small>
      </p>
      <p v-if="vc.detail.follow_up_at && vc.followUpTracked" class="detail__follow" :class="{ 'is-due': vc.followUpDue }">
        {{ vc.followUpDue ? '已到預定聯絡時間' : '預定聯絡' }} {{ formatDateTime(vc.detail.follow_up_at) }}
      </p>
    </div>
    <div class="case-hero__side">
      <div v-if="vc.familyPending" class="detail__status-pending" aria-hidden="true" />
      <div v-else-if="vc.familyVisit" class="detail__status">
        <StatusTag :meta="stageMeta(vc.familyVisit)" size="large" />
        <span class="detail__status-sub num">{{ arrivedLabel(vc.familyVisit.visit_date) }}</span>
      </div>
      <div v-else-if="vc.statusDisplay" class="detail__status">
        <StatusTag :meta="vc.statusDisplay" size="large" />
        <span v-if="vc.statusDisplay.sub" class="detail__status-sub" :data-tone="vc.statusDisplay.tone">{{ vc.statusDisplay.sub }}</span>
      </div>
      <slot name="actions" />
      <el-button
        v-if="vc.callPhone && !vc.familyPending"
        tag="a"
        :href="`tel:${vc.callPhone}`"
        link
        type="primary"
        :icon="Phone"
        class="detail__call"
        :aria-label="`撥號給家長 ${vc.callPhone}`"
      >撥號</el-button>
    </div>
  </header>
</template>

<style scoped>
.case-hero {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  gap: 16px 24px;
  margin-bottom: 24px;
}

.case-hero__main {
  flex: 1 1 320px;
  min-width: 0;
}

.detail__title {
  font-size: var(--text-4xl);
  line-height: 1.25;
}

.case-hero__sub {
  margin-top: 4px;
}

.detail__when {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  margin-top: 10px;
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--ink);
}

.case-hero__relative {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--ink-2);
}

.case-hero__relative[data-tone='ended'] {
  color: var(--brand-gold-ink);
}

.case-hero__relative[data-tone='live'] {
  color: var(--status-live-ink);
}

.detail__follow {
  margin-top: 4px;
  font-size: var(--text-sm);
  color: var(--ink-2);
}

.detail__follow.is-due {
  color: var(--brand-gold-ink);
  font-weight: 600;
}

.case-hero__side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
  margin-left: auto;
}

.detail__status {
  display: grid;
  justify-items: end;
  gap: 4px;
}

.detail__status-sub {
  font-size: var(--text-sm);
  color: var(--ink-2);
}

.detail__status-sub[data-tone='warning'] {
  color: var(--el-color-warning-dark-2);
  font-weight: 600;
}

.detail__call {
  min-height: 32px;
}

.case-hero--compact {
  margin-bottom: 0;
  padding: 16px 20px;
}

.case-hero--compact .detail__title {
  font-size: var(--text-xl);
}

.case-hero--compact .detail__when {
  font-size: var(--text-base);
}

.case-hero--compact .case-hero__side {
  width: 100%;
  margin-left: 0;
  align-items: stretch;
}

.case-hero--compact .detail__status {
  justify-items: start;
}

@media (max-width: 900px) {
  .detail__title {
    font-size: var(--text-3xl);
  }

  .case-hero__side {
    width: 100%;
    margin-left: 0;
    align-items: stretch;
  }

  .detail__status {
    justify-items: start;
  }

  .detail__call {
    min-height: 44px;
  }
}
</style>
```

- [ ] **Step 8：明細改用頁首**

`VisitDetailView.vue` template：把 `<div class="detail__head">` 到它的 `</div>`（含 `detail__status-pending`、家庭與一般狀態）以及下面的 `<el-button v-if="callPhone && !familyPending" … class="detail__call">…</el-button>` 整段換成：

```html
      <VisitCaseHero />
```

script 加 `import VisitCaseHero from '../components/visit/VisitCaseHero.vue'`；拿掉不再用到的 import（`Phone`、`StatusTag`、`stageMeta`、`arrivedLabel`、`staffEmailById`、`staffLabelById`、`visitSourceLabel`、`campusLabel` 若沒其他地方用）。scoped style 刪掉 `.detail__follow`、`.detail__follow.is-due`、`.detail__call`（含 900px 內那段）、`.detail__head`、`.detail__title`、`.detail__when`、`.detail__status`、`.detail__status-sub`、`.detail__status-sub[data-tone='warning']`。

- [ ] **Step 9：改既有測試的撥號文字**

`ux20260928B2.test.ts` 搜尋 `expect(call.text()).toContain('撥電話給家長')`，改成：

```ts
    expect(call.text()).toBe('撥號')
    expect(call.attributes('aria-label')).toContain('0912345678')
```

（如果同一個 it 另外斷言撥號鈕「只在手機出現」，刪掉那一行：R16 改成全寬度都有。）

- [ ] **Step 10：跑測試**

```bash
for f in visitSchedule visitCaseHero ux20260928B2 uxRound6 uxRound8Cases displayNames visitFamilyPage receptionUx20261002; do npx vitest run src/__tests__/$f.test.ts || break; done
```

Expected：全 PASS。`visitFamilyPage` 的 `.detail__call`、`.detail__status`、`.detail__handled` 都還在；`displayNames` 的 `.detail__head` 含「（amy 登錄）」。

- [ ] **Step 11：Commit**

```bash
git add admin/src/utils/visitSchedule.ts admin/src/components/visit/VisitCaseHero.vue admin/src/views/VisitDetailView.vue admin/src/__tests__/visitSchedule.test.ts admin/src/__tests__/visitCaseHero.test.ts admin/src/__tests__/ux20260928B2.test.ts
git commit -F - <<'MSG'
feat(admin): 案件頁首寫家長・孩子與「結束了多久」，撥號鈕桌機也有

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

## Task 3：頁首主動作 `VisitPrimaryAction`（依階段一顆主鈕）

**Files:**
- Create: `admin/src/composables/visitCaseStage.ts`
- Create: `admin/src/components/visit/VisitPrimaryAction.vue`
- Create: `admin/src/__tests__/visitPrimaryAction.test.ts`
- Modify: `admin/src/composables/useVisitCase.ts`（加 `openAdmissionsForm`；取消確認框文字）
- Modify: `admin/src/components/visit/VisitCaseHero.vue`（`<slot name="actions" />` 換成 `<VisitPrimaryAction :plain="compact" />`）
- Modify: `admin/src/components/visit/FamilyActions.vue`（`primary` prop）
- Modify: `admin/src/views/VisitDetailView.vue`（處理面板拿掉搬走的區塊）
- Modify tests: `receptionUx20261002.test.ts`、`visitDetails.test.ts`、`caseHandling.test.ts`、`admissionsVisitDetail.test.ts`、`arrivalAdmissionsForm.test.ts`（明細部分）、`ux20260928B2.test.ts`（取消提示）

**Interfaces:**
- Consumes: Task 1 的 `vc.*`；Task 2 的 `VisitCaseHero`
- Produces:
  - `visitCaseStage.ts`：`type CaseStage = 'loading' | 'readonly' | 'attendance' | 'reschedule' | 'upcoming' | 'family' | 'admissions-retry' | 'admissions-create' | 'admissions-ask' | 'closed'`、`interface StageInput { status: string; canHandle: boolean; visitStarted: boolean; hasRescheduleRequest: boolean; familyPending: boolean; isFamily: boolean; canReadAdmissions: boolean; canCreateAdmissions: boolean; admissionsAvailable: 'yes' | 'no' | 'unknown'; lookupFailed: boolean }`、`caseStage(input: StageInput): CaseStage`
  - `VisitPrimaryAction.vue`：props `{ plain?: boolean }`（預覽面板傳 true：所有按鈕淺色）；根元素 `div.case-hero__actions[data-stage]`
  - `vc.openAdmissionsForm(): void`（打開招生資料 RecordDialog，不帶「已標記到場」說明）
  - `FamilyActions` props 多 `primary?: boolean`（預設 true）

- [ ] **Step 1：寫失敗的測試**

`admin/src/__tests__/visitPrimaryAction.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ElMessageBox } from 'element-plus'
import VisitDetailView from '../views/VisitDetailView.vue'
import ManualVisitDialog from '../components/ManualVisitDialog.vue'
import RecordDialog from '../components/admissions/RecordDialog.vue'
import { caseStage, type StageInput } from '../composables/visitCaseStage'
import { button, cleanup, mockGet, mockPost, visit as admissionsVisit } from './admissionsTestKit'
import { caseRoutes, mountRoutes, pastSlot, visitCase, VISIT_ID } from './visitCaseKit'
import { testUser } from './fixtures'

afterEach(() => { cleanup(); window.sessionStorage.clear() })

const base: StageInput = {
  status: 'confirmed', canHandle: true, visitStarted: false, hasRescheduleRequest: false, familyPending: false,
  isFamily: false, canReadAdmissions: true, canCreateAdmissions: true, admissionsAvailable: 'yes', lookupFailed: false,
}

describe('caseStage：頁首主動作依階段', () => {
  it.each<[Partial<StageInput>, string]>([
    [{ familyPending: true, status: 'completed' }, 'loading'],
    [{ canHandle: false }, 'readonly'],
    [{ visitStarted: true }, 'attendance'],
    [{ visitStarted: true, hasRescheduleRequest: true }, 'attendance'],
    [{ hasRescheduleRequest: true }, 'reschedule'],
    [{}, 'upcoming'],
    [{ status: 'completed', isFamily: true }, 'family'],
    [{ status: 'completed', lookupFailed: true }, 'admissions-retry'],
    [{ status: 'completed' }, 'admissions-create'],
    [{ status: 'completed', canCreateAdmissions: false }, 'admissions-ask'],
    [{ status: 'completed', admissionsAvailable: 'no' }, 'closed'],
    [{ status: 'cancelled' }, 'closed'],
    [{ status: 'no_show', canHandle: false }, 'readonly'],
  ])('%o → %s', (changes, stage) => {
    expect(caseStage({ ...base, ...changes })).toBe(stage)
  })
})

const request = (available = true) => ({
  id: 'req-1', parent_name: '林小姐', created_at: '2026-10-02T03:00:00Z',
  current_slot: { slot_date: '2099-10-01', start_time: '10:00:00', end_time: '11:00:00' },
  requested_slot: { slot_date: '2099-10-08', start_time: '10:00:00', end_time: '11:00:00' },
  requested_slot_available: available, requested_slot_remaining: available ? 2 : 0,
})

async function mountDetail(data: Record<string, unknown>, routes: Record<string, unknown> = {}, user = undefined) {
  mockGet({ ...caseRoutes(data), ...routes })
  return (await mountRoutes(`/visit-requests/${VISIT_ID}`, { detail: VisitDetailView }, { user })).wrapper
}
const started = () => visitCase({ slot: pastSlot, slot_id: pastSlot.id, display_status: 'past' })

describe('VisitPrimaryAction', () => {
  it('場次開始後：「家長到了」實心、「沒來」次之；提示會接著開招生資料表單', async () => {
    const wrapper = await mountDetail(started())
    const actions = wrapper.get('.case-hero__actions')
    expect(actions.attributes('data-stage')).toBe('attendance')
    const buttons = actions.get('.detail__attendance').findAll('button')
    expect(buttons.map((b) => b.text())).toEqual(['家長到了', '沒來'])
    expect(buttons[0]!.classes()).toContain('el-button--primary')
    expect(buttons[0]!.classes()).not.toContain('is-plain')
    expect(actions.text()).toContain('家長到了嗎？')
    expect(actions.text()).toContain('標記到場會接著開招生資料表單')
  })

  it('按「家長到了」照舊呼叫 /complete', async () => {
    vi.spyOn(ElMessageBox, 'confirm').mockResolvedValue('confirm' as never)
    const post = mockPost()
    const wrapper = await mountDetail(started())
    await button(wrapper.get('.case-hero__actions'), '家長到了')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith(`/admin/visit-requests/${VISIT_ID}/complete`)
  })

  it('場次開始後又有改期申請：到場仍是主鈕，核准改期是淺色', async () => {
    const wrapper = await mountDetail({ ...started(), pending_reschedule: request() })
    const approve = button(wrapper.get('.reschedule-request'), '核准改期')!
    expect(approve.classes()).toContain('is-plain')
    expect(wrapper.get('.detail__attendance').exists()).toBe(true)
  })

  it('還沒開始、家長申請改期：核准改期是實心主鈕；名額不足時停用', async () => {
    const ok = await mountDetail(visitCase({ pending_reschedule: request() }))
    expect(ok.get('.case-hero__actions').attributes('data-stage')).toBe('reschedule')
    expect(button(ok.get('.reschedule-request'), '核准改期')!.classes()).not.toContain('is-plain')
    cleanup()
    const full = await mountDetail(visitCase({ pending_reschedule: request(false) }))
    expect(button(full.get('.reschedule-request'), '核准改期')!.attributes('disabled')).toBeDefined()
    expect(full.get('.reschedule-request').text()).toContain('無法核准')
  })

  it('還沒開始：沒有主鈕，只寫提示', async () => {
    const wrapper = await mountDetail(visitCase())
    const actions = wrapper.get('.case-hero__actions')
    expect(actions.findAll('button')).toHaveLength(0)
    expect(actions.text()).toContain('參觀場次開始後可以標記已到場或未到場')
  })

  it('已取消：重新預約（另建新案）是主鈕，打開補登對話框', async () => {
    const wrapper = await mountDetail(visitCase({ status: 'cancelled', display_status: 'cancelled', cancelled_at: '2026-10-02T02:00:00Z' }))
    await button(wrapper.get('.case-hero__actions'), '重新預約（另建新案）')!.trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(ManualVisitDialog).props('modelValue')).toBe(true)
  })

  it('只能查看的帳號：只有提示', async () => {
    const viewer = testUser('readonly', { campus_keys: ['yihua'], effective_capabilities: ['booking.read'] })
    const wrapper = await mountDetail(started(), {}, viewer as never)
    const actions = wrapper.get('.case-hero__actions')
    expect(actions.findAll('button')).toHaveLength(0)
    expect(actions.text()).toContain('只能查看案件')
  })

  it('已到場、還沒有招生訪視：建立招生訪視＋次要的重新預約', async () => {
    const wrapper = await mountDetail(visitCase({ status: 'completed', slot: pastSlot, slot_id: pastSlot.id, display_status: 'past' }))
    const actions = wrapper.get('.case-hero__actions')
    expect(actions.get('.detail__admissions').text()).toContain('已到場，但還沒有招生訪視。')
    expect(button(actions, '建立招生訪視')).toBeDefined()
    expect(button(actions, '重新預約（另建新案）')!.classes()).not.toContain('el-button--primary')
  })

  it('家庭版面：「填招生資料」打開招生資料表單（不帶已到場說明），記錄聯絡改淺色', async () => {
    const linked = admissionsVisit({ visit_request_id: VISIT_ID, has_visit_request: true })
    const wrapper = await mountDetail(
      visitCase({ status: 'completed', slot: pastSlot, slot_id: pastSlot.id, display_status: 'past' }),
      { '/admin/admissions/records': [linked], '/admin/admissions/records/v-1': [] },
    )
    await button(wrapper.get('.case-hero__actions'), '填招生資料')!.trigger('click')
    await flushPromises()
    const dialog = wrapper.findAllComponents(RecordDialog).find((c) => c.props('modelValue'))!
    expect(dialog.props('lead')).toBe('')
    expect(button(wrapper.get('.family-actions'), '記錄聯絡')!.classes()).not.toContain('el-button--primary')
  })
})
```

（`/admin/admissions/records/v-1` 那一條是讓 `…/records/v-1/events`、`…/contact-logs` 回空陣列：admissionsTestKit 的 mockGet 取最長前綴，不給的話會吃到上一條的 `[linked]`。）

- [ ] **Step 2：跑測試確認失敗**

Run: `npx vitest run src/__tests__/visitPrimaryAction.test.ts` → FAIL（找不到 `visitCaseStage`）

- [ ] **Step 3：實作 `visitCaseStage.ts`**

```ts
// 案件頁首主動作的階段（2026-10-06 方向 C：頁首依階段只給一顆主鈕）。純函式，畫面在 VisitPrimaryAction。
export type CaseStage =
  | 'loading' // 已到場、還在查招生：先不畫（免得查完整頁跳成家庭版面）
  | 'readonly' // 沒有 booking.handle：只寫提示
  | 'attendance' // 預約正常、場次已開始：家長到了／沒來
  | 'reschedule' // 預約正常、還沒開始、家長申請改期：核准改期／退回申請
  | 'upcoming' // 預約正常、還沒開始：沒有主鈕
  | 'family' // 家庭版面：填招生資料
  | 'admissions-retry' // 已到場、招生讀不到：重新載入
  | 'admissions-create' // 已到場、沒有招生訪視、能建立
  | 'admissions-ask' // 已到場、沒有招生訪視、不能建立
  | 'closed' // 其他結案：重新預約（另建新案）

export interface StageInput {
  status: string
  canHandle: boolean
  visitStarted: boolean
  hasRescheduleRequest: boolean
  familyPending: boolean
  isFamily: boolean
  canReadAdmissions: boolean
  canCreateAdmissions: boolean
  admissionsAvailable: 'yes' | 'no' | 'unknown'
  lookupFailed: boolean
}

export function caseStage(i: StageInput): CaseStage {
  if (i.familyPending) return 'loading'
  if (i.status === 'confirmed') {
    if (!i.canHandle) return 'readonly'
    if (i.visitStarted) return 'attendance'
    return i.hasRescheduleRequest ? 'reschedule' : 'upcoming'
  }
  // 招生的三種情況只看招生權限，不看 booking.handle（同改版前的「招生訪視」區塊）。
  if (i.status === 'completed') {
    if (i.isFamily) return 'family'
    if (i.canReadAdmissions && i.lookupFailed) return 'admissions-retry'
    if (i.canReadAdmissions && i.admissionsAvailable === 'yes') return i.canCreateAdmissions ? 'admissions-create' : 'admissions-ask'
  }
  return i.canHandle ? 'closed' : 'readonly'
}
```

- [ ] **Step 4：`useVisitCase` 加 `openAdmissionsForm`、改取消文字**

在 `openArrivalForm` 下面加，並加進 `return reactive({...})`：

```ts
  // 家庭版面頁首的「填招生資料」（2026-10-06 方向 C）：同一個表單，不是剛標記到場，所以不寫「已標記…已到場」、
  // 取消鈕維持「取消」（VisitCaseDialogs 依 arrivalLead 決定）。
  function openAdmissionsForm() {
    if (!family.visit.value) return
    arrivalLead.value = ''
    arrivalOpen.value = true
  }
```

`cancel()` 裡 `const noShowNote = attendanceDue.value ? '家長沒來請改用上方的「標記未到場」。' : ''` 改成 `'家長沒來請改用上方的「沒來」。'`。

- [ ] **Step 5：實作 `VisitPrimaryAction.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { formatDateTime, formatSlotWhen } from '../../api/labels'
import { injectVisitCase } from '../../composables/useVisitCase'
import { caseStage } from '../../composables/visitCaseStage'

// 頁首的主動作（2026-10-06 方向 C）：依階段只給一顆實心主鈕；改場次、家長連結、取消在設定列。
// plain：預覽面板裡（列表頁的實心主鈕是「補登案件」），所有按鈕改淺色。
const props = withDefaults(defineProps<{ plain?: boolean }>(), { plain: false })
const vc = injectVisitCase()

const stage = computed(() => {
  const d = vc.detail
  return caseStage({
    status: d?.status ?? '',
    canHandle: vc.canHandle,
    visitStarted: vc.visitStarted,
    hasRescheduleRequest: Boolean(d?.pending_reschedule),
    familyPending: vc.familyPending,
    isFamily: Boolean(vc.familyVisit),
    canReadAdmissions: vc.canReadAdmissions,
    canCreateAdmissions: vc.canCreateAdmissions,
    admissionsAvailable: vc.admissionsAvailable,
    lookupFailed: vc.lookupFailed,
  })
})
// 標記到場後會不會接著開招生資料表單（同 markCompleted；招生還在查時不寫）。
const opensForm = computed(() => vc.admissionsAvailable === 'yes' && vc.canCreateAdmissions)
const request = computed(() => (vc.canHandle && vc.detail?.status === 'confirmed' ? (vc.detail.pending_reschedule ?? null) : null))
const solid = (primaryHere: boolean) => primaryHere && !props.plain
const familyEditable = computed(() => vc.canCreateAdmissions && !vc.familyVisit?.anonymized_at)
const rebookSecondary = computed(() => vc.canHandle && ['admissions-retry', 'admissions-create', 'admissions-ask'].includes(stage.value))
</script>

<template>
  <div class="case-hero__actions" :class="{ 'case-hero__actions--stacked': plain }" :data-stage="stage">
    <el-skeleton v-if="stage === 'loading'" animated :rows="1" />
    <div v-else-if="stage === 'attendance'" class="detail__attendance" role="group" aria-labelledby="visit-attendance-title">
      <p id="visit-attendance-title" class="visually-hidden">家長到了嗎？</p>
      <div class="case-hero__buttons">
        <el-button type="primary" :plain="!solid(true)" :loading="vc.pendingAction === 'complete'" :disabled="vc.busy" @click="vc.markCompleted()">家長到了</el-button>
        <el-button :loading="vc.pendingAction === 'no_show'" :disabled="vc.busy" @click="vc.markNoShow()">沒來</el-button>
      </div>
      <p v-if="opensForm" class="hint case-hero__note">標記到場會接著開招生資料表單</p>
    </div>

    <div v-if="request" class="reschedule-request" role="group" aria-label="家長的改期申請">
      <p class="reschedule-request__title">家長申請改期<span class="num">（{{ formatDateTime(request.created_at) }}）</span></p>
      <p class="reschedule-request__slots">
        {{ formatSlotWhen(request.current_slot) }}<br />→ <strong>{{ formatSlotWhen(request.requested_slot) }}</strong>
      </p>
      <p class="hint">
        {{ request.requested_slot_available
          ? `新場次剩 ${request.requested_slot_remaining} 組。原場次在核准前仍有效。`
          : '新場次已額滿、關閉或已開始，無法核准；請退回並聯絡家長另約。' }}
      </p>
      <div class="reschedule-request__actions">
        <el-button type="primary" :plain="!solid(stage === 'reschedule')" :loading="vc.pendingAction === 'approve'" :disabled="!request.requested_slot_available || vc.busy" @click="vc.decideReschedule('approve')">核准改期</el-button>
        <el-button :loading="vc.pendingAction === 'reject'" :disabled="vc.busy" @click="vc.decideReschedule('reject')">退回申請</el-button>
      </div>
    </div>

    <p v-if="stage === 'upcoming'" class="hint case-hero__note">參觀場次開始後可以標記已到場或未到場；家長事先說不來，請用下方的「取消預約」。</p>
    <p v-else-if="stage === 'readonly'" class="hint case-hero__note">你的帳號只能查看案件，狀態由負責處理案件的同事更新。</p>
    <el-button v-else-if="stage === 'family' && familyEditable" type="primary" :plain="!solid(true)" @click="vc.openAdmissionsForm()">填招生資料</el-button>
    <div v-else-if="stage === 'admissions-retry' || stage === 'admissions-create' || stage === 'admissions-ask'" class="detail__admissions">
      <template v-if="stage === 'admissions-retry'">
        <span class="hint">招生資料讀不到。</span>
        <el-button type="primary" :plain="!solid(true)" :disabled="vc.busy" @click="vc.family.lookup()">重新載入</el-button>
      </template>
      <template v-else-if="stage === 'admissions-create'">
        <span class="hint">已到場，但還沒有招生訪視。</span>
        <el-button type="primary" :plain="!solid(true)" :loading="vc.creatingAdmissions" :disabled="vc.busy" @click="vc.family.create()">建立招生訪視</el-button>
      </template>
      <span v-else class="hint">已到場，但還沒有招生訪視；請有招生權限的同事建立。</span>
    </div>
    <template v-else-if="stage === 'closed'">
      <el-button type="primary" :plain="!solid(true)" :disabled="vc.busy" @click="vc.rebookOpen = true">重新預約（另建新案）</el-button>
      <p class="hint case-hero__note">這筆案件已結案。家長想再約，請另建新案，舊案會保留原紀錄。</p>
    </template>
    <el-button v-if="rebookSecondary" :disabled="vc.busy" @click="vc.rebookOpen = true">重新預約（另建新案）</el-button>
  </div>
</template>

<style scoped>
.case-hero__actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 10px;
  max-width: 420px;
}

.case-hero__buttons {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.case-hero__buttons .el-button + .el-button,
.reschedule-request__actions .el-button + .el-button,
.case-hero__actions > .el-button + .el-button {
  margin-left: 0;
}

.case-hero__note {
  margin: 0;
  font-size: var(--text-xs);
  text-align: right;
}

.detail__attendance {
  display: grid;
  justify-items: end;
  gap: 6px;
}

.reschedule-request {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid var(--el-color-warning-light-5);
  border-radius: var(--radius);
  background: var(--el-color-warning-light-9);
}

.reschedule-request__title {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--ink);
}

.reschedule-request__title .num {
  font-weight: 400;
  color: var(--ink-3);
}

.reschedule-request__slots {
  margin: 0;
  font-size: var(--text-sm);
  line-height: 1.6;
  color: var(--ink-2);
}

.reschedule-request__slots strong {
  color: var(--ink);
  white-space: nowrap;
}

.reschedule-request__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.detail__admissions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: flex-end;
  gap: 6px 12px;
  font-size: var(--text-sm);
  color: var(--ink-2);
}

/* 窄螢幕與預覽面板：按鈕整排撐滿，到了／沒來各占一半（44px 好點）。 */
@media (max-width: 900px) {
  .case-hero__actions,
  .detail__attendance {
    align-items: stretch;
    justify-items: stretch;
    max-width: none;
  }

  .case-hero__buttons {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }

  .case-hero__buttons .el-button,
  .case-hero__actions > .el-button {
    min-height: 44px;
  }

  .case-hero__note,
  .detail__admissions {
    justify-content: flex-start;
    text-align: left;
  }
}

/* 預覽面板（plain）：同手機的排法。 */
.case-hero__actions--stacked,
.case-hero__actions--stacked .detail__attendance {
  align-items: stretch;
  justify-items: stretch;
  max-width: none;
}

.case-hero__actions--stacked .case-hero__buttons {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.case-hero__actions--stacked .case-hero__note,
.case-hero__actions--stacked .detail__admissions {
  justify-content: flex-start;
  text-align: left;
}
</style>
```

- [ ] **Step 6：頁首掛主動作**

`VisitCaseHero.vue`：`import VisitPrimaryAction from './VisitPrimaryAction.vue'`，把 `<slot name="actions" />` 換成 `<VisitPrimaryAction :plain="compact" />`（template 直接用 `compact`，script 不用改）。

- [ ] **Step 7：`FamilyActions` 加 `primary` prop**

`defineProps` 加 `primary?: boolean`，用 `withDefaults(..., { primary: true })`；「記錄聯絡」的按鈕改成：

```html
    <el-button v-if="editable" type="primary" :plain="!primary" class="family-actions__record" @click="openContact">記錄聯絡</el-button>
```

上面加一行註解：「明細頁的實心主鈕在頁首（填招生資料），這裡傳 primary=false 改淺色（2026-10-06 方向 C）。」

- [ ] **Step 8：明細的處理面板拿掉搬走的區塊**

`VisitDetailView.vue` template 的 `<aside class="detail__side">` 裡：
- `FamilyActions` 加 `:primary="false"`。
- 刪掉 `<p v-else-if="!canHandle" class="hint">你的帳號只能查看案件…</p>`。
- `<template v-else-if="detail.status === 'confirmed'">` 裡刪掉 `reschedule-request` 整個 div、`detail__attendance` 整個 div、最後的 `<p v-if="!visitStarted" class="hint">參觀場次開始後…</p>`；保留手動改期（`v-if="manualRescheduleShown"` 與 `v-else` 收合連結）。條件改成 `<template v-else-if="detail.status === 'confirmed' && canHandle">`。
- 刪掉 `<template v-else>…這筆案件已結案…重新預約…</template>`。
- 刪掉 `<div v-if="canReadAdmissions && !familyVisit && …" class="detail__admissions">…</div>` 整段。
- `.detail__danger` 的提示改成 `{{ attendanceDue ? '家長沒來請用上方的「沒來」' : '家長不來了？' }}`。
- `RecordDialog` 的 `:cancel-text="ARRIVAL_FORM_CANCEL_TEXT"` 改成 `:cancel-text="arrivalLead ? ARRIVAL_FORM_CANCEL_TEXT : undefined"`。
- 處理面板（`.panel` 含 `<h2>處理</h2>`）在 `familyPending` 時照舊顯示骨架；確認後如果面板裡已經沒有內容（`detail.status !== 'confirmed'` 且不是家庭版面），整個 `aside` 不顯示：`<aside v-if="familyPending || familyVisit || (detail.status === 'confirmed' && canHandle)" class="detail__side">`。
- scoped style 刪掉 `.detail__admissions*`、`.detail__attendance*`、`.reschedule-request*`（`.reschedule` 共用的那條選擇器改成只剩 `.reschedule`）。

- [ ] **Step 9：改既有測試**

- `receptionUx20261002.test.ts`「先問家長到了嗎，兩顆實心按鈕排在改期前面；改期收成連結」：改成

```ts
  it('先問家長到了嗎：頁首「家長到了」實心、「沒來」次之；改期在處理面板收成連結', async () => {
    const wrapper = await mountDetail(confirmedCase())
    const attendance = wrapper.get('.case-hero__actions .detail__attendance')
    expect(attendance.text()).toContain('家長到了嗎？')
    const buttons = attendance.findAll('button')
    expect(buttons.map(b => b.text())).toEqual(['家長到了', '沒來'])
    expect(buttons[0]!.classes()).toContain('el-button--primary')
    expect(buttons[0]!.classes()).not.toContain('is-plain')
    const actions = wrapper.get('.detail__actions')
    expect(actions.find('.reschedule--collapsed').text()).toBe('改到其他場次…')
    expect(actions.text()).not.toContain('改到這一場')
    expect(wrapper.find('.detail__danger').text()).toContain('家長沒來請用上方的「沒來」')
  })
```

  同檔「取消預約的確認框提醒…」把 `'家長沒來請改用上方的「標記未到場」'` 改成 `'家長沒來請改用上方的「沒來」'`。
- `visitDetails.test.ts`、`caseHandling.test.ts`、`admissionsVisitDetail.test.ts`、`arrivalAdmissionsForm.test.ts`（只有掛 `VisitDetailView` 的 it）：找「按鈕文字 === '標記已到場'」改 `'家長到了'`，「=== '標記未到場'」改 `'沒來'`（`labels` 陣列的 `toContain('標記未到場')` 也改）。**確認框標題、`answerMessageBox` 參數、`ElMessage` 成功訊息不改**。
- `caseHandling.test.ts`：斷言「參觀場次開始後可以標記已到場或未到場」「請用下方的「取消預約」」的 it 照舊（文字已搬到頁首）；斷言結案案件「重新預約（另建新案）」按鈕的位置若用 `.detail__actions` 找，改用 `.case-hero__actions`。
- `ux20260928B2.test.ts`：取消提示若斷言「標記未到場」改「沒來」。
- `admissionsVisitDetail.test.ts`：`.detail__admissions` 還在（搬到頁首），若斷言 `.detail__admissions-label`（「招生訪視」字樣）就刪掉那一行。

- [ ] **Step 10：跑測試**

```bash
for f in visitPrimaryAction visitCaseHero receptionUx20261002 visitDetails caseHandling admissionsVisitDetail arrivalAdmissionsForm ux20260928B2 visitFamilyPage familyActions selfBookingDetail uxRound8Cases ux20261005; do npx vitest run src/__tests__/$f.test.ts || break; done
```

Expected：全 PASS。

- [ ] **Step 11：Commit**

```bash
git add admin/src/composables/visitCaseStage.ts admin/src/components/visit/VisitPrimaryAction.vue admin/src/components/visit/VisitCaseHero.vue admin/src/components/visit/FamilyActions.vue admin/src/composables/useVisitCase.ts admin/src/views/VisitDetailView.vue admin/src/__tests__/visitPrimaryAction.test.ts admin/src/__tests__/receptionUx20261002.test.ts admin/src/__tests__/visitDetails.test.ts admin/src/__tests__/caseHandling.test.ts admin/src/__tests__/admissionsVisitDetail.test.ts admin/src/__tests__/arrivalAdmissionsForm.test.ts admin/src/__tests__/ux20260928B2.test.ts
git commit -F - <<'MSG'
feat(admin): 案件頁首依階段只給一顆主鈕（家長到了／核准改期／填招生資料／重新預約）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

## Task 4：一條時間線 `VisitCaseTimeline`（聯絡紀錄＋案件歷程，輸入框在最上）

**Files:**
- Create: `admin/src/api/visitTimeline.ts`
- Create: `admin/src/components/visit/VisitCaseTimeline.vue`
- Create: `admin/src/__tests__/visitTimeline.test.ts`
- Create: `admin/src/__tests__/visitCaseTimeline.test.ts`
- Delete: `admin/src/components/visit/FamilyContactNotes.vue`、`admin/src/components/VisitHistoryTimeline.vue`、`admin/src/__tests__/familyNotesHistory.test.ts`（案例移到上面兩個新測試）
- Modify: `admin/src/views/VisitDetailView.vue`、`admin/src/composables/useVisitCase.ts`（拿掉 `familyNoteList`）
- Modify tests: `caseHandling.test.ts`、`visitFamilyPage.test.ts`、`ux20260928B2.test.ts`、`ux20261005.test.ts`

**Interfaces:**
- Consumes: `vc.notes`、`vc.detail.history`、`vc.staff`、`vc.familyVisit`、`vc.familyLogs`、`vc.familyEvents`、`vc.extrasFailed`、`vc.family.loadExtras()`、`vc.canHandle`、`vc.canCreateAdmissions`、`vc.newNote`、`vc.followUpAt`、`vc.followUpTracked`、`vc.followUpPast`、`vc.pendingAction`、`vc.busy`、`vc.addNote()`；`admissions/family.ts` 的 `familyNotes`、`familyHistory`、`personLabel`、`recruitmentEventChanges`、`arrivedAt`；`api/visitHistory.ts` 的 `visitEventTitle`／`visitEventActor`／`visitEventChanges`／`visitEventRelatedId`
- Produces:
  - `api/visitTimeline.ts`：`type TimelineTone = 'staff' | 'parent' | 'system'`、`interface TimelineEntry { key; at; kind: 'note' | 'event'; tone; person; personEmail; title; body; lines: string[]; reason: string | null; related: string | null; followUp: string | null; phase: '' | 'before' | 'after'; source: '' | '預約' | '招生' }`、`interface TimelineInput { notes; history; staff; family?: { logs; events; arrivedAt: string | null } }`、`buildTimeline(input): TimelineEntry[]`
  - `VisitCaseTimeline.vue`：props `{ limit?: number; fullPath?: string }`；根元素 `section.panel.case-timeline.detail__notes`；清單 `ol.case-timeline__list[aria-label="聯絡紀錄與案件歷程"] > li.timeline__item[data-kind][data-tone][data-phase]`

- [ ] **Step 1：寫 `buildTimeline` 的失敗測試**

`admin/src/__tests__/visitTimeline.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { buildTimeline } from '../api/visitTimeline'

const note = (o: Record<string, unknown> = {}) => ({
  id: 'n1', note: '已致電，下週回覆', created_at: '2026-10-02T03:05:00Z',
  created_by: 'u1', created_by_email: 'amy@ivy.example', created_by_display_name: '怡君', ...o,
}) as never
const event = (o: Record<string, unknown> = {}) => ({
  id: 'e1', event_type: 'created', source: 'parent', actor_user_id: null, actor_email: null, actor_display_name: null,
  before: null, after: { slot: { slot_date: '2026-10-05', start_time: '14:00:00', end_time: '15:00:00' } },
  reason: null, created_at: '2026-10-01T08:25:00Z', ...o,
}) as never
const logged = (o: Record<string, unknown> = {}) => event({
  id: 'e2', event_type: 'contact_logged', source: 'staff', actor_user_id: 'u1', actor_email: 'amy@ivy.example',
  actor_display_name: '怡君', before: { follow_up_at: null }, after: { follow_up_at: '2026-10-05T02:00:00Z' },
  created_at: '2026-10-02T03:05:02Z', ...o,
})

describe('buildTimeline（2026-10-06 方向 C）', () => {
  it('聯絡紀錄和同一個交易寫的 contact_logged 合成一筆，下次聯絡掛在那筆下面', () => {
    const rows = buildTimeline({ notes: [note()], history: [event(), logged()], staff: [] })
    expect(rows.map((r) => [r.kind, r.title])).toEqual([['note', '記了一筆'], ['event', '家長從官網送出']])
    expect(rows[0]).toMatchObject({ person: '怡君', personEmail: 'amy@ivy.example', body: '已致電，下週回覆', followUp: '下次聯絡 2026/10/05 10:00' })
    expect(rows[1]!.tone).toBe('parent')
  })

  it('清掉下次聯絡寫「不用再追」；不是同一個人或差太久的 contact_logged 照歷程列', () => {
    const cleared = buildTimeline({ notes: [note()], history: [logged({ after: { follow_up_at: null } })], staff: [] })
    expect(cleared[0]!.followUp).toBe('不用再追')
    const other = buildTimeline({ notes: [note()], history: [logged({ actor_user_id: 'u2' }), logged({ id: 'e3', created_at: '2026-10-02T03:10:00Z' })], staff: [] })
    expect(other.filter((r) => r.kind === 'event').map((r) => r.key)).toEqual(['event-e3', 'event-e2'])
    expect(other.find((r) => r.kind === 'note')!.followUp).toBeNull()
  })

  it('新的在上；同一時間聯絡紀錄排在事件前面', () => {
    const same = '2026-10-03T01:00:00Z'
    const rows = buildTimeline({ notes: [note({ created_at: same })], history: [event({ id: 'e9', event_type: 'rescheduled', source: 'staff', created_at: same }), event()], staff: [] })
    expect(rows.map((r) => r.key)).toEqual(['note-n1', 'event-e9', 'event-e1'])
  })

  it('家庭版面：參觀前／後、參觀後聯絡的標題與排下次聯絡、事件標「預約」「招生」', () => {
    const log = { id: 'l1', contacted_at: '2026-10-07T02:00:00Z', channel: 'phone', reached: true, note: '媽媽說會預繳', next_follow_up_at: '2026-10-10T02:00:00Z', created_by_name: '怡君', created_by: 'u1', created_at: '2026-10-07T02:00:00Z' } as never
    const admissions = { id: 'r1', event_type: 'deposit_paid', from_stage: 'visited', to_stage: 'deposited', metadata_json: null, actor_name: 'amy@ivy.example', actor_user_id: 'u1', reason: null, created_at: '2026-10-08T02:00:00Z' } as never
    const arrived = '2026-10-06T02:30:00Z'
    const rows = buildTimeline({
      notes: [note()], history: [event(), event({ id: 'e5', event_type: 'completed', source: 'staff', created_at: arrived })], staff: [],
      family: { logs: [log], events: [admissions], arrivedAt: arrived },
    })
    expect(rows.map((r) => [r.key, r.phase, r.source])).toEqual([
      ['admissions-r1', '', '招生'],
      ['log-l1', 'after', ''],
      ['event-e5', '', '預約'],
      ['note-n1', 'before', ''],
      ['event-e1', '', '預約'],
    ])
    expect(rows[1]).toMatchObject({ title: '電話・聯絡到了', followUp: '排下次聯絡 2026/10/10 10:00' })
    expect(rows[0]!.personEmail).toBe('amy@ivy.example')
  })
})
```

（`familyNotes` 產生的 key 是 `booking-<id>`／`admissions-<id>`；`buildTimeline` 對外改成 `note-<id>`／`log-<id>`，事件是 `event-<id>`／`admissions-<id>`。）

- [ ] **Step 2：跑測試確認失敗**

Run: `npx vitest run src/__tests__/visitTimeline.test.ts` → FAIL（找不到模組）

- [ ] **Step 3：實作 `api/visitTimeline.ts`**

```ts
// 案件明細的時間線（2026-10-06 方向 C）：聯絡紀錄與案件歷程合成一條，新的在上。家庭版面再併入
// 參觀後聯絡與招生事件（家庭頁規格 5.4、5.5 的 familyNotes／familyHistory，順序規則沿用）。
import type { ContactLog, RecruitmentEvent, VisitContactNoteOut, VisitHistoryOut } from './types'
import { formatDateTime, type StaffPerson, staffEmail, staffOf } from './labels'
import { visitEventActor, visitEventChanges, visitEventRelatedId, visitEventTitle } from './visitHistory'
import { eventLabel } from '../admissions/constants'
import { familyHistory, familyNotes, personLabel, recruitmentEventChanges } from '../admissions/family'

export type TimelineTone = 'staff' | 'parent' | 'system'

export interface TimelineEntry {
  key: string
  at: string
  kind: 'note' | 'event'
  tone: TimelineTone
  /** 聯絡紀錄：誰記的；事件：誰做的（同事名字、「家長」或「系統」） */
  person: string
  /** 同事的完整 Email，滑過去看得到（同前綴的同事靠這個分辨） */
  personEmail: string
  /** 聯絡紀錄：「記了一筆」或參觀後聯絡的「電話・聯絡到了」；事件：動作名稱 */
  title: string
  body: string
  lines: string[]
  reason: string | null
  related: string | null
  /** 「下次聯絡 10/05 10:00」「不用再追」「排下次聯絡 …」 */
  followUp: string | null
  phase: '' | 'before' | 'after'
  source: '' | '預約' | '招生'
}

export interface TimelineInput {
  notes: readonly VisitContactNoteOut[]
  history: readonly VisitHistoryOut[]
  staff: readonly (StaffPerson & { id: string })[]
  /** 家庭版面才傳 */
  family?: { logs: readonly ContactLog[]; events: readonly RecruitmentEvent[]; arrivedAt: string | null }
}

const PAIR_WINDOW_MS = 5_000

/** 新增聯絡紀錄時，後端在同一個交易寫一筆 contact_logged 歷程（workflow_service.add_contact_note）：
 * 同一人、5 秒內的配成一對（取最近的），時間線只列一筆。 */
function pairContactEvents(notes: readonly VisitContactNoteOut[], history: readonly VisitHistoryOut[]): Map<string, VisitHistoryOut> {
  const pairs = new Map<string, VisitHistoryOut>()
  const taken = new Set<string>()
  for (const note of notes) {
    if (!note.created_by) continue
    const at = Date.parse(note.created_at)
    let best: VisitHistoryOut | null = null
    let bestGap = Number.POSITIVE_INFINITY
    for (const event of history) {
      if (event.event_type !== 'contact_logged' || taken.has(event.id) || event.actor_user_id !== note.created_by) continue
      const gap = Math.abs(Date.parse(event.created_at) - at)
      if (gap <= PAIR_WINDOW_MS && gap < bestGap) {
        best = event
        bestGap = gap
      }
    }
    if (best) {
      pairs.set(note.id, best)
      taken.add(best.id)
    }
  }
  return pairs
}

function followUpLine(event: VisitHistoryOut | undefined): string | null {
  const after = event?.after
  if (!after || !('follow_up_at' in after)) return null
  return typeof after.follow_up_at === 'string' ? `下次聯絡 ${formatDateTime(after.follow_up_at)}` : '不用再追'
}

export function buildTimeline(input: TimelineInput): TimelineEntry[] {
  const { family } = input
  const pairs = pairContactEvents(input.notes, input.history)
  const paired = new Set([...pairs.values()].map((event) => event.id))
  const noteById = new Map(input.notes.map((note) => [note.id, note]))

  const notes = familyNotes(input.notes, family?.logs ?? [], family?.arrivedAt ?? null).map((item): TimelineEntry => {
    const base = { at: item.at, kind: 'note' as const, tone: 'staff' as const, person: item.author, body: item.note, lines: [], reason: null, related: null, source: '' as const }
    if (item.kind === 'booking') {
      const id = item.key.replace(/^booking-/, '')
      const note = noteById.get(id)
      return {
        ...base, key: `note-${id}`, title: '記了一筆',
        personEmail: note?.created_by ? staffEmail(staffOf(note, 'created_by')) : '',
        followUp: followUpLine(pairs.get(id)), phase: family ? item.phase : '',
      }
    }
    return {
      ...base, key: `log-${item.key.replace(/^admissions-/, '')}`, title: item.headline, personEmail: '',
      followUp: item.nextFollowUpAt ? `排下次聯絡 ${formatDateTime(item.nextFollowUpAt)}` : null, phase: 'after',
    }
  })

  const bookingEntry = (event: VisitHistoryOut, source: TimelineEntry['source']): TimelineEntry => ({
    key: `event-${event.id}`, at: event.created_at, kind: 'event',
    tone: event.source === 'parent' ? 'parent' : event.source === 'staff' ? 'staff' : 'system',
    person: visitEventActor(event), personEmail: event.source === 'staff' ? staffEmail(staffOf(event, 'actor')) : '',
    title: visitEventTitle(event), body: '', lines: visitEventChanges(event, input.staff), reason: event.reason,
    related: visitEventRelatedId(event), followUp: null, phase: '', source,
  })
  const admissionsEntry = (event: RecruitmentEvent): TimelineEntry => ({
    key: `admissions-${event.id}`, at: event.created_at, kind: 'event', tone: 'staff',
    person: personLabel(event.actor_name), personEmail: event.actor_name?.includes('@') ? event.actor_name : '',
    title: eventLabel(event.event_type, event.metadata_json), body: '', lines: recruitmentEventChanges(event),
    reason: event.reason, related: null, followUp: null, phase: '', source: '招生',
  })
  const history = input.history.filter((event) => !paired.has(event.id))
  const events = family
    ? familyHistory(history, family.events).map((row) => (row.booking ? bookingEntry(row.booking, '預約') : admissionsEntry(row.admissions!)))
    : [...history].reverse().map((event) => bookingEntry(event, ''))

  // 新的在上；同一時間聯絡紀錄排在事件前面。兩邊各自已經新到舊，穩定排序保留各自原本的順序。
  return [...notes, ...events].sort(
    (a, b) => Date.parse(b.at) - Date.parse(a.at) || (a.kind === b.kind ? 0 : a.kind === 'note' ? -1 : 1),
  )
}
```

- [ ] **Step 4：跑測試確認通過**

Run: `npx vitest run src/__tests__/visitTimeline.test.ts` → PASS。若 `visitEventTitle` 對 `created`＋`source: 'parent'` 回的不是「家長從官網送出」，以 `api/visitHistory.ts` 實際回傳為準改測試的期望值（不要改 visitHistory）。

- [ ] **Step 5：寫元件的失敗測試**

`admin/src/__tests__/visitCaseTimeline.test.ts`：

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import VisitDetailView from '../views/VisitDetailView.vue'
import { button, cleanup, mockGet, pathsTo, visit as admissionsVisit } from './admissionsTestKit'
import { caseRoutes, mountRoutes, pastSlot, visitCase, VISIT_ID } from './visitCaseKit'

afterEach(() => { cleanup(); window.sessionStorage.clear() })

const created = { id: 'e1', event_type: 'created', source: 'parent', actor_user_id: null, actor_email: null, actor_display_name: null, before: null, after: null, reason: null, created_at: '2026-10-01T08:25:00Z' }
const note = { id: 'n1', note: '再次確認會來', created_at: '2026-10-02T01:40:00Z', created_by: 'u1', created_by_email: 'amy@ivy.example', created_by_display_name: '怡君' }

describe('VisitCaseTimeline', () => {
  it('輸入框在最上面（頁面第一個 textarea、第一個日期選擇器），下面一條紀錄新的在上', async () => {
    mockGet(caseRoutes(visitCase({ history: [created] }), [note]))
    const { wrapper } = await mountRoutes(`/visit-requests/${VISIT_ID}`, { detail: VisitDetailView })
    const timeline = wrapper.get('.case-timeline')
    expect(wrapper.find('textarea').element.closest('.case-timeline')).not.toBeNull()
    expect(wrapper.findComponent({ name: 'ElDatePicker' }).element.closest('.notes__follow')).not.toBeNull()
    const items = timeline.findAll('ol[aria-label="聯絡紀錄與案件歷程"] > li')
    expect(items.map((li) => li.attributes('data-kind'))).toEqual(['note', 'event'])
    expect(items[0]!.get('.notes__author').text()).toBe('怡君')
    expect(items[0]!.get('.notes__author').attributes('title')).toBe('amy@ivy.example')
    expect(items[0]!.text()).toContain('記了一筆')
    expect(items[0]!.text()).toContain('再次確認會來')
  })

  it('家庭版面：沒有輸入框；標參觀前／後與預約／招生；參觀後聯絡讀不到可以重新載入', async () => {
    const linked = admissionsVisit({ visit_request_id: VISIT_ID, has_visit_request: true })
    let logCalls = 0
    const get = mockGet({
      ...caseRoutes(visitCase({ status: 'completed', slot: pastSlot, slot_id: pastSlot.id, display_status: 'past', history: [created] }), [note]),
      '/admin/admissions/records': [linked],
      '/admin/admissions/records/v-1/events': [],
      '/admin/admissions/records/v-1/contact-logs': () => { logCalls += 1; throw new Error('boom') },
    })
    const { wrapper } = await mountRoutes(`/visit-requests/${VISIT_ID}`, { detail: VisitDetailView })
    expect(wrapper.find('textarea[aria-label="新增聯絡紀錄"]').exists()).toBe(false)
    expect(wrapper.get('.timeline__item[data-kind="note"]').attributes('data-phase')).toBe('before')
    expect(wrapper.get('.timeline__item[data-kind="event"] .timeline__source').text()).toBe('預約')
    expect(wrapper.get('.case-timeline').text()).toContain('參觀後的聯絡紀錄讀不到。')
    await button(wrapper.get('.case-timeline'), '重新載入')!.trigger('click')
    await flushPromises()
    expect(logCalls).toBe(2)
    expect(pathsTo(get, '/admin/admissions/records/v-1/contact-logs')).toHaveLength(2)
  })
})
```

- [ ] **Step 6：跑測試確認失敗**

Run: `npx vitest run src/__tests__/visitCaseTimeline.test.ts` → FAIL（沒有 `.case-timeline`）

- [ ] **Step 7：實作 `VisitCaseTimeline.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { formatDateTime } from '../../api/labels'
import { buildTimeline } from '../../api/visitTimeline'
import { arrivedAt } from '../../admissions/family'
import { injectVisitCase } from '../../composables/useVisitCase'

// 時間線（2026-10-06 方向 C）：聯絡紀錄與案件歷程合成一條，新的在上，輸入框固定在最上面。
// 家庭版面再併入參觀後聯絡與招生事件，沿用家庭頁規則：沒有輸入框（參觀後用處理區的「記錄聯絡」）。
// limit：預覽面板只列最新幾筆，其餘請打開完整案件頁（fullPath）。
const props = withDefaults(defineProps<{ limit?: number; fullPath?: string }>(), { limit: 0, fullPath: '' })
const vc = injectVisitCase()

const entries = computed(() => {
  const history = vc.detail?.history ?? []
  return buildTimeline({
    notes: vc.notes,
    history,
    staff: vc.staff,
    family: vc.familyVisit ? { logs: vc.familyLogs, events: vc.familyEvents, arrivedAt: arrivedAt(history) } : undefined,
  })
})
const shown = computed(() => (props.limit > 0 ? entries.value.slice(0, props.limit) : entries.value))
const hidden = computed(() => entries.value.length - shown.value.length)
const composing = computed(() => vc.canHandle && !vc.familyVisit)

// …原樣從 VisitDetailView 搬來（727–747）：disablePast、daysLaterAtTen、followUpShortcuts（含註解）…
</script>

<template>
  <section class="panel case-timeline detail__notes" aria-labelledby="case-timeline-title">
    <h2 id="case-timeline-title" class="visually-hidden">聯絡紀錄與案件歷程</h2>
    <!-- …原樣從 VisitDetailView 搬來（888–927 的 <div v-if="canHandle" class="notes__form">…</div>），只改：
         v-if="composing"、class 多 case-timeline__compose、所有 newNote／followUpAt／followUpTracked／followUpPast／
         pendingAction／busy／addNote 前面加 vc.（@keydown 寫成 "vc.addNote()"）、placeholder 改
         「這次聯絡談了什麼？例如：已致電，家長希望週六上午，下週回覆」、「新增紀錄」鈕加 type="primary" plain … -->
    <p v-else-if="vc.familyVisit" class="hint case-timeline__note">
      參觀前記在預約、參觀後記在招生，這裡一起列{{ vc.canCreateAdmissions ? '；參觀後的聯絡用「記錄聯絡」記一筆' : '' }}。
    </p>
    <p v-if="vc.familyVisit && vc.extrasFailed.logs" class="hint case-timeline__note">
      參觀後的聯絡紀錄讀不到。<el-button link type="primary" @click="vc.family.loadExtras()">重新載入</el-button>
    </p>
    <p v-if="vc.familyVisit && vc.extrasFailed.events" class="hint case-timeline__note">
      招生的歷程讀不到。<el-button link type="primary" @click="vc.family.loadExtras()">重新載入</el-button>
    </p>

    <ol v-if="shown.length" class="case-timeline__list" aria-label="聯絡紀錄與案件歷程">
      <li
        v-for="entry in shown"
        :key="entry.key"
        class="timeline__item"
        :data-kind="entry.kind"
        :data-tone="entry.tone"
        :data-phase="entry.phase || undefined"
      >
        <span class="timeline__dot" aria-hidden="true" />
        <div class="timeline__body">
          <p class="timeline__head">
            <template v-if="entry.kind === 'note'">
              <span v-if="entry.person" class="notes__author" :title="entry.personEmail || undefined">{{ entry.person }}</span>
              <strong>{{ entry.title }}</strong>
            </template>
            <template v-else>
              <strong>{{ entry.title }}</strong>
              <span v-if="entry.person" class="timeline__actor" :title="entry.personEmail || undefined">{{ entry.person }}</span>
            </template>
            <span v-if="entry.phase" class="timeline__phase">{{ entry.phase === 'after' ? '參觀後' : '參觀前' }}</span>
            <span v-if="entry.source" class="timeline__source">{{ entry.source }}</span>
            <time class="timeline__time num">{{ formatDateTime(entry.at) }}</time>
          </p>
          <p v-if="entry.body" class="timeline__text">{{ entry.body }}</p>
          <p v-for="line in entry.lines" :key="line" class="timeline__change">{{ line }}</p>
          <p v-if="entry.reason" class="timeline__reason">原因：{{ entry.reason }}</p>
          <p v-if="entry.followUp" class="timeline__next num">{{ entry.followUp }}</p>
          <router-link v-if="entry.related" :to="`/visit-requests/${entry.related}`" class="timeline__link">查看關聯案件</router-link>
        </div>
      </li>
    </ol>
    <p v-else class="hint case-timeline__note">
      {{ composing ? '還沒有聯絡紀錄。每次致電或傳訊後記一筆，同事接手時才知道談到哪裡。' : '還沒有紀錄。' }}
    </p>
    <p v-if="hidden > 0 && fullPath" class="case-timeline__more">
      <router-link :to="fullPath">還有 {{ hidden }} 筆，打開完整案件頁</router-link>
    </p>
  </section>
</template>

<style scoped>
.case-timeline {
  padding: 0;
}

.case-timeline__compose {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  padding: 16px 20px;
  border-bottom: 1px solid var(--line);
}

/* …原樣從 VisitDetailView 搬來的 .notes__row、.notes__untracked、.notes__follow、.notes__hint、.notes__past、
   .notes__status:empty，以及 @media (hover: none), (pointer: coarse) 的 .notes__hint …
   （.notes__row 加 justify-content: flex-end 讓「新增紀錄」靠右，同 mock） */

.case-timeline__note {
  margin: 0;
  padding: 14px 20px 0;
}

.case-timeline__list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.timeline__item {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  gap: 12px;
  padding: 14px 20px;
  border-top: 1px solid var(--line);
}

.timeline__item:first-child {
  border-top: 0;
}

.timeline__dot {
  width: 10px;
  height: 10px;
  margin: 6px auto 0;
  border: 2px solid var(--line-strong);
  border-radius: 50%;
  background: var(--surface);
}

.timeline__item[data-tone='staff'] .timeline__dot {
  border-color: var(--admin-accent);
  background: var(--el-color-primary-light-9);
}

.timeline__item[data-tone='parent'] .timeline__dot {
  border-color: var(--status-live);
}

.timeline__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  margin: 0;
  font-size: var(--text-base);
}

.timeline__head strong {
  font-weight: 600;
}

.notes__author,
.timeline__actor {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.timeline__item[data-kind='note'] .notes__author {
  color: var(--ink);
  font-size: var(--text-base);
  font-weight: 600;
}

.timeline__phase,
.timeline__source {
  padding: 0 6px;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--ink-3);
  font-size: var(--text-xs);
}

.timeline__time {
  color: var(--ink-3);
  font-size: var(--text-xs);
}

.timeline__text {
  margin: 4px 0 0;
  color: var(--ink);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.timeline__change,
.timeline__reason {
  margin: 2px 0 0;
  color: var(--ink-2);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

.timeline__reason {
  white-space: pre-wrap;
}

.timeline__next {
  margin: 6px 0 0;
  color: var(--brand-gold-ink);
  font-size: var(--text-sm);
}

.timeline__link {
  display: inline-block;
  margin-top: 2px;
  font-size: var(--text-sm);
}

.case-timeline__more {
  margin: 0;
  padding: 12px 20px;
  border-top: 1px solid var(--line);
  font-size: var(--text-sm);
}

@media (max-width: 720px) {
  .case-timeline__compose,
  .timeline__item {
    padding-left: 16px;
    padding-right: 16px;
  }
}
</style>

<style>
/* …原樣從 VisitDetailView 檔尾搬來的非 scoped 區塊（.notes__follow-popper 的觸控與 480px 規則）… */
</style>
```

- [ ] **Step 8：明細改用時間線**

`VisitDetailView.vue`：
- template：把 `<section v-if="!familyVisit" class="section detail__notes">…</section>`、`<FamilyContactNotes v-else … />`、`<section class="section">…案件歷程…</section>` 三段換成一行 `<VisitCaseTimeline />`（放在原本聯絡紀錄的位置：資料表之後、`ParentAccessLinkPanel` 之前）。
- script：`import VisitCaseTimeline from '../components/visit/VisitCaseTimeline.vue'`；拿掉 `FamilyContactNotes`、`VisitHistoryTimeline` 的 import；`disablePast`、`daysLaterAtTen`、`followUpShortcuts` 刪掉（已搬）；toRefs 清單拿掉 `familyNoteList`、`newNote`、`followUpAt`、`followUpPast`（若 template 已不用）。
- style：刪掉 `.notes__*`、`.notes`、`.notes__item*`、`.notes__meta`、`.notes__time`、`.notes__form` 規則與檔尾的非 scoped `<style>`；保留 900px 裡的 `.detail__notes { order: -1; }`（Task 5 重寫版面）。

`useVisitCase.ts`：刪掉 `familyNoteList` 與它在 `return` 的那一項（`familyNotes` import 若沒別處用也刪）。

`git rm admin/src/components/visit/FamilyContactNotes.vue admin/src/components/VisitHistoryTimeline.vue admin/src/__tests__/familyNotesHistory.test.ts`

- [ ] **Step 9：改既有測試**

- `caseHandling.test.ts`：`ol[aria-label="案件歷程"]` 改 `ol[aria-label="聯絡紀錄與案件歷程"]`，取 `li` 時改 `li[data-kind="event"]`。
- `visitFamilyPage.test.ts`：`.family-notes__item[data-phase]` 改 `.timeline__item[data-kind="note"][data-phase]`（`data-phase` 值同樣是 `before`／`after`）；`.timeline__item strong` 改 `.timeline__item[data-kind="event"] strong`；`.family-notes` 改 `.case-timeline`。
- `ux20260928B2.test.ts`：`findAll('h2')` 的期望「聯絡紀錄」改「聯絡紀錄與案件歷程」（仍在「家長管理連結」之前）。
- `ux20261005.test.ts`：`expect(source).toContain('class="section detail__notes"')` 改成 `expect(source).toContain('<VisitCaseTimeline')`。
- 以上改完，其他斷言（`.notes__author`、`.notes__past`、`.notes__status`、`.notes__follow`、`.notes__untracked`、第一個 textarea、第一個 ElDatePicker、「還沒有聯絡紀錄。每次致電…」）應該不用動。

- [ ] **Step 10：跑測試**

```bash
for f in visitTimeline visitCaseTimeline caseHandling visitFamilyPage ux20260928B2 ux20261005 displayNames followUpUx adminBugAudit20261006 uxRound6 uxRound8Cases visitDetails familyPage; do npx vitest run src/__tests__/$f.test.ts || break; done
```

Expected：全 PASS。

- [ ] **Step 11：Commit**

```bash
git add admin/src/api/visitTimeline.ts admin/src/components/visit/VisitCaseTimeline.vue admin/src/views/VisitDetailView.vue admin/src/composables/useVisitCase.ts admin/src/__tests__/visitTimeline.test.ts admin/src/__tests__/visitCaseTimeline.test.ts admin/src/__tests__/caseHandling.test.ts admin/src/__tests__/visitFamilyPage.test.ts admin/src/__tests__/ux20260928B2.test.ts admin/src/__tests__/ux20261005.test.ts
git commit -F - <<'MSG'
feat(admin): 案件的聯絡紀錄與歷程合成一條時間線，輸入框固定在最上

拿掉 FamilyContactNotes 與 VisitHistoryTimeline，家庭版面的參觀前後與招生事件一起列。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

（`git rm` 過的三個檔已在暫存區，不用再 add。）

---

## Task 5：家長資料表、設定列、對話框與明細最終版面

**Files:**
- Create: `admin/src/components/visit/VisitCaseFacts.vue`
- Create: `admin/src/components/visit/VisitCaseSettings.vue`
- Create: `admin/src/components/visit/VisitCaseDialogs.vue`
- Create: `admin/src/__tests__/visitCaseLayout.test.ts`
- Modify: `admin/src/components/ParentAccessLinkPanel.vue`（外觀改成設定列）
- Modify: `admin/src/views/VisitDetailView.vue`（最終組裝與版面）
- Modify tests: `visitDetails.test.ts`、`ux20260928B2.test.ts`、`ux20261005.test.ts`、`visitFamilyPage.test.ts`、`bookingConsentReadiness.test.ts`（若斷言 `.el-descriptions`）

**Interfaces:**
- Consumes: Task 1–4 的 `vc.*`、`VisitCaseHero`、`VisitCaseTimeline`
- Produces:
  - `VisitCaseFacts.vue`：props `{ compact?: boolean }`（compact 只列電話、孩子、Email）；根元素 `section.panel.detail__data.case-facts`；`dl.case-facts__list`（`dt`／`dd`）
  - `VisitCaseSettings.vue`：沒有 props；只在預約正常時出現；根元素 `section.panel.case-settings`，依序：場次列（`.settings-row.detail__actions`，內含 `.reschedule`）、家長管理連結列（`ParentAccessLinkPanel`）、最底 `.detail__danger`
  - `VisitCaseDialogs.vue`：沒有 props；`ManualVisitDialog`（重新預約）＋`RecordDialog`（招生資料）
  - 明細版面 class：`.detail__grid`、`.detail__main`、`.detail__side`、`.detail__family-actions`、`.detail__family-data`

- [ ] **Step 1：寫失敗的測試**

`admin/src/__tests__/visitCaseLayout.test.ts`：

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import VisitDetailView from '../views/VisitDetailView.vue'
import { button, cleanup, mockGet, visit as admissionsVisit } from './admissionsTestKit'
import { caseRoutes, mountRoutes, pastSlot, visitCase, VISIT_ID } from './visitCaseKit'
import { testUser } from './fixtures'

afterEach(() => { cleanup(); window.sessionStorage.clear() })

async function mountDetail(data: Record<string, unknown>, routes: Record<string, unknown> = {}, user?: never) {
  mockGet({ ...caseRoutes(data), ...routes })
  return (await mountRoutes(`/visit-requests/${VISIT_ID}`, { detail: VisitDetailView }, { user })).wrapper
}
const labels = (wrapper: Awaited<ReturnType<typeof mountDetail>>) => wrapper.findAll('.case-facts dt').map((dt) => dt.text())

describe('家長資料表（方向 C）', () => {
  it('官網送單：電話、孩子（姓名，生日）、Email、得知管道；電話與 Email 可點', async () => {
    const wrapper = await mountDetail(visitCase())
    expect(labels(wrapper)).toEqual(['電話', '孩子', 'Email', '得知管道'])
    expect(wrapper.get('.case-facts').text()).toContain('小安，2022/05/01')
    expect(wrapper.get('.case-facts a.detail__link[href="tel:0912000001"]').exists()).toBe(true)
    expect(wrapper.get('.case-facts a[href="mailto:p1@example.com"]').exists()).toBe(true)
    expect(wrapper.get('.case-facts .panel__head').text()).toContain('家長填寫的資料')
  })

  it('舊資料才有的欄位有值才列', async () => {
    const wrapper = await mountDetail(visitCase({ party_size: 4, questions: '娃娃車到不到鼎金', preferred_time: 'weekday_morning' }))
    expect(labels(wrapper)).toEqual(expect.arrayContaining(['參觀人數', '方便接電話時段', '想了解的事']))
  })
})

describe('設定列（方向 C）', () => {
  it('依序是場次、家長管理連結、最底的取消預約', async () => {
    const wrapper = await mountDetail(visitCase())
    const settings = wrapper.get('.case-settings')
    expect(settings.get('.detail__actions > .reschedule--collapsed').text()).toBe('改到其他場次…')
    expect(settings.text()).toContain('家長管理連結')
    const children = settings.element.children
    expect(children[children.length - 1]!.classList.contains('detail__danger')).toBe(true)
    expect(button(settings, '取消預約')).toBeDefined()
  })

  it('只能查看：看得到連結狀態，沒有改期、產生連結、取消', async () => {
    const viewer = testUser('readonly', { campus_keys: ['yihua'], effective_capabilities: ['booking.read'] })
    const wrapper = await mountDetail(visitCase(), {}, viewer as never)
    const settings = wrapper.get('.case-settings')
    expect(settings.text()).toContain('還沒有產生連結')
    expect(settings.find('.reschedule').exists()).toBe(false)
    expect(button(settings, '產生連結')).toBeUndefined()
    expect(settings.find('.detail__danger').exists()).toBe(false)
  })

  it('已取消、已到場沒有設定列', async () => {
    const wrapper = await mountDetail(visitCase({ status: 'cancelled', display_status: 'cancelled', cancelled_at: '2026-10-02T02:00:00Z' }))
    expect(wrapper.find('.case-settings').exists()).toBe(false)
  })
})

describe('明細版面（方向 C）', () => {
  it('兩欄：主欄是時間線，右欄是家長資料與設定列；家庭版面右欄先放處理區、主欄先放招生資料', async () => {
    const plain = await mountDetail(visitCase())
    expect(plain.get('.detail__main').find('.case-timeline').exists()).toBe(true)
    expect(plain.get('.detail__side').find('.case-facts').exists()).toBe(true)
    expect(plain.get('.detail__side').find('.case-settings').exists()).toBe(true)
    cleanup()
    const linked = admissionsVisit({ visit_request_id: VISIT_ID, has_visit_request: true })
    const family = await mountDetail(
      visitCase({ status: 'completed', slot: pastSlot, slot_id: pastSlot.id, display_status: 'past' }),
      { '/admin/admissions/records': [linked], '/admin/admissions/records/v-1': [] },
    )
    expect(family.get('.detail__side').element.firstElementChild!.classList.contains('detail__family-actions')).toBe(true)
    expect(family.get('.detail__main').element.firstElementChild!.classList.contains('family-data')).toBe(true)
    expect(family.get('.case-facts').text()).toContain('展開')
  })

  it('1100px 以下一欄，順序：處理區 → 招生資料 → 時間線 → 家長資料 → 設定列', () => {
    const source = readFileSync(fileURLToPath(new URL('../views/VisitDetailView.vue', import.meta.url)), 'utf8')
    const narrow = source.slice(source.indexOf('@media (max-width: 1100px)'))
    expect(narrow).toMatch(/\.detail__main,\s*\.detail__side\s*{\s*display: contents;/)
    const order = (cls: string) => Number(new RegExp(`\\.${cls} {\\s*order: (\\d+);`).exec(narrow)?.[1])
    expect([order('detail__family-actions'), order('detail__family-data'), order('detail__notes'), order('case-facts'), order('case-settings')]).toEqual([1, 2, 3, 4, 5])
  })
})
```

- [ ] **Step 2：跑測試確認失敗**

Run: `npx vitest run src/__tests__/visitCaseLayout.test.ts` → FAIL（沒有 `.case-facts`）

- [ ] **Step 3：實作 `VisitCaseFacts.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { ageLabel, consentRecordLabel, contactTimeLabel, formatDate, formatDateTime, partySizeLabel, referralSourceLabels } from '../../api/labels'
import { injectVisitCase } from '../../composables/useVisitCase'

// 家長資料表（2026-10-06 方向 C）：壓成一張兩欄表，孩子姓名與生日併一行。官網沒有的欄位（參觀人數、年齡、
// 方便時段、想了解的事、同意紀錄）只有舊資料或補登有值才列（第九輪）。家庭版面收合（家庭頁規格 5.3）。
// compact：預覽面板只列電話、孩子、Email。
const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
const vc = injectVisitCase()

interface Fact { label: string; text: string; href?: string; num?: boolean; pre?: boolean }

const facts = computed<Fact[]>(() => {
  const d = vc.detail
  if (!d) return []
  const child = d.child_name ? [d.child_name, d.child_birthdate ? formatDate(d.child_birthdate) : ''].filter(Boolean).join('，') : '未填寫'
  const rows: Fact[] = [
    { label: '電話', text: d.phone, href: `tel:${d.phone}`, num: true },
    { label: '孩子', text: child },
    { label: 'Email', text: d.email || '未填寫', href: d.email ? `mailto:${d.email}` : undefined },
  ]
  if (props.compact) return rows
  rows.push({ label: '得知管道', text: referralSourceLabels(d.referral_sources) })
  if (d.party_size) rows.push({ label: '參觀人數', text: partySizeLabel(d.party_size) })
  if (d.age) rows.push({ label: '家長填的年齡', text: ageLabel(d.age) })
  if (d.preferred_time) rows.push({ label: '方便接電話時段', text: contactTimeLabel(d.preferred_time) })
  if (d.questions) rows.push({ label: '想了解的事', text: d.questions, pre: true })
  if (d.consent_given) rows.push({ label: '同意紀錄', text: consentRecordLabel(d) })
  if (vc.confirmedAtShown) rows.push({ label: '確認時間', text: formatDateTime(d.confirmed_at) })
  if (d.cancelled_at) rows.push({ label: '取消時間', text: formatDateTime(d.cancelled_at) })
  return rows
})
const collapsible = computed(() => Boolean(vc.familyVisit) && !props.compact)
const open = computed(() => !collapsible.value || vc.bookingDataOpen)
</script>

<template>
  <section v-if="vc.detail" class="panel detail__data case-facts">
    <div class="panel__head">
      <h2>{{ vc.bookingDataTitle }}</h2>
      <el-button
        v-if="collapsible"
        link
        type="primary"
        :aria-expanded="open ? 'true' : 'false'"
        aria-controls="visit-booking-data"
        @click="vc.bookingDataOpen = !vc.bookingDataOpen"
      >{{ open ? '收起' : '展開' }}</el-button>
      <span v-else class="hint">{{ vc.isWebCase ? '官網表單' : '園方補登' }}</span>
    </div>
    <dl v-show="open" id="visit-booking-data" class="case-facts__list">
      <template v-for="fact in facts" :key="fact.label">
        <dt>{{ fact.label }}</dt>
        <dd :class="{ 'case-facts__pre': fact.pre }">
          <a v-if="fact.href" :href="fact.href" class="detail__link" :class="{ num: fact.num }">{{ fact.text }}</a>
          <template v-else>{{ fact.text }}</template>
        </dd>
      </template>
    </dl>
  </section>
</template>

<style scoped>
.case-facts .panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.case-facts__list {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 10px 12px;
  margin: 0;
  padding: 16px 20px;
}

.case-facts__list dt {
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.case-facts__list dd {
  margin: 0;
  font-size: var(--text-base);
  overflow-wrap: anywhere;
}

.case-facts__pre {
  white-space: pre-wrap;
}

/* 觸控裝置的電話、Email 連結放大到 44px 好點。 */
@media (hover: none), (pointer: coarse) {
  .detail__link {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
}
</style>
```

- [ ] **Step 4：`ParentAccessLinkPanel.vue` 改成設定列外觀**

只改 template 的外層與標題、style；script（含 `ElMessageBox.confirm` 的選項，`crossUx20261002.test.ts` 讀原始碼）一個字都不動：
- `<section class="section access">` 改 `<div class="access">`，結尾 `</section>` 改 `</div>`。
- `<div class="section__title"><h2>家長管理連結</h2></div>` 改 `<p class="settings-row__label">家長管理連結</p>`。
- 檔頭註解加一行：「2026-10-06 方向 C：放在案件明細的設定列，標題改成列標籤（不再是 h2）。」
- style 加：

```css
.access {
  display: grid;
  gap: 6px;
}

.access .hint {
  margin: 0;
  font-size: var(--text-sm);
}
```

- [ ] **Step 5：實作 `VisitCaseSettings.vue`**

```vue
<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { groupSlotsByDay, slotChoiceTime } from '../../utils/sessions'
import { injectVisitCase } from '../../composables/useVisitCase'
import ParentAccessLinkPanel from '../ParentAccessLinkPanel.vue'

// 設定列（2026-10-06 方向 C）：改場次、家長管理連結收成一列一列，取消預約在最底、分隔線之後（第四輪）。
// 只有預約正常的案件有這些事可做；已到場、未到場、已取消整塊不出現（重新預約在頁首）。
const vc = injectVisitCase()
const confirmed = computed(() => vc.detail?.status === 'confirmed')

// …原樣從 VisitDetailView 搬來：rescheduleSelect、rescheduleTitle、openManualReschedule（509–516，
//    裡面的 manualRescheduleOpen／rescheduleSlots 改成 vc.manualRescheduleOpen／vc.rescheduleSlots）…
</script>

<template>
  <section v-if="vc.detail && confirmed" class="panel case-settings">
    <h2 class="visually-hidden">場次、家長管理連結與取消</h2>
    <div v-if="vc.canHandle" class="settings-row detail__actions">
      <p class="settings-row__label">場次</p>
      <!-- …原樣從 VisitDetailView 搬來的 <div v-if="manualRescheduleShown" class="reschedule">…</div>
           與 <div v-else class="reschedule reschedule--collapsed">…</div>（998–1016），
           名稱前加 vc.（manualRescheduleShown 改 vc.manualRescheduleOpen；rescheduleSlotId、rescheduleSlots、
           rescheduleReason、pendingAction、busy、canManage、slotLabel、chosenSlotText、reschedule、detail 都加 vc.；
           @click="reschedule" 改 @click="vc.reschedule()"）。收合時的連結下面加一行：
           <p class="hint">改好後原場次的名額會空出來。</p> -->
    </div>
    <ParentAccessLinkPanel
      v-if="vc.linkApplicable"
      class="settings-row"
      :visit-id="vc.detail.id"
      :access-link="vc.detail.access_link"
      :can-handle="vc.canHandle"
      :status="vc.detail.status"
      :email="vc.detail.email ?? null"
      :email-enabled="vc.emailEnabled"
      :deadline-hours="vc.detail.parent_change_deadline_hours"
      @changed="vc.refreshDetail()"
    />
    <div v-if="vc.canHandle" class="detail__danger">
      <span class="hint">{{ vc.attendanceDue ? '家長沒來請用上方的「沒來」' : '家長不來了？' }}</span>
      <el-button text type="danger" :loading="vc.pendingAction === 'cancel'" :disabled="vc.busy" class="detail__cancel" @click="vc.cancel()">取消預約</el-button>
    </div>
  </section>
</template>

<style scoped>
.case-settings {
  padding: 0;
}

.settings-row {
  display: grid;
  gap: 6px;
  padding: 14px 20px;
  border-top: 1px solid var(--line);
}

.settings-row:first-of-type {
  border-top: 0;
}

:deep(.settings-row__label) {
  margin: 0;
  color: var(--ink-3);
  font-size: var(--text-sm);
}

/* …原樣從 VisitDetailView 搬來的 .reschedule、.reschedule--collapsed、.reschedule__title、.slot-chosen 規則… */

/* 取消預約與上面的設定隔開，並用分隔線宣告它是另一類動作，減少誤觸。 */
.detail__danger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid var(--line);
}

.detail__cancel {
  margin-right: -8px;
}

@media (max-width: 720px) {
  .settings-row,
  .detail__danger {
    padding-left: 16px;
    padding-right: 16px;
  }
}
</style>
```

（`ParentAccessLinkPanel` 的根元素帶 `settings-row` class，間距與分隔線用上面的規則；它內部的 `settings-row__label` 用 `:deep` 套同一個樣式。）

- [ ] **Step 6：實作 `VisitCaseDialogs.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { ARRIVAL_FORM_CANCEL_TEXT } from '../../composables/useArrivalAdmissionsForm'
import { useCampusScope } from '../../composables/useCampusScope'
import { injectVisitCase } from '../../composables/useVisitCase'
import ManualVisitDialog from '../ManualVisitDialog.vue'
import RecordDialog from '../admissions/RecordDialog.vue'

// 案件的兩個對話框：重新預約（另建新案）與招生資料表單（標記到場後自動打開、或頁首「填招生資料」）。
// RecordDialog 一直掛著：它在打開的那一刻（open 變 true）才把 record 帶進表單。
const vc = injectVisitCase()
const { visibleCampusKeys } = useCampusScope({ autoSelect: false })
// 剛標記到場才有說明，取消鈕寫「之後再填」；從「填招生資料」打開的維持「取消」。
const cancelText = computed(() => (vc.arrivalLead ? ARRIVAL_FORM_CANCEL_TEXT : undefined))
</script>

<template>
  <template v-if="vc.detail">
    <ManualVisitDialog v-model="vc.rebookOpen" :campus-keys="visibleCampusKeys" :related-from="vc.detail" @created="vc.onRebooked" />
    <RecordDialog
      v-if="vc.canCreateAdmissions"
      v-model="vc.arrivalOpen"
      mode="edit"
      :campus-key="vc.detail.campus_key"
      :record="vc.admissionsVisit"
      :options="vc.familyOptions"
      :lead="vc.arrivalLead"
      :cancel-text="cancelText"
      @saved="vc.family.replaceVisit"
      @stale="vc.family.reload()"
    />
  </template>
</template>
```

- [ ] **Step 7：`VisitDetailView.vue` 最終組裝**

template 的 `<template v-else-if="detail">` 整段換成：

```html
    <template v-else-if="detail">
      <VisitCaseHero />
      <div class="detail__grid">
        <div class="detail__main">
          <el-skeleton v-if="familyPending" animated :rows="6" class="detail__family-pending" />
          <template v-else>
            <FamilyAdmissionsData
              v-if="familyVisit"
              class="detail__family-data"
              :visit="familyVisit"
              :options="familyOptions"
              :editable="canCreateAdmissions"
              @saved="family.replaceVisit"
              @stale="family.reload"
            />
            <VisitCaseTimeline />
          </template>
        </div>
        <div class="detail__side">
          <section v-if="familyVisit" class="panel detail__family-actions">
            <div class="panel__head"><h2>處理</h2></div>
            <div class="panel__body">
              <FamilyActions
                :visit="familyVisit"
                :staff="familyStaff"
                :latest="latestFamilyContact"
                :rebookable="canHandle"
                :primary="false"
                @changed="onFamilyChanged"
                @stale="family.reload"
                @rebook="rebookOpen = true"
              />
            </div>
          </section>
          <VisitCaseFacts v-if="!familyPending" />
          <VisitCaseSettings />
        </div>
      </div>
      <VisitCaseDialogs />
    </template>
```

script：import `VisitCaseFacts`、`VisitCaseSettings`、`VisitCaseDialogs`；刪掉 `ManualVisitDialog`、`ParentAccessLinkPanel`、`RecordDialog`、`ARRIVAL_FORM_CANCEL_TEXT`、`groupSlotsByDay`／`slotChoiceTime`、`useCampusScope`、labels 裡不再用的函式、`rescheduleSelect`／`rescheduleTitle`／`manualRescheduleShown`／`openManualReschedule`（已搬到 Settings），toRefs 清單只留 template 與 script 還用到的名字。

`<style scoped>` 換成（`.detail__nav`、`.detail__back`、`.detail__next` 與 900px 的 `.detail__next` 規則保留，其餘刪掉）：

```css
.detail__nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

.detail__back {
  margin-left: -8px;
}

.detail__next {
  margin-right: -8px;
}

/* 兩欄（2026-10-06 方向 C）：主欄是招生資料與時間線，右欄是處理區、家長資料、設定列。
   右欄不 sticky：設定列比畫面高時，最底的取消預約會被卡住看不到。 */
.detail__grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 24px;
  align-items: start;
}

.detail__main,
.detail__side {
  display: grid;
  gap: 20px;
  min-width: 0;
}

/* 1100px 以下一欄：處理區 → 招生資料 → 時間線 → 家長資料 → 設定列。兩欄的外框拆掉
   （display: contents），子元素直接排進 grid 才能交錯排序。 */
@media (max-width: 1100px) {
  .detail__grid {
    grid-template-columns: minmax(0, 1fr);
    gap: 20px;
  }

  .detail__main,
  .detail__side {
    display: contents;
  }

  .detail__family-actions {
    order: 1;
  }

  .detail__family-data {
    order: 2;
  }

  .detail__notes {
    order: 3;
  }

  .case-facts {
    order: 4;
  }

  .case-settings {
    order: 5;
  }
}

@media (max-width: 900px) {
  /* 下一筆的件數比較長，窄螢幕允許換行，不擠出畫面。 */
  .detail__next {
    min-width: 0;
    height: auto;
    white-space: normal;
    text-align: right;
  }
}
```

（`.detail__family-pending` 骨架在 `.detail__main` 裡，一欄時 `display: contents` 後它沒有 order，排在 order 1 之前；這段時間右欄只有家長資料與設定列，順序可以接受。）

- [ ] **Step 8：改既有測試**

- `visitDetails.test.ts`：`'2022-06-18'` 改 `'2022/06/18'`（孩子一行改用 `formatDate`）。
- `ux20260928B2.test.ts`：`.detail__desc a.detail__link[href="tel:0912345678"]` 改 `.case-facts a.detail__link[href="tel:0912345678"]`；`findAll('h2')` 順序的 it 改成斷言 `.detail__main` 裡有 `.case-timeline`、`.detail__side` 裡 `.case-facts` 在 `.case-settings` 之前（家長管理連結已不是 h2）；`.reschedule:not(.reschedule--collapsed)` 與焦點的 it 不動（Settings 裡 class 與焦點邏輯照舊）。
- `ux20261005.test.ts`：
  - `@media (max-width: 900px)` 之後找 `.detail__main { display: flex; …`、`.detail__notes { order: -1;` 的斷言，改成斷言 `@media (max-width: 1100px)` 之後有 `.detail__main,\n  .detail__side {\n    display: contents;` 與 `.detail__notes {\n    order: 3;`（或直接刪掉，`visitCaseLayout.test.ts` 已涵蓋）。
  - `.detail__desc .el-descriptions__label` 改 `.case-facts dt`，期望的標籤從「電話、孩子姓名、出生年月日、Email、得知管道」改成「電話、孩子、Email、得知管道」；舊案才有的「參觀人數」「想了解的事」「同意紀錄」照舊。
  - `.detail__actions > .reschedule--collapsed`、`.reschedule__toggle`、`.reschedule__title` 照舊。
- `visitFamilyPage.test.ts`：`.detail__data h2` 照舊（`VisitCaseFacts` 根元素有 `detail__data`）；「展開」後斷言 `.el-descriptions` 可見的，改斷言 `#visit-booking-data` 可見；`.detail__call` 照舊。
- `bookingConsentReadiness.test.ts`：「參觀人數4 位」靠 dt＋dd 文字相連，應該不用改；若斷言 `.el-descriptions` 就改 `.case-facts`。
- `attentionExportDeadline.test.ts`、`receptionUx20261002.test.ts` 直接掛 `ParentAccessLinkPanel` 的 it：只看文字與按鈕，應該不用改。

- [ ] **Step 9：跑測試**

```bash
for f in visitCaseLayout visitCaseHero visitPrimaryAction visitCaseTimeline visitDetails ux20260928B2 ux20261005 visitFamilyPage bookingConsentReadiness caseHandling receptionUx20261002 attentionExportDeadline selfBookingDetail crossUx20261002 a11yStructure displayNames familyEntryPoints uxRound6 uxRound8Cases followUpUx adminBugAudit20261006 admissionsVisitDetail arrivalAdmissionsForm; do npx vitest run src/__tests__/$f.test.ts || break; done
```

Expected：全 PASS。

- [ ] **Step 10：手動目測（controller 在 Task 11 統一做；實作者可跳過）**

- [ ] **Step 11：Commit**

```bash
git add admin/src/components/visit/VisitCaseFacts.vue admin/src/components/visit/VisitCaseSettings.vue admin/src/components/visit/VisitCaseDialogs.vue admin/src/components/ParentAccessLinkPanel.vue admin/src/views/VisitDetailView.vue admin/src/__tests__/visitCaseLayout.test.ts admin/src/__tests__/visitDetails.test.ts admin/src/__tests__/ux20260928B2.test.ts admin/src/__tests__/ux20261005.test.ts admin/src/__tests__/visitFamilyPage.test.ts admin/src/__tests__/bookingConsentReadiness.test.ts
git commit -F - <<'MSG'
feat(admin): 案件明細改成時間線＋家長資料表＋設定列，取消留在最底

改場次、家長管理連結收成設定列；1100px 以下一欄依處理、資料、時間線排序。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

（`bookingConsentReadiness.test.ts` 若沒改就不要 add。）

---

# Phase B：參觀案件＝照參觀日排的行程清單


## Task 6：後端：列表的接待頁籤 `view`、依參觀時間排序、`view-counts`

**Files:**
- Modify: `backend/app/booking/status_groups.py`
- Modify: `backend/app/booking/schemas.py`（`VisitGroupCountsOut` 下面加 `VisitViewCountsOut`）
- Modify: `backend/app/booking/routes.py`（`VisitRequestFilters`、`list_visit_requests`、新端點）
- Create: `backend/tests/test_visit_views.py`
- Modify: `admin/src/api/labels.ts`（`VISIT_VIEWS`、`VISIT_VIEW_LABELS`、`legacyStatusView`、操作紀錄 `view`）
- Modify: `admin/src/__tests__/visitGroups.test.ts`（加 `legacyStatusView` 案例）
- Regenerate: `contracts/openapi.json`、`contracts/generated/website-api.d.ts`

**Interfaces:**
- Produces:
  - `status_groups.VIEWS = ("upcoming", "past", "arrived", "cancelled")`、`status_groups.view_condition(view: str, now: datetime | None = None)`
  - `GET /admin/visit-requests?view=upcoming|past|arrived|cancelled`（可和 `status` 疊加；`group` 舊參數照舊）
  - `GET /admin/visit-requests?order=newest|oldest|visit_asc|visit_desc`（`visit_*` 依場次日期、開始時間，沒有場次的排最後；同時間依送出時間，最後依 id，分頁穩定）
  - `GET /admin/visit-requests/view-counts` → `VisitViewCountsOut { upcoming: int; past_unmarked: int }`（套用同一組篩選，`view`／`group`／`status` 除外）
  - `GET /admin/visit-requests/export?view=…`（`VisitRequestFilters` 共用，自動支援）
  - admin `labels.ts`：`VISIT_VIEWS`、`type VisitView`、`VISIT_VIEW_LABELS`、`legacyStatusView(status: string): VisitView | ''`

- [ ] **Step 1：寫失敗的後端測試**

`backend/tests/test_visit_views.py`：

```python
"""案件列表的接待頁籤（2026-10-06 方向 B）：接下來以台北「今天」為界、今天整天都在；
時間已過是場次已開始、還沒到場（含沒來）；已到場、已取消各一頁。頁籤可以重疊。"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime, time, timedelta

import pytest
from sqlalchemy import select, update

from app.booking import status_groups
from app.booking.models import VisitRequest, VisitSlot
from app.common.timezones import OPERATING_TZ, today_local
from tests.conftest import create_slot

pytestmark = pytest.mark.usefixtures("booking_consent")
API = "/api/website/v1"


async def _case(admin_client, name: str, *, days_ahead: int, campus_key: str = "yihua") -> str:
    """櫃台補登一筆（不經官網送單，避開每校每小時的送單上限）。"""
    slot_id = await create_slot(admin_client, campus_key, days_ahead=days_ahead)
    resp = await admin_client.post(
        f"{API}/admin/visit-requests",
        json={"campus_key": campus_key, "source": "phone", "parent_name": name, "phone": "0912345678", "consent_given": True, "slot_id": slot_id},
        headers={"Idempotency-Key": f"views-{uuid.uuid4()}"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


async def _move(db, case_id: str, *, days: int, start: time, end: time) -> None:
    """把案件的場次移到今天加 days 天（測試前置；公開預約與補登只收還沒開始的場次）。"""
    slot_id = await db.scalar(select(VisitRequest.slot_id).where(VisitRequest.id == uuid.UUID(case_id)))
    await db.execute(
        update(VisitSlot).where(VisitSlot.id == slot_id).values(slot_date=today_local() + timedelta(days=days), start_time=start, end_time=end)
    )
    await db.commit()


async def _ids(client, **params) -> list[str]:
    resp = await client.get(f"{API}/admin/visit-requests", params=params)
    assert resp.status_code == 200, resp.text
    return [row["id"] for row in resp.json()]


async def _scenario(admin_client, db) -> dict[str, str]:
    cases = {
        "future": await _case(admin_client, "三天後", days_ahead=3),
        "today_started": await _case(admin_client, "今天還沒標", days_ahead=4),
        "today_arrived": await _case(admin_client, "今天到了", days_ahead=5),
        "yesterday_unmarked": await _case(admin_client, "昨天沒標", days_ahead=6),
        "yesterday_no_show": await _case(admin_client, "昨天沒來", days_ahead=7),
        "old_arrived": await _case(admin_client, "前天到了", days_ahead=8),
        "cancelled": await _case(admin_client, "取消了", days_ahead=9),
    }
    await _move(db, cases["today_started"], days=0, start=time(0, 0), end=time(0, 30))
    await _move(db, cases["today_arrived"], days=0, start=time(0, 0), end=time(0, 30))
    await _move(db, cases["yesterday_unmarked"], days=-1, start=time(10, 0), end=time(11, 0))
    await _move(db, cases["yesterday_no_show"], days=-1, start=time(11, 0), end=time(12, 0))
    await _move(db, cases["old_arrived"], days=-2, start=time(10, 0), end=time(11, 0))
    for key, action in (("today_arrived", "complete"), ("old_arrived", "complete"), ("yesterday_no_show", "no-show")):
        resp = await admin_client.post(f"{API}/admin/visit-requests/{cases[key]}/{action}")
        assert resp.status_code == 200, resp.text
    assert (await admin_client.post(f"{API}/admin/visit-requests/{cases['cancelled']}/cancel", json={})).status_code == 200
    return cases


@pytest.mark.asyncio
async def test_views_split_by_taipei_today_and_counts(admin_client, db_session):
    c = await _scenario(admin_client, db_session)
    assert set(await _ids(admin_client, view="upcoming")) == {c["future"], c["today_started"], c["today_arrived"]}
    assert set(await _ids(admin_client, view="past")) == {c["today_started"], c["yesterday_unmarked"], c["yesterday_no_show"]}
    assert set(await _ids(admin_client, view="arrived")) == {c["today_arrived"], c["old_arrived"]}
    assert set(await _ids(admin_client, view="cancelled")) == {c["cancelled"]}
    # 「只看尚未確認到場」＝時間已過＋預約正常，和總覽 awaiting_attendance 同一批。
    assert set(await _ids(admin_client, view="past", status="confirmed")) == {c["today_started"], c["yesterday_unmarked"]}

    counts = await admin_client.get(f"{API}/admin/visit-requests/view-counts")
    assert counts.status_code == 200, counts.text
    assert counts.json() == {"upcoming": 3, "past_unmarked": 2}
    dashboard = (await admin_client.get(f"{API}/admin/dashboard")).json()
    assert dashboard["awaiting_attendance"] == counts.json()["past_unmarked"]


@pytest.mark.asyncio
async def test_visit_order_sorts_by_slot_and_pages_stably(admin_client, db_session):
    c = await _scenario(admin_client, db_session)
    assert await _ids(admin_client, view="upcoming", order="visit_asc") == [c["today_started"], c["today_arrived"], c["future"]]
    assert await _ids(admin_client, view="past", order="visit_desc") == [c["today_started"], c["yesterday_no_show"], c["yesterday_unmarked"]]
    assert await _ids(admin_client, view="upcoming", order="visit_asc", page_size=2, page=2) == [c["future"]]


@pytest.mark.asyncio
async def test_today_not_started_is_upcoming_but_not_past(admin_client, db_session):
    case = await _case(admin_client, "今天下午", days_ahead=3)
    await _move(db_session, case, days=0, start=time(14, 0), end=time(15, 0))
    morning = datetime.combine(today_local(), time(0, 0, 30), tzinfo=OPERATING_TZ)

    async def members(view: str) -> set[str]:
        rows = await db_session.execute(select(VisitRequest.id).where(status_groups.view_condition(view, morning)))
        return {str(row) for row in rows.scalars()}

    assert case in await members("upcoming")
    assert case not in await members("past")


@pytest.mark.asyncio
@pytest.mark.parametrize(("param", "value"), [("view", "pending"), ("view", "all"), ("order", "visit")])
async def test_unknown_view_or_order_is_rejected(admin_client, param, value):
    response = await admin_client.get(f"{API}/admin/visit-requests", params={param: value})
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_export_and_counts_follow_view_and_campus_scope(admin_client, minghua_client, db_session):
    c = await _scenario(admin_client, db_session)
    resp = await admin_client.get(f"{API}/admin/visit-requests/export", params={"view": "cancelled"})
    assert resp.status_code == 200, resp.text
    names = {row[3] for row in list(csv.reader(io.StringIO(resp.content.decode("utf-8-sig"))))[1:]}
    assert names == {"取消了"}
    other = await minghua_client.get(f"{API}/admin/visit-requests/view-counts")
    assert other.status_code == 200, other.text
    assert other.json() == {"upcoming": 0, "past_unmarked": 0}
    assert c["future"] not in await _ids(minghua_client, view="upcoming")
```

（`_case` 照 `tests/test_visit_attention_export.py` 的 `_manual` 補登寫法。若補登回 4xx、訊息說該校預約方式沒開放，在 `_scenario` 與 `test_today_not_started_is_upcoming_but_not_past` 開頭先呼叫一次 conftest 的 `await set_booking_mode(admin_client, "yihua", mode="slots")`，並把它加進 import。）

- [ ] **Step 2：跑測試確認失敗**

Run: `cd $WT/backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_visitux1006_test uv run pytest tests/test_visit_views.py -q`
Expected: FAIL（`view` 被忽略、`order=visit_asc` 422、`view-counts` 422 或 404、`status_groups` 沒有 `view_condition`）

- [ ] **Step 3：`status_groups.py` 加 `VIEWS` 與 `view_condition`**

檔頭 docstring 後面接一段說明；`GROUPS` 下面加：

```python
# 案件列表的接待頁籤（2026-10-06 方向 B）。和上面的 GROUPS 不同：接下來以台北「今天」為界，
# 今天整天都留在接下來（總覽「今天的行程板」同一個口徑）；時間已過是場次已開始、還沒到場
# （含未到場）；已到場另一頁。頁籤可以重疊：今天開始了還沒標記的同時在接下來與時間已過，
# 今天到場的同時在接下來與已到場。GROUPS 保留給總覽、成效統計與舊連結。
VIEWS = ("upcoming", "past", "arrived", "cancelled")


def _slots_from_day(day: date):
    return select(VisitSlot.id).where(VisitSlot.slot_date >= day)


def view_condition(view: str, now: datetime | None = None):
    current = now or now_utc()
    if view == "cancelled":
        return VisitRequest.status == VisitRequestStatus.CANCELLED.value
    if view == "arrived":
        return VisitRequest.status == VisitRequestStatus.COMPLETED.value
    if view == "upcoming":
        return and_(
            VisitRequest.status != VisitRequestStatus.CANCELLED.value,
            VisitRequest.slot_id.in_(_slots_from_day(current.astimezone(OPERATING_TZ).date())),
        )
    if view == "past":
        return and_(
            VisitRequest.status.in_((VisitRequestStatus.CONFIRMED.value, VisitRequestStatus.NO_SHOW.value)),
            VisitRequest.slot_id.in_(_started_slot_ids(current)),
        )
    raise ValueError(view)
```

- [ ] **Step 4：`schemas.py` 加 `VisitViewCountsOut`**

```python
class VisitViewCountsOut(BaseModel):
    """接待頁籤的數字（2026-10-06 方向 B）：接下來寫全部件數；時間已過只寫還沒標記到場的
    （＝總覽「參觀時間過了，還沒標記到場」、pending_kinds.awaiting_attendance）。已到場、已取消不寫數字。"""

    upcoming: int
    past_unmarked: int
```

- [ ] **Step 5：`routes.py`：篩選、排序、件數**

`from app.booking.schemas import (` 清單加 `VisitViewCountsOut`；`from sqlalchemy.orm import selectinload` 改成 `from sqlalchemy.orm import aliased, selectinload`。

`VisitRequestFilters.__init__` 參數在 `open_only` 之後加：

```python
        view: str | None = Query(
            default=None,
            pattern="^(upcoming|past|arrived|cancelled)$",
            description="接待頁籤：upcoming 接下來（台北今天起、未取消）／past 時間已過（已開始、預約正常或未到場）／arrived 已到場／cancelled 已取消",
        ),
```

並在 `self.open_only = open_only` 下一行加 `self.view = view`；`apply()` 在 `if self.open_only:` 那段後面加：

```python
        if self.view:
            stmt = stmt.where(status_groups.view_condition(self.view))
```

`audit_metadata()` 的 `applied` 字典在 `"group": self.group,` 後面加 `"view": self.view,`。

`list_visit_requests` 改成：

```python
@router.get("/admin/visit-requests", response_model=list[VisitRequestDetailOut])
async def list_visit_requests(
    filters: VisitRequestFilters = Depends(),
    order: str = Query(
        default="newest",
        pattern="^(newest|oldest|visit_asc|visit_desc)$",
        description="newest／oldest 依送出時間；visit_asc／visit_desc 依參觀時間（沒有場次的排最後）",
    ),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[VisitRequestDetailOut]:
    require_scope(current_user, "booking.read")
    stmt = filters.apply(select(VisitRequest).options(selectinload(VisitRequest.slot)), current_user, "booking.read")
    stmt = _apply_list_order(stmt, order).offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(stmt)
    return [VisitRequestDetailOut.model_validate(r) for r in result.scalars()]


def _apply_list_order(stmt, order: str):
    """列表排序。最後都補 id，同一時間的案件在翻頁時不會重複或漏掉。"""
    if order in ("visit_asc", "visit_desc"):
        # 行程清單（2026-10-06 方向 B）：依參觀日期與開始時間；沒有場次的舊案排最後。
        # join 用別名：篩選條件裡 `slot_id IN (SELECT visit_slots.id …)` 的子查詢才不會被自動關聯到這個 join。
        slot = aliased(VisitSlot)
        stmt = stmt.outerjoin(slot, slot.id == VisitRequest.slot_id)
        if order == "visit_asc":
            return stmt.order_by(
                slot.slot_date.asc().nulls_last(), slot.start_time.asc().nulls_last(),
                VisitRequest.created_at.asc(), VisitRequest.id.asc(),
            )
        return stmt.order_by(
            slot.slot_date.desc().nulls_last(), slot.start_time.desc().nulls_last(),
            VisitRequest.created_at.desc(), VisitRequest.id.desc(),
        )
    if order == "oldest":
        return stmt.order_by(VisitRequest.created_at.asc(), VisitRequest.id.asc())
    return stmt.order_by(VisitRequest.created_at.desc(), VisitRequest.id.desc())
```

`visit_request_group_counts` 的 `filters.group = None` 下面加 `filters.view = None`（舊端點保留，前端不再呼叫）。緊接在 `group-counts` 端點後面（一定要在任何 `/admin/visit-requests/{visit_request_id}` 路由之前）加：

```python
@router.get("/admin/visit-requests/view-counts", response_model=VisitViewCountsOut)
async def visit_request_view_counts(
    filters: VisitRequestFilters = Depends(),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitViewCountsOut:
    """接待頁籤上的數字：套用同一組篩選（頁籤、分組、狀態除外）。時間已過只數還沒標記到場的，
    和總覽、成效統計同一個條件（pending_kinds.awaiting_attendance），數字點進去才是同一批。"""
    require_scope(current_user, "booking.read")
    filters.status = None
    filters.group = None
    filters.view = None
    base = filters.apply(select(func.count()).select_from(VisitRequest), current_user, "booking.read")
    upcoming = (await db.execute(base.where(status_groups.view_condition("upcoming")))).scalar_one()
    unmarked = (await db.execute(base.where(pending_kinds.condition("awaiting_attendance")))).scalar_one()
    return VisitViewCountsOut(upcoming=upcoming, past_unmarked=unmarked)
```

- [ ] **Step 6：跑後端測試**

```bash
cd $WT/backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_visitux1006_test uv run pytest tests/test_visit_views.py tests/test_visit_groups.py tests/test_visit_attention_export.py tests/test_permission_table.py -q
```

Expected: 全 PASS（舊 `group` 與匯出測試不受影響）。

- [ ] **Step 7：admin `labels.ts`**

在 `legacyStatusGroup` 函式下面加：

```ts
// 案件列表的接待頁籤（2026-10-06 方向 B）：後端 status_groups.view_condition。和上面的分組（group）不同，
// 接下來以台北「今天」為界、今天整天都在，頁籤可以重疊；分組留給總覽、成效統計與舊連結。
export const VISIT_VIEWS = ['upcoming', 'past', 'arrived', 'cancelled'] as const
export type VisitView = typeof VISIT_VIEWS[number]
export const VISIT_VIEW_LABELS: Record<VisitView, string> = { upcoming: '接下來', past: '時間已過', arrived: '已到場', cancelled: '已取消' }

// 舊書籤的 ?status=：對到接待頁籤；舊流程的 new／contacting／pending_confirmation 回空字串（落到「全部」）。
const LEGACY_STATUS_VIEW: Record<string, VisitView> = { confirmed: 'upcoming', completed: 'arrived', no_show: 'past', cancelled: 'cancelled' }
export function legacyStatusView(status: string): VisitView | '' {
  return LEGACY_STATUS_VIEW[status] ?? ''
}
```

操作紀錄細節的對照表（搜尋 `group: (v) => \`篩選分組：`）下一行加：

```ts
  view: (v) => `篩選頁籤：${(VISIT_VIEW_LABELS as Record<string, string>)[String(v)] ?? String(v)}`,
```

`visitGroups.test.ts` 檔尾加：

```ts
describe('接待頁籤的舊狀態對照（2026-10-06 方向 B）', () => {
  it.each([
    ['confirmed', 'upcoming'], ['completed', 'arrived'], ['no_show', 'past'], ['cancelled', 'cancelled'],
    ['new', ''], ['contacting', ''], ['pending_confirmation', ''], ['', ''],
  ])('%s → %s', (status, view) => {
    expect(legacyStatusView(status)).toBe(view)
  })
})
```

（import 加 `legacyStatusView`。）

- [ ] **Step 8：重產契約**

```bash
cd $WT; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm run contract:generate; npm run contract:check
git diff --stat contracts/
```

Expected：`contract:check` 通過；diff 只有 `view` 參數、`order` 的 pattern、`/admin/visit-requests/view-counts`、`VisitViewCountsOut`。

- [ ] **Step 9：跑前端相關測試**

```bash
cd $WT/admin; for f in visitGroups labelCoverage labels; do npx vitest run src/__tests__/$f.test.ts || break; done
```

Expected：PASS（`labelCoverage` 確認新的 `view` metadata 鍵有中文）。

- [ ] **Step 10：Commit**

```bash
cd $WT
git add backend/app/booking/status_groups.py backend/app/booking/schemas.py backend/app/booking/routes.py backend/tests/test_visit_views.py admin/src/api/labels.ts admin/src/__tests__/visitGroups.test.ts contracts/openapi.json contracts/generated/website-api.d.ts
git commit -F - <<'MSG'
feat(api): 參觀案件列表加接待頁籤 view、依參觀時間排序與 view-counts

接下來以台北今天為界；時間已過的件數和總覽「還沒標記到場」同一個條件。舊 group 參數不變，沒有 migration。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

## Task 7：列表的網址、頁籤與 API 條件（`api/visitListQuery.ts`），舊連結相容

這一步列表還是 el-table（Task 8 才換成行程清單）；只換頁籤、網址、API 參數、排序與件數。

**Files:**
- Create: `admin/src/api/visitListQuery.ts`
- Create: `admin/src/__tests__/visitListQuery.test.ts`
- Modify: `admin/src/views/VisitRequestsView.vue`（script 的篩選／網址／件數；template 的頁籤與排序選單）
- Modify: `admin/src/views/VisitDetailView.vue`（`LIST_KEYS` 加 `view`；返回連結帶頁籤名）
- Modify: `admin/src/views/DashboardView.vue`（兩個 `/visit-requests?group=upcoming&order=oldest` 改 `/visit-requests?group=upcoming`）
- Modify: `admin/src/api/labels.ts`（刪 `legacyStatusGroup`／`LEGACY_STATUS_GROUP`，已無呼叫端）
- Modify tests: `listUx.test.ts`、`visitGroups.test.ts`、`openRequestsUx.test.ts`、`receptionUx20261002.test.ts`、`attentionExportDeadline.test.ts`、`adminUx.test.ts`、`ux20260928B1.test.ts`、`ux20261005.test.ts`、`uxRound6.test.ts`、`shellDashboard20261002.test.ts`、`familyEntryPoints.test.ts`

**Interfaces:**
- Consumes: Task 6 的 `VISIT_VIEWS`、`VISIT_VIEW_LABELS`、`legacyStatusView`、`type VisitView`；後端 `view`、`order=visit_*`、`view-counts`
- Produces（`api/visitListQuery.ts`）：
  - `type ListTab = VisitView | 'all'`、`LIST_TABS: readonly ListTab[]`（`['upcoming','past','arrived','cancelled','all']`）、`LIST_TAB_LABELS: Record<ListTab, string>`、`DEFAULT_TAB: ListTab = 'upcoming'`
  - `type ListOrder = 'visit' | 'newest' | 'oldest'`、`type ApiOrder = 'newest' | 'oldest' | 'visit_asc' | 'visit_desc'`
  - `interface ListState { tab: ListTab; attendanceOnly: boolean; q: string; campus: string; open: boolean; source: string; created: [string, string] | null; due: boolean; attention: boolean; order: ListOrder; page: number }`
  - `tabFromQuery(query: LocationQuery): ListTab`、`parseListQuery(query, scope: { campusKeys: readonly string[]; multiCampus: boolean }): ListState`、`listStateQuery(state: ListState): Record<string, string>`、`searchTerm(raw: string): string`、`listApiParams(state: ListState, options?: { counts?: boolean }): URLSearchParams`、`listApiOrder(state: Pick<ListState, 'tab' | 'order'>): ApiOrder`、`groupsByDay(state: Pick<ListState, 'order'>): boolean`
  - `VisitRequestsView` 內部的頁籤 ref 改名 `activeTab`（Task 8、9 用）

- [ ] **Step 1：寫失敗的測試（舊連結落點是 Review Focus 5）**

`admin/src/__tests__/visitListQuery.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import type { LocationQuery } from 'vue-router'
import { listApiOrder, listApiParams, listStateQuery, parseListQuery, searchTerm, tabFromQuery, type ListState } from '../api/visitListQuery'

const scope = { campusKeys: ['yihua', 'minghua'], multiCampus: true }
const query = (raw: string): LocationQuery => Object.fromEntries(new URLSearchParams(raw))
const state = (changes: Partial<ListState> = {}): ListState => ({
  tab: 'upcoming', attendanceOnly: false, q: '', campus: '', open: false, source: '', created: null,
  due: false, attention: false, order: 'visit', page: 1, ...changes,
})

describe('舊連結落在哪個頁籤（2026-10-06 方向 B）', () => {
  it.each([
    ['', 'upcoming', false, '側欄、總覽「補登案件」'],
    ['group=upcoming', 'upcoming', false, '總覽今天有幾組參觀'],
    ['group=upcoming&order=oldest', 'upcoming', false, '改版前的總覽連結'],
    ['group=past&status=confirmed', 'past', true, '總覽、成效統計、招生看板「還沒標記到場」'],
    ['campus=yihua&group=past&status=confirmed', 'past', true, '成效統計帶校區'],
    ['group=past', 'past', false, '舊的時間已過'],
    ['group=cancelled', 'cancelled', false, '舊的已取消'],
    ['due=1', 'all', false, '總覽到期待追蹤'],
    ['campus=yihua&due=1', 'all', false, '成效統計到期待追蹤'],
    ['attention=1&campus=yihua', 'all', false, '待人工處理'],
    ['assignee=inactive&open=1', 'all', false, '拿掉承辦人前的舊連結'],
    ['status=confirmed&order=oldest', 'upcoming', false, '舊書籤 ?status='],
    ['status=completed', 'arrived', false, '舊書籤已到場'],
    ['status=no_show', 'past', false, '舊書籤未到場'],
    ['status=new', 'all', false, '舊流程狀態'],
    ['group=pending', 'all', false, '拿掉的待處理分組'],
    ['q=%E9%99%B3', 'all', false, '改版前在「全部」搜尋的書籤'],
    ['group=arrived', 'arrived', false, '新的已到場'],
    ['group=all&due=1', 'all', false, '新的全部'],
  ])('?%s → %s（%s）', (raw, tab, attendanceOnly) => {
    const parsed = parseListQuery(query(raw), scope)
    expect(parsed.tab).toBe(tab)
    expect(parsed.attendanceOnly).toBe(attendanceOnly)
  })

  it('tabFromQuery 只看 group／status 與有沒有其他條件', () => {
    expect(tabFromQuery({})).toBe('upcoming')
    expect(tabFromQuery({ page: '2' })).toBe('all')
  })

  it('其他條件照舊讀：校區要在可見範圍、日期要成對、排序只收 newest／oldest', () => {
    const parsed = parseListQuery(query('group=upcoming&campus=chongde&created_from=2026-10-01&order=visit&page=3&source=phone'), scope)
    expect(parsed).toMatchObject({ campus: '', created: null, order: 'visit', page: 3, source: 'phone' })
  })
})

describe('寫回網址', () => {
  it('只有「接下來＋沒有其他條件」省略 group', () => {
    expect(listStateQuery(state())).toEqual({})
    expect(listStateQuery(state({ q: '陳' }))).toEqual({ group: 'upcoming', q: '陳' })
    expect(listStateQuery(state({ tab: 'all', due: true }))).toEqual({ group: 'all', due: '1' })
    expect(listStateQuery(state({ tab: 'past', attendanceOnly: true, campus: 'yihua' }))).toEqual({ group: 'past', status: 'confirmed', campus: 'yihua' })
    expect(listStateQuery(state({ order: 'oldest', page: 2 }))).toEqual({ group: 'upcoming', order: 'oldest', page: '2' })
  })

  it('讀回自己寫的網址得到同一個狀態', () => {
    for (const s of [state(), state({ q: '陳' }), state({ tab: 'all', due: true }), state({ tab: 'cancelled', page: 2 }), state({ tab: 'past', attendanceOnly: true })]) {
      expect(parseListQuery(listStateQuery(s), scope)).toEqual(s)
    }
  })
})

describe('API 參數', () => {
  it('頁籤送 view、全部不送；只看尚未確認到場加 status=confirmed；件數不帶頁籤與狀態', () => {
    expect(listApiParams(state()).get('view')).toBe('upcoming')
    expect(listApiParams(state({ tab: 'all' })).has('view')).toBe(false)
    const attendance = listApiParams(state({ tab: 'past', attendanceOnly: true, campus: 'yihua', due: true }))
    expect(attendance.toString()).toBe('campus_key=yihua&view=past&status=confirmed&follow_up_due=true')
    expect(listApiParams(state({ tab: 'past', attendanceOnly: true }), { counts: true }).toString()).toBe('')
  })

  it('排序：接下來由近到遠、其他頁籤往回；選了送出時間就照送出時間', () => {
    expect(listApiOrder(state())).toBe('visit_asc')
    expect(listApiOrder(state({ tab: 'past' }))).toBe('visit_desc')
    expect(listApiOrder(state({ tab: 'all' }))).toBe('visit_desc')
    expect(listApiOrder(state({ order: 'oldest' }))).toBe('oldest')
  })

  it('搜尋字像電話就去掉符號與國碼（規則同改版前）', () => {
    expect(searchTerm('0912-345-678')).toBe('0912345678')
    expect(searchTerm('+886 912 345 678')).toBe('0912345678')
    expect(searchTerm('09')).toBe('09')
    expect(searchTerm('陳媽媽')).toBe('陳媽媽')
  })
})
```

- [ ] **Step 2：跑測試確認失敗**

Run: `npx vitest run src/__tests__/visitListQuery.test.ts` → FAIL（找不到模組）

- [ ] **Step 3：實作 `api/visitListQuery.ts`**

```ts
// 參觀案件列表的網址與 API 條件（2026-10-06 方向 B）。網址的鍵沿用 group（舊連結：總覽、成效統計、
// 招生看板、書籤），值改成接待頁籤；API 用 view（後端 status_groups.view_condition）。
// 規則：完全沒有參數＝接下來；有其他參數卻沒有（或不認得的）group＝改版前的連結，當時沒有 group
// 就是「全部」，舊的 ?status= 照狀態對到頁籤。寫回網址時只有「接下來＋沒有其他條件」省略 group。
import type { LocationQuery } from 'vue-router'
import { VISIT_SOURCE_LABELS, VISIT_VIEWS, VISIT_VIEW_LABELS, legacyStatusView, type VisitView } from './labels'

export type ListTab = VisitView | 'all'
export const LIST_TABS: readonly ListTab[] = [...VISIT_VIEWS, 'all']
export const LIST_TAB_LABELS: Record<ListTab, string> = { ...VISIT_VIEW_LABELS, all: '全部' }
export const DEFAULT_TAB: ListTab = 'upcoming'

/** visit＝依頁籤的參觀時間（預設，網址不寫）；newest／oldest＝送出時間（舊的排序，網址寫 order=）。 */
export type ListOrder = 'visit' | 'newest' | 'oldest'
export type ApiOrder = 'newest' | 'oldest' | 'visit_asc' | 'visit_desc'

export interface ListState {
  tab: ListTab
  /** 時間已過裡還沒標記到場的（網址 group=past&status=confirmed，總覽與統計的連結） */
  attendanceOnly: boolean
  q: string
  campus: string
  open: boolean
  source: string
  created: [string, string] | null
  due: boolean
  attention: boolean
  order: ListOrder
  page: number
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const text = (value: unknown): string => (typeof value === 'string' ? value : '')

export function tabFromQuery(query: LocationQuery): ListTab {
  const group = text(query.group)
  if ((LIST_TABS as readonly string[]).includes(group)) return group as ListTab
  if (!group && Object.keys(query).length === 0) return DEFAULT_TAB
  return legacyStatusView(text(query.status)) || 'all'
}

export function parseListQuery(query: LocationQuery, scope: { campusKeys: readonly string[]; multiCampus: boolean }): ListState {
  const tab = tabFromQuery(query)
  const campus = text(query.campus)
  const source = text(query.source)
  const from = text(query.created_from)
  const to = text(query.created_to)
  const order = text(query.order)
  const page = Number(text(query.page))
  return {
    tab,
    attendanceOnly: tab === 'past' && query.status === 'confirmed',
    q: text(query.q),
    // 只負責一校的帳號沒有校區篩選（看得到的就是那一校）。
    campus: scope.multiCampus && scope.campusKeys.includes(campus) ? campus : '',
    open: query.open === '1',
    source: VISIT_SOURCE_LABELS[source] ? source : '',
    created: DATE_RE.test(from) && DATE_RE.test(to) ? [from, to] : null,
    due: query.due === '1',
    attention: query.attention === '1',
    order: order === 'newest' || order === 'oldest' ? order : 'visit',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  }
}

export function listStateQuery(s: ListState): Record<string, string> {
  const query: Record<string, string> = {}
  if (s.attendanceOnly) query.status = 'confirmed'
  if (s.q.trim()) query.q = s.q.trim()
  if (s.campus) query.campus = s.campus
  if (s.open) query.open = '1'
  if (s.source) query.source = s.source
  if (s.created) {
    query.created_from = s.created[0]
    query.created_to = s.created[1]
  }
  if (s.due) query.due = '1'
  if (s.attention) query.attention = '1'
  if (s.order !== 'visit') query.order = s.order
  if (s.page > 1) query.page = String(s.page)
  if (s.tab !== DEFAULT_TAB || Object.keys(query).length > 0) query.group = s.tab
  return query
}

// …原樣從 VisitRequestsView 搬來的 searchTerm（181–194 的註解與函式），改成吃參數：
//   export function searchTerm(raw: string): string { const text = raw.trim(); … }

/** 清單、匯出與件數送同一組篩選：畫面上篩好什麼，匯出的就是那一批。counts：頁籤上的數字，不帶頁籤與狀態。 */
export function listApiParams(s: ListState, options: { counts?: boolean } = {}): URLSearchParams {
  const params = new URLSearchParams()
  if (s.campus) params.set('campus_key', s.campus)
  if (!options.counts) {
    if (s.tab !== 'all') params.set('view', s.tab)
    if (s.attendanceOnly) params.set('status', 'confirmed')
  }
  const term = searchTerm(s.q)
  if (term) params.set('q', term)
  if (s.due) params.set('follow_up_due', 'true')
  if (s.open) params.set('open', 'true')
  if (s.source) params.set('source', s.source)
  if (s.created) {
    params.set('created_from', s.created[0])
    params.set('created_to', s.created[1])
  }
  if (s.attention) params.set('needs_attention', 'true')
  return params
}

/** 行程清單依參觀時間：接下來由近到遠，其他頁籤由近往回；選了送出時間就照送出時間。 */
export function listApiOrder(s: Pick<ListState, 'tab' | 'order'>): ApiOrder {
  if (s.order !== 'visit') return s.order
  return s.tab === 'upcoming' ? 'visit_asc' : 'visit_desc'
}

/** 依參觀時間排序時才分日期組；照送出時間排就是一條平鋪的清單。 */
export const groupsByDay = (s: Pick<ListState, 'order'>): boolean => s.order === 'visit'
```

- [ ] **Step 4：跑測試確認通過**

Run: `npx vitest run src/__tests__/visitListQuery.test.ts` → PASS

- [ ] **Step 5：`VisitRequestsView.vue` 改用模組**

script：
- import 改成 `import { campusLabel, contactTimeLabel, formatShortDateTime, formatShortSlotWhen, VISIT_SOURCE_LABELS, visitDisplay, visitSourceLabel } from '../api/labels'` 與 `import { DEFAULT_TAB, LIST_TABS, LIST_TAB_LABELS, listApiOrder, listApiParams, listStateQuery, parseListQuery, type ListOrder, type ListState, type ListTab } from '../api/visitListQuery'`；`import { useRoute, useRouter } from 'vue-router'` 照舊（`LocationQuery` 型別留給 `applyQuery`）。
- `const groupFilter = ref('')` 改 `const activeTab = ref<ListTab>(DEFAULT_TAB)`；`const order = ref<'newest' | 'oldest'>('newest')` 改 `const order = ref<ListOrder>('visit')`。檔內所有 `groupFilter` 改 `activeTab`。
- 刪掉 `DATE_RE`、`queryText`、`searchTerm`（已搬）。
- 加：

```ts
// 目前畫面上的條件，網址、清單、匯出、件數都從這一份算（api/visitListQuery.ts）。
const listState = computed<ListState>(() => ({
  tab: activeTab.value, attendanceOnly: attendanceOnly.value, q: search.value, campus: campusFilter.value,
  open: openOnly.value, source: sourceFilter.value, created: createdRange.value, due: dueOnly.value,
  attention: attentionOnly.value, order: order.value, page: page.value,
}))
```

- `applyQuery` 整個換成：

```ts
function applyQuery(query: LocationQuery) {
  const next = parseListQuery(query, { campusKeys: visibleCampusKeys.value, multiCampus: multiCampus.value })
  activeTab.value = next.tab
  attendanceOnly.value = next.attendanceOnly
  search.value = next.q
  campusFilter.value = next.campus
  dueOnly.value = next.due
  openOnly.value = next.open
  sourceFilter.value = next.source
  if (next.created?.join() !== createdRange.value?.join()) createdRange.value = next.created
  attentionOnly.value = next.attention
  order.value = next.order
  page.value = next.page
}
```

- `stateQuery()` 換成 `const stateQuery = (): Record<string, string> => listStateQuery(listState.value)`。
- `filterParams(options)` 換成 `const filterParams = (options: { counts?: boolean } = {}) => listApiParams(listState.value, options)`。
- `hasFilters` 拿掉 `groupFilter.value ||`（頁籤是導覽、不是篩選）；`clearFilters` 拿掉 `groupFilter.value = ''`。
- 件數：

```ts
// 頁籤上的數字（GET view-counts，套用頁籤以外的條件）：接下來寫全部件數；時間已過只寫還沒標記到場的，
// 和總覽同一個數字；已到場、已取消、全部不寫（只會一直變大）。
const viewCounts = ref<{ upcoming?: number; past_unmarked?: number }>({})
const statusTabs = computed(() => LIST_TABS.map((value) => ({
  value,
  label: LIST_TAB_LABELS[value],
  count: value === 'upcoming' ? (viewCounts.value.upcoming ?? 0) : value === 'past' ? (viewCounts.value.past_unmarked ?? 0) : 0,
  countLabel: value === 'past' ? ' 件還沒標記到場' : ' 件',
})))

async function loadCounts(version: number) {
  try {
    const counts = await api.get<{ upcoming: number; past_unmarked: number }>(`/admin/visit-requests/view-counts?${filterParams({ counts: true })}`)
    if (version === loadVersion) viewCounts.value = counts
  } catch {
    if (version === loadVersion) viewCounts.value = {}
  }
}
```

（刪掉 `groupCounts`。）
- `load()` 裡 `if (order.value !== 'newest') params.set('order', order.value)` 換成 `params.set('order', listApiOrder(listState.value))`。
- `hiddenFilters` 的排序標籤換成：

```ts
  if (order.value !== 'visit') list.push({ key: 'order', label: order.value === 'oldest' ? '最早送出在前' : '最新送出在前', clear: () => { order.value = 'visit' } })
```

- `watch(groupFilter, …)` 改 `watch(activeTab, (tab) => { if (tab !== 'past') attendanceOnly.value = false })`；`toggleAttendance` 裡 `groupFilter.value = 'past'` 改 `activeTab.value = 'past'`；大 watch 清單的 `groupFilter` 改 `activeTab`。
- `detailTo` 換成：

```ts
// 點進案件時把目前的條件與排序帶過去，案件頁的「下一筆」才會照這份清單往下。只有「全部」而且沒有
// 到期、待人工處理時不帶（那份清單夾著已結案的案件，「下一筆」改用固定的處理優先序）。
function detailTo(id: string) {
  const s = listState.value
  if (s.tab === 'all' && !s.due && !s.attention) return `/visit-requests/${id}`
  const params = filterParams()
  params.set('order', listApiOrder(s))
  if (page.value > 1) {
    params.set('page', String(page.value))
    params.set('page_size', String(pageSize))
  }
  return { path: `/visit-requests/${id}`, query: { list: params.toString() } }
}
```

- `listTitle`、`emptyText` 換成：

```ts
const listTitle = computed(() => {
  if (attendanceOnly.value) return '尚未確認到場'
  if (dueOnly.value) return '到期待追蹤'
  if (attentionOnly.value) return '待人工處理'
  return activeTab.value === 'all' ? '全部案件' : LIST_TAB_LABELS[activeTab.value]
})

const emptyText = computed(() => {
  if (page.value > 1) return '後面沒有更多案件了'
  if (search.value.trim()) return `找不到符合「${search.value.trim()}」的案件`
  if (attentionOnly.value) return '沒有待人工處理的案件'
  if (attendanceOnly.value) return '沒有尚未確認到場的案件'
  if (dueOnly.value) return '沒有到期待追蹤的案件'
  if (activeTab.value === 'upcoming') return '接下來沒有參觀'
  if (activeTab.value !== 'all') return `沒有「${LIST_TAB_LABELS[activeTab.value]}」的案件`
  return '還沒有任何參觀案件'
})
```

template：
- 頁籤換成：

```html
    <div class="status-tabs" role="group" aria-label="案件狀態">
      <button v-for="item in statusTabs" :key="item.value" type="button" class="status-tab" :class="{ 'is-active': activeTab === item.value }" :data-group="item.value"
        :aria-pressed="activeTab === item.value" @click="activeTab = item.value">
        {{ item.label }}<span v-if="item.count" class="status-tab__count num">{{ item.count }}<span class="visually-hidden">{{ item.countLabel }}</span></span>
      </button>
    </div>
```

- 排序選單換成：

```html
        <el-select v-model="order" aria-label="排序" class="order-select">
          <el-option label="參觀時間" value="visit" />
          <el-option label="最新送出在前" value="newest" />
          <el-option label="最早送出在前" value="oldest" />
        </el-select>
```

- [ ] **Step 6：明細的 `LIST_KEYS` 與返回連結**

`VisitDetailView.vue`：`const LIST_KEYS = [...]` 加 `'view'`（放在 `'group'` 後面）。返回連結：

```ts
import { VISIT_VIEW_LABELS, type VisitView } from '../api/labels'
// 從列表來時寫出是哪個頁籤（2026-10-06 方向 B：「‹ 參觀案件（接下來）」）。
const listTabLabel = computed(() => {
  const raw = route.query.list
  if (origin.value !== 'visit-list' || typeof raw !== 'string') return ''
  const view = new URLSearchParams(raw).get('view')
  return view && view in VISIT_VIEW_LABELS ? VISIT_VIEW_LABELS[view as VisitView] : ''
})
const backLabel = computed(() => (origin.value === 'admissions' ? '招生入學' : listTabLabel.value ? `參觀案件（${listTabLabel.value}）` : '參觀案件'))
```

（取代原本的 `backLabel`。）

- [ ] **Step 7：總覽連結、labels 清理**

`DashboardView.vue` 搜尋 `to="/visit-requests?group=upcoming&order=oldest"`（兩處）改 `to="/visit-requests?group=upcoming"`。`labels.ts` 刪掉 `LEGACY_STATUS_GROUP` 與 `legacyStatusGroup`（`grep -rn legacyStatusGroup admin/src` 確認只剩測試）；`VISIT_GROUPS`、`VISIT_GROUP_LABELS` 留著（操作紀錄的 `group` 標籤還在用）。

- [ ] **Step 8：改既有測試**

通則：API 呼叫裡的 `group=` 換 `view=`（「全部」頁籤沒有 `view`）；`/admin/visit-requests/group-counts` 的 mock 換 `/admin/visit-requests/view-counts`，回 `{ upcoming: N, past_unmarked: M }`；`.status-tab` 的順序是接下來、時間已過、已到場、已取消、全部；舊連結落到「全部」時用 `.status-tab[data-group="all"]` 檢查 `aria-pressed`；網址物件在非預設頁籤時多 `group`。逐檔：
- `listUx.test.ts`：頁籤文字（去空白）期望改 `['接下來3件', '時間已過2件還沒標記到場', '已到場', '已取消', '全部']`（mock 回 `{ upcoming: 3, past_unmarked: 2 }`）；點 `tab[1]` 後最後一次清單呼叫含 `view=past`、`aria-pressed='true'`；件數呼叫不帶 `view=`、帶校區時跟著帶 `campus_key=`。
- `visitGroups.test.ts`：刪 `legacyStatusGroup` 的 it（`legacyStatusView` 已在 Task 6 加）；`?status=contacting` 的 it 改成 `.status-tab` 有五個、`[data-group="all"]` 被按下、清單呼叫沒有 `view=` 也沒有 `status=`。
- `openRequestsUx.test.ts`（:110-134）：`?status=confirmed&order=oldest` → 清單呼叫含 `view=upcoming` 與 `order=oldest`；`?group=pending`、`?status=new|contacting|pending_confirmation` → 沒有 `view=`、`status=`，`[data-group="all"]` 被按下。
- `receptionUx20261002.test.ts`（:209-226）：清單呼叫含 `view=past` 與 `status=confirmed`；件數呼叫（`view-counts`）不含 `status=`。
- `attentionExportDeadline.test.ts`（:85-101）：匯出參數的期望集合把 `group` 換 `view`（若那個 it 是「全部」頁籤就整個拿掉 `group`）。
- `adminUx.test.ts`：件數 mock 換 `view-counts`；其餘不變。
- `ux20260928B1.test.ts`：清單呼叫的 `group=` 換 `view=`，每個呼叫都多 `order=`（`visit_asc`／`visit_desc`／`newest`／`oldest`）；網址物件 `{ due: '1', q: '陳' }` 改 `{ group: 'all', due: '1', q: '陳' }`，其他非預設頁籤同理加 `group`；`{ group: 'upcoming', order: 'oldest', page: '2' }` 不變。
- `ux20261005.test.ts`：`.status-tab[data-group]` 期望改 `['upcoming', 'past', 'arrived', 'cancelled', 'all']`；「最早送出在前」標籤照舊。
- `uxRound6.test.ts`（:105-118）：連結 `list=` 期望從 `group=upcoming&order=oldest` 改 `view=upcoming&order=oldest`；「全部」且沒篩選時 href 恰為 `/visit-requests/case-a` 照舊。
- `shellDashboard20261002.test.ts`（:106）：期望改 `'/visit-requests?group=upcoming'`。
- `familyEntryPoints.test.ts`：複製既有「從案件列表來」那個 it，路由加 `?list=view%3Dupcoming`，斷言 `.detail__back` 文字是「參觀案件（接下來）」；原本的 it 不帶 `list` 仍是「參觀案件」。

- [ ] **Step 9：跑測試**

```bash
for f in visitListQuery listUx visitGroups openRequestsUx receptionUx20261002 attentionExportDeadline adminUx ux20260928B1 ux20261005 uxRound6 uxRound8Cases shellDashboard20261002 dashboardBoard20261006 followUpUx familyEntryPoints selfBookingDetail permissionsUx visitRequestsBatch arrivalAdmissionsForm admissionsFunnel analyticsHelpers analyticsOutcomes; do npx vitest run src/__tests__/$f.test.ts || break; done
```

Expected：全 PASS（`admissionsFunnel`、`analyticsHelpers`、`analyticsOutcomes` 斷言的 `group=past&status=confirmed` 連結不變）。

- [ ] **Step 10：Commit**

```bash
git add admin/src/api/visitListQuery.ts admin/src/api/labels.ts admin/src/views/VisitRequestsView.vue admin/src/views/VisitDetailView.vue admin/src/views/DashboardView.vue admin/src/__tests__/visitListQuery.test.ts admin/src/__tests__/listUx.test.ts admin/src/__tests__/visitGroups.test.ts admin/src/__tests__/openRequestsUx.test.ts admin/src/__tests__/receptionUx20261002.test.ts admin/src/__tests__/attentionExportDeadline.test.ts admin/src/__tests__/adminUx.test.ts admin/src/__tests__/ux20260928B1.test.ts admin/src/__tests__/ux20261005.test.ts admin/src/__tests__/uxRound6.test.ts admin/src/__tests__/shellDashboard20261002.test.ts admin/src/__tests__/familyEntryPoints.test.ts
git commit -F - <<'MSG'
feat(admin): 參觀案件頁籤改成接下來／時間已過／已到場／已取消／全部，依參觀時間排序

網址仍用 group，舊連結（總覽、成效統計、招生看板、書籤）照對照表落到對的頁籤。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

## Task 8：行程清單：依參觀日分組、`VisitListRow`、列內快速動作、換日重讀

**Files:**
- Modify: `admin/src/utils/visitSchedule.ts`（日期分組、接待狀態、下一筆）
- Create: `admin/src/components/visit/VisitListRow.vue`
- Create: `admin/src/__tests__/visitScheduleList.test.ts`
- Modify: `admin/src/__tests__/visitSchedule.test.ts`（加分組、狀態、下一筆）
- Modify: `admin/src/views/VisitRequestsView.vue`（el-table 與手機卡片換成分組清單；批次勾選；填招生資料；換日重讀）
- Modify tests: `visitRequestsBatch.test.ts`（重寫勾選）、`ux20260928B1.test.ts`、`ux20261005.test.ts`、`arrivalAdmissionsForm.test.ts`、`uxRound6.test.ts`、`openRequestsUx.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `taipeiDay`、`daysBetween`、`slotStart`、`slotEnd`、`SlotTime`；Task 7 的 `listState`、`activeTab`、`detailTo`、`groupsByDay`；`composables/visitAttendance.ts` 的 `attendanceDue`、`AttendanceKind`；`useArrivalAdmissionsForm().openFor(row)`、`.opensForm`
- Produces（`utils/visitSchedule.ts` 新增）：
  - `addDays(day: string, days: number): string`、`weekStart(day: string): string`（週一）
  - `type DayBucket = 'today' | 'tomorrow' | 'yesterday' | 'this_week' | 'earlier_this_week' | 'later' | 'earlier' | 'none'`、`dayBucket(slotDate: string | null | undefined, today: string): DayBucket`
  - `interface DayGroup<T> { key: string; bucket: DayBucket; label: string; rows: T[] }`、`groupVisitsByDay<T extends { slot?: { slot_date: string } | null }>(rows: readonly T[], today: string): DayGroup<T>[]`
  - `type VisitPhase = 'upcoming' | 'ongoing' | 'ended' | 'done' | 'no_show' | 'cancelled'`、`visitPhase(row: { status: string; slot?: SlotTime | null }, now: number): VisitPhase`、`VISIT_PHASE_LABELS: Record<VisitPhase, string>`
  - `nextInList(ids: readonly string[], current: string | null, lastIndex: number): string | null`
- Produces（元件）：`VisitListRow.vue` props `{ row; now; to; dayOnly; showCreated; multiCampus; selected; previewable; canHandle; canFillAdmissions; batch; checked; busy; locked }`、emits `{ activate: []; attendance: [kind: AttendanceKind]; fill: []; toggle: [on: boolean] }`；根元素 `li.visit-row[data-phase]`（`.is-selected`、`.has-check`）；主連結 `a.visit-row__main`
- `VisitRequestsView` 內部（Task 9 用）：`requests`、`dayGroups`、`clockNow`、`openDetail(row)`、清單外層 `div.visit-list`

- [ ] **Step 1：`visitSchedule` 加失敗的測試**

`admin/src/__tests__/visitSchedule.test.ts` 檔尾加（import 補 `dayBucket, groupVisitsByDay, nextInList, visitPhase, weekStart`）：

```ts
describe('日期分組（台北、週一開始）', () => {
  const tue = '2026-10-06'
  it.each([
    ['2026-10-06', 'today'], ['2026-10-07', 'tomorrow'], ['2026-10-05', 'yesterday'],
    ['2026-10-08', 'this_week'], ['2026-10-11', 'this_week'], ['2026-10-12', 'later'],
    ['2026-10-04', 'earlier'], [null, 'none'],
  ])('今天週二，%s → %s', (day, bucket) => {
    expect(dayBucket(day, tue)).toBe(bucket)
  })
  it('今天週日：明天週一是下週，但仍叫「明天」；週二是之後；週二到週五是本週稍早', () => {
    expect(weekStart('2026-10-11')).toBe('2026-10-05')
    expect(dayBucket('2026-10-12', '2026-10-11')).toBe('tomorrow')
    expect(dayBucket('2026-10-13', '2026-10-11')).toBe('later')
    expect(dayBucket('2026-10-07', '2026-10-11')).toBe('earlier_this_week')
  })
  it('照清單順序切連續的組，今天／明天／昨天帶日期', () => {
    const row = (slot_date: string | null) => ({ id: String(slot_date), slot: slot_date ? { slot_date } : null })
    const groups = groupVisitsByDay([row('2026-10-06'), row('2026-10-06'), row('2026-10-07'), row('2026-10-09'), row('2026-10-13'), row(null)], tue)
    expect(groups.map((g) => [g.label, g.rows.length])).toEqual([
      ['今天 10/06（週二）', 2], ['明天 10/07（週三）', 1], ['本週', 1], ['之後', 1], ['沒有場次', 1],
    ])
    expect(groupVisitsByDay([row('2026-10-05'), row('2026-10-01')], tue).map((g) => g.label)).toEqual(['昨天 10/05（週一）', '更早'])
  })
})

describe('列的接待狀態', () => {
  const slot = { slot_date: '2026-10-06', start_time: '10:00:00', end_time: '11:00:00' }
  const at = (local: string) => Date.parse(`${local}+08:00`)
  it.each([
    ['confirmed', '2026-10-06T09:00:00', 'upcoming'],
    ['confirmed', '2026-10-06T10:30:00', 'ongoing'],
    ['confirmed', '2026-10-06T11:30:00', 'ended'],
    ['completed', '2026-10-06T10:30:00', 'done'],
    ['no_show', '2026-10-06T12:00:00', 'no_show'],
    ['cancelled', '2026-10-06T09:00:00', 'cancelled'],
  ])('%s @ %s → %s', (status, local, phase) => {
    expect(visitPhase({ status, slot }, at(local))).toBe(phase)
  })
})

describe('預覽面板的下一筆', () => {
  it('清單裡的下一筆；最後一筆沒有下一筆', () => {
    expect(nextInList(['a', 'b', 'c'], 'a', 0)).toBe('b')
    expect(nextInList(['a', 'b', 'c'], 'c', 2)).toBeNull()
  })
  it('目前這筆離開清單（例如剛取消）：接手它位置的那筆就是下一筆', () => {
    expect(nextInList(['a', 'c'], 'b', 1)).toBe('c')
    expect(nextInList(['a'], 'b', 1)).toBe('a')
    expect(nextInList([], 'b', 0)).toBeNull()
  })
})
```

- [ ] **Step 2：跑測試確認失敗**

Run: `npx vitest run src/__tests__/visitSchedule.test.ts` → FAIL（缺新函式）

- [ ] **Step 3：`visitSchedule.ts` 加實作**

檔頭 import 加 `import { formatWeekday } from '../api/labels'`，檔尾加：

```ts
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** 一週從週一開始（週日算這一週的最後一天）。 */
export function weekStart(day: string): string {
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay()
  return addDays(day, -((weekday + 6) % 7))
}

export type DayBucket = 'today' | 'tomorrow' | 'yesterday' | 'this_week' | 'earlier_this_week' | 'later' | 'earlier' | 'none'

/** 行程清單的日期分組（2026-10-06 方向 B）：今天、明天、昨天優先，其餘看是不是這一週。 */
export function dayBucket(slotDate: string | null | undefined, today: string): DayBucket {
  if (!slotDate) return 'none'
  const diff = daysBetween(today, slotDate)
  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'
  if (diff === -1) return 'yesterday'
  const start = weekStart(today)
  if (diff > 1) return slotDate <= addDays(start, 6) ? 'this_week' : 'later'
  return slotDate >= start ? 'earlier_this_week' : 'earlier'
}

const BUCKET_LABELS: Record<DayBucket, string> = {
  today: '今天', tomorrow: '明天', yesterday: '昨天', this_week: '本週', earlier_this_week: '本週稍早',
  later: '之後', earlier: '更早', none: '沒有場次',
}
const DATED: ReadonlySet<DayBucket> = new Set(['today', 'tomorrow', 'yesterday'])
export const shortDay = (day: string): string => `${day.slice(5).replace('-', '/')}（${formatWeekday(day)}）`

export interface DayGroup<T> { key: string; bucket: DayBucket; label: string; rows: T[] }

/** 已經依參觀時間排好的一頁切成連續的日期分組；同一組在清單裡相鄰，所以照清單順序走、不重排。 */
export function groupVisitsByDay<T extends { slot?: { slot_date: string } | null }>(rows: readonly T[], today: string): DayGroup<T>[] {
  const groups: DayGroup<T>[] = []
  for (const row of rows) {
    const day = row.slot?.slot_date ?? null
    const bucket = dayBucket(day, today)
    const last = groups[groups.length - 1]
    if (last && last.bucket === bucket) {
      last.rows.push(row)
      continue
    }
    const label = DATED.has(bucket) && day ? `${BUCKET_LABELS[bucket]} ${shortDay(day)}` : BUCKET_LABELS[bucket]
    groups.push({ key: `${bucket}-${groups.length}`, bucket, label, rows: [row] })
  }
  return groups
}

export type VisitPhase = 'upcoming' | 'ongoing' | 'ended' | 'done' | 'no_show' | 'cancelled'

/** 列上的接待狀態（同總覽「今天的參觀」：還沒標記、進行中、已到場、未到場）。 */
export function visitPhase(row: { status: string; slot?: SlotTime | null }, now: number): VisitPhase {
  if (row.status === 'cancelled') return 'cancelled'
  if (row.status === 'completed') return 'done'
  if (row.status === 'no_show') return 'no_show'
  if (!row.slot || now < slotStart(row.slot)) return 'upcoming'
  return now < slotEnd(row.slot) ? 'ongoing' : 'ended'
}

export const VISIT_PHASE_LABELS: Record<VisitPhase, string> = {
  upcoming: '', ongoing: '進行中', ended: '還沒標記', done: '已到場', no_show: '未到場', cancelled: '已取消',
}

/** 預覽面板的「下一筆」：清單裡的下一筆；目前這筆已離開清單（例如剛取消）就由接手它位置的那筆遞補（同明細「下一筆」）。 */
export function nextInList(ids: readonly string[], current: string | null, lastIndex: number): string | null {
  const index = current ? ids.indexOf(current) : -1
  if (index >= 0) return ids[index + 1] ?? null
  if (!ids.length) return null
  return ids[Math.min(Math.max(lastIndex, 0), ids.length - 1)] ?? null
}
```

- [ ] **Step 4：跑測試確認通過**

Run: `npx vitest run src/__tests__/visitSchedule.test.ts` → PASS

- [ ] **Step 5：寫列表的失敗測試**

`admin/src/__tests__/visitScheduleList.test.ts`：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import RecordDialog from '../components/admissions/RecordDialog.vue'
import { button, cleanup, mockGet, pathsTo, visit as admissionsVisit } from './admissionsTestKit'
import { mountRoutes } from './visitCaseKit'

afterEach(() => { cleanup(); window.sessionStorage.clear() })

function row(slot_date: string, start: string, extra: Record<string, unknown> = {}) {
  const hour = start.slice(0, 2)
  return {
    id: `${slot_date}-${hour}`, campus_key: 'yihua', status: 'confirmed', display_status: 'upcoming', source: 'web',
    parent_name: `家長${slot_date.slice(8)}-${hour}`, child_name: '小安', phone: '0912000001', email: null,
    follow_up_at: null, preferred_time: null, created_at: '2026-10-01T00:00:00Z', cancel_reason: null, cancelled_at: null,
    slot_id: `s-${slot_date}-${hour}`, slot: { slot_date, start_time: `${start}:00`, end_time: `${String(Number(hour) + 1).padStart(2, '0')}:00:00` },
    ...extra,
  }
}
const titles = (wrapper: { findAll: (s: string) => { element: Element }[] }) =>
  wrapper.findAll('.visit-day__title').map((h) => h.element.firstChild?.textContent?.trim())

async function mountList(path: string, rows: unknown[], options: { admissions?: boolean } = {}, extra: Record<string, unknown> = {}) {
  const get = mockGet({ '/admin/visit-requests': rows, '/admin/visit-requests/view-counts': { upcoming: rows.length, past_unmarked: 0 }, ...extra })
  const { wrapper, router } = await mountRoutes(path, { list: VisitRequestsView }, options)
  return { wrapper, router, get }
}

describe('行程清單（2026-10-06 方向 B）', () => {
  it('依參觀日分組：今天置頂、明天、本週、之後；今天的列只寫幾點與狀態', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-06T02:30:00Z')) // 台北週二 10:30
    const rows = [row('2026-10-06', '10:00'), row('2026-10-06', '14:00'), row('2026-10-07', '10:00'), row('2026-10-09', '14:00'), row('2026-10-13', '10:00')]
    const { wrapper } = await mountList('/visit-requests', rows)
    expect(titles(wrapper)).toEqual(['今天 10/06（週二）', '明天 10/07（週三）', '本週', '之後'])
    const first = wrapper.findAll('.visit-row')[0]!
    expect(first.get('.visit-row__time b').text()).toBe('10:00')
    expect(first.get('.visit-row__state').text()).toBe('進行中')
    expect(first.findAll('.attendance-actions button').map((b) => b.text())).toEqual(['到了', '沒來'])
    const thisWeek = wrapper.findAll('.visit-row')[3]!
    expect(thisWeek.get('.visit-row__time').text()).toContain('10/09（週五）')
    expect(thisWeek.get('.visit-row__time').text()).toContain('14:00–15:00')
    expect(thisWeek.find('.attendance-actions').exists()).toBe(false)
  })

  it('列表開著過台北午夜：重讀一次，「明天」變成「今天」', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-10-06T15:59:00Z')) // 台北 23:59
    const { wrapper, get } = await mountList('/visit-requests', [row('2026-10-07', '10:00')])
    expect(titles(wrapper)).toEqual(['明天 10/07（週三）'])
    const before = pathsTo(get, '/admin/visit-requests?').length
    vi.setSystemTime(new Date('2026-10-06T16:01:00Z')) // 台北 10/07 00:01
    vi.advanceTimersByTime(30_000)
    await flushPromises()
    expect(pathsTo(get, '/admin/visit-requests?').length).toBe(before + 1)
    expect(titles(wrapper)).toEqual(['今天 10/07（週三）'])
  })

  it('已到場的列有「填招生資料」，打開招生資料表單', async () => {
    const arrived = row('2026-01-05', '10:00', { status: 'completed', display_status: 'past' })
    const record = admissionsVisit({ visit_request_id: arrived.id, has_visit_request: true })
    const { wrapper } = await mountList('/visit-requests?group=arrived', [arrived], { admissions: true }, { '/admin/admissions/records': [record] })
    await button(wrapper.get('.visit-row'), '填招生資料')!.trigger('click')
    await flushPromises()
    expect(wrapper.findComponent(RecordDialog).props('modelValue')).toBe(true)
  })

  it('照送出時間排序時不分組，每列寫送出時間', async () => {
    const { wrapper } = await mountList('/visit-requests?group=all&order=oldest', [row('2026-10-07', '10:00')])
    expect(wrapper.find('.visit-day__title').exists()).toBe(false)
    expect(wrapper.get('.visit-row').text()).toContain('送出')
  })

  it('只看尚未確認到場：每列有勾選框，全選這一頁後一次標記', async () => {
    const rows = [row('2026-01-05', '10:00', { display_status: 'past' }), row('2026-01-05', '14:00', { display_status: 'past' })]
    const { wrapper } = await mountList('/visit-requests?group=past&status=confirmed', rows)
    expect(wrapper.findAll('.visit-row .visit-row__check .el-checkbox')).toHaveLength(2)
    await wrapper.get('.requests-batch .el-checkbox').trigger('click')
    await flushPromises()
    expect(button(wrapper.get('.requests-batch'), '2 位標記已到場')).toBeDefined()
  })

  it('1280 以下點列進明細（帶著列表條件）', async () => {
    const { wrapper, router } = await mountList('/visit-requests', [row('2099-10-07', '10:00')])
    await wrapper.get('a.visit-row__main').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/visit-requests/2099-10-07-10')
    expect(String(router.currentRoute.value.query.list)).toContain('view=upcoming')
  })
})
```

- [ ] **Step 6：跑測試確認失敗**

Run: `npx vitest run src/__tests__/visitScheduleList.test.ts` → FAIL（沒有 `.visit-day__title`）

- [ ] **Step 7：實作 `VisitListRow.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import type { VisitRequestDetailOut } from '../../api/types'
import { campusLabel, contactTimeLabel, formatShortDateTime, formatTime, visitDisplay, visitSourceLabel } from '../../api/labels'
import { attendanceDue, type AttendanceKind } from '../../composables/visitAttendance'
import { shortDay, VISIT_PHASE_LABELS, visitPhase } from '../../utils/visitSchedule'

// 行程清單的一列（2026-10-06 方向 B）：時間＋接待狀態、家長・孩子、校區、電話、快速動作。
// 「到了／沒來」「填招生資料」與電話不包在連結裡（第九輪）；點列的空白處等同點家長名字。
// previewable（1280 以上）：沒按修飾鍵的左鍵點擊開右側預覽，⌘／Ctrl／中鍵照常開新分頁。
const props = defineProps<{
  row: VisitRequestDetailOut
  now: number
  to: RouteLocationRaw
  /** 今天／明天／昨天分組：時間欄只寫幾點 */
  dayOnly: boolean
  /** 照送出時間排（不分日期組）：寫「09/28 21:41 送出」 */
  showCreated: boolean
  multiCampus: boolean
  selected: boolean
  previewable: boolean
  canHandle: boolean
  canFillAdmissions: boolean
  batch: boolean
  checked: boolean
  busy: boolean
  locked: boolean
}>()
const emit = defineEmits<{ activate: []; attendance: [kind: AttendanceKind]; fill: []; toggle: [on: boolean] }>()

const phase = computed(() => visitPhase(props.row, props.now))
const stateLabel = computed(() => (phase.value === 'cancelled' ? visitDisplay(props.row).sub || '已取消' : VISIT_PHASE_LABELS[phase.value]))
const showAttendance = computed(() => props.canHandle && attendanceDue(props.row, props.now))
const showFill = computed(() => props.canFillAdmissions && props.row.status === 'completed')
const manualSource = computed(() => (props.row.source && props.row.source !== 'web' ? `${visitSourceLabel(props.row.source)}補登` : ''))
const followUpDue = computed(() => {
  const at = props.row.follow_up_at
  if (!at || props.row.status === 'cancelled' || props.row.status === 'completed') return false
  return Date.parse(at) <= props.now
})
const timeMain = computed(() => {
  const slot = props.row.slot
  if (!slot) return '沒有場次'
  return props.dayOnly ? formatTime(slot.start_time) : shortDay(slot.slot_date)
})
const timeSub = computed(() => {
  const slot = props.row.slot
  return slot && !props.dayOnly ? `${formatTime(slot.start_time)}–${formatTime(slot.end_time)}` : ''
})

function onLinkClick(event: MouseEvent, navigate: (e?: MouseEvent) => unknown) {
  if (props.previewable && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
    event.preventDefault()
    emit('activate')
    return
  }
  void navigate(event)
}

function onRowClick(event: MouseEvent) {
  if ((event.target as HTMLElement).closest('a, button, input, label, .el-checkbox')) return
  emit('activate')
}
</script>

<template>
  <li class="visit-row" :class="{ 'is-selected': selected, 'has-check': batch }" :data-phase="phase" @click="onRowClick">
    <span v-if="batch" class="visit-row__check">
      <el-checkbox
        v-if="showAttendance"
        :model-value="checked"
        :disabled="locked"
        :aria-label="`勾選 ${row.parent_name}`"
        @update:model-value="(on: string | number | boolean) => emit('toggle', Boolean(on))"
      />
    </span>
    <router-link v-slot="{ href, navigate }" :to="to" custom>
      <a :href="href" class="visit-row__main" :aria-current="selected ? 'true' : undefined" @click="onLinkClick($event, navigate)">
        <span class="visit-row__time">
          <b class="num">{{ timeMain }}</b>
          <small v-if="timeSub" class="num">{{ timeSub }}</small>
          <small v-if="stateLabel" class="visit-row__state" :data-phase="phase">{{ stateLabel }}</small>
        </span>
        <span class="visit-row__who">
          <span class="visit-row__name"><b>{{ row.parent_name }}</b><span class="visit-row__child">・{{ row.child_name || '孩子姓名未填寫' }}</span></span>
          <span v-if="multiCampus || manualSource" class="visit-row__meta">
            <span v-if="multiCampus" class="visit-row__campus-inline">{{ campusLabel(row.campus_key) }}校{{ manualSource ? ' · ' : '' }}</span>{{ manualSource }}
          </span>
          <span v-if="row.follow_up_at" class="visit-row__follow num" :class="{ 'is-due': followUpDue }">{{ followUpDue ? '到期待追蹤' : '預定聯絡' }} {{ formatShortDateTime(row.follow_up_at) }}</span>
          <span v-if="row.preferred_time" class="visit-row__meta">方便接電話時段：{{ contactTimeLabel(row.preferred_time) }}</span>
          <span v-if="showCreated" class="visit-row__meta num">{{ formatShortDateTime(row.created_at) }} 送出</span>
        </span>
      </a>
    </router-link>
    <span v-if="multiCampus" class="visit-row__campus">{{ campusLabel(row.campus_key) }}</span>
    <a class="visit-row__phone num" :href="`tel:${row.phone}`">{{ row.phone }}</a>
    <span class="visit-row__acts">
      <span v-if="showAttendance" class="attendance-actions" role="group" :aria-label="`${row.parent_name} 到了嗎？`">
        <el-button size="small" type="primary" plain :loading="busy" :disabled="locked" :aria-label="`標記 ${row.parent_name} 已到場`" @click="emit('attendance', 'complete')">到了</el-button>
        <el-button size="small" :disabled="locked" :aria-label="`標記 ${row.parent_name} 未到場`" @click="emit('attendance', 'no_show')">沒來</el-button>
      </span>
      <el-button v-else-if="showFill" size="small" link type="primary" :aria-label="`填招生資料：${row.parent_name}`" @click="emit('fill')">填招生資料</el-button>
    </span>
  </li>
</template>

<style scoped>
.visit-row {
  display: flex;
  align-items: center;
  gap: 12px 16px;
  padding: 12px 18px;
  cursor: pointer;
}

.visit-row + .visit-row {
  border-top: 1px solid var(--line);
}

.visit-row:hover {
  background: var(--surface-2);
}

.visit-row.is-selected {
  background: var(--el-color-primary-light-9);
}

.visit-row__check {
  flex: none;
  width: 28px;
}

.visit-row__main {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 12px;
  min-width: 0;
  color: inherit;
  text-decoration: none;
}

.visit-row__main:focus-visible {
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
  border-radius: 4px;
}

.visit-row__time {
  display: grid;
  align-content: start;
  gap: 2px;
}

.visit-row__time b {
  font-weight: 700;
}

.visit-row__time small,
.visit-row__meta {
  font-size: var(--text-xs);
  color: var(--ink-3);
}

.visit-row__state[data-phase='ended'] {
  color: var(--brand-gold-ink);
  font-weight: 600;
}

.visit-row__state[data-phase='ongoing'] {
  color: var(--status-live-ink);
  font-weight: 600;
}

.visit-row__who {
  display: grid;
  align-content: start;
  gap: 2px;
  min-width: 0;
  overflow-wrap: anywhere;
}

.visit-row__name b {
  font-weight: 600;
}

.visit-row__child {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.visit-row__campus-inline {
  display: none;
}

.visit-row__follow {
  font-size: var(--text-xs);
  color: var(--ink-2);
  word-break: keep-all;
}

.visit-row__follow.is-due {
  color: var(--brand-gold-ink);
  font-weight: 600;
}

.visit-row__campus {
  flex: none;
  width: 40px;
  color: var(--ink-2);
}

.visit-row__phone {
  flex: none;
  width: 112px;
  font-variant-numeric: tabular-nums;
}

.visit-row__acts {
  display: flex;
  flex: none;
  justify-content: flex-end;
  min-width: 112px;
}

.attendance-actions {
  display: flex;
  gap: 6px;
}

.attendance-actions .el-button + .el-button {
  margin-left: 0;
}

/* 右側預覽打開、清單變窄時（容器查詢，外層 .visit-list）：校區欄併進家長那一格。 */
@container visit-list (max-width: 640px) {
  .visit-row__campus {
    display: none;
  }

  .visit-row__campus-inline {
    display: inline;
  }
}

/* 手機卡片：時間欄 88px 不折行，電話 44px 好點，到了／沒來各占一半。 */
@media (max-width: 720px) {
  .visit-row {
    flex-wrap: wrap;
    padding: 12px 14px;
  }

  .visit-row__main {
    flex-basis: calc(100% - 40px);
    grid-template-columns: 88px minmax(0, 1fr);
  }

  .visit-row:not(.has-check) .visit-row__main {
    flex-basis: 100%;
  }

  .visit-row__campus {
    display: none;
  }

  .visit-row__campus-inline {
    display: inline;
  }

  .visit-row__phone {
    display: inline-flex;
    align-items: center;
    width: auto;
    min-height: 44px;
    margin-left: 100px;
    text-decoration: underline;
  }

  .visit-row__acts {
    flex-basis: 100%;
    justify-content: stretch;
  }

  .attendance-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    width: 100%;
  }

  .visit-row__acts .el-button {
    min-height: 44px;
  }
}
</style>
```

- [ ] **Step 8：`VisitRequestsView.vue` 換成分組清單**

script：
- import 加 `import VisitListRow from '../components/visit/VisitListRow.vue'`、`import { groupVisitsByDay, taipeiDay, type DayBucket, type DayGroup } from '../utils/visitSchedule'`、`groupsByDay`（visitListQuery）；拿掉表格用的 `contactTimeLabel`、`formatShortSlotWhen`、`visitDisplay`、`visitSourceLabel`、`manualSource`、`followUpDue`（已搬進列）。
- 加：

```ts
// 依參觀時間排序時，這一頁照台北日期切成今天、明天、本週、之後（時間已過等頁籤往回：今天、昨天、本週稍早、更早）。
const grouped = computed(() => groupsByDay(listState.value))
const today = computed(() => taipeiDay(clockNow.value))
const DAY_ONLY: ReadonlySet<DayBucket> = new Set(['today', 'tomorrow', 'yesterday'])
const dayGroups = computed<DayGroup<VisitRequestDetailOut>[]>(() =>
  grouped.value ? groupVisitsByDay(requests.value, today.value) : [{ key: 'flat', bucket: 'none', label: '', rows: requests.value }],
)
// 開著過台北午夜：今天／明天換了，接下來的內容也換了，重讀一次（同總覽的換日重讀）。
watch(today, () => { void load({ quiet: true }) })
```

  （`clockNow` 的宣告要搬到這段之前，它原本在「列表上直接標記到場」那段。）
- 批次勾選：刪 `onSelectionChange`；加

```ts
const selectableRows = computed(() => requests.value.filter(canSelect))
const allSelected = computed(() => selectableRows.value.length > 0 && selectableRows.value.every(isSelected))
const someSelected = computed(() => selected.value.length > 0 && !allSelected.value)
function selectAll(on: boolean) {
  selected.value = on ? [...selectableRows.value] : []
}
```

- `openDetail(row, column?)` 換成：

```ts
function openDetail(row: VisitRequestDetailOut) {
  void router.push(detailTo(row.id))
}
```

template：把 `<div v-if="!error" class="panel" :aria-busy="loading">` 到它的 `</div>`（含 el-table、`requests-mobile`、`pager`）換成：

```html
    <div v-if="!error" class="visit-list" :aria-busy="loading">
      <!-- 頁首已經是「參觀案件」，這裡寫目前看的是哪個頁籤或子篩選，不重複頁名。 -->
      <div class="visit-list__head"><h2>{{ listTitle }}</h2><span class="hint">{{ loading ? '載入中…' : `本頁 ${requests.length} 件` }}</span></div>
      <div v-if="batchMode && requests.length" class="requests-batch">
        <el-checkbox :model-value="allSelected" :indeterminate="someSelected" :disabled="attendanceLocked || !selectableRows.length" @update:model-value="(on: string | number | boolean) => selectAll(Boolean(on))">全選這一頁</el-checkbox>
        <el-button type="primary" plain :disabled="!selected.length || attendanceLocked" :loading="batch !== null" class="requests-batch__button" @click="markSelectedArrived">
          {{ batch ? `標記中 ${batch.done}／${batch.total}` : selected.length ? `${selected.length} 位標記已到場` : '勾選後一次標記已到場' }}
        </el-button>
        <span class="hint">一天的場次結束後，可以把來了的家長一次勾起來標記。</span>
      </div>
      <!-- …原樣：batchFailures 的 el-alert… -->
      <el-skeleton v-if="loading" animated :rows="4" class="visit-list__skeleton" />
      <template v-else-if="requests.length">
        <section v-for="group in dayGroups" :key="group.key" class="visit-day" :class="{ 'visit-day--today': group.bucket === 'today' }">
          <h3 v-if="group.label" class="visit-day__title">{{ group.label }}<span class="visit-day__count">{{ group.rows.length }} 組</span></h3>
          <ul class="visit-rows">
            <VisitListRow
              v-for="row in group.rows"
              :key="row.id"
              :row="row"
              :now="clockNow"
              :to="detailTo(row.id)"
              :day-only="DAY_ONLY.has(group.bucket)"
              :show-created="!grouped"
              :multi-campus="multiCampus"
              :selected="false"
              :previewable="false"
              :can-handle="canHandle"
              :can-fill-admissions="arrival.opensForm.value"
              :batch="batchMode"
              :checked="isSelected(row)"
              :busy="attendanceBusy === row.id"
              :locked="attendanceLocked"
              @activate="openDetail(row)"
              @attendance="(kind: AttendanceKind) => markAttendance(row, kind)"
              @fill="arrival.openFor(row)"
              @toggle="(on: boolean) => toggleSelected(row, on)"
            />
          </ul>
        </section>
      </template>
      <!-- 翻到最後一頁之後（page > 1）是到底了，不是篩不到：引導回上一頁，不叫人清除篩選。 -->
      <div v-else class="requests-empty"><strong>{{ emptyText }}</strong><p>{{ page > 1 ? '前面的頁數還有案件。' : hasFilters ? '試試其他條件，或清除篩選查看全部案件。' : '家長送出需求後會顯示在這裡，可查看聯絡資訊並安排參觀。' }}</p><el-button v-if="page > 1" @click="page -= 1">回上一頁</el-button><el-button v-else-if="hasFilters" @click="clearFilters">清除篩選</el-button></div>

      <div class="pager" v-if="page > 1 || hasNext">
        <el-button size="small" :disabled="page <= 1 || loading" @click="page -= 1">上一頁</el-button>
        <span class="hint">第 {{ page }} 頁</span>
        <el-button size="small" :disabled="!hasNext || loading" @click="nextPage">下一頁</el-button>
      </div>
    </div>
```

style：刪掉 `.visit-state*`、`.attendance-actions*`、`.request-list*`、`.requests-table`、`.requests-mobile`、`.cell-sub*`、`.date-cell`、`.source`、`.request-list__check*` 與 720px 裡對應的規則；加：

```css
.visit-list { container: visit-list / inline-size; }
.visit-list__head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.visit-list__head h2 { font-size: var(--text-lg); }
.visit-day { margin-top: 16px; }
.visit-day__title { display: flex; align-items: baseline; gap: 10px; margin: 0 0 8px; font-size: var(--text-lg); font-weight: 700; }
.visit-day--today .visit-day__title { color: var(--admin-accent-hover); }
.visit-day__count { font-size: var(--text-sm); font-weight: 400; color: var(--ink-3); }
.visit-rows { list-style: none; margin: 0; padding: 0; overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--surface); }
.visit-list__skeleton, .requests-empty { margin-top: 12px; padding: 24px 16px; border: 1px solid var(--line); border-radius: var(--radius-lg); background: var(--surface); }
.requests-batch { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-top: 12px; padding: 12px 16px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
.requests-batch__failures { margin: 12px 0 0; width: auto; }
.pager { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 16px; }
```

（`.requests-empty` 原本的文字樣式規則保留，`.pager` 原本那段換成上面這行。720px 裡 `.requests-batch` 的內距改成 `12px`、`.requests-batch__button { min-height: 44px; }` 保留。）

- [ ] **Step 9：改既有測試**

- `visitRequestsBatch.test.ts`：重寫成按畫面操作。原本 `findAllComponents({ name: 'ElTable' })…vm.$emit('selection-change', rows)` 改成點 `.visit-row .visit-row__check .el-checkbox`（或批次列的「全選這一頁」）；原本 `$emit('row-click', row, { type: 'selection' })`「勾選欄的格子點歪了不算點進案件」改成點 `.visit-row__check`（`span`）後 `router.currentRoute.value.path` 仍是 `/visit-requests`；`$emit('row-click', row, { type: 'default' })` 改成點 `a.visit-row__main`；手機的 `input[aria-label="勾選 林爸爸"]` 改成 `.el-checkbox[aria-label="勾選 林爸爸"]` 或 `.visit-row__check .el-checkbox`；`.requests-table .el-table__header .el-checkbox` 改成 `.requests-batch .el-checkbox`；按鈕文字、POST 順序、確認框文字、失敗清單的斷言不變。
- `ux20260928B1.test.ts`：`.requests-table .el-table__row`、`.request-list li` 改 `.visit-row`（同一筆只渲染一次，數量不再是兩倍）；`.requests-table th` 欄名陣列的 it 刪掉（沒有表格了）；`.date-cell`／「09/28 21:41 送出」的 it 改用 `?group=all&order=newest`（平鋪才寫送出時間）並斷言 `.visit-row` 文字含「09/28 21:41 送出」；`.requests-mobile .requests-empty` 改 `.requests-empty`；`.panel__head` 改 `.visit-list__head`；「小安 · 電話補登」改成斷言 `.visit-row` 文字含「小安」與「電話補登」。
- `ux20261005.test.ts`：`.requests-table .attendance-actions` 改 `.visit-row .attendance-actions`；`.panel__head h2` 改 `.visit-list__head h2`。
- `arrivalAdmissionsForm.test.ts`（列表的 it）：`.requests-table .attendance-actions` 改 `.visit-row .attendance-actions`。
- `uxRound6.test.ts`（:186-195）：讀取中「`.el-table__empty-text` 是空字串」改成讀取中 `.visit-list__skeleton` 存在、`.requests-empty` 不存在。
- `openRequestsUx.test.ts`：`.request-list` 改 `.visit-list`。

- [ ] **Step 10：跑測試**

```bash
for f in visitSchedule visitScheduleList visitListQuery visitRequestsBatch ux20260928B1 ux20261005 arrivalAdmissionsForm uxRound6 openRequestsUx listUx visitGroups adminUx attentionExportDeadline receptionUx20261002 followUpUx uxRound8Cases permissionsUx crossUx20261002 a11yStructure; do npx vitest run src/__tests__/$f.test.ts || break; done
```

Expected：全 PASS。

- [ ] **Step 11：Commit**

```bash
git add admin/src/utils/visitSchedule.ts admin/src/components/visit/VisitListRow.vue admin/src/views/VisitRequestsView.vue admin/src/__tests__/visitSchedule.test.ts admin/src/__tests__/visitScheduleList.test.ts admin/src/__tests__/visitRequestsBatch.test.ts admin/src/__tests__/ux20260928B1.test.ts admin/src/__tests__/ux20261005.test.ts admin/src/__tests__/arrivalAdmissionsForm.test.ts admin/src/__tests__/uxRound6.test.ts admin/src/__tests__/openRequestsUx.test.ts
git commit -F - <<'MSG'
feat(admin): 參觀案件改成依參觀日分組的行程清單，列內到了／沒來與填招生資料

今天置頂、明天、本週、之後；開著過台北午夜自動重讀。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

## Task 9：1280 以上的右側預覽面板 `VisitPreviewPanel`

**Files:**
- Create: `admin/src/components/visit/VisitPreviewPanel.vue`
- Create: `admin/src/__tests__/visitPreviewPanel.test.ts`
- Modify: `admin/src/views/VisitRequestsView.vue`（兩欄版面、選取、下一筆、處理後重讀）

**Interfaces:**
- Consumes: Task 1 `useVisitCase`／`provideVisitCase`（hooks `onChanged`、`onRebooked`）、`vc.noteDirty`、`vc.busy`；Task 2–5 的 `VisitCaseHero`（`compact`）、`VisitCaseFacts`（`compact`）、`VisitCaseTimeline`（`limit`、`fullPath`）、`VisitCaseSettings`、`VisitCaseDialogs`、`FamilyActions`（`primary`）；Task 8 的 `nextInList`、`VisitListRow` 的 `selected`／`previewable`、`openDetail(row)`；`useUnsavedChanges`、`useNarrowScreen(query)`
- Produces：`VisitPreviewPanel.vue` props `{ id: string; fullTo: RouteLocationRaw; hasNext: boolean }`、emits `{ next: []; changed: [] }`、`defineExpose({ confirmLeave })`；根元素 `aside.visit-preview.panel[aria-label="案件預覽"]`

- [ ] **Step 1：寫失敗的測試（Review Focus 3、4）**

`admin/src/__tests__/visitPreviewPanel.test.ts`：

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { ElMessageBox } from 'element-plus'
import VisitRequestsView from '../views/VisitRequestsView.vue'
import VisitDetailView from '../views/VisitDetailView.vue'
import { button, cleanup, mockGet, mockPost } from './admissionsTestKit'
import { caseRoutes, futureSlot, mountRoutes, pastSlot, visitCase } from './visitCaseKit'

const names: Record<string, string> = { r1: '吳先生', r2: '張小姐', r3: '李媽媽' }
const listRow = (id: string, slot = futureSlot) => ({ ...visitCase({ id, parent_name: names[id], slot, slot_id: slot.id }), history: undefined })
let rows: unknown[] = []

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 1280px)', media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.sessionStorage.clear() })

async function mountWide(ids: string[], options: { slot?: typeof futureSlot; notes?: unknown[] } = {}) {
  rows = ids.map((id) => listRow(id, options.slot))
  const detailRoutes = Object.assign({}, ...ids.map((id) => caseRoutes(visitCase({ id, parent_name: names[id], slot: options.slot ?? futureSlot, slot_id: (options.slot ?? futureSlot).id }), options.notes ?? [])))
  mockGet({ '/admin/visit-requests': () => rows, '/admin/visit-requests/view-counts': { upcoming: ids.length, past_unmarked: 0 }, ...detailRoutes })
  return mountRoutes('/visit-requests', { list: VisitRequestsView, detail: VisitDetailView })
}
const rowLink = (wrapper: { findAll: (s: string) => { trigger: (e: string, o?: object) => Promise<void> }[] }, index: number) => wrapper.findAll('a.visit-row__main')[index]!
const previewTitle = (wrapper: { get: (s: string) => { text: () => string } }) => wrapper.get('.visit-preview h2.detail__title').text()

describe('右側預覽（2026-10-06 方向 B）', () => {
  it('點一列在右邊看重點，不換頁；「打開完整案件頁」帶著列表條件', async () => {
    const { wrapper, router } = await mountWide(['r1', 'r2'])
    expect(wrapper.get('.visit-preview-empty').text()).toContain('點一筆')
    await rowLink(wrapper, 0).trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/visit-requests')
    expect(previewTitle(wrapper)).toBe('吳先生・小安')
    expect(wrapper.findAll('.visit-row')[0]!.classes()).toContain('is-selected')
    const open = wrapper.get('.visit-preview__open')
    expect(open.attributes('href')).toContain('/visit-requests/r1')
    expect(decodeURIComponent(open.attributes('href')!)).toContain('view=upcoming')
  })

  it('「下一筆」沿清單往下，最後一筆停用', async () => {
    const { wrapper } = await mountWide(['r1', 'r2'])
    await rowLink(wrapper, 0).trigger('click')
    await flushPromises()
    await button(wrapper.get('.visit-preview__foot'), '下一筆')!.trigger('click')
    await flushPromises()
    expect(previewTitle(wrapper)).toBe('張小姐・小安')
    expect(button(wrapper.get('.visit-preview__foot'), '下一筆')!.attributes('disabled')).toBeDefined()
  })

  it('⌘／Ctrl 點擊照常交給瀏覽器開新分頁，不選取', async () => {
    const { wrapper, router } = await mountWide(['r1'])
    await rowLink(wrapper, 0).trigger('click', { metaKey: true })
    await flushPromises()
    expect(wrapper.find('.visit-preview').exists()).toBe(false)
    expect(router.currentRoute.value.path).toBe('/visit-requests')
  })

  it('預覽裡打了一半的聯絡紀錄就換一筆：先問，選「留在這頁」就不換', async () => {
    const { wrapper } = await mountWide(['r1', 'r2'])
    await rowLink(wrapper, 0).trigger('click')
    await flushPromises()
    await wrapper.get('.visit-preview textarea').setValue('打到一半')
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValueOnce('cancel' as never)
    await rowLink(wrapper, 1).trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(previewTitle(wrapper)).toBe('吳先生・小安')
    confirm.mockResolvedValueOnce('confirm' as never)
    await rowLink(wrapper, 1).trigger('click')
    await flushPromises()
    expect(previewTitle(wrapper)).toBe('張小姐・小安')
  })

  it('在預覽裡取消、那筆離開清單：列表重讀，面板留著，下一筆由接手位置的那筆遞補', async () => {
    const { wrapper } = await mountWide(['r1', 'r2', 'r3'])
    mockPost()
    vi.spyOn(ElMessageBox, 'prompt').mockResolvedValue({ value: '', action: 'confirm' } as never)
    await rowLink(wrapper, 1).trigger('click')
    await flushPromises()
    rows = rows.filter((row) => (row as { id: string }).id !== 'r2')
    await button(wrapper.get('.visit-preview'), '取消預約')!.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.visit-row')).toHaveLength(2)
    expect(previewTitle(wrapper)).toBe('張小姐・小安')
    await button(wrapper.get('.visit-preview__foot'), '下一筆')!.trigger('click')
    await flushPromises()
    expect(previewTitle(wrapper)).toBe('李媽媽・小安')
  })

  it('預覽的按鈕一律淺色（實心主鈕只有補登案件）；時間線只列最新 3 筆', async () => {
    const note = (id: string, at: string) => ({ id, note: `紀錄${id}`, created_at: at, created_by: 'u1', created_by_email: 'amy@ivy.example', created_by_display_name: '怡君' })
    const notes = [note('n1', '2026-10-01T01:00:00Z'), note('n2', '2026-10-02T01:00:00Z'), note('n3', '2026-10-03T01:00:00Z'), note('n4', '2026-10-04T01:00:00Z')]
    const { wrapper } = await mountWide(['r1'], { slot: pastSlot, notes })
    await rowLink(wrapper, 0).trigger('click')
    await flushPromises()
    const preview = wrapper.get('.visit-preview')
    expect(button(preview, '家長到了')!.classes()).toContain('is-plain')
    expect(preview.findAll('.el-button--primary:not(.is-plain):not(.is-link):not(.is-text)')).toHaveLength(0)
    expect(preview.findAll('.timeline__item')).toHaveLength(3)
    expect(preview.get('.case-timeline__more').text()).toBe('還有 1 筆，打開完整案件頁')
  })
})
```

- [ ] **Step 2：跑測試確認失敗**

Run: `npx vitest run src/__tests__/visitPreviewPanel.test.ts` → FAIL（點列直接換頁、沒有 `.visit-preview`）

- [ ] **Step 3：實作 `VisitPreviewPanel.vue`**

```vue
<script setup lang="ts">
import { computed, toRef } from 'vue'
import { useRouter, type RouteLocationRaw } from 'vue-router'
import { ArrowDown } from '@element-plus/icons-vue'
import { provideVisitCase, useVisitCase } from '../../composables/useVisitCase'
import { useUnsavedChanges } from '../../composables/useUnsavedChanges'
import FamilyActions from './FamilyActions.vue'
import VisitCaseDialogs from './VisitCaseDialogs.vue'
import VisitCaseFacts from './VisitCaseFacts.vue'
import VisitCaseHero from './VisitCaseHero.vue'
import VisitCaseSettings from './VisitCaseSettings.vue'
import VisitCaseTimeline from './VisitCaseTimeline.vue'

// 參觀案件列表右側的預覽（2026-10-06 方向 B，1280 以上）：和案件明細同一份資料層與同一組元件，
// 一頁處理完不必來回跳頁；完整案件頁仍在（深連結、看全部紀錄）。按鈕一律淺色：列表頁的實心主鈕是「補登案件」。
const props = defineProps<{ id: string; fullTo: RouteLocationRaw; hasNext: boolean }>()
const emit = defineEmits<{ next: []; changed: [] }>()
const router = useRouter()

const vc = useVisitCase(toRef(props, 'id'), {
  onChanged: () => emit('changed'),
  onRebooked: async (created) => {
    await router.push(`/visit-requests/${created.id}`)
  },
})
provideVisitCase(vc)
// 打了一半的聯絡紀錄：換一筆或離開列表前先問（同明細）；列表選下一筆前呼叫 confirmLeave。
const { confirmLeave } = useUnsavedChanges(computed(() => vc.noteDirty), computed(() => vc.busy))
defineExpose({ confirmLeave })
const fullPath = computed(() => router.resolve(props.fullTo).fullPath)
</script>

<template>
  <aside class="visit-preview panel" aria-label="案件預覽">
    <el-alert v-if="vc.error" type="error" :closable="false" show-icon :title="vc.error" />
    <el-skeleton v-else-if="vc.loading" animated :rows="6" class="visit-preview__skeleton" />
    <template v-else-if="vc.detail">
      <VisitCaseHero compact />
      <div v-if="vc.familyVisit" class="visit-preview__section">
        <FamilyActions
          :visit="vc.familyVisit"
          :staff="vc.familyStaff"
          :latest="vc.latestFamilyContact"
          :rebookable="vc.canHandle"
          :primary="false"
          @changed="vc.onFamilyChanged"
          @stale="vc.family.reload()"
          @rebook="vc.rebookOpen = true"
        />
      </div>
      <VisitCaseFacts compact />
      <VisitCaseTimeline :limit="3" :full-path="fullPath" />
      <VisitCaseSettings />
      <VisitCaseDialogs />
    </template>
    <footer class="visit-preview__foot">
      <router-link :to="fullTo" class="visit-preview__open">打開完整案件頁 →</router-link>
      <el-button text :disabled="!hasNext" @click="emit('next')">下一筆<el-icon class="el-icon--right"><ArrowDown /></el-icon></el-button>
    </footer>
  </aside>
</template>

<style scoped>
/* 黏在視窗右側、內容自己捲；裡面的資料表、時間線、設定列不再各自一張卡，改成分隔線。 */
.visit-preview {
  position: sticky;
  top: calc(var(--top-h) + 16px);
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - var(--top-h) - 32px);
  padding: 0;
  overflow: auto;
}

.visit-preview :deep(.case-facts),
.visit-preview :deep(.case-timeline),
.visit-preview :deep(.case-settings) {
  border: 0;
  border-top: 1px solid var(--line);
  border-radius: 0;
  box-shadow: none;
}

.visit-preview__section {
  padding: 14px 20px;
  border-top: 1px solid var(--line);
}

.visit-preview__skeleton {
  padding: 20px;
}

.visit-preview__foot {
  position: sticky;
  bottom: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: auto;
  padding: 8px 20px;
  border-top: 1px solid var(--line);
  background: var(--surface);
  font-size: var(--text-sm);
}
</style>
```

- [ ] **Step 4：`VisitRequestsView.vue` 接上預覽**

script：

```ts
import VisitPreviewPanel from '../components/visit/VisitPreviewPanel.vue'
import { nextInList } from '../utils/visitSchedule'

// 1280 以上：點一列在右側預覽（2026-10-06 方向 B），⌘／Ctrl／中鍵照常開新分頁；較窄時點列照舊進明細。
// 一開始不自動選第一筆（換頁籤不必多打 API）；選取不寫進網址，返回列表時回到沒選的狀態。
const wide = useNarrowScreen('(min-width: 1280px)')
const selectedId = ref<string | null>(null)
let selectedIndex = 0
const preview = ref<InstanceType<typeof VisitPreviewPanel> | null>(null)
const rowIds = computed(() => requests.value.map((row) => row.id))
const nextId = computed(() => nextInList(rowIds.value, selectedId.value, selectedIndex))

async function select(id: string) {
  if (id === selectedId.value) return
  if (preview.value && !(await preview.value.confirmLeave())) return
  selectedId.value = id
  selectedIndex = Math.max(0, rowIds.value.indexOf(id))
}

async function selectNext() {
  if (nextId.value) await select(nextId.value)
}

// 清單重讀後，選中的那筆還在就記下它的新位置；不在了（剛取消、標未到場）就留著原位置讓「下一筆」遞補。
watch(requests, () => {
  const index = selectedId.value ? rowIds.value.indexOf(selectedId.value) : -1
  if (index >= 0) selectedIndex = index
})

// 預覽裡標了到場、改期、取消或記了一筆：清單與頁首的改期申請數一起更新。
function onPreviewChanged() {
  void load({ quiet: true })
  void openRequests.refresh(true)
}
```

`openDetail` 換成：

```ts
function openDetail(row: VisitRequestDetailOut) {
  if (wide.value) void select(row.id)
  else void router.push(detailTo(row.id))
}
```

template：`<div v-if="!error" class="visit-list" …>…</div>` 外面包一層，並接上預覽；`VisitListRow` 的兩個 props 改成跟著選取：

```html
    <div class="visit-split" :class="{ 'has-preview': wide }">
      <div v-if="!error" class="visit-list" :aria-busy="loading">
        <!-- …Task 8 的清單內容；VisitListRow 改成 :selected="row.id === selectedId" :previewable="wide"… -->
      </div>
      <template v-if="wide && !error">
        <VisitPreviewPanel
          v-if="selectedId"
          ref="preview"
          :id="selectedId"
          :full-to="detailTo(selectedId)"
          :has-next="Boolean(nextId)"
          @next="selectNext"
          @changed="onPreviewChanged"
        />
        <aside v-else class="visit-preview-empty panel" aria-label="案件預覽">
          <p class="hint">點一筆就會在這裡看到重點、聯絡紀錄與處理按鈕。</p>
        </aside>
      </template>
    </div>
```

style 加：

```css
.visit-split.has-preview { display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 20px; align-items: start; }
.visit-preview-empty { position: sticky; top: calc(var(--top-h) + 16px); margin-top: 32px; padding: 24px 20px; }
```

- [ ] **Step 5：跑測試**

```bash
for f in visitPreviewPanel visitScheduleList visitRequestsBatch ux20260928B1 listUx uxRound6 arrivalAdmissionsForm ux20261005 visitCaseLayout visitPrimaryAction; do npx vitest run src/__tests__/$f.test.ts || break; done
```

Expected：全 PASS（其他測試沒有 matchMedia，`wide` 是 false，點列照舊進明細）。

- [ ] **Step 6：Commit**

```bash
git add admin/src/components/visit/VisitPreviewPanel.vue admin/src/views/VisitRequestsView.vue admin/src/__tests__/visitPreviewPanel.test.ts
git commit -F - <<'MSG'
feat(admin): 參觀案件 1280 以上點一列在右側預覽，重用案件明細的元件

下一筆沿清單往下；打了一半的聯絡紀錄先問；處理完那筆離開清單由原位置遞補。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

# 收尾：stack e2e、驗證閘門、文件

## Task 10：stack e2e 選擇器、新的行程清單 spec、重拍明細基準

spec 由實作者改；**build 與跑 stack 由 controller 執行**（要起 API、web、拋棄式 DB，8GB 機器同時只跑這一組）。

**Files:**
- Modify: `tests/stack/visual.spec.ts`（遮罩）、`tests/stack/booking-flow.spec.ts`、`tests/stack/admissions-flow.spec.ts`、`tests/stack/admissions-follow-up.spec.ts`、`tests/stack/visit-family-page.spec.ts`、`tests/stack/a11y.spec.ts`
- Create: `tests/stack/visit-schedule.spec.ts`
- Update baseline: `tests/stack/visual.spec.ts-snapshots/visit-detail-chrome-darwin.png`

**Interfaces:**
- Consumes：新 class 與名稱：`.visit-row`、`a.visit-row__main`、`.visit-row__check .el-checkbox`、`.visit-day__title`、`.status-tab.is-active`、`aside[aria-label="案件預覽"]`（role complementary）、`.visit-preview__open`（「打開完整案件頁 →」）、`.case-hero__sub`、`.case-hero__relative`、`.case-facts dd`、`.case-timeline`、`.timeline__item[data-kind="note"]`、返回鈕「參觀案件（接下來）」

- [ ] **Step 1：改既有 spec 的選擇器**

- `visual.spec.ts`「案件明細」：遮罩改成

```ts
      // 送出時間、「還有 N 天」與同意時間是伺服器當下時間。
      mask: [...dynamicParts(page), page.locator('.case-hero__sub'), page.locator('.case-hero__relative'), page.locator('.case-facts dd', { hasText: /家長勾選同意|不需勾選同意/ })],
```

- `booking-flow.spec.ts`「園方在後台看到預約正常，取消後列表寫出家長取消」：`page.goto('/admin/visit-requests')` 之後改成

```ts
    await page.getByRole('textbox', { name: /搜尋家長/ }).fill('後台對照家長')
    // 預設頁籤是「接下來」（2026-10-06 方向 B），剛送出的預約在這裡。
    await expect(page.locator('.status-tab.is-active')).toContainText('接下來')
    const row = page.locator('.visit-row', { hasText: '後台對照家長' })
    await expect(row).toBeVisible()
    // 1440 寬：點一列在右側預覽，再打開完整案件頁。
    await row.locator('a.visit-row__main').click()
    const preview = page.getByRole('complementary', { name: '案件預覽' })
    await expect(preview.getByRole('heading', { level: 2, name: /後台對照家長/ })).toBeVisible()
    await preview.getByRole('link', { name: '打開完整案件頁 →' }).click()
    await expect(page.getByRole('heading', { level: 2, name: /後台對照家長/ })).toBeVisible()
```

  其後的「取消預約」→ 確認框 →「已取消」照舊。
- `admissions-flow.spec.ts`：兩處 `page.locator('.requests-table tr', { hasText: PARENT })` 改 `page.locator('.visit-row', { hasText: PARENT })`。
- `admissions-follow-up.spec.ts`：`page.locator('.requests-table tr', { hasText: family.parent }).locator('.el-checkbox')` 改 `page.locator('.visit-row', { hasText: family.parent }).locator('.visit-row__check .el-checkbox')`；`toHaveCount(0)` 那行的 `.requests-table tr` 改 `.visit-row`。
- `visit-family-page.spec.ts`：`page.locator('.family-notes__item', { hasText: … })` 改 `page.locator('.timeline__item[data-kind="note"]', { hasText: … })`（仍含「參觀後」「聯絡到了」）；手機那步 `.family-notes` 改 `.case-timeline`。
- `a11y.spec.ts` 的 `ADMIN_PAGES` 加 `['/visit-requests?group=arrived', '參觀案件']`；並在同一個 describe 加一個 test：到 `/visit-requests`（1440）點第一個 `a.visit-row__main`、等 `aside[aria-label="案件預覽"] h2` 出現，再照檔內其他 test 的寫法跑 axe（serious／critical 0）。

- [ ] **Step 2：新增 `tests/stack/visit-schedule.spec.ts`**

```ts
import { mkdirSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { submitPublicRequest } from './api'
import { gotoAdmin } from './pages'
import { SECOND_CAMPUS, storageStatePath } from './stack-env'

// 參觀案件行程清單（方向 B）與案件明細（方向 C）的端對端檢查；截圖存 output/（gitignore）給人看，不比對像素。
const SHOTS = 'output/admin-visit-ux-20261006'
const PARENT = '行程清單家長'

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

test.describe('參觀案件行程清單與案件明細（2026-10-06）', () => {
  test.use({ storageState: storageStatePath('super_admin') })

  test.beforeAll(async () => {
    mkdirSync(SHOTS, { recursive: true })
    await submitPublicRequest(SECOND_CAMPUS, PARENT, '0912000661')
  })

  // 其他 spec 也會建案件，接下來可能超過一頁：先搜尋這位家長再找列。
  async function openList(page: Page) {
    await gotoAdmin(page, '/visit-requests', '參觀案件')
    await page.getByRole('textbox', { name: /搜尋家長/ }).fill(PARENT)
    await expect(page.locator('.visit-row', { hasText: PARENT })).toBeVisible()
  }

  test('1440：接下來依參觀日分組；點一列右側預覽、不換頁；打開完整案件頁，返回寫頁籤名', async ({ page }) => {
    await openList(page)
    await expect(page.locator('.status-tab.is-active')).toContainText('接下來')
    await expect(page.locator('.visit-day__title').first()).toBeVisible()
    const row = page.locator('.visit-row', { hasText: PARENT })
    await row.locator('a.visit-row__main').click()
    const preview = page.getByRole('complementary', { name: '案件預覽' })
    await expect(preview.getByRole('heading', { level: 2, name: new RegExp(PARENT) })).toBeVisible()
    await expect(page).toHaveURL(/\/admin\/visit-requests(\?[^/]*)?$/)
    await expect(row).toHaveClass(/is-selected/)
    await page.screenshot({ path: `${SHOTS}/list-preview-1440.png`, fullPage: true })
    await preview.getByRole('link', { name: '打開完整案件頁 →' }).click()
    await expect(page.getByRole('heading', { level: 1, name: '案件明細' })).toBeVisible()
    await expect(page.getByRole('button', { name: '參觀案件（接下來）' })).toBeVisible()
    await expect(page.locator('.case-timeline textarea')).toBeVisible()
    await page.screenshot({ path: `${SHOTS}/detail-1440.png`, fullPage: true })
  })

  test('1280：預覽面板仍在；明細在 1100 是一欄', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await openList(page)
    await page.locator('.visit-row', { hasText: PARENT }).locator('a.visit-row__main').click()
    const preview = page.getByRole('complementary', { name: '案件預覽' })
    await expect(preview).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: `${SHOTS}/list-preview-1280.png`, fullPage: true })
    // 先在 1280 打開完整案件頁（1280 以下預覽面板就不在了），再縮到 1100 看一欄。
    await preview.getByRole('link', { name: '打開完整案件頁 →' }).click()
    await expect(page.getByRole('heading', { level: 1, name: '案件明細' })).toBeVisible()
    await page.setViewportSize({ width: 1100, height: 900 })
    const timelineLeft = await page.locator('.case-timeline').evaluate((el) => el.getBoundingClientRect().left)
    const factsLeft = await page.locator('.case-facts').evaluate((el) => el.getBoundingClientRect().left)
    expect(factsLeft).toBe(timelineLeft)
    await expectNoHorizontalOverflow(page)
  })

  test('390 手機：清單是卡片、不橫向溢出；點列進明細，主鈕與撥號在頁首', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openList(page)
    const row = page.locator('.visit-row', { hasText: PARENT })
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: `${SHOTS}/list-390.png`, fullPage: true })
    await row.locator('a.visit-row__main').click()
    await expect(page.getByRole('heading', { level: 1, name: '案件明細' })).toBeVisible()
    await expect(page.locator('.detail__call')).toBeVisible()
    await expectNoHorizontalOverflow(page)
    const heroBottom = await page.locator('.case-hero').evaluate((el) => el.getBoundingClientRect().bottom)
    const timelineTop = await page.locator('.case-timeline').evaluate((el) => el.getBoundingClientRect().top)
    const factsTop = await page.locator('.case-facts').evaluate((el) => el.getBoundingClientRect().top)
    expect(heroBottom).toBeLessThanOrEqual(timelineTop)
    expect(timelineTop).toBeLessThan(factsTop)
    await page.screenshot({ path: `${SHOTS}/detail-390.png`, fullPage: true })
  })
})
```

- [ ] **Step 3：commit spec（基準圖下一步才產生）**

```bash
git add tests/stack/visual.spec.ts tests/stack/booking-flow.spec.ts tests/stack/admissions-flow.spec.ts tests/stack/admissions-follow-up.spec.ts tests/stack/visit-family-page.spec.ts tests/stack/a11y.spec.ts tests/stack/visit-schedule.spec.ts
git commit -F - <<'MSG'
test(stack): 參觀案件行程清單與明細新版面的 e2e 選擇器與新 spec

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

- [ ] **Step 4（controller）：build、重拍基準、跑相關 stack spec**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-visit-ux-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1
npm --prefix web ci
export E2E_DB_NAME=ivy_website_visitux1006_e2e_test E2E_API_PORT=8761 E2E_WEB_PORT=3761
npm run e2e:build
npm run test:e2e:stack -- visual --update-snapshots
npm run test:e2e:stack -- visit-schedule booking-flow admissions-flow admissions-follow-up visit-family-page a11y roles keyboard visual
```

Expected：全部 passed。用 Read 打開 `tests/stack/visual.spec.ts-snapshots/visit-detail-chrome-darwin.png` 與 `output/admin-visit-ux-20261006/*.png`，對照 `design/admin-ux-directions-20261006/shots/c-detail-desktop.png`、`b-visits-desktop.png`、`*-mobile.png`：頁首一顆主鈕、時間線輸入框在最上、家長資料表、設定列取消在最底；列表今天置頂、列內按鈕淺色、右側預覽。不對就回到對應 Task 修，不要只重拍。

- [ ] **Step 5（controller）：commit 基準圖**

```bash
git add tests/stack/visual.spec.ts-snapshots/visit-detail-chrome-darwin.png
git commit -F - <<'MSG'
test(stack): 重拍案件明細視覺基準（時間線＋主動作版面）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
dropdb --if-exists ivy_website_visitux1006_e2e_test
```

---

## Task 11：驗證閘門（controller 執行，全部綠燈才進 Task 12）

**Files:** 不改檔（失敗就回到負責的 Task 修，修完重跑這一整個 Task）。

- [ ] **Step 1：admin 全套**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-visit-ux-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1
npm --prefix admin run typecheck
npm --prefix admin run test:unit
npm --prefix admin run build
```

Expected：typecheck 0 錯誤；vitest 全過（記下「N 檔 M 項」）；build 成功。

- [ ] **Step 2：後端全套與契約**（全套 pytest 用背景執行，等完成通知；不要交給 subagent）

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-visit-ux-20261006/backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_visitux1006_test uv run pytest -q
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-visit-ux-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm run contract:check
cd backend; WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_visitux1006_test WEBSITE_SESSION_SECRET=test-only-secret-please-rotate uv run alembic heads
```

Expected：pytest 全過（記下 passed／skipped；週五台北時間跑 `test_booking_consent_readiness` 的場次同步可能因日期相依失敗，那是 main 既有問題，記下不修）；契約一致；alembic 只有一個 head，且和 `3d50e0a1` 時相同（這次沒有 migration）。

- [ ] **Step 3：stack 全套**（Task 10 之後如果還有程式改動，先 `npm run e2e:build`）

```bash
export E2E_DB_NAME=ivy_website_visitux1006_e2e_test E2E_API_PORT=8761 E2E_WEB_PORT=3761
npm run test:e2e:stack
dropdb --if-exists ivy_website_visitux1006_e2e_test
```

Expected：全部 passed（記下件數）。視覺基準差異 <1% 但非預期時用 `--update-snapshots=all` 前先看圖。

- [ ] **Step 4：規則抽查**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-visit-ux-20261006
grep -rn "承辦" admin/src/components/visit admin/src/views/VisitDetailView.vue admin/src/views/VisitRequestsView.vue admin/src/composables/useVisitCase.ts
grep -rnE "font-size: *[0-9]+px|ElMessage\.(error|warning)\(" admin/src/components/visit admin/src/composables/useVisitCase.ts admin/src/views/VisitDetailView.vue admin/src/views/VisitRequestsView.vue
git diff --stat 3d50e0a1..HEAD
```

Expected：前兩個 grep 沒有輸出；diff 只在 File Structure 表列的檔案。

- [ ] **Step 5：記下結果給 Task 12**（數字、未驗證項：正式站、iOS Safari 實機、真資料量下的分組跨頁）。

---

## Task 12：文件（README、DESIGN.md、驗收表）

**Files:**
- Modify: `README.md`（頂部加日期段）
- Modify: `DESIGN.md`（檔頭 `# Design` 下面加兩節）
- Modify: `docs/website-admin/acceptance.md`（檔尾加一節）

- [ ] **Step 1：README 頂部**（`# …` 標題之後、目前第一個 `## 2026-10-06 …` 之前）

```markdown
## 2026-10-06 參觀案件明細時間線（C）與案件列表行程清單（B）（`feature/admin-visit-ux-20261006`，未部署）

使用者看完後台結構層比稿（`design/admin-ux-directions-20261006/`）選 C 與 B，先 C 後 B。規則見 DESIGN.md「案件明細：一條時間線＋一個主動作」「參觀案件：照參觀日排的行程清單」，計畫 `docs/superpowers/plans/2026-10-06-admin-visit-ux.md`。

- **案件明細**（`VisitDetailView` 拆成 `components/visit/VisitCase*`，資料層 `composables/useVisitCase.ts`）：頁首寫「家長・孩子」與「結束了 2 小時／還有 3 天」，依階段只給一顆主鈕（家長到了／核准改期／填招生資料／建立招生訪視／重新預約）；聯絡紀錄與案件歷程合成一條時間線、輸入框在最上；家長資料壓成一張表；改場次、家長管理連結收成設定列，取消在最底。1100px 以下一欄。
- **參觀案件列表**：頁籤改成接下來／時間已過／已到場／已取消／全部（網址仍用 `group`，舊連結照對照表落點）；依台北參觀日分組（今天、明天、本週、之後；往回的頁籤是今天、昨天、本週稍早、更早），列內到了／沒來、已到場的列「填招生資料」；開著過午夜自動重讀；1280 以上點一列右側預覽（同一組明細元件），「下一筆」沿清單往下。
- **後端**：`GET /admin/visit-requests` 加 `view`（接待頁籤）與 `order=visit_asc|visit_desc`，新增 `GET /admin/visit-requests/view-counts`；舊 `group` 不變、沒有 migration，契約重新產生。
- **驗證**：（填 Task 11 的實際結果：admin vitest N 檔 M 項、typecheck、build；後端 pytest N passed；contract:check；stack N passed；視覺基準 visit-detail 重拍。）截圖在 `output/admin-visit-ux-20261006/`。
- **沒做／未驗證**：承辦人（10-06 已拿掉）；mock 的「修改資料」「兄姊」「常駐複製家長連結」（見 DESIGN 裁定）；正式站、iOS Safari 實機。待使用者確認：第五個頁籤「全部」。
```

- [ ] **Step 2：DESIGN.md 加兩節**（放在 `# Design` 下、「官網後台總覽：今天的行程板」之前）

```markdown
## 案件明細：一條時間線＋一個主動作（2026-10-06，`feature/admin-visit-ux-20261006`）

使用者看完結構層比稿選方向 C。以下是之後要照著做的：

- **頁首依階段只給一顆實心主鈕**（`composables/visitCaseStage.ts`）：預約正常＋場次已開始＝「家長到了」（實心）「沒來」；還沒開始＋家長申請改期＝「核准改期」（實心）「退回申請」（已開始時申請區的核准改淺色）；還沒開始＝沒有主鈕，只寫提示；家庭版面＝「填招生資料」；已到場沒有招生訪視＝「建立招生訪視」或「重新載入」＋次要的「重新預約（另建新案）」；其他結案＝「重新預約（另建新案）」；沒有 `booking.handle`＝只寫唯讀提示。確認框文字不變（標記已到場？／標記未到場）。
- **頁首寫「家長・孩子」與相對時間**：還有 N 天／明天／還有 N 小時／進行中／剛結束／結束了 N 分鐘、N 小時、N 天（台北日期），只對預約正常的寫，結束後暖黃。撥號是頁首的文字鈕，桌機也有。
- **聯絡紀錄與案件歷程合成一條時間線**（`api/visitTimeline.ts`）：新的在上，輸入框（含下次聯絡）固定在最上；聯絡紀錄和同一個交易寫的 `contact_logged` 歷程（同一人、5 秒內）合成一筆，下次聯絡掛在那筆下面。家庭版面併入參觀後聯絡與招生事件，標「參觀前／參觀後」「預約／招生」，沒有輸入框（參觀後用「記錄聯絡」）。
- **家長資料是一張兩欄表**，孩子姓名與生日一行；舊資料才有的欄位有值才列。**設定列**：場次（改到其他場次…）、家長管理連結、最底的取消預約（分隔線後）。家長連結的網址只在產生當下顯示（只存 hash），不做常駐複製。
- **版面**：兩欄 `1fr＋360px`，右欄不 sticky；1100px 以下一欄，順序：頁首 →（家庭：處理區）→ 招生資料 → 時間線 → 家長資料 → 設定列。
- **取代的舊規則**：第七輪「處理區先問家長到了嗎、標記已到場／標記未到場」（改在頁首、文字改「家長到了／沒來」）；第九輪「手機明細的順序：撥號 → 處理面板 → 聯絡紀錄 → 家長資料」；家庭頁「聯絡紀錄、案件歷程分兩區」；第九輪「明細的改期收成連結」仍成立，只是搬到設定列。不變：三層標題與返回連結（從列表來時寫「參觀案件（接下來）」）、取消在最底、下一筆、離頁保護、30 秒切回重讀。

## 參觀案件：照參觀日排的行程清單（2026-10-06，`feature/admin-visit-ux-20261006`）

使用者看完結構層比稿選方向 B。以下是之後要照著做的：

- **頁籤是接待語意**：接下來（台北今天起、未取消，今天整天都在）／時間已過（場次已開始、預約正常或未到場）／已到場／已取消／全部（全部待使用者確認）。頁籤可以重疊。數字只在接下來（全部件數）與時間已過（還沒標記到場，＝總覽同一個數字）。後端 `view` 與 `view-counts`（`status_groups.view_condition`），舊 `group` 不變。
- **網址仍用 `group`**：完全沒有參數＝接下來；有其他參數卻沒有 group＝改版前的連結，落到「全部」；舊 `?status=` 照狀態對到頁籤。寫回網址時只有「接下來＋沒有其他條件」省略 group（`api/visitListQuery.ts`）。
- **依參觀日分組**（台北、週一開始）：今天 MM/DD（週X）置頂、明天、本週、之後；往回的頁籤是今天、昨天、本週稍早、更早。分組照這一頁連續切，跨頁不合併。選「依送出時間」排序時不分組、每列寫送出時間。開著過午夜自動重讀。
- **一列**：時間（今天這類組只寫幾點）＋接待狀態（還沒標記暖黃、進行中綠、已到場、未到場）、家長・孩子、校區、電話、動作；「到了／沒來」淺色、場次開始才出現，已到場的列「填招生資料」。列表沒有撥號鈕（電話本身可點）。
- **1280 以上右側預覽**：點一列（沒按修飾鍵）在右邊開，⌘／Ctrl／中鍵照常開新分頁；和明細同一組元件，按鈕一律淺色，時間線只列最新 3 筆，取消在最底；「下一筆」沿這一頁往下，處理完離開清單由原位置遞補；打了一半的聯絡紀錄換一筆前先問。一開始不自動選、選取不寫網址。
- **取代的舊規則**：拿掉待處理「分組剩預約正常／時間已過／已取消」、第九輪「面板標題…表格欄寬以 1280 為準」「分頁數字是件數不是待辦」、第五輪「總覽連到案件列表一律帶最早送出在前」、第六輪「list= 只在篩了狀態、到期或待人工處理時帶」（現在除了「全部」都帶）。不變：補登案件是頁面唯一實心主鈕、搜尋與更多篩選、匯出、批次標記（改成列首勾選＋「全選這一頁」）、每頁 20 筆。
```

- [ ] **Step 3：`docs/website-admin/acceptance.md` 檔尾**

```markdown
## 案件明細時間線（C）與案件列表行程清單（B）（2026-10-06）

計畫：`docs/superpowers/plans/2026-10-06-admin-visit-ux.md`。

| # | 驗收 | 驗證 |
|---|---|---|
| V1 | 明細頁首依階段只有一顆實心主鈕，寫「結束了多久」 | `visitPrimaryAction.test.ts`、`visitCaseHero.test.ts`、`visitSchedule.test.ts` |
| V2 | 聯絡紀錄與歷程一條時間線，輸入框在最上；家庭版面合併參觀前後與招生事件 | `visitTimeline.test.ts`、`visitCaseTimeline.test.ts`、stack `visit-family-page.spec.ts` |
| V3 | 家長資料表、設定列、取消在最底；1100px 以下一欄的順序 | `visitCaseLayout.test.ts`、stack `visit-schedule.spec.ts` |
| V4 | 現有功能都在（改期申請、人工改期、到場／未到場、取消、家長連結、聯絡紀錄＋下次聯絡、招生資料、下一筆、角色可見性） | 計畫「現有功能 → 新位置」對照、既有明細測試全過 |
| V5 | 頁籤接下來／時間已過／已到場／已取消／全部，件數對得上總覽 | `test_visit_views.py`、`listUx.test.ts` |
| V6 | 舊連結落點正確 | `visitListQuery.test.ts`、stack `admissions-flow.spec.ts`、`admissions-follow-up.spec.ts` |
| V7 | 依台北參觀日分組、換日重讀、列內到了／沒來、填招生資料、批次 | `visitScheduleList.test.ts`、`visitRequestsBatch.test.ts` |
| V8 | 1280 以上右側預覽、下一筆、草稿保護、處理後遞補 | `visitPreviewPanel.test.ts`、stack `visit-schedule.spec.ts` |
| V9 | 後端 view／排序／view-counts、契約一致、沒有 migration | `test_visit_views.py`、`npm run contract:check`、alembic heads |

驗證（填 Task 11 的日期、HEAD 與數字）：admin vitest、typecheck、build；後端 pytest；contract:check；stack e2e；visit-detail 視覺基準已重拍。

未驗證：正式站、iOS Safari 實機、真資料量下分組跨頁。待使用者確認：第五個頁籤「全部」。
```

- [ ] **Step 4：Commit**

```bash
git add README.md DESIGN.md docs/website-admin/acceptance.md
git commit -F - <<'MSG'
docs: 記錄案件明細時間線與參觀案件行程清單的規則與驗收

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
MSG
```

---

## 收尾（controller，不在任何 Task 裡）

- 不 push、不合 main、不部署。回報給使用者：分支、commit 清單、驗證數字、截圖路徑、「待使用者確認」Q1。
- 使用者要上線時，照 `deploy/README.md` 流程另外處理（沒有 migration，不必先備份正式庫）；上線後補部署紀錄、清 worktree（先確認沒有別的 worktree 連著它的 `node_modules`／`.venv`）。
