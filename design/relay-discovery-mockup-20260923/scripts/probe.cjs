// 量測各 ?relay= 模式：擦除進度對捲動的曲線、dock 位移、逐字進度。
const { chromium } = require('/Users/yilunwu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core')
const BASE = process.env.BASE || 'http://127.0.0.1:3177'
const VP = (process.env.VP || '1440x900').split('x').map(Number)
const MODES = (process.env.MODES || ',slow,type,dock,deepen,slow+type').split(',')
;(async () => {
  const browser = await chromium.launch({ channel: 'chrome' })
  for (const mode of MODES) {
    const mobile = VP[0] < 700
    const ctx = await browser.newContext({ viewport: { width: VP[0], height: VP[1] }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 })
    await ctx.addInitScript(() => { window.__ivyEntranceSeen = true })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.goto(`${BASE}/?relay=${mode.replace(/\+/g, ',')}`, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(400)
    const g = await page.evaluate(() => {
      const panel = document.querySelector('.home-belief'), track = document.querySelector('.belief-reveal-track')
      const screen = document.documentElement.clientHeight, own = panel.getBoundingClientRect().height, rect = track.getBoundingClientRect()
      return { start: rect.top + scrollY + own - screen, distance: rect.height - own, relay: document.documentElement.dataset.relay || '' }
    })
    const rows = []
    for (let k = 0; k <= 20; k++) {
      await page.evaluate(y => scrollTo(0, y), Math.round(g.start + g.distance * k / 20)); await page.waitForTimeout(90)
      rows.push(await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim()
        const a = document.querySelector('.wm-a').getBoundingClientRect(), b = document.querySelector('.wm-b').getBoundingClientRect()
        return [v('--seam-inset'), v('--relay'), v('--relay-type'), v('--relay-dock'), v('--relay-near'), Math.round(a.left) + '/' + Math.round(b.left)].join(' ')
      }))
    }
    console.log(`\n[${mode || 'default'}] relay="${g.relay}" distance=${Math.round(g.distance)} errors=${errors.length}`)
    console.log('k  seamInset relay type dock near  wmA/wmB-left')
    rows.forEach((r, k) => console.log(String(k).padStart(2), r))
    await ctx.close()
  }
  await browser.close()
})()
