import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 2026-11-11 手機預約頁第一屏（使用者要求）：選校頁第一屏要看得到三所校區、表單頁月曆要進第一屏。
// 都是版面，比照 mobile-ux-20261012 鎖住原始碼裡的關鍵寫法；實測數字見 README 同日段落。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const css = read('../app/assets/css/visit-booking.css')
const form = read('../app/components/VisitForm.vue')
const page = read('../app/pages/visit/[[key]].vue')

/** 取出某個 @media 區塊的內容（到下一個頂層 `}` 為止）。 */
function block(query: string, from = 0): string {
  const start = css.indexOf(`${query} {\n`, from)
  expect(start, `找不到 ${query}`).toBeGreaterThan(-1)
  return css.slice(start, css.indexOf('\n}\n', start))
}

describe('手機不顯示麵包屑', () => {
  it('只在 760 以下藏，桌機與平板照舊', () => {
    expect(page).toContain('<div class="container breadcrumb visit-breadcrumb">')
    expect(page).toMatch(/@media\(max-width:760px\) \{\n {2}\.visit-breadcrumb \{display:none\}\n\}/)
  })
})

// 2026-11-13 使用者要求手機也要照片與巨大淡字「預約參觀」：色帶改成桌機的縮小版（左文右圖），
// 取代 11-11「矮手機收成一行標題」與 09-27「手機拿掉照片」。實測數字見 README 2026-11-13 段落。
describe('第一步：手機色帶是桌機的縮小版（左邊兩行大標、右邊照片、淡字墊在大標後面）', () => {
  const mobile = block('@media(max-width:760px)')
  const short = block('@media(max-width:760px) and (max-height:760px)')
  const narrowLandscape = block('@media(max-width:760px) and (max-height:500px) and (orientation:landscape)')
  it('直拿手機有照片：樣式不藏、<picture> 也不換成透明圖，sizes 是半個視窗', () => {
    expect(mobile).not.toContain('.visit-welcome-photo {display:none}')
    expect(mobile).toContain('.visit-welcome-inner {grid-template-columns:auto minmax(0,1fr);column-gap:18px;align-items:center}')
    // 框明寫 width:100%：有 aspect-ratio 的格線項目不會自己撐滿欄寬，max-height 生效時寬度會跟著縮。
    expect(mobile).toContain('.visit-welcome-photo {width:100%;aspect-ratio:3/2;max-height:190px;overflow:hidden;border-radius:14px}')
    expect(form).toContain('<source media="(max-width: 960px) and (max-height: 500px) and (orientation: landscape)" srcset="data:image/gif;base64,')
    expect(form).not.toContain('<source media="(max-width: 760px),')
    expect(form).toContain("responsiveImage('about-curious', '(max-width: 760px) 50vw, (max-width: 960px) calc(100vw - 64px), min(52vw, 710px)')")
  })
  it('照片鏡頭往左拉：圖放大成框寬的 128%、靠左，右邊被框裁掉', () => {
    expect(mobile).toContain('.visit-welcome-photo img {width:128%;max-width:none;height:100%;aspect-ratio:auto;border-radius:0;object-position:left 28%}')
  })
  it('大標兩行，字級取 rem 與 7vw 的較小值；淡字是大標的 2.7 倍（兩個字等於大標五個字寬，不伸到照片後面）', () => {
    expect(form).toContain('<template v-if="isPicking"><span>帶著好奇</span><br><span>來校園走走</span></template>')
    expect(mobile).toContain('.visit-welcome {--visit-title-size:min(2.25rem,7vw)}')
    expect(mobile).toContain(".visit-page[data-step='1'] .visit-welcome h1 {font-size:var(--visit-title-size);line-height:1.4}")
    // 淡字的排法 11-13 比過三種（一行放大標上方、小標、放大出血），使用者選回兩行墊在大標後面。
    expect(mobile).toContain('.visit-ghost {--visit-ghost-size:calc(var(--visit-title-size) * 2.7);justify-content:center;padding:4px 0 0 14px;opacity:.4}')
    expect(mobile).toContain('.visit-ghost span:last-child {padding-left:0}')
  })
  it('眉標手機不顯示（大標欄只有五個字寬）', () => {
    expect(mobile).toContain(".visit-page[data-step='1'] .visit-eyebrow {display:none}")
  })
  it('不照高度分兩種色帶（工具列收合時版面會跳）：帶 max-height:760 的區塊只剩步驟列與選校標題的間距', () => {
    expect(short).not.toContain('.visit-ghost')
    expect(short).not.toContain('.visit-welcome')
    expect(short).not.toContain('.visit-eyebrow')
    expect(short).toContain(".visit-page[data-step='1'] .visit-stage {padding-top:12px}")
  })
  it('橫拿的窄手機沒有照片，色帶照舊收成一行標題', () => {
    expect(css).toContain('@media(max-width:960px) and (max-height:500px) and (orientation:landscape) {.visit-welcome-photo {display:none}}')
    expect(narrowLandscape).toContain('.visit-ghost {display:none}')
    expect(narrowLandscape).toContain('.visit-welcome-inner {grid-template-columns:1fr}')
    expect(narrowLandscape).toContain(".visit-page[data-step='1'] .visit-welcome h1 {display:flex;flex-wrap:wrap;column-gap:.45em;font-size:min(var(--fs-2xl),6.6vw)}")
    expect(narrowLandscape).toContain(".visit-page[data-step='1'] .visit-welcome h1 br {display:none}")
  })
})

describe('第二步：月曆進第一屏', () => {
  const short = css.indexOf('@media(max-width:760px) and (max-height:760px)')
  const step2 = block('@media(max-width:760px)', short + 1)
  it('頁名與「填寫參觀資料」只留給讀屏，標記不動', () => {
    expect(step2).toContain(".visit-page:not([data-step='1']) .visit-welcome h1,.visit-contact-form>h2 {position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}")
    expect(form).toContain('<h1 id="visit-title" ref="titleRef">')
    expect(form).toContain('<h2>填寫參觀資料</h2>')
  })
  it('所選校園收成兩列：校名｜更換校區、地址｜電話', () => {
    expect(step2).toContain('.visit-campus-aside {grid-template-columns:minmax(0,1fr) auto;')
    expect(step2).toContain('.visit-aside-info {display:contents}')
    expect(step2).toContain('.visit-change {grid-area:1/2;justify-self:end}')
    expect(step2).toContain('.visit-aside-info p {grid-area:2/1;min-height:44px}')
    expect(step2).toMatch(/\.visit-aside-phone \{grid-area:2\/2;/)
  })
  it('點擊高度不變：地址、電話、更換校區仍是 44px', () => {
    expect(css).toMatch(/\.visit-aside-map \{[^}]*min-height:44px/)
    expect(css).toMatch(/\.visit-aside-phone \{min-height:44px/)
    expect(css).toMatch(/\.visit-change \{[^}]*min-height:44px/)
  })
})
