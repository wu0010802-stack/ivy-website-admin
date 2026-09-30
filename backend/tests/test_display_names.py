"""2026-09-28 業主裁定：後台帳號加「顯示名稱」（最多 12 字），同事出現的地方
（承辦人、聯絡紀錄、歷程、內容版本與發布、素材、個資清理、操作紀錄）API 都一併
帶出；操作紀錄讀取時 join users 帶出操作者與被操作的帳號，不寫進 metadata。"""

from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest
from pydantic import BaseModel, ValidationError
from sqlalchemy import select, text, update

from app.auth.models import DISPLAY_NAME_MAX_LENGTH, Role, User
from app.auth.schemas import DisplayName, normalize_display_name
from app.operations import audit_service
from app.operations.models import AuditLogEntry
from tests.conftest import _create_user, _logged_in_client

API = "/api/website/v1"
BASE = f"{API}/admin"
FAQ = f"{BASE}/content-items/campus_faq"
Q = "?campus_key=yihua"
MIGRATION = Path(__file__).resolve().parents[1] / "migrations" / "versions" / "e9c3a7d5f214_user_display_name.py"

ADMIN_NAME = "王園長"
EDITOR_NAME = "小美老師"


async def _set_name(db_session, email: str, name: str | None) -> None:
    await db_session.execute(update(User).where(User.email == email).values(display_name=name))
    await db_session.commit()


async def _audit(db_session, action: str) -> list[AuditLogEntry]:
    db_session.expire_all()
    result = await db_session.execute(
        select(AuditLogEntry).where(AuditLogEntry.action == action).order_by(AuditLogEntry.created_at)
    )
    return list(result.scalars())


def _error_text(response: httpx.Response) -> str:
    return json.dumps(response.json(), ensure_ascii=False)


# ---------------------------------------------------------------- migration


def test_migration_follows_previous_head_without_branching():
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    backend = Path(__file__).resolve().parents[1]
    config = Config(str(backend / "alembic.ini"))
    config.set_main_option("script_location", str(backend / "migrations"))
    script = ScriptDirectory.from_config(config)
    # 接在 main 當下的 head（2026-09-29 LINE 群組驗證）後面，沒有另開分支（部署時只會有一個 head）。
    assert script.get_revision("e9c3a7d5f214").down_revision == "e4c1a7f3b862"
    assert len(script.get_heads()) == 1
    source = MIGRATION.read_text(encoding="utf-8")
    # 只加欄位、不回填：與上一版程式相容，部署時也不會跑大量資料更新。
    assert "op.add_column" in source and "op.execute" not in source


@pytest.mark.asyncio
async def test_migrated_column_is_nullable_varchar_12(app):
    async with app.state.engine.connect() as conn:
        row = (
            await conn.execute(
                text(
                    "SELECT data_type, character_maximum_length, is_nullable, column_default "
                    "FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'display_name'"
                )
            )
        ).one()
    assert tuple(row) == ("character varying", DISPLAY_NAME_MAX_LENGTH, "YES", None)


# ---------------------------------------------------------------- validation


def test_normalize_strips_and_turns_blank_into_null():
    assert normalize_display_name("  王園長 ") == "王園長"
    assert normalize_display_name("　小美　") == "小美"
    assert normalize_display_name("") is None
    assert normalize_display_name("   \n ") is None
    assert normalize_display_name(None) is None
    # 中間的空白保留（英文名）。
    assert normalize_display_name("Amy Lin") == "Amy Lin"


def test_length_counts_characters_not_bytes():
    twelve = "常春藤幼兒園義華校區櫃台"
    assert len(twelve) == 12 and len(twelve.encode()) == 36
    assert normalize_display_name(twelve) == twelve
    with pytest.raises(ValueError, match="最多 12 個字"):
        normalize_display_name(twelve + "一")
    # 前後空白不算字數。
    assert normalize_display_name(f"  {twelve}  ") == twelve


@pytest.mark.parametrize(
    "value",
    ["王\n園長", "王\t園長", "王\r園長", "王\x00", "王​園長", "‮長園王", "王 園長", "王﻿"],
)
def test_rejects_newlines_and_hidden_characters(value):
    with pytest.raises(ValueError, match="換行或看不見的特殊字元"):
        normalize_display_name(value)


def test_emoji_sequences_are_allowed():
    family = "\U0001f469‍\U0001f469‍\U0001f467"  # 👩‍👩‍👧（零寬連接字組合）
    assert normalize_display_name(f"小美{family}") == f"小美{family}"
    assert normalize_display_name("阿土伯👍🏽") == "阿土伯👍🏽"


def test_display_name_type_reports_chinese_errors():
    class Payload(BaseModel):
        display_name: DisplayName = None

    assert Payload(display_name=" 小美 ").display_name == "小美"
    with pytest.raises(ValidationError) as excinfo:
        Payload(display_name="一二三四五六七八九十甲乙丙")
    assert "顯示名稱最多 12 個字" in str(excinfo.value)
    with pytest.raises(ValidationError):
        Payload(display_name=12345)


# ---------------------------------------------------------------- create / update / self


@pytest.mark.asyncio
async def test_create_user_with_display_name(admin_client, db_session):
    created = await admin_client.post(
        f"{BASE}/users",
        json={
            "email": "desk@ivy.example",
            "password": "reception-password-123",
            "role": "reception",
            "campus_keys": ["yihua"],
            "display_name": "  櫃台小林 ",
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["display_name"] == "櫃台小林"
    listed = {u["email"]: u for u in (await admin_client.get(f"{BASE}/users")).json()}
    assert listed["desk@ivy.example"]["display_name"] == "櫃台小林"
    assert listed["admin@ivy.example"]["display_name"] is None

    [entry] = await _audit(db_session, "user.create")
    assert "櫃台小林" not in json.dumps(entry.metadata_json, ensure_ascii=False)

    blank = await admin_client.post(
        f"{BASE}/users",
        json={"email": "blank@ivy.example", "password": "reception-password-123", "role": "super_admin", "display_name": "   "},
    )
    assert blank.status_code == 201, blank.text
    assert blank.json()["display_name"] is None

    too_long = await admin_client.post(
        f"{BASE}/users",
        json={
            "email": "long@ivy.example",
            "password": "reception-password-123",
            "role": "super_admin",
            "display_name": "一二三四五六七八九十甲乙丙",
        },
    )
    assert too_long.status_code == 422
    assert "顯示名稱最多 12 個字" in _error_text(too_long)


@pytest.mark.asyncio
async def test_super_admin_updates_colleague_display_name(admin_client, editor_client, db_session):
    editor_id = (await db_session.execute(select(User.id).where(User.email == "editor-yihua@ivy.example"))).scalar_one()
    url = f"{BASE}/users/{editor_id}/display-name"

    updated = await admin_client.patch(url, json={"display_name": f" {EDITOR_NAME} "})
    assert updated.status_code == 200, updated.text
    assert updated.json()["display_name"] == EDITOR_NAME
    assert updated.json()["email"] == "editor-yihua@ivy.example"

    [entry] = await _audit(db_session, "user.update_display_name")
    assert entry.target_type == "user" and entry.target_id == str(editor_id)
    assert entry.metadata_json == {"changed": ["display_name"], "self": False}
    dumped = json.dumps(entry.metadata_json, ensure_ascii=False)
    assert EDITOR_NAME not in dumped and "@" not in dumped

    # 沒有改變時不再記一筆。
    same = await admin_client.patch(url, json={"display_name": EDITOR_NAME})
    assert same.status_code == 200
    assert len(await _audit(db_session, "user.update_display_name")) == 1

    cleared = await admin_client.patch(url, json={"display_name": None})
    assert cleared.status_code == 200 and cleared.json()["display_name"] is None
    assert len(await _audit(db_session, "user.update_display_name")) == 2

    # 一定要帶這個鍵，漏帶不會被當成清空。
    missing = await admin_client.patch(url, json={})
    assert missing.status_code == 422
    bad = await admin_client.patch(url, json={"display_name": "王\n園長"})
    assert bad.status_code == 422
    assert "換行或看不見的特殊字元" in _error_text(bad)

    not_found = await admin_client.patch(f"{BASE}/users/{uuid.uuid4()}/display-name", json={"display_name": "誰"})
    assert not_found.status_code == 404


@pytest.mark.asyncio
async def test_only_super_admin_can_rename_colleagues(admin_client, minghua_client, editor_client, db_session):
    admin_id = (await db_session.execute(select(User.id).where(User.email == "admin@ivy.example"))).scalar_one()
    for client in (minghua_client, editor_client):
        denied = await client.patch(f"{BASE}/users/{admin_id}/display-name", json={"display_name": "亂改"})
        assert denied.status_code == 403
    db_session.expire_all()
    assert (await db_session.get(User, admin_id)).display_name is None
    assert await _audit(db_session, "user.update_display_name") == []


@pytest.mark.asyncio
async def test_any_logged_in_user_sets_own_display_name(app, db_session):
    await _create_user(db_session, "viewer@ivy.example", "readonly-password-123", Role.READONLY, ["yihua"])
    client = await _logged_in_client(app, "viewer@ivy.example", "readonly-password-123")
    try:
        saved = await client.patch(f"{API}/auth/me", json={"display_name": " 唯讀阿姨 "})
        assert saved.status_code == 200, saved.text
        assert saved.json()["display_name"] == "唯讀阿姨"
        assert saved.json()["email"] == "viewer@ivy.example"
        me = (await client.get(f"{API}/auth/me")).json()
        assert me["user"]["display_name"] == "唯讀阿姨"

        [entry] = await _audit(db_session, "user.update_display_name")
        viewer = (await db_session.execute(select(User).where(User.email == "viewer@ivy.example"))).scalar_one()
        assert entry.actor_user_id == viewer.id and entry.target_id == str(viewer.id)
        assert entry.metadata_json == {"changed": ["display_name"], "self": True}
        assert "唯讀阿姨" not in json.dumps(entry.metadata_json, ensure_ascii=False)

        too_long = await client.patch(f"{API}/auth/me", json={"display_name": "一二三四五六七八九十甲乙丙"})
        assert too_long.status_code == 422
        assert "顯示名稱最多 12 個字" in _error_text(too_long)

        # 和其他寫入一樣要 CSRF。
        client.headers.pop("x-csrf-token")
        no_csrf = await client.patch(f"{API}/auth/me", json={"display_name": "偷改"})
        assert no_csrf.status_code == 403
    finally:
        await client.aclose()
    db_session.expire_all()
    viewer = (await db_session.execute(select(User).where(User.email == "viewer@ivy.example"))).scalar_one()
    assert viewer.display_name == "唯讀阿姨"

    anonymous = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")
    try:
        assert (await anonymous.patch(f"{API}/auth/me", json={"display_name": "路人"})).status_code == 401
    finally:
        await anonymous.aclose()


@pytest.mark.asyncio
async def test_display_name_key_is_never_stored_in_audit_metadata(db_session):
    entry = await audit_service.log_action(
        db_session,
        actor_user_id=None,
        action="user.update_display_name",
        target_type="user",
        target_id="x",
        metadata={"display_name": "王園長", "email": "a@ivy.example", "changed": ["display_name"]},
    )
    assert entry.metadata_json == {"changed": ["display_name"]}
    await db_session.rollback()


# ---------------------------------------------------------------- staff shown in admin responses


@pytest.mark.asyncio
@pytest.mark.usefixtures("booking_consent")
async def test_visit_staff_notes_and_history_carry_display_names(admin_client, db_session):
    await _set_name(db_session, "admin@ivy.example", ADMIN_NAME)
    await _create_user(db_session, "desk-yihua@ivy.example", "reception-password-123", Role.RECEPTION, ["yihua"])

    staff = {s["email"]: s for s in (await admin_client.get(f"{BASE}/visit-staff")).json()}
    assert staff["admin@ivy.example"]["display_name"] == ADMIN_NAME
    assert staff["desk-yihua@ivy.example"]["display_name"] is None

    created = await admin_client.post(
        f"{BASE}/visit-requests",
        json={"campus_key": "yihua", "source": "phone", "parent_name": "林媽媽", "phone": "0912345678", "consent_given": True},
        headers={"Idempotency-Key": "display-names-01"},
    )
    assert created.status_code == 201, created.text
    case_id = created.json()["id"]

    note = await admin_client.post(f"{BASE}/visit-requests/{case_id}/contact-notes", json={"note": "已來電"})
    assert note.status_code == 201, note.text
    assert note.json()["created_by_email"] == "admin@ivy.example"
    assert note.json()["created_by_display_name"] == ADMIN_NAME
    [listed] = (await admin_client.get(f"{BASE}/visit-requests/{case_id}/contact-notes")).json()
    assert listed["created_by_display_name"] == ADMIN_NAME

    history = (await admin_client.get(f"{BASE}/visit-requests/{case_id}")).json()["history"]
    staff_events = [e for e in history if e["actor_user_id"]]
    assert staff_events
    assert {(e["actor_email"], e["actor_display_name"]) for e in staff_events} == {("admin@ivy.example", ADMIN_NAME)}

    # 改名後舊紀錄跟著顯示新名字（讀取時才查）；清掉後回到 null。
    await _set_name(db_session, "admin@ivy.example", None)
    [listed] = (await admin_client.get(f"{BASE}/visit-requests/{case_id}/contact-notes")).json()
    assert listed["created_by_display_name"] is None
    assert listed["created_by_email"] == "admin@ivy.example"


@pytest.mark.asyncio
async def test_content_revisions_reviews_schedules_releases_and_notices(admin_client, editor_client, db_session):
    await _set_name(db_session, "admin@ivy.example", ADMIN_NAME)
    await _set_name(db_session, "editor-yihua@ivy.example", EDITOR_NAME)

    draft = await editor_client.post(
        f"{FAQ}/revisions{Q}", json={"expected_version": 0, "payload": {"items": [{"q": "要預約嗎？", "a": "要。"}]}}
    )
    assert draft.status_code == 201, draft.text
    revision_id = draft.json()["latest_revision"]["id"]

    [summary] = (await admin_client.get(f"{FAQ}/revisions{Q}")).json()
    assert (summary["created_by_email"], summary["created_by_display_name"]) == ("editor-yihua@ivy.example", EDITOR_NAME)

    submitted = await editor_client.post(f"{FAQ}/submit{Q}", json={"revision_id": revision_id})
    assert submitted.status_code == 200, submitted.text
    [pending] = (await admin_client.get(f"{BASE}/content-reviews")).json()
    assert pending["submitted_by_email"] == "editor-yihua@ivy.example"
    assert pending["submitted_by_display_name"] == EDITOR_NAME

    [notice] = (await admin_client.get(f"{BASE}/my-notifications")).json()
    assert notice["kind"] == "content_review_submitted"
    assert (notice["actor_email"], notice["actor_display_name"]) == ("editor-yihua@ivy.example", EDITOR_NAME)
    read = await admin_client.post(f"{BASE}/my-notifications/{notice['id']}/read")
    assert read.json()["actor_display_name"] == EDITOR_NAME

    publish_at = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    job = await admin_client.post(f"{FAQ}/schedules{Q}", json={"revision_id": revision_id, "publish_at": publish_at})
    assert job.status_code in (200, 201), job.text
    assert job.json()["created_by_display_name"] == ADMIN_NAME
    [listed_job] = (await admin_client.get(f"{FAQ}/schedules{Q}")).json()
    assert listed_job["created_by_display_name"] == ADMIN_NAME
    [site_job] = (await admin_client.get(f"{BASE}/publish-jobs")).json()
    assert (site_job["created_by_email"], site_job["created_by_display_name"]) == ("admin@ivy.example", ADMIN_NAME)

    published = await admin_client.post(f"{FAQ}/publish{Q}", json={"revision_id": revision_id})
    assert published.status_code == 200, published.text
    release = (await admin_client.get(f"{BASE}/releases")).json()["items"][0]
    assert (release["created_by_email"], release["created_by_display_name"]) == ("admin@ivy.example", ADMIN_NAME)


@pytest.mark.asyncio
async def test_media_uploader_display_name(admin_client, db_session):
    from io import BytesIO

    from PIL import Image

    await _set_name(db_session, "admin@ivy.example", ADMIN_NAME)
    buffer = BytesIO()
    Image.new("RGB", (40, 30), (78, 184, 122)).save(buffer, "JPEG")
    uploaded = await admin_client.post(
        f"{BASE}/media", data={"kind": "image"}, files={"file": ("photo.jpg", buffer.getvalue(), "image/jpeg")}
    )
    assert uploaded.status_code == 201, uploaded.text
    assert uploaded.json()["created_by_display_name"] == ADMIN_NAME
    media_id = uploaded.json()["id"]
    assert (await admin_client.get(f"{BASE}/media/{media_id}")).json()["created_by_display_name"] == ADMIN_NAME
    [listed] = (await admin_client.get(f"{BASE}/media")).json()
    assert (listed["created_by_email"], listed["created_by_display_name"]) == ("admin@ivy.example", ADMIN_NAME)


@pytest.mark.asyncio
async def test_retention_policy_and_runs_display_name(app, admin_client, db_session):
    await _set_name(db_session, "admin@ivy.example", ADMIN_NAME)
    policy = f"{BASE}/site-policies/retention"
    initial = (await admin_client.get(policy)).json()
    assert initial["updated_by_email"] is None and initial["updated_by_display_name"] is None
    saved = await admin_client.put(
        policy,
        json={
            "expected_version": initial["version"],
            "cancelled_days": 180,
            "completed_days": 365,
            "open_overdue_days": 365,
            "auto_run_enabled": False,
        },
    )
    assert saved.status_code == 200, saved.text
    assert (saved.json()["updated_by_email"], saved.json()["updated_by_display_name"]) == ("admin@ivy.example", ADMIN_NAME)

    app.state.settings = app.state.settings.model_copy(update={"retention_allow_real_run": True})
    assert (await admin_client.post(f"{BASE}/retention/run")).status_code == 200
    [run] = (await admin_client.get(f"{BASE}/retention-runs")).json()
    assert (run["actor_email"], run["actor_display_name"]) == ("admin@ivy.example", ADMIN_NAME)


# ---------------------------------------------------------------- operation log


@pytest.mark.asyncio
async def test_audit_log_shows_actor_and_target_account(admin_client, db_session):
    created = await admin_client.post(
        f"{BASE}/users",
        json={"email": "desk@ivy.example", "password": "reception-password-123", "role": "reception", "campus_keys": ["yihua"]},
    )
    assert created.status_code == 201, created.text
    desk_id = created.json()["id"]

    def by_action(entries: list[dict]) -> dict[str, dict]:
        return {entry["action"]: entry for entry in entries}

    log = by_action((await admin_client.get(f"{BASE}/audit-log")).json())
    # 還沒有顯示名稱：操作者給 email，被操作的帳號退回 email。
    assert log["user.create"]["actor_email"] == "admin@ivy.example"
    assert log["user.create"]["actor_display_name"] is None
    assert log["user.create"]["target_label"] == "desk@ivy.example"

    assert (await admin_client.patch(f"{API}/auth/me", json={"display_name": ADMIN_NAME})).status_code == 200
    assert (
        await admin_client.patch(f"{BASE}/users/{desk_id}/display-name", json={"display_name": "櫃台小林"})
    ).status_code == 200

    entries = (await admin_client.get(f"{BASE}/audit-log")).json()
    log = by_action(entries)
    # 名字是讀取時查的：改名前的舊紀錄也顯示現在的名字。
    assert log["user.create"]["actor_display_name"] == ADMIN_NAME
    assert log["user.create"]["target_label"] == "櫃台小林"
    renames = [e for e in entries if e["action"] == "user.update_display_name"]
    assert {(e["target_label"], e["metadata"]["self"]) for e in renames} == {(ADMIN_NAME, True), ("櫃台小林", False)}
    for entry in entries:
        assert set(entry) >= {
            "id", "actor_user_id", "actor_email", "actor_display_name", "action", "target_type",
            "target_id", "target_label", "campus_key", "metadata", "created_at",
        }
        dumped = json.dumps(entry["metadata"], ensure_ascii=False)
        assert ADMIN_NAME not in dumped and "櫃台小林" not in dumped and "desk@ivy.example" not in dumped
        if entry["target_type"] != "user":
            assert entry["target_label"] is None


@pytest.mark.asyncio
async def test_audit_log_system_actor_and_unknown_target(admin_client, db_session):
    await audit_service.log_action(
        db_session, actor_user_id=None, action="retention.run", target_type="visit_requests", target_id="bulk",
        metadata={"trigger": "scheduled"},
    )
    await audit_service.log_action(
        db_session, actor_user_id=None, action="user.login_google_failed", target_type="user", target_id="unknown",
        metadata={"reason": "not_allowed"},
    )
    await audit_service.log_action(
        db_session, actor_user_id=None, action="user.set_active", target_type="user", target_id=str(uuid.uuid4()),
        metadata={"is_active": False},
    )
    await db_session.commit()
    entries = {e["action"]: e for e in (await admin_client.get(f"{BASE}/audit-log")).json()}
    for action in ("retention.run", "user.login_google_failed", "user.set_active"):
        assert entries[action]["actor_user_id"] is None
        assert entries[action]["actor_email"] is None
        assert entries[action]["actor_display_name"] is None
        assert entries[action]["target_label"] is None


@pytest.mark.asyncio
async def test_audit_log_campus_scope_is_unchanged(admin_client, minghua_client, db_session):
    await _set_name(db_session, "minghua-admin@ivy.example", "明華主任")
    minghua = (await db_session.execute(select(User).where(User.email == "minghua-admin@ivy.example"))).scalar_one()
    admin = (await db_session.execute(select(User).where(User.email == "admin@ivy.example"))).scalar_one()
    for campus_key, actor in (("minghua", minghua), ("yihua", admin), (None, admin)):
        await audit_service.log_action(
            db_session, actor_user_id=actor.id, action="booking_config.update", target_type="booking_config",
            target_id=campus_key or "all", campus_key=campus_key, metadata={"mode": "phone"},
        )
    await db_session.commit()

    own = await minghua_client.get(f"{BASE}/audit-log?campus_key=minghua")
    assert own.status_code == 200
    [entry] = own.json()
    assert entry["campus_key"] == "minghua"
    assert (entry["actor_email"], entry["actor_display_name"]) == ("minghua-admin@ivy.example", "明華主任")
    assert (await minghua_client.get(f"{BASE}/audit-log?campus_key=yihua")).status_code == 404
    assert (await minghua_client.get(f"{BASE}/audit-log")).status_code == 403
    # 只數這個測試寫的三筆；client 登入時另有 user.login_password（2026-09-29 資安修正起記錄密碼登入）。
    entries = (await admin_client.get(f"{BASE}/audit-log")).json()
    assert len([e for e in entries if e["action"] == "booking_config.update"]) == 3


# ---------------------------------------------------------------- public endpoints stay clean


def test_public_endpoints_never_expose_display_names():
    """顯示名稱只給後台同事看；家長端（/public/）的回應結構裡不能出現。"""
    from app.config import Settings
    from app.main import create_app

    # 只讀路由定義，不連 DB（同 test_audit_coverage）。
    schema = create_app(
        Settings(
            environment="test",
            database_url="postgresql+asyncpg://localhost/ivy_website_dev",
            test_database_url="postgresql+asyncpg://localhost/ivy_website_test",
            session_secret="test-only-secret-please-rotate",
        )
    ).openapi()
    components = schema["components"]["schemas"]

    def refs(node, seen: set[str]) -> None:
        if isinstance(node, dict):
            ref = node.get("$ref")
            if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
                name = ref.rsplit("/", 1)[1]
                if name not in seen:
                    seen.add(name)
                    refs(components[name], seen)
            for value in node.values():
                refs(value, seen)
        elif isinstance(node, list):
            for value in node:
                refs(value, seen)

    public_paths = {path: item for path, item in schema["paths"].items() if path.startswith(f"{API}/public/")}
    assert public_paths
    seen: set[str] = set()
    for item in public_paths.values():
        for operation in item.values():
            refs(operation.get("responses", {}), seen)
    # 避免 $ref 解析錯了變成空轉：家長管理頁的案件結構一定在裡面。
    assert "ParentVisitRequestOut" in seen
    leaking = [
        f"{name}.{prop}"
        for name in seen
        for prop in components[name].get("properties", {})
        if prop.endswith("display_name") or prop.endswith("_email")
    ]
    assert leaking == []
