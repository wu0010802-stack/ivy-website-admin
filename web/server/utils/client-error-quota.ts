import { createTelemetryQuota, type TelemetryQuotaOptions } from './telemetry-quota'

// 前端錯誤回報的配額（2026-11-05）：作法同 telemetry-quota，但計數獨立——錯誤洪水不能擠掉瀏覽量與效能回報，
// 反過來也一樣。一個正常的頁面載入最多送 5 筆（shared/client-error.ts 的 CLIENT_ERROR_MAX_PER_PAGE），
// 每來源每分鐘 20 筆足夠連續換好幾頁；全站每分鐘 300 筆是最後保險。實際寫進資料庫的量另受 API 的
// 單一來源每分鐘 60 筆與全站每日 5000 筆限制（backend/app/operations/error_reports.py）。
export const CLIENT_ERROR_QUOTA: TelemetryQuotaOptions = { perSource: 20, global: 300, windowMs: 60_000, maxSources: 10_000 }

export const createClientErrorQuota = (options: TelemetryQuotaOptions = CLIENT_ERROR_QUOTA) => createTelemetryQuota(options)
