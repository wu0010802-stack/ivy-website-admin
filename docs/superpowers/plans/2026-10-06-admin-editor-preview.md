# 內容編輯三欄＋即時預覽（方向 D）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 15 個官網內容編輯頁（共用 `ContentEditor.vue`）改成「左段落目錄（改過的段落打點）、中表單、右官網即時預覽」，底部動作列直接寫「草稿有 N 處修改：欄位A、欄位B」，發布前不再另開「改前→改後」差異框。

**Architecture:** 後台在 1280px 以上、且後台與官網同源時，右欄以 iframe 嵌官網 `/preview?embed=1&live=1&page=…`；後台把「目前表單內容（還沒存）」debounce 300ms 後用 `postMessage`（指定 targetOrigin）傳進 iframe，iframe 只接受同源且 `event.source === window.parent` 的訊息、驗證格式後把那一項內容蓋在已存草稿上重畫，並用「改到的那段文字」在對應區塊裡找位置框起來（找不到就框整塊）。動作列與目錄打點共用同一個比對基準：表單和官網那一版比（重用 `diffPayload`／`compareWithLive` 的 `livePayloads` 快取）。

**Tech Stack:** admin＝Vue 3.5 + Element Plus 2.14 + Vite 8 + Vitest 4（jsdom）；web＝Nuxt 4.5 + Vue 3.5 + Vitest 3（node／happy-dom）；端到端＝Playwright（`playwright.stack.config.ts`，真後端＋隔離測試庫）。

**Spec:** `design/admin-ux-directions-20261006/README.md`、`index.html`（D 段）、`d-editor.html`、`shots/d-editor-desktop.png`、`shots/d-editor-mobile.png`、`shots/current/desktop-content_campus-profile.png`（這個目錄在 worktree 是**未追蹤**的使用者工作檔，只讀、不要 `git add`）。另依 `DESIGN.md`「官網後台第四～九輪」「全面盤點（2026-09-28）」各章。

---

## Global Constraints

- 語言：畫面與文件一律繁體中文（台灣用語），技術名詞與識別符保留原文。後台文案沿用既有語氣（「先不要」「放棄修改」「官網」「家長」），不寫版本號、不寫工程語。
- 後台設計硬規則（`DESIGN.md` 第七～九輪）：字級只用十級 token（`--text-xs` 12 … `--text-5xl` 28），元件不寫 px 字級；**不用 2px 以上的彩色左右邊框**（`--line` 灰線除外），`ux20261005.test.ts` 守門；不動畫 width／height；實心主色一頁一顆（動作列既有「主色給真正的下一步」規則不變）；操作色維持青藍（`--admin-accent`、`--admin-accent-hover`、`--el-color-primary-light-9`）；錯誤提示走 `admin/src/composables/notify.ts`（本計畫的預覽失敗用欄內文字，不跳 toast）。
- 官網硬規則：`/preview` 維持 `definePageMeta({ ssr: false })`、`<meta name="robots" content="noindex, nofollow">`、回應標頭 `Cache-Control: private, no-store`（`web/server/middleware/preview-headers.ts`，不要改它）。即時草稿**不得**寫進網址、`localStorage`／`sessionStorage`／cookie／`useState`、任何快取或 SSR 輸出，也不得送進 telemetry。
- `postMessage` 一律指定 targetOrigin（後台→iframe 用預覽來源、iframe→後台用 `location.origin`），**禁止 `'*'`**。
- 不動 `admin/src/views/VisitDetailView.vue`、`admin/src/views/VisitRequestsView.vue`（方向 B、C 在另一分支改）。不動 `backend/`、`contracts/`（本計畫沒有 API 變更），不動根目錄凍結原型（`index.html`、`app.js`、`styles.css`、`studio.css`、`preview.html`）。不新增 npm 套件。
- Node 22（`.nvmrc` = 22.23.2）。每個 Node 指令前綴：`source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; <cmd>`（**用分號**，`source nvm.sh` 會回傳 3，用 `&&` 會中斷）。
- 工作目錄一律 `/Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006`（分支 `feature/admin-editor-preview-20261006`，sparse checkout）。不要動其他目錄或其他 worktree。
- 測試：實作者只跑自己 Task 列出的測試檔（admin：`npm --prefix admin run test:unit -- src/__tests__/<檔名>`；web：`npm --prefix web run test:unit -- tests/<檔名>`；`npm run` 在該目錄執行，吃得到各自的 vitest 設定）。全套閘門（admin vitest＋typecheck、`npm --prefix web run typecheck`、`npm run test:website`、`npm run contract:check`、相關 stack）只在 Task 15 由 controller 跑。機器 8GB RAM：同時只跑一組測試或一個 build。
- 端到端測試庫：`E2E_DB_NAME=ivy_website_editorpreview1006_test`，埠 `E2E_API_PORT=8791`、`E2E_WEB_PORT=3791`（避開其他 session 的 8710／3710）。不碰 dev 庫、正式庫、staging。
- 不 push、不部署、不發通知、不建付費服務。
- Commit：每個 Task 結尾一次，Conventional Commit、繁體中文，只 `git add` 該 Task 列出的檔案（**禁止** `git add .`、`-A`、`commit -a`），訊息最後一行 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 不 reset／checkout 還原／stash／clean 任何不是自己這個 Task 產生的修改。

## 資安檢查清單（每個碰到預覽的 Task 交付前逐條對）

1. **來源驗證（iframe 端）**：只處理 `event.origin === location.origin` **且** `event.source === window.parent` **且** `window.parent !== window` 的訊息（`isTrustedPreviewEvent`）。同源其他分頁（`window.opener`）、自己對自己 `postMessage`、其他 origin 一律丟掉。
2. **來源驗證（後台端）**：只處理 `event.origin === 預覽來源` **且** `event.source === iframe.contentWindow`（目前這個 iframe，不是上一個）的回覆。
3. **格式驗證**：`type`、`v === 1`、`seq` 為正整數且遞增（舊的丟掉）、`kind` 在白名單、共用內容 `campusKey === null`、分校內容 `campusKey` 必須是官網 fixture 的五校之一、`payload` 是一般物件且 JSON 不超過 1,000,000 字元、`page` 在 `PreviewPage` 白名單、`focus.block` 用 `hasOwnProperty` 查 `PREVIEW_BLOCKS`（擋 `toString`、`constructor` 這類原型鍵）、`probe` 截到 80 字。
4. **frame-ancestors／X-Frame-Options**：`/preview` 維持 `frame-ancestors 'self'` 與 `X-Frame-Options: SAMEORIGIN`（只有同源的 `/admin/` 能嵌）；後台 CSP 明寫 `frame-src 'self'`（原本靠 `default-src 'self'` 退回，改成明寫並加測試）。
5. **iframe sandbox**：`sandbox="allow-scripts allow-same-origin"`（需要同源 cookie 讀草稿；這組合對同源頁不是硬隔離，目的是擋 top-navigation、popup、表單送出、modal），`referrerpolicy="same-origin"`、`tabindex="-1"`；即時預覽模式下預覽頁的連結點了 `preventDefault` 不換頁。
6. **權限**：iframe 先照舊打 `/api/website/v1/auth/me`，401 或停用帳號就顯示原本的拒絕畫面並回 `denied`，**在拿到授權之前不掛 message listener**。
7. **草稿不外洩**：草稿只存在 iframe 的 `shallowRef` 記憶體；網址只有 `embed=1&live=1&page=…`；沒有 storage／cookie／`useState`；`/preview` 仍是 client-only、no-store、noindex；telemetry 對 `/preview` 本來就不送（`publicPage('/preview') === null`、`tracksClicks` 排除 `/preview`）。
8. **不同源不嵌**：`VITE_WEBSITE_ASSET_BASE` 指到別的 origin（本機 `npm run dev` 的 5173 對 3000）時不顯示預覽欄、不送任何訊息。

## Review Focus

1. **Vue reactive proxy 直接丟進 `postMessage` 會 DataCloneError**（表單是 `ref` 物件）：使用者打字時預覽毫無反應。期待：送出前先 JSON 複製成純物件。→ Task 12 測試「送出的是純 JSON（structuredClone 不丟錯、不是 proxy）」。
2. **預覽頁捲動或聚焦連帶動到後台**：`Element.scrollIntoView` 在同源 iframe 裡會把外層後台頁也捲過去，打字時整個編輯頁會跳；預覽頁若 `focus()` 會搶走輸入框焦點。期待：只捲 iframe 自己的視窗、焦點留在後台輸入框。→ Task 9 測試「用 `scrollTo` 不用 `scrollIntoView`」、Task 13 e2e「打完字輸入框仍有焦點、後台 `scrollY` 不變」。
3. **不是外層後台頁送來的訊息**（同源其他分頁、頂層直接開 `/preview?embed=1&live=1` 再自己 `postMessage`、別的 origin、原型鍵 `toString` 當 block）：期待一律忽略。→ Task 8 單元測試、Task 13 e2e「頂層自己送的訊息不套用」。
4. **換校或重新載入時晚到的回應**：上一校的官網版、上一個 iframe 的 `ready`、舊 `seq` 的草稿晚到，期待都不覆蓋目前這一校／這個 iframe。→ Task 1「換校後上一校晚到的官網版不算」、Task 8「舊 seq 丟掉」、Task 12「舊 iframe 的 ready 不算」。
5. **文字比對打到看不見的副本**（官網有些區塊桌機／手機各一份、五校輪播非目前那張）：框到隱藏元素等於沒框。期待：只往畫得出來的子元素找。→ Task 9 測試「隱藏副本不算，找畫得出來的那份」。

---

## 裁定（比稿沒講清楚、由計畫決定）

| # | 決定 | 理由 | 錯了的代價 |
|---|---|---|---|
| 1 | 「改哪格亮哪格」用**文字比對**：後台算出這次改到的那段文字（第一行、最多 40 字），預覽頁在目前分頁對應的區塊裡找最深、畫得出來的元素框起來；找不到（圖片、焦點、文字被轉換）就框整塊；五校卡會先切到那一校；整頁內容（入學、特色教學、關於、隱私）找不到時不框不捲。不在官網元件逐欄加 `data-*` 標記。 | 逐欄標記要改十幾個官網元件且容易漂移；文字比對對所有文字欄位通用、零對照表。 | 少數欄位只框整塊（圖片、裁切焦點、經過格式化的文字）；要逐欄標記時再補，介面（`focus`）不用改。 |
| 2 | 動作列「草稿有 N 處修改」＝**表單和官網那一版比**（同發布確認框 `compareWithLive` 的 `diffPayload`），不是和上次儲存比。因此草稿還沒發布時，**載入就讀一次官網那一版**（取代 09-28「開確認框前才讀」）。讀不到官網版時退回「改了 N 個欄位：…」（和上次儲存比）。 | 「發布前不用另開差異框」的前提是動作列寫的就是發布會改的欄位；只和上次儲存比會漏掉已存未發布的修改。 | 每次打開「草稿還沒發布」的編輯頁多 1 個 GET（官網就是最新一版時 0 個）。 |
| 3 | 發布確認框**保留但只寫欄位名**（「和官網目前的內容相比，會更新 2 個欄位：A、B。發布後家長立刻看到。」），不再列改前→改後；**核准並發布照舊列完整差異**（核准的人不是改的人）；讀不到官網版時退回舊差異框。 | 發布是對外動作，第四輪起一直要確認；差異已在動作列與預覽上看得到，確認框不必重複。 | 若使用者要完全不跳確認框，改 `publishWithConfirm` 一個條件（見「待使用者確認」）。 |
| 4 | mock 的「自動存於 16:31」**不做**。 | 後台沒有自動儲存（規格 L202「登入逾時不做本機暫存」）。 | 無。 |
| 5 | 目錄的點＝**這一段和官網不同**（和動作列同一基準），不是「還沒儲存」；「還沒儲存」仍由狀態列講。 | 一個點一種意思，和動作列清單對得上。 | 存完草稿點不會消失，要發布才消失；若使用者要「未儲存才打點」，改 `dirtySections` 用 `changes`。 |
| 6 | 目錄 1280 以上**一律在左**（取代第八輪「表單右側」）；目前段落用淺色主色底（`--el-color-primary-light-9`）＋深青藍字，**拿掉 2px 左框**。 | mock 位置；第九輪「不用彩色側條」。 | 無功能影響。 |
| 7 | 校區選單留在表單上方工具列，不搬進左欄（mock 有搬）。 | 工具列 slot 各頁內容不同（校園探索還有別的），搬動牽動 15 頁。 | 位置和 mock 差一點。 |
| 8 | 狀態列內容不改成 mock 的一句話，只搬進中欄頂端。 | 第四～九輪很多規則掛在狀態列（排程、送審、退回、存草稿並預覽）。 | 和 mock 字數不同。 |
| 9 | **校園探索不放預覽欄**，照舊「存草稿並預覽」。 | 它是寬版（1200px）場景＋熱點編輯器，三欄放不下；自己已有場景大圖。 | 改校園探索要開新分頁看。 |
| 10 | 五校介紹的預覽分頁只有「首頁五校」「頁尾」，**不做 mock 的「預約頁」**。 | 官網 `/preview?page=visit` 只畫預約文案的個資說明，沒有真正的預約表單（真表單會打場次 API、能送出）；預約頁的裁切比例已在 FocusPicker 有縮圖。 | 要看預約頁卡片仍要發布後看；之後若做唯讀版 VisitForm 再加分頁。 |
| 11 | 預覽寬度**預設「手機」**，切換後記在這台瀏覽器（`localStorage` 鍵 `ivy-admin-preview-viewport`，讀寫失敗當沒記）；桌機以 1280 寬渲染再縮放、手機 390 寬。 | 右欄 320–460px，桌機縮到約三成字看不清；家長多用手機。 | 想先看桌機的人要點一次。 |
| 12 | **同源才嵌**：後台與官網不同源時不顯示預覽欄，退回原本版面＋「存草稿並預覽」。本機要看即時預覽用 stack build（同源 `/admin/`）。 | 不同源要放寬 `frame-ancestors`／CSP，正式站不需要。 | `npm run dev` 看不到預覽欄（文件寫明）。 |
| 13 | 即時預覽模式下預覽頁的連結點了不換頁；iframe sandbox 不給 top-navigation／popups／forms。 | 預覽只看這一頁；避免點到連結把後台頁換掉。 | 預覽裡不能點去別頁（本來就不該）。 |
| 14 | 換校區、重新載入（`load`）時 iframe 重建（其他校的已存草稿重讀）；換預覽分頁只送訊息切頁，不重新載入。 | 載入時整個表單區換成骨架，預覽跟著重建最單純；切分頁要快。 | 換校時預覽重新載入約 1–2 秒。 |
| 15 | 預覽 iframe `tabindex="-1"`，鍵盤 Tab 不進預覽，以 `title="官網預覽"` 報讀。 | 整個官網的連結會把 Tab 路徑拉長幾十步；預覽是視覺輔助。 | 螢幕報讀使用者要用瀏覽模式才讀得到預覽內容。 |
| 16 | 預覽只覆蓋**目前這一項內容**；其他內容照舊是各自最新的已存草稿（同現有 `/preview`）。 | 和「預覽草稿」既有語意一致。 | 無。 |
| 17 | 手機動作列：摘要單行、超出省略，完整清單放 `title`；mock 手機截圖逐字折行是 mock 的版面錯誤，不照抄。 | 390px 放不下三顆鈕＋長清單。 | 無。 |
| 18 | 狀態列「存草稿並預覽 ↗」各寬度都保留。 | 寬螢幕也可能想看整頁大圖。 | 無。 |
| 19 | 網站標題與電話（site_meta）的預覽分頁是「頁首」，只有改頁首電話、電話備註、主選單時才框／捲；改網站描述、分享圖等只用在搜尋與分享的欄位，預覽不框不捲。預約文案同理：「預約頁」分頁只對個資說明兩欄、「頁首預約鈕」只對預約鈕兩欄。 | 避免改看不見的欄位時框錯地方。 | 無。 |
| 20 | 預覽沒回應（20 秒沒收到 ready，例如官網還是舊版）時改寫「預覽的是上次儲存的草稿」，存檔後自動重新載入；預覽頁回 `denied` 時欄內顯示「預覽沒有載入，可能是登入逾時。」＋「重新載入預覽」。 | 老實講預覽看的是什麼；不卡在「正在載入」。 | 無。 |

## 待使用者確認（有預設值，不擋實作）

- **發布要不要完全不跳確認框？** 預設：保留確認框、只寫欄位名（裁定 3）。若要完全不跳：Task 2 的 `publishWithConfirm` 在 `quickSummary` 有結果且沒有排程會被略過時直接 `saveAndPublish()`，並改 `ux20260928D.test.ts`、`editorActionSummary.test.ts` 對確認框的斷言。

## 15 個編輯頁 → 預覽頁／區塊

| 編輯頁（路由） | kind | 預覽分頁（label → `page` / `block`） | 備註 |
|---|---|---|---|
| 首頁大圖標語 `/content/home-hero` | `home_hero` | 首頁首屏 → `home` / `home-hero` | |
| 關於常春藤 `/content/home-about` | `home_about` | 首頁關於常春藤 → `home` / `home-about` | |
| 孩子的一天 `/content/day-experience` | `day_experience` | 首頁孩子的一天 → `home` / `home-day` | |
| 首頁五校區塊 `/content/home-campus-board` | `home_campus_board` | 首頁五校 → `home` / `home-campuses` | |
| 最新消息與活動 `/content/home-news` | `home_news` | 首頁最新消息 → `home` / `home-news` | 上下架依今天判斷（同既有預覽） |
| 五校介紹 `/content/campus-profile` | `campus_profile` | 首頁五校 → `home` / `home-campuses`（切到那一校）；頁尾 → `home` / `site-footer` | 不做預約頁（裁定 10） |
| 各校消息與活動 `/content/campus-news` | `campus_news` | 首頁最新消息 → `home` / `home-news` | |
| 預約文案 `/content/booking-content` | `booking_content` | 預約頁 → `visit` / `visit-booking`（fields：`privacy_title`、`privacy_sections`）；頁首預約鈕 → `home` / `site-header`（fields：`cta_label`、`cta_label_en`） | |
| 入學資訊頁 `/content/admission` | `admission_content` | 入學資訊頁 → `admission` / `page-top` | |
| 隱私權政策 `/content/privacy-policy` | `privacy_policy` | 隱私權政策頁 → `privacy` / `page-top` | |
| 特色教學頁 `/content/curriculum-page` | `curriculum_page` | 特色教學頁 → `curriculum` / `page-top` | |
| 關於常春藤頁 `/content/about-page` | `about_page` | 關於常春藤頁 → `about` / `page-top` | |
| 頁尾文字 `/content/site-footer` | `site_footer` | 頁尾 → `home` / `site-footer` | |
| 網站標題與電話 `/content/site-meta` | `site_meta` | 頁首 → `home` / `site-header`（fields：`header_phone_number`、`header_phone_note`、`primary_nav`） | 其他欄位只影響搜尋與分享（裁定 19） |
| 校園探索 `/content/campus-tour` | `campus_tour` | **無預覽欄** | 寬版編輯器（裁定 9） |

官網區塊選擇器（`web/app/utils/preview-live.ts` 的 `PREVIEW_BLOCKS`）：`home-hero` `.studio-hero`、`home-about` `.home-belief`、`home-day` `.day-experience`、`home-campuses` `#campuses`（會點 `#campus-tab-<校>`）、`home-news` `.home-news`、`site-header` `header.header`、`site-footer` `footer.footer`、`visit-booking` `.booking-draft`、`page-top` `#main`（找不到文字時不框）。

## postMessage 訊息格式（v1）

後台 → iframe（`iframe.contentWindow.postMessage(msg, 預覽來源)`）：

```ts
interface PreviewDraftMessage {
  type: 'ivy-preview:draft'
  v: 1
  seq: number                       // 後台遞增；iframe 只套用比上一則大的
  kind: string                      // 15 個 content kind 之一
  campusKey: string | null          // campus_profile／campus_tour／campus_news 必填，其餘 null
  payload: Record<string, unknown>  // 目前表單內容（JSON 複製過的純物件）
  page: 'home' | 'admission' | 'visit' | 'privacy' | 'curriculum' | 'about' | 'environment'
  focus: {
    block: 'home-hero' | 'home-about' | 'home-day' | 'home-campuses' | 'home-news' | 'site-header' | 'site-footer' | 'visit-booking' | 'page-top'
    campusKey: string | null        // home-campuses 用來切到那一校
    probe: string | null            // 改到的那段文字（第一行、≤40 字；iframe 再截到 80）
    mark: boolean                   // false＝改到的欄位不在這一塊，不框不捲
  }
}
```

iframe → 後台（`window.parent.postMessage(msg, location.origin)`）：

```ts
type PreviewReply =
  | { type: 'ivy-preview:ready'; v: 1 }                                  // 已授權、畫好，可以送草稿
  | { type: 'ivy-preview:denied'; v: 1 }                                 // 沒登入或帳號停用
  | { type: 'ivy-preview:applied'; v: 1; seq: number; hit: 'text' | 'block' | 'none' }
```

握手：iframe 載入 → 授權成功 → 掛 listener → 回 `ready` → 後台立刻送一則草稿 → 之後表單改變 debounce 300ms 再送；換預覽分頁立刻送（`page`、`focus` 換掉）。20 秒沒有 `ready` → 後台狀態改 `saved`。

## File Structure

| 檔案 | 動作 | 責任 | Task |
|---|---|---|---|
| `admin/src/composables/useContentItem.ts` | 改 | 新增 `DraftBaseline`、`draftBaseline`、`draftChanges`、`campusKey`；載入後讀官網版（重用 `livePayloads`） | 1 |
| `admin/src/composables/draftSummary.ts` | 新 | 動作列摘要文字（純函式） | 2 |
| `admin/src/components/ContentEditor.vue` | 改 | 動作列摘要、精簡發布確認框、目錄打點、三欄格線、預覽欄、即時預覽接線 | 2、3、7、12 |
| `admin/src/composables/editorSections.ts` | 改 | `EditorSection.fields`、`dirtySectionIds` | 3 |
| `admin/src/components/EditorSectionNav.vue` | 改 | `dirtyIds` 打點、左欄樣式 | 3 |
| `admin/src/views/CampusProfileView.vue` | 改 | 新增三段目錄（基本資料／封面照片與建築線稿／社群） | 4 |
| `admin/src/views/{HomeNews,CampusNews,DayExperience}View.vue` | 改 | 段落加 `fields` | 4 |
| `admin/src/views/{AboutPage,CurriculumPage,AdmissionContent,PrivacyPolicy}View.vue` | 改 | 段落加 `fields` | 5 |
| `admin/src/composables/previewTargets.ts` | 新 | 15 種內容 → 預覽分頁表、同源判斷、iframe 網址、縮放計算、寬度偏好 | 6 |
| `admin/src/components/LivePreviewPane.vue` | 新 | 右欄外觀：分頁、桌機／手機、狀態字、縮放 iframe、失敗重試 | 6 |
| `admin/src/composables/previewProtocol.ts` | 新 | 訊息格式（和 web 同一份）、建訊息、解析回覆 | 11 |
| `admin/src/composables/previewProbe.ts` | 新 | 找出這次改到的欄位與文字 | 11 |
| `admin/src/composables/useLivePreview.ts` | 新 | 握手、debounce、seq、狀態、來源驗證 | 12 |
| `web/app/utils/preview-live.ts` | 新 | 訊息格式、驗證、套用到 overlay、receiver | 8 |
| `web/app/utils/draft-preview.ts` | 改 | `isLivePreview` | 8 |
| `web/app/utils/preview-highlight.ts` | 新 | 找文字、切校、框選、只捲 iframe 視窗 | 9 |
| `web/app/composables/useDraftPreview.ts` | 改 | `render(date, live?)`、`campusKeys` | 10 |
| `web/app/pages/preview.vue` | 改 | 即時預覽模式：receiver、頁面切換、框選、擋連結、錯誤攔截 | 10 |
| `web/server/utils/security-headers.ts` | 改 | 後台 CSP 明寫 `frame-src 'self'` | 10 |
| `admin/src/__tests__/editorDraftBaseline.test.ts` | 新 | Task 1 | 1 |
| `admin/src/__tests__/editorActionSummary.test.ts` | 新 | Task 2 | 2 |
| `admin/src/__tests__/editorSectionDots.test.ts` | 新 | Task 3 | 3 |
| `admin/src/__tests__/editorSectionFields.test.ts` | 新 | Task 4、5 | 4、5 |
| `admin/src/__tests__/livePreviewPane.test.ts` | 新 | Task 6 | 6 |
| `admin/src/__tests__/editorThreeColumns.test.ts` | 新 | Task 7、12 | 7、12 |
| `admin/src/__tests__/previewProtocol.test.ts` | 新 | Task 11（含和 web 的對照） | 11 |
| `admin/src/__tests__/useLivePreview.test.ts` | 新 | Task 12 | 12 |
| `admin/src/__tests__/{ux20260928D,campusProfileSocials,uxRound8Nav}.test.ts` | 改 | 舊規則被取代的斷言 | 1、2、3 |
| `web/tests/preview-live.spec.ts`、`draft-preview.spec.ts` | 新／改 | Task 8 | 8 |
| `web/tests/preview-highlight.spec.ts` | 新 | Task 9 | 9 |
| `web/tests/use-draft-preview.spec.ts`、`preview-page-source.spec.ts`、`security-headers.spec.ts` | 新／新／改 | Task 10 | 10 |
| `tests/stack/visual.spec.ts`、`tests/stack/a11y.spec.ts` | 改 | 遮罩預覽、axe 不掃 iframe 內容 | 7 |
| `tests/stack/editor-live-preview.spec.ts` | 新 | 改欄位→預覽即時變、15 頁接得上、來源驗證、標頭 | 13 |
| `README.md`、`DESIGN.md`、`docs/website-admin/acceptance.md` | 改 | 紀錄、規則、驗收 | 14、15 |

---

## Phase 0

### Task 0: 安裝依賴並提交計畫檔

**Files:**
- Commit: `docs/superpowers/plans/2026-10-06-admin-editor-preview.md`

- [ ] **Step 1: 確認分支與起點**

Run:
```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; git branch --show-current; git log --oneline -1; git status --short
```
Expected: `feature/admin-editor-preview-20261006`、`3d50e0a1 Merge remote-tracking branch 'origin/main' into feature/analytics-ux-20261006`（或之後的計畫 commit）；未追蹤只有 `design/admin-ux-directions-20261006/` 與本計畫檔。

- [ ] **Step 2: 安裝 admin 與 web 依賴（Node 22）**

Run:
```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; node -v; npm --prefix admin ci; npm --prefix web ci
```
Expected: `v22.23.2`；兩個 `npm ci` 結束碼 0（web 的 postinstall 會跑 `nuxt prepare`）。根目錄 `npm ci` 與 `backend` 的 `uv sync` 留到 Task 13（只有 stack e2e 與 `contract:check` 需要），省磁碟。

- [ ] **Step 3: 提交計畫檔**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; git add docs/superpowers/plans/2026-10-06-admin-editor-preview.md; git commit -F - <<'EOF'
docs(plan): 內容編輯三欄＋即時預覽（方向 D）實作計畫

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Phase 1：共用殼（目錄打點、動作列寫欄位、三欄版面＋預覽欄框架）

### Task 1: 比對基準改成官網那一版（`draftBaseline`／`draftChanges`）

**Files:**
- Modify: `admin/src/composables/useContentItem.ts`（`LiveComparison` 下方加型別；`ContentEditorState` 加三個選填欄位；`compareWithLive` 上方的 `livePayloads`／`readLiveRevision` 之後加 `refreshLiveBase`；回傳物件加三個鍵）
- Create: `admin/src/__tests__/editorDraftBaseline.test.ts`
- Modify: `admin/src/__tests__/ux20260928D.test.ts`（「發布已存的草稿」那一則對讀取時機的斷言）

**Interfaces:**
- Consumes: 既有 `diffPayload(before, after, kind)`、`readLiveRevision(liveId)`、`livePayloads: Map<string, unknown>`、`withDefaults(payload)`、`useRequestSequence()`、模組層 `isPlainObject`。
- Produces（後面 Task 依賴）：
  ```ts
  export interface DraftBaseline { source: 'live' | 'first' | 'saved'; payload: Record<string, unknown> | null }
  // ContentEditorState 新增（皆選填，測試用的假 editor 可以不給）：
  draftBaseline?: ComputedRef<DraftBaseline>
  draftChanges?: ComputedRef<FieldChange[]>
  campusKey?: ComputedRef<string | null>
  // useContentItem 回傳新增：draftBaseline、draftChanges、campusKey（共用內容為 null）
  ```

- [ ] **Step 1: 寫失敗的測試**

Create `admin/src/__tests__/editorDraftBaseline.test.ts`:

```ts
// 2026-10-06 方向 D：動作列「草稿有 N 處修改」與段落目錄打點要一直知道和官網差在哪。
// useContentItem 載入後就備好官網那一版（補過預設值）當基準；從沒發布過、讀不到時各有退路。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, ref, type Ref } from 'vue'
import { createPinia } from 'pinia'
import { api, ApiError } from '../api/client'
import { useContentItem } from '../composables/useContentItem'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

interface Faq { title: string; note: string }
type Editor = ReturnType<typeof useContentItem<Faq>>

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
})

function faqItem(overrides: Record<string, unknown> = {}, revision: Record<string, unknown> = {}) {
  return {
    id: 'i1', kind: 'campus_faq', campus_key: 'yihua', latest_version: 2, current_published_revision_id: 'r1',
    latest_revision: { id: 'r2', version: 2, created_at: '2026-10-06T02:00:00Z', payload: { title: '新標題', note: '' }, review_status: 'draft', review_note: null, ...revision },
    ...overrides,
  }
}

// revisions 的值可以是 Promise（模擬晚到的回應）。
function mockApi(items: (path: string) => unknown, revisions: Record<string, unknown> = {}) {
  return vi.spyOn(api, 'get').mockImplementation(((path: string) => {
    if (path.includes('/schedules')) return Promise.resolve([])
    const revision = path.match(/\/revisions\/([^?]+)/)
    if (revision) {
      const id = revision[1]!
      return id in revisions
        ? Promise.resolve(revisions[id]).then((payload) => ({ payload }))
        : Promise.reject(new ApiError(404, '找不到這一版'))
    }
    if (path.includes('/revisions')) return Promise.resolve([])
    return Promise.resolve(items(path))
  }) as typeof api.get)
}

function mountFaq(campus: Ref<string> = ref('yihua')): () => Editor {
  let editor!: Editor
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin')
  const wrapper = mount(defineComponent({
    setup() {
      editor = useContentItem<Faq>('campus_faq', { title: '', note: '' }, campus)
      void editor.load()
      return () => h('div')
    },
  }), { global: { plugins: [pinia] } })
  wrappers.push(wrapper)
  return () => editor
}

describe('動作列與目錄的比對基準（官網那一版）', () => {
  it('官網就是最新一版：不另外讀，改一欄就列一欄', async () => {
    const get = mockApi(() => faqItem({ current_published_revision_id: 'r2' }))
    const editor = mountFaq()
    await flushPromises()
    expect(editor().draftBaseline.value.source).toBe('live')
    expect(editor().draftChanges.value).toEqual([])
    editor().form.value.note = '補充'
    expect(editor().draftChanges.value.map((c) => c.key)).toEqual(['note'])
    expect(get.mock.calls.some(([path]) => String(path).includes('/revisions/'))).toBe(false)
  })

  it('草稿還沒發布：載入時讀一次官網那一版，沒動表單也列出草稿和官網不同的欄位；發布前比對不再重讀', async () => {
    const get = mockApi(() => faqItem(), { r1: { title: '舊標題' } })
    const editor = mountFaq()
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/admin/content-items/campus_faq/revisions/r1?campus_key=yihua')
    // 舊版缺 note：先補預設值才比，不會多出一筆「（空白）→（空白）」。
    expect(editor().draftBaseline.value).toEqual({ source: 'live', payload: { title: '舊標題', note: '' } })
    expect(editor().draftChanges.value.map((c) => [c.key, c.before, c.after])).toEqual([['title', '舊標題', '新標題']])
    await editor().compareWithLive()
    expect(get.mock.calls.filter(([path]) => String(path).includes('/revisions/r1'))).toHaveLength(1)
  })

  it('從沒發布過：基準是 first，不列差異也不讀版本', async () => {
    const get = mockApi(() => faqItem({ current_published_revision_id: null }))
    const editor = mountFaq()
    await flushPromises()
    expect(editor().draftBaseline.value.source).toBe('first')
    editor().form.value.note = '補充'
    expect(editor().draftChanges.value).toEqual([])
    expect(get.mock.calls.some(([path]) => String(path).includes('/revisions/'))).toBe(false)
  })

  it('讀不到官網版：退回和上次儲存比', async () => {
    mockApi(() => faqItem())
    const editor = mountFaq()
    await flushPromises()
    expect(editor().draftBaseline.value.source).toBe('saved')
    expect(editor().draftChanges.value).toEqual([])
    editor().form.value.note = '補充'
    expect(editor().draftChanges.value.map((c) => c.key)).toEqual(['note'])
  })

  it('換校後，上一校晚到的官網版不會變成這一校的基準', async () => {
    let finish!: (payload: unknown) => void
    const slow = new Promise((resolve) => { finish = resolve })
    mockApi((path) => (path.includes('campus_key=minghua')
      ? faqItem({ campus_key: 'minghua', current_published_revision_id: 'm1' }, { id: 'm1', payload: { title: '明華', note: '' } })
      : faqItem()), { r1: slow })
    const campus = ref('yihua')
    const editor = mountFaq(campus)
    await flushPromises()
    campus.value = 'minghua'
    await editor().load()
    await flushPromises()
    finish({ title: '義華舊標題' })
    await flushPromises()
    expect(editor().draftBaseline.value).toEqual({ source: 'live', payload: { title: '明華', note: '' } })
    expect(editor().campusKey.value).toBe('minghua')
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/editorDraftBaseline.test.ts`
Expected: FAIL（`editor().draftBaseline` 是 undefined）。

- [ ] **Step 3: 實作**

在 `useContentItem.ts` 的 `export interface LiveComparison { … }` 之後加：

```ts
/**
 * 動作列「草稿有 N 處修改」與段落目錄打點的比對基準（2026-10-06 方向 D）：
 * live＝官網目前那一版（補過預設值，同發布確認框 compareWithLive 的基準）；
 * first＝從沒發布過，不拿空白比；saved＝官網版還沒讀到或讀不到，退回和上次儲存比。
 */
export interface DraftBaseline {
  source: 'live' | 'first' | 'saved'
  payload: Record<string, unknown> | null
}
```

在 `ContentEditorState` 介面裡（`changes?:` 那一行下面）加：

```ts
  /** 動作列與段落目錄的比對基準（見 DraftBaseline） */
  draftBaseline?: ComputedRef<DraftBaseline>
  /** 表單和 draftBaseline 相比不同的欄位（diffPayload，同發布確認框）；first 時是空陣列 */
  draftChanges?: ComputedRef<FieldChange[]>
  /** 分校內容的校區（共用內容是 null）；右側預覽換校時重建 */
  campusKey?: ComputedRef<string | null>
```

在 `readLiveRevision` 函式之後（`compareWithLive` 之前）加：

```ts
  // 動作列與段落目錄要一直知道「和官網差在哪」（2026-10-06 方向 D，取代 09-28「開確認框前才讀官網版」）：
  // 官網就是最新一版時直接用；不是的話載入、存檔後讀一次官網那一版（版本內容不會再變，記在 livePayloads，
  // 發布確認框也直接用）。換校或重新載入時只採用最後一次的結果。
  const liveBase = ref<Record<string, unknown> | null>(null)
  const liveRequests = useRequestSequence()

  async function refreshLiveBase(): Promise<void> {
    const request = liveRequests.begin()
    const current = item.value
    const liveId = current?.current_published_revision_id
    liveBase.value = null
    if (!current || !liveId) return
    try {
      let payload: unknown = livePayloads.get(liveId)
      if (payload === undefined) {
        payload = liveId === current.latest_revision?.id ? current.latest_revision.payload : await readLiveRevision(liveId)
        if (isPlainObject(payload)) livePayloads.set(liveId, payload)
      }
      if (liveRequests.isCurrent(request) && isPlainObject(payload)) liveBase.value = withDefaults(payload) as Record<string, unknown>
    } catch {
      /* 讀不到官網版：draftBaseline 退回和上次儲存比 */
    }
  }

  watch(
    () => `${unref(campusKey) ?? ''}|${item.value?.current_published_revision_id ?? ''}|${item.value?.latest_revision?.id ?? ''}`,
    () => void refreshLiveBase(),
  )

  const draftBaseline = computed<DraftBaseline>(() => {
    if (item.value && !item.value.current_published_revision_id) return { source: 'first', payload: null }
    if (liveBase.value) return { source: 'live', payload: liveBase.value }
    return { source: 'saved', payload: snapshot.value ? (JSON.parse(snapshot.value) as Record<string, unknown>) : null }
  })
  const draftChanges = computed<FieldChange[]>(() => {
    const base = draftBaseline.value.payload
    return base ? diffPayload(base, form.value as Record<string, unknown>, kind) : []
  })
  const campusKeyRef = computed(() => unref(campusKey) || null)
```

回傳物件（`return { kind, item, form, …`）在 `changes,` 後面加 `draftBaseline, draftChanges, campusKey: campusKeyRef,`。

`compareWithLive` 不用改：它讀同一個 `livePayloads`，載入時已經放進去，所以發布前不會重讀。

- [ ] **Step 4: 改 `ux20260928D.test.ts` 被取代的斷言**

在 `it('發布已存的草稿：讀官網版比對（先補預設值），標題寫出內容與校區'` 裡，把

```ts
    // 載入時不多讀官網版，開確認框前才讀。
    expect(get.mock.calls.some(([path]) => String(path).includes('/revisions/r1'))).toBe(false)

    await button(wrapper, '發布到官網').trigger('click')
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/admin/content-items/campus_faq/revisions/r1?campus_key=yihua')
```

換成

```ts
    // 2026-10-06 方向 D：載入時就讀官網版（動作列要列出和官網不同的欄位），開確認框不再重讀。
    expect(get).toHaveBeenCalledWith('/admin/content-items/campus_faq/revisions/r1?campus_key=yihua')

    await button(wrapper, '發布到官網').trigger('click')
    await flushPromises()
    expect(get.mock.calls.filter(([path]) => String(path).includes('/revisions/r1'))).toHaveLength(1)
```

- [ ] **Step 5: 跑測試確認通過**

Run: `cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/editorDraftBaseline.test.ts src/__tests__/ux20260928D.test.ts src/__tests__/cmsUx20261002.test.ts src/__tests__/adminBugAuditContent20261006.test.ts src/__tests__/editVersionsUx.test.ts src/__tests__/publishingWorkflow.test.ts`
Expected: 全過（後四檔不改，用來確認載入時多讀一次官網版沒有弄壞既有的內容編輯測試；若有測試斷言「載入時不讀版本」或 GET 次數，那是被本計畫裁定 2 取代的舊規則，照 Step 4 的寫法改斷言、在 commit 訊息列出，並把那個測試檔加進 Step 6 的 `git add`）。

- [ ] **Step 6: Commit**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; git add admin/src/composables/useContentItem.ts admin/src/__tests__/editorDraftBaseline.test.ts admin/src/__tests__/ux20260928D.test.ts; git status --short admin/src/__tests__; git commit -F - <<'EOF'
feat(admin): 內容編輯載入後就備好官網版當比對基準

動作列與段落目錄要寫出「和官網差在哪」，useContentItem 新增 draftBaseline／
draftChanges（重用 diffPayload 與 livePayloads 快取），從沒發布過與讀不到官網版各有退路。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 2: 動作列寫出改了哪些欄位，發布確認框不再列改前→改後

**Files:**
- Create: `admin/src/composables/draftSummary.ts`
- Modify: `admin/src/components/ContentEditor.vue`（script：`publishWithConfirm`、新增 `quickSummary`、`summary`；template：`.editor__actions`；style：動作列）
- Create: `admin/src/__tests__/editorActionSummary.test.ts`
- Modify: `admin/src/__tests__/ux20260928D.test.ts`、`admin/src/__tests__/campusProfileSocials.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `DraftBaseline`、`ContentEditorState.draftBaseline`、`draftChanges`。
- Produces:
  ```ts
  // draftSummary.ts
  export const SUMMARY_MAX_FIELDS = 4
  export interface DraftSummary { lead: string; fields: string; title: string }
  export function fieldList(changes: readonly FieldChange[], max?: number): string
  export function draftSummary(source: DraftBaseline['source'], changes: readonly FieldChange[], dirty: boolean): DraftSummary | null
  // ContentEditor.vue（script 內，Task 3 要用）
  const draftChangeList: ComputedRef<FieldChange[]>   // props.editor.draftChanges ?? changes
  ```

- [ ] **Step 1: 寫失敗的測試**

Create `admin/src/__tests__/editorActionSummary.test.ts`:

```ts
// 2026-10-06 方向 D：底部動作列直接寫「草稿有 N 處修改：欄位A、欄位B」，發布確認框只寫欄位名；
// 核准並發布照舊列改前→改後；讀不到官網版時退回舊的差異框。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, ref, type VNode } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus, { ElMessageBox } from 'element-plus'
import ContentEditor from '../components/ContentEditor.vue'
import { draftSummary, fieldList, SUMMARY_MAX_FIELDS } from '../composables/draftSummary'
import type { ContentEditorState, DraftBaseline, FieldChange } from '../composables/useContentItem'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const editorSource = readFileSync(fileURLToPath(new URL('../components/ContentEditor.vue', import.meta.url)), 'utf8')
const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

const change = (key: string, label: string, before = '舊', after = '新'): FieldChange => ({ key, label, before, after })
const baseline = (source: DraftBaseline['source'], payload: Record<string, unknown> | null = {}) => computed<DraftBaseline>(() => ({ source, payload }))

function editorState(overrides: Partial<ContentEditorState> = {}): ContentEditorState {
  return {
    loading: ref(false), loadError: ref(null), saving: ref(false), publishing: ref(false), isPublished: ref(false),
    isDirty: computed(() => false), neverPublished: computed(() => false), latestRevisionAt: computed(() => '2026-10-06T02:00:00Z'),
    load: async () => {}, save: async () => true, saveAndPublish: async () => true, reset: () => {},
    ...overrides,
  }
}

async function mountEditor(editor: ContentEditorState) {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin')
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/')
  await router.isReady()
  const wrapper = mount(ContentEditor, { props: { editor }, global: { plugins: [pinia, router, ElementPlus] }, attachTo: document.body })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

function messageText(message: unknown): string {
  if (typeof message === 'string') return message
  const wrapper = mount(defineComponent({ render: () => message as VNode }))
  const text = wrapper.text()
  wrapper.unmount()
  return text
}

function button(wrapper: VueWrapper, text: string) {
  const found = wrapper.findAll('button').find((b) => b.text().trim() === text)
  if (!found) throw new Error(`找不到按鈕：${text}`)
  return found
}

describe('draftSummary', () => {
  it('和官網比：草稿有 N 處修改，最多列 4 個欄位名，完整清單放 title', () => {
    const five = ['參觀專線', '封面照片', '地址', '校名', '行政區'].map((label, i) => change(`k${i}`, label))
    expect(SUMMARY_MAX_FIELDS).toBe(4)
    expect(draftSummary('live', five.slice(0, 2), false)).toEqual({ lead: '草稿有 2 處修改：', fields: '參觀專線、封面照片', title: '參觀專線、封面照片' })
    expect(fieldList(five)).toBe('參觀專線、封面照片、地址、校名…')
    expect(draftSummary('live', five, false)!.title).toBe('參觀專線、封面照片、地址、校名、行政區')
  })

  it('和官網一樣：沒修改不寫；有修改但改回官網的值時講明還沒儲存', () => {
    expect(draftSummary('live', [], false)).toBeNull()
    expect(draftSummary('live', [], true)!.lead).toBe('內容和官網目前的一樣，還沒儲存。')
  })

  it('從沒發布過、讀不到官網版各有說法', () => {
    expect(draftSummary('first', [], false)!.lead).toBe('還沒發布過，發布後家長才會看到這份內容。')
    expect(draftSummary('saved', [change('tagline', '標語')], true)).toEqual({ lead: '改了 1 個欄位：', fields: '標語', title: '標語' })
    expect(draftSummary('saved', [], true)!.lead).toBe('有未儲存的修改。')
    expect(draftSummary('saved', [], false)).toBeNull()
  })
})

describe('動作列', () => {
  it('沒有未儲存的修改，但草稿和官網不同：照樣寫出欄位（暖黃字），title 是完整清單', async () => {
    const wrapper = await mountEditor(editorState({
      draftBaseline: baseline('live'),
      draftChanges: computed(() => [change('phone', '參觀專線'), change('cover', '封面照片')]),
    }))
    const actions = wrapper.get('.editor__actions')
    expect(actions.classes()).toContain('has-changes')
    expect(actions.get('.editor__actions-text').text()).toBe('草稿有 2 處修改：參觀專線、封面照片')
    expect(actions.get('.editor__actions-text').attributes('title')).toBe('參觀專線、封面照片')
    expect(actions.find('.editor__actions-note').exists()).toBe(false)
  })

  it('和官網一樣、沒有修改：照舊寫儲存與發布的說明', async () => {
    const wrapper = await mountEditor(editorState({ draftBaseline: baseline('live'), draftChanges: computed(() => []) }))
    expect(wrapper.get('.editor__actions').classes()).not.toContain('has-changes')
    expect(wrapper.get('.editor__actions-note').text()).toBe('儲存草稿不會更動官網，發布後才會公開。')
  })

  it('手機也顯示摘要；摘要單行、超出省略', () => {
    const mobile = editorSource.slice(editorSource.indexOf('@media (max-width: 720px)'))
    expect(mobile).toContain('.editor__actions:not(.is-dirty):not(.is-busy):not(.has-changes) .editor__actions-state { display: none; }')
    expect(editorSource).toMatch(/\.editor__actions-text \{[^}]*text-overflow: ellipsis;/)
  })
})

describe('發布確認框', () => {
  it('知道官網版：只寫欄位名，不列改前→改後，也不再讀官網版', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const compareWithLive = vi.fn(async () => null)
    const wrapper = await mountEditor(editorState({
      draftBaseline: baseline('live'),
      draftChanges: computed(() => [change('title', '標題', '舊標題', '新標題')]),
      compareWithLive,
    }))
    await button(wrapper, '發布到官網').trigger('click')
    await flushPromises()
    const [message, , options] = confirm.mock.calls[0]!
    const text = messageText(message)
    expect(text).toContain('和官網目前的內容相比，會更新 1 個欄位：標題。發布後家長立刻看到。')
    expect(text).not.toContain('舊標題')
    expect(compareWithLive).not.toHaveBeenCalled()
    expect((options as { customClass?: string }).customClass).toBeUndefined()
  })

  it('從沒發布過：照舊說第一次上線', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const wrapper = await mountEditor(editorState({ draftBaseline: baseline('first', null), draftChanges: computed(() => []) }))
    await button(wrapper, '發布到官網').trigger('click')
    await flushPromises()
    expect(messageText(confirm.mock.calls[0]![0])).toContain('這是第一次上線')
  })

  it('讀不到官網版（saved）：退回舊的差異框，列改前→改後', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const compareWithLive = vi.fn(async () => ({ firstPublish: false, changes: [change('title', '標題', '舊標題', '新標題')] }))
    const wrapper = await mountEditor(editorState({ draftBaseline: baseline('saved'), draftChanges: computed(() => []), compareWithLive }))
    await button(wrapper, '發布到官網').trigger('click')
    await flushPromises()
    expect(compareWithLive).toHaveBeenCalledOnce()
    expect(messageText(confirm.mock.calls[0]![0])).toContain('舊標題')
  })

  it('核准並發布照舊列完整差異（核准的人不是改的人）', async () => {
    const confirm = vi.spyOn(ElMessageBox, 'confirm').mockRejectedValue('cancel')
    const compareWithLive = vi.fn(async () => ({ firstPublish: false, changes: [change('title', '標題', '舊標題', '新標題')] }))
    const wrapper = await mountEditor(editorState({
      reviewStatus: computed(() => 'pending_review'),
      review: async () => true,
      draftBaseline: baseline('live'),
      draftChanges: computed(() => [change('title', '標題', '舊標題', '新標題')]),
      compareWithLive,
    }))
    await button(wrapper, '核准並發布').trigger('click')
    await flushPromises()
    expect(compareWithLive).toHaveBeenCalledOnce()
    expect(messageText(confirm.mock.calls[0]![0])).toContain('舊標題')
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/editorActionSummary.test.ts`
Expected: FAIL（找不到 `../composables/draftSummary`）。

- [ ] **Step 3: 建 `draftSummary.ts`**

Create `admin/src/composables/draftSummary.ts`:

```ts
import type { DraftBaseline, FieldChange } from './useContentItem'

// 內容編輯底部動作列的那一句（2026-10-06 方向 D）：直接寫「草稿有 N 處修改：欄位A、欄位B」，
// 發布前不用另開差異框。比對基準見 useContentItem 的 DraftBaseline。

/** 動作列一次最多寫幾個欄位名，其餘收成「…」（完整清單放在 title）。 */
export const SUMMARY_MAX_FIELDS = 4

export interface DraftSummary {
  /** 「草稿有 2 處修改：」「改了 1 個欄位：」或一整句說明 */
  lead: string
  /** 欄位名，用「、」串；沒有就是空字串 */
  fields: string
  /** 完整欄位清單（滑過去看得到）；沒有就是空字串 */
  title: string
}

export function fieldList(changes: readonly FieldChange[], max = SUMMARY_MAX_FIELDS): string {
  const labels = changes.map((c) => c.label)
  return labels.length > max ? `${labels.slice(0, max).join('、')}…` : labels.join('、')
}

export function draftSummary(source: DraftBaseline['source'], changes: readonly FieldChange[], dirty: boolean): DraftSummary | null {
  const title = changes.map((c) => c.label).join('、')
  if (source === 'first') return { lead: '還沒發布過，發布後家長才會看到這份內容。', fields: '', title: '' }
  if (source === 'live') {
    if (changes.length) return { lead: `草稿有 ${changes.length} 處修改：`, fields: fieldList(changes), title }
    return dirty ? { lead: '內容和官網目前的一樣，還沒儲存。', fields: '', title: '' } : null
  }
  if (!dirty) return null
  return changes.length ? { lead: `改了 ${changes.length} 個欄位：`, fields: fieldList(changes), title } : { lead: '有未儲存的修改。', fields: '', title: '' }
}
```

- [ ] **Step 4: 改 `ContentEditor.vue` script**

1. import 加：`import { draftSummary } from '../composables/draftSummary'`
2. 在 `const changes = computed(…)` 下一行加：
   ```ts
   // 動作列與目錄打點的清單：和官網那一版比（useContentItem.draftChanges）；舊的假 editor 沒給時用和上次儲存比。
   const draftChangeList = computed(() => props.editor.draftChanges?.value ?? changes.value)
   const baselineSource = computed(() => props.editor.draftBaseline?.value.source ?? 'saved')
   ```
3. 在 `async function publishWithConfirm()` 前面加：
   ```ts
   // 2026-10-06 方向 D：動作列已經寫出和官網不同的欄位，發布確認框只寫欄位名，不再列改前→改後
   //（核准照舊列，核准的人不是改的人）。讀不到官網版（saved）時回 null，退回舊的差異框。
   function quickSummary(verb: string): ConfirmSummary | null {
     if (baselineSource.value === 'first') return { intro: `這是第一次上線：官網目前顯示預設文字，${verb}後家長就會看到這份內容。`, list: [] }
     if (baselineSource.value !== 'live') return null
     const list = draftChangeList.value
     return list.length
       ? { intro: `和官網目前的內容相比，會更新 ${list.length} 個欄位：${list.map((c) => c.label).join('、')}。${verb}後家長立刻看到。`, list: [] }
       : { intro: `內容和官網目前的一樣，${verb}後家長看到的不會改變。`, list: [] }
   }
   ```
4. `publishWithConfirm` 第二行 `const summary = await prepareSummary('發布')` 改成 `const summary = quickSummary('發布') ?? (await prepareSummary('發布'))`。`approve()` 不改。
5. 在 `const actionNote = computed(…)` 之後加：
   ```ts
   // 被退回又沒有修改時，動作列要講「請修改後重新儲存」，不寫摘要。
   const summary = computed(() =>
     rejectedLatest.value && canPublishRole.value && !isDirty.value ? null : draftSummary(baselineSource.value, draftChangeList.value, isDirty.value),
   )
   ```

- [ ] **Step 5: 改 `ContentEditor.vue` template 的動作列**

把 `<div v-if="!readOnly" class="editor__actions" …>` 開頭到 `<el-button v-if="isDirty" text class="editor__discard" …>` 之前的部分換成：

```html
      <div v-if="!readOnly" class="editor__actions" :class="{ 'is-dirty': isDirty, 'is-busy': busy, 'has-changes': Boolean(summary) }">
        <!-- 「放棄修改」放在說明這一側，離儲存、發布遠一點（破壞性動作不與主動作相鄰）。 -->
        <div class="editor__actions-state">
          <p class="editor__actions-text" :title="summary?.title || (isDirty ? actionNote : undefined)">
            <template v-if="busy">正在處理，請稍候…</template>
            <template v-else-if="summary">
              <span class="editor__actions-count">{{ summary.lead }}</span><span v-if="summary.fields" class="editor__actions-fields">{{ summary.fields }}</span>
            </template>
            <span v-else class="editor__actions-note">{{ actionNote }}</span>
          </p>
```

（後面的 `放棄修改` 鈕與 `.editor__buttons` 不動。）

- [ ] **Step 6: 改 `ContentEditor.vue` style**

1. 把 `.editor__actions-state { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 12px; min-width: 0; font-size: var(--text-sm); color: var(--ink-3); }` 換成：
   ```css
   .editor__actions-state { display: flex; align-items: center; flex: 1 1 auto; gap: 4px 12px; min-width: 0; font-size: var(--text-sm); color: var(--ink-3); }
   ```
2. 把 `.editor__actions-text { margin: 0; }` 換成：
   ```css
   .editor__actions-text { margin: 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
   .editor__actions-count { font-weight: 600; }
   ```
3. 把 `.editor__actions.is-dirty .editor__actions-state { color: var(--brand-gold-ink); }` 換成：
   ```css
   .editor__actions.is-dirty .editor__actions-state,
   .editor__actions.has-changes .editor__actions-state { color: var(--brand-gold-ink); }
   ```
4. 刪掉 `.editor__actions.is-dirty .editor__actions-note { display: none; }` 與它上面的兩行註解（摘要和說明現在二選一）。
5. 手機區塊裡 `.editor__actions:not(.is-dirty):not(.is-busy) .editor__actions-state { display: none; }` 換成：
   ```css
     .editor__actions:not(.is-dirty):not(.is-busy):not(.has-changes) .editor__actions-state { display: none; }
   ```

- [ ] **Step 7: 改被取代的舊斷言**

`admin/src/__tests__/campusProfileSocials.test.ts`：`expect(wrapper.text()).toContain('改了 2 個欄位')` 換成 `expect(wrapper.text()).toContain('草稿有 2 處修改：Instagram 網址、YouTube 頻道網址')`。

`admin/src/__tests__/ux20260928D.test.ts`：
1. import 區加 `import { contentFieldLabelFor } from '../api/contentFieldLabels'`。
2. 「發布已存的草稿」那一則把
   ```ts
       expect(text).toContain('和官網目前的內容相比，會更新 1 個欄位')
       expect(text).toContain('舊標題')
       expect(text).toContain('新標題')
   ```
   換成
   ```ts
       // 2026-10-06 方向 D：動作列已列出欄位，確認框只寫欄位名，不再列改前→改後。
       expect(text).toContain(`和官網目前的內容相比，會更新 1 個欄位：${contentFieldLabelFor('campus_faq', 'title')}。`)
       expect(text).not.toContain('舊標題')
   ```
3. 「已存草稿又有新修改」那一則把
   ```ts
       // 和上次儲存相比只改了 1 個欄位，但官網會換掉 2 個。
       expect(wrapper.text()).toContain('改了 1 個欄位')
   ```
   換成
   ```ts
       // 動作列和官網比：已存與未存的修改都算，共 2 處（2026-10-06 方向 D）。
       expect(wrapper.text()).toContain('草稿有 2 處修改：')
   ```

- [ ] **Step 8: 跑測試確認通過**

Run: `cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/editorActionSummary.test.ts src/__tests__/ux20260928D.test.ts src/__tests__/campusProfileSocials.test.ts src/__tests__/publishingWorkflow.test.ts src/__tests__/ux20261005.test.ts`
Expected: 全過（`publishingWorkflow`、`ux20261005` 不改，用來確認核准流程與存草稿並預覽沒壞）。

- [ ] **Step 9: Commit**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; git add admin/src/composables/draftSummary.ts admin/src/components/ContentEditor.vue admin/src/__tests__/editorActionSummary.test.ts admin/src/__tests__/ux20260928D.test.ts admin/src/__tests__/campusProfileSocials.test.ts; git commit -F - <<'EOF'
feat(admin): 動作列寫出草稿和官網不同的欄位，發布確認框只寫欄位名

「草稿有 N 處修改：欄位A、欄位B」取代「改了 N 個欄位」；發布不再另列改前→改後，
核准並發布照舊列完整差異，讀不到官網版時退回舊差異框。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 3: 段落目錄打點、1280 以上移到左側

**Files:**
- Modify: `admin/src/composables/editorSections.ts`
- Modify: `admin/src/components/EditorSectionNav.vue`
- Modify: `admin/src/components/ContentEditor.vue`（狀態列區塊包進 `.editor__top`、傳 `dirty-ids`、1280 格線）
- Create: `admin/src/__tests__/editorSectionDots.test.ts`
- Modify: `admin/src/__tests__/uxRound8Nav.test.ts`

**Interfaces:**
- Consumes: Task 2 的 `draftChangeList`；Task 1 的 `draftBaseline`；`props.editor.form`。
- Produces:
  ```ts
  export interface EditorSection { id: string; label: string; note?: string; fields?: readonly string[] }
  export function dirtySectionIds(sections: readonly EditorSection[], changedKeys: ReadonlySet<string>, base: Record<string, unknown> | null, current: Record<string, unknown>): string[]
  // EditorSectionNav 新 prop：dirtyIds?: readonly string[]
  // ContentEditor DOM：.editor__layout > .editor__top（狀態列到唯讀說明）、.editor__nav、.editor__body
  ```

- [ ] **Step 1: 寫失敗的測試**

Create `admin/src/__tests__/editorSectionDots.test.ts`:

```ts
// 2026-10-06 方向 D：段落目錄固定在左、和官網不同的段落打點（和動作列「草稿有 N 處修改」同一個基準）。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, h, ref } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import ContentEditor from '../components/ContentEditor.vue'
import EditorSectionNav from '../components/EditorSectionNav.vue'
import { dirtySectionIds, type EditorSection } from '../composables/editorSections'
import type { ContentEditorState, DraftBaseline } from '../composables/useContentItem'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

const SECTIONS: EditorSection[] = [
  { id: 'basic', label: '基本資料', fields: ['name', 'phone'] },
  { id: 'social', label: '社群', fields: ['line'] },
  { id: 'p0', label: '第一段', fields: ['title', 'sections.0'] },
  { id: 'p1', label: '第二段', fields: ['sections.1'] },
]

describe('dirtySectionIds', () => {
  it('最外層欄位改了，那一段打點', () => {
    expect(dirtySectionIds(SECTIONS, new Set(['phone']), { phone: '1' }, { phone: '2' })).toEqual(['basic'])
  })

  it('清單只看自己那一項：改第二項只點第二段', () => {
    const base = { sections: [{ h: 'a' }, { h: 'b' }] }
    const current = { sections: [{ h: 'a' }, { h: 'B' }] }
    expect(dirtySectionIds(SECTIONS, new Set(['sections']), base, current)).toEqual(['p1'])
  })

  it('沒有基準（從沒發布過）時 changedKeys 是空的，不打點', () => {
    expect(dirtySectionIds(SECTIONS, new Set(), null, { phone: '2' })).toEqual([])
  })

  it('沒寫 fields 的段落永遠不打點', () => {
    expect(dirtySectionIds([{ id: 'x', label: '舊段落' }], new Set(['phone']), {}, {})).toEqual([])
  })
})

describe('EditorSectionNav 打點', () => {
  it('dirtyIds 裡的段落有點與報讀文字，其他沒有', () => {
    const wrapper = mount(EditorSectionNav, { props: { sections: SECTIONS.slice(0, 2), dirtyIds: ['basic'] } })
    wrappers.push(wrapper)
    const [basic, social] = wrapper.findAll('a')
    expect(basic!.find('.section-nav__dot').exists()).toBe(true)
    expect(basic!.get('.visually-hidden').text()).toBe('（有修改）')
    expect(social!.find('.section-nav__dot').exists()).toBe(false)
  })

  it('桌機樣式：目前段落用淺色主色底，不用 2px 左框', () => {
    const nav = read('../components/EditorSectionNav.vue')
    const desktop = /@media \(min-width: 1280px\) \{[^@]*\}/.exec(nav)![0]
    expect(desktop).toContain('background: var(--el-color-primary-light-9)')
    expect(desktop).not.toMatch(/border-left/)
    expect(nav).toMatch(/\.section-nav__dot \{[^}]*background: var\(--brand-gold\);/)
  })
})

describe('ContentEditor 把打點傳給目錄、目錄在左', () => {
  it('和官網不同的段落打點', async () => {
    const pinia = createPinia()
    useAuthStore(pinia).user = testUser('super_admin')
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
    await router.push('/')
    await router.isReady()
    const editor: ContentEditorState = {
      loading: ref(false), loadError: ref(null), saving: ref(false), publishing: ref(false), isPublished: ref(false),
      isDirty: computed(() => true), neverPublished: computed(() => false), latestRevisionAt: computed(() => '2026-10-06T02:00:00Z'),
      load: async () => {}, save: async () => true, saveAndPublish: async () => true, reset: () => {},
      form: ref({ name: '義華校', phone: '07-000-0000', line: 'https://lin.ee/a' }),
      draftBaseline: computed<DraftBaseline>(() => ({ source: 'live', payload: { name: '義華校', phone: '07-392-8366', line: 'https://lin.ee/a' } })),
      draftChanges: computed(() => [{ key: 'phone', label: '參觀專線', before: '07-392-8366', after: '07-000-0000' }]),
    }
    const wrapper = mount(ContentEditor, {
      props: { editor, sections: SECTIONS.slice(0, 2) },
      slots: { default: () => [h('h3', { id: 'basic' }, '基本資料'), h('h3', { id: 'social' }, '社群')] },
      global: { plugins: [pinia, router, ElementPlus] },
      attachTo: document.body,
    })
    wrappers.push(wrapper)
    await flushPromises()
    const dotted = wrapper.findAll('.section-nav a').filter((a) => a.find('.section-nav__dot').exists()).map((a) => a.get('.section-nav__label').text())
    expect(dotted).toEqual(['基本資料'])
    // 狀態列在 .editor__top 裡（1280 以上排在中欄頂端）。
    expect(wrapper.get('.editor__layout > .editor__top .editor__status').exists()).toBe(true)
  })

  it('1280 以上目錄在左：nav top / nav body', () => {
    const editor = read('../components/ContentEditor.vue')
    const desktop = /@media \(min-width: 1280px\) \{[^@]*\}/.exec(editor)![0]
    expect(desktop).toContain("grid-template-areas: 'nav top' 'nav body'")
    expect(desktop).toContain('grid-template-columns: 184px minmax(0, 1fr)')
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/editorSectionDots.test.ts`
Expected: FAIL（`dirtySectionIds` 不存在）。

- [ ] **Step 3: 改 `editorSections.ts`**

`EditorSection` 介面加一個欄位，檔尾加兩個函式：

```ts
  /**
   * 這一段編輯的欄位（2026-10-06 方向 D）：最外層欄位（'phone'）或清單的某一項（'sections.2'）。
   * 和官網那一版不同時，目錄在這一段打點。新增欄位要一併分段（editorSectionFields.test.ts 守門）。
   */
  fields?: readonly string[]
```

```ts
function valueAt(source: Record<string, unknown> | null, path: string): unknown {
  let current: unknown = source
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * 和比對基準不同的段落（同動作列「草稿有 N 處修改」）：changedKeys 是 draftChanges 的欄位鍵；
 * 寫到清單某一項的 field 再比那一項本身，其他項改了不算這一段。
 */
export function dirtySectionIds(
  sections: readonly EditorSection[],
  changedKeys: ReadonlySet<string>,
  base: Record<string, unknown> | null,
  current: Record<string, unknown>,
): string[] {
  return sections
    .filter((section) =>
      (section.fields ?? []).some((field) => {
        const top = field.split('.')[0]!
        if (!changedKeys.has(top)) return false
        return field === top || JSON.stringify(valueAt(base, field)) !== JSON.stringify(valueAt(current, field))
      }),
    )
    .map((section) => section.id)
}
```

- [ ] **Step 4: 改 `EditorSectionNav.vue`**

1. props 改成 `const props = defineProps<{ sections: EditorSection[]; dirtyIds?: readonly string[] }>()`，加 `const dirty = computed(() => new Set(props.dirtyIds ?? []))`（import `computed`）。開頭註解第一句改成「長編輯頁的段落目錄：桌機（1280 以上）在表單左側黏住、和官網不同的段落打點，窄螢幕是表單上方一排可以橫捲的膠囊。」
2. `<a>` 裡 `section-nav__note` 那一行後面加：
   ```html
          <template v-if="dirty.has(section.id)"><span class="section-nav__dot" aria-hidden="true" /><span class="visually-hidden">（有修改）</span></template>
   ```
3. style：`.section-nav__note` 那一行後面加
   ```css
   .section-nav__dot { flex: none; width: 6px; height: 6px; margin-left: auto; border-radius: 50%; background: var(--brand-gold); box-shadow: 0 0 0 1px var(--brand-gold-ink); }
   ```
   並把整個 `@media (min-width: 1280px) { … }` 換成：
   ```css
   @media (min-width: 1280px) {
     .section-nav { position: sticky; top: 88px; margin: 0; }
     .section-nav__title { display: block; margin: 0 0 6px; font-size: var(--text-xs); color: var(--ink-3); }
     .section-nav ol { flex-direction: column; gap: 2px; overflow: visible; padding: 0; }
     .section-nav a { display: flex; min-height: 36px; padding: 6px 10px; border: 0; border-radius: var(--radius); background: none; white-space: normal; }
     .section-nav a[aria-current] { background: var(--el-color-primary-light-9); color: var(--admin-accent-hover); }
   }
   ```

- [ ] **Step 5: 改 `ContentEditor.vue`**

1. import 改成 `import { dirtySectionIds, MIN_NAV_SECTIONS, type EditorSection } from '../composables/editorSections'`。
2. 在 Task 2 新增的 `draftChangeList`／`baselineSource` 兩行下面加（它用到 `draftChangeList`，不能放在前面）：
   ```ts
   // 目錄打點：和動作列同一個基準（官網那一版；讀不到時和上次儲存比）。
   const dirtySections = computed(() => {
     const keys = new Set(draftChangeList.value.map((c) => c.key))
     const base = props.editor.draftBaseline?.value.payload ?? null
     const current = (props.editor.form?.value ?? {}) as Record<string, unknown>
     return dirtySectionIds(navSections.value, keys, base, current)
   })
   ```
3. template 的 `<template v-else>`：在 `<!-- 狀態列不是即時區…` 那一行前面開 `<div class="editor__layout" :class="{ 'has-nav': hasNav }">` 與 `<div class="editor__top">`；在 `<p v-if="readOnly" class="editor__readonly" role="note">…</p>` 之後關 `</div>`（`.editor__top`），中間的狀態列、visually-hidden status、排程、衝突、套回、錯誤清單、`RevisionHistoryDrawer`、唯讀說明原封不動。接著把原本的
   ```html
         <div class="editor__layout" :class="{ 'has-nav': hasNav }">
           <!-- 目錄在表單外面：處理中表單 inert 時目錄仍可用來捲動。 -->
           <EditorSectionNav v-if="hasNav" :sections="navSections" class="editor__nav" />
   ```
   換成
   ```html
           <!-- 目錄在表單外面：處理中表單 inert 時目錄仍可用來捲動。 -->
           <EditorSectionNav v-if="hasNav" :sections="navSections" :dirty-ids="dirtySections" class="editor__nav" />
   ```
   （外層的 `.editor__layout` 已經在前面開了；`.editor__body` 與它的結尾 `</div>`、`.editor__layout` 的結尾 `</div>` 維持原位。）
4. style：把 `/* 段落目錄：1280 以上放在表單右側…` 註解與它下面整個 `@media (min-width: 1280px) { … }` 換成：
   ```css
   /* 段落目錄（2026-10-06 方向 D）：1280 以上一律在左側一欄，狀態列與表單在右（表單仍是 720 寬）；
      較窄時目錄在狀態列與表單之間，是一排可以橫捲的膠囊。 */
   @media (min-width: 1280px) {
     .editor--with-nav:not(.editor--wide):not(.editor--preview) { max-width: 928px; }
     .editor__layout.has-nav { display: grid; grid-template-columns: 184px minmax(0, 1fr); grid-template-areas: 'nav top' 'nav body'; column-gap: 24px; align-items: start; }
     .editor__layout.has-nav > .editor__top { grid-area: top; min-width: 0; }
     .editor__layout.has-nav > .editor__nav { grid-area: nav; }
     .editor__layout.has-nav > .editor__body { grid-area: body; min-width: 0; }
   }
   ```

- [ ] **Step 6: 改 `uxRound8Nav.test.ts` 被取代的斷言**

`it('ContentEditor：至少兩段才放目錄；桌機 1280 以上表單右側一欄，窄螢幕在表單上方'` 改名為 `'ContentEditor：至少兩段才放目錄；桌機 1280 以上在左側一欄（2026-10-06 方向 D），窄螢幕在表單上方'`，裡面把
```ts
    expect(editor).toMatch(/<EditorSectionNav v-if="hasNav" :sections="navSections" class="editor__nav" \/>/)
    const desktop = /@media \(min-width: 1280px\) \{[^@]*\}/.exec(editor)![0]
    expect(desktop).toContain('grid-template-columns: minmax(0, 1fr) 184px')
    expect(desktop).toContain('.editor--with-nav:not(.editor--wide) { max-width: 928px; }')
```
換成
```ts
    expect(editor).toMatch(/<EditorSectionNav v-if="hasNav" :sections="navSections" :dirty-ids="dirtySections" class="editor__nav" \/>/)
    const desktop = /@media \(min-width: 1280px\) \{[^@]*\}/.exec(editor)![0]
    expect(desktop).toContain("grid-template-areas: 'nav top' 'nav body'")
    expect(desktop).toContain('.editor--with-nav:not(.editor--wide):not(.editor--preview) { max-width: 928px; }')
```

- [ ] **Step 7: 跑測試確認通過**

Run: `cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/editorSectionDots.test.ts src/__tests__/uxRound8Nav.test.ts src/__tests__/ux20261005.test.ts src/__tests__/ux20260928D.test.ts`
Expected: 全過。

- [ ] **Step 8: Commit**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; git add admin/src/composables/editorSections.ts admin/src/components/EditorSectionNav.vue admin/src/components/ContentEditor.vue admin/src/__tests__/editorSectionDots.test.ts admin/src/__tests__/uxRound8Nav.test.ts; git commit -F - <<'EOF'
feat(admin): 段落目錄移到左側、和官網不同的段落打點

EditorSection 新增 fields（最外層欄位或清單某一項），dirtySectionIds 和動作列同一個基準；
目前段落改用淺色主色底，拿掉 2px 左框。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 4: 五校介紹新增段落目錄、三個頁面段落標上欄位

**Files:**
- Modify: `admin/src/views/CampusProfileView.vue`
- Modify: `admin/src/views/HomeNewsView.vue`、`admin/src/views/CampusNewsView.vue`、`admin/src/views/DayExperienceView.vue`
- Create: `admin/src/__tests__/editorSectionFields.test.ts`

**Interfaces:**
- Consumes: Task 3 的 `EditorSection.fields`、打點 DOM（`.section-nav__dot`、`.section-nav__label`）。
- Produces: `editorSectionFields.test.ts` 的 `CASES` 陣列（Task 5 往裡面加四筆）。

- [ ] **Step 1: 寫失敗的測試**

Create `admin/src/__tests__/editorSectionFields.test.ts`:

```ts
// 2026-10-06 方向 D：段落目錄打點靠每段的 fields。每個有目錄的編輯頁，表單的每個欄位都要分到某一段，
// 改了那一欄，目錄上那一段就打點。新增欄位忘了分段，這支測試會擋。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, type Component } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import { api } from '../api/client'
import type { UserOut } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'
import type { EditorSection } from '../composables/editorSections'
import type { ContentEditorState } from '../composables/useContentItem'
import { resetTitleFontCoverage } from '../composables/useTitleFontCoverage'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'
import CampusProfileView from '../views/CampusProfileView.vue'
import HomeNewsView from '../views/HomeNewsView.vue'
import CampusNewsView from '../views/CampusNewsView.vue'
import DayExperienceView from '../views/DayExperienceView.vue'

const wrappers: VueWrapper[] = []
const originalScroll = Element.prototype.scrollIntoView
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  Element.prototype.scrollIntoView = originalScroll
  document.body.innerHTML = ''
})

interface Case {
  name: string
  component: Component
  kind: string
  campusKey: string | null
  /** 已存（也是官網）的內容；{} 表示全用編輯頁的預設值 */
  payload: Record<string, unknown>
  /** 改一欄（整個最外層欄位換成 value），目錄上應該打點的那一段 */
  edit?: { key: string; value: unknown; section: string }
}

const CASES: Case[] = [
  { name: '五校介紹', component: CampusProfileView, kind: 'campus_profile', campusKey: 'yihua', payload: {}, edit: { key: 'phone', value: '07-000-0000', section: '基本資料' } },
  { name: '最新消息與活動', component: HomeNewsView, kind: 'home_news', campusKey: null, payload: {}, edit: { key: 'home_display_count', value: 3, section: '最新消息' } },
  { name: '各校消息與活動', component: CampusNewsView, kind: 'campus_news', campusKey: 'yihua', payload: {} },
  { name: '孩子的一天', component: DayExperienceView, kind: 'day_experience', campusKey: null, payload: {}, edit: { key: 'note', value: '新的說明', section: '背景影片' } },
]

async function mountCase(c: Case) {
  Element.prototype.scrollIntoView = () => {}
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }) as never)
  resetTitleFontCoverage()
  vi.spyOn(api, 'get').mockImplementation((async (path: string) => {
    if (path.startsWith(`/admin/content-items/${c.kind}`) && !path.includes('/schedules') && !path.includes('/revisions')) {
      return {
        id: `${c.kind}-item`, kind: c.kind, campus_key: c.campusKey, latest_version: 1, current_published_revision_id: 'rev-1',
        latest_revision: { id: 'rev-1', version: 1, created_at: '2026-10-06T00:00:00Z', payload: c.payload, review_status: 'draft', review_note: null },
      }
    }
    return []
  }) as typeof api.get)
  const pinia = createPinia()
  const user: UserOut = c.campusKey
    ? testUser('campus_admin', { id: 'me', email: 'me@example.invalid', campus_keys: [c.campusKey] })
    : testUser('super_admin', { id: 'me', email: 'me@example.invalid' })
  useAuthStore(pinia).user = user
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push(c.campusKey ? `/?campus=${c.campusKey}` : '/')
  await router.isReady()
  const wrapper = mount(c.component, {
    attachTo: document.body,
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  })
  wrappers.push(wrapper)
  await flushPromises()
  const shell = wrapper.findComponent(ContentEditor)
  return { wrapper, sections: shell.props('sections') as EditorSection[], editor: shell.props('editor') as ContentEditorState }
}

describe.each(CASES)('$name：段落目錄的欄位', (c) => {
  it('表單每個欄位都分到某一段，最外層欄位不重複', async () => {
    const { sections, editor } = await mountCase(c)
    expect(sections.length).toBeGreaterThanOrEqual(2)
    const keys = Object.keys(editor.form!.value as Record<string, unknown>)
    const covered = new Set(sections.flatMap((s) => (s.fields ?? []).map((f) => f.split('.')[0]!)))
    expect(keys.filter((key) => !covered.has(key))).toEqual([])
    const plain = sections.flatMap((s) => (s.fields ?? []).filter((f) => !f.includes('.')))
    expect(new Set(plain).size).toBe(plain.length)
  })

  it.runIf(Boolean(c.edit))('改了一欄，目錄上那一段打點', async () => {
    const { wrapper, editor } = await mountCase(c)
    ;(editor.form!.value as Record<string, unknown>)[c.edit!.key] = c.edit!.value
    await flushPromises()
    const links = wrapper.get('nav[aria-label="這一頁的段落"]').findAll('a')
    const dotted = links.filter((a) => a.find('.section-nav__dot').exists()).map((a) => a.get('.section-nav__label').text())
    expect(dotted).toEqual([c.edit!.section])
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/editorSectionFields.test.ts`
Expected: FAIL（五校介紹沒有 sections；其他頁沒有 fields）。

- [ ] **Step 3: `CampusProfileView.vue` 加三段目錄**

script：import 加 `import type { EditorSection } from '../composables/editorSections'`（`computed` 已 import 就不重複）。在 `const editor = useContentItem…` 之後加：

```ts
// 段落目錄（2026-10-06 方向 D）：每段列出它編輯的欄位，和官網不同時目錄打點。
// intro、description 官網已不顯示（分校頁拿掉），fb_note 後台不列，都算在原本所在的那一段。
const navSections = computed<EditorSection[]>(() => [
  { id: 'section-profile-basic', label: '基本資料', fields: ['name', 'district', 'address', 'map_url', 'phone', 'intro', 'description'] },
  { id: 'section-profile-cover', label: '封面照片與建築線稿', fields: ['cover', 'card_focus', 'hero_focus', 'line_art', 'line_art_colour'] },
  { id: 'section-profile-social', label: '社群', fields: ['facebook', 'fb_note', 'line', 'instagram', 'youtube'] },
])
```

template：`<ContentEditor` 加 `:sections="navSections"`；在 `<el-form …>` 裡第一個 `<div class="field-row">` 前面加 `<h3 id="section-profile-basic" class="form-section form-section--first" data-section-anchor tabindex="-1">基本資料</h3>`；`<h3 class="form-section">封面照片與建築線稿</h3>` 改成 `<h3 id="section-profile-cover" class="form-section" data-section-anchor tabindex="-1">封面照片與建築線稿</h3>`；`<h3 class="form-section">社群</h3>` 改成 `<h3 id="section-profile-social" class="form-section" data-section-anchor tabindex="-1">社群</h3>`。style 加：

```css
.form-section--first {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}
```

- [ ] **Step 4: 三個頁面的段落加 `fields`**

`HomeNewsView.vue` 的 `navSections`：

```ts
const navSections = computed<EditorSection[]>(() => [
  { id: NEWS_SECTION_IDS.articles, label: '最新消息', note: `${editor.form.value.articles.length} 則`, fields: ['sample_note', 'home_display_count', 'articles'] },
  { id: NEWS_SECTION_IDS.events, label: '近期活動', note: `${editor.form.value.events.length} 場`, fields: ['events'] },
  { id: 'section-news-films', label: '手機版活動影片', fields: ['films'] },
])
```

`CampusNewsView.vue` 的 `navSections`：

```ts
const navSections = computed<EditorSection[]>(() => [
  { id: NEWS_SECTION_IDS.articles, label: '最新消息', note: `${editor.form.value.articles.length} 則`, fields: ['articles'] },
  { id: NEWS_SECTION_IDS.events, label: '近期活動', note: `${editor.form.value.events.length} 場`, fields: ['events'] },
])
```

`DayExperienceView.vue` 的 `navSections`（第一個段落標題之前的眉標、說明算進第一段；`source_note` 後台不列，也算第一段）：

```ts
const navSections = computed<EditorSection[]>(() => [
  {
    id: 'section-day-film',
    label: '背景影片',
    fields: ['eyebrow', 'eyebrow_en', 'note', 'source_note', 'film_desktop', 'film_mobile', 'film_poster', 'film_caption_zh', 'film_caption_en'],
  },
  { id: 'section-day-moments', label: '時刻卡', note: `${editor.form.value.moments.length} 張`, fields: ['moments'] },
])
```

如果測試列出漏掉的欄位（例如之後新增的鍵），規則是：放進表單上「它前面最近的那個段落標題」那一段；在第一個段落標題之前的欄位放第一段。

- [ ] **Step 5: 跑測試確認通過**

Run: `cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/editorSectionFields.test.ts src/__tests__/campusProfileSocials.test.ts src/__tests__/uxRound8Nav.test.ts src/__tests__/homeNews.test.ts`
Expected: 全過。

- [ ] **Step 6: Commit**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; git add admin/src/views/CampusProfileView.vue admin/src/views/HomeNewsView.vue admin/src/views/CampusNewsView.vue admin/src/views/DayExperienceView.vue admin/src/__tests__/editorSectionFields.test.ts; git commit -F - <<'EOF'
feat(admin): 五校介紹加段落目錄，消息與孩子的一天段落標上欄位

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 5: 整頁內容與隱私權政策的段落標上欄位

**Files:**
- Modify: `admin/src/views/AboutPageView.vue`、`admin/src/views/CurriculumPageView.vue`、`admin/src/views/AdmissionContentView.vue`、`admin/src/views/PrivacyPolicyView.vue`
- Modify: `admin/src/__tests__/editorSectionFields.test.ts`（`CASES` 加四筆、import 四個 view）

**Interfaces:**
- Consumes: Task 4 的 `CASES` 結構與 `mountCase`。

- [ ] **Step 1: 測試加四筆（先失敗）**

`editorSectionFields.test.ts` import 區加：

```ts
import AboutPageView from '../views/AboutPageView.vue'
import CurriculumPageView from '../views/CurriculumPageView.vue'
import AdmissionContentView from '../views/AdmissionContentView.vue'
import PrivacyPolicyView from '../views/PrivacyPolicyView.vue'
```

`CASES` 陣列尾端加：

```ts
  { name: '關於常春藤頁', component: AboutPageView, kind: 'about_page', campusKey: null, payload: {}, edit: { key: 'story_title', value: '新的章名', section: '第一章：一路走來' } },
  { name: '特色教學頁', component: CurriculumPageView, kind: 'curriculum_page', campusKey: null, payload: {}, edit: { key: 'gallery_title', value: '新的美術館', section: '03 兒童美術館' } },
  { name: '入學資訊頁', component: AdmissionContentView, kind: 'admission_content', campusKey: null, payload: {}, edit: { key: 'fee_intro', value: '新的說明', section: '收退費辦法' } },
  {
    name: '隱私權政策',
    component: PrivacyPolicyView,
    kind: 'privacy_policy',
    campusKey: null,
    payload: { title: '隱私權政策', updated_on: null, sections: [{ heading: '一、蒐集目的', body: '內文' }, { heading: '二、利用期間', body: '內文' }] },
    // 只改第二段：只點第二段，第一段（也管 title／updated_on）不點。
    edit: { key: 'sections', value: [{ heading: '一、蒐集目的', body: '內文' }, { heading: '二、利用期間', body: '改過的內文' }], section: '二、利用期間' },
  },
```

Run: `cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/editorSectionFields.test.ts`
Expected: 新的四組 FAIL（欄位沒有分段）。

- [ ] **Step 2: 四個頁面的段落加 `fields`**

`AboutPageView.vue`：

```ts
const navSections = computed<EditorSection[]>(() => [
  { id: 'section-about-hero', label: '首屏', fields: ['hero_title', 'hero_lede', 'hero_caption', 'hero_photo', 'hero_photo_alt', 'hero_back_photo', 'hero_back_photo_alt'] },
  { id: 'section-about-chapters', label: '章名', fields: ['chapter_names'] },
  { id: 'section-about-story', label: '第一章：一路走來', fields: ['story_title', 'story_text', 'milestones'] },
  { id: 'section-about-whole', label: '第二章：全人教育', fields: ['whole_title', 'whole_text', 'whole_fine', 'whole_fine_source'] },
  { id: 'section-about-hope', label: '第三章：我們的期許', fields: ['hope_title', 'hope_quotes', 'hope_photo', 'hope_photo_alt'] },
  { id: 'section-about-outro', label: '結尾：五所校園', fields: ['outro_title', 'outro_text'] },
])
```

`CurriculumPageView.vue`：

```ts
const navSections = computed<EditorSection[]>(() => [
  { id: 'section-cur-hero', label: '首屏', fields: ['hero_eyebrow', 'hero_title', 'hero_highlight', 'hero_lede', 'hero_notice', 'hero_photo', 'hero_photo_alt'] },
  { id: 'section-cur-chapters', label: '章節索引', fields: ['chapters'] },
  { id: 'section-cur-years', label: '01 四個年段', fields: ['years_title', 'years_text', 'spiral_label', 'spiral_text', 'years_photo', 'years_photo_alt', 'years_caption', 'years'] },
  { id: 'section-cur-directions', label: '02 課程方向', fields: ['directions_title', 'directions_text', 'directions'] },
  { id: 'section-cur-gallery', label: '03 兒童美術館', fields: ['gallery_title', 'gallery_text', 'gallery_source', 'gallery'] },
  { id: 'section-cur-daily', label: '04 五件事', fields: ['daily_title', 'daily_text', 'daily_source', 'daily'] },
  { id: 'section-cur-beliefs', label: '結尾：教學理念', fields: ['belief_title', 'beliefs', 'belief_close', 'belief_source'] },
])
```

`AdmissionContentView.vue`（`notice`、`intro` 在第一個段落標題之前，算第一段）：

```ts
const navSections = computed<EditorSection[]>(() => [
  { id: 'section-admission-steps', label: '入學流程', note: `${form.value.steps.length} 步`, fields: ['notice', 'intro', 'steps'] },
  { id: 'section-admission-phases', label: '新生入園須知', note: `${form.value.phases.length} 個階段`, fields: ['phases', 'uniform_note', 'uniform_week', 'pickup_notes', 'registration_notes'] },
  { id: 'section-admission-fees', label: '收退費辦法', fields: ['fee_intro', 'subsidies', 'allowance_title', 'allowance_note', 'allowance', 'refunds'] },
])
```

`PrivacyPolicyView.vue`（第一段也管標題與更新日期）：

```ts
const navSections = computed<EditorSection[]>(() =>
  sections.value.map((section, index) => ({
    id: `policy-section-${index}`,
    label: section.heading.trim() || `第 ${index + 1} 段`,
    fields: index === 0 ? ['title', 'updated_on', `sections.${index}`] : [`sections.${index}`],
  })),
)
```

- [ ] **Step 3: 跑測試確認通過**

Run: `cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/editorSectionFields.test.ts src/__tests__/aboutPage.test.ts src/__tests__/curriculumPage.test.ts src/__tests__/admissionContent.test.ts src/__tests__/privacyPolicy.test.ts`
Expected: 全過。

- [ ] **Step 4: Commit**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; git add admin/src/views/AboutPageView.vue admin/src/views/CurriculumPageView.vue admin/src/views/AdmissionContentView.vue admin/src/views/PrivacyPolicyView.vue admin/src/__tests__/editorSectionFields.test.ts; git commit -F - <<'EOF'
feat(admin): 整頁內容與隱私權政策的段落標上欄位

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 6: 預覽分頁對照表與右側預覽欄元件

**Files:**
- Create: `admin/src/composables/previewTargets.ts`
- Create: `admin/src/components/LivePreviewPane.vue`
- Create: `admin/src/__tests__/livePreviewPane.test.ts`

**Interfaces:**
- Produces（Task 7、11、12 依賴）：
  ```ts
  export type PreviewPage = 'home' | 'admission' | 'visit' | 'privacy' | 'curriculum' | 'about' | 'environment'
  export type PreviewBlock = 'home-hero' | 'home-about' | 'home-day' | 'home-campuses' | 'home-news' | 'site-header' | 'site-footer' | 'visit-booking' | 'page-top'
  export type PreviewViewport = 'desktop' | 'mobile'
  export type PreviewPaneState = 'connecting' | 'live' | 'saved' | 'failed'
  export interface PreviewTarget { id: string; label: string; page: PreviewPage; block: PreviewBlock; fields?: readonly string[] }
  export const PREVIEW_TARGETS: Readonly<Record<string, readonly PreviewTarget[]>>
  export function previewTargetsFor(kind: string | undefined): readonly PreviewTarget[]
  export function livePreviewOrigin(base?: string, here?: Pick<Location, 'href' | 'origin'>): string | null
  export function previewFrameUrl(origin: string, page: PreviewPage, options: { live: boolean }): string
  export const PREVIEW_FRAME_WIDTH: Readonly<Record<PreviewViewport, number>>   // desktop 1280、mobile 390
  export function fitPreviewFrame(stage: { width: number; height: number }, viewport: PreviewViewport, padding?: number): { width: number; height: number; scale: number }
  export const PREVIEW_VIEWPORT_KEY = 'ivy-admin-preview-viewport'
  export function readPreviewViewport(): PreviewViewport
  export function rememberPreviewViewport(value: PreviewViewport): void
  ```
  `LivePreviewPane.vue`：props `targets`、`src`、`state: PreviewPaneState`、`frameKey: string`；`v-model:target`（string）、`v-model:viewport`（PreviewViewport）；emits `frame(el: HTMLIFrameElement | null)`、`retry()`。

- [ ] **Step 1: 寫失敗的測試**

Create `admin/src/__tests__/livePreviewPane.test.ts`:

```ts
// 2026-10-06 方向 D：內容編輯右側官網預覽的分頁對照表、同源判斷、縮放與外觀。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import LivePreviewPane from '../components/LivePreviewPane.vue'
import {
  fitPreviewFrame,
  livePreviewOrigin,
  PREVIEW_FRAME_WIDTH,
  PREVIEW_TARGETS,
  PREVIEW_VIEWPORT_KEY,
  previewFrameUrl,
  previewTargetsFor,
  readPreviewViewport,
  rememberPreviewViewport,
} from '../composables/previewTargets'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  localStorage.clear()
})

// 15 個用 ContentEditor 的編輯頁（router/nav.ts 的官網內容三組）。
const EDITOR_KINDS = [
  'home_hero', 'home_about', 'day_experience', 'home_campus_board', 'home_news',
  'campus_profile', 'campus_news', 'campus_tour',
  'booking_content', 'admission_content', 'privacy_policy', 'curriculum_page', 'about_page', 'site_footer', 'site_meta',
]

describe('預覽分頁對照表', () => {
  it('15 個編輯頁都有列；只有校園探索沒有預覽欄；同一頁的分頁代號不重複', () => {
    expect(Object.keys(PREVIEW_TARGETS).sort()).toEqual([...EDITOR_KINDS].sort())
    for (const kind of EDITOR_KINDS) {
      const targets = previewTargetsFor(kind)
      if (kind === 'campus_tour') expect(targets).toEqual([])
      else expect(targets.length).toBeGreaterThan(0)
      expect(new Set(targets.map((t) => t.id)).size).toBe(targets.length)
    }
    expect(previewTargetsFor(undefined)).toEqual([])
    expect(previewTargetsFor('shared_faq')).toEqual([])
  })

  it('五校介紹：首頁五校與頁尾；預約文案與網站標題只對看得到的欄位', () => {
    expect(previewTargetsFor('campus_profile').map((t) => [t.label, t.page, t.block])).toEqual([['首頁五校', 'home', 'home-campuses'], ['頁尾', 'home', 'site-footer']])
    expect(previewTargetsFor('booking_content').map((t) => t.fields)).toEqual([['privacy_title', 'privacy_sections'], ['cta_label', 'cta_label_en']])
    expect(previewTargetsFor('site_meta')[0]!.fields).toEqual(['header_phone_number', 'header_phone_note', 'primary_nav'])
  })
})

describe('同源才嵌、iframe 網址、縮放', () => {
  const here = { href: 'https://ivy.example/admin/content/site-footer', origin: 'https://ivy.example' }

  it('正式站（空字串）與同網域：回同一個 origin；本機 5173 對 3000：不嵌', () => {
    expect(livePreviewOrigin('', here)).toBe('https://ivy.example')
    expect(livePreviewOrigin('https://ivy.example', here)).toBe('https://ivy.example')
    expect(livePreviewOrigin('http://127.0.0.1:3000', { href: 'http://localhost:5173/admin/', origin: 'http://localhost:5173' })).toBeNull()
    expect(livePreviewOrigin('not a url ::', { href: 'nope', origin: 'null' })).toBeNull()
  })

  it('網址只帶 embed、live、page，不帶任何內容', () => {
    expect(previewFrameUrl('https://ivy.example', 'home', { live: false })).toBe('https://ivy.example/preview?embed=1&page=home')
    expect(previewFrameUrl('https://ivy.example', 'visit', { live: true })).toBe('https://ivy.example/preview?embed=1&live=1&page=visit')
  })

  it('桌機 1280 寬、手機 390 寬，縮到放得進欄內，不放大', () => {
    expect(PREVIEW_FRAME_WIDTH).toEqual({ desktop: 1280, mobile: 390 })
    expect(fitPreviewFrame({ width: 400, height: 700 }, 'desktop')).toEqual({ width: 1280, height: 2299, scale: 0.294 })
    expect(fitPreviewFrame({ width: 400, height: 700 }, 'mobile')).toEqual({ width: 390, height: 701, scale: 0.964 })
    expect(fitPreviewFrame({ width: 900, height: 700 }, 'mobile').scale).toBe(1)
  })

  it('寬度偏好預設手機、記在這台瀏覽器；讀寫失敗當沒記', () => {
    expect(readPreviewViewport()).toBe('mobile')
    rememberPreviewViewport('desktop')
    expect(localStorage.getItem(PREVIEW_VIEWPORT_KEY)).toBe('desktop')
    expect(readPreviewViewport()).toBe('desktop')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(readPreviewViewport()).toBe('mobile')
  })
})

describe('LivePreviewPane', () => {
  function mountPane(props: Record<string, unknown> = {}) {
    const wrapper = mount(LivePreviewPane, {
      props: {
        targets: previewTargetsFor('campus_profile'),
        src: 'https://ivy.example/preview?embed=1&live=1&page=home',
        state: 'live',
        frameKey: 'yihua|0',
        target: 'campuses',
        viewport: 'mobile',
        ...props,
      },
      global: { plugins: [ElementPlus] },
      attachTo: document.body,
    })
    wrappers.push(wrapper)
    return wrapper
  }

  it('分頁、寬度切換、狀態字；iframe 有 sandbox、不進 Tab 順序', async () => {
    const wrapper = mountPane()
    expect(wrapper.get('aside').attributes('aria-label')).toBe('官網預覽')
    expect(wrapper.findAll('.el-radio-button').map((b) => b.text())).toEqual(['首頁五校', '頁尾', '桌機', '手機'])
    expect(wrapper.get('.live-preview__meta').text()).toBe('預覽的是還沒存的修改')
    const frame = wrapper.get('iframe')
    expect(frame.attributes('title')).toBe('官網預覽')
    expect(frame.attributes('sandbox')).toBe('allow-scripts allow-same-origin')
    expect(frame.attributes('tabindex')).toBe('-1')
    expect(frame.attributes('referrerpolicy')).toBe('same-origin')
    expect(frame.attributes('src')).toBe('https://ivy.example/preview?embed=1&live=1&page=home')
    // jsdom 量不到尺寸：用 400×700 估。
    expect(frame.attributes('style')).toContain('scale(0.964)')
    expect(wrapper.emitted('frame')![0]![0]).toBe(frame.element)

    await wrapper.findAll('.el-radio-button input')[1]!.setValue(true)
    expect(wrapper.emitted('update:target')![0]).toEqual(['footer'])
    await wrapper.findAll('.el-radio-button input')[2]!.setValue(true)
    expect(wrapper.emitted('update:viewport')![0]).toEqual(['desktop'])
  })

  it('只有一個分頁時寫名稱，不放單選', () => {
    const wrapper = mountPane({ targets: previewTargetsFor('site_footer'), target: 'footer' })
    expect(wrapper.get('.live-preview__where').text()).toBe('頁尾')
    expect(wrapper.findAll('.el-radio-button').map((b) => b.text())).toEqual(['桌機', '手機'])
  })

  it('各狀態的說明；失敗時蓋一層說明與重新載入，iframe 留著', async () => {
    expect(mountPane({ state: 'connecting' }).get('.live-preview__meta').text()).toBe('正在載入預覽…')
    expect(mountPane({ state: 'saved' }).get('.live-preview__meta').text()).toBe('預覽的是上次儲存的草稿')
    const failed = mountPane({ state: 'failed' })
    expect(failed.find('.live-preview__meta').exists()).toBe(false)
    expect(failed.get('.live-preview__failed').text()).toContain('預覽沒有載入，可能是登入逾時。')
    expect(failed.find('iframe').exists()).toBe(true)
    await failed.get('.live-preview__failed button').trigger('click')
    expect(failed.emitted('retry')).toHaveLength(1)
  })

  it('frameKey 換了就重建 iframe', async () => {
    const wrapper = mountPane()
    const first = wrapper.get('iframe').element
    await wrapper.setProps({ frameKey: 'yihua|1' })
    await flushPromises()
    expect(wrapper.get('iframe').element).not.toBe(first)
    expect(wrapper.emitted('frame')!.at(-1)![0]).toBe(wrapper.get('iframe').element)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/livePreviewPane.test.ts`
Expected: FAIL（模組不存在）。

- [ ] **Step 3: 建 `previewTargets.ts`**

Create `admin/src/composables/previewTargets.ts`:

```ts
import { WEBSITE_ASSET_BASE } from '../config'

// 內容編輯頁右側的官網預覽（2026-10-06 方向 D）：每種內容在官網哪一頁、哪一塊看得到。
// page 對應官網 /preview?page=（web/app/utils/draft-preview.ts 的 PreviewPage），block 對應
// web/app/utils/preview-live.ts 的 PREVIEW_BLOCKS；兩邊的名字由 previewProtocol.test.ts 比對。

export type PreviewPage = 'home' | 'admission' | 'visit' | 'privacy' | 'curriculum' | 'about' | 'environment'
export type PreviewBlock =
  | 'home-hero' | 'home-about' | 'home-day' | 'home-campuses' | 'home-news'
  | 'site-header' | 'site-footer' | 'visit-booking' | 'page-top'
export type PreviewViewport = 'desktop' | 'mobile'
/** connecting＝等預覽頁回應；live＝預覽的是還沒存的修改；saved＝只看得到上次儲存的草稿；failed＝預覽頁拒絕（沒登入）。 */
export type PreviewPaneState = 'connecting' | 'live' | 'saved' | 'failed'

export interface PreviewTarget {
  /** 分頁代號，同一種內容裡唯一 */
  id: string
  /** 分頁上的字 */
  label: string
  page: PreviewPage
  block: PreviewBlock
  /** 只有這些最外層欄位會出現在這一塊；沒寫＝全部欄位。改到其他欄位時預覽不框、不捲。 */
  fields?: readonly string[]
}

const HOME_NEWS: readonly PreviewTarget[] = [{ id: 'news', label: '首頁最新消息', page: 'home', block: 'home-news' }]

export const PREVIEW_TARGETS: Readonly<Record<string, readonly PreviewTarget[]>> = {
  home_hero: [{ id: 'hero', label: '首頁首屏', page: 'home', block: 'home-hero' }],
  home_about: [{ id: 'about', label: '首頁關於常春藤', page: 'home', block: 'home-about' }],
  day_experience: [{ id: 'day', label: '首頁孩子的一天', page: 'home', block: 'home-day' }],
  home_campus_board: [{ id: 'campuses', label: '首頁五校', page: 'home', block: 'home-campuses' }],
  home_news: HOME_NEWS,
  campus_news: HOME_NEWS,
  // 不做預約頁：官網 /preview?page=visit 只畫個資說明，沒有真正的預約表單（計畫裁定 10）。
  campus_profile: [
    { id: 'campuses', label: '首頁五校', page: 'home', block: 'home-campuses' },
    { id: 'footer', label: '頁尾', page: 'home', block: 'site-footer' },
  ],
  booking_content: [
    { id: 'visit', label: '預約頁', page: 'visit', block: 'visit-booking', fields: ['privacy_title', 'privacy_sections'] },
    { id: 'header', label: '頁首預約鈕', page: 'home', block: 'site-header', fields: ['cta_label', 'cta_label_en'] },
  ],
  admission_content: [{ id: 'page', label: '入學資訊頁', page: 'admission', block: 'page-top' }],
  privacy_policy: [{ id: 'page', label: '隱私權政策頁', page: 'privacy', block: 'page-top' }],
  curriculum_page: [{ id: 'page', label: '特色教學頁', page: 'curriculum', block: 'page-top' }],
  about_page: [{ id: 'page', label: '關於常春藤頁', page: 'about', block: 'page-top' }],
  site_footer: [{ id: 'footer', label: '頁尾', page: 'home', block: 'site-footer' }],
  // 網站描述、分享圖等只用在搜尋與分享，預覽頁上看不到；只有頁首電話與主選單會框。
  site_meta: [{ id: 'header', label: '頁首', page: 'home', block: 'site-header', fields: ['header_phone_number', 'header_phone_note', 'primary_nav'] }],
  // 校園探索是寬版編輯器（場景大圖＋熱點），不放預覽欄；照舊用「存草稿並預覽」。
  campus_tour: [],
}

export function previewTargetsFor(kind: string | undefined): readonly PreviewTarget[] {
  return (kind && PREVIEW_TARGETS[kind]) || []
}

/**
 * 預覽 iframe 的來源。後台與官網同源（正式站 VITE_WEBSITE_ASSET_BASE 是空字串、stack build）才嵌；
 * 不同源（本機 npm run dev 的 5173 對 3000）回 null，不顯示預覽欄：官網的 frame-ancestors 只允許同源。
 */
export function livePreviewOrigin(
  base: string = WEBSITE_ASSET_BASE,
  here: Pick<Location, 'href' | 'origin'> = window.location,
): string | null {
  try {
    const origin = new URL(base || here.origin, here.href).origin
    return origin === here.origin ? origin : null
  } catch {
    return null
  }
}

/** 網址只帶 embed／live／page；草稿內容一律走 postMessage，不進網址。 */
export function previewFrameUrl(origin: string, page: PreviewPage, options: { live: boolean }): string {
  const params = new URLSearchParams({ embed: '1' })
  if (options.live) params.set('live', '1')
  params.set('page', page)
  return `${origin}/preview?${params.toString()}`
}

/** 桌機用 1280 寬渲染再縮小；手機 390（同官網 /preview 的手機框）。 */
export const PREVIEW_FRAME_WIDTH: Readonly<Record<PreviewViewport, number>> = { desktop: 1280, mobile: 390 }

/** iframe 用原寬渲染、整個縮到放得進欄內（不放大）；高度反算成剛好填滿欄高。 */
export function fitPreviewFrame(stage: { width: number; height: number }, viewport: PreviewViewport, padding = 12) {
  const width = PREVIEW_FRAME_WIDTH[viewport]
  const innerWidth = Math.max(1, stage.width - padding * 2)
  const innerHeight = Math.max(1, stage.height - padding * 2)
  const scale = Math.min(1, Math.round((innerWidth / width) * 1000) / 1000)
  return { width, height: Math.round(innerHeight / scale), scale }
}

export const PREVIEW_VIEWPORT_KEY = 'ivy-admin-preview-viewport'

/** 預設手機（右欄 320–460px，桌機縮到三成看不清字）；切換後記在這台瀏覽器。 */
export function readPreviewViewport(): PreviewViewport {
  try {
    return localStorage.getItem(PREVIEW_VIEWPORT_KEY) === 'desktop' ? 'desktop' : 'mobile'
  } catch {
    return 'mobile'
  }
}

export function rememberPreviewViewport(value: PreviewViewport): void {
  try {
    localStorage.setItem(PREVIEW_VIEWPORT_KEY, value)
  } catch {
    /* 私密模式等存不了就不記 */
  }
}
```

（縮放算法：先把 scale 四捨五入到千分位，再用四捨五入後的 scale 算高度。桌機 (400−24)/1280＝0.29375→0.294、高 676/0.294＝2299.3→2299；手機 376/390＝0.9641→0.964、高 676/0.964＝701.2→701。）

- [ ] **Step 4: 建 `LivePreviewPane.vue`**

Create `admin/src/components/LivePreviewPane.vue`:

```vue
<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import { fitPreviewFrame, type PreviewPaneState, type PreviewTarget, type PreviewViewport } from '../composables/previewTargets'

// 內容編輯頁右側的官網預覽（2026-10-06 方向 D，1280 以上）：上方切預覽哪裡、桌機／手機，
// 下方是縮放後的 /preview iframe。iframe 的網址與即時更新由 ContentEditor（useLivePreview）決定，
// 這個元件只管外觀與縮放。iframe 不進 Tab 順序（整個官網的連結會把 Tab 路徑拉長）。
const props = defineProps<{
  targets: readonly PreviewTarget[]
  src: string
  state: PreviewPaneState
  /** 換值就重建 iframe（換校區、重新載入預覽） */
  frameKey: string
}>()
const target = defineModel<string>('target', { required: true })
const viewport = defineModel<PreviewViewport>('viewport', { required: true })
const emit = defineEmits<{ frame: [el: HTMLIFrameElement | null]; retry: [] }>()

const stage = useTemplateRef<HTMLElement>('stage')
const frame = useTemplateRef<HTMLIFrameElement>('frame')
const stageSize = ref({ width: 0, height: 0 })
let observer: ResizeObserver | null = null

function measure() {
  const rect = stage.value?.getBoundingClientRect()
  if (rect) stageSize.value = { width: rect.width, height: rect.height }
}

onMounted(() => {
  measure()
  if (stage.value && typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(measure)
    observer.observe(stage.value)
  }
})
onBeforeUnmount(() => observer?.disconnect())
// 不用 immediate：setup 當下 iframe 還沒掛上（是 null）；掛上、或 frameKey 換掉重建後各通知一次。
watch(frame, (el) => emit('frame', el ?? null), { flush: 'post' })

// jsdom 與第一次量到之前沒有尺寸：先用 400×700，畫面一量到就換。
const fit = computed(() => fitPreviewFrame(stageSize.value.width ? stageSize.value : { width: 400, height: 700 }, viewport.value))
const frameStyle = computed(() => ({ width: `${fit.value.width}px`, height: `${fit.value.height}px`, transform: `scale(${fit.value.scale})` }))
const deviceStyle = computed(() => ({
  width: `${Math.round(fit.value.width * fit.value.scale)}px`,
  height: `${Math.round(fit.value.height * fit.value.scale)}px`,
}))
const META: Record<PreviewPaneState, string> = {
  connecting: '正在載入預覽…',
  live: '預覽的是還沒存的修改',
  saved: '預覽的是上次儲存的草稿',
  failed: '',
}
const meta = computed(() => META[props.state])
</script>

<template>
  <aside class="live-preview" aria-label="官網預覽">
    <div class="live-preview__bar">
      <el-radio-group v-if="targets.length > 1" v-model="target" size="small" aria-label="預覽哪裡">
        <el-radio-button v-for="t in targets" :key="t.id" :value="t.id">{{ t.label }}</el-radio-button>
      </el-radio-group>
      <span v-else-if="targets[0]" class="live-preview__where">{{ targets[0].label }}</span>
      <el-radio-group v-model="viewport" size="small" aria-label="預覽寬度">
        <el-radio-button value="desktop">桌機</el-radio-button>
        <el-radio-button value="mobile">手機</el-radio-button>
      </el-radio-group>
      <p v-if="meta" class="live-preview__meta">{{ meta }}</p>
    </div>
    <div ref="stage" class="live-preview__stage">
      <div class="live-preview__device" :class="`is-${viewport}`" :style="deviceStyle">
        <iframe
          :key="frameKey"
          ref="frame"
          class="live-preview__frame"
          :src="src"
          title="官網預覽"
          sandbox="allow-scripts allow-same-origin"
          referrerpolicy="same-origin"
          tabindex="-1"
          :style="frameStyle"
        />
      </div>
      <div v-if="state === 'failed'" class="live-preview__failed" role="status">
        <p>預覽沒有載入，可能是登入逾時。</p>
        <el-button size="small" @click="emit('retry')">重新載入預覽</el-button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.live-preview {
  position: sticky;
  top: calc(var(--top-h) + 24px);
  display: flex;
  flex-direction: column;
  height: calc(100svh - var(--top-h) - 24px - var(--editor-actions-h, 88px));
  min-height: 420px;
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface);
  overflow: hidden;
}
.live-preview__bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; padding: 10px 12px; border-bottom: 1px solid var(--line); }
.live-preview__where { font-size: var(--text-sm); font-weight: 600; color: var(--ink-2); }
.live-preview__meta { flex-basis: 100%; margin: 0; font-size: var(--text-xs); color: var(--ink-3); }
.live-preview__stage { position: relative; flex: 1; min-height: 0; padding: 12px; background: var(--surface-3); overflow: hidden; }
.live-preview__device { margin: 0 auto; overflow: hidden; border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow-md); }
.live-preview__device.is-mobile { border-radius: var(--radius-lg); }
.live-preview__frame { display: block; border: 0; transform-origin: 0 0; }
.live-preview__failed { position: absolute; inset: 0; display: grid; place-content: center; justify-items: center; gap: 8px; padding: 16px; background: var(--surface-3); text-align: center; font-size: var(--text-sm); color: var(--ink-2); }
.live-preview__failed p { margin: 0; }
</style>
```

- [ ] **Step 5: 跑測試確認通過**

Run: `cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/livePreviewPane.test.ts src/__tests__/ux20261005.test.ts`
Expected: 全過（`ux20261005` 確認新元件沒有 px 字級、彩色側條）。

- [ ] **Step 6: Commit**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; git add admin/src/composables/previewTargets.ts admin/src/components/LivePreviewPane.vue admin/src/__tests__/livePreviewPane.test.ts; git commit -F - <<'EOF'
feat(admin): 預覽分頁對照表與右側官網預覽欄元件

15 個編輯頁對應的預覽頁與區塊（校園探索不放）、同源才嵌、桌機 1280／手機 390 縮放、
寬度偏好記在這台瀏覽器。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 7: ContentEditor 三欄版面（預覽欄先看已存草稿）

**Files:**
- Modify: `admin/src/components/ContentEditor.vue`
- Create: `admin/src/__tests__/editorThreeColumns.test.ts`
- Modify: `tests/stack/visual.spec.ts`（五校介紹截圖遮罩預覽欄）、`tests/stack/a11y.spec.ts`（axe 不掃 iframe 裡的官網）

**Interfaces:**
- Consumes: Task 6 全部匯出、`useNarrowScreen(query)`、Task 1 的 `editor.campusKey`、既有 `latestRevisionId`。
- Produces（Task 12 改接線）：ContentEditor 內 `previewTargets`、`showPreviewPane`、`previewTargetId`、`currentTarget`、`previewViewport`、`previewOrigin`；DOM：`.editor--preview`、`.editor__layout.has-preview`、`.editor__preview`（LivePreviewPane 根）。

- [ ] **Step 1: 寫失敗的測試**

Create `admin/src/__tests__/editorThreeColumns.test.ts`:

```ts
// 2026-10-06 方向 D：1280 以上、後台與官網同源時，內容編輯頁右側放官網預覽；其他情況維持原版面。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, ref } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import ContentEditor from '../components/ContentEditor.vue'
import type { ContentEditorState } from '../composables/useContentItem'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

// 正式站的建置：VITE_WEBSITE_ASSET_BASE 是空字串（後台與官網同源）。
vi.mock('../config', () => ({ WEBSITE_ASSET_BASE: '', websiteAssetUrl: (key: string) => `/assets/${key}.webp` }))

const editorSource = readFileSync(fileURLToPath(new URL('../components/ContentEditor.vue', import.meta.url)), 'utf8')
const wrappers: VueWrapper[] = []
const originalMatchMedia = window.matchMedia
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  window.matchMedia = originalMatchMedia
  localStorage.clear()
  document.body.innerHTML = ''
})

function editorState(overrides: Partial<ContentEditorState> = {}): ContentEditorState {
  return {
    kind: 'site_footer',
    loading: ref(false), loadError: ref(null), saving: ref(false), publishing: ref(false), isPublished: ref(true),
    isDirty: computed(() => false), neverPublished: computed(() => false), latestRevisionAt: computed(() => '2026-10-06T02:00:00Z'),
    latestRevisionId: computed(() => 'r1'),
    form: ref({ tagline: '標語' }),
    load: async () => {}, save: async () => true, saveAndPublish: async () => true, reset: () => {},
    ...overrides,
  }
}

async function mountEditor(editor: ContentEditorState, props: Record<string, unknown> = {}) {
  const pinia = createPinia()
  useAuthStore(pinia).user = testUser('super_admin')
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/')
  await router.isReady()
  const wrapper = mount(ContentEditor, { props: { editor, ...props }, global: { plugins: [pinia, router, ElementPlus] }, attachTo: document.body })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

function narrowScreen() {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(max-width: 1279px)', media: query, addEventListener() {}, removeEventListener() {},
  })) as never
}

describe('右側官網預覽欄', () => {
  it('1280 以上、同源、有對應預覽頁：顯示預覽欄，版面放寬', async () => {
    const wrapper = await mountEditor(editorState())
    expect(wrapper.get('.editor').classes()).toContain('editor--preview')
    expect(wrapper.get('.editor__layout').classes()).toContain('has-preview')
    const pane = wrapper.get('aside.editor__preview')
    expect(pane.attributes('aria-label')).toBe('官網預覽')
    expect(pane.get('iframe').attributes('src')).toBe(`${window.location.origin}/preview?embed=1&page=home`)
    expect(pane.get('.live-preview__meta').text()).toBe('預覽的是上次儲存的草稿')
  })

  it('1280 以下、校園探索、尚未選校區：不顯示預覽欄', async () => {
    expect((await mountEditor(editorState({ kind: 'campus_tour' }))).find('.editor__preview').exists()).toBe(false)
    expect((await mountEditor(editorState(), { placeholder: '你的帳號沒有可編輯的校區。' })).find('.editor__preview').exists()).toBe(false)
    narrowScreen()
    const narrow = await mountEditor(editorState())
    expect(narrow.find('.editor__preview').exists()).toBe(false)
    expect(narrow.get('.editor').classes()).not.toContain('editor--preview')
  })

  it('兩個預覽分頁：切到另一頁換網址；寬度切換記在這台瀏覽器', async () => {
    const wrapper = await mountEditor(editorState({ kind: 'booking_content' }))
    expect(wrapper.get('iframe').attributes('src')).toContain('page=visit')
    await wrapper.findAll('.editor__preview .el-radio-button input')[1]!.setValue(true)
    await flushPromises()
    expect(wrapper.get('iframe').attributes('src')).toContain('page=home')
    await wrapper.findAll('.editor__preview .el-radio-button input')[2]!.setValue(true)
    await flushPromises()
    expect(localStorage.getItem('ivy-admin-preview-viewport')).toBe('desktop')
  })

  it('存成新的一版後重新載入預覽（這一階段預覽看的是已存草稿）', async () => {
    const latestRevisionId = ref('r1')
    const wrapper = await mountEditor(editorState({ latestRevisionId: computed(() => latestRevisionId.value) }))
    const first = wrapper.get('iframe').element
    latestRevisionId.value = 'r2'
    await flushPromises()
    expect(wrapper.get('iframe').element).not.toBe(first)
  })

  it('格線：有目錄 152 / 420–560 / 至少 320；沒目錄 440–640 / 至少 320', () => {
    const desktop = /@media \(min-width: 1280px\) \{[^@]*\}/.exec(editorSource)![0]
    expect(desktop).toContain('.editor--preview { max-width: none; }')
    expect(desktop).toContain("grid-template-columns: minmax(440px, 640px) minmax(320px, 1fr); grid-template-areas: 'top preview' 'body preview';")
    expect(desktop).toContain("grid-template-columns: 152px minmax(420px, 560px) minmax(320px, 1fr); grid-template-areas: 'nav top preview' 'nav body preview';")
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/editorThreeColumns.test.ts`
Expected: FAIL（沒有 `.editor__preview`）。

- [ ] **Step 3: 改 `ContentEditor.vue` script**

import 加：

```ts
import LivePreviewPane from './LivePreviewPane.vue'
import { useNarrowScreen } from '../composables/useNarrowScreen'
import {
  livePreviewOrigin,
  previewFrameUrl,
  previewTargetsFor,
  readPreviewViewport,
  rememberPreviewViewport,
  type PreviewViewport,
} from '../composables/previewTargets'
```

在 `const hasNav = …` 之後加：

```ts
// 右側官網預覽（2026-10-06 方向 D）：1280 以上、後台與官網同源、這種內容有對應預覽頁時才放。
// 1280 以下維持原本版面，用狀態列的「存草稿並預覽」開新分頁。
const previewTargets = computed(() => previewTargetsFor(props.editor.kind))
const belowPreviewWidth = useNarrowScreen('(max-width: 1279px)')
const previewOrigin = livePreviewOrigin()
const showPreviewPane = computed(() => Boolean(previewOrigin) && previewTargets.value.length > 0 && !belowPreviewWidth.value && !props.placeholder)
const previewTargetId = ref('')
watch(
  previewTargets,
  (targets) => {
    if (!targets.some((t) => t.id === previewTargetId.value)) previewTargetId.value = targets[0]?.id ?? ''
  },
  { immediate: true },
)
const currentTarget = computed(() => previewTargets.value.find((t) => t.id === previewTargetId.value) ?? previewTargets.value[0] ?? null)
const previewViewport = ref<PreviewViewport>(readPreviewViewport())
watch(previewViewport, rememberPreviewViewport)
// 這一階段預覽看的是上次儲存的草稿：換分頁換網址，存成新的一版就重新載入（Task 12 換成即時預覽）。
const previewSrc = computed(() => (previewOrigin && currentTarget.value ? previewFrameUrl(previewOrigin, currentTarget.value.page, { live: false }) : ''))
const previewFrameKey = computed(() => `${props.editor.campusKey?.value ?? ''}|${latestRevisionId.value ?? ''}|${currentTarget.value?.page ?? ''}`)
```

（`latestRevisionId` 是檔案前面既有的 computed；若宣告順序在後，把這段移到它下面。）

- [ ] **Step 4: 改 template**

1. 根元素改成 `<div class="editor" :class="{ 'editor--wide': width === 'wide', 'editor--with-nav': hasNav, 'editor--preview': showPreviewPane }">`。
2. `.editor__layout` 的 class 改成 `:class="{ 'has-nav': hasNav, 'has-preview': showPreviewPane }"`。
3. 在 `.editor__body` 的結尾 `</div>` 之後、`.editor__layout` 的結尾 `</div>` 之前加：
   ```html
           <LivePreviewPane
             v-if="showPreviewPane && currentTarget"
             v-model:target="previewTargetId"
             v-model:viewport="previewViewport"
             class="editor__preview"
             :targets="previewTargets"
             :src="previewSrc"
             state="saved"
             :frame-key="previewFrameKey"
           />
   ```

- [ ] **Step 5: 改 style**

1. `.editor { max-width: 720px; }` 改成 `.editor { max-width: 720px; --editor-actions-h: 88px; }`（預覽欄高度扣掉黏底動作列）。
2. 在 Task 3 的 `@media (min-width: 1280px) { … }` 區塊內最後加：
   ```css
     .editor--preview { max-width: none; }
     .editor--preview > .page-lead,
     .editor--preview > .toolbar { max-width: 720px; }
     .editor__layout.has-preview { display: grid; grid-template-columns: minmax(440px, 640px) minmax(320px, 1fr); grid-template-areas: 'top preview' 'body preview'; column-gap: 20px; align-items: start; }
     .editor__layout.has-nav.has-preview { grid-template-columns: 152px minmax(420px, 560px) minmax(320px, 1fr); grid-template-areas: 'nav top preview' 'nav body preview'; }
     .editor__layout.has-preview > .editor__top { grid-area: top; min-width: 0; }
     .editor__layout.has-preview > .editor__nav { grid-area: nav; }
     .editor__layout.has-preview > .editor__body { grid-area: body; min-width: 0; }
     .editor__layout.has-preview > .editor__preview { grid-area: preview; }
   ```
   （1280 寬：主欄 964px＝152＋20＋452＋20＋320；1440：1124px＝152＋20＋560＋20＋372。）

- [ ] **Step 6: stack 測試跟著調整（不在這個 Task 跑，Task 15 跑）**

`tests/stack/visual.spec.ts` 的「五校介紹（崇德…）」截圖遮罩改成：

```ts
    await expect(page).toHaveScreenshot('campus-profile.png', {
      // 右側官網預覽是另一個頁面（影片、輪播、WebGL），內容不固定：整塊遮掉。
      mask: [...dynamicParts(page), page.locator('.editor__status'), page.locator('.live-preview__stage')],
    })
```

`tests/stack/a11y.spec.ts` 的 `seriousViolations` 裡 `new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()` 改成：

```ts
  // 後台內容編輯右側的官網預覽是 iframe 裡的官網頁面，官網頁面自己另有一組 axe 檢查；這裡只掃後台。
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).exclude('.live-preview__frame').analyze()
```

- [ ] **Step 7: 跑測試確認通過**

Run: `cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/editorThreeColumns.test.ts src/__tests__/editorSectionDots.test.ts src/__tests__/uxRound8Nav.test.ts src/__tests__/ux20261005.test.ts src/__tests__/ux20260928A.test.ts`
Expected: 全過。另跑 `npm --prefix admin run typecheck`，Expected: 結束碼 0。

- [ ] **Step 8: Commit**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; git add admin/src/components/ContentEditor.vue admin/src/__tests__/editorThreeColumns.test.ts tests/stack/visual.spec.ts tests/stack/a11y.spec.ts; git commit -F - <<'EOF'
feat(admin): 內容編輯 1280 以上改成目錄、表單、預覽三欄

預覽欄先顯示已存草稿（存成新的一版就重新載入），1280 以下、不同源、校園探索維持原版面；
stack 截圖遮罩預覽欄、axe 不掃 iframe 裡的官網。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Phase 2：逐頁接上即時預覽

### Task 8: 官網端訊息格式、驗證與套用（純函式）

**Files:**
- Create: `web/app/utils/preview-live.ts`
- Modify: `web/app/utils/draft-preview.ts`（加 `isLivePreview`）
- Create: `web/tests/preview-live.spec.ts`
- Modify: `web/tests/draft-preview.spec.ts`

**Interfaces:**
- Consumes: `ContentOverlay`（`web/app/utils/content-overlay.ts`）、`PreviewPage`、`previewOverlay`（`draft-preview.ts`）。
- Produces（Task 9、10 依賴；admin 的 Task 11 對照）：
  ```ts
  export const PREVIEW_PROTOCOL_VERSION = 1
  export const PREVIEW_MESSAGE: { draft: 'ivy-preview:draft'; ready: 'ivy-preview:ready'; applied: 'ivy-preview:applied'; denied: 'ivy-preview:denied' }
  export const MAX_DRAFT_CHARS = 1_000_000
  export const MAX_PROBE_CHARS = 80
  export const SHARED_LIVE_KINDS: readonly [...12 kinds]
  export const CAMPUS_LIVE_KINDS: readonly ['campus_profile', 'campus_tour', 'campus_news']
  export type LiveKind
  export type PreviewBlock = 'home-hero' | … | 'page-top'
  export interface PreviewBlockSpec { selector: string; outline: boolean; campusTab?: boolean }
  export const PREVIEW_BLOCKS: Readonly<Record<PreviewBlock, PreviewBlockSpec>>
  export interface LiveFocus { block: PreviewBlock; campusKey: string | null; probe: string | null; mark: boolean }
  export interface LiveDraft { seq: number; kind: LiveKind; campusKey: string | null; payload: Record<string, unknown>; page: PreviewPage; focus: LiveFocus }
  export type LiveOverride = Pick<LiveDraft, 'kind' | 'campusKey' | 'payload'>
  export type PreviewHit = 'text' | 'block' | 'none'
  export interface PreviewWindow { location: { origin: string }; parent: unknown }
  export function parseDraftMessage(data: unknown, campusKeys: readonly string[]): LiveDraft | null
  export function isTrustedPreviewEvent(event: { origin: string; source: unknown }, self: PreviewWindow): boolean
  export function applyLiveDraft(overlay: ContentOverlay, draft: LiveOverride): ContentOverlay
  export function createLiveReceiver(options: { self: PreviewWindow; campusKeys: readonly string[]; onDraft(draft: LiveDraft): void }): { handle(event: { origin: string; source: unknown; data: unknown }): void; ready(): void; denied(): void; applied(seq: number, hit: PreviewHit): void }
  export type LiveReceiver = ReturnType<typeof createLiveReceiver>
  // draft-preview.ts
  export function isLivePreview(query: Record<string, unknown>): boolean   // embed=1 且 live=1
  ```

- [ ] **Step 1: 寫失敗的測試**

Create `web/tests/preview-live.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { previewOverlay } from '../app/utils/draft-preview'
import {
  applyLiveDraft,
  createLiveReceiver,
  isTrustedPreviewEvent,
  MAX_DRAFT_CHARS,
  parseDraftMessage,
  PREVIEW_MESSAGE
} from '../app/utils/preview-live'

// 2026-10-06 方向 D：後台內容編輯頁把還沒存的表單用 postMessage 傳進 /preview?embed=1&live=1。
const site = fixture as unknown as SiteContent
const CAMPUSES = site.campuses.map((c) => c.key)
const footer = { tagline: '還沒存的標語', copyright: '©', bottom_note: '', campus_list_label: '五校聯絡' }

function draft(overrides: Record<string, unknown> = {}) {
  return {
    type: 'ivy-preview:draft', v: 1, seq: 1, kind: 'site_footer', campusKey: null, payload: footer, page: 'home',
    focus: { block: 'site-footer', campusKey: null, probe: '還沒存的標語', mark: true },
    ...overrides
  }
}

describe('parseDraftMessage：格式不對就不套用', () => {
  it('收共用內容與分校內容', () => {
    expect(parseDraftMessage(draft(), CAMPUSES)).toEqual({
      seq: 1, kind: 'site_footer', campusKey: null, payload: footer, page: 'home',
      focus: { block: 'site-footer', campusKey: null, probe: '還沒存的標語', mark: true }
    })
    const campus = parseDraftMessage(draft({ kind: 'campus_profile', campusKey: 'yihua', focus: { block: 'home-campuses', campusKey: 'yihua', probe: null, mark: true } }), CAMPUSES)
    expect(campus?.campusKey).toBe('yihua')
  })

  it.each([
    ['type 不對', { type: 'something-else' }],
    ['版本不對', { v: 2 }],
    ['seq 不是正整數', { seq: 0 }],
    ['seq 是小數', { seq: 1.5 }],
    ['不認得的內容種類', { kind: 'users' }],
    ['共用內容帶了校區', { campusKey: 'yihua' }],
    ['分校內容沒帶校區', { kind: 'campus_profile', campusKey: null }],
    ['不認得的校區', { kind: 'campus_profile', campusKey: 'evil' }],
    ['payload 是陣列', { payload: [] }],
    ['payload 是 null', { payload: null }],
    ['payload 太大', { payload: { tagline: 'x'.repeat(MAX_DRAFT_CHARS) } }],
    ['不認得的頁面', { page: 'admin' }],
    ['區塊是原型上的鍵', { focus: { block: 'toString', campusKey: null, probe: null, mark: true } }],
    ['區塊是 constructor', { focus: { block: 'constructor', campusKey: null, probe: null, mark: true } }],
    ['focus 的校區不認得', { focus: { block: 'home-campuses', campusKey: 'evil', probe: null, mark: true } }]
  ])('%s', (_name, overrides) => {
    expect(parseDraftMessage(draft(overrides), CAMPUSES)).toBeNull()
  })

  it('不是物件也不收', () => {
    for (const data of [null, 'ivy-preview:draft', 1, []]) expect(parseDraftMessage(data, CAMPUSES)).toBeNull()
  })

  it('probe 截到 80 字、空字串當沒有；mark 沒寫當 true', () => {
    const long = parseDraftMessage(draft({ focus: { block: 'site-footer', campusKey: null, probe: '字'.repeat(120) } }), CAMPUSES)
    expect(long?.focus.probe).toHaveLength(80)
    expect(long?.focus.mark).toBe(true)
    expect(parseDraftMessage(draft({ focus: { block: 'site-footer', campusKey: null, probe: '   ', mark: false } }), CAMPUSES)?.focus).toEqual({ block: 'site-footer', campusKey: null, probe: null, mark: false })
  })
})

describe('isTrustedPreviewEvent：只收同源、外層後台頁送來的', () => {
  const parent = { name: 'admin' }
  const self = { location: { origin: 'https://ivy.example' }, parent }

  it('同源而且是 parent', () => {
    expect(isTrustedPreviewEvent({ origin: 'https://ivy.example', source: parent }, self)).toBe(true)
  })

  it('別的 origin、不是 parent（同源其他分頁、自己）、頂層頁面：都不收', () => {
    expect(isTrustedPreviewEvent({ origin: 'https://evil.example', source: parent }, self)).toBe(false)
    expect(isTrustedPreviewEvent({ origin: 'https://ivy.example', source: { name: 'opener' } }, self)).toBe(false)
    expect(isTrustedPreviewEvent({ origin: 'https://ivy.example', source: self }, self)).toBe(false)
    const top: { location: { origin: string }; parent: unknown } = { location: { origin: 'https://ivy.example' }, parent: null }
    top.parent = top
    expect(isTrustedPreviewEvent({ origin: 'https://ivy.example', source: top }, top)).toBe(false)
  })
})

describe('applyLiveDraft：只蓋掉這一項內容', () => {
  it('共用內容整份換掉；分校內容只換那一校，不改原本的 overlay', () => {
    const overlay = { site_footer: { ...footer, tagline: '已存' }, campus_profile: { minghua: { name: '明華校' } } } as never
    const shared = applyLiveDraft(overlay, { kind: 'site_footer', campusKey: null, payload: footer })
    expect((shared as Record<string, unknown>).site_footer).toBe(footer)
    const campus = applyLiveDraft(overlay, { kind: 'campus_profile', campusKey: 'yihua', payload: { name: '義華校' } })
    expect((campus as Record<string, Record<string, unknown>>).campus_profile).toEqual({ minghua: { name: '明華校' }, yihua: { name: '義華校' } })
    expect((overlay as Record<string, Record<string, unknown>>).campus_profile).toEqual({ minghua: { name: '明華校' } })
  })

  it('和預覽同一條路：頁尾標語換掉、消息照樣依日期上下架', () => {
    const live = applyLiveDraft({}, { kind: 'site_footer', campusKey: null, payload: footer })
    expect(previewOverlay(site, live, '2026-10-06').content.footer.tagline).toBe('還沒存的標語')
    const news = applyLiveDraft({}, {
      kind: 'home_news', campusKey: null,
      payload: { sample_note: '', articles: [{ id: 'later', date: '2026-10-20', campus: '全校', category: '日常', title: '下週才上架', description: '', image: 'news-1', alt: '', show_from: '2026-10-20' }], events: [] }
    })
    expect(previewOverlay(site, news, '2026-10-06').hiddenNews.map((n) => n.title)).toEqual(['下週才上架'])
  })
})

describe('createLiveReceiver', () => {
  function setup() {
    const parent = { postMessage: vi.fn() }
    const self = { location: { origin: 'https://ivy.example' }, parent }
    const onDraft = vi.fn()
    const receiver = createLiveReceiver({ self, campusKeys: CAMPUSES, onDraft })
    return { parent, self, onDraft, receiver }
  }

  it('ready／denied／applied 都只送給 parent，targetOrigin 是自己的 origin', () => {
    const { parent, receiver } = setup()
    receiver.ready()
    receiver.denied()
    receiver.applied(3, 'text')
    expect(parent.postMessage.mock.calls).toEqual([
      [{ v: 1, type: PREVIEW_MESSAGE.ready }, 'https://ivy.example'],
      [{ v: 1, type: PREVIEW_MESSAGE.denied }, 'https://ivy.example'],
      [{ v: 1, type: PREVIEW_MESSAGE.applied, seq: 3, hit: 'text' }, 'https://ivy.example']
    ])
  })

  it('只交出可信、格式對、seq 比上一則大的草稿', () => {
    const { parent, onDraft, receiver } = setup()
    receiver.handle({ origin: 'https://evil.example', source: parent, data: draft() })
    receiver.handle({ origin: 'https://ivy.example', source: parent, data: draft({ seq: 2 }) })
    receiver.handle({ origin: 'https://ivy.example', source: parent, data: draft({ seq: 1 }) })
    receiver.handle({ origin: 'https://ivy.example', source: parent, data: draft({ seq: 2 }) })
    receiver.handle({ origin: 'https://ivy.example', source: parent, data: draft({ seq: 3, v: 9 }) })
    expect(onDraft.mock.calls.map(([d]) => d.seq)).toEqual([2])
  })

  it('頂層頁面（parent 就是自己）什麼都不送', () => {
    const self: { location: { origin: string }; parent: unknown; postMessage: ReturnType<typeof vi.fn> } = { location: { origin: 'https://ivy.example' }, parent: null, postMessage: vi.fn() }
    self.parent = self
    createLiveReceiver({ self, campusKeys: CAMPUSES, onDraft: vi.fn() }).ready()
    expect(self.postMessage).not.toHaveBeenCalled()
  })
})
```

`web/tests/draft-preview.spec.ts`：import 加 `isLivePreview`，在 `describe('草稿預覽的網址參數'` 裡加：

```ts
  it('即時預覽要同時有 embed=1 與 live=1（後台內容編輯右側的 iframe）', () => {
    expect(isLivePreview({ embed: '1', live: '1' })).toBe(true)
    expect(isLivePreview({ live: '1' })).toBe(false)
    expect(isLivePreview({ embed: '1' })).toBe(false)
    expect(isLivePreview({ embed: '1', live: ['1'] })).toBe(false)
  })
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix web run test:unit -- tests/preview-live.spec.ts tests/draft-preview.spec.ts`
Expected: FAIL（模組與 `isLivePreview` 不存在）。

- [ ] **Step 3: `draft-preview.ts` 加 `isLivePreview`**

在 `isPreviewEmbed` 下面加：

```ts
/** 後台內容編輯頁右側的即時預覽（iframe 帶 embed=1&live=1）：等後台用 postMessage 送還沒存的表單。 */
export function isLivePreview(query: Query): boolean {
  return isPreviewEmbed(query) && text(query.live) === '1'
}
```

並在檔案開頭的參數說明註解加一行：`// - live=1（搭配 embed=1）：後台內容編輯頁右側的即時預覽，見 utils/preview-live.ts`。

- [ ] **Step 4: 建 `preview-live.ts`**

Create `web/app/utils/preview-live.ts`:

```ts
import type { ContentOverlay } from './content-overlay'
import type { PreviewPage } from './draft-preview'

// 後台內容編輯頁右側的即時預覽（2026-10-06 方向 D）：後台把「還沒存的表單內容」用 postMessage
// 傳進 /preview?embed=1&live=1 的 iframe。這支只放訊息格式、驗證與套用（純函式）。
// admin/src/composables/previewProtocol.ts 是同一份格式：改一邊要改另一邊（admin 的
// previewProtocol.test.ts 會讀這個檔比對訊息名稱、版本、內容種類與區塊）。
//
// 安全：只收同源、而且是外層後台頁（window.parent）送來的訊息；草稿只放在記憶體，
// 不寫進網址、storage 或任何快取；不認得的種類、校區、區塊一律丟掉。

export const PREVIEW_PROTOCOL_VERSION = 1
export const PREVIEW_MESSAGE = {
  draft: 'ivy-preview:draft',
  ready: 'ivy-preview:ready',
  applied: 'ivy-preview:applied',
  denied: 'ivy-preview:denied'
} as const

/** 一則草稿最多多大（JSON 字元數）；超過就不套用。 */
export const MAX_DRAFT_CHARS = 1_000_000
/** 用來找位置的那段文字最多幾個字。 */
export const MAX_PROBE_CHARS = 80

export const SHARED_LIVE_KINDS = [
  'home_about',
  'home_hero',
  'site_footer',
  'site_meta',
  'home_campus_board',
  'booking_content',
  'day_experience',
  'home_news',
  'admission_content',
  'privacy_policy',
  'curriculum_page',
  'about_page'
] as const
export const CAMPUS_LIVE_KINDS = ['campus_profile', 'campus_tour', 'campus_news'] as const
export type LiveKind = (typeof SHARED_LIVE_KINDS)[number] | (typeof CAMPUS_LIVE_KINDS)[number]

export type PreviewBlock =
  | 'home-hero'
  | 'home-about'
  | 'home-day'
  | 'home-campuses'
  | 'home-news'
  | 'site-header'
  | 'site-footer'
  | 'visit-booking'
  | 'page-top'

export interface PreviewBlockSpec {
  selector: string
  /** 找不到改到的文字時，要不要框整塊（整頁內容就不框） */
  outline: boolean
  /** 首頁五校：先切到改的那一校 */
  campusTab?: boolean
}

export const PREVIEW_BLOCKS: Readonly<Record<PreviewBlock, PreviewBlockSpec>> = {
  'home-hero': { selector: '.studio-hero', outline: true },
  'home-about': { selector: '.home-belief', outline: true },
  'home-day': { selector: '.day-experience', outline: true },
  'home-campuses': { selector: '#campuses', outline: true, campusTab: true },
  'home-news': { selector: '.home-news', outline: true },
  'site-header': { selector: 'header.header', outline: true },
  'site-footer': { selector: 'footer.footer', outline: true },
  'visit-booking': { selector: '.booking-draft', outline: true },
  'page-top': { selector: '#main', outline: false }
}

const PAGES: readonly PreviewPage[] = ['home', 'admission', 'visit', 'privacy', 'curriculum', 'about', 'environment']

export interface LiveFocus {
  block: PreviewBlock
  campusKey: string | null
  probe: string | null
  mark: boolean
}

export interface LiveDraft {
  seq: number
  kind: LiveKind
  campusKey: string | null
  payload: Record<string, unknown>
  page: PreviewPage
  focus: LiveFocus
}

export type LiveOverride = Pick<LiveDraft, 'kind' | 'campusKey' | 'payload'>
export type PreviewHit = 'text' | 'block' | 'none'

export interface PreviewWindow {
  location: { origin: string }
  parent: unknown
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCampusKind(kind: unknown): boolean {
  return (CAMPUS_LIVE_KINDS as readonly unknown[]).includes(kind)
}

export function parseDraftMessage(data: unknown, campusKeys: readonly string[]): LiveDraft | null {
  if (!isPlainObject(data) || data.type !== PREVIEW_MESSAGE.draft || data.v !== PREVIEW_PROTOCOL_VERSION) return null
  const { seq, kind, campusKey, payload, page, focus } = data
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1) return null
  const shared = (SHARED_LIVE_KINDS as readonly unknown[]).includes(kind)
  const perCampus = isCampusKind(kind)
  if (!shared && !perCampus) return null
  if (shared && campusKey !== null) return null
  if (perCampus && (typeof campusKey !== 'string' || !campusKeys.includes(campusKey))) return null
  if (!isPlainObject(payload)) return null
  let size: number
  try {
    size = JSON.stringify(payload).length
  } catch {
    return null
  }
  if (size > MAX_DRAFT_CHARS) return null
  if (typeof page !== 'string' || !(PAGES as readonly string[]).includes(page)) return null
  if (!isPlainObject(focus) || typeof focus.block !== 'string') return null
  // hasOwnProperty：擋掉 toString、constructor 這類原型上的鍵。
  if (!Object.prototype.hasOwnProperty.call(PREVIEW_BLOCKS, focus.block)) return null
  const focusCampus = focus.campusKey
  if (focusCampus !== null && focusCampus !== undefined && (typeof focusCampus !== 'string' || !campusKeys.includes(focusCampus))) return null
  const probe = typeof focus.probe === 'string' && focus.probe.trim() ? focus.probe.slice(0, MAX_PROBE_CHARS) : null
  return {
    seq,
    kind: kind as LiveKind,
    campusKey: perCampus ? (campusKey as string) : null,
    payload,
    page: page as PreviewPage,
    focus: { block: focus.block as PreviewBlock, campusKey: (focusCampus as string | null | undefined) ?? null, probe, mark: focus.mark !== false }
  }
}

/** 只收同源、而且是外層後台頁送來的；頂層直接打開（parent 就是自己）的一律不收。 */
export function isTrustedPreviewEvent(event: { origin: string; source: unknown }, self: PreviewWindow): boolean {
  return self.parent !== self && event.source === self.parent && event.origin === self.location.origin
}

/** 只蓋掉這一項內容；分校內容只換那一校。不改傳進來的 overlay。 */
export function applyLiveDraft(overlay: ContentOverlay, draft: LiveOverride): ContentOverlay {
  const next = { ...overlay } as Record<string, unknown>
  if (isCampusKind(draft.kind) && draft.campusKey) {
    const current = (overlay as Record<string, Record<string, unknown> | null | undefined>)[draft.kind] ?? {}
    next[draft.kind] = { ...current, [draft.campusKey]: draft.payload }
  } else {
    next[draft.kind] = draft.payload
  }
  return next as ContentOverlay
}

export function createLiveReceiver(options: { self: PreviewWindow; campusKeys: readonly string[]; onDraft: (draft: LiveDraft) => void }) {
  let lastSeq = 0
  function post(message: Record<string, unknown>) {
    const { self } = options
    if (self.parent === self) return
    ;(self.parent as { postMessage(message: unknown, targetOrigin: string): void }).postMessage(
      { v: PREVIEW_PROTOCOL_VERSION, ...message },
      self.location.origin
    )
  }
  return {
    handle(event: { origin: string; source: unknown; data: unknown }) {
      if (!isTrustedPreviewEvent(event, options.self)) return
      const draft = parseDraftMessage(event.data, options.campusKeys)
      if (!draft || draft.seq <= lastSeq) return
      lastSeq = draft.seq
      options.onDraft(draft)
    },
    ready: () => post({ type: PREVIEW_MESSAGE.ready }),
    denied: () => post({ type: PREVIEW_MESSAGE.denied }),
    applied: (seq: number, hit: PreviewHit) => post({ type: PREVIEW_MESSAGE.applied, seq, hit })
  }
}

export type LiveReceiver = ReturnType<typeof createLiveReceiver>
```

注意 `createLiveReceiver` 回覆的物件鍵順序是 `{ v, type, … }`（測試用 `toEqual`，順序不影響）。

- [ ] **Step 5: 跑測試確認通過**

Run: `cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix web run test:unit -- tests/preview-live.spec.ts tests/draft-preview.spec.ts tests/shared-imports.spec.ts`
Expected: 全過。

- [ ] **Step 6: Commit**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; git add web/app/utils/preview-live.ts web/app/utils/draft-preview.ts web/tests/preview-live.spec.ts web/tests/draft-preview.spec.ts; git commit -F - <<'EOF'
feat(web): 即時預覽的訊息格式、來源驗證與套用

只收同源、外層後台頁送來的訊息，驗證版本、內容種類、校區、區塊與大小，舊的 seq 丟掉；
草稿只蓋掉那一項內容，消息照樣依日期上下架。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: 官網端找位置、切校、框選、只捲預覽視窗

**Files:**
- Create: `web/app/utils/preview-highlight.ts`
- Create: `web/tests/preview-highlight.spec.ts`

**Interfaces:**
- Consumes: Task 8 的 `PREVIEW_BLOCKS`、`LiveFocus`、`PreviewHit`。
- Produces（Task 10 用）：
  ```ts
  export const PREVIEW_HIT_CLASS = 'preview-live-hit'
  export function isRenderedElement(el: Element): boolean
  export function findProbeElement(root: Element, probe: string, isRendered?: (el: Element) => boolean): Element | null
  export function activatePreviewBlock(doc: Document, focus: LiveFocus): boolean   // true＝點了校區分頁，要等下一次更新
  export interface HighlightOptions { isRendered?: (el: Element) => boolean; reduceMotion?: boolean }
  export function highlightPreview(doc: Document, focus: LiveFocus, options?: HighlightOptions): PreviewHit
  export function revealInFrame(doc: Document, el: Element, align: 'center' | 'start', reduceMotion: boolean): void
  ```

- [ ] **Step 1: 寫失敗的測試**

Create `web/tests/preview-highlight.spec.ts`:

```ts
// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { activatePreviewBlock, findProbeElement, highlightPreview, PREVIEW_HIT_CLASS, revealInFrame } from '../app/utils/preview-highlight'
import type { LiveFocus } from '../app/utils/preview-live'

// 2026-10-06 方向 D：「改哪格亮哪格」用改到的那段文字在區塊裡找位置；happy-dom 量不到版面，
// 「畫得出來」改用 hidden 屬性判斷。
const rendered = (el: Element) => !el.closest('[hidden]')
const focus = (overrides: Partial<LiveFocus> = {}): LiveFocus => ({ block: 'site-footer', campusKey: null, probe: null, mark: true, ...overrides })
const originalIntoView = Element.prototype.scrollIntoView

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  Element.prototype.scrollIntoView = originalIntoView
})

describe('findProbeElement', () => {
  it('找含這段文字、最深的元素；空白差異不算', () => {
    document.body.innerHTML = '<footer class="footer"><div><p>常春藤  教育機構</p><ul><li>義華校 <a>07-392-8366</a></li></ul></div></footer>'
    const root = document.querySelector('footer')!
    expect(findProbeElement(root, '07-392-8366', rendered)?.tagName).toBe('A')
    expect(findProbeElement(root, '常春藤 教育機構', rendered)?.tagName).toBe('P')
    expect(findProbeElement(root, '不存在的字', rendered)).toBeNull()
    expect(findProbeElement(root, '常', rendered)).toBeNull()
  })

  it('隱藏的副本不算，找畫得出來的那份', () => {
    document.body.innerHTML = '<footer class="footer"><p class="mobile" hidden>新標語</p><p class="desktop">新標語</p></footer>'
    expect(findProbeElement(document.querySelector('footer')!, '新標語', rendered)?.className).toBe('desktop')
  })

  it('不往 script、style、noscript 裡找', () => {
    document.body.innerHTML = '<footer class="footer"><noscript>新標語</noscript><p>新標語</p></footer>'
    expect(findProbeElement(document.querySelector('footer')!, '新標語', rendered)?.tagName).toBe('P')
  })
})

describe('activatePreviewBlock', () => {
  it('首頁五校：改的那一校還不是目前那張時點它的分頁', () => {
    document.body.innerHTML = '<section id="campuses"><button id="campus-tab-yihua" aria-selected="true"></button><button id="campus-tab-minghua" aria-selected="false"></button></section>'
    const click = vi.fn()
    document.getElementById('campus-tab-minghua')!.addEventListener('click', click)
    expect(activatePreviewBlock(document, focus({ block: 'home-campuses', campusKey: 'yihua' }))).toBe(false)
    expect(activatePreviewBlock(document, focus({ block: 'home-campuses', campusKey: 'minghua' }))).toBe(true)
    expect(click).toHaveBeenCalledOnce()
    expect(activatePreviewBlock(document, focus({ block: 'site-footer', campusKey: 'minghua' }))).toBe(false)
  })
})

describe('highlightPreview', () => {
  function stubView(scrollY = 0, innerHeight = 800) {
    const scrollTo = vi.fn()
    vi.spyOn(window, 'scrollTo').mockImplementation(scrollTo as never)
    Object.defineProperty(window, 'innerHeight', { value: innerHeight, configurable: true })
    Object.defineProperty(window, 'scrollY', { value: scrollY, configurable: true })
    return scrollTo
  }

  it('找到文字框那一格；找不到框整塊；只留一個框', () => {
    document.body.innerHTML = '<footer class="footer"><p>舊標語</p><p>新標語</p></footer>'
    stubView()
    expect(highlightPreview(document, focus({ probe: '新標語' }), { isRendered: rendered })).toBe('text')
    expect(document.querySelectorAll(`.${PREVIEW_HIT_CLASS}`)).toHaveLength(1)
    expect(document.querySelector(`.${PREVIEW_HIT_CLASS}`)!.textContent).toBe('新標語')
    expect(highlightPreview(document, focus({ probe: '沒有這段' }), { isRendered: rendered })).toBe('block')
    expect(document.querySelector(`.${PREVIEW_HIT_CLASS}`)!.tagName).toBe('FOOTER')
    expect(document.querySelectorAll(`.${PREVIEW_HIT_CLASS}`)).toHaveLength(1)
  })

  it('mark=false 或整頁區塊找不到文字：不框', () => {
    document.body.innerHTML = '<main id="main"><p>入學流程</p></main><footer class="footer"><p>標語</p></footer>'
    stubView()
    expect(highlightPreview(document, focus({ mark: false, probe: '標語' }), { isRendered: rendered })).toBe('none')
    expect(highlightPreview(document, focus({ block: 'page-top', probe: '沒有這段' }), { isRendered: rendered })).toBe('none')
    expect(highlightPreview(document, focus({ block: 'page-top', probe: '入學流程' }), { isRendered: rendered })).toBe('text')
    expect(highlightPreview(document, focus({ block: 'visit-booking' }), { isRendered: rendered })).toBe('none')
  })

  it('只捲預覽頁自己的視窗（scrollTo），不用 scrollIntoView（會連外層後台頁一起捲）', () => {
    document.body.innerHTML = '<footer class="footer"><p>新標語</p></footer>'
    const scrollTo = stubView(100, 800)
    const intoView = vi.fn()
    Element.prototype.scrollIntoView = intoView
    const p = document.querySelector('p')!
    vi.spyOn(p, 'getBoundingClientRect').mockReturnValue({ top: 1200, bottom: 1230, height: 30, left: 0, right: 0, width: 0, x: 0, y: 1200, toJSON: () => ({}) } as DOMRect)
    revealInFrame(document, p, 'center', true)
    expect(intoView).not.toHaveBeenCalled()
    expect(scrollTo).toHaveBeenCalledWith({ top: 100 + 1200 - 385, behavior: 'auto' })
  })

  it('已經看得到就不捲', () => {
    document.body.innerHTML = '<footer class="footer"><p>新標語</p></footer>'
    const scrollTo = stubView(0, 800)
    const p = document.querySelector('p')!
    vi.spyOn(p, 'getBoundingClientRect').mockReturnValue({ top: 300, bottom: 330, height: 30, left: 0, right: 0, width: 0, x: 0, y: 300, toJSON: () => ({}) } as DOMRect)
    revealInFrame(document, p, 'center', false)
    expect(scrollTo).not.toHaveBeenCalled()
  })
})
```

（`revealInFrame` 置中：offset＝max(88, (800−30)/2＝385)＝385，top＝100＋1200−385。）

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix web run test:unit -- tests/preview-highlight.spec.ts`
Expected: FAIL（模組不存在）。

- [ ] **Step 3: 實作**

Create `web/app/utils/preview-highlight.ts`:

```ts
import { PREVIEW_BLOCKS, type LiveFocus, type PreviewHit } from './preview-live'

// 即時預覽的「改哪格亮哪格」（2026-10-06 方向 D）：後台送來改到的那段文字（probe），在目前分頁
// 對應的區塊裡找最深、畫得出來的元素框起來；找不到就框整塊（整頁內容不框）。只捲預覽頁自己的
// 視窗：Element.scrollIntoView 在同源 iframe 裡會連外層後台頁一起捲，打字時整個編輯頁會跳。

export const PREVIEW_HIT_CLASS = 'preview-live-hit'
const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'])
/** 預覽頁的頁首會黏在上方；捲過去時留這麼多。 */
const TOP_OFFSET = 88

function normalize(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim()
}

/** 畫得出來（display: none、hidden 的元素沒有 client rect）。 */
export function isRenderedElement(el: Element): boolean {
  return el.getClientRects().length > 0
}

export function findProbeElement(root: Element, probe: string, isRendered: (el: Element) => boolean = isRenderedElement): Element | null {
  const needle = normalize(probe)
  if (needle.length < 2 || !isRendered(root) || !normalize(root.textContent).includes(needle)) return null
  let current: Element = root
  for (;;) {
    const next = Array.from(current.children).find(
      (child) => !SKIP.has(child.tagName) && isRendered(child) && normalize(child.textContent).includes(needle)
    )
    if (!next) return current
    current = next
  }
}

/** 首頁五校：改的那一校還不是目前那張時點它的分頁。回 true 表示畫面會再更新一次。 */
export function activatePreviewBlock(doc: Document, focus: LiveFocus): boolean {
  if (!PREVIEW_BLOCKS[focus.block].campusTab || !focus.campusKey) return false
  const tab = doc.getElementById(`campus-tab-${focus.campusKey}`)
  if (!tab || tab.getAttribute('aria-selected') === 'true') return false
  ;(tab as HTMLElement).click()
  return true
}

export interface HighlightOptions {
  isRendered?: (el: Element) => boolean
  reduceMotion?: boolean
}

export function highlightPreview(doc: Document, focus: LiveFocus, options: HighlightOptions = {}): PreviewHit {
  doc.querySelectorAll(`.${PREVIEW_HIT_CLASS}`).forEach((el) => el.classList.remove(PREVIEW_HIT_CLASS))
  const block = PREVIEW_BLOCKS[focus.block]
  const root = doc.querySelector(block.selector)
  if (!root || !focus.mark) return 'none'
  const hit = focus.probe ? findProbeElement(root, focus.probe, options.isRendered) : null
  const target = hit ?? (block.outline ? root : null)
  if (!target) return 'none'
  target.classList.add(PREVIEW_HIT_CLASS)
  revealInFrame(doc, target, hit ? 'center' : 'start', options.reduceMotion ?? false)
  return hit ? 'text' : 'block'
}

export function revealInFrame(doc: Document, el: Element, align: 'center' | 'start', reduceMotion: boolean): void {
  const view = doc.defaultView
  if (!view) return
  const rect = el.getBoundingClientRect()
  const height = view.innerHeight
  const visible = align === 'center'
    ? rect.top >= TOP_OFFSET && rect.bottom <= height
    : rect.bottom > TOP_OFFSET && rect.top < height
  if (visible) return
  const offset = align === 'center' ? Math.max(TOP_OFFSET, (height - rect.height) / 2) : TOP_OFFSET
  view.scrollTo({ top: Math.max(0, view.scrollY + rect.top - offset), behavior: reduceMotion ? 'auto' : 'smooth' })
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix web run test:unit -- tests/preview-highlight.spec.ts`
Expected: 全過。若 happy-dom 的 `window.scrollY` 不能用 `defineProperty` 覆寫，改成 `vi.spyOn(window, 'scrollY', 'get').mockReturnValue(scrollY)`（innerHeight 同理），不要改實作。

- [ ] **Step 5: Commit**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; git add web/app/utils/preview-highlight.ts web/tests/preview-highlight.spec.ts; git commit -F - <<'EOF'
feat(web): 即時預覽用改到的文字找位置框起來，只捲預覽視窗

找不到就框整塊（整頁內容不框），首頁五校先切到那一校；不用 scrollIntoView，
避免連外層後台頁一起捲。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 10: `/preview` 即時預覽模式、後台 CSP 明寫 frame-src

**Files:**
- Modify: `web/app/composables/useDraftPreview.ts`
- Modify: `web/app/pages/preview.vue`
- Modify: `web/server/utils/security-headers.ts`
- Create: `web/tests/use-draft-preview.spec.ts`
- Create: `web/tests/preview-page-source.spec.ts`
- Modify: `web/tests/security-headers.spec.ts`

**Interfaces:**
- Consumes: Task 8（`createLiveReceiver`、`applyLiveDraft`、`LiveDraft`、`LiveOverride`、`LiveReceiver`、`isLivePreview`）、Task 9（`activatePreviewBlock`、`highlightPreview`）。
- Produces:
  ```ts
  // useDraftPreview.ts
  export interface DraftPreviewResult {
    authorized: boolean
    /** fixture 的五校代號（驗證即時預覽訊息的校區）；沒授權時是空陣列 */
    campusKeys: string[]
    render: ((date: string, live?: LiveOverride | null) => DraftPreviewRender) | null
  }
  ```

- [ ] **Step 1: 寫失敗的測試**

Create `web/tests/use-draft-preview.spec.ts`:

```ts
// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import { useDraftPreview } from '../app/composables/useDraftPreview'

// 2026-10-06 方向 D：render 可以多帶一份「還沒存的」內容，只蓋掉那一項，其他照舊是各自最新草稿。
const footerPayload = { tagline: '已存的標語', copyright: '©', bottom_note: '', campus_list_label: '五校聯絡' }

function stubFetch(authorized = true) {
  vi.stubGlobal('$fetch', vi.fn(async (url: string) => {
    if (url === '/api/website/v1/auth/me') {
      if (!authorized) throw new Error('401')
      return { csrf_token: 't', user: { id: 'u', email: 'a@example.invalid', role: 'super_admin', is_active: true, campus_keys: [] } }
    }
    if (url === '/api/site-fixture') return structuredClone(fixture)
    if (url.startsWith('/api/website/v1/admin/content-items/site_footer')) {
      return { id: 'i', kind: 'site_footer', campus_key: null, latest_version: 1, current_published_revision_id: 'r1', latest_revision: { id: 'r1', version: 1, payload: footerPayload, created_at: '2026-10-06T00:00:00Z' } }
    }
    if (url === '/api/website/v1/admin/media') return []
    throw new Error('404')
  }))
}

afterEach(() => vi.unstubAllGlobals())

describe('useDraftPreview 的即時內容', () => {
  it('沒帶即時內容時照舊顯示已存草稿；帶了只蓋掉那一項', async () => {
    stubFetch()
    const result = await useDraftPreview()
    expect(result.authorized).toBe(true)
    expect(result.campusKeys).toEqual(['yihua', 'minghua', 'chongde', 'international', 'renwu'])
    expect(result.render!('2026-10-06').content.footer.tagline).toBe('已存的標語')
    const live = result.render!('2026-10-06', { kind: 'site_footer', campusKey: null, payload: { ...footerPayload, tagline: '還沒存的標語' } })
    expect(live.content.footer.tagline).toBe('還沒存的標語')
    // 沒有被記住：下一次不帶就回到已存草稿。
    expect(result.render!('2026-10-06').content.footer.tagline).toBe('已存的標語')
  })

  it('分校內容只換那一校', async () => {
    stubFetch()
    const result = await useDraftPreview()
    const yihua = fixture.campuses.find((c) => c.key === 'yihua')!
    const profile = {
      name: yihua.name, district: '三民區', address: '高雄市三民區義華路68號', phone: '07-000-1234', intro: '', description: '',
      facebook: '', fb_note: '', line: '', map_url: '', cover: null, card_focus: null, hero_focus: null, line_art: null, line_art_colour: null, instagram: '', youtube: ''
    }
    const campuses = result.render!('2026-10-06', { kind: 'campus_profile', campusKey: 'yihua', payload: profile }).content.campuses
    expect(campuses.find((c) => c.key === 'yihua')!.phone).toBe('07-000-1234')
    const minghua = fixture.campuses.find((c) => c.key === 'minghua') as { phone?: string }
    expect(campuses.find((c) => c.key === 'minghua')!.phone).toBe(minghua.phone)
  })

  it('沒登入：不授權、沒有 render、沒有校區清單', async () => {
    stubFetch(false)
    expect(await useDraftPreview()).toEqual({ authorized: false, campusKeys: [], render: null })
  })
})
```

Create `web/tests/preview-page-source.spec.ts`:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 2026-10-06 方向 D：/preview 的即時預覽模式不能把草稿外洩。這幾條用原始碼檢查守住
// （頁面本身要 Nuxt 執行環境，行為另由 tests/stack/editor-live-preview.spec.ts 驗）。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const page = read('../app/pages/preview.vue')
const files = {
  page,
  live: read('../app/utils/preview-live.ts'),
  highlight: read('../app/utils/preview-highlight.ts'),
  composable: read('../app/composables/useDraftPreview.ts')
}

describe('/preview 即時預覽不外洩草稿', () => {
  it('整頁仍是 client-only、noindex', () => {
    expect(page).toContain('definePageMeta({ ssr: false })')
    expect(page).toContain("{ name: 'robots', content: 'noindex, nofollow' }")
  })

  it('不寫 storage、cookie、useState；postMessage 不用 *', () => {
    for (const [name, source] of Object.entries(files)) {
      expect(source, name).not.toMatch(/localStorage|sessionStorage|useState\(|useCookie\(|document\.cookie/)
      expect(source, name).not.toMatch(/postMessage\([^)]*['"]\*['"]/)
    }
  })

  it('拿到授權之後才掛 message listener；沒授權回 denied', () => {
    const ready = page.indexOf("status.value = 'ready'")
    const listen = page.indexOf("window.addEventListener('message'")
    expect(ready).toBeGreaterThan(0)
    expect(listen).toBeGreaterThan(ready)
    expect(page).toMatch(/status\.value = 'denied'\s*\n\s*receiver\?\.denied\(\)/)
  })

  it('即時預覽模式擋連結換頁、錯誤不換成整頁錯誤畫面；框線用預覽工具列的 token', () => {
    expect(page).toContain("document.addEventListener('click', stayOnPreview, true)")
    expect(page).toContain('onErrorCaptured(')
    expect(page).toMatch(/\.preview-live-hit \{[^}]*var\(--ivy-dev-bar-text\)[^}]*var\(--ivy-dev-bar\)/)
  })
})
```

`web/tests/security-headers.spec.ts`：在第一個 `describe` 裡加：

```ts
  it('後台可以用 iframe 嵌同源的 /preview（內容編輯右側預覽），/preview 只給同源嵌', () => {
    expect(ADMIN_CSP).toContain("frame-src 'self'")
    const preview = securityHeadersFor('/preview?embed=1&live=1', 'production')
    expect(preview['Content-Security-Policy']).toBe("frame-ancestors 'self'; base-uri 'self'; object-src 'none'")
    expect(preview['X-Frame-Options']).toBe('SAMEORIGIN')
  })
```

（若第一個 `describe` 的名稱不同，放進檔案裡第一個測 `securityHeadersFor` 的 `describe`。）

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix web run test:unit -- tests/use-draft-preview.spec.ts tests/preview-page-source.spec.ts tests/security-headers.spec.ts`
Expected: FAIL（`campusKeys` 不存在、preview.vue 沒有 listener、CSP 沒有 frame-src）。

- [ ] **Step 3: 改 `useDraftPreview.ts`**

1. import 加 `import { applyLiveDraft, type LiveOverride } from '~/utils/preview-live'`，並加一行 `export type { LiveOverride }`。
2. `DraftPreviewResult` 改成：
   ```ts
   export interface DraftPreviewResult {
     authorized: boolean
     /** fixture 的五校代號（驗證即時預覽訊息的校區）；沒授權時是空陣列 */
     campusKeys: string[]
     /**
      * 用某一天（台北日期 YYYY-MM-DD）判斷消息上下架，組出預覽內容；只抓一次資料，換日期不用重抓。
      * live：後台還沒存的那一項內容（即時預覽），只蓋掉那一項，不會被記住。
      */
     render: ((date: string, live?: LiveOverride | null) => DraftPreviewRender) | null
   }
   ```
3. 兩個 `return { authorized: false, render: null }` 都改成 `return { authorized: false, campusKeys: [], render: null }`。
4. 最後的 return 改成：
   ```ts
   return {
     authorized: true,
     campusKeys,
     render(date: string, live?: LiveOverride | null) {
       // 消息的上下架日期：官網公開 API 會先過濾，草稿 API 給的是原始內容，
       // 這裡照同一條規則過濾（全站與各校消息都要），預覽看到的才會和上線後一樣。
       return previewOverlay(content, live ? applyLiveDraft(overlay, live) : overlay, date, media)
     }
   }
   ```
   （`campusKeys` 是檔案裡既有的 `const campusKeys = content.campuses.map((c) => c.key)`。）

- [ ] **Step 4: 改 `security-headers.ts`**

`ADMIN_CSP` 陣列在 `"connect-src 'self'",` 之後加 `"frame-src 'self'",`，並在 `ADMIN_CSP` 上方註解最後加一句：「`frame-src 'self'`：內容編輯右側嵌同源的 `/preview` 即時預覽（2026-10-06 方向 D）；原本靠 default-src 退回，改成明寫，不允許嵌其他網站。」

- [ ] **Step 5: 改 `preview.vue` 的 script**

把 `<script setup lang="ts">` 整段換成：

```ts
<script setup lang="ts">
import type { DraftPreviewRender, LiveOverride } from '~/composables/useDraftPreview'
import { taipeiToday } from '~/utils/news-content'
import {
  isLivePreview,
  isPreviewEmbed,
  PREVIEW_MOBILE_HEIGHT,
  PREVIEW_MOBILE_WIDTH,
  previewDate,
  previewFrameSrc,
  previewPage,
  previewViewport,
  type PreviewViewport
} from '~/utils/draft-preview'
import { createLiveReceiver, type LiveDraft, type LiveReceiver } from '~/utils/preview-live'
import { activatePreviewBlock, highlightPreview } from '~/utils/preview-highlight'

// 私有草稿預覽殼：整頁 client-only，SSR 完全不輸出任何內容或管理端
// 資料，避免管理 session cookie／草稿內容混進公開快取或搜尋引擎快照。
definePageMeta({ ssr: false })

useHead({
  meta: [{ name: 'robots', content: 'noindex, nofollow' }]
})

// ?page=admission 入學資訊頁、?page=privacy 隱私權政策、?page=visit
// 預約頁的同意說明、?page=curriculum 特色教學頁、?page=about 關於常春藤頁、?page=environment 常春藤環境頁（校園探索），其餘預覽首頁。?viewport=mobile 用手機寬度看，?date= 換
// 判斷消息上下架的日期（參數規則在 utils/draft-preview.ts）。
// ?embed=1&live=1：後台內容編輯頁右側的即時預覽（2026-10-06 方向 D）。後台把還沒存的表單
// 用 postMessage 傳進來，只放在這一頁的記憶體裡（不進網址、storage 或任何快取），蓋在已存
// 草稿上重畫；頁面也跟著訊息切換，不重新載入。
const route = useRoute()
const router = useRouter()
const live = isLivePreview(route.query)
const liveDraft = shallowRef<LiveDraft | null>(null)
const page = computed(() => liveDraft.value?.page ?? previewPage(route.query))
const viewport = computed(() => previewViewport(route.query))
const embedded = computed(() => isPreviewEmbed(route.query))
const today = taipeiToday()
const date = computed(() => previewDate(route.query, today))
const frameSrc = computed(() => previewFrameSrc(route.query))
const mobileFrame = computed(() => viewport.value === 'mobile' && !embedded.value)

const status = ref<'checking' | 'denied' | 'ready'>('checking')
const render = shallowRef<((date: string, live?: LiveOverride | null) => DraftPreviewRender) | null>(null)
const rendered = computed(() => (render.value ? render.value(date.value, liveDraft.value) : null))
const draft = computed(() => rendered.value?.content ?? null)
const hiddenNews = computed(() => rendered.value?.hiddenNews ?? [])

function setQuery(patch: Record<string, string | undefined>) {
  void router.replace({ query: { ...route.query, ...patch } })
}

function setViewport(value: PreviewViewport) {
  setQuery({ viewport: value === 'mobile' ? 'mobile' : undefined })
}

function setDate(event: Event) {
  const value = (event.target as HTMLInputElement).value
  setQuery({ date: value && value !== today ? value : undefined })
}

// 套用一則即時草稿：先畫，再（首頁五校）切到那一校、等一幀，然後框出改到的位置並回報後台。
// 中途又來了新的一則就交給新的那則處理。
async function showLiveDraft(next: LiveDraft, receiver: LiveReceiver) {
  liveDraft.value = next
  await nextTick()
  if (liveDraft.value !== next) return
  if (activatePreviewBlock(document, next.focus)) await nextTick()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  if (liveDraft.value !== next) return
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  receiver.applied(next.seq, highlightPreview(document, next.focus, { reduceMotion }))
}

// 即時預覽裡點連結不換頁（預覽只看這一頁；iframe 的 sandbox 也不給換掉後台頁）。
function stayOnPreview(event: MouseEvent) {
  if (event.target instanceof Element && event.target.closest('a[href]')) event.preventDefault()
}

// 打字打到一半的內容可能讓某個區塊畫不出來：即時預覽時錯誤停在這裡，不換成整頁錯誤畫面。
onErrorCaptured(() => (live ? false : undefined))

let stopLive: (() => void) | null = null

onMounted(async () => {
  const result = await useDraftPreview()
  const receiver: LiveReceiver | null = live
    ? createLiveReceiver({ self: window, campusKeys: result.campusKeys, onDraft: (next) => void showLiveDraft(next, receiver!) })
    : null
  if (!result.authorized || !result.render) {
    status.value = 'denied'
    receiver?.denied()
    return
  }
  render.value = result.render
  status.value = 'ready'
  if (!receiver) return
  // 拿到授權、畫好之後才開始收訊息。
  const onMessage = (event: MessageEvent) => receiver.handle(event)
  window.addEventListener('message', onMessage)
  document.addEventListener('click', stayOnPreview, true)
  stopLive = () => {
    window.removeEventListener('message', onMessage)
    document.removeEventListener('click', stayOnPreview, true)
  }
  await nextTick()
  receiver.ready()
})

onBeforeUnmount(() => stopLive?.())
</script>
```

（template 不用改：已經用 `page`、`draft`、`embedded`；`page` 現在會跟著訊息換。）

- [ ] **Step 6: `preview.vue` 加框線樣式（非 scoped）**

在既有 `<style scoped>…</style>` 之後加：

```vue
<style>
/* 即時預覽：後台改到的那一格（找得到文字時）或那一塊。黃框＋外圈深色，淺色與深色底都看得到；
   顏色用預覽工具列同一組 token。 */
.preview-live-hit {
  outline: 3px solid var(--ivy-dev-bar-text);
  outline-offset: 3px;
  box-shadow: 0 0 0 9px var(--ivy-dev-bar);
}
</style>
```

- [ ] **Step 7: 跑測試確認通過**

Run: `cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix web run test:unit -- tests/use-draft-preview.spec.ts tests/preview-page-source.spec.ts tests/security-headers.spec.ts tests/draft-preview.spec.ts tests/preview-live.spec.ts; npm --prefix web run typecheck`
Expected: 測試全過；typecheck 結束碼 0。

- [ ] **Step 8: Commit**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; git add web/app/composables/useDraftPreview.ts web/app/pages/preview.vue web/server/utils/security-headers.ts web/tests/use-draft-preview.spec.ts web/tests/preview-page-source.spec.ts web/tests/security-headers.spec.ts; git commit -F - <<'EOF'
feat(web): /preview 加即時預覽模式，後台 CSP 明寫 frame-src

?embed=1&live=1 時，授權後才收後台的 postMessage，把還沒存的那一項蓋在已存草稿上重畫、
框出改到的位置並回報；連結不換頁、錯誤不換成整頁錯誤。沒登入照舊拒絕並回 denied。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 11: 後台端訊息格式與「改到哪裡」

**Files:**
- Create: `admin/src/composables/previewProtocol.ts`
- Create: `admin/src/composables/previewProbe.ts`
- Create: `admin/src/__tests__/previewProtocol.test.ts`

**Interfaces:**
- Consumes: Task 6 的 `PreviewBlock`、`PreviewPage`、`PREVIEW_TARGETS`；web 的 `web/app/utils/preview-live.ts`（只在測試裡讀原始碼比對）。
- Produces（Task 12 用）：
  ```ts
  // previewProtocol.ts
  export const PREVIEW_PROTOCOL_VERSION = 1
  export const PREVIEW_MESSAGE: { draft: 'ivy-preview:draft'; ready: 'ivy-preview:ready'; applied: 'ivy-preview:applied'; denied: 'ivy-preview:denied' }
  export interface PreviewFocus { block: PreviewBlock; campusKey: string | null; probe: string | null; mark: boolean }
  export interface PreviewDraftMessage { type: 'ivy-preview:draft'; v: 1; seq: number; kind: string; campusKey: string | null; payload: Record<string, unknown>; page: PreviewPage; focus: PreviewFocus }
  export type PreviewHit = 'text' | 'block' | 'none'
  export type PreviewReply = { type: 'ivy-preview:ready' } | { type: 'ivy-preview:denied' } | { type: 'ivy-preview:applied'; seq: number; hit: PreviewHit }
  export function buildDraftMessage(input: Omit<PreviewDraftMessage, 'type' | 'v'>): PreviewDraftMessage
  export function parsePreviewReply(data: unknown): PreviewReply | null
  // previewProbe.ts
  export const PROBE_LENGTH = 40
  export interface LastEdit { key: string; text: string | null }
  export function lastEdit(before: Record<string, unknown> | null, after: Record<string, unknown>): LastEdit | null
  export function probeText(text: string): string | null
  ```

- [ ] **Step 1: 寫失敗的測試**

Create `admin/src/__tests__/previewProtocol.test.ts`:

```ts
// 2026-10-06 方向 D：後台送進預覽 iframe 的訊息格式，和官網 web/app/utils/preview-live.ts 是同一份；
// 另外算出「這次改到哪個欄位、哪段文字」給預覽頁找位置。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { isProxy, reactive } from 'vue'
import { buildDraftMessage, parsePreviewReply, PREVIEW_MESSAGE, PREVIEW_PROTOCOL_VERSION } from '../composables/previewProtocol'
import { lastEdit, PROBE_LENGTH, probeText } from '../composables/previewProbe'
import { PREVIEW_TARGETS } from '../composables/previewTargets'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
const webProtocol = read('../../../web/app/utils/preview-live.ts')
const webDraftPreview = read('../../../web/app/utils/draft-preview.ts')

describe('和官網的訊息格式一致', () => {
  it('訊息名稱、版本', () => {
    for (const type of Object.values(PREVIEW_MESSAGE)) expect(webProtocol).toContain(`'${type}'`)
    expect(webProtocol).toMatch(new RegExp(`PREVIEW_PROTOCOL_VERSION = ${PREVIEW_PROTOCOL_VERSION}\\b`))
  })

  it('後台用到的內容種類、區塊、頁面，官網都認得', () => {
    const targets = Object.entries(PREVIEW_TARGETS).filter(([, list]) => list.length)
    for (const [kind] of targets) expect(webProtocol).toContain(`'${kind}'`)
    for (const block of new Set(targets.flatMap(([, list]) => list.map((t) => t.block)))) expect(webProtocol).toContain(`'${block}': {`)
    for (const page of new Set(targets.flatMap(([, list]) => list.map((t) => t.page)))) expect(webDraftPreview).toContain(`'${page}'`)
  })

  it('後台的找位置文字長度不超過官網收的上限', () => {
    const max = Number(/MAX_PROBE_CHARS = (\d+)/.exec(webProtocol)![1])
    expect(PROBE_LENGTH).toBeLessThanOrEqual(max)
  })
})

describe('buildDraftMessage', () => {
  it('payload 複製成純 JSON（reactive proxy 傳不過 postMessage）', () => {
    const form = reactive({ tagline: '新標語', links: [{ label: '首頁', href: '/' }] })
    const message = buildDraftMessage({
      seq: 1, kind: 'site_footer', campusKey: null, payload: form, page: 'home',
      focus: { block: 'site-footer', campusKey: null, probe: '新標語', mark: true },
    })
    expect(message.type).toBe('ivy-preview:draft')
    expect(message.v).toBe(1)
    expect(isProxy(message.payload)).toBe(false)
    expect(() => structuredClone(message)).not.toThrow()
    expect(message.payload).toEqual({ tagline: '新標語', links: [{ label: '首頁', href: '/' }] })
  })
})

describe('parsePreviewReply', () => {
  it('只認三種回覆、版本 1', () => {
    expect(parsePreviewReply({ type: 'ivy-preview:ready', v: 1 })).toEqual({ type: 'ivy-preview:ready' })
    expect(parsePreviewReply({ type: 'ivy-preview:denied', v: 1 })).toEqual({ type: 'ivy-preview:denied' })
    expect(parsePreviewReply({ type: 'ivy-preview:applied', v: 1, seq: 4, hit: 'text' })).toEqual({ type: 'ivy-preview:applied', seq: 4, hit: 'text' })
    for (const bad of [
      null, 'ready', { type: 'ivy-preview:ready', v: 2 }, { type: 'ivy-preview:draft', v: 1 },
      { type: 'ivy-preview:applied', v: 1, seq: 'x', hit: 'text' }, { type: 'ivy-preview:applied', v: 1, seq: 1, hit: 'all' },
    ]) expect(parsePreviewReply(bad)).toBeNull()
  })
})

describe('lastEdit／probeText', () => {
  it('第一次（沒有上一份）不算改', () => {
    expect(lastEdit(null, { tagline: 'a' })).toBeNull()
    expect(lastEdit({ tagline: 'a' }, { tagline: 'a' })).toBeNull()
  })

  it('最外層字串：回那個欄位與新的字', () => {
    expect(lastEdit({ tagline: '舊', phone: '1' }, { tagline: '新標語', phone: '1' })).toEqual({ key: 'tagline', text: '新標語' })
  })

  it('清單或物件裡的字：回最外層欄位與裡面改到的那段字', () => {
    const before = { articles: [{ title: '親子日', body: [{ text: 'a' }] }, { title: '開學', body: [] }] }
    const after = { articles: [{ title: '親子日', body: [{ text: 'a' }] }, { title: '開學典禮', body: [] }] }
    expect(lastEdit(before, after)).toEqual({ key: 'articles', text: '開學典禮' })
  })

  it('改的不是字（圖片、焦點、數字）：text 是 null', () => {
    expect(lastEdit({ card_focus: { x: 50, y: 50 } }, { card_focus: { x: 50, y: 12 } })).toEqual({ key: 'card_focus', text: null })
    expect(lastEdit({ home_display_count: 3 }, { home_display_count: 4 })).toEqual({ key: 'home_display_count', text: null })
  })

  it('拿掉的欄位也算改', () => {
    expect(lastEdit({ a: '1', b: '2' }, { a: '1' })).toEqual({ key: 'b', text: null })
  })

  it('probeText：第一個至少兩個字的行、壓空白、最多 40 字', () => {
    expect(probeText('\n  第一行  有空白 \n第二行')).toBe('第一行 有空白')
    expect(probeText('字'.repeat(60))).toHaveLength(PROBE_LENGTH)
    expect(probeText('a')).toBeNull()
    expect(probeText('')).toBeNull()
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/previewProtocol.test.ts`
Expected: FAIL（模組不存在）。

- [ ] **Step 3: 建 `previewProtocol.ts`**

Create `admin/src/composables/previewProtocol.ts`:

```ts
import type { PreviewBlock, PreviewPage } from './previewTargets'

// 內容編輯頁右側即時預覽的訊息格式（2026-10-06 方向 D）。和官網 web/app/utils/preview-live.ts
// 是同一份：改一邊要改另一邊，previewProtocol.test.ts 會讀官網那支比對。
// 後台送出一律指定 targetOrigin（預覽來源），不用 '*'；收回覆時由 useLivePreview 先驗來源。

export const PREVIEW_PROTOCOL_VERSION = 1
export const PREVIEW_MESSAGE = {
  draft: 'ivy-preview:draft',
  ready: 'ivy-preview:ready',
  applied: 'ivy-preview:applied',
  denied: 'ivy-preview:denied',
} as const

export interface PreviewFocus {
  block: PreviewBlock
  /** 首頁五校用來切到那一校 */
  campusKey: string | null
  /** 改到的那段文字（previewProbe.probeText），預覽頁用它找位置 */
  probe: string | null
  /** false＝改到的欄位不在這一塊，預覽不框不捲 */
  mark: boolean
}

export interface PreviewDraftMessage {
  type: typeof PREVIEW_MESSAGE.draft
  v: typeof PREVIEW_PROTOCOL_VERSION
  seq: number
  kind: string
  campusKey: string | null
  payload: Record<string, unknown>
  page: PreviewPage
  focus: PreviewFocus
}

export type PreviewHit = 'text' | 'block' | 'none'
export type PreviewReply =
  | { type: typeof PREVIEW_MESSAGE.ready }
  | { type: typeof PREVIEW_MESSAGE.denied }
  | { type: typeof PREVIEW_MESSAGE.applied; seq: number; hit: PreviewHit }

/** payload 複製成純 JSON：表單是 Vue 的 reactive proxy，postMessage 的 structured clone 傳不過去（DataCloneError）。 */
export function buildDraftMessage(input: Omit<PreviewDraftMessage, 'type' | 'v'>): PreviewDraftMessage {
  return {
    type: PREVIEW_MESSAGE.draft,
    v: PREVIEW_PROTOCOL_VERSION,
    ...input,
    payload: JSON.parse(JSON.stringify(input.payload)) as Record<string, unknown>,
    focus: { ...input.focus },
  }
}

export function parsePreviewReply(data: unknown): PreviewReply | null {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const message = data as Record<string, unknown>
  if (message.v !== PREVIEW_PROTOCOL_VERSION) return null
  if (message.type === PREVIEW_MESSAGE.ready || message.type === PREVIEW_MESSAGE.denied) return { type: message.type }
  if (message.type !== PREVIEW_MESSAGE.applied) return null
  if (typeof message.seq !== 'number' || !Number.isSafeInteger(message.seq)) return null
  if (message.hit !== 'text' && message.hit !== 'block' && message.hit !== 'none') return null
  return { type: PREVIEW_MESSAGE.applied, seq: message.seq, hit: message.hit }
}
```

- [ ] **Step 4: 建 `previewProbe.ts`**

Create `admin/src/composables/previewProbe.ts`:

```ts
// 即時預覽的「改哪格亮哪格」（2026-10-06 方向 D）：比較上一次送出的表單與這一次，找出改到的
// 最外層欄位，以及裡面改到的那段文字（清單、物件往裡找）。預覽頁拿這段文字找位置框起來。

/** 送給預覽頁找位置的文字最多幾個字（官網收到後最多留 80）。 */
export const PROBE_LENGTH = 40
const MAX_DEPTH = 6

export interface LastEdit {
  /** 改到的最外層欄位 */
  key: string
  /** 改到的那段文字；改的不是文字（圖片、焦點、數字）時是 null */
  text: string | null
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function changedText(before: unknown, after: unknown, depth: number): string | null {
  if (typeof after === 'string') return after
  if (depth >= MAX_DEPTH || after === null || typeof after !== 'object') return null
  const previous = before !== null && typeof before === 'object' ? (before as Record<string, unknown>) : {}
  const entries: [string, unknown][] = Array.isArray(after) ? after.map((value, index) => [String(index), value]) : Object.entries(after)
  for (const [key, value] of entries) {
    if (same(previous[key], value)) continue
    const text = changedText(previous[key], value, depth + 1)
    if (text !== null) return text
  }
  return null
}

export function lastEdit(before: Record<string, unknown> | null, after: Record<string, unknown>): LastEdit | null {
  if (!before) return null
  for (const key of Object.keys(after)) {
    if (!same(before[key], after[key])) return { key, text: changedText(before[key], after[key], 1) }
  }
  for (const key of Object.keys(before)) {
    if (!(key in after)) return { key, text: null }
  }
  return null
}

/** 第一個至少兩個字的行，壓掉多餘空白，最多 PROBE_LENGTH 字。 */
export function probeText(text: string): string | null {
  const line = text
    .split('\n')
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .find((part) => part.length >= 2)
  return line ? line.slice(0, PROBE_LENGTH) : null
}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/previewProtocol.test.ts`
Expected: 全過。（vitest 的 `server.fs.allow` 只管 `?raw` import；這裡用 `node:fs` 讀官網檔，不受限制。）

- [ ] **Step 6: Commit**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; git add admin/src/composables/previewProtocol.ts admin/src/composables/previewProbe.ts admin/src/__tests__/previewProtocol.test.ts; git commit -F - <<'EOF'
feat(admin): 即時預覽的訊息格式與「這次改到哪裡」

和官網 preview-live.ts 同一份格式（測試讀官網檔比對）；payload 先轉純 JSON，
從上一次送出的表單算出改到的欄位與文字。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 12: 接上即時預覽（握手、debounce、狀態）

**Files:**
- Create: `admin/src/composables/useLivePreview.ts`
- Modify: `admin/src/components/ContentEditor.vue`（換掉 Task 7 的 `previewSrc`／`previewFrameKey`、pane 綁定）
- Create: `admin/src/__tests__/useLivePreview.test.ts`
- Modify: `admin/src/__tests__/editorThreeColumns.test.ts`

**Interfaces:**
- Consumes: Task 11（`buildDraftMessage`、`parsePreviewReply`、`PREVIEW_MESSAGE`、`lastEdit`、`probeText`）、Task 6（`PreviewTarget`、`PreviewPaneState`、`previewFrameUrl`）、Task 7 的 ContentEditor 變數。
- Produces:
  ```ts
  export const LIVE_PREVIEW_DEBOUNCE_MS = 300
  export const LIVE_PREVIEW_READY_TIMEOUT_MS = 20_000
  export interface LivePreviewOptions {
    frame: Readonly<Ref<{ contentWindow: Pick<Window, 'postMessage'> | null } | null>>
    origin: string
    kind: string
    campusKey: Readonly<Ref<string | null>>
    form: Readonly<Ref<unknown>>
    target: Readonly<Ref<PreviewTarget | null>>
    win?: Pick<Window, 'addEventListener' | 'removeEventListener'>
    debounceMs?: number
    readyTimeoutMs?: number
  }
  export function useLivePreview(options: LivePreviewOptions): { state: Ref<PreviewPaneState>; appliedSeq: Ref<number> }
  ```

- [ ] **Step 1: 寫失敗的測試**

Create `admin/src/__tests__/useLivePreview.test.ts`:

```ts
// 2026-10-06 方向 D：後台把還沒存的表單送進預覽 iframe。握手、debounce、來源驗證、狀態。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, isProxy, nextTick, ref, shallowRef } from 'vue'
import { useLivePreview } from '../composables/useLivePreview'
import type { PreviewTarget } from '../composables/previewTargets'

const ORIGIN = 'https://ivy.example'
const FOOTER: PreviewTarget = { id: 'footer', label: '頁尾', page: 'home', block: 'site-footer' }
const HEADER: PreviewTarget = { id: 'header', label: '頁首預約鈕', page: 'home', block: 'site-header', fields: ['cta_label'] }

const wrappers: VueWrapper[] = []
// 只假 setTimeout：@vue/test-utils 的 flushPromises 用 setImmediate，一起假掉會卡住。
beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) })
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers.length = 0
  vi.useRealTimers()
})

function setup(target: PreviewTarget = FOOTER) {
  const win = new EventTarget()
  const frameWindow = { postMessage: vi.fn() }
  const frame = shallowRef<{ contentWindow: typeof frameWindow } | null>({ contentWindow: frameWindow })
  const form = ref<Record<string, unknown>>({ tagline: '舊標語', cta_label: '預約參觀', copyright: '©' })
  const targetRef = shallowRef<PreviewTarget | null>(target)
  let handle!: ReturnType<typeof useLivePreview>
  const wrapper = mount(defineComponent({
    setup() {
      handle = useLivePreview({ frame, origin: ORIGIN, kind: 'site_footer', campusKey: ref(null), form, target: targetRef, win: win as never })
      return () => h('div')
    },
  }))
  wrappers.push(wrapper)
  function reply(data: unknown, source: unknown = frameWindow, origin = ORIGIN) {
    const event = new Event('message')
    Object.assign(event, { data, source, origin })
    win.dispatchEvent(event)
  }
  return { win, frame, frameWindow, form, targetRef, wrapper, reply, handle: () => handle }
}

describe('useLivePreview', () => {
  it('還沒 ready 前不送；ready 後立刻送一則，targetOrigin 是預覽來源', async () => {
    const { frameWindow, form, reply, handle } = setup()
    expect(handle().state.value).toBe('connecting')
    form.value.tagline = '新標語'
    await vi.advanceTimersByTimeAsync(400)
    expect(frameWindow.postMessage).not.toHaveBeenCalled()
    reply({ type: 'ivy-preview:ready', v: 1 })
    expect(handle().state.value).toBe('live')
    expect(frameWindow.postMessage).toHaveBeenCalledOnce()
    const [message, targetOrigin] = frameWindow.postMessage.mock.calls[0]!
    expect(targetOrigin).toBe(ORIGIN)
    expect(message).toMatchObject({ type: 'ivy-preview:draft', v: 1, seq: 1, kind: 'site_footer', campusKey: null, page: 'home', payload: { tagline: '新標語' } })
    expect(message.focus).toEqual({ block: 'site-footer', campusKey: null, probe: null, mark: true })
  })

  it('打字 debounce 300ms：連打兩次只送一則，帶改到的文字；送的是純 JSON', async () => {
    const { frameWindow, form, reply } = setup()
    reply({ type: 'ivy-preview:ready', v: 1 })
    frameWindow.postMessage.mockClear()
    form.value.tagline = '新'
    await nextTick()
    form.value.tagline = '新標語\n第二行'
    await vi.advanceTimersByTimeAsync(299)
    expect(frameWindow.postMessage).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(frameWindow.postMessage).toHaveBeenCalledOnce()
    const [message] = frameWindow.postMessage.mock.calls[0]!
    expect(message.seq).toBe(2)
    expect(message.focus.probe).toBe('新標語')
    expect(isProxy(message.payload)).toBe(false)
    expect(() => structuredClone(message)).not.toThrow()
  })

  it('別的 origin、不是這個 iframe 送來的回覆一律不理', () => {
    const { reply, handle } = setup()
    reply({ type: 'ivy-preview:ready', v: 1 }, { postMessage: vi.fn() })
    reply({ type: 'ivy-preview:ready', v: 1 }, undefined, 'https://evil.example')
    reply({ type: 'ivy-preview:ready', v: 9 })
    expect(handle().state.value).toBe('connecting')
  })

  it('denied → failed；20 秒沒 ready → saved', async () => {
    const denied = setup()
    denied.reply({ type: 'ivy-preview:denied', v: 1 })
    expect(denied.handle().state.value).toBe('failed')
    const slow = setup()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(slow.handle().state.value).toBe('saved')
  })

  it('applied 記下最大的 seq', () => {
    const { reply, handle } = setup()
    reply({ type: 'ivy-preview:applied', v: 1, seq: 3, hit: 'text' })
    reply({ type: 'ivy-preview:applied', v: 1, seq: 2, hit: 'block' })
    expect(handle().appliedSeq.value).toBe(3)
  })

  it('分頁有 fields：改到別的欄位時不框不捲；切分頁立刻送', async () => {
    const { frameWindow, form, reply, targetRef } = setup(HEADER)
    reply({ type: 'ivy-preview:ready', v: 1 })
    form.value.copyright = '© 2026'
    await vi.advanceTimersByTimeAsync(300)
    expect(frameWindow.postMessage.mock.calls.at(-1)![0].focus).toEqual({ block: 'site-header', campusKey: null, probe: null, mark: false })
    form.value.cta_label = '預約看看'
    await vi.advanceTimersByTimeAsync(300)
    expect(frameWindow.postMessage.mock.calls.at(-1)![0].focus).toEqual({ block: 'site-header', campusKey: null, probe: '預約看看', mark: true })
    const count = frameWindow.postMessage.mock.calls.length
    targetRef.value = FOOTER
    await nextTick()
    expect(frameWindow.postMessage).toHaveBeenCalledTimes(count + 1)
    expect(frameWindow.postMessage.mock.calls.at(-1)![0].focus.block).toBe('site-footer')
  })

  it('換了 iframe（換校、重新載入）：回到 connecting，舊 iframe 的 ready 不算', async () => {
    const { frame, frameWindow, reply, handle } = setup()
    reply({ type: 'ivy-preview:ready', v: 1 })
    const next = { postMessage: vi.fn() }
    frame.value = { contentWindow: next }
    await nextTick()
    expect(handle().state.value).toBe('connecting')
    reply({ type: 'ivy-preview:ready', v: 1 }, frameWindow)
    expect(handle().state.value).toBe('connecting')
    reply({ type: 'ivy-preview:ready', v: 1 }, next)
    expect(handle().state.value).toBe('live')
    expect(next.postMessage).toHaveBeenCalledOnce()
  })

  it('卸載後不再收訊息', () => {
    const { reply, handle, wrapper } = setup()
    const state = handle().state
    wrapper.unmount()
    wrappers.length = 0
    reply({ type: 'ivy-preview:ready', v: 1 })
    expect(state.value).toBe('connecting')
  })
})
```

`editorThreeColumns.test.ts` 調整：

1. 第一則 `it('1280 以上、同源、有對應預覽頁…')` 的 iframe 網址與狀態改成：
   ```ts
       expect(pane.get('iframe').attributes('src')).toBe(`${window.location.origin}/preview?embed=1&live=1&page=home`)
       expect(pane.get('.live-preview__meta').text()).toBe('正在載入預覽…')
   ```
2. `it('兩個預覽分頁：切到另一頁換網址…')` 改名 `'還沒接上即時預覽時：切分頁換網址；寬度切換記在這台瀏覽器'`（內容不變：狀態是 connecting，切分頁仍換網址）。
3. `it('存成新的一版後重新載入預覽…')` 整則換成：
   ```ts
     it('預覽頁回 ready：改寫成「預覽的是還沒存的修改」，把目前表單送進去', async () => {
       const form = ref({ tagline: '標語' })
       const wrapper = await mountEditor(editorState({ form }))
       const frame = wrapper.get('iframe').element as HTMLIFrameElement
       const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {})
       const ready = new Event('message')
       Object.assign(ready, { data: { type: 'ivy-preview:ready', v: 1 }, origin: window.location.origin, source: frame.contentWindow })
       window.dispatchEvent(ready)
       await flushPromises()
       expect(wrapper.get('.live-preview__meta').text()).toBe('預覽的是還沒存的修改')
       expect(post).toHaveBeenCalledWith(expect.objectContaining({ type: 'ivy-preview:draft', kind: 'site_footer', payload: { tagline: '標語' } }), window.location.origin)
     })

     it('預覽頁沒接上（saved）時，存成新的一版就重新載入預覽', async () => {
       // 只假 setTimeout：@vue/test-utils 的 flushPromises 用 setImmediate，一起假掉會卡住。
       vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
       try {
         const latestRevisionId = ref('r1')
         const wrapper = await mountEditor(editorState({ latestRevisionId: computed(() => latestRevisionId.value) }))
         await vi.advanceTimersByTimeAsync(20_000)
         expect(wrapper.get('.live-preview__meta').text()).toBe('預覽的是上次儲存的草稿')
         const first = wrapper.get('iframe').element
         latestRevisionId.value = 'r2'
         await flushPromises()
         expect(wrapper.get('iframe').element).not.toBe(first)
       } finally {
         vi.useRealTimers()
       }
     })
   ```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/useLivePreview.test.ts src/__tests__/editorThreeColumns.test.ts`
Expected: FAIL（`useLivePreview` 不存在；ContentEditor 還是 `live: false`）。

- [ ] **Step 3: 建 `useLivePreview.ts`**

Create `admin/src/composables/useLivePreview.ts`:

```ts
import { onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { buildDraftMessage, parsePreviewReply, PREVIEW_MESSAGE } from './previewProtocol'
import { lastEdit, probeText } from './previewProbe'
import type { PreviewPaneState, PreviewTarget } from './previewTargets'

// 內容編輯頁右側的即時預覽（2026-10-06 方向 D）：等預覽頁說 ready，之後把「還沒存的表單」
// debounce 300ms 送進 iframe；換預覽分頁立刻送。只理同源、而且是目前這個 iframe 的回覆。
// 20 秒沒有 ready（官網還是舊版、太慢）就當成只看得到已存草稿；預覽頁拒絕（沒登入）就是 failed。

export const LIVE_PREVIEW_DEBOUNCE_MS = 300
export const LIVE_PREVIEW_READY_TIMEOUT_MS = 20_000

interface FrameLike {
  contentWindow: Pick<Window, 'postMessage'> | null
}

export interface LivePreviewOptions {
  frame: Readonly<Ref<FrameLike | null>>
  /** 預覽來源（previewTargets.livePreviewOrigin）；空字串＝不嵌，什麼都不送 */
  origin: string
  kind: string
  campusKey: Readonly<Ref<string | null>>
  form: Readonly<Ref<unknown>>
  target: Readonly<Ref<PreviewTarget | null>>
  win?: Pick<Window, 'addEventListener' | 'removeEventListener'>
  debounceMs?: number
  readyTimeoutMs?: number
}

export function useLivePreview(options: LivePreviewOptions) {
  const win = options.win ?? window
  const state = ref<PreviewPaneState>('connecting')
  const appliedSeq = ref(0)
  let seq = 0
  let sendTimer: ReturnType<typeof setTimeout> | null = null
  let readyTimer: ReturnType<typeof setTimeout> | null = null
  // 上一次送出的表單：用來算這次改到哪裡。iframe 重建時清掉。
  let lastPayload: Record<string, unknown> | null = null
  let lastKey: string | null = null
  let lastProbe: string | null = null

  function clearSend() {
    if (sendTimer) clearTimeout(sendTimer)
    sendTimer = null
  }
  function clearReady() {
    if (readyTimer) clearTimeout(readyTimer)
    readyTimer = null
  }

  // postMessage 會做 structured clone：Vue 的 reactive proxy 傳不過去（DataCloneError），先轉成純 JSON。
  function snapshot(): Record<string, unknown> {
    const value = options.form.value
    return value && typeof value === 'object' ? (JSON.parse(JSON.stringify(value)) as Record<string, unknown>) : {}
  }

  function send() {
    clearSend()
    const target = options.target.value
    const frameWindow = options.frame.value?.contentWindow
    if (state.value !== 'live' || !target || !frameWindow || !options.origin) return
    const payload = snapshot()
    const edit = lastEdit(lastPayload, payload)
    lastPayload = payload
    if (edit) {
      lastKey = edit.key
      lastProbe = edit.text === null ? null : probeText(edit.text)
    }
    // 分頁有 fields 時，改到不在這一塊的欄位就不框不捲（例如網站描述只用在搜尋結果）。
    const inTarget = !target.fields || lastKey === null || target.fields.includes(lastKey)
    const campusKey = options.campusKey.value
    seq += 1
    frameWindow.postMessage(
      buildDraftMessage({
        seq,
        kind: options.kind,
        campusKey,
        payload,
        page: target.page,
        focus: { block: target.block, campusKey, probe: inTarget ? lastProbe : null, mark: inTarget },
      }),
      options.origin,
    )
  }

  function schedule() {
    clearSend()
    sendTimer = setTimeout(send, options.debounceMs ?? LIVE_PREVIEW_DEBOUNCE_MS)
  }

  // iframe（重新）建立：等預覽頁說 ready；太久沒回就當成只看得到已存草稿。
  function connect() {
    state.value = 'connecting'
    lastPayload = null
    lastKey = null
    lastProbe = null
    clearSend()
    clearReady()
    readyTimer = setTimeout(() => {
      if (state.value === 'connecting') state.value = 'saved'
    }, options.readyTimeoutMs ?? LIVE_PREVIEW_READY_TIMEOUT_MS)
  }

  function onMessage(event: Event) {
    const { origin, source, data } = event as MessageEvent
    const frameWindow = options.frame.value?.contentWindow
    if (!options.origin || origin !== options.origin || !frameWindow || source !== frameWindow) return
    const reply = parsePreviewReply(data)
    if (!reply) return
    if (reply.type === PREVIEW_MESSAGE.ready) {
      clearReady()
      state.value = 'live'
      send()
    } else if (reply.type === PREVIEW_MESSAGE.applied) {
      appliedSeq.value = Math.max(appliedSeq.value, reply.seq)
    } else {
      clearReady()
      state.value = 'failed'
    }
  }

  win.addEventListener('message', onMessage)
  watch(
    options.frame,
    (frame) => {
      if (frame) connect()
      else clearReady()
    },
    { immediate: true },
  )
  watch(options.form, schedule, { deep: true })
  watch(() => options.target.value?.id ?? null, () => send())
  onBeforeUnmount(() => {
    win.removeEventListener('message', onMessage)
    clearSend()
    clearReady()
  })

  return { state, appliedSeq }
}
```

- [ ] **Step 4: 改 `ContentEditor.vue`**

1. import 加 `import { useLivePreview } from '../composables/useLivePreview'`。
2. 把 Task 7 的兩行
   ```ts
   // 這一階段預覽看的是上次儲存的草稿：換分頁換網址，存成新的一版就重新載入（Task 12 換成即時預覽）。
   const previewSrc = computed(…)
   const previewFrameKey = computed(…)
   ```
   換成：
   ```ts
   // 即時預覽：把還沒存的表單送進 iframe（useLivePreview）。iframe 只在換校、重新載入時重建；
   // 換預覽分頁用訊息切，不重新載入。預覽頁還沒接上（舊版官網、太慢）時，切分頁照舊換網址，
   // 存成新的一版也重新載入，至少看得到剛存的草稿。
   const previewFrame = ref<HTMLIFrameElement | null>(null)
   const live = useLivePreview({
     frame: previewFrame,
     origin: previewOrigin ?? '',
     kind: props.editor.kind ?? '',
     campusKey: computed(() => props.editor.campusKey?.value ?? null),
     form: props.editor.form ?? ref(null),
     target: currentTarget,
   })
   const previewState = live.state
   const previewReload = ref(0)
   const previewFrameKey = computed(() => `${props.editor.campusKey?.value ?? ''}|${previewReload.value}`)
   const previewSrc = ref('')
   function framePageUrl(): string {
     return previewOrigin && currentTarget.value ? previewFrameUrl(previewOrigin, currentTarget.value.page, { live: true }) : ''
   }
   watch(previewFrameKey, () => { previewSrc.value = framePageUrl() }, { immediate: true })
   watch(currentTarget, () => {
     if (previewState.value !== 'live') previewSrc.value = framePageUrl()
   })
   watch(latestRevisionId, () => {
     if (previewState.value === 'saved') previewReload.value += 1
   })
   ```
3. template 的 `<LivePreviewPane …>` 把 `state="saved"` 換成 `:state="previewState"`，並加 `@frame="previewFrame = $event"`、`@retry="previewReload += 1"`。

- [ ] **Step 5: 跑測試確認通過**

Run: `cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/useLivePreview.test.ts src/__tests__/editorThreeColumns.test.ts src/__tests__/livePreviewPane.test.ts src/__tests__/previewProtocol.test.ts; npm --prefix admin run typecheck`
Expected: 測試全過；typecheck 結束碼 0。

- [ ] **Step 6: Commit**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; git add admin/src/composables/useLivePreview.ts admin/src/components/ContentEditor.vue admin/src/__tests__/useLivePreview.test.ts admin/src/__tests__/editorThreeColumns.test.ts; git commit -F - <<'EOF'
feat(admin): 內容編輯右側接上即時預覽

預覽頁回 ready 後，把還沒存的表單 debounce 300ms 送進 iframe，換分頁立刻送；
只理同源、目前這個 iframe 的回覆。沒接上時寫「預覽的是上次儲存的草稿」，被拒絕時可重新載入。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 13: 端到端：改欄位→預覽即時變、15 頁接得上、來源驗證

**Files:**
- Create: `tests/stack/editor-live-preview.spec.ts`

**Interfaces:**
- Consumes: `tests/stack/pages.ts` 的 `openAs`、`gotoAdmin`、`answerMessageBox`；`stack-env.ts` 的帳號。整個 Phase 1、2。

- [ ] **Step 1: 寫測試**

Create `tests/stack/editor-live-preview.spec.ts`:

```ts
import { expect, test } from '@playwright/test'
import { answerMessageBox, gotoAdmin, openAs } from './pages'

// 2026-10-06 方向 D：內容編輯右側即時預覽。改欄位不用存檔，右邊的官網預覽就換掉、框出那一格；
// 沒存檔前公開資料不變；預覽頁只聽外層後台頁（同源、parent）的訊息；1280 以下沒有預覽欄。

const FRAME = 'iframe[title="官網預覽"]'

test('頁尾文字：改標語，預覽即時換掉、框出那一格；沒有存檔、沒有公開、焦點與捲動留在後台', async ({ browser }) => {
  const { context, page } = await openAs(browser, 'super_admin')
  const saves: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/content-items/')) saves.push(request.url())
  })
  await gotoAdmin(page, '/content/site-footer', '頁尾文字')
  const pane = page.getByRole('complementary', { name: '官網預覽' })
  await expect(pane.getByText('預覽的是還沒存的修改')).toBeVisible({ timeout: 30_000 })
  const frame = page.frameLocator(FRAME)
  await expect(frame.locator('footer.footer')).toBeVisible()

  const field = page.getByRole('textbox', { name: '標語' })
  const marker = `即時預覽測試 ${Date.now()}`
  const scrollBefore = await page.evaluate(() => window.scrollY)
  await field.fill(marker)
  await expect(frame.locator('footer.footer')).toContainText(marker, { timeout: 5_000 })
  await expect(frame.locator('.preview-live-hit')).toContainText(marker)
  await expect(page.locator('.editor__actions')).toContainText('草稿有 1 處修改：標語')
  await expect(field).toBeFocused()
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore)

  expect(saves).toEqual([])
  expect(await (await page.request.get('/api/public-site')).text()).not.toContain(marker)

  await page.getByRole('button', { name: '放棄修改' }).click()
  await answerMessageBox(page, '放棄 1 個欄位的修改？', '放棄修改')
  await expect(frame.locator('footer.footer')).not.toContainText(marker)
  await context.close()
})

test('五校介紹（義華）：改參觀專線，切到「頁尾」分頁看到新電話；首頁五校切到義華', async ({ browser }) => {
  const { context, page } = await openAs(browser, 'super_admin')
  await gotoAdmin(page, '/content/campus-profile?campus=yihua', '五校介紹')
  const pane = page.getByRole('complementary', { name: '官網預覽' })
  await expect(pane.getByText('預覽的是還沒存的修改')).toBeVisible({ timeout: 30_000 })
  const frame = page.frameLocator(FRAME)
  await expect(frame.locator('#campus-tab-yihua')).toHaveAttribute('aria-selected', 'true')

  const phone = `07-${String(Date.now()).slice(-3)}-${String(Date.now()).slice(-7, -3)}`
  await page.getByRole('textbox', { name: '參觀專線' }).fill(phone)
  await pane.getByText('頁尾', { exact: true }).click()
  await expect(frame.locator('footer.footer')).toContainText(phone, { timeout: 5_000 })
  await expect(frame.locator('.preview-live-hit')).toContainText(phone)
  // 目錄上「基本資料」打點。
  await expect(page.getByRole('navigation', { name: '這一頁的段落' }).getByRole('link', { name: /基本資料/ })).toContainText('（有修改）')
  await page.getByRole('button', { name: '放棄修改' }).click()
  await answerMessageBox(page, '放棄 1 個欄位的修改？', '放棄修改')
  await context.close()
})

test('每個內容編輯頁的右側預覽都接得上；校園探索沒有預覽欄', async ({ browser }, testInfo) => {
  test.setTimeout(300_000)
  const EDITORS: [path: string, heading: string, tabs: string[]][] = [
    ['/content/home-hero', '首頁大圖標語', ['首頁首屏']],
    ['/content/home-about', '關於常春藤', ['首頁關於常春藤']],
    ['/content/day-experience', '孩子的一天', ['首頁孩子的一天']],
    ['/content/home-campus-board', '首頁五校區塊', ['首頁五校']],
    ['/content/home-news', '最新消息與活動', ['首頁最新消息']],
    ['/content/campus-profile?campus=yihua', '五校介紹', ['首頁五校', '頁尾']],
    ['/content/campus-news?campus=yihua', '各校消息與活動', ['首頁最新消息']],
    ['/content/booking-content', '預約文案', ['預約頁', '頁首預約鈕']],
    ['/content/admission', '入學資訊頁', ['入學資訊頁']],
    ['/content/privacy-policy', '隱私權政策', ['隱私權政策頁']],
    ['/content/curriculum-page', '特色教學頁', ['特色教學頁']],
    ['/content/about-page', '關於常春藤頁', ['關於常春藤頁']],
    ['/content/site-footer', '頁尾文字', ['頁尾']],
    ['/content/site-meta', '網站標題與電話', ['頁首']],
  ]
  const { context, page } = await openAs(browser, 'super_admin')
  for (const [path, heading, tabs] of EDITORS) {
    await test.step(path, async () => {
      await gotoAdmin(page, path, heading)
      const pane = page.getByRole('complementary', { name: '官網預覽' })
      await expect(pane.getByText('預覽的是還沒存的修改')).toBeVisible({ timeout: 30_000 })
      for (const tab of tabs) await expect(pane.getByText(tab, { exact: true })).toBeVisible()
      await testInfo.attach(`預覽 ${path}`, { body: await page.screenshot(), contentType: 'image/png' })
    })
  }
  await gotoAdmin(page, '/content/campus-tour', '校園探索')
  await expect(page.getByRole('complementary', { name: '官網預覽' })).toHaveCount(0)
  await context.close()
})

test('1279 寬沒有預覽欄，保留「存草稿並預覽」', async ({ browser }) => {
  const { context, page } = await openAs(browser, 'super_admin', { viewport: { width: 1279, height: 900 } })
  await gotoAdmin(page, '/content/site-footer', '頁尾文字')
  await expect(page.getByRole('complementary', { name: '官網預覽' })).toHaveCount(0)
  await page.getByRole('textbox', { name: '標語' }).fill(`窄螢幕 ${Date.now()}`)
  await expect(page.getByRole('button', { name: '存草稿並預覽 ↗' })).toBeVisible()
  await context.close()
})

test('/preview 即時模式：頂層自己送的訊息不套用；沒登入照舊拒絕；no-store、noindex、只給同源嵌', async ({ browser }) => {
  const { context, page } = await openAs(browser, 'super_admin')
  const response = await page.request.get('/preview?embed=1&live=1')
  expect(response.headers()['cache-control']).toBe('private, no-store')
  expect(response.headers()['x-robots-tag']).toContain('noindex')
  expect(response.headers()['x-frame-options']).toBe('SAMEORIGIN')

  await page.goto('/preview?embed=1&live=1')
  await expect(page.locator('footer.footer')).toBeVisible({ timeout: 30_000 })
  await page.evaluate(() => {
    window.postMessage({
      type: 'ivy-preview:draft', v: 1, seq: 99, kind: 'site_footer', campusKey: null,
      payload: { tagline: '頂層偽造的標語', copyright: '', bottom_note: '', campus_list_label: '' },
      page: 'home', focus: { block: 'site-footer', campusKey: null, probe: null, mark: true },
    }, location.origin)
  })
  await page.waitForTimeout(500)
  await expect(page.locator('footer.footer')).not.toContainText('頂層偽造的標語')
  await context.close()

  const visitor = await openAs(browser, null)
  await visitor.page.goto('/preview?embed=1&live=1')
  await expect(visitor.page.getByText('這個頁面只給已登入的後台管理者看草稿內容。')).toBeVisible({ timeout: 30_000 })
  await visitor.context.close()
})
```

- [ ] **Step 2: 安裝 stack 依賴、建置、只跑這一支**

Run（依序，每一步看到結束碼 0 再下一步；build 會一直有輸出，不會被 10 分鐘無輸出的 watchdog 擋）：
```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm ci
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006/backend; uv sync
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm run e2e:build
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; E2E_DB_NAME=ivy_website_editorpreview1006_test E2E_API_PORT=8791 E2E_WEB_PORT=3791 npx playwright test -c playwright.stack.config.ts tests/stack/editor-live-preview.spec.ts
```
Expected: setup 專案＋5 項全過。若 `footer.footer` 的 `toContainText` 逾時，先用 `--trace on` 重跑看 iframe 的 console，**不要**把等待時間拉長蓋過問題；若是 `/preview` 在 iframe 裡被 CSP／XFO 擋，回頭檢查 Task 10 Step 4。

- [ ] **Step 3: Commit**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; git add tests/stack/editor-live-preview.spec.ts; git commit -F - <<'EOF'
test(stack): 內容編輯即時預覽端到端

改頁尾標語與五校參觀專線不存檔，預覽即時換掉並框出；15 個編輯頁都接得上、
校園探索沒有預覽欄；1279 寬沒有預覽欄；頂層偽造的訊息不套用、沒登入照舊拒絕。

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 14: 文件（README、DESIGN、驗收）

**Files:**
- Modify: `README.md`（頂部加日期段）
- Modify: `DESIGN.md`（新章節＋舊章節加「已由…取代」註記）
- Modify: `docs/website-admin/acceptance.md`（檔尾加驗收小節）

- [ ] **Step 1: `README.md` 頂部加一段**（放在第一個 `## 2026-10-06 …` 之前）

```markdown
## 2026-10-06 內容編輯三欄＋即時預覽（方向 D，`feature/admin-editor-preview-20261006`，未部署）

使用者看完後台結構層比稿（`design/admin-ux-directions-20261006/`）選了 D。計畫 `docs/superpowers/plans/2026-10-06-admin-editor-preview.md`，規則見 DESIGN.md「官網後台內容編輯：三欄＋即時預覽」。

- **版面**（`ContentEditor.vue`）：1280 以上、後台與官網同源時改成左段落目錄（和官網不同的段落打點）、中表單、右官網預覽；1280 以下維持原本版面與「存草稿並預覽」。五校介紹新增「基本資料／封面照片與建築線稿／社群」三段目錄。校園探索不放預覽欄。
- **動作列**：直接寫「草稿有 N 處修改：欄位A、欄位B」（和官網那一版比，最多列 4 個），發布確認框只寫欄位名、不再列改前→改後；核准並發布照舊列完整差異。
- **即時預覽**：右欄是同源 iframe `/preview?embed=1&live=1`，後台把還沒存的表單 debounce 300ms 用 postMessage 傳進去；預覽頁只收同源、外層後台頁的訊息，驗證格式後蓋在已存草稿上重畫，用改到的文字找位置框起來（找不到就框整塊、五校卡切到那一校）。桌機／手機切換，預設手機。
- **官網**：`web/app/utils/preview-live.ts`（訊息格式與驗證）、`preview-highlight.ts`（找位置、只捲預覽視窗）、`pages/preview.vue` 即時模式；後台 CSP 明寫 `frame-src 'self'`。
- **驗證**：見 `docs/website-admin/acceptance.md`「內容編輯三欄＋即時預覽」（Task 15 補數字）。
- **限制**：本機 `npm run dev`（後台 5173、官網 3000 不同源）看不到預覽欄，要看用 `npm run e2e:build` 的同源建置；「改哪格亮哪格」對圖片、焦點、經過轉換的文字只框整塊。
```

- [ ] **Step 2: `DESIGN.md` 加新章節**（放在 `## 官網後台總覽：今天的行程板（2026-10-06…）` 之前，成為第一個 `##`）

```markdown
## 官網後台內容編輯：三欄＋即時預覽（2026-10-06，方向 D，`feature/admin-editor-preview-20261006`）

使用者看完結構層比稿選 D（`design/admin-ux-directions-20261006/d-editor.html`）。之後要照著做的：

- **1280 以上三欄**（後台與官網同源、這種內容有對應預覽頁時）：左段落目錄 152px（黏住）、中表單 420–560px（沒有目錄時 440–640px）、右官網預覽至少 320px（黏住，高度扣掉黏底動作列）。目錄一律在左（取代第八輪「1280 以上在表單右側」），目前段落用淺色主色底（`--el-color-primary-light-9`）＋深青藍字，不用左框。1280 以下維持兩欄／單欄、沒有預覽欄，照舊用狀態列「存草稿並預覽 ↗」。
- **目錄打點＝這一段和官網不同**，和動作列同一個基準。`EditorSection.fields` 寫這一段編輯的最外層欄位或清單某一項（`sections.2`）；新增長頁面或新欄位時一併分段，`editorSectionFields.test.ts` 會擋漏掉的欄位。「還沒儲存」仍由狀態列講。
- **動作列寫出改了哪些欄位**：「草稿有 N 處修改：欄位A、欄位B」＝表單和官網那一版比（`useContentItem.draftChanges`，同發布確認框的 `diffPayload`），最多 4 個，其餘「…」，完整清單在 `title`；手機單行省略。從沒發布過寫「還沒發布過…」；讀不到官網版退回「改了 N 個欄位：…」（和上次儲存比）。不寫「自動存於」（沒有自動儲存）。因此草稿還沒發布時，**載入就讀一次官網那一版**（取代 09-28「開確認框前才讀」）。
- **發布確認框只寫欄位名**（「和官網目前的內容相比，會更新 2 個欄位：A、B。發布後家長立刻看到。」），不再列改前→改後；**核准並發布照舊列完整差異**；讀不到官網版時退回舊差異框。
- **即時預覽**：右欄是 `/preview?embed=1&live=1&page=…` 的同源 iframe（桌機 1280 寬、手機 390 寬縮放；預設手機，記在這台瀏覽器）。後台把還沒存的表單 debounce 300ms 用 postMessage 傳進去，只覆蓋目前這一項內容（其他內容照舊是各自最新草稿）；換預覽分頁只送訊息、不重新載入；換校、重新載入時 iframe 重建。分頁對照表在 `admin/src/composables/previewTargets.ts`，訊息格式在 `admin/src/composables/previewProtocol.ts` 與 `web/app/utils/preview-live.ts`（兩邊同一份，測試比對）。校園探索（寬版編輯器）不放預覽欄；五校介紹不做「預約頁」分頁（`/preview?page=visit` 沒有真正的預約表單）。
- **改哪格亮哪格**：拿改到的那段文字在目前分頁對應的區塊裡找最深、畫得出來的元素框起來；找不到（圖片、焦點、文字被轉換）框整塊；五校卡先切到那一校；整頁內容（入學、特色教學、關於、隱私）找不到時不框不捲；分頁寫了 `fields` 的（網站標題與電話、預約文案）改到不在那一塊的欄位時不框不捲。只捲預覽頁自己的視窗（`scrollTo`），**不用 `scrollIntoView`**（同源 iframe 會連後台頁一起捲）；預覽不搶焦點。
- **資安**：預覽頁拿到授權後才收訊息，只收 `origin === location.origin` 且 `source === window.parent` 的；驗證版本、內容種類、校區、區塊（`hasOwnProperty`）、大小，舊的 `seq` 丟掉。後台只理同源、目前這個 iframe 的回覆。postMessage 一律指定 targetOrigin。草稿不進網址、storage、cookie、快取、SSR、telemetry。iframe `sandbox="allow-scripts allow-same-origin"`、`tabindex=-1`；預覽頁的連結點了不換頁。後台 CSP 明寫 `frame-src 'self'`；`/preview` 維持 `frame-ancestors 'self'`、`X-Frame-Options: SAMEORIGIN`。後台與官網不同源（本機 5173 對 3000）時不嵌。
- **狀態**：預覽頁回 ready 前寫「正在載入預覽…」；接上後「預覽的是還沒存的修改」；20 秒沒回寫「預覽的是上次儲存的草稿」（存成新的一版會重新載入）；被拒絕（沒登入）蓋一層「預覽沒有載入，可能是登入逾時。」＋「重新載入預覽」。
- 取代：第八輪「1280 以上在表單右側」；09-28「發布與核准的確認框一律逐欄列改前→改後」的發布部分（核准不變）；第九輪「寬螢幕右側嵌即時預覽要動 web 的 `/preview`，這輪沒做」。
```

- [ ] **Step 3: `DESIGN.md` 舊章節加註記**

1. 「官網後台第八輪 UX」的 **長編輯頁要有段落目錄** 那一條，句尾「…新增長頁面時一併接上。」後面加「（2026-10-06 起 1280 以上目錄改在左側，見「官網後台內容編輯：三欄＋即時預覽」。）」
2. 「官網後台全面盤點與修正（2026-09-28）」的 **發布與核准的確認框一律和官網目前版本比** 那一條句尾加「（2026-10-06 起發布改成動作列寫欄位、確認框只寫欄位名；核准不變，見「官網後台內容編輯：三欄＋即時預覽」。）」
3. 「官網後台第九輪 UX」的 **內容編輯「存草稿並預覽」** 那一條，把「寬螢幕右側嵌即時預覽要動 web 的 `/preview`，這輪沒做。」改成「寬螢幕右側嵌即時預覽要動 web 的 `/preview`，這輪沒做（2026-10-06 已做，見「官網後台內容編輯：三欄＋即時預覽」）。」

- [ ] **Step 4: `docs/website-admin/acceptance.md` 檔尾加驗收小節**

```markdown
## 2026-10-06 內容編輯三欄＋即時預覽（方向 D，`feature/admin-editor-preview-20261006`，未部署）

計畫：`docs/superpowers/plans/2026-10-06-admin-editor-preview.md`。規則見 DESIGN.md「官網後台內容編輯：三欄＋即時預覽」。

| # | 驗收 | 驗證 |
|---|---|---|
| D1 | 1280 以上、同源：目錄在左、表單在中、預覽在右；1280 以下、不同源、校園探索沒有預覽欄 | `editorThreeColumns.test.ts`、`livePreviewPane.test.ts`、stack `editor-live-preview.spec.ts` |
| D2 | 和官網不同的段落在目錄打點；每個有目錄的頁面欄位都分到某一段 | `editorSectionDots.test.ts`、`editorSectionFields.test.ts` |
| D3 | 動作列寫「草稿有 N 處修改：欄位A、欄位B」，和官網那一版比 | `editorDraftBaseline.test.ts`、`editorActionSummary.test.ts`、stack |
| D4 | 發布確認框只寫欄位名；核准並發布照舊列差異；讀不到官網版退回差異框 | `editorActionSummary.test.ts`、`ux20260928D.test.ts` |
| D5 | 改欄位不存檔，預覽即時換掉並框出那一格；換分頁不重新載入；焦點與捲動留在後台 | `useLivePreview.test.ts`、`preview-highlight.spec.ts`、stack |
| D6 | 預覽頁只收同源、外層後台頁的訊息，格式不對、舊 seq、原型鍵都丟掉；後台只理目前 iframe 的回覆 | `preview-live.spec.ts`、`useLivePreview.test.ts`、stack |
| D7 | 草稿不外洩：沒存檔公開資料不變；`/preview` no-store、noindex、只給同源嵌；不寫 storage | stack、`preview-page-source.spec.ts`、`security-headers.spec.ts` |
| D8 | 沒登入時預覽頁照舊拒絕，後台欄內顯示重新載入 | stack、`livePreviewPane.test.ts`、`useLivePreview.test.ts` |
| D9 | 15 個編輯頁對照：14 頁有預覽、校園探索沒有 | `livePreviewPane.test.ts`、stack「每個內容編輯頁的右側預覽都接得上」 |
```

- [ ] **Step 5: Commit**

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; git add README.md DESIGN.md docs/website-admin/acceptance.md; git commit -F - <<'EOF'
docs: 記錄內容編輯三欄＋即時預覽的規則與驗收

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

## Task 15: 全套閘門（controller 執行）

**Files:**
- Modify: `docs/website-admin/acceptance.md`、`README.md`（補實際驗證結果）
- Modify（只有視覺基準需要更新時）：`tests/stack/visual.spec.ts-snapshots/campus-profile-chrome-darwin.png`

- [ ] **Step 1: admin 全套與型別**（一次只跑一組）

Run:
```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit; npm --prefix admin run typecheck
```
Expected: vitest 全過（記下檔數與項數）；typecheck 結束碼 0。負載高時若有 5 秒逾時，單獨重跑那個檔確認，並在驗證紀錄寫明。

- [ ] **Step 2: web 型別與單元測試**

Run:
```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix web run typecheck; npm run test:website
```
Expected: 都是結束碼 0（記下項數）。

- [ ] **Step 3: 契約**

Run: `cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm run contract:check`
Expected: 一致（本計畫沒有 API 變更）。

- [ ] **Step 4: stack（重建後跑相關幾支，含視覺基準）**

Run:
```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm run e2e:build
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; E2E_DB_NAME=ivy_website_editorpreview1006_test E2E_API_PORT=8791 E2E_WEB_PORT=3791 npx playwright test -c playwright.stack.config.ts tests/stack/editor-live-preview.spec.ts tests/stack/content-flow.spec.ts tests/stack/privacy-policy.spec.ts tests/stack/a11y.spec.ts tests/stack/keyboard.spec.ts tests/stack/roles.spec.ts
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; E2E_DB_NAME=ivy_website_editorpreview1006_test E2E_API_PORT=8791 E2E_WEB_PORT=3791 npx playwright test -c playwright.stack.config.ts tests/stack/visual.spec.ts -g '五校介紹' --update-snapshots=all
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; E2E_DB_NAME=ivy_website_editorpreview1006_test E2E_API_PORT=8791 E2E_WEB_PORT=3791 npx playwright test -c playwright.stack.config.ts tests/stack/visual.spec.ts
```
Expected: 第一組全過；用 Read 看新的 `campus-profile-chrome-darwin.png`（三欄、預覽欄被遮罩、目錄在左）確認合理後，第三行整支 visual 全過。打開 `test-results/stack` 裡「每個內容編輯頁的右側預覽都接得上」附的 14 張截圖逐張看：預覽有畫出對應頁面、分頁名稱正確、沒有橫向溢出。若 `a11y`／`keyboard` 的 `networkidle` 因 iframe 的影片拖太久而逾時，記錄是哪一頁，回頭在該 spec 改等 `.live-preview__meta` 出現再檢查，不要拉長全域 timeout。

- [ ] **Step 5: 清理測試庫**

Run: `dropdb --if-exists ivy_website_editorpreview1006_test`
Expected: 結束碼 0。

- [ ] **Step 6: 補驗證紀錄並 commit**

在 `docs/website-admin/acceptance.md` 新小節的表格下方、`README.md` 新段落的「驗證」那一行，寫實際結果（例：「驗證（Node 22.23.2，HEAD `<sha>`）：admin vitest N 檔 M 項、`vue-tsc -b`、web X 項與 typecheck、`contract:check` 一致、stack `editor-live-preview` 等 K 項通過（測試庫 `ivy_website_editorpreview1006_test`、埠 8791／3791，跑完已刪）；五校介紹視覺基準已更新。未驗證：正式站、iOS Safari 實機。」）。沒看到成功輸出的不寫通過。

```bash
cd /Users/yilunwu/Repositories/ivy-website-wt/admin-editor-preview-20261006; git add docs/website-admin/acceptance.md README.md tests/stack/visual.spec.ts-snapshots/campus-profile-chrome-darwin.png; git commit -F - <<'EOF'
docs: 補內容編輯三欄＋即時預覽的驗證結果與五校介紹視覺基準

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

- [ ] **Step 7: 回報（不 push、不部署）**

回報給使用者：分支、最後 commit、各閘門實際數字、未驗證項、待使用者確認（發布要不要完全不跳確認框）。合併與部署等使用者指示。
