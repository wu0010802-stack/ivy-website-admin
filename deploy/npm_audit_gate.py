#!/usr/bin/env python3
"""CI 的 npm audit 閘門：正式依賴有 moderate 以上的公告就擋下部署，除非列在放行清單裡。

為什麼不直接 `npm audit --omit=dev --audit-level=moderate`：npm 沒有「放行某一則公告」的選項，
遇到「確定不影響、一時無法升級」的公告只能整個閘門關掉。這裡逐則比對 `npm-audit-allowlist.json`：
  - 清單裡的公告要寫原因、適用的專案（web／admin）與到期日（最多 90 天）；
  - 到期就失敗，逼人重新評估或升級；剩 14 天內印 ::warning::；
  - 清單以外的公告照舊擋下；severity 只有 info／low 才略過，未知的值一律擋。
npm 本身跑不起來、輸出不是預期的 JSON 格式時一律失敗（不能因為稽核壞掉就當作沒有公告）。
閘門自己切到專案目錄執行 npm，不依賴呼叫端的工作目錄。

用法：python3 deploy/npm_audit_gate.py --project web
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import date, timedelta
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
ALLOWLIST_PATH = Path(__file__).with_name("npm-audit-allowlist.json")
PROJECTS = ("web", "admin")
SKIPPED = {"info", "low"}  # 對應 --audit-level=moderate：只有這兩級可以略過，其餘（含看不懂的值）都擋
RANK = {"info": 0, "low": 1, "moderate": 2, "high": 3, "critical": 4}
MAX_ALLOW_DAYS = 90
WARN_DAYS = 14


def severity_of(value: object) -> str:
    return str(value).strip().lower() if value else "unknown"


def advisories(report: dict) -> dict[str, dict]:
    """把 npm audit --json 的 vulnerabilities[*].via 裡真正的公告（物件）攤平，以 GHSA 編號為鍵。
    同一則公告會出現在多個套件（例如 nuxt 與 @nuxt/nitro-server），嚴重度取最高的。"""
    found: dict[str, dict] = {}
    for vulnerability in (report.get("vulnerabilities") or {}).values():
        for via in vulnerability.get("via", []):
            if not isinstance(via, dict):  # 字串是「因為依賴某個有公告的套件」，公告本身在別處
                continue
            url = via.get("url") or ""
            advisory_id = url.rsplit("/", 1)[-1] if "/advisories/" in url else f"npm-{via.get('source')}"
            severity = severity_of(via.get("severity"))
            previous = found.get(advisory_id)
            if previous and RANK.get(previous["severity"], 99) >= RANK.get(severity, 99):
                continue
            found[advisory_id] = {"id": advisory_id, "package": via.get("name", "?"), "severity": severity, "title": via.get("title", "")}
    return found


def check_allowlist(allowlist: dict, today: date) -> list[str]:
    errors: list[str] = []
    seen: set[str] = set()
    for entry in allowlist.get("entries", []):
        if entry["id"] in seen:
            errors.append(f"放行清單有重複的公告編號：{entry['id']}")
        seen.add(entry["id"])
        if date.fromisoformat(entry["expires"]) > today + timedelta(days=MAX_ALLOW_DAYS):
            errors.append(f"放行到期日太遠（最多 {MAX_ALLOW_DAYS} 天）：{entry['id']} {entry['expires']}")
    return errors


def evaluate(report: dict, allowlist: dict, project: str, today: date) -> tuple[list[str], list[str]]:
    """回傳（錯誤, 備註）。錯誤非空就是閘門不過。"""
    errors = check_allowlist(allowlist, today)
    notes: list[str] = []
    allowed = {entry["id"]: entry for entry in allowlist.get("entries", []) if project in entry.get("projects", [])}
    found = advisories(report)
    for advisory_id, advisory in sorted(found.items()):
        if advisory["severity"] in SKIPPED:
            continue
        entry = allowed.get(advisory_id)
        label = f"{advisory_id}（{advisory['package']}，{advisory['severity']}）{advisory['title']}"
        if entry is None:
            errors.append(f"未放行的公告：{label}")
            continue
        expires = date.fromisoformat(entry["expires"])
        if expires < today:
            errors.append(f"放行已過期（{entry['expires']}），請重新評估或升級：{label}")
            continue
        notes.append(f"放行到 {entry['expires']}：{label}\n    原因：{entry['reason']}")
        if (expires - today).days <= WARN_DAYS:
            print(f"::warning title=npm audit 放行即將到期::{advisory_id} 放行到 {entry['expires']}，請升級或重新評估")
    # 統計說有 moderate 以上的漏洞、卻解析不到任何會擋的公告：npm 改了輸出格式，不能當作沒有公告。
    counts = (report.get("metadata") or {}).get("vulnerabilities") or {}
    flagged = any(counts.get(level, 0) for level in ("moderate", "high", "critical"))
    if flagged and not any(item["severity"] not in SKIPPED for item in found.values()):
        errors.append("npm audit 的統計有 moderate 以上的漏洞，但解析不到任何公告（輸出格式可能變了），不能放行")
    for advisory_id in sorted(set(allowed) - set(found)):
        notes.append(f"放行清單的 {advisory_id} 這次沒有出現（已升級或公告撤回），可以從清單移除")
    return errors, notes


def validate_report(report: object, returncode: int | None = None) -> dict:
    """不是預期的 npm audit v2 JSON 就當作稽核壞了（失敗），不能當作沒有公告。"""
    if not isinstance(report, dict):
        raise SystemExit("npm audit 的輸出不是 JSON 物件，不能當作沒有公告")
    if report.get("error") or "message" in report:
        raise SystemExit(f"npm audit 回報錯誤，不能當作沒有公告：{json.dumps(report.get('error') or report.get('message'), ensure_ascii=False)}")
    if report.get("auditReportVersion") != 2 or not isinstance(report.get("vulnerabilities"), dict) or "metadata" not in report:
        raise SystemExit("npm audit 的 JSON 不是預期的格式（auditReportVersion 2、vulnerabilities、metadata），不能當作沒有公告")
    if returncode and not advisories(report):  # npm audit 有任何公告都會 exit 1；exit 1 卻解析不到公告就是格式不對
        raise SystemExit(f"npm audit exit {returncode} 但解析不到任何公告，不能當作沒有公告")
    return report


def run_npm_audit(project: str) -> dict:
    # npm audit 有公告時 exit 1，所以不看 exit code 本身，看 JSON；JSON 壞掉或內容不對就失敗。
    result = subprocess.run(["npm", "audit", "--omit=dev", "--json"], capture_output=True, text=True, cwd=REPO_ROOT / project)
    try:
        report = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise SystemExit(f"npm audit 沒有輸出 JSON（exit {result.returncode}），不能當作沒有公告：{error}\n{result.stderr[-500:]}")
    return validate_report(report, result.returncode)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--project", required=True, choices=PROJECTS, help="稽核哪個專案（也是放行清單 projects 的名稱）")
    parser.add_argument("--report", help="用已存的 npm audit --json 檔代替現場執行（測試用）")
    parser.add_argument("--allowlist", default=str(ALLOWLIST_PATH))
    args = parser.parse_args(argv)

    report = validate_report(json.loads(Path(args.report).read_text())) if args.report else run_npm_audit(args.project)
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
