import { api } from './client'
import type { LoginResponse, PasskeyOut } from './types'
import type { ReauthFields } from '../composables/useRememberedReauth'

// 指紋／臉部辨識登入（Passkey，WebAuthn；2026-11-27，後端 app/auth/passkey.py）。
// 後端給的參數是 JSON（二進位欄位是 base64url），這裡轉成瀏覽器要的 ArrayBuffer，
// 結果再轉回 JSON 送回去。不用瀏覽器的 parseCreationOptionsFromJSON／toJSON：iOS 17 以前沒有。

type Json = Record<string, unknown>
interface OptionsResponse { public_key: Json }

/** navigator.credentials 包一層，測試才能替換（jsdom 沒有 WebAuthn）。 */
export const authenticator = {
  supported(): boolean {
    return typeof window !== 'undefined' && window.isSecureContext !== false
      && typeof window.PublicKeyCredential === 'function' && typeof navigator.credentials?.create === 'function'
  },
  create(publicKey: PublicKeyCredentialCreationOptions): Promise<Credential | null> {
    return navigator.credentials.create({ publicKey })
  },
  get(publicKey: PublicKeyCredentialRequestOptions): Promise<Credential | null> {
    return navigator.credentials.get({ publicKey })
  },
}

export function fromBase64Url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

export function toBase64Url(buffer: ArrayBuffer | null | undefined): string {
  if (!buffer) return ''
  let binary = ''
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const descriptors = (list: unknown): PublicKeyCredentialDescriptor[] =>
  (Array.isArray(list) ? list : []).map((item: Json) => ({ ...item, id: fromBase64Url(String(item.id)) }) as PublicKeyCredentialDescriptor)

export function creationOptions(json: Json): PublicKeyCredentialCreationOptions {
  const user = json.user as Json
  return {
    ...json,
    challenge: fromBase64Url(String(json.challenge)),
    user: { ...user, id: fromBase64Url(String(user.id)) },
    excludeCredentials: descriptors(json.excludeCredentials),
  } as unknown as PublicKeyCredentialCreationOptions
}

export function requestOptions(json: Json): PublicKeyCredentialRequestOptions {
  return {
    ...json,
    challenge: fromBase64Url(String(json.challenge)),
    allowCredentials: descriptors(json.allowCredentials),
  } as unknown as PublicKeyCredentialRequestOptions
}

function envelope(credential: PublicKeyCredential, response: Json): Json {
  return {
    id: credential.id,
    rawId: toBase64Url(credential.rawId),
    type: credential.type,
    response,
    clientExtensionResults: credential.getClientExtensionResults?.() ?? {},
    authenticatorAttachment: credential.authenticatorAttachment ?? undefined,
  }
}

export function registrationToJSON(credential: PublicKeyCredential): Json {
  const response = credential.response as AuthenticatorAttestationResponse
  return envelope(credential, {
    clientDataJSON: toBase64Url(response.clientDataJSON),
    attestationObject: toBase64Url(response.attestationObject),
    transports: response.getTransports?.() ?? [],
  })
}

export function assertionToJSON(credential: PublicKeyCredential): Json {
  const response = credential.response as AuthenticatorAssertionResponse
  return envelope(credential, {
    clientDataJSON: toBase64Url(response.clientDataJSON),
    authenticatorData: toBase64Url(response.authenticatorData),
    signature: toBase64Url(response.signature),
    userHandle: response.userHandle ? toBase64Url(response.userHandle) : undefined,
  })
}

/** 瀏覽器那一步沒有完成的原因；後端的錯誤照常是 ApiError。 */
export type PasskeyFailure = 'cancelled' | 'duplicate' | 'unavailable'
export class PasskeyError extends Error {
  readonly reason: PasskeyFailure

  constructor(reason: PasskeyFailure) {
    super(`passkey ${reason}`)
    this.reason = reason
  }
}

function browserFailure(err: unknown): PasskeyError {
  const name = err instanceof Error ? err.name : ''
  // InvalidStateError：這台裝置已經登記過（excludeCredentials 命中）。
  if (name === 'InvalidStateError') return new PasskeyError('duplicate')
  // NotAllowedError：使用者按取消、逾時，或系統不讓用。AbortError 同。
  if (name === 'NotAllowedError' || name === 'AbortError') return new PasskeyError('cancelled')
  // SecurityError（網址不對）、NotSupportedError 等：這個瀏覽器或這個網址用不了。
  return new PasskeyError('unavailable')
}

export function listPasskeys(): Promise<PasskeyOut[]> {
  return api.get<PasskeyOut[]>('/auth/passkeys')
}

/** 第一步（要參數）可能被要求重新驗證，和第二步分開，呼叫端只把第一步包進重新驗證流程。 */
export async function startRegistration(fields: ReauthFields = {}): Promise<Json> {
  const body = fields.current_password ? fields : undefined
  const options = await (body ? api.post<OptionsResponse>('/auth/passkeys/register/options', body) : api.post<OptionsResponse>('/auth/passkeys/register/options'))
  return options.public_key
}

export async function finishRegistration(publicKey: Json): Promise<PasskeyOut> {
  let credential: Credential | null
  try {
    credential = await authenticator.create(creationOptions(publicKey))
  } catch (err) {
    throw browserFailure(err)
  }
  if (!credential) throw new PasskeyError('cancelled')
  return api.post<PasskeyOut>('/auth/passkeys/register/verify', { credential: registrationToJSON(credential as PublicKeyCredential) })
}

export function deletePasskey(id: string, fields: ReauthFields = {}): Promise<void> {
  return fields.current_password ? api.delete<void>(`/auth/passkeys/${id}`, fields) : api.delete<void>(`/auth/passkeys/${id}`)
}

export async function signInWithPasskey(remember: boolean): Promise<LoginResponse> {
  const options = await api.post<OptionsResponse>('/auth/passkeys/login/options', { remember })
  let credential: Credential | null
  try {
    credential = await authenticator.get(requestOptions(options.public_key))
  } catch (err) {
    throw browserFailure(err)
  }
  if (!credential) throw new PasskeyError('cancelled')
  return api.post<LoginResponse>('/auth/passkeys/login/verify', { credential: assertionToJSON(credential as PublicKeyCredential) })
}
