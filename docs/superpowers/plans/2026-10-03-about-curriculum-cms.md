# /about 與 /curriculum 開放後台編輯 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓園方在官網後台改「特色教學頁」（`/curriculum`）與「關於常春藤頁」（`/about`）的文字與照片，上線當下官網畫面零差異。

**Architecture:** 新增兩個共用內容種類 `curriculum_page`、`about_page`，沿用既有的 content kind 機制（`backend/app/content/registry.py`：草稿、送審、排程、版本、還原、`/public/site` 輸出、素材引用保護全部是通用的）。官網的內建內容搬進 `site-fixture.json`（`curriculumPage`、`aboutPage`），元件改吃內容 props；後台發布後由 `content-overlay.ts` 整份取代。章節數量、顏料、卡紙位置等版面參數留在元件裡，以清單索引對應內容；照片版位留空＝官網內建圖。

**Tech Stack:** FastAPI 0.136.1（釘版）＋Pydantic v2＋SQLAlchemy 2.0；Nuxt 4／Vue 3／TS（web）；Vue 3＋Element Plus＋Vitest（admin）；Playwright（畫面比對與版面實測腳本）。

**Spec:** 沒有獨立規格。來源：使用者 2026-10-03 裁定（本計畫「設計決定」第 1 點）、`docs/specs/2026-09-19-website-admin.md` 規格 3.1.1（標題字型）、`web/app/pages/about.vue:2`／`curriculum.vue:2` 現況註解、`DESIGN.md`「關於常春藤頁改成立體書（2026-09-29 定案 J）」「特色教學頁水彩版（2026-09-28 定案）」。

## 設計決定

1. **使用者 2026-10-03 裁定「文字與照片都開放」**：標題、內文、照片都能在後台改；**章節數量與版面結構固定**。所以每個清單在後端驗證為「恰好 N 項」，項目代號（課程方向 `key`、沿革 `key`）固定順序；後台不給新增、刪除、排序。理由：水彩版的錯落排法用 `cur-dir--<key>`、`cur-art:nth-child`、`cur-thing:nth-child`，立體書的卡紙座標（`AboutContent.vue:39-45`）照五站排好，項目數一變就跑版。
2. **標題沿用既有缺字提示 `GlyphHint`（只提醒、不擋存檔，`admin/src/components/GlyphHint.vue:5-7`）**。兩頁的 h1–h3 都是 `font-family: var(--font-head)`、700（`web/app/assets/css/styles.css` 第 13 行 `h1,h2,h3{…font-weight:700}`、`curriculum.css:49,105,115,154,161`），也就是 LINE Seed TW Bold，GlyphHint 預設的 `bd` 字表。2026-09-25 起 `bd`／`eb` 已是官方完整字型切片（`admin/src/composables/useTitleFontCoverage.ts:9-11`），只缺罕見字與 emoji，**不需要補字或重切子集**。
3. **字數兩層**：後端 `page_schemas.py` 的**硬上限擋存檔**（超過版面會壞，Task 9／17 實測確認）；後台 `contentHints.ts` 的 `LENGTH_HINTS` 是**只提醒的建議值**（超過只是多換行），沿用 `contentHints.ts:1-3` 的既有慣例。上限表見下方「欄位與字數上限」。
4. **標題用 `\n` 表示換行**（同 `DayMomentCard.vue:461` 的拍立得標題），每個標題最多 3 行、每行有字數上限、不能有空白行。其他欄位**不收換行**（後台輸入框擋 Enter，後端擋下貼上的換行）。
5. **特色教學頁首屏大標的橘色顏料**改成獨立欄位 `hero_highlight`（大標裡要畫顏料的字，必須和大標同一行裡的字一模一樣；空字串＝不畫）。後端擋、後台即時提示。
6. **照片沿用 `MediaSlotPayload`＋`*_photo_alt` 的既有模式**（`HomeAboutPayload`，`schemas.py:122-135`）：版位留空＝官網內建圖與內建說明（內建說明描述的是內建照片，留在元件裡、不開放編輯）；選了素材才出現說明欄，留空時官網用素材庫的說明。
7. **不開放的文字**（版面元素、課綱名詞、程式算出來的字）：英文小字（Four years、BABY class、Curriculum…）、章節編號、年段名稱與年齡（`幼幼班`…，和 `admission-classes.ts` 綁在一起，`curriculum.spec.ts` 有測試）、六大領域與六大核心素養（課綱名詞，綁 `AboutWholePerson.vue` 的六圈 SVG）、「家長怎麼說」整章（已由各校後台的 `testimonials` 編）、連結文字、目次標題「目次」。列在範圍外，要開放另議。
8. **沿革年份可改、民國年自動算**（`year − 1911`），年份 1950–2100、由早到晚（可同年）。理由：義華創校年份 1997 vs 教保資訊網核准設立 1998/01/15 待園方確認（記憶 about-proposals-abandoned），開放後園方可自己改。
9. **預設內容＝現在寫死的文字，一字不差**，放兩份 fixture（`web/server/data/site-fixture.json` 官網用、`content/site-fixture.json` 給 `initialize-content`），後端測試比對兩份相同；後台另有一份初稿常數（`*PageDraft.ts`），admin 測試逐欄比對 web fixture。CMS 從沒存過版本時，編輯頁表單就是這份內建內容（不是空白），官網這時顯示的也是同一份。
10. **分兩階段，各自可獨立合併上線**：階段 A `/curriculum`（較單純，先把共用工具做出來）、階段 B `/about`（立體書）。階段 B 可在另一個 session，從當時的 origin/main 開新 worktree（階段 A 已合併時）或延續同一個 worktree。

## 已完成、不做（2026-10-03 對 origin/main `15fd9a5` 核對）

- 送審／排程／版本歷史／還原／發布、`/public/site` 輸出：全部是通用機制，新 kind 註冊進 `CONTENT_KIND_REGISTRY` 就有（`backend/app/content/service.py:311-370` 逐 kind 組公開內容、`registry.py:301-325`）。
- 素材引用保護、「用在哪裡」、批次替換：`MediaRef`＋`extract_media_refs`（`registry.py:34-60,92-100`），存檔時檢查素材存在（`routes.py:129-190`，不存在回 422 `MEDIA_NOT_FOUND`）。
- 缺字提示元件：`GlyphHint.vue`、`useTitleFontCoverage.ts`（讀官網 `/assets/fonts/chars-*.txt`）。
- 選照片＋焦點元件：`MediaSlotField.vue`（`modelValue` 接受 `undefined`，`:21`）、說明帶入 `altAfterPick`（`composables/mediaThumbs.ts:60`）。
- `/about` 的校名、校區照片、家長分享已經來自後台（`AboutContent.vue:35,79-81,204`）。
- **不需要 migration**：`content_items.kind` 是 `String(64)`，沒有列舉或 check constraint（`backend/app/content/models.py:37`）。
- **不需要改 OpenAPI 契約**：revision 的 `payload` 是 `dict`（`schemas.py:1337,1343`），`/public/site` 的 `content` 也是 `dict`（`schemas.py:1454-1459`）；後台 payload 型別是手寫在 `admin/src/api/types.ts`。驗證閘門仍跑 `npm run contract:check` 確認沒變。

## 範圍外

- 新增、刪除、排序章節或項目；更換顏料色、卡紙位置、版面。
- `/about`、`/curriculum` 的 SEO 標題與描述（仍寫在 `web/app/utils/seo.ts`）；要開放可比照 `site_meta.admission_title` 另做。
- 標題字型補字、重切子集、完整字型（規格 3.1.1 的另一件事）。
- 設計決定第 7 點列的固定文字。
- 正式站跑 `initialize-content`（見「風險與待使用者決定」第 2 點）。

## Global Constraints

- 基準是 origin/main；**不要在 `~/Desktop/ivy-website-admin`（`feature/website-admin`，落後 500+ commit）上做**。worktree 放 `~/Desktop/`（`/private/tmp` 重開機會清空）。
- Node 22（`.nvmrc`）。Node 指令一律 `source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; <指令>`（分號，不用 `&&`：nvm.sh 會回傳 3）。
- FastAPI 0.136.1 已釘版，不升級任何依賴；`uv run --frozen`。
- 後端測試庫：`ivy_website_pagecms_test`（只用這個；不連 `ivymanagement`、staging、正式庫）。
- 每個 Task 只跑單檔前景測試；全套只在驗證閘門 Task 跑，由主 session 背景跑、同時只跑一組（機器 8GB）。subagent 不跑全套、不等背景指令。
- 已知假失敗：台北週五的 `test_booking_consent_readiness` 場次同步、stack `media.spec` 間歇失敗、pytest 全套和 vitest 同時跑時招生測試 5 秒逾時。
- **不 push、不部署、不碰正式庫**。`git add` 列明檔案，不用 `-A`／`.`／`commit -a`。Conventional Commit、繁體中文，結尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- **後台 UX 第八輪**（`docs/superpowers/plans/2026-10-03-admin-ux-round8.md`）會產出共用選圖元件與長編輯頁段落導覽：開工時若它已合併進 origin/main，`PagePhotoField.vue` 內部改用它的共用選圖元件、兩個編輯頁接上它的段落導覽；沒合併就照本計畫用現有 `MediaSlotField`。選圖只在 `PagePhotoField.vue` 一處，之後換元件只改這裡。
- 文案：直白、不用 AI 感句式（寬字距英文眉標、公式化章節頭）；後台用語對齊 `admin/src/api/labels.ts`。後台表單標籤要和 `contentFieldLabels.ts` 的欄位名一致（422 錯誤定位靠比對標籤，`contentFieldLabels.ts:174-185`）。
- 官網 CSS 不新增色碼字面值（`curriculum.spec.ts` 有測試）；本計畫不改 CSS。

## Review Focus

1. **舊版或格式不符的已發布內容**（項目數不對、欄位缺）：官網 `content-overlay.ts` 的 `guard` 要退回內建內容，不能讓 SSR 500 —— 測試在 Task 4（階段 A）、Task 13（階段 B）。
2. **貼上含 `\r\n` 的標題、首尾空白行、三行以上**：後端正規化或擋下，官網不出現空的 `<br>` —— 測試在 Task 2、Task 11。
3. **換了照片又按「改回官網內建」**：說明欄清空、官網回到內建圖與內建說明，不留舊說明描述錯的圖 —— 測試在 Task 7。
4. **顏料標示的字不在大標裡或跨行**：後端擋存檔、後台即時提示 —— 測試在 Task 2、Task 8。
5. **清單裡的照片要進素材引用**（路徑 `directions[2].photo.media_id`）：素材被引用時不能刪、批次替換改得到 —— 測試在 Task 2（抽取與 `set_at_path`）、Task 3（API 存檔回 422 `MEDIA_NOT_FOUND`）。

## File Structure

| 檔案 | 動作 | 責任 |
|---|---|---|
| `backend/app/content/page_schemas.py` | 新增 | 整頁內容的驗證工具（`page_title`、`page_text`、`exactly`）與兩個 payload |
| `backend/app/content/registry.py` | 修改 | 註冊 `curriculum_page`、`about_page`，素材引用抽取 |
| `backend/app/content/initialize.py` | 修改 | `initial_payloads` 加兩個 kind |
| `backend/tests/test_curriculum_page_content.py`、`test_about_page_content.py` | 新增 | payload 規則、引用、初始化、API |
| `backend/tests/test_content_initialize.py` | 修改 | 初始化筆數 21 → 22 → 23 |
| `content/site-fixture.json`、`web/server/data/site-fixture.json` | 修改 | 加 `curriculumPage`、`aboutPage`（兩份相同） |
| `web/app/types/site-content.ts` | 修改 | `PagePhoto`、`CurriculumPageContent`、`AboutPageContent` |
| `web/app/utils/page-content.ts` | 新增 | 標題斷行、顏料標示、照片／說明／位置、民國年、固定項目數 |
| `web/app/utils/media-image.ts` | 修改 | `curriculumHeroAttrs`、`aboutHeroAttrs`（元件與 preload 共用） |
| `web/app/utils/content-overlay.ts` | 修改 | `LiveCurriculumPage`、`LiveAboutPage`、整份取代 |
| `web/app/components/CurriculumContent.vue`、`AboutContent.vue` | 修改 | 改吃 `page` prop |
| `web/app/pages/curriculum.vue`、`about.vue`、`preview.vue`、`composables/usePageSeo.ts`、`composables/useDraftPreview.ts`、`utils/draft-preview.ts` | 修改 | 接線、preload、草稿預覽 |
| `web/tests/page-content.spec.ts` | 新增 | 工具與 overlay |
| `web/tests/curriculum.spec.ts`、`about.spec.ts`、`draft-preview.spec.ts` | 修改 | 從元件原始碼改讀 fixture |
| `admin/src/components/PageCopyField.vue`、`PagePhotoField.vue` | 新增 | 一個文字欄位（字數、缺字、換行）／一個照片版位（選圖＋說明） |
| `admin/src/composables/curriculumPageDraft.ts`、`aboutPageDraft.ts` | 新增 | 內建內容、固定項目、內建照片代號 |
| `admin/src/views/CurriculumPageView.vue`、`AboutPageView.vue` | 新增 | 編輯頁 |
| `admin/src/api/types.ts`、`api/labels.ts`、`api/contentFieldLabels.ts`、`composables/contentHints.ts`、`router/index.ts`、`router/nav.ts`、`components/AdminSidebar.vue` | 修改 | 型別、標籤、路徑、建議字數、側欄 |
| `admin/src/__tests__/pageCopyFields.test.ts`、`curriculumPage.test.ts`、`aboutPage.test.ts` | 新增 | 元件、初稿一致性、編輯頁 |
| `admin/src/__tests__/bugfixRegressions.test.ts` | 修改 | 共用內容頁清單加兩頁 |
| `scripts/page-ssr-snapshot.cjs` | 新增 | 改版前後 SSR `<main>` 與截圖 |
| `scripts/page-copy-stress.cjs` | 新增 | 硬上限版面實測 |

## 欄位與字數上限

「每行」用在標題（最多 3 行）；字數以字元計（Python `len`、JS `Array.from(...).length`）。建議值＝現在最長的字數再留一點；硬上限＝初估，**Task 9／17 實測後以實測結果為準**，改了要同步三處：`page_schemas.py`、`scripts/page-copy-stress.cjs`、DESIGN.md 表格。

### 特色教學頁 `curriculum_page`

| 欄位 | 現在 | 建議（`LENGTH_HINTS`） | 硬上限 | 可留空 |
|---|---|---|---|---|
| `hero_eyebrow` 首屏小標 | 13 | `curEyebrow` 16 | 24 | 否 |
| `hero_title` 首屏大標 | 7／5 | `curHeroTitle` 16（含換行） | 每行 14、3 行 | 否 |
| `hero_highlight` 大標裡畫顏料的字 | 3 | `curHighlight` 4 | 8 | 是 |
| `hero_lede` 首屏介紹 | 36 | `curLede` 45 | 90 | 否 |
| `hero_notice` 首屏提醒 | 23 | `curNotice` 30 | 60 | 是 |
| `chapters[].label` 章節名稱 | 5 | `curChapterLabel` 6 | 10 | 否 |
| `chapters[].hint` 小字 | 6 | `curChapterHint` 8 | 14 | 否 |
| `years_title`／`directions_title`／`gallery_title`／`daily_title` | 8 | `curSectionTitle` 18 | 每行 16、3 行 | 否 |
| `years_text`／`directions_text`／`gallery_text`／`daily_text` | 27 | `curSectionText` 32 | 80 | 否 |
| `spiral_label` | 5 | `curSpiralLabel` 6 | 10 | 否 |
| `spiral_text` | 24 | `curSpiralText` 30 | 60 | 否 |
| `years_caption` 照片下方文字 | 13 | `curCaption` 16 | 30 | 是 |
| `years[].motto` 標語 | 5 | `curMotto` 6 | 10 | 否 |
| `years[].text` 說明 | 43 | `curYearText` 50 | 100 | 否 |
| `directions[].title` | 6 | `curDirTitle` 6 | 10 | 否 |
| `directions[].sub` | 14 | `curDirSub` 16 | 30 | 否 |
| `directions[].text` | 18 | `curDirText` 24 | 50 | 否 |
| `directions[quote].sub` 品德培養的引言（大字） | 5 | `curQuote` 8 | 10（`QUOTE_SUB_LIMIT`） | 否 |
| `directions[quote].text` 品德培養的說明 | 10 | `curQuoteText` 12 | 20（`QUOTE_TEXT_LIMIT`） | 否 |
| `gallery_source` | 21 | `curSource` 26 | 50 | 是 |
| `gallery[].label` | 5 | `curArtLabel` 6 | 10 | 否 |
| `daily_source` | 11 | `curSource` 26 | 30 | 是 |
| `daily[].title` | 5 | `curDailyTitle` 5 | 8 | 否 |
| `daily[].text` | 81 | `curDailyText` 90 | 160 | 否 |
| `belief_title` | 8／12 | `curBeliefTitle` 22 | 每行 18、3 行 | 否 |
| `beliefs[]` | 13 | `curBelief` 14 | 24 | 否 |
| `belief_close` | 21 | `curClose` 26 | 50 | 否 |
| `belief_source` | 10 | `curSource` 26 | 30 | 是 |
| `*_photo_alt` | — | — | 200（`MEDIA_ALT_MAX_LENGTH`） | 是 |

固定項目：`chapters` 4、`years` 4、`directions` 7（`cognitive, integrated, multicultural, quote, autonomy, activities, art`，`quote` 不能有照片）、`gallery` 8、`daily` 5、`beliefs` 5。

品德培養（`quote`）整張印在一團顏料上，引言與說明另訂較短的上限（2026-10-04 最終審查 I3）：引言是 `clamp(2.5rem, 4.2vw, 3.75rem)` 的大字，手機與桌機一行只放得下 5 個字；`scripts/page-copy-stress.cjs` 量引言每一行的四個角都落在顏料的實心橢圓內（容許 1.1），10 字（兩行）通過、11 字（三行）在 1440 寬 1.34 不通過；說明超過一行（1440 寬約 21 字）會把兩行的引言推到 1.18，所以說明上限 20。硬上限實測寬度：390／820／1024／1440（`curriculum.css` 的 760／900／1100 斷點各一段）。

### 關於常春藤頁 `about_page`

| 欄位 | 現在 | 建議 | 硬上限 | 可留空 |
|---|---|---|---|---|
| `hero_title` 首屏大標 | 7／7 | `aboutPageTitle` 16 | 每行 7、3 行 | 否 |
| `hero_lede` | 59 | `aboutPageLede` 70 | 120 | 否 |
| `hero_caption` 卡紙上的一句話 | 11 | `aboutPageCaption` 12 | 20 | 否 |
| `chapter_names[]` 章名 | 5 | `aboutChapter` 5 | 6 | 否 |
| `story_title` | 5／7 | `aboutPageTitle` 16 | 每行 7、3 行（紀念章在右上，1440 寬 7 字剛好不碰） | 否 |
| `whole_title` | 6／8 | `aboutPageTitle` 16 | 每行 9、3 行 | 否 |
| `hope_title` | 9／7 | `aboutPageTitle` 16 | 每行 9、3 行 | 否 |
| `story_text` | 64 | `aboutPageText` 70 | 120 | 否 |
| `milestones[].year` | — | — | 1950–2100、由早到晚 | 否 |
| `milestones[].text` | 17 | `aboutMilestone` 18 | 30 | 否 |
| `whole_text` | 46 | `aboutPageText` 70 | 100 | 否 |
| `whole_fine` | 49 | `aboutFine` 55 | 100 | 否 |
| `whole_fine_source` | 13 | `aboutSource` 16 | 30 | 是 |
| `hope_quotes[]` | 34 | `aboutQuote` 40 | 70 | 否 |
| `outro_title`（也是目次最後一格） | 4 | `aboutOutroTitle` 6 | 6 | 否 |
| `outro_text` | 37 | `aboutOutroText` 45 | 80 | 否 |

固定項目：`chapter_names` 4（一路走來、全人教育、我們的期許、家長怎麼說；第四章沒有家長分享時整章不出現）、`milestones` 5（`yihua, minghua, chongde, international, renwu`）、`hope_quotes` 2。照片版位：`hero_photo`（about-hero）、`hero_back_photo`（about-curious）、`hope_photo`（about-together）。

---

# 階段 A：特色教學頁 `/curriculum`

### Task 0: 開工準備

**Files:** 無（環境）

- [ ] **Step 1: 看有沒有別的 session 在動同一批檔案**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admin
git fetch origin
git worktree list
for b in $(git branch --format='%(refname:short)' | grep -E 'about|curric|ux|page-cms'); do echo "== $b"; git log --oneline origin/main..$b | head -3; git diff --name-only origin/main...$b -- web/app/components/AboutContent.vue web/app/components/CurriculumContent.vue admin/src/router/nav.ts admin/src/api/contentFieldLabels.ts 2>/dev/null; done
df -h ~ | tail -1
```

Expected：沒有在途分支動 `AboutContent.vue`／`CurriculumContent.vue`；磁碟剩 2GB 以上。有衝突的在途分支就先回報使用者，不要開工。

- [ ] **Step 2: 開 sparse worktree**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admin
WT=~/Desktop/ivy-website-page-cms-$(date +%Y%m%d)
git worktree add --no-checkout --no-track -b feature/page-cms-$(date +%Y%m%d) "$WT" origin/main
cd "$WT"
git sparse-checkout set --cone web backend admin content contracts tests deploy scripts docs .github
git checkout
echo "$WT"
```

Expected：印出 worktree 路徑。**之後所有指令都在這個 worktree 根目錄執行**（每次 Bash 呼叫先 `cd` 進去）。

- [ ] **Step 3: 安裝依賴（不要 symlink 別人的 node_modules）**

```bash
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm ci; npm --prefix web ci; npm --prefix admin ci
cd backend; uv sync --frozen
```

Expected：三次 `npm ci` 都 `added … packages`；`uv sync` 結束碼 0。

- [ ] **Step 4: 建測試庫並 migrate**

```bash
createdb ivy_website_pagecms_test 2>/dev/null; true
cd backend
WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pagecms_test WEBSITE_SESSION_SECRET=local-only uv run --frozen alembic upgrade head
```

Expected：最後一行是 `Running upgrade … -> <head>` 或沒有輸出（已是最新）。本機 Postgres 起不來時：把過期的 `postmaster.pid` 移開再 `brew services restart postgresql@14`。

- [ ] **Step 5: 基準綠燈**

```bash
cd backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pagecms_test uv run --frozen pytest -q tests/test_admission_content.py tests/test_content_initialize.py tests/test_privacy_policy_content.py
cd ../web; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npx vitest run tests/curriculum.spec.ts tests/about.spec.ts tests/draft-preview.spec.ts
cd ../admin; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npx vitest run src/__tests__/privacyPolicy.test.ts src/__tests__/bugfixRegressions.test.ts
```

Expected：三組全過（`passed`，0 failed）。不過就停下來回報，不要在紅燈上開工。

### Task 1: 改版前畫面基準

**Files:**
- Create: `scripts/page-ssr-snapshot.cjs`

- [ ] **Step 1: 寫腳本**

```js
// 整頁內容改讀後台前後的畫面比對：抓 SSR 的 <main>（去掉 Vue 的註解標記與標籤間空白）
// 與桌機／手機整頁截圖（減少動態）。先開 fixture 模式的 dev server（計畫 Task 1 Step 2）。
//   node scripts/page-ssr-snapshot.cjs before /curriculum /about
//   node scripts/page-ssr-snapshot.cjs after /curriculum
// 輸出在 output/page-cms/<label>/（已 gitignore）。閘門：兩份 .html 的 diff 必須為空。
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const BASE = process.env.PAGE_CMS_BASE ?? 'http://127.0.0.1:3141'
const [label, ...routes] = process.argv.slice(2)
if (!label || routes.length === 0) {
  console.error('用法：node scripts/page-ssr-snapshot.cjs <label> <path...>')
  process.exit(2)
}
const outDir = path.join('output', 'page-cms', label)
fs.mkdirSync(outDir, { recursive: true })

function mainHtml(html) {
  const start = html.indexOf('<main')
  const end = html.indexOf('</main>', start)
  if (start < 0 || end < 0) throw new Error('找不到 <main>')
  return html.slice(start, end + '</main>'.length).replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><')
}

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome' })
  try {
    for (const route of routes) {
      const name = route.replace(/^\//, '') || 'home'
      const response = await fetch(BASE + route)
      if (!response.ok) throw new Error(`${route} 回 ${response.status}`)
      fs.writeFileSync(path.join(outDir, `${name}.html`), `${mainHtml(await response.text())}\n`)
      for (const [device, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
        const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' })
        await context.addInitScript(() => sessionStorage.setItem('ivy-entrance-a-seen', '1'))
        const page = await context.newPage()
        await page.goto(BASE + route, { waitUntil: 'networkidle' })
        await page.evaluate(async () => {
          for (let y = 0; y < document.body.scrollHeight; y += 400) {
            window.scrollTo(0, y)
            await new Promise((resolve) => setTimeout(resolve, 60))
          }
          window.scrollTo(0, 0)
          await document.fonts.ready
        })
        await page.waitForLoadState('networkidle')
        await page.screenshot({ path: path.join(outDir, `${name}-${device}.png`), fullPage: true })
        await context.close()
      }
      console.log(`已存 ${route} → ${outDir}`)
    }
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
```

- [ ] **Step 2: 開 fixture 模式 dev server（背景執行）**

```bash
cd web; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; NUXT_WEBSITE_ENV=development NUXT_PUBLIC_CONTENT_MODE=fixture npx nuxt dev --port 3141 --host 127.0.0.1
```

用 `run_in_background`。等到 `curl -sf -o /dev/null http://127.0.0.1:3141/curriculum` 結束碼 0（第一次編譯約 30–60 秒）。這個 server 一直開到 Task 9 結束；收工用 `pkill -f "nuxt dev --port 3141"`（只殺自己的埠）。

- [ ] **Step 3: 抓改版前基準**

```bash
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; node scripts/page-ssr-snapshot.cjs before /curriculum /about
ls output/page-cms/before
```

Expected：`about.html about-desktop.png about-mobile.png curriculum.html curriculum-desktop.png curriculum-mobile.png`。

- [ ] **Step 4: 確認截圖可重現（同一份程式連抓兩次要相同）**

```bash
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; node scripts/page-ssr-snapshot.cjs before-again /curriculum /about
diff output/page-cms/before/curriculum.html output/page-cms/before-again/curriculum.html && diff output/page-cms/before/about.html output/page-cms/before-again/about.html && echo SSR-SAME
cd backend; uv run --frozen --with pillow python - <<'EOF'
from PIL import Image, ImageChops
for name in ["curriculum-desktop", "curriculum-mobile", "about-desktop", "about-mobile"]:
    a = Image.open(f"../output/page-cms/before/{name}.png").convert("RGB")
    b = Image.open(f"../output/page-cms/before-again/{name}.png").convert("RGB")
    print(name, a.size == b.size and ImageChops.difference(a, b).getbbox() is None)
EOF
```

Expected：`SSR-SAME`；四張截圖都 `True`。截圖若 `False`（動態或延遲載入造成），之後的截圖比對只當人工參考，**SSR diff 仍是閘門**，在 README 紀錄這件事。

- [ ] **Step 5: Commit**

```bash
git add scripts/page-ssr-snapshot.cjs
git commit -m "chore(web): 加整頁內容改版前後的 SSR 與截圖比對腳本

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: 後端 `curriculum_page` 內容種類

**Files:**
- Create: `backend/app/content/page_schemas.py`
- Modify: `backend/app/content/registry.py`（import 區、`_extract_home_news_media_refs` 之後、`CONTENT_KIND_REGISTRY` 的 `admission_content` 之後）
- Test: `backend/tests/test_curriculum_page_content.py`

**Interfaces:**
- Produces: `page_title(value, *, per_line, max_lines=3, what) -> str`、`page_text(value, *, limit, what, allow_blank=False) -> str`、`exactly(value, count, what) -> list`、`PagePhotoFields`、`CURRICULUM_DIRECTION_KEYS: tuple[str, ...]`、`CurriculumPagePayload`；registry 的 `_list_slot_refs(payload, list_name, label_key)`、`CONTENT_KIND_REGISTRY["curriculum_page"]`（`shared_only=True`）。

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_curriculum_page_content.py`：

```python
"""特色教學頁（curriculum_page）：payload 規則與素材引用。"""
from __future__ import annotations

import copy
import uuid

import pytest
from pydantic import ValidationError

from app.content.page_schemas import CURRICULUM_DIRECTION_KEYS, CurriculumPagePayload
from app.content.registry import CONTENT_KIND_REGISTRY, set_at_path


def _base(**changes) -> dict:
    payload = {
        "hero_eyebrow": "常春藤幼兒園 · 特色教學",
        "hero_title": "從動手做開始，\n愛上學習。",
        "hero_highlight": "動手做",
        "hero_lede": "四個年段與七個課程方向。",
        "hero_notice": "",
        "chapters": [{"label": f"章節{i}", "hint": "小字"} for i in range(4)],
        "years_title": "從幼幼班到大班，\n一年一個樣子。",
        "years_text": "帶著走的核心素養。",
        "spiral_label": "螺旋式課程",
        "spiral_text": "加深、加廣課程。",
        "years_caption": "",
        "years": [{"motto": "老師好愛我", "text": "說明"} for _ in range(4)],
        "directions_title": "每一種學習，\n都從好奇開始。",
        "directions_text": "說明。",
        "directions": [{"key": key, "title": "標題", "sub": "副標", "text": "說明"} for key in CURRICULUM_DIRECTION_KEYS],
        "gallery_title": "每一件作品",
        "gallery_text": "說明。",
        "gallery_source": "",
        "gallery": [{"label": "作品"} for _ in range(8)],
        "daily_title": "五件事",
        "daily_text": "說明。",
        "daily_source": "",
        "daily": [{"title": "靜心", "text": "說明"} for _ in range(5)],
        "belief_title": "我們相信",
        "beliefs": ["重視愛與關懷"] * 5,
        "belief_close": "結語。",
        "belief_source": "",
    }
    payload.update(changes)
    return payload


def test_registered_as_shared_only_and_valid_base():
    assert CONTENT_KIND_REGISTRY["curriculum_page"].shared_only is True
    parsed = CurriculumPagePayload.model_validate(_base())
    assert parsed.hero_photo is None and parsed.directions[0].photo is None


def test_title_newlines_are_normalised():
    parsed = CurriculumPagePayload.model_validate(_base(hero_title="從動手做開始，\r\n愛上學習。"))
    assert parsed.hero_title == "從動手做開始，\n愛上學習。"


@pytest.mark.parametrize(
    "title",
    ["一\n二\n三\n四", "一" * 15, "從動手做開始，\n\n愛上學習。", "  ", "\n愛上學習。"],
)
def test_title_rules(title):
    with pytest.raises(ValidationError):
        CurriculumPagePayload.model_validate(_base(hero_title=title))


@pytest.mark.parametrize(
    "changes",
    [
        {"hero_lede": "第一行\n第二行"},
        {"hero_lede": "字" * 91},
        {"hero_lede": "  "},
        {"spiral_label": "字" * 11},
        {"beliefs": ["字" * 25] + ["重視愛與關懷"] * 4},
        {"hero_lede": "javascript:alert(1)"},
    ],
)
def test_text_rules(changes):
    with pytest.raises(ValidationError):
        CurriculumPagePayload.model_validate(_base(**changes))


def test_optional_texts_may_be_blank():
    parsed = CurriculumPagePayload.model_validate(_base(hero_notice="", gallery_source="", years_caption="", hero_highlight=""))
    assert parsed.hero_notice == "" and parsed.hero_highlight == ""


@pytest.mark.parametrize("field,count", [("chapters", 3), ("years", 5), ("gallery", 7), ("daily", 6), ("beliefs", 4)])
def test_lists_have_fixed_counts(field, count):
    data = copy.deepcopy(_base())
    item = data[field][0]
    data[field] = [copy.deepcopy(item) for _ in range(count)]
    with pytest.raises(ValidationError):
        CurriculumPagePayload.model_validate(data)


def test_direction_keys_are_fixed_and_quote_has_no_photo():
    data = _base()
    data["directions"] = list(reversed(data["directions"]))
    with pytest.raises(ValidationError):
        CurriculumPagePayload.model_validate(data)
    data = _base()
    data["directions"][3]["photo"] = {"media_id": str(uuid.uuid4())}
    with pytest.raises(ValidationError, match="沒有照片"):
        CurriculumPagePayload.model_validate(data)


@pytest.mark.parametrize("highlight", ["不存在", "開始，\n愛上"])
def test_highlight_must_be_inside_one_title_line(highlight):
    with pytest.raises(ValidationError, match="顏料"):
        CurriculumPagePayload.model_validate(_base(hero_highlight=highlight))


def test_media_refs_cover_every_photo_slot():
    ids = [str(uuid.uuid4()) for _ in range(5)]
    data = _base(hero_photo={"media_id": ids[0]}, years_photo={"media_id": ids[1]})
    data["directions"][2]["photo"] = {"media_id": ids[2]}
    data["gallery"][7]["photo"] = {"media_id": ids[3], "focus_x": 30, "focus_y": 40}
    data["daily"][0]["photo"] = {"media_id": ids[4]}
    refs = CONTENT_KIND_REGISTRY["curriculum_page"].extract_media_refs(data)
    assert [(str(r.media_id), r.path, r.kind) for r in refs] == [
        (ids[0], "hero_photo.media_id", "image"),
        (ids[1], "years_photo.media_id", "image"),
        (ids[2], "directions[2].photo.media_id", "image"),
        (ids[3], "gallery[7].photo.media_id", "image"),
        (ids[4], "daily[0].photo.media_id", "image"),
    ]
    assert refs[2].label == "標題"
    replacement = str(uuid.uuid4())
    set_at_path(data, refs[2].path, replacement)
    assert data["directions"][2]["photo"]["media_id"] == replacement
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pagecms_test uv run --frozen pytest -q tests/test_curriculum_page_content.py
```

Expected：`ModuleNotFoundError: No module named 'app.content.page_schemas'`。

- [ ] **Step 3: 寫 `page_schemas.py`**

```python
"""整頁內容：特色教學頁（curriculum_page）；關於常春藤頁（about_page）在階段 B 加入。

2026-10-03 使用者裁定「文字與照片都開放」：標題、內文、照片都能在後台改，章節
數量、順序與版面結構固定（水彩版的錯落排法、立體書的卡紙位置都照項目數排好，
多一項少一項就跑版），所以清單一律「恰好幾項」、項目代號固定。

字數兩層：這裡是擋存檔的硬上限（超過版面會壞，scripts/page-copy-stress.cjs 實測），
後台 composables/contentHints.ts 是只提醒的建議值。上限表見 DESIGN.md「特色教學頁、
關於常春藤頁開放後台編輯」，改上限要三處一起改。
標題欄位用 \\n 表示換行（同孩子的一天的拍立得標題），其餘欄位不收換行。
"""
from __future__ import annotations

from pydantic import Field, ValidationInfo, field_validator, model_validator

from app.content.schemas import (
    MEDIA_ALT_MAX_LENGTH,
    MediaSlotPayload,
    _ContentPayload,
    _reject_unsafe_strings,
)


def page_title(value: str, *, per_line: int, max_lines: int = 3, what: str = "標題") -> str:
    value = value.replace("\r\n", "\n").replace("\r", "\n")
    if not value.strip():
        raise ValueError(f"{what}不可空白")
    lines = value.split("\n")
    if len(lines) > max_lines:
        raise ValueError(f"{what}最多 {max_lines} 行")
    for line in lines:
        if not line.strip():
            raise ValueError(f"{what}不能有空白行")
        if len(line) > per_line:
            raise ValueError(f"{what}每行最多 {per_line} 字（有一行 {len(line)} 字）")
    return value


def page_text(value: str, *, limit: int, what: str, allow_blank: bool = False) -> str:
    if "\n" in value or "\r" in value:
        raise ValueError(f"{what}不能換行")
    if not allow_blank and not value.strip():
        raise ValueError(f"{what}不可空白")
    if len(value) > limit:
        raise ValueError(f"{what}最多 {limit} 字")
    return value


def exactly(value: list, count: int, what: str) -> list:
    if len(value) != count:
        raise ValueError(f"{what}固定 {count} 項，不能增減")
    return value


class PagePhotoFields(_ContentPayload):
    """清單項目的照片版位：留空＝官網內建照片與內建說明。"""

    photo: MediaSlotPayload | None = None
    photo_alt: str = Field(default="", max_length=MEDIA_ALT_MAX_LENGTH)


# 課程方向的順序就是官網的錯落排法（curriculum.css 的 cur-dir--<key>）；quote 是印在
# 顏料上的引言，沒有照片。
CURRICULUM_DIRECTION_KEYS = ("cognitive", "integrated", "multicultural", "quote", "autonomy", "activities", "art")


class CurriculumChapterPayload(_ContentPayload):
    label: str
    hint: str

    @field_validator("label")
    @classmethod
    def _label(cls, value: str) -> str:
        return page_text(value, limit=10, what="章節名稱")

    @field_validator("hint")
    @classmethod
    def _hint(cls, value: str) -> str:
        return page_text(value, limit=14, what="章節小字")


class CurriculumYearPayload(_ContentPayload):
    motto: str
    text: str

    @field_validator("motto")
    @classmethod
    def _motto(cls, value: str) -> str:
        return page_text(value, limit=10, what="年段標語")

    @field_validator("text")
    @classmethod
    def _text(cls, value: str) -> str:
        return page_text(value, limit=100, what="年段說明")


class CurriculumDirectionPayload(PagePhotoFields):
    key: str
    title: str
    sub: str
    text: str

    @field_validator("title")
    @classmethod
    def _title(cls, value: str) -> str:
        return page_text(value, limit=10, what="課程方向的標題")

    @field_validator("sub")
    @classmethod
    def _sub(cls, value: str) -> str:
        return page_text(value, limit=30, what="課程方向的副標")

    @field_validator("text")
    @classmethod
    def _text(cls, value: str) -> str:
        return page_text(value, limit=50, what="課程方向的說明")


class CurriculumArtworkPayload(PagePhotoFields):
    label: str

    @field_validator("label")
    @classmethod
    def _label(cls, value: str) -> str:
        return page_text(value, limit=10, what="作品名稱")


class CurriculumDailyPayload(PagePhotoFields):
    title: str
    text: str

    @field_validator("title")
    @classmethod
    def _title(cls, value: str) -> str:
        return page_text(value, limit=8, what="五件事的名稱")

    @field_validator("text")
    @classmethod
    def _text(cls, value: str) -> str:
        return page_text(value, limit=160, what="五件事的介紹")


# 欄位: (每行字數, 欄位名稱)
_CURRICULUM_TITLES = {
    "hero_title": (14, "首屏大標"),
    "years_title": (16, "四個年段的標題"),
    "directions_title": (16, "課程方向的標題"),
    "gallery_title": (16, "兒童美術館的標題"),
    "daily_title": (16, "五件事的標題"),
    "belief_title": (18, "教學理念的標題"),
}
# 欄位: (上限, 欄位名稱, 可留空)
_CURRICULUM_TEXTS = {
    "hero_eyebrow": (24, "首屏小標", False),
    "hero_highlight": (8, "大標裡畫顏料的字", True),
    "hero_lede": (90, "首屏介紹", False),
    "hero_notice": (60, "首屏提醒", True),
    "years_text": (80, "四個年段的說明", False),
    "spiral_label": (10, "螺旋式課程的標題", False),
    "spiral_text": (60, "螺旋式課程的說明", False),
    "years_caption": (30, "照片下方文字", True),
    "directions_text": (80, "課程方向的說明", False),
    "gallery_text": (80, "兒童美術館的說明", False),
    "gallery_source": (50, "作品照片出處", True),
    "daily_text": (80, "五件事的說明", False),
    "daily_source": (30, "五件事的出處", True),
    "belief_close": (50, "教學理念的結語", False),
    "belief_source": (30, "教學理念的出處", True),
}


class CurriculumPagePayload(_ContentPayload):
    """特色教學頁（/curriculum）。英文小字、章節編號、年段名稱與年齡、顏料與版面
    寫在官網 CurriculumContent.vue，不在這裡。"""

    hero_eyebrow: str
    hero_title: str
    # 大標裡要畫橘色顏料的字（必須和大標同一行裡的字一模一樣）；空字串＝不畫。
    hero_highlight: str = ""
    hero_lede: str
    hero_notice: str
    hero_photo: MediaSlotPayload | None = None
    hero_photo_alt: str = Field(default="", max_length=MEDIA_ALT_MAX_LENGTH)
    chapters: list[CurriculumChapterPayload]
    years_title: str
    years_text: str
    spiral_label: str
    spiral_text: str
    years_photo: MediaSlotPayload | None = None
    years_photo_alt: str = Field(default="", max_length=MEDIA_ALT_MAX_LENGTH)
    years_caption: str
    years: list[CurriculumYearPayload]
    directions_title: str
    directions_text: str
    directions: list[CurriculumDirectionPayload]
    gallery_title: str
    gallery_text: str
    gallery_source: str
    gallery: list[CurriculumArtworkPayload]
    daily_title: str
    daily_text: str
    daily_source: str
    daily: list[CurriculumDailyPayload]
    belief_title: str
    beliefs: list[str]
    belief_close: str
    belief_source: str

    @field_validator(*_CURRICULUM_TITLES)
    @classmethod
    def _titles(cls, value: str, info: ValidationInfo) -> str:
        per_line, what = _CURRICULUM_TITLES[info.field_name]
        return page_title(value, per_line=per_line, what=what)

    @field_validator(*_CURRICULUM_TEXTS)
    @classmethod
    def _texts(cls, value: str, info: ValidationInfo) -> str:
        limit, what, allow_blank = _CURRICULUM_TEXTS[info.field_name]
        return page_text(value, limit=limit, what=what, allow_blank=allow_blank)

    @field_validator("hero_highlight")
    @classmethod
    def _highlight_in_title(cls, value: str, info: ValidationInfo) -> str:
        title = info.data.get("hero_title")
        # 大標本身沒過驗證時 info.data 沒有它，交給大標的錯誤訊息。
        if value and isinstance(title, str) and not any(value in line for line in title.split("\n")):
            raise ValueError("大標裡畫顏料的字要和大標同一行裡的字一模一樣")
        return value

    @field_validator("chapters")
    @classmethod
    def _chapters(cls, value: list) -> list:
        return exactly(value, 4, "章節索引")

    @field_validator("years")
    @classmethod
    def _years(cls, value: list) -> list:
        return exactly(value, 4, "四個年段")

    @field_validator("directions")
    @classmethod
    def _directions(cls, value: list[CurriculumDirectionPayload]) -> list[CurriculumDirectionPayload]:
        if tuple(item.key for item in value) != CURRICULUM_DIRECTION_KEYS:
            raise ValueError("課程方向固定 7 項，項目與順序不能改")
        if any(item.key == "quote" and item.photo is not None for item in value):
            raise ValueError("品德培養是印在顏料上的引言，沒有照片")
        return value

    @field_validator("gallery")
    @classmethod
    def _gallery(cls, value: list) -> list:
        return exactly(value, 8, "兒童美術館的作品")

    @field_validator("daily")
    @classmethod
    def _daily(cls, value: list) -> list:
        return exactly(value, 5, "五件事")

    @field_validator("beliefs")
    @classmethod
    def _beliefs(cls, value: list[str]) -> list[str]:
        return [page_text(item, limit=24, what="教學理念") for item in exactly(value, 5, "教學理念")]

    @model_validator(mode="after")
    def _no_script_scheme(self) -> "CurriculumPagePayload":
        _reject_unsafe_strings(self.model_dump())
        return self
```

- [ ] **Step 4: 註冊到 registry**

`backend/app/content/registry.py` 的 import 區（`from app.content.schemas import (...)` 之後）加：

```python
from app.content.page_schemas import CurriculumPagePayload
```

在 `_extract_home_news_media_refs` 函式之後加：

```python
def _list_slot_refs(payload: dict, list_name: str, label_key: str) -> list[MediaRef | None]:
    """清單每一項的 photo 版位（整頁內容用），路徑像 `directions[2].photo.media_id`。"""
    items = payload.get(list_name)
    if not isinstance(items, list):
        return []
    return [
        _slot_ref(item, "photo", "image", prefix=f"{list_name}[{index}].", label=item.get(label_key))
        for index, item in enumerate(items)
        if isinstance(item, dict)
    ]


def _extract_curriculum_page_media_refs(payload: dict) -> list[MediaRef]:
    return _refs(
        [
            _slot_ref(payload, "hero_photo", "image"),
            _slot_ref(payload, "years_photo", "image"),
            *_list_slot_refs(payload, "directions", "title"),
            *_list_slot_refs(payload, "gallery", "label"),
            *_list_slot_refs(payload, "daily", "title"),
        ]
    )
```

`CONTENT_KIND_REGISTRY` 裡 `"admission_content": ContentKindConfig(AdmissionContentPayload, shared_only=True),` 下一行加：

```python
    # 特色教學頁（2026-10 開放後台編輯）：文字與照片，章節數量與版面固定（page_schemas.py）。
    "curriculum_page": ContentKindConfig(
        CurriculumPagePayload, shared_only=True, extract_media_refs=_extract_curriculum_page_media_refs
    ),
```

- [ ] **Step 5: 跑測試確認通過**

```bash
cd backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pagecms_test uv run --frozen pytest -q tests/test_curriculum_page_content.py tests/test_media_slots.py
```

Expected：全部 passed。

- [ ] **Step 6: Commit**

```bash
git add backend/app/content/page_schemas.py backend/app/content/registry.py backend/tests/test_curriculum_page_content.py
git commit -m "feat(content): 新增特色教學頁內容種類（文字與照片，章節數量固定）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: 預設內容進 fixture＋初始化＋API

**Files:**
- Modify: `web/server/data/site-fixture.json`（`  "booking": {` 那行前面）
- Modify: `content/site-fixture.json`（`  "booking": {` 那行前面）
- Modify: `backend/app/content/initialize.py`（`initial_payloads` 的 `admission_content` 那行之後）
- Modify: `backend/tests/test_content_initialize.py:18,48`（21 → 22）
- Test: `backend/tests/test_curriculum_page_content.py`（追加）

**Interfaces:**
- Produces: fixture 頂層鍵 `curriculumPage`（camelCase 頂層、巢狀同 payload），`initial_payloads()` 多一筆 `("curriculum_page", None, …)`。

- [ ] **Step 1: 追加失敗的測試**

`backend/tests/test_curriculum_page_content.py` 檔頭 import 補上：

```python
import json
from pathlib import Path

from app.content.initialize import _copy_fields, initial_payloads
from tests.conftest import publish_booking_consent

API = "/api/website/v1"
ITEM = f"{API}/admin/content-items/curriculum_page"
FIXTURE = Path(__file__).resolve().parents[2] / "content" / "site-fixture.json"
WEB_FIXTURE = Path(__file__).resolve().parents[2] / "web" / "server" / "data" / "site-fixture.json"


def _fixture_payload() -> dict:
    return _copy_fields(json.loads(FIXTURE.read_text())["curriculumPage"], "curriculum_page")
```

檔尾追加：

```python
def test_both_fixtures_carry_the_same_curriculum_copy():
    # 後端初始化讀 content/，官網讀 web/server/data/；不同步時 CMS 發布前後畫面會跳。
    assert json.loads(FIXTURE.read_text())["curriculumPage"] == json.loads(WEB_FIXTURE.read_text())["curriculumPage"]


def test_fixture_copy_passes_the_rules_and_keeps_the_sources():
    payload = CurriculumPagePayload.model_validate(_fixture_payload())
    assert payload.hero_highlight == "動手做"
    assert [d.key for d in payload.directions] == list(CURRICULUM_DIRECTION_KEYS)
    assert "常春藤兒童美術館" in payload.gallery_source
    assert payload.daily_source == "照片與介紹取自義華校。"
    assert payload.belief_source == "取自義華校教學理念。"


def test_initialize_includes_curriculum_page_without_photos():
    entries = {kind: payload for kind, _campus, payload in initial_payloads(json.loads(FIXTURE.read_text()))}
    assert entries["curriculum_page"]["hero_photo"] is None
    assert all(item["photo"] is None for item in entries["curriculum_page"]["gallery"])


async def _save(client, payload: dict) -> dict:
    item = (await client.get(ITEM)).json()
    return await client.post(f"{ITEM}/revisions", json={"expected_version": item["latest_version"], "payload": payload})


@pytest.mark.asyncio
async def test_public_site_has_page_only_after_publish(admin_client, public_client, db_session):
    await publish_booking_consent(db_session)  # 先有一個 release，/public/site 才有內容可讀
    assert "curriculum_page" not in (await public_client.get(f"{API}/public/site")).json()["content"]
    saved = await _save(admin_client, _fixture_payload())
    assert saved.status_code == 201, saved.text
    revision = saved.json()["latest_revision"]
    published = await admin_client.post(f"{ITEM}/publish", json={"revision_id": revision["id"]})
    assert published.status_code == 200, published.text
    live = (await public_client.get(f"{API}/public/site")).json()["content"]["curriculum_page"]
    assert live == CurriculumPagePayload.model_validate(_fixture_payload()).model_dump()


@pytest.mark.asyncio
async def test_unknown_media_in_a_list_photo_is_rejected(admin_client):
    payload = _fixture_payload()
    payload["gallery"][2]["photo"] = {"media_id": str(uuid.uuid4())}
    saved = await _save(admin_client, payload)
    assert saved.status_code == 422
    assert saved.json()["detail"]["code"] == "MEDIA_NOT_FOUND"


@pytest.mark.asyncio
async def test_editor_can_read_but_not_edit(editor_client):
    assert (await editor_client.get(ITEM)).status_code == 200
    denied = await _save(editor_client, _fixture_payload())
    assert denied.status_code == 403
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pagecms_test uv run --frozen pytest -q tests/test_curriculum_page_content.py
```

Expected：新測試 `KeyError: 'curriculumPage'`。

- [ ] **Step 3: 兩份 fixture 加內建內容**

在 `web/server/data/site-fixture.json` 與 `content/site-fixture.json` 各自的 `  "booking": {` 那一行**前面**插入（兩份完全相同，含最後的逗號與空行；照抄 `CurriculumContent.vue:15-72,86-211` 現在的字）：

```json
  "curriculumPage": {
    "heroEyebrow": "常春藤幼兒園 · 特色教學",
    "heroTitle": "從動手做開始，\n愛上學習。",
    "heroHighlight": "動手做",
    "heroLede": "幼幼班到大班的四個年段、七個課程方向、孩子的作品，還有每天常做的五件事。",
    "heroNotice": "照片取自各校日常，實際課程安排以各校說明為準。",
    "chapters": [
      { "label": "四個年段", "hint": "幼幼班到大班" },
      { "label": "課程方向", "hint": "7 個方向" },
      { "label": "兒童美術館", "hint": "孩子的作品" },
      { "label": "五件事", "hint": "靜心到大肌肉" }
    ],
    "yearsTitle": "從幼幼班到大班，\n一年一個樣子。",
    "yearsText": "給孩子樂於學習、創造思考、勇敢表現、帶著走的核心素養。",
    "spiralLabel": "螺旋式課程",
    "spiralText": "以螺旋式的方法加深、加廣課程，延伸孩子各項能力。",
    "yearsCaption": "老師和孩子們一起笑成一團。",
    "years": [
      { "motto": "老師好愛我", "text": "全方位的保育環境，給孩子安全感及信賴感，這是寶貝第一個團體生活喔。" },
      { "motto": "我會自己做", "text": "會自己吃飯、會自己整理，會跟好朋友玩，也會跟老師分享，更會自己主動唸好好玩的故事書喔。" },
      { "motto": "我喜歡學習", "text": "打造扎實的學習基礎，語文、認知、邏輯、創造能力都好厲害喔。" },
      { "motto": "要上小學囉", "text": "打好基礎做準備，我長大了，好期待上小學喔！" }
    ],
    "directionsTitle": "每一種學習，\n都從好奇開始。",
    "directionsText": "從每天的繪本共讀，到音樂、美語、戶外教學與藝術創作。",
    "directions": [
      { "key": "cognitive", "title": "認知課程", "sub": "每日一繪本親子共讀", "text": "打好學齡前語文基礎，幼小銜接不擔心。" },
      { "key": "integrated", "title": "統整課程", "sub": "奧福音樂、感覺統合、主題學習", "text": "完整豐富的統整課程。" },
      { "key": "multicultural", "title": "多元文化課程", "sub": "沉浸式美語活動", "text": "孩子勇敢、自信、快樂表現。" },
      { "key": "quote", "title": "品德培養", "sub": "六歲定八十", "text": "好習慣一生受用無窮。" },
      { "key": "autonomy", "title": "自主學習", "sub": "動手做、做中學", "text": "讓孩子主動學習教具操作。" },
      { "key": "activities", "title": "課程活動", "sub": "主題戶外教學", "text": "節慶活動及好玩的親子活動。" },
      { "key": "art", "title": "藝術共創", "sub": "每個孩子都是與生俱來的藝術家", "text": "給孩子創造思考、解決問題的能力。" }
    ],
    "galleryTitle": "每一件作品，\n都從動手做開始。",
    "galleryText": "帆布袋、畫布、黏土到木頭飛機，這裡是孩子們的作品。",
    "gallerySource": "作品照片取自機構網站「常春藤兒童美術館」。",
    "gallery": [
      { "label": "畫布上的人" },
      { "label": "黏土球" },
      { "label": "帆布袋" },
      { "label": "木頭飛機" },
      { "label": "染色 T 恤" },
      { "label": "畫布上的人" },
      { "label": "膠帶留白畫" },
      { "label": "木頭飛機" }
    ],
    "dailyTitle": "五件事，\n陪孩子慢慢練習。",
    "dailyText": "安靜下來、動手操作、創作、閱讀，再到戶外盡情跑跳。",
    "dailySource": "照片與介紹取自義華校。",
    "daily": [
      { "title": "靜心", "text": "透過靜心活動，引導孩子穩定情緒、學習自我調節，陪伴寶貝在日常中培養尊重、關懷與自我接納，學會愛自己，也溫柔對待他人。" },
      { "title": "教具操作", "text": "以個別化的自主教具，引導孩子主動探索與學習。堅持動手做、從做中學，老師依孩子的年齡與能力，自行設計合適的教具，讓寶貝在操作中累積知識，一步步建立學習帶來的自信心。" },
      { "title": "美術創作", "text": "配合孩子的發展，提供主題式的完整學習架構，以孩子為本，引導思考與感受，在學習中培養美學素養，讓寶貝愛上探索美感，逐步發展多元的創作能力。" },
      { "title": "閱讀素養", "text": "以「親子共讀」拉近親子距離，在溫馨的閱讀時光中，培養寶貝愛閱讀的好習慣，穩定情緒、提升認知能力，為學齡前的學習素養奠定更好的基礎。" },
      { "title": "大肌肉時間", "text": "重視寶貝成長中不可或缺的推動力量，透過大量戶外活動與陽光陪伴，讓寶貝盡情與同儕互動、開心放電，在歡笑中學習，在自然中健康成長。" }
    ],
    "beliefTitle": "我們相信，教育是\n「生命影響生命」的使命。",
    "beliefs": ["重視愛與關懷", "注重閱讀素養", "培養生活自理能力", "養成終生學習的好習慣", "尊重個別差異，鼓勵自信探索"],
    "beliefClose": "期許幼兒在成長階段，擁有快樂、健康的環境。",
    "beliefSource": "取自義華校教學理念。"
  },

```

插完逐字核對：`python3 -c "import json;print(json.load(open('web/server/data/site-fixture.json'))['curriculumPage']==json.load(open('content/site-fixture.json'))['curriculumPage'])"` 要印 `True`。

- [ ] **Step 4: initialize 加這一筆**

`backend/app/content/initialize.py` 的 `initial_payloads`，`("admission_content", None, _copy_fields(data["admission"], "admission_content")),` 之後加：

```python
        # 特色教學頁（2026-10 開放後台編輯）：照片版位不帶（留空＝官網內建照片）。
        ("curriculum_page", None, _copy_fields(data["curriculumPage"], "curriculum_page")),
```

`backend/tests/test_content_initialize.py` 第 18 行 `== 21` 改 `== 22`、第 48 行 `== 21` 改 `== 22`。

- [ ] **Step 5: 跑測試確認通過**

```bash
cd backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pagecms_test uv run --frozen pytest -q tests/test_curriculum_page_content.py tests/test_content_initialize.py tests/test_admission_content.py tests/test_site_structure_content.py tests/test_media_slots.py
```

Expected：全部 passed（`test_media_slots.py` 會讀 web fixture，記憶 web-fixture-backend-tests）。

- [ ] **Step 6: Commit**

```bash
git add web/server/data/site-fixture.json content/site-fixture.json backend/app/content/initialize.py backend/tests/test_content_initialize.py backend/tests/test_curriculum_page_content.py
git commit -m "feat(content): 特色教學頁的內建文字進 fixture 與初始化，公開輸出與權限測試

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: 官網型別、overlay 與共用工具

**Files:**
- Create: `web/app/utils/page-content.ts`
- Modify: `web/app/types/site-content.ts`（`SiteContent` 介面之前加型別，`SiteContent` 加欄位）
- Modify: `web/app/utils/media-image.ts`（檔尾）
- Modify: `web/app/utils/content-overlay.ts`（`LivePrivacyPolicy` 之後加型別、`ContentOverlay` 加欄位、`privacy_policy` 的 guard 之後加 guard）
- Test: `web/tests/page-content.spec.ts`

**Interfaces:**
- Produces（web）：`PagePhoto { photo?: MediaImage; photoAlt?: string }`、`CurriculumPageContent`、`SiteContent.curriculumPage`；`PAGE_COUNTS`、`assertCounts(lists, expected)`、`pageTitleLines(text): string[]`、`pageMarkedLines(text, mark): MarkedLine[]`、`pagePhotoAttrs(builtin, photo, sizes)`、`withPhotoStyle(attrs, photo)`（原本沒有 `:style` 的 `<img>` 用）、`pagePhotoAlt(builtinAlt, photo, alt): string`、`pagePhotoStyle(builtinPosition, photo): { objectPosition: string } | undefined`（原本就有 `:style` 的 `<img>` 用）、`rocYear(year): number`；`curriculumHeroAttrs(page)`；`LiveCurriculumPage`、`ContentOverlay.curriculum_page`。
- 為什麼分 `withPhotoStyle` 與 `pagePhotoStyle`：`<img v-bind="obj" :style="…">` 在 SSR 會經 `mergeProps` 把 `style` 正規化成 `{}`，輸出 `style=""`；原本沒有 `:style` 的圖片若新加 `:style`，改版前後 SSR 就不同。所以原本沒有 `:style` 的圖片只在後台照片有焦點時才把 `style` 併進 `v-bind` 物件。

- [ ] **Step 1: 寫失敗的測試**

`web/tests/page-content.spec.ts`：

```ts
import { describe, expect, it, vi } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { applyContentOverlay, type LiveCurriculumPage } from '../app/utils/content-overlay'
import { curriculumHeroAttrs, type MediaInfoMap } from '../app/utils/media-image'
import { CURRICULUM_HERO_IMAGE, CURRICULUM_HERO_SIZES, responsiveImage } from '../app/utils/responsive-image'
import { pageMarkedLines, pagePhotoAlt, pagePhotoStyle, pageTitleLines, rocYear, withPhotoStyle } from '../app/utils/page-content'

const site = fixture as unknown as SiteContent
const MEDIA = '3f2c1a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c'
const media: MediaInfoMap = {
  [MEDIA]: { id: MEDIA, kind: 'image', content_type: 'image/webp', width: 1600, height: 1200, alt_text: '素材庫說明', focus_x: 30, focus_y: 40, variants: [] }
}
const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
/** fixture 的 camelCase → 後台 payload（頂層轉 snake_case，巢狀欄位兩邊同名） */
function livePayload<T>(source: object): T {
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [snake(key), structuredClone(value)])) as T
}

describe('整頁內容的小工具', () => {
  it('標題用 \\n 換行', () => {
    expect(pageTitleLines('從動手做開始，\n愛上學習。')).toEqual(['從動手做開始，', '愛上學習。'])
  })
  it('顏料標示只畫第一次出現的地方；找不到或留空就整行不畫', () => {
    expect(pageMarkedLines('從動手做開始，\n愛上學習。', '動手做')).toEqual([
      { before: '從', mark: '動手做', after: '開始，' },
      { before: '愛上學習。', mark: '', after: '' }
    ])
    expect(pageMarkedLines('一\n二', '三')).toEqual([{ before: '一', mark: '', after: '' }, { before: '二', mark: '', after: '' }])
    expect(pageMarkedLines('一', '')).toEqual([{ before: '一', mark: '', after: '' }])
  })
  it('照片說明與位置：沒換照片用內建的，換了用後台的', () => {
    const photo = { src: '/x', candidates: [], position: '30% 40%', alt: '素材庫說明' }
    expect(pagePhotoAlt('內建說明', undefined, undefined)).toBe('內建說明')
    expect(pagePhotoAlt('內建說明', photo, '')).toBe('素材庫說明')
    expect(pagePhotoAlt('內建說明', photo, '後台說明')).toBe('後台說明')
    expect(pagePhotoStyle('40% 50%', undefined)).toEqual({ objectPosition: '40% 50%' })
    expect(pagePhotoStyle(undefined, undefined)).toBeUndefined()
    expect(pagePhotoStyle('40% 50%', photo)).toEqual({ objectPosition: '30% 40%' })
    expect(pagePhotoStyle('40% 50%', { ...photo, position: null })).toBeUndefined()
  })
  it('原本沒有 style 的圖片：只有後台照片有焦點時才帶 style（SSR 不多出 style=""）', () => {
    const attrs = { src: '/a.webp', width: 10, height: 10, srcset: undefined, sizes: undefined }
    expect(withPhotoStyle(attrs, undefined)).toEqual(attrs)
    expect('style' in withPhotoStyle(attrs, undefined)).toBe(false)
    expect('style' in withPhotoStyle(attrs, { src: '/x', candidates: [], position: null, alt: '' })).toBe(false)
    expect(withPhotoStyle(attrs, { src: '/x', candidates: [], position: '30% 40%', alt: '' }).style).toEqual({ objectPosition: '30% 40%' })
  })
  it('民國年 = 西元 − 1911', () => {
    expect([1997, 2001, 2005, 2020, 2021].map(rocYear)).toEqual([86, 90, 94, 109, 110])
  })
})

describe('特色教學頁的後台內容', () => {
  it('發布的內容和內建一字不差時，官網內容完全不變', () => {
    const next = applyContentOverlay(site, { curriculum_page: livePayload<LiveCurriculumPage>(site.curriculumPage) })
    expect(next.curriculumPage).toEqual(site.curriculumPage)
  })
  it('換了照片：首屏與清單項目都用素材，說明留空時用素材庫的說明', () => {
    const live = livePayload<LiveCurriculumPage>(site.curriculumPage)
    live.hero_photo = { media_id: MEDIA }
    live.gallery[2] = { ...live.gallery[2]!, photo: { media_id: MEDIA }, photo_alt: '' }
    live.daily[0] = { ...live.daily[0]!, photo: { media_id: MEDIA }, photo_alt: '孩子閉眼靜心' }
    const next = applyContentOverlay(site, { curriculum_page: live }, media).curriculumPage
    expect(next.heroPhoto?.src).toBe(`/api/website/v1/public/media/${MEDIA}/file`)
    expect(next.heroPhoto?.position).toBe('30% 40%')
    expect(next.heroPhotoAlt).toBe('素材庫說明')
    expect(next.gallery[2]!.photoAlt).toBe('素材庫說明')
    expect(next.daily[0]!.photoAlt).toBe('孩子閉眼靜心')
    expect(next.gallery[0]!.photo).toBeUndefined()
  })
  it('項目數不符的舊版內容整份退回內建內容（不讓頁面壞掉）', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const live = livePayload<LiveCurriculumPage>(site.curriculumPage)
    live.gallery = live.gallery.slice(0, 3)
    live.hero_eyebrow = '不該出現'
    expect(applyContentOverlay(site, { curriculum_page: live }).curriculumPage).toEqual(site.curriculumPage)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
  it('首屏照片：沒換照片時和現在的 preload 完全相同', () => {
    expect(curriculumHeroAttrs(site.curriculumPage)).toEqual(responsiveImage(CURRICULUM_HERO_IMAGE, CURRICULUM_HERO_SIZES))
    const live = livePayload<LiveCurriculumPage>(site.curriculumPage)
    live.hero_photo = { media_id: MEDIA }
    expect(curriculumHeroAttrs(applyContentOverlay(site, { curriculum_page: live }, media).curriculumPage).src).toBe(`/api/website/v1/public/media/${MEDIA}/file`)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd web; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npx vitest run tests/page-content.spec.ts
```

Expected：`Failed to resolve import "../app/utils/page-content"`。

- [ ] **Step 3: 型別**

`web/app/types/site-content.ts`，`export interface SiteContent {` 之前加：

```ts
/** 整頁內容的照片版位：後台換過照片才有 photo（photoAlt 是說明）；沒有＝元件用內建圖與內建說明 */
export interface PagePhoto {
  photo?: MediaImage
  photoAlt?: string
}

/**
 * 特色教學頁（/curriculum）在後台改得到的文字與照片（後端 content/page_schemas.py 的
 * CurriculumPagePayload）。章節數量、英文小字、年段名稱、顏料與版面寫在 CurriculumContent.vue，
 * 清單照索引對應。標題用 \n 換行。
 */
export interface CurriculumPageContent {
  heroEyebrow: string
  heroTitle: string
  /** 大標裡畫顏料的字；空字串＝不畫 */
  heroHighlight: string
  heroLede: string
  /** 空字串＝不顯示 */
  heroNotice: string
  heroPhoto?: MediaImage
  heroPhotoAlt?: string
  chapters: { label: string; hint: string }[]
  yearsTitle: string
  yearsText: string
  spiralLabel: string
  spiralText: string
  yearsPhoto?: MediaImage
  yearsPhotoAlt?: string
  /** 空字串＝不顯示 */
  yearsCaption: string
  years: { motto: string; text: string }[]
  directionsTitle: string
  directionsText: string
  directions: ({ key: string; title: string; sub: string; text: string } & PagePhoto)[]
  galleryTitle: string
  galleryText: string
  gallerySource: string
  gallery: ({ label: string } & PagePhoto)[]
  dailyTitle: string
  dailyText: string
  dailySource: string
  daily: ({ title: string; text: string } & PagePhoto)[]
  beliefTitle: string
  beliefs: string[]
  beliefClose: string
  beliefSource: string
}
```

`SiteContent` 的 `privacyPolicy?: PrivacyPolicyContent | null` 之後加 `curriculumPage: CurriculumPageContent`。

- [ ] **Step 4: 共用工具 `web/app/utils/page-content.ts`**

```ts
import { pickImage, type MediaImage } from './media-image'

// 整頁內容（特色教學頁、關於常春藤頁）共用的小工具。後台的標題欄位用 \n 表示換行；
// 照片版位沒換過就用元件寫死的內建圖與內建說明。

/** 各清單固定的項目數（同後端 content/page_schemas.py）；已發布內容不符時官網退回內建內容。 */
export const PAGE_COUNTS = {
  curriculum: { chapters: 4, years: 4, directions: 7, gallery: 8, daily: 5, beliefs: 5 }
} as const

export function assertCounts(lists: Record<string, readonly unknown[] | undefined>, expected: Record<string, number>): void {
  for (const [name, count] of Object.entries(expected)) {
    const actual = lists[name]?.length ?? 0
    if (actual !== count) throw new Error(`${name} 應為 ${count} 項，實際 ${actual} 項`)
  }
}

export function pageTitleLines(text: string): string[] {
  return text.split('\n')
}

export interface MarkedLine {
  before: string
  mark: string
  after: string
}

/** 大標裡要畫顏料的字：只標第一次出現的那一行，其餘整行放 before。 */
export function pageMarkedLines(text: string, mark: string): MarkedLine[] {
  let marked = !mark
  return pageTitleLines(text).map((line) => {
    const at = marked ? -1 : line.indexOf(mark)
    if (at < 0) return { before: line, mark: '', after: '' }
    marked = true
    return { before: line.slice(0, at), mark, after: line.slice(at + mark.length) }
  })
}

export function pagePhotoAttrs(builtin: string, photo: MediaImage | undefined, sizes: string) {
  return pickImage(builtin, photo, sizes)
}

export function pagePhotoAlt(builtinAlt: string, photo: MediaImage | undefined, alt: string | undefined): string {
  return photo ? (alt || photo.alt) : builtinAlt
}

/**
 * 改版前沒有 :style 的 <img> 用：後台照片有焦點時才把 style 併進 v-bind 物件。
 * 不能直接加 :style——v-bind 物件＋:style 會經 mergeProps 正規化成 {}，SSR 輸出 style=""，畫面比對就不再相同。
 */
export function withPhotoStyle<T extends object>(attrs: T, photo: MediaImage | undefined): T | (T & { style: { objectPosition: string } }) {
  return photo?.position ? { ...attrs, style: { objectPosition: photo.position } } : attrs
}

/** 改版前就有 :style 的 <img> 用（課程方向）：後台照片用版位或素材的焦點（沒設就不寫），內建圖用元件寫的位置。 */
export function pagePhotoStyle(builtinPosition: string | undefined, photo: MediaImage | undefined): { objectPosition: string } | undefined {
  const position = photo ? photo.position : builtinPosition
  return position ? { objectPosition: position } : undefined
}

export function rocYear(year: number): number {
  return year - 1911
}
```

- [ ] **Step 5: 首屏照片 helper**

`web/app/utils/media-image.ts`：第 10–11 行的 import 改成

```ts
import type { Campus, CurriculumPageContent, HeroContent } from '../types/site-content'
import { CURRICULUM_HERO_IMAGE, CURRICULUM_HERO_SIZES, HOME_HERO_SIZES, responsiveImage } from './responsive-image'
```

檔尾加：

```ts
/** 特色教學頁首屏照片：頁面 <img> 與 usePageSeo 的 preload 共用，才不會多下載一張。 */
export function curriculumHeroAttrs(page: Pick<CurriculumPageContent, 'heroPhoto'>) {
  return pickImage(CURRICULUM_HERO_IMAGE, page.heroPhoto, CURRICULUM_HERO_SIZES)
}
```

- [ ] **Step 6: overlay**

`web/app/utils/content-overlay.ts`：第 1 行 import 加 `CurriculumPageContent`、`PagePhoto`；加 `import { assertCounts, PAGE_COUNTS } from './page-content'`。`LivePrivacyPolicy` 介面之後加：

```ts
export interface LivePagePhoto {
  photo?: LiveMediaSlot | null
  photo_alt?: string
}

/** 後端 content/page_schemas.py 的 CurriculumPagePayload */
export interface LiveCurriculumPage {
  hero_eyebrow: string
  hero_title: string
  hero_highlight?: string
  hero_lede: string
  hero_notice: string
  hero_photo?: LiveMediaSlot | null
  hero_photo_alt?: string
  chapters: { label: string; hint: string }[]
  years_title: string
  years_text: string
  spiral_label: string
  spiral_text: string
  years_photo?: LiveMediaSlot | null
  years_photo_alt?: string
  years_caption: string
  years: { motto: string; text: string }[]
  directions_title: string
  directions_text: string
  directions: ({ key: string; title: string; sub: string; text: string } & LivePagePhoto)[]
  gallery_title: string
  gallery_text: string
  gallery_source: string
  gallery: ({ label: string } & LivePagePhoto)[]
  daily_title: string
  daily_text: string
  daily_source: string
  daily: ({ title: string; text: string } & LivePagePhoto)[]
  belief_title: string
  beliefs: string[]
  belief_close: string
  belief_source: string
}
```

`ContentOverlay` 的 `privacy_policy?: …` 之後加 `curriculum_page?: LiveCurriculumPage | null`。`guard` 函式之後加：

```ts
/** 整頁內容的照片版位 → 官網用的照片與說明；沒選（或 id 無效）就不帶，元件用內建圖。 */
function pagePhoto(slot: LiveMediaSlot | null | undefined, alt: string | undefined, media: MediaInfoMap): PagePhoto {
  const photo = slotImage(slot, media)
  return photo ? { photo, photoAlt: alt || photo.alt } : {}
}

function curriculumPage(c: LiveCurriculumPage, media: MediaInfoMap): CurriculumPageContent {
  assertCounts({ chapters: c.chapters, years: c.years, directions: c.directions, gallery: c.gallery, daily: c.daily, beliefs: c.beliefs }, PAGE_COUNTS.curriculum)
  const hero = pagePhoto(c.hero_photo, c.hero_photo_alt, media)
  const yearsPhoto = pagePhoto(c.years_photo, c.years_photo_alt, media)
  return {
    heroEyebrow: c.hero_eyebrow,
    heroTitle: c.hero_title,
    heroHighlight: c.hero_highlight ?? '',
    heroLede: c.hero_lede,
    heroNotice: c.hero_notice,
    heroPhoto: hero.photo,
    heroPhotoAlt: hero.photoAlt,
    chapters: c.chapters.map((x) => ({ label: x.label, hint: x.hint })),
    yearsTitle: c.years_title,
    yearsText: c.years_text,
    spiralLabel: c.spiral_label,
    spiralText: c.spiral_text,
    yearsPhoto: yearsPhoto.photo,
    yearsPhotoAlt: yearsPhoto.photoAlt,
    yearsCaption: c.years_caption,
    years: c.years.map((x) => ({ motto: x.motto, text: x.text })),
    directionsTitle: c.directions_title,
    directionsText: c.directions_text,
    directions: c.directions.map((x) => ({ key: x.key, title: x.title, sub: x.sub, text: x.text, ...pagePhoto(x.photo, x.photo_alt, media) })),
    galleryTitle: c.gallery_title,
    galleryText: c.gallery_text,
    gallerySource: c.gallery_source,
    gallery: c.gallery.map((x) => ({ label: x.label, ...pagePhoto(x.photo, x.photo_alt, media) })),
    dailyTitle: c.daily_title,
    dailyText: c.daily_text,
    dailySource: c.daily_source,
    daily: c.daily.map((x) => ({ title: x.title, text: x.text, ...pagePhoto(x.photo, x.photo_alt, media) })),
    beliefTitle: c.belief_title,
    beliefs: [...c.beliefs],
    beliefClose: c.belief_close,
    beliefSource: c.belief_source
  }
}
```

`applyContentOverlay` 裡 `guard('privacy_policy', …)` 區塊之後加：

```ts
  guard('curriculum_page', () => {
    // 整份取代；項目數不符（舊版或壞資料）時 assertCounts 丟錯，guard 退回內建內容。
    if (overlay.curriculum_page) next.curriculumPage = curriculumPage(overlay.curriculum_page, media)
  })
```

- [ ] **Step 7: 跑測試確認通過＋型別**

```bash
cd web; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npx vitest run tests/page-content.spec.ts tests/site-meta-cms.spec.ts tests/news-faq-overlay.spec.ts; npm run typecheck 2>&1 | tail -20
```

Expected：vitest 全過；typecheck 結束碼 0、**沒有 `Duplicated imports` WARN**。若有測試用物件字面值宣告成 `SiteContent` 而缺 `curriculumPage` 報錯，用 `grep -rn ": SiteContent = {\|satisfies SiteContent" web/app web/tests` 找出來補上 `curriculumPage: fixture.curriculumPage`。

- [ ] **Step 8: Commit**

```bash
git add web/app/utils/page-content.ts web/app/types/site-content.ts web/app/utils/media-image.ts web/app/utils/content-overlay.ts web/tests/page-content.spec.ts
git commit -m "feat(web): 特色教學頁內容型別與後台內容疊加（項目數不符退回內建）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: 特色教學頁元件改讀內容（畫面零差異）

**Files:**
- Modify: `web/app/components/CurriculumContent.vue`（整份 `<script setup>` 與 `<template>`）
- Modify: `web/app/pages/curriculum.vue`
- Modify: `web/app/composables/usePageSeo.ts:3-4,34`
- Test: `web/tests/curriculum.spec.ts`（修改）

**Interfaces:**
- Consumes: Task 4 的 `CurriculumPageContent`、`pageMarkedLines`、`pageTitleLines`、`pagePhotoAttrs`、`withPhotoStyle`、`pagePhotoAlt`、`pagePhotoStyle`、`curriculumHeroAttrs`。
- Produces: `<CurriculumContent :page="CurriculumPageContent" />`；元件內常數 `YEARS`、`DIRECTIONS`、`GALLERY`、`DAILY`、`BELIEF_PIGMENTS`、`CHAPTERS`（內建圖代號與內建說明，admin Task 8 的測試會讀這個檔比對代號）。

- [ ] **Step 1: 先改測試（讀 fixture，不再從元件原始碼抓文字）**

`web/tests/curriculum.spec.ts`：
- `describe('特色教學頁的段落（2026-09-28 水彩版）')` 裡 `'搬來的內容都標出處，義華校的內容不冒充全體'` 改成：

```ts
  it('搬來的內容都標出處，義華校的內容不冒充全體', () => {
    expect(site.curriculumPage.dailySource).toBe('照片與介紹取自義華校。')
    expect(site.curriculumPage.beliefSource).toBe('取自義華校教學理念。')
    expect(site.curriculumPage.gallerySource).toContain('常春藤兒童美術館')
  })
```

- `'過期或只屬於義華的說法不搬…'` 改成：

```ts
  it('過期或只屬於義華的說法不搬：二十七年口碑、歐式城堡建築、高雄獨家、大推', () => {
    const copy = JSON.stringify(site.curriculumPage)
    for (const phrase of ['二十七年', '歐式城堡', '獨家', '大推']) {
      expect(template).not.toContain(phrase)
      expect(copy).not.toContain(phrase)
    }
  })
```

- `'使用者要求拿掉預約參觀…'` 的 it 內追加兩行：

```ts
    expect(JSON.stringify(site.curriculumPage)).not.toContain('預約')
    expect(JSON.stringify(site.curriculumPage)).not.toContain('/visit')
```

- `'美術館作品每張都有描述作品本身的替代文字'` 的 regex 改成 `/\{ image: 'cur-gallery-[a-z-]+', alt: '([^']+)'/g`。
- 新增一個 describe：

```ts
describe('特色教學頁的文字來自後台內容（2026-10）', () => {
  it('元件不再寫死段落文字，章節與項目數和內容一致', () => {
    for (const phrase of ['每一種學習', '五件事，', '老師好愛我', '六歲定八十', '重視愛與關懷']) expect(template).not.toContain(phrase)
    expect(site.curriculumPage.chapters).toHaveLength(4)
    expect(site.curriculumPage.directions.map((d) => d.key)).toEqual(['cognitive', 'integrated', 'multicultural', 'quote', 'autonomy', 'activities', 'art'])
    expect(site.curriculumPage.gallery).toHaveLength(8)
    expect(site.curriculumPage.daily).toHaveLength(5)
    expect(site.curriculumPage.beliefs).toHaveLength(5)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd web; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npx vitest run tests/curriculum.spec.ts
```

Expected：`元件不再寫死段落文字` 與美術館替代文字兩項失敗，其他通過。

- [ ] **Step 3: 改寫 `CurriculumContent.vue` 的 `<script setup>`**

保留原檔第 2–9 行的註解，之後整段換成：

```ts
// 2026-10 起文字與照片改讀後台「特色教學頁」（curriculum_page，預設＝fixture 的 curriculumPage，
// 一字不差）。章節數量、英文小字、年段名稱與年齡、顏料、版面位置與內建照片仍寫在這裡，
// 清單照索引和後台的固定項目一一對應。
import { curriculumHeroAttrs } from '~/utils/media-image'
import { pageMarkedLines, pagePhotoAlt, pagePhotoAttrs, pagePhotoStyle, pageTitleLines, withPhotoStyle } from '~/utils/page-content'
import type { CurriculumPageContent } from '~/types/site-content'
import type { Pigment } from '~/utils/watercolor'

const props = defineProps<{ page: CurriculumPageContent }>()

// 班別與年齡同入學資訊頁：當年 9 月 1 日前滿幾歲（utils/admission-classes.ts）。
// 顏料團一歲比一歲大（scale），數字也跟著長。標語與說明在後台。
const YEARS = [
  { age: 2, name: '幼幼班', en: 'BABY class', pigment: 'mint', scale: 0.6 },
  { age: 3, name: '小班', en: 'K1 class', pigment: 'sky', scale: 0.72 },
  { age: 4, name: '中班', en: 'K2 class', pigment: 'sun', scale: 0.86 },
  { age: 5, name: '大班', en: 'K3 class', pigment: 'orange', scale: 1 }
] satisfies { age: number, name: string, en: string, pigment: Pigment, scale: number }[]

// 照片取自機構站的課程照（圓形裁切，這裡裁內接 4:3）；校別不明，不標。品德培養沒有照片，改成印在一片橙色顏料上的引言。
// layout 對應 curriculum.css 的錯落排法；wash 是照片背後那團顏料（格式見 utils/watercolor.ts 的 parseWash）。
// alt 是內建照片的說明；後台換了照片就用後台的說明。
const DIRECTION_SIZES = '(max-width: 760px) 80vw, (max-width: 1100px) 50vw, 520px'
const DIRECTIONS = [
  { key: 'cognitive', image: 'cur-cognitive', alt: '孩子們圍在桌邊一起翻看繪本', wash: 'sun,.58,.62,.6,.6' },
  { key: 'integrated', image: 'cur-integrated', alt: '孩子抱著比自己還大的足球', wash: 'mint,.44,.6,.66,.56', position: '40% 50%' },
  { key: 'multicultural', image: 'cur-multicultural', alt: '外籍老師在戶外和孩子們說話', wash: 'sky,.56,.58,.66,.56', position: '38% 50%' },
  { key: 'quote' },
  { key: 'autonomy', image: 'cur-autonomy', alt: '兩個孩子在桌上操作教具', wash: 'sun,.46,.6,.62,.6' },
  { key: 'activities', image: 'cur-activities', alt: '孩子們在戶外教學時聽解說員說話', wash: 'mint,.56,.6,.66,.56', position: '30% 50%' },
  { key: 'art', image: 'cur-art', alt: '孩子們一起在大塊布上塗顏色', wash: 'orange,.4,.6,.56,.62,.024,40|sky,.95,.2,.2,.3,.03,26', sizes: '(max-width: 760px) 80vw, (max-width: 1100px) 100vw, 800px' }
] satisfies { key: string, image?: string, alt?: string, wash?: string, position?: string, sizes?: string }[]

// 作品照片取自機構站「常春藤兒童美術館」相簿（原圖 4608×3456，依 EXIF 轉正後縮到長邊 1600）。
// 沒放的：字母珠球（字母可能拼出孩子名字）、綠色膠帶畫（有手寫字）。替代文字描述作品本身。
const GALLERY = [
  { image: 'cur-gallery-canvas-yellow', alt: '黃色畫布上，用橘、白、紅色畫的人物和愛心', wash: 'orange,.55,.56,.58,.54' },
  { image: 'cur-gallery-clay-ball', alt: '塗成藍紫色、黏滿黏土小裝飾的球', wash: 'sky,.5,.56,.58,.56' },
  { image: 'cur-gallery-tote', alt: '用紅、藍、綠色點畫的帆布袋', wash: 'mint,.5,.56,.58,.54' },
  { image: 'cur-gallery-plane-pink', alt: '塗成粉紅色的木頭雙翼飛機', wash: 'sun,.5,.6,.58,.56' },
  { image: 'cur-gallery-tee', alt: '染上粉紅與黃色的 T 恤', wash: 'mint,.5,.56,.58,.54' },
  { image: 'cur-gallery-canvas-blue', alt: '藍綠色畫布上，用藍色線條和紅色圈圈畫的人', wash: 'sun,.5,.56,.58,.54' },
  { image: 'cur-gallery-tape', alt: '撕掉膠帶後留下白色線條的粉紅色畫', wash: 'orange,.5,.56,.58,.54' },
  { image: 'cur-gallery-plane-dots', alt: '點滿藍色與彩色小點的木頭雙翼飛機', wash: 'sky,.5,.6,.58,.56' }
] satisfies { image: string, alt: string, wash: string }[]

// 義華校的五件事，一件配一種顏料。
const DAILY = [
  { image: 'cur-daily-calm', alt: '孩子們閉上眼睛，雙手合十靜下心來', pigment: 'sky', wash: 'sky,.56,.56,.64,.62' },
  { image: 'cur-daily-materials', alt: '女孩笑著把貓頭鷹積木一個個疊高', pigment: 'sun', wash: 'sun,.46,.6,.64,.6' },
  { image: 'cur-daily-art', alt: '女孩專心把材料黏到作品上', pigment: 'orange', wash: 'orange,.56,.58,.64,.62' },
  { image: 'cur-daily-reading', alt: '兩個女孩靠在一起看繪本', pigment: 'mint', wash: 'mint,.46,.58,.64,.62' },
  { image: 'cur-daily-motor', alt: '男孩在操場上跳過一排跨欄', pigment: 'leaf', wash: 'leaf,.56,.6,.64,.6' }
] satisfies { image: string, alt: string, pigment: Pigment, wash: string }[]

// 教學理念五項各配一種顏料（文字在後台）。
const BELIEF_PIGMENTS = ['orange', 'sky', 'sun', 'mint', 'leaf'] satisfies Pigment[]

// 章節索引＝一排顏料盤，顏色跟各段主色一致；名稱與小字在後台。
const CHAPTERS = [
  { id: 'years', no: '01', pigment: 'mint', tilt: -8 },
  { id: 'directions', no: '02', pigment: 'sun', tilt: 10 },
  { id: 'gallery', no: '03', pigment: 'orange', tilt: -4 },
  { id: 'daily', no: '04', pigment: 'sky', tilt: 14 }
] satisfies { id: string, no: string, pigment: Pigment, tilt: number }[]

const HERO_ALT = '孩子閉上眼睛，雙手合十靜下心來'
const YEARS_ALT = '老師張開雙手，和孩子們笑成一團'

const heroLines = computed(() => pageMarkedLines(props.page.heroTitle, props.page.heroHighlight))
const chapters = computed(() => CHAPTERS.map((look, i) => ({ ...look, ...props.page.chapters[i]! })))
const years = computed(() => YEARS.map((look, i) => ({ ...look, ...props.page.years[i]! })))
const directions = computed(() => DIRECTIONS.map((look, i) => ({ ...look, ...props.page.directions[i]! })))
const gallery = computed(() => GALLERY.map((look, i) => ({ ...look, ...props.page.gallery[i]! })))
const daily = computed(() => DAILY.map((look, i) => ({ ...look, ...props.page.daily[i]! })))

const root = ref<HTMLElement | null>(null)
useWatercolor(root)
```

- [ ] **Step 4: 改寫 `<template>`（結構、class、屬性順序一律照舊，只換文字來源）**

```vue
<template>
  <main id="main" ref="root" tabindex="-1" class="cur" data-cta-entry="curriculum">
    <div class="cur-grain" aria-hidden="true" />

    <section class="cur-hero" aria-labelledby="curriculum-title">
      <canvas class="cur-wash" aria-hidden="true" />
      <div class="cur-wrap cur-hero-grid">
        <div class="cur-hero-copy" data-wash="sun,.3,.44,.6,.5,.024,42|orange,.04,.96,.12,.1,.03,26">
          <p class="cur-eyebrow">{{ page.heroEyebrow }}</p>
          <h1 id="curriculum-title"><template v-for="(line, i) in heroLines" :key="i"><br v-if="i">{{ line.before }}<span v-if="line.mark" class="cur-swash"><span class="cur-blot cur-swash-paint" data-blot="orange" aria-hidden="true" />{{ line.mark }}</span>{{ line.after }}</template></h1>
          <p class="cur-lede">{{ page.heroLede }}</p>
          <p v-if="page.heroNotice" class="cur-notice">{{ page.heroNotice }}</p>
        </div>
        <figure class="cur-hero-photo cur-frame" data-wash="mint,.6,.58,.6,.54,.03,40|sky,.98,.04,.26,.2,.034,30">
          <img v-bind="withPhotoStyle(curriculumHeroAttrs(page), page.heroPhoto)" :alt="pagePhotoAlt(HERO_ALT, page.heroPhoto, page.heroPhotoAlt)" loading="eager" fetchpriority="high">
        </figure>
      </div>
      <nav class="cur-wrap cur-index" aria-label="本頁章節">
        <a v-for="chapter in chapters" :key="chapter.id" :href="`#${chapter.id}`" :style="{ '--tilt': `${chapter.tilt}deg` }">
          <span class="cur-pan" aria-hidden="true"><span class="cur-blot" :data-blot="chapter.pigment" /><span class="cur-num" lang="en">{{ chapter.no }}</span></span>
          <span class="cur-index-copy"><b>{{ chapter.label }}</b><span>{{ chapter.hint }}</span></span>
        </a>
      </nav>
    </section>

    <!-- 01 四個年段：四團顏料一歲比一歲大 -->
    <section id="years" class="cur-sec cur-years" aria-labelledby="years-title">
      <canvas class="cur-wash" aria-hidden="true" />
      <div class="cur-wrap">
        <div class="cur-years-head" data-reveal>
          <div>
            <p class="cur-kicker"><span class="cur-num" lang="en">01</span><span lang="en">Four years</span></p>
            <h2 id="years-title" class="cur-title"><template v-for="(line, i) in pageTitleLines(page.yearsTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
            <p class="cur-text">{{ page.yearsText }}</p>
            <p class="cur-spiral"><span class="cur-blot" data-blot="sky" aria-hidden="true" /><b>{{ page.spiralLabel }}</b>{{ page.spiralText }}</p>
            <div class="cur-links">
              <NuxtLink class="cur-link" to="/admission#classes">用生日查孩子讀哪一班<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg></NuxtLink>
              <NuxtLink class="cur-link" to="/about#whole-child">課綱六大領域與核心素養<svg class="icon" aria-hidden="true" focusable="false"><use href="#i-arrow-right" /></svg></NuxtLink>
            </div>
          </div>
          <figure class="cur-years-photo">
            <div class="cur-frame" data-wash="sky,.6,.58,.58,.56,.026,36"><img v-bind="withPhotoStyle(pagePhotoAttrs('cur-years', page.yearsPhoto, '(max-width: 900px) 100vw, 45vw'), page.yearsPhoto)" :alt="pagePhotoAlt(YEARS_ALT, page.yearsPhoto, page.yearsPhotoAlt)" loading="lazy"></div>
            <figcaption v-if="page.yearsCaption">{{ page.yearsCaption }}</figcaption>
          </figure>
        </div>
        <ol class="cur-year-list" data-reveal>
          <li v-for="(year, i) in years" :key="year.name" class="cur-year" :style="{ '--i': i, '--s': year.scale }">
            <span class="cur-year-age" aria-hidden="true"><span class="cur-blot" :data-blot="year.pigment" /><b>{{ year.age }}</b><sup>歲</sup></span>
            <p class="cur-year-name"><b>{{ year.name }}</b><span lang="en">{{ year.en }}</span></p>
            <h3>「{{ year.motto }}」</h3>
            <p>{{ year.text }}</p>
            <small>當年 9 月 1 日前滿 {{ year.age }} 歲</small>
          </li>
        </ol>
      </div>
    </section>

    <!-- 02 課程方向：大小錯落，品德培養印在一片顏料上 -->
    <section id="directions" class="cur-sec cur-directions" aria-labelledby="directions-title">
      <canvas class="cur-wash" aria-hidden="true" />
      <div class="cur-wrap">
        <div class="cur-dir-head" data-reveal>
          <p class="cur-kicker"><span class="cur-num" lang="en">02</span><span lang="en">Curriculum</span></p>
          <h2 id="directions-title" class="cur-title"><template v-for="(line, i) in pageTitleLines(page.directionsTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
          <p class="cur-text">{{ page.directionsText }}</p>
        </div>
        <ul class="cur-dir-grid" aria-label="七個課程方向" data-reveal-group data-wash-mobile="mint,.45,.36,.72,.36,.022,34">
          <li v-for="item in directions" :key="item.key" class="cur-dir" :class="`cur-dir--${item.key}`" data-reveal>
            <span v-if="!item.image" class="cur-blot" data-blot="orange" aria-hidden="true" />
            <div v-if="item.image" class="cur-frame" :data-wash="item.wash">
              <img v-bind="pagePhotoAttrs(item.image, item.photo, item.sizes ?? DIRECTION_SIZES)" :alt="pagePhotoAlt(item.alt ?? '', item.photo, item.photoAlt)" :style="pagePhotoStyle(item.position, item.photo)" loading="lazy">
            </div>
            <div class="cur-dir-copy">
              <h3>{{ item.title }}</h3>
              <p class="cur-dir-sub">{{ item.sub }}</p>
              <p>{{ item.text }}</p>
            </div>
          </li>
        </ul>
      </div>
    </section>

    <!-- 03 兒童美術館：作品保留原本比例，沙龍式掛成一面牆 -->
    <section id="gallery" class="cur-sec cur-gallery" aria-labelledby="gallery-title">
      <canvas class="cur-wash" aria-hidden="true" />
      <div class="cur-wrap">
        <div class="cur-split-head" data-reveal>
          <div>
            <p class="cur-kicker"><span class="cur-num" lang="en">03</span><span lang="en">Art gallery</span></p>
            <h2 id="gallery-title" class="cur-title"><template v-for="(line, i) in pageTitleLines(page.galleryTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
          </div>
          <p class="cur-text">{{ page.galleryText }}<small v-if="page.gallerySource" class="cur-source">{{ page.gallerySource }}</small></p>
        </div>
        <ul class="cur-art-wall" aria-label="孩子的作品" data-reveal-group data-wash-mobile="sun,.45,.4,.72,.36,.022,34">
          <li v-for="art in gallery" :key="art.image" class="cur-art" data-reveal>
            <div class="cur-frame" :data-wash="art.wash"><img v-bind="withPhotoStyle(pagePhotoAttrs(art.image, art.photo, '(max-width: 760px) 62vw, (max-width: 1100px) 33vw, 300px'), art.photo)" :alt="pagePhotoAlt(art.alt, art.photo, art.photoAlt)" loading="lazy"></div>
            <span>{{ art.label }}</span>
          </li>
        </ul>
      </div>
    </section>

    <!-- 04 五件事：紙上的五幅畫，各配一種顏料 -->
    <section id="daily" class="cur-sec cur-daily" aria-labelledby="daily-title">
      <canvas class="cur-wash" aria-hidden="true" />
      <div class="cur-wrap">
        <div class="cur-split-head" data-reveal>
          <div>
            <p class="cur-kicker"><span class="cur-num" lang="en">04</span><span lang="en">Five things</span></p>
            <h2 id="daily-title" class="cur-title"><template v-for="(line, i) in pageTitleLines(page.dailyTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
          </div>
          <p class="cur-text">{{ page.dailyText }}<small v-if="page.dailySource" class="cur-source">{{ page.dailySource }}</small></p>
        </div>
        <ol class="cur-daily-list" aria-label="五件事" data-reveal-group data-wash-mobile="sky,.45,.3,.72,.3,.022,34">
          <li v-for="(item, i) in daily" :key="item.image" class="cur-thing" data-reveal>
            <div class="cur-frame" :data-wash="item.wash"><img v-bind="withPhotoStyle(pagePhotoAttrs(item.image, item.photo, '(max-width: 760px) 80vw, (max-width: 1100px) 50vw, 400px'), item.photo)" :alt="pagePhotoAlt(item.alt, item.photo, item.photoAlt)" loading="lazy"></div>
            <p class="cur-thing-no" lang="en"><span class="cur-blot" :data-blot="item.pigment" aria-hidden="true" />{{ String(i + 1).padStart(2, '0') }}</p>
            <h3>{{ item.title }}</h3>
            <p>{{ item.text }}</p>
          </li>
        </ol>
      </div>
    </section>

    <!-- 結尾：教學理念（2026-09-28 取代原本的結尾卡片，使用者要求） -->
    <section id="belief" class="cur-sec cur-belief" aria-labelledby="belief-title">
      <canvas class="cur-wash" aria-hidden="true" />
      <div class="cur-wrap cur-belief-body" data-reveal data-wash="sun,.5,.34,.42,.4,.016,44|mint,.14,.66,.18,.3,.02,34|sky,.86,.24,.16,.26,.02,34">
        <p class="cur-kicker"><span lang="en">Our belief</span></p>
        <h2 id="belief-title" class="cur-belief-title"><template v-for="(line, i) in pageTitleLines(page.beliefTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
        <ul class="cur-belief-list">
          <li v-for="(belief, i) in page.beliefs" :key="i"><span class="cur-blot" :data-blot="BELIEF_PIGMENTS[i]" aria-hidden="true" />{{ belief }}</li>
        </ul>
        <p class="cur-belief-close">{{ page.beliefClose }}<small v-if="page.beliefSource" class="cur-source">{{ page.beliefSource }}</small></p>
      </div>
    </section>
  </main>
</template>
```

`<style scoped src="../assets/css/curriculum.css"></style>` 那行不動。

- [ ] **Step 5: 頁面與 preload 接線**

`web/app/pages/curriculum.vue`：第 2 行註解改成 `// 特色教學（/curriculum）。主體在 components/CurriculumContent.vue；文字與照片來自後台「特色教學頁」（沒發布過就用 fixture 的內建內容）。`；template 的 `<CurriculumContent />` 改成 `<CurriculumContent :page="data.content.curriculumPage" />`。

`web/app/composables/usePageSeo.ts`：第 3 行的 import 拿掉 `CURRICULUM_HERO_IMAGE, CURRICULUM_HERO_SIZES, `；第 4 行改 `import { curriculumHeroAttrs, heroImageAttrs } from '~/utils/media-image'`；第 34 行改成：

```ts
    if (page === 'curriculum') return curriculumHeroAttrs(site.value.curriculumPage)
```

- [ ] **Step 6: 測試＋型別**

```bash
cd web; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npx vitest run tests/curriculum.spec.ts tests/page-content.spec.ts tests/seo.spec.ts; npm run typecheck 2>&1 | tail -20
```

Expected：全過；typecheck 結束碼 0、無 WARN。

- [ ] **Step 7: 改版後畫面比對（閘門）**

dev server 還在跑（Task 1 Step 2；HMR 已載入新程式，保險起見 `curl -s http://127.0.0.1:3141/curriculum >/dev/null` 先熱一次）。

```bash
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; node scripts/page-ssr-snapshot.cjs after /curriculum
diff output/page-cms/before/curriculum.html output/page-cms/after/curriculum.html && echo SSR-SAME
cd backend; uv run --frozen --with pillow python - <<'EOF'
from PIL import Image, ImageChops
for name in ["curriculum-desktop", "curriculum-mobile"]:
    a = Image.open(f"../output/page-cms/before/{name}.png").convert("RGB")
    b = Image.open(f"../output/page-cms/after/{name}.png").convert("RGB")
    print(name, a.size == b.size and ImageChops.difference(a, b).getbbox() is None)
EOF
```

Expected：`SSR-SAME`、兩張 `True`（Task 1 Step 4 證實截圖會浮動的話，打開兩張圖人工比對，差異只能來自動態）。**SSR 有任何差異就是元件改錯了**：看 diff 修到為空才能 commit（常見：屬性順序變了、`v-if` 的元素在預設內容下消失、`<br>` 位置、原本沒有 `:style` 的圖片多出 `style=""`——要用 `withPhotoStyle`，只有課程方向的圖片用 `:style="pagePhotoStyle(…)"`）。

- [ ] **Step 8: Commit**

```bash
git add web/app/components/CurriculumContent.vue web/app/pages/curriculum.vue web/app/composables/usePageSeo.ts web/tests/curriculum.spec.ts
git commit -m "feat(web): 特色教學頁改讀後台內容（預設內容與現在一字不差、SSR 零差異）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: 草稿預覽 `?page=curriculum`

**Files:**
- Modify: `web/app/utils/draft-preview.ts:7,12,25-28`
- Modify: `web/app/composables/useDraftPreview.ts:38-51`
- Modify: `web/app/pages/preview.vue:23-25,104`
- Test: `web/tests/draft-preview.spec.ts`

- [ ] **Step 1: 失敗的測試**

`web/tests/draft-preview.spec.ts` 第 18 行附近（`expect(previewPage({ page: 'visit' })).toBe('visit')` 之後）加：

```ts
    expect(previewPage({ page: 'curriculum' })).toBe('curriculum')
```

- [ ] **Step 2: 確認失敗**

```bash
cd web; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npx vitest run tests/draft-preview.spec.ts
```

Expected：`expected 'home' to be 'curriculum'`。

- [ ] **Step 3: 實作**

`draft-preview.ts`：第 7 行註解加「｜curriculum（特色教學頁）」；`PreviewPage` 改 `'home' | 'admission' | 'visit' | 'privacy' | 'curriculum'`；`previewPage` 的回傳改：

```ts
  return page === 'admission' || page === 'visit' || page === 'privacy' || page === 'curriculum' ? page : 'home'
```

`useDraftPreview.ts`：`SharedKind` 聯集加 `| 'curriculum_page'`，`SHARED_KINDS` 陣列最後加 `'curriculum_page'`。

`preview.vue`：第 23–25 行註解加「?page=curriculum 特色教學頁」；第 104 行 `<AdmissionContent v-if=… />` 之後加：

```vue
        <CurriculumContent v-else-if="page === 'curriculum'" :page="draft.curriculumPage" />
```

- [ ] **Step 4: 通過＋型別**

```bash
cd web; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npx vitest run tests/draft-preview.spec.ts; npm run typecheck 2>&1 | tail -5
```

Expected：全過、typecheck 0。

- [ ] **Step 5: Commit**

```bash
git add web/app/utils/draft-preview.ts web/app/composables/useDraftPreview.ts web/app/pages/preview.vue web/tests/draft-preview.spec.ts
git commit -m "feat(web): 草稿預覽支援特色教學頁

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: 後台共用欄位元件

**Files:**
- Create: `admin/src/components/PageCopyField.vue`
- Create: `admin/src/components/PagePhotoField.vue`
- Modify: `admin/src/composables/contentHints.ts`（`LENGTH_HINTS` 最後加特色教學頁的鍵）
- Test: `admin/src/__tests__/pageCopyFields.test.ts`

**Interfaces:**
- Produces: `<PageCopyField v-model="string" label hint="LengthHintKey" [title] [multiline] [help] />`、`<PagePhotoField v-model:photo="MediaSlotPayload|null|undefined" v-model:alt="string|undefined" label builtin builtin-src [ratio="4:3"] [no-focus] [help] [disabled] />`（說明欄標籤＝`${label}說明`；`no-focus` 給不裁切的作品照，不顯示焦點）；`LENGTH_HINTS` 新鍵：`curEyebrow curHeroTitle curHighlight curLede curNotice curChapterLabel curChapterHint curSectionTitle curSectionText curSpiralLabel curSpiralText curCaption curMotto curYearText curDirTitle curDirSub curDirText curSource curArtLabel curDailyTitle curDailyText curBelief curBeliefTitle curClose`。

- [ ] **Step 1: 失敗的測試**

`admin/src/__tests__/pageCopyFields.test.ts`：

admin 的 vitest 沒有載 Vue 的 template 編譯器（`vitest.config.ts` 沒有 alias），測試裡的包裝元件一律用 render function（`h`），不要用 `template` 字串。

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, ref, type Ref } from 'vue'
import ElementPlus, { ElForm } from 'element-plus'
import PageCopyField from '../components/PageCopyField.vue'
import PagePhotoField from '../components/PagePhotoField.vue'
import MediaSlotField from '../components/MediaSlotField.vue'
import { resetTitleFontCoverage, TITLE_FONT_FILES } from '../composables/useTitleFontCoverage'
import type { MediaAssetOut, MediaSlotPayload } from '../api/types'

const wrappers: VueWrapper[] = []
function mockCharsets(bd: string) {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) =>
    (String(input).endsWith(`/assets/fonts/${TITLE_FONT_FILES.bd}`) ? new Response(bd) : new Response('', { status: 404 })) as never)
}
beforeEach(() => resetTitleFontCoverage())
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  resetTitleFontCoverage()
})

/** 包在 el-form 裡掛載（el-form-item 需要），render function 寫法。 */
function mountInForm(render: () => ReturnType<typeof h>) {
  const wrapper = mount(defineComponent({ setup: () => () => h(ElForm, null, { default: render }) }), {
    global: { plugins: [ElementPlus], stubs: { MediaSlotField: true } },
  })
  wrappers.push(wrapper)
  return wrapper
}

function copyField(value: Ref<string>, props: Record<string, unknown>) {
  return mountInForm(() => h(PageCopyField, { ...props, modelValue: value.value, 'onUpdate:modelValue': (v: string) => { value.value = v } }))
}

function photoField(photo: Ref<MediaSlotPayload | null | undefined>, alt: Ref<string | undefined>, props: Record<string, unknown>) {
  return mountInForm(() => h(PagePhotoField, {
    ...props,
    photo: photo.value,
    'onUpdate:photo': (v: MediaSlotPayload | null | undefined) => { photo.value = v },
    alt: alt.value,
    'onUpdate:alt': (v: string | undefined) => { alt.value = v },
  }))
}

describe('PageCopyField', () => {
  it('標題欄位：可以換行、顯示建議字數與缺字提示', async () => {
    mockCharsets('從動手做開始愛上學習，。')
    const value = ref('從動手做開始，\n愛上學習。')
    const wrapper = copyField(value, { label: '首屏大標', hint: 'curHeroTitle', title: true })
    await flushPromises()
    expect(wrapper.find('textarea').exists()).toBe(true)
    expect(wrapper.text()).toContain('按 Enter 換行')
    expect(wrapper.find('.glyph-hint').exists()).toBe(false)
    await wrapper.find('textarea').setValue('從動手做開始，\n愛上學習𠮷')
    await flushPromises()
    expect(value.value).toBe('從動手做開始，\n愛上學習𠮷')
    expect(wrapper.find('.glyph-hint').text()).toContain('「𠮷」')
  })

  it('一般欄位：按 Enter 不會換行，也不提示缺字', async () => {
    mockCharsets('')
    const value = ref('一句話')
    const wrapper = copyField(value, { label: '首屏介紹', hint: 'curLede', multiline: true })
    await flushPromises()
    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, bubbles: true })
    wrapper.find('textarea').element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(wrapper.find('.glyph-hint').exists()).toBe(false)
  })
})

describe('PagePhotoField', () => {
  const asset = (id: string, alt: string) => ({ id, alt_text: alt }) as MediaAssetOut
  const base = { label: '首屏照片', builtin: '官網內建照片', builtinSrc: '/assets/cur-hero.webp', ratio: '4:3', help: '說明' }

  it('選了照片才出現說明欄，說明帶入素材庫的說明；改回內建時清空', async () => {
    const photo = ref<MediaSlotPayload | null | undefined>(undefined)
    const alt = ref<string | undefined>(undefined)
    const wrapper = photoField(photo, alt, base)
    expect(wrapper.text()).not.toContain('首屏照片說明')
    const slot = wrapper.findComponent(MediaSlotField)
    slot.vm.$emit('update:modelValue', { media_id: 'a', focus_x: null, focus_y: null })
    slot.vm.$emit('picked', asset('a', '孩子在畫畫'), null)
    await flushPromises()
    expect(alt.value).toBe('孩子在畫畫')
    expect(wrapper.text()).toContain('首屏照片說明')
    slot.vm.$emit('update:modelValue', null)
    slot.vm.$emit('cleared')
    await flushPromises()
    expect(alt.value).toBe('')
    expect(wrapper.text()).not.toContain('首屏照片說明')
  })

  it('換成另一張照片時說明換成新照片的，不留舊照片的說明', async () => {
    const photo = ref<MediaSlotPayload | null | undefined>({ media_id: 'a', focus_x: null, focus_y: null })
    const alt = ref<string | undefined>('舊照片的說明')
    const wrapper = photoField(photo, alt, { ...base, label: '照片' })
    wrapper.findComponent(MediaSlotField).vm.$emit('picked', asset('b', ''), 'a')
    await flushPromises()
    expect(alt.value).toBe('')
  })

  it('預設帶比例的焦點預覽；no-focus 時不給焦點', () => {
    const withFocus = photoField(ref(undefined), ref(undefined), base)
    expect(withFocus.findComponent(MediaSlotField).props('focusPreviews')).toEqual([{ label: '官網裁切（4:3）', ratio: '4 / 3' }])
    const noFocus = photoField(ref(undefined), ref(undefined), { ...base, noFocus: true })
    expect(noFocus.findComponent(MediaSlotField).props('focus')).toBe(false)
    expect(noFocus.findComponent(MediaSlotField).props('focusPreviews')).toEqual([])
  })
})
```

- [ ] **Step 2: 確認失敗**

```bash
cd admin; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npx vitest run src/__tests__/pageCopyFields.test.ts
```

Expected：`Failed to resolve import "../components/PageCopyField.vue"`。

- [ ] **Step 3: 建議字數**

`admin/src/composables/contentHints.ts` 的 `LENGTH_HINTS`，`bannerButton` 那行之後加：

```ts
  // 特色教學頁（2026-10 開放後台編輯）：建議值＝現在的字數再留一點；擋存檔的硬上限在後端
  // content/page_schemas.py（DESIGN.md「特色教學頁、關於常春藤頁開放後台編輯」有對照表）。
  curEyebrow: { max: 16, why: '手機上會換成兩行' },
  curHeroTitle: { max: 16, why: '大標在手機上會超過三行' },
  curHighlight: { max: 4, why: '顏料只畫在一小段字上，太長會蓋住整行' },
  curLede: { max: 45, why: '首屏介紹在手機上會變成很多行' },
  curNotice: { max: 30, why: '提醒會換成兩行' },
  curChapterLabel: { max: 6, why: '章節索引的顏料盤旁放不下' },
  curChapterHint: { max: 8, why: '章節索引的小字會換行' },
  curSectionTitle: { max: 18, why: '段落標題在手機上會超過三行' },
  curSectionText: { max: 32, why: '段落說明會換成很多行' },
  curSpiralLabel: { max: 6, why: '粗體標題太長，說明會被擠到下一行' },
  curSpiralText: { max: 30, why: '顏料框裡的說明會超過兩行' },
  curCaption: { max: 16, why: '照片下方文字會換成兩行' },
  curMotto: { max: 6, why: '年段標語會換行' },
  curYearText: { max: 50, why: '四個年段的卡片會高低不齊' },
  curDirTitle: { max: 6, why: '課程方向的標題會換行' },
  curDirSub: { max: 16, why: '副標會換成兩行' },
  curDirText: { max: 24, why: '說明會換成很多行' },
  curSource: { max: 26, why: '出處的小字會換成兩行' },
  curArtLabel: { max: 6, why: '作品名稱會換行' },
  curDailyTitle: { max: 5, why: '五件事的名稱會換行' },
  curDailyText: { max: 90, why: '五件事的卡片會高低不齊' },
  curBelief: { max: 14, why: '教學理念的一項會換成兩行' },
  curBeliefTitle: { max: 22, why: '結尾大標在手機上會超過三行' },
  curClose: { max: 26, why: '結語會換成兩行' },
```

- [ ] **Step 4: `PageCopyField.vue`**

```vue
<script setup lang="ts">
import LengthHint from './LengthHint.vue'
import GlyphHint from './GlyphHint.vue'
import type { LengthHintKey } from '../composables/contentHints'

// 整頁內容（特色教學頁、關於常春藤頁）的一個文字欄位：輸入框、建議字數、標題缺字提示。
// title：官網用標題字型顯示（h1–h3），按 Enter 換行，換行處就是官網斷行的位置（後端存 \n）。
// 其他欄位官網不換行（後端也擋），所以按 Enter 不會換行；multiline 只是輸入框長一點。
// el-form 的 disabled 會一路傳到這裡的輸入框，不另外接。
const model = defineModel<string>({ required: true })
withDefaults(defineProps<{ label: string; hint: LengthHintKey; title?: boolean; multiline?: boolean; help?: string }>(), {
  title: false,
  multiline: false,
  help: '',
})
</script>

<template>
  <el-form-item :label="label">
    <el-input
      v-if="title"
      v-model="model"
      type="textarea"
      :autosize="{ minRows: 2, maxRows: 3 }"
    />
    <el-input
      v-else-if="multiline"
      v-model="model"
      type="textarea"
      :autosize="{ minRows: 2, maxRows: 8 }"
      @keydown.enter.prevent
    />
    <el-input v-else v-model="model" />
    <LengthHint :value="model" :rule="hint" />
    <GlyphHint v-if="title" :value="model" />
    <span v-if="title" class="field-help">按 Enter 換行，官網在同一個地方斷行；最多三行。</span>
    <span v-if="help" class="field-help">{{ help }}</span>
  </el-form-item>
</template>
```

- [ ] **Step 5: `PagePhotoField.vue`**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import MediaSlotField from './MediaSlotField.vue'
import { altAfterPick, BUILTIN_PHOTO } from '../composables/mediaThumbs'
import type { MediaAssetOut, MediaSlotPayload } from '../api/types'

// 整頁內容的一個照片版位：從素材庫換照片（留空＝官網內建照片與內建說明）＋給看不到照片的人的說明。
// 換照片時說明換成新照片在素材庫的說明（altAfterPick），改回內建時清空。
// 後台 UX 第八輪若做了共用選圖元件，只要改這個檔。
// noFocus：作品照保留原本比例、不裁切，不需要焦點。
const photo = defineModel<MediaSlotPayload | null | undefined>('photo', { required: true })
const alt = defineModel<string | undefined>('alt', { required: true })
const props = withDefaults(
  defineProps<{ label: string; builtin: string; builtinSrc: string; ratio?: string; noFocus?: boolean; help?: string; disabled?: boolean }>(),
  { ratio: '4:3', noFocus: false, help: '', disabled: false },
)
const focusPreviews = computed(() =>
  props.noFocus ? [] : [{ label: `官網裁切（${props.ratio}）`, ratio: props.ratio.replace(':', ' / ') }],
)

function onPicked(asset: MediaAssetOut, previousId: string | null) {
  alt.value = altAfterPick(alt.value, previousId ?? BUILTIN_PHOTO, asset)
}
</script>

<template>
  <el-form-item :label="props.label">
    <MediaSlotField
      v-model="photo"
      :builtin="props.builtin"
      :builtin-src="props.builtinSrc"
      :focus="props.noFocus ? false : undefined"
      :focus-previews="focusPreviews"
      :disabled="props.disabled"
      @picked="onPicked"
      @cleared="alt = ''"
    />
    <span v-if="props.help" class="field-help">{{ props.help }}</span>
  </el-form-item>
  <el-form-item v-if="photo" :label="`${props.label}說明`">
    <el-input v-model="alt" type="textarea" :autosize="{ minRows: 1, maxRows: 4 }" maxlength="200" />
    <span class="field-help">給看不到照片的家長，官網不會顯示出來；留空時官網用素材庫裡這張照片的說明。</span>
  </el-form-item>
</template>
```

- [ ] **Step 6: 通過**

```bash
cd admin; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npx vitest run src/__tests__/pageCopyFields.test.ts; npm run typecheck 2>&1 | tail -5
```

Expected：全過、typecheck 0。

- [ ] **Step 7: Commit**

```bash
git add admin/src/components/PageCopyField.vue admin/src/components/PagePhotoField.vue admin/src/composables/contentHints.ts admin/src/__tests__/pageCopyFields.test.ts
git commit -m "feat(admin): 整頁內容共用的文字欄位與照片版位元件

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: 後台「特色教學頁」編輯頁

**Files:**
- Create: `admin/src/composables/curriculumPageDraft.ts`
- Create: `admin/src/views/CurriculumPageView.vue`
- Modify: `admin/src/api/types.ts`（`PrivacyPolicyPayload` 之後）
- Modify: `admin/src/api/labels.ts`（`contentPublicPath`、`contentPreviewPath`、`CONTENT_KIND_LABELS`）
- Modify: `admin/src/api/contentFieldLabels.ts`（`KIND_FIELD_LABELS`、`LIST_UNITS`、`LIST_FIELD_LABELS`）
- Modify: `admin/src/router/index.ts`（`admission-content` 那行之後）、`admin/src/router/nav.ts`（`site` 群組 `admission-content` 之後）、`admin/src/components/AdminSidebar.vue`（圖示）
- Modify: `admin/src/__tests__/bugfixRegressions.test.ts:27-30`
- Test: `admin/src/__tests__/curriculumPage.test.ts`

**Interfaces:**
- Consumes: Task 7 的 `PageCopyField`、`PagePhotoField`、`LENGTH_HINTS` 鍵；Task 5 元件裡的內建照片代號（測試會比對）。
- Produces: `CurriculumPagePayload`（admin 型別）、`PagePhotoPayload`；`curriculumPageDraft(): CurriculumPagePayload`、`highlightMissing(title, highlight): boolean`、`CURRICULUM_YEAR_NAMES`、`CURRICULUM_DIRECTION_KEYS`、`CURRICULUM_BUILTIN_PHOTOS`、`builtinPhotoSrc(code): string`；路由名 `curriculum-page`、路徑 `/content/curriculum-page`。

- [ ] **Step 1: 失敗的測試**

`admin/src/__tests__/curriculumPage.test.ts`：

```ts
/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import CurriculumPageView from '../views/CurriculumPageView.vue'
import { api } from '../api/client'
import type { UserOut } from '../api/types'
import { NAV_GROUPS } from '../router/nav'
import { CONTENT_KIND_LABELS, contentEditorPath, contentPreviewPath, contentPublicPath } from '../api/labels'
import { contentFieldLabelFor, contentPathLabel } from '../api/contentFieldLabels'
import { CURRICULUM_BUILTIN_PHOTOS, curriculumPageDraft, highlightMissing } from '../composables/curriculumPageDraft'
import { resetTitleFontCoverage } from '../composables/useTitleFontCoverage'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const ROOT = resolve(__dirname, '../../..')
const fixture = JSON.parse(readFileSync(resolve(ROOT, 'web/server/data/site-fixture.json'), 'utf8'))
const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)

const wrappers: VueWrapper[] = []
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }) as never)
  resetTitleFontCoverage()
})
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  resetTitleFontCoverage()
  document.body.innerHTML = ''
})

async function mountAs(user: UserOut) {
  const pinia = createPinia()
  useAuthStore(pinia).user = user
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/content/curriculum-page')
  await router.isReady()
  const wrapper = mount(CurriculumPageView, {
    attachTo: document.body,
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

const neverSaved = { id: 'item', kind: 'curriculum_page', campus_key: null, latest_version: 0, current_published_revision_id: null, latest_revision: null }
const superAdmin = () => testUser('super_admin', { id: 'me', email: 'me@example.invalid', campus_keys: ['yihua'] })

describe('特色教學頁（curriculum_page）', () => {
  it('側欄在「全站與素材」、只給 super_admin，標籤與網址對得上', () => {
    const item = NAV_GROUPS.find((g) => g.key === 'site')!.items.find((i) => i.name === 'curriculum-page')!
    expect(item.path).toBe('/content/curriculum-page')
    expect(item.roles).toEqual(['super_admin'])
    expect(item.shared).toBe(true)
    expect(CONTENT_KIND_LABELS.curriculum_page).toBe('特色教學頁')
    expect(contentPublicPath('curriculum_page')).toBe('/curriculum')
    expect(contentPreviewPath('curriculum_page')).toBe('/preview?page=curriculum')
    expect(contentEditorPath('curriculum_page')).toBe('/content/curriculum-page')
  })

  it('內建內容與官網 fixture 一字不差', () => {
    const expected = Object.fromEntries(Object.entries(fixture.curriculumPage).map(([k, v]) => [snake(k), v]))
    expect(curriculumPageDraft()).toEqual(expected)
  })

  it('內建照片的代號在官網 assets 裡，也和官網元件寫的一樣', () => {
    const component = readFileSync(resolve(ROOT, 'web/app/components/CurriculumContent.vue'), 'utf8')
    const { hero, years, directions, gallery, daily } = CURRICULUM_BUILTIN_PHOTOS
    for (const code of [hero, years, ...directions.filter(Boolean), ...gallery, ...daily]) {
      expect(existsSync(resolve(ROOT, `web/public/assets/${code}.webp`))).toBe(true)
      if (code !== hero) expect(component).toContain(`'${code}'`)
    }
  })

  it('顏料標示：留空不算錯；找不到或跨行算錯（同後端）', () => {
    expect(highlightMissing('從動手做開始，\n愛上學習。', '')).toBe(false)
    expect(highlightMissing('從動手做開始，\n愛上學習。', '動手做')).toBe(false)
    expect(highlightMissing('從動手做開始，\n愛上學習。', '開始，\n愛上')).toBe(true)
    expect(highlightMissing('從動手做開始，\n愛上學習。', '畫畫')).toBe(true)
  })

  it('發布確認與錯誤訊息的欄位有中文名', () => {
    expect(contentFieldLabelFor('curriculum_page', 'hero_title')).toBe('首屏大標')
    expect(contentPathLabel('curriculum_page', ['directions', 2, 'title'])).toBe('課程方向第 3 個・標題')
    expect(contentPathLabel('curriculum_page', ['beliefs', 4])).toBe('教學理念第 5 項')
    expect(contentPathLabel('curriculum_page', ['gallery', 0, 'photo_alt'])).toBe('兒童美術館的作品第 1 件・照片說明')
  })

  it('從未存過：表單就是官網內建內容、不算未儲存修改，並說明官網目前顯示的是內建內容', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    expect(wrapper.text()).toContain('官網目前顯示的是內建內容')
    const values = wrapper.findAll('input, textarea').map((el) => (el.element as HTMLInputElement).value)
    expect(values).toContain('常春藤幼兒園 · 特色教學')
    expect(values).toContain('從動手做開始，\n愛上學習。')
    expect(wrapper.text()).not.toContain('有未儲存的修改')
  })

  it('改了字再儲存：送出的內容保留固定項目與順序', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const post = vi.spyOn(api, 'post').mockImplementation(async (_path: string, body: unknown) => ({
      ...neverSaved, latest_version: 1,
      latest_revision: { id: 'rev-1', version: 1, created_at: '2026-10-04T00:00:00Z', payload: (body as { payload: unknown }).payload, review_status: 'draft' },
    }) as never)
    const wrapper = await mountAs(superAdmin())
    const eyebrow = wrapper.findAll('input').find((el) => (el.element as HTMLInputElement).value === '常春藤幼兒園 · 特色教學')!
    await eyebrow.setValue('常春藤 · 特色教學')
    await wrapper.findAll('button').find((b) => b.text() === '儲存草稿')!.trigger('click')
    await flushPromises()
    const call = post.mock.calls.find(([path]) => String(path).includes('/revisions'))!
    const payload = (call[1] as { payload: Record<string, unknown> }).payload
    expect(payload.hero_eyebrow).toBe('常春藤 · 特色教學')
    expect((payload.directions as { key: string }[]).map((d) => d.key)).toEqual(['cognitive', 'integrated', 'multicultural', 'quote', 'autonomy', 'activities', 'art'])
    expect(payload.gallery).toHaveLength(8)
  })

  it('品德培養沒有照片欄；顏料標示找不到時即時提示', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(superAdmin())
    expect(wrapper.text()).toContain('印在顏料上的引言，沒有照片')
    const highlight = wrapper.findAll('input').find((el) => (el.element as HTMLInputElement).value === '動手做')!
    await highlight.setValue('畫畫')
    await flushPromises()
    expect(wrapper.text()).toContain('大標裡找不到「畫畫」')
  })
})
```

`admin/src/__tests__/bugfixRegressions.test.ts` 第 29 行 `'booking-content', 'site-footer', 'site-meta', 'privacy-policy',` 改成 `'booking-content', 'site-footer', 'site-meta', 'privacy-policy', 'curriculum-page',`。

- [ ] **Step 2: 確認失敗**

```bash
cd admin; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npx vitest run src/__tests__/curriculumPage.test.ts src/__tests__/bugfixRegressions.test.ts
```

Expected：`Failed to resolve import "../views/CurriculumPageView.vue"`；bugfixRegressions 的 `curriculum-page 限定 super_admin` 失敗。

- [ ] **Step 3: 型別**

`admin/src/api/types.ts`，`PrivacyPolicyPayload` 介面之後加：

```ts
/** 整頁內容清單項目的照片版位（後端 content/page_schemas.py 的 PagePhotoFields）；留空＝官網內建照片 */
export interface PagePhotoPayload {
  photo?: MediaSlotPayload | null
  photo_alt?: string
}

/** 特色教學頁（後端 content/page_schemas.py 的 CurriculumPagePayload）。標題用 \n 換行；清單項目數固定。 */
export interface CurriculumPagePayload {
  hero_eyebrow: string
  hero_title: string
  hero_highlight: string
  hero_lede: string
  hero_notice: string
  hero_photo?: MediaSlotPayload | null
  hero_photo_alt?: string
  chapters: { label: string; hint: string }[]
  years_title: string
  years_text: string
  spiral_label: string
  spiral_text: string
  years_photo?: MediaSlotPayload | null
  years_photo_alt?: string
  years_caption: string
  years: { motto: string; text: string }[]
  directions_title: string
  directions_text: string
  directions: ({ key: string; title: string; sub: string; text: string } & PagePhotoPayload)[]
  gallery_title: string
  gallery_text: string
  gallery_source: string
  gallery: ({ label: string } & PagePhotoPayload)[]
  daily_title: string
  daily_text: string
  daily_source: string
  daily: ({ title: string; text: string } & PagePhotoPayload)[]
  belief_title: string
  beliefs: string[]
  belief_close: string
  belief_source: string
}
```

- [ ] **Step 4: 內建內容 `admin/src/composables/curriculumPageDraft.ts`**

```ts
// 特色教學頁的內建內容：官網 web/server/data/site-fixture.json 的 curriculumPage，一字不差
// （curriculumPage.test.ts 逐欄比對）。這份內容從未存過任何版本時，編輯頁的表單就是它，
// 官網這時顯示的也是同一份。照片版位不寫＝官網內建照片。
import type { CurriculumPagePayload } from '../api/types'

// 版面固定的項目（同後端 content/page_schemas.py 與官網 CurriculumContent.vue）。
export const CURRICULUM_YEAR_NAMES = ['幼幼班', '小班', '中班', '大班'] as const
export const CURRICULUM_DIRECTION_KEYS = ['cognitive', 'integrated', 'multicultural', 'quote', 'autonomy', 'activities', 'art'] as const

// 官網內建照片的代號（web/public/assets/<代號>.webp，同 CurriculumContent.vue 的常數）；
// 課程方向的 quote（品德培養）沒有照片，留空字串。
export const CURRICULUM_BUILTIN_PHOTOS = {
  hero: 'cur-hero',
  years: 'cur-years',
  directions: ['cur-cognitive', 'cur-integrated', 'cur-multicultural', '', 'cur-autonomy', 'cur-activities', 'cur-art'],
  gallery: [
    'cur-gallery-canvas-yellow', 'cur-gallery-clay-ball', 'cur-gallery-tote', 'cur-gallery-plane-pink',
    'cur-gallery-tee', 'cur-gallery-canvas-blue', 'cur-gallery-tape', 'cur-gallery-plane-dots',
  ],
  daily: ['cur-daily-calm', 'cur-daily-materials', 'cur-daily-art', 'cur-daily-reading', 'cur-daily-motor'],
} as const

/** 內建照片的預覽網址（後台和官網同源，/assets 由官網提供）。 */
export function builtinPhotoSrc(code: string): string {
  return `/assets/${code}.webp`
}

/** 大標裡找不到顏料標示的字（或跨行）時回 true；留空不算（同後端 page_schemas.py）。 */
export function highlightMissing(title: string, highlight: string): boolean {
  return Boolean(highlight) && !title.split('\n').some((line) => line.includes(highlight))
}

export function curriculumPageDraft(): CurriculumPagePayload {
  return {
    hero_eyebrow: '常春藤幼兒園 · 特色教學',
    hero_title: '從動手做開始，\n愛上學習。',
    hero_highlight: '動手做',
    hero_lede: '幼幼班到大班的四個年段、七個課程方向、孩子的作品，還有每天常做的五件事。',
    hero_notice: '照片取自各校日常，實際課程安排以各校說明為準。',
    chapters: [
      { label: '四個年段', hint: '幼幼班到大班' },
      { label: '課程方向', hint: '7 個方向' },
      { label: '兒童美術館', hint: '孩子的作品' },
      { label: '五件事', hint: '靜心到大肌肉' },
    ],
    years_title: '從幼幼班到大班，\n一年一個樣子。',
    years_text: '給孩子樂於學習、創造思考、勇敢表現、帶著走的核心素養。',
    spiral_label: '螺旋式課程',
    spiral_text: '以螺旋式的方法加深、加廣課程，延伸孩子各項能力。',
    years_caption: '老師和孩子們一起笑成一團。',
    years: [
      { motto: '老師好愛我', text: '全方位的保育環境，給孩子安全感及信賴感，這是寶貝第一個團體生活喔。' },
      { motto: '我會自己做', text: '會自己吃飯、會自己整理，會跟好朋友玩，也會跟老師分享，更會自己主動唸好好玩的故事書喔。' },
      { motto: '我喜歡學習', text: '打造扎實的學習基礎，語文、認知、邏輯、創造能力都好厲害喔。' },
      { motto: '要上小學囉', text: '打好基礎做準備，我長大了，好期待上小學喔！' },
    ],
    directions_title: '每一種學習，\n都從好奇開始。',
    directions_text: '從每天的繪本共讀，到音樂、美語、戶外教學與藝術創作。',
    directions: [
      { key: 'cognitive', title: '認知課程', sub: '每日一繪本親子共讀', text: '打好學齡前語文基礎，幼小銜接不擔心。' },
      { key: 'integrated', title: '統整課程', sub: '奧福音樂、感覺統合、主題學習', text: '完整豐富的統整課程。' },
      { key: 'multicultural', title: '多元文化課程', sub: '沉浸式美語活動', text: '孩子勇敢、自信、快樂表現。' },
      { key: 'quote', title: '品德培養', sub: '六歲定八十', text: '好習慣一生受用無窮。' },
      { key: 'autonomy', title: '自主學習', sub: '動手做、做中學', text: '讓孩子主動學習教具操作。' },
      { key: 'activities', title: '課程活動', sub: '主題戶外教學', text: '節慶活動及好玩的親子活動。' },
      { key: 'art', title: '藝術共創', sub: '每個孩子都是與生俱來的藝術家', text: '給孩子創造思考、解決問題的能力。' },
    ],
    gallery_title: '每一件作品，\n都從動手做開始。',
    gallery_text: '帆布袋、畫布、黏土到木頭飛機，這裡是孩子們的作品。',
    gallery_source: '作品照片取自機構網站「常春藤兒童美術館」。',
    gallery: [
      { label: '畫布上的人' }, { label: '黏土球' }, { label: '帆布袋' }, { label: '木頭飛機' },
      { label: '染色 T 恤' }, { label: '畫布上的人' }, { label: '膠帶留白畫' }, { label: '木頭飛機' },
    ],
    daily_title: '五件事，\n陪孩子慢慢練習。',
    daily_text: '安靜下來、動手操作、創作、閱讀，再到戶外盡情跑跳。',
    daily_source: '照片與介紹取自義華校。',
    daily: [
      { title: '靜心', text: '透過靜心活動，引導孩子穩定情緒、學習自我調節，陪伴寶貝在日常中培養尊重、關懷與自我接納，學會愛自己，也溫柔對待他人。' },
      { title: '教具操作', text: '以個別化的自主教具，引導孩子主動探索與學習。堅持動手做、從做中學，老師依孩子的年齡與能力，自行設計合適的教具，讓寶貝在操作中累積知識，一步步建立學習帶來的自信心。' },
      { title: '美術創作', text: '配合孩子的發展，提供主題式的完整學習架構，以孩子為本，引導思考與感受，在學習中培養美學素養，讓寶貝愛上探索美感，逐步發展多元的創作能力。' },
      { title: '閱讀素養', text: '以「親子共讀」拉近親子距離，在溫馨的閱讀時光中，培養寶貝愛閱讀的好習慣，穩定情緒、提升認知能力，為學齡前的學習素養奠定更好的基礎。' },
      { title: '大肌肉時間', text: '重視寶貝成長中不可或缺的推動力量，透過大量戶外活動與陽光陪伴，讓寶貝盡情與同儕互動、開心放電，在歡笑中學習，在自然中健康成長。' },
    ],
    belief_title: '我們相信，教育是\n「生命影響生命」的使命。',
    beliefs: ['重視愛與關懷', '注重閱讀素養', '培養生活自理能力', '養成終生學習的好習慣', '尊重個別差異，鼓勵自信探索'],
    belief_close: '期許幼兒在成長階段，擁有快樂、健康的環境。',
    belief_source: '取自義華校教學理念。',
  }
}
```

- [ ] **Step 5: 標籤、欄位名、路徑**

`admin/src/api/labels.ts`：
- `contentPublicPath` 的 `if (kind === 'privacy_policy') return '/privacy'` 之後加 `if (kind === 'curriculum_page') return '/curriculum'`。
- `contentPreviewPath` 的 `if (kind === 'privacy_policy') return '/preview?page=privacy'` 之後加 `if (kind === 'curriculum_page') return '/preview?page=curriculum'`。
- `CONTENT_KIND_LABELS` 的 `privacy_policy: '隱私權政策',` 之後加 `curriculum_page: '特色教學頁',`。

`admin/src/api/contentFieldLabels.ts`：
- `KIND_FIELD_LABELS` 的 `admission_content: {…},` 之後加：

```ts
  // 特色教學頁：欄位名＝編輯頁的表單標籤（錯誤定位靠比對標籤）。
  curriculum_page: {
    hero_eyebrow: '首屏小標',
    hero_title: '首屏大標',
    hero_highlight: '大標裡畫顏料的字',
    hero_lede: '首屏介紹',
    hero_notice: '首屏提醒',
    hero_photo: '首屏照片',
    hero_photo_alt: '首屏照片說明',
    chapters: '章節索引',
    years_title: '四個年段的標題',
    years_text: '四個年段的說明',
    spiral_label: '螺旋式課程的標題',
    spiral_text: '螺旋式課程的說明',
    years_photo: '四個年段的照片',
    years_photo_alt: '四個年段的照片說明',
    years_caption: '照片下方文字',
    years: '四個年段',
    directions_title: '課程方向的標題',
    directions_text: '課程方向的說明',
    directions: '課程方向',
    gallery_title: '兒童美術館的標題',
    gallery_text: '兒童美術館的說明',
    gallery_source: '作品照片出處',
    gallery: '兒童美術館的作品',
    daily_title: '五件事的標題',
    daily_text: '五件事的說明',
    daily_source: '五件事的出處',
    daily: '五件事',
    belief_title: '教學理念的標題',
    beliefs: '教學理念',
    belief_close: '教學理念的結語',
    belief_source: '教學理念的出處',
  },
```

- `LIST_UNITS` 加：`chapters: '個', years: '個', directions: '個', gallery: '件', daily: '件', beliefs: '項',`
- `LIST_FIELD_LABELS` 加：

```ts
  chapters: { label: '章節名稱', hint: '小字' },
  years: { motto: '標語', text: '說明' },
  directions: { title: '標題', sub: '副標', text: '說明', photo: '照片', photo_alt: '照片說明' },
  gallery: { label: '作品名稱', photo: '照片', photo_alt: '照片說明' },
  daily: { title: '名稱', text: '介紹', photo: '照片', photo_alt: '照片說明' },
```

- [ ] **Step 6: 側欄與路由**

先確認圖示存在：`grep -c "Brush\b" admin/node_modules/@element-plus/icons-vue/dist/types/index.d.ts admin/node_modules/@element-plus/icons-vue/dist/index.d.ts 2>/dev/null`，至少一個檔有 `Brush`（沒有就改用 `Picture`，下面三處一起改）。

`admin/src/router/nav.ts` 的 `site` 群組，`admission-content` 那行之後加：

```ts
      { name: 'curriculum-page', path: '/content/curriculum-page', title: '特色教學頁', icon: 'Brush', roles: ['super_admin'], shared: true, keywords: ['課程', '教學特色', '美術館', '五件事', '教學理念'] },
```

`admin/src/router/index.ts`：`page('content/admission', 'admission-content', …),` 之後加：

```ts
      page('content/curriculum-page', 'curriculum-page', () => import('../views/CurriculumPageView.vue')),
```

`admin/src/components/AdminSidebar.vue`：`@element-plus/icons-vue` 的 import 清單與 `icons` 物件都加 `Brush`（照字母序放在 `Bottom` 之後）。

- [ ] **Step 7: 編輯頁 `admin/src/views/CurriculumPageView.vue`**

```vue
<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import type { CurriculumPagePayload } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'
import PageCopyField from '../components/PageCopyField.vue'
import PagePhotoField from '../components/PagePhotoField.vue'
import { vReadonlyValues } from '../composables/readonlyValues'
import {
  builtinPhotoSrc,
  CURRICULUM_BUILTIN_PHOTOS,
  CURRICULUM_YEAR_NAMES,
  curriculumPageDraft,
  highlightMissing,
} from '../composables/curriculumPageDraft'

// 特色教學頁（/curriculum）。章節的數量、順序與版面固定，只改字和換照片（2026-10-03 使用者裁定）。
// 表單的空白值就是官網內建內容：從未存過版本時官網顯示的也是這一份，不會一打開就是空白。
const editor = useContentItem<CurriculumPagePayload>('curriculum_page', curriculumPageDraft())
const form = editor.form
const neverSaved = computed(() => !editor.loading.value && !editor.loadError.value && !editor.item.value?.latest_revision)
const highlightProblem = computed(() => highlightMissing(form.value.hero_title, form.value.hero_highlight))
const CHAPTER_NUMBERS = ['01', '02', '03', '04']

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor">
    <template #lead>
      官網 <code>/curriculum</code> 特色教學頁的文字與照片。章節的數量、順序與版面是固定的，這裡只改字、換照片；照片留空就用官網內建的照片。
    </template>

    <el-form v-readonly-values="editor.readOnly.value" label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <el-alert
        v-if="neverSaved"
        type="info"
        :closable="false"
        show-icon
        class="page-copy__alert"
        title="官網目前顯示的是內建內容，就是下面這些字。改了按儲存，才會存成第一個版本。"
      />

      <h3 class="sub-title">首屏</h3>
      <PageCopyField v-model="form.hero_eyebrow" label="首屏小標" hint="curEyebrow" />
      <PageCopyField v-model="form.hero_title" label="首屏大標" hint="curHeroTitle" title />
      <PageCopyField v-model="form.hero_highlight" label="大標裡畫顏料的字" hint="curHighlight" help="要和大標同一行裡的字一模一樣；留空就不畫顏料。" />
      <p v-if="highlightProblem" class="page-copy__warn" role="status">大標裡找不到「{{ form.hero_highlight }}」（或跨了行），這樣存檔會被擋下。</p>
      <PageCopyField v-model="form.hero_lede" label="首屏介紹" hint="curLede" multiline />
      <PageCopyField v-model="form.hero_notice" label="首屏提醒" hint="curNotice" help="清空就不顯示。" />
      <PagePhotoField
        v-model:photo="form.hero_photo"
        v-model:alt="form.hero_photo_alt"
        label="首屏照片"
        builtin="官網內建的孩子靜心照片"
        :builtin-src="builtinPhotoSrc(CURRICULUM_BUILTIN_PHOTOS.hero)"
        ratio="4:3"
        help="桌機放在右欄的撕紙框、手機裁成 4:3；請用寬 2000 以上的橫式照片。"
        :disabled="editor.readOnly.value"
      />

      <h3 class="sub-title">章節索引</h3>
      <div v-for="(chapter, i) in form.chapters" :key="i" class="page-copy__item">
        <p class="page-copy__item-title">{{ CHAPTER_NUMBERS[i] }}</p>
        <PageCopyField v-model="chapter.label" label="章節名稱" hint="curChapterLabel" />
        <PageCopyField v-model="chapter.hint" label="小字" hint="curChapterHint" />
      </div>

      <h3 class="sub-title">01 四個年段</h3>
      <PageCopyField v-model="form.years_title" label="四個年段的標題" hint="curSectionTitle" title />
      <PageCopyField v-model="form.years_text" label="四個年段的說明" hint="curSectionText" multiline />
      <PageCopyField v-model="form.spiral_label" label="螺旋式課程的標題" hint="curSpiralLabel" />
      <PageCopyField v-model="form.spiral_text" label="螺旋式課程的說明" hint="curSpiralText" multiline />
      <PagePhotoField
        v-model:photo="form.years_photo"
        v-model:alt="form.years_photo_alt"
        label="四個年段的照片"
        builtin="官網內建的老師與孩子合照"
        :builtin-src="builtinPhotoSrc(CURRICULUM_BUILTIN_PHOTOS.years)"
        ratio="4:3"
        help="桌機放在標題右邊的撕紙框。"
        :disabled="editor.readOnly.value"
      />
      <PageCopyField v-model="form.years_caption" label="照片下方文字" hint="curCaption" help="清空就不顯示。" />
      <div v-for="(year, i) in form.years" :key="i" class="page-copy__item">
        <p class="page-copy__item-title">{{ CURRICULUM_YEAR_NAMES[i] }}</p>
        <PageCopyField v-model="year.motto" label="標語" hint="curMotto" help="官網會加上「」。" />
        <PageCopyField v-model="year.text" label="說明" hint="curYearText" multiline />
      </div>

      <h3 class="sub-title">02 課程方向</h3>
      <PageCopyField v-model="form.directions_title" label="課程方向的標題" hint="curSectionTitle" title />
      <PageCopyField v-model="form.directions_text" label="課程方向的說明" hint="curSectionText" multiline />
      <div v-for="(direction, i) in form.directions" :key="direction.key" class="page-copy__item">
        <p class="page-copy__item-title">
          第 {{ i + 1 }} 個方向<span v-if="direction.key === 'quote'" class="page-copy__item-note">印在顏料上的引言，沒有照片</span>
        </p>
        <PageCopyField v-model="direction.title" label="標題" hint="curDirTitle" />
        <PageCopyField v-model="direction.sub" label="副標" hint="curDirSub" />
        <PageCopyField v-model="direction.text" label="說明" hint="curDirText" multiline />
        <PagePhotoField
          v-if="direction.key !== 'quote'"
          v-model:photo="direction.photo"
          v-model:alt="direction.photo_alt"
          label="照片"
          builtin="官網內建的課程照"
          :builtin-src="builtinPhotoSrc(CURRICULUM_BUILTIN_PHOTOS.directions[i]!)"
          ratio="4:3"
          help=""
          :disabled="editor.readOnly.value"
        />
      </div>

      <h3 class="sub-title">03 兒童美術館</h3>
      <PageCopyField v-model="form.gallery_title" label="兒童美術館的標題" hint="curSectionTitle" title />
      <PageCopyField v-model="form.gallery_text" label="兒童美術館的說明" hint="curSectionText" multiline />
      <PageCopyField v-model="form.gallery_source" label="作品照片出處" hint="curSource" help="換成自己學校的照片時記得改；清空就不顯示。" />
      <div v-for="(art, i) in form.gallery" :key="i" class="page-copy__item">
        <p class="page-copy__item-title">第 {{ i + 1 }} 件作品</p>
        <PageCopyField v-model="art.label" label="作品名稱" hint="curArtLabel" />
        <PagePhotoField
          v-model:photo="art.photo"
          v-model:alt="art.photo_alt"
          label="照片"
          builtin="官網內建的作品照"
          :builtin-src="builtinPhotoSrc(CURRICULUM_BUILTIN_PHOTOS.gallery[i]!)"
          no-focus
          help="作品照保留原本比例，不裁切；拍到孩子姓名的作品不要放。"
          :disabled="editor.readOnly.value"
        />
      </div>

      <h3 class="sub-title">04 五件事</h3>
      <PageCopyField v-model="form.daily_title" label="五件事的標題" hint="curSectionTitle" title />
      <PageCopyField v-model="form.daily_text" label="五件事的說明" hint="curSectionText" multiline />
      <PageCopyField v-model="form.daily_source" label="五件事的出處" hint="curSource" help="清空就不顯示。" />
      <div v-for="(thing, i) in form.daily" :key="i" class="page-copy__item">
        <p class="page-copy__item-title">第 {{ i + 1 }} 件事</p>
        <PageCopyField v-model="thing.title" label="名稱" hint="curDailyTitle" />
        <PageCopyField v-model="thing.text" label="介紹" hint="curDailyText" multiline />
        <PagePhotoField
          v-model:photo="thing.photo"
          v-model:alt="thing.photo_alt"
          label="照片"
          builtin="官網內建的義華校照片"
          :builtin-src="builtinPhotoSrc(CURRICULUM_BUILTIN_PHOTOS.daily[i]!)"
          ratio="4:3"
          help=""
          :disabled="editor.readOnly.value"
        />
      </div>

      <h3 class="sub-title">結尾：教學理念</h3>
      <PageCopyField v-model="form.belief_title" label="教學理念的標題" hint="curBeliefTitle" title />
      <PageCopyField
        v-for="(belief, i) in form.beliefs"
        :key="i"
        :model-value="belief"
        :label="`教學理念第 ${i + 1} 項`"
        hint="curBelief"
        @update:model-value="(value: string) => (form.beliefs[i] = value)"
      />
      <PageCopyField v-model="form.belief_close" label="教學理念的結語" hint="curClose" />
      <PageCopyField v-model="form.belief_source" label="教學理念的出處" hint="curSource" help="清空就不顯示。" />
    </el-form>
  </ContentEditor>
</template>

<style scoped>
.sub-title {
  margin: 24px 0 12px;
  font-size: 15px;
  font-weight: 600;
}

.page-copy__alert {
  margin-bottom: 16px;
}

.page-copy__warn {
  margin: -8px 0 16px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--el-color-warning-dark-2);
}

.page-copy__item {
  margin-bottom: 12px;
  padding: 12px 16px 4px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.page-copy__item-title {
  margin: 0 0 8px;
  font-weight: 600;
}

.page-copy__item-note {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 400;
  color: var(--el-text-color-secondary);
}
</style>
```

- [ ] **Step 8: 通過＋型別＋既有的導覽測試**

```bash
cd admin; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npx vitest run src/__tests__/curriculumPage.test.ts src/__tests__/bugfixRegressions.test.ts src/__tests__/pageCopyFields.test.ts; npm run typecheck 2>&1 | tail -5
grep -rln "'privacy-policy'" src/__tests__
```

Expected：vitest 全過、typecheck 0。最後一行列出的測試檔若有「側欄完整清單」之類的斷言（不只 bugfixRegressions），逐一跑過，需要時把 `curriculum-page` 加進清單。

- [ ] **Step 9: Commit**

```bash
git add admin/src/composables/curriculumPageDraft.ts admin/src/views/CurriculumPageView.vue admin/src/api/types.ts admin/src/api/labels.ts admin/src/api/contentFieldLabels.ts admin/src/router/index.ts admin/src/router/nav.ts admin/src/components/AdminSidebar.vue admin/src/__tests__/curriculumPage.test.ts admin/src/__tests__/bugfixRegressions.test.ts
git commit -m "feat(admin): 特色教學頁編輯頁（文字與照片，從未存過時帶出官網內建內容）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: 硬上限版面實測（特色教學頁）

**Files:**
- Create: `scripts/page-copy-stress.cjs`
- 可能修改: `backend/app/content/page_schemas.py`、`backend/tests/test_curriculum_page_content.py`（實測後下修上限時）

- [ ] **Step 1: 寫腳本**

```js
// 整頁內容的字數硬上限實測：把每個欄位換成「上限字數」的文字（標題換成上限行數 × 每行上限），
// 檢查 390 與 1440 寬沒有橫向捲動、文字沒有超出所在卡片或被裁掉。改了 page_schemas.py 的上限就重跑。
// 用法（fixture 模式 dev server，計畫 Task 1 Step 2）：node scripts/page-copy-stress.cjs /curriculum
// 截圖存在 output/page-cms/stress/，失敗時結束碼 1。
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const BASE = process.env.PAGE_CMS_BASE ?? 'http://127.0.0.1:3141'
const SAMPLE = [...'常春藤的孩子，在這裡快樂學習、慢慢長大。']
const fill = (n) => Array.from({ length: n }, (_, i) => SAMPLE[i % SAMPLE.length]).join('')

// sel：要換字的元素（全部符合的都換）；chars：一般欄位上限；lines＋perLine：標題；
// textNode：只換元素自己的第一個文字節點（元素裡還有 <b>／<small> 等子元素時用）；box：不能超出的外框
const RULES = {
  '/curriculum': [
    { sel: '.cur-eyebrow', chars: 24 },
    { sel: '#curriculum-title', lines: 3, perLine: 14 },
    { sel: '.cur-lede', chars: 90 },
    { sel: '.cur-notice', chars: 60 },
    { sel: '.cur-index-copy b', chars: 10, box: '.cur-index a' },
    { sel: '.cur-index-copy > span', chars: 14, box: '.cur-index a' },
    { sel: '#years-title, #directions-title, #gallery-title, #daily-title', lines: 3, perLine: 16 },
    { sel: '.cur-years-head .cur-text, .cur-dir-head .cur-text', chars: 80 },
    { sel: '.cur-spiral b', chars: 10 },
    { sel: '.cur-spiral', chars: 60, textNode: true },
    { sel: '.cur-years-photo figcaption', chars: 30 },
    { sel: '.cur-year h3', chars: 12, box: '.cur-year' },
    { sel: '.cur-year > p:not(.cur-year-name)', chars: 100, box: '.cur-year' },
    { sel: '.cur-dir h3', chars: 10, box: '.cur-dir' },
    { sel: '.cur-dir-sub', chars: 30, box: '.cur-dir' },
    { sel: '.cur-dir-copy > p:last-child', chars: 50, box: '.cur-dir' },
    { sel: '.cur-split-head .cur-text', chars: 80, textNode: true },
    { sel: '#gallery .cur-source', chars: 50 },
    { sel: '#daily .cur-source', chars: 30 },
    { sel: '.cur-art > span', chars: 10, box: '.cur-art' },
    { sel: '.cur-thing h3', chars: 8, box: '.cur-thing' },
    { sel: '.cur-thing > p:last-child', chars: 160, box: '.cur-thing' },
    { sel: '#belief-title', lines: 3, perLine: 18 },
    { sel: '.cur-belief-list li', chars: 24, textNode: true },
    { sel: '.cur-belief-close', chars: 50, textNode: true },
    { sel: '.cur-belief-close .cur-source', chars: 30 }
  ]
}

;(async () => {
  const route = process.argv[2]
  const rules = RULES[route]
  if (!rules) {
    console.error(`用法：node scripts/page-copy-stress.cjs ${Object.keys(RULES).join('|')}`)
    process.exit(2)
  }
  const outDir = path.join('output', 'page-cms', 'stress')
  fs.mkdirSync(outDir, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome' })
  let failed = 0
  try {
    for (const [device, viewport] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 900 }]]) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' })
      const page = await context.newPage()
      await page.goto(BASE + route, { waitUntil: 'networkidle' })
      const problems = await page.evaluate(async ({ rules, sample }) => {
        const fillIn = (n) => Array.from({ length: n }, (_, i) => sample[i % sample.length]).join('')
        const touched = []
        for (const rule of rules) {
          const els = [...document.querySelectorAll(rule.sel)]
          if (els.length === 0) touched.push({ rule, missing: true })
          for (const el of els) {
            if (rule.lines) el.innerHTML = Array.from({ length: rule.lines }, () => fillIn(rule.perLine)).join('<br>')
            else if (rule.textNode) {
              const node = [...el.childNodes].find((n) => n.nodeType === Node.TEXT_NODE && n.textContent.trim())
              if (node) node.textContent = fillIn(rule.chars)
            } else el.textContent = fillIn(rule.chars)
            touched.push({ rule, el })
          }
        }
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const out = []
        if (document.documentElement.scrollWidth > window.innerWidth) out.push(`整頁橫向捲動：${document.documentElement.scrollWidth} > ${window.innerWidth}`)
        for (const { rule, el, missing } of touched) {
          if (missing) { out.push(`找不到 ${rule.sel}`); continue }
          const rect = el.getBoundingClientRect()
          if (el.scrollWidth > el.clientWidth + 1) out.push(`${rule.sel} 文字橫向溢出自己的框`)
          const box = rule.box ? el.closest(rule.box) : null
          if (box) {
            const b = box.getBoundingClientRect()
            if (rect.right > b.right + 1 || rect.bottom > b.bottom + 1) out.push(`${rule.sel} 超出 ${rule.box}`)
          }
          for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
            const style = getComputedStyle(a)
            if (/(hidden|clip)/.test(style.overflow + style.overflowX + style.overflowY)) {
              const r = a.getBoundingClientRect()
              if (rect.bottom > r.bottom + 1 || rect.right > r.right + 1) { out.push(`${rule.sel} 被 ${a.className || a.tagName} 裁掉`); break }
            }
          }
        }
        return [...new Set(out)]
      }, { rules, sample: SAMPLE })
      await page.screenshot({ path: path.join(outDir, `${route.slice(1)}-${device}.png`), fullPage: true })
      console.log(`${route} ${device}: ${problems.length ? problems.join('；') : '通過'}`)
      failed += problems.length
      await context.close()
    }
  } finally {
    await browser.close()
  }
  process.exit(failed ? 1 : 0)
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
```

- [ ] **Step 2: 跑實測**

```bash
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; node scripts/page-copy-stress.cjs /curriculum
```

Expected：`/curriculum mobile: 通過`、`/curriculum desktop: 通過`。再用 Read 打開 `output/page-cms/stress/curriculum-mobile.png`、`curriculum-desktop.png` 人工看一遍：文字蓋到照片、顏料盤擠成一團、卡片高低差到看不出錯落，也算不通過。

- [ ] **Step 3: 不通過就下修上限（三處同步）**

例如 `.cur-dir h3` 在 390 寬溢出：把 `page_schemas.py` 的 `CurriculumDirectionPayload._title` 的 `limit=10` 改小、腳本的 `chars` 同步、計畫上方的上限表與 DESIGN.md（Task 10）同步；`test_curriculum_page_content.py` 的 `test_text_rules` 若用到該欄位的上限值一起改。重跑 Step 2 直到通過，並重跑：

```bash
cd backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pagecms_test uv run --frozen pytest -q tests/test_curriculum_page_content.py
```

- [ ] **Step 4: Commit**

```bash
git add scripts/page-copy-stress.cjs
git add backend/app/content/page_schemas.py backend/tests/test_curriculum_page_content.py 2>/dev/null; true
git commit -m "test(web): 特色教學頁字數硬上限的版面實測腳本

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: 階段 A 文件與驗證閘門

**Files:**
- Modify: `README.md`（頂部加日期段落）、`DESIGN.md`（頂部加章節）、`docs/website-admin/acceptance.md`（檔尾加一節）、`deploy/README.md`（上線步驟）

- [ ] **Step 1: 文件**

`DESIGN.md` 最上方（第一個 `## ` 之前）加：

```markdown
## 特色教學頁、關於常春藤頁開放後台編輯（2026-10-xx，階段 A：特色教學頁）

使用者 2026-10-03 裁定「文字與照片都開放」，章節數量與版面結構固定。

- 後台「全站與素材 → 特色教學頁」：所有段落文字、首屏與各項目的照片。清單項目數固定（章節 4、年段 4、課程方向 7、作品 8、五件事 5、教學理念 5），不能新增、刪除、排序；品德培養沒有照片。
- 不開放：英文小字、章節編號、年段名稱與年齡、連結文字、顏料與版面。
- 標題按 Enter 換行（存 `\n`），最多三行；其他欄位不能換行。首屏大標的橘色顏料是獨立欄位「大標裡畫顏料的字」，必須是大標同一行裡的字。
- 字數兩層：後端 `content/page_schemas.py` 硬上限擋存檔（`scripts/page-copy-stress.cjs` 在 390／820／1024／1440 實測通過的值）、後台 `contentHints.ts` 建議值只提醒。硬上限（字；標題為每行字數、最多 3 行）：

  | 欄位 | 上限 | 欄位 | 上限 |
  |---|---|---|---|
  | 首屏小標 | 24 | 段落標題（年段／方向／美術館／五件事） | 每行 16 |
  | 首屏大標 | 每行 14 | 教學理念標題 | 每行 18 |
  | 大標裡畫顏料的字 | 8 | 段落說明 | 80 |
  | 首屏介紹 | 90 | 螺旋式課程標題／說明 | 10／60 |
  | 首屏提醒 | 60 | 照片下方文字 | 30 |
  | 章節名稱／小字 | 10／14 | 年段標語／說明 | 10／100 |
  | 課程方向標題／副標／說明 | 10／30／50 | 作品名稱 | 10 |
  | 品德培養的引言（大字）／說明 | 10／20 | | |
  | 五件事名稱／介紹 | 8／160 | 教學理念一項 | 24 |
  | 作品照片出處／五件事出處／教學理念出處 | 50／30／30 | 教學理念結語 | 50 |

  （Task 9 實測若下修了某一欄，這張表照實測後的值改。）
- 照片留空＝官網內建圖與內建說明（內建說明不開放編輯）；換了照片才有說明欄，留空時官網用素材庫的說明。
- 預設內容＝改版前寫死的文字，一字不差：`web/server/data/site-fixture.json` 與 `content/site-fixture.json` 的 `curriculumPage`（後端測試比對兩份相同）、後台 `curriculumPageDraft.ts`（admin 測試比對 web fixture）。改版前後 SSR `<main>` 經 `scripts/page-ssr-snapshot.cjs` 比對零差異。
```

`README.md` 頂部加日期段落：做了什麼（同上摘要三行）、驗證（實際跑過的指令與數字：pytest 筆數、vitest 檔數／項數、typecheck、contract:check、SSR diff、版面實測、stack e2e 結果）、未驗證（實機 iOS／Android、正式站）。

`docs/website-admin/acceptance.md` 檔尾加 `## 整頁內容進後台：特色教學頁（2026-10-xx）`，列：內容種類 `curriculum_page`、權限（super_admin＋shared 授權）、預設內容零差異的證據、版面實測、草稿預覽 `?page=curriculum`、未做（/about 在階段 B）。

`deploy/README.md` 加上線段落：「不需要 migration、不需要改環境變數。上線後**不必**跑 `initialize-content`：官網沒發布過這份內容時顯示內建內容，後台打開編輯頁會帶出同一份；若要跑，先 `--dry-run`，確認清單只有 `curriculum_page` 再跑（指令由使用者用 `! railway ssh …` 執行）——它會連帶補建其他從未建立的項目。」

- [ ] **Step 2: 收掉 dev server**

```bash
pkill -f "nuxt dev --port 3141"; true
```

- [ ] **Step 3: 全套（主 session 背景跑，一次一組，依序）**

```bash
cd backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pagecms_test PYTHONUNBUFFERED=1 uv run --frozen pytest -q -o faulthandler_timeout=240
```

（`run_in_background`，timeout 90 分以上。）Expected：0 failed（台北週五的 `test_booking_consent_readiness` 場次同步失敗屬既有問題，對照 origin/main 也紅就記在 README）。完成後再依序：

```bash
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix web run typecheck; npm run test:website
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run typecheck; npm --prefix admin run test:unit
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm run contract:check
```

Expected：typecheck 0、vitest 0 failed、`contract:check` 一致（payload 是 dict，契約不該變；變了就是誤改了 schema）。

- [ ] **Step 4: stack e2e（自訂庫與埠，避免撞別的 session）**

```bash
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm run e2e:build
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; E2E_DB_NAME=ivy_website_pagecms_e2e_test E2E_API_PORT=8751 E2E_WEB_PORT=3751 npm run test:e2e:stack
```

Expected：全過（`a11y`、`hydration` 都含 `/curriculum`；stack 起 API 時會跑 `initialize-content`，所以這裡的 `/curriculum` 走的是「後台已發布」路徑）。`media.spec` 失敗先單獨重跑；`visual.spec` 因側欄多一項失敗時，看 diff 圖確認只差側欄後用 `-u` 更新該基準並一起提交。

- [ ] **Step 5: 後台已發布路徑和內建內容一致（選做但建議）**

Playwright 跑完 stack 會把兩個 server 關掉，這一步自己用同一組腳本起（API 會 DROP 重建這個 e2e 庫、跑 `initialize-content`，所以 `/curriculum` 走的是「後台已發布」路徑）。兩個指令都用 `run_in_background`：

```bash
E2E_DB_NAME=ivy_website_pagecms_e2e_test E2E_API_PORT=8751 E2E_ADMIN_EMAIL=pagecms@ivy.example E2E_ADMIN_PASSWORD=pagecms-local-only-2026 E2E_STATE_DIR=output/page-cms/stack-state bash tests/stack/start-api.sh
```

```bash
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; E2E_WEB_PORT=3751 E2E_API_ORIGIN=http://127.0.0.1:8751 bash tests/stack/start-web.sh
```

等 `curl -sf -o /dev/null http://127.0.0.1:3751/curriculum` 成功後：

```bash
curl -s http://127.0.0.1:3751/curriculum | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=s.indexOf('<main'),b=s.indexOf('</main>',a);process.stdout.write(s.slice(a,b+7).replace(/<!--[\s\S]*?-->/g,'').replace(/ data-v-[a-z0-9]+(=\"\")?/g,'').replace(/>\s+</g,'><')+'\n')})" > output/page-cms/stack-curriculum.html
sed -E 's/ data-v-[a-z0-9]+(="")?//g' output/page-cms/after/curriculum.html > output/page-cms/after-curriculum-novhash.html
diff output/page-cms/after-curriculum-novhash.html output/page-cms/stack-curriculum.html && echo CMS-SAME
for port in 3751 8751; do lsof -ti :$port | xargs kill 2>/dev/null; done; true
```

Expected：`CMS-SAME`（production build 的 scoped hash 和 dev 不同，已去掉）。有差異就記在 README 並追原因；`start-api.sh` 的帳密參數若被它的檢查擋下，照腳本開頭的錯誤訊息補齊環境變數。結束後 `lsof -i :8751 -i :3751` 應該沒有輸出（只關自己這兩個埠上的程序）。

- [ ] **Step 6: Commit 文件**

```bash
git add README.md DESIGN.md docs/website-admin/acceptance.md deploy/README.md
git add tests/stack/visual.spec.ts-snapshots 2>/dev/null; true
git commit -m "docs: 特色教學頁開放後台編輯的規則、驗收與上線說明

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

**階段 A 到此可以獨立合併上線**（合併與 push 由使用者決定，見文末）。

---

# 階段 B：關於常春藤頁 `/about`

開工前：階段 A 已合併進 origin/main 的話，照 Task 0 從新的 origin/main 開 worktree（名稱同樣用 `page-cms-<日期>`）；還沒合併就延續階段 A 的 worktree。dev server 依 Task 1 Step 2 重開。

### Task 11: 後端 `about_page` 內容種類

**Files:**
- Modify: `backend/app/content/page_schemas.py`（檔尾）、`backend/app/content/registry.py`
- Test: `backend/tests/test_about_page_content.py`

**Interfaces:**
- Consumes: Task 2 的 `page_title`、`page_text`、`exactly`、`_list_slot_refs` 不需要（about 只有頂層照片）。
- Produces: `ABOUT_MILESTONE_KEYS`、`AboutMilestonePayload`、`AboutPagePayload`；`CONTENT_KIND_REGISTRY["about_page"]`。

- [ ] **Step 0: 改版前基準**

```bash
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; node scripts/page-ssr-snapshot.cjs before-about /about
```

（同一個 worktree 延續、階段 A 的 `output/page-cms/before/about.html` 還在且 origin/main 期間沒動 `/about` 的話可以沿用，但重抓最保險。）

- [ ] **Step 1: 失敗的測試**

`backend/tests/test_about_page_content.py`：

```python
"""關於常春藤頁（about_page）：payload 規則與素材引用。"""
from __future__ import annotations

import copy
import uuid

import pytest
from pydantic import ValidationError

from app.content.page_schemas import ABOUT_MILESTONE_KEYS, AboutPagePayload
from app.content.registry import CONTENT_KIND_REGISTRY

YEARS = (1997, 2001, 2005, 2020, 2021)


def _base(**changes) -> dict:
    payload = {
        "hero_title": "從一間幼兒園，\n長成五所校園。",
        "hero_lede": "1997 年，第一間常春藤在高雄義華路成立。",
        "hero_caption": "把每個孩子，放在心上。",
        "chapter_names": ["一路走來", "全人教育", "我們的期許", "家長怎麼說"],
        "story_title": "近三十年，\n長出五所校園。",
        "story_text": "說明。",
        "milestones": [{"key": key, "year": year, "text": "說明"} for key, year in zip(ABOUT_MILESTONE_KEYS, YEARS)],
        "whole_title": "六大領域，\n陪孩子完整長大。",
        "whole_text": "說明。",
        "whole_fine": "補充。",
        "whole_fine_source": "源自幼兒園教保活動課程大綱",
        "hope_title": "孩子的第一所學校，\n也是第二個家。",
        "hope_quotes": ["第一段。", "第二段。"],
        "outro_title": "五所校園",
        "outro_text": "說明。",
    }
    payload.update(changes)
    return payload


def test_registered_as_shared_only_and_valid_base():
    assert CONTENT_KIND_REGISTRY["about_page"].shared_only is True
    assert AboutPagePayload.model_validate(_base()).hero_photo is None


@pytest.mark.parametrize(
    "changes",
    [
        {"hero_title": "一" * 13},
        {"hope_title": "一\n二\n三\n四"},
        {"chapter_names": ["一路走來", "全人教育", "我們的期許"]},
        {"chapter_names": ["一路走來走來走", "全人教育", "我們的期許", "家長怎麼說"]},
        {"hope_quotes": ["只有一段。"]},
        {"outro_title": "五所校園五所校"},
        {"hero_lede": "第一行\n第二行"},
        {"story_text": "javascript:alert(1)"},
    ],
)
def test_rules(changes):
    with pytest.raises(ValidationError):
        AboutPagePayload.model_validate(_base(**changes))


def test_milestones_fixed_keys_years_in_range_and_in_order():
    data = _base()
    data["milestones"] = list(reversed(data["milestones"]))
    with pytest.raises(ValidationError, match="五站"):
        AboutPagePayload.model_validate(data)
    data = copy.deepcopy(_base())
    data["milestones"][0]["year"] = 1949
    with pytest.raises(ValidationError):
        AboutPagePayload.model_validate(data)
    data = copy.deepcopy(_base())
    data["milestones"][1]["year"] = 1990
    with pytest.raises(ValidationError, match="由早到晚"):
        AboutPagePayload.model_validate(data)
    data = copy.deepcopy(_base())
    data["milestones"][0]["year"] = 1998  # 義華創校年份待園方確認，可以改
    data["milestones"][1]["year"] = 1998  # 同年可以
    assert AboutPagePayload.model_validate(data).milestones[0].year == 1998


def test_media_refs_cover_the_three_photos():
    ids = [str(uuid.uuid4()) for _ in range(3)]
    data = _base(hero_photo={"media_id": ids[0]}, hero_back_photo={"media_id": ids[1]}, hope_photo={"media_id": ids[2]})
    refs = CONTENT_KIND_REGISTRY["about_page"].extract_media_refs(data)
    assert [(str(r.media_id), r.path) for r in refs] == [
        (ids[0], "hero_photo.media_id"),
        (ids[1], "hero_back_photo.media_id"),
        (ids[2], "hope_photo.media_id"),
    ]
```

- [ ] **Step 2: 確認失敗**

```bash
cd backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pagecms_test uv run --frozen pytest -q tests/test_about_page_content.py
```

Expected：`ImportError: cannot import name 'ABOUT_MILESTONE_KEYS'`。

- [ ] **Step 3: `page_schemas.py` 檔尾加**

模組 docstring 第一行改成「整頁內容：特色教學頁（curriculum_page）與關於常春藤頁（about_page）。」

```python
# 沿革五站的順序就是立體書紙條上的五站與右頁卡紙的位置（AboutContent.vue 的 STAGE）。
ABOUT_MILESTONE_KEYS = ("yihua", "minghua", "chongde", "international", "renwu")


class AboutMilestonePayload(_ContentPayload):
    key: str
    # 民國年由官網換算（西元 − 1911）。義華創校年份待園方確認（1997／1998），所以開放改。
    year: int = Field(ge=1950, le=2100)
    text: str

    @field_validator("text")
    @classmethod
    def _text(cls, value: str) -> str:
        return page_text(value, limit=30, what="沿革說明")


# 欄位: (每行字數, 欄位名稱)
_ABOUT_TITLES = {
    "hero_title": (7, "首屏大標"),
    "story_title": (7, "一路走來的標題"),
    "whole_title": (9, "全人教育的標題"),
    "hope_title": (9, "我們的期許的標題"),
}
# 欄位: (上限, 欄位名稱, 可留空)
_ABOUT_TEXTS = {
    "hero_lede": (120, "首屏介紹", False),
    "hero_caption": (20, "首屏照片上的一句話", False),
    "story_text": (120, "一路走來的說明", False),
    "whole_text": (100, "全人教育的說明", False),
    "whole_fine": (100, "全人教育的補充", False),
    "whole_fine_source": (30, "全人教育的出處", True),
    # 也是首屏目次的最後一格，和章名一樣短。
    "outro_title": (6, "五所校園的標題", False),
    "outro_text": (80, "五所校園的說明", False),
}


class AboutPagePayload(_ContentPayload):
    """關於常春藤頁（/about，立體書）。六大領域與核心素養、家長怎麼說的內容、
    卡紙位置與顏色寫在官網 AboutContent.vue；校名與校區照片來自各校的五校介紹。"""

    hero_title: str
    hero_lede: str
    hero_caption: str
    hero_photo: MediaSlotPayload | None = None
    hero_photo_alt: str = Field(default="", max_length=MEDIA_ALT_MAX_LENGTH)
    hero_back_photo: MediaSlotPayload | None = None
    hero_back_photo_alt: str = Field(default="", max_length=MEDIA_ALT_MAX_LENGTH)
    # 一路走來、全人教育、我們的期許、家長怎麼說（第四章沒有家長分享時整章不出現）。
    chapter_names: list[str]
    story_title: str
    story_text: str
    milestones: list[AboutMilestonePayload]
    whole_title: str
    whole_text: str
    whole_fine: str
    whole_fine_source: str
    hope_title: str
    hope_quotes: list[str]
    hope_photo: MediaSlotPayload | None = None
    hope_photo_alt: str = Field(default="", max_length=MEDIA_ALT_MAX_LENGTH)
    outro_title: str
    outro_text: str

    @field_validator(*_ABOUT_TITLES)
    @classmethod
    def _titles(cls, value: str, info: ValidationInfo) -> str:
        per_line, what = _ABOUT_TITLES[info.field_name]
        return page_title(value, per_line=per_line, what=what)

    @field_validator(*_ABOUT_TEXTS)
    @classmethod
    def _texts(cls, value: str, info: ValidationInfo) -> str:
        limit, what, allow_blank = _ABOUT_TEXTS[info.field_name]
        return page_text(value, limit=limit, what=what, allow_blank=allow_blank)

    @field_validator("chapter_names")
    @classmethod
    def _chapter_names(cls, value: list[str]) -> list[str]:
        return [page_text(name, limit=6, what="章名") for name in exactly(value, 4, "章名")]

    @field_validator("milestones")
    @classmethod
    def _milestones(cls, value: list[AboutMilestonePayload]) -> list[AboutMilestonePayload]:
        if tuple(item.key for item in value) != ABOUT_MILESTONE_KEYS:
            raise ValueError("沿革固定五站（義華、明華、崇德、國際、仁武），順序不能改")
        if any(later.year < earlier.year for earlier, later in zip(value, value[1:])):
            raise ValueError("沿革年份要由早到晚（可以同年）")
        return value

    @field_validator("hope_quotes")
    @classmethod
    def _hope_quotes(cls, value: list[str]) -> list[str]:
        return [page_text(quote, limit=70, what="期許") for quote in exactly(value, 2, "期許")]

    @model_validator(mode="after")
    def _no_script_scheme(self) -> "AboutPagePayload":
        _reject_unsafe_strings(self.model_dump())
        return self
```

- [ ] **Step 4: registry**

import 改成 `from app.content.page_schemas import AboutPagePayload, CurriculumPagePayload`；`_extract_curriculum_page_media_refs` 之後加：

```python
def _extract_about_page_media_refs(payload: dict) -> list[MediaRef]:
    return _refs([_slot_ref(payload, name, "image") for name in ("hero_photo", "hero_back_photo", "hope_photo")])
```

`"curriculum_page": …` 那筆之後加：

```python
    # 關於常春藤頁（2026-10 開放後台編輯）：立體書的章節與五站固定。
    "about_page": ContentKindConfig(
        AboutPagePayload, shared_only=True, extract_media_refs=_extract_about_page_media_refs
    ),
```

- [ ] **Step 5: 通過**

```bash
cd backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pagecms_test uv run --frozen pytest -q tests/test_about_page_content.py tests/test_curriculum_page_content.py
```

Expected：全部 passed。

- [ ] **Step 6: Commit**

```bash
git add backend/app/content/page_schemas.py backend/app/content/registry.py backend/tests/test_about_page_content.py
git commit -m "feat(content): 新增關於常春藤頁內容種類（沿革五站固定、年份可改）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 12: 關於頁預設內容進 fixture＋初始化＋API

**Files:**
- Modify: 兩份 `site-fixture.json`（`  "booking": {` 那行前面，`curriculumPage` 區塊之後）
- Modify: `backend/app/content/initialize.py`、`backend/tests/test_content_initialize.py:18,48`（22 → 23）
- Test: `backend/tests/test_about_page_content.py`（追加）

- [ ] **Step 1: 追加失敗的測試**

`test_about_page_content.py` 檔頭 import 補：

```python
import json
from pathlib import Path

from app.content.initialize import _copy_fields, initial_payloads
from tests.conftest import publish_booking_consent

API = "/api/website/v1"
ITEM = f"{API}/admin/content-items/about_page"
FIXTURE = Path(__file__).resolve().parents[2] / "content" / "site-fixture.json"
WEB_FIXTURE = Path(__file__).resolve().parents[2] / "web" / "server" / "data" / "site-fixture.json"


def _fixture_payload() -> dict:
    return _copy_fields(json.loads(FIXTURE.read_text())["aboutPage"], "about_page")
```

檔尾加：

```python
def test_both_fixtures_carry_the_same_about_copy():
    assert json.loads(FIXTURE.read_text())["aboutPage"] == json.loads(WEB_FIXTURE.read_text())["aboutPage"]


def test_fixture_copy_passes_and_keeps_the_history():
    payload = AboutPagePayload.model_validate(_fixture_payload())
    assert [(m.key, m.year) for m in payload.milestones] == list(zip(ABOUT_MILESTONE_KEYS, YEARS))
    copy_text = json.dumps(_fixture_payload(), ensure_ascii=False)
    for phrase in ("三十多", "週年", "美語部", "補習班"):
        assert phrase not in copy_text


def test_initialize_includes_about_page():
    entries = {kind: payload for kind, _campus, payload in initial_payloads(json.loads(FIXTURE.read_text()))}
    assert entries["about_page"]["hero_photo"] is None


@pytest.mark.asyncio
async def test_public_site_has_page_only_after_publish(admin_client, public_client, db_session):
    await publish_booking_consent(db_session)
    item = (await admin_client.get(ITEM)).json()
    saved = await admin_client.post(f"{ITEM}/revisions", json={"expected_version": item["latest_version"], "payload": _fixture_payload()})
    assert saved.status_code == 201, saved.text
    published = await admin_client.post(f"{ITEM}/publish", json={"revision_id": saved.json()["latest_revision"]["id"]})
    assert published.status_code == 200, published.text
    live = (await public_client.get(f"{API}/public/site")).json()["content"]["about_page"]
    assert live == AboutPagePayload.model_validate(_fixture_payload()).model_dump()


@pytest.mark.asyncio
async def test_editor_can_read_but_not_edit(editor_client):
    item = (await editor_client.get(ITEM)).json()
    denied = await editor_client.post(f"{ITEM}/revisions", json={"expected_version": item["latest_version"], "payload": _fixture_payload()})
    assert denied.status_code == 403
```

- [ ] **Step 2: 確認失敗**

```bash
cd backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pagecms_test uv run --frozen pytest -q tests/test_about_page_content.py
```

Expected：`KeyError: 'aboutPage'`。

- [ ] **Step 3: 兩份 fixture 插入（`curriculumPage` 區塊之後、`  "booking": {` 之前；照抄 `AboutContent.vue` 現在的字）**

```json
  "aboutPage": {
    "heroTitle": "從一間幼兒園，\n長成五所校園。",
    "heroLede": "1997 年，第一間常春藤在高雄義華路成立。近三十年來，我們守著同一份教育理念與專業保育，陪孩子過一段獨一無二的童年。",
    "heroCaption": "把每個孩子，放在心上。",
    "chapterNames": ["一路走來", "全人教育", "我們的期許", "家長怎麼說"],
    "storyTitle": "近三十年，\n長出五所校園。",
    "storyText": "我們秉持不變的教育理念，堅持專業的保育，也不斷精進、嘗試新的教學方式，努力為孩子營造安心的環境，讓每個孩子都擁有獨一無二的童年。",
    "milestones": [
      { "key": "yihua", "year": 1997, "text": "第一間常春藤，在三民區義華路成立。" },
      { "key": "minghua", "year": 2001, "text": "走進左營區，有了第二所校園。" },
      { "key": "chongde", "year": 2005, "text": "左營區的第二所校園。" },
      { "key": "international", "year": 2020, "text": "在鳥松區球場路成立。" },
      { "key": "renwu", "year": 2021, "text": "第五所校園，在仁武區成立。" }
    ],
    "wholeTitle": "六大領域，\n陪孩子完整長大。",
    "wholeText": "秉持全人教育的精神，從「幼兒的發展」與「社會文化的期待」出發，以螺旋式的方式加深、加廣課程。",
    "wholeFine": "六大領域彼此關聯、環環相扣，課程在跨領域的統整下同時進行，讓孩子在參與生活與活動的過程中全面發展。",
    "wholeFineSource": "源自幼兒園教保活動課程大綱",
    "hopeTitle": "孩子的第一所學校，\n也是第二個家。",
    "hopeQuotes": [
      "常春藤的孩子，沒有美艷的花朵，沒有引人的清香，卻擁有優美高雅的氣質。",
      "我們期許，常春藤的孩子，未來在名為全世界的舞台，展現自我、發光發熱。"
    ],
    "outroTitle": "五所校園",
    "outroText": "三民、左營、鳥松、仁武，五所校園各有自己的樣子。拉一條書籤，看看那所校園。"
  },

```

核對：`python3 -c "import json;print(json.load(open('web/server/data/site-fixture.json'))['aboutPage']==json.load(open('content/site-fixture.json'))['aboutPage'])"` 印 `True`。

- [ ] **Step 4: initialize**

`curriculum_page` 那筆之後加：

```python
        # 關於常春藤頁（2026-10 開放後台編輯）：照片版位不帶（留空＝官網內建照片）。
        ("about_page", None, _copy_fields(data["aboutPage"], "about_page")),
```

`test_content_initialize.py` 第 18、48 行 `== 22` 改 `== 23`。

- [ ] **Step 5: 通過**

```bash
cd backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pagecms_test uv run --frozen pytest -q tests/test_about_page_content.py tests/test_curriculum_page_content.py tests/test_content_initialize.py tests/test_site_structure_content.py tests/test_media_slots.py
```

Expected：全部 passed。

- [ ] **Step 6: Commit**

```bash
git add web/server/data/site-fixture.json content/site-fixture.json backend/app/content/initialize.py backend/tests/test_content_initialize.py backend/tests/test_about_page_content.py
git commit -m "feat(content): 關於常春藤頁的內建文字進 fixture 與初始化，公開輸出與權限測試

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 13: 官網關於頁型別、overlay、helper

**Files:**
- Modify: `web/app/types/site-content.ts`、`web/app/utils/page-content.ts`（`PAGE_COUNTS` 加 `about`）、`web/app/utils/media-image.ts`、`web/app/utils/content-overlay.ts`
- Test: `web/tests/page-content.spec.ts`（追加）

**Interfaces:**
- Produces: `AboutPageContent`、`SiteContent.aboutPage`；`PAGE_COUNTS.about = { chapterNames: 4, milestones: 5, hopeQuotes: 2 }`；`aboutHeroAttrs(page)`；`LiveAboutPage`、`ContentOverlay.about_page`。

- [ ] **Step 1: 追加失敗的測試**

`web/tests/page-content.spec.ts`：import 補 `type LiveAboutPage`（從 content-overlay）、`aboutHeroAttrs`（從 media-image）、`ABOUT_HERO_IMAGE, ABOUT_HERO_SIZES`（從 responsive-image）。檔尾加：

```ts
describe('關於常春藤頁的後台內容', () => {
  it('發布的內容和內建一字不差時，官網內容完全不變', () => {
    const next = applyContentOverlay(site, { about_page: livePayload<LiveAboutPage>(site.aboutPage) })
    expect(next.aboutPage).toEqual(site.aboutPage)
  })
  it('沿革年份可以改；三張照片都能換', () => {
    const live = livePayload<LiveAboutPage>(site.aboutPage)
    live.milestones[0] = { ...live.milestones[0]!, year: 1998 }
    live.hope_photo = { media_id: MEDIA }
    const next = applyContentOverlay(site, { about_page: live }, media).aboutPage
    expect(next.milestones[0]!.year).toBe(1998)
    expect(next.hopePhoto?.src).toBe(`/api/website/v1/public/media/${MEDIA}/file`)
    expect(next.hopePhotoAlt).toBe('素材庫說明')
    expect(next.heroPhoto).toBeUndefined()
  })
  it('沿革不是五站的舊版內容退回內建', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const live = livePayload<LiveAboutPage>(site.aboutPage)
    live.milestones = live.milestones.slice(0, 4)
    expect(applyContentOverlay(site, { about_page: live }).aboutPage).toEqual(site.aboutPage)
    error.mockRestore()
  })
  it('首屏照片：沒換照片時和現在的 preload 完全相同', () => {
    expect(aboutHeroAttrs(site.aboutPage)).toEqual(responsiveImage(ABOUT_HERO_IMAGE, ABOUT_HERO_SIZES))
  })
})
```

- [ ] **Step 2: 確認失敗**

```bash
cd web; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npx vitest run tests/page-content.spec.ts
```

Expected：新的 describe 失敗（`about_page` 沒有效果／`aboutHeroAttrs` 不存在）。

- [ ] **Step 3: 實作**

`site-content.ts`，`CurriculumPageContent` 之後加：

```ts
/**
 * 關於常春藤頁（/about，立體書）在後台改得到的文字與照片（後端 AboutPagePayload）。
 * 六大領域與核心素養、家長怎麼說、卡紙位置與顏色寫在 AboutContent.vue；沿革五站照索引對應。
 */
export interface AboutPageContent {
  heroTitle: string
  heroLede: string
  heroCaption: string
  heroPhoto?: MediaImage
  heroPhotoAlt?: string
  heroBackPhoto?: MediaImage
  heroBackPhotoAlt?: string
  /** 一路走來、全人教育、我們的期許、家長怎麼說 */
  chapterNames: string[]
  storyTitle: string
  storyText: string
  milestones: { key: string; year: number; text: string }[]
  wholeTitle: string
  wholeText: string
  wholeFine: string
  /** 空字串＝不顯示 */
  wholeFineSource: string
  hopeTitle: string
  hopeQuotes: string[]
  hopePhoto?: MediaImage
  hopePhotoAlt?: string
  /** 也是首屏目次的最後一格 */
  outroTitle: string
  outroText: string
}
```

`SiteContent` 加 `aboutPage: AboutPageContent`。

`page-content.ts` 的 `PAGE_COUNTS` 加一行 `about: { chapterNames: 4, milestones: 5, hopeQuotes: 2 }`。

`media-image.ts`：import 加 `AboutPageContent`、`ABOUT_HERO_IMAGE, ABOUT_HERO_SIZES`；檔尾加：

```ts
/** 關於常春藤頁首屏照片：頁面 <img> 與 usePageSeo 的 preload 共用。 */
export function aboutHeroAttrs(page: Pick<AboutPageContent, 'heroPhoto'>) {
  return pickImage(ABOUT_HERO_IMAGE, page.heroPhoto, ABOUT_HERO_SIZES)
}
```

`content-overlay.ts`：import 加 `AboutPageContent`；`LiveCurriculumPage` 之後加：

```ts
/** 後端 content/page_schemas.py 的 AboutPagePayload */
export interface LiveAboutPage {
  hero_title: string
  hero_lede: string
  hero_caption: string
  hero_photo?: LiveMediaSlot | null
  hero_photo_alt?: string
  hero_back_photo?: LiveMediaSlot | null
  hero_back_photo_alt?: string
  chapter_names: string[]
  story_title: string
  story_text: string
  milestones: { key: string; year: number; text: string }[]
  whole_title: string
  whole_text: string
  whole_fine: string
  whole_fine_source: string
  hope_title: string
  hope_quotes: string[]
  hope_photo?: LiveMediaSlot | null
  hope_photo_alt?: string
  outro_title: string
  outro_text: string
}
```

`ContentOverlay` 加 `about_page?: LiveAboutPage | null`；`curriculumPage` 函式之後加：

```ts
function aboutPage(a: LiveAboutPage, media: MediaInfoMap): AboutPageContent {
  assertCounts({ chapterNames: a.chapter_names, milestones: a.milestones, hopeQuotes: a.hope_quotes }, PAGE_COUNTS.about)
  const hero = pagePhoto(a.hero_photo, a.hero_photo_alt, media)
  const back = pagePhoto(a.hero_back_photo, a.hero_back_photo_alt, media)
  const hope = pagePhoto(a.hope_photo, a.hope_photo_alt, media)
  return {
    heroTitle: a.hero_title,
    heroLede: a.hero_lede,
    heroCaption: a.hero_caption,
    heroPhoto: hero.photo,
    heroPhotoAlt: hero.photoAlt,
    heroBackPhoto: back.photo,
    heroBackPhotoAlt: back.photoAlt,
    chapterNames: [...a.chapter_names],
    storyTitle: a.story_title,
    storyText: a.story_text,
    milestones: a.milestones.map((m) => ({ key: m.key, year: m.year, text: m.text })),
    wholeTitle: a.whole_title,
    wholeText: a.whole_text,
    wholeFine: a.whole_fine,
    wholeFineSource: a.whole_fine_source,
    hopeTitle: a.hope_title,
    hopeQuotes: [...a.hope_quotes],
    hopePhoto: hope.photo,
    hopePhotoAlt: hope.photoAlt,
    outroTitle: a.outro_title,
    outroText: a.outro_text
  }
}
```

`guard('curriculum_page', …)` 之後加：

```ts
  guard('about_page', () => {
    if (overlay.about_page) next.aboutPage = aboutPage(overlay.about_page, media)
  })
```

- [ ] **Step 4: 通過＋型別**

```bash
cd web; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npx vitest run tests/page-content.spec.ts; npm run typecheck 2>&1 | tail -10
```

Expected：全過、typecheck 0、無 WARN（`SiteContent` 字面值缺 `aboutPage` 照 Task 4 Step 7 的方式補）。

- [ ] **Step 5: Commit**

```bash
git add web/app/types/site-content.ts web/app/utils/page-content.ts web/app/utils/media-image.ts web/app/utils/content-overlay.ts web/tests/page-content.spec.ts
git commit -m "feat(web): 關於常春藤頁內容型別與後台內容疊加

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 14: 關於頁元件改讀內容（畫面零差異）

**Files:**
- Modify: `web/app/components/AboutContent.vue`（以下逐段替換，行號以 origin/main `15fd9a5` 為準，動手前先 `grep -n` 確認）
- Modify: `web/app/pages/about.vue`、`web/app/composables/usePageSeo.ts`、`web/app/pages/preview.vue`、`web/app/utils/draft-preview.ts`、`web/app/composables/useDraftPreview.ts`
- Test: `web/tests/about.spec.ts`、`web/tests/draft-preview.spec.ts`

- [ ] **Step 1: 先改測試**

`web/tests/about.spec.ts`：
- import 加 `import { rocYear } from '../app/utils/page-content'`。
- `describe('五校沿革')` 的 `milestones` 改讀 fixture：

```ts
  const milestones = site.aboutPage.milestones.map((m) => ({ key: m.key, year: m.year, roc: rocYear(m.year) }))
```

（底下兩個 it 不動。）
- `'畫面上不寫「三十多年」、週年…'` 的 it 內追加 `expect(JSON.stringify(site.aboutPage)).not.toMatch(/三十多|週年|美語部|補習班/)`。
- 新增：

```ts
describe('關於常春藤頁的文字來自後台內容（2026-10）', () => {
  it('元件不再寫死段落文字與沿革', () => {
    for (const phrase of ['從一間幼兒園', '近三十年，', '孩子的第一所學校', '第一間常春藤，在三民區', '把每個孩子，放在心上']) expect(component).not.toContain(phrase)
    expect(site.aboutPage.chapterNames).toEqual(['一路走來', '全人教育', '我們的期許', '家長怎麼說'])
    expect(site.aboutPage.hopeQuotes).toHaveLength(2)
  })
})
```

`web/tests/draft-preview.spec.ts` 加 `expect(previewPage({ page: 'about' })).toBe('about')`。

- [ ] **Step 2: 確認失敗**

```bash
cd web; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npx vitest run tests/about.spec.ts tests/draft-preview.spec.ts
```

Expected：新 describe 與 previewPage 失敗。

- [ ] **Step 3: `AboutContent.vue` 的 `<script setup>`**

- 第 8 行註解「內容寫在元件裡，不進後台。」改成「2026-10 起文字與照片改讀後台「關於常春藤頁」（about_page，預設＝fixture 的 aboutPage，一字不差）；六大領域、卡紙位置與顏色仍寫在這裡。」
- 第 18–22 行 import 改成：

```ts
import type { AboutPageContent, Campus, CampusTestimonial } from '~/types/site-content'
import { aboutHeroAttrs, pickImage } from '~/utils/media-image'
import { pagePhotoAlt, pagePhotoAttrs, pageTitleLines, rocYear, withPhotoStyle } from '~/utils/page-content'
import { youtubeEmbed } from '~/utils/filmCarousel'
import type { AboutPopup } from '~/utils/about-popup'
```

- 第 24 行 `const props = defineProps<{ campuses: Campus[] }>()` 改成 `const props = defineProps<{ campuses: Campus[]; page: AboutPageContent }>()`。
- 第 26–35 行（`MILESTONES` 常數與 `milestones` computed）換成：

```ts
// 沿革五站來自後台（年份可改，民國年＝西元 − 1911）；分校停用或下架時，那一年仍留在沿革裡，只是不放照片與連結。
const milestones = computed(() => props.page.milestones.map((item) => ({ ...item, roc: rocYear(item.year), campus: props.campuses.find((c) => c.key === item.key) })))

// 內建照片的說明（後台換了照片就用後台的說明）
const HERO_ALT = '孩子們笑著圍在創辦人身邊，大家擠在一起'
const HERO_BACK_ALT = '孩子在教室裡開心地指向自己的發現'
const HOPE_ALT = '孩子們笑著圍在戴眼鏡的長輩身邊，大家開心地擠在一起'
```

- 第 90–98 行 `chapters` computed 換成：

```ts
// 章節：目次、章名、頁碼、章色、頁緣厚度（--n 第幾個跨頁，首屏是 0）都從這裡算；章名在後台
const NUMERALS = ['一', '二', '三', '四']
const CHAPTER_LOOKS = [
  { id: 'story', color: 'var(--yellow)' },
  { id: 'whole-child', color: 'var(--studio-blue)' },
  { id: 'hope', color: 'var(--studio-orange)' },
  { id: 'voices', color: 'var(--trail)' }
]
const chapters = computed(() => CHAPTER_LOOKS
  .map((look, i) => ({ ...look, name: props.page.chapterNames[i]! }))
  .filter((item) => item.id !== 'voices' || voices.value.length > 0)
  .map((item, i) => ({ ...item, label: `第${NUMERALS[i]}章`, page: 3 + i * 2, style: { '--n': i + 1, '--chap': item.color } })))
const chapterOf = (id: string) => chapters.value.find((item) => item.id === id)!
```

- [ ] **Step 4: `<template>` 逐段替換（只換文字來源，結構不動）**

1. 首屏 h1 與 lede（原第 150–151 行）：

```vue
        <h1 id="about-page-title"><template v-for="(line, i) in pageTitleLines(page.heroTitle)" :key="i"><br v-if="i">{{ line }}</template></h1>
        <p class="abk-lede">{{ page.heroLede }}</p>
```

2. 後排卡紙的 img（原第 156 行）：

```vue
            <div class="abk-card"><img v-bind="withPhotoStyle(pagePhotoAttrs('about-curious', page.heroBackPhoto, '(max-width: 900px) 34vw, 200px'), page.heroBackPhoto)" :alt="pagePhotoAlt(HERO_BACK_ALT, page.heroBackPhoto, page.heroBackPhotoAlt)" loading="lazy"></div>
```

3. 首屏大卡紙（原第 161–162 行）：

```vue
              <img v-bind="withPhotoStyle(aboutHeroAttrs(page), page.heroPhoto)" :alt="pagePhotoAlt(HERO_ALT, page.heroPhoto, page.heroPhotoAlt)" loading="eager" fetchpriority="high">
              <figcaption>{{ page.heroCaption }}</figcaption>
```

4. 目次最後一格（原第 172 行）`<span>五所校園</span>` 改 `<span>{{ page.outroTitle }}</span>`。
5. 第一章標題與說明（原第 183–184 行）：

```vue
        <h2 id="story-title" class="abk-title"><template v-for="(line, i) in pageTitleLines(page.storyTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
        <p class="abk-text">{{ page.storyText }}</p>
```

6. 第二章（原第 230–231、244 行）：

```vue
        <h2 id="whole-title" class="abk-title"><template v-for="(line, i) in pageTitleLines(page.wholeTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
        <p class="abk-text">{{ page.wholeText }}</p>
```

```vue
        <p class="abk-fine">{{ page.wholeFine }}<small v-if="page.wholeFineSource">{{ page.wholeFineSource }}</small></p>
```

7. 第三章（原第 265–269 行）：

```vue
        <h2 id="hope-title" class="abk-title"><template v-for="(line, i) in pageTitleLines(page.hopeTitle)" :key="i"><br v-if="i">{{ line }}</template></h2>
        <blockquote class="abk-quote">
          <p v-for="(quote, i) in page.hopeQuotes" :key="i">{{ quote }}</p>
        </blockquote>
```

8. 紙房子窗戶（原第 288 行）：

```vue
                  <span class="abk-window"><img v-bind="withPhotoStyle(pagePhotoAttrs('about-together', page.hopePhoto, '(max-width: 900px) 40vw, 200px'), page.hopePhoto)" :alt="pagePhotoAlt(HOPE_ALT, page.hopePhoto, page.hopePhotoAlt)" loading="lazy"></span>
```

9. 結尾（原第 360–361 行）：

```vue
        <h2 id="about-campuses-title">{{ page.outroTitle }}</h2>
        <p>{{ page.outroText }}</p>
```

- [ ] **Step 5: 頁面、preload、草稿預覽**

`web/app/pages/about.vue`：第 2 行註解改「主體在 components/AboutContent.vue；文字與照片來自後台「關於常春藤頁」（沒發布過就用 fixture 的內建內容）。」；`<AboutContent :campuses="data.content.campuses" />` 改 `<AboutContent :campuses="data.content.campuses" :page="data.content.aboutPage" />`。

`usePageSeo.ts`：第 3 行 import 拿掉 `ABOUT_HERO_IMAGE, ABOUT_HERO_SIZES, `；第 4 行加 `aboutHeroAttrs`；`if (page === 'about') return …` 改 `if (page === 'about') return aboutHeroAttrs(site.value.aboutPage)`。

`draft-preview.ts`：`PreviewPage` 加 `| 'about'`、註解加「｜about（關於常春藤頁）」、`previewPage` 條件加 `|| page === 'about'`。`useDraftPreview.ts`：`SharedKind` 加 `| 'about_page'`、`SHARED_KINDS` 加 `'about_page'`。`preview.vue`：`CurriculumContent` 那行之後加 `<AboutContent v-else-if="page === 'about'" :campuses="draft.campuses" :page="draft.aboutPage" />`。

- [ ] **Step 6: 測試＋型別**

```bash
cd web; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npx vitest run tests/about.spec.ts tests/draft-preview.spec.ts tests/page-content.spec.ts tests/seo.spec.ts; npm run typecheck 2>&1 | tail -10
```

Expected：全過、typecheck 0、無 WARN。

- [ ] **Step 7: 改版後畫面比對（閘門）**

```bash
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; node scripts/page-ssr-snapshot.cjs after-about /about
diff output/page-cms/before-about/about.html output/page-cms/after-about/about.html && echo SSR-SAME
cd backend; uv run --frozen --with pillow python - <<'EOF'
from PIL import Image, ImageChops
for name in ["about-desktop", "about-mobile"]:
    a = Image.open(f"../output/page-cms/before-about/{name}.png").convert("RGB")
    b = Image.open(f"../output/page-cms/after-about/{name}.png").convert("RGB")
    print(name, a.size == b.size and ImageChops.difference(a, b).getbbox() is None)
EOF
```

Expected：`SSR-SAME`、兩張 `True`。另外桌機手機各開一次正常動態（不設 reducedMotion）用 Playwright 捲過整頁，確認立體書翻頁、拉紙條、紙房子、緞帶照常（`about-popup.ts` 靠 DOM 結構，結構沒動就不受影響）。

- [ ] **Step 8: Commit**

```bash
git add web/app/components/AboutContent.vue web/app/pages/about.vue web/app/composables/usePageSeo.ts web/app/pages/preview.vue web/app/utils/draft-preview.ts web/app/composables/useDraftPreview.ts web/tests/about.spec.ts web/tests/draft-preview.spec.ts
git commit -m "feat(web): 關於常春藤頁改讀後台內容（預設內容與現在一字不差、SSR 零差異），草稿預覽支援

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 15: 後台「關於常春藤頁」編輯頁

**Files:**
- Create: `admin/src/composables/aboutPageDraft.ts`、`admin/src/views/AboutPageView.vue`
- Modify: `admin/src/api/types.ts`、`api/labels.ts`、`api/contentFieldLabels.ts`、`composables/contentHints.ts`、`router/index.ts`、`router/nav.ts`、`components/AdminSidebar.vue`、`__tests__/bugfixRegressions.test.ts`
- Test: `admin/src/__tests__/aboutPage.test.ts`

**Interfaces:**
- Consumes: Task 7 的 `PageCopyField`、`PagePhotoField`；Task 8 的 `builtinPhotoSrc`（從 `curriculumPageDraft.ts` import）。
- Produces: `AboutPagePayload`（admin 型別）、`aboutPageDraft()`、`ABOUT_MILESTONE_KEYS`、`ABOUT_BUILTIN_PHOTOS`；路由 `about-page`、`/content/about-page`；`LENGTH_HINTS` 新鍵 `aboutPageTitle aboutPageLede aboutPageCaption aboutChapter aboutPageText aboutMilestone aboutFine aboutSource aboutQuote aboutOutroTitle aboutOutroText`。

- [ ] **Step 1: 失敗的測試**

`admin/src/__tests__/aboutPage.test.ts`（掛載工具與 Task 8 相同，整段照抄進來）：

```ts
/// <reference types="node" />
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus from 'element-plus'
import AboutPageView from '../views/AboutPageView.vue'
import { api } from '../api/client'
import type { UserOut } from '../api/types'
import { NAV_GROUPS } from '../router/nav'
import { CONTENT_KIND_LABELS, contentEditorPath, contentPreviewPath, contentPublicPath } from '../api/labels'
import { contentPathLabel } from '../api/contentFieldLabels'
import { ABOUT_BUILTIN_PHOTOS, aboutPageDraft } from '../composables/aboutPageDraft'
import { resetTitleFontCoverage } from '../composables/useTitleFontCoverage'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const ROOT = resolve(__dirname, '../../..')
const fixture = JSON.parse(readFileSync(resolve(ROOT, 'web/server/data/site-fixture.json'), 'utf8'))
const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)

const wrappers: VueWrapper[] = []
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }) as never)
  resetTitleFontCoverage()
})
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  resetTitleFontCoverage()
  document.body.innerHTML = ''
})

async function mountAs(user: UserOut) {
  const pinia = createPinia()
  useAuthStore(pinia).user = user
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/content/about-page')
  await router.isReady()
  const wrapper = mount(AboutPageView, {
    attachTo: document.body,
    global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } },
  } as never)
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}

const neverSaved = { id: 'item', kind: 'about_page', campus_key: null, latest_version: 0, current_published_revision_id: null, latest_revision: null }

describe('關於常春藤頁（about_page）', () => {
  it('側欄、標籤與網址', () => {
    const item = NAV_GROUPS.find((g) => g.key === 'site')!.items.find((i) => i.name === 'about-page')!
    expect(item.path).toBe('/content/about-page')
    expect(item.roles).toEqual(['super_admin'])
    expect(CONTENT_KIND_LABELS.about_page).toBe('關於常春藤頁')
    expect(contentPublicPath('about_page')).toBe('/about')
    expect(contentPreviewPath('about_page')).toBe('/preview?page=about')
    expect(contentEditorPath('about_page')).toBe('/content/about-page')
  })

  it('內建內容與官網 fixture 一字不差', () => {
    const expected = Object.fromEntries(Object.entries(fixture.aboutPage).map(([k, v]) => [snake(k), v]))
    expect(aboutPageDraft()).toEqual(expected)
  })

  it('內建照片在官網 assets 裡，也和官網元件寫的一樣', () => {
    const component = readFileSync(resolve(ROOT, 'web/app/components/AboutContent.vue'), 'utf8')
    for (const code of Object.values(ABOUT_BUILTIN_PHOTOS)) {
      expect(existsSync(resolve(ROOT, `web/public/assets/${code}.webp`))).toBe(true)
      if (code !== ABOUT_BUILTIN_PHOTOS.hero) expect(component).toContain(`'${code}'`)
    }
  })

  it('錯誤訊息指到沿革第幾站', () => {
    expect(contentPathLabel('about_page', ['milestones', 0, 'year'])).toBe('沿革第 1 站・年份')
    expect(contentPathLabel('about_page', ['hope_quotes', 1])).toBe('期許第 2 段')
  })

  it('從未存過：表單是內建內容；沿革顯示校名與民國年', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(neverSaved as never)
    const wrapper = await mountAs(testUser('super_admin', { id: 'me', email: 'me@example.invalid', campus_keys: ['yihua'] }))
    expect(wrapper.text()).toContain('官網目前顯示的是內建內容')
    expect(wrapper.text()).toContain('義華校')
    expect(wrapper.text()).toContain('民國 86 年')
    const values = wrapper.findAll('input, textarea').map((el) => (el.element as HTMLInputElement).value)
    expect(values).toContain('從一間幼兒園，\n長成五所校園。')
  })
})
```

`bugfixRegressions.test.ts` 的 SHARED 清單再加 `'about-page',`。

- [ ] **Step 2: 確認失敗**

```bash
cd admin; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npx vitest run src/__tests__/aboutPage.test.ts src/__tests__/bugfixRegressions.test.ts
```

Expected：`Failed to resolve import "../views/AboutPageView.vue"`。

- [ ] **Step 3: 型別、內建內容、標籤**

`admin/src/api/types.ts`，`CurriculumPagePayload` 之後加：

```ts
/** 關於常春藤頁（後端 content/page_schemas.py 的 AboutPagePayload）。標題用 \n 換行；章名 4、沿革 5 站、期許 2 段固定。 */
export interface AboutPagePayload {
  hero_title: string
  hero_lede: string
  hero_caption: string
  hero_photo?: MediaSlotPayload | null
  hero_photo_alt?: string
  hero_back_photo?: MediaSlotPayload | null
  hero_back_photo_alt?: string
  chapter_names: string[]
  story_title: string
  story_text: string
  milestones: { key: string; year: number; text: string }[]
  whole_title: string
  whole_text: string
  whole_fine: string
  whole_fine_source: string
  hope_title: string
  hope_quotes: string[]
  hope_photo?: MediaSlotPayload | null
  hope_photo_alt?: string
  outro_title: string
  outro_text: string
}
```

`admin/src/composables/aboutPageDraft.ts`：

```ts
// 關於常春藤頁的內建內容：官網 web/server/data/site-fixture.json 的 aboutPage，一字不差
// （aboutPage.test.ts 逐欄比對）。從未存過任何版本時編輯頁的表單就是它。
import type { AboutPagePayload } from '../api/types'

// 沿革五站（同後端 content/page_schemas.py 的 ABOUT_MILESTONE_KEYS 與官網立體書的五站）。
export const ABOUT_MILESTONE_KEYS = ['yihua', 'minghua', 'chongde', 'international', 'renwu'] as const
export const ABOUT_CHAPTER_HINTS = ['第一章', '第二章', '第三章', '第四章（沒有家長分享影片時整章不出現）'] as const

// 官網內建照片的代號（web/public/assets/<代號>.webp，同 AboutContent.vue）。
export const ABOUT_BUILTIN_PHOTOS = { hero: 'about-hero', heroBack: 'about-curious', hope: 'about-together' } as const

export function aboutPageDraft(): AboutPagePayload {
  return {
    hero_title: '從一間幼兒園，\n長成五所校園。',
    hero_lede: '1997 年，第一間常春藤在高雄義華路成立。近三十年來，我們守著同一份教育理念與專業保育，陪孩子過一段獨一無二的童年。',
    hero_caption: '把每個孩子，放在心上。',
    chapter_names: ['一路走來', '全人教育', '我們的期許', '家長怎麼說'],
    story_title: '近三十年，\n長出五所校園。',
    story_text: '我們秉持不變的教育理念，堅持專業的保育，也不斷精進、嘗試新的教學方式，努力為孩子營造安心的環境，讓每個孩子都擁有獨一無二的童年。',
    milestones: [
      { key: 'yihua', year: 1997, text: '第一間常春藤，在三民區義華路成立。' },
      { key: 'minghua', year: 2001, text: '走進左營區，有了第二所校園。' },
      { key: 'chongde', year: 2005, text: '左營區的第二所校園。' },
      { key: 'international', year: 2020, text: '在鳥松區球場路成立。' },
      { key: 'renwu', year: 2021, text: '第五所校園，在仁武區成立。' },
    ],
    whole_title: '六大領域，\n陪孩子完整長大。',
    whole_text: '秉持全人教育的精神，從「幼兒的發展」與「社會文化的期待」出發，以螺旋式的方式加深、加廣課程。',
    whole_fine: '六大領域彼此關聯、環環相扣，課程在跨領域的統整下同時進行，讓孩子在參與生活與活動的過程中全面發展。',
    whole_fine_source: '源自幼兒園教保活動課程大綱',
    hope_title: '孩子的第一所學校，\n也是第二個家。',
    hope_quotes: [
      '常春藤的孩子，沒有美艷的花朵，沒有引人的清香，卻擁有優美高雅的氣質。',
      '我們期許，常春藤的孩子，未來在名為全世界的舞台，展現自我、發光發熱。',
    ],
    outro_title: '五所校園',
    outro_text: '三民、左營、鳥松、仁武，五所校園各有自己的樣子。拉一條書籤，看看那所校園。',
  }
}
```

`contentHints.ts` 的 `LENGTH_HINTS` 加：

```ts
  // 關於常春藤頁（立體書）：左頁空間有限，建議值抓得比較緊。
  aboutPageTitle: { max: 16, why: '立體書左頁的大標會超過兩行' },
  aboutPageLede: { max: 70, why: '首屏介紹在手機上會變成很多行' },
  aboutPageCaption: { max: 12, why: '卡紙上的一句話會換行' },
  aboutChapter: { max: 5, why: '目次與章節封面放不下' },
  aboutPageText: { max: 70, why: '左頁的說明會擠到頁緣' },
  aboutMilestone: { max: 18, why: '沿革一列會換成兩行' },
  aboutFine: { max: 55, why: '補充說明會擠到頁緣' },
  aboutSource: { max: 16, why: '出處的小字會換成兩行' },
  aboutQuote: { max: 40, why: '引言會換成很多行' },
  aboutOutroTitle: { max: 6, why: '目次最後一格放不下' },
  aboutOutroText: { max: 45, why: '結尾說明會換成很多行' },
```

`labels.ts`：`contentPublicPath` 加 `if (kind === 'about_page') return '/about'`；`contentPreviewPath` 加 `if (kind === 'about_page') return '/preview?page=about'`；`CONTENT_KIND_LABELS` 加 `about_page: '關於常春藤頁',`。

`contentFieldLabels.ts`：`KIND_FIELD_LABELS` 加：

```ts
  about_page: {
    hero_title: '首屏大標',
    hero_lede: '首屏介紹',
    hero_caption: '首屏照片上的一句話',
    hero_photo: '首屏照片',
    hero_photo_alt: '首屏照片說明',
    hero_back_photo: '首屏後排照片',
    hero_back_photo_alt: '首屏後排照片說明',
    chapter_names: '章名',
    story_title: '一路走來的標題',
    story_text: '一路走來的說明',
    milestones: '沿革',
    whole_title: '全人教育的標題',
    whole_text: '全人教育的說明',
    whole_fine: '全人教育的補充',
    whole_fine_source: '全人教育的出處',
    hope_title: '我們的期許的標題',
    hope_quotes: '期許',
    hope_photo: '紙房子窗戶的照片',
    hope_photo_alt: '紙房子窗戶的照片說明',
    outro_title: '五所校園的標題',
    outro_text: '五所校園的說明',
  },
```

`LIST_UNITS` 加 `chapter_names: '個', milestones: '站', hope_quotes: '段',`；`LIST_FIELD_LABELS` 加 `milestones: { year: '年份', text: '說明' },`。

- [ ] **Step 4: 側欄與路由**

確認 `Notebook` 圖示存在（同 Task 8 Step 6 的 grep，換成 `Notebook`；沒有就用 `Reading`）。`nav.ts` 的 `site` 群組 `curriculum-page` 之後加：

```ts
      { name: 'about-page', path: '/content/about-page', title: '關於常春藤頁', icon: 'Notebook', roles: ['super_admin'], shared: true, keywords: ['沿革', '創校', '全人教育', '期許', '立體書'] },
```

`router/index.ts` 的 `curriculum-page` 那行之後加 `page('content/about-page', 'about-page', () => import('../views/AboutPageView.vue')),`。`AdminSidebar.vue` 的 import 與 `icons` 加 `Notebook`。

- [ ] **Step 5: 編輯頁 `admin/src/views/AboutPageView.vue`**

```vue
<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useContentItem } from '../composables/useContentItem'
import type { AboutPagePayload } from '../api/types'
import { campusLabel } from '../api/labels'
import ContentEditor from '../components/ContentEditor.vue'
import PageCopyField from '../components/PageCopyField.vue'
import PagePhotoField from '../components/PagePhotoField.vue'
import { vReadonlyValues } from '../composables/readonlyValues'
import { builtinPhotoSrc } from '../composables/curriculumPageDraft'
import { ABOUT_BUILTIN_PHOTOS, ABOUT_CHAPTER_HINTS, aboutPageDraft } from '../composables/aboutPageDraft'

// 關於常春藤頁（/about，立體書）。章節、沿革五站、期許兩段固定，只改字和換照片（2026-10-03 使用者裁定）。
// 六大領域與核心素養是課綱名詞、家長怎麼說由各校的五校介紹編，都不在這裡。
const editor = useContentItem<AboutPagePayload>('about_page', aboutPageDraft())
const form = editor.form
const neverSaved = computed(() => !editor.loading.value && !editor.loadError.value && !editor.item.value?.latest_revision)

onMounted(editor.load)
</script>

<template>
  <ContentEditor :editor="editor">
    <template #lead>
      官網 <code>/about</code> 關於常春藤頁（立體書）的文字與照片。章節、沿革五站與版面是固定的，這裡只改字、換照片；校名與校區照片跟著「五校介紹」，家長分享影片在各校的五校介紹裡編。
    </template>

    <el-form v-readonly-values="editor.readOnly.value" label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <el-alert
        v-if="neverSaved"
        type="info"
        :closable="false"
        show-icon
        class="page-copy__alert"
        title="官網目前顯示的是內建內容，就是下面這些字。改了按儲存，才會存成第一個版本。"
      />

      <h3 class="sub-title">首屏</h3>
      <PageCopyField v-model="form.hero_title" label="首屏大標" hint="aboutPageTitle" title />
      <PageCopyField v-model="form.hero_lede" label="首屏介紹" hint="aboutPageLede" multiline help="介紹裡寫了創校年份；改下面沿革的年份時記得一起改。" />
      <PageCopyField v-model="form.hero_caption" label="首屏照片上的一句話" hint="aboutPageCaption" />
      <PagePhotoField
        v-model:photo="form.hero_photo"
        v-model:alt="form.hero_photo_alt"
        label="首屏照片"
        builtin="官網內建的創辦人與孩子合照"
        :builtin-src="builtinPhotoSrc(ABOUT_BUILTIN_PHOTOS.hero)"
        ratio="4:3"
        help="右頁前面那張大卡紙，裁成 4:3；請用寬 2000 以上的橫式照片。"
        :disabled="editor.readOnly.value"
      />
      <PagePhotoField
        v-model:photo="form.hero_back_photo"
        v-model:alt="form.hero_back_photo_alt"
        label="首屏後排照片"
        builtin="官網內建的孩子指著發現的照片"
        :builtin-src="builtinPhotoSrc(ABOUT_BUILTIN_PHOTOS.heroBack)"
        ratio="4:3"
        help="右頁後面那張小卡紙。"
        :disabled="editor.readOnly.value"
      />

      <h3 class="sub-title">章名</h3>
      <PageCopyField
        v-for="(name, i) in form.chapter_names"
        :key="i"
        :model-value="name"
        :label="`章名第 ${i + 1} 個`"
        hint="aboutChapter"
        :help="ABOUT_CHAPTER_HINTS[i]"
        @update:model-value="(value: string) => (form.chapter_names[i] = value)"
      />

      <h3 class="sub-title">第一章（一路走來）</h3>
      <PageCopyField v-model="form.story_title" label="一路走來的標題" hint="aboutPageTitle" title />
      <PageCopyField v-model="form.story_text" label="一路走來的說明" hint="aboutPageText" multiline />
      <div v-for="milestone in form.milestones" :key="milestone.key" class="page-copy__item">
        <p class="page-copy__item-title">{{ campusLabel(milestone.key) }}<span class="page-copy__item-note">民國 {{ milestone.year - 1911 }} 年</span></p>
        <el-form-item label="年份">
          <el-input-number v-model="milestone.year" :min="1950" :max="2100" :controls="false" />
          <span class="field-help">西元年；官網的民國年自動換算。年份要由早到晚。</span>
        </el-form-item>
        <PageCopyField v-model="milestone.text" label="說明" hint="aboutMilestone" />
      </div>

      <h3 class="sub-title">第二章（全人教育）</h3>
      <PageCopyField v-model="form.whole_title" label="全人教育的標題" hint="aboutPageTitle" title />
      <PageCopyField v-model="form.whole_text" label="全人教育的說明" hint="aboutPageText" multiline />
      <PageCopyField v-model="form.whole_fine" label="全人教育的補充" hint="aboutFine" multiline />
      <PageCopyField v-model="form.whole_fine_source" label="全人教育的出處" hint="aboutSource" help="清空就不顯示。六大領域與核心素養是課綱名詞，不在這裡改。" />

      <h3 class="sub-title">第三章（我們的期許）</h3>
      <PageCopyField v-model="form.hope_title" label="我們的期許的標題" hint="aboutPageTitle" title />
      <PageCopyField
        v-for="(quote, i) in form.hope_quotes"
        :key="i"
        :model-value="quote"
        :label="`期許第 ${i + 1} 段`"
        hint="aboutQuote"
        multiline
        @update:model-value="(value: string) => (form.hope_quotes[i] = value)"
      />
      <PagePhotoField
        v-model:photo="form.hope_photo"
        v-model:alt="form.hope_photo_alt"
        label="紙房子窗戶的照片"
        builtin="官網內建的長輩與孩子合照"
        :builtin-src="builtinPhotoSrc(ABOUT_BUILTIN_PHOTOS.hope)"
        ratio="4:3"
        help="右頁紙房子的窗戶，照片很小，選人臉清楚的。"
        :disabled="editor.readOnly.value"
      />

      <h3 class="sub-title">結尾（五所校園）</h3>
      <PageCopyField v-model="form.outro_title" label="五所校園的標題" hint="aboutOutroTitle" help="也是首屏目次的最後一格。" />
      <PageCopyField v-model="form.outro_text" label="五所校園的說明" hint="aboutOutroText" multiline />
    </el-form>
  </ContentEditor>
</template>

<style scoped>
.sub-title {
  margin: 24px 0 12px;
  font-size: 15px;
  font-weight: 600;
}

.page-copy__alert {
  margin-bottom: 16px;
}

.page-copy__item {
  margin-bottom: 12px;
  padding: 12px 16px 4px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 8px;
}

.page-copy__item-title {
  margin: 0 0 8px;
  font-weight: 600;
}

.page-copy__item-note {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 400;
  color: var(--el-text-color-secondary);
}
</style>
```

先確認 `campusLabel` 是 `labels.ts` 的匯出（`grep -n "export function campusLabel" admin/src/api/labels.ts`），且 `campusLabel('yihua')` 回「義華校」；不是的話改用該檔實際的校名函式。

- [ ] **Step 6: 通過＋型別**

```bash
cd admin; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npx vitest run src/__tests__/aboutPage.test.ts src/__tests__/curriculumPage.test.ts src/__tests__/bugfixRegressions.test.ts; npm run typecheck 2>&1 | tail -5
```

Expected：全過、typecheck 0。

- [ ] **Step 7: Commit**

```bash
git add admin/src/composables/aboutPageDraft.ts admin/src/views/AboutPageView.vue admin/src/api/types.ts admin/src/api/labels.ts admin/src/api/contentFieldLabels.ts admin/src/composables/contentHints.ts admin/src/router/index.ts admin/src/router/nav.ts admin/src/components/AdminSidebar.vue admin/src/__tests__/aboutPage.test.ts admin/src/__tests__/bugfixRegressions.test.ts
git commit -m "feat(admin): 關於常春藤頁編輯頁（沿革年份可改、民國年自動換算）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 16: 硬上限版面實測（關於頁）

**Files:**
- Modify: `scripts/page-copy-stress.cjs`（`RULES` 加 `/about`）
- 可能修改: `backend/app/content/page_schemas.py`、`backend/tests/test_about_page_content.py`

- [ ] **Step 1: 加規則**

`RULES` 物件加：

```js
  '/about': [
    { sel: '.abk-hero-text h1', lines: 3, perLine: 7 },
    { sel: '.abk-lede', chars: 120 },
    { sel: '.abk-pop.is-hero figcaption', chars: 20, box: '.abk-pop.is-hero' },
    { sel: '.abk-toc li span', chars: 6, box: '.abk-toc li' },
    { sel: '.abk-chap > span', chars: 6 },
    { sel: '.abk-cover b', chars: 6, box: '.abk-cover' },
    { sel: '#story-title', lines: 3, perLine: 7, box: '.abk-page' },
    { sel: '#whole-title', lines: 3, perLine: 9, box: '.abk-page' },
    { sel: '#hope-title', lines: 3, perLine: 9, box: '.abk-page' },
    { sel: '#story .abk-text', chars: 120, box: '.abk-page' },
    { sel: '.abk-list li div > p', chars: 30, box: '.abk-list li' },
    { sel: '#whole-child .abk-text', chars: 100, box: '.abk-page' },
    { sel: '.abk-fine', chars: 100, textNode: true, box: '.abk-page' },
    { sel: '.abk-fine small', chars: 30, box: '.abk-page' },
    { sel: '.abk-quote p', chars: 70, box: '.abk-page' },
    { sel: '#about-campuses-title', chars: 6 },
    { sel: '.abk-outro-copy p', chars: 80 }
  ]
```

- [ ] **Step 2: 實測**

```bash
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; node scripts/page-copy-stress.cjs /about
```

Expected：兩個寬度都 `通過`；再人工看 `output/page-cms/stress/about-mobile.png`、`about-desktop.png`：左頁文字不壓到頁緣與頁碼、目次與封面的章名不換行。不通過照 Task 9 Step 3 下修上限（三處同步）。

- [ ] **Step 3: Commit**

```bash
git add scripts/page-copy-stress.cjs
git add backend/app/content/page_schemas.py backend/tests/test_about_page_content.py 2>/dev/null; true
git commit -m "test(web): 關於常春藤頁字數硬上限的版面實測

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 17: 階段 B 文件與驗證閘門

- [ ] **Step 1: 文件**

- `DESIGN.md` 階段 A 那一節標題改成「（2026-10-xx，特色教學頁；2026-10-yy，關於常春藤頁）」，補關於頁的規則：章名 4、沿革五站（年份可改、民國年自動換算、由早到晚）、期許兩段、三張照片；不開放：六大領域與核心素養、家長怎麼說（各校五校介紹）、卡紙位置與顏色、目次標題；結尾標題同時是目次最後一格；上限表（實測後最終值）。
- `README.md` 頂部日期段落（同階段 A 格式，寫實際數字）。
- `docs/website-admin/acceptance.md` 那一節補「關於常春藤頁」。
- `deploy/README.md` 上線段落補 `about_page`（同樣不需要 migration、不必跑 `initialize-content`）；並註明「上線後若園方確認義華創校年份是 1998，在後台『關於常春藤頁』改沿革年份與首屏介紹」。

- [ ] **Step 2: 全套與 stack（同 Task 10 Step 2–5，路徑換成 `/about`）**

```bash
pkill -f "nuxt dev --port 3141"; true
cd backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pagecms_test PYTHONUNBUFFERED=1 uv run --frozen pytest -q -o faulthandler_timeout=240
```

（背景、完成後依序跑 web typecheck＋`npm run test:website`、admin typecheck＋`test:unit`、`npm run contract:check`、`npm run e2e:build` 與 `E2E_DB_NAME=ivy_website_pagecms_e2e_test E2E_API_PORT=8751 E2E_WEB_PORT=3751 npm run test:e2e:stack`，再做 Task 10 Step 5 的「後台已發布路徑和內建內容一致」比對，路徑換 `/about`、檔名換 `about`。）

Expected：全部 0 failed（已知假失敗依 Global Constraints 判讀並記在 README）；`contract:check` 一致；`CMS-SAME`。

- [ ] **Step 3: Commit**

```bash
git add README.md DESIGN.md docs/website-admin/acceptance.md deploy/README.md
git add tests/stack/visual.spec.ts-snapshots 2>/dev/null; true
git commit -m "docs: 關於常春藤頁開放後台編輯的規則、驗收與上線說明

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## 風險與待使用者決定

1. **固定不開放的文字**（設計決定第 7 點：英文小字、六大領域與核心素養、年段名稱、連結文字）是本計畫的預設，使用者要開放就另外加欄位。
2. **正式站要不要跑 `initialize-content`**：預設不跑（官網與後台都會顯示內建內容）。它會連帶補建其他從未建立的項目（例如 `shared_faq`），要跑先 `--dry-run` 看清單，由使用者用 `! railway ssh …` 執行。
3. **在途的 `/about` 改動**：記憶裡的「關於頁紀念章捲動翻面」（比稿 C，第一章釘住跨頁）實作已遺失；若之後重做，會和本計畫 Task 14 改同一批 `AboutContent.vue` 行，後做的要以先合併的為基底。404 校徽（`feature/404-crest-popup-20261003`）只動 `error.vue` 與新元件，不衝突。
4. **後台 UX 第八輪**同時進行時：兩邊都改 `router/nav.ts`、`contentFieldLabels.ts`、`AdminSidebar.vue`，後合併的一方解衝突；本計畫的兩個編輯頁頁面很長，第八輪的段落導覽合併後要接上。
5. **截圖比對可能因動態浮動**（Task 1 Step 4 會先驗證）：此時以 SSR diff 為準，截圖人工看。
6. 文件小過時：根目錄 `CLAUDE.md`「字型子集」一節仍寫 LINE Seed 只有子集，實際 09-25 起已是完整字型切片（`useTitleFontCoverage.ts:9-11`）；不在本計畫修，提醒使用者另行更新。

## 合併上線

兩個階段各自做完驗證閘門後停下，回報分支名、commit 清單與驗證結果。**合併與上線由使用者決定**（push main＝正式部署，會觸發 `.github/workflows/website.yml`）。推 main 前先 `git fetch` 並 `git merge-base --is-ancestor origin/main HEAD`，不能快轉就先合 origin/main、重跑受影響的測試；`git push origin HEAD:main` 由使用者用 `!` 執行。部署後在 `deploy/README.md` 補紀錄。上線後清掉自己的 worktree（先 `find <wt> -maxdepth 3 -type l -delete`，再 `git worktree remove --force`）。
