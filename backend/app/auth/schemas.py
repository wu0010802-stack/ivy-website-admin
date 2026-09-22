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

    model_config = {"from_attributes": True}


class UserCreateRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12)
    role: Role
    campus_keys: list[str] = Field(default_factory=list)

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
