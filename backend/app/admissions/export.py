"""轉成園務招生三張表的欄位形狀（規格 12；格式說明在 contracts/ivy-recruitment/README.md）。

每列是 {"website_id": 官網 uuid, "columns": {園務欄位: 值}, "mapping": {匯入時要對應
的官網值}}（A 計畫調整第 16 條）。columns 只有園務表的欄位（不含 id）；外鍵與年級
id（recruitment_visit_id、grade_id、provisional_grade_id、tour_guide_employee_id）
留 null，由匯入端依 mapping 填；student_id、actor_user_id、expected_start_label
一律 null。日期時間轉台北時間 naive ISO 字串（園務存台北 naive）。官網延伸的
created 事件不匯出。

只讀，不寫資料庫；write_jsonl 寫檔時目錄 0700、檔案 0600、不覆寫。"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admissions import academic, constants
from app.admissions.models import GradeIntakeTarget, RecruitmentEventLog, RecruitmentVisit
from app.auth.models import User
from app.common.timezones import OPERATING_TZ

FILES: tuple[str, ...] = ("recruitment_visits", "recruitment_event_log", "grade_intake_targets", "extensions")


def _taipei_naive(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(OPERATING_TZ).replace(tzinfo=None).isoformat()


def ivy_visit_row(visit: RecruitmentVisit, *, tenant_id: int | None = None) -> dict:
    """園務 recruitment_visits 的形狀（不含 id）。"""
    return {
        "website_id": str(visit.id),
        "columns": {
            "tenant_id": tenant_id,
            "month": visit.month,
            "seq_no": visit.seq_no,
            "visit_date": academic.roc_date(visit.visit_date),
            "child_name": visit.child_name,
            "birthday": visit.birthday.isoformat() if visit.birthday else None,
            "grade": visit.grade,
            "phone": visit.phone,
            "contact_name": visit.contact_name,
            "address": visit.address,
            "district": visit.district,
            "source": visit.source,
            "referrer": visit.referrer,
            "deposit_collector": visit.deposit_collector,
            "tour_guide_employee_id": None,
            "source_category": visit.source_category,
            "has_deposit": visit.has_deposit,
            "rides_bus": visit.rides_bus,
            "notes": visit.notes,
            "parent_response": visit.parent_response,
            "geocoding_consent_at": _taipei_naive(visit.geocoding_consent_at),
            "no_deposit_reason": visit.no_deposit_reason,
            "no_deposit_reason_detail": visit.no_deposit_reason_detail,
            "enrolled": visit.enrolled,
            "transfer_term": visit.transfer_term,
            "expected_start_label": None,
            "provisional_grade_id": None,
            "target_school_year": visit.target_school_year,
            "target_semester": visit.target_semester,
            "withdrawn_at": _taipei_naive(visit.withdrawn_at),
            "withdrawn_from": visit.withdrawn_from,
            "withdraw_reason": visit.withdraw_reason,
            "created_at": _taipei_naive(visit.created_at),
            "updated_at": _taipei_naive(visit.updated_at),
        },
        "mapping": {
            "campus_key": visit.campus_key,
            # 依名稱對應該租戶的 class_grades.id，填進 provisional_grade_id。
            "provisional_grade": visit.provisional_grade,
            # 依姓名對應園務員工，填進 tour_guide_employee_id；對不上留空並列入報告。
            "tour_guide_name": visit.tour_guide_name,
        },
    }


def ivy_event_row(event: RecruitmentEventLog, *, actor_name: str | None = None) -> dict:
    """園務 recruitment_event_log 的形狀（不含 id）。官網帳號沒有對應的園務帳號：
    操作者記在 metadata_json.website_actor（{"user_id", "name"}；name 只放顯示名稱，
    沒設就是 None，絕不放 Email），actor_user_id 留空。"""
    metadata = dict(event.metadata_json or {})
    if event.actor_user_id is not None:
        metadata["website_actor"] = {"user_id": str(event.actor_user_id), "name": actor_name}
    return {
        "website_id": str(event.id),
        "columns": {
            "recruitment_visit_id": None,
            "event_type": event.event_type,
            "from_stage": event.from_stage,
            "to_stage": event.to_stage,
            "student_id": None,
            "reason": event.reason,
            "actor_user_id": None,
            "metadata_json": metadata or None,
            "created_at": _taipei_naive(event.created_at),
        },
        "mapping": {"recruitment_visit_website_id": str(event.recruitment_visit_id)},
    }


def ivy_target_row(target: GradeIntakeTarget) -> dict:
    """園務 grade_intake_targets 的形狀（不含 id）。"""
    return {
        "website_id": str(target.id),
        "columns": {
            "grade_id": None,
            "school_year": target.school_year,
            "semester": target.semester,
            "target_seats": target.target_seats,
            "created_at": _taipei_naive(target.created_at),
            "updated_at": _taipei_naive(target.updated_at),
        },
        "mapping": {"campus_key": target.campus_key, "grade": target.grade},
    }


def extension_row(visit: RecruitmentVisit) -> dict:
    """規格 12.3 的延伸欄位（version、anonymized_at 不轉）。"""
    return {
        "website_id": str(visit.id),
        "visit_request_id": str(visit.visit_request_id) if visit.visit_request_id else None,
        "enrolled_on": visit.enrolled_on.isoformat() if visit.enrolled_on else None,
        "tour_guide_user_id": str(visit.tour_guide_user_id) if visit.tour_guide_user_id else None,
        "tour_guide_name": visit.tour_guide_name,
    }


async def export_campus(db: AsyncSession, campus_key: str, *, tenant_id: int | None = None) -> dict[str, list[dict]]:
    """一個校區的四份資料（鍵與順序同 FILES）。訪視依建立時間、歷程依時間排序；
    歷程用 join 依校區取，不把全部訪視 id 塞進 IN。三次查詢要是同一個快照，呼叫端
    須在 REPEATABLE READ 交易內呼叫（scripts/export_ivy_recruitment.py 的連線預設如此）。"""
    visits = list(
        (
            await db.execute(
                select(RecruitmentVisit)
                .where(RecruitmentVisit.campus_key == campus_key)
                .order_by(RecruitmentVisit.created_at, RecruitmentVisit.id)
            )
        ).scalars()
    )
    events = await db.execute(
        # 匯出檔會交給園務系統，不帶同事 Email：只取顯示名稱，沒有就只留 user_id。
        select(RecruitmentEventLog, User.display_name)
        .join(RecruitmentVisit, RecruitmentVisit.id == RecruitmentEventLog.recruitment_visit_id)
        .outerjoin(User, User.id == RecruitmentEventLog.actor_user_id)
        .where(
            RecruitmentVisit.campus_key == campus_key,
            RecruitmentEventLog.event_type.not_in(constants.WEBSITE_ONLY_EVENT_TYPES),
        )
        .order_by(RecruitmentEventLog.created_at, RecruitmentEventLog.id)
    )
    targets = await db.execute(
        select(GradeIntakeTarget)
        .where(GradeIntakeTarget.campus_key == campus_key)
        .order_by(GradeIntakeTarget.school_year, GradeIntakeTarget.semester, GradeIntakeTarget.grade)
    )
    return {
        "recruitment_visits": [ivy_visit_row(visit, tenant_id=tenant_id) for visit in visits],
        "recruitment_event_log": [ivy_event_row(event, actor_name=display_name) for event, display_name in events.all()],
        "grade_intake_targets": [ivy_target_row(target) for target in targets.scalars()],
        "extensions": [extension_row(visit) for visit in visits],
    }


def write_jsonl(result: dict[str, list[dict]], out_dir: Path) -> list[Path]:
    """每份資料一個 JSONL（UTF-8，一列一筆）。含幼生與家長個資：目錄 0700、檔案
    0600；檔案已存在就丟 FileExistsError，不覆寫。"""
    out_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    paths = []
    for name in FILES:
        path = out_dir / f"{name}.jsonl"
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            for row in result[name]:
                handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n")
        paths.append(path)
    return paths
