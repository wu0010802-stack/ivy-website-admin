"""附近幼兒園清單的裁罰與評鑑摘要，以及展開用的明細端點（2026-10-20 規格 §5、C3、C11、C14）。

摘要：近 3 年件數（同一裁處日＋文號為一件）、最近一次裁處日、3 年前有沒有裁罰、最近一次評鑑。明細：該所全部裁罰與評鑑，
只有對象類別，沒有任何姓名（資料表裡根本沒有姓名，這裡再用整個同步流程走一遍確認回應裡找不到假姓名）。"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.admissions.geo import kindergarten_records as records
from app.admissions.geo.models import GeoDatasetStatus, GeoKindergarten, GeoKindergartenEvaluation, GeoKindergartenPenalty
from app.common.timezones import today_local
from tests.admissions_area_helpers import AREA
from tests.admissions_helpers import readonly_yihua_client, reception_yihua_client  # noqa: F401
from tests.geo_helpers import FAKE_PERSON_NAMES, load_geo_samples, publish_campus_address
from tests.test_geo_penalties_sync import PenaltySite
from tests.test_geo_sync import _sync, small_minimum  # noqa: F401

LIST = f"{AREA}/kindergartens"
# tests/fixtures/geo/preschools-sample.json：常春藤（義華旁的本機構）、何嘉仁（300 m）、保羅（513 m）、義華。
CHANGCHUN = "016cc701-ac12-4f88-9457-5eb6431ed449"
HOJIAREN = "e464ae13-0cbc-4a8e-9289-de0c18abc263"
PAUL = "0f26d968-d574-4e8f-bbdd-2b88a65efaf1"
YIHUA = "f52ff84f-335d-472e-955c-d441c562255f"
NOW = datetime(2026, 10, 20, 4, 0, tzinfo=timezone.utc)


def _penalty(source_id, name, day: date, doc_no="高市教幼字第1號", *, law="幼兒教育及照顧法第58條", kind="fine", amount=6000,
             subject="operator", digest="a", content="第17條第7項"):
    return GeoKindergartenPenalty(
        source_id=source_id, school_name=name, occurred_on=day, doc_no=doc_no, law=law, content=content, kind=kind,
        amount=amount, subject=subject, punishment_hash=digest, synced_at=NOW,
    )


def _evaluation(source_id, name, year, day, result):
    return GeoKindergartenEvaluation(
        source_id=source_id, school_name=name, school_year=year, completed_on=day, result=result, synced_at=NOW
    )


def _by_id(body: dict) -> dict[str, dict]:
    return {item["source_id"]: item for item in body["items"]}


@pytest.fixture
async def located(db_session):
    await load_geo_samples(db_session)
    await publish_campus_address(db_session, "yihua", "高雄市三民區義華路68號")


async def _seed(db, *, status: bool = True) -> dict[str, date]:
    """常春藤：近 3 年兩件（其中一件兩條法條）加 4 年前一件；何嘉仁：只有 4 年前；保羅：沒有裁罰。
    評鑑：常春藤兩筆（取學年度大的）、義華兩筆同學年（取完成日新的）。"""
    today = today_local()
    days = {
        "recent_a": today - timedelta(days=100), "recent_b": today - timedelta(days=400),
        "old": today - timedelta(days=4 * 365), "boundary": records.window_start(today),
    }
    changchun = "高雄市私立常春藤幼兒園"
    db.add_all([
        _penalty(CHANGCHUN, changchun, days["recent_a"], "文號甲", law="法條一", digest="a"),
        _penalty(CHANGCHUN, changchun, days["recent_a"], "文號甲", law="法條二", digest="b", amount=60000),
        _penalty(CHANGCHUN, changchun, days["recent_b"], "文號乙", subject="staff", digest="c"),
        _penalty(CHANGCHUN, changchun, days["old"], "文號丙", digest="d"),
        _penalty(HOJIAREN, "高雄市私立何嘉仁幼兒園", days["old"], "文號丁", digest="e"),
        _evaluation(CHANGCHUN, changchun, 107, date(2018, 10, 11), "全數指標通過基礎評鑑"),
        _evaluation(CHANGCHUN, changchun, 112, date(2025, 5, 16), "全數指標通過追蹤評鑑"),
        _evaluation(YIHUA, "高雄市私立義華幼兒園", 114, date(2025, 11, 21), "部分指標通過基礎評鑑"),
        _evaluation(YIHUA, "高雄市私立義華幼兒園", 114, date(2026, 4, 13), "全數指標通過追蹤評鑑"),
    ])
    if status:
        db.add_all([GeoDatasetStatus(dataset=name, active_version="x", label="2026-10-20", synced_at=NOW)
                    for name in ("kindergarten_penalties", "kindergarten_evaluations")])
    await db.commit()
    return days


def test_the_window_starts_three_years_ago_on_the_same_day():
    assert records.window_start(date(2026, 10, 20)) == date(2023, 10, 20)
    assert records.window_start(date(2028, 2, 29)) == date(2025, 2, 28)  # 三年前沒有 2 月 29 日


async def test_the_list_carries_recent_count_latest_date_older_flag_and_latest_evaluation(admin_client, db_session, located):
    days = await _seed(db_session)
    body = (await admin_client.get(f"{LIST}?campus_key=yihua&radius_km=6")).json()
    items = _by_id(body)
    changchun = items[CHANGCHUN]
    assert changchun["penalties_recent"] == 2  # 文號甲（兩條法條算一件）＋文號乙；4 年前那件不算
    assert changchun["penalty_latest_on"] == days["recent_a"].isoformat()
    assert changchun["has_older_penalty"] is True
    assert changchun["evaluation_latest"] == {"year": 112, "completed_on": "2025-05-16", "result": "全數指標通過追蹤評鑑"}
    assert changchun["is_own"] is True  # 本校照樣有（C14）
    hojiaren = items[HOJIAREN]
    assert (hojiaren["penalties_recent"], hojiaren["has_older_penalty"], hojiaren["penalty_latest_on"]) == (0, True, days["old"].isoformat())
    assert hojiaren["evaluation_latest"] is None
    paul = items[PAUL]
    assert (paul["penalties_recent"], paul["has_older_penalty"], paul["penalty_latest_on"], paul["evaluation_latest"]) == (0, False, None, None)
    # 同學年兩筆評鑑：取完成日新的
    assert items[YIHUA]["evaluation_latest"] == {"year": 114, "completed_on": "2026-04-13", "result": "全數指標通過追蹤評鑑"}
    assert body["penalties_synced_at"] is not None and body["evaluations_synced_at"] is not None


async def test_the_window_includes_the_start_day_and_excludes_the_day_before(admin_client, db_session, located):
    start = records.window_start(today_local())
    db_session.add_all([
        _penalty(CHANGCHUN, "高雄市私立常春藤幼兒園", start, "文號一", digest="a"),
        _penalty(HOJIAREN, "高雄市私立何嘉仁幼兒園", start - timedelta(days=1), "文號二", digest="b"),
    ])
    await db_session.commit()
    items = _by_id((await admin_client.get(f"{LIST}?campus_key=yihua&radius_km=6")).json())
    assert (items[CHANGCHUN]["penalties_recent"], items[CHANGCHUN]["has_older_penalty"]) == (1, False)
    assert (items[HOJIAREN]["penalties_recent"], items[HOJIAREN]["has_older_penalty"]) == (0, True)


async def test_the_same_case_under_two_file_names_counts_once(admin_client, db_session, located):
    """改名前後的兩個檔都對到同一所：同一裁處日、同一文號只算一件，明細也只列一次。"""
    day = today_local() - timedelta(days=30)
    db_session.add_all([
        _penalty(CHANGCHUN, "高雄市私立常春藤幼兒園", day, "文號甲"),
        _penalty(CHANGCHUN, "高雄市私立舊名幼兒園", day, "文號甲"),
    ])
    await db_session.commit()
    items = _by_id((await admin_client.get(f"{LIST}?campus_key=yihua&radius_km=6")).json())
    assert items[CHANGCHUN]["penalties_recent"] == 1
    detail = (await admin_client.get(f"{LIST}/{CHANGCHUN}/records?campus_key=yihua")).json()
    assert len(detail["penalties"]) == 1


async def test_a_dataset_that_was_never_imported_is_null_not_zero(admin_client, db_session, located):
    body = (await admin_client.get(f"{LIST}?campus_key=yihua&radius_km=6")).json()
    assert body["penalties_synced_at"] is None and body["evaluations_synced_at"] is None
    assert all(item["penalties_recent"] == 0 and item["evaluation_latest"] is None for item in body["items"])


async def test_unmatched_penalties_are_kept_but_never_listed(admin_client, db_session, located):
    db_session.add(_penalty(None, "高雄市私立已停辦幼兒園", today_local() - timedelta(days=10), "文號戊"))
    await db_session.commit()
    items = (await admin_client.get(f"{LIST}?campus_key=yihua&radius_km=6")).json()["items"]
    assert sum(item["penalties_recent"] for item in items) == 0


async def test_the_records_endpoint_lists_every_penalty_and_evaluation_newest_first(admin_client, db_session, located):
    days = await _seed(db_session)
    response = await admin_client.get(f"{LIST}/{CHANGCHUN}/records?campus_key=yihua")
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["source_id"], body["name"]) == (CHANGCHUN, "高雄市私立常春藤幼兒園")
    assert body["penalties_synced_at"] is not None and body["evaluations_synced_at"] is not None
    assert body["source_note"] == "資料來源：全國教保資訊網（裁罰經 kiang 整理）"
    assert [(row["occurred_on"], row["doc_no"], row["recent"]) for row in body["penalties"]] == [
        (days["recent_a"].isoformat(), "文號甲", True), (days["recent_a"].isoformat(), "文號甲", True),
        (days["recent_b"].isoformat(), "文號乙", True), (days["old"].isoformat(), "文號丙", False),
    ]
    first = body["penalties"][0]
    assert set(first) == {
        "occurred_on", "doc_no", "law", "content", "kind", "amount", "period_start", "period_end", "punishment_text",
        "subject", "recent",
    }
    assert (first["law"], first["kind"], first["amount"], first["subject"]) == ("法條一", "fine", 6000, "operator")
    assert body["penalties"][2]["subject"] == "staff"
    assert [(row["school_year"], row["completed_on"]) for row in body["evaluations"]] == [(112, "2025-05-16"), (107, "2018-10-11")]


async def test_a_school_without_records_gets_empty_lists(admin_client, db_session, located):
    body = (await admin_client.get(f"{LIST}/{PAUL}/records?campus_key=yihua")).json()
    assert (body["penalties"], body["evaluations"]) == ([], [])


async def test_period_penalties_and_other_penalties_keep_their_fields(admin_client, db_session, located):
    db_session.add_all([
        GeoKindergartenPenalty(
            source_id=PAUL, school_name="高雄市私立保羅幼兒園", occurred_on=date(2025, 3, 10), doc_no="一", law="法", content="內容",
            kind="stop_enrollment", period_start=date(2025, 4, 1), period_end=date(2025, 6, 30), subject="staff",
            punishment_hash="a", synced_at=NOW,
        ),
        GeoKindergartenPenalty(
            source_id=PAUL, school_name="高雄市私立保羅幼兒園", occurred_on=date(2024, 3, 10), doc_no="二", law="法", content="內容",
            kind="other", punishment_text="警告", subject=None, punishment_hash="b", synced_at=NOW,
        ),
    ])
    await db_session.commit()
    rows = (await admin_client.get(f"{LIST}/{PAUL}/records?campus_key=yihua")).json()["penalties"]
    assert (rows[0]["kind"], rows[0]["period_start"], rows[0]["period_end"], rows[0]["amount"]) == ("stop_enrollment", "2025-04-01", "2025-06-30", None)
    assert (rows[1]["kind"], rows[1]["punishment_text"], rows[1]["subject"]) == ("other", "警告", None)


async def test_the_records_endpoint_is_404_for_an_unknown_school_and_for_an_unknown_campus(admin_client, located):
    assert (await admin_client.get(f"{LIST}/no-such-school/records?campus_key=yihua")).status_code == 404
    assert (await admin_client.get(f"{LIST}/{PAUL}/records?campus_key=nowhere")).status_code == 404
    assert (await admin_client.get(f"{LIST}/{PAUL}/records")).status_code == 422  # 沒帶 campus_key


async def test_the_records_endpoint_permissions_follow_the_area_analysis(
    reception_yihua_client, readonly_yihua_client, editor_client, minghua_client, public_client, admin_client, located
):
    path = f"{LIST}/{PAUL}/records?campus_key="
    assert (await public_client.get(path + "yihua")).status_code == 401
    for client in (reception_yihua_client, editor_client, readonly_yihua_client, minghua_client):
        assert (await client.get(path + "yihua")).status_code == 403
        assert (await client.get(path + "minghua")).status_code == 403
    assert (await admin_client.get(path + "yihua")).status_code == 200
    assert (await admin_client.get(path + "minghua")).status_code == 200


async def test_the_records_endpoint_does_not_write_an_audit_log(admin_client, db_session, located):
    from app.operations.models import AuditLogEntry as AuditLog

    before = len((await db_session.execute(select(AuditLog))).scalars().all())
    await admin_client.get(f"{LIST}/{PAUL}/records?campus_key=yihua")
    await admin_client.get(f"{LIST}?campus_key=yihua")
    assert len((await db_session.execute(select(AuditLog))).scalars().all()) == before


async def test_after_a_real_sync_no_person_name_appears_in_any_response(app, admin_client, db_session, small_minimum):
    """從假的 kiang 裁罰檔（每筆都有「負責人／行為人：假姓名」）同步進來，再走清單與明細：回應裡找不到任何假姓名，
    對象只有類別。"""
    await _sync(app, PenaltySite().transport)
    await publish_campus_address(db_session, "yihua", "高雄市三民區義華路68號")
    listing = await admin_client.get(f"{LIST}?campus_key=yihua&radius_km=6")
    assert listing.status_code == 200
    items = _by_id(listing.json())
    source_id = (await db_session.execute(select(GeoKindergarten.source_id).where(GeoKindergarten.name == "高雄市私立保羅幼兒園"))).scalar_one()
    detail = await admin_client.get(f"{LIST}/{source_id}/records?campus_key=yihua")
    assert detail.status_code == 200
    changchun = next(item for item in items.values() if item["name"] == "高雄市私立常春藤幼兒園")
    assert changchun["penalties_recent"] >= 1 or changchun["has_older_penalty"]
    for response in (listing, detail):
        for person in FAKE_PERSON_NAMES:
            assert person not in response.text
        assert "負責人：" not in response.text and "行為人：" not in response.text
    paul = detail.json()["penalties"]
    assert {row["subject"] for row in paul} == {"staff", "operator"}  # 保羅檔裡：一筆行為人、一筆負責人
    assert {row["kind"] for row in paul} == {"stop_enrollment", "reduce_enrollment"}
