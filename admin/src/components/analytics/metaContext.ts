import type { ComputedRef, InjectionKey } from 'vue'

/**
 * 「預約成效」分頁（BookingStatsPane）把期間與更新時間寫在分頁頂端一次（2026-11-20）：底下每張卡的註腳
 * （AnalyticsMeta）原本各寫一份，全頁七次「期間／單位／更新」。有這個 context 時，卡片的註腳只留「單位」；
 * 期間和分頁頂端不一樣才寫（每日變化在「開站至今」時寫實際起訖日）。成效統計等其他頁面沒有 provide，照舊全寫。
 */
export const PANE_META: InjectionKey<{ period: ComputedRef<string> }> = Symbol('analytics-pane-meta')
