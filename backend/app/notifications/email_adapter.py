from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol


class EmailNotConfigured(Exception):
    """部署環境沒有設定寄信管道時要如實回報未配置，不能假裝寄成功。"""


class EmailAdapter(Protocol):
    def send(self, *, to: str, subject: str, body: str) -> None: ...


class LocalSinkEmailAdapter:
    """本機開發/測試用：把信件寫成檔案，不真的寄出。只有明確設定
    `WEBSITE_NOTIFICATION_EMAIL_SINK_DIR` 才會啟用；沒設定時建構會
    直接拋 EmailNotConfigured，呼叫端要如實顯示「未配置」。"""

    def __init__(self, sink_dir: str | None) -> None:
        if not sink_dir:
            raise EmailNotConfigured("未設定 WEBSITE_NOTIFICATION_EMAIL_SINK_DIR")
        self.sink_dir = Path(sink_dir)
        # 信件內容含員工信箱與案件編號：目錄 0700、檔案 0600，不依賴 umask。
        self.sink_dir.mkdir(mode=0o700, parents=True, exist_ok=True)

    def send(self, *, to: str, subject: str, body: str) -> None:
        record = {
            "to": to,
            "subject": subject,
            "body": body,
            "sent_at": datetime.now(timezone.utc).isoformat(),
        }
        path = self.sink_dir / f"{uuid.uuid4().hex}.json"
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False, indent=2))


def get_email_adapter(sink_dir: str | None) -> EmailAdapter:
    return LocalSinkEmailAdapter(sink_dir)
