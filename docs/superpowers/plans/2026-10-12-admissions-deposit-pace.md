# 招生統計「預繳速度」與「可能範圍」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 招生統計的兩個警示改用「預繳速度」判斷（不再被剛參觀、還沒到預繳時間的家長誤導），統計總覽加預繳速度卡，各維度預繳率旁加 Beta 收縮的「可能範圍」。

**Architecture:** 後端新增兩個模組：`estimation.py`（純 Python 數學：Beta 分位數、Kaplan–Meier、Poisson-binomial，不碰資料庫）與 `deposit_pace.py`（查每筆訪視的參觀日與最後一次 `deposit_added` 事件，算曲線與比較）。`stats.py` 用它們改寫 `FUNNEL_DROP`／`SOURCE_IMBALANCE` 並在回應加 `deposit_timing`、`deposit_pace`；`stats.py`、`area.py`、`compare` 各列加 `visit_to_deposit_range`。後台共用統計表新增 `range` 欄位種類（CSV 拆兩欄），統計總覽加一張卡、月比卡加一行。

**Tech Stack:** FastAPI 0.136.1（釘版）＋SQLAlchemy 2.0 async＋PostgreSQL、pytest；Vue 3＋Element Plus＋Vitest；OpenAPI 契約（`contracts/`）；Playwright stack e2e。

**Spec:** `docs/specs/2026-10-12-admissions-deposit-pace-design.md`（以下稱「規格」；每個任務開工前讀規格對應章節）

## Global Constraints

- 工作目錄：`~/Repositories/ivy-website-wt/admissions-deposit-pace-20261012`（分支 `feature/admissions-deposit-pace-20261012`，從 origin/main `f09ad269`，sparse checkout）。不碰 `~/Desktop/ivy-website-admin`。
- **不加任何相依套件**（後端只用標準函式庫的 `math`；不裝 scipy、numpy）。FastAPI 0.136.1 釘版，不升。
- **不加 migration、不改資料表、不改匯出**（`export.py`、`contracts/ivy-recruitment/ivy-schema.json` 不動）。
- 常數照規格：`RANGE_PRIOR_STRENGTH = 10.0`、`RANGE_LEVEL = 0.8`、`PACE_MIN_EVENTS = 10`、`PACE_P_THRESHOLD = 0.10`、`PACE_MIN_SHORTFALL = 2.0`、`TIMING_CHECKPOINTS = (7, 14, 30, 60, 90)`。
- 全體預繳率 `prior_rate = (預繳 + 1) / (參觀 + 2)`，參觀 0 回 None（規格 §7.2）。
- 「預繳過」＝`has_deposit` 或 `withdrawn_at` 有值；預繳時間＝最後一筆 `deposit_added` 的台北日期（規格 §4.2、§4.3）。日期一律用 `app.common.timezones` 的 `OPERATING_TZ`／`today_local`。
- 警示代碼、等級、`target_tab`、`target_filter` 不變；文案逐字照規格 §6.2、§6.3。
- 後台圖表只用表格＋CSS 長條、顏色走既有 CSS 變數（`--el-color-primary`、`--surface-3`、`--ink-3`、`--el-color-danger`），不寫 rgba／hex 字面值。CSV 沒有值寫空白、不寫「—」。
- 文案繁體中文（台灣用語）；這是後台，可以有說明文字。
- **Node 22**：每個 npm 指令前加 `source ~/.nvm/nvm.sh; nvm use 22 >/dev/null;`（用分號，`source nvm.sh` 會回 3，不能用 `&&`）。
- **後端測試**：環境變數要寫在同一行（Bash 工具不保留環境變數），一律用專屬測試庫：
  `cd backend && WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pace1012_test uv run pytest -q <檔案或 -k>`
  不要用 shell 變數展開組指令（zsh 不分詞）。
- **subagent 不跑後端全套 pytest、不跑全套 stack e2e**（超過 10 分鐘沒輸出會被中止）；只跑任務列出的檔案。全套由主 session 在 Task 9 背景跑。
- 機器 8GB RAM：同時只跑一組測試。
- 改了後端 schema 就從 repo 根目錄跑 `source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm run contract:generate`，並一起提交 `contracts/openapi.json`、`contracts/generated/website-api.d.ts`。
- **Commit**：repo 規則是未經使用者同意不 commit；本計畫的 commit 步驟只在使用者已同意「本分支本機 commit」時執行（執行前會問）。**絕不 push**（push main 會觸發正式部署）。Conventional Commit、繁體中文，結尾加 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。
- 不碰根目錄凍結原型（`index.html`、`app.js` 等）、不碰 `web/` 程式。

## Review Focus

1. **台北日界**：預繳事件在台北 23:30（UTC 15:30）建立，預繳日要算台北那天，不是 UTC 那天；參觀日到預繳日的天數才不會少一天。→ Task 2 `test_deposit_date_uses_taipei_date`。
2. **使用者手選舊的參考月份**：`reference_month` 指定成不是最新的月份時，比較組包含之後的月份，`deposit_pace.month` 是所選月份、照樣可判斷。→ Task 3 `test_pace_uses_selected_reference_month`。
3. **全校還沒有任何預繳**（新開放的校區）：各列範圍不能是「0–0%」。→ Task 1 `test_prior_rate_avoids_degenerate_range`、Task 4 `test_compare_ranges`（明華 0/1）。
4. **退預繳後再預繳、取消退出、已匿名化**：用最後一筆 `deposit_added`；匿名化的訪視照算。→ Task 2 `test_load_visits_definitions`。
5. **手機 390px 多一欄**：統計表、五校比較在框內橫捲，頁面不溢出。→ Task 9 stack `admissions-flow` 既有的 390 溢出檢查＋截圖。

---

### Task 0：環境準備（不寫程式）

**Files:** 無（只裝相依、建測試庫）

- [ ] **Step 1：確認 worktree 與分支**

```bash
cd ~/Repositories/ivy-website-wt/admissions-deposit-pace-20261012
git status --short   # 應只有 docs/specs/2026-10-12-admissions-deposit-pace-design.md 與本計畫兩個未追蹤檔
git log --oneline -1 # f09ad269
```

- [ ] **Step 2：裝相依**

```bash
cd ~/Repositories/ivy-website-wt/admissions-deposit-pace-20261012
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm ci; npm --prefix admin ci; npm --prefix web ci
cd backend && uv sync
```

- [ ] **Step 3：建專屬測試庫並跑 migration**

```bash
createdb ivy_website_pace1012_test
cd ~/Repositories/ivy-website-wt/admissions-deposit-pace-20261012/backend && WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pace1012_test WEBSITE_SESSION_SECRET=local-only-secret uv run alembic upgrade head
```

- [ ] **Step 4：基準測試（改之前先綠）**

```bash
cd ~/Repositories/ivy-website-wt/admissions-deposit-pace-20261012/backend && WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pace1012_test uv run pytest -q tests/test_admissions_stats.py tests/test_admissions_area.py
```

Expected: 全部 passed。

- [ ] **Step 5：提交規格與計畫**（使用者同意 commit 時）

```bash
git add docs/specs/2026-10-12-admissions-deposit-pace-design.md docs/superpowers/plans/2026-10-12-admissions-deposit-pace.md
git commit -m "docs(admissions): 預繳速度與可能範圍的規格與實作計畫"
```

---

### Task 1：純計算模組 `estimation.py`

**Files:**
- Create: `backend/app/admissions/estimation.py`
- Test: `backend/tests/test_admissions_estimation.py`

**Interfaces:**
- Produces（後面任務用的確切名稱）：
  - `RANGE_PRIOR_STRENGTH: float = 10.0`、`RANGE_LEVEL: float = 0.8`
  - `regularized_incomplete_beta(x: float, a: float, b: float) -> float`
  - `beta_ppf(q: float, a: float, b: float) -> float`
  - `prior_rate(deposits: int, visits: int) -> float | None`
  - `rate_range(successes: int, trials: int, prior_rate: float | None, *, strength: float = RANGE_PRIOR_STRENGTH, level: float = RANGE_LEVEL) -> dict[str, float] | None`（回 `{"low": float, "high": float}`，百分比小數一位）
  - `kaplan_meier(observations: Iterable[tuple[int, bool]]) -> list[tuple[int, float]]`（`(預繳日, 累積預繳率 0–1)`，天數升序，只列有預繳的日子）
  - `cumulative_at(curve: Sequence[tuple[int, float]], day: int) -> float`
  - `poisson_binomial_cdf(probabilities: Sequence[float], k: int) -> float`

- [ ] **Step 1：寫失敗的測試**

`backend/tests/test_admissions_estimation.py`：

```python
"""預繳速度與可能範圍的純計算（2026-10-12 規格 §5–§8）。參考值是 scipy／lifelines 離線算好的。"""
from __future__ import annotations

import itertools
import math

import pytest

from app.admissions import estimation as E


@pytest.mark.parametrize("q", [0.01, 0.1, 0.25, 0.5, 0.9, 0.99])
def test_beta_ppf_closed_forms(q):
    assert E.beta_ppf(q, 1, 1) == pytest.approx(q, abs=1e-8)
    assert E.beta_ppf(q, 3, 1) == pytest.approx(q ** (1 / 3), abs=1e-8)
    assert E.beta_ppf(q, 1, 4) == pytest.approx(1 - (1 - q) ** (1 / 4), abs=1e-8)


@pytest.mark.parametrize("a", [0.5, 2, 7.5, 120])
def test_beta_ppf_symmetric_median(a):
    assert E.beta_ppf(0.5, a, a) == pytest.approx(0.5, abs=1e-8)


def test_beta_ppf_reference_values_and_edges():
    # scipy.stats.beta.ppf([0.1, 0.9], 6, 7) = [0.28817245, 0.63772404]
    assert E.beta_ppf(0.1, 6, 7) == pytest.approx(0.28817245, abs=1e-6)
    assert E.beta_ppf(0.9, 6, 7) == pytest.approx(0.63772404, abs=1e-6)
    assert E.beta_ppf(0.0, 2, 3) == 0.0
    assert E.beta_ppf(1.0, 2, 3) == 1.0
    with pytest.raises(ValueError):
        E.beta_ppf(1.5, 2, 3)


def test_regularized_incomplete_beta_edges():
    assert E.regularized_incomplete_beta(0.0, 2, 3) == 0.0
    assert E.regularized_incomplete_beta(1.0, 2, 3) == 1.0
    # I_x(1, 1) = x
    assert E.regularized_incomplete_beta(0.37, 1, 1) == pytest.approx(0.37, abs=1e-12)
    with pytest.raises(ValueError):
        E.regularized_incomplete_beta(0.5, 0, 3)


def test_rate_range_spec_example_and_none():
    # 規格 §7.1：r = 0.3、3 筆裡 3 筆 → 28.8–63.8%（Beta(6, 7) 的 10%／90%）。
    assert E.rate_range(3, 3, 0.3) == {"low": 28.8, "high": 63.8}
    assert E.rate_range(0, 0, 0.3) is None
    assert E.rate_range(2, 5, None) is None


def test_rate_range_large_sample_close_to_raw_rate():
    # 100/300、r = 0.3：Beta(103, 207) → scipy 29.8–36.7。
    assert E.rate_range(100, 300, 0.3) == {"low": 29.8, "high": 36.7}


def test_prior_rate_avoids_degenerate_range():
    # Review Focus 3：全校還沒有任何預繳，範圍不能縮成 0–0%。
    assert E.prior_rate(0, 5) == pytest.approx(1 / 7)
    assert E.prior_rate(5, 9) == pytest.approx(6 / 11)
    assert E.prior_rate(0, 0) is None
    low_high = E.rate_range(0, 1, E.prior_rate(0, 1))
    assert low_high == {"low": 13.9, "high": 48.5}


def test_kaplan_meier_hand_example():
    # 5 筆：第 2 天預繳 1、第 3 天到今天為止 1、第 5 天預繳 2、第 8 天到今天為止 1。
    # 第 2 天：n=5、d=1 → S=4/5；第 3 天出場 1；第 5 天：n=3、d=2 → S=4/5·1/3=4/15 → F=11/15。
    curve = E.kaplan_meier([(2, True), (3, False), (5, True), (5, True), (8, False)])
    assert [day for day, _ in curve] == [2, 5]
    assert curve[0][1] == pytest.approx(0.2)
    assert curve[1][1] == pytest.approx(11 / 15)


def test_kaplan_meier_same_day_event_before_censor_and_day_zero():
    # 同一天先算預繳再扣到今天為止的：第 0 天 n=4、d=1 → F=0.25；第 0 天出場 2 筆（1 預繳＋1 到今天）。
    # 第 4 天：n=2、d=1 → S=0.75·0.5 → F=0.625。
    curve = E.kaplan_meier([(0, True), (0, False), (4, True), (9, False)])
    assert curve == [(0, pytest.approx(0.25)), (4, pytest.approx(0.625))]


def test_kaplan_meier_all_censored_is_empty():
    assert E.kaplan_meier([(3, False), (10, False)]) == []


def test_cumulative_at_steps_and_carries_forward():
    curve = [(2, 0.2), (5, 0.6)]
    assert E.cumulative_at(curve, 0) == 0.0
    assert E.cumulative_at(curve, 1) == 0.0
    assert E.cumulative_at(curve, 2) == 0.2
    assert E.cumulative_at(curve, 4) == 0.2
    assert E.cumulative_at(curve, 5) == 0.6
    assert E.cumulative_at(curve, 500) == 0.6
    assert E.cumulative_at([], 10) == 0.0


@pytest.mark.parametrize("probabilities", [[0.3], [0.1, 0.9], [0.2, 0.5, 0.7, 0.05], [0.0, 1.0, 0.4]])
def test_poisson_binomial_cdf_matches_brute_force(probabilities):
    n = len(probabilities)
    for k in range(-1, n + 2):
        brute = sum(
            math.prod(p if hit else 1 - p for p, hit in zip(probabilities, bits))
            for bits in itertools.product([False, True], repeat=n)
            if sum(bits) <= k
        )
        assert E.poisson_binomial_cdf(probabilities, k) == pytest.approx(brute, abs=1e-12)


def test_poisson_binomial_cdf_edges():
    assert E.poisson_binomial_cdf([], 0) == 1.0
    assert E.poisson_binomial_cdf([0.5, 0.5], -1) == 0.0
    # 15 筆各 0.4、實際 1 筆：0.6^15 + 15·0.4·0.6^14 ≈ 0.0052（規格 §6.1 例子）。
    assert E.poisson_binomial_cdf([0.4] * 15, 1) == pytest.approx(0.6**15 + 15 * 0.4 * 0.6**14)
```

- [ ] **Step 2：跑測試確認失敗**

Run: `cd backend && WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pace1012_test uv run pytest -q tests/test_admissions_estimation.py`
Expected: FAIL，`ImportError: cannot import name 'estimation'`。

- [ ] **Step 3：實作**

`backend/app/admissions/estimation.py`（已在 2026-10-12 對 scipy／lifelines 交叉驗證過：分位數誤差 < 1e-12、KM 與 lifelines 一致、Poisson-binomial 與窮舉一致）：

```python
"""招生統計的純計算（2026-10-12 預繳速度與可能範圍規格 §7、§8）。

只用 Python 標準函式庫、不碰資料庫：將來併入園務可以整支搬過去。
"""
from __future__ import annotations

import math
from typing import Iterable, Sequence

# 可能範圍：先借 10 位全體平均的家長（事前強度），取事後分布的 80% 範圍。
RANGE_PRIOR_STRENGTH = 10.0
RANGE_LEVEL = 0.8

_CF_EPS = 3e-14
_CF_TINY = 1e-300
_CF_MAX_ITER = 500
# 範圍只顯示到 0.1%，二分搜尋到 1e-9 綽綽有餘（約 30 次）。
_PPF_TOLERANCE = 1e-9


def _beta_continued_fraction(x: float, a: float, b: float) -> float:
    """I_x(a, b) 的連分式（modified Lentz，Numerical Recipes betacf）。"""
    qab, qap, qam = a + b, a + 1.0, a - 1.0
    c = 1.0
    d = 1.0 - qab * x / qap
    d = 1.0 / (d if abs(d) >= _CF_TINY else _CF_TINY)
    h = d
    for m in range(1, _CF_MAX_ITER + 1):
        m2 = 2 * m
        for aa in (
            m * (b - m) * x / ((qam + m2) * (a + m2)),
            -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2)),
        ):
            d = 1.0 + aa * d
            d = 1.0 / (d if abs(d) >= _CF_TINY else _CF_TINY)
            c = 1.0 + aa / c
            c = c if abs(c) >= _CF_TINY else _CF_TINY
            delta = d * c
            h *= delta
        if abs(delta - 1.0) < _CF_EPS:
            return h
    raise ArithmeticError("incomplete beta continued fraction did not converge")


def regularized_incomplete_beta(x: float, a: float, b: float) -> float:
    """I_x(a, b)：Beta(a, b) 分布在 x 的累積機率。"""
    if a <= 0 or b <= 0:
        raise ValueError("a、b 必須大於 0")
    if x <= 0.0:
        return 0.0
    if x >= 1.0:
        return 1.0
    front = math.exp(
        math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log1p(-x)
    )
    if x < (a + 1.0) / (a + b + 2.0):
        return front * _beta_continued_fraction(x, a, b) / a
    return 1.0 - front * _beta_continued_fraction(1.0 - x, b, a) / b


def beta_ppf(q: float, a: float, b: float) -> float:
    """Beta(a, b) 的 q 分位數：對 I_x 二分搜尋（I_x 對 x 單調遞增）。"""
    if not 0.0 <= q <= 1.0:
        raise ValueError("q 必須在 0 到 1 之間")
    if q == 0.0:
        return 0.0
    if q == 1.0:
        return 1.0
    low, high = 0.0, 1.0
    while high - low > _PPF_TOLERANCE:
        mid = (low + high) / 2.0
        if regularized_incomplete_beta(mid, a, b) < q:
            low = mid
        else:
            high = mid
    return (low + high) / 2.0


def prior_rate(deposits: int, visits: int) -> float | None:
    """可能範圍要靠的全體預繳率（規格 §7.2）：(預繳＋1) ÷ (參觀＋2)，0–1 的比例。
    加一是為了全體還沒有預繳（或全部預繳）時，範圍不會縮成「0–0%」這種假的確定；資料多時和原始比率幾乎一樣。"""
    return (deposits + 1) / (visits + 2) if visits > 0 else None


def rate_range(
    successes: int,
    trials: int,
    prior_rate: float | None,
    *,
    strength: float = RANGE_PRIOR_STRENGTH,
    level: float = RANGE_LEVEL,
) -> dict[str, float] | None:
    """可能範圍（規格 §7.1）：事前 Beta(k·r, k·(1−r))，事後取 level 的等尾範圍，百分比到小數一位。
    prior_rate 是 0–1 之間（不含兩端）的比例，用 prior_rate() 算；trials 為 0 或 prior_rate 為 None 時回 None。"""
    if trials <= 0 or prior_rate is None:
        return None
    a = successes + strength * prior_rate
    b = trials - successes + strength * (1.0 - prior_rate)
    tail = (1.0 - level) / 2.0
    return {"low": round(beta_ppf(tail, a, b) * 100, 1), "high": round(beta_ppf(1.0 - tail, a, b) * 100, 1)}


def kaplan_meier(observations: Iterable[tuple[int, bool]]) -> list[tuple[int, float]]:
    """累積預繳率的階梯（規格 §5）：回 [(有預繳的天數, 到那天為止的累積預繳率 F)]，天數升序。
    observations 是 (天數, 是否預繳)；沒預繳的天數是觀察到今天為止的天數。
    同一天先扣預繳、再扣觀察到今天為止的（標準 Kaplan–Meier 慣例）。"""
    exits: dict[int, int] = {}
    events: dict[int, int] = {}
    at_risk = 0
    for days, deposited in observations:
        at_risk += 1
        exits[days] = exits.get(days, 0) + 1
        if deposited:
            events[days] = events.get(days, 0) + 1
    survival = 1.0
    curve: list[tuple[int, float]] = []
    for day in sorted(exits):
        deposited_today = events.get(day, 0)
        if deposited_today:
            survival *= 1.0 - deposited_today / at_risk
            curve.append((day, 1.0 - survival))
        at_risk -= exits[day]
    return curve


def cumulative_at(curve: Sequence[tuple[int, float]], day: int) -> float:
    """第 day 天的累積預繳率；超過最後一個預繳日沿用最後的值，第一個預繳日之前是 0。"""
    value = 0.0
    for event_day, cumulative in curve:
        if event_day > day:
            break
        value = cumulative
    return value


def poisson_binomial_cdf(probabilities: Sequence[float], k: int) -> float:
    """P(X ≤ k)，X 是各自獨立、機率 probabilities[i] 的成功次數總和（動態規劃精確算）。"""
    if k < 0:
        return 0.0
    if k >= len(probabilities):
        return 1.0
    distribution = [1.0]
    for p in probabilities:
        nxt = [0.0] * (len(distribution) + 1)
        for successes, mass in enumerate(distribution):
            nxt[successes] += mass * (1.0 - p)
            nxt[successes + 1] += mass * p
        distribution = nxt
    return min(1.0, sum(distribution[: k + 1]))
```

- [ ] **Step 4：跑測試確認通過**

Run: `cd backend && WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pace1012_test uv run pytest -q tests/test_admissions_estimation.py`
Expected: 全部 passed。

- [ ] **Step 5：Commit**

```bash
git add backend/app/admissions/estimation.py backend/tests/test_admissions_estimation.py
git commit -m "feat(admissions): 新增招生統計純計算模組（Beta 分位數、Kaplan–Meier、Poisson-binomial）"
```

---

### Task 2：預繳速度資料與計算 `deposit_pace.py`

**Files:**
- Create: `backend/app/admissions/deposit_pace.py`
- Test: `backend/tests/test_admissions_deposit_pace.py`（本任務只寫「口徑」與 `deposit_timing`／`pace_check` 的測試；警示測試在 Task 3 加到同一檔）

**Interfaces:**
- Consumes：Task 1 的 `estimation.kaplan_meier`、`estimation.cumulative_at`、`estimation.poisson_binomial_cdf`。
- Produces：
  - 常數 `PACE_MIN_EVENTS = 10`、`PACE_P_THRESHOLD = 0.10`、`PACE_MIN_SHORTFALL = 2.0`、`TIMING_CHECKPOINTS = (7, 14, 30, 60, 90)`、`HALF_HORIZON = 90`
  - `@dataclass(frozen=True) class PaceVisit`：`visit_id: uuid.UUID`、`month: str`、`source: str | None`、`created_at: datetime`、`visit_date: date`、`deposited: bool`、`deposit_date: date | None`；property `missing_time -> bool`
  - `async def load_visits(db: AsyncSession, filters: list[Any]) -> list[PaceVisit]`（`filters` 就是 `stats._base_filters(...)` 的回傳）
  - `def deposit_timing(visits: list[PaceVisit], today: date) -> dict[str, Any]`（規格 §9.1 `deposit_timing` 的形狀）
  - `@dataclass(frozen=True) class PaceResult`：`evaluable: bool`、`reason: str | None`、`visits: int`、`expected: float | None`、`observed: int`、`slow: bool`
  - `def pace_check(test: list[PaceVisit], baseline: list[PaceVisit], today: date) -> PaceResult`
  - `def pace_dict(result: PaceResult, month: str | None) -> dict[str, Any]`（`deposit_pace` 回應形狀，多一個 `month`）

- [ ] **Step 1：寫失敗的測試**

`backend/tests/test_admissions_deposit_pace.py`：

```python
"""預繳速度（2026-10-12 規格 §4–§6）。訪視與事件直接寫資料庫，才能控制參觀日與預繳時間。"""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone

from app.admissions import deposit_pace
from app.admissions.academic import roc_month
from app.admissions.models import RecruitmentEventLog, RecruitmentVisit
from app.admissions.stats import _base_filters

# 台北 2026-10-01 12:00（同 test_admissions_stats.NOW）。
NOW = datetime(2026, 10, 1, 4, 0, tzinfo=timezone.utc)
TODAY = date(2026, 10, 1)


def noon(day: date) -> datetime:
    """台北那天中午（UTC 04:00）。"""
    return datetime(day.year, day.month, day.day, 4, 0, tzinfo=timezone.utc)


def add_visit(db, *, campus_key="chongde", visit_date: date, source: str | None = None, has_deposit=False,
              withdrawn_at: datetime | None = None, anonymized=False, created_at: datetime | None = None,
              target_school_year=115, target_semester=1) -> RecruitmentVisit:
    created = created_at or noon(visit_date)
    visit = RecruitmentVisit(
        id=uuid.uuid4(), campus_key=campus_key, month=roc_month(visit_date), seq_no=None, visit_date=visit_date,
        child_name="測試幼生", birthday=None, grade=None, source=source, referrer=None, tour_guide_name=None,
        has_deposit=has_deposit, rides_bus=False, enrolled=False, enrolled_on=None, transfer_term=False,
        no_deposit_reason=None, withdrawn_at=withdrawn_at, withdrawn_from="deposited" if withdrawn_at else None,
        withdraw_reason="家長改送他校" if withdrawn_at else None, provisional_grade=None,
        target_school_year=target_school_year, target_semester=target_semester,
        anonymized_at=created if anonymized else None,
        version=1, created_at=created, updated_at=created,
    )
    db.add(visit)
    return visit


def add_event(db, visit: RecruitmentVisit, at: datetime, event_type: str = "deposit_added") -> None:
    to_stage = "visited" if event_type == "deposit_removed" else "deposited"
    db.add(RecruitmentEventLog(
        id=uuid.uuid4(), recruitment_visit_id=visit.id, event_type=event_type, from_stage=None, to_stage=to_stage,
        reason=None, actor_user_id=None, metadata_json=None, created_at=at,
    ))


def deposited_after(db, *, visit_date: date, days: int, **fields) -> RecruitmentVisit:
    """一筆參觀後第 days 天（台北中午）標記預繳的訪視。"""
    visit = add_visit(db, visit_date=visit_date, has_deposit=True, **fields)
    add_event(db, visit, noon(visit_date + timedelta(days=days)))
    return visit


def seed_june_baseline(db, *, source: str | None = None, deposits: int = 12, total: int = 30) -> None:
    """06-01 參觀 total 筆（到 10-01 已 122 天）：第 1..deposits 天各預繳 1 筆，其他沒預繳。
    deposits=12、total=30 時累積預繳率：第 2 天 6.7%、第 3 天 10.0%、第 7 天 23.3%、第 12 天起 40.0%。"""
    june = date(2026, 6, 1)
    for day in range(1, deposits + 1):
        deposited_after(db, visit_date=june, days=day, source=source)
    for _ in range(total - deposits):
        add_visit(db, visit_date=june, source=source)


async def load(db, campus_key="chongde"):
    return await deposit_pace.load_visits(db, _base_filters(campus_key, None, None))


async def test_load_visits_definitions(db_session):
    """規格 §4.2、§4.3（Review Focus 4）。"""
    d = date(2026, 9, 1)
    a = deposited_after(db_session, visit_date=d, days=2)                                     # 一般預繳
    b = add_visit(db_session, visit_date=d, withdrawn_at=noon(date(2026, 9, 20)))             # 預繳後退出
    add_event(db_session, b, noon(date(2026, 9, 4)))
    c = add_visit(db_session, visit_date=d)                                                   # 退預繳回已訪視
    add_event(db_session, c, noon(date(2026, 9, 5)))
    add_event(db_session, c, noon(date(2026, 9, 6)), "deposit_removed")
    missing = add_visit(db_session, visit_date=d, has_deposit=True)                           # 已預繳但沒事件
    anon = deposited_after(db_session, visit_date=d, days=3, anonymized=True)                 # 已匿名化
    again = add_visit(db_session, visit_date=d, has_deposit=True)                             # 退預繳後再預繳
    add_event(db_session, again, noon(date(2026, 9, 3)))
    add_event(db_session, again, noon(date(2026, 9, 5)), "deposit_removed")
    add_event(db_session, again, noon(date(2026, 9, 10)))
    future = add_visit(db_session, visit_date=date(2026, 10, 5))                              # 參觀日在未來
    other = add_visit(db_session, campus_key="yihua", visit_date=d, has_deposit=True)         # 別校
    await db_session.commit()

    rows = {visit.visit_id: visit for visit in await load(db_session)}

    assert other.id not in rows
    assert (rows[a.id].deposited, rows[a.id].deposit_date) == (True, date(2026, 9, 3))
    assert (rows[b.id].deposited, rows[b.id].deposit_date) == (True, date(2026, 9, 4))
    assert (rows[c.id].deposited, rows[c.id].deposit_date) == (False, None)
    assert (rows[missing.id].deposited, rows[missing.id].missing_time) == (True, True)
    assert (rows[anon.id].deposited, rows[anon.id].deposit_date) == (True, date(2026, 9, 4))
    assert rows[again.id].deposit_date == date(2026, 9, 10)
    assert rows[future.id].visit_date == date(2026, 10, 5)

    timing = deposit_pace.deposit_timing(list(rows.values()), TODAY)
    # 列入曲線：a b c anon again（missing 沒時間、future 在未來都不列）→ 5 筆，其中預繳 4（a b anon again）。
    assert timing == {
        "status": "insufficient", "visits": 5, "deposited": 4, "missing_time": 1, "min_events": 10,
        "checkpoints": [], "half_by_day": None,
    }


async def test_deposit_date_uses_taipei_date(db_session):
    """Review Focus 1：台北 09-03 23:30＝UTC 09-03 15:30；台北 09-04 00:30＝UTC 09-03 16:30。"""
    d = date(2026, 9, 1)
    late = add_visit(db_session, visit_date=d, has_deposit=True)
    add_event(db_session, late, datetime(2026, 9, 3, 15, 30, tzinfo=timezone.utc))
    after_midnight = add_visit(db_session, visit_date=d, has_deposit=True)
    add_event(db_session, after_midnight, datetime(2026, 9, 3, 16, 30, tzinfo=timezone.utc))
    await db_session.commit()

    rows = {visit.visit_id: visit for visit in await load(db_session)}
    assert rows[late.id].deposit_date == date(2026, 9, 3)
    assert rows[after_midnight.id].deposit_date == date(2026, 9, 4)


async def test_deposit_timing_checkpoints_and_half(db_session):
    seed_june_baseline(db_session)
    await db_session.commit()

    timing = deposit_pace.deposit_timing(await load(db_session), TODAY)

    assert timing["status"] == "ok"
    assert (timing["visits"], timing["deposited"], timing["missing_time"]) == (30, 12, 0)
    assert timing["checkpoints"] == [
        {"day": 7, "cumulative_rate": 23.3, "visits_reached": 30},
        {"day": 14, "cumulative_rate": 40.0, "visits_reached": 30},
        {"day": 30, "cumulative_rate": 40.0, "visits_reached": 30},
        {"day": 60, "cumulative_rate": 40.0, "visits_reached": 30},
        {"day": 90, "cumulative_rate": 40.0, "visits_reached": 30},
    ]
    # F(90)=40% 的一半 20%：第 6 天 6/30=20% 第一次達到。
    assert timing["half_by_day"] == 6


async def test_deposit_timing_null_when_nobody_reached_the_day(db_session):
    # 09-01 參觀（到 10-01 才 30 天）：第 60、90 天還沒有人參觀滿 → null；也就沒有一半時間。
    for day in range(1, 11):
        deposited_after(db_session, visit_date=date(2026, 9, 1), days=day)
    await db_session.commit()

    timing = deposit_pace.deposit_timing(await load(db_session), TODAY)

    assert timing["status"] == "ok"
    by_day = {point["day"]: point for point in timing["checkpoints"]}
    assert by_day[30] == {"day": 30, "cumulative_rate": 100.0, "visits_reached": 10}
    assert by_day[60] == {"day": 60, "cumulative_rate": None, "visits_reached": 0}
    assert by_day[90]["cumulative_rate"] is None
    assert timing["half_by_day"] is None


async def test_pace_check_early_month_is_not_slow(db_session):
    seed_june_baseline(db_session)
    for _ in range(5):
        add_visit(db_session, visit_date=date(2026, 9, 28))   # 才參觀 3 天、0 筆預繳
    await db_session.commit()
    visits = await load(db_session)
    test = [v for v in visits if v.month == "115.09"]
    baseline = [v for v in visits if v.month != "115.09"]

    result = deposit_pace.pace_check(test, baseline, TODAY)

    # 第 3 天的累積預繳率 10% × 5 筆＝預期 0.5 筆；少 0.5 筆 < 2 → 不算偏慢。
    assert result == deposit_pace.PaceResult(
        evaluable=True, reason=None, visits=5, expected=0.5, observed=0, slow=False,
    )


async def test_pace_check_slow_cohort(db_session):
    seed_june_baseline(db_session)
    for _ in range(14):
        add_visit(db_session, visit_date=date(2026, 9, 11))   # 參觀 20 天
    deposited_after(db_session, visit_date=date(2026, 9, 11), days=2)
    await db_session.commit()
    visits = await load(db_session)
    test = [v for v in visits if v.month == "115.09"]
    baseline = [v for v in visits if v.month != "115.09"]

    result = deposit_pace.pace_check(test, baseline, TODAY)

    # 第 20 天 40% × 15 筆＝6.0；實際 1；P(X ≤ 1)≈0.005 ≤ 0.10 且少 5 筆 → 偏慢。
    assert result == deposit_pace.PaceResult(
        evaluable=True, reason=None, visits=15, expected=6.0, observed=1, slow=True,
    )


async def test_pace_check_insufficient_baseline_and_no_visits(db_session):
    seed_june_baseline(db_session, deposits=9)
    for _ in range(15):
        add_visit(db_session, visit_date=date(2026, 9, 11))
    await db_session.commit()
    visits = await load(db_session)
    test = [v for v in visits if v.month == "115.09"]
    baseline = [v for v in visits if v.month != "115.09"]

    assert deposit_pace.pace_check(test, baseline, TODAY) == deposit_pace.PaceResult(
        evaluable=False, reason="insufficient_baseline", visits=15, expected=None, observed=0, slow=False,
    )
    assert deposit_pace.pace_check([], baseline, TODAY) == deposit_pace.PaceResult(
        evaluable=False, reason="no_visits", visits=0, expected=None, observed=0, slow=False,
    )
    assert deposit_pace.pace_dict(deposit_pace.pace_check([], baseline, TODAY), "115.09") == {
        "evaluable": False, "reason": "no_visits", "month": "115.09", "visits": 0, "expected": None,
        "observed": 0, "slow": False,
    }
```

- [ ] **Step 2：跑測試確認失敗**

Run: `cd backend && WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pace1012_test uv run pytest -q tests/test_admissions_deposit_pace.py`
Expected: FAIL，`ImportError: cannot import name 'deposit_pace'`。

- [ ] **Step 3：實作**

`backend/app/admissions/deposit_pace.py`：

```python
"""預繳速度（2026-10-12 預繳速度與可能範圍規格 §4–§6）。

每筆訪視取參觀日與最後一筆 deposit_added 事件的台北日期，算「參觀後第 N 天的累積預繳率」
（Kaplan–Meier），並比較某一組訪視的預繳是否比另一組慢（Poisson-binomial）。
警示怎麼分組（本月 vs 其他月份、某來源 vs 其他來源）由 stats.py 決定；這裡不知道月份與來源的口徑。
只讀：不 flush、不 commit。
"""
from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass
from datetime import date, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import estimation
from app.admissions.models import RecruitmentEventLog, RecruitmentVisit
from app.common.timezones import OPERATING_TZ

PACE_MIN_EVENTS = 10
PACE_P_THRESHOLD = 0.10
PACE_MIN_SHORTFALL = 2.0
TIMING_CHECKPOINTS = (7, 14, 30, 60, 90)
HALF_HORIZON = 90
# 浮點誤差：F(d) 剛好等於 F(90) 的一半時也要算達到。
_HALF_TOLERANCE = 1e-12


@dataclass(frozen=True)
class PaceVisit:
    visit_id: uuid.UUID
    month: str
    source: str | None
    created_at: datetime
    visit_date: date
    # 預繳過＝目前已預繳，或已退出（只有已預繳、已註冊可以退出）。規格 §4.2。
    deposited: bool
    # 最後一筆 deposit_added 的台北日期；沒預繳過、或預繳過卻沒有事件時是 None。規格 §4.3。
    deposit_date: date | None

    @property
    def missing_time(self) -> bool:
        return self.deposited and self.deposit_date is None


async def load_visits(db: AsyncSession, filters: list[Any]) -> list[PaceVisit]:
    """母體同 /stats（filters 由 stats._base_filters 產生），已匿名化的照算（事件在匿名化後保留）。"""
    v, e = RecruitmentVisit, RecruitmentEventLog
    last_deposit = (
        select(e.recruitment_visit_id.label("visit_id"), func.max(e.created_at).label("deposit_at"))
        .where(e.event_type == "deposit_added")
        .group_by(e.recruitment_visit_id)
        .subquery()
    )
    stmt = (
        select(v.id, v.month, v.source, v.created_at, v.visit_date, v.has_deposit, v.withdrawn_at, last_deposit.c.deposit_at)
        .select_from(v)
        .outerjoin(last_deposit, last_deposit.c.visit_id == v.id)
        .where(*filters)
    )
    visits: list[PaceVisit] = []
    for row in (await db.execute(stmt)).all():
        deposited = bool(row.has_deposit) or row.withdrawn_at is not None
        deposit_date = row.deposit_at.astimezone(OPERATING_TZ).date() if deposited and row.deposit_at is not None else None
        visits.append(PaceVisit(
            visit_id=row.id, month=row.month, source=row.source, created_at=row.created_at,
            visit_date=row.visit_date, deposited=deposited, deposit_date=deposit_date,
        ))
    return visits


def _observation(visit: PaceVisit, today: date) -> tuple[int, bool] | None:
    """(天數, 是否預繳)；參觀日在未來、預繳過卻沒有時間的不列入（規格 §4.1、§4.3）。"""
    if visit.visit_date > today or visit.missing_time:
        return None
    if visit.deposited and visit.deposit_date is not None:
        return max(0, (visit.deposit_date - visit.visit_date).days), True
    return (today - visit.visit_date).days, False


def _pct(value: float | None) -> float | None:
    return None if value is None else round(value * 100, 1)


def deposit_timing(visits: list[PaceVisit], today: date) -> dict[str, Any]:
    """/stats 的 deposit_timing（規格 §5、§9.1）。"""
    counted = [visit for visit in visits if _observation(visit, today) is not None]
    observations = [_observation(visit, today) for visit in counted]
    deposited = sum(1 for obs in observations if obs is not None and obs[1])
    base = {
        "visits": len(counted),
        "deposited": deposited,
        "missing_time": sum(1 for visit in visits if visit.missing_time),
        "min_events": PACE_MIN_EVENTS,
    }
    if deposited < PACE_MIN_EVENTS:
        return {**base, "status": "insufficient", "checkpoints": [], "half_by_day": None}
    curve = estimation.kaplan_meier(obs for obs in observations if obs is not None)
    ages = [(today - visit.visit_date).days for visit in counted]
    checkpoints = []
    for day in TIMING_CHECKPOINTS:
        reached = sum(1 for age in ages if age >= day)
        value = estimation.cumulative_at(curve, day) if reached else None
        checkpoints.append({"day": day, "cumulative_rate": _pct(value), "visits_reached": reached})
    half = None
    if any(age >= HALF_HORIZON for age in ages):
        horizon = estimation.cumulative_at(curve, HALF_HORIZON)
        if horizon > 0:
            half = next(day for day, value in curve if value >= horizon / 2 - _HALF_TOLERANCE)
    return {**base, "status": "ok", "checkpoints": checkpoints, "half_by_day": half}


@dataclass(frozen=True)
class PaceResult:
    evaluable: bool
    reason: str | None
    visits: int
    expected: float | None
    observed: int
    slow: bool


def pace_check(test: list[PaceVisit], baseline: list[PaceVisit], today: date) -> PaceResult:
    """test 這組到今天的預繳，是否明顯比 baseline 的速度少（規格 §6.1）。"""
    tested = [visit for visit in test if _observation(visit, today) is not None]
    if not tested:
        return PaceResult(evaluable=False, reason="no_visits", visits=0, expected=None, observed=0, slow=False)
    observed = sum(1 for visit in tested if visit.deposited)
    base_observations = [obs for visit in baseline if (obs := _observation(visit, today)) is not None]
    if sum(1 for _, deposited in base_observations if deposited) < PACE_MIN_EVENTS:
        return PaceResult(
            evaluable=False, reason="insufficient_baseline", visits=len(tested), expected=None, observed=observed, slow=False,
        )
    curve = estimation.kaplan_meier(base_observations)
    probabilities = [estimation.cumulative_at(curve, (today - visit.visit_date).days) for visit in tested]
    expected = sum(probabilities)
    p_value = estimation.poisson_binomial_cdf(probabilities, observed)
    slow = p_value <= PACE_P_THRESHOLD and expected - observed >= PACE_MIN_SHORTFALL
    return PaceResult(
        evaluable=True, reason=None, visits=len(tested), expected=round(expected, 1), observed=observed, slow=slow,
    )


def pace_dict(result: PaceResult, month: str | None) -> dict[str, Any]:
    """/stats 的 deposit_pace（規格 §9.1）。"""
    return {**asdict(result), "month": month}
```

- [ ] **Step 4：跑測試確認通過**

Run: `cd backend && WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pace1012_test uv run pytest -q tests/test_admissions_deposit_pace.py tests/test_admissions_estimation.py`
Expected: 全部 passed。

- [ ] **Step 5：Commit**

```bash
git add backend/app/admissions/deposit_pace.py backend/tests/test_admissions_deposit_pace.py
git commit -m "feat(admissions): 預繳速度的資料讀取、累積預繳率與速度比較"
```

---

### Task 3：`/stats` 接上預繳速度、兩個警示改判斷、三張表加可能範圍

**Files:**
- Modify: `backend/app/admissions/stats.py`（開頭 docstring、import、常數區 `FUNNEL_DROP_THRESHOLD`、`_find_source_imbalance`、`_alerts`、`_action_queue`、`query_stats`）
- Modify: `backend/app/admissions/schemas.py`（統計 C1 區塊：新 model、三種列加欄位、`AdmissionsStatsOut`）
- Modify: `contracts/openapi.json`、`contracts/generated/website-api.d.ts`（產生）
- Test: `backend/tests/test_admissions_deposit_pace.py`（加警示測試）、`backend/tests/test_admissions_stats.py`（改既有斷言）

**Interfaces:**
- Consumes：Task 1 `estimation.prior_rate`、`estimation.rate_range`；Task 2 `deposit_pace.load_visits`、`deposit_timing`、`pace_check`、`pace_dict`、`PaceVisit`、`PaceResult`。
- Produces：
  - `/stats` 回應新增 `deposit_timing`、`deposit_pace`；`by_grade[]`／`by_source[]`／`by_tour_guide[]` 每列 `visit_to_deposit_range: {low, high} | null`。
  - schema：`AdmissionsRateRange {low: float, high: float}`、`AdmissionsTimingCheckpoint`、`AdmissionsDepositTiming`、`AdmissionsDepositPace`（Task 4、5 會用 `AdmissionsRateRange`）。

- [ ] **Step 1：寫失敗的警示測試**（加到 `backend/tests/test_admissions_deposit_pace.py` 檔尾）

```python
from app.admissions import stats  # noqa: E402  （放到檔案最上方的 import 區）


async def query(db, campus_key="chongde", reference_month=None):
    return await stats.query_stats(db, campus_key, school_year=None, semester=None, reference_month=reference_month, now=NOW)


async def test_funnel_drop_not_raised_early_in_month(db_session):
    """舊判斷：115.09 預繳率 0% 對 115.06 的 40% → 月比 −40 會報；新判斷：才參觀 3 天，預期 0.5 筆 → 不報。"""
    seed_june_baseline(db_session)
    for _ in range(5):
        add_visit(db_session, visit_date=date(2026, 9, 28))
    await db_session.commit()

    result = await query(db_session)

    assert result["reference_month"] == "115.09"
    assert "FUNNEL_DROP" not in [alert["code"] for alert in result["alerts"]]
    assert result["deposit_pace"] == {
        "evaluable": True, "reason": None, "month": "115.09", "visits": 5, "expected": 0.5, "observed": 0, "slow": False,
    }


async def test_funnel_drop_raised_when_truly_slow(db_session):
    seed_june_baseline(db_session)
    for _ in range(14):
        add_visit(db_session, visit_date=date(2026, 9, 11))
    deposited_after(db_session, visit_date=date(2026, 9, 11), days=2)
    await db_session.commit()

    result = await query(db_session)

    assert result["alerts"][0] == {
        "code": "FUNNEL_DROP", "level": "warning", "title": "本月預繳比過去慢",
        "message": "115.09 參觀的 15 位家長，依過去的預繳速度到今天應有約 6.0 筆預繳，實際 1 筆。",
        "target_tab": "records", "target_filter": {"month": "115.09"},
    }
    assert result["deposit_pace"]["slow"] is True
    assert result["deposit_timing"]["status"] == "ok"


async def test_funnel_drop_skipped_with_insufficient_baseline(db_session):
    seed_june_baseline(db_session, deposits=9)
    for _ in range(15):
        add_visit(db_session, visit_date=date(2026, 9, 11))
    await db_session.commit()

    result = await query(db_session)

    assert result["alerts"] == []
    assert result["deposit_pace"]["reason"] == "insufficient_baseline"
    assert result["deposit_timing"]["status"] == "insufficient"


async def test_pace_uses_selected_reference_month(db_session):
    """Review Focus 2：手選 115.06，比較組是其他月份（包含之後的 115.09）。"""
    seed_june_baseline(db_session)
    for day in range(1, 11):
        deposited_after(db_session, visit_date=date(2026, 9, 1), days=day)
    await db_session.commit()

    result = await query(db_session, reference_month="115.06")

    assert result["reference_month"] == "115.06"
    pace = result["deposit_pace"]
    assert (pace["month"], pace["evaluable"], pace["visits"], pace["observed"]) == ("115.06", True, 30, 12)


def seed_source_scenario(db, *, fb_visit_date: date, fb_deposits: int) -> None:
    """親友介紹：06-01 參觀 30 筆（12 筆預繳，同 seed_june_baseline）＋08-01 參觀 15 筆（第 1..6 天各預繳 1 筆，
    08-01 建檔，在近 90 天內）。FB 廣告：25 筆，建檔＝參觀日，其中 fb_deposits 筆在參觀隔天預繳。
    近 90 天：FB 25、親友介紹 15 → FB 占 62.5%（≥ 40%）；舊判斷：FB 0%（或 4%）< 整體 15% → 會報失衡。"""
    seed_june_baseline(db, source="親友介紹")
    august = date(2026, 8, 1)
    for day in range(1, 7):
        deposited_after(db, visit_date=august, days=day, source="親友介紹")
    for _ in range(9):
        add_visit(db, visit_date=august, source="親友介紹")
    for index in range(25):
        if index < fb_deposits:
            deposited_after(db, visit_date=fb_visit_date, days=1, source="FB 廣告")
        else:
            add_visit(db, visit_date=fb_visit_date, source="FB 廣告")


async def test_source_imbalance_not_raised_for_new_source(db_session):
    # FB 廣告 09-30 才參觀（1 天）：依親友介紹的速度預期約 1.1 筆，實際 0 → 少不到 2 筆，不報。
    seed_source_scenario(db_session, fb_visit_date=date(2026, 9, 30), fb_deposits=0)
    await db_session.commit()

    result = await query(db_session)

    assert "SOURCE_IMBALANCE" not in [alert["code"] for alert in result["alerts"]]
    assert "REVIEW_SOURCE" not in [action["code"] for action in result["top_action_queue"]]


async def test_source_imbalance_raised_when_source_is_slow(db_session):
    # FB 廣告 09-01 參觀（30 天）：親友介紹第 30 天累積 40% → 預期 10.0 筆，實際 1 筆 → 報。
    seed_source_scenario(db_session, fb_visit_date=date(2026, 9, 1), fb_deposits=1)
    await db_session.commit()

    result = await query(db_session)

    imbalance = next(alert for alert in result["alerts"] if alert["code"] == "SOURCE_IMBALANCE")
    assert imbalance == {
        "code": "SOURCE_IMBALANCE", "level": "info", "title": "來源結構失衡",
        "message": "FB 廣告 近 90 天占比 62.5%，依其他來源的預繳速度應有約 10.0 筆預繳，實際 1 筆。",
        "target_tab": "source", "target_filter": {"source": "FB 廣告"},
    }
    review = next(action for action in result["top_action_queue"] if action["code"] == "REVIEW_SOURCE")
    assert review["description"] == "FB 廣告 近 90 天占比 62.5%，預繳比其他來源慢，先看這個來源的後續追蹤。"


async def test_stats_rows_have_ranges(db_session):
    seed_june_baseline(db_session, source="親友介紹")
    await db_session.commit()

    result = await query(db_session)

    # 全體 12/30 → prior (12+1)/(30+2)；只有一個來源，那一列的範圍就是 rate_range(12, 30, 13/32)。
    from app.admissions import estimation
    expected = estimation.rate_range(12, 30, 13 / 32)
    assert result["by_source"][0]["visit_to_deposit_range"] == expected
    assert result["by_grade"][0]["visit_to_deposit_range"] == expected
    assert result["by_tour_guide"][0]["visit_to_deposit_range"] == expected
```

- [ ] **Step 2：跑測試確認失敗**

Run: `cd backend && WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pace1012_test uv run pytest -q tests/test_admissions_deposit_pace.py`
Expected: 新加的 7 個 FAIL（`KeyError: 'deposit_pace'` 或警示內容不符）；Task 2 的測試仍 passed。

- [ ] **Step 3：改 `stats.py`**

3a. 開頭 docstring 的「刻意與園務不同」清單最後加三行：

```text
- 「本月漏斗轉換下滑」改判斷（2026-10-12，契約第 19 點）：不再比月比的百分點，改看本月家長依過去的預繳速度
  到今天應有幾筆預繳（deposit_pace.py）；也不再比參觀轉註冊。標題改「本月預繳比過去慢」。
- 「來源結構失衡」改判斷（同上）：占比 ≥ 40% 不變，改拿這個來源和其他來源比預繳速度。
- 班別、來源、帶參觀老師每列加可能範圍 visit_to_deposit_range（estimation.rate_range）；回應多 deposit_timing、deposit_pace。
```

3b. import 與常數：

```python
from app.admissions import deposit_pace, estimation, intake
```

刪掉常數 `FUNNEL_DROP_THRESHOLD = 10.0`（全檔不再使用；`grep -n FUNNEL_DROP_THRESHOLD` 應為 0 筆）。

3c. 新增 helper（放在 `_by_grade` 前面）：

```python
def _with_range(rows: list[dict[str, Any]], prior: float | None) -> list[dict[str, Any]]:
    """各列加可能範圍（2026-10-12 規格 §7）：預繳數、參觀數照列上的值，全體由呼叫端給。"""
    return [{**row, "visit_to_deposit_range": estimation.rate_range(row["deposit"], row["visit"], prior)} for row in rows]
```

3d. 整個 `async def _find_source_imbalance(...)` 換成：

```python
def _find_source_imbalance(
    visits: list[deposit_pace.PaceVisit], window_start: datetime, today: date
) -> dict[str, Any] | None:
    """近 90 天（created_at）占比 >= 40% 的來源，預繳速度明顯比其他來源慢才算失衡（2026-10-12 規格 §6.3）。
    占比照園務 shared.py:494-534 算；比較組是母體內其他來源的全部訪視（不限 90 天）。
    兩個都失衡取占比高的，同占比取標籤升序第一個。"""
    window = [visit for visit in visits if visit.created_at >= window_start]
    if not window:
        return None
    groups: dict[str, list[deposit_pace.PaceVisit]] = {}
    for visit in window:
        groups.setdefault(_label(visit.source, UNFILLED), []).append(visit)
    candidate: dict[str, Any] | None = None
    for source in sorted(groups):
        share = round(len(groups[source]) / len(window) * 100, 1)
        if share < SOURCE_IMBALANCE_SHARE_THRESHOLD:
            continue
        others = [visit for visit in visits if _label(visit.source, UNFILLED) != source]
        result = deposit_pace.pace_check(groups[source], others, today)
        if result.slow and (candidate is None or share > candidate["share"]):
            candidate = {"source": source, "share": share, "expected": result.expected, "observed": result.observed}
    return candidate


def _funnel_pace(
    visits: list[deposit_pace.PaceVisit], reference_month: str | None, today: date
) -> dict[str, Any]:
    """參考月份參觀的家長 vs 其他月份的預繳速度（2026-10-12 規格 §6.2、§6.4）。"""
    if reference_month is None:
        result = deposit_pace.PaceResult(
            evaluable=False, reason="no_reference_month", visits=0, expected=None, observed=0, slow=False,
        )
        return deposit_pace.pace_dict(result, None)
    in_month = [visit for visit in visits if (_safe_normalize(visit.month) or visit.month) == reference_month]
    others = [visit for visit in visits if (_safe_normalize(visit.month) or visit.month) != reference_month]
    return deposit_pace.pace_dict(deposit_pace.pace_check(in_month, others, today), reference_month)
```

3e. 整個 `_alerts` 換成：

```python
def _alerts(
    funnel_pace: dict[str, Any], backlog: int, imbalance: dict[str, Any] | None, reference_month: str | None
) -> list[dict[str, Any]]:
    """園務 shared.py:377-439；FUNNEL_DROP 與 SOURCE_IMBALANCE 的判斷與文案 2026-10-12 起改看預繳速度（契約第 19 點），
    HIGH_POTENTIAL_BACKLOG 照抄園務。"""
    alerts: list[dict[str, Any]] = []
    if funnel_pace["slow"] and reference_month:
        alerts.append({
            "code": "FUNNEL_DROP",
            "level": "warning",
            "title": "本月預繳比過去慢",
            "message": (
                f"{reference_month} 參觀的 {funnel_pace['visits']} 位家長，依過去的預繳速度到今天應有約 "
                f"{funnel_pace['expected']:.1f} 筆預繳，實際 {funnel_pace['observed']} 筆。"
            ),
            "target_tab": "records",
            "target_filter": {"month": reference_month},
        })
    if backlog >= HIGH_POTENTIAL_BACKLOG_THRESHOLD:
        alerts.append({
            "code": "HIGH_POTENTIAL_BACKLOG",
            "level": "danger",
            "title": "高潛力未預繳名單堆積",
            "message": f"參觀超過 {DEFAULT_OVERDUE_DAYS} 天仍未預繳的高潛力名單有 {backlog} 筆。",
            "target_tab": "nodeposit",
            "target_filter": {"priority": "high", "overdue_days": DEFAULT_OVERDUE_DAYS},
        })
    if imbalance:
        alerts.append({
            "code": "SOURCE_IMBALANCE",
            "level": "info",
            "title": "來源結構失衡",
            "message": (
                f"{imbalance['source']} 近 90 天占比 {imbalance['share']:.1f}%，依其他來源的預繳速度應有約 "
                f"{imbalance['expected']:.1f} 筆預繳，實際 {imbalance['observed']} 筆。"
            ),
            "target_tab": "source",
            "target_filter": {"source": imbalance["source"]},
        })
    return alerts
```

3f. `_action_queue` 裡 `REVIEW_SOURCE` 的 description 換成：

```python
            "description": f"{imbalance['source']} 近 90 天占比 {imbalance['share']:.1f}%，預繳比其他來源慢，先看這個來源的後續追蹤。",
```

3g. `query_stats`：在 `filters = _base_filters(...)` 之後加

```python
    today = today_local(now)
    pace_visits = await deposit_pace.load_visits(db, filters)
```

在 `kpi = await _aggregate(db, filters)` 之後加

```python
    prior = estimation.prior_rate(kpi["deposit"], kpi["visit"])
```

把

```python
    by_source = _by_source(await _grouped(db, filters, v.source))
```

改成

```python
    by_source = _with_range(_by_source(await _grouped(db, filters, v.source)), prior)
```

把

```python
    imbalance = await _find_source_imbalance(db, filters, now - timedelta(days=ROLLING_LONG_DAYS))
```

改成

```python
    imbalance = _find_source_imbalance(pace_visits, now - timedelta(days=ROLLING_LONG_DAYS), today)
    funnel_pace = _funnel_pace(pace_visits, resolved_month, today)
```

回傳 dict 中：

```python
        "alerts": _alerts(funnel_pace, backlog, imbalance, resolved_month),
```

```python
        "by_grade": _with_range(_by_grade(await _grouped(db, filters, v.grade)), prior),
```

```python
        "by_tour_guide": _with_range(_by_tour_guide(await _grouped(db, filters, v.tour_guide_name, v.grade)), prior),
```

並在 `"no_deposit_summary": summary,` 之後加

```python
        "deposit_timing": deposit_pace.deposit_timing(pace_visits, today),
        "deposit_pace": funnel_pace,
```

- [ ] **Step 4：改 `schemas.py`**

在 `class AdmissionsGradeRow` 前面加：

```python
class AdmissionsRateRange(BaseModel):
    # 可能範圍（2026-10-12 規格 §7）：預繳率的 Beta 收縮 80% 範圍，百分比到小數一位。
    low: float
    high: float
```

`AdmissionsGradeRow`、`AdmissionsSourceRow`、`AdmissionsTourGuideRow` 各在 `visit_to_deposit_rate` 下一行加：

```python
    visit_to_deposit_range: AdmissionsRateRange | None
```

在 `class AdmissionsStatsFilters` 前面加：

```python
class AdmissionsTimingCheckpoint(BaseModel):
    day: int
    # 參觀後第 day 天的累積預繳率（%）；沒有人參觀滿 day 天時是 None。
    cumulative_rate: float | None
    visits_reached: int


class AdmissionsDepositTiming(BaseModel):
    """預繳速度卡（2026-10-12 規格 §5、§9.1）。預繳不到 min_events 筆時 status＝insufficient、checkpoints 是空的。"""

    status: Literal["ok", "insufficient"]
    visits: int
    deposited: int
    missing_time: int
    min_events: int
    checkpoints: list[AdmissionsTimingCheckpoint]
    half_by_day: int | None


class AdmissionsDepositPace(BaseModel):
    """參考月份家長的預繳速度比較（規格 §6.2、§6.4）；slow＝true 時另有 FUNNEL_DROP 警示。"""

    evaluable: bool
    reason: Literal["no_reference_month", "no_visits", "insufficient_baseline"] | None
    month: str | None
    visits: int
    expected: float | None
    observed: int
    slow: bool
```

`AdmissionsStatsOut` 最後加：

```python
    deposit_timing: AdmissionsDepositTiming
    deposit_pace: AdmissionsDepositPace
```

- [ ] **Step 5：改既有 `test_admissions_stats.py` 斷言**

5a. `test_stats_matches_ivy_semantics`：三個維度表的期望值加範圍（全體 5/9 → prior 6/11，數值已離線算好）：

```python
    assert result["by_grade"] == [
        {"grade": "小班", "visit": 5, "deposit": 3, "enrolled": 1,
         "visit_to_deposit_rate": 60.0, "visit_to_enrolled_rate": 20.0, "deposit_to_enrolled_rate": 33.3,
         "visit_to_deposit_range": {"low": 40.0, "high": 72.4}},
        {"grade": "中班", "visit": 2, "deposit": 2, "enrolled": 1,
         "visit_to_deposit_rate": 100.0, "visit_to_enrolled_rate": 50.0, "deposit_to_enrolled_rate": 50.0,
         "visit_to_deposit_range": {"low": 44.0, "high": 79.3}},
        {"grade": "幼幼班", "visit": 1, "deposit": 0, "enrolled": 0,
         "visit_to_deposit_rate": 0.0, "visit_to_enrolled_rate": 0.0, "deposit_to_enrolled_rate": None,
         "visit_to_deposit_range": {"low": 30.6, "high": 68.6}},
        {"grade": "未填寫", "visit": 1, "deposit": 0, "enrolled": 0,
         "visit_to_deposit_rate": 0.0, "visit_to_enrolled_rate": 0.0, "deposit_to_enrolled_rate": None,
         "visit_to_deposit_range": {"low": 30.6, "high": 68.6}},
    ]
```

```python
    assert result["by_source"] == [
        {"source": "Facebook", "visit": 5, "deposit": 4, "visit_to_deposit_rate": 80.0,
         "visit_to_deposit_range": {"low": 46.9, "high": 78.4}},
        {"source": "親友介紹", "visit": 2, "deposit": 1, "visit_to_deposit_rate": 50.0,
         "visit_to_deposit_range": {"low": 35.5, "high": 71.8}},
        {"source": "Google 評論", "visit": 1, "deposit": 0, "visit_to_deposit_rate": 0.0,
         "visit_to_deposit_range": {"low": 30.6, "high": 68.6}},
        {"source": "未填寫", "visit": 1, "deposit": 0, "visit_to_deposit_rate": 0.0,
         "visit_to_deposit_range": {"low": 30.6, "high": 68.6}},
    ]
```

```python
    assert result["by_tour_guide"] == [
        {"tour_guide": "林老師", "visit": 5, "deposit": 3, "visit_to_deposit_rate": 60.0,
         "visit_to_deposit_range": {"low": 40.0, "high": 72.4},
         "by_grade": {"小班": {"visit": 5, "deposit": 3}}},
        {"tour_guide": "張老師", "visit": 3, "deposit": 2, "visit_to_deposit_rate": 66.7,
         "visit_to_deposit_range": {"low": 39.7, "high": 74.4},
         "by_grade": {"中班": {"visit": 2, "deposit": 2}, "幼幼班": {"visit": 1, "deposit": 0}}},
        {"tour_guide": "未填寫", "visit": 1, "deposit": 0, "visit_to_deposit_rate": 0.0,
         "visit_to_deposit_range": {"low": 30.6, "high": 68.6},
         "by_grade": {"未填寫": {"visit": 1, "deposit": 0}}},
    ]
```

警示段落（原本期望 FUNNEL_DROP）改成：

```python
    # 警示：R10 的訪視都是直接寫資料庫、沒有 deposit_added 事件 → 預繳過的 6 筆（V1 V2 V3 V7 V9＋退出的 V8）
    # 都沒有預繳時間，比較組沒有預繳 → 不判斷預繳速度（2026-10-12 起不再看月比百分點）；
    # 高潛力積壓 2 < 5 不警示；來源失衡同理不判斷。
    assert result["alerts"] == []
    assert result["deposit_pace"] == {
        "evaluable": False, "reason": "insufficient_baseline", "month": "115.09", "visits": 3, "expected": None,
        "observed": 0, "slow": False,
    }
    assert result["deposit_timing"] == {
        "status": "insufficient", "visits": 3, "deposited": 0, "missing_time": 6, "min_events": 10,
        "checkpoints": [], "half_by_day": None,
    }
```

（`top_action_queue` 的期望不變。）

5b. `test_alert_thresholds_and_source_imbalance` 改名為 `test_high_potential_backlog_alert`，只保留積壓：拿掉函式開頭註解中「親友介紹…」與失衡的說明、保留造資料，斷言改成：

```python
    result = await stats.query_stats(db_session, "minghua", school_year=None, semester=None, reference_month=None, now=NOW)

    # 積壓 4＋1＝5 >= 5 → 警示。來源失衡與漏斗下滑都要看預繳速度（2026-10-12），這裡的預繳沒有事件 → 不判斷，
    # 失衡與漏斗的情境在 test_admissions_deposit_pace.py。
    assert result["alerts"] == [
        {
            "code": "HIGH_POTENTIAL_BACKLOG", "level": "danger", "title": "高潛力未預繳名單堆積",
            "message": "參觀超過 14 天仍未預繳的高潛力名單有 5 筆。",
            "target_tab": "nodeposit", "target_filter": {"priority": "high", "overdue_days": 14},
        },
    ]
    assert [action["code"] for action in result["top_action_queue"]] == ["FOLLOW_HIGH_POTENTIAL", "REVIEW_CURRENT_MONTH"]

    # 早一天算（台北 09-30）：09-17 參觀那筆變成「還沒逾期」→ 積壓 4 < 5，不警示；行動入口只要 > 0 就列。
    earlier = await stats.query_stats(
        db_session, "minghua", school_year=None, semester=None, reference_month=None, now=NOW - timedelta(days=1)
    )
    assert earlier["alerts"] == []
    assert earlier["top_action_queue"][0]["description"] == "目前有 4 筆高潛力名單逾期未追。"
```

5c. 刪掉整個 `test_funnel_drop_alert_at_exact_threshold`（判斷已改，新情境在 Task 3 Step 1）。

5d. `test_reference_month_previous_month_and_ytd_cross_year` 裡的註解「1/2＝50.0 對 1/1＝100.0 → －50.0，觸發漏斗下滑。」改成「1/2＝50.0 對 1/1＝100.0 → －50.0（月比照算；漏斗警示 2026-10-12 起改看預繳速度）。」

5e. `test_stats_empty_campus` 在 `assert result["no_deposit_summary"] == ...` 之後加：

```python
    assert result["deposit_timing"] == {
        "status": "insufficient", "visits": 0, "deposited": 0, "missing_time": 0, "min_events": 10,
        "checkpoints": [], "half_by_day": None,
    }
    assert result["deposit_pace"] == {
        "evaluable": False, "reason": "no_reference_month", "month": None, "visits": 0, "expected": None,
        "observed": 0, "slow": False,
    }
```

- [ ] **Step 6：跑測試確認通過**

Run: `cd backend && WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pace1012_test uv run pytest -q tests/test_admissions_deposit_pace.py tests/test_admissions_stats.py tests/test_admissions_estimation.py`
Expected: 全部 passed。

- [ ] **Step 7：重產契約並確認**

```bash
cd ~/Repositories/ivy-website-wt/admissions-deposit-pace-20261012
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm run contract:generate; npm run contract:check
git diff --stat contracts/
```

Expected: `contract:check` 成功；`contracts/openapi.json` 與 `website-api.d.ts` 出現 `AdmissionsRateRange`、`AdmissionsDepositTiming`、`AdmissionsDepositPace`。

- [ ] **Step 8：admin typecheck 會因必填新欄位紅——這是預期的，Task 5、6 會補範本。** 本任務只確認後端：

Run: `cd backend && WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pace1012_test uv run pytest -q tests/test_admissions_booking_link.py tests/test_admissions_funnel.py`
Expected: passed（確認沒有連帶壞掉的招生測試）。

- [ ] **Step 9：Commit**

```bash
git add backend/app/admissions/stats.py backend/app/admissions/schemas.py backend/tests/test_admissions_deposit_pace.py backend/tests/test_admissions_stats.py contracts/openapi.json contracts/generated/website-api.d.ts
git commit -m "feat(admissions): 統計警示改看預繳速度，班別／來源／接待加可能範圍"
```

---

### Task 4：`/area` 與 `/compare` 加可能範圍

**Files:**
- Modify: `backend/app/admissions/area.py`（import、`_row`、`query_area`）
- Modify: `backend/app/admissions/stats.py`（`compare`）
- Modify: `backend/app/admissions/schemas.py`（`AdmissionsCompareRow`、`AreaDistrictRowOut`、`AreaVillageRowOut`、`AreaDistanceBandOut`）
- Modify: `contracts/openapi.json`、`contracts/generated/website-api.d.ts`（產生）
- Test: `backend/tests/test_admissions_area.py`、`backend/tests/test_admissions_stats.py`

**Interfaces:**
- Consumes：Task 1 `estimation.prior_rate`、`estimation.rate_range`；Task 3 `schemas.AdmissionsRateRange`。
- Produces：`/area` 的 `districts[]`／`villages[]`／`distance_bands[]` 與 `/compare` 的 `rows[]` 每列 `visit_to_deposit_range`。

- [ ] **Step 1：改測試成期望新欄位（先紅）**

`test_admissions_area.py::test_area_levels_rows_and_bands`（全體＝距離帶相加 11 筆、預繳 2 → prior 3/13）：

```python
    assert body["districts"] == [
        {"district": "三民區", "visit": 5, "deposit": 2, "visit_to_deposit_rate": 40.0,
         "visit_to_deposit_range": {"low": 14.7, "high": 44.1}},
        {"district": "左營區", "visit": 1, "deposit": 0, "visit_to_deposit_rate": 0.0,
         "visit_to_deposit_range": {"low": 7.2, "high": 37.3}},
    ]
```

```python
    assert [row["visit_to_deposit_range"] for row in body["villages"]] == [
        {"low": 12.4, "high": 44.5}, {"low": 13.7, "high": 48.2},
    ]
```

（加在 `villages` 那段斷言之後。）

```python
    assert body["distance_bands"] == [
        {"band": "0-1", "visit": 1, "deposit": 1, "visit_to_deposit_rate": 100.0,
         "visit_to_deposit_range": {"low": 13.7, "high": 48.2}},
        {"band": "1-3", "visit": 1, "deposit": 0, "visit_to_deposit_rate": 0.0,
         "visit_to_deposit_range": {"low": 7.2, "high": 37.3}},
        {"band": "3-6", "visit": 0, "deposit": 0, "visit_to_deposit_rate": None, "visit_to_deposit_range": None},
        {"band": "6+", "visit": 0, "deposit": 0, "visit_to_deposit_rate": None, "visit_to_deposit_range": None},
        {"band": "none", "visit": 9, "deposit": 1, "visit_to_deposit_rate": 11.1,
         "visit_to_deposit_range": {"low": 7.4, "high": 29.0}},
    ]
```

`test_admissions_stats.py::test_compare_rows_and_seats` 的 `rows[0]` 期望加（三校合計 3/5 → prior 4/7）：

```python
        "visit_to_deposit_range": {"low": 45.5, "high": 78.2},
```

`test_compare_without_targets` 的 `rows[0]`（明華 0/1、仁武 0/0 → prior 1/3；Review Focus 3：不是 0–0%）加：

```python
        "visit_to_deposit_range": {"low": 13.9, "high": 48.5},
```

並在該測試最後加：

```python
    assert rows[1]["visit_to_deposit_range"] is None
```

再在 `test_admissions_stats.py` 加一個五校全體都沒預繳的情境：

```python
async def test_compare_ranges(db_session):
    """Review Focus 3：五校合計 0 筆預繳時，各校範圍不是 0–0%。"""
    add_visit(db_session, campus_key="minghua", grade="中班")
    add_visit(db_session, campus_key="renwu", grade="小班")
    add_visit(db_session, campus_key="renwu", grade="小班")
    await db_session.commit()

    rows = (await stats.compare(db_session, ["minghua", "renwu"], school_year=115, semester=1, now=NOW))["rows"]

    # 合計 0/3 → prior 1/5；0/1 與 0/2 的範圍下限 0 附近、上限 > 0。
    assert rows[0]["visit_to_deposit_range"]["high"] > 0
    assert rows[1]["visit_to_deposit_range"]["high"] > 0
    assert rows[1]["visit_to_deposit_range"]["high"] < rows[0]["visit_to_deposit_range"]["high"]
```

Run: `cd backend && WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pace1012_test uv run pytest -q tests/test_admissions_area.py tests/test_admissions_stats.py -k "area_levels or compare"`
Expected: FAIL（缺 `visit_to_deposit_range`）。

- [ ] **Step 2：實作 `area.py`**

import 區加 `from app.admissions import estimation`（和既有 `from app.admissions...` 放一起）。

`_row` 換成：

```python
def _row(bucket: dict[str, int], prior: float | None, **labels: Any) -> dict[str, Any]:
    return {
        **labels,
        "visit": bucket["visit"],
        "deposit": bucket["deposit"],
        "visit_to_deposit_rate": pct(bucket["deposit"], bucket["visit"]),
        # 可能範圍（2026-10-12 規格 §7）：全體＝距離帶相加（每筆訪視恰好落在一個距離帶）。
        "visit_to_deposit_range": estimation.rate_range(bucket["deposit"], bucket["visit"], prior),
    }
```

`query_area` 在 `with_address = ...` 那行之前加：

```python
    prior = estimation.prior_rate(
        sum(bucket["deposit"] for bucket in bands.values()), sum(bucket["visit"] for bucket in bands.values())
    )
```

回傳的三個 `_row(...)` 呼叫各加第二個位置參數 `prior`：

```python
            _row(bucket, prior, district=name)
```

```python
            _row(bucket, prior, district=district, village=village, village_code=boundaries.village_code(district, village))
```

```python
        "distance_bands": [_row(bands[band], prior, band=band) for band in DISTANCE_BANDS],
```

確認 `grep -n "_row(" backend/app/admissions/area.py` 只剩這三處與定義。

- [ ] **Step 3：實作 `stats.compare`**

在 `counts_by_campus = ...` 之後加：

```python
    # 可能範圍的全體＝這次回傳的各校相加（2026-10-12 規格 §7.2）。
    pooled = estimation.prior_rate(
        sum(counts_by_campus.get(key, {}).get("deposit", 0) for key in campus_keys),
        sum(counts_by_campus.get(key, {}).get("visit", 0) for key in campus_keys),
    )
```

`result.append({...})` 中 `"visit_to_deposit_rate": _rate(...)` 下一行加：

```python
            "visit_to_deposit_range": estimation.rate_range(c["deposit"], c["visit"], pooled),
```

- [ ] **Step 4：schema**

`AdmissionsCompareRow` 在 `visit_to_deposit_rate: AdmissionsRate` 下一行加：

```python
    # 只有參觀→預繳有可能範圍（2026-10-12 規格 §9.3）。
    visit_to_deposit_range: AdmissionsRateRange | None
```

`AreaDistrictRowOut`、`AreaVillageRowOut`、`AreaDistanceBandOut` 在 `visit_to_deposit_rate` 下一行各加：

```python
    visit_to_deposit_range: AdmissionsRateRange | None
```

- [ ] **Step 5：跑測試**

Run: `cd backend && WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pace1012_test uv run pytest -q tests/test_admissions_area.py tests/test_admissions_stats.py tests/test_admissions_deposit_pace.py`
Expected: 全部 passed。

- [ ] **Step 6：重產契約**

```bash
cd ~/Repositories/ivy-website-wt/admissions-deposit-pace-20261012
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm run contract:generate; npm run contract:check
```

Expected: `contract:check` 成功。

- [ ] **Step 7：Commit**

```bash
git add backend/app/admissions/area.py backend/app/admissions/stats.py backend/app/admissions/schemas.py backend/tests/test_admissions_area.py backend/tests/test_admissions_stats.py contracts/openapi.json contracts/generated/website-api.d.ts
git commit -m "feat(admissions): 區域分析與五校比較的預繳率加可能範圍"
```

---

### Task 5：後台共用統計表支援「可能範圍」欄

**Files:**
- Modify: `admin/src/admissions/statsFormat.ts`
- Modify: `admin/src/components/admissions/StatsDimensionTable.vue`
- Modify: `admin/src/api/types.ts`
- Test: `admin/src/__tests__/statsFormat.test.ts`、`admin/src/__tests__/statsDimensionCsv.test.ts`

**Interfaces:**
- Consumes：Task 3、4 產生的 `components['schemas']['AdmissionsRateRange' | 'AdmissionsDepositTiming' | 'AdmissionsDepositPace']`。
- Produces：
  - `statsFormat.ts`：`StatsColumn.kind` 多 `'range'`；`type RateRange = { low: number; high: number }`；`toRange(value: unknown): RateRange | null`；`formatRange(range: RateRange | null | undefined): string`（`29–64%`，null 寫 `—`）。
  - `types.ts`：`AdmissionsRateRange`、`AdmissionsDepositTiming`、`AdmissionsDepositPace` 型別別名。
  - `StatsDimensionTable`：`kind: 'range'` 欄畫面寫 `formatRange`、靠右；CSV 拆成「`{label}`下限」「`{label}`上限」兩欄（數字，沒有值寫空白）。

- [ ] **Step 1：寫失敗的測試**

`admin/src/__tests__/statsFormat.test.ts` 加：

```ts
import { formatRange, toRange } from '../admissions/statsFormat'

describe('可能範圍格式（2026-10-12）', () => {
  it('整數百分比、en dash；沒有值寫「—」', () => {
    expect(formatRange({ low: 28.8, high: 63.8 })).toBe('29–64%')
    expect(formatRange({ low: 0.4, high: 9.5 })).toBe('0–10%')
    expect(formatRange(null)).toBe('—')
    expect(formatRange(undefined)).toBe('—')
  })

  it('toRange 只認 {low, high} 數字物件', () => {
    expect(toRange({ low: 1, high: 2 })).toEqual({ low: 1, high: 2 })
    expect(toRange(null)).toBeNull()
    expect(toRange('29–64%')).toBeNull()
    expect(toRange({ low: '1', high: 2 })).toBeNull()
  })
})
```

（若檔案已有 `import { ... } from '../admissions/statsFormat'`，把兩個名稱併進既有 import。）

`admin/src/__tests__/statsDimensionCsv.test.ts` 加：

```ts
describe('StatsDimensionTable 可能範圍欄（2026-10-12）', () => {
  const props = {
    title: '來源排名明細',
    rows: [
      { source: 'Facebook', visit: 5, rate: 80, range: { low: 46.9, high: 78.4 } },
      { source: '未填寫', visit: 0, rate: null, range: null },
    ],
    columns: [
      { key: 'source', label: '來源', sticky: true },
      { key: 'visit', label: '參觀', kind: 'bar' as const },
      { key: 'rate', label: '預繳率', kind: 'rate' as const },
      { key: 'range', label: '可能範圍', kind: 'range' as const },
    ],
    rowKey: 'source',
    emptyText: '尚無資料',
    exportFilename: 'x.csv',
  }

  it('畫面寫整數範圍、靠右；沒有值寫「—」', () => {
    const wrapper = mount(StatsDimensionTable, { props, global: { plugins: [ElementPlus] } })
    const cells = wrapper.findAll('tbody tr').map((tr) => tr.findAll('th, td').map((cell) => cell.text()))
    expect(cells).toEqual([['Facebook', '5', '80.0%', '47–78%'], ['未填寫', '0', '—', '—']])
    expect(wrapper.findAll('thead th').map((th) => th.text())).toEqual(['來源', '參觀', '預繳率', '可能範圍'])
    expect(wrapper.findAll('tbody tr')[0]!.findAll('td').at(-1)!.classes()).toContain('stats-table__number')
    wrapper.unmount()
  })

  it('CSV 拆成下限、上限兩欄，數字寫小數一位，沒有值寫空白', async () => {
    const wrapper = mount(StatsDimensionTable, { props, global: { plugins: [ElementPlus] } })
    await wrapper.get('[data-test="stats-csv"]').trigger('click')
    const [, csv] = vi.mocked(downloadCsv).mock.calls.at(-1)!
    expect(csv.split('\r\n').slice(0, 3)).toEqual([
      '﻿來源,參觀,預繳率,可能範圍下限,可能範圍上限',
      'Facebook,5,80.0%,46.9,78.4',
      '未填寫,0,,,',
    ])
    wrapper.unmount()
  })
})
```

Run: `cd admin && source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npx vitest run src/__tests__/statsFormat.test.ts src/__tests__/statsDimensionCsv.test.ts`
Expected: FAIL（`formatRange` 不存在、`kind: 'range'` 型別錯／顯示不對）。

- [ ] **Step 2：實作 `statsFormat.ts`**

`StatsColumn.kind` 改成：

```ts
  /** text：原文；count：整數；rate：百分比（null 寫「—」）；bar：整數＋CSS 長條；range：可能範圍「29–64%」（2026-10-12），CSV 拆下限、上限兩欄。 */
  kind?: 'text' | 'count' | 'rate' | 'bar' | 'range'
```

在 `formatRate` 之後加：

```ts
export type RateRange = { low: number; high: number }

/** 後端的 visit_to_deposit_range：{low, high}（百分比、小數一位）或 null。 */
export function toRange(value: unknown): RateRange | null {
  if (value === null || typeof value !== 'object') return null
  const { low, high } = value as Record<string, unknown>
  return typeof low === 'number' && typeof high === 'number' ? { low, high } : null
}

/** 可能範圍（2026-10-12 規格 §10.2）：畫面寫整數「29–64%」，小數只會讓人以為很精確；沒有值寫「—」。 */
export function formatRange(range: RateRange | null | undefined): string {
  return range ? `${Math.round(range.low)}–${Math.round(range.high)}%` : NO_VALUE
}
```

- [ ] **Step 3：實作 `StatsDimensionTable.vue`**

import 改成：

```ts
import { NO_VALUE, barWidth, formatRange, formatRate, rateCsvCell, toRange, type StatsColumn } from '../../admissions/statsFormat'
```

`display()` 第一行之後加：

```ts
  if (column.kind === 'range') return formatRange(toRange(value))
```

`isNumeric` 改成：

```ts
const isNumeric = (column: StatsColumn) =>
  column.kind === 'count' || column.kind === 'rate' || column.kind === 'bar' || column.kind === 'range'
```

`exportCsv` 換成（range 欄拆兩欄；`csvCell` 覆寫只用在非 range 欄）：

```ts
// 可能範圍欄（2026-10-12）匯出成「下限」「上限」兩個數字欄，Excel 才能排序、算平均；沒有值寫空白。
function csvHeaders(column: StatsColumn): string[] {
  return column.kind === 'range' ? [`${column.label}下限`, `${column.label}上限`] : [column.label]
}

function csvValues(row: Record<string, unknown>, column: StatsColumn): CsvCell[] {
  if (column.kind !== 'range') return [csvValue(row, column)]
  const range = toRange(row[column.key])
  return range ? [range.low, range.high] : ['', '']
}

function exportCsv() {
  if (!props.exportFilename) return
  const header = [...(props.numbered ? ['#'] : []), ...props.columns.flatMap(csvHeaders)]
  const rows = props.rows.map((row, index) => [
    ...(props.numbered ? [index + 1] : []),
    ...props.columns.flatMap((column) => csvValues(row, column)),
  ])
  try {
    downloadCsv(props.exportFilename, buildCsv(header, rows))
  } catch {
    notifyError('匯出失敗，請再試一次。')
  }
}
```

並把檔案開頭註解「匯出（2026-10-03）…」那段最後補一句「可能範圍欄拆成下限、上限兩欄（2026-10-12）。」

- [ ] **Step 4：`types.ts` 加型別別名**（放在 `export type AdmissionsStats = ...` 下一行）

```ts
// 預繳速度與可能範圍（2026-10-12 規格 §9）。
export type AdmissionsRateRange = components['schemas']['AdmissionsRateRange']
export type AdmissionsDepositTiming = components['schemas']['AdmissionsDepositTiming']
export type AdmissionsDepositPace = components['schemas']['AdmissionsDepositPace']
```

- [ ] **Step 5：跑測試**

Run: `cd admin && source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npx vitest run src/__tests__/statsFormat.test.ts src/__tests__/statsDimensionCsv.test.ts`
Expected: passed。（整體 typecheck 要到 Task 6 補完範本才會綠。）

- [ ] **Step 6：Commit**

```bash
git add admin/src/admissions/statsFormat.ts admin/src/components/admissions/StatsDimensionTable.vue admin/src/api/types.ts admin/src/__tests__/statsFormat.test.ts admin/src/__tests__/statsDimensionCsv.test.ts
git commit -m "feat(admin): 招生統計表支援可能範圍欄，CSV 拆下限上限"
```

---

### Task 6：各統計表加「可能範圍」欄與說明，補測試範本

**Files:**
- Modify: `admin/src/components/admissions/StatsTab.vue`（`GRADE_COLUMNS`、`SOURCE_COLUMNS`、`STAFF_COLUMNS`、`stats-toolbar` 模板）
- Modify: `admin/src/components/admissions/area/AreaTab.vue`（`placeColumns`、`DISTANCE_COLUMNS`）
- Modify: `admin/src/components/admissions/CompareTable.vue`（`COLUMNS`、`tableRows`）
- Test: `admin/src/__tests__/statsTab.test.ts`、`admin/src/__tests__/compareTable.test.ts`、`admin/src/__tests__/areaTab.test.ts`、`admin/src/__tests__/admissionsTestKit.ts`

**Interfaces:**
- Consumes：Task 5 的 `kind: 'range'`、`AdmissionsDepositTiming`／`AdmissionsDepositPace` 型別；`components/analytics/AnalyticsExplainer.vue`（既有，props `summary?: string`，預設 slot 是內文）。
- Produces：班別、來源、接待、行政區、里、距離、五校比較的表頭多「可能範圍」；統計分頁頂部的說明（`data-test="stats-explainer"`）。

- [ ] **Step 1：補測試範本（先讓 typecheck 知道新欄位）**

`statsTab.test.ts` 的 `stats()` 範本：
- `alerts` 改成新文案：

```ts
    alerts: [{
      code: 'FUNNEL_DROP', level: 'warning', title: '本月預繳比過去慢',
      message: '115.09 參觀的 15 位家長，依過去的預繳速度到今天應有約 6.0 筆預繳，實際 1 筆。', target_tab: 'records', target_filter: { month: '115.09' },
    }],
```

- `by_grade`、`by_source`、`by_tour_guide` 每列加 `visit_to_deposit_range`（值同後端 R10，Task 3 Step 5a）：

```ts
    by_grade: [
      { grade: '小班', visit: 5, deposit: 3, enrolled: 1, visit_to_deposit_rate: 60, visit_to_enrolled_rate: 20, deposit_to_enrolled_rate: 33.3, visit_to_deposit_range: { low: 40, high: 72.4 } },
      { grade: '中班', visit: 2, deposit: 2, enrolled: 1, visit_to_deposit_rate: 100, visit_to_enrolled_rate: 50, deposit_to_enrolled_rate: 50, visit_to_deposit_range: { low: 44, high: 79.3 } },
      { grade: '幼幼班', visit: 1, deposit: 0, enrolled: 0, visit_to_deposit_rate: 0, visit_to_enrolled_rate: 0, deposit_to_enrolled_rate: null, visit_to_deposit_range: { low: 30.6, high: 68.6 } },
      { grade: '未填寫', visit: 1, deposit: 0, enrolled: 0, visit_to_deposit_rate: 0, visit_to_enrolled_rate: 0, deposit_to_enrolled_rate: null, visit_to_deposit_range: { low: 30.6, high: 68.6 } },
    ],
```

```ts
    by_source: [
      { source: 'Facebook', visit: 5, deposit: 4, visit_to_deposit_rate: 80, visit_to_deposit_range: { low: 46.9, high: 78.4 } },
      { source: '親友介紹', visit: 2, deposit: 1, visit_to_deposit_rate: 50, visit_to_deposit_range: { low: 35.5, high: 71.8 } },
      { source: 'Google 評論', visit: 1, deposit: 0, visit_to_deposit_rate: 0, visit_to_deposit_range: { low: 30.6, high: 68.6 } },
      { source: '未填寫', visit: 1, deposit: 0, visit_to_deposit_rate: 0, visit_to_deposit_range: { low: 30.6, high: 68.6 } },
    ],
```

```ts
    by_tour_guide: [
      { tour_guide: '林老師', visit: 5, deposit: 3, visit_to_deposit_rate: 60, visit_to_deposit_range: { low: 40, high: 72.4 }, by_grade: { 小班: { visit: 5, deposit: 3 } } },
      { tour_guide: '張老師', visit: 3, deposit: 2, visit_to_deposit_rate: 66.7, visit_to_deposit_range: { low: 39.7, high: 74.4 },
        by_grade: { 中班: { visit: 2, deposit: 2 }, 幼幼班: { visit: 1, deposit: 0 } } },
      { tour_guide: '未填寫', visit: 1, deposit: 0, visit_to_deposit_rate: 0, visit_to_deposit_range: { low: 30.6, high: 68.6 }, by_grade: { 未填寫: { visit: 1, deposit: 0 } } },
    ],
```

- 範本最後（`...changes` 之前）加：

```ts
    deposit_timing: { status: 'insufficient', visits: 3, deposited: 0, missing_time: 6, min_events: 10, checkpoints: [], half_by_day: null },
    deposit_pace: { evaluable: false, reason: 'insufficient_baseline', month: '115.09', visits: 3, expected: null, observed: 0, slow: false },
```

`compareTable.test.ts`：`row()` 範本加 `visit_to_deposit_range: null,`（放在 `visit_to_deposit_rate: NO_RATE,` 後面）；`YIHUA`、`MINGHUA`、`CHONGDE` 各加（全體 6/8 → prior 0.7）：

```ts
  visit_to_deposit_range: { low: 55.6, high: 85.8 },   // YIHUA
  visit_to_deposit_range: { low: 44.8, high: 81.2 },   // MINGHUA
  visit_to_deposit_range: { low: 61.4, high: 90.4 },   // CHONGDE
```

`quietStats()` 若是型別化的 `AdmissionsStats`，照 `stats()` 補 `deposit_timing`、`deposit_pace`（同上兩行，`visits: 1, missing_time: 0, month: null, reason: 'no_reference_month'` 視其資料而定），各維度列加 `visit_to_deposit_range: null`。

`admissionsTestKit.ts` 的 `areaStats()`（全體 2/9 → prior 3/11）：

```ts
  districts: [
    { district: '三民區', visit: 5, deposit: 2, visit_to_deposit_rate: 40, visit_to_deposit_range: { low: 17, high: 47.2 } },
    { district: '鼓山區', visit: 1, deposit: 0, visit_to_deposit_rate: 0, visit_to_deposit_range: { low: 9.8, high: 42 } },
  ],
  villages: [
    { district: '三民區', village: '本揚里', village_code: '64000050015', visit: 3, deposit: 1, visit_to_deposit_rate: 33.3, visit_to_deposit_range: { low: 13.8, high: 45.1 } },
    { district: '三民區', village: '寶業里', village_code: '64000050025', visit: 1, deposit: 1, visit_to_deposit_rate: 100, visit_to_deposit_range: { low: 16.7, high: 52.5 } },
    { district: '鼓山區', village: '龍子里', village_code: null, visit: 1, deposit: 0, visit_to_deposit_rate: 0, visit_to_deposit_range: { low: 9.8, high: 42 } },
  ],
  distance_bands: [
    { band: '0-1', visit: 4, deposit: 2, visit_to_deposit_rate: 50, visit_to_deposit_range: { low: 18.4, high: 50.2 } },
    { band: '1-3', visit: 0, deposit: 0, visit_to_deposit_rate: null, visit_to_deposit_range: null },
    { band: '3-6', visit: 1, deposit: 0, visit_to_deposit_rate: 0, visit_to_deposit_range: { low: 9.8, high: 42 } },
    { band: '6+', visit: 0, deposit: 0, visit_to_deposit_rate: null, visit_to_deposit_range: null },
    { band: 'none', visit: 4, deposit: 0, visit_to_deposit_rate: 0, visit_to_deposit_range: { low: 7.5, high: 33.6 } },
  ],
```

Run: `cd admin && source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm run typecheck`
Expected: 0 錯誤（若還有別的測試檔建了 `AdmissionsStats`／`AdmissionsCompareRow` 物件而報缺欄位，照同樣方式補 `visit_to_deposit_range` 與兩個新區塊）。

- [ ] **Step 2：改表頭／列斷言成新欄位（先紅）**

`statsTab.test.ts`：

```ts
    expect(alert.text().replace(/\s+/g, '')).toBe('中本月預繳比過去慢115.09參觀的15位家長，依過去的預繳速度到今天應有約6.0筆預繳，實際1筆。')
```

```ts
    expect(headers(block(pane, '班別統計'))).toEqual(['班別', '參觀人數', '預繳人數', '預繳率', '可能範圍'])
    expect(bodyRows(block(pane, '班別統計'))).toEqual([
      ['小班', '5', '3', '60.0%', '40–72%'], ['中班', '2', '2', '100.0%', '44–79%'],
      ['幼幼班', '1', '0', '0.0%', '31–69%'], ['未填寫', '1', '0', '0.0%', '31–69%'],
    ])
```

```ts
    expect(headers(block(pane, '來源排名明細'))).toEqual(['#', '來源', '參觀人數', '預繳人數', '預繳率', '可能範圍'])
    expect(bodyRows(block(pane, '來源排名明細'))[0]).toEqual(['1', 'Facebook', '5', '4', '80.0%', '47–78%'])
```

```ts
    expect(bodyRows(block(pane, '接待人員統計'))[1]).toEqual(['張老師', '3', '2', '66.7%', '40–74%'])
```

再加一個測試：

```ts
  it('統計頂部有收起的說明：可能範圍與預繳速度怎麼看', async () => {
    mockGet({ '/admin/admissions/stats': stats(), [NO_DEPOSIT_PATH]: noDepositRecords })
    const { wrapper } = await mountWith(StatsTab, { props: props() })

    const explainer = wrapper.get('[data-test="stats-explainer"]')
    expect(explainer.element.tagName).toBe('DETAILS')
    expect(explainer.attributes('open')).toBeUndefined()
    expect(explainer.get('summary').text()).toBe('怎麼看可能範圍與預繳速度')
    expect(explainer.text()).toContain('3 筆裡 3 筆不代表比全校好')
  })
```

`areaTab.test.ts`：

```ts
    expect(block(wrapper, '行政區排行').findAll('thead th').map((th) => th.text())).toEqual(['#', '行政區', '參觀人數', '預繳人數', '預繳率', '可能範圍', '操作'])
    expect(bodyRows(block(wrapper, '行政區排行'))).toEqual([
      ['1', '三民區', '5', '2', '40.0%', '17–47%', '查看明細'],
      ['2', '鼓山區', '1', '0', '0.0%', '10–42%', '查看明細'],
    ])
    expect(bodyRows(block(wrapper, '里排行'))).toEqual([
      ['1', '三民區本揚里', '3', '1', '33.3%', '14–45%', '查看明細'],
      ['2', '三民區寶業里', '1', '1', '100.0%', '17–53%', '查看明細'],
      ['3', '鼓山區龍子里', '1', '0', '0.0%', '10–42%', '查看明細'],
    ])
    expect(block(wrapper, '距離分布').findAll('thead th').map((th) => th.text())).toEqual(['距本校', '參觀人數', '預繳人數', '預繳率', '可能範圍'])
    expect(bodyRows(block(wrapper, '距離分布'))).toEqual([
      ['1 公里內', '4', '2', '50.0%', '18–50%'],
      ['1–3 公里', '0', '0', '—', '—'],
      ['3–6 公里', '1', '0', '0.0%', '10–42%'],
      ['6 公里以上', '0', '0', '—', '—'],
      ['無距離', '4', '0', '0.0%', '8–34%'],
    ])
```

（`areaTab.test.ts:135` 的 `row[1]` 斷言不受影響。）

`compareTable.test.ts`：

```ts
    expect(headers(wrapper)).toEqual([
      '校區', '參觀', '預繳', '註冊', '有效預繳', '預繳未註冊',
      '參觀→預繳率', '可能範圍', '參觀→註冊率', '預繳→註冊率', '排除轉期→註冊率',
    ])
    expect(bodyRows(wrapper)).toEqual([
      ['義華', '4', '3', '1', '3', '2', '75.0%（3/4）', '56–86%', '25.0%（1/4）', '33.3%（1/3）', '33.3%（1/3）'],
      ['明華', '1', '0', '0', '0', '0', '0.0%（0/1）', '45–81%', '0.0%（0/1）', '—（0/0）', '—（0/0）'],
      ['崇德', '3', '3', '0', '3', '3', '100.0%（3/3）', '61–90%', '0.0%（0/3）', '0.0%（0/3）', '0.0%（0/3）'],
      ['仁武', '0', '0', '0', '0', '0', '—（0/0）', '—', '—（0/0）', '—（0/0）', '—（0/0）'],
    ])
```

`areaTab.test.ts` 的「匯出 CSV：檔名用頁面給的格式；不含「查看明細」欄」：

```ts
    expect(csv.slice(1).split('\r\n')[0]).toBe('#,行政區,參觀人數,預繳人數,預繳率,可能範圍下限,可能範圍上限')
```

`compareTable.test.ts` 的「匯出 CSV：檔名用比較結果的學年學期與台北日期…」：畫面表頭是「可能範圍」一欄、CSV 是兩欄，表頭不能再用 `headers(pane).join(',')`，改成明寫：

```ts
    expect(lines[0]).toBe('﻿校區,參觀,預繳,註冊,有效預繳,預繳未註冊,參觀→預繳率,可能範圍下限,可能範圍上限,參觀→註冊率,預繳→註冊率,排除轉期→註冊率')
    expect(lines[1]).toBe('義華,4,3,1,3,2,75.0%（3/4）,55.6,85.8,25.0%（1/4）,33.3%（1/3）,33.3%（1/3）')
    // 比率沒有值（分母 0）寫空白，不把畫面的「—（0/0）」寫進 CSV；有值的仍帶分子分母。範圍沒有值也是兩格空白。
    expect(lines[2]).toBe('明華,1,0,0,0,0,0.0%（0/1）,44.8,81.2,0.0%（0/1）,,')
    expect(lines[3]).toBe('仁武,0,0,0,0,0,,,,,,')
```

其他既有斷言若因新欄位失敗（表頭、列、CSV），照新欄位更新，並在回報列出改了哪幾條。

Run: `cd admin && source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npx vitest run src/__tests__/statsTab.test.ts src/__tests__/areaTab.test.ts src/__tests__/compareTable.test.ts`
Expected: FAIL（表頭還沒有「可能範圍」、沒有說明）。

- [ ] **Step 3：實作**

`StatsTab.vue` 三組欄位在 `visit_to_deposit_rate` 那行之後各加：

```ts
  { key: 'visit_to_deposit_range', label: '可能範圍', kind: 'range' },
```

`StatsTab.vue` import 區加：

```ts
import AnalyticsExplainer from '../analytics/AnalyticsExplainer.vue'
```

`stats-toolbar` 的 `<p class="hint stats-scope">…</p>` 之後加：

```vue
        <AnalyticsExplainer summary="怎麼看可能範圍與預繳速度" class="stats-explainer" data-test="stats-explainer">
          <p>可能範圍：依筆數估計真實預繳率大概落在哪裡。筆數少時範圍寬，而且會往全校平均靠，所以 3 筆裡 3 筆不代表比全校好。</p>
          <p>預繳速度：剛參觀的家長還沒到會預繳的時候，所以「本月預繳比過去慢」「來源結構失衡」改成依過去的速度，算到今天應該有幾筆預繳再比較。</p>
        </AnalyticsExplainer>
```

`StatsTab.vue` `<style scoped>` 加：

```css
.stats-explainer {
  flex-basis: 100%;
}
```

`AreaTab.vue`：`placeColumns` 與 `DISTANCE_COLUMNS` 在 `visit_to_deposit_rate` 那行之後各加：

```ts
  { key: 'visit_to_deposit_range', label: '可能範圍', kind: 'range' },
```

`CompareTable.vue`：`COLUMNS` 在 `{ key: 'visit_to_deposit', label: '參觀→預繳率' },` 之後加：

```ts
  { key: 'visit_to_deposit_range', label: '可能範圍', kind: 'range' },
```

`tableRows` 在 `visit_to_deposit: rateText(row.visit_to_deposit_rate),` 之後加：

```ts
    visit_to_deposit_range: row.visit_to_deposit_range,
```

- [ ] **Step 4：跑測試**

Run: `cd admin && source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm run typecheck; npx vitest run src/__tests__/statsTab.test.ts src/__tests__/areaTab.test.ts src/__tests__/compareTable.test.ts src/__tests__/statsDimensionCsv.test.ts src/__tests__/statsFormat.test.ts`
Expected: typecheck 0 錯誤、測試 passed。

- [ ] **Step 5：Commit**

```bash
git add admin/src/components/admissions/StatsTab.vue admin/src/components/admissions/area/AreaTab.vue admin/src/components/admissions/CompareTable.vue admin/src/__tests__/statsTab.test.ts admin/src/__tests__/areaTab.test.ts admin/src/__tests__/compareTable.test.ts admin/src/__tests__/admissionsTestKit.ts
git commit -m "feat(admin): 班別、來源、接待、區域、五校比較加可能範圍欄與說明"
```

---

### Task 7：統計總覽「預繳速度」卡與月比卡那一行

**Files:**
- Modify: `admin/src/components/admissions/StatsOverview.vue`
- Modify: `tests/stack/admissions-flow.spec.ts`（只加一行斷言，Task 9 才跑）
- Test: `admin/src/__tests__/statsTab.test.ts`

**Interfaces:**
- Consumes：`props.stats.deposit_timing`（`AdmissionsDepositTiming`）、`props.stats.deposit_pace`（`AdmissionsDepositPace`）；`statsFormat` 的 `barWidth`、`formatRate`。
- Produces：`<section data-test="deposit-timing">`（卡片）、`<p data-test="deposit-pace">`（月比卡那一行）。

- [ ] **Step 1：寫失敗的測試**（加到 `statsTab.test.ts`）

```ts
describe('統計總覽：預繳速度（2026-10-12）', () => {
  const okTiming = {
    status: 'ok' as const, visits: 30, deposited: 12, missing_time: 2, min_events: 10, half_by_day: 6,
    checkpoints: [
      { day: 7, cumulative_rate: 23.3, visits_reached: 30 },
      { day: 14, cumulative_rate: 40, visits_reached: 30 },
      { day: 30, cumulative_rate: 40, visits_reached: 30 },
      { day: 60, cumulative_rate: 40, visits_reached: 30 },
      { day: 90, cumulative_rate: null, visits_reached: 0 },
    ],
  }

  it('資料夠：五個觀察點、一半時間、補登與缺時間的註記', async () => {
    mockGet({ '/admin/admissions/stats': stats({ deposit_timing: okTiming }), [NO_DEPOSIT_PATH]: noDepositRecords })
    const { wrapper } = await mountWith(StatsTab, { props: props() })

    const card = wrapper.get('[data-test="deposit-timing"]')
    expect(card.get('h3').text()).toBe('預繳速度')
    const rows = card.findAll('.pace__row').map((row) => row.text().replace(/\s+/g, ''))
    expect(rows).toEqual([
      '第7天23.3%參觀滿7天：30位',
      '第14天40.0%參觀滿14天：30位',
      '第30天40.0%參觀滿30天：30位',
      '第60天40.0%參觀滿60天：30位',
      '第90天—還沒有家長參觀滿90天',
    ])
    expect(card.text()).toContain('到第 90 天會預繳的家長，一半在參觀後 6 天內就預繳了。')
    expect(card.text()).toContain('補登的訪視天數會偏長')
    expect(card.text()).toContain('另有 2 筆已預繳但沒有預繳紀錄時間，不列入。')
    expect(card.find('.pace__fill').attributes('style')).toContain('width: 58%')   // 23.3 ÷ 40
  })

  it('資料不夠：寫目前幾位，不畫觀察點', async () => {
    mockGet({ '/admin/admissions/stats': stats(), [NO_DEPOSIT_PATH]: noDepositRecords })
    const { wrapper } = await mountWith(StatsTab, { props: props() })

    const card = wrapper.get('[data-test="deposit-timing"]')
    expect(card.text()).toContain('預繳過的家長還不到 10 位（目前 0 位），先不計算預繳速度。')
    expect(card.findAll('.pace__row')).toHaveLength(0)
    expect(card.text()).toContain('另有 6 筆已預繳但沒有預繳紀錄時間，不列入。')
  })

  it('月比卡：可判斷時寫應有與實際，偏慢用警示色；比較組不夠時寫原因；沒有參考月份不顯示', async () => {
    const slow = { evaluable: true, reason: null, month: '115.09', visits: 15, expected: 6, observed: 1, slow: true }
    mockGet({ '/admin/admissions/stats': stats({ deposit_pace: slow }), [NO_DEPOSIT_PATH]: noDepositRecords })
    const first = (await mountWith(StatsTab, { props: props() })).wrapper
    const line = first.get('[data-test="deposit-pace"]')
    expect(line.text()).toBe('依過去的預繳速度，到今天應有約 6.0 筆預繳，實際 1 筆。')
    expect(line.classes()).toContain('mom__pace--slow')
    cleanup()

    mockGet({ '/admin/admissions/stats': stats(), [NO_DEPOSIT_PATH]: noDepositRecords })
    const second = (await mountWith(StatsTab, { props: props() })).wrapper
    expect(second.get('[data-test="deposit-pace"]').text()).toBe('其他月份的預繳還不到 10 筆，先不比較預繳速度。')
    cleanup()

    const none = { evaluable: false, reason: 'no_reference_month' as const, month: null, visits: 0, expected: null, observed: 0, slow: false }
    mockGet({ '/admin/admissions/stats': stats({ deposit_pace: none }), [NO_DEPOSIT_PATH]: noDepositRecords })
    const third = (await mountWith(StatsTab, { props: props() })).wrapper
    expect(third.find('[data-test="deposit-pace"]').exists()).toBe(false)
  })
})
```

（`cleanup` 從 `./admissionsTestKit` import；檔案已有 `afterEach(cleanup)` 時仍可在測試中途呼叫。`NO_DEPOSIT_PATH`、`noDepositRecords`、`props()` 用檔案裡既有的。）

Run: `cd admin && source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npx vitest run src/__tests__/statsTab.test.ts -t "預繳速度"`
Expected: FAIL（找不到 `[data-test="deposit-timing"]`）。

- [ ] **Step 2：實作 `StatsOverview.vue`**

import 改成（加 `barWidth`）：

```ts
import {
  NO_VALUE, TREND_MARK, alertLevelLabel, barWidth, formatPoints, formatRate, rateLevel, trendLabel, trendOf,
  type StatsColumn, type StatsTarget,
} from '../../admissions/statsFormat'
```

script 加：

```ts
// 預繳速度（2026-10-12 規格 §10.1）：參觀後第 N 天的累積預繳率；長條以五個觀察點的最大值為 100%。
const timing = computed(() => props.stats.deposit_timing)
const timingMax = computed(() => Math.max(0, ...timing.value.checkpoints.map((point) => point.cumulative_rate ?? 0)))
const pace = computed(() => props.stats.deposit_pace)
const paceText = computed(() => {
  const value = pace.value
  if (value.evaluable && value.expected !== null) {
    return `依過去的預繳速度，到今天應有約 ${value.expected.toFixed(1)} 筆預繳，實際 ${value.observed} 筆。`
  }
  if (value.reason === 'insufficient_baseline') return `其他月份的預繳還不到 ${timing.value.min_events} 筆，先不比較預繳速度。`
  return ''
})
```

月比卡 `</dl>` 之後（`</section>` 之前）加：

```vue
        <p v-if="paceText" class="mom__pace" :class="{ 'mom__pace--slow': pace.slow }" data-test="deposit-pace">{{ paceText }}</p>
```

在 `overview__pair` 那個 `</div>` 之後、`<section class="stats-card">`（本範圍合計）之前加：

```vue
    <section class="stats-card pace" data-test="deposit-timing">
      <h3>預繳速度</h3>
      <template v-if="timing.status === 'ok'">
        <p v-if="timing.half_by_day !== null" class="pace__summary">
          到第 90 天會預繳的家長，一半在參觀後 {{ timing.half_by_day }} 天內就預繳了。
        </p>
        <ol class="pace__rows">
          <li v-for="point in timing.checkpoints" :key="point.day" class="pace__row">
            <span class="pace__day">第 {{ point.day }} 天</span>
            <span class="pace__bar" aria-hidden="true">
              <span class="pace__fill" :style="{ width: barWidth(point.cumulative_rate ?? 0, timingMax) }" />
            </span>
            <strong class="num">{{ formatRate(point.cumulative_rate) }}</strong>
            <span class="pace__reached">
              {{ point.cumulative_rate === null ? `還沒有家長參觀滿 ${point.day} 天` : `參觀滿 ${point.day} 天：${point.visits_reached} 位` }}
            </span>
          </li>
        </ol>
        <p class="hint">預繳時間是後台標記預繳的日期，補登的訪視天數會偏長；之後退出的也算預繳過。</p>
      </template>
      <p v-else class="pace__empty">
        預繳過的家長還不到 {{ timing.min_events }} 位（目前 {{ timing.deposited }} 位），先不計算預繳速度。
      </p>
      <p v-if="timing.missing_time > 0" class="hint">另有 {{ timing.missing_time }} 筆已預繳但沒有預繳紀錄時間，不列入。</p>
    </section>
```

`<style scoped>` 加（`@media (max-width: 720px)` 之前）：

```css
.mom__pace {
  margin: 10px 0 0;
  padding-top: 10px;
  border-top: 1px solid var(--line);
  color: var(--ink-2);
  font-size: var(--text-sm);
}

.mom__pace--slow {
  color: var(--el-color-danger);
}

.pace__summary {
  margin: 0 0 10px;
}

.pace__rows {
  display: grid;
  gap: 6px;
  margin: 0 0 10px;
  padding: 0;
  list-style: none;
}

.pace__row {
  display: grid;
  grid-template-columns: 4.5em minmax(40px, 160px) 4.5em minmax(0, 1fr);
  align-items: center;
  gap: 8px;
}

.pace__day,
.pace__reached,
.pace__empty {
  color: var(--ink-3);
  font-size: var(--text-sm);
}

.pace__row strong {
  text-align: right;
}

.pace__bar {
  display: block;
  height: 6px;
  overflow: hidden;
  border-radius: 3px;
  background: var(--surface-3);
}

.pace__fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--el-color-primary);
}
```

並在 `@media (max-width: 720px)` 區塊內加：

```css
  .pace__row {
    grid-template-columns: 4.5em minmax(40px, 1fr) 4.5em;
  }

  .pace__reached {
    grid-column: 1 / -1;
  }
```

- [ ] **Step 3：stack e2e 加斷言**（`tests/stack/admissions-flow.spec.ts`，「統計分析：本月 1 人次…」那個 step 的兩行 expect 之後）：

```ts
    // 2026-10-12 預繳速度：只有這一筆預繳，資料不夠。
    await expect(page.locator('[data-test="deposit-timing"]')).toContainText('預繳過的家長還不到 10 位（目前 1 位）')
```

- [ ] **Step 4：跑測試**

Run: `cd admin && source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm run typecheck; npx vitest run src/__tests__/statsTab.test.ts`
Expected: typecheck 0 錯誤、passed。

- [ ] **Step 5：Commit**

```bash
git add admin/src/components/admissions/StatsOverview.vue admin/src/__tests__/statsTab.test.ts tests/stack/admissions-flow.spec.ts
git commit -m "feat(admin): 統計總覽加預繳速度卡，月比卡顯示預繳速度比較"
```

---

### Task 8：文件回寫

**Files:**
- Modify: `DESIGN.md`、`contracts/ivy-recruitment/README.md`、`docs/specs/2026-09-30-website-admissions-design.md`、`docs/specs/2026-10-12-admissions-deposit-pace-design.md`、`README.md`

**Interfaces:** 無程式介面。

- [ ] **Step 1：`contracts/ivy-recruitment/README.md`**

第 8 點整段換成：

```markdown
8. 月比（本月對上月）任一邊是 `null`，差值也是 `null`；園務會算成 100.0－0，上月沒資料就誤報。「本月漏斗轉換下滑」警示 2026-10-12 起不再看月比，改由第 19 點判斷。
```

第 18 點之後加第 19 點：

```markdown
19. 預繳速度與可能範圍（2026-10-12，`docs/specs/2026-10-12-admissions-deposit-pace-design.md`），都是讀取時計算、不改資料表與匯出：
    - `FUNNEL_DROP`（標題改「本月預繳比過去慢」）：不再比月比的百分點、也不再比參觀轉註冊；改用其他月份的訪視算「參觀後第 N 天累積預繳率」（Kaplan–Meier），算出參考月份每位家長到今天應有的預繳數，實際明顯偏少（Poisson-binomial P ≤ 0.10 且少 2 筆以上）才報；其他月份的預繳少於 10 筆不判斷。園務照月比 −10 個百分點判斷，月初家長還沒到預繳時間就會誤報。
    - `SOURCE_IMBALANCE`：占比 ≥ 40% 不變；判斷從「預繳率低於整體」改成「這個來源近 90 天的家長，依其他來源的預繳速度明顯偏少」，新來源剛投放不會誤報。
    - 預繳時間取最後一筆 `deposit_added` 事件（台北日期）；之後退出的也算預繳過。補登舊訪視會讓天數偏長。
    - 班別、來源、帶參觀老師、行政區、里、距離帶、五校比較每列多 `visit_to_deposit_range`：Beta 收縮（事前強度 10、全體 (預繳+1)/(參觀+2)）的 80% 範圍。
    - 算法集中在 `backend/app/admissions/estimation.py`（只用標準函式庫），併入時由園務決定要不要跟進。
```

- [ ] **Step 2：`DESIGN.md`**

2a. 「## 招生入學（2026-10-01）」節的「**不做**」清單：把「、樣本數提示」拿掉，在該句最後加「樣本數提示 2026-10-12 起改做「可能範圍」，見「招生統計：預繳速度與可能範圍」。」

2b. 「成效統計補強」節中「（只用在成效統計；招生入學統計仍不做樣本數提示。）」改成「（只用在成效統計；招生入學統計 2026-10-12 起用「可能範圍」，見「招生統計：預繳速度與可能範圍」。）」

2c. 在檔案最前面的招生章節（`## 招生入學：區域分析（2026-10-08）` 之前）加新節：

```markdown
## 招生統計：預繳速度與可能範圍（2026-10-12）

規格 `docs/specs/2026-10-12-admissions-deposit-pace-design.md`；和園務不同處記在轉移契約第 19 點。

- **兩個警示改看預繳速度**：「本月預繳比過去慢」（原「本月漏斗轉換下滑」）與「來源結構失衡」不再拿原始預繳率比，改成依過去（其他月份／其他來源）的預繳速度，算到今天應有幾筆預繳，實際明顯偏少才報。理由：剛參觀的家長還沒到會預繳的時候，月初與新來源天生偏低。比較組的預繳少於 10 筆時不判斷。
- **統計總覽「預繳速度」卡**：放在漏斗快照／月比之後；第 7、14、30、60、90 天的累積預繳率，長條以五點最大值為 100%，每列寫「參觀滿 t 天：n 位」；資料不夠寫「預繳過的家長還不到 10 位（目前 N 位）」。註記補登會偏長、之後退出也算預繳過。月比卡多一行「應有約 E 筆、實際 O 筆」，偏慢用危險色。
- **可能範圍欄**：班別、來源、接待、行政區、里、距離、五校比較的預繳率後面一欄，畫面寫整數「29–64%」，CSV 拆「可能範圍下限」「可能範圍上限」兩個數字欄（沒有值寫空白）。排序不變、不依範圍排名（帶參觀老師尤其不排）。月度、年度、交叉表不加。
- **說明**：統計分析頂部一段預設收起的說明（沿用成效統計的 `AnalyticsExplainer`）。
- **不做**：追蹤優先序分數、註冊數預測、機器學習；預繳日期欄位與退出原因代碼（要改資料表，另案）。
```

- [ ] **Step 3：`docs/specs/2026-09-30-website-admissions-design.md`** 第 9 節標題下一行加：

```markdown
> 2026-10-12：警示判斷、預繳速度與可能範圍改見 `docs/specs/2026-10-12-admissions-deposit-pace-design.md`。
```

- [ ] **Step 4：本規格狀態**：`docs/specs/2026-10-12-admissions-deposit-pace-design.md` 開頭的「狀態」改成「已實作於分支 `feature/admissions-deposit-pace-20261012`，**未部署**」，並在檔尾加「## 16. 實作裁定」列出實作時和規格不同的地方（沒有就寫「無」）。

- [ ] **Step 5：`README.md` 頂部**加日期段落（照既有格式，看最上面一段怎麼寫）：

```markdown
## 2026-10-12 招生統計：預繳速度與可能範圍

- 「本月漏斗轉換下滑」改成「本月預繳比過去慢」、「來源結構失衡」也改看預繳速度：依過去的速度算到今天應有幾筆預繳，實際明顯偏少才報，月初與新來源不再誤報。
- 統計總覽新增「預繳速度」卡（參觀後第 7／14／30／60／90 天累積預繳率）；月比卡多一行應有／實際預繳數。
- 班別、來源、接待、區域、五校比較的預繳率旁加「可能範圍」（Beta 收縮 80%），CSV 拆下限、上限兩欄。
- 後端新增 `admissions/estimation.py`（純標準函式庫）、`admissions/deposit_pace.py`；沒有 migration。
- 規格 `docs/specs/2026-10-12-admissions-deposit-pace-design.md`，計畫 `docs/superpowers/plans/2026-10-12-admissions-deposit-pace.md`。
```

- [ ] **Step 6：Commit**

```bash
git add DESIGN.md README.md contracts/ivy-recruitment/README.md docs/specs/2026-09-30-website-admissions-design.md docs/specs/2026-10-12-admissions-deposit-pace-design.md
git commit -m "docs(admissions): 回寫預繳速度與可能範圍的設計規則、轉移契約第 19 點"
```

---

### Task 9：整體驗證（主 session 執行）

**Files:** 無新檔；驗證結果寫進本計畫檔尾「驗證紀錄」與規格 §16。

- [ ] **Step 1：後端全套**（主 session 背景跑，約 10–15 分鐘；跑的時候不要跑其他測試）

```bash
cd ~/Repositories/ivy-website-wt/admissions-deposit-pace-20261012/backend && WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pace1012_test uv run pytest -q
```

Expected: 全部 passed（台北週五時 `test_booking_consent_readiness` 的場次同步可能因日期相依失敗，是 main 既有問題，記下不修）。

- [ ] **Step 2：前端與契約**

```bash
cd ~/Repositories/ivy-website-wt/admissions-deposit-pace-20261012
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm run contract:check; npm --prefix admin run typecheck; npm --prefix admin run test:unit; npm --prefix admin run build; npm --prefix web run typecheck; npm run test:website
```

Expected: 全部成功（admin vitest 若在高負載下 5 秒逾時，單獨重跑該檔確認）。

- [ ] **Step 3：stack e2e（招生三支，專屬庫與埠）**

```bash
cd ~/Repositories/ivy-website-wt/admissions-deposit-pace-20261012
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm run e2e:build; E2E_DB_NAME=ivy_website_pace1012_e2e_test E2E_API_PORT=8796 E2E_WEB_PORT=3796 npx playwright test -c playwright.stack.config.ts tests/stack/admissions-flow.spec.ts tests/stack/admissions-area.spec.ts tests/stack/exports.spec.ts
```

Expected: passed；`admissions-flow` 的 1440／390 兩個「頁面不橫向溢出」都過。

- [ ] **Step 4：看截圖**：讀 `admissions-flow` 輸出的 `admissions-stats-*-1440.png`、`admissions-stats-*-390.png`、`admissions-stats-compare-*.png`，確認預繳速度卡、可能範圍欄、說明在桌機與手機都排得好（說明沒有把頁首撐亂、卡片在 390 沒有擠壓）。

- [ ] **Step 5：清理**

```bash
dropdb ivy_website_pace1012_e2e_test 2>/dev/null; true
```

（`ivy_website_pace1012_test` 留到分支合併後再刪。）

- [ ] **Step 6：回報**：實際跑過的指令與結果、截圖觀察、未驗證項（沒有登入正式後台、正式庫是測試資料所以卡片會顯示資料不夠）。不 push、不部署，等使用者決定合併方式。
