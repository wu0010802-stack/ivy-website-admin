"""後台案件：列表、匯出、補登、明細、聯絡紀錄與狀態轉換（取消、排除、未到場、完成、改期）。

掛在 booking/routes.py 的 router 底下（prefix 與 tag 由那裡帶），註冊順序照拆分前（2026-10-20）。"""

from __future__ import annotations

import csv
import io
import uuid
from datetime import date

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask
from sqlalchemy import Date, cast, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import ScopeDenied, campus_scope, has_capability, require_scope, roles_with
from app.booking import expected_start as start_rules
from app.booking import (
    access_service,
    attention,
    exclusion,
    export_labels,
    pending_kinds,
    presenters,
    service,
    slot_service,
    status_groups,
    workflow_service,
)
from app.booking.exceptions import slot_unavailable
from app.booking.history import Actor
from app.common import csv_export
from app.common.timezones import OPERATING_TZ, local_day_bounds_utc, today_local
from app.operations import audit_service
from app.booking.models import (
    VisitContactNote,
    VisitRequest,
    VisitRequestEvent,
    VisitRequestSource,
    VisitRequestStatus,
    VisitSlot,
)
from app.booking.schemas import (
    AdminDetailsUpdate,
    AdminDetailsUpdateOut,
    VisitViewCountsOut,
    VisitContactNoteCreateRequest,
    VisitContactNoteOut,
    VisitRequestCancelRequest,
    VisitRequestExcludeRequest,
    VisitRequestDetailOut,
    VisitRequestFullOut,
    VisitRequestManualCreate,
    VisitRequestRescheduleRequest,
    VisitStaffOut,
    has_control_chars,
)
from app.campuses.models import Campus
from app.booking.slot_routes import _slot_audit


router = APIRouter()


# ---------------------------------------------------------------------------
# Visit request workflow / reception workbench
# ---------------------------------------------------------------------------


async def _get_owned_visit_request(db: AsyncSession, user: User, visit_request_id: uuid.UUID) -> VisitRequest:
    result = await db.execute(
        select(VisitRequest)
        .options(selectinload(VisitRequest.slot))
        .where(VisitRequest.id == visit_request_id)
    )
    visit_request = result.scalar_one_or_none()
    if visit_request is None:
        raise ScopeDenied()
    require_scope(user, "booking.read", campus_keys=[visit_request.campus_key])
    return visit_request


async def _lock_for_transition(db: AsyncSession, user: User, visit_request_id: uuid.UUID) -> VisitRequest:
    """狀態轉換用：確認可處理案件後鎖住案件列，重讀狀態與時段。

    稽核的「轉換前」狀態／時段要在鎖內讀。取消、改期是冪等的：家長剛好
    自行取消，或另一位同事剛把案件改到同一個時段時，這次什麼都沒改；拿鎖列之前讀到的舊值比對，會把別人做
    的事記在這位同事名下。workflow_service 內會再鎖一次，同一個交易重複
    鎖同一列不會等待。"""
    visit_request = await _get_owned_visit_request(db, user, visit_request_id)
    require_scope(user, "booking.handle", campus_keys=[visit_request.campus_key])
    await workflow_service.lock_status(db, visit_request)
    loaded_slot_id = visit_request.slot.id if visit_request.slot is not None else None
    if loaded_slot_id != visit_request.slot_id:
        # 重讀只更新 slot_id；時段物件也換成鎖內讀到的那一場，稽核的舊時段
        # 與回應顯示的參觀時間才不會停在別人改期之前。
        await db.refresh(visit_request, attribute_names=["slot"])
    return visit_request


class VisitRequestFilters:
    """案件清單與 CSV 匯出共用的篩選條件。畫面上篩好什麼，匯出的就是那一批；
    原本匯出只看校區，篩好「本週已確認」再匯出會拿到整校案件，多帶出不必要
    的家長個資。"""

    def __init__(
        self,
        campus_key: str | None = None,
        status_filter: str | None = Query(default=None, alias="status"),
        q: str | None = Query(default=None, max_length=100, description="家長或寶貝姓名、電話或 Email 片段"),
        follow_up_due: bool = Query(default=False, description="只列已到預定聯絡時間、尚未結案的案件"),
        source: str | None = Query(default=None, description="案件來源：web／phone／line／walk_in／external"),
        created_from: date | None = Query(default=None, description="送出日期起（含），台灣日期"),
        created_to: date | None = Query(default=None, description="送出日期迄（含），台灣日期"),
        needs_attention: bool = Query(
            default=False,
            description="只列待人工處理：時段已關閉（含休假日）但家長仍要來，或分校已停用但尚未結案",
        ),
        group: str | None = Query(
            default=None,
            pattern="^(upcoming|past|cancelled)$",
            description="案件分組：upcoming 預約正常／past 時間已過／cancelled 已取消",
        ),
        open_only: bool = Query(
            default=False,
            alias="open",
            description="只列還沒結案的：預約正常（含時間已過還沒標記到場）",
        ),
        view: str | None = Query(
            default=None,
            pattern="^(upcoming|past|arrived|cancelled)$",
            description="接待頁籤：upcoming 接下來（台北今天起、未取消）／past 時間已過（已開始、預約正常或未到場）／arrived 已到場／cancelled 已取消",
        ),
        excluded: str | None = Query(
            default=None,
            pattern="^(hide|only)$",
            description="排除標記：hide 隱藏已排除的測試／重複案件、only 只看已排除；不帶＝全部（2026-10-15）",
        ),
    ) -> None:
        self.campus_key = campus_key
        self.status = status_filter
        self.q = q.strip() if q and q.strip() else None
        self.follow_up_due = follow_up_due
        self.source = source
        self.created_from = created_from
        self.created_to = created_to
        self.needs_attention = needs_attention
        self.group = group
        self.open_only = open_only
        self.view = view
        self.excluded = excluded
        # 網址上的 %00 之類一路送到 PostgreSQL 會被拒收成 500；在這裡就回 422。
        if any(isinstance(value, str) and has_control_chars(value) for value in (campus_key, status_filter, q, source)):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="篩選條件含有不允許的控制字元")

    def apply(self, stmt, user: User, capability: str):
        if self.follow_up_due:
            # 與總覽「到期待追蹤」、成效統計同一個定義（booking/pending_kinds.py），
            # 總覽的數字點進來才會是同一批案件。
            stmt = stmt.where(pending_kinds.condition("follow_up_due"))
        if self.needs_attention:
            stmt = stmt.where(attention.needs_attention_condition())
        if self.campus_key:
            require_scope(user, capability, campus_keys=[self.campus_key])
            stmt = stmt.where(VisitRequest.campus_key == self.campus_key)
        elif (scope := campus_scope(user)) is not None:
            stmt = stmt.where(VisitRequest.campus_key.in_(scope))
        if self.status:
            stmt = stmt.where(VisitRequest.status == self.status)
        if self.group:
            stmt = stmt.where(status_groups.group_condition(self.group))
        if self.open_only:
            stmt = stmt.where(status_groups.open_condition())
        if self.view:
            stmt = stmt.where(status_groups.view_condition(self.view))
        if self.excluded == "hide":
            stmt = stmt.where(exclusion.not_excluded())
        elif self.excluded == "only":
            stmt = stmt.where(exclusion.excluded())
        if self.source:
            stmt = stmt.where(VisitRequest.source == self.source)
        if self.created_from is not None:
            stmt = stmt.where(VisitRequest.created_at >= local_day_bounds_utc(self.created_from)[0])
        if self.created_to is not None:
            stmt = stmt.where(VisitRequest.created_at < local_day_bounds_utc(self.created_to)[1])
        if self.q:
            # 櫃台接電話時用姓名或號碼找人。使用者打的 % 與 _ 是字面值，
            # 不跳脫的話一個 % 就會把整個校區的案件全撈出來。
            needle = self.q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            pattern = f"%{needle}%"
            stmt = stmt.where(
                or_(
                    VisitRequest.parent_name.ilike(pattern, escape="\\"),
                    VisitRequest.child_name.ilike(pattern, escape="\\"),
                    VisitRequest.email.ilike(pattern, escape="\\"),
                    VisitRequest.phone.like(pattern, escape="\\"),
                )
            )
        return stmt

    def audit_metadata(self) -> dict:
        """稽核只記套用了哪些條件。搜尋字常常就是家長姓名或手機，只記「有
        搜尋」，不記內容，稽核紀錄不能變成另一份個資。"""
        applied = {
            "status": self.status,
            "group": self.group,
            "view": self.view,
            "excluded": self.excluded,
            "open": True if self.open_only else None,
            "source": self.source,
            "created_from": self.created_from.isoformat() if self.created_from else None,
            "created_to": self.created_to.isoformat() if self.created_to else None,
            "follow_up_due": self.follow_up_due or None,
            "needs_attention": self.needs_attention or None,
            "has_search": True if self.q else None,
        }
        return {key: value for key, value in applied.items() if value is not None}


@router.get("/admin/visit-requests", response_model=list[VisitRequestDetailOut])
async def list_visit_requests(
    filters: VisitRequestFilters = Depends(),
    order: str = Query(
        default="newest",
        pattern="^(newest|oldest|visit_asc|visit_desc)$",
        description="newest／oldest 依送出時間；visit_asc／visit_desc 依參觀日期（沒有日期的排最後）",
    ),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[VisitRequestDetailOut]:
    require_scope(current_user, "booking.read")
    visited_on = _visited_on_column()
    stmt = filters.apply(
        select(VisitRequest, visited_on).options(selectinload(VisitRequest.slot)), current_user, "booking.read"
    )
    stmt = _apply_list_order(stmt, order, visited_on).offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(stmt)
    # 排除的說明只在明細回（計畫裁定 P12）。
    return [
        VisitRequestDetailOut.model_validate(r).model_copy(update={"visited_on": day, "exclude_note": None})
        for r, day in result.all()
    ]


def _visited_on_column():
    """案件列表的參觀日期（相關子查詢，一次查詢帶出整頁，不逐筆查）。有場次用場次日期；
    提早到場、約之後日子的案件釋出了場次，沒有場次、而且已完成，改取最後一筆 completed 歷程的台北日期；
    其餘（取消的舊案等）是 None。"""
    slot_date = (
        select(VisitSlot.slot_date).where(VisitSlot.id == VisitRequest.slot_id).correlate(VisitRequest).scalar_subquery()
    )
    completed_on = (
        select(func.max(cast(func.timezone(OPERATING_TZ.key, VisitRequestEvent.created_at), Date)))
        .where(
            VisitRequestEvent.visit_request_id == VisitRequest.id,
            VisitRequestEvent.event_type == "completed",
            VisitRequest.status == VisitRequestStatus.COMPLETED.value,
        )
        .correlate(VisitRequest)
        .scalar_subquery()
    )
    return func.coalesce(slot_date, completed_on).label("visited_on")


def _apply_list_order(stmt, order: str, visited_on):
    """列表排序。最後都補 id，同一時間的案件在翻頁時不會重複或漏掉。"""
    if order in ("visit_asc", "visit_desc"):
        # 行程清單（2026-10-06 方向 B）：依參觀日期（visited_on）與場次開始時間。沒有日期的舊案排最後；
        # 同一天內，有場次的依開始時間排，沒有場次的（提早到場釋出了場次）不論遞增遞減都排在那天最後。
        # join 用別名：篩選條件裡 `slot_id IN (SELECT visit_slots.id …)` 的子查詢才不會被自動關聯到這個 join。
        slot = aliased(VisitSlot)
        stmt = stmt.outerjoin(slot, slot.id == VisitRequest.slot_id)
        if order == "visit_asc":
            return stmt.order_by(
                visited_on.asc().nulls_last(), slot.start_time.asc().nulls_last(),
                VisitRequest.created_at.asc(), VisitRequest.id.asc(),
            )
        return stmt.order_by(
            visited_on.desc().nulls_last(), slot.start_time.desc().nulls_last(),
            VisitRequest.created_at.desc(), VisitRequest.id.desc(),
        )
    if order == "oldest":
        return stmt.order_by(VisitRequest.created_at.asc(), VisitRequest.id.asc())
    return stmt.order_by(VisitRequest.created_at.desc(), VisitRequest.id.desc())


@router.get("/admin/visit-requests/view-counts", response_model=VisitViewCountsOut)
async def visit_request_view_counts(
    filters: VisitRequestFilters = Depends(),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitViewCountsOut:
    """接待頁籤上的數字：套用同一組篩選（頁籤、分組、狀態除外）。時間已過只數還沒標記到場的，
    和總覽、成效統計同一個條件（pending_kinds.awaiting_attendance），數字點進去才是同一批。"""
    require_scope(current_user, "booking.read")
    filters.status = None
    filters.group = None
    filters.view = None
    base = filters.apply(select(func.count()).select_from(VisitRequest), current_user, "booking.read")
    upcoming = (await db.execute(base.where(status_groups.view_condition("upcoming")))).scalar_one()
    unmarked = (await db.execute(base.where(pending_kinds.condition("awaiting_attendance")))).scalar_one()
    return VisitViewCountsOut(upcoming=upcoming, past_unmarked=unmarked)


def _export_row(r: VisitRequest) -> list[str]:
    return [
        csv_export.safe_cell(export_labels.campus_label(r.campus_key)),
        csv_export.safe_cell(export_labels.status_label(r.status)),
        csv_export.safe_cell(export_labels.source_label(r.source)),
        csv_export.safe_cell(r.parent_name),
        csv_export.safe_cell(export_labels.format_phone(r.phone)),
        r.created_at.astimezone(OPERATING_TZ).strftime("%Y/%m/%d %H:%M"),
        csv_export.safe_cell(r.child_name),
        r.child_birthdate.strftime("%Y/%m/%d") if r.child_birthdate else "",
        csv_export.safe_cell(r.email),
        csv_export.safe_cell(export_labels.referral_label(r.referral_sources)),
        # 舊案件沒有人數，留空。
        str(r.party_size) if r.party_size is not None else "",
        # 預計入學時間（2026-10-15）：沒選留空；「盡快」換算送單當時的學期。
        start_rules.display_label(r.expected_start, r.created_at.astimezone(OPERATING_TZ).date()) if r.expected_start else "",
        r.slot.slot_date.strftime("%Y/%m/%d") if r.slot else "",
        r.slot.start_time.strftime("%H:%M") if r.slot else "",
        r.slot.end_time.strftime("%H:%M") if r.slot else "",
        export_labels.exclude_label(r.exclude_reason),
    ]


# 匯出一批從資料庫取幾筆、輸出一個 chunk 幾筆。
_EXPORT_BATCH = 500


async def _stream_export_csv(snapshot: AsyncSession, stmt):
    """邊讀邊產生 CSV。snapshot 是匯出專用的獨立 session，讀完或中斷（客戶端
    斷線）都在這裡關閉；串流還沒開始就斷線時由回應的 background 關。

    給園方用 Excel 直接開：中文欄名與代碼對照、台北時間；開頭加 BOM，Excel 才
    認得是 UTF-8，不然中文整份亂碼。每個欄位只出現一次（同名欄位在樞紐分析或
    匯入其他系統時會混淆）。"""
    try:
        buffer = io.StringIO()
        writer = csv.writer(buffer)
        writer.writerow(export_labels.EXPORT_HEADERS)
        rows = await snapshot.stream_scalars(stmt.execution_options(yield_per=_EXPORT_BATCH))
        pending = 0
        first = True
        async for r in rows:
            writer.writerow(_export_row(r))
            pending += 1
            if pending >= _EXPORT_BATCH:
                yield ((csv_export.BOM if first else "") + buffer.getvalue()).encode("utf-8")
                first = False
                buffer.seek(0)
                buffer.truncate()
                pending = 0
        yield ((csv_export.BOM if first else "") + buffer.getvalue()).encode("utf-8")
    finally:
        await snapshot.close()


@router.get("/admin/visit-requests/export", response_class=Response, responses=csv_export.CSV_RESPONSES)
async def export_visit_requests(
    request: Request,
    filters: VisitRequestFilters = Depends(),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> Response:
    """依畫面上目前的篩選條件匯出（不分頁）。"""
    # 串流輸出，不一次把全部案件載進記憶體。筆數與內容取自同一個
    # REPEATABLE READ 快照（匯出專用的獨立 session，交易生命週期跟回應一樣長，
    # 不能用請求注入的 session——它可能在串流完成前就關了），稽核紀錄在送出
    # 第一個位元組之前寫好並 commit，筆數就是快照內實際會輸出的筆數。串流匯出沒有「先組好整份檔案」
    # 這一步（chunk 邊讀邊組，不一次放進記憶體），所以不像招生兩支匯出（admissions/routes.py）把
    # csv_attachment 排在稽核之前；commit 之後只剩建立回應物件（產生器要到送出 chunk 才會執行）。
    require_scope(current_user, "booking.export")
    base = filters.apply(select(VisitRequest), current_user, "booking.export")
    stmt = base.options(selectinload(VisitRequest.slot)).order_by(VisitRequest.created_at.desc())

    snapshot = request.app.state.session_factory()
    try:
        await snapshot.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        exported = (await snapshot.execute(select(func.count()).select_from(base.subquery()))).scalar_one()

        # 個資批次外流一定要留痕：誰、什麼時候、用什麼條件匯出了哪個校區的幾筆。
        await audit_service.log_action(
            db,
            actor_user_id=current_user.id,
            action="visit_request.export",
            target_type="visit_request",
            target_id=filters.campus_key or "all",
            campus_key=filters.campus_key,
            metadata={"row_count": exported, **filters.audit_metadata()},
        )
        await db.commit()
    except BaseException:
        await snapshot.close()
        raise
    # 一律當附件下載，且不進瀏覽器快取：共用櫃台電腦上，含全校家長姓名與
    # 手機的 CSV 不能留在磁碟快取或上一頁紀錄裡（稽核 admin-booking-api-no-store-missing）。
    # 檔名只放安全字元，篩選值不直接進 header。
    filename = f"visit-requests-{csv_export.filename_part(filters.campus_key)}-{today_local():%Y%m%d}.csv"
    return StreamingResponse(
        _stream_export_csv(snapshot, stmt),
        media_type="text/csv; charset=utf-8",
        # close 可重複呼叫：產生器跑完已關的話這裡什麼都不做
        background=BackgroundTask(snapshot.close),
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "private, no-store",
        },
    )


@router.post(
    "/admin/visit-requests",
    response_model=VisitRequestDetailOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_manual_visit_request(
    payload: VisitRequestManualCreate,
    response: Response,
    request: Request,
    idempotency_key: str = Header(alias="Idempotency-Key", min_length=1, max_length=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    """人工補登。一律當場排入場次（建立即是已確認），可再寫第一筆聯絡
    紀錄；在同一個交易，任何一步失敗（例如時段剛好額滿）整筆不建立，
    人員改完再送一次即可。"""
    require_scope(current_user, "booking.handle", campus_keys=[payload.campus_key])
    result = await db.execute(select(Campus).where(Campus.key == payload.campus_key))
    campus = result.scalar_one_or_none()
    if campus is None or not campus.active:
        raise ScopeDenied()
    related = None
    if payload.related_request_id is not None:
        related = await _get_owned_visit_request(db, current_user, payload.related_request_id)
        if related.campus_key != payload.campus_key and not has_capability(current_user, "booking.cross_campus"):
            # 規格 6.2：不默默把案件搬到另一校；跨校關聯須總管理者權限。
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="跨校關聯舊案需要總管理者權限",
            )

    body = payload.model_dump(mode="json", exclude={"campus_key"})
    try:
        visit_request, is_new = await service.create_manual_visit_request(
            db,
            campus_key=payload.campus_key,
            idempotency_key=idempotency_key,
            payload=body,
            source=VisitRequestSource(payload.source),
            created_by=current_user.id,
            hash_key=service.payload_hash_key(request.app.state.settings.session_secret),
            slot_id=payload.slot_id,
        )
    except service.IdempotencyConflict as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "IDEMPOTENCY_CONFLICT", "message": "這張表單已經送出過不同的內容，請重新開啟補登"},
        ) from exc
    except workflow_service.SlotFull as exc:
        await db.rollback()
        raise slot_unavailable(exc, suffix="，案件尚未建立") from exc
    except slot_service.SlotNotBookable as exc:
        await db.rollback()
        raise _slot_not_bookable(exc, suffix="，案件尚未建立") from exc

    if is_new:
        if related is not None:
            # 結案後重新預約：新案指回舊案，兩邊歷程都留痕。
            visit_request.related_request_id = related.id
            actor = Actor.staff(current_user.id)
            workflow_service.record_event(
                db, visit_request.id, "linked_from_previous", actor=actor,
                after={"related_request_id": str(related.id)},
            )
            workflow_service.record_event(
                db, related.id, "rebooked_as_new", actor=actor,
                after={"related_request_id": str(visit_request.id)},
            )
        await access_service.ensure_access_token(
            db,
            visit_request.id,
            secret=request.app.state.settings.session_secret,
            slot=visit_request.slot,
            actor=Actor.staff(current_user.id),
        )
        if payload.note and payload.note.strip():
            await workflow_service.add_contact_note(
                db,
                visit_request,
                note=payload.note.strip(),
                follow_up_at=None,
                created_by=current_user.id,
            )
        await audit_service.log_action(
            db,
            actor_user_id=current_user.id,
            action="visit_request.manual_create",
            target_type="visit_request",
            target_id=str(visit_request.id),
            campus_key=payload.campus_key,
            metadata={
                "source": payload.source,
                "with_slot": payload.slot_id is not None,
                "related_request_id": str(related.id) if related is not None else None,
            },
        )
    await db.commit()
    response.status_code = status.HTTP_201_CREATED if is_new else status.HTTP_200_OK
    result = await db.execute(
        select(VisitRequest)
        .options(selectinload(VisitRequest.slot))
        .where(VisitRequest.id == visit_request.id)
        .execution_options(populate_existing=True)
    )
    return VisitRequestDetailOut.model_validate(result.scalar_one())


@router.get("/admin/visit-staff", response_model=list[VisitStaffOut])
async def list_visit_staff(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[VisitStaffOut]:
    """處理參觀案件的同事（booking.handle：總管理者、分校管理者、接待人員），
    畫面用來把登錄的人、聯絡紀錄與歷程裡的 id 翻成名字。
    非總管理者只看得到總管理者與跟自己有共同校區的同事，不藉這個清單看出
    其他校的人員配置。"""
    require_scope(current_user, "booking.read")
    result = await db.execute(
        select(User)
        .options(selectinload(User.campus_scopes))
        .where(User.role.in_(roles_with("booking.handle")))
        .order_by(User.email)
    )
    own = campus_scope(current_user)
    staff = []
    for user in result.scalars():
        keys = sorted(s.campus_key for s in user.campus_scopes)
        if campus_scope(user) is None:
            keys = []
        elif own is not None and not own.intersection(keys):
            continue
        elif own is not None:
            keys = sorted(own.intersection(keys))
        staff.append(
            VisitStaffOut(
                id=user.id,
                email=user.email,
                display_name=user.display_name,
                role=user.role.value,
                campus_keys=keys,
                is_active=user.is_active,
            )
        )
    return staff


@router.get("/admin/visit-requests/{visit_request_id}", response_model=VisitRequestFullOut)
async def get_visit_request(
    visit_request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestFullOut:
    """案件明細：案件本身＋歷程（誰、何時、異動前後、原因）、家長管理連結
    是否有效（規格 L299）。"""
    visit_request = await _get_owned_visit_request(db, current_user, visit_request_id)
    return await presenters.full_detail(db, visit_request)


@router.get("/admin/visit-requests/{visit_request_id}/contact-notes", response_model=list[VisitContactNoteOut])
async def list_contact_notes(
    visit_request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> list[VisitContactNoteOut]:
    await _get_owned_visit_request(db, current_user, visit_request_id)
    result = await db.execute(
        select(VisitContactNote, User.email, User.display_name)
        .outerjoin(User, User.id == VisitContactNote.created_by)
        .where(VisitContactNote.visit_request_id == visit_request_id)
        .order_by(VisitContactNote.created_at.desc())
    )
    return [
        VisitContactNoteOut.model_validate(note).model_copy(
            update={"created_by_email": email, "created_by_display_name": display_name}
        )
        for note, email, display_name in result.all()
    ]


@router.post(
    "/admin/visit-requests/{visit_request_id}/contact-notes",
    response_model=VisitContactNoteOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_contact_note(
    visit_request_id: uuid.UUID,
    payload: VisitContactNoteCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitContactNoteOut:
    visit_request = await _get_owned_visit_request(db, current_user, visit_request_id)
    require_scope(current_user, "booking.handle", campus_keys=[visit_request.campus_key])
    try:
        await workflow_service.lock_editable(
            db, visit_request, payload.expected_version if payload.changes_follow_up else None
        )
    except workflow_service.VersionConflict as exc:
        await db.rollback()
        raise _version_conflict(exc) from exc
    # 聯絡內容是常含姓名、電話的自由文字：已依保存政策匿名化的案件不再收，否則
    # 案件標成已匿名化，個資卻又寫回關聯表、要等下一輪清理才補清。
    if visit_request.anonymized_at is not None:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "VISIT_REQUEST_ANONYMIZED", "message": "這筆預約已依保存政策匿名化，不能再新增聯絡紀錄"},
        )
    # 已到場、已取消的案件不列入「到期待追蹤」（pending_kinds.follow_up_due）：設了下次聯絡
    # 也永遠不會出現，直接擋下（2026-10-04 參觀後追蹤規格 6.6）。清除與單純記錄照舊。
    if payload.follow_up_at is not None and visit_request.status in pending_kinds.FOLLOW_UP_UNTRACKED_STATUSES:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "FOLLOW_UP_NOT_TRACKED",
                "message": "已到場或已取消的案件不會列入到期待追蹤；參觀後的追蹤請記在招生訪視",
            },
        )
    note = await workflow_service.add_contact_note(
        db,
        visit_request,
        note=payload.note,
        follow_up_at=payload.follow_up_at,
        clear_follow_up=payload.clears_follow_up,
        created_by=current_user.id,
    )
    # 聯絡內容是自由文字、常含家長個資，稽核只記「誰在何時記了一筆」與
    # 有沒有改下次聯絡時間。
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="visit_request.add_contact_note",
        target_type="visit_request",
        target_id=str(visit_request.id),
        campus_key=visit_request.campus_key,
        metadata={
            "note_id": str(note.id),
            "follow_up_set": payload.follow_up_at is not None,
            **({"follow_up_cleared": True} if payload.clears_follow_up else {}),
        },
    )
    await db.commit()
    return VisitContactNoteOut.model_validate(note).model_copy(
        update={"created_by_email": current_user.email, "created_by_display_name": current_user.display_name}
    )


@router.patch("/admin/visit-requests/{visit_request_id}/details", response_model=AdminDetailsUpdateOut)
async def update_visit_request_details(
    visit_request_id: uuid.UUID,
    payload: AdminDetailsUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> AdminDetailsUpdateOut:
    """後台人員修改家長資料（2026-10-12 規格 3.1、3.2）：稱呼、手機、Email、孩子姓名與生日，
    以及預計入學時間（2026-10-15，只改預約，不同步招生的入學學期）。
    任何狀態都能改（已匿名化 409），不受家長端的異動期限限制；expected_version 是案件的
    details_version，和家長端共用，兩邊同時改後送者 409。招生入學開啟時，招生訪視上仍是
    當初帶過去的值一起改，招生端另外改過的不動。歷程與稽核只記欄位名。"""
    visit_request = await _get_owned_visit_request(db, current_user, visit_request_id)
    require_scope(current_user, "booking.handle", campus_keys=[visit_request.campus_key])
    try:
        result = await workflow_service.update_details_by_staff(
            db,
            visit_request,
            payload.changes(),
            expected_version=payload.expected_version,
            actor=Actor.staff(current_user.id),
            admissions_enabled=request.app.state.settings.admissions_enabled,
            access_secret=request.app.state.settings.session_secret,
        )
    except workflow_service.VersionConflict as exc:
        await db.rollback()
        raise _version_conflict(exc, "家長或同事剛改過這筆資料，請重新載入後再改") from exc
    except workflow_service.DetailsAnonymized as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "VISIT_REQUEST_ANONYMIZED", "message": "這筆預約已依保存政策匿名化，不能再修改資料"},
        ) from exc
    if result.changed:
        # 稽核只記欄位名；內容在案件本身，不複製進稽核。
        await audit_service.log_action(
            db,
            actor_user_id=current_user.id,
            action="visit_request.update_details",
            target_type="visit_request",
            target_id=str(visit_request.id),
            campus_key=visit_request.campus_key,
            metadata={"fields": result.changed},
        )
    await db.commit()
    detail = await presenters.full_detail(db, visit_request)
    return AdminDetailsUpdateOut(
        **detail.model_dump(),
        changed_fields=result.changed,
        admissions_synced_fields=result.admissions_synced,
        admissions_skipped_fields=result.admissions_skipped,
        email_notified=result.email_notified,
        access_link_reset=result.access_link_reset,
    )


@router.post("/admin/visit-requests/{visit_request_id}/cancel", response_model=VisitRequestDetailOut)
async def cancel_visit_request(
    visit_request_id: uuid.UUID,
    payload: VisitRequestCancelRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    """本文可省略；有填原因就記在案件歷程。"""
    visit_request = await _lock_for_transition(db, current_user, visit_request_id)
    before_status = visit_request.status
    reason = payload.reason if payload else None
    try:
        await workflow_service.cancel(db, visit_request, actor=Actor.staff(current_user.id), reason=reason)
    except workflow_service.InvalidTransition as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "INVALID_TRANSITION", "message": exc.message},
        ) from exc
    await _audit_transition(
        db,
        current_user,
        visit_request,
        before_status,
        action="visit_request.cancel",
        has_reason=bool(reason and reason.strip()),
    )
    await db.commit()
    return VisitRequestDetailOut.model_validate(visit_request)


@router.post("/admin/visit-requests/{visit_request_id}/exclude", response_model=VisitRequestDetailOut)
async def exclude_visit_request(
    visit_request_id: uuid.UUID,
    payload: VisitRequestExcludeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    """標記為排除（2026-10-15 規格 §3.2）：booking.manage＋校區範圍。不改狀態、不釋出名額；
    操作紀錄只記原因類別（說明可能有人名）。"""
    visit_request = await _get_owned_visit_request(db, current_user, visit_request_id)
    require_scope(current_user, "booking.manage", campus_keys=[visit_request.campus_key])
    try:
        await exclusion.exclude(
            db, visit_request, reason=payload.reason, note=payload.note, actor=Actor.staff(current_user.id)
        )
    except exclusion.AlreadyExcluded as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail={"code": "ALREADY_EXCLUDED", "message": "這筆案件已經排除了"}
        ) from exc
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="visit_request.exclude",
        target_type="visit_request",
        target_id=str(visit_request.id),
        campus_key=visit_request.campus_key,
        metadata={"exclude_reason": payload.reason},
    )
    await db.commit()
    return VisitRequestDetailOut.model_validate(visit_request)


@router.post("/admin/visit-requests/{visit_request_id}/include", response_model=VisitRequestDetailOut)
async def include_visit_request(
    visit_request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    """取消排除，回到原本的統計（規格 E4）。"""
    visit_request = await _get_owned_visit_request(db, current_user, visit_request_id)
    require_scope(current_user, "booking.manage", campus_keys=[visit_request.campus_key])
    try:
        previous = await exclusion.include(db, visit_request, actor=Actor.staff(current_user.id))
    except exclusion.NotExcluded as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail={"code": "NOT_EXCLUDED", "message": "這筆案件沒有排除"}
        ) from exc
    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="visit_request.include",
        target_type="visit_request",
        target_id=str(visit_request.id),
        campus_key=visit_request.campus_key,
        metadata={"exclude_reason": previous},
    )
    await db.commit()
    return VisitRequestDetailOut.model_validate(visit_request)


@router.post("/admin/visit-requests/{visit_request_id}/no-show", response_model=VisitRequestDetailOut)
async def mark_no_show(
    visit_request_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    visit_request = await _lock_for_transition(db, current_user, visit_request_id)
    before_status = visit_request.status
    try:
        await workflow_service.mark_no_show(db, visit_request, actor=Actor.staff(current_user.id))
    except workflow_service.InvalidTransition as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "INVALID_TRANSITION", "message": exc.message},
        ) from exc
    await _audit_transition(db, current_user, visit_request, before_status, action="visit_request.no_show")
    await db.commit()
    return VisitRequestDetailOut.model_validate(visit_request)


@router.post("/admin/visit-requests/{visit_request_id}/complete", response_model=VisitRequestDetailOut)
async def mark_completed(
    visit_request_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    """家長依約來參觀了。狀態機早就有 completed（規格 6.2），只是一直
    沒有路由，已確認的案件只能停在「已確認」或被標成未到場。招生入學開啟時
    同一個交易建立招生訪視（WEBSITE_ADMISSIONS_ENABLED，預設關閉）。"""
    return await _complete(db, request, current_user, visit_request_id, allow_early=False)


@router.post("/admin/visit-requests/{visit_request_id}/complete-early", response_model=VisitRequestDetailOut)
async def mark_completed_early(
    visit_request_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    """家長比預約的場次早到（2026-10-12 使用者裁定）：不等場次開始就標記已到場。
    約的是之後的日子會釋出那一場的名額，見 workflow_service.mark_completed。
    /complete 照舊要等場次開始，免得誤按占住未來的名額；場次已經開始才按這個，
    就是一般的標記已到場。"""
    return await _complete(db, request, current_user, visit_request_id, allow_early=True)


async def _complete(
    db: AsyncSession, request: Request, current_user: User, visit_request_id: uuid.UUID, *, allow_early: bool
) -> VisitRequestDetailOut:
    visit_request = await _lock_for_transition(db, current_user, visit_request_id)
    before_status = visit_request.status
    early = allow_early and workflow_service.arrives_early(visit_request.slot)
    try:
        await workflow_service.mark_completed(
            db,
            visit_request,
            actor=Actor.staff(current_user.id),
            admissions_enabled=request.app.state.settings.admissions_enabled,
            early=early,
        )
    except workflow_service.InvalidTransition as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "INVALID_TRANSITION", "message": exc.message},
        ) from exc
    await _audit_transition(
        db,
        current_user,
        visit_request,
        before_status,
        action="visit_request.complete_early" if early else "visit_request.complete",
    )
    await db.commit()
    return VisitRequestDetailOut.model_validate(visit_request)


@router.post("/admin/visit-requests/{visit_request_id}/reschedule", response_model=VisitRequestDetailOut)
async def reschedule_visit_request(
    visit_request_id: uuid.UUID,
    payload: VisitRequestRescheduleRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> VisitRequestDetailOut:
    """已確認的案件換時段（規格 L209、L211）：案件 id 不變、歷程記前後
    時段與原因，新時段額滿／關閉／已開始時整筆回滾、原預約不動。"""
    visit_request = await _lock_for_transition(db, current_user, visit_request_id)
    # 鎖內讀到的時段；別人剛改到同一場時 reschedule 什麼都不改，這裡也不記。
    old_slot = visit_request.slot
    try:
        await workflow_service.reschedule(
            db, visit_request, payload.new_slot_id, actor=Actor.staff(current_user.id), reason=payload.reason
        )
    except workflow_service.SlotFull as exc:
        await db.rollback()
        raise slot_unavailable(exc, subject="新時段", suffix="，原時段維持不變") from exc
    except slot_service.SlotNotBookable as exc:
        await db.rollback()
        raise _slot_not_bookable(exc, suffix="，原時段維持不變") from exc
    except workflow_service.InvalidTransition as exc:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "INVALID_TRANSITION", "message": exc.message},
        ) from exc
    if old_slot is None or visit_request.slot_id != old_slot.id:
        await audit_service.log_action(
            db,
            actor_user_id=current_user.id,
            action="visit_request.reschedule",
            target_type="visit_request",
            target_id=str(visit_request.id),
            campus_key=visit_request.campus_key,
            metadata={
                "from_slot": _slot_audit(old_slot),
                "to_slot": _slot_audit(visit_request.slot),
                "has_reason": bool(payload.reason and payload.reason.strip()),
            },
        )
    await db.commit()
    return VisitRequestDetailOut.model_validate(visit_request)


def _version_conflict(
    exc: workflow_service.VersionConflict, message: str = "這筆案件的下次聯絡時間剛被其他人修改，請重新載入後再操作"
) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"code": "VISIT_REQUEST_VERSION_CONFLICT", "message": message, "current_version": exc.current_version},
    )


async def _audit_transition(
    db: AsyncSession, user: User, visit_request: VisitRequest, before_status: str, *, action: str, **extra
) -> None:
    """狀態轉換的稽核。取消、開始聯絡是冪等的（已是該狀態直接回傳），狀態
    沒變就不記。before_status 要取自 _lock_for_transition 鎖內重讀的狀態。
    action 一律在呼叫端寫字面值（labelCoverage 測試會掃）。"""
    if visit_request.status == before_status:
        return
    await audit_service.log_action(
        db,
        actor_user_id=user.id,
        action=action,
        target_type="visit_request",
        target_id=str(visit_request.id),
        campus_key=visit_request.campus_key,
        metadata={"from_status": before_status, "to_status": visit_request.status, **extra},
    )


def _slot_not_bookable(exc: slot_service.SlotNotBookable, *, suffix: str = "") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"code": "SLOT_NOT_BOOKABLE", "message": f"{exc.message}{suffix}"},
    )


def _invalid_transition(exc: workflow_service.InvalidTransition) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail={"code": "INVALID_TRANSITION", "message": exc.message},
    )
