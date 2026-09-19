// 一次性腳本：對現行 vanilla 原型拍攝 1440/1024/390/375px 的首頁與五校頁基準截圖。
// 用法：PATH 需含 node 22；node scripts/capture-baseline.mjs
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASELINE_URL ?? 'http://127.0.0.1:8765'
const OUT = 'artifacts/website-baseline'
mkdirSync(OUT, { recursive: true })

const viewports = [
  { name: '1440', width: 1440, height: 900 },
  { name: '1024', width: 1024, height: 900 },
  { name: '390', width: 390, height: 844 },
  { name: '375', width: 375, height: 812 },
]

const campuses = ['yihua', 'minghua', 'chongde', 'international', 'renwu']

const routes = [
  { name: 'home', path: '/index.html#/home' },
  ...campuses.map((key) => ({ name: `campus-${key}`, path: `/index.html#/${key}` })),
]

const browser = await chromium.launch({ channel: 'chrome' })
try {
  for (const vp of viewports) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    for (const route of routes) {
      await page.goto(`${BASE}${route.path}`, { waitUntil: 'networkidle' })
      await page.waitForTimeout(500)
      await page.screenshot({
        path: `${OUT}/${route.name}-${vp.name}.png`,
        fullPage: true,
      })
      console.log(`captured ${route.name}-${vp.name}.png`)
    }
    await context.close()
  }
} finally {
  await browser.close()
}
