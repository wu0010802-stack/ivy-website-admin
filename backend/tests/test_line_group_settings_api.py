"""後台群組設定 API（docs/specs/2026-11-17-line-group-interactions-design.md §4.4）。"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from sqlalchemy import delete, select

from app.notifications.line_group_settings import STAFF_KINDS
from app.notifications.models import LineCampusTarget, LineGroup, LineGroupSetting
from app.operations.models import AuditLogEntry
from tests.test_line_integrations_20261116 import fake_line  # noqa: F401

API = "/api/website/v1"
NOW = datetime(2026, 11, 17, 8, 0, tzinfo=timezone.utc)
GROUP = "C" + "a" * 32
GONE = "C" + "d" * 32
BODY = {"kinds": ["visit_request_created"], "digest_enabled": False, "mention_all_same_day": False, "is_hq": False}


async def _seed(db, target_id: str, *, verified: bool, left: bool = False) -> None:
    for model in (LineGroupSetting, LineCampusTarget):
        await db.execute(delete(model).where(model.target_id == target_id))
    await db.execute(delete(LineGroup).where(LineGroup.target_id == target_id))
    db.add(
        LineGroup(
            target_id=target_id,
            source_type="group",
            name="群組",
            first_seen_at=NOW,
            last_seen_at=NOW,
            left_at=NOW if left else None,
            verified_at=NOW if verified else None,
        )
    )
    await db.commit()


def _group(data: dict, target_id: str) -> dict:
    return next(g for g in data["groups"] if g["target_id"] == target_id)


async def test_get_line_settings_includes_group_flags_with_defaults(app, fake_line, admin_client, db_session):
    await _seed(db_session, GROUP, verified=True)
    group = _group((await admin_client.get(f"{API}/admin/line")).json(), GROUP)
    assert group["kinds"] == list(STAFF_KINDS)
    assert group["digest_enabled"] is True
    assert group["mention_all_same_day"] is True
    assert group["is_hq"] is False


async def test_update_group_settings_persists_and_audits(app, fake_line, admin_client, db_session):
    await _seed(db_session, GROUP, verified=True)
    resp = await admin_client.put(f"{API}/admin/line/groups/{GROUP}", json={**BODY, "is_hq": True})
    assert resp.status_code == 200, resp.text
    group = _group(resp.json(), GROUP)
    assert group["kinds"] == ["visit_request_created"]
    assert (group["digest_enabled"], group["mention_all_same_day"], group["is_hq"]) == (False, False, True)
    # 再改一次走更新（不是重複建立）。
    again = await admin_client.put(f"{API}/admin/line/groups/{GROUP}", json={**BODY, "digest_enabled": True})
    assert _group(again.json(), GROUP)["digest_enabled"] is True
    assert _group(again.json(), GROUP)["is_hq"] is False
    db_session.expire_all()
    rows = (await db_session.execute(select(LineGroupSetting).where(LineGroupSetting.target_id == GROUP))).scalars().all()
    assert len(rows) == 1
    entries = (
        await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "line.group.settings.update"))
    ).scalars().all()
    assert len(entries) == 2
    assert entries[0].metadata_json == {
        "kinds": ["visit_request_created"],
        "digest_enabled": False,
        "mention_all_same_day": False,
        "is_hq": True,
    }


async def test_unknown_kind_rejected_422(app, fake_line, admin_client, db_session):
    await _seed(db_session, GROUP, verified=True)
    resp = await admin_client.put(f"{API}/admin/line/groups/{GROUP}", json={**BODY, "kinds": ["visit_request_created", "bogus"]})
    assert resp.status_code == 422


async def test_unverified_group_cannot_be_hq(app, fake_line, admin_client, db_session):
    await _seed(db_session, GROUP, verified=False)
    resp = await admin_client.put(f"{API}/admin/line/groups/{GROUP}", json={**BODY, "is_hq": True})
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "LINE_GROUP_UNVERIFIED"
    ok = await admin_client.put(f"{API}/admin/line/groups/{GROUP}", json=BODY)
    assert ok.status_code == 200


async def test_missing_or_left_group_is_404(app, fake_line, admin_client, db_session):
    await _seed(db_session, GONE, verified=True, left=True)
    assert (await admin_client.put(f"{API}/admin/line/groups/{GONE}", json=BODY)).status_code == 404
    assert (await admin_client.put(f"{API}/admin/line/groups/C{'e' * 32}", json=BODY)).status_code == 404


async def test_non_authorized_user_forbidden(app, fake_line, minghua_client, db_session):
    await _seed(db_session, GROUP, verified=True)
    assert (await minghua_client.put(f"{API}/admin/line/groups/{GROUP}", json=BODY)).status_code == 403
