// 30 週年紀念影片關燈時四周的光（components/AnniversaryFilm.vue）。只在瀏覽器用，所以和 film.ts（伺服器端也引用）分開。

/**
 * 關燈時影片四周的光：把正在播的畫面縮成很小一張（預設 32px 寬）畫到 canvas，CSS 再放大、模糊。
 * 每次只疊三成，換鏡頭時光慢慢換過去，不會跟著剪接閃。回傳的 stop() 之後不再取樣。
 */
export function createAmbient(video: HTMLVideoElement, canvas: HTMLCanvasElement, long = 32) {
  const g = canvas.getContext('2d', { alpha: false })
  let raf = 0, last = 0, on = false
  const fit = () => {
    const w = video.videoWidth || 16, h = video.videoHeight || 9
    const cw = w >= h ? long : Math.max(2, Math.round(long * w / h)), ch = w >= h ? Math.max(2, Math.round(long * h / w)) : long
    if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch }
  }
  const draw = (alpha: number) => {
    if (!g || video.readyState < 2) return
    fit()
    g.globalAlpha = alpha
    try { g.drawImage(video, 0, 0, canvas.width, canvas.height) } catch { /* 影片還沒有可畫的畫面 */ }
  }
  const loop = (t: number) => {
    if (!on) return
    if (t - last > 80) { last = t; draw(0.3) }
    raf = requestAnimationFrame(loop)
  }
  return {
    start() { if (on) return; on = true; draw(1); raf = requestAnimationFrame(loop) },
    stop() { on = false; cancelAnimationFrame(raf) },
    /** 暫停時補一張完整的（拖時間軸之後） */
    snap() { draw(1) }
  }
}
