"""總覽「我承辦的案件」與「承辦人已停用、還沒結案」（2026-10-03 第八輪）。"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import update

from app.auth.models import Role
from app.booking.models import VisitRequest
from tests.conftest import _create_user, _logged_in_client, legacy_request

pytestmark = pytest.mark.usefixtures("booking_consent")

BASE = "/api/website/v1/admin"


@pytest.mark.asyncio
async def test_my_open_cases_and_inactive_assignee(app, admin_client, minghua_client, db_session):
    colleague = await _create_user(
        db_session, "yihua-staff@ivy.example", "yihua-staff-password-123", Role.CAMPUS_ADMIN, ["yihua"]
    )
    await db_session.commit()
    open_case = await legacy_request(db_session, status="confirmed", parent_name="王媽媽", phone="0912000901")
    closed_case = await legacy_request(db_session, status="cancelled", parent_name="李媽媽", phone="0912000902")
    await db_session.execute(
        update(VisitRequest)
        .where(VisitRequest.id.in_([uuid.UUID(open_case), uuid.UUID(closed_case)]))
        .values(assigned_staff_id=colleague.id)
    )
    await db_session.commit()

    colleague_client = await _logged_in_client(app, "yihua-staff@ivy.example", "yihua-staff-password-123")
    try:
        dashboard = (await colleague_client.get(f"{BASE}/dashboard")).json()
        assert dashboard["my_open_cases"] == 1
        mine = await colleague_client.get(f"{BASE}/visit-requests?assignee=me&open=true")
        assert [row["id"] for row in mine.json()] == [open_case]
    finally:
        await colleague_client.aclose()

    admin_dashboard = (await admin_client.get(f"{BASE}/dashboard")).json()
    assert admin_dashboard["my_open_cases"] == 0
    assert admin_dashboard["inactive_assignee_open_cases"] == 0

    colleague.is_active = False
    await db_session.commit()

    assert (await admin_client.get(f"{BASE}/dashboard")).json()["inactive_assignee_open_cases"] == 1
    inactive = await admin_client.get(f"{BASE}/visit-requests?assignee=inactive&open=true")
    assert [row["id"] for row in inactive.json()] == [open_case]
    counts = (await admin_client.get(f"{BASE}/visit-requests/group-counts?assignee=inactive&open=true")).json()
    assert sum(counts.values()) == 1
    # 別校的校區管理者看不到義華的件數。
    assert (await minghua_client.get(f"{BASE}/dashboard")).json()["inactive_assignee_open_cases"] == 0


@pytest.mark.asyncio
async def test_inactive_assignee_count_only_for_booking_managers(app, db_session):
    await _create_user(db_session, "desk@ivy.example", "desk-password-1234567", Role.RECEPTION, ["yihua"])
    await db_session.commit()
    desk = await _logged_in_client(app, "desk@ivy.example", "desk-password-1234567")
    try:
        dashboard = (await desk.get(f"{BASE}/dashboard")).json()
        assert dashboard["my_open_cases"] == 0
        assert "inactive_assignee_open_cases" not in dashboard
    finally:
        await desk.aclose()


@pytest.mark.asyncio
async def test_open_filter_reaches_export_audit_metadata(admin_client, db_session):
    from sqlalchemy import select

    from app.operations.models import AuditLogEntry

    open_case = await legacy_request(db_session, status="confirmed", parent_name="王媽媽", phone="0912000911")
    await legacy_request(db_session, status="cancelled", parent_name="李媽媽", phone="0912000912")
    resp = await admin_client.get(f"{BASE}/visit-requests/export?campus_key=yihua&open=true")
    assert resp.status_code == 200
    assert "王媽媽" in resp.text and "李媽媽" not in resp.text
    audit = (
        await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "visit_request.export"))
    ).scalars().one()
    assert audit.metadata_json["open"] is True
    assert open_case
