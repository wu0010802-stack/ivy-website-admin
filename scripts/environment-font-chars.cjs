// 從實際頁面推導常春藤環境頁（/environment）每種字型、字重用到的字，供 scripts/subset-environment-fonts.py
// 切分片：載入 /environment，走過 main.renv 裡所有文字節點，依 computed font-family 開頭
// （Chiron GoRound TC／Iansui）與 font-weight 分組收集。還沒切到的校園探索分頁是 hidden（computed style
// 照樣算得出來），另記在「<字型>-<字重>-hidden」：瀏覽器要到切過去才畫那些字，不放進首屏的 critical。
// 每種寬度的版面用字相同，只量一個桌機與一個手機視窗、取聯集。
//
// 執行（先起本機 server，內容用 fixture；例如 cd web && NUXT_PUBLIC_CONTENT_MODE=fixture
// NUXT_WEBSITE_ENV=staging npx nuxt dev --port 3107）：
//   node scripts/environment-font-chars.cjs http://127.0.0.1:3107
// 輸出 web/app/generated/environment-font-chars.json，再跑 scripts/subset-environment-fonts.py 重切。
// 改了環境頁文案或各校校園探索的預設內容就要重跑這兩支。Playwright 用 npx 快取（同 first-screen-chars.cjs）。
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
const base = process.argv[2] || 'http://127.0.0.1:3107'
const out = path.resolve(__dirname, '../web/app/generated/environment-font-chars.json')
const VIEWPORTS = [
  { width: 1440, height: 900, isMobile: false },
  { width: 390, height: 844, isMobile: true }
]

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const groups = {}
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: vp.isMobile, hasTouch: vp.isMobile, locale: 'zh-TW' })
    const page = await context.newPage()
    await page.goto(`${base}/environment`, { waitUntil: 'networkidle', timeout: 90000 })
    const found = await page.evaluate(() => {
      const result = {}
      const root = document.querySelector('main.renv')
      if (!root) throw new Error('找不到 main.renv')
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let node
      while ((node = walker.nextNode())) {
        const el = node.parentElement
        if (!el || !node.textContent.trim() || el.closest('svg')) continue
        const cs = getComputedStyle(el)
        const family = /^"?Chiron GoRound TC/.test(cs.fontFamily) ? 'round' : /^"?Iansui/.test(cs.fontFamily) ? 'hand' : null
        if (!family) continue
        const key = `${family}-${cs.fontWeight}${el.closest('[hidden]') ? '-hidden' : ''}`
        result[key] = (result[key] || '') + node.textContent
      }
      return result
    })
    for (const [key, text] of Object.entries(found)) {
      groups[key] ??= new Set()
      for (const char of text) if (char.trim()) groups[key].add(char)
    }
    await context.close()
  }
  await browser.close()
  const result = { generatedFrom: `${base}/environment`, groups: {} }
  for (const key of Object.keys(groups).sort()) result.groups[key] = [...groups[key]].sort().join('')
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n')
  for (const [key, text] of Object.entries(result.groups)) console.log(`${key}: ${[...text].length} 字`)
})().catch((error) => { console.error(error); process.exit(1) })
