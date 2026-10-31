import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 2026-10-31 前台 QA 的四項修正（C05、C06、C09、C14）。跟其他版面測試一樣鎖住原始碼裡的關鍵寫法；
// 實際行為（Tab 轉圈、略過後靜音並停止、焦點不被黏底列蓋住、150% 字級不裁切）用 Playwright 在 320／390／1440 實測，數字見 README 同日段落。
const read = (path: string) => readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8')

describe('30 週年開場：鍵盤焦點只在開場裡轉圈（C05）', () => {
  const intro = read('app/components/AnniversaryIntro.vue')
  it('根節點有 ref，Tab 與 Shift+Tab 在開場自己的按鈕首尾轉圈', () => {
    expect(intro).toContain('ref="root"')
    expect(intro).toContain('function trapTab(e: KeyboardEvent)')
    expect(intro).toContain("if (e.shiftKey && (!inside || active === first)) { e.preventDefault(); last.focus({ preventScroll: true }) }")
    expect(intro).toContain("else if (!e.shiftKey && (!inside || active === last)) { e.preventDefault(); first.focus({ preventScroll: true }) }")
  })
  it('開場期間（不只播放中）才攔 Tab，Esc 仍只在播放中略過', () => {
    expect(intro).toMatch(/function onKey\(e: KeyboardEvent\) \{\s+if \(state\.value === 'off'\) return\s+if \(e\.key === 'Tab'\) trapTab\(e\)/)
    expect(intro).toContain("else if (e.key === 'Escape' && state.value === 'play') { e.preventDefault(); leave(true) }")
  })
})

describe('30 週年開場：略過就停聲音（C06）', () => {
  const intro = read('app/components/AnniversaryIntro.vue')
  it('按略過或 Esc 當下靜音，飛向相框那一秒多也不再出聲', () => {
    expect(intro).toContain('if (skipped && v) { v.muted = true; muted.value = true }')
  })
  it('只有自然播完且開著聲音才等配樂尾巴', () => {
    expect(intro).toContain('if (!skipped && v && !v.muted && !v.ended) {')
  })
  it('finish() 一律暫停影片，dialog 隱藏後不會有聲音留在背景', () => {
    const finish = intro.slice(intro.indexOf('function finish() {'), intro.indexOf('function leave('))
    expect(finish).toContain('video.value?.pause()')
  })
  it('離場與展開期間（按鈕看不見）鍵盤按「開聲音」或大播放鈕不會把聲音叫回來', () => {
    expect(intro).toMatch(/function toggleSound\(\) \{\s+const v = video\.value\s+[^\n]*\n\s+if \(!v \|\| state\.value !== 'play'\) return/)
    expect(intro).toMatch(/function playBlocked\(\) \{\s+const v = video\.value\s+if \(!v \|\| state\.value !== 'play'\) return/)
  })
  it('略過時 play() 被 pause() 中斷（AbortError）不算被瀏覽器擋下；重看時清掉 blocked', () => {
    expect(intro).toContain("if (e?.name !== 'AbortError') blocked.value = true")
    const replay = intro.slice(intro.indexOf('function replay() {'), intro.indexOf('function toggleSound('))
    expect(replay).toContain('blocked.value = false')
  })
})

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
