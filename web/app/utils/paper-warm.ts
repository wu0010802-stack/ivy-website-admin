// 日常卡片紙張（utils/paperPrints.ts）要用的 three 不進首屏 prefetch（2026-09-30，nuxt.config 的 build:manifest）：
// 改在整頁載完 3 秒後的閒置時段、或第一張卡片接近時暖載。只下載＋求值（CPU 4× 實測約 11 ms），
// 建場照舊等捲動停下（DayMomentCard 的 readyForPaper）。減少動態、沒有 WebGL 時 warmThree 不載。
// 多等 3 秒是讓開首屏影片：它也是載完後閒置才起播，兩者同時下載時 20 Mbps 手機的 LCP（影片第一幀）晚 0.1–0.2 s。
const AFTER_LOAD_MS = 3000
let scheduled = false
let warmed = false

export function warmPaper(): void {
  if (warmed) return
  warmed = true
  void import('./paperPrints').then((m) => m.warmThree()).catch(() => {})
}

export function warmPaperWhenIdle(): void {
  if (scheduled) return
  scheduled = true
  const idle = () => window.setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(warmPaper, { timeout: 4000 })
    else warmPaper()
  }, AFTER_LOAD_MS)
  if (document.readyState === 'complete') idle()
  else window.addEventListener('load', idle, { once: true })
}
