import { ATTRIBUTION_COOKIE, isReturningVisit } from '../../shared/attribution-cookie'

export default defineEventHandler((event) => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const allowed = useRuntimeConfig(event).public.telemetryEnabled
    && getRequestHeader(event, 'sec-fetch-site') !== 'cross-site'
    && getRequestHeader(event, 'dnt') !== '1'
    && getRequestHeader(event, 'sec-gpc') !== '1'
  return { returning: allowed ? isReturningVisit(getCookie(event, ATTRIBUTION_COOKIE), new Date()) : null }
})
