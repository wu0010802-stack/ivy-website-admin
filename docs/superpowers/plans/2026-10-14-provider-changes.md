# 托嬰中心與園所異動 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在後台招生區域分析加上「附近托嬰中心」名單與地圖圖層，以及「附近園所的變化」（新設／停辦／類型變動）。

**Architecture:** 幼兒園與托嬰的公開名單同步從「刪光重寫」改成依 `source_id` 比對（`providers.py`）：停辦的標 `is_active` 假、列留著，變化寫進 `geo_provider_events`；托嬰是新的一種公開資料（`geo_babycare`）。兩支新的唯讀 API 回附近托嬰與近 12 個月的變化；後台「附近幼兒園」卡片加切換，卡片下方多一個變化區塊，地圖多一個預設不勾的托嬰圖層。

**Tech Stack:** FastAPI 0.136.1（釘版）＋SQLAlchemy 2.0＋Alembic＋PostgreSQL；Vue 3＋Pinia＋Element Plus＋Leaflet（admin）；pytest、Vitest、Playwright（stack e2e）。

**Spec:** `docs/specs/2026-10-14-provider-changes-design.md`（使用者 2026-10-14 核可；本計畫引用其裁定編號 P1–P14）

## Global Constraints

- 回覆、註解、畫面文字一律**繁體中文（台灣用語）**；技術名詞與識別符保留原文。
- 家長資料完全不參與：新端點只讀公開園所資料與異動紀錄；唯一新增的外部請求是同步下載 `babycare.json`（規格 §8）。
- 顏色一律走 token，不寫 rgba／oklch 字面值（token 定義處 `admin/src/style.css` 除外）；標點除了顏色還要有形狀（托嬰用菱形）。
- 圖一律是表格＋CSS，不裝圖表套件（本計畫沒有圖）。
- migration 只新增表、加欄位並放寬一個約束，不改既有資料；約束條件字串與 `models.py` **逐字相同**（`tests/test_geo_schema.py` 檢查）。
- 規格常數（逐字）：`PROVIDER_REFRESH_AFTER = 7 天`、`CHANGE_WINDOW_MONTHS = 12`、`EVENT_RETENTION_MONTHS = 24`、`REOPEN_CANCELS_CLOSURE = 30 天`、殘缺檔門檻 80%（上次營業中 ≥ 20 才檢查，`--force` 略過）、`BABYCARE_MAX_BYTES = 8 MB`、`BABYCARE_TIME_BUDGET = 5 分鐘`、半徑只收 1／3／6（其他回 422 `INVALID_RADIUS`）。
- 未經要求**不 commit 到 main、不 push、不部署**（commit 只在本 worktree 的 `feature/provider-changes-20261014`）。每個 commit 結尾加一行：`Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`。
- 機器只有 8GB RAM：同一時間只跑一組測試；後端**全套** pytest 與 stack e2e 全套由主 session 背景跑，不交給 subagent（會被 10 分鐘無輸出的 watchdog 殺掉）。subagent 只跑自己動到的測試檔。
- 後端 pytest 的 `WEBSITE_*` 變數要寫在**同一行**（Bash 工具不保留環境變數）；Node 指令用分號串接（`source nvm.sh` 會 exit 3）；zsh 裡不要寫 `echo =====`。
- 派工文字裡若要提到 U+FEFF 這類字元，寫「U+FEFF」，不要寫反斜線跳脫（會被解碼）。

## 測試環境（主 session 先備好，subagent 直接用）

Worktree：`~/Repositories/ivy-website-wt/provider-changes-20261014`（sparse，分支 `feature/provider-changes-20261014`）。後端測試庫 `ivy_website_providerchg1014_test`（主 session 已建好並升到當時的 head；Task 1 寫完 migration 後要自己再升一次）。

後端指令前綴（下文記為 `PY`；整段放在同一行，在 `backend/` 目錄下執行）：

```bash
WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_providerchg1014_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen
```

例：`PY pytest -q -p no:cacheprovider tests/test_geo_schema.py`、`PY alembic upgrade head`。

後台前端：`cd admin && npx vitest run <檔>`、`npm --prefix admin run typecheck`（先 `source ~/.nvm/nvm.sh; nvm use 22`，用分號串接）。契約：repo 根目錄 `npm run contract:generate`、`npm run contract:check`。

## Review Focus

規格沒有逐條列出、但最可能咬到使用者的情況；每一條都在負責的 task 裡有對應測試。

1. **托嬰第一次同步（資料表是空的）不能寫任何 `opened` 事件**，否則上線第一天會有 150 筆「新設」（Task 3 `test_first_babycare_sync_only_sets_the_baseline`）。
2. **殘缺檔不能讓整批園所一夜變「停辦」**：新檔營業中的數量少於上次 80% 不換版；剛好 80% 要放行；上次不到 20 所不檢查；`--force` 略過（Task 3）。
3. **8 月學年更替不能冒出一批假的 `kind_changed`**：準公共期間沒改、只是學年過了，不算類型變動；期間真的改了才算（Task 3）。
4. **來源漏收又補回來**：停辦事件寫入後 30 天內回來，兩筆事件都不留；第 31 天才回來就是停辦＋重新營業（Task 3，含 30／31 天邊界）。
5. **12 個月視窗邊界與閏日**：剛好 12 個月前那一天算、前一天不算；2/29 往前推取 2/28（Task 3 `months_ago`、Task 5 `nearby_changes`）。
6. **設立日新設與重新營業事件不能重複出現**，且設立日在未來（來源打錯）不算新設（Task 5）。
7. **核定人數或實際收托是空值**：總結不計入、清單寫「—」，不寫 0（Task 5、Task 6）。
8. **基準日不到 12 個月前／還沒同步過**：畫面小字要如實說「從 N 月 N 日起記錄」或「尚未開始記錄」，不顯示假的完整紀錄（Task 6、Task 7）。

## File Structure

| 檔案 | 動作 | 責任 |
|---|---|---|
| `backend/app/admissions/geo/models.py` | 修改 | 新增 `GeoBabycare`、`GeoProviderEvent`；`GeoKindergarten.registered_on`；`GeoDatasetStatus.baseline_on`；常數 `BABYCARE_KINDS`、`PROVIDERS`、`PROVIDER_CHANGES`；`DATASETS` 多 `babycare` |
| `backend/migrations/versions/c6a9e3f15d27_provider_changes.py` | 新增 | 上述表與欄位、約束放寬 |
| `backend/app/admissions/geo/babycare.py` | 新增 | `parse_babycare`、`BabycareRow`、`NearbyBabycare`、`nearby`、`SOURCE_NOTE` |
| `backend/app/admissions/geo/kindergartens.py` | 修改 | `KindergartenRow.registered_on`、`kind_as_of`；移除 `replace_kindergartens` |
| `backend/app/admissions/geo/providers.py` | 新增 | `apply_kindergartens`、`apply_babycare`（比對＋事件）、`nearby_changes`、`months_ago`、常數 |
| `backend/app/admissions/geo/sync.py` | 修改 | `sync_babycare`、7 天到期判斷、上限、`run_geo_sync(babycare_file=)` |
| `backend/app/cli.py`、`backend/app/workers/geo_loop.py`、`backend/app/config.py` | 修改 | `--babycare-file`、迴圈摘要、`geo_babycare_url` |
| `backend/app/admissions/area.py`、`schemas.py`、`routes.py` | 修改 | `query_babycare`、`query_changes`、`data_status.babycare_synced_at`、兩支端點 |
| `backend/tests/…` | 新增／修改 | 見各 task |
| `contracts/openapi.json`、`contracts/generated/website-api.d.ts` | 重新產生 | |
| `admin/src/api/types.ts`、`admin/src/api/admissions.ts` | 修改 | 型別與 `getAreaBabycare`、`getAreaChanges` |
| `admin/src/components/admissions/area/areaFormat.ts` | 修改 | 托嬰與變化的文字函式 |
| `admin/src/components/admissions/area/NearbyBabycare.vue`、`ProviderChanges.vue`、`NearbyPanel.vue` | 新增 | 托嬰清單、變化區塊、切換外殼 |
| `admin/src/components/admissions/area/AreaMap.vue`、`AreaTab.vue`、`admin/src/style.css` | 修改 | 托嬰圖層、串接、token |
| `tests/stack/…`、`deploy/README.md`、`DESIGN.md`、`README.md` | 修改 | e2e 與文件 |

---

### Task 1: 資料表與 migration

**Files:**
- Modify: `backend/app/admissions/geo/models.py`
- Create: `backend/migrations/versions/c6a9e3f15d27_provider_changes.py`
- Modify: `backend/tests/conftest.py:127-160`（TRUNCATE 清單）
- Modify: `backend/tests/test_geo_schema.py`

**Interfaces:**
- Produces（後面的 task 用）：
  - `models.BABYCARE_KINDS = ("center", "home")`、`models.PROVIDERS = ("kindergarten", "babycare")`、`models.PROVIDER_CHANGES = ("opened", "closed", "kind_changed")`、`models.DATASETS` 多 `"babycare"`
  - `GeoBabycare(source_id, name, kind, address, lat, lng, approved_capacity, enrolled, phone, is_active, synced_at)`
  - `GeoProviderEvent(id, provider, source_id, change, occurred_on, old_value, new_value)`，唯一約束名 `uq_geo_provider_events_once`
  - `GeoKindergarten.registered_on: date | None`、`GeoDatasetStatus.baseline_on: date | None`

- [ ] **Step 1: 先看目前 head 並確認新 revision id 沒被用過**

```bash
cd ~/Repositories/ivy-website-wt/provider-changes-20261014/backend
ls migrations/versions | grep -c c6a9e3f15d27   # 預期 0
grep -n "down_revision" migrations/versions/b4d7e1a92c58_slot_lookup_daily.py   # 預期 down_revision = "f3c8a2d47b19"
```

目前唯一的 head 是 `b4d7e1a92c58`。若 `c6a9e3f15d27` 已存在，換一個沒用過的 12 位十六進位，並在下文所有出現處一起換。

- [ ] **Step 2: 寫會失敗的 schema 測試**

修改 `backend/tests/test_geo_schema.py`：

(a) 檔頭 import 區，`from datetime import datetime, timezone` 改成 `from datetime import date, datetime, timezone`；`from app.admissions.geo.models import (...)` 的名單加入 `BABYCARE_KINDS`、`GeoBabycare`、`GeoProviderEvent`（保持字母順序即可）。

(b) 常數區（`POPULATION_MIGRATION = ...` 起，到 `CHECK_NAMES` 結束）整段換成：

```python
BACKEND = Path(__file__).resolve().parents[1]
MIGRATION = BACKEND / "migrations" / "versions" / "e7a1c4d9b2f6_admissions_area_geo.py"
POPULATION_MIGRATION = BACKEND / "migrations" / "versions" / "f3c8a2d47b19_admissions_village_population.py"
PROVIDER_MIGRATION = BACKEND / "migrations" / "versions" / "c6a9e3f15d27_provider_changes.py"
# 約束最後一次寫進資料庫的 migration：dataset 的條件 10-14 再放寬一次（多收 babycare），托嬰與異動紀錄的約束也在這支。
CONSTRAINT_MIGRATIONS = {
    "ck_geo_dataset_status_dataset": PROVIDER_MIGRATION,
    "ck_geo_babycare_kind": PROVIDER_MIGRATION,
    "ck_geo_provider_events_provider": PROVIDER_MIGRATION,
    "ck_geo_provider_events_change": PROVIDER_MIGRATION,
}
MODELS = (
    GeoDoorplate, GeoKindergarten, GeoVillagePopulation, GeoDatasetStatus, RecruitmentVisitGeo, GeoBabycare, GeoProviderEvent,
)
# 加減約束要改這裡，同時改 models.py 與 migration。
CHECK_NAMES = {
    "ck_geo_doorplates_street_kind",
    "ck_geo_kindergartens_kind",
    "ck_geo_dataset_status_dataset",
    "ck_recruitment_visit_geo_match_level",
    "ck_recruitment_visit_geo_reason",
    "ck_geo_babycare_kind",
    "ck_geo_provider_events_provider",
    "ck_geo_provider_events_change",
}
```

(c) `test_check_constraint_names_in_database_are_the_locked_set` 裡 SQL 的 `conrelid IN (...)` 清單改成：

```python
                "SELECT conname FROM pg_constraint WHERE contype = 'c' AND conrelid IN "
                "('geo_doorplates'::regclass, 'geo_kindergartens'::regclass, "
                "'geo_dataset_status'::regclass, 'recruitment_visit_geo'::regclass, "
                "'geo_babycare'::regclass, 'geo_provider_events'::regclass)"
```

(d) `test_tables_exist` 的預期集合改成：

```python
    assert set(names) == {
        "geo_doorplates", "geo_kindergartens", "geo_village_population", "geo_dataset_status", "recruitment_visit_geo",
        "geo_babycare", "geo_provider_events",
    }
```

(e) 在 `test_population_migration_follows_contact_phrases_and_only_adds` 之後新增：

```python
def test_provider_migration_follows_slot_usage_and_only_adds():
    """托嬰與異動：接在場次使用情況之後、單一 head；升級只建表、加欄位與放寬約束，不動既有資料。"""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    script = ScriptDirectory.from_config(config)
    assert script.get_revision("c6a9e3f15d27").down_revision == "b4d7e1a92c58"
    assert len(script.get_heads()) == 1
    upgrade = PROVIDER_MIGRATION.read_text(encoding="utf-8").split("def upgrade()", 1)[1].split("def downgrade()", 1)[0]
    assert "op.execute" not in upgrade and "UPDATE " not in upgrade and "DELETE " not in upgrade


async def test_new_columns_exist(db_session):
    found = (
        await db_session.execute(
            text(
                "SELECT table_name, column_name FROM information_schema.columns WHERE "
                "(table_name = 'geo_kindergartens' AND column_name = 'registered_on') OR "
                "(table_name = 'geo_dataset_status' AND column_name = 'baseline_on')"
            )
        )
    ).all()
    assert sorted(tuple(row) for row in found) == [("geo_dataset_status", "baseline_on"), ("geo_kindergartens", "registered_on")]


async def test_babycare_kind_accepts_declared_values_and_rejects_others(db_session):
    def babycare(source_id: str, kind: str) -> GeoBabycare:
        return GeoBabycare(
            source_id=source_id, name="測試托嬰中心", kind=kind, address="高雄市三民區某路1號", lat=22.6, lng=120.3,
            synced_at=datetime.now(timezone.utc),
        )

    for index, kind in enumerate(BABYCARE_KINDS):
        db_session.add(babycare(f"b{index}", kind))
    await db_session.commit()
    await _expect_rejected(db_session, babycare("bad", "nursery"))


async def test_provider_event_constraints(db_session):
    def event(*, provider: str = "babycare", change: str = "closed", day: date = date(2026, 10, 14)) -> GeoProviderEvent:
        return GeoProviderEvent(provider=provider, source_id="b1", change=change, occurred_on=day)

    db_session.add(event())
    await db_session.commit()
    await _expect_rejected(db_session, event())  # 同一天、同一所、同一種只能一筆
    await _expect_rejected(db_session, event(provider="school"))
    await _expect_rejected(db_session, event(change="renamed"))
    db_session.add(event(day=date(2026, 10, 15)))  # 另一天可以
    await db_session.commit()
```

- [ ] **Step 3: 跑測試確認失敗**

Run（在 `backend/`）：`PY pytest -q -p no:cacheprovider tests/test_geo_schema.py -x`
Expected：收集階段 FAIL，`ImportError: cannot import name 'BABYCARE_KINDS'`。

- [ ] **Step 4: 改 `models.py`**

(a) import 區加入 `Date`、`UniqueConstraint`（和既有的 `BigInteger, Boolean, CheckConstraint, DateTime, Float, ForeignKey, Identity, Index, Integer, String` 並列，維持字母順序）。

(b) 模組 docstring 第一段改成：

```python
"""招生區域分析的公開地理資料與訪視比對結果（docs/specs/2026-10-08-admissions-area-design.md 第 5 節；
各里人口見 docs/specs/2026-10-13-admissions-opportunity-design.md 第 3 節；托嬰與園所異動見
docs/specs/2026-10-14-provider-changes-design.md 第 3 節）。

七張表都是官網專用，不進園務轉移契約。geo_doorplates／geo_kindergartens／geo_babycare／
geo_provider_events／geo_village_population／geo_dataset_status 是公開資料、與校區無關；
recruitment_visit_geo 一筆訪視一列，不存家長座標。列舉用 String＋CheckConstraint，條件字串與建立（或最後改寫）
該約束的 migration 逐字相同：geo_dataset_status 的 dataset、geo_babycare、geo_provider_events 是 c6a9e3f15d27，
其餘是 e7a1c4d9b2f6（tests/test_geo_schema.py 檢查）。
```

(c) 常數區：

```python
# population：各里人口（2026-10-13 招生機會），migration f3c8a2d47b19 加進約束；
# babycare：托嬰名單（2026-10-14），migration c6a9e3f15d27 加進約束。
DATASETS = ("doorplates", "kindergartens", "campuses", "population", "babycare")
BABYCARE_KINDS = ("center", "home")
PROVIDERS = ("kindergarten", "babycare")
PROVIDER_CHANGES = ("opened", "closed", "kind_changed")
```

(d) `GeoKindergarten` 在 `phone` 欄位之後、`is_active` 之前加：

```python
    # 設立日（來源 reg_date）；解析不出來存 NULL。近 12 個月內設立的營業中園所算「新設」（規格 P3）。
    registered_on: Mapped[date | None] = mapped_column(Date, nullable=True)
```
並把檔頭的 `from datetime import datetime` 改成 `from datetime import date, datetime`。`GeoKindergarten` 的 docstring 末尾加一句：停辦的園所 `is_active` 為假、列留著（2026-10-14）。

(e) `GeoDatasetStatus`：docstring 的條列加兩行——
`- babycare：active_version、label 都是同步日期（同 kindergartens）；`
`baseline_on 是第一次用「依 source_id 比對」的程式同步成功的台北日期（kindergartens、babycare 才有；規格 P8），畫面靠它寫「從 N 月 N 日起記錄」。`
並在 `last_error` 欄位之後加：

```python
    baseline_on: Mapped[date | None] = mapped_column(Date, nullable=True)
```

(f) 在 `GeoKindergarten` 之後新增兩個類別：

```python
class GeoBabycare(Base):
    """高雄市的托嬰中心與公共托育家園（kiang 整理的衛福部社家署公開資料）。停辦的列留著（is_active 假）。
    不存負責人姓名（來源本來就沒有）。實際收托是官方回報的數字，統計時點官方沒有說明。"""

    __tablename__ = "geo_babycare"
    __table_args__ = (
        CheckConstraint(_in("kind", BABYCARE_KINDS), name="ck_geo_babycare_kind"),
        Index("ix_geo_babycare_lat_lng", "lat", "lng"),
    )

    source_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(8), nullable=False)
    address: Mapped[str] = mapped_column(String(200), nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    approved_capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    enrolled: Mapped[int | None] = mapped_column(Integer, nullable=True)
    phone: Mapped[str | None] = mapped_column(String(40), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class GeoProviderEvent(Base):
    """幼兒園與托嬰的異動紀錄（opened＝新出現或重新營業、closed＝停辦、kind_changed＝類型變了）。
    不存名稱與座標，讀的時候 join 對應的園所表（列不刪，只標停辦）。occurred_on 是同步到的台北日期，
    來源沒有停辦日。同一天、同一所、同一種只有一筆（唯一約束），所以同步重跑不會重複。"""

    __tablename__ = "geo_provider_events"
    __table_args__ = (
        CheckConstraint(_in("provider", PROVIDERS), name="ck_geo_provider_events_provider"),
        CheckConstraint(_in("change", PROVIDER_CHANGES), name="ck_geo_provider_events_change"),
        UniqueConstraint("provider", "source_id", "change", "occurred_on", name="uq_geo_provider_events_once"),
        Index("ix_geo_provider_events_occurred_on", "occurred_on"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    provider: Mapped[str] = mapped_column(String(16), nullable=False)
    source_id: Mapped[str] = mapped_column(String(64), nullable=False)
    change: Mapped[str] = mapped_column(String(16), nullable=False)
    occurred_on: Mapped[date] = mapped_column(Date, nullable=False)
    # kind_changed 才有：舊的與新的幼兒園類型。
    old_value: Mapped[str | None] = mapped_column(String(16), nullable=True)
    new_value: Mapped[str | None] = mapped_column(String(16), nullable=True)
```

- [ ] **Step 5: 新增 migration**

建立 `backend/migrations/versions/c6a9e3f15d27_provider_changes.py`：

```python
"""托嬰名單與園所異動：新增兩張表、兩個欄位，公開資料狀態多一種 babycare（2026-10-14 規格第 3 節）

規格：docs/specs/2026-10-14-provider-changes-design.md。
新增 geo_babycare、geo_provider_events，geo_kindergartens 加 registered_on（設立日），
geo_dataset_status 加 baseline_on（異動紀錄的基準日），並把 ck_geo_dataset_status_dataset 放寬成多收 'babycare'。
不改既有資料，不需要先備份正式庫。上一版程式不讀新表與新欄位、也不會寫 babycare 狀態列，
先跑 migration 再換程式也相容。約束條件字串與 app/admissions/geo/models.py 逐字相同
（tests/test_geo_schema.py 檢查）。

降級先刪 babycare 狀態列（否則還原舊約束會失敗），再還原約束、拿掉欄位、刪表；已記的異動一併消失。

Revision ID: c6a9e3f15d27
Revises: b4d7e1a92c58
Create Date: 2026-10-14
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "c6a9e3f15d27"
down_revision = "b4d7e1a92c58"
branch_labels = None
depends_on = None

DATASET_CHECK = "dataset IN ('doorplates', 'kindergartens', 'campuses', 'population', 'babycare')"
PREVIOUS_DATASET_CHECK = "dataset IN ('doorplates', 'kindergartens', 'campuses', 'population')"
BABYCARE_KIND_CHECK = "kind IN ('center', 'home')"
PROVIDER_CHECK = "provider IN ('kindergarten', 'babycare')"
CHANGE_CHECK = "change IN ('opened', 'closed', 'kind_changed')"


def upgrade() -> None:
    op.create_table(
        "geo_babycare",
        sa.Column("source_id", sa.String(64), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(8), nullable=False),
        sa.Column("address", sa.String(200), nullable=False),
        sa.Column("lat", sa.Float(), nullable=False),
        sa.Column("lng", sa.Float(), nullable=False),
        sa.Column("approved_capacity", sa.Integer(), nullable=True),
        sa.Column("enrolled", sa.Integer(), nullable=True),
        sa.Column("phone", sa.String(40), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(BABYCARE_KIND_CHECK, name="ck_geo_babycare_kind"),
    )
    op.create_index("ix_geo_babycare_lat_lng", "geo_babycare", ["lat", "lng"])
    op.create_table(
        "geo_provider_events",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column("provider", sa.String(16), nullable=False),
        sa.Column("source_id", sa.String(64), nullable=False),
        sa.Column("change", sa.String(16), nullable=False),
        sa.Column("occurred_on", sa.Date(), nullable=False),
        sa.Column("old_value", sa.String(16), nullable=True),
        sa.Column("new_value", sa.String(16), nullable=True),
        sa.CheckConstraint(PROVIDER_CHECK, name="ck_geo_provider_events_provider"),
        sa.CheckConstraint(CHANGE_CHECK, name="ck_geo_provider_events_change"),
        sa.UniqueConstraint("provider", "source_id", "change", "occurred_on", name="uq_geo_provider_events_once"),
    )
    op.create_index("ix_geo_provider_events_occurred_on", "geo_provider_events", ["occurred_on"])
    op.add_column("geo_kindergartens", sa.Column("registered_on", sa.Date(), nullable=True))
    op.add_column("geo_dataset_status", sa.Column("baseline_on", sa.Date(), nullable=True))
    op.drop_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", type_="check")
    op.create_check_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", DATASET_CHECK)


def downgrade() -> None:
    op.execute("DELETE FROM geo_dataset_status WHERE dataset = 'babycare'")
    op.drop_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", type_="check")
    op.create_check_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", PREVIOUS_DATASET_CHECK)
    op.drop_column("geo_dataset_status", "baseline_on")
    op.drop_column("geo_kindergartens", "registered_on")
    op.drop_index("ix_geo_provider_events_occurred_on", table_name="geo_provider_events")
    op.drop_table("geo_provider_events")
    op.drop_index("ix_geo_babycare_lat_lng", table_name="geo_babycare")
    op.drop_table("geo_babycare")
```

- [ ] **Step 6: 測試的 TRUNCATE 清單加兩張新表**

`backend/tests/conftest.py` 的 `_clean_tables` 那行
`"recruitment_visit_geo, geo_doorplates, geo_kindergartens, geo_village_population, geo_dataset_status, "`
改成
`"recruitment_visit_geo, geo_doorplates, geo_kindergartens, geo_babycare, geo_provider_events, geo_village_population, geo_dataset_status, "`

- [ ] **Step 7: 升級測試庫並跑測試**

```bash
cd ~/Repositories/ivy-website-wt/provider-changes-20261014/backend
PY alembic upgrade head
PY alembic heads            # 預期只有 c6a9e3f15d27 (head)
PY pytest -q -p no:cacheprovider tests/test_geo_schema.py
```
Expected：全部 PASS。接著跑 `PY pytest -q -p no:cacheprovider tests/test_geo_kindergartens.py tests/test_geo_population.py` 確認既有測試沒壞（`GeoKindergarten` 多了一個可為空的欄位，應全過）。

- [ ] **Step 8: 試一次降級再升級（確認 migration 可逆）**

```bash
PY alembic downgrade b4d7e1a92c58 && PY alembic upgrade head
```
Expected：兩個指令都成功結束。

- [ ] **Step 9: Commit**

```bash
cd ~/Repositories/ivy-website-wt/provider-changes-20261014
git add backend/app/admissions/geo/models.py backend/migrations/versions/c6a9e3f15d27_provider_changes.py backend/tests/conftest.py backend/tests/test_geo_schema.py
git commit -m "feat(geo): 托嬰名單與園所異動的資料表（geo_babycare、geo_provider_events、設立日、基準日）

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 解析托嬰名單、設立日，與托嬰半徑查詢

**Files:**
- Create: `backend/app/admissions/geo/babycare.py`
- Create: `backend/tests/fixtures/geo/babycare-sample.json`
- Modify: `backend/app/admissions/geo/kindergartens.py`
- Modify: `backend/app/config.py`
- Modify: `backend/tests/geo_helpers.py`
- Create: `backend/tests/test_geo_babycare.py`
- Modify: `backend/tests/test_geo_kindergartens.py`
- Modify: `backend/tests/test_geo_loop.py`（只改設定相關三處）

**Interfaces:**
- Consumes：Task 1 的 `GeoBabycare`。
- Produces：
  - `babycare.BabycareRow`（frozen dataclass：`source_id, name, kind, address, lat, lng, approved_capacity, enrolled, phone`）
  - `babycare.parse_babycare(data: dict, *, report: ParseReport | None = None) -> list[BabycareRow]`；`babycare.BabycareFormatError(ValueError)`
  - `babycare.NearbyBabycare`（frozen dataclass：`source_id, name, kind, address, lat, lng, distance_m, approved_capacity, enrolled, phone`）、`async babycare.nearby(db, lat, lng, radius_m) -> list[NearbyBabycare]`（只讀營業中、依距離再依名稱排序）、`babycare.SOURCE_NOTE`
  - `kindergartens.KindergartenRow.registered_on: date | None`（排在 `phone` 之後）、`kindergartens.kind_as_of(kind, pre_public_period, school_year) -> str`
  - `Settings.geo_babycare_url`（預設 `https://kiang.github.io/ncwisweb.sfaa.gov.tw/babycare.json`，必須 https）
  - 測試共用：`tests/geo_helpers.sample_babycare() -> dict`、檔案 `tests/fixtures/geo/babycare-sample.json`

- [ ] **Step 1: 建立樣本檔**

建立 `backend/tests/fixtures/geo/babycare-sample.json`（內容取自 2026-10-14 下載的真實公開資料；9 筆：高雄營業中 6 筆——離義華 165／435／939／1297／1657／8307 公尺，其中 `CW10808013` 是托育家園、`CW10112245` 的地址有重複的「高雄市…區…里」前綴——高雄停業 2 筆、新北市 1 筆）：

```json
{"type": "FeatureCollection", "features": [
{"type": "Feature", "properties": {"id": "CW10203013", "name": "高雄市政府社會局委託財團法人靖娟兒童安全文教基金會辦理高雄市三民公共托嬰中心", "city": "高雄市", "address": "807高雄市三民區本揚里陽明路300號2樓", "phone": "07-3801856", "capacity": 52, "status": 52, "is_active": true}, "geometry": {"type": "Point", "coordinates": [120.342424, 22.643336]}},
{"type": "Feature", "properties": {"id": "CW10112502", "name": "高雄市私立頂尖小子托嬰中心", "city": "高雄市", "address": "807高雄市三民區寶國里民豐路70號1-2樓", "phone": "07-3954611", "capacity": 20, "status": 20, "is_active": true}, "geometry": {"type": "Point", "coordinates": [120.339983, 22.640599]}},
{"type": "Feature", "properties": {"id": "CW11507009", "name": "高雄市私立博樂家托嬰中心", "city": "高雄市", "address": "830高雄市鳳山區文福里文教路156號", "phone": "07-7778278", "capacity": 48, "status": 6, "is_active": true}, "geometry": {"type": "Point", "coordinates": [120.346903, 22.634541]}},
{"type": "Feature", "properties": {"id": "CW10808013", "name": "高雄市政府社會局委託財團法人聖功社會福利慈善基金會辦理高雄市鳥松社區公共托育家園", "city": "高雄市", "address": "833高雄市鳥松區大華里大華路200號C棟1樓", "phone": "073705166", "capacity": 12, "status": 4, "is_active": true}, "geometry": {"type": "Point", "coordinates": [120.340501, 22.653733]}},
{"type": "Feature", "properties": {"id": "CW10112245", "name": "長庚醫療財團法人高雄長庚紀念醫院附設高雄市私立長庚托嬰中心", "city": "高雄市", "address": "833高雄市鳥松區鳥松里高雄市鳥松區大埤路123之4號1樓、123之6號1-2樓", "phone": "07-7317123", "capacity": 25, "status": 25, "is_active": true}, "geometry": {"type": "Point", "coordinates": [120.358433, 22.64857]}},
{"type": "Feature", "properties": {"id": "CW10512004", "name": "高雄市私立愛貝兒托嬰中心", "city": "高雄市", "address": "830高雄市鳳山區文福里文教路156號", "phone": "07-7670639", "capacity": 43, "status": 0, "is_active": false}, "geometry": {"type": "Point", "coordinates": [120.34690327522769, 22.6345413445945]}},
{"type": "Feature", "properties": {"id": "CW10709005", "name": "高雄市私立愛丁堡托嬰中心", "city": "高雄市", "address": "802高雄市苓雅區福東里武嶺街30號1-2樓", "phone": "07-7110857", "capacity": 60, "status": 0, "is_active": false}, "geometry": {"type": "Point", "coordinates": [120.334287, 22.621796]}},
{"type": "Feature", "properties": {"id": "CW11403015", "name": "高雄市私立多逸托嬰中心", "city": "高雄市", "address": "812高雄市小港區正苓里康莊路154號1-3樓", "phone": "07-8070660", "capacity": 37, "status": 28, "is_active": true}, "geometry": {"type": "Point", "coordinates": [120.352895, 22.568232]}},
{"type": "Feature", "properties": {"id": "CW10112003", "name": "新北市私立尼斯堡托嬰中心", "city": "新北市新店區", "address": "231新北市新店區中央里中央一街20號1樓", "phone": "02-82187139", "capacity": 5, "status": 5, "is_active": true}, "geometry": {"type": "Point", "coordinates": [121.528323, 24.973066]}}
]}
```

並在 `backend/tests/geo_helpers.py` 的 `sample_preschools()` 之後加（檔頭 docstring 的樣本清單也補一行 `- babycare-sample.json：…`）：

```python
def sample_babycare() -> dict:
    return json.loads((FIXTURES / "babycare-sample.json").read_text(encoding="utf-8"))
```

- [ ] **Step 2: 寫會失敗的測試**

(a) 建立 `backend/tests/test_geo_babycare.py`：

```python
"""托嬰中心與公共托育家園公開資料的解析與半徑查詢（2026-10-14 規格 §2、§3、§5）。"""

from __future__ import annotations

import copy
from dataclasses import asdict
from datetime import datetime, timezone

import pytest

from app.admissions.geo.babycare import BabycareFormatError, _address, nearby, parse_babycare
from app.admissions.geo.kindergartens import ParseReport
from app.admissions.geo.models import GeoBabycare
from tests.geo_helpers import YIHUA_POINT, sample_babycare


def _by_id(rows):
    return {row.source_id: row for row in rows}


def _feature(**overrides):
    props = {
        "id": "x1", "name": "測試托嬰中心", "city": "高雄市", "address": "807高雄市三民區某路1號",
        "phone": "07-1234567", "capacity": 20, "status": 15, "is_active": True,
    }
    coordinates = overrides.pop("coordinates", [120.3, 22.6])
    props.update(overrides)
    return {"type": "Feature", "properties": props, "geometry": {"type": "Point", "coordinates": coordinates}}


def _collection(*features):
    return {"type": "FeatureCollection", "features": list(features)}


def test_only_active_kaohsiung_rows_are_kept():
    rows = parse_babycare(sample_babycare())
    assert sorted(row.source_id for row in rows) == [
        "CW10112245", "CW10112502", "CW10203013", "CW10808013", "CW11403015", "CW11507009",
    ]  # 兩筆停業、一筆新北市不收


def test_home_is_recognised_by_name_everything_else_is_a_center():
    rows = _by_id(parse_babycare(sample_babycare()))
    assert rows["CW10808013"].kind == "home"
    assert {row.kind for key, row in rows.items() if key != "CW10808013"} == {"center"}


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("807高雄市三民區本揚里陽明路300號2樓", "高雄市三民區本揚里陽明路300號2樓"),
        # 有兩個「高雄市」：取最後一個起（前面是重複的區與里）。
        ("833高雄市鳥松區鳥松里高雄市鳥松區大埤路123之4號1樓、123之6號1-2樓", "高雄市鳥松區大埤路123之4號1樓、123之6號1-2樓"),
        ("高雄市某區某路1號", "高雄市某區某路1號"),  # 沒有郵遞區號
        ("  830高雄市鳳山區文福里文教路156號  ", "高雄市鳳山區文福里文教路156號"),
        ("", ""),
        (None, ""),
    ],
)
def test_address_cleaning(raw, expected):
    assert _address(raw) == expected


def test_fields_are_cleaned():
    rows = _by_id(parse_babycare(sample_babycare()))
    first = rows["CW10203013"]
    assert (first.approved_capacity, first.enrolled, first.phone) == (52, 52, "07-3801856")
    assert (first.lat, first.lng) == (22.643336, 120.342424)
    assert rows["CW10112245"].address == "高雄市鳥松區大埤路123之4號1樓、123之6號1-2樓"


def test_numbers_and_phone_edge_cases():
    data = _collection(
        _feature(id="a", capacity="1,200", status=" 3 ", phone=""),
        _feature(id="b", capacity="99999999999", status=None),
        _feature(id="c", capacity=True, status="abc"),
    )
    rows = _by_id(parse_babycare(data))
    assert (rows["a"].approved_capacity, rows["a"].enrolled, rows["a"].phone) == (1200, 3, None)
    assert (rows["b"].approved_capacity, rows["b"].enrolled) == (None, None)  # 超出 int4、空值：未知
    assert (rows["c"].approved_capacity, rows["c"].enrolled) == (None, None)  # 布林、非數字：未知


@pytest.mark.parametrize(
    ("value", "kept"),
    [(True, True), (False, False), ("1", True), ("0", False), (1, True), (0, False), ("true", True), (None, False), ("", False)],
)
def test_is_active_accepts_booleans_numbers_and_strings(value, kept):
    rows = parse_babycare(_collection(_feature(id="ok"), _feature(id="maybe", is_active=value)))
    assert ("maybe" in {row.source_id for row in rows}) is kept


def test_report_counts_only_rows_that_were_meant_to_be_kept():
    """別的縣市或停業的不算「略過」（本來就不要）；高雄市營業中卻不能用的才計數。"""
    report = ParseReport()
    data = _collection(
        _feature(id="ok"),
        _feature(id="taipei", city="臺北市"),
        _feature(id="closed", is_active=False),
        _feature(id="no-name", name=""),
        _feature(id="no-address", address=""),
        _feature(id="no-coordinates", coordinates=None),
        _feature(id="outside", coordinates=[121.56, 25.03]),
    )
    assert [row.source_id for row in parse_babycare(data, report=report)] == ["ok"]
    assert report.skipped == 4


@pytest.mark.parametrize(
    "overrides",
    [
        {"name": "園" * 121},  # name 欄寬 120
        {"address": "路" * 201},  # address 200
        {"phone": "1" * 41},  # phone 40
        {"id": "a" * 65},  # source_id 64
    ],
    ids=["name", "address", "phone", "source_id"],
)
def test_overlong_fields_skip_the_row_and_are_counted(overrides):
    report = ParseReport()
    rows = parse_babycare(_collection(_feature(id="ok"), _feature(**{"id": "long", **overrides})), report=report)
    assert [row.source_id for row in rows] == ["ok"]
    assert report.skipped == 1


def test_fields_exactly_at_column_width_are_kept():
    data = _collection(_feature(id="a" * 64, name="園" * 120, address="高雄市" + "路" * 197, phone="1" * 40))
    report = ParseReport()
    (row,) = parse_babycare(data, report=report)
    assert report.skipped == 0
    assert (len(row.source_id), len(row.name), len(row.address), len(row.phone)) == (64, 120, 200, 40)


@pytest.mark.parametrize(
    "coordinates",
    [[0, 0], [22.6, 120.3], ["nan", "nan"], [float("inf"), 22.6], [121.56, 25.03], [120.3], "abc", [], None],
)
def test_bad_or_out_of_range_coordinates_skip_the_row(coordinates):
    report = ParseReport()
    rows = parse_babycare(_collection(_feature(id="ok"), _feature(id="bad", coordinates=coordinates)), report=report)
    assert [row.source_id for row in rows] == ["ok"]
    assert report.skipped == 1


def test_duplicate_source_id_keeps_the_first_and_counts_the_rest():
    report = ParseReport()
    rows = parse_babycare(
        _collection(_feature(id="dup", name="甲"), _feature(id="dup", name="乙"), _feature(id="other", name="丙")), report=report
    )
    assert [(row.source_id, row.name) for row in rows] == [("dup", "甲"), ("other", "丙")]
    assert report.skipped == 1


def test_malformed_feature_entries_are_skipped_not_raised():
    report = ParseReport()
    data = _collection(_feature(id="ok"), None, "x", 5, {"properties": "oops"})
    assert [row.source_id for row in parse_babycare(data, report=report)] == ["ok"]
    assert report.skipped == 4


def test_report_is_optional_and_does_not_change_the_result():
    data = _collection(_feature(id="ok"), _feature(id="bad", name="園" * 121))
    assert [row.source_id for row in parse_babycare(copy.deepcopy(data))] == ["ok"]


@pytest.mark.parametrize(
    "data",
    [{}, {"features": "x"}, {"type": "FeatureCollection", "features": []},
     _collection(_feature(id="t", city="臺北市")), _collection(_feature(id="c", is_active=False))],
)
def test_unexpected_shape_or_no_active_kaohsiung_row_is_rejected(data):
    with pytest.raises(BabycareFormatError):
        parse_babycare(data)


async def _load(db, *, inactive: tuple[str, ...] = ()) -> None:
    now = datetime.now(timezone.utc)
    for row in parse_babycare(sample_babycare()):
        db.add(GeoBabycare(**asdict(row), is_active=row.source_id not in inactive, synced_at=now))
    await db.commit()


async def test_nearby_is_sorted_by_distance_within_the_radius(db_session):
    await _load(db_session)
    within_1km = await nearby(db_session, *YIHUA_POINT, 1000)
    assert [(item.source_id, item.distance_m) for item in within_1km] == [
        ("CW10203013", 165), ("CW10112502", 435), ("CW11507009", 939),
    ]
    within_3km = await nearby(db_session, *YIHUA_POINT, 3000)
    assert [(item.source_id, item.distance_m) for item in within_3km][-2:] == [("CW10808013", 1297), ("CW10112245", 1657)]
    assert "CW11403015" not in {item.source_id for item in await nearby(db_session, *YIHUA_POINT, 6000)}  # 8.3 公里
    assert "CW11403015" in {item.source_id for item in await nearby(db_session, *YIHUA_POINT, 9000)}


async def test_nearby_skips_closed_rows(db_session):
    await _load(db_session, inactive=("CW10112502",))
    assert [item.source_id for item in await nearby(db_session, *YIHUA_POINT, 1000)] == ["CW10203013", "CW11507009"]


async def test_nearby_breaks_distance_ties_by_name(db_session):
    now = datetime.now(timezone.utc)
    lat, lng = YIHUA_POINT
    for source_id, name in (("a", "甲托嬰中心"), ("b", "乙托嬰中心")):
        db_session.add(
            GeoBabycare(
                source_id=source_id, name=name, kind="center", address="高雄市三民區某路1號", lat=lat + 0.001, lng=lng,
                is_active=True, synced_at=now,
            )
        )
    await db_session.commit()
    # 乙（U+4E59）排在甲（U+7532）前面，和寫入順序（甲先）相反：確實是名稱在決定順序。
    assert [item.name for item in await nearby(db_session, lat, lng, 1000)] == ["乙托嬰中心", "甲托嬰中心"]
```

(b) `backend/tests/test_geo_kindergartens.py`：檔頭 `from datetime import datetime, timezone` 改成 `from datetime import date, datetime, timezone`；import 區把 `from app.admissions.geo.kindergartens import (...)` 加上 `kind_as_of`。在 `test_fields_are_cleaned` 之前新增：

```python
@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("2026/02/13", date(2026, 2, 13)),
        ("2026/2/3", date(2026, 2, 3)),
        ("2026/02/30", None),  # 不存在的日期
        ("2026-02-13", None),  # 來源固定用斜線
        ("20260213", None),
        ("0000/01/01", None),
        ("", None),
        (None, None),
    ],
)
def test_registered_on_is_parsed_or_unknown(raw, expected):
    (row,) = parse_preschools(_collection(_feature(id="x", reg_date=raw)), school_year=115)
    assert row.registered_on == expected


def test_registered_on_is_unknown_when_the_source_has_no_such_field():
    (row,) = parse_preschools(_collection(_feature(id="x")), school_year=115)
    assert row.registered_on is None


@pytest.mark.parametrize(
    ("kind", "period", "school_year", "expected"),
    [
        ("quasi_public", "113-115", 115, "quasi_public"),
        ("quasi_public", "113-115", 116, "private"),  # 期間過了：沒改過資料的準公共自己變回私立
        ("private", "113-115", 115, "quasi_public"),  # 舊列存的是私立，但期間涵蓋這一年
        ("private", None, 115, "private"),
        ("public", "113-115", 116, "public"),  # 公立、非營利不受準公共期間影響
        ("nonprofit", None, 116, "nonprofit"),
    ],
)
def test_kind_as_of_recomputes_the_private_and_quasi_public_kinds(kind, period, school_year, expected):
    assert kind_as_of(kind, period, school_year) == expected
```

(c) `backend/tests/test_geo_loop.py`：
- `test_geo_settings_defaults` 函式裡，`assert settings.geo_kindergartens_url == ...` 那行之後加一行：
  `assert settings.geo_babycare_url == "https://kiang.github.io/ncwisweb.sfaa.gov.tw/babycare.json"`
- `test_geo_settings_reject_unsafe_values` 的參數清單加一項：`{"geo_babycare_url": "http://example.org/b.json"},`

- [ ] **Step 3: 跑測試確認失敗**

Run：`PY pytest -q -p no:cacheprovider tests/test_geo_babycare.py tests/test_geo_kindergartens.py tests/test_geo_loop.py -x`
Expected：FAIL（`ModuleNotFoundError: app.admissions.geo.babycare`／`ImportError: kind_as_of`）。

- [ ] **Step 4: 實作 `kindergartens.py` 的兩處新增**

(a) import 區：`from datetime import datetime` 改成 `from datetime import date, datetime`（`replace_kindergartens` 要到 Task 3 才移除，這個 task 先保留它不動）。

(b) `KindergartenRow` 在 `phone` 之後加：

```python
    registered_on: date | None = None
```
（預設值讓既有只靠位置建立這個 dataclass 的呼叫端不受影響；`dataclass` 要求有預設值的欄位排在最後，`phone` 是最後一個，沒問題。）

(c) 在 `_text_or_none` 之後新增：

```python
def _registered_on(value: object) -> date | None:
    """來源的設立日 reg_date，格式 YYYY/MM/DD（月日可只有一位）；格式不符或不是真的日期回 None。"""
    text = _text_or_none(value)
    if text is None:
        return None
    try:
        year, month, day = (int(part) for part in text.split("/"))
        return date(year, month, day)
    except ValueError:  # 段數不對、不是數字、不存在的日期都是
        return None
```

(d) 在 `_kind` 之後新增：

```python
def kind_as_of(kind: str, pre_public_period: str | None, school_year: int) -> str:
    """資料表裡舊列的類型，用 school_year 這一學年重算（規格 P7）。公立、非營利不受準公共期間影響；
    私立與準公共本質上都是私立，依舊列保存的準公共期間重算。8 月學年更替時沒改過資料的園所類型會
    自己變，比對異動時舊的一邊要先這樣重算，才不會一次冒出一批假的類型變動。"""
    if kind in ("private", "quasi_public"):
        return _kind("私立", pre_public_period, school_year) or kind
    return kind
```

(e) `_row` 裡建立 `KindergartenRow(...)` 的地方，在 `phone=_text_or_none(props.get("tel")),` 之後加：
`registered_on=_registered_on(props.get("reg_date")),`

- [ ] **Step 5: 新增 `babycare.py`**

建立 `backend/app/admissions/geo/babycare.py`：

```python
"""托嬰中心與公共托育家園公開資料：kiang 整理的 babycare.json（規格 §2、§3、§5）。

來源 https://kiang.github.io/ncwisweb.sfaa.gov.tw/babycare.json（GeoJSON FeatureCollection，全國約 2,000 筆，
衛福部社會及家庭署公開資料，每天自動更新）。properties 只有 id、name、city、address、phone、
capacity（核定人數）、status（實際收托）、is_active；沒有設立日、類型、月費，也沒有負責人姓名。
類型由名稱判斷：含「家園」＝公共托育家園（home），其餘＝托嬰中心（center）。實際收托是官方回報的數字，
統計時點與定義官方沒有說明，畫面只寫「實際收托（官方資料）」。

只留高雄市、營業中（is_active 為真）的機構；缺必要欄位、欄位超過資料表欄寬、座標不是有限數或不在
高雄市外框內、id 重複，整筆略過並計入 ParseReport.skipped（別的縣市、停業的本來就不要，不算）；
不讓一筆壞資料使整批寫入失敗。數量欄位超出 int4 當成未知。停業的機構不收進來：同步比對時
「名單沒有」就是停辦（providers.py）。"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.geo.kaohsiung import in_kaohsiung
from app.admissions.geo.kindergartens import ParseReport, _int_or_none, _text_or_none  # 同一套欄位清理
from app.admissions.geo.models import GeoBabycare
from app.admissions.geo.projection import haversine_m

SOURCE_NOTE = "資料來源：衛生福利部社會及家庭署公開資料（kiang 整理）；實際收托為官方資料"
_POSTAL_PREFIX = re.compile(r"^\d{3,6}")
_METERS_PER_DEGREE = 111_320.0
# 文字欄位上限，以資料表欄寬為準。
_WIDTHS = {
    name: GeoBabycare.__table__.c[name].type.length for name in ("source_id", "name", "address", "phone")
}


class BabycareFormatError(ValueError):
    """babycare.json 不是預期的格式（或一所高雄市營業中的機構都沒有）。"""


@dataclass(frozen=True)
class BabycareRow:
    source_id: str
    name: str
    kind: str
    address: str
    lat: float
    lng: float
    approved_capacity: int | None
    enrolled: int | None
    phone: str | None


@dataclass(frozen=True)
class NearbyBabycare:
    source_id: str
    name: str
    kind: str
    address: str
    lat: float
    lng: float
    distance_m: int
    approved_capacity: int | None
    enrolled: int | None
    phone: str | None


def _address(raw: object) -> str:
    """去掉開頭的郵遞區號；有兩個以上「高雄市」時（來源常把區與里重複寫一遍）取最後一個起。"""
    text = _POSTAL_PREFIX.sub("", str(raw or "").strip(), count=1)
    if text.count("高雄市") >= 2:
        return "高雄市" + text.rpartition("高雄市")[2]
    return text


def _is_active(value: object) -> bool:
    return value is True or str(value).strip().lower() in ("1", "true")


def parse_babycare(data: dict, *, report: ParseReport | None = None) -> list[BabycareRow]:
    features = data.get("features") if isinstance(data, dict) else None
    if not isinstance(features, list):
        raise BabycareFormatError("托嬰名單不是 GeoJSON FeatureCollection")
    report = report if report is not None else ParseReport()
    rows: list[BabycareRow] = []
    seen: set[str] = set()
    for feature in features:
        props = (feature.get("properties") or {}) if isinstance(feature, dict) else None
        if not isinstance(props, dict):
            report.skipped += 1
            continue
        if str(props.get("city") or "").replace("臺", "台") != "高雄市" or not _is_active(props.get("is_active")):
            continue
        row = _row(feature, props)
        if row is None or row.source_id in seen:
            report.skipped += 1
            continue
        seen.add(row.source_id)
        rows.append(row)
    if not rows:
        raise BabycareFormatError("托嬰名單裡沒有高雄市營業中的機構")
    return rows


def _row(feature: dict, props: dict) -> BabycareRow | None:
    """一筆高雄市營業中的機構 → 資料列；缺必要欄位、欄位放不進資料表、座標不合格回 None。"""
    try:
        lng, lat = (float(value) for value in feature["geometry"]["coordinates"][:2])
    except (KeyError, TypeError, ValueError):
        return None
    if not in_kaohsiung(lat, lng):
        return None
    source_id = _text_or_none(props.get("id"))
    name = _text_or_none(props.get("name"))
    address = _address(props.get("address"))
    if source_id is None or name is None or not address:
        return None
    row = BabycareRow(
        source_id=source_id,
        name=name,
        kind="home" if "家園" in name else "center",
        address=address,
        lat=lat,
        lng=lng,
        approved_capacity=_int_or_none(props.get("capacity")),
        enrolled=_int_or_none(props.get("status")),
        phone=_text_or_none(props.get("phone")),
    )
    if any(len(getattr(row, column) or "") > width for column, width in _WIDTHS.items()):
        return None
    return row


async def nearby(db: AsyncSession, lat: float, lng: float, radius_m: int) -> list[NearbyBabycare]:
    """半徑 radius_m 內營業中的機構，依距離（公尺，四捨五入）、名稱排序。先用經緯度方框篩，再算大圓距離。"""
    dlat = radius_m / _METERS_PER_DEGREE
    dlng = radius_m / (_METERS_PER_DEGREE * math.cos(math.radians(lat)))
    result = await db.execute(
        select(GeoBabycare).where(
            GeoBabycare.is_active.is_(True),
            GeoBabycare.lat.between(lat - dlat, lat + dlat),
            GeoBabycare.lng.between(lng - dlng, lng + dlng),
        )
    )
    items: list[NearbyBabycare] = []
    for row in result.scalars():
        distance = haversine_m(lat, lng, row.lat, row.lng)
        if distance > radius_m:
            continue
        items.append(
            NearbyBabycare(
                source_id=row.source_id, name=row.name, kind=row.kind, address=row.address, lat=row.lat, lng=row.lng,
                distance_m=round(distance), approved_capacity=row.approved_capacity, enrolled=row.enrolled, phone=row.phone,
            )
        )
    items.sort(key=lambda item: (item.distance_m, item.name))
    return items
```

注意 `test_fields_exactly_at_column_width_are_kept` 的地址是 `"高雄市" + "路" * 197`（200 字、沒有第二個「高雄市」）。

- [ ] **Step 6: `config.py` 加設定與驗證**

在 `geo_kindergartens_url: str = ...` 下一行加：

```python
    # 托嬰名單（2026-10-14）：kiang 每天整理的衛福部社家署公開資料。
    geo_babycare_url: str = "https://kiang.github.io/ncwisweb.sfaa.gov.tw/babycare.json"
```
並在 `_geo_kindergartens_url` 驗證函式之後加：

```python
    @field_validator("geo_babycare_url")
    @classmethod
    def _geo_babycare_url(cls, value: str) -> str:
        value = value.strip()
        if not value.startswith("https://"):
            raise ValueError("WEBSITE_GEO_BABYCARE_URL 必須是 https:// 網址")
        return value
```

- [ ] **Step 7: 跑測試**

Run：`PY pytest -q -p no:cacheprovider tests/test_geo_babycare.py tests/test_geo_kindergartens.py tests/test_geo_loop.py`
Expected：PASS（`test_geo_loop.py` 內與 `geo_sync_options` 完全相等比對的兩個測試要到 Task 4 才會動，這裡不受影響）。

- [ ] **Step 8: Commit**

```bash
cd ~/Repositories/ivy-website-wt/provider-changes-20261014
git add backend/app/admissions/geo/babycare.py backend/app/admissions/geo/kindergartens.py backend/app/config.py backend/tests/fixtures/geo/babycare-sample.json backend/tests/geo_helpers.py backend/tests/test_geo_babycare.py backend/tests/test_geo_kindergartens.py backend/tests/test_geo_loop.py
git commit -m "feat(geo): 解析托嬰名單與幼兒園設立日，托嬰半徑查詢

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 名單比對與異動紀錄（`providers.py`），取代「刪光重寫」

**Files:**
- Create: `backend/app/admissions/geo/providers.py`
- Modify: `backend/app/admissions/geo/kindergartens.py`（移除 `replace_kindergartens` 與用不到的 import）
- Modify: `backend/app/admissions/geo/sync.py`（只改 `sync_kindergartens` 的呼叫與 `_error_text`，其餘 Task 4）
- Modify: `backend/tests/geo_helpers.py`、`backend/tests/test_geo_kindergartens.py`
- Create: `backend/tests/test_geo_providers.py`

**Interfaces:**
- Consumes：Task 1 的模型；Task 2 的 `BabycareRow`、`KindergartenRow`、`kind_as_of`。
- Produces：
  - `providers.PROVIDER_REFRESH_AFTER = timedelta(days=7)`、`CHANGE_WINDOW_MONTHS = 12`、`EVENT_RETENTION_MONTHS = 24`、`REOPEN_CANCELS_CLOSURE = timedelta(days=30)`、`TRUNCATION_RATIO = 0.8`、`TRUNCATION_MIN_PREVIOUS = 20`、`SHRUNK_MESSAGE`
  - `class ProviderShrunk(RuntimeError)`
  - `@dataclass(frozen=True) ChangeReport(active: int, opened: int = 0, closed: int = 0, kind_changed: int = 0, cancelled_closures: int = 0)`
  - `async apply_kindergartens(db, rows: list[KindergartenRow], *, synced_at: datetime, school_year: int, force: bool = False) -> ChangeReport`
  - `async apply_babycare(db, rows: list[BabycareRow], *, synced_at: datetime, force: bool = False) -> ChangeReport`（兩者都**不 commit**）
  - `months_ago(day: date, months: int) -> date`
  - 測試共用：`tests/geo_helpers.load_babycare_sample(db, *, now=None)`

- [ ] **Step 1: 寫會失敗的測試**

建立 `backend/tests/test_geo_providers.py`：

```python
"""幼兒園與托嬰的名單比對與異動紀錄（2026-10-14 規格 §4、裁定 P3–P9）。"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import func, select

from app.admissions.geo.babycare import BabycareRow
from app.admissions.geo.kindergartens import KindergartenRow
from app.admissions.geo.models import GeoBabycare, GeoDatasetStatus, GeoKindergarten, GeoProviderEvent
from app.admissions.geo.providers import (
    SHRUNK_MESSAGE,
    ProviderShrunk,
    apply_babycare,
    apply_kindergartens,
    months_ago,
)

# 台北 2026-10-14 12:00（UTC 04:00，兩邊同一天）。
NOW = datetime(2026, 10, 14, 4, 0, tzinfo=timezone.utc)
TODAY = date(2026, 10, 14)


def later(days: int) -> datetime:
    return NOW + timedelta(days=days)


def bc(source_id: str, *, enrolled: int | None = 10, name: str | None = None) -> BabycareRow:
    return BabycareRow(
        source_id=source_id, name=name or f"托嬰{source_id}", kind="center", address="高雄市三民區某路1號",
        lat=22.64, lng=120.34, approved_capacity=20, enrolled=enrolled, phone=None,
    )


def kg(
    source_id: str, *, kind: str = "private", period: str | None = None, registered_on: date | None = None,
    capacity: int | None = 100, name: str | None = None,
) -> KindergartenRow:
    return KindergartenRow(
        source_id=source_id, reg_no=None, name=name or f"幼兒園{source_id}", kind=kind, pre_public_period=period,
        district="三民區", address="某路1號", lat=22.64, lng=120.34, approved_capacity=capacity,
        monthly_fee_estimate=None, has_penalty=False, phone=None, registered_on=registered_on,
    )


def many_babycare(count: int) -> list[BabycareRow]:
    return [bc(f"b{index:02d}") for index in range(count)]


async def put_babycare(db, rows, *, now=NOW, force=False):
    report = await apply_babycare(db, rows, synced_at=now, force=force)
    await db.commit()
    return report


async def put_kindergartens(db, rows, *, now=NOW, school_year=115, force=False):
    report = await apply_kindergartens(db, rows, synced_at=now, school_year=school_year, force=force)
    await db.commit()
    return report


async def events(db):
    result = await db.execute(select(GeoProviderEvent).order_by(GeoProviderEvent.id))
    return [(e.provider, e.source_id, e.change, e.occurred_on, e.old_value, e.new_value) for e in result.scalars()]


async def active_ids(db, model):
    result = await db.execute(select(model.source_id).where(model.is_active.is_(True)).order_by(model.source_id))
    return list(result.scalars())


# ---- 基準 ----


async def test_first_babycare_sync_only_sets_the_baseline(db_session):
    """資料表是空的（托嬰第一次）：只建立基準，不能寫任何 opened 事件，否則上線第一天就有一百多筆「新設」。"""
    report = await put_babycare(db_session, [bc("b1"), bc("b2")])
    assert (report.active, report.opened, report.closed) == (2, 0, 0)
    assert await events(db_session) == []
    status = await db_session.get(GeoDatasetStatus, "babycare")
    assert (status.baseline_on, status.label, status.active_version, status.synced_at) == (TODAY, "2026-10-14", "2026-10-14", NOW)
    assert status.last_error is None
    assert await db_session.scalar(select(func.count()).select_from(GeoBabycare)) == 2


async def test_baseline_is_set_once(db_session):
    await put_babycare(db_session, [bc("b1")])
    await put_babycare(db_session, [bc("b1")], now=later(30))
    status = await db_session.get(GeoDatasetStatus, "babycare")
    assert (status.baseline_on, status.label) == (TODAY, "2026-11-13")


async def test_an_existing_status_row_without_a_baseline_gets_one(db_session):
    """舊程式留下的狀態列沒有基準日：第一次用新程式同步時補上。"""
    db_session.add(GeoDatasetStatus(dataset="kindergartens", active_version="2026-10-12", label="2026-10-12", synced_at=NOW, checked_at=NOW))
    await db_session.commit()
    await put_kindergartens(db_session, [kg("k1")])
    assert (await db_session.get(GeoDatasetStatus, "kindergartens")).baseline_on == TODAY


async def test_kindergarten_rows_left_by_the_old_sync_are_compared_on_the_first_run(db_session):
    """幼兒園資料表原本就有列（舊程式寫的，沒有設立日）：第一次也照常比對，不當成空表。"""
    for source_id in ("k1", "k2"):
        db_session.add(
            GeoKindergarten(
                source_id=source_id, name=f"舊{source_id}", kind="private", district="三民區", address="某路1號",
                lat=22.64, lng=120.34, is_active=True, synced_at=NOW,
            )
        )
    await db_session.commit()
    report = await put_kindergartens(db_session, [kg("k1")])
    assert report.closed == 1
    assert await events(db_session) == [("kindergarten", "k2", "closed", TODAY, None, None)]


# ---- 托嬰：新增、停辦、回來 ----


async def test_a_new_babycare_after_the_baseline_is_an_opened_event(db_session):
    await put_babycare(db_session, [bc("b1")])
    report = await put_babycare(db_session, [bc("b1"), bc("b3")], now=later(7))
    assert (report.opened, report.closed) == (1, 0)
    assert await events(db_session) == [("babycare", "b3", "opened", date(2026, 10, 21), None, None)]


async def test_a_babycare_missing_from_the_list_is_closed_once(db_session):
    await put_babycare(db_session, [bc("b1"), bc("b2")])
    report = await put_babycare(db_session, [bc("b1")], now=later(7))
    assert report.closed == 1
    assert await active_ids(db_session, GeoBabycare) == ["b1"]
    assert await db_session.scalar(select(func.count()).select_from(GeoBabycare)) == 2  # 列留著
    await put_babycare(db_session, [bc("b1")], now=later(14))  # 下一次仍然沒有它：不再寫事件
    assert await events(db_session) == [("babycare", "b2", "closed", date(2026, 10, 21), None, None)]


@pytest.mark.parametrize(
    ("back_day", "expected"),
    [(10, []), (33, []), (34, ["closed", "opened"])],
    ids=["10 天後回來", "剛好 30 天後回來", "31 天後回來"],
)
async def test_coming_back_within_30_days_cancels_the_closure(db_session, back_day, expected):
    """停辦事件寫在第 3 天。30 天內（含第 30 天）又出現＝來源漏收：兩筆事件都不留；第 31 天才回來才算停辦＋重新營業。"""
    await put_babycare(db_session, [bc("b1"), bc("b2")])
    await put_babycare(db_session, [bc("b1")], now=later(3))
    report = await put_babycare(db_session, [bc("b1"), bc("b2")], now=later(back_day))
    assert [event[2] for event in await events(db_session)] == expected
    assert await active_ids(db_session, GeoBabycare) == ["b1", "b2"]
    assert report.cancelled_closures == (0 if expected else 1)


async def test_rerunning_the_same_list_the_same_day_adds_no_events(db_session):
    await put_babycare(db_session, [bc("b1"), bc("b2")])
    for _ in range(2):
        await put_babycare(db_session, [bc("b1")], now=later(7))
    for _ in range(2):
        await put_babycare(db_session, [bc("b1"), bc("b3")], now=later(7))
    assert await events(db_session) == [
        ("babycare", "b2", "closed", date(2026, 10, 21), None, None),
        ("babycare", "b3", "opened", date(2026, 10, 21), None, None),
    ]


# ---- 幼兒園 ----


async def test_new_kindergartens_never_write_events(db_session):
    """新設看設立日（讀的時候算），不靠事件：剛被來源收錄的老園所不能被當成新設。"""
    await put_kindergartens(db_session, [kg("k1")])
    await put_kindergartens(db_session, [kg("k1"), kg("k2", registered_on=date(2026, 9, 1))], now=later(7))
    assert await events(db_session) == []
    assert await active_ids(db_session, GeoKindergarten) == ["k1", "k2"]


async def test_a_kindergarten_closed_and_reopened_later(db_session):
    await put_kindergartens(db_session, [kg("k1"), kg("k2")])
    await put_kindergartens(db_session, [kg("k1")], now=later(7))
    await put_kindergartens(db_session, [kg("k1"), kg("k2")], now=later(60))
    assert await events(db_session) == [
        ("kindergarten", "k2", "closed", date(2026, 10, 21), None, None),
        ("kindergarten", "k2", "opened", date(2026, 12, 13), None, None),
    ]


async def test_existing_rows_are_updated_in_place(db_session):
    await put_kindergartens(db_session, [kg("k1", name="舊名", capacity=100)])
    await put_kindergartens(db_session, [kg("k1", name="新名", capacity=120, registered_on=date(2026, 2, 13))], now=later(7))
    row = await db_session.get(GeoKindergarten, "k1")
    assert (row.name, row.approved_capacity, row.registered_on, row.synced_at) == ("新名", 120, date(2026, 2, 13), later(7))
    assert await events(db_session) == []


async def test_a_school_year_rollover_alone_is_not_a_kind_change(db_session):
    """8 月學年更替：準公共期間沒改（113-115），116 學年解析出來自然變成私立。舊的類型用 116 學年重算，所以不算變動。"""
    await put_kindergartens(db_session, [kg("k1", kind="quasi_public", period="113-115")], school_year=115)
    report = await put_kindergartens(db_session, [kg("k1", kind="private", period="113-115")], now=later(300), school_year=116)
    assert report.kind_changed == 0 and await events(db_session) == []
    assert (await db_session.get(GeoKindergarten, "k1")).kind == "private"  # 資料表照新的更新


async def test_a_changed_quasi_public_period_is_a_kind_change(db_session):
    await put_kindergartens(db_session, [kg("k1", kind="private")], school_year=116)
    report = await put_kindergartens(db_session, [kg("k1", kind="quasi_public", period="116-118")], now=later(7), school_year=116)
    assert report.kind_changed == 1
    assert await events(db_session) == [("kindergarten", "k1", "kind_changed", date(2026, 10, 21), "private", "quasi_public")]


async def test_a_changed_school_type_is_a_kind_change(db_session):
    await put_kindergartens(db_session, [kg("k1", kind="nonprofit")])
    await put_kindergartens(db_session, [kg("k1", kind="public")], now=later(7))
    assert await events(db_session) == [("kindergarten", "k1", "kind_changed", date(2026, 10, 21), "nonprofit", "public")]


# ---- 殘缺檔 ----


async def test_a_truncated_list_is_refused_and_nothing_is_closed(db_session):
    """上次營業中 25 所，新檔只剩 19 所（< 80%）：不換版、不寫事件。"""
    await put_babycare(db_session, many_babycare(25))
    with pytest.raises(ProviderShrunk, match=SHRUNK_MESSAGE):
        await put_babycare(db_session, many_babycare(19), now=later(7))
    await db_session.rollback()
    assert len(await active_ids(db_session, GeoBabycare)) == 25
    assert await events(db_session) == []
    assert (await db_session.get(GeoDatasetStatus, "babycare")).label == "2026-10-14"  # 沒換版


async def test_exactly_eighty_percent_is_accepted(db_session):
    await put_babycare(db_session, many_babycare(25))
    report = await put_babycare(db_session, many_babycare(20), now=later(7))
    assert report.closed == 5


async def test_a_small_previous_list_is_not_checked(db_session):
    await put_babycare(db_session, many_babycare(10))
    assert (await put_babycare(db_session, many_babycare(1), now=later(7))).closed == 9


async def test_force_skips_the_truncation_check(db_session):
    await put_babycare(db_session, many_babycare(25))
    assert (await put_babycare(db_session, many_babycare(5), now=later(7), force=True)).closed == 20


# ---- 事件保留期 ----


async def test_events_older_than_24_months_are_pruned_per_provider(db_session):
    await put_babycare(db_session, [bc("b1")])
    db_session.add_all(
        [
            GeoProviderEvent(provider="babycare", source_id="old", change="closed", occurred_on=date(2024, 10, 13)),
            GeoProviderEvent(provider="babycare", source_id="edge", change="closed", occurred_on=date(2024, 10, 14)),
            GeoProviderEvent(provider="kindergarten", source_id="kold", change="closed", occurred_on=date(2020, 1, 1)),
        ]
    )
    await db_session.commit()
    await put_babycare(db_session, [bc("b1")])  # 同一天再跑：今天 2026-10-14，保留期從 2024-10-14 起
    assert {(event[0], event[1]) for event in await events(db_session)} == {("babycare", "edge"), ("kindergarten", "kold")}


@pytest.mark.parametrize(
    ("day", "months", "expected"),
    [
        (date(2026, 10, 14), 12, date(2025, 10, 14)),
        (date(2026, 10, 14), 0, date(2026, 10, 14)),
        (date(2024, 2, 29), 12, date(2023, 2, 28)),  # 閏日往前推一年：取 2/28
        (date(2028, 2, 29), 12, date(2027, 2, 28)),
        (date(2026, 3, 31), 1, date(2026, 2, 28)),  # 月底往前推：取該月最後一天
        (date(2026, 1, 15), 24, date(2024, 1, 15)),
        (date(2026, 2, 28), 12, date(2025, 2, 28)),
    ],
)
def test_months_ago(day, months, expected):
    assert months_ago(day, months) == expected
```

- [ ] **Step 2: 更新測試輔助與既有測試的呼叫**

(a) `backend/tests/geo_helpers.py`：
- import 改成
  ```python
  from app.admissions.geo.babycare import parse_babycare
  from app.admissions.geo.kindergartens import parse_preschools
  from app.admissions.geo.models import GeoBabycare, GeoDatasetStatus, GeoDoorplate, GeoKindergarten, GeoProviderEvent
  from app.admissions.geo.providers import apply_babycare, apply_kindergartens
  ```
  （原本的 `from app.admissions.geo.kindergartens import parse_preschools, replace_kindergartens` 與 `from app.admissions.geo.models import GeoDatasetStatus, GeoDoorplate, GeoKindergarten` 兩行換掉；`sample_babycare` 在 Task 2 已加。）
- `load_geo_samples` 的清除段與載入段改成：
  ```python
      await db.execute(delete(GeoDoorplate))
      await db.execute(delete(GeoProviderEvent))
      await db.execute(delete(GeoKindergarten))
      await db.execute(delete(GeoDatasetStatus))
  ```
  以及
  ```python
      rows = parse_preschools(sample_preschools(), school_year=SAMPLE_SCHOOL_YEAR)
      await apply_kindergartens(db, rows, synced_at=now, school_year=SAMPLE_SCHOOL_YEAR)
      await db.commit()
  ```
- 在 `load_geo_samples` 之後新增：
  ```python
  async def load_babycare_sample(db: AsyncSession, *, now: datetime | None = None) -> None:
      """清掉托嬰名單與異動紀錄，載入托嬰樣本（高雄營業中 6 所）並設為使用中。可以重複呼叫。會 commit。
      不動幼兒園與其他狀態列（load_geo_samples 的狀態列斷言只認 doorplates、kindergartens 兩筆）。"""
      await db.execute(delete(GeoProviderEvent).where(GeoProviderEvent.provider == "babycare"))
      await db.execute(delete(GeoBabycare))
      await db.execute(delete(GeoDatasetStatus).where(GeoDatasetStatus.dataset == "babycare"))
      await apply_babycare(db, parse_babycare(sample_babycare()), synced_at=now or datetime.now(timezone.utc))
      await db.commit()
  ```

(b) `backend/tests/test_geo_kindergartens.py`：
- import 區：從 `app.admissions.geo.kindergartens` 的名單拿掉 `replace_kindergartens`；新增 `from app.admissions.geo.providers import apply_kindergartens`。
- `test_replace_and_nearby` 改名 `test_apply_and_nearby`，其中：
  `assert await replace_kindergartens(db_session, rows, synced_at=now) == 10` 改成
  `assert (await apply_kindergartens(db_session, rows, synced_at=now, school_year=115)).active == 10`；
  結尾那段
  ```python
      await replace_kindergartens(db_session, rows[:2], synced_at=now)
      await db_session.commit()
      assert await db_session.scalar(select(func.count()).select_from(GeoKindergarten)) == 2
  ```
  改成
  ```python
      await apply_kindergartens(db_session, rows[:2], synced_at=now, school_year=115)
      await db_session.commit()
      # 不在名單裡的標成停辦、列留著；附近查詢與計數只看營業中的。
      assert await db_session.scalar(select(func.count()).select_from(GeoKindergarten)) == 10
      active = select(func.count()).select_from(GeoKindergarten).where(GeoKindergarten.is_active.is_(True))
      assert await db_session.scalar(active) == 2
      assert len(await nearby(db_session, *YIHUA_POINT, 3000)) == 2
  ```
- `test_version_label_is_the_taipei_date`：`await replace_kindergartens(db_session, rows, synced_at=synced_at)` 改成 `await apply_kindergartens(db_session, rows, synced_at=synced_at, school_year=115)`。
- `test_a_row_that_would_not_fit_never_reaches_the_database`：
  `assert await replace_kindergartens(db_session, rows, synced_at=datetime.now(timezone.utc)) == 1` 改成
  `assert (await apply_kindergartens(db_session, rows, synced_at=datetime.now(timezone.utc), school_year=115)).active == 1`。

- [ ] **Step 3: 跑測試確認失敗**

Run：`PY pytest -q -p no:cacheprovider tests/test_geo_providers.py -x`
Expected：收集階段 FAIL，`ModuleNotFoundError: No module named 'app.admissions.geo.providers'`。

- [ ] **Step 4: 實作 `providers.py`**

建立 `backend/app/admissions/geo/providers.py`：

```python
"""幼兒園與托嬰的名單比對與異動紀錄（2026-10-14 規格 §3、§4、§5）。

同步下載到的名單不再「刪光重寫」，而是依 source_id 和資料表比對：
- 這次名單沒有、上次營業中的 → 標成停辦（is_active 假，列留著）並寫 closed 事件；
- 這次有、上次是停辦的 → 重新營業；但 30 天內才寫了 closed 事件的，視為來源漏收，撤掉那筆事件、
  不寫 opened（P6）；
- 托嬰名單裡新出現的（資料表原本有列）→ opened 事件；幼兒園的新設看設立日（registered_on，讀的時候算），
  不靠事件——來源晚收錄的老園所不是新園（P3）；
- 幼兒園類型變了 → kind_changed 事件。舊的類型用這次同步當下的學年重算（P7）：準公共期間是學年區間，
  學年更替時沒改過資料的園所類型會自己變，直接比會冒出一批假異動。
資料表原本是空的（托嬰第一次）只建立基準，不寫任何事件（P8）。新名單營業中的數量比上次少太多視為
殘缺檔，不換版（P9）。事件靠唯一約束冪等；同一個交易做完，由呼叫端 commit。"""

from __future__ import annotations

import calendar
import math
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.geo.babycare import BabycareRow
from app.admissions.geo.kindergartens import KindergartenRow, kind_as_of
from app.admissions.geo.models import GeoBabycare, GeoDatasetStatus, GeoKindergarten, GeoProviderEvent
from app.admissions.geo.projection import haversine_m
from app.common.timezones import today_local

# 幼兒園、托嬰每 7 天看一次來源（P10）；門牌、人口維持 sync.REFRESH_AFTER 的 30 天。
PROVIDER_REFRESH_AFTER = timedelta(days=7)
CHANGE_WINDOW_MONTHS = 12  # 畫面與 API 看近 12 個月（P11）
EVENT_RETENTION_MONTHS = 24  # 事件保留 24 個月
REOPEN_CANCELS_CLOSURE = timedelta(days=30)  # P6
TRUNCATION_RATIO = 0.8  # P9
TRUNCATION_MIN_PREVIOUS = 20
SHRUNK_MESSAGE = "名單營業中的數量比上次少了兩成以上，疑似殘缺，未更新"
_METERS_PER_DEGREE = 111_320.0


class ProviderShrunk(RuntimeError):
    """新名單營業中的數量比上次少太多（P9）；訊息會原樣寫進 geo_dataset_status.last_error。"""


@dataclass(frozen=True)
class ChangeReport:
    active: int  # 這次名單裡營業中的數量
    opened: int = 0
    closed: int = 0
    kind_changed: int = 0
    cancelled_closures: int = 0  # 30 天內回來而撤掉的停辦事件


@dataclass(frozen=True)
class ProviderChange:
    """附近園所的一筆變化（API 的 items 就是這個）。date_basis：registered＝設立日、observed＝我們同步到的日期。"""

    provider: str
    source_id: str
    name: str
    kind: str
    change: str
    date: date
    date_basis: str
    distance_m: int
    old_kind: str | None
    new_kind: str | None


@dataclass(frozen=True)
class _Spec:
    provider: str  # geo_provider_events.provider
    model: type
    dataset: str  # geo_dataset_status.dataset
    new_row_is_event: bool  # 資料表已有列時，新出現的算 opened（托嬰）；幼兒園看設立日，不靠事件


_KINDERGARTEN = _Spec("kindergarten", GeoKindergarten, "kindergartens", False)
_BABYCARE = _Spec("babycare", GeoBabycare, "babycare", True)


def months_ago(day: date, months: int) -> date:
    """往前推 months 個月、同日；那個月沒有這一天（2/29、月底）取該月最後一天。"""
    index = day.year * 12 + (day.month - 1) - months
    year, month = divmod(index, 12)
    month += 1
    return date(year, month, min(day.day, calendar.monthrange(year, month)[1]))


async def _cancel_recent_closure(db: AsyncSession, provider: str, source_id: str, today: date) -> bool:
    """30 天內（含第 30 天）寫過的 closed 事件刪掉，回傳有沒有刪到東西（P6）。"""
    result = await db.execute(
        delete(GeoProviderEvent)
        .where(
            GeoProviderEvent.provider == provider,
            GeoProviderEvent.source_id == source_id,
            GeoProviderEvent.change == "closed",
            GeoProviderEvent.occurred_on >= today - REOPEN_CANCELS_CLOSURE,
        )
        .returning(GeoProviderEvent.id)
    )
    return result.first() is not None


async def _insert_events(db: AsyncSession, pending: list[dict]) -> dict[str, int]:
    """寫事件；同一天、同一所、同一種已經有就略過。回傳實際寫入的各種數量。"""
    if not pending:
        return {}
    result = await db.execute(
        pg_insert(GeoProviderEvent)
        .values(pending)
        .on_conflict_do_nothing(constraint="uq_geo_provider_events_once")
        .returning(GeoProviderEvent.change)
    )
    counts: dict[str, int] = {}
    for (change,) in result.all():
        counts[change] = counts.get(change, 0) + 1
    return counts


async def _apply(
    db: AsyncSession,
    spec: _Spec,
    incoming: dict[str, dict[str, Any]],
    *,
    synced_at: datetime,
    force: bool,
    kind_change: Callable[[Any, dict[str, Any]], tuple[str, str] | None] | None = None,
) -> ChangeReport:
    today = today_local(synced_at)
    existing = {row.source_id: row for row in (await db.execute(select(spec.model))).scalars()}
    previous_active = sum(1 for row in existing.values() if row.is_active)
    if not force and previous_active >= TRUNCATION_MIN_PREVIOUS and len(incoming) < previous_active * TRUNCATION_RATIO:
        raise ProviderShrunk(SHRUNK_MESSAGE)
    had_rows = bool(existing)
    pending: list[dict] = []
    cancelled = 0

    def add_event(source_id: str, change: str, old: str | None = None, new: str | None = None) -> None:
        pending.append(
            {
                "provider": spec.provider, "source_id": source_id, "change": change,
                "occurred_on": today, "old_value": old, "new_value": new,
            }
        )

    for source_id, values in incoming.items():
        row = existing.get(source_id)
        if row is None:
            db.add(spec.model(**values, is_active=True, synced_at=synced_at))
            if had_rows and spec.new_row_is_event:
                add_event(source_id, "opened")
            continue
        # 類型要在覆寫欄位之前比（要用舊列的準公共期間重算）。
        changed_kind = kind_change(row, values) if kind_change is not None and row.is_active else None
        reopened = not row.is_active
        for column, value in values.items():
            setattr(row, column, value)
        row.is_active = True
        row.synced_at = synced_at
        if reopened:
            if await _cancel_recent_closure(db, spec.provider, source_id, today):
                cancelled += 1
            else:
                add_event(source_id, "opened")
        elif changed_kind is not None:
            add_event(source_id, "kind_changed", *changed_kind)
    for source_id, row in existing.items():
        if row.is_active and source_id not in incoming:
            row.is_active = False
            add_event(source_id, "closed")
    await db.flush()
    counts = await _insert_events(db, pending)
    await db.execute(
        delete(GeoProviderEvent).where(
            GeoProviderEvent.provider == spec.provider,
            GeoProviderEvent.occurred_on < months_ago(today, EVENT_RETENTION_MONTHS),
        )
    )
    status = await db.get(GeoDatasetStatus, spec.dataset, with_for_update=True)
    if status is None:
        status = GeoDatasetStatus(dataset=spec.dataset)
        db.add(status)
    # 版本日期照園方所在時區（台北）：UTC 日期在台北 00–08 點還是前一天。
    day = today.isoformat()
    status.active_version = day
    status.label = day
    status.synced_at = synced_at
    status.checked_at = synced_at
    status.last_error = None
    if status.baseline_on is None:
        status.baseline_on = today
    return ChangeReport(
        active=len(incoming),
        opened=counts.get("opened", 0),
        closed=counts.get("closed", 0),
        kind_changed=counts.get("kind_changed", 0),
        cancelled_closures=cancelled,
    )


async def apply_kindergartens(
    db: AsyncSession, rows: list[KindergartenRow], *, synced_at: datetime, school_year: int, force: bool = False
) -> ChangeReport:
    """幼兒園名單換新並記錄異動（不 commit）。school_year：這一輪解析名單用的學年，舊列的類型用它重算（P7）。"""

    def kind_change(old: GeoKindergarten, values: dict[str, Any]) -> tuple[str, str] | None:
        before = kind_as_of(old.kind, old.pre_public_period, school_year)
        return (before, values["kind"]) if before != values["kind"] else None

    return await _apply(
        db, _KINDERGARTEN, {row.source_id: asdict(row) for row in rows},
        synced_at=synced_at, force=force, kind_change=kind_change,
    )


async def apply_babycare(
    db: AsyncSession, rows: list[BabycareRow], *, synced_at: datetime, force: bool = False
) -> ChangeReport:
    """托嬰名單換新並記錄異動（不 commit）。"""
    return await _apply(db, _BABYCARE, {row.source_id: asdict(row) for row in rows}, synced_at=synced_at, force=force)
```

`nearby_changes` 這個函式在 Task 5 才加進同一個檔案（上面已先 import 好 `math`、`haversine_m`、`ProviderChange` 給它用；Task 3 結束時 ruff 會抱怨這幾個未使用，Task 5 補上後就用到了）。

- [ ] **Step 5: 移除 `replace_kindergartens`，接上新函式**

(a) `backend/app/admissions/geo/kindergartens.py`：刪掉整個 `async def replace_kindergartens(...)`；import 區改成

```python
import math
import re
from dataclasses import dataclass
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.geo.kaohsiung import in_kaohsiung
from app.admissions.geo.models import GeoKindergarten
from app.admissions.geo.projection import haversine_m
```
（`datetime` 還要留給型別；若 ruff 說沒用到就拿掉。`asdict`、`delete`、`insert`、`GeoDatasetStatus`、`today_local` 都不再用，拿掉。）模組 docstring 的第一段結尾補一句：「名單換新與異動紀錄見 providers.py（2026-10-14）。」

(b) `backend/app/admissions/geo/sync.py`：
- import 區：`from app.admissions.geo.kindergartens import KindergartenFormatError, ParseReport, parse_preschools, replace_kindergartens` 改成
  ```python
  from app.admissions.geo import providers
  from app.admissions.geo.kindergartens import KindergartenFormatError, ParseReport, parse_preschools
  ```
- `_error_text` 的 `own` 元組加一行 `providers.ProviderShrunk,`。
- `sync_kindergartens` 內：
  ```python
          async with session_factory() as db:
              await replace_kindergartens(db, rows, synced_at=now)
              await db.commit()
          logger.info("幼兒園資料已更新：%s 所，略過 %s 筆", len(rows), report.skipped)
  ```
  改成
  ```python
          async with session_factory() as db:
              changes = await providers.apply_kindergartens(db, rows, synced_at=now, school_year=school_year, force=force)
              await db.commit()
          logger.info(
              "幼兒園資料已更新：%s 所，略過 %s 筆；停辦 %s、重新營業 %s、類型變動 %s",
              changes.active, report.skipped, changes.closed, changes.opened, changes.kind_changed,
          )
  ```

- [ ] **Step 6: 跑測試**

```bash
PY pytest -q -p no:cacheprovider tests/test_geo_providers.py tests/test_geo_kindergartens.py tests/test_geo_babycare.py
PY pytest -q -p no:cacheprovider tests/test_geo_sync.py tests/test_geo_limits.py tests/test_geo_loop.py tests/test_geo_population.py tests/test_admissions_area.py tests/test_admissions_visit_geo.py
```
Expected：全部 PASS。若 `test_geo_sync.py` 有斷言在新語意下不成立（例如以為重匯會清掉不在名單的列），先確認是不是「刪光重寫」假設，按新語意（列留著、`is_active` 假）改測試，不要改程式去遷就。

- [ ] **Step 7: Commit**

```bash
cd ~/Repositories/ivy-website-wt/provider-changes-20261014
git add backend/app/admissions/geo/providers.py backend/app/admissions/geo/kindergartens.py backend/app/admissions/geo/sync.py backend/tests/geo_helpers.py backend/tests/test_geo_providers.py backend/tests/test_geo_kindergartens.py
git commit -m "feat(geo): 名單改依 source_id 比對並記錄新設、停辦、類型變動（取代刪光重寫）

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 托嬰同步、7 天頻率、CLI 與背景迴圈

**Files:**
- Modify: `backend/app/admissions/geo/sync.py`
- Modify: `backend/app/cli.py`（`geo_sync_options`、`geo_sync_command`、`main` 的 usage）
- Modify: `backend/app/workers/geo_loop.py`
- Modify: `backend/tests/test_geo_sync.py`（`_site` 加托嬰網址）、`backend/tests/test_geo_loop.py`（兩處精確比對的選項字典）
- Create: `backend/tests/test_geo_babycare_sync.py`

**Interfaces:**
- Consumes：Task 2 的 `parse_babycare`、`BabycareFormatError`、`Settings.geo_babycare_url`；Task 3 的 `providers.apply_babycare`、`PROVIDER_REFRESH_AFTER`。
- Produces：
  - `sync.BABYCARE_MAX_BYTES = 8 * 1024 * 1024`、`sync.BABYCARE_TIME_BUDGET = timedelta(minutes=5)`
  - `async sync.sync_babycare(session_factory, settings, client, *, now, force, file) -> tuple[str, int]`
  - `sync._provider_due(status, now) -> bool`
  - `run_geo_sync(..., babycare_file: Path | None = None)`；`GeoSyncResult.babycare: str = "skipped"`、`GeoSyncResult.babycare_rows_skipped: int = 0`
  - CLI：`geo-sync --babycare-file <JSON>`；`geo_sync_options(...)["babycare_file"]`
  - 測試共用：`tests/test_geo_sync.BABYCARE_URL`、`_site(babycare=...)`

- [ ] **Step 1: 更新既有測試的假網站與精確比對**

(a) `backend/tests/test_geo_sync.py`：
- 常數區 `KIANG_URL = ...` 下一行加 `BABYCARE_URL = "https://kiang.github.io/ncwisweb.sfaa.gov.tw/babycare.json"`。
- `_site(...)` 簽名在 `kiang: bytes | None = None,` 後面加 `babycare: bytes | None = None,`；docstring 的「假的高雄市資料平台＋kiang＋內政部」補上「＋托嬰名單」；在 `if url == KIANG_URL:` 區塊之後加：
  ```python
          if url == BABYCARE_URL:
              body = babycare if babycare is not None else (FIXTURES / "babycare-sample.json").read_bytes()
              return httpx.Response(200, content=body, headers={"content-type": "application/json"})
  ```

(b) `backend/tests/test_geo_loop.py`：兩處精確比對的選項字典各加一個鍵——
- `test_cli_options_with_files` 的預期字典加 `"babycare_file": None,`（放在 `"population_files": None,` 前一行）。
- 檔尾附近 `received == [{ "force": True, ... "kindergartens_file": None, "population_files": None, }]` 同樣加 `"babycare_file": None,`。

- [ ] **Step 2: 寫會失敗的測試**

建立 `backend/tests/test_geo_babycare_sync.py`：

```python
"""托嬰名單的同步（2026-10-14 規格 §4）：基準、7 天頻率、各自成敗、檔案匯入、大小與時間上限、CLI。
HTTP 一律用 MockTransport，不連外。"""

from __future__ import annotations

import asyncio
import codecs
import logging
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import func, select, update

from app import cli
from app.admissions.geo import sync
from app.admissions.geo.models import GeoBabycare, GeoDatasetStatus, GeoProviderEvent
from app.admissions.geo.sync import GeoSyncResult, run_geo_sync
from app.cli import geo_sync_command, geo_sync_options
from app.common.timezones import today_local
from app.workers import geo_loop
from app.workers.geo_loop import GeoSyncLoop
from tests.geo_helpers import FIXTURES
from tests.test_geo_limits import _wrap
from tests.test_geo_sync import BABYCARE_URL, KIANG_URL, _site, _status, _sync, small_minimum  # noqa: F401

BABYCARE_SAMPLE = FIXTURES / "babycare-sample.json"


async def _count(app, model=GeoBabycare) -> int:
    async with app.state.session_factory() as db:
        return await db.scalar(select(func.count()).select_from(model))


async def _age(app, days: int) -> None:
    """把幼兒園與托嬰的「上次確認」往前推 days 天。"""
    old = datetime.now(timezone.utc) - timedelta(days=days)
    async with app.state.session_factory() as db:
        await db.execute(
            update(GeoDatasetStatus)
            .where(GeoDatasetStatus.dataset.in_(["kindergartens", "babycare"]))
            .values(checked_at=old, synced_at=old)
        )
        await db.commit()


async def test_first_sync_imports_the_babycare_list_and_sets_the_baseline(app, small_minimum):
    transport, _ = _site()
    result = await _sync(app, transport)
    assert (result.babycare, result.babycare_rows_skipped) == ("updated", 0)
    assert await _count(app) == 6  # 兩筆停業、一筆新北市不收
    status = await _status(app, "babycare")
    assert status.baseline_on == today_local(status.synced_at) and status.last_error is None
    assert await _count(app, GeoProviderEvent) == 0  # 第一次只建立基準


async def test_a_second_sync_within_seven_days_does_not_download_again(app, small_minimum):
    transport, seen = _site()
    await _sync(app, transport)
    seen.clear()
    again = await _sync(app, transport)
    assert (again.kindergartens, again.babycare) == ("skipped", "skipped")
    assert BABYCARE_URL not in seen and KIANG_URL not in seen


@pytest.mark.parametrize(("age_days", "downloads"), [(6, False), (8, True)])
async def test_kindergartens_and_babycare_are_due_after_seven_days_not_thirty(app, small_minimum, age_days, downloads):
    transport, seen = _site()
    await _sync(app, transport)
    await _age(app, age_days)
    seen.clear()
    result = await _sync(app, transport)
    assert (BABYCARE_URL in seen, KIANG_URL in seen) == (downloads, downloads)
    assert (result.babycare, result.kindergartens) == (("updated",) * 2 if downloads else ("skipped",) * 2)


async def test_a_missing_baseline_makes_the_lists_due_at_once(app, small_minimum):
    """既有幼兒園資料沒有基準日與設立日（舊程式寫的）：上線後第一輪就補上，不必等 7 天。"""
    transport, seen = _site()
    await _sync(app, transport)
    async with app.state.session_factory() as db:
        await db.execute(update(GeoDatasetStatus).where(GeoDatasetStatus.dataset == "kindergartens").values(baseline_on=None))
        await db.commit()
    seen.clear()
    result = await _sync(app, transport)
    assert result.kindergartens == "updated" and KIANG_URL in seen
    assert (await _status(app, "kindergartens")).baseline_on is not None
    assert result.babycare == "skipped" and BABYCARE_URL not in seen


async def test_a_broken_babycare_feed_does_not_block_the_others(app, small_minimum):
    transport, _ = _site(babycare=b'{"type": "FeatureCollection", "features": []}')
    result = await _sync(app, transport)
    assert (result.doorplates, result.kindergartens, result.babycare) == ("updated", "updated", "failed")
    assert (await _status(app, "babycare")).last_error == "托嬰名單裡沒有高雄市營業中的機構"


async def test_a_failed_download_keeps_the_previous_list(app, small_minimum):
    good, _ = _site()
    await _sync(app, good)
    await _age(app, 8)
    bad, _ = _site(babycare=b"not json at all")
    result = await _sync(app, bad)
    assert result.babycare == "failed"
    assert await _count(app) == 6
    assert "JSONDecodeError" in (await _status(app, "babycare")).last_error


async def test_a_babycare_file_never_touches_the_network(app):
    def refuse(request):
        raise AssertionError(f"不該連外：{request.url}")

    async with httpx.AsyncClient(transport=httpx.MockTransport(refuse)) as client:
        result = await run_geo_sync(app.state.session_factory, app.state.settings, client=client, babycare_file=BABYCARE_SAMPLE)
    assert (result.doorplates, result.kindergartens, result.population, result.babycare) == (
        "skipped", "skipped", "skipped", "updated",
    )
    assert await _count(app) == 6


async def test_a_babycare_file_with_a_bom_is_read(app, tmp_path):
    path = tmp_path / "babycare.json"
    path.write_bytes(codecs.BOM_UTF8 + BABYCARE_SAMPLE.read_bytes())
    result = await run_geo_sync(app.state.session_factory, app.state.settings, babycare_file=path)
    assert result.babycare == "updated" and await _count(app) == 6


async def test_the_list_that_is_closed_in_a_later_sync_becomes_a_closed_event(app, small_minimum):
    good, _ = _site()
    await _sync(app, good)
    async with app.state.session_factory() as db:  # 模擬先前的名單多一所：之後的同步看到它不在了
        db.add(
            GeoBabycare(
                source_id="gone", name="已不在名單", kind="center", address="高雄市三民區某路1號", lat=22.64, lng=120.34,
                is_active=True, synced_at=datetime.now(timezone.utc),
            )
        )
        await db.commit()
    await _age(app, 8)
    await _sync(app, good)
    async with app.state.session_factory() as db:
        events = (await db.execute(select(GeoProviderEvent))).scalars().all()
    assert [(e.provider, e.source_id, e.change) for e in events] == [("babycare", "gone", "closed")]


# ---- 大小與時間上限（沿用 2026-10-13 深度掃描的做法）----


async def test_an_oversized_babycare_list_is_refused(app, small_minimum, monkeypatch):
    monkeypatch.setattr(sync, "BABYCARE_MAX_BYTES", 100)
    good, _ = _site()
    result = await _sync(app, good, force=True)
    assert result.babycare == "failed"
    assert "超過大小上限" in ((await _status(app, "babycare")).last_error or "")
    assert await _count(app) == 0
    assert result.kindergartens == "updated", "一種資料失敗不擋其他"


async def test_a_stalled_babycare_source_is_cancelled_by_the_time_budget(app, small_minimum, monkeypatch):
    monkeypatch.setattr(sync, "BABYCARE_TIME_BUDGET", timedelta(seconds=0.3))
    good, _ = _site()

    async def stalled():
        yield b"["
        await asyncio.sleep(30)
        yield b"]"

    def replace(url):
        if url == BABYCARE_URL:
            return httpx.Response(200, content=stalled(), headers={"content-type": "application/json"})

    result = await asyncio.wait_for(_sync(app, _wrap(good, replace), force=True), 20)
    assert result.babycare == "failed"
    assert "同步超過" in ((await _status(app, "babycare")).last_error or "")
    assert result.doorplates == "updated", "一種資料逾時不擋其他"


# ---- CLI 與背景迴圈 ----


def test_cli_collects_the_babycare_file():
    options = geo_sync_options(["--babycare-file", str(BABYCARE_SAMPLE)])
    assert options["babycare_file"] == BABYCARE_SAMPLE
    assert options["kindergartens_file"] is None and options["doorplates_file"] is None


@pytest.mark.parametrize("args", [["--babycare-file"], ["--babycare-file", "/no/such/babycare.json"]])
def test_cli_rejects_bad_babycare_arguments(args):
    with pytest.raises(SystemExit):
        geo_sync_options(args)


async def test_cli_geo_sync_with_a_babycare_file(app, monkeypatch, capsys):
    async def session_factory():
        return app.state.session_factory

    monkeypatch.setattr(cli, "_session_factory", session_factory)
    monkeypatch.setattr(cli, "get_settings", lambda: app.state.settings)
    await geo_sync_command(**geo_sync_options(["--babycare-file", str(BABYCARE_SAMPLE)]))
    output = capsys.readouterr().out
    assert "托嬰：updated" in output
    assert "門牌：skipped" in output and "幼兒園：skipped" in output


async def test_cli_exits_1_and_prints_the_reason_when_the_babycare_list_is_refused(app, monkeypatch, capsys, tmp_path):
    async def session_factory():
        return app.state.session_factory

    monkeypatch.setattr(cli, "_session_factory", session_factory)
    monkeypatch.setattr(cli, "get_settings", lambda: app.state.settings)
    bad = tmp_path / "empty.json"
    bad.write_text('{"type": "FeatureCollection", "features": []}', encoding="utf-8")
    with pytest.raises(SystemExit) as caught:
        await geo_sync_command(**geo_sync_options(["--babycare-file", str(bad)]))
    assert caught.value.code == 1
    assert "托嬰同步失敗：托嬰名單裡沒有高雄市營業中的機構" in capsys.readouterr().err


async def test_the_loop_summarises_a_round_when_only_babycare_was_updated(app, monkeypatch, caplog):
    ran = asyncio.Event()

    async def fake_sync(session_factory, settings, **kwargs):
        ran.set()
        return GeoSyncResult("skipped", "skipped", None, 0, babycare="updated")

    monkeypatch.setattr(geo_loop, "run_geo_sync", fake_sync)
    loop = GeoSyncLoop(app.state.session_factory, app.state.settings, check_seconds=3600, first_delay_seconds=0)
    with caplog.at_level(logging.INFO, logger="app.admissions.geo.loop"):
        loop.start()
        await asyncio.wait_for(ran.wait(), 10)
        await loop.stop()
    assert any("babycare='updated'" in record.getMessage() for record in caplog.records)
```

- [ ] **Step 3: 跑測試確認失敗**

Run：`PY pytest -q -p no:cacheprovider tests/test_geo_babycare_sync.py -x`
Expected：FAIL（`AttributeError`／`TypeError`：`babycare_file` 不存在、`sync.BABYCARE_MAX_BYTES` 不存在）。

- [ ] **Step 4: 實作 `sync.py` 的托嬰同步**

(a) import 區：加 `from app.admissions.geo.babycare import BabycareFormatError, parse_babycare`。

(b) 模組 docstring 四處換字（逐字，現行原文都在檔案前 12 行）：
- 第 2 行 `幼兒園、各里人口（2026-10-13 招生機會規格 §4）；門牌換版或校址變更後重算訪視。` → `幼兒園、各里人口（2026-10-13 招生機會規格 §4）、托嬰名單（2026-10-14 規格 §4）；門牌換版或校址變更後重算訪視。`
- 第 4 行 `三種資料各自成敗` → `四種資料各自成敗`
- 第 8 行 `各自超過 30 天沒確認過才去看來源；門牌` → `門牌、各里人口超過 30 天沒確認過，幼兒園與托嬰超過 7 天（providers.PROVIDER_REFRESH_AFTER）才去看來源；門牌`
- 第 11 行 `--kindergartens-file／--population-file` → `--kindergartens-file／--babycare-file／--population-file`

(c) 常數：在 `KINDERGARTENS_MAX_BYTES = ...` 那行後加
```python
BABYCARE_MAX_BYTES = 8 * 1024 * 1024  # 托嬰名單（正常約 1.4 MB）
```
在 `KINDERGARTENS_TIME_BUDGET = ...` 那行後加
```python
BABYCARE_TIME_BUDGET = timedelta(minutes=5)
```

(d) `GeoSyncResult` 結尾加兩個欄位（維持預設值，既有測試用位置參數建立的不受影響）：
```python
    # 托嬰名單（2026-10-14）：結果、解析時略過的筆數。
    babycare: str = "skipped"
    babycare_rows_skipped: int = 0
```

(e) `_error_text` 的 `own` 元組加 `BabycareFormatError,`。

(f) 在 `_due` 之後新增：
```python
def _provider_due(status: GeoDatasetStatus | None, now: datetime) -> bool:
    """幼兒園、托嬰（規格 P10）：每 7 天看一次來源；基準日還是空的（還沒用異動比對的程式同步過，
    例如既有的幼兒園資料）立刻到期，上線後第一輪就補上設立日與基準。"""
    return _due(status, now, providers.PROVIDER_REFRESH_AFTER) or status.baseline_on is None
```
並把 `_due` 改成帶間隔參數：
```python
def _due(status: GeoDatasetStatus | None, now: datetime, interval: timedelta = REFRESH_AFTER) -> bool:
    if status is None or status.active_version is None:
        return True
    last = status.checked_at or status.synced_at
    return last is None or now - last >= interval
```
（`_provider_due` 裡 `status` 為 None 時 `_due` 已回 True，`or` 的右邊不會被求值。）

(g) `sync_kindergartens` 開頭的到期判斷
`if file is None and (client is None or (not force and not _due(status, now))):`
改成
`if file is None and (client is None or (not force and not _provider_due(status, now))):`

(h) 在 `sync_kindergartens` 之後新增：
```python
async def sync_babycare(
    session_factory: async_sessionmaker[AsyncSession],
    settings: Settings,
    client: httpx.AsyncClient | None,
    *,
    now: datetime,
    force: bool,
    file: Path | None,
) -> tuple[str, int]:
    """托嬰名單（2026-10-14 規格 §4）。回傳 (結果, 略過的筆數)。"""
    status = await _status(session_factory, "babycare")
    if file is None and (client is None or (not force and not _provider_due(status, now))):
        return "skipped", 0
    try:
        if file is not None:
            data = json.loads(file.read_text(encoding="utf-8-sig"))
        else:
            assert client is not None
            body, _ = await _fetch_capped(client, settings.geo_babycare_url, max_bytes=BABYCARE_MAX_BYTES)
            data = await asyncio.to_thread(json.loads, body)
        report = ParseReport()
        rows = await asyncio.to_thread(parse_babycare, data, report=report)
        async with session_factory() as db:
            changes = await providers.apply_babycare(db, rows, synced_at=now, force=force)
            await db.commit()
        logger.info(
            "托嬰名單已更新：%s 所，略過 %s 筆；新增 %s、停辦 %s",
            changes.active, report.skipped, changes.opened, changes.closed,
        )
        return "updated", report.skipped
    except Exception as exc:  # noqa: BLE001
        logger.warning("托嬰名單同步失敗：%s", _error_text(exc), exc_info=True)
        await _record(session_factory, "babycare", now=now, error=_error_text(exc))
        return "failed", 0
```

(i) `run_geo_sync`：簽名加 `babycare_file: Path | None = None,`（放在 `kindergartens_file` 之後）；`file_mode` 加 `or babycare_file is not None`；在 `population, population_skipped = await _within_budget(...)` 之前加
```python
            babycare, babycare_skipped = await _within_budget(
                session_factory, "babycare", BABYCARE_TIME_BUDGET, now=now,
                work=sync_babycare(session_factory, settings, network, now=now, force=force, file=babycare_file),
            )
```
並在回傳的 `GeoSyncResult(...)` 末尾加 `babycare=babycare, babycare_rows_skipped=babycare_skipped,`。

- [ ] **Step 5: 實作 CLI 與背景迴圈**

(a) `backend/app/cli.py`：
- `geo_sync_options` 的 `usage` 改成
  ```python
      usage = (
          "用法：python -m app.cli geo-sync [--force] [--doorplates-file <CSV>] "
          "[--doorplates-version 115-10] [--kindergartens-file <JSON>] [--babycare-file <JSON>] "
          "[--population-file <JSON> ...]"
      )
  ```
- docstring 第一句補「--babycare-file」；`options` 字典加 `"babycare_file": None,`；`valued` 加 `"--babycare-file": "babycare_file"`；檢查檔案存在的元組改成 `for path in (options["doorplates_file"], options["kindergartens_file"], options["babycare_file"], *population_files):`。
- `geo_sync_command`：第一個 `print(...)` 在 `f"幼兒園：{result.kindergartens}；"` 後加 `f"托嬰：{result.babycare}；"`；略過那段：
  ```python
      if (
          result.doorplate_rows_skipped or result.kindergarten_rows_skipped or result.babycare_rows_skipped
          or result.population_rows_skipped
      ):
          print(
              f"略過：門牌 {result.doorplate_rows_skipped} 列、幼兒園 {result.kindergarten_rows_skipped} 筆、"
              f"托嬰 {result.babycare_rows_skipped} 筆、各里人口 {result.population_rows_skipped} 列"
          )
  ```
  失敗清單的元組加 `("babycare", "托嬰", result.babycare),`（放在 kindergartens 之後）。
- `main()` 的 usage 字串：`"geo-sync [--force] ... [--kindergartens-file <JSON>] "` 後接 `"[--babycare-file <JSON>] [--population-file <JSON> ...]>"`。

(b) `backend/app/workers/geo_loop.py`：
`if result is not None and {result.doorplates, result.kindergartens, result.population} != {"skipped"}:`
改成
`if result is not None and {result.doorplates, result.kindergartens, result.population, result.babycare} != {"skipped"}:`
註解「三項都是 skipped（30 天內不看來源）」改「四項都是 skipped（還沒到期，不看來源）」。

- [ ] **Step 6: 跑測試**

```bash
PY pytest -q -p no:cacheprovider tests/test_geo_babycare_sync.py tests/test_geo_sync.py tests/test_geo_limits.py tests/test_geo_loop.py tests/test_geo_population.py tests/test_geo_providers.py
```
Expected：全部 PASS。`test_geo_loop.py`／`test_geo_population.py` 若有比對整行 CLI 輸出的斷言，照新輸出（多了「托嬰：…；」）更新斷言。

- [ ] **Step 7: Commit**

```bash
cd ~/Repositories/ivy-website-wt/provider-changes-20261014
git add backend/app/admissions/geo/sync.py backend/app/cli.py backend/app/workers/geo_loop.py backend/tests/test_geo_sync.py backend/tests/test_geo_loop.py backend/tests/test_geo_population.py backend/tests/test_geo_babycare_sync.py
git commit -m "feat(geo): 托嬰名單同步、幼兒園與托嬰改每 7 天看一次、--babycare-file

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 讀取：附近園所的變化、兩支新 API、狀態列欄位

**Files:**
- Modify: `backend/app/admissions/geo/providers.py`（加 `nearby_changes`）
- Modify: `backend/app/admissions/area.py`（`query_babycare`、`query_changes`、`_data_status`）
- Modify: `backend/app/admissions/schemas.py`、`backend/app/admissions/routes.py`
- Create: `backend/tests/test_geo_changes.py`、`backend/tests/test_admissions_provider_area.py`
- Modify: `backend/tests/test_geo_schema.py`（Literal 與常數對照）
- Regenerate: `contracts/openapi.json`、`contracts/generated/website-api.d.ts`

**Interfaces:**
- Consumes：Task 2 的 `babycare.nearby`、`SOURCE_NOTE`；Task 3 的 `ProviderChange`、`months_ago`、`CHANGE_WINDOW_MONTHS`；Task 3 的 `tests/geo_helpers.load_babycare_sample`。
- Produces：
  - `async providers.nearby_changes(db, lat, lng, radius_m, *, today: date) -> list[ProviderChange]`（依日期新到舊、距離近到遠、名稱排序）
  - `async area.query_babycare(db, campus_key, *, radius_km) -> dict`、`async area.query_changes(db, campus_key, *, radius_km, today=None) -> dict`
  - `GET /api/website/v1/admin/admissions/area/babycare?campus_key=&radius_km=` → `AreaBabycareOut`
  - `GET /api/website/v1/admin/admissions/area/changes?campus_key=&radius_km=` → `AreaChangesOut`
  - `AdmissionsAreaOut.data_status.babycare_synced_at`
  - schemas：`BabycareKind`、`ProviderName`、`ProviderChangeKind`、`ChangeDateBasis`、`ChangeItemKind`、`AreaBabycareItemOut`、`AreaBabycareSummaryOut`、`AreaBabycareOut`、`AreaTrackingSinceOut`、`AreaChangeItemOut`、`AreaChangesOut`

- [ ] **Step 1: 寫 `nearby_changes` 的失敗測試**

建立 `backend/tests/test_geo_changes.py`：

```python
"""附近園所的變化（2026-10-14 規格 §5）：12 個月視窗、半徑、設立日新設、去重、排序。"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from app.admissions.geo.models import GeoBabycare, GeoKindergarten, GeoProviderEvent
from app.admissions.geo.providers import nearby_changes
from tests.geo_helpers import YIHUA_POINT

TODAY = date(2026, 10, 14)
SYNCED = datetime(2026, 10, 14, 4, 0, tzinfo=timezone.utc)


def add_kg(db, source_id, *, name=None, kind="private", dlat=0.0, active=True, registered_on=None):
    lat, lng = YIHUA_POINT
    db.add(
        GeoKindergarten(
            source_id=source_id, name=name or f"幼兒園{source_id}", kind=kind, district="三民區", address="某路1號",
            lat=lat + dlat, lng=lng, is_active=active, registered_on=registered_on, synced_at=SYNCED,
        )
    )


def add_bc(db, source_id, *, name=None, kind="center", dlat=0.0, active=True):
    lat, lng = YIHUA_POINT
    db.add(
        GeoBabycare(
            source_id=source_id, name=name or f"托嬰{source_id}", kind=kind, address="高雄市三民區某路1號",
            lat=lat + dlat, lng=lng, is_active=active, synced_at=SYNCED,
        )
    )


def add_event(db, provider, source_id, change, day, old=None, new=None):
    db.add(GeoProviderEvent(provider=provider, source_id=source_id, change=change, occurred_on=day, old_value=old, new_value=new))


async def changes(db, radius_m=3000, today=TODAY):
    return await nearby_changes(db, *YIHUA_POINT, radius_m, today=today)


async def test_the_window_includes_the_same_day_twelve_months_ago_and_excludes_the_day_before(db_session):
    add_bc(db_session, "in", active=False)
    add_bc(db_session, "out", active=False)
    add_event(db_session, "babycare", "in", "closed", date(2025, 10, 14))
    add_event(db_session, "babycare", "out", "closed", date(2025, 10, 13))
    await db_session.commit()
    assert [item.source_id for item in await changes(db_session)] == ["in"]


async def test_the_window_start_follows_the_leap_day_rule(db_session):
    """今天是 2028/2/29：12 個月前取 2027/2/28，那一天算、前一天不算。"""
    add_bc(db_session, "in", active=False)
    add_bc(db_session, "out", active=False)
    add_event(db_session, "babycare", "in", "closed", date(2027, 2, 28))
    add_event(db_session, "babycare", "out", "closed", date(2027, 2, 27))
    await db_session.commit()
    assert [item.source_id for item in await changes(db_session, today=date(2028, 2, 29))] == ["in"]


async def test_the_radius_filters_events_and_new_schools(db_session):
    add_kg(db_session, "near", dlat=0.001, active=False)  # 約 111 m
    add_kg(db_session, "far", dlat=0.05, active=False)  # 約 5.6 km
    add_kg(db_session, "far-new", dlat=0.05, registered_on=date(2026, 9, 1))
    add_event(db_session, "kindergarten", "near", "closed", date(2026, 10, 1))
    add_event(db_session, "kindergarten", "far", "closed", date(2026, 10, 1))
    await db_session.commit()
    assert [item.source_id for item in await changes(db_session, 1000)] == ["near"]
    assert {item.source_id for item in await changes(db_session, 6000)} == {"near", "far", "far-new"}


async def test_a_school_registered_within_the_window_is_new_without_any_event(db_session):
    add_kg(db_session, "new", registered_on=TODAY - timedelta(days=30))
    await db_session.commit()
    (item,) = await changes(db_session)
    assert (item.provider, item.change, item.date_basis, item.date) == ("kindergarten", "opened", "registered", TODAY - timedelta(days=30))
    assert item.kind == "private" and item.old_kind is None and item.new_kind is None


async def test_registered_dates_that_do_not_count(db_session):
    add_kg(db_session, "old", registered_on=date(2025, 10, 13))  # 視窗前一天
    add_kg(db_session, "future", registered_on=TODAY + timedelta(days=1))  # 來源打錯的未來日期
    add_kg(db_session, "unknown", registered_on=None)
    add_kg(db_session, "closed", registered_on=TODAY - timedelta(days=5), active=False)  # 停辦的不算新設
    add_kg(db_session, "edge", registered_on=date(2025, 10, 14))  # 視窗第一天
    await db_session.commit()
    assert [item.source_id for item in await changes(db_session)] == ["edge"]


async def test_the_registered_date_wins_over_a_reopen_event_for_the_same_school(db_session):
    add_kg(db_session, "k1", registered_on=TODAY - timedelta(days=20))
    add_event(db_session, "kindergarten", "k1", "opened", TODAY - timedelta(days=2))
    await db_session.commit()
    (item,) = await changes(db_session)
    assert (item.date_basis, item.date) == ("registered", TODAY - timedelta(days=20))


async def test_a_kind_change_carries_the_old_and_new_kind(db_session):
    add_kg(db_session, "k1", kind="quasi_public")
    add_event(db_session, "kindergarten", "k1", "kind_changed", TODAY - timedelta(days=3), "private", "quasi_public")
    await db_session.commit()
    (item,) = await changes(db_session)
    assert (item.change, item.kind, item.old_kind, item.new_kind, item.date_basis) == (
        "kind_changed", "quasi_public", "private", "quasi_public", "observed",
    )


async def test_closed_providers_are_listed_even_though_they_are_inactive(db_session):
    add_bc(db_session, "b1", name="托嬰已停辦", kind="home", active=False)
    add_event(db_session, "babycare", "b1", "closed", TODAY - timedelta(days=5))
    await db_session.commit()
    (item,) = await changes(db_session)
    assert (item.provider, item.name, item.kind, item.change, item.old_kind, item.new_kind) == (
        "babycare", "托嬰已停辦", "home", "closed", None, None,
    )


async def test_a_kindergarten_and_a_babycare_with_the_same_id_do_not_mix(db_session):
    add_kg(db_session, "x", name="幼兒園X", dlat=0.001, active=False)
    add_bc(db_session, "x", name="托嬰X", dlat=0.002, active=False)
    add_event(db_session, "kindergarten", "x", "closed", date(2026, 10, 1))
    add_event(db_session, "babycare", "x", "closed", date(2026, 10, 2))
    await db_session.commit()
    assert [(item.provider, item.name) for item in await changes(db_session)] == [("babycare", "托嬰X"), ("kindergarten", "幼兒園X")]


async def test_an_event_without_a_provider_row_is_ignored(db_session):
    add_event(db_session, "babycare", "orphan", "closed", TODAY - timedelta(days=1))
    await db_session.commit()
    assert await changes(db_session) == []


async def test_sorted_by_date_then_distance_then_name(db_session):
    for source_id, name, dlat in (("a", "乙托嬰", 0.002), ("b", "甲托嬰", 0.002), ("c", "丙托嬰", 0.001), ("d", "丁托嬰", 0.0005)):
        add_bc(db_session, source_id, name=name, dlat=dlat, active=False)
    add_event(db_session, "babycare", "a", "closed", date(2026, 10, 1))
    add_event(db_session, "babycare", "b", "closed", date(2026, 10, 1))
    add_event(db_session, "babycare", "c", "closed", date(2026, 10, 1))
    add_event(db_session, "babycare", "d", "closed", date(2026, 9, 1))
    await db_session.commit()
    # 同日先看距離（丙最近），距離相同看名稱（乙 U+4E59 在甲 U+7532 前面）；較早的丁最後。
    assert [item.name for item in await changes(db_session)] == ["丙托嬰", "乙托嬰", "甲托嬰", "丁托嬰"]
```

- [ ] **Step 2: 跑測試確認失敗**

Run：`PY pytest -q -p no:cacheprovider tests/test_geo_changes.py -x`
Expected：FAIL，`ImportError: cannot import name 'nearby_changes'`。

- [ ] **Step 3: 實作 `nearby_changes`**

在 `backend/app/admissions/geo/providers.py` 檔尾加（`math`、`haversine_m`、`ProviderChange`、`_METERS_PER_DEGREE` 都在 Task 3 已準備好）：

```python
def _box(lat: float, lng: float, radius_m: int) -> tuple[float, float, float, float]:
    """經緯度方框（先用索引篩，再算大圓距離）：(南, 北, 西, 東)。"""
    dlat = radius_m / _METERS_PER_DEGREE
    dlng = radius_m / (_METERS_PER_DEGREE * math.cos(math.radians(lat)))
    return lat - dlat, lat + dlat, lng - dlng, lng + dlng


async def nearby_changes(
    db: AsyncSession, lat: float, lng: float, radius_m: int, *, today: date
) -> list[ProviderChange]:
    """半徑內近 12 個月的變化（規格 §5）：事件＋幼兒園的設立日新設。同一所同一種只留一筆，設立日優先；
    依日期新到舊、距離近到遠、名稱排序。停辦的園所不在 nearby 清單裡，這裡 join 對應的園所表取名稱與座標。"""
    since = months_ago(today, CHANGE_WINDOW_MONTHS)
    south, north, west, east = _box(lat, lng, radius_m)
    found: dict[tuple[str, str, str], ProviderChange] = {}
    for provider, model in (("kindergarten", GeoKindergarten), ("babycare", GeoBabycare)):
        result = await db.execute(
            select(GeoProviderEvent, model)
            .join(model, model.source_id == GeoProviderEvent.source_id)
            .where(
                GeoProviderEvent.provider == provider,
                GeoProviderEvent.occurred_on >= since,
                GeoProviderEvent.occurred_on <= today,
                model.lat.between(south, north),
                model.lng.between(west, east),
            )
            .order_by(GeoProviderEvent.occurred_on)  # 同一所同一種有好幾天時，最近的蓋掉較早的
        )
        for event, row in result.all():
            distance = haversine_m(lat, lng, row.lat, row.lng)
            if distance > radius_m:
                continue
            kind_changed = event.change == "kind_changed"
            found[(provider, row.source_id, event.change)] = ProviderChange(
                provider=provider, source_id=row.source_id, name=row.name, kind=row.kind, change=event.change,
                date=event.occurred_on, date_basis="observed", distance_m=round(distance),
                old_kind=event.old_value if kind_changed else None,
                new_kind=event.new_value if kind_changed else None,
            )
    registered = await db.execute(
        select(GeoKindergarten).where(
            GeoKindergarten.is_active.is_(True),
            GeoKindergarten.registered_on >= since,
            GeoKindergarten.registered_on <= today,  # 來源把設立日打成未來不算新設
            GeoKindergarten.lat.between(south, north),
            GeoKindergarten.lng.between(west, east),
        )
    )
    for row in registered.scalars():
        distance = haversine_m(lat, lng, row.lat, row.lng)
        if distance > radius_m:
            continue
        found[("kindergarten", row.source_id, "opened")] = ProviderChange(
            provider="kindergarten", source_id=row.source_id, name=row.name, kind=row.kind, change="opened",
            date=row.registered_on, date_basis="registered", distance_m=round(distance), old_kind=None, new_kind=None,
        )
    return sorted(found.values(), key=lambda item: (-item.date.toordinal(), item.distance_m, item.name))
```

- [ ] **Step 4: 跑測試**

Run：`PY pytest -q -p no:cacheprovider tests/test_geo_changes.py tests/test_geo_providers.py`
Expected：PASS。

- [ ] **Step 5: 寫 API 的失敗測試**

(a) 建立 `backend/tests/test_admissions_provider_area.py`：

```python
"""附近托嬰與園所變化 API（2026-10-14 規格 §6）：半徑與總結、空值、尚未匯入、本校沒座標、權限、開關、視窗與去重。"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from sqlalchemy import update

from app.admissions import area
from app.admissions.geo import babycare as geo_babycare
from app.admissions.geo import matcher
from app.admissions.geo import providers as geo_providers
from app.admissions.geo.models import GeoBabycare, GeoDatasetStatus, GeoKindergarten, GeoProviderEvent
from app.common.timezones import today_local
from app.main import create_app
from tests.admissions_area_helpers import AREA
from tests.admissions_helpers import readonly_yihua_client, reception_yihua_client  # noqa: F401
from tests.conftest import _logged_in_client, _test_settings
from tests.geo_helpers import load_babycare_sample, load_geo_samples, publish_campus_address

BABYCARE = f"{AREA}/babycare"
CHANGES = f"{AREA}/changes"
# tests/fixtures/geo/preschools-sample.json 的兩所：何嘉仁（距義華 300 m）、保羅（513 m）。
HOJIAREN = "e464ae13-0cbc-4a8e-9289-de0c18abc263"
PAUL = "0f26d968-d574-4e8f-bbdd-2b88a65efaf1"


@pytest.fixture
async def located(db_session):
    """義華有座標（發布校址）、幼兒園與托嬰樣本都已匯入。"""
    await load_geo_samples(db_session)
    await load_babycare_sample(db_session)
    await publish_campus_address(db_session, "yihua", "高雄市三民區義華路68號")


@pytest.fixture
def unlocated_campus(monkeypatch):
    async def unlocated(db, campus_key):
        return matcher.CampusPoint(campus_key=campus_key, lat=None, lng=None, locate_error="pending", district="三民區")

    monkeypatch.setattr(matcher, "campus_point", unlocated)


# ---- 附近托嬰 ----


async def test_babycare_lists_the_nearby_ones_by_distance_with_a_summary(admin_client, located):
    body = (await admin_client.get(f"{BABYCARE}?campus_key=yihua")).json()
    assert body["radius_km"] == 3 and body["synced_at"] is not None
    assert body["source_note"] == geo_babycare.SOURCE_NOTE
    assert [(item["source_id"], item["distance_m"]) for item in body["items"]] == [
        ("CW10203013", 165), ("CW10112502", 435), ("CW11507009", 939), ("CW10808013", 1297), ("CW10112245", 1657),
    ]
    assert body["summary"] == {"count": 5, "approved_total": 157, "enrolled_total": 107}
    home = body["items"][3]
    assert (home["kind"], home["approved_capacity"], home["enrolled"], home["phone"]) == ("home", 12, 4, "073705166")
    assert body["items"][4]["address"] == "高雄市鳥松區大埤路123之4號1樓、123之6號1-2樓"
    assert body["campus"]["key"] == "yihua" and body["campus"]["lat"] is not None


@pytest.mark.parametrize(("radius", "count", "approved", "enrolled"), [(1, 3, 120, 78), (3, 5, 157, 107), (6, 5, 157, 107)])
async def test_babycare_follows_the_radius(admin_client, located, radius, count, approved, enrolled):
    body = (await admin_client.get(f"{BABYCARE}?campus_key=yihua&radius_km={radius}")).json()
    assert body["radius_km"] == radius
    assert body["summary"] == {"count": count, "approved_total": approved, "enrolled_total": enrolled}
    assert len(body["items"]) == count  # 8.3 公里外的那一所連 6 公里都進不來


async def test_babycare_unknown_numbers_are_null_and_not_counted(admin_client, db_session, located):
    await db_session.execute(update(GeoBabycare).where(GeoBabycare.source_id == "CW10203013").values(approved_capacity=None, enrolled=None))
    await db_session.commit()
    body = (await admin_client.get(f"{BABYCARE}?campus_key=yihua")).json()
    first = body["items"][0]
    assert (first["source_id"], first["approved_capacity"], first["enrolled"]) == ("CW10203013", None, None)
    assert body["summary"] == {"count": 5, "approved_total": 105, "enrolled_total": 55}


async def test_babycare_closed_ones_are_not_listed(admin_client, db_session, located):
    await db_session.execute(update(GeoBabycare).where(GeoBabycare.source_id == "CW10112502").values(is_active=False))
    await db_session.commit()
    body = (await admin_client.get(f"{BABYCARE}?campus_key=yihua&radius_km=1")).json()
    assert [item["source_id"] for item in body["items"]] == ["CW10203013", "CW11507009"]
    assert body["summary"]["count"] == 2


async def test_babycare_not_imported_says_so_instead_of_pretending_there_is_none(admin_client, db_session):
    await load_geo_samples(db_session)
    await publish_campus_address(db_session, "yihua", "高雄市三民區義華路68號")
    body = (await admin_client.get(f"{BABYCARE}?campus_key=yihua")).json()
    assert body["synced_at"] is None and body["items"] == []
    assert body["summary"] == {"count": 0, "approved_total": 0, "enrolled_total": 0}


async def test_babycare_when_campus_not_located(admin_client, unlocated_campus, monkeypatch):
    async def must_not_query(*args, **kwargs):
        raise AssertionError("本校沒座標時不該查附近托嬰")

    monkeypatch.setattr(geo_babycare, "nearby", must_not_query)
    body = (await admin_client.get(f"{BABYCARE}?campus_key=yihua")).json()
    assert body["items"] == [] and body["campus"]["locate_error"] == "pending" and body["campus"]["lat"] is None


# ---- 附近園所的變化 ----


async def _seed_changes(db_session) -> None:
    today = today_local()
    # 何嘉仁：設立日 40 天前 → 新設（設立日）。
    await db_session.execute(update(GeoKindergarten).where(GeoKindergarten.source_id == HOJIAREN).values(registered_on=today - timedelta(days=40)))
    # 頂尖小子托嬰：5 天前停辦。
    await db_session.execute(update(GeoBabycare).where(GeoBabycare.source_id == "CW10112502").values(is_active=False))
    db_session.add_all(
        [
            GeoProviderEvent(provider="babycare", source_id="CW10112502", change="closed", occurred_on=today - timedelta(days=5)),
            # 保羅：10 天前由私立轉準公共。
            GeoProviderEvent(
                provider="kindergarten", source_id=PAUL, change="kind_changed", occurred_on=today - timedelta(days=10),
                old_value="private", new_value="quasi_public",
            ),
            # 視窗之外的事件不出現。
            GeoProviderEvent(provider="babycare", source_id="CW11507009", change="closed", occurred_on=today - timedelta(days=400)),
        ]
    )
    await db_session.commit()


async def test_changes_lists_new_closed_and_kind_changed_newest_first(admin_client, db_session, located):
    await _seed_changes(db_session)
    body = (await admin_client.get(f"{CHANGES}?campus_key=yihua")).json()
    today = today_local()
    assert (body["radius_km"], body["window_months"]) == (3, 12)
    assert [(item["provider"], item["change"], item["date_basis"]) for item in body["items"]] == [
        ("babycare", "closed", "observed"),
        ("kindergarten", "kind_changed", "observed"),
        ("kindergarten", "opened", "registered"),
    ]
    closed, kind_changed, opened = body["items"]
    assert closed["date"] == (today - timedelta(days=5)).isoformat() and closed["kind"] == "center" and closed["distance_m"] == 435
    assert (kind_changed["old_kind"], kind_changed["new_kind"], kind_changed["kind"]) == ("private", "quasi_public", "quasi_public")
    assert opened["date"] == (today - timedelta(days=40)).isoformat() and opened["distance_m"] == 300
    assert closed["old_kind"] is None and opened["new_kind"] is None


async def test_changes_tracking_since_is_the_baseline_of_each_list(admin_client, db_session, located):
    body = (await admin_client.get(f"{CHANGES}?campus_key=yihua")).json()
    today = today_local().isoformat()
    assert body["tracking_since"] == {"kindergarten": today, "babycare": today}
    await db_session.execute(update(GeoDatasetStatus).where(GeoDatasetStatus.dataset == "babycare").values(baseline_on=None))
    await db_session.commit()
    assert (await admin_client.get(f"{CHANGES}?campus_key=yihua")).json()["tracking_since"] == {"kindergarten": today, "babycare": None}


async def test_changes_with_nothing_recorded_yet(admin_client, db_session):
    await publish_campus_address(db_session, "yihua", "高雄市三民區義華路68號")
    body = (await admin_client.get(f"{CHANGES}?campus_key=yihua")).json()
    assert body["items"] == [] and body["tracking_since"] == {"kindergarten": None, "babycare": None}


@pytest.mark.parametrize(("radius", "expected"), [(1, ["CW10112502"]), (3, ["CW10112502", "CW10808013"]), (6, ["CW10112502", "CW10808013"])])
async def test_changes_follow_the_radius(admin_client, db_session, located, radius, expected):
    today = today_local()
    await db_session.execute(update(GeoBabycare).where(GeoBabycare.source_id.in_(["CW10112502", "CW10808013"])).values(is_active=False))
    db_session.add_all(
        [
            GeoProviderEvent(provider="babycare", source_id="CW10112502", change="closed", occurred_on=today - timedelta(days=1)),  # 435 m
            GeoProviderEvent(provider="babycare", source_id="CW10808013", change="closed", occurred_on=today - timedelta(days=2)),  # 1297 m
        ]
    )
    await db_session.commit()
    body = (await admin_client.get(f"{CHANGES}?campus_key=yihua&radius_km={radius}")).json()
    assert [item["source_id"] for item in body["items"]] == expected


async def test_changes_when_campus_not_located(admin_client, unlocated_campus, monkeypatch):
    async def must_not_query(*args, **kwargs):
        raise AssertionError("本校沒座標時不該查附近的變化")

    monkeypatch.setattr(geo_providers, "nearby_changes", must_not_query)
    body = (await admin_client.get(f"{CHANGES}?campus_key=yihua")).json()
    assert body["items"] == [] and body["campus"]["locate_error"] == "pending"


async def test_query_changes_uses_the_given_day_for_the_window(db_session, located):
    """視窗以 today 參數為準（不讀系統時間），固定日期才測得到邊界。"""
    db_session.add(GeoProviderEvent(provider="babycare", source_id="CW10112502", change="closed", occurred_on=date(2025, 10, 14)))
    await db_session.execute(update(GeoBabycare).where(GeoBabycare.source_id == "CW10112502").values(is_active=False))
    await db_session.commit()
    inside = await area.query_changes(db_session, "yihua", radius_km=3, today=date(2026, 10, 14))
    outside = await area.query_changes(db_session, "yihua", radius_km=3, today=date(2026, 10, 15))
    assert [item["source_id"] for item in inside["items"]] == ["CW10112502"]
    assert outside["items"] == []


# ---- 共通：半徑、權限、開關 ----


@pytest.mark.parametrize("path", [BABYCARE, CHANGES], ids=["babycare", "changes"])
@pytest.mark.parametrize("radius", ["2", "0", "-1", "7", "abc", "", "3.5", "1,3", "%E4%B8%89"])
async def test_reject_any_radius_but_1_3_6_with_the_same_error_code(admin_client, path, radius):
    response = await admin_client.get(f"{path}?campus_key=yihua&radius_km={radius}")
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "INVALID_RADIUS"


@pytest.mark.parametrize("path", [BABYCARE, CHANGES], ids=["babycare", "changes"])
async def test_bad_radius_does_not_skip_the_login_check(public_client, reception_yihua_client, path):
    url = f"{path}?campus_key=yihua&radius_km=abc"
    assert (await public_client.get(url)).status_code == 401
    assert (await reception_yihua_client.get(url)).status_code == 422


@pytest.mark.parametrize("path", [BABYCARE, CHANGES], ids=["babycare", "changes"])
async def test_permissions(
    reception_yihua_client, readonly_yihua_client, editor_client, minghua_client, admin_client, path
):
    url = f"{path}?campus_key="
    assert (await reception_yihua_client.get(url + "yihua")).status_code == 200
    assert (await reception_yihua_client.get(url + "minghua")).status_code == 404
    assert (await editor_client.get(url + "yihua")).status_code == 403
    assert (await readonly_yihua_client.get(url + "yihua")).status_code == 403
    assert (await minghua_client.get(url + "yihua")).status_code == 404
    assert (await admin_client.get(url + "nowhere")).status_code == 404


async def test_hidden_when_admissions_disabled(admin_client):
    disabled = create_app(_test_settings().model_copy(update={"admissions_enabled": False}))
    client = await _logged_in_client(disabled, "admin@ivy.example", "super-admin-password-123")
    try:
        for path in (f"{BABYCARE}?campus_key=yihua", f"{CHANGES}?campus_key=yihua"):
            response = await client.get(path)
            assert response.status_code == 404, (path, response.text)
    finally:
        await client.aclose()
        await disabled.state.engine.dispose()
        await disabled.state.rate_limit_engine.dispose()


async def test_area_data_status_has_the_babycare_sync_time(admin_client, db_session):
    assert (await admin_client.get(f"{AREA}?campus_key=yihua")).json()["data_status"]["babycare_synced_at"] is None
    await load_babycare_sample(db_session)
    assert (await admin_client.get(f"{AREA}?campus_key=yihua")).json()["data_status"]["babycare_synced_at"] is not None
```

(b) `backend/tests/test_geo_schema.py`：
- import 區把 `BABYCARE_KINDS` 之外再加 `PROVIDER_CHANGES`、`PROVIDERS`。
- `test_api_literals_match_the_geo_constants` 內，`from app.admissions.schemas import (...)` 的名單加入 `BabycareKind`、`ProviderChangeKind`、`ProviderName`，並在 `assert get_args(KindergartenKind) == KINDERGARTEN_KINDS` 之後加：
  ```python
      assert get_args(BabycareKind) == BABYCARE_KINDS
      assert get_args(ProviderName) == PROVIDERS
      assert get_args(ProviderChangeKind) == PROVIDER_CHANGES
  ```

- [ ] **Step 6: 跑 API 測試確認失敗**

Run：`PY pytest -q -p no:cacheprovider tests/test_admissions_provider_area.py tests/test_geo_schema.py -x`
Expected：FAIL（schemas 沒有 `BabycareKind`；路由 404）。

- [ ] **Step 7: 實作 schemas**

`backend/app/admissions/schemas.py`：

(a) 檔頭常數區（`KindergartenKind = ...` 下方）加：

```python
BabycareKind = Literal["center", "home"]
ProviderName = Literal["kindergarten", "babycare"]
ProviderChangeKind = Literal["opened", "closed", "kind_changed"]
ChangeDateBasis = Literal["registered", "observed"]
# 異動列的 kind：幼兒園是四種類型，托嬰是 center／home。
ChangeItemKind = Literal["public", "nonprofit", "quasi_public", "private", "center", "home"]
# 欄位叫 date 的 model 裡，用別名當型別，避免欄位名稱遮住 datetime.date。
DateOnly = date
```

(b) `AreaDataStatusOut` 加欄位（放在 `kindergartens_synced_at` 之後），並在 docstring 補「托嬰名單更新時間（2026-10-14）」：
```python
    babycare_synced_at: datetime | None
```

(c) 在 `AreaKindergartensOut` 之後、「招生機會」區段之前加：

```python
# ---- 托嬰與園所異動（2026-10-14 規格 §6）----


class AreaBabycareItemOut(BaseModel):
    source_id: str
    name: str
    kind: BabycareKind
    address: str
    lat: float
    lng: float
    distance_m: int
    # 核定人數與實際收托（官方回報，統計時點官方沒有說明）；來源沒給是 null，畫面寫「—」。
    approved_capacity: int | None
    enrolled: int | None
    phone: str | None


class AreaBabycareSummaryOut(BaseModel):
    """營業中的所數、核定合計、實際收托合計（null 不計入）。只放數量，不算任何比例。"""

    count: int
    approved_total: int
    enrolled_total: int


class AreaBabycareOut(BaseModel):
    synced_at: datetime | None
    source_note: str
    campus: AreaCampusOut
    radius_km: int
    summary: AreaBabycareSummaryOut
    items: list[AreaBabycareItemOut]


class AreaTrackingSinceOut(BaseModel):
    """各種名單開始記錄異動的日子（基準日）；還沒記錄過是 null。"""

    kindergarten: DateOnly | None
    babycare: DateOnly | None


class AreaChangeItemOut(BaseModel):
    provider: ProviderName
    source_id: str
    name: str
    kind: ChangeItemKind
    change: ProviderChangeKind
    # registered＝設立日（幼兒園新設）、observed＝我們同步到的那天（來源沒有停辦日）。
    date: DateOnly
    date_basis: ChangeDateBasis
    distance_m: int
    # 只有 kind_changed 才有：舊的與新的幼兒園類型。
    old_kind: KindergartenKind | None
    new_kind: KindergartenKind | None


class AreaChangesOut(BaseModel):
    campus: AreaCampusOut
    radius_km: int
    window_months: int
    tracking_since: AreaTrackingSinceOut
    items: list[AreaChangeItemOut]
```

- [ ] **Step 8: 實作 `area.py`**

`backend/app/admissions/area.py`：
- import 區：`from app.admissions.geo import kindergartens as geo_kindergartens` 下方加
  ```python
  from app.admissions.geo import babycare as geo_babycare
  from app.admissions.geo import providers as geo_providers
  ```
  並加 `from app.common.timezones import today_local`。
- 常數：`KINDERGARTEN_SOURCE_NOTE = ...` 下方加 `BABYCARE_SOURCE_NOTE = geo_babycare.SOURCE_NOTE`。
- `_data_status`：`statuses` 取出之後加 `babycare = statuses.get("babycare")`，回傳字典在 `"kindergartens_synced_at"` 之後加
  `"babycare_synced_at": babycare.synced_at if babycare is not None else None,`
- 檔尾 `query_kindergartens` 之後新增：

```python
async def query_babycare(db: AsyncSession, campus_key: str, *, radius_km: int) -> dict[str, Any]:
    """本校半徑內營業中的托嬰中心與托育家園（2026-10-14 規格 §6），依距離排序。校區比對不到座標時回空清單，
    原因在 campus.locate_error；名單從未匯入時 synced_at 是 null（畫面寫尚未匯入，不寫附近沒有）。"""
    campus = await campus_out(db, campus_key)
    status = await db.get(GeoDatasetStatus, "babycare")
    result: dict[str, Any] = {
        "synced_at": status.synced_at if status is not None else None,
        "source_note": BABYCARE_SOURCE_NOTE,
        "campus": campus,
        "radius_km": radius_km,
        "summary": {"count": 0, "approved_total": 0, "enrolled_total": 0},
        "items": [],
    }
    if campus["lat"] is None or campus["lng"] is None:
        return result
    found = await geo_babycare.nearby(db, campus["lat"], campus["lng"], radius_km * 1000)
    result["items"] = [asdict(item) for item in found]
    result["summary"] = {
        "count": len(found),
        "approved_total": sum(item.approved_capacity or 0 for item in found),
        "enrolled_total": sum(item.enrolled or 0 for item in found),
    }
    return result


async def query_changes(
    db: AsyncSession, campus_key: str, *, radius_km: int, today: date | None = None
) -> dict[str, Any]:
    """本校半徑內近 12 個月的新設、停辦、類型變動（規格 §5、§6）。today 只給測試固定日期用，預設台北今天。
    tracking_since 讓畫面老實說從哪天開始記錄。"""
    campus = await campus_out(db, campus_key)
    statuses = {status.dataset: status for status in (await db.execute(select(GeoDatasetStatus))).scalars()}
    kindergartens, babycare = statuses.get("kindergartens"), statuses.get("babycare")
    result: dict[str, Any] = {
        "campus": campus,
        "radius_km": radius_km,
        "window_months": geo_providers.CHANGE_WINDOW_MONTHS,
        "tracking_since": {
            "kindergarten": kindergartens.baseline_on if kindergartens is not None else None,
            "babycare": babycare.baseline_on if babycare is not None else None,
        },
        "items": [],
    }
    if campus["lat"] is None or campus["lng"] is None:
        return result
    found = await geo_providers.nearby_changes(
        db, campus["lat"], campus["lng"], radius_km * 1000, today=today or today_local()
    )
    result["items"] = [asdict(item) for item in found]
    return result
```
並把檔頭的 `from datetime import datetime, timezone` 改成 `from datetime import date, datetime, timezone`；模組 docstring 第一行補「、/area/babycare 與 /area/changes」。

- [ ] **Step 9: 實作 routes**

`backend/app/admissions/routes.py`：
- `from app.admissions.schemas import (...)` 的名單加入 `AreaBabycareOut`、`AreaChangesOut`（維持字母順序）。
- 在 `get_admissions_area_kindergartens` 之後、`get_admissions_area_opportunity` 之前加：

```python
@router.get(
    "/admin/admissions/area/babycare",
    response_model=AreaBabycareOut,
    dependencies=[Depends(_require_integer_radius)],
)
async def get_admissions_area_babycare(
    campus_key: str,
    radius_km: int = Query(default=3, description="半徑公里：1、3 或 6"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> AreaBabycareOut:
    """本校附近的托嬰中心與公共托育家園（2026-10-14 規格 §6）：公開資料，依距離排序。只讀，不寫稽核。
    半徑規則同 /area/kindergartens。"""
    _require_campus(current_user, "admissions.read", campus_key)
    if radius_km not in area_service.RADIUS_CHOICES:
        raise _invalid_radius()
    result = await area_service.query_babycare(db, campus_key, radius_km=radius_km)
    return AreaBabycareOut.model_validate(result)


@router.get(
    "/admin/admissions/area/changes",
    response_model=AreaChangesOut,
    dependencies=[Depends(_require_integer_radius)],
)
async def get_admissions_area_changes(
    campus_key: str,
    radius_km: int = Query(default=3, description="半徑公里：1、3 或 6"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> AreaChangesOut:
    """本校附近近 12 個月的園所變化（2026-10-14 規格 §6）：新設、停辦、類型變動，幼兒園與托嬰都涵蓋。
    只讀，不寫稽核；半徑規則同 /area/kindergartens。"""
    _require_campus(current_user, "admissions.read", campus_key)
    if radius_km not in area_service.RADIUS_CHOICES:
        raise _invalid_radius()
    result = await area_service.query_changes(db, campus_key, radius_km=radius_km)
    return AreaChangesOut.model_validate(result)
```

- [ ] **Step 10: 跑後端測試**

```bash
PY pytest -q -p no:cacheprovider tests/test_admissions_provider_area.py tests/test_geo_changes.py tests/test_geo_schema.py tests/test_admissions_area.py tests/test_geo_providers.py
```
Expected：全部 PASS。（`test_admissions_area.py` 若有精確比對 `data_status` 整個字典的測試，補上 `babycare_synced_at`。）

- [ ] **Step 11: 重新產生契約並確認一致**

```bash
cd ~/Repositories/ivy-website-wt/provider-changes-20261014
source ~/.nvm/nvm.sh; nvm use 22
npm run contract:generate
npm run contract:check
git diff --stat contracts/
```
Expected：`contract:check` 顯示一致；`contracts/openapi.json` 與 `contracts/generated/website-api.d.ts` 多出上述 schema 與兩條路徑。

- [ ] **Step 12: Commit**

```bash
git add backend/app/admissions/geo/providers.py backend/app/admissions/area.py backend/app/admissions/schemas.py backend/app/admissions/routes.py backend/tests/test_geo_changes.py backend/tests/test_admissions_provider_area.py backend/tests/test_geo_schema.py contracts/openapi.json contracts/generated/website-api.d.ts
git commit -m "feat(admissions): 附近托嬰與附近園所變化的 API

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 後台資料層：型別、API 呼叫、文字函式

**Files:**
- Modify: `admin/src/api/types.ts`、`admin/src/api/admissions.ts`
- Modify: `admin/src/components/admissions/area/areaFormat.ts`
- Modify: `admin/src/__tests__/admissionsTestKit.ts`、`admin/src/__tests__/areaFormat.test.ts`、`admin/src/__tests__/admissionsApi.test.ts`

**Interfaces:**
- Consumes：Task 5 重新產生的契約型別。
- Produces（Task 7 的元件用）：
  - `types.ts`：`AreaBabycare`、`AreaBabycareItem`、`AreaBabycareSummary`、`AreaChanges`、`AreaChange`、`AreaTrackingSince`
  - `admissions.ts`：`getAreaBabycare(campusKey: string, radiusKm: 1 | 3 | 6): Promise<AreaBabycare>`、`getAreaChanges(campusKey: string, radiusKm: 1 | 3 | 6): Promise<AreaChanges>`
  - `areaFormat.ts`：`NearbyKind`、`NEARBY_KINDS`、`babycareKindLabel`、`babycareShortName(name)`、`babycareSummaryText(summary, radiusKm)`、`babycareMeta(item)`、`changeLabel(change)`、`providerLabel(provider)`、`changeDateText(item)`、`kindChangeText(item)`、`changesSubtitle(radiusKm, months)`、`changesEmptyText(radiusKm, months)`、`trackingNote(tracking, months?, now?)`、`babycareStatusText(syncedAt)`
  - 測試工具：`babycareItem(changes?)`、`areaBabycare(items?, changes?)`、`providerChange(changes?)`、`areaChanges(items?, changes?)`；`areaStats().data_status.babycare_synced_at`

- [ ] **Step 1: 型別與 API 呼叫**

(a) `admin/src/api/types.ts`：在 `export type AreaKindergarten = ...` 之後加：

```ts
export type AreaBabycare = components['schemas']['AreaBabycareOut']
export type AreaBabycareItem = components['schemas']['AreaBabycareItemOut']
export type AreaBabycareSummary = components['schemas']['AreaBabycareSummaryOut']
export type AreaChanges = components['schemas']['AreaChangesOut']
export type AreaChange = components['schemas']['AreaChangeItemOut']
export type AreaTrackingSince = components['schemas']['AreaTrackingSinceOut']
```

(b) `admin/src/api/admissions.ts`：檔頭註解提到 `getAreaKindergartens` 的那行補上「、托嬰 getAreaBabycare 與園所變化 getAreaChanges（2026-10-14）」；import 的型別名單加入 `AreaBabycare`、`AreaChanges`；在 `getAreaKindergartens` 之後加：

```ts
/** 附近托嬰中心（2026-10-14 規格 6）：半徑同 getAreaKindergartens（1、3、6 公里）。 */
export function getAreaBabycare(campusKey: string, radiusKm: 1 | 3 | 6): Promise<AreaBabycare> {
  return api.get<AreaBabycare>(`/admin/admissions/area/babycare?${toQuery({ campus_key: campusKey, radius_km: radiusKm })}`)
}

/** 附近園所近 12 個月的變化（新設、停辦、類型變動），半徑同上。 */
export function getAreaChanges(campusKey: string, radiusKm: 1 | 3 | 6): Promise<AreaChanges> {
  return api.get<AreaChanges>(`/admin/admissions/area/changes?${toQuery({ campus_key: campusKey, radius_km: radiusKm })}`)
}
```

(c) `admin/src/__tests__/admissionsApi.test.ts`：找到測 `getAreaKindergartens` 的那個 `it(...)`，照同樣寫法新增一個（import 補 `getAreaBabycare`、`getAreaChanges`）：

```ts
  it('getAreaBabycare、getAreaChanges 帶校區與半徑', async () => {
    const get = mockGet({ '/admin/admissions/area/babycare': {}, '/admin/admissions/area/changes': {} })
    await getAreaBabycare('yihua', 6)
    await getAreaChanges('yihua', 1)
    expect(get.mock.calls.map((call) => call[0])).toEqual([
      '/admin/admissions/area/babycare?campus_key=yihua&radius_km=6',
      '/admin/admissions/area/changes?campus_key=yihua&radius_km=1',
    ])
  })
```
（若該檔 mock 的寫法與上面不同，照該檔既有 `getAreaKindergartens` 測試的寫法改，斷言的網址字串不變。）

- [ ] **Step 2: 測試資料**

`admin/src/__tests__/admissionsTestKit.ts`：
- 第 10 行的型別 import 加入 `AreaBabycare, AreaBabycareItem, AreaChange, AreaChanges`。
- `buildAreaStats` 的 `data_status` 加一個鍵：`babycare_synced_at: '2026-10-13T18:30:00Z',`（台北 10/14 02:30 → 顯示「10/14」）。
- 在 `areaKindergartens` 的定義之後加：

```ts
// 托嬰（2026-10-14）：座標同樣由 distance_m 反推；核定、實際收托是官方回報的數字。
export const babycareItem = (changes: Partial<AreaBabycareItem> = {}): AreaBabycareItem => {
  const distance_m = changes.distance_m ?? 520
  return {
    source_id: 'bc-center', name: '高雄市私立小星星托嬰中心', kind: 'center', address: '高雄市三民區義華路20號',
    ...northOfCampus(distance_m), distance_m, approved_capacity: 40, enrolled: 32, phone: '07-3801000', ...changes,
  } satisfies AreaBabycareItem
}

export const areaBabycare = (items: AreaBabycareItem[] = [
  babycareItem({ source_id: 'bc-public', name: '高雄市政府社會局委託辦理高雄市三民公共托嬰中心', distance_m: 165, approved_capacity: 52, enrolled: 52 }),
  babycareItem({ source_id: 'bc-center', distance_m: 520 }),
  // 核定與實際收托未知（null）：畫面寫「—」，總結不計入。
  babycareItem({ source_id: 'bc-home', name: '高雄市鳥松社區公共托育家園', kind: 'home', distance_m: 1297, approved_capacity: null, enrolled: null, phone: null }),
], changes: Partial<AreaBabycare> = {}): AreaBabycare => ({
  synced_at: '2026-10-13T18:30:00Z',
  source_note: '資料來源：衛生福利部社會及家庭署公開資料（kiang 整理）；實際收托為官方資料',
  campus: areaStats().campus,
  radius_km: 3,
  summary: {
    count: items.length,
    approved_total: items.reduce((sum, item) => sum + (item.approved_capacity ?? 0), 0),
    enrolled_total: items.reduce((sum, item) => sum + (item.enrolled ?? 0), 0),
  },
  items,
  ...changes,
})

export const providerChange = (changes: Partial<AreaChange> = {}): AreaChange => ({
  provider: 'kindergarten', source_id: 'kg-new', name: '高雄市私立三多哈波特幼兒園', kind: 'private', change: 'opened',
  date: '2026-09-03', date_basis: 'registered', distance_m: 780, old_kind: null, new_kind: null, ...changes,
})

export const areaChanges = (items: AreaChange[] = [
  providerChange({ provider: 'babycare', source_id: 'bc-closed', name: '高雄市私立頂尖小子托嬰中心', kind: 'center', change: 'closed', date: '2026-10-09', date_basis: 'observed', distance_m: 435 }),
  providerChange({ source_id: 'kg-kind', name: '高雄市私立保羅幼兒園', kind: 'quasi_public', change: 'kind_changed', date: '2026-10-04', date_basis: 'observed', distance_m: 513, old_kind: 'private', new_kind: 'quasi_public' }),
  providerChange(),
], changes: Partial<AreaChanges> = {}): AreaChanges => ({
  campus: areaStats().campus,
  radius_km: 3,
  window_months: 12,
  tracking_since: { kindergarten: '2026-10-14', babycare: '2026-10-14' },
  items,
  ...changes,
})
```

- [ ] **Step 3: 寫會失敗的文字函式測試**

在 `admin/src/__tests__/areaFormat.test.ts` 檔尾新增（檔頭 import 補上新函式與 `areaBabycare`、`areaChanges`、`providerChange`、`babycareItem`；`describe`、`it`、`expect` 檔內已有）：

```ts
describe('托嬰與園所異動的文字（2026-10-14）', () => {
  it('名單種類切換：幼兒園在前、托嬰中心在後', () => {
    expect(NEARBY_KINDS).toEqual([
      { value: 'kindergarten', label: '幼兒園' },
      { value: 'babycare', label: '托嬰中心' },
    ])
  })

  it('托嬰類型標籤', () => {
    expect([babycareKindLabel('center'), babycareKindLabel('home'), babycareKindLabel('other')]).toEqual(['托嬰中心', '托育家園', 'other'])
  })

  it('托嬰機構短名：取「辦理」「附設」之後的機構名；取不出像樣的名稱就維持原名', () => {
    expect(babycareShortName('高雄市私立頂尖小子托嬰中心')).toBe('頂尖小子托嬰中心')
    expect(babycareShortName('高雄市政府社會局委託財團法人靖娟兒童安全文教基金會辦理高雄市三民公共托嬰中心')).toBe('三民公共托嬰中心')
    expect(babycareShortName('長庚醫療財團法人高雄長庚紀念醫院附設高雄市私立長庚托嬰中心')).toBe('長庚托嬰中心')
    expect(babycareShortName('高雄市政府社會局委託嘉藥學校辦理高雄市苓雅社區公共托育家園')).toBe('苓雅社區公共托育家園')
    // 括號收尾的「…辦理)」：尾巴沒有托嬰字樣，維持原名（只去掉「高雄市」前綴）。
    expect(babycareShortName('高雄市政府員工子女托嬰中心(委託社團法人高雄市社區教育協會辦理)')).toBe('政府員工子女托嬰中心(委託社團法人高雄市社區教育協會辦理)')
  })

  it('托嬰清單的總結：核定與實際收托合計；未知的不計入；沒有托嬰中心寫沒有', () => {
    const data = areaBabycare()
    expect(babycareSummaryText(data.summary, 3)).toBe('3 公里內托嬰中心 3 所，核定 92 位，實際收托 84 位。')
    expect(babycareSummaryText({ count: 0, approved_total: 0, enrolled_total: 0 }, 1)).toBe('1 公里內沒有托嬰中心。')
    expect(babycareSummaryText({ count: 1200, approved_total: 31000, enrolled_total: 29500 }, 6)).toBe('6 公里內托嬰中心 1,200 所，核定 31,000 位，實際收托 29,500 位。')
  })

  it('每列第二行：距離・核定・實際收托；未知寫「—」不寫 0', () => {
    expect(babycareMeta(babycareItem({ distance_m: 520 }))).toBe('520 m・核定 40 人・實際收托 32 人')
    expect(babycareMeta(babycareItem({ distance_m: 1297, approved_capacity: null, enrolled: null }))).toBe('1.3 km・核定 — 人・實際收托 — 人')
    expect(babycareMeta(babycareItem({ approved_capacity: 12, enrolled: 0 }))).toContain('實際收托 0 人') // 真的是 0 就寫 0
  })

  it('變化的種類與對象標籤', () => {
    expect([changeLabel('opened'), changeLabel('closed'), changeLabel('kind_changed')]).toEqual(['新設', '停辦', '類型變動'])
    expect([providerLabel('kindergarten'), providerLabel('babycare')]).toEqual(['幼兒園', '托嬰'])
  })

  it('日期依據：設立日、同步到的日期各寫各的', () => {
    expect(changeDateText(providerChange({ change: 'opened', date: '2026-09-03', date_basis: 'registered' }))).toBe('設立日 2026/09')
    expect(changeDateText(providerChange({ change: 'opened', date: '2026-10-21', date_basis: 'observed' }))).toBe('2026/10 起出現在名單')
    expect(changeDateText(providerChange({ change: 'closed', date: '2026-10-09', date_basis: 'observed' }))).toBe('2026/10 起不在名單')
    expect(changeDateText(providerChange({ change: 'kind_changed', date: '2026-01-05', date_basis: 'observed' }))).toBe('2026/01 起')
  })

  it('類型變動多寫「私立 → 準公共」，其他種類不寫', () => {
    expect(kindChangeText(providerChange({ change: 'kind_changed', old_kind: 'private', new_kind: 'quasi_public' }))).toBe('私立 → 準公共')
    expect(kindChangeText(providerChange({ change: 'closed' }))).toBe('')
    expect(kindChangeText(providerChange({ change: 'kind_changed', old_kind: null, new_kind: null }))).toBe('')
  })

  it('變化區塊的副標與空狀態跟著半徑與視窗走', () => {
    expect(changesSubtitle(3, 12)).toBe('近 12 個月・3 公里內')
    expect(changesEmptyText(1, 12)).toBe('近 12 個月，1 公里內沒有新設、停辦或類型變動的園所。')
  })

  describe('記錄起點的說明（trackingNote）', () => {
    const now = new Date(2026, 9, 14) // 2026/10/14
    it('兩邊都還沒開始記錄', () => {
      expect(trackingNote({ kindergarten: null, babycare: null }, 12, now)).toBe('尚未開始記錄。')
    })
    it('基準日同一天、不到 12 個月：說從哪天起記錄，新設以設立日為準', () => {
      expect(trackingNote({ kindergarten: '2026-10-14', babycare: '2026-10-14' }, 12, now)).toBe(
        '停辦與類型變動從 10 月 14 日起記錄；新設的幼兒園以設立日為準。',
      )
    })
    it('基準日不同天：分開寫', () => {
      expect(trackingNote({ kindergarten: '2026-10-14', babycare: '2026-10-20' }, 12, now)).toBe(
        '幼兒園的停辦與類型變動從 10 月 14 日起記錄；托嬰從 10 月 20 日起記錄；新設的幼兒園以設立日為準。',
      )
    })
    it('只有一邊開始記錄', () => {
      expect(trackingNote({ kindergarten: '2026-10-14', babycare: null }, 12, now)).toBe(
        '幼兒園的停辦與類型變動從 10 月 14 日起記錄；托嬰尚未開始記錄；新設的幼兒園以設立日為準。',
      )
    })
    it('基準日已滿 12 個月（剛好 12 個月前那天也算滿）：不需要說明', () => {
      expect(trackingNote({ kindergarten: '2025-10-14', babycare: '2025-09-01' }, 12, now)).toBe('')
      expect(trackingNote({ kindergarten: '2025-10-15', babycare: '2025-09-01' }, 12, now)).not.toBe('')
    })
  })

  it('頁首狀態列：托嬰名單更新日與尚未匯入', () => {
    expect(babycareStatusText('2026-10-13T18:30:00Z')).toBe('托嬰名單 10/14 更新')
    expect(babycareStatusText(null)).toBe('托嬰名單尚未匯入')
  })
})
```

- [ ] **Step 4: 跑測試確認失敗**

```bash
cd ~/Repositories/ivy-website-wt/provider-changes-20261014/admin
source ~/.nvm/nvm.sh; nvm use 22
npx vitest run src/__tests__/areaFormat.test.ts src/__tests__/admissionsApi.test.ts
```
Expected：FAIL（函式未定義）。

- [ ] **Step 5: 實作 `areaFormat.ts`**

(a) import 區把型別 import 改成（多加三個）：

```ts
import type {
  AreaBabycare, AreaBabycareItem, AreaChange, AreaOpportunity, AreaOpportunityMissing, AreaOpportunityRow, AreaTrackingSince,
  OpportunitySignal, VillageBoundaries, VisitGeo,
} from '../../../api/types'
```

(b) 檔尾新增：

```ts
// ---- 托嬰與園所異動（2026-10-14 規格 7）----

/** 「附近幼兒園」卡片的名單種類：幼兒園（預設）、托嬰中心。 */
export type NearbyKind = 'kindergarten' | 'babycare'
export const NEARBY_KINDS: readonly { value: NearbyKind; label: string }[] = [
  { value: 'kindergarten', label: '幼兒園' },
  { value: 'babycare', label: '托嬰中心' },
]

export const BABYCARE_KIND_LABELS: Record<string, string> = { center: '托嬰中心', home: '托育家園' }
export const babycareKindLabel = (kind: string): string => BABYCARE_KIND_LABELS[kind] ?? kind

/**
 * 托嬰機構的短名：政府委託辦理的名稱很長（「高雄市政府社會局委託○○基金會辦理高雄市三民公共托嬰中心」），
 * 取「辦理」「附設」之後真正的機構名；取出來的尾巴不像機構名（沒有托嬰／托育字樣，例如括號收尾的「…辦理)」）就維持原名。
 * 最後一樣去掉「高雄市私立／高雄市」前綴。
 */
export function babycareShortName(name: string): string {
  let short = name
  for (const marker of ['辦理', '附設']) {
    const tail = short.split(marker).at(-1)!.trim()
    if (/托嬰|托育/.test(tail)) short = tail
  }
  return shortName(short) || name
}

/** 托嬰清單最上面一句。只放數量，不算任何比例。 */
export function babycareSummaryText(summary: AreaBabycare['summary'], radiusKm: number): string {
  if (!summary.count) return `${radiusKm} 公里內沒有托嬰中心。`
  return (
    `${radiusKm} 公里內托嬰中心 ${formatCount(summary.count)} 所，` +
    `核定 ${formatCount(summary.approved_total)} 位，實際收托 ${formatCount(summary.enrolled_total)} 位。`
  )
}

/** 清單每列第二行：距離・核定 N 人・實際收托 M 人。來源沒給（null）寫「—」，不寫 0。 */
export function babycareMeta(item: Pick<AreaBabycareItem, 'distance_m' | 'approved_capacity' | 'enrolled'>): string {
  const count = (value: number | null): string => (value === null ? NO_VALUE : String(value))
  return `${formatDistance(item.distance_m)}・核定 ${count(item.approved_capacity)} 人・實際收托 ${count(item.enrolled)} 人`
}

const CHANGE_LABELS: Record<string, string> = { opened: '新設', closed: '停辦', kind_changed: '類型變動' }
export const changeLabel = (change: string): string => CHANGE_LABELS[change] ?? change
export const providerLabel = (provider: string): string => (provider === 'babycare' ? '托嬰' : '幼兒園')

/** 2026-10-03 → 「2026/10」。 */
const yearMonth = (isoDate: string): string => isoDate.slice(0, 7).replace('-', '/')

/** 變化列的日期：新設依設立日、其餘是我們同步到的月份（來源沒有停辦日）。 */
export function changeDateText(item: Pick<AreaChange, 'change' | 'date' | 'date_basis'>): string {
  const when = yearMonth(item.date)
  if (item.change === 'opened') return item.date_basis === 'registered' ? `設立日 ${when}` : `${when} 起出現在名單`
  if (item.change === 'closed') return `${when} 起不在名單`
  return `${when} 起`
}

/** 類型變動多寫「私立 → 準公共」；其他種類（或缺新舊值）回空字串。 */
export function kindChangeText(item: Pick<AreaChange, 'change' | 'old_kind' | 'new_kind'>): string {
  if (item.change !== 'kind_changed' || !item.old_kind || !item.new_kind) return ''
  return `${kindLabel(item.old_kind)} → ${kindLabel(item.new_kind)}`
}

export const changesSubtitle = (radiusKm: number, months: number): string => `近 ${months} 個月・${radiusKm} 公里內`
export const changesEmptyText = (radiusKm: number, months: number): string =>
  `近 ${months} 個月，${radiusKm} 公里內沒有新設、停辦或類型變動的園所。`

const pad2 = (value: number): string => String(value).padStart(2, '0')
/** now 往前推 months 個月、同日（那個月沒有這天取月底）的 ISO 日期。 */
function monthsAgoIso(now: Date, months: number): string {
  const target = new Date(now.getFullYear(), now.getMonth() - months, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  return `${target.getFullYear()}-${pad2(target.getMonth() + 1)}-${pad2(Math.min(now.getDate(), lastDay))}`
}
const monthDay = (iso: string): string => `${Number(iso.slice(5, 7))} 月 ${Number(iso.slice(8, 10))} 日`

/**
 * 變化區塊底下的小字（規格 7.3）：異動紀錄從基準日才開始累積，基準日離今天不到視窗長度時要老實說從哪天起記錄；
 * 兩邊都還沒開始記錄寫「尚未開始記錄。」；都已滿視窗長度就不需要說明（回空字串）。
 * 幼兒園的新設看設立日、不需要等紀錄，所以每種寫法都帶「新設的幼兒園以設立日為準」。
 */
export function trackingNote(tracking: AreaTrackingSince, months = 12, now: Date = new Date()): string {
  const { kindergarten, babycare } = tracking
  if (!kindergarten && !babycare) return '尚未開始記錄。'
  const cutoff = monthsAgoIso(now, months)
  if ((!kindergarten || kindergarten <= cutoff) && (!babycare || babycare <= cutoff)) return ''
  const tail = '新設的幼兒園以設立日為準。'
  if (kindergarten && babycare && kindergarten === babycare) return `停辦與類型變動從 ${monthDay(kindergarten)}起記錄；${tail}`
  const parts = [
    kindergarten ? `幼兒園的停辦與類型變動從 ${monthDay(kindergarten)}起記錄` : '幼兒園的停辦與類型變動尚未開始記錄',
    babycare ? `托嬰從 ${monthDay(babycare)}起記錄` : '托嬰尚未開始記錄',
  ]
  return `${parts.join('；')}；${tail}`
}

/** 頁首狀態列的托嬰名單那一段。 */
export const babycareStatusText = (syncedAt: string | null): string =>
  syncedAt ? `托嬰名單 ${taipeiMonthDay(syncedAt)} 更新` : '托嬰名單尚未匯入'
```
`kindLabel`、`formatDistance`、`taipeiMonthDay`、`formatCount`、`NO_VALUE` 在這個檔案裡本來就有。

- [ ] **Step 6: 跑測試與型別檢查**

```bash
npx vitest run src/__tests__/areaFormat.test.ts src/__tests__/admissionsApi.test.ts src/__tests__/areaTab.test.ts src/__tests__/areaMap.test.ts
npm run typecheck
```
Expected：PASS、型別檢查無錯誤輸出。（`areaTab.test.ts`／`areaMap.test.ts` 此時應仍通過；狀態列字串到 Task 7 才改。）

- [ ] **Step 7: Commit**

```bash
cd ~/Repositories/ivy-website-wt/provider-changes-20261014
git add admin/src/api/types.ts admin/src/api/admissions.ts admin/src/components/admissions/area/areaFormat.ts admin/src/__tests__/admissionsTestKit.ts admin/src/__tests__/areaFormat.test.ts admin/src/__tests__/admissionsApi.test.ts
git commit -m "feat(admin): 托嬰與園所變化的型別、API 呼叫與文字函式

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 後台元件：托嬰清單、變化區塊、切換、地圖圖層

**Files:**
- Create: `admin/src/components/admissions/area/NearbyBabycare.vue`、`ProviderChanges.vue`、`NearbyPanel.vue`
- Modify: `admin/src/components/admissions/area/AreaMap.vue`、`AreaTab.vue`
- Modify: `admin/src/style.css`（新 token）
- Create: `admin/src/__tests__/nearbyProviders.test.ts`
- Modify: `admin/src/__tests__/areaMap.test.ts`、`admin/src/__tests__/areaTab.test.ts`

**Interfaces:**
- Consumes：Task 6 的型別、API、文字函式與測試資料；`NearbyKindergartens`（不改）。
- Produces：
  - `NearbyBabycare` props `{ data: AreaBabycare | null; failed: boolean; radiusKm: RadiusKm }`，emits `update:radiusKm`、`select(id)`、`retry`；根元素 class `nearby nearby--babycare`
  - `ProviderChanges` props `{ data: AreaChanges | null; failed: boolean; radiusKm: number }`，emits `retry`；根元素 class `changes`
  - `NearbyPanel` props `{ kind, radiusKm, kindergartens, kindergartensFailed, babycare, babycareFailed }`，emits `update:kind`、`update:radiusKm`、`select-kindergarten`、`select-babycare`、`retry-kindergartens`、`retry-babycare`；根元素 class `nearby-panel`
  - `AreaMap` 新 prop `babycare?: readonly AreaBabycareItem[]`（預設 `[]`）；`defineExpose({ focusKindergarten, focusBabycare, revealBabycare })`
  - CSS：`--area-kind-babycare`（`style.css`）；class `.area-bc`（地圖菱形標點）、`.area-dot--babycare`（圖例）

- [ ] **Step 1: 寫會失敗的元件測試**

(a) 建立 `admin/src/__tests__/nearbyProviders.test.ts`：

```ts
// 附近托嬰中心、附近園所的變化、名單種類切換（2026-10-14 規格 7.1、7.3）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import NearbyBabycare from '../components/admissions/area/NearbyBabycare.vue'
import NearbyKindergartens from '../components/admissions/area/NearbyKindergartens.vue'
import NearbyPanel from '../components/admissions/area/NearbyPanel.vue'
import ProviderChanges from '../components/admissions/area/ProviderChanges.vue'
import { areaBabycare, areaChanges, areaKindergartens, areaStats, babycareItem, providerChange } from './admissionsTestKit'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
  vi.useRealTimers()
})
function mountIt(component: unknown, props: Record<string, unknown>): VueWrapper {
  const wrapper = mount(component as never, { props, attachTo: document.body, global: { plugins: [ElementPlus] } })
  wrappers.push(wrapper)
  return wrapper
}

const babycareProps = (changes: Record<string, unknown> = {}) => ({ data: areaBabycare(), failed: false, radiusKm: 3, ...changes })

describe('附近托嬰中心', () => {
  it('標題、總結與清單：簡稱、類型標籤、距離・核定・實際收托；未知寫「—」不寫 0', () => {
    const wrapper = mountIt(NearbyBabycare, babycareProps())
    expect(wrapper.get('.nearby__title').text()).toBe('附近托嬰中心')
    expect(wrapper.get('.nearby__summary').text()).toBe('3 公里內托嬰中心 3 所，核定 92 位，實際收托 84 位。')
    expect(wrapper.findAll('.nearby__name').map((name) => name.text())).toEqual(['三民公共托嬰中心', '小星星托嬰中心', '鳥松社區公共托育家園'])
    expect(wrapper.findAll('.nearby__line .el-tag').map((tag) => tag.text())).toEqual(['托嬰中心', '托嬰中心', '托育家園'])
    expect(wrapper.findAll('.nearby__meta').map((meta) => meta.text())).toEqual([
      '165 m・核定 52 人・實際收托 52 人',
      '520 m・核定 40 人・實際收托 32 人',
      '1.3 km・核定 — 人・實際收托 — 人',
    ])
    expect(wrapper.get('.nearby__source').text()).toBe('資料來源：衛生福利部社會及家庭署公開資料（kiang 整理）；實際收托為官方資料・10/14 更新')
  })

  it('點一列：展開地址與電話並請地圖定位；再點一次只收合、不再定位；沒有電話就不列', async () => {
    const wrapper = mountIt(NearbyBabycare, babycareProps())
    const rows = wrapper.findAll('.nearby__row')
    await rows[1]!.trigger('click')
    expect(wrapper.emitted('select')).toEqual([['bc-center']])
    expect(rows[1]!.attributes('aria-expanded')).toBe('true')
    expect(wrapper.get('.nearby__detail').text()).toContain('高雄市三民區義華路20號')
    expect(wrapper.get('.nearby__detail').text()).toContain('07-3801000')
    await rows[1]!.trigger('click')
    expect(wrapper.find('.nearby__detail').exists()).toBe(false)
    expect(wrapper.emitted('select')).toHaveLength(1)
    await rows[2]!.trigger('click')
    expect(wrapper.get('.nearby__detail').text()).not.toContain('電話')
  })

  it('一次列 20 所，「顯示更多」展開其餘', async () => {
    const items = Array.from({ length: 25 }, (_, index) => babycareItem({ source_id: `bc-${index}`, name: `高雄市私立第${index}托嬰中心`, distance_m: 100 + index }))
    const wrapper = mountIt(NearbyBabycare, babycareProps({ data: areaBabycare(items) }))
    expect(wrapper.findAll('.nearby__item')).toHaveLength(20)
    await wrapper.findAll('button').find((button) => button.text().startsWith('顯示更多'))!.trigger('click')
    expect(wrapper.findAll('.nearby__item')).toHaveLength(25)
  })

  it('換半徑交給外面（update:radiusKm）；只收 1、3、6', async () => {
    const wrapper = mountIt(NearbyBabycare, babycareProps())
    wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', 6)
    wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', 4)
    expect(wrapper.emitted('update:radiusKm')).toEqual([[6]])
  })

  it('半徑內沒有托嬰中心：總結寫沒有，不列清單', () => {
    const wrapper = mountIt(NearbyBabycare, babycareProps({ data: areaBabycare([]), radiusKm: 1 }))
    expect(wrapper.get('.nearby__summary').text()).toBe('1 公里內沒有托嬰中心。')
    expect(wrapper.find('.nearby__list').exists()).toBe(false)
  })

  it('讀取中是骨架；讀取失敗寫錯誤並可重試', async () => {
    expect(mountIt(NearbyBabycare, babycareProps({ data: null })).find('.el-skeleton').exists()).toBe(true)
    const failed = mountIt(NearbyBabycare, babycareProps({ data: null, failed: true }))
    expect(failed.text()).toContain('無法讀取附近托嬰中心。')
    await failed.findAll('button').find((button) => button.text() === '重新載入')!.trigger('click')
    expect(failed.emitted('retry')).toHaveLength(1)
  })

  it('名單從未匯入：寫「尚未匯入」，不寫成附近沒有', () => {
    const wrapper = mountIt(NearbyBabycare, babycareProps({ data: areaBabycare([], { synced_at: null }) }))
    expect(wrapper.get('.nearby__empty').text()).toBe('托嬰名單尚未匯入。')
    expect(wrapper.find('.nearby__summary').exists()).toBe(false)
  })

  it('本校沒有座標：寫原因', () => {
    const campus = { ...areaStats().campus, lat: null, lng: null, locate_error: 'pending' }
    const wrapper = mountIt(NearbyBabycare, babycareProps({ data: areaBabycare([], { campus }) }))
    expect(wrapper.get('.nearby__empty').text()).toBe('門牌資料尚未匯入，無法列出附近托嬰中心。')
  })
})

describe('附近園所的變化', () => {
  const changesProps = (changes: Record<string, unknown> = {}) => ({ data: areaChanges(), failed: false, radiusKm: 3, ...changes })

  it('標題、副標，與每列：日期依據、種類、對象、名稱、距離；類型變動多寫新舊類型', () => {
    const wrapper = mountIt(ProviderChanges, changesProps())
    expect(wrapper.get('.changes__title').text()).toBe('附近園所的變化')
    expect(wrapper.get('.changes__head .hint').text()).toBe('近 12 個月・3 公里內')
    const rows = wrapper.findAll('.changes__item').map((row) => ({
      when: row.get('.changes__when').text(),
      tags: row.findAll('.el-tag').map((tag) => tag.text()),
      name: row.get('.changes__name').text(),
      meta: row.get('.changes__meta').text(),
    }))
    expect(rows).toEqual([
      { when: '2026/10 起不在名單', tags: ['停辦', '托嬰'], name: '頂尖小子托嬰中心', meta: '435 m' },
      { when: '2026/10 起', tags: ['類型變動', '幼兒園'], name: '保羅幼兒園', meta: '513 m・私立 → 準公共' },
      { when: '設立日 2026/09', tags: ['新設', '幼兒園'], name: '三多哈波特幼兒園', meta: '780 m' },
    ])
  })

  it('沒有任何變化：寫沒有；基準日不到 12 個月前，底下小字說從哪天起記錄', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 14))
    const wrapper = mountIt(ProviderChanges, changesProps({ data: areaChanges([]) }))
    expect(wrapper.get('.changes__empty').text()).toBe('近 12 個月，3 公里內沒有新設、停辦或類型變動的園所。')
    expect(wrapper.get('.changes__note').text()).toBe('停辦與類型變動從 10 月 14 日起記錄；新設的幼兒園以設立日為準。')
  })

  it('還沒開始記錄：小字寫「尚未開始記錄。」；基準日已滿 12 個月：不寫小字', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 14))
    const never = mountIt(ProviderChanges, changesProps({ data: areaChanges([], { tracking_since: { kindergarten: null, babycare: null } }) }))
    expect(never.get('.changes__note').text()).toBe('尚未開始記錄。')
    const old = mountIt(ProviderChanges, changesProps({ data: areaChanges([], { tracking_since: { kindergarten: '2025-01-01', babycare: '2025-01-01' } }) }))
    expect(old.find('.changes__note').exists()).toBe(false)
  })

  it('跟著半徑與 API 的視窗月數寫副標', () => {
    const wrapper = mountIt(ProviderChanges, changesProps({ data: areaChanges([], { radius_km: 6, window_months: 12 }), radiusKm: 6 }))
    expect(wrapper.get('.changes__head .hint').text()).toBe('近 12 個月・6 公里內')
  })

  it('讀取中是骨架；讀取失敗寫錯誤並可重試；本校沒座標寫原因', async () => {
    expect(mountIt(ProviderChanges, changesProps({ data: null })).find('.el-skeleton').exists()).toBe(true)
    const failed = mountIt(ProviderChanges, changesProps({ data: null, failed: true }))
    expect(failed.text()).toContain('無法讀取附近園所的變化。')
    await failed.findAll('button').find((button) => button.text() === '重新載入')!.trigger('click')
    expect(failed.emitted('retry')).toHaveLength(1)
    const campus = { ...areaStats().campus, lat: null, lng: null, locate_error: 'no_address' }
    const unlocated = mountIt(ProviderChanges, changesProps({ data: areaChanges([], { campus }) }))
    expect(unlocated.get('.changes__empty').text()).toBe('找不到本校地址，無法列出附近園所的變化。')
  })

  it('同一所同一天的兩種變化各自成列（key 不重複）', () => {
    const items = [providerChange({ change: 'opened' }), providerChange({ change: 'kind_changed', old_kind: 'private', new_kind: 'quasi_public' })]
    expect(mountIt(ProviderChanges, changesProps({ data: areaChanges(items) })).findAll('.changes__item')).toHaveLength(2)
  })
})

describe('名單種類切換', () => {
  const panelProps = (changes: Record<string, unknown> = {}) => ({
    kind: 'kindergarten', radiusKm: 3, kindergartens: areaKindergartens(), kindergartensFailed: false,
    babycare: areaBabycare(), babycareFailed: false, ...changes,
  })

  it('預設是幼兒園清單；切換鈕有名稱、幼兒園在前', () => {
    const wrapper = mountIt(NearbyPanel, panelProps())
    expect(wrapper.findComponent(NearbyKindergartens).exists()).toBe(true)
    expect(wrapper.findComponent(NearbyBabycare).exists()).toBe(false)
    expect(wrapper.get('[aria-label="名單種類"]').exists()).toBe(true)
    expect(wrapper.findAll('.nearby-panel .el-radio-button').slice(0, 2).map((button) => button.text())).toEqual(['幼兒園', '托嬰中心'])
  })

  it('kind 是托嬰中心時顯示托嬰清單；切換只回報、不自己改', async () => {
    const wrapper = mountIt(NearbyPanel, panelProps({ kind: 'babycare' }))
    expect(wrapper.findComponent(NearbyBabycare).exists()).toBe(true)
    expect(wrapper.findComponent(NearbyKindergartens).exists()).toBe(false)
    wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', 'kindergarten')
    wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', 'other')
    await flushPromises()
    expect(wrapper.emitted('update:kind')).toEqual([['kindergarten']])
    expect(wrapper.findComponent(NearbyBabycare).exists()).toBe(true)
  })

  it('兩份清單的半徑、選取、重試都轉送出去', () => {
    const kindergarten = mountIt(NearbyPanel, panelProps())
    kindergarten.findComponent(NearbyKindergartens).vm.$emit('update:radiusKm', 6)
    kindergarten.findComponent(NearbyKindergartens).vm.$emit('select', 'kg-public')
    kindergarten.findComponent(NearbyKindergartens).vm.$emit('retry')
    expect(kindergarten.emitted('update:radiusKm')).toEqual([[6]])
    expect(kindergarten.emitted('select-kindergarten')).toEqual([['kg-public']])
    expect(kindergarten.emitted('retry-kindergartens')).toHaveLength(1)
    const babycare = mountIt(NearbyPanel, panelProps({ kind: 'babycare' }))
    babycare.findComponent(NearbyBabycare).vm.$emit('update:radiusKm', 1)
    babycare.findComponent(NearbyBabycare).vm.$emit('select', 'bc-center')
    babycare.findComponent(NearbyBabycare).vm.$emit('retry')
    expect(babycare.emitted('update:radiusKm')).toEqual([[1]])
    expect(babycare.emitted('select-babycare')).toEqual([['bc-center']])
    expect(babycare.emitted('retry-babycare')).toHaveLength(1)
  })
})
```

(b) `admin/src/__tests__/areaMap.test.ts`：檔頭 import 補 `areaBabycare, babycareItem`；在檔尾新增（`mountMap`、`one`、`leaflet` 檔內已有）：

```ts
describe('托嬰中心圖層（2026-10-14）', () => {
  const items = () => areaBabycare().items
  // 第一個 marker 是本校星號。
  const babycareMarkers = () => leaflet.created.marker!.slice(1)

  it('標點用菱形（divIcon）、帶機構名稱；圖層預設不勾，所以沒有加到地圖上', async () => {
    const wrapper = await mountMap({ babycare: items() })
    expect(babycareMarkers().map((marker) => marker.options.title)).toEqual(items().map((item) => item.name))
    expect(leaflet.module.divIcon).toHaveBeenCalledWith(expect.objectContaining({ className: 'area-bc', iconSize: [16, 16] }))
    const group = leaflet.created.layerGroup![1]
    expect(group.addLayer).toHaveBeenCalledTimes(3)
    expect(group.addTo).not.toHaveBeenCalled()
    expect(wrapper.find('[aria-label="在地圖上顯示托嬰中心"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('托嬰中心與托育家園')
  })

  it('勾選打開圖層、取消收起；圖例跟著出現與收起；幼兒園的開關不受影響', async () => {
    const wrapper = await mountMap({ babycare: items() })
    const group = leaflet.created.layerGroup![1]
    const switches = wrapper.findAllComponents({ name: 'ElSwitch' })
    switches[1]!.vm.$emit('update:modelValue', true)
    await flushPromises()
    expect(one('map').addLayer).toHaveBeenCalledWith(group)
    expect(wrapper.text()).toContain('托嬰中心與托育家園')
    switches[1]!.vm.$emit('update:modelValue', false)
    await flushPromises()
    expect(one('map').removeLayer).toHaveBeenCalledWith(group)
    expect(wrapper.text()).not.toContain('托嬰中心與托育家園')
    expect(wrapper.text()).toContain('非營利') // 幼兒園的類型圖例還在
  })

  it('focusBabycare：圖層沒開就先打開，地圖移到該點並打開資訊；已經開著不重複加', async () => {
    const wrapper = await mountMap({ babycare: items() })
    const vm = wrapper.vm as unknown as { focusBabycare: (id: string) => void; revealBabycare: () => void }
    vm.focusBabycare('bc-center')
    await flushPromises()
    const group = leaflet.created.layerGroup![1]
    expect(one('map').addLayer).toHaveBeenCalledWith(group)
    expect(one('map').setView).toHaveBeenCalledWith({ lat: 22.6, lng: 120.3 }, 15)
    expect(babycareMarkers()[1]!.openPopup).toHaveBeenCalled()
    one('map').addLayer.mockClear()
    vm.focusBabycare('bc-public')
    vm.revealBabycare()
    expect(one('map').addLayer).not.toHaveBeenCalled()
    vm.focusBabycare('不存在的代碼') // 找不到就什麼都不做
  })

  it('revealBabycare：卡片切到托嬰中心時打開圖層', async () => {
    const wrapper = await mountMap({ babycare: items() })
    ;(wrapper.vm as unknown as { revealBabycare: () => void }).revealBabycare()
    await flushPromises()
    expect(one('map').addLayer).toHaveBeenCalledWith(leaflet.created.layerGroup![1])
    expect(wrapper.text()).toContain('托嬰中心與托育家園')
  })

  it('資訊框：簡稱、類型、距離、核定、實際收托與電話；名稱當文字不當標籤', async () => {
    await mountMap({ babycare: [babycareItem({ name: '<b>高雄市私立怪名字托嬰中心</b>' })] })
    const content = babycareMarkers()[0]!.bindPopup.mock.calls[0]![0]() as HTMLElement
    expect(content.textContent).toContain('托嬰中心・520 m・核定 40 人・實際收托 32 人')
    expect(content.textContent).toContain('07-3801000')
    expect(content.querySelector('b')).toBeNull()
  })

  it('換了托嬰清單整組重畫；沒有托嬰時只有本校星號', async () => {
    const wrapper = await mountMap()
    expect(leaflet.created.marker).toHaveLength(1)
    await wrapper.setProps({ babycare: items().slice(0, 2) })
    expect(leaflet.created.layerGroup![1].clearLayers).toHaveBeenCalled()
    expect(babycareMarkers()).toHaveLength(2)
  })
})
```

(c) `admin/src/__tests__/areaTab.test.ts`：

- import 區加：`import NearbyPanel from '../components/admissions/area/NearbyPanel.vue'`、`import NearbyBabycare from '../components/admissions/area/NearbyBabycare.vue'`；testKit import 補 `areaBabycare, areaChanges`。
- `const mapStub = vi.hoisted(() => ({ focus: vi.fn() }))` 改成 `({ focus: vi.fn(), focusBabycare: vi.fn(), reveal: vi.fn() })`；AreaMap 的 stub：`props: [...]` 末尾加 `'babycare'`；`expose({ focusKindergarten: mapStub.focus })` 改成 `expose({ focusKindergarten: mapStub.focus, focusBabycare: mapStub.focusBabycare, revealBabycare: mapStub.reveal })`；`afterEach` 裡一併 `mapStub.focusBabycare.mockClear(); mapStub.reveal.mockClear()`。
- `routes(...)` 的物件加兩行（放在 `'/admin/admissions/area/kindergartens'` 之後）：
  ```ts
    '/admin/admissions/area/babycare': areaBabycare(),
    '/admin/admissions/area/changes': areaChanges(),
  ```
- 所有斷言 `.area-status` 文字的測試補上托嬰那一段（用 `grep -n "各里人口" admin/src/__tests__/areaTab.test.ts` 找全，順序是：門牌・幼兒園・托嬰・各里人口）。已知四處：
  - `'門牌資料 115 年 10 月版・幼兒園名單 10/08 更新・各里人口 115 年 9 月'` → `'門牌資料 115 年 10 月版・幼兒園名單 10/08 更新・托嬰名單 10/14 更新・各里人口 115 年 9 月'`
  - `'幼兒園名單 10/08 更新・各里人口 115 年 9 月'`（span 清單第二項）→ `'幼兒園名單 10/08 更新・托嬰名單 10/14 更新・各里人口 115 年 9 月'`
  - `'門牌資料 115 年 10 月版・幼兒園名單尚未匯入・各里人口 115 年 9 月'` → `'門牌資料 115 年 10 月版・幼兒園名單尚未匯入・托嬰名單 10/14 更新・各里人口 115 年 9 月'`
  - `'幼兒園名單尚未匯入・各里人口 115 年 9 月'` → `'幼兒園名單尚未匯入・托嬰名單 10/14 更新・各里人口 115 年 9 月'`
- 檔尾新增：

```ts
describe('托嬰與園所變化（2026-10-14 規格 7）', () => {
  it('依頁首校區與半徑讀托嬰與變化；狀態列多一段托嬰名單更新日', async () => {
    const { wrapper, get } = await mountTab()
    expect(Object.fromEntries(queryOf(pathsTo(get, '/admin/admissions/area/babycare')[0]!))).toEqual({ campus_key: 'yihua', radius_km: '3' })
    expect(Object.fromEntries(queryOf(pathsTo(get, '/admin/admissions/area/changes')[0]!))).toEqual({ campus_key: 'yihua', radius_km: '3' })
    expect(wrapper.get('.area-status').text()).toBe('門牌資料 115 年 10 月版・幼兒園名單 10/08 更新・托嬰名單 10/14 更新・各里人口 115 年 9 月')
  })

  it('托嬰名單還沒匯入：狀態列寫尚未匯入', async () => {
    const area = areaStats({ data_status: { ...areaStats().data_status, babycare_synced_at: null } })
    const { wrapper } = await mountTab({}, area)
    expect(wrapper.get('.area-status').text()).toContain('幼兒園名單 10/08 更新・托嬰名單尚未匯入・各里人口 115 年 9 月')
  })

  it('預設是幼兒園清單；切到托嬰中心才顯示托嬰清單，並請地圖打開托嬰圖層；地圖一直拿得到托嬰點', async () => {
    const { wrapper } = await mountTab()
    expect(wrapper.find('.nearby--babycare').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('babycare')).toHaveLength(3)
    wrapper.findComponent(NearbyPanel).vm.$emit('update:kind', 'babycare')
    await flushPromises()
    expect(wrapper.find('.nearby--babycare').exists()).toBe(true)
    expect(wrapper.find('.nearby__title').text()).toBe('附近托嬰中心')
    expect(wrapper.get('.nearby__summary').text()).toBe('3 公里內托嬰中心 3 所，核定 92 位，實際收托 84 位。')
    expect(mapStub.reveal).toHaveBeenCalledTimes(1)
  })

  it('托嬰清單點一列：地圖移到該點', async () => {
    const { wrapper } = await mountTab()
    wrapper.findComponent(NearbyPanel).vm.$emit('update:kind', 'babycare')
    await flushPromises()
    wrapper.findComponent(NearbyBabycare).vm.$emit('select', 'bc-public')
    expect(mapStub.focusBabycare).toHaveBeenCalledWith('bc-public')
    expect(mapStub.focus).not.toHaveBeenCalled()
  })

  it('換半徑：幼兒園、托嬰、變化一起重讀並帶 radius_km，地圖半徑跟著變', async () => {
    const { wrapper, get } = await mountTab()
    wrapper.findComponent(NearbyKindergartens).vm.$emit('update:radiusKm', 6)
    await flushPromises()
    for (const path of ['/admin/admissions/area/kindergartens', '/admin/admissions/area/babycare', '/admin/admissions/area/changes']) {
      expect(queryOf(pathsTo(get, path).at(-1)!).get('radius_km')).toBe('6')
    }
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('radiusKm')).toBe(6)
  })

  it('半徑在托嬰清單上換也一樣（兩份清單共用同一個半徑）', async () => {
    const { wrapper, get } = await mountTab()
    wrapper.findComponent(NearbyPanel).vm.$emit('update:kind', 'babycare')
    await flushPromises()
    wrapper.findComponent(NearbyBabycare).vm.$emit('update:radiusKm', 1)
    await flushPromises()
    expect(queryOf(pathsTo(get, '/admin/admissions/area/babycare').at(-1)!).get('radius_km')).toBe('1')
    expect(queryOf(pathsTo(get, '/admin/admissions/area/kindergartens').at(-1)!).get('radius_km')).toBe('1')
  })

  it('托嬰讀取失敗：切到托嬰才看得到錯誤；幼兒園清單、變化、地圖照常；重試成功恢復', async () => {
    let fail = true
    mockGet({ ...routes(), '/admin/admissions/area/babycare': () => { if (fail) throw new Error('boom'); return areaBabycare() } })
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    expect(wrapper.text()).not.toContain('無法讀取附近托嬰中心。')
    expect(wrapper.findAll('.nearby__name')).toHaveLength(4)
    expect(wrapper.findAll('.changes__item')).toHaveLength(3)
    wrapper.findComponent(NearbyPanel).vm.$emit('update:kind', 'babycare')
    await flushPromises()
    expect(wrapper.text()).toContain('無法讀取附近托嬰中心。')
    expect(wrapper.findComponent({ name: 'AreaMap' }).props('babycare')).toEqual([])
    fail = false
    await button(wrapper, '重新載入')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('無法讀取附近托嬰中心。')
    expect(wrapper.findAll('.nearby__name')).toHaveLength(3)
  })

  it('變化區塊在「附近幼兒園」卡片正下方，列出近 12 個月的變化', async () => {
    const { wrapper } = await mountTab()
    const side = wrapper.get('.area-top__side')
    expect(side.element.children[0]!.classList.contains('nearby-panel')).toBe(true)
    expect(side.element.children[1]!.classList.contains('changes')).toBe(true)
    expect(wrapper.findAll('.changes__item').map((row) => row.get('.changes__name').text())).toEqual(['頂尖小子托嬰中心', '保羅幼兒園', '三多哈波特幼兒園'])
  })

  it('變化讀取失敗：只有這一塊寫錯誤與重試，清單、三張表、地圖照常；重試成功恢復', async () => {
    let fail = true
    mockGet({ ...routes(), '/admin/admissions/area/changes': () => { if (fail) throw new Error('boom'); return areaChanges() } })
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    expect(wrapper.text()).toContain('無法讀取附近園所的變化。')
    expect(wrapper.text()).not.toContain('無法讀取區域分析')
    expect(wrapper.findAll('.nearby__name')).toHaveLength(4)
    expect(bodyRows(block(wrapper, '里排行'))).toHaveLength(3)
    fail = false
    await wrapper.get('.changes').findAll('button').find((item) => item.text() === '重新載入')!.trigger('click')
    await flushPromises()
    expect(wrapper.findAll('.changes__item')).toHaveLength(3)
  })

  it('連續換半徑：變化只採用最後一次（先送出的晚回不蓋掉）', async () => {
    const slow = deferred<unknown>()
    let first = true
    mockGet({
      ...routes(),
      '/admin/admissions/area/changes': () => {
        if (first) { first = false; return areaChanges() }
        return slow.promise
      },
    })
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    await vi.waitFor(() => expect(wrapper.findAll('.changes__item')).toHaveLength(3))
    wrapper.findComponent(NearbyKindergartens).vm.$emit('update:radiusKm', 6)
    await flushPromises()
    expect(wrapper.find('.changes .el-skeleton').exists()).toBe(true) // 換半徑先清空再讀
    slow.resolve(areaChanges([], { radius_km: 6 }))
    await flushPromises()
    expect(wrapper.findAll('.changes__item')).toHaveLength(0)
    expect(wrapper.get('.changes__empty').text()).toBe('近 12 個月，6 公里內沒有新設、停辦或類型變動的園所。')
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd ~/Repositories/ivy-website-wt/provider-changes-20261014/admin
source ~/.nvm/nvm.sh; nvm use 22
npx vitest run src/__tests__/nearbyProviders.test.ts src/__tests__/areaMap.test.ts src/__tests__/areaTab.test.ts
```
Expected：FAIL（找不到元件檔；`babycare` prop 不存在；狀態列字串不符）。

- [ ] **Step 3: 新 token**

`admin/src/style.css`，在 `--area-chance: oklch(0.6 0.19 12);` 那行之後加：

```css
  /* 托嬰中心（2026-10-14）：地圖上的菱形標點與圖例。另挑洋紅色相（340），避開幼兒園四色、本機構金、
     招生機會的玫瑰（12）與操作藍；形狀（菱形 vs 圓點）另外區分，不只靠顏色。 */
  --area-kind-babycare: oklch(0.55 0.17 340);
```

- [ ] **Step 4: 新增三個元件**

(a) `admin/src/components/admissions/area/NearbyBabycare.vue`：

```vue
<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import type { AreaBabycare } from '../../../api/types'
import {
  RADIUS_OPTIONS, babycareKindLabel, babycareMeta, babycareShortName, babycareSummaryText, campusNotLocatedReason, taipeiMonthDay,
  type RadiusKm,
} from './areaFormat'

// 附近托嬰中心（2026-10-14 規格 7.1）：本校半徑內營業中的托嬰中心與公共托育家園，後端已依距離排序。
// 行為同附近幼兒園：點一列展開地址與電話，同時請地圖移過去並打開該機構資訊（select）；再點一次只收合。
// 核定與實際收托是官方回報的數字，來源沒給寫「—」。樣式照 NearbyKindergartens.vue 複製需要的部分
// （兩個元件各自 scoped，不為這幾十行抽共用檔）。
const props = defineProps<{ data: AreaBabycare | null; failed: boolean; radiusKm: RadiusKm }>()
const emit = defineEmits<{ 'update:radiusKm': [value: RadiusKm]; select: [id: string]; retry: [] }>()

const PAGE = 20
const headingId = useId()
// 展開的詳情（dl）的 id，給展開鈕的 aria-controls 指；只有展開的那一列有 dl，id 跟著列的位置編。
const detailId = (index: number) => `${headingId}-detail-${index}`
const showAll = ref(false)
const expanded = ref<string | null>(null)

// 換校區或半徑（新資料）：收回「顯示更多」與展開。
watch(() => props.data, () => {
  showAll.value = false
  expanded.value = null
})

const items = computed(() => props.data?.items ?? [])
const visible = computed(() => (showAll.value ? items.value : items.value.slice(0, PAGE)))
const notLocated = computed(() => {
  const reason = props.data?.campus.locate_error
  return reason ? `${campusNotLocatedReason(reason) ?? '本校位置尚未確定'}，無法列出附近托嬰中心。` : ''
})
// 名單從未匯入（後端 synced_at 為 null）：空清單不代表附近沒有托嬰中心，寫原因。校區位置沒標出來的原因優先。
const notImported = computed(() => props.data?.synced_at === null)
const summary = computed(() => (props.data ? babycareSummaryText(props.data.summary, props.radiusKm) : ''))

function choose(id: string) {
  const opening = expanded.value !== id
  expanded.value = opening ? id : null
  if (opening) emit('select', id)
}
function setRadius(value: string | number | boolean | undefined) {
  const km = Number(value)
  if (km === 1 || km === 3 || km === 6) emit('update:radiusKm', km)
}
</script>

<template>
  <section class="nearby nearby--babycare" :aria-labelledby="headingId">
    <div class="nearby__head">
      <h3 :id="headingId" class="nearby__title">附近托嬰中心</h3>
      <el-radio-group :model-value="radiusKm" size="small" aria-label="搜尋半徑" @update:model-value="setRadius">
        <el-radio-button v-for="km in RADIUS_OPTIONS" :key="km" :value="km">{{ km }} 公里</el-radio-button>
      </el-radio-group>
    </div>

    <el-alert v-if="failed" type="error" :closable="false" show-icon title="無法讀取附近托嬰中心。">
      <el-button size="small" @click="emit('retry')">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="!data" :rows="4" animated />
    <p v-else-if="notLocated" class="nearby__empty">{{ notLocated }}</p>
    <p v-else-if="notImported" class="nearby__empty">托嬰名單尚未匯入。</p>
    <template v-else>
      <p class="nearby__summary num">{{ summary }}</p>
      <ul v-if="visible.length" class="nearby__list">
        <li v-for="(item, index) in visible" :key="item.source_id" class="nearby__item">
          <button
            type="button"
            class="nearby__row"
            :aria-expanded="expanded === item.source_id"
            :aria-controls="expanded === item.source_id ? detailId(index) : undefined"
            @click="choose(item.source_id)"
          >
            <span class="nearby__line">
              <span class="nearby__name">{{ babycareShortName(item.name) }}</span>
              <el-tag size="small" type="info" effect="plain" round>{{ babycareKindLabel(item.kind) }}</el-tag>
            </span>
            <span class="nearby__meta num">{{ babycareMeta(item) }}</span>
          </button>
          <dl v-if="expanded === item.source_id" :id="detailId(index)" class="nearby__detail">
            <div><dt>地址</dt><dd>{{ item.address }}</dd></div>
            <div v-if="item.phone"><dt>電話</dt><dd>{{ item.phone }}</dd></div>
          </dl>
        </li>
      </ul>
      <el-button v-if="!showAll && items.length > PAGE" text @click="showAll = true">顯示更多（還有 {{ items.length - PAGE }} 所）</el-button>
      <p class="hint nearby__source">{{ data.source_note }}・{{ taipeiMonthDay(data.synced_at) }} 更新</p>
    </template>
  </section>
</template>

<style scoped>
.nearby {
  display: grid;
  align-content: start;
  gap: 10px;
  min-width: 0;
}

.nearby__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.nearby__title {
  margin: 0;
  font-size: var(--text-md);
}

.nearby__summary {
  margin: 0;
  color: var(--ink);
}

.nearby__list {
  display: grid;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  list-style: none;
}

.nearby__item + .nearby__item {
  border-top: 1px solid var(--line);
}

.nearby__row {
  display: grid;
  gap: 4px;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  background: none;
  color: var(--ink);
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.nearby__row:focus-visible {
  outline-offset: -2px;
}

.nearby__row:hover,
.nearby__row[aria-expanded='true'] {
  background: var(--surface-2);
}

.nearby__line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.nearby__name {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.nearby__meta {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.nearby__detail {
  display: grid;
  gap: 4px;
  margin: 0;
  padding: 0 12px 10px;
  font-size: var(--text-sm);
}

.nearby__detail div {
  display: grid;
  grid-template-columns: 5em minmax(0, 1fr);
  gap: 8px;
}

.nearby__detail dt {
  color: var(--ink-3);
}

.nearby__detail dd {
  margin: 0;
  overflow-wrap: anywhere;
}

.nearby__empty {
  margin: 0;
  color: var(--ink-2);
}

.nearby__source {
  margin: 0;
}

@media (min-width: 1200px) {
  .nearby__list {
    max-height: 420px;
  }
}
</style>
```

(b) `admin/src/components/admissions/area/ProviderChanges.vue`：

```vue
<script setup lang="ts">
import { computed, useId } from 'vue'
import type { AreaChange, AreaChanges } from '../../../api/types'
import {
  campusNotLocatedReason, changeDateText, changeLabel, changesEmptyText, changesSubtitle, formatDistance, kindChangeText,
  providerLabel, shortName, babycareShortName, trackingNote,
} from './areaFormat'

// 附近園所的變化（2026-10-14 規格 7.3）：本校半徑內近 12 個月的新設、停辦、類型變動，幼兒園與托嬰都涵蓋，
// 後端已依日期新到舊排好。這一版列不可點（停辦的園所不在地圖上）。
// 異動紀錄從基準日才開始累積，所以底下小字老實說從哪天起記錄；多數校區一年只有 0～1 件，空是正常的。
const props = defineProps<{ data: AreaChanges | null; failed: boolean; radiusKm: number }>()
const emit = defineEmits<{ retry: [] }>()

const headingId = useId()
const notLocated = computed(() => {
  const reason = props.data?.campus.locate_error
  return reason ? `${campusNotLocatedReason(reason) ?? '本校位置尚未確定'}，無法列出附近園所的變化。` : ''
})
const note = computed(() => (props.data ? trackingNote(props.data.tracking_since, props.data.window_months) : ''))
const nameOf = (item: AreaChange): string => (item.provider === 'babycare' ? babycareShortName(item.name) : shortName(item.name))
const metaOf = (item: AreaChange): string => {
  const kind = kindChangeText(item)
  return kind ? `${formatDistance(item.distance_m)}・${kind}` : formatDistance(item.distance_m)
}
const tagType = (change: string): 'success' | 'warning' | 'info' =>
  change === 'opened' ? 'success' : change === 'closed' ? 'warning' : 'info'
</script>

<template>
  <section class="changes" :aria-labelledby="headingId">
    <div class="changes__head">
      <h3 :id="headingId" class="changes__title">附近園所的變化</h3>
      <span class="hint">{{ changesSubtitle(radiusKm, data?.window_months ?? 12) }}</span>
    </div>

    <el-alert v-if="failed" type="error" :closable="false" show-icon title="無法讀取附近園所的變化。">
      <el-button size="small" @click="emit('retry')">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="!data" :rows="3" animated />
    <p v-else-if="notLocated" class="changes__empty">{{ notLocated }}</p>
    <template v-else>
      <ul v-if="data.items.length" class="changes__list">
        <li v-for="item in data.items" :key="`${item.provider}-${item.source_id}-${item.change}`" class="changes__item">
          <span class="changes__when num">{{ changeDateText(item) }}</span>
          <span class="changes__line">
            <el-tag size="small" :type="tagType(item.change)" effect="plain" round>{{ changeLabel(item.change) }}</el-tag>
            <el-tag size="small" type="info" effect="plain" round>{{ providerLabel(item.provider) }}</el-tag>
            <span class="changes__name">{{ nameOf(item) }}</span>
          </span>
          <span class="changes__meta num">{{ metaOf(item) }}</span>
        </li>
      </ul>
      <p v-else class="changes__empty">{{ changesEmptyText(data.radius_km, data.window_months) }}</p>
      <p v-if="note" class="hint changes__note">{{ note }}</p>
    </template>
  </section>
</template>

<style scoped>
.changes {
  display: grid;
  align-content: start;
  gap: 10px;
  min-width: 0;
}

.changes__head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px 8px;
}

.changes__title {
  margin: 0;
  font-size: var(--text-md);
}

.changes__list {
  display: grid;
  margin: 0;
  padding: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--surface);
  list-style: none;
}

.changes__item {
  display: grid;
  gap: 4px;
  padding: 10px 12px;
}

.changes__item + .changes__item {
  border-top: 1px solid var(--line);
}

.changes__when,
.changes__meta {
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.changes__line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.changes__name {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.changes__empty,
.changes__note {
  margin: 0;
}

.changes__empty {
  color: var(--ink-2);
}
</style>
```

(c) `admin/src/components/admissions/area/NearbyPanel.vue`：

```vue
<script setup lang="ts">
import type { AreaBabycare, AreaKindergartens } from '../../../api/types'
import NearbyBabycare from './NearbyBabycare.vue'
import NearbyKindergartens from './NearbyKindergartens.vue'
import { NEARBY_KINDS, type NearbyKind, type RadiusKm } from './areaFormat'

// 「附近幼兒園」卡片（2026-10-14 規格 7.1）：頂端加一組切換——幼兒園（預設）／托嬰中心，半徑兩邊共用。
// 兩份清單各自讀取、各自有狀態（骨架、失敗重試、尚未匯入），這裡只負責切換與把事件轉送出去。
defineProps<{
  kind: NearbyKind
  radiusKm: RadiusKm
  kindergartens: AreaKindergartens | null
  kindergartensFailed: boolean
  babycare: AreaBabycare | null
  babycareFailed: boolean
}>()
const emit = defineEmits<{
  'update:kind': [value: NearbyKind]
  'update:radiusKm': [value: RadiusKm]
  'select-kindergarten': [id: string]
  'select-babycare': [id: string]
  'retry-kindergartens': []
  'retry-babycare': []
}>()

function setKind(value: string | number | boolean | undefined) {
  if (value === 'kindergarten' || value === 'babycare') emit('update:kind', value)
}
</script>

<template>
  <div class="nearby-panel">
    <el-radio-group :model-value="kind" size="small" aria-label="名單種類" @update:model-value="setKind">
      <el-radio-button v-for="option in NEARBY_KINDS" :key="option.value" :value="option.value">{{ option.label }}</el-radio-button>
    </el-radio-group>
    <NearbyKindergartens
      v-if="kind === 'kindergarten'"
      :radius-km="radiusKm"
      :data="kindergartens"
      :failed="kindergartensFailed"
      @update:radius-km="emit('update:radiusKm', $event)"
      @select="emit('select-kindergarten', $event)"
      @retry="emit('retry-kindergartens')"
    />
    <NearbyBabycare
      v-else
      :radius-km="radiusKm"
      :data="babycare"
      :failed="babycareFailed"
      @update:radius-km="emit('update:radiusKm', $event)"
      @select="emit('select-babycare', $event)"
      @retry="emit('retry-babycare')"
    />
  </div>
</template>

<style scoped>
.nearby-panel {
  display: grid;
  align-content: start;
  gap: 10px;
  min-width: 0;
}
</style>
```

- [ ] **Step 5: 改 `AreaMap.vue`**

(a) import：型別名單加 `AreaBabycareItem`；`./areaFormat` 的名單加 `babycareKindLabel, babycareMeta, babycareShortName`。

(b) props：`withDefaults(defineProps<{ ... opportunityNote?: string }>(), { opportunity: null, opportunityNote: '' })` 改成加一個 `babycare?: readonly AreaBabycareItem[]`（放在 `kindergartens` 之後）與預設 `babycare: () => []`。

(c) 常數：`STAR_SVG` 之後加
```ts
const DIAMOND_SVG = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 1l7 7-7 7-7-7z"/></svg>'
```

(d) 狀態：`const kindergartenMarkers = ...` 之後加
```ts
let babycareGroup: Leaflet.LayerGroup | null = null
const babycareMarkers = new Map<string, Leaflet.Marker>()
```
`const showKindergartens = ref(true)` 之後加
```ts
// 托嬰中心圖層預設不勾（維持現有畫面）；卡片切到托嬰中心或點清單某一列時自動打開。
const showBabycare = ref(false)
```

(e) 在 `kindergartenPopup` 之後加：
```ts
function babycarePopup(item: AreaBabycareItem): HTMLElement {
  const root = document.createElement('div')
  root.className = 'area-popup'
  const title = document.createElement('strong')
  title.textContent = babycareShortName(item.name)
  root.append(title, popupLine(`${babycareKindLabel(item.kind)}・${babycareMeta(item)}`))
  if (item.phone) root.append(popupLine(item.phone))
  return root
}
```

(f) 在 `focusKindergarten` 與 `defineExpose` 之間改成：
```ts
function drawBabycare() {
  const group = babycareGroup
  if (!L || !group) return
  group.clearLayers()
  babycareMarkers.clear()
  for (const item of props.babycare) {
    const marker = L.marker([item.lat, item.lng], {
      icon: L.divIcon({ className: 'area-bc', html: DIAMOND_SVG, iconSize: [16, 16], iconAnchor: [8, 8] }),
      title: item.name,
      alt: item.name,
      keyboard: false,
    })
    marker.bindPopup(() => babycarePopup(item))
    group.addLayer(marker)
    babycareMarkers.set(item.source_id, marker)
  }
}

function setShowBabycare(value: boolean) {
  showBabycare.value = value
  if (!map || !babycareGroup) return
  if (value) map.addLayer(babycareGroup)
  else map.removeLayer(babycareGroup)
}

/** 卡片切到托嬰中心：打開圖層（已經開著就不動）。 */
function revealBabycare() {
  if (!showBabycare.value) setShowBabycare(true)
}

/** 托嬰清單點一列：地圖移到該點並打開資訊（圖層沒開就先打開）。 */
function focusBabycare(id: string) {
  const marker = babycareMarkers.get(id)
  if (!map || !marker) return
  revealBabycare()
  map.setView(marker.getLatLng(), Math.max(map.getZoom(), 15))
  marker.openPopup()
}
defineExpose({ focusKindergarten, focusBabycare, revealBabycare })
```
（原本那一行 `defineExpose({ focusKindergarten })` 刪掉，由上面取代。）

(g) `destroyMap()` 裡 `kindergartenMarkers.clear()` 之後加 `babycareGroup = null` 與 `babycareMarkers.clear()`（`kindergartenGroup = null` 同一區塊）。

(h) `buildMap()`：`kindergartenGroup = leaflet.layerGroup().addTo(map)` 之後加
```ts
  babycareGroup = leaflet.layerGroup()
  if (showBabycare.value) babycareGroup.addTo(map)
```
`drawKindergartens()` 之後加 `drawBabycare()`。

(i) 監看：`watch(() => props.kindergartens, drawKindergartens)` 之後加 `watch(() => props.babycare, drawBabycare)`。

(j) 圖例：在 `<div class="area-legend area-legend--kinds">…</div>`（幼兒園那一組）之後、`<p v-if="campusNote" …>` 之前加：
```html
      <div class="area-legend area-legend--kinds">
        <el-switch
          :model-value="showBabycare"
          aria-label="在地圖上顯示托嬰中心"
          active-text="托嬰中心"
          @update:model-value="setShowBabycare(Boolean($event))"
        />
        <ul v-if="showBabycare" class="area-legend" aria-label="托嬰中心圖例">
          <li><span class="area-dot area-dot--babycare" aria-hidden="true" />托嬰中心與托育家園</li>
        </ul>
      </div>
```

(k) 樣式：在 `.area-dot--own { ... }` 之後加
```css
.area-dot--babycare {
  width: 9px;
  height: 9px;
  border-radius: 0;
  background: var(--area-kind-babycare);
  transform: rotate(45deg);
}
```
在 `.area-map :deep(.area-campus svg path) {…}` 之前加
```css
.area-map :deep(.area-bc svg path) {
  fill: var(--area-kind-babycare);
  stroke: var(--surface);
  stroke-width: 1.5;
}
```
檔頭說明註解補一句「2026-10-14：托嬰中心用菱形標點、獨立圖層（預設不勾）」。

- [ ] **Step 6: 改 `AreaTab.vue`**

(a) import：
```ts
import NearbyPanel from './NearbyPanel.vue'
import ProviderChanges from './ProviderChanges.vue'
```
（拿掉 `NearbyKindergartens` 的 import——AreaTab 不再直接用它。）`../../../api/admissions` 的名單加 `getAreaBabycare, getAreaChanges`；型別名單加 `AreaBabycare, AreaChanges`；`./areaFormat` 的名單加 `babycareStatusText, type NearbyKind`。

(b) 在 `loadKindergartens` 的 `watch(...)` 之後加：
```ts
// 附近托嬰中心與附近園所的變化（2026-10-14 規格 7）：半徑跟附近幼兒園同一個；換校區或半徑都先清空再讀、
// 只採用最後一次的回應。兩份各自成敗，互不牽連。
const nearbyKind = ref<NearbyKind>('kindergarten')
const babycare = ref<AreaBabycare | null>(null)
const babycareFailed = ref(false)
const babycareRequests = useRequestSequence()
async function loadBabycare() {
  const request = babycareRequests.begin()
  babycare.value = null
  babycareFailed.value = false
  if (!props.campusKey) return
  try {
    const result = await getAreaBabycare(props.campusKey, radiusKm.value)
    if (babycareRequests.isCurrent(request)) babycare.value = result
  } catch {
    if (babycareRequests.isCurrent(request)) babycareFailed.value = true
  }
}
watch([() => props.campusKey, radiusKm], () => void loadBabycare(), { immediate: true })

const changes = ref<AreaChanges | null>(null)
const changesFailed = ref(false)
const changesRequests = useRequestSequence()
async function loadChanges() {
  const request = changesRequests.begin()
  changes.value = null
  changesFailed.value = false
  if (!props.campusKey) return
  try {
    const result = await getAreaChanges(props.campusKey, radiusKm.value)
    if (changesRequests.isCurrent(request)) changes.value = result
  } catch {
    if (changesRequests.isCurrent(request)) changesFailed.value = true
  }
}
watch([() => props.campusKey, radiusKm], () => void loadChanges(), { immediate: true })
```

(c) 地圖 ref 與 focus：
```ts
const map = ref<{ focusKindergarten: (id: string) => void; focusBabycare: (id: string) => void; revealBabycare: () => void } | null>(null)
function focusKindergarten(id: string) {
  map.value?.focusKindergarten(id)
}
function focusBabycare(id: string) {
  map.value?.focusBabycare(id)
}
// 卡片切到托嬰中心就打開地圖上的托嬰圖層（預設不勾，維持現有畫面）。
watch(nearbyKind, (kind) => {
  if (kind === 'babycare') map.value?.revealBabycare()
})
```
（取代原本的 `const map = ref<{ focusKindergarten ... }>` 與 `focusKindergarten` 定義。）

(d) `status` 的回傳加一行 `babycare: babycareStatusText(dataStatus.babycare_synced_at),`（放在 `kindergarten` 之後）。

(e) 範本：
- 狀態列那一行 `{{ status.kindergarten }}・{{ status.population }}` 改成 `{{ status.kindergarten }}・{{ status.babycare }}・{{ status.population }}`。
- `<AreaMap ... :kindergartens="kindergartens?.items ?? []"` 之後加 `:babycare="babycare?.items ?? []"`。
- 把整個 `<NearbyKindergartens ... />` 換成：
```html
        <div class="area-top__side">
          <NearbyPanel
            v-model:kind="nearbyKind"
            v-model:radius-km="radiusKm"
            :kindergartens="kindergartens"
            :kindergartens-failed="kindergartensFailed"
            :babycare="babycare"
            :babycare-failed="babycareFailed"
            @select-kindergarten="focusKindergarten"
            @select-babycare="focusBabycare"
            @retry-kindergartens="loadKindergartens()"
            @retry-babycare="loadBabycare()"
          />
          <ProviderChanges :data="changes" :failed="changesFailed" :radius-km="radiusKm" @retry="loadChanges()" />
        </div>
```

(f) 樣式：在 `.area-top > * { min-width: 0; }` 之後加
```css
.area-top__side {
  display: grid;
  align-content: start;
  gap: 16px;
  min-width: 0;
}
```
檔頭說明註解補「2026-10-14：右欄多托嬰中心切換與『附近園所的變化』」。

- [ ] **Step 7: 跑測試與型別檢查**

```bash
npx vitest run src/__tests__/nearbyProviders.test.ts src/__tests__/areaMap.test.ts src/__tests__/areaTab.test.ts src/__tests__/areaFormat.test.ts
npm run typecheck
```
Expected：全部 PASS、型別檢查無錯誤輸出。若 `areaTab.test.ts` 其他測試因 DOM 多了切換鈕而斷言數量（例如 `.el-radio-button` 的總數、`.nearby` 的選取範圍）失敗，只調整那條斷言的選取範圍到 `.nearby .el-radio-button`，不要改元件去遷就。`typeScale.test.ts`（字級守門）也要跑：`npx vitest run src/__tests__/typeScale.test.ts`，新元件只用 `--text-*` token，不寫 px。

- [ ] **Step 8: Commit**

```bash
cd ~/Repositories/ivy-website-wt/provider-changes-20261014
git add admin/src/components/admissions/area/NearbyBabycare.vue admin/src/components/admissions/area/ProviderChanges.vue admin/src/components/admissions/area/NearbyPanel.vue admin/src/components/admissions/area/AreaMap.vue admin/src/components/admissions/area/AreaTab.vue admin/src/style.css admin/src/__tests__/nearbyProviders.test.ts admin/src/__tests__/areaMap.test.ts admin/src/__tests__/areaTab.test.ts
git commit -m "feat(admin): 附近托嬰中心清單與地圖圖層、附近園所的變化區塊

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: e2e、文件與驗證紀錄

**Files:**
- Create: `tests/stack/fixtures/geo-babycare.json`
- Modify: `tests/stack/start-api.sh`、`tests/stack/db.ts`、`tests/stack/admissions-area.spec.ts`
- Modify: `README.md`、`DESIGN.md`、`deploy/README.md`、`contracts/ivy-recruitment/README.md`、`docs/specs/2026-10-08-admissions-area-design.md`

**Interfaces:**
- Consumes：Task 1–7。
- Produces：`db.seedProviderChanges(): void`（直接寫 e2e 測試庫：一筆已停辦的托嬰＋停辦事件、一所設立日 40 天前的幼兒園）。

- [ ] **Step 1: e2e 的托嬰樣本與啟動腳本**

建立 `tests/stack/fixtures/geo-babycare.json`（崇德校 3 公里內 3 所：兩所在 1 公里內、一所在 1–3 公里；3–6 公里一所；一所停業；一所別的縣市。距崇德約 0.2／0.2／1.5／4.1 公里）：

```json
{"type": "FeatureCollection", "features": [
{"type": "Feature", "properties": {"id": "e2e-bc-near", "name": "高雄市私立測試甲托嬰中心", "city": "高雄市", "address": "813高雄市左營區測試路1號", "phone": "07-1111111", "capacity": 30, "status": 24, "is_active": true}, "geometry": {"type": "Point", "coordinates": [120.3085, 22.6745]}},
{"type": "Feature", "properties": {"id": "e2e-bc-home", "name": "高雄市政府社會局委託測試單位辦理高雄市測試社區公共托育家園", "city": "高雄市", "address": "813高雄市左營區測試路2號", "phone": "07-2222222", "capacity": 12, "status": 12, "is_active": true}, "geometry": {"type": "Point", "coordinates": [120.3105, 22.6765]}},
{"type": "Feature", "properties": {"id": "e2e-bc-mid", "name": "高雄市私立測試乙托嬰中心", "city": "高雄市", "address": "813高雄市左營區測試路3號", "phone": "07-3333333", "capacity": 40, "status": 20, "is_active": true}, "geometry": {"type": "Point", "coordinates": [120.315, 22.685]}},
{"type": "Feature", "properties": {"id": "e2e-bc-far", "name": "高雄市私立測試丙托嬰中心", "city": "高雄市", "address": "813高雄市左營區測試路4號", "phone": "07-4444444", "capacity": 25, "status": 10, "is_active": true}, "geometry": {"type": "Point", "coordinates": [120.3, 22.71]}},
{"type": "Feature", "properties": {"id": "e2e-bc-closed", "name": "高雄市私立測試已停業托嬰中心", "city": "高雄市", "address": "813高雄市左營區測試路5號", "phone": "07-5555555", "capacity": 20, "status": 0, "is_active": false}, "geometry": {"type": "Point", "coordinates": [120.3085, 22.6745]}},
{"type": "Feature", "properties": {"id": "e2e-bc-tainan", "name": "臺南市私立測試丁托嬰中心", "city": "臺南市", "address": "700臺南市中西區測試路6號", "phone": "06-6666666", "capacity": 20, "status": 20, "is_active": true}, "geometry": {"type": "Point", "coordinates": [120.2167, 22.9997]}}
]}
```

`tests/stack/start-api.sh` 的 `geo-sync` 指令（`--kindergartens-file ... \` 那行之後）加一行 `--babycare-file ../tests/stack/fixtures/geo-babycare.json \`，並把上方註解「匯入 stack 專用的門牌與幼兒園樣本」改成「門牌、幼兒園與托嬰樣本」；`unset WEBSITE_GEO_AUTO_SYNC WEBSITE_GEO_DOORPLATE_URL WEBSITE_GEO_KINDERGARTENS_URL` 補上 `WEBSITE_GEO_BABYCARE_URL`。

- [ ] **Step 2: `db.ts` 加測試前置**

在 `tests/stack/db.ts` 檔尾加：

```ts
/**
 * 附近園所的變化（2026-10-14）：同步一次只會建立基準，不會有異動；要看有內容的畫面只能直接寫測試庫。
 * 寫三件事（重複執行不會重複）：一所已停辦的托嬰（5 天前的停辦事件）、崇德校附近一所幼兒園設立日改成 40 天前
 * （新設看設立日，不靠事件）。座標在崇德校 1 公里內。
 */
export function seedProviderChanges(): void {
  psql(
    `INSERT INTO geo_babycare (source_id, name, kind, address, lat, lng, approved_capacity, enrolled, phone, is_active, synced_at)
     VALUES ('e2e-bc-gone', '高雄市私立測試已停辦托嬰中心', 'center', '高雄市左營區測試路9號', 22.6745, 120.3085, 30, 0, NULL, false, now())
     ON CONFLICT (source_id) DO NOTHING;
     INSERT INTO geo_provider_events (provider, source_id, change, occurred_on)
     VALUES ('babycare', 'e2e-bc-gone', 'closed', (now() AT TIME ZONE 'Asia/Taipei')::date - 5)
     ON CONFLICT DO NOTHING;
     UPDATE geo_kindergartens
        SET registered_on = (now() AT TIME ZONE 'Asia/Taipei')::date - 40
      WHERE source_id = 'e2e-kg-quasi';`,
    {},
  )
}
```

- [ ] **Step 3: 寫 e2e**

在 `tests/stack/admissions-area.spec.ts`：檔頭 import 補 `import AxeBuilder from '@axe-core/playwright'` 與 `import { seedProviderChanges } from './db'`，在 `'390px：地圖手機預設不攔單指…'` 那個測試之前新增：

```ts
// 托嬰中心與園所變化（2026-10-14 規格 7）：start-api.sh 匯入 stack 專用的托嬰樣本（崇德校 3 公里內 3 所、
// 3–6 公里 1 所）。同步只會建立基準、不會有異動，所以空狀態先看，再用 db.ts 寫入異動看有內容的畫面。
test('托嬰中心與園所變化：切換名單、地圖圖層、變化區塊', async ({ browser }) => {
  test.setTimeout(90_000)
  mkdirSync(SHOTS, { recursive: true })
  const { context, page } = await openAs(browser, 'super_admin')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openArea(page)
  const changes = page.locator('.changes')

  await test.step('預設是幼兒園清單，托嬰圖層沒有打開；變化區塊是空的並說明從哪天起記錄', async () => {
    await expect(page.locator('.nearby .nearby__title')).toHaveText('附近幼兒園')
    await expect(page.locator('.nearby--babycare')).toHaveCount(0)
    await expect(page.locator('.area-map .area-bc')).toHaveCount(0)
    await expect(changes.locator('.changes__title')).toHaveText('附近園所的變化')
    await expect(changes.locator('.changes__empty')).toHaveText('近 12 個月，3 公里內沒有新設、停辦或類型變動的園所。')
    await expect(changes.locator('.changes__note')).toHaveText(/^停辦與類型變動從 \d+ 月 \d+ 日起記錄；新設的幼兒園以設立日為準。$/)
  })

  await test.step('切到托嬰中心：3 公里內 3 所、總結、地圖自動出現菱形標點', async () => {
    await page.locator('.nearby-panel .el-radio-button', { hasText: '托嬰中心' }).click()
    const list = page.locator('.nearby--babycare')
    await expect(list.locator('.nearby__title')).toHaveText('附近托嬰中心')
    await expect(list.locator('.nearby__item')).toHaveCount(3)
    await expect(list.locator('.nearby__summary')).toHaveText('3 公里內托嬰中心 3 所，核定 82 位，實際收托 56 位。')
    await expect(list).toContainText('托育家園')
    await expect(list).not.toContainText('已停業')
    await expect(list).not.toContainText('測試丁')
    await expect(page.locator('.area-map .area-bc')).toHaveCount(3)
    await expect(page.locator('.area-legend[aria-label="托嬰中心圖例"]')).toContainText('托嬰中心與托育家園')
  })

  await test.step('換 6 公里多一所；點一列展開地址與電話並打開地圖資訊', async () => {
    const list = page.locator('.nearby--babycare')
    await list.locator('.el-radio-button', { hasText: '6 公里' }).click()
    await expect(list.locator('.nearby__item')).toHaveCount(4)
    await expect(list.locator('.nearby__summary')).toContainText('6 公里內托嬰中心 4 所')
    await list.locator('.nearby__row').first().click()
    await expect(list.locator('.nearby__detail')).toContainText('高雄市左營區測試路1號')
    await expect(list.locator('.nearby__detail')).toContainText('07-1111111')
    await expect(page.locator('.leaflet-popup')).toContainText('測試甲托嬰中心')
  })

  await test.step('勾掉地圖上的托嬰圖層，標點消失；切回幼兒園清單', async () => {
    await page.locator('.el-switch', { hasText: '托嬰中心' }).click()
    await expect(page.locator('.area-map .area-bc')).toHaveCount(0)
    await page.locator('.nearby-panel .el-radio-button', { hasText: '幼兒園' }).click()
    await expect(page.locator('.nearby .nearby__title')).toHaveText('附近幼兒園')
    await expect(page.locator('.nearby--babycare')).toHaveCount(0)
  })

  seedProviderChanges()
  await test.step('寫入異動後重新整理：停辦的托嬰與設立日在 40 天前的幼兒園，新到舊', async () => {
    await page.reload()
    await expect(page.locator('.area-map .leaflet-container')).toBeVisible()
    const rows = page.locator('.changes .changes__item')
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText('停辦')
    await expect(rows.nth(0)).toContainText('托嬰')
    await expect(rows.nth(0)).toContainText('測試已停辦托嬰中心')
    await expect(rows.nth(0)).toContainText('起不在名單')
    await expect(rows.nth(1)).toContainText('新設')
    await expect(rows.nth(1)).toContainText('幼兒園')
    await expect(rows.nth(1)).toContainText('測試乙幼兒園')
    await expect(rows.nth(1)).toContainText('設立日')
    await expect(page.locator('.changes .changes__empty')).toHaveCount(0)
  })

  await test.step('新區塊沒有 serious／critical 的無障礙問題', async () => {
    const results = await new AxeBuilder({ page }).include('.area-top__side').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    const serious = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    expect(serious.map((violation) => `${violation.id}：${violation.nodes.map((node) => node.target.join(' ')).join('；')}`)).toEqual([])
  })

  await page.screenshot({ path: path.join(SHOTS, 'admissions-provider-changes-1440.png'), fullPage: true })
  expect(errors, '頁面不該有未處理的錯誤').toEqual([])
  await context.close()
})

test('390px：托嬰中心清單與園所變化不撐出頁面', async ({ browser }) => {
  mkdirSync(SHOTS, { recursive: true })
  const { context, page } = await openAs(browser, 'super_admin', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await openArea(page)
  await page.locator('.nearby-panel .el-radio-button', { hasText: '托嬰中心' }).click()
  await expect(page.locator('.nearby--babycare .nearby__item').first()).toBeAttached()
  await expect(page.locator('.changes')).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: path.join(SHOTS, 'admissions-provider-changes-390.png'), fullPage: true })
  await context.close()
})
```

- [ ] **Step 4: 跑 e2e（只跑這個 spec 與 a11y 相關頁）**

```bash
cd ~/Repositories/ivy-website-wt/provider-changes-20261014
source ~/.nvm/nvm.sh; nvm use 22
E2E_DB_NAME=ivy_website_providerchg1014_e2e_test E2E_API_PORT=8741 E2E_WEB_PORT=3741 npm run e2e:build
E2E_DB_NAME=ivy_website_providerchg1014_e2e_test E2E_API_PORT=8741 E2E_WEB_PORT=3741 npx playwright test -c playwright.stack.config.ts tests/stack/admissions-area.spec.ts
```
Expected：該 spec 全過（含原有案例）。截圖在 `output/playwright/admissions-provider-changes-1440.png`／`-390.png`，開來看一眼：切換鈕在卡片頂端、變化區塊在卡片正下方、菱形標點與圖例、390px 沒有橫向捲動。
完整 stack 套件由主 session 另跑（會用到共用的每來源限流，單獨跑不能代表整套）。

- [ ] **Step 5: 文件回寫**

(a) `README.md` 最上方（第一個 `## 2026-10-13 深度掃描 14 項…` 之前）加：

```markdown
## 2026-10-14 托嬰中心與園所異動（`feature/provider-changes-20261014`）

招生判讀四個子專案的第二個（前一個是場次使用情況）。規格 `docs/specs/2026-10-14-provider-changes-design.md`，規則見 DESIGN.md「招生入學：托嬰中心與園所異動」。

- **托嬰名單**：kiang 每天整理的衛福部社家署公開資料（`babycare.json`，高雄 160 筆、營業 151），併進公開資料同步成為第四種資料（表 `geo_babycare`）。後台區域分析的「附近幼兒園」卡片頂端可切到「托嬰中心」，列出半徑內的托嬰中心與托育家園（核定、實際收托、距離），地圖多一個預設不勾的菱形圖層。
- **園所異動**：幼兒園與托嬰的同步從「刪光重寫」改成依 `source_id` 比對，停辦的標 `is_active` 假、列留著，新設、停辦、類型變動記在 `geo_provider_events`；卡片下方新增「附近園所的變化」（近 12 個月）。新設的幼兒園看設立日，上線第一輪同步後就有；停辦與類型變動從基準日（第一次用新程式同步成功的日子）才開始累積，畫面會寫「從 N 月 N 日起記錄」。
- **頻率**：幼兒園與托嬰改成每 7 天看一次來源（門牌、人口維持 30 天）。
- **防誤報**：8 月學年更替不產生假的類型變動；停辦後 30 天內又出現視為來源漏收；新名單營業中數量少於上次 80% 不換版（`geo-sync --force` 略過）。
- **migration** `c6a9e3f15d27`：新增 `geo_babycare`、`geo_provider_events`，`geo_kindergartens` 加設立日、`geo_dataset_status` 加基準日並多收 `babycare`；不改既有資料，不需要部署前備份。
- **不做**：核定人數與月費估算的異動、托嬰分配到里、收托比例與趨勢、預測、點變化列定位地圖、匯出 CSV。一年下來單一校 3 公里內新設或停辦大約各 0～1 件，所以變化區塊多數時候是空的。
```
（「驗證」那一條要等 Step 6 跑完才寫，見下。）

(b) `DESIGN.md` 在第 6 行 `# Design` 與其下第一個 `## ` 之間加：

```markdown
## 招生入學：托嬰中心與園所異動（2026-10-14，`feature/provider-changes-20261014`）

使用者 10-14 從招生判讀的四個候選選了第二項。規格 `docs/specs/2026-10-14-provider-changes-design.md`。以後要照著做的：

- **資料**：托嬰中心與公共托育家園來自 kiang 每日整理的衛福部社家署公開資料（`babycare.json`），欄位只有名稱、地址、座標、電話、核定人數、實際收托與是否營業。實際收托是官方回報、統計時點官方沒有說明，畫面只寫「實際收托（官方資料）」。併進既有的公開資料同步（第四種資料 `babycare`，表 `geo_babycare`），每 7 天看一次來源。
- **異動只有三種**：新設（幼兒園看設立日、近 12 個月，上線第一輪同步後就有；托嬰看基準日之後第一次出現）、停辦、類型變動（私立⇄準公共等，只有幼兒園）。**不做**核定人數變動與月費估算變動：月費是 kiang 推算的估計值，一年只有 6 所變、跨幅超過 1 萬元，多半是估算法改變，不是園所真的調價。
- **停辦怎麼知道**：同步從「刪光重寫」改成依 `source_id` 比對，名單裡不見的標停辦、列留著（`is_active` 假）；來源沒有停辦日，日期是我們同步到的那天。第一次同步只建立基準（`baseline_on`），畫面寫「從 N 月 N 日起記錄」。
- **防誤報**：類型變動用「這次同步當下的學年」重算舊類型，8 月學年更替不會冒出一批假異動；停辦後 30 天內又出現視為來源漏收、撤掉事件；新名單營業中數量少於上次 80% 不換版（`--force` 略過）。
- **畫面**：「附近幼兒園」卡片頂端切換「幼兒園／托嬰中心」，半徑共用；卡片正下方「附近園所的變化」（近 12 個月）；地圖多一個預設不勾的托嬰圖層，標點用菱形、顏色用新 token `--area-kind-babycare`（不只靠顏色分辨）。實測一年下來單一校 3 公里內新設或停辦大約各 0～1 件，大多數時候變化區塊是空的，那是資料的樣子。
- **不做**：托嬰分配到里（家長常在上班地點附近送托，托嬰所在的里不等於孩子住的里）、收托 ÷ 0–1 歲人口等比例（和已否決的飽和度同一類）、收托人數趨勢（一年內 138 所中 78 所的數字日常就在變）、預測、點變化列定位地圖、匯出 CSV、公開官網顯示。
```

(c) `deploy/README.md`「公開地理資料同步（招生區域分析）」這一章（用 `grep -n "公開地理資料同步" deploy/README.md` 找到章名那一行）：
- 第一段「需要三種公開資料：…與內政部各里人口（招生機會，2026-10-13，見下方「各里人口」）。」改成「需要四種公開資料：…、內政部各里人口（招生機會，2026-10-13，見下方「各里人口」）與托嬰中心名單（2026-10-14，見下方「托嬰名單與園所異動」）。」
- 「**四個環境變數**」改「**五個環境變數**」，表格在 `WEBSITE_GEO_KINDERGARTENS_URL` 那列之後加：
  `| `WEBSITE_GEO_BABYCARE_URL` | `https://kiang.github.io/ncwisweb.sfaa.gov.tw/babycare.json` | 托嬰名單（kiang 每日整理衛福部社家署公開資料，約 1.4MB）。必須是 `https://` |`
  並把 `WEBSITE_GEO_SYNC_CHECK_SECONDS` 那列「醒來後門牌、幼兒園各自距上次確認超過 30 天才真的去看來源」改成「醒來後門牌、各里人口距上次確認超過 30 天、幼兒園與托嬰超過 7 天才真的去看來源」。
- 手動退路的指令範例 `python -m app.cli geo-sync [--force] … [--kindergartens-file <JSON>] [--population-file <JSON> ...]` 在 `[--kindergartens-file <JSON>]` 後加 `[--babycare-file <JSON>]`。
- 在「**各里人口（招生機會，2026-10-13）**」那一段之後加一段：

```markdown
**托嬰名單與園所異動（2026-10-14）**：同一套同步多了第四種資料，給「區域分析」的托嬰清單與「附近園所的變化」用。規格 `docs/specs/2026-10-14-provider-changes-design.md` §4。

- 來源：`https://kiang.github.io/ncwisweb.sfaa.gov.tw/babycare.json`（kiang 每天用 GitHub Actions 整理，與幼兒園同一個 `kiang.github.io`，Railway 連得到；本機下載曾花 70 秒，正式站逾時預算 120 秒、整種資料上限 5 分鐘、檔案上限 8MB）。只留高雄市營業中的機構，寫進 `geo_babycare`。
- 自動：和門牌、幼兒園同一個背景迴圈與開關（`WEBSITE_GEO_AUTO_SYNC`）。**幼兒園與托嬰每 7 天看一次來源**（其他兩種仍是 30 天）；`geo_dataset_status.baseline_on` 還是空的（還沒用異動比對的程式同步過）也算到期，所以部署後第一輪背景同步就會補上幼兒園設立日、建立托嬰名單與基準日。
- 異動：同步不再刪光重寫，改成依 `source_id` 比對；名單裡不見的標停辦（`is_active` 假、列留著），新設、停辦、類型變動寫進 `geo_provider_events`。第一次同步只建立基準、不寫事件。停辦後 30 天內又出現的視為來源漏收，撤掉停辦事件。新名單營業中的數量少於上次的 80%（上次 ≥ 20 所才檢查）不換版，原因寫進 `last_error`；確定來源真的大幅縮減才用 `geo-sync --force`。
- 手動退路（正式站連不到時）：本機下載 `curl -sSLo babycare.json https://kiang.github.io/ncwisweb.sfaa.gov.tw/babycare.json`，上傳到 api volume 後 `python -m app.cli geo-sync --babycare-file /data/babycare.json`（刪檔用自己的終端機，agent 不能刪 volume 檔）。
- 看狀態：`select dataset, label, synced_at, baseline_on, last_error from geo_dataset_status where dataset in ('kindergartens', 'babycare');`；看異動：`select provider, change, occurred_on, count(*) from geo_provider_events group by 1, 2, 3 order by 3 desc limit 20;`。後台區域分析狀態列會寫「托嬰名單 MM/DD 更新」或「托嬰名單尚未匯入」。
- 回退：舊映像不認得新 revision，`check_schema.py` 會擋；要退先用新映像跑 `alembic downgrade b4d7e1a92c58`（刪新表與新欄位、約束改回，已記的異動一併消失）再切舊映像。
```
- 「**資料來源更新頻率**」那段「kiang 的幼兒園資料每日更新，官網每 30 天抓一次。」改成「kiang 的幼兒園與托嬰資料每日更新，官網每 7 天抓一次。」
- 「**結束碼 1**」那一條「門牌、幼兒園任一種同步失敗」改成「門牌、幼兒園、托嬰、各里人口任一種同步失敗」。

(d) `contracts/ivy-recruitment/README.md` 第 104 行：`` `geo_doorplates`、`geo_kindergartens`、`geo_dataset_status`，都不在轉移契約內 `` 改成 `` `geo_doorplates`、`geo_kindergartens`、`geo_dataset_status`，以及後來新增的 `geo_village_population`（2026-10-13）、`geo_babycare`、`geo_provider_events`（2026-10-14），都不在轉移契約內 ``。

(e) `docs/specs/2026-10-08-admissions-area-design.md` §3.2「本次不做」清單（第 52 行）之後加一條：

```markdown
- 托嬰中心與園所異動（新設、停辦、類型變動）：**2026-10-14 已做**（`docs/specs/2026-10-14-provider-changes-design.md`）；核定人數變動與月費估算變動仍不做。
```

- [ ] **Step 6: 子 session 自己的驗證（只跑自己動到的）並記錄**

```bash
# 後端（在 backend/）
PY pytest -q -p no:cacheprovider tests/test_geo_schema.py tests/test_geo_babycare.py tests/test_geo_kindergartens.py tests/test_geo_providers.py tests/test_geo_changes.py tests/test_geo_babycare_sync.py tests/test_geo_sync.py tests/test_geo_limits.py tests/test_geo_loop.py tests/test_geo_population.py tests/test_admissions_provider_area.py tests/test_admissions_area.py tests/test_admissions_visit_geo.py
# 後台（在 admin/）
npx vitest run src/__tests__/areaFormat.test.ts src/__tests__/areaTab.test.ts src/__tests__/areaMap.test.ts src/__tests__/nearbyProviders.test.ts src/__tests__/admissionsApi.test.ts src/__tests__/typeScale.test.ts
npm run typecheck
# 根目錄
npm run contract:check
```
然後在 README 剛加的那一段最後補一條 `- **驗證**：…`，只寫實際跑過的指令與通過數量，沒跑的（後端全套、admin 全套、完整 stack 套件由主 session 另跑）寫「尚未」，不要先宣稱通過。

- [ ] **Step 7: Commit**

```bash
cd ~/Repositories/ivy-website-wt/provider-changes-20261014
git add tests/stack/fixtures/geo-babycare.json tests/stack/start-api.sh tests/stack/db.ts tests/stack/admissions-area.spec.ts README.md DESIGN.md deploy/README.md contracts/ivy-recruitment/README.md docs/specs/2026-10-08-admissions-area-design.md
git commit -m "test(e2e): 托嬰中心與園所變化；文件記錄

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
