// 用法：repo 根目錄起 `python3 -m http.server 8773 --bind 127.0.0.1` 後 `node design/news-carousel-20260923/shot.cjs`
const path = require('path')
const fs = require('fs')
const { chromium } = require(path.join(process.env.HOME, '.npm/_npx/e41f203b7505f1fb/node_modules/playwright-core'))

const BASE = 'http://127.0.0.1:8773/design/news-carousel-20260923/'
const OUT = path.join(__dirname, '../../output/news-carousel-20260923')
const SHOTS = path.join(__dirname, 'shots')
fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(SHOTS, { recursive: true })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
// 卡片在動，Playwright 的 hover 會等「穩定」等到逾時，改用座標移到消息區中間。
async function hoverZone(page) {
  const box = await page.locator('.hn-viewport, .hn-cards').first().boundingBox()
  await page.mouse.move(box.x + box.width * 0.3, box.y + 80)
}

;(async () => {
  const browser = await chromium.launch({ channel: 'chrome' })
  const report = []
  for (const width of [1440, 1024]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 })
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    for (const v of ['a', 'b', 'c']) {
      await page.goto(`${BASE}?v=${v}`)
      await page.mouse.move(5, 5)
      await page.waitForLoadState('networkidle')
      const section = page.locator('.home-news')
      const tx = () => page.evaluate(() => getComputedStyle(document.querySelector('.hn-track') || document.body).transform)
      await wait(300)
      await section.screenshot({ path: `${OUT}/${v}-${width}-0.png` })
      const before = await tx()
      if (v === 'a') {
        await wait(2500)
        await section.screenshot({ path: `${OUT}/${v}-${width}-drift.png` })
        const after = await tx()
        // 滑鼠停在卡片上 1.5 秒後應該停住
        await hoverZone(page)
        await wait(1500)
        const h1 = await tx(); await wait(600); const h2 = await tx()
        report.push({ width, v, moved: before !== after, pausedOnHover: h1 === h2 })
        await page.mouse.move(5, 5)
      } else {
        const interval = v === 'b' ? 4500 : 6000
        await wait(interval + 2200)
        await section.screenshot({ path: `${OUT}/${v}-${width}-after.png` })
        const count = await page.textContent('.hn-count')
        const titles = await page.$$eval('.hn-card:not([aria-hidden]) h3', (els) => els.filter((el) => { const r = el.getBoundingClientRect(); return r.right > 0 && r.left < innerWidth && getComputedStyle(el.closest('.hn-card')).opacity !== '0' }).map((el) => el.textContent))
        // 停住：hover 後倒數不再增加
        await hoverZone(page)
        const w1 = await page.evaluate(() => document.querySelector('.hn-progress b').style.transform); await wait(800)
        const w2 = await page.evaluate(() => document.querySelector('.hn-progress b').style.transform)
        report.push({ width, v, count, titles, pausedOnHover: w1 === w2 })
        await page.mouse.move(5, 5)
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
      report[report.length - 1].overflow = overflow
    }
    report.push({ width, errors })
    await page.close()
  }
  // 轉場逐格：等轉場動畫都建立（C 要三格都有新圖）就全部暫停，再把 currentTime（含 delay）撥到同一個時間點拍。
  // 不用 CDP Animation.setPlaybackRate：它會把已在跑的動畫時間倒退，C 的三格會錯開。
  const { execFileSync } = require('child_process')
  for (const v of ['b', 'c']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(`${BASE}?v=${v}`)
    await page.mouse.move(5, 5)
    await page.waitForFunction((v) => {
      const anims = document.getAnimations().filter((a) => a.effect?.target?.closest?.('.hn-news'))
      const ready = v === 'b' ? anims.length > 0 : document.querySelectorAll('.hn-cards img').length === 6 && anims.length >= 15
      if (ready) anims.forEach((a) => a.pause())
      return ready
    }, v, { polling: 'raf', timeout: 15000 })
    const frames = []
    for (const t of [0, 250, 500, 750, 1100, 1800]) {
      await page.evaluate((t) => document.getAnimations().filter((a) => a.effect?.target?.closest?.('.hn-news')).forEach((a) => { a.currentTime = t }), t)
      const file = `${OUT}/${v}-strip-${t}.png`
      await page.locator('.hn-news').screenshot({ path: file })
      frames.push(file)
    }
    execFileSync('python3', ['-c', `import sys\nfrom PIL import Image\nims=[Image.open(f) for f in sys.argv[2:]]\nw,h=ims[0].size\nout=Image.new('RGB',(w,h*len(ims)))\n[out.paste(im,(0,h*i)) for i,im in enumerate(ims)]\nout.save(sys.argv[1], quality=82, optimize=True)`, `${SHOTS}/${v}-strip.jpg`, ...frames])
    await page.close()
  }
  // 比較頁全頁
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto(BASE)
  await page.waitForLoadState('networkidle')
  await page.screenshot({ path: `${OUT}/index-1440.png`, fullPage: true })
  await browser.close()
  for (const f of ['a-1440-drift', 'b-1440-after', 'c-1440-0', 'c-1440-after', 'a-1024-drift']) fs.copyFileSync(`${OUT}/${f}.png`, `${SHOTS}/${f}.png`)
  console.log(JSON.stringify(report, null, 1))
})()
