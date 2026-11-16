"""區域分析附近園所異動與裁罰的站內通知種類（2026-11-16 規格 §7.4）。

只給有 admissions.stats 的人（總管理者）：站內通知的列表、計數、全部已讀、單筆已讀對沒有這個權限的人排除這兩種。"""

from __future__ import annotations

AREA_PROVIDER_CHANGE = "area_provider_change"
AREA_PENALTY = "area_penalty"
AREA_NOTICE_KINDS: frozenset[str] = frozenset({AREA_PROVIDER_CHANGE, AREA_PENALTY})
