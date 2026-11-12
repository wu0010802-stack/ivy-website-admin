// ?daybg=current|hands|handsraw 設 cookie 後重新整理；左下角切換鈕同樣做法。
(() => {
  const params = new URLSearchParams(location.search)
  const want = params.get('daybg')
  const now = (document.cookie.match(/(?:^|; )daybg=(\w+)/) || [])[1] || 'current'
  if (want && want !== now) { document.cookie = `daybg=${want}; path=/`; location.replace(location.pathname + location.hash); return }
  const box = document.createElement('div')
  box.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:2147483647;display:flex;flex-wrap:wrap;gap:6px;font:13px/1 system-ui,sans-serif'
  for (const [k, label] of [['current', '現行（義華遊藝表演）'], ['hands', '明華幼幼・六鏡＋紗加重'], ['handsraw', '明華幼幼・六鏡（紗不加重）']]) {
    const b = document.createElement('button')
    b.textContent = label
    b.style.cssText = `padding:8px 12px;border-radius:999px;border:1px solid #2D8F5A;cursor:pointer;${k === now ? 'background:#2D8F5A;color:#fff' : 'background:#fff;color:#2D8F5A'}`
    b.onclick = () => { document.cookie = `daybg=${k}; path=/`; location.reload() }
    box.append(b)
  }
  document.body.append(box)
})()
