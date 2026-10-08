# 招生區域分析 B 階段：API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 訪視建立／改地址時寫入比對結果、匿名化清掉里與距離、新增 `/admin/admissions/area*` 三支只讀 API、訪視明細的區域篩選與 `geo` 欄位，並重產契約。

**Architecture:** `records.create_visit`／`update_visit` 在同交易內呼叫 A 階段的 `matcher.apply_visit_geo`，再把比對結果重讀掛回 `RecruitmentVisit.geo`（`lazy="selectin"` 的一對一 relationship，`RecruitmentVisitOut.geo` 直接讀它，列表不會 N+1）。新模組 `app/admissions/area.py` 以原始欄位 GROUP BY、Python 判斷層級，口徑沿用 `stats.py`。

**Tech Stack:** FastAPI 0.136.1、SQLAlchemy 2.0 async＋asyncpg、PostgreSQL、pytest＋pytest-asyncio、openapi-typescript。

**Spec:** `docs/specs/2026-10-08-admissions-area-design.md`（規格）；總覽 `docs/superpowers/plans/2026-10-08-admissions-area.md`（跨階段介面、Global Constraints、Review Focus 以總覽為準）。

## 前置閘

A 階段全部完成且 A 的驗證閘全綠（`tests/test_geo_*.py`、migration 上下、比對率報告）。開工前：

```bash
cd ~/Repositories/ivy-website-wt/admissions-area-20261008/backend
git log --oneline -5
WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_area1008_test uv run alembic upgrade head
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_area1008_test uv run pytest -q tests/test_geo_matcher.py
```

Expected：migration 到 head、比對測試全過。

## 對總覽的補充

1. **假設 A 提供的測試 helper**（`backend/tests/geo_helpers.py`；名稱若不同，執行 B 前由主 session 對齊）：
   ```python
   async def load_geo_samples(db: AsyncSession) -> None
       # 匯入 tests/fixtures/geo/ 的門牌與幼兒園樣本並設為 active（geo_dataset_status 兩列都有 synced_at）；可重複呼叫
   SAMPLE_ADDRESSES: dict[str, str]
       # "yihua_exact"：樣本內有完整門牌、在高雄市某區（比對結果 exact）
       # "yihua_nearby"：同街巷弄、號碼不在樣本（nearby）
       # "district_only"：高雄市區名對、街道不在樣本（district）
       # "outside"：外縣市（unlocated／outside_kaohsiung）
       # "ambiguous"：精確鍵對到兩個里（district／ambiguous_village）
   ```
2. **A 的 `geo/models.py` 不得 import `app.admissions.models`**：B1 在 `admissions/models.py` 檔尾匯入 geo models 以註冊 relationship 目標，反向匯入會循環。`RecruitmentVisitGeo` 不宣告指回 `RecruitmentVisit` 的 relationship（只有 `visit_id` 外鍵，`ON DELETE CASCADE`）。
3. **`RecruitmentVisitGeo` 欄位**照規格 §5.4：`visit_id`（PK）、`village`、`match_level`、`unlocated_reason`、`distance_m`、`doorplate_version`、`matched_at`；B 的測試直接建這個物件時五個非 PK 欄位都會給值。`GeoDatasetStatus` 至少有 `dataset`（PK）與 `synced_at`。
4. **B 新增的測試檔**（總覽檔案地圖只列了 `test_admissions_area.py`）：`backend/tests/admissions_area_helpers.py`、`backend/tests/test_admissions_visit_geo.py`。
5. **B 改到一個後台檔**：`admin/src/api/labels.ts` 加稽核 metadata 標籤 `area`（`labelCoverage.test.ts` 會掃 `download.records_audit_metadata` 回傳的鍵，不加會紅）。C 階段不要重複加。
6. `RecruitmentVisitOut.geo` 有預設值 `None`，契約裡是選填（`geo?: VisitGeoOut | null`），所以 B 重產契約後後台 typecheck 不會壞；C 再更新 `admissionsTestKit.ts`。

## 共用指令

後端測試（測試庫照總覽 Global Constraints）：

```bash
cd ~/Repositories/ivy-website-wt/admissions-area-20261008/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_area1008_test uv run pytest -q <檔案或 -k>
```

---

### Task B1: 訪視建立與改地址時寫入比對結果、回應帶 `geo`

**Files:**
- Modify: `backend/app/admissions/models.py:1-30`（import）、`:103-105`（district 註解）、`:155-167`（relationship）、檔尾（匯入 geo models）
- Modify: `backend/app/admissions/records.py:120-180`（`create_visit`）、`:219-246`（`update_visit`），新增 `_apply_geo`
- Modify: `backend/app/admissions/schemas.py:69-75`（docstring）、`:160-213`（`VisitGeoOut`、`RecruitmentVisitOut.geo`）
- Create: `backend/tests/test_admissions_visit_geo.py`

**Interfaces:**
- Consumes: `matcher.apply_visit_geo(db, visit) -> None`、`RecruitmentVisitGeo`、`tests.geo_helpers.load_geo_samples`、`SAMPLE_ADDRESSES`、`app.admissions.geo.address.parse_address`
- Produces: `RecruitmentVisit.geo: RecruitmentVisitGeo | None`（`lazy="selectin"`、`viewonly=True`）；`records._apply_geo(db, visit) -> None`；`schemas.VisitGeoOut`、`schemas.MatchLevel`、`schemas.UnlocatedReason`；`RecruitmentVisitOut.geo: VisitGeoOut | None = None`

- [ ] **Step 1: 寫失敗的測試**

Create `backend/tests/test_admissions_visit_geo.py`：

```python
"""招生訪視的區域比對結果（2026-10-08 區域分析規格 §5.4、§5.5、§6.1、§8.5、§10）：
建立與改地址時同交易比對、回應帶 geo、district 由伺服器填寫、匿名化清掉里與距離、
訪視明細的區域篩選。"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select, update

from app.admissions import retention
from app.admissions.geo.address import parse_address
from app.admissions.geo.models import RecruitmentVisitGeo
from app.admissions.models import RecruitmentVisit
from tests.admissions_helpers import ADMISSIONS, complete, create_record, started_booking
from tests.geo_helpers import SAMPLE_ADDRESSES, load_geo_samples


@pytest.fixture
async def geo_samples(db_session):
    await load_geo_samples(db_session)
    await db_session.commit()


async def _geo_row(db_session, visit_id: str) -> RecruitmentVisitGeo | None:
    return await db_session.scalar(
        select(RecruitmentVisitGeo)
        .where(RecruitmentVisitGeo.visit_id == uuid.UUID(visit_id))
        .execution_options(populate_existing=True)
    )


async def _patch(client, record: dict, **changes) -> dict:
    response = await client.patch(
        f"{ADMISSIONS}/records/{record['id']}", json={"expected_version": record["version"], **changes}
    )
    assert response.status_code == 200, response.text
    return response.json()


async def test_create_with_address_writes_village_and_district(admin_client, geo_samples):
    address = SAMPLE_ADDRESSES["yihua_exact"]
    record = await create_record(admin_client, address=address)
    assert record["geo"]["match_level"] == "exact"
    assert record["geo"]["village"]
    assert record["geo"]["unlocated_reason"] is None
    assert record["district"] == parse_address(address).district
    assert record["version"] == 1
    fetched = (await admin_client.get(f"{ADMISSIONS}/records/{record['id']}")).json()
    assert fetched["geo"] == record["geo"]


async def test_create_without_address_is_unlocated(admin_client, geo_samples):
    record = await create_record(admin_client)
    assert record["geo"] == {"village": None, "match_level": "unlocated", "unlocated_reason": "no_address", "distance_m": None}
    assert record["district"] is None


async def test_booking_arrival_writes_geo_row(admin_client, public_client, db_session, geo_samples):
    """標記已到場時建立的訪視也走 create_visit：沒有地址，比對結果是 no_address。"""
    booking = await started_booking(admin_client, public_client, db_session)
    done = await complete(admin_client, booking["id"])
    assert done.status_code == 200, done.text
    visit = await db_session.scalar(
        select(RecruitmentVisit)
        .where(RecruitmentVisit.visit_request_id == uuid.UUID(str(booking["id"])))
        .execution_options(populate_existing=True)
    )
    geo = await _geo_row(db_session, str(visit.id))
    assert geo is not None
    assert (geo.match_level, geo.unlocated_reason) == ("unlocated", "no_address")


async def test_editing_address_to_outside_clears_district_and_village(admin_client, geo_samples):
    """Review Focus 2：改到外縣市，舊的里與行政區不殘留；只加一次 version。"""
    record = await create_record(admin_client, address=SAMPLE_ADDRESSES["yihua_exact"])
    moved = await _patch(admin_client, record, address=SAMPLE_ADDRESSES["outside"])
    assert moved["version"] == 2
    assert moved["district"] is None
    assert moved["geo"] == {
        "village": None, "match_level": "unlocated", "unlocated_reason": "outside_kaohsiung", "distance_m": None,
    }


async def test_editing_address_to_blank_is_no_address(admin_client, geo_samples):
    """Review Focus 2：清空地址（空白字串在 schema 被清成 null）。"""
    record = await create_record(admin_client, address=SAMPLE_ADDRESSES["yihua_exact"])
    cleared = await _patch(admin_client, record, address="   ")
    assert cleared["address"] is None
    assert cleared["district"] is None
    assert cleared["geo"]["match_level"] == "unlocated"
    assert cleared["geo"]["unlocated_reason"] == "no_address"
    assert cleared["geo"]["village"] is None


async def test_editing_other_fields_keeps_geo(admin_client, db_session, geo_samples):
    record = await create_record(admin_client, address=SAMPLE_ADDRESSES["yihua_exact"])
    before = await _geo_row(db_session, record["id"])
    matched_at = before.matched_at
    updated = await _patch(admin_client, record, notes="家長想了解午睡")
    assert updated["geo"] == record["geo"]
    after = await _geo_row(db_session, record["id"])
    assert after.matched_at == matched_at


async def test_district_from_client_is_still_rejected(admin_client):
    response = await admin_client.post(
        f"{ADMISSIONS}/records?campus_key=yihua",
        json={
            "visit_date": "2026-09-08", "child_name": "王小明", "birthday": "2023-03-02",
            "target_school_year": 115, "target_semester": 1, "district": "三民區",
        },
    )
    assert response.status_code == 422
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_area1008_test uv run pytest -q tests/test_admissions_visit_geo.py`
Expected: FAIL，`KeyError: 'geo'`（回應還沒有 geo 欄位）；`test_district_from_client_is_still_rejected` PASS。

- [ ] **Step 3: `RecruitmentVisit.geo` relationship**

`backend/app/admissions/models.py`：在 `from typing` 之類的 import 區（檔頭 `from __future__ import annotations` 之後的標準庫 import）加入：

```python
from typing import TYPE_CHECKING
```

在 `from app.db import Base` 之後加入：

```python
if TYPE_CHECKING:
    from app.admissions.geo.models import RecruitmentVisitGeo
```

把 district 的註解：

```python
    # 本次不填、不顯示，保留給之後的區域分析。
    district: Mapped[str | None] = mapped_column(String(30), nullable=True)
```

改成：

```python
    # 行政區：伺服器依門牌比對填寫（2026-10-08 區域分析規格 §5.5），表單不收；匿名化時保留。
    district: Mapped[str | None] = mapped_column(String(30), nullable=True)
```

在 `contact_logs` relationship 之後（`class RecruitmentEventLog` 之前）加入：

```python
    # 區域分析的比對結果（2026-10-08 區域分析規格 §5.4），一對一，沒有比對過是 None。
    # async 不能 lazy load：查訪視時用 selectin 一起載入（列表多一次 IN 查詢，不會 N+1），
    # RecruitmentVisitOut.geo 直接讀這個屬性。只讀：寫入一律經 geo.matcher。
    geo: Mapped[RecruitmentVisitGeo | None] = relationship(
        "RecruitmentVisitGeo",
        primaryjoin="RecruitmentVisitGeo.visit_id == RecruitmentVisit.id",
        foreign_keys="RecruitmentVisitGeo.visit_id",
        uselist=False,
        lazy="selectin",
        viewonly=True,
    )
```

檔案最後一行之後加入：

```python


# relationship 目標要在 mapper 設定前註冊；放檔尾，geo.models 就算之後要匯入本檔也不會循環。
from app.admissions.geo import models as _geo_models  # noqa: E402,F401
```

- [ ] **Step 4: schema 加 `VisitGeoOut`、`RecruitmentVisitOut.geo`**

`backend/app/admissions/schemas.py`：`_VisitEditable` 的 docstring

```python
    """新增與編輯共用、表單可以直接填的欄位。預繳、註冊、退出、保留座位只能
    走狀態轉換與保留座位（規格 6.1 第 3 點、6.6），不在這裡。district、
    geocoding_consent_at 本次不填（規格 5.1），也不收。"""
```

改成：

```python
    """新增與編輯共用、表單可以直接填的欄位。預繳、註冊、退出、保留座位只能
    走狀態轉換與保留座位（規格 6.1 第 3 點、6.6），不在這裡。district 由伺服器依
    地址比對填寫（2026-10-08 區域分析規格 §5.5）、geocoding_consent_at 不填（規格 5.1），
    兩者都不收。"""
```

在 `class RecruitmentVisitOut(BaseModel):` 之前加入：

```python
# 區域分析（2026-10-08 規格 §5.4）：比對等級與未定位原因，與 app/admissions/geo/models.py 的
# MATCH_LEVELS、UNLOCATED_REASONS 相同。
MatchLevel = Literal["exact", "nearby", "street", "district", "unlocated", "pending"]
UnlocatedReason = Literal["no_address", "outside_kaohsiung", "no_doorplate", "ambiguous_village", "anonymized"]


class VisitGeoOut(BaseModel):
    """一筆訪視的區域比對結果（規格 §8.5）。不含家長座標；distance_m 是到本校的直線距離，
    取整到 100 公尺，只有比對到門牌（exact／nearby）且本校座標已知時才有。"""

    village: str | None
    match_level: MatchLevel
    unlocated_reason: UnlocatedReason | None
    distance_m: int | None

    model_config = {"from_attributes": True}
```

（`Literal` 已在 schemas.py 匯入；若沒有，加到 `from typing import` 那一行。）

`RecruitmentVisitOut` 在 `last_contacted_at: datetime | None` 之後加入：

```python
    # 區域分析（2026-10-08 規格 §8.5）：上線前的舊訪視在背景重算前是 None。
    geo: VisitGeoOut | None = None
```

- [ ] **Step 5: `records.py` 建立與改地址時比對**

`backend/app/admissions/records.py`：在 `def _now()` 之後加入：

```python
async def _apply_geo(db: AsyncSession, visit: RecruitmentVisit) -> None:
    """區域分析（2026-10-08 規格 §6.1）：依地址比對行政區與里，寫 recruitment_visit_geo
    並設定 district。只查資料庫、不呼叫外部服務、不加 version，也不丟例外（標記已到場
    的交易也會走到這裡）。matcher 可能用 Core upsert 寫入，identity map 裡已載入的舊
    比對結果不會自己更新，所以寫完重讀一次（populate_existing）掛回 visit.geo。"""
    from sqlalchemy.orm.attributes import set_committed_value

    from app.admissions.geo import matcher
    from app.admissions.geo.models import RecruitmentVisitGeo

    await matcher.apply_visit_geo(db, visit)
    await db.flush()
    geo = await db.scalar(
        select(RecruitmentVisitGeo)
        .where(RecruitmentVisitGeo.visit_id == visit.id)
        .execution_options(populate_existing=True)
    )
    set_committed_value(visit, "geo", geo)
```

`create_visit` 的結尾：

```python
    write_event(
        db, visit, event_type="created", from_stage=None, to_stage="visited",
        actor_user_id=actor_user_id,
        metadata={"origin": origin, "follow_up": "booking" if follow_up_at is not None else "none"},
    )
    await db.flush()
    return visit
```

改成：

```python
    write_event(
        db, visit, event_type="created", from_stage=None, to_stage="visited",
        actor_user_id=actor_user_id,
        metadata={"origin": origin, "follow_up": "booking" if follow_up_at is not None else "none"},
    )
    await db.flush()
    # 沒有地址也寫一列（no_address），區域分析的待比對只留給上線前的舊訪視。
    await _apply_geo(db, visit)
    return visit
```

`update_visit` 的結尾：

```python
    visit.version += 1
    visit.updated_at = _now()
    await db.flush()
    return changed
```

改成：

```python
    visit.version += 1
    visit.updated_at = _now()
    await db.flush()
    if "address" in changed:
        await _apply_geo(db, visit)
    return changed
```

（`select` 已在 records.py 匯入。matcher 用函式內匯入：本檔 docstring 說明 records 被 funnel 在模組層匯入，避免循環。）

- [ ] **Step 6: 跑測試確認通過**

Run: `cd backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_area1008_test uv run pytest -q tests/test_admissions_visit_geo.py tests/test_admissions_records.py tests/test_admissions_booking_link.py`
Expected: 全部 PASS。若出現 `MissingGreenlet`，表示某條路徑回傳了 `geo` 未載入的訪視：在該路由回傳前 `await db.refresh(visit, attribute_names=["geo"])`，並在本任務測試補一條覆蓋該路由的案例。

- [ ] **Step 7: Commit（使用者同意 commit 時）**

```bash
cd ~/Repositories/ivy-website-wt/admissions-area-20261008
git add backend/app/admissions/models.py backend/app/admissions/records.py backend/app/admissions/schemas.py backend/tests/test_admissions_visit_geo.py
git commit -m "$(cat <<'EOF'
feat(admissions): 訪視建立與改地址時比對區域，回應帶 geo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task B2: 匿名化清掉里與距離

**Files:**
- Modify: `backend/app/admissions/retention.py:40-90`（`anonymize_visit`、`anonymize_due`）
- Test: `backend/tests/test_admissions_visit_geo.py`（追加）

**Interfaces:**
- Consumes: `RecruitmentVisit.geo`（B1）、`retention.anonymize_due(db, days, *, now=None) -> int`（既有）
- Produces: 匿名化後 `RecruitmentVisitGeo`：`village=None`、`distance_m=None`、`match_level="district"`（`visit.district` 有值）或 `"unlocated"`、`unlocated_reason="anonymized"`；`visit.district` 保留

- [ ] **Step 1: 寫失敗的測試**

追加到 `backend/tests/test_admissions_visit_geo.py`：

```python
async def _age(db_session, visit_id: str, days: int) -> None:
    """把訪視的 updated_at 推到 days 天前，讓保存政策判定到期。"""
    await db_session.execute(
        update(RecruitmentVisit)
        .where(RecruitmentVisit.id == uuid.UUID(visit_id))
        .values(updated_at=datetime.now(timezone.utc) - timedelta(days=days))
    )
    await db_session.commit()


async def test_anonymize_keeps_district_and_clears_village(admin_client, db_session, geo_samples):
    """規格 §10：清掉里與距離，行政區保留（同園務、同既有行為）。"""
    address = SAMPLE_ADDRESSES["yihua_exact"]
    record = await create_record(admin_client, address=address)
    await _age(db_session, record["id"], 60)
    assert await retention.anonymize_due(db_session, 30) == 1
    await db_session.commit()
    visit = await db_session.scalar(
        select(RecruitmentVisit)
        .where(RecruitmentVisit.id == uuid.UUID(record["id"]))
        .execution_options(populate_existing=True)
    )
    assert visit.address is None
    assert visit.district == parse_address(address).district
    geo = await _geo_row(db_session, record["id"])
    assert (geo.village, geo.distance_m) == (None, None)
    assert (geo.match_level, geo.unlocated_reason) == ("district", "anonymized")


async def test_anonymize_without_district_is_unlocated(admin_client, db_session, geo_samples):
    record = await create_record(admin_client, address=SAMPLE_ADDRESSES["outside"])
    await _age(db_session, record["id"], 60)
    assert await retention.anonymize_due(db_session, 30) == 1
    await db_session.commit()
    geo = await _geo_row(db_session, record["id"])
    assert (geo.match_level, geo.unlocated_reason, geo.village) == ("unlocated", "anonymized", None)
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_area1008_test uv run pytest -q tests/test_admissions_visit_geo.py -k anonymize`
Expected: FAIL，`assert ('exact', None) == ('district', 'anonymized')`。

- [ ] **Step 3: 實作**

`backend/app/admissions/retention.py` 的 `anonymize_visit`，在

```python
    visit.follow_up_at = None
    visit.anonymized_at = datetime.now(timezone.utc)
    visit.version += 1
```

之前加入：

```python
    # 區域分析（2026-10-08 規格 §10）：里與距離跟著地址清掉，行政區保留（同園務）。
    # visit.geo 由 anonymize_due 的查詢一起載入；上線前就匿名化、沒有比對結果的訪視不用補。
    geo = visit.geo
    if geo is not None:
        geo.village = None
        geo.distance_m = None
        geo.match_level = "district" if visit.district else "unlocated"
        geo.unlocated_reason = "anonymized"
```

`anonymize_due` 的查詢選項：

```python
        .options(selectinload(RecruitmentVisit.events), selectinload(RecruitmentVisit.contact_logs))
```

改成：

```python
        .options(
            selectinload(RecruitmentVisit.events),
            selectinload(RecruitmentVisit.contact_logs),
            selectinload(RecruitmentVisit.geo),
        )
```

docstring `anonymize_visit` 第一行之後補一句：「區域比對結果的里與距離一併清掉，行政區保留。」完整 docstring：

```python
    """清掉一筆訪視的個資欄位、歷程原因與聯絡紀錄內容（events、contact_logs 是這筆
    訪視的歷程與聯絡紀錄）。區域比對結果的里與距離一併清掉，行政區保留。"""
```

- [ ] **Step 4: 跑測試確認通過**

Run: `cd backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_area1008_test uv run pytest -q tests/test_admissions_visit_geo.py tests/test_admissions_retention.py`
Expected: 全部 PASS。

- [ ] **Step 5: Commit（使用者同意 commit 時）**

```bash
git add backend/app/admissions/retention.py backend/tests/test_admissions_visit_geo.py
git commit -m "$(cat <<'EOF'
feat(admissions): 匿名化時清掉區域比對的里與距離，行政區保留

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task B3: 訪視明細的區域篩選

**Files:**
- Create: `backend/tests/admissions_area_helpers.py`
- Modify: `backend/app/admissions/records.py:255-350`（`RecruitmentVisitFilters`）
- Modify: `backend/app/admissions/download.py:177-194`（`records_audit_metadata`）
- Modify: `admin/src/api/labels.ts`（稽核 metadata 標籤 `area`）
- Test: `backend/tests/test_admissions_visit_geo.py`（追加）

**Interfaces:**
- Consumes: `RecruitmentVisit.geo`、`VILLAGE_LEVELS`、`RecruitmentVisitGeo`
- Produces: `GET /admin/admissions/records` 與 `/records/export` 的 query `district`、`village`、`geo=no_village`；`RecruitmentVisitFilters.district/.village/.geo`；稽核 metadata `area: "district" | "village" | "no_village"`；測試 helper `add_visit(...)`、`seed_area(db) -> dict[str, RecruitmentVisit]`、`AREA`、`NOW`

- [ ] **Step 1: 建測試 helper**

Create `backend/tests/admissions_area_helpers.py`：

```python
"""區域分析測試的直接寫入工具（2026-10-08 區域分析規格）：訪視與比對結果直接寫資料庫，
不經 API、不靠門牌樣本，才能精確控制每一層的筆數。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.academic import roc_month
from app.admissions.geo.models import RecruitmentVisitGeo
from app.admissions.models import RecruitmentVisit
from app.admissions.constants import ANONYMIZED_TEXT

API = "/api/website/v1"
AREA = f"{API}/admin/admissions/area"
NOW = datetime(2026, 10, 8, 4, 0, tzinfo=timezone.utc)
ADDRESS = "高雄市三民區測試路1號"


async def add_visit(
    db: AsyncSession,
    *,
    campus_key: str = "yihua",
    address: str | None = ADDRESS,
    district: str | None = None,
    has_deposit: bool = False,
    anonymized: bool = False,
    target_school_year: int = 115,
    target_semester: int = 1,
    visit_date: date = date(2026, 9, 1),
    geo: dict | None = None,
) -> RecruitmentVisit:
    """直接寫一筆訪視；geo 給 {"level", "village", "reason", "distance_m"} 時另寫一列比對結果。
    anonymized=True 時地址一律是 None（同保存政策清過的樣子）。"""
    visit = RecruitmentVisit(
        id=uuid.uuid4(),
        campus_key=campus_key,
        month=roc_month(visit_date),
        seq_no=None,
        visit_date=visit_date,
        child_name=ANONYMIZED_TEXT if anonymized else "測試幼生",
        address=None if anonymized else address,
        district=district,
        has_deposit=has_deposit,
        rides_bus=False,
        enrolled=False,
        transfer_term=False,
        target_school_year=target_school_year,
        target_semester=target_semester,
        anonymized_at=NOW if anonymized else None,
        version=1,
        created_at=NOW,
        updated_at=NOW,
    )
    db.add(visit)
    await db.flush()
    if geo is not None:
        db.add(
            RecruitmentVisitGeo(
                visit_id=visit.id,
                village=geo.get("village"),
                match_level=geo["level"],
                unlocated_reason=geo.get("reason"),
                distance_m=geo.get("distance_m"),
                doorplate_version="115-10",
                matched_at=NOW,
            )
        )
        await db.flush()
    return visit


async def seed_area(db: AsyncSession) -> dict[str, RecruitmentVisit]:
    """義華 115 學年上學期 11 筆（V1–V11）＋不該算進來的 2 筆（X1 明華、X2 114 學年）。

    | 代號 | 預繳 | 行政區 | 比對結果 | 層級 |
    |---|---|---|---|---|
    | V1 | 是 | 三民區 | exact 鼎金里 800 m | village |
    | V2 | 否 | 三民區 | nearby 鼎金里 1200 m | village |
    | V3 | 是 | 三民區 | street 寶業里 | village |
    | V4 | 否 | 左營區 | district（只到區） | district |
    | V5 | 否 | 三民區 | district／ambiguous_village | district |
    | V6 | 否 | — | unlocated／no_address（沒地址） | unlocated |
    | V7 | 否 | — | unlocated／outside_kaohsiung | unlocated |
    | V8 | 否 | — | pending | pending |
    | V9 | 否 | — | 沒有比對結果、有地址（上線前的舊訪視） | pending |
    | V10 | 否 | 三民區 | 已匿名化、沒有比對結果 | district／anonymized |
    | V11 | 否 | — | 已匿名化、unlocated／anonymized | unlocated／anonymized |
    """
    visits = {
        "V1": await add_visit(db, district="三民區", has_deposit=True,
                              geo={"level": "exact", "village": "鼎金里", "distance_m": 800}),
        "V2": await add_visit(db, district="三民區", geo={"level": "nearby", "village": "鼎金里", "distance_m": 1200}),
        "V3": await add_visit(db, district="三民區", has_deposit=True, geo={"level": "street", "village": "寶業里"}),
        "V4": await add_visit(db, district="左營區", geo={"level": "district"}),
        "V5": await add_visit(db, district="三民區", geo={"level": "district", "reason": "ambiguous_village"}),
        "V6": await add_visit(db, address=None, geo={"level": "unlocated", "reason": "no_address"}),
        "V7": await add_visit(db, address="臺北市大安區測試路1號", geo={"level": "unlocated", "reason": "outside_kaohsiung"}),
        "V8": await add_visit(db, geo={"level": "pending"}),
        "V9": await add_visit(db),
        "V10": await add_visit(db, district="三民區", anonymized=True),
        "V11": await add_visit(db, anonymized=True, geo={"level": "unlocated", "reason": "anonymized"}),
        "X1": await add_visit(db, campus_key="minghua", district="左營區",
                              geo={"level": "exact", "village": "明建里", "distance_m": 300}),
        "X2": await add_visit(db, target_school_year=114, district="三民區",
                              geo={"level": "exact", "village": "鼎金里", "distance_m": 300}),
    }
    return visits
```

- [ ] **Step 2: 寫失敗的測試**

追加到 `backend/tests/test_admissions_visit_geo.py`（檔頭 import 區加 `from tests.admissions_area_helpers import seed_area` 與 `from app.operations.models import AuditLogEntry`）：

```python
def _ids(rows: list[dict]) -> set[str]:
    return {row["id"] for row in rows}


def _expect(visits: dict, *keys: str) -> set[str]:
    return {str(visits[key].id) for key in keys}


async def _list(client, **params) -> list[dict]:
    query = "&".join(f"{key}={value}" for key, value in {"campus_key": "yihua", **params}.items())
    response = await client.get(f"{ADMISSIONS}/records?{query}&page_size=100")
    assert response.status_code == 200, response.text
    return response.json()


async def test_records_filter_by_district_and_village(admin_client, db_session):
    visits = await seed_area(db_session)
    await db_session.commit()
    assert _ids(await _list(admin_client, district="三民區")) == _expect(visits, "V1", "V2", "V3", "V5", "V10")
    assert _ids(await _list(admin_client, district="三民區", village="鼎金里")) == _expect(visits, "V1", "V2")
    # 里要比對到里才算：V5（里有歧義）、匿名化的 V10 不算。
    assert _ids(await _list(admin_client, village="寶業里")) == _expect(visits, "V3")


async def test_records_filter_no_village(admin_client, db_session):
    """未定位到里：只到區、未定位、待比對、沒有比對結果、已匿名化。"""
    visits = await seed_area(db_session)
    await db_session.commit()
    rows = await _list(admin_client, geo="no_village")
    assert _ids(rows) == _expect(visits, "V4", "V5", "V6", "V7", "V8", "V9", "V10", "V11")


async def test_records_list_carries_geo(admin_client, db_session):
    visits = await seed_area(db_session)
    await db_session.commit()
    by_id = {row["id"]: row for row in await _list(admin_client)}
    assert by_id[str(visits["V1"].id)]["geo"] == {
        "village": "鼎金里", "match_level": "exact", "unlocated_reason": None, "distance_m": 800,
    }
    assert by_id[str(visits["V9"].id)]["geo"] is None


async def test_records_filter_rejects_unknown_geo_value(admin_client):
    response = await admin_client.get(f"{ADMISSIONS}/records?campus_key=yihua&geo=somewhere")
    assert response.status_code == 422


async def test_records_export_audits_area_filter_category(admin_client, db_session):
    """匯出稽核只記篩了哪一種區域，不記區名（同其他篩選只記類別的做法）。"""
    await seed_area(db_session)
    await db_session.commit()
    response = await admin_client.get(f"{ADMISSIONS}/records/export?campus_key=yihua&district=三民區&village=鼎金里")
    assert response.status_code == 200, response.text
    entry = await db_session.scalar(
        select(AuditLogEntry)
        .where(AuditLogEntry.action == "recruitment_visit.export")
        .order_by(AuditLogEntry.created_at.desc())
    )
    assert entry.metadata_json["area"] == "village"
    assert "三民區" not in str(entry.metadata_json)
```

（`AuditLogEntry` 的 metadata 欄位名以 `backend/app/operations/models.py` 為準；若不是 `metadata_json`，照 `tests/test_admissions_download.py` 讀稽核的寫法改。admin_client 是總管理者，有匯出個資授權。）

- [ ] **Step 3: 跑測試確認失敗**

Run: `cd backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_area1008_test uv run pytest -q tests/test_admissions_visit_geo.py -k "records"`
Expected: FAIL：篩選被忽略，`district=三民區` 回 11 筆；`geo=somewhere` 回 200。

- [ ] **Step 4: 實作篩選**

`backend/app/admissions/records.py`：在 `_NoDepositReason = ...` 那一行之後加入：

```python
_GeoFilter = Literal["no_village"]
```

`RecruitmentVisitFilters.__init__` 的參數，在 `owner: str | None = Query(...)` 之後加入：

```python
        district: str | None = Query(default=None, max_length=30, description="行政區（2026-10-08 區域分析）"),
        village: str | None = Query(default=None, max_length=16, description="里；只算比對到里的訪視"),
        geo: _GeoFilter | None = Query(
            default=None, description="no_village：未定位到里（只到區、未定位、待比對、已匿名化）"
        ),
```

`__init__` 本體 `self.owner = owner` 之後加入：

```python
        self.district = district
        self.village = village
        self.geo = geo
```

`apply()` 在 `if self.q:` 之前加入：

```python
        if self.district or self.village or self.geo:
            stmt = self._apply_area(stmt)
```

並在 `apply()` 之後新增方法：

```python
    def _apply_area(self, stmt):
        """區域篩選（2026-10-08 區域分析規格 §8.4）。層級判斷同 area.py：里要比對到里
        （exact／nearby／street）且未匿名化才算；其餘都是「未定位到里」。"""
        from app.admissions.geo.models import VILLAGE_LEVELS, RecruitmentVisitGeo

        at_village = RecruitmentVisit.geo.has(RecruitmentVisitGeo.match_level.in_(VILLAGE_LEVELS))
        if self.district:
            stmt = stmt.where(RecruitmentVisit.district == self.district)
        if self.village:
            stmt = stmt.where(
                RecruitmentVisit.anonymized_at.is_(None),
                RecruitmentVisit.geo.has(
                    (RecruitmentVisitGeo.village == self.village)
                    & RecruitmentVisitGeo.match_level.in_(VILLAGE_LEVELS)
                ),
            )
        if self.geo == "no_village":
            stmt = stmt.where(or_(~at_village, RecruitmentVisit.anonymized_at.is_not(None)))
        return stmt
```

- [ ] **Step 5: 匯出稽核記類別**

`backend/app/admissions/download.py` 的 `records_audit_metadata`，在 `"owner": ...` 那一行之後加入：

```python
        # 區域只記篩了哪一種（2026-10-08），不記區名與里名。
        "area": "no_village" if filters.geo else ("village" if filters.village else ("district" if filters.district else None)),
```

`admin/src/api/labels.ts`：在

```ts
  cold_only: (v) => (v ? '只匯出冷名單' : null),
```

之後加入：

```ts
  area: (v) => `篩選區域：${({ district: '指定行政區', village: '指定里', no_village: '未定位到里' } as Record<string, string>)[String(v)] ?? String(v)}`,
```

- [ ] **Step 6: 跑測試確認通過**

Run: `cd backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_area1008_test uv run pytest -q tests/test_admissions_visit_geo.py tests/test_admissions_records.py tests/test_admissions_download.py`
Expected: 全部 PASS。

Run: `cd ~/Repositories/ivy-website-wt/admissions-area-20261008; source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm --prefix admin ci; npm --prefix admin run test:unit -- labelCoverage labels`
Expected: PASS（`admin/node_modules` 已存在就跳過 `npm ci`）。

- [ ] **Step 7: Commit（使用者同意 commit 時）**

```bash
git add backend/app/admissions/records.py backend/app/admissions/download.py backend/tests/admissions_area_helpers.py backend/tests/test_admissions_visit_geo.py admin/src/api/labels.ts
git commit -m "$(cat <<'EOF'
feat(admissions): 訪視明細可依行政區、里與未定位到里篩選

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task B4: `GET /admin/admissions/area`

**Files:**
- Create: `backend/app/admissions/area.py`
- Modify: `backend/app/admissions/schemas.py`（檔尾加區域分析 schema）
- Modify: `backend/app/admissions/routes.py:16`（import）、`:23-45`（schema import）、`/compare` 之後（新路由）
- Create: `backend/tests/test_admissions_area.py`

**Interfaces:**
- Consumes: `stats._base_filters`、`stats._count_columns`、`stats.pct`；`matcher.campus_point`、`matcher.doorplate_label`；`boundaries.village_code`、`boundaries.BOUNDARY_VERSION`；`GeoDatasetStatus`、`RecruitmentVisitGeo`、`VILLAGE_LEVELS`；B3 的 `seed_area`、`AREA`
- Produces: `area.query_area(db, campus_key, *, school_year, semester, now=None) -> dict`、`area.campus_out(db, campus_key) -> dict`、`area.distance_band(distance_m) -> str`、`area.DISTANCE_BANDS`、`area.REASON_ORDER`；schema `AdmissionsAreaOut`、`AreaFiltersOut`、`AreaDataStatusOut`、`AreaCampusOut`、`AreaReasonCountOut`、`AreaTotalsOut`、`AreaDistrictRowOut`、`AreaVillageRowOut`、`AreaDistanceBandOut`

- [ ] **Step 1: 寫失敗的測試**

Create `backend/tests/test_admissions_area.py`：

```python
"""招生區域分析 API（2026-10-08 區域分析規格 §8）：層級與口徑、與 /stats 一致、權限、
開關、校區未定位、幼兒園、里界。"""

from __future__ import annotations

import pytest

from app.admissions import area
from app.admissions.geo import matcher
from app.main import create_app
from tests.admissions_area_helpers import AREA, API, seed_area
from tests.admissions_helpers import readonly_yihua_client, reception_yihua_client  # noqa: F401
from tests.conftest import _logged_in_client, _test_settings

TERM = "school_year=115&semester=1"


def _point(campus_key: str, lat: float | None, lng: float | None, error: str | None = None) -> matcher.CampusPoint:
    return matcher.CampusPoint(campus_key=campus_key, lat=lat, lng=lng, locate_error=error)


def test_distance_band_edges():
    assert [area.distance_band(m) for m in (None, 0, 999, 1000, 2999, 3000, 5999, 6000, 20000)] == [
        "none", "0-1", "0-1", "1-3", "1-3", "3-6", "3-6", "6+", "6+",
    ]


async def test_area_levels_rows_and_bands(admin_client, db_session):
    await seed_area(db_session)
    await db_session.commit()
    response = await admin_client.get(f"{AREA}?campus_key=yihua&{TERM}")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["filters"] == {"campus_key": "yihua", "school_year": 115, "semester": 1}
    assert body["totals"] == {
        "visit": 11,
        "with_address": 8,
        "village_level": 3,
        "district_level": 3,
        "unlocated": 3,
        "pending": 2,
        "unlocated_reasons": [
            {"reason": "no_address", "count": 1},
            {"reason": "outside_kaohsiung", "count": 1},
            {"reason": "ambiguous_village", "count": 1},
            {"reason": "anonymized", "count": 2},
        ],
    }
    assert body["districts"] == [
        {"district": "三民區", "visit": 5, "deposit": 2, "visit_to_deposit_rate": 40.0},
        {"district": "左營區", "visit": 1, "deposit": 0, "visit_to_deposit_rate": 0.0},
    ]
    villages = [(row["district"], row["village"], row["visit"], row["deposit"], row["visit_to_deposit_rate"])
                for row in body["villages"]]
    assert villages == [("三民區", "鼎金里", 2, 1, 50.0), ("三民區", "寶業里", 1, 1, 100.0)]
    assert body["villages"][0]["village_code"] == "64000050001"
    assert body["distance_bands"] == [
        {"band": "0-1", "visit": 1, "deposit": 1, "visit_to_deposit_rate": 100.0},
        {"band": "1-3", "visit": 1, "deposit": 0, "visit_to_deposit_rate": 0.0},
        {"band": "3-6", "visit": 0, "deposit": 0, "visit_to_deposit_rate": None},
        {"band": "6+", "visit": 0, "deposit": 0, "visit_to_deposit_rate": None},
        {"band": "none", "visit": 9, "deposit": 1, "visit_to_deposit_rate": 11.1},
    ]
    assert body["data_status"]["boundary_version"]
    assert body["data_status"]["doorplate_version"] is None  # 這個測試沒匯入門牌樣本


async def test_area_data_status_reads_doorplate_label(admin_client, db_session):
    """畫面顯示門牌月份（geo_dataset_status.label），不是內部批次標記 active_version。"""
    from tests.geo_helpers import SAMPLE_LABEL, load_geo_samples

    await load_geo_samples(db_session)
    body = (await admin_client.get(f"{AREA}?campus_key=yihua&{TERM}")).json()
    assert body["data_status"]["doorplate_version"] == SAMPLE_LABEL == "115-10"
    assert body["data_status"]["doorplates_synced_at"] is not None
    assert body["data_status"]["kindergartens_synced_at"] is not None


async def test_area_counts_match_stats(admin_client, db_session):
    """參觀人數、預繳人數與 /stats 同口徑（同母體、同計數）。"""
    await seed_area(db_session)
    await db_session.commit()
    stats = (await admin_client.get(f"{API}/admin/admissions/stats?campus_key=yihua&{TERM}")).json()
    body = (await admin_client.get(f"{AREA}?campus_key=yihua&{TERM}")).json()
    assert body["totals"]["visit"] == stats["kpi"]["visit"]
    assert sum(band["visit"] for band in body["distance_bands"]) == stats["kpi"]["visit"]
    assert sum(band["deposit"] for band in body["distance_bands"]) == stats["kpi"]["deposit"]


async def test_area_without_term_counts_every_year(admin_client, db_session):
    await seed_area(db_session)
    await db_session.commit()
    body = (await admin_client.get(f"{AREA}?campus_key=yihua")).json()
    assert body["totals"]["visit"] == 12  # V1–V11 加 114 學年的 X2；明華的 X1 不算


async def test_area_empty_campus(admin_client):
    body = (await admin_client.get(f"{AREA}?campus_key=chongde&{TERM}")).json()
    assert body["totals"]["visit"] == 0
    assert body["districts"] == [] and body["villages"] == []
    assert [band["visit"] for band in body["distance_bands"]] == [0, 0, 0, 0, 0]


async def test_area_campus_not_located(admin_client, db_session, monkeypatch):
    """Review Focus 4：校址比對不到時照常回 200，campus 帶原因，距離全部在 none。"""
    async def unlocated(db, campus_key):
        return _point(campus_key, None, None, "no_doorplate")

    monkeypatch.setattr(matcher, "campus_point", unlocated)
    await seed_area(db_session)
    await db_session.commit()
    body = (await admin_client.get(f"{AREA}?campus_key=yihua&{TERM}")).json()
    assert body["campus"]["key"] == "yihua"
    assert body["campus"]["name"]
    assert (body["campus"]["lat"], body["campus"]["lng"], body["campus"]["locate_error"]) == (None, None, "no_doorplate")


async def test_area_permissions(reception_yihua_client, readonly_yihua_client, minghua_client, editor_client, admin_client):
    path = f"{AREA}?campus_key="
    assert (await reception_yihua_client.get(path + "yihua")).status_code == 200
    assert (await reception_yihua_client.get(path + "minghua")).status_code == 404
    assert (await minghua_client.get(path + "yihua")).status_code == 404
    assert (await editor_client.get(path + "yihua")).status_code == 403
    assert (await readonly_yihua_client.get(path + "yihua")).status_code == 403
    assert (await admin_client.get(path + "nowhere")).status_code == 404


async def test_area_hidden_when_admissions_disabled(admin_client):
    disabled = create_app(_test_settings().model_copy(update={"admissions_enabled": False}))
    client = await _logged_in_client(disabled, "admin@ivy.example", "super-admin-password-123")
    try:
        for path in (f"{AREA}?campus_key=yihua", f"{AREA}/kindergartens?campus_key=yihua", f"{AREA}/boundaries"):
            response = await client.get(path)
            assert response.status_code == 404, (path, response.text)
    finally:
        await client.aclose()
        await disabled.state.engine.dispose()
        await disabled.state.rate_limit_engine.dispose()
```

（`admin_client` 參數在 disabled 測試裡只是為了先建好總管理者帳號，同 `test_admissions_booking_link.py::test_admissions_disabled_skips_visit_and_hides_endpoints`。`test_area_hidden_when_admissions_disabled` 的 kindergartens／boundaries 兩條在 B5 完成前也會是 404，本任務就會過。）

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_area1008_test uv run pytest -q tests/test_admissions_area.py`
Expected: FAIL，`ModuleNotFoundError: No module named 'app.admissions.area'`。

- [ ] **Step 3: schema**

`backend/app/admissions/schemas.py` 檔尾加入：

```python
# ---- 區域分析（2026-10-08 區域分析規格 §8）----

DistanceBandKey = Literal["0-1", "1-3", "3-6", "6+", "none"]
KindergartenKind = Literal["public", "nonprofit", "quasi_public", "private"]


class AreaFiltersOut(BaseModel):
    campus_key: str
    school_year: int | None
    semester: int | None


class AreaDataStatusOut(BaseModel):
    """公開資料的版本：門牌（民國年-月，例 115-10；還沒匯入是 null）、幼兒園更新時間、里界版本。"""

    doorplate_version: str | None
    doorplates_synced_at: datetime | None
    kindergartens_synced_at: datetime | None
    boundary_version: str


class AreaCampusOut(BaseModel):
    key: str
    name: str
    lat: float | None
    lng: float | None
    # 校址比對不到門牌的原因（no_address／no_doorplate／pending）；有座標時是 null。
    locate_error: str | None


class AreaReasonCountOut(BaseModel):
    reason: UnlocatedReason
    count: int


class AreaTotalsOut(BaseModel):
    """visit＝village_level＋district_level＋unlocated＋pending。with_address 是目前有地址的
    筆數（已匿名化的地址已清掉，不算）。unlocated_reasons 只列筆數大於 0 的原因，依固定順序。"""

    visit: int
    with_address: int
    village_level: int
    district_level: int
    unlocated: int
    pending: int
    unlocated_reasons: list[AreaReasonCountOut]


class AreaDistrictRowOut(BaseModel):
    district: str
    visit: int
    deposit: int
    visit_to_deposit_rate: float | None


class AreaVillageRowOut(BaseModel):
    district: str
    village: str
    # 內政部村里代碼（11 碼），對照里界 GeoJSON 的 VILLCODE；對不到是 null。
    village_code: str | None
    visit: int
    deposit: int
    visit_to_deposit_rate: float | None


class AreaDistanceBandOut(BaseModel):
    band: DistanceBandKey
    visit: int
    deposit: int
    visit_to_deposit_rate: float | None


class AdmissionsAreaOut(BaseModel):
    as_of: datetime
    filters: AreaFiltersOut
    data_status: AreaDataStatusOut
    campus: AreaCampusOut
    totals: AreaTotalsOut
    # 有行政區的訪視依行政區分組（含只到區、已匿名化），參觀人數降冪、區名升冪。
    districts: list[AreaDistrictRowOut]
    # 比對到里的訪視依（行政區, 里）分組，參觀人數降冪。
    villages: list[AreaVillageRowOut]
    # 固定五列：0-1、1-3、3-6、6+、none。
    distance_bands: list[AreaDistanceBandOut]


class AreaKindergartenOut(BaseModel):
    source_id: str
    name: str
    kind: KindergartenKind
    pre_public_period: str | None
    address: str
    lat: float
    lng: float
    distance_m: int
    approved_capacity: int | None
    # kiang 依收費明細估算的月費，不是官方欄位。
    monthly_fee_estimate: int | None
    has_penalty: bool
    phone: str | None
    # 與任一校區座標相距 50 公尺內：畫面標「本機構」，不算競爭園所。
    is_own: bool


class AreaKindergartensOut(BaseModel):
    synced_at: datetime | None
    source_note: str
    campus: AreaCampusOut
    radius_km: int
    items: list[AreaKindergartenOut]
```

（`AreaKindergartenOut`／`AreaKindergartensOut` 在 B5 才用，一起放這裡。）

- [ ] **Step 4: `area.py`**

Create `backend/app/admissions/area.py`：

```python
"""招生區域分析（2026-10-08 區域分析規格 §8）：/admin/admissions/area 與 /area/kindergartens。

只讀：不 flush、不 commit、不寫稽核。回應只有聚合數字與公開園所資料，不含家長個資。
口徑沿用 stats.py：母體 _base_filters（校區＋入學學年學期），參觀人數＝筆數、預繳人數＝
has_deposit，預繳率 pct（分母 0 回 None）。

每筆訪視歸到一個層級（_level）：
- village：比對到里（exact／nearby／street）且未匿名化。
- district：只到區（含里有歧義）；已匿名化但還有行政區的也算這層（規格 §10）。
- unlocated：沒地址、外縣市、查無門牌；已匿名化又沒有行政區。
- pending：門牌還沒匯入，或上線前的舊訪視還沒重算（沒有比對結果、但有地址）。

SQL 只 GROUP BY 原始欄位與 IS NULL，層級在 Python 判斷（同 stats.py 檔頭：asyncpg
伺服器端參數會讓 GROUP BY 裡帶參數的運算式對不上 SELECT）。"""

from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.geo import boundaries, matcher
from app.admissions.geo import kindergartens as geo_kindergartens
from app.admissions.geo.models import VILLAGE_LEVELS, GeoDatasetStatus, RecruitmentVisitGeo
from app.admissions.geo.projection import haversine_m
from app.admissions.models import RecruitmentVisit
from app.admissions.stats import _base_filters, _count_columns, pct
from app.campuses.models import Campus

DISTANCE_BANDS = ("0-1", "1-3", "3-6", "6+", "none")
# 未定位原因的固定順序（畫面照這個順序列）。
REASON_ORDER = ("no_address", "outside_kaohsiung", "no_doorplate", "ambiguous_village", "anonymized")
RADIUS_CHOICES = (1, 3, 6)
# 與任一校區座標相距這個距離內的園所視為本機構（規格 §8.2）。
OWN_CAMPUS_RADIUS_M = 50
KINDERGARTEN_SOURCE_NOTE = "資料來源：全國教保資訊網（kiang 整理），月費為估計值"


def distance_band(distance_m: int | None) -> str:
    """直線距離分組（規格 §6.5）：剛好 1、3、6 公里算外面那一組。"""
    if distance_m is None:
        return "none"
    if distance_m < 1000:
        return "0-1"
    if distance_m < 3000:
        return "1-3"
    if distance_m < 6000:
        return "3-6"
    return "6+"


def _level(row: Any) -> tuple[str, str | None]:
    """(層級, 未定位原因)。row 帶 district、match_level、unlocated_reason、active、no_address。"""
    if not row.active:
        return ("district" if row.district else "unlocated"), "anonymized"
    if row.match_level is None:
        return ("unlocated", "no_address") if row.no_address else ("pending", None)
    if row.match_level in VILLAGE_LEVELS:
        return "village", None
    if row.match_level == "pending":
        return "pending", None
    return row.match_level, row.unlocated_reason


def _counter() -> dict[str, int]:
    return {"visit": 0, "deposit": 0}


def _add(bucket: dict[str, int], row: Any) -> None:
    bucket["visit"] += int(row.visit or 0)
    bucket["deposit"] += int(row.deposit or 0)


def _row(bucket: dict[str, int], **labels: Any) -> dict[str, Any]:
    return {
        **labels,
        "visit": bucket["visit"],
        "deposit": bucket["deposit"],
        "visit_to_deposit_rate": pct(bucket["deposit"], bucket["visit"]),
    }


async def campus_out(db: AsyncSession, campus_key: str) -> dict[str, Any]:
    campus = await db.get(Campus, campus_key)
    point = await matcher.campus_point(db, campus_key)
    return {
        "key": campus_key,
        "name": campus.name if campus is not None else campus_key,
        "lat": point.lat,
        "lng": point.lng,
        "locate_error": point.locate_error,
    }


async def _data_status(db: AsyncSession) -> dict[str, Any]:
    statuses = {status.dataset: status for status in (await db.execute(select(GeoDatasetStatus))).scalars()}
    doorplates = statuses.get("doorplates")
    kindergartens = statuses.get("kindergartens")
    return {
        # 畫面顯示月份「115-10」；active_version 是內部批次標記（A 階段定案）。
        "doorplate_version": await matcher.doorplate_label(db),
        "doorplates_synced_at": doorplates.synced_at if doorplates is not None else None,
        "kindergartens_synced_at": kindergartens.synced_at if kindergartens is not None else None,
        "boundary_version": boundaries.BOUNDARY_VERSION,
    }


async def query_area(
    db: AsyncSession,
    campus_key: str,
    *,
    school_year: int | None,
    semester: int | None,
    now: datetime | None = None,
) -> dict[str, Any]:
    v, g = RecruitmentVisit, RecruitmentVisitGeo
    active = v.anonymized_at.is_(None)
    no_address = v.address.is_(None)
    columns = (v.district, g.village, g.match_level, g.unlocated_reason, g.distance_m)
    stmt = (
        select(*columns, active.label("active"), no_address.label("no_address"), *_count_columns())
        .select_from(v)
        .outerjoin(g, g.visit_id == v.id)
        .where(*_base_filters(campus_key, school_year, semester))
        .group_by(*columns, active, no_address)
    )
    rows = list((await db.execute(stmt)).all())

    totals = {"visit": 0, "with_address": 0, "village": 0, "district": 0, "unlocated": 0, "pending": 0}
    reasons = dict.fromkeys(REASON_ORDER, 0)
    districts: dict[str, dict[str, int]] = {}
    villages: dict[tuple[str, str], dict[str, int]] = {}
    bands = {band: _counter() for band in DISTANCE_BANDS}
    for row in rows:
        count = int(row.visit or 0)
        level, reason = _level(row)
        totals["visit"] += count
        totals[level] += count
        if not row.no_address:
            totals["with_address"] += count
        if reason is not None:
            reasons[reason] += count
        if row.district:
            _add(districts.setdefault(row.district, _counter()), row)
        if level == "village" and row.district and row.village:
            _add(villages.setdefault((row.district, row.village), _counter()), row)
        _add(bands[distance_band(row.distance_m if row.active else None)], row)

    return {
        "as_of": now or datetime.now(timezone.utc),
        "filters": {"campus_key": campus_key, "school_year": school_year, "semester": semester},
        "data_status": await _data_status(db),
        "campus": await campus_out(db, campus_key),
        "totals": {
            "visit": totals["visit"],
            "with_address": totals["with_address"],
            "village_level": totals["village"],
            "district_level": totals["district"],
            "unlocated": totals["unlocated"],
            "pending": totals["pending"],
            "unlocated_reasons": [{"reason": reason, "count": count} for reason, count in reasons.items() if count],
        },
        "districts": [
            _row(bucket, district=name)
            for name, bucket in sorted(districts.items(), key=lambda item: (-item[1]["visit"], item[0]))
        ],
        "villages": [
            _row(bucket, district=district, village=village, village_code=boundaries.village_code(district, village))
            for (district, village), bucket in sorted(villages.items(), key=lambda item: (-item[1]["visit"], item[0]))
        ],
        "distance_bands": [_row(bands[band], band=band) for band in DISTANCE_BANDS],
    }
```

（`query_kindergartens` 在 B5 加進同一個檔案；`asdict`、`haversine_m`、`geo_kindergartens`、`RADIUS_CHOICES`、`OWN_CAMPUS_RADIUS_M`、`KINDERGARTEN_SOURCE_NOTE` 本任務先匯入／定義，B5 使用。若 linter 抱怨未使用，B5 會用到，先保留。）

- [ ] **Step 5: 路由**

`backend/app/admissions/routes.py`：

```python
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
```

改成：

```python
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
```

```python
from app.admissions import academic, booking_link, constants, download, follow_up, funnel, intake, records
from app.admissions import stats as stats_service
```

改成：

```python
from app.admissions import academic, booking_link, constants, download, follow_up, funnel, intake, records
from app.admissions import area as area_service
from app.admissions import stats as stats_service
from app.admissions.geo import boundaries as geo_boundaries
```

schema import 清單（字母序）加入 `AdmissionsAreaOut,`（放在 `AdmissionsCompareOut,` 之前）與 `AreaKindergartensOut,`（放在 `ContactLogCreate,` 之前）。

在 `get_admissions_compare` 函式之後加入：

```python
@router.get("/admin/admissions/area", response_model=AdmissionsAreaOut)
async def get_admissions_area(
    campus_key: str,
    school_year: int | None = Query(
        default=None, ge=constants.SCHOOL_YEAR_MIN, le=constants.SCHOOL_YEAR_MAX, description="入學學年；不帶＝不篩"
    ),
    semester: int | None = Query(default=None, ge=1, le=2),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> AdmissionsAreaOut:
    """區域分析（2026-10-08 區域分析規格 §8.1）：行政區／里／距離分組的參觀與預繳人數。
    母體同 /stats。只讀，不寫稽核；不含家長個資。"""
    _require_campus(current_user, "admissions.read", campus_key)
    result = await area_service.query_area(db, campus_key, school_year=school_year, semester=semester)
    return AdmissionsAreaOut.model_validate(result)
```

- [ ] **Step 6: 跑測試確認通過**

Run: `cd backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_area1008_test uv run pytest -q tests/test_admissions_area.py tests/test_admissions_stats.py`
Expected: 全部 PASS。

- [ ] **Step 7: Commit（使用者同意 commit 時）**

```bash
git add backend/app/admissions/area.py backend/app/admissions/schemas.py backend/app/admissions/routes.py backend/tests/test_admissions_area.py
git commit -m "$(cat <<'EOF'
feat(admissions): 新增區域分析 API（行政區、里、距離分組）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task B5: 附近幼兒園與里界 API

**Files:**
- Modify: `backend/app/admissions/area.py`（加 `query_kindergartens`）
- Modify: `backend/app/admissions/routes.py`（`/area` 之後加兩條路由）
- Test: `backend/tests/test_admissions_area.py`（追加）

**Interfaces:**
- Consumes: `geo_kindergartens.nearby(db, lat, lng, radius_m) -> list[NearbyKindergarten]`、`NearbyKindergarten`、`matcher.campus_points(db) -> dict[str, CampusPoint]`、`haversine_m`、`boundaries.boundary_bytes()`、`boundaries.boundary_etag()`、`tests.geo_helpers.load_geo_samples`
- Produces: `area.query_kindergartens(db, campus_key, *, radius_km) -> dict`；`GET /admin/admissions/area/kindergartens`（`radius_km` 只收 1／3／6，其他 422 `INVALID_RADIUS`）；`GET /admin/admissions/area/boundaries`（`application/geo+json`、`ETag`、`Cache-Control: private, max-age=86400`、`If-None-Match` 相符回 304）

- [ ] **Step 1: 寫失敗的測試**

追加到 `backend/tests/test_admissions_area.py`（檔頭 import 區加 `from app.admissions.geo import kindergartens as geo_kindergartens`、`from app.admissions.geo.kindergartens import NearbyKindergarten`、`from tests.geo_helpers import load_geo_samples`）：

```python
def _kindergarten(source_id: str, distance_m: int, lat: float, lng: float) -> NearbyKindergarten:
    return NearbyKindergarten(
        source_id=source_id,
        name=f"高雄市私立{source_id}幼兒園",
        kind="private",
        pre_public_period=None,
        address="高雄市三民區測試路1號",
        lat=lat,
        lng=lng,
        distance_m=distance_m,
        approved_capacity=60,
        monthly_fee_estimate=5000,
        has_penalty=False,
        phone=None,
    )


async def test_kindergartens_mark_own_and_pass_radius(admin_client, monkeypatch):
    calls: list[tuple[float, float, int]] = []

    async def located(db, campus_key):
        return _point(campus_key, 22.65, 120.32)

    async def all_points(db):
        return {"yihua": _point("yihua", 22.65, 120.32), "minghua": _point("minghua", 22.68, 120.30),
                "renwu": _point("renwu", None, None, "no_doorplate")}

    async def fake_nearby(db, lat, lng, radius_m):
        calls.append((lat, lng, radius_m))
        return [
            _kindergarten("far", 2500, 22.672, 120.32),
            _kindergarten("own", 0, 22.65001, 120.32001),
            _kindergarten("near", 900, 22.658, 120.32),
            # 明華校址旁 30 公尺左右：也是本機構。
            _kindergarten("sister", 3300, 22.68025, 120.30),
        ]

    monkeypatch.setattr(matcher, "campus_point", located)
    monkeypatch.setattr(matcher, "campus_points", all_points)
    monkeypatch.setattr(geo_kindergartens, "nearby", fake_nearby)
    response = await admin_client.get(f"{AREA}/kindergartens?campus_key=yihua&radius_km=6")
    assert response.status_code == 200, response.text
    body = response.json()
    assert calls == [(22.65, 120.32, 6000)]
    assert body["radius_km"] == 6
    assert body["source_note"] == "資料來源：全國教保資訊網（kiang 整理），月費為估計值"
    assert [(item["source_id"], item["is_own"]) for item in body["items"]] == [
        ("own", True), ("near", False), ("far", False), ("sister", True),
    ]


async def test_kindergartens_default_radius_is_three(admin_client, monkeypatch):
    calls: list[int] = []

    async def located(db, campus_key):
        return _point(campus_key, 22.65, 120.32)

    async def all_points(db):
        return {"yihua": _point("yihua", 22.65, 120.32)}

    async def fake_nearby(db, lat, lng, radius_m):
        calls.append(radius_m)
        return []

    monkeypatch.setattr(matcher, "campus_point", located)
    monkeypatch.setattr(matcher, "campus_points", all_points)
    monkeypatch.setattr(geo_kindergartens, "nearby", fake_nearby)
    body = (await admin_client.get(f"{AREA}/kindergartens?campus_key=yihua")).json()
    assert calls == [3000]
    assert body["radius_km"] == 3


async def test_kindergartens_reject_other_radius(admin_client):
    response = await admin_client.get(f"{AREA}/kindergartens?campus_key=yihua&radius_km=2")
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "INVALID_RADIUS"


async def test_kindergartens_when_campus_not_located(admin_client, monkeypatch):
    """Review Focus 4：校址比對不到時回空清單與原因，不查園所、不 500。"""
    async def unlocated(db, campus_key):
        return _point(campus_key, None, None, "no_doorplate")

    async def must_not_query(db, lat, lng, radius_m):
        raise AssertionError("校區沒有座標時不應查園所")

    monkeypatch.setattr(matcher, "campus_point", unlocated)
    monkeypatch.setattr(geo_kindergartens, "nearby", must_not_query)
    body = (await admin_client.get(f"{AREA}/kindergartens?campus_key=yihua")).json()
    assert body["items"] == []
    assert body["campus"]["locate_error"] == "no_doorplate"


async def test_kindergartens_from_samples_are_sorted(admin_client, db_session):
    """接上 A 的樣本：照距離排序、帶同步時間（校區比對不到時清單為空，也合法）。"""
    await load_geo_samples(db_session)
    await db_session.commit()
    body = (await admin_client.get(f"{AREA}/kindergartens?campus_key=yihua&radius_km=6")).json()
    assert body["synced_at"] is not None
    distances = [item["distance_m"] for item in body["items"]]
    assert distances == sorted(distances)


async def test_kindergartens_permissions(reception_yihua_client, editor_client, minghua_client):
    path = f"{AREA}/kindergartens?campus_key=yihua"
    assert (await reception_yihua_client.get(path)).status_code == 200
    assert (await editor_client.get(path)).status_code == 403
    assert (await minghua_client.get(path)).status_code == 404


async def test_boundaries_etag_and_cache(admin_client):
    first = await admin_client.get(f"{AREA}/boundaries")
    assert first.status_code == 200, first.text
    assert first.headers["content-type"].startswith("application/geo+json")
    assert first.headers["cache-control"] == "private, max-age=86400"
    etag = first.headers["etag"]
    data = first.json()
    assert data["type"] == "FeatureCollection"
    assert len(data["features"]) == 893
    again = await admin_client.get(f"{AREA}/boundaries", headers={"If-None-Match": etag})
    assert again.status_code == 304
    assert again.content == b""
    assert again.headers["etag"] == etag


async def test_boundaries_permissions(reception_yihua_client, editor_client, readonly_yihua_client):
    path = f"{AREA}/boundaries"
    assert (await reception_yihua_client.get(path)).status_code == 200
    assert (await editor_client.get(path)).status_code == 403
    assert (await readonly_yihua_client.get(path)).status_code == 403
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `cd backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_area1008_test uv run pytest -q tests/test_admissions_area.py -k "kindergartens or boundaries"`
Expected: FAIL，404（路由還沒有）。

- [ ] **Step 3: `query_kindergartens`**

`backend/app/admissions/area.py` 檔尾加入：

```python
async def query_kindergartens(db: AsyncSession, campus_key: str, *, radius_km: int) -> dict[str, Any]:
    """本校半徑內的幼兒園（規格 §8.2），依距離排序。校區比對不到座標時回空清單，原因在
    campus.locate_error。is_own：與任一校區座標相距 50 公尺內（本機構，不算競爭園所）。"""
    campus = await campus_out(db, campus_key)
    status = await db.get(GeoDatasetStatus, "kindergartens")
    result: dict[str, Any] = {
        "synced_at": status.synced_at if status is not None else None,
        "source_note": KINDERGARTEN_SOURCE_NOTE,
        "campus": campus,
        "radius_km": radius_km,
        "items": [],
    }
    if campus["lat"] is None or campus["lng"] is None:
        return result
    own_points = [
        (point.lat, point.lng)
        for point in (await matcher.campus_points(db)).values()
        if point.lat is not None and point.lng is not None
    ]
    found = await geo_kindergartens.nearby(db, campus["lat"], campus["lng"], radius_km * 1000)
    result["items"] = [
        {
            **asdict(item),
            "is_own": any(haversine_m(item.lat, item.lng, lat, lng) <= OWN_CAMPUS_RADIUS_M for lat, lng in own_points),
        }
        for item in sorted(found, key=lambda kindergarten: (kindergarten.distance_m, kindergarten.name))
    ]
    return result
```

- [ ] **Step 4: 路由**

`backend/app/admissions/routes.py`，在 `get_admissions_area` 之後加入：

```python
@router.get("/admin/admissions/area/kindergartens", response_model=AreaKindergartensOut)
async def get_admissions_area_kindergartens(
    campus_key: str,
    radius_km: int = Query(default=3, description="半徑公里：1、3 或 6"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> AreaKindergartensOut:
    """本校附近的幼兒園（2026-10-08 區域分析規格 §8.2）：公開資料，依距離排序。只讀，不寫稽核。
    radius_km 用 int 收再自己檢查：FastAPI 0.136.1 的 Literal[1, 3, 6] 不會把 query 字串轉成整數。"""
    _require_campus(current_user, "admissions.read", campus_key)
    if radius_km not in area_service.RADIUS_CHOICES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "INVALID_RADIUS", "message": "半徑只能是 1、3 或 6 公里"},
        )
    result = await area_service.query_kindergartens(db, campus_key, radius_km=radius_km)
    return AreaKindergartensOut.model_validate(result)


@router.get(
    "/admin/admissions/area/boundaries",
    response_class=Response,
    responses={
        200: {"content": {"application/geo+json": {}}, "description": "高雄市里界 GeoJSON（規格 §5.6）"},
        304: {"description": "與 If-None-Match 相同，未變更"},
    },
)
async def get_admissions_area_boundaries(
    request: Request,
    current_user: User = Depends(get_current_user),
) -> Response:
    """里界 GeoJSON（2026-10-08 區域分析規格 §8.3）：不分校區，只要有招生讀取權限。
    檔案隨程式部署、內容不變，帶 ETag 與一天的私有快取（路由自己設 Cache-Control，
    main.py 的 no-store 中介層會尊重）。"""
    require_scope(current_user, "admissions.read")
    etag = geo_boundaries.boundary_etag()
    headers = {"ETag": etag, "Cache-Control": "private, max-age=86400"}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=headers)
    return Response(content=geo_boundaries.boundary_bytes(), media_type="application/geo+json", headers=headers)
```

- [ ] **Step 5: 跑測試確認通過**

Run: `cd backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_area1008_test uv run pytest -q tests/test_admissions_area.py`
Expected: 全部 PASS（含 B4 的 `test_area_hidden_when_admissions_disabled`）。

- [ ] **Step 6: Commit（使用者同意 commit 時）**

```bash
git add backend/app/admissions/area.py backend/app/admissions/routes.py backend/tests/test_admissions_area.py
git commit -m "$(cat <<'EOF'
feat(admissions): 新增區域分析的附近幼兒園與里界 API

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

### Task B6: 契約重產、轉移契約說明、註解，與 B 階段驗證閘

**Files:**
- Modify: `contracts/openapi.json`、`contracts/generated/website-api.d.ts`（產生）
- Modify: `contracts/ivy-recruitment/README.md:96`（第 10 點）、同節檔尾（第 18 點）
- Modify: `backend/app/admissions/stats.py:10`、`:465`

**Interfaces:**
- Consumes: B1–B5 的路由與 schema
- Produces: OpenAPI schema `AdmissionsAreaOut`、`AreaFiltersOut`、`AreaDataStatusOut`、`AreaCampusOut`、`AreaReasonCountOut`、`AreaTotalsOut`、`AreaDistrictRowOut`、`AreaVillageRowOut`、`AreaDistanceBandOut`、`AreaKindergartensOut`、`AreaKindergartenOut`、`VisitGeoOut`；`RecruitmentVisitOut.geo` 選填

- [ ] **Step 1: 改註解**

`backend/app/admissions/stats.py` 第 10 行：

```python
- 來源不做別名合併；不做童年綠地、行政區、預計就讀月份。
```

改成：

```python
- 來源不做別名合併；不做童年綠地、預計就讀月份。行政區與里由區域分析另外算
  （area.py，2026-10-08 區域分析規格），不進 /stats。
```

第 465 行：

```python
    """園務 shared.py:442-491。官網不做行政區，AREA_OPPORTUNITY 改成 REVIEW_SOURCE。"""
```

改成：

```python
    """園務 shared.py:442-491。官網不做區域機會判讀（2026-10-08 區域分析也不做），
    AREA_OPPORTUNITY 改成 REVIEW_SOURCE。"""
```

- [ ] **Step 2: 改轉移契約說明**

`contracts/ivy-recruitment/README.md` 第 10 點整段：

```markdown
10. 警示與行動入口的 `target_tab`：官網是 `records`（`target_filter.month`）／`nodeposit`／`source`，園務是 `detail`／`nodeposit`／`area`。行動入口「查看區域機會」（`AREA_OPPORTUNITY`）改成「查看來源結構」（`REVIEW_SOURCE`），只在來源失衡時出現：官網不做行政區（`district` 不填），照抄的話園務會寫出「優先檢查 未填寫 的來源分布與通勤熱區。」。
```

改成：

```markdown
10. 警示與行動入口的 `target_tab`：官網是 `records`（`target_filter.month`）／`nodeposit`／`source`，園務是 `detail`／`nodeposit`／`area`。行動入口「查看區域機會」（`AREA_OPPORTUNITY`）改成「查看來源結構」（`REVIEW_SOURCE`），只在來源失衡時出現：官網的區域分析（2026-10-08 起，見第 18 點）不做市場機會判讀，警示與行動入口都不指到區域分析。
```

同一節第 17 點之後加入：

```markdown
18. 區域分析（2026-10-08，`docs/specs/2026-10-08-admissions-area-design.md`）：`district` 由官網伺服器依高雄市門牌坐標開放資料比對填寫（行政區字串，例「三民區」），表單仍不收；園務由後端 regex 從地址切出「○○區」（未寫進欄位時查詢當下解析）。兩邊口徑不同（園務只認「區」、官網另處理舊高雄縣鄉鎮與外縣市），併入時要擇一。官網另有 `recruitment_visit_geo`（里、比對等級、未定位原因、到本校直線距離），以及公開資料表 `geo_doorplates`、`geo_kindergartens`、`geo_dataset_status`，都不在轉移契約內。官網不做地址分析同意勾選，`geocoding_consent_at` 仍不填；家長地址不送任何外部服務（園務送 Google／TGOS）。匿名化時清掉里與距離、保留 `district`（同園務）。
```

- [ ] **Step 3: 重產契約**

Run:

```bash
cd ~/Repositories/ivy-website-wt/admissions-area-20261008
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; [ -d node_modules ] || npm ci; npm run contract:generate; npm run contract:check
```

Expected: `contract:check` exit 0；`git diff --stat contracts/` 只有 `openapi.json` 與 `generated/website-api.d.ts`。

Run: `grep -c "AdmissionsAreaOut\|AreaKindergartensOut\|VisitGeoOut" contracts/generated/website-api.d.ts`
Expected: 大於 0。

Run: `grep -n '"/api/website/v1/admin/admissions/area' contracts/openapi.json`
Expected: 三條路徑都在。

- [ ] **Step 4: 後台 typecheck 不受影響**

Run: `cd ~/Repositories/ivy-website-wt/admissions-area-20261008; source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm --prefix admin run typecheck`
Expected: 0 errors（`geo` 是選填，現有測試工廠不用改）。

- [ ] **Step 5: B 階段驗證閘**

Run: `cd backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_area1008_test uv run pytest -q tests/test_admissions_*.py tests/test_geo_*.py tests/test_config_isolation.py tests/test_audit_coverage.py`
Expected: 全部 PASS。

主 session 另在背景跑全套（子代理不要跑，超過 10 分鐘會被中止）：

```bash
cd ~/Repositories/ivy-website-wt/admissions-area-20261008/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_area1008_test uv run pytest -q
```

Expected: 全過；唯一允許的既有失敗是台北週五的 `test_booking_consent_readiness` 場次同步（main 既有，與本分支無關）。

- [ ] **Step 6: Commit（使用者同意 commit 時）**

```bash
git add contracts/openapi.json contracts/generated/website-api.d.ts contracts/ivy-recruitment/README.md backend/app/admissions/stats.py
git commit -m "$(cat <<'EOF'
docs(contracts): 區域分析 API 進契約，轉移契約記錄 district 改由伺服器填寫

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
)"
```

---

## 自我檢查紀錄

- **規格覆蓋**：§5.5（B1）、§6.1 建立／改地址時比對（B1；門牌換版與校址變更的重算在 A 的 `rematch_visits`）、§8.1（B4）、§8.2（B5）、§8.3（B5）、§8.4（B3）、§8.5（B1）、§10 匿名化（B2）、§11 轉移契約（B6）、§12 `stats.py` 註解（B6；`StatsTab.vue:19`、招生規格、DESIGN.md 由 C 負責）、§14.1 `/area` 口徑／權限／開關／幼兒園／里界／匿名化／明細篩選／district 拒收（B1–B5）。
- **Review Focus**：第 2 條 → B1 `test_editing_address_to_outside_clears_district_and_village`、`test_editing_address_to_blank_is_no_address`；第 4 條 → B4 `test_area_campus_not_located`、B5 `test_kindergartens_when_campus_not_located`；第 5 條（重算不碰 version）屬 A 的 `rematch_visits`，B1 另驗 `apply_visit_geo` 在 PATCH 時只加一次 version。第 1、3 條屬 A。
- **型別一致**：`VisitGeoOut` 欄位＝總覽；`AreaKindergartenOut`＝`NearbyKindergarten` 欄位＋`is_own`；`distance_bands` 固定五列、順序同總覽；`geo=no_village` 同總覽。
