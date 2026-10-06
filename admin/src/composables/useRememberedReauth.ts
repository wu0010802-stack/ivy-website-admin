import { onBeforeUnmount, reactive } from 'vue'
import { ApiError } from '../api/client'
import { loginLimitedMessage } from '../api/errors'
import { reauthRequiredMessage } from '../api/oauth'
import { notifyError } from './notify'

/** 重新驗證時按了取消（或密碼驗證被鎖、已經提示過）：呼叫端停在原畫面，不必再另外提示。 */
export class ReauthCancelled extends Error {
  constructor() {
    super('reauth cancelled')
  }
}

/**
 * 請求本文多帶的重新驗證欄位（後端 require_recent_auth 的選填 current_password）。沒有密碼時是空物件，本文和原本一樣。
 * 前端暫用的本地型別補丁只有這一處（2026-10-06）：後端已在 UserCreateRequest、UserUpdateActiveRequest、
 * UserUpdateRoleRequest、UserCapabilitiesRequest、PasswordResetRequest 等加上 current_password，
 * 合併後端契約（contracts/generated/website-api.d.ts）後可移除，改用產生的型別。
 */
export type ReauthFields = { current_password?: string }

// 跟後端的寬限一樣是 10 分鐘（session 建立 10 分鐘內免密碼）。
const REMEMBER_MS = 10 * 60 * 1000

/**
 * 帳號管理這類敏感寫入（2026-10-06 起後端套用 require_recent_auth）：登入超過 10 分鐘時回
 * 403 REAUTH_REQUIRED，要帶目前的密碼重送同一個請求（流程比照「我的帳號」AccountView）。
 *
 * run(send) 先照常送；被要求驗證就打開輸入密碼的對話框，拿到密碼後帶 current_password 重送，
 * 密碼錯就留在對話框重打。驗證成功後在這一頁記住密碼最多 10 分鐘（只在元件記憶體、卸載就清），
 * 之後的操作自動帶上，不用每改一個人都再輸入。多步驟的流程每一步各包一次 run：中途要驗證時
 * 從那一步接著送，前面已經成功的步驟不會重送。
 */
export function useRememberedReauth() {
  const reauth = reactive({ open: false, message: '', password: '', error: '', submitting: false })
  let remembered: { password: string; at: number } | null = null
  let waiting: ((password: string | null) => void) | null = null

  function rememberedPassword(): string | null {
    if (remembered && Date.now() - remembered.at < REMEMBER_MS) return remembered.password
    remembered = null
    return null
  }

  function close() {
    reauth.open = false
    reauth.password = ''
    reauth.error = ''
    reauth.submitting = false
  }

  function settle(password: string | null) {
    const resolve = waiting
    waiting = null
    resolve?.(password)
  }

  // asError：剛帶的密碼不對，說明寫在欄位下方，上面那句維持原本為什麼要驗證。
  function ask(message: string, asError: boolean): Promise<string | null> {
    if (asError) {
      reauth.error = message
    } else {
      reauth.message = message
      reauth.error = ''
    }
    reauth.password = ''
    reauth.submitting = false
    reauth.open = true
    return new Promise((resolve) => {
      waiting = resolve
    })
  }

  /** 對話框的「確認」：密碼只交給這一次重送，不留在畫面狀態裡。 */
  function submit() {
    if (reauth.submitting || !waiting) return
    if (!reauth.password) {
      reauth.error = '請輸入目前的密碼。'
      return
    }
    const password = reauth.password
    reauth.password = ''
    reauth.error = ''
    reauth.submitting = true
    settle(password)
  }

  /** 取消、右上角 X、Esc：這次操作不送了。 */
  function cancel() {
    if (reauth.submitting) return
    close()
    settle(null)
  }

  async function run<T>(send: (fields: ReauthFields) => Promise<T>): Promise<T> {
    let password = rememberedPassword()
    let fromDialog = false
    for (;;) {
      try {
        const result = await send(password ? { current_password: password } : {})
        // 從輸入驗證成功那一刻起算 10 分鐘；之後自動帶上的那幾次不延長。
        if (password && fromDialog) {
          remembered = { password, at: Date.now() }
          close()
        }
        return result
      } catch (err) {
        const message = reauthRequiredMessage(err)
        if (message) {
          // 記住的密碼不能用了（例如本人剛改過密碼）：忘掉，請本人重打。
          if (!fromDialog) remembered = null
          const next = await ask(message, fromDialog)
          if (next === null) throw new ReauthCancelled()
          password = next
          fromDialog = true
          continue
        }
        if (fromDialog) close()
        // 帶了密碼卻被擋（429）：密碼驗證暫停或來源限流，說明原因就好，呼叫端不再跳「更新失敗」。
        if (password && err instanceof ApiError && err.status === 429) {
          notifyError(loginLimitedMessage(err, { verb: '驗證' }))
          throw new ReauthCancelled()
        }
        throw err
      }
    }
  }

  onBeforeUnmount(() => {
    remembered = null
    close()
    settle(null)
  })

  return { reauth, run, submit, cancel }
}
