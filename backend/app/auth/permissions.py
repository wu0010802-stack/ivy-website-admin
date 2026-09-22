from __future__ import annotations

from fastapi import HTTPException, status

from app.auth.models import Role, User


class ScopeDenied(HTTPException):
    """無權限存取特定物件時統一回 404，避免洩漏物件是否存在。"""

    def __init__(self) -> None:
        super().__init__(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個項目")


class CapabilityDenied(HTTPException):
    """已登入但沒有此能力，回 403（不是特定物件的存取，不需要用 404 掩蓋）。"""

    def __init__(self) -> None:
        super().__init__(status_code=status.HTTP_403_FORBIDDEN, detail="沒有權限執行此操作")


# capability -> 允許的角色
_CAPABILITY_ROLES: dict[str, set[Role]] = {
    "users.manage": {Role.SUPER_ADMIN},
    "campuses.read": {Role.SUPER_ADMIN, Role.CAMPUS_ADMIN, Role.EDITOR, Role.RECEPTION, Role.READONLY},
    "campuses.manage": {Role.SUPER_ADMIN, Role.CAMPUS_ADMIN},
    "media.read": {Role.SUPER_ADMIN, Role.CAMPUS_ADMIN, Role.EDITOR, Role.RECEPTION, Role.READONLY},
    "media.manage": {Role.SUPER_ADMIN, Role.CAMPUS_ADMIN, Role.EDITOR},
    "content.read": {Role.SUPER_ADMIN, Role.CAMPUS_ADMIN, Role.EDITOR, Role.RECEPTION, Role.READONLY},
    "content.manage": {Role.SUPER_ADMIN, Role.CAMPUS_ADMIN, Role.EDITOR},
    "booking.read": {Role.SUPER_ADMIN, Role.CAMPUS_ADMIN, Role.EDITOR, Role.RECEPTION, Role.READONLY},
    "booking.manage": {Role.SUPER_ADMIN, Role.CAMPUS_ADMIN},
    # 批次匯出家長姓名與手機是另一個層級的事，不該跟「看得到案件」綁在
    # 一起——否則階段 D 一上 readonly／reception 角色，他們就自動能把整份
    # 個資下載回家。刻意獨立成一個 capability。
    "booking.export": {Role.SUPER_ADMIN, Role.CAMPUS_ADMIN},
}


def require_scope(user: User, capability: str, campus_keys: list[str] | None = None) -> None:
    """所有 route/service/export/job 共用的權限檢查。

    - `capability` 不在使用者角色允許範圍 → 403（CapabilityDenied）。
    - `campus_keys` 給定時，super_admin 一律通過；其餘角色必須擁有其中
      *所有* campus 的 membership，否則視為「這個物件對你不存在」→ 404
      （ScopeDenied），不要用 403，避免洩漏物件存在性。
    """
    allowed_roles = _CAPABILITY_ROLES.get(capability)
    if allowed_roles is None:
        raise ValueError(f"未知的 capability：{capability}")
    if user.role not in allowed_roles:
        raise CapabilityDenied()

    if campus_keys is None or user.role == Role.SUPER_ADMIN:
        return

    owned = {scope.campus_key for scope in user.campus_scopes}
    if not set(campus_keys).issubset(owned):
        raise ScopeDenied()
