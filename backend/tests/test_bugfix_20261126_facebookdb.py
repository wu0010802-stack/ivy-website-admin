"""Facebook 收件匣的照片代理、轉成消息、立即同步：等 Meta 回應時不能握著請求的 DB 連線（2026-11-26）。

get_current_user 用請求的 session 查使用者，交易因此開著、占住主連線池一條連線。這三支路由原本
直接向 Meta 要資料（照片最大 15 MB、影片 150 MB，讀取逾時 20 秒／塊、整體沒有上限）：
- 後台「Facebook 貼文」頁一次 lazy 載入很多張照片，Meta CDN 一慢，主池被照片請求占滿，公開預約送單、
  後台登入等拿不到連線回 500；
- 轉成消息下載影片時連線一直是 idle in transaction，超過 WEBSITE_DB_IDLE_IN_TRANSACTION_TIMEOUT_MS
  被 PostgreSQL 收掉，接著鎖貼文那一步 500，重試也一樣；
- 立即同步握著請求的連線，sync_pages 又向同一個池子借連線，「握一條、等一條」。

假 Meta 在每個請求進來時記下主池借出幾條連線，並另開連線從 pg_stat_activity 數 idle in transaction。"""
from __future__ import annotations

import uuid

import httpx
import pytest
from sqlalchemy import select, text

from app.auth.models import User
from app.facebook.models import FacebookPagePost
from app.operations.models import AuditLogEntry
from tests.test_facebook_posts import (  # noqa: F401 —— meta 是 fixture
    API,
    MP4,
    PICTURE,
    YIHUA_PAGE,
    FakeMeta,
    _only_post,
    _post,
    _sync,
    _video_attachment,
    meta,
)

GRAPH_HOST = "graph.facebook.com"


async def _idle_in_transaction(app) -> int:
    # 每次用新連線查：pg_stat_activity 的內容在同一個交易內會被快取，沿用同一條連線會看到舊的結果
    # （tests/test_system_status.py）。
    async with app.state.session_factory() as probe:
        rows = await probe.execute(text(
            "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() "
            "AND pid <> pg_backend_pid() AND state LIKE 'idle in transaction%'"
        ))
        return int(rows.scalar_one())


class _ConnectionProbe:
    """包住假 Meta：每個送到 Meta（Graph 或 CDN）的請求，先記下主連線池當下借出的連線數，
    再數 idle in transaction 的連線，最後照假 Meta 原本的回應。"""

    def __init__(self, app, fake: FakeMeta) -> None:
        self.app = app
        self.fake = fake
        self.seen: list[tuple[str, int, int]] = []  # (主機, 借出連線數, idle in transaction 數)

    async def handler(self, request: httpx.Request) -> httpx.Response:
        # 先數借出的連線：底下的 pg_stat_activity 探測自己也要借一條。
        checked_out = self.app.state.engine.sync_engine.pool.checkedout()
        self.seen.append((request.url.host, checked_out, await _idle_in_transaction(self.app)))
        return self.fake.handler(request)


def _install_probe(app, fake: FakeMeta) -> _ConnectionProbe:
    probe = _ConnectionProbe(app, fake)
    app.state.facebook_transport = httpx.MockTransport(probe.handler)  # meta fixture 收尾時會改回 None
    return probe


async def _synced_post_id(app, fake: FakeMeta, db_session) -> uuid.UUID:
    await _sync(app, fake, ["yihua"])
    post_id = (await _only_post(db_session)).id
    # 測試自己的 session 不能留在交易裡，否則量到的是它、不是路由。
    await db_session.rollback()
    return post_id


async def _user_id(db_session, email: str) -> uuid.UUID:
    user_id = await db_session.scalar(select(User.id).where(User.email == email))
    await db_session.rollback()
    return user_id


async def test_probe_sees_a_held_transaction(app, meta, db_session):
    # 正向對照：一條停在交易中的連線，探測要量得到；下面各測試的 0 才不是空過。
    probe = _ConnectionProbe(app, meta)
    await db_session.execute(text("SELECT 1"))
    await probe.handler(httpx.Request("GET", PICTURE))
    await db_session.rollback()
    await probe.handler(httpx.Request("GET", PICTURE))
    assert probe.seen == [("scontent.xx.fbcdn.net", 1, 1), ("scontent.xx.fbcdn.net", 0, 0)]


async def test_picture_proxy_releases_db_before_downloading(admin_client, meta, app, db_session):
    post_id = await _synced_post_id(app, meta, db_session)
    probe = _install_probe(app, meta)
    response = await admin_client.get(f"{API}/{post_id}/picture")
    assert response.status_code == 200, response.text
    assert response.content == meta.picture
    assert probe.seen == [("scontent.xx.fbcdn.net", 0, 0)]


@pytest.mark.skipif(not MP4.exists(), reason="需要 ffmpeg 產生測試影片")
async def test_import_releases_db_before_downloading_picture_and_video(admin_client, meta, app, db_session):
    meta.posts[YIHUA_PAGE] = [_post(f"{YIHUA_PAGE}_1", **_video_attachment())]
    post_id = await _synced_post_id(app, meta, db_session)
    admin_id = await _user_id(db_session, "admin@ivy.example")
    probe = _install_probe(app, meta)
    response = await admin_client.post(f"{API}/{post_id}/import")
    assert response.status_code == 200, response.text
    assert response.json()["video_included"] is True
    # 照片、影片都在交易外下載。
    assert probe.seen == [("scontent.xx.fbcdn.net", 0, 0), ("video.xx.fbcdn.net", 0, 0)]
    # 放掉連線之後照樣鎖貼文、寫入：處理人與稽核紀錄是登入的人。
    post = await db_session.get(FacebookPagePost, post_id)
    assert post.status == "imported" and post.handled_by == admin_id
    entry = await db_session.scalar(select(AuditLogEntry).where(AuditLogEntry.action == "facebook_post.import"))
    assert entry.actor_user_id == admin_id


async def test_import_by_campus_editor_after_releasing_db(editor_client, meta, app, db_session):
    # 分校的內容編輯：鎖貼文那一步要再查一次校區權限（讀 campus_scopes），放掉連線之後也要讀得到。
    post_id = await _synced_post_id(app, meta, db_session)
    editor_id = await _user_id(db_session, "editor-yihua@ivy.example")
    probe = _install_probe(app, meta)
    response = await editor_client.post(f"{API}/{post_id}/import")
    assert response.status_code == 200, response.text
    assert probe.seen == [("scontent.xx.fbcdn.net", 0, 0)]
    post = await db_session.get(FacebookPagePost, post_id)
    assert post.status == "imported" and post.handled_by == editor_id


async def test_sync_now_releases_db_before_calling_graph(admin_client, meta, app, db_session):
    admin_id = await _user_id(db_session, "admin@ivy.example")
    probe = _install_probe(app, meta)
    response = await admin_client.post(f"{API}/sync", json={"campus_key": "yihua"})
    assert response.status_code == 200, response.text
    assert response.json()["counts"] == {"new": 1, "imported": 0, "dismissed": 0}
    graph_calls = [row for row in probe.seen if row[0] == GRAPH_HOST]
    assert graph_calls and all(row == (GRAPH_HOST, 0, 0) for row in graph_calls), probe.seen
    entry = await db_session.scalar(select(AuditLogEntry).where(AuditLogEntry.action == "facebook_posts.sync"))
    assert entry.actor_user_id == admin_id and entry.metadata_json["synced_posts"] == 1
