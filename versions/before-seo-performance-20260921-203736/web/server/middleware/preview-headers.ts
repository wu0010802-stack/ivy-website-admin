export default defineEventHandler((event) => {
  if (event.path.startsWith('/preview')) {
    setResponseHeader(event, 'Cache-Control', 'private, no-store')
    setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow')
  }
})
