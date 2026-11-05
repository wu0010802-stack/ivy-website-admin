"""手機推播（Web Push）的 VAPID 金鑰：產生、解析、配對檢查，以及訂閱端點的白名單（2026-11-05）。

純函式、不碰資料庫與設定物件，config.py 在啟動驗證時直接用。**所有錯誤訊息都不含金鑰內容**：
解析失敗一律丟出新的 ValueError（from None，不串接原例外），免得私鑰跟著例外訊息進 log。

金鑰格式（和瀏覽器、py_vapid 一致）：
- 公鑰＝未壓縮 P-256 點（0x04 開頭、65 bytes）的 base64url（無填充，約 87 字元），就是瀏覽器
  pushManager.subscribe 的 applicationServerKey。
- 私鑰＝原始 32 bytes 純量的 base64url（無填充，43 字元）。"""

from __future__ import annotations

import base64
import binascii
import re
import time
from urllib.parse import urlsplit

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from py_vapid import Vapid02

_UNCOMPRESSED_POINT = serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint

# 推播服務的位址白名單（防 SSRF：endpoint 是使用者的瀏覽器給的字串，伺服器不能被它指到內網）。
# FCM（Chrome、Edge、Android）、Mozilla（Firefox）、Apple（Safari／iOS 主畫面）、WNS（舊版 Edge）。
_EXACT_HOSTS = frozenset({"fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"})
_HOST_SUFFIXES = (".push.apple.com", ".notify.windows.com")
ENDPOINT_MAX_LENGTH = 2000

# 整串用一條嚴格的規則比對：只准 https、字母數字與 . - 組成的主機、選用的 :443、可見的 ASCII 路徑。
# 不給 URL 解析器（urllib、httpx）對怪字元（反斜線、換行、@ 帳密）有不同解讀的機會。
_ENDPOINT = re.compile(r"https://(?P<host>[A-Za-z0-9.\-]+)(?::443)?(?P<rest>/[\x21-\x5b\x5d-\x7e]*)")


def endpoint_allowed(endpoint: object) -> bool:
    """https、預設埠、主機在白名單內。訂閱時驗一次，送出前再驗一次。"""
    if not isinstance(endpoint, str) or not endpoint or len(endpoint) > ENDPOINT_MAX_LENGTH:
        return False
    match = _ENDPOINT.fullmatch(endpoint)
    if match is None:
        return False
    host = match.group("host").lower()
    return host in _EXACT_HOSTS or any(host.endswith(suffix) and len(host) > len(suffix) for suffix in _HOST_SUFFIXES)


def endpoint_origin(endpoint: str) -> str:
    """VAPID JWT 的 aud：endpoint 的 scheme://host（預設埠不寫）。呼叫前先過 endpoint_allowed。"""
    parts = urlsplit(endpoint)
    return f"{parts.scheme}://{parts.hostname}"


# ----------------------------------------------------------------------------- base64url


def b64url_decode(value: str | bytes) -> bytes:
    """base64url 解碼，有沒有 = 填充都收。格式不對丟 ValueError（不含原文）。"""
    raw = value.encode("ascii") if isinstance(value, str) else value
    raw = raw.strip().rstrip(b"=")
    if not raw or not re.fullmatch(rb"[A-Za-z0-9_\-]+", raw):
        raise ValueError("不是 base64url")
    try:
        return base64.urlsafe_b64decode(raw + b"=" * (-len(raw) % 4))
    except (binascii.Error, ValueError):
        raise ValueError("不是 base64url") from None


def b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


# ----------------------------------------------------------------------------- 金鑰


def public_key_point(value: str | bytes) -> bytes:
    """瀏覽器訂閱給的 p256dh、或設定裡的 VAPID 公鑰：未壓縮 P-256 點，而且真的在曲線上。"""
    try:
        data = b64url_decode(value)
        if len(data) != 65 or data[0] != 0x04:
            raise ValueError
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), data)
    except (ValueError, UnicodeError):
        raise ValueError("不是有效的 P-256 未壓縮公鑰（base64url）") from None
    return data


def auth_secret(value: str | bytes) -> bytes:
    """訂閱的 auth：16 bytes 的 base64url。"""
    try:
        data = b64url_decode(value)
    except (ValueError, UnicodeError):
        raise ValueError("不是有效的 auth 金鑰（base64url）") from None
    if len(data) != 16:
        raise ValueError("不是有效的 auth 金鑰（base64url）")
    return data


def load_signer(private_key: str) -> Vapid02:
    """私鑰（原始 32 bytes 的 base64url）→ 可簽 VAPID 的物件。"""
    try:
        raw = b64url_decode(private_key)
        if len(raw) != 32:
            raise ValueError
        return Vapid02.from_raw(b64url_encode(raw).encode("ascii"))
    except Exception:  # noqa: BLE001 —— 任何解析問題都換成不含金鑰的訊息
        raise ValueError("不是有效的 VAPID 私鑰（原始 32 bytes 的 base64url）") from None


def public_key_of(signer: Vapid02) -> bytes:
    return signer.public_key.public_bytes(*_UNCOMPRESSED_POINT)


def generate_key_pair() -> tuple[str, str]:
    """(公鑰, 私鑰)，格式見模組說明。"""
    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_numbers().private_value.to_bytes(32, "big")
    return b64url_encode(key.public_key().public_bytes(*_UNCOMPRESSED_POINT)), b64url_encode(private)


def valid_subject(subject: str | None) -> bool:
    """VAPID sub：mailto:信箱，或 https://主機（沒有路徑、埠、帳密、query）。形狀比照 py_vapid 簽章時的檢查，
    啟動驗證另外真的簽一次（check_configuration），這裡先擋掉明顯不合的好給清楚的訊息。"""
    if not subject:
        return False
    if subject.startswith("mailto:"):
        local, _, domain = subject[len("mailto:") :].rpartition("@")
        return bool(local) and re.fullmatch(r"[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+|localhost", domain) is not None
    return re.fullmatch(r"https://(?:localhost|[A-Za-z0-9_\-]+\.[A-Za-z0-9_.\-]+)/?", subject) is not None


def normalize_subject(subject: str) -> str:
    """py_vapid 的 https 形狀不接受結尾斜線。"""
    return subject.rstrip("/") if subject.startswith("https://") else subject


def check_configuration(public_key: str, private_key: str, subject: str | None) -> None:
    """啟動驗證：私鑰能解析、和公鑰配對、subject 合法（含真的簽一次）。不合就丟 ValueError，訊息不含金鑰。"""
    try:
        signer = load_signer(private_key)
    except ValueError:
        raise ValueError("WEBSITE_VAPID_PRIVATE_KEY 不是有效的私鑰（原始 32 bytes 的 base64url）") from None
    try:
        public = public_key_point(public_key)
    except ValueError:
        raise ValueError("WEBSITE_VAPID_PUBLIC_KEY 不是有效的 P-256 未壓縮公鑰（base64url）") from None
    if public_key_of(signer) != public:
        raise ValueError("WEBSITE_VAPID_PUBLIC_KEY 與 WEBSITE_VAPID_PRIVATE_KEY 不是同一組金鑰")
    message = (
        "手機推播需要 WEBSITE_VAPID_SUBJECT（https:// 網址或 mailto: 信箱），"
        "或設定 https 的 WEBSITE_ADMIN_ORIGIN 讓它沿用"
    )
    if not valid_subject(subject):
        raise ValueError(message)
    try:
        signer.sign({"sub": normalize_subject(subject or ""), "aud": "https://fcm.googleapis.com", "exp": int(time.time()) + 60})
    except Exception:  # noqa: BLE001 —— py_vapid 的 VapidException 與其他簽章問題
        raise ValueError(message) from None
