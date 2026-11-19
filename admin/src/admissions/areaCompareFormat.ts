import type { AreaCompareRow } from '../api/types'
import { campusLabel } from '../api/labels'
import { campusNotLocatedReason, formatCount, kindLabel, signedCount } from '../components/admissions/area/areaFormat'
import { formatYuan } from '../components/admissions/area/peerFeesFormat'
import { NO_VALUE } from './statsFormat'

// 五校周邊環境表（2026-11-16 規格 §6.2）的格子文字。純函式，不碰 Vue／API。

export const AREA_COMPARE_NOTE = '人口為最新月份；收費為 3 歲、和私立一般園所比；幼兒園家數不含常春藤各校。'

const count = (value: number | null | undefined): string => (value === null || value === undefined ? NO_VALUE : formatCount(value))

function campusCell(row: AreaCompareRow): string {
  const name = campusLabel(row.campus_key)
  if (row.unavailable === 'error') return `${name}（讀取失敗）`
  if (row.unavailable === 'no_campus_point') return `${name}（位置未標示${campusNotLocatedReason(row.locate_error) ? `：${campusNotLocatedReason(row.locate_error)}` : ''}）`
  return name
}

function rankCell(row: AreaCompareRow): string {
  // 本校不是私立一般：只和私立一般比，不是的沒有排名，寫實際類型。
  if (row.own_kind !== null && row.own_kind !== 'private') return `本校${kindLabel(row.own_kind)}`
  if (row.own_missing === 'no_fee') return '本校沒有公布收費'
  if (row.own_missing === 'not_found') return '找不到本校'
  if (row.fee_rank !== null && row.fee_rank_total !== null) return `第 ${row.fee_rank} 高／共 ${row.fee_rank_total}`
  return NO_VALUE
}

/** 一列的各欄文字；鍵同表格欄位（校區、人口、增減、四種幼兒園、托嬰、本校收費、中位數、排名、異動）。 */
export function areaCompareCells(row: AreaCompareRow): Record<string, string> {
  const campus = campusCell(row)
  if (row.unavailable !== null) {
    return {
      campus, children: NO_VALUE, kids_net: NO_VALUE, kg_private: NO_VALUE, kg_quasi_public: NO_VALUE, kg_public: NO_VALUE,
      kg_nonprofit: NO_VALUE, babycare: NO_VALUE, own_fee: NO_VALUE, fee_median: NO_VALUE, fee_rank: NO_VALUE, changes_12m: NO_VALUE,
    }
  }
  return {
    campus,
    children: count(row.children),
    kids_net: signedCount(row.kids_net),
    kg_private: count(row.kindergartens?.private),
    kg_quasi_public: count(row.kindergartens?.quasi_public),
    kg_public: count(row.kindergartens?.public),
    kg_nonprofit: count(row.kindergartens?.nonprofit),
    babycare: count(row.babycare),
    own_fee: formatYuan(row.own_fee),
    fee_median: formatYuan(row.fee_median),
    fee_rank: rankCell(row),
    changes_12m: count(row.changes_12m),
  }
}
