// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { ref } from 'vue'
import { useRelayProgress } from '../app/composables/useCurtain'

// 首頁「關於」簾幕擦除時，「的一天」三個字跟著接力淡入（studio.css 的 .relay-day .t-day）。
function mount() {
  document.body.innerHTML = `
    <section class="home-belief"><div class="belief-backdrop"><span class="wm-b">常春藤</span></div></section>
    <h2 class="day-title"><span class="t-ivy">常春藤</span><span class="t-day">的一天</span></h2>`
  const panel = ref(document.querySelector<HTMLElement>('.home-belief'))
  const relay = useRelayProgress(panel)
  relay.measure()
  return { relay, word: document.querySelector<HTMLElement>('.t-day')! }
}

describe('簾幕接力進度', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('style')
  })

  it('只寫在「的一天」上，不寫到 <html>（寫在根節點會讓整頁每幀重算樣式）', () => {
    const { relay, word } = mount()
    relay(0.4, 844)
    relay(1, 844)
    expect(document.documentElement.getAttribute('style') ?? '').toBe('')
    expect(word.style.getPropertyValue('--relay-day')).toBe('1.000')
  })

  it('擦完之前「的一天」藏著；簾幕停用時直接顯示', () => {
    const { relay, word } = mount()
    relay(0, 844)
    expect(word.style.getPropertyValue('--relay-day')).toBe('0.000')
    relay(null, 844)
    expect(word.style.getPropertyValue('--relay-day')).toBe('1')
  })

  it('值沒變就不重寫（捲動中大部分幀都停在 0 或 1）', () => {
    const { relay, word } = mount()
    relay(0.2, 844)
    let writes = 0
    const setProperty = word.style.setProperty.bind(word.style)
    word.style.setProperty = (...args: Parameters<CSSStyleDeclaration['setProperty']>) => { writes++; setProperty(...args) }
    relay(0.3, 844)
    relay(0.35, 844)
    expect(writes).toBe(0)
  })
})
