// 登入頁的「回訪者」（2026-11-19，登入頁方向 1）：這台瀏覽器上次登入的是誰、用什麼方式。
//
// - 誰（Email、側欄同一套的名字與「角色・校區」）在登入或恢復登入成功時記下；
//   按「登出」或登入頁的「換帳號」就清掉。共用電腦下班按登出，下一位不會看到前一位的名字。
//   登入逾時、被別的分頁換掉時不清：同一個人回來一鍵就能接著用。
// - 方式（密碼／Google／LINE）另外存、登出也不清：它不是個資，只用來把常用的按鈕排前面、標「上次使用」。
//   Google／LINE 要等導回後台、恢復登入成功才算數（按了又取消不算），所以按下時先放 sessionStorage，
//   恢復登入時再收進 localStorage（同一個分頁導去 Google／LINE 再回來，sessionStorage 還在）。
// 只放在這台瀏覽器（localStorage），不送到伺服器；讀寫失敗（無痕、被封鎖）一律當作沒有。
import type { UserOut } from '../api/types'
import { campusLabels, roleLabel, staffLabel } from '../api/labels'

export type SignInMethod = 'password' | 'google' | 'line'

export interface LastSignInUser {
  email: string
  name: string
  line: string
}

const USER_KEY = 'ivy-admin-last-user'
const METHOD_KEY = 'ivy-admin-last-method'
const PENDING_KEY = 'ivy-admin-pending-method'
const METHODS: readonly SignInMethod[] = ['password', 'google', 'line']

function read(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key)
  } catch {
    return null
  }
}

function write(storage: () => Storage, key: string, value: string | null): void {
  try {
    if (value === null) storage().removeItem(key)
    else storage().setItem(key, value)
  } catch {
    // 無痕或封鎖了網站資料：記不住就算了，登入本身不受影響。
  }
}

const local = () => window.localStorage
const session = () => window.sessionStorage

function isMethod(value: unknown): value is SignInMethod {
  return typeof value === 'string' && (METHODS as readonly string[]).includes(value)
}

/** 側欄帳號區同一套說法：總管理者不帶校區，其他角色帶「角色・校區」。 */
export function userLine(user: Pick<UserOut, 'role' | 'campus_keys'>): string {
  const campuses = user.role === 'super_admin' ? '' : campusLabels(user.campus_keys)
  return campuses ? `${roleLabel(user.role)}・${campuses}` : roleLabel(user.role)
}

export function readLastUser(): LastSignInUser | null {
  const raw = read(local, USER_KEY)
  if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<LastSignInUser>
    if (typeof value.email !== 'string' || !value.email || typeof value.name !== 'string' || typeof value.line !== 'string') return null
    return { email: value.email, name: value.name, line: value.line }
  } catch {
    return null
  }
}

export function readLastMethod(): SignInMethod | null {
  const value = read(local, METHOD_KEY)
  return isMethod(value) ? value : null
}

/** 登入或恢復登入成功：記住是誰；剛從 Google／LINE 導回來的，順便把方式記下。 */
export function rememberSignedIn(user: UserOut, method?: SignInMethod): void {
  const record: LastSignInUser = { email: user.email, name: staffLabel(user, ''), line: userLine(user) }
  write(local, USER_KEY, JSON.stringify(record))
  const pending = read(session, PENDING_KEY)
  const used = method ?? (isMethod(pending) ? pending : null)
  if (used) write(local, METHOD_KEY, used)
  write(session, PENDING_KEY, null)
}

/** 按下 Google／LINE 登入時：先記著，導回來恢復登入成功才算數。 */
export function notePendingMethod(method: Exclude<SignInMethod, 'password'>): void {
  write(session, PENDING_KEY, method)
}

/** 主動登出、或在登入頁按「換帳號」：忘掉是誰（方式留著）。 */
export function forgetLastUser(): void {
  write(local, USER_KEY, null)
}
