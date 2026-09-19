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

export interface HomeAboutPayload {
  title: string
  since_label: string
  body_text: string
  caption: string
}

export interface ContentRevisionOut {
  id: string
  version: number
  payload: HomeAboutPayload
  created_at: string
}

export interface ContentItemOut {
  id: string
  kind: string
  campus_key: string | null
  latest_version: number
  current_published_revision_id: string | null
  latest_revision: ContentRevisionOut | null
}
