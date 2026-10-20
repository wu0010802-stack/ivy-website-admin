/**
 * 送出用的唯一 key（預約表單的 idempotency key、CTA 事件 id、網頁效能指標 id）。
 * crypto.randomUUID 要 iOS 15.4／Chrome 92 以上；預約表單在 setup 就產生 key，
 * 舊 WebView（例如 LINE 內建瀏覽器）沒有它時 hydration 會整個失敗，所以退回
 * getRandomValues 自己組 v4 UUID（後端只要求 1–128 字，格式一致方便對照）。
 */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
