// 從實際頁面收集「每一頁會用到 LINE Seed TW 的字」，供 scripts/subset-critical-fonts.py 依頁面共現分片：
// 同一批頁面一起用到的字切在同一片，內頁不必為了零星幾個字抓一堆依字頻切的分片。
//
// 在手機與桌機寬度載入每個公開頁面、從上捲到下（讓捲到才渲染的段落出現），收集 computed font-family
// 以 LINE Seed TW 開頭、而且有排版（getClientRects 非空）的文字節點：瀏覽器只替有排版的文字下載
// unicode-range 分片，display:none 的不算。字重 700 記進 bold，超過 700（配到 ExtraBold 800）記進 extraBold。
//
// 執行（預設讀線上正式站：內容以後台發布版為準，fixture 與正式內容不同）：
//   node scripts/page-font-chars.cjs [https://web-production-04caa.up.railway.app]
// 輸出 web/app/generated/page-font-chars.json，再跑 scripts/subset-critical-fonts.py 重切。
// 只送 GET：其餘請求（/api/telemetry 等）一律擋下，不把合成瀏覽寫進正式站統計。
const fs = require('node:fs')
const path = require('node:path')

const { chromium } = require(path.resolve(__dirname, '../node_modules/playwright'))
const base = (process.argv[2] || 'https://web-production-04caa.up.railway.app').replace(/\/$/, '')
const out = path.resolve(__dirname, '../web/app/generated/page-font-chars.json')
const VIEWPORTS = [
  { name: 'mobile', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  { name: 'desktop', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }
]
const STATIC_PAGES = ['/', '/about', '/curriculum', '/environment', '/admission', '/anniversary', '/news', '/visit', '/visit/manage', '/privacy', '/__missing__']

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
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n')
  console.log(`寫入 ${out}`)
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
