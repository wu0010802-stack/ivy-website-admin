#!/usr/bin/env python3
"""CI 的 npm audit 閘門：正式依賴有 moderate 以上的公告就擋下部署，除非列在放行清單裡。

為什麼不直接 `npm audit --omit=dev --audit-level=moderate`：npm 沒有「放行某一則公告」的選項，
遇到「還沒有修正版、確定不影響」的公告只能整個閘門關掉。這裡逐則比對 `npm-audit-allowlist.json`：
  - 清單裡的公告要寫原因、適用的專案（web／admin）與到期日；
  - 到期就失敗，逼人重新評估或升級；
  - 清單以外的公告照舊擋下。
npm 本身跑不起來、或輸出不是 JSON 時一律失敗（不能因為稽核壞掉就當作沒有公告）。

用法（在要稽核的專案目錄裡執行）：python3 ../deploy/npm_audit_gate.py --project web
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import date
from pathlib import Path

ALLOWLIST_PATH = Path(__file__).with_name("npm-audit-allowlist.json")
BLOCKING = {"moderate", "high", "critical"}


def advisories(report: dict) -> dict[str, dict]:
    """把 npm audit --json 的 vulnerabilities[*].via 裡真正的公告（物件）攤平，以 GHSA 編號為鍵。"""
    found: dict[str, dict] = {}
    for vulnerability in (report.get("vulnerabilities") or {}).values():
        for via in vulnerability.get("via", []):
            if not isinstance(via, dict):  # 字串是「因為依賴某個有公告的套件」，公告本身在別處
                continue
            url = via.get("url") or ""
            advisory_id = url.rsplit("/", 1)[-1] if "/advisories/" in url else str(via.get("source"))
            found[advisory_id] = {
                "id": advisory_id,
                "package": via.get("name", "?"),
                "severity": via.get("severity", "?"),
                "title": via.get("title", ""),
            }
    return found


def evaluate(report: dict, allowlist: dict, project: str, today: date) -> tuple[list[str], list[str]]:
    """回傳（錯誤, 備註）。錯誤非空就是閘門不過。"""
    errors: list[str] = []
    notes: list[str] = []
    allowed = {entry["id"]: entry for entry in allowlist.get("entries", []) if project in entry.get("projects", [])}
    found = advisories(report)
    for advisory_id, advisory in sorted(found.items()):
        if advisory["severity"] not in BLOCKING:
            continue
        entry = allowed.get(advisory_id)
        label = f"{advisory_id}（{advisory['package']}，{advisory['severity']}）{advisory['title']}"
        if entry is None:
            errors.append(f"未放行的公告：{label}")
        elif date.fromisoformat(entry["expires"]) < today:
            errors.append(f"放行已過期（{entry['expires']}），請重新評估或升級：{label}")
        else:
            notes.append(f"放行到 {entry['expires']}：{label}\n    原因：{entry['reason']}")
    # 統計說有 moderate 以上的漏洞、卻解析不到任何公告：npm 改了輸出格式，不能當作沒有公告。
    counts = (report.get("metadata") or {}).get("vulnerabilities") or {}
    if any(counts.get(level, 0) for level in BLOCKING) and not any(item["severity"] in BLOCKING for item in found.values()):
        errors.append("npm audit 的統計有 moderate 以上的漏洞，但解析不到任何公告（輸出格式可能變了），不能放行")
    for advisory_id in sorted(set(allowed) - set(found)):
        notes.append(f"放行清單的 {advisory_id} 這次沒有出現（已升級或公告撤回），可以從清單移除")
    return errors, notes


def run_npm_audit() -> dict:
    # npm audit 有公告時 exit 1，所以不看 exit code，看 JSON；JSON 裡有 error 或讀不出來就失敗。
    result = subprocess.run(["npm", "audit", "--omit=dev", "--json"], capture_output=True, text=True)
    try:
        report = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise SystemExit(f"npm audit 沒有輸出 JSON（exit {result.returncode}），不能當作沒有公告：{error}\n{result.stderr[-500:]}")
    if report.get("error"):
        raise SystemExit(f"npm audit 回報錯誤，不能當作沒有公告：{json.dumps(report['error'], ensure_ascii=False)}")
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--project", required=True, help="放行清單裡的 projects 名稱（web 或 admin）")
    parser.add_argument("--report", help="用已存的 npm audit --json 檔代替現場執行（測試用）")
    parser.add_argument("--allowlist", default=str(ALLOWLIST_PATH))
    args = parser.parse_args(argv)

    report = json.loads(Path(args.report).read_text()) if args.report else run_npm_audit()
    allowlist = json.loads(Path(args.allowlist).read_text())
    errors, notes = evaluate(report, allowlist, args.project, date.today())
    for note in notes:
        print(f"[npm audit 閘門] {note}")
    for error in errors:
        print(f"[npm audit 閘門] ✗ {error}", file=sys.stderr)
    if errors:
        print(f"[npm audit 閘門] {args.project}：{len(errors)} 項不過", file=sys.stderr)
        return 1
    print(f"[npm audit 閘門] {args.project}：通過")
    return 0


if __name__ == "__main__":
    sys.exit(main())
