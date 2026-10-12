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
