"""手機推播（Web Push）測試共用：金鑰、假的瀏覽器訂閱、假的推播服務（httpx.MockTransport）。

一律不連真的推播服務、不發真的通知：送出的請求全部由 MockTransport 接住，用 http_ece.decrypt 以
測試訂閱的私鑰解回本文，驗證內容真的加密過、也真的是預期的內容。"""

from __future__ import annotations

import base64
import json
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone

import http_ece
import httpx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from app.config import Settings
from app.notifications import vapid
from app.notifications.models import PushSubscription
from tests.conftest import _test_settings

PUBLIC_KEY, PRIVATE_KEY = vapid.generate_key_pair()
SUBJECT = "mailto:ops@ivy.example"
FCM = "https://fcm.googleapis.com/fcm/send/"
APPLE = "https://web.push.apple.com/"


def push_settings(**overrides) -> Settings:
    update = {
        "vapid_public_key": PUBLIC_KEY,
        "vapid_private_key": PRIVATE_KEY,
        "vapid_subject": SUBJECT,
        "admin_origin": "https://ivy.example",
        **overrides,
    }
    return _test_settings().model_copy(update=update)


@dataclass
class Device:
    """一台假的裝置：持有訂閱端私鑰與 auth，能解開送來的本文。"""

    endpoint: str
    private_key: ec.EllipticCurvePrivateKey = field(default_factory=lambda: ec.generate_private_key(ec.SECP256R1()))
    auth: bytes = field(default_factory=lambda: uuid.uuid4().bytes)

    @property
    def p256dh(self) -> str:
        point = self.private_key.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
        return vapid.b64url_encode(point)

    @property
    def keys(self) -> dict[str, str]:
        return {"p256dh": self.p256dh, "auth": vapid.b64url_encode(self.auth)}

    def subscription(self, user_id: uuid.UUID | None = None, **overrides) -> PushSubscription:
        return PushSubscription(
            id=uuid.uuid4(),
            user_id=user_id or uuid.uuid4(),
            endpoint=self.endpoint,
            p256dh=self.p256dh,
            auth=vapid.b64url_encode(self.auth),
            device_label="測試裝置",
            created_at=datetime.now(timezone.utc),
            failure_count=0,
            **overrides,
        )

    def decrypt(self, body: bytes) -> dict:
        return json.loads(http_ece.decrypt(body, private_key=self.private_key, auth_secret=self.auth))


def new_device(host: str = FCM) -> Device:
    return Device(endpoint=f"{host}{uuid.uuid4().hex}")


class FakePushService:
    """假的推播服務：記下每個請求，依 endpoint 回指定狀態（預設 201）。"""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.statuses: dict[str, int] = {}
        self.default_status = 201
        self.raise_for: dict[str, Exception] = {}

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        url = str(request.url)
        if url in self.raise_for:
            raise self.raise_for[url]
        return httpx.Response(self.statuses.get(url, self.default_status))

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)

    def bodies_for(self, device: Device) -> list[dict]:
        return [device.decrypt(r.content) for r in self.requests if str(r.url) == device.endpoint]


def jwt_parts(authorization: str) -> tuple[dict, str, str, str]:
    """'vapid t=<JWT>,k=<公鑰>' → (claims, 簽章前字串, 簽章, k)。"""
    assert authorization.startswith("vapid ")
    fields = dict(part.strip().split("=", 1) for part in authorization[len("vapid ") :].split(","))
    token, key = fields["t"], fields["k"]
    header, claims, signature = token.split(".")
    pad = lambda value: value + "=" * (-len(value) % 4)  # noqa: E731
    assert json.loads(base64.urlsafe_b64decode(pad(header))) == {"typ": "JWT", "alg": "ES256"}
    return json.loads(base64.urlsafe_b64decode(pad(claims))), f"{header}.{claims}", signature, key
