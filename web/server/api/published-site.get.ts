import { loadPublishedSite } from '../utils/published-site'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'no-cache, max-age=0')
  return loadPublishedSite(useRuntimeConfig())
})
