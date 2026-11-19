import { test, expect, type Page } from '@playwright/test'

test.use({ reducedMotion: 'no-preference' })

const chapters = ['care', 'spaces', 'meals', 'campuses']
const pinEnabled = (page: Page) => page.evaluate(() => matchMedia('(min-width: 1100px) and (min-height: 600px)').matches)
const progress = (page: Page, name: string) => page.locator('.renv-hero-stage').evaluate((el, key) => Number((el as HTMLElement).style.getPropertyValue(key)), name)

async function ready(page: Page) {
  await expect(page.locator('html')).toHaveClass(/renv-fx/)
  await expect(page.locator('.renv')).toHaveAttribute('data-windows-ready', 'true')
  await page.evaluate(() => document.fonts.ready)
  await manifestReady(page)
}

async function manifestReady(page: Page) {
  if (process.env.E2E_ENVIRONMENT_BUILD !== '1') return
  // Nuxt 正式版在 ready 後預抓 manifest。先等這個請求完成，避免極快轉頁造成 WebKit 的 abort 錯誤。
  await page.waitForFunction(() => performance.getEntriesByType('resource')
    .some(entry => /\/_nuxt\/builds\/meta\/[^/]+\.json(?:\?|$)/.test(entry.name)))
}

async function expectChapter(page: Page, id: string) {
  await expect.poll(() => page.locator(`#${id}`).evaluate(async el => {
    // 落點必須連續幾次繪製都正確，不能剛好在原生 hash 與 Router 還原中間通過。
    let error = 0
    for (let frame = 0; frame < 6; frame++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const padding = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0
      error = Math.max(error, Math.abs(el.getBoundingClientRect().top - padding))
    }
    return error
  })).toBeLessThanOrEqual(3)
}

async function expectPosition(page: Page, y: number) {
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(y, -1)
}

test.beforeEach(async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (/hydration/i.test(message.text())) errors.push(message.text())
  })
  // 每次操作結束再查，讓轉頁卸載或重新掛載的錯誤也會讓測試失敗。
  ;(page as Page & { environmentErrors: string[] }).environmentErrors = errors
})

test.afterEach(async ({ page }) => {
  expect((page as Page & { environmentErrors: string[] }).environmentErrors).toEqual([])
})

test('捲動打開首屏、返回頂端收回；六站按鈕與鍵盤真的切換照片和文字', async ({ page }) => {
  test.skip(!(await pinEnabled(page)), '釘住舞台只在桌機大視窗啟用')
  await page.goto('/environment')
  await ready(page)
  await expect.poll(() => progress(page, '--q')).toBe(1)
  await page.mouse.wheel(0, 850)
  await expect.poll(() => progress(page, '--q')).toBeLessThan(0.02)
  await expect.poll(() => progress(page, '--qt')).toBeLessThan(0.002)
  await page.keyboard.press('ControlOrMeta+Home')
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
  await expect.poll(() => progress(page, '--q')).toBe(1)
  await expect.poll(() => progress(page, '--qt')).toBe(1)

  const buttons = page.locator('.renv-stops-nav').getByRole('button')
  await buttons.first().scrollIntoViewIfNeeded()
  for (const index of [2, 5, 0]) {
    await buttons.nth(index).click()
    await expect(buttons.nth(index)).toHaveAttribute('aria-current', 'true')
    await expect(page.locator('.renv-stop-tx').nth(index)).toHaveCSS('opacity', '1')
    await expect(page.locator('.renv-stop .renv-win').nth(index)).toHaveCSS('opacity', '1')
  }
  await buttons.nth(1).focus()
  await page.keyboard.press('Enter')
  await expect(buttons.nth(1)).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('.renv-stop-tx').nth(1)).toHaveCSS('opacity', '1')
})

test('首屏四個章節連結落點正確，跳完會清除平滑捲動設定', async ({ page }) => {
  await page.goto('/environment')
  await ready(page)
  for (const id of chapters) {
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
    await page.locator(`.renv-index a[href="#${id}"]`).click()
    await expect(page).toHaveURL(new RegExp(`#${id}$`))
    await expectChapter(page, id)
    await expect.poll(() => page.evaluate(() => document.documentElement.style.scrollBehavior)).toBe('')
  }
})

for (const id of chapters) {
  test(`直接開啟 #${id}，重新整理保留後續捲動的位置`, async ({ page }) => {
    await page.goto(`/environment#${id}`)
    await ready(page)
    await expectChapter(page, id)
    await page.evaluate(() => scrollBy({ top: 220, behavior: 'instant' }))
    const y = await page.evaluate(() => scrollY)
    await page.reload()
    await ready(page)
    await expectPosition(page, y)
  })
}

test('沒有 hash 的頁尾重新整理、整頁上一頁與 SPA 上一頁保留位置', async ({ page }) => {
  await page.goto('/environment')
  await ready(page)
  await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight - innerHeight - 60, behavior: 'instant' }))
  const y = await page.evaluate(() => scrollY)
  await page.reload()
  await ready(page)
  await expectPosition(page, y)
  await page.goto('/news')
  await page.waitForFunction(() => Boolean((document.querySelector('#__nuxt') as { __vue_app__?: unknown } | null)?.__vue_app__))
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page.evaluate(() => document.fonts.ready)
  await manifestReady(page)
  await page.goBack()
  await ready(page)
  await expectPosition(page, y)
  const next = page.locator('.renv-next').getByRole('link', { name: /特色教學/ })
  await next.scrollIntoViewIfNeeded()
  const beforeSpa = await page.evaluate(() => scrollY)
  await next.click()
  await expect(page).toHaveURL(/\/curriculum$/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.locator('html')).not.toHaveClass(/renv-(pin|fx)/)
  await page.goBack()
  await ready(page)
  await expectPosition(page, beforeSpa)
})

test('五校分頁鍵盤、角落換大窗、下一所與記住的校區', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'ivy_campus', value: 'renwu', url: baseURL! }])
  await page.goto('/environment?campus=chongde#campuses')
  await ready(page)
  await expectChapter(page, 'campuses')
  const tabs = page.getByRole('tablist', { name: '選一所校園' })
  const selected = tabs.locator('[aria-selected="true"]')
  await expect(selected).toHaveAttribute('id', 'tour-tab-chongde')
  await selected.focus()
  for (const [key, campus] of [['ArrowRight', 'international'], ['End', 'renwu'], ['ArrowRight', 'yihua'], ['ArrowLeft', 'renwu'], ['Home', 'yihua']]) {
    await page.keyboard.press(key!)
    await expect(selected).toHaveAttribute('id', `tour-tab-${campus}`)
    await expect(selected).toBeFocused()
    await expect(page.getByRole('tabpanel')).toHaveCount(1)
  }
  if ((page.viewportSize()?.width ?? 0) > 900) {
    const panel = page.getByRole('tabpanel')
    await panel.getByRole('button', { name: '共創教室', exact: true }).click()
    await expect(panel.getByRole('button', { name: '共創教室', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(panel.locator('.renv-scene-n').first()).toHaveText('共創教室')
  }
  await page.getByRole('tabpanel').getByRole('button', { name: /下一所/ }).click()
  await expect(selected).toHaveAttribute('id', 'tour-tab-minghua')
  expect((await context.cookies()).find(cookie => cookie.name === 'ivy_campus')?.value).toBe('yihua')
  await page.goto('/environment#campuses')
  await ready(page)
  await expect(selected).toHaveAttribute('id', 'tour-tab-yihua')
})

test('切換減少動態與視窗尺寸後，內容完整且不水平溢出', async ({ page }) => {
  await page.goto('/environment#meals')
  await ready(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.locator('html')).not.toHaveClass(/renv-(pin|fx)/)
  await expectChapter(page, 'meals')
  await expect(page.locator('.renv-door.is-shut')).toHaveCount(0)
  await expect(page.locator('.renv-stop-tx')).toHaveCount(6)
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await ready(page)
  await expectChapter(page, 'meals')
  if ((page.viewportSize()?.width ?? 0) < 1100) return
  for (const size of [{ width: 1280, height: 720 }, { width: 1100, height: 600 }, { width: 820, height: 1180 }, { width: 320, height: 640 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(size)
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1)
    await expect(page.locator('html')).toHaveClass(size.width >= 1100 ? /renv-pin/ : /^(?!.*renv-pin)/)
  }
})


test('同頁章節的上一頁還原離開位置，下一頁回到新章節', async ({ page }) => {
  await page.goto('/environment#care')
  await ready(page)
  await expectChapter(page, 'care')
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }))
  const link = page.locator('.renv-index a[href="#meals"]')
  await link.scrollIntoViewIfNeeded()
  const y = await page.evaluate(() => scrollY)
  await link.click()
  await expectChapter(page, 'meals')
  await page.goBack()
  await expect(page).toHaveURL(/#care$/)
  await expectPosition(page, y)
  await page.goForward()
  await expectChapter(page, 'meals')
})

test('捲動模組晚到，直接章節連結仍等釘住版面就緒再定位', async ({ page }) => {
  let release!: () => void
  let intercepted = false
  const held = new Promise<void>(resolve => { release = resolve })
  // 開發版有模組名，正式版只剩 hash；用模組內容辨認正式檔，確實延後它送到瀏覽器的時間。
  await page.route(/environment-windows[.\-]|\/_nuxt\/[\w-]+\.js(?:\?|$)/, async route => {
    if (/environment-windows[.\-]/.test(route.request().url())) {
      intercepted = true
      await held
      await route.continue()
      return
    }
    const response = await route.fetch()
    const source = await response.text()
    if (source.includes('ivy:environment-scroll:') && source.includes('renv-hero-stage')) {
      intercepted = true
      await held
    }
    await route.fulfill({ response })
  })
  try {
    await page.goto('/environment#meals', { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#meals')).toBeAttached()
    await expect.poll(() => intercepted).toBe(true)
  } finally {
    release()
  }
  await ready(page)
  await expectChapter(page, 'meals')
})

test('重新整理時圖片晚到，原生章節定位不會覆蓋離開位置', async ({ page }) => {
  let delayImage = false
  let release!: () => void
  let intercepted = false
  const held = new Promise<void>(resolve => { release = resolve })
  // WebKit 重整可能沿用原照片的記憶體快取；加一張不改版面的圖片，確保真的延後 load。
  await page.route('**/environment', async route => {
    if (!delayImage) return route.continue()
    const response = await route.fetch()
    const body = (await response.text()).replace('</body>', '<img src="/__e2e_environment_late_image.svg" alt="" width="1" height="1" style="position:absolute;top:0;left:0;opacity:0;pointer-events:none" /></body>')
    await route.fulfill({ response, body })
  })
  await page.route('**/__e2e_environment_late_image.svg', async route => {
    intercepted = true
    await held
    await route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" />' })
  })
  await page.goto('/environment#meals')
  await ready(page)
  await expectChapter(page, 'meals')
  await page.evaluate(() => scrollBy({ top: 220, behavior: 'instant' }))
  const y = await page.evaluate(() => scrollY)
  delayImage = true
  try {
    await page.reload({ waitUntil: 'domcontentloaded' })
    // WebKit 的 document.fonts.ready 可能一起等 load，此處只等模組已完成版面。
    await expect(page.locator('.renv')).toHaveAttribute('data-windows-ready', 'true')
    await expect.poll(() => intercepted).toBe(true)
    // 讓 Router 的版面穩定檢查有機會先結束；圖片仍在等，文件還沒 load。
    await page.evaluate(async () => {
      for (let i = 0; i < 8; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    })
    expect(await page.evaluate(() => document.readyState)).not.toBe('complete')
  } finally { release() }
  await page.waitForLoadState('load')
  await expectPosition(page, y)
})
