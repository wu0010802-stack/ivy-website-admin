// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiFieldErrors, focusNextFieldOnEnter, validateVisitContact } from '../app/utils/visit-form'
import { wrapLines } from '../app/utils/cjkWrap'

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
  // 導言與選校說明 2026-10-30 全站拿掉（使用者要版面乾淨），矮手機只剩眉標要藏
  it('620 以下拿掉眉標', () => {
    const shorter = visitCss.slice(visitCss.indexOf('@media(max-width:760px) and (max-height:620px)'))
    expect(shorter).toContain(".visit-page[data-step='1'] .visit-eyebrow {display:none}")
    expect(visitForm).not.toContain('visit-lead')
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
    expect(visitForm).toContain('if (!submitRetryHint.value && !focusInvalidField) await focusError()')
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

describe('30 週年頁', () => {
  const css = read('../app/assets/css/anniversary.css')
  const content = read('../app/components/AnniversaryContent.vue')
  it('五校卡的電話與「地圖 ↗」補到 44px 點擊範圍，窄螢幕列距拉開不重疊', () => {
    expect(css).toContain('.anni-campus-info a::before { content: ""; position: absolute; inset: -13px -6px; }')
    expect(css).toMatch(/@media \(max-width: 760px\) \{\n {2}\.anni-campus-info \{ row-gap: 20px; \}/)
  })
  it('非建校年份不用 opacity 淡化', () => {
    const year = css.slice(css.indexOf('.anni-year {'), css.indexOf('}', css.indexOf('.anni-year {')))
    expect(year).not.toContain('opacity')
  })
  it('畫紙寬度跟著視窗高度收：手指在畫紙上是畫畫，整張畫紙要放得進視窗', () => {
    expect(css).toContain('.anni-pad { width: min(100%, calc((100svh - 100px) * 1.6)); margin-inline: auto;')
    expect(css).toContain('.anni-pad { aspect-ratio: 4 / 5; width: min(100%, calc((100svh - 160px) * .8)); }')
  })
  it('橫拿手機計數列不黏頂', () => {
    expect(css).toMatch(/@media \(max-width: 1100px\) and \(max-height: 500px\) \{\n {2}\.anni-mapcard \{ position: relative; top: auto; \}/)
  })
  it('結尾舞台高度在第一幀就留好，結尾也觸發掛上：返回與 #anni-cake 落在對的段落', () => {
    expect(css).toContain('html[data-ivy-motion] .anni-finale-stage { min-height: max(100svh, 560px); }')
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{\n {2}html\[data-ivy-motion\] \.anni-finale \{ height: 250vh; height: 250svh; \}/)
    expect(content).toContain("lazy([track.value, root.value.querySelector<HTMLElement>('.anni-finale')], async () => {")
  })
  it('作品燈箱點背景關閉', () => {
    expect(content).toContain('@click="closeLightboxOnBackdrop"')
    expect(content).toContain('if (e.target === lightbox.value) lightbox.value?.close()')
  })
  it('內文 text-wrap:pretty', () => {
    expect(css).toContain('.anni :where(p, li, figcaption), .anni-art-list span { text-wrap: pretty; }')
  })
  it('開場按鈕底色加深；深色蓋層 5 秒沒開始播就拿掉', () => {
    const intro = read('../app/components/AnniversaryIntro.vue')
    expect(intro).toContain('background: rgb(var(--ink) / .75); color: var(--paper);')
    expect(intro).toContain("setTimeout(function(){if(d.dataset.anniIntro==='pending')delete d.dataset.anniIntro},5000)")
  })
  it('總覽地圖校名 12px、年份 11px，補點擊範圍；授權署名與區名不再疊 opacity', () => {
    const map = read('../app/components/AnniversaryMap.vue')
    expect(map).toContain('font: 700 clamp(12px, 3.3cqi, 14px)/1.25 var(--font-head)')
    expect(map).toContain('.anni-map-campus a span { font: 600 11px/1 var(--font);')
    expect(map).toContain('.anni-map-campus a::before { content: ""; position: absolute; inset: -13px -4px; }')
    expect(map).not.toMatch(/\.anni-map-source \{[^}]*opacity/)
    expect(map).not.toMatch(/\.anni-map-district \{[^}]*opacity/)
  })
})

describe('404 與全站', () => {
  const error = read('../app/error.vue')
  it('404 的五校校名是連到該校預約頁的連結；橫拿手機校徽縮小、上距收短', () => {
    expect(error).toContain('<NuxtLink class="error-campus-name" :to="`/visit/${campus.key}`">{{ campus.name }}</NuxtLink>')
    expect(error).not.toContain('<span class="error-campus-name">')
    expect(error).toContain('@media(max-width:1179px) and (max-height:500px) and (orientation:landscape) {.error-page {padding-top:24px}.error-crest {--size:96px;margin-bottom:8px}}')
  })
  it('theme-color 寫在 nuxt.config（錯誤頁也有），不在 app.vue', () => {
    expect(read('../nuxt.config.ts')).toContain("meta: [{ name: 'theme-color', content: '#fdfcf6' }],")
    expect(read('../app/app.vue')).not.toContain('theme-color')
  })
  it('SPA 換頁有讀屏播報', () => {
    expect(read('../app/app.vue')).toContain('<NuxtRouteAnnouncer />')
    expect(error).toContain('<NuxtRouteAnnouncer />')
  })
  it('手機選單卡標出目前這一頁', () => {
    expect(read('../app/assets/css/studio.css')).toContain('.menu-links a[aria-current] .menu-link-copy>span {text-decoration:underline;')
  })
})

describe('首頁', () => {
  it('#campuses 包在最新消息簾幕的 sticky 裡：章節設 after＋pinned，簾幕在動時直接捲到孩子的一天擦完的位置', () => {
    expect(read('../app/pages/index.vue')).toContain("{ id: 'campuses', after: '.day-reveal-track', pinned: true },")
    const anchors = read('../app/composables/useChapterAnchors.ts')
    expect(anchors).toContain(`if (chapter.pinned && track.closest('[data-motion="on"]')) {`)
    // 從別頁連過來要等版面穩定（路由自己的錨點捲動晚到）；重新整理、上一頁／下一頁不搶回章節
    expect(anchors).toContain('waitForStableHeight().then(() => { if (!disposed) scrollPastCurtain(chapter) })')
    expect(anchors).toContain('if (initialLoad ? restoredLoad() : history.state?.scroll) return')
  })
  it('拍立得背面避免孤字：DOM 版 text-wrap:pretty', () => {
    expect(read('../app/assets/css/styles.css')).toContain('.print-face p,.day-note{text-wrap:pretty}')
  })
  it('暫停圓鈕被拍立得蓋到時沉到卡片下面', () => {
    expect(read('../app/assets/css/styles.css')).toContain('.day-film-ui[data-covered="1"]{z-index:0}')
  })
  it('橫拿手機五校照片高度不超過膠囊下方的可見高度', () => {
    expect(read('../app/components/CampusBoard.vue')).toContain('@media(max-height:500px) and (orientation:landscape){.gallery-track{height:min(clamp(340px,46vw,480px),calc(100svh - 120px))}}')
  })
})

describe('wrapLines（拍立得 WebGL 貼圖折行）', () => {
  const mono = { measureText: (text: string) => ({ width: Array.from(text).length }) }
  it('段落最後一行只剩一個字加標點時，從上一行帶一個字下來', () => {
    // 寬 6 字：貪婪折行是「一二三四五六／七。」
    expect(wrapLines(mono, '一二三四五六七。', 6)).toEqual(['一二三四五', '六七。'])
  })
  it('照舊遵守禁則：標點不放行首、開括號不留在行尾', () => {
    expect(wrapLines(mono, '一二三四五，六七八', 5)).toEqual(['一二三四', '五，六七八'])
    expect(wrapLines(mono, '一二三四「五六七', 5)).toEqual(['一二三四', '「五六七'])
  })
  it('最後一行夠長、或只有一行時不動；每個換行段落各自處理', () => {
    expect(wrapLines(mono, '一二三四五六七八', 6)).toEqual(['一二三四五六', '七八'])
    expect(wrapLines(mono, '一二三', 6)).toEqual(['一二三'])
    expect(wrapLines(mono, '一二三四五六七\n八九', 6)).toEqual(['一二三四五', '六七', '八九'])
  })
})
