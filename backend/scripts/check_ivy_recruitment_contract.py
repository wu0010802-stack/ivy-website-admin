#!/usr/bin/env python3
"""招生轉移契約的漂移檢查（規格 12.2；手動執行，不進 CI：CI 讀不到園務 repo）。

比對 contracts/ivy-recruitment/ivy-schema.json 與園務後端現行原始碼：三張表的欄位
（名稱、型別、長度、可否為空、外鍵）、未預繳原因與優先度、來源分類、漏斗階段、
事件類型、退出來源。只用 ast 讀原始碼，不 import 園務程式、不連任何資料庫。年級
（園務前端 GRADES_ORDER）不在園務後端，這支不檢查。

用法（在 backend/ 下）：
  uv run python scripts/check_ivy_recruitment_contract.py --ivy-backend ../../ivy-backend
一致回 0；不一致列出每一項差異並回 1。"""
from __future__ import annotations

import argparse
import ast
import json
import re
import subprocess
import sys
from pathlib import Path

SNAPSHOT = Path(__file__).resolve().parents[2] / "contracts" / "ivy-recruitment" / "ivy-schema.json"
MODEL_FILE = "models/recruitment.py"
SHARED_FILE = "api/recruitment/shared.py"
BONUS_FILE = "models/recruitment_bonus.py"
FUNNEL_FILE = "services/recruitment_funnel.py"
EVENT_FILES = ("services/recruitment_funnel.py", "services/recruitment_intake_plan.py", "services/recruitment_conversion.py")
CLASSES = {
    "RecruitmentVisit": "recruitment_visits",
    "RecruitmentEventLog": "recruitment_event_log",
    "GradeIntakeTarget": "grade_intake_targets",
}
# 招生事件類型是小寫英文；學生異動紀錄（例如「入學」）不算。
_EVENT_TYPE_RE = re.compile(r"^[a-z_]+$")
# TenantMixin 宣告的 tenant_id（models/tenant_mixin.py _tenant_id_column）。
_TENANT_ID = {"type": "Integer", "nullable": False, "foreign_key": "tenants.id"}


def _parse(path: Path) -> ast.Module:
    return ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def _type_of(node: ast.expr) -> tuple[str, int | None]:
    """Column 的第一個參數：Integer、String(10)、JSON().with_variant(JSONB(), …)。"""
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "with_variant":
        return _type_of(node.func.value)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
        length = node.args[0].value if node.args and isinstance(node.args[0], ast.Constant) else None
        return node.func.id, length
    if isinstance(node, ast.Name):
        return node.id, None
    raise ValueError(f"看不懂的欄位型別：{ast.dump(node)}")


def _column(call: ast.Call) -> dict:
    kind, length = _type_of(call.args[0])
    keywords = {keyword.arg: keyword.value for keyword in call.keywords}
    primary_key = isinstance(keywords.get("primary_key"), ast.Constant) and keywords["primary_key"].value is True
    nullable = keywords.get("nullable")
    column: dict = {"type": kind, "nullable": bool(nullable.value) if isinstance(nullable, ast.Constant) else not primary_key}
    if length is not None:
        column["length"] = length
    if primary_key:
        column["primary_key"] = True
    for argument in call.args[1:]:
        if isinstance(argument, ast.Call) and isinstance(argument.func, ast.Name) and argument.func.id == "ForeignKey":
            column["foreign_key"] = argument.args[0].value
    return column


def _constant(tree: ast.Module, name: str):
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
            return ast.literal_eval(node.value)
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.target.id == name:
            return ast.literal_eval(node.value)
    raise KeyError(f"園務原始碼找不到 {name}")


def _strings(node: ast.expr) -> set[str]:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return {node.value}
    if isinstance(node, ast.IfExp):
        return _strings(node.body) | _strings(node.orelse)
    return set()


def read_tables(ivy_root: Path) -> dict:
    tables = {}
    for node in _parse(ivy_root / MODEL_FILE).body:
        if not isinstance(node, ast.ClassDef) or node.name not in CLASSES:
            continue
        columns: dict[str, dict] = {}
        if any(isinstance(base, ast.Name) and base.id == "TenantMixin" for base in node.bases):
            columns["tenant_id"] = dict(_TENANT_ID)
        for statement in node.body:
            if (
                isinstance(statement, ast.Assign)
                and len(statement.targets) == 1
                and isinstance(statement.targets[0], ast.Name)
                and isinstance(statement.value, ast.Call)
                and isinstance(statement.value.func, ast.Name)
                and statement.value.func.id == "Column"
            ):
                columns[statement.targets[0].id] = _column(statement.value)
        tables[CLASSES[node.name]] = {"columns": columns}
    return tables


def read_enums(ivy_root: Path) -> dict:
    shared = _parse(ivy_root / SHARED_FILE)
    event_types: set[str] = set()
    for relative in EVENT_FILES:
        for node in ast.walk(_parse(ivy_root / relative)):
            if isinstance(node, ast.keyword) and node.arg == "event_type":
                event_types |= _strings(node.value)
            elif isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "event_type" for t in node.targets):
                event_types |= _strings(node.value)
    withdrawn_from: list[str] = []
    for node in ast.walk(_parse(ivy_root / MODEL_FILE)):
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and "withdrawn_from IN" in node.value:
            withdrawn_from = re.findall(r"'([a-z_]+)'", node.value)
    return {
        "no_deposit_reasons": list(_constant(shared, "NO_DEPOSIT_REASONS")),
        "no_deposit_priority": {
            level: sorted(_constant(shared, f"{level.upper()}_PRIORITY_NO_DEPOSIT_REASONS"))
            for level in ("high", "medium", "low")
        },
        "source_categories": {
            code: entry["label"] for code, entry in _constant(_parse(ivy_root / BONUS_FILE), "DEFAULT_POINT_CATALOG").items()
        },
        "stages": list(_constant(_parse(ivy_root / FUNNEL_FILE), "STAGES")),
        "event_types": sorted(value for value in event_types if _EVENT_TYPE_RE.match(value)),
        "withdrawn_from": withdrawn_from,
    }


def read_ivy(ivy_root: Path) -> dict:
    """園務現行原始碼的欄位與列舉，形狀同 ivy-schema.json 的 tables 與 enums（沒有 grades）。"""
    return {"tables": read_tables(ivy_root), "enums": read_enums(ivy_root)}


def diff(snapshot: dict, live: dict) -> list[str]:
    """逐項列出快照與園務現行程式的差異；一致回空 list。"""
    problems: list[str] = []
    for table in sorted(snapshot["tables"].keys() - live["tables"].keys()):
        problems.append(f"表 {table}：契約有，園務原始碼已找不到對應的 class（改名或搬檔？）")
    for table in sorted(live["tables"].keys() - snapshot["tables"].keys()):
        problems.append(f"表 {table}：園務新增的表，契約沒有")
    for table, spec in live["tables"].items():
        expected = snapshot["tables"].get(table, {}).get("columns", {})
        actual = spec["columns"]
        for name in sorted(expected.keys() - actual.keys()):
            problems.append(f"{table}.{name}：契約有，園務已沒有這個欄位")
        for name in sorted(actual.keys() - expected.keys()):
            problems.append(f"{table}.{name}：園務新增的欄位，契約沒有：{actual[name]}")
        for name in sorted(expected.keys() & actual.keys()):
            if expected[name] != actual[name]:
                problems.append(f"{table}.{name}：契約 {expected[name]}，園務 {actual[name]}")
    for key, value in live["enums"].items():
        if snapshot["enums"].get(key) != value:
            problems.append(f"列舉 {key}：契約 {snapshot['enums'].get(key)}，園務 {value}")
    return problems


def _head(ivy_root: Path) -> str:
    result = subprocess.run(
        ["git", "-C", str(ivy_root), "rev-parse", "--short=8", "HEAD"], capture_output=True, text=True, check=False
    )
    return result.stdout.strip() or "（不是 git 目錄）"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="比對招生轉移契約與園務現行程式（只讀）")
    parser.add_argument("--ivy-backend", required=True, type=Path, help="園務後端 repo 的路徑")
    args = parser.parse_args(sys.argv[1:] if argv is None else argv)
    snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    problems = diff(snapshot, read_ivy(args.ivy_backend))
    aligned = f"契約對齊 {snapshot['ivy_backend_commit']}，園務目前 {_head(args.ivy_backend)}"
    if problems:
        for problem in problems:
            print(f"- {problem}")
        print(f"{aligned}。請更新 contracts/ivy-recruitment/ 並評估官網要不要跟進。")
        return 1
    print(f"契約與園務一致（{aligned}）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
