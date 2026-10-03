# 總管理者寄送重設密碼連結 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 總管理者在「使用者」頁按一下就能寄一封重設密碼連結給同事，同事點連結自己設定新密碼，不必再由總管理者設密碼、口頭轉告。

**Architecture:** 新表 `password_reset_tokens` 只存 token 的 SHA-256；`app/auth/password_reset.py` 管連結的產生、作廢、判斷與信件文案，`app/auth/password_reset_routes.py` 提供一支後台端點（寄出）與兩支不需登入的端點（確認連結、設定新密碼）。信在寄出請求裡同步寄（不走 outbox），失敗就作廢連結並當場回報。後台 `UsersView` 的「重設密碼」對話框多一個「寄重設連結」方式，新頁 `/admin/reset-password` 讓同事設定新密碼。

**Tech Stack:** FastAPI 0.136.1（釘版）＋SQLAlchemy 2.0 async＋Alembic＋PostgreSQL；後台 Vue 3＋Pinia＋Element Plus＋Vite，Vitest＋@vue/test-utils；stack e2e 用 Playwright。

**Spec:** 沒有獨立規格。來源：`docs/website-admin/operations.md:175`（已知限制「重設密碼不寄信」）、`backend/app/auth/routes.py:437-466`（現行 `reset_user_password`）、使用者 2026-10-03 裁定（本計畫「設計決定」第 1 條）。

## 設計決定

1. **使用者 2026-10-03 裁定：只做「總管理者寄重設連結」，登入頁不做自助「忘記密碼」。**登入頁那句「忘記密碼請聯絡總管理者重設。」（`admin/src/views/LoginView.vue:244`）維持不改。
2. **保留「直接設定新密碼」**（`UsersView.vue:383-406` 現有流程）當成沒設定寄信時的退路，有寄信時也還能選。⚠️ 這是假設，**開工前跟使用者確認**；若使用者要拿掉，Task 7 的對話框只留寄連結，`POST /admin/users/{id}/password` 也一併移除（另寫一個 Task）。
3. **同步寄信，不走 outbox。**`outbox_messages.visit_request_id` 是 NOT NULL 的參觀案件外鍵（`backend/app/booking/models.py:374-376`），塞不進帳號信；而且連結 30 分鐘就過期，排隊重試沒有意義。同步寄出，總管理者當場就知道寄出去了沒有。寄送失敗時把這條連結作廢、回 502 帶錯誤類別，並寫一筆稽核。
4. **token**：`secrets.token_urlsafe(32)`，DB 只存 SHA-256（比照 `Session`，`backend/app/auth/models.py:88-105`）。不學家長連結用 HMAC 重算（`access_service._derive_raw`），因為寄件當下手上就有原始值，不需要重算。
5. **token 只放在網址 `#` 後面**（`/admin/reset-password#token=…`），fragment 不會送到伺服器、不進 access log、也不在 Referer；兩支公開端點都用 POST 本文帶 token。重設頁讀到 token 就用 `router.replace` 清掉，避免留在 history.state（同 `web/app/pages/visit/manage.vue:63-68` 的做法）。
6. **有效期與作廢**：30 分鐘、只能用一次；寄新連結時，同一人還沒用的舊連結一律作廢。另外三種情況也作廢：本人改密碼、總管理者直接設新密碼、帳號被停用。
7. **設定完成**：撤銷該帳號所有 session（沿用 `service.revoke_user_sessions`，`service.py:448`），不自動登入，導回登入頁。同時**解除密碼登入暫停與失敗計數**：09-29 的帳號鎖（`service.py:46-58`）是用來擋猜舊密碼的，密碼換掉之後，本人應該能立刻用新密碼登入。**「直接設定新密碼」也改成一併解鎖**，兩條路行為一致。目前直接重設不會解鎖，所以這一條改變了現有行為，回報時要提。Google／LINE 綁定不動，跟現有的直接重設一樣（`routes.py:509` 的 docstring：「重設密碼不會動到綁定」）。
8. **寄出連結不影響原本的密碼**：對方設好新密碼之前，舊密碼照常可用。帳號疑似被盜要立刻踢人，用「停用」或「解除綁定並登出」。
9. **能不能寄**：要同時有 `admin_origin`（信裡的網址）和寄信管道。正式環境只認 SMTP，其他環境也接受本機 sink（開發與 stack e2e 讀信用）。判斷結果經 `/auth/me` 的 `features.password_reset_email` 給前端；不能寄時「寄重設連結」照樣顯示，但停用並說明原因。
10. **限流**：同一個帳號 15 分鐘最多寄 3 封（手滑連按，或有人拿總管理者 session 灌爆對方信箱）。兩支公開端點每個來源 5 分鐘 30 次。公開端點也比對 Origin，比照 `deps.check_csrf_and_origin`。
11. **稽核**有四種動作：`user.password_reset_link_sent`、`user.password_reset_link_failed`、`user.password_reset_link_rejected`、`user.password_reset_completed`。metadata 一律寫字面值 dict（`labelCoverage.test.ts` 會解析），不放 email、token、IP。打開連結（verify）只讀不寫，列進 `test_audit_coverage.py` 的 `_EXEMPT`。亂打的 token 對不到帳號，不寫稽核，免得被灌爆。
12. **鎖的順序**一律先鎖帳號列、再鎖連結列，寄出與設定同時發生時不會互相卡死。
13. **不做**：登入頁自助、使用者列表顯示「有尚未使用的連結」、重設信的寄送重試、清理過期 token 的排程（一年幾十筆，不值得）。

## 已完成、不做

- 總管理者直接設新密碼並登出對方所有裝置：`backend/app/auth/routes.py:437-466`、`admin/src/views/UsersView.vue:383-406`。
- 撤銷某人所有 session：`backend/app/auth/service.py:448` `revoke_user_sessions`。
- 新密碼規則（12 字以上、UTF-8 不超過 72 bytes）：`backend/app/auth/schemas.py:59-61` `NewPassword`、`admin/src/composables/passwordRules.ts`。
- 寄信 adapter（SMTP、本機 sink）：`backend/app/notifications/email_adapter.py:90` `get_email_adapter`。
- 帳號鎖與失敗計數：`backend/app/auth/service.py:46-58`，`clear_login_attempts` 在 `:136`。
- 寄信錯誤類別翻成中文：`admin/src/api/labels.ts:374` `outboxErrorLabel`。
- 稽核 metadata 的 `expires_at`、`replaced_previous`、`revoked_sessions`、`reason` 已有中文寫法：`admin/src/api/labels.ts:1196` 起。

## Global Constraints

- 基準：origin/main `15fd9a5`；開工時 alembic 唯一 head 是 `4a7e2c9d1b63`。
- FastAPI 釘在 0.136.1，不新增任何 Python 或 npm 相依套件。
- Node 22（`.nvmrc`）。Node 指令一律 `source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; <指令>`，用分號串，不用 `&&`。
- 只有 `users.manage`（總管理者）能寄，不能寄給自己。
- 連結 30 分鐘、單次使用；DB 只存 SHA-256；網址格式固定為 `{admin_origin}/admin/reset-password#token=<token>`。
- 稽核 metadata 只寫字面值 dict，不放 email、token、IP。
- 新的錯誤一律 `detail={"code": ..., "message": ...}`，message 是繁體中文、說下一步。
- 文案：後台用「你」，信件用「您」（比照 `notifications/parent_email.py`）；避免 AI 感文案（直白標題、不用英文標語）。
- 機器 8GB：同時只跑一組測試。每個 Task 只跑單檔前景測試，全套留到 Task 11、由主 session 背景跑。
- 不 push、不部署、不碰正式庫。`git add` 列出檔名，不用 `-A` 或 `.`。
- Commit 用 Conventional Commit、繁體中文，結尾一行 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`。

## Review Focus

1. **兩位總管理者同時寄給同一人**：預期只剩一條有效連結，兩個請求都成功，不會互相卡死。測試在 Task 3 `test_two_super_admins_sending_at_once_leave_one_live_link`。
2. **新密碼不符規則（太短、超過 72 bytes）時，連結不能被用掉**：預期回 422，連結仍然有效。測試在 Task 4 `test_rejected_new_password_does_not_use_up_the_link`。
3. **連結剛好過期，或寄出後帳號被停用**：預期 410，並說明是哪一種情況。測試在 Task 4 `test_expired_link_is_rejected_and_audited`、`test_inactive_account_cannot_use_link`，以及 Task 5 `test_deactivating_account_revokes_links`。
4. **寄信伺服器錯誤或逾時**：預期不留下可用的連結，總管理者當場看到中文原因，對話框留著、可以改用直接設定。測試在 Task 3 `test_send_failure_revokes_link_and_is_audited`、Task 7「寄送失敗時說明原因」。
5. **重新整理後網址已經沒有代碼**（含 LINE、Gmail 內建瀏覽器）：預期請對方回信裡再點一次，不顯示代碼或狀態碼。測試在 Task 8「網址沒有代碼」。

---

## File Structure

| 檔案 | 動作 | 責任 |
|---|---|---|
| `backend/app/auth/models.py` | 改 | 新增 `PasswordResetToken` |
| `backend/migrations/versions/d2b7f4c9e1a3_password_reset_tokens.py` | 新增 | 建表，down_revision `4a7e2c9d1b63` |
| `backend/app/auth/password_reset.py` | 新增 | 常數、能不能寄、產生與作廢連結、判斷連結狀態、信件文案 |
| `backend/app/auth/password_reset_routes.py` | 新增 | 寄出、確認、設定新密碼三支端點 |
| `backend/app/auth/schemas.py` | 改 | `FeatureFlags.password_reset_email` 與四個新 schema |
| `backend/app/auth/routes.py` | 改 | `_features`；停用、改密碼、直接重設時作廢連結；直接重設時解鎖 |
| `backend/app/auth/service.py` | 改 | `clear_login_lock` |
| `backend/app/main.py` | 改 | 掛上新 router |
| `backend/tests/conftest.py` | 改 | TRUNCATE 清單加新表 |
| `backend/tests/test_audit_coverage.py` | 改 | verify 列入 `_EXEMPT` |
| `backend/tests/test_auth_scope.py` | 改 | `:220`、`:223` 的 features 相等斷言補新鍵 |
| `backend/tests/test_password_reset_service.py` | 新增 | 表與服務層 |
| `backend/tests/test_password_reset_routes.py` | 新增 | 三支端點 |
| `backend/tests/test_password_reset_interactions.py` | 新增 | 停用、改密碼、直接重設與連結的互動 |
| `contracts/openapi.json`、`contracts/generated/website-api.d.ts` | 重產 | `npm run contract:generate` |
| `admin/src/api/types.ts` | 改 | 新型別別名 |
| `admin/src/api/labels.ts` | 改 | 稽核動作、原因與 `error_code` 的中文 |
| `admin/src/views/UsersView.vue` | 改 | 對話框加「寄重設連結」 |
| `admin/src/views/ResetPasswordView.vue` | 新增 | 設定新密碼頁 |
| `admin/src/router/index.ts` | 改 | `/reset-password` 路由與 `meta.public` |
| `admin/src/views/LoginView.vue` | 改 | `reason=password_reset` 提示 |
| `admin/src/__tests__/passwordResetLabels.test.ts`、`passwordResetLink.test.ts`、`resetPasswordPage.test.ts` | 新增 | 後台單元測試 |
| `admin/src/__tests__/usersUx.test.ts` | 改 | 第 132 行改用 `aria-label` 找密碼欄 |
| `tests/stack/stack-env.ts`、`tests/stack/global.setup.ts`、`tests/stack/password-reset.spec.ts` | 改／新增 | 端到端 |
| `tests/stack/visual.spec.ts-snapshots/users-*.png` | 重拍 | 使用者頁多一列 |
| `README.md`、`DESIGN.md`、`docs/website-admin/acceptance.md`、`docs/website-admin/operations.md` | 改 | 文件 |

---

### Task 0: 開工準備

**Files:** 無（只建環境）

- [ ] **Step 1: 確認現況與在途工作**

```bash
cd /Users/yilunwu/Desktop/ivy-website-admin
git fetch origin
git log --oneline -1 origin/main
git worktree list
```

預期：origin/main 是 `15fd9a5`，或之後的提交。如果 main 已經前進，先看新提交有沒有動到 `backend/app/auth/`、`admin/src/views/UsersView.vue` 或 migration：`git log --oneline 15fd9a5..origin/main -- backend/app/auth admin/src/views/UsersView.vue backend/migrations`。

- [ ] **Step 2: 開 sparse worktree**

```bash
git worktree add --no-checkout -b feature/admin-password-reset-20261003 ~/Desktop/ivy-website-pwreset-20261003 origin/main
cd ~/Desktop/ivy-website-pwreset-20261003
git sparse-checkout set --cone web backend admin content contracts tests deploy scripts docs .github
git checkout
```

預期：`git status --short` 沒有輸出。

- [ ] **Step 3: 安裝相依套件**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm ci; npm --prefix admin ci; npm --prefix web ci
cd backend; uv sync --frozen
```

預期：三次 `npm ci` 都沒有 ERR；`uv sync` 結束碼 0。

- [ ] **Step 4: 建自己的測試庫並 migrate**

```bash
createdb ivy_website_pwreset_test
cd ~/Desktop/ivy-website-pwreset-20261003/backend
WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pwreset_test WEBSITE_SESSION_SECRET=local-only-session-secret-pwreset uv run --frozen alembic upgrade head
WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pwreset_test WEBSITE_SESSION_SECRET=local-only-session-secret-pwreset uv run --frozen alembic heads
```

預期：`alembic heads` 只印一行 `4a7e2c9d1b63 (head)`。如果有兩個 head，或 head 不是這個，表示別的 session 已經併了 migration：Task 1 的 `down_revision` 改接 `alembic heads` 印出的那個。

- [ ] **Step 5: 跑基準測試**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pwreset_test uv run --frozen pytest -q tests/test_roles_and_passwords.py tests/test_secfix_auth.py tests/test_audit_coverage.py
cd ..; source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/usersUx.test.ts src/__tests__/labelCoverage.test.ts
```

預期：全部 passed。不通過就先停下，回報 main 本身的狀態，不要開工。

---

### Task 1: 資料表 `password_reset_tokens`

**Files:**
- Modify: `backend/app/auth/models.py`（檔尾，`Session` 類別之後）
- Create: `backend/migrations/versions/d2b7f4c9e1a3_password_reset_tokens.py`
- Modify: `backend/tests/conftest.py:130`
- Test: `backend/tests/test_password_reset_service.py`

**Interfaces:**
- Produces: `app.auth.models.PasswordResetToken`，欄位 `id: uuid.UUID`、`user_id: uuid.UUID`、`token_hash: str(64, unique)`、`created_by: uuid.UUID | None`、`created_at`、`expires_at`、`used_at: datetime | None`、`revoked_at: datetime | None`。

- [ ] **Step 1: 寫失敗的測試**

建 `backend/tests/test_password_reset_service.py`：

```python
"""總管理者寄重設密碼連結（2026-10-03）：資料表與服務層。"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from app.auth.models import PasswordResetToken, Role
from tests.conftest import _create_user

STAFF = "staff@ivy.example"
STAFF_PW = "staff-password-123"


async def test_token_hash_is_unique(db_session):
    user = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    now = datetime.now(timezone.utc)
    for _ in range(2):
        db_session.add(
            PasswordResetToken(
                id=uuid.uuid4(), user_id=user.id, token_hash="a" * 64,
                created_at=now, expires_at=now + timedelta(minutes=30),
            )
        )
    with pytest.raises(IntegrityError):
        await db_session.commit()
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pwreset_test uv run --frozen pytest -q tests/test_password_reset_service.py
```

預期：FAIL，`ImportError: cannot import name 'PasswordResetToken'`。

- [ ] **Step 3: 加模型**

在 `backend/app/auth/models.py` 檔尾加：

```python
class PasswordResetToken(Base):
    """總管理者替同事寄出的重設密碼連結（2026-10-03）。只存 token 的 SHA-256，
    原始 token 只出現在寄出的那封信裡。30 分鐘內有效、用一次就失效；寄新的、
    本人改密碼、總管理者直接設新密碼、帳號停用，都會讓還沒用的連結作廢（revoked_at）。"""

    __tablename__ = "password_reset_tokens"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    # 哪位總管理者寄的；帳號之後被刪也不影響這筆紀錄（實務上帳號只停用、不刪）。
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL", name="fk_password_reset_tokens_created_by_users"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```

（`uuid`、`datetime`、`DateTime`、`ForeignKey`、`String`、`Mapped`、`mapped_column` 這個檔案都已經 import 了。）

- [ ] **Step 4: 加 migration**

建 `backend/migrations/versions/d2b7f4c9e1a3_password_reset_tokens.py`：

```python
"""後台帳號的重設密碼連結（總管理者寄出，30 分鐘內用一次）

Revision ID: d2b7f4c9e1a3
Revises: 4a7e2c9d1b63
Create Date: 2026-10-03

只新增一張表，不改既有資料；上一版程式不讀這張表，先跑 migration 再換程式也相容。
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "d2b7f4c9e1a3"
down_revision = "4a7e2c9d1b63"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "password_reset_tokens",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_by", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["created_by"], ["users.id"], ondelete="SET NULL", name="fk_password_reset_tokens_created_by_users"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(op.f("ix_password_reset_tokens_user_id"), "password_reset_tokens", ["user_id"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_password_reset_tokens_user_id"), table_name="password_reset_tokens")
    op.drop_table("password_reset_tokens")
```

- [ ] **Step 5: 測試清表加新表**

`backend/tests/conftest.py:130` 把

```python
                "TRUNCATE TABLE sessions, user_campus_scopes, users, "
```

改成

```python
                "TRUNCATE TABLE password_reset_tokens, sessions, user_campus_scopes, users, "
```

- [ ] **Step 6: migrate 測試庫並跑測試**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003/backend
WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pwreset_test WEBSITE_SESSION_SECRET=local-only-session-secret-pwreset uv run --frozen alembic upgrade head
WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pwreset_test WEBSITE_SESSION_SECRET=local-only-session-secret-pwreset uv run --frozen alembic downgrade -1
WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pwreset_test WEBSITE_SESSION_SECRET=local-only-session-secret-pwreset uv run --frozen alembic upgrade head
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pwreset_test uv run --frozen pytest -q tests/test_password_reset_service.py
```

預期：upgrade、downgrade、upgrade 都沒有錯誤；測試 `1 passed`。

- [ ] **Step 7: Commit**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003
git add backend/app/auth/models.py backend/migrations/versions/d2b7f4c9e1a3_password_reset_tokens.py backend/tests/conftest.py backend/tests/test_password_reset_service.py
git commit -m "feat(auth): 新增重設密碼連結資料表（只存雜湊）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: 服務層 `app/auth/password_reset.py`

**Files:**
- Create: `backend/app/auth/password_reset.py`
- Test: `backend/tests/test_password_reset_service.py`（加測試）

**Interfaces:**
- Consumes: `PasswordResetToken`（Task 1）。
- Produces（後面的 Task 直接用這些名字）：
  - 常數 `RESET_LINK_TTL: timedelta`（30 分鐘）、`SEND_LIMIT: ratelimit.Limit`、`OPEN_SOURCE_LIMIT: ratelimit.Limit`。
  - 原因常數 `REJECT_UNKNOWN = "link_unknown"`、`REJECT_EXPIRED = "link_expired"`、`REJECT_USED = "link_used"`、`REJECT_REVOKED = "link_revoked"`、`REJECT_INACTIVE = "inactive"`。
  - `hash_token(raw: str) -> str`
  - `email_enabled(settings) -> bool`
  - `mail_adapter(settings) -> EmailAdapter`（測試用 monkeypatch 換掉）
  - `reset_url(admin_origin: str, raw_token: str) -> str`
  - `@dataclass IssuedLink(token_id: uuid.UUID, raw_token: str, expires_at: datetime, replaced_previous: bool)`
  - `async revoke_outstanding(db, user_id, *, now=None) -> int`
  - `async revoke_token(db, token_id) -> None`
  - `async issue(db, user: User, *, actor_id: uuid.UUID) -> IssuedLink`
  - `async find_token(db, raw: str) -> PasswordResetToken | None`
  - `rejection(token: PasswordResetToken, user: User | None, now: datetime) -> str | None`
  - `build_email(*, user: User, actor: User, url: str, expires_at: datetime) -> tuple[str, str]`

- [ ] **Step 1: 寫失敗的測試**

在 `backend/tests/test_password_reset_service.py` 的 import 區加：

```python
from app.auth import password_reset
from app.auth.models import User
from app.config import Settings
```

檔尾加：

```python
def _settings(**overrides) -> Settings:
    base = dict(
        environment="test",
        database_url="postgresql+asyncpg://localhost/ivy_website_dev",
        test_database_url="postgresql+asyncpg://localhost/ivy_website_test",
        session_secret="test-only-secret-please-rotate",
    )
    return Settings(**{**base, **overrides})


def test_email_enabled_needs_admin_origin_and_a_mail_channel():
    assert password_reset.email_enabled(_settings()) is False
    # 沒有後台網址就組不出信裡的連結。
    assert password_reset.email_enabled(_settings(notification_email_sink_dir="/tmp/x")) is False
    assert password_reset.email_enabled(_settings(admin_origin="http://test", notification_email_sink_dir="/tmp/x")) is True
    assert password_reset.email_enabled(
        _settings(admin_origin="http://test", smtp_host="smtp.example", smtp_from="noreply@ivy.example")
    ) is True
    # 正式環境只認 SMTP，本機 sink 不算（model_copy 不跑 production 檢查，只換環境名稱）。
    prod = _settings(admin_origin="https://ivy.example", notification_email_sink_dir="/tmp/x").model_copy(
        update={"environment": "production"}
    )
    assert password_reset.email_enabled(prod) is False


def test_reset_url_puts_token_after_hash():
    assert password_reset.reset_url("https://ivy.example/", "abc") == "https://ivy.example/admin/reset-password#token=abc"
    assert password_reset.reset_url("https://ivy.example", "abc") == "https://ivy.example/admin/reset-password#token=abc"


def test_email_names_account_and_deadline_in_taipei_time():
    user = User(email=STAFF, display_name="阿芬")
    actor = User(email="boss@ivy.example", display_name=None)
    # 2026-10-03 06:52Z＝台北 10/03（六）14:52
    expires = datetime(2026, 10, 3, 6, 52, tzinfo=timezone.utc)
    url = "https://ivy.example/admin/reset-password#token=abc"
    subject, body = password_reset.build_email(user=user, actor=actor, url=url, expires_at=expires)
    assert subject == "【常春藤官網後台】重設密碼連結"
    assert body.startswith("阿芬 您好：")
    assert "總管理者 boss@ivy.example" in body
    assert f"（{STAFF}）" in body
    assert "10/03（六）14:52 前" in body
    assert url in body
    assert "原本的密碼照常可用" in body


async def test_issue_revokes_the_previous_live_link(db_session):
    user = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    boss = await _create_user(db_session, "boss@ivy.example", "boss-password-1234", Role.SUPER_ADMIN)
    first = await password_reset.issue(db_session, user, actor_id=boss.id)
    second = await password_reset.issue(db_session, user, actor_id=boss.id)
    await db_session.commit()

    assert first.replaced_previous is False
    assert second.replaced_previous is True
    old = await password_reset.find_token(db_session, first.raw_token)
    new = await password_reset.find_token(db_session, second.raw_token)
    now = datetime.now(timezone.utc)
    assert password_reset.rejection(old, user, now) == password_reset.REJECT_REVOKED
    assert password_reset.rejection(new, user, now) is None
    assert new.expires_at - new.created_at == password_reset.RESET_LINK_TTL
    assert new.created_by == boss.id
    # 存的是雜湊，不是原始 token。
    assert new.token_hash == password_reset.hash_token(second.raw_token)
    assert second.raw_token not in new.token_hash


async def test_expired_link_does_not_count_as_replaced(db_session):
    user = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    first = await password_reset.issue(db_session, user, actor_id=user.id)
    token = await password_reset.find_token(db_session, first.raw_token)
    token.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
    await db_session.flush()
    second = await password_reset.issue(db_session, user, actor_id=user.id)
    assert second.replaced_previous is False


async def test_find_token_ignores_empty_and_oversized_input(db_session):
    assert await password_reset.find_token(db_session, "") is None
    assert await password_reset.find_token(db_session, "x" * 200) is None


def test_rejection_order_used_then_revoked_then_expired_then_inactive():
    now = datetime(2026, 10, 3, 6, 0, tzinfo=timezone.utc)
    active = User(email=STAFF, is_active=True)
    inactive = User(email=STAFF, is_active=False)

    def token(**fields) -> PasswordResetToken:
        base = dict(used_at=None, revoked_at=None, expires_at=now + timedelta(minutes=1))
        return PasswordResetToken(**{**base, **fields})

    past = now - timedelta(minutes=1)
    assert password_reset.rejection(token(used_at=past, revoked_at=past, expires_at=past), inactive, now) == "link_used"
    assert password_reset.rejection(token(revoked_at=past, expires_at=past), inactive, now) == "link_revoked"
    assert password_reset.rejection(token(expires_at=now), inactive, now) == "link_expired"
    assert password_reset.rejection(token(), inactive, now) == "inactive"
    assert password_reset.rejection(token(), None, now) == "inactive"
    assert password_reset.rejection(token(), active, now) is None
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pwreset_test uv run --frozen pytest -q tests/test_password_reset_service.py
```

預期：FAIL，`ImportError: cannot import name 'password_reset'`。

- [ ] **Step 3: 實作**

建 `backend/app/auth/password_reset.py`：

```python
"""總管理者寄給同事的重設密碼連結（2026-10-03 使用者裁定：只做總管理者寄連結，
登入頁不開放自助「忘記密碼」）。

- token 只存 SHA-256；原始 token 只出現在這次寄出的信裡，不進 DB、稽核或 log。
- 30 分鐘內有效、只能用一次；寄新的會讓同一人還沒用的舊連結作廢。本人改密碼、
  總管理者直接設新密碼、帳號停用也會作廢（見 routes.py 與 password_reset_routes.py）。
- 信在寄出請求裡同步寄，不走 outbox：outbox_messages 綁的是參觀案件
  （visit_request_id NOT NULL），而且連結 30 分鐘就過期，排隊重試沒有意義；同步寄出，
  總管理者當場就知道有沒有寄出去。
"""
from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.models import PasswordResetToken, User
from app.common import ratelimit
from app.common.timezones import OPERATING_TZ
from app.notifications.email_adapter import EmailAdapter, get_email_adapter

RESET_LINK_TTL = timedelta(minutes=30)
_TOKEN_BYTES = 32
_TOKEN_MAX_CHARS = 128
# 同一個帳號 15 分鐘內最多寄 3 封：手滑連按，或有人拿總管理者的 session 灌爆對方信箱。
SEND_LIMIT = ratelimit.Limit("password_reset_send", 900, 3)
# 打開連結、送出新密碼：每個來源 5 分鐘 30 次。token 有 256 bits 猜不到，這裡擋的是
# 拿這兩支不用登入的端點當 DB 查詢洪泛。
OPEN_SOURCE_LIMIT = ratelimit.Limit("password_reset_source", 300, 30)

REJECT_UNKNOWN = "link_unknown"
REJECT_EXPIRED = "link_expired"
REJECT_USED = "link_used"
REJECT_REVOKED = "link_revoked"
REJECT_INACTIVE = "inactive"

_WEEKDAYS = "一二三四五六日"


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def email_enabled(settings) -> bool:
    """能不能寄重設連結：要有後台網址（信裡的連結）而且有寄信管道。正式環境只認
    SMTP；其他環境另外接受本機 sink（開發與 stack e2e 讀信用）。"""
    if not settings.admin_origin:
        return False
    if settings.smtp_host:
        return True
    return settings.environment != "production" and bool(settings.notification_email_sink_dir)


def mail_adapter(settings) -> EmailAdapter:
    """寄信管道；測試用 monkeypatch 換成記錄用的 adapter。"""
    return get_email_adapter(settings.notification_email_sink_dir, settings)


def reset_url(admin_origin: str, raw_token: str) -> str:
    # token 放在 # 後面：fragment 不會送到伺服器，不進 access log，也不會出現在 Referer。
    return f"{admin_origin.rstrip('/')}/admin/reset-password#token={raw_token}"


@dataclass(frozen=True)
class IssuedLink:
    token_id: uuid.UUID
    raw_token: str
    expires_at: datetime
    replaced_previous: bool


async def revoke_outstanding(db: AsyncSession, user_id: uuid.UUID, *, now: datetime | None = None) -> int:
    """讓這個人還沒用、還沒過期的連結作廢；回傳作廢了幾條（已過期的不算，本來就不能用）。"""
    now = now or datetime.now(timezone.utc)
    result = await db.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == user_id,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.revoked_at.is_(None),
            PasswordResetToken.expires_at > now,
        )
        .values(revoked_at=now)
    )
    return result.rowcount or 0


async def revoke_token(db: AsyncSession, token_id: uuid.UUID) -> None:
    """寄送失敗時作廢這一條：信沒寄到，不能留一條沒人拿得到、卻仍然有效的連結。"""
    await db.execute(
        update(PasswordResetToken)
        .where(PasswordResetToken.id == token_id, PasswordResetToken.revoked_at.is_(None))
        .values(revoked_at=datetime.now(timezone.utc))
    )


async def issue(db: AsyncSession, user: User, *, actor_id: uuid.UUID) -> IssuedLink:
    """建一條新連結，並作廢這個人還有效的舊連結。呼叫端要先鎖住 user 列
    （SELECT … FOR UPDATE），兩位總管理者同時寄時才不會各留一條有效連結。"""
    now = datetime.now(timezone.utc)
    replaced = await revoke_outstanding(db, user.id, now=now) > 0
    raw = secrets.token_urlsafe(_TOKEN_BYTES)
    token = PasswordResetToken(
        id=uuid.uuid4(),
        user_id=user.id,
        token_hash=hash_token(raw),
        created_by=actor_id,
        created_at=now,
        expires_at=now + RESET_LINK_TTL,
    )
    db.add(token)
    await db.flush()
    return IssuedLink(token_id=token.id, raw_token=raw, expires_at=token.expires_at, replaced_previous=replaced)


async def find_token(db: AsyncSession, raw: str) -> PasswordResetToken | None:
    if not raw or len(raw) > _TOKEN_MAX_CHARS:
        return None
    result = await db.execute(select(PasswordResetToken).where(PasswordResetToken.token_hash == hash_token(raw)))
    return result.scalar_one_or_none()


def rejection(token: PasswordResetToken, user: User | None, now: datetime) -> str | None:
    """連結不能用的原因；能用回 None。順序：用過 → 作廢 → 過期 → 帳號停用，
    越前面的越能說明「下一步該怎麼做」。"""
    if token.used_at is not None:
        return REJECT_USED
    if token.revoked_at is not None:
        return REJECT_REVOKED
    if token.expires_at <= now:
        return REJECT_EXPIRED
    if user is None or not user.is_active:
        return REJECT_INACTIVE
    return None


def build_email(*, user: User, actor: User, url: str, expires_at: datetime) -> tuple[str, str]:
    """純文字信：帳號、寄的人、幾點前有效、連結。不放密碼，也不放其他同事的資料。"""
    local = expires_at.astimezone(OPERATING_TZ)
    deadline = f"{local:%m/%d}（{_WEEKDAYS[local.weekday()]}）{local:%H:%M}"
    name = user.display_name or user.email
    actor_name = actor.display_name or actor.email
    subject = "【常春藤官網後台】重設密碼連結"
    lines = [
        f"{name} 您好：",
        "",
        f"總管理者 {actor_name} 替您的官網後台帳號（{user.email}）寄出重設密碼連結。",
        f"請在 {deadline} 前開啟下面的連結設定新密碼，連結只能使用一次：",
        url,
        "",
        "設定完成後，原本登入中的裝置都會登出，請用新密碼重新登入。",
        "如果您沒有要重設密碼，不用理會這封信，原本的密碼照常可用；也請告訴總管理者。",
        "請勿把這封信轉給他人。",
        "",
        "這封信由系統自動寄出，請勿直接回覆。",
    ]
    return subject, "\n".join(lines)
```

- [ ] **Step 4: 跑測試確認通過**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pwreset_test uv run --frozen pytest -q tests/test_password_reset_service.py tests/test_permission_table.py
```

預期：`test_password_reset_service.py` 8 passed。`test_permission_table.py` 也要通過：新檔在 `app/auth/` 底下，允許出現角色判斷，但這個檔案本來就沒有。

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003
git add backend/app/auth/password_reset.py backend/tests/test_password_reset_service.py
git commit -m "feat(auth): 重設密碼連結的產生、作廢與信件文案

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: 寄出端點 `POST /admin/users/{user_id}/password-reset-link`

**Files:**
- Create: `backend/app/auth/password_reset_routes.py`
- Modify: `backend/app/auth/schemas.py:71-75`（`FeatureFlags`）、檔尾加 schema；檔頭 import 加 `from datetime import datetime`
- Modify: `backend/app/auth/routes.py:122-123`（`_features`）與 import
- Modify: `backend/app/main.py:17`、`:201`
- Test: `backend/tests/test_password_reset_routes.py`

**Interfaces:**
- Consumes: Task 2 的 `password_reset.*`。
- Produces:
  - `FeatureFlags.password_reset_email: bool = False`（`/auth/login`、`/auth/me` 都帶）
  - `PasswordResetLinkOut { sent_to: str, expires_at: datetime, replaced_previous: bool }`
  - `PasswordResetTokenRequest { token: str(1..128) }`、`PasswordResetVerifyOut { email: str, expires_at: datetime }`、`PasswordResetCompleteRequest { token: str(1..128), new_password: NewPassword }`（Task 4 用）
  - `password_reset_routes.router`、`_error(status_code, code, message, **extra) -> HTTPException`
  - 錯誤碼：`USE_CHANGE_PASSWORD`(409)、`RESET_EMAIL_DISABLED`(409)、`USER_INACTIVE`(409)、`RESET_LINK_RATE_LIMITED`(429)、`RESET_LINK_BUSY`(429)、`RESET_EMAIL_FAILED`(502，多帶 `error_code`)
  - 稽核：`user.password_reset_link_sent` `{"expires_at", "replaced_previous"}`、`user.password_reset_link_failed` `{"error_code"}`

- [ ] **Step 1: 寫失敗的測試**

建 `backend/tests/test_password_reset_routes.py`：

```python
"""總管理者寄重設密碼連結（2026-10-03）：寄出、確認連結、設定新密碼。"""
from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from sqlalchemy import select, update

from app.auth import password_reset
from app.auth.models import PasswordResetToken, Role, User
from app.operations.models import AuditLogEntry
from tests.conftest import _create_user, _logged_in_client, freeze_rate_limit_clock

API = "/api/website/v1"
STAFF = "staff@ivy.example"
STAFF_PW = "staff-password-123"
NEW_PW = "brand-new-password-456"
LOGIN = f"{API}/auth/login"
VERIFY = f"{API}/auth/password-reset/verify"
COMPLETE = f"{API}/auth/password-reset/complete"


@pytest.fixture
def mailer(app, monkeypatch, recording_mail_adapter):
    """有後台網址、有寄信管道；寄出的信記在 recording_mail_adapter.sent。"""
    app.state.settings = app.state.settings.model_copy(update={"admin_origin": "http://test"})
    monkeypatch.setattr(password_reset, "mail_adapter", lambda settings: recording_mail_adapter)
    return recording_mail_adapter


def _anon(app) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test")


def _token_from(mail: dict) -> str:
    match = re.search(r"/admin/reset-password#token=([A-Za-z0-9_\-]+)", mail["body"])
    assert match, mail["body"]
    return match.group(1)


async def _send(admin_client, user_id, mailer) -> str:
    response = await admin_client.post(f"{API}/admin/users/{user_id}/password-reset-link")
    assert response.status_code == 200, response.text
    return _token_from(mailer.sent[-1])


async def _audits(db_session, action: str) -> list[AuditLogEntry]:
    db_session.expire_all()
    result = await db_session.execute(
        select(AuditLogEntry).where(AuditLogEntry.action == action).order_by(AuditLogEntry.created_at)
    )
    return list(result.scalars())


async def _live_tokens(db_session, user_id) -> list[PasswordResetToken]:
    db_session.expire_all()
    result = await db_session.execute(
        select(PasswordResetToken).where(
            PasswordResetToken.user_id == user_id,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.revoked_at.is_(None),
        )
    )
    return list(result.scalars())


# ------------------------------------------------------------ 寄出


async def test_super_admin_sends_link_to_colleague(admin_client, db_session, mailer):
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    response = await admin_client.post(f"{API}/admin/users/{target.id}/password-reset-link")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["sent_to"] == STAFF
    assert body["replaced_previous"] is False
    expires = datetime.fromisoformat(body["expires_at"])
    assert timedelta(minutes=29) < expires - datetime.now(timezone.utc) <= timedelta(minutes=30)

    assert len(mailer.sent) == 1
    mail = mailer.sent[0]
    assert mail["to"] == STAFF
    assert mail["subject"] == "【常春藤官網後台】重設密碼連結"
    token = _token_from(mail)
    assert "http://test/admin/reset-password#token=" in mail["body"]

    sent = await _audits(db_session, "user.password_reset_link_sent")
    assert len(sent) == 1
    assert sent[0].target_id == str(target.id)
    assert set(sent[0].metadata_json) == {"expires_at", "replaced_previous"}
    assert token not in json.dumps(sent[0].metadata_json)


async def test_sending_again_replaces_previous_link(admin_client, db_session, mailer):
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    await _send(admin_client, target.id, mailer)
    again = await admin_client.post(f"{API}/admin/users/{target.id}/password-reset-link")
    assert again.json()["replaced_previous"] is True
    assert len(await _live_tokens(db_session, target.id)) == 1


async def test_only_super_admin_can_send_and_not_to_self(admin_client, minghua_client, db_session, mailer):
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.CAMPUS_ADMIN, ["minghua"])
    denied = await minghua_client.post(f"{API}/admin/users/{target.id}/password-reset-link")
    assert denied.status_code == 403
    me = (await admin_client.get(f"{API}/auth/me")).json()["user"]
    self_send = await admin_client.post(f"{API}/admin/users/{me['id']}/password-reset-link")
    assert self_send.status_code == 409
    assert self_send.json()["detail"]["code"] == "USE_CHANGE_PASSWORD"
    assert mailer.sent == []


async def test_unknown_or_inactive_account(admin_client, db_session, mailer):
    missing = await admin_client.post(f"{API}/admin/users/00000000-0000-0000-0000-000000000000/password-reset-link")
    assert missing.status_code == 404
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    off = await admin_client.patch(f"{API}/admin/users/{target.id}/active", json={"is_active": False})
    assert off.status_code == 200, off.text
    inactive = await admin_client.post(f"{API}/admin/users/{target.id}/password-reset-link")
    assert inactive.status_code == 409
    assert inactive.json()["detail"]["code"] == "USER_INACTIVE"
    assert mailer.sent == []


async def test_disabled_without_mail_channel_and_reported_in_features(app, admin_client, db_session, mailer):
    on = (await admin_client.get(f"{API}/auth/me")).json()["features"]
    assert on["password_reset_email"] is True
    app.state.settings = app.state.settings.model_copy(update={"notification_email_sink_dir": None, "smtp_host": None})
    off = (await admin_client.get(f"{API}/auth/me")).json()["features"]
    assert off["password_reset_email"] is False
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    response = await admin_client.post(f"{API}/admin/users/{target.id}/password-reset-link")
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "RESET_EMAIL_DISABLED"
    assert await _live_tokens(db_session, target.id) == []


async def test_send_failure_revokes_link_and_is_audited(admin_client, db_session, mailer, monkeypatch, failing_mail_adapter):
    monkeypatch.setattr(password_reset, "mail_adapter", lambda settings: failing_mail_adapter)
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    response = await admin_client.post(f"{API}/admin/users/{target.id}/password-reset-link")
    assert response.status_code == 502
    detail = response.json()["detail"]
    assert detail["code"] == "RESET_EMAIL_FAILED"
    assert detail["error_code"] == "RuntimeError"
    assert await _live_tokens(db_session, target.id) == []
    failed = await _audits(db_session, "user.password_reset_link_failed")
    assert [entry.metadata_json for entry in failed] == [{"error_code": "RuntimeError"}]
    assert await _audits(db_session, "user.password_reset_link_sent") == []


async def test_at_most_three_links_per_account_per_15_minutes(app, admin_client, db_session, mailer):
    freeze_rate_limit_clock(app)
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    statuses = [
        (await admin_client.post(f"{API}/admin/users/{target.id}/password-reset-link")).status_code for _ in range(4)
    ]
    assert statuses == [200, 200, 200, 429]
    assert len(mailer.sent) == 3


async def test_two_super_admins_sending_at_once_leave_one_live_link(app, admin_client, db_session, mailer):
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    await _create_user(db_session, "boss2@ivy.example", "second-boss-password-1", Role.SUPER_ADMIN)
    second = await _logged_in_client(app, "boss2@ivy.example", "second-boss-password-1")
    try:
        results = await asyncio.gather(
            admin_client.post(f"{API}/admin/users/{target.id}/password-reset-link"),
            second.post(f"{API}/admin/users/{target.id}/password-reset-link"),
        )
    finally:
        await second.aclose()
    assert [r.status_code for r in results] == [200, 200]
    assert sorted(r.json()["replaced_previous"] for r in results) == [False, True]
    assert len(await _live_tokens(db_session, target.id)) == 1
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pwreset_test uv run --frozen pytest -q tests/test_password_reset_routes.py
```

預期：FAIL，寄出端點 404、`features` 沒有 `password_reset_email`（KeyError）。

- [ ] **Step 3: 加 schema**

`backend/app/auth/schemas.py` 檔頭 import 區加 `from datetime import datetime`。把 `FeatureFlags`（`:71-75`）改成：

```python
class FeatureFlags(BaseModel):
    """後台依部署設定決定要不要顯示或啟用的功能。"""

    admissions: bool
    # 能不能寄重設密碼連結：有後台網址與寄信管道才是 True（password_reset.email_enabled）。
    password_reset_email: bool = False
```

檔尾加：

```python
class PasswordResetLinkOut(BaseModel):
    """寄出重設密碼連結的結果：寄到哪個 Email、幾點前有效、有沒有讓舊連結失效。"""

    sent_to: str
    expires_at: datetime
    replaced_previous: bool


class PasswordResetTokenRequest(BaseModel):
    """打開重設連結時確認連結；token 放本文，不放網址，免得進 access log。"""

    token: str = Field(min_length=1, max_length=128)


class PasswordResetVerifyOut(BaseModel):
    email: str
    expires_at: datetime


class PasswordResetCompleteRequest(BaseModel):
    token: str = Field(min_length=1, max_length=128)
    new_password: NewPassword
```

- [ ] **Step 4: `_features` 帶新旗標**

`backend/app/auth/routes.py` import 區把 `from app.auth import service` 改成 `from app.auth import password_reset, service`。`:122-123` 改成：

```python
def _features(settings: Settings) -> FeatureFlags:
    return FeatureFlags(
        admissions=settings.admissions_enabled,
        password_reset_email=password_reset.email_enabled(settings),
    )
```

- [ ] **Step 5: 寫路由檔（先放寄出端點）**

建 `backend/app/auth/password_reset_routes.py`：

```python
"""重設密碼連結的端點（2026-10-03）：總管理者寄出（後台），同事確認連結、設定新密碼
（不需要登入）。規則見 app/auth/password_reset.py。"""
from __future__ import annotations

import asyncio
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import password_reset
from app.auth.deps import get_current_user, get_db_session
from app.auth.models import User
from app.auth.permissions import require_scope
from app.auth.schemas import PasswordResetLinkOut
from app.common import ratelimit
from app.operations import audit_service

router = APIRouter(prefix="/api/website/v1", tags=["auth"])
logger = logging.getLogger("app.auth")


def _error(status_code: int, code: str, message: str, **extra) -> HTTPException:
    return HTTPException(status_code=status_code, detail={"code": code, "message": message, **extra})


@router.post("/admin/users/{user_id}/password-reset-link", response_model=PasswordResetLinkOut)
async def send_password_reset_link(
    user_id: uuid.UUID,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> PasswordResetLinkOut:
    """總管理者替同事寄重設密碼連結。先提交連結再寄信（信寄到時連結就要能用）；
    寄送失敗就作廢這條連結、回 502 並附錯誤類別，總管理者可以改用直接設定新密碼。
    寄出不影響原本的密碼：對方設好新密碼之前，舊密碼照常可用。"""
    require_scope(current_user, "users.manage")
    if user_id == current_user.id:
        raise _error(
            status.HTTP_409_CONFLICT, "USE_CHANGE_PASSWORD", "要改自己的密碼，請到「我的帳號」輸入目前的密碼後變更"
        )
    settings = request.app.state.settings
    if not password_reset.email_enabled(settings):
        raise _error(
            status.HTTP_409_CONFLICT, "RESET_EMAIL_DISABLED", "尚未設定寄信，無法寄出重設連結；請改用「直接設定新密碼」"
        )
    # 鎖住帳號列：兩位總管理者同時寄時排隊，第二封才看得到第一條並作廢它。
    # 鎖的順序一律「帳號 → 連結」，和設定新密碼那邊一致，兩邊同時發生不會互等。
    user = (await db.execute(select(User).where(User.id == user_id).with_for_update())).scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到這個使用者")
    if not user.is_active:
        raise _error(status.HTTP_409_CONFLICT, "USER_INACTIVE", "帳號已停用，請先恢復帳號再寄重設連結")
    try:
        await ratelimit.limiter(request).check(password_reset.SEND_LIMIT, str(user.id))
    except ratelimit.RateLimiterUnavailable as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "RESET_LINK_BUSY", "message": "系統忙碌，請稍候再試"},
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc
    except ratelimit.RateLimited as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "code": "RESET_LINK_RATE_LIMITED",
                "message": "這個帳號 15 分鐘內已經寄過 3 次，請稍後再試，或改用「直接設定新密碼」",
            },
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc

    issued = await password_reset.issue(db, user, actor_id=current_user.id)
    subject, body = password_reset.build_email(
        user=user,
        actor=current_user,
        url=password_reset.reset_url(settings.admin_origin, issued.raw_token),
        expires_at=issued.expires_at,
    )
    await db.commit()

    try:
        adapter = password_reset.mail_adapter(settings)
        await asyncio.to_thread(adapter.send, to=user.email, subject=subject, body=body)
    except Exception as exc:  # noqa: BLE001 —— 任何寄送失敗都要作廢連結並如實回報
        error_code = type(exc).__name__
        logger.warning("重設密碼連結寄送失敗：%s", error_code)
        await password_reset.revoke_token(db, issued.token_id)
        await audit_service.log_action(
            db,
            actor_user_id=current_user.id,
            action="user.password_reset_link_failed",
            target_type="user",
            target_id=str(user_id),
            metadata={"error_code": error_code},
        )
        await db.commit()
        raise _error(
            status.HTTP_502_BAD_GATEWAY,
            "RESET_EMAIL_FAILED",
            "重設連結沒有寄出，請稍後再試，或改用「直接設定新密碼」",
            error_code=error_code,
        ) from exc

    await audit_service.log_action(
        db,
        actor_user_id=current_user.id,
        action="user.password_reset_link_sent",
        target_type="user",
        target_id=str(user_id),
        metadata={"expires_at": issued.expires_at.isoformat(), "replaced_previous": issued.replaced_previous},
    )
    await db.commit()
    return PasswordResetLinkOut(
        sent_to=user.email, expires_at=issued.expires_at, replaced_previous=issued.replaced_previous
    )
```

（`async_sessionmaker(expire_on_commit=False)`，見 `backend/app/db.py:103`，所以 commit 之後還能讀 `user.email`、`current_user.id`。）

- [ ] **Step 6: 掛上 router**

`backend/app/main.py:17` 下一行加：

```python
from app.auth.password_reset_routes import router as password_reset_router
```

`:201` `app.include_router(auth_router)` 下一行加：

```python
    app.include_router(password_reset_router)
```

- [ ] **Step 7: 既有的功能開關測試補新欄位**

`backend/tests/test_auth_scope.py:220` 與 `:223` 寫的是整個 dict 相等，多一個鍵就會紅。`_test_settings()` 沒有 `admin_origin`，所以新旗標是 False。兩行都改成：

```python
            assert login.json()["features"] == {"admissions": enabled, "password_reset_email": False}
```

```python
            assert me.json()["features"] == {"admissions": enabled, "password_reset_email": False}
```

- [ ] **Step 8: 跑測試確認通過**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pwreset_test uv run --frozen pytest -q tests/test_password_reset_routes.py tests/test_audit_coverage.py tests/test_auth_scope.py
```

預期：`test_password_reset_routes.py` 8 passed。`test_audit_coverage.py` 通過，因為寄出端點裡有 `log_action(`。`test_auth_scope.py` 在 Step 7 改完後通過。

- [ ] **Step 9: Commit**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003
git add backend/app/auth/password_reset_routes.py backend/app/auth/schemas.py backend/app/auth/routes.py backend/app/main.py backend/tests/test_password_reset_routes.py backend/tests/test_auth_scope.py
git commit -m "feat(auth): 總管理者寄重設密碼連結（同步寄信、失敗即作廢、同帳號 15 分鐘 3 封）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: 確認連結與設定新密碼（不需要登入）

**Files:**
- Modify: `backend/app/auth/password_reset_routes.py`
- Modify: `backend/app/auth/service.py`（`clear_login_attempts` `:136` 之後）
- Modify: `backend/tests/test_audit_coverage.py:28-41`（`_EXEMPT`）
- Test: `backend/tests/test_password_reset_routes.py`（加測試）

**Interfaces:**
- Consumes: Task 2 `find_token`、`rejection`、`revoke_outstanding`、`OPEN_SOURCE_LIMIT`；Task 3 的 schema 與 `_error`。
- Produces:
  - `POST /auth/password-reset/verify` → 200 `PasswordResetVerifyOut`；連結不能用時回 410 `{"code": "RESET_LINK_INVALID", "message", "reason"}`
  - `POST /auth/password-reset/complete` → 204；錯誤同上；新密碼不合規則時 422
  - 來源限流 429 `RESET_LINK_SOURCE_LIMITED`；Origin 不符 403
  - `service.clear_login_lock(limiter, email) -> None`（Task 5 也用）
  - 稽核：`user.password_reset_link_rejected` `{"reason"}`、`user.password_reset_completed` `{"revoked_sessions"}`；actor 是本人

- [ ] **Step 1: 寫失敗的測試**

`backend/tests/test_password_reset_routes.py` 檔尾加：

```python
# ------------------------------------------------------------ 確認連結、設定新密碼


async def test_verify_returns_account_and_deadline(app, admin_client, db_session, mailer):
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    token = await _send(admin_client, target.id, mailer)
    async with _anon(app) as anon:
        ok = await anon.post(VERIFY, json={"token": token})
    assert ok.status_code == 200, ok.text
    assert ok.json()["email"] == STAFF
    assert "no-store" in ok.headers["cache-control"]
    assert ok.headers["referrer-policy"] == "no-referrer"


async def test_unknown_token_is_410_without_audit(app, db_session):
    async with _anon(app) as anon:
        verify = await anon.post(VERIFY, json={"token": "x" * 43})
        complete = await anon.post(COMPLETE, json={"token": "x" * 43, "new_password": NEW_PW})
    for response in (verify, complete):
        assert response.status_code == 410
        assert response.json()["detail"]["code"] == "RESET_LINK_INVALID"
        assert response.json()["detail"]["reason"] == "link_unknown"
    assert await _audits(db_session, "user.password_reset_link_rejected") == []


async def test_complete_sets_password_logs_out_everywhere_and_is_single_use(app, admin_client, db_session, mailer):
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    victim = await _logged_in_client(app, STAFF, STAFF_PW)
    token = await _send(admin_client, target.id, mailer)
    try:
        async with _anon(app) as anon:
            done = await anon.post(COMPLETE, json={"token": token, "new_password": NEW_PW})
            assert done.status_code == 204, done.text
            again = await anon.post(COMPLETE, json={"token": token, "new_password": "another-password-789"})
            assert again.status_code == 410
            assert again.json()["detail"]["reason"] == "link_used"
            assert (await victim.get(f"{API}/auth/me")).status_code == 401
            assert (await anon.post(LOGIN, json={"email": STAFF, "password": STAFF_PW})).status_code == 401
            assert (await anon.post(LOGIN, json={"email": STAFF, "password": NEW_PW})).status_code == 200
    finally:
        await victim.aclose()

    completed = await _audits(db_session, "user.password_reset_completed")
    assert len(completed) == 1
    assert completed[0].actor_user_id == target.id
    assert completed[0].metadata_json == {"revoked_sessions": 1}
    rejected = await _audits(db_session, "user.password_reset_link_rejected")
    assert [entry.metadata_json for entry in rejected] == [{"reason": "link_used"}]


async def test_expired_link_is_rejected_and_audited(app, admin_client, db_session, mailer):
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    token = await _send(admin_client, target.id, mailer)
    await db_session.execute(
        update(PasswordResetToken)
        .where(PasswordResetToken.user_id == target.id)
        .values(expires_at=datetime.now(timezone.utc) - timedelta(seconds=1))
    )
    await db_session.commit()
    async with _anon(app) as anon:
        verify = await anon.post(VERIFY, json={"token": token})
        complete = await anon.post(COMPLETE, json={"token": token, "new_password": NEW_PW})
        still_old = await anon.post(LOGIN, json={"email": STAFF, "password": STAFF_PW})
    assert verify.json()["detail"]["reason"] == "link_expired"
    assert complete.status_code == 410
    assert complete.json()["detail"]["reason"] == "link_expired"
    assert still_old.status_code == 200
    rejected = await _audits(db_session, "user.password_reset_link_rejected")
    # 只有送出新密碼才寫稽核；打開連結（verify）不寫。
    assert [entry.metadata_json for entry in rejected] == [{"reason": "link_expired"}]


async def test_rejected_new_password_does_not_use_up_the_link(app, admin_client, db_session, mailer):
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    token = await _send(admin_client, target.id, mailer)
    async with _anon(app) as anon:
        short = await anon.post(COMPLETE, json={"token": token, "new_password": "short"})
        too_long = await anon.post(COMPLETE, json={"token": token, "new_password": "常" * 25})
        verify = await anon.post(VERIFY, json={"token": token})
    assert short.status_code == 422
    assert too_long.status_code == 422
    assert verify.status_code == 200
    assert len(await _live_tokens(db_session, target.id)) == 1


async def test_inactive_account_cannot_use_link(app, admin_client, db_session, mailer):
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    token = await _send(admin_client, target.id, mailer)
    # 直接改 DB（不走停用端點）：只驗「帳號停用」這一條判斷；停用端點會順便作廢連結，見 Task 5。
    await db_session.execute(update(User).where(User.id == target.id).values(is_active=False))
    await db_session.commit()
    async with _anon(app) as anon:
        verify = await anon.post(VERIFY, json={"token": token})
        complete = await anon.post(COMPLETE, json={"token": token, "new_password": NEW_PW})
    assert verify.json()["detail"]["reason"] == "inactive"
    assert complete.json()["detail"]["reason"] == "inactive"


async def test_complete_lifts_the_password_login_lock(app, admin_client, db_session, mailer):
    freeze_rate_limit_clock(app)
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    token = await _send(admin_client, target.id, mailer)
    async with _anon(app) as anon:
        for _ in range(10):
            await anon.post(LOGIN, json={"email": STAFF, "password": "wrong-password-xx"})
        locked = await anon.post(LOGIN, json={"email": STAFF, "password": STAFF_PW})
        assert locked.json()["detail"]["code"] == "LOGIN_LOCKED"
        assert (await anon.post(COMPLETE, json={"token": token, "new_password": NEW_PW})).status_code == 204
        assert (await anon.post(LOGIN, json={"email": STAFF, "password": NEW_PW})).status_code == 200


async def test_cross_site_origin_is_refused(app, admin_client, db_session, mailer):
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    token = await _send(admin_client, target.id, mailer)
    async with _anon(app) as anon:
        response = await anon.post(COMPLETE, json={"token": token, "new_password": NEW_PW}, headers={"Origin": "https://evil.example"})
    assert response.status_code == 403
    assert len(await _live_tokens(db_session, target.id)) == 1


async def test_open_and_submit_share_a_per_source_limit(app):
    freeze_rate_limit_clock(app)
    async with _anon(app) as anon:
        statuses = [(await anon.post(VERIFY, json={"token": "x" * 43})).status_code for _ in range(31)]
    assert statuses[:30] == [410] * 30
    assert statuses[30] == 429
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pwreset_test uv run --frozen pytest -q tests/test_password_reset_routes.py
```

預期：新加的 9 項 FAIL，verify 和 complete 都回 404。

- [ ] **Step 3: 加 `clear_login_lock`**

`backend/app/auth/service.py` 的 `clear_login_attempts`（`:136-137`）之後加：

```python
async def clear_login_lock(limiter: ratelimit.RateLimiter, email: str) -> None:
    """重設密碼後解除密碼登入暫停與失敗計數。帳號鎖是用來擋猜舊密碼的；密碼換掉
    之後，本人應該能立刻用新密碼登入。限流池忙碌時 reset 只記 warning，鎖會照原本
    的期限自然解除。"""
    key = _rate_limit_key(email)
    await limiter.reset(LOGIN_LOCK, key)
    await limiter.reset(LOGIN_ACCOUNT_LIMIT, key)
```

- [ ] **Step 4: 加兩支公開端點**

`backend/app/auth/password_reset_routes.py`：

import 區改成：

```python
import asyncio
import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import password_reset, service
from app.auth.deps import get_current_user, get_db_session
from app.auth.models import PasswordResetToken, User
from app.auth.oauth_common import private
from app.auth.permissions import require_scope
from app.auth.schemas import (
    PasswordResetCompleteRequest,
    PasswordResetLinkOut,
    PasswordResetTokenRequest,
    PasswordResetVerifyOut,
)
from app.common import ratelimit
from app.operations import audit_service
```

檔尾加：

```python
# 連結不能用時給本人看的話：每一種都說下一步。
_INVALID_MESSAGES = {
    password_reset.REJECT_UNKNOWN: "這個重設連結無效。請直接點信裡的連結，或請總管理者重新寄一次。",
    password_reset.REJECT_EXPIRED: "這個重設連結已過期（30 分鐘內有效），請總管理者重新寄一次。",
    password_reset.REJECT_USED: "這個重設連結已經用過了。密碼已更新，請直接登入；忘記新密碼請總管理者重新寄一次。",
    password_reset.REJECT_REVOKED: "這個重設連結已失效：之後又寄了新的連結，或密碼已經變更。請使用最新一封信裡的連結。",
    password_reset.REJECT_INACTIVE: "這個帳號已停用，無法重設密碼，請聯絡總管理者。",
}


def _invalid(reason: str) -> HTTPException:
    return _error(status.HTTP_410_GONE, "RESET_LINK_INVALID", _INVALID_MESSAGES[reason], reason=reason)


def _check_origin(request: Request) -> None:
    """不用登入的端點沒有 CSRF token 可比；Origin 一樣要對（比照 deps.check_csrf_and_origin）。"""
    admin_origin = request.app.state.settings.admin_origin
    origin = request.headers.get("origin")
    if admin_origin and origin is not None and origin != admin_origin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Origin 不符")


async def _check_source_limit(request: Request) -> None:
    try:
        await ratelimit.limiter(request).check(password_reset.OPEN_SOURCE_LIMIT, ratelimit.client_key(request))
    except ratelimit.RateLimited as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={"code": "RESET_LINK_SOURCE_LIMITED", "message": "嘗試太頻繁或系統忙碌，請稍候再試"},
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc


@router.post("/auth/password-reset/verify", response_model=PasswordResetVerifyOut)
async def verify_password_reset_link(
    payload: PasswordResetTokenRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db_session),
) -> PasswordResetVerifyOut:
    """打開重設連結時先確認還能不能用，能用就回帳號與期限。只讀不寫：不消耗連結，
    也不寫稽核（送出新密碼時才寫，test_audit_coverage 有列例外）。"""
    private(response)
    _check_origin(request)
    await _check_source_limit(request)
    token = await password_reset.find_token(db, payload.token)
    if token is None:
        raise _invalid(password_reset.REJECT_UNKNOWN)
    user = await db.get(User, token.user_id)
    reason = password_reset.rejection(token, user, datetime.now(timezone.utc))
    if reason is not None:
        raise _invalid(reason)
    return PasswordResetVerifyOut(email=user.email, expires_at=token.expires_at)


@router.post("/auth/password-reset/complete", status_code=status.HTTP_204_NO_CONTENT)
async def complete_password_reset(
    payload: PasswordResetCompleteRequest,
    request: Request,
    db: AsyncSession = Depends(get_db_session),
) -> None:
    """用重設連結設定新密碼：連結標成已用、其他還有效的連結作廢、所有 session 登出、
    解除密碼登入暫停。不自動登入，前端導回登入頁。

    無效的 token 不跑 bcrypt；有效的先算好雜湊（約 250 ms）再上鎖，鎖住期間不做慢的事。
    鎖的順序跟寄連結一樣「帳號 → 連結」。等鎖期間連結可能被用掉或作廢，上鎖後再判斷一次。"""
    _check_origin(request)
    await _check_source_limit(request)
    token = await password_reset.find_token(db, payload.token)
    if token is None:
        raise _invalid(password_reset.REJECT_UNKNOWN)
    user = await db.get(User, token.user_id)
    reason = password_reset.rejection(token, user, datetime.now(timezone.utc))
    new_hash = None
    if reason is None:
        new_hash = await service.hash_password_async(payload.new_password)
        await db.execute(
            select(User).where(User.id == token.user_id).with_for_update().execution_options(populate_existing=True)
        )
        await db.execute(
            select(PasswordResetToken)
            .where(PasswordResetToken.id == token.id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        reason = password_reset.rejection(token, user, datetime.now(timezone.utc))
    if reason is not None:
        # 對得到帳號才寫稽核（亂打的 token 上面就回了，不會走到這裡）。
        await audit_service.log_action(
            db,
            actor_user_id=None,
            action="user.password_reset_link_rejected",
            target_type="user",
            target_id=str(token.user_id),
            metadata={"reason": reason},
        )
        await db.commit()
        raise _invalid(reason)

    now = datetime.now(timezone.utc)
    user.password_hash = new_hash
    token.used_at = now
    await password_reset.revoke_outstanding(db, user.id, now=now)
    revoked = await service.revoke_user_sessions(db, user.id)
    await audit_service.log_action(
        db,
        actor_user_id=user.id,
        action="user.password_reset_completed",
        target_type="user",
        target_id=str(user.id),
        metadata={"revoked_sessions": revoked},
    )
    await db.commit()
    await service.clear_login_lock(ratelimit.limiter(request), user.email)
```

（`revoke_outstanding` 的條件是 `used_at IS NULL`；這一條已經先標成 used，所以只會作廢其他連結。）

- [ ] **Step 5: verify 列入稽核例外**

`backend/tests/test_audit_coverage.py` 的 `_EXEMPT` 加一行（放在 `retention/dry-run` 那行之後）：

```python
    ("POST", "/api/website/v1/auth/password-reset/verify"): (
        "只確認重設連結還能不能用，不改任何資料；送出新密碼（complete）才寫稽核"
    ),
```

- [ ] **Step 6: 跑測試確認通過**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pwreset_test uv run --frozen pytest -q tests/test_password_reset_routes.py tests/test_audit_coverage.py tests/test_secfix_auth.py
```

預期：`test_password_reset_routes.py` 17 passed；另外兩檔全過。

- [ ] **Step 7: Commit**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003
git add backend/app/auth/password_reset_routes.py backend/app/auth/service.py backend/tests/test_audit_coverage.py backend/tests/test_password_reset_routes.py
git commit -m "feat(auth): 用重設連結設定新密碼（單次、登出所有裝置、解除密碼登入暫停）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: 停用、改密碼、直接重設與連結的互動

**Files:**
- Modify: `backend/app/auth/routes.py`：`update_user_active`（`:306`）、`reset_user_password`（`:437`）、`change_own_password`（`:469`）
- Test: `backend/tests/test_password_reset_interactions.py`

**Interfaces:**
- Consumes: `password_reset.revoke_outstanding`（Task 2）、`service.clear_login_lock`（Task 4）、Task 3 測試檔的 fixture 寫法。
- Produces: 停用帳號、本人改密碼、總管理者直接設新密碼這三個動作，都會讓還沒用的連結作廢。直接設新密碼也會解除密碼登入暫停（設計決定第 7 條）。

- [ ] **Step 1: 寫失敗的測試**

建 `backend/tests/test_password_reset_interactions.py`：

```python
"""重設密碼連結跟既有帳號操作的互動（2026-10-03）：停用、本人改密碼、總管理者直接
設新密碼，都會讓還沒用的連結作廢；直接設新密碼也解除密碼登入暫停。"""
from __future__ import annotations

import re

import httpx
import pytest

from app.auth import password_reset
from app.auth.models import Role
from tests.conftest import _create_user, _logged_in_client, freeze_rate_limit_clock

API = "/api/website/v1"
STAFF = "staff@ivy.example"
STAFF_PW = "staff-password-123"
NEW_PW = "brand-new-password-456"
LOGIN = f"{API}/auth/login"
COMPLETE = f"{API}/auth/password-reset/complete"


@pytest.fixture
def mailer(app, monkeypatch, recording_mail_adapter):
    app.state.settings = app.state.settings.model_copy(update={"admin_origin": "http://test"})
    monkeypatch.setattr(password_reset, "mail_adapter", lambda settings: recording_mail_adapter)
    return recording_mail_adapter


async def _send(admin_client, user_id, mailer) -> str:
    response = await admin_client.post(f"{API}/admin/users/{user_id}/password-reset-link")
    assert response.status_code == 200, response.text
    match = re.search(r"#token=([A-Za-z0-9_\-]+)", mailer.sent[-1]["body"])
    assert match
    return match.group(1)


async def _complete(app, token: str) -> httpx.Response:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as anon:
        return await anon.post(COMPLETE, json={"token": token, "new_password": NEW_PW})


async def test_deactivating_account_revokes_links(app, admin_client, db_session, mailer):
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    token = await _send(admin_client, target.id, mailer)
    assert (await admin_client.patch(f"{API}/admin/users/{target.id}/active", json={"is_active": False})).status_code == 200
    assert (await admin_client.patch(f"{API}/admin/users/{target.id}/active", json={"is_active": True})).status_code == 200
    # 恢復帳號後，停用前寄的連結也不會復活。
    response = await _complete(app, token)
    assert response.status_code == 410
    assert response.json()["detail"]["reason"] == "link_revoked"


async def test_changing_own_password_revokes_links(app, admin_client, db_session, mailer):
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    token = await _send(admin_client, target.id, mailer)
    me = await _logged_in_client(app, STAFF, STAFF_PW)
    try:
        changed = await me.post(f"{API}/auth/change-password", json={"current_password": STAFF_PW, "new_password": "my-own-new-password-1"})
        assert changed.status_code == 204, changed.text
    finally:
        await me.aclose()
    response = await _complete(app, token)
    assert response.json()["detail"]["reason"] == "link_revoked"


async def test_direct_reset_revokes_links_and_lifts_the_lock(app, admin_client, db_session, mailer):
    freeze_rate_limit_clock(app)
    target = await _create_user(db_session, STAFF, STAFF_PW, Role.EDITOR, ["yihua"])
    token = await _send(admin_client, target.id, mailer)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as anon:
        for _ in range(10):
            await anon.post(LOGIN, json={"email": STAFF, "password": "wrong-password-xx"})
        assert (await anon.post(LOGIN, json={"email": STAFF, "password": STAFF_PW})).status_code == 429
        reset = await admin_client.post(f"{API}/admin/users/{target.id}/password", json={"password": "admin-set-password-1"})
        assert reset.status_code == 204, reset.text
        assert (await anon.post(LOGIN, json={"email": STAFF, "password": "admin-set-password-1"})).status_code == 200
    response = await _complete(app, token)
    assert response.json()["detail"]["reason"] == "link_revoked"
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pwreset_test uv run --frozen pytest -q tests/test_password_reset_interactions.py
```

預期：3 項 FAIL。前兩項的 complete 回 204，因為連結沒被作廢；第三項登入回 429，因為帳號鎖還在。

- [ ] **Step 3: 停用時作廢連結**

`backend/app/auth/routes.py` `update_user_active` 裡，`except service.LastSuperAdminProtected …` 區塊之後、`await audit_service.log_action(` 之前加：

```python
    if not payload.is_active:
        # 停用前寄出的重設連結不能留著：之後恢復帳號時才不會復活。
        await password_reset.revoke_outstanding(db, user.id)
```

- [ ] **Step 4: 直接設新密碼時作廢連結並解鎖**

`reset_user_password`（`:437`）簽名加 `request: Request,`（放在 `payload` 之後），docstring 最後補一句「也會作廢還沒用的重設連結、解除密碼登入暫停（2026-10-03）」。把

```python
    revoked = await service.revoke_user_sessions(db, user.id)
```

改成

```python
    revoked = await service.revoke_user_sessions(db, user.id)
    await password_reset.revoke_outstanding(db, user.id)
```

並在函式最後的 `await db.commit()` 之後加：

```python
    await service.clear_login_lock(ratelimit.limiter(request), user.email)
```

- [ ] **Step 5: 本人改密碼時作廢連結**

`change_own_password`（`:469`）裡把

```python
    await service.revoke_user_sessions(db, user.id, keep_session_id=session.id)
```

改成

```python
    await service.revoke_user_sessions(db, user.id, keep_session_id=session.id)
    await password_reset.revoke_outstanding(db, user.id)
```

- [ ] **Step 6: 跑測試確認通過**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pwreset_test uv run --frozen pytest -q tests/test_password_reset_interactions.py tests/test_roles_and_passwords.py tests/test_secfix_auth.py tests/test_password_reset_routes.py
```

預期：全部 passed。如果 `test_secfix_auth.py` 裡有斷言「重設密碼後帳號仍鎖定」的測試失敗，那是設計決定第 7 條刻意改的行為：把那項斷言改成新行為，並在 commit 訊息註明。

- [ ] **Step 7: Commit**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003
git add backend/app/auth/routes.py backend/tests/test_password_reset_interactions.py
git commit -m "feat(auth): 停用、改密碼、直接重設都作廢重設連結；直接重設也解除密碼登入暫停

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: 契約、型別與操作紀錄中文

**Files:**
- Regenerate: `contracts/openapi.json`、`contracts/generated/website-api.d.ts`
- Modify: `admin/src/api/types.ts:14`（之後加別名）
- Modify: `admin/src/api/labels.ts`：`AUDIT_ACTION_LABELS`（`:411` 附近）、`AUDIT_REASON_LABELS`（`:496` 之前）、`AUDIT_METADATA_FORMATTERS`（`:1204` 附近）
- Test: `admin/src/__tests__/passwordResetLabels.test.ts`

**Interfaces:**
- Consumes: Task 3、4 的 API schema 與稽核動作。
- Produces: `PasswordResetLinkOut`、`PasswordResetVerifyOut` 型別（Task 7、8 用）；四種動作、三種原因與 `error_code` 的中文。

- [ ] **Step 1: 重產契約**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm run contract:generate
git diff --stat contracts/
```

預期：`contracts/openapi.json` 與 `contracts/generated/website-api.d.ts` 有變動，新增三個路徑、四個 schema，`FeatureFlags` 多出 `password_reset_email?: boolean`。

- [ ] **Step 2: 寫失敗的測試**

建 `admin/src/__tests__/passwordResetLabels.test.ts`：

```ts
// 2026-10-03 重設密碼連結：操作紀錄的動作、原因與寄送失敗原因都有中文。
import { describe, expect, it } from 'vitest'
import { auditActionLabel, auditMetadataSummary, auditReasonLabel } from '../api/labels'

describe('重設密碼連結的操作紀錄', () => {
  it('四種動作都有中文', () => {
    expect(auditActionLabel('user.password_reset_link_sent')).toBe('寄出重設密碼連結')
    expect(auditActionLabel('user.password_reset_link_failed')).toBe('重設密碼連結沒有寄出')
    expect(auditActionLabel('user.password_reset_link_rejected')).toBe('重設密碼連結無效，沒有改密碼')
    expect(auditActionLabel('user.password_reset_completed')).toBe('用重設連結設定新密碼')
  })

  it('連結無效的原因翻成白話', () => {
    expect(auditReasonLabel('link_expired')).toBe('連結已過期')
    expect(auditReasonLabel('link_used')).toBe('連結已經用過')
    expect(auditReasonLabel('link_revoked')).toBe('連結已作廢（寄了新連結、密碼已變更或帳號停用）')
    expect(auditMetadataSummary({ reason: 'link_expired' }, 'user.password_reset_link_rejected')).toBe('原因：連結已過期')
  })

  it('寄送失敗的錯誤類別翻成大概原因', () => {
    expect(auditMetadataSummary({ error_code: 'SMTPAuthenticationError' }, 'user.password_reset_link_failed')).toBe(
      '寄送失敗原因：寄信伺服器帳號或密碼錯誤',
    )
  })

  it('寄出時記的期限與是否取代舊連結沿用既有寫法', () => {
    const summary = auditMetadataSummary({ expires_at: '2026-10-03T06:52:00Z', replaced_previous: true }, 'user.password_reset_link_sent')
    expect(summary).toContain('連結到期')
    expect(summary).toContain('先前的連結同時失效')
  })
})
```

- [ ] **Step 3: 跑測試確認失敗**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/passwordResetLabels.test.ts src/__tests__/labelCoverage.test.ts
```

預期：`passwordResetLabels.test.ts` 前三項 FAIL，`auditActionLabel` 原樣回傳英文代碼。`labelCoverage.test.ts` 的「每一種稽核動作都有中文」與「每個鍵都有中文寫法」也 FAIL，它會掃到後端新的 action 與 `error_code`。

- [ ] **Step 4: 加型別別名**

`admin/src/api/types.ts` 在 `export type CampusOut = …`（`:14`）之後加：

```ts
export type PasswordResetLinkOut = components['schemas']['PasswordResetLinkOut']
export type PasswordResetVerifyOut = components['schemas']['PasswordResetVerifyOut']
```

- [ ] **Step 5: 加中文**

先確認 `error_code` 沒有被用掉：

```bash
grep -n "error_code" admin/src/api/labels.ts
```

預期：只看得到 `previous_error_code`，沒有單獨的 `error_code` 鍵，也不在 `AUDIT_HIDDEN_METADATA_KEYS` 裡。

`AUDIT_ACTION_LABELS` 在 `'user.change_password': '變更自己的密碼',`（`:412`）之後加：

```ts
  'user.password_reset_link_sent': '寄出重設密碼連結',
  'user.password_reset_link_failed': '重設密碼連結沒有寄出',
  'user.password_reset_link_rejected': '重設密碼連結無效，沒有改密碼',
  'user.password_reset_completed': '用重設連結設定新密碼',
```

`AUDIT_REASON_LABELS` 在 `still_referenced: …`（`:496`）之後加：

```ts
  // 重設密碼連結不能用的原因（user.password_reset_link_rejected，2026-10-03）。
  link_expired: '連結已過期',
  link_used: '連結已經用過',
  link_revoked: '連結已作廢（寄了新連結、密碼已變更或帳號停用）',
```

`AUDIT_METADATA_FORMATTERS` 在 `revoked_sessions: …`（`:1204`）之後加：

```ts
  // 重設密碼連結沒有寄出時的錯誤類別（SMTP 例外名稱），翻成大概原因。
  error_code: (v) => `寄送失敗原因：${outboxErrorLabel(String(v))}`,
```

（`outboxErrorLabel` 在同一檔 `:374`，不用另外 import。）

- [ ] **Step 6: 跑測試與型別檢查**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/passwordResetLabels.test.ts src/__tests__/labelCoverage.test.ts src/__tests__/ux20260928H.test.ts; npm --prefix admin run typecheck; npm run contract:check
```

預期：三個測試檔全過；typecheck 沒有錯誤；contract:check 印出「契約型別與 openapi.json 一致」。

- [ ] **Step 7: Commit**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003
git add contracts/openapi.json contracts/generated/website-api.d.ts admin/src/api/types.ts admin/src/api/labels.ts admin/src/__tests__/passwordResetLabels.test.ts
git commit -m "chore(contracts): 重產重設密碼連結 API 契約，操作紀錄補中文

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: 使用者頁「重設密碼」對話框加寄連結

**Files:**
- Modify: `admin/src/views/UsersView.vue`：import（`:2-16`）、狀態（`:36-39` 附近）、`openReset`／`submitReset`／`clearReset`（`:383-438`）、對話框（`:651-675`）、`<style scoped>`
- Modify: `admin/src/__tests__/usersUx.test.ts:132`
- Test: `admin/src/__tests__/passwordResetLink.test.ts`

**Interfaces:**
- Consumes: `PasswordResetLinkOut`（Task 6）、`authStore.features.password_reset_email`（Task 3）、`POST /admin/users/{id}/password-reset-link`。
- Produces: 對話框的 `data-test`：`reset-link-sent`（寄出結果）、`reset-link-disabled`（不能寄的說明）、`reset-password`（直接設定的結果，原有）。

- [ ] **Step 1: 寫失敗的測試**

建 `admin/src/__tests__/passwordResetLink.test.ts`：

```ts
// 2026-10-03 使用者頁：重設密碼預設寄連結給本人設定；沒設定寄信時只能直接設定新密碼。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { computed, defineComponent } from 'vue'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter, matchedRouteKey } from 'vue-router'
import ElementPlus, { ElMessage } from 'element-plus'
import UsersView from '../views/UsersView.vue'
import { api, ApiError } from '../api/client'
import { useAuthStore } from '../stores/auth'
import { testUser } from './fixtures'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

const other = testUser('campus_admin', { id: 'u2', email: 'ca@ivy.example', campus_keys: ['yihua'] })
const SENT = { sent_to: 'ca@ivy.example', expires_at: '2026-10-03T06:52:00Z', replaced_previous: false }

async function setup(passwordResetEmail: boolean) {
  const pinia = createPinia()
  const auth = useAuthStore(pinia)
  auth.user = testUser('super_admin', { id: 'local-test', email: 'test@example.invalid' })
  auth.features = { admissions: false, password_reset_email: passwordResetEmail }
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/:pathMatch(.*)*', component: defineComponent({ template: '<div />' }) }] })
  await router.push('/users')
  await router.isReady()
  const wrapper = mount(UsersView, { global: { plugins: [pinia, router, ElementPlus], provide: { [matchedRouteKey as symbol]: computed(() => router.currentRoute.value.matched[0]) } } })
  wrappers.push(wrapper)
  await flushPromises()
  return wrapper
}
function button(wrapper: VueWrapper, text: string) {
  return wrapper.findAll('button').find(item => item.text() === text)
}
function openDialog(wrapper: VueWrapper) {
  return wrapper.findAllComponents({ name: 'ElDialog' }).find(dialog => dialog.props('modelValue'))!
}
function radio(wrapper: VueWrapper, text: string) {
  return openDialog(wrapper).findAllComponents({ name: 'ElRadio' }).find(item => item.text().includes(text))!
}
async function openReset(wrapper: VueWrapper) {
  await button(wrapper, '重設密碼')!.trigger('click')
  await flushPromises()
}

describe('寄重設密碼連結（2026-10-03）', () => {
  it('有寄信時預設寄連結；寄出後顯示寄到哪裡、幾點前有效，按完成才關', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([other] as never)
    const post = vi.spyOn(api, 'post').mockResolvedValue(SENT as never)
    const wrapper = await setup(true)
    await openReset(wrapper)
    expect(radio(wrapper, '寄重設連結').classes()).toContain('is-checked')
    expect(openDialog(wrapper).find('input[aria-label="新密碼"]').exists()).toBe(false)
    await button(wrapper, '寄出重設連結')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith('/admin/users/u2/password-reset-link')
    const sent = wrapper.get('[data-test="reset-link-sent"]')
    expect(sent.text()).toContain('已寄出重設連結到 ca@ivy.example')
    expect(sent.text()).toContain('10/03 14:52')
    expect(sent.text()).not.toContain('先前寄的連結已經失效')
    expect(openDialog(wrapper).props('closeOnClickModal')).toBe(false)
    await button(wrapper, '完成')!.trigger('click')
    await flushPromises()
    expect(wrapper.findAllComponents({ name: 'ElDialog' }).some(dialog => dialog.props('modelValue'))).toBe(false)
  })

  it('再寄一次時說明先前的連結已經失效', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([other] as never)
    vi.spyOn(api, 'post').mockResolvedValue({ ...SENT, replaced_previous: true } as never)
    const wrapper = await setup(true)
    await openReset(wrapper)
    await button(wrapper, '寄出重設連結')!.trigger('click')
    await flushPromises()
    expect(wrapper.get('[data-test="reset-link-sent"]').text()).toContain('先前寄的連結已經失效')
  })

  it('沒設定寄信時「寄重設連結」停用並說明，直接設定新密碼照舊', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([other] as never)
    const wrapper = await setup(false)
    await openReset(wrapper)
    expect(radio(wrapper, '寄重設連結').classes()).toContain('is-disabled')
    expect(radio(wrapper, '直接設定新密碼').classes()).toContain('is-checked')
    expect(wrapper.get('[data-test="reset-link-disabled"]').text()).toContain('尚未設定寄信')
    expect(openDialog(wrapper).find('input[aria-label="新密碼"]').exists()).toBe(true)
    expect(button(wrapper, '寄出重設連結')).toBeUndefined()
  })

  it('寄送失敗時說明原因，對話框留著，可以改用直接設定', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([other] as never)
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(502, { code: 'RESET_EMAIL_FAILED', message: '重設連結沒有寄出，請稍後再試，或改用「直接設定新密碼」', error_code: 'SMTPAuthenticationError' }),
    )
    const error = vi.spyOn(ElMessage, 'error')
    const wrapper = await setup(true)
    await openReset(wrapper)
    await button(wrapper, '寄出重設連結')!.trigger('click')
    await flushPromises()
    expect(error).toHaveBeenCalledWith(expect.objectContaining({
      message: '重設連結沒有寄出，請稍後再試，或改用「直接設定新密碼」（寄信伺服器帳號或密碼錯誤）',
    }))
    expect(wrapper.find('[data-test="reset-link-sent"]').exists()).toBe(false)
    await radio(wrapper, '直接設定新密碼').find('input').setValue(true)
    await flushPromises()
    expect(openDialog(wrapper).find('input[aria-label="新密碼"]').exists()).toBe(true)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/passwordResetLink.test.ts
```

預期：4 項 FAIL，找不到「寄重設連結」的 ElRadio。

- [ ] **Step 3: script 改動**

`admin/src/views/UsersView.vue`：

1. `import { apiErrorMessage, apiFieldError } from '../api/errors'` 改成 `import { apiErrorCode, apiErrorMessage, apiFieldError } from '../api/errors'`。
2. `import { CAMPUS_KEYS, type Role, type UserOut } from '../api/types'` 改成 `import { CAMPUS_KEYS, type PasswordResetLinkOut, type Role, type UserOut } from '../api/types'`。
3. labels 那行 import 加上 `formatShortDateTime, outboxErrorLabel`。
4. `const resetting = ref(false)`（`:39`）之後加：

```ts
// 2026-10-03：重設密碼有兩種方式。有寄信時預設寄連結給本人設定（使用者裁定只做總管理者寄連結）；
// 沒設定寄信的部署只能直接設定新密碼（原本的做法）。
type ResetMode = 'link' | 'direct'
const resetMode = ref<ResetMode>('direct')
const linkResult = ref<PasswordResetLinkOut | null>(null)
const linkEnabled = computed(() => authStore.features.password_reset_email === true)
```

5. `openReset` 裡的 `clearReset()` 之後加一行：

```ts
  resetMode.value = linkEnabled.value ? 'link' : 'direct'
```

6. `submitReset` 函式之後加：

```ts
// 寄送失敗時後端多帶 error_code（SMTP 例外名稱），翻成大概原因接在訊息後面。
function resetLinkError(err: unknown): string {
  const message = apiErrorMessage(err, '重設連結沒有寄出，請稍後再試')
  if (!(err instanceof ApiError) || apiErrorCode(err) !== 'RESET_EMAIL_FAILED') return message
  const code = (err.detail as { error_code?: unknown } | null)?.error_code
  return typeof code === 'string' ? `${message}（${outboxErrorLabel(code)}）` : message
}

async function submitLink() {
  if (!resetTarget.value || linkResult.value || !linkEnabled.value) return
  resetting.value = true
  try {
    linkResult.value = await api.post<PasswordResetLinkOut>(`/admin/users/${resetTarget.value.id}/password-reset-link`)
  } catch (err) {
    notifyError(resetLinkError(err))
  } finally {
    resetting.value = false
  }
}
```

7. `clearReset()` 改成：

```ts
function clearReset() {
  resetPassword.value = ''
  resetDone.value = false
  linkResult.value = null
}
```

- [ ] **Step 4: 換掉對話框**

把 `:651-675` 整段 `<el-dialog v-model="resetVisible" …>…</el-dialog>` 換成：

```vue
      <el-dialog v-model="resetVisible" :title="`重設 ${staffWithEmail(resetTarget)} 的密碼`" width="460px" :show-close="!resetting" :close-on-click-modal="!resetting && !resetDone && !linkResult" :close-on-press-escape="!resetting" @closed="clearReset">
        <div v-if="linkResult" class="password-result" data-test="reset-link-sent">
          <el-alert type="success" :closable="false" show-icon :title="`已寄出重設連結到 ${linkResult.sent_to}`" />
          <p class="hint">連結在 {{ formatShortDateTime(linkResult.expires_at) }} 前有效，只能用一次。對方設好新密碼後，所有已登入的裝置都會登出。<template v-if="linkResult.replaced_previous">先前寄的連結已經失效。</template></p>
          <p class="hint">對方沒收到信：請他看看垃圾郵件，或再寄一次（前一封的連結會失效）。</p>
        </div>
        <div v-else-if="resetDone" class="password-result" data-test="reset-password">
          <el-alert type="success" :closable="false" show-icon title="已重設密碼，對方所有裝置都已登出" />
          <p class="hint">系統不會寄信。請用電話或當面把下面的新密碼告訴 {{ staffWithEmail(resetTarget) }}；按「完成」關閉後，這裡不會再顯示。</p>
          <div class="password-row">
            <el-input ref="resetResultInput" :model-value="resetPassword" readonly aria-label="新密碼" class="password-result__value" />
            <el-button type="primary" plain @click="copyPassword(resetPassword, resetResultInput)">複製密碼</el-button>
          </div>
        </div>
        <template v-else>
          <el-radio-group v-model="resetMode" class="reset-mode" aria-label="重設方式" :disabled="resetting">
            <el-radio value="link" :disabled="!linkEnabled">寄重設連結到 {{ resetTarget?.email }}</el-radio>
            <el-radio value="direct">直接設定新密碼</el-radio>
          </el-radio-group>
          <p v-if="resetMode === 'link'" class="hint">對方會收到一封信，點信裡的連結自己設定新密碼。連結 30 分鐘內有效、只能用一次；設好之後，對方所有已登入的裝置都會登出。對方設好之前，原本的密碼照常可用。</p>
          <template v-else>
            <p v-if="!linkEnabled" class="hint" data-test="reset-link-disabled">尚未設定寄信，不能寄重設連結，只能直接設定新密碼。</p>
            <p class="hint">重設後對方所有已登入的裝置會被登出。系統不會寄信；重設後會顯示新密碼與複製鈕，請用電話或當面告訴對方。</p>
            <div class="password-row">
              <el-input v-model="resetPassword" type="text" autocomplete="new-password" placeholder="12 字以上" aria-label="新密碼" :disabled="resetting" />
              <el-button :disabled="resetting" @click="generateResetPassword">產生密碼</el-button>
            </div>
            <span class="field-help" :class="{ 'is-ok': passwordOk(resetPassword) }">{{ passwordHint(resetPassword) }}</span>
          </template>
        </template>
        <template #footer>
          <el-button v-if="resetDone || linkResult" type="primary" @click="resetVisible = false">完成</el-button>
          <template v-else>
            <el-button :disabled="resetting" @click="resetVisible = false">取消</el-button>
            <el-button v-if="resetMode === 'link'" type="primary" :loading="resetting" @click="submitLink">寄出重設連結</el-button>
            <el-button v-else type="primary" :loading="resetting" :disabled="!passwordOk(resetPassword)" @click="submitReset">重設密碼</el-button>
          </template>
        </template>
      </el-dialog>
```

`<style scoped>`（`:680` 起）檔尾 `</style>` 之前加：

```css
.reset-mode {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  margin-bottom: 8px;
}
```

- [ ] **Step 5: 舊測試改用欄位名稱找密碼欄**

`admin/src/__tests__/usersUx.test.ts:132`：對話框最前面多了單選鈕，第一個 `input` 不再是密碼欄。

```ts
    const password = (openDialog(wrapper).find('input').element as HTMLInputElement).value
```

改成

```ts
    const password = (openDialog(wrapper).find('input[aria-label="新密碼"]').element as HTMLInputElement).value
```

- [ ] **Step 6: 跑測試與型別檢查**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/passwordResetLink.test.ts src/__tests__/usersUx.test.ts src/__tests__/displayNames.test.ts src/__tests__/permissionsUx.test.ts; npm --prefix admin run typecheck
```

預期：四個檔全過，typecheck 沒有錯誤。`crossUx20261002.test.ts` 會擋直接呼叫 `ElMessage.error`；這裡走的是 `notifyError`，不受影響。

- [ ] **Step 7: Commit**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003
git add admin/src/views/UsersView.vue admin/src/__tests__/passwordResetLink.test.ts admin/src/__tests__/usersUx.test.ts
git commit -m "feat(admin): 使用者頁重設密碼可寄連結給本人設定，沒設定寄信時照舊直接設定

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: 設定新密碼頁 `/admin/reset-password`

**Files:**
- Create: `admin/src/views/ResetPasswordView.vue`
- Modify: `admin/src/router/index.ts`：`RouteMeta`（`:18-24`）、`routes`（`:35` 之後）、`authGuard`（`:90-91`）
- Modify: `admin/src/views/LoginView.vue:45-49`（`REASON_NOTICES`）
- Test: `admin/src/__tests__/resetPasswordPage.test.ts`

**Interfaces:**
- Consumes: `PasswordResetVerifyOut`（Task 6）；`POST /auth/password-reset/verify`、`/complete`（Task 4）。
- Produces: 路由 `name: 'reset-password'`、`meta.public: true`；登入頁 `reason=password_reset`。

- [ ] **Step 1: 寫失敗的測試**

建 `admin/src/__tests__/resetPasswordPage.test.ts`：

```ts
// 2026-10-03 設定新密碼頁：不用登入；token 只在網址 # 後面，讀到就清掉。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import ElementPlus from 'element-plus'
import ResetPasswordView from '../views/ResetPasswordView.vue'
import LoginView from '../views/LoginView.vue'
import { authGuard, routes } from '../router'
import { api, ApiError } from '../api/client'

const wrappers: VueWrapper[] = []
afterEach(() => { wrappers.forEach(wrapper => wrapper.unmount()); wrappers.length = 0; vi.restoreAllMocks() })

const ACCOUNT = { email: 'ca@ivy.example', expires_at: '2026-10-03T06:52:00Z' }
const NEW_PW = 'new-password-67890'

async function setup(path: string) {
  const pinia = createPinia()
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/reset-password', name: 'reset-password', component: ResetPasswordView },
      { path: '/login', name: 'login', component: defineComponent({ template: '<p>login</p>' }) },
    ],
  })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(ResetPasswordView, { global: { plugins: [pinia, router, ElementPlus] } })
  wrappers.push(wrapper)
  await flushPromises()
  return { wrapper, router }
}

describe('設定新密碼頁', () => {
  it('讀到網址 # 後的代碼就清掉，確認連結後顯示帳號與期限', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue(ACCOUNT as never)
    const { wrapper, router } = await setup('/reset-password#token=abc123')
    expect(post).toHaveBeenCalledWith('/auth/password-reset/verify', { token: 'abc123' })
    expect(router.currentRoute.value.hash).toBe('')
    expect(router.currentRoute.value.fullPath).not.toContain('abc123')
    expect(wrapper.text()).toContain('ca@ivy.example')
    expect(wrapper.text()).toContain('10/03 14:52')
  })

  it('設定新密碼後回登入頁並帶 reason', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValueOnce(ACCOUNT as never).mockResolvedValueOnce(undefined as never)
    const { wrapper, router } = await setup('/reset-password#token=abc123')
    await wrapper.find('#reset-new-password').setValue(NEW_PW)
    await wrapper.find('#reset-confirm-password').setValue(NEW_PW)
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(post).toHaveBeenLastCalledWith('/auth/password-reset/complete', { token: 'abc123', new_password: NEW_PW })
    expect(router.currentRoute.value.name).toBe('login')
    expect(router.currentRoute.value.query.reason).toBe('password_reset')
  })

  it('兩次輸入不一樣或太短時不能送出', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue(ACCOUNT as never)
    const { wrapper } = await setup('/reset-password#token=abc123')
    await wrapper.find('#reset-new-password').setValue(NEW_PW)
    await wrapper.find('#reset-confirm-password').setValue('something-else-123')
    expect(wrapper.text()).toContain('兩次輸入的新密碼不一樣')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(1)
    await wrapper.find('#reset-new-password').setValue('short')
    await wrapper.find('#reset-confirm-password').setValue('short')
    await wrapper.find('form').trigger('submit')
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(1)
  })

  it('連結失效時顯示後端的說明與回登入頁', async () => {
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError(410, { code: 'RESET_LINK_INVALID', reason: 'link_expired', message: '這個重設連結已過期（30 分鐘內有效），請總管理者重新寄一次。' }),
    )
    const { wrapper } = await setup('/reset-password#token=abc123')
    expect(wrapper.get('[data-test="reset-invalid"]').text()).toContain('已過期')
    expect(wrapper.find('#reset-new-password').exists()).toBe(false)
    expect(wrapper.text()).toContain('回登入頁')
  })

  it('網址沒有代碼（例如重新整理後）時請對方回信裡再點一次，不打 API', async () => {
    const post = vi.spyOn(api, 'post')
    const { wrapper } = await setup('/reset-password')
    expect(post).not.toHaveBeenCalled()
    expect(wrapper.get('[data-test="reset-invalid"]').text()).toContain('回到信裡再點一次連結')
  })

  it('連不上伺服器時可以再試一次', async () => {
    const post = vi.spyOn(api, 'post').mockRejectedValueOnce(new TypeError('Failed to fetch')).mockResolvedValueOnce(ACCOUNT as never)
    const { wrapper } = await setup('/reset-password#token=abc123')
    expect(wrapper.text()).toContain('連不上伺服器')
    await wrapper.findAll('button').find(item => item.text() === '再試一次')!.trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('ca@ivy.example')
  })
})

describe('路由與登入頁', () => {
  it('重設密碼頁不用登入，也不會先去恢復 session', async () => {
    setActivePinia(createPinia())
    const get = vi.spyOn(api, 'get')
    const router = createRouter({ history: createMemoryHistory(), routes })
    expect(await authGuard(router.resolve('/reset-password#token=abc') as never)).toBe(true)
    expect(get).not.toHaveBeenCalled()
  })

  it('登入頁說明密碼已更新', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ google: false, line: false } as never)
    const pinia = createPinia()
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/login', name: 'login', component: LoginView }] })
    await router.push('/login?reason=password_reset')
    await router.isReady()
    const wrapper = mount(LoginView, { global: { plugins: [pinia, router, ElementPlus] } })
    wrappers.push(wrapper)
    await flushPromises()
    expect(wrapper.text()).toContain('密碼已更新，請用新密碼登入')
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/resetPasswordPage.test.ts
```

預期：FAIL，`Failed to resolve import "../views/ResetPasswordView.vue"`。

- [ ] **Step 3: 寫頁面**

建 `admin/src/views/ResetPasswordView.vue`：

```vue
<script setup lang="ts">
// 同事點總管理者寄來的重設連結進來（/admin/reset-password#token=…），不需要登入。
// token 只放在網址 # 後面（不會送到伺服器、不進 log）；讀到就用 router.replace 清掉：
// router 自己記著目前位置，只改瀏覽器網址的話，之後寫進 history.state 的 back／current
// 還是帶著 token（同 web/app/pages/visit/manage.vue）。
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, ApiError } from '../api/client'
import { apiErrorMessage } from '../api/errors'
import { formatShortDateTime } from '../api/labels'
import type { PasswordResetVerifyOut } from '../api/types'
import { PASSWORD_MAX_CHARS, passwordHint, passwordOk } from '../composables/passwordRules'
import crestUrl from '../assets/brand/ivy-crest.webp'

const route = useRoute()
const router = useRouter()

type PageState = 'checking' | 'ready' | 'invalid' | 'offline'
const state = ref<PageState>('checking')
const invalidMessage = ref('')
const account = ref<PasswordResetVerifyOut | null>(null)
const form = reactive({ next: '', confirm: '' })
const saving = ref(false)
const error = ref<string | null>(null)
let token = ''

const mismatch = computed(() => Boolean(form.confirm) && form.next !== form.confirm)
const valid = computed(() => passwordOk(form.next) && form.next === form.confirm)

const NO_TOKEN = '這個網址沒有重設連結的代碼（重新整理頁面後就會這樣）。請回到信裡再點一次連結；30 分鐘內、還沒設定過都可以再點。'

/** 410：連結不能用，後端的 message 已經說明原因與下一步。 */
function linkProblem(err: unknown): string | null {
  return err instanceof ApiError && err.status === 410
    ? apiErrorMessage(err, '這個重設連結已失效，請總管理者重新寄一次。')
    : null
}

function showInvalid(message: string) {
  invalidMessage.value = message
  state.value = 'invalid'
}

async function check() {
  state.value = 'checking'
  error.value = null
  try {
    account.value = await api.post<PasswordResetVerifyOut>('/auth/password-reset/verify', { token })
    state.value = 'ready'
  } catch (err) {
    const problem = linkProblem(err)
    if (problem) return showInvalid(problem)
    error.value = err instanceof ApiError ? apiErrorMessage(err, '暫時無法確認連結，請稍後再試。') : '連不上伺服器，請確認網路後再試一次。'
    state.value = 'offline'
  }
}

onMounted(async () => {
  token = new URLSearchParams(route.hash.replace(/^#/, '')).get('token') ?? ''
  if (route.hash) await router.replace({ path: route.path, query: route.query, hash: '' })
  if (!token) return showInvalid(NO_TOKEN)
  await check()
})

async function submit() {
  if (!valid.value || saving.value) return
  saving.value = true
  error.value = null
  try {
    await api.post('/auth/password-reset/complete', { token, new_password: form.next })
    token = ''
    await router.replace({ name: 'login', query: { reason: 'password_reset' } })
  } catch (err) {
    const problem = linkProblem(err)
    if (problem) return showInvalid(problem)
    // 422（例如超過 72 bytes 的 password_too_long）訊息是中文；其他錯誤給一般說法。
    error.value = apiErrorMessage(err, '密碼沒有更新，請稍後再試。')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="reset">
    <main class="reset__card" aria-labelledby="reset-title">
      <img :src="crestUrl" alt="" class="reset__crest" width="64" height="64" />
      <h1 id="reset-title">設定新密碼</h1>

      <p v-if="state === 'checking'" class="reset__lead" role="status">正在確認連結…</p>

      <template v-else-if="state === 'invalid'">
        <el-alert type="warning" :closable="false" show-icon :title="invalidMessage" data-test="reset-invalid" />
        <router-link :to="{ name: 'login' }" class="reset__back">回登入頁</router-link>
      </template>

      <template v-else-if="state === 'offline'">
        <el-alert type="warning" :closable="false" show-icon :title="error ?? ''" />
        <el-button class="reset__retry" @click="check">再試一次</el-button>
      </template>

      <template v-else>
        <p class="reset__lead">帳號：<strong>{{ account?.email }}</strong><br />請在 {{ formatShortDateTime(account?.expires_at) }} 前設定完成。</p>
        <el-form label-position="top" :disabled="saving" @submit.prevent="submit">
          <!-- 讓密碼管理工具知道這是哪個帳號的新密碼。 -->
          <input class="visually-hidden" type="text" name="username" autocomplete="username" :value="account?.email" readonly tabindex="-1" aria-hidden="true" />
          <el-form-item label="新密碼" for="reset-new-password">
            <el-input id="reset-new-password" v-model="form.next" type="password" show-password autocomplete="new-password" :maxlength="PASSWORD_MAX_CHARS" />
            <span class="field-help" data-test="reset-password-hint">{{ passwordHint(form.next) }}</span>
          </el-form-item>
          <el-form-item label="再輸入一次新密碼" for="reset-confirm-password" :error="mismatch ? '兩次輸入的新密碼不一樣' : ''">
            <el-input id="reset-confirm-password" v-model="form.confirm" type="password" show-password autocomplete="new-password" :maxlength="PASSWORD_MAX_CHARS" />
          </el-form-item>
          <el-alert v-if="error" type="error" :closable="false" show-icon :title="error" class="reset__error" />
          <el-button type="primary" size="large" native-type="submit" :loading="saving" :disabled="!valid" class="reset__submit">設定新密碼</el-button>
        </el-form>
        <p class="reset__foot">設定完成後，原本登入中的裝置都會登出，請用新密碼重新登入。</p>
      </template>
    </main>
  </div>
</template>

<style scoped>
.reset {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100svh;
  padding: 32px 16px;
  background: var(--login-bg);
}

.reset__card {
  width: min(100%, 420px);
  padding: 32px 28px 24px;
  background: var(--surface);
  border-radius: 16px;
  box-shadow: var(--shadow-card);
}

.reset__crest {
  display: block;
  margin: 0 auto 12px;
}

.reset__card h1 {
  margin-bottom: 16px;
  font-size: 24px;
  text-align: center;
}

.reset__lead {
  margin-bottom: 20px;
  line-height: 1.7;
}

.reset__back,
.reset__retry {
  display: inline-block;
  margin-top: 16px;
}

.reset__back {
  text-decoration: underline;
  text-underline-offset: 2px;
}

.reset__error {
  margin-bottom: 16px;
}

.reset__submit {
  width: 100%;
}

.reset__foot {
  margin-top: 16px;
  color: var(--ink-3);
  font-size: 13px;
  line-height: 1.6;
}
</style>
```

- [ ] **Step 4: 路由與 authGuard**

`admin/src/router/index.ts`：

1. `interface RouteMeta` 裡 `shared?: boolean` 之後加：

```ts
    /** 不用登入就能開（重設密碼連結）；不恢復 session、不導去登入頁 */
    public?: boolean
```

2. `routes` 裡 `{ path: '/login', … }`（`:35`）之後加：

```ts
  // 總管理者寄的重設密碼連結（2026-10-03）。不用登入，也不在側欄；點進來才下載。
  { path: '/reset-password', name: 'reset-password', component: () => import('../views/ResetPasswordView.vue'), meta: { title: '設定新密碼', public: true } },
```

3. `authGuard` 的 `const authStore = useAuthStore()`（`:91`）之前加：

```ts
  // 不用登入的頁面：不恢復 session、不導去登入頁（重設連結常從信箱 App 的內建瀏覽器開）。
  if (to.meta.public) return true
```

- [ ] **Step 5: 登入頁提示**

`admin/src/views/LoginView.vue` 的 `REASON_NOTICES` 在 `offline: …`（`:48`）之後加：

```ts
  password_reset: { type: 'info', text: '密碼已更新，請用新密碼登入。原本登入中的裝置都已登出。' },
```

- [ ] **Step 6: 跑測試與型別檢查**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run test:unit -- src/__tests__/resetPasswordPage.test.ts src/__tests__/ux20260928A.test.ts; npm --prefix admin run typecheck
```

預期：兩個檔全過，typecheck 沒有錯誤。如果 `ux20260928A.test.ts` 有「每個路由都在 AdminLayout 底下」或「每個路由都要登入」這類斷言，把 `reset-password` 跟 `login` 一樣列為例外，並在 commit 訊息註明。

- [ ] **Step 7: Commit**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003
git add admin/src/views/ResetPasswordView.vue admin/src/router/index.ts admin/src/views/LoginView.vue admin/src/__tests__/resetPasswordPage.test.ts
git commit -m "feat(admin): 設定新密碼頁（不用登入、讀到代碼就清掉網址）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: stack e2e：寄連結 → 讀信 → 設定新密碼 → 登入

**Files:**
- Modify: `tests/stack/stack-env.ts`（`SECOND_CAMPUS`，`:36`，之後）
- Modify: `tests/stack/global.setup.ts:33-41`
- Create: `tests/stack/password-reset.spec.ts`
- Regenerate: `tests/stack/visual.spec.ts-snapshots/` 的使用者頁截圖（只在 macOS）

**Interfaces:**
- Consumes: 整條功能（Task 3–8）；`readMail`（`tests/stack/mail.ts`）、`openAs`／`gotoAdmin`（`tests/stack/pages.ts`）。

- [ ] **Step 1: 加測試帳號**

`tests/stack/stack-env.ts` 在 `export const SECOND_CAMPUS = 'minghua'` 之後加：

```ts
// 重設密碼連結 e2e 的對象（2026-10-03）：只給 password-reset.spec 用，別的測試不要登入這個帳號。
// 在 global.setup 建立，使用者頁的截圖基準才不會因為測試順序多一列或少一列。
export const RESET_TARGET = { email: 'e2e-reset-target@ivy.example', password: 'e2e-reset-old-password-1', campusKeys: ['yihua'] }
```

`tests/stack/global.setup.ts`：import 那行加 `RESET_TARGET`；在建立三個角色帳號的 `for` 迴圈之後加：

```ts
  await admin.send('POST', '/admin/users', {
    email: RESET_TARGET.email,
    password: RESET_TARGET.password,
    role: 'editor',
    campus_keys: RESET_TARGET.campusKeys,
  })
```

- [ ] **Step 2: 寫 spec**

建 `tests/stack/password-reset.spec.ts`：

```ts
import { expect, test } from '@playwright/test'
import { readMail } from './mail'
import { gotoAdmin, openAs } from './pages'
import { RESET_TARGET } from './stack-env'

// 總管理者寄重設密碼連結 → 同事從信裡的連結設定新密碼 → 用新密碼登入（2026-10-03）。
// 信由 API 同步寫進本機 sink（start-api.sh 的 WEBSITE_NOTIFICATION_EMAIL_SINK_DIR），不用等背景工作。
const NEW_PASSWORD = 'e2e-reset-new-password-2'

test('總管理者寄重設連結，同事從信裡設定新密碼後用新密碼登入，同一條連結不能再用', async ({ browser }) => {
  const { context: adminContext, page: admin } = await openAs(browser, 'super_admin')
  await gotoAdmin(admin, '/users', '使用者')
  const row = admin.getByRole('row', { name: new RegExp(RESET_TARGET.email.replace(/\./g, '\\.')) })
  await row.getByRole('button', { name: '重設密碼' }).click()
  const dialog = admin.getByRole('dialog', { name: /的密碼/ })
  await expect(dialog.getByRole('radio', { name: /寄重設連結/ })).toBeChecked()
  await dialog.getByRole('button', { name: '寄出重設連結' }).click()
  await expect(dialog.getByText(`已寄出重設連結到 ${RESET_TARGET.email}`)).toBeVisible()
  await dialog.getByRole('button', { name: '完成' }).click()
  await adminContext.close()

  const mails = await readMail(mail => mail.to === RESET_TARGET.email && mail.subject.includes('重設密碼'))
  expect(mails).toHaveLength(1)
  const url = mails[0]!.body.match(/https?:\/\/\S+\/admin\/reset-password#token=[A-Za-z0-9_-]+/)?.[0]
  expect(url, mails[0]!.body).toBeTruthy()

  const { context, page } = await openAs(browser, null)
  await page.goto(url!)
  await expect(page.getByText(RESET_TARGET.email)).toBeVisible()
  expect(page.url()).not.toContain('token=')
  await page.getByLabel('新密碼', { exact: true }).fill(NEW_PASSWORD)
  await page.getByLabel('再輸入一次新密碼').fill(NEW_PASSWORD)
  await page.getByRole('button', { name: '設定新密碼' }).click()
  await expect(page.getByText('密碼已更新，請用新密碼登入')).toBeVisible()

  await page.getByLabel('帳號', { exact: true }).fill(RESET_TARGET.email)
  await page.getByLabel('密碼', { exact: true }).fill(NEW_PASSWORD)
  await page.getByRole('button', { name: '登入', exact: true }).click()
  await expect(page).not.toHaveURL(/\/admin\/login/)

  await page.goto(url!)
  await expect(page.getByText('這個重設連結已經用過了')).toBeVisible()
  await context.close()
})
```

- [ ] **Step 3: 建置並只跑這支**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; E2E_DB_NAME=ivy_website_pwreset_e2e_test E2E_API_PORT=8751 E2E_WEB_PORT=3751 npm run e2e:build; E2E_DB_NAME=ivy_website_pwreset_e2e_test E2E_API_PORT=8751 E2E_WEB_PORT=3751 npm run test:e2e:stack -- tests/stack/password-reset.spec.ts
```

預期：setup 1 passed、password-reset 1 passed。埠被別的 session 占用時換一組（例如 8761／3761），不要關掉別人的程序。

- [ ] **Step 4: 重拍使用者頁截圖（只在 macOS）**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; E2E_DB_NAME=ivy_website_pwreset_e2e_test E2E_API_PORT=8751 E2E_WEB_PORT=3751 npm run test:e2e:stack -- tests/stack/visual.spec.ts -u
git status --short tests/stack/visual.spec.ts-snapshots/
```

預期：只有使用者頁那張截圖有變動，多了 `e2e-reset-target` 那一列。Playwright 1.63 的 `-u` 預設只重寫比對不通過的圖，所以「重拍後檔案沒變」不能拿來推論畫面沒變。打開新圖確認只多一列，其他截圖若也變了，先查原因，不要一起提交。

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003
git add tests/stack/stack-env.ts tests/stack/global.setup.ts tests/stack/password-reset.spec.ts tests/stack/visual.spec.ts-snapshots/
git commit -m "test(stack): 寄重設連結到設定新密碼的端到端流程

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

（`git add tests/stack/visual.spec.ts-snapshots/` 只會加入 Step 4 確認過的那張；如果 `git status` 還列出其他圖，改成逐檔 add。）

---

### Task 10: 文件

**Files:**
- Modify: `README.md`（頂部加日期段落）
- Modify: `DESIGN.md`（「官網後台第七輪 UX（2026-10-02…）」那節之前加新章節）
- Modify: `docs/website-admin/acceptance.md`（檔尾加一節）
- Modify: `docs/website-admin/operations.md`（已知限制 `:175`，另加操作說明）

- [ ] **Step 1: README 頂部**

`README.md` 第一個 `## ` 標題之前加（驗證那一點填 Task 11 實際跑出的數字）：

```md
## 2026-10-03 後台重設密碼改成寄連結（`feature/admin-password-reset-20261003`，未部署）

使用者 10-03 裁定：只做「總管理者寄重設連結」，登入頁不開放自助忘記密碼。

- **後台**：「使用者」→「重設密碼」對話框多一種方式「寄重設連結到 <Email>」，有寄信時預設選它；寄出後顯示寄到哪裡、幾點前有效。沒設定寄信的部署只能「直接設定新密碼」（原本的做法，保留）。新頁 `/admin/reset-password` 不用登入，同事在這裡設定新密碼，完成後回登入頁。
- **API**：`POST /admin/users/{id}/password-reset-link`、`POST /auth/password-reset/verify`、`POST /auth/password-reset/complete`；`/auth/me` 的 `features.password_reset_email`。新表 `password_reset_tokens`（migration `d2b7f4c9e1a3`，只新增表）。
- **規則**：連結 30 分鐘、用一次，寄新的舊的就失效，DB 只存雜湊。信同步寄出，失敗就作廢連結、當場說明原因。設好新密碼後登出所有裝置、解除密碼登入暫停。停用帳號、本人改密碼、總管理者直接設新密碼也會作廢還沒用的連結；直接設新密碼也改成會解除密碼登入暫停。
- **驗證**（Node 22）：後端 pytest 全套、admin vitest／typecheck、web typecheck、`contract:check`、stack e2e（含新的 `password-reset.spec.ts`），各自的通過數照 Task 11 實際輸出填。
- **上線前**：正式站要有 `WEBSITE_SMTP_*` 與 `WEBSITE_ADMIN_ORIGIN`，才會出現「寄重設連結」；沒設時行為跟現在一樣。push main＝正式部署，由使用者決定。
```

- [ ] **Step 2: DESIGN.md 新章節**

在 `## 官網後台第七輪 UX（2026-10-02，…）` 之前加：

```md
## 官網後台重設密碼連結（2026-10-03）

- 使用者 2026-10-03 裁定：只做總管理者寄重設連結。登入頁維持「忘記密碼請聯絡總管理者重設。」，不做自助。
- 「重設密碼」對話框兩種方式：寄重設連結（有寄信時預設）、直接設定新密碼（沒寄信時唯一可選；結果頁照舊顯示密碼與複製鈕）。沒設定寄信時「寄重設連結」照樣列出但停用，下面一句說明原因，不藏起來。
- 寄出後對話框不關，顯示「已寄出重設連結到 <Email>」、幾點前有效，有的話加「先前寄的連結已經失效」，按「完成」才關。寄送失敗用 notifyError 說明原因（SMTP 錯誤類別翻成白話），對話框留著，可以改選直接設定。
- 設定新密碼頁 `/admin/reset-password`：不用登入、不放側欄；token 只在網址 `#` 後面，讀到就用 router.replace 清掉。連結失效分五種說法（無效／過期／用過／已作廢／帳號停用），每一種都說下一步；重新整理後網址沒有代碼時，請對方回信裡再點一次。
- 設定完成回登入頁，灰色資訊提示「密碼已更新，請用新密碼登入。原本登入中的裝置都已登出。」
- 不做：自助忘記密碼、使用者列表顯示「有尚未使用的連結」、重設信的寄送重試（連結 30 分鐘就過期，失敗當場告訴總管理者）。
```

- [ ] **Step 3: acceptance.md 新一節**

`docs/website-admin/acceptance.md` 檔尾加。狀態欄依 Task 11 的結果填，沒有看到通過的輸出就寫「未驗證」：

```md
## 總管理者寄重設密碼連結（2026-10-03 實作，尚未部署）

使用者 10-03 裁定只做總管理者寄連結。計畫：`docs/superpowers/plans/2026-10-03-admin-password-reset-link.md`。

| # | 驗收項目 | 狀態 | 證據 |
|---|---|---|---|
| PR1 | 只有總管理者能寄；不能寄給自己、停用帳號、不存在的帳號 | | `backend/tests/test_password_reset_routes.py` |
| PR2 | 連結 30 分鐘、單次；寄新的作廢舊的；DB 只存雜湊；同時寄只留一條 | | `test_password_reset_service.py`、`test_password_reset_routes.py` |
| PR3 | 沒有寄信管道時不能寄、後台說明原因；寄送失敗作廢連結並寫稽核 | | `test_password_reset_routes.py`、`admin/src/__tests__/passwordResetLink.test.ts` |
| PR4 | 設定新密碼後登出所有裝置、舊密碼失效、解除密碼登入暫停；新密碼不合規則時連結不被用掉 | | `test_password_reset_routes.py` |
| PR5 | 停用、本人改密碼、直接設新密碼都作廢連結；直接設新密碼也解鎖 | | `test_password_reset_interactions.py` |
| PR6 | 公開端點限流、Origin 檢查；打開連結不寫稽核、送出才寫 | | `test_password_reset_routes.py`、`test_audit_coverage.py` |
| PR7 | 設定新密碼頁不用登入、清掉網址代碼、各種失效都有說明 | | `admin/src/__tests__/resetPasswordPage.test.ts` |
| PR8 | 端到端：寄出 → 讀信 → 設定 → 用新密碼登入 → 連結不能再用 | | `tests/stack/password-reset.spec.ts` |

未驗證：正式站 SMTP 實寄（要使用者設定 `WEBSITE_SMTP_*`）、iOS Safari／Gmail App 內建瀏覽器實機。
```

- [ ] **Step 4: operations.md**

`docs/website-admin/operations.md:175` 的

```md
- 重設密碼不寄信：總管理者設新密碼後自行告知對方。
```

改成

```md
- 重設密碼（2026-10-03）：有設定 SMTP 與 `WEBSITE_ADMIN_ORIGIN` 時，總管理者在「使用者」頁寄重設連結（30 分鐘、用一次），對方自己設定新密碼；沒設定時仍是直接設新密碼、自行告知。登入頁不提供自助忘記密碼（使用者裁定）。
```

並在「已知限制」那節之前加一小節：

```md
## 重設密碼連結（2026-10-03）

- 誰能寄：總管理者，在「使用者」→「重設密碼」→「寄重設連結」。不能寄給自己（自己的密碼到「我的帳號」改）。
- 對方沒收到：請他看垃圾郵件；可以再寄，同一個帳號 15 分鐘最多 3 封，再寄會讓前一封失效。到「操作紀錄」查「重設密碼連結沒有寄出」可以看到失敗原因。
- 寄出不會停掉原本的密碼。帳號疑似被盜要立刻踢人，用「停用」或「解除綁定並登出」。
- 設好新密碼後對方所有裝置登出，密碼錯太多次的登入暫停也一併解除。
- 本機開發要在 API 設 `WEBSITE_ADMIN_ORIGIN` 與 `WEBSITE_NOTIFICATION_EMAIL_SINK_DIR`，「寄重設連結」才會出現；信寫在 sink 資料夾。
```

- [ ] **Step 5: Commit**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003
git add README.md DESIGN.md docs/website-admin/acceptance.md docs/website-admin/operations.md
git commit -m "docs: 記錄後台重設密碼連結的規則、驗收與操作說明

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: 驗證閘門

**Files:** 無新改動；有失敗就回到對應的 Task 修，修完重跑該 Task 的單檔測試，再回來跑這裡。

全套由**主 session 用背景指令跑**（subagent 前景跑超過 10 分鐘沒有輸出會被中止），同時只跑一組；後端全套跑完才開始 admin 全套，依此類推。

- [ ] **Step 1: migration 只有一個 head**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003
git fetch origin; git log --oneline HEAD..origin/main -- backend/migrations
cd backend; WEBSITE_ENVIRONMENT=test WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_dev WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pwreset_test WEBSITE_SESSION_SECRET=local-only-session-secret-pwreset uv run --frozen alembic heads
```

預期：只有 `d2b7f4c9e1a3 (head)`。如果 origin/main 期間多了 migration：先合併 origin/main，把 `d2b7f4c9e1a3` 的 `down_revision` 改成 main 新的 head，重新 `alembic upgrade head`，再從 Step 2 開始跑。

- [ ] **Step 2: 後端全套（背景）**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003/backend
WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_pwreset_test PYTHONUNBUFFERED=1 uv run --frozen pytest -q -o faulthandler_timeout=240
```

預期：全部 passed（10-03 main 約 1290 項，再加本計畫約 30 項）。已知假失敗：台北時間週五 `test_booking_consent_readiness` 的場次同步會紅，main 本來就這樣，比對 main 確認後可以不理。

- [ ] **Step 3: 後台與官網**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; npm --prefix admin run typecheck; npm --prefix admin run test:unit; npm --prefix web run typecheck; npm run test:website; npm run contract:check
```

預期：typecheck 都沒有錯誤；admin vitest 全過；web 單元測試全過；contract:check 印「契約型別與 openapi.json 一致」。admin vitest 在機器忙的時候可能出現幾項 5 秒逾時，單獨重跑失敗的檔，能過就是假失敗。

- [ ] **Step 4: stack e2e 全套**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003
source ~/.nvm/nvm.sh >/dev/null 2>&1; nvm use >/dev/null 2>&1; E2E_DB_NAME=ivy_website_pwreset_e2e_test E2E_API_PORT=8751 E2E_WEB_PORT=3751 npm run e2e:build; E2E_DB_NAME=ivy_website_pwreset_e2e_test E2E_API_PORT=8751 E2E_WEB_PORT=3751 npm run test:e2e:stack
```

預期：全部 passed。已知間歇失敗：`media.spec.ts`「素材庫上傳照片…發布到官網」，單獨重跑能過就是既有問題。

- [ ] **Step 5: 收尾檢查**

```bash
cd ~/Desktop/ivy-website-pwreset-20261003
git status --short
git log --oneline origin/main..HEAD
```

預期：`git status` 沒有輸出；`git log` 列出 Task 1–10 的 10 個 commit。把 Step 2–4 的實際通過數補進 README 與 acceptance.md 的狀態欄，另外提交一次 `docs: 補重設密碼連結的驗證結果`。

- [ ] **Step 6: 交回使用者**

回報實際跑過的指令與結果、未驗證項目（正式站 SMTP 實寄、iOS／Gmail App 內建瀏覽器）和下面三件待確認的事。**不 push、不部署**：合併上線由使用者決定（push main＝正式部署，含自動跑 migration `d2b7f4c9e1a3`，只新增表、不用先備份）。

待使用者確認：
1. 「直接設定新密碼」要保留嗎？（設計決定第 2 條，目前保留）
2. 直接設定新密碼也會解除密碼登入暫停，這個行為改變可以嗎？（設計決定第 7 條）
3. 正式站的 SMTP 什麼時候設？沒設之前，「寄重設連結」不會出現。
