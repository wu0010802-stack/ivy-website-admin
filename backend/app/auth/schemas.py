from __future__ import annotations

import uuid
from typing import Annotated

from pydantic import AfterValidator, BaseModel, EmailStr, Field, field_validator
from pydantic_core import PydanticCustomError

from app.auth.models import Role

# 所有密碼欄位的字元上限。bcrypt 只看前 72 bytes；太長的輸入在 passlib 會丟
# PasswordSizeError（>4096 bytes）變成 500，而且沒有任何合理用途。
PASSWORD_MAX_CHARS = 128
BCRYPT_MAX_BYTES = 72


def _fits_bcrypt(value: str) -> str:
    # bcrypt 會默默截掉 72 bytes 之後的部分：長中文密語（每字 3 bytes）後半段
    # 其實沒有作用。新密碼直接擋下，不讓人以為自己設了更強的密碼。
    if len(value.encode("utf-8")) > BCRYPT_MAX_BYTES:
        raise PydanticCustomError(
            "password_too_long",
            "密碼太長：最多 72 個位元組（英數字 72 個、中文約 24 個字），超過的部分不會生效",
        )
    return value


# 新設定的密碼（建立帳號、重設、本人變更）。
NewPassword = Annotated[
    str, Field(min_length=12, max_length=PASSWORD_MAX_CHARS), AfterValidator(_fits_bcrypt)
]
# 驗證用的既有密碼（登入、目前的密碼）：只限字元數，不檢查 bytes，舊密碼照樣能登入。
ExistingPassword = Annotated[str, Field(max_length=PASSWORD_MAX_CHARS)]


class LoginRequest(BaseModel):
    email: EmailStr
    password: ExistingPassword


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


class ReauthRequest(BaseModel):
    """變更自己的登入方式（綁定／解除 LINE、解除 Google）前的重新驗證。
    session 建立 10 分鐘內可以不帶；超過就要帶目前的密碼。"""

    current_password: ExistingPassword | None = None


class UserCreateRequest(BaseModel):
    email: EmailStr
    password: NewPassword
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

    password: NewPassword


class PasswordChangeRequest(BaseModel):
    """本人改密碼，要先輸入目前的密碼。"""

    current_password: ExistingPassword
    new_password: NewPassword


class UserCapabilitiesRequest(BaseModel):
    capabilities: list[str] = Field(default_factory=list, max_length=5)
