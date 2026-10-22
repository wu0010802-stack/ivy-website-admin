"""2026-10-22 資安稽核的回歸測試（同檔放不屬於單一模組的幾條）。"""

from __future__ import annotations

import pytest


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "path",
    [
        "/api/website/v1/admin/visit-requests",
        "/api/website/v1/admin/admissions/records",
        "/api/website/v1/admin/admissions/follow-ups",
        "/api/website/v1/admin/admissions/no-deposit-records",
    ],
)
async def test_huge_page_number_is_rejected_not_a_500(admin_client, path):
    """頁碼沒有上限時 (page-1)*page_size 超出 PostgreSQL bigint，asyncpg 編碼失敗回 500。"""
    response = await admin_client.get(path, params={"campus_key": "yihua", "page": 10**19})
    assert response.status_code == 422, response.text
    ok = await admin_client.get(path, params={"campus_key": "yihua", "page": 100_000})
    assert ok.status_code == 200, ok.text


# ---------------------------------------------------------------------------
# 家長自己改 Email：通知舊信箱
# ---------------------------------------------------------------------------

BASE = "/api/website/v1"
ORIGIN = "https://www.ivy.example"


async def _change_email(admin_client, public_client, *, old: str, new: str, key: str):
    from tests.conftest import book_slot, open_manage

    booked = await book_slot(admin_client, public_client, email=old, idempotency_key=key)
    await open_manage(public_client, booked["manage_path"])
    response = await public_client.patch(
        f"{BASE}/public/visit-manage/me",
        json={"visit_request_id": booked["receipt_id"], "expected_version": 1, "email": new},
    )
    assert response.status_code == 200, response.text
    return booked["receipt_id"]


async def _run_worker(db_session, app, adapter):
    from app.workers.runner import process_outbox_batch

    return await process_outbox_batch(
        db_session, adapter, limit=50, admin_origin=ORIGIN, access_secret=app.state.settings.session_secret
    )


async def _notices(db_session, receipt: str):
    import uuid

    from sqlalchemy import select

    from app.booking.models import OutboxMessage
    from app.booking.outbox import PARENT_EMAIL_CHANGED

    rows = await db_session.execute(
        select(OutboxMessage)
        .where(OutboxMessage.visit_request_id == uuid.UUID(receipt), OutboxMessage.kind == PARENT_EMAIL_CHANGED)
        .execution_options(populate_existing=True)
    )
    return list(rows.scalars())


@pytest.mark.asyncio
@pytest.mark.usefixtures("booking_consent")
async def test_parent_changing_email_notifies_the_old_address_without_link_or_new_address(
    app, admin_client, public_client, db_session, recording_mail_adapter
):
    receipt = await _change_email(admin_client, public_client, old="mom@example.com", new="other@example.com", key="sec-old-1")

    [queued] = await _notices(db_session, receipt)
    assert queued.payload["old_email"] == "mom@example.com"
    await _run_worker(db_session, app, recording_mail_adapter)

    to_old = [mail for mail in recording_mail_adapter.sent if mail["to"] == "mom@example.com"]
    assert len(to_old) == 1
    mail = to_old[0]
    assert "Email 已變更" in mail["subject"]
    assert "如果這不是您本人的操作" in mail["body"]
    for leaked in ("token=", "other@example.com", ORIGIN, "/visit/manage"):
        assert leaked not in mail["body"], leaked
    # 寄出後 payload 不再留舊信箱；重跑 worker 不會再寄。
    [sent] = await _notices(db_session, receipt)
    assert sent.status == "sent" and "old_email" not in sent.payload
    await _run_worker(db_session, app, recording_mail_adapter)
    assert len([m for m in recording_mail_adapter.sent if m["to"] == "mom@example.com"]) == 1


@pytest.mark.asyncio
@pytest.mark.usefixtures("booking_consent")
async def test_reclaimed_notice_that_was_already_sent_counts_as_sent(
    app, admin_client, public_client, db_session, recording_mail_adapter
):
    """寄出、記了送達後 ack 前程序中斷：租約過期再被認領時 payload 已沒有舊信箱，要回 True（標 sent）、不重寄。"""
    from app.notifications import service as notification_service

    receipt = await _change_email(admin_client, public_client, old="mom@example.com", new="x@example.com", key="sec-old-6")
    [notice] = await _notices(db_session, receipt)
    payload = dict(notice.payload)

    async def dispatch(current_payload):
        return await notification_service.dispatch_outbox_message(
            db_session, outbox_message_id=notice.id, campus_key="yihua", kind=notice.kind,
            payload=current_payload, adapter=recording_mail_adapter, created_at=notice.created_at,
        )

    assert await dispatch(payload) is True
    [stripped] = await _notices(db_session, receipt)
    assert "old_email" not in stripped.payload
    assert await dispatch(dict(stripped.payload)) is True
    assert len([m for m in recording_mail_adapter.sent if m["to"] == "mom@example.com"]) == 1


@pytest.mark.asyncio
@pytest.mark.usefixtures("booking_consent")
async def test_case_only_email_change_does_not_notify_old_address(admin_client, public_client, db_session):
    receipt = await _change_email(admin_client, public_client, old="mom@example.com", new="Mom@Example.com", key="sec-old-2")
    assert await _notices(db_session, receipt) == []


@pytest.mark.asyncio
@pytest.mark.usefixtures("booking_consent")
async def test_notice_is_skipped_and_forgets_old_address_when_mail_is_not_configured(
    app, admin_client, public_client, db_session
):
    receipt = await _change_email(admin_client, public_client, old="mom@example.com", new="x@example.com", key="sec-old-3")
    await _run_worker(db_session, app, None)
    [skipped] = await _notices(db_session, receipt)
    assert skipped.status == "skipped" and "old_email" not in skipped.payload


@pytest.mark.asyncio
@pytest.mark.usefixtures("booking_consent")
async def test_anonymizing_clears_old_address_left_on_a_failed_notice(app, admin_client, public_client, db_session):
    import uuid

    from sqlalchemy import update

    from app.booking.models import OutboxMessage, VisitRequest
    from app.operations import retention_service

    receipt = await _change_email(admin_client, public_client, old="mom@example.com", new="x@example.com", key="sec-old-4")
    [notice] = await _notices(db_session, receipt)
    await db_session.execute(update(OutboxMessage).where(OutboxMessage.id == notice.id).values(status="failed"))
    await db_session.commit()

    visit = await db_session.get(VisitRequest, uuid.UUID(receipt))
    assert await retention_service.anonymize(db_session, visit)
    await db_session.commit()
    [cleared] = await _notices(db_session, receipt)
    assert "old_email" not in cleared.payload and cleared.payload["receipt_id"] == receipt


@pytest.mark.asyncio
@pytest.mark.usefixtures("booking_consent")
async def test_staff_correcting_email_still_does_not_notify_old_address(admin_client, public_client, db_session):
    """後台改 Email 是在更正打錯的信箱，舊信箱可能是陌生人，維持不通知。"""
    from tests.conftest import book_slot

    booked = await book_slot(admin_client, public_client, email="typo@example.com", idempotency_key="sec-old-5")
    receipt = booked["receipt_id"]
    response = await admin_client.patch(
        f"{BASE}/admin/visit-requests/{receipt}/details",
        json={"expected_version": 1, "email": "right@example.com"},
    )
    assert response.status_code == 200, response.text
    assert await _notices(db_session, receipt) == []


# ---------------------------------------------------------------------------
# 搜尋字走 X-Ivy-Search header，不放網址
# ---------------------------------------------------------------------------


def _search_header(**fields) -> dict[str, str]:
    import json
    from urllib.parse import quote

    return {"X-Ivy-Search": quote(json.dumps(fields, ensure_ascii=False), safe="")}


@pytest.mark.asyncio
@pytest.mark.usefixtures("booking_consent")
async def test_visit_requests_search_and_export_read_the_search_header(admin_client, public_client):
    from tests.conftest import book_slot

    await book_slot(admin_client, public_client, idempotency_key="sec-search-1")
    path = f"{BASE}/admin/visit-requests"

    hit = await admin_client.get(path, headers=_search_header(q="陳媽媽"))
    assert hit.status_code == 200, hit.text
    assert len(hit.json()) == 1
    miss = await admin_client.get(path, headers=_search_header(q="0999000111"))
    assert miss.json() == []
    # header 優先於查詢參數（舊版後台還在送 ?q= 時也不會兩邊打架）。
    assert (await admin_client.get(path, params={"q": "0999000111"}, headers=_search_header(q="0912345678"))).json()
    counts = await admin_client.get(f"{path}/view-counts", headers=_search_header(q="0999000111"))
    assert counts.status_code == 200, counts.text
    assert counts.json()["upcoming"] == 0

    export = await admin_client.get(f"{path}/export", headers=_search_header(q="0999000111"))
    assert export.status_code == 200, export.text
    assert "0912345678" not in export.text


@pytest.mark.asyncio
async def test_admissions_records_read_search_referrer_and_source_from_header(admin_client):
    from tests.admissions_helpers import create_record

    await create_record(admin_client, child_name="林小安", referrer="王小美媽媽", source="哥哥在本園")
    await create_record(admin_client, child_name="張小樂")
    path = f"{BASE}/admin/admissions/records"

    async def names(**fields):
        response = await admin_client.get(path, params={"campus_key": "yihua"}, headers=_search_header(**fields))
        assert response.status_code == 200, response.text
        return sorted(row["child_name"] for row in response.json())

    assert await names(q="林小安") == ["林小安"]
    assert await names(referrer="王小美媽媽") == ["林小安"]
    assert await names(source="哥哥在本園") == ["林小安"]
    assert await names(q=None) == ["張小樂", "林小安"]
    export = await admin_client.get(
        f"{path}/export", params={"campus_key": "yihua"}, headers=_search_header(referrer="王小美媽媽")
    )
    assert export.status_code == 200, export.text
    assert "林小安" in export.text and "張小樂" not in export.text


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "value",
    [
        "%E0%A4%A",  # 不完整的百分比編碼
        "not-json",
        "%5B%5D",  # []
        "%7B%22other%22%3A%22x%22%7D",  # 不收的鍵
        "%7B%22q%22%3A1%7D",  # 型別不對
        "%7B%22q%22%3A%22" + "a" * 101 + "%22%7D",  # 超過長度
        "%7B%22q%22%3A%22a%5Cu0000%22%7D",  # 控制字元（NUL 送到 PostgreSQL 會 500）
    ],
)
@pytest.mark.parametrize(
    "path", ["/admin/visit-requests", "/admin/admissions/records?campus_key=yihua"]
)
async def test_malformed_search_header_is_rejected(admin_client, value, path):
    response = await admin_client.get(f"{BASE}{path}", headers={"X-Ivy-Search": value})
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "INVALID_SEARCH_HEADER"
