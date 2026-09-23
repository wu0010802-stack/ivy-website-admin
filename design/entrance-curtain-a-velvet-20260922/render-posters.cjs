// Renders the first-paint curtain posters used by web/app/utils/entrance-policy.ts.
// Re-run after any change to the curtain's look (run build-preview.mjs first):
//   node design/entrance-curtain-a-velvet-20260922/build-preview.mjs
//   node design/entrance-curtain-a-velvet-20260922/render-posters.cjs
// then copy the printed ?v= hashes into ENTRANCE_POSTERS.
// Playwright is not a repo dependency; point PLAYWRIGHT_CORE at an npx cache copy if needed.
const { createServer } = require('node:http')
const { createHash } = require('node:crypto')
const { readFile, writeFile } = require('node:fs/promises')
const { readdirSync, existsSync } = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const root = path.resolve(__dirname, '../..')
const out = path.join(root, 'web/public/assets')
// One poster per valance swag count: the engine uses max(2, floor(aspect*2.4 + 0.5)).
// Folds and tie points are fractions of the viewport, so a stretched poster keeps
// the valance, tassels and hem in place anywhere inside its aspect band.
const posters = [
  { name: 'phone', width: 390, height: 844, dpr: 2 }, // aspect < 2/3 (folds fixed at 3.2 per panel)
  { name: 'portrait', width: 800, height: 1000, dpr: 1.5 }, // 2/3–25/24, 2 swags
  { name: 'landscape', width: 1280, height: 1024, dpr: 1.5 }, // 25/24–35/24, 3 swags
  { name: 'desktop', width: 1440, height: 900, dpr: 1.5 }, // 35/24–15/8, 4 swags
  { name: 'wide', width: 1760, height: 800, dpr: 1.5 } // ≥ 15/8, 5 swags
]
const types = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.woff2': 'font/woff2' }

function findPlaywright() {
  if (process.env.PLAYWRIGHT_CORE) return process.env.PLAYWRIGHT_CORE
  const npx = path.join(os.homedir(), '.npm/_npx')
  for (const dir of existsSync(npx) ? readdirSync(npx) : []) {
    const candidate = path.join(npx, dir, 'node_modules/playwright-core')
    if (existsSync(candidate)) return candidate
  }
  throw new Error('playwright-core not found; set PLAYWRIGHT_CORE')
}

;(async () => {
  const { chromium } = require(findPlaywright())
  const server = createServer(async (req, res) => {
    const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname))
    if (!file.startsWith(root)) { res.writeHead(403).end(); return }
    let body
    try { body = await readFile(file) } catch { res.writeHead(404).end(); return }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' }).end(body)
  }).listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  // Metal keeps the look identical to what Macs and iPhones render; SwiftShader drifts.
  const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] })
  try {
    for (const poster of posters) {
      const page = await browser.newPage({ viewport: { width: poster.width, height: poster.height }, deviceScaleFactor: poster.dpr })
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto(`${base}/design/entrance-curtain-a-velvet-20260922/poster.html`)
      await page.waitForSelector('body[data-done]', { timeout: 20000 })
      if (errors.length) throw new Error(errors.join('\n'))
      const png = await page.screenshot()
      const webp = await page.evaluate(async dataUrl => {
        const image = new Image()
        image.src = dataUrl
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = image.naturalWidth
        canvas.height = image.naturalHeight
        canvas.getContext('2d').drawImage(image, 0, 0)
        return canvas.toDataURL('image/webp', 0.72)
      }, `data:image/png;base64,${png.toString('base64')}`)
      const bytes = Buffer.from(webp.split(',')[1], 'base64')
      const file = `entrance-poster-${poster.name}.webp`
      await writeFile(path.join(out, file), bytes)
      const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 8)
      console.log(`${poster.name.padEnd(9)} ${file}?v=${hash}  ${(bytes.length / 1024).toFixed(1)} KB`)
      await page.close()
    }
  } finally {
    await browser.close()
    server.close()
  }
})().catch(error => { console.error(error); process.exit(1) })
