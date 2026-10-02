# 官網隱私權政策頁設計

日期：2026-10-03
狀態：草案，待使用者審閱
對象：業主、接手實作的 Claude
基準：`origin/main` `94e18c1`（本文行號都以此版本為準）

## 1. 背景與目標

使用者 2026-10-02／03 決定官網改用 cookie 做行銷分析：自建來源歸因、GA4，以及廣告像素（Meta Pixel、Google Ads、LINE Tag）。這件事拆成三個獨立部分，各自有規格、計畫與實作：

1. **隱私權政策頁**（本規格）：後台可編輯的 `/privacy` 頁，頁尾與預約表單都有入口。
2. 追蹤工具載入：GA4、廣告像素，ID 由設定控制，排除後台與預約修改頁，送預約轉換事件。
3. 自建來源歸因：第一方 cookie 跨次記住來源，串到預約與招生訪視，後台依來源出報表（`docs/analysis/2026-09-30-enrollment-analytics-report.md` 階段 3）。

本規格只做第 1 部分。第 2、3 部分上線時，要回頭改寫本頁的 Cookie 段（第 9 節）。

成功標準：

- 園方在後台編輯、預覽、發布隱私權政策，改字不用重新部署。
- 發布後，官網 `/privacy` 可讀、可被搜尋引擎收錄，頁尾與預約表單都找得到。
- 初稿內容都有程式依據；需要園方提供的資料沒補完，就不能發布。

## 2. 已裁定事項

| 日期 | 事項 | 裁定 |
|---|---|---|
| 2026-10-03 | cookie 用途 | 自建歸因＋GA4＋廣告像素；依 1 → 2 → 3 的順序做 |
| 2026-10-03 | cookie 同意橫幅 | **不做**。揭露放在隱私權政策頁，並沿用既有做法尊重 DNT／GPC。接廣告像素而沒有任何提示，風險高於做同意機制；這是使用者的決定，第 2 部分的規格要再註明一次 |
| 2026-10-03 | 內容管理 | 後台可編輯，走既有共用內容的編輯、預覽、送審、發布流程 |
| 2026-10-03 | 做法 | 新增獨立的共用內容 `privacy_policy`；預約表單現有的「個資使用說明」對話框保留，加上完整政策的連結 |
| 2026-10-03 | 初稿 | 依第 8 節大綱與附錄 A 撰寫，需園方補的地方標「【待確認：…】」，未補完不能發布 |

## 3. 範圍

做：

- 新共用內容 `privacy_policy` 的後端驗證與發布規則。
- 後台「隱私權政策」編輯頁，含初稿。
- 官網 `/privacy` 頁、頁尾入口、預約表單入口、草稿預覽、SEO 與 sitemap。
- 更正 `docs/website-admin/seo-performance.md` 過時的說明（第 10 節）。

不做：

- cookie 同意橫幅（第 2 節）。
- 任何追蹤工具或 cookie（第 2、3 部分）。
- 修改預約 API、預約文案的既有資料、`booking/consent.py`。
- 多語系版本。
- `llms.txt` 列入本頁。

## 4. 內容模型（後端）

新增 kind `privacy_policy`，登記在 `backend/app/content/registry.py:311` 的 `CONTENT_KIND_REGISTRY`，`shared_only=True`。kind 是自由字串，沒有 enum 或 CHECK 約束，**不需要 migration**（`backend/app/content/models.py`）。

Payload（`backend/app/content/schemas.py`，新增 `PrivacyPolicyPayload`，繼承 `_ContentPayload`）：

| 欄位 | 型別 | 規則 |
|---|---|---|
| `title` | 字串 | 1–40 字，預設「隱私權政策」 |
| `updated_on` | 日期或 null | 存草稿可留空；發布時必填（見下方發布阻擋） |
| `sections` | 陣列 | 1–20 段 |
| `sections[].heading` | 字串 | 1–60 字 |
| `sections[].body` | 字串 | 1–2000 字，不可只有空白 |

所有文字欄位沿用 `_reject_unsafe_scheme`（`schemas.py:36-41`），擋 `javascript:` 這類危險網址。

內文是純文字，有三種約定寫法，都由官網渲染時解析，後端不轉換：

- 空一行代表另起一段。
- 一行開頭是「- 」，顯示成條列項目；連續的條列行合成一個清單。
- `https://` 開頭的網址，顯示成可點的連結。其他協定（含 `http://`）照原文顯示。

**發布阻擋**（`publish_blocker`，做法同 `_booking_publish_blocker`，`registry.py:188-197`）：

- 標題或任一段落含「【待確認」：不能發布，訊息「還有 N 處【待確認】要補完才能發布」。
- `updated_on` 為空：不能發布，訊息「請填最後更新日期」。

**公開輸出**：沿用 `GET /api/website/v1/public/site`（`backend/app/content/routes.py:543`）。發布後出現在 `content.privacy_policy`；從未發布則沒有這個鍵。不需要新端點，`contracts/openapi.json` 預期不變（仍要跑 `npm run contract:check` 確認）。

**初始內容**：不加進 `initialize.py` 的 `initial_payloads`，也不寫進兩份 site fixture。初稿只存在後台（第 5 節），官網在發布前沒有這份內容。

## 5. 後台

- **側欄**：「全站與素材」群組（`admin/src/router/nav.ts`，`key: 'site'`）新增一項，排在「預約文案」之後：
  - `{ name: 'privacy-policy', path: '/content/privacy-policy', title: '隱私權政策', roles: ['super_admin'], shared: true, keywords: ['個資', 'Cookie', '隱私'] }`
  - 權限同其他共用內容：總管理者，或被授權 `content.shared` 的人（`nav.ts:12-23`；後端 `routes.py:66-94`）。
- **路由**：`admin/src/router/index.ts` 加一頁 `content/privacy-policy`。
- **編輯畫面** `admin/src/views/PrivacyPolicyView.vue`：
  - 以 `useContentItem('privacy_policy', …)` 與 `ContentEditor.vue` 組成（範本 `SiteFooterView.vue`）。
  - 段落的新增、刪除、上下移動照 `BookingContentView.vue:36-51` 的做法。
  - 輸入欄用 `maxlength` 與字數計數（內文 2000 字、小標 60 字、標題 40 字），不另做 `LengthHint` 規則。
  - 最後更新日期用日期選擇器，預設空白。
  - 內文欄位下方說明三種寫法（空行分段、「- 」條列、`https://` 連結）。
- **初稿**：`admin/src/composables/privacyPolicyDraft.ts` 匯出附錄 A 的全文。
  - 這份內容從未存過任何版本時，編輯器載入初稿，並在上方提示「這是初稿，尚未儲存。補完【待確認】、填好最後更新日期後才能發布」。
  - 已存過版本就照版本載入，不再帶初稿。
  - 編輯器上方列出還有幾處【待確認】，點了跳到第一處。
- **標籤與連結**（`admin/src/api/labels.ts`）：
  - `CONTENT_KIND_LABELS` 加「隱私權政策」。
  - `contentPublicPath` 對應 `/privacy`。
  - `contentPreviewPath` 對應 `/preview?page=privacy`。
  - `contentEditorPath` 對應 `/content/privacy-policy`。
- **型別**：`admin/src/api/types.ts` 加 payload 型別。`contentFieldLabels.ts` 加欄位名，讓版本差異清單顯示中文。

## 6. 官網

### 6.1 `/privacy` 頁

- 新增 `web/app/pages/privacy.vue` 與 `web/app/components/PrivacyPolicyContent.vue`（草稿預覽共用）。資料流照入學資訊頁：`usePublishedSite()` → `content-overlay.ts` 的 `guard('privacy_policy', …)` → `SiteContent.privacyPolicy`。
- `content.privacyPolicy` 不存在（從未發布）時，頁面回 404。
- 版面：
  - h1 是標題，下方「最後更新：2026 年 10 月 3 日」。
  - 段落目錄：各段小標的清單，點了跳到 `#section-N`。
  - 正文最大寬度約 720px，h2 是段落小標。
  - 沿用站內字型與色彩 token。`web/` 已改用完整的 LINE Seed TW，h1／h2 不用查缺字。
  - 照 `DESIGN.md` 與「避免 AI 感」：不加裝飾插畫、英文眉標或公式化章節頭。
- 內文渲染（`web/app/utils/privacy-policy.ts`，純函式）：
  - 文字先切成段落、條列，再找出 `https://` 網址，輸出成 token 陣列。元件依 token 產生元素，**不使用 `v-html`**。
  - 連結加 `target="_blank" rel="noopener noreferrer"`，並附「（另開新視窗）」給螢幕閱讀器。
- 手機 390px 不可整頁橫向溢出；長網址要斷行（`overflow-wrap: anywhere`）。

### 6.2 SEO 與 sitemap

- `web/app/utils/seo.ts`：
  - 新增 `PRIVACY_PATH = '/privacy'` 與 `privacySeo`。
  - 標題「{標題}｜{網站名稱}」。
  - 描述固定為「常春藤幼兒園官網如何蒐集、使用與保護您的個人資料，以及 Cookie 的使用方式。」
  - `StaticPage` 型別加 `'privacy'`，`usePageSeo.ts` 加分支。
- `sitemapXml`（`seo.ts:273-278`）：只有已發布才列 `/privacy`。
- robots 不用改（`/privacy` 不在 Disallow 清單）。

### 6.3 入口

- **頁尾**（`web/app/components/SiteFooter.vue:12-48`）：
  - 政策已發布：頁尾底列顯示連結「隱私權政策」（站內連結 `/privacy`），取代原本「個資使用說明」的對話框按鈕。
  - 政策未發布：維持現狀（預約文案有發布個資使用說明，才顯示對話框按鈕）。
- **預約表單**（`web/app/components/VisitForm.vue:605`）：
  - 「閱讀個資使用說明」對話框保留。政策已發布時，`PrivacyNoticeDialog.vue` 的底部加連結「完整隱私權政策」，開新分頁，避免已填的表單內容不見。
  - 沒有個資使用說明、但政策已發布：表單在同一位置顯示連結「隱私權政策」，同樣開新分頁。
  - 兩者都沒有：維持現狀，不顯示。
- `BookingDraftPreview.vue:16` 的預約文案預覽不加連結（預覽的是預約文案本身）。

### 6.4 草稿預覽

- `web/app/composables/useDraftPreview.ts:38-50` 的 `SharedKind` 與 `SHARED_KINDS` 加 `privacy_policy`。
- `web/app/utils/draft-preview.ts` 的 `PreviewPage` 加 `'privacy'`。
- `web/app/pages/preview.vue` 加 `page=privacy` 的分支，渲染 `PrivacyPolicyContent`。
- 草稿含【待確認】時照實顯示，讓園方看到哪裡還沒補。

## 7. 錯誤與邊界

- **發布後又存了含【待確認】的草稿**：官網仍顯示已發布的版本；草稿要補完才能再發布。
- **還原成舊版**：沿用共用內容的還原流程。單一內容的還原會經過 `publish_jobs.check_publishable`（`routes.py:458`），舊版若含【待確認】就不能還原成線上版本。
- **整站還原到政策發布前的 release**：政策會留在線上，頁面與頁尾連結都不變。整站還原只把還原目標當時已上線的內容項換回舊版，「目標之後才第一次上線」的內容項維持現狀（`backend/app/content/service.py:213-215`）；政策發布晚於目標 release，所以不受影響。這比較不會讓政策在整站還原時意外消失；要下架政策得另外處理。
- **快取**：公開資料由 server 端快取 3 秒（`usePublishedSite`），發布後最多 3 秒生效。

## 8. 初稿大綱

依個人資料保護法第 8 條的告知事項撰寫：蒐集者、目的、類別、利用期間／地區／對象／方式、當事人權利、不提供的影響。全文在附錄 A，事實依據在附錄 B。

| # | 段落 | 要點 |
|---|---|---|
| 1 | 適用範圍與蒐集者 | 蒐集者名稱【待確認】；連到外部網站後適用對方的政策 |
| 2 | 我們蒐集的資料 | 預約表單各欄位與必填情形；修改連結可更新的欄位 |
| 3 | 蒐集目的與利用方式 | 安排參觀、確認信與修改連結、聯絡確認；參觀後的招生聯繫【待確認】 |
| 4 | 自動蒐集的資訊 | 第一方統計的內容與 DNT／GPC；限流的雜湊 IP；Turnstile【待確認】；主機存取日誌；YouTube 影片 |
| 5 | Cookie 與類似技術 | 必要 cookie 兩個、sessionStorage 兩個；目前未使用第三方分析或廣告 cookie |
| 6 | 資料分享與委外處理 | 不出售；Railway、寄信服務【待確認】、Cloudflare；校區權限 |
| 7 | 保存期間 | 預約與招生訪視【待確認】；統計去識別化；速度樣本 90 天；修改連結到期 |
| 8 | 資料安全 | HTTPS、校區權限、token 不留在網址 |
| 9 | 您的權利 | 個資法第 3 條；修改連結自行更正；不提供必填的影響 |
| 10 | 孩子的資料 | 由家長提供，用於安排參觀與班別 |
| 11 | 政策修訂 | 公告於本頁並更新日期 |
| 12 | 聯絡我們 | 各校電話見頁尾；統一 Email【待確認】 |

初稿共有 9 處【待確認】標記，要園方補的事項是 8 項（發布前必須補完；第 3 項的 Turnstile 在第 4 段與第 6 段各有一處標記，算同一項）：

1. 蒐集者的法人或各校登記名稱。
2. 參觀後招生聯繫與紀錄的寫法（招生規格 §15 Q1；2026-10-02 拿掉同意勾選後，告知全靠這段）。
3. 正式站是否已啟用 Cloudflare Turnstile。
4. 寄送確認信的服務商。
5. 主機與資料庫所在地區。
6. 預約資料的保存天數，以及正式站是否已開啟自動清理。保存政策預設不自動清理（`backend/app/operations/models.py:211`；`config.py:60` 的 `WEBSITE_RETENTION_ALLOW_REAL_RUN` 預設 false），文字與實際設定必須一致。
7. 招生訪視的保存天數（預設不清理）。
8. 統一的聯絡 Email（網站上沒有各校 Email）。

## 9. 與第 2、3 部分的銜接

- 第 2 部分（追蹤工具）上線前，要改寫附錄 A 第 5 段：列出 GA4、Google Ads、Meta Pixel、LINE Tag 各自的 cookie、用途、提供者與退出方式（各家隱私說明的 `https://` 連結）。同時改寫 `docs/website-admin/seo-performance.md:33` 的「未新增 Cookie、localStorage 識別碼或外部分析服務」。
- 第 3 部分（自建歸因）上線前，同樣補上第一方歸因 cookie 的名稱、保存天數與用途。
- 以上改寫由園方在後台更新後發布。第 2、3 部分的規格要把「隱私權政策已更新並發布」列為上線前檢查項。

## 10. 文件更正

- `docs/website-admin/seo-performance.md:37` 寫「事件寫成 website_telemetry JSON 日誌，未新增 DB」，與現況不符：瀏覽量存 `page_view_daily`、網頁速度存 `web_vital_samples`（`backend/app/operations/models.py:102-136`）。改成現況，並註明速度樣本保存 90 天（`traffic_service.py:14,55`）。
- 第 33 行的 cookie 承諾，本部分不改（目前仍成立），留給第 2 部分。

## 11. 測試與驗收

| 編號 | 案例 | 必須成立 |
|---|---|---|
| P01 | payload 驗證 | 字數上限、段落 1–20、`javascript:` 被擋；條列與 `https://` 原文可存 |
| P02 | 發布阻擋 | 含「【待確認」或缺 `updated_on` 時不能發布，訊息正確；補完後可發布 |
| P03 | 權限 | 總管理者與有 `content.shared` 的人可編輯與發布；分校帳號、內容編輯、唯讀依既有共用內容規則被擋 |
| P04 | 公開輸出 | 發布前 `/public/site` 沒有 `privacy_policy`，發布後有，內容與已發布版本相同 |
| P05 | 後台編輯 | 從未存過時帶入初稿並提示；段落新增、刪除、移動；【待確認】計數與跳轉；側欄權限（`bugfixRegressions.test.ts:27-34` 的 `SHARED` 清單） |
| P06 | 內文渲染 | 空行分段、「- 」條列、只有 `https://` 變成連結；不使用 `v-html`；含 `<script>` 等文字照原文顯示 |
| P07 | 頁面 | 未發布 404；發布後 h1、更新日期、目錄錨點正確；SEO 標題與描述 |
| P08 | sitemap | 只有已發布才列 `/privacy` |
| P09 | 頁尾 | 已發布顯示「隱私權政策」連結並取代對話框按鈕；未發布維持原狀 |
| P10 | 預約表單 | 對話框底部有完整政策連結（新分頁）；只有政策時直接顯示連結；都沒有時不顯示 |
| P11 | 草稿預覽 | `/preview?page=privacy` 顯示草稿，含【待確認】照實顯示 |
| P12 | stack e2e | 用後台 API 發布一份政策 → `/privacy` 與頁尾連結可用；1440／390 截圖不橫向溢出；`/privacy` 的 axe 檢查寫在 `privacy-policy.spec.ts`（發布後才有這一頁，`a11y.spec.ts` 在它之前執行） |

驗證指令（Node 22）：

- `npm --prefix web run typecheck`、`npm run test:website -- --maxWorkers=2`
- `npm --prefix admin run typecheck`、`npm --prefix admin run test:unit -- --maxWorkers=2`、`npm --prefix admin run build`
- 後端 `uv run --frozen pytest -q`（整套由主 session 背景跑）
- `npm run contract:check`
- `npm run e2e:build`、`npm run test:e2e:stack`，使用自訂的 `E2E_DB_NAME`（含 test）與埠

## 12. 交付與上線

- 分支 `feature/privacy-policy-20261003`，worktree `~/Desktop/ivy-website-privacy`（sparse checkout，從 origin/main `94e18c1` 開出）。
- 不需要 migration。推 main 部署前先問使用者。
- 上線後要園方做（記在 `deploy/README.md`）：
  1. 在後台補完 9 處【待確認】（8 項事項），填最後更新日期，發布。
  2. 依第 7 段寫的保存天數設定保存政策，並開啟自動清理；部署設定 `WEBSITE_RETENTION_ALLOW_REAL_RUN` 也要開。
- 驗收紀錄寫進 `docs/website-admin/acceptance.md`，新增「隱私權政策頁」一節（P01–P12）。

## 附錄 A：初稿全文

以下是後台初稿（`privacyPolicyDraft.ts`）的內容。標題：「隱私權政策」；最後更新日期：空白。

### 1. 適用範圍與蒐集者

本隱私權政策說明【待確認：蒐集者的法人或各校登記名稱】（以下稱「我們」）在常春藤幼兒園官網（以下稱「本網站」），如何蒐集、使用與保護您的個人資料。

本政策只適用本網站。您點選本網站上的 Facebook、Instagram、YouTube、LINE、Google 地圖等外部連結之後，適用該網站自己的隱私權政策。

### 2. 我們蒐集的資料

您在本網站預約參觀時，我們會蒐集：

- 家長稱呼、手機號碼、Email（必填）
- 孩子的姓名與出生年月日（表單要求填寫）
- 參觀校區、場次與參觀人數（必填）
- 如何得知常春藤（選填，可複選）
- 想了解的事（選填）

您之後可以用確認信裡的修改連結，更新稱呼、手機、Email、孩子的姓名與生日、參觀人數與想了解的事，也可以取消或申請改期。

### 3. 蒐集目的與利用方式

我們使用這些資料來：

- 安排與確認參觀場次
- 寄送預約確認信與修改連結到您的 Email
- 在必要時以電話或 Email 聯絡您確認參觀
- 【待確認：參觀後的招生聯繫與紀錄如何使用，例如到園參觀後，由參觀校區聯繫入學事宜並保留參觀紀錄】

預約確認信只寫稱呼、校區、日期與場次、參觀人數、校區地址與電話，以及修改連結，不含孩子的生日、完整電話或您填寫的問題。通知校區人員有新預約時，訊息也不含您或孩子的個人資料。

我們不會把您的資料用在上述目的以外的用途。

### 4. 自動蒐集的資訊

本網站會蒐集不能識別個人的統計資訊，用來了解網站的使用情形與改善速度：

- 瀏覽的頁面類型與校區、裝置類型（手機或桌機）
- 網頁載入速度
- 點選預約、電話、LINE 按鈕的次數

這些統計不記錄您的 IP，也不使用 cookie 識別您。您的瀏覽器若開啟「不要追蹤」（Do Not Track）或 Global Privacy Control，本網站就不會送出這些統計。

為了防止濫用（例如大量自動送出預約），我們會把連線來源 IP 經過不可逆的雜湊處理後，短暫保存，時間到就刪除。

【待確認：若已啟用 Cloudflare Turnstile，保留這一段：送出預約時，本網站使用 Cloudflare Turnstile 判斷是不是自動程式，過程中會把您的 IP 提供給 Cloudflare。未啟用就整段刪除。】

本網站的主機服務商會依其作業保存連線紀錄（例如存取時間與網址）。

影片使用 YouTube 的 youtube-nocookie.com 播放器，您按下播放後才會載入；影片縮圖由 YouTube 的伺服器提供。

### 5. Cookie 與類似技術

本網站目前只使用網站運作必要的 cookie：

- ivy_parent_session：您開啟預約修改連結後設定，讓您在 2 小時內修改預約，只能由本網站的伺服器讀取。
- 員工登入後台時使用的登入 cookie，一般訪客不會收到。

此外，本網站在您的瀏覽器分頁暫存兩個不含個人資料的設定：開場動畫是否看過，以及首頁「孩子的一天」照片翻面動畫是否播過。關閉分頁後就會清除。

本網站目前沒有使用第三方分析或廣告 cookie。日後若使用，我們會先更新本政策。您可以在瀏覽器設定中封鎖或刪除 cookie；封鎖必要 cookie 時，預約修改連結可能無法使用。

### 6. 資料分享與委外處理

我們不會出售或出租您的個人資料。

為了提供服務，我們委託下列廠商處理資料，並要求他們只依我們的指示處理：

- Railway：網站主機與資料庫【待確認：資料所在地區】
- 【待確認：寄信服務商】：寄送預約確認信
- 【待確認：若已啟用 Cloudflare Turnstile 才保留這一行；未啟用就刪除】Cloudflare：判斷自動程式

在我們內部，只有負責您預約校區的人員看得到您的預約資料。除了法律規定或主管機關依法要求之外，我們不會提供給其他人。

### 7. 保存期間

- 預約資料在參觀結束或取消後保存【待確認：天數】天，到期後刪除您與孩子的姓名、電話、Email、生日與填寫的內容，只保留不能識別個人的統計資料。
- 【待確認：參觀後的招生紀錄保存多久】
- 網頁速度的統計資料保存 90 天；其他統計資料不能識別個人。
- 預約修改連結會過期：至少有效 14 天，參觀日後 7 天失效。

### 8. 資料安全

本網站全程以 HTTPS 加密傳輸。後台需要登入，並依校區限制可以看到的資料。預約修改連結開啟後，網址裡的識別碼會立即移除，不會留在瀏覽紀錄中。

### 9. 您的權利

依個人資料保護法第 3 條，您可以：

- 查詢或請求閱覽
- 請求製給複製本
- 請求補充或更正
- 請求停止蒐集、處理或利用
- 請求刪除

您可以用預約修改連結自行更正或取消，或依第 12 段的方式聯絡我們。必填欄位若不提供，就無法線上預約，您可以改用電話向各校預約。

### 10. 孩子的資料

孩子的姓名與出生年月日由家長提供，只用來安排參觀與判斷適合的班別。

### 11. 政策修訂

我們可能因法令或服務調整修訂本政策，修訂後公告於本頁，並更新上方的最後更新日期。

### 12. 聯絡我們

對本政策或您的個人資料有任何問題，請聯絡：

- Email：【待確認：統一的聯絡 Email】
- 各校電話：請見本頁下方頁尾的各校電話

## 附錄 B：初稿的事實依據

| 初稿段落 | 依據（`origin/main` `94e18c1`） |
|---|---|
| 2 表單欄位與必填 | `web/app/components/VisitForm.vue:575-602`；`backend/app/booking/schemas.py:228-310`（孩子姓名、生日後端選填，表單要求填寫） |
| 2 修改連結可改欄位 | `backend/app/booking/schemas.py:526-535`；`web/app/pages/visit/manage.vue` |
| 3 確認信內容 | `backend/app/notifications/parent_email.py:1-2,66-87`；稱呼寫法 `notifications/service.py:149-171` |
| 3 園方通知不含個資 | `backend/app/notifications/service.py:136-146,215-236` |
| 3 招生紀錄（Q1） | `backend/app/admissions/booking_link.py:1-10,48-58`；正式站功能開關目前關閉 |
| 4 第一方統計 | `web/app/plugins/telemetry.client.ts:7-40`；`web/app/utils/cta-analytics.ts:91-98`；`web/server/api/telemetry.post.ts:4-39`；`backend/app/operations/models.py:67-136` |
| 4 限流雜湊 IP | `backend/app/common/ratelimit.py:19,81-105,252-257`；`backend/app/workers/maintenance.py:209` |
| 4 Turnstile | `backend/app/booking/turnstile.py:30,59-60`；`web/app/components/VisitForm.vue:11,79-103` |
| 4 YouTube | `web/app/utils/filmCarousel.ts:47`；`HomeFilms.vue:211-213` |
| 5 cookie | `backend/app/booking/access_routes.py:43,178-186`；`backend/app/booking/access_service.py:21`；後台 session `backend/app/config.py:96` |
| 5 sessionStorage | `web/app/utils/entrance-policy.ts:1,35`（`ivy-entrance-a-seen`）；`web/app/utils/printOpener.ts:13,44,52`（`ivy-day-peek`） |
| 6 委外 | `deploy/README.md:196`（Railway）；`backend/app/notifications/email_adapter.py:47-69`（SMTP） |
| 6 校區權限 | `backend/app/auth/permissions.py:36-54` |
| 7 保存與匿名化 | `backend/app/operations/models.py:173-215`；`backend/app/operations/retention_service.py:174-214`；`backend/app/admissions/retention.py:40-53`；`backend/app/operations/traffic_service.py:14,55` |
| 7 修改連結到期 | `backend/app/booking/access_service.py:38-39` |
| 8 token 不留在網址 | `web/app/pages/visit/manage.vue:57-67` |
