"""手機推播送出核心（notifications/web_push.py、vapid.py）與設定驗證（2026-11-05）。

不連真的推播服務：全部用 httpx.MockTransport；加密用 http_ece.decrypt 以測試訂閱的私鑰解回本文，
簽章用 py_vapid 驗證。"""

from __future__ import annotations

import base64
import json
import logging
import re
import time

import httpx
import pytest
from py_vapid import Vapid02
from pydantic import ValidationError
from sqlalchemy import select

from app.auth.models import Role
from app.config import Settings
from app.notifications import vapid, web_push
from app.notifications.models import PushSubscription
from tests.conftest import _create_user, _test_settings
from tests.push_helpers import (
    APPLE,
    FCM,
    PRIVATE_KEY,
    PUBLIC_KEY,
    SUBJECT,
    FakePushService,
    jwt_parts,
    new_device,
    push_settings,
)

pytestmark = pytest.mark.asyncio


async def _send(device, payload, service: FakePushService, settings=None, **kwargs):
    async with web_push.new_client(service.transport()) as client:
        return await web_push.send(device.subscription(), payload, settings=settings or push_settings(), client=client, **kwargs)


# ----------------------------------------------------------------------------- 加密與簽章


async def test_body_is_encrypted_and_decrypts_with_the_subscribers_key():
    device, service = new_device(), FakePushService()
    payload = {"title": "新的參觀預約", "body": "義華｜11/8（六）10:00", "url": "/admin/visit-requests/x", "tag": "visit-x"}
    result = await _send(device, payload, service)
    assert result == web_push.Result("ok", 201)
    [request] = service.requests
    # 本文是 aes128gcm 密文，不是明文 JSON。
    assert b"title" not in request.content and "新的參觀預約".encode() not in request.content
    assert device.decrypt(request.content) == payload


async def test_request_headers_follow_rfc_8030_and_8292():
    device, service = new_device(), FakePushService()
    await _send(device, {"title": "x"}, service, ttl=600, urgency="normal")
    [request] = service.requests
    assert str(request.url) == device.endpoint and request.method == "POST"
    assert request.headers["ttl"] == "600"
    assert request.headers["urgency"] == "normal"
    assert request.headers["content-encoding"] == "aes128gcm"
    assert request.headers["content-type"] == "application/octet-stream"
    assert int(request.headers["content-length"]) == len(request.content)


async def test_vapid_header_has_valid_signature_and_claims():
    device, service = new_device(FCM), FakePushService()
    before = int(time.time())
    await _send(device, {"title": "x"}, service)
    [request] = service.requests
    authorization = request.headers["authorization"]
    assert re.fullmatch(r"vapid t=[\w.\-]+, ?k=[\w\-]+", authorization)
    claims, signing_input, signature, key = jwt_parts(authorization)
    assert key == PUBLIC_KEY  # k＝瀏覽器訂閱時用的同一把公鑰
    assert claims["aud"] == "https://fcm.googleapis.com"  # 推播服務的 origin，不含路徑
    assert claims["sub"] == SUBJECT
    assert before + 11 * 3600 < claims["exp"] <= int(time.time()) + 12 * 3600  # 有效期接近但不超過 12 小時
    public = Vapid02.from_raw_public(PUBLIC_KEY.encode())
    assert public.verify_token(signing_input.encode(), signature)
    # 換一個內容簽出來的簽章驗不過。
    assert not public.verify_token((signing_input + "x").encode(), signature)


async def test_aud_follows_each_push_service_origin():
    service = FakePushService()
    for host, aud in ((APPLE, "https://web.push.apple.com"), ("https://updates.push.services.mozilla.com/wpush/v2/", "https://updates.push.services.mozilla.com")):
        device = new_device(host)
        await _send(device, {"title": "x"}, service)
        claims, *_ = jwt_parts(service.requests[-1].headers["authorization"])
        assert claims["aud"] == aud


async def test_subject_falls_back_to_admin_origin():
    device, service = new_device(), FakePushService()
    await _send(device, {"title": "x"}, service, settings=push_settings(vapid_subject=None))
    claims, *_ = jwt_parts(service.requests[0].headers["authorization"])
    assert claims["sub"] == "https://ivy.example"


async def test_every_message_gets_a_fresh_ecdh_key_and_salt():
    device, service = new_device(), FakePushService()
    for _ in range(3):
        await _send(device, {"title": "同一則"}, service)
    bodies = [r.content for r in service.requests]
    assert len(set(bodies)) == 3
    salts = {body[:16] for body in bodies}
    sender_keys = {body[21 : 21 + body[20]] for body in bodies}  # aes128gcm 標頭：salt(16) rs(4) idlen(1) keyid
    assert len(salts) == 3 and len(sender_keys) == 3
    assert all(len(key) == 65 and key[0] == 4 for key in sender_keys)
    assert all(device.decrypt(body) == {"title": "同一則"} for body in bodies)


async def test_a_different_device_cannot_decrypt():
    first, second, service = new_device(), new_device(), FakePushService()
    await _send(first, {"title": "x"}, service)
    with pytest.raises(Exception):
        second.decrypt(service.requests[0].content)


# ----------------------------------------------------------------------------- 結果判讀


@pytest.mark.parametrize(
    ("status", "outcome"),
    [(200, "ok"), (201, "ok"), (202, "ok"), (404, "gone"), (410, "gone"), (400, "failed"), (401, "failed"),
     (403, "failed"), (413, "failed"), (429, "failed"), (500, "failed"), (503, "failed"), (302, "failed")],
)
async def test_response_status_maps_to_outcome(status, outcome):
    device, service = new_device(), FakePushService()
    service.default_status = status
    result = await _send(device, {"title": "x"}, service)
    assert result.outcome == outcome and result.status == status


@pytest.mark.parametrize("error", [httpx.ConnectError("boom"), httpx.ReadTimeout("slow"), httpx.RemoteProtocolError("bad")])
async def test_network_errors_become_failed_results_not_exceptions(error, caplog):
    device, service = new_device(), FakePushService()
    service.raise_for[device.endpoint] = error
    caplog.set_level(logging.DEBUG)
    result = await _send(device, {"title": "x"}, service)
    assert result.outcome == "failed" and result.status is None
    # 例外訊息會帶完整網址（endpoint），log 與結果都不能有。
    assert device.endpoint not in repr(result)
    assert device.endpoint not in caplog.text


async def test_redirects_are_not_followed():
    """白名單內的服務也不能把請求導去別處（例如內網位址）。"""
    device = new_device()
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(307, headers={"location": "http://169.254.169.254/latest/meta-data/"})

    async with web_push.new_client(httpx.MockTransport(handler)) as client:
        result = await web_push.send(device.subscription(), {"title": "x"}, settings=push_settings(), client=client)
    assert result.outcome == "failed" and result.status == 307
    assert seen == [device.endpoint]


async def test_nothing_is_sent_when_push_is_not_configured():
    device, service = new_device(), FakePushService()
    disabled = _test_settings()
    result = await _send(device, {"title": "x"}, service, settings=disabled)
    assert result.outcome == "failed" and result.reason == "disabled" and service.requests == []


async def test_bad_urgency_and_oversized_payload_are_rejected_before_any_request():
    device, service = new_device(), FakePushService()
    assert (await _send(device, {"title": "x"}, service, urgency="urgent")).reason == "bad_urgency"
    assert (await _send(device, {"title": "字" * 4000}, service)).reason == "payload_too_large"
    assert (await _send(device, {"title": object()}, service)).reason == "bad_payload"
    assert service.requests == []


async def test_corrupt_subscription_keys_fail_without_leaking_key_material(caplog):
    device, service = new_device(), FakePushService()
    subscription = device.subscription()
    subscription.p256dh = "not-a-key"
    caplog.set_level(logging.DEBUG)
    async with web_push.new_client(service.transport()) as client:
        result = await web_push.send(subscription, {"title": "x"}, settings=push_settings(), client=client)
    assert result.reason == "prepare_failed" and service.requests == []
    assert PRIVATE_KEY not in caplog.text and PRIVATE_KEY not in repr(result)


# ----------------------------------------------------------------------------- endpoint 白名單（防 SSRF）


@pytest.mark.parametrize(
    "endpoint",
    [
        "https://fcm.googleapis.com/fcm/send/abc:def",
        "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
        "https://web.push.apple.com/QWERTY",
        "https://api.push.apple.com/3/device/abc",
        "https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB",
        "https://FCM.googleapis.com/fcm/send/x",
        "https://fcm.googleapis.com:443/fcm/send/x",
    ],
)
async def test_allowed_push_services(endpoint):
    assert vapid.endpoint_allowed(endpoint)


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://fcm.googleapis.com/fcm/send/x",  # 不是 https
        "https://fcm.googleapis.com:8443/fcm/send/x",  # 非預設埠
        "https://127.0.0.1/x",
        "https://localhost/x",
        "https://[::1]/x",
        "https://10.0.0.5/x",
        "https://169.254.169.254/latest/meta-data/",  # 雲端 metadata
        "https://192.168.1.1/x",
        "https://evil.example/fcm.googleapis.com",
        "https://fcm.googleapis.com.evil.example/x",  # 前綴冒充
        "https://evilfcm.googleapis.com/x",
        "https://notfcm.googleapis.com.attacker.io/x",
        "https://fcm.googleapis.com@evil.example/x",  # 帳密語法
        "https://evil.example\\@fcm.googleapis.com/x",
        "https://fcm.googleapis.com\n.evil.example/x",
        "https://fcm.googleapis.com/x y",  # 路徑含空白
        "https://push.apple.com/x",  # 萬用字元要有子網域
        "https://apple.com/x",
        "https://notify.windows.com/x",
        "https://evil-notify.windows.com.example/x",
        "https://fcm.googleapis.com",  # 沒有路徑
        "ftp://fcm.googleapis.com/x",
        "javascript:alert(1)",
        "//fcm.googleapis.com/x",
        "",
        "https://fcm.googleapis.com/" + "a" * 2000,  # 超長
    ],
)
async def test_rejected_endpoints(endpoint):
    assert not vapid.endpoint_allowed(endpoint)


@pytest.mark.parametrize(
    "endpoint", ["http://fcm.googleapis.com/x", "https://169.254.169.254/x", "https://evil.example/x", "https://localhost:8000/x"]
)
async def test_send_never_requests_a_non_whitelisted_endpoint(endpoint):
    """訂閱時驗過，但送出前再驗一次：資料庫裡就算有髒資料也不會對內網或別人的主機送請求。"""
    device, service = new_device(), FakePushService()
    subscription = device.subscription()
    subscription.endpoint = endpoint
    async with web_push.new_client(service.transport()) as client:
        result = await web_push.send(subscription, {"title": "x"}, settings=push_settings(), client=client)
    assert result.outcome == "failed" and result.reason == "endpoint_not_allowed"
    assert service.requests == []


# ----------------------------------------------------------------------------- 資料庫效果


async def _subscribed(db_session, device, email="push-user@ivy.example"):
    user = await _create_user(db_session, email, "push-user-password-123", Role.RECEPTION, ["yihua"])
    subscription = device.subscription(user_id=user.id)
    db_session.add(subscription)
    await db_session.commit()
    return user, subscription


async def _rows(db_session) -> list[PushSubscription]:
    result = await db_session.execute(select(PushSubscription).execution_options(populate_existing=True))
    return list(result.scalars())


async def test_success_updates_last_success_and_resets_failures(db_session):
    device, service = new_device(), FakePushService()
    user, subscription = await _subscribed(db_session, device)
    subscription.failure_count = 4
    await db_session.commit()
    async with web_push.new_client(service.transport()) as client:
        delivered = await web_push.send_to_users(db_session, [user], {"title": "x"}, settings=push_settings(), client=client)
    await db_session.commit()
    assert delivered == {user.id: True}
    [row] = await _rows(db_session)
    assert row.failure_count == 0 and row.last_success_at is not None and row.last_failure_at is None


@pytest.mark.parametrize("status", [404, 410])
async def test_expired_subscriptions_are_deleted(db_session, status):
    device, service = new_device(), FakePushService()
    user, _ = await _subscribed(db_session, device)
    service.default_status = status
    async with web_push.new_client(service.transport()) as client:
        delivered = await web_push.send_to_users(db_session, [user], {"title": "x"}, settings=push_settings(), client=client)
    await db_session.commit()
    assert delivered == {user.id: False}
    assert await _rows(db_session) == []


async def test_failures_are_counted_and_the_tenth_in_a_row_deletes(db_session):
    device, service = new_device(), FakePushService()
    user, _ = await _subscribed(db_session, device)
    service.default_status = 503
    async with web_push.new_client(service.transport()) as client:
        for expected in range(1, 10):
            delivered = await web_push.send_to_users(db_session, [user], {"title": "x"}, settings=push_settings(), client=client)
            await db_session.commit()
            [row] = await _rows(db_session)
            assert delivered == {user.id: False}
            assert row.failure_count == expected and row.last_failure_at is not None and row.last_success_at is None
        await web_push.send_to_users(db_session, [user], {"title": "x"}, settings=push_settings(), client=client)
        await db_session.commit()
    assert await _rows(db_session) == []  # 連續 10 次失敗


async def test_a_success_in_between_resets_the_streak(db_session):
    device, service = new_device(), FakePushService()
    user, _ = await _subscribed(db_session, device)
    async with web_push.new_client(service.transport()) as client:
        service.default_status = 503
        for _ in range(9):
            await web_push.send_to_users(db_session, [user], {"title": "x"}, settings=push_settings(), client=client)
        service.default_status = 201
        await web_push.send_to_users(db_session, [user], {"title": "x"}, settings=push_settings(), client=client)
        service.default_status = 503
        await web_push.send_to_users(db_session, [user], {"title": "x"}, settings=push_settings(), client=client)
        await db_session.commit()
    [row] = await _rows(db_session)
    assert row.failure_count == 1


async def test_send_to_users_reports_per_user_and_skips_people_without_devices(db_session):
    first, second, service = new_device(), new_device(), FakePushService()
    user_a, _ = await _subscribed(db_session, first, "a@ivy.example")
    user_b, _ = await _subscribed(db_session, second, "b@ivy.example")
    user_c = await _create_user(db_session, "c@ivy.example", "push-user-password-123", Role.RECEPTION, ["yihua"])
    service.statuses[second.endpoint] = 503
    async with web_push.new_client(service.transport()) as client:
        delivered = await web_push.send_to_users(
            db_session, [user_a, user_b, user_c], {"title": "x"}, settings=push_settings(), client=client
        )
    await db_session.commit()
    assert delivered == {user_a.id: True, user_b.id: False}  # 沒有裝置的 user_c 不在結果裡
    assert len(service.requests) == 2


async def test_one_working_device_is_enough_for_a_user(db_session):
    phone, laptop, service = new_device(), new_device(), FakePushService()
    user, _ = await _subscribed(db_session, phone)
    db_session.add(laptop.subscription(user_id=user.id))
    await db_session.commit()
    service.statuses[laptop.endpoint] = 410
    async with web_push.new_client(service.transport()) as client:
        delivered = await web_push.send_to_users(db_session, [user], {"title": "x"}, settings=push_settings(), client=client)
    await db_session.commit()
    assert delivered == {user.id: True}
    assert [row.endpoint for row in await _rows(db_session)] == [phone.endpoint]  # 失效的那台刪掉


# ----------------------------------------------------------------------------- 設定驗證


BASE = dict(
    environment="test",
    database_url="postgresql+asyncpg://localhost/ivy_website_dev",
    test_database_url="postgresql+asyncpg://localhost/ivy_website_test",
    session_secret="test-only-secret-please-rotate",
)


def _settings(**extra) -> Settings:
    return Settings(**BASE, **extra)


async def test_push_is_disabled_without_keys():
    settings = _settings()
    assert not settings.web_push_enabled and settings.vapid_public_key is None
    assert not _settings(vapid_public_key="", vapid_private_key="  ").web_push_enabled  # 空字串視同沒設


async def test_public_and_private_key_must_be_set_together():
    with pytest.raises(ValidationError, match="同時設定"):
        _settings(vapid_public_key=PUBLIC_KEY, vapid_subject=SUBJECT)
    with pytest.raises(ValidationError, match="同時設定"):
        _settings(vapid_private_key=PRIVATE_KEY, vapid_subject=SUBJECT)
    assert _settings(vapid_public_key=PUBLIC_KEY, vapid_private_key=PRIVATE_KEY, vapid_subject=SUBJECT).web_push_enabled


async def test_keys_with_surrounding_whitespace_are_accepted():
    settings = _settings(vapid_public_key=f" {PUBLIC_KEY}\n", vapid_private_key=f"{PRIVATE_KEY} ", vapid_subject=f" {SUBJECT} ")
    assert settings.vapid_public_key == PUBLIC_KEY and settings.vapid_private_key == PRIVATE_KEY


async def test_private_key_must_parse_and_pair_with_the_public_key():
    other_public, other_private = vapid.generate_key_pair()
    with pytest.raises(ValidationError, match="不是同一組金鑰"):
        _settings(vapid_public_key=other_public, vapid_private_key=PRIVATE_KEY, vapid_subject=SUBJECT)
    for bad_private in ("not-base64!!", "AAAA", PUBLIC_KEY, other_private[:-4]):
        with pytest.raises(ValidationError, match="VAPID_PRIVATE_KEY"):
            _settings(vapid_public_key=PUBLIC_KEY, vapid_private_key=bad_private, vapid_subject=SUBJECT)
    for bad_public in ("AAAA", PRIVATE_KEY, "B" + PUBLIC_KEY[1:-1] + "A"):
        with pytest.raises(ValidationError, match="VAPID_PUBLIC_KEY"):
            _settings(vapid_public_key=bad_public, vapid_private_key=PRIVATE_KEY, vapid_subject=SUBJECT)


async def test_validation_errors_never_contain_key_material():
    other_public, other_private = vapid.generate_key_pair()
    attempts = (
        dict(vapid_public_key=other_public, vapid_private_key=PRIVATE_KEY, vapid_subject=SUBJECT),
        dict(vapid_public_key=PUBLIC_KEY, vapid_private_key=other_private[:-4], vapid_subject=SUBJECT),
        dict(vapid_public_key=PUBLIC_KEY, vapid_private_key=PRIVATE_KEY, vapid_subject="http://nope"),
        dict(vapid_public_key=PUBLIC_KEY, vapid_private_key=PRIVATE_KEY),
        dict(vapid_private_key=PRIVATE_KEY),
    )
    for kwargs in attempts:
        with pytest.raises(ValidationError) as caught:
            _settings(**kwargs)
        text = str(caught.value) + repr(caught.value) + repr(caught.value.errors(include_input=False))
        for secret in (PRIVATE_KEY, other_private):
            assert secret not in text
            assert secret[:20] not in text


@pytest.mark.parametrize("subject", ["http://admin.ivy.example", "ftp://x.example", "mailto:", "mailto:nobody", "https://", "https://a.example/path?x=1", "admin.example", "https://user:pw@a.example"])
async def test_subject_must_be_https_url_or_mailto(subject):
    with pytest.raises(ValidationError, match="VAPID_SUBJECT"):
        _settings(vapid_public_key=PUBLIC_KEY, vapid_private_key=PRIVATE_KEY, vapid_subject=subject)


@pytest.mark.parametrize("subject", ["mailto:ops@ivy.example", "https://admin.ivy.example", "https://admin.ivy.example/"])
async def test_valid_subjects(subject):
    settings = _settings(vapid_public_key=PUBLIC_KEY, vapid_private_key=PRIVATE_KEY, vapid_subject=subject)
    assert settings.web_push_subject == subject.rstrip("/")


async def test_subject_defaults_to_admin_origin_and_one_of_them_is_required():
    settings = _settings(vapid_public_key=PUBLIC_KEY, vapid_private_key=PRIVATE_KEY, admin_origin="https://admin.ivy.example/")
    assert settings.web_push_subject == "https://admin.ivy.example"
    explicit = _settings(vapid_public_key=PUBLIC_KEY, vapid_private_key=PRIVATE_KEY, admin_origin="https://admin.ivy.example", vapid_subject="mailto:ops@ivy.example")
    assert explicit.web_push_subject == "mailto:ops@ivy.example"
    with pytest.raises(ValidationError, match="VAPID_SUBJECT"):
        _settings(vapid_public_key=PUBLIC_KEY, vapid_private_key=PRIVATE_KEY)  # 兩者都沒有
    with pytest.raises(ValidationError, match="VAPID_SUBJECT"):  # admin_origin 不是 https 也不能代替
        _settings(vapid_public_key=PUBLIC_KEY, vapid_private_key=PRIVATE_KEY, admin_origin="http://localhost:5173")


async def test_private_key_is_not_in_repr_or_str():
    settings = _settings(vapid_public_key=PUBLIC_KEY, vapid_private_key=PRIVATE_KEY, vapid_subject=SUBJECT)
    for text in (repr(settings), str(settings), f"{settings!r}", repr(type(settings).model_fields["vapid_private_key"])):
        assert PRIVATE_KEY not in text
    assert PUBLIC_KEY in repr(settings)  # 公鑰本來就是公開的


# ----------------------------------------------------------------------------- CLI


async def test_generate_vapid_keys_prints_three_variables_that_validate(capsys, monkeypatch):
    from app import cli

    monkeypatch.setenv("WEBSITE_ADMIN_ORIGIN", "https://admin.ivy.example/")
    cli.generate_vapid_keys_command()
    out = capsys.readouterr().out.strip().splitlines()
    assert [line.split("=", 1)[0] for line in out] == [
        "WEBSITE_VAPID_PUBLIC_KEY", "WEBSITE_VAPID_PRIVATE_KEY", "WEBSITE_VAPID_SUBJECT",
    ]
    values = dict(line.split("=", 1) for line in out)
    assert values["WEBSITE_VAPID_SUBJECT"] == "https://admin.ivy.example"
    assert len(values["WEBSITE_VAPID_PUBLIC_KEY"]) == 87 and len(values["WEBSITE_VAPID_PRIVATE_KEY"]) == 43
    assert _settings(
        vapid_public_key=values["WEBSITE_VAPID_PUBLIC_KEY"],
        vapid_private_key=values["WEBSITE_VAPID_PRIVATE_KEY"],
        vapid_subject=values["WEBSITE_VAPID_SUBJECT"],
    ).web_push_enabled


async def test_generate_vapid_keys_gives_a_different_pair_every_time(capsys, monkeypatch):
    from app import cli

    monkeypatch.delenv("WEBSITE_ADMIN_ORIGIN", raising=False)
    pairs = []
    for _ in range(2):
        cli.generate_vapid_keys_command()
        pairs.append(capsys.readouterr().out.splitlines()[:2])
    assert pairs[0] != pairs[1]


async def test_key_encoding_matches_what_browsers_and_py_vapid_expect():
    public, private = vapid.generate_key_pair()
    raw_public = base64.urlsafe_b64decode(public + "=" * (-len(public) % 4))
    assert len(raw_public) == 65 and raw_public[0] == 4  # 瀏覽器 applicationServerKey：未壓縮點
    assert len(base64.urlsafe_b64decode(private + "=" * (-len(private) % 4))) == 32  # 原始 32 bytes
    assert vapid.public_key_of(Vapid02.from_raw(private.encode())) == raw_public
    assert "=" not in public and "=" not in private and "+" not in public + private
    json.dumps({"k": public})  # 純 ASCII，可以進 JSON
