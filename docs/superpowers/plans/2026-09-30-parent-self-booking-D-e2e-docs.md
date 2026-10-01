# 階段 D：端到端驗證與文件 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用真的 API＋官網＋後台跑完整條家長預約與園方場次管理流程；更新規則文件與部署說明草稿；整條分支交審。

**Tech Stack:** Playwright（`playwright.stack.config.ts`，`tests/stack/`）、Chrome。

**Spec:** §6、§7、§8。**前置：** 階段 A、B、C 閘門已過。

**先讀：** 記憶「stack e2e 陷阱」：`media.spec.ts` 整套跑偶發失敗（main 既有，單獨跑會過）；`submitPublicRequest` 的 Idempotency-Key 是「校區＋手機」，新測試別撞號；跑 stack 用自訂 `E2E_DB_NAME`／埠，避免與其他 worktree 衝突。機器 8GB：跑 stack 時不要同時跑別的測試。

---

### Task D1：stack e2e 改寫

**Files:**
- Modify: `tests/stack/global.setup.ts`（66–69 行）、`tests/stack/stack-env.ts`（`INQUIRY_CAMPUS`）、`tests/stack/api.ts`（`submitPublicRequest` 74–102 行）
- Modify: `tests/stack/booking-flow.spec.ts`、`tests/stack/schedule-flow.spec.ts`、`tests/stack/a11y.spec.ts`（83 行路由表）、`tests/stack/keyboard.spec.ts`（125 行路由表）
- Create: `tests/stack/mail.ts`

**Interfaces:**
- Produces: `readMail(filter?: (mail) => boolean): Promise<{ to: string; subject: string; body: string }[]>`（讀 `path.join(STATE_DIR, 'mail')` 下的 JSON）

- [ ] **Step 1：setup 與 helper**

`global.setup.ts`：yihua 的 `setMode(..., { mode: 'slots', slots_auto_confirm: false })` 改 `{ mode: 'slots' }`；minghua 的 `{ mode: 'inquiry' }` 改成「建 slot 後 `{ mode: 'slots' }`」。`stack-env.ts` 刪 `INQUIRY_CAMPUS`（`grep -rn INQUIRY_CAMPUS tests/` 清掉所有引用）。

`api.ts` 的 `submitPublicRequest`：`data` 加 `email: \`e2e-${campus}-${phone}@example.com\``；`slots` 以外的模式直接 `throw new Error('只支援自選場次')`；回傳加 `manage_path`。

`tests/stack/mail.ts`：

```ts
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { STATE_DIR } from './stack-env'

export interface SinkMail { to: string; subject: string; body: string; sent_at: string }

export async function readMail(filter: (mail: SinkMail) => boolean = () => true): Promise<SinkMail[]> {
  const dir = path.join(STATE_DIR, 'mail')
  const names = await readdir(dir).catch(() => [] as string[])
  const mails = await Promise.all(names.filter(n => n.endsWith('.json')).map(async n => JSON.parse(await readFile(path.join(dir, n), 'utf8')) as SinkMail))
  return mails.filter(filter).sort((a, b) => a.sent_at.localeCompare(b.sent_at))
}
```
（`STATE_DIR` 若 `stack-env.ts` 沒有 export 就 export。確認 `start-api.sh` 有設 `WEBSITE_NOTIFICATION_EMAIL_SINK_DIR` 與 `WEBSITE_ADMIN_ORIGIN`；api 內建背景工作每 60 秒一輪，測試用 `expect.poll(() => readMail(...), { timeout: 90_000 })` 等信。若 stack 啟動時 `WEBSITE_BACKGROUND_JOBS_INTERVAL_SECONDS` 可設，改成 5 秒縮短等待，寫進 `start-api.sh`。）

- [ ] **Step 2：booking-flow.spec.ts**

刪除「家長送出需求 → 園方聯絡後排入時段 → 家長用管理連結取消」（inquiry 流程）。主流程改寫為：

```ts
test('家長選場次送出即預約成功 → 從結果頁改場次、改資料 → 取消；確認信寄到', async ({ browser }) => {
  const parent = await openAs(browser, null)
  const api = await adminApi('super_admin')
  const { page } = parent
  await page.goto(`/visit/${SLOTS_CAMPUS}`)
  await page.getByLabel('預約日期').selectOption({ index: 1 })
  await page.locator('.visit-slot-options input[type="radio"]').first().check()
  await fillParentForm(page, { childName: '自選寶貝', parentName: '自選媽媽', phone: '0955000111' })
  await page.getByLabel('聯絡 Email').fill('self-book@example.com')
  await page.getByRole('button', { name: /送出/ }).click()

  await expect(page.locator('#booking-result')).toContainText('預約成功')
  const manage = page.getByRole('link', { name: '修改或取消預約' })
  await expect(manage).toHaveAttribute('href', /\/visit\/manage#token=/)
  await expect.poll(async () => (await readMail(m => m.to === 'self-book@example.com')).map(m => m.subject), { timeout: 90_000 })
    .toContainEqual(expect.stringContaining('參觀預約成功'))

  await manage.click()
  await expect(page.locator('.parent-visit-status')).toHaveText('預約成功')
  await page.getByRole('button', { name: '改場次' }).click()
  await page.getByLabel('新的場次').selectOption({ index: 1 })
  await page.getByRole('button', { name: '確認改到這個場次' }).click()
  await expect(page.getByRole('status')).toContainText('已改到')

  await page.getByRole('button', { name: '修改資料' }).click()
  await page.getByLabel('參觀人數').selectOption('3')
  await page.getByRole('button', { name: '儲存修改' }).click()
  await expect(page.getByRole('status')).toContainText('資料已更新')

  await page.getByRole('button', { name: '取消預約' }).click()
  await page.getByRole('button', { name: '確認取消預約' }).click()
  await expect(page.locator('.parent-visit-status')).toHaveText('預約已取消')
  await expect.poll(async () => (await readMail(m => m.to === 'self-book@example.com')).map(m => m.subject), { timeout: 90_000 })
    .toEqual(expect.arrayContaining([expect.stringContaining('參觀預約已變更'), expect.stringContaining('參觀預約已取消')]))

  const visit = await findVisit(api, '自選媽媽')
  expect(visit.status).toBe('cancelled')
  await Promise.all([parent.context.close(), api.dispose()])
})
```
「改期送出時剛好過了異動截止…」那個 test：改打新流程（家長開「改場次」→ 用 API 把 `parent_change_deadline_hours` 調大 → 按確認 → 看到「已無法線上異動」且操作列消失、「重新載入預約」仍在）。

- [ ] **Step 3：schedule-flow.spec.ts**

整個 test 改寫：

```ts
test('參觀場次：套用常用場次並開放 → 官網看得到 → 停止一場 → 官網少一場 → 整天休假', async ({ page }) => {
  await page.goto('/admin/visit-calendar?campus=chongde')
  await page.getByRole('button', { name: '套用常用場次' }).click()
  await page.getByRole('button', { name: '儲存並開放線上預約' }).click()
  await answerMessageBox(page, '儲存並開放線上預約？', '儲存並開放')
  await expect(page.getByText('上午場 10:00・每場 1 組・週一–週五')).toBeVisible()

  const site = await page.context().newPage()
  await site.goto('/visit/chongde')
  await site.getByLabel('預約日期').selectOption({ index: 1 })
  const before = await site.locator('.visit-slot-options input[type="radio"]').count()
  expect(before).toBe(2)

  const day = await site.getByLabel('預約日期').inputValue()
  await page.locator(`.calendar__day[aria-label^="${day.replaceAll('-', '/')}"]`).click()
  await page.locator('.calendar__slot').filter({ hasText: '上午場 10:00' }).getByRole('button', { name: '停止申請' }).click()
  await expect(page.locator('.calendar__slot').filter({ hasText: '上午場 10:00' })).toContainText('已停止申請')

  await site.reload()
  await site.getByLabel('預約日期').selectOption(day)
  await expect(site.locator('.visit-slot-options input[type="radio"]')).toHaveCount(1)

  await page.getByRole('button', { name: '整天休假' }).click()
  await page.getByRole('dialog').getByRole('textbox').fill('教師研習')
  await page.getByRole('button', { name: '設為休假' }).click()
  await expect(page.locator('#day-panel-title')).toContainText('休假：教師研習')
  await site.close()
})
```
（`answerMessageBox` 在 `tests/stack/pages.ts`，先讀它的簽章；崇德需在 setup 中已發布同意文字——`global.setup.ts` 既有流程已發布全站同意文字，確認後再跑。日期格的 `aria-label` 開頭格式以後台 `formatDate` 為準。）

- [ ] **Step 4：路由表**

`a11y.spec.ts`、`keyboard.spec.ts` 的路由清單刪 `['/slots', '時段與容量']`，`['/visit-calendar', '接待月曆']` 改 `['/visit-calendar', '參觀場次']`。

- [ ] **Step 5：跑 stack e2e**

```bash
cd /private/tmp/ivy-website-self-booking-20260930
E2E_DB_NAME=ivy_website_e2e_selfbook E2E_API_PORT=8711 E2E_WEB_PORT=3711 npm run e2e:build
E2E_DB_NAME=ivy_website_e2e_selfbook E2E_API_PORT=8711 E2E_WEB_PORT=3711 npm run test:e2e:stack
```
Expected: 全部 PASS。`media.spec.ts` 若失敗，單獨重跑一次（`npx playwright test -c playwright.stack.config.ts tests/stack/media.spec.ts`）；單獨跑過就在回報註明「main 既有偶發」，不修。視覺快照（`visual.spec.ts`）若因後台頁面改版差異失敗，確認差異是本案預期的畫面後，用 `--update-snapshots` 只更新相關快照並在回報列出。

- [ ] **Step 6：Commit（需授權）**

```bash
git add tests/stack/
git commit -m "test(e2e): 家長自選場次與參觀場次頁的端到端流程

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task D2：文件

**Files:**
- Modify: `DESIGN.md`、`docs/specs/2026-09-19-website-admin.md`、`docs/handoff/2026-09-19-claude-website-admin.md`、`CLAUDE.md`、`README.md`、`deploy/README.md`、`docs/website-admin/acceptance.md`（若有對應驗收項）

- [ ] **Step 1：DESIGN.md**

新增章節「家長自選場次預約（2026-09-30 業主裁定）」：
- 只有自選場次、送出即預約成功；Email 必填；結果頁有修改連結與寄信說明；家長可直接改場次、改資料、取消，受截止限制。
- 後台狀態：預約正常／時間已過／已取消（寫出家長取消／園方取消／逾期未確認與時間）；待處理只剩舊資料。
- 參觀場次頁：固定場次以「場次」為單位、存檔即補場次、套用常用場次（上午場 10:00、下午場 14:30，週一到週五，每場 1 組）、儲存並開放線上預約；月曆色塊與當天清單的操作；「停止申請」只停新預約。
- 場次名稱規則（12:00 以前上午場）。
在 2026-09-28 章節的相關條目（「新需求／聯絡中叫取消這筆需求」「關閉時段三選一」「時段頁每週規則收成一行摘要」）後面加註「2026-09-30 起由『家長自選場次預約』取代，只剩舊資料適用」。

- [ ] **Step 2：規格、handoff、CLAUDE.md**

- `docs/specs/2026-09-19-website-admin.md`：§5、§6.1、§6.2、§6.4 標題下各加一行「2026-09-30 起以 `2026-09-30-parent-self-booking-design.md` 為準」。全域限制「不發真實家長通知」後加「（2026-09-30 業主裁定：預約確認信會寄給家長，見新規格）」。
- `docs/handoff/2026-09-19-claude-website-admin.md`「預約不可違反的規則」第 1 條改為：「官網只有自選場次，送出即稱『預約成功』；舊資料的『已收到需求』『待確認』只在後台顯示為待處理。」
- `docs/specs/2026-09-30-parent-self-booking-design.md` §4.8：依階段 C 開頭「本階段對規格的調整」回寫（當天清單在月曆下方、一次看一個校區）。
- `CLAUDE.md`「官網後台任務」的預約語意那一行改成同上新語意，並加「家長確認信與修改連結規則見 `docs/specs/2026-09-30-parent-self-booking-design.md`」。

- [ ] **Step 3：README 與部署說明草稿**

- `README.md` 頂部加 2026-09-30 段落：做了什麼、驗證了什麼、未驗證什麼（Safari／iOS 實機、真實 SMTP 投遞）。
- `deploy/README.md` 加「家長自選場次（未部署，草稿）」一節，列規格 §7 的上線前人工步驟（SMTP 變數、各校設定場次、同意文字、備份、migration 會切換模式、`WEBSITE_SESSION_SECRET` 更換的影響），以及上線後唯讀檢查指令（對五校 `GET /public/booking-config/{key}` 看 `mode` 與 `parent_email_enabled`）。**不寫「已部署」**。

- [ ] **Step 4：Commit（需授權）**

```bash
git add DESIGN.md docs/specs/2026-09-19-website-admin.md docs/handoff/2026-09-19-claude-website-admin.md CLAUDE.md README.md deploy/README.md docs/website-admin/acceptance.md
git commit -m "docs: 記錄 2026-09-30 家長自選場次預約的裁定與上線步驟

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task D3：整體驗證與交審

- [ ] **Step 1：全部閘門重跑一次（依序，不要同時）**

```bash
cd /private/tmp/ivy-website-self-booking-20260930
(cd backend && uv run pytest -q)
npm run contract:check
npm --prefix web run typecheck && npm run test:website
(cd admin && npm run typecheck && npx vitest run)
```
每個指令的最後幾行輸出貼進回報。

- [ ] **Step 2：畫面驗證**

Playwright（`channel:'chrome'`）在 stack 環境截 1440×900、390×844：官網預約表單（Email 必填提示）、結果頁、管理頁（三個操作與修改資料表單、截止後狀態）、後台列表四分頁與取消原因、參觀場次頁（空白、編輯、月曆、當天清單）。存 `output/playwright/self-booking-20260930/final/`。檢查：手機無橫向捲動、按鈕可點區 ≥ 36px、顏色走 token、沒有 AI 感的斜體英文眉標。

- [ ] **Step 3：交審**

用 superpowers:requesting-code-review 對整條分支（`git diff origin/main...HEAD`）請 reviewer 看，重點：修改連結的 token 不外洩、最後名額並發、家長端權限（session 綁單一案件、截止）、outbox 交易、migration 可逆與大寫 enum、前端舊狀態仍能顯示。

- [ ] **Step 4：回報**

列出：完成的 task、實際跑過的指令與結果、截圖路徑、未驗證項、上線前使用者要做的事（規格 §7）。**不 push、不部署**；是否開 PR、何時上線由使用者決定。

## 階段 A 帶過來的事項（2026-10-01，D2 部署文件要寫）

- 上線前用 SQL 唯讀查兩件事：(1) 哪些 inquiry 校已有每週規則或未來場次（預先確認 migration 會把五校各切成 slots 或 paused）；(2) 未來、`closed_source IS NULL` 的已關閉場次上有沒有 confirmed 案件（這些不再列入待人工處理）。
- 部署空窗期：舊官網表單送出會先收到 422（缺 `slot_id`／`email`），或因 booking_configs `version` 遞增收到 `BOOKING_CONFIG_CHANGED`；web 與 api 必須同一次上線。
- 更換 `WEBSITE_SESSION_SECRET`：已發出的修改連結仍可用到到期，但系統無法再重算（重送、寄信拿不到連結），園方可按「重新產生連結並寄出」。
- 家長端每案每日上限：改期 5 次、改資料 10 次。
- 待使用者決定（Ruling 9）：每筆官網預約同時通知園方「新的參觀需求」與「參觀預約已確認」兩則（LINE 群組一筆兩則推播），要不要合併成一則。
- origin/main 已前進（審查時為 392a41c，動到 `contracts/openapi.json` 與 `operations/routes.py`）：合併前 rebase 並重跑 `npm run contract:generate`、後端全套。
