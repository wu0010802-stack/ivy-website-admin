"""參觀後追蹤（docs/specs/2026-10-04-admissions-follow-up-design.md）。

- condition：追蹤三種狀態（due／upcoming／unscheduled，規格 6.2）。待追蹤清單、訪視明細
  篩選、總覽計數都從這裡取條件，數字點進清單才會是同一批（比照 booking/pending_kinds.py）。
- initial_fields：建檔時帶入的追蹤欄位（規格 6.1）。不自動排第一次聯絡（F-Q1）：只沿用
  預約上還沒到的下次聯絡，負責人取這次操作的人。
- add_contact_log：記錄聯絡（規格 6.3）；update_follow_up：只改下次聯絡或負責人（規格 6.4）。
- follow_up_list、due_counts、eligible_staff：待追蹤分頁、總覽與負責人選單。

只 flush、丟自訂例外；權限、稽核與 commit 在 routes.py。呼叫寫入函式前，路由已用
records.get_visit_for_update 鎖列並擋掉已匿名化的訪視。"""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.admissions import constants, records
from app.admissions.funnel import derive_stage
from app.admissions.models import RecruitmentContactLog, RecruitmentVisit
from app.auth.models import User
from app.auth.permissions import covers_campus, has_capability, roles_with

# 送來的聯絡時間比伺服器時間晚這麼多以內，當成時鐘誤差、改用現在；再晚就是未來的時間。
CONTACTED_AT_TOLERANCE = timedelta(minutes=2)
FOLLOW_UP_LIST_PAGE_SIZE_MAX = 100


class FollowUpInPast(Exception):
    """下次聯絡不晚於現在（422 FOLLOW_UP_IN_PAST）。"""


class FollowUpNotAllowed(Exception):
    """已註冊或已退出的訪視排下次聯絡（422 FOLLOW_UP_NOT_ALLOWED）。"""


class ContactedAtInFuture(Exception):
    """聯絡時間晚於現在（422 CONTACTED_AT_IN_FUTURE）。"""


class OwnerInvalid(Exception):
    """負責人不能指派（422 FOLLOW_UP_OWNER_INVALID）；message 給畫面直接顯示。"""

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def open_condition():
    """還在追的訪視：未匿名化、未註冊、未退出（已訪視或已預繳）。"""
    return and_(
        RecruitmentVisit.anonymized_at.is_(None),
        RecruitmentVisit.enrolled.is_(False),
        RecruitmentVisit.withdrawn_at.is_(None),
    )


def condition(kind: str, now: datetime | None = None):
    """規格 6.2。upcoming 只算 UPCOMING_WINDOW_DAYS 天內。"""
    current = now or _now()
    if kind == "due":
        return and_(open_condition(), RecruitmentVisit.follow_up_at.is_not(None), RecruitmentVisit.follow_up_at <= current)
    if kind == "upcoming":
        return and_(
            open_condition(),
            RecruitmentVisit.follow_up_at > current,
            RecruitmentVisit.follow_up_at <= current + timedelta(days=constants.UPCOMING_WINDOW_DAYS),
        )
    if kind == "unscheduled":
        return and_(open_condition(), RecruitmentVisit.follow_up_at.is_(None))
    raise ValueError(f"未知的追蹤狀態：{kind}")


def owner_condition(owner: str | None, current_user_id: uuid.UUID):
    """負責人篩選：me＝自己、none＝未指派、其他是帳號 id（呼叫端已驗證格式）；None＝不篩。"""
    if owner is None:
        return None
    if owner == "me":
        return RecruitmentVisit.follow_up_owner_id == current_user_id
    if owner == "none":
        return RecruitmentVisit.follow_up_owner_id.is_(None)
    return RecruitmentVisit.follow_up_owner_id == uuid.UUID(owner)


def is_open(visit: RecruitmentVisit) -> bool:
    return visit.anonymized_at is None and derive_stage(visit) in ("visited", "deposited")


def owner_problem(user: User | None, campus_key: str) -> str | None:
    """不能當這個校區負責人的原因；可以就回 None。user 要已載入 campus_scopes。
    文案比照後台其他指派（停用、沒權限、沒有這個校區）。"""
    if user is None:
        return "找不到這個帳號"
    if not user.is_active:
        return "這個帳號已停用，不能指派"
    if not has_capability(user, "admissions.write"):
        return "這個帳號沒有招生入學的權限"
    if not covers_campus(user, campus_key):
        return "這個帳號沒有這個校區的權限"
    return None


async def _load_users(db: AsyncSession, user_ids: list[uuid.UUID]) -> dict[uuid.UUID, User]:
    if not user_ids:
        return {}
    result = await db.execute(select(User).options(selectinload(User.campus_scopes)).where(User.id.in_(user_ids)))
    return {user.id: user for user in result.scalars()}


async def initial_fields(
    db: AsyncSession,
    *,
    campus_key: str,
    booking_follow_up_at: datetime | None,
    owner_candidates: list[uuid.UUID | None],
    now: datetime | None = None,
) -> dict:
    """建檔時的 follow_up_at 與 follow_up_owner_id（規格 6.1）。

    - 下次聯絡：預約上的有值且晚於現在就沿用，其他情況 None（不自動排，F-Q1）。
    - 負責人：owner_candidates 依序第一個「啟用中、有 admissions.write、涵蓋該校區」的
      帳號；都不符合為 None。
    不丟例外：在「標記已到場」的交易內呼叫，查詢以外不做會失敗的事。"""
    current = now or _now()
    follow_up_at = booking_follow_up_at if booking_follow_up_at is not None and booking_follow_up_at > current else None
    ids = [candidate for candidate in owner_candidates if candidate is not None]
    users = await _load_users(db, list(dict.fromkeys(ids)))
    owner_id = next((candidate for candidate in ids if owner_problem(users.get(candidate), campus_key) is None), None)
    return {"follow_up_at": follow_up_at, "follow_up_owner_id": owner_id}


def _check_next_follow_up(visit: RecruitmentVisit, value: datetime | None, now: datetime) -> None:
    if value is None:
        return
    if not is_open(visit):
        raise FollowUpNotAllowed()
    if value <= now:
        raise FollowUpInPast()


async def add_contact_log(
    db: AsyncSession,
    visit: RecruitmentVisit,
    *,
    expected_version: int,
    channel: str,
    reached: bool,
    note: str | None,
    next_follow_up_at: datetime | None,
    contacted_at: datetime | None = None,
    update_parent_response: bool = False,
    actor_user_id: uuid.UUID | None,
    now: datetime | None = None,
) -> RecruitmentContactLog:
    """記錄一次聯絡（規格 6.3）。檢查都在改任何欄位之前：

    - 版本不符 → records.VersionConflict。
    - 聯絡時間晚於現在（超過時鐘誤差）→ ContactedAtInFuture；誤差內改用現在。
    - 下次聯絡：已註冊、已退出只能 None（FollowUpNotAllowed）；時間要晚於現在（FollowUpInPast）。
      None＝不用再追，清掉訪視上的下次聯絡。
    - update_parent_response：把這次內容寫進電訪回應（只在聯絡到時，schema 已擋）。
    寫入後 last_contacted_at 取最大值，version 加一。不寫招生歷程（聯絡紀錄就是歷程）。"""
    current = now or _now()
    if visit.version != expected_version:
        raise records.VersionConflict(visit.version)
    when = contacted_at or current
    if when > current + CONTACTED_AT_TOLERANCE:
        raise ContactedAtInFuture()
    when = min(when, current)
    _check_next_follow_up(visit, next_follow_up_at, current)

    log = RecruitmentContactLog(
        id=uuid.uuid4(),
        recruitment_visit_id=visit.id,
        contacted_at=when,
        channel=channel,
        reached=reached,
        note=note,
        next_follow_up_at=next_follow_up_at,
        created_by=actor_user_id,
        created_at=current,
    )
    db.add(log)
    if visit.last_contacted_at is None or when > visit.last_contacted_at:
        visit.last_contacted_at = when
    visit.follow_up_at = next_follow_up_at
    if update_parent_response and note:
        visit.parent_response = note
    visit.version += 1
    visit.updated_at = current
    await db.flush()
    return log


async def update_follow_up(
    db: AsyncSession,
    visit: RecruitmentVisit,
    *,
    changes: dict,
    expected_version: int,
    now: datetime | None = None,
) -> list[str]:
    """只改下次聯絡或負責人（規格 6.4）。changes 只含請求有送的鍵（follow_up_at、
    follow_up_owner_id），值 None＝清除。回傳真的有變的欄位；沒變就不加版本。"""
    current = now or _now()
    if visit.version != expected_version:
        raise records.VersionConflict(visit.version)
    if "follow_up_at" in changes:
        _check_next_follow_up(visit, changes["follow_up_at"], current)
    owner_id = changes.get("follow_up_owner_id")
    if owner_id is not None and owner_id != visit.follow_up_owner_id:
        users = await _load_users(db, [owner_id])
        problem = owner_problem(users.get(owner_id), visit.campus_key)
        if problem is not None:
            raise OwnerInvalid(problem)
    changed = [key for key, value in changes.items() if getattr(visit, key) != value]
    if not changed:
        return []
    for key in changed:
        setattr(visit, key, changes[key])
    visit.version += 1
    visit.updated_at = current
    await db.flush()
    return changed


async def list_contact_logs(db: AsyncSession, visit_id: uuid.UUID) -> list[tuple[RecruitmentContactLog, str | None]]:
    """一筆訪視的聯絡紀錄，新到舊；附記錄者名稱（顯示名稱，沒有用 Email，同招生歷程）。"""
    result = await db.execute(
        select(RecruitmentContactLog, User.display_name, User.email)
        .outerjoin(User, User.id == RecruitmentContactLog.created_by)
        .where(RecruitmentContactLog.recruitment_visit_id == visit_id)
        .order_by(RecruitmentContactLog.contacted_at.desc(), RecruitmentContactLog.created_at.desc())
    )
    return [(log, display_name or email) for log, display_name, email in result.all()]


async def _latest_logs(db: AsyncSession, visit_ids: list[uuid.UUID]) -> dict[uuid.UUID, RecruitmentContactLog]:
    if not visit_ids:
        return {}
    result = await db.execute(
        select(RecruitmentContactLog)
        .where(RecruitmentContactLog.recruitment_visit_id.in_(visit_ids))
        .distinct(RecruitmentContactLog.recruitment_visit_id)
        .order_by(
            RecruitmentContactLog.recruitment_visit_id,
            RecruitmentContactLog.contacted_at.desc(),
            RecruitmentContactLog.created_at.desc(),
        )
    )
    return {log.recruitment_visit_id: log for log in result.scalars()}


async def follow_up_list(
    db: AsyncSession,
    campus_key: str,
    *,
    kind: str,
    owner: str | None,
    current_user_id: uuid.UUID,
    page: int,
    page_size: int,
    now: datetime | None = None,
) -> dict:
    """待追蹤分頁（規格 7.1、9）。totals 是全校區三種的數量（不受 owner 影響）；total 是
    目前範圍加負責人篩選後的筆數。排序：due／upcoming 依下次聯絡舊到新，unscheduled 依
    參觀日新到舊（剛參觀的在最上面），同值再依建立時間與 id，排序可重現。"""
    current = now or _now()
    in_campus = RecruitmentVisit.campus_key == campus_key
    totals = {}
    for name in constants.FOLLOW_UP_KINDS:
        totals[name] = int(
            await db.scalar(select(func.count()).select_from(RecruitmentVisit).where(in_campus, condition(name, current)))
            or 0
        )
    filters = [in_campus, condition(kind, current)]
    owner_filter = owner_condition(owner, current_user_id)
    if owner_filter is not None:
        filters.append(owner_filter)
    total = int(await db.scalar(select(func.count()).select_from(RecruitmentVisit).where(*filters)) or 0)
    if kind == "unscheduled":
        order = (RecruitmentVisit.visit_date.desc(), RecruitmentVisit.created_at.desc(), RecruitmentVisit.id.desc())
    else:
        order = (RecruitmentVisit.follow_up_at, RecruitmentVisit.created_at, RecruitmentVisit.id)
    result = await db.execute(
        select(RecruitmentVisit, User.display_name, User.email, User.is_active)
        .outerjoin(User, User.id == RecruitmentVisit.follow_up_owner_id)
        .where(*filters)
        .order_by(*order)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    rows = result.all()
    latest = await _latest_logs(db, [visit.id for visit, *_ in rows])
    return {
        "as_of": current,
        "campus_key": campus_key,
        "scope": kind,
        "totals": totals,
        "total": total,
        "page": page,
        "page_size": page_size,
        "rows": [
            {
                "visit_id": visit.id,
                "child_name": visit.child_name,
                "grade": visit.grade,
                "stage": derive_stage(visit),
                "visit_date": visit.visit_date,
                "contact_name": visit.contact_name,
                "phone": visit.phone,
                "follow_up_at": visit.follow_up_at,
                "follow_up_owner_id": visit.follow_up_owner_id,
                "follow_up_owner_name": (display_name or email) if visit.follow_up_owner_id else None,
                "follow_up_owner_active": bool(is_active) if visit.follow_up_owner_id else None,
                "last_contacted_at": visit.last_contacted_at,
                "last_contact_channel": latest[visit.id].channel if visit.id in latest else None,
                "last_contact_reached": latest[visit.id].reached if visit.id in latest else None,
                "has_visit_request": visit.visit_request_id is not None,
                "visit_request_id": visit.visit_request_id,
                "version": visit.version,
            }
            for visit, display_name, email, is_active in rows
        ],
    }


async def due_counts(db: AsyncSession, campus_keys: list[str] | None, *, now: datetime | None = None) -> dict[str, int]:
    """總覽「招生待追蹤」：各校已到期的筆數（只列有到期的校區）。campus_keys 為 None＝全部校區。"""
    stmt = select(RecruitmentVisit.campus_key, func.count()).where(condition("due", now)).group_by(RecruitmentVisit.campus_key)
    if campus_keys is not None:
        stmt = stmt.where(RecruitmentVisit.campus_key.in_(campus_keys))
    return {campus_key: int(count) for campus_key, count in (await db.execute(stmt)).all()}


async def eligible_staff(db: AsyncSession, campus_key: str) -> list[User]:
    """可以當這個校區追蹤負責人的帳號（啟用中、有 admissions.write、涵蓋該校區），依顯示名稱排序。"""
    result = await db.execute(
        select(User)
        .options(selectinload(User.campus_scopes))
        .where(User.role.in_(roles_with("admissions.write")), User.is_active.is_(True))
        .order_by(func.coalesce(User.display_name, User.email), User.email)
    )
    return [user for user in result.scalars() if owner_problem(user, campus_key) is None]
