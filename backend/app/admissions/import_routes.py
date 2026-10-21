"""後台資料匯入 API（2026-10-21 規格 §5、§8；/api/website/v1/admin/admissions/imports/*）。

和 routes.py 同一套規矩：先檢查權限（admissions.stats＝總管理者）、呼叫 service（只 flush）、寫稽核、commit。
稽核的 action、target_type 與 metadata 一律寫字面值（admin labelCoverage 測試會掃），metadata 只放數字、日期與版本。

這個 router 的 422 不回傳輸入值：預設的驗證錯誤會帶 `input`，在這裡就是地址。"""

from __future__ import annotations

from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import academic, imports
from app.admissions.enrolled.importer import EnrolledRosterIn, clear_roster, replace_roster
from app.admissions.enrolled.match import MIN_PLACED_RATIO, MatchError, match_students
from app.admissions.geo import matcher
from app.admissions.routes import _require_campus
from app.admissions.schemas import (
    EnrolledApplyOut,
    EnrolledClearOut,
    EnrolledImportPayloadOut,
    EnrolledImportUnplacedOut,
    EnrolledPreviewIn,
    EnrolledPreviewOut,
    ImportStatusOut,
)
from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.operations import audit_service

MAX_REPORTED_ERRORS = 5


def _position(item: dict) -> str:
    """欄位位置；extra_forbidden 的最後一段是上傳資料裡多出來的鍵名（可能就是姓名），不印，改寫「（多餘欄位）」。
    本文錯誤的位置開頭是 body，對操作的人沒有意義，拿掉。"""
    loc = [str(part) for part in item["loc"]]
    if loc and loc[0] == "body":
        loc = loc[1:]
    if item["type"] == "extra_forbidden" and loc:
        loc[-1] = "（多餘欄位）"
    return ".".join(loc) or "(整份)"


def _describe(errors: list[dict]) -> str:
    """只列欄位位置與錯誤種類（前 5 個），不印輸入值：上傳的資料裡有地址。"""
    parts = [f"{_position(item)}：{item['type']}" for item in errors[:MAX_REPORTED_ERRORS]]
    more = len(errors) - len(parts)
    return "上傳的資料格式不對（" + "；".join(parts) + (f"；另有 {more} 個錯誤" if more > 0 else "") + "）"


class NoEchoValidationRoute(APIRoute):
    """把 RequestValidationError 改成只有位置與種類的 422（INVALID_IMPORT_PAYLOAD），不帶輸入值。
    用 `from None` 切掉原例外，上游的錯誤回報也撿不到 input。"""

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        handler = super().get_route_handler()

        async def no_echo_handler(request: Request) -> Response:
            try:
                return await handler(request)
            except RequestValidationError as exc:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail={"code": "INVALID_IMPORT_PAYLOAD", "message": _describe(exc.errors())},
                ) from None

        return no_echo_handler


router = APIRouter(prefix="/api/website/v1", tags=["admissions"], route_class=NoEchoValidationRoute)


def _rejected(code: str, message: str, status_code: int = status.HTTP_422_UNPROCESSABLE_CONTENT) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message})


@router.get("/admin/admissions/imports/status", response_model=ImportStatusOut)
async def get_import_status(
    campus_key: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> ImportStatusOut:
    """該校目前匯入的在籍清冊與歷年註冊（清冊日期、人數、匯入時間），以及使用中的門牌資料月份。只讀，不寫稽核。"""
    _require_campus(current_user, "admissions.stats", campus_key)
    return ImportStatusOut.model_validate(await imports.import_status(db, campus_key))


@router.post("/admin/admissions/imports/enrolled/preview", response_model=EnrolledPreviewOut)
async def preview_enrolled_import(
    campus_key: str,
    payload: EnrolledPreviewIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> EnrolledPreviewOut:
    """在籍清冊預覽：瀏覽器送來（班別, 地址），伺服器比對後回命中報告與去識別的點位，原樣送回 apply 即可匯入。
    地址比對完就丟：不寫資料庫、不寫稽核、不進日誌與任何回應。"""
    _require_campus(current_user, "admissions.stats", campus_key)
    try:
        outcome = await match_students(
            db,
            [(item.grade, item.address) for item in payload.students],
            campus_key=campus_key,
            roster_date=payload.roster_date,
        )
    except MatchError as exc:
        raise _rejected("ENROLLED_MATCH_FAILED", str(exc)) from None
    summary = outcome.summary
    return EnrolledPreviewOut(
        roster_date=summary.roster_date,
        school_year=summary.school_year,
        doorplate_version=summary.doorplate_label,
        total=summary.total,
        placed=summary.placed,
        placed_ratio=outcome.placed_ratio,
        importable=outcome.placed_ratio >= MIN_PLACED_RATIO,
        levels=summary.levels,
        methods=summary.methods,
        inferred=summary.inferred,
        grades=summary.grades,
        unplaced=[
            EnrolledImportUnplacedOut(match_level=item.match_level, unlocated_reason=item.unlocated_reason, street=item.street)
            for item in summary.unplaced
        ],
        payload=EnrolledImportPayloadOut.model_validate(outcome.payload),
    )


@router.post("/admin/admissions/imports/enrolled/apply", response_model=EnrolledApplyOut)
async def apply_enrolled_import(
    campus_key: str,
    payload: EnrolledRosterIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> EnrolledApplyOut:
    """確認匯入：本文就是預覽回來的去識別點位（沒有地址）。校區相符、有點比例達門檻、門牌版本沒換、學年對得上，
    才整校取代並寫稽核。"""
    _require_campus(current_user, "admissions.stats", campus_key)
    if payload.campus_key != campus_key:
        raise _rejected("CAMPUS_MISMATCH", "資料的校區和選的校區不同，請重新預覽")
    placed_ratio = sum(1 for item in payload.students if item.lat is not None) / len(payload.students)
    if placed_ratio < MIN_PLACED_RATIO:
        raise _rejected("LOW_PLACED_RATIO", "有點的比例不到 90%，不能匯入")
    if payload.doorplate_version != await matcher.doorplate_label(db):
        raise _rejected("DOORPLATE_CHANGED", "門牌已換版，請重新預覽", status.HTTP_409_CONFLICT)
    if payload.school_year != academic.current_term(payload.roster_date)[0]:
        raise _rejected("SCHOOL_YEAR_MISMATCH", "清冊日期和學年對不上，請重新預覽")
    await imports.lock_campus_import(db, "enrolled_roster", campus_key)
    total, placed = await replace_roster(db, payload)
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="enrolled_roster.import",
        target_type="enrolled_roster",
        target_id=campus_key,
        campus_key=campus_key,
        metadata={
            "students": total,
            "placed_students": placed,
            "roster_date": payload.roster_date.isoformat(),
            "doorplate_version": payload.doorplate_version,
        },
    )
    await db.commit()
    return EnrolledApplyOut(students=total, placed=placed)


@router.delete("/admin/admissions/imports/enrolled", response_model=EnrolledClearOut)
async def clear_enrolled_import(
    campus_key: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> EnrolledClearOut:
    """清除該校的在籍資料（清冊與所有點）；本來就沒有資料時不寫稽核，回 removed=false。"""
    _require_campus(current_user, "admissions.stats", campus_key)
    await imports.lock_campus_import(db, "enrolled_roster", campus_key)
    removed = await clear_roster(db, campus_key)
    if removed:
        await audit_service.log_action(
            db,
            actor_user_id=current_user.id,
            action="enrolled_roster.clear",
            target_type="enrolled_roster",
            target_id=campus_key,
            campus_key=campus_key,
        )
    await db.commit()
    return EnrolledClearOut(removed=removed)
