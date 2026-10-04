"""園務轉移契約（規格 12.2；R13）：用合成資料跑匯出，逐列對照
contracts/ivy-recruitment/ivy-schema.json。CI 讀不到園務 repo，這裡只比對快照；
快照與園務現行程式的漂移由 scripts/check_ivy_recruitment_contract.py 手動檢查
（解析與比對邏輯在這裡用假的園務原始碼測）。"""

from __future__ import annotations

import copy
import importlib.util
import json
import re
import stat
from datetime import date, datetime
from pathlib import Path

import pytest
from sqlalchemy import String, text
from sqlalchemy.exc import DBAPIError

from app.admissions import academic, constants, export
from app.admissions.models import GradeIntakeTarget, RecruitmentEventLog, RecruitmentVisit
from app.common.timezones import OPERATING_TZ
from tests.admissions_helpers import ADMISSIONS, create_record, record_at_stage
from tests.conftest import legacy_request

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / "contracts" / "ivy-recruitment" / "ivy-schema.json").read_text(encoding="utf-8"))
MODELS = {
    "recruitment_visits": RecruitmentVisit,
    "recruitment_event_log": RecruitmentEventLog,
    "grade_intake_targets": GradeIntakeTarget,
}
# 匯出時留 null、由匯入端依 mapping 填的欄位（園務 NOT NULL 的外鍵也在這裡）。
FILLED_BY_IMPORTER = {
    "recruitment_visits": {"provisional_grade_id", "tour_guide_employee_id"},
    "recruitment_event_log": {"recruitment_visit_id"},
    "grade_intake_targets": {"grade_id"},
}
ROC_DATE_RE = re.compile(r"^\d{3}\.(0[1-9]|1[0-2])\.(0[1-9]|[12]\d|3[01])$")


def _load_script(name: str):
    spec = importlib.util.spec_from_file_location(name, ROOT / "backend" / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _check_row(table: str, row: dict) -> None:
    """一列的欄位齊全、型別可轉換、長度、NOT NULL。"""
    columns = SCHEMA["tables"][table]["columns"]
    assert set(row) == {"website_id", "columns", "mapping"}, table
    assert set(row["columns"]) == set(columns) - {"id"}, table
    for name, value in row["columns"].items():
        spec = columns[name]
        if value is None:
            assert spec["nullable"] or name in FILLED_BY_IMPORTER[table], f"{table}.{name} 園務是 NOT NULL"
            continue
        kind = spec["type"]
        if kind == "String":
            assert isinstance(value, str) and len(value) <= spec["length"], f"{table}.{name} 超過 {spec['length']} 字"
        elif kind == "Text":
            assert isinstance(value, str), f"{table}.{name}"
        elif kind == "Integer":
            assert isinstance(value, int) and not isinstance(value, bool), f"{table}.{name}"
        elif kind == "Boolean":
            assert isinstance(value, bool), f"{table}.{name}"
        elif kind == "Date":
            date.fromisoformat(value)
        elif kind == "DateTime":
            assert datetime.fromisoformat(value).tzinfo is None, f"{table}.{name} 要是台北時間 naive"
        elif kind == "JSON":
            assert isinstance(value, dict), f"{table}.{name}"
        else:
            raise AssertionError(f"契約有沒處理的型別 {kind}（{table}.{name}）")


def test_snapshot_enums_match_website_constants():
    enums = SCHEMA["enums"]
    assert SCHEMA["ivy_backend_commit"] == "dfd230c3"
    assert enums["grades"] == list(constants.GRADES)
    assert enums["no_deposit_reasons"] == list(constants.NO_DEPOSIT_REASONS)
    assert enums["no_deposit_priority"] == {level: sorted(reasons) for level, reasons in constants.NO_DEPOSIT_PRIORITY.items()}
    assert enums["source_categories"] == constants.SOURCE_CATEGORIES
    assert list(enums["source_categories"]) == list(constants.SOURCE_CATEGORIES)
    assert enums["stages"] == list(constants.STAGES)
    assert enums["withdrawn_from"] == list(constants.WITHDRAWN_FROM)
    assert enums["event_types"] == sorted(set(constants.EVENT_TYPES) - set(constants.WEBSITE_ONLY_EVENT_TYPES))
    assert SCHEMA["website_only"]["event_types"] == list(constants.WEBSITE_ONLY_EVENT_TYPES)


def test_website_columns_fit_ivy_columns():
    """同名欄位：官網字串長度不超過園務；園務 NOT NULL 的官網也是 NOT NULL（匯出不會出現 null）。"""
    for table, model in MODELS.items():
        website = model.__table__.columns
        for name, spec in SCHEMA["tables"][table]["columns"].items():
            if name == "id" or name not in website:
                continue
            # visit_date 官網是 Date、匯出才轉成民國字串，長度由 _check_row 檢查。
            if spec["type"] == "String" and isinstance(website[name].type, String):
                assert website[name].type.length <= spec["length"], f"{table}.{name}"
            if not spec["nullable"]:
                assert not website[name].nullable, f"{table}.{name}"


@pytest.mark.asyncio
async def test_export_rows_match_ivy_snapshot(admin_client, db_session, tmp_path):
    """R13：合成資料涵蓋各階段、保留座位、計畫名額、每個字串欄位的最長值、由預約補建的訪視。"""
    longest = await create_record(
        admin_client,
        visit_date="2026-09-08", child_name="長" * constants.LEN_CHILD_NAME, grade="中班",
        phone="0" * constants.LEN_PHONE, contact_name="聯" * constants.LEN_CONTACT, address="址" * constants.LEN_ADDRESS,
        source="源" * constants.LEN_SOURCE, referrer="介" * constants.LEN_REFERRER,
        deposit_collector="收" * constants.LEN_COLLECTOR, tour_guide_name="師" * constants.LEN_TOUR_GUIDE,
        source_category="self_report", rides_bus=True, transfer_term=True, notes="備註", parent_response="再聯絡",
        no_deposit_reason="費用考量", no_deposit_reason_detail="比較學費",
    )
    deposited = await record_at_stage(admin_client, "deposited", child_name="已預繳")
    seat = await admin_client.post(
        f"{ADMISSIONS}/records/{deposited['id']}/seat",
        json={"grade": "小班", "target_school_year": 115, "target_semester": 1, "expected_version": deposited["version"]},
    )
    assert seat.status_code == 200, seat.text
    enrolled = await record_at_stage(admin_client, "enrolled", child_name="已註冊")
    withdrawn = await record_at_stage(admin_client, "withdrawn", withdrawn_from="enrolled", child_name="退註冊")
    request_id = await legacy_request(db_session, status="completed")
    from_booking = await admin_client.post(f"{ADMISSIONS}/from-visit-request/{request_id}")
    assert from_booking.status_code == 200, from_booking.text
    targets_saved = await admin_client.put(
        f"{ADMISSIONS}/intake-targets?campus_key=yihua",
        json={"school_year": 115, "semester": 1, "targets": {"小班": 10, "中班": 0}},
    )
    assert targets_saved.status_code == 200, targets_saved.text
    # 他校的訪視有 created 以外的歷程，才驗得出歷程依校區取（F9）。
    minghua = await record_at_stage(admin_client, "deposited", campus_key="minghua", child_name="明華的")

    result = await export.export_campus(db_session, "yihua", tenant_id=1)
    assert list(result) == list(export.FILES)
    visits, events, targets = result["recruitment_visits"], result["recruitment_event_log"], result["grade_intake_targets"]
    assert len(visits) == 5
    visit_ids = {row["website_id"] for row in visits}
    enums = SCHEMA["enums"]
    for row in visits:
        _check_row("recruitment_visits", row)
        columns = row["columns"]
        assert columns["tenant_id"] == 1
        assert academic.ROC_MONTH_RE.match(columns["month"]) and ROC_DATE_RE.match(columns["visit_date"])
        assert columns["grade"] is None or columns["grade"] in enums["grades"]
        assert columns["source_category"] is None or columns["source_category"] in enums["source_categories"]
        assert columns["no_deposit_reason"] is None or columns["no_deposit_reason"] in enums["no_deposit_reasons"]
        assert columns["withdrawn_from"] is None or columns["withdrawn_from"] in enums["withdrawn_from"]
        assert columns["target_semester"] in (1, 2)
        assert row["mapping"]["campus_key"] == "yihua"
        assert row["mapping"]["provisional_grade"] is None or row["mapping"]["provisional_grade"] in enums["grades"]
    assert events, "合成資料應該有歷程"
    for row in events:
        _check_row("recruitment_event_log", row)
        columns = row["columns"]
        assert columns["event_type"] in enums["event_types"]
        assert columns["from_stage"] is None or columns["from_stage"] in enums["stages"]
        assert columns["to_stage"] in enums["stages"]
        assert row["mapping"]["recruitment_visit_website_id"] in visit_ids  # 歷程都接得回訪視
        actor = columns["metadata_json"].get("website_actor")
        if actor is not None:
            assert set(actor) == {"user_id", "name"} and actor["name"] is None  # admin 沒設顯示名稱：不退而求其次放 Email
    assert "created" not in {row["columns"]["event_type"] for row in events}
    # F9：歷程依校區 join 取，只屬於該校區。
    assert minghua["id"] not in {row["mapping"]["recruitment_visit_website_id"] for row in events}
    other = await export.export_campus(db_session, "minghua", tenant_id=2)
    assert [
        (row["mapping"]["recruitment_visit_website_id"], row["columns"]["event_type"]) for row in other["recruitment_event_log"]
    ] == [(minghua["id"], "deposit_added")]
    assert any("website_actor" in row["columns"]["metadata_json"] for row in events if row["columns"]["metadata_json"])
    assert "@" not in json.dumps(result, ensure_ascii=False), "匯出檔不能帶 Email"
    await db_session.execute(text("UPDATE users SET display_name = '王園長' WHERE email = 'admin@ivy.example'"))
    named = await export.export_campus(db_session, "yihua", tenant_id=1)
    names = {
        row["columns"]["metadata_json"]["website_actor"]["name"]
        for row in named["recruitment_event_log"]
        if row["columns"]["metadata_json"] and "website_actor" in row["columns"]["metadata_json"]
    }
    assert names == {"王園長"}
    for row in targets:
        _check_row("grade_intake_targets", row)
        assert row["columns"]["semester"] in (1, 2) and row["mapping"]["grade"] in enums["grades"]
    assert {(row["mapping"]["grade"], row["columns"]["target_seats"]) for row in targets} == {("小班", 10), ("中班", 0)}

    by_id = {row["website_id"]: row for row in visits}
    first = by_id[longest["id"]]["columns"]
    assert (first["visit_date"], first["month"], first["child_name"]) == ("115.09.08", "115.09", "長" * 50)
    assert (first["rides_bus"], first["transfer_term"], first["expected_start_label"]) == (True, True, None)
    utc_created = datetime.fromisoformat(longest["created_at"])
    assert datetime.fromisoformat(first["created_at"]) == utc_created.astimezone(OPERATING_TZ).replace(tzinfo=None)
    assert by_id[deposited["id"]]["mapping"]["provisional_grade"] == "小班"
    assert by_id[deposited["id"]]["columns"]["provisional_grade_id"] is None
    assert by_id[withdrawn["id"]]["columns"]["withdrawn_from"] == "enrolled"
    extensions = {row["website_id"]: row for row in result["extensions"]}
    assert set(extensions) == visit_ids
    assert extensions[from_booking.json()["id"]]["visit_request_id"] == request_id
    assert extensions[enrolled["id"]]["enrolled_on"] == "2026-09-30"

    paths = export.write_jsonl(result, tmp_path / "yihua")
    assert [path.name for path in paths] == [f"{name}.jsonl" for name in export.FILES]
    assert stat.S_IMODE((tmp_path / "yihua").stat().st_mode) == 0o700
    for path, name in zip(paths, export.FILES):
        assert stat.S_IMODE(path.stat().st_mode) == 0o600
        rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
        assert rows == json.loads(json.dumps(result[name], ensure_ascii=False))
    with pytest.raises(FileExistsError):
        export.write_jsonl(result, tmp_path / "yihua")


@pytest.mark.asyncio
async def test_export_script_is_read_only(app, admin_client, tmp_path, monkeypatch):
    """匯出程式只讀（規格 12.2）：連線預設唯讀交易，寫入會被資料庫擋下。"""
    await create_record(admin_client)
    script = _load_script("export_ivy_recruitment")
    monkeypatch.setattr(script, "get_settings", lambda: app.state.settings)
    assert await script.run([("yihua", 1)], tmp_path) == 0
    [line] = (tmp_path / "yihua" / "recruitment_visits.jsonl").read_text(encoding="utf-8").splitlines()
    assert json.loads(line)["columns"]["tenant_id"] == 1
    engine = script.readonly_engine(app.state.settings)
    try:
        # F9：所有校區在同一個 REPEATABLE READ 交易內查，每份資料是同一個快照。
        async with engine.connect() as conn:
            assert await conn.scalar(text("SHOW transaction_isolation")) == "repeatable read"
        async with engine.connect() as conn:
            with pytest.raises(DBAPIError):
                await conn.execute(text("UPDATE recruitment_visits SET notes = '不該寫入'"))
    finally:
        await engine.dispose()
    with pytest.raises(SystemExit):
        script.parse_args(["--campus", "taipei=1", "--out", str(tmp_path)])
    assert script.parse_args(["--campus", "renwu=3", "--out", str(tmp_path)]).campus == [("renwu", 3)]


FAKE_IVY = {
    "models/recruitment.py": '''
class RecruitmentVisit(TenantMixin, Base):
    __tablename__ = "recruitment_visits"
    id = Column(Integer, primary_key=True, index=True)
    month = Column(String(10), nullable=False, index=True)
    withdrawn_from = Column(String(20), nullable=True)
    __table_args__ = (CheckConstraint("withdrawn_from IN ('deposited', 'enrolled')", name="ck_rv_withdrawn_from"),)


class RecruitmentEventLog(Base):
    __tablename__ = "recruitment_event_log"
    id = Column(Integer, primary_key=True, index=True)
    metadata_json = Column(JSON().with_variant(JSONB(), "postgresql"), nullable=True)


class GradeIntakeTarget(Base):
    __tablename__ = "grade_intake_targets"
    grade_id = Column(Integer, ForeignKey("class_grades.id", ondelete="CASCADE"), nullable=False)
''',
    "api/recruitment/shared.py": '''
NO_DEPOSIT_REASONS = ["甲", "乙"]
HIGH_PRIORITY_NO_DEPOSIT_REASONS = {"甲"}
MEDIUM_PRIORITY_NO_DEPOSIT_REASONS = {"丙"}
LOW_PRIORITY_NO_DEPOSIT_REASONS = {"乙"}
''',
    "models/recruitment_bonus.py": '''
DEFAULT_POINT_CATALOG: dict[str, dict] = {"self_report": {"label": "自報生", "points": 0.3}}
''',
    "services/recruitment_funnel.py": '''
STAGES: tuple[Stage, ...] = ("visited", "deposited")


def toggle(to_stage):
    event_type = "deposit_added" if to_stage == "deposited" else "deposit_removed"
    write(event_type=event_type)
    write(event_type="withdrawn")
''',
    "services/recruitment_intake_plan.py": '''
def seat(is_set):
    return Log(event_type="seat_reserved" if is_set else "seat_released")
''',
    "services/recruitment_conversion.py": '''
def convert(session):
    session.add(StudentChangeLog(event_type="入學"))
    session.query(Log).filter_by(event_type="converted")
''',
}


def test_drift_check_reads_ivy_source_with_ast(tmp_path):
    for relative, source in FAKE_IVY.items():
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source, encoding="utf-8")
    live = _load_script("check_ivy_recruitment_contract").read_ivy(tmp_path)
    assert live["tables"] == {
        "recruitment_visits": {"columns": {
            "tenant_id": {"type": "Integer", "nullable": False, "foreign_key": "tenants.id"},
            "id": {"type": "Integer", "nullable": False, "primary_key": True},
            "month": {"type": "String", "nullable": False, "length": 10},
            "withdrawn_from": {"type": "String", "nullable": True, "length": 20},
        }},
        "recruitment_event_log": {"columns": {
            "id": {"type": "Integer", "nullable": False, "primary_key": True},
            "metadata_json": {"type": "JSON", "nullable": True},
        }},
        "grade_intake_targets": {"columns": {
            "grade_id": {"type": "Integer", "nullable": False, "foreign_key": "class_grades.id"},
        }},
    }
    assert live["enums"] == {
        "no_deposit_reasons": ["甲", "乙"],
        "no_deposit_priority": {"high": ["甲"], "medium": ["丙"], "low": ["乙"]},
        "source_categories": {"self_report": "自報生"},
        "stages": ["visited", "deposited"],
        "event_types": ["converted", "deposit_added", "deposit_removed", "seat_released", "seat_reserved", "withdrawn"],
        "withdrawn_from": ["deposited", "enrolled"],
    }


def test_drift_check_reports_each_difference():
    check = _load_script("check_ivy_recruitment_contract")
    same = {"tables": copy.deepcopy(SCHEMA["tables"]), "enums": {k: v for k, v in SCHEMA["enums"].items() if k != "grades"}}
    assert check.diff(SCHEMA, same) == []
    changed = copy.deepcopy(same)
    del changed["tables"]["recruitment_visits"]["columns"]["district"]
    changed["tables"]["recruitment_visits"]["columns"]["phone"]["length"] = 30
    changed["tables"]["recruitment_event_log"]["columns"]["student_note"] = {"type": "Text", "nullable": True}
    changed["enums"]["event_types"] = [*changed["enums"]["event_types"], "reopened"]
    problems = check.diff(SCHEMA, changed)
    assert len(problems) == 4, problems
    assert any("recruitment_visits.district" in p and "已沒有" in p for p in problems)
    assert any("recruitment_visits.phone" in p for p in problems)
    assert any("recruitment_event_log.student_note" in p and "新增" in p for p in problems)
    assert any("event_types" in p for p in problems)


def test_drift_check_fails_loudly_when_a_table_disappears(tmp_path, capsys):
    """園務把 class 改名或搬檔：快照有、現行沒有的整張表要報，不能靜默通過。"""
    check = _load_script("check_ivy_recruitment_contract")
    for relative, source in FAKE_IVY.items():
        path = tmp_path / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(source.replace("class GradeIntakeTarget", "class GradeIntakeTargetV2"), encoding="utf-8")
    live = check.read_ivy(tmp_path)
    assert "grade_intake_targets" not in live["tables"]
    same = {"tables": copy.deepcopy(SCHEMA["tables"]), "enums": {k: v for k, v in SCHEMA["enums"].items() if k != "grades"}}
    problems = check.diff(SCHEMA, {"tables": {k: v for k, v in same["tables"].items() if k != "grade_intake_targets"}, "enums": same["enums"]})
    assert problems == ["表 grade_intake_targets：契約有，園務原始碼已找不到對應的 class（改名或搬檔？）"]
    extra = copy.deepcopy(same)
    extra["tables"]["new_table"] = {"columns": {}}
    assert any("new_table" in p and "新增" in p for p in check.diff(SCHEMA, extra))
    assert check.main(["--ivy-backend", str(tmp_path)]) == 1
    assert "grade_intake_targets" in capsys.readouterr().out
