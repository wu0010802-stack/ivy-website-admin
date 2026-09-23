// 用法：node design/news-carousel-mobile-20260923/shot.cjs（先在 repo 根目錄起 python3 -m http.server 8772 --bind 127.0.0.1）
const { chromium } = require(process.env.PW || '/Users/yilunwu/.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core')
const OUT = __dirname
const URL = 'http://127.0.0.1:8772/design/news-carousel-mobile-20260923/'
;(async () => {
  const b = await chromium.launch({ channel: 'chrome' })
  const errors = []
  // 比較頁
  const p = await b.newPage({ viewport: { width: 1480, height: 1200 }, deviceScaleFactor: 1 })
  p.on('pageerror', e => errors.push(String(e)))
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  await p.goto(URL, { waitUntil: 'networkidle' })
  await p.waitForTimeout(800)
  await p.screenshot({ path: `${OUT}/board.png`, fullPage: true })
  // 每支手機：初始、拖曳中、換頁後
  for (const key of ['a', 'b', 'c']) {
    const phone = p.locator(`.direction[data-key="${key}"] .phone`)
    await phone.screenshot({ path: `${OUT}/${key}-rest.png` })
    const vp = p.locator(`.direction[data-key="${key}"] .hn-news .car-viewport`)
    await vp.scrollIntoViewIfNeeded()
    const screen = p.locator(`.direction[data-key="${key}"] .screen`)
    await screen.evaluate(el => { el.scrollTop = 300 })
    await p.waitForTimeout(200)
    const box = await vp.boundingBox()
    const y = box.y + Math.min(120, box.height / 2)
    await p.mouse.move(box.x + box.width * 0.75, y)
    await p.mouse.down()
    for (let i = 1; i <= 8; i++) { await p.mouse.move(box.x + box.width * 0.75 - i * 26, y); await p.waitForTimeout(16) }
    await phone.screenshot({ path: `${OUT}/${key}-drag.png` })
    await p.mouse.up()
    await p.waitForTimeout(900)
    await phone.screenshot({ path: `${OUT}/${key}-next.png` })
    await screen.evaluate(el => { el.scrollTop = 0 })
  }
  // 單版預覽在真手機寬度
  const m = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  m.on('pageerror', e => errors.push(String(e)))
  for (const key of ['now', 'a', 'b', 'c']) {
    await m.goto(`${URL}?view=${key}`, { waitUntil: 'networkidle' })
    await m.waitForTimeout(500)
    const hn = m.locator('.hn')
    await hn.screenshot({ path: `${OUT}/mobile-${key}.png` })
  }
  const metrics = await p.$$eval('.metric', els => els.map(e => e.textContent))
  console.log(JSON.stringify({ metrics, errors }, null, 1))
  await b.close()
})()
