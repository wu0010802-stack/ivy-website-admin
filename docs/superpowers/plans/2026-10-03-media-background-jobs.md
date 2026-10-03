# 素材背景轉檔（影片轉檔＋圖片中圖）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 影片上傳後不再在請求裡抽 poster，改由 API 程序內的背景工作產生 poster 與桌機／手機兩個 H.264 轉檔版本，官網改播轉檔版本；圖片多一個長邊 960 的中圖。

**Architecture:** 上傳請求照舊做驗證、去除拍攝資訊、ffprobe、配額與存檔，然後只寫一筆 `media_jobs`（影片）就回 `processing`。API 程序內新增 `MediaJobLoop`（獨立 asyncio task，不併進每 60 秒的 maintenance 一輪），用 outbox 同款的 `FOR UPDATE SKIP LOCKED` 租約認領，轉檔期間每 30 秒延長租約；完成時比對 `leased_by`，租約被接手就整批丟掉。本機開發與測試預設 `inline`（同一套產生函式在請求交易裡跑完），正式站預設 `background`。官網 `slotVideoSrc` 依素材的 `video_desktop`／`video_mobile` 衍生檔選網址，沒有就退回原檔。

**Tech Stack:** FastAPI 0.136.1（釘版）、SQLAlchemy 2.0 async、Alembic、PostgreSQL、ffmpeg／ffprobe（libx264）、Pillow；後台 Vue 3＋Element Plus＋Vitest；官網 Nuxt 4＋Vitest。

**Spec:** 沒有獨立規格。來源：`docs/website-admin/acceptance.md:373`（背景轉檔佇列未做）、`docs/website-admin/operations.md:178`（上傳仍在同一請求內從 processing 變 ready）、DESIGN.md「孩子的一天」影片段（約 :501-503，手機同解析度、CRF 較高）、`web/app/utils/media-policy.ts:23-24`。

## 設計決定

| # | 決定 | 理由 |
|---|---|---|
| D1 | **去除拍攝資訊留在上傳請求內**，背景只做 poster 與轉檔；不採「請求只存原始檔、背景再 strip」 | 資安稽核規則：未去除 EXIF／GPS 的位元組不能被讀到。留在請求內＝儲存體裡從頭到尾只有乾淨檔，不必另外設計「處理中原檔的私有區」。影片 strip 是 `-c copy` 重新封裝，150 MB 也只要幾秒（`metadata.py:46-47`）；真正慢的是轉檔與 poster。 |
| D2 | **圖片照舊在請求內產生衍生檔**（縮圖、中圖、大圖），只有影片走背景 | 圖片上限 15 MB、處理約 1–2 秒；選圖器「傳一張就直接選用」（`MediaPickerDialog.vue:96-106`）依賴回應已是 ready。把圖片也背景化會讓選圖器要輪詢，換來的只是省 1 秒。 |
| D3 | 新衍生檔種類 `medium`（長邊 960 WebP）、`video_desktop`、`video_mobile`（H.264 MP4） | 官網 srcset 目前只有 480 與 1600，2 倍手機滿版（約 780px）只能拿 1600。影片兩版沿用 `media-policy.ts:23` 的既有規則：同解析度同構圖，手機只提高 CRF。 |
| D4 | 轉檔參數：libx264 `preset medium`、桌機 CRF 20、手機 CRF 26、長邊上限 1920（不放大、取偶數）、最高 30 fps、`yuv420p`、`profile high`、`+faststart`、**不帶聲音**、不帶 metadata／章節；影片長度上限 10 分鐘；單支轉檔逾時＝長度×6（120–1800 秒） | 官網所有影片版位都是靜音播放（首屏、孩子的一天背景、活動影片輪播 `HomeFilms.vue:10`），去掉音軌省流量。CRF 26 是 DESIGN.md 已驗證的手機首屏值（VMAF 手機模型 99.88）；桌機 CRF 20 比官網內建母帶的 18 略省，因為來源是園方手機影片。`preset slow` 在 Railway 2 執行緒上太慢。**參數待使用者確認，見文末。** |
| D5 | HDR（`color_transfer` 為 `smpte2084`／`arib-std-b67`）先 tonemap 成 SDR，需要 ffmpeg 的 `zscale`；沒有 `zscale` 就照常轉並寫 warning log | iPhone 預設錄 HDR，直接轉 8 位元會灰白。本機 Homebrew ffmpeg 8.1 沒有 `zscale`（已查：`ffmpeg -filters` 只有 `colorspace`、`tonemap`），所以要能退回。正式映像（Debian `ffmpeg` 套件）有沒有要在上線時查，見 Task 10 部署步驟。 |
| D6 | 背景處理跑在 API 程序內的獨立 `MediaJobLoop`，**不新增 Railway 服務**；同時一件（`TRANSCODE_CONCURRENCY = 1`，另一組 `ThreadSlots`，不佔上傳驗證用的 `MEDIA_JOB_CONCURRENCY = 2`）；ffmpeg 前面加 `nice -n 10`、`-threads 2` | 不建付費服務（CLAUDE.md）。API 只有一個 uvicorn 程序（`deploy/api-start.py:50`），素材在 volume 上、api 只能單一實例（`deploy/README.md:375`）。 |
| D7 | 不放進 `workers/maintenance.run_cycle` | 那一輪持全域 advisory lock、每 60 秒一次（`maintenance.py:96-114`），轉一支影片幾分鐘會讓排程發布、通知一起延後。 |
| D8 | 租約 120 秒、每 30 秒延長；租約到期被重新認領**算一次嘗試**，最多 3 次；逾時、ffmpeg 無法執行、儲存體暫時錯誤可重試（退避 60 秒、600 秒），影片本身解不開不重試 | 程序被 OOM 砍掉時，同一支影片不能讓 API 無限重啟。 |
| D9 | 處理中的影片**可以選進草稿**，發布由既有檢查擋下（`content/publish_jobs.py:72-82` 回 `MEDIA_NOT_READY`）；排程建立也走同一檢查（`content/routes.py:657`）；替換引用改成「處理失敗或已刪除才擋」 | 編輯換首屏影片時不必等轉檔完才能存草稿。處理中的素材公開路由本來就 404（`media/routes.py:748`），草稿預覽也看不到，後台文案寫「轉好才能預覽與發布」。 |
| D10 | 處理失敗的影片**保留乾淨原檔**，後台可按「重新處理」；配額照舊不算 FAILED（`service.py:105-108`） | 失敗多半是逾時或部署中斷，重新處理不必重傳 150 MB。配額漏算的風險只來自已登入員工，記入已知限制。 |
| D11 | 開關：`WEBSITE_MEDIA_VIDEO_PROCESSING=inline|background`，沒設時 production＝background、其他＝inline；`WEBSITE_MEDIA_JOBS_POLL_SECONDS`（預設 5） | 既有後端測試假設上傳完就 ready；本機 dev 也不必多起東西。stack e2e 明確設 background，走真正的背景路徑。 |
| D12 | 狀態顯示改在**既有元件**：`MediaLibraryView`、`MediaPickerDialog`、`MediaSlotField`、`MediaUploadList`、`MediaReplaceDialog`；判斷與輪詢抽到 `admin/src/composables/mediaProcessing.ts` | 影片版位全部經過 `MediaSlotField`（`HomeHeroView.vue:70-73`、`DayExperienceView.vue:156-159`、`HomeFilmsEditor.vue:98`）。「後台 UX 第八輪」若之後把選圖元件統一，共用元件直接呼叫同一個 composable；若第八輪先合併，本計畫 Task 8 改到新的共用元件上（判斷與文案不變）。 |
| D13 | 既有影片回補用新指令 `transcode-media-videos [--apply]`：只**排入** backfill 工作，由正式站 API 的背景迴圈逐支轉；backfill 不改素材狀態（ready 照常上線），失敗也不動素材。既有圖片補中圖沿用 `regenerate-media-variants`（加「缺中圖」原因） | 指令列在 api 容器裡直接轉會跟 API 搶 CPU 且不受名額限制；排進佇列就沿用同一套限制。 |

## 已完成、不做

- 圖片縮圖（長邊 480）與大圖（長邊 1600）已存在：`backend/app/media/processing.py:16-17`、`backend/app/media/service.py:150-156`；官網 srcset 已接：`web/app/utils/media-image.ts:95-115`。本計畫只補中圖。
- 上傳、替換、匯入都在存檔前去除拍攝資訊（含 MP4 `-map_metadata -1`）：`backend/app/media/service.py:199-229`、`backend/app/media/metadata.py:304-345`；既有素材補清理指令 `strip-media-metadata` 已有。不動。
- API 映像已裝 ffmpeg（含 ffprobe）：`deploy/api.Dockerfile:5`。不改 Dockerfile。
- 發布、核准、建立排程、排程到期、還原都會擋未處理完成的素材：`backend/app/content/publish_jobs.py:72-82`（`check_publishable` 呼叫點 `content/routes.py:458,512,657,804`、`release_routes.py:192`）。
- 素材檔案串流與 Range（本機與 S3）：`backend/app/media/storage.py` 的 `file_response`；公開路由權限 `media/routes.py:738-754`。衍生檔路由會照用。
- 處理名額上限（解碼、ffmpeg 同時 2 件）：`backend/app/media/processing.py:41-46`。轉檔另開一組，不改這組。

## Global Constraints

- 程式基準 origin/main `15fd9a5`（開工時以當下 origin/main 為準）；Node 22（`.nvmrc`），Node 指令一律 `source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; <指令>`（分號，不用 `&&`）。
- FastAPI 0.136.1 釘版，不升級任何依賴；不新增 Python／npm 套件。
- 不新增 Railway 服務、不建付費服務；不 push、不部署、不碰正式庫。push main＝正式部署，由使用者決定。
- `git add` 一律列檔名，不用 `-A`／`.`；commit 用 Conventional Commit、繁體中文，結尾 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 每個 Task 只跑相關單檔前景測試；全套只在 Task 11，由主 session 背景跑、同時只跑一組（機器 8GB）。
- 動到 API／schema 後 `npm run contract:generate`，閘門跑 `npm run contract:check`。
- ffmpeg／ffprobe 呼叫一律帶 `FFMPEG_INPUT_GUARD`（`-protocol_whitelist file -f mov`）、`-nostdin`、`stdin=subprocess.DEVNULL`、`timeout=`（`processing.py:48-50`、`tests/test_secfix_media.py:451-457`）。
- 後台文案沿用 DESIGN.md「官網後台全面盤點與修正（2026-09-28）」用語（「影片封面」「跨校共用」等），直白、不加英文標語、不寫行銷句。
- 後端錯誤格式維持 `{detail: {code, message}}`。
- 已知假失敗：台北週五的 `test_booking_consent_readiness` 場次同步；stack `media.spec` 間歇（存檔完成前就讀 API）。

## Review Focus

1. **未去除拍攝資訊的位元組不能出現在儲存體或任何回應**：背景化之後，原檔仍在請求內清理；轉檔版本也不能把 `location`／`creation_time` 帶回來，直式手機影片轉檔後寬高要對調（ffmpeg 自動轉正）。→ Task 3 `test_editions_drop_location_tags_and_follow_rotation`。
2. **處理中的影片**：公開路由 404、草稿可存、發布被擋（`MEDIA_NOT_READY`）、替換引用不能再把 processing 當失敗。→ Task 4 `test_processing_video_can_be_drafted_but_not_published`、`test_replace_references_accepts_processing_video`。
3. **程序被砍或 OOM**：租約到期重新認領要計次，第 3 次直接標失敗並寫原因，不能讓 API 反覆重啟。→ Task 3 `test_expired_lease_reclaim_counts_and_stops_after_max`。
4. **回補既有 ready 影片期間官網不能中斷**：backfill 工作不改素材狀態，失敗也不動素材、不改 `processing_error`。→ Task 3 `test_backfill_keeps_asset_ready_even_when_it_fails`。
5. **活動影片的 start／end 秒數**：轉檔不能裁切或改時間軸（不加 `-ss`／`-t`，時長要和原檔一致）。→ Task 2 `test_transcode_keeps_duration_and_drops_audio`。

## File Structure

| 檔案 | 動作 | 責任 |
|---|---|---|
| `backend/migrations/versions/e5b9c3a7d214_media_jobs_and_video_editions.py` | 新增 | `media_jobs` 表、`media_variant_kind` 加 `MEDIUM`／`VIDEO_DESKTOP`／`VIDEO_MOBILE` |
| `backend/app/media/models.py` | 改 | `VariantKind` 新值、`MediaJobKind`、`MediaJobStatus`、`MediaJob` |
| `backend/app/media/processing.py` | 改 | 中圖尺寸、`ProcessingError.retryable`、轉檔參數／色彩探測／`transcode_video`、轉檔名額 |
| `backend/app/media/jobs.py` | 新增 | 排入、認領、產生並寫入衍生檔、完成／失敗、租約、inline 處理、重新處理、回補 |
| `backend/app/workers/media_loop.py` | 新增 | `MediaJobLoop`（程序內背景迴圈、停機時放回佇列） |
| `backend/app/media/service.py` | 改 | 中圖；影片改排背景工作；`video_processing` 參數 |
| `backend/app/media/routes.py` | 改 | 上傳／替換帶處理模式；衍生檔名稱；`POST /{id}/retry` |
| `backend/app/media/regenerate.py` | 改 | 「缺中圖」原因、中圖一起重產 |
| `backend/app/content/routes.py:947-948` | 改 | 替換引用接受處理中的素材 |
| `backend/app/config.py` | 改 | `media_video_processing`、`media_jobs_poll_seconds` |
| `backend/app/main.py` | 改 | lifespan 啟停 `MediaJobLoop`、health 加 `media_jobs` |
| `backend/app/cli.py` | 改 | `transcode-media-videos [--apply]` |
| `backend/tests/conftest.py:124-145` | 改 | TRUNCATE 加 `media_jobs` |
| `backend/tests/test_media_jobs_schema.py`、`test_media_transcode.py`、`test_media_jobs.py`、`test_media_job_loop.py` | 新增 | 見各 Task |
| `backend/tests/test_media.py`、`test_media_variant_regeneration.py`、`test_media_library.py` | 改 | 影片衍生檔、中圖、替換引用 |
| `contracts/openapi.json`、`contracts/generated/website-api.d.ts` | 重產 | |
| `admin/src/api/types.ts:349`、`admin/src/api/client.ts:127`、`admin/src/api/errors.ts`、`admin/src/api/labels.ts` | 改 | 型別、錯誤碼、稽核動作名稱 |
| `admin/src/composables/mediaProcessing.ts` | 新增 | 狀態文案、能否重新處理、處理中輪詢 |
| `admin/src/views/MediaLibraryView.vue`、`components/MediaPickerDialog.vue`、`components/MediaSlotField.vue`、`components/MediaUploadList.vue`、`components/MediaReplaceDialog.vue` | 改 | 顯示與操作 |
| `admin/src/__tests__/mediaProcessing.test.ts`（新增）、`mediaLibrary.test.ts`、`mediaSlots.test.ts` | 測試 | |
| `web/app/utils/media-image.ts`、`web/app/utils/content-overlay.ts` | 改 | 衍生檔種類、影片版本選擇 |
| `web/tests/media-slots.spec.ts` | 改 | |
| `tests/stack/start-api.sh`、`tests/stack/media-video.spec.ts`（新增） | 改／新增 | stack 走背景模式並驗一支影片轉好 |
| `README.md`、`DESIGN.md`、`docs/website-admin/acceptance.md`、`docs/website-admin/operations.md`、`deploy/README.md` | 文件 | |

---

### Task 0: 開工準備

**Files:** 無程式變更。

- [ ] **Step 1: 確認沒有別的 session 在做同一件事**

```bash
git -C ~/Desktop/ivy-website-admin fetch origin --quiet
git -C ~/Desktop/ivy-website-admin worktree list
git -C ~/Desktop/ivy-website-admin log origin/main --oneline -15 -- backend/app/media admin/src/components/Media* admin/src/views/MediaLibraryView.vue
```
Expected：沒有標題含「背景轉檔」「media job」的提交，也沒有名稱含 `media-jobs` 的 worktree。若 log 出現「後台 UX 第八輪」已合併（選圖元件統一），記下來，Task 8 依設計決定 D12 改到共用元件。

- [ ] **Step 2: 開 sparse worktree**

```bash
WT=~/Desktop/ivy-website-media-jobs-20261003
git -C ~/Desktop/ivy-website-admin worktree add --no-checkout -b feature/media-jobs-20261003 "$WT" origin/main
git -C "$WT" sparse-checkout set --cone web backend admin content contracts tests deploy scripts docs .github
git -C "$WT" checkout
```
Expected：`git -C "$WT" status --short` 沒有輸出。

- [ ] **Step 3: 安裝依賴（自己的 venv 與 node_modules，不 symlink 別人的）**

```bash
cd ~/Desktop/ivy-website-media-jobs-20261003
(cd backend && uv sync --frozen)
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm ci; npm --prefix web ci; npm --prefix admin ci
```

- [ ] **Step 4: 建自己的測試庫並 migrate**

```bash
dropdb --if-exists ivy_website_mediajobs_test; createdb ivy_website_mediajobs_test
cd ~/Desktop/ivy-website-media-jobs-20261003/backend
export WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_mediajobs_test
WEBSITE_ENVIRONMENT=test uv run --frozen alembic upgrade head
uv run --frozen alembic heads
```
Expected：`alembic heads` 只有一行。記下 head（15fd9a5 時是 `4a7e2c9d1b63`），Task 1 的 `down_revision` 用它。

- [ ] **Step 5: 基準測試**

```bash
cd ~/Desktop/ivy-website-media-jobs-20261003/backend
export WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_mediajobs_test
uv run --frozen pytest -q tests/test_media.py tests/test_media_variant_regeneration.py tests/test_secfix_media.py
ffmpeg -hide_banner -filters | grep -E ' (zscale|tonemap) '
```
Expected：pytest 全過。`zscale` 本機多半沒有（只有 `tonemap`），Task 2 會測兩種情形。

之後每個 Task 的 pytest 指令都假設已 `export WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_mediajobs_test`。

---

### Task 1: 資料表與衍生檔種類

**Files:**
- Create: `backend/migrations/versions/e5b9c3a7d214_media_jobs_and_video_editions.py`
- Modify: `backend/app/media/models.py`
- Modify: `backend/tests/conftest.py:124-145`（TRUNCATE 清單）
- Test: `backend/tests/test_media_jobs_schema.py`

**Interfaces:**
- Produces: `VariantKind.MEDIUM = "medium"`、`VariantKind.VIDEO_DESKTOP = "video_desktop"`、`VariantKind.VIDEO_MOBILE = "video_mobile"`；`MediaJobKind.PROCESS = "process"`、`MediaJobKind.BACKFILL = "backfill"`；`MediaJobStatus.PENDING/RUNNING/DONE/FAILED`（值為小寫字串）；`MediaJob` ORM（欄位 `id, media_id, kind, status, attempts, next_attempt_at, leased_by, leased_until, error, created_by, created_at, finished_at`，`kind`／`status` 存字串值）。

- [ ] **Step 1: 寫失敗測試**

`backend/tests/test_media_jobs_schema.py`：

```python
"""素材背景處理的資料表與衍生檔種類（migration e5b9c3a7d214）。"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.media.models import MediaAsset, MediaJob, MediaJobKind, MediaJobStatus, MediaKind, MediaStatus


def _video(storage_key: str) -> MediaAsset:
    return MediaAsset(
        id=uuid.uuid4(), campus_key="yihua", kind=MediaKind.VIDEO, status=MediaStatus.PROCESSING,
        storage_key=storage_key, original_filename="clip.mp4", content_type="video/mp4", size_bytes=10,
        created_at=datetime.now(timezone.utc),
    )


def _job(media_id: uuid.UUID, status: MediaJobStatus = MediaJobStatus.PENDING) -> MediaJob:
    now = datetime.now(timezone.utc)
    return MediaJob(
        id=uuid.uuid4(), media_id=media_id, kind=MediaJobKind.PROCESS.value, status=status.value,
        attempts=0, next_attempt_at=now, created_at=now,
    )


@pytest.mark.asyncio
async def test_variant_kind_enum_has_new_values(db_session):
    rows = (await db_session.execute(text("SELECT unnest(enum_range(NULL::media_variant_kind))::text"))).scalars().all()
    assert {"THUMBNAIL", "POSTER", "LARGE", "MEDIUM", "VIDEO_DESKTOP", "VIDEO_MOBILE"} <= set(rows)


@pytest.mark.asyncio
async def test_only_one_active_job_per_media(db_session):
    asset = _video("schema-a.mp4")
    db_session.add(asset)
    await db_session.flush()
    db_session.add(_job(asset.id))
    await db_session.flush()
    # 已完成的工作不算：同一支影片可以有很多筆歷史。
    db_session.add(_job(asset.id, MediaJobStatus.DONE))
    await db_session.flush()
    db_session.add(_job(asset.id, MediaJobStatus.RUNNING))
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


@pytest.mark.asyncio
async def test_jobs_are_deleted_with_their_media(db_session):
    asset = _video("schema-b.mp4")
    db_session.add(asset)
    await db_session.flush()
    db_session.add(_job(asset.id))
    await db_session.commit()
    await db_session.execute(text("DELETE FROM media_assets WHERE id = :id"), {"id": asset.id})
    await db_session.commit()
    left = (await db_session.execute(text("SELECT count(*) FROM media_jobs"))).scalar_one()
    assert left == 0
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd backend && uv run --frozen pytest -q tests/test_media_jobs_schema.py`
Expected: FAIL，`ImportError: cannot import name 'MediaJob'`。

- [ ] **Step 3: models.py**

在 `backend/app/media/models.py`：import 改成

```python
from sqlalchemy import JSON, CheckConstraint, DateTime, Enum, Float, ForeignKey, Index, Integer, String, text
```

`VariantKind` 換成：

```python
class VariantKind(str, enum.Enum):
    # 圖片：長邊 480 的縮圖（每張都有）、長邊 960 的中圖與長邊 1600 的大圖（原圖
    # 更大時才有）。影片：抽一格做成的 poster（長邊 480，後台列表與沒設封面時的
    # 預設），以及背景轉檔的桌機版／手機版 H.264 MP4（同解析度同構圖，手機版 CRF
    # 較高；2026-10-03，見 app/media/jobs.py）。
    THUMBNAIL = "thumbnail"
    POSTER = "poster"
    LARGE = "large"
    MEDIUM = "medium"
    VIDEO_DESKTOP = "video_desktop"
    VIDEO_MOBILE = "video_mobile"
```

檔尾加：

```python
class MediaJobKind(str, enum.Enum):
    # process：新上傳（或重新處理）的影片，做完 poster 與兩個轉檔版本素材才 ready。
    # backfill：既有 ready 影片補轉檔版本，素材狀態不動、失敗也不動素材。
    PROCESS = "process"
    BACKFILL = "backfill"


class MediaJobStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class MediaJob(Base):
    """素材背景處理工作（app/media/jobs.py）。認領方式跟 outbox 一樣：
    pending 且到了 next_attempt_at，或 running 但租約已過期（worker 消失）。
    同一個素材同時最多一筆 pending／running（uq_media_jobs_active）。"""

    __tablename__ = "media_jobs"
    __table_args__ = (
        CheckConstraint("kind IN ('process', 'backfill')", name="ck_media_jobs_kind"),
        CheckConstraint("status IN ('pending', 'running', 'done', 'failed')", name="ck_media_jobs_status"),
        Index(
            "uq_media_jobs_active", "media_id", unique=True,
            postgresql_where=text("status IN ('pending', 'running')"),
        ),
        Index("ix_media_jobs_due", "status", "next_attempt_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    media_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("media_assets.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=MediaJobStatus.PENDING.value)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    leased_by: Mapped[str | None] = mapped_column(String(128), nullable=True)
    leased_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 最近一次失敗的原因（給後台與指令列看，不含檔名）。
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```

- [ ] **Step 4: migration**

`backend/migrations/versions/e5b9c3a7d214_media_jobs_and_video_editions.py`（`down_revision` 用 Task 0 Step 4 記下的 head）：

```python
"""素材背景處理：media_jobs 表，衍生檔加中圖與桌機／手機影片版本

Revision ID: e5b9c3a7d214
Revises: 4a7e2c9d1b63
Create Date: 2026-10-03

1. `media_jobs`：影片 poster 與轉檔的背景工作（app/media/jobs.py）。同一個素材
   同時最多一筆 pending／running（部分唯一索引）。素材刪除時一起刪。
2. `media_variant_kind` 加 `MEDIUM`、`VIDEO_DESKTOP`、`VIDEO_MOBILE`。只新增
   enum 值與一張新表，不改既有資料，與上一版程式相容。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "e5b9c3a7d214"
down_revision = "4a7e2c9d1b63"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # PostgreSQL 12 起 ADD VALUE 可以在交易裡執行，只是同一個交易內不能使用新值；
    # 這個 migration 沒有用到它們。
    for value in ("MEDIUM", "VIDEO_DESKTOP", "VIDEO_MOBILE"):
        op.execute(f"ALTER TYPE media_variant_kind ADD VALUE IF NOT EXISTS '{value}'")
    op.create_table(
        "media_jobs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("media_id", sa.Uuid(), sa.ForeignKey("media_assets.id", ondelete="CASCADE"), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("leased_by", sa.String(length=128), nullable=True),
        sa.Column("leased_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.String(length=500), nullable=True),
        sa.Column("created_by", sa.Uuid(), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("kind IN ('process', 'backfill')", name="ck_media_jobs_kind"),
        sa.CheckConstraint("status IN ('pending', 'running', 'done', 'failed')", name="ck_media_jobs_status"),
    )
    op.create_index(
        "uq_media_jobs_active", "media_jobs", ["media_id"], unique=True,
        postgresql_where=sa.text("status IN ('pending', 'running')"),
    )
    op.create_index("ix_media_jobs_due", "media_jobs", ["status", "next_attempt_at"])


def downgrade() -> None:
    op.drop_index("ix_media_jobs_due", table_name="media_jobs")
    op.drop_index("uq_media_jobs_active", table_name="media_jobs")
    op.drop_table("media_jobs")
    # 新種類的衍生檔記錄拿掉（檔案留在儲存空間成為孤兒檔，舊版程式不認得它們）；
    # PostgreSQL 不能直接刪 enum 值，改重建型別（同 c4d8e2f6a913）。
    op.execute("DELETE FROM media_variants WHERE kind IN ('MEDIUM', 'VIDEO_DESKTOP', 'VIDEO_MOBILE')")
    op.execute("ALTER TYPE media_variant_kind RENAME TO media_variant_kind_old")
    op.execute("CREATE TYPE media_variant_kind AS ENUM ('THUMBNAIL', 'POSTER', 'LARGE')")
    op.execute(
        "ALTER TABLE media_variants ALTER COLUMN kind TYPE media_variant_kind "
        "USING kind::text::media_variant_kind"
    )
    op.execute("DROP TYPE media_variant_kind_old")
```

（UUID 欄位用 `sa.Uuid()`，與 `4a7e2c9d1b63_admissions.py:37` 相同。）

- [ ] **Step 5: conftest 清表**

`backend/tests/conftest.py` 的 TRUNCATE 字串，`"media_usages, media_variants, media_assets, "` 改成 `"media_jobs, media_usages, media_variants, media_assets, "`。

- [ ] **Step 6: migrate 並跑測試**

```bash
cd backend
WEBSITE_ENVIRONMENT=test uv run --frozen alembic upgrade head
uv run --frozen alembic heads
uv run --frozen pytest -q tests/test_media_jobs_schema.py tests/test_media.py
WEBSITE_ENVIRONMENT=test uv run --frozen alembic downgrade -1; WEBSITE_ENVIRONMENT=test uv run --frozen alembic upgrade head
```
Expected：heads 一行 `e5b9c3a7d214 (head)`；pytest 全過；downgrade／upgrade 都成功。

- [ ] **Step 7: Commit**

```bash
git add backend/migrations/versions/e5b9c3a7d214_media_jobs_and_video_editions.py backend/app/media/models.py backend/tests/conftest.py backend/tests/test_media_jobs_schema.py
git commit -m "feat(media): 新增素材背景工作表與中圖、桌機／手機影片衍生檔種類

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 中圖與轉檔函式

**Files:**
- Modify: `backend/app/media/processing.py`
- Modify: `backend/app/media/service.py:150-156`（`image_renditions`）
- Modify: `backend/app/media/regenerate.py:40-75`
- Test: `backend/tests/test_media_transcode.py`（新增）、`backend/tests/test_media_variant_regeneration.py`、`backend/tests/test_media.py`

**Interfaces:**
- Consumes: Task 1 的 `VariantKind.MEDIUM`。
- Produces（`app/media/processing.py`）：
  - `MEDIUM_SIDE = 960`；`needs_medium_rendition(width: int | None, height: int | None) -> bool`
  - `class ProcessingError(Exception)`：`__init__(self, message: str, *, retryable: bool = False)`，屬性 `retryable: bool`
  - `TRANSCODE_MAX_SIDE = 1920`、`TRANSCODE_MAX_FPS = 30`、`TRANSCODE_CRF = {"desktop": 20, "mobile": 26}`、`TRANSCODE_PRESET = "medium"`、`TRANSCODE_THREADS = 2`、`TRANSCODE_MAX_SECONDS = 600`、`TRANSCODE_CONCURRENCY = 1`
  - `@dataclass(frozen=True) class VideoColor: transfer: str | None; primaries: str | None`，property `is_hdr -> bool`
  - `probe_video_color(video_path: Path) -> VideoColor`
  - `tonemap_available() -> bool`（`functools.lru_cache`）
  - `transcode_timeout(duration: float | None) -> int`
  - `transcode_args(source: Path, target: Path, edition: str, color: VideoColor, *, tonemap: bool) -> list[str]`
  - `transcode_video(source: Path, target: Path, edition: str, color: VideoColor, duration: float | None) -> VideoProbe`（寫到 `target`，回傳輸出檔的 ffprobe 結果）
  - `async def run_transcode_job(func, /, *args)`

- [ ] **Step 1: 寫失敗測試**

`backend/tests/test_media_transcode.py`：

```python
"""影片轉檔函式（app/media/processing.py，2026-10-03）。"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from app.media import processing
from app.media.processing import VideoColor

requires_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="轉檔需要 ffmpeg")


def _make(path: Path, size: str, *, seconds: int = 2, audio: bool = True) -> Path:
    args = ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"testsrc=s={size}:d={seconds}:r=60"]
    if audio:
        args += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={seconds}", "-c:a", "aac", "-shortest"]
    args += ["-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)]
    subprocess.run(args, check=True, capture_output=True, timeout=120)
    return path


def _probe(path: Path) -> dict:
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
        check=True, capture_output=True, timeout=30,
    ).stdout
    return json.loads(out)


def test_needs_medium_rendition_only_above_960():
    assert processing.needs_medium_rendition(961, 100) is True
    assert processing.needs_medium_rendition(960, 960) is False
    assert processing.needs_medium_rendition(None, None) is False


def test_transcode_args_are_guarded_and_drop_audio_and_metadata(tmp_path):
    argv = processing.transcode_args(tmp_path / "in.mp4", tmp_path / "out.mp4", "mobile", VideoColor(), tonemap=True)
    ffmpeg = argv[argv.index("ffmpeg"):]
    head = ffmpeg[: ffmpeg.index("-i")]
    assert "-nostdin" in head
    assert head[head.index("-protocol_whitelist") + 1] == "file"
    assert head[head.index("-f") + 1] == "mov"
    assert head[head.index("-max_pixels") + 1] == str(processing.MAX_IMAGE_PIXELS)
    assert "-an" in ffmpeg and ffmpeg[ffmpeg.index("-map_metadata") + 1] == "-1"
    assert ffmpeg[ffmpeg.index("-crf") + 1] == "26"
    assert ffmpeg[ffmpeg.index("-movflags") + 1] == "+faststart"
    assert "-ss" not in ffmpeg and "-t" not in ffmpeg
    assert "zscale" not in ffmpeg[ffmpeg.index("-vf") + 1]


def test_hdr_is_tonemapped_only_when_zscale_exists(tmp_path):
    hdr = VideoColor(transfer="arib-std-b67", primaries="bt2020")
    with_zscale = processing.transcode_args(tmp_path / "a", tmp_path / "b", "desktop", hdr, tonemap=True)
    without = processing.transcode_args(tmp_path / "a", tmp_path / "b", "desktop", hdr, tonemap=False)
    assert with_zscale[with_zscale.index("-vf") + 1].startswith("zscale=")
    assert "zscale" not in without[without.index("-vf") + 1]
    assert hdr.is_hdr and not VideoColor(transfer="bt709").is_hdr


def test_transcode_timeout_bounds():
    assert processing.transcode_timeout(None) == 1800
    assert processing.transcode_timeout(5) == 120
    assert processing.transcode_timeout(100) == 600
    assert processing.transcode_timeout(1000) == 1800


def test_too_long_video_is_rejected_before_running_ffmpeg(tmp_path, monkeypatch):
    monkeypatch.setattr(processing.subprocess, "run", lambda *a, **k: pytest.fail("不該執行 ffmpeg"))
    with pytest.raises(processing.ProcessingError, match="10 分鐘") as caught:
        processing.transcode_video(tmp_path / "in.mp4", tmp_path / "out.mp4", "desktop", VideoColor(), 601)
    assert caught.value.retryable is False


def test_ffmpeg_timeout_is_retryable(tmp_path, monkeypatch):
    def _timeout(argv, **kwargs):
        raise subprocess.TimeoutExpired(argv, kwargs.get("timeout"))

    monkeypatch.setattr(processing.subprocess, "run", _timeout)
    with pytest.raises(processing.ProcessingError) as caught:
        processing.transcode_video(tmp_path / "in.mp4", tmp_path / "out.mp4", "desktop", VideoColor(), 10)
    assert caught.value.retryable is True


@requires_ffmpeg
def test_transcode_keeps_duration_and_drops_audio(tmp_path):
    source = _make(tmp_path / "in.mp4", "320x240", seconds=2, audio=True)
    target = tmp_path / "out.mp4"
    result = processing.transcode_video(source, target, "mobile", processing.probe_video_color(source), 2.0)
    info = _probe(target)
    streams = info["streams"]
    assert [s["codec_type"] for s in streams] == ["video"]
    assert streams[0]["codec_name"] == "h264" and streams[0]["pix_fmt"] == "yuv420p"
    assert abs(float(info["format"]["duration"]) - 2.0) < 0.1
    # 60fps 來源降到 30fps。
    assert streams[0]["r_frame_rate"] == "30/1"
    data = target.read_bytes()
    assert data.index(b"moov") < data.index(b"mdat")  # faststart
    assert (result.width, result.height) == (320, 240)


@requires_ffmpeg
def test_transcode_scales_long_side_to_1920(tmp_path):
    source = _make(tmp_path / "wide.mp4", "2400x1200", seconds=1, audio=False)
    result = processing.transcode_video(source, tmp_path / "out.mp4", "desktop", VideoColor(), 1.0)
    assert (result.width, result.height) == (1920, 960)
```

`backend/tests/test_media.py` 加：

```python
@pytest.mark.asyncio
async def test_large_image_gets_medium_and_large_variants(admin_client, tmp_path):
    from PIL import Image

    path = tmp_path / "big.jpg"
    Image.new("RGB", (2000, 1500), (78, 184, 122)).save(path, "JPEG")
    response = await admin_client.post(
        "/api/website/v1/admin/media",
        data={"kind": "image", "campus_key": "yihua"},
        files={"file": ("big.jpg", path.read_bytes(), "image/jpeg")},
    )
    assert response.status_code == 201, response.text
    sizes = {v["kind"]: (v["width"], v["height"]) for v in response.json()["variants"]}
    assert sizes == {"thumbnail": (480, 360), "medium": (960, 720), "large": (1600, 1200)}
```

`backend/tests/test_media_variant_regeneration.py` 加（用檔內既有的 `_jpeg`、`_upload`、`_variants`，`:46-59`）：

```python
@pytest.mark.asyncio
async def test_missing_medium_is_a_candidate_and_gets_regenerated(app, admin_client, db_session):
    from sqlalchemy import delete

    from app.media import regenerate
    from app.media.models import MediaVariant, VariantKind

    body = await _upload(admin_client, _jpeg(1200, 900), "mid.jpg", "image/jpeg")
    assert _variants(body) == {"thumbnail": (480, 360), "medium": (960, 720)}
    media_id = uuid.UUID(body["id"])
    # 模擬中圖上線前上傳的圖：只有縮圖。
    await db_session.execute(
        delete(MediaVariant).where(MediaVariant.media_id == media_id, MediaVariant.kind == VariantKind.MEDIUM)
    )
    await db_session.commit()
    reasons = {c.asset_id: c.reasons for c in await regenerate.find_candidates(db_session)}
    assert reasons[media_id] == [regenerate.REASON_NO_MEDIUM]
    storage = service.get_storage(app.state.settings)
    await regenerate.regenerate_image_variants(db_session, storage, media_id)
    await db_session.commit()
    after = (await admin_client.get(f"{MEDIA}/{media_id}")).json()
    assert _variants(after) == {"thumbnail": (480, 360), "medium": (960, 720)}
```

（`MEDIA`、`service`、`uuid` 該檔已 import；沒有的話補上。）

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd backend && uv run --frozen pytest -q tests/test_media_transcode.py tests/test_media.py::test_large_image_gets_medium_and_large_variants tests/test_media_variant_regeneration.py`
Expected: FAIL（`AttributeError: module 'app.media.processing' has no attribute 'needs_medium_rendition'` 等）。

- [ ] **Step 3: processing.py**

1. import 加 `functools`、`shutil`。
2. `LARGE_SIDE = 1600` 下面加：

```python
# 中圖：手機 2 倍螢幕滿版約 780px，只有 480 與 1600 時只能拿 1600（2026-10-03）。
MEDIUM_SIDE = 960
```

3. `ProcessingError` 換成：

```python
class ProcessingError(Exception):
    """素材處理失敗。retryable：逾時、ffmpeg 無法執行這類「晚點再試可能就好」的
    失敗；影片本身解不開，重試也沒用，背景處理直接標成失敗。"""

    def __init__(self, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable
```

4. `extract_video_poster` 的兩個 except 改成可重試：

```python
        except subprocess.TimeoutExpired as exc:
            raise ProcessingError("ffmpeg 抽幀逾時（30 秒）", retryable=True) from exc
        except OSError as exc:
            raise ProcessingError(f"無法執行 ffmpeg：{exc}", retryable=True) from exc
```

5. `needs_large_rendition` 上面加：

```python
def needs_medium_rendition(width: int | None, height: int | None) -> bool:
    """原圖長邊超過 MEDIUM_SIDE 才另存中圖。"""
    return max(width or 0, height or 0) > MEDIUM_SIDE
```

6. 檔尾加轉檔段：

```python
# ---- 影片轉檔（2026-10-03，背景處理用，見 app/media/jobs.py） ----
# 官網影片版位（首屏、孩子的一天、活動影片）一律靜音播放，轉檔版本不帶聲音。
# 桌機、手機同解析度同構圖，手機只把 CRF 拉高（web/app/utils/media-policy.ts、
# DESIGN.md「孩子的一天」影片）。參數改這裡；後台說明與文件寫的數字跟著改。
TRANSCODE_MAX_SIDE = 1920
TRANSCODE_MAX_FPS = 30
TRANSCODE_CRF = {"desktop": 20, "mobile": 26}
TRANSCODE_PRESET = "medium"
TRANSCODE_THREADS = 2
TRANSCODE_MAX_SECONDS = 600
# 一支影片可能轉好幾分鐘：另開一組名額，不佔上傳驗證、縮圖共用的 MEDIA_JOB_CONCURRENCY。
TRANSCODE_CONCURRENCY = 1
_HDR_TRANSFERS = frozenset({"smpte2084", "arib-std-b67"})
# 長邊縮到上限以內（不放大），寬高取偶數（yuv420p 的要求）。ffmpeg 轉檔預設依
# 顯示矩陣自動轉正，這裡的 iw／ih 已經是轉正後的寬高。
_SCALE_FILTER = (
    f"scale=w='if(gte(iw,ih),min({TRANSCODE_MAX_SIDE},trunc(iw/2)*2),-2)'"
    f":h='if(gte(iw,ih),-2,min({TRANSCODE_MAX_SIDE},trunc(ih/2)*2))'"
)
# HDR（iPhone 預設錄 HLG／Dolby Vision）轉成 SDR，不然 8 位元 H.264 會灰白。要 zscale（libzimg）。
_TONEMAP_FILTER = (
    "zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,"
    "tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv"
)
# 轉檔讓給 API 請求：降低排程優先權（不用 preexec_fn，它在 thread 裡不安全）。
_NICE = ("nice", "-n", "10") if shutil.which("nice") else ()
_transcode_slots = ThreadSlots(TRANSCODE_CONCURRENCY)


async def run_transcode_job(func: Callable[..., _T], /, *args) -> _T:
    return await _transcode_slots.run(func, *args)


@dataclass(frozen=True)
class VideoColor:
    transfer: str | None = None
    primaries: str | None = None

    @property
    def is_hdr(self) -> bool:
        return self.transfer in _HDR_TRANSFERS


def probe_video_color(video_path: Path) -> VideoColor:
    """第一條影像軌的色彩轉換特性；讀不到就當成一般 SDR。"""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "error", *FFMPEG_INPUT_GUARD, "-select_streams", "v:0",
                "-show_entries", "stream=color_transfer,color_primaries", "-of", "json", str(video_path),
            ],
            capture_output=True,
            stdin=subprocess.DEVNULL,
            timeout=15,
        )
    except (OSError, subprocess.TimeoutExpired):
        return VideoColor()
    if result.returncode != 0:
        return VideoColor()
    try:
        streams = json.loads(result.stdout or b"{}").get("streams") or [{}]
    except ValueError:
        return VideoColor()
    stream = streams[0] if isinstance(streams[0], dict) else {}
    return VideoColor(transfer=stream.get("color_transfer") or None, primaries=stream.get("color_primaries") or None)


@functools.lru_cache(maxsize=1)
def tonemap_available() -> bool:
    try:
        result = subprocess.run(
            ["ffmpeg", "-hide_banner", "-filters"], capture_output=True, stdin=subprocess.DEVNULL, timeout=15
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    listed = result.stdout.decode("utf-8", errors="replace")
    return " zscale " in listed and " tonemap " in listed


def transcode_timeout(duration: float | None) -> int:
    """一個版本的轉檔上限秒數：影片長度的 6 倍，至少 2 分鐘、最多 30 分鐘；長度不明給上限。"""
    if not duration:
        return 1800
    return int(min(1800, max(120, duration * 6)))


def transcode_args(source: Path, target: Path, edition: str, color: VideoColor, *, tonemap: bool) -> list[str]:
    vf = _SCALE_FILTER
    if color.is_hdr and tonemap:
        vf = f"{_TONEMAP_FILTER},{vf}"
    return [
        *_NICE,
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error",
        *FFMPEG_INPUT_GUARD, "-max_pixels", str(MAX_IMAGE_PIXELS), "-i", str(source),
        "-map", "0:v:0", "-an", "-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1",
        "-vf", f"{vf},format=yuv420p",
        "-c:v", "libx264", "-preset", TRANSCODE_PRESET, "-crf", str(TRANSCODE_CRF[edition]),
        "-profile:v", "high", "-pix_fmt", "yuv420p", "-fpsmax", str(TRANSCODE_MAX_FPS),
        "-threads", str(TRANSCODE_THREADS), "-movflags", "+faststart",
        "-f", "mp4", "-y", str(target),
    ]


def transcode_video(source: Path, target: Path, edition: str, color: VideoColor, duration: float | None) -> VideoProbe:
    """轉成 H.264 MP4 寫到 target，回傳輸出檔的寬高與時長。不裁切、不改時間軸：
    活動影片的開始／結束秒數是對原片算的。"""
    if duration is not None and duration > TRANSCODE_MAX_SECONDS:
        raise ProcessingError(f"影片超過 {TRANSCODE_MAX_SECONDS // 60} 分鐘，請剪短後重新上傳")
    tonemap = color.is_hdr and tonemap_available()
    if color.is_hdr and not tonemap:
        logger.warning("ffmpeg 沒有 zscale，HDR 影片直接轉成 8 位元，顏色可能偏灰")
    timeout = transcode_timeout(duration)
    try:
        result = subprocess.run(
            transcode_args(source, target, edition, color, tonemap=tonemap),
            capture_output=True,
            stdin=subprocess.DEVNULL,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        target.unlink(missing_ok=True)
        raise ProcessingError(f"影片轉檔逾時（{timeout} 秒）", retryable=True) from exc
    except OSError as exc:
        raise ProcessingError(f"無法執行 ffmpeg：{exc}", retryable=True) from exc
    if result.returncode != 0 or not target.is_file() or target.stat().st_size == 0:
        target.unlink(missing_ok=True)
        detail = result.stderr.decode("utf-8", errors="replace")[-300:]
        raise ProcessingError(f"影片轉檔失敗：{detail}")
    return probe_video(target)
```

- [ ] **Step 4: service.image_renditions 加中圖**

`backend/app/media/service.py` 的 import 區塊從 `app.media.processing` 多 import `MEDIUM_SIDE, needs_medium_rendition`，`image_renditions` 換成：

```python
def image_renditions(
    source: bytes | Path, width: int | None, height: int | None, *, formats: tuple[str, ...] = IMAGE_FORMATS
) -> list[tuple[VariantKind, Rendition]]:
    out = [(VariantKind.THUMBNAIL, make_webp(source, THUMBNAIL_SIZE[0], formats=formats))]
    if needs_medium_rendition(width, height):
        out.append((VariantKind.MEDIUM, make_webp(source, MEDIUM_SIDE, quality=82, formats=formats)))
    if needs_large_rendition(width, height):
        out.append((VariantKind.LARGE, make_webp(source, LARGE_SIDE, quality=82, formats=formats)))
    return out
```

- [ ] **Step 5: regenerate.py 認得中圖**

`backend/app/media/regenerate.py`：import 多 `needs_medium_rendition`；`_IMAGE_VARIANTS = (VariantKind.THUMBNAIL, VariantKind.MEDIUM, VariantKind.LARGE)`；`REASON_NO_LARGE` 下面加 `REASON_NO_MEDIUM = "缺中圖"`；`_reasons` 在 `REASON_NO_LARGE` 判斷前加：

```python
    if VariantKind.MEDIUM not in kinds and needs_medium_rendition(asset.width, asset.height):
        reasons.append(REASON_NO_MEDIUM)
```

docstring 第一行改成「重新產生圖片素材的縮圖、中圖與大圖」。`cli.py` 的 `regenerate_media_variants` docstring 與 dry-run 那行「縮圖或大圖」改「縮圖、中圖或大圖」；`admin/src/api/labels.ts:464` 的 `'media.regenerate_variants'` 改 `'重新產生素材縮圖、中圖與大圖'`。

- [ ] **Step 6: 跑測試**

Run: `cd backend && uv run --frozen pytest -q tests/test_media_transcode.py tests/test_media.py tests/test_media_variant_regeneration.py tests/test_secfix_media.py`
Expected: PASS。`test_secfix_media.py::test_ffmpeg_and_ffprobe_restrict_demuxer_and_protocol` 只呼叫既有三個函式，不受影響。

- [ ] **Step 7: Commit**

```bash
git add backend/app/media/processing.py backend/app/media/service.py backend/app/media/regenerate.py backend/app/cli.py admin/src/api/labels.ts backend/tests/test_media_transcode.py backend/tests/test_media.py backend/tests/test_media_variant_regeneration.py
git commit -m "feat(media): 圖片多一個長邊 960 的中圖，新增影片轉檔函式（H.264、無聲、faststart）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 背景工作核心（`app/media/jobs.py`）

**Files:**
- Create: `backend/app/media/jobs.py`
- Test: `backend/tests/test_media_jobs.py`

**Interfaces:**
- Consumes: Task 1 `MediaJob*`、Task 2 `processing.transcode_video`／`probe_video_color`／`run_transcode_job`／`extract_video_poster`／`ProcessingError.retryable`。
- Produces（`app.media.jobs`）：
  - 常數 `LEASE_SECONDS = 120`、`HEARTBEAT_SECONDS = 30`、`MAX_ATTEMPTS = 3`、`INLINE_WORKER = "inline"`、`INTERRUPTED_MESSAGE`、`MISSING_ORIGINAL_MESSAGE`
  - `class JobAlreadyActive(Exception)`
  - `@dataclass(frozen=True) class StoredVariant: kind: VariantKind; storage_key: str; content_type: str; width: int | None; height: int | None`
  - `@dataclass(frozen=True) class BackfillCandidate: asset_id: uuid.UUID; filename: str; campus_key: str | None; duration: float | None; missing: tuple[str, ...]`
  - `async def enqueue(db: AsyncSession, asset: MediaAsset, kind: MediaJobKind, *, created_by: uuid.UUID | None = None, now: datetime | None = None) -> MediaJob`（同素材已有 pending／running 時丟 `JobAlreadyActive`，外層交易不受影響）
  - `async def claim_next(db: AsyncSession, worker_id: str, *, now: datetime | None = None) -> MediaJob | None`（呼叫端 commit）
  - `async def run_claimed(session_factory, storage: MediaStorage, job_id: uuid.UUID, *, worker_id: str) -> str`（回 `"done" | "retry" | "failed" | "lost"`）
  - `async def process_next(session_factory, storage, *, worker_id: str) -> str | None`（沒有工作回 None）
  - `async def process_now(db: AsyncSession, storage, asset: MediaAsset, job: MediaJob) -> str`（在呼叫端交易內做完；回 `"done" | "failed"`；呼叫端 commit）
  - `async def extend_lease(session_factory, job_id, worker_id) -> bool`
  - `async def release(session_factory, job_id, worker_id) -> bool`
  - `async def retry(db: AsyncSession, asset: MediaAsset, *, actor_id: uuid.UUID | None) -> MediaJob`
  - `async def backfill_candidates(db: AsyncSession) -> list[BackfillCandidate]`
  - `async def enqueue_backfill(db: AsyncSession, asset_ids: list[uuid.UUID], *, created_by: uuid.UUID | None = None) -> list[MediaJob]`

這個 Task 的測試不經過上傳路由（上傳要到 Task 4 才會排工作），直接在 DB 建「已存好乾淨原檔、狀態 processing」的影片。

- [ ] **Step 1: 寫失敗測試**

`backend/tests/test_media_jobs.py`：

```python
"""素材背景處理（app/media/jobs.py）：認領、租約、完成、失敗與重試、回補。"""
from __future__ import annotations

import shutil
import subprocess
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload

from app.media import jobs, processing, service
from app.media.models import (
    MediaAsset, MediaJob, MediaJobKind, MediaJobStatus, MediaKind, MediaStatus, MediaVariant, VariantKind,
)
from app.media.processing import ProcessingError, VideoProbe
from tests.test_secfix_media import _ffprobe, _make_tagged_video, _rotation

requires_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="需要 ffmpeg")
# 樣本影片由 conftest 的 _ensure_media_fixtures 用 ffmpeg 產生；沒有 ffmpeg 就整檔跳過
# （CI 有裝，website.yml:97-98）。
pytestmark = requires_ffmpeg
FIXTURE_MP4 = Path("/tmp/media-fixtures/test.mp4")


async def _stored_video(app, db, source: Path = FIXTURE_MP4, *, status=MediaStatus.PROCESSING,
                        kind=MediaJobKind.PROCESS) -> tuple[MediaAsset, MediaJob]:
    """模擬上傳請求做完的狀態：乾淨原檔已在儲存體、素材 processing、排了一筆工作。"""
    storage = service.get_storage(app.state.settings)
    key = storage.generate_key(".mp4")
    storage.write_file(key, source)
    probe = processing.probe_video(source)
    asset = MediaAsset(
        id=uuid.uuid4(), campus_key="yihua", kind=MediaKind.VIDEO, status=status, storage_key=key,
        original_filename="clip.mp4", content_type="video/mp4", size_bytes=source.stat().st_size,
        width=probe.width, height=probe.height, duration_seconds=probe.duration_seconds,
        created_at=datetime.now(timezone.utc),
    )
    db.add(asset)
    await db.flush()
    job = await jobs.enqueue(db, asset, kind)
    await db.commit()
    return asset, job


async def _reload(db, asset_id) -> MediaAsset:
    db.expire_all()
    result = await db.execute(select(MediaAsset).options(selectinload(MediaAsset.variants)).where(MediaAsset.id == asset_id))
    return result.scalar_one()


async def _job(db, job_id) -> MediaJob:
    db.expire_all()
    return (await db.execute(select(MediaJob).where(MediaJob.id == job_id))).scalar_one()


def _fake_transcode(source, target, edition, color, duration):
    shutil.copyfile(source, target)
    return VideoProbe(width=160, height=120, duration_seconds=duration)


@requires_ffmpeg
@pytest.mark.asyncio
async def test_process_next_makes_video_ready_with_poster_and_two_editions(app, db_session):
    asset, job = await _stored_video(app, db_session)
    storage = service.get_storage(app.state.settings)
    outcome = await jobs.process_next(app.state.session_factory, storage, worker_id="w1")
    assert outcome == "done"
    done = await _reload(db_session, asset.id)
    assert done.status == MediaStatus.READY and done.processing_error is None
    kinds = {v.kind: v for v in done.variants}
    assert set(kinds) == {VariantKind.POSTER, VariantKind.VIDEO_DESKTOP, VariantKind.VIDEO_MOBILE}
    assert kinds[VariantKind.VIDEO_MOBILE].content_type == "video/mp4"
    assert storage.exists(kinds[VariantKind.VIDEO_MOBILE].storage_key)
    finished = await _job(db_session, job.id)
    assert finished.status == MediaJobStatus.DONE.value and finished.leased_by is None
    assert await jobs.process_next(app.state.session_factory, storage, worker_id="w1") is None


@requires_ffmpeg
@pytest.mark.asyncio
async def test_editions_drop_location_tags_and_follow_rotation(app, db_session, tmp_path):
    tagged, rotated = _make_tagged_video(tmp_path)
    storage = service.get_storage(app.state.settings)
    clean = tmp_path / "clean.mp4"
    from app.media import metadata

    metadata.strip_video_file(tagged, clean)  # 上傳請求做的事
    asset, _ = await _stored_video(app, db_session, clean)
    assert await jobs.process_next(app.state.session_factory, storage, worker_id="w1") == "done"
    done = await _reload(db_session, asset.id)
    for variant in done.variants:
        if variant.kind not in (VariantKind.VIDEO_DESKTOP, VariantKind.VIDEO_MOBILE):
            continue
        out = tmp_path / f"{variant.kind.value}.mp4"
        storage.download_file(variant.storage_key, out)
        assert b"25.0330" not in out.read_bytes()
        info = _ffprobe(out)
        tags = {k.lower() for k in info["format"].get("tags", {})}
        assert not tags & {"location", "location-eng", "title", "creation_time"}
        if rotated:
            # 轉正後寫進畫面：沒有旋轉資訊，寬高對調。
            assert not _rotation(info)
            assert variant.width < variant.height


@pytest.mark.asyncio
async def test_retryable_failure_backs_off_then_marks_failed_and_keeps_original(app, db_session, monkeypatch):
    def _boom(*args):
        raise ProcessingError("影片轉檔逾時（120 秒）", retryable=True)

    monkeypatch.setattr(processing, "extract_video_poster", lambda path: processing.Rendition(b"x", 1, 1))
    monkeypatch.setattr(processing, "transcode_video", _boom)
    asset, job = await _stored_video(app, db_session)
    storage = service.get_storage(app.state.settings)
    factory = app.state.session_factory

    assert await jobs.process_next(factory, storage, worker_id="w1") == "retry"
    pending = await _job(db_session, job.id)
    assert pending.status == "pending" and pending.attempts == 1
    assert pending.next_attempt_at > datetime.now(timezone.utc) + timedelta(seconds=50)
    assert (await _reload(db_session, asset.id)).status == MediaStatus.PROCESSING

    for expected in ("retry", "failed"):
        await db_session.execute(update(MediaJob).where(MediaJob.id == job.id).values(next_attempt_at=datetime.now(timezone.utc)))
        await db_session.commit()
        assert await jobs.process_next(factory, storage, worker_id="w1") == expected

    failed = await _reload(db_session, asset.id)
    assert failed.status == MediaStatus.FAILED
    assert failed.processing_error == "影片轉檔逾時（120 秒）"
    assert failed.variants == []
    assert storage.exists(failed.storage_key)  # 原檔留著，可以重新處理
    assert (await _job(db_session, job.id)).status == "failed"


@pytest.mark.asyncio
async def test_non_retryable_failure_fails_at_once(app, db_session, monkeypatch):
    def _bad(*args):
        raise ProcessingError("影片轉檔失敗：Invalid data found")

    monkeypatch.setattr(processing, "extract_video_poster", lambda path: processing.Rendition(b"x", 1, 1))
    monkeypatch.setattr(processing, "transcode_video", _bad)
    asset, _ = await _stored_video(app, db_session)
    storage = service.get_storage(app.state.settings)
    assert await jobs.process_next(app.state.session_factory, storage, worker_id="w1") == "failed"
    assert (await _reload(db_session, asset.id)).status == MediaStatus.FAILED


@pytest.mark.asyncio
async def test_missing_original_fails_with_reupload_message(app, db_session):
    asset, _ = await _stored_video(app, db_session)
    storage = service.get_storage(app.state.settings)
    storage.delete(asset.storage_key)
    assert await jobs.process_next(app.state.session_factory, storage, worker_id="w1") == "failed"
    assert (await _reload(db_session, asset.id)).processing_error == jobs.MISSING_ORIGINAL_MESSAGE


@pytest.mark.asyncio
async def test_expired_lease_reclaim_counts_and_stops_after_max(app, db_session):
    asset, job = await _stored_video(app, db_session)
    past = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db_session.execute(
        update(MediaJob).where(MediaJob.id == job.id).values(status="running", leased_by="gone", leased_until=past, attempts=1)
    )
    await db_session.commit()
    async with app.state.session_factory() as db:
        claimed = await jobs.claim_next(db, "w2")
        assert claimed is not None and claimed.attempts == 2 and claimed.leased_by == "w2"
        await db.commit()

    await db_session.execute(
        update(MediaJob).where(MediaJob.id == job.id).values(leased_until=past)
    )
    await db_session.commit()
    async with app.state.session_factory() as db:
        assert await jobs.claim_next(db, "w3") is None  # 第 3 次中斷：不再認領
        await db.commit()
    failed = await _reload(db_session, asset.id)
    assert failed.status == MediaStatus.FAILED and failed.processing_error == jobs.INTERRUPTED_MESSAGE
    assert (await _job(db_session, job.id)).status == "failed"


@pytest.mark.asyncio
async def test_lost_lease_discards_results(app, db_session, monkeypatch):
    monkeypatch.setattr(processing, "extract_video_poster", lambda path: processing.Rendition(b"x", 1, 1))
    monkeypatch.setattr(processing, "transcode_video", _fake_transcode)
    asset, job = await _stored_video(app, db_session)
    storage = service.get_storage(app.state.settings)
    async with app.state.session_factory() as db:
        claimed = await jobs.claim_next(db, "w1")
        await db.commit()
    # 這台卡太久，租約被另一台接手。
    await db_session.execute(update(MediaJob).where(MediaJob.id == job.id).values(leased_by="w2"))
    await db_session.commit()
    before = set(Path(app.state.settings.media_root).iterdir())
    assert await jobs.run_claimed(app.state.session_factory, storage, claimed.id, worker_id="w1") == "lost"
    assert set(Path(app.state.settings.media_root).iterdir()) == before  # 寫好的衍生檔都刪掉
    still = await _reload(db_session, asset.id)
    assert still.status == MediaStatus.PROCESSING and still.variants == []


@pytest.mark.asyncio
async def test_lease_is_extended_while_running(app, db_session, monkeypatch):
    monkeypatch.setattr(jobs, "HEARTBEAT_SECONDS", 0.05)
    calls: list[uuid.UUID] = []
    real_extend = jobs.extend_lease

    async def _spy(factory, job_id, worker_id):
        calls.append(job_id)
        return await real_extend(factory, job_id, worker_id)

    def _slow(source, target, edition, color, duration):
        time.sleep(0.2)
        return _fake_transcode(source, target, edition, color, duration)

    monkeypatch.setattr(jobs, "extend_lease", _spy)
    monkeypatch.setattr(processing, "extract_video_poster", lambda path: processing.Rendition(b"x", 1, 1))
    monkeypatch.setattr(processing, "transcode_video", _slow)
    await _stored_video(app, db_session)
    storage = service.get_storage(app.state.settings)
    assert await jobs.process_next(app.state.session_factory, storage, worker_id="w1") == "done"
    assert len(calls) >= 2


@pytest.mark.asyncio
async def test_backfill_keeps_asset_ready_even_when_it_fails(app, db_session, monkeypatch):
    def _boom(*args):
        raise ProcessingError("影片轉檔失敗：壞掉")

    monkeypatch.setattr(processing, "transcode_video", _boom)
    asset, job = await _stored_video(app, db_session, status=MediaStatus.READY, kind=MediaJobKind.BACKFILL)
    storage = service.get_storage(app.state.settings)
    assert await jobs.process_next(app.state.session_factory, storage, worker_id="w1") == "failed"
    still = await _reload(db_session, asset.id)
    assert still.status == MediaStatus.READY and still.processing_error is None
    assert (await _job(db_session, job.id)).error == "影片轉檔失敗：壞掉"


@pytest.mark.asyncio
async def test_backfill_candidates_and_enqueue(app, db_session, monkeypatch):
    monkeypatch.setattr(processing, "transcode_video", _fake_transcode)
    asset, job = await _stored_video(app, db_session, status=MediaStatus.READY, kind=MediaJobKind.BACKFILL)
    # 已有排隊中的工作：不列為候選。
    assert [c.asset_id for c in await jobs.backfill_candidates(db_session)] == []
    storage = service.get_storage(app.state.settings)
    assert await jobs.process_next(app.state.session_factory, storage, worker_id="w1") == "done"
    done = await _reload(db_session, asset.id)
    # backfill 不做 poster（既有素材已有或另走 regenerate），只補兩個版本。
    assert {v.kind for v in done.variants} == {VariantKind.VIDEO_DESKTOP, VariantKind.VIDEO_MOBILE}
    assert await jobs.backfill_candidates(db_session) == []

    await db_session.execute(
        MediaVariant.__table__.delete().where(
            MediaVariant.media_id == asset.id, MediaVariant.kind == VariantKind.VIDEO_MOBILE
        )
    )
    await db_session.commit()
    candidates = await jobs.backfill_candidates(db_session)
    assert [(c.asset_id, c.missing) for c in candidates] == [(asset.id, ("video_mobile",))]
    queued = await jobs.enqueue_backfill(db_session, [asset.id, asset.id])
    await db_session.commit()
    assert len(queued) == 1  # 同一支只排一筆


@pytest.mark.asyncio
async def test_retry_requeues_failed_video_and_rejects_duplicates(app, db_session):
    asset, job = await _stored_video(app, db_session)
    await db_session.execute(update(MediaJob).where(MediaJob.id == job.id).values(status="failed"))
    await db_session.execute(update(MediaAsset).where(MediaAsset.id == asset.id).values(status=MediaStatus.FAILED, processing_error="壞掉"))
    await db_session.commit()
    fresh = await _reload(db_session, asset.id)
    new_job = await jobs.retry(db_session, fresh, actor_id=None)
    await db_session.commit()
    assert new_job.kind == "process"
    again = await _reload(db_session, asset.id)
    assert again.status == MediaStatus.PROCESSING and again.processing_error is None
    with pytest.raises(jobs.JobAlreadyActive):
        await jobs.retry(db_session, again, actor_id=None)
    await db_session.rollback()


@requires_ffmpeg
@pytest.mark.asyncio
async def test_process_now_runs_in_callers_transaction(app, db_session):
    asset, job = await _stored_video(app, db_session)
    storage = service.get_storage(app.state.settings)
    fresh = await _reload(db_session, asset.id)
    claimed = await _job(db_session, job.id)
    assert await jobs.process_now(db_session, storage, fresh, claimed) == "done"
    await db_session.commit()
    done = await _reload(db_session, asset.id)
    assert done.status == MediaStatus.READY and len(done.variants) == 3
```

`tests/test_secfix_media.py` 的 `_make_tagged_video`、`_ffprobe`、`_rotation` 是模組層級函式，直接 import；若 lint 規則不允許跨測試檔 import，把這三個搬到 `backend/tests/media_helpers.py` 再兩邊 import（同一個 commit）。

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd backend && uv run --frozen pytest -q tests/test_media_jobs.py`
Expected: FAIL，`ImportError: cannot import name 'jobs' from 'app.media'`。

- [ ] **Step 3: 實作 `backend/app/media/jobs.py`**

```python
"""素材背景處理（2026-10-03）：影片上傳後的 poster 與桌機／手機兩個 H.264 轉檔
版本，以及既有影片補轉檔（`python -m app.cli transcode-media-videos`）。

上傳請求只做驗證、去除拍攝資訊、ffprobe、配額與存檔（media/service.create_media_asset），
儲存體裡從頭到尾只有去掉拍攝資訊的檔案；這裡讀的是那份乾淨原檔。

認領沿用 outbox 的做法（workers/lease_service.py）：FOR UPDATE SKIP LOCKED 認領、
租約到期可被重新認領。轉檔可能跑好幾分鐘，執行期間每 HEARTBEAT_SECONDS 延長租約；
程序被砍掉時最多 LEASE_SECONDS 後由下一個 worker 接手，而且算一次嘗試——同一支
影片一直把程序弄掛時，MAX_ATTEMPTS 次就停。完成與失敗都比對 leased_by：租約已經
被別人接手，這次的結果整批丟掉。

本機開發、測試與指令列匯入用 process_now 在呼叫端交易裡直接做完（同一套產生函式）。
"""
from __future__ import annotations

import asyncio
import logging
import tempfile
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import selectinload

from app.media import processing
from app.media.models import (
    MediaAsset,
    MediaJob,
    MediaJobKind,
    MediaJobStatus,
    MediaKind,
    MediaStatus,
    MediaVariant,
    VariantKind,
)
from app.media.processing import ProcessingError
from app.media.storage import MediaFileMissing, MediaStorage

logger = logging.getLogger("app.media.jobs")

LEASE_SECONDS = 120
HEARTBEAT_SECONDS = 30
MAX_ATTEMPTS = 3
_BACKOFF_SECONDS = (60, 600)
INLINE_WORKER = "inline"
INTERRUPTED_MESSAGE = "處理中斷太多次（影片可能太大或太長），請剪短或降低解析度後重新上傳"
MISSING_ORIGINAL_MESSAGE = "儲存空間裡找不到原檔，請刪除這支影片後重新上傳"
_EDITIONS = (("desktop", VariantKind.VIDEO_DESKTOP), ("mobile", VariantKind.VIDEO_MOBILE))
_ACTIVE = (MediaJobStatus.PENDING.value, MediaJobStatus.RUNNING.value)


class JobAlreadyActive(Exception):
    """這個素材已經有排隊中或處理中的工作。"""


@dataclass(frozen=True)
class StoredVariant:
    kind: VariantKind
    storage_key: str
    content_type: str
    width: int | None
    height: int | None


@dataclass(frozen=True)
class BackfillCandidate:
    asset_id: uuid.UUID
    filename: str
    campus_key: str | None
    duration: float | None
    missing: tuple[str, ...]


@dataclass(frozen=True)
class _Snapshot:
    media_id: uuid.UUID
    kind: MediaKind
    storage_key: str
    duration: float | None
    existing: frozenset[VariantKind]


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _snapshot(asset: MediaAsset) -> _Snapshot:
    return _Snapshot(
        asset.id, asset.kind, asset.storage_key, asset.duration_seconds, frozenset(v.kind for v in asset.variants)
    )


async def enqueue(
    db: AsyncSession,
    asset: MediaAsset,
    kind: MediaJobKind,
    *,
    created_by: uuid.UUID | None = None,
    now: datetime | None = None,
) -> MediaJob:
    now = now or _now()
    job = MediaJob(
        id=uuid.uuid4(),
        media_id=asset.id,
        kind=kind.value,
        status=MediaJobStatus.PENDING.value,
        attempts=0,
        next_attempt_at=now,
        created_by=created_by,
        created_at=now,
    )
    # savepoint：撞到 uq_media_jobs_active 時只回滾這一筆，呼叫端的交易照常。
    try:
        async with db.begin_nested():
            db.add(job)
            await db.flush()
    except IntegrityError as exc:
        raise JobAlreadyActive() from exc
    return job


def _mark_failed(asset: MediaAsset | None, job: MediaJob, message: str, now: datetime) -> None:
    job.status = MediaJobStatus.FAILED.value
    job.error = message[:500]
    job.finished_at = now
    job.leased_by = None
    job.leased_until = None
    # backfill 失敗不動素材：既有影片照原檔播放。
    if asset is not None and job.kind == MediaJobKind.PROCESS.value:
        asset.status = MediaStatus.FAILED
        asset.processing_error = message[:500]


def _record_failure(asset: MediaAsset | None, job: MediaJob, message: str, *, retryable: bool, now: datetime) -> str:
    job.attempts += 1
    if retryable and job.attempts < MAX_ATTEMPTS:
        job.status = MediaJobStatus.PENDING.value
        job.error = message[:500]
        job.leased_by = None
        job.leased_until = None
        job.next_attempt_at = now + timedelta(seconds=_BACKOFF_SECONDS[min(job.attempts - 1, len(_BACKOFF_SECONDS) - 1)])
        return "retry"
    _mark_failed(asset, job, message, now)
    return "failed"


def _apply(asset: MediaAsset, job: MediaJob, outputs: list[StoredVariant], now: datetime) -> list[str]:
    """衍生檔記錄寫上素材；新上傳的標成可用。回傳因為已經有同種類而沒用到的檔案。"""
    have = {v.kind for v in asset.variants}
    unused: list[str] = []
    for out in outputs:
        if out.kind in have:
            unused.append(out.storage_key)
            continue
        asset.variants.append(
            MediaVariant(
                id=uuid.uuid4(),
                media_id=asset.id,
                kind=out.kind,
                storage_key=out.storage_key,
                content_type=out.content_type,
                width=out.width,
                height=out.height,
            )
        )
    if job.kind == MediaJobKind.PROCESS.value:
        asset.status = MediaStatus.READY
        asset.processing_error = None
    job.status = MediaJobStatus.DONE.value
    job.finished_at = now
    job.error = None
    job.leased_by = None
    job.leased_until = None
    return unused


async def _delete_files(storage: MediaStorage, keys: list[str]) -> None:
    for key in keys:
        try:
            await asyncio.to_thread(storage.delete, key)
        except Exception:  # noqa: BLE001 - 刪不掉只留下孤兒檔
            logger.warning("背景處理：刪除沒用到的衍生檔 %s 失敗，留下孤兒檔", key)


async def _produce(storage: MediaStorage, snap: _Snapshot, job_kind: MediaJobKind) -> list[StoredVariant]:
    """下載乾淨原檔 → poster（新上傳才做）＋缺少的轉檔版本 → 寫進儲存體。任何一步
    失敗（含被取消）就刪掉這次寫入的檔案再往外丟；DB 記錄由呼叫端寫。"""
    if snap.kind != MediaKind.VIDEO:
        raise ProcessingError("只有影片會排背景處理")
    written: list[StoredVariant] = []
    try:
        with tempfile.TemporaryDirectory(prefix="media-job-") as tmp:
            source = Path(tmp) / "source.mp4"
            try:
                await asyncio.to_thread(storage.download_file, snap.storage_key, source)
            except (MediaFileMissing, FileNotFoundError) as exc:
                raise ProcessingError(MISSING_ORIGINAL_MESSAGE) from exc
            if job_kind == MediaJobKind.PROCESS and VariantKind.POSTER not in snap.existing:
                poster = await processing.run_media_job(processing.extract_video_poster, source)
                key = storage.generate_key(".webp")
                await asyncio.to_thread(storage.write_bytes, key, poster.data)
                written.append(StoredVariant(VariantKind.POSTER, key, "image/webp", poster.width, poster.height))
            color = await processing.run_media_job(processing.probe_video_color, source)
            for edition, variant_kind in _EDITIONS:
                if variant_kind in snap.existing:
                    continue
                target = Path(tmp) / f"{edition}.mp4"
                video = await processing.run_transcode_job(
                    processing.transcode_video, source, target, edition, color, snap.duration
                )
                key = storage.generate_key(".mp4")
                await asyncio.to_thread(storage.write_file, key, target)
                written.append(StoredVariant(variant_kind, key, "video/mp4", video.width, video.height))
    except BaseException:
        await _delete_files(storage, [v.storage_key for v in written])
        raise
    return written


async def claim_next(db: AsyncSession, worker_id: str, *, now: datetime | None = None) -> MediaJob | None:
    """認領一筆該做的工作（呼叫端 commit）。租約過期的算一次中斷；中斷到第
    MAX_ATTEMPTS 次直接標失敗、改認領下一筆。"""
    now = now or _now()
    while True:
        result = await db.execute(
            select(MediaJob)
            .where(
                ((MediaJob.status == MediaJobStatus.PENDING.value) & (MediaJob.next_attempt_at <= now))
                | ((MediaJob.status == MediaJobStatus.RUNNING.value) & (MediaJob.leased_until < now))
            )
            .order_by(MediaJob.next_attempt_at, MediaJob.created_at)
            .limit(1)
            .with_for_update(skip_locked=True)
            .execution_options(populate_existing=True)
        )
        job = result.scalar_one_or_none()
        if job is None:
            return None
        if job.status == MediaJobStatus.RUNNING.value:
            job.attempts += 1
            if job.attempts >= MAX_ATTEMPTS:
                asset = await db.get(MediaAsset, job.media_id, with_for_update=True)
                _mark_failed(asset, job, INTERRUPTED_MESSAGE, now)
                logger.warning("背景處理：素材 %s 中斷 %s 次，標成失敗", job.media_id, job.attempts)
                await db.flush()
                continue
        job.status = MediaJobStatus.RUNNING.value
        job.leased_by = worker_id
        job.leased_until = now + timedelta(seconds=LEASE_SECONDS)
        await db.flush()
        return job


async def extend_lease(session_factory: async_sessionmaker[AsyncSession], job_id: uuid.UUID, worker_id: str) -> bool:
    async with session_factory() as db:
        result = await db.execute(
            update(MediaJob)
            .where(MediaJob.id == job_id, MediaJob.leased_by == worker_id, MediaJob.status == MediaJobStatus.RUNNING.value)
            .values(leased_until=_now() + timedelta(seconds=LEASE_SECONDS))
        )
        await db.commit()
        return result.rowcount == 1


async def release(session_factory: async_sessionmaker[AsyncSession], job_id: uuid.UUID, worker_id: str) -> bool:
    """程序要結束：做到一半的工作放回佇列（不算一次嘗試），下一個程序馬上接手。"""
    async with session_factory() as db:
        result = await db.execute(
            update(MediaJob)
            .where(MediaJob.id == job_id, MediaJob.leased_by == worker_id, MediaJob.status == MediaJobStatus.RUNNING.value)
            .values(status=MediaJobStatus.PENDING.value, leased_by=None, leased_until=None, next_attempt_at=_now())
        )
        await db.commit()
        return result.rowcount == 1


async def _keep_lease(session_factory, job_id: uuid.UUID, worker_id: str) -> None:
    while True:
        await asyncio.sleep(HEARTBEAT_SECONDS)
        try:
            await extend_lease(session_factory, job_id, worker_id)
        except Exception:  # noqa: BLE001 - DB 暫時連不上：下一次再延
            logger.warning("背景處理：延長租約失敗", exc_info=True)


async def _locked_job(db: AsyncSession, job_id: uuid.UUID, worker_id: str) -> MediaJob | None:
    job = await db.get(MediaJob, job_id, with_for_update=True, populate_existing=True)
    if job is None or job.status != MediaJobStatus.RUNNING.value or job.leased_by != worker_id:
        return None
    return job


async def _finish(session_factory, storage: MediaStorage, job_id: uuid.UUID, worker_id: str, outputs: list[StoredVariant]) -> str:
    keys = [o.storage_key for o in outputs]
    unused: list[str] = []
    try:
        async with session_factory() as db:
            job = await _locked_job(db, job_id, worker_id)
            if job is None:
                await db.rollback()
                await _delete_files(storage, keys)
                return "lost"
            result = await db.execute(
                select(MediaAsset)
                .options(selectinload(MediaAsset.variants))
                .where(MediaAsset.id == job.media_id)
                .with_for_update(of=MediaAsset)
            )
            asset = result.scalar_one_or_none()
            if asset is None:
                unused = keys
                job.status = MediaJobStatus.DONE.value
                job.finished_at = _now()
            else:
                unused = _apply(asset, job, outputs, _now())
            await db.commit()
    except Exception:
        await _delete_files(storage, keys)
        raise
    await _delete_files(storage, unused)
    return "done"


async def _fail(session_factory, job_id: uuid.UUID, worker_id: str, message: str, *, retryable: bool) -> str:
    async with session_factory() as db:
        job = await _locked_job(db, job_id, worker_id)
        if job is None:
            await db.rollback()
            return "lost"
        asset = await db.get(MediaAsset, job.media_id, with_for_update=True)
        outcome = _record_failure(asset, job, message, retryable=retryable, now=_now())
        await db.commit()
    if outcome == "failed":
        logger.warning("背景處理：工作 %s 失敗：%s", job_id, message)
    return outcome


async def run_claimed(session_factory, storage: MediaStorage, job_id: uuid.UUID, *, worker_id: str) -> str:
    async with session_factory() as db:
        job = await db.get(MediaJob, job_id)
        result = await db.execute(
            select(MediaAsset).options(selectinload(MediaAsset.variants)).where(MediaAsset.id == job.media_id)
        )
        asset = result.scalar_one_or_none()
        job_kind = MediaJobKind(job.kind)
        snap = _snapshot(asset) if asset is not None else None
        await db.rollback()
    if snap is None:
        return await _finish(session_factory, storage, job_id, worker_id, [])
    heartbeat = asyncio.create_task(_keep_lease(session_factory, job_id, worker_id))
    try:
        outputs = await _produce(storage, snap, job_kind)
    except ProcessingError as exc:
        return await _fail(session_factory, job_id, worker_id, str(exc), retryable=exc.retryable)
    except Exception as exc:  # noqa: BLE001 - 儲存體暫時錯誤等：下一次再試
        logger.exception("背景處理：素材 %s 發生未預期錯誤", snap.media_id)
        return await _fail(session_factory, job_id, worker_id, f"處理時發生錯誤（{type(exc).__name__}）", retryable=True)
    finally:
        heartbeat.cancel()
        await asyncio.gather(heartbeat, return_exceptions=True)
    return await _finish(session_factory, storage, job_id, worker_id, outputs)


async def process_next(session_factory, storage: MediaStorage, *, worker_id: str) -> str | None:
    async with session_factory() as db:
        job = await claim_next(db, worker_id)
        job_id = job.id if job is not None else None
        await db.commit()
    if job_id is None:
        return None
    return await run_claimed(session_factory, storage, job_id, worker_id=worker_id)


async def process_now(db: AsyncSession, storage: MediaStorage, asset: MediaAsset, job: MediaJob) -> str:
    """在呼叫端交易裡做完（本機開發、測試、指令列匯入；正式站走背景）。上傳的人
    正在等結果，失敗不排重試，直接標成處理失敗（原檔留著，可以重新處理）。"""
    await db.refresh(asset, attribute_names=["variants"])
    job.status = MediaJobStatus.RUNNING.value
    job.leased_by = INLINE_WORKER
    try:
        outputs = await _produce(storage, _snapshot(asset), MediaJobKind(job.kind))
    except ProcessingError as exc:
        _record_failure(asset, job, str(exc), retryable=False, now=_now())
        await db.flush()
        return "failed"
    unused = _apply(asset, job, outputs, _now())
    await db.flush()
    await _delete_files(storage, unused)
    return "done"


async def retry(db: AsyncSession, asset: MediaAsset, *, actor_id: uuid.UUID | None) -> MediaJob:
    """處理失敗的影片重新排入（呼叫端先檢查是失敗的影片、commit）。"""
    job = await enqueue(db, asset, MediaJobKind.PROCESS, created_by=actor_id)
    asset.status = MediaStatus.PROCESSING
    asset.processing_error = None
    await db.flush()
    return job


async def backfill_candidates(db: AsyncSession) -> list[BackfillCandidate]:
    """可用、沒有待清理、還缺轉檔版本、也沒有排隊中工作的影片（含已封存：可能被還原）。"""
    active = select(MediaJob.media_id).where(MediaJob.status.in_(_ACTIVE))
    result = await db.execute(
        select(MediaAsset)
        .options(selectinload(MediaAsset.variants))
        .where(
            MediaAsset.kind == MediaKind.VIDEO,
            MediaAsset.status == MediaStatus.READY,
            MediaAsset.deleted_at.is_(None),
            MediaAsset.id.not_in(active),
        )
        .order_by(MediaAsset.created_at, MediaAsset.id)
    )
    out: list[BackfillCandidate] = []
    for asset in result.scalars():
        have = {v.kind for v in asset.variants}
        missing = tuple(kind.value for _, kind in _EDITIONS if kind not in have)
        if missing:
            out.append(BackfillCandidate(asset.id, asset.original_filename, asset.campus_key, asset.duration_seconds, missing))
    return out


async def enqueue_backfill(
    db: AsyncSession, asset_ids: list[uuid.UUID], *, created_by: uuid.UUID | None = None
) -> list[MediaJob]:
    queued: list[MediaJob] = []
    for asset_id in dict.fromkeys(asset_ids):
        asset = await db.get(MediaAsset, asset_id)
        if asset is None:
            continue
        try:
            queued.append(await enqueue(db, asset, MediaJobKind.BACKFILL, created_by=created_by))
        except JobAlreadyActive:
            continue
    return queued
```

- [ ] **Step 4: 跑測試**

Run: `cd backend && uv run --frozen pytest -q tests/test_media_jobs.py tests/test_media_jobs_schema.py`
Expected: PASS（ffmpeg 相關三項在沒有 ffmpeg 的機器 skip）。若 `test_lease_is_extended_while_running` 偶發不到 2 次，把 `_slow` 的 sleep 加到 0.3，不要放寬斷言。

- [ ] **Step 5: Commit**

```bash
git add backend/app/media/jobs.py backend/tests/test_media_jobs.py
git commit -m "feat(media): 素材背景工作的認領、租約、完成與失敗重試、回補

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 上傳、替換、匯入改排背景工作

**Files:**
- Modify: `backend/app/config.py`（`media_*` 設定附近，約 :74-82；property 放在 `background_jobs_interval` 旁）
- Modify: `backend/app/media/service.py:199-296`（`create_media_asset`）、`:548-581`（`replace_media_asset`）
- Modify: `backend/app/media/routes.py:179-186`（`VariantName`）、`:416-473`（上傳）、`:632-683`（替換）
- Modify: `backend/app/content/routes.py:947-948`
- Test: `backend/tests/test_media.py`、`backend/tests/test_media_jobs.py`（`test_media_library.py` 只跑回歸）

**Interfaces:**
- Consumes: Task 3 `jobs.enqueue`、`jobs.process_now`。
- Produces:
  - `Settings.media_video_processing: Literal["inline", "background"] | None`、`Settings.media_jobs_poll_seconds: int`、property `Settings.media_video_processing_mode -> Literal["inline", "background"]`
  - `service.create_media_asset(..., video_processing: Literal["inline", "background"] = "inline")`、`service.replace_media_asset(..., video_processing=...)`
  - `routes.VariantName = Literal["thumbnail", "poster", "large", "medium", "video_desktop", "video_mobile"]`

- [ ] **Step 1: 寫失敗測試**

`backend/tests/test_media.py`：把 `test_upload_real_video_succeeds_with_poster` 的最後兩行換成

```python
    assert {v["kind"] for v in body["variants"]} == {"poster", "video_desktop", "video_mobile"}
```

`backend/tests/test_media_jobs.py` 加（檔頭 import 補 `import pytest_asyncio`、`from app.main import create_app`、`from tests.conftest import _test_settings`）：

```python
@pytest_asyncio.fixture
async def bg_app():
    return create_app(_test_settings().model_copy(update={"media_video_processing": "background"}))


@pytest_asyncio.fixture
async def bg_admin(bg_app, db_session):
    # 照 conftest 的 admin_client（conftest.py:342-347），只是換成背景模式的 app。
    from app.auth.models import Role
    from tests.conftest import _create_user, _logged_in_client

    await _create_user(db_session, "bg-admin@ivy.example", "bg-admin-password-123", Role.SUPER_ADMIN)
    client = await _logged_in_client(bg_app, "bg-admin@ivy.example", "bg-admin-password-123")
    yield client
    await client.aclose()


CONTENT = "/api/website/v1/admin/content-items"


async def _hero_draft(client, media_id: str, expected_version: int = 0) -> dict:
    response = await client.post(
        f"{CONTENT}/home_hero/revisions",
        json={"expected_version": expected_version, "payload": {"eyebrow": "小標", "copy_lines": ["一"], "video_desktop": {"media_id": media_id}}},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_processing_mode_defaults():
    base = _test_settings()
    assert base.media_video_processing_mode == "inline"
    assert base.model_copy(update={"environment": "production"}).media_video_processing_mode == "background"
    assert base.model_copy(update={"media_video_processing": "background"}).media_video_processing_mode == "background"


@requires_ffmpeg
@pytest.mark.asyncio
async def test_background_upload_returns_processing_and_queues_one_job(bg_app, bg_admin, db_session):
    response = await bg_admin.post(
        "/api/website/v1/admin/media",
        data={"kind": "video", "campus_key": "yihua"},
        files={"file": ("test.mp4", FIXTURE_MP4.read_bytes(), "video/mp4")},
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["status"] == "processing" and body["variants"] == []
    assert body["duration_seconds"]  # ffprobe 仍在請求內做，片段秒數檢查才有長度
    queued = (await db_session.execute(select(MediaJob))).scalars().all()
    assert [(j.kind, j.status) for j in queued] == [("process", "pending")]
    # 後台看得到乾淨原檔（預覽），官網拿不到。
    assert (await bg_admin.get(f"/api/website/v1/admin/media/{body['id']}/file")).status_code == 200
    from httpx import ASGITransport, AsyncClient

    async with AsyncClient(transport=ASGITransport(app=bg_app), base_url="http://test") as anon:
        assert (await anon.get(f"/api/website/v1/public/media/{body['id']}/file")).status_code == 404

    storage = service.get_storage(bg_app.state.settings)
    assert await jobs.process_next(bg_app.state.session_factory, storage, worker_id="w1") == "done"
    ranged = await bg_admin.get(
        f"/api/website/v1/admin/media/{body['id']}/variants/video_mobile", headers={"Range": "bytes=0-99"}
    )
    assert ranged.status_code == 206 and ranged.headers["content-type"] == "video/mp4"


@requires_ffmpeg
@pytest.mark.asyncio
async def test_processing_video_can_be_drafted_but_not_published(bg_admin, db_session):
    upload = await bg_admin.post(
        "/api/website/v1/admin/media",
        data={"kind": "video"},
        files={"file": ("hero.mp4", FIXTURE_MP4.read_bytes(), "video/mp4")},
    )
    media_id = upload.json()["id"]
    draft = await _hero_draft(bg_admin, media_id)  # 存草稿不檢查素材狀態
    published = await bg_admin.post(
        f"{CONTENT}/home_hero/publish", json={"revision_id": draft["latest_revision"]["id"]}
    )
    assert published.status_code == 409
    assert published.json()["detail"]["code"] == "MEDIA_NOT_READY"


@requires_ffmpeg
@pytest.mark.asyncio
async def test_replace_references_accepts_processing_video(bg_admin, db_session):
    async def _upload() -> str:
        response = await bg_admin.post(
            "/api/website/v1/admin/media",
            data={"kind": "video"},
            files={"file": ("clip.mp4", FIXTURE_MP4.read_bytes(), "video/mp4")},
        )
        assert response.status_code == 201, response.text
        return response.json()["id"]

    old, new = await _upload(), await _upload()  # 背景模式：兩支都還在 processing
    draft = await _hero_draft(bg_admin, old)
    response = await bg_admin.post(
        f"/api/website/v1/admin/media/{old}/replace-references",
        json={"replacement_id": new, "items": [{"content_item_id": draft["id"], "expected_version": 1}]},
    )
    assert response.status_code == 200, response.text

    await db_session.execute(update(MediaAsset).where(MediaAsset.id == uuid.UUID(new)).values(status=MediaStatus.FAILED))
    await db_session.commit()
    rejected = await bg_admin.post(
        f"/api/website/v1/admin/media/{new}/replace-references",
        json={"replacement_id": old, "items": [{"content_item_id": draft["id"], "expected_version": 2}]},
    )
    assert rejected.status_code == 200, rejected.text  # 換回處理中的 old：可以
    failed_target = await bg_admin.post(
        f"/api/website/v1/admin/media/{old}/replace-references",
        json={"replacement_id": new, "items": [{"content_item_id": draft["id"], "expected_version": 3}]},
    )
    assert failed_target.status_code == 422
    assert failed_target.json()["detail"]["message"] == "替換用的素材處理失敗或已刪除"
```

（`draft["id"]` 是內容項 id、第一次存草稿後版本為 1，寫法同 `tests/test_media_library.py:350-356`。若 `_replace_invalid` 回的 detail 沒有 `message` 欄，改斷言 `code == "MEDIA_REPLACEMENT_INVALID"`，見同檔 `:418`。）

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd backend && uv run --frozen pytest -q tests/test_media.py::test_upload_real_video_succeeds_with_poster tests/test_media_jobs.py -k "mode or background or drafted or replace_references"`
Expected: FAIL（variants 只有 poster；`media_video_processing` 欄位不存在；替換回 422「替換用的素材還沒處理完成或已刪除」）。

- [ ] **Step 3: config.py**

`media_purge_delay_days` 下面加：

```python
    # 影片上傳後的 poster 與轉檔（app/media/jobs.py）：background＝交給 API 程序內的
    # 背景處理，上傳馬上回應「處理中」；inline＝在上傳請求裡做完。沒設時正式站
    # background、其他環境 inline（測試與本機開發上傳完就能用）。
    media_video_processing: Literal["inline", "background"] | None = None
    media_jobs_poll_seconds: int = Field(default=5, ge=1, le=300)
```

`background_jobs_interval` property 下面加：

```python
    @property
    def media_video_processing_mode(self) -> Literal["inline", "background"]:
        if self.media_video_processing is not None:
            return self.media_video_processing
        return "background" if self.environment == "production" else "inline"
```

- [ ] **Step 4: service.create_media_asset**

1. import 加 `from typing import Literal`、`from app.media import jobs as media_jobs`、`from app.media.models import MediaJobKind`（併進既有那行）。
2. 簽名加 `video_processing: Literal["inline", "background"] = "inline",`（放在 `quota_bytes` 後面）。
3. docstring 第一段改成：

```python
    """驗證 → 去除拍攝資訊 → 存檔 →（圖片）產生縮圖、中圖、大圖／（影片）排背景
    工作 → 寫入 metadata。上傳本體已經由路由邊收邊寫進暫存檔（source_path），這裡
    全程讀檔，影片不會整份進記憶體。

    存進儲存體的是去掉 EXIF／GPS 等拍攝資訊的複本（見 metadata 模組）：原檔會
    公開在官網上，所以這一步一定在請求裡、存檔之前做完，背景工作只讀這份乾淨檔。

    影片的 poster 與桌機／手機轉檔交給 app/media/jobs.py：video_processing 為
    background 時素材回傳時還是 processing，由 API 程序內的背景迴圈處理；inline
    時在這個交易裡直接做完（本機開發、測試、指令列匯入）。"""
```

4. `db.add(asset)` 與第一個 `await db.flush()` 之後、`written: list[str] = []` 之前插入：

```python
        if declared_kind == MediaKind.VIDEO:
            job = await media_jobs.enqueue(db, asset, MediaJobKind.PROCESS, created_by=created_by)
            if video_processing == "inline":
                await media_jobs.process_now(db, storage, asset, job)
            await db.flush()
            return asset
```

5. 圖片那段的 `_renditions(...)` 呼叫改成 `image_renditions`（影片不會再走到這裡），把 `_renditions` 函式刪掉：

```python
            renditions = await run_media_job(image_renditions, clean_path, width, height)
```

6. `replace_media_asset` 簽名加 `video_processing: Literal["inline", "background"] = "inline",`，並把它傳給 `create_media_asset(..., video_processing=video_processing)`。

- [ ] **Step 5: routes.py**

1. `VariantName = Literal["thumbnail", "poster", "large", "medium", "video_desktop", "video_mobile"]`。`_variant` 的 404 訊息「這個素材沒有這種縮圖」改「這個素材沒有這種衍生檔」。
2. `upload_media` 呼叫 `service.create_media_asset` 多帶 `video_processing=request.app.state.settings.media_video_processing_mode,`。
3. `replace_media` 呼叫 `service.replace_media_asset` 多帶同一個參數。
4. 兩支路由最後的 `await db.refresh(asset, attribute_names=["variants", "usages"])` 不用改（背景模式下 status 本來就是 processing）。

- [ ] **Step 6: 替換引用接受處理中**

`backend/app/content/routes.py:947-948` 換成：

```python
    # 處理中的影片可以先換進草稿（發布時 check_publishable 會擋到轉好為止）。
    if replacement.status == MediaStatus.FAILED or replacement.deleted_at is not None:
        raise _replace_invalid("替換用的素材處理失敗或已刪除")
```

`grep -rn "替換用的素材還沒處理完成" backend/tests admin/src` 有斷言舊字串的地方一起改成新字串。

- [ ] **Step 7: 匯入官網內建素材**

`backend/app/media/site_import.py:236` 呼叫 `create_media_asset` 不帶 `video_processing`（預設 inline，指令列就地做完），`asset.status.value != "ready"` 的判斷照舊成立。不用改程式；確認 `uv run --frozen pytest -q tests/test_media_slots.py` 仍過。

- [ ] **Step 8: 跑測試**

Run: `cd backend && uv run --frozen pytest -q tests/test_media.py tests/test_media_jobs.py tests/test_media_library.py tests/test_media_slots.py tests/test_secfix_media.py tests/test_media_s3.py`
Expected: PASS。

- [ ] **Step 9: Commit**

```bash
git add backend/app/config.py backend/app/media/service.py backend/app/media/routes.py backend/app/content/routes.py backend/tests/test_media.py backend/tests/test_media_jobs.py
git commit -m "feat(media): 影片上傳改排背景轉檔，處理中的影片可先放進草稿

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: API 程序內的背景迴圈、health、stack 設定

**Files:**
- Create: `backend/app/workers/media_loop.py`
- Modify: `backend/app/main.py:126-147`（lifespan）、`:183-199`（health）、`create_app` 裡 `app.state.maintenance = None` 旁
- Modify: `tests/stack/start-api.sh:38` 附近
- Create: `tests/stack/media-video.spec.ts`
- Test: `backend/tests/test_media_job_loop.py`

**Interfaces:**
- Consumes: Task 3 `jobs.claim_next`、`jobs.run_claimed`、`jobs.release`；Task 4 `Settings.media_video_processing_mode`、`media_jobs_poll_seconds`。
- Produces: `class MediaJobLoop(session_factory, settings, *, poll_seconds: float, worker_id: str | None = None)`，方法 `start()`、`async stop(*, timeout: float = 10.0)`，屬性 `last_processed_at: datetime | None`、`last_failed_at: datetime | None`；`app.state.media_jobs: MediaJobLoop | None`；health 多 `"media_jobs": {"enabled", "last_processed_at", "last_failed_at"}`。

- [ ] **Step 1: 寫失敗測試**

`backend/tests/test_media_job_loop.py`：

```python
"""API 程序內的素材背景迴圈（app/workers/media_loop.py）。"""
from __future__ import annotations

import asyncio
import shutil
import threading

import pytest
from sqlalchemy import select

from app.main import create_app
from app.media import processing
from app.media.models import MediaAsset, MediaJob, MediaStatus
from app.media.processing import VideoProbe
from app.workers.media_loop import MediaJobLoop
from tests.conftest import _test_settings
from tests.test_media_jobs import _stored_video, requires_ffmpeg

pytestmark = requires_ffmpeg


async def _wait_for(predicate, timeout: float = 5.0) -> None:
    deadline = asyncio.get_running_loop().time() + timeout
    while not await predicate():
        if asyncio.get_running_loop().time() > deadline:
            raise AssertionError("等不到預期狀態")
        await asyncio.sleep(0.05)


@pytest.mark.asyncio
async def test_loop_processes_queued_video(app, db_session, monkeypatch):
    monkeypatch.setattr(processing, "extract_video_poster", lambda path: processing.Rendition(b"x", 1, 1))
    monkeypatch.setattr(
        processing, "transcode_video",
        lambda s, t, e, c, d: (shutil.copyfile(s, t), VideoProbe(160, 120, d))[1],
    )
    asset, _ = await _stored_video(app, db_session)
    loop = MediaJobLoop(app.state.session_factory, app.state.settings, poll_seconds=0.05)
    loop.start()

    async def ready() -> bool:
        db_session.expire_all()
        return (await db_session.get(MediaAsset, asset.id)).status == MediaStatus.READY

    try:
        await _wait_for(ready)
    finally:
        await loop.stop()
    assert loop.last_processed_at is not None


@pytest.mark.asyncio
async def test_stop_puts_unfinished_job_back_without_counting(app, db_session, monkeypatch):
    started, finish = threading.Event(), threading.Event()

    def _blocking(source, target, edition, color, duration):
        started.set()
        finish.wait(5)
        shutil.copyfile(source, target)
        return VideoProbe(160, 120, duration)

    monkeypatch.setattr(processing, "extract_video_poster", lambda path: processing.Rendition(b"x", 1, 1))
    monkeypatch.setattr(processing, "transcode_video", _blocking)
    _, job = await _stored_video(app, db_session)
    loop = MediaJobLoop(app.state.session_factory, app.state.settings, poll_seconds=0.05)
    loop.start()
    await asyncio.to_thread(started.wait, 5)
    await loop.stop(timeout=0.1)
    finish.set()
    db_session.expire_all()
    back = (await db_session.execute(select(MediaJob).where(MediaJob.id == job.id))).scalar_one()
    assert (back.status, back.attempts, back.leased_by) == ("pending", 0, None)


@pytest.mark.asyncio
async def test_lifespan_starts_loop_only_in_background_mode():
    inline = create_app(_test_settings())
    async with inline.router.lifespan_context(inline):
        assert inline.state.media_jobs is None
    background = create_app(_test_settings().model_copy(update={"media_video_processing": "background"}))
    async with background.router.lifespan_context(background):
        assert isinstance(background.state.media_jobs, MediaJobLoop)


@pytest.mark.asyncio
async def test_health_reports_media_jobs():
    import httpx

    app = create_app(_test_settings())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        body = (await client.get("/api/website/v1/health")).json()
    assert body["media_jobs"] == {"enabled": False, "last_processed_at": None, "last_failed_at": None}
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd backend && uv run --frozen pytest -q tests/test_media_job_loop.py`
Expected: FAIL，`ModuleNotFoundError: No module named 'app.workers.media_loop'`。

- [ ] **Step 3: `backend/app/workers/media_loop.py`**

```python
"""API 程序內的素材背景處理迴圈（app/media/jobs.py）。

不併進 maintenance 的 run_cycle：那一輪持全域 advisory lock、每 60 秒一次，轉一支
影片可能要好幾分鐘，會讓排程發布與通知一起延後。這裡自己一個 asyncio task，一次
處理一件（轉檔本身另有 processing.TRANSCODE_CONCURRENCY 把關），做完馬上找下一件，
沒有工作時每 poll_seconds 看一次。停機時把做到一半的工作放回佇列，不算一次嘗試。"""
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.config import Settings
from app.media import jobs as media_jobs
from app.media.service import get_storage
from app.workers.maintenance import default_worker_id

logger = logging.getLogger("app.media.loop")


class MediaJobLoop:
    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession],
        settings: Settings,
        *,
        poll_seconds: float,
        worker_id: str | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._settings = settings
        self.poll_seconds = poll_seconds
        self.worker_id = worker_id or f"media-{default_worker_id()}"
        self.last_processed_at: datetime | None = None
        self.last_failed_at: datetime | None = None
        self._current_job_id: uuid.UUID | None = None
        self._stopping = asyncio.Event()
        self._task: asyncio.Task | None = None

    def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name="media-job-loop")

    async def stop(self, *, timeout: float = 10.0) -> None:
        self._stopping.set()
        if self._task is None:
            return
        try:
            await asyncio.wait_for(asyncio.shield(self._task), timeout=timeout)
        except asyncio.TimeoutError:
            interrupted = self._current_job_id
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
            if interrupted is not None:
                try:
                    await media_jobs.release(self._session_factory, interrupted, self.worker_id)
                except Exception:  # noqa: BLE001 - 放不回去就等租約過期
                    logger.warning("背景處理：停機時放回工作 %s 失敗", interrupted, exc_info=True)

    async def _sleep(self, seconds: float) -> bool:
        try:
            await asyncio.wait_for(self._stopping.wait(), timeout=seconds)
        except asyncio.TimeoutError:
            return True
        return False

    async def _process_one(self, storage) -> str | None:
        async with self._session_factory() as db:
            job = await media_jobs.claim_next(db, self.worker_id)
            job_id = job.id if job is not None else None
            await db.commit()
        if job_id is None:
            return None
        self._current_job_id = job_id
        try:
            return await media_jobs.run_claimed(self._session_factory, storage, job_id, worker_id=self.worker_id)
        finally:
            self._current_job_id = None

    async def _run(self) -> None:
        # 不跟啟動搶資源：健康檢查先過再開始。
        if not await self._sleep(min(self.poll_seconds, 5)):
            return
        storage = get_storage(self._settings)
        while not self._stopping.is_set():
            outcome: str | None = None
            try:
                outcome = await self._process_one(storage)
            except Exception:  # noqa: BLE001 - DB 暫時連不上等：下一輪再試
                logger.exception("背景處理：這一輪無法完成")
                self.last_failed_at = datetime.now(timezone.utc)
            if outcome == "done":
                self.last_processed_at = datetime.now(timezone.utc)
            elif outcome == "failed":
                self.last_failed_at = datetime.now(timezone.utc)
            if outcome is None and not await self._sleep(self.poll_seconds):
                return
```

- [ ] **Step 4: main.py**

1. import 加 `from app.workers.media_loop import MediaJobLoop`。
2. `create_app` 裡 `app.state.maintenance = None` 下一行加 `app.state.media_jobs = None`。
3. lifespan 的 `try:` 之前加：

```python
        # 影片 poster 與轉檔（app/media/jobs.py）；inline 模式在上傳請求裡做完，不必起迴圈。
        if settings.media_video_processing_mode == "background":
            app.state.media_jobs = MediaJobLoop(
                app.state.session_factory, settings, poll_seconds=settings.media_jobs_poll_seconds
            )
            app.state.media_jobs.start()
```

`finally:` 第一行加：

```python
            if app.state.media_jobs is not None:
                await app.state.media_jobs.stop()
```

4. health 的回傳 dict 在 `"background_jobs"` 後面加：

```python
            # 影片轉檔的背景迴圈：有沒有開、最近一次完成與失敗的時間。
            "media_jobs": {
                "enabled": app.state.media_jobs is not None,
                "last_processed_at": _iso(app.state.media_jobs.last_processed_at if app.state.media_jobs else None),
                "last_failed_at": _iso(app.state.media_jobs.last_failed_at if app.state.media_jobs else None),
            },
```

- [ ] **Step 5: stack 設定與 e2e**

`tests/stack/start-api.sh` 的 `export WEBSITE_BACKGROUND_JOBS_INTERVAL_SECONDS=10` 下面加：

```bash
# 影片上傳走正式站的背景轉檔路徑（app/media/jobs.py）；2 秒看一次佇列。
export WEBSITE_MEDIA_VIDEO_PROCESSING=background
export WEBSITE_MEDIA_JOBS_POLL_SECONDS=2
```

`tests/stack/media-video.spec.ts`（`gotoAdmin`、`storageStatePath` 用法照 `tests/stack/media.spec.ts:1-25`）：

```ts
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { gotoAdmin } from './pages'
import { storageStatePath } from './stack-env'

// 影片背景轉檔：上傳後卡片先顯示處理中，背景轉好後變成可用（正式站同一條路徑）。
test.use({ storageState: storageStatePath('super_admin') })

function tinyMp4(): Buffer {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'e2e-video-'))
  const file = path.join(dir, 'clip.mp4')
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=s=320x240:d=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file])
  return readFileSync(file)
}

test('素材庫上傳影片：先顯示轉檔中，轉好後變成可用', async ({ page }) => {
  test.setTimeout(90_000)
  await gotoAdmin(page, '/media', '素材庫')
  await page.getByRole('button', { name: '上傳素材' }).first().click()
  const dialog = page.getByRole('dialog', { name: '上傳素材' })
  await dialog.locator('input[type="file"]').setInputFiles({ name: 'e2e-clip.mp4', mimeType: 'video/mp4', buffer: tinyMp4() })
  await dialog.getByRole('button', { name: '上傳 1 個檔案' }).click()
  await expect(dialog.getByText('已上傳，轉檔中')).toBeVisible()
  await dialog.getByRole('button', { name: '關閉' }).click()
  const card = page.locator('article.media', { hasText: 'e2e-clip.mp4' })
  await expect(card.getByText(/轉檔中/)).toBeVisible()
  await expect(card.getByText(/轉檔中/)).toBeHidden({ timeout: 60_000 })
  await expect(card.locator('img')).toBeVisible()
})
```

（上傳完成後左邊的鈕文字是「關閉」，`MediaLibraryView.vue` 上傳對話框 `#footer`。）

- [ ] **Step 6: 跑測試**

Run: `cd backend && uv run --frozen pytest -q tests/test_media_job_loop.py tests/test_health.py tests/test_maintenance.py tests/test_secfix_platform.py`
Expected: PASS。stack 那支放到 Task 11 跟整套一起跑。

- [ ] **Step 7: Commit**

```bash
git add backend/app/workers/media_loop.py backend/app/main.py backend/tests/test_media_job_loop.py tests/stack/start-api.sh tests/stack/media-video.spec.ts
git commit -m "feat(media): API 程序內的影片轉檔背景迴圈，health 回報最近處理時間

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 「重新處理」API

**Files:**
- Modify: `backend/app/media/routes.py`（`replace_media` 前面加路由）
- Modify: `admin/src/api/labels.ts:454-465`（稽核動作名稱）、`admin/src/api/errors.ts:15` 附近（錯誤碼）
- Test: `backend/tests/test_media_jobs.py`

**Interfaces:**
- Consumes: Task 3 `jobs.retry`、`jobs.JobAlreadyActive`、`jobs.process_now`。
- Produces: `POST /api/website/v1/admin/media/{media_id}/retry` → 200 `MediaAssetOut`；409 `MEDIA_NOT_RETRYABLE`（不是處理失敗的影片或已刪除）、409 `MEDIA_ALREADY_PROCESSING`；稽核動作 `media.retry`。

- [ ] **Step 1: 寫失敗測試**

`backend/tests/test_media_jobs.py` 加：

```python
@pytest.mark.asyncio
async def test_retry_endpoint(bg_app, bg_admin, db_session):
    asset, job = await _stored_video(bg_app, db_session)
    url = f"/api/website/v1/admin/media/{asset.id}/retry"
    not_failed = await bg_admin.post(url)
    assert not_failed.status_code == 409 and not_failed.json()["detail"]["code"] == "MEDIA_NOT_RETRYABLE"

    await db_session.execute(update(MediaJob).where(MediaJob.id == job.id).values(status="failed"))
    await db_session.execute(update(MediaAsset).where(MediaAsset.id == asset.id).values(status=MediaStatus.FAILED, processing_error="壞掉"))
    await db_session.commit()
    ok = await bg_admin.post(url)
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "processing" and ok.json()["processing_error"] is None

    from app.operations.models import AuditLogEntry

    actions = (await db_session.execute(select(AuditLogEntry.action))).scalars().all()
    assert "media.retry" in actions

    await db_session.execute(update(MediaAsset).where(MediaAsset.id == asset.id).values(status=MediaStatus.FAILED))
    await db_session.commit()
    busy = await bg_admin.post(url)
    assert busy.status_code == 409 and busy.json()["detail"]["code"] == "MEDIA_ALREADY_PROCESSING"


@pytest.mark.asyncio
async def test_retry_is_only_for_videos(admin_client):
    image = await admin_client.post(
        "/api/website/v1/admin/media",
        data={"kind": "image", "campus_key": "yihua"},
        files={"file": ("test.jpg", Path("/tmp/media-fixtures/test.jpg").read_bytes(), "image/jpeg")},
    )
    response = await admin_client.post(f"/api/website/v1/admin/media/{image.json()['id']}/retry")
    assert response.status_code == 409
```

（`AuditLogEntry` 在 `app/operations/models.py:139`。）分校權限沿用 `_get_owned_asset`＋`_require_media_manage`（與替換相同），不另寫權限測試。

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd backend && uv run --frozen pytest -q tests/test_media_jobs.py -k retry`
Expected: FAIL（405 Method Not Allowed）。

- [ ] **Step 3: 路由**

`backend/app/media/routes.py`：import 加 `from app.media import jobs as media_jobs`；在 `replace_media` 上面加：

```python
@router.post("/{media_id}/retry", response_model=MediaAssetOut)
async def retry_media_processing(
    media_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> MediaAssetOut:
    """處理失敗的影片重新排入背景轉檔（原檔還在，不必重傳）。"""
    asset = await _get_owned_asset(db, current_user, media_id)
    _require_media_manage(current_user, asset.campus_key)
    if asset.kind != MediaKind.VIDEO or asset.status != MediaStatus.FAILED or asset.deleted_at is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "MEDIA_NOT_RETRYABLE", "message": "只有處理失敗的影片可以重新處理"},
        )
    try:
        job = await media_jobs.retry(db, asset, actor_id=current_user.id)
    except media_jobs.JobAlreadyActive as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "MEDIA_ALREADY_PROCESSING", "message": "這支影片已經在處理了"},
        ) from exc
    if request.app.state.settings.media_video_processing_mode == "inline":
        await media_jobs.process_now(db, service.get_storage(request.app.state.settings), asset, job)
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="media.retry",
        target_type="media_asset",
        target_id=str(asset.id),
        campus_key=asset.campus_key,
        metadata=_media_audit(asset),
    )
    await db.commit()
    await db.refresh(asset, attribute_names=["variants", "usages"])
    return await _asset_out(db, request, asset)
```

（`MediaStatus`、`MediaKind` 若 routes.py 尚未 import，從 `app.media.models` 補上。）

- [ ] **Step 4: 後台稽核名稱與錯誤碼**

`admin/src/api/labels.ts` 在 `'media.replace': '上傳新檔替換素材',` 下面加 `'media.retry': '重新處理影片',`。

`admin/src/api/errors.ts` 的 `ERROR_CODE_MESSAGES` 在 `MEDIA_NOT_READY` 下面加：

```ts
  MEDIA_NOT_RETRYABLE: '只有處理失敗的影片可以重新處理',
  MEDIA_ALREADY_PROCESSING: '這支影片已經在處理了',
```

- [ ] **Step 5: 跑測試**

```bash
cd backend && uv run --frozen pytest -q tests/test_media_jobs.py
cd ../admin; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npx vitest run src/__tests__/labelCoverage.test.ts
```
Expected: PASS（labelCoverage 會掃到新的 `log_action(action="media.retry")`）。

- [ ] **Step 6: Commit**

```bash
git add backend/app/media/routes.py backend/tests/test_media_jobs.py admin/src/api/labels.ts admin/src/api/errors.ts
git commit -m "feat(media): 處理失敗的影片可以重新處理，不必重傳

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 既有影片回補指令

**Files:**
- Modify: `backend/app/cli.py`（`strip_media_metadata` 後面加函式；`main()` 用法字串與分支）
- Modify: `admin/src/api/labels.ts`（稽核動作）
- Test: `backend/tests/test_media_jobs.py`

**Interfaces:**
- Consumes: Task 3 `jobs.backfill_candidates`、`jobs.enqueue_backfill`、`jobs.process_now`；Task 4 `media_video_processing_mode`。
- Produces: `async def transcode_media_videos(*, apply: bool) -> None`；指令 `python -m app.cli transcode-media-videos [--apply]`；稽核動作 `media.transcode_backfill`。

- [ ] **Step 1: 寫失敗測試**

```python
@pytest.mark.asyncio
async def test_transcode_media_videos_cli(app, db_session, monkeypatch, capsys):
    from app import cli

    monkeypatch.setattr(processing, "transcode_video", _fake_transcode)
    asset, job = await _stored_video(app, db_session, status=MediaStatus.READY, kind=MediaJobKind.BACKFILL)
    await db_session.execute(update(MediaJob).where(MediaJob.id == job.id).values(status="done"))
    await db_session.commit()

    async def factory():
        return app.state.session_factory

    monkeypatch.setattr(cli, "_session_factory", factory)

    background = app.state.settings.model_copy(update={"media_video_processing": "background"})
    monkeypatch.setattr(cli, "get_settings", lambda: background)
    await cli.transcode_media_videos(apply=False)
    out = capsys.readouterr().out
    assert "clip.mp4" in out and "dry-run" in out
    assert (await jobs.backfill_candidates(db_session))[0].asset_id == asset.id

    await cli.transcode_media_videos(apply=True)
    assert "已排入 1 支" in capsys.readouterr().out
    queued = (await db_session.execute(select(MediaJob).where(MediaJob.status == "pending"))).scalars().all()
    assert [j.kind for j in queued] == ["backfill"]

    await db_session.execute(update(MediaJob).where(MediaJob.status == "pending").values(status="done"))
    await db_session.commit()
    inline = app.state.settings.model_copy(update={"media_video_processing": "inline"})
    monkeypatch.setattr(cli, "get_settings", lambda: inline)
    await cli.transcode_media_videos(apply=True)
    done = await _reload(db_session, asset.id)
    assert {VariantKind.VIDEO_DESKTOP, VariantKind.VIDEO_MOBILE} <= {v.kind for v in done.variants}
    assert done.status == MediaStatus.READY
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd backend && uv run --frozen pytest -q tests/test_media_jobs.py::test_transcode_media_videos_cli`
Expected: FAIL，`AttributeError: module 'app.cli' has no attribute 'transcode_media_videos'`。

- [ ] **Step 3: cli.py**

`strip_media_metadata` 函式後面加：

```python
async def transcode_media_videos(*, apply: bool) -> None:
    """既有影片補桌機／手機轉檔版本（app/media/jobs.py）。預設只列出會處理哪些；
    --apply 才排入。正式站（背景模式）只排進佇列，由 API 的背景迴圈一支一支轉，
    素材狀態不動、官網照常播原檔，轉好之後才改播轉檔版本；本機（inline）就地轉完。"""
    from app.media import jobs as media_jobs
    from app.media import service as media_service
    from app.media.models import MediaAsset, MediaJob
    from app.operations import audit_service

    settings = get_settings()
    factory = await _session_factory()
    async with factory() as db:
        candidates = await media_jobs.backfill_candidates(db)
        await db.rollback()
    for c in candidates:
        where = CAMPUS_NAMES.get(c.campus_key, c.campus_key) if c.campus_key else "共用"
        seconds = f"{c.duration:g} 秒" if c.duration else "長度不明"
        print(f"  {c.asset_id}・{where}：{c.filename}（{seconds}，缺 {'、'.join(c.missing)}）")
    if not apply:
        print(f"dry-run：共 {len(candidates)} 支影片需要補轉檔（未排入）。加 --apply 才會執行。")
        return

    async with factory() as db:
        queued = await media_jobs.enqueue_backfill(db, [c.asset_id for c in candidates])
        await audit_service.log_action(
            db,
            actor_user_id=None,
            action="media.transcode_backfill",
            target_type="media_asset",
            target_id="videos",
            metadata={"queued": [str(job.media_id) for job in queued]},
        )
        await db.commit()
        job_ids = [job.id for job in queued]

    if settings.media_video_processing_mode == "background":
        print(f"已排入 {len(job_ids)} 支，API 會一支一支轉；進度看素材庫或 /api/website/v1/health 的 media_jobs。")
        return
    storage = media_service.get_storage(settings)
    failed = 0
    for job_id in job_ids:
        async with factory() as db:
            job = await db.get(MediaJob, job_id)
            asset = await db.get(MediaAsset, job.media_id)
            outcome = await media_jobs.process_now(db, storage, asset, job)
            await db.commit()
            failed += outcome == "failed"
            print(f"  [{'完成' if outcome == 'done' else '失敗'}] {asset.original_filename}" + (f"（{job.error}）" if job.error else ""))
    print(f"共 {len(job_ids)} 支：完成 {len(job_ids) - failed}、失敗 {failed}。")
    if failed:
        raise SystemExit(1)
```

`main()` 的用法字串在 `strip-media-metadata [--apply]` 後面加 `|transcode-media-videos [--apply]`，分支加：

```python
    elif command == "transcode-media-videos":
        args = set(sys.argv[2:])
        if args - {"--apply", "--dry-run"} or {"--apply", "--dry-run"} <= args:
            raise SystemExit("用法：python -m app.cli transcode-media-videos [--apply]")
        asyncio.run(transcode_media_videos(apply="--apply" in args))
```

`admin/src/api/labels.ts` 在 `'media.regenerate_variants'` 下面加 `'media.transcode_backfill': '既有影片補轉檔',`。

- [ ] **Step 4: 跑測試**

```bash
cd backend && uv run --frozen pytest -q tests/test_media_jobs.py tests/test_secfix_media.py -k "cli or transcode"
cd ../admin; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npx vitest run src/__tests__/labelCoverage.test.ts
```
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/app/cli.py backend/tests/test_media_jobs.py admin/src/api/labels.ts
git commit -m "feat(media): 新增 transcode-media-videos 指令，既有影片排入補轉檔

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 契約與後台畫面

**Files:**
- Regenerate: `contracts/openapi.json`、`contracts/generated/website-api.d.ts`
- Modify: `admin/src/api/types.ts:349`、`admin/src/api/client.ts:127`
- Create: `admin/src/composables/mediaProcessing.ts`
- Modify: `admin/src/views/MediaLibraryView.vue`、`admin/src/components/MediaPickerDialog.vue`、`admin/src/components/MediaSlotField.vue`、`admin/src/components/MediaUploadList.vue`、`admin/src/components/MediaReplaceDialog.vue:190-193`
- Test: `admin/src/__tests__/mediaProcessing.test.ts`（新增）、`admin/src/__tests__/mediaLibrary.test.ts`、`admin/src/__tests__/mediaSlots.test.ts`

**Interfaces:**
- Consumes: Task 6 `POST /admin/media/{id}/retry`；`MediaAssetOut.status`、`processing_error`、`variants[].kind`。
- Produces（`admin/src/composables/mediaProcessing.ts`）：`POLL_MS = 5000`、`MAX_POLLED = 10`、`isProcessing(asset)`、`processingNote(asset): string`、`canRetryProcessing(asset): boolean`、`useProcessingPoll(assets: () => MediaAssetOut[], onUpdate: (fresh: MediaAssetOut) => void): { schedule(): void }`。

若 Task 0 發現「後台 UX 第八輪」已把選圖元件統一，Step 6–8 改到該共用元件上，判斷與文案照用本 Task 的 composable。

- [ ] **Step 1: 重產契約、修型別**

```bash
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm run contract:generate
```

`admin/src/api/types.ts:349` `export type VariantKind = 'thumbnail' | 'poster'` 換成 `export type VariantKind = components['schemas']['VariantKind']`。

`admin/src/api/client.ts:127` 換成：

```ts
export type MediaVariantKind = 'thumbnail' | 'medium' | 'large' | 'poster' | 'video_desktop' | 'video_mobile'
```

Run: `npm --prefix admin run typecheck`
Expected: 0 error。

- [ ] **Step 2: 寫失敗測試**

`admin/src/__tests__/mediaProcessing.test.ts`：

```ts
// 影片背景轉檔（後端 app/media/jobs.py）：狀態文案、能否重新處理、處理中輪詢。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { api } from '../api/client'
import type { MediaAssetOut } from '../api/types'
import { canRetryProcessing, POLL_MS, processingNote, useProcessingPoll } from '../composables/mediaProcessing'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const base = { kind: 'video', status: 'ready', processing_error: null, deleted_at: null } as const

describe('狀態文案與重新處理', () => {
  it('處理中、失敗、可用各一句話', () => {
    expect(processingNote({ ...base, status: 'processing' })).toBe('轉檔中，轉好才能預覽與發布；可以先選進草稿')
    expect(processingNote({ ...base, status: 'failed', processing_error: '影片轉檔逾時（120 秒）' })).toBe('處理失敗：影片轉檔逾時（120 秒）')
    expect(processingNote({ ...base, status: 'failed' })).toBe('處理失敗：原因不明')
    expect(processingNote(base)).toBe('')
  })

  it('只有處理失敗、沒刪除的影片能重新處理', () => {
    expect(canRetryProcessing({ ...base, status: 'failed' })).toBe(true)
    expect(canRetryProcessing({ ...base, status: 'failed', kind: 'image' })).toBe(false)
    expect(canRetryProcessing({ ...base, status: 'failed', deleted_at: '2026-10-03T00:00:00Z' })).toBe(false)
    expect(canRetryProcessing({ ...base, status: 'processing' })).toBe(false)
  })
})

describe('處理中輪詢', () => {
  it('處理中的素材每 5 秒重讀一次，轉好就停', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const list = ref([{ id: 'v1', status: 'processing' } as MediaAssetOut])
    const get = vi.spyOn(api, 'get').mockResolvedValue({ id: 'v1', status: 'ready' } as never)
    const wrapper = mount(defineComponent({
      setup() {
        useProcessingPoll(() => list.value, (fresh) => { list.value = [fresh] })
        return () => h('div')
      },
    }))
    await vi.advanceTimersByTimeAsync(POLL_MS)
    await flushPromises()
    expect(get).toHaveBeenCalledWith('/admin/media/v1')
    expect(list.value[0]!.status).toBe('ready')
    await vi.advanceTimersByTimeAsync(POLL_MS * 3)
    expect(get).toHaveBeenCalledTimes(1)
    wrapper.unmount()
  })

  it('離開頁面就不再讀', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const get = vi.spyOn(api, 'get').mockResolvedValue({ id: 'v1', status: 'processing' } as never)
    const wrapper = mount(defineComponent({
      setup() {
        useProcessingPoll(() => [{ id: 'v1', status: 'processing' } as MediaAssetOut], () => {})
        return () => h('div')
      },
    }))
    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(POLL_MS * 2)
    expect(get).not.toHaveBeenCalled()
  })
})
```

`admin/src/__tests__/mediaLibrary.test.ts` 的 `describe('素材庫頁', ...)` 裡加（沿用檔內 `asset()`、`mockGet`、`mountAs`、`admin()`）：

```ts
  it('處理中的影片顯示轉檔中，輪詢到可用就換掉；失敗的可以重新處理', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const processing = asset({ id: 'vp', kind: 'video', status: 'processing', original_filename: 'run.mp4', content_type: 'video/mp4', duration_seconds: 8 })
      const failed = asset({ id: 'vf', kind: 'video', status: 'failed', original_filename: 'bad.mp4', content_type: 'video/mp4', processing_error: '影片轉檔逾時（120 秒）' })
      const get = vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
        if (path === '/admin/media/upload-limits') return LIMITS as never
        if (path === '/admin/media/vp') return { ...processing, status: 'ready' } as never
        if (path.startsWith('/admin/media')) return [processing, failed] as never
        return [] as never
      })
      const post = vi.spyOn(api, 'post').mockResolvedValue({ ...failed, status: 'processing', processing_error: null } as never)
      const wrapper = await mountAs(MediaLibraryView, admin())
      const card = (id: string) => wrapper.find(`[data-media-id="${id}"]`)
      expect(card('vp').text()).toContain('轉檔中，轉好才能預覽與發布')
      expect(card('vf').text()).toContain('處理失敗：影片轉檔逾時（120 秒）')

      await vi.advanceTimersByTimeAsync(5000)
      await flushPromises()
      expect(get).toHaveBeenCalledWith('/admin/media/vp')
      expect(card('vp').text()).not.toContain('轉檔中')

      await card('vf').findAll('button').find((b) => b.text() === '重新處理')!.trigger('click')
      await flushPromises()
      expect(post).toHaveBeenCalledWith('/admin/media/vf/retry')
      expect(card('vf').text()).toContain('轉檔中')
    } finally {
      vi.useRealTimers()
    }
  })

  it('選影片：處理中的可以選並標示轉檔中，失敗的不列', async () => {
    // 選圖器沒帶校區時只列跨校共用（campus_key: null）。
    mockGet([
      asset({ id: 'ok', kind: 'video', campus_key: null, original_filename: 'ok.mp4' }),
      asset({ id: 'vp', kind: 'video', campus_key: null, status: 'processing', original_filename: 'run.mp4' }),
      asset({ id: 'vf', kind: 'video', campus_key: null, status: 'failed', original_filename: 'bad.mp4' }),
    ])
    const wrapper = await mountAs(MediaPickerDialog, admin(), { modelValue: false, kind: 'video' })
    await wrapper.setProps({ modelValue: true })
    await flushPromises()
    const text = document.body.textContent ?? ''
    expect(text).toContain('run.mp4')
    expect(text).toContain('轉檔中，轉好才能發布')
    expect(text).not.toContain('bad.mp4')
  })
```

`admin/src/__tests__/mediaSlots.test.ts` 加（沿用檔內 `VIDEO`、`mountPlain`）：

```ts
describe('影片版位的轉檔狀態', () => {
  it('處理中顯示說明並自動更新；失敗說怎麼處理', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const processing = { ...VIDEO, status: 'processing' as const, variants: [] }
      const get = vi.spyOn(api, 'get')
        .mockResolvedValueOnce(processing as never)
        .mockResolvedValueOnce({ ...VIDEO } as never)
      const wrapper = mountPlain(() => h(MediaSlotField, { modelValue: { media_id: 'vid' }, kind: 'video', builtin: '內建影片' }))
      await flushPromises()
      expect(wrapper.text()).toContain('影片轉檔中，轉好才能預覽與發布（這裡會自動更新）')
      await vi.advanceTimersByTimeAsync(5000)
      await flushPromises()
      expect(get).toHaveBeenCalledTimes(2)
      expect(wrapper.text()).not.toContain('轉檔中')
    } finally {
      vi.useRealTimers()
    }

    vi.spyOn(api, 'get').mockResolvedValue({ ...VIDEO, id: 'bad', status: 'failed', processing_error: '影片轉檔失敗：壞掉' } as never)
    const failed = mountPlain(() => h(MediaSlotField, { modelValue: { media_id: 'bad' }, kind: 'video', builtin: '內建影片' }))
    await flushPromises()
    expect(failed.text()).toContain('影片處理失敗：影片轉檔失敗：壞掉。請到素材庫按「重新處理」，或換一支影片')
  })
})
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `cd admin; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npx vitest run src/__tests__/mediaProcessing.test.ts src/__tests__/mediaLibrary.test.ts src/__tests__/mediaSlots.test.ts`
Expected: FAIL（找不到 `../composables/mediaProcessing`）。

- [ ] **Step 4: `admin/src/composables/mediaProcessing.ts`**

```ts
import { onBeforeUnmount, watch } from 'vue'
import { api } from '../api/client'
import type { MediaAssetOut } from '../api/types'

// 影片上傳後在背景轉檔（後端 app/media/jobs.py）：處理中的素材每 POLL_MS 重讀一次，
// 轉好或失敗就停；一次最多讀 MAX_POLLED 個，分頁在背景時跳過這一輪。

export const POLL_MS = 5000
export const MAX_POLLED = 10

type StatusLike = Pick<MediaAssetOut, 'status'>

export function isProcessing(asset: StatusLike | null | undefined): boolean {
  return asset?.status === 'processing'
}

/** 素材庫卡片上的一句話；可用的回空字串。 */
export function processingNote(asset: Pick<MediaAssetOut, 'kind' | 'status' | 'processing_error'>): string {
  if (asset.status === 'processing') return asset.kind === 'video' ? '轉檔中，轉好才能預覽與發布；可以先選進草稿' : '處理中'
  if (asset.status === 'failed') return `處理失敗：${asset.processing_error ?? '原因不明'}`
  return ''
}

export function canRetryProcessing(asset: Pick<MediaAssetOut, 'kind' | 'status' | 'deleted_at'>): boolean {
  return asset.kind === 'video' && asset.status === 'failed' && !asset.deleted_at
}

export function useProcessingPoll(assets: () => MediaAssetOut[], onUpdate: (fresh: MediaAssetOut) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false

  async function tick() {
    timer = null
    if (stopped) return
    const pending = assets().filter(isProcessing).slice(0, MAX_POLLED)
    if (pending.length && !(typeof document !== 'undefined' && document.hidden)) {
      for (const asset of pending) {
        try {
          const fresh = await api.get<MediaAssetOut>(`/admin/media/${asset.id}`)
          if (!stopped) onUpdate(fresh)
        } catch {
          // 讀不到就下一輪再試。
        }
      }
    }
    schedule()
  }

  function schedule() {
    if (stopped || timer || !assets().some(isProcessing)) return
    timer = setTimeout(() => void tick(), POLL_MS)
  }

  watch(() => assets().filter(isProcessing).map((a) => a.id).join(','), schedule, { immediate: true })
  onBeforeUnmount(() => {
    stopped = true
    if (timer) clearTimeout(timer)
  })
  return { schedule }
}
```

- [ ] **Step 5: MediaLibraryView.vue**

1. import 加 `import { canRetryProcessing, processingNote, useProcessingPoll } from '../composables/mediaProcessing'`，`apiErrorMessage` 已 import。
2. `watch(listState, load)` 下面加：

```ts
function replaceAsset(fresh: MediaAssetOut) {
  const index = assets.value.findIndex((a) => a.id === fresh.id)
  if (index >= 0) assets.value.splice(index, 1, fresh)
}

// 影片轉檔中的卡片自己更新，不必重新整理頁面。
useProcessingPoll(() => assets.value, replaceAsset)

async function retryProcessing(asset: MediaAssetOut) {
  try {
    replaceAsset(await api.post<MediaAssetOut>(`/admin/media/${asset.id}/retry`))
    ElMessage.success('已重新排入轉檔')
  } catch (err) {
    notifyError(apiErrorMessage(err, '重新處理失敗，請稍後再試'))
  }
}
```

3. 模板 `.media__meta` 裡、`<span v-else-if="!asset.alt_text" ...>` 那行下面加：

```html
          <span v-if="asset.status !== 'ready'" class="media__warn">{{ processingNote(asset) }}</span>
```

4. `.media__actions` 的 `<el-button v-else-if="asset.status === 'ready'" ...>編輯</el-button>` 下面加：

```html
              <el-button v-else-if="canRetryProcessing(asset)" size="small" text type="primary" @click="retryProcessing(asset)">重新處理</el-button>
```

- [ ] **Step 6: MediaPickerDialog.vue**

1. `visibleAssets` 的 `a.status === 'ready' &&` 改成 `a.status !== 'failed' &&`，上面加註解 `// 轉檔中的影片可以先選進草稿（發布時後端會擋到轉好）；處理失敗的不列。`
2. 格子裡 `<span v-if="!asset.alt_text" class="picker__warn">` 上面加：

```html
        <span v-if="asset.status === 'processing'" class="picker__warn">轉檔中，轉好才能發布</span>
```

3. `onUploadChange` 單檔成功分支：`if (picked!.alt_text) { ElMessage.success('已上傳並選用') }` 改成

```ts
    const pending = picked!.status === 'processing' ? `，${noun.value}轉檔中，轉好才能發布` : ''
    if (picked!.alt_text) {
      ElMessage.success(`已上傳並選用${pending}`)
    } else {
      notifyWarning(`已上傳並選用${pending}。這${unit.value}${noun.value}還沒有${altNoun.value}，沒補上的話官網會沒有${altNoun.value}，可以到素材庫按「編輯」補上。`)
    }
```

- [ ] **Step 7: MediaSlotField.vue**

1. import 加 `import { useProcessingPoll } from '../composables/mediaProcessing'`。
2. `watch(asset, (value) => emit('asset', value))` 下面加：

```ts
// 剛選的影片還在轉檔：這裡自己更新，轉好就看得到封面。
useProcessingPoll(
  () => (asset.value ? [asset.value] : []),
  (fresh) => {
    if (asset.value?.id !== fresh.id) return
    asset.value = fresh
    cache.set(fresh.id, Promise.resolve(fresh))
  },
)
```

3. 模板 `<span v-if="missing" class="slot__warn">` 上面加：

```html
          <span v-if="asset?.status === 'processing'" class="field-help">影片轉檔中，轉好才能預覽與發布（這裡會自動更新）</span>
          <span v-else-if="asset?.status === 'failed'" class="slot__warn">影片處理失敗：{{ asset.processing_error ?? '原因不明' }}。請到素材庫按「重新處理」，或換一支影片</span>
```

- [ ] **Step 8: MediaUploadList.vue 與 MediaReplaceDialog.vue**

`MediaUploadList.vue`：`meta` 改收整個 item：

```ts
function meta(item: UploadItem): StatusMeta {
  // 影片上傳完還要在背景轉檔（後端 app/media/jobs.py）。
  if (item.status === 'done' && item.asset?.status === 'processing') return { label: '已上傳，轉檔中', tone: 'warning' }
  return { label: UPLOAD_STATUS_LABELS[item.status], tone: TONES[item.status] }
}
```

模板 `:meta="meta(item.status)"` 改 `:meta="meta(item)"`。

`MediaReplaceDialog.vue:190` 的 `if (created.status !== 'ready') {` 改 `if (created.status === 'failed') {`。`:265` 的 `<div v-else-if="step === 'impact'" ...>` 裡第一個子元素前加：

```html
      <p v-if="replacement?.status === 'processing'" class="hint">新影片轉檔中：可以先換進草稿，轉好之後才能發布。</p>
```

- [ ] **Step 9: 跑測試與型別**

```bash
cd admin; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1
npx vitest run src/__tests__/mediaProcessing.test.ts src/__tests__/mediaLibrary.test.ts src/__tests__/mediaSlots.test.ts src/__tests__/labelCoverage.test.ts
npm run typecheck
```
Expected: PASS、typecheck 0 error。

- [ ] **Step 10: Commit**

```bash
git add contracts/openapi.json contracts/generated/website-api.d.ts admin/src/api/types.ts admin/src/api/client.ts admin/src/composables/mediaProcessing.ts admin/src/views/MediaLibraryView.vue admin/src/components/MediaPickerDialog.vue admin/src/components/MediaSlotField.vue admin/src/components/MediaUploadList.vue admin/src/components/MediaReplaceDialog.vue admin/src/__tests__/mediaProcessing.test.ts admin/src/__tests__/mediaLibrary.test.ts admin/src/__tests__/mediaSlots.test.ts
git commit -m "feat(admin): 素材庫與影片版位顯示轉檔中、處理失敗可重新處理

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 官網播轉檔版本、srcset 用中圖

**Files:**
- Modify: `web/app/utils/media-image.ts:13-20,95-127`
- Modify: `web/app/utils/content-overlay.ts:321,449-459,578-587`
- Test: `web/tests/media-slots.spec.ts`

**Interfaces:**
- Consumes: 公開 API `media[id].variants[].kind` 新值 `medium`／`video_desktop`／`video_mobile`（Task 1、4）。
- Produces: `slotVideoSrc(slot: LiveMediaSlot | null | undefined, media?: MediaInfoMap, edition: 'desktop' | 'mobile' = 'desktop'): string | undefined`。

- [ ] **Step 1: 寫失敗測試**

`web/tests/media-slots.spec.ts` 的 import 從 `../app/utils/media-image` 多 import `slotVideoSrc`，檔尾加：

```ts
describe('影片轉檔版本與中圖', () => {
  const editions: PublicMediaInfo = info(VIDEO, {
    kind: 'video', content_type: 'video/mp4', width: 1920, height: 1080,
    variants: [
      { kind: 'poster', width: 480, height: 270, version: 'p1' },
      { kind: 'video_desktop', width: 1920, height: 1080, version: 'd1' },
      { kind: 'video_mobile', width: 1920, height: 1080, version: 'm1' }
    ]
  })
  const withEditions: MediaInfoMap = { ...media, [VIDEO]: editions }

  it('有轉檔版本時桌機、手機各用自己的版本；沒有就用原檔', () => {
    expect(slotVideoSrc({ media_id: VIDEO }, withEditions, 'desktop')).toBe(`/api/website/v1/public/media/${VIDEO}/variants/video_desktop?v=d1`)
    expect(slotVideoSrc({ media_id: VIDEO }, withEditions, 'mobile')).toBe(`/api/website/v1/public/media/${VIDEO}/variants/video_mobile?v=m1`)
    expect(slotVideoSrc({ media_id: VIDEO }, media, 'mobile')).toBe(`/api/website/v1/public/media/${VIDEO}/file`)
    expect(slotVideoSrc({ media_id: VIDEO })).toBe(`/api/website/v1/public/media/${VIDEO}/file`)
  })

  it('首屏與孩子的一天：手機沒另外選影片時，用桌機那支的手機版', () => {
    const hero = applyContentOverlay(site, { home_hero: { eyebrow: '', copy_lines: ['一'], video_desktop: { media_id: VIDEO } } }, withEditions).home.hero
    expect(hero.heroVideoSrc).toContain('/variants/video_desktop')
    expect(hero.heroVideoSrcMobile).toContain('/variants/video_mobile')
    const films = homeFilms([{ id: 'run', title: '一起跑', source: 'file', video: { media_id: VIDEO }, start: 1, end: null }], withEditions)
    // 活動影片只在手機輪播出現，用手機版。
    expect(films[0]).toMatchObject({ src: `/api/website/v1/public/media/${VIDEO}/variants/video_mobile?v=m1`, start: 1 })
  })

  it('srcset 放中圖，不放影片的轉檔版本', () => {
    const image = mediaImage(IMAGE, info(IMAGE, {
      variants: [{ kind: 'thumbnail', width: 480, height: 320 }, { kind: 'medium', width: 960, height: 640 }, { kind: 'large', width: 1600, height: 1067 }]
    }))
    expect(image.candidates.map((c) => c.width)).toEqual([480, 960, 1600, 2400])
    expect(mediaImage(VIDEO, editions).candidates.map((c) => c.width)).toEqual([1920])
  })
})
```

（孩子的一天的疊加跟首屏同一套寫法；若想多驗一個，照檔內 `'孩子的一天：影片、poster、說明文字與卡片照片／alt／色調'` 的 `day_experience` payload 加 `film_desktop` 寫一行斷言 `filmSrcMobile` 含 `video_mobile`。）

- [ ] **Step 2: 跑測試確認失敗**

Run: `source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix web run test:unit -- tests/media-slots.spec.ts`
Expected: FAIL（`slotVideoSrc` 回原檔；srcset 多出 1920）。

- [ ] **Step 3: media-image.ts**

1. `PublicMediaVariant.kind` 改 `'thumbnail' | 'medium' | 'large' | 'poster' | 'video_desktop' | 'video_mobile'`。檔頭註解「每個被引用素材的尺寸、衍生檔（縮圖、大圖、影片 poster）」改成「（縮圖、中圖、大圖、影片 poster 與桌機／手機轉檔版本）」。
2. `mediaImage` 的迴圈改成只收圖片衍生檔：

```ts
const IMAGE_VARIANTS = new Set<PublicMediaVariant['kind']>(['thumbnail', 'medium', 'large'])
```

（放在 `mediaImage` 上面），迴圈內 `if (variant.kind === 'poster' || !variant.width) continue` 改 `if (!IMAGE_VARIANTS.has(variant.kind) || !variant.width) continue`，註解改「只收圖片的縮小版：poster 與影片轉檔版本不是這張圖」。
3. `slotVideoSrc` 換成：

```ts
/**
 * 影片版位 → 檔案網址。素材有背景轉好的版本（後端 app/media/jobs.py）就用對應的
 * 那一版（手機版同解析度、CRF 較高，見 media-policy.ts），還沒轉好或舊素材用原檔。
 */
export function slotVideoSrc(
  slot: LiveMediaSlot | null | undefined,
  media?: MediaInfoMap,
  edition: 'desktop' | 'mobile' = 'desktop'
): string | undefined {
  if (!slot || !isMediaId(slot.media_id)) return undefined
  const kind = edition === 'mobile' ? 'video_mobile' : 'video_desktop'
  const variant = media?.[slot.media_id]?.variants.find((v) => v.kind === kind)
  return variant ? mediaVariantUrl(slot.media_id, kind, variant.version) : mediaFileUrl(slot.media_id)
}
```

- [ ] **Step 4: content-overlay.ts**

- `:321` `const src = slotVideoSrc(film.video)` → `const src = slotVideoSrc(film.video, media, 'mobile')`，上面加註解 `// 活動影片只在手機輪播（HomeFilms.vue），用手機版。`
- `:449` `slotVideoSrc(hero.video_desktop)` → `slotVideoSrc(hero.video_desktop, media, 'desktop')`；`:450` 的 `mobile` 只用來判斷有沒有設，維持 `slotVideoSrc(hero.video_mobile)`；`:458` → `slotVideoSrc(mobileSlot, media, 'mobile')`。
- `:578`、`:579`、`:586` 照同樣規則：桌機那支 `'desktop'`、`filmSrcMobile` 用 `'mobile'`。

- [ ] **Step 5: 跑測試與型別**

```bash
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1
npm --prefix web run test:unit -- tests/media-slots.spec.ts
npm --prefix web run typecheck
```
Expected: PASS；既有「首屏」「活動影片清單」測試照舊過（那些素材沒有轉檔版本，仍回原檔）。

- [ ] **Step 6: Commit**

```bash
git add web/app/utils/media-image.ts web/app/utils/content-overlay.ts web/tests/media-slots.spec.ts
git commit -m "feat(web): 官網影片改播轉檔版本，圖片 srcset 加入中圖

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: 文件

**Files:**
- Modify: `README.md`（頂部加日期段落）
- Modify: `DESIGN.md`（「官網後台第七輪 UX（2026-10-02…）」那一節**上面**新增一節）
- Modify: `docs/website-admin/acceptance.md`（檔尾新增一節）
- Modify: `docs/website-admin/operations.md:178`（已知限制）＋新增運維小節
- Modify: `deploy/README.md`（新增上線步驟）

- [ ] **Step 1: DESIGN.md 新增一節**

```markdown
## 素材背景轉檔（2026-10-03）

- 影片上傳後先顯示「轉檔中」，由 API 程序內的背景工作做 poster 與桌機／手機兩個 H.264 版本；轉好才能預覽與發布，**可以先選進草稿**。處理失敗的影片保留原檔，素材庫卡片有「重新處理」。
- 轉檔參數：preset medium、桌機 CRF 20、手機 CRF 26、長邊上限 1920、最高 30fps、不帶聲音、不帶 metadata、faststart；影片上限 10 分鐘。改參數只改 `backend/app/media/processing.py` 的常數，這裡跟著改。
- 圖片多一個長邊 960 的中圖，官網 srcset 自動帶入。
- 文案：卡片「轉檔中，轉好才能預覽與發布；可以先選進草稿」、失敗「處理失敗：<原因>」、選影片格子「轉檔中，轉好才能發布」、上傳清單「已上傳，轉檔中」。
- 不做：圖片背景化（處理只要 1–2 秒，選圖器要立即選用）、另開 Railway worker 服務。
```

- [ ] **Step 2: README.md 頂部**

```markdown
## 2026-10-03 素材背景轉檔（`feature/media-jobs-20261003`，未部署）

影片上傳改成背景轉檔（poster＋桌機／手機 H.264），官網改播轉檔版本；圖片多中圖。規則見 DESIGN.md「素材背景轉檔」。

- **後端**：新表 `media_jobs`（migration `e5b9c3a7d214`，只新增表與 enum 值）、`app/media/jobs.py`、`app/workers/media_loop.py`、`POST /admin/media/{id}/retry`、指令 `transcode-media-videos [--apply]`；`WEBSITE_MEDIA_VIDEO_PROCESSING`（正式站預設 background）。
- **後台**：素材庫、選影片、影片版位、上傳清單、替換流程顯示轉檔狀態；失敗可重新處理。
- **官網**：`slotVideoSrc` 依桌機／手機選轉檔版本，沒有就用原檔。
- **驗證**：<Task 11 實際跑過的指令與數字>。
- **未驗證**：<Task 11 填>。
```

- [ ] **Step 3: acceptance.md 檔尾**

```markdown
## 素材背景轉檔（2026-10-03 實作，尚未部署）

| 項目 | 狀態 | 證據 |
|---|---|---|
| 影片上傳回 processing、背景轉好變 ready | 通過 | `tests/test_media_jobs.py::test_background_upload_returns_processing_and_queues_one_job`、stack `media-video.spec.ts` |
| 轉檔版本不帶拍攝資訊、直式轉正 | 通過 | `test_editions_drop_location_tags_and_follow_rotation` |
| 中斷重試上限、租約接手丟棄結果 | 通過 | `test_expired_lease_reclaim_counts_and_stops_after_max`、`test_lost_lease_discards_results` |
| 處理中影片可存草稿、不能發布 | 通過 | `test_processing_video_can_be_drafted_but_not_published` |
| 回補不影響線上 | 通過 | `test_backfill_keeps_asset_ready_even_when_it_fails` |
| 正式站 HDR tonemap（需 zscale） | 未驗證 | 部署後依 deploy/README 查 |
```

並把 `:373` 那條「背景轉檔佇列未做」改成「背景轉檔已做（2026-10-03，見檔尾一節）」。

- [ ] **Step 4: operations.md**

`:178` 換成：

```markdown
- 影片上傳後在背景轉檔（`app/media/jobs.py`）：健康檢查的 `media_jobs.last_processed_at`／`last_failed_at` 看最近一次結果；處理失敗的影片保留原檔，**不計入校區素材空間**，刪除後照一般刪除流程清理。
```

另在運維段落加：

```markdown
### 影片轉檔

- 開關：`WEBSITE_MEDIA_VIDEO_PROCESSING=background|inline`（正式站預設 background）、`WEBSITE_MEDIA_JOBS_POLL_SECONDS`（預設 5）。
- 卡住時：`media_jobs` 表看 `status='running'` 的 `leased_until`；程序重啟後最多 120 秒會被接手，中斷 3 次標失敗。
- 既有影片補轉檔：`python -m app.cli transcode-media-videos`（dry-run）→ `--apply`（排入背景）。既有圖片補中圖：`python -m app.cli regenerate-media-variants` → `--apply`。
```

- [ ] **Step 5: deploy/README.md 上線步驟**

```markdown
## 素材背景轉檔上線步驟（2026-10-03，未部署）

migration `e5b9c3a7d214` 只新增 `media_jobs` 表與 `media_variant_kind` 的三個值，不改既有資料。

部署前：照慣例先備份正式 DB（指令見本檔「備份」段落），由使用者本人執行。

部署後（auto 模式會擋 `railway ssh`，以下請自己在終端機跑）：

1. `curl -s https://<正式網域>/api/website/v1/health | python3 -m json.tool`：`media_jobs.enabled` 為 `true`。
2. 查正式映像有沒有 HDR 需要的 `zscale`：`railway ssh --service api -- sh -c 'ffmpeg -hide_banner -filters | grep -E " (zscale|tonemap) "'`。沒有 zscale 時 HDR 影片顏色會偏灰，要另外決定是否換 ffmpeg 來源。
3. 後台上傳一支短影片：卡片先顯示「轉檔中」，幾十秒內變可用；Railway metrics 看 api 記憶體峰值。
4. 既有影片補轉檔（先備份媒體 volume 或 S3 bucket）：
   - `railway ssh --service api -- python -m app.cli transcode-media-videos`（列出）
   - `railway ssh --service api -- python -m app.cli transcode-media-videos --apply`（排入，API 逐支轉）
5. 既有圖片補中圖：`regenerate-media-variants` 先 dry-run、再 `--apply`（會換掉該圖的縮圖與大圖記錄，新網址帶新版本）。
```

- [ ] **Step 6: Commit**

```bash
git add README.md DESIGN.md docs/website-admin/acceptance.md docs/website-admin/operations.md deploy/README.md
git commit -m "docs(media): 背景轉檔的設計規則、驗收、運維與上線步驟

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: 驗證閘門

**Files:** 依結果修正；README 填驗證數字。

全套由主 session 用 `run_in_background` 跑，**同時只跑一組**；subagent 只跑單檔前景測試。

- [ ] **Step 1: migration 只有一個 head（別的 session 可能先合了 migration）**

```bash
cd ~/Desktop/ivy-website-media-jobs-20261003
git fetch origin --quiet; git merge-base --is-ancestor origin/main HEAD || echo "main 有新提交，先合進來"
cd backend && uv run --frozen alembic heads
```
Expected：一行。若出現兩個 head：`git merge origin/main`，把 `e5b9c3a7d214` 的 `down_revision` 改成 main 上的新 head，重跑 Task 1 Step 6。

- [ ] **Step 2: 後端全套（背景）**

```bash
cd ~/Desktop/ivy-website-media-jobs-20261003/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_mediajobs_test PYTHONUNBUFFERED=1 \
  uv run --frozen pytest -q -o faulthandler_timeout=240 2>&1 | tail -30
```
Expected：全過；台北週五的 `test_booking_consent_readiness` 場次同步失敗屬既有問題，記下但不修。

- [ ] **Step 3: 前端、契約**

```bash
cd ~/Desktop/ivy-website-media-jobs-20261003
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1
npm --prefix admin run typecheck; npm --prefix admin run test:unit
npm --prefix web run typecheck; npm run test:website
npm run contract:check
```
Expected：全過、契約一致。admin vitest 在機器忙時若有 5 秒逾時，單獨重跑失敗檔分辨。

- [ ] **Step 4: stack e2e（自訂庫與埠）**

```bash
cd ~/Desktop/ivy-website-media-jobs-20261003
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1
export E2E_DB_NAME=ivy_website_mediajobs_e2e_test E2E_API_PORT=8751 E2E_WEB_PORT=3751
npm run e2e:build; npm run test:e2e:stack
```
Expected：全過，含新的 `media-video.spec.ts`；`media.spec` 間歇失敗時單獨重跑確認。

- [ ] **Step 5: 轉檔成本實測（給上線評估）**

```bash
cd ~/Desktop/ivy-website-media-jobs-20261003/backend
OUT=../output/media-jobs-20261003; mkdir -p "$OUT"
SRC=$(ls ../web/public/assets/optimized/day-desktop-*.mp4 | head -1)
uv run --frozen python -c "
from pathlib import Path; from app.media import processing as p
print(' '.join(p.transcode_args(Path('$SRC'), Path('$OUT/perf-desktop.mp4'), 'desktop', p.VideoColor(), tonemap=False)))" > "$OUT/perf-cmd.txt"
/usr/bin/time -l sh -c "$(cat "$OUT/perf-cmd.txt")" 2>&1 | grep -E 'real|maximum resident'
```
Expected：記下 25 秒 1440×810 影片的轉檔秒數與最大記憶體（maximum resident set size），寫進 README 驗證段與 deploy/README 第 3 點旁邊，供判斷 Railway api 容器是否夠用。`output/` 已 gitignore，量完刪掉 `perf-desktop.mp4`。

- [ ] **Step 6: 畫面檢查**

本機 dev（`docs/website-admin/README.md` 的啟動方式，API 加 `WEBSITE_MEDIA_VIDEO_PROCESSING=background`）＋Playwright，桌機 1440×900 與手機 390×844：素材庫上傳影片→卡片「轉檔中」→變可用；首屏影片版位選處理中的影片→說明文字→轉好自動更新；失敗影片（暫時把 `TRANSCODE_MAX_SECONDS` 改成 1 再上傳，看完改回）→「重新處理」。截圖放 `output/media-jobs-20261003/`。

- [ ] **Step 7: 填 README 驗證段、commit**

```bash
git add README.md deploy/README.md
git commit -m "docs(media): 背景轉檔驗證結果

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 8: 收尾**

回報：分支 `feature/media-jobs-20261003` 的提交清單、實際跑過的指令與結果、未驗證項（正式站 zscale、Railway 記憶體、iOS Safari 播放轉檔版本）。**合併上線由使用者決定（push main＝正式部署）**；部署前要先備份正式 DB，部署後照 `deploy/README.md`「素材背景轉檔上線步驟」做。

---

## 需要使用者決定

1. **轉檔參數**（D4）：桌機 CRF 20／手機 CRF 26、長邊 1920、30fps、不帶聲音、影片上限 10 分鐘。若之後有需要聲音的影片版位，要另加有聲版本。
2. **Railway api 容器資源**（D6）：轉檔與 API 同一個容器；Task 11 Step 5 量到的記憶體峰值若接近方案上限，要選擇升級方案或另開 worker 服務（後者是付費服務，需本人同意）。
3. **失敗影片不計配額**（D10）：可接受就照做；不接受的話要多一個「原檔是否還在」欄位，計畫要加一個 migration。
4. **正式站回補**：既有影片 `transcode-media-videos --apply`、既有圖片 `regenerate-media-variants --apply` 何時跑，由使用者本人執行（先備份）。
