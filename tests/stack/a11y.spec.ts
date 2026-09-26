import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { AXE_EXEMPTIONS } from './a11y-exemptions'
import { adminApi, findVisit, submitPublicRequest } from './api'
import { skipEntrance } from './pages'
import { SLOTS_CAMPUS, storageStatePath } from './stack-env'

// 無障礙自動檢查（規格 §9.4、計畫 L402）：axe 的 WCAG 2.1 A／AA 規則，serious 與 critical
// 一律擋下；已知且暫不修的節點列在 a11y-exemptions.ts 並附原因。

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

interface Finding {
  rule: string
  impact: string | null | undefined
  help: string
  nodes: string[]
}

async function seriousViolations(page: Page): Promise<Finding[]> {
  const path = new URL(page.url()).pathname
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze()
  const findings: Finding[] = []
  for (const violation of results.violations) {
    if (violation.impact !== 'serious' && violation.impact !== 'critical') continue
    const containers = AXE_EXEMPTIONS.filter((e) => e.rule === violation.id && e.pages.test(path)).map((e) => e.within)
    const nodes: string[] = []
    for (const node of violation.nodes) {
      const selector = node.target.at(-1)
      const exempt =
        containers.length > 0 &&
        typeof selector === 'string' &&
        (await page.evaluate(
          ([sel, within]) => Boolean(document.querySelector(sel)?.closest(within.join(', '))),
          [selector, containers] as const,
        ))
      if (!exempt) nodes.push(`${node.target.join(' ')}：${node.failureSummary ?? ''}`)
    }
    if (nodes.length) findings.push({ rule: violation.id, impact: violation.impact, help: violation.help, nodes })
  }
  return findings
}

const PUBLIC_PAGES = [
  '/',
  '/campuses/yihua',
  '/campuses/renwu',
  '/curriculum',
  '/environment',
  '/admission',
  '/visit',
  `/visit/${SLOTS_CAMPUS}`,
  '/visit/minghua',
  '/visit/manage',
]

test.describe('官網', () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path} 沒有 serious／critical 的 axe 問題`, async ({ page }) => {
      await page.goto(path, { waitUntil: 'networkidle' })
      await skipEntrance(page)
      expect(await seriousViolations(page)).toEqual([])
    })
  }
})

test.describe('後台', () => {
  test.use({ storageState: storageStatePath('super_admin') })
  let visitId = ''

  test.beforeAll(async () => {
    await submitPublicRequest(SLOTS_CAMPUS, '無障礙檢查家長', '0912000441')
    const api = await adminApi('super_admin')
    visitId = (await findVisit(api, '無障礙檢查家長')).id
    await api.dispose()
  })

  const ADMIN_PAGES: [string, string | RegExp][] = [
    ['/', '營運總覽'],
    ['/visit-requests', '參觀案件'],
    ['/visit-requests/{visit}', '案件明細'],
    ['/visit-calendar', '接待月曆'],
    ['/slots', '時段與容量'],
    ['/booking', '各校預約方式'],
    ['/notifications', '站內通知'],
    ['/content/campus-profile?campus=yihua', '五校介紹'],
    ['/content/home-news', '最新消息與活動'],
    ['/media', '素材庫'],
    ['/releases', '發布紀錄'],
    ['/users', '使用者'],
  ]
  for (const [path, heading] of ADMIN_PAGES) {
    test(`/admin${path} 沒有 serious／critical 的 axe 問題`, async ({ page }) => {
      await page.goto(`/admin${path.replace('{visit}', visitId)}`)
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible()
      await page.waitForLoadState('networkidle')
      expect(await seriousViolations(page)).toEqual([])
    })
  }
})

test('後台登入頁沒有 serious／critical 的 axe 問題', async ({ page }) => {
  await page.goto('/admin/login')
  await expect(page.getByRole('button', { name: /登入/ }).first()).toBeVisible()
  expect(await seriousViolations(page)).toEqual([])
})
