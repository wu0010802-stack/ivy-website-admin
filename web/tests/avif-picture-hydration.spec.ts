// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, createSSRApp, defineComponent, h, nextTick, ref, type App } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ResponsivePicture from '../app/components/ResponsivePicture.vue'
import ScopedHost from './fixtures/scoped-picture-host.vue'
import { responsiveImage } from '../app/utils/responsive-image'

// <ResponsivePicture> 的 SSR 輸出要能被 client 無痛 hydrate（有／沒有 AVIF、呼叫端是 scoped 都一樣），
// ref 抓元件時能拿到 <img>（HeroVideo 看首屏照片有沒有載完用），avifSrcset 之後才出現時換成 <picture> 不出錯。
const warnings: string[] = []
let app: App | undefined
afterEach(() => { app?.unmount(); app = undefined; warnings.length = 0; document.body.innerHTML = '' })

async function hydrate(root: () => ReturnType<typeof h>) {
  const html = await renderToString(createSSRApp({ render: root }))
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.append(host)
  const before = host.innerHTML
  app = createSSRApp({ render: root })
  app.config.warnHandler = (message) => { warnings.push(message) }
  app.mount(host)
  await nextTick()
  return { host, html, before }
}

describe('<ResponsivePicture> hydration', () => {
  const photo = () => ({ ...responsiveImage('about-curious', '100vw'), alt: '孩子', loading: 'lazy', class: 'photo', style: { objectPosition: '10% 20%' } })

  it('有 AVIF：hydrate 沒有 mismatch、DOM 不變', async () => {
    const { host, before } = await hydrate(() => h(ResponsivePicture, photo()))
    expect(warnings.filter((message) => /hydrat/i.test(message))).toEqual([])
    expect(host.innerHTML).toBe(before)
    expect(host.querySelector('picture.responsive-picture > source[type="image/avif"] + img.photo')).not.toBeNull()
  })

  it('沒有 AVIF：hydrate 沒有 mismatch、仍是單一 <img>', async () => {
    const { host, before } = await hydrate(() => h(ResponsivePicture, { src: '/a.webp', alt: 'x', class: 'photo' }))
    expect(warnings.filter((message) => /hydrat/i.test(message))).toEqual([])
    expect(host.innerHTML).toBe(before)
    expect(host.querySelector('picture')).toBeNull()
    expect(host.querySelector('img.photo')).not.toBeNull()
  })

  it('呼叫端是 scoped：SSR 與 client 的 data-v-* 一致，hydrate 沒有 mismatch', async () => {
    const { host, before } = await hydrate(() => h(ScopedHost, { avifSrcset: '/a.avif 800w' }))
    expect(warnings.filter((message) => /hydrat/i.test(message))).toEqual([])
    expect(host.innerHTML).toBe(before)
    const scope = (ScopedHost as { __scopeId?: string }).__scopeId!
    expect(host.querySelector(`picture[${scope}]`)).not.toBeNull()
    expect(host.querySelector(`picture > img[${scope}]`)).not.toBeNull()
  })
})

describe('<ResponsivePicture> client', () => {
  it('ref 抓元件：.img 是真正的 <img>（有 AVIF 在 <picture> 裡，沒有時就是根元素）', async () => {
    const pic = ref<{ img: HTMLImageElement | null } | null>(null)
    const withAvif = ref(true)
    const host = document.createElement('div')
    document.body.append(host)
    app = createApp(defineComponent({
      setup: () => () => h(ResponsivePicture, { ref: pic, src: '/a.webp', srcset: '/a.webp 800w', sizes: '100vw', avifSrcset: withAvif.value ? '/a.avif 800w' : undefined, alt: '' })
    }))
    app.mount(host)
    await nextTick()
    expect(pic.value!.img).toBeInstanceOf(HTMLImageElement)
    expect(pic.value!.img!.parentElement!.tagName).toBe('PICTURE')
    expect(host.querySelector('source')!.getAttribute('sizes')).toBe('100vw')
    // 延後載入的封面：avifSrcset 之後才出現／消失，換 DOM 結構時 ref 跟著指到新的 <img>
    withAvif.value = false
    await nextTick()
    expect(host.querySelector('picture')).toBeNull()
    expect(pic.value!.img).toBe(host.querySelector('img'))
    withAvif.value = true
    await nextTick()
    expect(pic.value!.img!.parentElement!.tagName).toBe('PICTURE')
    expect(host.querySelectorAll('img')).toHaveLength(1)
  })
})
