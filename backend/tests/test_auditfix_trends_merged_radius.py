"""里界調整合併組跨過半徑時，總結句的里數要和孩子數講同一批里（2026-10-20 稽核 #12）。

合併組要整組算（調整過的里各自和一年前比沒有意義），所以會帶進半徑外的組員；baseline 的孩子數、淨增
都含這些組員，里數卻只算半徑內。另給 villages_outside（合併組帶進來、在半徑外的里數），畫面據此寫明。"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.admissions.geo.models import GeoVillageMigration
from tests.test_admissions_trends import BENSHANG, BENWU, OLD_CODE, _by_key, _get, _seed, located_campus  # noqa: F401


async def _adjust_benwu(db_session) -> None:
    # 本武里（1.5 公里，1 公里半徑外）同一期也有行政區域調整：和本上里、舊里併成同一組。
    row = (
        await db_session.execute(
            select(GeoVillageMigration).where(GeoVillageMigration.village_code == BENWU, GeoVillageMigration.month == "115-07")
        )
    ).scalar_one()
    row.boundary_in = 100
    await db_session.commit()


@pytest.mark.asyncio
async def test_baseline_counts_villages_pulled_in_from_outside_the_radius(admin_client, db_session, located_campus):  # noqa: F811
    await _seed(db_session)
    await _adjust_benwu(db_session)
    body = await _get(admin_client)

    group = _by_key(body)[f"group:三民區:{BENWU}"]
    assert set(group["codes"]) == {BENSHANG, BENWU, OLD_CODE}
    assert group["children"] == 40 + 16  # 本上里＋本武里
    baseline = body["baseline"]
    assert baseline["villages"] == 12  # 半徑內
    assert baseline["villages_outside"] == 1  # 本武里
    assert baseline["children"] == sum(row["children"] or 0 for row in body["villages"])


@pytest.mark.asyncio
async def test_no_villages_outside_when_groups_stay_inside(admin_client, db_session, located_campus):  # noqa: F811
    await _seed(db_session)
    assert (await _get(admin_client))["baseline"]["villages_outside"] == 0
