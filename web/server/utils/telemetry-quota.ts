export interface TelemetryQuotaOptions {
  /** 每個來源（trustedClientIp，IPv6 已聚合到 /64）每個窗口最多幾筆 */
  perSource: number
  /** 全程序每個窗口最多幾筆：最後保險，不是主要防線 */
  global: number
  windowMs: number
  /** 一個窗口最多記住幾個來源；滿了就拒收新來源，記憶體有上限 */
  maxSources: number
}

// 正常瀏覽一頁約送 1 筆 page_view 加 3–4 筆 web vitals，每來源每分鐘 60 筆
// 足夠連續換十幾頁。這裡的每來源 60／全站 3000 只限制 web 這一層的日誌與
// 轉送量（原本只有全站 600 筆，單一來源每秒 10 筆就能讓全站回報都變 429）。
// 實際寫進資料庫的量另受 API 的全站上限限制（WEBSITE_TELEMETRY_GLOBAL_PER_MINUTE，
// 預設 600；另有每來源每日與全站每日上限，見 backend/app/operations/public_caps.py）：
// 約 10 個來源各灌滿 60 筆就會擠掉那一分鐘真實訪客的統計，web 端的 3000 不會
// 先觸發。這是業主裁定「不刪資料、用全站上限封頂」的已知代價。
export const TELEMETRY_QUOTA: TelemetryQuotaOptions = { perSource: 60, global: 3000, windowMs: 60_000, maxSources: 10_000 }

/**
 * 固定窗口配額。來源計數只在記憶體保留當前窗口，換窗口整批丟掉，不落地。
 */
export function createTelemetryQuota(options: TelemetryQuotaOptions) {
  let windowStart = Number.NEGATIVE_INFINITY
  let accepted = 0
  const perSource = new Map<string, number>()
  return {
    admit(source: string, now: number = Date.now()): boolean {
      if (now - windowStart >= options.windowMs) {
        windowStart = now
        accepted = 0
        perSource.clear()
      }
      const used = perSource.get(source) ?? 0
      if (used >= options.perSource || accepted >= options.global) return false
      if (used === 0 && perSource.size >= options.maxSources) return false
      perSource.set(source, used + 1)
      accepted++
      return true
    },
    size(): number {
      return perSource.size
    }
  }
}
