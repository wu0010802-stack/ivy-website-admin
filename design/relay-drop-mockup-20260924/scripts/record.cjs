// 錄捲動影片：每個模式用同一個捲動速度（px/s）從擦除開始前一點捲到擦除結束後，
// 讓 slow 的簾幕較長這件事也如實反映在片長上。
const { chromium } = require('/Users/yilunwu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core')
const fs = require('fs')
const BASE = process.env.BASE || 'http://127.0.0.1:3177'
const VP = (process.env.VP || '1440x900').split('x').map(Number)
const MODES = (process.env.MODES || 'default,wipe,sink,out,push,cut').split(',')
const SPEED = +(process.env.SPEED || 320)
const SCALE = +(process.env.SCALE || 1)
;(async () => {
  const browser = await chromium.launch({ channel: 'chrome' })
  const mobile = VP[0] < 700
  const dir = `video/${VP.join('x')}`; fs.mkdirSync(dir, { recursive: true })
  for (const mode of MODES) {
    const size = { width: Math.round(VP[0] * SCALE), height: Math.round(VP[1] * SCALE) }
    const ctx = await browser.newContext({ viewport: { width: VP[0], height: VP[1] }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, recordVideo: { dir: `${dir}/raw-${mode}`, size } })
    await ctx.addInitScript(() => { window.__ivyEntranceSeen = true })
    const page = await ctx.newPage()
    const t0 = Date.now()
    await page.goto(`${BASE}/${mode === 'default' ? '' : '?drop=' + mode}`, { waitUntil: 'networkidle' })
    await page.evaluate(() => document.fonts.ready)
    const g = await page.evaluate(() => {
      const panel = document.querySelector('.home-belief'), track = document.querySelector('.belief-reveal-track')
      const screen = document.documentElement.clientHeight, own = panel.getBoundingClientRect().height, rect = track.getBoundingClientRect()
      return { start: rect.top + scrollY + own - screen, distance: rect.height - own, screen }
    })
    const from = g.start - g.screen * .12, to = g.start + g.distance + g.screen * .08
    await page.evaluate(y => scrollTo(0, y), Math.round(from)); await page.waitForTimeout(900)
    const begin = (Date.now() - t0) / 1000
    await page.evaluate(({ from, to, speed }) => new Promise(done => {
      const t0 = performance.now()
      const step = now => {
        const y = Math.min(to, from + speed * (now - t0) / 1000)
        scrollTo(0, y)
        if (y < to) requestAnimationFrame(step); else setTimeout(done, 900)
      }
      requestAnimationFrame(step)
    }), { from, to, speed: SPEED })
    const video = page.video()
    await ctx.close()
    const src = await video.path()
    fs.renameSync(src, `${dir}/${mode}.webm`)
    fs.writeFileSync(`${dir}/${mode}.json`, JSON.stringify({ begin, distance: g.distance }))
    fs.rmSync(`${dir}/raw-${mode}`, { recursive: true, force: true })
    console.log(mode, 'begin', begin.toFixed(2), 'distance', Math.round(g.distance))
  }
  await browser.close()
})()
