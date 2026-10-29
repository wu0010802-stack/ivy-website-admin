// 2026-10-13 首頁精修（以國際設計獎的完成度為標準的逐頁檢查）：孩子的一天、最新消息、五校的版面與對比修正。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { objectOffset } from '../app/utils/paperPrints'

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8')
const styles = read('app/assets/css/styles.css')

describe('孩子的一天：固定圖說與暫停鈕全寬度讓位', () => {
  it('data-covered 規則不再包在手機媒體查詢裡', () => {
    const mobile = styles.indexOf('@media(max-width:760px),(max-height:500px){')
    const end = styles.indexOf('}\n', styles.indexOf('.day-film-toggle{right:16px;bottom:14px;padding:8px 14px}', mobile))
    expect(styles.indexOf('.day-film-ui[data-covered="1"] .day-film-caption{opacity:0}')).toBeGreaterThan(end)
  })
  it('沉下去的圓鈕在卡片之間點得到：舞台不接指標，只有卡片與說明字接；說明字底部留白用 margin', () => {
    expect(styles).toContain('.day-stage{pointer-events:none}\n.day-stage :is(.print-card,.day-note){pointer-events:auto}')
    expect(styles).toMatch(/\.day-note\{[^}]*margin:0 auto 96px;/)
  })
  it('影片上的小字不疊 opacity，英文圖說至少 11px', () => {
    expect(styles).toContain('.day-film-caption span[lang]{font-size:.6875rem;')
    expect(styles).not.toContain('rgb(var(--on-dark) / .74)')
  })
})

describe('拍立得照片避開右上角台標', () => {
  it('CSS 預設裁切靠左 36%，WebGL 貼圖讀 computed object-position', () => {
    expect(styles).toContain('.print-photo{width:100%;height:auto;aspect-ratio:1;object-position:36% 40%;')
    expect(read('app/utils/paperPrints.ts')).toContain('photoPosition: getComputedStyle(img!).objectPosition.trim().split(/\\s+/),')
  })
  it('objectOffset：百分比乘上多出來的長度、px 直接當位移、看不懂退回預設', () => {
    expect(objectOffset('36%', 100, 0.5)).toBeCloseTo(36)
    expect(objectOffset('12px', 100, 0.5)).toBe(12)
    expect(objectOffset(undefined, 100, 0.4)).toBeCloseTo(40)
    expect(objectOffset('calc(50% + 2px)', 100, 0.5)).toBeCloseTo(50)
  })
})

describe('拍立得背面橫線對齊行距', () => {
  it('線距＝行距，線跟著故事段落走；貼圖用同一個行距與起點', () => {
    expect(styles).toContain('.print-wrap{--rule:32px;')
    expect(styles).toContain(' .print-wrap{--rule:28px}')
    expect(styles).toMatch(/\.print-story::before\{[^}]*repeating-linear-gradient\(transparent 0 calc\(var\(--rule\) - 1px\)/)
    const paper = read('app/utils/paperPrints.ts')
    expect(paper).toContain('const pitch = style.storyLine > 4 ? style.storyLine : 32')
    expect(paper).not.toContain('for (let y = 31.5; y < H; y += 32)')
  })
})

describe('最新消息與五校', () => {
  it('兩欄用 subgrid 對齊（2026-10-17 起活動卡頂端對齊消息照片頂端），對話框活動標題平均分行（不加 keep-all）', () => {
    expect(read('app/components/NewsDialog.vue')).toContain('grid-template-rows: subgrid')
    expect(read('app/assets/css/studio.css')).toContain('.hn-event-copy strong{text-wrap:balance}')
  })
  it('四個社群連結在窄欄排成 2×2', () => {
    expect(read('app/components/CampusBoard.vue')).toContain('@container (max-width:440px){.social-row:has(> :nth-child(4)){display:grid;grid-template-columns:repeat(2,minmax(0,max-content));column-gap:28px}}')
  })
})
