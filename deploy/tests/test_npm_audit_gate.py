import importlib.util
import json
import subprocess
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch


GATE_PATH = Path(__file__).resolve().parents[1] / "npm_audit_gate.py"
ALLOWLIST_PATH = Path(__file__).resolve().parents[1] / "npm-audit-allowlist.json"
TODAY = date(2026, 11, 1)


def advisory(ghsa, name="glob", severity="moderate", title="某個公告"):
    return {
        "source": 1,
        "name": name,
        "title": title,
        "url": f"https://github.com/advisories/{ghsa}",
        "severity": severity,
    }


def report(*direct, transitive=("nitropack",)):
    vulnerabilities = {item["name"]: {"name": item["name"], "via": [item]} for item in direct}
    for name in transitive:  # 只是「依賴有公告的套件」，via 是字串
        vulnerabilities[name] = {"name": name, "via": [direct[0]["name"]]}
    return {"auditReportVersion": 2, "vulnerabilities": vulnerabilities}


def allowlist(ghsa="GHSA-aaaa-bbbb-cccc", projects=("web",), expires="2026-11-30"):
    return {"entries": [{"id": ghsa, "projects": list(projects), "package": "glob", "expires": expires, "reason": "只在建置工具鏈"}]}


class NpmAuditGateTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("npm_audit_gate", GATE_PATH)
        self.gate = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.gate)

    def test_flattens_real_advisories_and_skips_transitive_strings(self):
        found = self.gate.advisories(report(advisory("GHSA-aaaa-bbbb-cccc"), advisory("GHSA-dddd-eeee-ffff", name="minimatch")))
        self.assertEqual(sorted(found), ["GHSA-aaaa-bbbb-cccc", "GHSA-dddd-eeee-ffff"])
        self.assertEqual(found["GHSA-dddd-eeee-ffff"]["package"], "minimatch")

    def test_allowlisted_advisory_passes_with_reason_in_notes(self):
        errors, notes = self.gate.evaluate(report(advisory("GHSA-aaaa-bbbb-cccc")), allowlist(), "web", TODAY)
        self.assertEqual(errors, [])
        self.assertIn("只在建置工具鏈", notes[0])
        self.assertIn("2026-11-30", notes[0])

    def test_advisory_not_on_the_list_blocks(self):
        errors, _ = self.gate.evaluate(report(advisory("GHSA-aaaa-bbbb-cccc"), advisory("GHSA-new0-new0-new0", name="express", severity="high")), allowlist(), "web", TODAY)
        self.assertEqual(len(errors), 1)
        self.assertIn("GHSA-new0-new0-new0", errors[0])
        self.assertIn("未放行", errors[0])

    def test_expired_entry_blocks_so_someone_has_to_look_again(self):
        errors, _ = self.gate.evaluate(report(advisory("GHSA-aaaa-bbbb-cccc")), allowlist(expires="2026-10-31"), "web", TODAY)
        self.assertEqual(len(errors), 1)
        self.assertIn("已過期", errors[0])

    def test_entry_is_still_valid_on_its_expiry_day(self):
        errors, _ = self.gate.evaluate(report(advisory("GHSA-aaaa-bbbb-cccc")), allowlist(expires="2026-11-01"), "web", TODAY)
        self.assertEqual(errors, [])

    def test_entry_for_another_project_does_not_cover_this_one(self):
        errors, _ = self.gate.evaluate(report(advisory("GHSA-aaaa-bbbb-cccc")), allowlist(projects=("web",)), "admin", TODAY)
        self.assertEqual(len(errors), 1)

    def test_low_severity_does_not_block_like_audit_level_moderate(self):
        errors, _ = self.gate.evaluate(report(advisory("GHSA-low0-low0-low0", name="deepmerge", severity="low")), {"entries": []}, "web", TODAY)
        self.assertEqual(errors, [])

    def test_clean_report_passes_and_flags_stale_entries_only_as_notes(self):
        errors, notes = self.gate.evaluate({"auditReportVersion": 2, "vulnerabilities": {}}, allowlist(), "web", TODAY)
        self.assertEqual(errors, [])
        self.assertIn("可以從清單移除", notes[0])

    def test_unrecognised_output_format_fails_closed(self):
        # 統計有 moderate 漏洞，但 vulnerabilities 裡解析不到任何公告物件：格式變了，不能放行。
        odd = {"auditReportVersion": 3, "vulnerabilities": {"glob": {"name": "glob", "via": ["x"]}}, "metadata": {"vulnerabilities": {"moderate": 2}}}
        errors, _ = self.gate.evaluate(odd, {"entries": []}, "web", TODAY)
        self.assertEqual(len(errors), 1)
        self.assertIn("格式可能變了", errors[0])

    def test_main_exit_codes_with_saved_report(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "report.json").write_text(json.dumps(report(advisory("GHSA-aaaa-bbbb-cccc"))))
            (root / "ok.json").write_text(json.dumps(allowlist(expires="2999-01-01")))
            (root / "empty.json").write_text(json.dumps({"entries": []}))
            common = ["--project", "web", "--report", str(root / "report.json")]
            self.assertEqual(self.gate.main(common + ["--allowlist", str(root / "ok.json")]), 0)
            self.assertEqual(self.gate.main(common + ["--allowlist", str(root / "empty.json")]), 1)

    def test_npm_audit_that_cannot_run_fails_closed(self):
        for stdout in ("", "not json", json.dumps({"error": {"code": "ENOAUDIT", "summary": "registry down"}})):
            with self.subTest(stdout=stdout):
                done = subprocess.CompletedProcess(["npm"], 1, stdout=stdout, stderr="boom")
                with patch.object(self.gate.subprocess, "run", return_value=done):
                    with self.assertRaises(SystemExit):
                        self.gate.run_npm_audit()

    def test_committed_allowlist_is_well_formed(self):
        entries = json.loads(ALLOWLIST_PATH.read_text())["entries"]
        self.assertTrue(entries)
        seen = set()
        for entry in entries:
            with self.subTest(entry=entry["id"]):
                self.assertRegex(entry["id"], r"^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$")
                self.assertNotIn(entry["id"], seen)
                seen.add(entry["id"])
                self.assertTrue(set(entry["projects"]) <= {"web", "admin"} and entry["projects"])
                self.assertGreater(len(entry["reason"]), 20, "原因要寫清楚為什麼不影響")
                date.fromisoformat(entry["expires"])

    def test_committed_allowlist_covers_exactly_what_web_reported_on_2026_11_01(self):
        # 2026-11-01 web 的 npm audit --omit=dev：moderate 六則、low 一則（deepmerge，不擋）。
        listed = {entry["id"] for entry in json.loads(ALLOWLIST_PATH.read_text())["entries"]}
        self.assertEqual(
            listed,
            {"GHSA-9v7c-q64q-vv33", "GHSA-3xf4-9g3c-4h4w", "GHSA-x287-wcfc-q46c", "GHSA-648h-gw55-m2g7", "GHSA-3g3m-2fjr-6pw4", "GHSA-g3hv-75wg-m249"},
        )


if __name__ == "__main__":
    unittest.main()
