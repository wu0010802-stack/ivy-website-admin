"""歷年註冊的 extract／import 指令（2026-10-20 招生潛力與市佔率規格 §3.1）：輸出只有數字、多欄位整份拒絕、
錯誤訊息不印輸入值、同校整批取代；import 指令（正式站跑）完全不碰 xlrd。假檔用 xlwt 合成，不使用真的 xls。"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import date
from pathlib import Path
from typing import get_args

import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app import cli
from app.admissions.history.importer import replace_history
from app.admissions.history.models import HISTORY_GRADES, CampusTermEnrollment
from app.admissions.history.payload import FORMAT, EnrollmentHistoryIn, TermRowIn, build_payload, describe_error, load_payload
from app.admissions.history.workbook import TermRow, parse_workbook
from app.cli import (
    enrollment_history_extract_command,
    enrollment_history_extract_options,
    enrollment_history_import_command,
    enrollment_history_import_options,
)
from tests.history_helpers import (
    FAKE_NOTES,
    MODERN,
    SheetSpec,
    history_payload,
    history_text,
    modern_rows,
    term_row,
    write_workbook,
)

FAKE_NAMES = ("王小明", "李小華", "陳小美")
BACKEND = Path(__file__).resolve().parent.parent


def _two_terms(tmp_path: Path) -> Path:
    return write_workbook(tmp_path, {
        "114下": SheetSpec(MODERN, as_of_text="1150315", rows=modern_rows()),
        "115上": SheetSpec(MODERN, as_of_text="1150915", rows=modern_rows()),
    })


async def _stored(db) -> list[tuple[str, int, int, str]]:
    result = await db.execute(select(CampusTermEnrollment).order_by(
        CampusTermEnrollment.campus_key, CampusTermEnrollment.school_year,
        CampusTermEnrollment.semester, CampusTermEnrollment.grade,
    ))
    return [(r.campus_key, r.school_year, r.semester, r.grade) for r in result.scalars()]


def test_literals_and_fields_match_the_table():
    fields = TermRowIn.model_fields
    assert get_args(fields["grade"].annotation) == HISTORY_GRADES
    assert get_args(fields["semester"].annotation) == (1, 2)
    assert set(fields) == set(TermRow.__dataclass_fields__)


def test_build_payload_is_json_ready_numbers(tmp_path):
    payload = build_payload(parse_workbook(_two_terms(tmp_path)), "yihua")

    assert payload["format"] == FORMAT == "ivy-enrollment-history/1"
    assert payload["campus_key"] == "yihua"
    assert len(payload["rows"]) == 8
    assert payload["rows"][0]["as_of"] == "2026-03-15"
    json.dumps(payload)  # 沒有 date 之類 json 不認得的型別
    assert load_payload(json.dumps(payload)).rows[0].as_of == date(2026, 3, 15)


def test_extract_writes_numbers_only(tmp_path, capsys):
    out = tmp_path / "history.json"

    enrollment_history_extract_command(file=_two_terms(tmp_path), campus_key="yihua", out=out, headers_only=False)

    text = out.read_text(encoding="utf-8")
    written = json.loads(text)
    assert written["format"] == "ivy-enrollment-history/1"
    assert written["campus_key"] == "yihua"
    assert len(written["rows"]) == 8
    assert set(written) == {"format", "campus_key", "rows", "warnings"}
    assert {row["grade"] for row in written["rows"]} == {"大班", "中班", "小班", "幼幼班"}
    shown = capsys.readouterr()
    assert "已寫出" in shown.out and "8 列" in shown.out and "114下～115上" in shown.out
    for name in (*FAKE_NAMES, "新生(3人)", *FAKE_NOTES):
        assert name not in text and name not in shown.out and name not in shown.err
    assert load_payload(text).campus_key == "yihua"  # 寫出的檔案 import 一定收得下


def test_extract_prints_the_workbook_warnings(tmp_path, capsys):
    rows = modern_rows()
    path = write_workbook(tmp_path, {"115上": SheetSpec(MODERN, rows=rows, total={"registered": 1})})
    out = tmp_path / "history.json"

    enrollment_history_extract_command(file=path, campus_key="yihua", out=out, headers_only=False)

    assert "115上：總人數 1" in capsys.readouterr().out
    assert "115上：總人數 1" in json.loads(out.read_text(encoding="utf-8"))["warnings"][0]


def test_headers_only_prints_no_notes(tmp_path, capsys):
    path = _two_terms(tmp_path)
    out = tmp_path / "never.json"

    enrollment_history_extract_command(file=path, campus_key=None, out=None, headers_only=True)

    shown = capsys.readouterr()
    assert not out.exists()
    for name in (*FAKE_NAMES, "新生(3人)", *FAKE_NOTES):
        assert name not in shown.out and name not in shown.err
    lines = shown.out.splitlines()
    assert lines.index("114下") < lines.index("115上")  # 依學期排序
    assert "舊生" in shown.out and "在籍人數" in shown.out and "總人數" in shown.out
    assert "…" in shown.out  # 第 0 欄的標題與備註被遮掉


def test_extract_workbook_errors_exit_cleanly(tmp_path):
    broken = tmp_path / "broken.xls"
    broken.write_bytes(b"not an xls file")
    wrong_name = write_workbook(tmp_path, {"備註": SheetSpec(MODERN, rows=modern_rows())}, name="wrong.xls")
    out = tmp_path / "history.json"

    for path, expected in ((broken, "無法讀取活頁簿"), (wrong_name, "備註")):
        with pytest.raises(SystemExit) as caught:
            enrollment_history_extract_command(file=path, campus_key="yihua", out=out, headers_only=False)
        assert isinstance(caught.value.code, str) and expected in caught.value.code
    with pytest.raises(SystemExit):
        enrollment_history_extract_command(file=broken, campus_key=None, out=None, headers_only=True)
    assert not out.exists()


def test_extract_refuses_to_write_a_file_import_would_reject(tmp_path):
    path = write_workbook(tmp_path, {"98上": SheetSpec(MODERN, rows=modern_rows())})  # 比第一張表（99 上）還早
    out = tmp_path / "history.json"

    with pytest.raises(SystemExit) as caught:
        enrollment_history_extract_command(file=path, campus_key="yihua", out=out, headers_only=False)

    assert "沒有寫出" in caught.value.code and "school_year" in caught.value.code
    assert not out.exists()


def test_extract_without_xlrd_says_how_to_install(tmp_path, monkeypatch):
    monkeypatch.delitem(sys.modules, "app.admissions.history.workbook")
    monkeypatch.setitem(sys.modules, "xlrd", None)

    with pytest.raises(SystemExit) as caught:
        enrollment_history_extract_command(file=tmp_path / "x.xls", campus_key="yihua", out=tmp_path / "x.json", headers_only=False)
    assert caught.value.code == "要先在 backend 跑 uv sync --group extract"
    with pytest.raises(SystemExit) as caught:
        enrollment_history_extract_command(file=tmp_path / "x.xls", campus_key=None, out=None, headers_only=True)
    assert caught.value.code == "要先在 backend 跑 uv sync --group extract"


def test_production_modules_never_import_xlrd():
    code = (
        "import sys\n"
        "import app.cli, app.admissions.history.payload, app.admissions.history.importer\n"
        "loaded = [m for m in ('xlrd', 'app.admissions.history.workbook') if m in sys.modules]\n"
        "if loaded:\n"
        "    sys.exit(','.join(loaded))\n"
    )
    result = subprocess.run([sys.executable, "-c", code], cwd=BACKEND, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_extract_options(tmp_path):
    xls = tmp_path / "stats.xls"
    xls.write_bytes(b"")
    out = tmp_path / "out.json"

    assert enrollment_history_extract_options(["--file", str(xls), "--campus", "yihua", "--out", str(out)]) == {
        "file": xls, "campus_key": "yihua", "out": out, "headers_only": False,
    }
    assert enrollment_history_extract_options(["--headers-only", "--file", str(xls)]) == {
        "file": xls, "campus_key": None, "out": None, "headers_only": True,
    }
    for args in (
        [], ["--file", str(xls)], ["--file", str(xls), "--campus", "yihua"],
        ["--file", "/no/such.xls", "--campus", "yihua", "--out", str(out)],
        ["--file", str(xls), "--campus", "nowhere", "--out", str(out)],
        ["--headers-only"], ["--headers-only", "--file", "/no/such.xls"],
        ["--headers-only", "--file", str(xls), "--campus", "yihua"],
        ["--file", str(xls), "--campus", "yihua", "--out"],
        ["--file", str(xls), "--campus", "yihua", "--out", str(out), "--extra"],
    ):
        with pytest.raises(SystemExit):
            enrollment_history_extract_options(args)


def test_import_options(tmp_path):
    file = tmp_path / "history.json"
    file.write_text("{}", encoding="utf-8")

    assert enrollment_history_import_options(["--file", str(file)]) == {"file": file}
    for args in ([], ["--file"], ["--file", "/no/such.json"], ["--file", str(file), "--clear"]):
        with pytest.raises(SystemExit):
            enrollment_history_import_options(args)


@pytest.fixture
def cli_db(app, monkeypatch):
    async def session_factory():
        return app.state.session_factory

    monkeypatch.setattr(cli, "_session_factory", session_factory)
    monkeypatch.setattr(cli, "get_settings", lambda: app.state.settings)


# (payload, 不可出現在錯誤訊息裡的輸入值)
BAD_PAYLOADS = [
    (history_payload(names=["王小明"]), "王小明"),
    (history_payload([term_row(name="王小明")]), "王小明"),
    (history_payload(campus_key="秘密校"), "秘密校"),
    (history_payload([term_row(grade="其他")]), "其他"),
    (history_payload([term_row(), term_row()]), None),
    (history_payload([term_row(), term_row(registered=1)]), None),
    (history_payload(format="ivy-enrollment-history/2"), "history/2"),
    (history_payload(format=None), None),
    (history_payload([term_row(semester=3)]), None),
    (history_payload([term_row(school_year=98)]), None),
    (history_payload([term_row(registered=-1)]), None),
    (history_payload([term_row(registered=1000)]), None),
    (history_payload([term_row(new_visits=1000)]), None),
    (history_payload([term_row(registered=None)]), None),
    (history_payload([term_row(registered=40.5)]), None),
    (history_payload([term_row(as_of="秘密日期")]), "秘密日期"),
    (history_payload([]), None),
    (history_payload(warnings=["x" * 121]), None),
    (history_payload(warnings=["x"] * 201), None),
    (history_payload(warnings=[1]), None),
]


@pytest.mark.parametrize(("payload", "leaked"), BAD_PAYLOADS)
async def test_bad_payloads_are_rejected(tmp_path, capsys, payload, leaked):
    file = tmp_path / "bad.json"
    file.write_text(history_text(payload), encoding="utf-8")
    with pytest.raises(ValidationError):
        load_payload(history_text(payload))

    with pytest.raises(SystemExit) as caught:
        await enrollment_history_import_command(file=file)

    assert caught.value.code == 1
    shown = capsys.readouterr()
    assert "沒有匯入" in shown.err
    if leaked is not None:
        assert leaked not in shown.err and leaked not in shown.out


async def test_unparseable_files_are_rejected_without_echoing(tmp_path, capsys):
    not_json = tmp_path / "not.json"
    not_json.write_text("{王小明", encoding="utf-8")
    latin = tmp_path / "latin.json"
    latin.write_bytes(b"\xff\xfe\x00")

    for file in (not_json, latin):
        with pytest.raises(SystemExit) as caught:
            await enrollment_history_import_command(file=file)
        assert caught.value.code == 1
    shown = capsys.readouterr()
    assert "沒有匯入" in shown.err and "王小明" not in shown.err


def test_duplicate_term_error_names_the_field_but_not_the_values():
    with pytest.raises(ValidationError) as caught:
        load_payload(history_text(history_payload([term_row(), term_row()])))

    text = describe_error(caught.value)

    assert "rows" in text and "duplicate_term" in text
    assert "115" not in text and "大班" not in text


def test_error_description_lists_five_errors_at_most():
    rows = [term_row(semester=s, grade=g, registered=-1) for s in (1, 2) for g in HISTORY_GRADES]  # 8 個錯
    with pytest.raises(ValidationError) as caught:
        load_payload(history_text(history_payload(rows)))

    text = describe_error(caught.value)

    assert "rows.0.registered" in text and "rows.5.registered" not in text and "另有 3 個錯誤" in text


async def test_import_replaces_campus_only(db_session):
    first = load_payload(history_text(history_payload([
        term_row(115, 1, "大班"), term_row(115, 2, "大班"), term_row(114, 1, "小班", target=None, new_visits=None),
    ])))
    assert await replace_history(db_session, first) == 3
    other = load_payload(history_text(history_payload([term_row(115, 1, "中班", registered=7)], campus_key="minghua")))
    assert await replace_history(db_session, other) == 1
    await db_session.commit()
    assert len(await _stored(db_session)) == 4

    assert await replace_history(db_session, load_payload(history_text(history_payload([term_row(116, 1, "幼幼班")])))) == 1
    await db_session.commit()

    assert await _stored(db_session) == [("minghua", 115, 1, "中班"), ("yihua", 116, 1, "幼幼班")]
    row = await db_session.get(CampusTermEnrollment, ("minghua", 115, 1, "中班"))
    assert row.registered == 7 and row.as_of == date(2026, 9, 15) and row.imported_at is not None
    assert (row.target, row.returning_enrolled, row.repeat_registered) == (70, 43, 6)


async def test_import_keeps_missing_columns_as_null(db_session):
    payload = load_payload(history_text(history_payload([term_row(99, 1, "大班", target=None, new_target=None, new_visits=None)])))
    await replace_history(db_session, payload)
    await db_session.commit()

    row = await db_session.get(CampusTermEnrollment, ("yihua", 99, 1, "大班"))

    assert (row.target, row.new_target, row.new_visits) == (None, None, None)
    assert row.new_deposits == 20  # 沒給 None 的欄位照存


async def test_cli_import_prints_summary_and_warnings(db_session, cli_db, tmp_path, capsys):
    rows = [term_row(y, s, g) for y in (114, 115) for s in (1, 2) for g in HISTORY_GRADES]
    warnings = ["114下：總人數 1，四個年級 2、加重讀 3，都對不上", "99上：找不到「總人數」列，略過核對"]
    file = tmp_path / "history.json"
    file.write_text(history_text(history_payload(rows, warnings=warnings)), encoding="utf-8")

    await enrollment_history_import_command(file=file)

    out = capsys.readouterr().out.splitlines()
    assert out[0] == "匯入 yihua：16 列（114上～115下）"
    assert [line for line in out[1:] if "注意：" in line] == [f"注意：{w}" for w in warnings]
    assert len(await _stored(db_session)) == 16


async def test_cli_import_then_a_bad_file_keeps_the_old_data(db_session, cli_db, tmp_path, capsys):
    good = tmp_path / "good.json"
    good.write_text(history_text(history_payload([term_row(grade="大班"), term_row(grade="中班")])), encoding="utf-8")
    await enrollment_history_import_command(file=good)
    assert "匯入 yihua：2 列（115上～115上）" in capsys.readouterr().out
    bad = tmp_path / "bad.json"
    bad.write_text(history_text(history_payload([term_row(name="王小明")])), encoding="utf-8")

    with pytest.raises(SystemExit):
        await enrollment_history_import_command(file=bad)

    assert len(await _stored(db_session)) == 2
