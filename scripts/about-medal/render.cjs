// build.py 呼叫：node scripts/about-medal/render.cjs <port> <out dir>，把正面與背面各截一張透明 PNG。
const { chromium } = require('playwright')
const path = require('node:path')

const [port, outDir] = process.argv.slice(2)
;(async () => {
  const browser = await chromium.launch({ channel: 'chrome' })
  const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 800, height: 800 } })
  page.on('pageerror', (e) => { console.error(e); process.exitCode = 1 })
  for (const side of ['front', 'back']) {
    const q = new URLSearchParams({ side, size: '320', crest: '/scripts/about-medal/.crest.png' })
    await page.goto(`http://127.0.0.1:${port}/scripts/about-medal/render.html?${q}`)
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 30000 })
    await page.locator('canvas').screenshot({ path: path.join(outDir, `${side}.png`), omitBackground: true })
  }
  await browser.close()
})()
