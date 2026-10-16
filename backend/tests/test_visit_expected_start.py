"""預計入學時間：官網送單、後台補登、明細、防重複與 CSV（2026-10-15 規格 X1、X6–X9）。"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select, update

from app.admissions import academic
from app.booking import expected_start
from app.booking.models import VisitRequest
from app.booking.schemas import VisitRequestCreate
from app.common.timezones import today_local
from tests.conftest import VISIT_SUBMIT_PATH, book_slot, create_slot, set_booking_mode

pytestmark = pytest.mark.usefixtures("booking_consent")
API = "/api/website/v1"


def _first_month_choice() -> str:
    """官網選項裡「盡快」後面的第一個學期。"""
    return expected_start.public_choices(today_local())[1]["value"]


def _term_after(offset: int) -> str:
    """今天所在學期往後 offset 個學期（負數往前）。"""
    year, semester = academic.current_term(today_local())
    index = year * 2 + semester - 1 + offset
    return expected_start.format_term((index // 2, index % 2 + 1))


async def _detail(admin_client, receipt_id: str) -> dict:
    response = await admin_client.get(f"{API}/admin/visit-requests/{receipt_id}")
    assert response.status_code == 200, response.text
    return response.json()


async def _public_body(admin_client, **fields) -> dict:
    """官網送單的 body（已建好場次並切到自選場次）；fields 覆蓋或追加欄位。"""
    slot_id = await create_slot(admin_client)
    mode = await set_booking_mode(admin_client, "yihua", mode="slots")
    return {
        "campus_key": "yihua", "config_version": mode.json()["version"], "parent_name": "陳媽媽", "phone": "0912345678",
        "slot_id": slot_id, **fields,
    }


async def _manual(admin_client, key: str, *, hour: int = 10, **fields):
    """後台補登一筆；同一個測試補登多筆時用 hour 錯開場次（同校同時段只能有一場）。"""
    slot_id = await create_slot(admin_client, days_ahead=1, start_time=f"{hour:02d}:00:00", end_time=f"{hour:02d}:30:00")
    return await admin_client.post(
        f"{API}/admin/visit-requests",
        json={"campus_key": "yihua", "source": "phone", "parent_name": "王先生", "phone": "0933111222",
              "slot_id": slot_id, **fields},
        headers={"Idempotency-Key": key},
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("choice", ["asap", "unsure", "month"])
async def test_submission_stores_the_choice(admin_client, public_client, choice):
    value = _first_month_choice() if choice == "month" else choice
    booked = await book_slot(admin_client, public_client, expected_start=value)
    assert booked["response"].status_code == 201
    assert (await _detail(admin_client, booked["receipt_id"]))["expected_start"] == value


@pytest.mark.asyncio
async def test_submission_without_the_question_still_works(admin_client, public_client):
    booked = await book_slot(admin_client, public_client)
    assert (await _detail(admin_client, booked["receipt_id"]))["expected_start"] is None


@pytest.mark.asyncio
async def test_null_choice_is_accepted_and_stored_as_null(admin_client, public_client, db_session):
    # 選填欄位明確送 null（取消選取後送出）不能變成 500：驗證器要先擋掉 None 再解析。
    booked = await book_slot(admin_client, public_client, expected_start=None)
    manual = await _manual(admin_client, "manual-null-start", hour=11, expected_start=None)
    assert booked["response"].status_code == 201, booked["response"].text
    assert manual.status_code == 201, manual.text
    stored = (await db_session.execute(select(VisitRequest.expected_start))).scalars().all()
    assert len(stored) == 2 and stored == [None, None]
    assert manual.json()["expected_start"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", ["past", "far", "200-1", "115-3", "soon", "115-2\n"])
async def test_out_of_range_or_malformed_choice_points_at_the_field(admin_client, public_client, bad):
    value = {"past": _term_after(-2), "far": _term_after(expected_start.PUBLIC_TERMS_AHEAD + 1)}.get(bad, bad)
    body = await _public_body(admin_client)
    rejected = await public_client.post(
        VISIT_SUBMIT_PATH, json={**body, "expected_start": value}, headers={"Idempotency-Key": f"start-{uuid.uuid4()}"}
    )
    assert rejected.status_code == 422, rejected.text
    assert ["body", "expected_start"] in [error["loc"] for error in rejected.json()["detail"]]
    # 正向對照：同一份 body 只換成官網選項裡的學期就送得出去，所以被擋的原因只是 expected_start。
    accepted = await public_client.post(
        VISIT_SUBMIT_PATH,
        json={**body, "expected_start": _first_month_choice()},
        headers={"Idempotency-Key": f"start-{uuid.uuid4()}"},
    )
    assert accepted.status_code == 201, accepted.text


@pytest.mark.asyncio
async def test_the_fifth_term_ahead_is_still_accepted(admin_client, public_client):
    # 規格 X7：公開端多留一個學期（官網只列四個），跨學期仍開著的舊頁面送得出去。
    last = _term_after(expected_start.PUBLIC_TERMS_AHEAD)
    assert last not in {choice["value"] for choice in expected_start.public_choices(today_local())}
    body = await _public_body(admin_client, expected_start=last)
    response = await public_client.post(VISIT_SUBMIT_PATH, json=body, headers={"Idempotency-Key": "start-fifth-term"})
    assert response.status_code == 201, response.text
    assert (await _detail(admin_client, response.json()["receipt_id"]))["expected_start"] == last


@pytest.mark.asyncio
async def test_replay_with_the_same_choice_returns_the_same_case(admin_client, public_client):
    body = await _public_body(admin_client, expected_start="asap")
    headers = {"Idempotency-Key": "start-replay-01"}
    first = await public_client.post(VISIT_SUBMIT_PATH, json=body, headers=headers)
    again = await public_client.post(VISIT_SUBMIT_PATH, json=body, headers=headers)
    changed = await public_client.post(VISIT_SUBMIT_PATH, json={**body, "expected_start": "unsure"}, headers=headers)
    assert first.status_code == 201, first.text
    assert again.status_code == 200 and again.json()["receipt_id"] == first.json()["receipt_id"]
    assert changed.status_code == 409, changed.text


@pytest.mark.asyncio
async def test_replay_treats_a_null_choice_and_an_absent_one_as_the_same_submission(admin_client, public_client):
    # 新頁面取消選取後送 null，更新前的舊頁面完全不帶這個欄位：同一把 key 重送是同一筆，不是 409。
    body = await _public_body(admin_client)
    headers = {"Idempotency-Key": "start-null-vs-absent"}
    first = await public_client.post(VISIT_SUBMIT_PATH, json={**body, "expected_start": None}, headers=headers)
    again = await public_client.post(VISIT_SUBMIT_PATH, json=body, headers=headers)
    assert first.status_code == 201, first.text
    assert again.status_code == 200 and again.json()["receipt_id"] == first.json()["receipt_id"]


@pytest.mark.asyncio
async def test_a_case_stored_before_this_release_is_still_recognised_on_retry(admin_client, public_client, db_session):
    # 部署當下，更新前的舊頁面對已建立的案件重送同一把 Idempotency-Key：存的 hash 是舊程式算的，
    # payload 裡根本沒有 expected_start 這個鍵。新程式算出來的 hash 要一樣，不然會回 409。
    body = await _public_body(admin_client)
    headers = {"Idempotency-Key": "start-legacy-retry"}
    first = await public_client.post(VISIT_SUBMIT_PATH, json=body, headers=headers)
    assert first.status_code == 201, first.text
    legacy = VisitRequestCreate.model_validate({**body, "email": "parent@example.com"}).model_dump(
        mode="json", exclude={"campus_key", "config_version", "consent_revision_id", "turnstile_token", "expected_start"}
    )
    for field in ("child_name", "child_birthdate", "referral_sources", "party_size"):
        legacy.pop(field)
    assert "expected_start" not in legacy and legacy["email"] == "parent@example.com"
    await db_session.execute(
        update(VisitRequest)
        .where(VisitRequest.id == uuid.UUID(first.json()["receipt_id"]))
        .values(payload_hash=hashlib.sha256(json.dumps(legacy, sort_keys=True, ensure_ascii=True).encode()).hexdigest())
    )
    await db_session.commit()
    again = await public_client.post(VISIT_SUBMIT_PATH, json=body, headers=headers)
    changed = await public_client.post(VISIT_SUBMIT_PATH, json={**body, "expected_start": "asap"}, headers=headers)
    assert again.status_code == 200 and again.json()["receipt_id"] == first.json()["receipt_id"], again.text
    assert changed.status_code == 409, changed.text


@pytest.mark.asyncio
async def test_manual_entry_accepts_a_past_term(admin_client):
    response = await _manual(admin_client, "manual-start-01", expected_start="110-1")
    assert response.status_code == 201, response.text
    assert response.json()["expected_start"] == "110-1"


@pytest.mark.asyncio
async def test_manual_entry_still_checks_the_format(admin_client):
    # 後台只驗格式與學年 100–199（規格 X8）：過去的學期可以，亂填不行。
    rejected = await _manual(admin_client, "manual-start-bad", expected_start="soon")
    assert rejected.status_code == 422, rejected.text
    assert ["body", "expected_start"] in [error["loc"] for error in rejected.json()["detail"]]
    accepted = await _manual(admin_client, "manual-start-good", hour=11, expected_start="110-2")
    assert accepted.status_code == 201, accepted.text


def _export_rows(content: bytes) -> dict[str, dict[str, str]]:
    return {row["家長"]: row for row in csv.DictReader(io.StringIO(content.decode("utf-8-sig")))}


@pytest.mark.asyncio
async def test_export_writes_the_label(admin_client, public_client):
    value = _first_month_choice()
    await book_slot(admin_client, public_client, expected_start=value)
    response = await admin_client.get(f"{API}/admin/visit-requests/export?campus_key=yihua")
    assert response.status_code == 200, response.text
    [row] = list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))
    assert row["預計入學"] == expected_start.display_label(value, today_local())


@pytest.mark.asyncio
async def test_export_cell_is_blank_when_nothing_was_chosen_and_spells_out_the_other_choices(admin_client):
    for index, (name, start) in enumerate((("沒選", None), ("不確定", "unsure"), ("舊學期", "110-1"))):
        response = await _manual(
            admin_client, f"export-{index}", hour=10 + index, parent_name=name, phone=f"093311120{index}",
            expected_start=start,
        )
        assert response.status_code == 201, response.text
    export = await admin_client.get(f"{API}/admin/visit-requests/export?campus_key=yihua")
    assert export.status_code == 200, export.text
    rows = _export_rows(export.content)
    assert rows["沒選"]["預計入學"] == ""
    assert rows["不確定"]["預計入學"] == "還不確定"
    assert rows["舊學期"]["預計入學"] == "2021 年 9 月（110 學年上學期）"


@pytest.mark.asyncio
async def test_export_converts_asap_with_the_term_of_the_submission_date(admin_client, public_client, db_session):
    # 「盡快」換算的是送單當時的學期，不是匯出當天：把送單時間挪到 2020-03-01（台北）再匯出。
    booked = await book_slot(admin_client, public_client, expected_start="asap")
    await db_session.execute(
        update(VisitRequest)
        .where(VisitRequest.id == uuid.UUID(booked["receipt_id"]))
        .values(created_at=datetime(2020, 3, 1, 12, 0, tzinfo=ZoneInfo("Asia/Taipei")))
    )
    await db_session.commit()
    response = await admin_client.get(f"{API}/admin/visit-requests/export?campus_key=yihua")
    assert response.status_code == 200, response.text
    [row] = list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))
    assert row["預計入學"] == "盡快（送單時是 108 學年下學期）"

