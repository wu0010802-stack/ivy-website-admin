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
 * 四類各回答一個問題：有多少人看、看了什麼、怎麼來怎麼逛、有沒有走到預約；第五類（2026-11-20）是每月比較。
 * 代號寫在網址 `?tab=`；10-13 以前的舊連結（booking／classes）認不得，一律回到第一類。
 */
export const ANALYTICS_TABS = [
  { key: 'traffic', label: '瀏覽與速度' },
  { key: 'content', label: '看了什麼' },
  { key: 'journey', label: '怎麼來、怎麼逛' },
  { key: 'convert', label: '走到預約' },
  // 2026-11-20：每月彙總（一直留著，可以和去年同月比）。期間與裝置選單在這一類不適用。
  { key: 'monthly', label: '每月比較' },
] as const
export type AnalyticsTab = (typeof ANALYTICS_TABS)[number]['key']
export const DEFAULT_ANALYTICS_TAB: AnalyticsTab = 'traffic'
/** 後三類都讀內容興趣的同一份資料，由 ContentInterestPanel 依這個值決定顯示哪幾張表。 */
export type InterestView = Exclude<AnalyticsTab, 'traffic' | 'monthly'>

/**
 * 每一類裡有哪幾張表（2026-11-26 類內目次）：條件列第二行列出來，點了捲到那一張，捲動時標出現在看到哪一張。
 * target 是那張表標題的 id（各面板 aria-labelledby 用的同一個）；畫面上還沒有那個標題（讀取中、沒有權限、
 * 整塊沒有資料而沒畫出來）就不列。順序照畫面由上到下、兩欄時先左欄再右欄。新增一張表時在這裡補一項。
 * Google 搜尋底下的六張表共用一項（都在 Google 搜尋那一塊裡）。
 */
export interface AnalyticsSection { target: string; label: string }
export const ANALYTICS_SECTIONS: Record<AnalyticsTab, readonly AnalyticsSection[]> = {
  traffic: [
    { target: 'traffic-views-title', label: '瀏覽次數' },
    { target: 'traffic-pages-title', label: '各頁瀏覽' },
    { target: 'traffic-vitals-title', label: '網頁速度' },
    { target: 'crux-title', label: 'Chrome 真實使用者' },
    { target: 'not-found-title', label: '找不到的網址' },
    { target: 'crawlers-title', label: '搜尋引擎與 AI' },
  ],
  content: [
    { target: 'interest-overview-title', label: '造訪概況' },
    { target: 'interest-pages-title', label: '各頁停留' },
    { target: 'interest-sections-title', label: '各區塊' },
    { target: 'interest-actions-title', label: '點開了什麼' },
    { target: 'interest-news-title', label: '單篇消息' },
    { target: 'interest-stories-title', label: '首頁消息' },
    { target: 'interest-classes-title', label: '試算班別' },
  ],
  journey: [
    { target: 'interest-sources-title', label: '從哪裡來' },
    { target: 'interest-campaigns-title', label: '貼文與廣告' },
    { target: 'interest-browser-title', label: '跨次造訪' },
    { target: 'interest-entries-title', label: '進站與離開' },
    { target: 'interest-paths-title', label: '瀏覽順序' },
    { target: 'interest-cohorts-title', label: '回訪' },
    { target: 'interest-hours-title', label: '時段' },
    { target: 'search-title', label: 'Google 搜尋' },
    { target: 'gbp-title', label: '商家檔案' },
    { target: 'line-insights-title', label: 'LINE' },
  ],
  convert: [
    { target: 'interest-form-title', label: '預約表單' },
    { target: 'interest-campuses-title', label: '各校興趣' },
    { target: 'interest-destinations-title', label: '各校去向' },
    { target: 'interest-conversion-title', label: '內容與預約' },
    { target: 'interest-prefs-title', label: '記住的校區' },
    { target: 'attribution-title', label: '網站來源' },
    { target: 'contact-hours-title', label: '電話與 LINE' },
  ],
  monthly: [
    { target: 'monthly-overview-title', label: '每月總覽' },
    { target: 'monthly-sources-title', label: '從哪裡來' },
    { target: 'monthly-form-title', label: '預約表單' },
    { target: 'monthly-pages-title', label: '各頁' },
  ],
}

/**
 * 成效統計從哪一天（台北）起算（2026-11-20）：網域 11-11 才切到新站，之前與 11-12 上線驗證那幾天幾乎都是
 * 內部的人與自動化瀏覽器。瀏覽、內容興趣由後端截（backend/app/config.py 的 analytics_stats_start，兩邊要一致，
 * analyticsStatsStart.test.ts 會比對）；Google 搜尋、LINE 由這裡截（googleInsights.ts 的 searchPeriod）。
 */
export const STATS_START = '2026-11-13'

/** 期間文字：起點剛好是起算日時補一句，說明為什麼不滿所選的天數。since、until 是 YYYY-MM-DD。 */
export function periodText(since: string, until: string): string {
  const range = `${since.replaceAll('-', '/')}–${until.replaceAll('-', '/')}`
  return since === STATS_START ? `${range}（官網 ${STATS_START.slice(5).replace('-', '/')} 起才列入統計）` : range
}
