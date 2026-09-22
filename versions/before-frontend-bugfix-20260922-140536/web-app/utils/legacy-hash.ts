const CAMPUS_KEYS = ['yihua', 'minghua', 'chongde', 'international', 'renwu']

export function resolveLegacyHash(hash: string): string | null {
  if (!hash.startsWith('#/')) return null
  const path = hash.slice(1) // 保留開頭的 '/'

  if (path === '/home') return '/'
  if (path === '/home/about') return '/#about'
  if (path === '/home/life') return '/#life'
  if (path === '/home/campuses') return '/#campuses'
  if (path === '/home/latest-news') return '/'
  if (path === '/visit') return '/visit'

  const visitMatch = path.match(/^\/visit\/([a-z]+)$/)
  const visitKey = visitMatch?.[1]
  if (visitKey && CAMPUS_KEYS.includes(visitKey)) return `/visit/${visitKey}`

  if (CAMPUS_KEYS.includes(path.slice(1))) return `/campuses/${path.slice(1)}`

  return null
}
