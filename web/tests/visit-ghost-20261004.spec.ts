import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// 2026-10-04：10-02 迎賓區收短後，背景大字「預約／參觀」第二行落到選校區上，被內容區底色蓋掉半截。
// 改成跟著色帶高度縮放；實際尺寸在真瀏覽器量過（README 2026-10-04 段），這裡鎖住寫法避免退回。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const form = read('../app/components/VisitForm.vue')
const css = read('../app/assets/css/visit-booking.css')

describe('預約頁背景大字放得進色帶', () => {
  it('大字放在迎賓區裡，以迎賓區（色帶）為定位與尺寸基準', () => {
    expect(form).toMatch(/<header class="visit-welcome">\s*<div v-if="isPicking" class="visit-ghost" aria-hidden="true">/)
    expect(css).toMatch(/\.visit-ghost \{position:absolute;inset:0;z-index:-1;container-type:size;/)
    expect(css).not.toMatch(/\.visit-ghost \{[^}]*max-height:100%/)
  })

  it('字級取原尺寸與色帶高度放得下兩行（行高 1.04）的較小值', () => {
    expect(css).toContain('.visit-ghost span {font-size:min(var(--visit-ghost-size),100cqh / 2.08);letter-spacing:-.075em}')
    // em 字距要寫在 span：寫在外層會以外層字級算成固定 px，縮字後字距不跟著縮。
    expect(css).not.toMatch(/\.visit-ghost \{[^}]*letter-spacing/)
    expect(css).toMatch(/@media\(max-width:760px\) \{[^@]*\.visit-ghost \{--visit-ghost-size:30vw;opacity:\.4\}/)
  })
})
