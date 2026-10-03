// 同一個瀏覽器的分頁之間說「有人登入了」（2026-10-03 第八輪）。用途：這一頁登入
// 逾時又有沒儲存的修改時（router/unauthorized.ts），使用者在新分頁重新登入後，這一頁
// 自動接續，不用回來按「我已重新登入」。只傳 { type: 'signed-in' }，不帶任何登入資料；
// 收到的分頁自己打 /auth/me 取新的 CSRF token。沒有 BroadcastChannel 的瀏覽器就沒有
// 自動接續，照舊按按鈕。

const CHANNEL_NAME = 'ivy-admin-session'

export interface SessionChannelLike {
  postMessage(message: unknown): void
  close(): void
  onmessage: ((event: { data: unknown }) => void) | null
}

type ChannelFactory = () => SessionChannelLike | null

const defaultFactory: ChannelFactory = () =>
  typeof BroadcastChannel === 'undefined' ? null : (new BroadcastChannel(CHANNEL_NAME) as unknown as SessionChannelLike)

let factory: ChannelFactory = defaultFactory
let announcer: SessionChannelLike | null = null

/** 測試用：換成假的頻道；傳 null 還原。 */
export function setSessionChannelFactory(next: ChannelFactory | null): void {
  factory = next ?? defaultFactory
  announcer?.close()
  announcer = null
}

/** 登入成功（密碼登入、或 Google／LINE 登入後回到後台）時通知其他分頁。 */
export function announceSignedIn(): void {
  announcer ??= factory()
  announcer?.postMessage({ type: 'signed-in' })
}

/** 等別的分頁登入。不再等的時候呼叫 cancel 關掉頻道。 */
export function waitForSignIn(): { promise: Promise<void>; cancel: () => void } {
  const channel = factory()
  const promise = new Promise<void>((resolve) => {
    if (!channel) return
    channel.onmessage = (event) => {
      if ((event.data as { type?: string } | null)?.type === 'signed-in') resolve()
    }
  })
  return {
    promise,
    cancel: () => {
      if (!channel) return
      channel.onmessage = null
      channel.close()
    },
  }
}
