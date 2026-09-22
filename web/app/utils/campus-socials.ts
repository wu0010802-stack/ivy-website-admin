import type { Campus } from '../types/site-content'

const platforms = [
  { platform: 'instagram', label: 'IG' },
  { platform: 'facebook', label: 'FB' },
  { platform: 'youtube', label: 'YouTube' },
  { platform: 'line', label: 'LINE' }
] as const

function accountKey(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

export function getCampusSocials(
  campus: Pick<Campus, 'instagram' | 'facebook' | 'youtube' | 'line'> | undefined,
  institutionLinks: ReadonlyArray<{ url: string }> = []
) {
  if (!campus) return []
  const institutionAccounts = new Set(institutionLinks.map(link => accountKey(link.url)))
  return platforms.map(({ platform, label }) => {
    const url = campus[platform]?.trim() || null
    // 舊 fixture 有借用機構粉專的欄位，不能在分校區重標成分校帳號。
    return { platform, label, url: url && !institutionAccounts.has(accountKey(url)) ? url : null }
  })
}
