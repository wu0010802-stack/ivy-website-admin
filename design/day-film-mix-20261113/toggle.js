// ?daybg=current|mix|pick|pick2 設 cookie 後重新整理；左下角切換鈕同樣做法。
(() => {
  const params = new URLSearchParams(location.search)
  const want = params.get('daybg')
  const now = (document.cookie.match(/(?:^|; )daybg=(\w+)/) || [])[1] || 'current'
  if (want && want !== now) { document.cookie = `daybg=${want}; path=/`; location.replace(location.pathname + location.hash); return }
  if (params.has('bare')) return // 截圖用：不顯示切換鈕
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;display:flex;flex-wrap:wrap;gap:6px;font:13px/1 system-ui,sans-serif'
  for (const [k, label] of [['current', '現行（明華幼幼六鏡）'], ['mix', '第一輪：十五鏡混剪'], ['pick', '第二輪：你挑的十四鏡'], ['pick2', '同上・小女孩那鏡補掉字幕（手機才有差）'], ['pick3', '第三輪：十六鏡（小女孩臉＋手）'], ['pick4', '第四輪：十五鏡']]) {
    const b = document.createElement('button')
    b.textContent = label
    b.style.cssText = `padding:8px 12px;border-radius:999px;border:1px solid #2D8F5A;cursor:pointer;${k === now ? 'background:#2D8F5A;color:#fff' : 'background:#fff;color:#2D8F5A'}`
    b.onclick = () => { document.cookie = `daybg=${k}; path=/`; location.reload() }
    box.append(b)
  }
  document.body.append(box)
  // 第二排：影片上的遮罩（cookie dayshade）
  const shade = (document.cookie.match(/(?:^|; )dayshade=(\w+)/) || [])[1] || 'on'
  const row = document.createElement('div')
  row.style.cssText = box.style.cssText.replace('bottom:12px', 'bottom:52px')
  const opts = [['on', '遮罩：照現在'], ['cards', '只留大標那一屏的紗'], ['off', '紗全部拿掉']]
  if (now === 'pick4') opts.push(['raw', '紗拿掉＋影片也不壓暗'])
  for (const [k, label] of opts) {
    const b = document.createElement('button')
    b.textContent = label
    b.style.cssText = `padding:8px 12px;border-radius:999px;border:1px solid #2D8F5A;cursor:pointer;${k === shade ? 'background:#2D8F5A;color:#fff' : 'background:#fff;color:#2D8F5A'}`
    b.onclick = () => { document.cookie = `dayshade=${k}; path=/`; location.reload() }
    row.append(b)
  }
  document.body.append(row)
})()
