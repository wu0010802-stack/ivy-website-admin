"""匯入去識別 JSON（2026-10-15 規格 §3.5）：多欄位整份拒絕、錯誤訊息不印輸入值、整批取代、失敗不動舊資料。"""
from __future__ import annotations

import pytest
from pydantic import ValidationError
from sqlalchemy import func, select

from app import cli
from app.admissions.enrolled.importer import clear_roster, describe_error, load_payload, replace_roster
from app.admissions.enrolled.models import ENROLLED_GRADES, ENROLLED_LEVELS, ENROLLED_REASONS, EnrolledRoster, EnrolledStudentPoint
from app.cli import enrolled_import_command, enrolled_import_options
from tests.enrolled_helpers import payload_text, points_payload, student
from tests.geo_helpers import load_geo_samples


async def _count(db) -> int:
    return await db.scalar(select(func.count()).select_from(EnrolledStudentPoint))


def test_literals_match_the_table_constants():
    from typing import get_args

    from app.admissions.enrolled.importer import EnrolledStudentIn

    fields = EnrolledStudentIn.model_fields
    assert get_args(fields["grade"].annotation) == ENROLLED_GRADES
    assert get_args(fields["match_level"].annotation) == ENROLLED_LEVELS
    assert get_args(get_args(fields["unlocated_reason"].annotation)[0]) == ENROLLED_REASONS


async def test_replace_roster_swaps_the_whole_campus(db_session):
    await replace_roster(db_session, load_payload(payload_text(points_payload([student(), student(grade="中班")]))))
    await db_session.commit()
    assert await _count(db_session) == 2
    total, placed = await replace_roster(
        db_session,
        load_payload(payload_text(points_payload([student(match_level="street", lat=None, lng=None)], roster_date="2026-11-01"))),
    )
    await db_session.commit()
    assert (total, placed) == (1, 0)
    assert await _count(db_session) == 1
    roster = await db_session.get(EnrolledRoster, "yihua")
    assert (roster.total, roster.roster_date.isoformat()) == (1, "2026-11-01")


async def test_clear_roster(db_session):
    await replace_roster(db_session, load_payload(payload_text(points_payload())))
    await db_session.commit()
    assert await clear_roster(db_session, "yihua") is True
    await db_session.commit()
    assert await _count(db_session) == 0
    assert await clear_roster(db_session, "yihua") is False


@pytest.mark.parametrize(
    "payload",
    [
        points_payload([student(address="高雄市三民區秘密路9號")]),
        points_payload(note="x"),
        points_payload([student(grade="小一")]),
        points_payload([student(match_level="pending")]),
        points_payload([student(match_level="street")]),
        points_payload([student(lat=None, lng=None)]),
        points_payload([student(lng=None)]),
        points_payload([student(lat=25.033, lng=121.565)]),
        points_payload([student(lat=22.6424)]),
        points_payload([student(unlocated_reason="anonymized")]),
        points_payload([student(district="義華路68號")]),
        points_payload([student(village="義華路68號")]),
        points_payload([student(district="台北市")]),
        points_payload([student(village="本揚")]),
        points_payload(campus_key="nowhere"),
        points_payload(format="ivy-enrolled-points/2"),
        points_payload([]),
    ],
)
def test_bad_payloads_are_rejected(payload):
    with pytest.raises(ValidationError):
        load_payload(payload_text(payload))


def test_error_description_never_echoes_input_values():
    with pytest.raises(ValidationError) as caught:
        load_payload(payload_text(points_payload([student(address="高雄市三民區秘密路9號")])))
    text = describe_error(caught.value)
    assert "students.0.address" in text
    assert "秘密路" not in text


@pytest.mark.parametrize(
    ("changes", "field"),
    [
        ({"district": "義華路68號"}, "district"),
        ({"village": "義華路68號"}, "village"),
        ({"district": "台北市"}, "district"),
    ],
)
def test_district_and_village_whitelist_errors_name_the_field_but_not_the_value(changes, field):
    with pytest.raises(ValidationError) as caught:
        load_payload(payload_text(points_payload([student(**changes)])))
    text = describe_error(caught.value)
    assert f"students.0.{field}" in text
    assert "義華路" not in text and "台北" not in text


def test_a_village_or_district_that_is_none_is_allowed():
    load_payload(payload_text(points_payload([
        student(district=None, village=None, match_level="unlocated", unlocated_reason="no_address", lat=None, lng=None),
        student(village="大寮村"),
    ])))


def test_cli_options(tmp_path):
    file = tmp_path / "points.json"
    file.write_text("{}", encoding="utf-8")
    assert enrolled_import_options(["--file", str(file)]) == {"file": file, "clear": None}
    assert enrolled_import_options(["--clear", "--campus", "yihua"]) == {"file": None, "clear": "yihua"}
    for args in ([], ["--file", "/no/such.json"], ["--clear", "--campus", "nowhere"], ["--clear"]):
        with pytest.raises(SystemExit):
            enrolled_import_options(args)


@pytest.fixture
def cli_db(app, monkeypatch):
    async def session_factory():
        return app.state.session_factory

    monkeypatch.setattr(cli, "_session_factory", session_factory)
    monkeypatch.setattr(cli, "get_settings", lambda: app.state.settings)


async def test_cli_import_then_a_bad_file_keeps_the_old_data(db_session, cli_db, tmp_path, capsys):
    good = tmp_path / "good.json"
    good.write_text(payload_text(points_payload([student(), student(grade="大班")])), encoding="utf-8")
    await enrolled_import_command(file=good, clear=None)
    assert "匯入 yihua：2 位（有點 2 位），清冊日期 2026-10-15" in capsys.readouterr().out
    bad = tmp_path / "bad.json"
    bad.write_text(payload_text(points_payload([student(address="高雄市三民區秘密路9號")])), encoding="utf-8")
    with pytest.raises(SystemExit) as caught:
        await enrolled_import_command(file=bad, clear=None)
    assert caught.value.code == 1
    err = capsys.readouterr().err
    assert "沒有匯入" in err and "秘密路" not in err
    assert await _count(db_session) == 2


async def test_cli_clear(db_session, cli_db, tmp_path, capsys):
    good = tmp_path / "good.json"
    good.write_text(payload_text(points_payload()), encoding="utf-8")
    await enrolled_import_command(file=good, clear=None)
    await enrolled_import_command(file=None, clear="yihua")
    assert "已刪除 yihua 的在籍學生資料" in capsys.readouterr().out
    assert await _count(db_session) == 0


@pytest.mark.parametrize(
    ("loaded", "version", "warned"),
    [(True, "115-09", True), (True, "115-10", False), (False, "115-09", False)],
)
async def test_cli_import_warns_when_the_doorplate_version_differs(db_session, cli_db, tmp_path, capsys, loaded, version, warned):
    if loaded:
        await load_geo_samples(db_session)  # 使用中的門牌版本標籤是 115-10
    file = tmp_path / "points.json"
    file.write_text(payload_text(points_payload(doorplate_version=version)), encoding="utf-8")
    await enrolled_import_command(file=file, clear=None)
    out = capsys.readouterr().out
    assert "匯入 yihua：1 位" in out  # 只警告、不阻止匯入
    assert ("注意：比對用的門牌版本" in out) is warned
    if warned:
        assert "注意：比對用的門牌版本（115-09）和正式站使用中的版本（115-10）不同，點的位置以比對時為準，里名可能和現行門牌不一致。" in out
