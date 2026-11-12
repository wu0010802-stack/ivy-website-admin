// 孩子的一天背景比稿（2026-11-11）：cookie daybg=hands 時，拍立得上來後深綠紗加重（handsraw 不加，對照用）。
// 11-10 查到「太雜」的原因之一：正式站的深綠紗在大標淡掉後反而變輕。--focus-p 0→1 跟著大標淡出的進度走（沿用 focus.js）。
(() => {
  const v = (document.cookie.match(/(?:^|; )daybg=(\w+)/) || [])[1]
  if (v !== 'hands') return
  const root = document.documentElement
  root.dataset.dayveil = '1'
  // 正式站把大標淡出的進度寫在 .day-intro 的 --word-fade（1 → .16）；沒寫的時候（例如減少動態）改看有沒有拍立得成為當下
  const progress = () => {
    const raw = document.querySelector('.day-intro')?.style.getPropertyValue('--word-fade')
    if (raw) return Math.min(1, Math.max(0, (1 - parseFloat(raw)) / 0.84))
    return document.querySelector('.day-print.is-active') ? 1 : 0
  }
  let frame = 0, watched = null
  const queue = () => { if (!frame) frame = requestAnimationFrame(tick) }
  const tick = () => {
    frame = 0
    // 正式站在自己的 frame 裡寫 --word-fade，比這裡的捲動 frame 晚；直接盯著 .day-intro 的 style 才不會停在上一格的值
    const intro = document.querySelector('.day-intro')
    if (intro && intro !== watched) { watched = intro; new MutationObserver(queue).observe(intro, { attributes: true, attributeFilter: ['style'] }) }
    const p = progress()
    root.style.setProperty('--focus-p', (p * p * (3 - 2 * p)).toFixed(3))
  }
  addEventListener('scroll', queue, { passive: true })
  addEventListener('resize', queue)
  addEventListener('load', () => setTimeout(tick, 400))
  tick()
})()
