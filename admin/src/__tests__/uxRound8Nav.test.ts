// 2026-10-03 第八輪：長編輯頁的段落目錄（稽核 09-28「超長編輯頁沒有段落導覽」）。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import EditorSectionNav from '../components/EditorSectionNav.vue'
import { jumpToSection } from '../composables/editorSections'

const readSource = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const wrappers: VueWrapper[] = []
const originalScroll = Element.prototype.scrollIntoView
afterEach(() => {
  wrappers.forEach((w) => w.unmount())
  wrappers.length = 0
  vi.restoreAllMocks()
  Element.prototype.scrollIntoView = originalScroll
  document.body.innerHTML = ''
})

describe('段落目錄', () => {
  it('列出每一段；點一下捲到那一段的標題、焦點移過去、標成目前這段', async () => {
    document.body.innerHTML = '<h2 id="sec-a" data-section-anchor tabindex="-1">最新消息</h2><h2 id="sec-b" data-section-anchor>近期活動</h2>'
    const scrolled: string[] = []
    Element.prototype.scrollIntoView = function (this: Element) { scrolled.push(this.id) } as never
    const wrapper = mount(EditorSectionNav, {
      props: { sections: [{ id: 'sec-a', label: '最新消息', note: '3 則' }, { id: 'sec-b', label: '近期活動' }] },
      attachTo: document.body,
    })
    wrappers.push(wrapper)
    expect(wrapper.get('nav').attributes('aria-label')).toBe('這一頁的段落')
    const links = wrapper.findAll('a')
    expect(links.map((a) => a.attributes('href'))).toEqual(['#sec-a', '#sec-b'])
    expect(links[0]!.get('.section-nav__label').text()).toBe('最新消息')
    expect(links[0]!.get('.section-nav__note').text()).toBe('3 則')
    expect(links[1]!.find('.section-nav__note').exists()).toBe(false)

    await links[1]!.trigger('click')
    expect(scrolled).toEqual(['sec-b'])
    expect(document.activeElement?.id).toBe('sec-b')
    // 原本沒有 tabindex 的標題補上 -1，焦點才移得過去。
    expect(document.getElementById('sec-b')!.getAttribute('tabindex')).toBe('-1')
    expect(links[1]!.attributes('aria-current')).toBe('location')
    expect(links[0]!.attributes('aria-current')).toBeUndefined()
  })

  it('找不到標題時不動、回 false', () => {
    expect(jumpToSection('no-such-section')).toBe(false)
  })

  it('ContentEditor：至少兩段才放目錄；桌機 1280 以上表單右側一欄，窄螢幕在表單上方', () => {
    const editor = readSource('../components/ContentEditor.vue')
    expect(editor).toContain("import EditorSectionNav from './EditorSectionNav.vue'")
    expect(editor).toMatch(/hasNav = computed\(\(\) => navSections\.value\.length >= MIN_NAV_SECTIONS\)/)
    expect(editor).toMatch(/<EditorSectionNav v-if="hasNav" :sections="navSections" class="editor__nav" \/>/)
    const desktop = /@media \(min-width: 1280px\) \{[^@]*\}/.exec(editor)![0]
    expect(desktop).toContain('grid-template-columns: minmax(0, 1fr) 184px')
    expect(desktop).toContain('.editor--with-nav:not(.editor--wide) { max-width: 928px; }')
    const nav = readSource('../components/EditorSectionNav.vue')
    // 窄螢幕膠囊列自己橫捲，不撐寬頁面；觸控 44px。
    expect(nav).toMatch(/\.section-nav ol \{[^}]*overflow-x: auto;/)
    expect(nav).toMatch(/\.section-nav a \{[^}]*min-height: 44px;/)
    const css = readSource('../style.css')
    expect(css).toMatch(/\[data-section-anchor\] \{ scroll-margin-top: 80px; \}/)
  })
})
