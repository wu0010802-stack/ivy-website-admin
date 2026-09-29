import videos from '../generated/video-manifest.json'

export interface ConnectionInfo { saveData?: boolean; effectiveType?: string }

export function mayAutoplay(reducedMotion: boolean, connection?: ConnectionInfo): boolean {
  return !reducedMotion && !connection?.saveData && !/^(slow-2g|2g|3g)$/.test(connection?.effectiveType ?? '')
}

// mobile 決定的是編碼版本（手機 CRF 較高、同解析度同構圖），不是素材：橫拿手機雖然寬度過了 760，
// 仍拿手機編碼；後台另傳的手機影片（可能是直式裁切）要不要用，由呼叫端依寬度決定。
export function backgroundVideoSrc(source: string, mobile: boolean): string {
  if (source === 'assets/hero-campus.mp4') return mobile ? videos['hero-mobile'] : videos['hero-desktop']
  if (source === 'assets/day-film.mp4') return mobile ? videos['day-mobile'] : videos['day-desktop']
  if (source === 'assets/day-film-mobile.mp4') return videos['day-mobile']
  return `/${source.replace(/^\//, '')}`
}
