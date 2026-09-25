from __future__ import annotations

from fastapi import HTTPException, status


class SlotFull(Exception):
    """時段名額已滿。"""


class SlotClosed(SlotFull):
    """時段已關閉（園方手動關閉或休假日）。繼承 SlotFull 只是讓舊的
    `except SlotFull` 仍接得住；路由一律用 slot_unavailable() 轉成錯誤碼，
    家長與園方才看得到「已關閉」而不是「額滿」。"""


class SlotNotFound(SlotFull):
    """時段不存在或是別校的（兩者不區分，避免用回應差異探測他校時段）。"""


class InvalidTransition(Exception):
    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


def slot_unavailable(exc: SlotFull, *, subject: str = "這個時段", suffix: str = "") -> HTTPException:
    """SlotFull 家族 → 409 SLOT_FULL／SLOT_CLOSED／SLOT_NOT_FOUND。"""
    if isinstance(exc, SlotClosed):
        code, message = "SLOT_CLOSED", f"{subject}已關閉"
    elif isinstance(exc, SlotNotFound):
        code, message = "SLOT_NOT_FOUND", f"找不到{subject}"
    else:
        code, message = "SLOT_FULL", f"{subject}名額已滿"
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"code": code, "message": f"{message}{suffix}"},
    )
