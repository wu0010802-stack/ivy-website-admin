// LINE Seed TW 完整字型的其餘 unicode-range 分片（後台新增的字、ExtraBold）宣告在另一支帶雜湊的 CSS
// （scripts/subset-critical-fonts.py 產生，網址在 font-manifest.json 的 stylesheet）。首屏與官網既有
// 用字已由 inline 的 font-subsets.css 宣告，這支在執行時才掛上：不阻塞首屏渲染，也不讓每頁 HTML 多
// 幾十 KB 的 unicode-range；樣式表本身只有 @font-face，字型檔要等頁面真的用到那些字才下載。

/** 把其餘分片的樣式表掛到 <head>；已經掛過就沿用同一個 <link>。 */
export function attachTitleFontStylesheet(doc: Document, href: string): HTMLLinkElement {
  for (const link of doc.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) {
    if (link.getAttribute('href') === href) return link
  }
  const link = doc.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  doc.head.append(link)
  return link
}
