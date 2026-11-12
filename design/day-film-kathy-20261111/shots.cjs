// 孩子的一天背景片比稿截圖：serve.py 開著時跑
//   node design/day-film-kathy-20261111/shots.cjs
// 桌機 1440×900、手機 390×844，現行／新版各拍「開場大標」與「拍立得上來」兩個捲動位置，存到 output/day-kathy-20261111/shots/。
const { chromium } = require('playwright')
const path = require('path')
const fs = require('fs')

const BASE = 'http://127.0.0.1:8878'
const OUT = path.join(__dirname, '../../output/day-kathy-20261111/shots')
const VIEWPORTS = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
}

;(async () => {
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch({ channel: 'chrome' })
  for (const [vp, opts] of Object.entries(VIEWPORTS)) {
    for (const variant of (process.env.VARIANTS || 'current,hands,handsraw').split(',')) {
      const ctx = await browser.newContext(opts)
      await ctx.addCookies([{ name: 'daybg', value: variant, url: BASE }])
      // headless 的頻寬估計很低，影片政策會改用封面；比稿要看影片，固定成一般寬頻
      await ctx.addInitScript(() => {
        Object.defineProperty(navigator, 'connection', { get: () => ({ downlink: 20, effectiveType: '4g', saveData: false, addEventListener() {} }) })
      })
      const page = await ctx.newPage()
      await page.goto(BASE + '/', { waitUntil: 'load', timeout: 90000 }); await page.waitForTimeout(1500)
      const top = await page.evaluate(() => document.querySelector('.day-experience').getBoundingClientRect().top + scrollY)
      // 簾幕擦完、開場大標完整出現的位置：桌機在區段頂端往下一個視窗高，手機半個
      const H = opts.viewport.height * (vp === 'mobile' ? 0.5 : 1)
      const shots = [['title', top + H], ['cards', top + H + (vp === 'mobile' ? 560 : 420)], ['later', top + H + (vp === 'mobile' ? 1900 : 2300)]]
      for (const [name, y] of shots) {
        await page.evaluate((y) => scrollTo(0, y), y)
        await page.waitForTimeout(400)
        await page.evaluate((y) => scrollTo(0, y + 1), y)
        await page.waitForFunction(() => document.querySelector('.day-film-video')?.classList.contains('is-ready'), null, { timeout: 20000 }).catch(() => {})
        await page.waitForTimeout(2600)
        const state = await page.evaluate(() => {
          const v = document.querySelector('.day-film-video')
          const mock = [...document.querySelectorAll('.mock-vid video')].map((m) => `${m.currentSrc.split('/__mock/').pop()}@${m.currentTime.toFixed(1)}/rs${m.readyState}${m.classList.contains('is-on') ? '*' : ''}`)
          return { src: v?.currentSrc?.split('/').pop(), ready: v?.classList.contains('is-ready'), t: v?.currentTime?.toFixed(1), w: v?.videoWidth, h: v?.videoHeight,
            active: [...document.querySelectorAll('.day-print')].findIndex((el) => el.classList.contains('is-active')), mock, stamp: document.querySelector('.mock-stamp')?.textContent }
        })
        const file = path.join(OUT, `${vp}-${variant}-${name}.jpg`)
        await page.screenshot({ path: file, type: 'jpeg', quality: 78 })
        console.log(vp, variant, name, JSON.stringify(state))
      }
      await ctx.close()
    }
  }
  await browser.close()
})()
