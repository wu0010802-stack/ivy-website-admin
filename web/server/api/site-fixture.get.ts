import siteFixture from '../data/site-fixture.json'

// 完整 fixture 含尚未發布的校區與原型編輯註記，只給草稿預覽用。正式內容
// 模式下要先確認是有效的後台 session（轉問 API 的 /auth/me），公開訪客
// 走 /api/published-site 取已發布內容。本機 fixture 模式本來就只有示範資料。
export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const config = useRuntimeConfig(event)
  if (config.public.contentMode === 'fixture') return siteFixture
  const cookie = getHeader(event, 'cookie')
  if (!cookie) throw createError({ statusCode: 401 })
  try {
    await $fetch(`${config.websiteApiInternalBase}/api/website/v1/auth/me`, { headers: { cookie }, timeout: 5000 })
  } catch {
    throw createError({ statusCode: 401 })
  }
  return siteFixture
})
