import path from 'node:path'

// 端到端測試（真後端＋隔離測試庫＋Nuxt production build＋後台 build）的共用設定。
// playwright.stack.config.ts 與各 spec 都讀這裡，埠號與帳號只寫一次。
// 埠號刻意避開本機開發慣用的 8000／3000：reuseExistingServer 關閉，撞埠直接失敗，
// 不會誤連到開發中的服務。

export const ROOT = path.resolve(__dirname, '../..')
export const API_PORT = Number(process.env.E2E_API_PORT ?? 8710)
export const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3710)
export const API_ORIGIN = `http://127.0.0.1:${API_PORT}`
export const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`
// start-api.sh 每次都會刪掉重建這個庫：名稱必須含 test（config.py 也會擋），
// 不可以指到開發庫、正式庫或其他 session 的單元測試庫。
export const DB_NAME = process.env.E2E_DB_NAME ?? 'ivy_website_e2e_test'
export const STATE_DIR = path.join(ROOT, 'output/e2e-stack')
export const AUTH_DIR = path.join(STATE_DIR, 'auth')

export type StackRole = 'super_admin' | 'campus_admin' | 'reception' | 'editor'

// 只存在拋棄式測試庫裡的帳號；密碼不是任何環境的真密碼。
export const USERS: Record<StackRole, { email: string; password: string; campusKeys: string[] }> = {
  super_admin: { email: 'e2e-super@ivy.example', password: 'e2e-super-password-123', campusKeys: [] },
  campus_admin: { email: 'e2e-yihua-admin@ivy.example', password: 'e2e-campus-password-123', campusKeys: ['yihua'] },
  reception: { email: 'e2e-yihua-reception@ivy.example', password: 'e2e-reception-password-123', campusKeys: ['yihua'] },
  editor: { email: 'e2e-yihua-editor@ivy.example', password: 'e2e-editor-password-123', campusKeys: ['yihua'] },
}

export function storageStatePath(role: StackRole): string {
  return path.join(AUTH_DIR, `${role}.json`)
}

// 預約主流程用的兩校：義華開「線上選場次、園方人工確認」，明華開「只收需求、
// 園方聯絡後排入」。其他三校維持初始化後的 paused。
export const SLOTS_CAMPUS = 'yihua'
export const INQUIRY_CAMPUS = 'minghua'
