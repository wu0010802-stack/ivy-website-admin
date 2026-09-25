import type { HomeFilmPayload } from '../api/types'

/** 跟後端 content/schemas.HOME_FILMS_MAX 相同。 */
export const HOME_FILMS_MAX = 8

// 跟後端 content/schemas.youtube_id、官網 utils/filmCarousel.ts 的 youtubeId 同一套規則。
const YOUTUBE_RE = /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([\w-]{11})/

/** 常見的 YouTube 網址或 11 碼影片 ID；看不懂回空字串。 */
export function youtubeIdOf(value: string): string {
  const text = value.trim()
  const match = YOUTUBE_RE.exec(text)
  if (match) return match[1]!
  return /^[\w-]{11}$/.test(text) ? text : ''
}

export function newHomeFilm(): HomeFilmPayload {
  return {
    id: `film-${Date.now().toString(36)}`,
    title: '',
    source: 'file',
    video: null,
    start: 0,
    end: null,
    poster: null,
    youtube_url: '',
  }
}

/** 片段的結束秒數要大於開始秒數；沒問題回空字串。 */
export function filmClipError(film: HomeFilmPayload): string {
  if (film.source !== 'file' || film.end == null) return ''
  return film.end <= film.start ? '結束秒數要大於開始秒數' : ''
}

export function filmYoutubeError(film: HomeFilmPayload): string {
  if (film.source !== 'youtube' || !film.youtube_url.trim()) return ''
  return youtubeIdOf(film.youtube_url) ? '' : '看不懂的 YouTube 連結，請貼影片網址'
}

/** 舊版本沒有的欄位補預設值（載入時比對變更才不會多列）。 */
export function normalizeHomeFilm(film: Partial<HomeFilmPayload> & { id: string }): HomeFilmPayload {
  return {
    title: '',
    source: 'file',
    video: null,
    start: 0,
    end: null,
    poster: null,
    youtube_url: '',
    ...film,
  } as HomeFilmPayload
}
