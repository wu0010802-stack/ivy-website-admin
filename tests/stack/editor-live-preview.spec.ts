import { expect, test, type Frame, type Page } from '@playwright/test'
import { answerMessageBox, gotoAdmin, openAs } from './pages'

// 2026-10-06 方向 D：內容編輯右側即時預覽。改欄位不用存檔，右邊的官網預覽就換掉、框出那一格；
// 沒存檔前公開資料不變；預覽頁只聽外層後台頁（同源、parent）的訊息；1280 以下沒有預覽欄。
// 這支用真瀏覽器跑 postMessage 往返（單元測試用的是假 iframe）。

const FRAME = 'iframe[title="官網預覽"]'
const LIVE_TEXT = '預覽的是還沒存的修改'

/** 預覽欄與預覽頁已連上：狀態列寫「預覽的是還沒存的修改」（握手完成、後台已送出第一則草稿）。 */
async function expectLive(page: Page): Promise<void> {
  const pane = page.getByRole('complementary', { name: '官網預覽' })
  await expect(pane.getByText(LIVE_TEXT)).toBeVisible({ timeout: 30_000 })
}

/**
 * 「這段時間內不該發生」的觀察窗：每 100ms 取樣一次，觀察到違規就失敗；窗口走完沒有違規才算過。
 * 不是固定等一下才看一眼，中途任何一刻出現就抓得到。
 */
async function holdsFor(page: Page, ms: number, label: string, check: () => Promise<boolean>): Promise<void> {
  const end = Date.now() + ms
  do {
    expect(await check(), label).toBe(true)
    await page.waitForTimeout(100)
  } while (Date.now() < end)
}

/** 預覽 iframe 的 Frame 物件。 */
async function previewFrame(page: Page): Promise<Frame> {
  const handle = await page.locator(FRAME).elementHandle()
  const frame = await handle?.contentFrame()
  if (!frame) throw new Error('找不到預覽 iframe 的 frame')
  return frame
}

/** 偽造的草稿訊息（格式同後台送的 v1 訊息）。 */
function forgedDraft(tagline: string, seq = 9999) {
  return {
    type: 'ivy-preview:draft',
    v: 1,
    seq,
    kind: 'site_footer',
    campusKey: null,
    payload: { tagline, copyright: '', bottom_note: '', campus_list_label: '' },
    page: 'home',
    focus: { block: 'site-footer', campusKey: null, probe: null, mark: true },
  }
}

test('頁尾文字：改標語，預覽即時換掉、框出那一格；沒有存檔、沒有公開、焦點與捲動留在後台', async ({ browser }) => {
  const { context, page } = await openAs(browser, 'super_admin')
  const saves: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/content-items/')) saves.push(request.url())
  })
  await gotoAdmin(page, '/content/site-footer', '頁尾文字')
  const pane = page.getByRole('complementary', { name: '官網預覽' })
  await expectLive(page)
  const frame = page.frameLocator(FRAME)
  await expect(frame.locator('footer.footer')).toBeVisible()

  const field = page.getByRole('textbox', { name: '標語' })
  const marker = `即時預覽測試 ${Date.now()}`
  const scrollBefore = await page.evaluate(() => window.scrollY)
  const startedAt = Date.now()
  await field.fill(marker)
  await expect(frame.locator('footer.footer')).toContainText(marker, { timeout: 5_000 })
  // 後台 debounce 300ms ＋ postMessage 往返＋官網重畫：不用存檔、約一秒內就換掉。時間只記錄、不當斷言
  // （機器忙的時候會間歇變慢）；斷言只有上面「5 秒內出現」。
  console.log(`[即時預覽] 改標語到預覽換字 ${Date.now() - startedAt}ms`)
  await expect(frame.locator('.preview-live-hit')).toContainText(marker)
  // 改了標語之後框的是那一段文字，不再框整個頁尾。
  await expect(frame.locator('footer.footer.preview-live-hit')).toHaveCount(0)
  await expect(page.locator('.editor__actions')).toContainText('草稿有 1 處修改：標語')
  // 狀態列說的是「預覽的是還沒存的修改」，不是「上次儲存的草稿」。
  await expect(pane.getByText(LIVE_TEXT)).toBeVisible()
  await expect(pane.getByText('預覽的是上次儲存的草稿')).toHaveCount(0)
  await expect(field).toBeFocused()
  // 焦點仍在後台輸入框、不在 iframe 裡；預覽頁的捲動沒有連帶捲動後台。
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('IFRAME')
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore)

  expect(saves).toEqual([])
  expect(await (await page.request.get('/api/public-site')).text()).not.toContain(marker)

  await page.getByRole('button', { name: '放棄修改' }).click()
  await answerMessageBox(page, '放棄 1 個欄位的修改？', '放棄修改')
  await expect(frame.locator('footer.footer')).not.toContainText(marker)
  await expect(frame.locator('.preview-live-hit')).not.toContainText(marker)
  await context.close()
})

test('五校介紹（義華）：改參觀專線，切到「頁尾」分頁看到新電話；首頁五校切到義華', async ({ browser }) => {
  const { context, page } = await openAs(browser, 'super_admin')
  await gotoAdmin(page, '/content/campus-profile?campus=yihua', '五校介紹')
  const pane = page.getByRole('complementary', { name: '官網預覽' })
  await expectLive(page)
  const frame = page.frameLocator(FRAME)
  await expect(frame.locator('#campus-tab-yihua')).toHaveAttribute('aria-selected', 'true')

  const phone = `07-${String(Date.now()).slice(-3)}-${String(Date.now()).slice(-7, -3)}`
  await page.getByRole('textbox', { name: '參觀專線' }).fill(phone)
  await pane.getByText('頁尾', { exact: true }).click()
  await expect(frame.locator('footer.footer')).toContainText(phone, { timeout: 5_000 })
  await expect(frame.locator('.preview-live-hit')).toContainText(phone)
  // 目錄上「基本資料」打點（和官網那一版不同）。
  await expect(page.getByRole('navigation', { name: '這一頁的段落' }).getByRole('link', { name: /基本資料/ })).toContainText('（和官網不同）')
  await page.getByRole('button', { name: '放棄修改' }).click()
  await answerMessageBox(page, '放棄 1 個欄位的修改？', '放棄修改')
  await context.close()
})

test('每個內容編輯頁的右側預覽都接得上；校園探索沒有預覽欄', async ({ browser }, testInfo) => {
  test.setTimeout(300_000)
  // [網址, 頁面標題, [預覽分頁文字, 預覽頁裡該分頁對應的區塊選擇器]]（區塊選擇器對照 web/app/utils/preview-live.ts 的 PREVIEW_BLOCKS）
  const EDITORS: [path: string, heading: string, tabs: [label: string, block: string][]][] = [
    ['/content/home-hero', '首頁大圖標語', [['首頁首屏', '.studio-hero']]],
    ['/content/home-about', '關於常春藤', [['首頁關於常春藤', '.home-belief']]],
    ['/content/day-experience', '孩子的一天', [['首頁孩子的一天', '.day-experience']]],
    ['/content/home-campus-board', '首頁五校區塊', [['首頁五校', '#campuses']]],
    ['/content/home-news', '最新消息與活動', [['首頁最新消息', '.home-news']]],
    ['/content/campus-profile?campus=yihua', '五校介紹', [['首頁五校', '#campuses'], ['頁尾', 'footer.footer']]],
    ['/content/campus-news?campus=yihua', '各校消息與活動', [['首頁最新消息', '.home-news']]],
    ['/content/booking-content', '預約文案', [['預約頁', '.booking-draft'], ['頁首預約鈕', 'header.header']]],
    ['/content/admission', '入學資訊頁', [['入學資訊頁', '#main']]],
    ['/content/privacy-policy', '隱私權政策', [['隱私權政策頁', '#main']]],
    ['/content/curriculum-page', '特色教學頁', [['特色教學頁', '#main']]],
    ['/content/about-page', '關於常春藤頁', [['關於常春藤頁', '#main']]],
    ['/content/site-footer', '頁尾文字', [['頁尾', 'footer.footer']]],
    ['/content/site-meta', '網站標題與電話', [['頁首', 'header.header']]],
  ]
  const { context, page } = await openAs(browser, 'super_admin')
  const frame = page.frameLocator(FRAME)
  for (const [path, heading, tabs] of EDITORS) {
    await test.step(path, async () => {
      await gotoAdmin(page, path, heading)
      const pane = page.getByRole('complementary', { name: '官網預覽' })
      await expectLive(page)
      for (const [label, block] of tabs) {
        // 多個分頁時要真的點過去：切分頁用訊息換、不重新載入，那一塊要在預覽頁裡畫得出來。
        if (tabs.length > 1) await pane.getByText(label, { exact: true }).click()
        else await expect(pane.getByText(label, { exact: true })).toBeVisible()
        await expect(frame.locator(block).first(), `${path}「${label}」的預覽區塊 ${block}`).toBeVisible({ timeout: 10_000 })
        await expect(pane.getByText(LIVE_TEXT)).toBeVisible()
      }
      await testInfo.attach(`預覽 ${path}`, { body: await page.screenshot(), contentType: 'image/png' })
      await page.screenshot({ path: `output/playwright/editor-live-${path.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}.png` })
    })
  }
  await gotoAdmin(page, '/content/campus-tour', '校園探索')
  await expect(page.getByRole('complementary', { name: '官網預覽' })).toHaveCount(0)
  await expect(page.locator(FRAME)).toHaveCount(0)
  await context.close()
})

test('1279 寬沒有預覽欄，保留「存草稿並預覽」；1280 寬長出預覽欄、再縮回收起', async ({ browser }) => {
  const { context, page } = await openAs(browser, 'super_admin', { viewport: { width: 1279, height: 900 } })
  await gotoAdmin(page, '/content/site-footer', '頁尾文字')
  await expect(page.getByRole('complementary', { name: '官網預覽' })).toHaveCount(0)
  await expect(page.locator(FRAME)).toHaveCount(0)
  await page.getByRole('textbox', { name: '標語' }).fill(`窄螢幕 ${Date.now()}`)
  await expect(page.getByRole('button', { name: '存草稿並預覽 ↗' })).toBeVisible()

  // 拉寬到 1280：預覽欄出現並接上；有未存修改時預覽的是修改後的標語（欄收起再出現會建新的 iframe）。
  await page.setViewportSize({ width: 1280, height: 900 })
  await expectLive(page)
  await expect(page.frameLocator(FRAME).locator('footer.footer')).toContainText('窄螢幕')

  // 再縮回 1279：預覽欄收起、iframe 一起拆掉，「存草稿並預覽」回來。
  await page.setViewportSize({ width: 1279, height: 900 })
  await expect(page.getByRole('complementary', { name: '官網預覽' })).toHaveCount(0)
  await expect(page.locator(FRAME)).toHaveCount(0)
  await expect(page.getByRole('button', { name: '存草稿並預覽 ↗' })).toBeVisible()
  await context.close()
})

test('/preview 即時模式：頂層、旁邊的 frame 送的訊息不套用；沒登入照舊拒絕；no-store、noindex、只給同源嵌', async ({ browser }) => {
  const { context, page } = await openAs(browser, 'super_admin')
  const response = await page.request.get('/preview?embed=1&live=1')
  expect(response.headers()['cache-control']).toBe('private, no-store')
  expect(response.headers()['x-robots-tag']).toContain('noindex')
  expect(response.headers()['x-frame-options']).toBe('SAMEORIGIN')
  expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'self'")

  // 頂層自己直接開 /preview?embed=1&live=1 再對自己 postMessage：window.parent === window，不認。
  // 假如被套用，預覽頁會回 applied 給 window.parent（就是自己），所以同時看畫面和有沒有收到回覆。
  await page.goto('/preview?embed=1&live=1')
  await expect(page.locator('footer.footer')).toBeVisible({ timeout: 30_000 })
  const replies = await page.evaluate(async (message) => {
    const seen: string[] = []
    window.addEventListener('message', (event) => {
      const type = (event.data as { type?: string } | null)?.type
      if (type) seen.push(type)
    })
    window.postMessage(message, location.origin)
    // 同一個視窗的訊息依序派送：等到後面的哨兵訊息，前面那則一定已被所有 listener 處理過；
    // 再等兩個動畫影格讓 Vue 把（假如被套用的）畫面更新完。這不是固定等待，是等「事件佇列走到這裡」。
    await new Promise<void>((resolve) => {
      const onSentinel = (event: MessageEvent) => {
        if (event.data === 'sentinel') {
          window.removeEventListener('message', onSentinel)
          resolve()
        }
      }
      window.addEventListener('message', onSentinel)
      window.postMessage('sentinel', location.origin)
    })
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return seen
  }, forgedDraft('頂層偽造的標語'))
  expect(replies).not.toContain('ivy-preview:applied')
  await expect(page.locator('footer.footer')).not.toContainText('頂層偽造的標語')
  await expect(page.locator('.preview-live-hit')).toHaveCount(0)
  await context.close()

  // 同源、但不是 parent：後台頁裡放一個同源的 about:blank frame，由它對預覽 iframe 送訊息。
  // event.origin 對、event.source 不是預覽頁的 parent，不能套用，也不能把序號墊高（seq 9999）擋掉後面真正的修改。
  const admin = await openAs(browser, 'super_admin')
  await gotoAdmin(admin.page, '/content/site-footer', '頁尾文字')
  await expectLive(admin.page)
  await admin.page.evaluate(() => {
    const other = document.createElement('iframe')
    other.id = 'sibling-sender'
    other.style.display = 'none'
    document.body.appendChild(other)
  })
  const sender = await (await admin.page.locator('#sibling-sender').elementHandle())!.contentFrame()
  expect(sender).not.toBeNull()
  await sender!.evaluate((message) => {
    const target = (window.parent.document.querySelector('iframe[title="官網預覽"]') as HTMLIFrameElement).contentWindow!
    // about:blank 的 location.origin 是 'null'；targetOrigin 要用外層後台頁的來源。
    target.postMessage(message, window.parent.location.origin)
  }, forgedDraft('旁邊的 frame 偽造的標語'))
  // 後面真正的修改（seq 比 9999 小）照常套用，就證明偽造的那則既沒套用、也沒把序號墊高。
  const real = `真的修改 ${Date.now()}`
  await admin.page.getByRole('textbox', { name: '標語' }).fill(real)
  const footer = admin.page.frameLocator(FRAME).locator('footer.footer')
  await expect(footer).toContainText(real, { timeout: 5_000 })
  await expect(footer).not.toContainText('旁邊的 frame 偽造的標語')
  // 對照：同一個格式的訊息由真正的 parent（後台頁自己）送，預覽頁就會套用——前面幾則沒被套用，是因為來源不對、不是格式不對。
  await admin.page.evaluate((message) => {
    const target = (document.querySelector('iframe[title="官網預覽"]') as HTMLIFrameElement).contentWindow!
    target.postMessage(message, location.origin)
  }, forgedDraft('後台頁自己送的標語', 99_999))
  await expect(footer).toContainText('後台頁自己送的標語', { timeout: 5_000 })
  await admin.context.close()

  const visitor = await openAs(browser, null)
  await visitor.page.goto('/preview?embed=1&live=1')
  await expect(visitor.page.getByText('這個頁面只給已登入的後台管理者看草稿內容。')).toBeVisible({ timeout: 30_000 })
  await visitor.context.close()
})

test('首頁五校：即時預覽停在被改的那一校，輪播不會自己轉走（開啟動態、等超過一個輪播週期）', async ({ browser }) => {
  test.setTimeout(120_000)
  const { context, page } = await openAs(browser, 'super_admin')
  // e2e 預設是「減少動態」，輪播根本不會自己轉；這一則要開動態，才抓得到輪播自己轉走。
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await gotoAdmin(page, '/content/campus-profile?campus=minghua', '五校介紹')
  await expectLive(page)
  const frame = page.frameLocator(FRAME)
  // 桌機寬度：五校整塊在 900 高的虛擬視窗裡看得到，輪播才會真的開始播（手機寬度的五校區塊比視窗高，
  // 框到地址時輪播的進入畫面條件不成立，本來就不會自己轉，測不出東西）。
  await page.getByRole('complementary', { name: '官網預覽' }).getByRole('radio', { name: '桌機' }).check({ force: true })
  const marker = `明華測試 ${Date.now()}`
  await page.getByRole('textbox', { name: '地址' }).fill(marker)
  // 預設的第一校不是明華；預覽切到明華那一校、框出新地址。
  const minghuaTab = frame.locator('#campus-tab-minghua')
  await expect(minghuaTab).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 })
  await expect(frame.locator('.preview-live-hit')).toContainText(marker)
  // 暫停鈕是「開始」：輪播被預覽頁按停了。
  await expect(frame.locator('#campuses .campus-playback')).toHaveAttribute('aria-label', '開始分校自動播放')
  // 超過一個輪播週期（量到第一次自動換校約 9 秒：先畫線稿、再 4 秒計時）：整段時間每 100ms 看一次，
  // 中途轉走就失敗。12 秒比最長的一次換校間隔還長。
  await holdsFor(page, 12_000, '輪播自己轉走了：被改的那一校不是目前選取的分頁', async () => (await minghuaTab.getAttribute('aria-selected')) === 'true')
  await expect(frame.locator('.preview-live-hit')).toContainText(marker)

  // 對照：把輪播重新開始播放，同一個 iframe 裡它真的會轉走——前面停住是因為預覽頁按了暫停，不是輪播本來就不轉。
  // 用 DOM 的 click()：真的點會讓鈕取得焦點，輪播的「焦點在裡面就暫停」規則又把它停住。
  await frame.locator('#campuses .campus-playback').evaluate((el) => (el as HTMLElement).click())
  await expect(frame.locator('#campuses .campus-playback')).toHaveAttribute('aria-label', '暫停分校自動播放')
  await expect(minghuaTab).toHaveAttribute('aria-selected', 'false', { timeout: 30_000 })
  await context.close()
})

// 2026-10-07 最終審查 I1：首頁五校的「預約參觀」在開啟動態的 Chromium 會自己 navigateTo（照片接續換頁），
// 不經過連結點擊，預覽頁攔連結的 handler 攔不到：iframe 被帶到真的預約頁、預覽的 listener 拆掉、之後的修改全被丟掉，
// 後台卻還寫「預覽的是還沒存的修改」。e2e 預設是「減少動態」不會走這條路，所以這一則要開動態。
test('首頁五校：開啟動態時點預覽裡的「預約參觀」不會把預覽帶離 /preview，之後的修改照常送進預覽', async ({ browser }) => {
  test.setTimeout(120_000)
  const { context, page } = await openAs(browser, 'super_admin')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await gotoAdmin(page, '/content/campus-profile?campus=minghua', '五校介紹')
  await expectLive(page)
  const pane = page.getByRole('complementary', { name: '官網預覽' })
  await pane.getByRole('radio', { name: '桌機' }).check({ force: true })
  const frame = page.frameLocator(FRAME)
  await expect(frame.locator('#campus-tab-minghua')).toHaveAttribute('aria-selected', 'true', { timeout: 10_000 })
  // 前提：預覽頁真的會走照片接續換頁（有 View Transition、沒開減少動態），否則這一則測不到那條路。
  const inner = await previewFrame(page)
  expect(await inner.evaluate(() => typeof (document as unknown as { startViewTransition?: unknown }).startViewTransition === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches), '預覽頁的動態沒開，測不到照片接續換頁').toBe(true)

  const booking = frame.locator('#campuses .booking-link')
  await expect(booking).toBeVisible()
  await booking.click()
  // 觀察窗：點了之後整段時間預覽頁都還在 /preview（換頁的 View Transition 約一秒內完成，3 秒夠看出來）。
  await holdsFor(page, 3_000, '預覽被帶離 /preview（點「預約參觀」之後）', async () => new URL((await previewFrame(page)).url()).pathname === '/preview')
  await expect(frame.locator('#campuses')).toBeVisible()
  await expect(pane.getByText(LIVE_TEXT)).toBeVisible()

  // 之後的修改照常送進預覽、框出那一格：預覽的 listener 還在。
  const marker = `預約鈕之後 ${Date.now()}`
  await page.getByRole('textbox', { name: '地址' }).fill(marker)
  await expect(frame.locator('.preview-live-hit')).toContainText(marker, { timeout: 10_000 })
  expect(new URL((await previewFrame(page)).url()).pathname).toBe('/preview')
  await page.getByRole('button', { name: '放棄修改' }).click()
  await answerMessageBox(page, /放棄 \d+ 個欄位的修改？/, '放棄修改')
  await context.close()
})

// 2026-10-07 最終審查 I2：框整塊時「露出 1px 就算看得到」。手機預覽（預設）剛連上「關於常春藤」時 .home-belief 只露 21px，
// 預覽停在首屏。現在要露出 min(區塊高, 頁首底下可用視窗的一半) 才算。
test('關於常春藤（手機預覽）：剛連上就停在那一塊，不是只露一截的首屏', async ({ browser }) => {
  test.setTimeout(90_000)
  const { context, page } = await openAs(browser, 'super_admin')
  await gotoAdmin(page, '/content/home-about', '關於常春藤')
  await expectLive(page)
  const inner = await previewFrame(page)
  const measure = () =>
    inner.evaluate(() => {
      const rect = document.querySelector('.home-belief')!.getBoundingClientRect()
      const inset = document.querySelector('header.header')!.getBoundingClientRect().bottom
      const shown = Math.round(Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, inset))
      const needed = Math.round(Math.min(rect.height, (window.innerHeight - inset) / 2))
      return { shown, needed, top: Math.round(rect.top), viewport: window.innerHeight, scrollY: Math.round(window.scrollY), width: window.innerWidth }
    })
  await expect.poll(async () => {
    const m = await measure()
    return m.shown >= m.needed
  }, { timeout: 15_000, message: '剛連上時「關於常春藤」只露出一小截' }).toBe(true)
  const m = await measure()
  console.log('[關於常春藤 剛連上]', JSON.stringify(m))
  expect(m.width).toBe(390)
  expect(m.scrollY).toBeGreaterThan(0)
  await context.close()
})

test('五校介紹換校：未存修改要確認，確認框開著時預覽不把這一校的修改畫在另一校；放棄換成另一校已存的內容，留在這頁維持原樣', async ({ browser }) => {
  test.setTimeout(120_000)
  const { context, page } = await openAs(browser, 'super_admin')
  await gotoAdmin(page, '/content/campus-profile?campus=yihua', '五校介紹')
  await expectLive(page)
  const frame = page.frameLocator(FRAME)
  const footerRow = (name: string) => frame.locator('#footer-campuses li', { hasText: name })
  const phoneField = page.getByRole('textbox', { name: '參觀專線' })
  const campusSelect = page.locator('.el-select', { has: page.getByRole('combobox', { name: '校區' }) })
  const pickCampus = async (name: string) => {
    await campusSelect.click()
    await page.locator('.el-select-dropdown__item:visible', { hasText: name }).click()
  }

  // 義華的修改只看頁尾那一列：頁尾五校一校一列（校名、區域、電話）。
  const pane = page.getByRole('complementary', { name: '官網預覽' })
  await pane.getByText('頁尾', { exact: true }).click()
  await expect(footerRow('明華')).toBeVisible()
  const minghuaPhoneBefore = (await footerRow('明華').locator('.footer-campus-phone').textContent())?.trim() ?? ''
  expect(minghuaPhoneBefore).not.toBe('')

  const marker = `07-${String(Date.now()).slice(-7, -4)}-${String(Date.now()).slice(-4)}`
  await phoneField.fill(marker)
  await expect(footerRow('義華')).toContainText(marker, { timeout: 5_000 })
  await expect(footerRow('明華')).not.toContainText(marker)
  const timeOriginBefore = await (await previewFrame(page)).evaluate(() => performance.timeOrigin)

  // 換到明華：有未存的修改，先問。
  await pickCampus('明華')
  const leave = page.getByRole('dialog', { name: '放棄修改？' })
  await expect(leave).toBeVisible()
  // 這就是競態的窗口：選單已經是明華、表單還是義華（含沒存的修改）。
  await expect(campusSelect).toContainText('明華')
  await expect(phoneField).toHaveValue(marker)
  // 確認框開著的這段時間：預覽頁不重新載入、也不能把義華的修改畫在明華那一列（還沒決定放不放棄）。
  await holdsFor(page, 3_000, '確認框開著時預覽換了頁、或明華那一列出現義華的電話', async () => {
    const frameNow = await previewFrame(page)
    const origin = await frameNow.evaluate(() => performance.timeOrigin)
    const minghua = (await footerRow('明華').textContent()) ?? ''
    return origin === timeOriginBefore && !minghua.includes(marker)
  })

  // 留在這頁：表單、選單、預覽都維持義華，修改還在。
  await leave.getByRole('button', { name: '留在這頁' }).click()
  await expect(leave).toBeHidden()
  await expect(campusSelect).toContainText('義華')
  await expect(phoneField).toHaveValue(marker)
  await expect(page).toHaveURL(/campus=yihua/)
  await expect(footerRow('義華')).toContainText(marker)
  await expect(footerRow('明華')).not.toContainText(marker)

  // 再換一次、這次放棄：表單載入明華已存的內容，預覽換成明華已存的版本，義華的修改不在任何一處。
  await pickCampus('明華')
  await answerMessageBox(page, '放棄修改？', '放棄修改')
  await expect(page).toHaveURL(/campus=minghua/)
  await expect(campusSelect).toContainText('明華')
  await expectLive(page)
  await expect(phoneField).toHaveValue(minghuaPhoneBefore)
  await page.getByRole('complementary', { name: '官網預覽' }).getByText('頁尾', { exact: true }).click()
  await expect(footerRow('明華')).toContainText(minghuaPhoneBefore)
  await expect(frame.locator('footer.footer')).not.toContainText(marker)
  await expect(page.locator('.editor__actions')).not.toContainText('草稿有')
  await context.close()
})

test('資安（真瀏覽器）：草稿不進預覽網址、storage、cookie、request；後台 CSP 放行同源 frame；別的來源嵌不進去', async ({ browser }) => {
  test.setTimeout(120_000)
  const { context, page } = await openAs(browser, 'super_admin')
  const token = String(Date.now())
  const marker = `機密草稿${token}`

  // 收集：所有 request（含 iframe 的）、console、CSP 違規事件。
  const requests: { url: string; body: string }[] = []
  context.on('request', (request) => requests.push({ url: request.url(), body: request.postData() ?? '' }))
  const consoleLines: string[] = []
  page.on('console', (message) => consoleLines.push(`${message.type()}: ${message.text()}`))
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.addInitScript(() => {
    ;(window as unknown as { __csp: string[] }).__csp = []
    document.addEventListener('securitypolicyviolation', (event) => {
      ;(window as unknown as { __csp: string[] }).__csp.push(`${event.violatedDirective} ${event.blockedURI}`)
    })
  })

  const adminResponse = page.waitForResponse((r) => r.url().endsWith('/admin/content/site-footer') && r.request().resourceType() === 'document')
  await gotoAdmin(page, '/content/site-footer', '頁尾文字')
  const adminHeaders = (await adminResponse).headers()
  expect(adminHeaders['content-security-policy']).toContain("frame-src 'self'")
  expect(adminHeaders['content-security-policy']).toContain("frame-ancestors 'self'")
  await expectLive(page)
  const frameLocator = page.frameLocator(FRAME)
  await expect(frameLocator.locator('footer.footer')).toBeVisible()

  await page.getByRole('textbox', { name: '標語' }).fill(marker)
  await expect(frameLocator.locator('footer.footer')).toContainText(marker, { timeout: 5_000 })

  // 預覽網址只有 embed／live／page，沒有草稿。
  const src = await page.locator(FRAME).getAttribute('src')
  expect(src).toBe('http://127.0.0.1:' + new URL(page.url()).port + '/preview?embed=1&live=1&page=home')
  const inner = await previewFrame(page)
  expect(inner.url()).not.toContain(token)
  expect(inner.url()).not.toContain(encodeURIComponent(marker))
  expect(page.url()).not.toContain(token)

  // storage（同源，後台頁與預覽頁共用）、IndexedDB、Cache Storage、cookie 都沒有草稿；
  // localStorage 只有桌機／手機偏好（要切過才會寫）。
  await page.getByRole('radio', { name: '桌機' }).check({ force: true })
  const stores = await inner.evaluate(async () => {
    const local: Record<string, string> = {}
    for (let i = 0; i < localStorage.length; i++) local[localStorage.key(i)!] = localStorage.getItem(localStorage.key(i)!) ?? ''
    const session: Record<string, string> = {}
    for (let i = 0; i < sessionStorage.length; i++) session[sessionStorage.key(i)!] = sessionStorage.getItem(sessionStorage.key(i)!) ?? ''
    const idb = (await indexedDB.databases?.())?.map((d) => d.name) ?? []
    const caches_ = typeof caches === 'undefined' ? [] : await caches.keys()
    return { local, session, idb, caches: caches_, cookie: document.cookie }
  })
  console.log('[資安] storage 內容', JSON.stringify(stores))
  expect(JSON.stringify(stores)).not.toContain(token)
  // 後台本來就會記側欄展開狀態（ivy-admin-nav-expanded，只有選單開合），預覽相關的只有桌機／手機偏好。
  expect(Object.keys(stores.local).filter((key) => key !== 'ivy-admin-nav-expanded')).toEqual(['ivy-admin-preview-viewport'])
  expect(stores.local['ivy-admin-preview-viewport']).toBe('desktop')
  expect(Object.keys(stores.session)).toEqual([])
  expect(JSON.stringify(await context.cookies())).not.toContain(token)

  // 整個過程沒有任何 request（API、telemetry、靜態資源）的網址或內容帶著草稿。
  const leaked = requests.filter((r) => r.url.includes(token) || r.url.includes(encodeURIComponent(marker)) || r.body.includes(token))
  expect(leaked).toEqual([])
  expect(requests.some((r) => r.url.includes('/preview?embed=1&live=1&page=home'))).toBe(true)

  // 後台頁的 CSP 放行同源 frame：沒有任何違規事件或 console 的 CSP／frame 拒絕訊息。
  const violations = await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)
  expect(violations).toEqual([])
  const csp = consoleLines.filter((line) => /Content Security Policy|Refused to (display|frame|load)|X-Frame-Options/i.test(line))
  expect(csp).toEqual([])
  expect(pageErrors).toEqual([])

  // /preview 的回應標頭：只給同源嵌、不快取、不收錄。
  const preview = await page.request.get('/preview?embed=1&live=1&page=home')
  expect(preview.headers()['x-frame-options']).toBe('SAMEORIGIN')
  expect(preview.headers()['content-security-policy']).toContain("frame-ancestors 'self'")
  expect(preview.headers()['cache-control']).toBe('private, no-store')
  expect(preview.headers()['x-robots-tag']).toContain('noindex')
  expect(await preview.text()).not.toContain(token)

  // 別的來源嵌不進去：瀏覽器真的拒絕（不是只看標頭）。用攔截回應模擬一個外站頁面，裡面嵌這個預覽頁；
  // 被拒絕的 frame 會落在瀏覽器的錯誤頁（chrome-error://），預覽頁的內容沒有載進來。
  const outsider = await openAs(browser, null)
  const origin = page.url().split('/admin')[0]
  await outsider.page.route('http://evil.example/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: `<!doctype html><iframe id="victim" src="${origin}/preview?embed=1&live=1"></iframe>` }),
  )
  await outsider.page.goto('http://evil.example/')
  await expect.poll(() => outsider.page.frames().map((f) => f.url()), { timeout: 10_000 }).toContain('chrome-error://chromewebdata/')
  for (const f of outsider.page.frames()) expect(f.url()).not.toContain('/preview')
  await outsider.context.close()
  await context.close()
})

test('桌機預覽：虛擬視窗不超過 900 高、不被拉長；黏住的預覽欄一路捲得到底', async ({ browser }) => {
  test.setTimeout(90_000)
  const { context, page } = await openAs(browser, 'super_admin')
  await gotoAdmin(page, '/content/campus-profile?campus=yihua', '五校介紹')
  await expectLive(page)
  const pane = page.getByRole('complementary', { name: '官網預覽' })
  await pane.getByRole('radio', { name: '桌機' }).check({ force: true })
  await pane.getByText('頁尾', { exact: true }).click()
  const inner = await previewFrame(page)
  await expect(page.frameLocator(FRAME).locator('footer.footer')).toBeVisible()

  const geometry = async () =>
    page.evaluate(() => {
      const rect = (el: Element | null) => {
        const r = el?.getBoundingClientRect()
        return r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height } : null
      }
      const frame = document.querySelector<HTMLIFrameElement>('iframe[title="官網預覽"]')!
      return {
        frameCss: { width: frame.style.width, height: frame.style.height, transform: frame.style.transform },
        frame: rect(frame),
        device: rect(document.querySelector('.live-preview__device')),
        stage: rect(document.querySelector('.live-preview__stage')),
        pane: rect(document.querySelector('.live-preview')),
        actions: rect(document.querySelector('.editor__actions')),
        top: rect(document.querySelector('.top')),
        inner: { width: frame.contentWindow!.innerWidth, height: frame.contentWindow!.innerHeight },
        win: { width: window.innerWidth, height: window.innerHeight, scrollY: window.scrollY, max: document.documentElement.scrollHeight - window.innerHeight },
      }
    })

  const top = await geometry()
  console.log('[桌機預覽] 幾何（捲動 0）', JSON.stringify(top))
  // 虛擬視窗寬 1280、高不超過 900（1440×900 桌機的高；不是依欄高反算成兩三千）。
  expect(top.inner.width).toBe(1280)
  expect(top.inner.height).toBeLessThanOrEqual(900)
  expect(top.inner.height).toBeGreaterThan(300)
  // 縮放後完整放進預覽欄的舞台（沒有被 overflow 切掉）。
  expect(top.device!.bottom).toBeLessThanOrEqual(top.stage!.bottom + 1)
  expect(top.device!.right).toBeLessThanOrEqual(top.stage!.right + 1)
  expect(top.device!.left).toBeGreaterThanOrEqual(top.stage!.left - 1)
  // 沒捲動時預覽欄的自然位置比黏住的位置低（頁首說明、工具列在上面）：欄底不能鑽進黏底動作列（T8b，量實際位置算高度）。
  expect(top.pane!.bottom).toBeLessThanOrEqual(top.actions!.top + 1)
  await page.screenshot({ path: 'output/playwright/editor-live-desktop-scroll0.png' })

  // 預覽頁自己捲到底：頁尾的下緣貼齊虛擬視窗下緣（預覽頁真的捲得到底、頁尾完整看得到）。
  await inner.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect
    .poll(() => inner.evaluate(() => Math.round(window.scrollY + window.innerHeight - document.documentElement.scrollHeight)), { timeout: 5_000 })
    .toBeGreaterThanOrEqual(-1)
  const footerBottom = await inner.evaluate(() => document.querySelector('footer.footer')!.getBoundingClientRect().bottom)
  const innerHeight = await inner.evaluate(() => window.innerHeight)
  expect(Math.abs(footerBottom - innerHeight)).toBeLessThanOrEqual(2)

  // 後台頁捲到底：預覽欄黏在頂欄下面，下緣不被黏底的動作列蓋住，頁尾那一列還看得到。
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect.poll(async () => (await geometry()).win.scrollY, { timeout: 5_000 }).toBeGreaterThan(0)
  const bottom = await geometry()
  console.log('[桌機預覽] 幾何（捲到底）', JSON.stringify(bottom))
  // 頁面捲到底時 sticky 的預覽欄不能超出版面，會被往上推；欄高已扣掉版面底端到頁面底端的距離（usePreviewPaneFit），
  // 所以推完頂端仍在頂欄下面（原本鑽到頂欄底下約 24px，Task 7 記錄的已知限制，T8b 修掉）；下緣不被黏底動作列蓋住、要完整在視窗裡。
  console.log(`[桌機預覽] 捲到底時預覽欄頂端被頂欄蓋住 ${Math.max(0, Math.round(bottom.top!.bottom - bottom.pane!.top))}px`)
  expect(bottom.pane!.top).toBeGreaterThanOrEqual(bottom.top!.bottom - 1)
  expect(bottom.pane!.bottom).toBeLessThanOrEqual(bottom.actions!.top + 1)
  expect(bottom.pane!.bottom).toBeLessThanOrEqual(bottom.win.height + 1)
  const covered = await page.evaluate(() => {
    const pane = document.querySelector('.live-preview')!.getBoundingClientRect()
    const hit = document.elementFromPoint(pane.left + pane.width / 2, pane.bottom - 4)
    return Boolean(hit?.closest('.live-preview'))
  })
  expect(covered, '預覽欄下緣被其他東西蓋住').toBe(true)
  await page.screenshot({ path: 'output/playwright/editor-live-desktop-scrollbottom.png' })
  await context.close()
})

test('sticky 的區塊（首屏、關於常春藤、孩子的一天）：預覽被捲到別處後，改欄位會捲回那一塊（開啟動態）', async ({ browser }) => {
  test.setTimeout(180_000)
  const { context, page } = await openAs(browser, 'super_admin')
  // 動態開啟時這三塊的根元素是 position: sticky（放在很高的 reveal 容器裡，只在捲過的那一段黏住）；
  // e2e 預設的「減少動態」不會是 sticky，抓不到「sticky 被當成釘住而不捲」。
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  // [網址, 頁面標題, 要改的欄位, 預覽頁裡那一塊的選擇器]
  const CASES: [path: string, heading: string, field: string, block: string][] = [
    ['/content/home-hero', '首頁大圖標語', '標語第 1 行', '.studio-hero'],
    ['/content/home-about', '關於常春藤', '標題', '.home-belief'],
    ['/content/day-experience', '孩子的一天', '小標（中文）', '.day-experience'],
  ]
  for (const viewport of ['mobile', 'desktop'] as const) {
    for (const [path, heading, field, block] of CASES) {
      await test.step(`${viewport} ${path}`, async () => {
        await gotoAdmin(page, path, heading)
        await expectLive(page)
        if (viewport === 'desktop') await page.getByRole('complementary', { name: '官網預覽' }).getByRole('radio', { name: '桌機' }).check({ force: true })
        const inner = await previewFrame(page)
        // 那一塊和預覽頁虛擬視窗（iframe 自己的視窗）的重疊高度；量的是 iframe 裡的 rect，不受外面縮放影響。
        const overlap = () =>
          inner.evaluate((selector) => {
            const el = document.querySelector(selector)!
            const rect = el.getBoundingClientRect()
            return {
              overlap: Math.round(Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0)),
              top: Math.round(rect.top),
              bottom: Math.round(rect.bottom),
              viewport: window.innerHeight,
              position: getComputedStyle(el).position,
              scrollY: Math.round(window.scrollY),
            }
          }, block)
        // 首屏的簾幕在手機是 still（不黏住）、桌機才是 sticky；關於常春藤與孩子的一天兩種寬度都是 sticky。
        // 預覽頁掛好動態才會設定，所以用輪詢等它到位。
        const expected = block === '.studio-hero' && viewport === 'mobile' ? 'relative' : 'sticky'
        await expect.poll(async () => (await overlap()).position, { timeout: 15_000, message: `${block} 在開啟動態、${viewport} 寬度的 position` }).toBe(expected)
        console.log(`[sticky:${viewport}] ${block}`, JSON.stringify(await overlap()))

        // 把預覽捲到最底：這一塊離開視窗。
        await inner.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
        await expect.poll(async () => (await overlap()).overlap, { timeout: 10_000 }).toBeLessThan(100)
        // 改欄位：預覽捲回那一塊（sticky 的區塊也要捲，不是當成釘住）。只填一個字：不到兩個字的文字沒有可找的位置
        // （probe 是 null），預覽頁框的就是區塊根元素本身（sticky 的那個）；填整句的話框到的是裡面的文字，根本不會碰到這個判斷。
        await page.getByRole('textbox', { name: field, exact: true }).fill('字')
        await expect.poll(async () => (await overlap()).overlap, { timeout: 15_000, message: `${block} 沒有被捲回預覽視窗` }).toBeGreaterThanOrEqual(100)
        await page.getByRole('button', { name: '放棄修改' }).click()
        await answerMessageBox(page, /放棄 \d+ 個欄位的修改？/, '放棄修改')
      })
    }
  }
  await context.close()
})

test('頁首：改頁首電話備註，預覽停在原地，不會每打一個字就往上捲（手機 78px 與桌機 92px 的固定頁首）', async ({ browser }) => {
  test.setTimeout(90_000)
  const { context, page } = await openAs(browser, 'super_admin')
  await gotoAdmin(page, '/content/site-meta', '網站標題與電話')
  await expectLive(page)
  const note = page.getByRole('textbox', { name: '電話備註' })
  const inner = await previewFrame(page)

  // 預覽頁的頁首固定在上方：手機高 78、桌機高 92，都要停在原地。2026-10-07 之前寫死 88 的留白，
  // 78 的手機頁首被當成「看不到」，改一次電話備註預覽就往上捲 88（600 → 512 → …）。
  // 先把預覽頁捲到中段，再連續改：整段觀察窗裡捲動位置都不能離開 600，頁首照樣被框起來。
  let typed = 0
  for (const viewport of ['mobile', 'desktop'] as const) {
    if (viewport === 'desktop') await page.getByRole('complementary', { name: '官網預覽' }).getByRole('radio', { name: '桌機' }).check({ force: true })
    // 切到桌機後 iframe 先改寬度、預覽頁才跟著重排：等虛擬視窗寬度到位再量頁首。
    await expect.poll(() => inner.evaluate(() => window.innerWidth)).toBe(viewport === 'mobile' ? 390 : 1280)
    const header = await inner.evaluate(() => {
      const el = document.querySelector('header.header')!
      return { height: Math.round(el.getBoundingClientRect().height), position: getComputedStyle(el).position, innerWidth: window.innerWidth }
    })
    console.log(`[頁首:${viewport}]`, JSON.stringify(header))
    expect(header.position).toBe('fixed')
    expect(header.height).toBeLessThan(88 + 8)
    await inner.evaluate(() => window.scrollTo(0, 600))
    await expect.poll(() => inner.evaluate(() => Math.round(window.scrollY))).toBe(600)
    for (const text of ['週一', '週一至', '週一至週五', '週一至週五 9:00']) {
      await note.fill(`${text}${++typed}`)
      // 後台 debounce 300ms、預覽頁回覆與捲動都在一秒內。
      await holdsFor(page, 1_200, `${viewport}：預覽頁被往上捲走了（改「${text}」之後）`, async () => (await inner.evaluate(() => Math.round(window.scrollY))) === 600)
      await expect(page.frameLocator(FRAME).locator('header.header.preview-live-hit')).toHaveCount(1)
    }
    await page.screenshot({ path: `output/playwright/editor-live-header-${viewport}.png` })
  }
  await context.close()
})
