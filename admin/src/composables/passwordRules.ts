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

/**
 * 字數。後端 pydantic 的 min_length／max_length 數 code point（Python 的 len），
 * 不是 JS 的 .length（UTF-16 單位）：emoji 在 .length 是 2、後端只算 1，
 * 照 .length 算會放行字數不夠的密碼，再被後端回英文 422。
 */
export function passwordLength(value: string): number {
  return Array.from(value).length
}

export function passwordOk(value: string): boolean {
  const length = passwordLength(value)
  return length >= PASSWORD_MIN_LENGTH && length <= PASSWORD_MAX_CHARS && passwordBytes(value) <= PASSWORD_MAX_BYTES
}

export function passwordHint(value: string): string {
  const base = `12 字以上、最多 72 bytes（中文約 24 字）。目前 ${passwordLength(value)} 字`
  return passwordBytes(value) > PASSWORD_MAX_BYTES ? `${base}，超過 72 bytes，請縮短。` : `${base}。`
}
