# 附近同業比較 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 區域分析多一個「附近同業收費」區塊（本校 114 學年公告收費在半徑內私立一般園所裡的位置），附近幼兒園清單顯示公告收費與空間／服務欄位，附近托嬰清單顯示月費、評鑑、準公共。

**Architecture:** 後端多兩段公開資料同步（kiang 的逐校收費檔、托嬰逐所明細，都在 `kiang.github.io`），存進新表 `geo_kindergarten_fees` 與既有兩張表的新欄位；新服務 `peer_fees.py` 只讀計算、新端點 `/admin/admissions/area/fees`；後台新元件 `PeerFeesPanel.vue`，年齡狀態放在 `AreaTab.vue`，兩份清單跟著顯示。

**Tech Stack:** FastAPI 0.136.1（釘版）＋SQLAlchemy 2.0 async＋Alembic＋PostgreSQL；httpx（`MockTransport` 測試）；後台 Vue 3＋Element Plus＋Vitest；stack e2e Playwright。

**Spec:** `docs/specs/2026-10-15-peer-comparison-design.md`（commit `a0bbb5aa`）。前置：`docs/specs/2026-10-15-kindergarten-registry-design.md`（分支 `fix/kindergarten-registry-20261015`，本計畫假設它已上 main）。

## Global Constraints

- 工作目錄：worktree `~/Repositories/ivy-website-wt/peer-fees-20261015`，分支 `feature/peer-fees-20261015`。以下指令都從 worktree 根目錄執行。
- 後端測試指令（`WEBSITE_*` 一律寫在同一行；測試庫是本案專用）：
  `cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_peerfees_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen pytest -q -p no:cacheprovider <路徑或 node id>`
  下文簡寫為 `BT <路徑>`。
- 後台測試：`source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; cd admin && npx vitest run <路徑> --testTimeout=60000`（`source nvm.sh` 回傳 3，用分號串接）。下文簡寫為 `AT <路徑>`。typecheck：`source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; cd admin && npm run typecheck`。
- 契約（不經 uv，避免改動共用 venv 的 .pth）：產生 `cd backend && env -i PATH="$PATH" HOME="$HOME" .venv/bin/python scripts/export_openapi.py && cd .. && npx openapi-typescript contracts/openapi.json -o contracts/generated/website-api.d.ts`；檢查把 `export_openapi.py` 換成 `export_openapi.py --check`、後半換成 `node scripts/check-contract-types.mjs`。
- 機器只有 8GB RAM：同時只跑一組測試；全套 pytest 不在 subagent 跑（超過 10 分鐘會被殺），由主 session 背景跑。
- git：不 reset／checkout 還原／stash／clean；不 `git add .`、`-A`、`commit -a`，只加列出的檔。commit 用 Conventional Commit、繁體中文，結尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。**不 push**（push main＝正式部署）。
- 規格 F2：排名、中位數、項目對照只用私立一般（`kind == "private"`）；準公共、公立、非營利只當背景。不試算家長實付。
- 規格 F4：只存最新學年、全日班、2–5 歲、一學期（上學期；上學期總收費不是正整數才用下學期）。
- 規格 F5：交通費只存公告原文（去多餘空白、最多 40 字），不算中位數。
- 規格 F14：中位數少於 3 所不算；偶數取中間兩個平均、四捨五入到元；排名＝比本校高的家數＋1；本校是私立一般才排名。
- 規格 §8：收費檔 `meta`、托嬰明細的 `負責人姓名`、`聯絡電話`、`違反法令紀錄`、`退費說明` 都不讀不存；名單 CSV 只讀前置案決定的欄位。家長資料不送任何外部服務。
- 文案：繁體中文台灣用語；不寫操作說明、製作過程、「計算中」之類的狀態字（no-dev-helper-copy）；顏色只用 `admin/src/style.css` 的 token（`--ink`、`--ink-2`、`--ink-3`、`--line`、`--line-strong`、`--surface-2`、`--area-kind-private`、`--area-kind-own`、`--area-kind-own-ink`），不寫 rgba／十六進位字面值。
- 負號用既有的 `signedCount`（`areaFormat.ts`，內部是 U+2212）。不要在程式裡手打其他跳脫字元。

## Review Focus

1. **一次寫入兩千多筆收費列**：asyncpg 單一語句參數上限 32,767，624 所 × 4 歲 × 13 欄會撞到。要分批寫入，全部列都要在（Task 4 `test_fee_rows_are_inserted_in_chunks`）。
2. **快速切換年齡或半徑**：舊的收費回應晚到，不能蓋掉新的（Task 9 `舊年齡的回應晚到不會蓋掉新的`）。
3. **附近沒有其他私立一般，或都沒公布收費**：總結句講清楚，不寫「只有 0 所」、不拋錯（Task 8 `peerSummaryText` 的兩個邊界 case）。
4. **收費檔只有總價、項目全空**：總價照用，項目是「—」不是 0（Task 3 `test_items_can_be_blank_while_the_total_is_kept`、Task 8 `itemRows`）。
5. **本校是準公共**：不排名，總結句不寫「第幾高」（Task 6 `test_quasi_public_own_school_is_not_ranked`、Task 8 對應 case）。

---

### Task 0: 開工前置（前置案上 main 之後才做）

**Files:** 無程式變動。

- [ ] **Step 1: 確認前置案已上 main，把分支接上去**

```bash
git fetch -q origin
git log --oneline origin/main | grep -m1 "教育部名單\|registry" || echo "前置案還沒上 main：停在這裡，回報使用者"
git rebase origin/main
git log --oneline -3
```

Expected：第一行印出前置案的 commit；rebase 後本分支只多規格與本計畫兩個 commit。

- [ ] **Step 2: 補 sparse 目錄、建環境**

```bash
git sparse-checkout add web/server/data web/public web/app web/app/generated web/server deploy
cd backend && uv sync --frozen && cd ..
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; (cd admin && npm ci)
```

- [ ] **Step 3: 建專用測試庫並升級**

```bash
createdb ivy_website_peerfees_test
cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_peerfees_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen alembic upgrade head && cd ..
```

- [ ] **Step 4: 確認前置案留下的介面，記下與本計畫不同的地方**

```bash
grep -n "def parse_preschools" -A2 backend/app/admissions/geo/kindergartens.py
grep -n "registry" backend/tests/geo_helpers.py | head
cd backend && uv run --frozen alembic heads && cd ..
```

Expected：`parse_preschools(data, *, registry, school_year, report=None)`，`registry` 是 `set[tuple[str, str]]`（`reg_docno`、`title`）；alembic 單一 head（寫計畫時是 `c6a9e3f15d27`，前置案不加 migration）。若簽名不同，Task 2 測試的 `_parse()` 照實際簽名改；若 head 不同（例如「在籍學生」先上了），Task 1 的 `down_revision` 改成實際 head。

- [ ] **Step 5: 基準測試**

Run: `BT tests/test_geo_schema.py tests/test_geo_kindergartens.py tests/test_geo_babycare.py tests/test_admissions_provider_area.py`
Expected：全部 PASS（基準；有紅燈先查是不是環境缺檔，不要先改程式）。

---

### Task 1: 資料表與 migration

**Files:**
- Modify: `backend/app/admissions/geo/models.py`（import、`DATASETS`、`FEE_AGES`、`GeoKindergarten`、`GeoBabycare`、新 `GeoKindergartenFee`）
- Create: `backend/migrations/versions/f2b8c4d1e7a9_peer_fees.py`
- Modify: `backend/tests/test_geo_schema.py`
- Modify: `backend/tests/conftest.py`（`_clean_tables` 的 TRUNCATE 清單）

**Interfaces:**
- Produces: `GeoKindergartenFee`（主鍵 `source_id`、`age`；欄位 `school_year`、`months: Decimal | None`、`tuition`、`misc_fee`、`materials`、`activities`、`lunch`、`snack`、`semester_total`、`after_care_monthly`、`transport_note`、`synced_at`）；`FEE_AGES = (2, 3, 4, 5)`；`DATASETS` 多 `"kindergarten_fees"`；`GeoKindergarten` 新欄 `indoor_m2`、`outdoor_m2`、`has_shuttle`、`after_school_capacity`；`GeoBabycare` 新欄 `monthly_fee`、`fee_note`、`evaluation_grade`、`evaluation_year`、`quasi_public`。

- [ ] **Step 1: 改 schema 測試（先紅）**

在 `backend/tests/test_geo_schema.py`：

1. import 區把 `GeoKindergartenFee` 加進 `from app.admissions.geo.models import ...`。
2. `PROVIDER_MIGRATION = ...` 下一行加：

```python
FEES_MIGRATION = BACKEND / "migrations" / "versions" / "f2b8c4d1e7a9_peer_fees.py"
```

3. `CONSTRAINT_MIGRATIONS` 改成（dataset 的約束最後一次寫在新 migration，另加收費年齡約束），上面的註解補一句「10-15 附近同業比較再多收 kindergarten_fees，並新增收費年齡約束」：

```python
CONSTRAINT_MIGRATIONS = {
    "ck_geo_dataset_status_dataset": FEES_MIGRATION,
    "ck_geo_new_home_sales_match_level": NEW_HOMES_MIGRATION,
    "ck_geo_babycare_kind": PROVIDER_MIGRATION,
    "ck_geo_provider_events_provider": PROVIDER_MIGRATION,
    "ck_geo_provider_events_change": PROVIDER_MIGRATION,
    "ck_geo_kindergarten_fees_age": FEES_MIGRATION,
}
```

4. `MODELS` 尾端加 `GeoKindergartenFee`；`CHECK_NAMES` 加 `"ck_geo_kindergarten_fees_age"`。
5. `test_provider_migration_follows_new_homes_and_only_adds`：刪掉 `assert script.get_heads() == ["c6a9e3f15d27"]` 這一行，docstring 的「是唯一的 head；」拿掉。
6. 在它下面新增：

```python
def test_peer_fees_migration_follows_provider_changes_and_only_adds():
    """附近同業比較：接在托嬰與異動之後、是唯一的 head；升級只建表、加欄位與放寬約束，不動既有資料。"""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config(str(BACKEND / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND / "migrations"))
    script = ScriptDirectory.from_config(config)
    assert script.get_revision("f2b8c4d1e7a9").down_revision == "c6a9e3f15d27"
    assert script.get_heads() == ["f2b8c4d1e7a9"]
    upgrade = FEES_MIGRATION.read_text(encoding="utf-8").split("def upgrade()", 1)[1].split("def downgrade()", 1)[0]
    assert "op.execute" not in upgrade and "UPDATE " not in upgrade and "DELETE " not in upgrade


async def test_peer_fee_columns_exist(db_session):
    found = (
        await db_session.execute(
            text(
                "SELECT table_name, column_name FROM information_schema.columns WHERE "
                "(table_name = 'geo_kindergartens' AND column_name IN "
                "('indoor_m2', 'outdoor_m2', 'has_shuttle', 'after_school_capacity')) OR "
                "(table_name = 'geo_babycare' AND column_name IN "
                "('monthly_fee', 'fee_note', 'evaluation_grade', 'evaluation_year', 'quasi_public'))"
            )
        )
    ).all()
    assert len(found) == 9


async def test_fee_age_accepts_two_to_five_and_rejects_others(db_session):
    def fee(source_id: str, age: int) -> GeoKindergartenFee:
        return GeoKindergartenFee(
            source_id=source_id, age=age, school_year=114, semester_total=89750, synced_at=datetime.now(timezone.utc)
        )

    for age in FEE_AGES:
        db_session.add(fee("k1", age))
    await db_session.commit()
    await _expect_rejected(db_session, fee("k1", 6))
    await _expect_rejected(db_session, fee("k2", 1))
```

（`FEE_AGES` 一起加進 models 的 import。）

7. `test_check_constraint_names_in_database_are_the_locked_set` 的 regclass 清單加 `'geo_kindergarten_fees'::regclass`；`test_tables_exist` 的集合加 `"geo_kindergarten_fees"`。

- [ ] **Step 2: 跑測試確認紅燈**

Run: `BT tests/test_geo_schema.py`
Expected：FAIL（`ImportError: cannot import name 'GeoKindergartenFee'`）。

- [ ] **Step 3: 改 models.py**

import 區：`from datetime import date, datetime` 上面加 `from decimal import Decimal`；sqlalchemy import 清單加 `Numeric`、`SmallInteger`（照字母序）。

`DATASETS` 尾端加 `"kindergarten_fees",`，上方註解補一行：

```python
# kindergarten_fees：幼兒園公告收費（2026-10-15 附近同業比較），migration f2b8c4d1e7a9 加進約束。
```

`PROVIDER_CHANGES = ...` 下面加：

```python
FEE_AGES = (2, 3, 4, 5)  # 收費只存 2–5 歲全日班（2026-10-15 規格 F4）
```

`GeoKindergarten` 的 `registered_on` 之後加：

```python
    # 2026-10-15 附近同業比較：室內／戶外面積（m²）、幼童專用車（有／無）、兼辦國小課後人數（「無」＝0）。
    # 來源沒有或格式不對存 NULL；畫面用面積 ÷ 核定人數。
    indoor_m2: Mapped[float | None] = mapped_column(Float, nullable=True)
    outdoor_m2: Mapped[float | None] = mapped_column(Float, nullable=True)
    has_shuttle: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    after_school_capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
```

`GeoBabycare` 的 `phone` 之後加：

```python
    # 2026-10-15 附近同業比較：逐所明細的日間托育平均月費與說明、評鑑等級與年度（民國）、準公共資格。
    # 抓不到的那一所保留上次的值；從沒抓到是 NULL。
    monthly_fee: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fee_note: Mapped[str | None] = mapped_column(String(200), nullable=True)
    evaluation_grade: Mapped[str | None] = mapped_column(String(8), nullable=True)
    evaluation_year: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    quasi_public: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
```

`GeoProviderEvent` 之前新增：

```python
class GeoKindergartenFee(Base):
    """幼兒園公告收費（kiang 整理的全國教保資訊網收費明細，2026-10-15 規格 §3）：每所每個年齡一列，
    最新學年、全日班、一學期。不設外鍵，讀的時候 join geo_kindergartens。來源檔頭（含負責人姓名）整段不讀。
    學期項目是小計、課後延托是每月單價；交通費只存公告原文。學年換新時整表替換。"""

    __tablename__ = "geo_kindergarten_fees"
    __table_args__ = (
        CheckConstraint(f"age BETWEEN {FEE_AGES[0]} AND {FEE_AGES[-1]}", name="ck_geo_kindergarten_fees_age"),
    )

    source_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    age: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    school_year: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    months: Mapped[Decimal | None] = mapped_column(Numeric(3, 1), nullable=True)
    tuition: Mapped[int | None] = mapped_column(Integer, nullable=True)
    misc_fee: Mapped[int | None] = mapped_column(Integer, nullable=True)
    materials: Mapped[int | None] = mapped_column(Integer, nullable=True)
    activities: Mapped[int | None] = mapped_column(Integer, nullable=True)
    lunch: Mapped[int | None] = mapped_column(Integer, nullable=True)
    snack: Mapped[int | None] = mapped_column(Integer, nullable=True)
    semester_total: Mapped[int] = mapped_column(Integer, nullable=False)
    after_care_monthly: Mapped[int | None] = mapped_column(Integer, nullable=True)
    transport_note: Mapped[str | None] = mapped_column(String(40), nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
```

`GeoDatasetStatus` docstring 的清單加一行：`- kindergarten_fees：active_version、label 都是收費學年「114」；synced_at＝上次全量完成、checked_at＝上次確認學年；`

- [ ] **Step 4: 寫 migration**

Create `backend/migrations/versions/f2b8c4d1e7a9_peer_fees.py`：

```python
"""附近同業比較：幼兒園收費新表、園所與托嬰加欄位，公開資料狀態多一種 kindergarten_fees（2026-10-15 規格第 3 節）

規格：docs/specs/2026-10-15-peer-comparison-design.md。
新增 geo_kindergarten_fees；geo_kindergartens 加 indoor_m2、outdoor_m2、has_shuttle、after_school_capacity；
geo_babycare 加 monthly_fee、fee_note、evaluation_grade、evaluation_year、quasi_public；
ck_geo_dataset_status_dataset 放寬成多收 'kindergarten_fees'。不改既有資料，不需要先備份正式庫。
上一版程式不讀新表與新欄位、也不會寫 kindergarten_fees 狀態列，先跑 migration 再換程式也相容。
約束條件字串與 app/admissions/geo/models.py 逐字相同（tests/test_geo_schema.py 檢查）。

降級先刪 kindergarten_fees 狀態列（否則還原舊約束會失敗），再還原約束、拿掉欄位、刪表。

Revision ID: f2b8c4d1e7a9
Revises: c6a9e3f15d27
Create Date: 2026-10-15
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "f2b8c4d1e7a9"
down_revision = "c6a9e3f15d27"
branch_labels = None
depends_on = None

DATASET_CHECK = (
    "dataset IN ('doorplates', 'kindergartens', 'campuses', 'population', 'births', 'migration', 'income', 'new_homes',"
    " 'babycare', 'kindergarten_fees')"
)
PREVIOUS_DATASET_CHECK = (
    "dataset IN ('doorplates', 'kindergartens', 'campuses', 'population', 'births', 'migration', 'income', 'new_homes',"
    " 'babycare')"
)
FEE_AGE_CHECK = "age BETWEEN 2 AND 5"


def upgrade() -> None:
    op.create_table(
        "geo_kindergarten_fees",
        sa.Column("source_id", sa.String(64), primary_key=True),
        sa.Column("age", sa.SmallInteger(), primary_key=True),
        sa.Column("school_year", sa.SmallInteger(), nullable=False),
        sa.Column("months", sa.Numeric(3, 1), nullable=True),
        sa.Column("tuition", sa.Integer(), nullable=True),
        sa.Column("misc_fee", sa.Integer(), nullable=True),
        sa.Column("materials", sa.Integer(), nullable=True),
        sa.Column("activities", sa.Integer(), nullable=True),
        sa.Column("lunch", sa.Integer(), nullable=True),
        sa.Column("snack", sa.Integer(), nullable=True),
        sa.Column("semester_total", sa.Integer(), nullable=False),
        sa.Column("after_care_monthly", sa.Integer(), nullable=True),
        sa.Column("transport_note", sa.String(40), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(FEE_AGE_CHECK, name="ck_geo_kindergarten_fees_age"),
    )
    op.add_column("geo_kindergartens", sa.Column("indoor_m2", sa.Float(), nullable=True))
    op.add_column("geo_kindergartens", sa.Column("outdoor_m2", sa.Float(), nullable=True))
    op.add_column("geo_kindergartens", sa.Column("has_shuttle", sa.Boolean(), nullable=True))
    op.add_column("geo_kindergartens", sa.Column("after_school_capacity", sa.Integer(), nullable=True))
    op.add_column("geo_babycare", sa.Column("monthly_fee", sa.Integer(), nullable=True))
    op.add_column("geo_babycare", sa.Column("fee_note", sa.String(200), nullable=True))
    op.add_column("geo_babycare", sa.Column("evaluation_grade", sa.String(8), nullable=True))
    op.add_column("geo_babycare", sa.Column("evaluation_year", sa.SmallInteger(), nullable=True))
    op.add_column("geo_babycare", sa.Column("quasi_public", sa.Boolean(), nullable=True))
    op.drop_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", type_="check")
    op.create_check_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", DATASET_CHECK)


def downgrade() -> None:
    op.execute("DELETE FROM geo_dataset_status WHERE dataset = 'kindergarten_fees'")
    op.drop_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", type_="check")
    op.create_check_constraint("ck_geo_dataset_status_dataset", "geo_dataset_status", PREVIOUS_DATASET_CHECK)
    for column in ("quasi_public", "evaluation_year", "evaluation_grade", "fee_note", "monthly_fee"):
        op.drop_column("geo_babycare", column)
    for column in ("after_school_capacity", "has_shuttle", "outdoor_m2", "indoor_m2"):
        op.drop_column("geo_kindergartens", column)
    op.drop_table("geo_kindergarten_fees")
```

若 Task 0 Step 4 的 head 不是 `c6a9e3f15d27`：`down_revision`、docstring 的 `Revises:`、Step 1 新測試的 `down_revision` 斷言一起改成實際 head；`PREVIOUS_DATASET_CHECK` 改成那支 migration 最後寫的 dataset 條件。

- [ ] **Step 5: conftest 清表**

`backend/tests/conftest.py` 的 `_clean_tables`：TRUNCATE 清單裡 `geo_provider_events` 後面加 `geo_kindergarten_fees,`（保持同一行的逗號格式）。

- [ ] **Step 6: 升級測試庫並跑測試**

```bash
cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_peerfees_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen alembic upgrade head && cd ..
```

Run: `BT tests/test_geo_schema.py`
Expected：PASS。再驗一次降級與重升：

```bash
cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_peerfees_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen alembic downgrade -1 && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_peerfees_test WEBSITE_SESSION_SECRET=ci-only-session-secret-not-for-production uv run --frozen alembic upgrade head && cd ..
```

Expected：兩步都成功、沒有錯誤。

- [ ] **Step 7: Commit**

```bash
git add backend/app/admissions/geo/models.py backend/migrations/versions/f2b8c4d1e7a9_peer_fees.py backend/tests/test_geo_schema.py backend/tests/conftest.py
git commit -m "feat(admissions): 幼兒園收費新表與園所、托嬰的同業比較欄位" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 幼兒園四個新欄位（解析與附近清單）

**Files:**
- Modify: `backend/app/admissions/geo/kindergartens.py`
- Create: `backend/tests/test_geo_kindergarten_fields.py`

**Interfaces:**
- Consumes: Task 1 的 `GeoKindergarten` 新欄位；前置案的 `parse_preschools(data, *, registry, school_year, report=None)`。
- Produces: `KindergartenRow` 新欄位 `indoor_m2`、`outdoor_m2`、`has_shuttle`、`after_school_capacity`（都有預設 None）；`NearbyKindergarten` 新欄位 `indoor_m2_per_child: float | None`、`outdoor_m2_per_child: float | None`、`has_shuttle: bool | None`、`after_school_capacity: int | None`（有預設 None）；`per_child(area_m2, capacity) -> float | None`。

- [ ] **Step 1: 寫失敗測試**

Create `backend/tests/test_geo_kindergarten_fields.py`：

```python
"""幼兒園四個新欄位：室內／戶外面積、幼童專用車、兼辦國小課後（2026-10-15 規格 §3、§4.1、F15）。"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.admissions.geo.kindergartens import nearby, parse_preschools, per_child
from app.admissions.geo.providers import apply_kindergartens

POINT = (22.6424556, 120.3437133)


def _feature(**overrides):
    props = {
        "id": "x1", "reg_docno": "高市教字第1號", "title": "高雄市私立測試幼兒園", "city": "高雄市", "town": "三民區",
        "type": "私立", "address": "[807]某路1號", "count_approved": "150", "monthly": 10000, "pre_public": "無",
        "penalty": "無", "tel": "", "is_active": 1,
    }
    props.update(overrides)
    return {"type": "Feature", "properties": props, "geometry": {"type": "Point", "coordinates": [POINT[1], POINT[0]]}}


def _parse(*features):
    data = {"type": "FeatureCollection", "features": list(features)}
    registry = {(f["properties"]["reg_docno"], f["properties"]["title"]) for f in features}
    return parse_preschools(data, registry=registry, school_year=115)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("703.5平方公尺", 703.5), ("1,099.99平方公尺", 1099.99), ("063.5平方公尺", 63.5), ("", None), ("0平方公尺", None), ("約百坪", None), (None, None)],
)
def test_area_is_parsed_or_unknown(raw, expected):
    (row,) = _parse(_feature(size_in=raw, size_out=raw))
    assert (row.indoor_m2, row.outdoor_m2) == (expected, expected)


@pytest.mark.parametrize(("raw", "expected"), [("\t\t", True), ("", False)])
def test_shuttle_is_told_by_the_raw_string(raw, expected):
    (row,) = _parse(_feature(shuttle=raw))
    assert row.has_shuttle is expected


def test_shuttle_unknown_when_the_field_is_missing():
    (row,) = _parse(_feature())
    assert row.has_shuttle is None


@pytest.mark.parametrize(("raw", "expected"), [("無", 0), ("有，人數：20", 20), ("有", None), ("", None), (None, None)])
def test_after_school_capacity(raw, expected):
    (row,) = _parse(_feature(is_after=raw))
    assert row.after_school_capacity == expected


@pytest.mark.parametrize(
    ("area", "capacity", "expected"),
    [(703.5, 150, 4.7), (556.0, 210, 2.6), (100.0, 0, None), (100.0, None, None), (None, 100, None)],
)
def test_per_child(area, capacity, expected):
    assert per_child(area, capacity) == expected


async def test_nearby_returns_area_per_child_and_services(db_session):
    rows = _parse(_feature(size_in="703.5平方公尺", size_out="556平方公尺", shuttle="\t\t", is_after="有，人數：20"))
    await apply_kindergartens(db_session, rows, synced_at=datetime.now(timezone.utc), school_year=115)
    await db_session.commit()
    (item,) = await nearby(db_session, POINT[0], POINT[1], 1000)
    assert (item.indoor_m2_per_child, item.outdoor_m2_per_child, item.has_shuttle, item.after_school_capacity) == (4.7, 3.7, True, 20)
```

- [ ] **Step 2: 跑測試確認紅燈**

Run: `BT tests/test_geo_kindergarten_fields.py`
Expected：FAIL（`ImportError: cannot import name 'per_child'`）。

- [ ] **Step 3: 實作**

`backend/app/admissions/geo/kindergartens.py`：

1. 模組 docstring 最後補一句：「2026-10-15 起另存室內／戶外面積、幼童專用車、兼辦國小課後人數（附近同業比較規格 §4.1）。」
2. `_POSTAL_PREFIX` 下面加：

```python
_AFTER_SCHOOL = re.compile(r"有[，,]\s*人數[：:]\s*([0-9]+)")
```

3. `KindergartenRow` 尾端（`registered_on` 之後）加：

```python
    indoor_m2: float | None = None
    outdoor_m2: float | None = None
    has_shuttle: bool | None = None
    after_school_capacity: int | None = None
```

4. `NearbyKindergarten` 尾端（`phone` 之後）加：

```python
    indoor_m2_per_child: float | None = None
    outdoor_m2_per_child: float | None = None
    has_shuttle: bool | None = None
    after_school_capacity: int | None = None
```

5. `_registered_on` 之後加：

```python
def _area_m2(value: object) -> float | None:
    """面積「1,534.78平方公尺」→ 1534.78；空、0、不是數字都是 None。"""
    text = str(value or "").replace("平方公尺", "").replace(",", "").strip()
    try:
        number = float(text)
    except ValueError:
        return None
    return number if math.isfinite(number) and number > 0 else None


def _has_shuttle(props: dict) -> bool | None:
    """幼童專用車：kiang 把原站的車牌表存成空白字元（有車），沒有車是空字串；沒有這個欄位＝不知道。
    用原始字串判斷，不能先 strip。"""
    if "shuttle" not in props or props["shuttle"] is None:
        return None
    return str(props["shuttle"]) != ""


def _after_school_capacity(value: object) -> int | None:
    """兼辦國小課後：「無」→ 0、「有，人數：20」→ 20；只寫「有」或其他 → None。"""
    text = str(value or "").strip()
    if text == "無":
        return 0
    matched = _AFTER_SCHOOL.fullmatch(text)
    return int(matched.group(1)) if matched else None


def per_child(area_m2: float | None, capacity: int | None) -> float | None:
    """每位核定幼生的面積（m²，四捨五入到 0.1）；核定是 0 或不知道、面積不知道都是 None（規格 F15）。"""
    if area_m2 is None or capacity is None or capacity <= 0:
        return None
    return math.floor(area_m2 / capacity * 10 + 0.5) / 10
```

6. `_row` 的 `KindergartenRow(...)` 裡 `registered_on=...` 之後加：

```python
        indoor_m2=_area_m2(props.get("size_in")),
        outdoor_m2=_area_m2(props.get("size_out")),
        has_shuttle=_has_shuttle(props),
        after_school_capacity=_after_school_capacity(props.get("is_after")),
```

7. `nearby` 的 `NearbyKindergarten(...)` 裡 `phone=row.phone,` 之後加：

```python
                indoor_m2_per_child=per_child(row.indoor_m2, row.approved_capacity),
                outdoor_m2_per_child=per_child(row.outdoor_m2, row.approved_capacity),
                has_shuttle=row.has_shuttle,
                after_school_capacity=row.after_school_capacity,
```

- [ ] **Step 4: 跑測試**

Run: `BT tests/test_geo_kindergarten_fields.py tests/test_geo_kindergartens.py tests/test_geo_providers.py`
Expected：PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/app/admissions/geo/kindergartens.py backend/tests/test_geo_kindergarten_fields.py
git commit -m "feat(admissions): 幼兒園名單多存面積、幼童專用車與兼辦國小課後" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 收費檔解析與統計小工具（`geo/fees.py`）

**Files:**
- Create: `backend/app/admissions/geo/fees.py`
- Modify: `backend/tests/geo_helpers.py`（加 `slip_class`、`sample_slip`）
- Create: `backend/tests/test_geo_fees.py`

**Interfaces:**
- Consumes: `kindergartens._int_or_none`、`models.FEE_AGES`、`models.GeoKindergarten`、`models.GeoKindergartenFee`、`projection.haversine_m`。
- Produces（後面任務都用這些名字）：
  - `SLIP_ROOT = "https://kiang.github.io/ap.ece.moe.edu.tw/data"`、`SOURCE_NOTE = "資料來源：全國教保資訊網（kiang 整理），園所公告收費"`
  - `ITEM_KEYS = ("tuition", "misc_fee", "materials", "activities", "lunch", "snack", "after_care_monthly")`
  - `class FeeFormatError(ValueError)`
  - `@dataclass(frozen=True) FeeRow(age: int, months: float | None, tuition, misc_fee, materials, activities, lunch, snack: int | None, semester_total: int, after_care_monthly: int | None, transport_note: str | None)`
  - `slip_url(school_year: int, title: str) -> str`
  - `parse_slip(data: object) -> list[FeeRow]`
  - `half_up(value: float) -> int`、`median(values: list[int]) -> int | None`（少於 3 個回 None）、`monthly_average(total: int, months: Decimal | float | None) -> int | None`
  - `async own_fee(db, lat, lng, *, age: int, radius_m: int) -> tuple[GeoKindergarten | None, GeoKindergartenFee | None]`

- [ ] **Step 1: 測試樣本 helper**

`backend/tests/geo_helpers.py` 檔尾加：

```python
# ---- 幼兒園收費檔（2026-10-15 附近同業比較）----
# 鍵與 kiang 的 slip{學年}/高雄市/<園名>.json 相同；數字取自本校（常春藤幼兒園）114 學年的真實檔，
# 檔頭只留園名（真實檔頭有負責人姓名，程式本來就不讀）。各項都放小計，延托放每月單價。
SLIP_ITEMS = {"學費": "學期", "雜費": "學期", "材料費": "月", "活動費": "月", "午餐費": "月", "點心費": "月"}
SAMPLE_TRANSPORT = "單\r\n\t\t\t\t\t\t\t        770\r\n\t\t\t\t\t\t\t        雙\r\n\t\t\t\t\t\t\t        1540"
YIHUA_FEES = {
    2: (105950, {"學費": 21800, "雜費": 5500, "材料費": 31900, "活動費": 30250, "午餐費": 8250, "點心費": 8250}),
    3: (89750, {"學費": 19900, "雜費": 5500, "材料費": 24750, "活動費": 23100, "午餐費": 8250, "點心費": 8250}),
    4: (89750, {"學費": 19900, "雜費": 5500, "材料費": 24750, "活動費": 23100, "午餐費": 8250, "點心費": 8250}),
    5: (74650, {"學費": 19000, "雜費": 4500, "材料費": 19800, "活動費": 18150, "午餐費": 6600, "點心費": 6600}),
}


def slip_class(*, total: object, items: dict[str, object] | None = None, after_care: object = 1200, transport: str = "") -> dict:
    """一個班別的收費表。沒給的項目留空字串（真實檔沒有開的班別就是整張空白）。"""

    def entry(period: str, price: object, subtotal: object) -> dict:
        return {"收費期間": period, "單價": "" if price is None else str(price), "小計": "" if subtotal is None else str(subtotal)}

    table = {name: entry(period, (items or {}).get(name), (items or {}).get(name)) for name, period in SLIP_ITEMS.items()}
    table["全學期總收費"] = entry("學期", total, total)
    table["交通費"] = {"收費期間": "單趟\r\n                                            雙趟", "單價": transport, "小計": ""}
    table["課後延托費"] = entry("月", after_care, None)
    table["家長會費"] = entry("", None, None)
    return table


def sample_slip(*, blank_first_term: tuple[int, ...] = (5,), totals: dict[int, int] | None = None) -> dict:
    """本校收費檔的形狀。blank_first_term 的年齡上學期全空、只有下學期有（測試退回下學期）；totals 可以改各年齡總價。"""
    slip: dict[str, dict] = {}
    for age, (total, items) in YIHUA_FEES.items():
        total = (totals or {}).get(age, total)
        full = slip_class(total=total, items=items, after_care=1500 if age == 5 else 1200, transport=SAMPLE_TRANSPORT)
        empty = slip_class(total=None, after_care=None)
        slip[str(age)] = {
            "上學期": {"months": "5.5", "class": {"半日班": empty, "全日班": empty if age in blank_first_term else full}},
            "下學期": {"months": "5.5", "class": {"半日班": empty, "全日班": full}},
        }
    return {"meta": {"title": "高雄市私立常春藤幼兒園"}, "slip": slip}
```

- [ ] **Step 2: 寫失敗測試**

Create `backend/tests/test_geo_fees.py`：

```python
"""幼兒園收費檔解析與統計小工具（2026-10-15 規格 §2、§4.2、F4、F5、F14）。"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from urllib.parse import quote

import pytest
from sqlalchemy import delete

from app.admissions.geo import fees
from app.admissions.geo.models import GeoKindergarten, GeoKindergartenFee
from tests.geo_helpers import sample_slip


def _by_age(rows):
    return {row.age: row for row in rows}


def test_full_day_first_term_is_read_for_each_age():
    rows = _by_age(fees.parse_slip(sample_slip()))
    assert sorted(rows) == [2, 3, 4, 5]
    four = rows[4]
    assert (four.semester_total, four.months) == (89750, 5.5)
    assert (four.tuition, four.misc_fee, four.materials, four.activities, four.lunch, four.snack) == (19900, 5500, 24750, 23100, 8250, 8250)
    assert four.after_care_monthly == 1200
    assert four.transport_note == "單 770 雙 1540"


def test_second_term_is_used_when_the_first_term_is_blank():
    rows = _by_age(fees.parse_slip(sample_slip(blank_first_term=(5,))))
    assert (rows[5].semester_total, rows[5].after_care_monthly) == (74650, 1500)


def test_an_age_without_any_total_is_left_out():
    data = sample_slip()
    del data["slip"]["3"]
    for term in ("上學期", "下學期"):
        data["slip"]["2"][term]["class"]["全日班"]["全學期總收費"] = {"收費期間": "學期", "單價": "0", "小計": "0"}
    assert sorted(_by_age(fees.parse_slip(data))) == [4, 5]


def test_items_can_be_blank_while_the_total_is_kept():
    data = sample_slip()
    table = data["slip"]["4"]["上學期"]["class"]["全日班"]
    for name in ("學費", "雜費", "材料費", "活動費", "午餐費", "點心費", "課後延托費"):
        table[name] = {"收費期間": "", "單價": "", "小計": ""}
    table["全學期總收費"] = {"收費期間": "學期", "單價": "1,200", "小計": "1,200"}
    four = _by_age(fees.parse_slip(data))[4]
    assert four.semester_total == 1200
    assert (four.tuition, four.snack, four.after_care_monthly) == (None, None, None)


@pytest.mark.parametrize(("raw", "expected"), [("5.5", 5.5), ("6", 6.0), ("abc", None), ("13", None), ("0.2", None)])
def test_months(raw, expected):
    data = sample_slip()
    data["slip"]["4"]["上學期"]["months"] = raw
    assert _by_age(fees.parse_slip(data))[4].months == expected


def test_transport_note_is_squashed_and_capped():
    data = sample_slip()
    data["slip"]["4"]["上學期"]["class"]["全日班"]["交通費"]["單價"] = "單 " + "1" * 60
    assert len(_by_age(fees.parse_slip(data))[4].transport_note) == 40
    data["slip"]["4"]["上學期"]["class"]["全日班"]["交通費"]["單價"] = "  \r\n "
    assert _by_age(fees.parse_slip(data))[4].transport_note is None


def test_the_header_is_never_read():
    data = sample_slip()
    data["meta"] = {"owner": "某某某", "title": "x"}
    rows = fees.parse_slip(data)
    assert all(set(vars(row)) == set(fees.FeeRow.__dataclass_fields__) for row in rows)


@pytest.mark.parametrize("data", [None, [], {}, {"slip": []}])
def test_unexpected_shape_is_rejected(data):
    with pytest.raises(fees.FeeFormatError):
        fees.parse_slip(data)


def test_slip_url_encodes_the_city_and_the_title():
    url = fees.slip_url(114, "高雄市鳳山非營利幼兒園(委託某協會辦理)")
    assert url == f"{fees.SLIP_ROOT}/slip114/{quote('高雄市')}/{quote('高雄市鳳山非營利幼兒園(委託某協會辦理)', safe='')}.json"
    assert "%28" in url and "%29" in url


@pytest.mark.parametrize(
    ("values", "expected"),
    [([], None), ([1, 2], None), ([3, 1, 2], 2), ([1, 2, 3, 4], 3), ([10, 11, 12, 13], 12), ([75000, 40200, 93000], 75000)],
)
def test_median_needs_three_and_rounds_half_up(values, expected):
    assert fees.median(values) == expected


@pytest.mark.parametrize(
    ("total", "months", "expected"),
    [(89750, Decimal("5.5"), 16318), (105950, 5.5, 19264), (11, 2, 6), (89750, None, None), (89750, 0, None)],
)
def test_monthly_average(total, months, expected):
    assert fees.monthly_average(total, months) == expected


async def test_own_fee_finds_the_nearest_active_school_within_the_radius(db_session):
    now = datetime.now(timezone.utc)
    lat, lng = 22.6424556, 120.3437133
    for source_id, north_m, active in (("near", 12, True), ("nearer-but-closed", 5, False), ("outside", 80, True)):
        db_session.add(GeoKindergarten(
            source_id=source_id, name=source_id, kind="private", district="三民區", address="某路1號",
            lat=lat + north_m / 111_320.0, lng=lng, has_penalty=False, is_active=active, synced_at=now,
        ))
    db_session.add(GeoKindergartenFee(source_id="near", age=3, school_year=114, months=Decimal("5.5"), semester_total=89750, synced_at=now))
    await db_session.commit()
    school, fee = await fees.own_fee(db_session, lat, lng, age=3, radius_m=50)
    assert school.source_id == "near" and fee.semester_total == 89750
    school, fee = await fees.own_fee(db_session, lat, lng, age=2, radius_m=50)
    assert school.source_id == "near" and fee is None
    await db_session.execute(delete(GeoKindergarten).where(GeoKindergarten.source_id == "near"))
    await db_session.commit()
    assert await fees.own_fee(db_session, lat, lng, age=3, radius_m=50) == (None, None)
```

- [ ] **Step 3: 跑測試確認紅燈**

Run: `BT tests/test_geo_fees.py`
Expected：FAIL（`ImportError: cannot import name 'fees'`）。

- [ ] **Step 4: 實作 `backend/app/admissions/geo/fees.py`**

```python
"""幼兒園公告收費：kiang 整理的全國教保資訊網收費明細（2026-10-15 附近同業比較規格 §2、§4.2）。

來源 https://kiang.github.io/ap.ece.moe.edu.tw/data/slip{學年}/高雄市/{園名}.json，一所一檔。只讀 slip，
檔頭 meta（含負責人姓名）整段不讀。只取全日班、2–5 歲、一學期：上學期的全學期總收費是正整數就用上學期，
否則用下學期（實測上下學期 266／266 筆相同，F4）。學期項目取小計、課後延托取每月單價；交通費格式不一致，
只存公告原文（F5）。統計工具（中位數、月均）與「本校」查詢也放這裡，給 area.py 與 peer_fees.py 共用。"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from decimal import Decimal
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions.geo.kindergartens import _int_or_none
from app.admissions.geo.models import FEE_AGES, GeoKindergarten, GeoKindergartenFee
from app.admissions.geo.projection import haversine_m

SLIP_ROOT = "https://kiang.github.io/ap.ece.moe.edu.tw/data"
CITY = "高雄市"
SOURCE_NOTE = "資料來源：全國教保資訊網（kiang 整理），園所公告收費"
# 學期項目（小計）與欄位名稱的對照；順序就是畫面上項目對照表的順序。
SEMESTER_ITEMS = (
    ("tuition", "學費"), ("misc_fee", "雜費"), ("materials", "材料費"),
    ("activities", "活動費"), ("lunch", "午餐費"), ("snack", "點心費"),
)
ITEM_KEYS = (*(key for key, _ in SEMESTER_ITEMS), "after_care_monthly")
TOTAL_ITEM = "全學期總收費"
AFTER_CARE_ITEM = "課後延托費"
TRANSPORT_ITEM = "交通費"
TRANSPORT_MAX = 40
_METERS_PER_DEGREE = 111_320.0
_SPACES = re.compile(r"\s+")


class FeeFormatError(ValueError):
    """收費檔不是預期的格式。"""


@dataclass(frozen=True)
class FeeRow:
    age: int
    months: float | None
    tuition: int | None
    misc_fee: int | None
    materials: int | None
    activities: int | None
    lunch: int | None
    snack: int | None
    semester_total: int
    after_care_monthly: int | None
    transport_note: str | None


def slip_url(school_year: int, title: str) -> str:
    """園名要整段編碼（非營利園名常有括號、斜線以外的符號）。"""
    return f"{SLIP_ROOT}/slip{school_year}/{quote(CITY)}/{quote(title, safe='')}.json"


def _amount(value: object) -> int | None:
    number = _int_or_none(value)
    return number if number is not None and number >= 0 else None


def _positive(value: object) -> int | None:
    number = _int_or_none(value)
    return number if number is not None and number > 0 else None


def _months(value: object) -> float | None:
    try:
        number = float(str(value).strip())
    except ValueError:
        return None
    return number if math.isfinite(number) and 0.5 <= number <= 12 else None


def _full_day(age_block: object, term: str) -> tuple[dict, object] | None:
    """某一學期的全日班收費表與月數；總收費不是正整數（沒開這個班、沒填）回 None。"""
    semester = age_block.get(term) if isinstance(age_block, dict) else None
    classes = semester.get("class") if isinstance(semester, dict) else None
    table = classes.get("全日班") if isinstance(classes, dict) else None
    if not isinstance(table, dict):
        return None
    total = table.get(TOTAL_ITEM)
    if not isinstance(total, dict) or _positive(total.get("小計")) is None:
        return None
    return table, semester.get("months")


def _cell(table: dict, item: str, field: str) -> object:
    entry = table.get(item)
    return entry.get(field) if isinstance(entry, dict) else None


def parse_slip(data: object) -> list[FeeRow]:
    slip = data.get("slip") if isinstance(data, dict) else None
    if not isinstance(slip, dict):
        raise FeeFormatError("收費檔不是預期的格式")
    rows: list[FeeRow] = []
    for age in FEE_AGES:
        block = slip.get(str(age))
        found = _full_day(block, "上學期") or _full_day(block, "下學期")
        if found is None:
            continue
        table, months = found
        transport = _SPACES.sub(" ", str(_cell(table, TRANSPORT_ITEM, "單價") or "")).strip()[:TRANSPORT_MAX]
        items = {key: _amount(_cell(table, name, "小計")) for key, name in SEMESTER_ITEMS}
        rows.append(
            FeeRow(
                age=age,
                months=_months(months),
                **items,
                semester_total=_positive(_cell(table, TOTAL_ITEM, "小計")),  # _full_day 已確定是正整數
                after_care_monthly=_amount(_cell(table, AFTER_CARE_ITEM, "單價")),
                transport_note=transport or None,
            )
        )
    return rows


def half_up(value: float) -> int:
    """四捨五入到整數（Python 的 round 是銀行家捨入，0.5 會往偶數靠）。只用在正數。"""
    return math.floor(value + 0.5)


def median(values: list[int]) -> int | None:
    """中位數；少於 3 個不算（規格 F14）。偶數個取中間兩個的平均，四捨五入到元。"""
    if len(values) < 3:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return half_up((ordered[middle - 1] + ordered[middle]) / 2)


def monthly_average(total: int, months: Decimal | float | None) -> int | None:
    """月均＝學期總收費 ÷ 月數，四捨五入到元；月數不知道就不算。"""
    if months is None or float(months) <= 0:
        return None
    return half_up(total / float(months))


async def own_fee(
    db: AsyncSession, lat: float, lng: float, *, age: int, radius_m: int
) -> tuple[GeoKindergarten | None, GeoKindergartenFee | None]:
    """本校：距 (lat, lng) radius_m 內最近的營業中園所（規格 F12），以及它這個年齡的收費列（可能沒有）。"""
    dlat = radius_m / _METERS_PER_DEGREE
    dlng = radius_m / (_METERS_PER_DEGREE * math.cos(math.radians(lat)))
    result = await db.execute(
        select(GeoKindergarten).where(
            GeoKindergarten.is_active.is_(True),
            GeoKindergarten.lat.between(lat - dlat, lat + dlat),
            GeoKindergarten.lng.between(lng - dlng, lng + dlng),
        )
    )
    candidates = [(haversine_m(lat, lng, row.lat, row.lng), row) for row in result.scalars()]
    candidates = [(distance, row) for distance, row in candidates if distance <= radius_m]
    if not candidates:
        return None, None
    _, school = min(candidates, key=lambda pair: (pair[0], pair[1].source_id))
    return school, await db.get(GeoKindergartenFee, (school.source_id, age))
```

- [ ] **Step 5: 跑測試**

Run: `BT tests/test_geo_fees.py`
Expected：PASS。

- [ ] **Step 6: Commit**

```bash
git add backend/app/admissions/geo/fees.py backend/tests/geo_helpers.py backend/tests/test_geo_fees.py
git commit -m "feat(admissions): 解析幼兒園收費檔與同業統計工具" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 收費同步（`sync_kindergarten_fees`）

**Files:**
- Modify: `backend/app/admissions/geo/sync.py`
- Modify: `backend/app/workers/geo_loop.py`（`_run` 的摘要集合）
- Modify: `backend/app/cli.py`（`geo_sync_command` 的輸出與失敗清單）
- Modify: `backend/tests/conftest.py`（`_reset_process_caches` 把間隔設 0）
- Create: `backend/tests/test_geo_fees_sync.py`

**Interfaces:**
- Consumes: Task 3 的 `fees.slip_url`、`fees.parse_slip`、`fees.FeeFormatError`；sync.py 既有 `_fetch_capped`、`_record`、`_status`、`_sleep`、`_error_text`、`GeoSyncError`、`current_term`、`today_local`。
- Produces: `sync.sync_kindergarten_fees(session_factory, client, *, now, force) -> tuple[str, int]`（結果、這輪抓到收費的園所數）；常數 `FEES_MAX_BYTES`、`FEES_TIME_BUDGET`、`FEES_REQUEST_GAP_SECONDS`、`FEES_REFRESH_AFTER`、`FEES_TRUNCATION_RATIO`、`FEES_TRUNCATION_MIN`、`FEES_MAX_ERROR_RATIO`、`FEES_INSERT_CHUNK`；`GeoSyncResult` 新欄位 `kindergarten_fees: str = "skipped"`、`kindergarten_fee_schools: int = 0`、`kindergarten_fees_version: str | None = None`。

- [ ] **Step 1: conftest 把請求間隔歸零**

`backend/tests/conftest.py` 的 `_reset_process_caches`：照 `RIS_REQUEST_GAP_SECONDS` 的寫法（存原值 → 設 0.0 → yield 後還原），對 `geo_sync.FEES_REQUEST_GAP_SECONDS` 與 `geo_sync.BABYCARE_DETAIL_GAP_SECONDS`（Task 5 才建立，這一步先只加 FEES；Task 5 再加另一個）做同樣的事。

- [ ] **Step 2: 寫失敗測試**

Create `backend/tests/test_geo_fees_sync.py`：

```python
"""幼兒園收費同步（2026-10-15 規格 §4.2、F6–F10）。"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from urllib.parse import unquote

import httpx
import pytest
from sqlalchemy import delete, func, select, update

from app.admissions.geo import fees as fees_io
from app.admissions.geo import sync
from app.admissions.geo.models import GeoDatasetStatus, GeoKindergarten, GeoKindergartenFee
from tests.geo_helpers import sample_slip
from tests.test_geo_sync import _site, _status, _sync, small_minimum  # noqa: F401


class FeeSite:
    """假的 kiang 收費檔：years 這幾個學年、missing 以外的園所都有檔；overrides[(學年, 園名)] 可換內容；
    errors 的園名回 500。其他網址交給 test_geo_sync 的 _site（門牌、名單、托嬰、人口等）。"""

    def __init__(self, *, years=(114,), missing=(), overrides=None, errors=(), **site):
        self.years, self.missing, self.errors = set(years), set(missing), set(errors)
        self.overrides = dict(overrides or {})
        self.requests: list[tuple[int, str]] = []
        self._base, _ = _site(**site)

    def handle(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        prefix = f"{fees_io.SLIP_ROOT}/slip"
        if not url.startswith(prefix):
            return self._base.handler(request)
        year_text, _, rest = url[len(prefix):].partition("/")
        title = unquote(rest.split("/", 1)[1].removesuffix(".json"))
        year = int(year_text)
        self.requests.append((year, title))
        if title in self.errors:
            return httpx.Response(500)
        if year not in self.years or title in self.missing:
            return httpx.Response(404)
        return httpx.Response(200, json=self.overrides.get((year, title), sample_slip()))

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)


async def _fee_count(app) -> int:
    async with app.state.session_factory() as db:
        return await db.scalar(select(func.count()).select_from(GeoKindergartenFee))


async def _active(app) -> list[tuple[str, str]]:
    async with app.state.session_factory() as db:
        rows = await db.execute(
            select(GeoKindergarten.source_id, GeoKindergarten.name).where(GeoKindergarten.is_active.is_(True)).order_by(GeoKindergarten.source_id)
        )
        return [tuple(row) for row in rows]


async def _fee(app, source_id: str, age: int) -> GeoKindergartenFee | None:
    async with app.state.session_factory() as db:
        return await db.get(GeoKindergartenFee, (source_id, age))


async def _age_status(app, dataset: str, days: int) -> None:
    old = datetime.now(timezone.utc) - timedelta(days=days)
    async with app.state.session_factory() as db:
        await db.execute(update(GeoDatasetStatus).where(GeoDatasetStatus.dataset == dataset).values(checked_at=old, synced_at=old))
        await db.commit()


async def test_first_sync_finds_the_latest_year_and_imports_every_active_school(app, small_minimum):
    site = FeeSite(missing={"高雄市私立何嘉仁幼兒園"})
    result = await _sync(app, site.transport)
    assert result.kindergartens == "updated" and result.kindergarten_fees == "updated"
    active = await _active(app)
    with_fee = [name for _, name in active if name != "高雄市私立何嘉仁幼兒園"]
    assert result.kindergarten_fee_schools == len(with_fee)
    assert await _fee_count(app) == 4 * len(with_fee)  # 每所 2–5 歲各一列
    status = await _status(app, "kindergarten_fees")
    assert (status.active_version, status.label, status.last_error) == ("114", "114", None)
    assert result.kindergarten_fees_version == "114"
    assert {year for year, _ in site.requests} == {115, 114}  # 先試目前學年（115）再退一年


async def test_second_sync_within_seven_days_does_not_touch_the_fees(app, small_minimum):
    site = FeeSite()
    await _sync(app, site.transport)
    site.requests.clear()
    result = await _sync(app, site.transport)
    assert (result.kindergartens, result.kindergarten_fees) == ("skipped", "skipped")
    assert site.requests == []


async def test_fill_in_only_fetches_schools_without_fees_and_keeps_the_others(app, small_minimum):
    site = FeeSite()
    await _sync(app, site.transport)
    (gone_id, _), (kept_id, kept_name), *_ = await _active(app)
    async with app.state.session_factory() as db:
        await db.execute(delete(GeoKindergartenFee).where(GeoKindergartenFee.source_id == gone_id))
        await db.commit()
    site.overrides[(114, kept_name)] = sample_slip(totals={3: 99999})
    await _age_status(app, "kindergartens", 8)  # 名單到期；收費全量還沒到 30 天
    result = await _sync(app, site.transport)
    assert result.kindergarten_fees == "updated"
    assert (await _fee(app, gone_id, 3)).semester_total == 89750  # 補回來了
    assert (await _fee(app, kept_id, 3)).semester_total == 89750  # 補缺不覆寫


async def test_full_refresh_after_thirty_days_overwrites(app, small_minimum):
    site = FeeSite()
    await _sync(app, site.transport)
    (kept_id, kept_name), *_ = await _active(app)
    site.overrides[(114, kept_name)] = sample_slip(totals={3: 99999})
    await _age_status(app, "kindergartens", 8)
    await _age_status(app, "kindergarten_fees", 31)
    await _sync(app, site.transport)
    assert (await _fee(app, kept_id, 3)).semester_total == 99999


async def test_a_new_school_year_replaces_the_whole_table(app, small_minimum):
    site = FeeSite()
    await _sync(app, site.transport)
    site.years = {114, 115}
    await _age_status(app, "kindergartens", 8)
    await _sync(app, site.transport)
    (source_id, _), *_ = await _active(app)
    assert (await _fee(app, source_id, 3)).school_year == 115
    assert (await _status(app, "kindergarten_fees")).label == "115"


async def test_no_year_found_fails_and_the_next_round_retries_even_if_the_list_is_fresh(app, small_minimum):
    site = FeeSite(years=())
    result = await _sync(app, site.transport)
    assert result.kindergarten_fees == "failed"
    assert (await _status(app, "kindergarten_fees")).last_error == "找不到任何學年的收費檔"
    site.years = {114}
    result = await _sync(app, site.transport)
    assert result.kindergartens == "skipped" and result.kindergarten_fees == "updated"  # 從沒匯入過就不等 7 天


async def test_a_full_refresh_that_lost_too_many_schools_keeps_the_old_rows(app, small_minimum, monkeypatch):
    monkeypatch.setattr(sync, "FEES_TRUNCATION_MIN", 2)
    site = FeeSite()
    await _sync(app, site.transport)
    before = await _fee_count(app)
    active = await _active(app)
    site.missing = {name for _, name in active[1:]}  # 只剩一所有檔
    await _age_status(app, "kindergartens", 8)
    await _age_status(app, "kindergarten_fees", 31)
    result = await _sync(app, site.transport)
    assert result.kindergarten_fees == "failed"
    assert await _fee_count(app) == before
    assert (await _status(app, "kindergarten_fees")).last_error == "有收費的園所比上次少了兩成以上，疑似殘缺，未更新"


async def test_too_many_download_errors_keep_the_old_rows(app, small_minimum):
    site = FeeSite()
    await _sync(app, site.transport)
    before = await _fee_count(app)
    site.errors = {name for _, name in (await _active(app))[1:]}
    await _age_status(app, "kindergartens", 8)
    await _age_status(app, "kindergarten_fees", 31)
    result = await _sync(app, site.transport)
    assert result.kindergarten_fees == "failed" and await _fee_count(app) == before
    assert (await _status(app, "kindergarten_fees")).last_error == "收費檔下載錯誤太多，未更新"


async def test_fees_are_not_fetched_when_the_list_failed(app, small_minimum):
    site = FeeSite(kiang=b"not json")
    result = await _sync(app, site.transport)
    assert (result.kindergartens, result.kindergarten_fees) == ("failed", "skipped")
    assert site.requests == []


async def test_running_out_of_time_fails_a_full_refresh(app, small_minimum, monkeypatch):
    monkeypatch.setattr(sync, "FEES_TIME_BUDGET", timedelta(0))
    result = await _sync(app, FeeSite().transport)
    assert result.kindergarten_fees == "failed"
    assert (await _status(app, "kindergarten_fees")).last_error.startswith("收費同步超過")
    assert await _fee_count(app) == 0


async def test_fee_rows_are_inserted_in_chunks(app, small_minimum, monkeypatch):
    monkeypatch.setattr(sync, "FEES_INSERT_CHUNK", 3)  # 正式值避開 asyncpg 32,767 個參數上限
    await _sync(app, FeeSite().transport)
    assert await _fee_count(app) == 4 * len(await _active(app))


async def test_file_mode_never_fetches_fees(app, small_minimum):
    site = FeeSite()
    result = await _sync(app, site.transport, doorplates_file=FIXTURES / "doorplates-sample.csv")
    assert result.kindergarten_fees == "skipped" and site.requests == []


# ---- CLI 與背景迴圈（寫法同 test_geo_babycare_sync.py 的 CLI 段）----


def _patch_cli(app, monkeypatch, result: GeoSyncResult) -> None:
    async def session_factory():
        return app.state.session_factory

    async def fake_run(session_factory, settings, **options):
        return result

    monkeypatch.setattr(cli, "_session_factory", session_factory)
    monkeypatch.setattr(cli, "get_settings", lambda: app.state.settings)
    # cli 若在模組頂端 import run_geo_sync 就換 cli 的；若在函式裡 import 就換 sync 的。兩個都換最保險。
    monkeypatch.setattr(cli, "run_geo_sync", fake_run, raising=False)
    monkeypatch.setattr(sync, "run_geo_sync", fake_run)


async def test_cli_prints_the_fee_result(app, monkeypatch, capsys):
    _patch_cli(app, monkeypatch, GeoSyncResult(
        "skipped", "updated", None, 0, kindergarten_fees="updated", kindergarten_fee_schools=600, kindergarten_fees_version="114",
    ))
    await geo_sync_command(**geo_sync_options([]))
    assert "幼兒園收費：updated（114 學年，這次 600 所）" in capsys.readouterr().out


async def test_cli_exits_1_when_the_fees_failed(app, monkeypatch, capsys):
    async with app.state.session_factory() as db:
        db.add(GeoDatasetStatus(dataset="kindergarten_fees", last_error="找不到任何學年的收費檔"))
        await db.commit()
    _patch_cli(app, monkeypatch, GeoSyncResult("skipped", "updated", None, 0, kindergarten_fees="failed"))
    with pytest.raises(SystemExit) as caught:
        await geo_sync_command(**geo_sync_options([]))
    assert caught.value.code == 1
    assert "幼兒園收費同步失敗：找不到任何學年的收費檔" in capsys.readouterr().err


async def test_the_loop_summarises_a_round_when_only_the_fees_were_updated(app, monkeypatch, caplog):
    ran = asyncio.Event()

    async def fake_sync(session_factory, settings, **kwargs):
        ran.set()
        return GeoSyncResult("skipped", "skipped", None, 0, kindergarten_fees="updated")

    monkeypatch.setattr(geo_loop, "run_geo_sync", fake_sync)
    loop = GeoSyncLoop(app.state.session_factory, app.state.settings, check_seconds=3600, first_delay_seconds=0)
    with caplog.at_level(logging.INFO, logger="app.admissions.geo.loop"):
        loop.start()
        await asyncio.wait_for(ran.wait(), 10)
        await loop.stop()
    assert any("kindergarten_fees='updated'" in record.getMessage() for record in caplog.records)
```

檔頭 import 補上：`import asyncio`、`import logging`、`from app import cli`、`from app.admissions.geo.sync import GeoSyncResult`、`from app.cli import geo_sync_command, geo_sync_options`、`from app.workers import geo_loop`、`from app.workers.geo_loop import GeoSyncLoop`、`from tests.geo_helpers import FIXTURES, sample_slip`（取代原本只 import `sample_slip` 的那行）。

- [ ] **Step 3: 跑測試確認紅燈**

Run: `BT tests/test_geo_fees_sync.py`
Expected：FAIL（`AttributeError: 'GeoSyncResult' object has no attribute 'kindergarten_fees'`）。

- [ ] **Step 4: 實作 sync.py**

1. import：`from sqlalchemy import func, select, text` 改成 `from sqlalchemy import delete, func, select, text, update`；加 `from sqlalchemy.dialects.postgresql import insert as pg_insert`；加 `from app.admissions.geo import fees as fees_io`；models import 加 `GeoKindergarten, GeoKindergartenFee`（`GeoBabycare` 留給 Task 5）。
2. 常數區（`BABYCARE_TIME_BUDGET` 附近）加：

```python
# 幼兒園收費（2026-10-15 附近同業比較 §4.2）：一所一檔，正常 37 KB；全量約 624 檔，每個請求隔 0.2 秒。
FEES_MAX_BYTES = 512 * 1024
FEES_TIME_BUDGET = timedelta(minutes=20)
FEES_REQUEST_GAP_SECONDS = 0.2
FEES_REFRESH_AFTER = timedelta(days=30)  # 規格 F7：距上次全量 30 天就全量重抓
FEES_LOOKBACK_YEARS = 3  # 規格 F6：從目前學年往回試三年
FEES_PROBES = 5
FEES_TRUNCATION_RATIO = 0.8  # 規格 F9
FEES_TRUNCATION_MIN = 20
FEES_MAX_ERROR_RATIO = 0.1
FEES_INSERT_CHUNK = 1000  # 一列 14 個參數；asyncpg 單一語句上限 32,767 個
FEES_SHRUNK_MESSAGE = "有收費的園所比上次少了兩成以上，疑似殘缺，未更新"
```

3. `GeoSyncResult` 加欄位（放在 babycare 那組後面）：

```python
    # 幼兒園收費（2026-10-15）：結果、這一輪抓到收費的園所數、使用中的收費學年。
    kindergarten_fees: str = "skipped"
    kindergarten_fee_schools: int = 0
    kindergarten_fees_version: str | None = None
```

4. `_error_text` 的 `own` tuple 加 `fees_io.FeeFormatError`。
5. `sync_babycare` 之後新增：

```python
async def _fetch_slip(client: httpx.AsyncClient, url: str) -> dict | None:
    """一所的收費檔：404 回 None（沒有公布收費）；其他錯誤照丟。"""
    try:
        body, _ = await _fetch_capped(client, url, max_bytes=FEES_MAX_BYTES)
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            return None
        raise
    return json.loads(body)


async def _latest_fee_year(client: httpx.AsyncClient, titles: list[str], current_year: int) -> int | None:
    """規格 F6：從目前學年往回試，探測園所裡有一所的檔案存在，那一年就是最新學年。探測時的網路錯誤當作這所沒有。"""
    for year in range(current_year, current_year - FEES_LOOKBACK_YEARS, -1):
        for title in titles:
            try:
                found = await _fetch_slip(client, fees_io.slip_url(year, title))
            except Exception:  # noqa: BLE001 - 換下一所再試
                found = None
            await _sleep(FEES_REQUEST_GAP_SECONDS)
            if found is not None:
                return year
    return None


async def fees_never_imported(session_factory: async_sessionmaker[AsyncSession]) -> bool:
    status = await _status(session_factory, "kindergarten_fees")
    return status is None or status.active_version is None


async def sync_kindergarten_fees(
    session_factory: async_sessionmaker[AsyncSession],
    client: httpx.AsyncClient,
    *,
    now: datetime,
    force: bool,
) -> tuple[str, int]:
    """幼兒園收費（2026-10-15 規格 §4.2）。回傳 (結果, 這一輪抓到收費的園所數)。
    全量（學年換新、距上次全量 30 天、--force、從沒匯入）通過門檻才整表替換；補缺只新增沒有收費列的園所。"""
    deadline = time.monotonic() + FEES_TIME_BUDGET.total_seconds()
    try:
        async with session_factory() as db:
            schools = (
                await db.execute(
                    select(GeoKindergarten.source_id, GeoKindergarten.name, GeoKindergarten.kind)
                    .where(GeoKindergarten.is_active.is_(True))
                    .order_by(GeoKindergarten.source_id)
                )
            ).all()
            existing = set((await db.execute(select(GeoKindergartenFee.source_id).distinct())).scalars())
            status = await db.get(GeoDatasetStatus, "kindergarten_fees")
            stored_year = int(status.active_version) if status is not None and status.active_version else None
            last_full = status.synced_at if status is not None else None
        probes = [name for source_id, name, _ in schools if source_id in existing][:FEES_PROBES] or [
            name for _, name, kind in schools if kind in ("private", "quasi_public")
        ][:FEES_PROBES]
        current_year, _ = current_term(today_local(now))
        year = await _latest_fee_year(client, probes, current_year)
        if year is None:
            raise GeoSyncError("找不到任何學年的收費檔")
        full = (
            force or stored_year is None or year > stored_year
            or last_full is None or now - last_full >= FEES_REFRESH_AFTER
        )
        targets = schools if full else [school for school in schools if school[0] not in existing]
        fetched: dict[str, list[fees_io.FeeRow]] = {}
        errors = 0
        timed_out = False
        for source_id, name, _ in targets:
            if time.monotonic() > deadline:
                timed_out = True
                break
            try:
                data = await _fetch_slip(client, fees_io.slip_url(year, name))
                rows = fees_io.parse_slip(data) if data is not None else []
            except Exception as exc:  # noqa: BLE001 - 一所壞掉不擋整輪，只計數
                errors += 1
                logger.warning("收費檔下載或解析失敗：%s", _error_text(exc))
            else:
                if rows:
                    fetched[source_id] = rows
            await _sleep(FEES_REQUEST_GAP_SECONDS)
        minutes = int(FEES_TIME_BUDGET.total_seconds() // 60)
        if full:
            if timed_out:
                raise GeoSyncError(f"收費同步超過 {minutes} 分鐘，已中止")
            if errors > len(targets) * FEES_MAX_ERROR_RATIO:
                raise GeoSyncError("收費檔下載錯誤太多，未更新")
            if len(existing) >= FEES_TRUNCATION_MIN and len(fetched) < len(existing) * FEES_TRUNCATION_RATIO:
                raise GeoSyncError(FEES_SHRUNK_MESSAGE)
        values = [
            {
                "source_id": source_id, "age": row.age, "school_year": year, "months": row.months,
                "tuition": row.tuition, "misc_fee": row.misc_fee, "materials": row.materials,
                "activities": row.activities, "lunch": row.lunch, "snack": row.snack,
                "semester_total": row.semester_total, "after_care_monthly": row.after_care_monthly,
                "transport_note": row.transport_note, "synced_at": now,
            }
            for source_id, rows in fetched.items()
            for row in rows
        ]
        async with session_factory() as db:
            if full:
                await db.execute(delete(GeoKindergartenFee))
            for start in range(0, len(values), FEES_INSERT_CHUNK):
                await db.execute(
                    pg_insert(GeoKindergartenFee).values(values[start:start + FEES_INSERT_CHUNK]).on_conflict_do_nothing()
                )
            record = await db.get(GeoDatasetStatus, "kindergarten_fees", with_for_update=True)
            if record is None:
                record = GeoDatasetStatus(dataset="kindergarten_fees")
                db.add(record)
            record.last_attempt_at = now
            record.checked_at = now
            record.last_error = None
            if full:
                record.active_version = str(year)
                record.label = str(year)
                record.synced_at = now
            await db.commit()
        if timed_out:  # 補缺：抓到的已經寫入，但這一輪算失敗
            await _record(session_factory, "kindergarten_fees", now=now, error=f"收費同步超過 {minutes} 分鐘，已中止")
            return "failed", len(fetched)
        logger.info(
            "幼兒園收費已更新：%s 學年，%s，這次抓到 %s 所、下載錯誤 %s 所",
            year, "全量" if full else "補缺", len(fetched), errors,
        )
        return "updated", len(fetched)
    except Exception as exc:  # noqa: BLE001
        logger.warning("幼兒園收費同步失敗：%s", _error_text(exc), exc_info=True)
        await _record(session_factory, "kindergarten_fees", now=now, error=_error_text(exc))
        return "failed", 0
```

6. `run_geo_sync`：`kindergartens, kindergarten_skipped = await _within_budget(...)` 之後加：

```python
            kindergarten_fees, kindergarten_fee_schools = "skipped", 0
            # 收費只在名單這一輪更新成功後做；從沒匯入過（上線第一輪）不等名單的 7 天（計畫 Task 4）。
            if network is not None and kindergartens != "failed" and (
                kindergartens == "updated" or await fees_never_imported(session_factory)
            ):
                kindergarten_fees, kindergarten_fee_schools = await sync_kindergarten_fees(
                    session_factory, network, now=now, force=force
                )
```

在 `finally:` 區塊之後、`return GeoSyncResult(...)` 之前加 `fees_status = await _status(session_factory, "kindergarten_fees")`；`GeoSyncResult(...)` 的參數加：

```python
            kindergarten_fees=kindergarten_fees, kindergarten_fee_schools=kindergarten_fee_schools,
            kindergarten_fees_version=fees_status.label if fees_status is not None else None,
```

- [ ] **Step 5: geo_loop 與 CLI**

`backend/app/workers/geo_loop.py` `_run` 的集合加 `result.kindergarten_fees,`（放在 `result.kindergartens,` 後面）。

`backend/app/cli.py` `geo_sync_command`：

- 第一個 `print(...)` 的 `f"幼兒園：{result.kindergartens}；"` 後面加：

```python
        f"幼兒園收費：{result.kindergarten_fees}（{result.kindergarten_fees_version + ' 學年' if result.kindergarten_fees_version else '尚未匯入'}，這次 {result.kindergarten_fee_schools} 所）；"
```

- `failed` 清單的 tuple 加 `("kindergarten_fees", "幼兒園收費", result.kindergarten_fees),`（放在 kindergartens 後面）。

- [ ] **Step 6: 跑測試**

Run: `BT tests/test_geo_fees_sync.py tests/test_geo_sync.py tests/test_geo_babycare_sync.py tests/test_geo_loop.py tests/test_geo_limits.py`
Expected：PASS。若 `test_geo_loop.py` 有精確比對 `GeoSyncResult` 欄位或選項字典的測試紅了，照新欄位補上（不是改壞，是多了欄位）。

- [ ] **Step 7: Commit**

```bash
git add backend/app/admissions/geo/sync.py backend/app/workers/geo_loop.py backend/app/cli.py backend/tests/conftest.py backend/tests/test_geo_fees_sync.py backend/tests/test_geo_babycare_sync.py backend/tests/test_geo_loop.py
git commit -m "feat(admissions): 背景同步抓幼兒園收費（找最新學年、全量／補缺、殘缺不換版）" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

（`test_geo_loop.py`、`test_geo_babycare_sync.py` 沒改到就不要 add。）

---

### Task 5: 托嬰逐所明細

**Files:**
- Modify: `backend/app/admissions/geo/babycare.py`
- Modify: `backend/app/admissions/geo/sync.py`
- Modify: `backend/tests/conftest.py`（`BABYCARE_DETAIL_GAP_SECONDS` 歸零）
- Create: `backend/tests/fixtures/geo/babycare-detail-sample.json`
- Create: `backend/tests/test_geo_babycare_details.py`

**Interfaces:**
- Consumes: Task 1 的 `GeoBabycare` 新欄位；sync.py 的 `_fetch_capped`、`_sleep`、`_error_text`。
- Produces: `babycare.DETAIL_ROOT`、`babycare.detail_url(source_id) -> str`、`@dataclass(frozen=True) BabycareDetail(monthly_fee, fee_note, evaluation_grade, evaluation_year, quasi_public)`、`babycare.parse_babycare_detail(data) -> BabycareDetail`；`NearbyBabycare` 新欄位 `monthly_fee: int | None`、`fee_note: str | None`、`evaluation_grade: str | None`、`evaluation_year: int | None`、`quasi_public: bool | None`（預設 None）；`sync.sync_babycare_details(session_factory, client, *, now) -> int`；`GeoSyncResult.babycare_details: int = 0`。

- [ ] **Step 1: 測試樣本**

Create `backend/tests/fixtures/geo/babycare-detail-sample.json`（真實檔的結構；負責人、電話、退費說明換成樣本字）：

```json
{
 "id": "CW10112243",
 "機構名稱": "高雄市私立劍聲托嬰中心",
 "所在地": "830高雄市鳳山區中和里高雄市鳳山區中山西路233號2樓",
 "同一地址註記": "　　",
 "負責人姓名": "樣本不放負責人",
 "聯絡電話": "07-0000000",
 "核定收托": 20,
 "實際收托": 15,
 "評鑑等級": "乙等",
 "最近一次評鑑年度": "114",
 "總面積": "145.11 平方公尺",
 "室內面積": "112.16 平方公尺",
 "室外面積": "0 平方公尺",
 "準公共資格": "是",
 "核備工作人員數": {"主管人員": "1", "托育人員": "5"},
 "收費情形": {
  "日間托育": [
   {"費用名稱": "托育費", "費用金額": "18375", "費用說明": "平均月費: 18,375元(內含每學期註冊費16,500元＋月費:14,515元＋每月餐點費1,110元)"},
   {"費用名稱": "其他", "費用金額": "0", "費用說明": "平均月費0-未滿4個月無提供副食品，則扣除餐點費1,110元"}
  ]
 },
 "退費說明": "（樣本略）",
 "違反法令紀錄": [],
 "latitude": 22.627636,
 "longitude": 120.348196
}
```

- [ ] **Step 2: 寫失敗測試**

Create `backend/tests/test_geo_babycare_details.py`：

```python
"""托嬰逐所明細：月費、評鑑、準公共（2026-10-15 規格 §4.3、F11）。"""

from __future__ import annotations

import copy
import json
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

import httpx
import pytest
from sqlalchemy import select

from app.admissions.geo import babycare, sync
from app.admissions.geo.models import GeoBabycare
from tests.geo_helpers import FIXTURES
from tests.test_geo_sync import _site, _sync, small_minimum  # noqa: F401

DETAIL = json.loads((FIXTURES / "babycare-detail-sample.json").read_text(encoding="utf-8"))


def test_detail_is_parsed():
    detail = babycare.parse_babycare_detail(DETAIL)
    assert (detail.monthly_fee, detail.evaluation_grade, detail.evaluation_year, detail.quasi_public) == (18375, "乙等", 114, True)
    assert detail.fee_note == "平均月費: 18,375元(內含每學期註冊費16,500元＋月費:14,515元＋每月餐點費1,110元)"
    assert set(vars(detail)) == {"monthly_fee", "fee_note", "evaluation_grade", "evaluation_year", "quasi_public"}


@pytest.mark.parametrize(
    ("changes", "expected"),
    [
        ({"收費情形": {"日間托育": [{"費用名稱": "其他", "費用金額": "100", "費用說明": "x"}]}}, (None, None)),
        ({"收費情形": {"日間托育": [{"費用名稱": " 托育費 ", "費用金額": "0", "費用說明": " a \n b "}]}}, (None, "a b")),
        ({"收費情形": {"日間托育": [{"費用名稱": "托育費", "費用金額": "abc", "費用說明": ""}]}}, (None, None)),
        ({"收費情形": {}}, (None, None)),
        ({"收費情形": {"日間托育": [{"費用名稱": "托育費", "費用金額": "17,900", "費用說明": "說" * 300}]}}, (17900, "說" * 200)),
    ],
)
def test_fee_and_note(changes, expected):
    data = {**copy.deepcopy(DETAIL), **changes}
    detail = babycare.parse_babycare_detail(data)
    assert (detail.monthly_fee, detail.fee_note) == expected


@pytest.mark.parametrize(
    ("grade", "year", "quasi", "expected"),
    [("　　", "", "", (None, None, None)), ("優等", "99", "否", ("優等", 99, False)), ("很長很長很長很長很長", "114年", "不明", (None, None, None))],
)
def test_grade_year_and_quasi_public(grade, year, quasi, expected):
    data = {**DETAIL, "評鑑等級": grade, "最近一次評鑑年度": year, "準公共資格": quasi}
    detail = babycare.parse_babycare_detail(data)
    assert (detail.evaluation_grade, detail.evaluation_year, detail.quasi_public) == expected


@pytest.mark.parametrize("data", [None, [], "x"])
def test_unexpected_shape_is_rejected(data):
    with pytest.raises(babycare.BabycareFormatError):
        babycare.parse_babycare_detail(data)


def test_detail_url():
    assert babycare.detail_url("CW10112243") == f"{babycare.DETAIL_ROOT}/{quote('高雄市')}/CW10112243.json"


class DetailSite:
    def __init__(self, *, errors=(), fee: str = "18375"):
        self.errors, self.fee = set(errors), fee
        self.requests: list[str] = []
        self._base, _ = _site()

    def handle(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if not url.startswith(babycare.DETAIL_ROOT):
            return self._base.handler(request)
        source_id = url.rsplit("/", 1)[1].removesuffix(".json")
        self.requests.append(source_id)
        if source_id in self.errors:
            return httpx.Response(500)
        data = copy.deepcopy(DETAIL)
        data["id"] = source_id
        data["收費情形"]["日間托育"][0]["費用金額"] = self.fee
        return httpx.Response(200, json=data)

    @property
    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)


async def _rows(app) -> dict[str, GeoBabycare]:
    async with app.state.session_factory() as db:
        return {row.source_id: row for row in (await db.execute(select(GeoBabycare).where(GeoBabycare.is_active.is_(True)))).scalars()}


async def test_first_sync_fills_every_active_center_and_a_failure_keeps_the_rest(app, small_minimum):
    first_id = "CW10203013"  # 樣本裡營業中的三民公共托嬰中心
    site = DetailSite(errors={first_id})
    result = await _sync(app, site.transport)
    assert result.babycare == "updated"
    rows = await _rows(app)
    assert result.babycare_details == len(rows) - 1
    assert rows[first_id].monthly_fee is None
    assert all(row.monthly_fee == 18375 and row.quasi_public is True for key, row in rows.items() if key != first_id)


async def test_details_are_not_fetched_again_until_the_list_is_due(app, small_minimum):
    site = DetailSite()
    await _sync(app, site.transport)
    site.requests.clear()
    result = await _sync(app, site.transport)
    assert (result.babycare, result.babycare_details, site.requests) == ("skipped", 0, [])


async def test_a_failed_detail_keeps_the_old_value(app, small_minimum):
    site = DetailSite()
    await _sync(app, site.transport)
    site.errors = set((await _rows(app)).keys())
    async with httpx.AsyncClient(transport=site.transport) as client:
        updated = await sync.sync_babycare_details(app.state.session_factory, client, now=datetime.now(timezone.utc))
    assert updated == 0
    assert all(row.monthly_fee == 18375 for row in (await _rows(app)).values())


async def test_running_out_of_time_stops_quietly(app, small_minimum, monkeypatch):
    monkeypatch.setattr(sync, "BABYCARE_DETAIL_TIME_BUDGET", timedelta(0))
    result = await _sync(app, DetailSite().transport)
    assert (result.babycare, result.babycare_details) == ("updated", 0)


async def test_nearby_returns_the_details(db_session):
    from tests.geo_helpers import load_babycare_sample

    await load_babycare_sample(db_session)
    await db_session.execute(GeoBabycare.__table__.update().values(monthly_fee=17900, evaluation_grade="優等", evaluation_year=114, quasi_public=True, fee_note="平均月費"))
    await db_session.commit()
    items = await babycare.nearby(db_session, 22.6424556, 120.3437133, 3000)
    assert (items[0].monthly_fee, items[0].evaluation_grade, items[0].evaluation_year, items[0].quasi_public, items[0].fee_note) == (17900, "優等", 114, True, "平均月費")
```

- [ ] **Step 3: 跑測試確認紅燈**

Run: `BT tests/test_geo_babycare_details.py`
Expected：FAIL（`AttributeError: module 'app.admissions.geo.babycare' has no attribute 'parse_babycare_detail'`）。

- [ ] **Step 4: 實作 babycare.py**

1. import 加 `from urllib.parse import quote`。docstring 尾端補「2026-10-15 起另抓逐所明細（`data/高雄市/<id>.json`）的月費、評鑑、準公共；負責人、電話、違反法令紀錄、退費說明不讀（附近同業比較規格 §4.3）。」
2. 常數加：

```python
DETAIL_ROOT = "https://kiang.github.io/ncwisweb.sfaa.gov.tw/data"
_DETAIL_CITY = "高雄市"
_FEE_NAME = "托育費"
_NOTE_MAX = 200
_GRADE_MAX = 8
_YEAR = re.compile(r"[0-9]{2,3}")
_SPACES = re.compile(r"\s+")
```

3. `NearbyBabycare` 尾端加五個欄位（都 `= None`）。`nearby()` 建構時多傳 `monthly_fee=row.monthly_fee, fee_note=row.fee_note, evaluation_grade=row.evaluation_grade, evaluation_year=row.evaluation_year, quasi_public=row.quasi_public`。
4. 新增：

```python
@dataclass(frozen=True)
class BabycareDetail:
    monthly_fee: int | None
    fee_note: str | None
    evaluation_grade: str | None
    evaluation_year: int | None
    quasi_public: bool | None


def detail_url(source_id: str) -> str:
    return f"{DETAIL_ROOT}/{quote(_DETAIL_CITY)}/{quote(source_id, safe='')}.json"


def parse_babycare_detail(data: object) -> BabycareDetail:
    """逐所明細 → 五個欄位（規格 F11）。只讀收費情形、評鑑等級、最近一次評鑑年度、準公共資格。"""
    if not isinstance(data, dict):
        raise BabycareFormatError("托嬰明細不是預期的格式")
    fee: int | None = None
    note: str | None = None
    charges = data.get("收費情形")
    daytime = charges.get("日間托育") if isinstance(charges, dict) else None
    for entry in daytime if isinstance(daytime, list) else []:
        if isinstance(entry, dict) and str(entry.get("費用名稱") or "").strip() == _FEE_NAME:
            amount = _int_or_none(entry.get("費用金額"))
            fee = amount if amount is not None and amount > 0 else None
            note = _SPACES.sub(" ", str(entry.get("費用說明") or "")).strip()[:_NOTE_MAX] or None
            break
    grade = str(data.get("評鑑等級") or "").strip()
    year = str(data.get("最近一次評鑑年度") or "").strip()
    quasi = str(data.get("準公共資格") or "").strip()
    return BabycareDetail(
        monthly_fee=fee,
        fee_note=note,
        evaluation_grade=grade if grade and len(grade) <= _GRADE_MAX else None,
        evaluation_year=int(year) if _YEAR.fullmatch(year) else None,
        quasi_public=True if quasi == "是" else False if quasi == "否" else None,
    )
```

- [ ] **Step 5: 實作 sync.py**

1. import：`from dataclasses import asdict, dataclass`（加 `asdict`）；`from app.admissions.geo import babycare as babycare_io`；models import 加 `GeoBabycare`。
2. 常數：

```python
BABYCARE_DETAIL_MAX_BYTES = 256 * 1024  # 托嬰逐所明細（正常約 5 KB）
BABYCARE_DETAIL_TIME_BUDGET = timedelta(minutes=5)
BABYCARE_DETAIL_GAP_SECONDS = 0.2
```

3. `GeoSyncResult` 加 `babycare_details: int = 0  # 這一輪更新了明細的托嬰數（2026-10-15）`。
4. 新增：

```python
async def babycare_details_missing(session_factory: async_sessionmaker[AsyncSession]) -> bool:
    """有營業中的托嬰、卻沒有一所抓過明細（上線第一輪）。"""
    async with session_factory() as db:
        active = await db.scalar(select(func.count()).select_from(GeoBabycare).where(GeoBabycare.is_active.is_(True)))
        filled = await db.scalar(
            select(func.count()).select_from(GeoBabycare).where(GeoBabycare.is_active.is_(True), GeoBabycare.quasi_public.is_not(None))
        )
    return bool(active) and not filled


async def sync_babycare_details(
    session_factory: async_sessionmaker[AsyncSession], client: httpx.AsyncClient, *, now: datetime
) -> int:
    """托嬰逐所明細（2026-10-15 規格 §4.3）：回傳更新了幾所。單所失敗保留舊值；超過時間上限就停，
    還沒抓的下一輪再抓。不改 babycare 的同步結果與狀態列。"""
    deadline = time.monotonic() + BABYCARE_DETAIL_TIME_BUDGET.total_seconds()
    async with session_factory() as db:
        ids = (
            await db.execute(
                select(GeoBabycare.source_id).where(GeoBabycare.is_active.is_(True)).order_by(GeoBabycare.source_id)
            )
        ).scalars().all()
    updated = failed = 0
    for source_id in ids:
        if time.monotonic() > deadline:
            logger.warning("托嬰明細超過時間上限，這一輪先停：還有 %s 所沒抓", len(ids) - updated - failed)
            break
        try:
            body, _ = await _fetch_capped(client, babycare_io.detail_url(source_id), max_bytes=BABYCARE_DETAIL_MAX_BYTES)
            detail = babycare_io.parse_babycare_detail(json.loads(body))
        except Exception as exc:  # noqa: BLE001 - 一所壞掉不擋其他
            failed += 1
            logger.warning("托嬰明細下載或解析失敗：%s", _error_text(exc))
        else:
            async with session_factory() as db:
                await db.execute(update(GeoBabycare).where(GeoBabycare.source_id == source_id).values(**asdict(detail)))
                await db.commit()
            updated += 1
        await _sleep(BABYCARE_DETAIL_GAP_SECONDS)
    logger.info("托嬰明細已更新：%s 所，失敗 %s 所", updated, failed)
    return updated
```

5. `run_geo_sync`：`babycare, babycare_skipped = await _within_budget(...)` 之後加：

```python
            babycare_details = 0
            if network is not None and babycare != "failed" and (
                babycare == "updated" or await babycare_details_missing(session_factory)
            ):
                babycare_details = await sync_babycare_details(session_factory, network, now=now)
```

`GeoSyncResult(...)` 參數加 `babycare_details=babycare_details,`。

6. `_error_text` 的 `own` 不用改（`BabycareFormatError` 已在）。

- [ ] **Step 6: conftest 歸零第二個間隔**

照 Task 4 Step 1 的寫法，在 `_reset_process_caches` 把 `geo_sync.BABYCARE_DETAIL_GAP_SECONDS` 設 0.0、yield 後還原。

- [ ] **Step 7: 跑測試**

Run: `BT tests/test_geo_babycare_details.py tests/test_geo_babycare.py tests/test_geo_babycare_sync.py tests/test_geo_sync.py`
Expected：PASS。`test_geo_babycare_sync.py` 若有「同步時請求過的網址」精確比對而紅了，把明細網址納入預期（是新行為，不是改壞）。

- [ ] **Step 8: Commit**

```bash
git add backend/app/admissions/geo/babycare.py backend/app/admissions/geo/sync.py backend/tests/conftest.py backend/tests/fixtures/geo/babycare-detail-sample.json backend/tests/test_geo_babycare_details.py
git commit -m "feat(admissions): 托嬰同步多抓逐所月費、評鑑等級與準公共" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 同業收費計算與托嬰月費摘要（服務層）

**Files:**
- Create: `backend/app/admissions/peer_fees.py`
- Modify: `backend/app/admissions/area.py`（`query_babycare` 摘要）
- Modify: `backend/app/admissions/geo/kindergartens.py`（`SOURCE_NOTE` 拿掉「月費為估計值」）
- Create: `backend/tests/peer_fees_helpers.py`
- Create: `backend/tests/test_admissions_peer_fees.py`

**Interfaces:**
- Consumes: Task 3 `fees.median`、`fees.monthly_average`、`fees.own_fee`、`fees.ITEM_KEYS`、`fees.SOURCE_NOTE`；`area.campus_out`、`area.OWN_CAMPUS_RADIUS_M`；`matcher.campus_points`；`kindergartens.nearby`。
- Produces: `peer_fees.AGE_CHOICES`、`peer_fees.GROUP_ORDER = ("private", "quasi_public", "public", "nonprofit")`、`async peer_fees.query_peer_fees(db, campus_key, *, radius_km, age) -> dict`（鍵見規格 §6；群組的範圍用 `lowest`、`highest`，不用 `min`／`max`，避免遮蔽內建名稱）；`area.query_babycare` 的 `summary` 多 `fee_count`、`fee_median`、`fee_min`、`fee_max`、`own_age2_monthly`、`fee_school_year`。

- [ ] **Step 1: 共用測試資料**

Create `backend/tests/peer_fees_helpers.py`：

```python
"""附近同業收費的測試資料：義華周邊自己放幾所幼兒園與收費（不依賴樣本名單裡有哪幾所）。"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import delete

from app.admissions.geo.models import GeoDatasetStatus, GeoKindergarten, GeoKindergartenFee
from tests.geo_helpers import YIHUA_POINT, load_geo_samples, publish_campus_address

OWN_ITEMS = {"tuition": 19900, "misc_fee": 5500, "materials": 24750, "activities": 23100, "lunch": 8250, "snack": 8250, "after_care_monthly": 1200}


def add_kindergarten(db, source_id: str, name: str, kind: str, north_m: float, **extra) -> None:
    lat, lng = YIHUA_POINT
    db.add(GeoKindergarten(
        source_id=source_id, name=name, kind=kind, district="三民區", address="某路1號",
        lat=lat + north_m / 111_320.0, lng=lng, approved_capacity=extra.pop("approved_capacity", 100),
        has_penalty=False, is_active=extra.pop("is_active", True), synced_at=datetime.now(timezone.utc), **extra,
    ))


def add_fee(db, source_id: str, age: int, total: int, *, months: Decimal | None = Decimal("5.5"), school_year: int = 114, **items) -> None:
    db.add(GeoKindergartenFee(
        source_id=source_id, age=age, school_year=school_year, months=months, semester_total=total,
        synced_at=datetime.now(timezone.utc), **items,
    ))


@pytest.fixture
async def peers(db_session):
    """義華（門牌樣本座標）周邊：本校、私立 4 所（1 所沒收費）、準公共、公立、非營利各 1、4 公里外私立 1、停辦 1。
    3 歲收費：本校 89,750；私立 75,000／93,000／40,200；準公共 63,190；公立 17,965；4 公里外 120,000；停辦 999,999。"""
    await load_geo_samples(db_session)
    await publish_campus_address(db_session, "yihua", "高雄市三民區義華路68號")
    await db_session.execute(delete(GeoKindergartenFee))
    await db_session.execute(delete(GeoKindergarten))
    add_kindergarten(db_session, "own", "高雄市私立常春藤幼兒園", "private", 0, approved_capacity=210)
    add_kindergarten(db_session, "p1", "高雄市私立甲幼兒園", "private", 300)
    add_kindergarten(db_session, "p2", "高雄市私立乙幼兒園", "private", 600)
    add_kindergarten(db_session, "p3", "高雄市私立丙幼兒園", "private", 900)
    add_kindergarten(db_session, "p4", "高雄市私立丁幼兒園", "private", 1200)
    add_kindergarten(db_session, "q1", "高雄市私立戊幼兒園", "quasi_public", 400, pre_public_period="113-115")
    add_kindergarten(db_session, "pub", "高雄市立己幼兒園", "public", 500)
    add_kindergarten(db_session, "np", "高雄市庚非營利幼兒園", "nonprofit", 700)
    add_kindergarten(db_session, "far", "高雄市私立遠幼兒園", "private", 4000)
    add_kindergarten(db_session, "gone", "高雄市私立停幼兒園", "private", 200, is_active=False)
    await db_session.flush()
    add_fee(db_session, "own", 3, 89750, **OWN_ITEMS, transport_note="單 770 雙 1540")
    add_fee(db_session, "own", 2, 105950)
    add_fee(db_session, "p1", 3, 75000, tuition=15000)
    add_fee(db_session, "p2", 3, 93000, tuition=16000)
    add_fee(db_session, "p3", 3, 40200, tuition=12000, months=None)
    add_fee(db_session, "q1", 3, 63190)
    add_fee(db_session, "pub", 3, 17965)
    add_fee(db_session, "far", 3, 120000)
    add_fee(db_session, "gone", 3, 999999)
    now = datetime.now(timezone.utc)
    db_session.add(GeoDatasetStatus(dataset="kindergarten_fees", active_version="114", label="114", synced_at=now, checked_at=now))
    await db_session.commit()
```

- [ ] **Step 2: 寫失敗測試**

Create `backend/tests/test_admissions_peer_fees.py`：

```python
"""附近同業收費的計算（2026-10-15 規格 §5、F12–F14）與托嬰月費摘要。"""

from __future__ import annotations

from sqlalchemy import delete, select, update

from app.admissions import area, peer_fees
from app.admissions.academic import current_term
from app.admissions.geo.models import GeoBabycare, GeoDatasetStatus, GeoKindergarten, GeoKindergartenFee
from app.common.timezones import today_local
from tests.geo_helpers import load_babycare_sample
from tests.peer_fees_helpers import OWN_ITEMS, peers  # noqa: F401


def _group(result, kind):
    return next(group for group in result["groups"] if group["kind"] == kind)


async def test_private_group_median_range_and_rank(db_session, peers):
    result = await peer_fees.query_peer_fees(db_session, "yihua", radius_km=3, age=3)
    assert (result["school_year"], result["age"], result["radius_km"]) == (114, 3, 3)
    assert result["current_school_year"] == current_term(today_local())[0]
    assert _group(result, "private") == {
        "kind": "private", "schools": 4, "with_fee": 3, "median": 75000, "lowest": 40200, "highest": 93000,
        "own_rank": 2, "rank_total": 4,
    }
    assert [group["kind"] for group in result["groups"]] == ["private", "quasi_public", "public", "nonprofit"]


async def test_other_kinds_are_background_only(db_session, peers):
    result = await peer_fees.query_peer_fees(db_session, "yihua", radius_km=3, age=3)
    assert _group(result, "quasi_public") == {
        "kind": "quasi_public", "schools": 1, "with_fee": 1, "median": None, "lowest": 63190, "highest": 63190,
        "own_rank": None, "rank_total": None,
    }
    assert (_group(result, "nonprofit")["schools"], _group(result, "nonprofit")["with_fee"]) == (1, 0)


async def test_the_radius_decides_who_counts(db_session, peers):
    result = await peer_fees.query_peer_fees(db_session, "yihua", radius_km=6, age=3)
    group = _group(result, "private")
    assert (group["with_fee"], group["median"], group["own_rank"], group["rank_total"]) == (4, 84000, 3, 5)


async def test_own_school_and_items(db_session, peers):
    result = await peer_fees.query_peer_fees(db_session, "yihua", radius_km=3, age=3)
    assert result["own"] == {
        "source_id": "own", "name": "高雄市私立常春藤幼兒園", "semester_total": 89750, "months": 5.5,
        "monthly_average": 16318, "items": OWN_ITEMS, "transport_note": "單 770 雙 1540",
    }
    assert result["own_missing"] is None
    items = {item["key"]: item for item in result["items"]}
    assert list(items) == ["tuition", "misc_fee", "materials", "activities", "lunch", "snack", "after_care_monthly"]
    assert items["tuition"] == {"key": "tuition", "own": 19900, "peer_median": 15000, "peer_count": 3}
    assert items["snack"] == {"key": "snack", "own": 8250, "peer_median": None, "peer_count": 0}


async def test_schools_list_everyone_in_the_radius_with_or_without_fees(db_session, peers):
    result = await peer_fees.query_peer_fees(db_session, "yihua", radius_km=3, age=3)
    schools = {school["source_id"]: school for school in result["schools"]}
    assert set(schools) == {"own", "p1", "p2", "p3", "p4", "q1", "pub", "np"}  # 4 公里外與停辦不在
    assert schools["own"]["is_own"] is True and schools["p1"]["is_own"] is False
    assert (schools["p4"]["semester_total"], schools["p4"]["monthly_average"]) == (None, None)
    assert (schools["p3"]["semester_total"], schools["p3"]["monthly_average"]) == (40200, None)  # 月數不知道
    assert [school["distance_m"] for school in result["schools"]] == sorted(school["distance_m"] for school in result["schools"])


async def test_own_school_without_this_age_or_not_found(db_session, peers):
    result = await peer_fees.query_peer_fees(db_session, "yihua", radius_km=3, age=4)
    assert (result["own"], result["own_missing"], _group(result, "private")["own_rank"]) == (None, "no_fee", None)
    await db_session.execute(delete(GeoKindergarten).where(GeoKindergarten.source_id == "own"))
    await db_session.commit()
    result = await peer_fees.query_peer_fees(db_session, "yihua", radius_km=3, age=3)
    assert (result["own"], result["own_missing"]) == (None, "not_found")


async def test_quasi_public_own_school_is_not_ranked(db_session, peers):
    await db_session.execute(update(GeoKindergarten).where(GeoKindergarten.source_id == "own").values(kind="quasi_public"))
    await db_session.commit()
    result = await peer_fees.query_peer_fees(db_session, "yihua", radius_km=3, age=3)
    assert result["own"]["semester_total"] == 89750
    assert (_group(result, "private")["own_rank"], _group(result, "private")["rank_total"]) == (None, None)


async def test_campus_without_coordinates_returns_empty_lists(db_session, peers):
    result = await peer_fees.query_peer_fees(db_session, "minghua", radius_km=3, age=3)
    assert result["campus"]["locate_error"] == "no_address"
    assert (result["own"], result["own_missing"], result["items"], result["schools"]) == (None, None, [], [])
    assert [group["with_fee"] for group in result["groups"]] == [0, 0, 0, 0]


async def test_never_imported(db_session, peers):
    await db_session.execute(delete(GeoDatasetStatus).where(GeoDatasetStatus.dataset == "kindergarten_fees"))
    await db_session.commit()
    result = await peer_fees.query_peer_fees(db_session, "yihua", radius_km=3, age=3)
    assert (result["synced_at"], result["school_year"]) == (None, None)


async def test_babycare_summary_has_fees_and_own_two_year_old_monthly(db_session, peers):
    await load_babycare_sample(db_session)
    ids = (await db_session.execute(select(GeoBabycare.source_id).order_by(GeoBabycare.source_id))).scalars().all()
    for source_id, fee in zip(ids, (17900, 15000, 21000)):
        await db_session.execute(update(GeoBabycare).where(GeoBabycare.source_id == source_id).values(monthly_fee=fee))
    await db_session.commit()
    result = await area.query_babycare(db_session, "yihua", radius_km=6)
    summary = result["summary"]
    in_radius = [item["monthly_fee"] for item in result["items"] if item["monthly_fee"] is not None]
    assert summary["fee_count"] == len(in_radius)
    assert (summary["fee_min"], summary["fee_max"]) == (min(in_radius), max(in_radius))
    assert summary["own_age2_monthly"] == 19264  # 105,950 ÷ 5.5
    assert summary["fee_school_year"] == 114


async def test_babycare_summary_without_fees(db_session, peers):
    await load_babycare_sample(db_session)
    await db_session.execute(delete(GeoKindergartenFee).where(GeoKindergartenFee.age == 2))
    await db_session.commit()
    summary = (await area.query_babycare(db_session, "yihua", radius_km=3))["summary"]
    assert (summary["fee_count"], summary["fee_median"], summary["own_age2_monthly"]) == (0, None, None)
```

- [ ] **Step 3: 跑測試確認紅燈**

Run: `BT tests/test_admissions_peer_fees.py`
Expected：FAIL（`ImportError: cannot import name 'peer_fees'`）。

- [ ] **Step 4: 實作 `backend/app/admissions/peer_fees.py`**

```python
"""附近同業收費（2026-10-15 附近同業比較規格 §5）：本校一學期公告收費在半徑內私立一般園所裡的位置。只讀。

排名、中位數、項目對照只用私立一般（F2）；準公共、公立、非營利只列家數與公告收費當背景。
本機構（任一校 50 公尺內）不算同業；本校＝距本校 50 公尺內最近的營業中園所（F12、F13）。"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import area
from app.admissions.academic import current_term
from app.admissions.geo import fees as geo_fees
from app.admissions.geo import kindergartens as geo_kindergartens
from app.admissions.geo import matcher
from app.admissions.geo.kindergartens import NearbyKindergarten
from app.admissions.geo.models import FEE_AGES, GeoDatasetStatus, GeoKindergartenFee
from app.admissions.geo.projection import haversine_m
from app.common.timezones import today_local

AGE_CHOICES = FEE_AGES
GROUP_ORDER = ("private", "quasi_public", "public", "nonprofit")


def _items(fee: GeoKindergartenFee | None) -> dict[str, int | None]:
    return {key: (getattr(fee, key) if fee is not None else None) for key in geo_fees.ITEM_KEYS}


def _group(
    kind: str, members: list[NearbyKindergarten], fees: dict[str, GeoKindergartenFee], own_total: int | None = None
) -> dict[str, Any]:
    totals = [fees[item.source_id].semester_total for item in members if item.source_id in fees]
    group: dict[str, Any] = {
        "kind": kind, "schools": len(members), "with_fee": len(totals), "median": geo_fees.median(totals),
        "lowest": min(totals, default=None), "highest": max(totals, default=None), "own_rank": None, "rank_total": None,
    }
    if own_total is not None:
        group["own_rank"] = sum(1 for total in totals if total > own_total) + 1
        group["rank_total"] = len(totals) + 1
    return group


async def query_peer_fees(db: AsyncSession, campus_key: str, *, radius_km: int, age: int) -> dict[str, Any]:
    points = await matcher.campus_points(db)
    campus = await area.campus_out(db, campus_key, points[campus_key])
    status = await db.get(GeoDatasetStatus, "kindergarten_fees")
    current_school_year, _ = current_term(today_local())
    result: dict[str, Any] = {
        "campus": campus,
        "radius_km": radius_km,
        "age": age,
        "school_year": int(status.active_version) if status is not None and status.active_version else None,
        "current_school_year": current_school_year,
        "synced_at": status.synced_at if status is not None else None,
        "source_note": geo_fees.SOURCE_NOTE,
        "own": None,
        "own_missing": None,
        "groups": [_group(kind, [], {}) for kind in GROUP_ORDER],
        "items": [],
        "schools": [],
    }
    if campus["lat"] is None or campus["lng"] is None:
        return result
    lat, lng = campus["lat"], campus["lng"]
    own_points = [(point.lat, point.lng) for point in points.values() if point.lat is not None and point.lng is not None]
    found = await geo_kindergartens.nearby(db, lat, lng, radius_km * 1000)
    ids = [item.source_id for item in found]
    fees: dict[str, GeoKindergartenFee] = {}
    if ids:
        rows = await db.execute(
            select(GeoKindergartenFee).where(GeoKindergartenFee.age == age, GeoKindergartenFee.source_id.in_(ids))
        )
        fees = {row.source_id: row for row in rows.scalars()}
    own_flags = {
        item.source_id: any(haversine_m(item.lat, item.lng, a, b) <= area.OWN_CAMPUS_RADIUS_M for a, b in own_points)
        for item in found
    }
    own_school, own_fee = await geo_fees.own_fee(db, lat, lng, age=age, radius_m=area.OWN_CAMPUS_RADIUS_M)
    if own_school is None:
        result["own_missing"] = "not_found"
    elif own_fee is None:
        result["own_missing"] = "no_fee"
    else:
        result["own"] = {
            "source_id": own_school.source_id,
            "name": own_school.name,
            "semester_total": own_fee.semester_total,
            "months": float(own_fee.months) if own_fee.months is not None else None,
            "monthly_average": geo_fees.monthly_average(own_fee.semester_total, own_fee.months),
            "items": _items(own_fee),
            "transport_note": own_fee.transport_note,
        }
    peers = [item for item in found if not own_flags[item.source_id]]
    # 本校本身是私立一般才排名（F14）：不同類型的公告收費不能互相排名。
    rank_against = own_fee.semester_total if own_fee is not None and own_school.kind == "private" else None
    result["groups"] = [
        _group(kind, [item for item in peers if item.kind == kind], fees, rank_against if kind == "private" else None)
        for kind in GROUP_ORDER
    ]
    private_fees = [fees[item.source_id] for item in peers if item.kind == "private" and item.source_id in fees]
    items = []
    for key in geo_fees.ITEM_KEYS:
        values = [value for fee in private_fees if (value := getattr(fee, key)) is not None]
        items.append({
            "key": key, "own": getattr(own_fee, key) if own_fee is not None else None,
            "peer_median": geo_fees.median(values), "peer_count": len(values),
        })
    result["items"] = items
    result["schools"] = [
        {
            "source_id": item.source_id,
            "name": item.name,
            "kind": item.kind,
            "distance_m": item.distance_m,
            "is_own": own_flags[item.source_id],
            "semester_total": fees[item.source_id].semester_total if item.source_id in fees else None,
            "monthly_average": (
                geo_fees.monthly_average(fees[item.source_id].semester_total, fees[item.source_id].months)
                if item.source_id in fees else None
            ),
            "items": _items(fees.get(item.source_id)),
            "transport_note": fees[item.source_id].transport_note if item.source_id in fees else None,
        }
        for item in found
    ]
    return result
```

- [ ] **Step 5: area.query_babycare 與幼兒園來源說明**

`backend/app/admissions/geo/kindergartens.py`：`SOURCE_NOTE = "資料來源：全國教保資訊網（kiang 整理）"`（拿掉「，月費為估計值」；畫面不再顯示估計月費，規格 F17）。

`backend/app/admissions/area.py`：

1. import 加 `from app.admissions.geo import fees as geo_fees`。
2. `query_babycare`：在 `result` 建好之前加

```python
    fee_status = await db.get(GeoDatasetStatus, "kindergarten_fees")
    fee_school_year = int(fee_status.active_version) if fee_status is not None and fee_status.active_version else None
```

`result["summary"]` 的初始值改成：

```python
        "summary": {
            "count": 0, "approved_total": 0, "enrolled_total": 0, "fee_count": 0, "fee_median": None,
            "fee_min": None, "fee_max": None, "own_age2_monthly": None, "fee_school_year": fee_school_year,
        },
```

函式尾端算完 `result["summary"] = {...}` 的地方改成：

```python
    monthly = [item.monthly_fee for item in found if item.monthly_fee is not None]
    # 本校 2 歲班月均（規格 §5）：和托嬰月費擺在一起對照，兩邊都不含延托。
    _, own_fee = await geo_fees.own_fee(db, campus["lat"], campus["lng"], age=2, radius_m=OWN_CAMPUS_RADIUS_M)
    result["summary"] = {
        "count": len(found),
        "approved_total": sum(item.approved_capacity or 0 for item in found),
        "enrolled_total": sum(item.enrolled or 0 for item in found),
        "fee_count": len(monthly),
        "fee_median": geo_fees.median(monthly),
        "fee_min": min(monthly, default=None),
        "fee_max": max(monthly, default=None),
        "own_age2_monthly": geo_fees.monthly_average(own_fee.semester_total, own_fee.months) if own_fee is not None else None,
        "fee_school_year": fee_school_year,
    }
```

- [ ] **Step 6: 跑測試**

Run: `BT tests/test_admissions_peer_fees.py tests/test_admissions_provider_area.py tests/test_admissions_area.py`
Expected：PASS。`test_admissions_provider_area.py` 裡斷言 `body["summary"] == {"count": ..., "approved_total": ..., "enrolled_total": ...}` 的幾則會因為多了鍵而紅——那幾則還要等 Task 7 改 schema 才會在 API 層出現新鍵；這一步若已經紅，把斷言改成只比對原本三個鍵：`{k: body["summary"][k] for k in ("count", "approved_total", "enrolled_total")} == {...}`。

- [ ] **Step 7: Commit**

```bash
git add backend/app/admissions/peer_fees.py backend/app/admissions/area.py backend/app/admissions/geo/kindergartens.py backend/tests/peer_fees_helpers.py backend/tests/test_admissions_peer_fees.py backend/tests/test_admissions_provider_area.py
git commit -m "feat(admissions): 計算附近同業收費落點與托嬰月費摘要" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: API（schema、路由、契約）

**Files:**
- Modify: `backend/app/admissions/schemas.py`
- Modify: `backend/app/admissions/routes.py`
- Create: `backend/tests/test_admissions_peer_fees_api.py`
- Modify: `contracts/openapi.json`、`contracts/generated/website-api.d.ts`（產生）
- Modify: `contracts/ivy-recruitment/README.md`（第 18 點的公開資料表清單）

**Interfaces:**
- Consumes: Task 6 `peer_fees.query_peer_fees`、`peer_fees.AGE_CHOICES`。
- Produces: `GET /api/website/v1/admin/admissions/area/fees?campus_key=&radius_km=&age=` → `AreaPeerFeesOut`；schema 名稱 `AreaFeeItemsOut`、`AreaPeerFeeOwnOut`、`AreaPeerFeeGroupOut`、`AreaPeerFeeItemOut`、`AreaPeerFeeSchoolOut`、`AreaPeerFeesOut`（後台型別別名照這些名字）；`AreaKindergartenOut`、`AreaBabycareItemOut`、`AreaBabycareSummaryOut` 新欄位。

- [ ] **Step 1: 寫失敗測試**

Create `backend/tests/test_admissions_peer_fees_api.py`：

```python
"""附近同業收費端點與兩支既有端點的新欄位（2026-10-15 規格 §6）。"""

from __future__ import annotations

import pytest
from sqlalchemy import update

from app.admissions.geo import kindergartens as geo_kindergartens
from app.admissions.geo.models import GeoBabycare, GeoKindergarten
from tests.admissions_area_helpers import AREA
from tests.admissions_helpers import readonly_yihua_client, reception_yihua_client  # noqa: F401
from tests.geo_helpers import load_babycare_sample
from tests.peer_fees_helpers import peers  # noqa: F401

FEES = f"{AREA}/fees"


async def test_fees_endpoint(admin_client, peers):
    response = await admin_client.get(f"{FEES}?campus_key=yihua&radius_km=3&age=3")
    assert response.status_code == 200
    body = response.json()
    assert (body["age"], body["radius_km"], body["school_year"], body["own"]["semester_total"]) == (3, 3, 114, 89750)
    assert body["groups"][0] == {
        "kind": "private", "schools": 4, "with_fee": 3, "median": 75000, "lowest": 40200, "highest": 93000,
        "own_rank": 2, "rank_total": 4,
    }
    assert body["own"]["items"]["materials"] == 24750
    assert body["source_note"] == "資料來源：全國教保資訊網（kiang 整理），園所公告收費"


async def test_fees_defaults_to_three_km_and_three_years_old(admin_client, peers):
    body = (await admin_client.get(f"{FEES}?campus_key=yihua")).json()
    assert (body["radius_km"], body["age"]) == (3, 3)


@pytest.mark.parametrize("age", ["1", "6", "abc", "3.5", ""])
async def test_bad_age(admin_client, peers, age):
    response = await admin_client.get(f"{FEES}?campus_key=yihua&age={age}")
    assert response.status_code == 422
    assert response.json()["detail"] == {"code": "INVALID_AGE", "message": "年齡只能是 2 到 5 歲"}


@pytest.mark.parametrize("radius", ["2", "abc"])
async def test_bad_radius(admin_client, peers, radius):
    response = await admin_client.get(f"{FEES}?campus_key=yihua&radius_km={radius}")
    assert response.status_code == 422 and response.json()["detail"]["code"] == "INVALID_RADIUS"


async def test_permissions(reception_yihua_client, editor_client, minghua_client, public_client, peers):
    assert (await reception_yihua_client.get(f"{FEES}?campus_key=yihua")).status_code == 200
    assert (await editor_client.get(f"{FEES}?campus_key=yihua")).status_code == 403
    assert (await minghua_client.get(f"{FEES}?campus_key=yihua")).status_code == 404
    assert (await public_client.get(f"{FEES}?campus_key=yihua&age=abc")).status_code == 401  # 登入檢查在年齡檢查之前


async def test_kindergartens_endpoint_has_space_and_services(admin_client, db_session, peers):
    await db_session.execute(
        update(GeoKindergarten).where(GeoKindergarten.source_id == "p1").values(indoor_m2=470.0, outdoor_m2=250.0, has_shuttle=True, after_school_capacity=0)
    )
    await db_session.commit()
    body = (await admin_client.get(f"{AREA}/kindergartens?campus_key=yihua")).json()
    p1 = next(item for item in body["items"] if item["source_id"] == "p1")
    assert (p1["indoor_m2_per_child"], p1["outdoor_m2_per_child"], p1["has_shuttle"], p1["after_school_capacity"]) == (4.7, 2.5, True, 0)
    assert body["source_note"] == geo_kindergartens.SOURCE_NOTE == "資料來源：全國教保資訊網（kiang 整理）"


async def test_babycare_endpoint_has_fees(admin_client, db_session, peers):
    await load_babycare_sample(db_session)
    await db_session.execute(update(GeoBabycare).values(monthly_fee=17900, evaluation_grade="優等", evaluation_year=114, quasi_public=True))
    await db_session.commit()
    body = (await admin_client.get(f"{AREA}/babycare?campus_key=yihua")).json()
    first = body["items"][0]
    assert (first["monthly_fee"], first["evaluation_grade"], first["evaluation_year"], first["quasi_public"]) == (17900, "優等", 114, True)
    assert (body["summary"]["fee_median"], body["summary"]["own_age2_monthly"], body["summary"]["fee_school_year"]) == (17900, 19264, 114)
```

- [ ] **Step 2: 跑測試確認紅燈**

Run: `BT tests/test_admissions_peer_fees_api.py`
Expected：FAIL（`/area/fees` 404、既有端點沒有新欄位）。

- [ ] **Step 3: schemas.py**

`AreaKindergartenOut` 的 `is_own` 之後加：

```python
    # 2026-10-15 附近同業比較：每位核定幼生的室內／戶外面積（m²，一位小數）、幼童專用車、兼辦國小課後人數（0＝無）。
    indoor_m2_per_child: float | None = None
    outdoor_m2_per_child: float | None = None
    has_shuttle: bool | None = None
    after_school_capacity: int | None = None
```

`AreaBabycareItemOut` 的 `phone` 之後加：

```python
    # 2026-10-15：逐所明細的日間托育平均月費與說明、評鑑等級與年度（民國）、準公共資格；沒抓到是 null。
    monthly_fee: int | None = None
    fee_note: str | None = None
    evaluation_grade: str | None = None
    evaluation_year: int | None = None
    quasi_public: bool | None = None
```

`AreaBabycareSummaryOut` 的 `enrolled_total` 之後加（docstring 補「2026-10-15 起另有月費中位數與範圍（少於 3 所不算中位數）、本校 2 歲班月均、收費學年」）：

```python
    fee_count: int = 0
    fee_median: int | None = None
    fee_min: int | None = None
    fee_max: int | None = None
    own_age2_monthly: int | None = None
    fee_school_year: int | None = None
```

在 `AreaBabycareOut` 之後新增：

```python
class AreaFeeItemsOut(BaseModel):
    """一學期的逐項公告收費（元）；課後延托是每月。來源沒寫是 null，畫面寫「—」。"""

    tuition: int | None
    misc_fee: int | None
    materials: int | None
    activities: int | None
    lunch: int | None
    snack: int | None
    after_care_monthly: int | None


class AreaPeerFeeOwnOut(BaseModel):
    source_id: str
    name: str
    semester_total: int
    months: float | None
    monthly_average: int | None
    items: AreaFeeItemsOut
    transport_note: str | None


class AreaPeerFeeGroupOut(BaseModel):
    """一種類型的半徑內家數（不含本機構）、有公布收費的家數、中位數（少於 3 所是 null）、最低、最高；
    私立一般且本校也是私立一般時才有本校排名（第 own_rank 高，共 rank_total 所，含本校）。"""

    kind: KindergartenKind
    schools: int
    with_fee: int
    median: int | None
    lowest: int | None
    highest: int | None
    own_rank: int | None
    rank_total: int | None


FeeItemKey = Literal["tuition", "misc_fee", "materials", "activities", "lunch", "snack", "after_care_monthly"]


class AreaPeerFeeItemOut(BaseModel):
    key: FeeItemKey
    own: int | None
    peer_median: int | None
    peer_count: int


class AreaPeerFeeSchoolOut(BaseModel):
    source_id: str
    name: str
    kind: KindergartenKind
    distance_m: int
    is_own: bool
    semester_total: int | None
    monthly_average: int | None
    items: AreaFeeItemsOut
    transport_note: str | None


class AreaPeerFeesOut(BaseModel):
    """附近同業收費（2026-10-15 規格 §6）。synced_at 是 null＝收費從沒匯入；school_year 是資料學年，
    比 current_school_year 舊時畫面要寫明。own_missing：not_found＝附近找不到本校的教保資訊網資料、
    no_fee＝本校沒有公布這個年齡的收費；本校沒定位時兩者都是 null（原因在 campus.locate_error）。"""

    campus: AreaCampusOut
    radius_km: int
    age: int
    school_year: int | None
    current_school_year: int
    synced_at: datetime | None
    source_note: str
    own: AreaPeerFeeOwnOut | None
    own_missing: Literal["not_found", "no_fee"] | None
    groups: list[AreaPeerFeeGroupOut]
    items: list[AreaPeerFeeItemOut]
    schools: list[AreaPeerFeeSchoolOut]
```

（若 `Literal` 尚未 import，加到檔頭的 `typing` import。）

- [ ] **Step 4: routes.py**

1. import：`from app.admissions import peer_fees as peer_fees_service`；schemas import 加 `AreaPeerFeesOut`。
2. `_require_integer_radius` 之後加：

```python
def _invalid_age() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={"code": "INVALID_AGE", "message": "年齡只能是 2 到 5 歲"},
    )


async def _require_integer_age(request: Request, _user: User = Depends(get_current_user)) -> None:
    """age 不是整數時先擋下，改回 INVALID_AGE（同 _require_integer_radius 的理由）。登入檢查仍在最前面。"""
    raw = request.query_params.get("age")
    if raw is not None and not _PLAIN_INTEGER.fullmatch(raw):
        raise _invalid_age()
```

3. `/area/babycare` 路由之後加：

```python
@router.get(
    "/admin/admissions/area/fees",
    response_model=AreaPeerFeesOut,
    dependencies=[Depends(_require_integer_radius), Depends(_require_integer_age)],
)
async def get_admissions_area_fees(
    campus_key: str,
    radius_km: int = Query(default=3, description="半徑公里：1、3 或 6"),
    age: int = Query(default=3, description="年齡：2 到 5 歲"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> AreaPeerFeesOut:
    """附近同業收費（2026-10-15 規格 §6）：本校這個年齡全日班一學期的公告收費，在半徑內私立一般園所裡的位置；
    其他類型只當背景。公開資料，只讀，不寫稽核。半徑規則同 /area/kindergartens；年齡不是 2–5 的整數回 INVALID_AGE。"""
    _require_campus(current_user, "admissions.read", campus_key)
    if radius_km not in area_service.RADIUS_CHOICES:
        raise _invalid_radius()
    if age not in peer_fees_service.AGE_CHOICES:
        raise _invalid_age()
    result = await peer_fees_service.query_peer_fees(db, campus_key, radius_km=radius_km, age=age)
    return AreaPeerFeesOut.model_validate(result)
```

- [ ] **Step 5: 跑測試**

Run: `BT tests/test_admissions_peer_fees_api.py tests/test_admissions_provider_area.py tests/test_admissions_area.py tests/test_geo_schema.py`
Expected：PASS。Task 6 Step 6 若有改成只比三個鍵的斷言，現在可以改回完整比對新的 summary（含六個新鍵），擇一即可、不要兩種並存。

- [ ] **Step 6: 契約**

照 Global Constraints 的「產生」指令重產 `contracts/openapi.json` 與 `contracts/generated/website-api.d.ts`，再跑「檢查」指令。
Expected：檢查通過；`git diff --stat contracts/` 只有這兩個檔。

`contracts/ivy-recruitment/README.md` 第 18 點「同日另加托嬰名單 `geo_babycare` 與附近園所異動紀錄 `geo_provider_events`」後面接：「；2026-10-15 再加幼兒園公告收費 `geo_kindergarten_fees`，並在 `geo_kindergartens`、`geo_babycare` 加同業比較欄位」。

- [ ] **Step 7: Commit**

```bash
git add backend/app/admissions/schemas.py backend/app/admissions/routes.py backend/tests/test_admissions_peer_fees_api.py backend/tests/test_admissions_provider_area.py contracts/openapi.json contracts/generated/website-api.d.ts contracts/ivy-recruitment/README.md
git commit -m "feat(admissions): GET /admin/admissions/area/fees 與清單的同業比較欄位" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 後台資料層（型別、API、格式函式、測試工具）

**Files:**
- Modify: `admin/src/api/types.ts`
- Modify: `admin/src/api/admissions.ts`
- Modify: `admin/src/__tests__/admissionsTestKit.ts`
- Create: `admin/src/components/admissions/area/peerFeesFormat.ts`
- Create: `admin/src/__tests__/peerFeesFormat.test.ts`
- Create: `admin/src/__tests__/peerFeesApi.test.ts`

**Interfaces:**
- Consumes: Task 7 產生的 `components['schemas']['AreaPeerFeesOut']` 等。
- Produces:
  - 型別 `AreaPeerFees`、`AreaPeerFeeGroup`、`AreaPeerFeeItem`、`AreaPeerFeeSchool`、`AreaFeeItems`
  - `getAreaPeerFees(campusKey: string, radiusKm: 1 | 3 | 6, age: 2 | 3 | 4 | 5): Promise<AreaPeerFees>`
  - `peerFeesFormat.ts`：`type PeerAge`、`PEER_AGES`、`DEFAULT_PEER_AGE = 3`、`FEE_ITEM_KEYS`、`FEE_ITEM_LABELS`、`GROUP_LABELS`、`formatYuan`、`feeLagNote`、`peerFeesSubtitle`、`peerSummaryText`、`groupRows`、`itemRows`、`stripScale`、`schoolRows`、`SCHOOL_COLUMNS`、`SCHOOL_CSV_COLUMNS`、`feeSourceLine`
  - 測試工具：`feeItems()`、`peerFeeSchool()`、`areaPeerFees()`；既有 `kindergarten()`、`babycareItem()`、`areaBabycare()` 多新欄位（預設 null／0）

- [ ] **Step 1: 型別與 API**

`admin/src/api/types.ts` 在托嬰型別（`AreaBabycareSummary`）之後加：

```ts
// 附近同業收費（2026-10-15 規格 6）。
export type AreaPeerFees = components['schemas']['AreaPeerFeesOut']
export type AreaPeerFeeGroup = components['schemas']['AreaPeerFeeGroupOut']
export type AreaPeerFeeItem = components['schemas']['AreaPeerFeeItemOut']
export type AreaPeerFeeSchool = components['schemas']['AreaPeerFeeSchoolOut']
export type AreaFeeItems = components['schemas']['AreaFeeItemsOut']
```

`admin/src/api/admissions.ts`：檔頭註解的清單補「附近同業收費 getAreaPeerFees（2026-10-15）」；type import 加 `AreaPeerFees`；在 `getAreaBabycare` 之後加：

```ts
/** 附近同業收費（2026-10-15 規格 6）：半徑同 getAreaKindergartens（1、3、6 公里），年齡 2–5 歲。 */
export function getAreaPeerFees(campusKey: string, radiusKm: 1 | 3 | 6, age: 2 | 3 | 4 | 5): Promise<AreaPeerFees> {
  return api.get<AreaPeerFees>(`/admin/admissions/area/fees?${toQuery({ campus_key: campusKey, radius_km: radiusKm, age })}`)
}
```

- [ ] **Step 2: 測試工具**

`admin/src/__tests__/admissionsTestKit.ts`：

1. type import 加 `AreaFeeItems, AreaPeerFeeSchool, AreaPeerFees`。
2. `kindergarten()` 的物件在 `is_own: false,` 後面加 `indoor_m2_per_child: null, outdoor_m2_per_child: null, has_shuttle: null, after_school_capacity: null,`。
3. `areaKindergartens()` 的 `source_note` 改成 `'資料來源：全國教保資訊網（kiang 整理）'`。
4. `babycareItem()` 的物件在 `phone: '07-3801000',` 後面加 `monthly_fee: null, fee_note: null, evaluation_grade: null, evaluation_year: null, quasi_public: null,`。
5. `areaBabycare()` 的 `summary` 加 `fee_count: 0, fee_median: null, fee_min: null, fee_max: null, own_age2_monthly: null, fee_school_year: null,`。
6. 檔尾加：

```ts
export const feeItems = (changes: Partial<AreaFeeItems> = {}): AreaFeeItems => ({
  tuition: null, misc_fee: null, materials: null, activities: null, lunch: null, snack: null, after_care_monthly: null, ...changes,
})

export const peerFeeSchool = (changes: Partial<AreaPeerFeeSchool> = {}): AreaPeerFeeSchool => ({
  source_id: 'kg-private', name: '高雄市私立小樹幼兒園', kind: 'private', distance_m: 420, is_own: false,
  semester_total: 75000, monthly_average: 13636, items: feeItems({ tuition: 15000 }), transport_note: null, ...changes,
})

/** 和 areaKindergartens() 同一批園所（kg-own、kg-public、kg-quasi 有收費，kg-nonprofit 沒有），再加三所私立同業。 */
export const areaPeerFees = (changes: Partial<AreaPeerFees> = {}): AreaPeerFees => ({
  campus: areaStats().campus,
  radius_km: 3,
  age: 3,
  school_year: 114,
  current_school_year: 115,
  synced_at: '2026-10-15T03:00:00Z',
  source_note: '資料來源：全國教保資訊網（kiang 整理），園所公告收費',
  own: {
    source_id: 'kg-own', name: '高雄市私立常春藤幼兒園', semester_total: 89750, months: 5.5, monthly_average: 16318,
    items: feeItems({ tuition: 19900, misc_fee: 5500, materials: 24750, activities: 23100, lunch: 8250, snack: 8250, after_care_monthly: 1200 }),
    transport_note: '單 770 雙 1540',
  },
  own_missing: null,
  groups: [
    { kind: 'private', schools: 4, with_fee: 3, median: 75000, lowest: 40200, highest: 93000, own_rank: 2, rank_total: 4 },
    { kind: 'quasi_public', schools: 1, with_fee: 1, median: null, lowest: 63190, highest: 63190, own_rank: null, rank_total: null },
    { kind: 'public', schools: 1, with_fee: 1, median: null, lowest: 17965, highest: 17965, own_rank: null, rank_total: null },
    { kind: 'nonprofit', schools: 1, with_fee: 0, median: null, lowest: null, highest: null, own_rank: null, rank_total: null },
  ],
  items: [
    { key: 'tuition', own: 19900, peer_median: 15000, peer_count: 3 },
    { key: 'misc_fee', own: 5500, peer_median: 21300, peer_count: 3 },
    { key: 'materials', own: 24750, peer_median: 11000, peer_count: 3 },
    { key: 'activities', own: 23100, peer_median: 9900, peer_count: 3 },
    { key: 'lunch', own: 8250, peer_median: 7500, peer_count: 3 },
    { key: 'snack', own: 8250, peer_median: null, peer_count: 2 },
    { key: 'after_care_monthly', own: 1200, peer_median: 1200, peer_count: 3 },
  ],
  schools: [
    peerFeeSchool({
      source_id: 'kg-own', name: '高雄市私立常春藤幼兒園', distance_m: 0, is_own: true, semester_total: 89750, monthly_average: 16318,
      items: feeItems({ tuition: 19900, misc_fee: 5500, materials: 24750, activities: 23100, lunch: 8250, snack: 8250, after_care_monthly: 1200 }),
      transport_note: '單 770 雙 1540',
    }),
    peerFeeSchool({ source_id: 'kg-p1', name: '高雄市私立甲幼兒園', distance_m: 300, semester_total: 75000, monthly_average: 13636 }),
    peerFeeSchool({ source_id: 'kg-public', name: '高雄市立大樹幼兒園', kind: 'public', distance_m: 380, semester_total: 17965, monthly_average: 3266 }),
    peerFeeSchool({ source_id: 'kg-p2', name: '高雄市私立乙幼兒園', distance_m: 600, semester_total: 93000, monthly_average: 16909 }),
    peerFeeSchool({ source_id: 'kg-p3', name: '高雄市私立丙幼兒園', distance_m: 900, semester_total: 40200, monthly_average: null }),
    peerFeeSchool({ source_id: 'kg-quasi', name: '高雄市私立小草幼兒園', kind: 'quasi_public', distance_m: 950, semester_total: 63190, monthly_average: 11489 }),
    peerFeeSchool({ source_id: 'kg-p4', name: '高雄市私立丁幼兒園', distance_m: 1200, semester_total: null, monthly_average: null, items: feeItems() }),
  ],
  ...changes,
})
```

- [ ] **Step 3: 寫失敗測試**

Create `admin/src/__tests__/peerFeesApi.test.ts`：

```ts
import { afterEach, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { getAreaPeerFees } from '../api/admissions'

afterEach(() => vi.restoreAllMocks())

it('getAreaPeerFees 帶校區、半徑與年齡', async () => {
  const get = vi.spyOn(api, 'get').mockResolvedValue({} as never)
  await getAreaPeerFees('yihua', 3, 4)
  expect(get).toHaveBeenCalledWith('/admin/admissions/area/fees?campus_key=yihua&radius_km=3&age=4')
})
```

Create `admin/src/__tests__/peerFeesFormat.test.ts`：

```ts
// 附近同業收費的格式函式（2026-10-15 規格 7.1）。
import { describe, expect, it } from 'vitest'
import {
  feeLagNote, feeSourceLine, formatYuan, groupRows, itemRows, peerFeesSubtitle, peerSummaryText, schoolRows, stripScale,
} from '../components/admissions/area/peerFeesFormat'
import { areaPeerFees, feeItems, peerFeeSchool } from './admissionsTestKit'

const withPrivate = (changes: Record<string, unknown>) => {
  const data = areaPeerFees()
  return { ...data, groups: data.groups.map((group) => (group.kind === 'private' ? { ...group, ...changes } : group)) }
}

describe('附近同業收費格式', () => {
  it('金額與學年', () => {
    expect(formatYuan(89750)).toBe('89,750 元')
    expect(formatYuan(null)).toBe('—')
    expect(peerFeesSubtitle(areaPeerFees())).toBe('114 學年・全日班・一學期公告收費')
    expect(feeLagNote(114, 115)).toBe('目前是 115 學年，最新公開收費是 114 學年。')
    expect(feeLagNote(115, 115)).toBe('')
    expect(feeLagNote(null, 115)).toBe('')
  })

  it('總結句：有中位數、有本校排名', () => {
    expect(peerSummaryText(areaPeerFees())).toBe('3 公里內私立幼兒園（不含準公共）有 3 所公布收費，3 歲班一學期中位數 75,000 元；本校 89,750 元，第 2 高。')
  })

  it('總結句：少於 3 所不算中位數、只寫本校金額', () => {
    expect(peerSummaryText(withPrivate({ with_fee: 2, median: null, own_rank: 2, rank_total: 3 }))).toBe(
      '3 公里內私立幼兒園（不含準公共）只有 2 所公布收費，不算中位數。本校 89,750 元。',
    )
  })

  it('總結句：附近有私立但都沒公布收費、附近沒有其他私立', () => {
    expect(peerSummaryText(withPrivate({ with_fee: 0, median: null, own_rank: 1, rank_total: 1 }))).toBe(
      '3 公里內私立幼兒園（不含準公共）都沒有公布收費。本校 89,750 元。',
    )
    expect(peerSummaryText(withPrivate({ schools: 0, with_fee: 0, median: null }))).toBe('3 公里內沒有其他私立幼兒園（不含準公共）。本校 89,750 元。')
  })

  it('總結句：本校沒公布這個年齡、找不到本校、本校是準公共（不排名）', () => {
    expect(peerSummaryText({ ...areaPeerFees(), own: null, own_missing: 'no_fee', age: 4 })).toBe(
      '3 公里內私立幼兒園（不含準公共）有 3 所公布收費，4 歲班一學期中位數 75,000 元；本校沒有公布 4 歲班收費。',
    )
    expect(peerSummaryText({ ...areaPeerFees(), own: null, own_missing: 'not_found' })).toBe(
      '3 公里內私立幼兒園（不含準公共）有 3 所公布收費，3 歲班一學期中位數 75,000 元；找不到本校在全國教保資訊網的資料。',
    )
    expect(peerSummaryText(withPrivate({ own_rank: null, rank_total: null }))).toBe(
      '3 公里內私立幼兒園（不含準公共）有 3 所公布收費，3 歲班一學期中位數 75,000 元；本校 89,750 元。',
    )
  })

  it('類型背景表', () => {
    expect(groupRows(areaPeerFees())).toEqual([
      { kind: 'private', label: '私立一般', schools: '4', withFee: '3', median: '75,000 元', range: '40,200–93,000 元' },
      { kind: 'quasi_public', label: '準公共', schools: '1', withFee: '1', median: '—', range: '63,190 元' },
      { kind: 'public', label: '公立', schools: '1', withFee: '1', median: '—', range: '17,965 元' },
      { kind: 'nonprofit', label: '非營利', schools: '1', withFee: '0', median: '—', range: '—' },
    ])
  })

  it('項目對照：差額有正負號，任一邊不知道寫「—」', () => {
    const rows = itemRows(areaPeerFees())
    expect(rows[0]).toEqual({ key: 'tuition', label: '學費', own: '19,900 元', peer: '15,000 元', diff: '+4,900 元' })
    expect(rows[1].diff).toBe(`${'−'}15,800 元`)
    expect(rows[5]).toEqual({ key: 'snack', label: '點心費', own: '8,250 元', peer: '—', diff: '—' })
    expect(rows[6]).toEqual({ key: 'after_care_monthly', label: '課後延托（每月）', own: '1,200 元', peer: '1,200 元', diff: '0 元' })
  })

  it('項目全空的園所：寫「—」不寫 0', () => {
    const data = { ...areaPeerFees(), own: { ...areaPeerFees().own!, items: feeItems() } }
    expect(itemRows(data).every((row) => row.own === '—' && row.diff === '—')).toBe(true)
  })

  it('落點條：私立同業加本校，左右是最低與最高；少於 3 所不畫', () => {
    const strip = stripScale(areaPeerFees())!
    expect(strip.points).toEqual([
      { id: 'kg-p1', left: 65.9, own: false },
      { id: 'kg-p2', left: 100, own: false },
      { id: 'kg-p3', left: 0, own: false },
      { id: 'kg-own', left: 93.8, own: true },
    ])
    expect(strip.median).toBe(65.9)
    expect([strip.lowestText, strip.highestText]).toEqual(['40,200 元', '93,000 元'])
    expect(stripScale(withPrivate({ median: null }))).toBeNull()
  })

  it('各所收費表：私立與準公共有收費的，總價高到低', () => {
    const rows = schoolRows(areaPeerFees())
    // shortName 會去掉「高雄市私立」。
    expect(rows.map((row) => [row.name, row.kind, row.semester_total])).toEqual([
      ['乙幼兒園', '私立', 93000],
      ['常春藤幼兒園', '本機構', 89750],
      ['甲幼兒園', '私立', 75000],
      ['小草幼兒園', '準公共', 63190],
      ['丙幼兒園', '私立', 40200],
    ])
    expect(rows[0].tuition).toBe(15000)
    expect(schoolRows({ ...areaPeerFees(), schools: [peerFeeSchool({ semester_total: null })] })).toEqual([])
  })

  it('清單來源小字', () => {
    expect(feeSourceLine('資料來源：全國教保資訊網（kiang 整理）', '10/15', areaPeerFees())).toBe(
      '資料來源：全國教保資訊網（kiang 整理）・收費為 114 學年公告・10/15 更新　目前是 115 學年，最新公開收費是 114 學年。',
    )
    expect(feeSourceLine('資料來源：全國教保資訊網（kiang 整理）', '10/15', null)).toBe('資料來源：全國教保資訊網（kiang 整理）・10/15 更新')
  })
})
```

（`rows[1].diff` 期望值是「−15,800 元」：5,500 − 21,300，減號是 U+2212，和 `signedCount` 用的同一個字元；用 `'−'` 寫是為了不在測試裡手打。落點條的位置：最低 40,200、最高 93,000，甲 75,000 在 65.9%、本校 89,750 在 93.8%、中位數 75,000 也在 65.9%。）

- [ ] **Step 4: 跑測試確認紅燈**

Run: `AT src/__tests__/peerFeesFormat.test.ts src/__tests__/peerFeesApi.test.ts`
Expected：FAIL（`Failed to resolve import "../components/admissions/area/peerFeesFormat"`）。

- [ ] **Step 5: 實作 `admin/src/components/admissions/area/peerFeesFormat.ts`**

```ts
import { NO_VALUE, type StatsColumn } from '../../../admissions/statsFormat'
import type { AreaFeeItems, AreaPeerFees } from '../../../api/types'
import { formatCount, formatDistance, kindLabel, shortName, signedCount } from './areaFormat'

// 附近同業收費（2026-10-15 規格 7.1、7.2）：排名、中位數、項目對照只和私立一般比（規格 F2）。

export type PeerAge = 2 | 3 | 4 | 5
export const PEER_AGES: readonly PeerAge[] = [2, 3, 4, 5]
export const DEFAULT_PEER_AGE: PeerAge = 3

export const FEE_ITEM_KEYS = ['tuition', 'misc_fee', 'materials', 'activities', 'lunch', 'snack', 'after_care_monthly'] as const
export const FEE_ITEM_LABELS: Record<keyof AreaFeeItems, string> = {
  tuition: '學費', misc_fee: '雜費', materials: '材料費', activities: '活動費', lunch: '午餐費', snack: '點心費',
  after_care_monthly: '課後延托（每月）',
}
export const GROUP_LABELS: Record<string, string> = { private: '私立一般', quasi_public: '準公共', public: '公立', nonprofit: '非營利' }

export const formatYuan = (value: number | null | undefined): string =>
  value === null || value === undefined ? NO_VALUE : `${formatCount(value)} 元`

export function feeLagNote(schoolYear: number | null, currentSchoolYear: number): string {
  return schoolYear !== null && schoolYear < currentSchoolYear ? `目前是 ${currentSchoolYear} 學年，最新公開收費是 ${schoolYear} 學年。` : ''
}

export function peerFeesSubtitle(data: AreaPeerFees): string {
  return data.school_year === null ? '' : `${data.school_year} 學年・全日班・一學期公告收費`
}

const privateGroup = (data: AreaPeerFees) => data.groups.find((group) => group.kind === 'private')

function ownClause(data: AreaPeerFees, withRank: boolean): string {
  if (data.own) {
    const rank = withRank ? privateGroup(data)?.own_rank : null
    return rank ? `本校 ${formatYuan(data.own.semester_total)}，第 ${rank} 高。` : `本校 ${formatYuan(data.own.semester_total)}。`
  }
  if (data.own_missing === 'no_fee') return `本校沒有公布 ${data.age} 歲班收費。`
  if (data.own_missing === 'not_found') return '找不到本校在全國教保資訊網的資料。'
  return ''
}

/** 區塊最上面一句（規格 7.1）。 */
export function peerSummaryText(data: AreaPeerFees): string {
  const group = privateGroup(data)
  const lead = `${data.radius_km} 公里內`
  if (!group || group.schools === 0) return `${lead}沒有其他私立幼兒園（不含準公共）。${ownClause(data, false)}`
  if (group.with_fee === 0) return `${lead}私立幼兒園（不含準公共）都沒有公布收費。${ownClause(data, false)}`
  if (group.median === null) {
    return `${lead}私立幼兒園（不含準公共）只有 ${group.with_fee} 所公布收費，不算中位數。${ownClause(data, false)}`
  }
  const head = `${lead}私立幼兒園（不含準公共）有 ${group.with_fee} 所公布收費，${data.age} 歲班一學期中位數 ${formatYuan(group.median)}`
  const own = ownClause(data, true)
  return own ? `${head}；${own}` : `${head}。`
}

function rangeText(lowest: number | null, highest: number | null): string {
  if (lowest === null || highest === null) return NO_VALUE
  return lowest === highest ? formatYuan(lowest) : `${formatCount(lowest)}–${formatCount(highest)} 元`
}

export function groupRows(data: AreaPeerFees) {
  return data.groups.map((group) => ({
    kind: group.kind,
    label: GROUP_LABELS[group.kind] ?? group.kind,
    schools: formatCount(group.schools),
    withFee: formatCount(group.with_fee),
    median: formatYuan(group.median),
    range: rangeText(group.lowest, group.highest),
  }))
}

export function itemRows(data: AreaPeerFees) {
  return data.items.map((item) => {
    const own = data.own ? data.own.items[item.key] : item.own
    return {
      key: item.key,
      label: FEE_ITEM_LABELS[item.key],
      own: formatYuan(own),
      peer: formatYuan(item.peer_median),
      diff: own === null || item.peer_median === null ? NO_VALUE : `${signedCount(own - item.peer_median)} 元`,
    }
  })
}

/** 落點條（裝飾，aria-hidden）：私立一般同業每所一點加本校；中位數一條線。私立一般沒有中位數就不畫。 */
export function stripScale(data: AreaPeerFees) {
  const group = privateGroup(data)
  if (!group || group.median === null) return null
  const peers = data.schools.filter((school) => school.kind === 'private' && !school.is_own && school.semester_total !== null)
  const values = peers.map((school) => ({ id: school.source_id, value: school.semester_total!, own: false }))
  if (data.own) values.push({ id: data.own.source_id, value: data.own.semester_total, own: true })
  const lowest = Math.min(...values.map((point) => point.value))
  const highest = Math.max(...values.map((point) => point.value))
  const left = (value: number) => (highest === lowest ? 50 : Math.round(((value - lowest) / (highest - lowest)) * 1000) / 10)
  return {
    points: values.map((point) => ({ id: point.id, left: left(point.value), own: point.own })),
    median: left(group.median),
    lowestText: formatYuan(lowest),
    highestText: formatYuan(highest),
  }
}

export function schoolRows(data: AreaPeerFees) {
  return data.schools
    .filter((school) => (school.kind === 'private' || school.kind === 'quasi_public') && school.semester_total !== null)
    .sort((a, b) => b.semester_total! - a.semester_total! || a.distance_m - b.distance_m)
    .map((school) => ({
      source_id: school.source_id,
      name: shortName(school.name),
      kind: school.is_own ? '本機構' : kindLabel(school.kind),
      distance: formatDistance(school.distance_m),
      semester_total: school.semester_total,
      monthly_average: school.monthly_average,
      ...school.items,
    }))
}

export const SCHOOL_COLUMNS: StatsColumn[] = [
  { key: 'name', label: '園所', sticky: true },
  { key: 'kind', label: '類型' },
  { key: 'distance', label: '距本校' },
  { key: 'semester_total', label: '學期總收費（元）', kind: 'count' },
  { key: 'monthly_average', label: '月均（元）', kind: 'count' },
]
export const SCHOOL_CSV_COLUMNS: StatsColumn[] = [
  ...SCHOOL_COLUMNS,
  ...FEE_ITEM_KEYS.map((key) => ({ key, label: `${FEE_ITEM_LABELS[key]}（元）`, kind: 'count' as const })),
]

/** 附近幼兒園清單的來源小字（規格 7.2）：收費學年接在來源後面，學年落後再接一句。 */
export function feeSourceLine(sourceNote: string, updated: string, fees: AreaPeerFees | null): string {
  if (!fees || fees.school_year === null) return `${sourceNote}・${updated} 更新`
  const lag = feeLagNote(fees.school_year, fees.current_school_year)
  return `${sourceNote}・收費為 ${fees.school_year} 學年公告・${updated} 更新${lag ? `　${lag}` : ''}`
}
```

- [ ] **Step 6: 跑測試與型別**

Run: `AT src/__tests__/peerFeesFormat.test.ts src/__tests__/peerFeesApi.test.ts`
Expected：PASS。再跑 typecheck（Global Constraints）：Expected 通過。若 `StatsColumn['kind']` 沒有 `'count'` 以外的值造成型別錯，照 `statsFormat.ts` 的定義調整。

- [ ] **Step 7: Commit**

```bash
git add admin/src/api/types.ts admin/src/api/admissions.ts admin/src/__tests__/admissionsTestKit.ts admin/src/components/admissions/area/peerFeesFormat.ts admin/src/__tests__/peerFeesFormat.test.ts admin/src/__tests__/peerFeesApi.test.ts
git commit -m "feat(admin): 附近同業收費的 API 與格式函式" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: 「附近同業收費」區塊與區域分析接線

**Files:**
- Create: `admin/src/components/admissions/area/PeerFeesPanel.vue`
- Modify: `admin/src/components/admissions/area/AreaTab.vue`
- Create: `admin/src/__tests__/peerFeesPanel.test.ts`
- Modify: `admin/src/__tests__/areaTab.test.ts`、`admin/src/__tests__/areaTabChunkFailure.test.ts`（routes 加 `/admin/admissions/area/fees`）

**Interfaces:**
- Consumes: Task 8 全部。
- Produces: `PeerFeesPanel` props `{ data: AreaPeerFees | null; failed: boolean; age: PeerAge; csvName: (title: string) => string }`、emits `update:age`、`retry`；根元素 `section.peer-fees`；`AreaTab` 內部狀態 `peerAge`、`peerFees`（Task 10 傳給清單）。

- [ ] **Step 1: 寫失敗測試**

Create `admin/src/__tests__/peerFeesPanel.test.ts`：

```ts
// 附近同業收費區塊（2026-10-15 規格 7.1）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import ElementPlus from 'element-plus'
import PeerFeesPanel from '../components/admissions/area/PeerFeesPanel.vue'
import { areaPeerFees, areaStats } from './admissionsTestKit'

vi.mock('../utils/csv', async (importOriginal) => ({ ...(await importOriginal<typeof import('../utils/csv')>()), downloadCsv: vi.fn() }))
import { downloadCsv } from '../utils/csv'

const wrappers: VueWrapper[] = []
afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers.length = 0
})
function mountPanel(changes: Record<string, unknown> = {}): VueWrapper {
  const wrapper = mount(PeerFeesPanel as never, {
    props: { data: areaPeerFees(), failed: false, age: 3, csvName: (title: string) => `招生統計-${title}.csv`, ...changes },
    attachTo: document.body,
    global: { plugins: [ElementPlus] },
  } as never)
  wrappers.push(wrapper)
  return wrapper
}

describe('附近同業收費', () => {
  it('標題、學年、總結、落點條、兩張表與註記', () => {
    const wrapper = mountPanel({ data: areaPeerFees() })
    expect(wrapper.get('.peer-fees__title').text()).toBe('附近同業收費')
    expect(wrapper.get('.peer-fees__subtitle').text()).toBe('114 學年・全日班・一學期公告收費 目前是 115 學年，最新公開收費是 114 學年。')
    expect(wrapper.get('.peer-fees__summary').text()).toBe('3 公里內私立幼兒園（不含準公共）有 3 所公布收費，3 歲班一學期中位數 75,000 元；本校 89,750 元，第 2 高。')
    expect(wrapper.get('.peer-strip').attributes('aria-hidden')).toBe('true')
    expect(wrapper.findAll('.peer-strip__dot')).toHaveLength(4)
    expect(wrapper.findAll('.peer-strip__dot.is-own')).toHaveLength(1)
    const tables = wrapper.findAll('table.peer-table')
    expect(tables).toHaveLength(2)
    expect(tables[0].findAll('tbody tr')[0].text().replace(/\s+/g, '')).toBe('私立一般4375,000元40,200–93,000元')
    expect(tables[1].findAll('tbody tr')[2].text().replace(/\s+/g, '')).toBe('材料費24,750元11,000元+13,750元')
    expect(wrapper.text()).toContain('準公共、公立、非營利的家長另有政府補助，這裡是園所公告收費，不是家長實付。')
    expect(wrapper.text()).toContain('各園項目歸類不一，總價比較較準。')
    expect(wrapper.find('.stats-block__title').text()).toBe('各所收費')
  })

  it('切換年齡發出 update:age', async () => {
    const wrapper = mountPanel()
    await wrapper.findAll('.el-radio-button__original-radio, .el-radio-button input')[2].setValue(true)
    expect(wrapper.emitted('update:age')?.at(-1)).toEqual([4])
  })

  it('本校沒有收費時不顯示項目對照表', () => {
    const wrapper = mountPanel({ data: { ...areaPeerFees(), own: null, own_missing: 'no_fee' } })
    expect(wrapper.findAll('table.peer-table')).toHaveLength(1)
    expect(wrapper.text()).not.toContain('各園項目歸類不一')
  })

  it('私立一般少於 3 所：不畫落點條', () => {
    const data = areaPeerFees()
    const wrapper = mountPanel({ data: { ...data, groups: data.groups.map((group) => (group.kind === 'private' ? { ...group, with_fee: 2, median: null } : group)) } })
    expect(wrapper.find('.peer-strip').exists()).toBe(false)
  })

  it('骨架、失敗重試、尚未匯入、本校沒座標', async () => {
    expect(mountPanel({ data: null }).find('.el-skeleton').exists()).toBe(true)
    const failed = mountPanel({ data: null, failed: true })
    expect(failed.text()).toContain('無法讀取附近同業收費。')
    await failed.get('.el-alert .el-button').trigger('click')
    expect(failed.emitted('retry')).toHaveLength(1)
    expect(mountPanel({ data: { ...areaPeerFees(), synced_at: null } }).get('.peer-fees__empty').text()).toBe('收費資料尚未匯入。')
    const campus = { ...areaStats().campus, lat: null, lng: null, locate_error: 'no_address' }
    expect(mountPanel({ data: { ...areaPeerFees(), campus } }).get('.peer-fees__empty').text()).toContain('無法比較附近同業收費。')
  })

  it('各所收費表：先列 10 列；匯出 CSV 含逐項', async () => {
    const wrapper = mountPanel()
    await wrapper.get('[data-test="stats-csv"]').trigger('click')
    const [filename, csv] = vi.mocked(downloadCsv).mock.calls.at(-1)!
    expect(filename).toBe('招生統計-附近同業收費.csv')
    expect(csv).toContain('學費（元）')
    expect(csv).toContain('乙幼兒園')
  })
})
```

在 `admin/src/__tests__/areaTab.test.ts`：

1. import 加 `areaPeerFees`（從 `./admissionsTestKit`）與 `import PeerFeesPanel from '../components/admissions/area/PeerFeesPanel.vue'`。
2. `routes()` 加一行 `'/admin/admissions/area/fees': areaPeerFees(),`（放在 `/babycare` 之後）。
3. 新增 describe：

```ts
describe('附近同業收費（2026-10-15 規格 7.1）', () => {
  it('區塊在地圖下方、招生機會上方，用目前的半徑與預設 3 歲', async () => {
    const { wrapper, get } = await mountTab()
    expect(wrapper.find('.peer-fees').exists()).toBe(true)
    const html = wrapper.html()
    expect(html.indexOf('peer-fees')).toBeGreaterThan(html.indexOf('area-top'))
    expect(html.indexOf('peer-fees')).toBeLessThan(html.indexOf('opportunity'))
    // queryOf 回 URLSearchParams。
    expect(Object.fromEntries(queryOf(pathsTo(get, '/admin/admissions/area/fees').at(-1)!))).toEqual({ campus_key: 'yihua', radius_km: '3', age: '3' })
  })

  it('換年齡只重讀收費；換半徑也重讀收費', async () => {
    const { wrapper, get } = await mountTab()
    const before = pathsTo(get, '/admin/admissions/area/kindergartens').length
    wrapper.findComponent(PeerFeesPanel).vm.$emit('update:age', 5)
    await flushPromises()
    expect(queryOf(pathsTo(get, '/admin/admissions/area/fees').at(-1)!).get('age')).toBe('5')
    expect(pathsTo(get, '/admin/admissions/area/kindergartens')).toHaveLength(before)
  })

  it('舊年齡的回應晚到不會蓋掉新的', async () => {
    const slow = deferred<unknown>()
    mockGet({
      ...routes(),
      '/admin/admissions/area/fees': (path: string) => (queryOf(path).get('age') === '4' ? slow.promise : areaPeerFees({ age: 5 })),
    })
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    const panel = wrapper.findComponent(PeerFeesPanel)
    panel.vm.$emit('update:age', 4)
    await flushPromises()
    panel.vm.$emit('update:age', 5)
    await flushPromises()
    slow.resolve(areaPeerFees({ age: 4 }))
    await flushPromises()
    expect(wrapper.get('.peer-fees__summary').text()).toContain('5 歲班')
  })

  it('收費讀取失敗只影響這一塊，重試成功恢復', async () => {
    let fail = true
    mockGet({ ...routes(), '/admin/admissions/area/fees': () => { if (fail) throw new Error('boom'); return areaPeerFees() } })
    const { wrapper } = await mountWith(AreaTab, { props: props() })
    await vi.waitFor(() => expect(wrapper.find('.area-map-stub').exists()).toBe(true))
    expect(wrapper.text()).toContain('無法讀取附近同業收費。')
    expect(wrapper.findAll('.nearby__name')).toHaveLength(4)
    fail = false
    await wrapper.get('.peer-fees .el-alert .el-button').trigger('click')
    await flushPromises()
    expect(wrapper.find('.peer-fees__summary').exists()).toBe(true)
  })
})
```

（`deferred`、`queryOf`、`pathsTo`、`mockGet`、`mountWith` 都已在檔頭從 `./admissionsTestKit` 匯入。`deferred<T>()` 回 `{ promise, resolve, reject }`；`mockGet` 的值可以是 `(path) => 資料或 Promise`。）

`admin/src/__tests__/areaTabChunkFailure.test.ts`：它的 routes 裡有 `'/admin/admissions/area/kindergartens'` 的地方，加一行 `'/admin/admissions/area/fees': areaPeerFees(),`（並 import `areaPeerFees`）。理由：`mockGet` 依最長前綴回應，沒有這條會回 `/admin/admissions/area` 的統計物件，區塊會拿到錯的形狀。

- [ ] **Step 2: 跑測試確認紅燈**

Run: `AT src/__tests__/peerFeesPanel.test.ts src/__tests__/areaTab.test.ts`
Expected：FAIL（`Failed to resolve import "../components/admissions/area/PeerFeesPanel.vue"`）。

- [ ] **Step 3: 實作 `PeerFeesPanel.vue`**

```vue
<script setup lang="ts">
import { computed, useId } from 'vue'
import StatsDimensionTable from '../StatsDimensionTable.vue'
import type { AreaPeerFees } from '../../../api/types'
import { campusNotLocatedReason } from './areaFormat'
import {
  PEER_AGES, SCHOOL_COLUMNS, SCHOOL_CSV_COLUMNS, feeLagNote, groupRows, itemRows, peerFeesSubtitle, peerSummaryText, schoolRows,
  stripScale, type PeerAge,
} from './peerFeesFormat'

// 附近同業收費（2026-10-15 規格 7.1）：本校一學期公告收費在半徑內私立一般園所裡的位置。
// 排名、中位數、項目對照只和私立一般比（規格 F2）；準公共、公立、非營利只當背景。
// 落點條是裝飾（aria-hidden），等價資訊在「各所收費」表。年齡由 AreaTab 保管（換校區、半徑保留）。
const props = defineProps<{ data: AreaPeerFees | null; failed: boolean; age: PeerAge; csvName: (title: string) => string }>()
const emit = defineEmits<{ 'update:age': [value: PeerAge]; retry: [] }>()

const headingId = useId()
// 3 公里內私立與準公共常有四五十所：先列 10 列，其餘按「顯示全部」（匯出 CSV 一律是全部）。
const COLLAPSED_ROWS = 10

const notLocated = computed(() => {
  const reason = props.data?.campus.locate_error
  return reason ? `${campusNotLocatedReason(reason) ?? '本校位置尚未確定'}，無法比較附近同業收費。` : ''
})
const notImported = computed(() => props.data?.synced_at === null)
const subtitle = computed(() => {
  if (!props.data) return ''
  return [peerFeesSubtitle(props.data), feeLagNote(props.data.school_year, props.data.current_school_year)].filter(Boolean).join(' ')
})
const summary = computed(() => (props.data ? peerSummaryText(props.data) : ''))
const strip = computed(() => (props.data ? stripScale(props.data) : null))
const groups = computed(() => (props.data ? groupRows(props.data) : []))
const items = computed(() => (props.data?.own ? itemRows(props.data) : []))
const schools = computed(() => (props.data ? schoolRows(props.data) : []))

function setAge(value: string | number | boolean | undefined) {
  const age = Number(value)
  if (age === 2 || age === 3 || age === 4 || age === 5) emit('update:age', age)
}
</script>

<template>
  <section class="peer-fees" :aria-labelledby="headingId">
    <div class="peer-fees__head">
      <h3 :id="headingId" class="peer-fees__title">附近同業收費</h3>
      <el-radio-group :model-value="age" size="small" aria-label="年齡" @update:model-value="setAge">
        <el-radio-button v-for="value in PEER_AGES" :key="value" :value="value">{{ value }} 歲</el-radio-button>
      </el-radio-group>
    </div>

    <el-alert v-if="failed" type="error" :closable="false" show-icon title="無法讀取附近同業收費。">
      <el-button size="small" @click="emit('retry')">重新載入</el-button>
    </el-alert>
    <el-skeleton v-else-if="!data" :rows="4" animated />
    <p v-else-if="notLocated" class="peer-fees__empty">{{ notLocated }}</p>
    <p v-else-if="notImported" class="peer-fees__empty">收費資料尚未匯入。</p>
    <template v-else>
      <p v-if="subtitle" class="hint peer-fees__subtitle">{{ subtitle }}</p>
      <p class="peer-fees__summary num">{{ summary }}</p>

      <div v-if="strip" class="peer-strip" aria-hidden="true">
        <div class="peer-strip__track">
          <span v-if="strip.median !== null" class="peer-strip__median" :style="{ left: `${strip.median}%` }" />
          <span
            v-for="point in strip.points"
            :key="point.id"
            class="peer-strip__dot"
            :class="{ 'is-own': point.own }"
            :style="{ left: `${point.left}%` }"
          />
        </div>
        <div class="peer-strip__ends num"><span>{{ strip.lowestText }}</span><span>{{ strip.highestText }}</span></div>
      </div>

      <div class="peer-table__scroll" role="region" tabindex="0" aria-label="各類型的公告收費（可左右捲動）">
        <table class="peer-table">
          <caption class="visually-hidden">各類型園所的公告收費</caption>
          <thead>
            <tr><th scope="col">類型</th><th scope="col">附近園所</th><th scope="col">有公布收費</th><th scope="col">中位數</th><th scope="col">範圍</th></tr>
          </thead>
          <tbody>
            <tr v-for="row in groups" :key="row.kind">
              <th scope="row">{{ row.label }}</th>
              <td class="num">{{ row.schools }}</td>
              <td class="num">{{ row.withFee }}</td>
              <td class="num">{{ row.median }}</td>
              <td class="num">{{ row.range }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="hint">準公共、公立、非營利的家長另有政府補助，這裡是園所公告收費，不是家長實付。</p>

      <template v-if="items.length">
        <div class="peer-table__scroll" role="region" tabindex="0" aria-label="本校與私立同業的逐項收費（可左右捲動）">
          <table class="peer-table">
            <caption class="visually-hidden">本校與私立同業中位數的逐項收費</caption>
            <thead>
              <tr><th scope="col">項目</th><th scope="col">本校</th><th scope="col">私立中位數</th><th scope="col">差額</th></tr>
            </thead>
            <tbody>
              <tr v-for="row in items" :key="row.key">
                <th scope="row">{{ row.label }}</th>
                <td class="num">{{ row.own }}</td>
                <td class="num">{{ row.peer }}</td>
                <td class="num">{{ row.diff }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="hint">各園項目歸類不一，總價比較較準。</p>
      </template>

      <StatsDimensionTable
        title="各所收費"
        :rows="schools"
        :columns="SCHOOL_COLUMNS"
        :csv-columns="SCHOOL_CSV_COLUMNS"
        row-key="source_id"
        empty-text="附近沒有公布收費的私立或準公共幼兒園。"
        :export-filename="csvName('附近同業收費')"
        :collapsed-rows="COLLAPSED_ROWS"
      />
    </template>
  </section>
</template>

<style scoped>
.peer-fees {
  display: grid;
  gap: 10px;
  min-width: 0;
}

.peer-fees__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.peer-fees__title {
  margin: 0;
  font-size: var(--text-md);
}

.peer-fees__subtitle,
.peer-fees__summary,
.peer-fees__empty {
  margin: 0;
}

.peer-fees__summary {
  color: var(--ink);
}

.peer-strip {
  display: grid;
  gap: 4px;
  padding: 8px 6px 0;
}

.peer-strip__track {
  position: relative;
  height: 20px;
  border-bottom: 1px solid var(--line-strong);
}

.peer-strip__dot,
.peer-strip__median {
  position: absolute;
  bottom: -5px;
  transform: translateX(-50%);
}

.peer-strip__dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--area-kind-private);
}

.peer-strip__dot.is-own {
  z-index: 1;
  width: 14px;
  height: 14px;
  bottom: -7px;
  border: 2px solid var(--area-kind-own-ink);
  background: var(--area-kind-own);
}

.peer-strip__median {
  bottom: -2px;
  width: 2px;
  height: 22px;
  background: var(--ink-2);
}

.peer-strip__ends {
  display: flex;
  justify-content: space-between;
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.peer-table__scroll {
  max-width: 100%;
  overflow-x: auto;
}

.peer-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.peer-table th,
.peer-table td {
  padding: 6px 8px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  white-space: nowrap;
}

.peer-table td.num {
  text-align: right;
}

.peer-table thead th {
  color: var(--ink-2);
  font-weight: 600;
}
</style>
```

- [ ] **Step 4: AreaTab.vue 接線**

1. import：`import PeerFeesPanel from './PeerFeesPanel.vue'`；API import 加 `getAreaPeerFees`；type import 加 `AreaPeerFees`；`import { DEFAULT_PEER_AGE, type PeerAge } from './peerFeesFormat'`。
2. `changes` 那段之後加：

```ts
// 附近同業收費（2026-10-15 規格 7.1）：年齡放這裡（換校區、半徑都保留）；換校區、半徑、年齡都清空再讀，
// 只採用最後一次的回應。清單的公告收費也用這份（同半徑、同年齡）。
const peerAge = ref<PeerAge>(DEFAULT_PEER_AGE)
const peerFees = ref<AreaPeerFees | null>(null)
const peerFeesFailed = ref(false)
const peerFeesRequests = useRequestSequence()
async function loadPeerFees() {
  const request = peerFeesRequests.begin()
  peerFees.value = null
  peerFeesFailed.value = false
  if (!props.campusKey) return
  try {
    const result = await getAreaPeerFees(props.campusKey, radiusKm.value, peerAge.value)
    if (peerFeesRequests.isCurrent(request)) peerFees.value = result
  } catch {
    if (peerFeesRequests.isCurrent(request)) peerFeesFailed.value = true
  }
}
watch([() => props.campusKey, radiusKm, peerAge], () => void loadPeerFees(), { immediate: true })
```

3. template：`.area-top` 的結束 `</div>` 與 `<OpportunityPanel ... />` 之間加：

```vue
      <PeerFeesPanel v-model:age="peerAge" :data="peerFees" :failed="peerFeesFailed" :csv-name="csvName" @retry="loadPeerFees()" />
```

- [ ] **Step 5: 跑測試與型別**

Run: `AT src/__tests__/peerFeesPanel.test.ts src/__tests__/areaTab.test.ts src/__tests__/areaTabChunkFailure.test.ts`
Expected：PASS。若「切換年齡發出 update:age」那則因 Element Plus 的 radio 結構選不到 input，改成 `wrapper.findComponent({ name: 'ElRadioGroup' }).vm.$emit('update:modelValue', 4)`，斷言不變。再跑 typecheck：Expected 通過。

- [ ] **Step 6: Commit**

```bash
git add admin/src/components/admissions/area/PeerFeesPanel.vue admin/src/components/admissions/area/AreaTab.vue admin/src/__tests__/peerFeesPanel.test.ts admin/src/__tests__/areaTab.test.ts admin/src/__tests__/areaTabChunkFailure.test.ts
git commit -m "feat(admin): 區域分析新增「附近同業收費」區塊" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: 兩份附近清單的新欄位

**Files:**
- Modify: `admin/src/components/admissions/area/NearbyPanel.vue`
- Modify: `admin/src/components/admissions/area/NearbyKindergartens.vue`
- Modify: `admin/src/components/admissions/area/NearbyBabycare.vue`
- Modify: `admin/src/components/admissions/area/areaFormat.ts`（`babycareMeta`、新 `babycareFeeText`）
- Modify: `admin/src/components/admissions/area/AreaTab.vue`（把 `peerFees`、`peerAge` 傳給 NearbyPanel）
- Modify: `admin/src/__tests__/nearbyKindergartens.test.ts`、`admin/src/__tests__/nearbyProviders.test.ts`、`admin/src/__tests__/areaFormat.test.ts`

**Interfaces:**
- Consumes: Task 8 `formatYuan`、`feeSourceLine`、`FEE_ITEM_LABELS`、`FEE_ITEM_KEYS`、`type PeerAge`；Task 9 的 `peerFees`、`peerAge`。
- Produces: `NearbyKindergartens` 新 props `fees?: AreaPeerFees | null`、`feeAge?: PeerAge`；`NearbyPanel` 新 props `peerFees`、`peerAge`（轉給幼兒園清單）；`areaFormat.babycareFeeText(summary) -> string`。

- [ ] **Step 1: 寫失敗測試**

`admin/src/__tests__/nearbyKindergartens.test.ts`：

1. 現有斷言 `月費（估）…元` 的列：改成沒傳 `fees` 時結尾是「・—」，例如 `'380 m・核定 90 人・—'`（照該測試原本用的空白處理方式改字串，不改比對方式）。來源小字的斷言改成 `'資料來源：全國教保資訊網（kiang 整理）・10/08 更新'`。
2. 新增：

```ts
it('收費：列上寫該年齡的學期收費，沒公布寫「未公布收費」；來源小字帶收費學年', () => {
  const wrapper = mountList({ fees: areaPeerFees(), feeAge: 3 })
  expect(wrapper.findAll('.nearby__meta').map((meta) => meta.text())).toEqual([
    '0 m・核定 210 人・3 歲學期 89,750',
    '380 m・核定 90 人・3 歲學期 17,965',
    '950 m・核定 — 人・3 歲學期 63,190',
    '1.8 km・核定 120 人・未公布收費',
  ])
  expect(wrapper.get('.nearby__source').text()).toBe(
    '資料來源：全國教保資訊網（kiang 整理）・收費為 114 學年公告・10/08 更新　目前是 115 學年，最新公開收費是 114 學年。',
  )
})

it('展開詳情：每位幼生面積、幼童專用車、兼辦國小課後、逐項收費、交通費', async () => {
  const data = areaKindergartens([
    kindergarten({ source_id: 'kg-own', name: '高雄市私立常春藤幼兒園', distance_m: 0, is_own: true, indoor_m2_per_child: 3.4, outdoor_m2_per_child: 2.6, has_shuttle: true, after_school_capacity: 0 }),
  ])
  const wrapper = mountList({ data, fees: areaPeerFees(), feeAge: 3 })
  await wrapper.get('.nearby__row').trigger('click')
  const detail = wrapper.get('.nearby__detail').text()
  expect(detail).toContain('每位幼生面積室內 3.4 m²・戶外 2.6 m²')
  expect(detail).toContain('幼童專用車有')
  expect(detail).toContain('兼辦國小課後無')
  expect(detail).toContain('3 歲收費學費 19,900 元・雜費 5,500 元・材料費 24,750 元・活動費 23,100 元・午餐費 8,250 元・點心費 8,250 元；課後延托每月 1,200 元')
  expect(detail).toContain('交通費單 770 雙 1540')
})

it('沒有的值整行不顯示', async () => {
  const wrapper = mountList({ fees: areaPeerFees(), feeAge: 3 })
  await wrapper.findAll('.nearby__row')[3].trigger('click')
  const detail = wrapper.get('.nearby__detail').text()
  expect(detail).not.toContain('每位幼生面積')
  expect(detail).not.toContain('幼童專用車')
  expect(detail).not.toContain('歲收費')
})
```

（`mountList(props)` 是該檔既有的 helper：`mount(NearbyKindergartens, { props: { data: areaKindergartens(), failed: false, radiusKm: 3, ...props } })`。import 補 `areaPeerFees`；`kindergarten` 已經有。）

`admin/src/__tests__/nearbyProviders.test.ts`（附近托嬰中心 describe）新增：

```ts
it('月費、準公共與評鑑標籤；摘要下多一句月費對照；展開看費用說明與評鑑年度', async () => {
  const items = [
    babycareItem({ source_id: 'bc-a', distance_m: 165, monthly_fee: 17900, quasi_public: true, evaluation_grade: '優等', evaluation_year: 114, fee_note: '平均月費: 17,900元' }),
    babycareItem({ source_id: 'bc-b', distance_m: 520, monthly_fee: 15000, quasi_public: false, evaluation_grade: null }),
    babycareItem({ source_id: 'bc-c', distance_m: 900, monthly_fee: 21000 }),
  ]
  const data = areaBabycare(items)
  data.summary = { ...data.summary, fee_count: 3, fee_median: 17900, fee_min: 15000, fee_max: 21000, own_age2_monthly: 19264, fee_school_year: 114 }
  const wrapper = mountIt(NearbyBabycare, babycareProps({ data }))
  expect(wrapper.get('.nearby__meta').text()).toBe('165 m・核定 40 人・實際收托 32 人・月費 17,900')
  expect(wrapper.findAll('.nearby__item')[0].findAll('.el-tag').map((tag) => tag.text())).toEqual(['托嬰中心', '準公共', '評鑑 優等'])
  expect(wrapper.get('.nearby__fees').text()).toBe('日間托育月費中位數 17,900 元（15,000–21,000）；本校 2 歲班月均 19,264 元。')
  expect(wrapper.text()).toContain('準公共托育的家長另有政府補助，這裡是機構公告的平均月費。')
  await wrapper.get('.nearby__row').trigger('click')
  expect(wrapper.get('.nearby__detail').text()).toContain('費用說明平均月費: 17,900元')
  expect(wrapper.get('.nearby__detail').text()).toContain('評鑑114 年評鑑')
})

it('月費少於 3 所：不寫月費對照', () => {
  const wrapper = mountIt(NearbyBabycare, babycareProps())
  expect(wrapper.find('.nearby__fees').exists()).toBe(false)
})
```

`admin/src/__tests__/areaFormat.test.ts`（托嬰格式那段）新增：

```ts
it('babycareFeeText：中位數與範圍，有本校 2 歲班才接後半句；少於 3 所回空字串', () => {
  const summary = { ...areaBabycare().summary, fee_count: 3, fee_median: 17900, fee_min: 15000, fee_max: 21000, own_age2_monthly: null }
  expect(babycareFeeText(summary)).toBe('日間托育月費中位數 17,900 元（15,000–21,000）。')
  expect(babycareFeeText({ ...summary, own_age2_monthly: 19264 })).toBe('日間托育月費中位數 17,900 元（15,000–21,000）；本校 2 歲班月均 19,264 元。')
  expect(babycareFeeText({ ...summary, fee_median: null })).toBe('')
})
```

- [ ] **Step 2: 跑測試確認紅燈**

Run: `AT src/__tests__/nearbyKindergartens.test.ts src/__tests__/nearbyProviders.test.ts src/__tests__/areaFormat.test.ts`
Expected：FAIL（`babycareFeeText` 不存在、清單沒有收費）。

- [ ] **Step 3: areaFormat.ts**

`babycareMeta` 改成多讀 `monthly_fee`（`Pick` 加 `'monthly_fee'`），有值才接「・月費 N」：

```ts
/** 清單每列第二行：距離・核定 N 人・實際收托 M 人（・月費 X）。來源沒給（null）寫「—」，不寫 0；月費沒有就不寫。 */
export function babycareMeta(item: Pick<AreaBabycareItem, 'distance_m' | 'approved_capacity' | 'enrolled' | 'monthly_fee'>): string {
  const count = (value: number | null): string => (value === null ? NO_VALUE : String(value))
  const fee = item.monthly_fee === null || item.monthly_fee === undefined ? '' : `・月費 ${formatCount(item.monthly_fee)}`
  return `${formatDistance(item.distance_m)}・核定 ${count(item.approved_capacity)} 人・實際收托 ${count(item.enrolled)} 人${fee}`
}

/** 托嬰摘要下的月費對照（2026-10-15 規格 7.3）：少於 3 所（沒有中位數）回空字串；本校沒有 2 歲班收費就不寫後半句。 */
export function babycareFeeText(summary: AreaBabycare['summary']): string {
  if (summary.fee_median === null || summary.fee_min === null || summary.fee_max === null) return ''
  const head = `日間托育月費中位數 ${formatCount(summary.fee_median)} 元（${formatCount(summary.fee_min)}–${formatCount(summary.fee_max)}）`
  return summary.own_age2_monthly === null ? `${head}。` : `${head}；本校 2 歲班月均 ${formatCount(summary.own_age2_monthly)} 元。`
}
```

- [ ] **Step 4: NearbyBabycare.vue**

1. import 加 `babycareFeeText`。
2. `const summary = ...` 之後加 `const feeText = computed(() => (props.data ? babycareFeeText(props.data.summary) : ''))`。
3. template：`<p class="nearby__summary num">{{ summary }}</p>` 之後加：

```vue
      <template v-if="feeText">
        <p class="nearby__fees num">{{ feeText }}</p>
        <p class="hint nearby__fees-note">準公共托育的家長另有政府補助，這裡是機構公告的平均月費。</p>
      </template>
```

4. `.nearby__line` 裡類型標籤之後加：

```vue
              <el-tag v-if="item.quasi_public" size="small" type="success" effect="plain" round>準公共</el-tag>
              <el-tag v-if="item.evaluation_grade" size="small" type="info" effect="plain" round>評鑑 {{ item.evaluation_grade }}</el-tag>
```

5. `<dl>` 裡電話那行之後加：

```vue
            <div v-if="item.fee_note"><dt>費用說明</dt><dd>{{ item.fee_note }}</dd></div>
            <div v-if="item.evaluation_year"><dt>評鑑</dt><dd>{{ item.evaluation_year }} 年評鑑</dd></div>
```

6. scoped style 加 `.nearby__fees, .nearby__fees-note { margin: 0; }` 與 `.nearby__fees { color: var(--ink); }`。

- [ ] **Step 5: NearbyKindergartens.vue 與 NearbyPanel.vue**

`NearbyKindergartens.vue`：

1. import：type 加 `AreaPeerFees`；`import { FEE_ITEM_KEYS, FEE_ITEM_LABELS, feeSourceLine, formatYuan, type PeerAge } from './peerFeesFormat'`；areaFormat import 加 `formatCount`。
2. props 改成 `defineProps<{ data: AreaKindergartens | null; failed: boolean; radiusKm: RadiusKm; fees?: AreaPeerFees | null; feeAge?: PeerAge }>()`。
3. 刪掉 `const fee = (value: number | null) => ...`（不再顯示估計月費），加：

```ts
// 公告收費（2026-10-15 規格 7.2）：來自 AreaTab 的 /area/fees（同半徑、同年齡），依 source_id 對應。
// 收費還沒回來或讀取失敗寫「—」；回來了但這所沒有收費寫「未公布收費」。
const feeBySchool = computed(() => new Map((props.fees?.schools ?? []).map((school) => [school.source_id, school])))
function feeMeta(id: string): string {
  if (!props.fees) return NO_VALUE
  const school = feeBySchool.value.get(id)
  return school?.semester_total ? `${props.feeAge} 歲學期 ${formatCount(school.semester_total)}` : '未公布收費'
}
function feeDetail(id: string): string {
  const school = feeBySchool.value.get(id)
  if (!school?.semester_total) return ''
  const semester = FEE_ITEM_KEYS.filter((key) => key !== 'after_care_monthly')
    .map((key) => `${FEE_ITEM_LABELS[key]} ${formatYuan(school.items[key])}`)
    .join('・')
  return `${semester}；課後延托每月 ${formatYuan(school.items.after_care_monthly)}`
}
const transport = (id: string): string => feeBySchool.value.get(id)?.transport_note ?? ''
const area = (value: number | null | undefined): string => (value === null || value === undefined ? NO_VALUE : `${value.toFixed(1)} m²`)
const sourceLine = computed(() => (props.data ? feeSourceLine(props.data.source_note, taipeiMonthDay(props.data.synced_at), props.fees ?? null) : ''))
```

4. template 列上 meta 改成：

```vue
            <span class="nearby__meta num">{{ formatDistance(item.distance_m) }}・核定 {{ item.approved_capacity ?? NO_VALUE }} 人・{{ feeMeta(item.source_id) }}</span>
```

5. `<dl>` 的準公共那行之後、官方資料之前加：

```vue
            <div v-if="item.indoor_m2_per_child !== null || item.outdoor_m2_per_child !== null">
              <dt>每位幼生面積</dt><dd>室內 {{ area(item.indoor_m2_per_child) }}・戶外 {{ area(item.outdoor_m2_per_child) }}</dd>
            </div>
            <div v-if="item.has_shuttle !== null"><dt>幼童專用車</dt><dd>{{ item.has_shuttle ? '有' : '無' }}</dd></div>
            <div v-if="item.after_school_capacity !== null">
              <dt>兼辦國小課後</dt><dd>{{ item.after_school_capacity ? `有（${item.after_school_capacity} 人）` : '無' }}</dd>
            </div>
            <div v-if="feeDetail(item.source_id)"><dt>{{ feeAge }} 歲收費</dt><dd>{{ feeDetail(item.source_id) }}</dd></div>
            <div v-if="transport(item.source_id)"><dt>交通費</dt><dd>{{ transport(item.source_id) }}</dd></div>
```

6. 來源小字改成 `<p class="hint nearby__source">{{ sourceLine }}</p>`。
7. 檔頭註解補一行：「列上的收費是 /area/fees 的公告收費（2026-10-15），不再顯示 kiang 估計的月費。」

`NearbyPanel.vue`：props 加 `peerFees?: AreaPeerFees | null` 與 `peerAge?: PeerAge`（import 型別），`<NearbyKindergartens ...>` 加 `:fees="peerFees" :fee-age="peerAge"`。

`AreaTab.vue`：`<NearbyPanel ...>` 加 `:peer-fees="peerFees" :peer-age="peerAge"`。

- [ ] **Step 6: 跑測試與型別**

Run: `AT src/__tests__/nearbyKindergartens.test.ts src/__tests__/nearbyProviders.test.ts src/__tests__/areaFormat.test.ts src/__tests__/areaTab.test.ts`
Expected：PASS（`areaTab.test.ts` 裡比對幼兒園列文字的舊斷言，改成新的 meta 字串）。再跑 typecheck：Expected 通過。

- [ ] **Step 7: Commit**

```bash
git add admin/src/components/admissions/area/NearbyPanel.vue admin/src/components/admissions/area/NearbyKindergartens.vue admin/src/components/admissions/area/NearbyBabycare.vue admin/src/components/admissions/area/areaFormat.ts admin/src/components/admissions/area/AreaTab.vue admin/src/__tests__/nearbyKindergartens.test.ts admin/src/__tests__/nearbyProviders.test.ts admin/src/__tests__/areaFormat.test.ts admin/src/__tests__/areaTab.test.ts
git commit -m "feat(admin): 附近幼兒園改列公告收費與空間服務，托嬰加月費、評鑑與準公共" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: stack e2e

**Files:**
- Modify: `tests/stack/db.ts`（新 `seedPeerFees()`）
- Modify: `tests/stack/admissions-area.spec.ts`（檔尾加兩則）

**Interfaces:**
- Consumes: 整條鏈（API、後台）。
- Produces: `seedPeerFees(): void`（冪等）。

- [ ] **Step 1: 種子**

`tests/stack/db.ts` 的 `seedProviderChanges` 之後加：

```ts
/** 附近同業收費（2026-10-15）：stack 用檔案匯入，不會抓收費檔，這裡直接寫。崇德北方加三所私立同業；
 *  本校 2–4 歲、準公共、公立各一筆收費；收費狀態列 114 學年；三所托嬰補月費、評鑑、準公共。可以重跑。 */
export function seedPeerFees(): void {
  psql(
    `INSERT INTO geo_kindergartens (source_id, name, kind, district, address, lat, lng, approved_capacity, has_penalty, is_active, synced_at)
     VALUES ('e2e-kg-p1', '高雄市私立測試己幼兒園', 'private', '左營區', '測試路11號', 22.676662, 120.307197, 100, false, true, now()),
            ('e2e-kg-p2', '高雄市私立測試庚幼兒園', 'private', '左營區', '測試路12號', 22.678662, 120.307197, 100, false, true, now()),
            ('e2e-kg-p3', '高雄市私立測試辛幼兒園', 'private', '左營區', '測試路13號', 22.680662, 120.307197, 100, false, true, now())
     ON CONFLICT (source_id) DO NOTHING;
     INSERT INTO geo_kindergarten_fees (source_id, age, school_year, months, tuition, misc_fee, materials, activities, lunch, snack, semester_total, after_care_monthly, transport_note, synced_at)
     VALUES ('e2e-kg-own', 2, 114, 5.5, 21800, 5500, 31900, 30250, 8250, 8250, 105950, 1200, '單 770 雙 1540', now()),
            ('e2e-kg-own', 3, 114, 5.5, 19900, 5500, 24750, 23100, 8250, 8250, 89750, 1200, '單 770 雙 1540', now()),
            ('e2e-kg-own', 4, 114, 5.5, 19900, 5500, 20000, 23100, 8250, 8250, 85000, 1200, NULL, now()),
            ('e2e-kg-p1', 3, 114, 5.5, 15000, 20000, 11000, 9900, 7500, 6600, 70000, 1200, NULL, now()),
            ('e2e-kg-p2', 3, 114, 5.5, 16000, 21300, 15000, 12000, 8000, 7700, 80000, 1500, NULL, now()),
            ('e2e-kg-p3', 3, 114, 5.5, 20000, 25000, 20000, 15000, 8000, 7000, 95000, 1800, NULL, now()),
            ('e2e-kg-p1', 4, 114, 5.5, NULL, NULL, NULL, NULL, NULL, NULL, 60000, NULL, NULL, now()),
            ('e2e-kg-p2', 4, 114, 5.5, NULL, NULL, NULL, NULL, NULL, NULL, 65000, NULL, NULL, now()),
            ('e2e-kg-p3', 4, 114, 5.5, NULL, NULL, NULL, NULL, NULL, NULL, 70000, NULL, NULL, now()),
            ('e2e-kg-quasi', 3, 114, 5.5, NULL, NULL, NULL, NULL, NULL, NULL, 63190, NULL, NULL, now()),
            ('e2e-kg-public', 3, 114, 5.5, NULL, NULL, NULL, NULL, NULL, NULL, 17965, NULL, NULL, now())
     ON CONFLICT DO NOTHING;
     INSERT INTO geo_dataset_status (dataset, active_version, label, synced_at, checked_at)
     VALUES ('kindergarten_fees', '114', '114', now(), now())
     ON CONFLICT (dataset) DO UPDATE SET active_version = '114', label = '114', synced_at = now(), checked_at = now(), last_error = NULL;
     UPDATE geo_babycare SET monthly_fee = 17900, evaluation_grade = '優等', evaluation_year = 114, quasi_public = true, fee_note = '平均月費: 17,900元' WHERE source_id = 'e2e-bc-near';
     UPDATE geo_babycare SET monthly_fee = 15000, quasi_public = true WHERE source_id = 'e2e-bc-home';
     UPDATE geo_babycare SET monthly_fee = 21000, evaluation_grade = '乙等', quasi_public = false WHERE source_id = 'e2e-bc-mid';`,
    {},
  )
}
```

（`e2e-kg-own` 座標 22.673662, 120.307197；三所同業在它北方約 330／560／780 公尺。）

- [ ] **Step 2: spec**

`tests/stack/admissions-area.spec.ts`：import 改成 `import { seedBirthSeries, seedPeerFees, seedProviderChanges } from './db'`。**檔尾**加（放最後，因為種子會多三所幼兒園，前面的清單數量斷言不能受影響）：

```ts
test('附近同業收費：總結、落點條、切換年齡、清單收費、托嬰月費', async ({ browser }) => {
  test.setTimeout(90_000)
  mkdirSync(SHOTS, { recursive: true })
  seedPeerFees()
  const { context, page } = await openAs(browser, 'super_admin')
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await openArea(page)
  const panel = page.locator('.peer-fees')

  await test.step('預設 3 歲：學年、總結、落點條四點、兩張表', async () => {
    await expect(panel.locator('.peer-fees__title')).toHaveText('附近同業收費')
    await expect(panel.locator('.peer-fees__subtitle')).toContainText('114 學年・全日班・一學期公告收費')
    await expect(panel.locator('.peer-fees__summary')).toHaveText(
      '3 公里內私立幼兒園（不含準公共）有 3 所公布收費，3 歲班一學期中位數 80,000 元；本校 89,750 元，第 2 高。',
    )
    await expect(panel.locator('.peer-strip__dot')).toHaveCount(4)
    await expect(panel.locator('table.peer-table')).toHaveCount(2)
    await expect(panel).toContainText('不是家長實付')
  })

  await test.step('附近幼兒園清單列上有 3 歲學期收費', async () => {
    await expect(page.locator('.nearby .nearby__item', { hasText: '常春藤崇德幼兒園' }).locator('.nearby__meta')).toContainText('3 歲學期 89,750')
    await expect(page.locator('.nearby .nearby__item', { hasText: '測試丙' }).locator('.nearby__meta')).toContainText('未公布收費')
  })

  await test.step('切到 4 歲：總結與清單一起變', async () => {
    await panel.locator('.el-radio-button', { hasText: '4 歲' }).click()
    await expect(panel.locator('.peer-fees__summary')).toHaveText(
      '3 公里內私立幼兒園（不含準公共）有 3 所公布收費，4 歲班一學期中位數 65,000 元；本校 85,000 元，第 1 高。',
    )
    await expect(page.locator('.nearby .nearby__item', { hasText: '常春藤崇德幼兒園' }).locator('.nearby__meta')).toContainText('4 歲學期 85,000')
  })

  await test.step('托嬰：月費、標籤與月費對照', async () => {
    await page.locator('.nearby-panel .el-radio-button', { hasText: '托嬰中心' }).click()
    const list = page.locator('.nearby--babycare')
    await expect(list.locator('.nearby__fees')).toHaveText('日間托育月費中位數 17,900 元（15,000–21,000）；本校 2 歲班月均 19,264 元。')
    await expect(list.locator('.nearby__item', { hasText: '測試甲托嬰中心' })).toContainText('評鑑 優等')
  })

  await test.step('新區塊沒有 serious／critical 的無障礙問題', async () => {
    const results = await new AxeBuilder({ page }).include('.peer-fees').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
    const serious = results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    expect(serious.map((violation) => `${violation.id}：${violation.nodes.map((node) => node.target.join(' ')).join('；')}`)).toEqual([])
  })

  await page.screenshot({ path: path.join(SHOTS, 'admissions-peer-fees-1440.png'), fullPage: true })
  expect(errors, '頁面不該有未處理的錯誤').toEqual([])
  await context.close()
})

test('390px：附近同業收費不撐出頁面', async ({ browser }) => {
  mkdirSync(SHOTS, { recursive: true })
  seedPeerFees()
  const { context, page } = await openAs(browser, 'super_admin', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await openArea(page)
  await page.locator('.peer-fees').scrollIntoViewIfNeeded()
  await expect(page.locator('.peer-fees__summary')).toBeVisible()
  await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: path.join(SHOTS, 'admissions-peer-fees-390.png'), fullPage: true })
  await context.close()
})
```

- [ ] **Step 3: 建置並跑**

```bash
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm run e2e:build
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; E2E_DB_NAME=ivy_website_peerfees_e2e_test E2E_API_PORT=8783 E2E_WEB_PORT=3783 npx playwright test -c playwright.stack.config.ts tests/stack/admissions-area.spec.ts
```

Expected：admissions-area.spec 全部 PASS（含原有各則）。紅燈先看是不是種子座標讓某所落在 3 公里外、或總結的數字不同，用 `psql ivy_website_peerfees_e2e_test -c "select source_id, age, semester_total from geo_kindergarten_fees order by 1,2"` 對資料，不要直接改期望值。

- [ ] **Step 4: Commit**

```bash
git add tests/stack/db.ts tests/stack/admissions-area.spec.ts
git commit -m "test(e2e): 附近同業收費（總結、切換年齡、清單收費、托嬰月費、手機不溢出）" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: 真實資料閘門、全套驗證、文件

**Files:**
- Create（不進 repo）：`/private/tmp/claude-501/-Users-yilunwu-Desktop-ivy-website-admin/23287528-cc20-46f6-a2fc-ca6ff77fb744/scratchpad/peer_fees_gate.py`（路徑以當下 session 的 scratchpad 為準）
- Modify: `README.md`（頂部日期段落）、`deploy/README.md`（「公開地理資料同步（招生區域分析）」章節）、`docs/specs/2026-10-15-peer-comparison-design.md`（狀態行）

- [ ] **Step 1: 建閘門用的庫並匯入真實資料**

```bash
createdb ivy_website_peerfees_gate_test
cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_peerfees_gate_test WEBSITE_SESSION_SECRET=gate-only-secret uv run --frozen alembic upgrade head && cd ..
```

背景跑一次完整的網路同步（本機連得到 data.kcg.gov.tw 與 kiang；人口、出生回補會花十幾分鐘），結束時看輸出的「幼兒園收費：updated（114 學年…）」與托嬰：

```bash
cd backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_peerfees_gate_test WEBSITE_SESSION_SECRET=gate-only-secret WEBSITE_ADMISSIONS_ENABLED=true uv run --frozen python -m app.cli geo-sync
```

（用 Bash 工具的 `run_in_background`，timeout 設最大；不要在 subagent 跑。）

- [ ] **Step 2: 閘門腳本**

寫 scratchpad 的 `peer_fees_gate.py`：

```python
"""附近同業收費真實資料閘門（不進 repo）：發布義華校址後，印出 3 公里 2／3／4 歲的私立一般統計與本校收費。"""
import asyncio
import os
import sys

sys.path.insert(0, os.getcwd())  # 從 backend/ 執行，才找得到 app 與 tests

from app.admissions import area, peer_fees  # noqa: E402
from app.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402
from tests.geo_helpers import publish_campus_address  # noqa: E402


async def main() -> None:
    url = "postgresql+asyncpg://localhost/ivy_website_peerfees_gate_test"
    settings = Settings(environment="test", database_url=url, test_database_url=url, session_secret="gate-only-secret", admissions_enabled=True, geo_auto_sync=False)
    app = create_app(settings)
    async with app.state.session_factory() as db:
        await publish_campus_address(db, "yihua", "高雄市三民區義華路68號")
        for age in (2, 3, 4):
            result = await peer_fees.query_peer_fees(db, "yihua", radius_km=3, age=age)
            private = result["groups"][0]
            print(age, "私立一般", private, "本校", result["own"] and result["own"]["semester_total"], result["own_missing"])
            print("   準公共", result["groups"][1]["with_fee"], result["groups"][1]["lowest"], result["groups"][1]["highest"])
            print("   私立一般各所", sorted(
                (s["semester_total"], s["name"]) for s in result["schools"] if s["kind"] == "private" and not s["is_own"] and s["semester_total"]
            ))
        babycare = await area.query_babycare(db, "yihua", radius_km=3)
        print("托嬰", {key: babycare["summary"][key] for key in ("count", "fee_count", "fee_median", "fee_min", "fee_max", "own_age2_monthly")})


asyncio.run(main())
```

Run: `cd backend && uv run --frozen python /private/tmp/claude-501/-Users-yilunwu-Desktop-ivy-website-admin/23287528-cc20-46f6-a2fc-ca6ff77fb744/scratchpad/peer_fees_gate.py`

Expected（規格 §2 參考數字）：3 歲、4 歲私立一般 `with_fee` 19、`median` 75,270、`lowest` 40,200、`highest` 114,600、`own_rank` 8、`rank_total` 20、本校 89,750；2 歲中位數 83,000、本校 105,950、第 4 高；準公共有收費 25 所。**不一致時逐所說明**（印出的各所清單和規格的手算差在哪一所、為什麼：3 公里邊界、本校座標差、教育部名單又變了），寫進回報；說明不了就停下來，不要往下做。

- [ ] **Step 3: 全套驗證（一次一組）**

1. 後端全套（主 session 背景跑）：`BT tests`。Expected：全部 PASS（記下 passed／skipped 數）。
2. 後台全套：`source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; cd admin && npx vitest run --testTimeout=60000`；typecheck。Expected：全部 PASS。
3. 契約檢查（Global Constraints「檢查」指令）。Expected：通過。
4. `cd backend && uv run --frozen alembic heads`。Expected：單一 head `f2b8c4d1e7a9`。
5. stack 整套：`E2E_DB_NAME=ivy_website_peerfees_e2e_test E2E_API_PORT=8783 E2E_WEB_PORT=3783 npm run test:e2e:stack`（Node 22）。Expected：全部 PASS；高負載下的逾時單獨重跑確認。

- [ ] **Step 4: 文件**

`README.md` 頂部加日期段落（照現有段落格式）：

```markdown
## 2026-10-15 區域分析：附近同業收費

- 區域分析在地圖下方多「附近同業收費」：本校 2–5 歲全日班一學期公告收費，在半徑內私立一般園所裡的中位數、範圍、排名、落點條與逐項對照；準公共、公立、非營利只當背景（家長實付另有補助，不試算）。
- 附近幼兒園清單改列公告收費（不再顯示 kiang 估計的月費），展開看每位幼生室內／戶外面積、幼童專用車、兼辦國小課後；附近托嬰加月費、評鑑等級、準公共，摘要對照本校 2 歲班月均。
- 資料：kiang 的教保資訊網收費檔（目前 114 學年；115 學年在驗證碼後面，不繞過）與社家署托嬰逐所明細，都在 kiang.github.io。migration `f2b8c4d1e7a9` 只新增。規格 `docs/specs/2026-10-15-peer-comparison-design.md`、計畫 `docs/superpowers/plans/2026-10-15-peer-comparison.md`。
```

`deploy/README.md`「公開地理資料同步（招生區域分析）」章節加一小節：

```markdown
### 幼兒園收費與托嬰明細（2026-10-15）

- 收費：幼兒園名單這一輪更新成功（或收費從沒匯入過）就接著做。從目前學年往回試三年找最新學年（`slip{學年}/高雄市/`），學年換新、距上次全量 30 天或 `--force` 時全量（約 624 檔、23 MB、0.2 秒間隔，約 5 分鐘），否則只補沒有收費的園所。全量抓到的園所少於上次 80%、或下載錯誤超過一成就不換版（`last_error` 寫原因）。單檔 512 KB、整輪 20 分鐘上限。狀態列 `kindergarten_fees`（label＝學年）。不支援檔案匯入：來源和名單同一台主機。
- 托嬰明細：托嬰名單這一輪更新成功（或還沒有任何一所抓過明細）就逐所抓 `ncwisweb.sfaa.gov.tw/data/高雄市/<id>.json`；單檔失敗保留舊值，整輪 5 分鐘上限，不影響托嬰名單的結果。`--babycare-file` 匯入時不抓明細。
- 上線驗收 SQL：`select dataset, label, synced_at, checked_at, last_error from geo_dataset_status where dataset in ('kindergartens','kindergarten_fees','babycare');`、`select age, count(*) from geo_kindergarten_fees group by age order by age;`、`select count(*), count(monthly_fee), count(evaluation_grade) from geo_babycare where is_active;`
```

`docs/specs/2026-10-15-peer-comparison-design.md` 狀態行改成「已實作（分支 `feature/peer-fees-20261015`），未部署」，並在 §12 尾端補兩條實作時的決定：「收費與托嬰明細在『從沒匯入過』時不等名單到期（上線第一輪就有資料，不必 `--force`，`--force` 會連門牌一起重抓）」「群組範圍欄位叫 `lowest`／`highest`（規格 §6 範例寫 `min`／`max`）」。

- [ ] **Step 5: Commit**

```bash
git add README.md deploy/README.md docs/specs/2026-10-15-peer-comparison-design.md
git commit -m "docs: 附近同業收費的上線說明、同步規則與驗收 SQL" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: 收尾回報（不 push）**

回報：分支 commit 清單、各全套的實際數字、閘門結果（含差異說明）、未驗證項（正式站、登入後畫面）。push main＝部署，指令交給使用者用 `!` 跑；測試庫 `ivy_website_peerfees_test`、`ivy_website_peerfees_gate_test`、`ivy_website_peerfees_e2e_test` 在上線後再清。
