"""成效統計的期間（2026-11-20）：「近 N 天」碰到起算日（設定 analytics_stats_start）就從起算日開始。

起算日之前的紀錄照留、不刪，只是不列入：網域 2026-11-11 才切到新站，之前與上線驗證那幾天幾乎都是
內部的人與自動化瀏覽器（11-12 單日約 250 次造訪），混進來會讓總數、手機比例、停留與來源都失真。"""
from __future__ import annotations

from datetime import date, timedelta


def stats_since(today: date, days: int, start: date | None) -> date:
    """近 N 天（含今天）的第一天；早於起算日時改從起算日開始。起算日還沒到（時鐘早於它）就不限。"""
    since = today - timedelta(days=days - 1)
    return max(since, start) if start is not None and start <= today else since


def has_full_previous(since: date, days: int, start: date | None) -> bool:
    """往前同樣天數的上一期是不是整段都在起算日之後；有一天在之前就不比，免得拿殘缺的上一期比。"""
    return start is None or since - timedelta(days=days) >= start
