// D 版截圖與檢查：node design/news-carousel-mobile-20260923/shot-d.cjs（先起 python3 -m http.server 8772 --bind 127.0.0.1）
// YT_TEST 只用來確認嵌入流程（預設為 YouTube 第一支公開影片），不是內容
const { chromium } = require(process.env.PW || '/Users/yilunwu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core')
const OUT = __dirname
const U = 'http://127.0.0.1:8772/design/news-carousel-mobile-20260923/'
const YT_TEST = process.env.YT_TEST || 'https://youtu.be/jNQXAC9IVRw'
;(async () => {
  const b = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] })
  const errors = []
  const r = {}
  const watch = pg => { pg.on('pageerror', e => errors.push(String(e))); pg.on('console', m => { if (m.type() === 'error' && !/youtube|ytimg|googlevideo|doubleclick|google/i.test(m.location()?.url || '')) errors.push(m.text()) }) }
  const active = pg => pg.$$eval('.fdot', ds => ds.findIndex(d => d.hasAttribute('aria-current')))
  const videos = pg => pg.$$eval('.car-films .slide', ss => ss.map(s => { const v = s.querySelector('video'); return v ? { src: !!v.getAttribute('src'), paused: v.paused } : { yt: !!s.querySelector('iframe') } }))
  // 桌機比稿頁
  const p = await b.newPage({ viewport: { width: 1280, height: 1000 } }); watch(p)
  await p.goto(U, { waitUntil: 'networkidle' }); await p.waitForTimeout(1200)
  await p.screenshot({ path: `${OUT}/d-board.png` })
  // 手機實寬：四種組合
  const m = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }); watch(m)
  for (const [ratio, list] of [['16x9', 'rows'], ['4x3', 'rows'], ['4x5', 'rows'], ['16x9', 'cards']]) {
    await m.goto(`${U}?view=d&ratio=${ratio}&list=${list}`, { waitUntil: 'networkidle' }); await m.waitForTimeout(1000)
    await m.locator('.hn').screenshot({ path: `${OUT}/mobile-d-${ratio}-${list}.png` })
    r[`size_${ratio}_${list}`] = await m.evaluate(() => [document.documentElement.scrollWidth, document.querySelector('.hn').offsetHeight])
  }
  r.captionGone = await m.$$eval('.hn-d .b-caption, .hn-d .film-caption', els => els.length === 0)
  await m.goto(`${U}?view=d`, { waitUntil: 'networkidle' })
  await m.locator('.car-films .car-viewport').scrollIntoViewIfNeeded(); await m.evaluate(() => scrollBy(0, 120)); await m.waitForTimeout(1200)
  r.start = [await active(m), await videos(m)]
  // 點右側露出的影片 → 第 2 支（YouTube 佔位）
  const vp = await m.locator('.car-films .car-viewport').boundingBox()
  await m.mouse.click(vp.x + vp.width - 12, vp.y + vp.height / 2); await m.waitForTimeout(900)
  r.neighborTap = [await active(m), await videos(m)]
  await m.locator('.car-films .car-viewport').screenshot({ path: `${OUT}/mobile-d-youtube-slot.png` })
  await m.click('.slide:not([inert]) .film-open'); await m.waitForTimeout(150)
  r.placeholderToast = await m.textContent('.toast')
  // 貼連結 → 套用到第 2 支 → 點播放 → 出現 iframe
  await m.fill('#yt-url', 'not a link'); await m.click('[data-yt-form] button'); r.badLink = await m.textContent('.yt-msg')
  await m.fill('#yt-url', YT_TEST); await m.click('[data-yt-form] button'); r.goodLink = await m.textContent('.yt-msg')
  r.thumb = await m.getAttribute('.slide:not([inert]) .yt-thumb', 'src')
  await m.locator('.car-films .car-viewport').scrollIntoViewIfNeeded()
  await m.click('.slide:not([inert]) .film-open'); await m.waitForTimeout(3500)
  r.iframe = await m.getAttribute('.slide:not([inert]) iframe', 'src')
  await m.locator('.car-films .car-viewport').screenshot({ path: `${OUT}/mobile-d-youtube-live.png` })
  // 點圓點換到第 3 支 → YouTube 播放器被卸掉、第 3 支檔案開始播
  await m.click('.fdot[data-dot="2"]'); await m.waitForTimeout(1200)
  r.afterLeave = [await active(m), await videos(m)]
  // 最後一支往後滑 → 回第 1 支
  await m.click('.fdot[data-dot="3"]'); await m.waitForTimeout(700)
  await m.evaluate(() => document.querySelector('.car-films .car-viewport').scrollIntoView({ block: 'center' })); await m.waitForTimeout(200)
  const box = await m.locator('.car-films .car-viewport').boundingBox()
  await m.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2); await m.mouse.down()
  for (let i = 1; i <= 8; i++) { await m.mouse.move(box.x + box.width * 0.8 - i * 14, box.y + box.height / 2); await m.waitForTimeout(16) }
  await m.mouse.up(); await m.waitForTimeout(800)
  r.swipeBackFrom4 = await active(m)
  // 減少動態
  const q = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' }); watch(q)
  await q.goto(`${U}?view=d`, { waitUntil: 'networkidle' }); await q.waitForTimeout(1000)
  r.reduce = await videos(q)
  console.log(JSON.stringify({ r, errors }, null, 1))
  await b.close()
})()
