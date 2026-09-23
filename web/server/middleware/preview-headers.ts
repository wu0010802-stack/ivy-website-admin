export default defineEventHandler((event) => {
  const path = event.path.split('?')[0] ?? '/'
  if (/^\/(preview|admin|visit)(\/|$)/.test(path)) {
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
    if (path === '/visit/manage' || path === '/visit/manage/') setResponseHeader(event, 'Referrer-Policy', 'no-referrer')
  } else if (path === '/' || path.startsWith('/campuses/')) {
    setResponseHeader(event, 'Cache-Control', 'no-cache, max-age=0')
    const config = useRuntimeConfig()
    if (!config.public.indexingEnabled) setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  }
})
