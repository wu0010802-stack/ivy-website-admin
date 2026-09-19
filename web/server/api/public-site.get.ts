// Server-only 代理：呼叫 FastAPI 的 /public/site，失敗時回 null 而不是拋錯，
// 讓瀏覽器端可以安全地退回 fixture 內容。真正的 SSR 直讀／新鮮度／私有
// 預覽整合屬 Task 8（階段 C），這裡先做階段 B 展示用的最小讀取路徑。
export default defineEventHandler(async () => {
  const config = useRuntimeConfig()
  try {
    return await $fetch(`${config.websiteApiInternalBase}/api/website/v1/public/site`)
  } catch {
    return null
  }
})
