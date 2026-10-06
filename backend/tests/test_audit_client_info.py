"""2026-10-06 使用者要求：操作紀錄多記 IP 與裝置（User-Agent）。

IP 只採信官網代理帶進來的 x-website-client-ip（見 app/common/client_info.py），
沒有或不是 IP 就記 NULL；背景工作沒有請求，兩欄都是 NULL。讀取時 IP 只有
總部（audit.read_all）看得到，校區管理員的回應一律是 null，裝置照給。"""

from __future__ import annotations

from datetime import date, timedelta

import pytest
from sqlalchemy import select

from app.common import client_info
from app.operations import audit_service
from app.operations.models import AuditLogEntry

API = "/api/website/v1"
IPHONE_LINE = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Mobile/15E148 Safari Line/15.10.0"
)


async def _login_entries(db_session) -> list[AuditLogEntry]:
    result = await db_session.execute(
        select(AuditLogEntry)
        .where(AuditLogEntry.action == "user.login_password")
        .order_by(AuditLogEntry.created_at)
    )
    return list(result.scalars())


async def _login(client, headers: dict[str, str]) -> None:
    response = await client.post(
        f"{API}/auth/login",
        json={"email": "admin@ivy.example", "password": "super-admin-password-123"},
        headers=headers,
    )
    assert response.status_code == 200, response.text


@pytest.mark.asyncio
async def test_login_records_proxy_ip_and_user_agent(admin_client, db_session):
    await _login(admin_client, {"x-website-client-ip": "203.0.113.9", "user-agent": IPHONE_LINE})

    entry = (await _login_entries(db_session))[-1]
    assert entry.ip_address == "203.0.113.9"
    assert entry.user_agent == IPHONE_LINE


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("header", "expected"),
    [
        # 官網代理把 IPv6 聚合成 /64 的網段位址再帶進來。
        ("2001:db8:1:2::", "2001:db8:1:2::"),
        (" 198.51.100.7 , 10.0.0.1", "198.51.100.7"),
        ("not-an-ip", None),
        ("", None),
    ],
)
async def test_ip_comes_only_from_valid_proxy_header(admin_client, db_session, header, expected):
    await _login(admin_client, {"x-website-client-ip": header})

    assert (await _login_entries(db_session))[-1].ip_address == expected


@pytest.mark.asyncio
async def test_missing_proxy_header_records_null_not_peer(admin_client, db_session):
    # admin_client 的登入本身就沒帶 header：不能退回代理（這裡是測試 client）的位址。
    [entry] = await _login_entries(db_session)
    assert entry.ip_address is None
    assert entry.user_agent.startswith("python-httpx/")


@pytest.mark.asyncio
async def test_previous_request_does_not_leak_into_next(admin_client, db_session):
    await _login(admin_client, {"x-website-client-ip": "203.0.113.9", "user-agent": IPHONE_LINE})
    await _login(admin_client, {})

    entry = (await _login_entries(db_session))[-1]
    assert entry.ip_address is None
    assert entry.user_agent.startswith("python-httpx/")


@pytest.mark.asyncio
async def test_user_agent_is_truncated(admin_client, db_session):
    await _login(admin_client, {"user-agent": "x" * 2000})

    assert (await _login_entries(db_session))[-1].user_agent == "x" * 512


def test_user_agent_drops_control_characters():
    assert client_info.user_agent_or_none(b"Mozilla\x00/5.0\x7f (Mac)") == "Mozilla/5.0 (Mac)"
    assert client_info.user_agent_or_none(b" \x00 ") is None


@pytest.mark.asyncio
async def test_background_actions_have_no_client_info(db_session):
    entry = await audit_service.log_action(
        db_session, actor_user_id=None, action="retention.run", target_type="retention", target_id="scheduled"
    )
    assert entry.ip_address is None
    assert entry.user_agent is None


@pytest.mark.asyncio
async def test_only_headquarters_sees_ip(admin_client, minghua_client):
    created = await admin_client.post(
        f"{API}/admin/slots?campus_key=minghua",
        json={
            "slot_date": (date.today() + timedelta(days=3)).isoformat(),
            "start_time": "10:00:00",
            "end_time": "11:00:00",
            "capacity": 2,
        },
        headers={"x-website-client-ip": "203.0.113.9", "user-agent": IPHONE_LINE},
    )
    assert created.status_code == 201, created.text

    def _slot_entry(rows: list[dict]) -> dict:
        return next(row for row in rows if row["action"] == "visit_slot.create")

    headquarters = await admin_client.get(f"{API}/admin/audit-log?campus_key=minghua")
    assert headquarters.status_code == 200, headquarters.text
    entry = _slot_entry(headquarters.json())
    assert entry["ip_address"] == "203.0.113.9"
    assert entry["user_agent"] == IPHONE_LINE

    campus = await minghua_client.get(f"{API}/admin/audit-log?campus_key=minghua")
    assert campus.status_code == 200, campus.text
    entry = _slot_entry(campus.json())
    assert entry["ip_address"] is None
    assert entry["user_agent"] == IPHONE_LINE
