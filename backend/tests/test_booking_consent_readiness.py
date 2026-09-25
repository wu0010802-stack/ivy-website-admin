"""預約設定、同意版本與表單（2026-09-25 缺口 B04）：案件記錄同意說明版本、
隱私說明本文、預約方式啟用條件與切換前影響範圍、稽核前後紀錄、參觀人數、
問題字數上限。

這個檔案刻意不預先發布同意文字（不帶 booking_consent），要用的測試自己發布。"""
from __future__ import annotations

import csv
import importlib.util
import io
import uuid
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select

from app.booking.models import VisitRequest
from app.content import service as content_service
from app.content.models import ContentItem, ContentRevision, SiteState
from app.content.schemas import FORMAL_CONSENT_TEXT, LEGACY_DEMO_CONSENT_TEXT
from app.operations.models import AuditLogEntry
from tests.conftest import TEST_CONSENT_TEXT, add_weekly_rule, publish_booking_consent, set_booking_mode

API = "/api/website/v1"
FORMAL_CONSENT_MIGRATION = (
    Path(__file__).resolve().parents[1] / "migrations" / "versions" / "31eb94190b1c_publish_formal_booking_consent.py"
)
BOOKING = f"{API}/admin/content-items/booking_content"

_BOOKING_PAYLOAD = {
    "cta_label": "預約參觀",
    "cta_label_en": "Book a Visit",
    "consent_text": TEST_CONSENT_TEXT,
    "banner_title_template": "歡迎預約參觀{campus}",
    "banner_body": "期待與你相遇。",
    "banner_button_label": "預約校園參觀",
}
_PRIVACY = [
    {"heading": "蒐集目的", "body": "安排參觀與聯絡家長。"},
    {"heading": "", "body": "資料只由園方人員使用。"},
]


async def _save_booking(admin_client, **changes) -> dict:
    item = (await admin_client.get(BOOKING)).json()
    payload = {**_BOOKING_PAYLOAD, **changes}
    saved = await admin_client.post(
        f"{BOOKING}/revisions", json={"expected_version": item["latest_version"], "payload": payload}
    )
    assert saved.status_code == 201, saved.text
    return saved.json()["latest_revision"]


async def _publish_booking(admin_client, **changes) -> str:
    revision = await _save_booking(admin_client, **changes)
    published = await admin_client.post(f"{BOOKING}/publish", json={"revision_id": revision["id"]})
    assert published.status_code == 200, published.text
    return revision["id"]


def _form(version: int, **changes) -> dict:
    return {
        "campus_key": "yihua",
        "config_version": version,
        "parent_name": "陳媽媽",
        "phone": "0912345678",
        "questions": None,
        "consent_given": True,
        **changes,
    }


async def _submit(public_client, version: int, key: str, **changes):
    return await public_client.post(
        f"{API}/public/visit-requests", json=_form(version, **changes), headers={"Idempotency-Key": key}
    )


async def _slot(admin_client, *, days_ahead=5, capacity=2, start="10:00:00", end="11:00:00") -> dict:
    response = await admin_client.post(
        f"{API}/admin/slots?campus_key=yihua",
        json={
            "slot_date": (date.today() + timedelta(days=days_ahead)).isoformat(),
            "start_time": start,
            "end_time": end,
            "capacity": capacity,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


# ---------------------------------------------------------------------------
# 缺口 7：同意說明版本
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_public_config_exposes_the_published_consent_version(admin_client, public_client):
    before = (await public_client.get(f"{API}/public/booking-config/yihua")).json()
    assert before["consent_revision_id"] is None and before["consent_text"] is None
    assert before["privacy_notice"] is None

    # 草稿不算：家長只會看到已發布的版本。
    await _save_booking(admin_client)
    assert (await public_client.get(f"{API}/public/booking-config/yihua")).json()["consent_revision_id"] is None

    revision_id = await _publish_booking(admin_client)
    after = (await public_client.get(f"{API}/public/booking-config/yihua")).json()
    assert after["consent_revision_id"] == revision_id
    assert after["consent_text"] == TEST_CONSENT_TEXT
    # 沒有隱私說明本文時不顯示入口。
    assert after["privacy_notice"] is None


@pytest.mark.asyncio
async def test_submission_records_consent_revision_and_server_time(admin_client, public_client, db_session):
    revision_id = await _publish_booking(admin_client)
    version = (await set_booking_mode(admin_client, mode="inquiry")).json()["version"]

    created = await _submit(public_client, version, "consent-record-01", party_size=3)
    assert created.status_code == 201, created.text
    receipt = created.json()["receipt_id"]
    stored = await db_session.get(VisitRequest, uuid.UUID(receipt))
    assert str(stored.consent_revision_id) == revision_id
    assert stored.consent_given is True
    assert stored.consent_accepted_at is not None
    assert abs((stored.consent_accepted_at - stored.created_at).total_seconds()) < 1

    detail = (await admin_client.get(f"{API}/admin/visit-requests/{receipt}")).json()
    assert detail["consent_revision_id"] == revision_id
    assert detail["consent_revision_version"] == 1
    assert detail["consent_accepted_at"] is not None
    assert detail["party_size"] == 3


@pytest.mark.asyncio
async def test_missing_or_outdated_consent_version_is_rejected(admin_client, public_client):
    first = await _publish_booking(admin_client)
    version = (await set_booking_mode(admin_client, mode="inquiry")).json()["version"]

    missing = await _submit(public_client, version, "consent-missing", consent_revision_id=None)
    assert missing.status_code == 409
    assert missing.json()["detail"]["code"] == "CONSENT_VERSION_CHANGED"

    # 同意文字改版後，舊版本不再收，家長要重新閱讀、勾選。
    await _publish_booking(admin_client, consent_text="我同意園方使用資料安排參觀（新版）。")
    stale = await _submit(public_client, version, "consent-stale", consent_revision_id=first)
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "CONSENT_VERSION_CHANGED"

    # 只是草稿（沒發布過）的版本也不收。
    draft = await _save_booking(admin_client, consent_text="草稿文字")
    unpublished = await _submit(public_client, version, "consent-draft", consent_revision_id=draft["id"])
    assert unpublished.json()["detail"]["code"] == "CONSENT_VERSION_CHANGED"

    garbage = await _submit(public_client, version, "consent-garbage", consent_revision_id=str(uuid.uuid4()))
    assert garbage.json()["detail"]["code"] == "CONSENT_VERSION_CHANGED"


@pytest.mark.asyncio
async def test_republish_without_consent_change_keeps_filled_forms_valid(admin_client, public_client, db_session):
    seen = await _publish_booking(admin_client)
    version = (await set_booking_mode(admin_client, mode="inquiry")).json()["version"]
    # 只改預約按鈕文字再發布：同意說明沒變，家長手上的版本照收，並記下他看到的那一版。
    await _publish_booking(admin_client, cta_label="預約來園參觀")

    created = await _submit(public_client, version, "consent-cta-only", consent_revision_id=seen)
    assert created.status_code == 201, created.text
    stored = await db_session.get(VisitRequest, uuid.UUID(created.json()["receipt_id"]))
    assert str(stored.consent_revision_id) == seen


@pytest.mark.asyncio
async def test_replay_returns_original_case_even_after_consent_changes(admin_client, public_client):
    first = await _publish_booking(admin_client)
    version = (await set_booking_mode(admin_client, mode="inquiry")).json()["version"]
    created = await _submit(public_client, version, "consent-replay", consent_revision_id=first)
    assert created.status_code == 201

    await _publish_booking(admin_client, consent_text="改版後的同意文字。")
    replay = await _submit(public_client, version, "consent-replay", consent_revision_id=first)
    assert replay.status_code == 200
    assert replay.json()["receipt_id"] == created.json()["receipt_id"]


@pytest.mark.asyncio
async def test_form_modes_reject_submissions_without_a_published_consent(admin_client, public_client, db_session):
    """legacy：更新前就開了 inquiry、但從沒發布同意文字的校區。"""
    from app.booking.models import BookingConfig, BookingMode

    config = await db_session.get(BookingConfig, "yihua")
    if config is None:
        await admin_client.get(f"{API}/admin/booking-config/yihua")
        config = await db_session.get(BookingConfig, "yihua")
    config.mode = BookingMode.INQUIRY
    version = config.version
    await db_session.commit()

    response = await _submit(public_client, version, "no-consent-published", consent_revision_id=None)
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "BOOKING_UNAVAILABLE"


@pytest.mark.asyncio
async def test_manual_case_has_no_consent_version_but_records_time(admin_client):
    created = await admin_client.post(
        f"{API}/admin/visit-requests",
        json={"campus_key": "yihua", "source": "phone", "parent_name": "王媽媽", "phone": "0912000111", "consent_given": True},
        headers={"Idempotency-Key": "manual-consent"},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["consent_revision_id"] is None
    assert body["consent_accepted_at"] is not None
    assert body["party_size"] is None


# ---------------------------------------------------------------------------
# 缺口 8：隱私說明本文
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_privacy_notice_is_public_only_when_published(admin_client, public_client):
    await _publish_booking(admin_client, privacy_title="個資使用說明", privacy_sections=_PRIVACY)
    config = (await public_client.get(f"{API}/public/booking-config/yihua")).json()
    assert config["privacy_notice"] == {"title": "個資使用說明", "sections": _PRIVACY}

    site = (await public_client.get(f"{API}/public/site")).json()
    assert site["content"]["booking_content"]["privacy_sections"] == _PRIVACY


@pytest.mark.asyncio
async def test_privacy_sections_are_validated(admin_client):
    item = (await admin_client.get(BOOKING)).json()
    for bad in (
        [{"heading": "空白內文", "body": "   "}],
        [{"heading": "x", "body": "javascript:alert(1)"}],
        [{"heading": "", "body": "段落"}] * 13,
    ):
        response = await admin_client.post(
            f"{BOOKING}/revisions",
            json={"expected_version": item["latest_version"], "payload": {**_BOOKING_PAYLOAD, "privacy_sections": bad}},
        )
        assert response.status_code == 422, bad


@pytest.mark.asyncio
async def test_sample_privacy_text_and_prototype_consent_cannot_be_published(admin_client):
    sample = await _save_booking(
        admin_client,
        privacy_title="個資使用說明",
        privacy_sections=[{"heading": "【示意】蒐集目的", "body": "【示意】正式內容請園方提供。"}],
    )
    blocked = await admin_client.post(f"{BOOKING}/publish", json={"revision_id": sample["id"]})
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "CONTENT_NOT_READY"
    assert "示意" in blocked.json()["detail"]["message"]

    demo = await _save_booking(admin_client, consent_text="我了解這是操作示範，資料不會傳送給學校，不代表預約成立。")
    blocked = await admin_client.post(f"{BOOKING}/publish", json={"revision_id": demo["id"]})
    assert blocked.status_code == 409
    assert "示範" in blocked.json()["detail"]["message"]


# ---------------------------------------------------------------------------
# 缺口 9：啟用條件
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_form_modes_need_a_published_consent(admin_client):
    blocked = await admin_client.patch(
        f"{API}/admin/booking-config/yihua", json={"expected_version": 0, "mode": "inquiry"}
    )
    assert blocked.status_code == 400
    detail = blocked.json()["detail"]
    assert detail["code"] == "BOOKING_MODE_NOT_READY"
    assert [r["code"] for r in detail["reasons"]] == ["CONSENT_NOT_PUBLISHED"]

    # slots 兩個條件都缺時兩條原因都列。
    blocked = await admin_client.patch(
        f"{API}/admin/booking-config/yihua", json={"expected_version": 0, "mode": "slots"}
    )
    assert [r["code"] for r in blocked.json()["detail"]["reasons"]] == ["CONSENT_NOT_PUBLISHED", "NO_SLOTS_OR_RULES"]

    await _publish_booking(admin_client)
    enabled = await admin_client.patch(
        f"{API}/admin/booking-config/yihua", json={"expected_version": 0, "mode": "inquiry"}
    )
    assert enabled.status_code == 200, enabled.text


@pytest.mark.asyncio
async def test_data_conditions_only_block_switching_into_the_mode(admin_client, db_session):
    await publish_booking_consent(db_session)
    await add_weekly_rule(admin_client)
    version = (await set_booking_mode(admin_client, mode="slots")).json()["version"]
    # 規則拿掉後場次也沒了；已經是 slots 的校區改其他設定不被擋（改列在總覽待辦）。
    schedule = (await admin_client.get(f"{API}/admin/visit-schedule/yihua")).json()
    await admin_client.put(
        f"{API}/admin/visit-schedule/yihua",
        json={"min_lead_hours": schedule["min_lead_hours"], "max_advance_days": schedule["max_advance_days"], "rules": []},
    )
    kept = await admin_client.patch(
        f"{API}/admin/booking-config/yihua",
        json={"expected_version": version, "mode": "slots", "parent_change_deadline_hours": 48},
    )
    assert kept.status_code == 200, kept.text


@pytest.mark.asyncio
async def test_readiness_lists_blockers_and_impact(admin_client, public_client, db_session, minghua_client):
    readiness = await admin_client.get(f"{API}/admin/booking-config/yihua/readiness")
    assert readiness.status_code == 200, readiness.text
    body = readiness.json()
    assert body["current_mode"] == "paused"
    assert body["consent"] is None
    assert [r["code"] for r in body["blockers"]["inquiry"]] == ["CONSENT_NOT_PUBLISHED"]
    assert [r["code"] for r in body["blockers"]["slots"]] == ["CONSENT_NOT_PUBLISHED", "NO_SLOTS_OR_RULES"]
    assert body["blockers"]["line"] == [] and body["blockers"]["paused"] == []
    assert body["impact"] == {
        "open_requests": 0, "new_requests": 0, "contacting": 0, "pending_confirmation": 0,
        "upcoming_confirmed": 0, "bookable_slots": 0, "weekly_rules": 0,
    }

    revision_id = await _publish_booking(admin_client, privacy_sections=_PRIVACY)
    slot = await _slot(admin_client, capacity=3)
    await _slot(admin_client, days_ahead=6)
    version = (await set_booking_mode(admin_client, mode="slots", slots_auto_confirm=True)).json()["version"]
    confirmed = await _submit(public_client, version, "impact-confirmed", slot_id=slot["id"])
    assert confirmed.status_code == 201, confirmed.text
    await set_booking_mode(admin_client, mode="inquiry")
    version = (await admin_client.get(f"{API}/admin/booking-config/yihua")).json()["version"]
    assert (await _submit(public_client, version, "impact-new")).status_code == 201

    body = (await admin_client.get(f"{API}/admin/booking-config/yihua/readiness")).json()
    assert body["current_mode"] == "inquiry"
    assert body["consent"] == {"revision_id": revision_id, "version": 1, "has_privacy_notice": True}
    assert body["blockers"]["inquiry"] == [] and body["blockers"]["slots"] == []
    assert body["impact"] == {
        "open_requests": 2, "new_requests": 1, "contacting": 0, "pending_confirmation": 0,
        "upcoming_confirmed": 1, "bookable_slots": 2, "weekly_rules": 0,
    }

    # 其他校的人看不到。
    assert (await minghua_client.get(f"{API}/admin/booking-config/yihua/readiness")).status_code == 404
    assert (await admin_client.get(f"{API}/admin/booking-config/nowhere/readiness")).status_code == 404


@pytest.mark.asyncio
async def test_dashboard_lists_slots_campuses_without_openings(admin_client, public_client, db_session):
    await publish_booking_consent(db_session)
    await add_weekly_rule(admin_client)
    await set_booking_mode(admin_client, mode="slots", slots_auto_confirm=True)
    summary = (await admin_client.get(f"{API}/admin/dashboard")).json()
    # 有規則但定期工作還沒補出場次：家長現在選不到，列入待辦。
    assert summary["campuses_slots_without_openings"] == ["yihua"]
    assert "yihua" not in summary["campuses_without_active_booking"]

    slot = await _slot(admin_client, capacity=1)
    assert (await admin_client.get(f"{API}/admin/dashboard")).json()["campuses_slots_without_openings"] == []

    # 唯一的場次額滿後又回到待辦。
    version = (await admin_client.get(f"{API}/admin/booking-config/yihua")).json()["version"]
    assert (await _submit(public_client, version, "dash-full", slot_id=slot["id"])).status_code == 201
    assert (await admin_client.get(f"{API}/admin/dashboard")).json()["campuses_slots_without_openings"] == ["yihua"]


# ---------------------------------------------------------------------------
# 缺口 10：修改前後的稽核紀錄
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_config_audit_records_full_before_and_after(admin_client, db_session):
    await publish_booking_consent(db_session)
    await set_booking_mode(admin_client, mode="line", line_url="https://lin.ee/abc", message="加 LINE 預約")
    await set_booking_mode(admin_client, mode="inquiry", slots_auto_confirm=False)

    entries = (
        await db_session.execute(
            select(AuditLogEntry)
            .where(AuditLogEntry.action == "booking_config.update")
            .order_by(AuditLogEntry.created_at)
        )
    ).scalars().all()
    assert len(entries) == 2
    second = entries[1].metadata_json
    assert second["before"]["mode"] == "line"
    assert second["before"]["line_url"] == "https://lin.ee/abc"
    assert second["before"]["message"] == "加 LINE 預約"
    assert second["after"] == {
        "mode": "inquiry", "line_url": None, "phone": None, "external_url": None, "message": None,
        "slots_auto_confirm": False, "parent_change_deadline_hours": 24,
    }
    assert second["changed"] == ["mode", "line_url", "message"]
    assert second["version"] == 2


# ---------------------------------------------------------------------------
# 缺口 11：參觀人數
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_party_size_is_required_validated_and_exported(admin_client, public_client, db_session):
    await publish_booking_consent(db_session)
    version = (await set_booking_mode(admin_client, mode="inquiry")).json()["version"]

    missing = await _submit(public_client, version, "party-missing", party_size=None)
    assert missing.status_code == 422
    for index, bad in enumerate((0, 11, "兩位")):
        assert (await _submit(public_client, version, f"party-bad-{index}", party_size=bad)).status_code == 422

    created = await _submit(public_client, version, "party-ok", party_size=10)
    assert created.status_code == 201, created.text
    receipt = created.json()["receipt_id"]

    # 同一把 key 改了人數是不同的送單。
    changed = await _submit(public_client, version, "party-ok", party_size=4)
    assert changed.status_code == 409
    assert changed.json()["detail"]["code"] == "IDEMPOTENCY_CONFLICT"

    listed = (await admin_client.get(f"{API}/admin/visit-requests")).json()
    assert [row["party_size"] for row in listed] == [10]

    manual = await admin_client.post(
        f"{API}/admin/visit-requests",
        json={"campus_key": "yihua", "source": "walk_in", "parent_name": "林爸爸", "phone": "0912000222",
              "consent_given": True, "party_size": 3},
        headers={"Idempotency-Key": "manual-party"},
    )
    assert manual.status_code == 201, manual.text
    assert manual.json()["party_size"] == 3
    assert (await admin_client.post(
        f"{API}/admin/visit-requests",
        json={"campus_key": "yihua", "source": "walk_in", "parent_name": "林爸爸", "phone": "0912000222",
              "consent_given": True, "party_size": 11},
        headers={"Idempotency-Key": "manual-party-bad"},
    )).status_code == 422

    export = await admin_client.get(f"{API}/admin/visit-requests/export?campus_key=yihua")
    rows = list(csv.DictReader(io.StringIO(export.text)))
    assert {row["party_size"] for row in rows} == {"10", "3"}
    stored = await db_session.get(VisitRequest, uuid.UUID(receipt))
    assert stored.party_size == 10


@pytest.mark.asyncio
async def test_legacy_case_without_party_size_exports_blank(admin_client, db_session):
    created = await admin_client.post(
        f"{API}/admin/visit-requests",
        json={"campus_key": "yihua", "source": "phone", "parent_name": "舊案", "phone": "0912000333", "consent_given": True},
        headers={"Idempotency-Key": "legacy-party"},
    )
    assert created.json()["party_size"] is None
    export = await admin_client.get(f"{API}/admin/visit-requests/export?campus_key=yihua")
    assert [row["party_size"] for row in csv.DictReader(io.StringIO(export.text))] == [""]


# ---------------------------------------------------------------------------
# 缺口 12：問題最多 500 字
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_questions_are_limited_to_500_characters(admin_client, public_client, db_session):
    await publish_booking_consent(db_session)
    version = (await set_booking_mode(admin_client, mode="inquiry")).json()["version"]
    assert (await _submit(public_client, version, "q-501", questions="問" * 501)).status_code == 422
    assert (await _submit(public_client, version, "q-500", questions="問" * 500)).status_code == 201

    manual = {"campus_key": "yihua", "source": "phone", "parent_name": "王媽媽", "phone": "0912000444", "consent_given": True}
    too_long = await admin_client.post(
        f"{API}/admin/visit-requests", json={**manual, "questions": "問" * 501}, headers={"Idempotency-Key": "mq-501"}
    )
    assert too_long.status_code == 422
    ok = await admin_client.post(
        f"{API}/admin/visit-requests", json={**manual, "questions": "問" * 500}, headers={"Idempotency-Key": "mq-500"}
    )
    assert ok.status_code == 201, ok.text


# ---------------------------------------------------------------------------
# migration 31eb94190b1c：把仍在發布中的原型示範同意文字換成正式文字
# ---------------------------------------------------------------------------


def _load_formal_consent_migration():
    spec = importlib.util.spec_from_file_location("publish_formal_booking_consent", FORMAL_CONSENT_MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


async def _run_formal_consent_migration(app) -> None:
    migration = _load_formal_consent_migration()

    def upgrade(sync_conn) -> None:
        migration.op = SimpleNamespace(get_bind=lambda: sync_conn)
        migration.upgrade()

    async with app.state.engine.begin() as conn:
        await conn.run_sync(upgrade)


async def _publish_raw(db_session, kind: str, payload: dict) -> ContentRevision:
    """直接寫進版本與發布紀錄（不經 API 的發布檢查），模擬正式庫的既有狀態。"""
    item = await content_service.get_or_create_content_item(db_session, kind, None)
    revision = await content_service.create_revision(db_session, item, payload, item.latest_version, None)
    await content_service.publish_revision(db_session, item, revision, None)
    await db_session.commit()
    return revision


def test_formal_consent_migration_uses_the_same_texts_as_the_app():
    migration = _load_formal_consent_migration()
    assert migration.DEMO_CONSENT_TEXT == LEGACY_DEMO_CONSENT_TEXT
    assert migration.FORMAL_CONSENT_TEXT == FORMAL_CONSENT_TEXT


@pytest.mark.asyncio
async def test_formal_consent_migration_republishes_the_demo_text(app, public_client, db_session):
    about = await _publish_raw(db_session, "home_about", {"title": "關於常春藤"})
    about_payload = dict(about.payload)
    demo = await _publish_raw(db_session, "booking_content", {**_BOOKING_PAYLOAD, "consent_text": LEGACY_DEMO_CONSENT_TEXT})
    item = await db_session.get(ContentItem, demo.content_item_id)
    # 園方另存了一版還沒發布、已送審的草稿。
    draft = await content_service.create_revision(
        db_session, item, {**_BOOKING_PAYLOAD, "consent_text": LEGACY_DEMO_CONSENT_TEXT, "cta_label": "草稿"}, item.latest_version, None
    )
    draft.review_status = "pending_review"
    draft_payload = dict(draft.payload)
    item_id, draft_id, draft_version = item.id, draft.id, draft.version
    demo_payload = dict(demo.payload)
    await db_session.commit()
    old_release = (await db_session.get(SiteState, 1)).current_release_id

    await _run_formal_consent_migration(app)
    db_session.expire_all()

    item = await db_session.get(ContentItem, item_id)
    published = await db_session.get(ContentRevision, item.current_published_revision_id)
    assert published.version == draft_version + 1
    # 只換同意文字，其他欄位照原本發布的那一版（不是草稿）。
    assert published.payload == {**demo_payload, "consent_text": FORMAL_CONSENT_TEXT}
    assert published.created_by is None and published.review_status == "draft"
    # 原本的草稿完全不動（仍在送審）；另外複製成最新一版草稿，編輯頁打開仍是
    # 園方改到一半的內容，示範同意文字一併換掉。
    original = await db_session.get(ContentRevision, draft_id)
    assert original.payload == draft_payload and original.review_status == "pending_review"
    assert item.latest_version == draft_version + 2
    carried = await db_session.scalar(
        select(ContentRevision).where(
            ContentRevision.content_item_id == item.id, ContentRevision.version == item.latest_version
        )
    )
    assert carried.payload == {**draft_payload, "consent_text": FORMAL_CONSENT_TEXT}
    assert carried.review_status == "draft" and carried.created_by is None

    state = await db_session.get(SiteState, 1)
    assert state.current_release_id != old_release
    site = (await public_client.get(f"{API}/public/site")).json()
    assert site["content"]["booking_content"]["consent_text"] == FORMAL_CONSENT_TEXT
    # 其他內容沿用原本的發布版本。
    assert site["content"]["home_about"] == about_payload
    config = (await public_client.get(f"{API}/public/booking-config/yihua")).json()
    assert config["consent_revision_id"] == str(published.id)
    assert config["consent_text"] == FORMAL_CONSENT_TEXT

    audit = (
        await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "content.publish"))
    ).scalars().all()
    assert len(audit) == 1
    assert audit[0].actor_user_id is None
    assert audit[0].target_id == str(item.id)
    assert audit[0].metadata_json == {
        "kind": "booking_content",
        "revision_version": published.version,
        "reason": "formal_consent_migration",
        "carried_draft_version": draft_version,
        "draft_version": carried.version,
    }

    # 再跑一次（或同意文字已經是正式文字）什麼都不做。
    revisions = await db_session.scalar(select(func.count()).select_from(ContentRevision))
    await _run_formal_consent_migration(app)
    db_session.expire_all()
    assert await db_session.scalar(select(func.count()).select_from(ContentRevision)) == revisions
    assert (await db_session.get(SiteState, 1)).current_release_id == state.current_release_id


@pytest.mark.asyncio
async def test_formal_consent_migration_leaves_edited_or_missing_content_alone(app, db_session):
    # 還沒有任何發布：不做事也不報錯。
    await _run_formal_consent_migration(app)
    assert await db_session.scalar(select(func.count()).select_from(ContentRevision)) == 0

    # 園方已經改過同意文字：不動。
    custom = await _publish_raw(db_session, "booking_content", {**_BOOKING_PAYLOAD, "consent_text": "園方自己寫的同意文字。"})
    item_id, custom_id = custom.content_item_id, custom.id
    await _run_formal_consent_migration(app)
    db_session.expire_all()
    item = await db_session.get(ContentItem, item_id)
    assert item.current_published_revision_id == custom_id
    assert item.latest_version == 1

    # 發布中的是園方的文字、草稿裡還留著示範文字：同樣不動（草稿本來就發布不了）。
    demo_draft = await content_service.create_revision(
        db_session, item, {**_BOOKING_PAYLOAD, "consent_text": LEGACY_DEMO_CONSENT_TEXT}, item.latest_version, None
    )
    assert demo_draft.version == 2
    await db_session.commit()
    await _run_formal_consent_migration(app)
    db_session.expire_all()
    item = await db_session.get(ContentItem, item_id)
    assert item.current_published_revision_id == custom_id
    assert item.latest_version == 2


@pytest.mark.asyncio
async def test_formal_consent_migration_without_draft_only_adds_the_published_version(app, public_client, db_session):
    demo = await _publish_raw(db_session, "booking_content", {**_BOOKING_PAYLOAD, "consent_text": LEGACY_DEMO_CONSENT_TEXT})
    item_id, demo_payload = demo.content_item_id, dict(demo.payload)

    await _run_formal_consent_migration(app)
    db_session.expire_all()

    item = await db_session.get(ContentItem, item_id)
    assert item.latest_version == 2
    published = await db_session.get(ContentRevision, item.current_published_revision_id)
    assert published.version == 2
    assert published.payload == {**demo_payload, "consent_text": FORMAL_CONSENT_TEXT}
    audit = (
        await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "content.publish"))
    ).scalar_one()
    assert audit.metadata_json == {"kind": "booking_content", "revision_version": 2, "reason": "formal_consent_migration"}
    # 新發布的版本可以直接拿來送單（家長看到的就是這一版）。
    config = (await public_client.get(f"{API}/public/booking-config/yihua")).json()
    assert config["consent_revision_id"] == str(published.id)
