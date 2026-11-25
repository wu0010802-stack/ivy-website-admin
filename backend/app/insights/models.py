"""Google 商家檔案與 Keyword Planner 同步進來的資料（2026-11-25，
docs/specs/2026-11-25-business-profile-keyword-planner-design.md §4、§5）。

只有 Google 給的彙總數字（曝光、點擊、搜尋量）與園方自己維護的關鍵字清單，沒有任何訪客或家長資料，不進個資保存清理。"""

from __future__ import annotations

import uuid
from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

# 商家檔案的每日指標（Business Profile Performance API 的 DailyMetric）→ 存在資料庫的短代碼。
# 曝光分「電腦／手機 × Google 搜尋／Google 地圖」四種；其餘是使用者在商家檔案上按的動作。
GBP_METRICS: dict[str, str] = {
    "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH": "desktop_search",
    "BUSINESS_IMPRESSIONS_MOBILE_SEARCH": "mobile_search",
    "BUSINESS_IMPRESSIONS_DESKTOP_MAPS": "desktop_maps",
    "BUSINESS_IMPRESSIONS_MOBILE_MAPS": "mobile_maps",
    "CALL_CLICKS": "calls",
    "BUSINESS_DIRECTION_REQUESTS": "directions",
    "WEBSITE_CLICKS": "website",
    # 2026-10-14 新增的指標；舊的 BUSINESS_CONVERSATIONS 已在 2026-01-31 移除，不再要。
    "MESSAGING_CLICKS": "messages",
}
GBP_METRIC_CODES = tuple(GBP_METRICS.values())
GBP_KEYWORD_MAX = 200

# Keyword Planner 查哪些地區（Google Ads 的地區代碼，geotargets-2026-10-06.csv，
# https://developers.google.com/google-ads/api/data/geotargets ）：高雄市，加上五校所在、而且 Google 有「區」層級代碼的區——
# 三民區（義華）、左營區（明華、崇德）。鳥松區（國際）、仁武區（仁武）在 Google 的清單裡只有郵遞區號（833、814），
# 沒有區，不加（規格 §5.2）。順序就是畫面上的順序；第一個（高雄市）失敗才算整輪失敗。
SEARCH_DEMAND_GEOS: dict[str, str] = {
    "kaohsiung": "geoTargetConstants/9040314",
    "sanmin": "geoTargetConstants/9215426",
    "zuoying": "geoTargetConstants/9239360",
}
# 繁體中文（zh_TW）；簡體是 1017。https://developers.google.com/google-ads/api/data/codes-formats#languages
SEARCH_DEMAND_LANGUAGE = "languageConstants/1018"
SEARCH_KEYWORD_MAX_LENGTH = 80
SEARCH_KEYWORD_LIMIT = 50


def _in(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


class GbpDailyMetric(Base):
    """商家檔案一個地點、一天、一個指標一列。Google 沒給值（那天是 0）時也存 0，畫面才分得出「0」和「還沒同步」。"""

    __tablename__ = "gbp_daily_metrics"
    __table_args__ = (CheckConstraint(_in("metric", GBP_METRIC_CODES), name="ck_gbp_daily_metrics_metric"),)

    campus_key: Mapped[str] = mapped_column(ForeignKey("campuses.key", ondelete="CASCADE"), primary_key=True)
    day: Mapped[date] = mapped_column(Date, primary_key=True)
    metric: Mapped[str] = mapped_column(String(16), primary_key=True)
    value: Mapped[int] = mapped_column(Integer, nullable=False)


class GbpKeywordMonth(Base):
    """這個月的搜尋字詞抓過了（就算 Google 一個字詞都沒給）。最近兩個整月每次同步都重抓，更早的抓過就不再抓。"""

    __tablename__ = "gbp_keyword_months"
    __table_args__ = (CheckConstraint("EXTRACT(DAY FROM month) = 1", name="ck_gbp_keyword_months_first_day"),)

    campus_key: Mapped[str] = mapped_column(ForeignKey("campuses.key", ondelete="CASCADE"), primary_key=True)
    month: Mapped[date] = mapped_column(Date, primary_key=True)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class GbpMonthlyKeyword(Base):
    """商家檔案一個月的搜尋字詞與曝光。Google 對次數少的字詞只給門檻（「少於 15」），這時 impressions 是 NULL、
    below 是門檻；兩者恰好一個有值。"""

    __tablename__ = "gbp_monthly_keywords"
    __table_args__ = (
        CheckConstraint("(impressions IS NULL) <> (below IS NULL)", name="ck_gbp_monthly_keywords_value"),
        CheckConstraint("EXTRACT(DAY FROM month) = 1", name="ck_gbp_monthly_keywords_first_day"),
    )

    campus_key: Mapped[str] = mapped_column(ForeignKey("campuses.key", ondelete="CASCADE"), primary_key=True)
    month: Mapped[date] = mapped_column(Date, primary_key=True)
    keyword: Mapped[str] = mapped_column(String(GBP_KEYWORD_MAX), primary_key=True)
    impressions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    below: Mapped[int | None] = mapped_column(Integer, nullable=True)


class SearchKeyword(Base):
    """招生統計「搜尋需求」要追的關鍵字（總管理者在後台維護，最多 50 個）。synced_at＝最近一次 Keyword Planner
    回應裡有處理到它（就算 Google 說量太少），NULL＝加進來之後還沒同步過。"""

    __tablename__ = "search_keywords"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    text: Mapped[str] = mapped_column(String(SEARCH_KEYWORD_MAX_LENGTH), nullable=False, unique=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SearchKeywordVolume(Base):
    """一個關鍵字、一個地區、一個月的 Google 搜尋量。searches 是 NULL＝Google 那個月沒給數字（量太少），不補 0。"""

    __tablename__ = "search_keyword_volumes"
    __table_args__ = (
        CheckConstraint("EXTRACT(DAY FROM month) = 1", name="ck_search_keyword_volumes_first_day"),
        CheckConstraint("searches IS NULL OR searches >= 0", name="ck_search_keyword_volumes_searches"),
    )

    keyword_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("search_keywords.id", ondelete="CASCADE"), primary_key=True)
    geo: Mapped[str] = mapped_column(String(16), primary_key=True)
    month: Mapped[date] = mapped_column(Date, primary_key=True)
    searches: Mapped[int | None] = mapped_column(Integer, nullable=True)


class GoogleSyncStatus(Base):
    """背景同步的狀態：gbp:<校區>（商家檔案每日指標與搜尋字詞）、search_demand（Keyword Planner）。
    last_error 只有「哪一步、HTTP 幾號」，不帶 Google 的回應內容。"""

    __tablename__ = "google_sync_status"

    key: Mapped[str] = mapped_column(String(32), primary_key=True)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(200), nullable=True)
