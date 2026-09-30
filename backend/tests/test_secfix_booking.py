"""2026-09-29 白箱稽核（booking 套件）的回歸測試：

- visit-submit-pool-starvation：公開送單握著校區設定列鎖時不得再呼叫限流器。
- slot-hoarding-no-bot-protection：Turnstile 伺服器端驗證、每來源占位上限、
  每校每小時送單上限。
- public-slots-n-plus-one-no-ratelimit：公開時段查詢一次聚合、每來源限流。
- idempotency-namespace-not-enforced：公開 Idempotency-Key 不得用保留前綴。
- payload-hash-survives-anonymization：HMAC payload hash、匿名化清掉 hash 與 key。
- sql-params-in-exception-logs：自由文字的控制字元回 422，不是 500。
- admin-booking-api-no-store-missing：CSV 匯出是附件且不可快取。
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import urllib.parse
import uuid
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import event, select, text, update
from sqlalchemy.exc import DBAPIError

from app.booking import routes as booking_routes
from app.booking import service
from app.booking.models import VisitRequest
from app.booking.schemas import VisitRequestCreate, VisitRequestManualCreate
from app.common import ratelimit
from app.common.timezones import today_local
from app.operations import retention_service
from app.operations.models import RetentionRunTrigger
from tests.conftest import set_booking_mode

pytestmark = pytest.mark.usefixtures("booking_consent")

API = "/api/website/v1"
SUBMIT = f"{API}/public/visit-requests"
CLIENT_IP_HEADER = "x-website-client-ip"


def _payload(version: int, slot_id: str, *, phone: str = "0912345678", campus_key: str = "yihua", **extra):
    """2026-09-30 起送單一定要選場次、留 Email；缺任何一個都是 422。"""
    return {
        "campus_key": campus_key,
        "config_version": version,
        "parent_name": "陳媽媽",
        "phone": phone,
        "age": None,
        "preferred_time": None,
        "questions": None,
        "consent_given": True,
        "slot_id": slot_id,
        "email": "parent@example.com",
        **extra,
    }


async def _enable(admin_client, mode: str, campus_key: str = "yihua", **config) -> int:
    response = await set_booking_mode(admin_client, campus_key, mode=mode, **config)
    assert response.status_code == 200, response.text
    return response.json()["version"]


async def _slot(admin_client, *, days_ahead: int = 3, capacity: int = 5, campus_key: str = "yihua") -> str:
    response = await admin_client.post(
        f"{API}/admin/slots?campus_key={campus_key}",
        json={
            "slot_date": (today_local() + timedelta(days=days_ahead)).isoformat(),
            "start_time": "10:00:00",
            "end_time": "11:00:00",
            "capacity": capacity,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def _open(admin_client, campus_key: str = "yihua", *, capacity: int = 50, days_ahead: int = 3) -> tuple[int, str]:
    """建一個容量夠大的場次再切到 slots；回傳（設定版本, slot_id）。每筆送單都會占位，
    要測限流的測試不能被名額先擋下。"""
    slot_id = await _slot(admin_client, days_ahead=days_ahead, capacity=capacity, campus_key=campus_key)
    return await _enable(admin_client, "slots", campus_key), slot_id


def _update_settings(app, **changes) -> None:
    app.state.settings = app.state.settings.model_copy(update=changes)


# ------------------------------------------------------------ pool starvation
class _LockProbingLimiter:
    """包住真的 RateLimiter。每次被呼叫時另開一條連線，試著 NOWAIT 鎖住該校
    的預約設定列：鎖不到代表呼叫當下有請求正握著這把列鎖（限流器又要向同一個
    連線池要第二條連線，就是稽核說的鎖／連線池互等）。"""

    def __init__(self, inner: ratelimit.RateLimiter, engine, campus_key: str) -> None:
        self._inner = inner
        self._engine = engine
        self._campus_key = campus_key
        self.calls: list[str] = []
        self.violations: list[str] = []

    async def _probe(self, name: str) -> None:
        self.calls.append(name)
        async with self._engine.connect() as conn:
            try:
                await conn.execute(
                    text("SELECT 1 FROM booking_configs WHERE campus_key = :key FOR UPDATE NOWAIT"),
                    {"key": self._campus_key},
                )
            except DBAPIError:
                self.violations.append(name)
            finally:
                await conn.rollback()

    async def check(self, limit, key):
        await self._probe(f"check:{limit.bucket}")
        return await self._inner.check(limit, key)

    async def is_limited(self, limit, key):
        await self._probe(f"is_limited:{limit.bucket}")
        return await self._inner.is_limited(limit, key)

    async def record(self, limit, key):
        await self._probe(f"record:{limit.bucket}")
        return await self._inner.record(limit, key)

    async def reset(self, limit, key):
        return await self._inner.reset(limit, key)


@pytest.mark.asyncio
async def test_public_submit_never_calls_rate_limiter_while_holding_config_lock(app, admin_client, public_client):
    version, slot_id = await _open(admin_client)
    spy = _LockProbingLimiter(app.state.rate_limiter, app.state.engine, "yihua")
    app.state.rate_limiter = spy

    created = await public_client.post(
        SUBMIT,
        json=_payload(version, slot_id),
        headers={"Idempotency-Key": "pool-slots", CLIENT_IP_HEADER: "198.51.100.20"},
    )

    assert created.status_code == 201, created.text
    # 手機桶仍然有作用（只是移到鎖外）。
    assert any("visit_submit_phone" in call for call in spy.calls), spy.calls
    assert spy.violations == [], f"握著 booking_configs 列鎖時呼叫了限流器：{spy.violations}"


# ------------------------------------------------------------ Turnstile
class _Siteverify:
    def __init__(self, *, status: int = 200, body: dict | None = None, error: Exception | None = None) -> None:
        self.status = status
        self.body = body if body is not None else {"success": True}
        self.error = error
        self.forms: list[dict[str, str]] = []
        self.urls: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.urls.append(str(request.url))
        self.forms.append({k: v[0] for k, v in urllib.parse.parse_qs(request.content.decode()).items()})
        if self.error is not None:
            raise self.error
        return httpx.Response(self.status, json=self.body)


def _enable_turnstile(app, verifier: _Siteverify) -> None:
    _update_settings(app, turnstile_site_key="site-key-test", turnstile_secret_key="secret-key-test")
    app.state.turnstile_transport = httpx.MockTransport(verifier)


@pytest.mark.asyncio
async def test_public_booking_config_exposes_turnstile_site_key_only_when_enabled(app, public_client):
    disabled = await public_client.get(f"{API}/public/booking-config/yihua")
    assert disabled.status_code == 200
    assert disabled.json()["turnstile_site_key"] is None

    _enable_turnstile(app, _Siteverify())
    enabled = await public_client.get(f"{API}/public/booking-config/yihua")
    assert enabled.json()["turnstile_site_key"] == "site-key-test"


@pytest.mark.asyncio
async def test_turnstile_required_and_verified_server_side(app, admin_client, public_client):
    version, slot_id = await _open(admin_client)
    verifier = _Siteverify()
    _enable_turnstile(app, verifier)

    missing = await public_client.post(SUBMIT, json=_payload(version, slot_id), headers={"Idempotency-Key": "ts-missing"})
    assert missing.status_code == 400, missing.text
    detail = missing.json()["detail"]
    assert (detail["code"], detail["message"]) == ("BOT_CHECK_FAILED", "請完成機器人驗證後再送出")
    assert verifier.forms == []

    ok = await public_client.post(
        SUBMIT,
        json=_payload(version, slot_id, turnstile_token="token-ok"),
        headers={"Idempotency-Key": "ts-ok", CLIENT_IP_HEADER: "203.0.113.9"},
    )
    assert ok.status_code == 201, ok.text
    assert verifier.urls == ["https://challenges.cloudflare.com/turnstile/v0/siteverify"]
    assert verifier.forms == [{"secret": "secret-key-test", "response": "token-ok", "remoteip": "203.0.113.9"}]

    # 重播（前端逾時重送）回原結果，不再驗一次（token 只能用一次）。
    replay = await public_client.post(
        SUBMIT, json=_payload(version, slot_id, turnstile_token="token-ok"), headers={"Idempotency-Key": "ts-ok"}
    )
    assert replay.status_code == 200, replay.text
    assert replay.json()["receipt_id"] == ok.json()["receipt_id"]
    replay_without_token = await public_client.post(SUBMIT, json=_payload(version, slot_id), headers={"Idempotency-Key": "ts-ok"})
    assert replay_without_token.status_code == 200, replay_without_token.text
    assert len(verifier.forms) == 1


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        ("203.0.113.9", "203.0.113.9"),
        ("203.0.113.9, 10.0.0.1", "203.0.113.9"),
        ("2001:db8:1:2:a:b:c:d", "2001:db8:1:2:a:b:c:d"),
        # 官網代理把 IPv6 聚合成 /64 網路位址：不是訪客的實際位址，不送。
        ("2001:db8:1:2::", None),
        ("not-an-ip", None),
        (None, None),
    ],
)
def test_turnstile_remoteip_skips_aggregated_ipv6(header, expected):
    from app.booking.turnstile import visitor_ip

    assert visitor_ip(header) == expected


@pytest.mark.asyncio
async def test_turnstile_rejection_is_400(app, admin_client, public_client):
    version, slot_id = await _open(admin_client)
    verifier = _Siteverify(body={"success": False, "error-codes": ["invalid-input-response"]})
    _enable_turnstile(app, verifier)

    rejected = await public_client.post(
        SUBMIT, json=_payload(version, slot_id, turnstile_token="bad"), headers={"Idempotency-Key": "ts-bad"}
    )
    assert rejected.status_code == 400, rejected.text
    assert rejected.json()["detail"]["code"] == "BOT_CHECK_FAILED"
    # 沒有 trusted header 時不送 remoteip（peer 是代理，不是訪客）。
    assert "remoteip" not in verifier.forms[0]
    count = await admin_client.get(f"{API}/admin/visit-requests?campus_key=yihua")
    assert count.json() == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "verifier",
    [
        _Siteverify(status=503, body={"success": False}),
        _Siteverify(error=httpx.ConnectTimeout("timed out")),
    ],
    ids=["http-503", "timeout"],
)
async def test_turnstile_outage_fails_open(app, admin_client, public_client, verifier, caplog):
    version, slot_id = await _open(admin_client)
    _enable_turnstile(app, verifier)

    created = await public_client.post(
        SUBMIT, json=_payload(version, slot_id, turnstile_token="whatever"), headers={"Idempotency-Key": "ts-outage"}
    )
    assert created.status_code == 201, created.text
    assert any("Turnstile" in record.getMessage() for record in caplog.records)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "verifier",
    [
        # siteverify 判定請求 malformed（例如 token 格式不對）：原本任何 4xx 都放行。
        _Siteverify(status=400, body={"success": False, "error-codes": ["bad-request"]}),
        _Siteverify(status=400, body={"success": False, "error-codes": ["invalid-input-response"]}),
        # 回應不是 JSON 物件：原本解析失敗一律放行。
        _Siteverify(status=200, body=["not", "a", "dict"]),
    ],
    ids=["http-400-bad-request", "http-400-invalid-response", "not-a-dict"],
)
async def test_turnstile_client_errors_and_malformed_answers_are_rejected(app, admin_client, public_client, verifier):
    version, slot_id = await _open(admin_client)
    _enable_turnstile(app, verifier)

    rejected = await public_client.post(
        SUBMIT, json=_payload(version, slot_id, turnstile_token="whatever"), headers={"Idempotency-Key": "ts-4xx"}
    )
    assert rejected.status_code == 400, rejected.text
    assert rejected.json()["detail"]["code"] == "BOT_CHECK_FAILED"
    assert (await admin_client.get(f"{API}/admin/visit-requests?campus_key=yihua")).json() == []


@pytest.mark.asyncio
async def test_turnstile_not_json_is_rejected(app, admin_client, public_client):
    version, slot_id = await _open(admin_client)
    _update_settings(app, turnstile_site_key="site-key-test", turnstile_secret_key="secret-key-test")
    app.state.turnstile_transport = httpx.MockTransport(lambda request: httpx.Response(200, text="<html>oops</html>"))

    rejected = await public_client.post(
        SUBMIT, json=_payload(version, slot_id, turnstile_token="whatever"), headers={"Idempotency-Key": "ts-html"}
    )
    assert rejected.status_code == 400, rejected.text
    assert rejected.json()["detail"]["code"] == "BOT_CHECK_FAILED"


@pytest.mark.asyncio
async def test_turnstile_wrong_secret_is_logged_as_error_and_fails_open(app, admin_client, public_client, caplog):
    """secret 設錯（Cloudflare 回 400 invalid-input-secret）是部署問題：不讓整站
    停收，但要記 error（部署後的驗證步驟會查這筆），不是只有一行 warning。"""
    version, slot_id = await _open(admin_client)
    _enable_turnstile(app, _Siteverify(status=400, body={"success": False, "error-codes": ["invalid-input-secret"]}))

    created = await public_client.post(
        SUBMIT, json=_payload(version, slot_id, turnstile_token="whatever"), headers={"Idempotency-Key": "ts-secret"}
    )
    assert created.status_code == 201, created.text
    errors = [r for r in caplog.records if r.levelname == "ERROR" and "Turnstile" in r.getMessage()]
    assert errors and "WEBSITE_TURNSTILE_SECRET_KEY" in errors[0].getMessage()
    assert "secret-key-test" not in caplog.text and "whatever" not in caplog.text


@pytest.mark.asyncio
async def test_turnstile_internal_error_fails_open(app, admin_client, public_client, caplog):
    version, slot_id = await _open(admin_client)
    _enable_turnstile(app, _Siteverify(status=200, body={"success": False, "error-codes": ["internal-error"]}))

    created = await public_client.post(
        SUBMIT, json=_payload(version, slot_id, turnstile_token="whatever"), headers={"Idempotency-Key": "ts-internal"}
    )
    assert created.status_code == 201, created.text
    assert any("Turnstile" in record.getMessage() for record in caplog.records)


def test_turnstile_token_length_is_bounded():
    with pytest.raises(ValueError):
        VisitRequestCreate.model_validate(_payload(1, str(uuid.uuid4()), party_size=2, turnstile_token="x" * 2049))


# ------------------------------------------------------------ caps
@pytest.mark.asyncio
async def test_slot_holds_are_capped_per_source_per_day(app, admin_client, public_client):
    _update_settings(app, booking_slot_holds_per_source_per_day=2)
    slots = [await _slot(admin_client, days_ahead=3 + i) for i in range(3)]
    version = await _enable(admin_client, "slots")
    source = {CLIENT_IP_HEADER: "203.0.113.50"}

    codes = []
    responses = []
    for i, slot_id in enumerate(slots):
        response = await public_client.post(
            SUBMIT,
            json=_payload(version, slot_id, phone=f"091234560{i}"),
            headers={"Idempotency-Key": f"hold-{i}", **source},
        )
        codes.append(response.status_code)
        responses.append(response)
    assert codes == [201, 201, 429], [r.text for r in responses]
    limited = responses[-1]
    assert limited.json()["detail"]["code"] == "BOOKING_LIMIT"
    assert int(limited.headers["Retry-After"]) > 0

    # 重播不算新占位，照常回原結果。
    replay = await public_client.post(
        SUBMIT,
        json=_payload(version, slots[0], phone="0912345600"),
        headers={"Idempotency-Key": "hold-0", **source},
    )
    assert replay.status_code == 200, replay.text

    # 上限是每個來源各自計算。
    other = await public_client.post(
        SUBMIT,
        json=_payload(version, slots[2], phone="0912345602"),
        headers={"Idempotency-Key": "hold-other", CLIENT_IP_HEADER: "198.51.100.77"},
    )
    assert other.status_code == 201, other.text


@pytest.mark.asyncio
async def test_public_submissions_are_capped_per_campus_per_hour(app, admin_client, public_client):
    _update_settings(app, booking_submissions_per_campus_per_hour=2)
    version, slot_id = await _open(admin_client)

    # 版本過期的送單在預檢就被擋，不吃上限。
    stale = await public_client.post(
        SUBMIT, json=_payload(version - 1, slot_id), headers={"Idempotency-Key": "campus-stale"}
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "BOOKING_CONFIG_CHANGED"

    codes = []
    for i in range(3):
        response = await public_client.post(
            SUBMIT,
            json=_payload(version, slot_id, phone=f"091234562{i}"),
            headers={"Idempotency-Key": f"campus-{i}", CLIENT_IP_HEADER: f"203.0.113.{60 + i}"},
        )
        codes.append(response)
    assert [r.status_code for r in codes] == [201, 201, 429], [r.text for r in codes]
    assert codes[-1].json()["detail"]["code"] == "BOOKING_LIMIT"
    assert int(codes[-1].headers["Retry-After"]) > 0

    replay = await public_client.post(
        SUBMIT, json=_payload(version, slot_id, phone="0912345620"), headers={"Idempotency-Key": "campus-0"}
    )
    assert replay.status_code == 200, replay.text

    other_version, other_slot = await _open(admin_client, "minghua")
    other = await public_client.post(
        SUBMIT,
        json=_payload(other_version, other_slot, phone="0912345629", campus_key="minghua"),
        headers={"Idempotency-Key": "campus-other"},
    )
    assert other.status_code == 201, other.text


@pytest.mark.asyncio
async def test_single_source_cannot_use_up_the_campus_cap(app, admin_client, public_client):
    """稽核 campus-cap-single-source-dos：一個匿名 IP 換手機號碼就能送滿每校每小時
    上限、讓整校家長都收到 429。現在同一來源對同一校每小時最多 5 筆，其他來源照常送。
    每筆送單都占位，所以把「每來源每日占位上限」調高，讓這裡驗的是每小時那條。"""
    _update_settings(app, booking_slot_holds_per_source_per_day=100)
    version, slot_id = await _open(admin_client)
    source = {CLIENT_IP_HEADER: "203.0.113.70"}
    codes = []
    for i in range(6):
        response = await public_client.post(
            SUBMIT,
            json=_payload(version, slot_id, phone=f"091234570{i}"),
            headers={"Idempotency-Key": f"src-campus-{i}", **source},
        )
        codes.append(response)
    assert [r.status_code for r in codes] == [201] * 5 + [429], [r.text for r in codes]
    assert codes[-1].json()["detail"]["code"] == "BOOKING_LIMIT"
    assert int(codes[-1].headers["Retry-After"]) > 0

    # 同一個 IPv6 /64 換位址不算新來源。
    ipv6 = [
        await public_client.post(
            SUBMIT,
            json=_payload(version, slot_id, phone=f"091234571{i}"),
            headers={"Idempotency-Key": f"src-v6-{i}", CLIENT_IP_HEADER: f"2001:db8:5:6::{i + 1}"},
        )
        for i in range(6)
    ]
    assert [r.status_code for r in ipv6] == [201] * 5 + [429], [r.text for r in ipv6]

    # 別的來源、同一來源對別的校區，都不受影響。
    other = await public_client.post(
        SUBMIT,
        json=_payload(version, slot_id, phone="0912345720"),
        headers={"Idempotency-Key": "src-other", CLIENT_IP_HEADER: "198.51.100.71"},
    )
    assert other.status_code == 201, other.text
    other_version, other_slot = await _open(admin_client, "minghua")
    other_campus = await public_client.post(
        SUBMIT,
        json=_payload(other_version, other_slot, phone="0912345721", campus_key="minghua"),
        headers={"Idempotency-Key": "src-other-campus", **source},
    )
    assert other_campus.status_code == 201, other_campus.text


@pytest.mark.asyncio
async def test_phone_bucket_holds_under_concurrent_submissions(app, admin_client, public_client):
    """稽核 phone-bucket-lost-atomicity：手機桶「先只看、commit 後才記」，同一支手機
    併發送單原本可以一起越過每 10 分鐘 5 筆。現在在校區設定列鎖內（同一校的送單
    在這裡排隊）核對這支手機近 10 分鐘建立的筆數；同一把 key 的併發重送仍然拿回
    同一張收據（見 test_booking_concurrency）。"""
    version, slot_id = await _open(admin_client)
    responses = await asyncio.gather(*[
        public_client.post(SUBMIT, json=_payload(version, slot_id, phone="0912345730"), headers={"Idempotency-Key": f"phone-{i}"})
        for i in range(8)
    ])
    codes = sorted(r.status_code for r in responses)
    assert codes == [201] * 5 + [429] * 3, [r.text for r in responses]
    limited = [r for r in responses if r.status_code == 429]
    assert all(r.json()["detail"]["code"] == "RATE_LIMITED" for r in limited)
    listed = await admin_client.get(f"{API}/admin/visit-requests?campus_key=yihua")
    assert len(listed.json()) == 5

    # 冪等重播在限流之前就回原結果，不吃額度也不會被擋。
    created = next(r for r in responses if r.status_code == 201)
    replay_key = f"phone-{responses.index(created)}"
    replay = await public_client.post(SUBMIT, json=_payload(version, slot_id, phone="0912345730"), headers={"Idempotency-Key": replay_key})
    assert replay.status_code == 200, replay.text


@pytest.mark.asyncio
async def test_concurrent_retry_of_the_last_allowed_submission_is_a_replay(app, admin_client, public_client):
    """同一支手機已經 4 筆，第 5 筆的同一把 key 併發重送：一個建立，其餘拿回同一張
    收據，不能因為鎖內核對時已經 5 筆就回 429。"""
    version, slot_id = await _open(admin_client)
    for i in range(4):
        response = await public_client.post(
            SUBMIT, json=_payload(version, slot_id, phone="0912345740"), headers={"Idempotency-Key": f"last-{i}"}
        )
        assert response.status_code == 201, response.text
    responses = await asyncio.gather(*[
        public_client.post(SUBMIT, json=_payload(version, slot_id, phone="0912345740"), headers={"Idempotency-Key": "last-final"})
        for _ in range(4)
    ])
    assert sorted(r.status_code for r in responses) == [200, 200, 200, 201], [r.text for r in responses]
    assert len({r.json()["receipt_id"] for r in responses}) == 1


@pytest.mark.asyncio
async def test_retry_that_missed_the_first_replay_lookup_is_not_rate_limited(
    app, admin_client, public_client, monkeypatch
):
    """上面那個併發情境的確定性版本（CI run 36562527040 曾撞到）：重送做第一次
    不上鎖的重播查詢時，另一個請求還沒 commit；等它走到手機桶預檢，那筆已經建立、
    手機額度也記滿了。擋下前要再查一次重播，回原收據（200），不是 429。"""
    version, slot_id = await _open(admin_client)
    for i in range(4):
        response = await public_client.post(
            SUBMIT, json=_payload(version, slot_id, phone="0912345741"), headers={"Idempotency-Key": f"miss-{i}"}
        )
        assert response.status_code == 201, response.text
    created = await public_client.post(
        SUBMIT, json=_payload(version, slot_id, phone="0912345741"), headers={"Idempotency-Key": "miss-final"}
    )
    assert created.status_code == 201, created.text

    real_find_replay = service.find_replay
    calls = 0

    async def first_lookup_misses(*args, **kwargs):
        nonlocal calls
        calls += 1
        return None if calls == 1 else await real_find_replay(*args, **kwargs)

    monkeypatch.setattr(service, "find_replay", first_lookup_misses)
    retry = await public_client.post(
        SUBMIT, json=_payload(version, slot_id, phone="0912345741"), headers={"Idempotency-Key": "miss-final"}
    )
    assert retry.status_code == 200, retry.text
    assert retry.json()["receipt_id"] == created.json()["receipt_id"]


# ------------------------------------------------------------ public slots
@pytest.mark.asyncio
async def test_public_slots_uses_constant_number_of_queries(app, admin_client, public_client):
    # 先建場次再切 slots：沒有場次時 set_booking_mode 會補每週規則，A7 起存規則就會立刻補出一堆場次。
    await _slot(admin_client, days_ahead=3)
    await _enable(admin_client, "slots")
    date_from = today_local().isoformat()
    date_to = (today_local() + timedelta(days=30)).isoformat()
    url = f"{API}/public/slots?campus_key=yihua&date_from={date_from}&date_to={date_to}"

    statements: list[str] = []

    def _count(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(app.state.engine.sync_engine, "before_cursor_execute", _count)
    try:
        one = await public_client.get(url)
        with_one = len(statements)
        for i in range(5):
            await _slot(admin_client, days_ahead=4 + i)
        statements.clear()
        many = await public_client.get(url)
        with_many = len(statements)
    finally:
        event.remove(app.state.engine.sync_engine, "before_cursor_execute", _count)

    assert one.status_code == 200 and len(one.json()) == 1
    assert many.status_code == 200 and len(many.json()) == 6
    assert with_many == with_one, (with_one, with_many)


@pytest.mark.asyncio
async def test_public_slots_remaining_counts_occupying_requests(admin_client, public_client):
    busy = await _slot(admin_client, days_ahead=3, capacity=2)
    full = await _slot(admin_client, days_ahead=4, capacity=1)
    await _slot(admin_client, days_ahead=5, capacity=3)
    version = await _enable(admin_client, "slots")
    for key, slot_id, phone in (("rem-1", busy, "0912345631"), ("rem-2", full, "0912345632")):
        created = await public_client.post(
            SUBMIT, json=_payload(version, slot_id, phone=phone), headers={"Idempotency-Key": key}
        )
        assert created.status_code == 201, created.text
    date_from = today_local().isoformat()
    date_to = (today_local() + timedelta(days=30)).isoformat()
    listed = await public_client.get(f"{API}/public/slots?campus_key=yihua&date_from={date_from}&date_to={date_to}")
    assert [slot["remaining"] for slot in listed.json()] == [1, 3]


@pytest.mark.asyncio
async def test_public_slots_is_rate_limited_per_source(admin_client, public_client, monkeypatch):
    monkeypatch.setattr(booking_routes, "PUBLIC_SLOTS_LIMIT", ratelimit.Limit("public_slots_test", 60, 2))
    date_from = today_local().isoformat()
    url = f"{API}/public/slots?campus_key=yihua&date_from={date_from}&date_to={date_from}"
    source = {CLIENT_IP_HEADER: "203.0.113.70"}
    codes = [(await public_client.get(url, headers=source)).status_code for _ in range(3)]
    assert codes == [200, 200, 429]
    limited = await public_client.get(url, headers=source)
    assert limited.json()["detail"]["code"] == "RATE_LIMITED"
    assert int(limited.headers["Retry-After"]) > 0
    other = await public_client.get(url, headers={CLIENT_IP_HEADER: "203.0.113.71"})
    assert other.status_code == 200


# ------------------------------------------------------------ idempotency namespace
@pytest.mark.asyncio
@pytest.mark.parametrize("key", ["admin:3f1c7e0a-manual", "anonymized:0d2c"])
async def test_public_idempotency_key_cannot_use_reserved_prefix(admin_client, public_client, key):
    version, slot_id = await _open(admin_client)
    response = await public_client.post(SUBMIT, json=_payload(version, slot_id), headers={"Idempotency-Key": key})
    assert response.status_code == 422, response.text
    assert response.json()["detail"][0]["loc"] == ["header", "Idempotency-Key"]
    listed = await admin_client.get(f"{API}/admin/visit-requests?campus_key=yihua")
    assert listed.json() == []


# ------------------------------------------------------------ payload hash
def _body(payload: dict) -> dict:
    return VisitRequestCreate.model_validate(payload).model_dump(
        mode="json", exclude={"campus_key", "config_version", "consent_revision_id", "turnstile_token"}
    )


def _plain_sha256(body: dict) -> str:
    return hashlib.sha256(json.dumps(body, sort_keys=True, ensure_ascii=True).encode("utf-8")).hexdigest()


@pytest.mark.asyncio
async def test_new_payload_hash_is_keyed_and_legacy_hash_still_replays(app, admin_client, public_client, db_session):
    version, slot_id = await _open(admin_client)
    # 這裡直接用 payload 重算 hash：body 要跟送出去的一模一樣（含 slot_id、email）。
    payload = _payload(version, slot_id, party_size=2)
    created = await public_client.post(SUBMIT, json=payload, headers={"Idempotency-Key": "hash-keyed"})
    assert created.status_code == 201, created.text
    stored = await db_session.get(VisitRequest, uuid.UUID(created.json()["receipt_id"]))

    body = _body(payload)
    assert stored.payload_hash != service._legacy_payload_hash(body)
    assert stored.payload_hash != _plain_sha256(body)
    key = service.payload_hash_key(app.state.settings.session_secret)
    assert stored.payload_hash == service._payload_hash(body, key)
    # 金鑰跟 session secret 分開（專用用途衍生）。
    assert key != app.state.settings.session_secret.encode("utf-8")

    replay = await public_client.post(SUBMIT, json=payload, headers={"Idempotency-Key": "hash-keyed"})
    assert replay.status_code == 200, replay.text

    # 部署前建立的案件存的是裸 SHA-256：部署當下的重送仍要認得。
    stored.payload_hash = service._legacy_payload_hash(body)
    await db_session.commit()
    legacy = await public_client.post(SUBMIT, json=payload, headers={"Idempotency-Key": "hash-keyed"})
    assert legacy.status_code == 200, legacy.text
    changed = await public_client.post(
        SUBMIT, json={**payload, "parent_name": "林媽媽"}, headers={"Idempotency-Key": "hash-keyed"}
    )
    assert changed.status_code == 409
    assert changed.json()["detail"]["code"] == "IDEMPOTENCY_CONFLICT"


@pytest.mark.asyncio
async def test_manual_create_hash_is_keyed(admin_client, db_session):
    slot_id = await _slot(admin_client)
    body = {
        "campus_key": "yihua", "source": "phone", "parent_name": "王媽媽", "phone": "0912345640",
        "consent_given": True, "slot_id": slot_id,
    }
    created = await admin_client.post(f"{API}/admin/visit-requests", json=body, headers={"Idempotency-Key": "manual-hash"})
    assert created.status_code == 201, created.text
    stored = await db_session.get(VisitRequest, uuid.UUID(created.json()["id"]))
    assert stored.idempotency_key == "admin:manual-hash"
    dumped = VisitRequestManualCreate.model_validate(body).model_dump(mode="json", exclude={"campus_key"})
    assert stored.payload_hash != service._legacy_payload_hash(dumped)

    replay = await admin_client.post(f"{API}/admin/visit-requests", json=body, headers={"Idempotency-Key": "manual-hash"})
    assert replay.status_code == 200, replay.text
    assert replay.json()["id"] == created.json()["id"]


@pytest.mark.asyncio
async def test_anonymize_scrubs_payload_hash_and_idempotency_key(admin_client, public_client, db_session):
    version, slot_id = await _open(admin_client)
    created = await public_client.post(SUBMIT, json=_payload(version, slot_id), headers={"Idempotency-Key": "anon-scrub"})
    assert created.status_code == 201, created.text
    case_id = uuid.UUID(created.json()["receipt_id"])
    visit = await db_session.get(VisitRequest, case_id)
    original_hash = visit.payload_hash

    await retention_service.anonymize(db_session, visit)
    await db_session.commit()

    refreshed = (
        await db_session.execute(
            select(VisitRequest).where(VisitRequest.id == case_id).execution_options(populate_existing=True)
        )
    ).scalar_one()
    assert refreshed.payload_hash != original_hash
    assert len(refreshed.payload_hash) == 64
    assert refreshed.idempotency_key == f"anonymized:{case_id}"


@pytest.mark.asyncio
async def test_sweep_scrubs_rows_anonymized_before_the_fix(admin_client, public_client, db_session):
    version, slot_id = await _open(admin_client)
    created = await public_client.post(SUBMIT, json=_payload(version, slot_id), headers={"Idempotency-Key": "anon-legacy"})
    assert created.status_code == 201, created.text
    case_id = uuid.UUID(created.json()["receipt_id"])
    visit = await db_session.get(VisitRequest, case_id)
    original_hash = visit.payload_hash
    # 模擬舊版匿名化：個資清了、anonymized_at 有值，但 hash 與 key 還在。
    await db_session.execute(
        update(VisitRequest)
        .where(VisitRequest.id == case_id)
        .values(anonymized_at=datetime.now(timezone.utc), parent_name=retention_service.ANONYMIZED_NOTE)
    )
    await db_session.commit()

    days = {"cancelled_days": 365, "completed_days": 365, "open_overdue_days": 365}
    await retention_service.run_sweep(db_session, days, trigger=RetentionRunTrigger.MANUAL)
    await db_session.commit()
    first = (
        await db_session.execute(
            select(VisitRequest.payload_hash, VisitRequest.idempotency_key).where(VisitRequest.id == case_id)
        )
    ).one()
    assert first.payload_hash != original_hash
    assert len(first.payload_hash) == 64
    assert first.idempotency_key == f"anonymized:{case_id}"

    # 冪等：已清過的不再改。
    await retention_service.run_sweep(db_session, days, trigger=RetentionRunTrigger.MANUAL)
    await db_session.commit()
    second = (
        await db_session.execute(
            select(VisitRequest.payload_hash, VisitRequest.idempotency_key).where(VisitRequest.id == case_id)
        )
    ).one()
    assert tuple(second) == tuple(first)


# ------------------------------------------------------------ control characters
@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("parent_name", "王\x00媽媽"),
        ("questions", "想問\x07課程"),
        ("child_name", "小\x1b樹"),
        ("campus_key", "yi\x00hua"),
        ("parent_name", "王\x7f媽媽"),
    ],
)
async def test_public_submit_rejects_control_characters_with_422(admin_client, public_client, field, value):
    version, slot_id = await _open(admin_client)
    body = {**_payload(version, slot_id), field: value}
    if field == "campus_key":
        # 測試用家長 client 會拿 campus_key 組網址去讀同意版本；自己帶，免得 httpx 先擋掉網址。
        body["consent_revision_id"] = None
    response = await public_client.post(SUBMIT, json=body, headers={"Idempotency-Key": f"ctrl-{field}"})
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_public_submit_keeps_newlines_and_tabs(admin_client, public_client):
    version, slot_id = await _open(admin_client)
    response = await public_client.post(
        SUBMIT,
        json={**_payload(version, slot_id), "questions": "第一行\r\n第二行\t補充"},
        headers={"Idempotency-Key": "ctrl-newline"},
    )
    assert response.status_code == 201, response.text


@pytest.mark.asyncio
async def test_manual_note_rejects_control_characters(admin_client):
    slot_id = await _slot(admin_client)
    response = await admin_client.post(
        f"{API}/admin/visit-requests",
        json={
            "campus_key": "yihua", "source": "phone", "parent_name": "王媽媽",
            "phone": "0912345641", "consent_given": True, "note": "來電\x00", "slot_id": slot_id,
        },
        headers={"Idempotency-Key": "manual-ctrl"},
    )
    assert response.status_code == 422, response.text


@pytest.mark.asyncio
async def test_public_reads_with_control_character_campus_key_are_not_500(public_client):
    config = await public_client.get(f"{API}/public/booking-config/yi%00hua")
    assert config.status_code == 404, config.text
    today = today_local().isoformat()
    slots = await public_client.get(
        f"{API}/public/slots", params={"campus_key": "yi\x00hua", "date_from": today, "date_to": today}
    )
    assert slots.status_code == 200, slots.text
    assert slots.json() == []


# ------------------------------------------------------------ export headers
@pytest.mark.asyncio
async def test_export_is_an_uncacheable_attachment(admin_client):
    response = await admin_client.get(f"{API}/admin/visit-requests/export?campus_key=yihua")
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "private, no-store"
    disposition = response.headers["content-disposition"]
    assert disposition.startswith("attachment;"), disposition
    assert 'filename="visit-requests-yihua-' in disposition and disposition.endswith('.csv"')


@pytest.mark.asyncio
async def test_export_filename_ignores_unsafe_campus_filter(admin_client):
    response = await admin_client.get(f"{API}/admin/visit-requests/export", params={"campus_key": 'x"; y'})
    assert response.status_code in (200, 403), response.text
    if response.status_code == 200:
        assert '"; y' not in response.headers["content-disposition"]
