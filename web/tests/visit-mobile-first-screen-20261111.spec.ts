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

describe('第一步：矮手機色帶收成一行', () => {
  const short = block('@media(max-width:760px) and (max-height:760px)')
  it('兩句標題各包一個 span，中間的 <br> 手機藏起來、用欄距隔開', () => {
    expect(form).toContain('<template v-if="isPicking"><span>帶著好奇</span><br><span>來校園走走</span></template>')
    expect(short).toContain(".visit-page[data-step='1'] .visit-welcome h1 {display:flex;flex-wrap:wrap;column-gap:.45em;")
    expect(short).toContain(".visit-page[data-step='1'] .visit-welcome h1 br {display:none}")
  })
  it('一行色帶放不下巨大淡字與眉標', () => {
    expect(short).toContain('.visit-ghost {display:none}')
    expect(short).toContain(".visit-page[data-step='1'] .visit-eyebrow {display:none}")
  })
  it('高度超過 760 的手機色帶照舊：收短的規則都寫在帶 max-height 的區塊裡', () => {
    const rest = css.replace(short, '')
    expect(rest).not.toContain('.visit-ghost {display:none}')
    expect(rest).not.toContain('h1 br {display:none}')
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
