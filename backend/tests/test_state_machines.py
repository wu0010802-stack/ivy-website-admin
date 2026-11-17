"""狀態機登記表（app/state_machines.py）與實際程式不能分歧。

登記表不參與執行期判斷，所以靠這裡守門：
- 狀態值和 model 的 Enum／CHECK 相同；
- 每條轉移寫的函式真的存在、而且真的寫了那個狀態；
- 登記以外的檔案不准寫狀態欄位（新的寫入點要先登記，才不會又散回各個路由）；
- 預約案件另外對端點做全組合比對：表上沒有的轉移一律 409、狀態不動；
- 匯出的 JSON、TypeScript 型別與文件是最新的。

失敗時多半是改了狀態或轉移卻沒更新登記表：改 app/state_machines.py，再跑
`npm run contract:generate`。說明見 docs/state-machines/README.md。"""

from __future__ import annotations

import ast
import importlib
import importlib.util
import inspect
import re
from pathlib import Path

import pytest
from sqlalchemy import CheckConstraint, Enum as SAEnum

from app import state_machines
from app.common.state_machine import StateMachine, Transition
from tests.conftest import book_slot, start_visit_slot

BACKEND = Path(__file__).resolve().parents[1]
APP_DIR = BACKEND / "app"
BASE = "/api/website/v1/admin/visit-requests"

MACHINES = state_machines.MACHINES
STORED = [machine for machine in MACHINES if machine.field]
_ids = lambda machine: machine.key  # noqa: E731


def _resolve(ref: str):
    module, name = ref.split(":")
    return getattr(importlib.import_module(module), name)


def _module_file(ref: str) -> str:
    return ref.split(":")[0].replace(".", "/") + ".py"


# ── 登記表本身 ─────────────────────────────────────────────


def test_keys_are_unique():
    keys = [machine.key for machine in (*MACHINES, *state_machines.DERIVED)]
    assert len(keys) == len(set(keys))


@pytest.mark.parametrize("machine", MACHINES, ids=_ids)
def test_every_state_is_reachable(machine: StateMachine):
    reached = {transition.target for transition in machine.transitions}
    assert reached == set(machine.states), f"沒有任何轉移會到的狀態：{set(machine.states) - reached}"


def test_declaration_rejects_unknown_states():
    with pytest.raises(ValueError):
        StateMachine(
            key="x", title="x", model="m:M", field="status", states={"a": "甲"}, writers=(),
            transitions=(Transition(None, "a", "m:f"), Transition("a", "typo", "m:f")),
        )


def test_allows_follows_the_table():
    visit = state_machines.VISIT_REQUEST
    assert visit.targets("confirmed") == ("cancelled", "no_show", "completed")
    assert visit.terminal_states == ("cancelled", "no_show", "completed")
    assert not visit.allows("cancelled", "confirmed")
    with pytest.raises(ValueError):
        visit.targets("typo")


# ── 狀態值對照資料庫 ───────────────────────────────────────

# 這兩個欄位目前沒有資料庫 CHECK，值域只靠 Python。加了 CHECK 之後把它從這裡拿掉，
# 下面的測試就會開始比對。
_NO_DB_CONSTRAINT = {"outbox_message", "publish_job"}


def _db_values(machine: StateMachine) -> set[str] | None:
    table = _resolve(machine.model).__table__
    column_type = table.c[machine.field].type
    if isinstance(column_type, SAEnum):
        # 原生 enum 在資料庫存的是成員名（大寫）；API 與程式比的是 .value。
        return {member.value for member in column_type.enum_class}
    pattern = re.compile(rf"\b{machine.field}\s+IN\s*\(([^)]*)\)")
    for constraint in table.constraints:
        if isinstance(constraint, CheckConstraint):
            match = pattern.match(str(constraint.sqltext).strip())
            if match:
                return set(re.findall(r"'([^']*)'", match.group(1)))
    return None


@pytest.mark.parametrize("machine", STORED, ids=_ids)
def test_states_match_the_database_constraint(machine: StateMachine):
    values = _db_values(machine)
    if machine.key in _NO_DB_CONSTRAINT:
        assert values is None, f"{machine.key} 已經有資料庫約束，請從 _NO_DB_CONSTRAINT 拿掉"
        return
    assert values == set(machine.states)


# ── 轉移對照程式碼 ─────────────────────────────────────────


def _writes(function, state: str) -> bool:
    """函式原始碼裡有沒有這個狀態的字面值（"cancelled"）或列舉成員（.CANCELLED）。"""
    source = inspect.getsource(function)
    return bool(re.search(rf"""["']{state}["']|\.{state.upper()}\b""", source))


@pytest.mark.parametrize("machine", MACHINES, ids=_ids)
def test_transitions_point_at_real_writers(machine: StateMachine):
    problems = []
    for transition in machine.transitions:
        try:
            function = _resolve(transition.via)
        except (ImportError, AttributeError):
            problems.append(f"{transition.via} 不存在")
            continue
        # 建立時多半靠欄位預設值，函式裡不一定看得到字面值；招生階段不存欄位。
        if transition.source is None or not machine.field:
            continue
        if _module_file(transition.via) not in machine.writers:
            problems.append(f"{transition.via} 不在 writers 裡")
        if not _writes(function, transition.target):
            problems.append(f"{transition.via} 裡找不到寫入 {transition.target!r}")
    assert not problems, f"{machine.key}：\n" + "\n".join(problems)


@pytest.mark.parametrize("machine", state_machines.DERIVED, ids=_ids)
def test_derived_machines_point_at_real_code(machine):
    columns = _resolve(machine.model).__table__.c
    assert all(field in columns for field in machine.fields)
    for ref in (*machine.decided_by, *machine.changed_by):
        assert callable(_resolve(ref)), ref


def test_recruitment_stage_reads_the_funnel_table():
    """招生階段的轉移表只有一份（funnel._CAPABILITY，執行期就讀它），登記表不另抄。"""
    from app.admissions import funnel

    declared = {(t.source, t.target) for t in state_machines.RECRUITMENT_STAGE.transitions if t.source is not None}
    assert declared == set(funnel._CAPABILITY)


# ── 登記以外的檔案不准寫狀態欄位 ───────────────────────────

_STATE_FIELDS = {machine.field for machine in STORED}
_MODEL_NAMES = {machine.model.split(":")[1] for machine in STORED}
_WRITER_FILES = {path for machine in STORED for path in machine.writers}
# 同名但不是狀態機欄位的屬性（查詢條件、匯入結果的 dataclass）。
_NOT_A_STATE_FIELD = {
    ("app/booking/admin_visit_routes.py", "filters.status"),
    ("app/media/site_import.py", "result.status"),
}


def _status_writes(path: Path) -> list[tuple[int, str]]:
    """這個檔裡寫狀態欄位的地方：屬性指派、UPDATE/INSERT 的 values(...)、model 建構子。"""
    hits: list[tuple[int, str]] = []
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Attribute) and target.attr in _STATE_FIELDS:
                    if not (isinstance(target.value, ast.Name) and target.value.id == "self"):
                        hits.append((node.lineno, ast.unparse(target)))
        elif isinstance(node, ast.Call):
            name = node.func.attr if isinstance(node.func, ast.Attribute) else getattr(node.func, "id", "")
            if name == "values" or name in _MODEL_NAMES:
                hits += [(node.lineno, f"{name}({kw.arg}=…)") for kw in node.keywords if kw.arg in _STATE_FIELDS]
    return hits


def test_status_is_only_written_by_registered_files():
    offenders = []
    for path in sorted(APP_DIR.rglob("*.py")):
        relative = path.relative_to(BACKEND).as_posix()
        if relative in _WRITER_FILES:
            continue
        for lineno, expression in _status_writes(path):
            if (relative, expression) not in _NOT_A_STATE_FIELD:
                offenders.append(f"{relative}:{lineno}: {expression}")
    assert not offenders, (
        "狀態欄位只能在 app/state_machines.py 登記的檔案裡寫。把轉移寫進該狀態機的 service，"
        "或先在登記表加上這條轉移與 writers：\n" + "\n".join(offenders)
    )


def test_writer_files_exist_and_do_write():
    for machine in STORED:
        for relative in machine.writers:
            assert _status_writes(BACKEND / relative), f"{machine.key}：{relative} 已經不寫狀態欄位，請從 writers 拿掉"


# ── 預約案件：端點對照轉移表 ───────────────────────────────

_ENDPOINT = {"cancelled": "cancel", "no_show": "no-show", "completed": "complete"}
_VISIT = state_machines.VISIT_REQUEST


async def _case_in(admin_client, public_client, db_session, state: str) -> str:
    """建一筆場次已開始的預約，並推到指定狀態。"""
    booked = await book_slot(admin_client, public_client)
    case_id = booked["receipt_id"]
    await start_visit_slot(db_session, case_id)
    if state != "confirmed":
        response = await admin_client.post(f"{BASE}/{case_id}/{_ENDPOINT[state]}")
        assert response.status_code == 200, response.text
    return case_id


def test_every_visit_transition_has_an_endpoint():
    assert set(_ENDPOINT) == {target for state in _VISIT.states for target in _VISIT.targets(state)}


@pytest.mark.asyncio
@pytest.mark.usefixtures("booking_consent")
@pytest.mark.parametrize("target", list(_ENDPOINT))
@pytest.mark.parametrize("source", list(_VISIT.states))
async def test_visit_request_endpoints_follow_the_table(admin_client, public_client, db_session, source, target):
    """四個狀態 × 三個動作全試：表上有的轉移成功，沒有的回 409 INVALID_TRANSITION、狀態不動。
    唯一的例外寫在登記表的條件裡：已取消再取消是冪等的。"""
    case_id = await _case_in(admin_client, public_client, db_session, source)
    response = await admin_client.post(f"{BASE}/{case_id}/{_ENDPOINT[target]}")
    detail = await admin_client.get(f"{BASE}/{case_id}")
    if _VISIT.allows(source, target):
        assert response.status_code == 200, response.text
        assert detail.json()["status"] == target
    elif source == target == "cancelled":
        assert response.status_code == 200, response.text
        assert detail.json()["status"] == "cancelled"
    else:
        assert response.status_code == 409, response.text
        assert response.json()["detail"]["code"] == "INVALID_TRANSITION"
        assert detail.json()["status"] == source


# ── 匯出檔 ─────────────────────────────────────────────────


def test_generated_files_are_current():
    spec = importlib.util.spec_from_file_location(
        "export_state_machines", BACKEND / "scripts" / "export_state_machines.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    outdated = [path.relative_to(module.ROOT).as_posix() for path in module.stale()]
    assert not outdated, f"請執行 npm run contract:generate 重新產生：{outdated}"
