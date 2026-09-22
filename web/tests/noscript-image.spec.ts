import { describe, expect, it } from 'vitest'
import { noscriptImage } from '../app/utils/noscript-image'

describe('noscript 圖片的安全 SSR fallback', () => {
  it('保留 responsive 圖片屬性並省略未定義尺寸', () => {
    const html = noscriptImage({ src: '/image.webp', srcset: '/small.webp 160w', sizes: '96px', width: undefined }, 'tour-image', '校園')
    expect(html).toContain('srcset="/small.webp 160w"')
    expect(html).toContain('sizes="96px"')
    expect(html).not.toContain('width=')
    expect(html).toContain('loading="lazy"')
  })

  it('CMS 文案和來源不能跳出 HTML attribute', () => {
    const html = noscriptImage({ src: '/image?x="&y=<tag>' }, 'tour-image', '\"><script>alert(1)</script>')
    expect(html).toContain('src="/image?x=&quot;&amp;y=&lt;tag&gt;"')
    expect(html).toContain('alt="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"')
    expect(html).not.toContain('<script>')
  })
})
