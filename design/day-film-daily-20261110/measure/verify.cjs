// fixture dev server 上實際播放：桌機 1440 與 WebKit 1440 要載入新的桌機檔、Chrome 390 手機模擬要載入手機檔，
// 都要淡入（.is-ready）、沒有 console 錯誤；各存一張捲到開場那一屏的截圖。
// 用法：node design/day-film-daily-20261110/measure/verify.cjs http://127.0.0.1:3100 output/day-film-daily-20261110/measure
const { chromium, webkit } = require('playwright')
const fs = require('node:fs')
const path = require('node:path')

const base = process.argv[2] || 'http://127.0.0.1:3100'
const out = process.argv[3] || 'output/day-film-daily-20261110/measure'
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../web/app/generated/video-manifest.json'), 'utf8'))
const CASES = [
  { name: 'chrome-1440', engine: chromium, viewport: { width: 1440, height: 900 }, expect: manifest['day-desktop'] },
  { name: 'webkit-1440', engine: webkit, viewport: { width: 1440, height: 900 }, expect: manifest['day-desktop'] },
  { name: 'chrome-390', engine: chromium, viewport: { width: 390, height: 844 }, mobile: true, expect: manifest['day-mobile'] },
]

async function main() {
  fs.mkdirSync(out, { recursive: true })
  let failed = false
  for (const item of CASES) {
    let browser
    try {
      browser = await item.engine.launch()
    } catch (error) {
      console.log(`${item.name}: 瀏覽器無法啟動（${error.message.split('\n')[0]}）`)
      continue
    }
    const context = await browser.newContext({ viewport: item.viewport, deviceScaleFactor: 1, isMobile: !!item.mobile, hasTouch: !!item.mobile })
    const page = await context.newPage()
    const errors = []
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    page.on('pageerror', (error) => errors.push(String(error)))
    await page.goto(base + '/', { waitUntil: 'networkidle' })
    const max = await page.evaluate(() => document.documentElement.scrollHeight)
    let state = null
    for (let y = 0; y < max; y += 60) {
      await page.evaluate((top) => window.scrollTo(0, top), y)
      await page.waitForTimeout(50)
      state = await page.evaluate(() => {
        const film = document.querySelector('.day-film')
        const intro = document.querySelector('.day-intro')
        if (!film || !intro) return null
        const fade = intro.style.getPropertyValue('--word-fade')
        const points = [[8, 8], [innerWidth - 8, 8], [innerWidth / 2, innerHeight / 2], [8, innerHeight - 8], [innerWidth - 8, innerHeight - 8]]
        const revealed = points.every(([x, y]) => document.elementFromPoint(x, y)?.closest('.day-experience'))
        return { top: film.getBoundingClientRect().top, fade: fade === '' ? 1 : Number(fade), revealed }
      })
      if (state && Math.abs(state.top) < 1 && state.fade >= 0.99 && state.revealed) break
    }
    await page.waitForFunction(() => {
      const video = document.querySelector('.day-film-video')
      return video && video.getAttribute('src') && video.classList.contains('is-ready')
    }, null, { timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(800)
    const info = await page.evaluate(() => {
      const video = document.querySelector('.day-film-video')
      return video ? { src: video.getAttribute('src'), ready: video.classList.contains('is-ready'), paused: video.paused, time: video.currentTime, w: video.videoWidth, h: video.videoHeight } : null
    })
    await page.screenshot({ path: path.join(out, `verify-${item.name}.png`) })
    const ok = info && info.src === item.expect && info.ready && !info.paused && errors.length === 0
    if (!ok) failed = true
    console.log(`${item.name}: ${ok ? 'OK' : 'FAIL'} ${JSON.stringify(info)} 預期 ${item.expect} console 錯誤 ${errors.length}${errors.length ? ' ' + errors.slice(0, 3).join(' | ') : ''}`)
    await browser.close()
  }
  process.exit(failed ? 1 : 0)
}

main().catch((error) => { console.error(error); process.exit(1) })
