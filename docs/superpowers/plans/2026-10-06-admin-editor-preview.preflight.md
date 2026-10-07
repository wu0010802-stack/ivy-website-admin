# Pre-flight scan：2026-10-06-admin-editor-preview（方向 D）

掃描基準：worktree `admin-editor-preview-20261006`，HEAD `3d50e0a1`（origin/main），計畫 4137 行。唯讀靜態檢查：沒有跑任何測試（worktree 沒裝 node_modules），Vue 排程行為是對照 `ivy-website-admin/admin/node_modules/@vue/runtime-core`（3.5.43）原始碼判斷的。

## 1. Task 之間共用的檔案與介面

| 產出 Task | 消費 Task | 東西 | 一致？ | 備註 |
|---|---|---|---|---|
| 1 | 2、3 | `DraftBaseline {source,payload}`、`ContentEditorState.draftBaseline?/draftChanges?` | ✓ | T2 測試 import 的型別名稱和 T1 一致 |
| 1 | 7、12 | `ContentEditorState.campusKey?: ComputedRef<string\|null>`（`unref(campusKey) \|\| null`） | ✓ | 共用內容是 null，和 web 的「共用 kind campusKey 必須是 null」對得上 |
| 2 | 3 | ContentEditor 內部的 `draftChangeList`、`baselineSource` | ✓ | T3 明寫要放在它們下面；`navSections`（原第 40 行）在更前面 |
| 3 | 4、5 | `EditorSection.fields`、`.section-nav__dot`、`.section-nav__label`、`nav[aria-label="這一頁的段落"]` | ✓ | |
| 3 | 7 | ContentEditor 的 `@media (min-width:1280px)` 區塊、`.editor__top`/`.editor__nav`/`.editor__body` 的 grid-area | ✓ | T3 已先寫 `:not(.editor--preview)` 給 T7 用 |
| 4 | 5 | `editorSectionFields.test.ts` 的 `CASES`、`mountCase` | ✓ | |
| 6 | 7 | `LivePreviewPane` props `targets/src/state/frameKey`、`v-model:target`、`v-model:viewport`；根元素 `<aside>`（class 會傳下去） | ✓ | T7 的 `aside.editor__preview` 靠單一根元素 attr fallthrough，成立 |
| 6 | 12 | emits `frame(el)`、`retry()`；`PreviewTarget`、`PreviewPaneState`、`previewFrameUrl` | ✓（介面）／⚠（時機） | `frame` 是 post-flush watcher 送出的，在 mount 之後的 microtask 才送，**不是同步**（見 T6 列） |
| 6 | 11 | `PreviewBlock`、`PreviewPage` 型別、`PREVIEW_TARGETS` | ✓ | |
| 7 | 12 | ContentEditor 的 `previewOrigin`、`currentTarget`、`previewSrc`／`previewFrameKey`（T12 整段換掉）、`latestRevisionId` | ✓ | T12 要替換的三行和 T7 寫的一字不差 |
| 8 | 9 | `PREVIEW_BLOCKS`、`LiveFocus`、`PreviewHit` | ✓ | |
| 8 | 10 | `createLiveReceiver`、`applyLiveDraft`、`LiveDraft`、`LiveOverride`、`LiveReceiver`、`isLivePreview`（在 draft-preview.ts） | ✓ | 新的 export 名稱和 web 既有 utils／composables 都沒撞名（Nuxt 自動匯入不會出現重複警告） |
| 9 | 10 | `activatePreviewBlock(doc, focus)`、`highlightPreview(doc, focus, {reduceMotion})` | ✓ | |
| 10 | preview.vue／測試 | `DraftPreviewResult { authorized, campusKeys, render(date, live?) }` | ✓ | 只有 preview.vue 呼叫 `useDraftPreview`；fixture 的五校順序 `yihua, minghua, chongde, international, renwu` 和測試期待的一樣 |
| 8 ↔ 11 | **訊息 schema（後台送 → 官網驗）逐欄** | `type`='ivy-preview:draft' ✓；`v`=1 ✓；`seq` 從 1 開始遞增、是安全整數 ✓；`kind`：後台 PREVIEW_TARGETS 的 15 個鍵＝web 的 12 個 SHARED＋3 個 CAMPUS ✓（campus_tour 沒有預覽欄，不會送出）；`campusKey`：共用內容是 null／分校內容是 fixture 五校之一 ✓；`payload`：先轉成純 JSON 的物件 ✓（後台沒設大小上限，超過 1,000,000 字元 web 會直接丟掉，後台看不出來）；`page` 在 7 頁白名單內 ✓；`focus.block` 9 個名稱兩邊完全一樣 ✓；`focus.campusKey`＝最外層的 campusKey ✓；`probe` 後台 ≤40 字，web 截到 80 ✓；`mark` 是 boolean ✓ | ✓ | |
| 10 ↔ 12 | **回覆 schema（官網送 → 後台驗）** | web 送 `{v:1,type}`／`{v:1,type:'applied',seq,hit}`，targetOrigin 用 `location.origin`；後台的 `parsePreviewReply` 驗 v、type、seq、hit ✓；後台檢查 `origin===預覽來源 && source===目前 iframe.contentWindow` ✓ | ✓ | sandbox 有 allow-same-origin，所以 event.origin 是真的 origin，不會變成 'null' |
| 測試 helper | 2、3、7、12 | `testUser`（`./fixtures`）、`resetTitleFontCoverage`；stack 的 `openAs(browser, role\|null, device)`、`gotoAdmin`、`answerMessageBox` | ✓ | 簽名都對得上。`editorState`／`mountEditor` 在 T2、T3、T7 的新測試裡各複製一份（風格問題） |

## 2. 各 Task 自身是否自洽

| Task | 測試 vs 程式碼 | 引用的既有路徑／符號 | 會變紅但沒列入的既有測試 | 結論 |
|---|---|---|---|---|
| 0 | — | 分支、起點、未追蹤清單和現況相符 | — | ✓。不需要後端測試庫（不動 backend、不跑 pytest）；stack 的 `start-api.sh` 自己會 `alembic upgrade head` |
| 1 | 5 則逐一推演都會過（官網就是最新一版／讀官網版／first／讀不到／換校晚到）；晚到的 r1 會被 `liveRequests` 擋掉 | `LiveComparison`、`changes?:`、`readLiveRevision`、`livePayloads`、`isPlainObject`（模組層）、return 的 `changes,`、ux20260928D 第 158–163 行都存在且一字不差 | ux20260928D「真的載入時…」「排 r2 後…」、publishingWorkflow「發布成功後重讀排程」、cmsUx 版本衝突：mock 對 `/revisions/*` 的回應會多被讀一次，但都只用 toHaveBeenCalledWith 或例外會被 catch 吞掉，不會紅 | ✓。**缺陷**：`refreshLiveBase` 把 `compareWithLive` 讀官網版、存快取那段幾乎原樣複製一份（見第 3 節） |
| 2 | 測試和實作對得上（文字、title、`has-changes`、customClass undefined、核准照舊列完整差異） | `publishWithConfirm` 第二行、`actionNote`、動作列 template、5 段要替換的 CSS 字串都一字不差；`ConfirmSummary` interface 宣告在 quickSummary 前面 | 已列入 campusProfileSocials、ux20260928D；另外查過 adminBugAuditContent「被退回」（`rejectedLatest` 時 summary 是 null，照舊顯示 actionNote）和 publishingWorkflow「第一次上線」都會過 | ✓。頂層的 `const summary` 會被 publishWithConfirm／approve 裡的區域變數 `summary` 遮蔽（合法，但讀的人容易搞混；建議改名 `actionSummary`） |
| 3 | dirtySectionIds 的 4 則、Nav 打點、ContentEditor 打點都會過 | import 那一行、`<!-- 狀態列不是即時區…`、`.editor__layout` 那三行、`/* 段落目錄：1280 以上…` 註解都存在；uxRound8Nav 第 65–68 行和計畫寫的一字不差 | adminUx 的 `.editor__status` 不存在檢查（placeholder 時）不受影響 | ✓。`expect(wrapper.get(...).exists()).toBe(true)` 是同義反覆（`get` 找不到就已經丟錯）。`[^@]*` 那條 regex 會一路吃到 720 的 media 之前（見第 3 節） |
| 4 | 四頁的 payload 鍵都被 fields 涵蓋（CampusProfile 17 個鍵、HomeNews 5 個、CampusNews 2 個、DayExperience 10 個）；設定的 edit 都會打點在預期的那一段 | CampusProfileView 兩個 `<h3 class="form-section">` 和第一個 `field-row` 存在；三頁的 navSections 存在 | 沒有測試對 sections 做 deep equal（aboutPage／curriculumPage 只比對原始碼裡的 id） | ✓ |
| 5 | About 21 鍵、Curriculum 31 鍵、Admission 14 鍵、Privacy 3 鍵全部涵蓋；Privacy 只改第二段時只點第二段 | 四頁的 navSections 存在 | 無 | ✓ |
| 6 | 縮放的數字（0.294／2299、0.964／701）、同源判斷、網址、偏好設定都對。**第一則必紅**：`expect(wrapper.emitted('frame')![0]![0])` 在 mount 後同步檢查；template ref 是在 render 的 post-flush 裡才設定的，它觸發的 `flush:'post'` watcher 會排進 pending 佇列、下一個 microtask 才跑（Vue 3.5.43 的 `flushPostFlushCbs` 不會把執行途中新排進來、沒有 id 的工作放進這一輪），所以這時 `emitted('frame')` 還是 undefined，接著讀 `[0]` 就丟 TypeError | `WEBSITE_ASSET_BASE`（config.ts 只 export 兩個東西）、所有 CSS token（`--brand-gold(-ink)`、`--top-h`、`--radius-lg`、`--surface-3`、`--shadow-md` 等）都存在 | 無 | ⚠ 照計畫做第一則會紅；改成先 `await nextTick()` 再斷言 `frame`（「frameKey 換了」那則有先 flushPromises，會過） |
| 7 | 5 則都會過（jsdom origin `http://localhost:3000`；mock 的 config 是 ''，所以同源；`matchMedia` 不存在時當成寬螢幕）；1280 寬時主欄 964 ≥ 格線最小寬 932 | `useNarrowScreen(query)` 有收 query 參數；`latestRevisionId` 在 `hasNav` 之前宣告；visual 和 a11y 要替換的兩行一字不差 | 既有測試沒有 mock config，WEBSITE_ASSET_BASE 是 `http://127.0.0.1:3000`，和 localhost 不同源，所以不會長出預覽欄；ux20260928A 雖然 mock 成 ''，但掛的是 DirtyPage，不是 ContentEditor | ✓。visual 只遮 `.live-preview__stage`，`.live-preview__meta` 那行字會隨時機變（見問題 4） |
| 8 | 每一則推演都會過（大小、原型鍵、seq、頂層頁面、applied 的鍵順序） | `isPreviewEmbed`、私有的 `text()`、`Query`、`describe('草稿預覽的網址參數'` 都存在；site-fixture.json 的路徑正確 | 無 | ✓ |
| 9 | findProbeElement、activatePreviewBlock、scrollTo 的算式（100＋1200−385）都對；happy-dom 已經在 web 的 devDependencies | — | 無 | ✓（計畫已寫好覆寫 scrollY 失敗時的退路） |
| 10 | use-draft-preview 的 3 則、page-source 的 4 則（regex 對得上計畫寫的程式碼）、security-headers 都對 | 兩處 `return { authorized:false, render:null }`、`const campusKeys`、`"connect-src 'self'",`、preview.vue 原本的 script 和 `<style scoped>`；template 用到的變數（page、draft、embedded、mobileFrame、frameSrc、hiddenNews、date、setViewport、setDate）新的 script 都有；PREVIEW_BLOCKS 的選擇器在元件裡都存在：`header.header`、`footer.footer`、`.studio-hero`、`.home-belief`、`.day-experience`、`#campuses`、`#campus-tab-<key>`＋`aria-selected`、`.home-news`、`.booking-draft`、`#main`（入學／特色教學／關於／隱私四個元件和 preview.vue 本身） | privacy-policy.spec 讀 preview.vue 找 `page === 'privacy'`、`PrivacyPolicyContent`：template 沒改，仍會過；security-headers.spec 用的是 `ADMIN_CSP` 常數，加了 frame-src 也不影響 | ✓。`(overlay as Record<string, Record<string,unknown>\|null\|undefined>)` 這個直接轉型，判斷 TS 會接受（ContentOverlay 的屬性全部是選填），但沒有實際跑 typecheck |
| 11 | 測試讀 `../../../web/app/utils/preview-live.ts`，路徑正確；sparse checkout 有包含 web | 依賴 T8（順序正確） | 無 | ✓。比對方式是原始碼字串 `toContain`，鍵名出現在註解裡也會算通過，偏弱 |
| 12 | useLivePreview 的 8 則都推演過（假 timer 只假 setTimeout，debounce 299／1 的時機成立；換 iframe 後舊 iframe 送來的 ready 不算）；editorThreeColumns 改寫後的兩則也會過 | 依賴 T7 的變數 | 無 | ✓。不過即使預覽欄不顯示也一律掛 deep watch＋window listener（見第 3 節） |
| 13 | 5 則的前提都成立：site_footer 由 `initialize-content` 建立並發布；content-flow 不動 site_footer；`/api/public-site` 存在；表單標籤「標語」「參觀專線」存在；`<aside aria-label>` 會報讀成 complementary；1279 寬時沒有預覽欄 | pages.ts 的 helper 簽名正確 | — | ✓。用 `waitForTimeout(500)` 驗「不該發生的事」是固定等待；e2e 用 `reducedMotion:'reduce'`，抓不到五校輪播自動轉走的問題（見問題 3） |
| 14 | — | DESIGN 三處要加註記的句子、第一個 `##`、README 頂端、acceptance.md 檔尾都存在 | — | ✓ |
| 15 | 視覺基準檔 `campus-profile-chrome-darwin.png` 存在 | — | — | ✓ |

## 3. 審查會當成缺陷的地方

| # | Task | 內容 | 建議 |
|---|---|---|---|
| a | 1 | `refreshLiveBase` 和 `compareWithLive` 都有「`livePayloads.get` → 官網就是最新一版就用最新那份，否則 `readLiveRevision` → 存進快取」這整段，重複貼了兩份 | 抽成 `livePayloadOf(item)`，兩邊共用 |
| b | 6 | 同步斷言 `emitted('frame')`，照做必紅 | 先 `await nextTick()` 再斷言 |
| c | 3、7 | `/@media \(min-width: 1280px\) \{[^@]*\}/` 會一路吃到下一個 `@`（720 的 media）之前的整段 style，「規則在 1280 區塊內」的斷言其實測不到（沿用 uxRound8Nav 既有的寫法） | 接受，或改成先切出 `@media (min-width: 1280px) {` 到下一個 `\n}` |
| d | 12 | `snapshot()` 已經 JSON 複製一次，`buildDraftMessage` 又複製一次；而且每個 ContentEditor（包括 1279 以下、不同源、校園探索）都會掛 deep watch 加 message listener | `useLivePreview` 加一個 `enabled`（等於 showPreviewPane），沒開就不 watch；payload 只複製一次 |
| e | 10、11 | 用原始碼字串守門（preview-page-source.spec、protocol 比對），跟程式碼的排版綁在一起 | 計畫已說明行為交給 stack 驗，可以接受 |
| f | 3 | `expect(wrapper.get(...).exists()).toBe(true)` 是同義反覆 | 改成 `wrapper.get(...)` 或 `find(...).exists()` |

## 4. 資安

| 項目 | 狀態 | 依據 |
|---|---|---|
| iframe 端驗來源 | ✓ | `isTrustedPreviewEvent`：`parent !== self && source === parent && origin === location.origin`；拿到授權後才掛 listener（page-source 測試有檢查順序） |
| 後台端驗來源 | ✓ | `origin === options.origin && source === 目前 frame.contentWindow`；換 iframe 會重新 connect |
| targetOrigin 不用 `'*'` | ✓ | 後台送出用 `options.origin`（是空字串就不送）；官網用 `self.location.origin` |
| sandbox 相容性 | ✓ | `allow-scripts allow-same-origin`：同源的 session cookie 才送得出去、`/auth/me` 才拿得到授權、event.origin 才是真的 origin；沒給 top-navigation、popups、forms、modals。計畫已寫明這組合對同源頁面不是硬隔離 |
| CSP／XFO 實際設定位置 | ✓ | `web/server/utils/security-headers.ts`（ADMIN_CSP，由 `server/plugins/security-headers.ts` 套用）；`/preview` 走 PUBLIC_CSP 的 `frame-ancestors 'self'`＋`X-Frame-Options: SAMEORIGIN`；no-store／noindex 在 `server/middleware/preview-headers.ts`。stack build 用 `VITE_WEBSITE_ASSET_BASE=`，後台和官網同源 |
| 草稿不進網址、storage、SSR、telemetry | ✓ | 草稿放在 `shallowRef`；網址只有 embed／live／page；`/preview` 是 `ssr:false`；`publicPage('/preview')` 回 null，`tracksClicks` 排除 /preview；後台的 localStorage 只記桌機／手機 |

## 5. 和既有規則的衝突

| 規則 | 狀態 |
|---|---|
| 十級字級 token | ✓ 新元件只用 `--text-xs`、`--text-sm` |
| 不用彩色側條 | ✓ 拿掉 2px 左框；打點用 1px 的 box-shadow 外圈，不是 inset 側條 |
| 實心主色一頁一顆 | 可以接受：預覽欄兩組 el-radio-button 選中時是實心主色，素材庫（MediaLibraryView）已經是一樣的兩組做法 |
| 錯誤走 notify.ts | ✓ 預覽失敗用欄內文字，沒有新的 `ElMessage.error` |
| 不能碰 VisitDetailView／VisitRequestsView | ✓ 沒有任何 Task 碰到；改到的共用模組（ContentEditor、EditorSectionNav、editorSections、useContentItem）也都沒有被這兩頁使用。README／DESIGN／acceptance 和另一條分支會有文字衝突，合併時要處理 |

## 6. 環境

| 項目 | 狀態 |
|---|---|
| Task 0 的後端測試庫 | 不需要：沒有 backend 變更、沒有 pytest；stack 的 `start-api.sh` 會 DROP 重建並 `alembic upgrade head` |
| E2E_DB_NAME | `ivy_website_editorpreview1006_test`，和 controller 建議給 pytest 用的庫同名。目前沒有衝突，但之後如果同時跑 pytest，會被 start-api.sh DROP。建議改成 `ivy_website_editorpreview1006_e2e_test` |
| 埠 | 8791／3791 不在禁用清單、目前空閒；和建議的 8781／3781 不同，兩種都可以。要改的話有 4 處：Global Constraints 第 25 行、Task 13 第 3983 行、Task 15 第 4112–4114 行 |
| Node | 計畫一律用 22.23.2（.nvmrc）。這台機器系統預設是 v25.9.0，那裡的 `globalThis.localStorage` 是沒有方法的空物件；T6、T7 的測試沒有像 adminUx／ux20260928A 那樣先補 stub，用 Node 25 跑會紅 |
| watchdog | Task 13 最長一則 300 秒，小於 10 分鐘的無輸出上限 |
