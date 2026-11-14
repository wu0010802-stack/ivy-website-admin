import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 2026-10-31 前台 QA 的四項修正（C05、C06、C09、C14）。跟其他版面測試一樣鎖住原始碼裡的關鍵寫法；
// 實際行為（Tab 轉圈、略過後靜音並停止、焦點不被黏底列蓋住、150% 字級不裁切）用 Playwright 在 320／390／1440 實測，數字見 README 同日段落。
const read = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8')

// 2026-11-11：C05（開場的鍵盤焦點轉圈）與 C06（略過就停聲音）隨 30 秒開場動畫（AnniversaryIntro.vue）一起拿掉。
// 新的紀念影片不是蓋住整頁的對話框：按了才播、用瀏覽器原生的控制列，暫停或捲走就停（tests/anniversary.spec.ts）。

// 2026-11-13 選校卡改成點一下就進第二步，黏底的「下一步」列拿掉：C09 修的「黏底列蓋住鍵盤聚焦的卡片與撥號連結」
// 已經沒有東西會蓋，原本為它留的 scroll-margin 與 --visit-next-h 一起拿掉（見 visit-campus-links-20261113.spec.ts）。
describe('預約第一步：手機沒有黏底列，鍵盤聚焦的校區卡與撥號連結不會被蓋住（C09）', () => {
  const css = read('app/assets/css/visit-booking.css')
  it('黏底列與為它留的捲動邊距都拿掉', () => {
    expect(css).not.toContain('visit-next-row')
    expect(css).not.toContain('--visit-next-h')
  })
  it('「選擇校園」回第一步時，剛才那張卡補捲到看得見', () => {
    expect(read('app/components/VisitForm.vue')).toContain("last?.closest('.visit-campus-choice')?.scrollIntoView({ block: 'nearest', behavior: 'instant' })")
  })
})

describe('預約第一步：選校卡高度跟著字級長，150% 字級不裁切（C14）', () => {
  const css = read('app/assets/css/visit-booking.css')
  const mobile = css.slice(css.indexOf('@media(max-width:760px) {\n  .visit-page {padding-bottom:56px}'), css.indexOf('@media(max-width:360px)'))
  const landscape = css.slice(css.lastIndexOf('@media(max-width:960px) and (max-height:500px) and (orientation:landscape)'))
  it('手機與橫拿手機的細條卡用 min-height，文字流內排版', () => {
    for (const block of [mobile, landscape]) {
      expect(block).toContain('.visit-campus-card {display:grid;aspect-ratio:auto;min-height:96px;height:auto;border-radius:18px}')
      // 2026-11-13 起文字塊不定位（卡片連結的 ::after 要以整張卡為基準），仍在流內排版。
      expect(block).toContain('.visit-campus-copy {align-self:stretch;justify-self:start;justify-content:center;')
      expect(block).toContain('min-height:96px;padding:6px 72px 6px 18px;')
    }
  })
  it('不再寫死 96px 高與絕對定位置中', () => {
    expect(mobile).not.toContain('height:96px;border-radius')
    expect(mobile).not.toContain('.visit-campus-copy {inset:0 auto 0 0')
    expect(landscape).not.toContain('.visit-campus-copy {inset:0 auto 0 0')
  })
})
