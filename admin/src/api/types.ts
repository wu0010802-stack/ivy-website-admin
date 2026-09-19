export type Role = 'super_admin' | 'campus_admin' | 'editor' | 'reception' | 'readonly'

export interface UserOut {
  id: string
  email: string
  role: Role
  is_active: boolean
  campus_keys: string[]
}

export interface CampusOut {
  key: string
  name: string
  active: boolean
}

export const CAMPUS_KEYS = ['yihua', 'minghua', 'chongde', 'international', 'renwu'] as const
