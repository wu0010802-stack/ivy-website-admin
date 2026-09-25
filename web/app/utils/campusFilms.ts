import type { HomeFilm } from '../types/site-content'
import { backgroundVideoSrc } from './media-policy'
import { youtubeId, youtubeThumb } from './filmCarousel'

export type CampusFilm = HomeFilm

/**
 * 2026-09-23 手機版「活動影片」第一版：官網既有影片剪段（hero 為學校廣告修復片、day-film-mobile 為舞台表演原檔 960×540）。
 * 2026-09-25 起後台「首頁消息與活動」可以換掉整份清單（NewsContent.films）；還沒設定時官網用這裡的內建清單。
 * 2026-09-25 內建清單的舞台三段換成義華校 YouTube 頻道「寶貝的影像日記」的活動影片（ivykids.tw 活動頁內嵌），
 * 第一支仍是檔案，保留靜音預覽。YouTube 用 youtube('<網址>', 標題, 海報)。
 */
export const campusFilms: CampusFilm[] = [
  { id: 'run', title: '一起跑向前', type: 'file', src: backgroundVideoSrc('assets/hero-campus.mp4', true), start: 0, end: 9.7, poster: '/assets/campus-film-run.webp' },
  youtube('https://www.youtube.com/watch?v=T3AZm_UiDhY', '義華校：歡喜迎財神', '/assets/campus-film-new-year.webp'),
  youtube('https://www.youtube.com/watch?v=FrKkmwJSoIk', '義華校：果嶺公園親子放風箏', '/assets/campus-film-kite.webp'),
  youtube('https://www.youtube.com/watch?v=uifhjoU60uA', '義華校：大班英語演講比賽', '/assets/campus-film-speech.webp'),
  youtube('https://www.youtube.com/watch?v=nx8dmb5vwFs', '義華校：IVY 盃校際足球聯賽', '/assets/campus-film-football.webp')
]

/**
 * 沒給海報就用 YouTube 封面。義華頻道的封面是綠框大字，跟站上風格不合，所以改從影片畫面
 * （i.ytimg.com/vi/<id>/maxres1–3.jpg，1280×720）挑一張縮成 720×405 WebP 放 /assets。
 */
export function youtube(url: string, title: string, poster?: string): CampusFilm {
  const id = youtubeId(url)
  if (!id) throw new Error(`看不懂的 YouTube 連結：${url}`)
  return { id: `yt-${id}`, title, type: 'youtube', youtubeId: id, poster: poster ?? youtubeThumb(id) }
}
