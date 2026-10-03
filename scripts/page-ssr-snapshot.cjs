// 整頁內容改讀後台前後的畫面比對：抓 SSR 的 <main>（去掉 Vue 的註解標記與標籤間空白）
// 與桌機／手機整頁截圖（減少動態）。先開 fixture 模式的 dev server（計畫 Task 1 Step 2）。
//   node scripts/page-ssr-snapshot.cjs before /curriculum /about
//   node scripts/page-ssr-snapshot.cjs after /curriculum
// 輸出在 output/page-cms/<label>/（已 gitignore）。閘門：兩份 .html 的 diff 必須為空。
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require('playwright')

const BASE = process.env.PAGE_CMS_BASE ?? 'http://127.0.0.1:3141'
const [label, ...routes] = process.argv.slice(2)
if (!label || routes.length === 0) {
  console.error('用法：node scripts/page-ssr-snapshot.cjs <label> <path...>')
  process.exit(2)
}
const outDir = path.join('output', 'page-cms', label)
fs.mkdirSync(outDir, { recursive: true })

function mainHtml(html) {
  const start = html.indexOf('<main')
  const end = html.indexOf('</main>', start)
  if (start < 0 || end < 0) throw new Error('找不到 <main>')
  return html.slice(start, end + '</main>'.length).replace(/<!--[\s\S]*?-->/g, '').replace(/>\s+</g, '><')
}

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome' })
  try {
    for (const route of routes) {
      const name = route.replace(/^\//, '') || 'home'
      const response = await fetch(BASE + route)
      if (!response.ok) throw new Error(`${route} 回 ${response.status}`)
      fs.writeFileSync(path.join(outDir, `${name}.html`), `${mainHtml(await response.text())}\n`)
      for (const [device, viewport] of [['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
        const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce' })
        await context.addInitScript(() => sessionStorage.setItem('ivy-entrance-a-seen', '1'))
        const page = await context.newPage()
        await page.goto(BASE + route, { waitUntil: 'networkidle' })
        await page.evaluate(async () => {
          for (let y = 0; y < document.body.scrollHeight; y += 400) {
            window.scrollTo(0, y)
            await new Promise((resolve) => setTimeout(resolve, 60))
          }
          window.scrollTo(0, 0)
          await document.fonts.ready
        })
        await page.waitForLoadState('networkidle')
        await page.screenshot({ path: path.join(outDir, `${name}-${device}.png`), fullPage: true })
        await context.close()
      }
      console.log(`已存 ${route} → ${outDir}`)
    }
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
