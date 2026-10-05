// 30 週年分頁「孩子畫的高雄地圖」：時間軸走到哪一年（可帶小數），地圖該長成什麼樣子。
// 純函式，伺服器端與測試都能算；畫面更新在 components/AnniversaryMap.vue。
import { ANNI_MILESTONES } from './timeline'

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** 區域塗色花多久（年）：成立那一年開始，從校園的位置往外塗開 */
export const MAP_FILL_YEARS = 0.8

export interface MapState {
  /** 每一段路線畫了多少（0–1），第 i 段是第 i 所到第 i+1 所 */
  route: number[]
  /** 每一所校園出現了沒（成立那一年起） */
  shown: boolean[]
  /** 以「讓該區開始塗色的校園」為鍵，塗了多少（0–1） */
  fill: Record<string, number>
  /** 正在畫的那一段與進度；還沒開始或全部畫完是 null */
  head: { seg: number; t: number } | null
}

export function mapStateAt(year: number): MapState {
  const ms = ANNI_MILESTONES
  const route = ms.slice(1).map((m, i) => clamp01((year - ms[i]!.year) / (m.year - ms[i]!.year)))
  const shown = ms.map((m) => year >= m.year)
  const fill = Object.fromEntries(ms.map((m) => [m.key, clamp01((year - m.year) / MAP_FILL_YEARS)]))
  const seg = route.findIndex((p) => p > 0 && p < 1)
  return { route, shown, fill, head: seg >= 0 ? { seg, t: route[seg]! } : null }
}
