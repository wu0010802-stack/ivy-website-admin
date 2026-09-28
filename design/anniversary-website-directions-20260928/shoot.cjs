// 30 週年比稿截圖：node design/anniversary-website-directions-20260928/shoot.cjs [id ...]
// 先在 repo 根目錄起 python3 -m http.server 8770 --bind 127.0.0.1。
// 讀同目錄 shots.json：[{ "id": "a-mark", "variants": ["a","b"], "full": true }]，
// 每頁每個變體拍 1440×900 與 390×844（2x）首屏，full 為 true 時另拍整頁。
// 輸出 shots/<id>[-<v>]-{desktop,phone}[-full].webp（先拍 PNG 再用 Pillow 轉 WebP，ffmpeg 沒有 libwebp）；
// 順手檢查 4xx、page error、水平溢出。需要 python3 + Pillow。
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execFileSync } = require('child_process')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'anni-shots-'))
// 首屏維持原尺寸 q82；整頁截圖縮小以控制 repo 體積：桌機縮到 960 寬、手機縮到 390 寬（1x），q72。
// WebP 單邊上限 16383px，縮完仍超過就再等比縮。
const SHRINK = [
  'import sys',
  'from PIL import Image',
  'src, dst, full, phone = sys.argv[1], sys.argv[2], sys.argv[3] == "1", sys.argv[4] == "1"',
  'im = Image.open(src).convert("RGB")',
  'w = (390 if phone else 960) if full else im.width',
  'k = min(1, w / im.width, 16383 / im.height)',
  'im = im.resize((round(im.width * k), round(im.height * k)), Image.LANCZOS) if k < 1 else im',
  'im.save(dst, "WEBP", quality=72 if full else 82, method=6)',
].join('\n')
function save(png, stem) {
  const src = path.join(TMP, stem + '.png')
  fs.writeFileSync(src, png)
  const full = stem.endsWith('-full') ? '1' : '0'
  const phone = stem.includes('-phone') ? '1' : '0'
  execFileSync('python3', ['-c', SHRINK, src, path.join(OUT, stem + '.webp'), full, phone])
}
const { chromium } = require(path.join(__dirname, '../../node_modules/playwright'))

const BASE = process.env.MOCK_BASE || 'http://127.0.0.1:8770/design/anniversary-website-directions-20260928/'
const OUT = path.join(__dirname, 'shots')
const CHROME = fs.existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
  ? { executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' }
  : { channel: 'chrome' }
const VIEWS = [
  ['desktop', { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 }],
  ['phone', { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
]

;(async () => {
  const pages = JSON.parse(fs.readFileSync(path.join(__dirname, 'shots.json'), 'utf8'))
  const only = process.argv.slice(2)
  fs.mkdirSync(OUT, { recursive: true })
  const browser = await chromium.launch(CHROME)
  let problems = 0
  for (const p of pages) {
    if (only.length && !only.includes(p.id)) continue
    for (const v of p.variants?.length ? p.variants : [null]) {
      for (const [view, opts] of VIEWS) {
        const ctx = await browser.newContext({ ...opts, reducedMotion: 'reduce' })
        const page = await ctx.newPage()
        const issues = []
        page.on('pageerror', e => issues.push('pageerror ' + e.message))
        page.on('response', r => { if (r.status() >= 400) issues.push(r.status() + ' ' + r.url()) })
        const url = BASE + p.id + '.html' + (v ? '?v=' + v : '')
        await page.goto(url, { waitUntil: 'networkidle' })
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(400)
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
        if (overflow > 0) issues.push('horizontal overflow ' + overflow + 'px')
        const stem = p.id + (v ? '-' + v : '') + '-' + view
        save(await page.screenshot(), stem)
        if (p.full) save(await page.screenshot({ fullPage: true }), stem + '-full')
        console.log((issues.length ? 'FAIL ' : 'ok   ') + stem + (issues.length ? '\n     ' + issues.join('\n     ') : ''))
        problems += issues.length
        await ctx.close()
      }
    }
  }
  await browser.close()
  process.exitCode = problems ? 1 : 0
})()
