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
