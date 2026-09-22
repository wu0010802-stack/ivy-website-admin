// 從實際 SSR 頁面推導「首屏會用到 LINE Seed TW（Bold 700）的字」，供 scripts/subset-critical-fonts.py
// 切 critical 子集：在幾個視窗尺寸下載入首頁、五個分校頁與 /visit，找出 computed font-family 以
// LINE Seed TW 開頭、且在 scroll 0 時與視窗相交的文字節點，收集其字元。
//
// 執行（先起本機 server，例如 cd web && npm run build && PORT=3100 NUXT_WEBSITE_ENV=staging
// NUXT_PUBLIC_CONTENT_MODE=fixture node .output/server/index.mjs）：
//   node scripts/first-screen-chars.cjs http://127.0.0.1:3100
// 輸出 web/app/generated/first-screen-chars.json（各視窗／頁面的字與聯集），再跑
// python3 scripts/subset-critical-fonts.py 重切。Playwright 用 npx 快取（見 CLAUDE.md）。
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

function findPlaywright() {
  const root = path.join(os.homedir(), '.npm/_npx')
  for (const dir of fs.existsSync(root) ? fs.readdirSync(root) : []) {
    const candidate = path.join(root, dir, 'node_modules/playwright-core')
    if (fs.existsSync(candidate)) return require(candidate)
  }
  throw new Error('找不到 npx 快取裡的 playwright-core，先 `npx playwright-core --version` 一次')
}

const { chromium } = findPlaywright()
const base = process.argv[2] || 'http://127.0.0.1:3100'
const out = path.resolve(__dirname, '../web/app/generated/first-screen-chars.json')
// Lighthouse 的手機（412×823）／桌機（1350×940）、常見手機、最窄手機、平板與 1440 桌機
const VIEWPORTS = [
  { name: 'lh-mobile', width: 412, height: 823, isMobile: true, hasTouch: true, dpr: 1.75 },
  { name: 'iphone', width: 390, height: 844, isMobile: true, hasTouch: true, dpr: 3 },
  { name: 'small', width: 320, height: 568, isMobile: true, hasTouch: true, dpr: 2 },
  { name: 'lh-desktop', width: 1350, height: 940, isMobile: false, hasTouch: false, dpr: 1 },
  { name: 'desktop', width: 1440, height: 900, isMobile: false, hasTouch: false, dpr: 2 },
  { name: 'tablet', width: 768, height: 1024, isMobile: true, hasTouch: true, dpr: 2 }
]
const PAGES = ['/', '/campuses/yihua', '/campuses/minghua', '/campuses/chongde', '/campuses/international', '/campuses/renwu', '/visit']

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const result = { generatedFrom: base, viewports: {}, union: '' }
  const union = new Set()
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: vp.dpr, isMobile: vp.isMobile, hasTouch: vp.hasTouch, locale: 'zh-TW' })
    await context.route(/\.mp4(\?.*)?$/, (route) => route.abort())
    const page = await context.newPage()
    for (const pagePath of PAGES) {
      await page.goto(base + pagePath, { waitUntil: 'networkidle', timeout: 90000 })
      // 等簾幕量測完成；幾何以 scroll 0 為準（hydration 前後首屏一致）
      await page.waitForTimeout(1200)
      const text = await page.evaluate(() => {
        const vh = innerHeight, vw = innerWidth
        const chars = new Set()
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
        let node
        while ((node = walker.nextNode())) {
          const el = node.parentElement
          if (!el || !node.textContent.trim()) continue
          const cs = getComputedStyle(el)
          if (!/^"?LINE Seed TW/.test(cs.fontFamily) || Number(cs.fontWeight) !== 700) continue
          if (cs.display === 'none' || cs.visibility === 'hidden') continue
          const range = document.createRange()
          range.selectNodeContents(node)
          const r = range.getBoundingClientRect()
          if (!r.width || r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue
          for (const ch of node.textContent) if (ch.trim()) chars.add(ch)
        }
        return [...chars].join('')
      })
      result.viewports[`${vp.name}${pagePath}`] = text
      for (const ch of text) union.add(ch)
    }
    await context.close()
  }
  result.union = [...union].sort().join('')
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n')
  console.log(`首屏 LINE Seed Bold 用字 ${result.union.length} 個：${result.union}`)
  console.log(`寫入 ${out}`)
  await browser.close()
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
