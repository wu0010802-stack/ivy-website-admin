"""Prepare the mounted media directory, then run the API as an unprivileged user."""
import os
import pwd
import secrets
from pathlib import Path

mount = Path("/data")
media = mount / "media"
if os.environ.get("RAILWAY_VOLUME_MOUNT_PATH") != str(mount) or not mount.is_mount():
    raise SystemExit("The Railway /data volume is required.")
if os.environ.get("WEBSITE_MEDIA_ROOT") != str(media) or media.is_symlink():
    raise SystemExit("WEBSITE_MEDIA_ROOT must be the mounted /data/media directory.")
media.mkdir(mode=0o750, exist_ok=True)
if os.getuid() == 0:
    os.chown(media, 10001, 10001)
    os.setgroups([])
    os.setgid(10001)
    os.setuid(10001)
# Match the process identity: asyncpg otherwise probes root's default TLS key.
os.environ["HOME"] = pwd.getpwuid(os.getuid()).pw_dir
probe = media / f".probe-{secrets.token_hex(8)}"
try:
    probe.write_bytes(b"volume-ready")
    if probe.read_bytes() != b"volume-ready":
        raise SystemExit("Media volume read/write check failed.")
finally:
    probe.unlink(missing_ok=True)
os.execvp("uvicorn", ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", os.environ.get("PORT", "8000")])
