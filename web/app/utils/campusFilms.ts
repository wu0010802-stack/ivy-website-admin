import type { HomeFilm } from '../types/site-content'
import { backgroundVideoSrc } from './media-policy'
import { youtubeId, youtubeThumb } from './filmCarousel'

export type CampusFilm = HomeFilm

/**
 * 2026-09-23 手機版「活動影片」第一版：官網既有影片剪段（hero 為學校廣告修復片、day-film-mobile 為舞台表演原檔 960×540）。
 * 2026-09-25 起後台「首頁消息與活動」可以換掉整份清單（NewsContent.films）；還沒設定時官網用這裡的內建清單。
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
