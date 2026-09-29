// 從實際頁面推導入學資訊頁（/admission）明體（Ivy Passport Serif，600 小標／900 印章字）用到的字，供
// scripts/subset-admission-fonts.py 切分片：載入 /admission，走過 main.ap 裡所有文字節點（含 SVG <text>，
// 印章是 PassportStamp.vue 畫的 <text>／<textPath>），依 computed font-family 開頭（Ivy Passport Serif）與
// font-weight 分組收集。
//
// 印章大多在瀏覽器端才出現（輸入生日、勾必備品、翻開退費規定才畫出對應印章），所以：
// - 開頁用 reducedMotion: 'reduce'，印章直接出現、不等進場動畫。
// - 在 #birthday 依序填 2022-03-15、2025-05-01、2019-12-31、2020-10-01 四個生日，各等 300ms 收集一次
//   （班別、學年度隨生日變動的印章字都要收全）。
// - 所有 input[type=checkbox] 勾起來再收集一次（必備品印章）。
// - 所有 <details> 打開再收集一次（退費規定印章）。
// 每種寬度的版面用字相同，只量一個桌機與一個手機視窗、取聯集。
//
// 執行（先起本機 server，內容用 fixture；例如 cd web && NUXT_PUBLIC_CONTENT_MODE=fixture
// NUXT_WEBSITE_ENV=staging npx nuxt dev --port 3107）：
//   node scripts/admission-font-chars.cjs http://127.0.0.1:3107
// 輸出 web/app/generated/admission-font-chars.json，再跑 scripts/subset-admission-fonts.py 重切。
// 改了入學資訊頁文案（步驟、班別、必備品、退費規定……）就要重跑這兩支。Playwright 用 npx 快取（同
// environment-font-chars.cjs／first-screen-chars.cjs）。
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
const out = path.resolve(__dirname, '../web/app/generated/admission-font-chars.json')
const VIEWPORTS = [
  { width: 1440, height: 900, isMobile: false },
  { width: 390, height: 844, isMobile: true }
]
const BIRTHDAYS = ['2022-03-15', '2025-05-01', '2019-12-31', '2020-10-01']

// main.ap 底下所有文字節點（一般 DOM 與 SVG 都要收），依 computed font-family／font-weight 分組。
// SVG 元素的 getComputedStyle 也能用，直接對 <text> 節點的 parentElement 取樣即可。
function collect() {
  const result = {}
  const root = document.querySelector('main.ap')
  if (!root) throw new Error('找不到 main.ap')
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node
  while ((node = walker.nextNode())) {
    const el = node.parentElement
    if (!el || !node.textContent.trim()) continue
    const cs = getComputedStyle(el)
    if (!/^"?Ivy Passport Serif/.test(cs.fontFamily)) continue
    const key = `serif-${cs.fontWeight}`
    result[key] = (result[key] || '') + node.textContent
  }
  return result
}

function merge(groups, found) {
  for (const [key, text] of Object.entries(found)) {
    groups[key] ??= new Set()
    for (const char of text) if (char.trim()) groups[key].add(char)
  }
}

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const groups = {}
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      isMobile: vp.isMobile,
      hasTouch: vp.isMobile,
      locale: 'zh-TW',
      reducedMotion: 'reduce'
    })
    const page = await context.newPage()
    await page.goto(`${base}/admission`, { waitUntil: 'networkidle', timeout: 90000 })

    merge(groups, await page.evaluate(collect))

    for (const birthday of BIRTHDAYS) {
      await page.fill('#birthday', birthday)
      await page.waitForTimeout(300)
      merge(groups, await page.evaluate(collect))
    }

    const checkboxes = await page.locator('input[type=checkbox]').all()
    for (const checkbox of checkboxes) await checkbox.check({ force: true })
    await page.waitForTimeout(300)
    merge(groups, await page.evaluate(collect))

    const detailsEls = await page.locator('details').all()
    for (const el of detailsEls) await el.evaluate((node) => { node.open = true })
    await page.waitForTimeout(300)
    merge(groups, await page.evaluate(collect))

    await context.close()
  }
  await browser.close()
  const result = { generatedFrom: `${base}/admission`, groups: {} }
  for (const key of Object.keys(groups).sort()) result.groups[key] = [...groups[key]].sort().join('')
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n')
  for (const [key, text] of Object.entries(result.groups)) console.log(`${key}: ${[...text].length} 字`)
})().catch((error) => { console.error(error); process.exit(1) })
