"""本機比對：清冊 → 去識別 JSON ＋ 命中報告（2026-10-15 規格 §3.3–3.5）。"""
from __future__ import annotations

import json
from datetime import date

import pytest

from app import cli
from app.admissions.enrolled import match as match_module
from app.admissions.enrolled.match import MatchError, masked_address, match_roster, match_students, report_lines, round_coord
from app.admissions.enrolled.roster import parse_roster
from app.cli import enrolled_match_command, enrolled_match_options
from tests.enrolled_helpers import roster_html
from tests.geo_helpers import load_geo_samples, publish_campus_address

STUDENT_KEYS = {"grade", "district", "village", "match_level", "unlocated_reason", "lat", "lng"}
ROWS = [
    ("2023/03/01", "本揚里1鄰義華路68號"),
    ("2023/03/01", "本揚里1鄰義華路68號"),  # 手足同住：兩位都要算
    ("2021/05/05", "高雄市三民區義華路999號"),
    ("2022/12/12", "臺北市內湖區文德路1號"),
]


async def _ready(db) -> None:
    await load_geo_samples(db)
    await publish_campus_address(db, "yihua", "高雄市三民區義華路68號")


def test_round_coord_keeps_three_decimals():
    assert round_coord(22.6424556) == 22.642
    assert round_coord(120.3437133) == 120.344
    assert round_coord(22.6425) == 22.643


def test_masked_address_keeps_only_the_street():
    assert masked_address("本揚里1鄰義華路68號3樓") == "義華路…"
    assert masked_address("高雄市三民區義華路12巷3號") == "義華路…"
    assert masked_address("臺北市內湖區文德路1號") == ""
    assert masked_address("") == ""
    assert masked_address("試徳街5號3樓") == "試德街…"


@pytest.mark.parametrize("raw", ["某某社區A棟5樓之3", "三民區某某新村5棟3樓", "XX大樓12F義華路"])
def test_masked_address_drops_building_and_floor_text(raw):
    # 沒有純中文的路／街／大道名時，parse_address 會把整段當 street；報告不能印出棟、樓、單位。
    assert masked_address(raw) == ""


async def test_payload_is_deidentified_and_sorted(db_session):
    await _ready(db_session)
    outcome = await match_roster(db_session, parse_roster(roster_html(ROWS)), campus_key="yihua", roster_date=date(2026, 10, 15))
    payload = outcome.payload
    assert set(payload) == {"format", "campus_key", "roster_date", "school_year", "doorplate_version", "students"}
    assert payload["format"] == "ivy-enrolled-points/1"
    assert (payload["roster_date"], payload["school_year"], payload["doorplate_version"]) == ("2026-10-15", 115, "115-10")
    students = payload["students"]
    assert len(students) == 4
    assert all(set(item) == STUDENT_KEYS for item in students)
    assert [item["grade"] for item in students] == ["小班", "小班", "小班", "大班"]
    placed = [item for item in students if item["lat"] is not None]
    assert [(item["lat"], item["lng"]) for item in placed] == [(22.642, 120.344), (22.642, 120.344)]
    text = json.dumps(payload, ensure_ascii=False)
    assert "義華路" not in text and "文德路" not in text
    assert outcome.placed_ratio == 0.5


async def test_report_counts_and_masks_unplaced_addresses(db_session):
    await _ready(db_session)
    outcome = await match_roster(db_session, parse_roster(roster_html(ROWS)), campus_key="yihua", roster_date=date(2026, 10, 15))
    report = "\n".join(outcome.report)
    assert "共 4 位" in report
    assert "有點 2 位（50.0%）" in report
    assert "班別：小班 3、大班 1" in report
    assert "義華路…" in report
    assert "999" not in report and "文德路" not in report


async def test_report_prints_only_level_and_reason_without_a_plain_street(db_session):
    await _ready(db_session)
    rows = [("2023/03/01", "某某社區A棟5樓之3"), ("2023/03/01", "三民區某某新村5棟3樓"), ("2023/03/01", "XX大樓12F義華路")]
    outcome = await match_roster(db_session, parse_roster(roster_html(rows)), campus_key="yihua", roster_date=date(2026, 10, 15))
    report = "\n".join(outcome.report)
    assert "某某" not in report and "5棟" not in report and "5樓" not in report and "12F" not in report
    assert "  unlocated／no_doorplate" in outcome.report  # 只有等級與原因，後面沒有街路欄


async def test_match_students_takes_grades_as_given(db_session):
    await _ready(db_session)
    outcome = await match_students(
        db_session, [("大班", "本揚里1鄰義華路68號"), ("其他", "臺北市內湖區文德路1號")],
        campus_key="yihua", roster_date=date(2026, 10, 15),
    )
    assert [s["grade"] for s in outcome.payload["students"]] == ["大班", "其他"]
    assert outcome.summary.grades == {"大班": 1, "其他": 1}
    assert (outcome.summary.total, outcome.summary.placed) == (2, 1)
    assert outcome.summary.school_year == 115


async def test_report_is_built_from_the_summary(db_session):
    await _ready(db_session)
    outcome = await match_roster(db_session, parse_roster(roster_html(ROWS)), campus_key="yihua", roster_date=date(2026, 10, 15))
    assert report_lines(outcome.summary) == outcome.report
    assert all(u.street == "" or u.street.endswith("…") for u in outcome.summary.unplaced)


async def test_unknown_grade_is_rejected(db_session):
    await _ready(db_session)
    with pytest.raises(MatchError) as caught:
        await match_students(db_session, [("大大班", "本揚里1鄰義華路68號")], campus_key="yihua", roster_date=date(2026, 10, 15))
    assert "第 1 位" in str(caught.value)
    assert "義華路" not in str(caught.value)  # 錯誤訊息不帶地址


async def test_empty_student_list_is_rejected(db_session):
    # 沒匯門牌也要先回「沒有學生」：空清單在查資料庫之前就擋掉，不會走到 placed / total。
    with pytest.raises(MatchError, match="沒有學生資料"):
        await match_students(db_session, [], campus_key="yihua", roster_date=date(2026, 10, 15))


async def test_row_order_cannot_be_traced_back_to_the_roster(db_session):
    await _ready(db_session)
    # 班別、區、里、等級、座標都相同，只差 unlocated_reason：排序也要把它算進去，列序才不會留著清冊順序。
    rows = [("2023/03/01", "臺北市內湖區文德路1號"), ("2023/03/01", "沒有這條路99號")]
    forward = await match_roster(db_session, parse_roster(roster_html(rows)), campus_key="yihua", roster_date=date(2026, 10, 15))
    backward = await match_roster(db_session, parse_roster(roster_html(rows[::-1])), campus_key="yihua", roster_date=date(2026, 10, 15))
    assert {item["unlocated_reason"] for item in forward.payload["students"]} == {"outside_kaohsiung", "no_doorplate"}
    assert forward.payload == backward.payload


async def test_needs_doorplates_and_a_located_campus(db_session):
    roster = parse_roster(roster_html(ROWS))
    with pytest.raises(MatchError, match="門牌"):
        await match_roster(db_session, roster, campus_key="yihua", roster_date=date(2026, 10, 15))
    await load_geo_samples(db_session)
    with pytest.raises(MatchError, match="本校沒有座標"):
        await match_roster(db_session, roster, campus_key="yihua", roster_date=date(2026, 10, 15))


async def test_a_failing_lookup_names_only_the_position(db_session, monkeypatch):
    await _ready(db_session)
    real = match_module.locate_roster_address
    calls = 0

    async def flaky(db, raw, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("秘密路9號")  # 資料庫錯誤的訊息可能帶著 SQL 參數
        return await real(db, raw, **kwargs)

    monkeypatch.setattr(match_module, "locate_roster_address", flaky)
    with pytest.raises(MatchError) as caught:
        await match_roster(db_session, parse_roster(roster_html(ROWS)), campus_key="yihua", roster_date=date(2026, 10, 15))
    error = caught.value
    assert "第 2 位" in str(error)
    assert "秘密路" not in str(error)
    assert error.__cause__ is None and error.__suppress_context__ is True


def test_cli_options(tmp_path):
    roster = tmp_path / "roster.xls"
    roster.write_text(roster_html(ROWS), encoding="utf-8")
    options = enrolled_match_options(["--roster", str(roster), "--campus", "yihua", "--out", str(tmp_path / "o.json")])
    assert options == {
        "roster": roster, "campus_key": "yihua", "out": tmp_path / "o.json", "roster_date": None, "allow_low_hit": False,
    }
    assert enrolled_match_options(
        ["--roster", str(roster), "--campus", "yihua", "--out", "o.json", "--roster-date", "2026-10-15", "--allow-low-hit"]
    )["roster_date"] == date(2026, 10, 15)


@pytest.mark.parametrize(
    "args",
    [
        [],
        ["--roster", "/no/such.xls", "--campus", "yihua", "--out", "o.json"],
        ["--campus", "yihua", "--out", "o.json"],
        ["--roster", "ROSTER", "--campus", "nowhere", "--out", "o.json"],
        ["--roster", "ROSTER", "--campus", "yihua", "--out", "o.json", "--roster-date", "115/10/15"],
    ],
)
def test_cli_rejects_bad_options(tmp_path, args):
    roster = tmp_path / "roster.xls"
    roster.write_text(roster_html(ROWS), encoding="utf-8")
    with pytest.raises(SystemExit):
        enrolled_match_options([str(roster) if item == "ROSTER" else item for item in args])


@pytest.fixture
def cli_db(app, monkeypatch):
    async def session_factory():
        return app.state.session_factory

    monkeypatch.setattr(cli, "_session_factory", session_factory)
    monkeypatch.setattr(cli, "get_settings", lambda: app.state.settings)


async def test_cli_refuses_a_low_hit_rate_unless_allowed(db_session, cli_db, tmp_path, capsys):
    await _ready(db_session)
    roster = tmp_path / "roster.xls"
    roster.write_text(roster_html(ROWS), encoding="utf-8")
    out = tmp_path / "points.json"
    options = dict(roster=roster, campus_key="yihua", out=out, roster_date=None)
    with pytest.raises(SystemExit) as caught:
        await enrolled_match_command(**options, allow_low_hit=False)
    assert caught.value.code == 2
    assert not out.exists()
    assert "不到 90%" in capsys.readouterr().err
    await enrolled_match_command(**options, allow_low_hit=True)
    assert json.loads(out.read_text(encoding="utf-8"))["format"] == "ivy-enrolled-points/1"


async def test_cli_needs_a_roster_date(db_session, cli_db, tmp_path, capsys):
    roster = tmp_path / "roster.xls"
    roster.write_text(roster_html(ROWS, printed=None), encoding="utf-8")
    with pytest.raises(SystemExit) as caught:
        await enrolled_match_command(roster=roster, campus_key="yihua", out=tmp_path / "o.json", roster_date=None, allow_low_hit=True)
    assert caught.value.code == 1
    assert "--roster-date" in capsys.readouterr().err
