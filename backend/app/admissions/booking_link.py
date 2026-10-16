"""官網預約與招生訪視的串接（規格 6.1）。

- contact_fields：家長／孩子四個欄位 → 招生訪視欄位的轉換（截斷、補預設、換算年級）。
  建立訪視與後台改家長資料時的同步共用這一份，兩邊規則才不會漂移。
- fields_from_visit_request：預約欄位 → 招生訪視欄位。純函式：截斷、補預設，
  不丟例外，也不碰 visit_request.slot（async 下 lazy load 會丟 MissingGreenlet）。
- ensure_from_visit_request：在「標記已到場」的同一個交易內建立招生訪視，已有
  就回傳那一筆；workflow_service.mark_completed 與補建端點共用。
- sync_from_visit_request：後台改了預約的家長資料後，把招生訪視上「仍是當初帶過去的值」
  的欄位一起改成新值（2026-10-12 規格 3.2）；招生端另外改過的不動。

整條建立路徑沒有會丟例外的資料檢查，也不用 try/except 吞例外：真的是資料庫
錯誤就讓整個「標記已到場」回滾，不會留下「已到場卻沒有招生訪視」的半套狀態。"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import academic, constants, follow_up, funnel, records
from app.admissions.models import RecruitmentVisit
from app.booking import history
from app.booking.models import VisitRequest
from app.common.timezones import today_local
from app.operations import audit_service

# 「從哪裡知道我們」的後台顯示文案（與 admin labels.ts 的 REFERRAL_SOURCE_LABELS
# 同一組字，tests/test_admissions_booking_link.py 比對）。
REFERRAL_SOURCE_TEXT: dict[str, str] = {
    "friends_family": "親友介紹",
    "sibling": "哥哥姊姊讀過或正在讀",
    "nearby": "住附近／路過看到",
    "flyer": "傳單／DM",
    "online": "網路上看到",
    "other": "其他",
    # 2026-10-03 以前的選項，舊案件仍會有。
    "facebook": "Facebook",
    "google_reviews": "Google 評論",
    "parent_community": "媽媽社團",
}
NOTES_PREFIX = "家長想了解："


def _cut(value: str | None, limit: int) -> str | None:
    if not value:
        return None
    return value.strip()[:limit] or None


def contact_fields(
    parent_name: str | None,
    phone: str | None,
    child_name: str | None,
    child_birthdate: date | None,
    *,
    today: date,
) -> dict:
    """家長與孩子四個欄位轉成招生訪視的欄位（規格 6.1 第 1 點的前半）：

    - child_name：孩子姓名截到 50 字；沒填寫「（未填姓名）」。
    - birthday：生日原值。
    - grade：有生日時依 today 所在學年換算（範圍外為 None）。
    - phone、contact_name：家長手機與稱呼（稱呼截到 50 字）。"""
    school_year, _ = academic.current_term(today)
    return {
        "contact_name": _cut(parent_name, constants.LEN_CONTACT),
        "phone": _cut(phone, constants.LEN_PHONE),
        "child_name": _cut(child_name, constants.LEN_CHILD_NAME) or constants.MISSING_CHILD_NAME,
        "birthday": child_birthdate,
        "grade": academic.grade_for_birthday(child_birthdate, school_year) if child_birthdate else None,
    }


def fields_from_visit_request(visit_request, *, today: date, slot_date: date | None = None) -> dict:
    """規格 6.1 第 1 點的欄位對應（today 是確認到場當天的台北日期）：

    - visit_date：場次日期；沒有場次（舊案）用 today。
    - child_name、birthday、grade、phone、contact_name：見 contact_fields。
    - source：勾選的「從哪裡知道我們」照後台文案以「、」串接，截到 50 字。
    - notes：「家長想了解：」＋想了解的事；沒填為 None。
    - target_school_year／target_semester：today 所在學期（同園務建立時補當前學期）。
    家長 Email 不複製（園務招生沒有 Email 欄位）。"""
    school_year, semester = academic.current_term(today)
    sources = "、".join(REFERRAL_SOURCE_TEXT.get(str(code), str(code)) for code in (visit_request.referral_sources or []))
    questions = (visit_request.questions or "").strip()
    return {
        "visit_date": slot_date or today,
        **contact_fields(
            visit_request.parent_name,
            visit_request.phone,
            visit_request.child_name,
            visit_request.child_birthdate,
            today=today,
        ),
        "source": _cut(sources, constants.LEN_SOURCE),
        "notes": f"{NOTES_PREFIX}{questions}" if questions else None,
        "target_school_year": school_year,
        "target_semester": semester,
    }


async def ensure_from_visit_request(
    db: AsyncSession, visit_request: VisitRequest, *, actor_user_id: uuid.UUID | None
) -> tuple[RecruitmentVisit, bool]:
    """這筆預約的招生訪視；沒有就建立（created 事件 origin＝visit_request）。回傳
    (訪視, 是否新建立)。呼叫端已鎖住預約列（mark_completed 的 _lock_status、補建
    端點的 with_for_update），同一筆預約不會同時建兩次；唯一鍵
    uq_recruitment_visits_visit_request 是最後防線。

    追蹤欄位（2026-10-04 規格 6.1）：不自動排第一次聯絡；預約上還沒到的下次聯絡沿用，
    負責人是這次操作的人（2026-10-06 預約拿掉承辦人）。已有訪視時原樣回傳，不動追蹤欄位。
    預約本身不動（不清它的下次聯絡、不加版本）。"""
    existing = await db.scalar(select(RecruitmentVisit).where(RecruitmentVisit.visit_request_id == visit_request.id))
    if existing is not None:
        return existing, False
    slot = await history.load_slot(db, visit_request.slot_id)
    today = today_local()
    fields = fields_from_visit_request(visit_request, today=today, slot_date=slot.slot_date if slot else None)
    tracking = await follow_up.initial_fields(
        db,
        campus_key=visit_request.campus_key,
        booking_follow_up_at=visit_request.follow_up_at,
        owner_candidates=[actor_user_id],
    )
    visit = await records.create_visit(
        db,
        campus_key=visit_request.campus_key,
        fields=fields,
        actor_user_id=actor_user_id,
        origin="visit_request",
        visit_request_id=visit_request.id,
        today=today,
        **tracking,
    )
    return visit, True


# 預約欄位對應到的招生欄位；同步結果的欄位清單照這個順序（規格 3.2 表）。
_SYNCED_FIELDS = ("contact_name", "phone", "child_name", "birthday", "grade")


async def sync_from_visit_request(
    db: AsyncSession,
    visit_request_id: uuid.UUID,
    old: dict,
    new: dict,
    *,
    actor_user_id: uuid.UUID | None,
) -> tuple[list[str], list[str]]:
    """後台改了預約的家長資料，同一個交易內把招生訪視上「仍是當初帶過去的值」一起改成
    新值（2026-10-12 規格 3.2、裁定 Q2）。回傳 (已同步的招生欄位, 因為招生端另外改過而
    沒有同步的招生欄位)，欄位名是招生訪視的欄位名（contact_name、phone、child_name、
    birthday、grade）。

    old／new 各有 parent_name、phone、child_name、child_birthdate 四個鍵（預約改之前
    與改之後的值）。判斷「仍是當初的值」＝招生現值等於 old 套 contact_fields 的結果；
    轉換用建立那筆訪視當天的台北日期（visit.created_at），年級才會和當初換算的學年一致，
    不會因為過了 8/1 換學年就把沒動過的年級誤判成改過。

    年級是從生日換算出來的：生日沒有同步（招生端改過生日）時年級也不動，免得招生那筆
    出現「生日是 A、年級卻依 B 換算」；年級鎖住（已註冊且沒有 provisional_grade，見
    records.grade_locked）時同樣不動、列在 skipped，生日照同步。沒有招生訪視、已匿名化、或預約欄位轉換後沒有差異
    的就什麼都不做。有同步時訪視 version +1（招生端正在編輯的人送出會被樂觀鎖擋下）、
    寫稽核 recruitment_visit.synced_from_visit_request（metadata 只記欄位名）。
    呼叫端已鎖住預約列；這裡再鎖招生訪視列（鎖的順序固定：預約 → 招生訪視）。"""
    visit = await db.scalar(
        select(RecruitmentVisit)
        .where(RecruitmentVisit.visit_request_id == visit_request_id, RecruitmentVisit.anonymized_at.is_(None))
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if visit is None:
        return [], []
    created_on = today_local(visit.created_at)
    before = contact_fields(**old, today=created_on)
    after = contact_fields(**new, today=created_on)
    synced: list[str] = []
    skipped: list[str] = []
    for field in _SYNCED_FIELDS:
        if before[field] == after[field]:
            continue
        untouched = getattr(visit, field) == before[field]
        if field == "grade" and "birthday" in skipped:
            untouched = False
        if field == "grade" and records.grade_locked(visit):
            # 已註冊且沒有 provisional_grade 的舊資料，年級鎖住（同 records._check_term_editable），
            # 同步不能繞過；要改請先取消註冊。
            untouched = False
        if untouched:
            setattr(visit, field, after[field])
            synced.append(field)
        else:
            skipped.append(field)
    if synced:
        visit.version += 1
        visit.updated_at = datetime.now(timezone.utc)
        # 2026-10-15 招生歷程（H4）：同步過來的也寫一筆 details_updated，只記欄位名並標 origin。
        stage = funnel.derive_stage(visit)
        records.write_event(
            db, visit, event_type="details_updated", from_stage=stage, to_stage=stage,
            actor_user_id=actor_user_id, metadata={"fields": list(synced), "origin": constants.DETAILS_ORIGIN_SYNC},
        )
        await audit_service.log_action(
            db,
            actor_user_id=actor_user_id,
            action="recruitment_visit.synced_from_visit_request",
            target_type="recruitment_visit",
            target_id=str(visit.id),
            campus_key=visit.campus_key,
            metadata={"fields": synced},
        )
    return synced, skipped
