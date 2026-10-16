import { NO_VALUE, type StatsColumn } from '../../../admissions/statsFormat'
import type {
  AreaEnrolled, AreaOpportunity, AreaOpportunityRow, AreaTrends, AreaTrendsVillage, KidsLevel, OpportunitySignal, VillageBoundaries,
} from '../../../api/types'
import type { CsvCell } from '../../../utils/csv'
import {
  ENROLLED_GRADE_ORDER, KIDS_LEVEL_LABELS, expectedText, formatCount, formatDistance, homesText, incomeText, kidsNetText,
  opportunityUnavailable, pointCount, populationVersionLabel, seasonRange, signalText, signedCount, trendsPlaceName, trendsUnavailable,
  villageSchoolsText,
} from './areaFormat'
import { findFeature } from './villageFacts'

// 區域分析「各里」表（2026-10-16 規格 §2.8、D11、D15–D17）：把招生機會、里的變化、在籍學生合成一張表的純函式。
// 列以 trends 為底（含里界調整合併的組），用 codes[] 對 opportunity 與 enrolled；trends 讀不到時改以 opportunity 為底。
// 欄位格式沿用 OpportunityPanel 與 VillageTrendsPanel（Task 9 刪掉那兩個面板後這裡是唯一的來源）。

export type VillageSort = 'shortfall' | 'children' | 'up' | 'down' | 'homes' | 'enrolled'

export interface VillageTableRow extends Record<string, unknown> {
  /** 表格的列鍵：trends 的 key，opportunity 為底時是里代碼。 */
  key: string
  /** 地圖選取用的里代碼：codes 裡第一個在里界找得到的，都找不到（或沒給里界）用 codes[0]。 */
  code: string
  /** 這一列涵蓋的全部里代碼；合併組有好幾個。 */
  codes: string[]
  place: string
  merged: boolean
  distance: string
  distance_m: number
  /** 2–5 歲；沒有人口資料是 null。 */
  children: number | null
  children_text: string
  /** 0–1 歲（只有招生機會有）；opportunity 沒到或沒有這個里是 null。 */
  infants: number | null
  infants_text: string
  kids_net: number | null
  kids_base: number | null
  kids_level: KidsLevel
  kids_text: string
  level_text: string
  births_12m: number | null
  births_text: string
  migration_net_12m: number | null
  migration_text: string
  new_homes: number | null
  new_homes_latest: number | null
  homes_text: string
  income_median: number | null
  income_boundary_changed: boolean
  income_year: number | null
  income_text: string
  schools_text: string
  /** CSV 的國小學區（沒有就空白，分隔用「；」）。 */
  schools_csv: string
  /** 在籍人數；名冊沒匯入或還沒到是 null（不是 0）。 */
  enrolled: number | null
  /** 各班在籍人數（ENROLLED_GRADE_ORDER 每一班都有）；沒有名冊是 null。 */
  enrolled_counts: Record<string, number> | null
  /** 參觀人數；opportunity 沒到是 null。合併組是組內各里加總（D16）。 */
  visit: number | null
  rate: number | null
  expected: number | null
  expected_text: string
  /** 判讀；合併組、沒到門檻（judged 不是 true）、沒有招生機會列都是 null。 */
  signal: OpportunitySignal | null
  shortfall: number | null
  signal_text: string
}

// ---- 列 ----

interface BuildContext {
  opportunity: AreaOpportunity | null
  judged: boolean
  enrolled: AreaEnrolled | null
  incomeYear: number | null
  boundaries: VillageBoundaries | null
}

interface RowSource {
  key: string
  district: string
  village: string
  codes: string[]
  merged: boolean
  distance_m: number
  trends: AreaTrendsVillage | null
}

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0)

/**
 * 這一列在在籍名冊裡的人數：先比里代碼（合併組是組內任一代碼）；沒有任何名冊列對到代碼，才比區＋里名
 * （同里卡片 villageFacts 的 `find(code) ?? find(name)`：名冊對不到里界的列 village_code 是 null）。
 * 合併組的名稱後備只看和組同區的成員。
 */
function enrolledFor(
  enrolled: AreaEnrolled | null, codes: readonly string[], district: string, names: readonly string[],
): { total: number; counts: Record<string, number> } | null {
  if (!enrolled) return null
  const counts: Record<string, number> = Object.fromEntries(ENROLLED_GRADE_ORDER.map((grade) => [grade, 0]))
  const byCode = enrolled.villages.filter((item) => item.village_code !== null && codes.includes(item.village_code))
  const matched = byCode.length
    ? byCode
    : enrolled.villages.filter((item) => item.district === district && names.includes(item.village))
  for (const item of matched) {
    for (const grade of ENROLLED_GRADE_ORDER) counts[grade] = counts[grade]! + (item.counts[grade] ?? 0)
  }
  return { total: pointCount(counts, 'all'), counts }
}

function buildRow(context: BuildContext, source: RowSource): VillageTableRow {
  const { opportunity, judged } = context
  const { codes, merged, trends: t } = source
  const oppRows: AreaOpportunityRow[] = opportunity ? opportunity.villages.filter((row) => codes.includes(row.village_code)) : []
  // 一般的里只對到一列招生機會；合併組對到組內有人口的各里（可能不是每一個）。
  const single = !merged && oppRows.length === 1 ? oppRows[0]! : null

  const children = t?.children ?? (merged ? null : (single?.children ?? null))
  const infants = oppRows.length ? sum(oppRows.map((row) => row.infants)) : null
  // 沒有人口資料的里不在招生機會的列裡，但參觀照樣有人來：用 no_population_villages 的人數，不當成 0 位參觀。
  const visit = !opportunity
    ? null
    : oppRows.length
      ? sum(oppRows.map((row) => row.visit))
      : sum(opportunity.no_population_villages.filter((item) => codes.includes(item.village_code)).map((item) => item.visit))
  // 合併組（D16）：參觀率＝加總參觀 ÷ 組的 2–5 歲；照附近應有要涵蓋同一批里，有一個沒有附近平均就整格不寫（同里卡片）。
  const rate = single ? single.rate : merged && oppRows.length && children ? ((visit ?? 0) / children) * 100 : null
  // 後端每一列的 expected 已四捨五入到小數一位：加總會冒浮點雜訊（4.3 + 2.9＝7.199999999999999），加完再收回一位。
  const expected =
    oppRows.length && oppRows.every((row) => row.expected !== null)
      ? Math.round(sum(oppRows.map((row) => row.expected!)) * 10) / 10
      : null
  const verdict = judged && single ? single : null

  const enrolledRowNames = merged ? source.village.split('、').filter(Boolean) : [source.village]
  const roster = enrolledFor(context.enrolled, codes, source.district, enrolledRowNames)

  const kidsLevel: KidsLevel = t?.kids_level ?? 'unknown'
  const code = codes.find((item) => context.boundaries !== null && findFeature(context.boundaries, item) !== undefined) ?? codes[0] ?? ''
  return {
    key: source.key,
    code,
    codes: [...codes],
    place: t ? trendsPlaceName(t) : `${source.district}${source.village}`,
    merged,
    distance: formatDistance(source.distance_m),
    distance_m: source.distance_m,
    children,
    children_text: children === null ? NO_VALUE : formatCount(children),
    infants,
    infants_text: infants === null ? NO_VALUE : formatCount(infants),
    kids_net: t?.kids_net ?? null,
    kids_base: t?.kids_base ?? null,
    kids_level: kidsLevel,
    kids_text: t ? kidsNetText(t) : NO_VALUE,
    level_text: KIDS_LEVEL_LABELS[kidsLevel],
    births_12m: t?.births_12m ?? null,
    births_text: t && t.births_12m !== null ? formatCount(t.births_12m) : NO_VALUE,
    migration_net_12m: t?.migration_net_12m ?? null,
    migration_text: signedCount(t?.migration_net_12m),
    new_homes: t?.new_homes ?? null,
    new_homes_latest: t?.new_homes_latest ?? null,
    homes_text: t ? homesText(t) : NO_VALUE,
    income_median: t?.income_median ?? null,
    income_boundary_changed: t?.income_boundary_changed ?? false,
    income_year: context.incomeYear,
    income_text: t ? incomeText(t) : NO_VALUE,
    schools_text: t ? villageSchoolsText(t) : NO_VALUE,
    schools_csv: t?.schools.length ? villageSchoolsText(t, '；') : '',
    enrolled: roster ? roster.total : null,
    enrolled_counts: roster ? roster.counts : null,
    visit,
    rate,
    expected,
    expected_text: expectedText(expected),
    signal: verdict ? verdict.signal : null,
    shortfall: verdict ? verdict.shortfall : null,
    signal_text: verdict ? signalText(verdict) : NO_VALUE,
  }
}

/**
 * 各里表的列（未排序，後端順序）。底是 trends；trends 讀不到（null）就用 opportunity，里的變化欄寫「—」；兩份都沒有是空陣列。
 * judged＝`opportunity.baseline.judged === true`（D15，不是 opportunityUnavailable）：沒到門檻列上不帶判讀。
 * boundaries 只用來挑 `code`（合併組的第一個代碼可能是已廢止的舊代碼，里界檔裡沒有，選取地圖要用找得到的那個）。
 */
export function villageTableRows(
  trends: AreaTrends | null,
  opportunity: AreaOpportunity | null,
  enrolled: AreaEnrolled | null,
  boundaries: VillageBoundaries | null = null,
): VillageTableRow[] {
  const context: BuildContext = {
    opportunity,
    judged: opportunity?.baseline?.judged === true,
    enrolled: enrolled?.status === 'ready' ? enrolled : null,
    incomeYear: trends?.sources.income.year ?? null,
    boundaries,
  }
  if (trends) {
    return trends.villages.map((village) =>
      buildRow(context, {
        key: village.key, district: village.district, village: village.village, codes: village.codes, merged: village.merged,
        distance_m: village.distance_m, trends: village,
      }),
    )
  }
  return (opportunity?.villages ?? []).map((row) =>
    buildRow(context, {
      key: row.village_code, district: row.district, village: row.village, codes: [row.village_code], merged: false,
      distance_m: row.distance_m, trends: null,
    }),
  )
}

// ---- 排序 ----

/** 有值的在前（desc＝大的在前），沒有值（null）一律排最後；同數保留原順序（Array.sort 是穩定的）。 */
function byNumber(rows: readonly VillageTableRow[], pick: (row: VillageTableRow) => number | null, desc: boolean): VillageTableRow[] {
  return [...rows].sort((a, b) => {
    const x = pick(a)
    const y = pick(b)
    if (x === null || y === null) return x === y ? 0 : x === null ? 1 : -1
    return desc ? y - x : x - y
  })
}

/** 參觀偏少：有 shortfall 的依少最多排前面；其次是有判讀但沒有 shortfall 的（孩子少）；最後是沒有判讀的（合併組、沒有招生機會列）。 */
function shortfallTier(row: VillageTableRow): number {
  return row.shortfall !== null ? 0 : row.signal !== null ? 1 : 2
}

export function sortVillageRows(rows: readonly VillageTableRow[], sort: VillageSort): VillageTableRow[] {
  switch (sort) {
    case 'shortfall':
      return [...rows].sort((a, b) => {
        const tier = shortfallTier(a) - shortfallTier(b)
        return tier || (a.shortfall !== null && b.shortfall !== null ? b.shortfall - a.shortfall : 0)
      })
    case 'children':
      return byNumber(rows, (row) => row.children, true)
    case 'up':
      return byNumber(rows, (row) => row.kids_net, true)
    case 'down':
      return byNumber(rows, (row) => row.kids_net, false)
    case 'homes':
      return byNumber(rows, (row) => row.new_homes, true)
    default:
      return byNumber(rows, (row) => row.enrolled, true)
  }
}

export function villageSortOptions(judged: boolean): { value: VillageSort; label: string }[] {
  return [
    ...(judged ? [{ value: 'shortfall' as const, label: '參觀偏少' }] : []),
    { value: 'children', label: '孩子最多' },
    { value: 'up', label: '增加最多' },
    { value: 'down', label: '減少最多' },
    { value: 'homes', label: '新屋最多' },
    { value: 'enrolled', label: '在籍最多' },
  ]
}

/** D11：到門檻時看哪裡參觀偏少，否則看孩子最多。 */
export const defaultVillageSort = (judged: boolean): VillageSort => (judged ? 'shortfall' : 'children')

// ---- 欄 ----

/** judged（D15）才多「參觀人數、參觀率、照附近應有、判讀」；allChildren＝每一列都有 2–5 歲（有就畫長條，否則改文字欄寫「—」）。 */
export function villageColumns(judged: boolean, allChildren: boolean): StatsColumn[] {
  return [
    { key: 'place', label: '里', sticky: true },
    { key: 'distance', label: '距本校' },
    allChildren ? { key: 'children', label: '2–5 歲', kind: 'bar' } : { key: 'children_text', label: '2–5 歲' },
    { key: 'infants_text', label: '0–1 歲' },
    { key: 'kids_text', label: '這一年淨增' },
    { key: 'level_text', label: '孩子增減' },
    { key: 'births_text', label: '近 12 個月出生' },
    { key: 'migration_text', label: '近 12 個月淨遷入' },
    { key: 'homes_text', label: '近 4 季新屋' },
    { key: 'income_text', label: '所得中位數' },
    { key: 'schools_text', label: '國小學區' },
    { key: 'enrolled', label: '在籍' },
    ...(judged
      ? ([
          { key: 'visit', label: '參觀人數', kind: 'count' },
          { key: 'rate', label: '參觀率', kind: 'rate' },
          { key: 'expected_text', label: '照附近應有' },
          { key: 'signal_text', label: '判讀' },
        ] satisfies StatsColumn[])
      : []),
  ]
}

/**
 * 匯出用的欄（D17）：畫面欄＋里代碼、一年前 1–4 歲、最近一季新屋、所得拆千元／年度／界線調整、各班在籍。
 * 參觀四欄不論 judged 都輸出，讓欄位固定。
 */
export function villageCsvColumns(allChildren: boolean): StatsColumn[] {
  const columns = villageColumns(true, allChildren)
  const at = (key: string) => columns.findIndex((column) => column.key === key)
  columns.splice(at('place') + 1, 0, { key: 'codes', label: '里代碼' })
  // 一年前 1–4 歲只在 CSV（淨增的分母）：插在「這一年淨增」後面。
  columns.splice(at('kids_text') + 1, 0, { key: 'kids_base', label: '一年前 1–4 歲' })
  // 最近一季的新屋交屋只在 CSV：插在「近 4 季新屋」後面。
  columns.splice(at('homes_text') + 1, 0, { key: 'homes_latest', label: '最近一季新屋' })
  // 所得：畫面的「45.8 萬*」在 CSV 拆成千元、年度、界線是否調整過三欄。
  columns.splice(
    at('income_text'), 1,
    { key: 'income_text', label: '所得中位數（千元）' },
    { key: 'income_year', label: '所得年度' },
    { key: 'income_changed', label: '界線在所得年度後調整' },
  )
  columns.splice(at('enrolled') + 1, 0, ...ENROLLED_GRADE_ORDER.map((grade): StatsColumn => ({ key: `enrolled:${grade}`, label: `在籍${grade}` })))
  return columns
}

/**
 * CSV 的格值（回 undefined＝照 StatsDimensionTable 的欄位規則）：寫數字不寫畫面的文字，要拿去算的人不用再拆字；
 * 沒有值寫空白。照附近應有寫數字（小數一位以內，不寫「約」）；合併組與沒到門檻的判讀寫空白（畫面上合併組是「—」）。
 */
export function villageCsvCell(row: VillageTableRow, column: StatsColumn): CsvCell | undefined {
  switch (column.key) {
    case 'codes':
      return row.codes.join('、')
    case 'children':
    case 'children_text':
      return row.children ?? ''
    case 'infants_text':
      return row.infants ?? ''
    case 'kids_text':
      return row.kids_net ?? ''
    case 'kids_base':
      return row.kids_base ?? ''
    case 'level_text':
      return row.kids_level === 'unknown' ? '' : row.level_text
    case 'births_text':
      return row.births_12m ?? ''
    case 'migration_text':
      return row.migration_net_12m ?? ''
    case 'homes_text':
      return row.new_homes ?? ''
    case 'homes_latest':
      return row.new_homes_latest ?? ''
    case 'income_text':
      return row.income_median ?? ''
    case 'income_year':
      return row.income_median === null ? '' : (row.income_year ?? '')
    case 'income_changed':
      return row.income_boundary_changed ? '是' : ''
    case 'schools_text':
      return row.schools_csv
    case 'enrolled':
      return row.enrolled ?? ''
    case 'visit':
      return row.visit ?? ''
    case 'expected_text':
      return row.expected ?? ''
    case 'signal_text':
      return row.signal === null ? '' : row.signal_text
    default:
      if (column.key.startsWith('enrolled:')) return row.enrolled_counts?.[column.key.slice('enrolled:'.length)] ?? ''
      return undefined
  }
}

// ---- 說明（這些數字怎麼算）----

const NEAR_DEFINITION = '「附近」是里的中心點在半徑內的里。'

function monthRange(months: readonly string[]): string {
  if (!months.length) return ''
  const first = populationVersionLabel(months[0]!)
  const last = populationVersionLabel(months[months.length - 1]!)
  return first === last ? first : `${first}到 ${last}`
}

/** 招生機會面板原本的 caption（不含「附近」那句）；人口沒匯入、本校沒座標、附近參觀沒到門檻時沒有。 */
function opportunityHow(data: AreaOpportunity | null): string {
  // 沒到門檻（D15）表上沒有參觀欄與判讀，不解釋參觀率、照附近應有、少了約 N 位。
  if (!data?.population.version || opportunityUnavailable(data) || data.baseline?.judged !== true) return ''
  return (
    '參觀率＝參觀人數 ÷ 2–5 歲孩子數；照附近應有＝孩子數 × 本校附近的參觀率。' +
    '「少了約 N 位」只標和附近比明顯偏少的里，約有一成機率是誤報。' +
    `${data.population.source_note}，${populationVersionLabel(data.population.version)}。`
  )
}

/** 里的變化面板原本的 caption（不含「附近」那句）；整塊用不了時沒有。 */
function trendsHow(data: AreaTrends | null): string {
  if (!data || trendsUnavailable(data)) return ''
  const { sources } = data
  const parts = [
    '這一年淨增＝本月 2–5 歲減一年前 1–4 歲的同一批孩子，是搬進搬出的結果，不是推估；' +
      '分級：增減 10% 以上且至少 5 位是「增加多／減少多」，3% 以上且至少 3 位是「增加／減少」，一年前 1–4 歲不到 20 位是「孩子少」。',
    '出生依出生登記的戶籍里；淨遷入＝跨區遷入減遷出，加上同區換址的進出。',
    sources.new_homes.latest === null
      ? '新成屋資料尚未匯入。'
      : '新屋交屋是完工一年內的住宅過戶（含預售屋交屋），不等於已入住、也不等於有孩子。',
    sources.income.year === null
      ? '各里所得資料尚未匯入。'
      : `所得是 ${sources.income.year} 年度綜合所得稅申報戶的中位數，只當背景；* 表示界線在所得年度之後調整過，` +
        '里界調整合併的列不列所得。',
  ]
  const months = [
    sources.population.month
      ? `人口 ${populationVersionLabel(sources.population.month)}${sources.population.year_ago_month ? `與 ${populationVersionLabel(sources.population.year_ago_month)}` : ''}`
      : '',
    sources.births.months.length ? `出生 ${monthRange(sources.births.months)}` : '',
    sources.migration.months.length ? `遷入遷出 ${monthRange(sources.migration.months)}` : '',
    sources.new_homes.seasons.length ? `新成屋 ${seasonRange(sources.new_homes.seasons)}` : '',
  ].filter(Boolean)
  const missing = sources.births.missing.length
    ? `出生缺 ${sources.births.missing.map((month) => populationVersionLabel(month)).join('、')}的資料。`
    : ''
  const income = sources.income.note ? `${sources.income.note}。` : ''
  const homes = sources.new_homes.note ? `${sources.new_homes.note}。` : ''
  const schools = `國小學區依 ${sources.school_districts.school_year} 學年度一覽表，「部分」是只有部分鄰屬於那所國小。`
  return `${parts.join('')}${sources.note}（${months.join('、')}）。${missing}${homes}${income}${schools}`
}

/** 「這些數字怎麼算」：招生機會與里的變化原本的兩段 caption 接起來，「附近」的定義只寫一次；兩邊都沒有說明時是空字串。 */
export function villageHowText(trends: AreaTrends | null, opportunity: AreaOpportunity | null): string {
  const body = opportunityHow(opportunity) + trendsHow(trends)
  return body ? NEAR_DEFINITION + body : ''
}
