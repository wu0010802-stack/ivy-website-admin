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

// 首屏影片另有一份 AV1 10-bit（2026-10-24，design/hero-video-polish-20261024）：VMAF 同分時約小 35–40%，
// 暗部與散景的漸層也不容易起色階。H.264 仍是後備，day 影片與 CMS 上傳的影片照舊只有 H.264。
// codecs 字串對應 1080×800／30fps 的 Main profile、level 3.1、10-bit。
export const HERO_AV1_TYPE = 'video/mp4; codecs="av01.0.05M.10"'

// 母帶不是確認版時 optimize-site-videos.py 不會產生 AV1 鍵，這裡就回 null。
export function heroAv1Src(source: string, mobile: boolean): string | null {
  if (source !== 'assets/hero-campus.mp4') return null
  return (videos as Record<string, string | undefined>)[mobile ? 'hero-mobile-av1' : 'hero-desktop-av1'] ?? null
}

export interface DecodingVerdict { supported: boolean; smooth: boolean; powerEfficient: boolean }

// 要瀏覽器回報能順播才用；觸控裝置（手機、平板）還要硬體解碼，免得低階機用軟體解碼耗電、掉格。
// 桌機軟體解 1080p30 的 AV1 負擔很小，Chrome／Firefox／Edge 照用。Safari 只在有硬體解碼器時回報支援。
export function preferAv1(verdict: DecodingVerdict | null, coarsePointer: boolean): boolean {
  return !!verdict && verdict.supported && verdict.smooth && (verdict.powerEfficient || !coarsePointer)
}

type DecodingInfoQuery = (config: {
  type: 'file'
  video: { contentType: string; width: number; height: number; bitrate: number; framerate: number }
}) => Promise<DecodingVerdict>

// 查不到（沒有 MediaCapabilities、拋錯或超過 400 ms）一律回 null，呼叫端就用 H.264。
export async function heroAv1Verdict(query: DecodingInfoQuery | undefined, mobile: boolean): Promise<DecodingVerdict | null> {
  if (!query) return null
  const config = { type: 'file' as const, video: { contentType: HERO_AV1_TYPE, width: 1080, height: 800, bitrate: mobile ? 1_500_000 : 3_000_000, framerate: 30 } }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      query(config),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 400) }),
    ])
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
