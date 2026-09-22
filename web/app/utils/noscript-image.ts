interface ImageAttributes {
  src: string
  srcset?: string
  sizes?: string
  width?: number
  height?: number
}

const entities: Record<string, string> = { '&': '&amp;', '"': '&quot;', "'": '&#39;', '<': '&lt;', '>': '&gt;' }

// JS 開啟時，瀏覽器把 noscript 內容解析成文字，而非 img 子節點。
// 使用已跳脫的 innerHTML，避免 Vue hydration 嘗試比對不存在的子元素。
export function noscriptImage(image: ImageAttributes, className: string, alt: string): string {
  const attributes = {
    class: className, src: image.src, srcset: image.srcset, sizes: image.sizes,
    width: image.width, height: image.height, alt, loading: 'lazy', decoding: 'async'
  }
  return '<img' + Object.entries(attributes)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => ` ${name}="${String(value).replace(/[&"'<>]/g, char => entities[char]!)}"`)
    .join('') + '>'
}
