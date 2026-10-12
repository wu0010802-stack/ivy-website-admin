"""2026-10-12 總部統一管理的聯絡片語（規格 4.2）。

- 全站只有一份（contact_phrase_sets 固定一列 key='default'），預設 6 句。
- GET：有 booking.read 或 admissions.read 的角色都能讀（對應 contact_phrases.read）。
- PUT：只有總管理者（contact_phrases.manage），版本不符 409，稽核 contact_phrases.update。
- conftest 每個測試前會清空資料表，migration 插入的預設列不會在，所以讀不到列時要回
  程式內建的預設；寫入時列不存在要自己建立。"""
from __future__ import annotations

import asyncio
import importlib.util
from pathlib import Path

import pytest
from sqlalchemy import select

from app.auth.models import Role
from app.auth.permissions import effective_capabilities, roles_with
from app.contact_phrases import service
from app.contact_phrases.models import ContactPhraseSet
from app.operations.models import AuditLogEntry
from tests.conftest import _create_user, _logged_in_client

URL = "/api/website/v1/admin/contact-phrases"
_MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations" / "versions"

# 規格 4.2 的預設片語，一字不差。
SPEC_DEFAULTS = [
    "已致電，家長沒接",
    "已致電，轉語音信箱",
    "已加 LINE，等家長回覆",
    "家長考慮中，約好再聯絡",
    "家長已決定就讀",
    "家長暫不考慮",
]


def _migration():
    [path] = list(_MIGRATIONS.glob("*_contact_phrase_sets.py"))
    spec = importlib.util.spec_from_file_location("contact_phrase_sets_migration", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


async def _client_for(app, db_session, role: Role, email: str, campus_keys: list[str] | None = None):
    password = f"{role.value}-password-123"
    await _create_user(db_session, email, password, role, campus_keys)
    return await _logged_in_client(app, email, password)


async def _row(db_session) -> ContactPhraseSet | None:
    db_session.expire_all()
    return (await db_session.execute(select(ContactPhraseSet))).scalar_one_or_none()


async def _put(client, phrases, expected_version=1):
    return await client.put(URL, json={"phrases": phrases, "expected_version": expected_version})


# ------------------------------------------------------------------ 預設片語


def test_builtin_defaults_match_spec_text():
    assert list(service.DEFAULT_PHRASES) == SPEC_DEFAULTS


def test_migration_default_text_is_the_same_as_the_module_constant():
    # migration 不 import 應用程式（日後改常數不會悄悄改到已經跑過的 migration），
    # 所以兩邊各寫一份，這裡比對它們沒有漂移。
    assert list(_migration().DEFAULT_PHRASES) == list(service.DEFAULT_PHRASES) == SPEC_DEFAULTS


@pytest.mark.asyncio
async def test_migration_seed_inserts_default_row_once(app, db_session):
    migration = _migration()
    async with app.state.engine.begin() as conn:
        await conn.run_sync(migration._seed_default)
        # 重跑（例如部署重疊）不報錯、不重複。
        await conn.run_sync(migration._seed_default)
    row = await _row(db_session)
    assert row is not None
    assert row.key == "default"
    assert row.phrases == SPEC_DEFAULTS
    assert row.version == 1
    assert row.updated_at is None
    assert row.updated_by is None


@pytest.mark.asyncio
async def test_get_returns_builtin_defaults_when_the_row_is_missing(admin_client, db_session):
    assert await _row(db_session) is None
    response = await admin_client.get(URL)
    assert response.status_code == 200, response.text
    assert response.json() == {"phrases": SPEC_DEFAULTS, "version": 1, "updated_at": None, "updated_by_name": None}
    # 讀不會順手建立列。
    assert await _row(db_session) is None


@pytest.mark.asyncio
async def test_get_returns_the_stored_row_when_it_exists(admin_client, db_session):
    db_session.add(ContactPhraseSet(key="default", phrases=["只有一句"], version=5))
    await db_session.commit()
    body = (await admin_client.get(URL)).json()
    assert body["phrases"] == ["只有一句"]
    assert body["version"] == 5


# ------------------------------------------------------------------ 寫入


@pytest.mark.asyncio
async def test_put_creates_the_row_when_it_does_not_exist(admin_client, db_session):
    assert await _row(db_session) is None
    response = await _put(admin_client, ["第一句", "第二句"])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["phrases"] == ["第一句", "第二句"]
    assert body["version"] == 2
    assert body["updated_at"] is not None
    row = await _row(db_session)
    assert row is not None and row.phrases == ["第一句", "第二句"] and row.version == 2
    assert (await admin_client.get(URL)).json() == body


@pytest.mark.asyncio
async def test_put_updates_an_existing_row_and_names_the_editor(admin_client, db_session):
    db_session.add(ContactPhraseSet(key="default", phrases=list(SPEC_DEFAULTS), version=1))
    await db_session.commit()
    response = await _put(admin_client, ["已致電"], expected_version=1)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["version"] == 2
    # 沒設顯示名稱的帳號用 Email。
    assert body["updated_by_name"] == "admin@ivy.example"
    row = await _row(db_session)
    assert row.phrases == ["已致電"]
    assert row.updated_by is not None


@pytest.mark.asyncio
async def test_updated_by_name_prefers_the_display_name(app, db_session):
    user = await _create_user(db_session, "named@ivy.example", "super_admin-password-123", Role.SUPER_ADMIN)
    user.display_name = "王主任"
    await db_session.commit()
    client = await _logged_in_client(app, "named@ivy.example", "super_admin-password-123")
    try:
        body = (await _put(client, ["a"])).json()
        assert body["updated_by_name"] == "王主任"
        assert (await client.get(URL)).json()["updated_by_name"] == "王主任"
    finally:
        await client.aclose()


@pytest.mark.asyncio
async def test_put_strips_each_phrase_and_keeps_order(admin_client):
    response = await _put(admin_client, ["  已致電  ", "　家長考慮中　", "最後一句\n"])
    assert response.status_code == 200, response.text
    assert response.json()["phrases"] == ["已致電", "家長考慮中", "最後一句"]


@pytest.mark.asyncio
async def test_put_accepts_the_limits(admin_client):
    phrases = [f"{index:02d}" + "字" * 58 for index in range(20)]
    assert all(len(phrase) == 60 for phrase in phrases)
    response = await _put(admin_client, phrases)
    assert response.status_code == 200, response.text
    assert response.json()["phrases"] == phrases


@pytest.mark.asyncio
async def test_put_can_clear_every_phrase(admin_client):
    response = await _put(admin_client, [])
    assert response.status_code == 200, response.text
    assert response.json()["phrases"] == []
    assert (await admin_client.get(URL)).json()["phrases"] == []


@pytest.mark.asyncio
async def test_put_writes_an_audit_entry_with_only_the_count(admin_client, db_session):
    response = await _put(admin_client, ["保密的片語內容", "第二句"])
    assert response.status_code == 200, response.text
    entries = (
        await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "contact_phrases.update"))
    ).scalars().all()
    assert len(entries) == 1
    entry = entries[0]
    assert entry.metadata_json == {"count": 2}
    assert entry.target_type == "contact_phrases"
    assert entry.target_id == "default"
    assert entry.campus_key is None
    assert entry.actor_user_id is not None


@pytest.mark.asyncio
async def test_stale_version_is_a_409_and_writes_nothing(admin_client, db_session):
    assert (await _put(admin_client, ["先存的"], expected_version=1)).status_code == 200
    stale = await _put(admin_client, ["後送的"], expected_version=1)
    assert stale.status_code == 409
    detail = stale.json()["detail"]
    assert detail["code"] == "CONTACT_PHRASES_VERSION_CONFLICT"
    assert detail["current_version"] == 2
    row = await _row(db_session)
    assert row.phrases == ["先存的"] and row.version == 2
    entries = (
        await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "contact_phrases.update"))
    ).scalars().all()
    assert len(entries) == 1


@pytest.mark.asyncio
async def test_future_version_is_also_a_409(admin_client):
    response = await _put(admin_client, ["a"], expected_version=7)
    assert response.status_code == 409
    assert response.json()["detail"]["current_version"] == 1


@pytest.mark.asyncio
async def test_two_saves_at_the_same_time_on_a_missing_row_let_only_one_win(admin_client, db_session):
    assert await _row(db_session) is None
    first, second = await asyncio.gather(
        _put(admin_client, ["甲"], expected_version=1), _put(admin_client, ["乙"], expected_version=1)
    )
    assert sorted([first.status_code, second.status_code]) == [200, 409]
    row = await _row(db_session)
    assert row.version == 2
    assert row.phrases in (["甲"], ["乙"])


# ------------------------------------------------------------------ 權限


@pytest.mark.asyncio
async def test_only_the_super_admin_can_save(app, db_session, minghua_client):
    reception = await _client_for(app, db_session, Role.RECEPTION, "desk@ivy.example", ["yihua"])
    try:
        for client in (minghua_client, reception):
            response = await _put(client, ["不會存"])
            assert response.status_code == 403
        assert await _row(db_session) is None
    finally:
        await reception.aclose()


@pytest.mark.asyncio
async def test_roles_that_see_cases_can_read_the_phrases(app, db_session, admin_client, minghua_client):
    reception = await _client_for(app, db_session, Role.RECEPTION, "desk@ivy.example", ["yihua"])
    try:
        for client in (admin_client, minghua_client, reception):
            response = await client.get(URL)
            assert response.status_code == 200, response.text
            assert response.json()["phrases"] == SPEC_DEFAULTS
    finally:
        await reception.aclose()


@pytest.mark.asyncio
async def test_roles_without_case_access_cannot_read_the_phrases(app, db_session, editor_client):
    readonly = await _client_for(app, db_session, Role.READONLY, "viewer@ivy.example", ["yihua"])
    try:
        for client in (editor_client, readonly):
            assert (await client.get(URL)).status_code == 403
    finally:
        await readonly.aclose()


@pytest.mark.asyncio
async def test_anonymous_requests_are_rejected(public_client):
    assert (await public_client.get(URL)).status_code == 401
    assert (await public_client.put(URL, json={"phrases": [], "expected_version": 1})).status_code in (401, 403)


def test_capability_table_matches_the_spec():
    from app.auth.models import User

    assert roles_with("contact_phrases.manage") == {Role.SUPER_ADMIN}
    # 讀取＝看得到預約案件或招生訪視的角色；兩邊的角色表改了，這裡要一起跟上。
    assert roles_with("contact_phrases.read") == roles_with("booking.read") | roles_with("admissions.read")
    desk = User(role=Role.RECEPTION, capabilities=[])
    caps = set(effective_capabilities(desk))
    assert "contact_phrases.read" in caps
    assert "contact_phrases.manage" not in caps


# ------------------------------------------------------------------ 驗證


async def _assert_rejected(admin_client, db_session, phrases, *, loc_index: int | None):
    response = await _put(admin_client, phrases)
    assert response.status_code == 422, response.text
    locs = [error["loc"] for error in response.json()["detail"]]
    if loc_index is None:
        assert ["body", "phrases"] in locs, locs
    else:
        assert ["body", "phrases", loc_index] in locs, locs
    # 沒寫入、沒留稽核。
    assert await _row(db_session) is None
    assert not (
        await db_session.execute(select(AuditLogEntry).where(AuditLogEntry.action == "contact_phrases.update"))
    ).scalars().all()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "phrases, loc_index",
    [
        pytest.param(["有字", ""], 1, id="empty"),
        pytest.param(["有字", "   　 "], 1, id="blank-after-strip"),
        pytest.param(["有字", "字" * 61], 1, id="61-chars"),
        pytest.param(["有字", "字" * 59 + " 字"], 1, id="61-chars-with-inner-space"),
        pytest.param(["有字", "前面\n後面"], 1, id="newline"),
        pytest.param(["有字", "前面\r\n後面"], 1, id="crlf"),
        pytest.param(["有字", "前面\t後面"], 1, id="tab"),
        pytest.param(["有字", "含\x00空字元"], 1, id="nul"),
        pytest.param(["有字", "含\x1b跳脫"], 1, id="escape"),
        pytest.param(["有字", "含 分行符"], 1, id="line-separator"),
        pytest.param(["有字", "含​零寬空白"], 1, id="zero-width"),
        pytest.param(["有字", "javascript:alert(1)"], 1, id="javascript"),
        pytest.param(["有字", "JaVaScRiPt:alert(1)"], 1, id="javascript-mixed-case"),
        pytest.param(["有字", "請點 javascript:void(0)"], 1, id="javascript-in-the-middle"),
        pytest.param(["有字", "java script:alert(1)"], 1, id="javascript-with-space"),
        pytest.param(["有字", "java­script:alert(1)"], 1, id="javascript-soft-hyphen"),
        pytest.param(["甲", "乙", "丙", ""], 3, id="index-three"),
        pytest.param(["同一句", "別句", "同一句"], 2, id="duplicate"),
        pytest.param(["同一句", "  同一句　"], 1, id="duplicate-after-strip"),
    ],
)
async def test_invalid_phrase_is_a_422_pointing_at_its_position(admin_client, db_session, phrases, loc_index):
    await _assert_rejected(admin_client, db_session, phrases, loc_index=loc_index)


@pytest.mark.asyncio
async def test_more_than_twenty_phrases_is_a_422(admin_client, db_session):
    await _assert_rejected(admin_client, db_session, [f"第{index}句" for index in range(21)], loc_index=None)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body",
    [
        pytest.param({"phrases": ["a"]}, id="missing-expected-version"),
        pytest.param({"expected_version": 1}, id="missing-phrases"),
        pytest.param({"phrases": "不是清單", "expected_version": 1}, id="phrases-not-a-list"),
        pytest.param({"phrases": [1, 2], "expected_version": 1}, id="phrase-not-a-string"),
        pytest.param({"phrases": ["a"], "expected_version": 0}, id="version-zero"),
    ],
)
async def test_malformed_body_is_a_422(admin_client, db_session, body):
    response = await admin_client.put(URL, json=body)
    assert response.status_code == 422, response.text
    assert await _row(db_session) is None
