// 新密碼的長度規則（建立帳號、總管理者重設、本人更改密碼共用）。
// 與後端 app/auth/schemas.py 相同：12 字以上、最多 128 字，而且 UTF-8 不超過
// 72 bytes（bcrypt 只看前 72 bytes，後端超過回 422 password_too_long）。
// 英數字一個 1 byte，中文一個字 3 bytes（約 24 個字）。
export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_CHARS = 128
export const PASSWORD_MAX_BYTES = 72

export function passwordBytes(value: string): number {
  return new TextEncoder().encode(value).length
}

export function passwordOk(value: string): boolean {
  return value.length >= PASSWORD_MIN_LENGTH && value.length <= PASSWORD_MAX_CHARS && passwordBytes(value) <= PASSWORD_MAX_BYTES
}

export function passwordHint(value: string): string {
  const base = `12 字以上、最多 72 bytes（中文約 24 字）。目前 ${value.length} 字`
  return passwordBytes(value) > PASSWORD_MAX_BYTES ? `${base}，超過 72 bytes，請縮短。` : `${base}。`
}
