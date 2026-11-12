// 成效統計整頁共用的分類、期間與裝置（2026-11-12）。
// 原本「官網瀏覽與速度」「內容興趣」各有一組期間選單，第二組在 1,400px 以下才看得到，兩段可以選成不同期間；
// 現在整頁只有一組，放在分類旁邊，兩支 API（/admin/analytics/traffic、/engagement）一起換。

/** 後端只接受 7～90 天（速度與內容興趣的紀錄只留 90 天）；28 天對齊 Google 量測網頁速度的區間。 */
export const ANALYTICS_DAY_OPTIONS = [
  { value: 7, label: '近 7 天' },
  { value: 28, label: '近 28 天' },
  { value: 90, label: '近 90 天' },
] as const
export type AnalyticsDays = (typeof ANALYTICS_DAY_OPTIONS)[number]['value']
export const DEFAULT_ANALYTICS_DAYS: AnalyticsDays = 28

/** 只有內容興趣（造訪紀錄）分得出裝置；瀏覽與速度那一類自己有手機、電腦兩欄。 */
export const ANALYTICS_DEVICE_OPTIONS = [
  { value: 'all', label: '全部裝置' },
  { value: 'mobile', label: '只看手機' },
  { value: 'desktop', label: '只看電腦' },
] as const
export type AnalyticsDevice = (typeof ANALYTICS_DEVICE_OPTIONS)[number]['value']
export const DEFAULT_ANALYTICS_DEVICE: AnalyticsDevice = 'all'

/**
 * 四類各回答一個問題：有多少人看、看了什麼、怎麼來怎麼逛、有沒有走到預約。
 * 代號寫在網址 `?tab=`；10-13 以前的舊連結（booking／classes）認不得，一律回到第一類。
 */
export const ANALYTICS_TABS = [
  { key: 'traffic', label: '瀏覽與速度' },
  { key: 'content', label: '看了什麼' },
  { key: 'journey', label: '怎麼來、怎麼逛' },
  { key: 'convert', label: '走到預約' },
] as const
export type AnalyticsTab = (typeof ANALYTICS_TABS)[number]['key']
export const DEFAULT_ANALYTICS_TAB: AnalyticsTab = 'traffic'
/** 後三類都讀內容興趣的同一份資料，由 ContentInterestPanel 依這個值決定顯示哪幾張表。 */
export type InterestView = Exclude<AnalyticsTab, 'traffic'>
