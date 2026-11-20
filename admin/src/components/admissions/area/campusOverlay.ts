import type { AreaEnrolledOverview } from '../../../api/types'
import { formatCount } from './areaFormat'
import type { RankingItem, RankingSection } from './areaPane'

// 區域分析「五校版圖」模式（2026-11-20 規格 §6）：各校在籍學生的點、依「幾校有在籍」給里著色、右欄兩段排行與圖例。
// 純函式，不碰 Vue／Leaflet／API；只用各校各格各里的人數，不碰個別學生。

type Counts = Record<string, number>

/** 圓點的 class：顏色由 style.css 的 --area-campus-<key> 決定。 */
export const campusClass = (key: string): string => `area-campus area-campus--${key}`

/** 里的著色級別：0 校 → 0（不上色）、1 校 → 1、2 校以上 → 3（沿用 --area-level-*）。人數 0 的校不算。 */
export function overlayLevel(village: { counts: Counts }): 0 | 1 | 3 {
  const schools = Object.values(village.counts).filter((count) => count > 0).length
  return schools === 0 ? 0 : schools === 1 ? 1 : 3
}

/** 「義華 3・明華 2」：只列人數 > 0 的校，順序照 order（沒列在 order 的校接在後面）。 */
export function campusCountsText(counts: Counts, name: (key: string) => string, order: readonly string[] = []): string {
  const keys = [...order.filter((key) => key in counts), ...Object.keys(counts).filter((key) => !order.includes(key))]
  return keys.filter((key) => counts[key]! > 0).map((key) => `${name(key)} ${formatCount(counts[key]!)}`).join('・')
}

// 距離：不到 1 公里寫公尺，其餘一位小數的公里。
const distanceText = (meters: number): string =>
  meters < 1000 ? `${Math.round(meters)} 公尺` : `${(meters / 1000).toFixed(1)} 公里`

/** 右欄兩段：兩校以上都在收的里（合計降冪、全列）、孩子多但五校都沒有在籍的里（後端已取前 15，依 2–5 歲孩子數降冪）。空的段不列。 */
export function overlaySections(overview: AreaEnrolledOverview, campusName: (key: string) => string): RankingSection[] {
  const order = overview.campuses.map((item) => item.key)
  const overlap: RankingItem[] = [...overview.overlap]
    .sort((a, b) => b.total - a.total)
    .map((row) => ({
      code: row.village_code,
      name: `${row.district}${row.village}`,
      distance: '',
      value: `${formatCount(row.total)} 位`,
      detail: campusCountsText(row.counts, campusName, order),
    }))
  const gaps: RankingItem[] = [...overview.gaps]
    .sort((a, b) => b.children - a.children)
    .map((row) => ({
      code: row.village_code,
      name: `${row.district}${row.village}`,
      distance: `${campusName(row.nearest_campus_key)} ${distanceText(row.distance_m)}`,
      value: `2–5 歲 ${formatCount(row.children)} 位`,
      detail: '',
    }))
  return [
    { title: '兩校以上都在收的里', items: overlap },
    { title: '孩子多、五校都沒有在籍的里', items: gaps },
  ].filter((section) => section.items.length > 0)
}

export interface OverlayLegendItem {
  key: string
  label: string
  count: string
  imported: boolean
}

/** 圖例：五校各一列，色點由元件依 key 上色；未匯入的校寫「尚未匯入」並灰字。 */
export function overlayLegend(overview: AreaEnrolledOverview): OverlayLegendItem[] {
  return overview.campuses.map((item) => ({
    key: item.key,
    label: item.name,
    count: item.imported ? `${formatCount(item.total)} 位` : '尚未匯入',
    imported: item.imported,
  }))
}

/** 標題下一句；全都沒匯入時這句也是停用這個模式的原因。 */
export function overlayNote(overview: AreaEnrolledOverview): string {
  const names = overview.campuses.filter((item) => item.imported).map((item) => item.name)
  return names.length ? `只算已匯入清冊的校：${names.join('、')}` : '還沒有任何校區匯入在籍清冊'
}
