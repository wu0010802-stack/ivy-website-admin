// 30 週年分頁首屏的紀念影片《長成自己喜歡的樣子》（components/AnniversaryFilm.vue）。
// 2026-11-11 起取代 10-04 的 30 秒開場動畫《手牽手，走到 30》：新片 2 分 24 秒、有配樂，不能當一進頁面就自動播的開場，
// 改成首屏的放映區——先是無聲預告，按了才從頭播放（有聲音）、整頁關燈。
// 這裡只放不碰 DOM 的資料與換算：utils/seo.ts（伺服器端也會用）與測試都直接引用。四周的光在 film-ambient.ts。

export const FILM_TITLE = '長成自己喜歡的樣子'
/** 片長（秒）：4320 格、30 fps */
export const FILM_SECONDS = 144
export const FILM_FPS = 30
/** 結構化資料的上線日期 */
export const FILM_UPLOAD_DATE = '2026-11-11'
/** 視窗比 4:5 還瘦（直拿手機、直放平板）播直式那一版；和 10-04 的開場動畫同一條分界 */
export const FILM_PORTRAIT = '(max-aspect-ratio: 4/5)'
/** 鋼琴取樣是 CC BY 3.0：頁面上要留出處 */
export const FILM_CREDIT = '原創配樂。鋼琴取樣：Salamander Grand Piano V3（Alexander Holm，CC BY 3.0）'

export interface FilmCue {
  /** 這一段第一個鏡頭在全片的第幾格（點了從這裡播） */
  frame: number
  /** 片中的句子：全部是官網已上線的文字，不另外寫 */
  text: string
}

// 「影片裡的話」：片中打出來的六句，依出現順序。第一句在片中 0:48 才打出來，但它講的是 0:00 起的那一段（五所校園）。
export const FILM_CUES: readonly FilmCue[] = [
  { frame: 0, text: '從一間幼兒園，長成五所校園。' },
  { frame: 1600, text: '孩子的第一所學校，也是第二個家。' },
  { frame: 2160, text: '在遊戲裡，慢慢長大。' },
  { frame: 2560, text: '每一天，都有新發現。' },
  { frame: 2720, text: '把每個孩子，放在心上。' },
  { frame: 3360, text: '陪伴每一個孩子，長成自己喜歡的樣子。' }
]

export const cueSeconds = (cue: FilmCue): number => cue.frame / FILM_FPS

/** 0:53 這種寫法（不補零的分＋兩位秒） */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** 播到 seconds 時是哪一句（還沒開始播回 -1）。每一句從自己那一段的第一個鏡頭亮到下一句開始。 */
export function cueIndexAt(seconds: number, cues: readonly FilmCue[] = FILM_CUES): number {
  if (!(seconds >= 0)) return -1
  let found = -1
  for (let i = 0; i < cues.length; i++) if (seconds + 1e-3 >= cueSeconds(cues[i]!)) found = i
  return found
}

/** 「2 分 24 秒」 */
export function durationLabel(seconds: number = FILM_SECONDS): string {
  const m = Math.floor(seconds / 60), s = Math.round(seconds % 60)
  return s ? `${m} 分 ${s} 秒` : `${m} 分鐘`
}

/** schema.org 的 ISO 8601 片長：PT2M24S */
export function isoDuration(seconds: number = FILM_SECONDS): string {
  const m = Math.floor(seconds / 60), s = Math.round(seconds % 60)
  return `PT${m}M${s}S`
}

export interface PosterSource { readonly src: string; readonly width: number }
export const posterSrcset = (list: readonly PosterSource[]): string => list.map((p) => `${p.src} ${p.width}w`).join(', ')
