/**
 * 台北時區的今天（YYYY-MM-DD）。伺服器在 UTC，SSR 與瀏覽器要算出同一天。
 * 台灣沒有日光節約時間，直接用固定 UTC+8；不用 Intl 的 timeZone：第一次建時區格式器要初始化 ICU 時區資料，
 * 新分頁第一次建要 31–56 ms（CPU 4×，2026-10-25 實測），固定 +8 不到 3 ms。首頁、入學頁、環境頁 hydration 都會呼叫。
 */
export function taipeiIsoDate(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10)
}
