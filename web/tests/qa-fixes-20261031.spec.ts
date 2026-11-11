import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 2026-10-31 前台 QA 的四項修正（C05、C06、C09、C14）。跟其他版面測試一樣鎖住原始碼裡的關鍵寫法；
// 實際行為（Tab 轉圈、略過後靜音並停止、焦點不被黏底列蓋住、150% 字級不裁切）用 Playwright 在 320／390／1440 實測，數字見 README 同日段落。
const read = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8')

// 2026-11-11：C05（開場的鍵盤焦點轉圈）與 C06（略過就停聲音）隨 30 秒開場動畫（AnniversaryIntro.vue）一起拿掉。
// 新的紀念影片不是蓋住整頁的對話框：按了才播、用瀏覽器原生的控制列，暫停或捲走就停（tests/anniversary.spec.ts）。

describe('預約第一步：手機黏底列不蓋住鍵盤聚焦的校區卡與撥號連結（C09）', () => {
  const css = read('app/assets/css/visit-booking.css')
  const mobile = css.slice(css.indexOf('@media(max-width:760px) {\n  .visit-page {padding-bottom:56px}'), css.indexOf('@media(max-width:380px)'))
  it('radio 撐滿整張卡；鍵盤聚焦時讓出黏底列的高度，滑鼠與觸控點卡片不會把頁面捲走', () => {
    expect(mobile).toContain('.visit-campus-choice>input {inset:0;width:100%;height:100%}')
    expect(mobile).toContain('.visit-campus-choice>input:focus-visible,.visit-campus-mode.is-call:focus-visible {scroll-margin-bottom:calc(var(--visit-next-h) + 16px)}')
  })
  it('label 也留一份，「選擇校園」回第一步時 focusPicker 的 scrollIntoView 才不會被黏底列蓋住', () => {
    expect(mobile).toContain('.visit-campus-choice {scroll-margin-bottom:calc(var(--visit-next-h) + 16px)}')
    expect(read('app/components/VisitForm.vue')).toContain("checked?.closest('.visit-campus-choice')?.scrollIntoView({ block: 'nearest', behavior: 'instant' })")
  })
  it('黏底列高度跟著瀏覽器字級與 iPhone 底部安全區估算', () => {
    expect(mobile).toContain('.visit-page {--visit-next-h:calc(67px + max(12px,env(safe-area-inset-bottom)) + max(0px,(1rem - 16px) * 6))}')
  })
})

describe('預約第一步：選校卡高度跟著字級長，150% 字級不裁切（C14）', () => {
  const css = read('app/assets/css/visit-booking.css')
  const mobile = css.slice(css.indexOf('@media(max-width:760px) {\n  .visit-page {padding-bottom:56px}'), css.indexOf('@media(max-width:380px)'))
  const landscape = css.slice(css.lastIndexOf('@media(max-width:960px) and (max-height:500px) and (orientation:landscape)'))
  it('手機與橫拿手機的細條卡用 min-height，文字流內排版', () => {
    for (const block of [mobile, landscape]) {
      expect(block).toContain('.visit-campus-card {display:grid;aspect-ratio:auto;min-height:96px;height:auto;border-radius:18px}')
      expect(block).toContain('.visit-campus-copy {position:relative;inset:auto;justify-self:start;justify-content:center;')
      expect(block).toContain('min-height:96px;padding:6px 72px 6px 18px;')
    }
  })
  it('不再寫死 96px 高與絕對定位置中', () => {
    expect(mobile).not.toContain('height:96px;border-radius')
    expect(mobile).not.toContain('.visit-campus-copy {inset:0 auto 0 0')
    expect(landscape).not.toContain('.visit-campus-copy {inset:0 auto 0 0')
  })
})
