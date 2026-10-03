# 官網後台六項功能：計畫總表（2026-10-03）

六份計畫都以 origin/main `15fd9a5` 為基準，只讀程式碼寫成，**計畫裡的測試都還沒實際跑過**。每份各開一個 session 實作；開工前先讀這份總表，再讀自己那份。

## 使用者 2026-10-03 裁定

- 重設密碼：只做「總管理者寄重設連結」，不開放登入頁自助。
- /about、/curriculum：文字與照片都開放編輯（標題沿用缺字提示、設字數上限），章節數量與版面結構固定。
- 統計頁的五校比較與招生入學 `/compare` 分開做：統計頁只比預約與流量。

## 六份計畫

| # | 計畫 | Task 數 | Migration | 分支／worktree（Task 0 會建） |
|---|---|---|---|---|
| 1 | [成效統計補強](2026-10-03-admin-analytics-phase1.md) | 14 | 無 | `feature/admin-analytics-phase1-20261003`／`~/Desktop/ivy-website-analytics-20261003` |
| 2 | [後台 UX 第八輪](2026-10-03-admin-ux-round8.md) | 13 | 無 | `feature/admin-ux8-20261003`／`~/Desktop/ivy-website-admin-ux8-20261003` |
| 3 | [總管理者寄重設連結](2026-10-03-admin-password-reset-link.md) | 12 | `d2b7f4c9e1a3`（新表 password_reset_tokens） | `feature/admin-password-reset-20261003`／`~/Desktop/ivy-website-pwreset-20261003` |
| 4 | [匯出擴充](2026-10-03-admin-exports.md) | 13 | 無 | `feature/admin-exports-20261003`／`~/Desktop/ivy-website-exports-20261003` |
| 5 | [素材背景轉檔](2026-10-03-media-background-jobs.md) | 12 | `e5b9c3a7d214`（新表 media_jobs＋3 個 enum 值） | `feature/media-jobs-20261003`／`~/Desktop/ivy-website-media-jobs-20261003` |
| 6 | [/about、/curriculum 開放編輯](2026-10-03-about-curriculum-cms.md) | 18（A：/curriculum 0–10、B：/about 11–17，可分開上線） | 無 | `feature/page-cms-<日期>`／`~/Desktop/ivy-website-page-cms-<日期>` |

**計畫檔的位置**：計畫目前是 `~/Desktop/ivy-website-admin`（`feature/website-admin`，很舊的分支）裡未追蹤的檔案。各 session 做 Task 0 時，把自己那份計畫和這份總表複製進 worktree 的 `docs/superpowers/plans/`，隨第一個 commit 一起提交，讓計畫跟著分支走。

## 建議順序

```
第一波（可並行）  1 成效統計      2 UX 第八輪
第二波（可並行）  3 重設密碼      4 匯出擴充
第三波（可並行）  5 背景轉檔      6 /about、/curriculum
```

- **2 排第一波**：它產出共用的選圖元件 `MediaRefField.vue`／`MediaFieldCard.vue`（預留 `status` prop），5 和 6 要用；它也動 `UsersView.vue` 與 `auth/*`，3 會撞到。
- **4 排在 1 之後**：4 的 Task 12（統計頁匯出）明寫要等 1 合併後才做。兩份都動 `AnalyticsView.vue`、`operations/routes.py`。
- **5 和 6 排在 2 之後**：兩份都寫了「UX 第八輪已合併就用共用元件，否則改既有元件」的分支路徑。照這個順序就只走前者，比較省事。
- **機器只有 8GB**：可以同時開兩個 session 寫程式，但**同一時間只讓一個 session 跑全套測試**（後端 pytest、vitest、stack e2e）。

## 合併時一定會碰到的衝突

| 共用處 | 涉及計畫 | 處理 |
|---|---|---|
| alembic head | 3、5（兩份的 down_revision 都是 `4a7e2c9d1b63`） | 後合併的那份把 `down_revision` 改接先合併那份的 revision，再 `uv run alembic heads` 確認只有一個 head |
| `contracts/openapi.json`、`contracts/generated/*`、`admin/src/api/types.ts` | 1、2、3、4、5 | 衝突時不手動合併，合併後重跑 `npm run contract:generate`，再跑 `contract:check` |
| `backend/app/booking/routes.py` | 1（抽 `pending_kinds.py`）、2（狀態衝突）、4（CSV 改用共用 helper） | 三處不同區段，照順序合併通常自動解掉；合併後跑 booking 相關單檔測試 |
| `AnalyticsView.vue`、`operations/routes.py` | 1、4 | 1 先 |
| `UsersView.vue`、`backend/app/auth/*` | 2、3 | 2 先 |
| `MediaSlotField.vue` 與選圖元件 | 2、5、6 | 2 先 |
| `nav.ts`、`contentFieldLabels.ts`、`AdminSidebar.vue` | 2、6 | 2 先 |
| `web/app/utils/media-image.ts`、`content-overlay.ts` | 5、6 | 同一波；後合併的重跑 web 單元測試 |
| `backend/tests/conftest.py`（TRUNCATE 清單） | 3、5 | 兩邊各加一張表，合併時兩行都留 |
| `admin/src/api/labels.ts`、`labelCoverage.test.ts` | 3、4、5、6 | 多半是新增條目，兩邊都留 |
| README 頂部、DESIGN.md、`acceptance.md` | 全部 | 依合併時間由新到舊排在頂部 |

合併前照記憶與 CLAUDE.md 的慣例：`git fetch`，用 `merge-base --is-ancestor origin/main HEAD` 確認可以快轉；`gh run list --branch main --limit 1` 確認 main 本身沒紅。push main 等於正式部署，3、5 有 migration，部署前先問是否要備份正式庫。

## 要使用者決定的事

**會擋住開工或上線的：**

1. **匯出含個資的招生明細**（計畫 4）：招生規格 `docs/specs/2026-09-30-website-admissions-design.md:65` 和 DESIGN.md:1562 都寫「本次不做任何含個資的匯出」。計畫預設這次的選擇取代舊規則，但要你明確確認。不確認的話，4 只做操作紀錄和去識別統計的匯出。
2. **Railway api 容器的記憶體夠不夠轉檔**（計畫 5）：轉檔限 1 個併發、在 API 程序內跑。記憶體不夠就要另開付費的 worker 服務。
3. **正式站 SMTP**（計畫 3）：沒設好之前，「寄重設連結」按鈕會停用。

**有預設值、做到那一步再確認即可：**

| 計畫 | 問題 | 預設 |
|---|---|---|
| 1 | 到場率的分母 | 已到場＋未到場；參觀時間已過但還沒標記的另列，不算進分母 |
| 1 | 班別分布預設看哪個學年、要不要含已取消的預約 | 目前學年；含已取消 |
| 2 | 沒有承辦權限的唯讀角色要不要看到「我承辦的未結案」；停用帳號時要不要自動清掉承辦人 | 不給看（要有 `booking.read`）；不自動清 |
| 2 | 12 小時登入到期前多久提醒 | 15 分鐘 |
| 3 | 保留「直接設定新密碼」 | 保留，給沒設 SMTP 時用 |
| 3 | 直接設密碼也解除「密碼錯太多次」的登入暫停 | 解除（這會改變現有行為） |
| 4 | 招生明細沿用 `booking.export` 授權；操作紀錄匯出另寫稽核 | 沿用；不另寫 |
| 5 | 轉檔參數 | CRF 20（桌機）／26（手機）、長邊上限 1920、30fps、不帶聲音、影片最長 10 分鐘 |
| 5 | 處理失敗的影片 | 保留原檔，不算進配額 |
| 6 | 不開放編輯的字 | 英文小字、六大領域與核心素養、年段名稱、連結文字 |
| 6 | 正式站上線後要不要跑 `initialize-content` | 不跑（它會順帶建立 `shared_faq` 等內容），官網照常顯示內建內容 |
| 6 | 義華創校年份 | 等園方確認 1997 或 1998，沿革年份開放編輯 |

**正式站只能由使用者本人執行的：** 5 的既有影片回補與圖片補中圖（先備份、用 `railway ssh`）。

## 順帶發現

- 根目錄 CLAUDE.md 的「字型子集」一節已經過時：origin/main 已有完整的 LINE Seed TW，切成約 200 個 `unicode-range` 字型檔（`web/public/assets/fonts/subsets/`，OFL 授權）。計畫 6 依現況寫，CLAUDE.md 還沒改。

## 開 session 時可以這樣說

> 照 `~/Desktop/ivy-website-admin/docs/superpowers/plans/2026-10-03-<計畫>.md` 實作。先讀同目錄的 `2026-10-03-admin-roadmap-index.md`，確認前一波的計畫是否已合併。
