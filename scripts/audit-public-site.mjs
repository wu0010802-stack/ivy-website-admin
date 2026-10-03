// 公開官網唯讀檢查（docs/analysis/2026-09-30-award-quality-report.md 的重跑工具）：
//   node scripts/audit-public-site.mjs <routes|home|targets|lcp> …
// 環境變數：AUDIT_BASE（預設線上 Railway 網址）、AUDIT_OUT（預設 output/playwright/audit-<模式>-<時間>）、
//   lcp 模式另有 AUDIT_RUNS（預設 3）、AUDIT_DOWNLINK（覆寫 navigator.connection.downlink，Mbps）。
// 所有非 GET／HEAD／OPTIONS 請求一律擋下：不送預約、也不把 /api/telemetry 的合成瀏覽寫進正式站。
import { chromium } from 'playwright-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const base = (process.env.AUDIT_BASE ?? 'https://web-production-04caa.up.railway.app').replace(/\/$/, '')
const modes = process.argv.slice(2)
const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
const out = path.resolve(repo, process.env.AUDIT_OUT ?? `output/playwright/audit-${modes.join('-')}-${stamp}`)
const DESKTOP = { name: 'desktop', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false }
const MOBILE = { name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
const ROUTES = ['/', '/about', '/curriculum', '/environment', '/admission', '/news', '/visit']

const blocked = []
async function openContext(browser, device, { routePattern = '**/*', ...options } = {}) {
  const context = await browser.newContext({ ...device, deviceScaleFactor: 1, ...options })
  await context.route(routePattern, route => {
    const request = route.request()
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method())) return route.continue()
    blocked.push(`${request.method()} ${new URL(request.url()).pathname}`)
    return route.abort()
  })
  return context
}
const save = (name, data) => fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 2))
// 不用 page.screenshot：它會等 document.fonts 全部載完，本站字型分片隨捲動陸續載入，常等到逾時。
async function shot(page, name) {
  const cdp = await page.context().newCDPSession(page)
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(out, name), Buffer.from(data, 'base64'))
  await cdp.detach()
}

// 12 個公開路由 × 桌機／手機，外加 320／768 寬：HTTP 狀態、水平溢出、可見破圖、pageerror。
async function routes(browser) {
  const result = []
  const devices = [DESKTOP, MOBILE,
    { name: 'width-320', viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true, only: ['/', '/about', '/curriculum', '/environment', '/admission', '/visit'] },
    { name: 'width-768', viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true, only: ['/', '/about', '/curriculum', '/environment', '/admission', '/visit'] }]
  for (const { only, ...device } of devices) {
    const context = await openContext(browser, device)
    const page = await context.newPage()
    for (const route of only ?? ROUTES) {
      const errors = []
      page.removeAllListeners('pageerror')
      page.on('pageerror', error => errors.push(error.message))
      const response = await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 60000 })
      await page.waitForTimeout(route === '/' ? 8000 : 800)
      const state = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth - innerWidth,
        brokenImages: [...document.images].filter(img => img.complete && img.currentSrc && img.naturalWidth === 0
          && img.getBoundingClientRect().width > 0).map(img => img.currentSrc)
      }))
      result.push({ device: device.name, route, status: response.status(), ...state, pageErrors: errors })
      if (only === undefined && (route === '/' || route === '/about' || route === '/visit')) {
        await shot(page, `${device.name}-${route === '/' ? 'home' : route.slice(1)}-top.png`)
      }
    }
    await context.close()
  }
  save('routes.json', result)
  const problems = result.filter(r => r.status !== 200 || r.overflow > 1 || r.brokenImages.length || r.pageErrors.length)
  console.log(`routes：${result.length} 組，異常 ${problems.length} 組`, problems)
}

// 首頁到「分校資訊」的距離，以及首屏／頁首有沒有直達分校的入口。
async function home(browser) {
  const result = []
  for (const device of [DESKTOP, MOBILE]) {
    const context = await openContext(browser, device)
    const page = await context.newPage()
    await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(8000)
    await shot(page, `${device.name}-home-top.png`)
    result.push({ device: device.name, ...await page.evaluate(() => {
      const top = el => el ? Math.round(el.getBoundingClientRect().top + scrollY) : null
      const heading = [...document.querySelectorAll('h2')].find(h => h.textContent.includes('分校資訊'))
      const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < innerHeight && getComputedStyle(el).visibility !== 'hidden' }
      const toCampuses = [...document.querySelectorAll('a[href]')].filter(a => /#campuses|\/campuses\b/.test(a.getAttribute('href')))
      return {
        scrollHeight: document.documentElement.scrollHeight,
        campusesTop: top(document.getElementById('campuses')),
        campusHeadingTop: top(heading),
        screensToHeading: heading ? +(top(heading) / innerHeight).toFixed(1) : null,
        heroLinksToCampuses: [...document.querySelectorAll('.studio-hero a[href]')].map(a => ({ text: a.textContent.trim(), href: a.getAttribute('href') })),
        firstScreenLinksToCampuses: toCampuses.filter(visible).map(a => ({ text: a.textContent.trim() || a.getAttribute('aria-label'), href: a.getAttribute('href') }))
      }
    }) })
    await context.close()
  }
  save('home.json', result)
  console.log(JSON.stringify(result, null, 2))
}

// 手機觸控範圍：每個小於 44px 的控制項捲到畫面中央後量三種尺寸——
// layout（offsetWidth／Height，不受 transform 影響，即設計尺寸）、visual（當下畫面上的外框）、
// hit（從中心往四邊用 elementFromPoint 探到的實際可點範圍，含透明偽元素擴張），並記下祖先的縮放。
async function targets(browser) {
  const result = []
  const context = await openContext(browser, MOBILE)
  const page = await context.newPage()
  for (const route of ['/', '/about', '/visit']) {
    await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(route === '/' ? 8000 : 1200)
    const count = await page.evaluate(() => {
      const items = [...document.querySelectorAll('button, a[href], summary, select, input:not([type=hidden])')]
        .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert],[hidden]') })
      // 載入當下的外框或版面尺寸任一小於 44 就列入（外框會受轉場縮放影響，所以兩個都看）。
      const small = items.filter(el => { const r = el.getBoundingClientRect(); return Math.min(r.width, r.height, el.offsetWidth, el.offsetHeight) < 44 })
      small.forEach((el, i) => {
        const r = el.getBoundingClientRect()
        el.setAttribute('data-audit-target', i)
        el.setAttribute('data-audit-load', `${Math.round(r.width)}×${Math.round(r.height)}`)
      })
      return small.length
    })
    for (let i = 0; i < count; i++) {
      const handle = page.locator(`[data-audit-target="${i}"]`)
      const layout = await handle.evaluate(el => ({ w: el.offsetWidth, h: el.offsetHeight }))
      await handle.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
      await page.waitForTimeout(500)
      result.push({ route, ...await handle.evaluate((el, layoutSize) => {
        const r = el.getBoundingClientRect()
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        const hits = (x, y) => { const at = document.elementFromPoint(x, y); return !!at && (at === el || el.contains(at)) }
        const reach = (dx, dy) => { let d = 0; while (d < 40 && hits(cx + dx * (d + 1), cy + dy * (d + 1))) d++; return d }
        let scale = 1
        for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
          const t = getComputedStyle(node).transform
          if (t && t !== 'none') { const m = new DOMMatrixReadOnly(t); scale *= Math.hypot(m.a, m.b) }
        }
        return {
          name: (el.getAttribute('aria-label') || el.textContent || el.getAttribute('name') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40),
          tag: el.tagName.toLowerCase(),
          layout: layoutSize,
          visualAtLoad: el.getAttribute('data-audit-load'),
          visual: { w: Math.round(r.width), h: Math.round(r.height) },
          hit: hits(cx, cy) ? { w: reach(-1, 0) + reach(1, 0) + 1, h: reach(0, -1) + reach(0, 1) + 1 } : null,
          ancestorScale: +scale.toFixed(3)
        }
      }, layout) })
    }
  }
  await context.close()
  save('targets.json', result)
  for (const t of result) console.log(`${t.route}\t${t.name}\tlayout ${t.layout.w}×${t.layout.h}\t載入時 ${t.visualAtLoad}\tvisual ${t.visual.w}×${t.visual.h}\thit ${t.hit ? `${t.hit.w}×${t.hit.h}` : '被遮住'}\tscale ${t.ancestorScale}`)
}

// 慢速手機首頁 LCP：390×844、冷快取、1.6 Mbps／750 Kbps、150 ms、CPU 4×（同 Lighthouse 慢速 4G）。
// 記下 LCP 元素的 url 與尺寸、封面與影片外框、瀏覽器回報的 navigator.connection。
async function lcp(browser) {
  const vitals = fs.readFileSync(path.join(repo, 'web/node_modules/web-vitals/dist/web-vitals.iife.js'), 'utf8')
  const downlink = process.env.AUDIT_DOWNLINK ? Number(process.env.AUDIT_DOWNLINK) : null
  const result = []
  for (let run = 1; run <= Number(process.env.AUDIT_RUNS ?? 3); run++) {
    // 只攔 /api/：靜態資源不經 route，避免攔截本身拖慢量測。
    const context = await openContext(browser, MOBILE, { routePattern: '**/api/**' })
    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1_600_000 / 8, uploadThroughput: 750_000 / 8 })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    if (downlink !== null) {
      await page.addInitScript(value => {
        const connection = { downlink: value, effectiveType: '4g', rtt: 150, saveData: false, addEventListener() {}, removeEventListener() {} }
        Object.defineProperty(Navigator.prototype, 'connection', { get: () => connection, configurable: true })
      }, downlink)
    }
    await page.addInitScript(`${vitals};window.__audit={lcp:[]};
      window.__audit.connectionAtStart=navigator.connection&&{downlink:navigator.connection.downlink,effectiveType:navigator.connection.effectiveType};
      webVitals.onLCP(m=>{for(const e of m.entries){const r=e.element&&e.element.getBoundingClientRect();window.__audit.lcp.push({time:Math.round(e.startTime),tag:e.element&&e.element.tagName,url:(e.url||'').split('/').pop(),size:e.size,box:r&&[Math.round(r.width),Math.round(r.height)]})}},{reportAllChanges:true});
      webVitals.onCLS(m=>{window.__audit.cls=m.value},{reportAllChanges:true});`)
    await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(13000)
    const record = await page.evaluate(() => {
      const box = el => el && (r => [Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10])(el.getBoundingClientRect())
      const hero = document.querySelector('.studio-hero-image')
      return {
        ...window.__audit,
        connectionAtEnd: navigator.connection && { downlink: navigator.connection.downlink, effectiveType: navigator.connection.effectiveType },
        fcp: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0),
        heroPosterBox: box(hero?.querySelector('img')),
        heroVideoBox: box(hero?.querySelector('video')),
        heroVideo: hero?.querySelector('video') && { src: hero.querySelector('video').currentSrc.split('/').pop(), paused: hero.querySelector('video').paused },
        largeResources: performance.getEntriesByType('resource').filter(e => e.transferSize > 100000)
          .map(e => ({ name: e.name.split('/').pop(), bytes: e.transferSize, start: Math.round(e.startTime), end: Math.round(e.responseEnd) }))
      }
    })
    result.push({ run, downlinkOverride: downlink, ...record })
    const last = record.lcp.at(-1)
    console.log(`run ${run}: FCP ${record.fcp} ms、LCP ${last?.time} ms（${last?.tag} ${last?.url || ''} ${last?.box}）、downlink ${record.connectionAtStart?.downlink}→${record.connectionAtEnd?.downlink}`)
    await context.close()
  }
  save(`lcp${downlink === null ? '' : `-downlink-${downlink}`}.json`, result)
}

const jobs = { routes, home, targets, lcp }
if (!modes.length || modes.some(mode => !jobs[mode])) {
  console.error('用法：node scripts/audit-public-site.mjs <routes|home|targets|lcp> …')
  process.exit(1)
}
fs.mkdirSync(out, { recursive: true })
const browser = await chromium.launch({ channel: 'chrome' })
try {
  for (const mode of modes) await jobs[mode](browser)
} finally {
  await browser.close()
  save('blocked-requests.json', blocked)
  console.log(`輸出：${path.relative(repo, out)}；擋下 ${blocked.length} 個非 GET 請求`, [...new Set(blocked)])
}
