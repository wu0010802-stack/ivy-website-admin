import { MAP_MODES, type MapMode } from '../../../admissions/areaView'
import type {
  AdmissionsArea, AreaEnrolled, AreaOpportunity, AreaPeerFees, AreaTrends, AreaTrendsVillage, VillageBoundaries,
} from '../../../api/types'
import {
  NOT_JUDGED_NOTE, babycareStatusText, doorplateVersionLabel, enrolledMapNote, enrolledVillageRows, expectedText, formatCount,
  formatDistance, homesMapNote, opportunitySummary, opportunityUnavailable, populationVersionLabel, reasonLabel, signedCount,
  signedPercent, taipeiMonthDay, trendMapNote, trendsPlaceName, trendsSummary, type GradeFilter, type RadiusKm,
} from './areaFormat'
import { feeLagNote, peerSummaryText } from './peerFeesFormat'
import { featureCode, findFeature } from './villageFacts'

// 區域分析工作台右欄（2026-10-16 規格 §2.1、§2.3、§2.9）：哪些地圖模式停用與原因、預設模式、各模式的排行與標題區摘要、
// 頁尾的地址摘要與資料版本。純函式，不碰 Vue／Leaflet／API；文案沿用現有函式，這裡只挑選與組裝。

// ---- 模式停用、預設與退回（§2.1、D15）----

export interface ModeNotes {
  enrolled: string
  opportunity: string
  trend: string
  homes: string
  /** 附近參觀滿門檻（opportunity.baseline.judged）；招生機會還沒回來是 null（讀取中不算停用）。 */
  judged: boolean | null
}

/** 某個模式停用的原因；空字串＝可以用。參觀、同業不停用。 */
export function modeNote(mode: MapMode, notes: ModeNotes): string {
  switch (mode) {
    case 'enrolled':
      return notes.enrolled
    case 'children':
      return notes.opportunity
    case 'trend':
      return notes.trend
    case 'homes':
      return notes.homes
    case 'opportunity':
      return notes.opportunity || (notes.judged === false ? NOT_JUDGED_NOTE : '')
    default:
      return ''
  }
}

/** 預設模式：在籍學生可用（或讀取中）就是它，否則 2–5 歲孩子，再不行參觀。 */
export function defaultMapMode(notes: ModeNotes): MapMode {
  if (!modeNote('enrolled', notes)) return 'enrolled'
  return modeNote('children', notes) ? 'visits' : 'children'
}

/** 要的模式可用就用，停用（或沒指定）就退回預設模式。 */
export function resolveMapMode(requested: MapMode | null, notes: ModeNotes): MapMode {
  return requested !== null && !modeNote(requested, notes) ? requested : defaultMapMode(notes)
}

// ---- 排行與標題區 ----

export interface RankingItem {
  /** 里代碼；對不到時是 null（元件畫成不可點的文字）。 */
  code: string | null
  name: string
  distance: string
  value: string
  detail: string
  tone?: 'up' | 'down'
}
export interface RankingSection {
  /** 只有一段時是空字串。 */
  title: string
  items: RankingItem[]
}
export interface PaneHead {
  title: string
  lines: string[]
  note: string
  /** 這個模式沒有東西可排時要寫的一句；空字串＝照常顯示排行（或資料還沒到）。 */
  empty: string
}
export interface PaneData {
  boundaries: VillageBoundaries | null
  area: AdmissionsArea
  opportunity: AreaOpportunity | null
  trends: AreaTrends | null
  enrolled: AreaEnrolled | null
  gradeFilter: GradeFilter
  peerFees: AreaPeerFees | null
  /** 這個範圍還沒有招生訪視的說明（D14：只出現在參觀、招生機會模式）。 */
  emptyText: string
  radiusKm: RadiusKm
}

const TREND_SECTION_SIZE = 5
const placeName = (district: string, village: string): string => `${district}${village}`
const one = (items: RankingItem[]): RankingSection[] => [{ title: '', items }]

/** 排行列的里代碼：資料列有代碼就用，沒有就用區＋里名到里界檔找，再沒有是 null。 */
function codeOf(data: PaneData, villageCode: string | null, district: string, village: string): string | null {
  if (villageCode) return villageCode
  return data.boundaries ? featureCode(data.boundaries, district, village) : null
}

/**
 * 里的變化的列（一般的里或里界調整合併的組）的代碼：codes 裡第一個里界檔有的；里界還沒載到或都沒有（後端的 codes
 * 可能含已廢止的舊代碼）就用 codes[0]。
 */
function trendCode(data: PaneData, codes: readonly string[]): string | null {
  const found = data.boundaries ? codes.find((code) => findFeature(data.boundaries!, code) !== undefined) : undefined
  return found ?? codes[0] ?? null
}

/** 招生機會的列對里代碼的距離（其他模式的列沒有距離，借這份；半徑內人口表沒有的里沒有）。 */
function distanceByCode(data: PaneData): ReadonlyMap<string, number> {
  return new Map((data.opportunity?.villages ?? []).map((row) => [row.village_code, row.distance_m]))
}

function trendItem(data: PaneData, row: AreaTrendsVillage, value: string, detail: string, tone?: 'up' | 'down'): RankingItem {
  const item: RankingItem = {
    code: trendCode(data, row.codes), name: trendsPlaceName(row), distance: formatDistance(row.distance_m), value, detail,
  }
  return tone ? { ...item, tone } : item
}

/** 孩子增減的兩段：增加最多（>0）與減少最多（<0）各 5 個；孩子少與算不出來的不列，合併組照列。 */
function trendSections(data: PaneData): RankingSection[] {
  const rows = (data.trends?.villages ?? []).filter(
    (row) => row.kids_level !== 'few' && row.kids_level !== 'unknown' && row.kids_net !== null,
  )
  const detail = (row: AreaTrendsVillage): string =>
    row.kids_base ? signedPercent((row.kids_net! / row.kids_base) * 100) : ''
  const up = rows
    .filter((row) => row.kids_net! > 0)
    .sort((a, b) => b.kids_net! - a.kids_net!)
    .slice(0, TREND_SECTION_SIZE)
    .map((row) => trendItem(data, row, signedCount(row.kids_net), detail(row), 'up'))
  const down = rows
    .filter((row) => row.kids_net! < 0)
    .sort((a, b) => a.kids_net! - b.kids_net!)
    .slice(0, TREND_SECTION_SIZE)
    .map((row) => trendItem(data, row, signedCount(row.kids_net), detail(row), 'down'))
  return [
    { title: '增加最多', items: up },
    { title: '減少最多', items: down },
  ].filter((section) => section.items.length > 0)
}

/** 各模式的排行（規格 §2.3）；資料還沒到或沒有可排的是空列，由元件配 paneHead 的 empty 或骨架。名次由元件畫。 */
export function rankingFor(mode: Exclude<MapMode, 'peers'>, data: PaneData): RankingSection[] {
  switch (mode) {
    case 'enrolled': {
      if (!data.enrolled) return one([])
      const distances = distanceByCode(data)
      const byKey = new Map(data.enrolled.villages.map((row) => [row.village_code ?? `${row.district}/${row.village}`, row]))
      return one(
        enrolledVillageRows(data.enrolled, data.gradeFilter).map((row) => {
          const source = byKey.get(row.key)!
          const code = codeOf(data, source.village_code, source.district, source.village)
          return {
            code, name: row.place, distance: code && distances.has(code) ? formatDistance(distances.get(code)) : '',
            value: `${formatCount(row.count)} 位`, detail: '',
          }
        }),
      )
    }
    case 'children':
      return one(
        [...(data.opportunity?.villages ?? [])]
          .filter((row) => row.children > 0)
          .sort((a, b) => b.children - a.children)
          .map((row) => ({
            code: row.village_code, name: placeName(row.district, row.village), distance: formatDistance(row.distance_m),
            value: `${formatCount(row.children)} 位`, detail: `0–1 歲 ${formatCount(row.infants)} 位`,
          })),
      )
    case 'trend':
      return trendSections(data)
    case 'homes':
      return one(
        [...(data.trends?.villages ?? [])]
          .filter((row) => (row.new_homes ?? 0) > 0)
          .sort((a, b) => b.new_homes! - a.new_homes!)
          .map((row) => trendItem(data, row, `${formatCount(row.new_homes!)} 筆`, '')),
      )
    case 'visits': {
      const distances = distanceByCode(data)
      return one(
        [...data.area.villages]
          .filter((row) => row.visit > 0)
          .sort((a, b) => b.visit - a.visit)
          .map((row) => {
            const code = codeOf(data, row.village_code, row.district, row.village)
            return {
              code, name: placeName(row.district, row.village), distance: code && distances.has(code) ? formatDistance(distances.get(code)) : '',
              value: `${formatCount(row.visit)} 位`, detail: `預繳 ${formatCount(row.deposit)}`,
            }
          }),
      )
    }
    case 'opportunity': {
      if (!data.opportunity?.baseline?.judged) return one([])
      return one(
        data.opportunity.villages
          .filter((row) => row.signal === 'below')
          .sort((a, b) => (b.shortfall ?? 0) - (a.shortfall ?? 0))
          .map((row) => ({
            code: row.village_code, name: placeName(row.district, row.village), distance: formatDistance(row.distance_m),
            value: `少約 ${formatCount(Math.max(1, Math.round(row.shortfall ?? 0)))} 位`,
            detail: row.expected === null ? `參觀 ${formatCount(row.visit)} 位` : `參觀 ${formatCount(row.visit)} 位・應有${expectedText(row.expected)}`,
          })),
      )
    }
  }
}

/** 在籍學生摘要：「5 位，2 位（40%）住 1 公里內、3 位（60%）住 3 公里內。」百分比四捨五入成整數，3 公里內含 1 公里內。 */
export function enrolledSummary(data: AreaEnrolled): string {
  const bandTotal = (band: string): number =>
    Object.values(data.distance_bands.find((item) => item.band === band)?.counts ?? {}).reduce((sum, count) => sum + count, 0)
  const within1 = bandTotal('0-1')
  const within3 = within1 + bandTotal('1-3')
  const share = (count: number): number => (data.total ? Math.round((count / data.total) * 100) : 0)
  return `${formatCount(data.total)} 位，${formatCount(within1)} 位（${share(within1)}%）住 1 公里內、${formatCount(within3)} 位（${share(within3)}%）住 3 公里內。`
}

// 里的變化總結的句子沒有分類欄位，只能認開頭（areaPane.test.ts 守住，句子改了測試會紅）。
const isKidsLine = (line: string): boolean => line.startsWith('本校 ') || line.startsWith('近 12 個月出生')
const isHomesLine = (line: string): boolean => line.startsWith('近 4 季新屋交屋')
// 總結的 note 是「里界調整合併」「淨增算不出的原因」「新屋只到區」三段直接相接，新屋那段屬於新屋交屋模式。
const HOMES_NOTE_START = '範圍內的區另有'
function splitTrendsNote(note: string): { kids: string; homes: string } {
  const index = note.indexOf(HOMES_NOTE_START)
  return index < 0 ? { kids: note, homes: '' } : { kids: note.slice(0, index), homes: note.slice(index) }
}

const noVisits = (data: PaneData): boolean => data.area.totals.visit === 0
const modeTitle = (mode: MapMode): string => MAP_MODES.find((item) => item.value === mode)!.label

/** 右欄標題區（規格 §2.3）：標題、一到兩句摘要、小字、沒有東西可排時的一句。 */
export function paneHead(mode: MapMode, data: PaneData): PaneHead {
  const head: PaneHead = { title: modeTitle(mode), lines: [], note: '', empty: '' }
  switch (mode) {
    case 'enrolled': {
      const enrolled = data.enrolled
      if (!enrolled) return head
      if (enrolled.status !== 'ready') return { ...head, empty: enrolledMapNote(enrolled, false) }
      return { ...head, lines: [enrolledSummary(enrolled)], note: `清冊 ${(enrolled.roster_date ?? '').replaceAll('-', '/')}` }
    }
    case 'children': {
      const opportunity = data.opportunity
      if (!opportunity) return head
      const unavailable = opportunityUnavailable(opportunity)
      if (unavailable) return { ...head, empty: unavailable }
      const summary = opportunitySummary(opportunity)
      const noKids = !opportunity.villages.some((row) => row.children > 0)
      return { ...head, lines: summary ? [summary.lead] : [], empty: noKids ? '半徑內的里沒有 2–5 歲孩子的資料。' : '' }
    }
    case 'trend': {
      const trends = data.trends
      if (!trends) return head
      const summary = trendsSummary(trends)
      return {
        ...head,
        lines: summary ? summary.lines.filter(isKidsLine) : [],
        note: summary ? splitTrendsNote(summary.note).kids : '',
        empty: trendMapNote(trends),
      }
    }
    case 'homes': {
      const trends = data.trends
      if (!trends) return head
      const summary = trendsSummary(trends)
      const unavailable = homesMapNote(trends)
      const noHomes = !trends.villages.some((row) => (row.new_homes ?? 0) > 0)
      return {
        ...head,
        lines: summary ? summary.lines.filter(isHomesLine) : [],
        note: summary ? splitTrendsNote(summary.note).homes : '',
        empty: unavailable || (noHomes ? '半徑內近 4 季沒有新屋交屋。' : ''),
      }
    }
    case 'visits': {
      const address = addressSummary(data.area)
      const line = address.text ? `${address.text}${address.tail}` : ''
      const noRows = !data.area.villages.some((row) => row.visit > 0)
      const empty = noVisits(data) ? data.emptyText : address.noAddress || (noRows ? '這個範圍還沒有定位到里的參觀。' : '')
      return { ...head, lines: line ? [line] : [], empty }
    }
    case 'opportunity': {
      const opportunity = data.opportunity
      if (noVisits(data)) head.empty = data.emptyText
      if (!opportunity) return head
      const unavailable = opportunityUnavailable(opportunity)
      if (unavailable) return { ...head, empty: head.empty || unavailable }
      const summary = opportunitySummary(opportunity)
      return { ...head, lines: summary ? [summary.verdict] : [], note: summary?.note ?? '' }
    }
    case 'peers':
      return { ...head, title: '附近的同業', lines: data.peerFees ? [peerSummaryText(data.peerFees)] : [] }
  }
}

// ---- 頁尾（§2.9）----

export interface AddressSummary {
  /** 「參觀有地址 N 筆：到里 a 筆、未定位到里 b 筆（…）」；沒有可比對的地址是空字串。 */
  text: string
  /** text 後面要不要接「查看」（開未定位到里的訪視明細）。 */
  showLink: boolean
  /** 「查看」後面接的「；另有 g 筆沒填地址」；沒有就空字串。 */
  tail: string
  /** 有訪視但沒有任何可比對的地址時的說明（沒填、已匿名清除）；其餘空字串。 */
  noAddress: string
}

/**
 * 參觀的地址摘要（原 AreaTab 狀態列，主控裁定 R5）：以「有地址」為母數——「參觀有地址 N 筆：到里 a 筆、未定位到里 b 筆
 * （只到區 c、查無門牌 d、非高雄市 e、待比對 f）」，括號只列非零項；沒填地址的另外寫，已匿名化不放在這裡。
 * c、f 用後端合計欄位（只到區、待比對的列不一定有原因），d、e 取自未定位原因。
 */
export function addressSummary(area: AdmissionsArea): AddressSummary {
  const { totals } = area
  if (!totals.with_address) {
    return { text: '', showLink: false, tail: '', noAddress: noAddressText(totals) }
  }
  const reasonCount = (reason: string): number => totals.unlocated_reasons.find((item) => item.reason === reason)?.count ?? 0
  const parts: [string, number][] = [
    ['只到區', totals.district_level],
    [reasonLabel('no_doorplate'), reasonCount('no_doorplate')],
    ['非高雄市', reasonCount('outside_kaohsiung')],
    ['待比對', totals.pending],
  ]
  const breakdown = parts.filter(([, count]) => count > 0).map(([label, count]) => `${label} ${count}`).join('、')
  const noVillage = totals.with_address - totals.village_level
  const unlocated = noVillage ? `、未定位到里 ${noVillage} 筆${breakdown ? `（${breakdown}）` : ''}` : ''
  return {
    text: `參觀有地址 ${totals.with_address} 筆：到里 ${totals.village_level} 筆${unlocated}`,
    showLink: noVillage > 0,
    tail: totals.no_address ? `；另有 ${totals.no_address} 筆沒填地址` : '',
    noAddress: '',
  }
}

/**
 * 有訪視但沒有任何可比對的地址時的說明。此時 visit ＝ no_address ＋ anonymized：
 * 只有沒填地址、只有已匿名化（地址已依保存期限清除）、兩者都有，各寫各的，不把匿名化說成「沒填」。
 */
function noAddressText(totals: AdmissionsArea['totals']): string {
  if (!totals.visit || totals.with_address) return ''
  const { no_address: noAddress, anonymized } = totals
  if (!anonymized) return '這個範圍的訪視都還沒填地址。'
  if (!noAddress) return '這個範圍的訪視地址都已依保存期限清除，無法比對。'
  return `這個範圍的訪視沒有可比對的地址：${noAddress} 筆沒填地址、${anonymized} 筆已依保存期限清除。`
}

export interface DataStatusSegments {
  /** 門牌那一段；沒匯入時是以句號結尾的一整句。 */
  doorplate: string
  doorplateImported: boolean
  /** 其餘各段，用「・」相接。 */
  rest: string
}

/** 資料版本分段：門牌（沒匯入的那句帶句號，所以和後面分開排，不接「。・」）與其餘各段。 */
export function dataStatusSegments(area: AdmissionsArea, enrolled: AreaEnrolled | null, peerFees: AreaPeerFees | null): DataStatusSegments {
  const { data_status: status } = area
  const rest = [
    status.kindergartens_synced_at ? `幼兒園名單 ${taipeiMonthDay(status.kindergartens_synced_at)} 更新` : '幼兒園名單尚未匯入',
    babycareStatusText(status.babycare_synced_at),
    status.population_version ? `各里人口 ${populationVersionLabel(status.population_version)}` : '各里人口尚未匯入',
    enrolled?.status === 'ready' && enrolled.roster_date ? `在籍清冊 ${enrolled.roster_date.replaceAll('-', '/')}` : '',
    peerFees?.school_year != null
      ? `收費 ${peerFees.school_year} 學年公告${feeLagNote(peerFees.school_year, peerFees.current_school_year) ? `（目前是 ${peerFees.current_school_year} 學年）` : ''}`
      : '',
  ]
    .filter(Boolean)
    .join('・')
  return {
    doorplate: status.doorplate_version
      ? `門牌資料 ${doorplateVersionLabel(status.doorplate_version)}版`
      : '門牌資料尚未匯入，家長地址暫時對不到里、算不出距離；匯入後自動補上。',
    doorplateImported: Boolean(status.doorplate_version),
    rest,
  }
}

/**
 * 頁尾的資料版本一行：門牌、幼兒園名單、托嬰名單、各里人口，再接在籍清冊日期與收費學年（收費學年落後目前學年時接「（目前是 115 學年）」）。
 * 門牌沒匯入的那句已經以句號結尾，直接接下一段、不接「。・」。
 */
export function dataStatusText(area: AdmissionsArea, enrolled: AreaEnrolled | null, peerFees: AreaPeerFees | null): string {
  const { doorplate, doorplateImported, rest } = dataStatusSegments(area, enrolled, peerFees)
  return `${doorplate}${doorplateImported ? '・' : ''}${rest}`
}
