"""公開 telemetry 與公開點擊事件的全站上限（2026-09-29 稽核：
public-telemetry-analytics-storage-flood）。

單一來源的限流擋不住多個來源（IPv6 同一段的不同位址、代理池）一起灌。業主
裁定資料照留、不清除（analytics_events 是招生成效的原始紀錄），所以改用全站
每分鐘與每日上限封住可以被寫進來的量：超過時安靜丟棄、照樣回 204——正常
瀏覽器的回報本來就是 fire-and-forget，回 429 只會讓攻擊者知道上限在哪。

每日上限是固定的 UTC 日窗口（Limit.sliding=False）：每個 UTC 日各自計數，前
一天被灌滿不會連帶壓低隔天的額度，任何一個 UTC 日寫進來的筆數都不會超過上限。
全站每日上限之前另有「每來源每日」上限（代理有帶訪客 IP 時才套用），少數幾個
來源用不光全站額度（稽核 telemetry-daily-cap-silent-blackout）。上限值見
config.py 的 telemetry_*、analytics_clicks_*。

開始丟棄時每個窗口記一筆 warning（bucket 與上限），營運端才看得出後台數據頁
那段時間少算了。"""
from __future__ import annotations

import logging
import time
from collections.abc import Iterable

from app.common import ratelimit
from app.config import Settings

logger = logging.getLogger("app.operations.public_caps")

GLOBAL_KEY = "global"
DAY_SECONDS = 86_400

# 每來源每日：正常瀏覽一頁約 1 筆瀏覽＋3–6 筆效能回報，500 筆約一百頁；點擊
# 一個來源一天 200 次已經遠超過真人。只影響觀測數據，不影響功能。
TELEMETRY_SOURCE_DAILY = ratelimit.Limit("telemetry_source_daily", DAY_SECONDS, 500, sliding=False)
CLICK_SOURCE_DAILY = ratelimit.Limit("analytics_click_source_daily", DAY_SECONDS, 200, sliding=False)

# 一個上限與它的 key（全站上限用 GLOBAL_KEY，每來源上限用 client_key）。
Cap = tuple[ratelimit.Limit, str]

# bucket → 已經記過 warning 的窗口編號；每個窗口只記一次，不洗版。
_last_logged: dict[str, int] = {}


def _caps(
    minute: ratelimit.Limit, source_daily: ratelimit.Limit, daily: ratelimit.Limit, source: str | None
) -> tuple[Cap, ...]:
    caps: list[Cap] = [(minute, GLOBAL_KEY)]
    if source is not None:
        caps.append((source_daily, source))
    caps.append((daily, GLOBAL_KEY))
    return tuple(caps)


def telemetry_limits(settings: Settings, source: str | None = None) -> tuple[Cap, ...]:
    """瀏覽量與 Core Web Vitals 樣本共用一組上限。source 是訪客的 client_key，
    只在代理有帶訪客 IP 時傳（沒有時全站會共用一個「每來源」桶）。"""
    return _caps(
        ratelimit.Limit("telemetry_global", 60, settings.telemetry_global_per_minute),
        TELEMETRY_SOURCE_DAILY,
        ratelimit.Limit("telemetry_daily", DAY_SECONDS, settings.telemetry_daily_cap, sliding=False),
        source,
    )


def click_limits(settings: Settings, source: str | None = None) -> tuple[Cap, ...]:
    return _caps(
        ratelimit.Limit("analytics_click_global", 60, settings.analytics_clicks_global_per_minute),
        CLICK_SOURCE_DAILY,
        ratelimit.Limit("analytics_click_daily", DAY_SECONDS, settings.analytics_clicks_daily_cap, sliding=False),
        source,
    )


def _log_first_drop(limit: ratelimit.Limit, key: str) -> None:
    window = int(time.time() // limit.window_seconds)
    if _last_logged.get(limit.bucket) == window:
        return
    _last_logged[limit.bucket] = window
    scope = "全站" if key == GLOBAL_KEY else "單一來源"
    logger.warning(
        "公開事件%s上限已滿，這個窗口之後的事件不寫入（仍回 204）：bucket=%s 上限=%s／%s 秒",
        scope, limit.bucket, limit.max_per_window, limit.window_seconds,
    )


async def admit(limiter: ratelimit.RateLimiter, caps: Iterable[Cap], *, gate: Cap | None = None) -> bool:
    """依序檢查（全站每分鐘 → 每來源每日 → 全站每日），有一個滿了就回 False，
    呼叫端不寫入。被前面擋下的不會佔用後面的額度。全部在同一個限流交易內
    完成（ratelimit.check_chain）。

    gate：要排在最前面、被擋時由呼叫端轉成 429 的檢查（telemetry 的單一來源
    每分鐘上限）。gate 被擋、或限流池拿不到連線時丟 RateLimited；沒有 gate 時
    拿不到連線照舊安靜丟棄（回 False，不記 warning）。"""
    checks = ([gate] if gate is not None else []) + list(caps)
    blocked = await limiter.check_chain(checks)
    if blocked is None:
        return True
    index, exc = blocked
    if gate is not None and index == 0:
        raise exc
    if not isinstance(exc, ratelimit.RateLimiterUnavailable):
        limit, key = checks[index]
        _log_first_drop(limit, key)
    return False
