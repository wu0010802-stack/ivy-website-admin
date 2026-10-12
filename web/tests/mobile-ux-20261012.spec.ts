// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFieldErrors, focusNextFieldOnEnter, validateVisitContact } from '../app/utils/visit-form'

// 2026-10-12 手機版第四輪審查後的修正。多半是版面與樣式，比照 mobile-ux-20261002 鎖住原始碼裡的
// 關鍵寫法，避免之後改版時悄悄退回；實測數字見 README 同日段落、DESIGN.md「手機版第四輪審查」。
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
const visitCss = read('../app/assets/css/visit-booking.css')
const visitForm = read('../app/components/VisitForm.vue')

describe('預約第一步：矮手機第一屏看得到選校卡', () => {
  it('手機黏底列只留按鈕，狀態字改成只給讀屏', () => {
    expect(visitCss).toMatch(/@media\(max-width:760px\) \{\n {2}\.visit-next-row>p \{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset\(50%\)/)
    expect(visitForm).toContain('<p role="status">{{ selectedCampus ? `已選擇${selectedCampus.name}`')
  })
  it('高度 760 以下拿掉導言，620 以下再拿掉眉標與選校說明', () => {
    const short = visitCss.slice(visitCss.indexOf('@media(max-width:760px) and (max-height:760px)'))
    expect(short).toContain(".visit-page[data-step='1'] .visit-lead {display:none}")
    const shorter = visitCss.slice(visitCss.indexOf('@media(max-width:760px) and (max-height:620px)'))
    expect(shorter).toContain(".visit-page[data-step='1'] .visit-eyebrow {display:none}")
    expect(shorter).toContain('.visit-pick-step .visit-step-copy {display:none}')
  })
})

describe('預約：橫拿手機', () => {
  const landscape = visitCss.slice(visitCss.lastIndexOf('@media(max-width:960px) and (max-height:500px) and (orientation:landscape)'))
  it('選校卡改細條、一列兩張，圖片 sizes 跟著改半個視窗', () => {
    expect(landscape).toContain('.visit-campus-choice {flex:0 1 calc((100% - 16px) / 2)}')
    expect(landscape).toContain('.visit-campus-card {aspect-ratio:auto;height:96px;border-radius:18px}')
    expect(visitForm).toContain('(max-width: 960px) and (max-height: 500px) and (orientation: landscape) calc(50vw - 28px)')
  })
  it('拿掉場次區的容器查詢：月曆與場次上下排，點下排日期後場次就在月曆下面', () => {
    expect(landscape).toContain('.visit-schedule-section {container-type:normal}')
  })
})

describe('預約第二步', () => {
  it('讀場次時先留月曆的高度，月曆插進來不把孩子資料欄推走', () => {
    expect(visitForm).toContain('<p v-if="slotsPending" class="visit-status visit-slots-loading" role="status">')
    expect(visitCss).toContain('.visit-slots-loading {min-height:400px}')
  })
  it('送出列的「・」接在前一段後面：320 寬可以在分隔號後換行，不撐出欄外', () => {
    expect(visitForm).toContain("{{ part }}{{ index < bookingSummary.length - 1 ? '・' : '' }}</span>")
    expect(visitForm).not.toContain("{{ index ? '・' : '' }}{{ part }}")
  })
  it('原封不動再按一次就好的失敗：不跳到頂端錯誤，焦點回到送出鈕，鈕旁提示帶電話', () => {
    expect(visitForm).toContain('if (!submitRetryHint.value) await focusError()')
    expect(visitForm).toMatch(/if \(submitRetryHint\.value && submitError\.value\) \{\n\s+await nextTick\(\)\n\s+submitButtonRef\.value\?\.focus\(\)/)
    expect(visitForm).toContain('<button ref="submitButtonRef" type="submit"')
    expect(visitForm).toContain("'送出沒有成功，可以直接再按一次。' }}{{ callFallback }}</p>")
  })
})

describe('Email 錯誤字不承諾寄信（寄信看各校設定，正式站 10-02 起是關的）', () => {
  it('空白與格式錯誤都不提「確認信與修改連結會寄到這裡」', () => {
    const errors = validateVisitContact({ parentName: '陳媽媽', phone: '0912345678', email: '' })
    expect(errors.email).toBe('請填寫 Email。')
    expect(validateVisitContact({ parentName: '陳媽媽', phone: '0912345678', email: 'abc' }).email).toBe('請填寫有效的 Email，例如 name@example.com。')
    expect(apiFieldErrors([{ loc: ['body', 'email'] }]).email).toBe('請填寫有效的 Email，例如 name@example.com。')
  })
})

describe('預約完成頁', () => {
  it('修改連結在填寫內容之前，手機線稿縮小', () => {
    const result = visitForm.slice(visitForm.indexOf('id="booking-result"'))
    expect(result.indexOf('class="visit-result-next"')).toBeLessThan(result.indexOf('<dl class="visit-result-list">'))
    expect(visitCss).toContain('.visit-result-art {width:min(150px,45%);margin-bottom:12px}')
  })
  it('複製失敗時說出來，並印出完整網址讓家長長按複製', () => {
    expect(visitForm).toContain("<p class=\"visit-copy-feedback\" role=\"status\">{{ linkCopyFailed ? '沒有複製成功，請長按下面的網址複製。' : '' }}</p>")
    expect(visitForm).toContain('<input v-if="linkCopyFailed" class="visit-copy-url" type="url" readonly :value="manageUrl"')
  })
})

describe('家長修改頁', () => {
  const manage = read('../app/pages/visit/manage.vue')
  it('修改資料的輸入框和預約表單同一套外觀、54px 高、16px 字（iOS 對焦不放大）', () => {
    expect(manage).toContain('.parent-visit-fields input{display:block;width:100%;min-width:0;min-height:54px;padding:12px 16px;font:400 var(--fs-md)/1.65 var(--font);')
  })
  it('觸控 Enter 跳下一欄，不直接送出整張表', () => {
    expect(manage).toContain('@keydown.enter="focusNextFieldOnEnter($event, editPanel)"')
    expect(manage.match(/enterkeyhint="next"/g)).toHaveLength(4)
  })
})

describe('focusNextFieldOnEnter', () => {
  afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = '' })
  function setup(coarse: boolean) {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: coarse && query === '(pointer: coarse)' }))
    document.body.innerHTML = '<form><input id="a" type="text"><input type="radio"><input id="b" type="email"></form>'
    const form = document.querySelector('form')!
    for (const input of form.querySelectorAll('input')) Object.defineProperty(input, 'offsetParent', { get: () => form })
    return form
  }
  function enter(target: HTMLElement, init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent('keydown', { key: 'Enter', cancelable: true, ...init })
    Object.defineProperty(event, 'target', { value: target })
    return event
  }
  it('觸控裝置跳到下一個文字欄（略過 radio），最後一欄收起鍵盤', () => {
    const form = setup(true)
    const a = form.querySelector<HTMLInputElement>('#a')!
    const b = form.querySelector<HTMLInputElement>('#b')!
    const first = enter(a)
    focusNextFieldOnEnter(first, form)
    expect(first.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(b)
    focusNextFieldOnEnter(enter(b), form)
    expect(document.activeElement).not.toBe(b)
  })
  it('桌機（非觸控）與注音選字中照舊，不攔 Enter', () => {
    const form = setup(false)
    const event = enter(form.querySelector<HTMLInputElement>('#a')!)
    focusNextFieldOnEnter(event, form)
    expect(event.defaultPrevented).toBe(false)
    const touch = setup(true)
    const composing = enter(touch.querySelector<HTMLInputElement>('#a')!, { isComposing: true })
    focusNextFieldOnEnter(composing, touch)
    expect(composing.defaultPrevented).toBe(false)
  })
})

describe('入學頁生日工具', () => {
  const admission = read('../app/components/AdmissionContent.vue')
  const css = read('../app/assets/css/admission-passport.css')
  it('首屏與特色教學頁的「查班別」直接落在生日欄', () => {
    expect(admission).toContain('<a class="ap-action" href="#birthday-tool">')
    expect(admission).toContain('<div id="birthday-tool" class="ap-datapage">')
    expect(read('../app/components/CurriculumContent.vue')).toContain('to="/admission#birthday-tool"')
  })
  it('單欄時答案排在「今年學年度」前面', () => {
    const tablet = css.slice(css.indexOf('@media (max-width: 1100px)'))
    expect(tablet).toContain('.ap-answer { order: 1; }')
    expect(tablet).toContain('.ap-field-static { order: 2; }')
  })
  it('班別格的「學年度」12px、不斷行', () => {
    expect(css).toContain('.ap-slot-year small { font-size: var(--fs-xs); white-space: nowrap; }')
  })
})

describe('關於頁結尾的校名緞帶連到那所校園', () => {
  it('緞帶帶 ?campus=，首頁五校從那所開始', () => {
    expect(read('../app/components/AboutContent.vue')).toContain(":to=\"{ path: '/', query: { campus: item.campus.key }, hash: '#campuses' }\"")
    const board = read('../app/components/CampusBoard.vue')
    expect(board).toContain("const requestedCampus = typeof route.query.campus === 'string' ? route.query.campus : ''")
    expect(board).toContain('campus.key === startCampus')
  })
})

describe('內容頁避免孤字、觸控不留 hover', () => {
  it('關於、特色教學、環境頁的內文 text-wrap:pretty（:where 不加權重）', () => {
    expect(read('../app/assets/css/about.css')).toContain('.abk :where(p,li,figcaption){text-wrap:pretty}')
    expect(read('../app/assets/css/curriculum.css')).toContain('.cur :where(p, li, figcaption) { text-wrap: pretty; }')
    expect(read('../app/assets/css/environment.css')).toContain('.renv :where(p,li,figcaption){text-wrap:pretty}')
    expect(read('../app/assets/css/admission-passport.css')).toContain('.ap li { text-wrap: pretty; }')
  })
  it('特色教學章節索引的 hover 包在 hover:hover 裡，focus-visible 留在外面', () => {
    const css = read('../app/assets/css/curriculum.css')
    expect(css).not.toContain('.cur-index a:is(:hover, :focus-visible)')
    expect(css).toContain('.cur-index a:focus-visible .cur-blot.is-painted')
    expect(css).toMatch(/@media \(hover: hover\) \{\n {2}\.cur-index a:hover \.cur-blot\.is-painted/)
  })
})
