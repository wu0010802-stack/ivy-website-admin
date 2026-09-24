// 逐格截圖：每個模式在擦除（原始捲動進度）FROM→TO 之間等距取 COUNT 格。
const { chromium } = require('/Users/yilunwu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core')
const fs = require('fs')
const BASE = process.env.BASE || 'http://127.0.0.1:3177'
const VP = (process.env.VP || '1440x900').split('x').map(Number)
const MODES = (process.env.MODES || 'default,slow,type,dock,deepen,slow+type,slow+type+dock').split(',')
const FROM = +(process.env.FROM || .2), TO = +(process.env.TO || .8), COUNT = +(process.env.COUNT || 13)
const OUT = process.env.OUT || 'frames'
;(async () => {
  const browser = await chromium.launch({ channel: 'chrome' })
  const mobile = VP[0] < 700
  for (const mode of MODES) {
    const dir = `${OUT}/${VP.join('x')}/${mode}`; fs.mkdirSync(dir, { recursive: true })
    const ctx = await browser.newContext({ viewport: { width: VP[0], height: VP[1] }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 })
    await ctx.addInitScript(() => { window.__ivyEntranceSeen = true })
    const page = await ctx.newPage()
    await page.goto(`${BASE}/?relay=${mode === 'default' ? '' : mode.replace(/\+/g, ',')}`, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(400)
    const g = await page.evaluate(() => {
      const panel = document.querySelector('.home-belief'), track = document.querySelector('.belief-reveal-track')
      const screen = document.documentElement.clientHeight, own = panel.getBoundingClientRect().height, rect = track.getBoundingClientRect()
      return { start: rect.top + scrollY + own - screen, distance: rect.height - own }
    })
    for (let k = 0; k < COUNT; k++) {
      const p = FROM + (TO - FROM) * k / (COUNT - 1)
      await page.evaluate(y => scrollTo(0, y), Math.round(g.start + g.distance * p)); await page.waitForTimeout(140)
      await page.screenshot({ path: `${dir}/${String(k).padStart(2, '0')}.jpg`, type: 'jpeg', quality: 82 })
    }
    console.log(mode, 'distance', Math.round(g.distance))
    await ctx.close()
  }
  await browser.close()
})()
