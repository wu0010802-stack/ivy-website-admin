from __future__ import annotations

from fastapi import HTTPException, status

from app.auth.models import SHARED_CONTENT, Role, User


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
    # 規格 7：內容編輯只能送審，發布（含排程、審核核准、還原舊版上線）限
    # 總管理者與分校管理者。
    "content.publish": {Role.SUPER_ADMIN, Role.CAMPUS_ADMIN},
    # 案件含家長與孩子個資。規格「權限」表：內容編輯不讀家長個資，唯讀
    # 不自動擁有案件個資權限——所以只給總管理、分校管理與接待。
    "booking.read": {Role.SUPER_ADMIN, Role.CAMPUS_ADMIN, Role.RECEPTION},
    # 去識別的成效統計（漏斗數字），唯讀角色依規格可以看。
    "analytics.read": {Role.SUPER_ADMIN, Role.CAMPUS_ADMIN, Role.EDITOR, Role.RECEPTION, Role.READONLY},
    "booking.manage": {Role.SUPER_ADMIN, Role.CAMPUS_ADMIN},
    # 批次匯出家長姓名與手機是另一個層級的事，不該跟「看得到案件」綁在
    # 一起——否則階段 D 一上 readonly／reception 角色，他們就自動能把整份
    # 個資下載回家。刻意獨立成一個 capability。
    "booking.export": {Role.SUPER_ADMIN, Role.CAMPUS_ADMIN},
    # 以下是機構層級的決定，只有總管理者能做。集中在這張表裡，路由不再各自
    # 寫 `role != SUPER_ADMIN`，之後要放寬給某個角色時只改一個地方。
    # 停用／重新啟用分校（規格 3.2）。
    "campuses.activate": {Role.SUPER_ADMIN},
    # 補登時把舊案關聯到另一校（規格 6.2：不默默把案件搬到別校）。
    "booking.cross_campus": {Role.SUPER_ADMIN},
    # 不指定校區的全站稽核紀錄；指定校區時改用 booking.read＋校區範圍。
    "audit.read_all": {Role.SUPER_ADMIN},
    "site_settings.manage": {Role.SUPER_ADMIN},
    # 保存政策清理會刪個資，連預覽都限總管理者。
    "retention.manage": {Role.SUPER_ADMIN},
}


def roles_with(capability: str) -> set[Role]:
    """擁有這個 capability 的角色，給 SQL 篩選用（例如列出可承辦案件的人）。"""
    allowed_roles = _CAPABILITY_ROLES.get(capability)
    if allowed_roles is None:
        raise ValueError(f"未知的 capability：{capability}")
    return set(allowed_roles)


def campus_scope(user: User) -> set[str] | None:
    """使用者的校區範圍；None 代表不限（總管理者涵蓋全部校區）。列表類
    端點沒指定校區時用它篩選，不要在路由裡各自判斷角色。"""
    if user.role == Role.SUPER_ADMIN:
        return None
    return {scope.campus_key for scope in user.campus_scopes}


def covers_campus(user: User, campus_key: str) -> bool:
    scope = campus_scope(user)
    return scope is None or campus_key in scope


def has_capability(user: User, capability: str) -> bool:
    allowed_roles = _CAPABILITY_ROLES.get(capability)
    if allowed_roles is None:
        raise ValueError(f"未知的 capability：{capability}")
    return user.role in allowed_roles


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

    if campus_keys is None:
        return
    scope = campus_scope(user)
    if scope is not None and not set(campus_keys).issubset(scope):
        raise ScopeDenied()


def has_grant(user: User, capability: str) -> bool:
    return capability in (user.capabilities or [])


def can_edit_shared_content(user: User) -> bool:
    """共用內容（首頁、頁尾、網站設定…）與共用素材：總管理者，或被明確授予
    content.shared 且角色本來就能編內容的人（內容編輯、分校管理者）。"""
    if user.role == Role.SUPER_ADMIN:
        return True
    return has_grant(user, SHARED_CONTENT) and has_capability(user, "content.manage")


def can_publish_shared_content(user: User) -> bool:
    """發布共用內容：總管理者，或有授權的分校管理者。內容編輯有授權也只能送審。"""
    if user.role == Role.SUPER_ADMIN:
        return True
    return has_grant(user, SHARED_CONTENT) and has_capability(user, "content.publish")
