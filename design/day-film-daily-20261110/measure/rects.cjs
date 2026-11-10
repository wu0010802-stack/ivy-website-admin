// 量「孩子的一天」開場那一屏的文字位置與影片框（給 contrast.py 離線合成用）。
// 用法：先 NUXT_PUBLIC_CONTENT_MODE=fixture npm --prefix web run dev -- --port 3100，再
//   node design/day-film-daily-20261110/measure/rects.cjs http://127.0.0.1:3100 output/day-film-daily-20261110/measure
// 每個寬度：捲到 .day-film 貼齊視窗頂、大標還沒開始淡（--word-fade 空或 ≥ .99）的第一個位置，
// 記下眉標、大標兩段、左下圖說與影片框的 rect、影片的 object-position，並存一張把影片與封面藏起來的截圖。
const { chromium } = require('playwright')
const fs = require('node:fs')
const path = require('node:path')

const base = process.argv[2] || 'http://127.0.0.1:3100'
const out = process.argv[3] || 'output/day-film-daily-20261110/measure'
const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '1280', width: 1280, height: 800 },
  { name: '1024', width: 1024, height: 768 },
  { name: '390', width: 390, height: 844, mobile: true },
]

async function main() {
  fs.mkdirSync(out, { recursive: true })
  const browser = await chromium.launch()
  const results = {}
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1,
      isMobile: !!vp.mobile, hasTouch: !!vp.mobile, reducedMotion: 'no-preference',
    })
    const page = await context.newPage()
    await page.goto(base + '/', { waitUntil: 'networkidle' })
    await page.addStyleTag({ content: '.day-film-video,.day-film-poster{visibility:hidden!important}' })
    await page.waitForSelector('.day-film')
    let found = null
    const max = await page.evaluate(() => document.documentElement.scrollHeight)
    for (let y = 0; y < max && !found; y += 40) {
      await page.evaluate((top) => window.scrollTo(0, top), y)
      await page.waitForTimeout(60)
      const state = await page.evaluate(() => {
        const film = document.querySelector('.day-film')
        const intro = document.querySelector('.day-intro')
        if (!film || !intro) return null
        const fade = intro.style.getPropertyValue('--word-fade')
        const rect = film.getBoundingClientRect()
        // 簾幕把上一段疊在孩子的一天上面：.day-film 貼齊視窗頂時關於段可能還在被擦掉，要視窗四個角與中央都已經是孩子的一天才算開場那一屏
        const points = [[8, 8], [innerWidth - 8, 8], [innerWidth / 2, innerHeight / 2], [8, innerHeight - 8], [innerWidth - 8, innerHeight - 8]]
        const revealed = points.every(([x, y]) => document.elementFromPoint(x, y)?.closest('.day-experience'))
        return { top: rect.top, fade: fade === '' ? 1 : Number(fade), scrollY: window.scrollY, revealed }
      })
      if (state && Math.abs(state.top) < 1 && state.fade >= 0.99 && state.revealed) found = state
    }
    if (!found) throw new Error(`${vp.name}: 找不到開場那一屏`)
    await page.waitForTimeout(900)
    const data = await page.evaluate(() => {
      const r = (el) => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height } }
      const film = document.querySelector('.day-film')
      const video = document.querySelector('.day-film-video') || document.querySelector('.day-film-poster')
      const text = {}
      const eyebrow = document.querySelector('.day-intro .eyebrow')
      if (eyebrow) text.eyebrow = { rect: r(eyebrow), color: getComputedStyle(eyebrow).color }
      for (const [key, sel] of [['title_ivy', '.day-title .t-ivy'], ['title_day', '.day-title .t-day']]) {
        const el = document.querySelector(sel)
        if (el) text[key] = { rect: r(el), color: getComputedStyle(el).color }
      }
      document.querySelectorAll('.day-film-caption span').forEach((el, i) => {
        if (el.getBoundingClientRect().width > 0) text[`caption_${i}`] = { rect: r(el), color: getComputedStyle(el).color }
      })
      return {
        scrollY: window.scrollY, viewport: { w: innerWidth, h: innerHeight }, film: r(film),
        objectPosition: video ? getComputedStyle(video).objectPosition : null, text,
      }
    })
    await page.screenshot({ path: path.join(out, `screen-${vp.name}.png`) })
    results[vp.name] = data
    console.log(vp.name, JSON.stringify({ scrollY: data.scrollY, objectPosition: data.objectPosition, keys: Object.keys(data.text) }))
    await context.close()
  }
  fs.writeFileSync(path.join(out, 'rects.json'), JSON.stringify(results, null, 2))
  await browser.close()
}

main().catch((error) => { console.error(error); process.exit(1) })
