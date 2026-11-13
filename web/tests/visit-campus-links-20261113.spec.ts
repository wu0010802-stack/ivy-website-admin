import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 2026-11-13 預約第一步（使用者要求）：選校卡點一下就進第二步，拿掉「下一步」按鈕；
// 桌機直卡的金色「可線上預約」移到卡片左上角，只撥號的四校不再空一行。
// 都是結構與版面，比照 mobile-ux-20261012 鎖住原始碼裡的關鍵寫法；實測見 README 同日段落。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const css = read('../app/assets/css/visit-booking.css')
const form = read('../app/components/VisitForm.vue')
const telemetry = read('../app/plugins/telemetry.client.ts')

describe('選校卡是連結，點一下就進第二步', () => {
  it('清單是具名的 list，每張卡一個連到 /visit/<校> 的 NuxtLink', () => {
    expect(form).toContain('<ul ref="pickerRef" class="visit-campus-list" role="list" aria-label="想參觀的校區">')
    expect(form).toContain('<NuxtLink class="visit-campus-link" :to="`/visit/${campus.key}`" :data-key="campus.key" data-visit-step :aria-label="campusChoiceLabel(campus)"><strong>{{ campus.name }}</strong></NuxtLink>')
  })
  it('沒有 radio、沒有「下一步」按鈕，也沒有「請先選擇校區」的錯誤', () => {
    expect(form).not.toContain('type="radio" name="campus"')
    expect(form).not.toContain('visit-next')
    expect(form).not.toContain('goNext')
    expect(form).not.toContain('campusError')
  })
  it('連結的 ::after 撐滿整張卡；文字塊不定位，定位基準才是卡片', () => {
    expect(css).toContain(".visit-campus-link::after {content:'';position:absolute;inset:0}")
    for (const rule of css.match(/\.visit-campus-copy \{[^}]*\}/g) ?? []) expect(rule).not.toMatch(/position:/)
    expect(css).toContain('.visit-campus-card {position:relative;display:grid;aspect-ratio:3/4;')
  })
  it('撥號膠囊疊在卡片連結上面，點了只撥號', () => {
    expect(css).toContain('.visit-campus-mode.is-call {position:relative;z-index:1;')
    // 範本順序：卡片連結在前、撥號在後（鍵盤先到校園、再到電話）。
    expect(form.indexOf('class="visit-campus-link"')).toBeLessThan(form.indexOf('class="visit-campus-mode is-call"'))
  })
  it('角落的箭頭只是記號，點擊交給底下的連結', () => {
    expect(form).toContain('<span class="visit-campus-go" aria-hidden="true"><svg class="icon"><use href="#i-arrow-right" /></svg></span>')
    expect(css).toMatch(/\.visit-campus-go \{[^}]*pointer-events:none\}/)
    expect(css).not.toContain('visit-campus-check')
  })
  it('鍵盤焦點外框畫在整張卡上', () => {
    expect(css).toContain('.visit-campus-card:has(.visit-campus-link:focus-visible) {outline:3px solid var(--leaf);outline-offset:4px}')
  })
  it('從第二步回來，焦點回到剛才那所校園的卡片', () => {
    expect(form).toContain('pickerRef.value?.querySelector<HTMLElement>(`.visit-campus-link[data-key="${form.campus}"]`)')
  })
  it('同一頁裡換步驟不算從別處點進預約頁（原本的「下一步」按鈕也不記）', () => {
    expect(telemetry).toContain("if (anchor.hasAttribute('data-visit-step')) return")
    expect(telemetry.indexOf("anchor.hasAttribute('data-visit-step')")).toBeLessThan(telemetry.indexOf("send({ event: 'visit_click'"))
  })
})

describe('桌機直卡：只撥號的校區不再空一行', () => {
  it('金色「可線上預約」貼在卡片左上角，不佔底部的行', () => {
    expect(css).toContain('@media(min-width:961px),(min-width:761px) and (min-height:501px) {\n  .visit-campus-mode.is-online {position:absolute;top:14px;left:14px;z-index:1;min-height:32px;margin:0;padding:2px 14px;pointer-events:none}\n}')
  })
  it('不再替五張卡預留兩行膠囊高', () => {
    expect(css).not.toContain('.visit-campus-modes {min-height:60px}')
  })
})
