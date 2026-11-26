from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base

LEAD_STATUSES = ("new", "converted", "dismissed")


class MetaLead(Base):
    """Meta 名單型廣告（即時表單）的名單收件匣（docs/specs/2026-11-26-meta-lead-inbox-design.md）。
    同步只新增名單，不改已有名單；狀態只由後台的轉成案件、略過、放回改（app/meta_leads/service.py）。
    規格 6.2 不得自動建案，所以名單不直接變成參觀案件，也不占場次名額。

    個資：轉成案件時清掉 parent_name、phone、answers（資料已在案件裡，跟著案件的保存政策走）；
    沒轉的名單收到 WEBSITE_META_LEADS_RETENTION_DAYS 天後由 maintenance 刪除（不看功能開關）。"""

    __tablename__ = "meta_leads"
    __table_args__ = (
        CheckConstraint("status IN ('new', 'converted', 'dismissed')", name="ck_meta_leads_status"),
        Index("ix_meta_leads_campus_status_created", "campus_key", "status", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    campus_key: Mapped[str] = mapped_column(ForeignKey("campuses.key", ondelete="CASCADE"), nullable=False)
    # Meta 的名單編號（leadgen id，純數字）；回傳 Meta 時當 user_data.lead_id。
    lead_id: Mapped[str] = mapped_column(String(32), nullable=False, unique=True)
    form_id: Mapped[str] = mapped_column(String(32), nullable=False)
    form_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    ad_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    campaign_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Meta 回的 platform：fb、ig 等；只拿來顯示。
    platform: Mapped[str | None] = mapped_column(String(16), nullable=True)
    is_organic: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    # 家長在 Meta 送出表單的時間。
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    parent_name: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # 台灣手機轉成 09 開頭；其他格式照原樣。
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # 其餘作答：[{"question": 題目代碼或文字, "answer": 回答}]，不含姓名與電話。
    answers: Mapped[list | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="new", server_default="new")
    # 轉成的參觀案件；案件之後被刪（理論上不會）就留空，名單仍是已轉案件。
    visit_request_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("visit_requests.id", ondelete="SET NULL"), nullable=True
    )
    handled_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    handled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # 已推到該校 LINE 群組的時間（沒綁群組、沒設 LINE 也會寫，代表不用再推）。
    notified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class MetaLeadSync(Base):
    """每校一列：最近一次拉名單的時間與結果。last_error 只有步驟、HTTP 狀態與 Meta 錯誤代碼，
    不含 token 與回應內容。cursor_at 是已讀到的最新名單建立時間，下一輪從這裡往前重疊一段再讀。"""

    __tablename__ = "meta_lead_sync"

    campus_key: Mapped[str] = mapped_column(ForeignKey("campuses.key", ondelete="CASCADE"), primary_key=True)
    page_id: Mapped[str] = mapped_column(String(32), nullable=False)
    last_attempt_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # 最近一次成功時新收進來幾筆。
    last_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cursor_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
