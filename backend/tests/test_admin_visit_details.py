"""後台修改家長資料（2026-10-12 規格 3.1、3.2）。

接待人員打錯電話、Email、孩子姓名或生日時，在案件明細就能改：
- 版本與家長端共用 details_version，兩邊同時改後送者 409。
- 歷程、稽核只記欄位名，不記內容。
- 招生訪視那筆「仍是當初帶過去的值」的欄位才一起改，招生端另外改過的不動。
"""

from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta, timezone

from types import SimpleNamespace

import pytest
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import select, update

from app.admissions import academic, constants
from app.admissions.models import RecruitmentVisit
from app.auth.models import Role
from app.auth.permissions import _CAPABILITY_ROLES
from app.booking import workflow_service
from app.booking.models import OutboxMessage, VisitRequest, VisitRequestEvent
from app.common.timezones import today_local
from app.main import create_app
from app.operations.models import AuditLogEntry
from app.workers.runner import process_outbox_batch
from tests.admissions_helpers import (  # noqa: F401
    ADMISSIONS,
    API,
    complete,
    reception_yihua_client,
    started_booking,
    unique_phone,
)
from tests.conftest import (
    _logged_in_client,
    _test_settings,
    book_slot,
    legacy_request,
    open_manage,
)

pytestmark = pytest.mark.usefixtures("booking_consent")

CASES = f"{API}/admin/visit-requests"
PARENT_MANAGE = f"{API}/public/visit-manage"
# 測試用的個資字串：歷程與稽核的內容裡不能出現。
OLD_PHONE = "0911000111"
NEW_PHONE = "0922333444"
NEW_EMAIL = "new-parent@example.com"
BIRTHDAY = date(2023, 3, 2)


async def _patch(client, case_id, **body):
    return await client.patch(f"{CASES}/{case_id}/details", json=body)


async def _version(client, case_id) -> int:
    detail = await client.get(f"{CASES}/{case_id}")
    assert detail.status_code == 200, detail.text
    return detail.json()["details_version"]


async def _case(db_session, case_id) -> VisitRequest:
    return (
        await db_session.execute(
            select(VisitRequest).where(VisitRequest.id == uuid.UUID(str(case_id))).execution_options(populate_existing=True)
        )
    ).scalar_one()


async def _events(db_session, case_id, event_type="details_updated") -> list[VisitRequestEvent]:
    result = await db_session.execute(
        select(VisitRequestEvent)
        .where(VisitRequestEvent.visit_request_id == uuid.UUID(str(case_id)), VisitRequestEvent.event_type == event_type)
        .order_by(VisitRequestEvent.created_at)
    )
    return list(result.scalars())


async def _audit(db_session, action: str) -> list[AuditLogEntry]:
    result = await db_session.execute(
        select(AuditLogEntry).where(AuditLogEntry.action == action).order_by(AuditLogEntry.created_at)
    )
    return list(result.scalars())


async def _changed_mail_count(db_session, case_id) -> int:
    kinds = (
        await db_session.execute(
            select(OutboxMessage.kind).where(OutboxMessage.visit_request_id == uuid.UUID(str(case_id)))
        )
    ).scalars().all()
    return kinds.count("parent_visit_changed")


async def _recruitment(db_session, case_id) -> SimpleNamespace:
    """招生訪視的欄位快照。回傳的不是 ORM 物件：同一個 session 重讀會更新同一個物件，
    前後對照的測試會拿它跟自己比。"""
    row = (
        await db_session.execute(
            select(RecruitmentVisit)
            .where(RecruitmentVisit.visit_request_id == uuid.UUID(str(case_id)))
            .execution_options(populate_existing=True)
        )
    ).scalar_one()
    return SimpleNamespace(**{attr.key: getattr(row, attr.key) for attr in sa_inspect(row).mapper.column_attrs})


async def _completed_with_recruitment(admin_client, public_client, db_session, **fields) -> dict:
    """已開始的預約 → 標記已到場（同一個交易建招生訪視）。回傳 started_booking 的內容。"""
    fields.setdefault("child_name", "王小明")
    fields.setdefault("child_birthdate", BIRTHDAY.isoformat())
    booking = await started_booking(admin_client, public_client, db_session, **fields)
    done = await complete(admin_client, booking["id"])
    assert done.status_code == 200, done.text
    return booking


def _grade(birthday: date) -> str | None:
    school_year, _ = academic.current_term(today_local())
    return academic.grade_for_birthday(birthday, school_year)


# ---------------------------------------------------------------- 3.1 API


@pytest.mark.asyncio
async def test_changing_phone_records_history_and_audit_without_personal_data(
    admin_client, public_client, db_session
):
    """情境 1：只改電話。版本 +1、歷程 staff、稽核有，兩者只記欄位名。"""
    booking = await started_booking(admin_client, public_client, db_session, phone=OLD_PHONE)
    case_id = booking["id"]
    before = await _version(admin_client, case_id)

    response = await _patch(admin_client, case_id, expected_version=before, phone=NEW_PHONE)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["changed_fields"] == ["phone"]
    assert body["phone"] == NEW_PHONE
    assert body["details_version"] == before + 1
    assert body["admissions_synced_fields"] == [] and body["admissions_skipped_fields"] == []
    assert body["email_notified"] is False
    assert await _version(admin_client, case_id) == before + 1
    [event] = await _events(db_session, case_id)
    assert event.after == {"fields": ["phone"]}
    assert event.source == "staff" and event.actor_user_id is not None
    [entry] = await _audit(db_session, "visit_request.update_details")
    assert entry.target_type == "visit_request" and entry.target_id == str(case_id)
    assert entry.campus_key == "yihua"
    assert entry.metadata_json == {"fields": ["phone"]}
    dumped = json.dumps([event.before, event.after, event.reason, entry.metadata_json], ensure_ascii=False)
    assert OLD_PHONE not in dumped and NEW_PHONE not in dumped
    # 回應的歷程也帶著這筆。
    assert [h["event_type"] for h in body["history"]].count("details_updated") == 1


@pytest.mark.asyncio
async def test_no_change_writes_nothing(admin_client, public_client, db_session):
    """情境 2：送出的值和現值一樣 → 200、changed_fields 空，沒有歷程、稽核、排信，版本不動。"""
    booking = await started_booking(admin_client, public_client, db_session, phone=OLD_PHONE, child_name="王小明")
    case_id = booking["id"]
    version = await _version(admin_client, case_id)
    mails = await _changed_mail_count(db_session, case_id)

    response = await _patch(
        admin_client, case_id, expected_version=version, phone=OLD_PHONE, parent_name="陳媽媽", child_name="王小明"
    )

    assert response.status_code == 200, response.text
    assert response.json()["changed_fields"] == []
    assert response.json()["details_version"] == version
    assert await _events(db_session, case_id) == []
    assert await _audit(db_session, "visit_request.update_details") == []
    assert await _changed_mail_count(db_session, case_id) == mails


@pytest.mark.asyncio
async def test_stale_expected_version_is_409(admin_client, public_client, db_session):
    """情境 3：expected_version 不是目前的版本 → 409，什麼都沒寫。"""
    booking = await started_booking(admin_client, public_client, db_session, phone=OLD_PHONE)
    case_id = booking["id"]
    version = await _version(admin_client, case_id)

    stale = await _patch(admin_client, case_id, expected_version=version + 1, phone=NEW_PHONE)

    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "VISIT_REQUEST_VERSION_CONFLICT"
    assert stale.json()["detail"]["current_version"] == version
    assert (await _case(db_session, case_id)).phone == OLD_PHONE
    assert await _events(db_session, case_id) == []
    # 沒帶版本 → 422，不能略過樂觀鎖。
    missing = await _patch(admin_client, case_id, phone=NEW_PHONE)
    assert missing.status_code == 422


@pytest.mark.asyncio
async def test_parent_and_staff_share_one_version_in_both_directions(admin_client, public_client, db_session):
    """情境 4（Review Focus 1）：家長先用修改連結改過，後台拿舊版本送 → 409，不覆蓋家長剛改的；
    反過來後台先改，家長拿舊版本送也 409。"""
    booked = await book_slot(admin_client, public_client, phone=OLD_PHONE)
    case_id = booked["receipt_id"]
    me = await open_manage(public_client, booked["manage_path"])
    opened_version = await _version(admin_client, case_id)
    assert opened_version == me["version"]

    parent_edit = await public_client.patch(
        f"{PARENT_MANAGE}/me",
        json={"visit_request_id": case_id, "expected_version": me["version"], "party_size": 4},
    )
    assert parent_edit.status_code == 200, parent_edit.text

    stale = await _patch(admin_client, case_id, expected_version=opened_version, phone=NEW_PHONE)
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "VISIT_REQUEST_VERSION_CONFLICT"
    assert (await _case(db_session, case_id)).phone == OLD_PHONE

    current = await _version(admin_client, case_id)
    assert current == opened_version + 1
    staff_edit = await _patch(admin_client, case_id, expected_version=current, phone=NEW_PHONE)
    assert staff_edit.status_code == 200, staff_edit.text

    parent_stale = await public_client.patch(
        f"{PARENT_MANAGE}/me",
        json={"visit_request_id": case_id, "expected_version": current, "party_size": 5},
    )
    assert parent_stale.status_code == 409
    assert parent_stale.json()["detail"]["code"] == "VISIT_REQUEST_VERSION_CONFLICT"
    assert (await _case(db_session, case_id)).party_size == 4


@pytest.mark.asyncio
async def test_anonymized_case_is_409(admin_client, public_client, db_session):
    """情境 5：已依保存政策匿名化的案件不能再改。"""
    booking = await started_booking(admin_client, public_client, db_session, phone=OLD_PHONE)
    case_id = booking["id"]
    version = await _version(admin_client, case_id)
    await db_session.execute(
        update(VisitRequest).where(VisitRequest.id == uuid.UUID(case_id)).values(anonymized_at=datetime.now(timezone.utc))
    )
    await db_session.commit()

    response = await _patch(admin_client, case_id, expected_version=version, phone=NEW_PHONE)

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "VISIT_REQUEST_ANONYMIZED"
    assert (await _case(db_session, case_id)).phone == OLD_PHONE


@pytest.mark.asyncio
async def test_detail_reports_anonymized_flag(admin_client, public_client, db_session):
    """案件明細帶 anonymized：後台不必靠稱呼字串猜；一般案件 false，匿名化之後 true。"""
    booking = await started_booking(admin_client, public_client, db_session, phone=OLD_PHONE)
    case_id = booking["id"]

    before = await admin_client.get(f"{CASES}/{case_id}")
    assert before.status_code == 200, before.text
    assert before.json()["anonymized"] is False

    await db_session.execute(
        update(VisitRequest).where(VisitRequest.id == uuid.UUID(case_id)).values(anonymized_at=datetime.now(timezone.utc))
    )
    await db_session.commit()

    after = await admin_client.get(f"{CASES}/{case_id}")
    assert after.status_code == 200, after.text
    assert after.json()["anonymized"] is True


@pytest.mark.asyncio
async def test_validation_rules(admin_client, public_client, db_session):
    """情境 6：稱呼與手機不能清空、手機格式、未來生日 422；Email、孩子姓名、生日可以清空。"""
    booking = await started_booking(
        admin_client, public_client, db_session, phone=OLD_PHONE, child_name="王小明", child_birthdate=BIRTHDAY.isoformat()
    )
    case_id = booking["id"]
    version = await _version(admin_client, case_id)

    async def rejected(**body) -> dict:
        response = await _patch(admin_client, case_id, expected_version=version, **body)
        assert response.status_code == 422, (body, response.text)
        return response.json()

    for body, field in (
        ({"parent_name": ""}, "parent_name"),
        ({"parent_name": "   "}, "parent_name"),
        ({"parent_name": None}, "parent_name"),
        ({"phone": ""}, "phone"),
        ({"phone": None}, "phone"),
        ({"phone": "0212345678"}, "phone"),
        ({"email": "不是信箱"}, "email"),
        ({"email": "a" * 250 + "@example.com"}, "email"),
        ({"child_name": "王\x00小明"}, "child_name"),
        ({"child_name": "王" * 65}, "child_name"),
        ({"parent_name": "陳\x07媽媽"}, "parent_name"),
        ({"child_birthdate": (today_local() + timedelta(days=1)).isoformat()}, "child_birthdate"),
    ):
        error = await rejected(**body)
        assert error["detail"][0]["loc"] == ["body", field], (body, error)
    # 只收五欄，人數與想了解的事不是後台能改的。
    await rejected(party_size=3)
    await rejected(questions="午睡怎麼安排？")
    assert await _events(db_session, case_id) == []

    cleared = await _patch(
        admin_client, case_id, expected_version=version, email=None, child_name="", child_birthdate=None
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["changed_fields"] == ["email", "child_name", "child_birthdate"]
    assert cleared.json()["email"] is None
    assert cleared.json()["child_name"] is None
    assert cleared.json()["child_birthdate"] is None
    stored = await _case(db_session, case_id)
    assert (stored.email, stored.child_name, stored.child_birthdate) == (None, None, None)
    # 空字串的 Email 也是清空；已經是空的就沒有變化。
    again = await _patch(admin_client, case_id, expected_version=version + 1, email="", child_birthdate="")
    assert again.status_code == 200, again.text
    assert again.json()["changed_fields"] == []


@pytest.mark.asyncio
async def test_phone_is_normalized_like_the_parent_side(admin_client, public_client, db_session):
    booking = await started_booking(admin_client, public_client, db_session, phone=OLD_PHONE)
    case_id = booking["id"]

    response = await _patch(
        admin_client, case_id, expected_version=await _version(admin_client, case_id), phone="0922-333-444", parent_name="  林爸爸 "
    )

    assert response.status_code == 200, response.text
    assert response.json()["phone"] == NEW_PHONE
    assert response.json()["parent_name"] == "林爸爸"
    assert response.json()["changed_fields"] == ["parent_name", "phone"]


@pytest.mark.asyncio
async def test_email_change_queues_one_mail_to_the_new_address(
    app, admin_client, public_client, db_session, recording_mail_adapter
):
    """情境 7：Email 改成新值才排 PARENT_VISIT_CHANGED，寄到新信箱；改電話、清空 Email 都不排。"""
    booked = await book_slot(admin_client, public_client, phone=OLD_PHONE)
    case_id = booked["receipt_id"]

    async def flush_outbox() -> None:
        await process_outbox_batch(
            db_session,
            recording_mail_adapter,
            limit=50,
            admin_origin="https://www.ivy.example",
            access_secret=app.state.settings.session_secret,
        )

    await flush_outbox()  # 先把預約成功等舊信清掉
    recording_mail_adapter.sent.clear()
    baseline = await _changed_mail_count(db_session, case_id)

    phone_only = await _patch(
        admin_client, case_id, expected_version=await _version(admin_client, case_id), phone=NEW_PHONE
    )
    assert phone_only.json()["email_notified"] is False
    assert await _changed_mail_count(db_session, case_id) == baseline

    email_changed = await _patch(
        admin_client, case_id, expected_version=await _version(admin_client, case_id), email=NEW_EMAIL
    )
    assert email_changed.status_code == 200, email_changed.text
    assert email_changed.json()["changed_fields"] == ["email"]
    assert email_changed.json()["email_notified"] is True
    assert await _changed_mail_count(db_session, case_id) == baseline + 1
    await flush_outbox()
    assert [m["to"] for m in recording_mail_adapter.sent] == [NEW_EMAIL]  # 舊信箱不通知

    cleared = await _patch(admin_client, case_id, expected_version=await _version(admin_client, case_id), email=None)
    assert cleared.json()["changed_fields"] == ["email"]
    assert cleared.json()["email_notified"] is False
    assert await _changed_mail_count(db_session, case_id) == baseline + 1


async def _exchange(public_client, manage_path: str):
    return await public_client.post(
        f"{PARENT_MANAGE}/exchange", json={"token": manage_path.split("token=", 1)[1]}
    )


@pytest.mark.asyncio
async def test_correcting_the_email_replaces_the_link_sent_to_the_old_address(
    app, admin_client, public_client, db_session, recording_mail_adapter
):
    """2026-10-13：補登或送單時 Email 打錯，連結已經寄到陌生人的信箱。改正 Email 後舊連結失效，
    變更信寄到新信箱、裡面是新的連結；歷程記「產生家長管理連結」（不含 token）。"""
    booked = await book_slot(admin_client, public_client, phone=OLD_PHONE)
    case_id = booked["receipt_id"]
    await process_outbox_batch(
        db_session, recording_mail_adapter, limit=50, admin_origin="https://www.ivy.example",
        access_secret=app.state.settings.session_secret,
    )
    recording_mail_adapter.sent.clear()

    response = await _patch(admin_client, case_id, expected_version=await _version(admin_client, case_id), email=NEW_EMAIL)

    assert response.status_code == 200, response.text
    assert response.json()["email_notified"] is True
    assert response.json()["access_link_reset"] is True
    assert response.json()["access_link"] is not None  # 新連結已經在了
    assert (await _exchange(public_client, booked["manage_path"])).status_code == 401
    created = await _events(db_session, case_id, "access_link_created")
    assert created[-1].after["replaced_previous"] is True
    assert "token" not in json.dumps(created[-1].after)

    await process_outbox_batch(
        db_session, recording_mail_adapter, limit=50, admin_origin="https://www.ivy.example",
        access_secret=app.state.settings.session_secret,
    )
    [mail] = recording_mail_adapter.sent
    assert mail["to"] == NEW_EMAIL
    fragment = "/visit/manage#token=" + mail["body"].split("/visit/manage#token=", 1)[1].split()[0]
    assert fragment != booked["manage_path"]
    await open_manage(public_client, fragment)


@pytest.mark.asyncio
async def test_clearing_the_email_or_editing_a_started_case_only_revokes_the_old_link(
    admin_client, public_client, db_session
):
    """不寄變更信（Email 清空、場次已開始）時只撤銷，不另外產生一條沒人拿得到的連結。"""
    booked = await book_slot(admin_client, public_client, phone=OLD_PHONE)
    started = await started_booking(admin_client, public_client, db_session, start_time="14:00:00", end_time="15:00:00")
    for case_id, manage_path, body in (
        (booked["receipt_id"], booked["manage_path"], {"email": None}),
        (started["id"], started["manage_path"], {"email": NEW_EMAIL}),
    ):
        response = await _patch(admin_client, case_id, expected_version=await _version(admin_client, case_id), **body)

        assert response.status_code == 200, response.text
        assert response.json()["email_notified"] is False
        assert response.json()["access_link_reset"] is True
        assert response.json()["access_link"] is None
        assert (await _exchange(public_client, manage_path)).status_code == 401
        assert len(await _events(db_session, case_id, "access_link_revoked")) == 1


@pytest.mark.asyncio
async def test_other_edits_keep_the_link_and_adding_a_first_email_keeps_it_too(
    admin_client, public_client, db_session
):
    """只改電話不動連結；原本沒有 Email（連結是園方直接交給家長的）補上 Email 也不動。"""
    booked = await book_slot(admin_client, public_client, phone=OLD_PHONE)
    case_id = booked["receipt_id"]
    phone_only = await _patch(
        admin_client, case_id, expected_version=await _version(admin_client, case_id), phone=NEW_PHONE
    )
    assert phone_only.json()["access_link_reset"] is False

    await db_session.execute(
        update(VisitRequest).where(VisitRequest.id == uuid.UUID(case_id)).values(email=None)
    )
    await db_session.commit()
    first_email = await _patch(
        admin_client, case_id, expected_version=await _version(admin_client, case_id), email=NEW_EMAIL
    )

    assert first_email.status_code == 200, first_email.text
    assert first_email.json()["email_notified"] is True
    assert first_email.json()["access_link_reset"] is False
    await open_manage(public_client, booked["manage_path"])


@pytest.mark.asyncio
async def test_email_change_on_a_closed_or_started_case_queues_nothing(admin_client, public_client, db_session):
    """變更信寄出前，案件已不是預約成立或場次已開始，worker 一律略過；這種案件改 Email 不排信，
    也不能對畫面宣稱「已寄通知」。"""
    completed = await legacy_request(db_session, status="completed", phone=OLD_PHONE)
    started = await started_booking(admin_client, public_client, db_session, phone=unique_phone())
    for case_id in (completed, started["id"]):
        response = await _patch(
            admin_client, case_id, expected_version=await _version(admin_client, case_id), email=NEW_EMAIL
        )
        assert response.status_code == 200, response.text
        assert response.json()["changed_fields"] == ["email"]
        assert response.json()["email_notified"] is False
        assert await _changed_mail_count(db_session, case_id) == 0
        assert (await _case(db_session, case_id)).email == NEW_EMAIL


@pytest.mark.asyncio
@pytest.mark.parametrize("status", ["completed", "no_show", "cancelled"])
async def test_any_status_can_be_edited(admin_client, db_session, status):
    """情境 8：已到場、未到場、已取消的案件也能改（打錯的資料事後才發現很常見）。"""
    case_id = await legacy_request(db_session, status=status, phone=OLD_PHONE)

    response = await _patch(admin_client, case_id, expected_version=await _version(admin_client, case_id), phone=NEW_PHONE)

    assert response.status_code == 200, response.text
    assert response.json()["status"] == status
    assert response.json()["changed_fields"] == ["phone"]
    assert (await _case(db_session, case_id)).phone == NEW_PHONE


# ---------------------------------------------------------------- 3.2 招生同步


@pytest.mark.asyncio
async def test_mark_arrived_builds_the_recruitment_visit_from_values_committed_before_the_lock(
    app, admin_client, public_client, db_session
):
    """2026-10-13：「已到場」的請求讀到預約時還沒上鎖；同事在這之間改好電話並先提交，招生訪視
    要用改好的電話建立，不能用請求一開始讀到的舊值（之後再改也會被當成招生端另外改過）。"""
    booking = await started_booking(
        admin_client, public_client, db_session, phone=OLD_PHONE, child_name="王小明", child_birthdate=BIRTHDAY.isoformat()
    )
    async with app.state.session_factory() as arrived:
        # 「已到場」的請求先讀到預約（還是舊電話）……
        stale = (await arrived.execute(select(VisitRequest).where(VisitRequest.id == uuid.UUID(booking["id"])))).scalar_one()
        assert stale.phone == OLD_PHONE
        # ……同事這時把電話改好並提交……
        fixed = await _patch(
            admin_client, booking["id"], expected_version=await _version(admin_client, booking["id"]), phone=NEW_PHONE
        )
        assert fixed.status_code == 200, fixed.text
        # ……「已到場」才拿到鎖、建立招生訪視。
        await workflow_service.mark_completed(arrived, stale, admissions_enabled=True)
        await arrived.commit()

    assert (await _recruitment(db_session, booking["id"])).phone == NEW_PHONE


@pytest.mark.asyncio
async def test_untouched_recruitment_fields_follow_the_change(admin_client, public_client, db_session):
    """情境 9：招生那筆還是當初帶過去的值 → 電話、生日、年級一起改，版本 +1，稽核只記欄位名。"""
    new_birthday = date(2022, 3, 2)
    assert _grade(new_birthday) != _grade(BIRTHDAY)  # 測試前提：換了生日年級會不同
    booking = await _completed_with_recruitment(admin_client, public_client, db_session, phone=OLD_PHONE)
    case_id = booking["id"]
    before = await _recruitment(db_session, case_id)
    assert (before.phone, before.birthday, before.grade) == (OLD_PHONE, BIRTHDAY, _grade(BIRTHDAY))
    version_before, contact_before = before.version, before.contact_name

    response = await _patch(
        admin_client,
        case_id,
        expected_version=await _version(admin_client, case_id),
        phone=NEW_PHONE,
        child_birthdate=new_birthday.isoformat(),
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["changed_fields"] == ["phone", "child_birthdate"]
    assert body["admissions_synced_fields"] == ["phone", "birthday", "grade"]
    assert body["admissions_skipped_fields"] == []
    after = await _recruitment(db_session, case_id)
    assert (after.phone, after.birthday, after.grade) == (NEW_PHONE, new_birthday, _grade(new_birthday))
    assert after.version == version_before + 1
    assert after.child_name == "王小明" and after.contact_name == contact_before  # 沒變的欄位不動
    [entry] = await _audit(db_session, "recruitment_visit.synced_from_visit_request")
    assert entry.target_type == "recruitment_visit" and entry.target_id == str(after.id)
    assert entry.metadata_json == {"fields": ["phone", "birthday", "grade"]}
    assert NEW_PHONE not in json.dumps(entry.metadata_json)


@pytest.mark.asyncio
async def test_name_changes_follow_too_and_empty_child_name_uses_the_placeholder(
    admin_client, public_client, db_session
):
    booking = await _completed_with_recruitment(admin_client, public_client, db_session, phone=OLD_PHONE)
    case_id = booking["id"]

    renamed = await _patch(
        admin_client,
        case_id,
        expected_version=await _version(admin_client, case_id),
        parent_name="林爸爸",
        child_name="王大明",
    )
    assert renamed.json()["admissions_synced_fields"] == ["contact_name", "child_name"]
    row = await _recruitment(db_session, case_id)
    assert (row.contact_name, row.child_name) == ("林爸爸", "王大明")

    cleared = await _patch(
        admin_client, case_id, expected_version=await _version(admin_client, case_id), child_name=None
    )
    assert cleared.json()["admissions_synced_fields"] == ["child_name"]
    assert (await _recruitment(db_session, case_id)).child_name == constants.MISSING_CHILD_NAME


@pytest.mark.asyncio
async def test_field_edited_in_admissions_is_not_overwritten(admin_client, public_client, db_session):
    """情境 10（Review Focus 2）：招生端先把電話改成別的，後台再改同一欄 → 招生電話不動、
    列在 skipped、版本不變。"""
    booking = await _completed_with_recruitment(admin_client, public_client, db_session, phone=OLD_PHONE)
    case_id = booking["id"]
    row = await _recruitment(db_session, case_id)
    edited = await admin_client.patch(
        f"{ADMISSIONS}/records/{row.id}", json={"expected_version": row.version, "phone": "0977888999"}
    )
    assert edited.status_code == 200, edited.text
    edited_version = edited.json()["version"]

    response = await _patch(
        admin_client, case_id, expected_version=await _version(admin_client, case_id), phone=NEW_PHONE
    )

    assert response.status_code == 200, response.text
    assert response.json()["changed_fields"] == ["phone"]
    assert response.json()["admissions_synced_fields"] == []
    assert response.json()["admissions_skipped_fields"] == ["phone"]
    after = await _recruitment(db_session, case_id)
    assert after.phone == "0977888999"
    assert after.version == edited_version
    assert await _audit(db_session, "recruitment_visit.synced_from_visit_request") == []
    assert (await _case(db_session, case_id)).phone == NEW_PHONE  # 預約本身照改


@pytest.mark.asyncio
async def test_manually_changed_grade_is_kept_but_birthday_follows(admin_client, public_client, db_session):
    """情境 11：招生年級被手動改過、後台改生日 → 生日同步、年級不動並列在 skipped。"""
    new_birthday = date(2022, 3, 2)
    booking = await _completed_with_recruitment(admin_client, public_client, db_session, phone=OLD_PHONE)
    case_id = booking["id"]
    row = await _recruitment(db_session, case_id)
    row_id, version_before = row.id, row.version
    manual = "大班" if _grade(BIRTHDAY) != "大班" else "中班"
    assert manual not in (_grade(BIRTHDAY), _grade(new_birthday))
    await db_session.execute(update(RecruitmentVisit).where(RecruitmentVisit.id == row_id).values(grade=manual))
    await db_session.commit()

    response = await _patch(
        admin_client,
        case_id,
        expected_version=await _version(admin_client, case_id),
        child_birthdate=new_birthday.isoformat(),
    )

    assert response.status_code == 200, response.text
    assert response.json()["admissions_synced_fields"] == ["birthday"]
    assert response.json()["admissions_skipped_fields"] == ["grade"]
    after = await _recruitment(db_session, case_id)
    assert (after.birthday, after.grade) == (new_birthday, manual)
    assert after.version == version_before + 1


@pytest.mark.asyncio
async def test_grade_is_left_alone_when_the_birthday_itself_was_edited_in_admissions(
    admin_client, public_client, db_session
):
    """招生端改過生日，年級還是舊的換算結果：後台再改生日時，不能讓年級依「預約的新生日」
    單獨改掉，否則招生那筆的生日與年級對不上。"""
    booking = await _completed_with_recruitment(admin_client, public_client, db_session, phone=OLD_PHONE)
    case_id = booking["id"]
    row = await _recruitment(db_session, case_id)
    admissions_birthday = date(2023, 4, 5)
    assert _grade(admissions_birthday) == _grade(BIRTHDAY)
    await db_session.execute(
        update(RecruitmentVisit).where(RecruitmentVisit.id == row.id).values(birthday=admissions_birthday)
    )
    await db_session.commit()
    new_birthday = date(2022, 3, 2)
    assert _grade(new_birthday) != _grade(BIRTHDAY)

    response = await _patch(
        admin_client,
        case_id,
        expected_version=await _version(admin_client, case_id),
        child_birthdate=new_birthday.isoformat(),
    )

    assert response.json()["admissions_synced_fields"] == []
    assert response.json()["admissions_skipped_fields"] == ["birthday", "grade"]
    after = await _recruitment(db_session, case_id)
    assert (after.birthday, after.grade, after.version) == (admissions_birthday, _grade(BIRTHDAY), row.version)


@pytest.mark.asyncio
async def test_enrolled_legacy_visit_keeps_its_grade_when_the_birthday_crosses_a_grade(
    admin_client, public_client, db_session
):
    """已註冊、沒有 provisional_grade 的舊資料，年級決定算在哪一班，招生端的編輯表單改不了
    （records._check_term_editable）；後台改預約生日也不能繞過：生日同步、年級不動並列在 skipped。"""
    booking = await _completed_with_recruitment(admin_client, public_client, db_session, phone=OLD_PHONE)
    case_id = booking["id"]
    row = await _recruitment(db_session, case_id)
    await db_session.execute(
        update(RecruitmentVisit)
        .where(RecruitmentVisit.id == row.id)
        .values(enrolled=True, enrolled_on=today_local(), provisional_grade=None)
    )
    await db_session.commit()
    new_birthday = date(2022, 3, 2)
    assert _grade(new_birthday) != _grade(BIRTHDAY)
    version_before = (await _recruitment(db_session, case_id)).version

    response = await _patch(
        admin_client,
        case_id,
        expected_version=await _version(admin_client, case_id),
        child_birthdate=new_birthday.isoformat(),
    )

    assert response.status_code == 200, response.text
    assert response.json()["admissions_synced_fields"] == ["birthday"]
    assert response.json()["admissions_skipped_fields"] == ["grade"]
    after = await _recruitment(db_session, case_id)
    assert (after.birthday, after.grade) == (new_birthday, _grade(BIRTHDAY))
    assert after.version == version_before + 1


@pytest.mark.asyncio
async def test_enrolled_visit_with_provisional_grade_still_follows_the_grade(
    admin_client, public_client, db_session
):
    """註冊時有寫 provisional_grade 的訪視，班級看 provisional_grade，grade 沒被鎖（與編輯表單同一條規則）。"""
    booking = await _completed_with_recruitment(admin_client, public_client, db_session, phone=OLD_PHONE)
    case_id = booking["id"]
    row = await _recruitment(db_session, case_id)
    await db_session.execute(
        update(RecruitmentVisit)
        .where(RecruitmentVisit.id == row.id)
        .values(enrolled=True, enrolled_on=today_local(), provisional_grade=_grade(BIRTHDAY))
    )
    await db_session.commit()
    new_birthday = date(2022, 3, 2)

    response = await _patch(
        admin_client,
        case_id,
        expected_version=await _version(admin_client, case_id),
        child_birthdate=new_birthday.isoformat(),
    )

    assert response.status_code == 200, response.text
    assert response.json()["admissions_synced_fields"] == ["birthday", "grade"]
    assert response.json()["admissions_skipped_fields"] == []
    assert (await _recruitment(db_session, case_id)).grade == _grade(new_birthday)


@pytest.mark.asyncio
async def test_email_only_change_does_not_touch_recruitment(admin_client, public_client, db_session):
    """招生訪視沒有 Email 欄位：只改 Email 不動招生那筆（版本也不加）。"""
    booking = await _completed_with_recruitment(admin_client, public_client, db_session, phone=OLD_PHONE)
    case_id = booking["id"]
    row = await _recruitment(db_session, case_id)

    response = await _patch(
        admin_client, case_id, expected_version=await _version(admin_client, case_id), email=NEW_EMAIL
    )

    assert response.json()["admissions_synced_fields"] == [] and response.json()["admissions_skipped_fields"] == []
    assert (await _recruitment(db_session, case_id)).version == row.version


@pytest.mark.asyncio
async def test_anonymized_recruitment_visit_is_not_synced(admin_client, public_client, db_session):
    booking = await _completed_with_recruitment(admin_client, public_client, db_session, phone=OLD_PHONE)
    case_id = booking["id"]
    row = await _recruitment(db_session, case_id)
    await db_session.execute(
        update(RecruitmentVisit).where(RecruitmentVisit.id == row.id).values(anonymized_at=datetime.now(timezone.utc))
    )
    await db_session.commit()

    response = await _patch(
        admin_client, case_id, expected_version=await _version(admin_client, case_id), phone=NEW_PHONE
    )

    assert response.status_code == 200, response.text
    assert response.json()["admissions_synced_fields"] == [] and response.json()["admissions_skipped_fields"] == []
    after = await _recruitment(db_session, case_id)
    assert (after.phone, after.version) == (OLD_PHONE, row.version)


@pytest.mark.asyncio
async def test_case_without_recruitment_visit_just_reports_nothing(admin_client, public_client, db_session):
    """還沒到場（沒有招生訪視）的案件：兩個清單都空。"""
    booked = await book_slot(admin_client, public_client, phone=OLD_PHONE)
    case_id = booked["receipt_id"]

    response = await _patch(
        admin_client, case_id, expected_version=await _version(admin_client, case_id), phone=NEW_PHONE
    )

    assert response.status_code == 200, response.text
    assert response.json()["admissions_synced_fields"] == [] and response.json()["admissions_skipped_fields"] == []


@pytest.mark.asyncio
async def test_admissions_disabled_does_not_sync(admin_client, public_client, db_session):
    """情境 12：招生功能開關關閉 → 不同步，兩個清單都空，招生那筆原樣。"""
    booking = await _completed_with_recruitment(admin_client, public_client, db_session, phone=OLD_PHONE)
    case_id = booking["id"]
    row = await _recruitment(db_session, case_id)
    version = await _version(admin_client, case_id)
    disabled = create_app(_test_settings().model_copy(update={"admissions_enabled": False}))
    client = await _logged_in_client(disabled, "admin@ivy.example", "super-admin-password-123")
    try:
        response = await _patch(client, case_id, expected_version=version, phone=NEW_PHONE)
    finally:
        await client.aclose()
        await disabled.state.engine.dispose()
        await disabled.state.rate_limit_engine.dispose()

    assert response.status_code == 200, response.text
    assert response.json()["changed_fields"] == ["phone"]
    assert response.json()["admissions_synced_fields"] == [] and response.json()["admissions_skipped_fields"] == []
    after = await _recruitment(db_session, case_id)
    assert (after.phone, after.version) == (OLD_PHONE, row.version)


# ---------------------------------------------------------------- 權限


@pytest.mark.asyncio
async def test_permissions(
    admin_client, reception_yihua_client, editor_client, minghua_client, public_client, db_session, monkeypatch
):
    """情境 13：處理案件的能力（booking.handle）＋校區範圍；沒有案件讀取權限 403，別校 404。"""
    booking = await started_booking(admin_client, public_client, db_session, phone=OLD_PHONE)
    case_id = booking["id"]
    version = await _version(admin_client, case_id)

    # 接待人員（本校）可以改。
    ok = await _patch(reception_yihua_client, case_id, expected_version=version, phone=NEW_PHONE)
    assert ok.status_code == 200, ok.text
    version += 1
    # 別校的分校管理者：這筆案件對他不存在 → 404。
    assert (await _patch(minghua_client, case_id, expected_version=version, phone=OLD_PHONE)).status_code == 404
    # 內容編輯沒有案件讀取權限 → 403。
    assert (await _patch(editor_client, case_id, expected_version=version, phone=OLD_PHONE)).status_code == 403
    # 有 booking.read 但沒有 booking.handle：現在三個角色兩者相同，暫時把接待人員拿掉處理能力，
    # 確認路由真的有檢查 handle。
    monkeypatch.setitem(
        _CAPABILITY_ROLES, "booking.handle", _CAPABILITY_ROLES["booking.handle"] - {Role.RECEPTION}
    )
    assert (await _patch(reception_yihua_client, case_id, expected_version=version, phone=OLD_PHONE)).status_code == 403
    assert (await _case(db_session, case_id)).phone == NEW_PHONE
    # 沒登入。
    assert (await public_client.patch(f"{CASES}/{case_id}/details", json={"expected_version": version})).status_code in (
        401,
        403,
    )
    # 案件不存在 → 404。
    assert (await _patch(admin_client, uuid.uuid4(), expected_version=1, phone=OLD_PHONE)).status_code == 404
