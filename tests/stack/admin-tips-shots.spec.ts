import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { expect, request, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { currentTerm } from '../../admin/src/admissions/academic'
import { adminApi, taipeiDate, type AdminApi, type SlotOut } from './api'
import { DB_NAME, ROOT, SLOTS_CAMPUS, WEB_ORIGIN, storageStatePath, type StackRole } from './stack-env'

// 後台「使用小技巧」頁的截圖（2026-11-10）：用拋棄式 e2e 測試庫建一批假家長、假案件、假消息，
// 照 admin/src/tips/tips.ts 每條的 image 拍一張，框出要點的地方。平常的 stack 測試不跑：
//
//   npm run e2e:build
//   ADMIN_TIPS_SHOTS=1 npx playwright test -c playwright.stack.config.ts admin-tips-shots
//   python3 scripts/build-admin-tips-images.py      # output/admin-tips/*.png → admin/src/assets/tips/*.webp
//
// 2 倍像素拍，頁面上以一半大小顯示。家長姓名、電話都是虛構的；不連正式站。
// 「今天的參觀」要用現在的台北時間排場次，在台北 22 點以後或 1 點以前跑，時間會跨日、拍不到。

test.skip(!process.env.ADMIN_TIPS_SHOTS, '重拍「使用小技巧」截圖才跑：ADMIN_TIPS_SHOTS=1')
test.describe.configure({ mode: 'default' })

const OUT = path.join(ROOT, 'output/admin-tips')
const API = '/api/website/v1'
const CAMPUS = SLOTS_CAMPUS
const TERM = currentTerm(taipeiDate(0))

// 和 global.setup 同一批帳號；顯示名稱換成看得懂的稱呼，截圖裡不會是 email。
const DISPLAY_NAMES: Record<StackRole, string> = {
  super_admin: '林主任',
  campus_admin: '王園長',
  reception: '陳老師',
  editor: '張老師',
}

interface Family { parent: string; phone: string; child: string; birthdate: string }
const F = {
  today: { parent: '林雅婷', phone: '0912000101', child: '林小安', birthdate: '2022-03-14' },
  later: { parent: '張志豪', phone: '0912000102', child: '張小宇', birthdate: '2022-07-02' },
  pastA: { parent: '黃美玲', phone: '0912000103', child: '黃小米', birthdate: '2021-11-20' },
  pastB: { parent: '吳佳蓉', phone: '0912000104', child: '吳小晴', birthdate: '2022-01-08' },
  pastC: { parent: '鄭雅文', phone: '0912000105', child: '鄭小樂', birthdate: '2022-09-30' },
  main: { parent: '陳怡君', phone: '0912000106', child: '陳小妤', birthdate: '2022-04-18' },
  next: { parent: '蔡宛臻', phone: '0912000110', child: '蔡小禾', birthdate: '2022-06-21' },
  visited: { parent: '李宗翰', phone: '0912000107', child: '李小澄', birthdate: '2021-12-05' },
  deposited: { parent: '周佩君', phone: '0912000108', child: '周小恩', birthdate: '2022-02-11' },
  enrolled: { parent: '許文傑', phone: '0912000109', child: '許小諾', birthdate: '2021-10-27' },
} satisfies Record<string, Family>

const NEWS_IMAGE = 'garden'

function psql(sql: string, vars: Record<string, string> = {}): string {
  const args = ['-d', DB_NAME, '-v', 'ON_ERROR_STOP=1', '-q', '-At']
  for (const [name, value] of Object.entries(vars)) args.push('-v', `${name}=${value}`)
  return execFileSync('psql', args, { input: sql, encoding: 'utf8' }).trim()
}

/**
 * 把這筆預約獨占的場次移到台北今天或昨天。today 的開始時間是「現在」取整到 15 分鐘再加 offsetMinutes
 * （進行中用 0、稍晚用 120）；yesterday 用固定的整點時間。
 */
function moveSlot(visitId: string, when: { today: number } | { yesterday: string }): void {
  const sql = 'today' in when
    ? `WITH t AS (SELECT date_trunc('hour', now() AT TIME ZONE 'Asia/Taipei')
                       + floor(date_part('minute', now() AT TIME ZONE 'Asia/Taipei') / 15) * interval '15 min'
                       + make_interval(mins => :'offset'::int) AS start_at)
       UPDATE visit_slots AS s
          SET slot_date = t.start_at::date, start_time = t.start_at::time, end_time = (t.start_at + interval '1 hour')::time
         FROM visit_requests AS r, t
        WHERE r.id = :'visit_id'::uuid AND s.id = r.slot_id
    RETURNING s.id;`
    : `UPDATE visit_slots AS s
          SET slot_date = (now() AT TIME ZONE 'Asia/Taipei')::date - 1,
              start_time = :'start'::time, end_time = :'start'::time + interval '1 hour'
         FROM visit_requests AS r
        WHERE r.id = :'visit_id'::uuid AND s.id = r.slot_id
    RETURNING s.id;`
  const vars = 'today' in when ? { visit_id: visitId, offset: String(when.today) } : { visit_id: visitId, start: when.yesterday }
  if (!psql(sql, vars)) throw new Error(`場次沒有移動：${visitId}`)
}

let ipSeq = 10
async function book(api: AdminApi, family: Family, dayOffset: number, start: string): Promise<string> {
  const existing = await api.get<{ id: string }[]>(`/admin/visit-requests?q=${encodeURIComponent(family.parent)}`)
  if (existing[0]) return existing[0].id
  const end = `${String(Number(start.slice(0, 2)) + 1).padStart(2, '0')}${start.slice(2)}`
  const slot = await api.send<SlotOut>('POST', `/admin/slots?campus_key=${CAMPUS}`, {
    slot_date: taipeiDate(dayOffset), start_time: `${start}:00`, end_time: `${end}:00`, capacity: 2,
  })
  const parent = await request.newContext({
    baseURL: WEB_ORIGIN,
    storageState: { cookies: [], origins: [] },
    extraHTTPHeaders: { 'X-Forwarded-For': `203.0.113.${ipSeq++}` },
  })
  const config = await (await parent.get(`${API}/public/booking-config/${CAMPUS}`)).json()
  const created = await parent.post(`${API}/public/visit-requests`, {
    headers: { 'Idempotency-Key': `tips-${family.phone}` },
    data: {
      campus_key: CAMPUS, parent_name: family.parent, phone: family.phone, child_name: family.child,
      child_birthdate: family.birthdate, config_version: config.version, slot_id: slot.id,
      email: `tips-${family.phone}@example.com`,
    },
  })
  expect([200, 201], await created.text()).toContain(created.status())
  await parent.dispose()
  const found = await api.get<{ id: string }[]>(`/admin/visit-requests?q=${encodeURIComponent(family.parent)}`)
  return found[0]!.id
}

interface RecordOut { id: string; version: number; child_name: string; stage: string }
async function recordOf(api: AdminApi, child: string): Promise<RecordOut | undefined> {
  const rows = await api.get<RecordOut[]>(`/admin/admissions/records?campus_key=${CAMPUS}&q=${encodeURIComponent(child)}&page=1&page_size=5`)
  return rows[0]
}
async function transition(api: AdminApi, child: string, to: 'deposited' | 'enrolled'): Promise<void> {
  const record = (await recordOf(api, child))!
  if (record.stage === to || (to === 'deposited' && record.stage === 'enrolled')) return
  await api.send('POST', `/admin/admissions/records/${record.id}/transition`, {
    to_stage: to, expected_version: record.version, reason: null, deposit_collector: null, enrolled_on: null,
    grade: to === 'enrolled' ? '小班' : null, target_school_year: null, target_semester: null,
  })
}

interface ContentItem { latest_version: number; latest_revision: { id: string; payload: Record<string, unknown> } | null }
async function saveDraft(api: AdminApi, kind: string, campus: string | null, edit: (payload: Record<string, unknown>) => Record<string, unknown>): Promise<string> {
  const query = campus ? `?campus_key=${campus}` : ''
  const item = await api.get<ContentItem>(`/admin/content-items/${kind}${query}`)
  const saved = await api.send<ContentItem>('POST', `/admin/content-items/${kind}/revisions${query}`, {
    expected_version: item.latest_version,
    payload: edit(structuredClone(item.latest_revision?.payload ?? {})),
  })
  return saved.latest_revision!.id
}
async function publish(api: AdminApi, kind: string, campus: string | null, revisionId: string): Promise<void> {
  const query = campus ? `?campus_key=${campus}` : ''
  await api.send('POST', `/admin/content-items/${kind}/publish${query}`, { revision_id: revisionId })
}

const ids: Record<keyof typeof F, string> = {} as Record<keyof typeof F, string>

// 看板上「手動新增的訪視」（不是官網預約來的）：點卡片開右側歷程。
const MANUAL = [
  { child: '何小芸', birthday: '2022-08-16' },
  { child: '楊小翔', birthday: '2021-12-28' },
]
// 使用者列表截圖用的同事帳號（拋棄式測試庫才有）。
const COLLEAGUE = { email: 'mei.huang@example.com', name: '黃美惠', password: 'tips-colleague-password-1' }

async function seed(): Promise<void> {
  const api = await adminApi('super_admin')
  let users = await api.get<{ id: string; email: string; display_name: string | null }[]>('/admin/users')
  if (!users.some(u => u.email === COLLEAGUE.email)) {
    await api.send('POST', '/admin/users', { email: COLLEAGUE.email, password: COLLEAGUE.password, role: 'reception', campus_keys: [CAMPUS] })
    users = await api.get('/admin/users')
  }
  const names: Record<string, string> = {
    'e2e-super@ivy.example': DISPLAY_NAMES.super_admin,
    'e2e-yihua-admin@ivy.example': DISPLAY_NAMES.campus_admin,
    'e2e-yihua-reception@ivy.example': DISPLAY_NAMES.reception,
    'e2e-yihua-editor@ivy.example': DISPLAY_NAMES.editor,
    'e2e-reset-target@ivy.example': '劉老師',
    [COLLEAGUE.email]: COLLEAGUE.name,
  }
  for (const user of users) {
    const name = names[user.email]
    if (name && user.display_name !== name) await api.send('PATCH', `/admin/users/${user.id}/display-name`, { display_name: name })
  }

  ids.main = await book(api, F.main, 3, '10:00')
  ids.next = await book(api, F.next, 4, '14:00')
  ids.today = await book(api, F.today, 20, '09:00')
  ids.later = await book(api, F.later, 21, '09:00')
  ids.pastA = await book(api, F.pastA, 22, '09:00')
  ids.pastB = await book(api, F.pastB, 23, '09:00')
  ids.pastC = await book(api, F.pastC, 24, '09:00')
  ids.visited = await book(api, F.visited, 25, '09:00')
  ids.deposited = await book(api, F.deposited, 26, '09:00')
  ids.enrolled = await book(api, F.enrolled, 27, '09:00')

  if (psql(`SELECT count(*) FROM visit_requests WHERE status = 'completed'`) === '0') {
    moveSlot(ids.today, { today: 0 })
    moveSlot(ids.later, { today: 120 })
    moveSlot(ids.pastA, { yesterday: '09:30' })
    moveSlot(ids.pastB, { yesterday: '10:00' })
    moveSlot(ids.pastC, { yesterday: '14:30' })
    moveSlot(ids.visited, { yesterday: '09:30' })
    moveSlot(ids.deposited, { yesterday: '10:00' })
    moveSlot(ids.enrolled, { yesterday: '14:30' })
    for (const key of ['visited', 'deposited', 'enrolled'] as const) {
      await api.send('POST', `/admin/visit-requests/${ids[key]}/complete`)
    }
    await transition(api, F.deposited.child, 'deposited')
    await transition(api, F.enrolled.child, 'deposited')
    await transition(api, F.enrolled.child, 'enrolled')
  }
  for (const manual of MANUAL) {
    if (await recordOf(api, manual.child)) continue
    await api.send('POST', `/admin/admissions/records?campus_key=${CAMPUS}`, {
      visit_date: taipeiDate(-2), child_name: manual.child, birthday: manual.birthday,
      target_school_year: TERM.schoolYear, target_semester: TERM.semester,
    })
  }

  // 義華自己的消息：兩則、其中一則有上下架日期；存兩版並各發布一次，版本紀錄與發布紀錄才有東西可選。
  const news = await api.get<ContentItem>(`/admin/content-items/campus_news?campus_key=${CAMPUS}`)
  const articles = (news.latest_revision?.payload.articles as unknown[] | undefined) ?? []
  if (articles.length === 0) {
    const first = await saveDraft(api, 'campus_news', CAMPUS, payload => ({
      ...payload,
      articles: [
        { id: 'tips-garden', date: taipeiDate(-6), category: '校園日常', title: '小小園丁，把好奇心種進生活裡', description: '從翻土、澆水到觀察新芽，陪孩子發現一片葉子裡的大世界。', body: [], image: NEWS_IMAGE, alt: '孩子們在菜園裡澆水', show_from: null, show_until: null },
      ],
      events: [],
    }))
    await publish(api, 'campus_news', CAMPUS, first)
    const second = await saveDraft(api, 'campus_news', CAMPUS, payload => ({
      ...payload,
      articles: [
        { id: 'tips-open-day', date: taipeiDate(10), category: '活動預告', title: '冬季校園開放日，歡迎全家一起來', description: '十二月第一個週六上午，開放教室與遊戲場，老師現場說明作息與課程。', body: [], image: NEWS_IMAGE, alt: '校園開放日的遊戲場', show_from: taipeiDate(2), show_until: taipeiDate(30) },
        ...((payload.articles as unknown[]) ?? []),
      ],
    }))
    await publish(api, 'campus_news', CAMPUS, second)
  }
  await api.dispose()
}

// ── 截圖工具 ──

const MARK_STYLE = `
  .tips-mark { outline: 3px solid #f97316 !important; outline-offset: 3px !important; border-radius: 6px; }
  .el-message, .el-notification { display: none !important; }
  * { caret-color: transparent !important; }
`

async function ensureStyle(page: Page): Promise<void> {
  await page.evaluate((css) => {
    if (document.getElementById('tips-shot-style')) return
    const style = document.createElement('style')
    style.id = 'tips-shot-style'
    style.textContent = css
    document.head.append(style)
  }, MARK_STYLE)
}

async function mark(...targets: Locator[]): Promise<void> {
  for (const target of targets) await target.evaluate(el => el.classList.add('tips-mark'))
}

async function unmark(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelectorAll('.tips-mark').forEach(el => el.classList.remove('tips-mark')))
}

/** 拍 areas 的聯集（加 pad 留白），限制在視窗內。拍完拿掉標記。 */
async function shot(page: Page, name: string, areas: Locator[], options: { pad?: number; marks?: Locator[]; maxHeight?: number } = {}): Promise<void> {
  await ensureStyle(page)
  if (options.marks) await mark(...options.marks)
  await page.waitForTimeout(250)
  const boxes = (await Promise.all(areas.map(area => area.boundingBox()))).filter((box): box is NonNullable<typeof box> => box !== null)
  expect(boxes.length, `${name}：找不到要拍的範圍`).toBeGreaterThan(0)
  const pad = options.pad ?? 16
  const viewport = page.viewportSize()!
  const x = Math.max(0, Math.min(...boxes.map(b => b.x)) - pad)
  const y = Math.max(0, Math.min(...boxes.map(b => b.y)) - pad)
  const right = Math.min(viewport.width, Math.max(...boxes.map(b => b.x + b.width)) + pad)
  let bottom = Math.min(viewport.height, Math.max(...boxes.map(b => b.y + b.height)) + pad)
  if (options.maxHeight) bottom = Math.min(bottom, y + options.maxHeight)
  mkdirSync(OUT, { recursive: true })
  await page.screenshot({ path: path.join(OUT, `${name}.png`), clip: { x, y, width: right - x, height: bottom - y }, animations: 'disabled' })
  await unmark(page)
}

async function open(browser: Browser, role: StackRole, viewport = { width: 1440, height: 900 }): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    baseURL: WEB_ORIGIN, locale: 'zh-TW', timezoneId: 'Asia/Taipei', reducedMotion: 'reduce',
    viewport, deviceScaleFactor: 2, storageState: storageStatePath(role),
  })
  return { context, page: await context.newPage() }
}

async function goto(page: Page, pathname: string): Promise<void> {
  await page.goto(`/admin${pathname}`)
  await expect(page.locator('.sidebar')).toBeVisible()
  await page.waitForLoadState('networkidle')
  await ensureStyle(page)
}

// 開發用：ADMIN_TIPS_EXPLORE=1 只建資料並把各頁的無障礙樹寫到 output/admin-tips/aria/，寫選擇器時對照。
let seeded: Promise<void> | null = null
const ready = () => (seeded ??= seed())

test('建立假資料', async () => {
  test.setTimeout(180_000)
  await ready()
})

test('探索各頁結構', async ({ browser }) => {
  test.skip(!process.env.ADMIN_TIPS_EXPLORE, '只在寫截圖步驟時用')
  test.setTimeout(300_000)
  await ready()
  const dir = path.join(OUT, 'aria')
  mkdirSync(dir, { recursive: true })
  const { context, page } = await open(browser, 'super_admin')
  const pages: [string, string][] = [
    ['dashboard', '/'],
    ['visits', '/visit-requests'],
    ['visits-past', '/visit-requests?group=past&status=confirmed'],
    ['visit-main', `/visit-requests/${ids.main}`],
    ['visit-visited', `/visit-requests/${ids.visited}`],
    ['calendar', `/visit-calendar?campus=${CAMPUS}`],
    ['notifications', '/notifications'],
    ['admissions', `/admissions?campus=${CAMPUS}&tab=funnel&sy=${TERM.schoolYear}`],
    ['records', `/admissions?campus=${CAMPUS}&tab=records&sy=${TERM.schoolYear}`],
    ['campus-news', `/content/campus-news?campus=${CAMPUS}`],
    ['campus-profile', `/content/campus-profile?campus=${CAMPUS}`],
    ['curriculum', '/content/curriculum-page'],
    ['media', '/media'],
    ['releases', '/releases'],
    ['users', '/users'],
  ]
  for (const [name, url] of pages) {
    await goto(page, url)
    await page.waitForTimeout(800)
    writeFileSync(path.join(dir, `${name}.yml`), await page.locator('body').ariaSnapshot())
    await page.screenshot({ path: path.join(dir, `${name}.png`), fullPage: false })
  }
  await context.close()
})

// ── 每條小技巧一張（檔名＝tips.ts 的 image） ──

async function shoot(browser: Browser, role: StackRole, body: (page: Page) => Promise<void>, viewport?: { width: number; height: number }): Promise<void> {
  test.setTimeout(120_000)
  await ready()
  const { context, page } = await open(browser, role, viewport)
  try {
    await body(page)
  } finally {
    await context.close()
  }
}

const main = (page: Page) => page.locator('main')
// 案件明細右欄很長：場次卡、排除連結要整張拍進來。
const TALL = { width: 1440, height: 1500 }

test('找功能：側欄搜尋', async ({ browser }) => {
  await shoot(browser, 'super_admin', async (page) => {
    await goto(page, '/')
    await page.keyboard.press('Meta+K')
    await page.keyboard.type('預約')
    await expect(page.locator('.sidebar__link.is-first')).toBeVisible()
    await shot(page, 'search', [page.locator('.sidebar__search'), page.locator('.sidebar__nav .sidebar__group').first()], {
      marks: [page.locator('.sidebar__search .el-input__wrapper')], pad: 0,
    })
  })
})

test('找功能：側欄收窄', async ({ browser }) => {
  await shoot(browser, 'super_admin', async (page) => {
    await goto(page, '/')
    await page.getByRole('button', { name: '收合側邊欄' }).click()
    await page.locator('.sidebar').getByRole('link', { name: '參觀案件' }).hover()
    const tip = page.locator('.el-popper', { hasText: '參觀案件' }).filter({ visible: true })
    await expect(tip).toBeVisible()
    // 只看側欄：右邊的頁面內容藏起來，截圖裡才不會有切一半的標題。
    await page.addStyleTag({ content: 'main, header.top { visibility: hidden !important; }' })
    await shot(page, 'sidebar-rail', [page.locator('.sidebar__brand'), tip], {
      marks: [page.getByRole('button', { name: '展開側邊欄' })], pad: 12,
    })
  })
})

test('帳號：側欄最下面的名字', async ({ browser }) => {
  await shoot(browser, 'campus_admin', async (page) => {
    await goto(page, '/')
    await shot(page, 'account-entry', [page.locator('.sidebar__user')], { marks: [page.locator('.sidebar__account')], pad: 0 })
  })
})

test('帳號：使用者的更多動作', async ({ browser }) => {
  await shoot(browser, 'super_admin', async (page) => {
    await goto(page, '/users')
    const row = page.getByRole('row', { name: new RegExp(COLLEAGUE.name) })
    const more = row.getByRole('button', { name: /的更多動作$/ })
    await more.click()
    const menu = page.locator('.el-dropdown-menu').filter({ visible: true })
    await expect(menu).toBeVisible()
    await shot(page, 'users-more', [row, menu], {
      marks: [row.getByRole('button', { name: '重設密碼' }), more],
    })
  })
})

test('參觀案件：寬螢幕預覽', async ({ browser }) => {
  await shoot(browser, 'campus_admin', async (page) => {
    await goto(page, '/visit-requests')
    await page.getByRole('link', { name: new RegExp(F.main.parent) }).click()
    const preview = page.getByRole('complementary', { name: '案件預覽' })
    await expect(preview).toContainText(F.main.child)
    await shot(page, 'visit-preview', [page.locator('.visit-split')], { marks: [preview], maxHeight: 640 })
  })
})

test('參觀案件：更多篩選與條件標籤', async ({ browser }) => {
  await shoot(browser, 'campus_admin', async (page) => {
    await goto(page, '/visit-requests?group=all&order=newest&excluded=hide&open=1')
    const more = page.getByRole('button', { name: '更多篩選' })
    await expect(more).toBeVisible()
    const chips = page.locator('.filter-chips')
    await expect(chips).toBeVisible()
    await shot(page, 'visit-filters', [page.getByRole('group', { name: '案件狀態' }), more, chips], { marks: [more, chips], maxHeight: 260 })
  })
})

test('參觀案件：一次標記好幾組', async ({ browser }) => {
  await shoot(browser, 'campus_admin', async (page) => {
    await goto(page, '/visit-requests?group=past&status=confirmed')
    for (const family of [F.pastA, F.pastB]) {
      await page.locator('.visit-row', { hasText: family.parent }).locator('.visit-row__check .el-checkbox').click()
    }
    const bar = page.locator('.requests-batch')
    await expect(bar).toContainText('2 位標記已到場')
    await shot(page, 'visit-batch', [bar, page.locator('.visit-list')], {
      marks: [bar.locator('.requests-batch__button').first(), bar.locator('.requests-batch__button').nth(1)], maxHeight: 420,
    })
  })
})

test('參觀案件：總覽直接按到了', async ({ browser }) => {
  await shoot(browser, 'campus_admin', async (page) => {
    await goto(page, '/')
    const group = page.getByRole('group', { name: `${F.today.parent} 到了嗎？` })
    await expect(group).toBeVisible()
    const card = page.locator('section, .panel').filter({ has: group }).last()
    await shot(page, 'dashboard-today', [page.getByRole('heading', { name: /今天的參觀/ }), card], { marks: [group] })
  })
})

test('參觀案件：家長提早到了、下一筆', async ({ browser }) => {
  await shoot(browser, 'campus_admin', async (page) => {
    await goto(page, `/visit-requests/${ids.main}?list=view=upcoming%26order=visit_asc`)
    const early = page.getByRole('button', { name: '家長提早到了' })
    await expect(early).toBeVisible()
    const heading = page.getByRole('heading', { level: 2, name: new RegExp(F.main.parent) })
    const hint = page.getByText('場次開始後才能標記未到場')
    await shot(page, 'visit-early', [heading, early, hint], { marks: [early], pad: 20 })
    const next = page.getByRole('button', { name: /^下一筆/ })
    const sent = page.locator('main p').filter({ hasText: '官網送出' }).first()
    await shot(page, 'visit-next', [page.getByRole('button', { name: '參觀案件' }).first(), next, heading, sent], { marks: [next] })
  }, TALL)
})

test('參觀案件：聯絡紀錄', async ({ browser }) => {
  await shoot(browser, 'reception', async (page) => {
    await goto(page, `/visit-requests/${ids.main}`)
    const region = page.getByRole('region', { name: '聯絡紀錄與案件歷程' })
    await region.getByRole('textbox', { name: '新增聯絡紀錄' }).fill('已致電，家長希望改週六上午，')
    const phrases = region.getByRole('group', { name: '常用片語' })
    await shot(page, 'visit-notes', [region], { marks: [phrases, region.getByText(/Enter 也能送出/)], maxHeight: 330 })
  })
})

test('參觀案件：場次卡與排除', async ({ browser }) => {
  await shoot(browser, 'campus_admin', async (page) => {
    await goto(page, `/visit-requests/${ids.main}`)
    const heading = page.getByRole('heading', { name: '場次、家長管理連結與取消' })
    const cancel = page.getByRole('button', { name: '取消預約' })
    const move = page.getByRole('button', { name: '改到其他場次…' })
    await heading.scrollIntoViewIfNeeded()
    await shot(page, 'visit-slot-card', [heading, cancel], { marks: [move, cancel], pad: 20 })
    const exclude = page.getByRole('button', { name: '標記為排除（測試或重複）…' })
    await exclude.scrollIntoViewIfNeeded()
    await shot(page, 'visit-exclude', [cancel, exclude], { marks: [exclude], pad: 24 })
  }, TALL)
})

test('參觀案件：站內通知', async ({ browser }) => {
  await shoot(browser, 'campus_admin', async (page) => {
    await goto(page, '/notifications')
    const region = page.getByRole('region', { name: '通知清單' })
    const first = region.getByRole('listitem').first()
    await expect(first).toBeVisible()
    await shot(page, 'notifications', [region], { marks: [first.getByRole('link')], maxHeight: 380 })
  })
})

test('參觀案件：匯出 CSV', async ({ browser }) => {
  await shoot(browser, 'super_admin', async (page) => {
    await goto(page, '/visit-requests')
    const button = page.getByRole('button', { name: '匯出 CSV' })
    await shot(page, 'visit-export', [main(page).locator('.page-header'), page.getByText(/^匯出範圍/)], { marks: [button] })
  })
})

test('參觀場次：點日期', async ({ browser }) => {
  await shoot(browser, 'campus_admin', async (page) => {
    await goto(page, `/visit-calendar?campus=${CAMPUS}`)
    const day = taipeiDate(3).replaceAll('-', '/')
    await page.getByRole('gridcell', { name: new RegExp(`^${day}`) }).click()
    const panel = page.locator('.day-panel')
    await expect(panel).toBeVisible()
    await panel.scrollIntoViewIfNeeded()
    await shot(page, 'calendar-day', [panel], {
      marks: [panel.getByRole('button', { name: '整天休假' }), panel.locator('.day-panel__actions').first(), panel.getByRole('button', { name: /加開一場/ })],
      maxHeight: 420,
    })
  })
})

test('參觀場次：停班停課與國定假日', async ({ browser }) => {
  await shoot(browser, 'campus_admin', async (page) => {
    await goto(page, `/visit-calendar?campus=${CAMPUS}`)
    const closure = page.getByRole('button', { name: '停班停課' })
    const holiday = page.getByRole('button', { name: '匯入國定假日' })
    await shot(page, 'calendar-tools', [page.getByRole('button', { name: '上個月' }), closure, holiday, page.getByRole('region', { name: '每週固定場次' })], {
      marks: [closure, holiday], maxHeight: 300,
    })
  })
})

test('參觀場次：場次使用情況', async ({ browser }) => {
  await shoot(browser, 'campus_admin', async (page) => {
    await goto(page, `/visit-calendar?campus=${CAMPUS}`)
    const tab = page.getByRole('tab', { name: '場次使用情況' })
    await tab.click()
    await page.waitForLoadState('networkidle')
    await shot(page, 'slot-usage', [page.getByRole('tablist'), page.getByRole('tabpanel', { name: '場次使用情況' })], { marks: [tab], maxHeight: 360 })
  })
})

test('招生：看板移到…', async ({ browser }) => {
  await shoot(browser, 'campus_admin', async (page) => {
    await goto(page, `/admissions?campus=${CAMPUS}&tab=funnel&sy=${TERM.schoolYear}`)
    const card = page.locator('article', { hasText: F.visited.child })
    await card.hover()
    const move = card.getByRole('button', { name: `把 ${F.visited.child} 移到其他階段` })
    await expect(move).toBeVisible()
    await shot(page, 'funnel-move', [page.getByRole('region', { name: /^已訪視/ }), page.getByRole('region', { name: /^已註冊/ })], { marks: [move], maxHeight: 340 })
  })
})

test('招生：歷程抽屜', async ({ browser }) => {
  await shoot(browser, 'campus_admin', async (page) => {
    await goto(page, `/admissions?campus=${CAMPUS}&tab=funnel&sy=${TERM.schoolYear}`)
    await page.getByRole('button', { name: new RegExp(`^${MANUAL[0]!.child}（已訪視），開啟歷程`) }).click()
    const drawer = page.getByRole('dialog', { name: '參觀→入學 歷程' })
    await expect(drawer).toBeVisible()
    await page.waitForTimeout(400)
    await shot(page, 'journey', [drawer], { marks: [drawer.getByRole('button', { name: '記錄聯絡' }), drawer.getByRole('button', { name: '排下次聯絡' })], pad: 0, maxHeight: 380 })
  })
})

test('招生：訪視明細更多', async ({ browser }) => {
  await shoot(browser, 'campus_admin', async (page) => {
    await goto(page, `/admissions?campus=${CAMPUS}&tab=records&sy=${TERM.schoolYear}`)
    const row = page.getByRole('row', { name: new RegExp(F.deposited.child) })
    const more = row.getByRole('button', { name: `${F.deposited.child} 的更多動作` })
    await more.click()
    const menu = page.locator('.el-dropdown-menu').filter({ visible: true })
    await expect(menu).toBeVisible()
    await shot(page, 'records-more', [row, menu], { marks: [row.getByRole('button', { name: '展開其他資料' }), more] })
  })
})

test('官網內容：三欄與即時預覽', async ({ browser }) => {
  await shoot(browser, 'campus_admin', async (page) => {
    await goto(page, `/content/campus-news?campus=${CAMPUS}`)
    const preview = page.getByRole('complementary', { name: '官網預覽' })
    await expect(preview.locator('iframe')).toBeVisible()
    await page.waitForTimeout(2500)
    await shot(page, 'live-preview', [main(page)], {
      marks: [page.getByRole('navigation', { name: '這一頁的段落' }), preview], pad: 0, maxHeight: 900,
    })
  })
})

test('官網內容：上下架日期', async ({ browser }) => {
  await shoot(browser, 'campus_admin', async (page) => {
    await goto(page, `/content/campus-news?campus=${CAMPUS}`)
    await page.getByRole('button', { name: /冬季校園開放日，歡迎全家一起來 .*起顯示/ }).click()
    const from = page.locator('.el-form-item', { hasText: '上架日期' }).first()
    const until = page.locator('.el-form-item', { hasText: '下架日期' }).first()
    await from.scrollIntoViewIfNeeded()
    await shot(page, 'news-dates', [from, until], { marks: [from, until], pad: 24 })
  })
})

test('官網內容：版本紀錄', async ({ browser }) => {
  await shoot(browser, 'campus_admin', async (page) => {
    await goto(page, `/content/campus-news?campus=${CAMPUS}`)
    await page.getByRole('button', { name: '版本紀錄' }).click()
    const drawer = page.getByRole('dialog', { name: '版本紀錄' })
    await drawer.locator('.history__item').nth(1).click()
    const draft = drawer.getByRole('button', { name: '還原成草稿' })
    await expect(draft).toBeVisible()
    await page.waitForTimeout(400)
    await shot(page, 'history', [drawer], { marks: [draft, drawer.getByRole('button', { name: '還原並發布' })], pad: 0, maxHeight: 540 })
  })
})

test('官網內容：家長影片改成自訂、裁切焦點、選照片時上傳', async ({ browser }) => {
  await shoot(browser, 'campus_admin', async (page) => {
    await goto(page, `/content/campus-profile?campus=${CAMPUS}`)
    const custom = page.getByRole('button', { name: /^改成自訂/ })
    await custom.scrollIntoViewIfNeeded()
    await shot(page, 'custom', [page.getByRole('heading', { name: '家長分享影片' }), custom], { marks: [custom], pad: 20 })

    const focus = page.getByRole('group', { name: '首頁五校卡片、預約頁的裁切焦點' })
    await focus.scrollIntoViewIfNeeded()
    await shot(page, 'focus', [focus], { marks: [focus.getByRole('group', { name: /裁切焦點：點照片或用方向鍵移動/ })] })

    await page.getByRole('group', { name: '封面照片' }).getByRole('button', { name: '從素材庫選照片' }).click()
    const picker = page.locator('.el-dialog', { hasText: '選擇照片' })
    const upload = picker.getByRole('button', { name: '上傳新照片' })
    await expect(upload).toBeVisible()
    await page.waitForTimeout(400)
    await shot(page, 'picker-upload', [picker], { marks: [upload], maxHeight: 420, pad: 0 })
  })
})

test('官網內容：標題按 Enter 換行', async ({ browser }) => {
  await shoot(browser, 'super_admin', async (page) => {
    await goto(page, '/content/curriculum-page')
    const field = page.locator('.el-form-item', { has: page.getByRole('textbox', { name: '首屏大標' }) })
    await shot(page, 'title-break', [field], { marks: [page.getByRole('textbox', { name: '首屏大標' })], pad: 20 })
  })
})

test('官網內容：素材的更多', async ({ browser }) => {
  await shoot(browser, 'campus_admin', async (page) => {
    await goto(page, '/media')
    const name = 'yihua-garden.webp'
    if (await page.locator('.media__name', { hasText: name }).count() === 0) {
      await page.getByRole('button', { name: '上傳素材' }).first().click()
      const dialog = page.getByRole('dialog', { name: '上傳素材' })
      await dialog.locator('input[type="file"]').setInputFiles([
        { name, mimeType: 'image/webp', buffer: readFileSync(path.join(ROOT, 'web/public/assets/about-curious.webp')) },
        { name: 'yihua-together.webp', mimeType: 'image/webp', buffer: readFileSync(path.join(ROOT, 'web/public/assets/about-together.webp')) },
      ])
      await dialog.getByRole('button', { name: /^上傳 2 個檔案/ }).click()
      await expect(dialog).toBeHidden({ timeout: 30_000 })
    }
    const card = page.locator('article', { hasText: name })
    const more = card.getByRole('button', { name: `「${name}」的更多動作` })
    await more.click()
    const menu = page.locator('.media-more-menu').filter({ visible: true })
    await expect(menu).toBeVisible()
    await shot(page, 'media-more', [card, menu], { marks: [more] })
  })
})

test('官網內容：整站還原', async ({ browser }) => {
  await shoot(browser, 'super_admin', async (page) => {
    await goto(page, '/releases')
    const list = page.getByRole('list', { name: '發布紀錄' })
    const second = list.locator(':scope > li').nth(1)
    await shot(page, 'release-restore', [list.locator(':scope > li').first(), second], { marks: [second.getByRole('button', { name: '整站還原到這次' })] })
  })
})

test('官網內容：排程發布', async ({ browser }) => {
  await ready()
  const api = await adminApi('super_admin')
  const schedules = await api.get<unknown[]>('/admin/content-items/site_footer/schedules')
  if (schedules.length === 0) {
    const revision = await saveDraft(api, 'site_footer', null, payload => ({ ...payload, tagline: '陪伴每一個孩子，長成自己喜歡的樣子' }))
    const tomorrow = new Date(`${taipeiDate(1)}T08:00:00+08:00`).toISOString()
    await api.send('POST', '/admin/content-items/site_footer/schedules', { revision_id: revision, publish_at: tomorrow })
  }
  await api.dispose()
  await shoot(browser, 'super_admin', async (page) => {
    await goto(page, '/content/site-footer')
    const cancel = page.getByRole('button', { name: '取消排程' })
    await expect(cancel).toBeVisible()
    const banner = page.locator('.editor__schedules')
    await shot(page, 'schedule', [banner], { marks: [cancel] })
  })
})

test('官網內容：送審與核准（最後跑，會讓義華消息停在待審）', async ({ browser }) => {
  await ready()
  const editor = await adminApi('editor')
  const item = await editor.get<ContentItem & { latest_revision: { review_status?: string } }>(`/admin/content-items/campus_news?campus_key=${CAMPUS}`)
  if (item.latest_revision?.review_status !== 'pending') {
    const revision = await saveDraft(editor, 'campus_news', CAMPUS, payload => ({
      ...payload,
      events: [{ id: 'tips-fair', date: taipeiDate(18), title: '親子二手書交換日', description: '帶兩本看完的繪本來，換兩本新的回家。', all_day: true, start_time: null, end_time: null, location: '義華校一樓大廳', link_url: '', link_label: '', show_from: null, show_until: null }],
    }))
    await editor.send('POST', `/admin/content-items/campus_news/submit?campus_key=${CAMPUS}`, { revision_id: revision })
  }
  await editor.dispose()
  await shoot(browser, 'campus_admin', async (page) => {
    await goto(page, `/content/campus-news?campus=${CAMPUS}`)
    const approve = page.getByRole('button', { name: /核准並發布/ })
    const reject = page.getByRole('button', { name: /^退回/ })
    await expect(approve).toBeVisible()
    const bar = page.locator('.editor__actions')
    await shot(page, 'review', [bar], { marks: [reject, approve], pad: 12 })
  })
})
