#!/usr/bin/env python3
"""把 app/state_machines.py 的登記表匯出成三個檔：

- contracts/state-machines.json：給前端測試比對標籤表用。
- contracts/generated/state-machines.d.ts：各狀態的 TypeScript union。
- docs/state-machines/domain.md：給人與 agent 讀的狀態圖與轉移表。

用法：uv run python scripts/export_state_machines.py [--check]
（`npm run contract:generate`／`contract:check` 會一起跑。）"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
ROOT = BACKEND.parent
sys.path.insert(0, str(BACKEND))

os.environ.setdefault("WEBSITE_SKIP_DEFAULT_APP", "1")

from app import state_machines  # noqa: E402
from app.common.state_machine import DerivedMachine, StateMachine  # noqa: E402

JSON_PATH = ROOT / "contracts" / "state-machines.json"
TYPES_PATH = ROOT / "contracts" / "generated" / "state-machines.d.ts"
DOC_PATH = ROOT / "docs" / "state-machines" / "domain.md"

_GENERATED = "由 backend/scripts/export_state_machines.py 產生，來源是 backend/app/state_machines.py。不要手改；改登記表後跑 npm run contract:generate。"


def _file_of(ref: str) -> str:
    """"app.booking.service:cancel" → "backend/app/booking/service.py"。"""
    return "backend/" + ref.split(":")[0].replace(".", "/") + ".py"


def _code(ref: str) -> str:
    return f"`{_file_of(ref)}` 的 `{ref.split(':')[1]}`"


def render_json() -> str:
    data = {
        "_generated": _GENERATED,
        "machines": {
            machine.key: {
                "title": machine.title,
                "field": machine.field or None,
                "states": machine.states,
                "initial": list(machine.initial_states),
                "terminal": list(machine.terminal_states),
                "transitions": sorted(
                    {(t.source, t.target) for t in machine.transitions if t.source is not None}
                ),
            }
            for machine in state_machines.MACHINES
        },
        "derived": {
            machine.key: {"title": machine.title, "states": {s.name: s.label for s in machine.states}}
            for machine in state_machines.DERIVED
        },
    }
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def _pascal(key: str) -> str:
    return "".join(part.capitalize() for part in key.split("_"))


def render_types() -> str:
    lines = [f"// {_GENERATED}", ""]
    for machine in state_machines.MACHINES:
        union = " | ".join(f"'{state}'" for state in machine.states)
        lines += [f"/** {machine.title} */", f"export type {_pascal(machine.key)}State = {union}", ""]
    for machine in state_machines.DERIVED:
        union = " | ".join(f"'{state.name}'" for state in machine.states)
        lines += [f"/** {machine.title}（由欄位推導，不是存的值） */", f"export type {_pascal(machine.key)}State = {union}", ""]
    return "\n".join(lines)


def _diagram(machine: StateMachine) -> list[str]:
    lines = ["```mermaid", "stateDiagram-v2"]
    for state in machine.initial_states:
        lines.append(f"    [*] --> {state}")
    seen: set[tuple[str, str]] = set()
    for t in machine.transitions:
        if t.source is None or (t.source, t.target) in seen:
            continue
        seen.add((t.source, t.target))
        lines.append(f"    {t.source} --> {t.target}")
    for state in machine.terminal_states:
        lines.append(f"    {state} --> [*]")
    lines.append("```")
    return lines


def _cell(text: str) -> str:
    return text.replace("|", "／").replace("\n", " ") or "—"


def _machine_section(machine: StateMachine) -> list[str]:
    where = f"`{machine.field}`" if machine.field else "不存欄位，由 " + "、".join(f"`{f}`" for f in machine.derived_from) + " 推導"
    lines = [
        f"## {machine.title}（`{machine.key}`）",
        "",
        f"- 實體：{_code(machine.model)}，狀態欄位：{where}",
        "- 狀態：" + "、".join(f"`{value}` {label}" for value, label in machine.states.items()),
        "- 可以寫這個狀態的檔案：" + "、".join(f"`backend/{path}`" for path in machine.writers),
    ]
    if machine.terminal_states:
        lines.append("- 終態（進去就不再變）：" + "、".join(f"`{state}`" for state in machine.terminal_states))
    lines += ["", *_diagram(machine), "", "| 從 | 到 | 寫入的函式 | 條件 | 連帶做的事 |", "|---|---|---|---|---|"]
    for t in machine.transitions:
        source = f"`{t.source}`" if t.source is not None else "（建立）"
        lines.append(f"| {source} | `{t.target}` | {_code(t.via)} | {_cell(t.guard)} | {_cell(t.effects)} |")
    if machine.notes:
        lines += ["", machine.notes]
    return lines + [""]


def _derived_section(machine: DerivedMachine) -> list[str]:
    lines = [
        f"## {machine.title}（`{machine.key}`）",
        "",
        f"- 實體：{_code(machine.model)}，由 " + "、".join(f"`{f}`" for f in machine.fields) + " 推導，沒有狀態欄位",
        "",
        "| 狀態 | 名稱 | 成立條件 |",
        "|---|---|---|",
    ]
    lines += [f"| `{s.name}` | {s.label} | {_cell(s.rule)} |" for s in machine.states]
    lines += [
        "",
        "- 判斷的地方：" + "、".join(_code(ref) for ref in machine.decided_by),
        "- 改動這些欄位的地方：" + "、".join(_code(ref) for ref in machine.changed_by),
    ]
    if machine.notes:
        lines += ["", machine.notes]
    return lines + [""]


def render_doc() -> str:
    lines = [
        "# 領域狀態機",
        "",
        f"> {_GENERATED}",
        "",
        "怎麼用這份文件、前端流程的狀態、以及新增狀態時的規矩，見同目錄的 [README.md](README.md)。",
        "",
        "## 目錄",
        "",
        "有狀態欄位的：",
        "",
    ]
    lines += [f"- [{m.title}](#{m.key})：{len(m.states)} 個狀態" for m in state_machines.MACHINES]
    lines += ["", "由欄位推導的：", ""]
    lines += [f"- [{m.title}](#{m.key})：{len(m.states)} 個狀態" for m in state_machines.DERIVED]
    lines += [""]
    for machine in state_machines.MACHINES:
        lines += [f'<a id="{machine.key}"></a>', "", *_machine_section(machine)]
    for derived in state_machines.DERIVED:
        lines += [f'<a id="{derived.key}"></a>', "", *_derived_section(derived)]
    return "\n".join(lines).rstrip() + "\n"


def outputs() -> dict[Path, str]:
    return {JSON_PATH: render_json(), TYPES_PATH: render_types(), DOC_PATH: render_doc()}


def stale() -> list[Path]:
    return [
        path for path, content in outputs().items()
        if not path.exists() or path.read_text(encoding="utf-8") != content
    ]


def main() -> int:
    if "--check" in sys.argv:
        outdated = stale()
        if outdated:
            names = "、".join(str(path.relative_to(ROOT)) for path in outdated)
            print(f"狀態機匯出檔已過期：{names} 與 backend/app/state_machines.py 不一致，請執行 npm run contract:generate")
            return 1
        print("狀態機匯出檔與登記表一致")
        return 0
    for path, content in outputs().items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        print(f"已寫入 {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
