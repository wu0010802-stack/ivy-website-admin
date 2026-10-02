import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 2026-09-29 官網 UX 評析後的修正：這幾處都是畫面行為，沒有獨立的 util 可測，
// 比照 page-hero／visit-calendar 的做法鎖住原始碼裡的關鍵寫法，避免之後改版時悄悄退回。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('首頁五校輪播', () => {
  const board = read('../app/components/CampusBoard.vue')
  it('滑鼠停在校名／地址／預約欄時暫停，預約連結不會在游標底下換校', () => {
    expect(board).toMatch(/const playing = computed\(\(\) => [^\n]*!hoveringDetails\.value/)
    expect(board).toContain(`@pointerenter="hoveringDetails = $event.pointerType === 'mouse'"`)
    expect(board).toContain('@pointerleave="hoveringDetails = false"')
  })
})

describe('首屏「找校區」', () => {
  it('2026-09-30 首屏改版拿掉（取代 09-29 的桌機也顯示）；揭幕需要的 .studio-actions 容器留空、不佔高度', () => {
    const hero = read('../app/components/HeroVideo.vue')
    expect(hero).not.toContain('hero-campus-link')
    expect(hero).toContain('<div ref="actionsEl" class="studio-actions" />')
    expect(hero).toMatch(/^\.studio-actions\{display:none\}/m)
  })
})

describe('預約頁', () => {
  const form = read('../app/components/VisitForm.vue')
  it('選校卡寫短地址，不只給區名', () => {
    expect(form).toContain('<small>{{ shortAddress(campus) }}</small>')
    expect(form).toMatch(/const shortAddress = \(campus: Campus\) => campus\.address\?\.replace\(\/\^高雄市\/, ''\)/)
  })
  it('送出結果：預約成功用打勾，已取消用叉號，不再有時鐘', () => {
    expect(form).toContain(`:href="resultKind === 'booked' ? '#i-check' : '#i-x'"`)
    expect(form).not.toContain('#i-clock')
  })
  it('送出失敗與送太多次時附上所選校區的電話', () => {
    expect(form).toContain('送出失敗，請稍後再試一次；你填寫的內容還保留著。${callFallback.value}')
    expect(form.match(/送出太多次了，請稍後再試一次。\$\{callFallback\.value\}/g)).toHaveLength(2)
  })
  it('送出鈕用頁首同一個金黃色，不用低彩度杏色', () => {
    const css = read('../app/assets/css/visit-booking.css')
    expect(css).toContain('--visit-cta-bg:var(--yellow);')
    expect(css).not.toContain('--visit-cta-bg:var(--ivy-campus-gold);')
  })
})

describe('最新消息頁', () => {
  it('示意活動不露出具體日期（比照首頁）', () => {
    const news = read('../app/components/NewsIndexContent.vue')
    expect(news).toContain('<span v-if="isSample(item)" class="np-event-date is-sample"><b>示意</b><span>日期未定</span></span>')
    // main 已另行修掉（eventMeta 對示意活動不列日期），合併時以 main 的寫法為準。
    expect(news).toContain("isSample(item) ? '' : formatDate(item.date)")
  })
})

describe('錯誤頁', () => {
  it('有自訂的中文錯誤頁，不落回 Nuxt 預設英文頁', () => {
    const path = fileURLToPath(new URL('../app/error.vue', import.meta.url))
    expect(existsSync(path)).toBe(true)
    const page = readFileSync(path, 'utf8')
    expect(page).toContain('找不到這一頁')
    expect(page).toContain("{ name: 'robots', content: 'noindex' }")
    expect(page).toContain("clearError({ redirect: '/' })")
  })
})

describe('家長管理頁', () => {
  it('提示框不用側邊色條', () => {
    expect(read('../app/pages/visit/manage.vue')).not.toMatch(/\.parent-visit-notice \{[^}]*border-left/)
  })
})

describe('放大字級', () => {
  it('手機頁首品牌字標不跟著根字級放大，預約與選單鈕不被擠出畫面', () => {
    const css = read('../app/assets/css/studio.css')
    expect(css).toContain('.brand {--brand-type:min(1.125rem,18px);--brand-crest-size:min(2.25rem,36px);min-inline-size:0;flex-shrink:1}')
    expect(css).toContain('.header-actions {flex-shrink:0}')
  })
})
