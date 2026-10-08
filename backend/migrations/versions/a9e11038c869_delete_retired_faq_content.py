"""刪除常見問題內容類型（shared_faq、campus_faq）的資料

Revision ID: a9e11038c869
Revises: e48a3ccedcd8
Create Date: 2026-10-08

2026-10-08 FAQ 內容類型連同資料刪除；這是改寫資料的 migration，上線前要先備份正式 DB。

官網早就不顯示常見問題（web 沒有任何程式讀 faq），後台也沒有編輯頁。這次後端把
shared_faq（全站共用題目）與 campus_faq（各校題目）兩種內容類型從 registry、欄位規則、
`initialize-content` 與公開輸出整個拿掉，資料庫裡已建立的 FAQ 內容必須一起清掉：
registry 不認得的 kind 還留著，整站還原與排程發布的 check_publishable 會丟
CONTENT_KIND_UNKNOWN、`initialize-content` 與素材匯入直接 KeyError。

刪除範圍與順序（外鍵已對照正式結構查證，kind 都用 `IN ('shared_faq', 'campus_faq')`
找；site_releases 本身保留，只少了 FAQ 那幾列）：

1. site_release_entries：content_item_id 屬於 FAQ（或 revision_id 屬於 FAQ 版本）的列。
   revision_id 對 content_revisions 是 RESTRICT，要先刪才刪得掉版本。
2. publish_jobs：content_item_id／revision_id 雖是 CASCADE，仍明寫刪除。
3. media_usages：content_kind 是 FAQ、revision_id 屬於 FAQ 版本，或 content_item_id
   （字串欄位，存的是內容項 id 的文字）屬於 FAQ。FAQ 沒有素材欄位，正常情況沒有列。
4. user_notifications：content_item_id 屬於 FAQ（或 payload.content_kind 是 FAQ）。
5. content_items.current_published_revision_id 設 NULL（對 content_revisions 是
   SET NULL，use_alter 的循環外鍵，先放掉再刪版本最單純）。
6. content_revisions：FAQ 內容項的所有版本。
7. content_items：FAQ 內容項本身。

沒有別的快照存了 FAQ：site_state 只有 current_release_id（指向 site_releases，
不記 kind）；site_releases 只有來源與時間；稽核紀錄（audit_log_entries）的
target_type／metadata 是字串，不受影響，後台標籤保留給舊紀錄。visit_requests.
consent_revision_id 對 content_revisions 是 RESTRICT，但它只會指向預約文案
（booking_content）的版本，不會指到 FAQ。

與上一版程式相容：上一版程式遇到沒有 FAQ 列的資料庫沒有問題（內容項是用到才建，
公開輸出缺 shared_faq／campus_faq 時官網本來就不讀）。部署是先停舊容器、由新容器
啟動時套 migration（見 deploy/CICD.md）。

downgrade 不還原資料：刪掉的 FAQ 內容不還原；官網與後台都已不使用。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "a9e11038c869"
down_revision = "e48a3ccedcd8"
branch_labels = None
depends_on = None

_FAQ_KINDS = "('shared_faq', 'campus_faq')"
_FAQ_ITEMS = f"SELECT id FROM content_items WHERE kind IN {_FAQ_KINDS}"
_FAQ_REVISIONS = f"SELECT id FROM content_revisions WHERE content_item_id IN ({_FAQ_ITEMS})"


def _delete_retired_faq(conn) -> dict[str, int]:
    """刪掉所有 FAQ 內容（shared_faq、campus_faq）及指向它們的列；回傳各表刪除筆數。
    沒有 FAQ 內容時什麼都不做，重跑也安全。"""
    counts: dict[str, int] = {}

    def run(name: str, statement: str) -> None:
        counts[name] = conn.execute(sa.text(statement)).rowcount

    run(
        "site_release_entries",
        f"DELETE FROM site_release_entries WHERE content_item_id IN ({_FAQ_ITEMS}) "
        f"OR revision_id IN ({_FAQ_REVISIONS})",
    )
    run(
        "publish_jobs",
        f"DELETE FROM publish_jobs WHERE content_item_id IN ({_FAQ_ITEMS}) OR revision_id IN ({_FAQ_REVISIONS})",
    )
    run(
        "media_usages",
        f"DELETE FROM media_usages WHERE content_kind IN {_FAQ_KINDS} "
        f"OR revision_id IN ({_FAQ_REVISIONS}) "
        f"OR content_item_id IN (SELECT CAST(id AS VARCHAR) FROM content_items WHERE kind IN {_FAQ_KINDS})",
    )
    run(
        "user_notifications",
        f"DELETE FROM user_notifications WHERE content_item_id IN ({_FAQ_ITEMS}) "
        f"OR CAST(payload AS JSONB) ->> 'content_kind' IN {_FAQ_KINDS}",
    )
    run(
        "content_items.current_published_revision_id",
        f"UPDATE content_items SET current_published_revision_id = NULL WHERE kind IN {_FAQ_KINDS}",
    )
    run("content_revisions", f"DELETE FROM content_revisions WHERE content_item_id IN ({_FAQ_ITEMS})")
    run("content_items", f"DELETE FROM content_items WHERE kind IN {_FAQ_KINDS}")
    return counts


def upgrade() -> None:
    _delete_retired_faq(op.get_bind())


def downgrade() -> None:
    # 刪掉的 FAQ 內容不還原；官網與後台都已不使用。
    pass
