# 幼兒園營業中改以教育部名單判斷 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 幼兒園同步改以教育部名單（kiang `docs/data/高雄市.csv`）判斷營業中，停辦的園所從附近清單下架並記停辦，改名不誤報，並用固定回補檔補上近 12 個月 14 所停辦的實際日期。

**Architecture:** `kindergartens.py` 多一個 `parse_registry`（名單 → 營業中的鍵與（地址、設立日）集合），`parse_preschools` 改看名單而不看 `is_active`；`providers.apply_kindergartens` 在「上次營業中、這次不在」時多問一個判斷：回補檔優先、其次同地址同設立日視為改名、最後一般停辦。回補檔由開發用腳本從名單歷史算出、隨程式提交，同步時讀取。後台只改「附近園所的變化」底下的小字。

**Tech Stack:** FastAPI 0.136.1（釘版）＋SQLAlchemy 2.0＋PostgreSQL；Vue 3＋Vitest（admin）；pytest；Playwright（stack e2e）；`gh` CLI（只在產生回補檔的開發腳本用）。

**Spec:** `docs/specs/2026-10-15-kindergarten-registry-design.md`（使用者 2026-10-15 核可；本計畫引用其裁定 R1–R9 與章節號）

**與規格的差異（實作細節，規格沒寫到、本計畫補上）：**
- 規格 §2「只用兩欄」→ 名單另讀 `address`、`reg_date` 兩欄，用來在**新名稱還沒有座標**（名單有、JSON 沒有）時仍認得出改名（Review Focus 3）。`owner` 仍不讀不存。
- 規格 §4 的判斷函式 `retired_quietly(row) -> str | None` → 實作為 `retire(row) -> tuple[str, date | None] | None`（多帶停辦日期），計數名稱照規格：`renamed`、`backfilled`。

## Global Constraints

- 回覆、註解、畫面文字一律**繁體中文（台灣用語）**；技術名詞與識別符保留原文。
- 只改幼兒園；托嬰的同步、事件與畫面不動（R6）。
- 不新增 migration、不改資料表（規格 §1.3）。API 回應與 OpenAPI 契約不變。
- 名單設定 `geo_kindergartens_registry_url`／`WEBSITE_GEO_KINDERGARTENS_REGISTRY_URL`，預設 `https://kiang.github.io/ap.ece.moe.edu.tw/data/%E9%AB%98%E9%9B%84%E5%B8%82.csv`，只收 `https://`（R2）。
- 名單下載上限 `KINDERGARTEN_REGISTRY_MAX_BYTES = 4 * 1024 * 1024`；與 JSON 共用 `KINDERGARTENS_TIME_BUDGET`（R8）。
- 名單格式錯誤的訊息逐字：`教育部幼兒園名單格式不對`；檔案沒成對的訊息含「要一起給」。
- 回補檔路徑逐字：`backend/app/admissions/geo_data/kindergarten-closures-20261015.csv`，欄位 `source_id,name,left_on,reason`，`reason` 只有 `closed`、`renamed`（規格 §5.1）。
- 名單的 CSV 在程式與文件裡叫 **registry**，不要叫 roster（R9）。
- 未經要求**不 commit 到 main、不 push、不部署**（commit 只在本 worktree 的 `fix/kindergarten-registry-20261015`）。每個 commit 結尾加一行：`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`（執行模型不同時換成該模型名稱）。
- 機器只有 8GB RAM：同一時間只跑一組測試；後端**全套** pytest 與 stack e2e 由主 session 背景跑，不交給 subagent（10 分鐘無輸出會被 watchdog 殺掉）。subagent 只跑自己動到的測試檔。
- 後端 pytest 的 `WEBSITE_*` 變數寫在**同一行**；Node 指令用分號串接（`source nvm.sh` 會 exit 3）；zsh 裡不要寫 `echo =====`。
- 派工文字提到 U+FEFF 這類字元時寫「U+FEFF」，不要寫反斜線跳脫（會被解碼成實體字元）。本計畫的程式碼刻意不出現該字元：BOM 由 `utf-8-sig` 解碼處理，測試用位元組 `b"\xef\xbb\xbf"`。

## 測試環境（主 session 先備好，subagent 直接用）

Worktree：`~/Repositories/ivy-website-wt/kindergarten-registry-20261015`（sparse，分支 `fix/kindergarten-registry-20261015`）。

主 session 開工前做一次：

```bash
cd ~/Repositories/ivy-website-wt/kindergarten-registry-20261015
git sparse-checkout add web/server/data web/public web/app web/app/generated web/server deploy
cd backend && uv sync --frozen
createdb ivy_website_kgreg1015_test
WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_kgreg1015_test WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_kgreg1015_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen alembic upgrade head
```

後端指令前綴（下文記為 `PY`；整段放在同一行，在 `backend/` 目錄下執行）：

```bash
WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_kgreg1015_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen
```

例：`PY pytest -q -p no:cacheprovider tests/test_geo_providers.py`。

後台前端：`cd admin; npm ci`（第一次）；`source ~/.nvm/nvm.sh; nvm use 22; cd admin; npx vitest run <檔>`；`npm --prefix admin run typecheck`。

## Review Focus

規格隱含、但最可能咬到使用者的情況；每一條都在負責的 task 裡有對應測試。

1. **名單下載回 200 但內容是 HTML 錯誤頁、空檔，或回 404**：幼兒園整輪 `failed`、記原因，營業中數量與事件都不變（Task 2 `test_a_broken_registry_fails_the_kindergarten_sync_and_keeps_the_data`）。
2. **名單只剩少數幾列（來源殘缺）**：80% 護欄擋下，沒有一所被標停辦（Task 2 `test_a_truncated_registry_is_refused_by_the_truncation_guard`）。
3. **改名後的新名稱還沒有座標**（名單有、JSON 沒有）：舊名仍判改名、不寫假停辦（Task 1 `test_a_rename_is_recognised_from_the_registry_before_the_new_entry_has_coordinates`）。
4. **同一天重跑、下一輪再跑、回補的園所日後回到名單**：不重複寫停辦；回來時寫重新營業、不撤銷舊停辦（Task 1 `test_a_backfilled_closure_is_dated_when_it_left_the_list`、`test_a_backfilled_kindergarten_that_comes_back_later_reopens`）。
5. **名單是 CRLF、欄位有引號、名稱或文號前後有空白**：照樣對得上（Task 2 `test_registry_tolerates_crlf_quotes_and_spaces`、`test_keys_are_matched_after_trimming_spaces`）。

## File Structure

| 檔案 | 動作 | 責任 |
|---|---|---|
| `backend/app/admissions/geo/closure_backfill.py` | 新增 | `ClosureBackfill`、`load_closure_backfill`、`BackfillFormatError`、`BACKFILL_FILE` |
| `backend/app/admissions/geo/providers.py` | 修改 | `_apply` 多 `retire` 判斷與 `add_event(on=)`；`ChangeReport.renamed／backfilled`；`apply_kindergartens(backfill=, listed_places=)` |
| `backend/app/admissions/geo/kindergartens.py` | 修改 | `Registry`、`registry_key`、`place_key`、`parse_registry`；`parse_preschools(registry=)`；`ParseReport.unplaced` |
| `backend/app/admissions/geo/sync.py` | 修改 | 下載名單、`sync_kindergartens(registry_file=)`、`run_geo_sync(kindergartens_registry_file=)`、讀回補檔 |
| `backend/app/config.py` | 修改 | `geo_kindergartens_registry_url` 與驗證 |
| `backend/app/cli.py` | 修改 | `--kindergartens-registry-file`，與 `--kindergartens-file` 成對 |
| `backend/scripts/build_kindergarten_closures.py` | 新增 | 開發用：從名單歷史產生回補檔 |
| `backend/app/admissions/geo_data/kindergarten-closures-20261015.csv` | 新增（腳本產生） | 回補資料 |
| `backend/tests/fixtures/geo/preschools-sample.json` | 修改 | 每筆補真實 `reg_docno` |
| `backend/tests/fixtures/geo/kindergarten-registry-sample.csv` | 新增 | 樣本對應的名單（10 所） |
| `backend/tests/geo_helpers.py` | 修改 | `REGISTRY_SAMPLE`、`sample_registry`、`registry_of`；`load_geo_samples` 傳名單 |
| `backend/tests/test_geo_closure_backfill.py` | 新增 | 回補檔讀取、正式檔格式 |
| `backend/tests/test_geo_providers.py`、`test_geo_kindergartens.py`、`test_geo_sync.py`、`test_geo_babycare_sync.py`、`test_geo_loop.py` | 修改 | 見各 task |
| `tests/stack/start-api.sh`、`tests/stack/fixtures/geo-preschools.json`、`tests/stack/fixtures/geo-kindergarten-registry.csv`、`tests/stack/admissions-area.spec.ts` | 修改／新增 | stack 匯入成對檔案、小字斷言 |
| `admin/src/components/admissions/area/areaFormat.ts`、`ProviderChanges.vue` | 修改 | `trackingNote` 新文案、註解 |
| `admin/src/__tests__/areaFormat.test.ts`、`nearbyProviders.test.ts` | 修改 | 新文案 |
| `deploy/README.md`、`DESIGN.md`、`README.md`、`backend/app/admissions/geo_data/README.md`、`docs/specs/2026-10-14-provider-changes-design.md` | 修改 | 文件回寫（規格 §9） |

---

### Task 1: 回補檔讀取與改名規則（providers）

**Files:**
- Create: `backend/app/admissions/geo/closure_backfill.py`
- Modify: `backend/app/admissions/geo/providers.py`
- Create: `backend/tests/test_geo_closure_backfill.py`
- Modify: `backend/tests/test_geo_providers.py`

**Interfaces:**
- Consumes: 既有 `_apply`、`apply_kindergartens`、`GeoKindergarten`（`address`、`registered_on`）。
- Produces:
  - `closure_backfill.ClosureBackfill(reason: str, left_on: date | None)`（frozen dataclass）
  - `closure_backfill.load_closure_backfill(path: Path = BACKFILL_FILE) -> dict[str, ClosureBackfill]`，格式錯丟 `BackfillFormatError(ValueError)`
  - `closure_backfill.BACKFILL_FILE: Path`（`app/admissions/geo_data/kindergarten-closures-20261015.csv`，Task 4 才產生）
  - `providers.ChangeReport` 多 `renamed: int = 0`、`backfilled: int = 0`
  - `providers.apply_kindergartens(db, rows, *, synced_at, school_year, force=False, backfill: Mapping[str, ClosureBackfill] | None = None, listed_places: AbstractSet[tuple[str, date]] | None = None) -> ChangeReport`

- [ ] **Step 1: 寫回補檔讀取的失敗測試**

Create `backend/tests/test_geo_closure_backfill.py`:

```python
"""幼兒園停辦回補檔的讀取（2026-10-15 規格 §5）。"""

from __future__ import annotations

from datetime import date

import pytest

from app.admissions.geo.closure_backfill import BackfillFormatError, ClosureBackfill, load_closure_backfill

HEADER = "source_id,name,left_on,reason\n"


def _write(tmp_path, body: str, header: str = HEADER):
    path = tmp_path / "closures.csv"
    path.write_text(header + body, encoding="utf-8")
    return path


def test_closed_and_renamed_rows_are_loaded(tmp_path):
    path = _write(tmp_path, "a,甲幼兒園,2026-09-15,closed\nb,乙幼兒園,,closed\nc,丙幼兒園,2026-03-25,renamed\n")
    assert load_closure_backfill(path) == {
        "a": ClosureBackfill("closed", date(2026, 9, 15)),
        "b": ClosureBackfill("closed", None),
        "c": ClosureBackfill("renamed", date(2026, 3, 25)),
    }


@pytest.mark.parametrize(
    "body",
    [
        "a,甲,2026-09-15,gone\n",  # reason 只有 closed、renamed
        "a,甲,2026/09/15,closed\n",  # 日期固定 ISO
        "a,甲,2026-02-30,closed\n",  # 不存在的日期
        ",甲,2026-09-15,closed\n",  # 沒有 source_id
        "a,甲,2026-09-15,closed\na,甲,2026-09-16,closed\n",  # source_id 重複
    ],
    ids=["reason", "slash-date", "bad-date", "no-id", "duplicate"],
)
def test_bad_rows_are_rejected(tmp_path, body):
    with pytest.raises(BackfillFormatError):
        load_closure_backfill(_write(tmp_path, body))


def test_a_different_header_is_rejected(tmp_path):
    with pytest.raises(BackfillFormatError):
        load_closure_backfill(_write(tmp_path, "a,甲,2026-09-15,closed\n", header="id,name,date,reason\n"))
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `PY pytest -q -p no:cacheprovider tests/test_geo_closure_backfill.py`
Expected: FAIL（`ModuleNotFoundError: No module named 'app.admissions.geo.closure_backfill'`）

- [ ] **Step 3: 實作 `closure_backfill.py`**

Create `backend/app/admissions/geo/closure_backfill.py`:

```python
"""幼兒園停辦的一次性回補（2026-10-15 規格 §5）。

kiang 的 preschools.json 把停辦園所的 is_active 留在 1，2026-10-15 前的同步因此從沒記過幼兒園停辦。
改以教育部名單判斷後，第一次同步會一次下架約 47 所舊筆；這份檔（scripts/build_kindergarten_closures.py
從名單歷史算出、隨程式提交）告訴同步每一所該怎麼處理：closed＋left_on＝停辦事件寫在離開名單那天；
closed 沒有日期（2025-06 前就消失）或 renamed（改名、換承辦）＝只下架、不寫事件。只在某所「這一輪要下架」時查。"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from datetime import date
from pathlib import Path

BACKFILL_FILE = Path(__file__).resolve().parent.parent / "geo_data" / "kindergarten-closures-20261015.csv"
COLUMNS = ["source_id", "name", "left_on", "reason"]
REASONS = ("closed", "renamed")


class BackfillFormatError(ValueError):
    """回補檔的欄位或內容不對；同步把訊息寫進 last_error、幼兒園整輪不換版。"""


@dataclass(frozen=True)
class ClosureBackfill:
    reason: str  # "closed" | "renamed"
    left_on: date | None  # 離開教育部名單的台北日期；2025-06 前就消失的是 None


def load_closure_backfill(path: Path = BACKFILL_FILE) -> dict[str, ClosureBackfill]:
    """回補檔 → {source_id: ClosureBackfill}。欄位、reason、日期、source_id 重複任一不對就丟 BackfillFormatError。"""
    entries: dict[str, ClosureBackfill] = {}
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != COLUMNS:
            raise BackfillFormatError(f"{path.name} 的欄位不對")
        for line, row in enumerate(reader, start=2):
            source_id = (row["source_id"] or "").strip()
            reason = (row["reason"] or "").strip()
            left_on_text = (row["left_on"] or "").strip()
            if not source_id or reason not in REASONS or source_id in entries:
                raise BackfillFormatError(f"{path.name} 第 {line} 列不對")
            try:
                left_on = date.fromisoformat(left_on_text) if left_on_text else None
            except ValueError as exc:
                raise BackfillFormatError(f"{path.name} 第 {line} 列的日期不對") from exc
            if left_on_text and left_on.isoformat() != left_on_text:  # fromisoformat 也收 20260915 這種寫法
                raise BackfillFormatError(f"{path.name} 第 {line} 列的日期不對")
            entries[source_id] = ClosureBackfill(reason, left_on)
    return entries
```

- [ ] **Step 4: 跑測試確認通過**

Run: `PY pytest -q -p no:cacheprovider tests/test_geo_closure_backfill.py`
Expected: PASS（7 passed）

- [ ] **Step 5: 寫改名規則與回補的失敗測試**

Modify `backend/tests/test_geo_providers.py`：

(a) import 區加一行：

```python
from app.admissions.geo.closure_backfill import ClosureBackfill
```

(b) `kg()` 多一個 `address` 參數（預設不變，既有測試不受影響）：

```python
def kg(
    source_id: str, *, kind: str = "private", period: str | None = None, registered_on: date | None = None,
    capacity: int | None = 100, name: str | None = None, address: str = "某路1號",
) -> KindergartenRow:
    return KindergartenRow(
        source_id=source_id, reg_no=None, name=name or f"幼兒園{source_id}", kind=kind, pre_public_period=period,
        district="三民區", address=address, lat=22.64, lng=120.34, approved_capacity=capacity,
        monthly_fee_estimate=None, has_penalty=False, phone=None, registered_on=registered_on,
    )
```

(c) `put_kindergartens` 多兩個參數：

```python
async def put_kindergartens(db, rows, *, now=NOW, school_year=115, force=False, backfill=None, listed_places=None):
    report = await apply_kindergartens(
        db, rows, synced_at=now, school_year=school_year, force=force, backfill=backfill, listed_places=listed_places,
    )
    await db.commit()
    return report
```

(d) 在 `test_a_school_year_rollover_alone_is_not_a_kind_change` 之前（「幼兒園」那一段的最後）加：

```python
# ---- 幼兒園：改名與換承辦（2026-10-15 規格 §4） ----

OPENED = date(1996, 10, 14)


async def test_a_renamed_kindergarten_is_retired_without_a_closure(db_session):
    """同地址、同設立日的另一筆出現：舊名下架、不寫停辦；新名的設立日很舊，也不算新設。"""
    await put_kindergartens(db_session, [kg("k1"), kg("old", address="堅如路46號", registered_on=OPENED)])
    report = await put_kindergartens(
        db_session, [kg("k1"), kg("new", address="堅如路46號", registered_on=OPENED)], now=later(7)
    )
    assert (report.closed, report.renamed, report.backfilled) == (0, 1, 0)
    assert await events(db_session) == []
    assert await active_ids(db_session, GeoKindergarten) == ["k1", "new"]


async def test_same_address_with_a_different_opening_date_is_a_closure(db_session):
    """同地址換了一所新立案的園（設立日不同）：舊的照記停辦。"""
    await put_kindergartens(db_session, [kg("k1"), kg("old", address="堅如路46號", registered_on=OPENED)])
    report = await put_kindergartens(
        db_session, [kg("k1"), kg("new", address="堅如路46號", registered_on=date(2026, 9, 1))], now=later(7)
    )
    assert (report.closed, report.renamed) == (1, 0)
    assert await events(db_session) == [("kindergarten", "old", "closed", date(2026, 10, 21), None, None)]


async def test_without_an_opening_date_the_rename_rule_does_not_apply(db_session):
    await put_kindergartens(db_session, [kg("k1"), kg("old", address="堅如路46號")])
    report = await put_kindergartens(db_session, [kg("k1"), kg("new", address="堅如路46號")], now=later(7))
    assert (report.closed, report.renamed) == (1, 0)


async def test_a_rename_is_recognised_from_the_registry_before_the_new_entry_has_coordinates(db_session):
    """新名在名單上、但 kiang 還沒算座標（這一輪 rows 沒有它）：用名單的（地址、設立日）認出改名，不寫假停辦。"""
    await put_kindergartens(db_session, [kg("k1"), kg("old", address="堅如路46號", registered_on=OPENED)])
    report = await put_kindergartens(
        db_session, [kg("k1")], now=later(7), listed_places=frozenset({("堅如路46號", OPENED)})
    )
    assert (report.closed, report.renamed) == (0, 1)
    assert await events(db_session) == []
    assert await active_ids(db_session, GeoKindergarten) == ["k1"]


# ---- 幼兒園：回補（2026-10-15 規格 §5） ----


async def test_a_backfilled_closure_is_dated_when_it_left_the_list(db_session):
    await put_kindergartens(db_session, [kg("k1"), kg("k2")])
    backfill = {"k2": ClosureBackfill("closed", date(2026, 9, 15))}
    report = await put_kindergartens(db_session, [kg("k1")], now=later(7), backfill=backfill)
    assert (report.closed, report.backfilled, report.renamed) == (1, 1, 0)
    assert await events(db_session) == [("kindergarten", "k2", "closed", date(2026, 9, 15), None, None)]
    await put_kindergartens(db_session, [kg("k1")], now=later(7), backfill=backfill)  # 同一天重跑
    await put_kindergartens(db_session, [kg("k1")], now=later(14), backfill=backfill)  # 下一輪
    assert len(await events(db_session)) == 1


async def test_a_backfilled_closure_without_a_date_is_retired_quietly(db_session):
    """2025-06 前就離開名單的：只下架，不在 2026 年冒出一筆停辦。"""
    await put_kindergartens(db_session, [kg("k1"), kg("k2")])
    report = await put_kindergartens(db_session, [kg("k1")], now=later(7), backfill={"k2": ClosureBackfill("closed", None)})
    assert (report.closed, report.backfilled) == (0, 1)
    assert await events(db_session) == []
    assert await active_ids(db_session, GeoKindergarten) == ["k1"]


async def test_a_backfilled_rename_is_retired_quietly(db_session):
    await put_kindergartens(db_session, [kg("k1"), kg("k2")])
    report = await put_kindergartens(
        db_session, [kg("k1")], now=later(7), backfill={"k2": ClosureBackfill("renamed", date(2026, 3, 25))}
    )
    assert (report.closed, report.renamed, report.backfilled) == (0, 1, 0)
    assert await events(db_session) == []


async def test_the_backfill_file_wins_over_the_rename_rule(db_session):
    await put_kindergartens(db_session, [kg("k1"), kg("old", address="堅如路46號", registered_on=OPENED)])
    report = await put_kindergartens(
        db_session, [kg("k1"), kg("new", address="堅如路46號", registered_on=OPENED)], now=later(7),
        backfill={"old": ClosureBackfill("closed", date(2026, 9, 15))},
    )
    assert (report.closed, report.renamed, report.backfilled) == (1, 0, 1)
    assert await events(db_session) == [("kindergarten", "old", "closed", date(2026, 9, 15), None, None)]


async def test_backfill_entries_only_matter_when_a_kindergarten_leaves(db_session):
    """檔裡的園所還在名單上、或資料表根本沒有它：什麼都不做。"""
    backfill = {"k1": ClosureBackfill("closed", date(2026, 9, 15)), "ghost": ClosureBackfill("closed", date(2026, 9, 1))}
    await put_kindergartens(db_session, [kg("k1")])
    report = await put_kindergartens(db_session, [kg("k1")], now=later(7), backfill=backfill)
    assert (report.closed, report.backfilled) == (0, 0)
    assert await events(db_session) == []
    assert await active_ids(db_session, GeoKindergarten) == ["k1"]


async def test_a_backfilled_kindergarten_that_comes_back_later_reopens(db_session):
    """回補日期 09-15 離回來那天 10-28 超過 30 天：不是漏收，停辦留著、另寫重新營業。"""
    await put_kindergartens(db_session, [kg("k1"), kg("k2")])
    await put_kindergartens(
        db_session, [kg("k1")], now=later(7), backfill={"k2": ClosureBackfill("closed", date(2026, 9, 15))}
    )
    report = await put_kindergartens(db_session, [kg("k1"), kg("k2")], now=later(14))
    assert (report.opened, report.cancelled_closures) == (1, 0)
    assert await events(db_session) == [
        ("kindergarten", "k2", "closed", date(2026, 9, 15), None, None),
        ("kindergarten", "k2", "opened", date(2026, 10, 28), None, None),
    ]
```

- [ ] **Step 6: 跑測試確認失敗**

Run: `PY pytest -q -p no:cacheprovider tests/test_geo_providers.py`
Expected: FAIL（`TypeError: apply_kindergartens() got an unexpected keyword argument 'backfill'`），既有測試也因 `put_kindergartens` 傳新參數而失敗。

- [ ] **Step 7: 實作 providers 改動**

Modify `backend/app/admissions/geo/providers.py`：

(a) import 區：

```python
from collections.abc import Callable, Mapping
from collections.abc import Set as AbstractSet
```

（取代原本的 `from collections.abc import Callable`），並加：

```python
from app.admissions.geo.closure_backfill import ClosureBackfill
```

(b) 模組 docstring 的「- 這次名單沒有、上次營業中的 → 標成停辦（is_active 假，列留著）並寫 closed 事件；」後面加一行：

```
  幼兒園另有兩個例外（2026-10-15）：回補檔指定的依檔處理；同地址同設立日的另一筆在新名單上＝改名或換承辦，只下架；
```

(c) `ChangeReport` 加兩個欄位（放在 `cancelled_closures` 後面）：

```python
    renamed: int = 0  # 幼兒園改名或換承辦：下架、不寫停辦（2026-10-15）
    backfilled: int = 0  # 幼兒園依回補檔處理的下架（有日期的寫停辦事件，沒日期的只下架）
```

(d) 在 `_KINDERGARTEN = ...` 之前加型別別名：

```python
# 一所要下架時的判斷（2026-10-15 規格 §4）：None＝一般停辦（寫在同步當天）；
# 否則 (計數名稱 "renamed"／"backfilled", 停辦事件的日期或 None＝只下架)。
Retire = Callable[[Any], tuple[str, date | None] | None]
```

(e) `_apply` 的簽名加 `retire: Retire | None = None`（放在 `kind_change` 後面）；`add_event` 改成可指定日期：

```python
    def add_event(
        source_id: str, change: str, old: str | None = None, new: str | None = None, *, on: date | None = None
    ) -> None:
        pending.append(
            {
                "provider": spec.provider, "source_id": source_id, "change": change,
                "occurred_on": on or today, "old_value": old, "new_value": new,
            }
        )
```

(f) 把 `_apply` 裡的下架迴圈：

```python
    for source_id, row in existing.items():
        if row.is_active and source_id not in incoming:
            row.is_active = False
            add_event(source_id, "closed")
```

換成：

```python
    retired = {"renamed": 0, "backfilled": 0}
    for source_id, row in existing.items():
        if row.is_active and source_id not in incoming:
            row.is_active = False
            decision = retire(row) if retire is not None else None
            if decision is None:
                add_event(source_id, "closed")
                continue
            counter, closed_on = decision
            retired[counter] += 1
            if closed_on is not None:
                add_event(source_id, "closed", on=closed_on)
```

(g) `_apply` 結尾的 `return ChangeReport(...)` 加兩個參數：

```python
        renamed=retired["renamed"],
        backfilled=retired["backfilled"],
```

(h) `apply_kindergartens` 換成：

```python
async def apply_kindergartens(
    db: AsyncSession,
    rows: list[KindergartenRow],
    *,
    synced_at: datetime,
    school_year: int,
    force: bool = False,
    backfill: Mapping[str, ClosureBackfill] | None = None,
    listed_places: AbstractSet[tuple[str, date]] | None = None,
) -> ChangeReport:
    """幼兒園名單換新並記錄異動（不 commit）。school_year：這一輪解析名單用的學年，舊列的類型用它重算（P7）。
    backfill：回補檔（2026-10-15 規格 §5），只在某所這一輪要下架時查。listed_places：教育部名單上的（地址、設立日），
    新名稱還沒有座標、不在 rows 裡時也認得出改名（規格 §4）；rows 本身的（地址、設立日）一律算進去。"""

    private_base = ("private", "quasi_public")
    incoming = {row.source_id: asdict(row) for row in rows}
    same_place = {
        (values["address"], values["registered_on"]) for values in incoming.values() if values["registered_on"] is not None
    }
    same_place |= set(listed_places or ())

    def kind_change(old: GeoKindergarten, values: dict[str, Any]) -> tuple[str, str] | None:
        # 舊、新都是私立基底而且兩邊都有準公共期間：這是續約或換期間（例如 113-115 → 116-118），不是類型變動。
        # 否則高雄 735 所裡約 268 所「113-115」在 116 學年續約那一輪，三公里內會冒出一串假異動
        # （來源在學年更替前先公布 → 寫成「準公共 → 私立」，之後才公布 → 寫成「私立 → 準公共」，都是假的）。
        # 加入（舊列沒有期間）、退出（新期間為空）、公立／非營利／私立之間的改變，仍然照算。
        if (
            old.kind in private_base and values["kind"] in private_base
            and old.pre_public_period and values["pre_public_period"]
        ):
            return None
        before = kind_as_of(old.kind, old.pre_public_period, school_year)
        return (before, values["kind"]) if before != values["kind"] else None

    def retire(old: GeoKindergarten) -> tuple[str, date | None] | None:
        # 回補檔優先，其次同地址同設立日＝改名或換承辦（設立日不明不比），最後一般停辦。
        entry = (backfill or {}).get(old.source_id)
        if entry is not None:
            return ("renamed", None) if entry.reason == "renamed" else ("backfilled", entry.left_on)
        if old.registered_on is not None and (old.address, old.registered_on) in same_place:
            return ("renamed", None)
        return None

    return await _apply(
        db, _KINDERGARTEN, incoming,
        synced_at=synced_at, force=force, kind_change=kind_change, retire=retire,
    )
```

- [ ] **Step 8: 跑測試確認通過**

Run: `PY pytest -q -p no:cacheprovider tests/test_geo_providers.py tests/test_geo_closure_backfill.py tests/test_geo_changes.py`
Expected: PASS（全部；既有測試數不變、新增 10＋7 個）

- [ ] **Step 9: Commit**

```bash
git add backend/app/admissions/geo/closure_backfill.py backend/app/admissions/geo/providers.py backend/tests/test_geo_closure_backfill.py backend/tests/test_geo_providers.py
git commit -m "feat(admissions): 幼兒園下架時依回補檔或同地址同設立日判斷，改名不記停辦" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 以教育部名單判斷營業中（解析、下載、設定）

**Files:**
- Modify: `backend/app/admissions/geo/kindergartens.py`
- Modify: `backend/app/admissions/geo/sync.py`（常數區約 114 行、`sync_kindergartens` 530–565 行、`run_geo_sync` 1240–1290 行）
- Modify: `backend/app/config.py`（約 71–73 行、154–167 行）
- Modify: `backend/tests/fixtures/geo/preschools-sample.json`
- Create: `backend/tests/fixtures/geo/kindergarten-registry-sample.csv`
- Modify: `backend/tests/geo_helpers.py`
- Modify: `backend/tests/test_geo_kindergartens.py`、`test_geo_sync.py`、`test_geo_babycare_sync.py`、`test_geo_loop.py`

**Interfaces:**
- Consumes: Task 1 的 `apply_kindergartens(listed_places=)`、`ChangeReport.renamed／backfilled`。
- Produces:
  - `kindergartens.Registry(keys: frozenset[tuple[str, str]], places: frozenset[tuple[str, date]])`（frozen dataclass）
  - `kindergartens.registry_key(reg_docno: object, title: object) -> tuple[str, str]`
  - `kindergartens.place_key(address: object, reg_date: object) -> tuple[str, date] | None`
  - `kindergartens.parse_registry(text: str) -> Registry`（格式錯丟 `KindergartenFormatError("教育部幼兒園名單格式不對")`）
  - `kindergartens.parse_preschools(data, *, registry: Registry, school_year: int, report: ParseReport | None = None)`
  - `kindergartens.ParseReport.unplaced: int`
  - `sync.KINDERGARTEN_REGISTRY_MAX_BYTES`、`sync.sync_kindergartens(..., file, registry_file)`、`sync.run_geo_sync(..., kindergartens_registry_file: Path | None = None)`（只給一個丟 `ValueError`，訊息含「要一起給」）
  - `Settings.geo_kindergartens_registry_url`
  - 測試輔助 `tests.geo_helpers.REGISTRY_SAMPLE`、`sample_registry() -> Registry`、`registry_of(data, *, without=()) -> Registry`

- [ ] **Step 1: 樣本補 `reg_docno`、新增樣本名單**

在 `backend/` 下執行（只加欄位，其他內容與排版不變；原檔是 `json.dumps(indent=1, ensure_ascii=False)` 加結尾換行）：

```bash
python3 -I - <<'EOF'
import json
from pathlib import Path

path = Path("tests/fixtures/geo/preschools-sample.json")
docnos = {
    "016cc701-ac12-4f88-9457-5eb6431ed449": "高市教三字第01446號",
    "e464ae13-0cbc-4a8e-9289-de0c18abc263": "高市教三字第0920025091號",
    "0f26d968-d574-4e8f-bbdd-2b88a65efaf1": "高市社局五字第0970029528號",
    "f52ff84f-335d-472e-955c-d441c562255f": "高市教育三字第22053號",
    "e517b294-6109-4c89-a847-07a260585e6c": "85府教國字第182908號",
    "52c587f0-8993-46f2-b518-4b42f2e5941f": "府教特字第0940223874號",
    "e7c0d4ca-ade9-4f31-84a1-f33764179e24": "高市教幼字第11336452400號",
    "008b76eb-8e63-4089-ae9b-5a0b6c7b7d0e": "82府社福字第146481號",
    "5a2708ce-9f97-4793-82fd-247c00de16e9": "高市教幼字第10634859100號",
    "cff4213c-c1f6-4269-8e12-aa015c4248b0": "高市教三字第0980018358號",
    "1bf1a3ed-bf89-44dc-bf1a-06e8dca40808": "高市教幼字第10935866800號",
    "bc460930-0f69-42d1-bf99-976c5199e2f5": "高市教幼字第11034819200號",
    "00089c75-4393-42f9-ac95-a3e922878004": "南市教國字第28710號",
}
data = json.loads(path.read_text(encoding="utf-8"))
for feature in data["features"]:
    props = feature["properties"]
    props["reg_docno"] = docnos[props["id"]]
path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
EOF
git diff --stat tests/fixtures/geo/preschools-sample.json
```

Expected: `1 file changed, 13 insertions(+)`（只多 13 行 `reg_docno`）。

Create `backend/tests/fixtures/geo/kindergarten-registry-sample.csv`（逐字，`\n` 換行，無 BOM）：

```
reg_no,reg_docno,reg_date,title,owner,city,town,type,address,floor,size,size_in,size_out,tel,url,count_approved,shuttle,pre_public,is_free5,is_after,penalty,has_slip
高市教幼字第10138771900號,高市教三字第01446號,,高雄市私立常春藤幼兒園,,高雄市,三民區,私立,[807]義華路68號,,,,,(07)3928366#7,,210,,無,,,有,
高市教幼字第10132493200號,高市教三字第0920025091號,,高雄市私立何嘉仁幼兒園,,高雄市,三民區,私立,[807]澄和路16號,,,,,(07)3929678,,150,,無,,,有,
高市教幼字第10132801800號,高市社局五字第0970029528號,,高雄市私立保羅幼兒園,,高雄市,三民區,私立,[807]褒揚街276號1樓,,,,,(07)3837050,,88,,113-115,,,有,
高市教幼字第11233339300號,高市教育三字第22053號,,高雄市私立義華幼兒園,,高雄市,三民區,私立,[807]應安街112號,,,,,(07)3834406,,150,,113-115,,,有,
高市教幼字第10133854400號,85府教國字第182908號,,高雄市私立愛爾蘭幼兒園,,高雄市,鳥松區,私立,[833]本館路3-13號,,,,,(07)3705788,,136,,無,,,有,
高市教幼字第11430152000號,府教特字第0940223874號,,高雄市私立新美倫幼兒園,,高雄市,鳳山區,私立,[830]文龍路33號,,,,,(07)7775900,,360,,無,,,無,
高市教幼字第11435914500號,高市教幼字第11336452400號,,高雄市灣內非營利幼兒園,,高雄市,仁武區,非營利,[814]八德東路568號,,,,,(07)3730272,,182,,無,,,無,
高市教幼字第11232748300號,高市教幼字第10634859100號,,高雄市光武非營利幼兒園(委託高雄市教保人員職業工會辦理),,高雄市,三民區,非營利,[807]光武路35號,,,,,(07)3853955,,106,,無,,,無,
高市教幼字第11336439400號,高市教三字第0980018358號,,高雄市三民區東光國民小學附設幼兒園,,高雄市,三民區,公立,[807]黃興路206號,,,,,(07)3839350#71,,76,,無,,,無,
高市教幼字第11034819200號,高市教幼字第11034819200號,,高雄市私立常春藤仁武幼兒園,,高雄市,仁武區,私立,[814]京吉一路102號,,,,,(07)3757081,,346,,無,,,有,
```

（樣本 JSON 取自 10-08，當時愛爾蘭還在名單上；兩筆 `is_active=0` 與臺南市那筆不在名單。）

- [ ] **Step 2: 測試輔助**

Modify `backend/tests/geo_helpers.py`：

(a) 模組 docstring 的 `- preschools-sample.json：…` 那段後面加一段：

```
- kindergarten-registry-sample.csv：上面那份樣本對應的教育部名單（kiang docs/data/高雄市.csv 的格式），
  高雄營業中 10 所；兩筆停業與臺南市那筆不在名單（2026-10-15 起營業中以名單為準）。
```

(b) import 改成：

```python
from app.admissions.geo.kindergartens import Registry, parse_preschools, parse_registry, place_key, registry_key
```

(c) `FIXTURES = ...` 下面加：

```python
REGISTRY_SAMPLE = FIXTURES / "kindergarten-registry-sample.csv"
```

(d) `sample_preschools()` 後面加：

```python
def sample_registry() -> Registry:
    return parse_registry(REGISTRY_SAMPLE.read_text(encoding="utf-8"))


def registry_of(data: dict, *, without: tuple[str, ...] = ()) -> Registry:
    """測試用：把 data 裡每一筆（id 不在 without 的）都當成在教育部名單上。鍵照原樣（空的文號、名稱也收）。"""
    features = data.get("features") if isinstance(data, dict) else None
    props = [feature.get("properties") or {} for feature in (features if isinstance(features, list) else []) if isinstance(feature, dict)]
    kept = [item for item in props if isinstance(item, dict) and item.get("id") not in without]
    places = (place_key(item.get("address"), item.get("reg_date")) for item in kept)
    return Registry(
        keys=frozenset(registry_key(item.get("reg_docno"), item.get("title")) for item in kept),
        places=frozenset(place for place in places if place is not None),
    )
```

(e) `load_geo_samples` 裡：

```python
    rows = parse_preschools(sample_preschools(), registry=sample_registry(), school_year=SAMPLE_SCHOOL_YEAR)
```

- [ ] **Step 3: 寫解析的失敗測試**

Modify `backend/tests/test_geo_kindergartens.py`：

(a) import 改成：

```python
from app.admissions.geo.kindergartens import (
    KindergartenFormatError,
    ParseReport,
    Registry,
    _int_or_none,
    kind_as_of,
    nearby,
    parse_preschools,
    parse_registry,
)
from app.admissions.geo.models import GeoDatasetStatus, GeoDoorplate, GeoKindergarten
from app.admissions.geo.providers import apply_kindergartens
from app.common.timezones import today_local
from tests.geo_helpers import (
    SAMPLE_LABEL, SAMPLE_TAG, YIHUA_POINT, load_geo_samples, registry_of, sample_preschools, sample_registry,
)
```

(b) 在 `_by_name` 後面加：

```python
def _sample(school_year: int = 115, report: ParseReport | None = None):
    return parse_preschools(sample_preschools(), registry=sample_registry(), school_year=school_year, report=report)


def _parse(data, *, school_year: int = 115, report: ParseReport | None = None):
    """合成資料：每一筆都在名單上（名單的取捨另有測試）。"""
    return parse_preschools(data, registry=registry_of(data), school_year=school_year, report=report)
```

(c) 全檔替換呼叫：
- `parse_preschools(sample_preschools(), school_year=115)` → `_sample()`
- `parse_preschools(sample_preschools(), school_year=116)` → `_sample(116)`
- `parse_preschools(data, school_year=115)` → `_parse(data)`
- `parse_preschools(_collection(_feature(id="x", reg_date=raw)), school_year=115)` → `_parse(_collection(_feature(id="x", reg_date=raw)))`
- `parse_preschools(_collection(_feature(id="x")), school_year=115)` → `_parse(_collection(_feature(id="x")))`
- `parse_preschools(data, school_year=115, report=report)` → `_parse(data, report=report)`
- `parse_preschools(\n        _collection(...), school_year=115, report=report\n    )`（`test_overlong_fields_skip_the_row_and_are_counted`）→ `_parse(_collection(_feature(id="ok"), _feature(**{"id": "long", **overrides})), report=report)`

替換後 `grep -n "parse_preschools(" tests/test_geo_kindergartens.py` 只剩 `_sample`、`_parse` 兩個輔助函式裡的兩處，和下面 (e) 新測試裡直接帶 `registry=` 的呼叫。

(d) 改兩個既有測試：

`test_only_active_kaohsiung_kindergartens_are_kept` 整個換成：

```python
def test_only_kaohsiung_kindergartens_on_the_registry_are_kept():
    report = ParseReport()
    rows = _sample(report=report)
    names = {row.name for row in rows}
    assert len(rows) == 10
    assert "臺南市私立耶魯幼兒園" not in names  # 非高雄市
    assert "高雄市私立小太陽哈佛幼兒園" not in names  # 不在名單
    assert "高雄市英明非營利幼兒園" not in names  # 不在名單
    assert (report.skipped, report.unplaced) == (0, 0)
```

`test_inactive_as_string_and_other_city_are_dropped` 整個換成：

```python
def test_membership_in_the_registry_decides_not_is_active():
    """kiang 的 is_active 不會變回 0（2026-10-15 規格 §1）：只看在不在名單，is_active 不管。"""
    data = _collection(
        _feature(id="listed-but-0", title="甲", is_active=0),
        _feature(id="gone-but-1", title="乙", is_active=1),
        _feature(id="tainan", title="丙", city="臺南市"),
    )
    rows = parse_preschools(data, registry=registry_of(data, without=("gone-but-1",)), school_year=115)
    assert [row.source_id for row in rows] == ["listed-but-0"]
```

`_feature` 的預設 `props` 多一個鍵（放在 `"reg_no"` 後面）：`"reg_docno": "府教字第1號",`

`test_report_counts_only_rows_that_were_meant_to_be_kept` 換成：

```python
def test_report_counts_only_rows_that_were_meant_to_be_kept():
    """高雄市以外或不在名單的不算「略過」（本來就不要）；在名單上卻不能用的才計數。"""
    report = ParseReport()
    data = _collection(
        _feature(id="ok"),
        _feature(id="tainan", city="臺南市"),
        _feature(id="closed", title="已停辦幼兒園"),
        _feature(id="no-name", title=""),
        _feature(id="odd-type", type="其他"),
        _feature(id="no-coordinates", coordinates=None),
    )
    rows = parse_preschools(data, registry=registry_of(data, without=("closed",)), school_year=115, report=report)
    assert [row.source_id for row in rows] == ["ok"]
    assert report.skipped == 3
```

(e) 檔尾加：

```python
# ---- 教育部名單（2026-10-15 規格 §3.1） ----

REGISTRY_HEADER = "reg_no,reg_docno,reg_date,title,owner,city,town,type,address\n"


def test_registry_keys_and_places():
    text = (
        REGISTRY_HEADER
        + "x,府教字第1號,1996/10/14,甲幼兒園,某人,高雄市,三民區,私立,[807]堅如路46號\n"
        + ",府教字第2號,,乙幼兒園,,高雄市,三民區,私立,[807]某路2號\n"
    )
    registry = parse_registry(text)
    assert registry.keys == {("府教字第1號", "甲幼兒園"), ("府教字第2號", "乙幼兒園")}
    assert registry.places == {("堅如路46號", date(1996, 10, 14))}  # 設立日不明的不能拿來認改名


def test_registry_tolerates_crlf_quotes_and_spaces():
    text = REGISTRY_HEADER.replace("\n", "\r\n") + 'x," 府教字第1號 ",1996/10/14," 甲幼兒園 ",,高雄市,三民區,私立,"[807]瑞孝街77號、79號"\r\n'
    registry = parse_registry(text)
    assert registry.keys == {("府教字第1號", "甲幼兒園")}
    assert registry.places == {("瑞孝街77號、79號", date(1996, 10, 14))}


def test_registry_rows_without_a_docno_or_title_are_ignored():
    text = REGISTRY_HEADER + ",,,甲,,高雄市,,,\n,府教字第2號,,,,高雄市,,,\n,府教字第3號,,丙,,高雄市,,,\n"
    assert parse_registry(text).keys == {("府教字第3號", "丙")}


@pytest.mark.parametrize(
    "text",
    ["", "<!DOCTYPE html><html><body>錯誤頁</body></html>\n", "reg_no,title\nx,甲\n", REGISTRY_HEADER],
    ids=["empty", "html", "missing-columns", "header-only"],
)
def test_a_registry_that_is_not_the_moe_list_is_rejected(text):
    with pytest.raises(KindergartenFormatError, match="教育部幼兒園名單格式不對"):
        parse_registry(text)


def test_keys_are_matched_after_trimming_spaces():
    data = _collection(_feature(id="a", title=" 甲幼兒園 ", reg_docno=" 府教字第1號"))
    registry = Registry(keys=frozenset({("府教字第1號", "甲幼兒園")}), places=frozenset())
    assert [row.source_id for row in parse_preschools(data, registry=registry, school_year=115)] == ["a"]


def test_registry_entries_without_a_feature_are_counted_as_unplaced():
    """名單有、kiang 還沒算座標的：不收，另外計數（不算略過）。"""
    data = _collection(_feature(id="a", title="甲"))
    listed = registry_of(data)
    registry = Registry(keys=listed.keys | {("府教字第9號", "還沒有座標的幼兒園")}, places=listed.places)
    report = ParseReport()
    assert [row.source_id for row in parse_preschools(data, registry=registry, school_year=115, report=report)] == ["a"]
    assert (report.unplaced, report.skipped) == (1, 0)
```

- [ ] **Step 4: 跑測試確認失敗**

Run: `PY pytest -q -p no:cacheprovider tests/test_geo_kindergartens.py`
Expected: FAIL（`ImportError: cannot import name 'Registry'`）

- [ ] **Step 5: 實作解析**

Modify `backend/app/admissions/geo/kindergartens.py`：

(a) 模組 docstring 第一段的「只留高雄市、營業中（is_active＝1）的園所；」改成：

```
只留高雄市、**在教育部名單上**的園所（2026-10-15：名單是 kiang 每天從全國教保資訊網爬下的
docs/data/高雄市.csv；preschools.json 的 is_active 一旦是 1 就不會變回 0，停辦的會一直留著，不能用）；
```

並把「高雄市營業中的園所若缺必要欄位、…（高雄市以外、停業的本來就不要，不算）」那句的「營業中」改成「在名單上」、「停業的」改成「不在名單的」。

(b) import 區加：

```python
import csv
import io
```

(c) `_INT4_MAX = ...` 後面加：

```python
REGISTRY_COLUMNS = ("reg_docno", "title", "address", "reg_date")
REGISTRY_FORMAT_MESSAGE = "教育部幼兒園名單格式不對"
```

(d) `ParseReport` 加欄位：

```python
    unplaced: int = 0  # 名單有、preschools.json 沒有對應的園所（kiang 還沒算座標）；只進日誌，不算 skipped
```

(e) 在 `ParseReport` 後面加：

```python
@dataclass(frozen=True)
class Registry:
    """教育部名單（2026-10-15 規格 §3.1）。keys：營業中的（立案文號、名稱），就是 kiang 產生 uuid 的鍵；
    places：（地址、設立日），新名稱還沒有座標時也認得出改名（規格 §4）。"""

    keys: frozenset[tuple[str, str]]
    places: frozenset[tuple[str, date]]


def registry_key(reg_docno: object, title: object) -> tuple[str, str]:
    """名單與 preschools.json 兩邊用同一個寫法比對：去頭尾空白。"""
    return str(reg_docno or "").strip(), str(title or "").strip()


def place_key(address: object, reg_date: object) -> tuple[str, date] | None:
    """改名判斷用的（地址、設立日）：地址去掉郵遞區號（和 KindergartenRow.address 同一個寫法）；設立日不明或沒地址回 None。"""
    opened = _registered_on(reg_date)
    text = _POSTAL_PREFIX.sub("", str(address or "").strip())
    return (text, opened) if opened is not None and text else None


def parse_registry(text: str) -> Registry:
    """kiang docs/data/高雄市.csv（呼叫端已用 utf-8-sig 解碼）→ Registry。只讀立案文號、名稱、地址、設立日四欄，
    負責人不讀。沒有這四欄（例如抓到 HTML 錯誤頁）或一列可用的都沒有 → KindergartenFormatError。"""
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or not set(REGISTRY_COLUMNS) <= set(reader.fieldnames):
        raise KindergartenFormatError(REGISTRY_FORMAT_MESSAGE)
    keys: set[tuple[str, str]] = set()
    places: set[tuple[str, date]] = set()
    for row in reader:
        key = registry_key(row.get("reg_docno"), row.get("title"))
        if not all(key):
            continue
        keys.add(key)
        place = place_key(row.get("address"), row.get("reg_date"))
        if place is not None:
            places.add(place)
    if not keys:
        raise KindergartenFormatError(REGISTRY_FORMAT_MESSAGE)
    return Registry(frozenset(keys), frozenset(places))
```

（`_registered_on`、`_POSTAL_PREFIX` 在同一個模組前面已定義；`place_key` 放在它們之後即可。）

(f) `parse_preschools` 換成：

```python
def parse_preschools(
    data: dict, *, registry: Registry, school_year: int, report: ParseReport | None = None
) -> list[KindergartenRow]:
    features = data.get("features") if isinstance(data, dict) else None
    if not isinstance(features, list):
        raise KindergartenFormatError("幼兒園資料不是 GeoJSON FeatureCollection")
    report = report if report is not None else ParseReport()
    rows: list[KindergartenRow] = []
    seen: set[str] = set()
    listed: set[tuple[str, str]] = set()
    for feature in features:
        props = (feature.get("properties") or {}) if isinstance(feature, dict) else None
        if not isinstance(props, dict):
            report.skipped += 1
            continue
        if str(props.get("city") or "").replace("臺", "台") != "高雄市":
            continue
        key = registry_key(props.get("reg_docno"), props.get("title"))
        if key not in registry.keys:
            continue  # 不在教育部名單＝停辦或改名（kiang 的 is_active 不會變回 0，不看它）
        listed.add(key)
        row = _row(feature, props, school_year)
        if row is None or row.source_id in seen:
            report.skipped += 1
            continue
        seen.add(row.source_id)
        rows.append(row)
    report.unplaced = len(registry.keys - listed)
    if not rows:
        raise KindergartenFormatError("幼兒園資料裡沒有高雄市營業中的園所")
    return rows
```

`_row` 的 docstring「一筆高雄市營業中的園所」改成「一筆高雄市、在名單上的園所」。

- [ ] **Step 6: 跑解析測試確認通過**

Run: `PY pytest -q -p no:cacheprovider tests/test_geo_kindergartens.py`
Expected: PASS

- [ ] **Step 7: 寫同步的失敗測試**

Modify `backend/tests/test_geo_sync.py`：

(a) 常數區（`BABYCARE_URL = ...` 下面）加：

```python
REGISTRY_URL = "https://kiang.github.io/ap.ece.moe.edu.tw/data/%E9%AB%98%E9%9B%84%E5%B8%82.csv"
```

並從 `tests.geo_helpers` 多 import `REGISTRY_SAMPLE`；`app.admissions.geo.models` 的 import 若沒有 `GeoProviderEvent` 就加上；`from app.admissions.geo import providers` 若沒有就加上。

(b) `_site` 的參數加 `registry: bytes | None = None, registry_status: int = 200,`，handler 在 `if url == KIANG_URL:` 之前加：

```python
        if url == REGISTRY_URL:
            body = registry if registry is not None else REGISTRY_SAMPLE.read_bytes()
            return httpx.Response(registry_status, content=body, headers={"content-type": "text/csv; charset=utf-8"})
```

docstring 的「kiang＋」改成「kiang（幼兒園 JSON 與教育部名單）＋」。

(c) 既有呼叫補名單檔（`kindergartens_file=X` → `kindergartens_file=X, kindergartens_registry_file=REGISTRY_SAMPLE`）：`test_files_never_touch_the_network`、`test_kindergarten_file_with_bom`、`test_clean_sample_skips_nothing`、`test_bad_kindergarten_entries_are_skipped_and_counted` 四處。

(d) `test_bad_kindergarten_entries_are_skipped_and_counted` 加的兩筆要在名單上才會被計入略過：兩個 `properties` 各加 `"reg_docno": "府教字第8號"`、`"reg_docno": "府教字第9號"`，並在寫 JSON 之後加：

```python
    registry = tmp_path / "registry.csv"
    long_title = "園" * 121
    registry.write_text(
        REGISTRY_SAMPLE.read_text(encoding="utf-8")
        + f"x,府教字第8號,,{long_title},,高雄市,三民區,私立,[807]某路1號\n"
        + "x,府教字第9號,,遠方,,高雄市,三民區,私立,[807]某路2號\n",
        encoding="utf-8",
    )
```

（欄數比標頭少沒關係，`csv.DictReader` 把缺的欄位當 `None`。）

那一處 `run_geo_sync` 改成 `kindergartens_file=path, kindergartens_registry_file=registry`。

(e) 檔尾（`_TrackedStream` 之前的「延後項目」段落之前即可）加：

```python
# ---- 教育部名單（2026-10-15 規格 §3） ----


async def test_the_registry_decides_which_kindergartens_are_open(app, small_minimum):
    """名單沒有的（即使 kiang 標營業中）不收；名單與 JSON 都從網路抓。"""
    trimmed = "".join(
        line for line in REGISTRY_SAMPLE.read_text(encoding="utf-8").splitlines(keepends=True) if "愛爾蘭" not in line
    )
    transport, seen = _site(registry=trimmed.encode())
    result = await _sync(app, transport)
    assert result.kindergartens == "updated"
    assert REGISTRY_URL in seen and KIANG_URL in seen
    assert (await _counts(app))[1] == 9


@pytest.mark.parametrize(
    ("body", "status", "error"),
    [
        (b"<!DOCTYPE html><html><body>error</body></html>", 200, "教育部幼兒園名單格式不對"),
        (b"", 200, "教育部幼兒園名單格式不對"),
        (b"not found", 404, "下載失敗：HTTP 404"),
    ],
    ids=["錯誤頁", "空檔", "404"],
)
async def test_a_broken_registry_fails_the_kindergarten_sync_and_keeps_the_data(app, small_minimum, body, status, error):
    good, _ = _site()
    await _sync(app, good)
    broken, _ = _site(registry=body, registry_status=status)
    result = await _sync(app, broken, force=True)
    assert result.kindergartens == "failed"
    assert (await _status(app, "kindergartens")).last_error == error
    async with app.state.session_factory() as db:
        open_now = select(func.count()).select_from(GeoKindergarten).where(GeoKindergarten.is_active.is_(True))
        assert await db.scalar(open_now) == 10
        assert await db.scalar(select(func.count()).select_from(GeoProviderEvent)) == 0


async def test_a_truncated_registry_is_refused_by_the_truncation_guard(app, monkeypatch, tmp_path):
    """名單只剩 3 所：營業中少於上次 80%，不換版、沒有一所被標停辦。"""
    monkeypatch.setattr(providers, "TRUNCATION_MIN_PREVIOUS", 5)
    sample_json = FIXTURES / "preschools-sample.json"
    first = await run_geo_sync(
        app.state.session_factory, app.state.settings,
        kindergartens_file=sample_json, kindergartens_registry_file=REGISTRY_SAMPLE,
    )
    assert first.kindergartens == "updated"
    short = tmp_path / "registry.csv"
    short.write_text("".join(REGISTRY_SAMPLE.read_text(encoding="utf-8").splitlines(keepends=True)[:4]), encoding="utf-8")
    second = await run_geo_sync(
        app.state.session_factory, app.state.settings, kindergartens_file=sample_json, kindergartens_registry_file=short,
    )
    assert second.kindergartens == "failed"
    assert (await _status(app, "kindergartens")).last_error == providers.SHRUNK_MESSAGE
    async with app.state.session_factory() as db:
        open_now = select(func.count()).select_from(GeoKindergarten).where(GeoKindergarten.is_active.is_(True))
        assert await db.scalar(open_now) == 10
        assert await db.scalar(select(func.count()).select_from(GeoProviderEvent)) == 0


async def test_a_registry_file_with_a_bom_is_read(app, tmp_path):
    bom = tmp_path / "registry.csv"
    bom.write_bytes(b"\xef\xbb\xbf" + REGISTRY_SAMPLE.read_bytes())
    result = await run_geo_sync(
        app.state.session_factory, app.state.settings,
        kindergartens_file=FIXTURES / "preschools-sample.json", kindergartens_registry_file=bom,
    )
    assert result.kindergartens == "updated"
    assert (await _counts(app))[1] == 10


@pytest.mark.parametrize(
    "kwargs",
    [{"kindergartens_file": FIXTURES / "preschools-sample.json"}, {"kindergartens_registry_file": REGISTRY_SAMPLE}],
    ids=["只有 JSON", "只有名單"],
)
async def test_kindergarten_files_must_come_in_pairs(app, kwargs):
    with pytest.raises(ValueError, match="要一起給"):
        await run_geo_sync(app.state.session_factory, app.state.settings, **kwargs)
```

Modify `backend/tests/test_geo_babycare_sync.py`：import 加 `from tests.geo_helpers import FIXTURES, REGISTRY_SAMPLE`（取代原本只 import `FIXTURES` 那行）；`test_a_shrunken_kindergarten_file_is_refused_and_force_lets_it_through` 的兩個 `run_geo_sync(..., kindergartens_file=KINDERGARTEN_SAMPLE ...)` 都補 `kindergartens_registry_file=REGISTRY_SAMPLE`。

Modify `backend/tests/test_geo_loop.py`：
- `from tests.geo_helpers import FIXTURES, lock_is_free` → `from tests.geo_helpers import FIXTURES, REGISTRY_SAMPLE, lock_is_free`
- `SAMPLE_JSON = ...` 下面加 `REGISTRY_CSV = REGISTRY_SAMPLE`
- `offline_sync` 的 `real(session_factory, settings, doorplates_file=SAMPLE_CSV, kindergartens_file=SAMPLE_JSON, **kwargs)` 補 `kindergartens_registry_file=REGISTRY_CSV`
- 四個 `await geo_sync_command(... kindergartens_file=SAMPLE_JSON)` 都補 `kindergartens_registry_file=REGISTRY_CSV`
- `test_geo_settings_defaults` 加一行：

```python
    assert settings.geo_kindergartens_registry_url == "https://kiang.github.io/ap.ece.moe.edu.tw/data/%E9%AB%98%E9%9B%84%E5%B8%82.csv"
```

- `test_geo_settings_reject_unsafe_values` 的參數清單加 `{"geo_kindergartens_registry_url": "http://example.org/r.csv"},`

（`geo_sync_options` 的精確字典斷言留到 Task 3 再改。）

- [ ] **Step 8: 跑測試確認失敗**

Run: `PY pytest -q -p no:cacheprovider tests/test_geo_sync.py -k "registry or kindergarten or files"`
Expected: FAIL（`TypeError: run_geo_sync() got an unexpected keyword argument 'kindergartens_registry_file'`）

- [ ] **Step 9: 實作設定與同步**

Modify `backend/app/config.py`：`geo_kindergartens_url` 那行後面加：

```python
    # 教育部幼兒園名單（2026-10-15）：kiang 每天從全國教保資訊網爬下的高雄市 CSV。營業中以它為準
    # （preschools.json 的 is_active 不會變回 0）；抓不到或格式不對時幼兒園整輪不換版。
    geo_kindergartens_registry_url: str = "https://kiang.github.io/ap.ece.moe.edu.tw/data/%E9%AB%98%E9%9B%84%E5%B8%82.csv"
```

`_geo_kindergartens_url` 驗證函式後面加：

```python
    @field_validator("geo_kindergartens_registry_url")
    @classmethod
    def _geo_kindergartens_registry_url(cls, value: str) -> str:
        value = value.strip()
        if not value.startswith("https://"):
            raise ValueError("WEBSITE_GEO_KINDERGARTENS_REGISTRY_URL 必須是 https:// 網址")
        return value
```

Modify `backend/app/admissions/geo/sync.py`：

(a) import：

```python
from app.admissions.geo.kindergartens import KindergartenFormatError, ParseReport, parse_preschools, parse_registry
```

(b) `KINDERGARTENS_MAX_BYTES = ...` 下面加：

```python
KINDERGARTEN_REGISTRY_MAX_BYTES = 4 * 1024 * 1024  # 教育部高雄市幼兒園名單（正常約 200 KB）
```

(c) `sync_kindergartens` 換成：

```python
async def sync_kindergartens(
    session_factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    client: httpx.AsyncClient | None,
    *,
    now: datetime,
    force: bool,
    file: Path | None,
    registry_file: Path | None,
) -> tuple[str, int]:
    """回傳 (結果, 略過的筆數)。營業中以教育部名單為準（2026-10-15 規格 §3）：名單與 preschools.json
    任一抓不到或格式不對，整輪失敗、資料不動。file 與 registry_file 由 run_geo_sync 保證成對。"""
    status = await _status(session_factory, "kindergartens")
    if file is None and (client is None or (not force and not _provider_due(status, now))):
        return "skipped", 0
    try:
        if file is not None:
            assert registry_file is not None
            registry_text = registry_file.read_text(encoding="utf-8-sig")
            data = json.loads(file.read_text(encoding="utf-8-sig"))
        else:
            assert client is not None
            registry_body, _ = await _fetch_capped(
                client, settings.geo_kindergartens_registry_url, max_bytes=KINDERGARTEN_REGISTRY_MAX_BYTES
            )
            registry_text = registry_body.decode("utf-8-sig")
            body, _ = await _fetch_capped(client, settings.geo_kindergartens_url, max_bytes=KINDERGARTENS_MAX_BYTES)
            # 全國名單有好幾 MB：解析 JSON 與篩選都在執行緒裡做，不占住事件迴圈。
            data = await asyncio.to_thread(json.loads, body)
        registry = parse_registry(registry_text)
        school_year, _ = current_term(today_local())
        report = ParseReport()
        rows = await asyncio.to_thread(parse_preschools, data, registry=registry, school_year=school_year, report=report)
        async with session_factory() as db:
            changes = await providers.apply_kindergartens(
                db, rows, synced_at=now, school_year=school_year, force=force, listed_places=registry.places,
            )
            await db.commit()
        logger.info(
            "幼兒園資料已更新：%s 所，略過 %s 筆、名單有但沒有座標 %s 筆；停辦 %s（依回補檔 %s）、改名下架 %s、"
            "重新營業 %s、類型變動 %s",
            changes.active, report.skipped, report.unplaced, changes.closed, changes.backfilled, changes.renamed,
            changes.opened, changes.kind_changed,
        )
        return "updated", report.skipped
    except Exception as exc:  # noqa: BLE001
        logger.warning("幼兒園資料同步失敗：%s", _error_text(exc), exc_info=True)
        await _record(session_factory, "kindergartens", now=now, error=_error_text(exc))
        return "failed", 0
```

（確認 `_error_text(KindergartenFormatError("教育部幼兒園名單格式不對"))` 回原訊息：既有 `test_broken_kindergarten_feed_does_not_block_doorplates` 已證明 `KindergartenFormatError` 的訊息原樣寫進 `last_error`。）

(d) `run_geo_sync` 的參數在 `kindergartens_file` 後面加 `kindergartens_registry_file: Path | None = None,`；函式一開頭（`async with _exclusive(...)` 之前）加：

```python
    if (kindergartens_file is None) != (kindergartens_registry_file is None):
        raise ValueError("幼兒園檔案要和教育部名單檔一起給（--kindergartens-file、--kindergartens-registry-file）")
```

`file_mode` 的條件不用改（成對保證後 `kindergartens_file is not None` 已足夠）。呼叫處改成：

```python
                work=sync_kindergartens(
                    session_factory, settings, network,
                    now=now, force=force, file=kindergartens_file, registry_file=kindergartens_registry_file,
                ),
```

- [ ] **Step 10: 跑測試確認通過**

Run: `PY pytest -q -p no:cacheprovider tests/test_geo_kindergartens.py tests/test_geo_sync.py tests/test_geo_babycare_sync.py tests/test_geo_loop.py tests/test_geo_limits.py tests/test_geo_providers.py tests/test_admissions_provider_area.py tests/test_admissions_area.py`
Expected: PASS（`test_geo_loop.py` 裡比對 `geo_sync_options` 精確字典的兩個測試此時仍通過，因為 CLI 還沒多新鍵）

- [ ] **Step 11: Commit**

```bash
git add backend/app/admissions/geo/kindergartens.py backend/app/admissions/geo/sync.py backend/app/config.py backend/tests/fixtures/geo/preschools-sample.json backend/tests/fixtures/geo/kindergarten-registry-sample.csv backend/tests/geo_helpers.py backend/tests/test_geo_kindergartens.py backend/tests/test_geo_sync.py backend/tests/test_geo_babycare_sync.py backend/tests/test_geo_loop.py
git commit -m "fix(admissions): 幼兒園營業中改以教育部名單判斷，不再看 kiang 的 is_active" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: CLI 參數成對與 stack 匯入

**Files:**
- Modify: `backend/app/cli.py`（`geo_sync_options` 約 571–647 行、說明文字約 584 與 742 行）
- Modify: `backend/tests/test_geo_loop.py`（約 296–303、455–465 行）
- Modify: `tests/stack/start-api.sh`、`tests/stack/fixtures/geo-preschools.json`
- Create: `tests/stack/fixtures/geo-kindergarten-registry.csv`

**Interfaces:**
- Consumes: Task 2 的 `run_geo_sync(kindergartens_registry_file=)`（`geo_sync_command` 以 `**options` 轉交，不用改）。
- Produces: `geo_sync_options` 回傳的字典多 `"kindergartens_registry_file": Path | None`；只給其中一個 → `SystemExit`（訊息含「要一起給」）。

- [ ] **Step 1: 寫失敗測試**

Modify `backend/tests/test_geo_loop.py`：

`test_cli_options_with_files` 換成：

```python
def test_cli_options_with_files():
    csv, data = SAMPLE_CSV, SAMPLE_JSON
    args = ["--doorplates-file", str(csv), "--kindergartens-file", str(data), "--kindergartens-registry-file", str(REGISTRY_CSV)]
    assert geo_sync_options(args) == {
        "force": False, "doorplates_file": csv, "doorplates_version": None, "kindergartens_file": data,
        "kindergartens_registry_file": REGISTRY_CSV,
        "babycare_file": None, "population_files": None, "births_files": None, "migration_files": None,
        "income_file": None, "income_year": None, "new_homes_files": None, "new_homes_season": None, "bundle": None,
    }
    assert geo_sync_options(["--force"])["force"] is True
    assert geo_sync_options(["--doorplates-file", str(csv), "--doorplates-version", "115-10"])["doorplates_version"] == "115-10"
```

（保留原測試在這三行之後的其他斷言，不要刪。）

約 460 行那個 `received == [{...}]` 的字典在 `"kindergartens_file": None,` 後面加 `"kindergartens_registry_file": None,`。

檔尾加：

```python
@pytest.mark.parametrize(
    "args",
    [["--kindergartens-file", str(SAMPLE_JSON)], ["--kindergartens-registry-file", str(REGISTRY_CSV)]],
    ids=["只有 JSON", "只有名單"],
)
def test_cli_kindergarten_files_come_in_pairs(args):
    with pytest.raises(SystemExit, match="要一起給"):
        geo_sync_options(args)


def test_cli_rejects_a_missing_registry_file():
    with pytest.raises(SystemExit, match="找不到檔案"):
        geo_sync_options(["--kindergartens-file", str(SAMPLE_JSON), "--kindergartens-registry-file", "/no/such/registry.csv"])
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `PY pytest -q -p no:cacheprovider tests/test_geo_loop.py -k "cli"`
Expected: FAIL（`SystemExit` 印出用法：`--kindergartens-registry-file` 是未知參數）

- [ ] **Step 3: 實作 CLI**

Modify `backend/app/cli.py` 的 `geo_sync_options`：

(a) docstring 在 `--force 一個旗標…` 那段之前加一句：

```
    --kindergartens-file（kiang preschools.json）要和 --kindergartens-registry-file（kiang docs/data/高雄市.csv，教育部名單）
    一起給：營業中以名單為準（2026-10-15），只給一個就報錯。
```

(b) `usage` 裡的 `"[--kindergartens-file <JSON>] "` 換成 `"[--kindergartens-file <JSON> --kindergartens-registry-file <CSV>] "`。

(c) `options` 字典在 `"kindergartens_file": None,` 後面加 `"kindergartens_registry_file": None,`。

(d) `valued` 加 `"--kindergartens-registry-file": "kindergartens_registry_file",`。

(e) `singles` 加 `options["kindergartens_registry_file"],`（放在 `options["kindergartens_file"]` 後面）。

(f) 在「找不到檔案」檢查迴圈之後、`doorplates_version` 檢查之前加：

```python
    if (options["kindergartens_file"] is None) != (options["kindergartens_registry_file"] is None):
        raise SystemExit("--kindergartens-file 與 --kindergartens-registry-file 要一起給（營業中以教育部名單為準）")
```

(g) `main()` 裡約 742 行 `geo-sync` 的說明字串，`[--kindergartens-file <JSON>]` 同樣換成 `[--kindergartens-file <JSON> --kindergartens-registry-file <CSV>]`。

- [ ] **Step 4: 跑測試確認通過**

Run: `PY pytest -q -p no:cacheprovider tests/test_geo_loop.py tests/test_geo_babycare_sync.py tests/test_geo_population.py`
Expected: PASS

- [ ] **Step 5: stack 匯入補名單**

在 repo 根目錄執行：

```bash
perl -pi -e 's/"reg_no": "(e2e-\d+)", "reg_docno": ""/"reg_no": "$1", "reg_docno": "$1-docno"/g' tests/stack/fixtures/geo-preschools.json
grep -c '"reg_docno": "e2e-0[0-9][0-9]-docno"' tests/stack/fixtures/geo-preschools.json
```

Expected: `7`

Create `tests/stack/fixtures/geo-kindergarten-registry.csv`（逐字；只列高雄營業中 5 所，已停業與臺南市那筆不列）：

```
reg_no,reg_docno,reg_date,title,owner,city,town,type,address
e2e-001,e2e-001-docno,1998/01/15,高雄市私立常春藤崇德幼兒園,,高雄市,左營區,私立,[813]崇德路87號
e2e-002,e2e-002-docno,2010/08/01,高雄市立測試甲幼兒園,,高雄市,左營區,公立,[813]測試路1號
e2e-003,e2e-003-docno,2015/02/01,高雄市私立測試乙幼兒園,,高雄市,左營區,私立,[813]測試路2號
e2e-004,e2e-004-docno,2019/08/01,高雄市左營區測試丙非營利幼兒園,,高雄市,左營區,非營利,[813]測試路3號
e2e-005,e2e-005-docno,2012/08/01,高雄市私立測試丁幼兒園,,高雄市,楠梓區,私立,[811]測試路4號
```

Modify `tests/stack/start-api.sh`：
- `unset` 清單的 `WEBSITE_GEO_KINDERGARTENS_URL` 後面加 ` WEBSITE_GEO_KINDERGARTENS_REGISTRY_URL`
- `--kindergartens-file ../tests/stack/fixtures/geo-preschools.json \` 下面加一行 `    --kindergartens-registry-file ../tests/stack/fixtures/geo-kindergarten-registry.csv \`

驗證 stack 匯入指令能跑（不起整個 stack，只跑匯入那一步；用測試庫）：

```bash
cd backend; WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_kgreg1015_test WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_kgreg1015_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen python -m app.cli geo-sync --kindergartens-file ../tests/stack/fixtures/geo-preschools.json --kindergartens-registry-file ../tests/stack/fixtures/geo-kindergarten-registry.csv
```

Expected: 輸出含 `幼兒園：updated`（門牌等其他項目 `skipped`）。跑完這個庫裡會留下 5 所 e2e 幼兒園；pytest 每個測試自己清表，不受影響。

- [ ] **Step 6: Commit**

```bash
git add backend/app/cli.py backend/tests/test_geo_loop.py tests/stack/start-api.sh tests/stack/fixtures/geo-preschools.json tests/stack/fixtures/geo-kindergarten-registry.csv
git commit -m "feat(admissions): geo-sync 的幼兒園檔案要和教育部名單檔成對" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 產生回補檔並接上同步

**Files:**
- Create: `backend/scripts/build_kindergarten_closures.py`
- Create: `backend/app/admissions/geo_data/kindergarten-closures-20261015.csv`（腳本產生）
- Modify: `backend/app/admissions/geo/sync.py`（`sync_kindergartens`）
- Modify: `backend/tests/test_geo_closure_backfill.py`、`backend/tests/test_geo_sync.py`

**Interfaces:**
- Consumes: Task 1 `load_closure_backfill`、`ClosureBackfill`、`BACKFILL_FILE`；Task 2 `parse_registry`、`parse_preschools`、`Registry`、`registry_key`。
- Produces: 正式回補檔；`sync_kindergartens` 在 apply 前呼叫 `load_closure_backfill()`（模組層 import，測試可 monkeypatch `sync.load_closure_backfill`）。

- [ ] **Step 1: 寫產生腳本**

Create `backend/scripts/build_kindergarten_closures.py`:

```python
"""產生 app/admissions/geo_data/kindergarten-closures-<日期>.csv（2026-10-15 幼兒園名單規格 §5.3）。

kiang preschools.json 標營業中（is_active＝1）、但已不在教育部名單（docs/data/高雄市.csv）的高雄幼兒園，
各自離開名單的日期（名單歷史裡第一個不含它的版本，台北日期）與處理方式：
- renamed：名單上有同地址、同設立日的另一所（改名或換承辦），只下架；
- closed：停辦；離開日期在 --since 之前的 left_on 留空（只下架、不寫事件）。
開發用，不進執行期。需要已登入的 gh CLI（約 60 個 GitHub API 請求）。

用法（在 backend/）：
  uv run --frozen python scripts/build_kindergarten_closures.py --since 2025-06-01 \\
      --out app/admissions/geo_data/kindergarten-closures-20261015.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import subprocess
import sys
import urllib.parse
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.admissions.geo.kindergartens import Registry, parse_preschools, parse_registry, registry_key  # noqa: E402
from app.admissions.geo.providers import months_ago  # noqa: E402

REPO = "kiang/ap.ece.moe.edu.tw"
REGISTRY_PATH = "docs/data/高雄市.csv"
JSON_PATH = "docs/preschools.json"
TAIPEI = timezone(timedelta(hours=8))
SCHOOL_YEAR = 115  # 只用來把 JSON 轉成資料列；類型不影響這裡的判斷


def gh(*args: str) -> str:
    for _ in range(3):
        done = subprocess.run(["gh", "api", *args], capture_output=True, text=True)
        if done.returncode == 0:
            return done.stdout
    raise SystemExit(f"gh api 失敗：{' '.join(args)}\n{done.stderr[:300]}")


def raw(path: str, sha: str) -> str:
    return gh("-H", "Accept: application/vnd.github.raw", f"repos/{REPO}/contents/{urllib.parse.quote(path)}?ref={sha}")


def history(since: date) -> list[tuple[str, date]]:
    """名單的 commit，新到舊：(sha, 台北日期)。"""
    query = f"repos/{REPO}/commits?path={urllib.parse.quote(REGISTRY_PATH)}&since={since.isoformat()}T00:00:00Z&per_page=100"
    lines = gh("--paginate", query, "--jq", ".[] | [.sha, .commit.committer.date] | @tsv").splitlines()
    commits = []
    for line in lines:
        sha, stamp = line.split("\t")
        commits.append((sha, datetime.fromisoformat(stamp.replace("Z", "+00:00")).astimezone(TAIPEI).date()))
    return commits


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--since", type=date.fromisoformat, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    head = gh(f"repos/{REPO}/commits/master", "--jq", ".sha").strip()
    registry = parse_registry(raw(REGISTRY_PATH, head))
    data = json.loads(raw(JSON_PATH, head))
    open_rows = parse_preschools(data, registry=registry, school_year=SCHOOL_YEAR)
    # 幽靈＝kiang 標營業中（舊程式會收進資料表的）、但不在當前名單的高雄園所。
    ghost_keys: set[tuple[str, str]] = set()
    key_of: dict[str, tuple[str, str]] = {}
    for feature in data["features"]:
        props = feature.get("properties") or {}
        key = registry_key(props.get("reg_docno"), props.get("title"))
        key_of[str(props.get("id"))] = key
        in_kaohsiung = str(props.get("city") or "").replace("臺", "台") == "高雄市"
        if in_kaohsiung and str(props.get("is_active")) == "1" and key not in registry.keys:
            ghost_keys.add(key)
    ghosts = parse_preschools(data, registry=Registry(frozenset(ghost_keys), frozenset()), school_year=SCHOOL_YEAR)
    same_place = set(registry.places) | {(row.address, row.registered_on) for row in open_rows if row.registered_on}

    commits = history(args.since)
    cache: dict[str, frozenset[tuple[str, str]]] = {}

    def listed(index: int) -> frozenset[tuple[str, str]]:
        sha = commits[index][0]
        if sha not in cache:
            cache[sha] = parse_registry(raw(REGISTRY_PATH, sha)).keys
        return cache[sha]

    out_rows = []
    oldest = len(commits) - 1
    for row in ghosts:
        key = key_of[row.source_id]
        left_on: date | None = None
        if key in listed(oldest):
            lo, hi = 0, oldest  # lo 不含、hi 含
            while hi - lo > 1:
                mid = (lo + hi) // 2
                if key in listed(mid):
                    hi = mid
                else:
                    lo = mid
            left_on = commits[lo][1]
        renamed = row.registered_on is not None and (row.address, row.registered_on) in same_place
        out_rows.append(
            {"source_id": row.source_id, "name": row.name, "left_on": left_on.isoformat() if left_on else "",
             "reason": "renamed" if renamed else "closed"}
        )
    out_rows.sort(key=lambda item: (item["left_on"] or "0000-00-00", item["name"]))
    with args.out.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, ["source_id", "name", "left_on", "reason"], lineterminator="\n")
        writer.writeheader()
        writer.writerows(out_rows)

    window = months_ago(datetime.now(TAIPEI).date(), 12).isoformat()
    closed = [item for item in out_rows if item["reason"] == "closed"]
    recent = [item for item in closed if item["left_on"] >= window]
    print(
        f"head {head[:10]}：名單 {len(registry.keys)} 所、營業中有座標 {len(open_rows)} 所；"
        f"回補 {len(out_rows)} 筆＝停辦 {len(closed)}（近 12 個月 {len(recent)}）、改名 {len(out_rows) - len(closed)}；"
        f"抓了 {len(cache)} 個歷史版本"
    )
    for item in recent:
        print(f"  {item['left_on']} {item['name']}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: 產生回補檔**

Run（在 `backend/`；約 1～3 分鐘）：

```bash
uv run --frozen python scripts/build_kindergarten_closures.py --since 2025-06-01 --out app/admissions/geo_data/kindergarten-closures-20261015.csv
```

Expected（2026-10-15 的結果；名單每天會變，數字可能差幾筆，差很多就停下來查）：

```
head ……：名單 689 所、營業中有座標 689 所；回補 47 筆＝停辦 33（近 12 個月 14）、改名 14；抓了 …… 個歷史版本
  2025-10-22 高雄市私立一二三幼兒園
  ……（共 14 行，含 2026-09-15 高雄市私立童年綠地幼兒園、2026-10-13 高雄市私立愛爾蘭幼兒園）
```

對照規格附錄 A：14 所與日期要一致（新增的停辦可以多，但附錄 A 的不能少、日期不能變）。檢查：

```bash
grep -c "" app/admissions/geo_data/kindergarten-closures-20261015.csv
grep -E "童年綠地|愛爾蘭|喬美|新威|集來" app/admissions/geo_data/kindergarten-closures-20261015.csv
```

Expected：行數 48（含標頭，若當天名單有變則相應增減）；童年綠地 `2026-09-15,closed`、愛爾蘭 `2026-10-13,closed`、喬美 `renamed`、新威 `2026-07-13,closed`、集來 `,closed`（2025-06 前就消失）。

- [ ] **Step 3: 寫失敗測試**

`backend/tests/test_geo_closure_backfill.py` 檔尾加：

```python
def test_the_shipped_backfill_file_is_well_formed():
    """隨程式提交的那份（scripts/build_kindergarten_closures.py 產生）：讀得進來、日期不在未來、兩個已知案例對得上。"""
    entries = load_closure_backfill()
    assert len(entries) >= 40  # 2026-10-15 產生時 47 筆
    assert all(entry.left_on is None or entry.left_on <= date.today() for entry in entries.values())
    assert entries["a77948d8-5d25-4af9-8d0d-5d82e6c41c13"] == ClosureBackfill("closed", date(2026, 9, 15))  # 童年綠地
    assert entries["e517b294-6109-4c89-a847-07a260585e6c"] == ClosureBackfill("closed", date(2026, 10, 13))  # 愛爾蘭
```

`backend/tests/test_geo_sync.py` 加（import：`from datetime import datetime, timedelta, timezone` 若缺就補；`from app.admissions.geo.closure_backfill import BackfillFormatError, ClosureBackfill`；`from app.common.timezones import today_local` 若缺就補）：

```python
async def test_the_sync_applies_the_closure_backfill(app, monkeypatch):
    """要下架的園所在回補檔裡：停辦寫在離開名單那天（2026-10-15 規格 §5）。"""
    left_on = today_local() - timedelta(days=40)
    monkeypatch.setattr(sync, "load_closure_backfill", lambda: {"ghost": ClosureBackfill("closed", left_on)})
    async with app.state.session_factory() as db:
        db.add(
            GeoKindergarten(
                source_id="ghost", name="高雄市私立已停辦幼兒園", kind="private", district="三民區", address="某路9號",
                lat=22.64, lng=120.34, is_active=True, synced_at=datetime.now(timezone.utc),
            )
        )
        await db.commit()
    result = await run_geo_sync(
        app.state.session_factory, app.state.settings,
        kindergartens_file=FIXTURES / "preschools-sample.json", kindergartens_registry_file=REGISTRY_SAMPLE,
    )
    assert result.kindergartens == "updated"
    async with app.state.session_factory() as db:
        rows = (await db.execute(select(GeoProviderEvent.source_id, GeoProviderEvent.change, GeoProviderEvent.occurred_on))).all()
    assert [tuple(row) for row in rows] == [("ghost", "closed", left_on)]


async def test_a_broken_backfill_file_fails_the_kindergarten_sync(app, monkeypatch):
    def broken():
        raise BackfillFormatError("kindergarten-closures-20261015.csv 第 3 列不對")

    monkeypatch.setattr(sync, "load_closure_backfill", broken)
    result = await run_geo_sync(
        app.state.session_factory, app.state.settings,
        kindergartens_file=FIXTURES / "preschools-sample.json", kindergartens_registry_file=REGISTRY_SAMPLE,
    )
    assert result.kindergartens == "failed"
    assert (await _status(app, "kindergartens")).last_error == "kindergarten-closures-20261015.csv 第 3 列不對"
    assert (await _counts(app))[1] == 0
```

（`_error_text` 只對白名單裡的例外原樣回訊息，Step 5 會把 `BackfillFormatError` 加進白名單；沒加的話 `last_error` 會是「下載或匯入失敗：BackfillFormatError」。）

- [ ] **Step 4: 跑測試確認失敗**

Run: `PY pytest -q -p no:cacheprovider tests/test_geo_closure_backfill.py tests/test_geo_sync.py -k "backfill"`
Expected: `test_the_shipped_backfill_file_is_well_formed` PASS（檔案已產生）；兩個 sync 測試 FAIL（`AttributeError: <module 'app.admissions.geo.sync'> does not have the attribute 'load_closure_backfill'`）

- [ ] **Step 5: 接上同步**

Modify `backend/app/admissions/geo/sync.py`：

import 區加：

```python
from app.admissions.geo.closure_backfill import BackfillFormatError, load_closure_backfill
```

`_error_text` 的 `own` 白名單在 `KindergartenFormatError,` 後面加 `BackfillFormatError,`（訊息是我們自己寫的檔名與列號，可以原樣進 `last_error`）。

`sync_kindergartens` 裡 `registry = parse_registry(registry_text)` 下面加：

```python
        backfill = load_closure_backfill()  # 2026-10-15 規格 §5：檔案不對就整輪失敗，不靠猜
```

`providers.apply_kindergartens(...)` 的參數加 `backfill=backfill,`。

- [ ] **Step 6: 跑測試確認通過**

Run: `PY pytest -q -p no:cacheprovider tests/test_geo_closure_backfill.py tests/test_geo_sync.py tests/test_geo_babycare_sync.py tests/test_geo_loop.py`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/scripts/build_kindergarten_closures.py backend/app/admissions/geo_data/kindergarten-closures-20261015.csv backend/app/admissions/geo/sync.py backend/tests/test_geo_closure_backfill.py backend/tests/test_geo_sync.py
git commit -m "feat(admissions): 回補近 12 個月幼兒園停辦的實際離開名單日期" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 後台「附近園所的變化」小字

**Files:**
- Modify: `admin/src/components/admissions/area/areaFormat.ts`（`trackingNote`，約 322–344 行）
- Modify: `admin/src/components/admissions/area/ProviderChanges.vue`（第 9–11 行註解）
- Modify: `admin/src/__tests__/areaFormat.test.ts`（約 302–343 行）、`admin/src/__tests__/nearbyProviders.test.ts`（約 122 行）
- Modify: `tests/stack/admissions-area.spec.ts`（約 348 行）

**Interfaces:**
- Consumes: 既有 `trackingNote(tracking: AreaTrackingSince, months = 12, now = new Date()): string`（簽名不變）。
- Produces: 新文案（規格 §6）。

- [ ] **Step 1: 改測試成新文案**

`admin/src/__tests__/areaFormat.test.ts` 的 `describe('記錄起點的說明（trackingNote）', …)` 整段換成：

```ts
  describe('記錄起點的說明（trackingNote）', () => {
    const now = new Date(2026, 9, 14) // 2026/10/14
    it('兩邊都還沒開始記錄', () => {
      expect(trackingNote({ kindergarten: null, babycare: null }, 12, now)).toBe('尚未開始記錄。')
    })
    it('基準日同一天、不到 12 個月：只說類型變動與托嬰從哪天起記錄（2026-10-15 規格 §6 逐字）', () => {
      expect(trackingNote({ kindergarten: '2026-10-14', babycare: '2026-10-14' }, 12, now)).toBe(
        '幼兒園的類型變動與托嬰從 10 月 14 日起記錄。',
      )
    })
    it('基準日不同天：分開寫', () => {
      expect(trackingNote({ kindergarten: '2026-10-14', babycare: '2026-10-20' }, 12, now)).toBe(
        '幼兒園的類型變動從 10 月 14 日起記錄；托嬰從 10 月 20 日起記錄。',
      )
    })
    it('只有一邊開始記錄', () => {
      expect(trackingNote({ kindergarten: '2026-10-14', babycare: null }, 12, now)).toBe(
        '幼兒園的類型變動從 10 月 14 日起記錄；托嬰尚未開始記錄。',
      )
    })
    it('幼兒園已滿 12 個月、托嬰從未匯入：仍要說托嬰尚未開始記錄', () => {
      expect(trackingNote({ kindergarten: '2025-10-14', babycare: null }, 12, now)).toBe('托嬰尚未開始記錄。')
    })
    it('幼兒園從未同步（沒有回補）、托嬰已滿 12 個月：停辦與類型變動都還沒開始記錄', () => {
      expect(trackingNote({ kindergarten: null, babycare: '2025-10-14' }, 12, now)).toBe(
        '幼兒園的停辦與類型變動尚未開始記錄。',
      )
    })
    it('一邊已滿 12 個月、另一邊還近：已滿那一側不印日期（一年後讀起來會像今年）', () => {
      expect(trackingNote({ kindergarten: '2025-10-14', babycare: '2026-10-20' }, 12, now)).toBe(
        '托嬰從 10 月 20 日起記錄。',
      )
      expect(trackingNote({ kindergarten: '2026-10-20', babycare: '2025-10-14' }, 12, now)).toBe(
        '幼兒園的類型變動從 10 月 20 日起記錄。',
      )
    })
    it('不再寫「新設以設立日為準」：幼兒園的新設與停辦都涵蓋整個視窗', () => {
      const all = [
        trackingNote({ kindergarten: '2026-10-14', babycare: '2026-10-14' }, 12, now),
        trackingNote({ kindergarten: '2026-10-14', babycare: '2026-10-20' }, 12, now),
        trackingNote({ kindergarten: null, babycare: '2026-10-20' }, 12, now),
      ]
      for (const text of all) expect(text).not.toContain('設立日')
    })
    it('基準日已滿 12 個月（剛好 12 個月前那天也算滿）：不需要說明', () => {
      expect(trackingNote({ kindergarten: '2025-10-14', babycare: '2025-09-01' }, 12, now)).toBe('')
      expect(trackingNote({ kindergarten: '2025-10-15', babycare: '2025-09-01' }, 12, now)).not.toBe('')
    })
  })
```

`admin/src/__tests__/nearbyProviders.test.ts` 約 122 行：

```ts
    expect(wrapper.get('.changes__note').text()).toBe('幼兒園的類型變動與托嬰從 10 月 14 日起記錄。')
```

`tests/stack/admissions-area.spec.ts` 約 348 行：

```ts
    await expect(changes.locator('.changes__note')).toHaveText(/^幼兒園的類型變動與托嬰從 \d+ 月 \d+ 日起記錄。$/)
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `source ~/.nvm/nvm.sh; nvm use 22; cd admin; npx vitest run src/__tests__/areaFormat.test.ts src/__tests__/nearbyProviders.test.ts`
Expected: FAIL（舊文案「停辦與類型變動從 10 月 14 日起記錄；新設以設立日為準…」）

- [ ] **Step 3: 實作**

`admin/src/components/admissions/area/areaFormat.ts` 的 `trackingNote` 與它上方的註解換成：

```ts
/**
 * 變化區塊底下的小字（2026-10-14 規格 7.3，2026-10-15 規格 §6 改）：幼兒園的新設看設立日、停辦有教育部名單的回補，
 * 都涵蓋整個視窗；只有幼兒園的類型變動與托嬰的異動是從基準日才開始累積，基準日離今天不到視窗長度時老實說從哪天起記錄。
 * 還沒同步過（基準日是空）的那一側明說「尚未開始記錄」（幼兒園還沒同步就也沒有回補，所以寫停辦與類型變動），
 * 兩邊都空寫「尚未開始記錄。」；兩邊都已記錄滿視窗長度才不需要說明（回空字串）。已滿那一側省略不印日期（不帶年份，一年後讀起來會像今年）。
 */
export function trackingNote(tracking: AreaTrackingSince, months = 12, now: Date = new Date()): string {
  const { kindergarten, babycare } = tracking
  if (!kindergarten && !babycare) return '尚未開始記錄。'
  const cutoff = monthsAgoIso(now, months)
  const recent = (iso: string | null): iso is string => iso !== null && iso > cutoff // 基準日離今天還不到視窗長度
  if (kindergarten && babycare && !recent(kindergarten) && !recent(babycare)) return ''
  if (kindergarten && babycare && kindergarten === babycare) {
    return `幼兒園的類型變動與托嬰從 ${monthDay(kindergarten)}起記錄。`
  }
  const parts: string[] = []
  if (!kindergarten) parts.push('幼兒園的停辦與類型變動尚未開始記錄')
  else if (recent(kindergarten)) parts.push(`幼兒園的類型變動從 ${monthDay(kindergarten)}起記錄`)
  if (!babycare) parts.push('托嬰尚未開始記錄')
  else if (recent(babycare)) parts.push(`托嬰從 ${monthDay(babycare)}起記錄`)
  return `${parts.join('；')}。`
}
```

`admin/src/components/admissions/area/ProviderChanges.vue` 第 9–11 行註解換成：

```ts
// 附近園所的變化（2026-10-14 規格 7.3）：本校半徑內近 12 個月的新設、停辦、類型變動，幼兒園與托嬰都涵蓋，
// 後端已依日期新到舊排好。這一版列不可點（停辦的園所不在地圖上）。
// 幼兒園類型變動與托嬰異動從基準日才開始累積（幼兒園停辦有教育部名單回補，2026-10-15），底下小字老實說從哪天起記錄；
// 多數校區一年只有 0～1 件，空是正常的。
```

- [ ] **Step 4: 跑測試確認通過**

Run: `source ~/.nvm/nvm.sh; nvm use 22; cd admin; npx vitest run src/__tests__/areaFormat.test.ts src/__tests__/nearbyProviders.test.ts; npm run typecheck`
Expected: PASS、typecheck 無錯誤

- [ ] **Step 5: Commit**

```bash
git add admin/src/components/admissions/area/areaFormat.ts admin/src/components/admissions/area/ProviderChanges.vue admin/src/__tests__/areaFormat.test.ts admin/src/__tests__/nearbyProviders.test.ts tests/stack/admissions-area.spec.ts
git commit -m "fix(admin): 附近園所的變化小字只說類型變動與托嬰從哪天起記錄" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 文件回寫、影響數字、全套驗證（主 session）

**Files:**
- Modify: `docs/specs/2026-10-14-provider-changes-design.md`、`DESIGN.md`（約 14 行）、`README.md`（頂部）、`deploy/README.md`（約 748–749、773、779、1250 行）、`backend/app/admissions/geo_data/README.md`

**Interfaces:**
- Consumes: Task 1–5 全部。
- Produces: 文件、驗證紀錄；不改程式。

- [ ] **Step 1: 各校影響數字（離線算，不進 repo）**

在 scratchpad 寫腳本：讀 `tests/fixtures/geo/doorplates-sample.csv` 取五校校址座標（義華路 68 號、明華一路 176 號、崇德路 87 號、球場路 59 號、京吉一路 102 號；號數是全形，比對前 NFKC，`twd97_tm2_to_wgs84` 轉經緯度），讀 Task 4 用的同一版 kiang JSON 與名單，列出每校 1／3／6 公里內少掉幾所（JSON 營業中、不在名單），以及 3 公里內近 12 個月停辦會出現在變化列表的園所（回補檔 `closed` 且 `left_on` 在視窗內）。2026-10-15 的參考值：

| 校 | 1 km | 3 km | 6 km | 3 km 內會出現的近 12 個月停辦 |
|---|---|---|---|---|
| 義華 | 2 | 9 | 18 | 聖愛、童年綠地、理幼、愛爾蘭（喬美是改名，不出現） |
| 明華 | 1 | 5 | 16 | 聖愛、一二三 |
| 崇德 | 0 | 3 | 12 | 一二三 |
| 國際 | 1 | 9 | 18 | 聖愛、童年綠地、理幼、愛爾蘭 |
| 仁武 | 0 | 2 | 12 | 無 |

把實際算出的表放進 Step 3 的 README 段落。

- [ ] **Step 2: 文件回寫（規格 §9）**

- `docs/specs/2026-10-14-provider-changes-design.md`：P5 那列的「理由」欄末尾加「**2026-10-15 更正**：幼兒園改以教育部名單判斷（kiang 的 `is_active` 不會變回 0），見 `docs/specs/2026-10-15-kindergarten-registry-design.md`」；§1.3「用 git 歷史回補更早的異動」那條末尾加「**2026-10-15 推翻**：當時的 0 所是 `is_active` 不會翻 0 造成的；幼兒園改以名單判斷並回補近 12 個月（見 2026-10-15 規格）」。
- `DESIGN.md` 約 14 行「停辦怎麼知道」那條換成：「**停辦怎麼知道**：同步依 `source_id` 比對，名單裡不見的標停辦、列留著（`is_active` 假）。**幼兒園的營業中以教育部名單（kiang `docs/data/高雄市.csv`）為準**，不看 kiang `preschools.json` 的 `is_active`（一旦是 1 就不會變回 0，2026-10-15 查證）；同地址、同設立日的另一筆在名單上＝改名或換承辦，只下架、不記停辦。來源沒有停辦日，日期是我們同步到的那天；2026-10-15 前離開名單的近 12 個月停辦用回補檔補上實際離開日。托嬰第一次同步只建立基準（`baseline_on`）。」
- `backend/app/admissions/geo_data/README.md` 檔尾加一節「## 幼兒園停辦回補（`kindergarten-closures-20261015.csv`）」：來源（kiang `docs/data/高雄市.csv` 的 commit 歷史，2025-06-01 起）、欄位意義（同規格 §5.1）、產生指令（Task 4 Step 2 那行）、「只用一次：同步只在某所這一輪要下架時查；日後不用重產，除非要重做回補」。
- `deploy/README.md`：
  - 環境變數表（約 749 行，`WEBSITE_GEO_BABYCARE_URL` 那列之前）加一列：``| `WEBSITE_GEO_KINDERGARTENS_REGISTRY_URL` | `https://kiang.github.io/ap.ece.moe.edu.tw/data/%E9%AB%98%E9%9B%84%E5%B8%82.csv` | 教育部高雄市幼兒園名單（kiang 每日從全國教保資訊網爬下，約 200KB）。營業中以它為準；抓不到時幼兒園整輪不換版。必須是 `https://` |``
  - 約 773 行指令範例的 `[--kindergartens-file <JSON>]` 改成 `[--kindergartens-file <JSON> --kindergartens-registry-file <CSV>]`；約 779 行說明補一句「幼兒園檔案要和名單檔（kiang `docs/data/高雄市.csv`）一起給，只給一個會報錯」。
  - 約 1250 行 api 變數清單在 `WEBSITE_GEO_KINDERGARTENS_URL` 後面加 `／WEBSITE_GEO_KINDERGARTENS_REGISTRY_URL`。
- `README.md` 頂部加一段（照現有格式）：

```markdown
## 2026-10-15 幼兒園營業中改以教育部名單判斷（`fix/kindergarten-registry-20261015`）

使用者問區域分析「附近園所的變化」會不會出現最近停業的園所（三民區的愛爾蘭、童年綠地）。查證發現 kiang `preschools.json` 的 `is_active` 一旦是 1 就不會變回 0，高雄有 47 所已不在教育部名單仍標營業中，幼兒園停辦因此從沒記過。規格 `docs/specs/2026-10-15-kindergarten-registry-design.md`。

- **判斷**：同步多抓 kiang `docs/data/高雄市.csv`（教育部名單），（立案文號、名稱）在名單上才算營業中；抓不到或格式不對，幼兒園整輪不換版。
- **改名**：同地址、同設立日的另一筆在名單上＝改名或換承辦，只下架、不記停辦。
- **回補**：`backend/app/admissions/geo_data/kindergarten-closures-20261015.csv`（`scripts/build_kindergarten_closures.py` 從名單歷史算出）：近 12 個月停辦 N 所寫在實際離開名單那天，更早的與改名的只下架。
- **畫面**：版面不變；「附近幼兒園」清單與數字少掉幽靈園所（各校見下表）；變化區塊小字改成只說類型變動與托嬰從哪天起記錄。
- **各校影響**：（Step 1 的表）
- **上線**：不新增 migration；推 main 後下一輪幼兒園同步（每 7 天）自動套用。要立刻生效得手動 `geo-sync --force`（會連門牌一起強制重抓，Railway 連不到高雄市資料平台時門牌 failed、結束碼 1，幼兒園照樣更新）。
- **驗證**：（Step 3 的結果）
```

- [ ] **Step 3: 全套驗證（主 session 背景跑，一次只跑一組）**

```bash
cd backend; uvx ruff check app tests scripts   # venv 裡沒有 ruff
cd backend; PY pytest -q -p no:cacheprovider   # 全套；背景跑，等通知（沒有 pytest-timeout，不要加 --timeout）
source ~/.nvm/nvm.sh; nvm use 22; cd admin; npx vitest run      # admin 全套
npm --prefix admin run typecheck
git grep -n "roster" -- backend/app/admissions/geo backend/app/cli.py   # 應該沒有結果（R9）
```

stack：照 `docs/website-admin/README.md` 的 stack 指令只跑 `tests/stack/admissions-area.spec.ts`（`npx playwright test -c playwright.stack.config.ts tests/stack/admissions-area.spec.ts`），確認 start-api 的成對匯入與新小字。

把實際跑過的指令、通過數、未驗證項寫進 README 那段的「驗證」。

- [ ] **Step 4: Commit**

```bash
git add docs/specs/2026-10-14-provider-changes-design.md DESIGN.md README.md deploy/README.md backend/app/admissions/geo_data/README.md
git commit -m "docs: 幼兒園營業中改以教育部名單判斷的文件回寫與驗證紀錄" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

（不 push、不部署；推 main 由使用者決定。部署後另在 `deploy/README.md` 補部署紀錄。）
