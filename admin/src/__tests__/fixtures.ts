import type { MediaAssetOut, MediaAssetPageOut, Role, UserOut } from '../api/types'

// 測試用的登入者。effective_capabilities 照 backend/app/auth/permissions.py
// 的角色表（不含逐人授權）；畫面本身一律讀後端回傳的值，這份只給測試組資料。
const CAMPUS_READ = ['analytics.read', 'campuses.read', 'content.read', 'media.read']
export const ROLE_CAPABILITIES: Record<Role, string[]> = {
  super_admin: [
    ...CAMPUS_READ, 'admissions.convert', 'admissions.read', 'admissions.write', 'audit.read_all', 'booking.cross_campus',
    'booking.export', 'booking.handle', 'booking.manage', 'booking.read', 'campuses.activate', 'campuses.manage',
    'content.manage', 'content.publish', 'content.release_restore', 'content.shared', 'media.manage',
    'notifications.manage', 'retention.manage', 'users.manage',
  ],
  campus_admin: [
    ...CAMPUS_READ, 'admissions.convert', 'admissions.read', 'admissions.write', 'booking.handle', 'booking.manage',
    'booking.read', 'campuses.manage', 'content.manage', 'content.publish', 'media.manage',
  ],
  editor: [...CAMPUS_READ, 'content.manage', 'media.manage'],
  reception: [...CAMPUS_READ, 'admissions.read', 'admissions.write', 'booking.handle', 'booking.read'],
  readonly: [...CAMPUS_READ],
}

export function testUser(role: Role, overrides: Partial<UserOut> = {}): UserOut {
  return {
    id: 'local-test',
    email: 'test@example.invalid',
    role,
    is_active: true,
    campus_keys: [],
    capabilities: [],
    effective_capabilities: [...ROLE_CAPABILITIES[role]],
    google_linked: false,
    line_linked: false,
    ...overrides,
  }
}

/**
 * 素材列表（GET /admin/media）的一頁。tags 照後端算法由 items 算出：用得多的在前，
 * 次數相同依字串排序。
 */
export function mediaPage(items: MediaAssetOut[], overrides: Partial<MediaAssetPageOut> = {}): MediaAssetPageOut {
  const counts = new Map<string, number>()
  for (const item of items) for (const tag of item.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  const tags = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([tag]) => tag)
  return { items, total: items.length, state_total: items.length, page: 1, page_size: 60, tags, ...overrides }
}

/** 素材列表網址的查詢參數，方便斷言帶了哪些篩選。 */
export function mediaListParams(path: string): Record<string, string> {
  return Object.fromEntries(new URL(path, 'http://admin.test').searchParams)
}
