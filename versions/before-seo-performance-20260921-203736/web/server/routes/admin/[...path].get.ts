import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// Existing assets are served by Nitro. History routes use the separately built
// admin entry point; missing assets must remain 404 instead of receiving HTML.
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  if (!config.adminDistDir || event.path.startsWith('/admin/assets/')) {
    throw createError({ statusCode: 404 })
  }
  let html: string
  try {
    html = await readFile(join(config.adminDistDir, 'index.html'), 'utf8')
  } catch {
    throw createError({ statusCode: 503, statusMessage: '後台服務尚未就緒' })
  }
  setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8')
  setResponseHeader(event, 'Cache-Control', 'no-store')
  setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  return html
})
