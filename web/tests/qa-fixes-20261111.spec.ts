import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 2026-11-11 前台 QA（正式站唯讀巡檢）的兩項修正。跟其他版面測試一樣鎖住原始碼裡的關鍵寫法；
// 撥號膠囊的實際點擊範圍用 Playwright 在 320／336／338／360／390／430 與橫拿手機量過，數字見 README 同日段落。
const read = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8')

describe('錯誤頁標題結尾跟著全站（TITLE_BRAND）', () => {
  const page = read('app/error.vue')
  it('404 與 503 的 <title> 用 TITLE_BRAND，不再寫死品牌名', () => {
    expect(page).toContain("title: computed(() => `${notFound.value ? '找不到這一頁' : '網站暫時無法顯示'}｜${TITLE_BRAND}`)")
    expect(page).not.toContain('｜常春藤教育機構')
  })
})

describe('預約選校卡：手機上義華的撥號膠囊排到最左', () => {
  const css = read('app/assets/css/visit-booking.css')
  const reorder = '@media(min-width:338px) and (max-width:760px),(max-width:960px) and (max-height:500px) and (orientation:landscape) {\n  .visit-campus-mode.is-online + .visit-campus-mode.is-call {order:-1}\n}'
  it('細條卡兩顆並排時（338 起）把疊在「可線上預約」後面的撥號膠囊用 order 換到前面', () => {
    expect(css).toContain(reorder)
  })
  it('只有那一條規則換順序：336 以下兩顆疊成兩行、直卡（761 以上）上下疊，都照範本順序', () => {
    expect(css.replace(reorder, '')).not.toContain('order:-1')
  })
  // 2026-11-13 直卡的金色膠囊移到卡片左上角，撥號膠囊上方不再有別的膠囊：
  // 「直卡往上只補 6px」的例外拿掉，所有卡片的撥號膠囊都是上下各補 10px（44px 高）。
  it('點擊範圍：撥號膠囊上下各補 10px，沒有直卡的例外', () => {
    expect(css).toContain(".visit-campus-mode.is-call::before {content:'';position:absolute;inset:-10px -6px}")
    expect(css).not.toContain('.visit-campus-mode.is-online + .visit-campus-mode.is-call::before')
  })
  it('範本順序不變（金色膠囊在前、撥號在後），讀屏與鍵盤順序不受影響', () => {
    const form = read('app/components/VisitForm.vue')
    expect(form.indexOf("'is-online': campusActions[campus.key]?.kind === 'form'")).toBeLessThan(form.indexOf('<a v-if="onlineCall(campus)" class="visit-campus-mode is-call"'))
  })
})
