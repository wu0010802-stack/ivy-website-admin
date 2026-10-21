import path from 'node:path'

// 公開站端到端測試（tests/e2e）的共用設定。和 tests/stack 一樣起真後端＋每次重建的隔離測試庫
// ＋Nuxt production build（先 `npm run e2e:build`），但用自己的庫名、埠號與暫存資料夾，
// 兩組可以先後跑，不會覆蓋彼此的資料。playwright.config.ts 與各 spec 都讀這裡。
export const ROOT = path.resolve(__dirname, '../..')
export const API_PORT = Number(process.env.E2E_PUBLIC_API_PORT ?? 8720)
export const WEB_PORT = Number(process.env.E2E_PUBLIC_WEB_PORT ?? 3720)
export const API_ORIGIN = `http://127.0.0.1:${API_PORT}`
export const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`
// start-api.sh 每次都會刪掉重建這個庫：名稱必須含 test，不可以指到開發庫或其他 session 的測試庫。
export const DB_NAME = process.env.E2E_PUBLIC_DB_NAME ?? 'ivy_website_e2e_public_test'
export const STATE_DIR = path.join(ROOT, 'output/e2e-public')

// 只存在拋棄式測試庫裡的總管理者（start-api.sh 建立）；密碼不是任何環境的真密碼。
export const ADMIN = {
  email: 'e2e-public-super@ivy.example',
  password: 'e2e-public-super-password-123',
}
