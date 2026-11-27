import type { Role } from './types'

// 權限表的人話版（2026-11-27）。規則（誰有哪一項、哪幾項要授權）一律來自後端
// GET /admin/permission-table（backend/app/auth/permissions.py 的同一張表），這裡只負責
// 把 key 翻成同事看得懂的一句話並分組；不要在這裡寫角色。
// 後端新增一項時：加到下面某一組，或加到 UNLISTED_CAPABILITIES（permissionLabels.test.ts 會檢查兩邊對得上）。

export interface PermissionRow {
  key: string
  roles: Role[]
  /** 不是 null：總管理者以外的角色還要被逐人授予這一項才算有。 */
  grant?: string | null
}

export interface PermissionGroup {
  label: string
  items: { key: string; label: string }[]
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    label: '參觀預約',
    items: [
      { key: 'booking.read', label: '看參觀案件與家長資料' },
      { key: 'booking.handle', label: '處理案件：聯絡紀錄、改期、取消、補登' },
      { key: 'booking.manage', label: '管理場次、每週規則與預約方式' },
      { key: 'booking.export', label: '匯出參觀案件與招生名單（CSV）' },
    ],
  },
  {
    label: '招生',
    items: [
      { key: 'admissions.read', label: '看招生漏斗與訪視明細' },
      { key: 'admissions.write', label: '新增、編輯訪視與預繳' },
      { key: 'admissions.convert', label: '標記註冊與退註冊' },
      { key: 'admissions.stats', label: '看負責校區的招生統計' },
      { key: 'admissions.stats_site', label: '看廣告、搜尋等全站數字' },
      { key: 'admissions.imports', label: '匯入在籍清冊與歷年註冊' },
    ],
  },
  {
    label: '官網內容',
    items: [
      { key: 'content.browse', label: '看各校內容、素材與發布紀錄' },
      { key: 'content.manage', label: '編輯各校內容與素材' },
      { key: 'content.publish', label: '發布各校內容' },
      { key: 'content.shared', label: '編輯全站共用內容' },
      { key: 'content.shared_publish', label: '直接發布全站共用內容' },
      { key: 'content.release_restore', label: '把整個官網還原到某次發布' },
    ],
  },
  {
    label: '系統',
    items: [
      { key: 'audit.read', label: '看負責校區的操作紀錄' },
      { key: 'audit.read_all', label: '看全站操作紀錄與 IP' },
      { key: 'users.manage', label: '管理使用者' },
      { key: 'campuses.activate', label: '停用或重新啟用分校' },
      { key: 'retention.manage', label: '個資保存與清理' },
      { key: 'notifications.manage', label: '設定 LINE 群組通知' },
      { key: 'contact_phrases.manage', label: '維護聯絡片語' },
      { key: 'system.status', label: '看系統狀態' },
    ],
  },
]

// 不列在對照表的項目：和上面某一項一起出現、對同事沒有獨立意義的讀取權限，或極少用到的細項。
export const UNLISTED_CAPABILITIES: readonly string[] = [
  'campuses.read', // 登入的人都有
  'content.read', // 登入的人都有（案件畫面要讀分校資料）
  'media.read', // 登入的人都有
  'media.manage', // 同 content.manage
  'campuses.manage', // 同 booking.manage（分校設定）
  'booking.cross_campus', // 補登時把舊案關聯到別校，總管理者
  'contact_phrases.read', // 聯絡紀錄輸入框上方的片語，處理案件或招生的人都有
]

// 授權的名稱（使用者清單的標籤與對照表的「要授權」說明）。
export const GRANT_LABELS: Record<string, string> = {
  'content.shared': '全站內容',
  'booking.export': '可匯出個資',
  'admissions.stats': '招生統計',
}

export type PermissionState = 'yes' | 'grant' | 'no'

/** 這個角色對這一項：有、要總管理者另外授權、沒有。 */
export function permissionState(row: PermissionRow | undefined, role: Role): PermissionState {
  if (!row || !row.roles.includes(role)) return 'no'
  return row.grant && role !== 'super_admin' ? 'grant' : 'yes'
}

/** 這個角色加上勾選的授權，實際有沒有這一項（後端 has_capability 同一條規則）。 */
export function permissionAllowed(row: PermissionRow | undefined, role: Role, grants: readonly string[]): boolean {
  const state = permissionState(row, role)
  return state === 'yes' || (state === 'grant' && grants.includes(row!.grant!))
}

/** 後端回應整理成 key → 列；格式不對的列丟掉（讀取失敗或舊版後端時對照表顯示讀不到，不要壞掉）。 */
export function indexPermissionRows(rows: unknown): Map<string, PermissionRow> {
  const map = new Map<string, PermissionRow>()
  if (!Array.isArray(rows)) return map
  for (const row of rows as Partial<PermissionRow>[]) {
    if (row && typeof row.key === 'string' && Array.isArray(row.roles)) map.set(row.key, row as PermissionRow)
  }
  return map
}

/** 預覽：這樣設定可以做的事，照分組列出。 */
export function allowedPermissions(rows: Map<string, PermissionRow>, role: Role, grants: readonly string[]): PermissionGroup[] {
  return PERMISSION_GROUPS
    .map(group => ({ label: group.label, items: group.items.filter(item => permissionAllowed(rows.get(item.key), role, grants)) }))
    .filter(group => group.items.length > 0)
}
