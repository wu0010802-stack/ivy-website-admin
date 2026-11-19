"""LINE 群組設定與推播目標計算（docs/specs/2026-11-17-line-group-interactions-design.md §4.4）。"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.notifications.line_group_settings import STAFF_KINDS, campuses_served, targets_for
from app.notifications.models import LineCampusTarget, LineGroup, LineGroupSetting

NOW = datetime(2026, 11, 17, 8, 0, tzinfo=timezone.utc)
CAMPUS_GROUP = "C" + "a" * 32
HQ_GROUP = "C" + "b" * 32
UNBOUND = "C" + "c" * 32


def _group(target_id: str, *, left: bool = False) -> LineGroup:
    return LineGroup(
        target_id=target_id,
        source_type="group",
        name=target_id[:4],
        first_seen_at=NOW,
        last_seen_at=NOW,
        left_at=NOW if left else None,
    )


async def _bind(db, campus_key: str, target_id: str) -> None:
    await db.merge(LineCampusTarget(campus_key=campus_key, target_id=target_id, updated_at=NOW))


async def _clean(db) -> None:
    from sqlalchemy import delete

    for model in (LineGroupSetting, LineCampusTarget, LineGroup):
        await db.execute(delete(model))
    await db.commit()


@pytest.mark.asyncio
async def test_targets_for_unset_group_gets_defaults(db_session):
    db = db_session
    await _clean(db)
    db.add(_group(CAMPUS_GROUP))
    await db.flush()
    await _bind(db, "yihua", CAMPUS_GROUP)
    await db.commit()
    targets = await targets_for(db, "yihua")
    assert len(targets) == 1
    t = targets[0]
    assert t.target_id == CAMPUS_GROUP
    assert t.kinds == frozenset(STAFF_KINDS)
    assert t.digest_enabled is True
    assert t.mention_all_same_day is True
    assert t.is_hq is False
    await _clean(db)


@pytest.mark.asyncio
async def test_hq_group_is_added_to_every_campus(db_session):
    db = db_session
    await _clean(db)
    db.add_all([_group(CAMPUS_GROUP), _group(HQ_GROUP)])
    await db.flush()
    await _bind(db, "yihua", CAMPUS_GROUP)
    db.add(
        LineGroupSetting(
            target_id=HQ_GROUP,
            kinds=["visit_request_created"],
            digest_enabled=False,
            mention_all_same_day=False,
            is_hq=True,
            updated_at=NOW,
        )
    )
    await db.commit()
    yihua = await targets_for(db, "yihua")
    assert {t.target_id for t in yihua} == {CAMPUS_GROUP, HQ_GROUP}
    hq = next(t for t in yihua if t.target_id == HQ_GROUP)
    assert hq.is_hq is True and hq.kinds == frozenset({"visit_request_created"})
    assert hq.digest_enabled is False
    minghua = await targets_for(db, "minghua")
    assert [t.target_id for t in minghua] == [HQ_GROUP]
    await _clean(db)


@pytest.mark.asyncio
async def test_group_that_left_is_excluded(db_session):
    db = db_session
    await _clean(db)
    db.add_all([_group(CAMPUS_GROUP, left=True), _group(HQ_GROUP, left=True)])
    await db.flush()
    await _bind(db, "yihua", CAMPUS_GROUP)
    db.add(LineGroupSetting(target_id=HQ_GROUP, is_hq=True, updated_at=NOW))
    await db.commit()
    assert await targets_for(db, "yihua") == []
    assert await campuses_served(db, CAMPUS_GROUP) is None
    assert await campuses_served(db, HQ_GROUP) is None
    await _clean(db)


@pytest.mark.asyncio
async def test_campuses_served(db_session):
    db = db_session
    await _clean(db)
    db.add_all([_group(CAMPUS_GROUP), _group(HQ_GROUP), _group(UNBOUND)])
    await db.flush()
    await _bind(db, "yihua", CAMPUS_GROUP)
    db.add(LineGroupSetting(target_id=HQ_GROUP, is_hq=True, updated_at=NOW))
    await db.commit()
    assert await campuses_served(db, CAMPUS_GROUP) == ["yihua"]
    hq = await campuses_served(db, HQ_GROUP)
    assert hq is not None and {"yihua", "minghua"} <= set(hq)
    assert await campuses_served(db, UNBOUND) is None
    assert await campuses_served(db, "C" + "d" * 32) is None
    await _clean(db)
