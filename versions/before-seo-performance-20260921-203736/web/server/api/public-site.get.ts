// Server-only 代理：呼叫 FastAPI 的 /public/site。刻意不吞掉失敗——後端
// 說「尚無可用內容」（503）或直接連不上，都要讓呼叫端（usePublishedSite）
// 知道這是一個錯誤，不能被誤當成「還沒發布，安靜退回 fixture」而繼續用
// HTTP 200 呈現一個看起來正常、內容卻是假的頁面。
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  try {
    return await $fetch(`${config.websiteApiInternalBase}/api/website/v1/public/site`)
  } catch (err: any) {
    const statusCode = err?.response?.status ?? err?.statusCode ?? 503
    throw createError({
      statusCode,
      statusMessage: statusCode === 503 ? '網站內容服務暫時無法使用' : '讀取網站內容失敗'
    })
  }
})
