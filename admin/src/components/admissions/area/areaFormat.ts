import { NO_VALUE, formatRate } from '../../../admissions/statsFormat'
import type {
  AreaBabycare, AreaBabycareItem, AreaChange, AreaEnrolled, AreaOpportunity, AreaOpportunityMissing, AreaOpportunityRow, AreaTrackingSince,
  AreaTrends, AreaTrendsSchool, AreaTrendsVillage, EnrolledGrade, KidsLevel,
  OpportunitySignal, VillageBoundaries, VisitGeo,
} from '../../../api/types'

// 區域分析的顯示格式與地圖用的小工具（2026-10-08 規格 9）。

export type RadiusKm = 1 | 3 | 6
export const RADIUS_OPTIONS: readonly RadiusKm[] = [1, 3, 6]

/** 里的鍵：後端 villages 列（district＋village）與里界屬性（TOWNNAME＋VILLNAME）用同一個。 */
export const villageKey = (district: string, village: string): string => `${district}/${village}`

/** 南西角、東北角（[緯度, 經度]），Leaflet fitBounds 直接吃。 */
export type LatLngBox = [[number, number], [number, number]]

/**
 * 某個行政區所有里的外框；里界檔裡沒有這個區（或沒給區）回 null。本校沒有座標時地圖先框住校址
 * 所在的區，不退到整個高雄（含山區，一打開是半個南台灣）。GeoJSON 座標是 [經度, 緯度]，
 * Polygon 與 MultiPolygon 巢狀層數不同，遞迴找到數字對為止。
 */
export function districtBounds(boundaries: VillageBoundaries, district: string | null | undefined): LatLngBox | null {
  if (!district) return null
  let south = Infinity
  let west = Infinity
  let north = -Infinity
  let east = -Infinity
  const visit = (node: unknown): void => {
    if (!Array.isArray(node)) return
    const [lng, lat] = node
    if (typeof lng === 'number' && typeof lat === 'number') {
      south = Math.min(south, lat)
      north = Math.max(north, lat)
      west = Math.min(west, lng)
      east = Math.max(east, lng)
      return
    }
    node.forEach(visit)
  }
  for (const feature of boundaries.features) {
    if (feature.properties.TOWNNAME === district) visit(feature.geometry.coordinates)
  }
  return south === Infinity ? null : [[south, west], [north, east]]
}

/** 里界著色 5 級：0 筆是 0 級（不上色），其餘依該範圍參觀人數最多的那一里等分。 */
export function levelOf(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0
  return Math.min(5, Math.max(1, Math.ceil((count / max) * 5)))
}

/** 圖例：每一級涵蓋的人數（整數）；沒有整數落在裡面的級數不列。和 levelOf 同一個切法。 */
export function legendRanges(max: number): { level: number; label: string }[] {
  const ranges: { level: number; label: string }[] = []
  for (let level = 1; level <= 5; level++) {
    const low = Math.floor(((level - 1) * max) / 5) + 1
    const high = Math.floor((level * max) / 5)
    if (low > high) continue
    ranges.push({ level, label: low === high ? `${low}` : `${low}–${high}` })
  }
  return ranges
}

export const KIND_ORDER = ['public', 'nonprofit', 'quasi_public', 'private'] as const
export const KIND_LABELS: Record<string, string> = { public: '公立', nonprofit: '非營利', quasi_public: '準公共', private: '私立' }
export const kindLabel = (kind: string): string => KIND_LABELS[kind] ?? kind

export const BAND_LABELS: Record<string, string> = {
  '0-1': '1 公里內', '1-3': '1–3 公里', '3-6': '3–6 公里', '6+': '6 公里以上', none: '無距離',
}
export const bandLabel = (band: string): string => BAND_LABELS[band] ?? band

// 單筆訪視的比對原因五種都會出現（VisitGeoOut.unlocated_reason）；區域分析合計的原因清單只有
// 外縣市、查無門牌、里有歧義三種（沒填地址、已匿名化各有自己的筆數）。
export const REASON_LABELS: Record<string, string> = {
  no_address: '沒填地址',
  outside_kaohsiung: '非高雄市地址',
  no_doorplate: '查無門牌',
  ambiguous_village: '里有歧義',
  anonymized: '已匿名化',
}
export const reasonLabel = (reason: string): string => REASON_LABELS[reason] ?? reason

const CAMPUS_NOT_LOCATED = new Map([
  ['no_address', '找不到本校地址'],
  ['pending', '門牌資料尚未匯入'],
  ['no_doorplate', '本校地址比對不到門牌'],
])
/** 本校沒有座標時的原因（AreaCampus.locate_error）；不認得的值回 undefined，由呼叫端用自己的兜底句。 */
export const campusNotLocatedReason = (locateError: string | null): string | undefined =>
  locateError === null ? undefined : CAMPUS_NOT_LOCATED.get(locateError)

/** 門牌資料版本「115-10」→「115 年 10 月」；其他寫法（手動匯入的版本名）照原文。 */
export function doorplateVersionLabel(version: string): string {
  const match = /^(\d{3})-(\d{2})$/.exec(version)
  return match ? `${match[1]} 年 ${Number(match[2])} 月` : version
}

const dayFormatter = new Intl.DateTimeFormat('en-CA', { month: '2-digit', day: '2-digit', timeZone: 'Asia/Taipei' })
/** ISO 時間 → 台北日期「10/08」（資料更新日用）。不是 utils/visitSchedule 的 shortDay（附週幾）或 admissions/followUp 的 shortDay。 */
export function taipeiMonthDay(value: string | null | undefined): string {
  if (!value) return NO_VALUE
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return NO_VALUE
  const parts = Object.fromEntries(dayFormatter.formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.month}/${parts.day}`
}

/**
 * 距離顯示規則：四捨五入到整數公尺後不滿 1000 m 就寫「999 m」；到 1000 m 起改寫一位小數的公里「1.0 km」。
 * 先取整再判斷單位：999.6 m 取整成 1000 m，直接走公里，不會出現「1000 m」。以前取整到 10 m，
 * 995–999 m 會被進位成「1000 m」，同一頁又有「1.0 km」，單位對不上。
 */
export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined) return NO_VALUE
  const rounded = Math.round(meters)
  if (rounded < 1000) return `${rounded} m`
  return `${(meters / 1000).toFixed(1)} km`
}

/** 園所名稱去掉「高雄市私立／高雄市立／高雄市」前綴，清單一行放得下。 */
export function shortName(name: string): string {
  return name.replace(/^高雄市(?:私立|市立|立)?/, '') || name
}

const VILLAGE_LEVELS = new Set(['exact', 'nearby', 'street'])

/**
 * 訪視明細展開列「區域」那一行（規格 9.6）。回空字串＝該行不列：沒填地址、已匿名化，以及沒有
 * 比對紀錄（geo 為 null 的舊資料；有填地址的由呼叫端寫「待比對」，見 RecordsTab）。
 * 到里：「行政區＋里」，有距離再加「・距本校 ○ km」；
 * 只到區：「行政區（只到區）」，里有歧義時寫原因；比對還沒跑寫「待比對」；
 * 其餘未定位：外縣市寫「非高雄市地址」，其他寫「未定位：查無門牌」。
 */
export function visitGeoText(geo: VisitGeo | null | undefined, district: string | null | undefined): string {
  if (!geo) return ''
  if (VILLAGE_LEVELS.has(geo.match_level) && geo.village) {
    const distance = geo.distance_m === null || geo.distance_m === undefined ? '' : `・距本校 ${formatDistance(geo.distance_m)}`
    return `${district ?? ''}${geo.village}${distance}`
  }
  if (geo.match_level === 'pending') return '待比對'
  if (geo.match_level === 'district') {
    if (!district) return ''
    if (geo.unlocated_reason === 'ambiguous_village') return `${district}（里有歧義）`
    if (geo.unlocated_reason === 'anonymized') return ''
    return `${district}（只到區）`
  }
  if (geo.unlocated_reason === 'no_address' || geo.unlocated_reason === 'anonymized') return ''
  if (geo.unlocated_reason === 'outside_kaohsiung') return '非高雄市地址'
  return '未定位：查無門牌'
}

// ---- 招生機會（2026-10-13 規格 7）----

/** 地圖著色：參觀人數（預設，現狀）、2–5 歲孩子、招生機會；孩子增減、新屋交屋（2026-10-14 里的變化）；在籍學生（2026-10-15）。 */
export type MapMode = 'visits' | 'children' | 'opportunity' | 'trend' | 'homes' | 'enrolled'
export const MAP_MODES: readonly { value: MapMode; label: string }[] = [
  { value: 'visits', label: '參觀人數' },
  { value: 'children', label: '2–5 歲孩子' },
  { value: 'opportunity', label: '招生機會' },
  { value: 'trend', label: '孩子增減' },
  { value: 'homes', label: '新屋交屋' },
  { value: 'enrolled', label: '在籍學生' },
]

/** 人口月份「115-09」→「115 年 9 月」，和門牌月份同一個寫法。 */
export const populationVersionLabel = doorplateVersionLabel

/** 人數加千分位：「12,883」。 */
export const formatCount = (value: number): string => value.toLocaleString('zh-TW')

/** 照附近應有：「約 6 位」；四捨五入後是 0 寫「不到 1 位」；沒有附近平均（null）寫「—」。 */
export function expectedText(expected: number | null | undefined): string {
  if (expected === null || expected === undefined) return NO_VALUE
  const rounded = Math.round(expected)
  return rounded < 1 ? '不到 1 位' : `約 ${formatCount(rounded)} 位`
}

/** 判讀（表格、地圖彈出框共用）。明顯偏少寫少了幾位（至少 1 位：偏少一定少了東西，不寫「少了約 0 位」）。 */
export function signalText(row: Pick<AreaOpportunityRow, 'signal' | 'shortfall'>): string {
  switch (row.signal) {
    case 'below':
      return `少了約 ${formatCount(Math.max(1, Math.round(row.shortfall ?? 0)))} 位`
    case 'above':
      return '比附近多'
    case 'typical':
      return '差不多'
    case 'few_children':
      return '孩子少，看不出來'
    default:
      return '還不判斷'
  }
}

/** 地圖上招生機會的色階：明顯偏少、比附近多、差不多各一色；孩子少與不判斷不上色（none）。 */
export function signalTone(signal: OpportunitySignal): 'chance' | 'strong' | 'typical' | 'none' {
  if (signal === 'below') return 'chance'
  if (signal === 'above') return 'strong'
  return signal === 'typical' ? 'typical' : 'none'
}

/** 招生機會用不了的原因（地圖切換停用、區塊空狀態共用）；可以用回 null。 */
export function opportunityUnavailable(data: AreaOpportunity): string | null {
  if (data.population.version === null) return '各里人口資料尚未匯入；匯入後就能看哪些里孩子多、參觀少。'
  if (data.campus.lat === null || data.campus.lng === null) {
    const reason = campusNotLocatedReason(data.campus.locate_error)
    return `本校位置未標示${reason ? `（${reason}）` : ''}，算不出附近有哪些里。`
  }
  return null
}

/** 半徑內但人口表沒有的里（總結的 note 用）：列前 3 個里名，其餘寫「等 N 個里」；沒有就空字串。 */
function missingPopulationNote(villages: readonly AreaOpportunityMissing[]): string {
  if (!villages.length) return ''
  const names = villages.slice(0, 3).map((item) => `${item.district}${item.village}`).join('、')
  const where = villages.length > 3 ? `${names}等 ${villages.length} 個里` : names
  const visit = villages.reduce((sum, item) => sum + item.visit, 0)
  return `${where}沒有人口資料，${visit ? `孩子數與其中的 ${formatCount(visit)} 位參觀都沒算進去。` : '孩子數沒算進去。'}`
}

/**
 * 招生機會的總結（規格 7.3）：第一句是半徑內的合計，第二句是判讀；note 是不算在內的人數（都是 0 就空字串），
 * 之後接半徑內但人口表沒有的里（它們不是半徑外，要另外交代）。沒填地址的參觀和其他沒對到里的分開寫。
 * 有參觀、但參觀率四捨五入到 0.0%（1 位 ÷ 9,788 位）寫「不到 0.1%」，不寫成 0.0%。
 * 沒有合計（人口未匯入、本校沒座標）回 null，由呼叫端寫 opportunityUnavailable 的原因。
 */
export function opportunitySummary(data: AreaOpportunity): { lead: string; verdict: string; note: string } | null {
  const { baseline, radius_km: radius } = data
  if (!baseline) return null
  const rate = baseline.visit > 0 && baseline.rate === 0 ? '參觀率不到 0.1%' : `參觀率 ${formatRate(baseline.rate)}`
  const lead =
    `本校 ${radius} 公里內 ${formatCount(baseline.villages)} 個里，2–5 歲孩子 ${formatCount(baseline.children)} 位，` +
    `參觀 ${formatCount(baseline.visit)} 位（${rate}）。`
  const below = data.villages.filter((row) => row.signal === 'below')
  const missing = Math.round(below.reduce((sum, row) => sum + (row.shortfall ?? 0), 0))
  const verdict = !baseline.judged
    ? '附近參觀還不到 10 位，先不判斷哪些里偏少。'
    : below.length
      ? `明顯偏少的里 ${below.length} 個，照附近的參觀率合計少了約 ${formatCount(Math.max(1, missing))} 位。`
      : '沒有明顯偏少的里。'
  const unmatched = data.unplaced_visit - data.no_address_visit
  const parts = [
    data.outside_visit ? `${formatCount(data.outside_visit)} 位來自 ${radius} 公里外` : '',
    data.no_address_visit ? `${formatCount(data.no_address_visit)} 位沒填地址` : '',
    unmatched > 0 ? `${formatCount(unmatched)} 位沒對到里` : '',
  ].filter(Boolean)
  const excluded = parts.length ? `另有 ${parts.join('、')}，不算在內。` : ''
  return { lead, verdict, note: excluded + missingPopulationNote(data.no_population_villages) }
}

// ---- 托嬰與園所異動（2026-10-14 規格 7）----

/** 「附近幼兒園」卡片的名單種類：幼兒園（預設）、托嬰中心。 */
export type NearbyKind = 'kindergarten' | 'babycare'
export const NEARBY_KINDS: readonly { value: NearbyKind; label: string }[] = [
  { value: 'kindergarten', label: '幼兒園' },
  { value: 'babycare', label: '托嬰中心' },
]

export const BABYCARE_KIND_LABELS: Record<string, string> = { center: '托嬰中心', home: '托育家園' }
export const babycareKindLabel = (kind: string): string => BABYCARE_KIND_LABELS[kind] ?? kind

/**
 * 托嬰機構的短名：政府委託辦理的名稱很長（「高雄市政府社會局委託○○基金會辦理高雄市三民公共托嬰中心」），
 * 取「辦理」「附設」之後真正的機構名；取出來的尾巴不像機構名（沒有托嬰／托育字樣，例如括號收尾的「…辦理)」）就維持原名。
 * 最後一樣去掉「高雄市私立／高雄市」前綴。
 */
export function babycareShortName(name: string): string {
  let short = name
  for (const marker of ['辦理', '附設']) {
    const tail = short.split(marker).at(-1)!.trim()
    if (/托嬰|托育/.test(tail)) short = tail
  }
  return shortName(short) || name
}

/** 托嬰清單最上面一句。只放數量，不算任何比例。 */
export function babycareSummaryText(summary: AreaBabycare['summary'], radiusKm: number): string {
  if (!summary.count) return `${radiusKm} 公里內沒有托嬰中心。`
  return (
    `${radiusKm} 公里內托嬰中心 ${formatCount(summary.count)} 所，` +
    `核定 ${formatCount(summary.approved_total)} 位，實際收托 ${formatCount(summary.enrolled_total)} 位。`
  )
}

/** 清單每列第二行：距離・核定 N 人・實際收托 M 人（・月費 X）。來源沒給（null）寫「—」，不寫 0；月費沒有（null 或沒送）就不寫。 */
export function babycareMeta(item: Pick<AreaBabycareItem, 'distance_m' | 'approved_capacity' | 'enrolled' | 'monthly_fee'>): string {
  const count = (value: number | null): string => (value === null ? NO_VALUE : String(value))
  const fee = item.monthly_fee === null || item.monthly_fee === undefined ? '' : `・月費 ${formatCount(item.monthly_fee)}`
  return `${formatDistance(item.distance_m)}・核定 ${count(item.approved_capacity)} 人・實際收托 ${count(item.enrolled)} 人${fee}`
}

/** 托嬰摘要下的月費對照（2026-10-15 規格 7.3）：少於 3 所（沒有中位數）回空字串；本校沒有 2 歲班收費就不寫後半句。 */
export function babycareFeeText(summary: AreaBabycare['summary']): string {
  const { fee_median: median, fee_min: lowest, fee_max: highest, own_age2_monthly: own } = summary
  if (median === null || median === undefined || lowest === null || lowest === undefined || highest === null || highest === undefined) return ''
  const head = `日間托育月費中位數 ${formatCount(median)} 元（${formatCount(lowest)}–${formatCount(highest)}）`
  return own === null || own === undefined ? `${head}。` : `${head}；本校 2 歲班月均 ${formatCount(own)} 元。`
}

const CHANGE_LABELS: Record<string, string> = { opened: '新設', closed: '停辦', kind_changed: '類型變動' }
export const changeLabel = (change: string): string => CHANGE_LABELS[change] ?? change
export const providerLabel = (provider: string): string => (provider === 'babycare' ? '托嬰' : '幼兒園')

/** 2026-10-03 → 「2026/10」。 */
const yearMonth = (isoDate: string): string => isoDate.slice(0, 7).replace('-', '/')

/** 變化列的日期：新設依設立日、其餘是我們同步到的月份（來源沒有停辦日）。 */
export function changeDateText(item: Pick<AreaChange, 'change' | 'date' | 'date_basis'>): string {
  const when = yearMonth(item.date)
  if (item.change === 'opened') return item.date_basis === 'registered' ? `設立日 ${when}` : `${when} 起出現在名單`
  if (item.change === 'closed') return `${when} 起不在名單`
  return `${when} 起`
}

/** 類型變動多寫「私立 → 準公共」；其他種類（或缺新舊值）回空字串。 */
export function kindChangeText(item: Pick<AreaChange, 'change' | 'old_kind' | 'new_kind'>): string {
  if (item.change !== 'kind_changed' || !item.old_kind || !item.new_kind) return ''
  return `${kindLabel(item.old_kind)} → ${kindLabel(item.new_kind)}`
}

export const changesSubtitle = (radiusKm: number, months: number): string => `近 ${months} 個月・${radiusKm} 公里內`
export const changesEmptyText = (radiusKm: number, months: number): string =>
  `近 ${months} 個月，${radiusKm} 公里內沒有新設、停辦或類型變動的園所。`

const pad2 = (value: number): string => String(value).padStart(2, '0')
/** now 往前推 months 個月、同日（那個月沒有這天取月底）的 ISO 日期。 */
function monthsAgoIso(now: Date, months: number): string {
  const target = new Date(now.getFullYear(), now.getMonth() - months, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  return `${target.getFullYear()}-${pad2(target.getMonth() + 1)}-${pad2(Math.min(now.getDate(), lastDay))}`
}
const monthDay = (iso: string): string => `${Number(iso.slice(5, 7))} 月 ${Number(iso.slice(8, 10))} 日`

/**
 * 變化區塊底下的小字（2026-10-14 規格 7.3，2026-10-15 規格 §6 改）：幼兒園的新設看設立日、停辦有教育部名單的回補，
 * 都涵蓋整個視窗；只有幼兒園的類型變動與托嬰的異動是從基準日才開始累積，基準日離今天不到視窗長度時老實說從哪天起記錄。
 * 還沒同步過（基準日是空）的那一側明說「尚未開始記錄」（幼兒園還沒同步就也沒有回補，所以寫停辦與類型變動），
 * 兩邊都空寫「尚未開始記錄。」；兩邊都已記錄滿視窗長度才不需要說明（回空字串）。已滿那一側省略不印日期（不帶年份，一年後讀起來會像今年）。
 */
export function trackingNote(tracking: AreaTrackingSince, months = 12, now: Date = new Date()): string {
  const { kindergarten, babycare } = tracking
  if (!kindergarten && !babycare) return '尚未開始記錄。'
  const cutoff = monthsAgoIso(now, months)
  const recent = (iso: string | null): iso is string => iso !== null && iso > cutoff // 基準日離今天還不到視窗長度
  if (kindergarten && babycare && !recent(kindergarten) && !recent(babycare)) return ''
  if (kindergarten && babycare && kindergarten === babycare) {
    return `幼兒園的類型變動與托嬰從 ${monthDay(kindergarten)}起記錄。`
  }
  const parts: string[] = []
  if (!kindergarten) parts.push('幼兒園的停辦與類型變動尚未開始記錄')
  else if (recent(kindergarten)) parts.push(`幼兒園的類型變動從 ${monthDay(kindergarten)}起記錄`)
  if (!babycare) parts.push('托嬰尚未開始記錄')
  else if (recent(babycare)) parts.push(`托嬰從 ${monthDay(babycare)}起記錄`)
  return `${parts.join('；')}。`
}

/** 頁首狀態列的托嬰名單那一段。 */
export const babycareStatusText = (syncedAt: string | null): string =>
  syncedAt ? `托嬰名單 ${taipeiMonthDay(syncedAt)} 更新` : '托嬰名單尚未匯入'

// ---- 里的變化（2026-10-14 規格 7）----

const MINUS = '\u2212'

/** 有正負號的人數：「+139」「−46」「0」；null 寫「—」。 */
export function signedCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return NO_VALUE
  if (value > 0) return `+${formatCount(value)}`
  return value < 0 ? `${MINUS}${formatCount(-value)}` : '0'
}

/** 有正負號的百分比（小數一位）：「+21.0%」「−0.7%」。 */
export function signedPercent(value: number): string {
  const text = Math.abs(value).toFixed(1)
  if (text === '0.0') return '0.0%'
  return `${value > 0 ? '+' : MINUS}${text}%`
}

/** 這一年淨增：「+139（+20.6%）」；一年前 1–4 歲是 0 只寫人數；算不出來寫「—」。 */
export function kidsNetText(row: Pick<AreaTrendsVillage, 'kids_net' | 'kids_base'>): string {
  if (row.kids_net === null || row.kids_base === null) return NO_VALUE
  if (row.kids_base === 0) return signedCount(row.kids_net)
  return `${signedCount(row.kids_net)}（${signedPercent((row.kids_net / row.kids_base) * 100)}）`
}

export const KIDS_LEVEL_LABELS: Record<KidsLevel, string> = {
  up2: '增加多', up1: '增加', flat: '差不多', down1: '減少', down2: '減少多', few: '孩子少', unknown: NO_VALUE,
}

/** 地圖上孩子增減的色階：增加兩級、減少兩級、差不多；孩子少、算不出來不上色（none）。 */
export function kidsLevelTone(level: KidsLevel): 'up2' | 'up1' | 'flat' | 'down1' | 'down2' | 'none' {
  return level === 'few' || level === 'unknown' ? 'none' : level
}

/** 里的名稱：一般的里「三民區本揚里」；里界調整合併的組列前 3 個里名，其餘寫「等 N 個里」，後面註明合併。 */
export function trendsPlaceName(row: Pick<AreaTrendsVillage, 'district' | 'village' | 'merged'>): string {
  if (!row.merged) return `${row.district}${row.village}`
  const names = row.village.split('、').filter(Boolean)
  const shown = names.length > 3 ? `${names.slice(0, 3).join('、')}等 ${names.length} 個里` : names.join('、')
  return `${row.district}${shown}（里界調整，合併）`
}

/**
 * 所得中位數（C 段，規格 V9）：千元換成「45.8 萬」；里界在所得年度之後調整過加「*」；沒有所得（新設的里、合併組）
 * 寫「—」。只當背景：不著色、不分級、不排序。
 */
export function incomeText(row: Pick<AreaTrendsVillage, 'income_median' | 'income_boundary_changed'>): string {
  if (row.income_median === null) return NO_VALUE
  return `${(row.income_median / 10).toFixed(1)} 萬${row.income_boundary_changed ? '*' : ''}`
}

/**
 * 一列對到的國小（D 段）：「光武國小（部分）、陽明國小（部分）」；和別校是自由學區的加「自由學區」。
 * 學校在別的區時前面加區名（有同名學校：民權、中山、成功…）。
 */
export function villageSchoolsText(row: Pick<AreaTrendsVillage, 'district' | 'schools'>, separator = '、'): string {
  if (!row.schools.length) return NO_VALUE
  return row.schools
    .map((school) => {
      const marks = [school.partial ? '部分' : '', school.free_zone ? '自由學區' : ''].filter(Boolean)
      const name = school.district === row.district ? school.name : `${school.district}${school.name}`
      return marks.length ? `${name}（${marks.join('，')}）` : name
    })
    .join(separator)
}

/** 學區里數：「12 里＋部分 3 里」「3 里」「部分 2 里」。 */
export function schoolVillagesText(row: Pick<AreaTrendsSchool, 'villages_full' | 'villages_partial'>): string {
  const parts = [
    row.villages_full ? `${formatCount(row.villages_full)} 里` : '',
    row.villages_partial ? `部分 ${formatCount(row.villages_partial)} 里` : '',
  ].filter(Boolean)
  return parts.join('＋') || NO_VALUE
}

export const ENROLLMENT_NOTES: Record<AreaTrendsSchool['enrollment'], string> = {
  district: '',
  open: '大學區（實驗教育）',
  spacious: '空間充裕，可跨學區申請',
  capped: '總量管制',
}

/** 學區的這一年淨增：有里沒算進去（里界調整過或缺一年前的年齡）加「*」；算不出來寫「—」。 */
export function schoolKidsNetText(row: Pick<AreaTrendsSchool, 'kids_net' | 'kids_partial'>): string {
  if (row.kids_net === null) return NO_VALUE
  return `${signedCount(row.kids_net)}${row.kids_partial ? '*' : ''}`
}

const KIDS_UNAVAILABLE: Record<NonNullable<AreaTrends['kids_unavailable']>, string> = {
  no_population: '各里人口尚未匯入，這一年淨增先不算。',
  no_year_ago: '一年前的各里人口還沒匯入，這一年淨增先不算。',
  no_migration: '遷入遷出資料不到 10 個月，看不出里界有沒有調整，這一年淨增先不算。',
}

/** 「這一年淨增」算不出來的原因；算得出來回空字串。 */
export const kidsUnavailableText = (data: AreaTrends): string =>
  data.kids_unavailable ? KIDS_UNAVAILABLE[data.kids_unavailable] : ''

/** 本校沒有座標時，里的變化各處共用的一句；有座標回 null。 */
function campusUnlocatedText(data: AreaTrends): string | null {
  if (data.campus.lat !== null && data.campus.lng !== null) return null
  const reason = campusNotLocatedReason(data.campus.locate_error)
  return `本校位置未標示${reason ? `（${reason}）` : ''}，算不出附近有哪些里。`
}

/** 里的變化整塊用不了的原因（區塊空狀態用）：本校沒座標，或出生、遷入遷出、人口都還沒匯入；可以用回 null。 */
export function trendsUnavailable(data: AreaTrends): string | null {
  const unlocated = campusUnlocatedText(data)
  if (unlocated) return unlocated
  const { sources } = data
  if (sources.births.latest === null && sources.migration.latest === null && sources.population.month === null) {
    return '各里出生、遷入遷出資料尚未匯入；匯入後就能看哪些里孩子變多。'
  }
  return null
}

/** 地圖「孩子增減」停用的原因：整塊用不了，或這一年淨增算不出來；可以用回空字串。 */
export function trendMapNote(data: AreaTrends): string {
  return trendsUnavailable(data) ?? kidsUnavailableText(data)
}

/** 地圖「新屋交屋」停用的原因：本校沒座標，或新成屋還沒匯入（和出生、遷入遷出、人口有沒有匯入無關）；可以用回空字串。 */
export function homesMapNote(data: AreaTrends): string {
  return campusUnlocatedText(data) ?? (data.sources.new_homes.latest === null ? '新成屋資料尚未匯入。' : '')
}

/** 新屋交屋的筆數：「24」；新成屋還沒匯入寫「—」（匯入了沒有交屋是 0，不是「—」）。 */
export const homesText = (row: Pick<AreaTrendsVillage, 'new_homes'>): string =>
  row.new_homes === null ? NO_VALUE : formatCount(row.new_homes)

/** 新成屋的季別範圍：「115S1–115S3」；只有一季寫那一季；沒有回空字串。 */
export function seasonRange(seasons: readonly string[]): string {
  if (!seasons.length) return ''
  const first = seasons[0]!
  const last = seasons[seasons.length - 1]!
  return first === last ? first : `${first}–${last}`
}

type HomesRow = Pick<AreaTrendsVillage, 'merged' | 'new_homes' | 'new_homes_by_code'>

/**
 * 地圖上某個里的近 4 季新屋交屋筆數：一般的里是那一列的數字；里界調整合併的組，列上的數字是整組的，
 * 組內各里用後端回的各代碼自己的筆數（新屋交屋不需要合併就能比，整組的數字不能算給組內每個里）。
 */
export function homesCount(row: HomesRow, code: string): number {
  return row.merged ? (row.new_homes_by_code[code] ?? 0) : (row.new_homes ?? 0)
}

/** 新屋交屋的地圖分級用的最大值：每個里自己的筆數（合併組看組內各里，不看整組）。 */
export function homesMax(villages: readonly HomesRow[]): number {
  return Math.max(
    0,
    ...villages.flatMap((row) => (row.merged ? Object.values(row.new_homes_by_code) : [row.new_homes ?? 0])),
  )
}

/**
 * 里的變化的總結（規格 7.2）：每一句只在有資料時出現；note 是合併組與算不出來的原因。
 * 本校沒座標（baseline 是 null）回 null，由呼叫端寫 trendsUnavailable 的原因。
 */
export function trendsSummary(data: AreaTrends): { lines: string[]; note: string } | null {
  const { baseline, radius_km: radius } = data
  if (!baseline) return null
  const lines: string[] = []
  if (baseline.children !== null) {
    let lead = `本校 ${radius} 公里內 ${formatCount(baseline.villages)} 個里，2–5 歲孩子 ${formatCount(baseline.children)} 位`
    if (baseline.kids_net !== null && baseline.kids_base) {
      const share = signedPercent((baseline.kids_net / baseline.kids_base) * 100)
      const net = baseline.kids_net
      lead += `；和一年前同一批孩子比，${net < 0 ? '淨減' : '淨增'} ${formatCount(Math.abs(net))} 位（${share}）`
    }
    lines.push(`${lead}。`)
  }
  if (baseline.births_12m !== null) {
    const partial = baseline.births_months < 12 ? `（有 ${baseline.births_months} 個月的資料）` : ''
    const change = baseline.births_change_pct
    const compare =
      change === null
        ? ''
        : `，比前一年同期${change < 0 ? '少' : '多'} ${Math.abs(change).toFixed(1)}%（比 ${baseline.births_compared_months} 個月）`
    lines.push(`近 12 個月出生 ${formatCount(baseline.births_12m)} 位${partial}${compare}。`)
  }
  if (baseline.migration_net_12m !== null) {
    const net = baseline.migration_net_12m
    lines.push(`近 12 個月全年齡${net < 0 ? '淨遷出' : '淨遷入'} ${formatCount(Math.abs(net))} 人。`)
  }
  const homes = baseline.new_homes_seasons > 0 ? baseline.new_homes : null
  if (homes !== null) {
    const partial = baseline.new_homes_seasons < 4 ? `（有 ${baseline.new_homes_seasons} 季的資料）` : ''
    // 最多的前 3 個里（同筆數近的在前）；合併組寫里名、不寫「里界調整，合併」。
    const top = data.villages
      .filter((row) => (row.new_homes ?? 0) > 0)
      .sort((a, b) => b.new_homes! - a.new_homes! || a.distance_m - b.distance_m)
      .slice(0, 3)
      .map((row) => `${trendsPlaceName(row).replace('（里界調整，合併）', '')}（${formatCount(row.new_homes!)} 筆）`)
    lines.push(`近 4 季新屋交屋 ${formatCount(homes)} 筆${partial}${top.length ? `，最多的是${top.join('、')}` : ''}。`)
  }
  const merged = data.villages.filter((row) => row.merged).map((row) => trendsPlaceName(row).replace('（里界調整，合併）', ''))
  const notes = [
    merged.length ? `${merged.join('；')}的里界調整過，${merged.length > 1 ? '各自' : ''}合併成一列計算。` : '',
    kidsUnavailableText(data),
    homes !== null && data.sources.new_homes.unplaced
      ? `範圍內的區另有 ${formatCount(data.sources.new_homes.unplaced)} 筆新屋交屋只到區、沒對到里，沒算進去。`
      : '',
  ].filter(Boolean)
  return { lines, note: notes.join('') }
}

// ---- 在籍學生（2026-10-15 規格 §6）----

/** 班別篩選：全部或某一班（AreaTab 持有，地圖與下方表格同步）。 */
export type GradeFilter = 'all' | EnrolledGrade
export const ENROLLED_GRADE_ORDER: readonly EnrolledGrade[] = ['幼幼班', '小班', '中班', '大班', '其他']
type GradeCounts = Readonly<Record<string, number>>

/** 一格（或一列）依篩選的人數：全部＝各班加總。 */
export function pointCount(counts: GradeCounts, filter: GradeFilter): number {
  if (filter === 'all') return ENROLLED_GRADE_ORDER.reduce((sum, grade) => sum + (counts[grade] ?? 0), 0)
  return counts[filter] ?? 0
}

/** 篩選選項：「全部 192」＋各班（「其他」只在有人時出現，後端 grades 已照這個規則給）。 */
export function gradeOptions(data: AreaEnrolled): { value: GradeFilter; label: string }[] {
  return [
    { value: 'all', label: `全部 ${formatCount(data.total)}` },
    ...data.grades.map((item) => ({ value: item.grade, label: `${item.grade} ${formatCount(item.total)}` })),
  ]
}

/** 點的彈出框：「這附近 2 位：小班 1、中班 1」；只列大於 0 的班別，選一班時只寫那班。 */
export function pointPopupText(counts: GradeCounts, filter: GradeFilter): string {
  const grades = filter === 'all' ? ENROLLED_GRADE_ORDER : [filter]
  const parts = grades.filter((grade) => (counts[grade] ?? 0) > 0).map((grade) => `${grade} ${counts[grade]}`)
  return `這附近 ${formatCount(pointCount(counts, filter))} 位：${parts.join('、')}`
}

const UNPLACED_LABELS: Record<AreaEnrolled['unplaced'][number]['reason'], string> = {
  street: '只對到里',
  district: '只對到區',
  outside_kaohsiung: '外縣市',
  unlocated: '對不到',
}

/** 圖例：「清冊 2026/10/15・115 學年班別・門牌 115 年 10 月版・地圖上 180 位」（沒有門牌版本就省略那一段），
 * 沒有點的另起一句（依篩選加總；0 就空字串）。 */
export function enrolledLegendText(data: AreaEnrolled, filter: GradeFilter): { lead: string; unplaced: string } {
  const date = (data.roster_date ?? '').replaceAll('-', '/')
  const onMap = data.points.reduce((sum, point) => sum + pointCount(point.counts, filter), 0)
  const doorplate = data.doorplate_version ? `・門牌 ${doorplateVersionLabel(data.doorplate_version)}版` : ''
  const lead = `清冊 ${date}・${data.school_year} 學年班別${doorplate}・地圖上 ${formatCount(onMap)} 位`
  const parts = data.unplaced
    .map((item) => ({ label: UNPLACED_LABELS[item.reason], count: pointCount(item.counts, filter) }))
    .filter((item) => item.count > 0)
  const missing = parts.reduce((sum, item) => sum + item.count, 0)
  const unplaced = missing
    ? `沒有點 ${formatCount(missing)} 位（${parts.map((item) => `${item.label} ${formatCount(item.count)}`).join('、')}）`
    : ''
  return { lead, unplaced }
}

/** 地圖「在籍學生」停用的原因：讀取失敗或還沒匯入；可以用回空字串（讀取中也可以用，同其他模式）。 */
export function enrolledMapNote(data: AreaEnrolled | null, failed: boolean): string {
  if (failed) return '在籍學生讀取失敗。'
  return data?.status === 'not_imported' ? '尚未匯入在籍名冊。' : ''
}

/** 距離分布表的列：每個距離帶一列，各班人數與合計。 */
export function enrolledBandRows(data: AreaEnrolled): Record<string, string | number>[] {
  return data.distance_bands.map((item) => ({
    band: item.band,
    band_label: bandLabel(item.band),
    ...Object.fromEntries(ENROLLED_GRADE_ORDER.map((grade) => [grade, item.counts[grade] ?? 0])),
    total: pointCount(item.counts, 'all'),
  }))
}

/** 里排行的列：依篩選算人數，0 人的里不列；人數多的在前，同數依名稱。 */
export function enrolledVillageRows(data: AreaEnrolled, filter: GradeFilter): { key: string; place: string; count: number }[] {
  return data.villages
    .map((row) => ({
      key: row.village_code ?? `${row.district}/${row.village}`,
      place: `${row.district}${row.village}`,
      count: pointCount(row.counts, filter),
    }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.count - a.count || (a.place < b.place ? -1 : a.place > b.place ? 1 : 0))
}
