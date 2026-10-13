# 後台與官網內容一批補強（2026-10-12）設計

日期：2026-10-12
狀態：使用者 10-12 核可；10-13 四階段實作完成、全套驗證通過，待上線（計畫 `docs/superpowers/plans/2026-10-12-admin-batch.md`）
基準：`origin/main` `371b0e99`
分支：`feature/admin-batch-20261012`（worktree `~/Repositories/ivy-website-wt/admin-batch-20261012`）

## 1. 背景與目標

10-12 盤點後使用者挑出要做的項目：

- 第 2 項：LINE 通知裡的案件連結改開外部瀏覽器。
- 第 4 項：預約明細可以修改家長資料。
- 第 5 項：參觀案件批次標記「沒來」，加上聯絡內容範本。
- 第 6 項：各頁的 SEO 標題、描述、分享圖可在後台改。
- 第 7 項：補上後台改不到的公開內容，包括家長分享影片、機構社群連結、/environment 前三章。
- 第 8 項：即時預覽補洞，包括校園探索與 /news。
- 收尾技術債一整包。

### 1.1 已裁定事項（2026-10-12 使用者）

| # | 事項 | 裁定 |
|---|---|---|
| Q1 | 聯絡內容範本 | **總部統一管理**：總管理者在後台維護一份片語清單，五校共用 |
| Q2 | 後台改家長資料時，已建立的招生資料 | **仍是原值的欄位才一起改**；在招生端另外改過的不動 |
| Q3 | /environment 開放範圍 | **全部含標題**：照片、內文、卡片標題、各章大標都可改；圓體 700／800 補常用字分片 |

### 1.2 成功標準

1. 在 LINE 群組點通知裡的案件連結，會跳出 LINE 內建瀏覽器，在手機預設瀏覽器開後台（Google 登入不再被擋）。
2. 接待人員打錯家長電話、Email、孩子姓名或生日時，在案件明細就能改。改動有歷程與稽核；招生那筆若還是當初帶過去的值，就一起更新。
3. 「時間已過、還沒標記」的清單可以一次勾多筆標「沒來」。
4. 參觀案件與招生的聯絡紀錄輸入框上方有片語，點一下帶入；片語由總管理者在後台維護。
5. 下列內容都能在後台改，改完可即時預覽，沒改的沿用現在的內建內容：
   - /about、/curriculum、/environment、/news、/anniversary、/privacy、/admission 的搜尋標題、描述、分享圖
   - 家長分享影片
   - 機構社群連結
   - /environment 前三章
6. 收尾項目逐條完成（見第 9 節），全部測試綠燈。

### 1.3 不做

- 簡訊或 LINE 寄給家長。家長信仍只走 Email，正式站要等 SMTP。
- 片語分校區或分人。
- /environment 結尾三張「往其他分頁」卡、營養餐點書網址開放編輯。這兩項仍寫在程式。
- 30 週年頁內容開放編輯。這頁只開 SEO。
- 區域分析延後清單裡「待業主」的 P1（整個範圍都匿名化時，是否仍顯示行政區表）。
- 區域分析延後清單裡「每次換校重建 Leaflet」。這是文件自述的設計取捨。

## 2. LINE 案件連結外開瀏覽器（第 2 項）

- 現況：`backend/app/notifications/service.py` 的 `line_text` 已經帶後台案件網址，由 `admin_visit_url(admin_origin, receipt_id)` 組成，Email 通知共用同一個函式。
- 改法：
  - LINE 用的網址加上 `?openExternalBrowser=1`。這是 LINE 官方支援的參數，在 LINE 裡點開會改用外部瀏覽器。
  - Email 的網址不變。
  - 做成 `admin_visit_url(..., external_browser: bool = False)`，或另寫 `line_admin_visit_url`，兩種寫法擇一。
- 後台路由 `visit-requests/:id` 對多出來的 query 不受影響，不需要前端改動。
- 測試：
  - `test_line_notifications.py` 補一條：LINE 文字的網址結尾是 `?openExternalBrowser=1`。
  - Email 內文不含這個參數。

## 3. 後台修改家長資料（第 4 項）

### 3.1 API

`PATCH /api/website/v1/admin/visit-requests/{id}/details`

- 權限：與其他案件動作相同（`booking.read`＋`booking.handle`，依 `campus_scope`），一律走 `permissions.py` 的 capability。
- 請求 `AdminDetailsUpdate`：
  - 只送有改的欄位，可改 `parent_name`、`phone`、`email`、`child_name`、`child_birthdate`。
  - 必帶 `expected_version`，比對 `details_version`。這和家長端用同一個版本號，兩邊同時改會互相擋下（409 `VISIT_REQUEST_VERSION_CONFLICT`）。
- 驗證沿用家長端 `ParentDetailsUpdate` 的規則：
  - `normalize_phone` 只收 `09` 開頭 10 碼。
  - `EmailStr` 長度上限 254。
  - 擋控制字元。
  - `parent_name`、`phone` 不可清空。
  - **差異**：後台可以把 `email`、`child_name`、`child_birthdate` 清成空值，因為補登本來就允許沒有 Email。
- 可改條件：
  - 任何狀態都能改。
  - 已匿名化（`anonymized_at` 不為空）回 409。
  - 不受家長線上異動期限、每日次數限制。
- 寫入：
  1. 鎖列。
  2. 逐欄比對，只寫有變的欄位。
  3. 沒變化就不寫歷程、不寄信，回 200。
  4. 歷程 `details_updated`：source＝staff、`actor_user_id`，`after={"fields": [...]}`，只記欄位名不記內容（沿用歷程不放個資的約定）。
  5. 稽核 `visit_request.update_details`，metadata 記欄位名。
  6. **只有 Email 改了而且新值不為空**時，`enqueue_parent_email(PARENT_VISIT_CHANGED)`。信寄到新信箱，內含修改連結；舊信箱不通知（同家長端）。
  7. （2026-10-13 補）**原本的 Email 有值又被改掉**（改成別的或清空）而且還有有效的家長管理連結時，舊連結作廢：補登打錯信箱時，連結已經寄到陌生人手上。會寄第 6 點的變更信時換發一條新的（信在寄件當下重算，寄到新信箱的就是新連結，歷程記 `access_link_created`、`replaced_previous`）；其他情況（清空、場次已開始、案件不是預約成立）只撤銷（歷程記 `access_link_revoked`），園方需要時再「重新產生」。原本沒有 Email（連結是園方直接交給家長的）不動。回應多一個 `access_link_reset`。
- 回應：`VisitRequestFullOut`，含新的 `details_version`。

### 3.2 招生資料同步（裁定 Q2）

同一交易內，找出 `recruitment_visits.visit_request_id = 這一案`，而且尚未匿名化的那筆。對每一組對應欄位：**招生的現值等於「用舊預約值套同一套轉換」的結果時**，才改成新值的轉換結果。

| 預約欄位 | 招生欄位 | 轉換（同 `booking_link.fields_from_visit_request`） |
|---|---|---|
| parent_name | contact_name | 截 50 字 |
| phone | phone | 截 `LEN_PHONE` |
| child_name | child_name | 截 50 字，空值為「（未填姓名）」 |
| child_birthdate | birthday | 原值 |
| child_birthdate | grade | 依生日換算；只在招生 grade 仍等於「舊生日換算結果」時重算 |

- 有任何欄位同步時：
  - 招生那筆 `version` +1，正在招生端編輯的人送出時會被樂觀鎖擋下、重新整理。
  - 寫稽核 `recruitment_visit.synced_from_visit_request`，metadata 記欄位名。
  - 回應另附 `admissions_synced_fields: list[str]`，讓前端提示「招生資料已一起更新：電話」。
- 有欄位因為招生端改過而沒有同步時，回應附 `admissions_skipped_fields`。前端提示「招生資料的○○另外改過，沒有跟著改」。
- `admissions_enabled` 關閉時不做同步。
- 轉換函式從 `booking_link.py` 抽出共用，避免兩份規則漂移。

### 3.3 前端

- `VisitCaseFacts.vue` 面板頭加「修改」連結按鈕，`canHandle` 且未匿名化才顯示。
- 點了開 `VisitDetailsDialog`：
  - 五個欄位，生日用日期選擇器，電話即時顯示格式錯誤。
  - 送出前檢查有沒有未存修改；沒改就不送。
  - 409 版本衝突時提示「家長或同事剛改過資料，已重新載入」，並重新載入。
- 完成後：
  - 案件頁重新載入。
  - 依回應提示招生同步結果。
  - Email 有改時，另外提示「已寄變更通知到新信箱」；沒設 SMTP 時，沿用現有「沒有寄信」的說法。
  - （2026-10-13 補）`access_link_reset` 時：有寄變更信說「原本寄出的家長管理連結已失效，新連結在變更通知裡」；沒寄就警告要在「家長管理連結」重新產生。
- `labels.ts` 補 `AUDIT_ACTION_LABELS` 兩個新 action。`labelCoverage.test.ts` 會掃。
- 歷程的「資料已更新」依 source 顯示「家長改了…」或「○○改了…」。

## 4. 批次標記「沒來」與聯絡片語（第 5 項）

### 4.1 批次標記沒來

- 位置：`VisitRequestsView.vue` 既有的批次模式。這個模式只出現在「時間已過、還沒標記」清單，也就是 `attendanceOnly`。
- 勾選工具列在「標記到場」旁加「標記沒來」。
- 確認框：「把 N 筆標成沒來？會結案、停用家長的修改連結，名額不會釋出。」
- 實作沿用 `markArrivedInOrder` 的模式，一筆一筆打既有的 `POST /admin/visit-requests/{id}/no-show`：
  - 失敗收進 `batchFailures`。
  - 409 顯示「狀態剛被其他人更新」。
- `visitAttendance.ts` 抽出通用的 `markInOrder(ids, kind)`。
- 後端不改。

### 4.2 聯絡片語（裁定 Q1）

**資料**：新表 `contact_phrase_sets`，固定只有一列（`key='default'`）。

| 欄位 | 型別 |
|---|---|
| key | String(16) PK |
| phrases | JSON list[str] |
| version | Integer |
| updated_at | DateTime |
| updated_by | FK users，SET NULL |

- migration 只新增表，並插入預設片語。不改既有資料，不需要先備份正式庫。
- 預設片語（6 句）：
  - 「已致電，家長沒接」
  - 「已致電，轉語音信箱」
  - 「已加 LINE，等家長回覆」
  - 「家長考慮中，約好再聯絡」
  - 「家長已決定就讀」
  - 「家長暫不考慮」
- 規則：
  - 最多 20 句。
  - 每句 1–60 字，不可換行，不可重複。
  - 擋控制字元與 `javascript:`。

**API**：

- `GET /admin/contact-phrases`：有 `booking.read` 或 `admissions.read` 就能讀。
- `PUT /admin/contact-phrases`：
  - 請求 `{phrases, expected_version}`。
  - 新 capability `contact_phrases.manage`，只有總管理者有。
  - 版本不符回 409。
  - 稽核 `contact_phrases.update`，metadata 記句數。

**後台管理頁**：

- 「系統」分組加「聯絡片語」（`/contact-phrases`，總管理者）。
- 清單可新增、刪除、上下移、改字，存檔後立即生效（不經草稿與發布）。

**使用處**：

- `VisitCaseTimeline.vue` 的紀錄輸入框上方。
- 招生 `ContactLogDialog.vue` 的內容輸入框上方。

**輸入互動**：

- 片語以一列小按鈕（chip）顯示，點一下附加到輸入框：
  - 輸入框空白時直接帶入。
  - 已有字而且結尾不是標點時，先補「，」再接上。
- 游標移到輸入框結尾。
- 片語讀取失敗時不顯示這一列，也不擋輸入。
- 片語在頁面載入時抓一次，同一頁的多個輸入框共用快取。

## 5. 各頁 SEO 後台可編輯（第 6 項）

### 5.1 資料

`SiteMetaPayload` 新增：

```python
class PageSeoPayload(_ContentPayload):
    title: str = Field(default="", max_length=120)        # 空＝內建
    description: str = Field(default="", max_length=300)  # 空＝內建
    share_image: str = ""                                  # 素材庫 UUID；空＝全站分享圖
    share_image_alt: str = Field(default="", max_length=200)

PAGE_SEO_KEYS = ("admission", "about", "curriculum", "environment", "news", "anniversary", "privacy")
page_seo: dict[Literal[...PAGE_SEO_KEYS], PageSeoPayload] | None = None
```

- 既有 `admission_title`、`admission_description` 改成退役欄位（`exclude=True`）。
- site_meta 新增 `public_view`：
  1. 已發布版本若 `page_seo.admission` 的標題或描述是空的，而舊欄位有值，先把舊值補進 `page_seo.admission`。
  2. 再剔除退役欄位。
  - 這樣官網只讀 `page_seo`，正式站已發布的入學頁標題不會不見。
- 後台載入時同樣把舊欄位帶進 `page_seo.admission`。下次存檔後只剩新結構。
- 分享圖：
  - `_extract_site_meta_media_refs` 加上 `page_seo.*.share_image`，`kind="image"`，存檔時檢查是圖片。
  - 公開素材路由靠這個放行。
- 首頁維持用 `title`、`description`、`share_image`（不進 `page_seo`）。

### 5.2 官網

- `web/app/utils/seo.ts` 各頁函式改成：`siteMeta.pageSeo?.[page]?.title || 內建`。description、分享圖同理。
- 分享圖走 `siteShareImage` 的同一套 UUID 驗證，沒設就退回全站分享圖。
- 30 週年頁沿用現有的 `title` 格式；只有後台有填才覆寫。
- `/visit`、`/visit/manage` 維持 noindex、不開放。

### 5.3 後台

- `SiteMetaView.vue` 原本的「入學資訊頁的搜尋結果」改名為「各頁搜尋與分享」。
- 以頁籤切七頁，每頁有：標題（顯示內建值當 placeholder）、描述、分享圖（`MediaRefField`，ratio 1200/630）、分享圖說明。
- 欄位字數提示用 `LENGTH_HINTS`：標題建議 32 字內、描述 80 字內。
- 補 `KIND_FIELD_LABELS` 讓 422 定位得到。
- SiteMetaView 補 `:sections` 段落目錄（`editorSectionFields.test.ts` 會檢查涵蓋）。

## 6. 公開內容補進後台（第 7 項）

### 6.1 家長分享影片

`CampusProfilePayload` 新增：

```python
class TestimonialPayload(_ContentPayload):
    youtube_url: str = Field(max_length=300)   # 必須解得出 11 碼 id（同 home_news 的 youtube_id()）
    quote: str = Field(min_length=1, max_length=40)
    speaker: str = Field(min_length=1, max_length=20)
    poster: MediaSlotPayload | None = None     # 空＝內建封面，沒有內建就用 YouTube 縮圖
    poster_alt: str = Field(default="", max_length=200)

testimonials: list[TestimonialPayload] | None = None   # None＝沿用內建；[]＝這校不放；最多 4 支
```

- `extract_media_refs` 加 poster（`kind="image"`）。
- 官網 `content-overlay.ts` 的 campus_profile guard：
  - `testimonials` 是陣列就整組取代。
  - `None` 或缺欄位就保留 fixture。
  - poster 沒選時，先找 fixture 同 youtubeId 的內建封面（`/assets/story-<校>-<id>.webp`），找不到才用 `youtubeThumb(id)`。
- 關於頁第四章「家長怎麼說」：
  - 選片從「依五校順序取前 4 支」改成「五校輪流取，最多 4 支」：每校先取第 1 支，再輪第 2 支，依此類推，避免一校占滿。
  - 只有義華有影片時，結果與現在相同。
- 後台 `CampusProfileView.vue` 新增「家長分享影片」段：
  - 沒自訂時顯示「目前沿用內建 N 支」，並有「改成自訂（帶入目前的 N 支）」按鈕。內建清單在 admin 寫一份 `campusTestimonialsDraft(key)`，由測試比對 web fixture。
  - 自訂後是可新增、刪除、排序的清單，最多 4 支。
  - 「恢復內建」會把值設回 `None`。
- 預覽：campus_profile 的 PREVIEW_TARGETS 加一個分頁「關於頁家長怎麼說」，page `about`，block `about-voices`（選擇器 `#voices`）。

### 6.2 機構社群連結

`SiteMetaPayload` 新增：

```python
class SocialLinkPayload(_ContentPayload):
    platform: Literal["facebook", "line", "instagram", "youtube"]
    label: str = Field(min_length=1, max_length=20)
    url: str = Field(max_length=300)   # 只收 https
social_links: list[SocialLinkPayload] | None = None   # None＝內建；最多 6 筆，網址不可重複
```

- 官網：
  - site_meta guard 套 `social_links`，每筆過 `httpsUrl()`，不合格的丟掉。
  - 同時修正現況：`SiteHeader.vue` 的機構社群目前沒驗證就直接綁 href。
  - `organizationSameAs()` 照舊取這份清單。
  - `SiteHeader` 的 `platform` 型別擴充到四種。圖示用 sprite 現有的 Phosphor 圖示；缺的話照 Phosphor Regular 補進 sprite。
- 後台：SiteMetaView 新增「機構社群」段，是清單編輯器。

### 6.3 /environment 前三章（裁定 Q3）

新 content kind `environment_page`（`shared_only=True`，總管理者，同 about_page），不需要 migration，因為 `content_items.kind` 是字串。

`EnvironmentPagePayload`（`page_schemas.py`，沿用 `page_title`／`page_text`／`exactly`／`PagePhotoFields` 與 `_reject_unsafe_strings`）：

文字上限的定法同 about_page：先取內建文字長度的 1.5 倍（標題逐行），再用 `scripts/page-copy-stress.cjs` 在 390 與 1440 塞滿上限實測，破版就下修。`page_schemas.py`、`contentHints.ts`、DESIGN.md 上限表三處一起寫。

| 區塊 | 欄位 | 固定數 |
|---|---|---|
| 首屏 | `hero_title`（多行）、`hero_highlight`（大標同一行的子字串，畫手繪螢光）、`hero_lede`、`hero_notice`、`hero_photo`＋`hero_photo_alt`、`hero_caption` | — |
| 章名 | `chapter_names` | 固定 4（幼兒保育、校園環境、幼兒餐點、五所校園） |
| 01 保育 | `care_title`（多行）、`care_lead`、`hearts`、`care_text`、`care_photo`＋alt＋`care_caption`＋`care_photo_note`（照片上的便條） | `hearts` 固定 5，每項 4 字 |
| 01 五件小事 | `care_items: {title, text, photo, photo_alt}` | 固定 5 |
| 02 環境 | `spaces_title`（多行）、`spaces_text` | — |
| 02 主打 | `feature: {tag, title（多行）, text, photo, photo_alt, note}` | — |
| 02 小腳印 | `trail_hint`、`spaces: {title, text, photo, photo_alt, note, campus_label（可空）}` | `spaces` 固定 6 |
| 03 餐點 | `meals_title`（多行）、`meals_text`、`meals_day_title`、`meals: {time（HH:MM）, name, note, text}` | `meals` 固定 5，時間要由早到晚 |
| 04 五所校園 | `tour_title`（多行）、`tour_text`、`tour_hint` | — |

- **固定在程式、不開放的**：
  - 便條位置與箭頭落點（`noteAt`、`to`），依格子序號固定。換照片後箭頭可能沒指準，後台在便條欄位說明這件事。
  - 太陽弧位置 `t`（0、0.25、0.5、0.75、1）。
  - 結尾三張卡（NEXT）、營養餐點書連結、各章 hint 的計數。
- 照片沒選時沿用內建靜態圖。內建 `pos`（object-position）在換成素材後改用素材的焦點（focus_x／focus_y）。
- 預設內容：
  - web fixture 新增 `environmentPage`，把現在 `EnvironmentContent.vue` 的常數原樣搬進去。第四章段落文字同時改掉過時的「取自各分校頁」。
  - admin 寫 `environmentPageDraft()`。
  - 測試比對兩邊一字不差（同 about_page 的三份副本守門）。
- 官網：
  - `content-overlay.ts` 加 `environmentPage()`：`assertCounts`（`PAGE_COUNTS.environment`）→ 型別檢查 → 整份取代，形狀不符就退回內建。
  - `EnvironmentContent.vue` 改成讀 `page: EnvironmentPageContent` prop。
  - 首屏預載沿用 `environmentHeroImage()`，換成素材時比照 `aboutHeroAttrs`。
- 後台：
  - `EnvironmentPageView.vue`，結構同 `AboutPageView.vue`：`ContentEditor`＋`navSections`、`PageCopyField`、`PagePhotoField`、`data-list`。
  - 路由 `content/environment-page`；nav 放在「全站與素材」，位於「關於常春藤頁」之後。
  - 補 labels（`CONTENT_KIND_LABELS`、`contentPublicPath/PreviewPath/EditorPath`、`MEDIA_SLOT_PATH_LABELS`、`KIND_FIELD_LABELS`、`LIST_UNITS`、`LENGTH_HINTS`）。
- 字型（裁定 Q3）：
  - `scripts/subset-environment-fonts.py` 的「其餘分片」從「圓體 400＋芫荽」擴大到圓體 700、800，做法相同：常用字頻表扣掉 critical，約 40 KB 一片。
  - 重跑腳本，更新 `environment-font-manifest.json` 與擴充樣式表。預估檔案增加數 MB（實作時量出實數，記進 README）。
  - 後台缺字提示：產出 `chars-environment.txt`（四個字重 critical∪常用字的交集）。環境頁欄位的 `GlyphHint` 改讀這份；罕用字顯示「這幾個字會用系統字顯示」。
- 預覽：`environment_page` 對應 PREVIEW_TARGETS `environment`／`page-top`。

## 7. 即時預覽補洞（第 8 項）

1. **校園探索**：
   - `PREVIEW_TARGETS.campus_tour` 從 `[]` 改成 `[{page:'environment', block:'environment-tour'}]`。
   - 新 block `environment-tour` 的選擇器是 `.renv-tour`。
   - 官網收到草稿時，切到 `campusKey` 那校的分頁再框選，同首頁五校切分頁的做法。
   - `CampusTourView` 進入三欄版面（熱點編輯 10-04 已拿掉，原本「寬版放不下」的理由已不成立）。
2. **/news**：
   - 官網 `PreviewPage`、`PAGES` 與後台 `PreviewPage` 三處同步加 `news`。
   - `preview.vue` 的 news 分支渲染 `NewsIndexContent`。
   - `home_news`、`campus_news` 的 targets 變成兩個分頁：首頁消息、消息列表頁（`news`／`page-top`）。
3. **守門測試**同步更新：
   - `previewProtocol.test.ts`（三處 PreviewPage 一致、block 一致）
   - `livePreviewPane.test.ts`（EDITOR_KINDS 加 `environment_page`；`campus_tour` 不再是空陣列）
   - `editorThreeColumns.test.ts`、`campusTourHq.test.ts`
   - `tests/stack/editor-live-preview.spec.ts`（校園探索改成要有預覽欄）

## 8. 案件列表：提早完成的案件不再顯示「沒有場次」

- 後端 `list_visit_requests`：
  - 加一個 scalar subquery，算 `visited_on`：有場次用場次日期；沒有場次、而且狀態是 completed 的，取最後一筆 `completed` 歷程的台北日期。
  - `VisitRequestDetailOut` 加 `visited_on: date | None`。
  - `visit_asc`／`visit_desc` 排序改用 `coalesce(slot.slot_date, visited_on)`，時間欄仍以場次開始時間排，沒有就排在同日最後。
- 前端：
  - `groupVisitsByDay` 用 `row.slot?.slot_date ?? row.visited_on` 分組。
  - `VisitListRow` 沒有場次但有 `visited_on` 時，時間欄顯示「提早到場」與日期。
- 測試：
  - `test_visit_complete_early.py` 補一條：列表的 `visited_on` 等於提早完成當天，排序落在那一天。
  - 前端單元測試補分組。

## 9. 收尾技術債

| # | 項目 | 做法 |
|---|---|---|
| T1 | `?copy=` 比稿參數 | 刪掉 `HeroVideo.vue` 的 `copyDrafts` 與 `useRoute`。保留 `heroText` 這個名稱（`computed(() => props.hero)`），因為 `hero-brush-20260930.spec.ts` 用原始碼字串比對它。README 註記移除 |
| T2 | 官網沒人讀的欄位 | 從型別、web fixture、`overlay-baseline-20260925.json` 與相關測試刪掉 `HeroContent.ctaLabel／ctaHref`、`FooterContent.titleFontCredit／orgSiteLink`、`GeneratedTourScenes`（型別、`isGeneratedTourScenes`、`public-copy.ts` 與 `EnvironmentContent.vue` 的分支） |
| T3 | 後端沒人讀的欄位 | 刪 `Settings.indexing_enabled`、`.env.example` 那行、`test_config_isolation.py` 的斷言。設定是 `extra="ignore"`，Railway 上殘留的 `WEBSITE_INDEXING_ENABLED` 不會擋啟動，留給使用者自行刪除。`CampusProfilePayload.hero_focus` 依退役慣例改成 `exclude=True`，公開輸出由 `_public_without_retired` 剔除；後台表單、`site_import.py`、labels 不再寫或顯示它 |
| T4 | 兩份 fixture 合一 | 刪 `content/site-fixture.json`，唯一來源是 `web/server/data/site-fixture.json`。`deploy/api.Dockerfile` 改成 `COPY web/server/data/site-fixture.json /app/content/site-fixture.json`，保留正式站指令路徑不變。`tests/stack/start-api.sh`、`scripts/check-font-coverage.py`、後端測試路徑、`docs/website-admin/README.md` 跟著改。後端測試的初始化筆數依實際結果更新：四校 campus_tour 與義華家長影片會一起初始化。三支「兩份 fixture 相同」的測試改成只驗初始化內容 |
| T5 | fixture 過期的 `_todo` | 四校「FB 借用機構粉專」改成「LINE 官方帳號待園方提供」。第四章段落文字隨 6.3 一起改 |
| T6 | 跨日的測試 | `test_booking_concurrency.py`：slot_date 從建好的場次讀，不再另外呼叫一次 `today_local()`。`tests/stack/db.ts` `makeFollowUpDue`：改成 `GREATEST(now() - interval '1 hour', 台北今天 00:00)`，台北 00–01 點也落在「今天」 |
| T7 | 換帳號自動登回 | `redirectToLoginOnUnauthorized` 清 session 前，先在 store 記 `previousUserId`。`authGuard` 的 login 分支遇到 `reason=other-user／session-changed` 時，先用 `refreshSession(previousUserId)` 比對，同一人才恢復，不同人就停在登入頁並顯示原因。補 router 層測試（註冊真的 `authGuard`）。`deploy/README.md:550` 已知限制改成已修 |
| T8 | preview-headers 大小寫 | `web/server/middleware/preview-headers.ts` 比對前把路徑轉小寫。補測試：`/Visit/Manage` 也要有 no-store、noindex、no-referrer |
| T9 | 區域分析延後項目 | `docs/superpowers/plans/2026-10-08-admissions-area-followups.md` 中，10-12 盤點仍在的程式與測試項全部處理，不含 1.3 排除的兩項。重點：里界 GeoJSON 由 web 代理針對 `/admin/admissions/area/boundaries` 做 gzip（h3 代理不轉 accept-encoding，所以在 web 層壓）；`matcher.py` 的 `func.abs` 改成兩個範圍條件吃索引；390px「查看明細」欄固定在右側、加橫捲提示；地址解析「二十之一號、六十八號之一、一百零八巷」；lane／alley 長度與前導零；匯入清理失敗不蓋原例外；版本日期用台北時間；同步只跟隨 https 轉址；最新年度頁失敗退回前一年；地圖 listener 銷毀時 off；鄰近幼兒園清單的 aria 與重設；999 m 顯示。逐條勾在該文件 |
| T10 | 文件 | 更新 `acceptance.md`：A21、A22 證據改成現有測試；A18、A19、A23、A24 重複列與狀態矛盾合併成一列；A23 寫明缺什麼或改成通過。更新 `acceptance.md:269`、`baseline.md:13`（四校已有真場景）。更新 `SiteHeader.vue:10-14` 註解與 `CLAUDE.md:70`（五個頁面捲過 40px 都收、900px 以下全站收）。`AboutPageView`、`AboutContent` 的 testimonials 註解隨 6.1 變成事實 |

T9 動到 `backend/app/admissions/`，跟進行中的 `feature/admissions-deposit-pace-20261012`（改 `stats.py`、`schemas.py`）可能重疊，所以排在最後一階段。合併前 rebase 到最新 main。

## 10. 階段與驗證

分四階段，在同一分支上依序做。每階段結束先過該階段的閘門，再進下一階段。

| 階段 | 內容 | migration |
|---|---|---|
| A 收尾 | 第 2 節、第 8 節、T1–T8、T10 | 無 |
| B 後台案件 | 第 3 節、第 4 節 | `contact_phrase_sets`（新增表＋預設片語） |
| C 內容與預覽 | 第 5–7 節＋環境頁字型 | 無 |
| D 區域分析 | T9 | 無 |

每階段的閘門（主 session 背景跑全套；subagent 只跑單檔前景測試）：

- `npm --prefix web run typecheck`、`npm --prefix web run test:unit`
- `npm --prefix admin run typecheck`、`npm --prefix admin run test:unit`
- 後端全套 pytest：用自己的測試庫（名稱含 `test`），先 `alembic upgrade head`。
- `npm run contract:check`、`python3 -m unittest discover -s deploy/tests`
- 動到畫面的階段（A、B、C）：本機起 stack，跑相關 stack e2e。手機 390 與桌機 1440 用 Playwright 截圖目視。

上線：

- 四階段完成後，由使用者決定 push `feature/**` 跑 CI，再併入 main。
- 推 main 一律給使用者 `!` 指令。
- 唯一的 migration 只新增表，不需要先備份正式庫。
- 上線後補 `deploy/README.md` 紀錄，以及 README 頂部日期段。DESIGN.md 記錄：環境頁開放編輯的固定項、家長影片輪流取、片語。

## 11. 風險

- **環境頁字型變大**：700、800 加上常用字分片，repo 與映像會多幾 MB。只在用到的字才下載，首屏不受影響。實測後若超過 15 MB，改成只補 700，800 只給首屏大標用的常用 3,000 字。
- **fixture 合一改變初始化結果**：只影響新環境的 `initialize-content`，正式站不跑。後端測試筆數要一起改。
- **招生同步誤判「仍是原值」**：轉換規則與 `fields_from_visit_request` 共用同一個函式，並且用測試鎖住；比對不到就不改，只提示。
- **T9 與 deposit-pace 分支衝突**：排最後，合併前 rebase。
