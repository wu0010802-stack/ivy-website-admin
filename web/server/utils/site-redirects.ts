// 網域移轉用的兩種 301（2026-11-11，見 docs/website-admin/migration-checklist.md）：
//
// 1. 舊 Wix 官網（www.ivykidschool.com）的頁面網址 → 新站對應頁。對照表在下面
//    LEGACY_REDIRECTS，來源是舊站 2026-11-11 的 pages-sitemap.xml（30 個網址）；
//    沒有適合對應的舊網址不放進來（照常 404），列在 checklist 的「待確認」。
//    這組一直開著：新站本來就沒有這些路徑，只會把原本的 404 變成 301。
// 2. 主網域轉址：NUXT_REDIRECT_HOSTS 列出的主機（例如 ivykidschool.com、Railway 暫用網址）
//    一律 301 到 NUXT_PUBLIC_SITE_ORIGIN。預設空白＝完全不轉；正式網域接通、驗證過以後才設，
//    避免把訪客導到還沒準備好的網址。
//
// 兩者同時命中時一次轉到底（apex 的舊網址直接到 www 的新網址，不跳兩次）。

/** 舊站路徑（解碼後）→ 新站路徑。鍵用 normalizeLegacyPath 的結果（NFC、小寫、去結尾斜線）。 */
export const LEGACY_REDIRECTS: Readonly<Record<string, string>> = {
  // 入學
  '/常春藤入學-admission': '/admission',
  '/寶貝入學流程': '/admission#process',
  '/分班表': '/admission#classes',
  '/新生入園須知': '/admission#newcomer',
  '/收退費辦法': '/admission#fees',
  // 環境
  '/常春藤環境-environment': '/environment',
  '/副本-幼兒保育': '/environment#care',
  '/校園環境': '/environment#spaces',
  '/幼兒餐點': '/environment#meals',
  '/副本-仁武校介紹-2': '/environment#campuses', // 舊站標題「仁武校校園環境」
  // 一日流程 → 首頁「孩子的一天」
  '/一日流程': '/#life',
  // 特色教學
  '/教學特色-course': '/curriculum',
  '/副本-快樂的孩子': '/curriculum#belief', // 舊站標題「教學理念」（Wix 複製頁沒改網址）
  // 分校：分校介紹頁已拿掉，改到首頁五校卡、從那一校開始
  '/分校資訊-campuses': '/#campuses',
  '/義華校介紹': '/?campus=yihua#campuses',
  '/明華校介紹': '/?campus=minghua#campuses',
  '/崇德校介紹': '/?campus=chongde#campuses',
  '/國際校介紹': '/?campus=international#campuses',
  '/仁武校介紹': '/?campus=renwu#campuses',
  // 舊站「校園生活 Features」（活動分享）→ 最新消息（建議對應，checklist 標待確認）
  '/活動分享': '/news'
}

/** 解碼、NFC、小寫、去掉結尾斜線；解不開的百分比編碼回 null（不轉）。 */
export function normalizeLegacyPath(pathname: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const trimmed = decoded.normalize('NFC').toLowerCase().replace(/\/+$/, '')
  return trimmed || '/'
}

/** 合併查詢字串：目標自帶的參數優先，原網址其他參數照帶（Wix 的 ?lang=、廣告的 utm_* 都保留）。 */
function withQuery(target: string, search: string): string {
  const hashAt = target.indexOf('#')
  const base = hashAt === -1 ? target : target.slice(0, hashAt)
  const hash = hashAt === -1 ? '' : target.slice(hashAt)
  const queryAt = base.indexOf('?')
  const path = queryAt === -1 ? base : base.slice(0, queryAt)
  const params = new URLSearchParams(queryAt === -1 ? '' : base.slice(queryAt + 1))
  for (const [key, value] of new URLSearchParams(search)) {
    if (!params.has(key)) params.append(key, value)
  }
  const query = params.toString()
  return `${path}${query ? `?${query}` : ''}${hash}`
}

/** NUXT_REDIRECT_HOSTS：逗號或空白分隔的主機名（不含協定與連接埠）；跟正式網址同主機的會被忽略，避免轉圈。 */
export function parseRedirectHosts(value: string | undefined, siteOrigin: string): Set<string> {
  let canonicalHost = ''
  try {
    canonicalHost = siteOrigin ? new URL(siteOrigin).hostname.toLowerCase() : ''
  } catch { /* 無效 origin：下面 resolveSiteRedirect 會整個停用主網域轉址 */ }
  const hosts = new Set<string>()
  for (const raw of (value ?? '').split(/[\s,]+/)) {
    const host = raw.trim().toLowerCase().replace(/\.$/, '')
    if (!host || host === canonicalHost) continue
    if (!/^[a-z0-9.-]+$/.test(host)) continue
    hosts.add(host)
  }
  return hosts
}

/**
 * 請求的 Host 是不是正式網址那台主機。robots.txt 用它：正式網域開放收錄以後，還沒轉址的
 * 其他主機（Railway 暫用網址、apex）仍回「全站不收」，避免同一份內容被兩個網域收錄。
 */
export function isCanonicalHost(host: string | undefined, siteOrigin: string): boolean {
  if (!siteOrigin) return false
  let canonicalHost = ''
  try {
    canonicalHost = new URL(siteOrigin).hostname.toLowerCase()
  } catch {
    return false
  }
  return (host ?? '').trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '') === canonicalHost
}

/** 主網域轉址不碰的路徑：API（含 LINE webhook、health）、CI 用來核對版本的 /release.json。 */
function hostRedirectExempt(pathname: string): boolean {
  const path = pathname.toLowerCase()
  return path === '/release.json' || path === '/api' || path.startsWith('/api/')
}

export interface SiteRedirectInput {
  method: string
  /** Host 標頭（可能帶連接埠） */
  host: string | undefined
  /** 原始請求路徑，含查詢字串，例如 /%E5%88%86%E7%8F%AD%E8%A1%A8?lang=en */
  url: string
  /** 已經過 normalizeSiteOrigin 的正式網址；空字串＝沒有正式網址 */
  siteOrigin: string
  redirectHosts: ReadonlySet<string>
}

/** 回傳要 301 的 Location；不用轉回 null。只處理 GET／HEAD，表單與 API 寫入不轉。 */
export function resolveSiteRedirect(input: SiteRedirectInput): string | null {
  const method = input.method.toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') return null
  const queryAt = input.url.indexOf('?')
  const pathname = queryAt === -1 ? input.url : input.url.slice(0, queryAt)
  const search = queryAt === -1 ? '' : input.url.slice(queryAt + 1)
  if (!pathname.startsWith('/') || pathname.startsWith('//')) return null

  const key = normalizeLegacyPath(pathname)
  const legacy = key ? LEGACY_REDIRECTS[key] : undefined
  const host = (input.host ?? '').trim().toLowerCase().replace(/:\d+$/, '').replace(/\.$/, '')
  const moveHost = Boolean(input.siteOrigin) && input.redirectHosts.has(host) && !hostRedirectExempt(pathname)

  if (legacy) {
    const target = withQuery(legacy, search)
    return moveHost ? `${input.siteOrigin}${target}` : target
  }
  if (moveHost) return `${input.siteOrigin}${input.url}`
  return null
}
