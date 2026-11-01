import contextlib
import importlib.util
import io
import json
import subprocess
import tempfile
import unittest
from datetime import date, timedelta
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


def report(*direct, transitive=("nitropack",), moderate=None):
    vulnerabilities = {item["name"]: {"name": item["name"], "via": [item]} for item in direct}
    for name in transitive:  # 只是「依賴有公告的套件」，via 是字串
        vulnerabilities[name] = {"name": name, "via": [direct[0]["name"]]}
    counts = {"moderate": len(direct) if moderate is None else moderate}
    return {"auditReportVersion": 2, "vulnerabilities": vulnerabilities, "metadata": {"vulnerabilities": counts}}


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

    def test_same_advisory_on_two_packages_keeps_the_highest_severity(self):
        for order in (("high", "low"), ("low", "high")):
            with self.subTest(order=order):
                two = report(advisory("GHSA-aaaa-bbbb-cccc", name="nuxt", severity=order[0]), advisory("GHSA-aaaa-bbbb-cccc", name="@nuxt/nitro-server", severity=order[1]))
                self.assertEqual(self.gate.advisories(two)["GHSA-aaaa-bbbb-cccc"]["severity"], "high")

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

    def test_expiry_closer_than_two_weeks_prints_a_ci_warning(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.gate.evaluate(report(advisory("GHSA-aaaa-bbbb-cccc")), allowlist(expires="2026-11-10"), "web", TODAY)
            self.gate.evaluate(report(advisory("GHSA-aaaa-bbbb-cccc")), allowlist(expires="2026-11-30"), "web", TODAY)
        self.assertEqual(out.getvalue().count("::warning"), 1)

    def test_expiry_more_than_90_days_away_is_rejected(self):
        errors, _ = self.gate.evaluate(report(advisory("GHSA-aaaa-bbbb-cccc")), allowlist(expires="2999-01-01"), "web", TODAY)
        self.assertTrue(any("太遠" in error for error in errors))

    def test_duplicate_ids_in_the_list_are_rejected(self):
        twice = {"entries": allowlist()["entries"] * 2}
        errors, _ = self.gate.evaluate(report(advisory("GHSA-aaaa-bbbb-cccc")), twice, "web", TODAY)
        self.assertTrue(any("重複" in error for error in errors))

    def test_entry_for_another_project_does_not_cover_this_one(self):
        errors, _ = self.gate.evaluate(report(advisory("GHSA-aaaa-bbbb-cccc")), allowlist(projects=("web",)), "admin", TODAY)
        self.assertEqual(len(errors), 1)

    def test_only_info_and_low_are_skipped(self):
        for severity in ("low", "info"):
            with self.subTest(severity=severity):
                errors, _ = self.gate.evaluate(report(advisory("GHSA-low0-low0-low0", name="deepmerge", severity=severity), moderate=0), {"entries": []}, "web", TODAY)
                self.assertEqual(errors, [])

    def test_unexpected_severity_values_block_instead_of_slipping_through(self):
        for severity in ("HIGH", "Critical", "Moderate", "severe", "", None):
            with self.subTest(severity=severity):
                item = advisory("GHSA-aaaa-bbbb-cccc", severity=severity)
                if severity is None:
                    del item["severity"]
                errors, _ = self.gate.evaluate(report(item, moderate=0), {"entries": []}, "web", TODAY)
                self.assertEqual(len(errors), 1)

    def test_clean_report_passes_and_flags_stale_entries_only_as_notes(self):
        clean = {"auditReportVersion": 2, "vulnerabilities": {}, "metadata": {"vulnerabilities": {}}}
        errors, notes = self.gate.evaluate(clean, allowlist(), "web", TODAY)
        self.assertEqual(errors, [])
        self.assertIn("可以從清單移除", notes[0])

    def test_statistics_that_disagree_with_the_parsed_advisories_fail_closed(self):
        # 統計有 moderate 漏洞，但 vulnerabilities 裡解析不到任何公告物件：格式變了，不能放行。
        odd = {"auditReportVersion": 2, "vulnerabilities": {"glob": {"name": "glob", "via": ["x"]}}, "metadata": {"vulnerabilities": {"moderate": 2}}}
        errors, _ = self.gate.evaluate(odd, {"entries": []}, "web", TODAY)
        self.assertEqual(len(errors), 1)
        self.assertIn("格式可能變了", errors[0])

    def test_reports_that_are_not_npm_audit_v2_output_fail_closed(self):
        broken = [
            [],
            {},
            {"message": "x"},
            {"error": {"code": "ENOAUDIT", "summary": "registry down"}},
            {"auditReportVersion": 1, "vulnerabilities": {}, "metadata": {}},
            {"auditReportVersion": 2, "metadata": {}},
            {"auditReportVersion": 2, "vulnerabilities": {}},
        ]
        for item in broken:
            with self.subTest(report=item):
                with self.assertRaises(SystemExit):
                    self.gate.validate_report(item)

    def test_npm_exit_code_one_without_any_parsed_advisory_fails_closed(self):
        clean = {"auditReportVersion": 2, "vulnerabilities": {}, "metadata": {"vulnerabilities": {}}}
        self.gate.validate_report(clean, 0)
        with self.assertRaises(SystemExit):
            self.gate.validate_report(clean, 1)

    def test_main_exit_codes_with_saved_report(self):
        soon = (date.today() + timedelta(days=30)).isoformat()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "report.json").write_text(json.dumps(report(advisory("GHSA-aaaa-bbbb-cccc"))))
            (root / "ok.json").write_text(json.dumps(allowlist(expires=soon)))
            (root / "empty.json").write_text(json.dumps({"entries": []}))
            common = ["--project", "web", "--report", str(root / "report.json")]
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                self.assertEqual(self.gate.main(common + ["--allowlist", str(root / "ok.json")]), 0)
                self.assertEqual(self.gate.main(common + ["--allowlist", str(root / "empty.json")]), 1)

    def test_project_must_be_web_or_admin(self):
        with contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                self.gate.main(["--project", "contracts"])

    def test_npm_audit_runs_in_the_project_directory_not_the_callers(self):
        out = json.dumps({"auditReportVersion": 2, "vulnerabilities": {}, "metadata": {"vulnerabilities": {}}})
        done = subprocess.CompletedProcess(["npm"], 0, stdout=out, stderr="")
        for project in ("web", "admin"):
            with self.subTest(project=project):
                with patch.object(self.gate.subprocess, "run", return_value=done) as run:
                    self.gate.run_npm_audit(project)
                self.assertEqual(run.call_args.kwargs["cwd"], GATE_PATH.parents[1] / project)

    def test_npm_audit_that_cannot_run_fails_closed(self):
        for stdout in ("", "not json", "[]", "{}", json.dumps({"error": {"code": "ENOAUDIT", "summary": "registry down"}}), json.dumps({"error": {}, "message": "x"})):
            with self.subTest(stdout=stdout):
                done = subprocess.CompletedProcess(["npm"], 1, stdout=stdout, stderr="boom")
                with patch.object(self.gate.subprocess, "run", return_value=done):
                    with self.assertRaises(SystemExit):
                        self.gate.run_npm_audit("web")

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

    def test_committed_allowlist_has_no_findings_of_its_own(self):
        self.assertEqual(self.gate.check_allowlist(json.loads(ALLOWLIST_PATH.read_text()), date(2026, 11, 1)), [])


if __name__ == "__main__":
    unittest.main()
