"""deploy/db-backup/backup.sh：用假的 pg_dump／pg_restore／age／rclone／wget 跑腳本，
核對「只上傳加密檔」「驗證不過就不上傳」「缺變數不動作」這幾條（2026-11-12）。"""

import json
import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parents[1] / "db-backup" / "backup.sh"

FAKES = {
    # 寫出一個假 dump；FAKE_PG_DUMP_FAIL 時失敗。
    "pg_dump": r"""
if [ "${1:-}" = "--version" ]; then echo "pg_dump (PostgreSQL) 18.1"; exit 0; fi
echo "pg_dump $*" >>"$FAKE_LOG"
[ -z "${FAKE_PG_DUMP_FAIL:-}" ] || exit 1
for a; do case "$a" in --file=*) printf 'PGDMP-fake-plaintext' >"${a#--file=}";; esac; done
""",
    "pg_restore": r"""
echo "pg_restore $*" >>"$FAKE_LOG"
echo "; Archive created"
if [ -z "${FAKE_EMPTY_DUMP:-}" ]; then
  echo "3401; 0 16390 TABLE DATA public visit_requests website"
  echo "3402; 0 16391 TABLE DATA public admin_users website"
fi
""",
    # 把 --output 寫成「加密檔」，並記下收件人。
    "age": r"""
echo "age $*" >>"$FAKE_LOG"
out=""; prev=""
for a; do [ "$prev" = "--output" ] && out="$a"; prev="$a"; done
printf 'age-encrypted-payload' >"$out"
""",
    # copyto 把檔案複製到 $FAKE_R2/<bucket path>；size 回報遠端大小。
    "rclone": r"""
echo "rclone $*" >>"$FAKE_LOG"
env | grep '^RCLONE_CONFIG_R2_' | sort >"$FAKE_R2.env"
case "$1" in
  copyto)
    src="$4"; dst="${5#r2:}"
    [ -z "${FAKE_RCLONE_FAIL:-}" ] || exit 1
    mkdir -p "$FAKE_R2/$(dirname "$dst")"; cp "$src" "$FAKE_R2/$dst";;
  size)
    f="$FAKE_R2/${3#r2:}"
    if [ -n "${FAKE_SIZE_MISMATCH:-}" ]; then n=1; else n=$(wc -c <"$f" | tr -d ' '); fi
    echo "{\"count\":1,\"bytes\":$n,\"sizeless\":0}";;
esac
""",
    "wget": r"""
echo "wget $*" >>"$FAKE_LOG"
""",
}

BASE_ENV = {
    "DATABASE_URL": "postgresql://website:secret-password@postgres.railway.internal:5432/railway",
    "BACKUP_AGE_RECIPIENTS": "age1aaa age1bbb",
    "R2_ACCOUNT_ID": "acct123",
    "R2_ACCESS_KEY_ID": "key-id",
    "R2_SECRET_ACCESS_KEY": "r2-secret-value",
    "R2_BUCKET": "ivy-website-db-backups",
}


class DbBackupScriptTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        self.bin = root / "bin"
        self.bin.mkdir()
        for name, body in FAKES.items():
            path = self.bin / name
            path.write_text("#!/bin/sh\nset -eu\n" + body)
            path.chmod(path.stat().st_mode | stat.S_IEXEC)
        self.log = root / "calls.log"
        self.log.touch()
        self.r2 = root / "r2"
        self.r2.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def run_script(self, **overrides):
        env = {
            "PATH": f"{self.bin}{os.pathsep}/usr/bin:/bin:/usr/sbin:/sbin",
            "FAKE_LOG": str(self.log),
            "FAKE_R2": str(self.r2),
            "TMPDIR": self.tmp.name,
            **BASE_ENV,
        }
        for key, value in overrides.items():
            if value is None:
                env.pop(key, None)
            else:
                env[key] = value
        return subprocess.run(["sh", str(SCRIPT)], env=env, capture_output=True, text=True, timeout=30)

    def uploaded(self):
        return sorted(p.relative_to(self.r2).as_posix() for p in self.r2.rglob("*") if p.is_file())

    def calls(self):
        return self.log.read_text()

    def test_uploads_only_encrypted_dump_and_manifest(self):
        result = self.run_script()
        self.assertEqual(result.returncode, 0, result.stderr)
        files = self.uploaded()
        self.assertEqual(len(files), 2, files)
        dump, manifest = sorted(files, key=lambda f: f.endswith(".json"))
        self.assertRegex(dump, r"^ivy-website-db-backups/daily/ivy-website-\d{8}T\d{6}Z\.dump\.age$")
        self.assertEqual(manifest, dump.replace(".dump.age", ".json"))
        self.assertEqual((self.r2 / dump).read_text(), "age-encrypted-payload")
        for path in self.r2.rglob("*"):
            if path.is_file():
                self.assertNotIn("PGDMP", path.read_text())
        data = json.loads((self.r2 / manifest).read_text())
        self.assertEqual(data["table_data_entries"], 2)
        self.assertEqual(data["dump_bytes"], len("PGDMP-fake-plaintext"))
        self.assertEqual(data["encrypted_bytes"], len("age-encrypted-payload"))
        self.assertEqual(data["pg_dump"], "pg_dump (PostgreSQL) 18.1")

    def test_every_recipient_is_passed_to_age(self):
        self.assertEqual(self.run_script().returncode, 0)
        age_line = next(line for line in self.calls().splitlines() if line.startswith("age "))
        self.assertIn("--recipient age1aaa --recipient age1bbb", age_line)

    def test_rclone_points_at_r2_endpoint_without_bucket_creation(self):
        self.assertEqual(self.run_script().returncode, 0)
        env = (self.r2.parent / "r2.env").read_text()
        self.assertIn("RCLONE_CONFIG_R2_ENDPOINT=https://acct123.r2.cloudflarestorage.com", env)
        self.assertIn("RCLONE_CONFIG_R2_PROVIDER=Cloudflare", env)
        self.assertIn("RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true", env)

    def test_secrets_never_appear_in_output(self):
        result = self.run_script()
        for secret in ("secret-password", "r2-secret-value", BASE_ENV["DATABASE_URL"]):
            self.assertNotIn(secret, result.stdout + result.stderr)

    def test_missing_variables_abort_before_doing_anything(self):
        result = self.run_script(R2_BUCKET=None, BACKUP_AGE_RECIPIENTS="")
        self.assertEqual(result.returncode, 2)
        self.assertIn("R2_BUCKET", result.stderr)
        self.assertIn("BACKUP_AGE_RECIPIENTS", result.stderr)
        self.assertEqual(self.calls(), "")

    def test_pg_dump_failure_uploads_nothing(self):
        result = self.run_script(FAKE_PG_DUMP_FAIL="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.uploaded(), [])
        self.assertNotIn("age ", self.calls())

    def test_hash_failure_aborts_before_upload(self):
        # 2026-11-12 本機實跑：sha256sum 找不到時 manifest 曾寫進空雜湊仍上傳。
        broken = self.bin / "sha256sum"
        broken.write_text("#!/bin/sh\nexit 127\n")
        broken.chmod(0o755)
        result = self.run_script()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.uploaded(), [])

    def test_dump_without_table_data_is_rejected(self):
        result = self.run_script(FAKE_EMPTY_DUMP="1")
        self.assertEqual(result.returncode, 3)
        self.assertEqual(self.uploaded(), [])

    def test_upload_failure_fails_and_skips_heartbeat(self):
        result = self.run_script(FAKE_RCLONE_FAIL="1", BACKUP_HEARTBEAT_URL="https://hc.example/ping")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("wget", self.calls())

    def test_remote_size_mismatch_fails(self):
        result = self.run_script(FAKE_SIZE_MISMATCH="1", BACKUP_HEARTBEAT_URL="https://hc.example/ping")
        self.assertEqual(result.returncode, 4)
        self.assertNotIn("wget", self.calls())

    def test_heartbeat_only_after_success(self):
        result = self.run_script(BACKUP_HEARTBEAT_URL="https://hc.example/ping")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("wget -q -T 10 -O /dev/null https://hc.example/ping", self.calls())

    def test_custom_prefix(self):
        self.assertEqual(self.run_script(BACKUP_PREFIX="manual/").returncode, 0)
        self.assertTrue(all(f.startswith("ivy-website-db-backups/manual/ivy-website-") for f in self.uploaded()))

    def test_temp_directory_is_cleaned_up(self):
        self.assertEqual(self.run_script().returncode, 0)
        leftovers = [p for p in Path(self.tmp.name).iterdir() if p.name.startswith("tmp")]
        self.assertEqual(leftovers, [])


class DbBackupImageTests(unittest.TestCase):
    def test_railway_config_runs_as_daily_cron_without_restart(self):
        config = json.loads((SCRIPT.parent / "railway.json").read_text())
        self.assertEqual(config["deploy"]["cronSchedule"], "0 19 * * *")  # 台北 03:00
        self.assertEqual(config["deploy"]["restartPolicyType"], "NEVER")

    def test_image_overrides_postgres_entrypoint(self):
        text = (SCRIPT.parent / "Dockerfile").read_text()
        self.assertIn("ENTRYPOINT []", text)
        self.assertIn('CMD ["/usr/local/bin/db-backup"]', text)
        self.assertIn("USER 10001", text)


if __name__ == "__main__":
    unittest.main()
