// 從實際頁面收集「每一頁會用到 LINE Seed TW 的字」，供 scripts/subset-critical-fonts.py 依頁面共現分片：
// 同一批頁面一起用到的字切在同一片，內頁不必為了零星幾個字抓一堆依字頻切的分片。
//
// 在手機與桌機寬度載入每個公開頁面、從上捲到下（讓捲到才渲染的段落出現），收集 computed font-family
// 以 LINE Seed TW 開頭、而且有排版（getClientRects 非空）的文字節點：瀏覽器只替有排版的文字下載
// unicode-range 分片，display:none 的不算。字重 700 記進 bold，超過 700（配到 ExtraBold 800）記進 extraBold。
//
// 執行（預設讀線上正式站：內容以後台發布版為準，fixture 與正式內容不同）：
//   node scripts/page-font-chars.cjs [https://www.ivykidschool.com]
// 輸出 web/app/generated/page-font-chars.json，再跑 scripts/subset-critical-fonts.py 重切。
// 只送 GET：其餘請求（/api/telemetry 等）一律擋下，不把合成瀏覽寫進正式站統計。
//
// 檢查字表有沒有落後正式站（後台改了標題、消息或拍立得卡）：
//   node scripts/page-font-chars.cjs --check [網址]
// 不寫檔，列出各頁多出來、還沒進字表的字；有就回傳 1，表示該重收字表＋重切分片。
// 2026-11-09 稽核：後台新增兩張拍立得卡的標題讓首頁多抓 8 片（約 110 KB），字表卻沒人發現落後。
const fs = require('node:fs')
const path = require('node:path')

const { chromium } = require(path.resolve(__dirname, '../node_modules/playwright'))
const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const base = (args.find((arg) => !arg.startsWith('--')) || 'https://www.ivykidschool.com').replace(/\/$/, '')
const out = path.resolve(__dirname, '../web/app/generated/page-font-chars.json')
const VIEWPORTS = [
  { name: 'mobile', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'desktop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }
]
// 各校預約頁（第二步「填寫參觀資料」）要直接列出來：/visit 的校區卡是按鈕不是連結，
// 下面從列表頁找連結的做法找不到它們（2026-11-09 稽核：第二步因此多抓約 100 KB）。
const CAMPUS_KEYS = require(path.resolve(__dirname, '../web/server/data/site-fixture.json')).campuses.map((campus) => campus.key)
const STATIC_PAGES = ['/', '/about', '/curriculum', '/environment', '/admission', '/anniversary', '/news', '/visit',
  ...CAMPUS_KEYS.map((key) => `/visit/${key}`), '/visit/manage', '/privacy', '/__missing__']

async function collect(page) {
  // 從上到下慢慢捲，捲到才掛上的段落（hydrate-on-visible、IntersectionObserver）也會出現
  await page.evaluate(async () => {
    const step = Math.max(200, innerHeight * 0.6)
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      scrollTo(0, y)
      await new Promise((resolve) => setTimeout(resolve, 120))
    }
    scrollTo(0, 0)
  })
  await page.waitForTimeout(600)
  return page.evaluate(() => {
    const bold = new Set(), extraBold = new Set()
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      const el = node.parentElement
      if (!el || !node.textContent.trim()) continue
      const cs = getComputedStyle(el)
      if (!/^"?LINE Seed TW/.test(cs.fontFamily)) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      if (!range.getClientRects().length) continue
      const chars = Number(cs.fontWeight) > 700 ? extraBold : bold
      for (const ch of node.textContent) if (ch.trim()) chars.add(ch)
    }
    return { bold: [...bold], extraBold: [...extraBold] }
  })
}

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const pages = {}
  for (const device of VIEWPORTS) {
    const { name, ...options } = device
    const context = await browser.newContext({ ...options, locale: 'zh-TW' })
    await context.route('**/*', (route) => {
      const request = route.request()
      if (/\.mp4(\?.*)?$/.test(request.url())) return route.abort()
      return ['GET', 'HEAD', 'OPTIONS'].includes(request.method()) ? route.continue() : route.abort()
    })
    await context.addInitScript(() => { try { sessionStorage.setItem('ivy-entrance-a-seen', '1') } catch {} })
    const page = await context.newPage()
    let targets = [...STATIC_PAGES]
    for (let i = 0; i < targets.length; i++) {
      const pagePath = targets[i]
      await page.goto(base + pagePath, { waitUntil: 'load', timeout: 120000 })
      await page.waitForTimeout(1500)
      if (pagePath === '/news' || pagePath === '/visit') {
        // 消息內頁與各校預約頁：從列表頁的連結找出實際存在的網址
        const prefix = pagePath + '/'
        const links = await page.evaluate((p) => [...new Set([...document.querySelectorAll('a[href]')]
          .map((a) => new URL(a.href).pathname).filter((h) => h.startsWith(p) && h !== p && !h.endsWith('/manage')))], prefix)
        targets.push(...links.filter((link) => !targets.includes(link)))
      }
      const chars = await collect(page)
      const key = pagePath.startsWith('/news/') ? '/news/[id]' : pagePath.startsWith('/visit/') && pagePath !== '/visit/manage' ? '/visit/[key]' : pagePath
      const entry = (pages[key] ??= { bold: new Set(), extraBold: new Set() })
      chars.bold.forEach((ch) => entry.bold.add(ch))
      chars.extraBold.forEach((ch) => entry.extraBold.add(ch))
      console.log(`${name} ${pagePath}: Bold ${chars.bold.length}、ExtraBold ${chars.extraBold.length}`)
    }
    await context.close()
  }
  await browser.close()
  const result = { generatedFrom: base, pages: {} }
  for (const [key, { bold, extraBold }] of Object.entries(pages)) {
    result.pages[key] = { bold: [...bold].sort().join(''), extraBold: [...extraBold].sort().join('') }
  }
  if (checkOnly) {
    const known = JSON.parse(fs.readFileSync(out, 'utf8')).pages
    let drift = 0
    for (const [key, { bold, extraBold }] of Object.entries(result.pages)) {
      const missing = (chars, have = '') => [...chars].filter((ch) => !have.includes(ch)).join('')
      const newBold = missing(bold, known[key]?.bold)
      const newExtraBold = missing(extraBold, known[key]?.extraBold)
      if (!known[key]) console.log(`${key}：字表沒有這一頁`)
      if (newBold) console.log(`${key} Bold 多了 ${[...newBold].length} 字：${newBold}`)
      if (newExtraBold) console.log(`${key} ExtraBold 多了 ${[...newExtraBold].length} 字：${newExtraBold}`)
      if (!known[key] || newBold || newExtraBold) drift++
    }
    console.log(drift ? `${drift} 頁的字表落後，重跑本腳本（不加 --check）再跑 scripts/subset-critical-fonts.py。` : '字表與正式站一致。')
    process.exitCode = drift ? 1 : 0
    return
  }
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n')
  console.log(`寫入 ${out}`)
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
