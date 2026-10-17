"""預約案件「排除」標記：權限、時間線、操作紀錄、匿名化、SQL／Python 判斷
（2026-10-15 規格 E2–E6、E9、E11；計畫裁定 P6、P12、P15、P16、W3-12）。"""

from __future__ import annotations

import asyncio
import csv
import io
import uuid
from datetime import datetime, time, timedelta, timezone

import pytest
from sqlalchemy import select, text, update

from app.booking import exclusion
from app.booking.history import Actor
from app.booking.models import VisitRequest, VisitSlot
from app.common.timezones import today_local
from app.operations import retention_service
from app.operations.models import AuditLogEntry, RetentionRunTrigger
from tests.admissions_helpers import (  # noqa: F401
    API,
    campus_admin_yihua_client,
    readonly_yihua_client,
    reception_yihua_client,
)
from tests.conftest import legacy_request

CASES = f"{API}/admin/visit-requests"


async def _audit(db_session, action: str) -> list[dict]:
    result = await db_session.execute(
        select(AuditLogEntry).where(AuditLogEntry.action == action).order_by(AuditLogEntry.created_at)
    )
    return [entry.metadata_json for entry in result.scalars()]


async def _stored(app, case_id: str) -> tuple:
    """另開連線讀資料庫現況，不吃測試自己 session 的快取。"""
    async with app.state.session_factory() as other:
        row = await other.get(VisitRequest, uuid.UUID(case_id))
        return row.excluded_at, row.excluded_by, row.exclude_reason, row.exclude_note


# --- API：標記、取消、時間線、操作紀錄 -------------------------------------------------------


@pytest.mark.asyncio
async def test_campus_admin_excludes_and_includes(campus_admin_yihua_client, db_session):
    case_id = await legacy_request(db_session, status="confirmed")
    excluded = await campus_admin_yihua_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "test"})
    assert excluded.status_code == 200, excluded.text
    body = excluded.json()
    assert body["exclude_reason"] == "test" and body["excluded_at"] is not None
    assert body["status"] == "confirmed"  # 不改狀態（E6）
    detail = (await campus_admin_yihua_client.get(f"{CASES}/{case_id}")).json()
    event = next(e for e in detail["history"] if e["event_type"] == "excluded")
    assert event["after"] == {"reason": "test"} and event["source"] == "staff"
    assert await _audit(db_session, "visit_request.exclude") == [{"exclude_reason": "test"}]

    included = await campus_admin_yihua_client.post(f"{CASES}/{case_id}/include")
    assert included.status_code == 200, included.text
    assert (included.json()["excluded_at"], included.json()["exclude_reason"], included.json()["exclude_note"]) == (
        None,
        None,
        None,
    )
    detail = (await campus_admin_yihua_client.get(f"{CASES}/{case_id}")).json()
    removed = next(e for e in detail["history"] if e["event_type"] == "exclusion_removed")
    assert removed["before"] == {"reason": "test"} and removed["source"] == "staff"
    assert await _audit(db_session, "visit_request.include") == [{"exclude_reason": "test"}]


@pytest.mark.asyncio
async def test_exclude_keeps_status_and_slot_and_include_clears_all_four_columns(admin_client, db_session, app):
    case_id = await legacy_request(db_session, status="confirmed")
    before = (await admin_client.get(f"{CASES}/{case_id}")).json()
    assert (await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "other", "note": "櫃台自己試填"})).status_code == 200
    excluded_at, excluded_by, reason, note = await _stored(app, case_id)
    assert excluded_at is not None and excluded_by is not None and (reason, note) == ("other", "櫃台自己試填")

    during = (await admin_client.get(f"{CASES}/{case_id}")).json()
    assert (during["status"], during["slot_id"], during["version"]) == (before["status"], before["slot_id"], before["version"])

    assert (await admin_client.post(f"{CASES}/{case_id}/include")).status_code == 200
    assert await _stored(app, case_id) == (None, None, None, None)  # E4：四個欄位都清空


@pytest.mark.asyncio
async def test_excluded_event_keeps_the_note_in_reason_only(admin_client, db_session):
    case_id = await legacy_request(db_session, status="cancelled")
    note = "王小明家長打錯校區重送"
    assert (await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "duplicate", "note": note})).status_code == 200
    detail = (await admin_client.get(f"{CASES}/{case_id}")).json()
    event = next(e for e in detail["history"] if e["event_type"] == "excluded")
    assert event["reason"] == note
    assert event["after"] == {"reason": "duplicate"}  # after 只有原因類別，說明不進去


@pytest.mark.asyncio
async def test_reception_and_readonly_cannot_exclude_but_campus_admin_can(
    reception_yihua_client, readonly_yihua_client, campus_admin_yihua_client, db_session, app
):
    case_id = await legacy_request(db_session, status="confirmed")
    # 櫃台、唯讀都看得到案件（booking.read），但沒有 booking.manage → 403，案件不變。
    assert (await reception_yihua_client.get(f"{CASES}/{case_id}")).status_code == 200
    assert (await reception_yihua_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "test"})).status_code == 403
    assert (await readonly_yihua_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "test"})).status_code == 403
    assert await _stored(app, case_id) == (None, None, None, None)
    # 同一筆案件，校區管理者可以。
    assert (await campus_admin_yihua_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "test"})).status_code == 200

    # 取消排除同樣要 booking.manage：被擋的是櫃台，案件仍是排除狀態。
    assert (await reception_yihua_client.post(f"{CASES}/{case_id}/include")).status_code == 403
    assert (await _stored(app, case_id))[2] == "test"
    assert (await campus_admin_yihua_client.post(f"{CASES}/{case_id}/include")).status_code == 200


@pytest.mark.asyncio
async def test_other_campus_admin_does_not_see_the_case(minghua_client, campus_admin_yihua_client, db_session, app):
    case_id = await legacy_request(db_session, status="confirmed")
    # 校區範圍外的案件對這個人「不存在」：整個系統一律 404，不洩漏案件是否存在（permissions.ScopeDenied）。
    assert (await minghua_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "test"})).status_code == 404
    assert await _stored(app, case_id) == (None, None, None, None)
    # 同一筆案件、同樣的內容，本校的管理者成功。
    assert (await campus_admin_yihua_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "test"})).status_code == 200
    assert (await minghua_client.post(f"{CASES}/{case_id}/include")).status_code == 404
    assert (await _stored(app, case_id))[2] == "test"
    assert (await campus_admin_yihua_client.post(f"{CASES}/{case_id}/include")).status_code == 200


@pytest.mark.asyncio
async def test_unknown_case_is_404(admin_client):
    missing = uuid.uuid4()
    assert (await admin_client.post(f"{CASES}/{missing}/exclude", json={"reason": "test"})).status_code == 404
    assert (await admin_client.post(f"{CASES}/{missing}/include")).status_code == 404


# --- 驗證：原因、說明 ------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_other_needs_a_note_that_never_reaches_the_audit_log(admin_client, db_session):
    case_id = await legacy_request(db_session, status="cancelled")
    missing = await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "other"})
    assert missing.status_code == 422
    assert ["body", "note"] in [error["loc"] for error in missing.json()["detail"]]
    ok = await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "other", "note": "王小明家長打錯校區重送"})
    assert ok.status_code == 200, ok.text
    assert ok.json()["exclude_note"] == "王小明家長打錯校區重送"
    assert await _audit(db_session, "visit_request.exclude") == [{"exclude_reason": "other"}]


@pytest.mark.asyncio
async def test_blank_note_does_not_count_as_a_note_for_other(admin_client, db_session):
    case_id = await legacy_request(db_session, status="cancelled")
    blank = await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "other", "note": "   "})
    assert blank.status_code == 422
    assert ["body", "note"] in [error["loc"] for error in blank.json()["detail"]]
    padded = await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "other", "note": "  重複送單  "})
    assert padded.status_code == 200, padded.text
    assert padded.json()["exclude_note"] == "重複送單"  # 前後空白去掉


@pytest.mark.asyncio
@pytest.mark.parametrize("reason", ["test", "duplicate"])
async def test_test_and_duplicate_do_not_need_a_note(admin_client, db_session, reason):
    case_id = await legacy_request(db_session, status="cancelled")
    response = await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": reason})
    assert response.status_code == 200, response.text
    assert (response.json()["exclude_reason"], response.json()["exclude_note"]) == (reason, None)


@pytest.mark.asyncio
async def test_note_limit_is_200_characters(admin_client, db_session):
    case_id = await legacy_request(db_session, status="cancelled")
    too_long = await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "other", "note": "字" * 201})
    assert too_long.status_code == 422
    assert ["body", "note"] in [error["loc"] for error in too_long.json()["detail"]]
    exact = await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "other", "note": "字" * 200})
    assert exact.status_code == 200, exact.text
    assert len(exact.json()["exclude_note"]) == 200


@pytest.mark.asyncio
async def test_reason_must_be_one_of_the_three_and_extra_fields_are_refused(admin_client, db_session):
    case_id = await legacy_request(db_session, status="cancelled")
    unknown = await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "spam"})
    assert unknown.status_code == 422
    assert ["body", "reason"] in [error["loc"] for error in unknown.json()["detail"]]
    assert (await admin_client.post(f"{CASES}/{case_id}/exclude", json={})).status_code == 422
    extra = await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "test", "excluded_at": "2026-01-01T00:00:00Z"})
    assert extra.status_code == 422
    # 正向對照：同一筆案件，合法的內容成功。
    assert (await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "test"})).status_code == 200


@pytest.mark.asyncio
async def test_note_rejects_control_characters(admin_client, db_session):
    case_id = await legacy_request(db_session, status="cancelled")
    refused = await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "other", "note": "測試\x00資料"})
    assert refused.status_code == 422
    assert (await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "other", "note": "測試資料"})).status_code == 200


# --- 衝突 ------------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_double_exclude_and_include_when_not_excluded_conflict(admin_client, db_session, app):
    case_id = await legacy_request(db_session, status="completed")
    not_yet = await admin_client.post(f"{CASES}/{case_id}/include")
    assert not_yet.status_code == 409 and not_yet.json()["detail"]["code"] == "NOT_EXCLUDED"
    assert (await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "duplicate"})).status_code == 200
    again = await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "test"})
    assert again.status_code == 409 and again.json()["detail"]["code"] == "ALREADY_EXCLUDED"
    # 被擋的第二次不能蓋掉原因，也不留第二筆歷程或操作紀錄。
    assert (await _stored(app, case_id))[2] == "duplicate"
    detail = (await admin_client.get(f"{CASES}/{case_id}")).json()
    assert [e["event_type"] for e in detail["history"] if e["event_type"] == "excluded"] == ["excluded"]
    assert await _audit(db_session, "visit_request.exclude") == [{"exclude_reason": "duplicate"}]
    # 正向對照：取消排除之後，同樣的第二次標記可以成功。
    assert (await admin_client.post(f"{CASES}/{case_id}/include")).status_code == 200
    assert (await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "test"})).status_code == 200


@pytest.mark.asyncio
async def test_include_conflict_leaves_no_history_or_audit(admin_client, db_session):
    case_id = await legacy_request(db_session, status="completed")
    assert (await admin_client.post(f"{CASES}/{case_id}/include")).status_code == 409
    detail = (await admin_client.get(f"{CASES}/{case_id}")).json()
    assert not [e for e in detail["history"] if e["event_type"] == "exclusion_removed"]
    assert await _audit(db_session, "visit_request.include") == []


# --- 交錯：兩個人同時標記／取消 ---------------------------------------------------------------


async def _wait_until_blocked(app, task: asyncio.Task, *, seconds: float = 8.0) -> None:
    """等到有一條連線正在等鎖（請求已經讀完案件、卡在 FOR UPDATE）。請求自己先結束了就直接報它的結果。
    每次輪詢都開新連線：pg_stat_activity 在同一個交易裡會沿用第一次讀到的快照（tests/test_booking_stale_reads.py）。"""
    for _ in range(int(seconds / 0.05)):
        if task.done():
            raise AssertionError(f"請求還沒卡到鎖就結束了：{task.exception() or task.result()!r}")
        async with app.state.engine.connect() as conn:
            waiting = await conn.scalar(
                text("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'")
            )
        if waiting:
            return
        await asyncio.sleep(0.05)
    raise AssertionError("請求沒有卡在案件列鎖上，交錯沒有發生")


@pytest.mark.asyncio
async def test_a_second_exclude_waits_for_the_first_and_then_conflicts(app, admin_client, db_session):
    case_id = await legacy_request(db_session, status="confirmed")
    async with app.state.session_factory() as other:
        visit = await other.get(VisitRequest, uuid.UUID(case_id))
        await exclusion.exclude(other, visit, reason="test", note=None, actor=Actor.staff(None))  # 標記了、還沒提交
        task = asyncio.create_task(admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "duplicate"}))
        await _wait_until_blocked(app, task)
        await other.commit()
    response = await asyncio.wait_for(task, 15)
    assert response.status_code == 409 and response.json()["detail"]["code"] == "ALREADY_EXCLUDED"
    assert (await _stored(app, case_id))[2] == "test"  # 先到的原因留著，沒被後到的蓋掉


@pytest.mark.asyncio
async def test_a_second_include_waits_for_the_first_and_then_conflicts(app, admin_client, db_session):
    case_id = await legacy_request(db_session, status="confirmed")
    assert (await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "test"})).status_code == 200
    async with app.state.session_factory() as other:
        visit = await other.get(VisitRequest, uuid.UUID(case_id))
        await exclusion.include(other, visit, actor=Actor.staff(None))  # 取消了、還沒提交
        task = asyncio.create_task(admin_client.post(f"{CASES}/{case_id}/include"))
        await _wait_until_blocked(app, task)
        await other.commit()
    response = await asyncio.wait_for(task, 15)
    assert response.status_code == 409 and response.json()["detail"]["code"] == "NOT_EXCLUDED"
    detail = (await admin_client.get(f"{CASES}/{case_id}")).json()
    assert [e["event_type"] for e in detail["history"] if e["event_type"] == "exclusion_removed"] == ["exclusion_removed"]


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["exclude", "include"])
async def test_response_carries_the_status_read_under_the_lock(app, admin_client, db_session, action):
    """等鎖的空檔另一個人把案件標成已到場：回應帶鎖內重讀的狀態，不是鎖前讀到的舊狀態（_FIELDS 含 status）。"""
    case_id = await legacy_request(db_session, status="confirmed")
    if action == "include":
        assert (await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "test"})).status_code == 200
    async with app.state.session_factory() as other:
        # 還沒提交：案件列被這個交易鎖住，請求讀完案件後會卡在 FOR UPDATE。
        await other.execute(update(VisitRequest).where(VisitRequest.id == uuid.UUID(case_id)).values(status="completed"))
        body = {"json": {"reason": "test"}} if action == "exclude" else {}
        task = asyncio.create_task(admin_client.post(f"{CASES}/{case_id}/{action}", **body))
        await _wait_until_blocked(app, task)
        await other.commit()
    response = await asyncio.wait_for(task, 15)
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "completed"


# --- 列表與明細 ------------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_hides_the_note_but_detail_shows_it(admin_client, db_session):
    case_id = await legacy_request(db_session, status="cancelled", parent_name="排除說明家長")
    await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "duplicate", "note": "同一位家長送了兩次"})
    rows = (await admin_client.get(f"{CASES}?q=排除說明家長")).json()
    assert [(r["exclude_reason"], r["exclude_note"]) for r in rows] == [("duplicate", None)]
    assert (await admin_client.get(f"{CASES}/{case_id}")).json()["exclude_note"] == "同一位家長送了兩次"


# --- 保存政策（E11、P15） --------------------------------------------------------------------


@pytest.mark.asyncio
async def test_anonymized_case_can_be_excluded_but_keeps_no_note(admin_client, db_session):
    case_id = await legacy_request(db_session, status="cancelled")
    await db_session.execute(
        update(VisitRequest).where(VisitRequest.id == uuid.UUID(case_id)).values(anonymized_at=datetime.now(timezone.utc))
    )
    await db_session.commit()
    response = await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "other", "note": "測試"})
    assert response.status_code == 200, response.text
    assert response.json()["exclude_reason"] == "other" and response.json()["exclude_note"] is None
    # 說明沒存，歷程的原因欄也不能留一份。
    detail = (await admin_client.get(f"{CASES}/{case_id}")).json()
    event = next(e for e in detail["history"] if e["event_type"] == "excluded")
    assert event["reason"] is None and event["after"] == {"reason": "other"}


@pytest.mark.asyncio
async def test_anonymize_clears_the_note_and_keeps_the_reason(admin_client, db_session):
    case_id = await legacy_request(db_session, status="cancelled")
    await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "test", "note": "櫃台測試"})
    visit = await db_session.get(VisitRequest, uuid.UUID(case_id))
    assert await retention_service.anonymize(db_session, visit)
    await db_session.commit()
    await db_session.refresh(visit)
    assert (visit.exclude_reason, visit.exclude_note) == ("test", None)
    assert visit.excluded_at is not None  # 原因類別與時間保留，統計仍排除這一筆
    detail = (await admin_client.get(f"{CASES}/{case_id}")).json()
    event = next(e for e in detail["history"] if e["event_type"] == "excluded")
    assert event["reason"] is None  # 歷程的說明也一起清掉（既有的 _clear_free_text_reasons）


@pytest.mark.asyncio
async def test_sweep_clears_a_note_left_on_an_already_anonymized_case(admin_client, db_session):
    """匿名化之後才被寫進來的說明（舊版程式、手動改資料）：下一次清理補清，原因類別保留。"""
    case_id = await legacy_request(db_session, status="cancelled")
    await db_session.execute(
        update(VisitRequest)
        .where(VisitRequest.id == uuid.UUID(case_id))
        .values(
            anonymized_at=datetime.now(timezone.utc),
            excluded_at=datetime.now(timezone.utc),
            exclude_reason="other",
            exclude_note="匿名化後才寫進來",
        )
    )
    await db_session.commit()
    days = {"cancelled_days": 30, "completed_days": 30, "open_overdue_days": 30, "admissions_days": None}
    await retention_service.run_sweep(db_session, days, trigger=RetentionRunTrigger.MANUAL)
    await db_session.commit()
    row = (await db_session.execute(select(VisitRequest).where(VisitRequest.id == uuid.UUID(case_id)))).scalar_one()
    await db_session.refresh(row)
    assert (row.exclude_reason, row.exclude_note) == ("other", None)


@pytest.mark.asyncio
async def test_sweep_leaves_the_note_of_a_case_that_is_not_anonymized(admin_client, db_session):
    """補清只動已匿名化的案件；還沒匿名化的案件，說明要留著（對照上一條）。"""
    case_id = await legacy_request(db_session, status="cancelled")
    await admin_client.post(f"{CASES}/{case_id}/exclude", json={"reason": "other", "note": "還在保存期內"})
    days = {"cancelled_days": 30, "completed_days": 30, "open_overdue_days": 30, "admissions_days": None}
    await retention_service.run_sweep(db_session, days, trigger=RetentionRunTrigger.MANUAL)
    await db_session.commit()
    visit = await db_session.get(VisitRequest, uuid.UUID(case_id))
    await db_session.refresh(visit)
    assert (visit.exclude_reason, visit.exclude_note) == ("other", "還在保存期內")


# --- exclusion.py 的判斷（E9、W3-12） -------------------------------------------------------


def test_reasons_and_note_limit_are_the_agreed_values():
    assert exclusion.REASONS == ("test", "duplicate", "other")
    assert exclusion.NOTE_MAX == 200


def test_is_excluded_looks_only_at_excluded_at():
    assert exclusion.is_excluded(VisitRequest(excluded_at=None)) is False
    assert exclusion.is_excluded(VisitRequest(excluded_at=datetime.now(timezone.utc), exclude_reason="test")) is True


@pytest.mark.asyncio
async def test_sql_conditions_split_the_cases_and_agree_with_is_excluded(admin_client, db_session):
    kept_a = await legacy_request(db_session, status="confirmed", parent_name="保留一", phone="0911000001")
    kept_b = await legacy_request(db_session, status="cancelled", parent_name="保留二", phone="0911000002")
    dropped = await legacy_request(db_session, status="completed", parent_name="排除", phone="0911000003")
    assert (await admin_client.post(f"{CASES}/{dropped}/exclude", json={"reason": "test"})).status_code == 200

    async def ids(condition) -> set[str]:
        result = await db_session.execute(select(VisitRequest.id).where(condition))
        return {str(case_id) for case_id in result.scalars()}

    assert await ids(exclusion.not_excluded()) == {kept_a, kept_b}
    assert await ids(exclusion.excluded()) == {dropped}  # 計數用：「已排除 N 筆」
    db_session.expire_all()
    rows = (await db_session.execute(select(VisitRequest))).scalars().all()
    assert {str(r.id): exclusion.is_excluded(r) for r in rows} == {kept_a: False, kept_b: False, dropped: True}


@pytest.mark.asyncio
async def test_service_raises_for_a_second_exclude_and_for_include_when_not_excluded(db_session):
    case_id = uuid.UUID(await legacy_request(db_session, status="cancelled"))
    actor = Actor.staff(None)

    async def fresh() -> VisitRequest:
        await db_session.rollback()  # rollback 會讓已載入的物件過期，重新取
        return await db_session.get(VisitRequest, case_id)

    with pytest.raises(exclusion.NotExcluded):
        await exclusion.include(db_session, await fresh(), actor=actor)
    visit = await fresh()
    await exclusion.exclude(db_session, visit, reason="test", note=None, actor=actor)
    with pytest.raises(exclusion.AlreadyExcluded):
        await exclusion.exclude(db_session, visit, reason="duplicate", note=None, actor=actor)
    # 正向對照：沒提交的標記已隨 rollback 消失，重新標記成功，取消時回傳原本的原因。
    visit = await fresh()
    await exclusion.exclude(db_session, visit, reason="duplicate", note=None, actor=actor)
    assert await exclusion.include(db_session, visit, actor=actor) == "duplicate"


# --- 列表與 CSV 的 excluded 篩選（Task 9） -----------------------------------------------------


@pytest.mark.asyncio
async def test_list_and_export_filters(admin_client, db_session):
    keep = await legacy_request(db_session, status="cancelled", parent_name="篩選留著", phone="0912000201")
    drop = await legacy_request(db_session, status="cancelled", parent_name="篩選排除", phone="0912000202")
    await admin_client.post(f"{CASES}/{drop}/exclude", json={"reason": "duplicate"})
    names = lambda rows: sorted(r["parent_name"] for r in rows)  # noqa: E731
    assert names((await admin_client.get(f"{CASES}?q=篩選")).json()) == ["篩選排除", "篩選留著"]
    assert names((await admin_client.get(f"{CASES}?q=篩選&excluded=hide")).json()) == ["篩選留著"]
    assert names((await admin_client.get(f"{CASES}?q=篩選&excluded=only")).json()) == ["篩選排除"]
    assert (await admin_client.get(f"{CASES}?excluded=nope")).status_code == 422
    export = await admin_client.get(f"{CASES}/export?campus_key=yihua&q=篩選")
    rows = list(csv.DictReader(io.StringIO(export.content.decode("utf-8-sig"))))
    assert sorted((r["家長"], r["已排除"]) for r in rows) == [("篩選排除", "重複"), ("篩選留著", "")]
    assert keep


@pytest.mark.asyncio
async def test_export_follows_the_excluded_filter_and_audit_records_it(admin_client, db_session):
    await legacy_request(db_session, status="cancelled", parent_name="匯出留著", phone="0912000203")
    drop = await legacy_request(db_session, status="cancelled", parent_name="匯出排除", phone="0912000204")
    await admin_client.post(f"{CASES}/{drop}/exclude", json={"reason": "other", "note": "家長說打錯"})

    async def exported(query: str) -> list[dict]:
        response = await admin_client.get(f"{CASES}/export?campus_key=yihua&q=匯出{query}")
        assert response.status_code == 200, response.text
        return list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))

    assert [r["家長"] for r in await exported("&excluded=hide")] == ["匯出留著"]
    only = await exported("&excluded=only")
    assert [(r["家長"], r["已排除"]) for r in only] == [("匯出排除", "其他")]
    assert (await _audit(db_session, "visit_request.export"))[-1]["excluded"] == "only"


@pytest.mark.asyncio
async def test_hide_filter_matches_dashboard_counts(admin_client, db_session):
    """總覽數字已排除；總覽連結帶 excluded=hide，點進去是同一批（計畫裁定 P8）。"""
    slot = VisitSlot(
        id=uuid.uuid4(), campus_key="yihua", slot_date=today_local() - timedelta(days=1), start_time=time(10, 0),
        end_time=time(11, 0), capacity=5, closed=False, created_at=datetime.now(timezone.utc),
    )
    db_session.add(slot)
    await db_session.commit()
    past = slot.id
    await legacy_request(db_session, status="confirmed", slot_id=past, phone="0912000211")
    drop = await legacy_request(db_session, status="confirmed", slot_id=past, phone="0912000212")
    await admin_client.post(f"{CASES}/{drop}/exclude", json={"reason": "test"})
    count = (await admin_client.get(f"{API}/admin/dashboard")).json()["awaiting_attendance"]
    listed = (await admin_client.get(f"{CASES}?view=past&status=confirmed&excluded=hide")).json()
    assert count == len(listed) == 1
