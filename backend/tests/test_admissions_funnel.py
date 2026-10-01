"""招生狀態轉換與漏斗看板（規格 6.2、6.3、10；R04、R05、R06 轉換部分；Review Focus 3）。"""

from __future__ import annotations

import asyncio
import json
import uuid

import pytest
from sqlalchemy import select, update

from app.admissions import academic, constants, funnel
from app.admissions.models import RecruitmentVisit
from app.common.timezones import today_local
from app.operations.models import AuditLogEntry
from tests.admissions_helpers import (  # noqa: F401
    ADMISSIONS,
    campus_admin_yihua_client,
    create_record,
    record_at_stage,
    reception_yihua_client,
    transition,
)

RECORDS = f"{ADMISSIONS}/records"
ENROLL = {"grade": "小班", "target_school_year": 115, "target_semester": 1}


async def _events(client, record: dict) -> list[tuple]:
    """created 以外的歷程：(類型, 起, 迄, 原因)，舊到新。"""
    body = (await client.get(f"{RECORDS}/{record['id']}/events")).json()
    return [(e["event_type"], e["from_stage"], e["to_stage"], e["reason"]) for e in body if e["event_type"] != "created"]


async def _post(client, record: dict, to_stage: str, *, version: int | None = None, **fields):
    return await client.post(
        f"{RECORDS}/{record['id']}/transition",
        json={"to_stage": to_stage, "expected_version": version or record["version"], **fields},
    )


def test_capability_table_matches_spec():
    """規格 6.3：九種允許的轉換與各自的 capability；其餘（含同階段）不允許。"""
    allowed = {
        ("visited", "deposited"): "admissions.write",
        ("deposited", "visited"): "admissions.write",
        ("deposited", "enrolled"): "admissions.convert",
        ("enrolled", "deposited"): "admissions.convert",
        ("enrolled", "visited"): "admissions.convert",
        ("deposited", "withdrawn"): "admissions.write",
        ("enrolled", "withdrawn"): "admissions.convert",
        ("withdrawn", "visited"): "admissions.write",
        ("withdrawn", "deposited"): "admissions.write",
    }
    for start in constants.STAGES:
        for to_stage in constants.STAGES:
            assert funnel.transition_capability(start, to_stage) == allowed.get((start, to_stage)), (start, to_stage)
    assert "沒有可退的款項" in funnel.not_allowed_reason("visited", "withdrawn")


CASES = [
    # (起始階段, 從哪裡退出, 目標, 請求欄位, 轉換後欄位, 新增的歷程)
    ("visited", None, "deposited", {"deposit_collector": "林老師"},
     {"has_deposit": True, "deposit_collector": "林老師", "enrolled": False},
     [("deposit_added", "visited", "deposited", None)]),
    ("deposited", None, "visited", {},
     {"has_deposit": False},
     [("deposit_removed", "deposited", "visited", None)]),
    ("deposited", None, "enrolled",
     {"grade": "中班", "target_school_year": 116, "target_semester": 1, "enrolled_on": "2026-10-01"},
     {"enrolled": True, "enrolled_on": "2026-10-01", "provisional_grade": "中班", "target_school_year": 116,
      "target_semester": 1, "has_deposit": True},
     [("converted", "deposited", "enrolled", None)]),
    ("enrolled", None, "deposited", {"reason": "家長延後入學"},
     {"enrolled": False, "enrolled_on": None, "has_deposit": True, "provisional_grade": "小班"},
     [("revert_converted", "enrolled", "deposited", "家長延後入學")]),
    ("enrolled", None, "visited", {"reason": "家長延後入學"},
     {"enrolled": False, "enrolled_on": None, "has_deposit": False},
     [("revert_converted", "enrolled", "deposited", "家長延後入學"),
      ("deposit_removed", "deposited", "visited", "家長延後入學")]),
    ("deposited", None, "withdrawn", {"reason": "改送他校"},
     {"withdrawn_from": "deposited", "withdraw_reason": "改送他校", "has_deposit": False},
     [("withdrawn", "deposited", "withdrawn", "改送他校")]),
    ("enrolled", None, "withdrawn", {"reason": "搬家"},
     {"withdrawn_from": "enrolled", "withdraw_reason": "搬家", "has_deposit": False, "enrolled": False, "enrolled_on": None},
     [("withdrawn", "enrolled", "withdrawn", "搬家")]),
    ("withdrawn", "deposited", "visited", {},
     {"withdrawn_at": None, "withdrawn_from": None, "withdraw_reason": None, "has_deposit": False},
     [("withdraw_cancelled", "withdrawn", "visited", None)]),
    ("withdrawn", "enrolled", "deposited", {},
     {"withdrawn_at": None, "withdrawn_from": None, "withdraw_reason": None, "has_deposit": True,
      "enrolled": False, "enrolled_on": None},
     [("withdraw_cancelled", "withdrawn", "deposited", None)]),
]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("start", "withdrawn_from", "to_stage", "body", "expected", "events"),
    CASES,
    ids=[f"{c[0]}{'(' + c[1] + ')' if c[1] else ''}->{c[2]}" for c in CASES],
)
async def test_each_allowed_transition(admin_client, start, withdrawn_from, to_stage, body, expected, events):
    """R04：規格 6.3 每一種允許的轉換：欄位變化、歷程、版本。"""
    record = await record_at_stage(admin_client, start, withdrawn_from=withdrawn_from or "deposited")
    before = await _events(admin_client, record)
    response = await _post(admin_client, record, to_stage, **body)
    assert response.status_code == 200, response.text
    after = response.json()
    assert after["stage"] == to_stage
    assert after["version"] == record["version"] + 1
    for key, value in expected.items():
        assert after[key] == value, key
    assert (after["withdrawn_at"] is not None) == (to_stage == "withdrawn")
    assert (await _events(admin_client, record))[len(before):] == events


@pytest.mark.asyncio
async def test_enroll_uses_reserved_seat_or_requires_grade_and_year(admin_client, db_session):
    record = await record_at_stage(admin_client, "deposited")
    missing = await _post(admin_client, record, "enrolled")
    assert missing.status_code == 422, missing.text
    assert missing.json()["detail"]["code"] == "TRANSITION_FIELDS_REQUIRED"
    assert missing.json()["detail"]["fields"] == ["grade"]

    # 已保留座位（大班）：不帶年級也能註冊，註冊日期預設台北今天。
    await db_session.execute(
        update(RecruitmentVisit).where(RecruitmentVisit.id == uuid.UUID(record["id"])).values(provisional_grade="大班")
    )
    await db_session.commit()
    enrolled = await transition(admin_client, record, "enrolled")
    assert (enrolled["provisional_grade"], enrolled["enrolled_on"]) == ("大班", today_local().isoformat())
    converted = [e for e in (await admin_client.get(f"{RECORDS}/{record['id']}/events")).json() if e["event_type"] == "converted"]
    assert converted[0]["metadata_json"] == {"website_manual": True, "grade": "大班", "school_year": 115, "semester": 1}

    no_year = await record_at_stage(admin_client, "deposited", child_name="沒學年")
    await db_session.execute(
        update(RecruitmentVisit).where(RecruitmentVisit.id == uuid.UUID(no_year["id"])).values(target_school_year=None)
    )
    await db_session.commit()
    response = await _post(admin_client, no_year, "enrolled", grade="小班")
    assert response.status_code == 422
    assert response.json()["detail"]["fields"] == ["target_school_year"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("start", "to_stage", "message"),
    [
        ("visited", "enrolled", "要先標記預繳"),
        ("visited", "withdrawn", "已訪視階段沒有可退的款項"),
        ("withdrawn", "enrolled", "取消退出"),
        ("deposited", "deposited", "已經在「已預繳」階段"),
    ],
)
async def test_disallowed_transitions_return_422(admin_client, start, to_stage, message):
    """R04 不允許的組合：422 TRANSITION_NOT_ALLOWED（調整 3），資料與版本不動。"""
    record = await record_at_stage(admin_client, start)
    response = await _post(admin_client, record, to_stage, reason="試試看", **ENROLL)
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "TRANSITION_NOT_ALLOWED"
    assert message in response.json()["detail"]["message"]
    current = (await admin_client.get(f"{RECORDS}/{record['id']}")).json()
    assert (current["stage"], current["version"]) == (start, record["version"])


@pytest.mark.asyncio
@pytest.mark.parametrize(("start", "to_stage"), [("enrolled", "deposited"), ("enrolled", "visited"), ("deposited", "withdrawn"), ("enrolled", "withdrawn")])
async def test_withdraw_and_revert_require_reason(admin_client, start, to_stage):
    record = await record_at_stage(admin_client, start)
    for reason in (None, "   "):
        response = await _post(admin_client, record, to_stage, reason=reason)
        assert response.status_code == 422, response.text
        assert response.json()["detail"]["code"] == "TRANSITION_FIELDS_REQUIRED"
        assert response.json()["detail"]["fields"] == ["reason"]
    assert (await admin_client.get(f"{RECORDS}/{record['id']}")).json()["version"] == record["version"]


@pytest.mark.asyncio
async def test_reception_writes_but_cannot_convert(admin_client, reception_yihua_client, campus_admin_yihua_client, editor_client):
    """R06：接待可以預繳、退預繳、取消退出；標記註冊、取消註冊、退註冊要 convert（403）。"""
    record = await create_record(admin_client)
    deposited = await transition(reception_yihua_client, record, "deposited")
    assert (await _post(reception_yihua_client, deposited, "enrolled", **ENROLL)).status_code == 403
    enrolled = await transition(campus_admin_yihua_client, deposited, "enrolled", **ENROLL)
    for to_stage in ("deposited", "visited", "withdrawn"):
        assert (await _post(reception_yihua_client, enrolled, to_stage, reason="家長延後")).status_code == 403, to_stage
    other = await record_at_stage(admin_client, "deposited", child_name="另一位")
    withdrawn = await transition(reception_yihua_client, other, "withdrawn", reason="改送他校")
    assert (await transition(reception_yihua_client, withdrawn, "deposited"))["stage"] == "deposited"
    assert (await _post(editor_client, enrolled, "withdrawn", reason="x")).status_code == 403


@pytest.mark.asyncio
async def test_stale_version_is_409_before_capability_check(admin_client, reception_yihua_client):
    """調整第 10 條：接待拿著舊畫面（卡片還在已預繳）要退預繳，但卡片其實已被
    註冊：回 409 重新載入，不是 403。版本對了才判斷權限。"""
    record = await record_at_stage(admin_client, "deposited")
    enrolled = await transition(admin_client, record, "enrolled", **ENROLL)
    stale = await _post(reception_yihua_client, record, "withdrawn", reason="改送他校")
    assert stale.status_code == 409, stale.text
    assert stale.json()["detail"]["code"] == "RECRUITMENT_VISIT_VERSION_CONFLICT"
    assert stale.json()["detail"]["current_version"] == enrolled["version"]
    fresh = await _post(reception_yihua_client, enrolled, "withdrawn", reason="改送他校")
    assert fresh.status_code == 403


@pytest.mark.asyncio
async def test_concurrent_transition_conflict(admin_client, campus_admin_yihua_client):
    """Review Focus 3／R05：兩人同時拖同一張卡（同一個版本），後送者 409，資料是先送者的結果。"""
    record = await record_at_stage(admin_client, "deposited")
    first, second = await asyncio.gather(
        _post(admin_client, record, "enrolled", **ENROLL),
        _post(campus_admin_yihua_client, record, "withdrawn", reason="改送他校"),
    )
    assert sorted([first.status_code, second.status_code]) == [200, 409], (first.text, second.text)
    winner, loser = (first, second) if first.status_code == 200 else (second, first)
    assert loser.json()["detail"]["code"] == "RECRUITMENT_VISIT_VERSION_CONFLICT"
    assert loser.json()["detail"]["current_version"] == winner.json()["version"]
    current = (await admin_client.get(f"{RECORDS}/{record['id']}")).json()
    assert (current["stage"], current["version"]) == (winner.json()["stage"], winner.json()["version"])
    moves = [e for e in await _events(admin_client, record) if e[0] in ("converted", "withdrawn")]
    assert len(moves) == 1


@pytest.mark.asyncio
async def test_board_groups_cards_by_stage_and_term(admin_client, minghua_client, editor_client, db_session):
    await create_record(admin_client, child_name="訪", visit_date="2026-09-01")
    await record_at_stage(admin_client, "deposited", child_name="預", visit_date="2026-09-02")
    await record_at_stage(admin_client, "enrolled", child_name="註", visit_date="2026-09-03")
    withdrawn = await record_at_stage(admin_client, "withdrawn", child_name="退", visit_date="2026-09-04")
    await create_record(admin_client, child_name="下學期", target_semester=2)
    await create_record(admin_client, child_name="明年", target_school_year=116)
    unscoped = await create_record(admin_client, child_name="沒學期")
    await create_record(admin_client, "minghua", child_name="明華")
    await db_session.execute(
        update(RecruitmentVisit)
        .where(RecruitmentVisit.id == uuid.UUID(unscoped["id"]))
        .values(target_school_year=None, target_semester=None)
    )
    await db_session.commit()

    response = await admin_client.get(f"{ADMISSIONS}/board?campus_key=yihua&school_year=115&semester=1")
    assert response.status_code == 200, response.text
    body = response.json()
    names = {stage: [card["child_name"] for card in cards] for stage, cards in body["columns"].items()}
    assert names == {"visited": ["訪"], "deposited": ["預"], "enrolled": ["註"], "withdrawn": ["退"]}
    assert (body["unscoped_count"], body["school_year"], body["semester"]) == (1, 115, 1)
    card = body["columns"]["withdrawn"][0]
    assert set(card) == {
        "id", "child_name", "grade", "provisional_grade", "target_school_year", "target_semester",
        "visit_date", "has_visit_request", "withdrawn_from", "version",
    }
    assert (card["withdrawn_from"], card["has_visit_request"], card["version"]) == ("deposited", False, withdrawn["version"])

    whole_year = (await admin_client.get(f"{ADMISSIONS}/board?campus_key=yihua&school_year=115")).json()
    assert [card["child_name"] for card in whole_year["columns"]["visited"]] == ["下學期", "訪"]
    assert whole_year["semester"] is None
    default = (await admin_client.get(f"{ADMISSIONS}/board?campus_key=yihua")).json()
    assert default["school_year"] == academic.current_term(today_local())[0]
    assert (await minghua_client.get(f"{ADMISSIONS}/board?campus_key=yihua&school_year=115")).status_code == 404
    assert (await editor_client.get(f"{ADMISSIONS}/board?campus_key=yihua&school_year=115")).status_code == 403


@pytest.mark.asyncio
async def test_transition_audit_has_no_free_text(admin_client, db_session):
    record = await record_at_stage(admin_client, "deposited")
    await transition(admin_client, record, "withdrawn", reason="家長說孩子叫小明，住中正路")
    entries = (
        await db_session.execute(
            select(AuditLogEntry)
            .where(AuditLogEntry.action == "recruitment_visit.transition")
            .order_by(AuditLogEntry.created_at)
        )
    ).scalars().all()
    assert [e.metadata_json for e in entries] == [
        {"from_stage": "visited", "to_stage": "deposited", "has_reason": False},
        {"from_stage": "deposited", "to_stage": "withdrawn", "has_reason": True},
    ]
    assert entries[-1].target_type == "recruitment_visit" and entries[-1].target_id == record["id"]
    assert "小明" not in json.dumps([e.metadata_json for e in entries], ensure_ascii=False)
