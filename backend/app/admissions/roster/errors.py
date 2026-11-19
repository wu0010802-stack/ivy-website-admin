"""編班表 service 丟的例外；路由把它轉成 HTTP 錯誤（detail 帶 code 與 message）。"""

from __future__ import annotations

from fastapi import HTTPException


class RosterError(Exception):
    def __init__(self, status_code: int, code: str, message: str, **extra: object) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.extra = extra

    def to_http(self) -> HTTPException:
        return HTTPException(
            status_code=self.status_code, detail={"code": self.code, "message": self.message, **self.extra}
        )


def version_conflict(current_version: int, what: str) -> RosterError:
    return RosterError(
        409,
        "ROSTER_VERSION_CONFLICT",
        f"這{what}剛被其他人修改，請重新載入後再操作",
        current_version=current_version,
    )
