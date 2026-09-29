import { api } from './client'
import type { LineLinkStart } from './types'

const LINE_AUTHORIZE = 'https://access.line.me/oauth2/v2.1/authorize?'

/** 整頁跳轉包成物件，測試才能替換（jsdom 不允許 spy window.location）。 */
export const browser = {
  assign(url: string): void {
    window.location.assign(url)
  },
}

/** 後端建立握手 cookie 後回傳授權網址；只接受 LINE 官方授權端點才離開後台。 */
export async function startLineLink(): Promise<void> {
  const { authorize_url: url } = await api.post<LineLinkStart>('/auth/line/link')
  if (typeof url !== 'string' || !url.startsWith(LINE_AUTHORIZE)) {
    throw new Error('unexpected LINE authorize url')
  }
  browser.assign(url)
}
