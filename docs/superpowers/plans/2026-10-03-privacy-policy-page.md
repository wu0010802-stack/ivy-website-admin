# 官網隱私權政策頁 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 後台可編輯、發布後顯示在官網 `/privacy` 的隱私權政策，頁尾與預約表單都有入口。

**Architecture:** 新增不分校的共用內容 kind `privacy_policy`（標題、最後更新日期、1–20 段小標＋內文）。後端只做欄位驗證與發布阻擋（內文含「【待確認」或沒填更新日期不能發布）；已發布內容走既有 `GET /public/site`，不新增端點、不需要 migration。後台照「預約文案」的段落編輯做一頁，第一次打開帶入初稿。官網新增 `/privacy` 頁與純函式解析內文（空行分段、「- 」條列、`https://` 連結，不用 `v-html`）。

**Tech Stack:** FastAPI 0.136.1（釘版）＋Pydantic、Vue 3＋Element Plus＋vitest（admin）、Nuxt 4＋vitest（web）、Playwright stack e2e。

**Spec:** `docs/specs/2026-10-03-privacy-policy-page-design.md`（下稱「規格」）。

**Worktree：** `/Users/yilunwu/Desktop/ivy-website-privacy`（分支 `feature/privacy-policy-20261003`，sparse checkout，從 origin/main `94e18c1` 開出）。所有指令在這個目錄執行。Node 22：`source ~/.nvm/nvm.sh; nvm use 22 >/dev/null`（`source` 會回傳 3，指令用分號串接，不要用 `&&`）。機器只有 8GB RAM，一次只跑一組測試。

## Global Constraints

- 後端 FastAPI **0.136.1 釘版**；不新增 npm／Python 套件。
- kind 名稱 `privacy_policy`，`shared_only=True`，**不需要 migration**；不加進 `initialize.py` 的 `initial_payloads`、不寫進兩份 site fixture。
- payload：`title` 1–40 字（預設「隱私權政策」）；`updated_on` 日期或 null；`sections` 1–20 段；`heading` 1–60 字；`body` 1–2000 字、不可只有空白；所有文字欄位擋 `javascript:` 等（沿用 `_reject_unsafe_scheme`）。
- 發布阻擋：標題或任一段落含「【待確認」；`updated_on` 為空。
- 官網渲染**不使用 `v-html`**；只有 `https://` 網址變成連結（`target="_blank" rel="noopener noreferrer"`，附「（另開新視窗）」給螢幕閱讀器）。
- 未發布時 `/privacy` 回 404、頁尾不顯示連結、sitemap 不列。
- 樣式只用既有 token（`var(--paper)`、`var(--text)`、`var(--muted)`、`var(--line)`、`var(--green)`、`var(--cream)`、`var(--fs-*)`、`var(--font-head)`），不寫 hex／rgb／oklch 字面值。
- 不做 cookie 橫幅、不載入任何追蹤工具、不改預約 API 與 `booking/consent.py`。
- 文案：政策正文的初稿以規格附錄 A 為準，逐字使用。
- 未經要求不 commit 到別的分支、不 push、不部署；本計畫的 commit 都在 `feature/privacy-policy-20261003`。

## Review Focus

- **整頁只剩一段但很長／內文有 HTML 字元**：內文含 `<script>`、`&`、`"` 時照原文顯示、不被當成 HTML。→ Task 3 `privacy-policy.spec.ts`「HTML 字元照原文」。
- **更新日期缺失或格式壞**：頁面不顯示「最後更新」那行，不顯示「Invalid Date」。→ Task 3「日期標籤」。
- **網址緊鄰全形標點或括號**：連結不吃進標點。→ Task 3「連結不吃標點」。
- **發布後又存一版含【待確認】的草稿**：官網仍顯示已發布版本，草稿不能再發布。→ Task 1 `test_draft_with_pending_marker_does_not_replace_published`。
- **手機 390px 長網址**：頁面不橫向溢出。→ Task 5 `privacy-policy.spec.ts`（`expectNoHorizontalOverflow`）。

---

### Task 1：後端 `privacy_policy` 內容種類

**Files:**
- Modify: `backend/app/content/schemas.py`（在 `BookingContentPayload` 之後，約 402 行後新增）
- Modify: `backend/app/content/registry.py`（import 清單約 10–28 行；發布阻擋函式放在 `_booking_publish_blocker` 之後約 197 行；`CONTENT_KIND_REGISTRY` 約 311 行起）
- Create: `backend/tests/test_privacy_policy_content.py`

**Interfaces:**
- Produces（Task 2、5 依賴）：kind 字串 `"privacy_policy"`；payload JSON 形狀 `{"title": str, "updated_on": "YYYY-MM-DD" | null, "sections": [{"heading": str, "body": str}]}`；`GET /api/website/v1/public/site` 發布後在 `content["privacy_policy"]`；常數 `PRIVACY_POLICY_PENDING_MARKER = "【待確認"`、`PRIVACY_POLICY_SECTIONS_MAX = 20`。
- Consumes：`_ContentPayload`、`_reject_unsafe_scheme`（`schemas.py`）、`ContentKindConfig`（`registry.py`）。

- [ ] **Step 1：寫會失敗的測試** — 建立 `backend/tests/test_privacy_policy_content.py`：

```python
"""隱私權政策（privacy_policy）：payload 規則、發布阻擋、權限與公開輸出。"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.content.registry import CONTENT_KIND_REGISTRY
from app.content.schemas import PrivacyPolicyPayload
from tests.conftest import publish_booking_consent

API = "/api/website/v1"
ITEM = f"{API}/admin/content-items/privacy_policy"


def _payload(**changes) -> dict:
    base = {
        "title": "隱私權政策",
        "updated_on": "2026-10-03",
        "sections": [
            {
                "heading": "適用範圍",
                "body": "本政策適用本網站。\n\n- 條列一\n- 條列二\n詳見 https://policies.google.com/privacy",
            }
        ],
    }
    return {**base, **changes}


async def _save(client, **changes) -> dict:
    item = (await client.get(ITEM)).json()
    saved = await client.post(
        f"{ITEM}/revisions", json={"expected_version": item["latest_version"], "payload": _payload(**changes)}
    )
    assert saved.status_code == 201, saved.text
    return saved.json()["latest_revision"]


def test_registered_as_shared_only():
    assert CONTENT_KIND_REGISTRY["privacy_policy"].shared_only is True


def test_valid_payload_keeps_list_and_url_text_verbatim():
    payload = PrivacyPolicyPayload.model_validate(_payload())
    assert payload.sections[0].body.endswith("https://policies.google.com/privacy")
    assert payload.updated_on is not None


def test_draft_may_leave_updated_on_empty():
    assert PrivacyPolicyPayload.model_validate(_payload(updated_on=None)).updated_on is None


@pytest.mark.parametrize(
    "changes",
    [
        {"title": ""},
        {"title": "字" * 41},
        {"sections": []},
        {"sections": [{"heading": "x", "body": "段"}] * 21},
        {"sections": [{"heading": "", "body": "段"}]},
        {"sections": [{"heading": "   ", "body": "段"}]},
        {"sections": [{"heading": "字" * 61, "body": "段"}]},
        {"sections": [{"heading": "x", "body": "   "}]},
        {"sections": [{"heading": "x", "body": "javascript:alert(1)"}]},
        {"sections": [{"heading": "x", "body": "字" * 2001}]},
        {"title": "vbscript:x"},
    ],
)
def test_bad_payloads_are_rejected(changes):
    with pytest.raises(ValidationError):
        PrivacyPolicyPayload.model_validate(_payload(**changes))


@pytest.mark.asyncio
async def test_api_returns_422_for_bad_payload(admin_client):
    item = (await admin_client.get(ITEM)).json()
    response = await admin_client.post(
        f"{ITEM}/revisions",
        json={"expected_version": item["latest_version"], "payload": _payload(sections=[])},
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_pending_marker_blocks_publish_with_count(admin_client):
    revision = await _save(
        admin_client,
        sections=[
            {"heading": "蒐集者", "body": "【待確認：登記名稱】"},
            {"heading": "保存", "body": "【待確認：天數】與【待確認：招生紀錄】"},
        ],
    )
    blocked = await admin_client.post(f"{ITEM}/publish", json={"revision_id": revision["id"]})
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "CONTENT_NOT_READY"
    assert "3 處" in blocked.json()["detail"]["message"]
    assert "待確認" in blocked.json()["detail"]["message"]


@pytest.mark.asyncio
async def test_pending_marker_in_title_blocks_publish(admin_client):
    revision = await _save(admin_client, title="【待確認：標題】")
    blocked = await admin_client.post(f"{ITEM}/publish", json={"revision_id": revision["id"]})
    assert blocked.status_code == 409


@pytest.mark.asyncio
async def test_missing_updated_on_blocks_publish(admin_client):
    revision = await _save(admin_client, updated_on=None)
    blocked = await admin_client.post(f"{ITEM}/publish", json={"revision_id": revision["id"]})
    assert blocked.status_code == 409
    assert "最後更新日期" in blocked.json()["detail"]["message"]


@pytest.mark.asyncio
async def test_public_site_has_policy_only_after_publish(admin_client, public_client, db_session):
    await publish_booking_consent(db_session)  # 先有一個 release，/public/site 才有內容可讀
    before = (await public_client.get(f"{API}/public/site")).json()
    assert "privacy_policy" not in before["content"]

    revision = await _save(admin_client)
    assert "privacy_policy" not in (await public_client.get(f"{API}/public/site")).json()["content"]

    published = await admin_client.post(f"{ITEM}/publish", json={"revision_id": revision["id"]})
    assert published.status_code == 200, published.text
    after = (await public_client.get(f"{API}/public/site")).json()
    assert after["content"]["privacy_policy"] == _payload()


@pytest.mark.asyncio
async def test_draft_with_pending_marker_does_not_replace_published(admin_client, public_client, db_session):
    await publish_booking_consent(db_session)
    good = await _save(admin_client)
    assert (await admin_client.post(f"{ITEM}/publish", json={"revision_id": good["id"]})).status_code == 200

    pending = await _save(admin_client, sections=[{"heading": "x", "body": "【待確認：補】"}])
    assert (await admin_client.post(f"{ITEM}/publish", json={"revision_id": pending["id"]})).status_code == 409
    live = (await public_client.get(f"{API}/public/site")).json()["content"]["privacy_policy"]
    assert live == _payload()


@pytest.mark.asyncio
async def test_editor_can_read_but_not_edit_shared_policy(editor_client):
    assert (await editor_client.get(ITEM)).status_code == 200
    item = (await editor_client.get(ITEM)).json()
    denied = await editor_client.post(
        f"{ITEM}/revisions", json={"expected_version": item["latest_version"], "payload": _payload()}
    )
    assert denied.status_code == 403
```

- [ ] **Step 2：跑測試確認失敗**

Run: `cd backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_privacy uv run --frozen pytest -q tests/test_privacy_policy_content.py`（第一次先建庫並套 migration：`createdb ivy_website_test_privacy; WEBSITE_ENVIRONMENT=test WEBSITE_SESSION_SECRET=test-secret-for-local-only-0123456789abcdef WEBSITE_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_privacy uv run --frozen alembic upgrade head`；若 `WEBSITE_SESSION_SECRET` 有長度或格式要求導致啟動失敗，改用 `backend/.env.example` 的寫法；庫名必須含 `test`，不要和其他 session 共用同一個庫）
Expected: 收集階段 `ImportError: cannot import name 'PrivacyPolicyPayload'`。

- [ ] **Step 3：實作 schema** — 在 `backend/app/content/schemas.py` 的 `BookingContentPayload` 類別之後加入：

```python
# 隱私權政策（privacy_policy）：不分校的共用內容。內文是純文字；官網依約定寫法解析
# （空行分段、「- 」條列、https:// 連結），後端不轉換。後台初稿裡需要園方補的地方標
# 「【待確認：…】」，含標記的版本不能發布（registry 的 publish_blocker）。
PRIVACY_POLICY_PENDING_MARKER = "【待確認"
PRIVACY_POLICY_SECTIONS_MAX = 20


class PrivacyPolicySectionPayload(_ContentPayload):
    heading: str = Field(min_length=1, max_length=60)
    body: str = Field(min_length=1, max_length=2000)

    @field_validator("heading", "body")
    @classmethod
    def _no_script_scheme(cls, value: str) -> str:
        return _reject_unsafe_scheme(value)

    @field_validator("heading", "body")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("不能空白")
        return value


class PrivacyPolicyPayload(_ContentPayload):
    title: str = Field(default="隱私權政策", min_length=1, max_length=40)
    # 存草稿可以留空；發布時必填（registry 的 publish_blocker）。
    updated_on: date | None = None
    sections: list[PrivacyPolicySectionPayload] = Field(min_length=1, max_length=PRIVACY_POLICY_SECTIONS_MAX)

    @field_validator("title")
    @classmethod
    def _title_safe(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("標題不能空白")
        return _reject_unsafe_scheme(value)
```

- [ ] **Step 4：實作登記與發布阻擋** — `backend/app/content/registry.py`：

import 清單加 `PRIVACY_POLICY_PENDING_MARKER`、`PrivacyPolicyPayload`（維持字母順序，放在 `PRIVACY_SAMPLE_MARKER` 附近）：

```python
    PRIVACY_POLICY_PENDING_MARKER,
    PRIVACY_SAMPLE_MARKER,
    PrivacyPolicyPayload,
```

在 `_booking_publish_blocker` 函式之後加入：

```python
def _privacy_policy_publish_blocker(payload: dict) -> str | None:
    """政策還留著「【待確認」或沒填最後更新日期時不能發布（正式內容由園方補完）。"""
    texts = [payload.get("title", "")]
    for section in payload.get("sections", []):
        texts += [section.get("heading", ""), section.get("body", "")]
    pending = sum((text or "").count(PRIVACY_POLICY_PENDING_MARKER) for text in texts)
    if pending:
        return f"還有 {pending} 處「【待確認】」要補完才能發布"
    if not payload.get("updated_on"):
        return "請填最後更新日期再發布"
    return None
```

在 `CONTENT_KIND_REGISTRY` 的 `"booking_content"` 項之後加入：

```python
    "privacy_policy": ContentKindConfig(
        PrivacyPolicyPayload, shared_only=True, publish_blocker=_privacy_policy_publish_blocker
    ),
```

- [ ] **Step 5：跑測試確認通過**

Run: 同 Step 2 指令。
Expected: 全部 passed（約 25 項：parametrize 11＋其餘 10 以上）。若 `test_editor_can_read_but_not_edit_shared_policy` 的 `403` 不成立，先確認 `editor_client` 沒有 `content.shared` 授權（`conftest.py:389`），不要改斷言去配合。

- [ ] **Step 6：回歸與契約**

Run: `cd backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_privacy uv run --frozen pytest -q tests/test_content_initialize.py tests/test_admission_content.py tests/test_content_publishing_workflow.py tests/test_booking_consent_readiness.py`，再 `cd ..; source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm run contract:generate; npm run contract:check`。
Expected: 回歸全過；`git status --short contracts` 沒有變動（kind 是自由字串、沒有新端點）。若契約檔有變動，一併提交。

- [ ] **Step 7：Commit**

```bash
git add backend/app/content/schemas.py backend/app/content/registry.py backend/tests/test_privacy_policy_content.py
git commit -m "feat(content): 新增隱私權政策內容種類（待確認標記與更新日期擋發布）"
```
（commit 訊息最後一行依 session 的 attribution 指示加 `Co-Authored-By`。）

---

### Task 2：後台「隱私權政策」編輯頁與初稿

**Files:**
- Create: `admin/src/composables/privacyPolicyDraft.ts`
- Create: `admin/src/views/PrivacyPolicyView.vue`
- Create: `admin/src/__tests__/privacyPolicy.test.ts`
- Modify: `admin/src/api/types.ts`（在 `BookingContentPayload` 之後，約 115 行後）
- Modify: `admin/src/api/labels.ts`（`CONTENT_KIND_LABELS` 約 801–816 行；`contentPublicPath` 約 716 行；`contentPreviewPath` 約 729 行）
- Modify: `admin/src/api/contentFieldLabels.ts`（`KIND_FIELD_LABELS` 內加一項）
- Modify: `admin/src/router/index.ts`（約 48 行附近）
- Modify: `admin/src/router/nav.ts`（`key: 'site'` 群組，約 106–119 行）
- Modify: `admin/src/__tests__/bugfixRegressions.test.ts`（`SHARED` 陣列約 27–30 行）

**Interfaces:**
- Consumes（Task 1）：kind `"privacy_policy"` 與 payload 形狀。
- Produces（Task 3 之後不依賴程式，只依賴 kind 與預覽路徑）：`contentPreviewPath('privacy_policy') === '/preview?page=privacy'`；`contentPublicPath('privacy_policy') === '/privacy'`；`contentEditorPath('privacy_policy') === '/content/privacy-policy'`（既有規則 `kind.replace(/_/g,'-')` 自動成立）。
- 導出：`privacyPolicyDraft(): PrivacyPolicyPayload`、`privacyPolicyPendingCount(payload): number`、`PRIVACY_POLICY_PENDING_MARKER`、`PRIVACY_POLICY_SECTIONS_MAX`。

- [ ] **Step 1：寫會失敗的測試** — 建立 `admin/src/__tests__/privacyPolicy.test.ts`：

```ts
import { describe, expect, it } from 'vitest'
import { NAV_GROUPS } from '../router/nav'
import { CONTENT_KIND_LABELS, contentEditorPath, contentFieldLabel, contentPreviewPath, contentPublicPath } from '../api/labels'
import { contentFieldLabelFor } from '../api/contentFieldLabels'
import {
  PRIVACY_POLICY_PENDING_MARKER,
  PRIVACY_POLICY_SECTIONS_MAX,
  privacyPolicyDraft,
  privacyPolicyPendingCount,
} from '../composables/privacyPolicyDraft'

describe('隱私權政策（privacy_policy）', () => {
  it('側欄在「全站與素材」、只給 super_admin，標籤與網址對得上', () => {
    const group = NAV_GROUPS.find((g) => g.key === 'site')!
    const item = group.items.find((i) => i.name === 'privacy-policy')!
    expect(item.path).toBe('/content/privacy-policy')
    expect(item.roles).toEqual(['super_admin'])
    expect(item.shared).toBe(true)
    expect(CONTENT_KIND_LABELS.privacy_policy).toBe('隱私權政策')
    expect(contentPublicPath('privacy_policy')).toBe('/privacy')
    expect(contentPreviewPath('privacy_policy')).toBe('/preview?page=privacy')
    expect(contentEditorPath('privacy_policy')).toBe('/content/privacy-policy')
  })

  it('發布確認框的欄位有中文名', () => {
    expect(contentFieldLabelFor('privacy_policy', 'title')).toBe('標題')
    expect(contentFieldLabelFor('privacy_policy', 'updated_on')).toBe('最後更新日期')
    expect(contentFieldLabelFor('privacy_policy', 'sections')).toBe('政策段落')
    expect(contentFieldLabel('updated_on')).not.toBe('updated_on')
  })

  it('初稿：12 段、標題與後端預設一致、更新日期留空、有 8 處待確認', () => {
    const draft = privacyPolicyDraft()
    expect(draft.title).toBe('隱私權政策')
    expect(draft.updated_on).toBeNull()
    expect(draft.sections).toHaveLength(12)
    expect(draft.sections.length).toBeLessThanOrEqual(PRIVACY_POLICY_SECTIONS_MAX)
    expect(privacyPolicyPendingCount(draft)).toBe(8)
    for (const section of draft.sections) {
      expect(section.heading.trim()).not.toBe('')
      expect(section.body.trim()).not.toBe('')
      expect(section.heading.length).toBeLessThanOrEqual(60)
      expect(section.body.length).toBeLessThanOrEqual(2000)
    }
  })

  it('待確認計數：標題與各段都算，補完後歸零', () => {
    const draft = privacyPolicyDraft()
    draft.title = `隱私權政策${PRIVACY_POLICY_PENDING_MARKER}：x】`
    expect(privacyPolicyPendingCount(draft)).toBe(9)
    const cleaned = {
      title: '隱私權政策',
      updated_on: '2026-10-03',
      sections: draft.sections.map((s) => ({ heading: s.heading, body: s.body.replaceAll(PRIVACY_POLICY_PENDING_MARKER, '已補') })),
    }
    expect(privacyPolicyPendingCount(cleaned)).toBe(0)
  })
})
```

並在 `bugfixRegressions.test.ts` 的 `SHARED` 陣列（約 27–30 行）末尾加 `'privacy-policy'`：

```ts
    'booking-content', 'site-footer', 'site-meta', 'privacy-policy',
```

- [ ] **Step 2：跑測試確認失敗**

Run: `source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm --prefix admin run test:unit -- --maxWorkers=2 src/__tests__/privacyPolicy.test.ts src/__tests__/bugfixRegressions.test.ts`
Expected: FAIL（找不到 `../composables/privacyPolicyDraft`、側欄沒有 `privacy-policy`）。

- [ ] **Step 3：型別與標籤** —

`admin/src/api/types.ts`，在 `BookingContentPayload` 介面之後加：

```ts
/** 隱私權政策（後端 content/schemas.py 的 PrivacyPolicyPayload）；內文純文字，空行分段、「- 」條列、https:// 連結 */
export interface PrivacyPolicySectionPayload {
  heading: string
  body: string
}

export interface PrivacyPolicyPayload {
  title: string
  /** YYYY-MM-DD；存草稿可為 null，發布必填 */
  updated_on: string | null
  sections: PrivacyPolicySectionPayload[]
}
```

`admin/src/api/labels.ts`：`CONTENT_KIND_LABELS` 加 `privacy_policy: '隱私權政策',`；`contentPublicPath` 在 `admission_content` 那行之後加 `if (kind === 'privacy_policy') return '/privacy'`；`contentPreviewPath` 在 `booking_content` 那行之後加 `if (kind === 'privacy_policy') return '/preview?page=privacy'`。

`admin/src/api/contentFieldLabels.ts`：在 `KIND_FIELD_LABELS` 的 `admission_content` 區塊之前加：

```ts
  privacy_policy: {
    title: '標題',
    updated_on: '最後更新日期',
    sections: '政策段落',
    heading: '段落小標',
    body: '段落內文',
  },
```

- [ ] **Step 4：側欄與路由** —

`admin/src/router/nav.ts`，在 `booking-content` 那一項之後（同一個陣列內，記得補上前一項結尾的逗號）加：

```ts
      { name: 'privacy-policy', path: '/content/privacy-policy', title: '隱私權政策', icon: 'Lock', roles: ['super_admin'], shared: true, keywords: ['個資', '隱私', 'Cookie', '政策'] },
```

先確認 `Lock` 圖示已在 `admin/src/components/AdminSidebar.vue` 的兩個 import 清單（約 9 行與 20 行附近，`SwitchButton, Tickets, Timer, TrendCharts, User` 那兩行）裡；沒有就在兩處都加 `Lock`（字母序放在 `Location` 附近）。

`admin/src/router/index.ts`，在 `content/booking-content` 那行之後加：

```ts
      page('content/privacy-policy', 'privacy-policy', () => import('../views/PrivacyPolicyView.vue')),
```

- [ ] **Step 5：初稿與計數** — 建立 `admin/src/composables/privacyPolicyDraft.ts`（初稿全文 = 規格附錄 A，逐字；【】是園方要補的地方）：

```ts
// 隱私權政策初稿（規格附錄 A）。只存在後台：這份內容從未存過任何版本時，編輯頁載入它；
// 官網在發布前沒有這份內容。「【待確認：…】」是要園方補的地方，含標記的版本後端不給發布
// （content/registry.py 的 _privacy_policy_publish_blocker）。
import type { PrivacyPolicyPayload } from '../api/types'

// 與後端 content/schemas.py 的 PRIVACY_POLICY_PENDING_MARKER、PRIVACY_POLICY_SECTIONS_MAX 相同。
export const PRIVACY_POLICY_PENDING_MARKER = '【待確認'
export const PRIVACY_POLICY_SECTIONS_MAX = 20

export function privacyPolicyPendingCount(payload: Pick<PrivacyPolicyPayload, 'title' | 'sections'>): number {
  const texts = [payload.title, ...payload.sections.flatMap((s) => [s.heading, s.body])]
  return texts.reduce((sum, text) => sum + ((text ?? '').split(PRIVACY_POLICY_PENDING_MARKER).length - 1), 0)
}

export function privacyPolicyDraft(): PrivacyPolicyPayload {
  return {
    title: '隱私權政策',
    updated_on: null,
    sections: [
      {
        heading: '1. 適用範圍與蒐集者',
        body: [
          '本隱私權政策說明【待確認：蒐集者的法人或各校登記名稱】（以下稱「我們」）在常春藤幼兒園官網（以下稱「本網站」），如何蒐集、使用與保護您的個人資料。',
          '',
          '本政策只適用本網站。您點選本網站上的 Facebook、Instagram、YouTube、LINE、Google 地圖等外部連結之後，適用該網站自己的隱私權政策。',
        ].join('\n'),
      },
      {
        heading: '2. 我們蒐集的資料',
        body: [
          '您在本網站預約參觀時，我們會蒐集：',
          '- 家長稱呼、手機號碼、Email（必填）',
          '- 孩子的姓名與出生年月日（表單要求填寫）',
          '- 參觀校區、場次與參觀人數（必填）',
          '- 如何得知常春藤（選填，可複選）',
          '- 想了解的事（選填）',
          '',
          '您之後可以用確認信裡的修改連結，更新稱呼、手機、Email、孩子的姓名與生日、參觀人數與想了解的事，也可以取消或申請改期。',
        ].join('\n'),
      },
      {
        heading: '3. 蒐集目的與利用方式',
        body: [
          '我們使用這些資料來：',
          '- 安排與確認參觀場次',
          '- 寄送預約確認信與修改連結到您的 Email',
          '- 在必要時以電話或 Email 聯絡您確認參觀',
          '- 【待確認：參觀後的招生聯繫與紀錄如何使用，例如到園參觀後，由參觀校區聯繫入學事宜並保留參觀紀錄】',
          '',
          '預約確認信只寫稱呼、校區、日期與場次、參觀人數、校區地址與電話，以及修改連結，不含孩子的生日、完整電話或您填寫的問題。通知校區人員有新預約時，訊息也不含您或孩子的個人資料。',
          '',
          '我們不會把您的資料用在上述目的以外的用途。',
        ].join('\n'),
      },
      {
        heading: '4. 自動蒐集的資訊',
        body: [
          '本網站會蒐集不能識別個人的統計資訊，用來了解網站的使用情形與改善速度：',
          '- 瀏覽的頁面類型與校區、裝置類型（手機或桌機）',
          '- 網頁載入速度',
          '- 點選預約、電話、LINE 按鈕的次數',
          '',
          '這些統計不記錄您的 IP，也不使用 cookie 識別您。您的瀏覽器若開啟「不要追蹤」（Do Not Track）或 Global Privacy Control，本網站就不會送出這些統計。',
          '',
          '為了防止濫用（例如大量自動送出預約），我們會把連線來源 IP 經過不可逆的雜湊處理後，短暫保存，時間到就刪除。',
          '',
          '【待確認：若已啟用 Cloudflare Turnstile，保留這一段：送出預約時，本網站使用 Cloudflare Turnstile 判斷是不是自動程式，過程中會把您的 IP 提供給 Cloudflare。未啟用就整段刪除。】',
          '',
          '本網站的主機服務商會依其作業保存連線紀錄（例如存取時間與網址）。',
          '',
          '影片使用 YouTube 的 youtube-nocookie.com 播放器，您按下播放後才會載入；影片縮圖由 YouTube 的伺服器提供。',
        ].join('\n'),
      },
      {
        heading: '5. Cookie 與類似技術',
        body: [
          '本網站目前只使用網站運作必要的 cookie：',
          '- ivy_parent_session：您開啟預約修改連結後設定，讓您在 2 小時內修改預約，只能由本網站的伺服器讀取。',
          '- 員工登入後台時使用的登入 cookie，一般訪客不會收到。',
          '',
          '此外，本網站在您的瀏覽器分頁暫存兩個不含個人資料的設定：開場動畫是否看過，以及首頁「孩子的一天」照片翻面動畫是否播過。關閉分頁後就會清除。',
          '',
          '本網站目前沒有使用第三方分析或廣告 cookie。日後若使用，我們會先更新本政策。您可以在瀏覽器設定中封鎖或刪除 cookie；封鎖必要 cookie 時，預約修改連結可能無法使用。',
        ].join('\n'),
      },
      {
        heading: '6. 資料分享與委外處理',
        body: [
          '我們不會出售或出租您的個人資料。',
          '',
          '為了提供服務，我們委託下列廠商處理資料，並要求他們只依我們的指示處理：',
          '- Railway：網站主機與資料庫【待確認：資料所在地區】',
          '- 【待確認：寄信服務商】：寄送預約確認信',
          '- Cloudflare：判斷自動程式（若已啟用）',
          '',
          '在我們內部，只有負責您預約校區的人員看得到您的預約資料。除了法律規定或主管機關依法要求之外，我們不會提供給其他人。',
        ].join('\n'),
      },
      {
        heading: '7. 保存期間',
        body: [
          '- 預約資料在參觀結束或取消後保存【待確認：天數】天，到期後刪除您與孩子的姓名、電話、Email、生日與填寫的內容，只保留不能識別個人的統計資料。',
          '- 【待確認：參觀後的招生紀錄保存多久】',
          '- 網頁速度的統計資料保存 90 天；其他統計資料不能識別個人。',
          '- 預約修改連結會過期：至少有效 14 天，參觀日後 7 天失效。',
        ].join('\n'),
      },
      {
        heading: '8. 資料安全',
        body: '本網站全程以 HTTPS 加密傳輸。後台需要登入，並依校區限制可以看到的資料。預約修改連結開啟後，網址裡的識別碼會立即移除，不會留在瀏覽紀錄中。',
      },
      {
        heading: '9. 您的權利',
        body: [
          '依個人資料保護法第 3 條，您可以：',
          '- 查詢或請求閱覽',
          '- 請求製給複製本',
          '- 請求補充或更正',
          '- 請求停止蒐集、處理或利用',
          '- 請求刪除',
          '',
          '您可以用預約修改連結自行更正或取消，或依第 12 段的方式聯絡我們。必填欄位若不提供，就無法線上預約，您可以改用電話向各校預約。',
        ].join('\n'),
      },
      {
        heading: '10. 孩子的資料',
        body: '孩子的姓名與出生年月日由家長提供，只用來安排參觀與判斷適合的班別。',
      },
      {
        heading: '11. 政策修訂',
        body: '我們可能因法令或服務調整修訂本政策，修訂後公告於本頁，並更新上方的最後更新日期。',
      },
      {
        heading: '12. 聯絡我們',
        body: [
          '對本政策或您的個人資料有任何問題，請聯絡：',
          '- Email：【待確認：統一的聯絡 Email】',
          '- 各校電話：請見本網站「五所校園」頁面',
        ].join('\n'),
      },
    ],
  }
}
```

- [ ] **Step 6：編輯畫面** — 建立 `admin/src/views/PrivacyPolicyView.vue`：

```vue
<script setup lang="ts">
import { computed, onMounted, useTemplateRef } from 'vue'
import { Delete, Plus } from '@element-plus/icons-vue'
import { useContentItem } from '../composables/useContentItem'
import { moveKeepingFocus } from '../composables/moveKeepingFocus'
import { revealListItem } from '../composables/newsContent'
import {
  PRIVACY_POLICY_PENDING_MARKER,
  PRIVACY_POLICY_SECTIONS_MAX,
  privacyPolicyDraft,
  privacyPolicyPendingCount,
} from '../composables/privacyPolicyDraft'
import type { PrivacyPolicyPayload } from '../api/types'
import ContentEditor from '../components/ContentEditor.vue'
import { vReadonlyValues } from '../composables/readonlyValues'

const editor = useContentItem<PrivacyPolicyPayload>('privacy_policy', { title: '隱私權政策', updated_on: null, sections: [] })
const form = editor.form
const sections = computed(() => form.value.sections)
const pending = computed(() => privacyPolicyPendingCount(form.value))
// 從未存過任何版本：畫面上的是初稿（還沒存），按儲存才會變成第一個版本。
const isUnsavedDraft = computed(() => !editor.loading.value && !editor.loadError.value && !editor.item.value?.latest_revision)

const sectionsList = useTemplateRef<HTMLElement>('sectionsList')

async function loadWithDraft() {
  await editor.load()
  if (editor.loadError.value || editor.item.value?.latest_revision) return
  // 快照仍是空白表單，所以載入初稿後畫面是「有未儲存的修改」，儲存鈕可以按。
  form.value = privacyPolicyDraft()
}

function addSection() {
  form.value.sections.push({ heading: '', body: '' })
  void revealListItem(sectionsList.value, `[data-list-item="${form.value.sections.length - 1}"]`)
}

function removeSection(index: number) {
  form.value.sections.splice(index, 1)
}

function move(index: number, delta: number) {
  void moveKeepingFocus(form.value.sections, index, delta, sectionsList.value)
}

function jumpToPending() {
  const index = sections.value.findIndex((s) => `${s.heading}${s.body}`.includes(PRIVACY_POLICY_PENDING_MARKER))
  if (index >= 0) void revealListItem(sectionsList.value, `[data-list-item="${index}"]`)
}

onMounted(loadWithDraft)
</script>

<template>
  <ContentEditor :editor="editor">
    <template #lead>
      官網 <code>/privacy</code> 的隱私權政策。發布後頁尾與預約表單會多一個「隱私權政策」連結；還沒發布時官網沒有這一頁。
    </template>

    <el-form v-readonly-values="editor.readOnly.value" label-position="top" :disabled="editor.readOnly.value" @submit.prevent>
      <el-alert
        v-if="isUnsavedDraft"
        type="info"
        :closable="false"
        show-icon
        class="policy__alert"
        title="這是初稿，尚未儲存。補完【待確認】、填好最後更新日期後才能發布。"
      />
      <el-alert
        v-if="pending > 0"
        type="warning"
        :closable="false"
        show-icon
        class="policy__alert"
        :title="`還有 ${pending} 處「${PRIVACY_POLICY_PENDING_MARKER}】」要補完才能發布`"
      >
        <el-button text size="small" @click="jumpToPending">跳到第一處</el-button>
      </el-alert>

      <el-form-item label="標題" required>
        <el-input v-model="form.title" maxlength="40" />
      </el-form-item>
      <el-form-item label="最後更新日期" required>
        <el-date-picker
          v-model="form.updated_on"
          type="date"
          value-format="YYYY-MM-DD"
          format="YYYY 年 M 月 D 日"
          placeholder="選擇日期"
          :clearable="true"
        />
        <span class="field-help">顯示在官網標題下方；發布前必填。</span>
      </el-form-item>

      <h3 class="form-section">政策段落</h3>
      <p class="field-help policy__lead">
        內文寫法：空一行就另起一段；一行開頭寫「- 」會變成條列；內文裡的 <code>https://</code> 網址會自動變成可點的連結。不能寫 HTML。
      </p>
      <div ref="sectionsList">
        <div v-for="(section, index) in sections" :key="index" class="repeat-item" :data-list-item="index">
          <div class="repeat-item__head">
            <span class="repeat-item__index"><b>{{ index + 1 }}</b>{{ section.heading.trim() || `第 ${index + 1} 段` }}</span>
            <span v-if="!editor.readOnly.value" class="policy__row-actions">
              <el-button text size="small" :disabled="index === 0" :data-move-row="index" data-move-dir="-1" :aria-label="`上移第 ${index + 1} 段`" @click="move(index, -1)">上移</el-button>
              <el-button text size="small" :disabled="index === sections.length - 1" :data-move-row="index" data-move-dir="1" :aria-label="`下移第 ${index + 1} 段`" @click="move(index, 1)">下移</el-button>
              <el-button text size="small" type="danger" :icon="Delete" @click="removeSection(index)">移除</el-button>
            </span>
          </div>
          <el-form-item label="小標" required>
            <el-input v-model="section.heading" maxlength="60" placeholder="例如：蒐集的資料" />
          </el-form-item>
          <el-form-item label="內文" required>
            <el-input v-model="section.body" type="textarea" maxlength="2000" show-word-limit :autosize="{ minRows: 3, maxRows: 14 }" />
          </el-form-item>
        </div>
      </div>
      <div v-if="!editor.readOnly.value" class="policy__actions">
        <el-button :icon="Plus" :disabled="sections.length >= PRIVACY_POLICY_SECTIONS_MAX" @click="addSection">新增一段</el-button>
        <span v-if="sections.length >= PRIVACY_POLICY_SECTIONS_MAX" class="hint">最多 {{ PRIVACY_POLICY_SECTIONS_MAX }} 段</span>
      </div>
    </el-form>
  </ContentEditor>
</template>

<style scoped>
.form-section {
  margin: 16px 0 12px;
  padding-top: 16px;
  border-top: 1px solid var(--line);
  color: var(--ink-2);
}
.policy__alert { margin-bottom: 12px; }
.policy__lead { margin: 0 0 12px; }
.policy__actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: 8px; }
.policy__row-actions { display: flex; flex-wrap: wrap; gap: 4px; }
.policy__row-actions .el-button + .el-button { margin-left: 0; }
</style>
```

- [ ] **Step 7：跑測試與型別** 

Run: `source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm --prefix admin run typecheck; npm --prefix admin run test:unit -- --maxWorkers=2`
Expected: typecheck 無錯誤；全套通過（原有檔數＋1 個新檔）。常見問題：`Lock` 圖示沒註冊 → 回 Step 4 補 import；`editor.item` 型別不存在 → 以 `useContentItem.ts` 回傳物件實際欄位為準（約 731 行有 `item,`）。

- [ ] **Step 8：Commit**

```bash
git add admin/src
git commit -m "feat(admin): 隱私權政策編輯頁（初稿、待確認計數、段落編輯）"
```

---

### Task 3：官網 `/privacy` 頁、內文解析與 SEO

**Files:**
- Create: `web/app/utils/privacy-policy.ts`
- Create: `web/app/components/PrivacyPolicyContent.vue`
- Create: `web/app/pages/privacy.vue`
- Create: `web/tests/privacy-policy.spec.ts`
- Modify: `web/app/types/site-content.ts`（`SiteContent` 約 331 行；新增介面放在 `AdmissionContent` 之後約 330 行）
- Modify: `web/app/utils/content-overlay.ts`（`LiveAdmissionContent` 附近新增 `LivePrivacyPolicy`；`ContentOverlay` 約 253 行；`guard('admission_content'…)` 之後約 614 行）
- Modify: `web/app/utils/seo.ts`（`StaticPage` 約 43 行；`PRIVACY_PATH`；`privacySeo`；`sitemapXml` 約 273 行）
- Modify: `web/app/composables/usePageSeo.ts`
- Modify: `web/server/routes/sitemap.xml.get.ts`

**Interfaces:**
- Consumes（Task 1）：`/public/site` 的 `content.privacy_policy`（snake_case，形狀同 payload）。
- Produces（Task 4 依賴）：`SiteContent.privacyPolicy?: PrivacyPolicyContent | null`（`{ title: string; updatedOn: string; sections: { heading: string; body: string }[] }`，`updatedOn` 沒填為 `''`）；`utils/privacy-policy.ts` 匯出 `parsePolicyBody`、`parseInlines`、`policyDateLabel`、`policyAnchor`、`footerPrivacyEntry`、`formPrivacyEntry`、型別 `PolicyInline`／`PolicyBlock`；元件 `PrivacyPolicyContent`（prop `policy: PrivacyPolicyContent`）；`PRIVACY_PATH`、`privacySeo`、`sitemapXml(origin, campuses, news?, options?: { privacy?: boolean })`。

- [ ] **Step 1：寫會失敗的測試** — 建立 `web/tests/privacy-policy.spec.ts`：

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import fixture from '../server/data/site-fixture.json'
import type { SiteContent } from '../app/types/site-content'
import { applyContentOverlay } from '../app/utils/content-overlay'
import {
  footerPrivacyEntry,
  formPrivacyEntry,
  parseInlines,
  parsePolicyBody,
  policyAnchor,
  policyDateLabel
} from '../app/utils/privacy-policy'
import { privacySeo, sitemapXml } from '../app/utils/seo'

const site = fixture as unknown as SiteContent
const text = (value: string) => ({ type: 'text', text: value })

describe('政策內文解析', () => {
  it('空行分段；同一段內的換行保留', () => {
    expect(parsePolicyBody('第一段\n\n第二段第一行\n第二段第二行')).toEqual([
      { type: 'paragraph', inlines: [text('第一段')] },
      { type: 'paragraph', inlines: [text('第二段第一行\n第二段第二行')] }
    ])
  })

  it('「- 」開頭的連續行合成一個清單，清單前後的文字各是一段', () => {
    expect(parsePolicyBody('我們蒐集：\n- 稱呼\n- 電話\n\n結尾')).toEqual([
      { type: 'paragraph', inlines: [text('我們蒐集：')] },
      { type: 'list', items: [[text('稱呼')], [text('電話')]] },
      { type: 'paragraph', inlines: [text('結尾')] }
    ])
  })

  it('Windows 換行與前後空白不影響結果', () => {
    expect(parsePolicyBody('\r\n甲\r\n\r\n- 乙\r\n')).toEqual([
      { type: 'paragraph', inlines: [text('甲')] },
      { type: 'list', items: [[text('乙')]] }
    ])
  })

  it('空內文沒有任何區塊', () => {
    expect(parsePolicyBody('')).toEqual([])
    expect(parsePolicyBody('  \n\n ')).toEqual([])
  })

  it('清單項目裡的網址也會變成連結', () => {
    expect(parsePolicyBody('- 詳見 https://a.example/x')).toEqual([
      { type: 'list', items: [[text('詳見 '), { type: 'link', text: 'https://a.example/x', href: 'https://a.example/x' }]] }
    ])
  })
})

describe('連結不吃標點', () => {
  it('只有 https:// 網址變成連結，全形標點留在文字', () => {
    expect(parseInlines('詳見 https://policies.google.com/privacy。')).toEqual([
      text('詳見 '),
      { type: 'link', text: 'https://policies.google.com/privacy', href: 'https://policies.google.com/privacy' },
      text('。')
    ])
  })

  it('括號與句點不算網址的一部分', () => {
    expect(parseInlines('(見 https://a.example/x).')).toEqual([
      text('(見 '),
      { type: 'link', text: 'https://a.example/x', href: 'https://a.example/x' },
      text(').')
    ])
    expect(parseInlines('https://a.example/x.')).toEqual([
      { type: 'link', text: 'https://a.example/x', href: 'https://a.example/x' },
      text('.')
    ])
  })

  it('http://、javascript:、mailto: 一律照原文顯示、不變連結', () => {
    expect(parseInlines('http://a.example 與 javascript:alert(1) 與 mailto:a@b.c')).toEqual([
      text('http://a.example 與 javascript:alert(1) 與 mailto:a@b.c')
    ])
  })

  it('HTML 字元照原文顯示（渲染時由 Vue 跳脫）', () => {
    const raw = '<script>alert("x")</script> & <b>粗</b>'
    expect(parseInlines(raw)).toEqual([text(raw)])
  })
})

describe('日期標籤與錨點', () => {
  it('YYYY-MM-DD 轉成「2026 年 10 月 3 日」；空值或壞格式回空字串', () => {
    expect(policyDateLabel('2026-10-03')).toBe('2026 年 10 月 3 日')
    expect(policyDateLabel('2026-01-09')).toBe('2026 年 1 月 9 日')
    for (const bad of ['', null, undefined, '2026/10/03', '2026-13-40', '2026-02-30', 'Invalid Date']) {
      expect(policyDateLabel(bad as string | null | undefined)).toBe('')
    }
  })

  it('錨點從 1 起算', () => {
    expect(policyAnchor(0)).toBe('privacy-section-1')
    expect(policyAnchor(11)).toBe('privacy-section-12')
  })
})

describe('入口判斷', () => {
  it('頁尾：有政策顯示連結（取代對話框），只有個資說明顯示對話框，都沒有不顯示', () => {
    expect(footerPrivacyEntry(true, true)).toBe('policy-link')
    expect(footerPrivacyEntry(true, false)).toBe('policy-link')
    expect(footerPrivacyEntry(false, true)).toBe('notice-dialog')
    expect(footerPrivacyEntry(false, false)).toBe('none')
  })

  it('預約表單：兩者都有→對話框加完整政策連結，只有政策→連結，只有說明→對話框', () => {
    expect(formPrivacyEntry(true, true)).toBe('dialog-with-policy')
    expect(formPrivacyEntry(true, false)).toBe('policy-link')
    expect(formPrivacyEntry(false, true)).toBe('dialog')
    expect(formPrivacyEntry(false, false)).toBe('none')
  })
})

describe('已發布內容疊進 SiteContent', () => {
  it('發布後有 privacyPolicy，沒填更新日期變空字串；沒發布就沒有', () => {
    const live = { title: '隱私權政策', updated_on: '2026-10-03', sections: [{ heading: '甲', body: '乙' }] }
    expect(applyContentOverlay(site, { privacy_policy: live }, {}).privacyPolicy).toEqual({
      title: '隱私權政策',
      updatedOn: '2026-10-03',
      sections: [{ heading: '甲', body: '乙' }]
    })
    expect(applyContentOverlay(site, { privacy_policy: { ...live, updated_on: null } }, {}).privacyPolicy?.updatedOn).toBe('')
    expect(applyContentOverlay(site, {}, {}).privacyPolicy).toBeUndefined()
  })
})

describe('SEO 與 sitemap', () => {
  it('標題、描述固定，canonical 指向 /privacy', () => {
    const withPolicy = { ...site, privacyPolicy: { title: '隱私權政策', updatedOn: '2026-10-03', sections: [] } } as SiteContent
    const seo = privacySeo(withPolicy, 'https://ivy.example')
    expect(seo.title).toBe(`隱私權政策｜${site.siteMeta.brandName}`)
    expect(seo.description).toBe('常春藤幼兒園官網如何蒐集、使用與保護您的個人資料，以及 Cookie 的使用方式。')
    expect(seo.canonical).toBe('https://ivy.example/privacy')
  })

  it('只有已發布才列進 sitemap', () => {
    expect(sitemapXml('https://ivy.example', [site.campuses[4]!])).not.toContain('/privacy')
    expect(sitemapXml('https://ivy.example', [site.campuses[4]!], undefined, { privacy: false })).not.toContain('/privacy')
    expect(sitemapXml('https://ivy.example', [site.campuses[4]!], undefined, { privacy: true })).toContain('<loc>https://ivy.example/privacy</loc>')
  })
})

describe('元件不用 v-html，連結另開並防 opener', () => {
  const source = readFileSync(fileURLToPath(new URL('../app/components/PrivacyPolicyContent.vue', import.meta.url)), 'utf8')
  it('原始碼檢查', () => {
    expect(source).not.toContain('v-html')
    expect(source).toContain('rel="noopener noreferrer"')
    expect(source).toContain('（另開新視窗）')
  })
})
```

- [ ] **Step 2：跑測試確認失敗**

Run: `source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm --prefix web run test:unit -- tests/privacy-policy.spec.ts`
Expected: FAIL（找不到 `../app/utils/privacy-policy`）。

- [ ] **Step 3：型別與疊資料** —

`web/app/types/site-content.ts`，在 `AdmissionContent` 介面之後加入，並在 `SiteContent` 介面最後（`siteMeta` 之後）加 `privacyPolicy?: PrivacyPolicyContent | null`：

```ts
/** 隱私權政策頁（/privacy）。後台 kind：privacy_policy；沒發布過就沒有這個欄位。 */
export interface PrivacyPolicySection { heading: string; body: string }
export interface PrivacyPolicyContent {
  title: string
  /** YYYY-MM-DD；後台沒填為空字串 */
  updatedOn: string
  sections: PrivacyPolicySection[]
}
```

`web/app/utils/content-overlay.ts`：在 `LiveAdmissionContent` 介面附近加：

```ts
export interface LivePrivacyPolicy {
  title: string
  updated_on?: string | null
  sections: { heading: string; body: string }[]
}
```

`ContentOverlay` 內 `admission_content` 那行之後加 `privacy_policy?: LivePrivacyPolicy | null`；在 `guard('admission_content', …)` 區塊之後加：

```ts
  guard('privacy_policy', () => {
    if (overlay.privacy_policy) {
      const policy = overlay.privacy_policy
      next.privacyPolicy = {
        title: policy.title,
        updatedOn: policy.updated_on ?? '',
        sections: policy.sections.map((section) => ({ heading: section.heading, body: section.body }))
      }
    }
  })
```

- [ ] **Step 4：內文解析與入口判斷（純函式）** — 建立 `web/app/utils/privacy-policy.ts`：

```ts
// 隱私權政策頁（/privacy）：內文是純文字，約定三種寫法——空行分段、一行開頭「- 」是條列、
// https:// 網址是連結。這裡只把文字切成 token，由元件產生元素；整條路徑不使用 v-html，
// 所以內文裡的 < > & " 一律照原文顯示。

export type PolicyInline =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; href: string }

export type PolicyBlock =
  | { type: 'paragraph'; inlines: PolicyInline[] }
  | { type: 'list'; items: PolicyInline[][] }

// 網址在空白、角括號、引號與全形標點處結束；ASCII 括號也不算網址。
const URL_PATTERN = /https:\/\/[^\s<>"'）)」』，。、；：]+/g
const TRAILING_PUNCTUATION = /[.,;:!?\]]+$/

function validHttps(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' && parsed.hostname.length > 0
  } catch {
    return false
  }
}

export function parseInlines(raw: string): PolicyInline[] {
  const inlines: PolicyInline[] = []
  let cursor = 0
  for (const match of raw.matchAll(URL_PATTERN)) {
    let url = match[0]
    const trail = url.match(TRAILING_PUNCTUATION)?.[0] ?? ''
    if (trail) url = url.slice(0, -trail.length)
    const start = match.index ?? 0
    if (!validHttps(url)) continue
    if (start > cursor) inlines.push({ type: 'text', text: raw.slice(cursor, start) })
    inlines.push({ type: 'link', text: url, href: url })
    cursor = start + url.length
  }
  if (cursor < raw.length) inlines.push({ type: 'text', text: raw.slice(cursor) })
  return inlines
}

export function parsePolicyBody(body: string): PolicyBlock[] {
  const blocks: PolicyBlock[] = []
  let paragraph: string[] = []
  let list: PolicyInline[][] = []

  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ type: 'paragraph', inlines: parseInlines(paragraph.join('\n')) })
    paragraph = []
  }
  const flushList = () => {
    if (list.length) blocks.push({ type: 'list', items: list })
    list = []
  }

  for (const rawLine of body.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim()
    if (!line) {
      flushParagraph()
      flushList()
    } else if (line.startsWith('- ')) {
      flushParagraph()
      const item = line.slice(2).trim()
      if (item) list.push(parseInlines(item))
    } else {
      flushList()
      paragraph.push(line)
    }
  }
  flushParagraph()
  flushList()
  return blocks
}

/** 「2026 年 10 月 3 日」；沒填、格式不對或不存在的日期回空字串。 */
export function policyDateLabel(value: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '')
  if (!match) return ''
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  return valid ? `${year} 年 ${month} 月 ${day} 日` : ''
}

export function policyAnchor(index: number): string {
  return `privacy-section-${index + 1}`
}

export type FooterPrivacyEntry = 'policy-link' | 'notice-dialog' | 'none'

/** 頁尾：政策已發布就放連結（取代「個資使用說明」對話框按鈕）；否則維持原本的對話框入口。 */
export function footerPrivacyEntry(hasPolicy: boolean, hasNotice: boolean): FooterPrivacyEntry {
  if (hasPolicy) return 'policy-link'
  return hasNotice ? 'notice-dialog' : 'none'
}

export type FormPrivacyEntry = 'dialog-with-policy' | 'dialog' | 'policy-link' | 'none'

/** 預約表單：個資使用說明對話框保留；政策已發布時對話框底部多一個完整政策連結，沒有說明就直接放連結。 */
export function formPrivacyEntry(hasPolicy: boolean, hasNotice: boolean): FormPrivacyEntry {
  if (hasNotice) return hasPolicy ? 'dialog-with-policy' : 'dialog'
  return hasPolicy ? 'policy-link' : 'none'
}
```

- [ ] **Step 5：SEO 與 sitemap** —

`web/app/utils/seo.ts`：`StaticPage` 型別改為 `'news' | 'about' | 'admission' | 'environment' | 'curriculum' | 'privacy'`；在 `ABOUT_PATH` 之後加 `export const PRIVACY_PATH = '/privacy'`；在 `admissionSeo` 函式之後加：

```ts
/** 隱私權政策頁的 SEO：標題以後台標題為準，描述固定，分享圖沿用首頁，麵包屑兩層。 */
export function privacySeo(site: SiteContent, siteOrigin: string) {
  const origin = normalizeSiteOrigin(siteOrigin)
  const policyTitle = site.privacyPolicy?.title || '隱私權政策'
  const title = `${policyTitle}｜${site.siteMeta.brandName}`
  const description = '常春藤幼兒園官網如何蒐集、使用與保護您的個人資料，以及 Cookie 的使用方式。'
  const canonical = origin ? `${origin}${PRIVACY_PATH}` : undefined
  const share = siteShareImage(site)
  const image = origin ? `${origin}${share.path}` : undefined
  const graph: Record<string, unknown>[] = origin ? [
    { '@type': 'WebPage', '@id': `${canonical}#page`, url: canonical, name: title, description, inLanguage: 'zh-Hant-TW', isPartOf: { '@id': `${origin}/#website` } },
    { '@type': 'BreadcrumbList', itemListElement: [
      { '@type': 'ListItem', position: 1, name: '首頁', item: `${origin}/` },
      { '@type': 'ListItem', position: 2, name: policyTitle, item: canonical }
    ] }
  ] : []
  return { title, description, canonical, image, imagePath: share.path, imageAlt: share.alt, graph }
}
```

`sitemapXml` 簽章改為 `sitemapXml(origin: string, campuses: Pick<Campus, 'key'>[], news?: Pick<NewsContent, 'articles' | 'sampleNote'>, options: { privacy?: boolean } = {})`，`urls` 陣列在 `NEWS_PATH` 之後加 `...(options.privacy ? [PRIVACY_PATH] : [])`。

`web/server/routes/sitemap.xml.get.ts` 最後一行改為：

```ts
  return sitemapXml(origin, published.content.campuses, published.content.news, { privacy: Boolean(published.content.privacyPolicy) })
```

`web/app/composables/usePageSeo.ts`：import 清單加 `privacySeo`；`seo` 計算屬性在 `admission` 那行之後加 `if (page === 'privacy') return privacySeo(site.value, origin)`；`hero` 計算屬性把 `if (page === 'news') return undefined` 改成 `if (page === 'news' || page === 'privacy') return undefined`。

- [ ] **Step 6：頁面與內容元件** —

建立 `web/app/pages/privacy.vue`：

```vue
<script setup lang="ts">
// 隱私權政策（/privacy）。主體在 components/PrivacyPolicyContent.vue，草稿預覽共用同一份。
// 園方還沒發布（官網內容沒有 privacyPolicy）時回 404。
const { data, error } = await usePublishedSite()
assertPublishedSite(error)

const policy = computed(() => data.value?.content.privacyPolicy ?? null)
if (!policy.value) {
  throw createError({ statusCode: 404, message: '找不到這個頁面' })
}

usePageSeo(computed(() => data.value?.content), undefined, 'privacy')
</script>

<template>
  <div v-if="data && policy">
    <SiteHeader :content="data.content" />
    <PrivacyPolicyContent :policy="policy" />
    <SiteFooter :content="data.content" />
  </div>
</template>
```

建立 `web/app/components/PrivacyPolicyContent.vue`：

```vue
<script setup lang="ts">
import type { PrivacyPolicyContent } from '~/types/site-content'
import { parsePolicyBody, policyAnchor, policyDateLabel } from '~/utils/privacy-policy'

// 隱私權政策主體：公開頁 pages/privacy.vue 與草稿預覽 pages/preview.vue?page=privacy 共用。
// 內文純文字（空行分段、「- 」條列、https:// 連結），由 utils/privacy-policy.ts 切成 token；
// 不使用 v-html，內文裡的 HTML 字元照原文顯示。
const props = defineProps<{ policy: PrivacyPolicyContent }>()

const updated = computed(() => policyDateLabel(props.policy.updatedOn))
const sections = computed(() => props.policy.sections.map((section, index) => ({
  ...section,
  id: policyAnchor(index),
  blocks: parsePolicyBody(section.body)
})))
</script>

<template>
  <main id="main" tabindex="-1" class="policy">
    <div class="container breadcrumb"><NuxtLink to="/">首頁</NuxtLink> / {{ policy.title }}</div>
    <article class="container policy-body">
      <h1>{{ policy.title }}</h1>
      <p v-if="updated" class="policy-updated">最後更新：{{ updated }}</p>

      <nav v-if="sections.length > 1" class="policy-toc" aria-label="本頁段落">
        <ol>
          <li v-for="section in sections" :key="section.id"><a :href="`#${section.id}`">{{ section.heading }}</a></li>
        </ol>
      </nav>

      <section v-for="section in sections" :id="section.id" :key="section.id" class="policy-section" :aria-labelledby="`${section.id}-title`">
        <h2 :id="`${section.id}-title`">{{ section.heading }}</h2>
        <template v-for="(block, blockIndex) in section.blocks" :key="blockIndex">
          <p v-if="block.type === 'paragraph'">
            <template v-for="(part, partIndex) in block.inlines" :key="partIndex"><a v-if="part.type === 'link'" :href="part.href" target="_blank" rel="noopener noreferrer">{{ part.text }}<span class="sr-only">（另開新視窗）</span></a><template v-else>{{ part.text }}</template></template>
          </p>
          <ul v-else>
            <li v-for="(item, itemIndex) in block.items" :key="itemIndex">
              <template v-for="(part, partIndex) in item" :key="partIndex"><a v-if="part.type === 'link'" :href="part.href" target="_blank" rel="noopener noreferrer">{{ part.text }}<span class="sr-only">（另開新視窗）</span></a><template v-else>{{ part.text }}</template></template>
            </li>
          </ul>
        </template>
      </section>
    </article>
  </main>
</template>

<style scoped>
.policy { padding-bottom: 96px; }
.policy-body { max-width: 720px; margin-inline: auto; }
.policy-body h1 { font-size: var(--fs-4xl); font-weight: 700; letter-spacing: .02em; }
.policy-updated { margin-top: 12px; color: var(--muted); font-size: var(--fs-sm); }
.policy-toc { margin: 32px 0 8px; padding: 20px 24px; background: var(--cream); border-radius: 5px; }
.policy-toc ol { margin: 0; padding-left: 1.4em; display: grid; gap: 2px; }
.policy-toc a { display: inline-flex; align-items: center; min-height: 44px; text-decoration: underline; text-underline-offset: 4px; }
.policy-section { margin-top: 40px; scroll-margin-top: 140px; }
.policy-section h2 { font-size: var(--fs-2xl); font-weight: 700; }
.policy-section p, .policy-section ul { margin: 16px 0 0; max-width: none; line-height: 2; white-space: pre-line; overflow-wrap: anywhere; }
.policy-section ul { padding-left: 1.4em; white-space: normal; }
.policy-section li + li { margin-top: 6px; }
.policy-section a { color: var(--green); text-decoration: underline; text-underline-offset: 4px; }
@media (max-width: 760px) {
  .policy-body h1 { font-size: var(--fs-3xl); }
  .policy-section { scroll-margin-top: 100px; }
}
</style>
```

- [ ] **Step 7：跑測試、型別與回歸**

Run: `source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm --prefix web run typecheck; npm run test:website -- --maxWorkers=2`
Expected: typecheck 0 錯誤、**0 個 WARN**（Nuxt 自動匯入的重名警告要看輸出，不只看結束碼）；`privacy-policy.spec.ts` 全過、其餘 web 測試不退步（`seo.spec.ts` 的 sitemap 測試仍過，因為第 4 參數有預設值）。

- [ ] **Step 8：Commit**

```bash
git add web
git commit -m "feat(web): 隱私權政策頁（/privacy）、內文解析、SEO 與 sitemap"
```

---

### Task 4：頁尾與預約表單入口、草稿預覽

**Files:**
- Modify: `web/app/components/SiteFooter.vue`（script 約 12–13 行；底列約 46–49 行；style 內加一條）
- Modify: `web/app/components/PrivacyNoticeDialog.vue`（props、template 底部、style）
- Modify: `web/app/components/VisitForm.vue`（props 約 13–17 行；template 約 605 行）
- Modify: `web/app/pages/visit/index.vue`、`web/app/pages/visit/[key].vue`（傳 `policy-path`）
- Modify: `web/app/composables/useDraftPreview.ts`（`SharedKind`、`SHARED_KINDS` 約 38–50 行）
- Modify: `web/app/utils/draft-preview.ts`（`PreviewPage`、`previewPage`、檔頭註解）
- Modify: `web/app/pages/preview.vue`（約 109 行 `AdmissionContent` 之後）
- Modify: `web/tests/privacy-policy.spec.ts`（追加預覽測試）

**Interfaces:**
- Consumes（Task 3）：`SiteContent.privacyPolicy`、`footerPrivacyEntry`、`formPrivacyEntry`、`PrivacyPolicyContent` 元件。
- Produces（Task 5 依賴）：頁尾連結文字固定為「隱私權政策」（`<a href="/privacy">`）；預約表單政策連結文字「隱私權政策」，對話框底部連結「完整隱私權政策」；`/preview?page=privacy` 顯示草稿。

- [ ] **Step 1：追加會失敗的測試** — 在 `web/tests/privacy-policy.spec.ts` 檔尾追加：

```ts
import { previewPage } from '../app/utils/draft-preview'

describe('草稿預覽', () => {
  it('?page=privacy 是獨立頁；其餘照舊', () => {
    expect(previewPage({ page: 'privacy' })).toBe('privacy')
    expect(previewPage({ page: 'admission' })).toBe('admission')
    expect(previewPage({ page: 'unknown' })).toBe('home')
  })

  it('預覽會讀 privacy_policy 草稿，預覽頁有對應分支', () => {
    const composable = readFileSync(fileURLToPath(new URL('../app/composables/useDraftPreview.ts', import.meta.url)), 'utf8')
    expect(composable).toContain("'privacy_policy'")
    const page = readFileSync(fileURLToPath(new URL('../app/pages/preview.vue', import.meta.url)), 'utf8')
    expect(page).toContain("page === 'privacy'")
    expect(page).toContain('PrivacyPolicyContent')
  })
})

describe('入口元件接線', () => {
  const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
  it('頁尾用 footerPrivacyEntry，表單用 formPrivacyEntry，政策連結都開新分頁', () => {
    const footer = read('../app/components/SiteFooter.vue')
    expect(footer).toContain('footerPrivacyEntry')
    expect(footer).toContain('to="/privacy"')
    const form = read('../app/components/VisitForm.vue')
    expect(form).toContain('formPrivacyEntry')
    expect(form).toContain('href="/privacy"')
    expect(form).toContain('rel="noopener noreferrer"')
    const dialog = read('../app/components/PrivacyNoticeDialog.vue')
    expect(dialog).toContain('完整隱私權政策')
    expect(dialog).toContain('rel="noopener noreferrer"')
  })
})
```

（`import { previewPage }` 放在檔案最上面的 import 區，不要留在檔尾。）

- [ ] **Step 2：跑測試確認失敗**

Run: `source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm --prefix web run test:unit -- tests/privacy-policy.spec.ts`
Expected: 新增的三組失敗（`previewPage` 回 `'home'`、原始碼找不到字串）。

- [ ] **Step 3：頁尾** — `web/app/components/SiteFooter.vue`：script 加 import 與計算屬性：

```ts
import { footerPrivacyEntry } from '~/utils/privacy-policy'
```

在 `privacyNotice` 那行之後加：

```ts
// 政策已發布：頁尾放固定的「隱私權政策」連結，取代個資使用說明的對話框按鈕（避免兩個隱私入口）。
const privacyEntry = computed(() => footerPrivacyEntry(Boolean(props.content.privacyPolicy), Boolean(privacyNotice.value)))
```

底列（約 46–49 行）改成：

```vue
    <div v-if="content.footer.copyright || content.footer.bottomNote || privacyEntry !== 'none'" class="container footer-bottom">
      <span v-if="content.footer.copyright">{{ content.footer.copyright }}</span>
      <NuxtLink v-if="privacyEntry === 'policy-link'" to="/privacy" class="footer-privacy-link">隱私權政策</NuxtLink>
      <PrivacyNoticeDialog v-else-if="privacyEntry === 'notice-dialog' && privacyNotice" :notice="privacyNotice" trigger-class="footer-privacy" />
      <span v-if="content.footer.bottomNote">{{ content.footer.bottomNote }}</span>
    </div>
```

在 `<style scoped>` 的 `.footer a:hover` 規則之後加：

```css
.footer-privacy-link { text-decoration: underline; text-underline-offset: 5px; }
.footer a.footer-privacy-link:focus-visible { outline-color: var(--footer-focus); }
```

- [ ] **Step 4：個資說明對話框的完整政策連結** — `web/app/components/PrivacyNoticeDialog.vue`：props 改成：

```ts
const props = withDefaults(defineProps<{
  notice: PrivacyNotice
  label?: string
  triggerClass?: string
  /** 政策已發布時傳 '/privacy'：對話框底部多一個「完整隱私權政策」連結（開新分頁，已填的表單不見） */
  policyHref?: string | null
}>(), { label: '個資使用說明', triggerClass: '', policyHref: null })
```

template 在 `</section>`（`v-for` 段落結束）之後、`</dialog>` 之前加：

```vue
      <p v-if="props.policyHref" class="privacy-dialog-policy">
        <a :href="props.policyHref" target="_blank" rel="noopener noreferrer">完整隱私權政策<span class="sr-only">（另開新視窗）</span><span aria-hidden="true"> ↗</span></a>
      </p>
```

style 區加：

```css
.privacy-dialog-policy { margin: 24px 0 0; padding-top: 16px; border-top: 1px solid var(--line); }
.privacy-dialog-policy a { display: inline-flex; align-items: center; min-height: 44px; color: var(--green); text-decoration: underline; text-underline-offset: 4px; }
```

- [ ] **Step 5：預約表單** — `web/app/components/VisitForm.vue`：

props（約 13–17 行）加一項：

```ts
const props = defineProps<{
  booking: BookingContent
  campuses: Campus[]
  initialCampus?: string
  /** 隱私權政策已發布時由頁面傳 '/privacy'（沒發布傳 null） */
  policyPath?: string | null
}>()
```

在 `privacyNotice` 計算屬性（約 54 行）之後加（`formPrivacyEntry` 要 import：`import { formPrivacyEntry } from '~/utils/privacy-policy'`，放在檔案既有 import 區）：

```ts
const privacyEntry = computed(() => formPrivacyEntry(Boolean(props.policyPath), Boolean(privacyNotice.value)))
```

template 約 605 行那一行：

```vue
                  <PrivacyNoticeDialog v-if="privacyNotice" :notice="privacyNotice" label="閱讀個資使用說明" trigger-class="visit-privacy-link" />
```

換成：

```vue
                  <PrivacyNoticeDialog
                    v-if="privacyNotice && (privacyEntry === 'dialog' || privacyEntry === 'dialog-with-policy')"
                    :notice="privacyNotice"
                    label="閱讀個資使用說明"
                    trigger-class="visit-privacy-link"
                    :policy-href="privacyEntry === 'dialog-with-policy' ? policyPath : null"
                  />
                  <a v-else-if="privacyEntry === 'policy-link'" class="visit-privacy-link" href="/privacy" target="_blank" rel="noopener noreferrer">隱私權政策<span class="sr-only">（另開新視窗）</span></a>
```

`visit-booking.css` 約 190 行的 `.visit-contact-form :deep(.visit-privacy-link)` 規則是 `:deep` 套用到子元件根；新的 `<a>` 在 VisitForm 自己的 template 裡，同一條選擇器 `.visit-contact-form .visit-privacy-link` 也要命中——在該行旁邊補一條：

```css
.visit-contact-form a.visit-privacy-link {display:inline-flex;align-items:center;min-height:44px;font-size:var(--fs-sm);color:var(--visit-ink);text-decoration:underline;text-underline-offset:5px}
```

`web/app/pages/visit/index.vue` 的 `<VisitForm …/>` 加 `:policy-path="data.content.privacyPolicy ? '/privacy' : null"`；`web/app/pages/visit/[key].vue` 同樣加在 `<VisitForm …/>`。

- [ ] **Step 6：草稿預覽** —

`web/app/composables/useDraftPreview.ts`：`SharedKind` 聯集尾端加 `| 'privacy_policy'`；`SHARED_KINDS` 陣列尾端加 `'privacy_policy'`。

`web/app/utils/draft-preview.ts`：`PreviewPage` 改成 `'home' | 'admission' | 'campus' | 'visit' | 'privacy'`；`previewPage` 的判斷改成 `page === 'admission' || page === 'campus' || page === 'visit' || page === 'privacy' ? page : 'home'`；檔頭註解的 `page：` 清單補 `privacy（隱私權政策）`。

`web/app/pages/preview.vue`：頁面上方的 `?page=` 註解補 `?page=privacy 隱私權政策`；在 `<AdmissionContent v-if="page === 'admission'" …/>` 之後（同一個 `v-if/v-else-if` 鏈）加：

```vue
        <PrivacyPolicyContent v-else-if="page === 'privacy' && draft.privacyPolicy" :policy="draft.privacyPolicy" />
        <main v-else-if="page === 'privacy'" id="main" tabindex="-1">
          <div class="container breadcrumb">還沒有儲存過隱私權政策的草稿，請先在後台儲存。</div>
        </main>
```

- [ ] **Step 7：跑測試與型別**

Run: `source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm --prefix web run typecheck; npm run test:website -- --maxWorkers=2`
Expected: typecheck 0 錯誤、0 WARN；全套通過（含 `privacy-consent.spec.ts`、`campus-banner.spec.ts` 不退步）。

- [ ] **Step 8：Commit**

```bash
git add web
git commit -m "feat(web): 頁尾與預約表單加隱私權政策入口、草稿預覽"
```

---

### Task 5：stack e2e、文件與驗收紀錄

**Files:**
- Create: `tests/stack/privacy-policy.spec.ts`
- Modify: `docs/specs/2026-10-03-privacy-policy-page-design.md`（第 11 節 P12 一句）
- Modify: `docs/website-admin/seo-performance.md`（第 37 行）
- Modify: `docs/website-admin/acceptance.md`（檔尾新增「隱私權政策頁」一節）
- Modify: `deploy/README.md`（第 16 行之前新增一節）
- Modify: `README.md`（檔頂新增日期段落）

**Interfaces:**
- Consumes：Task 1 的 API（`/admin/content-items/privacy_policy`、`/publish`）、Task 3–4 的頁面與入口文字；`tests/stack/api.ts` 的 `adminApi('super_admin')`、`tests/stack/pages.ts` 的 `skipEntrance`、`expectNoHorizontalOverflow`。

- [ ] **Step 1：寫 e2e** — 建立 `tests/stack/privacy-policy.spec.ts`：

```ts
import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import { adminApi } from './api'
import { expectNoHorizontalOverflow, skipEntrance } from './pages'

// 隱私權政策頁（規格 P07、P09、P10、P12）。同一支 spec 內依序：未發布 → 404；用後台 API 發布 → 頁面、
// 頁尾入口、預約表單入口、截圖與 axe。發布後政策會留在這個庫裡，之後的 spec 看到的頁尾是「隱私權政策」連結，
// 所以放在同一個 describe 並關掉重試（重試時政策已發布，404 那一步會誤報）。
test.describe.configure({ mode: 'serial', retries: 0 })

const POLICY = {
  title: '隱私權政策',
  updated_on: '2026-10-03',
  sections: [
    { heading: '適用範圍', body: '本政策適用本網站。\n\n- 條列一\n- 條列二\n\n詳見 https://policies.google.com/privacy 與一段很長很長的網址 https://example.com/' + 'a'.repeat(120) },
    { heading: '聯絡我們', body: '各校電話請見「五所校園」。<b>不是粗體</b>' },
  ],
}

test('未發布時 /privacy 是 404、頁尾沒有隱私權政策連結', async ({ page }) => {
  const response = await page.goto('/privacy')
  expect(response?.status()).toBe(404)
  await page.goto('/')
  await skipEntrance(page)
  await expect(page.getByRole('link', { name: '隱私權政策' })).toHaveCount(0)
})

test('發布後：頁面、目錄、連結、頁尾與預約表單入口', async ({ page }) => {
  const api = await adminApi('super_admin')
  const item = await api.get<{ latest_version: number }>('/admin/content-items/privacy_policy')
  const saved = await api.send<{ latest_revision: { id: string } }>('POST', '/admin/content-items/privacy_policy/revisions', {
    expected_version: item.latest_version,
    payload: POLICY,
  })
  await api.send('POST', '/admin/content-items/privacy_policy/publish', { revision_id: saved.latest_revision.id })
  await api.dispose()

  // 官網 SSR 有 3 秒已發布內容快取（web/server/utils/published-site.ts）。
  await expect.poll(async () => (await page.request.get('/privacy')).status(), { timeout: 15_000 }).toBe(200)

  await page.goto('/privacy')
  await expect(page.getByRole('heading', { level: 1, name: '隱私權政策' })).toBeVisible()
  await expect(page.getByText('最後更新：2026 年 10 月 3 日')).toBeVisible()
  await expect(page.getByRole('heading', { level: 2, name: '適用範圍' })).toBeVisible()
  await expect(page.getByRole('listitem').filter({ hasText: '條列一' })).toBeVisible()
  // 只有 https:// 變連結；HTML 字元照原文顯示
  const link = page.getByRole('link', { name: /policies\.google\.com\/privacy/ })
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  await expect(page.getByText('<b>不是粗體</b>', { exact: false })).toBeVisible()
  // 目錄跳到段落
  await page.getByRole('navigation', { name: '本頁段落' }).getByRole('link', { name: '聯絡我們' }).click()
  await expect(page).toHaveURL(/#privacy-section-2$/)

  // SEO
  await expect(page).toHaveTitle(/^隱私權政策｜/)
  const robots = await page.locator('meta[name="robots"]').first().getAttribute('content')
  expect(robots).toBeTruthy()

  // axe：serious／critical 一律擋
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze()
  expect(results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([])

  // sitemap（stack 沒開索引時是空的 sitemap，只在有網址時才驗）
  const sitemap = await (await page.request.get('/sitemap.xml')).text()
  if (sitemap.includes('<url>')) expect(sitemap).toContain('/privacy')

  // 頁尾入口
  await page.goto('/')
  await skipEntrance(page)
  const footerLink = page.locator('footer').getByRole('link', { name: '隱私權政策' })
  await expect(footerLink).toBeVisible()
  await footerLink.click()
  await expect(page).toHaveURL(/\/privacy$/)
})

test('預約表單：個資使用說明對話框有完整政策連結', async ({ page, context }) => {
  // global.setup.ts 已發布個資使用說明，所以表單會顯示對話框入口。
  await page.goto('/visit/yihua')
  await skipEntrance(page)
  await page.getByRole('button', { name: '閱讀個資使用說明' }).click()
  const dialog = page.getByRole('dialog', { name: '個資使用說明' })
  const policy = dialog.getByRole('link', { name: /完整隱私權政策/ })
  await expect(policy).toHaveAttribute('href', '/privacy')
  const [popup] = await Promise.all([context.waitForEvent('page'), policy.click()])
  await expect(popup).toHaveURL(/\/privacy$/)
  await popup.close()
})

for (const viewport of [{ name: '1440', width: 1440, height: 900 }, { name: '390', width: 390, height: 844 }]) {
  test(`${viewport.name}px：/privacy 不橫向溢出、截圖留存`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/privacy')
    await expect(page.getByRole('heading', { level: 1, name: '隱私權政策' })).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: `output/playwright/privacy-${viewport.name}.png`, fullPage: true })
  })
}
```

- [ ] **Step 2：跑 e2e** 

Run（先 build，再跑；必須用自己的庫名與埠，不要用預設值或別人的埠；先 `lsof -nP -iTCP:8741 -iTCP:3741 -sTCP:LISTEN` 確認沒被占用）：

```bash
source ~/.nvm/nvm.sh; nvm use 22 >/dev/null
export E2E_DB_NAME=ivy_website_e2e_test_privacy E2E_API_PORT=8741 E2E_WEB_PORT=3741
npm run e2e:build
npm run test:e2e:stack -- privacy-policy keyboard --reporter=line
```

Expected: `privacy-policy.spec.ts` 6 項（1 + 1 + 1 + 2 個螢幕尺寸）與 `keyboard.spec.ts` 全過。預約表單那項若找不到「閱讀個資使用說明」，回頭看 `tests/stack/global.setup.ts:48-56` 是否仍會發布個資使用說明。用 Read 看 `output/playwright/privacy-1440.png`、`privacy-390.png`：標題、更新日期、目錄、條列、長網址斷行、頁尾；有問題就修 Task 3 的元件，不要放寬斷言。

- [ ] **Step 3：整套 stack（回歸）**

Run: 同上環境變數 `npm run test:e2e:stack -- --reporter=line`
Expected: 全部 passed（原有 68 項＋本 spec 6 項）。已知例外：`media.spec.ts` 整套跑偶發失敗、單獨跑會過；只有它失敗時單獨重跑 `npm run test:e2e:stack -- media`。「各校預約方式」截圖若因頁尾變動以外的原因失敗，先看 diff 圖，不要直接更新基準。

- [ ] **Step 4：文件更正與規格同步** —

`docs/website-admin/seo-performance.md` 第 37 行：

```
- 事件寫成 `website_telemetry` JSON 日誌，未新增 DB／migration。平台可能另外保存基礎 HTTP 存取日誌；這不在本程式事件欄位內。
```

改成：

```
- 事件除了寫成 `website_telemetry` JSON 日誌，也會彙總存進資料庫：`page_view_daily`（日期、頁面、校區、裝置的瀏覽累計）、`web_vital_samples`（網頁速度樣本，保留 90 天，清理在 `backend/app/operations/traffic_service.py`）與去識別化的 `analytics_events`；都不存 IP 與 cookie。平台可能另外保存基礎 HTTP 存取日誌；這不在本程式事件欄位內。
```

`docs/specs/2026-10-03-privacy-policy-page-design.md` 第 11 節 P12 那列「`a11y.spec.ts` 加 `/privacy`」改成「`/privacy` 的 axe 檢查寫在 `privacy-policy.spec.ts`（發布後才有這一頁，`a11y.spec.ts` 在它之前執行）」。

- [ ] **Step 5：驗收紀錄、部署草稿、README** —

`docs/website-admin/acceptance.md` 檔尾新增（驗證結果欄填 Step 2、3 與 Task 1–4 實際跑出的數字，不要照抄範例數字）：

```markdown
## 隱私權政策頁（2026-10-03 實作，尚未部署）

規格 `docs/specs/2026-10-03-privacy-policy-page-design.md`，計畫 `docs/superpowers/plans/2026-10-03-privacy-policy-page.md`。

| 編號 | 案例 | 狀態 | 證據 |
|---|---|---|---|
| P01 | payload 驗證 | 通過 | `backend/tests/test_privacy_policy_content.py`（`test_bad_payloads_are_rejected` 11 種、`test_api_returns_422_for_bad_payload`） |
| P02 | 發布阻擋 | 通過 | 同檔 `test_pending_marker_blocks_publish_with_count`、`test_pending_marker_in_title_blocks_publish`、`test_missing_updated_on_blocks_publish` |
| P03 | 權限 | 通過 | 同檔 `test_editor_can_read_but_not_edit_shared_policy`；`admin/src/__tests__/bugfixRegressions.test.ts`（`privacy-policy` 限 super_admin） |
| P04 | 公開輸出 | 通過 | 同檔 `test_public_site_has_policy_only_after_publish`、`test_draft_with_pending_marker_does_not_replace_published` |
| P05 | 後台編輯 | 部分 | `admin/src/__tests__/privacyPolicy.test.ts`（側欄、標籤、初稿 12 段與 8 處待確認、計數）；編輯畫面的互動未寫元件測試，由人工開頁確認 |
| P06 | 內文渲染 | 通過 | `web/tests/privacy-policy.spec.ts`（分段、條列、https 連結、標點、HTML 字元、元件無 `v-html`） |
| P07 | 頁面 | 通過 | `web/tests/privacy-policy.spec.ts`（SEO）；stack `privacy-policy.spec.ts`（未發布 404、發布後內容與目錄） |
| P08 | sitemap | 通過 | `web/tests/privacy-policy.spec.ts`（`sitemapXml` 的 `privacy` 選項） |
| P09 | 頁尾 | 通過 | `footerPrivacyEntry` 單元測試；stack 頁尾連結 |
| P10 | 預約表單 | 通過 | `formPrivacyEntry` 單元測試；stack 對話框完整政策連結 |
| P11 | 草稿預覽 | 部分 | `previewPage('privacy')`、預覽頁分支的原始碼檢查；登入後實際預覽未在 e2e 驗證 |
| P12 | stack e2e／版面 | 通過 | `tests/stack/privacy-policy.spec.ts`（1440／390 不溢出、axe 無 serious／critical）；截圖 `output/playwright/privacy-{1440,390}.png` |

**上線前必須由園方處理**：在後台補完 8 項【待確認】（規格第 8 節）、填最後更新日期、發布；並依政策第 7 段寫的保存天數設定保存政策、開啟自動清理（`WEBSITE_RETENTION_ALLOW_REAL_RUN`）。
```

`deploy/README.md` 在第 16 行（`## 招生入學…` 那節）之前新增：

```markdown
## 隱私權政策頁（`feature/privacy-policy-20261003`，尚未部署）

後台「全站與素材 → 隱私權政策」編輯，發布後官網多 `/privacy` 頁、頁尾多「隱私權政策」連結、預約表單的個資使用說明對話框多「完整隱私權政策」連結。**沒有 migration、沒有新環境變數、沒有新端點。**

- 部署後，政策在園方發布之前**官網沒有這一頁**（`/privacy` 回 404、頁尾與 sitemap 都沒有）。
- 園方上線步驟：後台打開「隱私權政策」會看到初稿 → 補完 8 項【待確認】（登記名稱、招生用途寫法、Turnstile 是否啟用、寄信服務商、主機地區、預約與招生訪視保存天數、聯絡 Email）→ 填最後更新日期 → 發布。含【待確認】或沒填日期時發布鈕會被擋。
- 政策第 7 段寫的保存天數要和實際設定一致：保存政策預設不自動清理，要在後台設天數、開啟自動清理，部署設定也要有 `WEBSITE_RETENTION_ALLOW_REAL_RUN=true`。
- 本頁沒有 cookie 橫幅（2026-10-03 使用者裁定）。之後上線 GA4、廣告像素或第一方歸因 cookie 之前，要先改寫政策第 5 段並發布，同時改 `docs/website-admin/seo-performance.md:33` 的承諾。
- 上線後唯讀檢查：`/privacy` 發布前 404；發布後 200、頁尾有連結；`/sitemap.xml`（開放索引後）有 `/privacy`。

**本節尚未部署，部署後才補部署紀錄。**
```

`README.md` 檔頂新增（驗證數字填實際值）：

```markdown
## 2026-10-03 隱私權政策頁（`feature/privacy-policy-20261003`，未部署）

使用者決定官網改用 cookie 做行銷分析（自建歸因＋GA4＋廣告像素）、不做 cookie 橫幅；拆三部分，本段是第 1 部分：後台可編輯的隱私權政策。

- **後端**：新共用內容 `privacy_policy`（標題、最後更新日期、1–20 段）；含「【待確認」或沒填日期不能發布；沒有 migration。
- **後台**：「全站與素材 → 隱私權政策」編輯頁，第一次打開帶入初稿（12 段，8 處待園方補）。
- **官網**：`/privacy` 頁（目錄、條列、https 連結，不用 `v-html`；未發布 404）、頁尾連結取代個資使用說明按鈕、預約表單對話框加完整政策連結、草稿預覽 `?page=privacy`、sitemap。
- **文件**：`docs/website-admin/seo-performance.md` 的統計儲存說明改成現況。
- **驗證**：（填實際跑過的指令與結果）
```

- [ ] **Step 6：最後驗證與 Commit**

Run: `source ~/.nvm/nvm.sh; nvm use 22 >/dev/null; npm run contract:check; npm --prefix admin run typecheck; npm --prefix admin run test:unit -- --maxWorkers=2; npm --prefix web run typecheck; npm run test:website -- --maxWorkers=2; npm --prefix admin run build`（後端整套 pytest 由主 session 在背景另跑：`cd backend; WEBSITE_TEST_DATABASE_URL=postgresql+asyncpg://localhost/ivy_website_test_privacy uv run --frozen pytest -q`）
Expected: 全部通過；後端整套只有 main 既有、與本功能無關的失敗才可以存在，要在驗收紀錄寫明。

```bash
git add tests/stack/privacy-policy.spec.ts docs README.md deploy/README.md
git commit -m "test(e2e): 隱私權政策頁端到端與驗收紀錄、更正統計儲存說明"
```
