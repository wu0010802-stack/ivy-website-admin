from __future__ import annotations

import unicodedata
import uuid
from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, EmailStr, Field, field_validator
from pydantic_core import PydanticCustomError

from app.auth.models import DISPLAY_NAME_MAX_LENGTH, Role


def _is_hidden_character(ch: str) -> bool:
    """換行、tab 這類控制字元（Cc）、行／段落分隔（Zl、Zp），以及零寬空白、
    雙向文字覆寫這類看不見的格式字元（Cf）：後者會讓名字在清單裡看起來跟
    別人一模一樣，或把整行字倒過來。表情符號組合用的零寬連接字（U+200D）
    與旗幟用的標籤字元（U+E0020–U+E007F）是正常字，不擋。"""
    if ch == "\u200d" or "\U000e0020" <= ch <= "\U000e007f":
        return False
    return unicodedata.category(ch) in {"Cc", "Cf", "Zl", "Zp"}


def normalize_display_name(value: str | None) -> str | None:
    """顯示名稱唯一的正規化點：建立帳號、總管理者修改、本人修改都走這裡。
    去掉前後空白，空字串存成 NULL（畫面改用 Email）；最多 12 個字，算的是
    字數不是位元組（和 DB 的 VARCHAR(12) 一致）；不收換行與看不見的字元。"""
    if value is None:
        return None
    value = value.strip()
    if not value:
        return None
    if any(_is_hidden_character(ch) for ch in value):
        raise ValueError("顯示名稱不能有換行或看不見的特殊字元")
    if len(value) > DISPLAY_NAME_MAX_LENGTH:
        raise ValueError(f"顯示名稱最多 {DISPLAY_NAME_MAX_LENGTH} 個字")
    return value


DisplayName = Annotated[str | None, AfterValidator(normalize_display_name)]

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


class FeatureFlags(BaseModel):
    """後台依部署開關決定要不要顯示的功能（目前只有招生入學）。"""

    admissions: bool


class LoginResponse(BaseModel):
    csrf_token: str
    user: "UserOut"
    features: FeatureFlags


class MeResponse(BaseModel):
    csrf_token: str
    user: "UserOut"
    features: FeatureFlags
    # 這次登入最晚到什麼時候（登入滿 12 小時，不含閒置逾時）；後台剩 15 分鐘時提醒先儲存。
    session_max_expires_at: datetime | None = None


class UserOut(BaseModel):
    id: uuid.UUID
    email: str
    # 同事看到的名字；沒填時為 null，畫面改用 Email。
    display_name: str | None = None
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
    display_name: DisplayName = None
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


class DisplayNameUpdateRequest(BaseModel):
    """總管理者改同事的顯示名稱，或本人改自己的。一定要帶這個鍵：傳 null 或
    空白是清掉（畫面改用 Email），不會因為漏帶欄位就被清空。"""

    display_name: DisplayName


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
