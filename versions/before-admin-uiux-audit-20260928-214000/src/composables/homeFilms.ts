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

/**
 * 片段的結束秒數要大於開始秒數；知道影片長度（duration，秒）時不能超過影片長度
 * （跟後端存檔檢查相同：播不到的結束秒數會讓官網整支重播）。沒問題回空字串。
 */
export function filmClipError(film: HomeFilmPayload, duration?: number | null): string {
  if (film.source !== 'file' || film.end == null) return ''
  if (film.end <= film.start) return '結束秒數要大於開始秒數'
  if (duration && film.end > duration) return `影片只有 ${formatSeconds(duration)} 秒，結束秒數不能超過影片長度（留空＝播到結尾）`
  return ''
}

/** 知道影片長度時，開始秒數要小於影片長度；沒問題回空字串。 */
export function filmStartError(film: HomeFilmPayload, duration?: number | null): string {
  if (film.source !== 'file' || !duration || film.start < duration) return ''
  return `影片只有 ${formatSeconds(duration)} 秒，開始秒數要小於影片長度`
}

function formatSeconds(value: number): string {
  return String(Math.round(value * 100) / 100)
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
