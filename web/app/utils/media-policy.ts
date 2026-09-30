import videos from '../generated/video-manifest.json'

export interface ConnectionInfo { saveData?: boolean; effectiveType?: string; downlink?: number }

export function mayAutoplay(reducedMotion: boolean, connection?: ConnectionInfo): boolean {
  return !reducedMotion && !connection?.saveData && !/^(slow-2g|2g|3g)$/.test(connection?.effectiveType ?? '')
}

// 首屏影片另有頻寬門檻：影片疊在同一張封面上、第一幀畫出來就成為新的 LCP（比封面大 1px 列），
// 慢速 4G 會把 LCP 從封面的 1.4 s 拉到影片第一幀。2026-09-30 實驗室（390×844、CPU 4×、RTT 150 ms、正常快取、略過布幕）：
// downlink 1.65→LCP 4.48 s、3→2.81 s、4.4→2.54 s、7.5→2.01 s，約 5 Mbps 越過 2.5 s（output/playwright/mobile-perf-deep-20260930）。
// 低於門檻比照 3G 留靜態封面。downlink 只有 Chromium 系提供（Safari／Firefox 沒有 → 照舊自動播放）；
// Chromium 沒有頻寬估計時回報上限 10（network_state_notifier.cc RoundMbps「return the fastest value」），不會把快的網路誤判成慢。
// 不改用 Resource Timing 自己估：DevTools 限速與真實 TCP slow start 下，小檔的收資料時間都被延遲主導，20 Mbps 只量到 3.5。
export const HERO_MIN_DOWNLINK_MBPS = 5

export function heroMayAutoplay(reducedMotion: boolean, connection?: ConnectionInfo): boolean {
  const downlink = connection?.downlink
  const slow = typeof downlink === 'number' && Number.isFinite(downlink) && downlink > 0 && downlink < HERO_MIN_DOWNLINK_MBPS
  return mayAutoplay(reducedMotion, connection) && !slow
}

// mobile 決定的是編碼版本（手機 CRF 較高、同解析度同構圖），不是素材：橫拿手機雖然寬度過了 760，
// 仍拿手機編碼；後台另傳的手機影片（可能是直式裁切）要不要用，由呼叫端依寬度決定。
export function backgroundVideoSrc(source: string, mobile: boolean): string {
  if (source === 'assets/hero-campus.mp4') return mobile ? videos['hero-mobile'] : videos['hero-desktop']
  if (source === 'assets/day-film.mp4') return mobile ? videos['day-mobile'] : videos['day-desktop']
  if (source === 'assets/day-film-mobile.mp4') return videos['day-mobile']
  return `/${source.replace(/^\//, '')}`
}
