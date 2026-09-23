import { backgroundVideoSrc } from './media-policy'
import { youtubeId, youtubeThumb } from './filmCarousel'

/** 標題不顯示，只當螢幕閱讀器的名稱。 */
export type CampusFilm =
  | { id: string; title: string; type: 'file'; src: string; start: number; end: number; poster: string }
  | { id: string; title: string; type: 'youtube'; youtubeId: string; poster: string }

/**
 * 2026-09-23 手機版「活動影片」第一版：官網既有影片剪段（hero 為學校廣告修復片、day-film-mobile 為舞台表演原檔 960×540）。
 * 後台還沒有影片欄位；要換成園方影片或 YouTube 連結先改這裡，YouTube 用 youtube('<網址>', 標題)。
 */
export const campusFilms: CampusFilm[] = [
  { id: 'run', title: '一起跑向前', type: 'file', src: backgroundVideoSrc('assets/hero-campus.mp4', true), start: 0, end: 9.7, poster: '/assets/campus-film-run.webp' },
  { id: 'stage', title: '準備好了，上台！', type: 'file', src: '/assets/day-film-mobile.mp4', start: 0.2, end: 5.4, poster: '/assets/campus-film-stage.webp' },
  { id: 'dance', title: '大家一起來跳舞', type: 'file', src: '/assets/day-film-mobile.mp4', start: 7.6, end: 12.2, poster: '/assets/campus-film-dance.webp' },
  { id: 'family', title: '跳給家人看', type: 'file', src: '/assets/day-film-mobile.mp4', start: 14, end: 19.4, poster: '/assets/campus-film-family.webp' }
]

export function youtube(url: string, title: string, id = youtubeId(url)): CampusFilm {
  if (!id) throw new Error(`看不懂的 YouTube 連結：${url}`)
  return { id: `yt-${id}`, title, type: 'youtube', youtubeId: id, poster: youtubeThumb(id) }
}
