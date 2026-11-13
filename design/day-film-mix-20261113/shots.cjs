// 孩子的一天混剪比稿截圖（先開 serve.py）：桌機 1440×900、矮視窗 1440×560、手機 390×844，
// 現行／混剪各拍「開場大標」「拍立得上來」「後段」三個捲動位置，再把影片跳到幾個時間點各拍一張，存到 output/day-mix-20261113/shots/。
//   node design/day-film-mix-20261113/shots.cjs [current,mix] [desktop,short,mobile]
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')
const BASE = process.env.BASE || 'http://127.0.0.1:8891'
const OUT = path.join(__dirname, '../../output/day-mix-20261113/shots')
const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  short: { viewport: { width: 1440, height: 560 }, deviceScaleFactor: 1 },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
}
const variants = (process.argv[2] || 'current,mix').split(',')
const views = (process.argv[3] || 'desktop,mobile').split(',')
;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome' })
  for (const vp of views) for (const variant of variants) {
    const opts = VIEWPORTS[vp]
    const ctx = await browser.newContext(opts)
    await ctx.addCookies([{ name: 'daybg', value: variant, url: BASE }])
    // headless 的頻寬估計很低，影片政策會改用封面；比稿要看影片，固定成一般寬頻
    await ctx.addInitScript(() => {
      Object.defineProperty(navigator, 'connection', { get: () => ({ downlink: 20, effectiveType: '4g', saveData: false, addEventListener() {} }) })
    })
    const page = await ctx.newPage()
    await page.goto(BASE + '/?bare=1', { waitUntil: 'load', timeout: 120000 }); await page.waitForTimeout(1500)
    const top = await page.evaluate(() => document.querySelector('.day-experience').getBoundingClientRect().top + scrollY)
    const H = opts.viewport.height * (vp === 'mobile' ? 0.5 : 1)
    const stops = [['title', top + H], ['cards', top + H + (vp === 'mobile' ? 560 : 420)], ['later', top + H + (vp === 'mobile' ? 1900 : 2300)]]
    for (const [name, y] of stops) {
      await page.evaluate((y) => scrollTo(0, y), y)
      await page.waitForTimeout(400)
      await page.evaluate((y) => scrollTo(0, y + 1), y)
      await page.waitForFunction(() => document.querySelector('.day-film-video')?.classList.contains('is-ready'), null, { timeout: 40000 }).catch(() => {})
      await page.waitForTimeout(2200)
      const state = await page.evaluate(() => {
        const v = document.querySelector('.day-film-video')
        return { src: v?.currentSrc?.split('/').pop(), ready: v?.classList.contains('is-ready'), t: v?.currentTime?.toFixed(1), size: [v?.videoWidth, v?.videoHeight], dur: v?.duration?.toFixed(2),
          caption: document.querySelector('.day-film-caption')?.innerText.replace(/\n/g, ' | ') }
      })
      await page.screenshot({ path: path.join(OUT, `${vp}-${variant}-${name}.jpg`), type: 'jpeg', quality: 78 })
      console.log(vp, variant, name, JSON.stringify(state))
      if (name !== 'cards') continue
      // 拍立得上來的位置，把影片跳到每一鏡中間各拍一張（看每一鏡壓在拍立得後面的樣子）
      const dur = await page.evaluate(() => document.querySelector('.day-film-video')?.duration || 0)
      const n = { mix: 15, pick: 14, pick2: 14, pick3: 16, pick4: 15 }[variant] || 6
      for (let i = 0; i < n; i++) {
        await page.evaluate((t) => new Promise((res) => {
          const v = document.querySelector('.day-film-video'); v.pause()
          v.addEventListener('seeked', () => requestAnimationFrame(() => requestAnimationFrame(res)), { once: true })
          v.currentTime = t
        }), (i + 0.5) * dur / n)
        await page.screenshot({ path: path.join(OUT, `${vp}-${variant}-shot${String(i + 1).padStart(2, '0')}.jpg`), type: 'jpeg', quality: 72 })
      }
      await page.evaluate(() => document.querySelector('.day-film-video')?.play())
    }
    await ctx.close()
  }
  await browser.close()
})()
