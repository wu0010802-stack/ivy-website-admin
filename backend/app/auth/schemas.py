from __future__ import annotations

import uuid

from pydantic import BaseModel, EmailStr, Field

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


class UserUpdateActiveRequest(BaseModel):
    is_active: bool


class UserUpdateScopeRequest(BaseModel):
    campus_keys: list[str]
