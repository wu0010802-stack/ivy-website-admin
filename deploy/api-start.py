"""Prepare the media directory (local storage only), migrate the database, then run the API as an unprivileged user."""
import os
import pwd
import secrets
import subprocess
import sys
from pathlib import Path

# WEBSITE_MEDIA_STORAGE=s3 keeps media in object storage, so the API no longer
# needs (or is tied to) the Railway volume. Local storage still requires it.
uses_volume = os.environ.get("WEBSITE_MEDIA_STORAGE", "local").strip().lower() != "s3"
mount = Path("/data")
media = mount / "media"
if uses_volume:
    if os.environ.get("RAILWAY_VOLUME_MOUNT_PATH") != str(mount) or not mount.is_mount():
        raise SystemExit("The Railway /data volume is required.")
    if os.environ.get("WEBSITE_MEDIA_ROOT") != str(media) or media.is_symlink():
        raise SystemExit("WEBSITE_MEDIA_ROOT must be the mounted /data/media directory.")
    media.mkdir(mode=0o750, exist_ok=True)
if os.getuid() == 0:
    if uses_volume:
        os.chown(media, 10001, 10001)
    os.setgroups([])
    os.setgid(10001)
    os.setuid(10001)
# Match the process identity: asyncpg otherwise probes root's default TLS key.
os.environ["HOME"] = pwd.getpwuid(os.getuid()).pw_dir
if uses_volume:
    probe = media / f".probe-{secrets.token_hex(8)}"
    try:
        probe.write_bytes(b"volume-ready")
        if probe.read_bytes() != b"volume-ready":
            raise SystemExit("Media volume read/write check failed.")
    finally:
        probe.unlink(missing_ok=True)
# Every deploy upgrades to the migration head baked into this image. Alembic runs
# all pending revisions in one transaction, so a failure or timeout rolls back and
# the API does not start. Keep the total under the 120 s Railway healthcheck.
subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True, timeout=90)
subprocess.run([sys.executable, "/app/check-schema.py"], check=True, timeout=40)
os.execvp("uvicorn", ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", os.environ.get("PORT", "8000")])
