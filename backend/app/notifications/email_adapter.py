from __future__ import annotations

import hashlib
import json
import os
import re
import smtplib
import ssl
import uuid
from email.message import EmailMessage
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Protocol

import httpx

if TYPE_CHECKING:
    from app.config import Settings


class EmailNotConfigured(Exception):
    """部署環境沒有設定寄信管道時要如實回報未配置，不能假裝寄成功。"""


class EmailAdapter(Protocol):
    """寄信管道。send 的簽名只有收件人、主旨、內文；支援冪等的管道（Resend）另外宣告
    `supports_idempotency_key = True` 並多收 `idempotency_key`，呼叫端一律經 `send_email` 寄，
    不認識這個參數的管道（SMTP、本機 sink、測試用的假 adapter）不會被多傳的參數弄壞。"""

    def send(self, *, to: str, subject: str, body: str) -> None: ...


def outbox_idempotency_key(outbox_message_id: uuid.UUID | str, recipient: str) -> str:
    """outbox 工作寄信的冪等鍵：同一筆工作寄給同一位收件人，每次重試都是同一把 key（Resend 24 小時內
    不重寄）；同一筆工作寄給多位收件人（園方通知）各有各的 key。收件地址只取雜湊，不寫進 header。
    Resend 的 key 上限 256 字，這裡約 64 字。"""
    digest = hashlib.sha256(recipient.strip().lower().encode("utf-8")).hexdigest()[:16]
    return f"ivy-outbox-{outbox_message_id}-{digest}"


def send_email(
    adapter: EmailAdapter, *, to: str, subject: str, body: str, idempotency_key: str | None = None
) -> None:
    """寄一封信。`idempotency_key` 只交給宣告支援的管道（Resend），其他管道照舊三個參數。
    阻塞 I/O，從事件迴圈呼叫要包 asyncio.to_thread。"""
    if idempotency_key is not None and getattr(adapter, "supports_idempotency_key", False):
        adapter.send(to=to, subject=subject, body=body, idempotency_key=idempotency_key)  # type: ignore[call-arg]
    else:
        adapter.send(to=to, subject=subject, body=body)


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


RESEND_API_BASE = "https://api.resend.com"
# 對方回的錯誤種類（name）只認短代碼；其他內容不帶進例外與紀錄。
_RESEND_ERROR_NAME = re.compile(r"[a-z0-9_]{1,64}")
# 金鑰本身有問題（不存在、停用、權限不足）的錯誤種類；403 的其他情況是寄件網域或收件地址被擋。
_RESEND_KEY_ERRORS = frozenset({"missing_api_key", "restricted_api_key", "suspended_api_key", "invalid_permission", "invalid_api_key"})


class ResendError(Exception):
    """Resend 回了錯誤。訊息只帶狀態碼與錯誤種類，不帶回應內文（可能含收件地址與網域）。
    子類別的名稱會成為 outbox 的 error_code，後台依名稱顯示大概原因。"""

    def __init__(self, status_code: int, name: str) -> None:
        super().__init__(f"RESEND_HTTP_{status_code}:{name}")
        self.status_code = status_code
        self.name = name


class ResendAuthError(ResendError):
    """API 金鑰不存在、已停用或權限不足。"""


class ResendRejectedError(ResendError):
    """請求被拒：寄件網域還沒驗證、測試模式只能寄給自己，或寄件／收件地址格式不對。"""


class ResendQuotaError(ResendError):
    """超過每日／每月額度，或寄得太快。"""


class ResendServerError(ResendError):
    """Resend 那一端出錯（5xx）。"""


def _resend_error(response: httpx.Response) -> ResendError:
    status_code = response.status_code
    name = "unknown"
    try:
        payload = response.json()
    except ValueError:
        payload = None
    if isinstance(payload, dict) and isinstance(payload.get("name"), str) and _RESEND_ERROR_NAME.fullmatch(payload["name"]):
        name = payload["name"]
    if status_code == 401 or (status_code == 403 and name in _RESEND_KEY_ERRORS):
        return ResendAuthError(status_code, name)
    if status_code == 429:
        return ResendQuotaError(status_code, name)
    if status_code >= 500:
        return ResendServerError(status_code, name)
    if status_code in (400, 403, 422):
        return ResendRejectedError(status_code, name)
    return ResendError(status_code, name)


class ResendEmailAdapter:
    """經 Resend 的 HTTPS API 真實寄信（2026-11-11）。不走 SMTP：部署平台可能擋對外的 SMTP 連接埠，
    HTTPS 一定通。每封信一次請求、純文字內容；失敗直接拋出，由 outbox 記錯誤碼並排下次重試。

    send 是同步呼叫（和 SmtpEmailAdapter 一樣在背景 thread 裡跑），所以用 httpx.Client。

    帶 `idempotency_key` 時送 Idempotency-Key 標頭：Resend 對同一把 key 24 小時內只寄一次。outbox
    工作寄出後回應逾時（信其實已送出），下一輪重試用同一把 key，家長才不會收到兩封。"""

    supports_idempotency_key = True

    def __init__(
        self,
        *,
        api_key: str,
        sender: str,
        transport: httpx.BaseTransport | None = None,
        base_url: str = RESEND_API_BASE,
        timeout: float = 10.0,
    ) -> None:
        self._api_key = api_key
        self.sender = sender
        self._transport = transport
        self._base_url = base_url
        self._timeout = timeout

    def send(self, *, to: str, subject: str, body: str, idempotency_key: str | None = None) -> None:
        headers = {"Authorization": f"Bearer {self._api_key}"}
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key
        with httpx.Client(
            base_url=self._base_url,
            transport=self._transport,
            timeout=httpx.Timeout(self._timeout),
            headers=headers,
        ) as client:
            response = client.post(
                "/emails",
                json={"from": self.sender, "to": [to], "subject": subject, "text": body},
            )
        if response.status_code >= 400:
            error = _resend_error(response)
            # 同一把 key、內容和上次不同（重試前案件又改了）：上一次已經被 Resend 收下，信不會再寄一次。
            # 當成已寄出；繼續重試只會一直 409 到 outbox 過期，狀態變成寄送失敗。
            if idempotency_key and error.status_code == 409 and error.name == "invalid_idempotent_request":
                return
            raise error


def get_email_adapter(sink_dir: str | None, settings=None) -> EmailAdapter:
    """有 SMTP 或 Resend 設定就真的寄（兩者只能擇一，Settings 啟動時已檢查）；否則退回本機 sink
    （開發用）；都沒有就拋 EmailNotConfigured，呼叫端如實回報未配置。"""
    if settings is not None and getattr(settings, "smtp_host", None):
        return SmtpEmailAdapter(
            host=settings.smtp_host,
            port=settings.smtp_port,
            sender=settings.smtp_from,
            username=settings.smtp_username,
            password=settings.smtp_password,
            security=settings.smtp_security,
        )
    if settings is not None and getattr(settings, "resend_api_key", None):
        return ResendEmailAdapter(api_key=settings.resend_api_key, sender=settings.resend_from)
    return LocalSinkEmailAdapter(sink_dir)


def email_channel_available(settings: Settings) -> bool:
    """部署有沒有可用的寄信管道。正式環境只認真實寄信（SMTP 或 Resend）：兩者都沒設就算有 sink 資料夾
    也不算，否則畫面或信件紀錄說「已寄出」，信卻只是躺在伺服器的資料夾裡。非正式環境另外接受
    本機 sink（開發與 stack e2e 讀信用）。"""
    if settings.real_email_enabled:
        return True
    return settings.environment != "production" and bool(settings.notification_email_sink_dir)


def deployment_email_adapter(settings: Settings) -> EmailAdapter:
    """依部署設定取寄信 adapter；沒有可用的管道時丟 EmailNotConfigured（呼叫端走「未配置」處理，
    不要在啟動時驗證失敗）。outbox 背景工作、重設密碼連結與系統狀態測試信共用這一條規則。"""
    if not email_channel_available(settings):
        raise EmailNotConfigured(
            "沒有可用的寄信管道（正式環境只認 SMTP 或 Resend）" if settings.environment == "production" else "未設定寄信管道"
        )
    return get_email_adapter(settings.notification_email_sink_dir, settings)
