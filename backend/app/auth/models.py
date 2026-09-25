from __future__ import annotations

import enum
import uuid
from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Enum, ForeignKey, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class Role(str, enum.Enum):
    """完整角色列舉（規格 7）。2026-09-24 起五種都可以建立；除了總管理者，
    其餘角色都必須指定校區範圍。"""

    SUPER_ADMIN = "super_admin"
    CAMPUS_ADMIN = "campus_admin"
    EDITOR = "editor"
    RECEPTION = "reception"
    READONLY = "readonly"


CREATABLE_ROLES = tuple(Role)

# 規格 7：「全站內容編輯」與「個資匯出」是明確授權，不因擁有某校範圍就自動
# 取得，只有總管理者可以逐人授予。總管理者本身不需要（已涵蓋全部）。
SHARED_CONTENT = "content.shared"
# 2026-09-25 業主裁定：個資匯出改為逐人授權，不再依角色自動給分校管理者。
BOOKING_EXPORT = "booking.export"
# 授權 -> 可以接受這項授權的角色。共用內容只給本來就能編內容的角色（櫃台、
# 唯讀不能編內容）；個資匯出只給看得到案件的角色，看不到案件授權了也沒東西可匯。
GRANTABLE_CAPABILITIES: dict[str, tuple[Role, ...]] = {
    SHARED_CONTENT: (Role.CAMPUS_ADMIN, Role.EDITOR),
    BOOKING_EXPORT: (Role.CAMPUS_ADMIN, Role.RECEPTION),
}


class User(Base):
    __tablename__ = "users"
    # email 的唯一性必須不分大小寫：建立帳號與登入查詢若一邊大小寫敏感、
    # 一邊 lower() 比對，就會出現兩筆同名帳號，登入端點直接壞掉。應用層
    # 已統一正規化成小寫，這個 functional index 是 DB 端的兜底（也擋住
    # 兩個併發請求同時通過應用層檢查的情況）。
    __table_args__ = (
        Index("uq_users_email_lower", text("lower(email)"), unique=True),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    # Google sub 是穩定識別碼；email 只用於首次核對已核准的管理員。
    google_sub: Mapped[str | None] = mapped_column(String(255), nullable=True, unique=True)
    # LINE sub 只能由已登入的管理員自己綁定；LINE 不提供可信的 email 驗證。
    line_sub: Mapped[str | None] = mapped_column(String(255), nullable=True, unique=True)
    role: Mapped[Role] = mapped_column(Enum(Role, name="user_role"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    capabilities: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list, server_default="[]")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    campus_scopes: Mapped[list["UserCampusScope"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )
    sessions: Mapped[list["Session"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class UserCampusScope(Base):
    """campus_admin 的管理範圍；super_admin 不需要列（視為涵蓋全部）。"""

    __tablename__ = "user_campus_scopes"

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    campus_key: Mapped[str] = mapped_column(
        ForeignKey("campuses.key", ondelete="CASCADE"), primary_key=True
    )

    user: Mapped[User] = relationship(back_populates="campus_scopes")


class Session(Base):
    """id 存 session token 的 SHA-256 hash，cookie 帶原始 token，
    資料庫外洩也讀不出可用的 session。"""

    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    csrf_token: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped[User] = relationship(back_populates="sessions")
