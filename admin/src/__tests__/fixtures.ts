import type { Role, UserOut } from '../api/types'

// 測試用的登入者。effective_capabilities 照 backend/app/auth/permissions.py
// 的角色表（不含逐人授權）；畫面本身一律讀後端回傳的值，這份只給測試組資料。
const CAMPUS_READ = ['analytics.read', 'campuses.read', 'content.read', 'media.read']
export const ROLE_CAPABILITIES: Record<Role, string[]> = {
  super_admin: [
    ...CAMPUS_READ, 'audit.read_all', 'booking.cross_campus', 'booking.export', 'booking.handle', 'booking.manage',
    'booking.read', 'campuses.activate', 'campuses.manage', 'content.manage', 'content.publish', 'content.shared',
    'media.manage', 'notifications.manage', 'retention.manage', 'site_settings.manage', 'users.manage',
  ],
  campus_admin: [
    ...CAMPUS_READ, 'booking.handle', 'booking.manage', 'booking.read', 'campuses.manage', 'content.manage',
    'content.publish', 'media.manage',
  ],
  editor: [...CAMPUS_READ, 'content.manage', 'media.manage'],
  reception: [...CAMPUS_READ, 'booking.handle', 'booking.read'],
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
