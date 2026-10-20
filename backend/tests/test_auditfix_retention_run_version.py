"""立即清理要綁住確認當下的保存政策版本（2026-10-20 稽核 #11）。

確認框寫的是依當時天數試算的筆數；確認框開著時另一位總管理者把天數改短，執行就會依新天數匿名化更多筆，
而且無法復原。執行帶 expected_version，和鎖住的政策不一致就回 409、什麼都不清。"""

from __future__ import annotations

import pytest
from sqlalchemy import func, select

from app.operations.models import RetentionRun

pytestmark = pytest.mark.usefixtures("booking_consent")

BASE = "/api/website/v1/admin"
POLICY = f"{BASE}/site-policies/retention"
RUN = f"{BASE}/retention/run"


def _allow_real_run(app) -> None:
    app.state.settings = app.state.settings.model_copy(update={"retention_allow_real_run": True})


async def _runs(db_session) -> int:
    return await db_session.scalar(select(func.count()).select_from(RetentionRun))


@pytest.mark.asyncio
async def test_run_with_stale_policy_version_is_409_and_cleans_nothing(app, admin_client, db_session):
    _allow_real_run(app)
    seen = (await admin_client.get(POLICY)).json()
    changed = await admin_client.put(
        POLICY,
        json={
            "expected_version": seen["version"],
            "cancelled_days": 30,
            "completed_days": seen["completed_days"],
            "open_overdue_days": seen["open_overdue_days"],
            "auto_run_enabled": False,
        },
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["version"] == seen["version"] + 1

    stale = await admin_client.post(RUN, json={"expected_version": seen["version"]})

    assert stale.status_code == 409, stale.text
    assert stale.json()["detail"]["code"] == "RETENTION_POLICY_VERSION_CONFLICT"
    assert stale.json()["detail"]["current_version"] == seen["version"] + 1
    assert await _runs(db_session) == 0

    fresh = await admin_client.post(RUN, json={"expected_version": seen["version"] + 1})
    assert fresh.status_code == 200, fresh.text
    assert await _runs(db_session) == 1


@pytest.mark.asyncio
async def test_run_without_body_still_works_for_older_admin(app, admin_client, db_session):
    _allow_real_run(app)
    assert (await admin_client.post(RUN)).status_code == 200
    assert await _runs(db_session) == 1
