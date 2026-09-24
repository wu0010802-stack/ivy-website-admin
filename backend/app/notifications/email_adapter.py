from __future__ import annotations

import json
import os
import smtplib
import ssl
import uuid
from email.message import EmailMessage
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


class SmtpEmailAdapter:
    """真實寄信。每封信開一次連線：worker 一輪只寄幾封，不值得維持長連線，
    也避免閒置連線被伺服器切斷後整批失敗。失敗直接拋出，由 outbox 記錄
    錯誤碼、排下次重試（不會因此回滾預約）。"""

    def __init__(
        self,
        *,
        host: str,
        port: int,
        sender: str,
        username: str | None = None,
        password: str | None = None,
        security: str = "starttls",
        timeout: float = 20.0,
    ) -> None:
        self.host = host
        self.port = port
        self.sender = sender
        self.username = username
        self.password = password
        self.security = security
        self.timeout = timeout

    def send(self, *, to: str, subject: str, body: str) -> None:
        message = EmailMessage()
        message["From"] = self.sender
        message["To"] = to
        message["Subject"] = subject
        message.set_content(body)
        context = ssl.create_default_context()
        if self.security == "ssl":
            client = smtplib.SMTP_SSL(self.host, self.port, timeout=self.timeout, context=context)
        else:
            client = smtplib.SMTP(self.host, self.port, timeout=self.timeout)
        with client:
            if self.security == "starttls":
                client.starttls(context=context)
            if self.username:
                client.login(self.username, self.password or "")
            client.send_message(message)


def get_email_adapter(sink_dir: str | None, settings=None) -> EmailAdapter:
    """有 SMTP 設定就真的寄；否則退回本機 sink（開發用）；兩者都沒有就拋
    EmailNotConfigured，呼叫端如實回報未配置。"""
    if settings is not None and getattr(settings, "smtp_host", None):
        return SmtpEmailAdapter(
            host=settings.smtp_host,
            port=settings.smtp_port,
            sender=settings.smtp_from,
            username=settings.smtp_username,
            password=settings.smtp_password,
            security=settings.smtp_security,
        )
    return LocalSinkEmailAdapter(sink_dir)
