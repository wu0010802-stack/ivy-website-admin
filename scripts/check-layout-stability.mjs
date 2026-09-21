// 本機 Chrome 實驗室回歸：E2E_BASE_URL=http://127.0.0.1:3100 node scripts/check-layout-stability.mjs
import { chromium } from 'playwright-core'
import assert from 'node:assert/strict'
const browser = await chromium.launch({ channel: 'chrome' })
try {
  for (const [width, height] of [[375, 812], [390, 844], [390, 667], [1440, 900]]) {
    const page = await browser.newPage({ viewport: { width, height } })
    await page.addInitScript(() => {
      window.__layoutShifts = []
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__layoutShifts.push(entry.value)
      }).observe({ type: 'layout-shift', buffered: true })
    })
    await page.goto(process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100', { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(500)
    const initial = await page.evaluate(() => window.__layoutShifts.reduce((sum, value) => sum + value, 0))
    assert.ok(initial <= 0.1, `${width}×${height} 首屏位移 ${initial}`)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    console.log(`PASS ${width}×${height}: initial layout shift ${initial.toFixed(5)}`)
    await page.close()
  }
} finally { await browser.close() }
