from __future__ import annotations

import uuid

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.auth.models import Role


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    csrf_token: str
    user: "UserOut"


class MeResponse(BaseModel):
    csrf_token: str
    user: "UserOut"


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    role: Role
    is_active: bool
    campus_keys: list[str]
    # 總管理者逐人給的明確授權："content.shared"（編輯全站共用內容）、
    # "booking.export"（個資匯出）。
    capabilities: list[str] = Field(default_factory=list)
    # 角色＋授權算出來的實際 capability，後台據此隱藏做不到的操作；真正的
    # 檢查仍在各端點。
    effective_capabilities: list[str]
    google_linked: bool
    line_linked: bool

    model_config = {"from_attributes": True}


class AuthProviders(BaseModel):
    google: bool
    line: bool


class LineLinkStart(BaseModel):
    authorize_url: str


class UserCreateRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12)
    role: Role
    campus_keys: list[str] = Field(default_factory=list)
    capabilities: list[str] = Field(default_factory=list)

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, value: str) -> str:
        """EmailStr 只會小寫 domain，local part 原樣保留，於是
        `Wang@ivy.tw` 與 `wang@ivy.tw` 會被當成兩個帳號建立，但登入查詢
        是 lower() 比對，兩筆同時命中就整個登入掛掉。統一在 schema 這一
        層正規化，讓所有寫入端共用同一個正規化點。"""
        return value.strip().lower()


class UserUpdateActiveRequest(BaseModel):
    is_active: bool


class UserUpdateScopeRequest(BaseModel):
    campus_keys: list[str]


class UserUpdateRoleRequest(BaseModel):
    role: Role
    # 總管理者不需要；其他角色至少一校。
    campus_keys: list[str] = Field(default_factory=list)


class PasswordResetRequest(BaseModel):
    """總管理者替別人重設密碼。"""

    password: str = Field(min_length=12, max_length=200)


class PasswordChangeRequest(BaseModel):
    """本人改密碼，要先輸入目前的密碼。"""

    current_password: str
    new_password: str = Field(min_length=12, max_length=200)


class UserCapabilitiesRequest(BaseModel):
    capabilities: list[str] = Field(default_factory=list, max_length=5)
