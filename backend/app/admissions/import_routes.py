"""後台資料匯入 API（2026-10-21 規格 §5–§8；/api/website/v1/admin/admissions/imports/*）。

和 routes.py 同一套規矩：先檢查權限（admissions.stats＝總管理者）、呼叫 service（只 flush）、寫稽核、commit。
稽核的 action、target_type 與 metadata 一律寫字面值（admin labelCoverage 測試會掃），metadata 只放數字、日期與版本。

這個 router 的 422 不回傳輸入值：預設的驗證錯誤會帶 `input`，在這裡就是地址。"""

from __future__ import annotations

import json
from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import academic, imports
from app.admissions.enrolled.importer import EnrolledRosterIn, clear_roster, replace_roster
from app.admissions.enrolled.match import MIN_PLACED_RATIO, MatchError, match_students
from app.admissions.geo import matcher
from app.admissions.history.grid import WorkbookError, masked_headers, parse_grids
from app.admissions.history.importer import replace_history
from app.admissions.history.payload import EnrollmentHistoryIn, build_payload, describe_error, load_payload
from app.admissions.routes import _require_campus
from app.admissions.schemas import (
    EnrolledApplyOut,
    EnrolledClearOut,
    EnrolledImportPayloadOut,
    EnrolledImportUnplacedOut,
    EnrolledPreviewIn,
    EnrolledPreviewOut,
    EnrollmentHistoryPayloadOut,
    HistoryApplyOut,
    HistoryChangeOut,
    HistoryPreviewIn,
    HistoryPreviewOut,
    HistoryTermOut,
    ImportStatusOut,
)
from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.operations import audit_service

MAX_REPORTED_ERRORS = 5


def _bad_key_prefixes(errors: list[dict]) -> set[tuple]:
    """驗不過的字典鍵：loc 以「[key]」結尾，去掉它就是鍵本身的位置。pydantic 對鍵與值各自驗證，
    同一個鍵在值的錯誤位置裡還會原樣出現，所以要先把這些前綴收齊。"""
    return {tuple(item["loc"][:-1]) for item in errors if item["loc"] and item["loc"][-1] == "[key]"}


def _position(item: dict, bad_keys: set[tuple] = frozenset()) -> str:
    """欄位位置；extra_forbidden 的最後一段是上傳資料裡多出來的鍵名（可能就是姓名），不印，改寫「（多餘欄位）」。
    驗不過的字典鍵（bad_keys 的前綴）也是上傳的字串，不論出現在鍵或值的錯誤位置，一律改寫「（鍵）」。
    本文錯誤的位置開頭是 body，對操作的人沒有意義，拿掉。"""
    full = list(item["loc"])
    for prefix in bad_keys:
        if prefix and full[: len(prefix)] == list(prefix):
            full[len(prefix) - 1] = "（鍵）"
    loc = [str(part) for part in full]
    if loc and loc[0] == "body":
        loc = loc[1:]
    if item["type"] == "extra_forbidden" and loc:
        loc[-1] = "（多餘欄位）"
    return ".".join(loc) or "(整份)"


def _describe(errors: list[dict]) -> str:
    """只列欄位位置與錯誤種類（前 5 個），不印輸入值：上傳的資料裡有地址。"""
    bad_keys = _bad_key_prefixes(errors)
    parts = [f"{_position(item, bad_keys)}：{item['type']}" for item in errors[:MAX_REPORTED_ERRORS]]
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


@router.post("/admin/admissions/imports/history/preview", response_model=HistoryPreviewOut)
async def preview_history_import(
    campus_key: str,
    payload: HistoryPreviewIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> HistoryPreviewOut:
    """歷年註冊預覽：瀏覽器送來擷取後的格子表，伺服器用和 CLI 相同的規則解析，回數字摘要、和資料庫現有資料的差異，
    以及原樣送回 apply 即可匯入的 payload。不寫資料庫、不寫稽核；表看不懂的錯誤只回工作表名、欄位名與表頭文字。"""
    _require_campus(current_user, "admissions.stats", campus_key)
    grids = [sheet.to_grid() for sheet in payload.sheets]
    try:
        parsed = parse_grids(grids)
    except WorkbookError as exc:
        headers = [
            {"name": name, "row2": row2, "row3": row3, "labels": labels} for name, row2, row3, labels in masked_headers(grids)
        ]
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": "HISTORY_WORKBOOK_INVALID", "message": str(exc), "headers": headers},
        ) from None
    try:
        history = load_payload(json.dumps(build_payload(parsed, campus_key)))
    except ValidationError as exc:
        raise _rejected("HISTORY_PAYLOAD_INVALID", describe_error(exc)) from None
    removed, changed = await imports.history_diff(db, campus_key, history.rows)
    terms = sorted({(row.school_year, row.semester) for row in history.rows})
    return HistoryPreviewOut(
        rows=len(history.rows),
        first=HistoryTermOut(school_year=terms[0][0], semester=terms[0][1]),
        last=HistoryTermOut(school_year=terms[-1][0], semester=terms[-1][1]),
        removed_terms=[HistoryTermOut(school_year=year, semester=semester) for year, semester in removed],
        changed=[HistoryChangeOut(**item) for item in changed],
        warnings=history.warnings,
        payload=EnrollmentHistoryPayloadOut.model_validate(history.model_dump()),
    )


@router.post("/admin/admissions/imports/history/apply", response_model=HistoryApplyOut)
async def apply_history_import(
    campus_key: str,
    payload: EnrollmentHistoryIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> HistoryApplyOut:
    """確認匯入：本文就是預覽回來的 payload。校區相符才整校取代（同校加 advisory lock）並寫稽核。"""
    _require_campus(current_user, "admissions.stats", campus_key)
    if payload.campus_key != campus_key:
        raise _rejected("CAMPUS_MISMATCH", "資料的校區和選的校區不同，請重新預覽")
    await imports.lock_campus_import(db, "enrollment_history", campus_key)
    count = await replace_history(db, payload)
    terms = sorted({(row.school_year, row.semester) for row in payload.rows})
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="enrollment_history.import",
        target_type="enrollment_history",
        target_id=campus_key,
        campus_key=campus_key,
        metadata={
            "term_rows": count,
            "first_term": imports.term_label(*terms[0]),
            "last_term": imports.term_label(*terms[-1]),
        },
    )
    await db.commit()
    return HistoryApplyOut(rows=count)
